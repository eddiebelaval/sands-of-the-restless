/**
 * The shambling dead: geometry, animation, and the actor that drives them.
 *
 * NO SKINNING, NO LOADERS, NO BONES. A wrapped corpse is a stack of rigid
 * boxes on nested groups, and every joint is a rotation driven by a sine of the
 * walk phase. The reference project spends 25 bones and four IK layers on a
 * soldier and still reports that its characters "read as mannequins at
 * distance"; at twenty metres the thing that sells an undead is the SILHOUETTE
 * and the LURCH, neither of which needs a skeleton. What a skeleton would buy
 * us here is smooth deformation at the elbow, which is precisely the detail a
 * bandaged limb is supposed to hide.
 *
 * Three consequences fall out of that decision and all three are load bearing:
 *
 *   - The walk cycle is driven by REAL horizontal velocity, not a free-running
 *     timer. A staggered enemy's legs slow down with it, and one pinned against
 *     a pillar stops walking on the spot. A timer-driven cycle is the single
 *     loudest tell that a character is a puppet.
 *   - Geometry is shared across every instance of a variant. Twelve shamblers
 *     are twelve scene graphs pointing at one set of BufferGeometries, so the
 *     pool costs memory once no matter how deep it is.
 *   - Materials are NOT shared, because the hit flash is per instance. Five
 *     small MeshStandardMaterials per actor, allocated when the pool is built
 *     and never again.
 *
 * DEATH DOES NOT USE TRANSPARENCY. Flipping `transparent` on a live material
 * forces a program swap, which is a visible hitch at the exact moment the
 * player has earned a kill, and a transparent corpse also has to be depth
 * sorted against every other corpse. The topple ends in a sink through the
 * floor with a scale taper instead: opaque the whole way, no recompile, and it
 * reads as the body crumbling back into the sand.
 *
 * Every rate in this file is per second and multiplied by the clamped delta the
 * frame loop hands down.
 */

import * as THREE from 'three';
import { chamferedBox } from '../world/geometry.js';
import { plane } from '../world/uv.js';

/**
 * Shared geometry, keyed by shape rather than by variant, so two variants that
 * happen to want the same 0.14 x 0.42 x 0.15 limb get one BufferGeometry
 * between them. Built lazily on the first pool that asks, which is still boot
 * time: nothing in here is reachable from the spawn path.
 */
const GEO = new Map();

/** Prop-scale texture density. Enemy materials carry no maps, but a limb that
 * later gets one should not inherit a wall's 0.17 tiles per unit. */
const PART_TILES = 1.4;

function partGeo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  let g = GEO.get(key);
  if (!g) {
    // The chamfer is proportional to the smallest dimension. A fixed 6 cm
    // chamfer on a 12 cm forearm eats the whole member.
    g = chamferedBox(w, h, d, Math.min(w, h, d) * 0.16, PART_TILES);
    GEO.set(key, g);
  }
  return g;
}

/**
 * A torn wrap.
 *
 * NOT a rectangle. A flat quad hanging off a box-man is another box-man edge,
 * and the whole reason to spend geometry on cloth is to break the axis-aligned
 * outline that everything else in a primitives-only character has. So the strip
 * tapers as it falls, its hem is torn at three different lengths, and it curls
 * out of its own plane so it still reads from the side rather than vanishing
 * edge-on.
 *
 * The jitter is seeded by `cut`, so the shapes are stable across a run - the
 * geometry is shared by every instance that asks for the same one - and three
 * cuts is enough that no two rags on one body are the same tear.
 */
function stripGeo(w, h, cut = 0) {
  const key = `strip|${w}|${h}|${cut}`;
  let g = GEO.get(key);
  if (!g) {
    g = plane(w, h, 4, PART_TILES);

    let seed = (cut + 1) * 9301 + 49297;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const t = (h / 2 - y) / h;                  // 0 at the top, 1 at the hem

      pos.setX(i, x * (1 - t * (0.30 + rnd() * 0.34)));
      if (t > 0.7) pos.setY(i, y + (rnd() - 0.55) * h * 0.30);
      pos.setZ(i, (rnd() - 0.5) * w * 0.55 * t);  // the curl, growing downward
    }

    pos.needsUpdate = true;
    g.computeVertexNormals();
    // Built in XY around its centre; the anchor wants to swing from the top,
    // so shift it down once here rather than on every instance.
    g.translate(0, -h / 2, 0);
    GEO.set(key, g);
  }
  return g;
}

// ---------------------------------------------------------------------------
// scratch
// ---------------------------------------------------------------------------

// Allocated once for the module. Every actor runs through the same update and
// they never nest, so one set of scratch is enough for the whole horde.
const _dir = new THREE.Vector3();
const _steer = new THREE.Vector3();
const _probe = new THREE.Vector3();

/**
 * THE CHAMBER FLOOR: the smallest amount of self-illumination that stops a
 * wrapped corpse being a hole in a dark room.
 *
 * MEASURED, not judged. Standing a shambler seven metres away in the Great
 * Gallery and sampling its exact silhouette against the pixels it covers, 54
 * PER CENT of its body was below luma 8 - flat black - while the eye sockets
 * and the gilding stayed lit. That histogram is the "black robot with a
 * glowing visor" reading in numbers, and it is a property of the ROOM, not of
 * the linen: the same body in sun runs a lit-to-shadow ratio over 6.
 *
 * A floor fixes what a palette cannot, because it is additive. Against sunlit
 * sand at luma 140 it is under one per cent and cannot be seen; against a
 * chamber wall at luma 14 it is the difference between a silhouette and a
 * void. Swept at 0.05 / 0.08 / 0.11 against the same background:
 *
 *              7 m chamber            14 m chamber          20 m sun
 *              black px  legible      black px  legible     legible
 *   none        54.2%     70.9         40.8%     75.6        81.8
 *   0.05        45.7%     74.7         29.4%     72.1        79.5
 *   0.08        36.3%     76.8         18.6%     70.0        77.9
 *   0.11        21.5%     80.6          9.1%     65.3        78.5
 *
 * 0.08 halves the black end in both chambers and still leaves the body a clear
 * 27 per cent DARKER than the wall behind it at fourteen metres. 0.11 keeps
 * going and starts pulling the body up onto the background's own value, which
 * is a different way to be invisible.
 *
 * It goes on the linen and the rags only. `deep` stays a void - the sockets
 * under the brow are supposed to be holes - and `accent` is metal that already
 * catches a highlight.
 */
const EMISSIVE_FLOOR = 0.08;
const CHAMBER_FLOOR = new THREE.Color(0x6b5a3c).multiplyScalar(EMISSIVE_FLOOR);

// ---------------------------------------------------------------------------
// world queries, shared with the bosses
// ---------------------------------------------------------------------------

/**
 * Floor height under a point.
 *
 * Same three-argument contract the player controller uses, so an enemy walks up
 * the gallery ramp and refuses to snap onto the ledge it is walking underneath
 * for exactly the same reason the player does.
 */
export function groundAt(ctx, x, z, feetY) {
  return ctx.heightAt ? ctx.heightAt(x, z, feetY) : 0;
}

/**
 * Push a cylinder of the given radius out of the world.
 *
 * Two passes, like the player, because escaping one collider can push you into
 * its neighbour. The collider set is queried through a uniform grid rather than
 * iterated: the courtyard carries 461 collision cylinders and the interior a
 * comparable number, and twenty-four actors each walking that list three times
 * a frame is the difference between a horde and a slideshow.
 *
 * Returns true if anything was touched, which the caller uses to decide whether
 * it is wedged and should give up on its current heading.
 */
export function resolveAgainstWorld(pos, radius, feetY, ctx) {
  let touched = false;

  for (let pass = 0; pass < 2; pass++) {
    let hit = false;

    if (ctx.walls) {
      // A room wall is an axis-aligned box, and resolution along the axis of
      // LEAST penetration is what makes an actor that clips a wall slide along
      // it rather than get launched through the room.
      //
      // Iterated linearly rather than through the grid. A wall record is up to
      // 38 units long, so a spatial hash either buckets it into forty cells and
      // returns it forty times, or buckets it once and forces a query radius
      // that reads the whole map. There are under a hundred of them; a linear
      // scan is both simpler and faster than solving that.
      const head = feetY + ctx.actorHeight;

      for (const w of ctx.walls) {
        if (head <= w.y0 || feetY >= w.y1) continue;

        const hx = w.w / 2 + radius;
        const hz = w.d / 2 + radius;
        const dx = pos.x - w.x;
        const dz = pos.z - w.z;
        const px = hx - Math.abs(dx);
        const pz = hz - Math.abs(dz);
        if (px <= 0 || pz <= 0) continue;

        if (px < pz) pos.x += px * (dx < 0 ? -1 : 1);
        else pos.z += pz * (dz < 0 ? -1 : 1);
        hit = true;
      }
    }

    const n = ctx.colliderGrid.near(pos.x, pos.z, radius + 2);
    const list = ctx.colliderGrid.out;

    for (let i = 0; i < n; i++) {
      const c = list[i];
      // A collider only blocks while the actor's head is below its top, which
      // is what lets a shambler stand beside low rubble and be stopped dead by
      // a pillar. Measured from the collider's declared base where it has one.
      const base = c.y0 === undefined ? groundAt(ctx, c.x, c.z, feetY) : c.y0;
      if (feetY - base > c.h) continue;

      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const distSq = dx * dx + dz * dz;
      const minDist = c.r + radius;

      if (distSq < minDist * minDist && distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        const push = (minDist - dist) / dist;
        pos.x += dx * push;
        pos.z += dz * push;
        hit = true;
      }
    }

    if (hit) touched = true;
    else break;
  }

  // The perimeter. The courtyard states one min and one max, the interior
  // states four sides; reading both shapes is cheaper than making the square
  // lie about being a rectangle.
  const b = ctx.bounds;
  if (b) {
    const minX = b.minX ?? b.min, maxX = b.maxX ?? b.max;
    const minZ = b.minZ ?? b.min, maxZ = b.maxZ ?? b.max;
    if (pos.x < minX) { pos.x = minX; touched = true; }
    if (pos.x > maxX) { pos.x = maxX; touched = true; }
    if (pos.z < minZ) { pos.z = minZ; touched = true; }
    if (pos.z > maxZ) { pos.z = maxZ; touched = true; }
  }

  return touched;
}

/**
 * Local obstacle avoidance: steer AROUND the collider list rather than walking
 * into it and relying on push-out.
 *
 * Push-out alone produces an enemy that grinds along a pillar until the player
 * moves. This probes a short distance ahead along the current heading, and for
 * anything the probe would enter, adds a sideways force on whichever side keeps
 * the actor pointed more nearly at its target. That is enough to walk a
 * colonnade, and it costs one grid query.
 *
 * Writes into `_steer` and returns it.
 */
function avoid(pos, dirX, dirZ, radius, look, feetY, ctx) {
  _steer.set(0, 0, 0);

  _probe.set(pos.x + dirX * look, 0, pos.z + dirZ * look);

  const n = ctx.colliderGrid.near(_probe.x, _probe.z, radius + 1.6);
  const list = ctx.colliderGrid.out;

  for (let i = 0; i < n; i++) {
    const c = list[i];
    const base = c.y0 === undefined ? groundAt(ctx, c.x, c.z, feetY) : c.y0;
    if (feetY - base > c.h) continue;

    const dx = _probe.x - c.x;
    const dz = _probe.z - c.z;
    const clear = c.r + radius + 0.35;
    const dSq = dx * dx + dz * dz;
    if (dSq > clear * clear || dSq < 1e-8) continue;

    // Sideways relative to the heading. The sign is chosen by which side of the
    // heading the obstacle sits on, so the actor peels off the near edge rather
    // than committing to a fixed hand.
    const cross = dirX * (c.z - pos.z) - dirZ * (c.x - pos.x);
    const s = cross > 0 ? -1 : 1;
    const weight = 1 - Math.sqrt(dSq) / clear;

    _steer.x += -dirZ * s * weight;
    _steer.z += dirX * s * weight;
  }

  return _steer;
}

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

/**
 * One material set per actor.
 *
 * Per instance rather than per variant because the hit flash writes emissive,
 * and a shared material would flash the entire horde every time one of them was
 * shot. Four materials is the whole budget: linen, grimed linen, the dark
 * beneath the wrappings, and one accent.
 *
 * No maps at all. The enemy is the one thing in this scene the player looks at
 * while it is moving, and shading plus silhouette carries it; a 1K albedo on a
 * 14 cm forearm would be four texture fetches for a quarter of a texel.
 */
function makeMaterials(spec) {
  const jitter = (hex, h, s, l) => new THREE.Color(hex).offsetHSL(h, s, l);

  // Per-instance tone jitter. Identical clones are the loudest tell in a crowd
  // and the fix has to be structural rather than a placement-time afterthought.
  const dh = (Math.random() - 0.5) * 0.02;
  const dl = (Math.random() - 0.5) * 0.09;

  // The floor is set here as well as in setFlash so a material is never black
  // between being built and being spawned.
  const wrap = new THREE.MeshStandardMaterial({
    color: jitter(spec.palette.wrap, dh, -0.03, dl),
    roughness: 0.96,
    metalness: 0.0,
    emissive: CHAMBER_FLOOR.clone(),
  });

  const wrapDark = new THREE.MeshStandardMaterial({
    color: jitter(spec.palette.wrapDark, dh, 0.0, dl * 0.6),
    roughness: 0.98,
    metalness: 0.0,
    emissive: CHAMBER_FLOOR.clone(),
  });

  // The skull, and everything else meant to read as a void in the wrappings.
  // Flat dark, NO emissive: the first build put the glow on this material and
  // the whole head lit up, which reads as a lamp rather than as a face.
  const deep = new THREE.MeshStandardMaterial({
    color: spec.palette.deep,
    roughness: 0.85,
    metalness: 0.0,
  });

  // What is left alight in the sockets.
  //
  // Low, and on a small area. The first pass ran this at 2.4 across a wide bar
  // and produced a visor; the point of an emissive here is that a shape in a
  // dark chamber still tells you which way it is facing, and 0.9 on two
  // recessed squares does that without becoming the brightest object in a
  // sunlit frame. It is deliberately dimmer than the braziers it stands near.
  const eye = new THREE.MeshStandardMaterial({
    color: 0x1a120b,
    roughness: 0.7,
    metalness: 0.0,
    emissive: spec.palette.eye,
    emissiveIntensity: 0.9,
  });

  const accent = new THREE.MeshStandardMaterial({
    color: spec.palette.accent,
    roughness: spec.palette.accentRough ?? 0.55,
    metalness: spec.palette.accentMetal ?? 0.7,
  });

  const tatter = new THREE.MeshStandardMaterial({
    color: jitter(spec.palette.wrapDark, dh, -0.05, dl),
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
    emissive: CHAMBER_FLOOR.clone(),
  });

  return { wrap, wrapDark, deep, eye, accent, tatter };
}

// ---------------------------------------------------------------------------
// the humanoid rig
// ---------------------------------------------------------------------------

/**
 * Build a wrapped corpse.
 *
 * Proportions come from the spec, which is how one builder produces a shambler,
 * a sprinting husk, and an armoured Bound that read as three different things
 * at gameplay distance rather than three colours of the same thing.
 *
 * Regions are tagged on the meshes themselves rather than on invisible proxy
 * boxes. A proxy costs another draw call and another raycast target for a
 * hitbox that would sit exactly where the skull already is, and the existing
 * hitscan already reads `userData.region` off whatever it struck.
 */
export function buildHumanoid(spec, mats, actor) {
  const P = spec.proportions;
  const meshes = [];
  let triangles = 0;

  const add = (parent, g, mat, region) => {
    const m = new THREE.Mesh(g, mat);
    // Tagged on the mesh so the hitscan finds it without walking the parent
    // chain, which is what the weapon's fallback lookup is for.
    m.userData.enemy = actor;
    m.userData.region = region;
    m.castShadow = true;
    m.receiveShadow = false;
    parent.add(m);
    meshes.push(m);
    triangles += g.attributes.position.count / 3;
    return m;
  };

  const group = new THREE.Group();
  const body = new THREE.Group();          // lean, sway, and the death topple
  group.add(body);

  // Per-instance asymmetry, decided once at build.
  //
  // Identical clones are the loudest tell in a crowd, and on a CORPSE the fix
  // is free: a body that has been dead for three thousand years is not
  // symmetrical. One shoulder sits lower than the other, the head is set at an
  // angle it will never leave, and no two are the same height. None of it costs
  // a triangle or a frame; all of it is the difference between a horde and a
  // rack of the same mannequin.
  const asym = {
    scale: 0.94 + Math.random() * 0.13,
    tilt: (Math.random() - 0.5) * 0.30,      // permanent head cant
    droop: (Math.random() - 0.5) * 0.06,     // shoulder height difference
    reach: (Math.random() - 0.5) * 0.35,     // one arm further out than the other
  };

  const hips = new THREE.Group();
  hips.position.y = P.hipY;
  body.add(hips);

  add(hips, partGeo(P.hipW, 0.24, P.bodyD * 0.92), mats.wrapDark, 'body')
    .position.y = 0.05;

  // --- legs ------------------------------------------------------------------
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * P.legX, 0, 0);
    hips.add(hip);

    add(hip, partGeo(P.legW, P.thighL, P.legW * 1.05), mats.wrap, 'body')
      .position.y = -P.thighL / 2;

    const knee = new THREE.Group();
    knee.position.y = -P.thighL;
    hip.add(knee);

    // The shin runs all the way to the ground and carries the foot. A separate
    // foot mesh is two more draw calls per actor for a shape that is under a
    // pixel of silhouette once the wrappings are on it.
    add(knee, partGeo(P.legW * 0.86, P.shinL, P.legW * 1.5), mats.wrapDark, 'body')
      .position.set(0, -P.shinL / 2, P.legW * 0.2);

    legs.push({ hip, knee, side });
  }

  // --- torso -----------------------------------------------------------------
  const torso = new THREE.Group();
  torso.position.y = P.torsoY;
  hips.add(torso);

  add(torso, partGeo(P.chestW, P.chestH, P.bodyD), mats.wrap, 'body')
    .position.y = P.chestH / 2;

  // A binding across the chest, proud of the surface it wraps.
  //
  // This is the one mesh that says WRAPPED rather than merely blocky. A raised
  // band catches its own line of light along the chamfer at every angle, so it
  // survives to the distance where the limbs have already merged into one mass,
  // and it costs a single 44-triangle box. At 1.06x it was invisible; it has to
  // stand genuinely proud of the chest to read as something tied around it.
  add(torso, partGeo(P.chestW * 1.15, P.chestH * 0.20, P.bodyD * 1.30), mats.wrapDark, 'body')
    .position.y = P.chestH * 0.40;

  if (P.plate) {
    // The Bound's pectoral. Broad, flat, and gilded, so its silhouette reads as
    // ARMOUR from the front at a distance where the limbs are still a smudge.
    add(torso, partGeo(P.plate.w, P.plate.h, 0.1), mats.accent, 'body')
      .position.set(0, P.chestH * 0.62, P.bodyD * 0.5 + 0.03);
  }

  if (P.shoulderSlab) {
    for (const side of [-1, 1]) {
      add(torso, partGeo(P.shoulderSlab.w, P.shoulderSlab.h, P.shoulderSlab.d),
        mats.accent, 'body')
        .position.set(side * (P.chestW * 0.5 + P.shoulderSlab.w * 0.35),
          P.chestH * 0.86, 0);
    }
  }

  // --- arms ------------------------------------------------------------------
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * P.shoulderX, P.shoulderY + side * asym.droop, 0);
    torso.add(shoulder);

    add(shoulder, partGeo(P.armW, P.upperL, P.armW), mats.wrap, 'body')
      .position.y = -P.upperL / 2;

    const elbow = new THREE.Group();
    elbow.position.y = -P.upperL;
    shoulder.add(elbow);

    add(elbow, partGeo(P.armW * 0.85, P.foreL, P.armW * 0.85), mats.wrapDark, 'body')
      .position.y = -P.foreL / 2;

    arms.push({ shoulder, elbow, side, bias: side * asym.reach });
  }

  // --- head ------------------------------------------------------------------
  const neck = new THREE.Group();
  neck.position.y = P.headY;
  torso.add(neck);

  // Six meshes, all region 'head'. A hit on the bandaged jaw of a mummy is a
  // headshot by any reading, and splitting hairs there would only make the 100
  // gold feel arbitrary.
  //
  // THE HEAD IS BUILT AROUND ONE MISTAKE THIS REPLACES. The previous pass put a
  // single wide emissive BAR across the face at intensity 2.4. On a GPU, in
  // sun, it was the brightest thing in frame that was not the muzzle flash, and
  // it read as a machine visor: the strongest possible "this is a robot" cue,
  // on the one surface the player looks at. What a wrapped skull actually has
  // is two dark holes under an overhanging brow, and whatever is in them is
  // barely alight.
  add(neck, partGeo(P.headW, P.headH, P.headD), mats.deep, 'head')
    .position.y = P.headH / 2;

  // Linen over the jaw and over the crown, leaving the socket band between
  // them exposed. Two bands rather than one wedge, because the DARK GAP is
  // what makes it a face.
  add(neck, partGeo(P.headW * 0.96, P.headH * 0.34, P.headD * 0.84), mats.wrap, 'head')
    .position.set(0, P.headH * 0.20, P.headD * 0.14);

  add(neck, partGeo(P.headW * 0.99, P.headH * 0.32, P.headD * 0.88), mats.wrap, 'head')
    .position.set(0, P.headH * 0.83, P.headD * 0.08);

  // The brow. It stands proud of the face specifically so the sockets under it
  // are in its shadow at every sun angle the courtyard has.
  add(neck, partGeo(P.headW * 0.94, P.headH * 0.11, P.headD * 0.34), mats.wrapDark, 'head')
    .position.set(0, P.headH * 0.63, P.headD * 0.46);

  // Two sockets, barely proud of the face and deep in the brow's shadow. Dim
  // and small: at twenty metres this is a pair of embers, not a lamp.
  for (const side of [-1, 1]) {
    add(neck, partGeo(P.headW * 0.17, P.headH * 0.11, 0.03), mats.eye, 'head')
      .position.set(side * P.headW * 0.24, P.headH * 0.47, P.headD * 0.51);
  }

  if (P.headdress) {
    // A nemes flare. Two angled slabs either side of the skull, which is the
    // single cheapest way to make a silhouette read as royal rather than as
    // another corpse.
    for (const side of [-1, 1]) {
      const f = add(neck, partGeo(P.headdress.w, P.headdress.h, 0.09),
        mats.accent, 'head');
      f.position.set(side * (P.headW * 0.5 + P.headdress.w * 0.42),
        P.headH * 0.52, -P.headD * 0.1);
      f.rotation.z = side * -0.34;
    }
  }

  // --- trailing wraps --------------------------------------------------------
  // Thin geometry is what breaks a silhouette into readable depth layers, and a
  // mummy with none is a stack of boxes. These hang from pivots and lag the
  // body, so they trail on the move and settle when it stops.
  const tatters = [];
  for (const t of P.tatters) {
    const pivot = new THREE.Group();
    pivot.position.set(t.x, t.y, t.z);
    // A strip lies in its own XY plane, so an unrotated one is edge-on from the
    // side and a flat billboard from the front. Distributing them around Y is
    // what turns four rags into a ragged OUTLINE rather than four flags.
    pivot.rotation.y = t.yaw || 0;
    (t.on === 'arm' ? arms[t.side > 0 ? 1 : 0].elbow : torso).add(pivot);

    const m = new THREE.Mesh(stripGeo(t.w, t.h, t.cut || 0), mats.tatter);
    // Wraps are decoration. Left hittable they sit in front of the skull at
    // certain angles and silently convert a headshot into a body hit, which is
    // a 40 gold bug the player would never be able to diagnose.
    m.userData.noHit = true;
    m.castShadow = false;
    pivot.add(m);

    tatters.push({ pivot, phase: Math.random() * 6.283, swing: t.swing ?? 1 });
    triangles += m.geometry.attributes.position.count / 3;
  }

  return { group, body, hips, torso, neck, legs, arms, tatters, meshes, triangles, asym };
}

/**
 * The lurching walk.
 *
 * Legs, arms, and torso are all driven off ONE phase advanced by real speed.
 * The undead read comes from three deliberate asymmetries: the two legs are a
 * half cycle apart but not equally weighted, the torso pitches forward and
 * rolls on the same phase so the whole body falls into each step, and the head
 * lolls on a much slower cycle that never lines up with the stride.
 */
function animateHumanoid(rig, spec, s) {
  const P = spec.proportions;
  const g = spec.gait;
  const p = s.phase;

  const drive = Math.min(1, s.speed / spec.speed);
  const amp = g.stride * (0.35 + 0.65 * drive);

  // Sign convention, and it is worth stating once because every joint below
  // depends on it: the model faces its own +Z, because the actor's yaw is
  // atan2(dx, dz) and a local +Z rotated by that yaw is the heading. A positive
  // rotation.x therefore swings a hanging limb BACKWARD. Reaching forward is
  // negative; a bending knee, which carries the foot backward, is positive.

  for (const leg of rig.legs) {
    const o = leg.side < 0 ? 0 : Math.PI;
    leg.hip.rotation.x = Math.sin(p + o) * amp;
    // The knee only bends on the recovery half of the stride. A knee that bends
    // both ways is the classic backwards-leg artefact.
    leg.knee.rotation.x = Math.max(0, -Math.cos(p + o)) * amp * 1.5 + 0.06;
  }

  // The wind-up and the strike own the arms outright. A telegraph the player
  // has to pick out from a swing amplitude is not a telegraph.
  // Cocked, not flailing. At -1.5 off the reach the arms went up and BACK past
  // the head and a crowd mid-wind-up photographed as a field of scarecrows;
  // -1.0 puts them forward and above the horizontal, which is still unmistakable
  // at range and still reads as a body rather than a windmill.
  const WINDUP_ARM = g.armReach - 1.0;
  const tilt = rig.asym ? rig.asym.tilt : 0;
  const FOLLOW_ARM = 0.35;                  // swung through, down and back

  for (const arm of rig.arms) {
    const o = arm.side < 0 ? Math.PI : 0;

    // The permanent bias is added to every pose, not just the idle one: a
    // corpse whose left arm hangs lower keeps hanging lower while it swings.
    const reach = g.armReach + (rig.asym ? arm.bias : 0);

    if (s.windup > 0) {
      const k = s.windup;
      arm.shoulder.rotation.x = reach + (WINDUP_ARM - reach) * k;
      arm.shoulder.rotation.z = arm.side * (g.armSplay + k * 0.45);
      arm.elbow.rotation.x = -g.elbowBend * (1 - k) - 0.18;
    } else if (s.strike > 0) {
      // strike counts 1 down to 0, so this reads as the arm falling out of the
      // cocked pose and through the target.
      const k = s.strike;
      arm.shoulder.rotation.x = FOLLOW_ARM + (WINDUP_ARM - FOLLOW_ARM) * k;
      arm.shoulder.rotation.z = arm.side * g.armSplay;
      arm.elbow.rotation.x = -0.15;
    } else {
      arm.shoulder.rotation.x = reach + Math.sin(p + o) * g.armSwing * drive;
      arm.shoulder.rotation.z = arm.side * g.armSplay;
      arm.elbow.rotation.x = -g.elbowBend - Math.max(0, Math.sin(p + o)) * 0.25;
    }
  }

  if (s.windup > 0) {
    rig.torso.rotation.x = g.lean + s.windup * 0.30;        // rears back
  } else if (s.strike > 0) {
    rig.torso.rotation.x = g.lean - (1 - s.strike) * 0.30;  // falls in behind it
  } else {
    rig.torso.rotation.x = g.lean + Math.sin(p * 2) * 0.03 * drive;
  }

  rig.torso.rotation.z = Math.sin(p) * g.sway * drive;
  rig.hips.rotation.y = Math.sin(p) * g.hipTwist * drive;

  // One dip per footfall, one sway per stride. Damped hard when staggered so a
  // hit visibly interrupts the gait rather than only tinting the material.
  const bob = Math.abs(Math.sin(p)) * g.bob * drive;
  rig.body.position.y = bob - s.stagger * 0.06;
  rig.body.rotation.z = s.staggerRoll;
  rig.body.rotation.x = s.staggerPitch;

  rig.neck.rotation.z = tilt + Math.sin(p * 0.37) * g.headLoll;
  rig.neck.rotation.x = g.headDroop + Math.sin(p * 0.53) * 0.05;

  for (const t of rig.tatters) {
    // Lagged by a quarter cycle so the cloth arrives after the limb it hangs
    // from, which is the whole read of a trailing wrap.
    const lag = Math.sin(p - 0.8 + t.phase) * t.swing;
    t.pivot.rotation.x = lag * 0.30 * drive + P.tatterRest;
    t.pivot.rotation.z = Math.sin(p * 0.7 + t.phase) * 0.16 * drive;
  }
}

// ---------------------------------------------------------------------------
// the actor
// ---------------------------------------------------------------------------

/** Death phases, in seconds. Topple, then lie, then crumble. */
const TOPPLE_S = 0.62;
const LIE_S = 0.45;
const CRUMBLE_S = 0.9;

/** Eased fall progress, 0..1, squared so it accelerates like a real one. */
function k0(t) {
  const k = t / TOPPLE_S;
  return k * k;
}

/**
 * One pooled enemy.
 *
 * The instance is allocated exactly once, when the director builds its pool.
 * spawn() only writes numbers; nothing in it constructs a mesh, a material, a
 * vector, or an array. That is the whole reason a wave of twenty-four arriving
 * at once does not hitch.
 */
export function createEnemy(spec, index) {
  const actor = {
    spec,
    variant: spec.id,
    index,
    live: false,
    dead: false,
    dying: false,
    boss: false,
    health: spec.health,
    maxHealth: spec.health,
    radius: spec.radius,
    emitter: null,
  };

  const mats = makeMaterials(spec);
  const rig = spec.build(spec, mats, actor);

  actor.group = rig.group;
  actor.rig = rig;
  actor.materials = mats;
  // Authored scale times this instance's own jitter, resolved once so the
  // spawn path and the crumble read the same number.
  const baseScale = spec.scale * (rig.asym ? rig.asym.scale : 1);
  actor.scale = baseScale;
  actor.triangles = Math.round(rig.triangles);
  actor.position = rig.group.position;

  // Every mutable number the actor owns lives here, allocated once. A spawn is
  // a write over this record and nothing else.
  const st = {
    vx: 0, vz: 0, vy: 0,
    feetY: 0,
    phase: Math.random() * 6.283,
    grounded: true,

    windup: 0,          // 0..1 telegraph
    strike: 0,          // 0..1 follow through
    cooldown: 0,
    struck: false,

    stagger: 0,
    staggerRoll: 0,
    staggerPitch: 0,
    flash: 0,

    deathT: 0,
    toppleAxisX: 0,
    toppleAxisZ: 0,
    spinY: 0,

    groanIn: 0,
    footIn: 0,
    speedScale: 1,
  };
  actor.st = st;

  const anim = {
    phase: 0, speed: 0, windup: 0, strike: 0,
    stagger: 0, staggerRoll: 0, staggerPitch: 0,
  };

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------

  function spawn(x, z, ctx, hpScale, speedScale) {
    actor.live = true;
    actor.dead = false;
    actor.dying = false;
    actor.maxHealth = spec.health * hpScale;
    actor.health = actor.maxHealth;

    st.vx = st.vz = st.vy = 0;
    st.windup = st.strike = st.cooldown = 0;
    st.struck = false;
    st.stagger = st.staggerRoll = st.staggerPitch = 0;
    st.flash = 0;
    st.deathT = 0;
    st.spinY = 0;
    st.speedScale = speedScale;
    st.groanIn = 1.5 + Math.random() * 4;
    st.footIn = 0;

    st.feetY = groundAt(ctx, x, z, undefined);
    rig.group.position.set(x, st.feetY, z);
    rig.group.rotation.set(0, Math.random() * 6.283, 0);
    rig.group.scale.setScalar(baseScale);
    rig.body.position.set(0, 0, 0);
    rig.body.rotation.set(0, 0, 0);

    for (const m of rig.meshes) m.visible = true;
    setFlash(0);
  }

  /** Return to the pool with no animation. Used on a space change and reset. */
  function retire() {
    actor.live = false;
    actor.dying = false;
    actor.dead = false;
    actor.emitter = null;
  }

  // -------------------------------------------------------------------------
  // damage
  // -------------------------------------------------------------------------

  function setFlash(k) {
    // Every material carries the flash, so a hit anywhere on the body lights
    // the whole silhouette for a frame or two. Hitting one limb and lighting
    // only that limb reads as a rendering fault rather than as a hit.
    //
    // THE FLASH IS WRITTEN ON TOP OF THE CHAMBER FLOOR, NOT INSTEAD OF IT.
    // update() calls setFlash(st.flash) on every live actor every frame, so a
    // setFlash that wrote plain black at k = 0 would erase the floor before it
    // was ever drawn. It would also erase anything a harness set from outside,
    // which is exactly how the first sweep of this value measured a fight
    // between the override and the frame loop and reported that emissive does
    // nothing.
    const e = k * 0.9;
    const f = CHAMBER_FLOOR;
    mats.wrap.emissive.setRGB(f.r + e * 0.75, f.g + e * 0.18, f.b + e * 0.10);
    mats.wrapDark.emissive.setRGB(f.r + e * 0.75, f.g + e * 0.18, f.b + e * 0.10);
    mats.tatter.emissive.setRGB(f.r + e * 0.55, f.g + e * 0.13, f.b + e * 0.07);
    mats.wrap.emissiveIntensity = 1;
    mats.wrapDark.emissiveIntensity = 1;
    mats.tatter.emissiveIntensity = 1;
  }

  /**
   * Take a hit.
   *
   * Returns whether this shot finished it, which is the single fact the economy
   * needs: a hit pays 10, a body kill 60, a headshot 100.
   */
  function hurt(damage, region, dirX = 0, dirZ = 0) {
    if (!actor.live || actor.dying) return false;

    actor.health -= damage;
    st.flash = 1;

    // Stagger scales with the fraction of max health removed, so a pistol round
    // nudges a Bound and a slug folds a husk. Heavy variants resist it outright.
    const share = damage / actor.maxHealth;
    st.stagger = Math.min(1, st.stagger + share * spec.staggerTake * 3.2);

    if (actor.health <= 0) {
      actor.health = 0;
      beginDeath(dirX, dirZ);
      return true;
    }
    return false;
  }

  function beginDeath(dirX, dirZ) {
    actor.dying = true;
    st.deathT = 0;
    st.vx = st.vz = 0;

    // Topple AWAY from the shot, around the horizontal axis perpendicular to
    // it. A corpse that always falls forward is a corpse that fell over; one
    // that falls the way it was hit is a corpse that was killed.
    const len = Math.hypot(dirX, dirZ) || 1;
    const nx = dirX / len, nz = dirZ / len;
    st.toppleAxisX = nz;
    st.toppleAxisZ = -nx;
    st.spinY = (Math.random() - 0.5) * 2.4;

    actor.emitter?.play('deathRattle', { pitch: spec.voicePitch });
  }

  // -------------------------------------------------------------------------
  // frame
  // -------------------------------------------------------------------------

  function update(dt, ctx) {
    if (!actor.live) return;

    st.flash = Math.max(0, st.flash - dt * 6.5);
    setFlash(st.flash);

    if (actor.dying) { updateDeath(dt, ctx); return; }

    ctx.actorHeight = spec.height * spec.scale;

    const pos = rig.group.position;

    // --- what it wants ------------------------------------------------------
    const tx = ctx.playerPos.x - pos.x;
    const tz = ctx.playerPos.z - pos.z;
    const distSq = tx * tx + tz * tz;
    const dist = Math.sqrt(distSq) || 1;

    _dir.set(tx / dist, 0, tz / dist);

    // Separation. Without it a horde converges to one point and reads as a
    // single blob with too many legs, and the player cannot tell how many
    // things are in front of them.
    const sep = spec.sepRadius * spec.scale;
    for (const other of ctx.live) {
      if (other === actor || !other.live || other.dying) continue;
      const ox = pos.x - other.position.x;
      const oz = pos.z - other.position.z;
      const oSq = ox * ox + oz * oz;
      const want = sep + other.radius * other.spec.scale;
      if (oSq >= want * want || oSq < 1e-6) continue;
      const d = Math.sqrt(oSq);
      const push = (1 - d / want) * 1.9;
      _dir.x += (ox / d) * push;
      _dir.z += (oz / d) * push;
    }

    // Avoidance, probed further ahead the faster it is going.
    const look = 0.9 + Math.min(2.2, st.vx * st.vx + st.vz * st.vz) * 0.25;
    const av = avoid(pos, _dir.x, _dir.z, actor.radius * spec.scale, look, st.feetY, ctx);
    _dir.x += av.x * 1.5;
    _dir.z += av.z * 1.5;

    const dl = Math.hypot(_dir.x, _dir.z) || 1;
    _dir.x /= dl; _dir.z /= dl;

    // --- attack -------------------------------------------------------------
    const reach = spec.attackRange * spec.scale + ctx.playerRadius;
    st.cooldown = Math.max(0, st.cooldown - dt);

    if (st.strike > 0) {
      st.strike = Math.max(0, st.strike - dt / spec.strikeTime);
      // The blow lands at the top of the swing, not at the start of the
      // wind-up. An ability that fires without a readable moment is just
      // damage arriving from nowhere.
      if (!st.struck && st.strike < 0.55) {
        st.struck = true;
        if (dist <= reach + 0.5) ctx.combat.damagePlayer(spec.damage, pos.x, pos.z);
      }
    } else if (st.windup > 0) {
      st.windup = Math.min(1, st.windup + dt / spec.windup);
      if (st.windup >= 1) {
        st.windup = 0;
        st.strike = 1;
        st.struck = false;
        actor.emitter?.play('swipe', { pitch: spec.voicePitch });
      }
    } else if (dist <= reach && st.cooldown <= 0) {
      st.windup = 0.001;
      st.cooldown = spec.cooldown;
      actor.emitter?.play('groan', { pitch: spec.voicePitch * 0.9 });
    }

    // --- move ---------------------------------------------------------------
    // Committed while striking: a shambler that keeps walking through its own
    // swing has no weight to it.
    const busy = st.windup > 0 || st.strike > 0;
    const want = busy || dist <= reach * 0.85
      ? 0
      : spec.speed * st.speedScale * (1 - st.stagger * 0.85);

    const accel = spec.accel * dt;
    st.vx += (_dir.x * want - st.vx) * Math.min(1, accel);
    st.vz += (_dir.z * want - st.vz) * Math.min(1, accel);

    pos.x += st.vx * dt;
    pos.z += st.vz * dt;

    // --- ground and gravity -------------------------------------------------
    const floor = groundAt(ctx, pos.x, pos.z, st.feetY);
    st.feetY += st.vy * dt;
    if (st.feetY <= floor) {
      st.feetY = floor;
      st.vy = 0;
      st.grounded = true;
    } else {
      st.vy -= 24 * dt;
      st.grounded = false;
    }

    resolveAgainstWorld(pos, actor.radius * spec.scale, st.feetY, ctx);
    pos.y = st.feetY;

    // --- facing -------------------------------------------------------------
    // Turn toward the player rather than toward the steering direction. An
    // enemy that faces where it is sliding looks like it is on rails; one that
    // faces its target while side-stepping a pillar looks like it wants you.
    const wantYaw = Math.atan2(tx, tz);
    let d = wantYaw - rig.group.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    rig.group.rotation.y += d * Math.min(1, spec.turn * dt);

    // --- animation ----------------------------------------------------------
    const speed = Math.hypot(st.vx, st.vz);
    st.phase += dt * (0.8 + speed * spec.gait.rate);

    st.stagger = Math.max(0, st.stagger - dt * 2.6);
    st.staggerRoll = Math.sin(st.phase * 23) * st.stagger * 0.22;
    st.staggerPitch = st.stagger * 0.18;

    anim.phase = st.phase;
    anim.speed = speed;
    anim.windup = st.windup;
    anim.strike = st.strike;
    anim.stagger = st.stagger;
    anim.staggerRoll = st.staggerRoll;
    anim.staggerPitch = st.staggerPitch;
    spec.animate(rig, spec, anim);

    // --- voice --------------------------------------------------------------
    st.groanIn -= dt;
    if (st.groanIn <= 0) {
      st.groanIn = 4 + Math.random() * 7;
      // Only the near ones. Twenty-four groans layered at every distance is
      // mud, and the whole point of the positional bus is knowing where the
      // one behind you is.
      if (dist < 26) actor.emitter?.play('groan', { pitch: spec.voicePitch });
    }

    st.footIn -= dt * speed;
    if (st.footIn <= 0) {
      st.footIn = 1.1;
      if (dist < 18 && Math.random() < 0.55) {
        actor.emitter?.play('footfall', { pitch: spec.voicePitch });
      }
    }
  }

  /**
   * Topple, lie, crumble.
   *
   * The body group carries the fall so the actor's world position stays where
   * the corpse is, which keeps the audio emitter and the crumble sink honest.
   */
  function updateDeath(dt, ctx) {
    st.deathT += dt;
    const t = st.deathT;

    if (t < TOPPLE_S) {
      // Limbs go slack over the fall. This runs FIRST because every animator
      // writes the body group's rotation as part of its stagger term, and the
      // topple has to be the last word on it.
      anim.phase = st.phase;
      anim.speed = 0;
      anim.windup = 0;
      anim.strike = 0;
      anim.stagger = 1 - k0(t);
      anim.staggerRoll = 0;
      anim.staggerPitch = 0;
      spec.animate(rig, spec, anim);

      // Accelerating rotation, not a linear one. A body falls under gravity and
      // an eased fall reads as a lowered mannequin.
      const k = k0(t);
      rig.body.rotation.x = st.toppleAxisX * k * (Math.PI / 2);
      rig.body.rotation.z = st.toppleAxisZ * k * (Math.PI / 2);
      rig.group.rotation.y += st.spinY * dt * (1 - k);
      return;
    }

    if (t < TOPPLE_S + LIE_S) return;    // a beat on the floor before it goes

    const k = Math.min(1, (t - TOPPLE_S - LIE_S) / CRUMBLE_S);
    // Sink and taper rather than fade. Turning on transparency mid-run forces a
    // program swap on the frame the player earned the kill.
    rig.group.position.y = st.feetY - k * spec.height * baseScale * 0.9;
    rig.group.scale.setScalar(baseScale * (1 - k * 0.55));

    if (k >= 1) {
      actor.dead = true;
      actor.live = false;
    }
  }

  actor.spawn = spawn;
  actor.retire = retire;
  actor.hurt = hurt;
  actor.update = update;

  actor.setFidelity = (high) => {
    for (const m of rig.meshes) m.castShadow = high;
  };

  return actor;
}

/** Exported so variants can reuse the humanoid animation with their own rig. */
export { animateHumanoid };

// ---------------------------------------------------------------------------
// the base enemy
// ---------------------------------------------------------------------------

/**
 * The shambler: the enemy every other one is a deviation from.
 *
 * Everything a variant may change lives in this record, which is what keeps
 * variants.js a table of numbers rather than three more builders. The three
 * groups that matter:
 *
 *   - proportions decide the SILHOUETTE, which is the only thing readable at
 *     twenty metres.
 *   - gait decides the LURCH, which is what says undead rather than actor.
 *   - the combat block decides how it plays, and is tuned against the frozen
 *     payout table in systems/economy.js: a shambler is four body shots from
 *     the starting pistol, which pays 30 in hits plus 60 for the kill.
 */
export const MUMMY = {
  id: 'shambler',
  name: 'Shambler',

  health: 150,
  speed: 2.25,
  accel: 6.5,
  turn: 3.2,
  damage: 16,
  attackRange: 1.75,
  windup: 0.52,
  strikeTime: 0.42,
  cooldown: 1.35,
  staggerTake: 1.0,

  scale: 0.94,
  height: 2.0,
  radius: 0.42,
  sepRadius: 1.05,
  voicePitch: 1.0,

  /**
   * MEASURED AGAINST THE GROUND IT STANDS ON, TWICE.
   *
   * The first build gave the shambler 0xb8a888 linen, within a few percent of
   * the courtyard's sand (0xf2e0bd) and its limestone (0xd8c39a). At twenty
   * metres in desert noon it was invisible - not subtle, invisible.
   *
   * The correction went two stops under bare sand and OVERSHOT. On a real GPU
   * that landed the whole body in a value-crushed near-black mass with no light
   * half at all: a flat silhouette with no wrap lines, no depth, and no
   * material read, which photographed as a black box with a lit visor. Both
   * failures are the same mistake made in opposite directions - trying to buy
   * separation with one number.
   *
   * Separation comes from VALUE CONTRAST IN THE MIDS plus shadow. A mummy in
   * sunlight is dirty ivory where the sun hits it and deep brown in the crease,
   * and it is the RANGE between those two that reads at distance, not the
   * average. So the base linen sits a comfortable step under the sand where it
   * still has a lit half to lose, and wrapDark is the crease it loses it into:
   * shins, forearms, the binding across the chest, and the brow over the
   * sockets. Every one of those is a shadow line the eye can find.
   *
   * ---------------------------------------------------------------------
   * A FOURTH PASS MEASURED THESE NUMBERS AND DELIBERATELY DID NOT MOVE THEM.
   *
   * Read this before swinging the palette a fourth time.
   *
   * The rebuilt lighting (sun at 27 degrees, environmentIntensity 0.34 -> 0.17)
   * and the chamferedBox winding fix - which had 28 of every box's 44 triangles
   * facing inward, so no enemy in this project had ever drawn a single bevel
   * highlight - both landed AFTER the third palette pass. Against that scene,
   * one shambler was staged at an exact 7 / 20 / 35 m, in sun and in shadow,
   * and its body sampled per pixel against the pixels it covers:
   *
   *              body   behind   legible   lit:shadow   cast shadow
   *   7 m sun    124.4    90.5     91.2%      6.13:1       128% of body
   *   7 m shade  115.0   130.5     92.5%      5.17:1        65%
   *   20 m sun   125.6   138.1     80.6%      3.27:1        16%
   *   20 m shade 126.8   128.3     80.7%      2.73:1        12%
   *   35 m sun   141.5   140.1     69.6%      2.11:1        10%
   *   35 m shade 137.4   108.2     76.1%      2.24:1        14%
   *
   * It reads. It also casts a real ground shadow at every one of those
   * distances, which two review rounds have now claimed it does not.
   *
   * What it DOES do is sit in the middle of the scene's value range, so its
   * polarity flips with the backdrop: darker than the sand at 20 m, brighter at
   * 35 m in shadow. That is aerial perspective compressing a figure toward the
   * fog, and it is not a thing a base colour can fix - the same fog compresses
   * whatever you replace it with. Four candidate repaints were rendered against
   * IDENTICAL backgrounds and scored. Darkening plus saturation (0x8a7040 over
   * 0x55402a) bought the mean separation everyone keeps asking for and LOST
   * legibility at four of five stances: 75.6 -> 71.4 at 35 m sun, 76.6 -> 69.3
   * at 35 m shadow, 56.6 -> 44.2 in the chamber. Lowering envMapIntensity did
   * nothing measurable at any distance.
   *
   * So the palette is not the defect and this is the third consecutive pass to
   * reach that conclusion from a different direction. The defect the numbers
   * DID find was in the chamber, and it is fixed by EMISSIVE_FLOOR above.
   * ---------------------------------------------------------------------
   */
  palette: {
    wrap: 0x9a8a6e,
    wrapDark: 0x5b4d38,
    deep: 0x2a2118,
    eye: 0xffae3c,
    accent: 0xc9a24a,
  },

  proportions: {
    hipY: 0.92, hipW: 0.34, bodyD: 0.26,
    legX: 0.13, legW: 0.16, thighL: 0.44, shinL: 0.48,
    torsoY: 0.14, chestW: 0.46, chestH: 0.56,
    shoulderX: 0.27, shoulderY: 0.50, armW: 0.14, upperL: 0.40, foreL: 0.42,
    headY: 0.66, headW: 0.24, headH: 0.28, headD: 0.26,
    // Hanging well clear of the body, so the rags are OUTLINE rather than
    // texture. At 0.10 they lay flat against the limbs and did nothing.
    tatterRest: 0.30,

    /**
     * THE THING THAT STOPS IT BEING A BOX-MAN.
     *
     * Every other member in this spec is an axis-aligned box, because that is
     * what a primitives-only character is made of, and a stack of them reads as
     * a robot no matter what colour it is painted. Loose trailing wrap is the
     * whole answer: it is the only asymmetric, non-rectangular, silhouette-
     * breaking thing on the body.
     *
     * So there is a torn hem across the hips that breaks the two-legs-in-a-box
     * outline, a long wrap off ONE forearm and not the other, and a rag down
     * the spine. Three different cuts, three different yaws, and nothing
     * mirrored - a body that has been unravelling for three thousand years has
     * not unravelled evenly.
     */
    tatters: [
      { on: 'torso', x: 0.0, y: -0.04, z: -0.02, w: 0.34, h: 0.44, yaw: 0.10, cut: 0, swing: 0.7 },
      { on: 'torso', x: -0.13, y: 0.20, z: -0.13, w: 0.13, h: 0.74, yaw: 0.42, cut: 1, swing: 1.1 },
      { on: 'arm', side: 1, x: 0, y: -0.26, z: 0, w: 0.12, h: 0.52, yaw: 1.10, cut: 2, swing: 1.6 },
    ],
  },

  gait: {
    rate: 1.85,
    stride: 0.52,
    armSwing: 0.30,
    // The reach is the pose the whole silhouette turns on. At -0.62 the arms
    // hung at the sides and the outline was a mannequin's; at -0.95 they are
    // out in front, which is the one pose an audience reads as "undead"
    // without being told.
    armReach: -0.95,
    // Held OUT as well as forward. At 0.16 the arms pointed straight at the
    // camera, foreshortened to nothing, and every head-on screenshot showed a
    // torso with no arms at all - which is the one angle the player sees an
    // enemy from most of the time.
    armSplay: 0.30,
    // NEGATIVE, and that is the whole pose.
    //
    // The animator applies this as -elbowBend, so a positive value bends the
    // forearm further FORWARD - which, on an upper arm already reaching 54
    // degrees out, straightens the whole limb into a horizontal stick and the
    // enemy reads as a scarecrow. A negative value swings the forearm back
    // toward vertical, so it HANGS off the outstretched upper arm. That is the
    // silhouette everyone already knows.
    elbowBend: -0.45,
    lean: -0.24,         // negative hunches the chest forward over the hips
    sway: 0.11,
    hipTwist: 0.07,
    bob: 0.055,
    headLoll: 0.14,
    headDroop: -0.22,
  },

  build: buildHumanoid,
  animate: animateHumanoid,
};
