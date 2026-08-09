/**
 * The interior builder: room records in, meshes and colliders out.
 *
 * This is the only module allowed to turn `rooms.js` into geometry. Keeping
 * the split honest is what lets the map be tested without a GPU, and what
 * stops layout decisions from being buried inside mesh construction.
 *
 * Geometry goes through the helpers in ./uv.js so texture density is constant
 * in world units. Building a BoxGeometry directly here is a bug: it gets one
 * texture tile stretched across whatever size it happens to be.
 *
 * Two collision representations leave here, and they are not redundant:
 * cylinders for props, because that is what every other system already
 * resolves against, and axis-aligned boxes for walls, because a room wall is
 * the one thing a cylinder cannot approximate without either leaking at the
 * corners or eating the doorway.
 */

import * as THREE from 'three';
import { buildMaterials, materialsForBase } from './materials.js';
import { buildTextures } from './textures.js';
import { weather } from './weathering.js';
import { box, plane, cylinderUV } from './uv.js';
import { ROOMS, ENTRY } from './rooms.js';
import { SERDAB_PROPS } from './serdab.js';

/** Tiles per world unit, per surface. Matches the courtyard exactly. */
const DENSITY = {
  limestone: 0.17,
  carved: 0.20,
  granite: 0.30,
  gold: 0.5,
  // Small debris needs a higher density than large walls. At 0.17 a 2-unit
  // chunk gets a third of a tile, which shows as one absurdly oversized block.
  rubble: 0.45,
};

/**
 * Walls are built INWARD from the room's bounds, so a room only ever owns the
 * stone inside its own footprint. Two adjacent rooms therefore build two
 * abutting slabs rather than fighting over one shared slab, and because both
 * cut their opening at the same world x/z, the two halves of a doorway line up
 * without any CSG.
 */
const WALL_T = 1.0;

/** Doorway clear height. Anything above this in a portal gap becomes a lintel. */
const DOOR_H = 4.2;

const RAMP_T = 0.7;

/**
 * How long a barrier takes to clear, in seconds.
 *
 * Long enough to be an event the player watches, short enough that they are
 * never standing still waiting for it. Everything about the animation is
 * multiplied by the clamped frame delta, so a stalled tab resumes mid-swing
 * rather than finishing the door while the player was not looking.
 */
const OPEN_SECONDS = 1.15;

/**
 * How high a foot may be lifted onto a walkable surface.
 *
 * This is what stops the gallery's upper ledge from also being the floor of the
 * alcove underneath it. Without the test, walking under the ledge snaps the
 * player six units into the air onto its top face.
 */
const STEP_UP = 0.65;

/**
 * A ROOM'S FLOOR ELEVATION, AND THE CEILING THAT FOLLOWS FROM IT.
 *
 * `base` is the absolute y of a room's floor. It defaults to 0, which is what
 * every room in this map was before the descent existed, so a record without one
 * builds exactly the geometry it built yesterday.
 *
 * `height` deliberately stays what it always was: the ceiling measured FROM THAT
 * FLOOR, not from the world origin. Keeping it relative is what lets a room be
 * moved down without every prop, light, ramp and doorway inside it having to be
 * re-derived by hand, and it is why docs/DESCENT.md can state a room's shape and
 * its depth as two independent numbers rather than as one fused one.
 *
 * Read through these two rather than touching `room.base` directly. A room
 * record authored before the descent has no `base` at all, and `undefined + 6`
 * is NaN, which is the kind of value that produces geometry nobody can see and
 * a floor sampler that answers every question with "no".
 */
function baseOf(room) { return room && room.base ? room.base : 0; }
function ceilingOf(room) { return baseOf(room) + room.height; }

/**
 * WHERE A DOORWAY'S THRESHOLD SITS, AND HOW MUCH CLEAR HEIGHT IT GETS.
 *
 * THE THRESHOLD IS THE HIGHER OF THE TWO FLOORS, ALWAYS, and it is DERIVED
 * rather than authored on purpose. A portal is a hole cut in a wall that both
 * rooms build, from opposite sides, and the two halves only line up if both
 * sides compute the same sill from the same numbers. An authored sill is a third
 * number that can disagree with the two it is supposed to sit between, and the
 * disagreement is invisible in the data and obvious only to a player walking
 * into a step they cannot climb.
 *
 * The LOWER room then owns the problem of getting from the sill down to its own
 * floor. STEP_UP is 0.65, so any drop bigger than that is a hole in the floor
 * until something walkable spans it: that is what the descent ramps in rooms.js
 * are for, and a room given a `base` below its neighbour's and no ramp is a room
 * the player falls into rather than walks into.
 *
 * Clear height runs from the sill up to the LOWER of the two ceilings, less the
 * 0.8 of lintel every doorway in this map carries. That subtraction is the
 * constraint that decides how deep a descent can go, and it binds on the room's
 * CEILING rather than on its size: a room whose ceiling sits below
 * sill + DOOR_H + 0.8 cannot hold a full-height door at that sill however large
 * its floor is. The Canopic Crypt is the room that constraint was measured
 * against; see docs/DESCENT.md.
 */
function portalOpening(p, rooms) {
  // ENTRY arrives with from === null: it is the courtyard's doorway and there is
  // no near room to take a floor or a ceiling from.
  const near = p.from ? rooms.find((r) => r.id === p.from) : null;
  const far = rooms.find((r) => r.id === p.to) || null;

  let sill = -Infinity;
  let ceil = Infinity;
  for (const r of [near, far]) {
    if (!r) continue;
    sill = Math.max(sill, baseOf(r));
    ceil = Math.min(ceil, ceilingOf(r));
  }
  if (!Number.isFinite(sill)) sill = 0;

  return { sill, clear: Math.min(DOOR_H, ceil - sill - 0.8) };
}

/**
 * Per-profile lighting. Point lights are the whole atmosphere budget here:
 * forward rendering pays for every light on every fragment, so the count per
 * room is capped and nothing in the interior casts shadows. Where a room has
 * brazier slots the lights are anchored on them, so the visible flame and the
 * light that flickers are the same object rather than two things that drift.
 */
const LIGHTING = {
  corridor: { color: 0xffb066, intensity: 7.5, distance: 26, y: 0.72, max: 2 },
  chamber: { color: 0xffa858, intensity: 8.0, distance: 24, y: 0.70, max: 2 },
  gallery: { color: 0xffc08a, intensity: 10.0, distance: 42, y: 0.55, max: 3 },
  shaft: { color: 0xbcd4ff, intensity: 13.0, distance: 48, y: 0.90, max: 2 },
  sanctum: { color: 0xffd58a, intensity: 9.0, distance: 32, y: 0.62, max: 2 },
};

/**
 * The chalk mark on a wall buy, per weapon, as bars in the plaque's plane.
 *
 * Each entry is [width, height, x, y] in plaque-local metres, y measured from
 * the plaque's centre. A weapon at this scale is a SILHOUETTE and nothing else:
 * the player reads it from ten or fifteen metres across a dark room, at which
 * point proportion and outline are the whole signal and detail is noise. What
 * separates these four is length, where the magazine sits, and whether there is
 * a stock - which is exactly what separates them in the hand.
 *
 * EVERY ONE OF THEM POINTS RIGHT: muzzle at +x, stock at -x, and going from the
 * muzzle backwards the order is barrel, handguard, magazine, grip, stock. The
 * first pass of this table put the grip in FRONT of the magazine and let the
 * stock bar overlap the receiver bar, and the result photographed as a capital
 * T. A silhouette with its parts in the wrong order is not a stylised weapon,
 * it is a shape, and the player reads it as decoration and walks past it.
 *
 * THIS TABLE IS ALSO THE MYSTERY BOX'S STOCK LIST. The Chest of the Nameless
 * floats one of these marks over itself while it rolls, so every id in
 * systems/mysterybox.js's POOL must have an entry here or the chest presents a
 * blank plate. The two lists are asserted equal by test/mysterybox.mjs rather
 * than by a runtime warning, because a warning in a frame loop is a warning
 * printed sixty times a second.
 */
const CHALK = {
  /**
   * B3AR: a pistol silhouette that has to lose to the SMG two rows down.
   *
   * THE FIRST DRAFT OF THIS PHOTOGRAPHED AS A CAPITAL 7, which is the exact
   * failure the note above this table warns about and it was arrived at the
   * same way: three bars laid end to end at one height with no gap between them
   * fuse into ONE bar, and a grip stacked directly on a magazine at the same
   * width fuses into one stroke. Two strokes at right angles is a numeral. The
   * parts have to be separated by GAPS and by STEPS in thickness, because the
   * mark is emissive gold on dark granite at four metres and every internal
   * edge that is not a change of silhouette is invisible.
   *
   * So: the top line is three pieces with two real gaps in it and it steps DOWN
   * to the barrel and back UP to the muzzle device, which is what a compensator
   * looks like from the side and what nothing else in this table has. The
   * vertical is three pieces that step in and back out. Nothing runs at a
   * constant width for longer than a quarter of the panel.
   *
   * The tells against the SMG, which the player meets in the same act: no stock
   * bar behind the grip, which every other mark here has; the magazine at the
   * REAR under the receiver rather than well forward, which is the SMG's whole
   * identity reversed; and the stick running BELOW the grip line, because the
   * extended magazine is the machine-pistol read.
   */
  b3ar: [
    [0.70, 0.15, 0.14, 0.20],    // slide, thick, and it stops half way
    [0.24, 0.08, 0.66, 0.20],    // barrel, STEPPED DOWN, with a gap behind it
    [0.17, 0.19, 0.96, 0.20],    // COMPENSATOR: taller than the slide, detached
    [0.09, 0.07, -0.10, 0.33],   // rear sight, breaking the top line at the back
    [0.20, 0.05, 0.16, 0.02],    // trigger guard, under the gap in the receiver
    [0.17, 0.24, -0.15, 0.00],   // grip, at the rear extreme: no stock behind it
    [0.11, 0.30, -0.15, -0.32],  // extended magazine, stepped IN and hanging low
    [0.21, 0.06, -0.15, -0.52],  // floorplate, stepped back out to close it off
  ],

  smg: [
    [1.05, 0.13, 0.10, 0.16],    // receiver
    [0.45, 0.07, 0.82, 0.16],    // barrel, thinner than the receiver
    [0.15, 0.44, 0.14, -0.14],   // magazine, WELL FORWARD: the SMG tell
    [0.14, 0.32, -0.20, -0.12],  // pistol grip, behind the magazine
    [0.36, 0.10, -0.64, 0.10],   // stubby folding stock
  ],
  shotgun: [
    [1.40, 0.11, 0.30, 0.22],    // barrel
    [1.10, 0.09, 0.35, 0.06],    // magazine TUBE under it: the shotgun tell
    [0.34, 0.15, 0.30, 0.06],    // pump forend, riding the tube
    [0.40, 0.20, -0.42, 0.14],   // receiver
    [0.13, 0.26, -0.58, -0.08],  // wrist
    [0.40, 0.16, -0.85, 0.04],   // stock, dropping to the comb
  ],
  carbine: [
    [0.50, 0.07, 0.86, 0.18],    // barrel past the gas block
    [0.62, 0.15, 0.36, 0.18],    // handguard
    [0.60, 0.19, -0.18, 0.18],   // upper receiver
    [0.30, 0.08, -0.16, 0.38],   // carry handle
    [0.18, 0.48, 0.02, -0.14],   // magazine
    [0.14, 0.32, -0.30, -0.13],  // grip
    [0.52, 0.15, -0.78, 0.15],   // buffer tube and stock
  ],
  lmg: [
    [1.00, 0.13, 0.62, 0.20],    // heavy barrel
    [0.72, 0.24, -0.22, 0.18],   // deep receiver
    [0.44, 0.46, -0.10, -0.22],  // BOX magazine: the only square one in the set
    [0.15, 0.30, -0.52, -0.12],  // grip
    [0.40, 0.18, -0.86, 0.16],   // stock
    [0.08, 0.34, 0.88, -0.06],   // bipod, splayed
    [0.08, 0.30, 0.72, -0.08],
  ],

  // The two the box exists for. Neither has a wall of its own anywhere in the
  // map, so these marks are only ever seen floating over an open chest.
  bolt: [
    [1.50, 0.08, 0.44, 0.16],    // the longest barrel in the set, and thin
    [0.46, 0.20, -0.30, 0.15],   // receiver, deep for the action
    [0.34, 0.09, -0.10, 0.34],   // SCOPE: the bolt-gun tell, and nothing else
    [0.07, 0.11, -0.24, 0.26],   //   has one. Two mounts under it so it reads
    [0.07, 0.11, 0.04, 0.26],    //   as fitted rather than as a floating bar.
    [0.17, 0.08, -0.46, 0.25],   // bolt handle, turned up out of the receiver
    [0.13, 0.26, -0.40, -0.08],  // wrist, dropping to the grip
    [0.56, 0.15, -0.80, 0.02],   // long stock, and it sits LOW: a rifle stock
  ],                             //   in line with the bore is a carbine

  sunspear: [
    [0.70, 0.36, 0.04, 0.16],    // the deepest body in the set: an emitter, not
    [0.42, 0.07, 0.62, 0.32],    //   a receiver, so it has no magazine at all
    [0.42, 0.07, 0.62, 0.16],    // three prongs, evenly split
    [0.42, 0.07, 0.62, 0.00],
    [0.07, 0.42, 0.86, 0.16],    // the bar across all three: a trident head
    [0.15, 0.30, -0.24, -0.12],  // grip, well back under the mass
    [0.42, 0.14, -0.54, 0.14],   // short stock
  ],
};

/**
 * The emblem on a shrine's back stela, per god.
 *
 * Same argument as the chalk, one step further: six shrines that differ only in
 * price are six identical objects to a player running past them, so each one
 * carries a mark that can be told from the others in silhouette. Bars and discs
 * only - a hieroglyph rendered at this budget is a smudge, and a smudge that
 * differs from another smudge is not a difference anybody can use.
 *
 * `bars` are [w, h, x, y] slabs; `discs` are [radius, x, y] rings.
 */
const EMBLEM = {
  // Sekhmet: the lioness under the solar disc. Disc plus two ears.
  sekhmet: { discs: [[0.30, 0, 0.42]], bars: [[0.13, 0.30, -0.20, 0.06], [0.13, 0.30, 0.20, 0.06], [0.62, 0.13, 0, -0.16]] },
  // Ptah: the djed pillar. A column with four crossbars, and nothing else in
  // Egyptian iconography looks remotely like it.
  ptah: { discs: [], bars: [[0.16, 1.00, 0, 0.06], [0.62, 0.09, 0, 0.34], [0.62, 0.09, 0, 0.16], [0.62, 0.09, 0, -0.02], [0.62, 0.09, 0, -0.20]] },
  // Set: the was sceptre, forked at the foot, squared at the head.
  set: { discs: [], bars: [[0.14, 1.02, 0, 0.10], [0.34, 0.14, -0.09, 0.56], [0.13, 0.34, -0.20, -0.44], [0.13, 0.34, 0.20, -0.44]] },
  // Shu: a feather, standing.
  shu: { discs: [[0.26, 0, 0.26]], bars: [[0.09, 1.02, 0, 0.02], [0.42, 0.10, 0, 0.14], [0.34, 0.09, 0, -0.06], [0.24, 0.08, 0, -0.24]] },
  // Anubis: the jackal head. Two tall pricked ears and a long muzzle, which is
  // the most recognisable outline in the whole pantheon.
  anubis: { discs: [], bars: [[0.12, 0.46, -0.17, 0.36], [0.12, 0.46, 0.17, 0.36], [0.52, 0.34, 0, 0.00], [0.46, 0.12, 0.22, -0.20]] },
  // Thoth: the ibis. A crescent moon and a long down-curved beak.
  thoth: { discs: [[0.34, 0, 0.30]], bars: [[0.24, 0.30, 0.10, 0.30], [0.13, 0.42, -0.02, -0.14], [0.34, 0.10, -0.20, -0.36]] },
};

/**
 * What colour each shrine burns.
 *
 * This is the identity that survives distance, motion, and a dark room, and it
 * is the reason the six shrines are told apart at all. The emblem above is the
 * confirmation once you are close enough to read it; this is the thing that
 * makes you walk over in the first place.
 *
 * The rules that go with these names - what they cost and what they do - live
 * in systems/shrines.js. Geometry does not get an opinion about price, the same
 * split doors.js and this file already keep.
 */
export const BOON_LOOK = {
  sekhmet: { colour: 0xff8a52, emissive: 0xff3c14 },   // lioness, war, blood heat
  ptah:    { colour: 0x8affc4, emissive: 0x1fd97a },   // craftsman, green as a workshop
  set:     { colour: 0xd0a0ff, emissive: 0x8a2ff0 },   // chaos, violet, wrong
  shu:     { colour: 0xc4f4ff, emissive: 0x36c8ff },   // air, thin and cold
  anubis:  { colour: 0xe8eeff, emissive: 0x9fb4ff },   // the dead, white-blue
  thoth:   { colour: 0xffdc92, emissive: 0xffa018 },   // moon and counting, amber
};

/** Deterministic PRNG so the interior is identical every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildInterior(scene, rooms = ROOMS) {
  const M = buildMaterials();
  const rand = rng(20260726);

  const group = new THREE.Group();
  group.name = 'interior';
  scene.add(group);

  /**
   * { x, z, r, h, y0 } cylinders. Same array shape the courtyard hands over,
   * plus an absolute base height.
   *
   * The courtyard omits y0 because its props stand on dunes, so their base IS
   * the local floor and the controller measures against that. In here the floor
   * is flat and the ROOM is not: the gallery's columns stand on the ground and
   * hold up a ledge six units above it, and without an absolute base the
   * controller measures their height from whatever surface the player is on and
   * turns them into invisible posts standing on the ledge they are carrying.
   */
  const colliders = [];
  /**
   * `base` is the absolute y the cylinder STARTS at, and it defaults to the
   * ground because almost everything in the map stands on it. A fixture on the
   * gallery bridge does not: at base 0 the Altar's 2.1-metre cylinder would run
   * from the walkway all the way down through the gallery floor and stand as an
   * invisible pillar in the middle of the room, two metres from the crypt gate.
   * Both the player controller and the mummies already read `c.y0` (they take
   * `c.y0 === undefined ? floorY : c.y0`), so honouring it here is wiring a
   * contract that was already written on the other side.
   *
   * IT DEFAULTS TO THE ROOM'S FLOOR RATHER THAN TO ZERO, which is why the
   * function is rebuilt once per room below instead of being hoisted out of the
   * loop. Zero stopped being "the ground" the moment a room could be authored
   * with a `base`: a pillar in a room six metres down would otherwise declare a
   * base of 0 and stand as a cylinder hanging in the air over its own room,
   * blocking nothing at floor level and blocking the ceiling instead. Every
   * caller passes four arguments, so the default is the whole of the fix.
   */
  const makeAddCollider = (floorY) =>
    (x, z, r, h, base = floorY) => colliders.push({ x, z, r, h, y0: base });

  /** { x, z, w, d, y0, y1 } axis-aligned boxes, for the player's bounds check. */
  const walls = [];

  /**
   * Walkable surfaces other than the room floors, for the controller to sample
   * later. A ledge is the degenerate ramp y0 === y1; a real ramp rises along its
   * longer horizontal axis, from y0 at the low-coordinate end to y1 at the high
   * one.
   *
   * THE y VALUES IN HERE ARE ABSOLUTE, and the ones authored in rooms.js are
   * relative to their room's `base`. buildLevels is where the two meet. Storing
   * absolutes is what lets heightAt take one flat maximum over the whole list
   * without asking which room each span belongs to; authoring relatives is what
   * lets the gallery keep saying its ledge is "six up" after the room it is in
   * has moved.
   */
  const ramps = [];

  /**
   * The floor plane of each room, flattened for heightAt.
   *
   * Derived once rather than looked up per call because heightAt is the hottest
   * function in the interior: the flow field alone asks it twice per neighbour
   * per relaxation, which was measured at roughly half a million calls on a
   * single interior rebuild. A nine-element array of plain numbers scanned with
   * an early exit is the cheapest honest answer; walking the room records and
   * reading `bounds.w / 2` inside that loop is not.
   */
  const floors = rooms.map((r) => ({
    x0: r.bounds.x - r.bounds.w / 2,
    x1: r.bounds.x + r.bounds.w / 2,
    z0: r.bounds.z - r.bounds.d / 2,
    z1: r.bounds.z + r.bounds.d / 2,
    y: baseOf(r),
  }));

  const interacts = [];
  const jars = [];
  const lights = [];
  const animated = [];

  const portals = collectPortals(rooms);
  let powered = false;

  /**
   * How lit the map is, 0 before the Kindling and 1 after, ramped rather than
   * switched.
   *
   * This is read by every room light in buildLights and by the fill below, and
   * it is the single reason throwing the switch is an EVENT rather than a flag
   * flipping. A cut from dark to lit reads as a bug in the renderer; a second
   * and a half of the whole pyramid coming up reads as the pyramid waking, and
   * it costs one number.
   */
  const power = { level: 0, target: 0 };
  const POWER_RAMP = 1.4;      // seconds, dark to lit
  const POWER_LIFT = 0.55;     // how much brighter a powered room is

  /** Things that want to know the moment the Kindling is thrown. */
  const poweredListeners = new Set();

  // Chalk: the gold a wall buy's silhouette is drawn in. Hoisted to module
  // scope so the courtyard's fixture is drawn in the same material rather than
  // in a second one that agrees with it today. See wallChalk().
  const chalk = wallChalk(M);

  // The painted soffit, built ONCE and shared by every room that takes it. See
  // ceilingMaterial() for why the ceiling stopped being the wall's material.
  const ceilMat = ceilingMaterial();

  /**
   * Fill.
   *
   * Point lights with quadratic falloff are the right model for a torch and the
   * wrong model for a room: at fifteen units a brazier contributes about half a
   * percent of what it does at one, so everything outside the pools is not dim,
   * it is zero, and a doorway you are meant to find and buy can sit in absolute
   * black. Every game solves this the same way and this one is no exception.
   *
   * A hemisphere rather than flat ambient, so it still has a direction: cool
   * from above, warm from the floor. Uniform ambient at a level high enough to
   * matter flattens every carved surface in the map at once.
   *
   * Both live INSIDE the interior group, which is what keeps them off the
   * courtyard: hiding the group hides its lights along with its geometry.
   */
  const fill = new THREE.HemisphereLight(0x5c73a8, 0x6b5028, 0.62);
  group.add(fill);

  const ambient = new THREE.AmbientLight(0xffdcae, 0.09);
  group.add(ambient);

  const fillBase = fill.intensity;
  const ambientBase = ambient.intensity;

  animated.push({
    update(dt) {
      if (power.level === power.target) return;
      const step = dt / POWER_RAMP;
      power.level = power.target > power.level
        ? Math.min(power.target, power.level + step)
        : Math.max(power.target, power.level - step);

      const k = 1 + POWER_LIFT * power.level;
      fill.intensity = fillBase * k;
      ambient.intensity = ambientBase * k;
    },
  });

  for (const room of rooms) {
    const base = baseOf(room);

    const ctx = {
      room,

      /**
       * THE REGISTRY AS SEEN FROM THIS ROOM'S FLOOR, not the shared one.
       *
       * The stone materials darken toward "the base of the wall", and until the
       * descent landed there was exactly one base in the game and it was zero.
       * A room at -6 read as six metres of wall BELOW the datum, which saturates
       * the grime term and multiplies the full dirt colour into every surface in
       * the room. Measured, that was a third of Act 3's albedo and 43 per cent of
       * the Serdab's; see docs/DESCENT.md section 6 and the argument above
       * weatherVariant in world/weathering.js for why this is a material instance
       * per elevation rather than a per-mesh attribute.
       *
       * Rooms at 0 get the identical shared objects back, so nothing about the
       * entry band, the gallery or the courtyard changed.
       */
      M: materialsForBase(base),

      rand, group, colliders, walls, ramps,
      interacts, jars, lights, animated,
      // The floor this room's contents stand on. Carried on the ctx rather than
      // read back off `room` at each use site, so that a builder which forgets
      // it is a builder that produces geometry at the world origin - visibly
      // wrong - rather than one that silently reads `room.base` as undefined.
      base,
      addCollider: makeAddCollider(base),
      chalk, power, POWER_LIFT, ceilMat,
      // Filled by the brazier prop, read by the lighting pass. Collected here
      // rather than written back onto the room record: rooms.js is data the
      // node harness reads, and a builder that scribbles on it stops being
      // safe to run twice.
      anchors: [],
    };

    buildShell(ctx, portals);
    buildLevels(ctx);
    buildProps(ctx);
    buildInteracts(ctx);
    buildLights(ctx);
  }

  // After the rooms, because a barrier stands in a hole two rooms cut in their
  // own walls and needs both of them to already exist to know which way it
  // faces.
  // No registry handed in: a barrier picks its own by threshold elevation, the
  // same way each room picks one by floor elevation. See the note at the call
  // to materialsForBase inside it.
  const barriers = buildBarriers({ rand, group, colliders, animated, rooms, portals });

  return {
    group,
    colliders,
    walls,
    ramps,
    rooms,
    portals,
    barriers,
    interacts,
    jars,

    /** Which room contains a point, or null if the point is in solid rock. */
    roomAt(x, z) {
      for (const r of rooms) {
        const { x: cx, z: cz, w, d } = r.bounds;
        if (x >= cx - w / 2 && x <= cx + w / 2 && z >= cz - d / 2 && z <= cz + d / 2) return r;
      }
      return null;
    },

    /**
     * Floor height at a world position, same contract as the courtyard's dune
     * sampler so the player controller can call one function either side of the
     * doorway and never know which space it is standing in.
     *
     * footY is where the player's feet currently are. A surface only counts as
     * floor if it is at or below the foot plus a step, which is what keeps the
     * gallery's upper ledge from being walkable from underneath. Passing no
     * footY asks "what is the highest surface here", which is what a spawn
     * placement wants.
     *
     * ---------------------------------------------------------------------
     * THE SEED IS THE ROOM'S OWN FLOOR, AND IT IS NOT SUBJECT TO `reach`
     * ---------------------------------------------------------------------
     *
     * This function used to open `let y = 0` and only ever rise, which made a
     * floor below the world origin unrepresentable and made every room in the
     * map share one plane. It now opens at the floor of whichever room contains
     * the point, which is the whole of the descent in one line.
     *
     * OUTSIDE the reach gate, deliberately, and the courtyard's own sampler
     * (`courtyard.js`, `groundY`) has the identical shape for the identical
     * reason. `reach` answers "could I step UP onto that", and it is the right
     * question for a ledge or a ramp overhead. The floor of the room you are
     * standing in is not a thing you step up onto: it is the thing you fall to.
     * Gating it would mean a player teleported in above the floor, a grenade
     * mid-arc, or an actor part way down a ramp would be told there is no floor
     * here at all, and the caller's fallback for that is 0 - which is exactly
     * the bug this change exists to remove, arriving from the other side.
     *
     * A point in solid rock belongs to no room and seeds at 0. That is not a
     * claim that there is a floor there; nothing walks in solid rock, and both
     * the wall boxes and the flood's clearance test refuse those cells before
     * this number is ever used. It is left at 0 because that is what the
     * function returned there yesterday, and a survey that changes an answer
     * nobody reads is a survey that has to be re-verified for nothing.
     */
    heightAt(x, z, footY) {
      let y = 0;
      for (const f of floors) {
        if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
        y = f.y;
        break;
      }

      const reach = footY === undefined ? Infinity : footY + STEP_UP;

      for (const r of ramps) {
        if (x < r.x - r.w / 2 || x > r.x + r.w / 2) continue;
        if (z < r.z - r.d / 2 || z > r.z + r.d / 2) continue;

        // Rise runs along the longer horizontal axis, y0 at the low-coordinate
        // end. A ledge is the degenerate case where both ends are equal, so it
        // needs no separate branch.
        const alongZ = r.d >= r.w;
        const t = alongZ
          ? (z - (r.z - r.d / 2)) / r.d
          : (x - (r.x - r.w / 2)) / r.w;

        const h = r.y0 + (r.y1 - r.y0) * t;
        if (h > y && h <= reach) y = h;
      }

      return y;
    },

    update(dt, t) {
      for (const a of animated) a.update(dt, t);
    },

    /**
     * The run has picked a tier. Settle the doorways that only exist on Hard.
     *
     * Called once, from start() in main.js, immediately after difficulty.lock()
     * - which is the first moment in the process that the tier is a fact. Every
     * `onHard` doorway was built as its Hard form at boot (see collectPortals),
     * so this is the whole of the tier's effect on the map: on Hard nothing
     * happens and the barriers stand, and on Easy and Normal they are deleted
     * before the player has taken a step.
     *
     * It reports the ids it cleared rather than returning nothing, for the same
     * reason systems/difficulty.js makes `set` report its refusal: a relaxation
     * that quietly did nothing - because the tier string was misspelt, because
     * the portals lost their `onHard` in a refactor, because this was called
     * before the barriers existed - is indistinguishable from a working one
     * until a player walks into a wall on Normal that is not supposed to be
     * there. The caller can assert on the list and the harness can read it.
     *
     * @param {string} tierId 'easy' | 'normal' | 'hard'
     * @returns {string[]} the barrier ids taken out of the world
     */
    applyTier(tierId) {
      if (tierId === 'hard') return [];

      const cleared = [];
      for (const b of barriers) {
        if (!b.hardOnly) continue;
        if (b.clearInstantly()) cleared.push(b.id);
      }
      return cleared;
    },

    setFidelity(high) {
      for (const l of lights) {
        l.light.distance = high ? l.distance : l.distance * 0.68;
        // The second light in a room is fill, not read. Dropping it is the
        // cheapest win left once shadows and post are already off.
        if (l.rank > 0) l.light.visible = high;
      }
      // Props keep their colliders either way. Hiding geometry that still
      // blocks movement is how an invisible wall gets shipped.
      group.traverse((o) => {
        if (o.isMesh && o.userData.prop) o.castShadow = high;
      });
    },

    /**
     * The Kindling. Lights the map's cold fixtures and opens the power gate.
     *
     * THE choke point. systems/doors.js throws the switch the player is looking
     * at and systems/power.js owns what that MEANS, and neither of them calls
     * the other: both go through here, so a Kindling thrown by the harness, by
     * a future puzzle reward, or by the player produce exactly the same event.
     * A second call changes nothing, which matters because the listeners below
     * light six shrines and none of them should fire twice.
     */
    setPowered(on) {
      const next = !!on;
      if (next === powered) return powered;

      powered = next;
      power.target = powered ? 1 : 0;

      for (const a of animated) if (a.setPowered) a.setPowered(powered);
      for (const fn of poweredListeners) fn(powered);
      return powered;
    },

    /** Register for the throw. Returns an unsubscribe, like every other hook. */
    onPowered(fn) {
      poweredListeners.add(fn);
      return () => poweredListeners.delete(fn);
    },

    get powered() { return powered; },
    /** 0..1, ramping. For anything that wants to cross-fade with the light. */
    get powerLevel() { return power.level; },
  };
}

// ---------------------------------------------------------------------------
// graph
// ---------------------------------------------------------------------------

/**
 * Flatten the authored portals and fold in the courtyard entrance. Portals are
 * written on one side only, so a room's own record is not enough to know where
 * its openings are: the wall builder has to see both directions or it seals a
 * doorway from the far side.
 *
 * ---------------------------------------------------------------------------
 * `onHard` IS RESOLVED HERE, AND IT IS RESOLVED PESSIMISTICALLY
 * ---------------------------------------------------------------------------
 *
 * A portal carrying `onHard` is a doorway that stands open on Easy and Normal
 * and is walled on Hard. The tier is not known at this point and CANNOT be: the
 * whole interior is built at boot, before the title screen has been looked at,
 * because half a megabyte of geometry built on first entry is a visible hitch
 * at the exact moment the player has paid a thousand gold to see the room. See
 * the note in systems/spaces.js, which is a decision rather than an accident.
 *
 * So the barrier is built as though the tier were Hard, always, and the tiers
 * that do not want it clear it in one frame at difficulty.lock(). Building the
 * OPTIMISTIC shape and adding a barrier later was the alternative and it is
 * strictly worse: an 'open' portal produces no meshes, no colliders and no door
 * record at all, so the Hard path would have had to construct a barrier into a
 * live scene, mid-session, on a code path nothing else in this file uses - and
 * a barrier that only ever exists on one tier is a barrier nothing ever looks
 * at. This way the geometry every tier ships is the geometry every tier tests,
 * and the tier-specific step is a deletion, which is the direction that cannot
 * silently fail to produce something.
 *
 * `hardOnly` is carried on the flattened record so buildBarriers can mark the
 * door it makes, and so the relaxation at lock() has something to select on
 * that is not a hardcoded pair of room ids.
 */
function collectPortals(rooms) {
  const out = [{ from: null, to: ENTRY.to, at: ENTRY.at, width: ENTRY.width, kind: ENTRY.kind, cost: ENTRY.cost }];

  for (const room of rooms) {
    for (const p of room.portals || []) {
      const hard = p.onHard || null;
      out.push({
        from: room.id,
        to: p.to,
        at: p.at,
        width: p.width,
        // The Hard reading of the doorway when there is one. Everything
        // downstream that asks a portal what it is - the barrier builder, the
        // minimap's price label, the objective tracker's route cost - then sees
        // one answer rather than two, and sees the same answer the colliders
        // were built from.
        kind: hard ? hard.kind : p.kind,
        cost: hard ? hard.cost : p.cost,
        hardOnly: !!hard,
      });
    }
  }

  /**
   * THE OPENING IS RESOLVED ONCE, HERE, FOR THE SAME REASON `onHard` IS.
   *
   * Three separate places used to work out how tall a doorway is - the shell
   * builder from its own room's height, the barrier builder from the minimum of
   * two rooms' heights, and nothing at all for where the threshold sits, because
   * every threshold was at zero. Once a portal can join two floors at different
   * elevations, "how tall" and "how high off the ground" are two answers that
   * MUST agree between the wall that has the hole in it and the door that stands
   * in the hole. Computing them twice is how a barrier ends up hovering a metre
   * above its own doorway on one tier and nobody notices for a week.
   */
  for (const p of out) Object.assign(p, portalOpening(p, rooms));

  return out;
}

// ---------------------------------------------------------------------------
// shell: floor, walls, ceiling
// ---------------------------------------------------------------------------

function slab(w, h, d, mat, density) {
  const m = new THREE.Mesh(box(w, h, d, density), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * THE PAINTED CEILING, AS ONE SHARED MATERIAL FOR THE WHOLE PYRAMID.
 *
 * WHY THE CEILING GETS ITS OWN MATERIAL AT ALL. It was `M.limestone`, the same
 * object as the walls, because for the life of this project the ceiling was a
 * lid: the player never looked at it, so it cost nothing to be the same stone
 * as everything else. enemies/wallcrawl.js ended that. A gold scarab now climbs
 * a wall, crosses the ceiling, and drops on the player from over their head,
 * which makes the ceiling the BACKGROUND OF A FIGHT - and a background's first
 * duty is that the thing in front of it can be told from it.
 *
 * WHAT MAKES THE NEW SURFACE THE RIGHT ONE IS MEASURED, NOT ASSERTED, and the
 * argument reverses the obvious one. A gold scarab is metalness 0.90 at
 * roughness 0.26, so in this interior it renders as a DARK body with a bright
 * rim - its own pixels come in at a median luminance of 4.3. The background it
 * needs is therefore a LIGHT one, and the ceiling is a pale limewashed plaster
 * for that reason before any other. The full measurement, including the dark
 * night-sky version that was tried first and lost 69 per cent of the body into
 * the ceiling, is in textures.js over `paintCeiling` and in test/wallart.mjs.
 *
 * ONE MATERIAL, NOT ONE PER ROOM, and the count is the point. Nine rooms share
 * this object, so the change is +1 material and +0 draw calls: the ceiling was
 * already its own mesh in every room (buildShell has always built a separate
 * plane for it), so nothing that was batched has been split and nothing that
 * was one draw is now two. The interior is not run through world/batch.js at
 * all - that pass is the courtyard's - so there is no merge for a second
 * material to break.
 *
 * WEATHERED FOR THE MOTTLE AND NOTHING ELSE, which is the `sand` recipe. The
 * grime term wicks up from the floor and dies long before it reaches a
 * seven-metre ceiling, and the bleach term is gated on an upward-facing normal
 * which a ceiling by definition does not have. What is left is the world-space
 * variation, and that is the only thing standing between the Great Gallery's
 * 52 x 38 m soffit and eight-by-six copies of one visible stamp.
 *
 * THE VARIATION IS 0.26 RATHER THAN THE LIMESTONE'S 0.44, and the reason is the
 * beetle again. The term is a MULTIPLY on albedo, so on a surface this pale it
 * has real absolute reach: at 0.44 it takes a 240 ground down to 134 in its
 * dark lobes, and a 134 blotch a couple of metres across is precisely the
 * beetle-sized hole `paintCeiling`'s rule 3 exists to keep off this surface.
 * 0.26 measured as enough to break the repeat at gallery size while leaving the
 * darkest excursion above 175.
 */
function ceilingMaterial() {
  const tex = buildTextures();

  const mat = new THREE.MeshStandardMaterial({
    ...tex.ceiling,
    // White. Unlike every stone material in the registry this map carries its
    // own colour rather than standing in for one, because it is paint: there is
    // no scanned set behind it waiting to replace the tint (upgradeMaterials
    // does not know this key), so a multiplier here would be a second, hidden
    // place the ceiling's value is decided.
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    normalScale: new THREE.Vector2(0.9, 0.9),
  });
  mat.name = 'ceiling';
  // applyFidelity walks the material registry, which this is deliberately not
  // in. Recording the authored scale means a future pass that does walk it
  // restores the right number rather than flattening to 1.
  mat.userData.authoredNormalScale = 0.9;

  weather(mat, {
    dirtHeight: 3.2,
    variation: 0.26,
    dirtStrength: 0.0,
    bleachStrength: 0.0,
  });

  return mat;
}

function buildShell(ctx, portals) {
  const { room, M, group, base } = ctx;
  const { x, z, w, d } = room.bounds;
  const h = room.height;

  // The two absolute planes this room lives between. `height` is measured from
  // the floor, so a room that descends keeps its proportions and takes its
  // ceiling with it.
  const floorY = base;
  const ceilY = base + h;

  const x0 = x - w / 2, x1 = x + w / 2;
  const z0 = z - d / 2, z1 = z + d / 2;

  const sanctum = room.lightingProfile === 'sanctum';
  const floorMat = sanctum ? M.granite : M.limestone;
  const floorDensity = sanctum ? DENSITY.granite : DENSITY.limestone;

  // Subdivided rather than a single quad: a 2-triangle plane at gallery size
  // shows its diagonal seam under any point light near the floor.
  const segs = Math.max(2, Math.round(Math.max(w, d) / 6));
  const floor = new THREE.Mesh(plane(w, d, segs, floorDensity), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x, floorY, z);
  floor.receiveShadow = true;
  group.add(floor);

  /**
   * THE CEILING, AND THE ONE ROOM THAT DOES NOT GET IT.
   *
   * `ctx.ceilMat` is the painted soffit built by ceilingMaterial() above. The
   * Serdab is excluded and the exclusion is not a taste call: its art is being
   * authored in another lane that is in flight, and a shared material dropped
   * across every room in the map would silently overwrite whatever that lane
   * decides its five-metre ceiling should be. It keeps the limestone it has
   * always had until that lane lands and can say what it wants.
   *
   * The mesh keeps its prior material on userData rather than that being
   * reconstructible from the room record. test/wallart.mjs swaps the two back
   * and forth in one page to measure the before and the after against an
   * IDENTICAL beetle, camera and light phase; a harness that rebuilt the old
   * material from scratch would be comparing against a reconstruction, which is
   * exactly the class of control this project has been burned by.
   */
  const priorCeilMat = M.limestone;
  const ceilMat = room.id === 'serdab' ? priorCeilMat : (ctx.ceilMat || priorCeilMat);

  const ceil = new THREE.Mesh(plane(w, d, 2, DENSITY.limestone), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(x, ceilY, z);
  ceil.receiveShadow = true;
  ceil.name = `ceiling-${room.id}`;
  ceil.userData.ceiling = room.id;
  ceil.userData.priorMaterial = priorCeilMat;
  group.add(ceil);

  // Openings on this room's own wall lines, from portals in either direction.
  const mine = portals.filter((p) => p.from === room.id || p.to === room.id);

  // The X walls stop short of the corners so the Z walls can own them outright.
  // Overlapping two solid slabs in a corner is harmless until something needs
  // to reason about the wall list, at which point the duplicate is a trap.
  const sides = [
    { axis: 'x', line: x0, inner: x0 + WALL_T / 2, lo: z0 + WALL_T, hi: z1 - WALL_T },
    { axis: 'x', line: x1, inner: x1 - WALL_T / 2, lo: z0 + WALL_T, hi: z1 - WALL_T },
    { axis: 'z', line: z0, inner: z0 + WALL_T / 2, lo: x0, hi: x1 },
    { axis: 'z', line: z1, inner: z1 - WALL_T / 2, lo: x0, hi: x1 },
  ];

  for (const side of sides) {
    // A portal belongs to this side when it sits on the wall line and inside
    // the span. The tolerance is half the wall thickness, which is the most a
    // hand-authored coordinate should ever be off by.
    const gaps = mine
      .filter((p) => Math.abs((side.axis === 'x' ? p.at.x : p.at.z) - side.line) < WALL_T * 0.55)
      .map((p) => {
        const c = side.axis === 'x' ? p.at.z : p.at.x;
        // sill and clear come off the flattened portal record, so both rooms
        // sharing this doorway cut the identical hole. See portalOpening.
        return { lo: c - p.width / 2, hi: c + p.width / 2, sill: p.sill, clear: p.clear };
      })
      .filter((g) => g.hi > side.lo && g.lo < side.hi)
      .sort((a, b) => a.lo - b.lo);

    let cursor = side.lo;

    for (const g of gaps) {
      if (g.lo - cursor > 0.05) emitWall(ctx, side, cursor, g.lo, floorY, ceilY);

      /**
       * THE STONE UNDER THE OPENING, which a flat map never needed.
       *
       * When this room's floor is below the threshold - which is what being the
       * lower half of a descent means - the hole cut for the doorway would
       * otherwise run from the room's own floor all the way up past the sill,
       * and the player standing in the lower room would be looking through a
       * four-metre-wide, six-metre-tall slot at the void outside the rooms. The
       * far room's wall does not cover it either, because that wall starts at
       * ITS floor, which is the sill.
       *
       * IT STOPS RAMP_T SHORT OF THE SILL RATHER THAN AT IT, and that is not a
       * cosmetic gap. The descent ramp runs through this doorway, and its top
       * surface is at the sill only exactly on the wall line: a metre into the
       * room it has already fallen by the gradient. Stone taken all the way to
       * the sill would therefore stand proud of the walkway the player is
       * standing on, and `resolveWalls` would refuse to let them out of the
       * door they just paid for. One ramp thickness is the whole of the
       * clearance, and it is the correct amount because the slab itself is what
       * closes the gap from above.
       */
      const breast = g.sill - RAMP_T;
      if (breast - floorY > 0.05) emitWall(ctx, side, g.lo, g.hi, floorY, breast);

      // The stone above the opening. Without it the doorway reads as a slot cut
      // to the ceiling, which is the single clearest tell of a generated map.
      const head = g.sill + g.clear;
      if (ceilY - head > 0.05) emitWall(ctx, side, g.lo, g.hi, head, ceilY);

      cursor = Math.max(cursor, g.hi);
    }

    if (side.hi - cursor > 0.05) emitWall(ctx, side, cursor, side.hi, floorY, ceilY);
  }
}

/**
 * THE STONE A ROOM'S WALLS ARE CUT FROM, AND WHY IT IS NO LONGER THE FLOOR'S.
 *
 * The owner asked for hieroglyphics on the interior walls. They could not
 * physically appear: world/textures.js has painted a register band and a scatter
 * of carved marks for some time, and world/materials.js throws that whole canvas
 * away at boot - `applyMaps(m.limestone, sets.limestone)` replaces every map on
 * the wall material with the bricks083 photograph, and `assetsFailed` is empty
 * in every normal run. The carving rendered on the asset-404 path and nowhere
 * else.
 *
 * `M.frieze` is the fix and it is the SAME SCAN the wall already wore, with the
 * inscription composited into its albedo and its normal. The full argument for
 * compositing rather than swapping, and the measurement that chose it over the
 * two obvious alternatives, is over `applyFrieze` in world/materials.js.
 *
 * THE SERDAB IS EXCLUDED, on the same terms and for the same reason its ceiling
 * is: its art is being authored in another lane that is in flight, and a
 * material dropped across every room in the map would silently overwrite
 * whatever that lane decides its walls should be.
 *
 * WHAT IT COSTS IS +1 MATERIAL AND +0 DRAW CALLS. The interior is not run
 * through world/batch.js - that pass is the courtyard's - so every span emitWall
 * produces was already its own mesh with its own world-scaled UVs and its own
 * draw call. Nothing that was batched has been split. Measured at a fixed pose,
 * before and after, in test/frieze.mjs.
 *
 * Each wall mesh carries its prior material on userData rather than that being
 * reconstructible, exactly as the ceiling does: test/frieze.mjs swaps the whole
 * map's walls between the two IN ONE FRAME, so the beetle, the pose, the camera
 * and the light phase are identical across the comparison and the material is
 * the only variable. A harness that rebuilt the old material from scratch would
 * be comparing against a reconstruction.
 */
function wallMaterial(ctx) {
  const { M, room } = ctx;
  if (room.id === 'serdab') return M.limestone;
  return M.frieze || M.limestone;
}

function emitWall(ctx, side, lo, hi, y0, y1) {
  const { M, group, walls, room } = ctx;
  const len = hi - lo;
  const mid = (lo + hi) / 2;
  const h = y1 - y0;

  const mat = wallMaterial(ctx);

  const mesh = side.axis === 'x'
    ? slab(WALL_T, h, len, mat, DENSITY.limestone)
    : slab(len, h, WALL_T, mat, DENSITY.limestone);

  const wx = side.axis === 'x' ? side.inner : mid;
  const wz = side.axis === 'x' ? mid : side.inner;
  mesh.position.set(wx, y0 + h / 2, wz);
  mesh.name = `wall-${room.id}`;
  mesh.userData.wall = room.id;
  mesh.userData.priorMaterial = M.limestone;
  group.add(mesh);

  walls.push({
    x: wx,
    z: wz,
    w: side.axis === 'x' ? WALL_T : len,
    d: side.axis === 'x' ? len : WALL_T,
    y0,
    y1,
  });
}

// ---------------------------------------------------------------------------
// upper levels
// ---------------------------------------------------------------------------

/**
 * The gallery's two levels. Ledges and ramps are the same record shape on
 * purpose: the controller samples one list and does not care which is which.
 */
function buildLevels(ctx) {
  const { room, M, group, ramps, base } = ctx;
  if (!room.ramps) return;

  for (const src of room.ramps) {
    // Authored relative to the room's own floor, built and sampled absolute.
    // The gallery's ledge is "six up" whether the gallery is at 0 or at -6, and
    // a descent ramp is authored as the drop it is rather than as the pair of
    // world coordinates it happens to land on this week.
    const r = { ...src, y0: base + src.y0, y1: base + src.y1 };

    const alongZ = r.d >= r.w;
    const run = alongZ ? r.d : r.w;
    const rise = r.y1 - r.y0;
    const len = Math.hypot(run, rise);

    const mesh = alongZ
      ? slab(r.w, RAMP_T, len, M.limestone, DENSITY.limestone)
      : slab(len, RAMP_T, r.d, M.limestone, DENSITY.limestone);

    // Rotate so the high-coordinate end sits at y1. Rotating about +X carries
    // +Z toward -Y, hence the sign flip on the Z-running case.
    if (alongZ) mesh.rotation.x = -Math.atan2(rise, run);
    else mesh.rotation.z = Math.atan2(rise, run);

    mesh.position.set(r.x, (r.y0 + r.y1) / 2 - RAMP_T / 2, r.z);
    group.add(mesh);

    ramps.push({ x: r.x, z: r.z, w: r.w, d: r.d, y0: r.y0, y1: r.y1, room: room.id });

    if (rise !== 0) fillUndercroft(ctx, r, alongZ, run, rise);

    // A kerb along the open edge of a flat ledge. It is the only thing that
    // stops the upper level reading as a floating slab from below.
    //
    // WHICH EDGE IS OPEN DEPENDS ON WHICH WAY THE LEDGE RUNS, and this used to
    // assume every ledge ran along Z because every ledge did. The gallery's two
    // side shelves run along Z and open toward the centreline in X; the bridge
    // that now joins them runs along X and opens toward the centreline in Z, and
    // under the old rule it got a half-metre stub of kerb dropped at one end
    // instead of a parapet along its length. A ledge is a rectangle either way,
    // so the rule is the same rule with the axes swapped rather than a case.
    if (rise === 0) {
      if (r.d >= r.w) {
        const inner = r.x < room.bounds.x ? r.x + r.w / 2 : r.x - r.w / 2;
        const kerb = slab(0.5, 0.55, r.d, M.carved, DENSITY.carved);
        kerb.position.set(inner, r.y0 + 0.27, r.z);
        group.add(kerb);
      } else {
        const inner = r.z < room.bounds.z ? r.z + r.d / 2 : r.z - r.d / 2;
        const kerb = slab(r.w, 0.55, 0.5, M.carved, DENSITY.carved);
        kerb.position.set(r.x, r.y0 + 0.27, inner);
        group.add(kerb);
      }
    }
  }
}

/**
 * THE STONE UNDER THE SHALLOW END OF A RAMP.
 *
 * A ramp rising off a floor makes a wedge, and near its foot that wedge is a
 * crawlspace: at the very bottom the gap between the room floor and the
 * underside of the slab is centimetres. This fills the part of it a body cannot
 * fit in, which is what a stone ramp in a stone building has under it anyway.
 *
 * IT IS BUILT BECAUSE THE HORDE WAS GETTING STUCK IN IT, and the diagnosis is
 * worth writing down because the wrong layer was blamed twice on the way.
 *
 * A shambler crossing the Embalming Chamber toward the west descent walked UNDER
 * the ramp rather than round to its foot, wedged itself where the gap runs out,
 * and stayed there for the rest of the run: measured, it closed 7.2 m of a
 * 50.8 m approach and then held position for fifty seconds. Per-frame, the flow
 * field was handing it exactly (0.59, -0.81) and exactly (-0.57, +0.82) on
 * alternate frames - two anti-parallel headings, a limit cycle, in a field whose
 * route to the ramp foot was correct and finite the whole time. Its own wedge
 * detector never tripped, because it was moving three centimetres a frame.
 *
 * Three systems disagreed about that wedge, and only one of them was right.
 * `player/controller.js`'s headroomAt has always treated the highest surface at
 * a point as a ceiling, so the PLAYER has never been able to walk in there.
 * `enemies/flow.js` and `enemies/mummy.js` both tested headroom against walls
 * and colliders only, and a ramp is neither. Rather than teach the horde a
 * fourth version of the rule, the geometry now says what the building always
 * meant: there is stone under the ramp.
 *
 * WHERE IT STOPS is the same threshold the flood uses for a body, so geometry
 * and navigation agree by construction rather than by two tolerances that have
 * to be kept in step. Above that height the undercroft is left open, because a
 * space a body fits in is floor - which is exactly what the Great Gallery's
 * upper level is built on, six metres of clear headroom over its own floor, and
 * rooms.js calls that the thing that makes it a storey rather than a mezzanine.
 *
 * Stepped rather than a wedge, because `walls` is a list of axis-aligned boxes
 * and that is the shape the player's resolver, the flow field's clearance test
 * and the mummies' push-out all already read. Each step's top is the slab's
 * underside at the LOW end of that step, so no step ever stands proud of the
 * ramp it is holding up.
 */

/**
 * How much clear air counts as somewhere a body can be, under a slab.
 *
 * The same 2.0 as `enemies/flow.js` BODY_H, repeated rather than imported for
 * the same reason `player/controller.js` repeats STEP_UP: this module is the
 * geometry and it must not start importing the horde. If one of the two moves
 * the other has to move with it, and this comment is the note that says so.
 */
const UNDERCROFT_MIN = 2.0;

/** How long each step of the fill is. Shorter is a closer fit and more boxes. */
const UNDERCROFT_STEP = 1.0;

/**
 * HOW FAR UPHILL A BODY STANDING ON THE RAMP CAN REACH INTO THIS FILL.
 *
 * The widest body in the game, which is a god at radius 1.805, plus a little.
 * Repeated here rather than imported for exactly the reason UNDERCROFT_MIN is
 * repeated: this module is the geometry and it must not start importing the
 * horde. If the widest body grows, this grows with it, and this comment is the
 * note that says so.
 *
 * WHAT IT IS FOR, and it is not the wedge. Each step's top used to be one
 * RAMP_T below the walking surface at its own shallow end, which is exactly the
 * slab's underside and reads as obviously correct. It is correct for a POINT
 * and wrong for a DISC. `clear()` skips a wall only when `floorY >= w.y1`, so a
 * body standing further down the slope - whose feet are lower - finds that step
 * live, and if the step is inside its radius it is judged to be standing in
 * stone. Blocking therefore begins the moment
 *
 *     gradient > RAMP_T / body radius
 *
 * which for a god is 0.7 / 1.805 = 0.388, and EVERY descent on this map is
 * steeper than that. Measured on the west Act 3 ramp: at z -207.6 a god's floor
 * is -4.044 and the step 2.1 m uphill tops out at -4.030. Fourteen millimetres,
 * across the full 8 m width of the ramp, one field cell deep - which severed
 * every Act 3 room from the rest of the map for anything god-sized. A shambler
 * at 0.55 never reaches far enough uphill to notice.
 *
 * So the clearance is taken from how far a body can REACH rather than from how
 * thick the slab is, and the two are only the same on a shallow ramp. The cost
 * is a slot between the fill and the slab of (reach x gradient) - RAMP_T, which
 * on these ramps is 14 cm: far too little for anything to path into, and it is
 * under a ramp where the headroom rule already refuses bodies anyway.
 */
const UNDERCROFT_REACH = 1.9;

function fillUndercroft(ctx, r, alongZ, run, rise) {
  const { M, group, walls, base } = ctx;

  // The floor the wedge sits on, and the end of the ramp that is nearest it.
  // `y0` is the height at the LOW-COORDINATE end, so a ramp with a negative rise
  // has its shallow end at the high-coordinate end and fills from there.
  const floorY = Math.min(r.y0, r.y1);
  if (floorY > base + 0.05) return;      // this ramp does not start on the floor

  const grad = Math.abs(rise) / run;
  const fromLow = rise > 0;              // is the shallow end at the low end
  const lo = alongZ ? r.z - r.d / 2 : r.x - r.w / 2;
  const hi = alongZ ? r.z + r.d / 2 : r.x + r.w / 2;

  for (let d = 0; d < run; d += UNDERCROFT_STEP) {
    // Held below the walking surface by whichever is deeper: one ramp thickness,
    // which is the slab itself and the same figure the stone under a descent
    // doorway uses in buildShell, or the drop a body's own reach covers on this
    // gradient. See UNDERCROFT_REACH - the second term is what stops a wide body
    // standing downhill from being judged to be inside a step uphill of it.
    // Stop once a body fits under the slab.
    const topY = floorY + d * grad - Math.max(RAMP_T, UNDERCROFT_REACH * grad);
    if (topY - floorY >= UNDERCROFT_MIN) break;

    const seg = Math.min(UNDERCROFT_STEP, run - d);
    const h = topY - floorY;
    // Nothing to fill where the slab is at or under the floor plane. That is
    // the very bottom of the wedge, and it needs nothing: the walking surface
    // there is inside CLIMB of the floor, so a body arriving is lifted onto the
    // ramp by the floor sampler rather than left under it.
    if (h <= 0.02) continue;

    const a = fromLow ? lo + d : hi - d - seg;
    const mid = a + seg / 2;

    const w = alongZ ? r.w : seg;
    const dd = alongZ ? seg : r.d;
    const x = alongZ ? r.x : mid;
    const z = alongZ ? mid : r.z;

    const mesh = slab(w, h, dd, M.limestone, DENSITY.limestone);
    mesh.position.set(x, floorY + h / 2, z);
    group.add(mesh);

    walls.push({ x, z, w, d: dd, y0: floorY, y1: topY });
  }
}

// ---------------------------------------------------------------------------
// props
// ---------------------------------------------------------------------------

function buildProps(ctx) {
  const { room, group, colliders, base } = ctx;

  for (const slot of room.propSlots || []) {
    const before = colliders.length;

    const g = PROPS[slot.type] && PROPS[slot.type](ctx, slot);
    if (!g) continue;

    // A slot's y is measured from its room's floor, not from the world origin,
    // so the room's own elevation is added here and NOT folded into slot.y. The
    // test below turns on `slot.y` being truthy, and folding a room base into it
    // would make every ground-level prop in a descended room look elevated and
    // silently lose its collider.
    g.position.set(slot.x, base + (slot.y || 0), slot.z);
    g.rotation.y = slot.rot || 0;
    g.traverse((o) => { if (o.isMesh) o.userData.prop = slot.type; });
    group.add(g);

    // A collider is a cylinder with no floor, so anything standing on an upper
    // level would block the room underneath it too. Until the collider record
    // grows a base height, elevated props are decoration only.
    if (slot.y) colliders.length = before;
  }
}

const PROPS = {
  /**
   * Square carved pillar. Floor to ceiling by default; a slot can shorten it,
   * which is how the star shaft gets truncated columns that leave the void
   * above them as the room's actual subject.
   */
  pillar(ctx, slot) {
    const { M, room, addCollider } = ctx;
    const g = new THREE.Group();
    const h = (slot.config && slot.config.height) || room.height;

    const shaft = slab(1.7, h, 1.7, M.carved, DENSITY.carved);
    shaft.position.y = h / 2;
    g.add(shaft);

    const base = slab(2.3, 0.5, 2.3, M.limestone, DENSITY.limestone);
    base.position.y = 0.25;
    g.add(base);

    const cap = slab(2.3, 0.6, 2.3, M.limestone, DENSITY.limestone);
    cap.position.y = h - 0.3;
    g.add(cap);

    addCollider(slot.x, slot.z, 1.15, h);
    return g;
  },

  /** Round column with a papyrus-bud capital, scaled to the room it stands in. */
  colonnade(ctx, slot) {
    const { M, room, addCollider } = ctx;
    const g = new THREE.Group();
    // The gallery's columns carry its upper ledge, so their slots name a height
    // that puts the abacus exactly under the slab instead of through it.
    const h = (slot.config && slot.config.height) || room.height;
    const shaftH = h - 2.4;

    const shaft = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(1.05, 1.25, shaftH, 20), 1.25, shaftH, DENSITY.carved),
      M.carved
    );
    shaft.position.y = shaftH / 2 + 0.3;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    g.add(shaft);

    const bell = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(1.7, 1.0, 1.6, 20), 1.7, 1.6, DENSITY.carved),
      M.carved
    );
    bell.position.y = shaftH + 1.1;
    bell.castShadow = true;
    g.add(bell);

    const abacus = slab(3.2, 0.7, 3.2, M.limestone, DENSITY.limestone);
    abacus.position.y = shaftH + 2.05;
    g.add(abacus);

    const base = slab(3.0, 0.6, 3.0, M.limestone, DENSITY.limestone);
    base.position.y = 0.3;
    g.add(base);

    addCollider(slot.x, slot.z, 1.35, h);
    return g;
  },

  sarcophagus(ctx, slot) {
    const { M, addCollider } = ctx;
    const g = new THREE.Group();

    const plinth = slab(2.4, 0.35, 4.0, M.limestone, DENSITY.limestone);
    plinth.position.y = 0.17;
    g.add(plinth);

    const chest = slab(1.9, 1.0, 3.4, M.granite, DENSITY.granite);
    chest.position.y = 0.85;
    g.add(chest);

    // A slightly narrower lid with a gold mask band. The offset course is what
    // makes it read as a lid rather than a solid block.
    const lid = slab(2.05, 0.4, 3.55, M.granite, DENSITY.granite);
    lid.position.y = 1.55;
    g.add(lid);

    const mask = slab(1.1, 0.12, 1.3, M.gold, DENSITY.gold);
    mask.position.set(0, 1.78, -1.0);
    g.add(mask);

    addCollider(slot.x, slot.z, 1.5, 1.8);
    return g;
  },

  urn(ctx, slot) {
    const { M, addCollider } = ctx;
    const g = new THREE.Group();

    const body = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(0.46, 0.30, 1.05, 12), 0.46, 1.05, DENSITY.carved),
      M.carved
    );
    body.position.y = 0.53;
    body.castShadow = true;
    g.add(body);

    const neck = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(0.22, 0.42, 0.34, 12), 0.42, 0.34, DENSITY.carved),
      M.carved
    );
    neck.position.y = 1.2;
    g.add(neck);

    addCollider(slot.x, slot.z, 0.5, 1.35);
    return g;
  },

  /** A collapsed pile. Several chunks, because one box is a crate. */
  rubble(ctx, slot) {
    const { M, rand, addCollider } = ctx;
    const g = new THREE.Group();

    const n = 3 + Math.floor(rand() * 3);
    let maxR = 0;

    for (let i = 0; i < n; i++) {
      const w = 0.9 + rand() * 1.5;
      const h = 0.7 + rand() * 1.3;
      const d = 0.9 + rand() * 1.5;

      const chunk = slab(w, h, d, M.limestone, DENSITY.rubble);
      const ox = (rand() - 0.5) * 2.4;
      const oz = (rand() - 0.5) * 2.4;
      chunk.position.set(ox, h * 0.5, oz);
      chunk.rotation.y = rand() * Math.PI;
      chunk.rotation.z = (rand() - 0.5) * 0.2;
      g.add(chunk);

      maxR = Math.max(maxR, Math.hypot(ox, oz) + Math.max(w, d) * 0.5);
    }

    addCollider(slot.x, slot.z, maxR * 0.8, 1.4);
    return g;
  },

  brazier(ctx, slot) {
    const { M, addCollider, animated, anchors } = ctx;
    const g = new THREE.Group();

    const stem = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(0.16, 0.34, 1.7, 12), 0.34, 1.7, DENSITY.granite),
      M.granite
    );
    stem.position.y = 0.85;
    stem.castShadow = true;
    g.add(stem);

    const bowl = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(0.74, 0.34, 0.6, 16), 0.74, 0.6, DENSITY.gold),
      M.gold
    );
    bowl.position.y = 1.95;
    bowl.castShadow = true;
    g.add(bowl);

    // Own material instance: emissiveIntensity is animated per brazier, and
    // sharing the registry's would make every fire in the map flicker in step.
    const coals = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), M.ember.clone());
    coals.position.y = 2.12;
    coals.scale.y = 0.45;
    g.add(coals);

    const phase = (slot.x * 13.7 + slot.z * 7.3) % 6.283;
    animated.push({
      update(dt, t) {
        const f = Math.sin(t * 11 + phase) * 0.5 + Math.sin(t * 6.7 + phase * 2) * 0.5;
        coals.material.emissiveIntensity = 3.2 + f * 0.9;
      },
    });

    // Recorded so the room's lights can be hung on the flame rather than in
    // mid-air. See buildLights.
    // Absolute, because buildLights hangs a THREE.PointLight on it and lights
    // are placed in world space. slot.y is room-relative like every other
    // authored y, so the room's floor has to be added back.
    anchors.push({ x: slot.x, y: ctx.base + (slot.y || 0) + 2.35, z: slot.z, phase });

    addCollider(slot.x, slot.z, 0.8, 2.2);
    return g;
  },

  /** Blocky standing figure. Authored facing -Z, like every other rot 0 slot. */
  statue(ctx, slot) {
    const { M, addCollider } = ctx;
    const g = new THREE.Group();

    const plinth = slab(2.0, 0.6, 1.6, M.limestone, DENSITY.limestone);
    plinth.position.y = 0.3;
    g.add(plinth);

    const legs = slab(1.2, 1.7, 0.9, M.granite, DENSITY.granite);
    legs.position.y = 1.45;
    g.add(legs);

    const torso = slab(1.5, 1.5, 1.0, M.granite, DENSITY.granite);
    torso.position.y = 3.05;
    g.add(torso);

    // The nemes headdress does more for the silhouette than the head does.
    const head = slab(0.66, 0.72, 0.7, M.granite, DENSITY.granite);
    head.position.y = 4.14;
    g.add(head);

    const nemes = slab(1.35, 0.85, 1.0, M.gold, DENSITY.gold);
    nemes.position.set(0, 4.2, 0.06);
    g.add(nemes);

    const crook = slab(0.16, 1.5, 0.16, M.gold, DENSITY.gold);
    crook.position.set(0.55, 3.2, -0.5);
    g.add(crook);

    addCollider(slot.x, slot.z, 1.0, 4.6);
    return g;
  },

  'offering-table': (ctx, slot) => {
    const { M, addCollider } = ctx;
    const g = new THREE.Group();

    const top = slab(2.6, 0.22, 1.5, M.limestone, DENSITY.limestone);
    top.position.y = 0.95;
    g.add(top);

    for (const sx of [-1, 1]) {
      const leg = slab(0.28, 0.9, 1.3, M.limestone, DENSITY.limestone);
      leg.position.set(sx * 1.06, 0.45, 0);
      g.add(leg);
    }

    const bowl = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(0.34, 0.24, 0.24, 12), 0.34, 0.24, DENSITY.gold),
      M.gold
    );
    bowl.position.y = 1.18;
    g.add(bowl);

    addCollider(slot.x, slot.z, 1.2, 1.1);
    return g;
  },

  /** Upright inscribed slab. Cheap, and it gives a blank wall a focal point. */
  stela(ctx, slot) {
    const { M, addCollider } = ctx;
    const g = new THREE.Group();

    const body = slab(1.8, 3.0, 0.34, M.carved, DENSITY.carved);
    body.position.y = 1.6;
    g.add(body);

    // Rounded top, which is what distinguishes a stela from a door. A full disc
    // sunk to the slab's top edge, rather than a half-cylinder: the partial
    // sweep would have to be rotated on two axes to land face-up, and the lower
    // half is buried in the body either way.
    const crown = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(0.9, 0.9, 0.34, 18), 0.9, 0.34, DENSITY.carved),
      M.carved
    );
    crown.rotation.x = Math.PI / 2;
    crown.position.y = 3.1;
    g.add(crown);

    const base = slab(2.2, 0.35, 0.8, M.limestone, DENSITY.limestone);
    base.position.y = 0.17;
    g.add(base);

    addCollider(slot.x, slot.z, 0.75, 3.3);
    return g;
  },

  /**
   * A canopic jar on its plinth. The jar is a prop rather than an interact slot
   * because the puzzle system claims it: the four niches in the embalming
   * chamber are the sockets, and these are what goes in them.
   */
  'canopic-jar': (ctx, slot) => {
    const { M, addCollider, jars } = ctx;
    const g = new THREE.Group();

    const plinth = slab(1.1, 0.9, 1.1, M.limestone, DENSITY.limestone);
    plinth.position.y = 0.45;
    g.add(plinth);

    /**
     * THE VESSEL IS ITS OWN GROUP, AND THE PLINTH IS NOT IN IT.
     *
     * systems/jars.js lifts a jar out of the world and puts it back down in a
     * niche eight rooms away, so exactly one question decides this shape: what
     * moves. The answer is the jar and its stopper, and NOT the block of
     * limestone they are standing on - which is the thing this fixture's
     * collider describes.
     *
     * Hiding the whole group instead was the obvious version and it is wrong in
     * a way the player would find within a second: the collider stays behind,
     * because collision in this codebase is the authored array and never the
     * mesh graph, so a taken jar would leave a knee-high invisible obstacle in
     * the middle of a chapel. Lifting only the vessel leaves an EMPTY PLINTH,
     * which is both the honest read of what happened and the exact object the
     * collider was always standing in for.
     *
     * Reparented rather than copied when it goes home. One jar exists, it is in
     * one place at a time, and a second mesh built in the niche would be a
     * second thing to keep in step with the first.
     */
    const vessel = new THREE.Group();
    vessel.name = 'vessel';

    const jar = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(0.30, 0.22, 0.72, 14), 0.30, 0.72, DENSITY.carved),
      M.carved
    );
    jar.position.y = 1.26;
    jar.castShadow = true;
    vessel.add(jar);

    // The stopper is the head of one of the four sons of Horus. At this scale
    // the shape is a silhouette, so the gold is doing the identifying.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), M.gold);
    head.position.y = 1.76;
    head.scale.set(1, 1.15, 0.9);
    vessel.add(head);

    g.add(vessel);

    jars.push({ ...slot, room: ctx.room.id, group: g, vessel });
    addCollider(slot.x, slot.z, 0.62, 1.9);
    return g;
  },

  /**
   * THE SERDAB'S FOUR, AND THEY LIVE IN THEIR OWN FILE.
   *
   * The ten rock-cut figures, the empty eleventh niche, the archaeologist and
   * her lamp are the whole art budget of the room World 1 ends in, and they are
   * built in world/serdab.js the way world/canal.js and world/quarry.js build
   * their spaces: one file that owns one place, with the argument for its
   * composition in it rather than spread across a registry shared by nine
   * rooms.
   *
   * SPREAD RATHER THAN Object.assign'd AFTER, so the registry is still one
   * object literal that can be read top to bottom, and so a name collision
   * between a room module and this table is a visible overwrite at the point of
   * the spread instead of a silent one at boot. Nothing else about this file
   * changes: the four entries have the same (ctx, slot) => Group contract every
   * prop above has, and buildProps positions, rotates and tags them identically.
   */
  ...SERDAB_PROPS,
};

// ---------------------------------------------------------------------------
// interact slots
// ---------------------------------------------------------------------------

function buildInteracts(ctx) {
  const { room, group, interacts, colliders, base } = ctx;

  for (const slot of room.interactSlots || []) {
    ctx.lastVisuals = null;
    const before = colliders.length;

    const g = INTERACTS[slot.type] && INTERACTS[slot.type](ctx, slot);
    if (!g) continue;

    g.position.x = slot.x;
    // A fixture may stand on an upper level. Unlike propSlots, whose elevated
    // entries are decoration and drop their colliders, an interact HAS to keep
    // its collider - it is a solid object the player walks up to - so it is
    // re-based onto the surface it stands on instead. See addCollider.
    g.position.y = base + (slot.y || 0);
    g.position.z = slot.z;
    g.rotation.y = slot.rot || 0;

    // Same room-relative rule as the props, and the same reason for not folding
    // the base into slot.y: the truthiness test is what selects the elevated
    // fixtures, and every fixture in a descended room would pass it.
    if (slot.y) for (let i = before; i < colliders.length; i++) colliders[i].y0 = base + slot.y;

    const record = { ...slot, room: room.id, group: g, visuals: ctx.lastVisuals };
    // Tagged on every mesh, not just the group, so a raycast hit resolves to
    // the slot without walking back up the parent chain.
    g.traverse((o) => { if (o.isMesh) o.userData.interact = record; });

    group.add(g);
    interacts.push(record);
  }
}

const INTERACTS = {
  /**
   * Wall buy: a carved plaque with the weapon chalked on it in gold.
   *
   * No collider. The plaque stands 0.4 proud of the wall it is mounted on and a
   * cylinder around it would be a knee-high invisible obstacle in front of the
   * one fixture the player is trying to walk up to.
   *
   * The chalk is drawn from the CHALK table by weapon id, so the four wall buys
   * are four different outlines rather than four copies of the same two bars.
   * The plaque's own centre is at y = 2.3, which puts the mark at eye height
   * for a 1.68 eye and keeps the whole fixture off the floor where the rubble
   * and the urns live.
   */
  wallbuy(ctx, slot) {
    const g = new THREE.Group();
    const { M, chalk } = ctx;
    const cfg = slot.config || {};

    const CY = 2.3;

    const plaque = slab(2.6, 1.9, 0.22, M.carved, DENSITY.carved);
    plaque.position.set(0, CY, 0.11);
    g.add(plaque);

    // A recessed dark ground, so the gold has something to be gold AGAINST.
    // Chalk on limestone at the same value is a texture, not a picture.
    const ground = slab(2.28, 1.56, 0.06, M.granite, DENSITY.granite);
    ground.position.set(0, CY, -0.02);
    g.add(ground);

    const frame = slab(2.9, 0.18, 0.3, M.gold, DENSITY.gold);
    frame.position.set(0, CY + 1.02, 0.08);
    g.add(frame);

    const sill = slab(2.9, 0.16, 0.34, M.limestone, DENSITY.limestone);
    sill.position.set(0, CY - 1.0, 0.06);
    g.add(sill);

    const marks = CHALK[cfg.weapon] || CHALK.smg;
    for (const [w, h, x, y] of marks) {
      const bar = new THREE.Mesh(box(w, h, 0.05, DENSITY.gold), chalk);
      bar.position.set(x, CY + y, -0.06);
      g.add(bar);
    }

    /**
     * The fixture lights itself, and it has to.
     *
     * Measured, not assumed: the M4 wall in the Great Gallery photographed at
     * 10.6 mean luminance with 21.8 percent of the frame above black. The
     * PLAQUE was perfectly legible - the chalk is emissive - but everything
     * around it was flat black, so the only way a player finds that wall is by
     * already knowing it is there. The gallery is 52 by 38 with three lights in
     * it, all hung on braziers eleven metres off the north wall, and no
     * placement on that wall does better: the east and west walls of that room
     * ARE the upper level, so the north wall is the only wall it has.
     *
     * Unlike a shrine, a wall buy has no dark state to protect - it is always
     * for sale, so it may always glow.
     *
     * It sits LOW and RAKES, and that took two goes. Square-on and a metre out,
     * it put a blown white hotspot in the dead centre of the panel and erased
     * the silhouette it was there to reveal - a plaque is a flat plane, so a
     * light on its normal is the inverse square law aimed at the one part of
     * the fixture that matters. Dropped to the height of the sill it strikes
     * the panel at a glancing angle instead: the surround and the frame light
     * up, the raised bars catch an edge and cast into each other, and the mark
     * itself is emissive so it never needed the lamp in the first place.
     */
    const glow = new THREE.PointLight(0xffb96a, 5.0, 11, 2);
    glow.position.set(0, CY - 1.45, -1.55);
    glow.castShadow = false;
    g.add(glow);

    return g;
  },

  /**
   * THE CHEST OF THE NAMELESS: the mystery box, and the only fixture that MOVES.
   *
   * Three of these are built, one per spawn point, and systems/mysterybox.js
   * keeps exactly one of them awake. That is why the fixture is in two parts:
   *
   *   the PLINTH is permanent. It is built at all three spawns, it is always
   *   visible, and it is the only piece carrying a collider. A chest that
   *   teleported its own collider with it would leave an invisible wall behind
   *   at the spawn it left - the exact bug the STATE note warns about, arrived
   *   at from the other direction - and three empty plinths standing in three
   *   rooms is also the only honest way the map can tell the player where the
   *   chest CAN be before it has ever been there.
   *
   *   the CHEST is the thing that moves. It is scaled to nothing when it is
   *   asleep rather than faded, because every stone material in this map is
   *   shared by half the props in the pyramid and setting `opacity` on one of
   *   them would turn the whole interior translucent.
   *
   * FINDABILITY IS THE FIRST REQUIREMENT and it is a measurement, not a taste.
   * The Anubis shrine was once functionally perfect and photographed at 5.5 mean
   * luminance: correct behaviour, correct text, impossible to find. So the chest
   * carries its own raking light whenever it is awake, before anything has been
   * bought and with the pyramid unpowered, and test/mysterybox.mjs measures the
   * frame it appears in against the frame it left.
   *
   * The beam, the floating mark and the scarab are all tagged `noHit` so a
   * bullet passes through them, and `noPick` so the interaction raycast is not
   * answering a question about a five-metre cone of light when the player is
   * looking at a chest.
   */
  box(ctx, slot) {
    const { M, addCollider } = ctx;
    const g = new THREE.Group();

    // -------------------------------------------------------------------
    // the plinth: permanent, and the only part with a collider
    // -------------------------------------------------------------------

    const kerb = slab(3.5, 0.16, 2.6, M.limestone, DENSITY.limestone);
    kerb.position.y = 0.08;
    g.add(kerb);

    const plinth = slab(3.0, 0.42, 2.1, M.granite, DENSITY.granite);
    plinth.position.y = 0.37;
    g.add(plinth);

    // Four gold studs at the corners. They are what makes an empty plinth read
    // as a socket waiting for something rather than as a block of rubble.
    for (const sx of [-1.28, 1.28]) {
      for (const sz of [-0.82, 0.82]) {
        const stud = slab(0.2, 0.1, 0.2, M.gold, DENSITY.gold);
        stud.position.set(sx, 0.63, sz);
        g.add(stud);
      }
    }

    // -------------------------------------------------------------------
    // the chest
    // -------------------------------------------------------------------

    const chest = new THREE.Group();
    chest.position.y = 0.58;
    chest.visible = false;
    g.add(chest);

    const body = slab(2.4, 1.05, 1.5, M.limestone, DENSITY.limestone);
    body.position.y = 0.53;
    chest.add(body);

    /**
     * The chest's own gold, and it is a CLONE for the same reason the beam's
     * materials are: this is the one place in the map where gold carries its own
     * light, and M.gold is shared by half the props in the pyramid.
     *
     * Findability was originally bought entirely with the raking lamp below, and
     * buying it that way cost the fixture its own shape - a point light strong
     * enough to be seen at six metres blew the chest front past white, and what
     * the player found across a dark room was a glare, not a chest. A LOW
     * emissive on the trim alone is the other half of the trade: the bands, the
     * lock and the lid edge carry their own value, so the silhouette survives at
     * range and the limestone body stays a lit surface with texture on it.
     *
     * The plinth's studs deliberately do NOT get this. They are permanent at all
     * three spawns, and a glowing empty plinth is a false landmark.
     */
    const trimMat = M.gold.clone();
    trimMat.emissive.setHex(0xffa63a);
    trimMat.emissiveIntensity = 1.05;

    for (const sx of [-0.86, 0.86]) {
      const band = slab(0.22, 1.12, 1.58, trimMat, DENSITY.gold);
      band.position.set(sx, 0.53, 0);
      chest.add(band);
    }

    // The lock, on the face the player walks up to. A slot's rot is the
    // direction it FACES and forward is (-sin, 0, -cos), so local -Z is the
    // front of every fixture in this file.
    //
    // Plain gold rather than the emissive trim: it faces the lamp square on at
    // under two metres, and the emissive version photographed as a featureless
    // white square punched through the front of the chest.
    const lock = slab(0.5, 0.34, 0.12, M.gold, DENSITY.gold);
    lock.position.set(0, 0.62, -0.79);
    chest.add(lock);

    /**
     * The lid, hinged at the BACK top edge.
     *
     * A pivot group rather than a rotated mesh, because a lid rotated about its
     * own centre passes through the back wall of its own chest on the way up
     * and the whole animation reads as the box shearing in half. The mesh sits
     * forward of the pivot so the far edge is what swings.
     */
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 1.06, 0.75);
    chest.add(lidPivot);

    const lid = slab(2.5, 0.28, 1.62, M.carved, DENSITY.carved);
    lid.position.set(0, 0.14, -0.81);
    lidPivot.add(lid);

    const lidTrim = slab(2.56, 0.09, 0.2, trimMat, DENSITY.gold);
    lidTrim.position.set(0, 0.16, -1.55);
    lidPivot.add(lidTrim);

    // -------------------------------------------------------------------
    // the beam
    // -------------------------------------------------------------------

    /**
     * Own material instances, and they have to be: this is the one place in the
     * fixture where opacity is animated, and the three chests hold three
     * independent states.
     *
     * Additive with depthWrite off, because a beam of light is light and not a
     * surface. Depth TEST stays on so the beam is occluded by a column standing
     * in front of it, which is the difference between a light in a room and a
     * decal on the camera.
     */
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffcf7d,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xfff0cf,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const BEAM_H = 5.6;

    const beam = new THREE.Group();
    beam.visible = false;
    chest.add(beam);

    // Open-ended on purpose. The player is meant to see UP the shaft from
    // underneath; a capped cylinder puts a lit disc across the top of it.
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 0.44, BEAM_H, 20, 1, true), beamMat);
    cone.position.y = 1.06 + BEAM_H / 2;
    beam.add(cone);

    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.14, BEAM_H, 10, 1, true), coreMat);
    core.position.y = 1.06 + BEAM_H / 2;
    beam.add(core);

    /**
     * UP THE SHAFT, not inside the chest.
     *
     * At 2.4 this sat a metre above the lid with the inverse square law pointed
     * straight down at it, and the open chest photographed as a white hole with
     * a gold rim: the lid, the plate and the mark all past clipping and bloom
     * smearing the result over the room behind. Raising it into the beam and
     * cutting the intensity lights the COLUMN of air and the tops of the walls
     * around it, which is what a shaft of light looks like, and leaves the mark
     * to be the brightest thing in the frame - which is the only thing the
     * player is being asked to read.
     */
    const beamLight = new THREE.PointLight(0xffcf7d, 0, 20, 2);
    beamLight.position.y = 3.3;
    beamLight.castShadow = false;
    chest.add(beamLight);

    // -------------------------------------------------------------------
    // the mark that rides the beam
    // -------------------------------------------------------------------

    /**
     * The plate stays DARK. That is the whole job it has.
     *
     * It was authored as "a dark ground for the gold to be gold against" and
     * then driven to an emissive intensity within a hair of the mark's own, so
     * plate and mark clipped together and the reveal photographed as a white
     * rectangle with a slightly whiter shape in it. A mark is legible because of
     * the CONTRAST between the two, so the plate's emissive is a tenth of the
     * mark's and stays there through the whole pose curve.
     */
    const plateMat = M.granite.clone();
    // Darker than the granite it is cloned from, because the plate stands in a
    // warm beam and inherited granite goes the colour of the light hitting it -
    // which is the colour of the mark. Gold on gold is a texture, not a picture.
    plateMat.color.setHex(0x2b2119);
    plateMat.emissive.setHex(0x1a1208);
    plateMat.emissiveIntensity = 0.12;

    const markMat = M.gold.clone();
    markMat.emissive.setHex(0xffa326);
    markMat.emissiveIntensity = 1.1;

    /**
     * IN FRONT OF THE BEAM, not inside it.
     *
     * Authored at z 0 the plate shared an axis with the beam's core cylinder,
     * and the core is additive: it drew a white stripe straight down the middle
     * of every mark, through the one part of the glyph that tells a bolt rifle
     * from a Sunspear. Half a metre forward and the beam is a backlight, which
     * is what a shaft of light behind an object is for.
     */
    const riser = new THREE.Group();
    riser.position.set(0, 1.4, -0.5);
    riser.visible = false;
    chest.add(riser);

    // A dark ground for the gold to be gold AGAINST, the same correction the
    // wall buy needed: chalk on limestone at the same value is a texture, not
    // a picture.
    const plate = new THREE.Mesh(box(2.3, 1.5, 0.09, DENSITY.granite), plateMat);
    riser.add(plate);

    for (const sy of [-0.72, 0.72]) {
      const rail = new THREE.Mesh(box(2.44, 0.1, 0.16, DENSITY.gold), markMat);
      rail.position.set(0, sy, 0.02);
      riser.add(rail);
    }

    /** One prebuilt mark per weapon, exactly one of them visible. */
    const tokens = {};
    for (const [id, marks] of Object.entries(CHALK)) {
      const t = new THREE.Group();
      t.visible = false;
      for (const [w, h, x, y] of marks) {
        const bar = new THREE.Mesh(box(w, h, 0.06, DENSITY.gold), markMat);
        bar.position.set(x, y - 0.08, -0.07);
        t.add(bar);
      }
      riser.add(t);
      tokens[id] = t;
    }

    // -------------------------------------------------------------------
    // the scarab
    // -------------------------------------------------------------------

    const scarabMat = M.ember.clone();
    scarabMat.color.setHex(0xcfe9ff);
    scarabMat.emissive.setHex(0x63c6ff);
    scarabMat.emissiveIntensity = 3.4;

    const scarab = new THREE.Group();
    scarab.visible = false;
    chest.add(scarab);

    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 9), scarabMat);
    shell.scale.set(1, 0.66, 1.35);
    scarab.add(shell);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 9, 7), scarabMat);
    head.position.z = -0.3;
    scarab.add(head);

    const wings = [];
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(box(0.42, 0.02, 0.26, DENSITY.gold), scarabMat);
      wing.position.set(sx * 0.26, 0.1, 0.03);
      scarab.add(wing);
      wings.push(wing);
    }

    const scarabLight = new THREE.PointLight(0x63c6ff, 0, 16, 2);
    scarabLight.castShadow = false;
    scarab.add(scarabLight);

    // -------------------------------------------------------------------
    // the fixture's own light
    // -------------------------------------------------------------------

    /**
     * LOW AND FORWARD, the correction both the wall buy and the shrine already
     * needed and the reason it is worth learning once: a point light square on
     * a fixture is the inverse square law aimed at the one surface that
     * matters, and it blows the front of the chest to white while leaving the
     * room around it black. Raking it up off the floor lights the plinth, the
     * chest front, and three metres of floor in every direction, which is what
     * findable actually means.
     *
     * On `g` rather than on `chest`, so the chest can be scaled to nothing
     * without the light being scaled somewhere else in the room with it.
     *
     * IT IS ALSO WEAKER AND FURTHER OUT THAN IT WAS, and that is the correction
     * that mattered. At 8.5 units 1.9m from the chest the lamp was 1.15m off the
     * front face, and inverse square at 1.15m clipped the limestone to pure
     * white before bloom had touched it: the fixture measured findable and was
     * unreadable, which is the shrine failure with the sign flipped. Dropped and
     * pushed out, it still lays a warm pool over the plinth and three metres of
     * floor - the part that survives at six metres in a dark room - while the
     * chest itself is now lit by it rather than erased by it. What replaced the
     * lost brightness is the emissive trim above: shape, not glare.
     */
    const WARM = new THREE.Color(0xffb96a);
    const COLD = new THREE.Color(0x6f86c4);

    const glow = new THREE.PointLight(WARM.getHex(), 0, 26, 2);
    glow.position.set(0, 0.72, -2.5);
    glow.castShadow = false;
    g.add(glow);

    for (const o of [cone, core, ...scarab.children]) {
      o.userData.noHit = true;
      o.userData.noPick = true;
    }
    riser.traverse((o) => { if (o.isMesh) o.userData.noHit = true; });

    // -------------------------------------------------------------------
    // the handle systems/mysterybox.js drives
    // -------------------------------------------------------------------

    const GLOW_BASE = 7.0;
    const LID_OPEN = 1.24;      // radians. Past this the lid lies on its back.

    let present = false;
    let cold = 0;
    let glowK = 1;
    let token = null;

    const api = {
      /** Every mark this chest can show. The harness checks POOL against it. */
      tokenIds: Object.keys(tokens),

      get present() { return present; },
      get group() { return g; },

      /**
       * Which mark is on the plate RIGHT NOW, or null.
       *
       * Readable because the cycle's deceleration is the whole feel of the roll
       * and the only honest way to measure it is to watch the mark change. The
       * state machine's own schedule proves what it intended; this proves what
       * the chest actually showed.
       */
      get token() { return token; },

      /**
       * The plate itself, for the harness to PROJECT.
       *
       * systems/mysterybox.js turns this to face whoever is standing there, and
       * for a while it turned it exactly HALF A TURN the wrong way: the reveal
       * presented the back of a slab of granite and every state check around it
       * stayed green, because a plate facing away is still bright, still settles
       * on time, and still names the right weapon in the prompt. The only thing
       * that catches it is measuring how wide the plate actually lands on the
       * screen, and that needs the object and the camera in the same hand.
       */
      get mark() { return riser; },

      setPresent(on) {
        present = !!on;
        chest.visible = present;

        // Everything the last occupancy left behind, put back. A chest that
        // arrives somewhere new with its lid still up from the pull that sent
        // it away is the whole illusion gone in one frame.
        api.setLid(0);
        api.setBeam(0);
        api.setToken(null);
        api.setScarab(0);
        api.setCold(0);
        api.setArrive(present ? 1 : 0);
      },

      /** 0 = not yet arrived, 1 = seated. Scale, never opacity. See above. */
      setArrive(k) {
        const s = Math.max(0.001, k);
        chest.scale.setScalar(s);
        glowK = k;
        glow.intensity = present ? GLOW_BASE * k : 0;
      },

      setLid(k) { lidPivot.rotation.x = LID_OPEN * k; },

      setBeam(k) {
        const on = k > 0.002;
        beam.visible = on;
        // Additive, so these are the amount of light the beam ADDS to whatever
        // is behind it. At 0.55 the core alone drove the centre of the frame
        // past white on its own and the mark was reading THROUGH a flare.
        beamMat.opacity = 0.19 * k;
        coreMat.opacity = 0.30 * k;
        cone.scale.set(1, 0.35 + 0.65 * k, 1);
        core.scale.set(1, 0.35 + 0.65 * k, 1);
        beamLight.intensity = 6.5 * k;
      },

      setToken(id) {
        const want = id && tokens[id] ? tokens[id] : null;
        token = want ? id : null;
        for (const t of Object.values(tokens)) t.visible = (t === want);
        riser.visible = !!want;
        return !!want;
      },

      /**
       * @param {number} y      height above the chest's lip
       * @param {number} spin   yaw of the mark, in the chest's own frame
       * @param {number} scale  1 while cycling, larger on the reveal
       * @param {number} lit    emissive multiplier, 0..1.6
       */
      setTokenPose(y, spin, scale, lit) {
        riser.position.y = 1.4 + y;
        riser.rotation.y = spin;
        riser.scale.setScalar(scale);
        markMat.emissiveIntensity = 1.1 * lit;
        // A tenth of the mark, and it MUST stay a tenth of the mark. See the
        // note where the two materials are made.
        plateMat.emissiveIntensity = 0.08 + 0.10 * lit;
      },

      /** 0 = docked in the chest, 1 = gone. */
      setScarab(k) {
        const on = k > 0.001 && k < 0.999;
        scarab.visible = on;
        if (!on) { scarabLight.intensity = 0; return; }

        // Up out of the chest and away over the player's shoulder, on an arc,
        // shrinking as it goes. A straight line reads as a projectile.
        scarab.position.set(
          Math.sin(k * 5.4) * 2.6 * k,
          1.1 + k * 5.0,
          -k * 3.4
        );
        scarab.rotation.set(-0.5 * k, Math.sin(k * 7.1) * 0.9, Math.sin(k * 9) * 0.3);
        scarab.scale.setScalar(Math.max(0.05, 1 - k * 0.55));

        const flap = Math.sin(k * 90) * 0.9;
        wings[0].rotation.z = flap;
        wings[1].rotation.z = -flap;

        scarabLight.intensity = 9 * Math.sin(Math.PI * Math.min(1, k * 1.2));
      },

      /** 0 warm and open for business, 1 dead stone. */
      setCold(k) {
        cold = k;
        glow.color.lerpColors(WARM, COLD, k);
      },

      /**
       * The idle life of the fixture: a slow breath on the lamp, so a closed
       * chest across a dark room is the one thing in the frame that is moving.
       */
      tick(dt, t) {
        if (!present) return;
        const breathe = 1 + Math.sin(t * 1.7 + slot.x * 0.7 + slot.z * 0.3) * 0.09;
        glow.intensity = GLOW_BASE * glowK * breathe * (1 - 0.85 * cold);
      },
    };

    api.setPresent(false);
    ctx.lastVisuals = api;

    addCollider(slot.x, slot.z, 1.5, 1.0);
    return g;
  },

  /**
   * Perk shrine: a basin with a flame, a back stela, and a god's mark on it.
   *
   * Three states, and all three have to be legible at a glance from across a
   * room, because the player's question is never "what does this cost" - the
   * prompt answers that - it is "is this one worth walking to":
   *
   *   dark   no flame, no light, dead stone. The Kindling is cold.
   *   live   the flame burns in the god's colour and lights its own alcove.
   *   held   the flame steadies and the mark on the stela is lit from within.
   *
   * The colour is the whole identity at range. Six shrines that differ only in
   * the shape of a small emblem are six identical objects to somebody running
   * past at eight metres a second; six that differ in the colour of the fire
   * spilling onto the wall behind them are six landmarks.
   */
  shrine(ctx, slot) {
    const { M, addCollider, animated } = ctx;
    const g = new THREE.Group();
    const cfg = slot.config || {};
    const look = BOON_LOOK[cfg.boon] || BOON_LOOK.anubis;

    const base = slab(1.9, 0.5, 1.4, M.granite, DENSITY.granite);
    base.position.y = 0.25;
    g.add(base);

    const stem = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(0.42, 0.6, 1.5, 14), 0.6, 1.5, DENSITY.granite),
      M.granite
    );
    stem.position.y = 1.25;
    stem.castShadow = true;
    g.add(stem);

    const basin = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(0.95, 0.45, 0.55, 18), 0.95, 0.55, DENSITY.gold),
      M.gold
    );
    basin.position.y = 2.2;
    basin.castShadow = true;
    g.add(basin);

    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), M.ember.clone());
    flame.material.color.setHex(look.colour);
    flame.material.emissive.setHex(look.emissive);
    flame.material.emissiveIntensity = 0;
    flame.position.y = 2.42;
    flame.scale.y = 0.6;
    g.add(flame);

    // A back slab so the shrine reads against the wall it is mounted on, and
    // it is TALL for a reason that only showed up in a screenshot: the god's
    // mark goes on this face, and at the original 3.4 the mark sat behind the
    // basin. The bowl is 1.9 across at the lip and the emblem was inside its
    // silhouette from every angle a player actually stands at, which made six
    // carefully distinguished marks into one shape nobody could see. Raising
    // the slab puts the mark in clear air above the bowl.
    const STELA_H = 4.6;
    const MARK_Y = 3.55;

    const stela = slab(2.2, STELA_H, 0.3, M.carved, DENSITY.carved);
    stela.position.set(0, STELA_H / 2, 0.72);
    g.add(stela);

    // The god's mark, cut into the face of the stela. Its own material instance
    // because it is lit from within when the boon is held, and sharing would
    // make every shrine in the map announce one purchase.
    const markMat = M.gold.clone();
    markMat.emissive.setHex(look.emissive);
    markMat.emissiveIntensity = 0;

    const emblem = EMBLEM[cfg.boon] || EMBLEM.anubis;
    for (const [w, h, x, y] of emblem.bars) {
      const bar = new THREE.Mesh(box(w, h, 0.09, DENSITY.gold), markMat);
      bar.position.set(x, MARK_Y + y, 0.53);
      g.add(bar);
    }
    for (const [r, x, y] of emblem.discs) {
      const disc = new THREE.Mesh(
        cylinderUV(new THREE.CylinderGeometry(r, r, 0.09, 16), r, 0.09, DENSITY.gold),
        markMat
      );
      disc.rotation.x = Math.PI / 2;
      disc.position.set(x, MARK_Y + y, 0.53);
      g.add(disc);
    }

    /**
     * The fixture's own light, and the reason a DEAD shrine still has one.
     *
     * The first version of this emitted nothing at all until the Kindling, on
     * the argument that a shrine which glows in an unpowered map is the map
     * telling the player something is available when it is not. That argument
     * is right about the FLAME and wrong about the fixture, and the frame
     * measured it: the Anubis shrine sits in the east third of the Chamber of
     * Ascent, six metres from the nearest brazier, and photographed at 5.5 mean
     * luminance with 13 percent of the frame above black. It worked, said the
     * right thing, and could not be found.
     *
     * This file already solved exactly this problem once, for the sealed gates
     * at the dead ends of two long rooms: a gate that cannot be bought has to be
     * FOUND, so it lights itself. Same answer here, with the state carried in
     * the light rather than in whether there is one.
     *
     *   dark   cold slate, dim, colourless. Stone, and no invitation.
     *   live   the god's own colour at four times the intensity, flickering.
     *
     * Nobody will mistake the first for the second. They are different hues at
     * different brightnesses next to a flame that is either burning or is not.
     */
    const COLD = new THREE.Color(0x5a6a92);
    const WARM = new THREE.Color(look.emissive);
    const DARK_GLOW = 7.0;

    // The light MOVES between the two states, and that is not decoration.
    //
    // A live shrine is lit BY ITS FLAME, so the light belongs in the basin. A
    // dead one has no flame, and a point light parked half a unit under a gold
    // basin with nothing burning in it is a photograph of the inverse square
    // law: the lip blows to white and the fixture reads as switched ON, which
    // is the exact wrong answer. Standing it low and forward instead washes the
    // stem, the plinth and the wall behind - the fixture is findable, and
    // nothing in the frame looks lit.
    //
    // This is the same correction the sealed gates in this file already needed
    // and for the same reason. It is worth only one comment because it is worth
    // learning once.
    const DARK_AT = { y: 1.45, z: -1.95 };
    const LIVE_AT = { y: 2.70, z: -0.50 };

    const light = new THREE.PointLight(COLD.getHex(), DARK_GLOW, 16, 2);
    light.position.set(0, DARK_AT.y, DARK_AT.z);
    light.castShadow = false;
    g.add(light);

    const phase = (slot.x * 5.1 + slot.z * 3.3) % 6.283;

    // 0 dark, 1 lit, RAMPED rather than switched. Six shrines coming up over a
    // second and a half is most of what makes the Kindling an event; six
    // shrines changing colour between two frames is a rendering glitch.
    let live = 0;
    let target = 0;
    let held = false;

    const POWER_RAMP = 1.4;

    animated.push({
      setPowered(on) { target = on ? 1 : 0; },

      /** Called by systems/shrines.js the moment the boon is bought. */
      setHeld(on) { held = !!on; },

      update(dt, t) {
        if (live !== target) {
          const step = dt / POWER_RAMP;
          live = target > live
            ? Math.min(target, live + step)
            : Math.max(target, live - step);

          light.color.lerpColors(COLD, WARM, live);
          light.position.y = DARK_AT.y + (LIVE_AT.y - DARK_AT.y) * live;
          light.position.z = DARK_AT.z + (LIVE_AT.z - DARK_AT.z) * live;
        }

        // Slower and steadier than a brazier. A perk fixture that flickers like
        // fire reads as damaged rather than magical, and a HELD one steadies
        // further still, which is the cheapest possible "this one is yours".
        const wobble = held ? 0.18 : 0.5;
        const lit = live * (1 + (held ? 0.45 : 0));

        flame.material.emissiveIntensity = lit * (2.6 + Math.sin(t * 2.4 + phase) * wobble);
        flame.scale.x = flame.scale.z = 1 + Math.sin(t * 1.9 + phase) * 0.05;
        markMat.emissiveIntensity = held ? 1.35 : lit * 0.25;

        light.intensity = DARK_GLOW * (1 - live)
          + lit * (7.5 + Math.sin(t * 2.1 + phase) * 0.9);
      },
    });

    // Handed back through the context rather than written onto the slot.
    // rooms.js is DATA that the node harness reads without a GPU, and a builder
    // that scribbles a THREE object onto it stops being safe to run twice.
    // buildInteracts moves this onto the interact record a line later.
    ctx.lastVisuals = animated[animated.length - 1];

    addCollider(slot.x, slot.z, 1.0, 2.6);
    return g;
  },

  /** The upgrade altar. The most gold in one place anywhere in the map. */
  altar(ctx, slot) {
    const { M, addCollider, animated } = ctx;
    const g = new THREE.Group();

    const step = slab(4.6, 0.4, 3.2, M.granite, DENSITY.granite);
    step.position.y = 0.2;
    g.add(step);

    const block = slab(3.4, 1.7, 2.2, M.granite, DENSITY.granite);
    block.position.y = 1.25;
    g.add(block);

    const plate = slab(3.6, 0.22, 2.4, M.gold, DENSITY.gold);
    plate.position.y = 2.2;
    g.add(plate);

    for (const sx of [-1.5, 1.5]) {
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.9, 4), M.gold);
      spire.position.set(sx, 3.25, 0);
      spire.rotation.y = Math.PI / 4;
      spire.castShadow = true;
      g.add(spire);
    }

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), M.ember.clone());
    core.material.color.setHex(0xffcf6a);
    core.material.emissive.setHex(0xffa617);
    core.position.y = 2.75;
    // Pushed to the BACK half of the plate. It used to sit on the centre line,
    // where the weapon the machine is now asked to present would have been
    // inside the fireball rather than above the altar.
    core.position.z = 0.46;
    g.add(core);

    /**
     * WHERE A WEAPON SITS WHILE THE ALTAR HAS IT.
     *
     * An empty group and deliberately nothing else. systems/altar.js owns the
     * weapon on the machine - it is a real copy of the real viewmodel, built by
     * player/viewmodel.js, and this file has no business authoring a second
     * gun-shaped prop - so all the geometry owes it is a mount at the right
     * height, in front of the core rather than inside it, on the side the player
     * walks up to.
     *
     * A slot's rot is the direction it FACES and forward is (-sin, 0, -cos), so
     * local -Z is the front of every fixture in this file, and this sits at the
     * FRONT of the 2.4-deep plate rather than on its centre line. Both parts of
     * that were measured off rendered frames rather than chosen:
     *
     *   - the core moved back to +0.46, because a 0.5 radius emissive sphere on
     *     the centre line put the presented weapon inside the fireball
     *   - the mount came forward to -0.95, because the plate's own front edge is
     *     above a 1.68 metre eye and therefore occludes what stands behind it.
     *     At the centre line it cut 240mm off the bottom of the weapon at
     *     conversational distance.
     */
    const mount = new THREE.Group();
    mount.position.set(0, 2.46, -0.95);
    g.add(mount);

    /**
     * The machine's own lamp, hung over the MOUNT and not over the core.
     *
     * An altar that glows the same in all three states is set dressing; the read
     * of the ritual is that the room changes while the player is standing in it
     * with no gun. Modest range and intensity on purpose: see the note on the
     * chest's beam light, where a lamp strong enough to be found across a room
     * blew the fixture past white and what the player found was a glare.
     */
    /**
     * IN FRONT OF THE MOUNT, not over it, and that is about metal rather than
     * about brightness.
     *
     * The gilded finish is metalness 0.86 and a metal has essentially no diffuse
     * term: what it shows the player is a REFLECTION, so a lamp hung directly
     * above the weapon puts its highlight on the top faces where nobody standing
     * in front of the Altar can see it. Sitting the lamp on the player's side of
     * the weapon puts the specular lobe back down the sightline, which is what
     * makes the gold inlay read as gold instead of as a dark blue outline.
     */
    const lamp = new THREE.PointLight(0xffc46a, 0, 13, 2);
    lamp.position.set(0, 2.95, -1.45);
    lamp.castShadow = false;
    g.add(lamp);

    // Two ramps, 0..1: `live` is the machine under load, `show` is a finished
    // weapon standing on the plate. Both are ramped rather than switched, which
    // is what makes the fire CATCH and then BANK rather than snapping between
    // three lighting presets.
    let target = 0;
    let live = 0;
    let showTarget = 0;
    let show = 0;

    animated.push({
      /** systems/altar.js, on insertion and on completion. */
      setWorking(on) { target = on ? 1 : 0; },
      setPresenting(on) { showTarget = on ? 1 : 0; },

      update(dt, t) {
        const rate = target > live ? dt / 0.35 : dt / 1.1;
        live = target > live ? Math.min(target, live + rate) : Math.max(target, live - rate);

        const sRate = dt / 0.8;
        show = showTarget > show ? Math.min(showTarget, show + sRate)
                                 : Math.max(showTarget, show - sRate);

        // Base 2.8 with a slow breath, up to a hard flicker at full work. The
        // flicker is two incommensurate sines so it never falls into a pattern.
        const beat = Math.sin(t * 1.6) * 0.8;
        const grind = Math.sin(t * 11.3) * 0.5 + Math.sin(t * 7.1) * 0.5;

        /**
         * THE FIRE BANKS WHEN THE WORK IS DONE, and this is the line that makes
         * the presented weapon legible at all.
         *
         * The first pass of this ritual left the core at its idle value while a
         * weapon was on the plate, and the rendered frame is the whole argument
         * for why that was wrong: a half-metre emissive sphere at intensity 2.8,
         * two metres behind a 400mm weapon, through a bloom pass, is a white
         * disc with a dark aeroplane in it. The prompt said TAKE THE NEKHBET'S
         * TALON and there was visibly nothing there to take. Photographed, and
         * only findable by photographing it.
         *
         * So the ember drops to a quarter and shrinks while it is presenting.
         * Which is also the better fiction - the forge has finished, and what is
         * left glowing in the room is the thing it made.
         */
        const banked = 1 - show * 0.76;
        core.material.emissiveIntensity = (2.8 + beat) * banked + live * (5.4 + grind * 2.2);

        // 0.6 rad/s at rest, six times that under load.
        core.rotation.y += dt * (0.6 + live * 3.1);
        core.scale.setScalar((1 + live * 0.18 + live * grind * 0.05) * (1 - show * 0.34));

        // Under load the lamp floods the room. Presenting, it is a display light
        // on one object at arm's length and nothing else.
        // 3.6 rather than the 6.2 the first pass used, and the difference is
        // where the player is allowed to stand. The collider stops them 2.1
        // metres from the Altar's centre, which is a metre and a half from the
        // weapon, and at 6.2 the near face of a broadside weapon clipped past
        // white with a bloom halo around it - a white gun, not a gilded one. It
        // reads correctly at the reach limit and at the collider both.
        lamp.intensity = live * (11 + grind * 2.4) + show * 3.6;
      },
    });

    // Handed back through the context, exactly as the shrine does: rooms.js is
    // DATA the node harness reads without a GPU, so nothing THREE-shaped is
    // written onto the slot. buildInteracts moves this onto the interact record.
    ctx.lastVisuals = animated[animated.length - 1];
    ctx.lastVisuals.mount = mount;

    addCollider(slot.x, slot.z, 2.1, 2.4);
    return g;
  },

  /** THE KINDLING. Dead stone until it is thrown, then the map's brightest fire. */
  power(ctx, slot) {
    const { M, addCollider, animated } = ctx;
    const g = new THREE.Group();

    const housing = slab(2.6, 2.2, 1.6, M.granite, DENSITY.granite);
    housing.position.y = 1.1;
    g.add(housing);

    const bowl = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(1.15, 0.5, 0.8, 18), 1.15, 0.8, DENSITY.gold),
      M.gold
    );
    bowl.position.y = 2.6;
    bowl.castShadow = true;
    g.add(bowl);

    const fire = new THREE.Mesh(new THREE.SphereGeometry(0.85, 14, 10), M.ember.clone());
    fire.material.emissiveIntensity = 0;
    fire.position.y = 2.9;
    fire.scale.y = 0.7;
    g.add(fire);

    const lever = slab(0.22, 1.6, 0.22, M.gold, DENSITY.gold);
    lever.position.set(0, 2.2, -0.9);
    lever.rotation.x = -0.5;
    g.add(lever);

    // Unpowered it emits nothing, so the room stays as dark as the fiction
    // says it is. The light only exists once the switch has been thrown.
    const light = new THREE.PointLight(0xffb057, 0, 34, 2);
    light.position.y = 3.2;
    light.castShadow = false;
    g.add(light);

    let on = false;
    animated.push({
      setPowered(next) {
        on = next;
        lever.rotation.x = on ? 0.5 : -0.5;
      },
      update(dt, t) {
        const target = on ? 1 : 0;
        const f = Math.sin(t * 9.3) * 0.5 + Math.sin(t * 5.1) * 0.5;
        fire.material.emissiveIntensity = target * (4.2 + f * 1.1);
        light.intensity = target * (16 + f * 4);
      },
    });

    addCollider(slot.x, slot.z, 1.5, 2.6);
    return g;
  },

  /** A jar socket cut into the wall. Empty until the puzzle system fills it. */
  niche(ctx, slot) {
    const { M } = ctx;
    const g = new THREE.Group();

    // Recess: a dark back panel behind a carved frame. Cheaper and more
    // reliable than actually cutting the wall, and it reads the same at
    // playable distance.
    const backing = slab(1.5, 2.2, 0.2, M.granite, DENSITY.granite);
    backing.position.set(0, 2.1, 0.55);
    g.add(backing);

    for (const sx of [-0.95, 0.95]) {
      const jambPiece = slab(0.4, 2.6, 0.6, M.carved, DENSITY.carved);
      jambPiece.position.set(sx, 2.1, 0.3);
      g.add(jambPiece);
    }

    const head = slab(2.3, 0.4, 0.6, M.carved, DENSITY.carved);
    head.position.set(0, 3.55, 0.3);
    g.add(head);

    const socket = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(0.42, 0.5, 0.28, 14), 0.5, 0.28, DENSITY.gold),
      M.gold
    );
    socket.position.set(0, 1.34, 0.42);
    g.add(socket);

    const shelf = slab(1.5, 1.2, 0.7, M.limestone, DENSITY.limestone);
    shelf.position.set(0, 0.6, 0.42);
    g.add(shelf);

    return g;
  },
};

/**
 * The chalk material, made once and handed to every fixture that draws a mark.
 *
 * Its own instance rather than M.gold, and lightly emissive, because a wall buy
 * has to be findable from across an unlit room. The registry's gold is on half
 * the props in the map and lifting its emissive here would set fire to every
 * sarcophagus mask in the pyramid.
 *
 * Memoised at module scope rather than built inside buildInterior, which is
 * where it used to live. There are two placers now - the interior's room loop
 * and the courtyard - and two clones of one material configured in two files is
 * exactly the drift this codebase keeps its authored tables single for.
 */
let sharedChalk = null;

function wallChalk(M) {
  if (sharedChalk) return sharedChalk;
  sharedChalk = M.gold.clone();
  sharedChalk.emissive.setHex(0x7a5314);
  sharedChalk.emissiveIntensity = 0.8;
  return sharedChalk;
}

/**
 * ONE WALL BUY, BUILT OUTSIDE THE INTERIOR'S ROOM LOOP.
 *
 * THE PROBLEM THIS SOLVES. Every wall buy in the game was an `interactSlots`
 * entry in rooms.js, built by buildInteracts() above, and rooms.js is the
 * inside of the pyramid. MAP.md puts the B3AR in the courtyard, in Act 1, and
 * there was no mechanism of any kind for a fixture out there: the courtyard is
 * built by world/courtyard.js, which has no room records, no interactSlots and
 * no way to reach the plaque that is authored here.
 *
 * WHY THIS AND NOT A SECOND PLAQUE IN COURTYARD.JS. Because the second one
 * would be a second plaque. The fixture is not just geometry - it is the
 * proportions of the panel, the recessed dark ground that makes gold read as
 * gold, the CHALK silhouette table, and the raking self-lit lamp that took two
 * goes to place and is documented above at length. A copy of it in the exterior
 * module would agree with this one on the day it was written and never again.
 *
 * The record it returns is the same shape buildInteracts() pushes, because the
 * consumers are the same code: ui/interact.js raycasts `group`, reads
 * `userData.interact` off whatever mesh it hits, and hands the record to
 * systems/wallbuy.js, which reads `config.weapon` and `config.cost`. Buying
 * outside and buying inside are therefore one code path and one prompt, which
 * is the requirement.
 *
 * `noBatch` because the courtyard merges its static geometry after everything
 * is built, and a batcher that swallows these meshes takes `userData.interact`
 * with them - the fixture would render perfectly and be unbuyable, which is the
 * failure this project has a name for.
 *
 * Wall buys only, and deliberately narrow. The shrines and the Chest of the
 * Nameless want a collider array, the animation list and the power ramp out of
 * the interior's build context; handing them an empty one to be general would
 * be a function that silently builds a shrine nothing can light.
 */
export function buildWallBuyFixture(slot) {
  if (slot.type !== 'wallbuy') return null;

  const M = buildMaterials();
  const g = INTERACTS.wallbuy({ M, chalk: wallChalk(M) }, slot);

  g.position.set(slot.x, slot.y || 0, slot.z);
  g.rotation.y = slot.rot || 0;
  g.userData.noBatch = true;

  const record = { ...slot, room: slot.room || 'courtyard', group: g, visuals: null };
  g.traverse((o) => { if (o.isMesh) o.userData.interact = record; });

  return record;
}

// ---------------------------------------------------------------------------
// barriers: the buy-doors themselves
// ---------------------------------------------------------------------------

/**
 * Fill every priced or gated portal with something the player has to deal with.
 *
 * The room shells already cut the openings; without this pass the whole map is
 * one continuous space and the costs in rooms.js are decoration. A barrier owns
 * three things and nothing else: the geometry standing in the hole, the
 * colliders that make it solid, and the animation that clears it. What it
 * COSTS, whether the player can afford it, and what a locked one says are all
 * systems/doors.js, because none of that is geometry.
 *
 * The courtyard's sealed doorway is deliberately not built here. It is a
 * courtyard object standing in the courtyard's own wall, and it is handed to
 * the same door system from the other side.
 */
function buildBarriers({ rand, group, colliders, animated, rooms, portals }) {
  const out = [];

  for (const p of portals) {
    // ENTRY comes in with from === null. Its barrier is the granite slab out in
    // the courtyard: building a second one here would charge the player twice
    // for the same doorway, once from each side of a teleport.
    if (!p.from) continue;
    if (p.kind === 'open') continue;

    const axis = portalAxis(p, rooms);
    if (!axis) continue;

    // The hole this barrier stands in was cut by portalOpening and the numbers
    // travel on the portal record, so the door and the doorway cannot disagree.
    // A barrier sized from its own reading of the two room heights was correct
    // only while every threshold was at zero.
    const sill = p.sill;
    const h = p.clear;

    const g = new THREE.Group();
    g.position.set(p.at.x, sill, p.at.z);
    group.add(g);

    /**
     * A barrier weathers from its own THRESHOLD, which is the higher of the two
     * floors it joins and is already carried on the portal record.
     *
     * The three descent gates therefore stay on the datum instance, because
     * their sill is the gallery's floor at 0 and the stone standing in them is
     * the gallery's stone. The two Hard-only debris doors between the King's
     * Chamber and its neighbours sit at -6 and get the deep instance, which is
     * the same rule the rooms either side of them are built by.
     */
    const BM = materialsForBase(sill);

    const spec = p.kind === 'debris'
      ? debrisBarrier(g, BM, rand, axis, p.width, h)
      : gateBarrier(g, BM, axis, p.width, h, p.kind);

    // A continuous RUN of overlapping cylinders, not one cylinder per doorway.
    // A single disc across a 5-unit opening either leaves the corners open or
    // eats the wall either side of it; spacing derived from the radius means
    // the run cannot silently un-seal if the width is retuned.
    const mine = [];
    const r = 0.6;
    const step = r * 1.4;
    const n = Math.max(2, Math.ceil(p.width / step));
    for (let i = 0; i <= n; i++) {
      const t = (i / n - 0.5) * (p.width - 0.2);
      const c = {
        x: axis === 'x' ? p.at.x : p.at.x + t,
        z: axis === 'x' ? p.at.z + t : p.at.z,
        r,
        h,
        // The doorway's threshold, not the world origin. A barrier in a doorway
        // six metres above the floor of the room it opens into would otherwise
        // declare a base of 0 and block the room BELOW itself instead of the
        // opening - the same failure the Altar of Ptah produced on the gallery
        // bridge, in a doorway the player has paid a thousand gold for.
        y0: sill,
      };
      colliders.push(c);
      mine.push(c);
    }

    /**
     * Hand this barrier's cylinders back to the map.
     *
     * Lifted into its own function because there are now two ways a barrier
     * stops being solid and only one of them is a purchase: open() below is the
     * player paying for it, clearInstantly() is the tier saying it was never
     * there. Both have to release exactly the same list, and a second copy of
     * this splice loop is the kind of duplicate that gets updated once.
     */
    const releaseColliders = () => {
      for (const c of mine) {
        const i = colliders.indexOf(c);
        if (i >= 0) colliders.splice(i, 1);
      }
    };

    const record = {
      id: `${p.from}/${p.to}`,
      from: p.from,
      to: p.to,
      kind: p.kind,
      cost: p.cost,
      width: p.width,
      axis,
      x: p.at.x,
      z: p.at.z,
      // Mid-height of the opening, which is where a prompt or a marker wants to
      // sit. Measured from the sill so it tracks a doorway that is not on the
      // floor of the room it is being looked at from.
      y: sill + h * 0.5,
      group: g,
      meshes: spec.meshes,
      opened: false,
      opening: false,

      /**
       * Built from a portal's `onHard`, so it is a barrier on Hard and nothing
       * at all on the tiers below. The relaxation pass reads this rather than a
       * list of room ids, so a third doorway authored with `onHard` in rooms.js
       * is wired by writing the data and nothing else.
       */
      hardOnly: !!p.hardOnly,

      /**
       * Start clearing. Idempotent, and it drops the colliders on the FIRST
       * frame rather than the last: a player who has paid should be able to
       * walk into the doorway while it is still moving, which is what makes a
       * buy-door feel like an opening rather than a loading screen.
       */
      open() {
        if (record.opened || record.opening) return false;
        record.opening = true;

        releaseColliders();
        return true;
      },

      /**
       * Take the barrier out of the world as though it had never been built: no
       * animation, no sound, no charge, no event, finished in the frame it is
       * called in.
       *
       * This is what a tier below Hard does with an `onHard` doorway, and it
       * cannot be open() with a faster animation. open() is the far end of a
       * purchase: it hands the barrier to the animator and leaves `opening`
       * true for the length of the collapse, and every surface that reads a
       * door - the prompt, the minimap, the objective tracker - would spend
       * that second and a half showing an Easy player a wall being cleared that
       * they were never meant to know about. The finished state, written once,
       * is the only honest spelling of "there is nothing here".
       *
       * THE COLLIDERS ARE RELEASED RATHER THAN THE MESHES MERELY HIDDEN. An
       * invisible wall standing in an open doorway is the worse half of this
       * bug and it is the half no screenshot catches.
       */
      clearInstantly() {
        if (record.opened) return false;

        releaseColliders();
        record.opening = false;
        record.opened = true;
        // The whole group, so the debris chunks and the dust go together. The
        // animated path ends the same way; see the note on `g.visible` below.
        g.visible = false;
        return true;
      },
    };

    let t = 0;
    animated.push({
      update(dt) {
        if (!record.opening) return;

        t = Math.min(1, t + dt / OPEN_SECONDS);
        // Ease out. A barrier that moves at a constant rate and then stops dead
        // reads as a cutscene; weight is entirely in the deceleration.
        spec.apply(1 - Math.pow(1 - t, 3));

        if (t >= 1) {
          record.opening = false;
          record.opened = true;
          // Nothing left to draw or test once it has cleared. The group stays
          // in the scene graph so the record keeps a stable parent, but an
          // invisible group costs one visibility test per frame and no more.
          g.visible = false;
        }
      },
    });

    // Tagged on every mesh so a raycast resolves to the barrier without walking
    // back up the parent chain, the same contract the interact slots use.
    g.traverse((o) => { if (o.isMesh) o.userData.door = record; });

    out.push(record);
  }

  return out;
}

/**
 * Which wall line a portal sits on, from the rooms either side of it.
 *
 * 'x' means the opening is cut in a wall running along Z, so the barrier is
 * thin in X. The tolerance is the same half-wall-thickness the shell builder
 * uses, so a portal either belongs to a wall for both of them or for neither.
 */
function portalAxis(p, rooms) {
  const tol = WALL_T * 0.55;

  for (const id of [p.from, p.to]) {
    const r = rooms.find((rr) => rr.id === id);
    if (!r) continue;

    const { x, z, w, d } = r.bounds;
    if (Math.abs(p.at.x - (x - w / 2)) < tol || Math.abs(p.at.x - (x + w / 2)) < tol) return 'x';
    if (Math.abs(p.at.z - (z - d / 2)) < tol || Math.abs(p.at.z - (z + d / 2)) < tol) return 'z';
  }

  return null;
}

/**
 * A collapse packed into the doorway. Clears by sinking into the floor.
 *
 * Sinking rather than fading: the materials are shared registry instances, so
 * animating opacity here would dissolve every piece of limestone in the map.
 * Below y=0 the floor plane occludes it for free.
 */
function debrisBarrier(g, M, rand, axis, width, h) {
  const meshes = [];
  const chunks = [];

  const across = width - 0.3;
  const rows = 4;
  const perRow = Math.max(3, Math.round(across / 1.1));

  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < perRow; i++) {
      const w = 0.85 + rand() * 0.8;
      const bh = 0.8 + rand() * 0.7;
      const d = 0.7 + rand() * 0.5;

      const chunk = slab(w, bh, d, M.limestone, DENSITY.rubble);

      // Staggered like a real collapse: each course offset from the one below,
      // and the whole pile leaning back into the room it fell from.
      const t = (i + (r % 2) * 0.5) / perRow - 0.5 + (rand() - 0.5) * 0.12;
      const y = (r + 0.5) * (h / rows) + (rand() - 0.5) * 0.25;

      chunk.position.set(
        axis === 'x' ? (rand() - 0.5) * 0.5 : t * across,
        y,
        axis === 'x' ? t * across : (rand() - 0.5) * 0.5
      );
      chunk.rotation.set(
        (rand() - 0.5) * 0.25,
        rand() * Math.PI,
        (rand() - 0.5) * 0.25
      );

      g.add(chunk);
      meshes.push(chunk);
      // Per-chunk sink rates, so the pile collapses rather than descending as
      // one welded block.
      chunks.push({ mesh: chunk, y0: chunk.position.y, rate: 0.75 + rand() * 0.55 });
    }
  }

  const drop = h + 1.6;

  return {
    meshes,
    apply(k) {
      for (const c of chunks) {
        c.mesh.position.y = c.y0 - drop * Math.min(1, k * c.rate * 1.4);
      }
      g.position.y = -drop * k * 0.35;
    },
  };
}

/**
 * A stone gate. Clears by rising into the lintel above the doorway.
 *
 * It hides inside solid stone rather than being switched off, which is why the
 * shell builder's lintel matters: a doorway cut to the ceiling would have
 * nowhere to put this and the gate would rise into open air.
 *
 * 'power' and 'puzzle' gates get a gold seal so a player can tell at a glance
 * that this one is not for sale.
 */
function gateBarrier(g, M, axis, width, h, kind) {
  const meshes = [];
  const sealed = kind === 'power' || kind === 'puzzle';

  const T = 0.5;
  const w = axis === 'x' ? T : width - 0.2;
  const d = axis === 'x' ? width - 0.2 : T;

  const body = slab(w, h, d, sealed ? M.granite : M.carved,
    sealed ? DENSITY.granite : DENSITY.carved);
  body.position.y = h / 2;
  g.add(body);
  meshes.push(body);

  // Horizontal courses, because a single flat face at doorway scale reads as a
  // placeholder no matter what texture is on it.
  for (let i = 1; i < 4; i++) {
    const band = slab(w + 0.12, 0.16, d + 0.12, M.limestone, DENSITY.limestone);
    band.position.y = (h / 4) * i;
    g.add(band);
    meshes.push(band);
  }

  const sealW = axis === 'x' ? T + 0.16 : 1.5;
  const sealD = axis === 'x' ? 1.5 : T + 0.16;

  const seal = slab(sealW, sealed ? 1.5 : 0.9, sealD, M.gold, DENSITY.gold);
  seal.position.y = h * 0.55;
  g.add(seal);
  meshes.push(seal);

  if (sealed) {
    // A gate that cannot be bought has to be FOUND, and both of them sit at the
    // dead end of a long room where the nearest fire is twenty units away. This
    // is the fixture lighting itself: short range, so it reads as a glow on the
    // seal rather than as a lamp, and it leaves with the gate when it rises.
    //
    // One each side, standing off the face along the barrier's normal. A single
    // light on the centre line sits INSIDE the seal it is meant to light, which
    // illuminates the inside of a box and nothing else - the first version of
    // this lit a solid gold seal to the colour of dried blood.
    for (const side of [-1, 1]) {
      // Standing well off the face, not against it. A point light half a unit
      // from a metal seal is a photograph of the inverse square law: the seal
      // blows to white and the granite around it goes orange.
      const glow = new THREE.PointLight(0xffc061, 2.0, 11, 2);
      glow.position.set(
        axis === 'x' ? side * 1.7 : 0,
        h * 0.58,
        axis === 'x' ? 0 : side * 1.7
      );
      glow.castShadow = false;
      g.add(glow);
    }
  }

  const rise = h + 0.4;

  return {
    meshes,
    apply(k) {
      g.position.y = rise * k;
    },
  };
}

// ---------------------------------------------------------------------------
// lighting
// ---------------------------------------------------------------------------

function buildLights(ctx) {
  // roomBase rather than base: the flicker below already owns the name `base`
  // for the light's unlit intensity, and both live in the same block.
  const { room, group, lights, animated, anchors, power, POWER_LIFT, base: roomBase } = ctx;
  const P = LIGHTING[room.lightingProfile] || LIGHTING.chamber;

  const { x, z, w, d } = room.bounds;
  const long = Math.max(w, d);
  const count = Math.max(1, Math.min(P.max, Math.round(long / 16)));

  // Lights hang on the room's braziers where there are any, so the thing that
  // flickers and the thing you can see burning are the same object. A room
  // with no fire falls back to a line down its long axis.
  for (let i = 0; i < count; i++) {
    let pos;
    let phase = 0;

    if (i < anchors.length) {
      // Spread the picks across the available braziers rather than taking the
      // first N, which would cluster every light at one end of a long room.
      // Only while there are braziers left to spread over: a room with one fire
      // and two lights was stacking both on the same bowl and leaving the far
      // half of the room black, which is where the Canopic Crypt was hiding its
      // gate to the King's Chamber.
      const a = anchors[Math.floor((i * anchors.length) / count)];
      pos = { x: a.x, y: a.y, z: a.z };
      phase = a.phase;
    } else {
      // The fallback height is a FRACTION OF THE ROOM, so it has to be measured
      // from the room's own floor. Left at `room.height * P.y` a descended room
      // hangs its only light at the elevation the room used to be at, which for
      // the Act 3 rooms is above their new ceiling: the room goes black and
      // nothing in the build reports it.
      const t = (i + 0.5) / count;
      const ly = roomBase + room.height * P.y;
      pos = w >= d
        ? { x: x - w / 2 + w * (0.2 + 0.6 * t), y: ly, z }
        : { x, y: ly, z: z - d / 2 + d * (0.2 + 0.6 * t) };
      phase = (pos.x * 3.1 + pos.z * 1.7) % 6.283;
    }

    const light = new THREE.PointLight(P.color, P.intensity, P.distance, 2);
    light.position.set(pos.x, pos.y, pos.z);
    light.castShadow = false;   // interior shadow budget is spent on the sun
    group.add(light);

    lights.push({ light, distance: P.distance, rank: i, room: room.id });

    const base = P.intensity;
    // The shaft is lit from a star hole rather than a fire, so it holds steady.
    const amount = room.lightingProfile === 'shaft' ? 0.06 : 0.28;
    animated.push({
      update(dt, t) {
        const f = Math.sin(t * 9.1 + phase) * 0.5 + Math.sin(t * 5.3 + phase * 2) * 0.5;
        // The flicker and the power lift are multiplied rather than added, so
        // a powered room flickers HARDER as well as brighter. Adding a constant
        // would light the map and flatten it in the same move.
        light.intensity = base * (1 + f * amount) * (1 + POWER_LIFT * power.level);
      },
    });
  }
}
