/**
 * Ground scatter: the small debris that makes a desert floor read as a place
 * rather than as a surface.
 *
 * The problem this solves: an empty expanse of sand is the loudest remaining
 * "tech demo" tell in the frame. Real environments have something worth looking
 * at in nearly every square metre near the camera, and the eye reads the
 * absence of that detail long before it reads any of the expensive work done on
 * the architecture behind it.
 *
 * Everything here is drawn with InstancedMesh. A few thousand separate meshes
 * would be a few thousand draw calls and would cost more than the rest of the
 * scene combined; instancing turns the whole field into six. That constraint is
 * what shapes the module: one geometry per prop KIND, and all variety comes
 * from the per-instance matrix and the per-instance colour.
 *
 * This is dressing. It registers no colliders: the player walks over it.
 */

import * as THREE from 'three';
import { chamferedBox, erode } from './geometry.js';
import { cylinderUV } from './uv.js';
import { buildTextures } from './textures.js';

/**
 * Tiles per world unit for the two textured layers. Deliberately far below the
 * courtyard's rubble density: at anything higher a metre-wide chunk shows two
 * full masonry courses and stops reading as a broken stone, reading instead as
 * a tiny wall someone dropped on the sand.
 */
const DENSITY = { rubble: 0.16 };

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const WIND_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Which way the wind blows, on the ground plane.
 *
 * Not a free parameter: the sway pass below rotates tufts about +z, which tips
 * their tops toward +x, so the prevailing wind in this scene is already
 * decided. Everything that drifts has to drift the same way or the frame
 * disagrees with itself.
 */
const DRIFT_X = 0.93;
const DRIFT_Z = 0.37;

/**
 * How far past an obstacle's edge its drift shadow reaches, in metres, and the
 * bucket size of the lookup grid built over the exclusion discs. The grid
 * inserts each disc into every cell within `r + DRIFT_REACH`, so a single cell
 * lookup is guaranteed to find every disc that can influence a point.
 */
const DRIFT_REACH = 7;
const CELL = 6;

/** How far the drift bank falls off from an obstacle face. */
const DRIFT_BAND = 2.6;

/** Half width of the trodden lane down the middle of the open space. */
const LANE_HALF = 3.6;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Hermite ramp. Linear ramps in a density field leave visible seams. */
function smoothstep(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Deterministic PRNG, same generator the courtyard uses. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * @param {THREE.Scene|THREE.Object3D} scene
 * @param {object} opts
 * @param {(x:number,z:number)=>number} opts.heightAt  dune surface sampler
 * @param {{min:number,max:number}} opts.bounds        world square to fill
 * @param {Array<{x:number,z:number,r:number}>} opts.exclusions  keep-out discs
 * @param {number} opts.count   total instances at full fidelity
 * @param {number} opts.seed    field is identical for a given seed
 * @param {{x:number,z:number}} opts.centre  where density peaks
 * @param {number} opts.radius  how far the field reaches from that centre
 */
export function buildScatter(scene, {
  heightAt = () => 0,
  bounds = { min: -50, max: 50 },
  exclusions = [],
  count = 6200,
  seed = 20260725,
  centre = { x: 0, z: 6 },
  radius = 58,
} = {}) {
  const tex = buildTextures();
  const rand = rng(seed);

  const group = new THREE.Group();
  group.name = 'scatter';
  scene.add(group);

  // -------------------------------------------------------------------------
  // materials
  // -------------------------------------------------------------------------

  // Owned here rather than taken from the shared registry, because the registry
  // materials carry the world-space weathering injection and that shader reads
  // `modelMatrix * transformed` without the instance matrix. On an InstancedMesh
  // every instance would sample the weathering at the same local position: no
  // variation, and every pebble stamped with the same base grime. Per-instance
  // colour below does that job properly instead.
  const materials = {
    // Untextured on purpose. At 10 to 30 cm a tiled rock texture is one
    // unreadable blur; the flat-shaded facets and the colour spread are what
    // actually read at this size, and they cost nothing.
    pebble: new THREE.MeshStandardMaterial({
      color: 0xbcae95, roughness: 0.94, metalness: 0.0, flatShading: true,
    }),

    sherd: new THREE.MeshStandardMaterial({
      color: 0xb09274, roughness: 0.82, metalness: 0.0,
      side: THREE.DoubleSide,
    }),

    bone: new THREE.MeshStandardMaterial({
      color: 0xc9bda1, roughness: 0.68, metalness: 0.0, flatShading: true,
    }),

    scrub: new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.95, metalness: 0.0,
      side: THREE.DoubleSide,
    }),

    // Big enough to show masonry grain, so these do get the block texture.
    block: new THREE.MeshStandardMaterial({
      ...tex.block,
      color: 0xffffff, roughness: 1.0, metalness: 0.0,
      normalScale: new THREE.Vector2(1.0, 1.0),
    }),
  };

  // -------------------------------------------------------------------------
  // placement
  // -------------------------------------------------------------------------

  const lo = bounds.min, hi = bounds.max;

  // ---- obstacle field -------------------------------------------------------
  //
  // The old placement did one thing with the exclusion list: reject. That is
  // why the field read as uniform noise. An exclusion disc is not only a hole,
  // it is a wind break and a kerb, and the interesting debris in any real
  // exterior is in the two metres immediately outside one. So the same list now
  // also drives an attraction term, and it needs a nearest-edge query rather
  // than a boolean.
  //
  // Bucketed because that query now runs tens of times per instance instead of
  // once: a courtyard wall run is a few hundred overlapping discs, and the
  // brute-force loop that was affordable for a single accept/reject test is not
  // affordable for a weighted one.

  const cellKey = (ix, iz) => (ix + 512) * 1024 + (iz + 512);
  const grid = new Map();

  for (let i = 0; i < exclusions.length; i++) {
    const e = exclusions[i];
    const rr = e.r + DRIFT_REACH;
    const x0 = Math.floor((e.x - rr) / CELL), x1 = Math.floor((e.x + rr) / CELL);
    const z0 = Math.floor((e.z - rr) / CELL), z1 = Math.floor((e.z + rr) / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = cellKey(ix, iz);
        let bucket = grid.get(k);
        if (!bucket) grid.set(k, bucket = []);
        bucket.push(i);
      }
    }
  }

  /**
   * Distance from a point to the nearest exclusion EDGE, plus the outward
   * direction from that edge. Negative distance means inside.
   *
   * Returns a shared object: this runs about a hundred thousand times during a
   * build and allocating a result each time is the whole cost.
   */
  const near = { d: Infinity, nx: 0, nz: 1 };
  const nearest = (x, z) => {
    near.d = Infinity; near.nx = 0; near.nz = 1;

    const bucket = grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!bucket) return near;   // nothing within reach: open ground

    for (let i = 0; i < bucket.length; i++) {
      const e = exclusions[bucket[i]];
      const dx = x - e.x, dz = z - e.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const edge = dist - e.r;
      if (edge < near.d) {
        near.d = edge;
        const inv = dist > 1e-4 ? 1 / dist : 0;
        near.nx = dx * inv;
        near.nz = dz * inv;
      }
    }
    return near;
  };

  // ---- the swept lane -------------------------------------------------------
  //
  // Traffic clears a path, and the path is not something the caller has to
  // describe: it is the medial axis of the open space, which the exclusion
  // field already encodes. For each z, walk across the field and keep the x
  // with the largest clearance. That tracks the middle of the avenue and keeps
  // tracking it if the architecture moves.
  //
  // The axis is built as a CONTINUOUS walk rather than an independent maximum
  // per row, because a per-row maximum is not a path. One keep-out disc sitting
  // on the centre line splits the row and the winning x jumps to whichever side
  // won by a centimetre, which shows up in the frame as a swept strip that
  // teleports sideways for a few metres and then teleports back. Feet do not do
  // that, so the search window is limited to how far a path can wander per
  // metre and the pass is seeded from the most open row in the field.

  const BINS = 56;
  const AXIS_WANDER = 1.6;    // metres of sideways drift allowed per bin
  const axisX = new Float32Array(BINS);
  const axisR = new Float32Array(BINS);
  const axisBin = (z) => {
    const t = ((z - lo) / (hi - lo)) * BINS;
    return t < 0 ? 0 : t >= BINS ? BINS - 1 : t | 0;
  };

  const binZ = (i) => lerp(lo, hi, (i + 0.5) / BINS);

  /**
   * Best x in a window, by clearance, with a weak pull toward the field centre
   * so that a fully open row does not nominate an arbitrary corner as the
   * footpath. Clearance is clamped, or open ground ties at Infinity everywhere
   * and the pull never gets to break the tie.
   */
  const scanRow = (z, from, to) => {
    let bestX = centre.x, bestScore = -Infinity, bestD = 0;
    for (let x = from; x <= to; x += 0.75) {
      const d = Math.min(nearest(x, z).d, DRIFT_REACH + 8);
      const score = d - Math.abs(x - centre.x) * 0.12;
      if (score > bestScore) { bestScore = score; bestX = x; bestD = d; }
    }
    return { x: bestX, d: bestD };
  };

  // Seeded at the caller's declared density centre rather than at the most open
  // row in the field. The most open row is usually a corner with no
  // architecture in it at all, and a path started there wanders in from the
  // side and never finds the avenue.
  const seedBin = axisBin(centre.z);
  for (let i = 0; i < BINS; i++) {
    const row = scanRow(binZ(i), lo, hi);
    axisX[i] = row.x;
    axisR[i] = row.d;
  }

  // Then walk outward from it in both directions, each row only allowed to
  // wander a little from the row before.
  for (const dir of [-1, 1]) {
    for (let i = seedBin + dir; i >= 0 && i < BINS; i += dir) {
      const prev = axisX[i - dir];
      const row = scanRow(binZ(i), prev - AXIS_WANDER, prev + AXIS_WANDER);
      axisX[i] = row.x;
      axisR[i] = row.d;
    }
  }

  // ---- drift weight ---------------------------------------------------------

  const HOLLOW_D = 2.2;

  /**
   * How much debris a square metre of ground deserves, in 0..1.
   *
   * Three terms, in descending order of how much they change the frame:
   *
   *  bank   - loose material piles against anything that stops the wind, and
   *           deeper on the lee face than the windward one.
   *  hollow - a positive laplacian of the dune height is a dish, and a dish is
   *           where everything loose on a slope ends up.
   *  swept  - feet clear the middle of the open space. This is the term that
   *           makes the avenue read as walked rather than abandoned.
   *
   * The constant floor keeps a thin scatter of genuine litter everywhere, or
   * the drift stops reading as accumulation and starts reading as a stencil. It
   * is deliberately high: the first cut ran it at 0.11 and open ground came out
   * bare, because a floor that low means the best-of-N fallback below almost
   * never settles for open ground and every instance migrates to a wall.
   */
  const driftWeight = (x, z, pad) => {
    const q = nearest(x, z);
    if (q.d < pad) return 0;

    const lee = 0.5 + 0.5 * (q.nx * DRIFT_X + q.nz * DRIFT_Z);
    const bank = Math.exp(-Math.max(0, q.d) / DRIFT_BAND) * (0.3 + 0.7 * lee);

    const h = heightAt(x, z);
    const dip = (heightAt(x - HOLLOW_D, z) + heightAt(x + HOLLOW_D, z)
               + heightAt(x, z - HOLLOW_D) + heightAt(x, z + HOLLOW_D)) * 0.25 - h;
    const hollow = clamp01(0.45 + dip * 1.7);

    // Width is a footpath, NOT the corridor. The first cut of this used the
    // measured clearance as the denominator, which in a 30-metre avenue swept a
    // 20-metre strip and emptied the entire foreground: correct behaviour,
    // applied at the wrong scale. What wears a path clear is people walking
    // abreast, and that is a handful of metres however wide the space is.
    const bin = axisBin(z);
    // Clamped low as well as high: where the axis squeezes past an obstacle the
    // measured clearance goes to nothing or negative, and an unguarded divide
    // there would either sweep the whole row or none of it.
    const half = Math.min(Math.max(axisR[bin], 1.0), LANE_HALF);
    const lane = Math.abs(x - axisX[bin]) / half;
    const swept = 0.18 + 0.82 * smoothstep(0.30, 1.0, lane);

    return clamp01((0.30 + 1.5 * bank + 0.5 * hollow) * swept);
  };

  /**
   * Sample one position with density falling off from the play centre, then
   * accept it against the drift weight.
   *
   * Radius is drawn as `R * u^falloff`. At falloff 0.5 that is a uniform disc;
   * anything above biases samples inward, so areal density decays as
   * r^(1/falloff - 2). Detail is only worth paying for where the camera
   * actually is, and an instance 90 units out is a wasted matrix.
   *
   * The best-so-far fallback matters: in the swept lane almost nothing is
   * accepted, and returning null there would quietly hand the budget back
   * instead of spending it on the banks where it belongs.
   */
  const place = (falloff, squash, pad) => {
    let best = null, bestW = 0;

    for (let tries = 0; tries < 16; tries++) {
      const a = rand() * TAU;
      const r = radius * Math.pow(rand(), falloff);
      const x = centre.x + Math.cos(a) * r;
      const z = centre.z + Math.sin(a) * r * squash;

      if (x < lo || x > hi || z < lo || z > hi) continue;

      const w = driftWeight(x, z, pad);
      if (w <= 0) continue;

      const spot = { x, z, d: Math.hypot(x - centre.x, z - centre.z), lead: false, tuck: 0 };
      if (rand() < w) return spot;
      if (w > bestW) { bestW = w; best = spot; }
    }
    return best;
  };

  /**
   * One deposit: a lead piece with a tail of smaller material fanned off its
   * lee side.
   *
   * This is the other half of the "stickers" problem. Individually placed props
   * read as individually placed however well each one is bedded in; a lead
   * stone with its own gravel apron reads as something that got there. Member
   * radius is drawn as `u^2` so the tail packs hard against the lead and thins
   * out, and the whole cloud is pushed downwind of the seed.
   */
  const deposit = (sx, sz, spread, n, pad, out) => {
    for (let i = 0; i < n; i++) {
      if (i === 0) {
        if (nearest(sx, sz).d < pad) continue;
        out.push({ x: sx, z: sz, d: Math.hypot(sx - centre.x, sz - centre.z), lead: true, tuck: 0 });
        continue;
      }

      // The 0.14 floor is not cosmetic. Drawing the radius as a bare u^2 puts
      // the median member a few centimetres from the lead piece, and stones the
      // same size as that gap interpenetrate into one shaded blob instead of
      // reading as separate stones. The exponent still packs the deposit; the
      // floor keeps the members from occupying each other.
      const rr = spread * (0.14 + 0.86 * Math.pow(rand(), 1.7));
      const a = rand() * TAU;
      const x = sx + Math.cos(a) * rr + DRIFT_X * rr * 0.6;
      const z = sz + Math.sin(a) * rr + DRIFT_Z * rr * 0.6;

      if (x < lo || x > hi || z < lo || z > hi) continue;
      if (nearest(x, z).d < pad) continue;

      out.push({
        x, z,
        d: Math.hypot(x - centre.x, z - centre.z),
        lead: false,
        tuck: clamp01(1 - rr / spread),
      });
    }
  };

  /**
   * Power-law size. Real debris fields are not uniform in size, they are scale
   * free: an order of magnitude more gravel than cobbles, an order of magnitude
   * more cobbles than boulders. A uniform or mildly skewed distribution gives
   * every instance roughly the same silhouette area, which is exactly the
   * "one scale tier" tell the architecture pass spent its time removing.
   */
  const powerSize = (min, max, alpha, u) =>
    Math.min(max, min * Math.pow(1 - Math.min(u, 0.999), -1 / alpha));

  /**
   * Surface normal from a central difference on the same height function the
   * dune mesh was built from. Props tilted to the slope sit on the ground;
   * props left plumb on a slope look pushed into it.
   */
  const tilt = new THREE.Vector3();
  const groundNormal = (x, z) => {
    const d = 0.7;
    return tilt.set(
      (heightAt(x - d, z) - heightAt(x + d, z)) / (2 * d),
      1,
      (heightAt(x, z - d) - heightAt(x, z + d)) / (2 * d)
    ).normalize();
  };

  // -------------------------------------------------------------------------
  // layers
  // -------------------------------------------------------------------------

  // `share` sums to 1 and divides the budget. `falloff` and `pad` feed the
  // sampler above. `write` fills one instance matrix and returns nothing; it is
  // the only place a prop kind's proportions and burial depth are decided.
  //
  // The deposit fields are what turn a budget into a debris field rather than a
  // point cloud: `cluster` is the fraction of the budget spent inside deposits,
  // `spread` and `perDeposit` size them, and `apron` is the fraction of those
  // deposits that seed on an already-placed larger prop instead of on fresh
  // ground. `anchor` marks a layer whose instances later layers may apron onto.
  //
  // Order matters here and is not cosmetic: layers are built as listed, largest
  // first, so the small stuff has anchors to collect around by the time it runs.
  const scratch = {
    m: new THREE.Matrix4(),
    q: new THREE.Quaternion(),
    q2: new THREE.Quaternion(),
    e: new THREE.Euler(),
    p: new THREE.Vector3(),
    s: new THREE.Vector3(),
    c: new THREE.Color(),
  };

  const layers = [
    {
      name: 'blocks',
      share: 0.011,
      falloff: 0.95,
      pad: 1.6,
      shadow: true,
      anchor: true,
      // A wall does not shed one block. It sheds a course, and the course
      // lands in a heap, so almost all of these are placed as small collapses.
      cluster: 0.7, spread: 2.8, perDeposit: 3, apron: 0,
      geometry: blockGeometry(),
      material: materials.block,

      write(out, x, z, spot) {
        // Kept blocky rather than slabby. A wide flat box lying on sand reads
        // as a hatch or a crate, not as a piece of fallen masonry.
        const size = powerSize(0.50, 1.85, 1.9, rand()) * (spot.lead ? 1.2 : 0.85);
        out.s.set(size * lerp(0.8, 1.3, rand()),
                  size * lerp(0.6, 1.05, rand()),
                  size * lerp(0.8, 1.3, rand()));

        out.q.setFromUnitVectors(UP, groundNormal(x, z));
        out.e.set(lerp(-0.20, 0.20, rand()), rand() * TAU, lerp(-0.20, 0.20, rand()), 'YXZ');
        out.q.multiply(out.q2.setFromEuler(out.e));

        // Deliberately more than half buried, and by a spread rather than a
        // constant: a run of blocks all showing the same freeboard is a row of
        // stepping stones. These carry no collider either, so anything tall
        // enough to notice walking through it is a bug.
        const sink = clamp01(lerp(0.30, 0.80, Math.pow(rand(), 0.8))
                             + smoothstep(0.7, 1.8, size) * 0.12);
        out.p.set(x, heightAt(x, z) + out.s.y * (0.5 - sink), z);
      },

      colour(c) {
        c.setHSL(lerp(0.075, 0.105, rand()),
                 lerp(0.14, 0.30, rand()),
                 lerp(0.50, 0.84, rand()));
      },
    },

    {
      name: 'drums',
      share: 0.006,
      falloff: 1.0,
      pad: 1.8,
      shadow: true,
      anchor: true,
      // A toppled shaft breaks into drums that stay roughly where they rolled,
      // so they come in short lines rather than singly.
      cluster: 0.6, spread: 3.4, perDeposit: 2, apron: 0.3,
      geometry: drumGeometry(),
      material: materials.block,

      write(out, x, z, spot) {
        const size = powerSize(0.75, 2.0, 2.6, rand()) * (spot.lead ? 1.1 : 0.9);
        out.s.set(size, size * lerp(0.5, 0.9, rand()), size);

        // Toppled, so they lie on their side across the slope. An upright drum
        // is a plinth; a fallen one is a ruin.
        const fallen = rand() < 0.72;
        out.q.setFromUnitVectors(UP, groundNormal(x, z));
        out.e.set(fallen ? Math.PI / 2 + lerp(-0.2, 0.2, rand()) : lerp(-0.1, 0.1, rand()),
                  rand() * TAU, rand() * TAU, 'YXZ');
        out.q.multiply(out.q2.setFromEuler(out.e));

        out.p.set(x, heightAt(x, z) - size * lerp(0.08, 0.42, rand()), z);
      },

      colour(c) {
        c.setHSL(lerp(0.075, 0.105, rand()),
                 lerp(0.13, 0.28, rand()),
                 lerp(0.52, 0.88, rand()));
      },
    },

    {
      name: 'bones',
      share: 0.055,
      falloff: 0.78,
      pad: 0.4,
      shadow: true,
      // Bone comes from one carcass at a time, so a scatter of splinters in one
      // spot and nothing for ten metres either side.
      cluster: 0.62, spread: 1.5, perDeposit: 5, apron: 0.3,
      geometry: boneGeometry(),
      material: materials.bone,

      write(out, x, z, spot) {
        const len = powerSize(0.20, 0.80, 2.8, rand()) * (spot.lead ? 1.15 : 0.9);
        out.s.set(len * lerp(0.5, 0.9, rand()), len, len * lerp(0.5, 0.9, rand()));

        // Laid down, not standing. A bone shaft standing on end reads as a
        // spawn bug, not as a bone.
        out.q.setFromUnitVectors(UP, groundNormal(x, z));
        out.e.set(Math.PI / 2 + lerp(-0.25, 0.25, rand()), rand() * TAU,
                  rand() * TAU, 'YXZ');
        out.q.multiply(out.q2.setFromEuler(out.e));

        // Some are drifted over: a shaft with its middle under the sand reads
        // as older than the same shaft lying clean on top of it.
        const sink = lerp(-0.05, 0.09, Math.pow(rand(), 0.7) + spot.tuck * 0.25);
        out.p.set(x, heightAt(x, z) + len * (0.06 - sink), z);
      },

      colour(c) {
        // Sun-bleached, barely saturated, and always lighter than the sand it
        // sits on so a fragment is legible at ten metres.
        c.setHSL(lerp(0.09, 0.14, rand()),
                 lerp(0.04, 0.15, rand()),
                 lerp(0.52, 0.86, rand()));
      },
    },

    {
      name: 'sherds',
      share: 0.11,
      falloff: 0.72,
      pad: 0.4,
      shadow: true,
      // One pot breaks in one place. This is the layer where clustering is not
      // a stylistic choice but the literal physics of the object.
      cluster: 0.78, spread: 1.0, perDeposit: 7, apron: 0.45,
      geometry: sherdGeometry(),
      material: materials.sherd,

      write(out, x, z, spot) {
        const size = powerSize(0.15, 0.70, 2.4, rand()) * (spot.lead ? 1.2 : 0.85);
        out.s.set(size, size * lerp(0.7, 1.2, rand()), size * lerp(0.8, 1.3, rand()));

        // Lie roughly with the ground, then tip over by a random amount: a
        // broken pot leaves shards on their face, their back, and their edge.
        out.q.setFromUnitVectors(UP, groundNormal(x, z));
        out.e.set(lerp(-0.9, 0.9, rand()), rand() * TAU, lerp(-0.5, 0.5, rand()), 'YXZ');
        out.q.multiply(out.q2.setFromEuler(out.e));

        // A shard is a curved plate: standing proud it is a decal, edge-down
        // in the sand it is a find. Bias the tail of each deposit downward,
        // since that is the material the drift has had longest to bury.
        const sink = lerp(-0.16, 0.20, clamp01(Math.pow(rand(), 0.8) + spot.tuck * 0.3));
        out.p.set(x, heightAt(x, z) + size * (0.18 - sink), z);
      },

      colour(c) {
        // Nile silt ware: red-brown through buff, some pieces fired darker.
        c.setHSL(lerp(0.030, 0.075, rand()),
                 lerp(0.20, 0.48, rand()),
                 lerp(0.20, 0.52, rand()));
      },
    },

    {
      name: 'scrub',
      share: 0.258,
      falloff: 0.70,
      pad: 0.7,
      shadow: true,
      sways: true,
      // Scrub does not need clustering imposed on it as hard as the mineral
      // layers do: the drift weight already puts it in the lee and the hollows,
      // which is exactly where anything living in a desert actually is.
      cluster: 0.5, spread: 2.4, perDeposit: 4, apron: 0.25,
      geometry: scrubGeometry(),
      material: materials.scrub,

      write(out, x, z, spot) {
        const h = powerSize(0.18, 0.85, 2.5, rand()) * (spot.lead ? 1.15 : 0.9);
        out.s.set(h * lerp(0.8, 1.5, rand()), h, h * lerp(0.8, 1.5, rand()));

        out.q.setFromUnitVectors(UP, groundNormal(x, z));
        out.e.set(0, rand() * TAU, 0, 'YXZ');
        out.q.multiply(out.q2.setFromEuler(out.e));

        // Roots go under. The blades are modelled from y=0 up, so the origin
        // drops just below the surface rather than resting on it, and drops
        // further for tufts sitting in the middle of a drift.
        out.p.set(x, heightAt(x, z) - h * lerp(0.04, 0.20, rand() * 0.7 + spot.tuck * 0.3), z);
      },

      colour(c) {
        // Dead, not green. Anything with real chroma in it stops reading as
        // desert immediately.
        c.setHSL(lerp(0.085, 0.145, rand()),
                 lerp(0.10, 0.30, rand()),
                 lerp(0.12, 0.30, rand()));
      },
    },

    {
      name: 'pebbles',
      share: 0.56,
      falloff: 0.66,
      pad: 0.15,
      // Contact shadow is the single strongest cue that a thing is ON the
      // ground rather than floating a millimetre above it, and the whole layer
      // is one extra draw in the shadow pass because it is instanced.
      shadow: true,
      // The heaviest clustering in the file. Gravel is the material that most
      // obviously arrives rather than appears: it washes into aprons at the
      // foot of larger stones and banks up along kerbs, and spreading it evenly
      // is what made the old field read as noise.
      cluster: 0.58, spread: 1.4, perDeposit: 7, apron: 0.4,
      geometry: pebbleGeometry(),
      material: materials.pebble,

      write(out, x, z, spot) {
        // Power law rather than a mild skew, and biased small for the tail of a
        // deposit: what surrounds a cobble is grit, not more cobbles.
        const u = spot.lead
          ? lerp(0.80, 0.99, rand())
          : Math.min(0.99, rand() * (1 - 0.4 * spot.tuck));
        // The floor is set from the old median, not below it. A power law is
        // about the ratio between tiers, not about shrinking the field: the
        // first cut of this kept the same budget but halved the median stone,
        // and the foreground went quiet even though the instance count and the
        // near-camera density were measurably unchanged. Extend the tail
        // upward instead. Same lesson applies to every other layer here.
        const size = powerSize(0.072, 0.90, 1.3, u);

        out.s.set(size * lerp(0.7, 1.3, rand()),
                  size * lerp(0.5, 0.9, rand()),
                  size * lerp(0.7, 1.3, rand()));

        // Bedded to the slope and then tipped, instead of the free tumble it
        // used to get. A stone that has come to rest has settled onto its
        // broadest face; one at a random orientation is a stone still falling.
        out.q.setFromUnitVectors(UP, groundNormal(x, z));
        out.e.set(lerp(-0.45, 0.45, rand()), rand() * TAU, lerp(-0.45, 0.45, rand()), 'YXZ');
        out.q.multiply(out.q2.setFromEuler(out.e));

        // Buried fraction, heavy-tailed toward buried, deeper for the tail of a
        // deposit. Anything from a stone sitting on the sand to a cap of one
        // showing through it. A field where every stone shows the same amount
        // of itself is a field of decals however good the stones are.
        // Burial correlates with size, and that correlation is the fix for the
        // last of the sticker read: a heavy stone settles into sand and takes a
        // drift against its lee, a chip sits on top. Left uncorrelated, the
        // biggest stones came out perched highest, which is backwards and is
        // exactly the silhouette the eye picks out first.
        const heavy = smoothstep(0.15, 0.70, size) * 0.20;
        const sink = clamp01(lerp(0.08, 0.95, Math.pow(rand(), 0.65))
                             + spot.tuck * 0.18 + heavy);
        out.p.set(x, heightAt(x, z) + out.s.y * (0.5 - sink), z);
      },

      colour(c) {
        // Desert gravel is not one tone: dark ironstone, pale chalk, and every
        // sandy value between. This spread is doing as much work as the meshes.
        c.setHSL(lerp(0.055, 0.11, rand()),
                 lerp(0.04, 0.26, rand()),
                 lerp(0.20, 0.72, Math.pow(rand(), 1.4)));
      },
    },
  ];

  // -------------------------------------------------------------------------
  // build
  // -------------------------------------------------------------------------

  const meshes = [];
  let placed = 0;
  let swaying = null;

  /**
   * Everything large already on the ground, as { x, z, r } footprints. Later
   * layers apron onto these, which is the only way small debris can look
   * deposited rather than placed: it has to be next to something.
   */
  const anchors = [];

  for (const layer of layers) {
    const budget = Math.max(1, Math.round(count * layer.share));
    const spots = [];

    // Deposits first. Each one is a lead piece plus a tail, seeded either on an
    // already-placed larger prop or on fresh ground chosen by drift weight.
    const clustered = Math.round(budget * (layer.cluster ?? 0));
    let spent = 0;
    while (spent < clustered) {
      let sx, sz, spread;

      if (anchors.length && rand() < (layer.apron ?? 0)) {
        const a = anchors[(rand() * anchors.length) | 0];
        sx = a.x; sz = a.z;
        // Apron scales with what it collects around: a fallen drum gathers a
        // wider skirt than a hand-sized block does.
        spread = a.r * lerp(1.8, 3.6, rand());
      } else {
        const s = place(layer.falloff, 0.86, layer.pad);
        if (!s) break;
        sx = s.x; sz = s.z; spread = layer.spread;
      }

      // Deposit sizes are themselves long-tailed, so the field has a few big
      // heaps and many small ones rather than a uniform stipple of clumps.
      const n = Math.min(clustered - spent,
                         2 + Math.floor(Math.pow(rand(), 1.8) * layer.perDeposit * 2));

      deposit(sx, sz, spread, n, layer.pad, spots);

      // Counted as attempted, not as landed. Counting successes lets a seed
      // whose whole tail falls inside an exclusion spin this loop forever.
      spent += n;
    }

    // The remainder as loose singles, so the drift does not read as a rule.
    for (let i = spent; i < budget; i++) {
      const s = place(layer.falloff, 0.86, layer.pad);
      if (s) spots.push(s);
    }

    // Sorted near to far. setFidelity culls by lowering .count, which always
    // drops the TAIL of the instance list, so the list has to be ordered by
    // importance or the low setting would delete random holes out of the ground
    // at the player's feet. Members of one deposit share a distance to within
    // its spread, so a cull drops whole deposits rather than gutting them.
    spots.sort((a, b) => a.d - b.d);

    const mesh = new THREE.InstancedMesh(layer.geometry, layer.material, spots.length);
    mesh.name = `scatter-${layer.name}`;
    mesh.castShadow = layer.shadow;
    mesh.receiveShadow = true;

    // Kept for the sway pass: recomposing a matrix needs the base transform,
    // and reading it back out of the instance buffer every frame is slower and
    // loses precision.
    const base = layer.sways ? new Float32Array(spots.length * 9) : null;

    for (let i = 0; i < spots.length; i++) {
      const spot = spots[i];
      layer.write(scratch, spot.x, spot.z, spot);
      scratch.m.compose(scratch.p, scratch.q, scratch.s);
      mesh.setMatrixAt(i, scratch.m);

      layer.colour(scratch.c);
      mesh.setColorAt(i, scratch.c);

      // Footprint from the scale that was just written, so an anchor's apron
      // matches the piece it forms around rather than the layer average.
      if (layer.anchor) {
        anchors.push({
          x: spot.x, z: spot.z,
          r: Math.max(scratch.s.x, scratch.s.z) * 0.5,
        });
      }

      if (base) {
        const o = i * 9;
        base[o] = scratch.p.x; base[o + 1] = scratch.p.y; base[o + 2] = scratch.p.z;
        base[o + 3] = scratch.q.x; base[o + 4] = scratch.q.y;
        base[o + 5] = scratch.q.z; base[o + 6] = scratch.q.w;
        base[o + 7] = scratch.s.y;
        base[o + 8] = rand() * TAU;   // phase, so no two tufts beat together
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    // Without this the field is culled against the bounds of a single
    // unit-sized geometry at the origin and vanishes the moment the camera
    // looks away from world zero.
    mesh.computeBoundingSphere();

    group.add(mesh);
    meshes.push({ mesh, full: spots.length });
    placed += spots.length;

    if (base) swaying = { mesh, base, count: spots.length };
  }

  // -------------------------------------------------------------------------
  // life
  // -------------------------------------------------------------------------

  // Only the tufts move. Rebuilding a few hundred matrices is cheap; doing it
  // for every pebble as well would be a few thousand per frame for motion
  // nobody can see on a rock.
  const swayQ = new THREE.Quaternion();
  const swayBase = new THREE.Quaternion();
  const swayP = new THREE.Vector3();
  const swayS = new THREE.Vector3();
  const swayM = new THREE.Matrix4();

  const SWAY_STEP = 1 / 24;   // wind does not need the full frame rate
  let swayAccum = 0;

  return {
    group,

    /** Total instances actually placed, after exclusions rejected candidates. */
    count: placed,

    update(dt, t) {
      if (!swaying) return;

      swayAccum += dt;
      if (swayAccum < SWAY_STEP) return;
      swayAccum = 0;

      const { mesh, base, count: n } = swaying;
      for (let i = 0; i < n; i++) {
        const o = i * 9;
        const phase = base[o + 8];

        // Two rates: a slow gust envelope over a faster flutter, so the field
        // breathes instead of ticking in unison.
        const gust = 0.55 + 0.45 * Math.sin(t * 0.53 + phase * 0.31);
        const lean = (0.05 + 0.07 * Math.sin(t * 2.1 + phase)) * gust;

        swayBase.set(base[o + 3], base[o + 4], base[o + 5], base[o + 6]);
        swayQ.setFromAxisAngle(WIND_AXIS, -lean).multiply(swayBase);

        swayP.set(base[o], base[o + 1], base[o + 2]);
        const s = base[o + 7];
        swayS.set(s, s, s);

        swayM.compose(swayP, swayQ, swayS);
        mesh.setMatrixAt(i, swayM);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },

    /**
     * Lowering .count is the cheap cull: the instances are still resident, but
     * the draw stops early. Because the lists are sorted near to far, what
     * disappears is the distant half, which is what the frame can most afford
     * to lose.
     */
    setFidelity(high) {
      for (const m of meshes) m.mesh.count = high ? m.full : Math.round(m.full * 0.45);
    },

    dispose() {
      for (const m of meshes) {
        m.mesh.dispose();
        m.mesh.geometry.dispose();
      }
      for (const mat of Object.values(materials)) mat.dispose();
      group.removeFromParent();
    },
  };
}

// ---------------------------------------------------------------------------
// prop geometry
//
// One geometry per kind, all authored around a unit size so the per-instance
// scale is the only thing that decides how big a given prop ends up.
// ---------------------------------------------------------------------------

/** A stone. Eroded so it is a rock and not a Platonic solid. */
function pebbleGeometry() {
  const geo = new THREE.IcosahedronGeometry(0.5, 0);
  erode(geo, 0.11, 5.4, 17);
  return geo;
}

/**
 * A potsherd: a piece of a pot wall, so a curved strip with a broken outline
 * and no thickness at all. Thickness would be invisible at this size and would
 * triple the vertex count of the densest non-pebble layer.
 */
function sherdGeometry() {
  const RIBS = 6;
  const ARC = 1.45;          // radians of the original pot circumference
  const R = 0.62;

  const pos = [];
  const idx = [];

  for (let i = 0; i <= RIBS; i++) {
    const t = i / RIBS;
    const th = (t - 0.5) * ARC;

    // Two decorrelated sines give a ragged break line down both edges, which
    // is the whole difference between a shard and a rounded tile.
    const wA = 0.30 * (0.55 + 0.45 * Math.sin(t * 7.7 + 0.6)) * (1 - 0.45 * t * t);
    const wB = 0.30 * (0.55 + 0.45 * Math.sin(t * 5.3 + 2.4)) * (1 - 0.30 * t * t);

    const cx = Math.sin(th) * R;
    const cy = (Math.cos(th) - 1) * R * 0.55;

    pos.push(cx, cy, -wA);
    pos.push(cx, cy, wB);
  }

  for (let i = 0; i < RIBS; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** A splinter of long bone: tapered, irregular, and coarse enough to facet. */
function boneGeometry() {
  const geo = new THREE.CylinderGeometry(0.062, 0.040, 1, 5, 3);
  // Heavy relative to the radius on purpose: an unbroken tapered cylinder at
  // this size reads as a length of pipe.
  erode(geo, 0.055, 7.5, 41);
  return geo;
}

/**
 * A tuft of dried scrub: a handful of crossed tapered blades springing from one
 * root, each bending away from vertical. Crossed strips are the standard trick
 * because a tuft has to read from every angle, and a single billboard collapses
 * to a line as soon as you walk around it.
 */
function scrubGeometry() {
  const BLADES = 9;
  const RIBS = 3;

  const pos = [];
  const idx = [];
  let v = 0;

  for (let b = 0; b < BLADES; b++) {
    // Golden-angle spacing so no two blades stack up even at seven of them.
    const a = b * 2.39996;
    const bend = 0.40 + ((b * 37) % 11) / 11 * 0.65;
    const len = 0.65 + ((b * 53) % 7) / 7 * 0.5;
    const dirX = Math.cos(a), dirZ = Math.sin(a);

    for (let i = 0; i <= RIBS; i++) {
      const t = i / RIBS;
      // Blades arc outward as they rise and taper to nothing at the tip.
      const out = bend * t * t * len;
      const y = len * t * (1 - 0.3 * t);
      // Narrow. A wide blade reads as a succulent, and a succulent in this
      // scene reads as a houseplant someone left in the desert.
      const w = 0.028 * (1 - t) * (1 - t * 0.4);

      pos.push(dirX * out - dirZ * w, y, dirZ * out + dirX * w);
      pos.push(dirX * out + dirZ * w, y, dirZ * out - dirX * w);
    }

    for (let i = 0; i < RIBS; i++) {
      const p = v + i * 2;
      idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
    }
    v += (RIBS + 1) * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** A dressed block, chamfered and knocked about, unit sized. */
function blockGeometry() {
  const geo = chamferedBox(1, 1, 1, 0.06, DENSITY.rubble);
  erode(geo, 0.075, 2.9, 5);
  return geo;
}

/** A column drum, broken off a shaft that is no longer standing. */
function drumGeometry() {
  const geo = cylinderUV(
    new THREE.CylinderGeometry(0.47, 0.5, 0.62, 14), 0.5, 0.62, DENSITY.rubble);
  erode(geo, 0.035, 3.4, 23);
  return geo;
}
