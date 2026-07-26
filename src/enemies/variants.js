/**
 * The three deviations from the shambler.
 *
 * THE ONE RULE THIS FILE IS WRITTEN AGAINST: a variant that is only a different
 * colour is not a variant. At twenty metres, in a chamber lit by two point
 * lights, hue is the first thing to go and silhouette is the last. So every
 * entry here changes the OUTLINE before it changes anything else:
 *
 *   - the husk is bent double with arms that hang past its knees, so it reads
 *     as a sprinter's shape even before it moves;
 *   - the Bound is a monolith - flat gilded shoulder slabs, a nemes flare
 *     either side of the skull, arms folded across the chest - so it reads as a
 *     door with legs;
 *   - the scarab is not humanoid at all. A low carapace on six legs at knee
 *     height cannot be confused with anything else in the game, which is the
 *     entire point of putting a swarm enemy in a shooter about upright dead.
 *
 * Everything else is a number on top of the base record in mummy.js. Where a
 * variant needs geometry the humanoid builder cannot express, it brings its own
 * builder and its own animator and keeps the actor contract; that is the case
 * for the scarab and nothing else.
 *
 * Wave gating lives in director.js, not here. This file says what a thing IS,
 * the director says when the map is allowed to use it.
 */

import * as THREE from 'three';
import { chamferedBox } from '../world/geometry.js';
import { MUMMY, buildHumanoid, animateHumanoid } from './mummy.js';

// ---------------------------------------------------------------------------
// the scarab: its own rig
// ---------------------------------------------------------------------------

/** Shared with the humanoid cache would need a second key space; a swarm has
 * six shapes total, so it keeps its own tiny one. */
const SGEO = new Map();

function sgeo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  let g = SGEO.get(key);
  if (!g) {
    g = chamferedBox(w, h, d, Math.min(w, h, d) * 0.2, 2.2);
    SGEO.set(key, g);
  }
  return g;
}

/**
 * A carapace on six legs.
 *
 * The legs are built as a TRIPOD: left-front, right-middle, left-rear move
 * together, and the other three move on the opposite half of the cycle. That is
 * how an insect actually walks, it is two lines of code more than alternating
 * sides, and it is the difference between "bug" and "small dog".
 */
function buildScarab(spec, mats, actor) {
  const P = spec.proportions;
  const meshes = [];
  let triangles = 0;

  const add = (parent, g, mat, region) => {
    const m = new THREE.Mesh(g, mat);
    m.userData.enemy = actor;
    m.userData.region = region;
    m.castShadow = true;
    parent.add(m);
    meshes.push(m);
    triangles += g.attributes.position.count / 3;
    return m;
  };

  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = P.rideHeight;
  group.add(body);

  // The shell. Wide and long and very low, so the outline against a floor is a
  // horizontal bar rather than a vertical one.
  add(body, sgeo(P.shellW, P.shellH, P.shellD), mats.accent, 'body');
  add(body, sgeo(P.shellW * 0.68, P.shellH * 0.9, P.shellD * 0.6), mats.accent, 'body')
    .position.y = P.shellH * 0.62;

  // Abdomen, tapering behind. Local -Z is behind: the actor faces +Z.
  add(body, sgeo(P.shellW * 0.56, P.shellH * 0.72, P.shellD * 0.5), mats.wrapDark, 'body')
    .position.set(0, -0.01, -P.shellD * 0.62);

  // The head is a real hitbox on a real head. A swarm enemy with no head is a
  // swarm enemy that can never pay 100, which quietly makes precision worthless
  // against exactly the wave the player most wants to be precise in.
  const neck = new THREE.Group();
  neck.position.z = P.shellD * 0.52;
  body.add(neck);
  add(neck, sgeo(P.headW, P.headH, P.headD), mats.deep, 'head');

  // The same eye slot every other variant carries. On something this low to the
  // ground it is most of what the player sees of it at all.
  add(neck, sgeo(P.headW * 0.7, 0.035, 0.04), mats.eye, 'head')
    .position.set(0, P.headH * 0.18, P.headD * 0.55);

  for (const side of [-1, 1]) {
    const m = add(neck, sgeo(0.045, 0.045, P.headD * 1.5), mats.accent, 'head');
    m.position.set(side * P.headW * 0.42, -P.headH * 0.18, P.headD * 0.7);
    m.rotation.y = side * 0.28;
  }

  // --- legs ------------------------------------------------------------------
  const legs = [];
  const rows = [P.shellD * 0.34, 0, -P.shellD * 0.34];

  for (let r = 0; r < 3; r++) {
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * P.shellW * 0.46, -P.shellH * 0.2, rows[r]);
      hip.rotation.z = side * -0.55;
      body.add(hip);

      add(hip, sgeo(0.05, P.femur, 0.05), mats.wrapDark, 'body')
        .position.y = -P.femur / 2;

      const knee = new THREE.Group();
      knee.position.y = -P.femur;
      hip.add(knee);

      add(knee, sgeo(0.04, P.tibia, 0.04), mats.deep, 'body')
        .position.y = -P.tibia / 2;

      // Tripod phase: front-left, middle-right, rear-left share a half cycle.
      const tripod = ((r + (side < 0 ? 0 : 1)) % 2) * Math.PI;
      legs.push({ hip, knee, side, tripod, splay: side * -0.55 });
    }
  }

  // Same asymmetry contract the humanoid returns, so the actor's spawn path
  // does not need to know which builder made it.
  const asym = { scale: 0.86 + Math.random() * 0.28, tilt: 0, droop: 0, reach: 0 };

  return {
    group, body, neck, legs, arms: [], tatters: [],
    torso: body, hips: body, meshes, triangles, asym,
  };
}

/**
 * Scuttle.
 *
 * Legs sweep fore and aft around their splayed rest pose while the body pitches
 * a little on the same phase, so the whole shell rocks over each tripod. The
 * wind-up rears the front of the shell up off the floor, which is a telegraph
 * that survives being seen from directly above, unlike an arm raise.
 */
function animateScarab(rig, spec, s) {
  const g = spec.gait;
  const p = s.phase;
  const drive = Math.min(1, s.speed / spec.speed);
  const amp = g.stride * (0.3 + 0.7 * drive);

  for (const leg of rig.legs) {
    const ph = p * 2 + leg.tripod;
    leg.hip.rotation.z = leg.splay + Math.sin(ph) * 0.12 * drive;
    leg.hip.rotation.x = Math.sin(ph) * amp;
    leg.knee.rotation.x = Math.max(0, Math.cos(ph)) * amp * 1.2 + 0.35;
  }

  let pitch = Math.sin(p * 2) * 0.05 * drive;
  if (s.windup > 0) pitch += s.windup * 0.55;          // rears back to strike
  else if (s.strike > 0) pitch -= (1 - s.strike) * 0.4;

  rig.body.rotation.x = pitch;
  rig.body.rotation.z = Math.sin(p) * 0.09 * drive + s.staggerRoll;
  rig.body.position.y = spec.proportions.rideHeight
    + Math.abs(Math.sin(p * 2)) * 0.02 * drive
    - s.stagger * 0.03;

  rig.neck.rotation.x = -Math.sin(p * 0.6) * 0.08;
}

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------

/** Shallow merge one level down, which is all these records are ever nested. */
function extend(base, over) {
  const out = { ...base, ...over };
  for (const key of ['palette', 'proportions', 'gait']) {
    if (over[key]) out[key] = { ...base[key], ...over[key] };
  }
  return out;
}

/**
 * Fast, fragile, and bent double.
 *
 * The husk is the wave's pressure: it arrives before the shamblers do and it
 * punishes a player who is reloading. Its budget is spent entirely on being
 * READ EARLY - ember eye sockets and a hunch nothing else in the game has - so
 * that "something quick is coming" is available at the far end of a gallery.
 */
export const HUSK = extend(MUMMY, {
  id: 'husk',
  name: 'Husk',

  health: 85,
  speed: 4.7,
  accel: 11,
  turn: 4.6,
  damage: 12,
  attackRange: 1.9,
  windup: 0.30,
  strikeTime: 0.30,
  cooldown: 0.85,
  staggerTake: 1.5,

  scale: 0.88,
  height: 1.75,
  radius: 0.34,
  sepRadius: 0.85,
  voicePitch: 1.45,

  palette: {
    wrap: 0x4d3f2c,
    wrapDark: 0x2b2014,
    deep: 0x0d0906,
    // Live coals in the sockets. On a fast enemy the tell has to survive being
    // seen for a fifth of a second at forty metres, and emissive is the only
    // channel that does not go to mud under the fog pass.
    eye: 0xff4a10,
    accent: 0x8a6a34,
  },

  proportions: {
    hipY: 0.86, hipW: 0.24, bodyD: 0.19,
    legX: 0.10, legW: 0.11, thighL: 0.42, shinL: 0.44,
    torsoY: 0.12, chestW: 0.30, chestH: 0.50,
    // Arms nearly as long as the legs. A hand that hangs below the knee is the
    // single cheapest signal that a body is wrong.
    shoulderX: 0.18, shoulderY: 0.46, armW: 0.095, upperL: 0.50, foreL: 0.52,
    headY: 0.60, headW: 0.19, headH: 0.34, headD: 0.24,
    tatterRest: 0.16,
    // One trailing rag off the spine. Desiccated, not wrapped: the husk has
    // burned out of most of its bindings, and the near-bare outline is half of
    // why it does not read as a small shambler.
    tatters: [
      { on: 'torso', x: 0.0, y: 0.22, z: -0.10, w: 0.10, h: 0.66, yaw: 0.2, swing: 1.6 },
    ],
  },

  gait: {
    rate: 2.6,
    stride: 0.85,
    armSwing: 0.55,
    // Hanging, not reaching. The spine is already pitched 35 degrees forward,
    // so arms that hang straight down off it end up ahead of the feet on their
    // own - which is the read, and it is the opposite of the shambler's.
    armReach: 0.18,
    armSplay: 0.20,
    elbowBend: 0.18,
    // Bent hard, but not so far that a head-on view is looking down at its
    // back. At -0.62 the head vanished behind the shoulders from the one angle
    // the player sees it from most, and the outline became a table.
    lean: -0.46,
    sway: 0.16,
    hipTwist: 0.14,
    bob: 0.08,
    headLoll: 0.20,
    headDroop: 0.52,    // head up and forward out of the hunch, hunting
  },
});

/**
 * The Bound: armoured, slow, and very hard to move.
 *
 * It is the wave's wall. Everything about it is built to make a player change
 * weapon rather than change position: 560 health, a quarter of the normal
 * stagger take, and a reach long enough that backing away in a straight line
 * does not work.
 *
 * The arms are folded across the chest in the mummiform pose rather than
 * hanging, which is both the correct read for a royal burial and a second
 * silhouette cue that survives at distances where the shoulder slabs have
 * merged with the torso.
 */
export const BOUND = extend(MUMMY, {
  id: 'bound',
  name: 'The Bound',

  health: 560,
  speed: 1.32,
  accel: 4.0,
  turn: 1.7,
  damage: 34,
  attackRange: 2.3,
  windup: 0.85,
  strikeTime: 0.55,
  cooldown: 1.9,
  staggerTake: 0.25,

  scale: 1.24,
  height: 2.05,
  radius: 0.60,
  sepRadius: 1.5,
  voicePitch: 0.62,

  palette: {
    wrap: 0x7b6f52,
    wrapDark: 0x453a26,
    deep: 0x120e09,
    eye: 0x58a8ff,
    accent: 0xd0a24e,
    accentMetal: 0.88,
    accentRough: 0.34,
  },

  proportions: {
    hipY: 0.90, hipW: 0.48, bodyD: 0.38,
    legX: 0.17, legW: 0.24, thighL: 0.44, shinL: 0.46,
    torsoY: 0.13, chestW: 0.70, chestH: 0.58,
    shoulderX: 0.34, shoulderY: 0.46, armW: 0.20, upperL: 0.36, foreL: 0.38,
    headY: 0.68, headW: 0.26, headH: 0.28, headD: 0.28,
    plate: { w: 0.52, h: 0.30 },
    shoulderSlab: { w: 0.26, h: 0.14, d: 0.42 },
    headdress: { w: 0.17, h: 0.40 },
    tatterRest: 0.05,
    tatters: [
      { on: 'torso', x: -0.24, y: 0.16, z: -0.20, w: 0.14, h: 0.78, yaw: 0.25, swing: 0.6 },
      { on: 'torso', x: 0.24, y: 0.12, z: -0.20, w: 0.13, h: 0.66, yaw: -0.25, swing: 0.6 },
    ],
  },

  gait: {
    rate: 1.15,
    stride: 0.34,
    armSwing: 0.06,
    // Folded across the chest, the mummiform pose of a royal burial.
    //
    // The fold is a THREE-joint pose and getting any one of them wrong turns it
    // into a tangle: the upper arms hang barely forward, the elbows shut almost
    // completely, and a hard inward splay carries the forearms across the
    // midline. The first pass reached the upper arms forward as well, and the
    // result photographed as a pile of slabs.
    armReach: -0.42,
    armSplay: -0.58,
    elbowBend: 2.05,
    lean: -0.05,
    sway: 0.05,
    hipTwist: 0.03,
    bob: 0.035,
    headLoll: 0.05,
    headDroop: -0.06,
  },
});

/**
 * The swarm.
 *
 * Individually trivial - two body shots, six damage a bite - and dangerous
 * only in number, which is why the director always spawns them in a clutch and
 * never one at a time. Their separation radius is half the humanoids' so they
 * flow around a pillar as a mass rather than queueing behind it.
 */
export const SCARAB = extend(MUMMY, {
  id: 'scarab',
  name: 'Scarab Swarm',

  health: 45,
  speed: 5.0,
  accel: 14,
  turn: 6.5,
  damage: 6,
  attackRange: 1.15,
  windup: 0.22,
  strikeTime: 0.22,
  cooldown: 0.70,
  staggerTake: 1.8,

  scale: 1.0,
  height: 0.55,
  radius: 0.30,
  sepRadius: 0.55,
  voicePitch: 2.0,

  palette: {
    wrap: 0x3a2c1c,
    wrapDark: 0x241a10,
    deep: 0x0e0a06,
    eye: 0x6a3a08,
    accent: 0x35281a,
    accentMetal: 0.55,
    accentRough: 0.32,
  },

  proportions: {
    rideHeight: 0.30,
    shellW: 0.60, shellH: 0.22, shellD: 0.72,
    headW: 0.20, headH: 0.15, headD: 0.18,
    femur: 0.22, tibia: 0.24,
  },

  gait: {
    rate: 2.2,
    stride: 0.45,
  },

  build: buildScarab,
  animate: animateScarab,
});

/** Every variant the director may draw from, base included. */
export const VARIANTS = {
  shambler: MUMMY,
  husk: HUSK,
  bound: BOUND,
  scarab: SCARAB,
};

/**
 * The wave a variant is first allowed to appear on.
 *
 * Kept here rather than in the director so that adding a variant is one file,
 * but read ONLY by the director: a spec does not decide when it is used.
 */
export const UNLOCK = {
  shambler: 1,
  scarab: 4,
  husk: 6,
  bound: 10,
};

export { buildHumanoid, animateHumanoid };
