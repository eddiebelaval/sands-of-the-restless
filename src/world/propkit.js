/**
 * The prop kit: the two scale tiers the scene does not have.
 *
 * THE DIAGNOSIS THIS MODULE EXISTS TO ANSWER.
 *
 * The courtyard does not read as "Minecraft" because it is blocky. Our
 * chamfered box and the reference project's box are the same primitive at the
 * same triangle count. It reads wrong for four reasons, and only the fourth is
 * about geometry quality:
 *
 *   1. Everything is at ONE scale. The scatter field spends its entire 6,200
 *      instance budget on pebbles, and the architecture is all 8 m and up.
 *      Nothing lives in the 0.4 m to 2.5 m band a person could touch.
 *   2. Nothing overlaps anything else. Every object sits alone on the sand
 *      with clean air around it, which is what an object browser looks like,
 *      not what a place looks like.
 *   3. Nothing THIN is ever in frame. A rope, a railing, a shutter slat, a
 *      grille bar: none of it exists in our build. Thin geometry is what
 *      breaks a silhouette into readable depth layers, and its absence is
 *      why every frame reads as a handful of big solids.
 *   4. There is no enclosure.
 *
 * This module owns (1) and (3). The enclosure and the placement are somebody
 * else's file; every builder here is written to be positioned by a placer that
 * knows where the walls are.
 *
 * CONTRACT. Every builder is `(rand, opts) => { group, colliders }`:
 *   - `rand` is a seeded PRNG returning [0, 1). Every builder consumes it for
 *     dimensions, rotation, tilt, damage and colour, because the
 *     identical-clone read is the loudest tell in a prop cloud and the fix has
 *     to be structural, not a placement-time afterthought.
 *   - `group` is a THREE.Group with its origin at ground level (or, for
 *     wall-mounted props, at the centre of the mounting face), built up +Y.
 *   - `colliders` are `{ x, z, r, h }` cylinders in LOCAL space. The placer
 *     offsets and rotates them into the world array. Same representation the
 *     courtyard already uses, so collision keeps exactly one form in the
 *     codebase.
 *
 * CHAMFER POLICY. `blockMesh` routes on the smallest dimension of the member:
 * anything at or above CHAMFER_FLOOR (8 cm) gets a `chamferedBox`, anything
 * below gets a plain `box` from uv.js. The reasoning is the same one that
 * justified the chamfer in the first place, run in the other direction: a
 * chamfer sells an edge because it catches a bright line of light, and on a
 * 4 cm baluster a proportional 2 mm chamfer subtends well under a pixel at
 * arm's length. It would cost 44 triangles instead of 12 and return nothing.
 * The level wants baluster-scale members in the hundreds, so that ratio is the
 * whole budget. Every box in this file still goes through a world-scale UV
 * helper: a raw BoxGeometry would take one texture tile stretched to whatever
 * size it happens to be.
 *
 * MATERIALS. The shared registry is used for stone, gold, cloth-adjacent linen
 * and embers. Everything else the necropolis needs (timber, fired clay, awning
 * canvas, sackcloth, iron, cordage, mudbrick, military drab, reed) is owned
 * here as small tone LADDERS: four or five pre-built materials per family, one
 * picked per part per instance. Ladders rather than per-instance clones because
 * cloning a material per prop would defeat batching and multiply draw calls,
 * and a single flat colour per family is exactly the uniformity being fixed.
 */

import * as THREE from 'three';
import { chamferedBox, erode } from './geometry.js';
import { box, plane, cylinderUV } from './uv.js';
import { buildMaterials } from './materials.js';

const TAU = Math.PI * 2;

/**
 * Below this, a chamfer is invisible and only costs triangles. See the chamfer
 * policy in the module header.
 */
const CHAMFER_FLOOR = 0.08;

/**
 * Tiles per world unit, per material family.
 *
 * These are far higher than the courtyard's, and deliberately: the courtyard
 * runs limestone at 0.17 because one masonry course per metre is right for a
 * wall. A 50 cm crate at 0.17 gets a twelfth of a tile, which is one flat
 * smear of colour. Prop-scale surfaces need prop-scale grain.
 */
const DENSITY = {
  timber: 1.1,
  clay: 1.4,
  cloth: 0.8,
  cord: 2.4,
  metal: 1.6,
  brick: 1.2,
  stone: 0.55,
  sack: 1.0,
};

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;

/** Uniform in [a, b). */
const rr = (rand, a, b) => a + (b - a) * rand();

/** Symmetric jitter in [-amt, amt). */
const jit = (rand, amt) => (rand() - 0.5) * 2 * amt;

/** One element of an array. Used to draw a tone off a material ladder. */
const pick = (rand, arr) => arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];

/** rand() < p, spelled out so damage rolls read as intent at the call site. */
const chance = (rand, p) => rand() < p;

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

let matCache = null;

/**
 * Tone ladder: N materials that differ only in colour, so a stack of crates is
 * made of boards from different trees rather than one extruded colour.
 */
function ladder(hexes, opts) {
  return hexes.map((h) => new THREE.MeshStandardMaterial({ color: h, ...opts }));
}

/**
 * The prop palette. Registry materials are pulled in by reference so tuning
 * the stone in materials.js still tunes the stone here.
 *
 * Note the registry materials carry the world-space weathering injection,
 * which is correct for these props: they are ordinary Meshes at real world
 * positions, so the height-based grime gradient lands where it should. That is
 * the opposite of scatter.js, which had to own untextured copies because an
 * InstancedMesh samples that shader at one local position for every instance.
 */
export function propMaterials() {
  if (matCache) return matCache;
  const M = buildMaterials();

  matCache = {
    // Registry, by reference.
    limestone: M.limestone,
    carved: M.carved,
    granite: M.granite,
    gold: M.gold,
    linen: M.linen,
    ember: M.ember,

    // Dry desert timber: acacia and palm, some of it sun-bleached grey, some
    // of it oiled dark by handling.
    timber: ladder([0x6a5334, 0x7d6442, 0x54402a, 0x8a7150, 0x63513a],
      { roughness: 0.92, metalness: 0.0 }),

    // Nile silt ware, matching the potsherd hue range in scatter.js so a
    // broken jar and the shards around it come from the same kiln.
    // DoubleSide because every vessel here is open at the mouth, and a
    // single-sided lathe shows the world through it.
    clay: ladder([0x9b5f3e, 0xa87050, 0x8a5236, 0xb08765, 0x7d4a30],
      { roughness: 0.86, metalness: 0.0, side: THREE.DoubleSide }),

    // Awning and banner canvas. Bleached linen through ochre, dust grey, faded
    // madder and a washed-out indigo: the only chroma allowed into the frame,
    // and all of it knocked back so it sits in the sand palette.
    cloth: ladder([0xcfc2a4, 0xc9a86a, 0x8f7f6a, 0xb5654a, 0x7a7f86],
      { roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide }),

    // Flat shaded on purpose. A smooth-shaded sack is a beach ball: the whole
    // read of coarse jute over loose grain is in the facets, and at 40 cm the
    // faceting is exactly the right frequency.
    sack: ladder([0x8b7856, 0x7a6a4a, 0x9a8a66],
      { roughness: 0.99, metalness: 0.0, flatShading: true }),

    // Two irons: blued and rusted. Metalness is kept well under 1 deliberately.
    // A fully metallic surface has no diffuse response at all, so with no
    // environment map it renders BLACK, and this project's environment is an
    // optional HDRI that the procedural path runs without. Wrought iron in
    // desert sun is dark, not a silhouette.
    iron: [
      new THREE.MeshStandardMaterial({ color: 0x4c5055, roughness: 0.62, metalness: 0.45 }),
      new THREE.MeshStandardMaterial({ color: 0x7a5238, roughness: 0.90, metalness: 0.12 }),
    ],

    // Cordage. DoubleSide because the netting is built from flat ribbons.
    cord: ladder([0xb3a077, 0x9d8a63, 0xc2b191],
      { roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide }),

    mudbrick: ladder([0x9d7c55, 0x8a6b48, 0xab8b63, 0x7d5f40],
      { roughness: 1.0, metalness: 0.0 }),

    // The occupation. Olive drab is the one hue in the scene that is not
    // weathered earth, which is exactly why it reads as intrusion.
    drab: ladder([0x4e5340, 0x5c6149, 0x424635],
      { roughness: 0.78, metalness: 0.08 }),

    // Smooth, unlike the grain sacks. A sandbag is packed tight and its
    // surface really is fairly smooth; flat shading at the segment count an
    // emplacement can afford turned the wall into a stack of faceted discs.
    // The irregularity has to come from the silhouette instead.
    sandbag: ladder([0x9a8f6d, 0x8a8060, 0xa89d78],
      { roughness: 0.99, metalness: 0.0 }),

    // Cut reed, not fresh. The first pass ran it pale enough that a rolled mat
    // in sunlight read as a length of white plastic pipe.
    reed: ladder([0xa89055, 0x94804a, 0xbca774],
      { roughness: 0.97, metalness: 0.0, side: THREE.DoubleSide, flatShading: true }),

    // Standing water in a trough: dark, smooth, and the only low-roughness
    // horizontal surface at ground level, so it catches the sky and reads wet.
    water: new THREE.MeshStandardMaterial({
      color: 0x2b3a33, roughness: 0.09, metalness: 0.0,
    }),
  };

  return matCache;
}

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

/**
 * A box member, chamfered or not depending on how thin it is.
 *
 * This is the single place the chamfer policy is decided, so no call site has
 * to remember it and no thin member accidentally costs 44 triangles.
 */
function blockMesh(w, h, d, mat, tilesPerUnit, {
  chamfer = null,
  eroded = 0,
  erodeScale = 3.0,
  seed = 1,
  cast = true,
  receive = true,
} = {}) {
  const min = Math.min(w, h, d);
  const wantsChamfer = chamfer !== false && min >= CHAMFER_FLOOR;

  let geo;
  if (wantsChamfer) {
    const c = typeof chamfer === 'number' ? chamfer : Math.min(0.05, min * 0.16);
    geo = chamferedBox(w, h, d, c, tilesPerUnit);
  } else {
    geo = box(w, h, d, tilesPerUnit);
  }

  if (eroded > 0) erode(geo, eroded, erodeScale, seed);

  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/** A cylinder with world-scale UVs. Radial segment count is caller's budget. */
function tube(rTop, rBot, h, seg, mat, tilesPerUnit, { cast = true } = {}) {
  const geo = cylinderUV(
    new THREE.CylinderGeometry(rTop, rBot, h, seg), Math.max(rTop, rBot), h, tilesPerUnit);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

/**
 * Scale a TubeGeometry's UVs to world units.
 *
 * cylinderUV cannot be reused here: a CylinderGeometry maps circumference to u
 * and height to v, and a TubeGeometry maps length to u and circumference to v.
 * The two conventions are transposed, so sharing the helper would stretch every
 * rope by its own aspect ratio.
 */
function tubeUV(geo, length, radius, tilesPerUnit) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;

  const su = length * tilesPerUnit;
  const sv = TAU * radius * tilesPerUnit;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);

  uv.needsUpdate = true;
  return geo;
}

/**
 * Solve the catenary parameter `a` for a span and a sag.
 *
 * sag = a * (cosh(span / 2a) - 1), which is monotonically DECREASING in a
 * (larger a is a stiffer, flatter line), so a bisection converges without any
 * derivative work. Sixty halvings is far more than float64 needs and costs
 * nothing at build time.
 */
function catenaryA(span, sag) {
  const flat = span * 1e3;
  if (!(sag > 1e-4) || span < 1e-5) return flat;

  let lo = 1e-4, hi = flat;
  for (let i = 0; i < 60; i++) {
    const a = (lo + hi) * 0.5;
    const s = a * (Math.cosh(span / (2 * a)) - 1);
    if (s > sag) lo = a; else hi = a;
  }
  return (lo + hi) * 0.5;
}

/**
 * The curve a hanging line actually takes.
 *
 * This matters more than it sounds. A slung line is one of the strongest depth
 * cues available in a frame: it crosses the whole space, it passes in front of
 * things at one end and behind them at the other, and it tells the eye how far
 * apart the two anchors are. But a straight line between two points reads as a
 * stick, not as a rope, and the difference is entirely in the cosh. Lerping the
 * endpoints and dropping a parabola in the middle is close, and still reads
 * subtly wrong at the anchors, where a real catenary leaves at a steeper angle.
 *
 * The vertical offset is added to the straight chord rather than solved for
 * unequal anchor heights. For level anchors that is exact; for a metre of
 * height difference over a six metre span the error is under a centimetre.
 *
 * @param {THREE.Vector3} from
 * @param {THREE.Vector3} to
 * @param {number} sag  how far the midpoint hangs below the chord, in metres
 */
export function catenaryCurve(from, to, sag, segments = 20) {
  const span = Math.hypot(to.x - from.x, to.z - from.z);
  const a = catenaryA(span, sag);
  const half = span * 0.5;
  const top = a * Math.cosh(half / a);

  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = from.clone().lerp(to, t);
    const u = t * span - half;
    p.y += a * Math.cosh(u / a) - top;
    pts.push(p);
  }

  // Centripetal parameterisation: the uniform variant overshoots on the tight
  // curvature at the low point of a deep sag and puts a visible kink in it.
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

/**
 * A hanging line as tube geometry. The reason this is exported rather than
 * kept private: slung lines across a space are the single cheapest depth cue
 * we are missing, and the placer will want to run them wall to wall, not just
 * inside the props here.
 */
export function catenary(from, to, sag, {
  radius = 0.022,
  segments = 20,
  radialSegments = 4,
  tilesPerUnit = DENSITY.cord,
} = {}) {
  const curve = catenaryCurve(from, to, sag, segments);
  const geo = new THREE.TubeGeometry(curve, segments, radius, radialSegments, false);
  return tubeUV(geo, curve.getLength(), radius, tilesPerUnit);
}

/**
 * A cloth sheet pinned at its corners and sagging in both axes, lying in the
 * XZ plane. Awnings, tarpaulins, draped covers.
 *
 * The product of two half-sines is the cheapest surface with the right
 * property: zero at every edge, maximum in the middle. The ripple term keeps
 * two awnings from being the same shape at different sizes.
 */
export function saggedSheet(w, d, {
  sag = 0.18,
  segs = 8,
  tilesPerUnit = DENSITY.cloth,
  ripple = 0.04,
  seed = 1,
} = {}) {
  const geo = plane(w, d, segs, tilesPerUnit);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / w + 0.5;
    const v = pos.getY(i) / d + 0.5;
    const s = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    const r = Math.sin(u * 9.1 + seed) * Math.cos(v * 7.3 - seed * 1.7) * ripple;
    pos.setZ(i, -(sag * s + r * s));
  }

  pos.needsUpdate = true;

  // PlaneGeometry is authored in XY with +Z normal; rotating -90 about X puts
  // local +Z on world +Y, so the displacement above becomes real downward sag.
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A cloth sheet hanging from its top edge, in the XY plane, with the top edge
 * at y = 0 so the caller can pin it straight onto a rail.
 *
 * The hem is torn rather than straight. A perfectly horizontal bottom edge on
 * a hanging cloth is the same tell as a perfectly sharp box edge: it is the
 * one thing textiles never do.
 */
export function hangingCloth(w, h, {
  segs = 10,
  wave = 0.06,
  tatter = 0.10,
  tilesPerUnit = DENSITY.cloth,
  seed = 1,
} = {}) {
  const geo = plane(w, h, segs, tilesPerUnit);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = x / w + 0.5;
    const v = y / h + 0.5;   // 0 at the hem, 1 at the rail

    // The fold amplitude grows downward: the cloth is pinned at the top and
    // free at the bottom, so that is where it can move.
    const fold = Math.sin(u * Math.PI * 3.0 + seed) * wave * (1 - v);
    pos.setZ(i, fold);

    if (v < 0.001) {
      // Three decorrelated frequencies, not one. A single sine at low segment
      // count produced an even sawtooth, which reads as a pennant fringe: the
      // one thing a rotted hem never is, is periodic.
      const t = 0.5
        + 0.28 * Math.sin(u * 23.7 + seed * 3.1)
        + 0.14 * Math.sin(u * 47.1 - seed * 1.7)
        + 0.08 * Math.sin(u * 11.3 + seed * 5.3);
      pos.setY(i, y + Math.max(0, t) * tatter * h);
    }
  }

  pos.needsUpdate = true;
  geo.translate(0, -h / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A lathe profile scaled to a unit height, with world UVs. Used for every
 * vessel: amphora, urn, canopic jar.
 *
 * Profile radii are NORMALISED so the widest point is exactly 1.0, which means
 * the `radius` argument is the vessel's true maximum radius rather than an
 * arbitrary multiplier. Getting this wrong is how the canopic jars came out as
 * lollipops on the first pass: their raw profile peaked at 0.27, so every jar
 * was built at a quarter of its intended width.
 *
 * @param {Array<[number, number]>} profile [radius, height] pairs, 0..1
 */
function vessel(profile, height, radius, segments, mat, tilesPerUnit) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r * radius, y * height));
  const geo = cylinderUV(
    new THREE.LatheGeometry(pts, segments), radius, height, tilesPerUnit);

  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * A bag: a lumpy sphere with its poles flattened, so it sits on the ground and
 * (if `both`) stacks under another one.
 *
 * A grain sack modelled as a box is the most common giveaway in a procedural
 * market, because a full sack has no straight lines in it anywhere. But the
 * first pass overcorrected into the other failure: a lightly eroded sphere is
 * an EGG, which is worse, because an egg is a recognisable object and a sack
 * is not. The lumps have to be large relative to the bag, not a surface
 * texture, so the erosion runs at low frequency and high amplitude and a
 * second lobe term pushes the contents into one or two corners.
 *
 * The flattening is the other half: a sphere resting on its south pole touches
 * the ground at a point, and the razor contact that produces is what reads as
 * "pasted on".
 */
function bagGeometry(rand, w, h, d, {
  both = false, lumps = 0.16, segs = 11, taper = 0,
} = {}) {
  // Segment count is a caller decision: a sandbag emplacement is twenty bags
  // and pays twenty times for every extra ring, while a grain sack is one
  // object the player walks right up to.
  const geo = new THREE.SphereGeometry(0.5, segs, Math.max(4, Math.round(segs * 0.62)));
  erode(geo, rr(rand, 0.05, 0.09), rr(rand, 1.6, 2.6), Math.floor(rand() * 97));

  const pos = geo.attributes.position;
  const floor = -0.32;
  const roof = 0.30;

  // Two low-frequency lobes: the grain settles unevenly, and this is what
  // makes one side of the bag bulge further than the other.
  const la = rand() * TAU, lb = rand() * TAU;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);

    const a = Math.atan2(z, x);
    const bulge = 1
      + Math.cos(a - la) * lumps * (0.5 + 0.5 * Math.cos(y * 4.0))
      + Math.cos((a - lb) * 2) * lumps * 0.55
      // Weight settles: the contents pool at the bottom, so the taper narrows
      // the shoulders. Without it the silhouette is an ellipsoid, and an
      // ellipsoid at this size is unavoidably an EGG.
      - taper * (y + 0.5);
    x *= bulge; z *= bulge;

    if (y < floor) {
      const over = floor - y;
      y = floor - over * 0.10;
      x *= (1 + over * 0.6); z *= (1 + over * 0.6);
    }
    if (both && y > roof) {
      const over = y - roof;
      y = roof + over * 0.14;
      x *= (1 + over * 0.5); z *= (1 + over * 0.5);
    }

    pos.setXYZ(i, x, y, z);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.scale(w, h, d);
  geo.translate(0, h * (both ? 0.5 : 0.32), 0);
  return geo;
}

/** A wheel: thin rim, hub, and spokes. Every member of it is tier-3 thin. */
function wheel(rand, radius, mats) {
  const g = new THREE.Group();
  const iron = pick(rand, mats.iron);
  const wood = pick(rand, mats.timber);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, rr(rand, 0.026, 0.038), 4, 16), iron);
  rim.castShadow = true;
  g.add(rim);

  const hub = tube(0.055, 0.055, 0.11, 8, wood, DENSITY.timber);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);

  const spokes = 6 + Math.floor(rand() * 4);
  for (let i = 0; i < spokes; i++) {
    // A missing spoke on a cart abandoned in a war zone is free damage and
    // the eye reads it instantly.
    if (chance(rand, 0.12)) continue;

    const a = (i / spokes) * TAU + jit(rand, 0.05);
    const s = blockMesh(0.032, radius * 0.96, 0.032, wood, DENSITY.timber);
    s.position.set(Math.cos(a) * radius * 0.48, Math.sin(a) * radius * 0.48, 0);
    s.rotation.z = a - Math.PI / 2;
    g.add(s);
  }

  return g;
}

// ---------------------------------------------------------------------------
// TIER 2: furniture scale, 0.4 m to 2.5 m
//
// The band a person could touch. Everything here has a footprint the placer has
// to occupancy-test, and everything here registers colliders.
// ---------------------------------------------------------------------------

/** A market stall: four posts, a sagging awning, a counter, and goods on it. */
function marketStall(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const w = rr(rand, 1.9, 2.9);
  const d = rr(rand, 1.1, 1.7);
  const postH = rr(rand, 2.0, 2.45);
  // Thicker than they were. At 4 cm a 2.4 m post is a toothpick holding up a
  // heavy awning, and the eye reads the impossibility before it reads the prop.
  const postR = rr(rand, 0.062, 0.088);
  const wood = pick(rand, mats.timber);

  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) {
    const x = sx * w * 0.5;
    const z = sz * d * 0.5;
    const h = postH + jit(rand, 0.09);

    // Posts driven by hand are never plumb, and the lean is what stops four
    // uprights from reading as a CAD frame.
    const p = blockMesh(postR * 2, h, postR * 2, wood, DENSITY.timber);
    p.position.set(x, h * 0.5, z);
    p.rotation.set(jit(rand, 0.035), rand() * TAU, jit(rand, 0.035));
    group.add(p);
    colliders.push({ x, z, r: postR + 0.05, h });
  }

  // The awning. Pitched slightly toward the front so rain and sand run off,
  // which also means it is never parallel to anything else in frame.
  const awning = new THREE.Mesh(
    saggedSheet(w * 1.18, d * 1.25, {
      sag: rr(rand, 0.12, 0.30), segs: 9, seed: rand() * 10,
    }),
    pick(rand, mats.cloth)
  );
  awning.position.y = postH + rr(rand, 0.02, 0.09);
  awning.rotation.x = rr(rand, 0.05, 0.14);
  awning.rotation.y = jit(rand, 0.04);
  awning.castShadow = true;
  awning.receiveShadow = true;
  group.add(awning);

  // A valance hanging off the front edge. Cheap, and it is the piece that
  // actually breaks the stall's silhouette against the sky.
  if (chance(rand, 0.8)) {
    const val = new THREE.Mesh(
      hangingCloth(w * 1.14, rr(rand, 0.22, 0.44), { seed: rand() * 9, tatter: 0.3 }),
      pick(rand, mats.cloth)
    );
    val.position.set(0, postH - 0.02, -d * 0.62);
    val.castShadow = true;
    group.add(val);
  }

  // The counter: a plank top on two trestles.
  const topH = rr(rand, 0.82, 0.98);
  const counter = blockMesh(w * 0.92, 0.07, d * 0.5, wood, DENSITY.timber,
    { chamfer: 0.014, eroded: 0.006, seed: 3 });
  counter.position.set(0, topH, d * 0.1);
  group.add(counter);
  colliders.push({ x: -w * 0.25, z: d * 0.1, r: 0.42, h: topH });
  colliders.push({ x: w * 0.25, z: d * 0.1, r: 0.42, h: topH });

  for (const sx of [-1, 1]) {
    const leg = blockMesh(0.06, topH, 0.06, wood, DENSITY.timber);
    leg.position.set(sx * w * 0.34, topH * 0.5, d * 0.1);
    leg.rotation.z = jit(rand, 0.03);
    group.add(leg);
  }

  // Goods. Small, mixed, and deliberately overlapping the counter edge: the
  // scene has no overlap anywhere and this is a free place to start.
  const goods = 2 + Math.floor(rand() * 4);
  for (let i = 0; i < goods; i++) {
    const gx = lerp(-w * 0.38, w * 0.38, (i + rr(rand, 0.2, 0.8)) / goods);
    if (chance(rand, 0.55)) {
      const jarH = rr(rand, 0.16, 0.30);
      const jar = vessel(URN_PROFILE, jarH, jarH * rr(rand, 0.34, 0.46), 10,
        pick(rand, mats.clay), DENSITY.clay);
      jar.position.set(gx, topH + 0.035, d * 0.1 + jit(rand, 0.12));
      jar.rotation.y = rand() * TAU;
      group.add(jar);
    } else {
      const s = rr(rand, 0.16, 0.26);
      const sk = new THREE.Mesh(
        bagGeometry(rand, s * 1.5, s, s * 1.2), pick(rand, mats.sack));
      sk.position.set(gx, topH + 0.035, d * 0.1 + jit(rand, 0.12));
      sk.rotation.y = rand() * TAU;
      sk.castShadow = true;
      group.add(sk);
    }
  }

  return finish(group, colliders, opts);
}

/** A stack of wooden crates, battened, tilted, and never all the same size. */
function crateStack(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  // Three crates high is a stack; five is a totem pole. The cap is on total
  // height rather than count, because a stack of small crates can afford one
  // more course than a stack of big ones.
  const n = 2 + Math.floor(rand() * 3);
  const MAX_STACK = rr(rand, 1.1, 1.6);

  let y = 0;
  let maxR = 0;

  for (let i = 0; i < n; i++) {
    // Each crate is smaller than the one under it, mostly. A perfectly
    // graduated stack is as artificial as a perfectly uniform one, so one
    // crate in five is allowed to be wrong.
    const w = rr(rand, 0.44, 0.78) * (chance(rand, 0.2) ? 1.2 : 1 - i * 0.06);
    const d = w * rr(rand, 0.72, 1.05);
    // Crates are boxes, not slabs. On the first pass the height range was
    // absolute rather than proportional, so a wide crate came out as a plank
    // and the stack read as a shelf unit.
    const h = w * rr(rand, 0.58, 0.92);
    if (i > 0 && y + h > MAX_STACK) break;

    // The crate and its trim are built as ONE sub-group in local coordinates,
    // then placed and yawed as a unit. Positioning trim in parent space and
    // separately setting its rotation is how the first two passes ended up
    // with battens hanging in the air beside their crates: there is no way to
    // get that wrong if the trim never leaves the crate's own frame.
    const crate = new THREE.Group();
    const wood = pick(rand, mats.timber);
    const battenMat = pick(rand, mats.timber);

    crate.add(blockMesh(w, h, d, wood, DENSITY.timber,
      { chamfer: 0.016, eroded: 0.006, erodeScale: 5.0, seed: i * 7 + 3 }));

    // Battens. Thin enough to route to a plain box, and they are the only
    // reason a crate reads as boards rather than as a painted cube.
    for (const sz of [-1, 1]) {
      const b = blockMesh(w * 1.01, 0.06, 0.03, battenMat, DENSITY.timber);
      b.position.set(0, h * rr(rand, 0.2, 0.32) - h * 0.5, sz * (d * 0.5 + 0.011));
      crate.add(b);
    }
    for (const sx of [-1, 1]) {
      const b = blockMesh(0.03, 0.06, d * 1.01, battenMat, DENSITY.timber);
      b.position.set(sx * (w * 0.5 + 0.011), h * rr(rand, 0.62, 0.78) - h * 0.5, 0);
      crate.add(b);
    }

    const ox = jit(rand, 0.05 * (i + 1) * 0.5);
    const oz = jit(rand, 0.05 * (i + 1) * 0.5);
    crate.position.set(ox, y + h * 0.5, oz);
    crate.rotation.y = jit(rand, 0.28);
    crate.rotation.z = jit(rand, 0.02);
    group.add(crate);

    y += h - rr(rand, 0.0, 0.012);
    maxR = Math.max(maxR, Math.hypot(w, d) * 0.5 + Math.hypot(ox, oz));
  }

  colliders.push({ x: 0, z: 0, r: maxR * 0.86, h: y });

  // One crate off the stack, broken open. A stack with nothing beside it is
  // storage; a stack with a smashed crate beside it is a place something
  // happened.
  if (chance(rand, 0.55)) {
    const w = rr(rand, 0.42, 0.62);
    const bh = w * rr(rand, 0.6, 0.85);
    const bx = rr(rand, 0.75, 1.15) * (chance(rand, 0.5) ? -1 : 1);
    const bz = jit(rand, 0.5);
    const onSide = chance(rand, 0.45);

    const broken = blockMesh(w, bh, w * 0.9, pick(rand, mats.timber),
      DENSITY.timber, { chamfer: 0.016, eroded: 0.025, erodeScale: 6.0, seed: 21 });

    // Tipped over rather than balanced on a corner. The half height has to
    // follow whichever axis is now vertical, or the crate floats.
    broken.rotation.set(0, rand() * TAU, onSide ? Math.PI * 0.5 : jit(rand, 0.06));
    broken.position.set(bx, (onSide ? w : bh) * 0.5, bz);
    group.add(broken);

    // Loose boards spilled out of it.
    for (let i = 0; i < 2 + Math.floor(rand() * 3); i++) {
      const bd = blockMesh(rr(rand, 0.3, 0.6), 0.018, rr(rand, 0.07, 0.12),
        pick(rand, mats.timber), DENSITY.timber);
      bd.position.set(bx + jit(rand, 0.4), 0.012 + i * 0.02, bz + jit(rand, 0.4));
      bd.rotation.set(jit(rand, 0.06), rand() * TAU, jit(rand, 0.06));
      group.add(bd);
    }

    colliders.push({ x: bx, z: bz, r: w * 0.6, h: onSide ? w : bh });
  }

  return finish(group, colliders, opts);
}

// Profiles are [radius, height], radius normalised so the widest point is
// exactly 1.0 and height normalised to 1.0. The last entries of each run back
// DOWN the inside of the mouth, which is what makes an open vessel read as
// hollow rather than as a plug.

/** Storage-jar profile: pointed toe, deep belly, narrow neck, flared rim. */
const AMPHORA_PROFILE = [
  [0.000, 0.00], [0.237, 0.01], [0.395, 0.04], [0.684, 0.13], [0.921, 0.26],
  [1.000, 0.38], [0.947, 0.48], [0.737, 0.60], [0.474, 0.71], [0.368, 0.81],
  [0.395, 0.90], [0.526, 0.96], [0.500, 1.00], [0.342, 0.99], [0.316, 0.88],
];

/** A squatter, wider domestic urn. Same lathe machinery, different silhouette. */
const URN_PROFILE = [
  [0.000, 0.00], [0.400, 0.00], [0.533, 0.03], [0.844, 0.17], [1.000, 0.36],
  [0.933, 0.56], [0.711, 0.74], [0.578, 0.86], [0.622, 0.95], [0.689, 1.00],
  [0.578, 0.99], [0.533, 0.86],
];

/** Canopic jar: straight-sided with a shoulder, the head sits on top. */
const CANOPIC_PROFILE = [
  [0.000, 0.00], [0.741, 0.00], [0.889, 0.04], [0.963, 0.30], [1.000, 0.62],
  [0.889, 0.80], [0.815, 0.88], [0.926, 0.92], [0.778, 0.94], [0.704, 0.84],
];

/** One vessel: amphora or urn, upright or toppled, whole or broken-rimmed. */
function amphora(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const isAmphora = chance(rand, opts.urn ? 0.0 : 0.6);
  const profile = isAmphora ? AMPHORA_PROFILE : URN_PROFILE;

  const h = isAmphora ? rr(rand, 0.62, 1.05) : rr(rand, 0.42, 0.76);
  // An amphora is a slender vessel and an urn is a fat one; the ratio IS the
  // difference between the two silhouettes, since they share the lathe.
  const r = h * (isAmphora ? rr(rand, 0.19, 0.26) : rr(rand, 0.38, 0.50));
  const mat = pick(rand, mats.clay);

  // Damage: a jar with its rim knocked off is the same lathe with the top of
  // the profile discarded, which costs nothing and doubles the silhouette
  // vocabulary of the whole cluster.
  const broken = chance(rand, 0.28);
  const prof = broken ? profile.slice(0, Math.max(6, profile.length - 4 - Math.floor(rand() * 3))) : profile;

  const jar = vessel(prof, h, r, 12, mat, DENSITY.clay);
  group.add(jar);

  // Handles, on amphorae only, and only if the shoulder survived.
  if (isAmphora && !broken && chance(rand, 0.75)) {
    const yTop = h * 0.86, yBot = h * 0.60;
    const cy = (yTop + yBot) * 0.5;
    const hr = (yTop - yBot) * 0.5;

    for (const side of [-1, 1]) {
      // A half torus in the XY plane, rotated so the ring plane contains the
      // vertical axis and the bulge points away from the jar.
      const hg = new THREE.Mesh(
        new THREE.TorusGeometry(hr, r * 0.16, 4, 8, Math.PI), mat);
      hg.rotation.z = -side * Math.PI / 2;
      hg.position.set(side * r * 0.5, cy, 0);
      hg.castShadow = true;
      group.add(hg);
    }
  }

  const toppled = chance(rand, opts.toppled === undefined ? 0.22 : (opts.toppled ? 1 : 0));
  if (toppled) {
    // On its side, and rolled so the mouth points somewhere arbitrary.
    group.rotation.set(Math.PI / 2 + jit(rand, 0.12), rand() * TAU, jit(rand, 0.2), 'YXZ');
    group.position.y = r * 0.92;
    colliders.push({ x: 0, z: 0, r: h * 0.44, h: r * 1.8 });
  } else {
    group.rotation.y = rand() * TAU;
    group.rotation.z = jit(rand, 0.03);
    colliders.push({ x: 0, z: 0, r: r * 1.05, h });
  }

  // The toppled/rotated case needs its own wrapper so the placer still gets a
  // group whose origin is on the ground and whose Y is up.
  const outer = new THREE.Group();
  outer.add(group);
  return finish(outer, colliders, opts);
}

/** Three to six vessels together, some standing, some down, some in a rack. */
function amphoraCluster(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const n = 3 + Math.floor(rand() * 4);
  const spread = rr(rand, 0.5, 0.85);

  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + jit(rand, 0.5);
    const d = spread * Math.pow(rand(), 0.6);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d * rr(rand, 0.7, 1.0);

    const one = amphora(rand, { toppled: chance(rand, 0.3) });
    one.group.position.set(x, 0, z);
    group.add(one.group);
    for (const c of one.colliders) colliders.push({ ...c, x: c.x + x, z: c.z + z });
  }

  // A low timber rack. Two jars leaning in it read as stored rather than
  // dropped, and the rack itself is four thin members.
  if (chance(rand, 0.45)) {
    const wood = pick(rand, mats.timber);
    const rw = rr(rand, 0.8, 1.15);
    const rh = rr(rand, 0.34, 0.5);
    const rz = -spread * rr(rand, 0.9, 1.2);

    for (const sx of [-1, 1]) {
      const leg = blockMesh(0.05, rh, 0.05, wood, DENSITY.timber);
      leg.position.set(sx * rw * 0.5, rh * 0.5, rz);
      group.add(leg);
    }
    for (const sy of [0.42, 0.94]) {
      const rail = blockMesh(rw * 1.06, 0.04, 0.04, wood, DENSITY.timber);
      rail.position.set(0, rh * sy, rz);
      group.add(rail);
    }
    colliders.push({ x: 0, z: rz, r: rw * 0.5, h: rh });
  }

  // Sherds where the broken ones landed.
  for (let i = 0; i < 3 + Math.floor(rand() * 5); i++) {
    const a = rand() * TAU;
    const d = spread * rr(rand, 0.9, 1.9);
    const s = rr(rand, 0.06, 0.15);
    const sh = blockMesh(s, 0.012, s * rr(rand, 0.6, 1.3), pick(rand, mats.clay), DENSITY.clay);
    sh.position.set(Math.cos(a) * d, 0.008, Math.sin(a) * d);
    sh.rotation.set(jit(rand, 0.25), rand() * TAU, jit(rand, 0.25));
    group.add(sh);
  }

  return finish(group, colliders, opts);
}

/** Grain sacks, slumped. Never boxes; see bagGeometry for why. */
function grainSacks(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const n = 2 + Math.floor(rand() * 4);
  const stacked = chance(rand, 0.4);

  let y = 0;
  for (let i = 0; i < n; i++) {
    const w = rr(rand, 0.42, 0.62);
    // Taller than wide, and strongly tapered. A grain sack stands on a broad
    // slumped base and narrows to a gathered neck; without the height and the
    // taper it is an ellipsoid, which the eye reliably reads as a boulder or
    // an egg no matter what colour it is.
    const h = w * rr(rand, 1.05, 1.45);
    const d = w * rr(rand, 0.78, 0.95);
    const mat = pick(rand, mats.sack);

    const s = new THREE.Mesh(
      bagGeometry(rand, w, h, d, { taper: rr(rand, 0.30, 0.46), lumps: 0.20 }), mat);
    s.castShadow = true;
    s.receiveShadow = true;

    let x, z;
    if (stacked && i > 0) {
      x = jit(rand, 0.12); z = jit(rand, 0.12);
      s.position.set(x, y, z);
      s.rotation.set(jit(rand, 0.08), rand() * TAU, jit(rand, 0.08));
      y += h * 0.74;
    } else {
      const a = rand() * TAU;
      const dd = rr(rand, 0.18, 0.55) * (i === 0 ? 0 : 1);
      x = Math.cos(a) * dd; z = Math.sin(a) * dd;
      s.position.set(x, 0, z);
      s.rotation.set(jit(rand, 0.12), rand() * TAU, jit(rand, 0.12));
      if (i === 0) y = h * 0.74;
    }
    group.add(s);

    // The tied neck: a gathered stub with a cord round it. Two tiny parts, and
    // they are the difference between a sack and a boulder.
    //
    // bagGeometry puts the base at local y = 0 and the crown at 0.82 * h, so
    // the neck has to sit at 0.80, not at the mid height it was first given:
    // buried inside its own sack, it contributed nothing but triangles.
    const neckY = s.position.y + h * 0.80;
    const neckR = w * (0.5 - rr(rand, 0.30, 0.46) * 0.5) * 0.5;

    const neck = tube(neckR * 0.62, neckR, h * 0.22, 7, mat, DENSITY.sack);
    neck.position.set(s.position.x, neckY + h * 0.06, s.position.z);
    neck.rotation.z = jit(rand, 0.22);
    group.add(neck);

    const cord = new THREE.Mesh(
      new THREE.TorusGeometry(neckR * 1.06, 0.012, 3, 8), pick(rand, mats.cord));
    cord.rotation.x = Math.PI / 2;
    cord.position.set(s.position.x, neckY + h * 0.02, s.position.z);
    group.add(cord);

    colliders.push({ x, z, r: Math.max(w, d) * 0.52, h: s.position.y + h });
  }

  return finish(group, colliders, opts);
}

/** A low bench: stone slab on blocks, or a timber plank on legs. */
function bench(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const stone = chance(rand, 0.5);
  const len = rr(rand, 1.3, 2.2);
  const seatH = rr(rand, 0.38, 0.52);
  const depth = rr(rand, 0.34, 0.46);

  if (stone) {
    const seat = blockMesh(len, 0.13, depth, mats.limestone, DENSITY.stone,
      { chamfer: 0.02, eroded: 0.014, erodeScale: 2.2, seed: 11 });
    seat.position.y = seatH;
    group.add(seat);

    for (const sx of [-1, 1]) {
      const support = blockMesh(0.22, seatH, depth * 0.86, mats.limestone, DENSITY.stone,
        { chamfer: 0.02, eroded: 0.01, seed: 5 });
      support.position.set(sx * (len * 0.5 - 0.22), seatH * 0.5, 0);
      support.rotation.y = jit(rand, 0.02);
      group.add(support);
    }
  } else {
    const wood = pick(rand, mats.timber);
    const seat = blockMesh(len, 0.065, depth, wood, DENSITY.timber, { chamfer: 0.014 });
    seat.position.y = seatH;
    seat.rotation.z = jit(rand, 0.015);
    group.add(seat);

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = blockMesh(0.055, seatH, 0.055, wood, DENSITY.timber);
        leg.position.set(sx * (len * 0.5 - 0.14), seatH * 0.5, sz * (depth * 0.5 - 0.07));
        leg.rotation.set(jit(rand, 0.035), 0, jit(rand, 0.035));
        group.add(leg);
      }
      // A brace between each leg pair, thin, and the reason the bench does not
      // read as a floating plank.
      const brace = blockMesh(0.035, 0.035, depth * 0.78, wood, DENSITY.timber);
      brace.position.set(sx * (len * 0.5 - 0.14), seatH * 0.35, 0);
      group.add(brace);
    }
  }

  colliders.push({ x: -len * 0.28, z: 0, r: depth * 0.55, h: seatH + 0.13 });
  colliders.push({ x: len * 0.28, z: 0, r: depth * 0.55, h: seatH + 0.13 });

  return finish(group, colliders, opts);
}

/** A stone offering table: slab, pedestal, libation basin, small offerings. */
function offeringTable(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const w = rr(rand, 0.85, 1.25);
  const d = w * rr(rand, 0.58, 0.75);
  const h = rr(rand, 0.62, 0.86);
  const mat = chance(rand, 0.6) ? mats.carved : mats.limestone;

  const top = blockMesh(w, 0.12, d, mat, DENSITY.stone,
    { chamfer: 0.022, eroded: 0.012, erodeScale: 2.4, seed: 13 });
  top.position.y = h;
  top.rotation.y = jit(rand, 0.02);
  group.add(top);

  if (chance(rand, 0.55)) {
    // Single battered pedestal, the older form.
    const ped = tube(w * 0.22, w * 0.30, h, 6, mat, DENSITY.stone);
    ped.position.y = h * 0.5;
    ped.rotation.y = rand() * TAU;
    group.add(ped);
  } else {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = blockMesh(0.11, h, 0.11, mat, DENSITY.stone, { chamfer: 0.018 });
        leg.position.set(sx * (w * 0.5 - 0.12), h * 0.5, sz * (d * 0.5 - 0.1));
        group.add(leg);
      }
    }
  }

  // The libation basin: a ring wall on the slab with a dark floor inside. A
  // real basin is a cut recess, and cutting one would need CSG; a ring plus a
  // darker disc reads identically from standing height and costs 3 draws.
  if (chance(rand, 0.7)) {
    const br = w * rr(rand, 0.17, 0.24);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(br, 0.024, 4, 14), mat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(jit(rand, w * 0.12), h + 0.062, jit(rand, d * 0.1));
    rim.castShadow = true;
    group.add(rim);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(br, 14), mats.granite);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(rim.position.x, h + 0.062, rim.position.z);
    group.add(floor);
  }

  // Offerings: two or three small vessels, off centre, one on its side.
  for (let i = 0; i < 1 + Math.floor(rand() * 3); i++) {
    const oh = rr(rand, 0.09, 0.17);
    const o = vessel(URN_PROFILE, oh, oh * 0.5, 8, pick(rand, mats.clay), DENSITY.clay);
    o.position.set(jit(rand, w * 0.34), h + 0.06 + oh * 0.5 * 0, jit(rand, d * 0.3));
    o.position.y = h + 0.062;
    if (chance(rand, 0.25)) { o.rotation.z = Math.PI / 2; o.position.y = h + 0.062 + oh * 0.4; }
    o.rotation.y = rand() * TAU;
    group.add(o);
  }

  colliders.push({ x: 0, z: 0, r: Math.max(w, d) * 0.5, h: h + 0.12 });

  return finish(group, colliders, opts);
}

/**
 * A field brazier: iron tripod, shallow bowl, live coals.
 *
 * A variant of the courtyard's ceremonial brazier, deliberately shabbier: this
 * is the one soldiers dragged in, not the one the priests installed. The ember
 * material is cloned per instance because the flicker drives
 * emissiveIntensity, and a shared material would beat in unison across the
 * whole map.
 */
function brazier(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const iron = pick(rand, mats.iron);
  const h = rr(rand, 0.62, 1.05);
  const rBowl = rr(rand, 0.24, 0.38);

  const legs = 3;
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * TAU + jit(rand, 0.14);
    const spread = rBowl * rr(rand, 1.1, 1.5);
    const leg = blockMesh(0.05, h * 1.04, 0.05, iron, DENSITY.metal);
    leg.position.set(Math.cos(a) * spread * 0.5, h * 0.5, Math.sin(a) * spread * 0.5);
    leg.rotation.set(-Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2);
    group.add(leg);
  }

  // Deep, not a saucer. The first pass gave it a 20 cm bowl on a 1 m stand and
  // the silhouette read as a birdbath.
  const bowlH = rBowl * rr(rand, 0.75, 1.0);
  const bowl = tube(rBowl, rBowl * 0.42, bowlH, 12, iron, DENSITY.metal);
  bowl.position.y = h + bowlH * 0.4;
  group.add(bowl);

  // A hoop round the rim: thin, and it stops the bowl reading as a plant pot.
  const rimY = h + bowlH * 0.88;
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(rBowl * 1.03, 0.02, 4, 14), iron);
  hoop.rotation.x = Math.PI / 2;
  hoop.position.y = rimY;
  group.add(hoop);

  // The registry ember is tuned for the courtyard's much larger ceremonial
  // bowl. At that intensity a 30 cm field brazier blows the whole bowl to
  // white through ACES, so the clone comes down as well as being cloned.
  const emberMat = mats.ember.clone();
  emberMat.emissiveIntensity = rr(rand, 1.3, 2.0);
  const coals = new THREE.Mesh(new THREE.SphereGeometry(rBowl * 0.72, 10, 6), emberMat);
  coals.scale.y = 0.34;
  coals.position.y = rimY - bowlH * 0.22;
  group.add(coals);

  // The placer decides whether this one gets a real light. Braziers are the
  // only prop in the kit that wants one, and lights are a per-room budget
  // decision, so the kit advertises the socket rather than filling it.
  group.userData.emitter = {
    position: new THREE.Vector3(0, rimY + 0.2, 0),
    color: 0xff8a3c,
    material: emberMat,
  };

  colliders.push({ x: 0, z: 0, r: rBowl * 1.15, h: rimY });

  return finish(group, colliders, opts);
}

/** A two-wheeled cart, sometimes with a broken axle and a load still on it. */
function cart(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const wood = pick(rand, mats.timber);
  const len = rr(rand, 1.6, 2.2);
  const wid = rr(rand, 0.85, 1.15);
  const wr = rr(rand, 0.36, 0.5);

  const body = new THREE.Group();
  const bedH = wr * rr(rand, 1.05, 1.2);

  const bed = blockMesh(len, 0.09, wid, wood, DENSITY.timber,
    { chamfer: 0.016, eroded: 0.006, seed: 17 });
  bed.position.y = bedH;
  body.add(bed);

  // Side rails, four thin members and two stakes a side.
  for (const sz of [-1, 1]) {
    const rail = blockMesh(len * 0.96, 0.05, 0.05, wood, DENSITY.timber);
    rail.position.set(0, bedH + rr(rand, 0.26, 0.36), sz * wid * 0.48);
    body.add(rail);

    for (let i = 0; i < 3; i++) {
      const stake = blockMesh(0.04, rr(rand, 0.3, 0.4), 0.04, wood, DENSITY.timber);
      stake.position.set(lerp(-len * 0.4, len * 0.4, i / 2), bedH + 0.17, sz * wid * 0.48);
      stake.rotation.z = jit(rand, 0.06);
      body.add(stake);
    }
  }

  // Shafts, running forward and down to where the animal was.
  for (const sz of [-1, 1]) {
    const shaft = blockMesh(len * 0.62, 0.05, 0.05, wood, DENSITY.timber);
    shaft.position.set(-len * 0.72, bedH - 0.1, sz * wid * 0.3);
    shaft.rotation.z = 0.12;
    body.add(shaft);
  }

  const axleZ = rr(rand, -0.1, 0.1) * len;
  const axle = blockMesh(0.06, 0.06, wid * 1.16, pick(rand, mats.iron), DENSITY.metal);
  axle.position.set(axleZ, wr, 0);
  body.add(axle);

  for (const sz of [-1, 1]) {
    const w = wheel(rand, wr, mats);
    w.position.set(axleZ, wr, sz * wid * 0.58);
    body.add(w);
  }

  // Load: sacks or a crate, still lashed on.
  if (chance(rand, 0.6)) {
    for (let i = 0; i < 1 + Math.floor(rand() * 3); i++) {
      const s = rr(rand, 0.34, 0.5);
      const sk = new THREE.Mesh(
        bagGeometry(rand, s, s * 0.72, s * 0.85), pick(rand, mats.sack));
      sk.position.set(jit(rand, len * 0.28), bedH + 0.045, jit(rand, wid * 0.22));
      sk.rotation.y = rand() * TAU;
      sk.castShadow = true;
      body.add(sk);
    }
  }

  // A broken axle drops one corner into the sand. Cheapest possible story.
  const broken = chance(rand, 0.35);
  if (broken) {
    body.rotation.z = rr(rand, 0.10, 0.20) * (chance(rand, 0.5) ? 1 : -1);
    body.rotation.x = jit(rand, 0.05);
    body.position.y = -wr * 0.18;
  }
  group.add(body);

  colliders.push({ x: -len * 0.25, z: 0, r: wid * 0.55, h: bedH + 0.4 });
  colliders.push({ x: len * 0.25, z: 0, r: wid * 0.55, h: bedH + 0.4 });

  return finish(group, colliders, opts);
}

/** A scaffolding frame: poles, ledgers, a plank deck, and rope lashings. */
function scaffold(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const wood = pick(rand, mats.timber);
  const cord = pick(rand, mats.cord);
  const w = rr(rand, 1.6, 2.6);
  const d = rr(rand, 0.8, 1.2);
  const h = rr(rand, 2.2, 3.4);
  const pr = rr(rand, 0.045, 0.062);

  const uprights = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of uprights) {
    const x = sx * w * 0.5, z = sz * d * 0.5;
    const ph = h * rr(rand, 0.93, 1.08);
    const p = tube(pr * 0.9, pr, ph, 7, wood, DENSITY.timber);
    p.position.set(x, ph * 0.5, z);
    p.rotation.set(jit(rand, 0.02), 0, jit(rand, 0.02));
    group.add(p);
    colliders.push({ x, z, r: pr + 0.06, h: ph });
  }

  // Ledgers at two or three lifts, plus one diagonal brace per face. The
  // diagonal is what makes a frame read as scaffolding rather than as a
  // rectangle of sticks.
  const lifts = 2 + Math.floor(rand() * 2);
  for (let l = 1; l <= lifts; l++) {
    const y = (h / (lifts + 0.35)) * l;
    for (const sz of [-1, 1]) {
      const led = blockMesh(w * 1.06, 0.045, 0.045, wood, DENSITY.timber);
      led.position.set(0, y, sz * d * 0.5);
      led.rotation.z = jit(rand, 0.012);
      group.add(led);
    }
    for (const sx of [-1, 1]) {
      const led = blockMesh(0.045, 0.045, d * 1.06, wood, DENSITY.timber);
      led.position.set(sx * w * 0.5, y + jit(rand, 0.02), 0);
      group.add(led);
    }
  }

  const braceLen = Math.hypot(w, h * 0.62);
  for (const sz of [-1, 1]) {
    if (!chance(rand, 0.75)) continue;
    const br = blockMesh(braceLen, 0.038, 0.038, wood, DENSITY.timber);
    br.position.set(0, h * 0.34, sz * d * 0.5);
    br.rotation.z = Math.atan2(h * 0.62, w) * (sz > 0 ? 1 : -1);
    group.add(br);
  }

  // A plank deck on the top lift, one plank short of complete.
  const deckY = (h / (lifts + 0.35)) * lifts + 0.05;
  const planks = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < planks; i++) {
    if (chance(rand, 0.15)) continue;
    const pw = d / planks * 0.9;
    const pl = blockMesh(w * 0.98, 0.032, pw, pick(rand, mats.timber), DENSITY.timber);
    pl.position.set(jit(rand, 0.03), deckY, lerp(-d * 0.42, d * 0.42, i / (planks - 1)));
    pl.rotation.y = jit(rand, 0.01);
    group.add(pl);
  }

  // Lashings where members cross. Small, and they carry all the handmade read.
  for (let i = 0; i < 4 + Math.floor(rand() * 4); i++) {
    const sx = chance(rand, 0.5) ? -1 : 1;
    const sz = chance(rand, 0.5) ? -1 : 1;
    const y = (h / (lifts + 0.35)) * (1 + Math.floor(rand() * lifts));
    const la = new THREE.Mesh(new THREE.TorusGeometry(pr * 1.5, 0.014, 3, 7), cord);
    la.position.set(sx * w * 0.5, y, sz * d * 0.5);
    la.rotation.x = Math.PI / 2;
    la.rotation.z = jit(rand, 0.3);
    group.add(la);
  }

  return finish(group, colliders, opts);
}

/** A stack of mudbricks, part collapsed. The brick is the module of the place. */
function mudbrickPile(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const bw = rr(rand, 0.30, 0.38);
  const bh = rr(rand, 0.10, 0.14);
  const bd = bw * rr(rand, 0.48, 0.58);

  const courses = 3 + Math.floor(rand() * 5);
  const perCourse = 3 + Math.floor(rand() * 3);
  let maxSpan = 0;

  for (let c = 0; c < courses; c++) {
    // The stack tapers and the courses alternate direction, which is how a
    // real brick stack is laid so it does not fall over.
    const n = Math.max(1, perCourse - Math.floor(c * 0.55));
    const alt = c % 2 === 0;

    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const off = lerp(-1, 1, t) * (n - 1) * (alt ? bd : bw) * 0.52;

      const b = blockMesh(alt ? bw : bd, bh, alt ? bd : bw,
        pick(rand, mats.mudbrick), DENSITY.brick,
        { chamfer: 0.012, eroded: 0.008, erodeScale: 7.0, seed: c * 11 + i });

      b.position.set(
        (alt ? off : jit(rand, 0.02)) + jit(rand, 0.015),
        bh * (c + 0.5),
        (alt ? jit(rand, 0.02) : off) + jit(rand, 0.015)
      );
      b.rotation.y = jit(rand, 0.05);
      b.rotation.z = jit(rand, 0.012);
      group.add(b);

      maxSpan = Math.max(maxSpan, Math.abs(off) + bw * 0.5);
    }
  }

  // The collapsed half: bricks that slid off, lying flat and overlapping.
  for (let i = 0; i < 3 + Math.floor(rand() * 6); i++) {
    const a = rand() * TAU;
    const d = maxSpan + rr(rand, 0.05, 0.55);
    const b = blockMesh(bw, bh, bd, pick(rand, mats.mudbrick), DENSITY.brick,
      { chamfer: 0.012, eroded: 0.016, erodeScale: 7.0, seed: 40 + i });
    b.position.set(Math.cos(a) * d, bh * rr(rand, 0.42, 0.9), Math.sin(a) * d * 0.8);
    b.rotation.set(jit(rand, 0.12), rand() * TAU, jit(rand, 0.12));
    group.add(b);
  }

  colliders.push({ x: 0, z: 0, r: maxSpan * 0.95, h: bh * courses });

  return finish(group, colliders, opts);
}

/** A stone water trough, wet or dry. Five slabs, no CSG needed. */
function waterTrough(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const len = rr(rand, 1.3, 2.1);
  const wid = rr(rand, 0.5, 0.75);
  const h = rr(rand, 0.42, 0.58);
  const t = rr(rand, 0.09, 0.13);
  const mat = mats.limestone;

  const floor = blockMesh(len, t, wid, mat, DENSITY.stone,
    { chamfer: 0.02, eroded: 0.008, seed: 7 });
  floor.position.y = t * 0.5;
  group.add(floor);

  for (const sx of [-1, 1]) {
    const end = blockMesh(t, h, wid, mat, DENSITY.stone,
      { chamfer: 0.02, eroded: 0.012, erodeScale: 2.6, seed: 19 + sx });
    end.position.set(sx * (len * 0.5 - t * 0.5), h * 0.5, 0);
    group.add(end);
  }
  for (const sz of [-1, 1]) {
    const side = blockMesh(len - t * 2, h, t, mat, DENSITY.stone,
      { chamfer: 0.02, eroded: 0.012, erodeScale: 2.6, seed: 23 + sz });
    side.position.set(0, h * 0.5, sz * (wid * 0.5 - t * 0.5));
    group.add(side);
  }

  // Water, or the sand that replaced it. Standing water is the only smooth
  // horizontal surface at ground level in the whole scene, so when it is there
  // it does real work catching the sky.
  const wet = chance(rand, 0.55);
  const surface = new THREE.Mesh(
    plane(len - t * 2, wid - t * 2, 1, DENSITY.stone),
    wet ? mats.water : mats.limestone
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = wet ? h * rr(rand, 0.55, 0.78) : t * 1.4;
  surface.receiveShadow = true;
  group.add(surface);

  colliders.push({ x: -len * 0.26, z: 0, r: wid * 0.55, h });
  colliders.push({ x: len * 0.26, z: 0, r: wid * 0.55, h });

  return finish(group, colliders, opts);
}

/** Rolled reed mats, stacked and tied. */
function reedMats(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const n = 2 + Math.floor(rand() * 4);
  const len = rr(rand, 0.9, 1.5);
  const leaning = chance(rand, 0.3);

  // Stack them in a rough pyramid, which is how rolls actually sit.
  let placed = 0;
  for (let row = 0; placed < n; row++) {
    const inRow = Math.max(1, n - row * 2 - Math.floor(row / 2));
    for (let i = 0; i < inRow && placed < n; i++, placed++) {
      const r = rr(rand, 0.09, 0.15);
      const mat = pick(rand, mats.reed);

      const roll = tube(r, r * rr(rand, 0.94, 1.05), len * rr(rand, 0.9, 1.05),
        9, mat, DENSITY.timber);
      roll.rotation.z = Math.PI / 2;
      roll.rotation.y = jit(rand, 0.1);
      roll.position.set(
        jit(rand, 0.05),
        r + row * r * 1.7,
        (i - (inRow - 1) * 0.5) * r * 2.15 + jit(rand, 0.02)
      );
      group.add(roll);

      // The loose outer edge of the roll, a thin flap tangent to the cylinder.
      // Without it a rolled mat is indistinguishable from a log.
      const flap = blockMesh(len * 0.9, 0.012, r * 1.5, mat, DENSITY.timber);
      flap.position.copy(roll.position);
      flap.position.y += r * 0.55;
      flap.position.z += r * 0.6;
      flap.rotation.set(0.5, roll.rotation.y, 0);
      group.add(flap);

      // Two ties.
      for (const s of [-0.28, 0.28]) {
        const tie = new THREE.Mesh(
          new THREE.TorusGeometry(r * 1.06, 0.011, 3, 8), pick(rand, mats.cord));
        tie.position.copy(roll.position);
        tie.position.x += s * len;
        tie.rotation.y = Math.PI / 2;
        group.add(tie);
      }
    }
  }

  if (leaning) group.rotation.z = rr(rand, 0.05, 0.12);

  colliders.push({ x: 0, z: 0, r: Math.max(len * 0.5, 0.35), h: 0.45 });

  return finish(group, colliders, opts);
}

/** A broken statue torso, on its plinth or off it. */
function statueTorso(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  // Mostly the warm dressed stone. Granite is the darkest material in the
  // registry and at prop scale a granite box in shadow reads as a black
  // rectangle, so it stays the minority.
  const mat = chance(rand, 0.28) ? mats.granite : mats.carved;
  const scale = rr(rand, 0.85, 1.4);
  const onPlinth = chance(rand, 0.55);

  let baseY = 0;
  if (onPlinth) {
    const ph = rr(rand, 0.3, 0.5) * scale;
    const pw = rr(rand, 0.7, 0.95) * scale;
    const plinth = blockMesh(pw, ph, pw * 0.86, mats.limestone, DENSITY.stone,
      { chamfer: 0.03, eroded: 0.02, erodeScale: 2.0, seed: 31 });
    plinth.position.y = ph * 0.5;
    plinth.rotation.y = jit(rand, 0.06);
    group.add(plinth);
    baseY = ph;
  }

  const torso = new THREE.Group();
  const th = rr(rand, 0.8, 1.15) * scale;
  const tw = th * rr(rand, 0.42, 0.55);
  const r = tw * 0.5;

  // The body is built from TAPERED sections, not from a box.
  //
  // The first pass used one eroded block for the whole torso and it read
  // unmistakably as a wardrobe: a constant-section rectangle is furniture, and
  // no amount of surface erosion argues with a straight silhouette. Hips
  // narrow, chest widening upward, shoulders proud of both. Everything is
  // squashed front to back afterwards, which is also what real Egyptian
  // statuary does.
  const hips = tube(r * 0.92, r * 0.84, th * 0.34, 7, mat, DENSITY.stone);
  erode(hips.geometry, 0.022 * scale, 2.6, 43);
  hips.position.y = th * 0.17;
  hips.rotation.y = Math.PI / 7;
  torso.add(hips);

  const chest = tube(r * 1.14, r * 0.92, th * 0.46, 7, mat, DENSITY.stone);
  erode(chest.geometry, 0.026 * scale, 2.2, 47);
  chest.position.y = th * 0.55;
  chest.rotation.y = Math.PI / 7;
  torso.add(chest);

  // Shoulders, wider than anything below them. This is the one part that
  // stays a block: a shoulder line is genuinely straight.
  const sh = blockMesh(tw * 1.3, th * 0.16, tw * 0.68, mat, DENSITY.stone,
    { chamfer: 0.035, eroded: 0.035 * scale, erodeScale: 2.3, seed: 53 });
  sh.position.y = th * 0.83;
  torso.add(sh);

  // One arm survived, held to the chest in the Osiride pose. One did not.
  const arm = blockMesh(tw * 0.24, th * 0.52, tw * 0.26, mat, DENSITY.stone,
    { chamfer: 0.03, eroded: 0.03 * scale, erodeScale: 2.6, seed: 59 });
  const side = chance(rand, 0.5) ? 1 : -1;
  arm.position.set(side * tw * 0.58, th * 0.56, tw * 0.08);
  arm.rotation.z = side * rr(rand, 0.06, 0.16);
  torso.add(arm);

  // A stub of neck, snapped off short.
  const neck = tube(r * 0.5, r * 0.62, th * 0.12, 6, mat, DENSITY.stone);
  erode(neck.geometry, 0.04 * scale, 5.0, 61);
  neck.position.y = th * 0.94;
  neck.rotation.set(jit(rand, 0.12), jit(rand, 0.4), jit(rand, 0.12));
  torso.add(neck);

  // Flattened front to back. Applied to the whole body at once so the arm and
  // the shoulders stay in proportion with the sections.
  torso.scale.z = rr(rand, 0.62, 0.78);

  const fallen = !onPlinth && chance(rand, 0.5);
  if (fallen) {
    torso.rotation.set(Math.PI * 0.5 + jit(rand, 0.15), rand() * TAU, jit(rand, 0.2), 'YXZ');
    torso.position.y = tw * 0.45;
    colliders.push({ x: 0, z: 0, r: th * 0.5, h: tw });
  } else {
    torso.position.y = baseY;
    torso.rotation.y = rand() * TAU;
    torso.rotation.z = jit(rand, 0.04);
    colliders.push({ x: 0, z: 0, r: tw * 0.72, h: baseY + th });
  }
  group.add(torso);

  return finish(group, colliders, opts);
}

/** The four canopic jars on a shelf, one of them missing or on its side. */
function canopicSet(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const shelfH = rr(rand, 0.3, 0.55);
  const shelfW = rr(rand, 0.9, 1.2);
  const shelfD = rr(rand, 0.26, 0.34);

  const shelf = blockMesh(shelfW, 0.09, shelfD, mats.limestone, DENSITY.stone,
    { chamfer: 0.02, eroded: 0.01, seed: 67 });
  shelf.position.y = shelfH;
  group.add(shelf);

  const support = blockMesh(shelfW * 0.7, shelfH, shelfD * 0.7, mats.limestone, DENSITY.stone,
    { chamfer: 0.02, eroded: 0.012, erodeScale: 2.2, seed: 71 });
  support.position.y = shelfH * 0.5;
  group.add(support);

  // Imsety human, Hapi baboon, Duamutef jackal, Qebehsenuef falcon. Modelled
  // as silhouette cues only: at this size the head is 6 cm and the difference
  // between them has to be readable in outline, not in detail.
  const heads = ['human', 'baboon', 'jackal', 'falcon'];
  const top = shelfH + 0.045;

  for (let i = 0; i < 4; i++) {
    if (chance(rand, 0.15)) continue;   // one jar looted

    const mat = pick(rand, mats.clay);
    const jh = rr(rand, 0.20, 0.27);
    const jr = jh * rr(rand, 0.24, 0.30);
    const x = lerp(-shelfW * 0.34, shelfW * 0.34, i / 3) + jit(rand, 0.015);
    const z = jit(rand, shelfD * 0.12);

    const jar = new THREE.Group();
    jar.add(vessel(CANOPIC_PROFILE, jh, jr, 10, mat, DENSITY.clay));

    const head = heads[i];
    const hy = jh * 0.96;

    const skull = new THREE.Mesh(new THREE.SphereGeometry(jr * 0.78, 8, 6), mat);
    skull.position.y = hy + jr * 0.55;
    skull.castShadow = true;
    jar.add(skull);

    if (head === 'jackal' || head === 'baboon') {
      const snout = blockMesh(jr * 0.5, jr * 0.42, jr * 1.1, mat, DENSITY.clay);
      snout.position.set(0, hy + jr * 0.4, jr * 0.72);
      jar.add(snout);
    }
    if (head === 'jackal') {
      for (const s of [-1, 1]) {
        const ear = blockMesh(jr * 0.2, jr * 0.9, jr * 0.14, mat, DENSITY.clay);
        ear.position.set(s * jr * 0.42, hy + jr * 1.3, -jr * 0.1);
        ear.rotation.z = s * 0.16;
        jar.add(ear);
      }
    }
    if (head === 'falcon') {
      const beak = new THREE.Mesh(new THREE.ConeGeometry(jr * 0.2, jr * 0.55, 5), mat);
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, hy + jr * 0.5, jr * 0.72);
      jar.add(beak);
    }
    if (head === 'human') {
      // The nemes headcloth: two flat lappets falling either side of the face.
      for (const s of [-1, 1]) {
        const lap = blockMesh(jr * 0.22, jr * 0.7, jr * 0.5, mat, DENSITY.clay);
        lap.position.set(s * jr * 0.62, hy + jr * 0.42, jr * 0.16);
        lap.rotation.z = s * 0.1;
        jar.add(lap);
      }
    }

    jar.position.set(x, top, z);
    jar.rotation.y = jit(rand, 0.35);

    // One jar knocked onto its side on the shelf.
    if (chance(rand, 0.14)) {
      jar.rotation.set(Math.PI / 2, rand() * TAU, 0, 'YXZ');
      jar.position.y = top + jr;
    }
    group.add(jar);
  }

  colliders.push({ x: 0, z: 0, r: Math.max(shelfW, shelfD) * 0.5, h: shelfH + 0.4 });

  return finish(group, colliders, opts);
}

/** A sandbag emplacement: staggered courses on a shallow arc. The occupation. */
function sandbagEmplacement(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  // A filled bag is plumper than it looks in photographs: roughly 50 x 25 x 30
  // cm. The first pass ran it at 0.19 tall on a 0.55 base and the wall came
  // out as a paved path.
  const bagW = rr(rand, 0.40, 0.48);
  const bagH = rr(rand, 0.20, 0.26);
  const bagD = rr(rand, 0.24, 0.30);

  // Chest high or nothing. A two-course wall is a kerb, and cover you cannot
  // crouch behind does not read as an emplacement.
  const courses = 3 + Math.floor(rand() * 3);
  const perCourse = 5 + Math.floor(rand() * 4);
  const arc = rr(rand, 0.5, 1.5);           // radians the wall bends through
  const radius = (perCourse * bagW * 0.92) / arc;

  for (let c = 0; c < courses; c++) {
    // Stagger by half a bag every course, as they are actually laid, and drop
    // one bag per course higher up so the wall has a ragged top.
    const n = Math.max(2, perCourse - Math.floor(c * 0.7));
    const offset = (c % 2) * 0.5;

    for (let i = 0; i < n; i++) {
      if (chance(rand, 0.06)) continue;

      const t = (i + offset) / perCourse - 0.5;
      const a = t * arc;
      const x = Math.sin(a) * radius;
      const z = (Math.cos(a) - 1) * radius;

      // A filled sandbag is a pillow, and a heavily chamfered box is a cut
      // gem: the first pass looked like a row of quartz crystals. The same
      // squashed-sphere generator the grain sacks use is the right primitive,
      // flattened top AND bottom here so the courses stack flush.
      // Per-bag size jitter. Every bag being the same size is the clone tell
      // again, and on a wall of twenty it is unmissable.
      const k = rr(rand, 0.88, 1.12);
      const bag = new THREE.Mesh(
        bagGeometry(rand, bagW * k, bagH * rr(rand, 0.9, 1.1), bagD * k,
          { both: true, lumps: 0.18, segs: 10 }),
        pick(rand, mats.sandbag));
      bag.castShadow = true;
      bag.receiveShadow = true;

      bag.position.set(x + jit(rand, 0.018), bagH * (c + 0.5) * 0.92, z + jit(rand, 0.018));
      bag.rotation.y = a + jit(rand, 0.08);
      bag.rotation.z = jit(rand, 0.05);
      group.add(bag);
    }
  }

  // Three colliders sampled along the arc. One cylinder cannot describe a
  // curved wall, and the placer should not have to guess that.
  for (const t of [-0.36, 0, 0.36]) {
    const a = t * arc;
    colliders.push({
      x: Math.sin(a) * radius,
      z: (Math.cos(a) - 1) * radius,
      r: perCourse * bagW * 0.22,
      h: bagH * courses,
    });
  }

  return finish(group, colliders, opts);
}

/** Military ammunition crates: drab, latched, rope-handled, stacked. */
function ammoCrates(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const n = 1 + Math.floor(rand() * 3);
  const iron = pick(rand, mats.iron);
  let y = 0;
  let maxR = 0;

  for (let i = 0; i < n; i++) {
    const w = rr(rand, 0.72, 0.98);
    const h = rr(rand, 0.22, 0.32);
    const d = w * rr(rand, 0.42, 0.55);
    const mat = pick(rand, mats.drab);

    // Built in the crate's own frame and placed as a unit, for the same reason
    // the market crates are: trim positioned in parent space while the parent
    // is yawed ends up floating beside the thing it is supposed to be nailed to.
    const crate = new THREE.Group();

    crate.add(blockMesh(w, h, d, mat, DENSITY.timber,
      { chamfer: 0.018, eroded: 0.004, seed: i * 5 + 2 }));

    // Corner reinforcements and a lid lip: thin members that read as metal
    // banding from three metres and cost 12 triangles each.
    const lip = blockMesh(w * 1.03, 0.022, d * 1.03, iron, DENSITY.metal);
    lip.position.y = h * 0.5 - 0.012;
    crate.add(lip);

    for (const sx of [-1, 1]) {
      const band = blockMesh(0.02, h * 1.02, d * 1.03, iron, DENSITY.metal);
      band.position.x = sx * w * 0.36;
      crate.add(band);

      // Rope handle at each end: a half torus standing proud of the face. The
      // torus arc spans PI in its own XY plane, so it needs a quarter turn
      // about Z to put the two ends level and the bulge outward, then a half
      // turn about Y on the far end.
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(h * 0.28, 0.016, 3, 7, Math.PI), pick(rand, mats.cord));
      handle.position.set(sx * (w * 0.5 + 0.01), h * 0.05, 0);
      handle.rotation.set(0, sx > 0 ? 0 : Math.PI, -Math.PI / 2);
      crate.add(handle);
    }

    // A lid ajar on the top crate, because a sealed stack tells no story.
    if (i === n - 1 && chance(rand, 0.4)) {
      const lid = blockMesh(w, 0.035, d, mat, DENSITY.timber, { chamfer: 0.012 });
      lid.position.set(w * 0.2, h * 0.5 + 0.06, d * 0.14);
      lid.rotation.set(jit(rand, 0.1), jit(rand, 0.4), rr(rand, 0.08, 0.22));
      crate.add(lid);
    }

    crate.position.set(jit(rand, 0.07 * (i + 1)), y + h * 0.5, jit(rand, 0.07 * (i + 1)));
    crate.rotation.y = jit(rand, 0.22);
    group.add(crate);

    y += h;
    maxR = Math.max(maxR, Math.hypot(w, d) * 0.5);
  }

  colliders.push({ x: 0, z: 0, r: maxR * 0.9, h: y });

  return finish(group, colliders, opts);
}

// ---------------------------------------------------------------------------
// TIER 3: thin geometry, under 0.15 m in at least one dimension
//
// The tier the build has none of. Ropes, rails, bars, slats, cloth. Almost all
// of it is plain boxes and tubes: at these sizes a chamfer is under a pixel,
// and the level wants these in the hundreds.
//
// Several of these mount on a wall rather than the ground. Those are built
// around their own centre in the XY plane with +Z as the outward face normal,
// and are tagged `mount: 'wall'` in TIERS so the placer knows not to drop them
// on the sand.
// ---------------------------------------------------------------------------

/**
 * A rope slung between two anchors, with stakes at each end.
 *
 * The default span is deliberately long: the whole point of a rope line is
 * that it crosses more space than any solid prop can afford to.
 */
function ropeLine(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const span = opts.span ?? rr(rand, 4.5, 8.5);
  const hA = opts.heightA ?? rr(rand, 2.0, 3.0);
  const hB = opts.heightB ?? rr(rand, 1.8, 3.0);
  const sag = opts.sag ?? span * rr(rand, 0.06, 0.14);
  const cord = pick(rand, mats.cord);

  const from = new THREE.Vector3(-span * 0.5, hA, 0);
  const to = new THREE.Vector3(span * 0.5, hB, jit(rand, 0.3));

  const rope = new THREE.Mesh(
    catenary(from, to, sag, { radius: rr(rand, 0.016, 0.028), segments: 22 }), cord);
  rope.castShadow = true;
  group.add(rope);

  // A second line running slightly off the first, sagging differently. One
  // rope reads as a wire; two read as rigging.
  if (chance(rand, 0.45)) {
    const second = new THREE.Mesh(
      catenary(
        from.clone().add(new THREE.Vector3(0, rr(rand, -0.35, -0.12), rr(rand, 0.06, 0.2))),
        to.clone().add(new THREE.Vector3(0, rr(rand, -0.3, -0.05), rr(rand, -0.2, 0.06))),
        sag * rr(rand, 0.8, 1.35),
        { radius: rr(rand, 0.012, 0.02), segments: 20 }
      ), pick(rand, mats.cord));
    second.castShadow = true;
    group.add(second);
  }

  // Anchor posts, if the placer is not attaching to architecture.
  if (opts.posts !== false) {
    for (const [end, h] of [[from, hA], [to, hB]]) {
      const post = blockMesh(0.075, h, 0.075, pick(rand, mats.timber), DENSITY.timber);
      post.position.set(end.x, h * 0.5, end.z);
      post.rotation.set(jit(rand, 0.03), rand() * TAU, jit(rand, 0.03));
      group.add(post);
      colliders.push({ x: end.x, z: end.z, r: 0.13, h });

      const knot = new THREE.Mesh(
        new THREE.TorusGeometry(0.055, 0.014, 3, 7), cord);
      knot.position.set(end.x, h - 0.03, end.z);
      knot.rotation.x = Math.PI / 2;
      group.add(knot);
    }
  }

  return finish(group, colliders, opts);
}

/** A banner hanging from a crossbar: cloth, tattered hem, a pole above it. */
function banner(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const w = rr(rand, 0.7, 1.5);
  const h = rr(rand, 1.4, 2.8);
  const barY = opts.barHeight ?? rr(rand, 2.4, 3.4);

  const bar = tube(0.028, 0.028, w * 1.3, 6, pick(rand, mats.timber), DENSITY.timber);
  bar.rotation.z = Math.PI / 2;
  bar.position.y = barY;
  group.add(bar);

  const cloth = new THREE.Mesh(
    hangingCloth(w, h, { seed: rand() * 12, wave: rr(rand, 0.04, 0.12), tatter: rr(rand, 0.06, 0.26) }),
    pick(rand, mats.cloth)
  );
  cloth.position.y = barY - 0.02;
  cloth.rotation.y = jit(rand, 0.08);
  cloth.castShadow = true;
  cloth.receiveShadow = true;
  group.add(cloth);

  // Tie points along the bar. Four small rings, and they are what makes the
  // cloth read as hung rather than as floating.
  const ties = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < ties; i++) {
    const t = ties === 1 ? 0.5 : i / (ties - 1);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.008, 3, 7), pick(rand, mats.cord));
    ring.position.set(lerp(-w * 0.44, w * 0.44, t), barY, 0);
    group.add(ring);
  }

  return finish(group, colliders, opts);
}

/** A hanging chain: interlocked links, alternating plane, following the line. */
function chain(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const iron = pick(rand, mats.iron);
  const linkR = rr(rand, 0.032, 0.05);
  const wire = linkR * rr(rand, 0.24, 0.32);
  const top = opts.top ?? rr(rand, 1.6, 2.6);

  // Either hanging free from a point, or slung between two, which is the case
  // that needs the real catenary.
  const slung = opts.to !== undefined || chance(rand, 0.4);
  let curve = null;
  let length = top;

  if (slung) {
    const span = opts.span ?? rr(rand, 1.2, 3.0);
    const from = new THREE.Vector3(-span * 0.5, top, 0);
    const to = opts.to ?? new THREE.Vector3(span * 0.5, top + jit(rand, 0.4), 0);
    curve = catenaryCurve(from, to, span * rr(rand, 0.12, 0.28), 24);
    length = curve.getLength();
  } else {
    length = rr(rand, 0.7, 2.0);
  }

  // A link's PLANE contains the chain direction and its axis is perpendicular
  // to it, and consecutive links use the two perpendicular axes alternately.
  // Getting that backwards (aligning the axis WITH the chain, which is what
  // the first pass did) threads the links like washers on a rod, which is
  // instantly readable as wrong even at a glance.
  const Z = new THREE.Vector3(0, 0, 1);
  const UP = new THREE.Vector3(0, 1, 0);
  const tan = new THREE.Vector3();
  const n1 = new THREE.Vector3();
  const n2 = new THREE.Vector3();

  const links = Math.max(4, Math.round(length / (linkR * 1.5)));
  for (let i = 0; i < links; i++) {
    const t = i / Math.max(1, links - 1);
    const link = new THREE.Mesh(new THREE.TorusGeometry(linkR, wire, 3, 7), iron);
    link.castShadow = true;

    if (curve) {
      link.position.copy(curve.getPointAt(t));
      tan.copy(curve.getTangentAt(t));
    } else {
      link.position.set(jit(rand, 0.005), top - t * length, jit(rand, 0.005));
      tan.set(0, -1, 0);
    }

    n1.crossVectors(tan, UP);
    if (n1.lengthSq() < 1e-8) n1.set(1, 0, 0);
    n1.normalize();
    n2.crossVectors(tan, n1).normalize();

    link.quaternion.setFromUnitVectors(Z, i % 2 === 0 ? n1 : n2);
    group.add(link);
  }

  // Whatever it is hanging from: an eye bolt, ring plane vertical like a link.
  const eye = new THREE.Mesh(new THREE.TorusGeometry(linkR * 1.3, wire * 1.4, 3, 8), iron);
  eye.position.set(curve ? curve.getPointAt(0).x : 0, top + linkR * 0.8, 0);
  group.add(eye);

  return finish(group, colliders, opts);
}

/** Wooden poles and stakes driven into the ground at angles. */
function poles(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const n = 2 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const h = rr(rand, 0.8, 2.3);
    const r = rr(rand, 0.028, 0.055);
    const a = rand() * TAU;
    const d = i === 0 ? 0 : rr(rand, 0.15, 0.6);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;

    // Driven stakes lean. The lean angle is what separates a stake field from
    // a fence, and a vertical stake next to a leaning one sells both.
    const lean = chance(rand, 0.7) ? rr(rand, 0.04, 0.28) : 0;
    const leanDir = rand() * TAU;

    const p = tube(r * rr(rand, 0.7, 0.95), r, h, 6, pick(rand, mats.timber), DENSITY.timber);
    p.position.set(x, h * 0.45, z);
    p.rotation.set(Math.cos(leanDir) * lean, rand() * TAU, Math.sin(leanDir) * lean);
    group.add(p);

    // A split top on some of them: two thin slivers spreading from the crown,
    // which is what a driven post actually does under a maul.
    if (chance(rand, 0.35)) {
      for (const s of [-1, 1]) {
        const sp = blockMesh(r * 0.5, h * rr(rand, 0.1, 0.2), r * 0.5,
          pick(rand, mats.timber), DENSITY.timber);
        sp.position.set(x + s * r * 0.5, h * 0.95, z);
        sp.rotation.z = s * rr(rand, 0.15, 0.4);
        group.add(sp);
      }
    }

    // A lashed crossbar between the first two poles.
    if (i === 1 && chance(rand, 0.5)) {
      const bar = blockMesh(d * 1.1, 0.035, 0.035, pick(rand, mats.timber), DENSITY.timber);
      bar.position.set(x * 0.5, Math.min(h, 1.2) * 0.8, z * 0.5);
      bar.rotation.y = -a;
      bar.rotation.z = jit(rand, 0.06);
      group.add(bar);
    }

    if (h > 1.2) colliders.push({ x, z, r: r + 0.06, h });
  }

  return finish(group, colliders, opts);
}

/** A railing run: posts, top and bottom rails, balusters, some of them gone. */
function railing(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const len = opts.length ?? rr(rand, 2.2, 5.0);
  const h = rr(rand, 0.9, 1.15);
  const stone = chance(rand, 0.4);
  const mat = stone ? mats.limestone : pick(rand, mats.timber);
  const density = stone ? DENSITY.stone : DENSITY.timber;

  const posts = Math.max(2, Math.round(len / rr(rand, 1.0, 1.5)) + 1);
  for (let i = 0; i < posts; i++) {
    const x = lerp(-len * 0.5, len * 0.5, i / (posts - 1));
    const ph = h * rr(rand, 1.02, 1.12);
    const p = blockMesh(0.09, ph, 0.09, mat, density,
      stone ? { chamfer: 0.014, eroded: 0.006, seed: i * 3 } : {});
    p.position.set(x, ph * 0.5, 0);
    p.rotation.y = jit(rand, 0.03);
    group.add(p);
  }

  for (const y of [h, h * rr(rand, 0.2, 0.3)]) {
    const rail = blockMesh(len, 0.055, 0.055, mat, density);
    rail.position.set(0, y, 0);
    rail.rotation.z = jit(rand, 0.008);
    group.add(rail);
  }

  // Balusters: the reason this prototype exists. At 3.5 cm square they are
  // pure tier-3, they number in the dozens per run, and a chamfer on them
  // would cost 32 extra triangles each for something under a pixel wide.
  const spacing = rr(rand, 0.15, 0.22);
  const count = Math.floor(len / spacing);
  const balH = h - h * 0.25;

  for (let i = 0; i <= count; i++) {
    if (chance(rand, 0.08)) continue;   // knocked out

    const x = lerp(-len * 0.48, len * 0.48, i / count);
    const bw = stone ? 0.055 : 0.035;
    const b = blockMesh(bw, balH, bw, mat, density);
    b.position.set(x, h * 0.25 + balH * 0.5, jit(rand, 0.004));
    b.rotation.set(jit(rand, 0.03), jit(rand, 0.05), jit(rand, 0.02));
    group.add(b);
  }

  const segs = Math.max(2, Math.round(len / 1.6));
  for (let i = 0; i < segs; i++) {
    colliders.push({
      x: lerp(-len * 0.4, len * 0.4, segs === 1 ? 0.5 : i / (segs - 1)),
      z: 0, r: len / segs * 0.5, h,
    });
  }

  return finish(group, colliders, opts);
}

/** A window grille: frame, vertical bars, cross bars, some bent. Wall mounted. */
function grille(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();

  const w = opts.width ?? rr(rand, 0.7, 1.2);
  const h = opts.height ?? rr(rand, 0.9, 1.5);
  const iron = pick(rand, mats.iron);

  const frameT = rr(rand, 0.035, 0.055);
  for (const sy of [-1, 1]) {
    const f = blockMesh(w + frameT, frameT, frameT, iron, DENSITY.metal);
    f.position.set(0, sy * h * 0.5, 0);
    group.add(f);
  }
  for (const sx of [-1, 1]) {
    const f = blockMesh(frameT, h + frameT, frameT, iron, DENSITY.metal);
    f.position.set(sx * w * 0.5, 0, 0);
    group.add(f);
  }

  const bars = 3 + Math.floor(rand() * 5);
  const barT = rr(rand, 0.018, 0.028);
  for (let i = 0; i < bars; i++) {
    const t = (i + 1) / (bars + 1);
    const bent = chance(rand, 0.18);
    const b = blockMesh(barT, h * (bent ? 0.86 : 1.0), barT, iron, DENSITY.metal);
    b.position.set(lerp(-w * 0.5, w * 0.5, t), bent ? h * 0.04 : 0, jit(rand, 0.004));
    // A bar someone levered aside to get in. One is enough to change what the
    // window means.
    b.rotation.z = bent ? rr(rand, 0.1, 0.32) * (chance(rand, 0.5) ? 1 : -1) : jit(rand, 0.012);
    group.add(b);
  }

  const crosses = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < crosses; i++) {
    const t = (i + 1) / (crosses + 1);
    const c = blockMesh(w, barT, barT * 0.9, iron, DENSITY.metal);
    c.position.set(0, lerp(-h * 0.5, h * 0.5, t), barT * 0.8);
    group.add(c);
  }

  // Nothing collides with a grille; the wall it is bolted to already does.
  return finish(group, [], opts);
}

/** A window shutter: frame, angled slats, hinge straps. Wall mounted. */
function shutter(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();

  const w = opts.width ?? rr(rand, 0.42, 0.7);
  const h = opts.height ?? rr(rand, 0.9, 1.5);
  const wood = pick(rand, mats.timber);
  const iron = pick(rand, mats.iron);

  const leaf = new THREE.Group();
  const frameT = rr(rand, 0.03, 0.045);

  for (const sy of [-1, 1]) {
    const f = blockMesh(w, frameT * 1.6, frameT, wood, DENSITY.timber);
    f.position.set(0, sy * (h * 0.5 - frameT), 0);
    leaf.add(f);
  }
  for (const sx of [-1, 1]) {
    const f = blockMesh(frameT * 1.4, h, frameT, wood, DENSITY.timber);
    f.position.set(sx * (w * 0.5 - frameT * 0.7), 0, 0);
    leaf.add(f);
  }

  // The slats. Angled, so each one catches the sun at a different value and
  // the shutter reads as louvred rather than as a panel.
  const slats = Math.max(4, Math.floor(h / rr(rand, 0.075, 0.11)));
  const tilt = rr(rand, 0.42, 0.68);
  for (let i = 0; i < slats; i++) {
    if (chance(rand, 0.07)) continue;   // a missing slat

    const y = lerp(-h * 0.45, h * 0.45, i / (slats - 1));
    const s = blockMesh(w * 0.9, 0.012, rr(rand, 0.05, 0.07), wood, DENSITY.timber);
    s.position.set(0, y, 0);
    s.rotation.x = tilt + jit(rand, 0.06);
    leaf.add(s);
  }

  for (const sy of [-1, 1]) {
    const strap = blockMesh(w * 0.5, 0.018, 0.012, iron, DENSITY.metal);
    strap.position.set(-w * 0.2, sy * h * 0.34, frameT * 0.8);
    leaf.add(strap);
  }

  // Hanging by one hinge is the most common state of a shutter in an abandoned
  // street, and it costs one rotation about the hinge edge.
  if (chance(rand, 0.4)) {
    leaf.position.x = -w * 0.5;
    leaf.rotation.z = rr(rand, 0.12, 0.5);
    leaf.position.applyAxisAngle(new THREE.Vector3(0, 0, 1), 0);
    const pivot = new THREE.Group();
    pivot.position.x = w * 0.5;
    pivot.add(leaf);
    group.add(pivot);
  } else {
    // Or swung open on its hinge, which is what puts it out of the wall plane
    // and gives the facade a piece of real depth.
    const pivot = new THREE.Group();
    pivot.position.x = -w * 0.5;
    pivot.rotation.y = rr(rand, 0.3, 1.5) * (chance(rand, 0.5) ? 1 : -1);
    leaf.position.x = w * 0.5;
    pivot.add(leaf);
    group.add(pivot);
  }

  return finish(group, [], opts);
}

/** A mashrabiya lattice screen: diagonal grid in a frame. Wall mounted. */
function mashrabiya(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();

  const w = opts.width ?? rr(rand, 0.8, 1.4);
  const h = opts.height ?? rr(rand, 1.0, 1.8);
  const wood = pick(rand, mats.timber);

  const frameT = rr(rand, 0.045, 0.065);
  for (const sy of [-1, 1]) {
    const f = blockMesh(w + frameT, frameT, frameT * 1.2, wood, DENSITY.timber);
    f.position.set(0, sy * h * 0.5, 0);
    group.add(f);
  }
  for (const sx of [-1, 1]) {
    const f = blockMesh(frameT, h + frameT, frameT * 1.2, wood, DENSITY.timber);
    f.position.set(sx * w * 0.5, 0, 0);
    group.add(f);
  }

  // Two sets of diagonals at plus and minus 45. The diagonal is the whole
  // point: a rectangular grid reads as a window, a diagonal one reads as
  // turned latticework, and the sun through it throws a diamond pattern that
  // nothing else in the scene can produce.
  //
  // Each member is CLIPPED to the panel rectangle rather than drawn at a fixed
  // length. Guessing the chord from the offset (the first attempt) overshot
  // every diagonal past the frame, which turned the screen into a pile of
  // sticks leaning on a wall.
  const pitch = rr(rand, 0.10, 0.17);
  const memberT = rr(rand, 0.014, 0.022);
  const s = Math.SQRT1_2;

  for (const sign of [1, -1]) {
    // Direction of this diagonal family, and the unit normal to it. Offsetting
    // along the normal walks the whole family across the panel.
    const dx = s, dy = s * sign;
    const nx = -s * sign, ny = s;
    const maxOff = (Math.abs(nx) * w + Math.abs(ny) * h) * 0.5;

    for (let off = -maxOff; off <= maxOff; off += pitch) {
      const cx = off * nx, cy = off * ny;

      // Slab clip of the infinite line against the panel rectangle. Both
      // direction components are non-zero at 45 degrees, so no guard needed.
      let t0 = -Infinity, t1 = Infinity;
      for (const [c, dd, lim] of [[cx, dx, w * 0.5], [cy, dy, h * 0.5]]) {
        const a = (-lim - c) / dd, b = (lim - c) / dd;
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
      }
      const len = t1 - t0;
      if (len <= pitch * 0.6) continue;

      const mid = (t0 + t1) * 0.5;
      const m = blockMesh(len, memberT, memberT, wood, DENSITY.timber);
      m.position.set(cx + dx * mid, cy + dy * mid, sign > 0 ? memberT * 0.6 : -memberT * 0.6);
      m.rotation.z = sign * Math.PI / 4;
      group.add(m);
    }
  }

  // A row of turned balusters under the head rail, the other half of the form.
  // They sit proud of the lattice so they read as a separate order of member.
  if (chance(rand, 0.6)) {
    const n = 3 + Math.floor(rand() * 4);
    const balH = h * 0.2;
    const railY = h * 0.5 - frameT - balH * 0.5;

    const rail = blockMesh(w, frameT * 0.8, frameT * 1.1, wood, DENSITY.timber);
    rail.position.set(0, railY - balH * 0.5, memberT * 1.6);
    group.add(rail);

    for (let i = 0; i < n; i++) {
      const x = lerp(-w * 0.4, w * 0.4, n === 1 ? 0.5 : i / (n - 1));
      const b = tube(0.02, 0.032, balH, 6, wood, DENSITY.timber);
      b.position.set(x, railY, memberT * 1.6);
      group.add(b);
    }
  }

  return finish(group, [], opts);
}

/** Tent guy-lines: taut, near-straight, pegged. The contrast to a slack rope. */
function guyLines(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const apexH = opts.apexHeight ?? rr(rand, 2.0, 3.2);
  const n = 3 + Math.floor(rand() * 3);
  const spread = rr(rand, 1.4, 2.6);
  const cord = pick(rand, mats.cord);

  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + jit(rand, 0.3);
    const d = spread * rr(rand, 0.85, 1.15);
    const px = Math.cos(a) * d;
    const pz = Math.sin(a) * d;

    // Sag near zero on purpose. A guy-line is under tension and a rope is not,
    // and running both through the same catenary solver with different sag is
    // what makes the difference legible instead of accidental.
    const line = new THREE.Mesh(
      catenary(
        new THREE.Vector3(jit(rand, 0.06), apexH, jit(rand, 0.06)),
        new THREE.Vector3(px, 0.06, pz),
        rr(rand, 0.005, 0.03),
        { radius: rr(rand, 0.008, 0.014), segments: 8, radialSegments: 3 }
      ), cord);
    line.castShadow = true;
    group.add(line);

    // The peg, driven at an angle away from the pull.
    const peg = blockMesh(0.028, rr(rand, 0.18, 0.3), 0.028,
      pick(rand, mats.timber), DENSITY.timber);
    peg.position.set(px, 0.07, pz);
    peg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    group.add(peg);
  }

  // The mast the lines hold up.
  if (opts.mast !== false) {
    const mast = tube(0.04, 0.055, apexH, 7, pick(rand, mats.timber), DENSITY.timber);
    mast.position.y = apexH * 0.5;
    mast.rotation.set(jit(rand, 0.02), 0, jit(rand, 0.02));
    group.add(mast);
    colliders.push({ x: 0, z: 0, r: 0.12, h: apexH });
  }

  return finish(group, colliders, opts);
}

/**
 * Draped netting: warp and weft ribbons following a sagging surface.
 *
 * Built as real thin geometry rather than an alpha-cut sheet, because there
 * are no image assets in this project and a procedural alpha map would cost a
 * canvas, a texture, and a transparent draw for something that is ~300
 * triangles as honest geometry.
 */
function netting(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();

  const w = opts.width ?? rr(rand, 2.0, 3.6);
  const d = opts.depth ?? rr(rand, 1.4, 2.6);
  const sag = rr(rand, 0.25, 0.7);
  const y = opts.height ?? rr(rand, 1.9, 2.8);

  const rows = 5 + Math.floor(rand() * 4);
  const cols = 6 + Math.floor(rand() * 5);
  const t = rr(rand, 0.008, 0.014);
  const seed = rand() * 10;

  // The same double half-sine the awning uses, sampled instead of tessellated.
  const surf = (u, v) => -sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v)
    + Math.sin(u * 8.3 + seed) * Math.cos(v * 6.1 - seed) * 0.03;

  const pos = [];
  const idx = [];
  let base = 0;

  /**
   * One strand as a CROSS of two ribbons in perpendicular planes.
   *
   * A single flat ribbon is invisible edge on, and a net is seen edge on from
   * roughly half of all viewing angles. The first pass used one ribbon per
   * strand and the whole net rendered as a scatter of disconnected dashes in
   * the sky. Two ribbons at 90 degrees cost twice the triangles of nothing and
   * the strand never disappears.
   */
  const strand = (samples, pa, pb) => {
    for (const perp of [pa, pb]) {
      for (const p of samples) {
        pos.push(p.x - perp[0] * t, p.y - perp[1] * t, p.z - perp[2] * t);
        pos.push(p.x + perp[0] * t, p.y + perp[1] * t, p.z + perp[2] * t);
      }
      for (let i = 0; i < samples.length - 1; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      base += samples.length * 2;
    }
  };

  const SEG = 9;
  // Rows run along X, so their perpendiculars are Y and Z; columns run along Z,
  // so theirs are X and Y.
  for (let r = 0; r < rows; r++) {
    const v = (r + 0.5) / rows;
    const s = [];
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      s.push({ x: (u - 0.5) * w, y: surf(u, v), z: (v - 0.5) * d });
    }
    strand(s, [0, 1, 0], [0, 0, 1]);
  }
  for (let c = 0; c < cols; c++) {
    const u = (c + 0.5) / cols;
    const s = [];
    for (let i = 0; i <= SEG; i++) {
      const v = i / SEG;
      s.push({ x: (u - 0.5) * w, y: surf(u, v) - t * 1.2, z: (v - 0.5) * d });
    }
    strand(s, [1, 0, 0], [0, 1, 0]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const net = new THREE.Mesh(geo, pick(rand, mats.cord));
  net.position.y = y;
  net.rotation.y = jit(rand, 0.2);
  net.castShadow = true;
  group.add(net);

  return finish(group, [], opts);
}

/** A bundle of cut reeds, bound and standing, splaying at the top. */
function reedBundle(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const h = rr(rand, 1.1, 2.2);
  const n = 9 + Math.floor(rand() * 12);
  const splay = rr(rand, 0.08, 0.22);
  const baseR = rr(rand, 0.07, 0.13);
  const lean = rr(rand, 0.0, 0.09);

  for (let i = 0; i < n; i++) {
    // Golden angle so the section is evenly filled without a visible ring.
    const a = i * 2.39996;
    const rad = baseR * Math.sqrt((i + 0.5) / n);
    const rh = h * rr(rand, 0.82, 1.0);

    const reed = tube(0.007, 0.012, rh, 4, pick(rand, mats.reed), DENSITY.cord, { cast: false });
    reed.position.set(Math.cos(a) * rad, rh * 0.5, Math.sin(a) * rad);
    // Each stem tips outward as it rises, which is the splay that stops the
    // bundle reading as a solid cylinder.
    reed.rotation.set(-Math.sin(a) * splay, 0, Math.cos(a) * splay);
    group.add(reed);
  }

  // Two or three bindings. Where the cord is, the bundle is tight; between
  // them it is not, and that is the whole silhouette.
  for (const t of [0.18, 0.55, 0.85]) {
    if (t > 0.6 && chance(rand, 0.4)) continue;
    const tie = new THREE.Mesh(
      new THREE.TorusGeometry(baseR * (1 + splay * t * 3.2), 0.014, 3, 9),
      pick(rand, mats.cord));
    tie.rotation.x = Math.PI / 2;
    tie.position.y = h * t;
    group.add(tie);
  }

  group.rotation.z = lean * (chance(rand, 0.5) ? 1 : -1);
  colliders.push({ x: 0, z: 0, r: baseR * 2.2, h });

  return finish(group, colliders, opts);
}

/** A laundry line: catenary rope between two poles, cloth folded over it. */
function laundryLine(rand, opts = {}) {
  const mats = propMaterials();
  const group = new THREE.Group();
  const colliders = [];

  const span = opts.span ?? rr(rand, 3.5, 6.5);
  const hA = rr(rand, 1.9, 2.6);
  const hB = rr(rand, 1.9, 2.6);
  const sag = span * rr(rand, 0.05, 0.11);
  const cord = pick(rand, mats.cord);

  const from = new THREE.Vector3(-span * 0.5, hA, 0);
  const to = new THREE.Vector3(span * 0.5, hB, 0);
  const curve = catenaryCurve(from, to, sag, 24);

  const rope = new THREE.Mesh(
    catenary(from, to, sag, { radius: 0.013, segments: 24, radialSegments: 3 }), cord);
  rope.castShadow = true;
  group.add(rope);

  // The washing. Each piece is two sheets meeting at the line, because a
  // single sheet hanging from a rope is a flag, and cloth folded over a line
  // is laundry. The asymmetric halves are what makes it read as thrown on.
  const pieces = 3 + Math.floor(rand() * 4);
  for (let i = 0; i < pieces; i++) {
    const t = (i + rr(rand, 0.25, 0.75)) / pieces;
    const p = curve.getPointAt(Math.min(0.97, Math.max(0.03, t)));
    const cw = rr(rand, 0.35, 0.7);
    const mat = pick(rand, mats.cloth);
    const yaw = jit(rand, 0.35);

    for (const side of [-1, 1]) {
      const ch = rr(rand, 0.4, 0.95);
      const sheet = new THREE.Mesh(
        hangingCloth(cw, ch, {
          seed: rand() * 15, wave: rr(rand, 0.03, 0.09), tatter: rr(rand, 0.02, 0.12),
        }), mat);
      sheet.position.copy(p);
      sheet.position.z += side * rr(rand, 0.012, 0.03);
      sheet.rotation.y = yaw;
      sheet.rotation.x = side * rr(rand, 0.02, 0.09);
      sheet.castShadow = true;
      group.add(sheet);
    }

    // A peg on the line.
    if (chance(rand, 0.7)) {
      const peg = blockMesh(0.016, 0.055, 0.016, pick(rand, mats.timber), DENSITY.timber);
      peg.position.copy(p);
      peg.position.x += cw * rr(rand, 0.28, 0.45) * (chance(rand, 0.5) ? 1 : -1);
      peg.position.y -= 0.012;
      group.add(peg);
    }
  }

  for (const [end, h] of [[from, hA], [to, hB]]) {
    const post = blockMesh(0.07, h, 0.07, pick(rand, mats.timber), DENSITY.timber);
    post.position.set(end.x, h * 0.5, end.z);
    post.rotation.set(jit(rand, 0.04), rand() * TAU, jit(rand, 0.04));
    group.add(post);
    colliders.push({ x: end.x, z: end.z, r: 0.12, h });
  }

  return finish(group, colliders, opts);
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

/**
 * Common tail for every builder: apply an optional uniform scale (to the group
 * AND to the colliders, or the two representations silently disagree), tag the
 * group, and hand back the contract shape.
 */
function finish(group, colliders, opts) {
  const s = opts.scale ?? 1;
  if (s !== 1) {
    group.scale.setScalar(s);
    colliders = colliders.map((c) => ({ x: c.x * s, z: c.z * s, r: c.r * s, h: c.h * s }));
  }
  if (opts.yaw) group.rotation.y += opts.yaw;
  return { group, colliders };
}

/**
 * The kit. Name to builder, and nothing else in the module is exported as a
 * builder, so the placer can drive the whole thing off Object.keys.
 */
export const PROPS = {
  // tier 2, furniture scale
  marketStall,
  crateStack,
  amphora,
  amphoraCluster,
  grainSacks,
  bench,
  offeringTable,
  brazier,
  cart,
  scaffold,
  mudbrickPile,
  waterTrough,
  reedMats,
  statueTorso,
  canopicSet,
  sandbagEmplacement,
  ammoCrates,

  // tier 3, thin
  ropeLine,
  banner,
  chain,
  poles,
  railing,
  grille,
  shutter,
  mashrabiya,
  guyLines,
  netting,
  reedBundle,
  laundryLine,
};

/**
 * Placement manifest.
 *
 * `radius` is a suggested footprint for occupancy testing, in metres, sized to
 * the LARGEST instance a builder can produce rather than the average: an
 * occupancy test that passes for the mean and fails for the tail produces
 * exactly the interpenetration this kit exists to avoid.
 *
 * `mount` is where the prop attaches:
 *   ground - sits on the floor, origin at the base
 *   wall   - hangs on a vertical face, origin at the centre of the panel,
 *            +Z pointing out of the wall
 *   span   - anchored at two points and crosses open space; the placer should
 *            be picking anchor pairs for these, not floor positions
 */
export const TIERS = {
  tier2: [
    { name: 'marketStall', radius: 1.9, height: 2.5, mount: 'ground' },
    { name: 'crateStack', radius: 1.2, height: 1.9, mount: 'ground' },
    { name: 'amphora', radius: 0.6, height: 1.1, mount: 'ground' },
    { name: 'amphoraCluster', radius: 1.8, height: 1.1, mount: 'ground' },
    { name: 'grainSacks', radius: 1.0, height: 1.2, mount: 'ground' },
    { name: 'bench', radius: 1.2, height: 0.7, mount: 'ground' },
    { name: 'offeringTable', radius: 0.8, height: 1.1, mount: 'ground' },
    { name: 'brazier', radius: 0.5, height: 1.3, mount: 'ground' },
    { name: 'cart', radius: 1.5, height: 1.3, mount: 'ground' },
    { name: 'scaffold', radius: 1.6, height: 3.6, mount: 'ground' },
    { name: 'mudbrickPile', radius: 1.5, height: 1.0, mount: 'ground' },
    { name: 'waterTrough', radius: 1.2, height: 0.6, mount: 'ground' },
    { name: 'reedMats', radius: 0.9, height: 0.7, mount: 'ground' },
    { name: 'statueTorso', radius: 1.0, height: 2.1, mount: 'ground' },
    { name: 'canopicSet', radius: 0.7, height: 0.9, mount: 'ground' },
    { name: 'sandbagEmplacement', radius: 2.4, height: 0.8, mount: 'ground' },
    { name: 'ammoCrates', radius: 0.8, height: 1.0, mount: 'ground' },
  ],

  tier3: [
    { name: 'ropeLine', radius: 4.5, height: 3.0, mount: 'span' },
    { name: 'banner', radius: 0.9, height: 3.4, mount: 'ground' },
    { name: 'chain', radius: 1.6, height: 3.3, mount: 'span' },
    { name: 'poles', radius: 0.8, height: 2.3, mount: 'ground' },
    { name: 'railing', radius: 2.6, height: 1.3, mount: 'ground' },
    { name: 'grille', radius: 0.7, height: 1.5, mount: 'wall' },
    { name: 'shutter', radius: 0.7, height: 1.5, mount: 'wall' },
    { name: 'mashrabiya', radius: 0.8, height: 1.8, mount: 'wall' },
    { name: 'guyLines', radius: 3.0, height: 3.2, mount: 'ground' },
    { name: 'netting', radius: 2.0, height: 2.8, mount: 'span' },
    { name: 'reedBundle', radius: 0.35, height: 2.2, mount: 'ground' },
    { name: 'laundryLine', radius: 3.4, height: 2.6, mount: 'span' },
  ],
};

/** 2 or 3, or 0 if the name is not in the kit. */
export function tierOf(name) {
  if (TIERS.tier2.some((e) => e.name === name)) return 2;
  if (TIERS.tier3.some((e) => e.name === name)) return 3;
  return 0;
}

/** Flat lookup, since the placer wants radius by name far more than by tier. */
export const PROP_INFO = Object.fromEntries(
  [...TIERS.tier2, ...TIERS.tier3].map((e) => [e.name, e])
);

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

/** Same generator as courtyard.js and scatter.js, so seeds mean one thing. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Lay every prototype out on a grid so the kit can be screenshotted and judged.
 *
 * This exists because "does a rolled reed mat read as a rolled reed mat" is not
 * a question any test can answer, and the only way to find out that a prop came
 * out chunky, floating, or degenerate is to look at it at eye height. Two
 * instances per cell, so the anti-clone variation is visible in the same frame
 * as the prop itself.
 *
 * Wall-mounted prototypes get a stub of wall to hang on, because a shutter
 * floating in space tells you nothing about whether it works on a facade.
 *
 * @returns {{group, cells, count}} cells map name to world position so a
 *          harness can drive a camera to each one by name.
 */
export function buildPropKitPreview(scene, {
  spacing = 7.0,
  columns = 6,
  seed = 20260726,
  variants = 2,
} = {}) {
  const M = buildMaterials();
  const rand = rng(seed);

  const group = new THREE.Group();
  group.name = 'propkit-preview';
  scene.add(group);

  const entries = [...TIERS.tier2, ...TIERS.tier3];
  const rows = Math.ceil(entries.length / columns);

  // Ground. Big enough to fall off the frame in every shot, and using the
  // shared sand material so the props are judged against the real backdrop.
  const groundSize = Math.max(columns, rows) * spacing + spacing * 4;
  const ground = new THREE.Mesh(plane(groundSize, groundSize, 1, 0.22), M.sand);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const cells = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const col = i % columns;
    const row = Math.floor(i / columns);

    const x = (col - (columns - 1) * 0.5) * spacing;
    const z = (row - (rows - 1) * 0.5) * spacing;

    const cell = new THREE.Group();
    cell.position.set(x, 0, z);
    cell.name = `cell-${entry.name}`;
    group.add(cell);

    if (entry.mount === 'wall') {
      const wall = new THREE.Mesh(
        chamferedBox(4.2, 3.2, 0.34, 0.05, 0.17), M.limestone);
      wall.position.set(0, 1.6, -0.4);
      wall.castShadow = true;
      wall.receiveShadow = true;
      cell.add(wall);
    }

    // Span props get ONE instance: they are metres wide by definition, and two
    // of them in a cell overlap each other into an unreadable tangle rather
    // than showing the variation the second instance is there to prove.
    const n = entry.mount === 'span' ? 1 : variants;

    for (let v = 0; v < n; v++) {
      const built = PROPS[entry.name](rand, {});
      // Separate by the actual footprint, capped only by the cell.
      const step = Math.min(spacing * 0.42, entry.radius * 1.25);
      const off = n === 1 ? 0 : (v - (n - 1) * 0.5) * 2 * step;

      if (entry.mount === 'wall') {
        built.group.position.set(off, 1.45 + jit(rand, 0.15), -0.22);
      } else {
        built.group.position.set(off, 0, 0);
      }
      cell.add(built.group);
    }

    cells.push({ name: entry.name, tier: tierOf(entry.name), x, z, ...entry });
  }

  return { group, cells, count: entries.length };
}
