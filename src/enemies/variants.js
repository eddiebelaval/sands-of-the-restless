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
// the censer: a humanoid that carries one thing the roster has never carried
// ---------------------------------------------------------------------------

/**
 * The censer, and it is the whole silhouette.
 *
 * THE ONE RULE AT THE TOP OF THIS FILE applies here in its original form, unlike
 * the gold scarab, which was the deliberate exception. This body has to be
 * telling at twenty metres before its colour or its behaviour is available, and
 * a thin mummy is a mummy. So it carries a bronze bowl on a half-metre chain off
 * one hand, hanging BELOW the fist and OUTSIDE the leg line, with a coal in it.
 * Nothing else in the game has a mass that is detached from the body outline,
 * and a swinging offset blob is the one shape a horde silhouette cannot fake.
 *
 * SIZE, BY THE SAME ARITHMETIC THE VENT WAS SIZED BY. At the fifteen metres an
 * enemy is fought at, a metre is about 47 px in a 1000 px frame. The bowl at
 * 0.30 m across the actor's own 1.02 scale is 30.6 cm, or about 14 px, which is
 * the same on-screen size as the gold scarab's vent and for the same reason: it
 * is the thing the player is meant to find in the frame. The coal inside it is
 * 19 cm, about 9 px, and it is emissive, so it is the part that survives fog.
 *
 * The chain is 0.50 m so the bowl hangs half a metre under the hand. With the
 * forearm hanging off a shoulder at 0.50 of body height that puts the bowl at
 * roughly knee height and, through the arm splay, clear of the thigh - which is
 * what makes it part of the OUTLINE rather than a detail drawn over the torso.
 * A 0.25 m chain was tried on paper and rejected for the same reason the
 * shambler's rags were moved outboard: a mass inside the silhouette does not
 * change the silhouette.
 */
const CGEO = new Map();

function censerGeometry(P) {
  let out = CGEO.get(P);
  if (out) return out;

  const T = WRAP_TILES;
  const chain = P.censerChain;
  const bowl = P.censerBowl;
  const bowlH = P.censerBowlH;
  out = {};

  {
    // Not a rendered chain. Three thousand links at 9 px is a grey smear, so
    // this is one thin bar on the dark material, which at range reads as the
    // gap between the hand and the bowl - and the gap is the information.
    const p = parts(T);
    p.box(0.035, chain, 0.035, { y: -chain * 0.5, chamfer: 0 });
    out.chain = p.build();
  }
  {
    // Wide at the rim, tapering hard to the base, with a lid slab over it. The
    // taper is what stops it reading as a bucket: a censer is a cup on a stem.
    const p = parts(T);
    p.box(bowl, bowlH, bowl,
      { y: -chain - bowlH * 0.5, top: 1.0, bottom: 0.42 });
    p.box(bowl * 0.82, 0.045, bowl * 0.82,
      { y: -chain + 0.03, top: 0.7, bottom: 1.0 });
    out.bowl = p.build();
  }
  {
    // The coal sits ABOVE the rim rather than down in the cup. Inside it, the
    // bowl walls occlude it from every angle except straight down, which is the
    // one angle the player never has.
    const p = parts(T);
    p.box(bowl * 0.62, 0.05, bowl * 0.62, { y: -chain + 0.075, chamfer: 0 });
    out.coal = p.build();
  }

  CGEO.set(P, out);
  return out;
}

/**
 * The humanoid, plus the thing in its hand.
 *
 * Built on buildHumanoid and then hung off, rather than forked, for the reason
 * buildGoldScarab wraps buildScarab: everything that makes this body different
 * is three meshes and a group, and a second copy of the leg rig to get them
 * would be two hundred lines of duplication to add one pivot.
 *
 * THE ARM IT HANGS FROM IS THE LEAD ARM, not a fixed side. buildHumanoid derives
 * `lead` per instance from the same random stream the asymmetry uses, and the
 * lead shoulder is the one that sits further out and further forward, so the
 * censer hangs off the wide side of the body. Picking side -1 outright would put
 * it against the near shoulder on half the instances and lose the clearance the
 * whole design is about.
 */
function buildCenser(spec, mats, actor) {
  const rig = buildHumanoid(spec, mats, actor);
  const G = censerGeometry(spec.proportions);

  const arm = rig.arms.find((a) => a.side === (rig.lead || 1)) || rig.arms[0];
  if (!arm) {
    throw new Error('censer: buildHumanoid no longer returns an arm list to hang a censer from');
  }

  // The hand end of the forearm. buildHumanoid parents the forearm to `elbow`
  // and the member runs from 0 down to -foreL in that frame, so this is the
  // fist, not the wrist, without the builder having to publish a hand joint.
  const pivot = new THREE.Group();
  pivot.position.y = -spec.proportions.foreL;
  arm.elbow.add(pivot);

  const hang = (g, mat) => {
    const m = new THREE.Mesh(g, mat);
    m.userData.enemy = actor;
    // 'body', not 'head'. This variant does not move the crit anywhere - that
    // is the gold scarab's idea and it is already in the game. A censer bowl
    // that paid the 100 bounty would be a second lesson competing with the one
    // this enemy exists to teach.
    m.userData.region = 'body';
    m.castShadow = true;
    pivot.add(m);
    // Pushed into rig.meshes because that array is driven, not a manifest: the
    // spawn path re-shows every mesh in it and setFidelity rewrites castShadow
    // across it. A mesh outside it is a mesh that stays hidden after the first
    // death. Same trap the gold scarab's vent had to avoid.
    rig.meshes.push(m);
    rig.triangles += g.attributes.position.count / 3;
    return m;
  };

  hang(G.chain, mats.wrapDark);
  hang(G.bowl, mats.accent);
  const coal = hang(G.coal, mats.eye);

  rig.censer = pivot;
  rig.censerArm = arm;
  /**
   * The coal's material, kept by reference so the animator does not have to go
   * looking for it every frame.
   *
   * IT IS mats.eye, WHICH IS ALSO THE SKULL'S SOCKETS, and that is deliberate
   * rather than a collision. makeMaterials builds one set per actor, so
   * brightening this brightens the coal AND the two sockets on this one body:
   * the whole enemy lights up as its ground charges, which is a bigger and more
   * findable read than a single 9 px ember, and it costs one property write.
   */
  rig.coalMat = coal.material;

  /**
   * How far along this body's ground charge is, 0 to 1, written by the DIRECTOR.
   *
   * The one field on this rig that nothing in enemies/ sets. The mechanic lives
   * in director.js because it is a question about the player's ground and the
   * stone between - see the block there - and the only thing the body owes it is
   * a place to show it. Initialised here so the animator never reads undefined
   * off a pooled actor that has not been driven yet.
   */
  rig.smoulder = 0;

  return rig;
}

/** Socket brightness at rest. makeMaterials builds mats.eye at exactly this. */
const COAL_DIM = 0.9;

/**
 * And at a full charge.
 *
 * 3.4 is a factor of 3.8 over the resting value, and the factor is the number
 * that was chosen rather than the absolute: the fog and the two point lights in
 * the interior flatten small absolute differences, and anything under about
 * triple was indistinguishable from the flicker the rest of the roster's sockets
 * already have. It is high, and the file's own warning about a 2.4 emissive
 * reading as a machine visor is the reason it is confined to a 19 cm coal and
 * two recessed squares rather than put on a bar across the face, and the reason
 * it is TRANSIENT: at rest this body is the dimmest thing in the roster.
 */
const COAL_LIT = 3.4;

/**
 * The walk, plus a censer that lags the hand carrying it.
 *
 * A censer on a chain is a pendulum with a moving pivot, and the single cue that
 * separates one from a lamp bolted to a fist is that it does NOT arrive when the
 * hand does. So the pivot cancels most of the arm's own rotation - which leaves
 * the bowl hanging plumb, the way gravity leaves it - and keeps 15 per cent,
 * which is the part that reads as the chain dragging the bowl after the swing.
 *
 * SUBTRACTING THE ARM RATHER THAN AUTHORING A POSE IS THE WHOLE TRICK, and it is
 * why this animator does not have to know what animateHumanoid did. The wind-up
 * raises both arms to WINDUP_ARM and the strike drops them through; both are
 * read back off the joints here, so the censer swings up on the telegraph and
 * scythes down through the follow-through for free, and it will keep doing so if
 * those poses are ever retuned.
 */
function animateCenser(rig, spec, s) {
  animateHumanoid(rig, spec, s);

  const arm = rig.censerArm;
  const pivot = rig.censer;

  // How far the hand has swung, in the torso's frame. The shoulder and the
  // elbow both rotate about x and the pivot inherits both.
  const carried = arm.shoulder.rotation.x + arm.elbow.rotation.x;

  // Its own slow pendulum on top, at 0.45 of the stride clock so it is visibly
  // NOT on the beat of the legs. A censer swinging in time with the feet reads
  // as one rigid body with a lump on it.
  const sway = Math.sin(s.phase * 0.45) * 0.20;

  pivot.rotation.x = -carried * 0.85 + sway;
  // Plumb sideways as well, so the splay that holds the bowl clear of the thigh
  // does not also tip it. The lateral sway is a quarter of the fore-aft one:
  // a hanging censer swings along the arc the arm swept, not across it.
  pivot.rotation.z = -arm.shoulder.rotation.z + sway * 0.25;

  rig.coalMat.emissiveIntensity = COAL_DIM + (COAL_LIT - COAL_DIM) * (rig.smoulder || 0);
}

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------

/**
 * Shallow merge one level down, which is all these records are ever nested.
 *
 * `sound` joined that list when the roster stopped sharing one throat, and it
 * had to: nearly every variant changes ONE thing about how it sounds - the husk
 * swaps its vocal tract and keeps the shambler's footsteps, ranges and cadences
 * - and without the merge each of those would be a full copy of the base block.
 * The copies would drift, and the half that drifted would be the half nobody
 * was listening to.
 *
 * `sound.step` is a level deeper and is NOT merged, so a variant that overrides
 * it states the whole thing. That is deliberate: a step block is four numbers
 * that only mean anything together, and half a step block is a stride with
 * somebody else's audible range on it.
 */
function extend(base, over) {
  const out = { ...base, ...over };
  for (const key of ['palette', 'proportions', 'gait', 'sound']) {
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

  /**
   * A different throat, and nothing else.
   *
   * The husk's whole design is READ EARLY - it arrives before the shamblers and
   * it punishes a reload - and that budget was spent entirely on the silhouette
   * and the ember sockets, both of which are useless when it is behind you. The
   * `husk` throat is the same argument in the other channel: formants an octave
   * above the shambler's, a third of the length, and a papery breath over the
   * top, so "something quick is coming" arrives by ear as well as by eye.
   *
   * Its steps, ranges and cadences are the shambler's, merged in. A husk is a
   * body with the same number of feet.
   */
  sound: { throat: 'husk', idleEvery: [3, 8] },

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

  /**
   * The `bound` throat: formants down into a closed vowel, a sub sine under
   * them, and nearly three seconds long. At 0.62 voicePitch the fundamental
   * lands near 30 Hz, which is felt rather than heard, and the sub is what puts
   * the mass back where a laptop speaker can actually move it.
   *
   * The stride is the only other change and it is not a preference: this body
   * walks at 1.32 m/s on legs 24 per cent longer than a shambler's, so 1.1 m a
   * step would have it taking more than one step a second at a shuffle. 1.7 m
   * is one slow deliberate footfall about every second and a third, which is
   * what the animation is already doing.
   */
  sound: {
    throat: 'bound',
    idleEvery: [6, 14],
    step: { name: 'footfall', stride: 1.7, range: 22, chance: 0.9 },
  },

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

  /**
   * THE SCARAB LEAVES THE THROAT ENTIRELY, AND THIS IS THE POINT OF THE WHOLE
   * TABLE.
   *
   * It named no `throat` and it never will. Every sound below is in
   * core/audio.js's chitin family, which contains no oscillator that could be
   * mistaken for a mouth: the step is a tripod of filtered noise transients, the
   * tell is stridulation - amplitude-modulated noise, which is what a file drawn
   * across a ridge actually is - and the death is a carapace coming apart. Play
   * any of them at any pitch and none of them can become a vowel, which is a
   * property of the synthesis and not of the tuning.
   *
   * WHAT THE STEP NUMBERS MEAN, because they are the ones that carry it:
   *
   *   stride 0.62 m. The cadence is metres covered, so this IS the rate: at
   *   its 5.0 m/s charge it patters eight times a second, and at the crawl of a
   *   staggered one it patters twice. Chosen off the rig - the animator runs a
   *   0.45 m stride on a tripod gait - and then opened up a little, because
   *   three taps land inside each step and the ear counts groups rather than
   *   feet.
   *
   *   range 22 m against the humanoids' 18. These are the quietest sounds in
   *   the game and the only ones a player is expected to navigate by; a swarm
   *   you cannot hear until it is on top of you is a swarm that arrives from
   *   nowhere.
   *
   *   near 11 / far 17. Past eleven metres every other step is dropped and past
   *   seventeen three in four. One scarab asks for eight steps a second and the
   *   director will put twenty-four of them on the floor, so without this the
   *   horde alone would ask for nearly two hundred voices a second against a cap
   *   of twenty-eight. Thinned nearest-first it lands inside the six-slot step
   *   pool with the gunshot untouched, and a distant patter reads as texture
   *   anyway.
   *
   * `pitch: 1` because a shell has no larynx. See say() in mummy.js.
   */
  sound: {
    throat: null,
    chitin: 'scarab',
    pitch: 1,
    idle: 'chitinRasp',
    idleEvery: [3, 9],
    idleRange: 20,
    attack: 'chitinRasp',
    attackPitch: 1,
    swipe: 'chitinRasp',
    death: 'shellCrack',
    step: { name: 'chitinStep', stride: 0.62, range: 22, chance: 1, near: 11, far: 17 },
  },

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

  /**
   * The same creature, plated, and it has to sound plated.
   *
   * `chitin: 'goldscarab'` swaps the shell table: the taps drop about an octave
   * and get longer because the leg hitting the stone is armoured and has mass
   * behind it, the gaps widen because the body is slower, and a genuine metallic
   * ring goes on top - two inharmonic partials, fifty to ninety milliseconds,
   * which is what gold plate over chitin does that bare chitin does not.
   *
   * THE STRIDE IS NOT A TASTE DECISION. This body is 1.18x a scarab and walks at
   * 3.9 m/s against its 5.0, so 0.82 m puts it at under five steps a second
   * where the scarab is at eight. A player who has learned the swarm's patter
   * hears a heavier, slower one and knows what walked in before it is in frame -
   * which is the same job the gold shell does at twenty metres, done in the
   * channel that works when it is behind you.
   *
   * AND IT IS THE ONE ENEMY THAT CAN BE OVERHEAD. `near`/`far` run wider than
   * the scarab's because there are never twenty-four of these, and the range
   * runs to 26 m because a body crossing a sixteen-metre gallery ceiling is
   * further away than any floor enemy ever gets while still being directly
   * above the player. The elevation cue that makes that legible is in
   * core/audio.js's skyward(); what this table has to get right is being
   * audible at all from up there.
   */
  sound: {
    chitin: 'goldscarab',
    idleEvery: [4, 10],
    idleRange: 24,
    step: { name: 'chitinStep', stride: 0.82, range: 26, chance: 1, near: 14, far: 20 },
  },

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
    /**
     * THE PARAGRAPH ABOVE DIAGNOSED IT AND STOPPED ONE STEP SHORT.
     *
     * It is right that a low-roughness metal in this room has nothing to
     * reflect, and 0.26 is the correct answer to the question it asked. The
     * question it did not ask is what 0.90 METALNESS costs in the same room: a
     * standard material's diffuse term is albedo x (1 - metalness), so the
     * shell keeps a tenth of its own gold under the two point lights and takes
     * the other nine tenths off an environment that systems/spaces.js pins at
     * 0.05 the moment the player steps inside. Roughness spreads a highlight;
     * it cannot conjure one.
     *
     * MEASURED, on the pixels the beetle itself covers, six metres in front of
     * the camera in the Hall of Offerings, against the wall behind it:
     *
     *     the shell        p50 luma 21.4
     *     the wall         p50 luma 53.8
     *
     * Two and a half times darker than the stone. That is the owner's "black
     * with blue eyes", and no adjustment to `accent`, `accentMetal` or
     * `accentRough` reaches it - dropping metalness to 0.55 was swept and lands
     * the shell at 59.4, which is the wall's own value and a different way to
     * disappear. The full table and the argument are on chamberGlow() in
     * mummy.js.
     *
     * So the two numbers above are UNCHANGED and this is added beside them: an
     * emissive floor on the accent, the same instrument EMISSIVE_FLOOR already
     * applies to the linen, applied to the one material that note explicitly
     * excluded because on every other body in the roster the accent is trim. On
     * this one it is the whole animal.
     *
     * 0.30 INDOORS, NOTHING OUTDOORS, and mummy.js reads `ctx.walls` to tell
     * them apart. It buys +68.9 luma of separation from the chamber wall and
     * takes the body from 6.3 per cent flat black to 5.5, while the courtyard -
     * where the owner agrees the beetle already reads - is left byte-identical.
     * A constant could not do both: 0.30 applied outdoors closes the sand's
     * separation from 61 luma to 4.7.
     *
     * IT DOES NOT FLATTEN THE SHELL, which was the risk and was checked rather
     * than assumed. Standard deviation across the body goes UP, 24.3 to 37.7,
     * because the floor lifts the crushed end into the range where the form is
     * visible at all. Saturation stays at 0.63 against the shipped 0.72, and
     * the mean channels come out 120 / 98 / 42 - a red-to-blue ratio of 2.9,
     * which is gold and not a bright grey.
     */
    accentEmissive: 0xe8bf55,
    accentGlow: 0.30,
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

/**
 * The Censer: the enemy that stops coming, and charges rent on the spot you
 * chose to stand.
 *
 * THE PROBLEM IT IS BUILT AGAINST, and it is the other half of the gold
 * scarab's. That variant assumed the player's answer by wave fifteen is to
 * backpedal in a circle and hold fire, and it broke the "hold fire" half by
 * putting the only soft panel on the back. What it does not touch is the answer
 * a player falls back on the moment a wave gets big: STOP CIRCLING, put a corner
 * or a doorway behind you, cover one approach, and let the horde come down one
 * lane. That works because every body in this game walks at the player and
 * therefore arrives in the one direction the player is already looking, so
 * holding an angle converts a room fight into a corridor fight for free.
 *
 * A Censer refuses the trade twice over.
 *
 *   IT DOES NOT ARRIVE. Its attackRange is 9.0, and enemies/mummy.js stops any
 *   body once it is inside 0.85 of its own reach - 0.85 x (9.0 x 1.02 + 0.42) is
 *   8.16 m - and freezes it again for the whole of every wind-up and swing, which
 *   begin at the full 9.60 m. So it creeps in during its cooldowns and settles in
 *   that 1.44 m band: measured against a pinned player it holds at 8.9 m, while a
 *   shambler released from the same 14 m closes to 1.75. It is the first thing in
 *   the roster that will not walk into the lane the player is covering, which
 *   means it cannot be answered by aiming down that lane.
 *
 *   AND STANDING STILL IN ITS SIGHT COSTS HEALTH. Everything above is posture;
 *   the mechanic is in director.js, because it is a question about the player's
 *   ground and about the stone between here and there, and neither of those is
 *   something a spec can express. The short version: ground a Censer can see,
 *   that the player has not left, begins to smoulder, and standing in it costs a
 *   small tick on a slow clock. Give up the spot, or break the line, and it goes
 *   out instantly. The full argument and every number is on updateCensers().
 *
 * SO IT IS NOT A BULLET SPONGE AND IT IS DELIBERATELY NOT DANGEROUS. It deals no
 * contact damage at all (see `damage` below), and it is the SOFTEST humanoid in
 * the game at 130. Killing one is easy. The point is where you have to be
 * standing to do it: it is at eight metres, in the open, off your corner, in the
 * direction you were not covering. The cost of the answer is the position, and
 * the position was the thing the player was defending.
 *
 * The key is `censer` rather than `priest` for the same reason the gold scarab's
 * is `goldscarab`: it is read at exactly three call sites, all of them the
 * director's tables, and it should say what the thing is without anyone opening
 * this file.
 */
export const CENSER = extend(MUMMY, {
  id: 'censer',
  name: 'The Censer',

  // UNDER the shambler's 150, and the lowest of any humanoid here. TTK against a
  // body is health over weapon damage, so this costs 0.87 of a shambler's rounds
  // with any gun on the table - the cheapest kill in a late wave. That is the
  // design and not a mercy: an enemy whose whole threat is that you have to walk
  // to it must be worth walking to, and a Censer that took gold-scarab rounds to
  // put down would make ignoring it the correct play.
  health: 130,
  // Between the Bound's 1.32 and the shambler's 2.25, and it wants to be the
  // LAST body to arrive. At 1.85 it crosses the 13 m minimum spawn band in seven
  // seconds while the shamblers ahead of it take five and the husks two and a
  // half, so by the time it plants, the player is already committed to a spot -
  // which is the state this enemy is written against.
  speed: 1.85,
  accel: 5.0,
  // The shambler's, unchanged, and it has to be at least that. This body's
  // threat is a LINE, so a Censer that could not keep its face on a moving
  // player would be answered by walking round it, which is the gold scarab's
  // counter-play and not this one's.
  turn: 3.2,

  /**
   * ZERO, AND IT IS THE POINT RATHER THAN AN OMISSION.
   *
   * systems/damage.js returns at `amount <= 0` before it touches health, trauma
   * or the red wash, so the attack block in mummy.js runs its whole wind-up,
   * swing and cooldown on this body and lands nothing. That is exactly what is
   * wanted: the swing is a TELEGRAPH, not an attack. It costs one no-op call per
   * cycle per Censer and it buys the arm pose, the audible swipe, and a two and
   * a half second metronome the player can read across a room, out of machinery
   * that already exists rather than out of a second damage path.
   *
   * A body that hits for nothing in melee is also the honest read of what this
   * thing is. Walk up to a Censer and it cannot touch you; it just keeps
   * swinging, at a spot you are no longer standing on.
   */
  damage: 0,
  /**
   * NINE METRES, AND IT IS A STANDOFF RANGE RATHER THAN A REACH.
   *
   * mummy.js zeroes a body's desired speed at 0.85 of `attackRange x scale +
   * playerRadius`, which here is 8.16 m, and re-opens it the moment the player
   * gets further away - so this number is not how far the thing can hit, it is
   * the ring it holds. Eight metres is chosen against the director's own
   * SPAWN_NEAR of 13: it is comfortably inside the distance a wave arrives from,
   * so a Censer plants in the room rather than in the doorway it came through,
   * and it is outside the 2.3 m the Bound reaches, so a player fighting the
   * horde in front of them is not incidentally standing next to it.
   */
  attackRange: 9.0,
  /**
   * ONE SWING IS 2.40 SECONDS, WHICH IS THE SMOULDER'S FILL TIME.
   *
   * 0.95 + 0.55 + 0.90. The period is deliberately the same as CENSER_FILL in
   * director.js so the visible swing runs at the rate the floor charges at, and
   * a player who has learned "one full swing is one tick" is right about the
   * cost of standing still.
   *
   * THEY ARE NOT LOCKED TOGETHER AND THIS IS NOT CLAIMING THEY ARE. The swing
   * runs whatever the player does; the charge only runs while the player holds
   * their ground, so the two drift apart the moment anybody moves. It is a rhyme
   * for the player's benefit, not a coupling, and wiring them would mean the
   * director reaching into an actor's attack clock to do it.
   */
  windup: 0.95,
  strikeTime: 0.55,
  cooldown: 0.90,
  // Lighter than the shambler's 1.0. This is the one enemy the player reads at a
  // fixed eight metres while it is standing perfectly still, and at that range a
  // flinch is the only motion on the body: a Bound's 0.25 here would make rounds
  // landing on it look like rounds passing through it.
  staggerTake: 1.3,

  // Tall and thin. Height comes out at 2.10 x 1.02 = 2.14 m against the
  // shambler's 1.88 and the Bound's 2.54, so it is the second tallest thing in
  // the horde - and paired with a chest two thirds the shambler's width it is
  // the only body here whose outline is a vertical line.
  scale: 1.02,
  height: 2.10,
  // Narrower than the shambler's 0.42, because the body is narrower. It also
  // keeps a planted Censer from becoming a pillar the horde queues behind.
  radius: 0.36,
  // The humanoids', untouched. A Censer stands still in a moving crowd, so its
  // separation is the only thing stopping the wave from walking through it, and
  // a smaller one would have shamblers clipping the body the player is aiming at.
  sepRadius: 1.05,
  // Below the shambler's 1.0 and above the Bound's 0.62. The groan that opens
  // every wind-up is this enemy's off-screen tell, and it has to be tellable
  // from the bodies actually in front of the player.
  voicePitch: 0.80,

  /**
   * JUDGED AND KEPT VOCAL, BUT IT IS NOT A GROAN.
   *
   * The question on this variant was whether it belongs in the throat at all,
   * and the answer is yes for a reason that is specific to it: this is the only
   * enemy in the game that STANDS STILL AND WATCHES, and its threat is a line of
   * sight from somewhere the player is not looking. A tell has to travel across
   * a room, over the bodies in front of the player, and be identifiable as
   * coming from a thing rather than from the building - which is a voice's job
   * and not a transient's.
   *
   * So it is a voice, and it is a CHANT. The `censer` throat holds its note
   * where every other one sags, wavers on a slow vibrato, and runs narrow
   * high-Q formants low down - a closed, nasal intonation. The steadiness is
   * the cue the ear gets first: long before it resolves the timbre it has
   * already heard that this one is not dying, it is singing. Nothing else in
   * the horde does that, which is exactly what an off-screen tell needs.
   *
   * It also gets the longest interval and the longest reach in the roster. It
   * plants at eight metres and stops, so it is a landmark rather than an
   * approach, and a landmark that speaks every four seconds is a nuisance.
   */
  sound: {
    throat: 'censer',
    idleEvery: [7, 15],
    idleRange: 30,
    step: { name: 'footfall', stride: 0.85, range: 16, chance: 0.45 },
  },

  palette: {
    /**
     * DARKER THAN THE SHAMBLER, ON THE GOLD SCARAB'S ARGUMENT AND NOT ON A WHIM.
     *
     * The coal is the read on this body, so it has to be the only bright mass on
     * it. 0x6e6455 is 0.71 of the shambler's 0x9a8a6e per channel, which is a
     * shade under one stop - NOT the two-stop overshoot the base linen was
     * corrected back from, and the internal value RANGE that the note on the
     * base palette says is the thing that reads at distance is preserved
     * exactly: wrapDark sits at 0.55 of wrap here against the shambler's 0.59,
     * so this body still has a lit half to lose into a crease.
     */
    wrap: 0x6e6455,
    wrapDark: 0x3d382e,
    deep: 0x1c1a15,
    /**
     * PALE GREEN, WHICH IS THE ONE HUE THE ROSTER HAS NOT USED.
     *
     * Shambler amber 0xffae3c, husk ember 0xff5a18, scarab orange 0xd06a12,
     * Bound blue 0x6ab4ff, gold scarab cyan 0x63e0ff. Five enemies across two
     * families of warm and cold, and green is unclaimed - so a green light in a
     * chamber is unambiguous the first time it is seen, which matters more here
     * than on any other variant because the coal is both the identity cue AND
     * the state readout. It is burning natron, and it is the same colour as the
     * thing the player will shortly be standing in.
     */
    eye: 0x8fe07a,
    // Tarnished bronze rather than the shambler's gilding. Crisper than the
    // linen and duller than the Bound's 0.88 / 0.34 ceremonial gold: this is a
    // working censer carried by a servant, not grave goods.
    accent: 0x7d6a3a,
    accentMetal: 0.75,
    accentRough: 0.42,
  },

  proportions: {
    // hipY is not free: it must equal thighL + shinL or the feet leave the sand.
    // Both legs are longer than the shambler's 0.44 / 0.48, which is where the
    // height goes - a tall enemy built by scaling the whole body up reads as a
    // shambler seen from closer.
    hipY: 1.04, hipW: 0.28, bodyD: 0.21,
    legX: 0.11, legW: 0.13, thighL: 0.50, shinL: 0.54,
    // A chest 0.36 against the shambler's 0.46. The taper in the builder runs
    // 1.0 at the shoulder to 0.66 at the waist either way, so a narrow chest
    // narrows the whole trunk rather than just the top of it.
    torsoY: 0.14, chestW: 0.36, chestH: 0.62,
    // Shoulders in as well, to 0.24. buildHumanoid puts a deltoid over the joint
    // and the span comes out about 2.77 x shoulderX, so 0.665 here; the head at
    // 0.195 is 29 per cent of it, which sits inside the quarter-to-a-third band
    // the base spec's note says reads as a person. Dropping the shoulders
    // without dropping the skull is how a thin body becomes a bobblehead.
    shoulderX: 0.24, shoulderY: 0.50, armW: 0.115, upperL: 0.42, foreL: 0.44,
    headY: 0.66, headW: 0.195, headH: 0.26, headD: 0.235,

    // What hangs off the hand. See censerGeometry for why each is this size.
    censerChain: 0.50,
    censerBowl: 0.30,
    censerBowlH: 0.26,

    tatterRest: 0.34,
    // TWO, both long, both off the shoulders, and no hem. The shambler's hem
    // breaks the two-legs-in-a-box outline, which is the right fix for a body
    // whose problem is that it is a box; this body's outline is a vertical line
    // and a hem across the hips would widen exactly the thing that makes it
    // readable. So the wraps fall the full length of the trunk instead, and the
    // silhouette they make is a stick with a bright bowl swinging off it.
    tatters: [
      { on: 'torso', x: -0.20, y: 0.30, z: -0.16, w: 0.22, h: 1.12, yaw: 0.44, cut: 1, swing: 0.5, out: 0.22 },
      { on: 'torso', x: 0.20, y: 0.28, z: -0.16, w: 0.20, h: 1.04, yaw: -0.40, cut: 2, swing: 0.5, out: 0.20 },
    ],
  },

  gait: {
    // A multiplier on the derived cadence, not the cadence. 1.0 means no foot
    // slip; see strideRate in mummy.js.
    rate: 1.0,
    // Shorter than the shambler's 0.62 on legs that are 13 per cent longer, so
    // it covers its 1.85 m/s in small deliberate steps rather than in strides.
    // A slow body taking long strides reads as heavy; this one is a procession.
    stride: 0.58,
    // Almost nothing. Both hands are occupied - one carrying, one steadying -
    // and an arm swing on this body would throw the censer around on a rig that
    // is trying to sell it as a pendulum with weight in it.
    armSwing: 0.10,
    // Held low and only just forward. The shambler's -0.95 is the arms-out
    // undead pose and it is the one silhouette this body must not share, because
    // an outstretched arm puts the hand - and therefore the censer - inside the
    // torso outline from head on, which is the angle the player has most.
    armReach: -0.30,
    armSplay: 0.34,
    // POSITIVE, unlike every other humanoid in the file. The animator applies
    // -elbowBend, so this folds the forearms up and forward into a carrying
    // pose, which is what puts the fist out past the thigh and hangs the bowl in
    // clear air.
    elbowBend: 0.55,
    /**
     * THE ONLY BODY IN THE GAME THAT IS NOT HUNCHED.
     *
     * Negative lean hunches the chest forward over the hips: the shambler runs
     * -0.24, the husk -0.46, the Bound -0.05. A small POSITIVE value stands this
     * one up and arches it slightly back, and at the twenty metres where the
     * censer is still a smudge, upright against a field of stooped bodies is the
     * cue that arrives first. Kept to 0.04 because past about a tenth of a radian
     * it stops reading as bearing and starts reading as a fall.
     */
    lean: 0.04,
    sway: 0.06,
    hipTwist: 0.05,
    bob: 0.04,
    headLoll: 0.06,
    // Chin UP, which on this rig is a positive droop. Every other humanoid here
    // shuffles toward the player with its head down; this one watches. That is
    // literally correct for the only enemy whose threat is its line of sight,
    // and it is a second silhouette cue on the same axis as the lean.
    headDroop: 0.10,
  },

  build: buildCenser,
  animate: animateCenser,
});

/** Every variant the director may draw from, base included. */
export const VARIANTS = {
  shambler: MUMMY,
  husk: HUSK,
  bound: BOUND,
  scarab: SCARAB,
  goldscarab: GOLD_SCARAB,
  censer: CENSER,
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
  /**
   * TWENTY, and it is the same argument the entry above makes, continued.
   *
   * The shipped schedule was 1, 4, 6, 10 and then nothing for fifteen waves of a
   * twenty-five wave run. The gold scarab put an introduction at 15; this puts
   * one at 20, which keeps the five-wave spacing the table now has from wave ten
   * onward, and lands it on a boss wave for the same reason 15 did - the first
   * Censer walks out on a wave the player is already braced for, so a new body in
   * the frame is a development rather than an ambush.
   *
   * IT MUST COME AFTER THE GOLD SCARAB AND NOT BEFORE. Both of these teach the
   * same sentence in two different axes: the gold scarab says keep moving AROUND
   * a body, this one says keep moving OFF a spot. Taught in that order the second
   * reads as the general case of the first. Taught in the other order the player
   * meets an enemy that punishes standing still, learns to circle harder, and is
   * then handed an enemy that punishes circling - which is a contradiction rather
   * than an escalation.
   */
  censer: 20,
};

export { buildHumanoid, animateHumanoid };
