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
import { buildMaterials } from './materials.js';
import { box, plane, cylinderUV } from './uv.js';
import { ROOMS, ENTRY } from './rooms.js';

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
 */
const CHALK = {
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
  const addCollider = (x, z, r, h) => colliders.push({ x, z, r, h, y0: 0 });

  /** { x, z, w, d, y0, y1 } axis-aligned boxes, for the player's bounds check. */
  const walls = [];

  /**
   * Walkable surfaces above y=0, for the controller to sample later. A ledge is
   * the degenerate ramp y0 === y1; a real ramp rises along its longer
   * horizontal axis, from y0 at the low-coordinate end to y1 at the high one.
   */
  const ramps = [];

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

  /**
   * Chalk: the gold a wall buy's silhouette is drawn in.
   *
   * Its own instance rather than M.gold, and lightly emissive, because a wall
   * buy has to be findable from across an unlit room. The registry's gold is on
   * half the props in the map and lifting its emissive here would set fire to
   * every sarcophagus mask in the pyramid.
   */
  const chalk = M.gold.clone();
  chalk.emissive.setHex(0x7a5314);
  chalk.emissiveIntensity = 0.8;

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
    const ctx = {
      room, M, rand, group, colliders, walls, ramps,
      interacts, jars, lights, animated, addCollider,
      chalk, power, POWER_LIFT,
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
  const barriers = buildBarriers({ M, rand, group, colliders, animated, rooms, portals });

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
     */
    heightAt(x, z, footY) {
      let y = 0;
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
 */
function collectPortals(rooms) {
  const out = [{ from: null, to: ENTRY.to, at: ENTRY.at, width: ENTRY.width, kind: ENTRY.kind, cost: ENTRY.cost }];

  for (const room of rooms) {
    for (const p of room.portals || []) {
      out.push({ from: room.id, to: p.to, at: p.at, width: p.width, kind: p.kind, cost: p.cost });
    }
  }
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

function buildShell(ctx, portals) {
  const { room, M, group } = ctx;
  const { x, z, w, d } = room.bounds;
  const h = room.height;

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
  floor.position.set(x, 0, z);
  floor.receiveShadow = true;
  group.add(floor);

  const ceil = new THREE.Mesh(plane(w, d, 2, DENSITY.limestone), M.limestone);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(x, h, z);
  ceil.receiveShadow = true;
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

  const doorH = Math.min(DOOR_H, h - 0.8);

  for (const side of sides) {
    // A portal belongs to this side when it sits on the wall line and inside
    // the span. The tolerance is half the wall thickness, which is the most a
    // hand-authored coordinate should ever be off by.
    const gaps = mine
      .filter((p) => Math.abs((side.axis === 'x' ? p.at.x : p.at.z) - side.line) < WALL_T * 0.55)
      .map((p) => {
        const c = side.axis === 'x' ? p.at.z : p.at.x;
        return { lo: c - p.width / 2, hi: c + p.width / 2 };
      })
      .filter((g) => g.hi > side.lo && g.lo < side.hi)
      .sort((a, b) => a.lo - b.lo);

    let cursor = side.lo;

    for (const g of gaps) {
      if (g.lo - cursor > 0.05) emitWall(ctx, side, cursor, g.lo, 0, h);
      // The stone above the opening. Without it the doorway reads as a slot cut
      // to the ceiling, which is the single clearest tell of a generated map.
      if (h - doorH > 0.05) emitWall(ctx, side, g.lo, g.hi, doorH, h);
      cursor = Math.max(cursor, g.hi);
    }

    if (side.hi - cursor > 0.05) emitWall(ctx, side, cursor, side.hi, 0, h);
  }
}

function emitWall(ctx, side, lo, hi, y0, y1) {
  const { M, group, walls } = ctx;
  const len = hi - lo;
  const mid = (lo + hi) / 2;
  const h = y1 - y0;

  const mesh = side.axis === 'x'
    ? slab(WALL_T, h, len, M.limestone, DENSITY.limestone)
    : slab(len, h, WALL_T, M.limestone, DENSITY.limestone);

  const wx = side.axis === 'x' ? side.inner : mid;
  const wz = side.axis === 'x' ? mid : side.inner;
  mesh.position.set(wx, y0 + h / 2, wz);
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
  const { room, M, group, ramps } = ctx;
  if (!room.ramps) return;

  for (const r of room.ramps) {
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

    // A kerb along the open edge of a flat ledge. It is the only thing that
    // stops the upper level reading as a floating slab from below.
    if (rise === 0) {
      const inner = r.x < room.bounds.x ? r.x + r.w / 2 : r.x - r.w / 2;
      const kerb = slab(0.5, 0.55, r.d, M.carved, DENSITY.carved);
      kerb.position.set(inner, r.y0 + 0.27, r.z);
      group.add(kerb);
    }
  }
}

// ---------------------------------------------------------------------------
// props
// ---------------------------------------------------------------------------

function buildProps(ctx) {
  const { room, group, colliders } = ctx;

  for (const slot of room.propSlots || []) {
    const before = colliders.length;

    const g = PROPS[slot.type] && PROPS[slot.type](ctx, slot);
    if (!g) continue;

    g.position.set(slot.x, slot.y || 0, slot.z);
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
    anchors.push({ x: slot.x, y: (slot.y || 0) + 2.35, z: slot.z, phase });

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

    const jar = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(0.30, 0.22, 0.72, 14), 0.30, 0.72, DENSITY.carved),
      M.carved
    );
    jar.position.y = 1.26;
    jar.castShadow = true;
    g.add(jar);

    // The stopper is the head of one of the four sons of Horus. At this scale
    // the shape is a silhouette, so the gold is doing the identifying.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), M.gold);
    head.position.y = 1.76;
    head.scale.set(1, 1.15, 0.9);
    g.add(head);

    jars.push({ ...slot, room: ctx.room.id, group: g });
    addCollider(slot.x, slot.z, 0.62, 1.9);
    return g;
  },
};

// ---------------------------------------------------------------------------
// interact slots
// ---------------------------------------------------------------------------

function buildInteracts(ctx) {
  const { room, group, interacts } = ctx;

  for (const slot of room.interactSlots || []) {
    ctx.lastVisuals = null;

    const g = INTERACTS[slot.type] && INTERACTS[slot.type](ctx, slot);
    if (!g) continue;

    g.position.x = slot.x;
    g.position.z = slot.z;
    g.rotation.y = slot.rot || 0;

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

  /** Mystery box: a banded chest that sits closed until the round claims it. */
  box(ctx, slot) {
    const { M, addCollider } = ctx;
    const g = new THREE.Group();

    const body = slab(2.4, 1.15, 1.5, M.limestone, DENSITY.limestone);
    body.position.y = 0.58;
    g.add(body);

    const lid = slab(2.5, 0.3, 1.6, M.carved, DENSITY.carved);
    lid.position.y = 1.3;
    g.add(lid);

    for (const sx of [-0.85, 0.85]) {
      const band = slab(0.22, 1.5, 1.62, M.gold, DENSITY.gold);
      band.position.set(sx, 0.72, 0);
      g.add(band);
    }

    addCollider(slot.x, slot.z, 1.35, 1.5);
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
    g.add(core);

    animated.push({
      update(dt, t) {
        core.material.emissiveIntensity = 2.8 + Math.sin(t * 1.6) * 0.8;
        core.rotation.y += dt * 0.6;
      },
    });

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
function buildBarriers({ M, rand, group, colliders, animated, rooms, portals }) {
  const out = [];

  for (const p of portals) {
    // ENTRY comes in with from === null. Its barrier is the granite slab out in
    // the courtyard: building a second one here would charge the player twice
    // for the same doorway, once from each side of a teleport.
    if (!p.from) continue;
    if (p.kind === 'open') continue;

    const axis = portalAxis(p, rooms);
    if (!axis) continue;

    const near = rooms.find((r) => r.id === p.from);
    const far = rooms.find((r) => r.id === p.to);
    const h = Math.min(
      DOOR_H,
      Math.min(near ? near.height : DOOR_H + 1, far ? far.height : DOOR_H + 1) - 0.8
    );

    const g = new THREE.Group();
    g.position.set(p.at.x, 0, p.at.z);
    group.add(g);

    const spec = p.kind === 'debris'
      ? debrisBarrier(g, M, rand, axis, p.width, h)
      : gateBarrier(g, M, axis, p.width, h, p.kind);

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
        y0: 0,
      };
      colliders.push(c);
      mine.push(c);
    }

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
      y: h * 0.5,
      group: g,
      meshes: spec.meshes,
      opened: false,
      opening: false,

      /**
       * Start clearing. Idempotent, and it drops the colliders on the FIRST
       * frame rather than the last: a player who has paid should be able to
       * walk into the doorway while it is still moving, which is what makes a
       * buy-door feel like an opening rather than a loading screen.
       */
      open() {
        if (record.opened || record.opening) return false;
        record.opening = true;

        for (const c of mine) {
          const i = colliders.indexOf(c);
          if (i >= 0) colliders.splice(i, 1);
        }
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
  const { room, group, lights, animated, anchors, power, POWER_LIFT } = ctx;
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
      const t = (i + 0.5) / count;
      pos = w >= d
        ? { x: x - w / 2 + w * (0.2 + 0.6 * t), y: room.height * P.y, z }
        : { x, y: room.height * P.y, z: z - d / 2 + d * (0.2 + 0.6 * t) };
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
