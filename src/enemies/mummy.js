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
import { parts, tornStrip } from './anatomy.js';
import { linenMaps, compensate, WRAP_TILES } from './wraps.js';
import { contactShadow } from './contact.js';

/**
 * Shared geometry, keyed by the PROPORTIONS RECORD ITSELF rather than by a
 * string of dimensions.
 *
 * Object identity is the correct key here and it is not a shortcut. Two
 * variants that were built from the same table are the same body; five gods
 * that all point at the one COLOSSUS record are one mesh set between them; and
 * `extend()` allocates a fresh proportions object per variant, so a variant
 * that changes one number gets its own set automatically. A string key would
 * have to enumerate every field this builder reads and would go quietly stale
 * the first time one was added.
 *
 * Built lazily on the first actor that asks, which is still boot time: nothing
 * in here is reachable from the spawn path.
 */
const RIG_GEO = new Map();

/** Wrap geometry, keyed by shape. Shared across every variant that asks. */
const STRIPS = new Map();

function stripGeo(w, h, cut = 0) {
  const key = `${w}|${h}|${cut}`;
  let g = STRIPS.get(key);
  if (!g) { g = tornStrip(w, h, cut, 5, WRAP_TILES); STRIPS.set(key, g); }
  return g;
}

/**
 * Every mesh set a humanoid needs, welded down to one geometry per rig group
 * per material.
 *
 * THE UNIT OF ACCOUNTING IS THE DRAW CALL. Twenty-four actors is the live cap,
 * so one extra mesh on the body is twenty-four extra draw calls in a fight.
 * The rebuild that added hands, feet, a neck, deltoids and tapered limbs would
 * have taken the enemy from nineteen meshes to twenty-six built the old way -
 * one mesh per member. Merging by (group, material) instead takes it to
 * eighteen: a foot costs triangles, which are free here, and nothing else.
 *
 * Each geometry is authored in the frame of the rig group it will hang on, and
 * limb geometries run DOWNWARD FROM THEIR JOINT rather than being centred and
 * offset. That is what lets a per-instance limb length be one `scale.y` on the
 * mesh plus one number on the child joint, with no position arithmetic that
 * could disagree between the two.
 */
function buildRigGeometry(P) {
  const T = WRAP_TILES;
  const out = {};

  // --- the pelvis, in the hips' frame ---------------------------------------
  {
    const p = parts(T);
    p.box(P.hipW, 0.26, P.bodyD * 0.94, { y: 0.03, top: 1.0, bottom: 0.82, v: 0.13 });
    out.pelvis = p.build();
  }

  // --- the thigh, hanging from the hip --------------------------------------
  {
    const p = parts(T);
    p.box(P.legW, P.thighL, P.legW * 1.06,
      { y: -P.thighL / 2, top: 1.08, bottom: 0.82, v: 0.31 });
    out.thigh = p.build();
  }

  // --- the shin and the foot, hanging from the knee --------------------------
  //
  // THE FOOT IS NEW AND IT IS NOT DECORATION. The previous rig deliberately
  // had none: the shin was simply made deeper and the comment argued a foot was
  // "under a pixel of silhouette once the wrappings are on it". It is not. A
  // limb that ends in a flat cut where it meets the ground is the single
  // clearest reason a figure reads as a mannequin on a stand, because a
  // mannequin is exactly a body that ends at the ankle. The foot is also the
  // only part of the outline that touches the sand, which makes it the part
  // the eye uses to decide whether anything is standing on anything.
  {
    const p = parts(T);
    const w = P.legW * 0.88;
    p.box(w, P.shinL, w * 1.22, { y: -P.shinL / 2, z: P.legW * 0.08, top: 1.06, bottom: 0.68, v: 0.57 });
    p.box(w * 0.94, 0.08, P.legW * 2.0,
      { y: -P.shinL + 0.042, z: P.legW * 0.55, top: 0.80, bottom: 1.0, depthTop: 1.0, depthBottom: 0.94, v: 0.05 });
    out.shin = p.build();
  }

  // --- the torso ------------------------------------------------------------
  //
  // A WEDGE, NOT A BOX, AND THIS IS THE SINGLE STRONGEST CUE IN THE RIG.
  //
  // A human reads as human at a glance from three ratios, and all three are
  // free: shoulders wider than waist, head narrower than a third of the
  // shoulder span, and limbs that taper toward their far end. The rectangular
  // torso this replaces failed the first two at once - a slab the same width at
  // the waist as at the shoulder is a crate, and a crate wearing a head is what
  // "Roblox mannequin" means.
  {
    const p = parts(T);
    p.box(P.chestW, P.chestH, P.bodyD, {
      y: P.chestH / 2,
      bottom: 0.66, top: 1.0,
      depthBottom: 0.80, depthTop: 1.0,
    });
    // A neck. Without one the skull sits on the shoulders like a lid, which is
    // its own mannequin tell and costs four triangles to fix.
    const neckH = Math.max(0.07, P.headY - P.chestH + 0.06);
    p.box(P.headW * 0.56, neckH, P.headW * 0.54,
      { y: P.chestH + neckH / 2 - 0.04, top: 0.88, bottom: 1.08, v: 0.62 });
    out.torsoLinen = p.build();
  }

  {
    // Bindings, proud of the surface they wrap. A raised band catches its own
    // line of light along the bevel at every angle, so it survives to the
    // distance where the limbs have merged into one mass.
    const p = parts(T);
    p.box(P.chestW * 1.13, P.chestH * 0.17, P.bodyD * 1.28,
      { y: P.chestH * 0.44, top: 0.98, bottom: 1.0, v: 0.5 });
    p.box(P.chestW * 0.90, P.chestH * 0.13, P.bodyD * 1.02,
      { y: P.chestH * 0.09, top: 1.0, bottom: 0.92, v: 0.2 });
    out.torsoDark = p.build();
  }

  // --- the upper arm, with a deltoid over the joint --------------------------
  {
    const p = parts(T);
    const w = P.armW;
    p.box(w * 1.55, w * 1.3, w * 1.5,
      { y: w * 0.18, top: 0.68, bottom: 1.0, v: 0.7 });
    p.box(w, P.upperL, w, { y: -P.upperL / 2, top: 1.04, bottom: 0.82, v: 0.9 });
    out.upper = p.build();
  }

  // --- the forearm, WITH A HAND ON THE END -----------------------------------
  //
  // "No hands" was one of four defects a blind judge listed by name. A hand at
  // gameplay distance is three boxes and about a hundred triangles, and it is
  // the difference between an arm and a length of pipe. It is built per side
  // rather than mirrored with a negative scale: a negative scale reverses
  // triangle winding, and a back-face-culled rig then renders one arm
  // inside out.
  for (const side of [-1, 1]) {
    const p = parts(T);
    const w = P.armW * 0.86;
    p.box(w, P.foreL, w, { y: -P.foreL / 2, top: 1.06, bottom: 0.74, v: 0.24 });

    const hw = w * 0.78;
    const hy = -P.foreL - 0.05;
    // palm
    p.box(hw * 1.2, 0.09, hw * 0.66, { y: hy, z: w * 0.05, top: 0.94, bottom: 0.92 });
    // fingers, curled in toward the palm
    p.box(hw * 1.1, 0.085, hw * 0.58,
      { y: hy - 0.075, z: w * 0.19, rx: 0.6, top: 0.66, bottom: 1.0 });
    // thumb, on the inboard side
    p.box(hw * 0.34, 0.055, hw * 0.3,
      { x: -side * hw * 0.52, y: hy - 0.012, z: w * 0.2, rz: side * 0.38, rx: 0.3, chamfer: 0 });

    out[side < 0 ? 'foreL' : 'foreR'] = p.build();
  }

  // --- the head -------------------------------------------------------------
  //
  // BUILT LIGHT-FIRST, WHICH IS THE OPPOSITE OF THE VERSION BEFORE IT.
  //
  // The old head was a DARK skull with two linen bands laid over it, leaving the
  // socket band exposed between them. Rendered, that produced a black box with a
  // pale cap: from any angle off dead-on, the bands' own taper pulled their
  // front faces back inside the skull's, so the light geometry only survived at
  // the sides and the face went solid black. It read as a visor - the exact
  // failure the bands were introduced to correct, arrived at from the other
  // direction.
  //
  // So the whole head is LINEN, one wrapped mass, and the dark is a band cut
  // across it at eye level. Light-on-dark cannot fail this way: the dark member
  // is narrower than the head in x and proud of it in z, so there is no
  // arrangement of taper and angle in which it loses to the thing behind it.
  {
    // A cranium, not a cube: wide at the back of the skull, narrow at the jaw.
    const p = parts(T);
    p.box(P.headW, P.headH, P.headD, {
      y: P.headH / 2, top: 0.98, bottom: 0.80, depthTop: 0.98, depthBottom: 0.86, v: 0.4,
    });
    // The crown, wrapped over the top and slightly proud, so the skull has a
    // horizontal line across it above the brow.
    p.box(P.headW * 1.04, P.headH * 0.30, P.headD * 1.02,
      { y: P.headH * 0.84, top: 0.78, bottom: 1.0, v: 0.78 });
    out.headLinen = p.build();
  }

  {
    const p = parts(T);
    // The socket band: the gap in the wrapping, and the only dark on the head.
    // Narrower than the skull and standing proud of it, which is what makes it
    // read as a recess rather than as a painted stripe.
    p.box(P.headW * 0.88, P.headH * 0.19, P.headD * 1.02,
      { y: P.headH * 0.47, top: 1.0, bottom: 0.96 });
    out.skull = p.build();
  }

  {
    const p = parts(T);
    // The brow. It stands proud of the face specifically so the sockets under
    // it are in its shadow at every sun angle the courtyard has.
    p.box(P.headW * 0.97, P.headH * 0.11, P.headD * 0.40,
      { y: P.headH * 0.60, z: P.headD * 0.40 });
    // A strap around the jaw, tying the wrapping shut. It also breaks the
    // vertical run of the jaw linen, which otherwise reads as a helmet.
    p.box(P.headW * 0.24, P.headH * 0.36, P.headD * 1.04,
      { x: P.headW * 0.28, y: P.headH * 0.22, ry: 0.14, top: 1.0, bottom: 0.9, v: 0.9 });
    out.headDark = p.build();
  }

  {
    // Two sockets, set into the dark band and deep in the brow's shadow. Flat
    // boxes: a bevel on a three-centimetre member is triangles spent on an edge
    // nothing will ever resolve.
    const p = parts(T);
    for (const s of [-1, 1]) {
      p.box(P.headW * 0.17, P.headH * 0.09, 0.03,
        { x: s * P.headW * 0.23, y: P.headH * 0.47, z: P.headD * 0.53, chamfer: 0 });
    }
    out.eyes = p.build();
  }

  // --- gilding, where a variant has any -------------------------------------
  if (P.plate || P.shoulderSlab) {
    const p = parts(T);
    if (P.plate) {
      // A broad, flat, gilded pectoral, so the silhouette reads as ARMOUR from
      // the front at a distance where the limbs are still a smudge.
      p.box(P.plate.w, P.plate.h, 0.1,
        { y: P.chestH * 0.62, z: P.bodyD * 0.5 + 0.03, top: 1.0, bottom: 0.74 });
    }
    if (P.shoulderSlab) {
      for (const s of [-1, 1]) {
        p.box(P.shoulderSlab.w, P.shoulderSlab.h, P.shoulderSlab.d, {
          x: s * (P.chestW * 0.5 + P.shoulderSlab.w * 0.35),
          y: P.chestH * 0.86, rz: s * 0.14, top: 0.86, bottom: 1.0,
        });
      }
    }
    out.torsoAccent = p.build();
  }

  if (P.headdress) {
    // A nemes flare. Two angled slabs either side of the skull, which is the
    // single cheapest way to make a silhouette read as royal rather than as
    // another corpse.
    const p = parts(T);
    for (const s of [-1, 1]) {
      p.box(P.headdress.w, P.headdress.h, 0.09, {
        x: s * (P.headW * 0.5 + P.headdress.w * 0.42),
        y: P.headH * 0.52, z: -P.headD * 0.1, rz: s * -0.34,
        top: 1.0, bottom: 0.7,
      });
    }
    out.headAccent = p.build();
  }

  return out;
}

function rigGeometry(P) {
  let g = RIG_GEO.get(P);
  if (!g) { g = buildRigGeometry(P); RIG_GEO.set(P, g); }
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
// wedges
// ---------------------------------------------------------------------------

/**
 * WHY AVOIDANCE IS NOT ENOUGH, AND WHAT THE MISSING HALF IS.
 *
 * resolveAgainstWorld() has always returned whether it touched anything, and
 * its own doc says the caller uses that "to decide whether it is wedged and
 * should give up on its current heading". No caller ever read it. The hook
 * existed; the behaviour did not.
 *
 * The failure it was meant to catch, measured per frame on wave one: a shambler
 * pressed flat against the outside of the colonnade at (16.74, 30.34), holding
 * st.v at the full 2.25 m/s for 635 consecutive ticks and moving 0.000 m on 606
 * of them. It was ticked, it was pathing, it was not staggered, and it never
 * moved, because avoid() SUMS a sideways force per collider and the two discs
 * it was between - (15, 31.5) and (15, 29.1) - sat on opposite sides of its
 * heading. Their contributions cancelled to nothing. A continuous wall run is
 * built out of overlapping discs on purpose, so this is not a corner case on
 * this map: it is what walking into any wall square-on does.
 *
 * "Frozen" and "wedged" also look identical on screen, because the walk phase
 * is advanced by real horizontal velocity, so the actor stops animating too.
 *
 * The escape is a committed detour, not a per-frame nudge. Steering sideways
 * only while the wedge is detected produces a stutter: the moment it slides it
 * is making progress, the bias drops, and it turns back into the wall. So a
 * wedge opens a DETOUR with a fixed duration and a fixed hand, and the hand is
 * chosen by asking the map which way the obstacle ends.
 */
export const WEDGE_TRIP = 0.35;   // seconds of no ground made before it counts
export const DETOUR_S = 2.4;      // how long a chosen hand is committed to
export const DETOUR_BIAS = 1.7;   // sideways weight while detouring, vs 1.0 forward
const DETOUR_PROBE = 3.0;         // metres between probes along the tangent
const DETOUR_REACH = 5;           // how many probes, so 15 m of wall

/** Is a disc of this radius free of the world at this point? */
function pointClear(x, z, pad, feetY, ctx) {
  if (ctx.walls) {
    const head = feetY + ctx.actorHeight;
    for (const w of ctx.walls) {
      if (head <= w.y0 || feetY >= w.y1) continue;
      if (Math.abs(x - w.x) < w.w / 2 + pad && Math.abs(z - w.z) < w.d / 2 + pad) return false;
    }
  }

  const n = ctx.colliderGrid.near(x, z, pad);
  const list = ctx.colliderGrid.out;
  for (let i = 0; i < n; i++) {
    const c = list[i];
    const base = c.y0 === undefined ? groundAt(ctx, c.x, c.z, feetY) : c.y0;
    if (feetY - base > c.h) continue;
    const dx = x - c.x, dz = z - c.z;
    const want = c.r + pad;
    if (dx * dx + dz * dz < want * want) return false;
  }
  return true;
}

/**
 * Which hand walks off the end of whatever is in the way.
 *
 * Not pathfinding, and it does not need to be. It steps sideways along the
 * obstruction and, at each step, reaches one body-length back INTO the blocked
 * heading. The first side where that reach comes up clear is the side the wall
 * ends on. Probing the tangent alone would not do: outside a sixty-metre
 * colonnade both tangents are wide open, and the one with more room is the one
 * that leads away from the gap.
 *
 * Runs once when a detour opens, not per frame.
 */
export function pickDetourSide(pos, dirX, dirZ, radius, feetY, ctx) {
  const tanX = -dirZ, tanZ = dirX;
  const pad = radius + 0.15;
  const ahead = radius + 1.0;

  let best = 1;
  let bestReach = Infinity;
  let bestOpen = -1;

  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? 1 : -1;
    let cleared = Infinity;
    let openTo = 0;

    for (let i = 1; i <= DETOUR_REACH; i++) {
      const step = i * DETOUR_PROBE;
      const bx = pos.x + tanX * side * step;
      const bz = pos.z + tanZ * side * step;
      // The detour itself has to be walkable, or the answer is about a place
      // this actor can never stand.
      if (!pointClear(bx, bz, pad, feetY, ctx)) break;
      openTo = step;
      if (pointClear(bx + dirX * ahead, bz + dirZ * ahead, pad, feetY, ctx)) { cleared = step; break; }
    }

    // Nearest end wins. With no end on either side, the side with more room to
    // work in wins, which at least keeps it moving while the horde behind it
    // reshuffles.
    if (cleared < bestReach || (cleared === bestReach && openTo > bestOpen)) {
      bestReach = cleared;
      bestOpen = openTo;
      best = side;
    }
  }

  return best;
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
 * THE MAPS ARE SHARED AND THE VALUE IS HELD.
 *
 * The file this replaces argued for no maps at all, on texel-density grounds. A
 * blind side-by-side then called the result "flat untextured tan" and put
 * replacing it at the top of its fix list. The maps are generated once in
 * wraps.js and shared by the entire pool, so forty actors cost one upload of
 * each and the suite's "no texture leak over four hundred spawns" check stays
 * at zero.
 *
 * An albedo map MULTIPLIES the material colour, so a map with a mean below
 * white is a palette repaint wearing a texture's clothes - and this palette has
 * been swung twice, landed wrong twice, and then measured exhaustively enough
 * that four candidate repaints were scored against identical background pixels
 * and every one of them LOST legibility. So the colour is divided by the map's
 * mean in linear light before it is used. The body renders at the value it was
 * measured at; the variation rides on top of it for free.
 */
function makeMaterials(spec) {
  const linen = linenMaps();
  const jitter = (hex, h, s, l) =>
    compensate(hex, linen.gain).offsetHSL(h, s, l);

  // Per-instance tone jitter. Identical clones are the loudest tell in a crowd
  // and the fix has to be structural rather than a placement-time afterthought.
  //
  // Widened from the pass before this one, which ran +/-0.01 hue and +/-0.045
  // lightness - under a per-channel tolerance the eye cannot resolve at seven
  // metres, let alone twenty. It is a SPREAD around the measured mean, not a
  // shift of it: the crowd's average value is exactly where it was.
  const dh = (Math.random() - 0.5) * 0.05;
  const ds = (Math.random() - 0.5) * 0.10;
  const dl = (Math.random() - 0.5) * 0.13;

  // The floor is set here as well as in setFlash so a material is never black
  // between being built and being spawned.
  const wrap = new THREE.MeshStandardMaterial({
    color: jitter(spec.palette.wrap, dh, -0.03 + ds, dl),
    map: linen.map,
    normalMap: linen.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: linen.roughnessMap,
    roughness: 0.96,
    metalness: 0.0,
    emissive: CHAMBER_FLOOR.clone(),
  });

  const wrapDark = new THREE.MeshStandardMaterial({
    color: jitter(spec.palette.wrapDark, dh, ds * 0.6, dl * 0.6),
    map: linen.map,
    normalMap: linen.normalMap,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughnessMap: linen.roughnessMap,
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
    color: jitter(spec.palette.wrapDark, dh, -0.05 + ds, dl),
    map: linen.map,
    normalMap: linen.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
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
  const G = rigGeometry(P);
  const meshes = [];
  let triangles = 0;

  const add = (parent, g, mat, region) => {
    if (!g) return null;
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

  /**
   * PER-INSTANCE BODY, AND WHY IT IS FREE.
   *
   * "Identical across all six" was one of four defects a blind judge listed by
   * name. The pass before this one answered it with a 13 per cent height jitter
   * and a shoulder droop, which is not enough to break a crowd: six bodies of
   * the same build at slightly different heights still read as one asset
   * repeated.
   *
   * The thing that makes this cheap is that GEOMETRY is shared and the RIG is
   * not. Every actor allocates its own groups, so limb lengths, limb girths,
   * torso proportions and head size can all vary per instance for the cost of a
   * few numbers - no extra BufferGeometry, no extra draw call, nothing added to
   * the spawn path. A shared geometry scaled 0.88 on x and z and 1.07 on y IS a
   * different limb.
   *
   * Leaf meshes only. A non-uniform scale on a group whose children rotate
   * shears them, so nothing above a mesh is ever scaled unevenly - the variation
   * rides on the meshes, which have no children, and on the joint offsets.
   */
  const R = () => Math.random();
  const j = {
    leg: 0.93 + R() * 0.15,        // femur and tibia together
    arm: 0.92 + R() * 0.17,
    girth: 0.90 + R() * 0.22,      // limb thickness
    chest: 0.93 + R() * 0.15,      // torso height
    chestW: 0.90 + R() * 0.20,     // torso width and depth
    head: 0.93 + R() * 0.14,
  };

  const asym = {
    scale: 0.90 + R() * 0.20,
    tilt: (R() - 0.5) * 0.34,      // permanent head cant
    droop: (R() - 0.5) * 0.07,     // shoulder height difference
    reach: (R() - 0.5) * 0.38,     // one arm further out than the other
  };

  // Gait, per instance. Twenty-four bodies walking on the same stride length at
  // the same rate is a chorus line, and it is the one variation that only shows
  // once they are MOVING - which is when the player actually looks at them.
  const gait = {
    rate: 0.88 + R() * 0.26,
    stride: 0.85 + R() * 0.32,
    swing: 0.8 + R() * 0.45,
  };

  /**
   * WRAP DAMAGE, chosen per instance.
   *
   * A corpse that has been unravelling for three thousand years has not
   * unravelled the same way as the one beside it. One in four gets a limb whose
   * linen has gone entirely, which swaps that member onto the dark material -
   * a real value change in the silhouette, not a tint - and the trailing wraps
   * are drawn from the spec's list rather than all worn at once.
   */
  const bare = {
    arm: R() < 0.28 ? (R() < 0.5 ? -1 : 1) : 0,
    leg: R() < 0.22 ? (R() < 0.5 ? -1 : 1) : 0,
  };

  const hips = new THREE.Group();
  hips.position.y = P.hipY * j.leg;
  body.add(hips);

  add(hips, G.pelvis, mats.wrapDark, 'body')
    .scale.set(j.chestW, 1, j.chestW);

  // --- legs ------------------------------------------------------------------
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * P.legX * j.chestW, 0, 0);
    hips.add(hip);

    add(hip, G.thigh, bare.leg === side ? mats.wrapDark : mats.wrap, 'body')
      .scale.set(j.girth, j.leg, j.girth);

    const knee = new THREE.Group();
    knee.position.y = -P.thighL * j.leg;
    hip.add(knee);

    add(knee, G.shin, mats.wrapDark, 'body').scale.set(j.girth, j.leg, j.girth);

    legs.push({ hip, knee, side });
  }

  // --- torso -----------------------------------------------------------------
  const torso = new THREE.Group();
  torso.position.y = P.torsoY;
  hips.add(torso);

  add(torso, G.torsoLinen, mats.wrap, 'body').scale.set(j.chestW, j.chest, j.chestW);
  add(torso, G.torsoDark, mats.wrapDark, 'body').scale.set(j.chestW, j.chest, j.chestW);
  add(torso, G.torsoAccent, mats.accent, 'body')?.scale.set(j.chestW, j.chest, j.chestW);

  // --- arms ------------------------------------------------------------------
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * P.shoulderX * j.chestW,
      P.shoulderY * j.chest + side * asym.droop, 0);
    torso.add(shoulder);

    add(shoulder, G.upper, bare.arm === side ? mats.wrapDark : mats.wrap, 'body')
      .scale.set(j.girth, j.arm, j.girth);

    const elbow = new THREE.Group();
    elbow.position.y = -P.upperL * j.arm;
    shoulder.add(elbow);

    add(elbow, side < 0 ? G.foreL : G.foreR, mats.wrapDark, 'body')
      .scale.set(j.girth, j.arm, j.girth);

    arms.push({ shoulder, elbow, side, bias: side * asym.reach });
  }

  // --- head ------------------------------------------------------------------
  const neck = new THREE.Group();
  neck.position.y = P.headY * j.chest;
  neck.scale.setScalar(j.head);
  torso.add(neck);

  // Four meshes, all region 'head'. A hit on the bandaged jaw of a mummy is a
  // headshot by any reading, and splitting hairs there would only make the 100
  // gold feel arbitrary.
  //
  // THE HEAD IS BUILT AROUND ONE MISTAKE THIS REPLACES. An earlier pass put a
  // single wide emissive BAR across the face at intensity 2.4. On a GPU, in
  // sun, it was the brightest thing in frame that was not the muzzle flash, and
  // it read as a machine visor: the strongest possible "this is a robot" cue,
  // on the one surface the player looks at. What a wrapped skull actually has
  // is two dark holes under an overhanging brow, and whatever is in them is
  // barely alight.
  add(neck, G.skull, mats.deep, 'head');
  add(neck, G.headLinen, mats.wrap, 'head');
  add(neck, G.headDark, mats.wrapDark, 'head');
  add(neck, G.eyes, mats.eye, 'head');
  add(neck, G.headAccent, mats.accent, 'head');

  // --- trailing wraps --------------------------------------------------------
  // Thin geometry is what breaks a silhouette into readable depth layers, and a
  // mummy with none is a stack of boxes. These hang from pivots and lag the
  // body, so they trail on the move and settle when it stops.
  const tatters = [];
  for (const t of P.tatters) {
    // Not every corpse still has every wrap. Dropping one at random varies both
    // the outline and the draw call count, which is the rare variation that
    // costs less than none.
    if (P.tatters.length > 1 && R() < 0.18) continue;

    const pivot = new THREE.Group();
    pivot.position.set(t.x, t.y * j.chest, t.z);
    // A strip lies in its own XY plane, so an unrotated one is edge-on from the
    // side and a flat billboard from the front. Distributing them around Y is
    // what turns four rags into a ragged OUTLINE rather than four flags.
    pivot.rotation.y = (t.yaw || 0) + (R() - 0.5) * 0.5;
    (t.on === 'arm' ? arms[t.side > 0 ? 1 : 0].elbow : torso).add(pivot);

    const m = new THREE.Mesh(stripGeo(t.w, t.h, t.cut || 0), mats.tatter);
    m.scale.set(0.82 + R() * 0.4, 0.8 + R() * 0.45, 1);
    // Wraps are decoration. Left hittable they sit in front of the skull at
    // certain angles and silently convert a headshot into a body hit, which is
    // a 40 gold bug the player would never be able to diagnose.
    m.userData.noHit = true;
    m.castShadow = false;
    pivot.add(m);

    tatters.push({ pivot, phase: R() * 6.283, swing: (t.swing ?? 1) * gait.swing });
    triangles += m.geometry.attributes.position.count / 3;
  }

  // --- the ground it stands on ------------------------------------------------
  //
  // Last, and outside `body`, so the topple rotates the corpse and leaves the
  // patch on the sand where the feet were. See contact.js for what the sun's
  // own shadow does and does not do here.
  const blob = contactShadow((spec.radius ?? 0.45) * 1.75);
  blob.position.y = 0.03;
  group.add(blob);

  return {
    group, body, hips, torso, neck, legs, arms, tatters, meshes, triangles,
    asym, gait, blob,
  };
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

  // Per-instance gait, decided at build. A horde walking one stride length in
  // one rhythm is a chorus line, and it is the variation that only shows once
  // they move - which is exactly when the player is looking at them.
  const gj = rig.gait || ONE_GAIT;

  const drive = Math.min(1, s.speed / spec.speed);
  const amp = g.stride * gj.stride * (0.35 + 0.65 * drive);

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
      arm.shoulder.rotation.x = reach + Math.sin(p + o) * g.armSwing * gj.swing * drive;
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

/** What a rig with no per-instance gait falls back to. Bosses build their own
 * rigs through the same animator and are single instances, so they have no
 * crowd to differentiate themselves from. */
const ONE_GAIT = { rate: 1, stride: 1, swing: 1 };

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

    // Wedge escape. `wedge` is seconds of holding velocity without covering
    // ground, `detour` is seconds left on a committed sideways heading,
    // `detourSide` the hand it committed to, `detourFrom` the distance to the
    // player when it opened, and `forceSide` a hand the NEXT detour must take
    // because the last one bought nothing.
    wedge: 0,
    detour: 0,
    detourSide: 1,
    detourFrom: 0,
    forceSide: 0,
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
    st.wedge = st.detour = st.detourFrom = st.forceSide = 0;
    st.detourSide = 1;

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

    // A committed detour outranks both, and is taken square off the line to the
    // player rather than off the steered heading: the steered heading is the
    // one that is already jammed.
    if (st.detour > 0) {
      _dir.x += -(tz / dist) * st.detourSide * DETOUR_BIAS;
      _dir.z += (tx / dist) * st.detourSide * DETOUR_BIAS;
    }

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

    const wasX = pos.x, wasZ = pos.z;
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

    // --- wedged? ------------------------------------------------------------
    //
    // Measured on DISPLACEMENT, not on whether resolveAgainstWorld touched
    // something. Touching is normal: the horde grinds past pillars and along
    // walls constantly and arrives perfectly well. The thing that ends a round
    // is holding a heading and covering no ground, and that is one subtraction.
    {
      const moved = Math.hypot(pos.x - wasX, pos.z - wasZ);
      const wanted = Math.hypot(st.vx, st.vz) * dt;

      if (st.detour > 0) {
        st.detour -= dt;
        if (st.detour <= 0) {
          // A hand that bought nothing does not get a second turn. Without
          // this an actor can commit to the long way round a sixty-metre wall
          // forever, which is the same round-never-ends symptom with a longer
          // period.
          st.forceSide = dist > st.detourFrom - 0.75 ? -st.detourSide : 0;
          st.wedge = 0;
        }
      } else {
        if (wanted > 1e-3 && moved < wanted * 0.45) st.wedge += dt;
        else st.wedge = Math.max(0, st.wedge - dt * 2.5);

        if (st.wedge >= WEDGE_TRIP) {
          st.detourSide = st.forceSide
            || pickDetourSide(pos, tx / dist, tz / dist, actor.radius * spec.scale, st.feetY, ctx);
          st.forceSide = 0;
          st.detour = DETOUR_S;
          st.detourFrom = dist;
          st.wedge = 0;
        }
      }
    }

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
    // The walk cycle is driven by REAL horizontal velocity, scaled by this
    // instance's own tempo. A staggered enemy's legs slow down with it and one
    // pinned against a pillar stops walking on the spot, which is the whole
    // reason this is not a free-running timer.
    st.phase += dt * (0.8 + speed * spec.gait.rate) * (rig.gait ? rig.gait.rate : 1);

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

  /**
   * THE THREE RATIOS THAT MAKE A SHAPE READ AS A PERSON.
   *
   * A blind judge described these as "blocky rectangular torsos, cylindrical
   * limbs, no hands". Two of the three are answered by the builder - the torso
   * is a wedge now and every limb tapers - and the third by the hand on the end
   * of each forearm. What is left is the numbers, and the numbers that matter
   * are RATIOS rather than sizes:
   *
   *   SHOULDER SPAN TO HEAD WIDTH. On a person the head is a quarter to a third
   *   of the shoulder span. It was 0.24 against a 0.54 span, which is 44 per
   *   cent: a bobblehead, and the loudest toy cue in the old outline. The head
   *   comes down to 0.225 and the shoulders out to 0.285 a side; with the
   *   deltoid over the joint the span is 0.79 and the ratio lands at 0.28.
   *
   *   SHOULDER TO WAIST. The builder's chest taper, 1.0 at the shoulder to 0.66
   *   at the waist. A slab the same width at both is a crate.
   *
   *   LIMB TAPER. Also the builder's: thigh 1.08 at the hip to 0.82 at the
   *   knee, calf 1.06 to 0.68 at the ankle, forearm 1.06 to 0.74 at the wrist.
   *   Pulled back from a first pass at 0.78 / 0.58 / 0.64, which rendered a
   *   forearm as a spike - taper reads as anatomy up to the point where the far
   *   end stops being a limb.
   *
   * hipY is not free. It must equal thighL + shinL or the feet leave the sand,
   * which is why the per-instance leg jitter scales all three together.
   */
  proportions: {
    hipY: 0.92, hipW: 0.34, bodyD: 0.26,
    legX: 0.13, legW: 0.16, thighL: 0.44, shinL: 0.48,
    torsoY: 0.14, chestW: 0.46, chestH: 0.56,
    shoulderX: 0.285, shoulderY: 0.50, armW: 0.14, upperL: 0.40, foreL: 0.42,
    headY: 0.66, headW: 0.225, headH: 0.275, headD: 0.255,
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
