/**
 * The four deviations from the shambler.
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
 * THE GOLD SCARAB IS THE ONE ENTRY THAT DOES NOT OBEY THAT RULE, and it is
 * worth saying why rather than letting it look like an oversight. It shares the
 * scarab's outline on purpose: the player is supposed to read it as "that
 * beetle, but elite" in the frame it appears in, and a new silhouette would say
 * "a new thing" instead. What separates it at range is not shape, it is the one
 * bright metal mass in a roster of linen, plus a cadence half the speed of the
 * swarm it walks in with. The rule above is about not being able to TELL two
 * enemies apart; this one is about wanting them told together.
 *
 * Everything else is a number on top of the base record in mummy.js. Where a
 * variant needs geometry the humanoid builder cannot express, it brings its own
 * builder and its own animator and keeps the actor contract; that is the case
 * for the scarab, and the gold scarab wraps the scarab's pair rather than
 * forking them.
 *
 * Wave gating lives in director.js, not here. This file says what a thing IS,
 * the director says when the map is allowed to use it.
 */

import * as THREE from 'three';
import { parts } from './anatomy.js';
import { WRAP_TILES } from './wraps.js';
import { contactShadow } from './contact.js';
import { MUMMY, buildHumanoid, animateHumanoid } from './mummy.js';

// ---------------------------------------------------------------------------
// the scarab: its own rig
// ---------------------------------------------------------------------------

/**
 * The swarm's geometry, merged by (group, material) exactly as the humanoid's
 * is, and cached against the proportions record.
 *
 * The shell used to be twenty meshes - two carapace slabs, an abdomen, a head,
 * two sockets, two mandibles and twelve leg segments - on an enemy that spawns
 * in clutches. Merging within each rig group takes it to eighteen with the
 * contact patch included, and the swarm reads identically because none of the
 * merged pieces ever moved relative to one another.
 */
const SGEO = new Map();

/**
 * A carapace on six legs.
 *
 * The legs are built as a TRIPOD: left-front, right-middle, left-rear move
 * together, and the other three move on the opposite half of the cycle. That is
 * how an insect actually walks, it is two lines of code more than alternating
 * sides, and it is the difference between "bug" and "small dog".
 */
function scarabGeometry(P) {
  let out = SGEO.get(P);
  if (out) return out;

  const T = WRAP_TILES;
  out = {};

  {
    // The shell. Wide and long and very low, so the outline against a floor is
    // a horizontal bar rather than a vertical one, and domed rather than
    // slabbed: the carapace tapers in on all four sides as it rises.
    const p = parts(T);
    p.box(P.shellW, P.shellH, P.shellD, { top: 0.86, bottom: 1.0 });
    p.box(P.shellW * 0.68, P.shellH * 0.9, P.shellD * 0.6,
      { y: P.shellH * 0.62, top: 0.66, bottom: 1.0, depthTop: 0.8, depthBottom: 1.0 });
    out.shell = p.build();
  }
  {
    // Abdomen, tapering behind. Local -Z is behind: the actor faces +Z.
    const p = parts(T);
    p.box(P.shellW * 0.56, P.shellH * 0.72, P.shellD * 0.5,
      { y: -0.01, z: -P.shellD * 0.62, top: 0.85, bottom: 1.0 });
    out.abdomen = p.build();
  }
  {
    const p = parts(T);
    p.box(P.headW, P.headH, P.headD, { top: 0.8, bottom: 1.0, depthTop: 0.9, depthBottom: 1.0 });
    out.head = p.build();
  }
  {
    // Two sockets, matching the humanoids. A single wide slot here was the same
    // visor mistake at a smaller size, and on a shell at knee height it read as
    // a sensor bar on a drone.
    const p = parts(T);
    for (const s of [-1, 1]) {
      p.box(0.04, 0.035, 0.03,
        { x: s * P.headW * 0.26, y: P.headH * 0.16, z: P.headD * 0.52, chamfer: 0 });
    }
    out.eyes = p.build();
  }
  {
    const p = parts(T);
    for (const s of [-1, 1]) {
      p.box(0.045, 0.045, P.headD * 1.5, {
        x: s * P.headW * 0.42, y: -P.headH * 0.18, z: P.headD * 0.7,
        ry: s * 0.28, top: 0.6, bottom: 1.0,
      });
    }
    out.jaws = p.build();
  }
  {
    const p = parts(T);
    p.box(0.055, P.femur, 0.055, { y: -P.femur / 2, top: 1.0, bottom: 0.7 });
    out.femur = p.build();
  }
  {
    const p = parts(T);
    p.box(0.045, P.tibia, 0.045, { y: -P.tibia / 2, top: 1.0, bottom: 0.55 });
    out.tibia = p.build();
  }

  SGEO.set(P, out);
  return out;
}

function buildScarab(spec, mats, actor) {
  const P = spec.proportions;
  const G = scarabGeometry(P);
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

  // Per-instance shell, on the same principle as the humanoid's: geometry is
  // shared, the rig is not, so a wider or longer shell is one scale.
  const R = () => Math.random();
  const j = { w: 0.88 + R() * 0.24, l: 0.9 + R() * 0.22 };

  add(body, G.shell, mats.accent, 'body').scale.set(j.w, 1, j.l);
  add(body, G.abdomen, mats.wrapDark, 'body').scale.set(j.w, 1, j.l);

  // The head is a real hitbox on a real head. A swarm enemy with no head is a
  // swarm enemy that can never pay 100, which quietly makes precision worthless
  // against exactly the wave the player most wants to be precise in.
  const neck = new THREE.Group();
  neck.position.z = P.shellD * 0.52 * j.l;
  body.add(neck);

  add(neck, G.head, mats.deep, 'head');
  add(neck, G.eyes, mats.eye, 'head');
  add(neck, G.jaws, mats.accent, 'head');

  // --- legs ------------------------------------------------------------------
  const legs = [];
  const rows = [P.shellD * 0.34 * j.l, 0, -P.shellD * 0.34 * j.l];

  for (let r = 0; r < 3; r++) {
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * P.shellW * 0.46 * j.w, -P.shellH * 0.2, rows[r]);
      hip.rotation.z = side * -0.55;
      body.add(hip);

      add(hip, G.femur, mats.wrapDark, 'body');

      const knee = new THREE.Group();
      knee.position.y = -P.femur;
      hip.add(knee);

      add(knee, G.tibia, mats.deep, 'body');

      // Tripod phase: front-left, middle-right, rear-left share a half cycle.
      const tripod = ((r + (side < 0 ? 0 : 1)) % 2) * Math.PI;
      legs.push({ hip, knee, side, tripod, splay: side * -0.55 });
    }
  }

  // A swarm at ankle height is the case where a contact patch matters MOST: a
  // low body with no cast shadow under it reads as hovering, and a scarab that
  // hovers is a drone.
  const blob = contactShadow((spec.radius ?? 0.3) * 1.9);
  blob.position.y = 0.02;
  group.add(blob);

  // Same asymmetry contract the humanoid returns, so the actor's spawn path
  // does not need to know which builder made it.
  const asym = { scale: 0.86 + R() * 0.28, tilt: 0, droop: 0, reach: 0 };
  const gait = { rate: 0.85 + R() * 0.3, stride: 0.85 + R() * 0.3, swing: 1 };

  return {
    group, body, neck, legs, arms: [], tatters: [],
    torso: body, hips: body, meshes, triangles, asym, gait, blob,
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

  /**
   * THE HIT REACTION, in the one vocabulary a six-legged shell has.
   *
   * The humanoid's version throws a shoulder and whips a rag. A carapace has
   * neither, and the reaction it does have is the one an actual beetle has when
   * something hits it: the shell SLAMS on the struck side, the legs on that side
   * collapse under it, and the whole thing skids a few centimetres. Written
   * against the same fields the humanoid uses, so the actor never has to know
   * which animator it got.
   *
   * The scarab dies in two body shots, which is exactly why this matters: almost
   * every round the player puts into one is either the killing shot or the shot
   * immediately before it, so if a hit on a scarab does not read, hitting
   * scarabs does not read at all.
   */
  const hk = s.hit || 0;
  // Assigned every frame, not only while reacting, so a recoiled head returns to
  // straight instead of being left wherever the last hit put it. Nothing else in
  // this animator writes this axis.
  rig.neck.rotation.y = 0;
  if (hk === 0) return;

  const lx = s.hitLX || 0;
  const f = s.hitF || 0;
  const side = s.hitS || 0;

  // The shell drops and rolls away from the impulse. A low wide body has almost
  // no lever arm to pitch on, so most of the reaction is in the vertical.
  rig.body.position.y -= hk * 0.055;
  rig.body.rotation.z += (-side * 0.34 + lx * 0.16) * hk;
  rig.body.rotation.x += -f * hk * 0.22;

  // The legs on the struck side splay out from under it.
  for (const leg of rig.legs) {
    const w = Math.max(0, leg.side * lx);
    if (w <= 0) continue;
    leg.hip.rotation.z += leg.side * w * hk * 0.30;
    leg.knee.rotation.x += w * hk * 0.45;
  }

  // And the head recoils, which on this rig is the only fine motion available.
  rig.neck.rotation.x += -f * hk * (0.14 + (s.hitHead || 0) * 0.40);
  rig.neck.rotation.y += lx * hk * (0.18 + (s.hitHead || 0) * 0.45);
}

// ---------------------------------------------------------------------------
// the gold scarab: the same rig, re-armoured
// ---------------------------------------------------------------------------

/**
 * The vent, and it is the whole enemy.
 *
 * A gold scarab is plated everywhere the player can see it while backing away,
 * and the one panel that is not plated is on the back of the abdomen. That is
 * not decoration: the hitscan reads `userData.region` off whatever mesh it
 * struck, and this mesh is the only one on the body tagged 'head'. So the crit
 * multiplier - 2.0 to 2.6 depending on the weapon - lives BEHIND it.
 *
 * SIZE IS THE PART THAT IS EASY TO GET WRONG, and mummy.js has the arithmetic:
 * at the fifteen metres an enemy is fought at, a metre is about 47 px in a
 * 1000 px frame. The first draft of this was three 2.8 cm spiracle slots, which
 * is 1.3 px each - authored, believed, never on screen, which is the exact
 * defect that note was written about. One plate at 0.46 of the shell's width
 * comes out 32.6 cm across the actor's own 1.18 scale, or about 15 px, and it
 * is the thing the player is being asked to aim at.
 *
 * It takes mats.eye, so the panel is the same low emissive the sockets are.
 * Cold light on a gold body is the point - see the palette note below.
 */
const VENT = new Map();

function goldVentGeometry(P) {
  let out = VENT.get(P);
  if (out) return out;

  const p = parts(WRAP_TILES);
  // Offsets are baked in, exactly as scarabGeometry bakes the abdomen's, so
  // this can be parented straight to the abdomen mesh and inherit the
  // per-instance width and length jitter that mesh already carries.
  p.box(P.shellW * 0.46, P.shellH * 0.52, 0.05, {
    y: -0.01, z: -P.shellD * 0.86, chamfer: 0,
  });
  out = p.build();

  VENT.set(P, out);
  return out;
}

/**
 * Built on buildScarab and then re-tagged, rather than forked.
 *
 * Everything that makes this thing hard is in WHICH MESH CARRIES WHICH REGION,
 * so a second copy of the rig would be 80 lines of duplicated leg tripod in
 * order to change four `userData.region` strings. Three edits on top of the
 * scarab:
 *
 *   1. the abdomen becomes the crit ('head') and is repainted in `deep`, so the
 *      soft spot is the one DARK mass on a gold body and reads as a gap in the
 *      armour rather than as a differently-shaped plate;
 *   2. the skull, sockets and jaws lose the crit. The habit the game spends six
 *      waves teaching - HEADSHOT_LETHAL_THROUGH in systems/damage.js is 6 -
 *      is the habit this enemy is built to punish;
 *   3. the vent panel goes on the back of the abdomen.
 *
 * The remap rides four systems that were already region-aware and gets all four
 * right for free: the vent pays the 100 crit bounty instead of the 60 body one
 * (main.js payout), flashes the body at 1.35 instead of 1.0 (mummy.js hurt),
 * throws the heavier ejecta (systems/impacts.js), and fires the crit hitmarker.
 * Nothing outside this file had to learn what a gold scarab is.
 */
function buildGoldScarab(spec, mats, actor) {
  const rig = buildScarab(spec, mats, actor);

  // Found by material rather than by index into rig.meshes. The abdomen is the
  // only DIRECT mesh child of the body wearing wrapDark - the shell beside it
  // is accent, and every femur that shares the material hangs off a hip group
  // one level down - so this is a narrow assumption instead of a positional
  // one, and it breaks loudly rather than silently if buildScarab is rebuilt.
  let abdomen = null;
  for (const child of rig.body.children) {
    if (child.isMesh && child.material === mats.wrapDark) { abdomen = child; break; }
  }
  if (!abdomen) {
    throw new Error('goldscarab: buildScarab no longer hangs the abdomen off the body as a wrapDark mesh');
  }

  abdomen.material = mats.deep;
  abdomen.userData.region = 'head';

  for (const m of rig.neck.children) {
    if (m.isMesh) m.userData.region = 'body';
  }

  const vent = new THREE.Mesh(goldVentGeometry(spec.proportions), mats.eye);
  vent.userData.enemy = actor;
  vent.userData.region = 'head';
  abdomen.add(vent);

  // Pushed into rig.meshes because that array is not a manifest, it is driven:
  // the spawn path re-shows every mesh in it and the quality setting rewrites
  // castShadow across it. A mesh outside it is a mesh that stays hidden after
  // the first death.
  rig.meshes.push(vent);
  rig.triangles += vent.geometry.attributes.position.count / 3;
  rig.vent = vent;

  return rig;
}

/**
 * The scarab's scuttle, plus a stance and a crit reaction.
 *
 * The stance is the read: a permanent 0.10 rad nose-down carries the front
 * plate toward the player and tips the vent up off the floor, so the panel is
 * visible from behind at standing eye height instead of only from a crouch.
 *
 * UNDOING THE BASE ANIMATOR'S SKULL RECOIL WAS TRIED AND REJECTED. animateScarab
 * spends its s.hitHead term on the neck, on the reasonable assumption that a
 * crit means a shot to the face; on this variant a crit is a shot to the far end
 * of the body. Subtracting exactly that term would mean hard-coding two literals
 * out of the function above into the function below, which is a maintenance trap
 * for a gain of nothing - a beetle whose back panel has just been opened up
 * snapping its head is a whole-body reaction and is not wrong. So the crit adds
 * a buck and takes nothing away.
 */
function animateGoldScarab(rig, spec, s) {
  animateScarab(rig, spec, s);

  rig.body.rotation.x += 0.10;

  const crit = (s.hit || 0) * (s.hitHead || 0);
  if (crit <= 0) return;

  // Nose down and the abdomen kicks up, which is the same axis the wind-up
  // already uses in the opposite direction - so a vent hit reads as the exact
  // inverse of the telegraph, and the two can never be confused.
  rig.body.rotation.x += crit * 0.30;
  rig.body.position.y -= crit * 0.02;
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

  // Charred rather than black. The husk has to be visibly DARKER than the
  // shambler, which is what says burnt, and it still needs a lit half or it
  // becomes the same flat cut-out the shambler was corrected out of being.
  palette: {
    wrap: 0x7a674a,
    wrapDark: 0x453623,
    deep: 0x211810,
    // Live coals in the sockets, warmer and a shade brighter than the
    // shambler's. On a fast enemy the tell has to survive being seen for a
    // fifth of a second, and it is still two recessed squares under a brow.
    eye: 0xff5a18,
    accent: 0x8a6a34,
  },

  proportions: {
    hipY: 0.86, hipW: 0.24, bodyD: 0.19,
    legX: 0.10, legW: 0.11, thighL: 0.42, shinL: 0.44,
    torsoY: 0.12, chestW: 0.30, chestH: 0.50,
    // Arms nearly as long as the legs. A hand that hangs below the knee is the
    // single cheapest signal that a body is wrong - and now that the forearm
    // actually ENDS in a hand, the signal is available rather than implied.
    //
    // The shoulders go out and the skull comes in for the same reason they do
    // on the shambler: head over span was 0.19 against 0.51, and 37 per cent is
    // a toy. At 0.175 over 0.54 it is 32, which is a starved human.
    shoulderX: 0.195, shoulderY: 0.46, armW: 0.095, upperL: 0.50, foreL: 0.52,
    headY: 0.60, headW: 0.175, headH: 0.34, headD: 0.225,
    tatterRest: 0.46,
    // Two rags, both trailing off the spine and one arm, and no hem. Desiccated
    // rather than wrapped: the husk has burned out of most of its bindings, and
    // the near-bare outline is half of why it does not read as a small
    // shambler. What is left streams behind it when it runs.
    //
    // Widened from 12 and 9 cm, which at the range a husk is first seen at was
    // sub-pixel, on the one enemy whose whole budget is being READ EARLY. The
    // spine is already pitched 26 degrees forward, so a long rag off the
    // shoulder blade streams behind the run on its own.
    tatters: [
      { on: 'torso', x: -0.06, y: 0.28, z: -0.13, w: 0.25, h: 0.96, yaw: 0.26, cut: 1, swing: 1.7, out: 0.20 },
      { on: 'arm', side: -1, x: -0.02, y: -0.32, z: 0, w: 0.20, h: 0.62, yaw: -1.0, cut: 2, swing: 1.9, out: 0.26 },
    ],
  },

  gait: {
    // `rate` is a MULTIPLIER on a derived cadence now, not the cadence itself.
    // See strideRate in mummy.js: the clock is set by how far this body's legs
    // reach and how fast it is travelling, so 1.0 means "no foot slip" and
    // anything else is a deliberate character note paid for in skating.
    rate: 1.0,
    // Longer as well as faster. A husk at four metres a second on a 0.85 swing
    // was taking two and a half strides a second to keep up with itself; the
    // longer reach buys a stride you can read at fifteen metres.
    stride: 0.98,
    armSwing: 0.55,
    // Hanging, not reaching. The spine is already pitched 35 degrees forward,
    // so arms that hang straight down off it end up ahead of the feet on their
    // own - which is the read, and it is the opposite of the shambler's.
    armReach: 0.18,
    armSplay: 0.20,
    // Barely bent. The husk's arms are long and dead-straight, swinging off a
    // spine that is already pitched forward; a fold at the elbow would give it
    // the shambler's reach, which is the one silhouette it must not share.
    elbowBend: -0.10,
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
    wrap: 0xa2946f,
    wrapDark: 0x60513a,
    deep: 0x2b2218,
    eye: 0x6ab4ff,
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
    tatterRest: 0.30,
    // A heavy hem and two long ceremonial wraps. Slower and wider than the
    // shambler's, so the rags read as weight rather than as decay - and wide
    // enough now to be the thing that tells a Bound from a shambler at the far
    // end of a gallery, where the shoulder slabs have already merged with the
    // torso and the height difference is a guess.
    tatters: [
      { on: 'torso', x: -0.04, y: -0.08, z: -0.04, w: 0.50, h: 0.66, yaw: 0.10, cut: 0, swing: 0.5, out: 0.08 },
      { on: 'torso', x: -0.36, y: 0.22, z: -0.22, w: 0.25, h: 1.04, yaw: 0.40, cut: 1, swing: 0.6, out: 0.24 },
      { on: 'torso', x: 0.36, y: 0.16, z: -0.22, w: 0.22, h: 0.86, yaw: -0.44, cut: 2, swing: 0.6, out: 0.22 },
    ],
  },

  gait: {
    // `rate` is a MULTIPLIER on a derived cadence now, not the cadence itself.
    // See strideRate in mummy.js: the clock is set by how far this body's legs
    // reach and how fast it is travelling, so 1.0 means "no foot slip" and
    // anything else is a deliberate character note paid for in skating.
    rate: 1.0,
    // THE BIGGEST SINGLE NUMBER IN THIS PASS. At 0.34 the Bound's feet
    // delivered 1.37 m of ground per stride while the body crossed 4.43 -
    // SIXTY-NINE PER CENT of every step was the sand running underneath it, and
    // a two-and-a-half-metre monolith on castors is the least convincing thing
    // in the level. Doubled, so it takes long, slow, heavy strides instead of
    // shuffling along a rail.
    stride: 0.70,
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
    wrap: 0x5a4630,
    wrapDark: 0x3a2c1c,
    deep: 0x241a10,
    eye: 0xd06a12,
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

/**
 * The gold scarab: the swarm, plated, and soft only from behind.
 *
 * THE PROBLEM IT IS BUILT AGAINST. By wave fifteen the player has one answer to
 * everything - backpedal in a circle and hold fire - and it works because every
 * enemy in the roster is happy to be shot in the face while it follows. More
 * health does not challenge that habit, it just makes the circle longer. So
 * this variant moves the only soft panel on its body to the BACK, which makes
 * the habit itself the wrong play: a player who keeps backing away is aiming at
 * plate and paying 2.6x the rounds for it, and the only way to pay scarab
 * prices is to break the circle, get past the thing, and shoot it from behind.
 *
 * It is a scarab and not a new species: same rig, same proportions, same tripod
 * scuttle. One `scale` makes it bigger and every derived quantity - reach,
 * separation, actor height - follows from that, which is why nothing in the
 * proportions record is overridden.
 *
 * The key is `goldscarab` and not `gilded` on purpose. It is read at exactly two
 * call sites, both in the director's tables, and next to the literal `scarab`
 * in the same object it says what it is without anyone opening this file.
 */
export const GOLD_SCARAB = extend(SCARAB, {
  id: 'goldscarab',
  name: 'Gold Scarab',

  // 2.59x a shambler's 85, and that ratio is where the number comes from rather
  // than from feel. TTK against a body is health / weapon damage, so from the
  // FRONT this costs 2.59 shamblers' worth of rounds with any gun on the table,
  // and through the vent - crits run 2.0 to 2.6 - it lands back at roughly ONE
  // shambler. The flank is not a bonus, it is the price of admission, and the
  // player who pays it gets ordinary trash-mob time-to-kill back.
  health: 220,
  // UNDER the player's 5.4 walk, where the scarab's 5.0 is only just under it.
  // This is not a mercy: an enemy the player cannot get around is an enemy with
  // no back, and the back is the entire design. A gold scarab has to be
  // outpaceable on foot or the mechanic is decoration.
  speed: 3.9,
  accel: 7.5,
  // THE LOAD-BEARING NUMBER. Circling only reaches the vent if the player can
  // out-rotate the body, and angular rate is lateral speed over range: at a walk
  // the player beats 1.9 rad/s inside about 2.8 m and loses to it further out.
  // So the flank costs a commitment to closing to bite range, which is where the
  // 14 damage is waiting. The scarab's 6.5 rad/s snaps to face you from anywhere
  // and would make the whole variant unflankable.
  damage: 14,
  turn: 1.9,
  attackRange: 1.35,
  // Slower than the scarab's 0.22 because the damage more than doubled and the
  // rear-up telegraph is the only tell this rig has; a 0.36 wind-up is about two
  // and a half of the player's reaction windows, so getting bitten inside the
  // flank is a decision rather than a tax.
  windup: 0.36,
  strikeTime: 0.26,
  cooldown: 1.05,
  // The plate eats the flinch. At the scarab's 1.8 a player can chip-fire into
  // the front and stall the approach indefinitely, which is a second way to win
  // by backing up and is exactly what this enemy exists to close off. Not the
  // Bound's 0.25 - that is a wall and this is a swarm member that still visibly
  // rocks when it is hit, otherwise front hits read as not registering at all.
  staggerTake: 0.55,

  // One number, and everything scales off it: the actor multiplies height,
  // radius, attackRange and sepRadius by it. Restated below rather than left
  // implicit because the separation radius is the one that gets got wrong.
  scale: 1.18,
  height: 0.55,
  radius: 0.30,
  // THE SCARAB'S, UNCHANGED, and it must stay that way. The swarm's separation
  // is half the humanoids' so a clutch flows around a pillar as a mass instead
  // of queueing behind it; 0.55 through the 1.18 scale is an effective 0.65
  // against the humanoids' 1.05, which keeps the pack a pack. A gold scarab that
  // spread out like a shambler would give the player lanes to back down.
  sepRadius: 0.55,
  voicePitch: 1.5,

  palette: {
    // Gold, and metal rather than a yellow-painted object: mummy.js reads
    // accentMetal into metalness and accentRough into roughness on the accent
    // material, which is the shell and the jaws. The Bound sits at 0.88 / 0.34
    // and the gods at 0.85 / 0.30; this goes crisper than both because a
    // carapace is polished where gilded wood is not.
    //
    // 0.26 IS THE FLOOR, not a preference. The interior is lit by two point
    // lights over a low environment intensity, and a metal below about 0.2
    // roughness in that scene has almost nothing to reflect between its
    // specular hits - it renders as a black shell with two bright spots, which
    // is the same value-crushed failure the base linen was corrected out of.
    accent: 0xe8bf55,
    accentMetal: 0.90,
    accentRough: 0.26,
    // The legs and the skull go DARKER than the scarab's, so the gold shell is
    // the only bright mass on the body and the outline at range is a single
    // hovering plate. `deep` also paints the abdomen on this variant, which is
    // what makes the crit panel read as a hole in the armour.
    wrapDark: 0x33291a,
    deep: 0x1c150d,
    // COLD, on a gold body, and that is the tell. The scarab's 0xd06a12 is warm
    // orange, which against 0xe8bf55 plate is one value at fifteen metres and
    // the vent would disappear into the thing it is cut into. The Bound already
    // taught this player that a cold socket means armoured - it has had blue
    // eyes since wave ten - so the vocabulary is one they have had five waves to
    // learn rather than one being invented here.
    eye: 0x63e0ff,
  },

  /**
   * IT DOES NOT STAY ON THE FLOOR, and this flag is the whole of the opt-in.
   *
   * THE SECOND HALF OF THE SAME PROBLEM. The block at the top of this record
   * says the player's one answer by wave fifteen is to backpedal in a circle
   * and hold fire, and the vent on the back breaks the "hold fire" half. It
   * leaves the other half alone: every body in the roster still arrives along
   * the floor, so the player's SEARCH is a horizontal sweep at eye level and
   * that sweep is still complete. A gold scarab that can be on the wall behind
   * them or on the ceiling over them is the first thing in the game the sweep
   * does not find.
   *
   * THE SCARAB DOES NOT GET IT, deliberately. The swarm is the wave's floor
   * pressure and it works because it is a mass flowing round a pillar; six of
   * them on three different surfaces is not a harder swarm, it is an unreadable
   * one. This is an elite's trick and it stays the elite's.
   *
   * Read only by mummy.js, which allocates a crawl record for any spec carrying
   * it and takes one untaken branch per frame for every spec that does not. The
   * behaviour itself is enemies/wallcrawl.js, which is also where the argument
   * for every number in it lives.
   *
   * IT IS FREE ON THE EXTERIOR AND THAT IS CORRECT. `ctx.walls` is only
   * populated for the interior's room shells; in the courtyard and the quarry
   * there is nothing to mount and this variant is exactly the enemy it was
   * before. The trick belongs to the rooms.
   */
  wallCrawl: true,

  gait: {
    // Slower and longer than the scarab's 2.2 / 0.45. Twice the mass on the same
    // legs does not take the same steps, and the heavier cadence is the cue that
    // separates a gold from the ordinary scarabs it spawns alongside - before
    // hue is available, which at range it is not.
    rate: 1.55,
    stride: 0.60,
  },

  build: buildGoldScarab,
  animate: animateGoldScarab,
});

/** Every variant the director may draw from, base included. */
export const VARIANTS = {
  shambler: MUMMY,
  husk: HUSK,
  bound: BOUND,
  scarab: SCARAB,
  goldscarab: GOLD_SCARAB,
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
  // FIFTEEN, and the gap is the argument. The schedule is 1, 4, 6, 10 - four
  // introductions in the first ten waves and then nothing at all for the fifteen
  // that follow, which is the complaint: the second half of the run is the first
  // half with a bigger health multiplier. Five waves after the Bound continues
  // the spacing the table already has, and it lands on a boss wave, so the
  // first gold scarab walks out on the wave the player is already braced for.
  //
  // It cannot come earlier than about 12 without being unfair. The crit window
  // in systems/damage.js keeps headshots lethal through wave 6 and the whole
  // point of this enemy is that the head is not the crit, so it needs to arrive
  // well clear of the waves that were teaching the opposite lesson.
  goldscarab: 15,
};

export { buildHumanoid, animateHumanoid };
