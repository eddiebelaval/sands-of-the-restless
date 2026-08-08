/**
 * THE ONE ENEMY THAT DOES NOT LIVE ON THE FLOOR.
 *
 * THE HABIT THIS IS BUILT AGAINST is the same one the gold scarab already
 * exists to punish, one axis further out. variants.js says it plainly: by wave
 * fifteen the player has a single answer to everything, which is backpedal in a
 * circle and hold fire. The gold scarab moved the soft panel to the BACK, which
 * breaks the "hold fire" half. It did not touch the other half, because every
 * body in the roster still arrives along the floor, so the player's SEARCH is
 * still a horizontal sweep at eye level and it is still complete. An enemy that
 * comes down the wall behind them, or lets go of the ceiling over their head, is
 * the first thing in the game that a horizontal sweep does not find.
 *
 * WHY THIS IS NOT A FLOW FIELD PROBLEM, AND WHY IT GETS ITS OWN STEERING.
 * enemies/flow.js is a distance-to-player map over ONE floor, keyed on (x, z),
 * and its own header says what it drops: it cannot hold the gallery floor and
 * the bridge six metres over it at the same time. A body on a wall is not on
 * either. So nothing here reads the field: the crawler's whole route is three
 * legs, each of which is a straight line in a surface it is already stuck to.
 * That is enough because the legs are short - pick a wall inside 14 m, climb it,
 * cross the ceiling of ONE room - and a body that cannot solve a maze on a
 * ceiling is a body that gives up and drops, which is the behaviour we want
 * anyway.
 *
 * WHY AXIS-ALIGNED BOXES MAKE THIS SMALL. Every wall in the game comes out of
 * emitWall() in world/build.js as `{x, z, w, d, y0, y1}`, so a wall surface
 * normal is always one of four horizontal unit vectors and never anything else.
 * There is no mesh traversal here, no raycast, no contact solver: a face is a
 * fixed coordinate plus a clamped span, and "walking on it" is two scalars.
 *
 * WHAT THE CEILING IS. Also a wall record. buildShell() emits a room's side
 * walls from the floor to the ceiling in one box, so a full-height wall's `y1`
 * IS the room's ceiling height, and `topsOut()` below is what refuses the two
 * kinds of box whose top is not a ceiling - the breast under a doorway and any
 * wall with another wall stacked over it.
 *
 * THE HUNT CYCLE, which is the part that had to be designed rather than derived:
 *
 *   ground   ordinary floor pursuit, mummy.js's, untouched. After COOL_S with
 *            the player further off than MOUNT_MIN_M it goes looking for a wall.
 *   approach still on the floor, still under separation and avoid() and the
 *            wedge escape, but steering at a wall face instead of at the player.
 *   wall     climbing, drifting sideways toward the player's lateral position.
 *   roof     upside down, crossing to a point over the player.
 *   drop     lets go, falls under mummy.js's own gravity, rights itself.
 *
 * A crawler that only mounted a wall it happened to be jammed against would
 * almost never leave the floor, because its heading is by definition AWAY from
 * the wall and toward the player. The approach leg is the whole reason this
 * reads as an enemy doing something rather than as a physics accident.
 */

import * as THREE from 'three';

export const SURF_FLOOR = 0;
export const SURF_WALL = 1;
export const SURF_ROOF = 2;

/** Outward normals of the four faces, indexed 0:+X 1:-X 2:+Z 3:-Z. */
const FACE_NX = [1, -1, 0, 0];
const FACE_NZ = [0, 0, 1, -1];

// ---------------------------------------------------------------------------
// the numbers
// ---------------------------------------------------------------------------

/**
 * Climb speed, as a fraction of the spec's floor speed.
 *
 * 0.62 of the gold scarab's 3.9 is 2.42 m/s, which takes it up the Hall of
 * Offerings' 9 m ceiling in 3.7 seconds and the Great Gallery's 16 m in 6.6.
 * The upper bound on this number is not fiction, it is a firing window: the
 * whole point of a wall leg is that the player CAN look up and shoot it off the
 * stone, and a body that clears a nine-metre wall in under two seconds is a body
 * that was never really there to be shot at.
 */
const WALL_MUL = 0.62;

/**
 * Ceiling speed, same units.
 *
 * Faster than the climb because nothing is fighting it, and still 3.04 m/s -
 * UNDER the player's 5.4 m/s walk, which is the constraint GOLD_SCARAB's own
 * `speed` comment sets and for the same reason: an enemy the player cannot walk
 * out from under is an enemy with no counterplay, and here the counterplay is
 * literally to step aside.
 */
const ROOF_MUL = 0.78;

/**
 * How long the floor-to-wall and wall-to-ceiling turns take, in seconds.
 *
 * These are the readability numbers and they are the reason there is a transit
 * state at all rather than a surface swap. 0.55 and 0.50 are each about two of
 * the player's ~0.25 s reaction windows - the same currency the GOLD_SCARAB
 * wind-up is priced in - so both turns are events a player can see happen and
 * react to, instead of a body that was on the floor last frame and on the wall
 * this one.
 */
const MOUNT_S = 0.55;
const LIP_S = 0.50;

/**
 * Seconds pressed against a wall face before the mount commits.
 *
 * DELIBERATELY UNDER WEDGE_TRIP, which is 0.35 in mummy.js. A body holding a
 * heading into stone and covering no ground is exactly what the wedge detector
 * is watching for, and it would open a committed 2.4 s sideways detour and drag
 * the crawler off the face it was about to climb. 0.25 wins that race by a
 * tenth of a second, and the FLOOR branch below also zeroes st.wedge while the
 * press is building, so the two systems do not have to be read together to be
 * safe.
 */
const GRAB_S = 0.25;

/** How close the body's origin has to get to the mount spot to count as pressed. */
const GRAB_D = 0.55;

/**
 * The shortest wall worth climbing, in metres above the floor at its base.
 *
 * Room heights on this map are 5, 7, 9, 12, 16 and 30, so 4.0 admits every room
 * and excludes the two box shapes that are not rooms: the breast under a
 * doorway (sill minus one ramp thickness) and any low run. It is also about the
 * shortest drop that reads as a drop rather than as a hop.
 */
const MIN_WALL_H = 4.0;

/**
 * How far it will walk to reach a wall, and how long it will spend trying.
 *
 * 14 m at 3.9 m/s is 3.6 seconds of approach. Further than that and the player
 * has usually moved somewhere the chosen wall no longer overlooks, which turns
 * the whole cycle into a body walking away from the fight - the single worst
 * thing this feature could look like.
 */
const APPROACH_R = 14;
const APPROACH_MAX_S = 5.0;

/**
 * WHAT A FAILED APPROACH COSTS, AND WHY IT COSTS ANYTHING AT ALL.
 *
 * MEASURED, and it is the one defect the swarm scenario in test/wallcrawl.mjs
 * caught. Six gold scarabs in the Great Gallery, and the one placed at
 * (0, -192) landed on the upper ledge at y 6. From up there the nearest
 * climbable box is the head slab over a doorway - y0 4.2, which is under its
 * feet, so it passes every filter above - and the ledge does not reach the part
 * of that face the search picked. It walked at it, timed out at 5 s, re-picked
 * the same slab, and did that for the whole 45-second run: surface 0 the entire
 * time, never once closer than 13.55 m, while the ordinary scarab from the
 * identical point arrived at 1.8 m. A wall crawler that never crawls and never
 * arrives is strictly worse than the enemy it replaced.
 *
 * So a failed approach buys a full cooldown of ordinary floor pursuit rather
 * than an immediate second guess, and three failures in a row buy four of them.
 * Same argument as DETOUR_S's forceSide in mummy.js - a hand that bought nothing
 * does not get a second turn - and the same shape of consequence if it is
 * missing: a round that does not end.
 */
const FAIL_GIVEUP = 3;

/**
 * It will not start climbing with the player inside this range.
 *
 * 7 m. Closer than that, a beetle turning and scaling a wall reads as FLEEING,
 * and worse, it would be a way to break contact and heal the fight's tempo -
 * the same complaint GOLD_SCARAB's stagger note makes about chip-firing into
 * the front plate.
 */
const MOUNT_MIN_M = 7;

/**
 * Horizontal radius under which it lets go.
 *
 * 2.2 m against an effective bite reach of 1.35 x 1.18 = 1.59 plus the player's
 * radius. So it lands just inside its own attack range rather than needing a
 * second approach after the drop, which is what makes the ambush pay.
 */
const DROP_R = 2.2;

/** The tell before it lets go: it stops dead for a third of a second first. */
const POISE_S = 0.30;

/**
 * Give-up timers for the two off-floor legs.
 *
 * Same argument as DETOUR_S's "a hand that bought nothing does not get a second
 * turn": a crawler that cannot get over a player who has walked into a room it
 * cannot reach the ceiling of must come down and fight, because a round that
 * does not end is worse than an enemy that made a bad choice.
 */
const WALL_MAX_S = 8;
const ROOF_MAX_S = 7;

/**
 * Floor time between one drop and the next mount.
 *
 * 5 s, and it is a balance number rather than a technical one. The drop puts a
 * gold scarab on the floor with its back panel toward whoever it just landed
 * next to; without a cooldown it would immediately go looking for another wall
 * and spend the fight out of reach. Five seconds is about two full magazines of
 * the starting pistol, which is the window the vent is meant to be shot in.
 */
const COOL_S = 5;

/** Seconds of righting after it lets go, and how fast a heading settles. */
const RIGHT_S = 0.45;
const ORIENT_RATE = 9;

/** Height on the face the mount lands at, and clearance kept under the ceiling. */
const MOUNT_H = 0.45;
const LIP = 0.5;

/** How often the wall search runs while approaching. See pickWall for the cost. */
const PICK_S = 0.75;

/**
 * How far under the ceiling the containment probe stands.
 *
 * 0.6 m. The probe passes this as `feetY` to mummy.js's pointClear, whose wall
 * test is `head <= w.y0 || feetY >= w.y1`; with a gold scarab's actorHeight of
 * 0.65 that puts the probe's head a whisker ABOVE the ceiling line, so every
 * box that reaches the ceiling - the room's own walls and the lintel over every
 * doorway - blocks it. That is what keeps a ceiling crawl inside one room
 * without this file knowing anything about the room graph.
 */
const CEIL_PROBE = 0.6;

// ---------------------------------------------------------------------------
// scratch, allocated once for the module
// ---------------------------------------------------------------------------

const _up = new THREE.Vector3();
const _fw = new THREE.Vector3();
const _rt = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/**
 * Build the rotation that stands a body up on a surface.
 *
 * The rig convention is the one every animator in this project assumes: the
 * actor's own +Y is up and its own +Z is forward. So the target basis is
 * columns [n x f, n, f], with the forward vector projected into the surface
 * plane first because a heading toward a player standing on the floor is not
 * perpendicular to a wall normal and would shear the body if used raw.
 *
 * X = n x f rather than f x n is forced, not chosen: on the floor n is +Y and
 * f is (sin yaw, 0, cos yaw), and n x f comes out (cos yaw, 0, -sin yaw), which
 * is exactly the first column of Ry(yaw). The other order builds a mirror.
 */
function aim(q, nx, ny, nz, fx, fy, fz) {
  _up.set(nx, ny, nz);
  _fw.set(fx, fy, fz);

  _fw.addScaledVector(_up, -_fw.dot(_up));
  if (_fw.lengthSq() < 1e-6) {
    // The heading was straight into the surface. Any axis not parallel to the
    // normal will do for one frame; the steering will have a real one by the
    // next.
    _fw.set(-_up.z, _up.x, _up.y);
    _fw.addScaledVector(_up, -_fw.dot(_up));
  }
  _fw.normalize();

  _rt.crossVectors(_up, _fw);
  _m.makeBasis(_rt, _up, _fw);
  return q.setFromRotationMatrix(_m);
}

// ---------------------------------------------------------------------------
// wall geometry
// ---------------------------------------------------------------------------

/** Which face of this box a point is outside of, or -1 if it is inside it. */
function faceOf(w, px, pz) {
  const dx = px - w.x;
  const dz = pz - w.z;
  const ox = Math.abs(dx) - w.w / 2;
  const oz = Math.abs(dz) - w.d / 2;
  if (ox <= 0 && oz <= 0) return -1;
  if (ox >= oz) return dx >= 0 ? 0 : 1;
  return dz >= 0 ? 2 : 3;
}

/**
 * Is this box's top a ceiling, or is it the top of a step?
 *
 * buildShell emits three kinds of box on a wall line: floor to ceiling, floor to
 * the breast under a doorway, and the head of a doorway up to the ceiling. Only
 * the first is climbable to somewhere, and the tell is that nothing else in the
 * wall list stands ON it. The breast always has the door's head slab directly
 * above, so one overlap test separates them without this file needing to know
 * what a sill is.
 *
 * Linear over the wall list, and it runs once per candidate that has already
 * won the distance sort rather than once per candidate, so the O(n^2) shape it
 * looks like is really one extra pass every PICK_S seconds.
 */
function topsOut(walls, w) {
  for (const v of walls) {
    if (v === w || v.y0 < w.y1 - 0.05) continue;
    if (Math.abs(v.x - w.x) >= (v.w + w.w) / 2) continue;
    if (Math.abs(v.z - w.z) >= (v.d + w.d) / 2) continue;
    return false;
  }
  return true;
}

/**
 * Pick a wall to climb.
 *
 * Scored by how close the FACE is to the player rather than to the crawler,
 * because the point of the trip is to arrive over the player's head: the
 * nearest wall to the body is very often the one behind it. The crawler's own
 * distance is a filter (APPROACH_R) rather than a term in the score.
 *
 * Iterated linearly, like resolveAgainstWorld and pointClear, and for the reason
 * spelled out there: a wall record is up to 38 units long, so a spatial hash
 * either returns it from forty cells or forces a query radius that reads the
 * whole map. There are under a hundred of them and this runs at most once every
 * PICK_S per crawler, against resolveAgainstWorld's twice per frame per actor.
 */
function pickWall(c, ctx, pos, floorY, radius, px, pz) {
  const walls = ctx.walls;
  let best = null;
  let bestFace = -1;
  let bestScore = Infinity;

  for (const w of walls) {
    // A box whose base is off the floor is a lintel, not a wall to climb onto,
    // and one that does not reach MIN_WALL_H is not worth the trip.
    if (w.y0 > floorY + 0.6) continue;
    if (w.y1 - floorY < MIN_WALL_H) continue;

    const face = faceOf(w, pos.x, pos.z);
    if (face < 0) continue;

    // The face point nearest the crawler, kept a body's width in from either
    // end so it is not mounting a corner it will immediately slide off.
    const fx = face === 0 ? w.x + w.w / 2 : face === 1 ? w.x - w.w / 2
      : Math.min(w.x + w.w / 2 - radius, Math.max(w.x - w.w / 2 + radius, pos.x));
    const fz = face === 2 ? w.z + w.d / 2 : face === 3 ? w.z - w.d / 2
      : Math.min(w.z + w.d / 2 - radius, Math.max(w.z - w.d / 2 + radius, pos.z));

    const mx = fx - pos.x, mz = fz - pos.z;
    if (mx * mx + mz * mz > APPROACH_R * APPROACH_R) continue;

    const sx = fx - px, sz = fz - pz;
    const score = sx * sx + sz * sz;
    if (score < bestScore) { bestScore = score; best = w; bestFace = face; }
  }

  if (!best || !topsOut(walls, best)) return false;

  const w = best;
  c.wall = w;
  c.face = bestFace;
  c.nx = FACE_NX[bestFace];
  c.nz = FACE_NZ[bestFace];
  // Lateral axis of the face: Z for the two X-normal faces, X for the others.
  c.lx = bestFace < 2 ? 0 : 1;
  c.lz = bestFace < 2 ? 1 : 0;
  c.faceC = bestFace === 0 ? w.x + w.w / 2
    : bestFace === 1 ? w.x - w.w / 2
      : bestFace === 2 ? w.z + w.d / 2 : w.z - w.d / 2;
  c.lo = (c.lx ? w.x - w.w / 2 : w.z - w.d / 2) + radius;
  c.hi = (c.lx ? w.x + w.w / 2 : w.z + w.d / 2) - radius;
  c.ceilY = w.y1;
  c.baseY = floorY;
  c.approach = 0;

  const cur = c.lx ? pos.x : pos.z;
  const lat = Math.min(c.hi, Math.max(c.lo, cur));
  const px2 = c.lx ? lat : c.faceC;
  const pz2 = c.lx ? c.faceC : lat;
  // The standing spot is one body radius out from the stone, which is where
  // resolveAgainstWorld will hold it anyway.
  c.tgtX = px2 + c.nx * (radius + 0.04);
  c.tgtZ = pz2 + c.nz * (radius + 0.04);
  return true;
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

/**
 * One crawler's whole mutable state, allocated when the director builds its
 * pool and never again. Same contract as the `st` record in mummy.js: a spawn
 * is a write over this and nothing else.
 */
export function createCrawl() {
  return {
    surf: SURF_FLOOR,
    wall: null,
    face: -1,
    nx: 0, nz: 0,          // face normal, horizontal
    lx: 0, lz: 1,          // lateral axis of the face
    faceC: 0,              // the face's fixed coordinate
    lo: 0, hi: 0,          // lateral span, body radius already taken off
    ceilY: 0,
    baseY: 0,
    tgtX: 0, tgtZ: 0,      // where on the floor it is walking to
    // The heading it is driving along the face, in world axes. Rebuilt from the
    // drive every frame rather than integrated, so a body that reverses its
    // lateral correction turns around instead of crabbing sideways up a wall.
    hx: 0, hy: 1, hz: 0,

    press: 0,              // seconds pressed against the face
    hold: 0,               // seconds on the current off-floor surface
    approach: 0,           // seconds spent walking at a wall
    cool: 0,               // seconds until it may mount again
    poise: 0,              // the stop before it lets go
    pickIn: 0,             // throttle on the wall search
    fails: 0,              // approaches in a row that reached no face
    right: 0,              // seconds of righting left after a drop

    transit: 0,            // seconds left of a surface change
    transitS: 0,
    fromX: 0, fromY: 0, fromZ: 0,
    toX: 0, toY: 0, toZ: 0,
    fromQ: new THREE.Quaternion(),

    // Published for mummy.js and for the harness.
    motion: false,         // the crawl owns position this frame
    owns: false,           // the crawl owns orientation this frame
    speed: 0,              // surface speed, for the walk cycle
    falling: false,
  };
}

/** Back to a floor animal. Called from spawn(), so a pooled body never inherits. */
export function resetCrawl(c) {
  c.surf = SURF_FLOOR;
  c.wall = null;
  c.face = -1;
  c.press = c.hold = c.approach = c.poise = c.right = 0;
  c.cool = 0;
  c.fails = 0;
  c.pickIn = 0;
  c.transit = c.transitS = 0;
  c.motion = c.owns = c.falling = false;
  c.speed = 0;
}

/**
 * Override the steering heading while walking at a chosen wall.
 *
 * A FULL OVERRIDE RATHER THAN A BLEND, and that is the one place this file
 * overrules the flow field. The field's heading points at the player by
 * construction; anything short of replacing it means the crawler leans toward
 * the wall and walks past it forever. What it does NOT overrule is everything
 * mummy.js applies afterwards - separation, avoid(), the committed detour - so
 * an approach still flows around a pillar and still escapes a wedge.
 */
export function crawlSteer(c, dir, pos) {
  if (c.surf !== SURF_FLOOR || !c.wall || c.transit > 0) return;
  const dx = c.tgtX - pos.x;
  const dz = c.tgtZ - pos.z;
  const l = Math.hypot(dx, dz);
  if (l < 1e-4) return;
  dir.x = dx / l;
  dir.z = dz / l;
}

/**
 * Let go.
 *
 * The fall itself is not written here: it hands the body back to mummy.js with
 * `st.feetY` set to where it actually is and `st.vy` at zero, and the ordinary
 * gravity in update() does the rest, including resolving out of any stone it
 * lets go next to. One integrator for falling bodies, not two.
 */
function detach(c, st, rig, radius, rideH) {
  const pos = rig.group.position;

  if (c.surf === SURF_ROOF) {
    /**
     * TWICE THE RIDE HEIGHT, and it is a continuity fix rather than a fudge.
     * The group origin is the CONTACT point, and the body sits rideH along the
     * body's own up-axis from it. Hanging from a ceiling that puts the shell
     * rideH BELOW the origin; once it has righted itself the shell is rideH
     * ABOVE it. Dropping the origin by the difference is what stops the beetle
     * jumping half a metre upward on the frame it lets go of the roof.
     */
    pos.y -= rideH * 2;
  } else {
    // Off a wall: step clear of the face first, or the first frame of the fall
    // starts inside the stone and the resolver launches it along the room.
    pos.x += c.nx * (radius + 0.05);
    pos.z += c.nz * (radius + 0.05);
  }

  c.surf = SURF_FLOOR;
  c.wall = null;
  c.press = c.hold = c.approach = c.poise = 0;
  c.transit = 0;
  c.cool = COOL_S;
  c.right = RIGHT_S;
  c.falling = true;
  c.motion = false;

  st.feetY = pos.y;
  st.vy = 0;
  st.vx = 0;
  st.vz = 0;
}

/**
 * Killed while it was up there.
 *
 * Called from beginDeath, because update() hands a dying actor straight to
 * updateDeath and crawlTick never runs again. Returns whether it had to let go,
 * which is the fact the death path needs in order to know it owes the corpse a
 * fall.
 */
export function crawlKilled(c, st, rig, radius, rideH) {
  if (c.surf === SURF_FLOOR && c.transit <= 0) return false;
  detach(c, st, rig, radius, rideH);
  return true;
}

/** Open a timed surface change from where the body is to where it is going. */
function beginTransit(c, rig, seconds, surf, tx, ty, tz) {
  const pos = rig.group.position;
  c.fromX = pos.x; c.fromY = pos.y; c.fromZ = pos.z;
  c.toX = tx; c.toY = ty; c.toZ = tz;
  c.fromQ.copy(rig.group.quaternion);
  c.transit = seconds;
  c.transitS = seconds;
  c.surf = surf;
  c.hold = 0;
  c.poise = 0;
}

/**
 * One frame of the crawler.
 *
 * Sets `c.motion` (does this own the body's position), `c.owns` (does it own
 * the body's rotation) and `c.speed` (surface speed, for the walk cycle), and
 * is the only thing in the file mummy.js has to call.
 *
 * `clear` is mummy.js's pointClear passed in rather than imported, so this file
 * does not import the file that imports it. There is exactly one copy of the
 * "a collider over the actor's head does not block" rule and it is not this one.
 */
export function crawlTick(c, dt, ctx, actor, st, spec, rig, dist, clear) {
  const pos = rig.group.position;
  const radius = actor.radius * spec.scale;
  const rideH = (spec.proportions.rideHeight || 0.3) * actor.scale;

  if (c.cool > 0) c.cool -= dt;
  if (c.right > 0) c.right -= dt;
  if (c.pickIn > 0) c.pickIn -= dt;

  c.motion = c.surf !== SURF_FLOOR;
  c.owns = c.motion || c.right > 0;
  c.speed = 0;

  // --- a surface change in progress ----------------------------------------
  if (c.transit > 0) {
    c.transit = Math.max(0, c.transit - dt);
    const u = 1 - c.transit / c.transitS;
    const k = u * u * (3 - 2 * u);
    pos.x = c.fromX + (c.toX - c.fromX) * k;
    pos.y = c.fromY + (c.toY - c.fromY) * k;
    pos.z = c.fromZ + (c.toZ - c.fromZ) * k;
    st.feetY = pos.y;
    // The body sweeps around the lip over the same curve the position does, so
    // the turn cannot finish early or late relative to the move.
    surfaceAim(c, ctx, pos, _q);
    rig.group.quaternion.copy(c.fromQ).slerp(_q, k);
    c.speed = spec.speed * WALL_MUL * 0.6;
    return true;
  }

  switch (c.surf) {
    case SURF_WALL: crawlWall(c, dt, ctx, actor, st, spec, rig, dist, radius, rideH); break;
    case SURF_ROOF: crawlRoof(c, dt, ctx, actor, st, spec, rig, dist, radius, rideH, clear); break;
    default: crawlFloor(c, dt, ctx, actor, st, spec, rig, dist, radius); break;
  }

  if (c.owns) {
    surfaceAim(c, ctx, pos, _q);
    rig.group.quaternion.slerp(_q, Math.min(1, ORIENT_RATE * dt));
    if (c.surf === SURF_FLOOR && c.right <= 0) {
      // Hand the rotation back CLEAN. mummy.js's facing only writes rotation.y,
      // so any residual tilt left on the quaternion would be permanent.
      const yaw = rig.group.rotation.y;
      rig.group.rotation.set(0, yaw, 0);
      c.owns = false;
    }
  }

  return c.motion;
}

/** The body's up-axis and heading for whatever surface it is on or heading to. */
function surfaceAim(c, ctx, pos, q) {
  const px = ctx.playerPos.x, pz = ctx.playerPos.z;

  if (c.surf === SURF_WALL) {
    // Head first up the wall, leaning the way it is drifting.
    return aim(q, c.nx, 0, c.nz, c.hx, c.hy, c.hz);
  }
  if (c.surf === SURF_ROOF) {
    return aim(q, 0, -1, 0, px - pos.x, 0, pz - pos.z);
  }
  return aim(q, 0, 1, 0, px - pos.x, 0, pz - pos.z);
}

/** On the floor: decide whether to go looking for a wall, and press onto it. */
function crawlFloor(c, dt, ctx, actor, st, spec, rig, dist, radius) {
  const pos = rig.group.position;

  if (st.grounded) c.falling = false;

  // No walls at all is the courtyard and the quarry, where `ctx.walls` is not
  // set. A gold scarab out there is exactly the enemy it was before this file.
  if (!ctx.walls || !ctx.walls.length || actor.dying
      || c.cool > 0 || dist < MOUNT_MIN_M || !st.grounded) {
    c.wall = null;
    c.press = 0;
    return;
  }

  if (!c.wall) {
    if (c.pickIn > 0) return;
    c.pickIn = PICK_S;
    if (!pickWall(c, ctx, pos, st.feetY, radius, ctx.playerPos.x, ctx.playerPos.z)) return;
  }

  c.approach += dt;
  if (c.approach > APPROACH_MAX_S) {
    // The wall it chose is not reachable from where it is standing. Drop it and
    // go back to being a floor scarab for a full cooldown, because the search is
    // deterministic and a second look from the same tile picks the same box.
    // See FAIL_GIVEUP for the run this line was written against.
    c.wall = null;
    c.press = 0;
    c.fails++;
    c.cool = c.fails >= FAIL_GIVEUP ? COOL_S * 4 : COOL_S;
    return;
  }

  const dx = c.tgtX - pos.x, dz = c.tgtZ - pos.z;
  if (dx * dx + dz * dz <= GRAB_D * GRAB_D) {
    c.press += dt;
    // Pressing into stone is what the wedge detector is built to catch. Held at
    // zero for the quarter second the mount takes, so the two never race.
    st.wedge = 0;
  } else {
    c.press = Math.max(0, c.press - dt * 2);
  }

  if (c.press < GRAB_S) return;

  const lat = Math.min(c.hi, Math.max(c.lo, c.lx ? pos.x : pos.z));
  const tx = c.lx ? lat : c.faceC;
  const tz = c.lx ? c.faceC : lat;
  // It got onto stone, so the run of failures that may have preceded this one
  // says nothing about where it is standing now.
  c.fails = 0;
  c.hx = 0; c.hy = 1; c.hz = 0;
  beginTransit(c, rig, MOUNT_S, SURF_WALL, tx, st.feetY + MOUNT_H, tz);
}

/** On a wall: climb, drift toward the player's lateral position, or come down. */
function crawlWall(c, dt, ctx, actor, st, spec, rig, dist, radius, rideH) {
  const pos = rig.group.position;
  c.hold += dt;

  // Coming down on top of them is the whole trip, and a player who has walked
  // under the wall is already close enough to take it.
  if (dist < DROP_R || c.hold > WALL_MAX_S || actor.dying) {
    detach(c, st, rig, radius, rideH);
    return;
  }

  const top = c.ceilY - LIP;
  const lat = c.lx ? pos.x : pos.z;
  const want = c.lx ? ctx.playerPos.x : ctx.playerPos.z;

  // Climb is the priority and the sideways drift is a correction on it, which
  // is what stops a crawler that starts thirty metres along a gallery wall from
  // running the length of it at ankle height in full view.
  const vert = pos.y < top ? 1 : 0;
  const side = Math.max(-0.9, Math.min(0.9, (want - lat) / 3));
  const l = Math.hypot(vert, side) || 1;
  const step = spec.speed * WALL_MUL * dt;

  pos.y = Math.min(top, pos.y + (vert / l) * step);
  const moved = Math.min(c.hi, Math.max(c.lo, lat + (side / l) * step));
  if (c.lx) pos.x = moved; else pos.z = moved;
  // Pinned to the face plane. Nothing else may write this coordinate.
  if (c.lx) pos.z = c.faceC; else pos.x = c.faceC;

  st.feetY = pos.y;
  c.speed = spec.speed * WALL_MUL;
  // Guarded because a body that has stopped climbing and has no lateral error
  // left would hand aim() a zero heading, and a zero heading is the one input
  // that makes an orthonormal basis undefined.
  if (vert !== 0 || Math.abs(side) > 1e-4) {
    c.hx = c.lx ? (side / l) : 0;
    c.hy = vert / l;
    c.hz = c.lx ? 0 : (side / l);
  }

  if (pos.y < top - 1e-3) return;

  // Over the lip. The roof point stands clear of the stone by a body radius so
  // the ceiling crawl does not start inside the wall it just climbed.
  const tx = pos.x + c.nx * (radius + 0.08);
  const tz = pos.z + c.nz * (radius + 0.08);
  beginTransit(c, rig, LIP_S, SURF_ROOF, tx, c.ceilY, tz);
}

/** On the ceiling: cross to a point over the player, then let go. */
function crawlRoof(c, dt, ctx, actor, st, spec, rig, dist, radius, rideH, clear) {
  const pos = rig.group.position;
  c.hold += dt;

  if (actor.dying || c.hold > ROOF_MAX_S) {
    detach(c, st, rig, radius, rideH);
    return;
  }

  if (dist < DROP_R) {
    // The tell. It stops dead over their head before it lets go, which is the
    // only warning a player standing under it is ever going to get.
    c.poise += dt;
    c.speed = 0;
    if (c.poise >= POISE_S) detach(c, st, rig, radius, rideH);
    return;
  }
  c.poise = 0;

  const dx = ctx.playerPos.x - pos.x;
  const dz = ctx.playerPos.z - pos.z;
  const l = Math.hypot(dx, dz) || 1;
  const step = spec.speed * ROOF_MUL * dt;
  const hx = dx / l, hz = dz / l;

  // Probed at the ceiling rather than resolved out of it. A body under a roof
  // has no push-out direction that means anything - the only free axis is down,
  // and taking it is letting go - so a blocked step slides along one axis and a
  // doubly blocked step just stops.
  const probeY = c.ceilY - CEIL_PROBE;
  const nx = pos.x + hx * step;
  const nz = pos.z + hz * step;

  if (clear(nx, nz, radius, probeY, ctx)) {
    pos.x = nx; pos.z = nz;
    c.speed = spec.speed * ROOF_MUL;
  } else if (clear(nx, pos.z, radius, probeY, ctx)) {
    pos.x = nx;
    c.speed = spec.speed * ROOF_MUL * 0.7;
  } else if (clear(pos.x, nz, radius, probeY, ctx)) {
    pos.z = nz;
    c.speed = spec.speed * ROOF_MUL * 0.7;
  } else {
    // Boxed in against a lintel it cannot cross. Nothing up here is worth
    // waiting on, so spend the give-up timer fast rather than sit still.
    c.hold += dt * 3;
    c.speed = 0;
  }

  pos.y = c.ceilY;
  st.feetY = pos.y;
}

/**
 * A crawler killed off the floor falls.
 *
 * updateDeath in mummy.js topples a body where it stands and never integrates
 * gravity, because until this file existed nothing could die anywhere but on
 * the ground. A gilded beetle shot off a ceiling has to come down or the kill
 * does not read as a kill, so the corpse keeps falling and keeps righting until
 * it lands, and then the ordinary lie-and-crumble takes over.
 */
export function crawlDeathFall(c, dt, ctx, st, rig) {
  if (!c.falling) return;
  const pos = rig.group.position;

  st.vy -= 24 * dt;
  st.feetY += st.vy * dt;

  const floor = ctx.heightAt ? ctx.heightAt(pos.x, pos.z, st.feetY) : 0;
  if (st.feetY <= floor) {
    st.feetY = floor;
    st.vy = 0;
    c.falling = false;
    c.owns = false;
    const yaw = rig.group.rotation.y;
    rig.group.rotation.set(0, yaw, 0);
  } else {
    surfaceAim(c, ctx, pos, _q);
    rig.group.quaternion.slerp(_q, Math.min(1, ORIENT_RATE * dt));
  }

  pos.y = st.feetY;
}
