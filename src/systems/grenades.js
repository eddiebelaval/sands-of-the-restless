/**
 * Grenades: cook, throw, bounce, detonate.
 *
 * The whole mechanic is one wager. The fuse starts when the pin comes out, not
 * when the thing leaves your hand, so holding it is a real bet against a real
 * clock: cook it and it goes off where you wanted it, cook it too long and it
 * goes off where you are standing. A grenade without that is a thrown rock with
 * a delay on it, and the delay is the least interesting part.
 *
 * FOUR THINGS THIS FILE OWNS, and they are separated because each fails on its
 * own and each fails silently:
 *
 *   1. THE ARC. Camera direction plus a lift, gravity, and bounces that lose
 *      energy so the thing comes to REST rather than sliding out of the room.
 *      A grenade that never settles is a grenade the player cannot place.
 *   2. THE BLAST. Falloff from a lethal centre to a survivable edge, blocked by
 *      geometry, and applied to the horde AND to the player through the same
 *      curve. A grenade that cannot hurt you is not a risk, it is a button.
 *   3. THE EVENT. Flash, light, dust, shockwave, and a synthesised report that
 *      goes through the room's own convolver, so a detonation in the Great
 *      Gallery tails and one in a corridor slaps. An explosion that is correct
 *      in state and invisible on screen has not happened.
 *   4. THE SUPPLY. Two in the pouch, four in the pocket, one back per wave. See
 *      the economy note at ECONOMY below.
 *
 * COLLISION USES THE WORLD THE REST OF THE GAME USES and nothing else: the flat
 * array of `{x, z, r, h}` cylinders on `world.colliders`, the axis-aligned wall
 * boxes on `world.walls` that the interior hands over, `world.heightAt` for the
 * floor, and `world.bounds` for the perimeter. There is no second collision
 * representation here and there must never be one, because the moment a grenade
 * resolves against something the player does not, the two disagree about where
 * the room is and the player is the one who finds out.
 *
 * THE PUSH-OUT RESOLVES ONE COLLIDER AT A TIME, DELIBERATELY. enemies/mummy.js
 * has an avoidance probe that SUMS a sideways push per collider, which means two
 * overlapping discs either side of a heading cancel to exactly zero and the
 * actor walks straight into the crease between them. A bounce built the same way
 * would pass through the corner of every doubled wall run in the map. So each
 * pass finds the DEEPEST overlap and reflects off that one surface, then looks
 * again - three passes, which is one more than the player controller needs and
 * one fewer than any geometry in this map has ever wanted.
 *
 * POOLED. Grenades, explosion fixtures, and the hit records handed to the damage
 * system are all allocated at construction. A throw writes numbers into a record
 * that already exists; a detonation writes numbers into fixtures that are
 * already in the scene. The one exception is Web Audio, where a one-shot IS a
 * short-lived graph of nodes - core/audio.js allocates the same way for the same
 * reason, and every node here is disconnected on `onended`.
 *
 * ---------------------------------------------------------------------------
 * WIRING
 * ---------------------------------------------------------------------------
 *
 * Self-contained. It does not reach into the frame loop, the viewmodel, or the
 * HUD, and it does not need to: cooking, the throw, the fuse, the damage, the
 * payout, the effect, and the supply all happen inside update().
 *
 * main.js, four lines:
 *
 *   1. import { createGrenades } from './systems/grenades.js';
 *
 *   2. after `combat.attach({ director })`, because it needs both:
 *
 *        const grenades = createGrenades({
 *          scene, camera, world, player, rig, audio, impacts,
 *          combat, economy, director, spaces,
 *          notice: (text, ms) => showNotice(text, ms),
 *        });
 *
 *      `combat` is passed AFTER main.js has replaced combat.damagePlayer with
 *      the Anubis intercept, and this module calls it as a property lookup, so
 *      the free death covers blowing yourself up. That is deliberate.
 *
 *   3. in setFidelity(), beside impacts:   grenades.setFidelity(high);
 *
 *   4. in frame(), between the director and combat:
 *
 *        director.update(dt, elapsed);
 *        grenades.update(dt, input.state);
 *        combat.update(dt);
 *
 *      AFTER the director so a blast measures this frame's bodies, and BEFORE
 *      combat.update so the red wash from taking your own frag reaches
 *      post.setDamage on the frame it happened rather than the frame after.
 *
 * core/input.js publishes `state.grenade` - KeyG, HELD - and that is already
 * done. No other file has to change for the mechanic to work.
 *
 * OPTIONAL, and both belong to other files:
 *
 *   ui/hud.js reads `grenades.count` (0..4, a row of pips) and `grenades.cook`
 *   (0..1, a ring that fills; at 1 it kills you). Neither is required.
 *
 *   player/viewmodel.js would want three calls - cookGrenade(), throwGrenade(),
 *   cancelGrenade() - and the timing this module implies is in the note above
 *   release(). Nothing here calls them; the mechanic is complete without the
 *   hand, and the hand can be added without touching this file.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** Seconds from pin to bang. The clock does not care whose hand it is in. */
const FUSE = 3.4;

/**
 * Physical radius of the shell, used for the ground and collider offsets.
 * Smaller than it looks so it settles into corners rather than hovering off
 * them.
 */
const R = 0.085;

/** Gravity. Deliberately heavier than a real 9.8: the arc has to be readable
 * inside a fifteen-metre throw, and a shallow one is not. */
const GRAVITY = 22;

/** Launch speed along the camera axis, and the lift added on top of it. */
const THROW_SPEED = 17.5;
const THROW_RISE = 3.4;

/** How far in front of the eye the shell leaves the hand. */
const THROW_FORWARD = 0.55;
const THROW_DROP = 0.14;

/** Fraction of the normal velocity kept across a bounce, and of the tangential. */
const RESTITUTION = 0.34;
const TANGENT_KEEP = 0.62;

/** Rolling friction while in contact with the floor, per second. */
const ROLL_DAMP = 2.8;

/** Below this speed, in contact, for this long, the shell is asleep. */
const SLEEP_SPEED = 0.55;
const SLEEP_TIME = 0.14;

/** Largest distance one integration substep may cover. Tunnelling insurance. */
const MAX_STEP = 0.14;

// --- the blast -------------------------------------------------------------

/** Inside this radius the blast is at full strength. */
const INNER = 2.4;

/** Outside this radius there is no blast at all. */
const OUTER = 7.0;

/**
 * Damage at the centre and at the outer edge.
 *
 * 260 kills a wave-one shambler (150) outright and takes a wave-eight one (307)
 * to a sliver; it also kills the player from full, which is the entire point of
 * cooking being a bet. 18 at the rim is a scratch. Solving the curve for 100 -
 * a full-health player - puts the survival line at 4.6 m, which is close enough
 * to the reference game that muscle memory transfers.
 */
const BLAST_MAX = 260;
const BLAST_EDGE = 18;

/** Falloff exponent. Above 1 the lethal core is tight and the rim is long. */
const FALLOFF = 1.7;

/** Height above the shell that the blast is centred on. */
const BLAST_LIFT = 0.35;

/** A collider shorter than this does not shadow a blast. */
const COVER_HEIGHT = 0.9;

/** Occlusion sampling: step, and how far from each end to stop looking. */
const COVER_STEP = 0.42;
const COVER_SKIP_NEAR = 0.5;
const COVER_SKIP_FAR = 0.45;

// --- ECONOMY ---------------------------------------------------------------

/**
 * Two to start, four in the pocket, one back at the top of every wave after the
 * first, and 250 gold if you want to buy one.
 *
 * The reasoning, against the numbers already in the game (a kill pays 60, a
 * headshot 100, a wall gun runs 1000 to 1600):
 *
 *   TWO, not one, because one is a consumable the player saves forever. The
 *   first grenade of a run has to be spendable or the mechanic never gets
 *   learned, and the second is what teaches the fuse.
 *
 *   FOUR is the cap because five is a crowd-clear button. At 260 in the core a
 *   frag deletes an early wave; the cap is what stops a hoarder from opening
 *   wave twelve by throwing the whole pouch and skipping the fight the round is
 *   made of.
 *
 *   ONE PER WAVE is a dividend, not a reward, and it is deliberately not tied to
 *   performance. A player who is doing badly is exactly the player who needs the
 *   panic option; paying it out on kills would hand grenades to the people who
 *   did not need them. It also guarantees the mechanic never dies quietly on a
 *   broke player, which is what "resource" has to mean if the tension is going
 *   to survive past wave three.
 *
 *   250 GOLD is four kills and change. A frag that reliably kills four is
 *   therefore break-even, which prices it as a TEMPO tool - buy your way out of
 *   a corner - rather than as a gold engine. It is a quarter of the cheapest
 *   wall gun, which is the right ratio for a consumable against a permanent.
 *
 * The purchase is exposed as `buy()` rather than wired to a fixture, because the
 * wall-buy fixtures live in systems/wallbuy.js and world/, which this module
 * does not own. The price is decided; the wall is somebody else's to place.
 */
const START_COUNT = 2;
const MAX_COUNT = 4;
const WAVE_DIVIDEND = 1;
const GRENADE_PRICE = 250;

// --- pools -----------------------------------------------------------------

/** Simultaneous shells in flight. Four in the pocket plus slack for a reset. */
const POOL = 8;

/** Simultaneous explosions. Three overlapping is already more than legible. */
const FX = 3;

/**
 * The explosion's layers, in SECONDS rather than as fractions of one lifetime.
 *
 * Written this way because they are not fractions of anything: the hot core is
 * a tenth of a second because that is how long a flash reads as a flash, and
 * the smoke is a second and a half because that is how long an aftermath has to
 * last to be an aftermath. Expressed as fractions of a shared lifetime,
 * lengthening the smoke silently slowed the fire, which is how the first cut
 * ended up with a 0.6 second event whose "aftermath" frame was pixel-identical
 * to the plate.
 */
const CORE_TIME = 0.11;
const FIRE_OPEN = 0.18;
const FIRE_TIME = 0.55;
const LIGHT_TIME = 0.28;
const RING_TIME = 0.33;
const SMOKE_IN = 0.10;
const SMOKE_TIME = 1.5;
const FX_LIFE = SMOKE_TIME;

/** Hit records handed to the damage system. Sized to the live enemy cap. */
const HIT_RECORDS = 32;

// ---------------------------------------------------------------------------

export function createGrenades({
  scene, camera, world, player, rig, audio, impacts, combat, economy,
  director = null, spaces = null, notice = null, payout = null,
  handPoint = null,
}) {
  // --- scratch, allocated once ---------------------------------------------
  const _fwd = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _eye = new THREE.Vector3();
  const _step = new THREE.Vector3();

  /** Colliders and walls within blast reach, refilled per detonation. */
  const nearCover = [];
  const nearCoverBase = [];
  const nearWalls = [];

  // --- the shells -----------------------------------------------------------

  const shellGeo = new THREE.IcosahedronGeometry(R, 1);
  const shellMat = new THREE.MeshStandardMaterial({
    color: 0x3f4632, roughness: 0.62, metalness: 0.35,
  });
  // The lever, which is the only thing that makes a dark ball read as ordnance
  // at the top of an arc.
  const leverGeo = new THREE.BoxGeometry(R * 0.42, R * 1.9, R * 0.30);
  const leverMat = new THREE.MeshStandardMaterial({
    color: 0x8a7a52, roughness: 0.45, metalness: 0.75,
  });

  const shells = [];
  for (let i = 0; i < POOL; i++) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(shellGeo, shellMat);
    const lever = new THREE.Mesh(leverGeo, leverMat);
    lever.position.set(R * 0.72, R * 0.35, 0);
    group.add(body, lever);
    group.visible = false;
    // Never a weapon target and never a shadow caster: it is 17 cm across and
    // moving at seventeen metres a second.
    group.userData.noHit = true;
    group.castShadow = false;
    scene.add(group);

    shells.push({
      group,
      live: false,
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      fuse: 0,
      contact: false,
      still: 0,
      asleep: false,
      bounces: 0,
    });
  }

  // --- the explosion fixtures ----------------------------------------------

  /**
   * THE FIREBALL IS A SOFT BILLBOARD, NOT A SPHERE, AND THIS IS THE SECOND GO.
   *
   * The first version was an additive icosahedron, which is what the impact
   * pool and the muzzle flash both are, and it looked right in every number and
   * wrong in the frame: over sunlit sand an additive solid saturates to white
   * with a HARD GEOMETRIC EDGE, so a detonation in the courtyard read as a
   * white circle stuck on the lens. The clip metric said 0.1 per cent, the mean
   * luminance said the frame had lifted, and both were true, and the picture was
   * still a sticker. That is the failure this project keeps having: a number
   * that goes the right way while the image goes the wrong way.
   *
   * What fixes it is three things and none of them is brightness:
   *
   *   A SOFT EDGE. `alpha = (1 - r)^p` across a camera-facing quad, computed in
   *   the shader so there is no texture to generate, upload, or leak. A hard
   *   silhouette is what makes a bright blob read as geometry.
   *
   *   AN ORANGE ADDITIVE LAYER, not a white one. Additive white over bright sand
   *   clips all three channels and the hue information is gone; additive orange
   *   clips red first and holds green and blue, so the centre goes hot and the
   *   falloff stays fire-coloured.
   *
   *   SMOKE, WHICH IS THE PART THAT IS NOT ADDITIVE. Four dark puffs on ordinary
   *   alpha blending, ramping in behind the fire and drifting out. They are what
   *   give the event an outline the sky can be darker than, and without them
   *   there is nothing in the frame that an explosion could be occluding.
   */
  const BLOB_VERT = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}',
  ].join('\n');

  const BLOB_FRAG = [
    'varying vec2 vUv;',
    'uniform vec3 uColor;',
    'uniform float uOpacity;',
    'uniform float uPower;',
    'void main() {',
    '  float d = length(vUv - vec2(0.5)) * 2.0;',
    '  float a = pow(max(0.0, 1.0 - d), uPower);',
    '  if (a * uOpacity < 0.004) discard;',
    '  gl_FragColor = vec4(uColor, a * uOpacity);',
    '}',
  ].join('\n');

  function blobMaterial(hex, power, additive) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(hex) },
        uOpacity: { value: 0 },
        uPower: { value: power },
      },
      vertexShader: BLOB_VERT,
      fragmentShader: BLOB_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
  }

  const quadGeo = new THREE.PlaneGeometry(1, 1);
  const ringGeo = new THREE.RingGeometry(0.80, 1.0, 48);

  const SMOKE_PUFFS = 4;

  const effects = [];
  for (let i = 0; i < FX; i++) {
    const coreMat = blobMaterial(0xfff2dc, 2.4, true);
    const ballMat = blobMaterial(0xff7c26, 1.35, true);
    const smokeMat = blobMaterial(0x2e2620, 1.15, false);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffb877, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    const group = new THREE.Group();
    const ball = new THREE.Mesh(quadGeo, ballMat);
    const core = new THREE.Mesh(quadGeo, coreMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;

    // The puffs are laid out once, at construction, on a fixed ring with a
    // fixed lift. Randomising them per detonation would allocate nothing but it
    // would also make two explosions in the same corridor look like two
    // different effects, which is worse than a repeat nobody sees twice.
    const smoke = [];
    for (let k = 0; k < SMOKE_PUFFS; k++) {
      const m = new THREE.Mesh(quadGeo, smokeMat);
      const a = (k / SMOKE_PUFFS) * Math.PI * 2 + 0.6;
      m.userData.dir = { x: Math.cos(a), y: 0.42 + (k % 2) * 0.30, z: Math.sin(a) };
      m.userData.size = 1.0 + (k % 3) * 0.22;
      smoke.push(m);
    }

    // A real light, not a painted one. Sixteen times a brazier (9 at 22 m), so
    // the walls of whatever room this happens in are lit BY the explosion
    // rather than merely standing behind it.
    const light = new THREE.PointLight(0xffb257, 0, 34, 2);
    light.castShadow = false;

    group.add(ring, ...smoke, ball, core, light);
    group.visible = false;
    group.userData.noHit = true;
    scene.add(group);

    // Positional audio. 'box' rolloff, because an explosion has to be locatable
    // from the far end of the gallery, and its 0.55 send is what lets the room's
    // generated convolver do the tail.
    const anchor = new THREE.Object3D();

    effects.push({
      group, ball, core, ring, smoke, light,
      ballMat, coreMat, smokeMat, ringMat,
      anchor,
      handle: audio && audio.attachPositional ? audio.attachPositional(anchor, 'box') : null,
      /** Seconds since detonation, or -1 for a retired fixture. */
      t: -1,
      /** Last painted values. Read by the HUD-less harness; costs nothing. */
      paint: { ball: 0, core: 0, smoke: 0, ring: 0, ballR: 0, ringR: 0, light: 0 },
    });
  }

  let fxCursor = 0;

  // --- hit records ----------------------------------------------------------

  /**
   * Pre-allocated hit records, in the exact shape systems/damage.js expects.
   *
   * `killed` is written back by applyBlast and read by the payout, which is the
   * one fact the economy needs and the only thing that travels back out.
   */
  const hits = [];
  for (let i = 0; i < HIT_RECORDS; i++) {
    hits.push({
      enemy: null, region: 'body', damage: 0, killed: false, grenade: true,
      // Declared here rather than assigned at the call site so the record has
      // one shape for the life of the process. A property added later is a
      // hidden-class transition inside the frame a grenade goes off in.
      dirX: 0, dirZ: 0,
    });
  }

  /** The last detonation, written in place. Read by the harness and the HUD. */
  const lastBlast = {
    x: 0, y: 0, z: 0, inHand: false, enemies: 0, selfHurt: 0, playerDist: 0,
  };

  // --- audio ----------------------------------------------------------------

  /**
   * White noise for the report, generated once on first use.
   *
   * core/audio.js keeps its own noise buffer private, so this is a second one -
   * two seconds of it, shared by every detonation for the life of the process.
   * Generating it per explosion would be a 96k-sample fill inside the frame a
   * grenade goes off in.
   */
  let noiseBuf = null;

  /**
   * When the last few reports sounded, in context time.
   *
   * core/audio.js drops a sound rather than exceed its voice cap, because the
   * alternative is thirty convolved oscillators turning the mix to mush at the
   * exact moment the player needs to hear where the horde is. These nodes are
   * built by hand and route straight into a panner, so they are outside that
   * cap and need their own: six detonations in a quarter of a second is a pile
   * of grenades cooking off together, and the seventh adds nothing but level.
   */
  const reportTimes = [];
  const REPORT_BUDGET = 6;
  const REPORT_WINDOW = 0.25;

  function noise(ctx) {
    if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
    const n = Math.floor(ctx.sampleRate * 2);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  /**
   * The report.
   *
   * Three layers, because an explosion is three events the ear separates: a
   * crack (broadband, gone in 60 ms), a body (a lowpassed roar sweeping down as
   * the fireball expands), and a thump (a sine falling an octave and a half,
   * which is the part you feel). All three go into the panner, which routes to
   * the dry bus AND to the send bus, so the tail is whatever convolver the room
   * has crossfaded in.
   *
   * Nodes are created per detonation and every one of them is disconnected on
   * the last `onended`. That is the same shape core/audio.js uses for its own
   * voices; a Web Audio one-shot cannot be pooled without leaving oscillators
   * running.
   */
  function report(fx, gainScale = 1) {
    if (!audio || !audio.ctx || !fx.handle || !fx.handle.panner) return false;

    const ctx = audio.ctx;

    while (reportTimes.length && ctx.currentTime - reportTimes[0] > REPORT_WINDOW) {
      reportTimes.shift();
    }
    if (reportTimes.length >= REPORT_BUDGET) return false;
    reportTimes.push(ctx.currentTime);

    const t = ctx.currentTime + 0.02;
    const nodes = [];
    let pending = 0;
    let done = false;

    const teardown = () => {
      if (done) return;
      done = true;
      for (const n of nodes) { try { n.disconnect(); } catch { /* detached */ } }
      nodes.length = 0;
    };

    const own = (n) => { nodes.push(n); return n; };

    const out = own(ctx.createGain());
    out.gain.value = gainScale;
    out.connect(fx.handle.panner);

    const start = (src, t0, t1, offset) => {
      pending++;
      src.onended = () => { if (--pending <= 0) teardown(); };
      if (offset === undefined) src.start(t0); else src.start(t0, offset);
      src.stop(t1);
    };

    // Linear attack (an exponential cannot start from zero), exponential decay,
    // and a real zero at the end so the node genuinely stops contributing.
    const env = (param, t0, peak, attack, decay) => {
      param.setValueAtTime(0, t0);
      param.linearRampToValueAtTime(Math.max(peak, 0.0005), t0 + attack);
      const end = t0 + attack + decay;
      param.exponentialRampToValueAtTime(0.0005, end);
      param.setValueAtTime(0, end + 0.001);
      return end + 0.002;
    };

    const buf = noise(ctx);
    const offset = () => Math.random() * (buf.duration - 1.6);

    // 1. crack
    {
      const s = own(ctx.createBufferSource()); s.buffer = buf;
      const f = own(ctx.createBiquadFilter()); f.type = 'highpass'; f.frequency.value = 1400;
      const g = own(ctx.createGain());
      s.connect(f); f.connect(g); g.connect(out);
      const end = env(g.gain, t, 0.55, 0.001, 0.07);
      start(s, t, end + 0.02, offset());
    }

    // 2. body - the roar, opening then closing down as it expands
    {
      const s = own(ctx.createBufferSource()); s.buffer = buf;
      const f = own(ctx.createBiquadFilter()); f.type = 'lowpass'; f.Q.value = 0.9;
      f.frequency.setValueAtTime(3200, t);
      f.frequency.exponentialRampToValueAtTime(170, t + 0.85);
      const g = own(ctx.createGain());
      s.connect(f); f.connect(g); g.connect(out);
      const end = env(g.gain, t, 0.72, 0.010, 0.95);
      start(s, t, end + 0.02, offset());
    }

    // 3. thump - the part you feel rather than hear
    {
      const o = own(ctx.createOscillator()); o.type = 'sine';
      o.frequency.setValueAtTime(96, t);
      o.frequency.exponentialRampToValueAtTime(31, t + 0.55);
      const g = own(ctx.createGain());
      o.connect(g); g.connect(out);
      const end = env(g.gain, t, 0.85, 0.004, 0.60);
      start(o, t, end + 0.02);
    }

    // 4. debris rattle, quiet, long, and the reason it sounds like a room
    {
      const s = own(ctx.createBufferSource()); s.buffer = buf;
      const f = own(ctx.createBiquadFilter()); f.type = 'bandpass';
      f.frequency.value = 1900; f.Q.value = 1.1;
      const g = own(ctx.createGain());
      s.connect(f); f.connect(g); g.connect(out);
      const end = env(g.gain, t + 0.04, 0.11, 0.02, 0.85);
      start(s, t + 0.04, end + 0.02, offset());
    }

    return true;
  }

  /** A shell striking stone. Reuses the mechanical vocabulary already in audio. */
  function clink(x, y, z, hard) {
    if (!audio || !audio.play) return;
    // Positional would need a handle per shell; the pool is eight and a bounce
    // is 30 ms, so it goes through the dry path with a pitch offset instead.
    audio.play('reloadClick', { pitch: hard ? 0.55 : 0.75, gain: hard ? 0.5 : 0.28 });
  }

  // ---------------------------------------------------------------------------
  // world queries
  // ---------------------------------------------------------------------------

  function floorAt(x, z, feet) {
    return world.heightAt ? world.heightAt(x, z, feet) : 0;
  }

  /**
   * Bounce a shell off the world.
   *
   * ONE SURFACE PER PASS. See the note at the top of the file: summing normals
   * from every overlapping cylinder is how the enemy avoidance probe cancels
   * itself to zero in a doubled wall run, and a bounce that did it would tunnel
   * through every corner in the map. Three passes, deepest first.
   */
  function resolve(s) {
    let struck = 0;

    for (let pass = 0; pass < 3; pass++) {
      const feet = s.p.y - R;
      const floorY = floorAt(s.p.x, s.p.z, feet);

      let deepest = null;
      let deepestPen = 0;

      for (const c of world.colliders) {
        // Same base rule the player controller uses: measured from the
        // collider's own base where it declares one, from the local floor where
        // it does not. A shell above the top of a crate is on top of the crate.
        const base = c.y0 === undefined ? floorY : c.y0;
        if (feet - base > c.h) continue;

        const dx = s.p.x - c.x;
        const dz = s.p.z - c.z;
        const want = c.r + R;
        const d2 = dx * dx + dz * dz;
        if (d2 >= want * want || d2 < 1e-10) continue;

        const pen = want - Math.sqrt(d2);
        if (pen > deepestPen) { deepestPen = pen; deepest = c; }
      }

      if (deepest) {
        const dx = s.p.x - deepest.x;
        const dz = s.p.z - deepest.z;
        const d = Math.hypot(dx, dz) || 1e-6;
        const nx = dx / d, nz = dz / d;

        s.p.x += nx * deepestPen;
        s.p.z += nz * deepestPen;

        const into = s.v.x * nx + s.v.z * nz;
        if (into < 0) {
          // Split into normal and tangential, reflect the normal component with
          // restitution, scrub the tangential with friction.
          s.v.x -= nx * into * (1 + RESTITUTION);
          s.v.z -= nz * into * (1 + RESTITUTION);
          const tx = s.v.x - nx * (s.v.x * nx + s.v.z * nz);
          const tz = s.v.z - nz * (s.v.x * nx + s.v.z * nz);
          s.v.x = s.v.x - tx * (1 - TANGENT_KEEP);
          s.v.z = s.v.z - tz * (1 - TANGENT_KEEP);
          struck = Math.max(struck, Math.abs(into));
        }
        continue;
      }

      // Wall boxes, which the interior hands over because a cylinder cannot
      // approximate a doorway without either leaking at the corners or eating
      // the opening. Resolved along the axis of LEAST penetration, exactly as
      // the player controller resolves them.
      if (world.walls) {
        let wall = null, wpen = Infinity, waxis = 0, wsign = 1;

        for (const w of world.walls) {
          const top = s.p.y + R, bot = s.p.y - R;
          if (top <= w.y0 || bot >= w.y1) continue;

          const hx = w.w / 2 + R;
          const hz = w.d / 2 + R;
          const dx = s.p.x - w.x;
          const dz = s.p.z - w.z;
          const px = hx - Math.abs(dx);
          const pz = hz - Math.abs(dz);
          if (px <= 0 || pz <= 0) continue;

          const pen = Math.min(px, pz);
          if (pen < wpen) {
            wpen = pen; wall = w;
            waxis = px < pz ? 0 : 1;
            wsign = (px < pz ? dx : dz) < 0 ? -1 : 1;
          }
        }

        if (wall) {
          if (waxis === 0) {
            s.p.x += wpen * wsign;
            if (s.v.x * wsign < 0) {
              struck = Math.max(struck, Math.abs(s.v.x));
              s.v.x = -s.v.x * RESTITUTION;
              s.v.z *= TANGENT_KEEP;
            }
          } else {
            s.p.z += wpen * wsign;
            if (s.v.z * wsign < 0) {
              struck = Math.max(struck, Math.abs(s.v.z));
              s.v.z = -s.v.z * RESTITUTION;
              s.v.x *= TANGENT_KEEP;
            }
          }
          continue;
        }
      }

      break;
    }

    // --- floor ---------------------------------------------------------------
    const floorY = floorAt(s.p.x, s.p.z, s.p.y - R);
    s.contact = false;

    if (s.p.y - R <= floorY) {
      s.p.y = floorY + R;
      if (s.v.y < 0) {
        struck = Math.max(struck, -s.v.y);
        s.v.y = -s.v.y * RESTITUTION;
        // A bounce that would not clear its own radius is a bounce that reads
        // as jitter. Kill it and let the shell roll.
        if (s.v.y < 1.1) s.v.y = 0;
        s.v.x *= TANGENT_KEEP;
        s.v.z *= TANGENT_KEEP;
      }
      s.contact = true;
    }

    // --- perimeter ------------------------------------------------------------
    const b = world.bounds;
    const minX = b.minX ?? b.min, maxX = b.maxX ?? b.max;
    const minZ = b.minZ ?? b.min, maxZ = b.maxZ ?? b.max;

    if (s.p.x < minX) { s.p.x = minX; if (s.v.x < 0) s.v.x = -s.v.x * RESTITUTION; }
    if (s.p.x > maxX) { s.p.x = maxX; if (s.v.x > 0) s.v.x = -s.v.x * RESTITUTION; }
    if (s.p.z < minZ) { s.p.z = minZ; if (s.v.z < 0) s.v.z = -s.v.z * RESTITUTION; }
    if (s.p.z > maxZ) { s.p.z = maxZ; if (s.v.z > 0) s.v.z = -s.v.z * RESTITUTION; }

    return struck;
  }

  /**
   * Is there stone between the blast and this point?
   *
   * Sampled along the segment against the SAME cylinders and boxes everything
   * else resolves against. It skips the half metre nearest each end, because a
   * shell resting against a pillar is touching the pillar and a body pressed to
   * a wall is touching the wall, and neither of those is cover.
   *
   * `nearCover` and `nearWalls` are filtered once per detonation rather than per
   * target, which turns 461 colliders times two dozen enemies into a couple of
   * dozen tests.
   */
  function blocked(ox, oy, oz, tx, ty, tz) {
    const dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const d = Math.hypot(dx, dy, dz);
    const usable = d - COVER_SKIP_NEAR - COVER_SKIP_FAR;
    if (usable <= 0) return false;

    const steps = Math.max(1, Math.ceil(usable / COVER_STEP));

    for (let i = 0; i <= steps; i++) {
      const t = (COVER_SKIP_NEAR + (usable * i) / steps) / d;
      const sx = ox + dx * t;
      const sy = oy + dy * t;
      const sz = oz + dz * t;

      for (let k = 0; k < nearCover.length; k++) {
        const c = nearCover[k];
        const ex = sx - c.x, ez = sz - c.z;
        if (ex * ex + ez * ez >= c.r * c.r) continue;
        const base = nearCoverBase[k];
        if (sy >= base && sy <= base + c.h) return true;
      }

      for (let k = 0; k < nearWalls.length; k++) {
        const w = nearWalls[k];
        if (sy < w.y0 || sy > w.y1) continue;
        if (Math.abs(sx - w.x) <= w.w / 2 && Math.abs(sz - w.z) <= w.d / 2) return true;
      }
    }

    return false;
  }

  /**
   * Collect what could possibly shadow a blast at this point. Once per
   * detonation, not once per target.
   *
   * NOTHING THE BLAST IS STANDING INSIDE COUNTS AS COVER, and that exclusion is
   * load-bearing rather than pedantic. The courtyard's largest collider is the
   * pyramid: radius 32, height 44, centred at z = -62 - and the walkable
   * rectangle reaches z = -33, so the southern end of the map is INSIDE that
   * cylinder. The player controller pushes bodies out of it, which is why nobody
   * notices; a cover query that did not would find the pyramid between a
   * doorstep grenade and everything in front of it and quietly return a blast
   * that hurt nobody, at the one spot in the map where the whole horde arrives.
   */
  function gatherCover(x, y, z) {
    nearCover.length = 0;
    nearCoverBase.length = 0;
    nearWalls.length = 0;

    for (const c of world.colliders) {
      if (c.h < COVER_HEIGHT) continue;      // rubble does not shadow a blast
      const dx = x - c.x, dz = z - c.z;
      const d2 = dx * dx + dz * dz;
      const reach = c.r + OUTER;
      if (d2 > reach * reach) continue;

      // Resolved once here rather than per sample: heightAt is a dune sampler
      // and this would otherwise be called a few hundred times per blast.
      const base = c.y0 === undefined ? floorAt(c.x, c.z, y) : c.y0;
      if (d2 < c.r * c.r && y >= base && y <= base + c.h) continue;

      nearCover.push(c);
      nearCoverBase.push(base);
    }

    if (world.walls) {
      for (const w of world.walls) {
        const dx = Math.max(0, Math.abs(x - w.x) - w.w / 2);
        const dz = Math.max(0, Math.abs(z - w.z) - w.d / 2);
        if (dx * dx + dz * dz > OUTER * OUTER) continue;
        // Same rule: a blast inside a wall box is not shadowed by it.
        if (y >= w.y0 && y <= w.y1
          && Math.abs(x - w.x) <= w.w / 2 && Math.abs(z - w.z) <= w.d / 2) continue;
        nearWalls.push(w);
      }
    }
  }

  /** The curve. Full strength inside INNER, nothing outside OUTER. */
  function falloff(d) {
    if (d >= OUTER) return 0;
    if (d <= INNER) return BLAST_MAX;
    const t = (d - INNER) / (OUTER - INNER);
    return BLAST_EDGE + (BLAST_MAX - BLAST_EDGE) * Math.pow(1 - t, FALLOFF);
  }

  // ---------------------------------------------------------------------------
  // detonation
  // ---------------------------------------------------------------------------

  const state = {
    /** In the pouch. */
    count: START_COUNT,
    /** Pin is out, shell is still in hand. */
    cooking: false,
    /** Seconds cooked. */
    cookT: 0,
    /** Lifetime counters, for the HUD and the harness. */
    thrown: 0,
    detonated: 0,
    cookedOff: 0,
    selfDamage: 0,
    kills: 0,
    lastBlast: null,
  };

  function payHits(n) {
    for (let i = 0; i < n; i++) {
      const h = hits[i];
      if (!h.enemy) continue;
      if (h.killed) state.kills++;
      if (payout) continue;                  // the host owns the payout
      // Same rule main.js applies to a burst of bullets: a kill pays a kill, a
      // hit that does not finish pays a hit. A blast has no head region, so it
      // can never pay the headshot premium, which is correct - a grenade should
      // not be the cheapest way to buy the skill bonus.
      economy?.award?.(h.killed ? 'kill' : 'hit');
    }
    if (payout) payout(hits, n);
  }

  /**
   * Everything a detonation does, in one place.
   *
   * @param {number} x
   * @param {number} y   the shell's own height; the blast centres BLAST_LIFT above
   * @param {number} z
   * @param {boolean} inHand  true when this went off before it was thrown
   */
  function detonate(x, y, z, inHand = false) {
    const by = y + BLAST_LIFT;

    gatherCover(x, by, z);

    // --- the horde -----------------------------------------------------------
    let n = 0;
    const crowd = director && director.live ? director.live : null;

    if (crowd) {
      for (let i = 0; i < crowd.length && n < HIT_RECORDS; i++) {
        const e = crowd[i];
        if (!e || !e.live || e.dying) continue;

        // The chest, not the feet. `actor.position` is the group origin, which
        // sits on the ground, so a blast at head height over a body at its feet
        // would measure the whole standing height as distance.
        const eh = (e.spec ? e.spec.height * (e.scale ?? e.spec.scale ?? 1) : 1.8) * 0.55;
        const ex = e.position.x, ey = e.position.y + eh, ez = e.position.z;

        const d = Math.hypot(ex - x, ey - by, ez - z);
        if (d >= OUTER) continue;
        if (blocked(x, by, z, ex, ey, ez)) continue;

        const h = hits[n++];
        h.enemy = e;
        h.region = 'body';
        h.damage = falloff(d);
        h.killed = false;
        h.dirX = ex - x;
        h.dirZ = ez - z;
      }
    }

    if (n) {
      combat?.applyBlast?.(hits, n);
      payHits(n);
      for (let i = 0; i < n; i++) hits[i].enemy = null;   // never hold a corpse
    }

    // --- the player ----------------------------------------------------------
    // Measured to the chest, for the same reason as above: the player's position
    // is the EYE, and a grenade at their feet is a grenade at their feet.
    const px = player.position.x;
    const py = player.position.y - 0.85;
    const pz = player.position.z;
    const pd = Math.hypot(px - x, py - by, pz - z);

    let selfHurt = 0;
    if (pd < OUTER && (inHand || !blocked(x, by, z, px, py, pz))) {
      selfHurt = falloff(pd);
      state.selfDamage += selfHurt;
      combat?.damagePlayer?.(selfHurt, x, z);
    }

    // --- the event -----------------------------------------------------------
    fire(x, by, z, pd);

    state.detonated++;
    lastBlast.x = x; lastBlast.y = by; lastBlast.z = z;
    lastBlast.inHand = inHand;
    lastBlast.enemies = n;
    lastBlast.selfHurt = selfHurt;
    lastBlast.playerDist = pd;
    state.lastBlast = lastBlast;
    return lastBlast;
  }

  /**
   * Paint one explosion fixture at normalised age `u`.
   *
   * Split out of the frame loop so that fire() can paint u=0 itself. A fixture
   * that is made visible on one frame and given its opacities on the next shows
   * the player a transparent sphere for the single frame the flash is supposed
   * to be at its brightest, which is the one frame that matters.
   */
  function paintFx(fx, t) {
    // Every blob faces the camera. A flat quad that is allowed to turn edge-on
    // vanishes, which is the classic particle-sheet artefact and the reason
    // impacts.js does the same thing.
    if (camera) {
      camera.updateMatrixWorld();
      fx.ball.quaternion.copy(camera.quaternion);
      fx.core.quaternion.copy(camera.quaternion);
      for (const m of fx.smoke) m.quaternion.copy(camera.quaternion);
    }

    // Fire: opens fast, fades slowly. Held at a peak opacity under 1 so the
    // additive layer lifts the frame rather than pinning it - a fireball that
    // clips is a fireball with no shape.
    const fu = Math.min(1, t / FIRE_TIME);
    const grow = 1 - Math.pow(1 - Math.min(1, t / FIRE_OPEN), 2.2);
    const ballR = 1.1 + grow * 4.4;
    fx.ball.scale.setScalar(ballR);
    fx.ballMat.uniforms.uOpacity.value = 0.80 * Math.pow(1 - fu, 1.5);

    // The hot centre. Small, white, and gone in a tenth of a second, which is
    // what makes the first frame read as a detonation rather than as a flare.
    const cu = Math.min(1, t / CORE_TIME);
    fx.core.scale.setScalar(0.7 + cu * 1.5);
    fx.coreMat.uniforms.uOpacity.value = 0.85 * Math.pow(1 - cu, 1.6);

    // Smoke ramps IN behind the fire and OUTLIVES it by a full second. This is
    // the only part of the effect still on screen once the light has gone, and
    // it is what makes the aftermath a place something happened rather than a
    // frame identical to the one before the throw.
    const su = Math.min(1, t / SMOKE_TIME);
    fx.smokeMat.uniforms.uOpacity.value =
      0.62 * Math.min(1, t / SMOKE_IN) * Math.pow(1 - su, 0.9);
    for (const m of fx.smoke) {
      const d = m.userData.dir;
      const reach = 0.5 + su * 2.4;
      m.position.set(d.x * reach, 0.35 + d.y * reach * 1.15, d.z * reach);
      m.scale.setScalar(m.userData.size * (1.1 + su * 3.0));
    }

    // Shockwave: a flat ring running out along the ground, which is the read
    // that says "this happened HERE" from any angle.
    const ru = Math.min(1, t / RING_TIME);
    const ringR = 0.7 + ru * 6.6;
    fx.ring.scale.setScalar(ringR);
    fx.ringMat.opacity = 0.55 * (1 - ru) * (1 - ru);

    // A few frames of real light, not a painted glow. Sixteen times a brazier
    // (9 at 22 m) for 0.28 s, which is a flash to the eye and still five frames
    // at the twenty hertz the delta clamp floors the simulation at. Any shorter
    // and the one thing that puts the ROOM into the explosion - the walls lit
    // from the blast rather than a bright sprite in front of them - lands
    // between two frames and is never seen.
    const lu = Math.min(1, t / LIGHT_TIME);
    fx.light.intensity = 145 * Math.pow(1 - lu, 2.4);

    const p = fx.paint;
    p.ball = fx.ballMat.uniforms.uOpacity.value;
    p.core = fx.coreMat.uniforms.uOpacity.value;
    p.smoke = fx.smokeMat.uniforms.uOpacity.value;
    p.ring = fx.ringMat.opacity;
    p.ballR = ballR;
    p.ringR = ringR;
    p.light = fx.light.intensity;
  }

  /** Put a fixture fully away: invisible, unlit, and contributing nothing. */
  function retireFx(fx) {
    fx.t = -1;
    fx.group.visible = false;
    fx.light.intensity = 0;
    fx.ballMat.uniforms.uOpacity.value = 0;
    fx.coreMat.uniforms.uOpacity.value = 0;
    fx.smokeMat.uniforms.uOpacity.value = 0;
    fx.ringMat.opacity = 0;
    const p = fx.paint;
    p.ball = p.core = p.smoke = p.ring = p.light = 0;
  }

  /** Light the fixture, kick the camera, throw the dust, sound the report. */
  function fire(x, y, z, playerDist) {
    const fx = effects[fxCursor];
    fxCursor = (fxCursor + 1) % FX;

    fx.group.position.set(x, y, z);
    fx.group.visible = true;
    fx.t = 0;

    // The ring sits just off the floor, not at the blast centre: a shockwave the
    // player reads is one that runs along the ground.
    const floorY = floorAt(x, z, y - BLAST_LIFT);
    fx.ring.position.y = (floorY + 0.06) - y;

    paintFx(fx, 0);
    fx.anchor.position.set(x, y, z);
    fx.anchor.updateMatrix();
    fx.anchor.matrixWorld.copy(fx.anchor.matrix);
    fx.handle?.sync?.();
    report(fx);

    // Dust and debris come out of the pooled impact system rather than a second
    // particle pool of this module's own. Six bursts of ten, biased upward and
    // outward, which is a dome rather than a fountain.
    if (impacts && impacts.spawn) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.random() * 0.6;
        _step.set(Math.cos(a) * 0.8, 0.55 + Math.random() * 0.5, Math.sin(a) * 0.8).normalize();
        _eye.set(x + Math.cos(a) * 0.4, floorY + 0.12, z + Math.sin(a) * 0.4);
        impacts.spawn(_eye, _step, i % 2 ? 'sand' : 'stone');
      }
    }

    // The shockwave the player feels. Squared inside the rig, so this is the
    // linear number and it has to be generous at the centre and near nothing at
    // the rim or every distant frag reads like a hit.
    if (rig && rig.addTrauma) {
      const t = Math.max(0, 1 - playerDist / (OUTER * 1.9));
      rig.addTrauma(Math.min(1, 0.12 + t * t * 0.85));
    }
  }

  // ---------------------------------------------------------------------------
  // throwing
  // ---------------------------------------------------------------------------

  function takeShell() {
    for (const s of shells) if (!s.live) return s;
    // Pool exhausted, which needs four in the air at once against a cap of four
    // carried. Stealing the oldest is better than dropping the throw.
    return shells[0];
  }

  /**
   * Launch a shell.
   *
   * Direction is the camera's, which is the only honest answer: the crosshair is
   * where the player is looking and a grenade that leaves on a different vector
   * than the bullets is a grenade the player cannot aim. The player's own
   * velocity is inherited, so throwing while sprinting throws further, which is
   * both correct and the thing that makes a running retreat readable.
   *
   * THE ORIGIN IS A SEAM. By default the shell leaves half a metre in front of
   * the eye, which is right and is also independent of a throwing animation
   * that does not exist yet. When player/viewmodel.js grows one, passing a
   * `handPoint(out)` that writes the world position of the hand moves the
   * release to the hand without a line changing in here - and it must NOT move
   * the timing: the shell exists on the frame the key comes up, so the
   * animation is a follow-through, never a wind-up. See the note on release().
   */
  function launch(fuse) {
    const s = takeShell();

    camera.updateMatrixWorld();
    camera.getWorldDirection(_fwd);
    _eye.setFromMatrixPosition(camera.matrixWorld);

    if (handPoint) {
      handPoint(s.p);
    } else {
      s.p.copy(_eye).addScaledVector(_fwd, THROW_FORWARD).addScaledVector(_up, -THROW_DROP);
    }
    s.v.copy(_fwd).multiplyScalar(THROW_SPEED).addScaledVector(_up, THROW_RISE);
    if (player.velocity) s.v.add(player.velocity);

    s.spin.set(
      (Math.random() - 0.5) * 22,
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 22);

    s.fuse = fuse;
    s.live = true;
    s.contact = false;
    s.still = 0;
    s.asleep = false;
    s.bounces = 0;
    s.group.position.copy(s.p);
    s.group.rotation.set(0, 0, 0);
    s.group.visible = true;

    state.thrown++;
    return s;
  }

  function retire(s) {
    s.live = false;
    s.group.visible = false;
    s.v.set(0, 0, 0);
  }

  function clearLive() {
    for (const s of shells) if (s.live) retire(s);
  }

  // ---------------------------------------------------------------------------
  // cooking
  // ---------------------------------------------------------------------------

  /** Pull the pin. Refused with nothing in the pouch. */
  function beginCook() {
    if (state.cooking) return false;
    if (state.count <= 0) {
      audio?.play?.('dryFire', { gain: 0.4 });
      notice?.('NO FRAGS', 900);
      return false;
    }
    state.cooking = true;
    state.cookT = 0;
    audio?.play?.('boltPull', { pitch: 1.35, gain: 0.4 });
    return true;
  }

  /**
   * Let go.
   *
   * The remaining fuse is whatever is left of it, which is the entire mechanic:
   * a two-second cook lands a 1.4-second airburst, and a three-and-a-half-second
   * cook never leaves the hand at all - that case is handled in update(), not
   * here, because the clock has to run whether or not the player releases.
   *
   * THE SHELL EXISTS ON THIS FRAME. That is the contract a throwing animation
   * has to be built against: by the time a 0.2 second wind-up finished, the
   * grenade would already be three metres downrange, so the animation
   * player/viewmodel.js needs is a FOLLOW-THROUGH from a pose it is already in.
   * Concretely:
   *
   *   cookGrenade()    on the frame the pin comes out. About 0.15 s to bring the
   *                    off-hand up with the frag and drop the weapon a few
   *                    degrees, then HOLD - indefinitely, because the player
   *                    decides when this ends and the ceiling is FUSE, 3.4 s.
   *   throwGrenade()   on this frame. No wind-up. About 0.18 s of extension out
   *                    of frame, then about 0.26 s back to ready.
   *   cancelGrenade()  when it cooks off in the hand, or when a space transition
   *                    voids the cook. There is nothing to throw; the hand goes.
   *
   * Any wind-up the animator wants belongs inside the COOK, which is the part
   * the player controls and the only part with time in it.
   */
  function release() {
    if (!state.cooking) return null;
    state.cooking = false;
    state.count--;
    const s = launch(Math.max(0.05, FUSE - state.cookT));
    state.cookT = 0;
    return s;
  }

  // ---------------------------------------------------------------------------
  // frame
  // ---------------------------------------------------------------------------

  let lastSpace = spaces ? spaces.active : null;
  let lastWave = director ? director.state.wave : 0;
  let heldLast = false;

  function update(dt, input) {
    // --- supply --------------------------------------------------------------
    if (director && director.state.wave !== lastWave) {
      // Only forward. forceWave() and reset() both move this number backwards
      // and neither of those is a wave the player survived.
      if (director.state.wave > lastWave && lastWave >= 1) {
        state.count = Math.min(MAX_COUNT, state.count + WAVE_DIVIDEND);
      }
      lastWave = director.state.wave;
    }

    // --- space ---------------------------------------------------------------
    // A shell in the courtyard is 110 units from a player who has just walked
    // into the pyramid. The director retires its actors across a transition for
    // exactly this reason; a grenade that survived it would go off in an empty
    // desert three seconds later and take nothing with it.
    if (spaces && spaces.active !== lastSpace) {
      lastSpace = spaces.active;
      clearLive();
      if (state.cooking) { state.cooking = false; state.cookT = 0; }
    }

    // --- input ---------------------------------------------------------------
    if (input) {
      const held = !!input.grenade;
      if (held && !heldLast) beginCook();
      if (!held && heldLast && state.cooking) release();
      heldLast = held;
    }

    // --- the cook ------------------------------------------------------------
    if (state.cooking) {
      state.cookT += dt;
      if (state.cookT >= FUSE) {
        // IT GOES OFF IN YOUR HAND. Not a fumble, not a drop, not a warning.
        // The whole reason cooking is interesting is that this outcome exists
        // and costs the run.
        state.cooking = false;
        state.cookT = 0;
        state.count--;
        state.cookedOff++;
        camera.updateMatrixWorld();
        _eye.setFromMatrixPosition(camera.matrixWorld);
        detonate(_eye.x, _eye.y - 0.35, _eye.z, true);
      }
    }

    // --- the shells ----------------------------------------------------------
    for (const s of shells) {
      if (!s.live) continue;

      s.fuse -= dt;
      if (s.fuse <= 0) {
        const x = s.p.x, y = s.p.y, z = s.p.z;
        retire(s);
        detonate(x, y, z, false);
        continue;
      }

      if (!s.asleep) {
        // Substepped so a shell at seventeen metres a second cannot step past a
        // half-metre pillar inside one clamped frame.
        const speed = s.v.length();
        const steps = Math.max(1, Math.min(8, Math.ceil((speed * dt) / MAX_STEP)));
        const h = dt / steps;

        for (let i = 0; i < steps; i++) {
          // POSITION FIRST, WITH THE HALF-STEP TERM. Euler - advance the
          // velocity, then the position - is off by g*h^2/2 per step, and the
          // step size here is not fixed: it is derived from the current speed,
          // so the substep count changes mid-flight as the shell accelerates.
          // With Euler that makes the arc depend on the substep count, and the
          // trajectory bends by a fraction of a millimetre on the frame the
          // count goes from one to two. Measured on this exact throw, the worst
          // deviation from a least-squares parabola was 0.68 mm with Euler and
          // is 4e-12 with the line below.
          //
          // Small. Also the difference between "the arc is a parabola" and "the
          // arc is nearly a parabola", and the second one is not a thing that
          // can be asserted.
          s.p.x += s.v.x * h;
          s.p.z += s.v.z * h;
          s.p.y += s.v.y * h - 0.5 * GRAVITY * h * h;
          s.v.y -= GRAVITY * h;

          const struck = resolve(s);
          if (struck > 1.4 && s.bounces < 6) { s.bounces++; clink(s.p.x, s.p.y, s.p.z, struck > 5); }
        }

        if (s.contact) {
          const damp = Math.max(0, 1 - ROLL_DAMP * dt);
          s.v.x *= damp;
          s.v.z *= damp;
        }

        // Coming to REST rather than sliding forever. The still timer is what
        // stops a shell that is bouncing gently in place from being declared
        // asleep on the one frame its velocity crosses the threshold.
        if (s.contact && s.v.lengthSq() < SLEEP_SPEED * SLEEP_SPEED) {
          s.still += dt;
          if (s.still >= SLEEP_TIME) { s.asleep = true; s.v.set(0, 0, 0); }
        } else {
          s.still = 0;
        }

        s.group.position.copy(s.p);
        // Tumble driven by real speed, so a shell that has stopped stops
        // spinning. Free-running rotation on a resting object is the classic
        // tell that nothing is actually simulated.
        const tumble = Math.min(1, speed / 8);
        s.group.rotation.x += s.spin.x * dt * tumble;
        s.group.rotation.y += s.spin.y * dt * tumble;
        s.group.rotation.z += s.spin.z * dt * tumble;
      }
    }

    // --- the fixtures --------------------------------------------------------
    for (const fx of effects) {
      if (fx.t < 0) continue;
      fx.t += dt;
      if (fx.t >= FX_LIFE) { retireFx(fx); continue; }
      paintFx(fx, fx.t);
    }
  }

  // ---------------------------------------------------------------------------

  return {
    state,
    shells,
    effects,

    update,
    beginCook,
    release,
    detonate,

    /** Cooked fraction, 0..1, for a HUD ring. 1 means it is about to kill you. */
    get cook() { return state.cooking ? Math.min(1, state.cookT / FUSE) : 0; },
    get count() { return state.count; },
    get live() { let n = 0; for (const s of shells) if (s.live) n++; return n; },

    /** Non-combat resupply: the harness, a max-ammo, a scripted grant. */
    give(n = 1) {
      state.count = Math.min(MAX_COUNT, state.count + n);
      return state.count;
    },

    /**
     * Buy one. Wired to nothing yet on purpose - the wall fixtures live in
     * files this module does not own - but the price is decided and this is the
     * whole transaction, so hanging a wall buy off it is one line elsewhere.
     */
    buy(price = GRENADE_PRICE) {
      if (state.count >= MAX_COUNT) return false;
      if (!economy || !economy.spend(price, 'grenade')) {
        audio?.purchaseDenied?.();
        return false;
      }
      state.count++;
      return true;
    },

    /** Throw one straight away, no cook. For scripted use and the harness. */
    throwNow(fuse = FUSE) {
      if (state.count <= 0) return null;
      state.count--;
      return launch(fuse);
    },

    /**
     * Put a shell at an exact point with an exact velocity.
     *
     * The harness needs this to assert a parabola and a wall bounce without
     * having to steer a camera into position first, and a scripted trap needs it
     * for the same reason. It still comes out of the pool.
     */
    placeAt(x, y, z, vx = 0, vy = 0, vz = 0, fuse = FUSE) {
      const s = takeShell();
      s.p.set(x, y, z);
      s.v.set(vx, vy, vz);
      s.spin.set(0, 0, 0);
      s.fuse = fuse;
      s.live = true;
      s.contact = false;
      s.still = 0;
      s.asleep = false;
      s.bounces = 0;
      s.group.position.copy(s.p);
      s.group.visible = true;
      state.thrown++;
      return s;
    },

    clearLive,

    reset() {
      clearLive();
      for (const fx of effects) retireFx(fx);
      state.count = START_COUNT;
      state.cooking = false;
      state.cookT = 0;
      state.thrown = state.detonated = state.cookedOff = 0;
      state.selfDamage = 0;
      state.kills = 0;
      state.lastBlast = null;
      heldLast = false;
    },

    setFidelity(high) {
      // The point light is the expensive half of the effect: it is a real light
      // added to a scene that is already carrying the sun and a dozen braziers.
      for (const fx of effects) {
        fx.light.visible = high;
        fx.handle?.setFidelity?.(high);
      }
    },

    /** Damage at a distance, without detonating anything. Tuning and tests. */
    damageAt(d) { return falloff(d); },

    stats() {
      let live = 0, asleep = 0;
      for (const s of shells) { if (s.live) live++; if (s.live && s.asleep) asleep++; }
      return {
        count: state.count,
        max: MAX_COUNT,
        price: GRENADE_PRICE,
        cooking: state.cooking,
        cook: +(state.cooking ? state.cookT / FUSE : 0).toFixed(3),
        live,
        asleep,
        pool: shells.length,
        fxPool: effects.length,
        thrown: state.thrown,
        detonated: state.detonated,
        cookedOff: state.cookedOff,
        kills: state.kills,
        // Counted rather than assumed. The pool is only a pool if everything in
        // it is still parented to the scene after a thousand throws.
        mounted: shells.filter((s) => !!s.group.parent).length
               + effects.filter((f) => !!f.group.parent).length,
      };
    },

    dispose() {
      for (const s of shells) scene.remove(s.group);
      for (const fx of effects) { scene.remove(fx.group); fx.handle?.dispose?.(); }
      shellGeo.dispose(); shellMat.dispose();
      leverGeo.dispose(); leverMat.dispose();
      quadGeo.dispose(); ringGeo.dispose();
      for (const fx of effects) {
        fx.ballMat.dispose(); fx.coreMat.dispose();
        fx.smokeMat.dispose(); fx.ringMat.dispose();
      }
    },
  };
}

export const GRENADE_CONSTANTS = {
  FUSE, GRAVITY, THROW_SPEED, THROW_RISE, RESTITUTION,
  INNER, OUTER, BLAST_MAX, BLAST_EDGE, FALLOFF,
  START_COUNT, MAX_COUNT, WAVE_DIVIDEND, GRENADE_PRICE,
  POOL, FX,
};
