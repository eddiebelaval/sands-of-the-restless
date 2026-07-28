/**
 * WHAT THE DEAD DROP.
 *
 * Six power-ups, on the Treyarch set the whole game is modelled on, renamed the
 * way everything else in this necropolis is renamed: Pack-a-Punch is the Altar
 * of Ptah, the perks are shrines to the god whose domain matches the effect, and
 * a mystery box is the Chest of the Nameless. So insta-kill is the feather Maat
 * weighs a heart against, max ammo is the Nile flood, double points is the
 * double crown of the two lands, and a nuke is the second death - the
 * annihilation of the soul, which is the only thing in that cosmology that is
 * genuinely final.
 *
 * THE HUD PRINTS THE PLAIN MEANING NEXT TO THE NAME. A player who has to work
 * out what "the Flood of Hapi" does while a wave closes on them has been given
 * a puzzle instead of a power-up. The name is the flavour; the second line is
 * the contract.
 *
 * THREE THINGS DECIDE WHETHER THIS FEELS RIGHT AND NONE OF THEM IS THE EFFECT.
 *
 *   IT IS AN OBJECT IN THE WORLD, and it has to be findable across a room. The
 *   Anubis shrine on this project was once functionally perfect and photographed
 *   at 5.5 mean luminance - correct behaviour, correct text, impossible to find.
 *   So a drop is a lit glyph on a card, with its own point light raking the
 *   floor around it, a soft additive halo that survives being small, and a ring
 *   on the ground underneath it. The light is deliberately WEAK AND WIDE rather
 *   than bright and close, which is the correction the chest and the wall buys
 *   both needed: a lamp square on a fixture clips it to white and leaves the
 *   room black, and a fixture that clips is unreadable while scoring WELL on
 *   mean luminance. Shape, not glare.
 *
 *   IT EXPIRES, AND IT WARNS FIRST. A drop that vanishes without warning teaches
 *   the player nothing; a drop that blinks for its last six seconds forces the
 *   decision the mechanic is for - break off the fight and go and get it, or
 *   let it go. It dims and brightens rather than switching off, so a photograph
 *   of a blinking drop is never a photograph of nothing.
 *
 *   THE TIMED ONES ARE ON THE HUD WITH THEIR SECONDS. Two at once is normal and
 *   must be legible as two, which is why the strip is a stack of chips and not
 *   one line that the second effect overwrites.
 *
 * POOLING, ON THE GRENADE'S DISCIPLINE. Every mesh, material, light and audio
 * handle is allocated at construction. `spawn()` writes numbers into a record
 * that already exists: it constructs no geometry, no material, no vector and no
 * scene child, so a hundred drops leave the scene-children delta at zero. The
 * per-type glyph is three bars whose scale and position are written from a
 * table, not three meshes that are built when the type is known.
 *
 * EVERY DURATION IN HERE IS SIMULATED SECONDS, accumulated from the clamped
 * frame delta, for the reason the mystery box states at length: under software
 * rendering that runs about six times slower than the wall clock, and anything
 * that waits on a timer is lying about when it happened.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------

/**
 * The six, with their weights.
 *
 * Weighted the way the reference weights them: the two that keep a run alive -
 * ammunition and a breathing space - are the common ones, the two that pay are
 * next, and the two that change the map for half a minute are rare. `bars` is
 * the glyph, in units of the card, as [width, height, x, y].
 */
export const POWERUPS = Object.freeze({
  /** Every enemy dies to one hit, for a window. */
  maat: {
    id: 'maat',
    name: 'THE FEATHER OF MAAT',
    plain: 'ONE HIT KILLS',
    colour: 0xff4d3a,
    weight: 22,
    seconds: 30,
    // A feather: a long shaft with two vanes swept off it. The vanes are the
    // reason `bars` carries a rotation at all - axis-aligned, this glyph is a
    // plus sign, and a plus sign in a shooter means a health pack.
    bars: [[0.075, 0.54, 0, 0.03, 0], [0.26, 0.06, -0.10, 0.11, 0.55], [0.21, 0.06, 0.09, -0.05, -0.55]],
    notes: [392, 311, 233],
    wave: 'sawtooth',
  },

  /** Reserve ammunition, on every weapon held. */
  hapi: {
    id: 'hapi',
    name: 'THE FLOOD OF HAPI',
    plain: 'MAX AMMO',
    colour: 0x4fc3ff,
    weight: 26,
    // Three stacked bars: the water hieroglyph, and nothing else in the set is
    // horizontal, so it is the one drop that is told apart by silhouette alone.
    bars: [[0.46, 0.075, 0, 0.16], [0.46, 0.075, 0, 0], [0.46, 0.075, 0, -0.16]],
    notes: [330, 440, 660],
    wave: 'triangle',
  },

  /** Combat payouts doubled, for a window. */
  crowns: {
    id: 'crowns',
    name: 'THE TWIN CROWNS',
    plain: 'DOUBLE GOLD',
    colour: 0xf2c14e,
    weight: 20,
    seconds: 30,
    // Two crowns side by side, which is what doubling looked like to a people
    // who wrote the union of two kingdoms as one hat inside another.
    bars: [[0.13, 0.40, -0.12, 0.04], [0.13, 0.40, 0.12, 0.04], [0.44, 0.075, 0, -0.22]],
    notes: [523, 659, 784, 1046],
    wave: 'square',
  },

  /** Everything alive dies, and it pays once. */
  seconddeath: {
    id: 'seconddeath',
    name: 'THE SECOND DEATH',
    plain: 'ALL FALL',
    colour: 0xfff0c0,
    weight: 14,
    // A downward chevron over a shaft. The only glyph in the set that points at
    // the floor, which is where a second death sends you.
    bars: [[0.32, 0.075, -0.10, 0.14, -0.75], [0.32, 0.075, 0.10, 0.14, 0.75], [0.075, 0.30, 0, -0.10, 0]],
    notes: [180, 120, 60],
    wave: 'sine',
  },

  /** A flat purse, on pickup. */
  hoard: {
    id: 'hoard',
    name: 'THE FUNERARY HOARD',
    plain: 'BONUS GOLD',
    colour: 0xffd98a,
    weight: 12,
    // A heaped ingot.
    bars: [[0.44, 0.10, 0, -0.16], [0.30, 0.10, 0, -0.03], [0.16, 0.10, 0, 0.10]],
    notes: [784, 988, 1175],
    wave: 'triangle',
  },

  /** Every chest awake, at a token price, for a window. */
  nameless: {
    id: 'nameless',
    name: 'THE NAMELESS ARE GENEROUS',
    plain: 'FIRE SALE',
    colour: 0xb98cff,
    weight: 6,
    // Three chest lids, which is the whole joke: there are three of them and
    // they are all open.
    bars: [[0.15, 0.17, -0.15, 0.08], [0.15, 0.17, 0.15, 0.08], [0.15, 0.17, 0, -0.14]],
    notes: [659, 880, 1109, 1318],
    wave: 'square',
  },
});

export const KINDS = Object.keys(POWERUPS);

/**
 * ONE DROP IN SIXTY KILLS, capped at two a wave.
 *
 * The reference rolls somewhere around one in sixty to one in eighty per kill
 * with a per-round cap, and this takes the generous end of that band on purpose:
 * our waves are SMALLER than theirs. A wave here is 5 + 2.1 per wave number,
 * capped at 34, so wave five is sixteen bodies and wave twenty is thirty-four -
 * where a Treyarch round in the same part of a run is comfortably larger. At one
 * in sixty that works out at roughly one drop every second wave through the
 * midgame, which is the felt cadence the reference has; at one in eighty against
 * our wave sizes the player would meet their first drop somewhere around wave
 * ten, which is most of a session.
 *
 * THE CAP IS TWO, NOT FOUR, for the same reason. Four could not bind on a wave
 * of sixteen at any probability worth shipping - it would be a cap in name only
 * - and two binds exactly in the tail, which is what a cap is for: it stops one
 * lucky wave raining bonuses without ever being felt on an ordinary one.
 */
export const DROP_CHANCE = 1 / 60;
export const DROPS_PER_WAVE = 2;

/** How many drops may exist in the world at once. */
const POOL = 5;

/** Seconds a drop stands before it is gone, and when it starts warning. */
export const DROP_LIFE = 25;
export const DROP_WARN = 6;

/**
 * Blinks a second while warning.
 *
 * Three rather than five, and the reason is the delta clamp. The simulation
 * advances by AT MOST 1/20 of a second per frame, and under software rendering
 * that clamp is the whole of a frame - so a five-hertz square wave is sampled
 * four times a cycle in the worst case, which is where a blink stops being a
 * rhythm and becomes a flicker that reads as a rendering fault. At three it is
 * six or seven samples in that same worst case and twenty on a machine running
 * at sixty.
 */
const BLINK_HZ = 3;

/**
 * What the two flat payouts are worth, quoted against the map's prices.
 *
 * A kill pays 60 and a headshot 100; the cheapest wall buy is 1000 and the Altar
 * is 5000. 500 is eight kills - a real shortcut to a doorway and nowhere near a
 * free one - and the Second Death pays 400 flat rather than per body, which is
 * DELIBERATELY less than the twenty-odd kills it just took off the field would
 * have paid. It buys the player their life back. It is not a gold engine, and
 * pricing it as one would make the rarest drop in the set the most farmable.
 */
export const HOARD_GOLD = 500;
export const SECOND_DEATH_GOLD = 400;

/**
 * How long a Fire Sale runs is NOT a number in this file.
 *
 * The chest owns it, because the chest is the thing that has to decide when a
 * sale may safely end - it will not end one in the middle of a roll - and a
 * second copy of the duration here would be a second opinion about a window
 * only one of us is actually running. So the drop asks for a sale and the HUD
 * reads the chest's own clock. See systems/mysterybox.js.
 */

/** Hit records for the Second Death. Sized past the director's live cap. */
const NUKE_RECORDS = 40;

/** How close the player has to be to walk one up. */
const PICKUP_RADIUS = 1.75;
const PICKUP_HEIGHT = 2.4;

// ---------------------------------------------------------------------------

const HALO_VERT = [
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = uv;',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '}',
].join('\n');

/**
 * A soft additive disc, alpha = (1 - r)^p.
 *
 * The same correction systems/grenades.js records for its fireball: an additive
 * SOLID over a lit floor saturates to white with a hard geometric edge and reads
 * as a sticker on the lens. A soft edge is what makes a bright blob read as
 * light rather than as a decal, and it costs no texture to upload or leak.
 */
const HALO_FRAG = [
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

export function createPowerups({
  scene, world, player, camera, rig, audio, economy, weapons, combat, director,
  mysterybox = null, spaces = null, notice = null, flash = null,
  rng = Math.random,
}) {
  // --- scratch, allocated once ----------------------------------------------
  const _colour = new THREE.Color();

  // --- the pool -------------------------------------------------------------

  const cardGeo = new THREE.BoxGeometry(1, 1, 1);
  const quadGeo = new THREE.PlaneGeometry(1, 1);
  const ringGeo = new THREE.RingGeometry(0.62, 0.86, 40);

  const drops = [];

  for (let i = 0; i < POOL; i++) {
    const group = new THREE.Group();
    group.visible = false;
    // Never a weapon target and never a pick target: a drop is walked into, not
    // shot and not bought, and three.js does NOT skip invisible objects when
    // raycasting, so "it is hidden most of the time" is not a defence.
    group.userData.noHit = true;
    group.userData.noPick = true;

    /**
     * A DARK CARD WITH A LIT MARK ON IT, and the split is the whole legibility
     * argument this project keeps relearning.
     *
     * The first cut gave the card the same emissive colour as the glyph, and at
     * four metres every drop photographed as a saturated slab with a shape
     * somewhere inside it: the mark had nothing to be a mark AGAINST. It is the
     * wall buy's chalk-on-limestone problem and the chest's clipped-plate
     * problem, which are the same problem. The card now carries a tenth of the
     * glyph's emission - enough to say "this object belongs to that colour" and
     * not enough to compete with the thing drawn on it.
     */
    const cardMat = new THREE.MeshStandardMaterial({
      color: 0x0e0a06, roughness: 0.62, metalness: 0.15,
      emissive: 0x000000, emissiveIntensity: 0.12,
    });
    const runeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.35, metalness: 0.5,
      emissive: 0xffffff, emissiveIntensity: 1.0,
    });
    const haloMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xffffff) },
        uOpacity: { value: 0 },
        uPower: { value: 2.8 },
      },
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    // The card, and the glyph on it. The spinner is what the whole thing turns
    // on; the halo and the ring do not turn, because a halo that rotates is a
    // wheel and a ring on the floor that rotates is a hazard sign.
    const spinner = new THREE.Group();
    group.add(spinner);

    const card = new THREE.Mesh(cardGeo, cardMat);
    card.scale.set(0.68, 0.84, 0.05);
    spinner.add(card);

    // Three generic bars, written into position per type on spawn. Building the
    // glyph out of per-type meshes would be thirty meshes a slot for the one
    // that is showing.
    const bars = [];
    for (let b = 0; b < 3; b++) {
      const bar = new THREE.Mesh(cardGeo, runeMat);
      bar.position.z = 0.045;
      spinner.add(bar);
      bars.push(bar);
      const back = new THREE.Mesh(cardGeo, runeMat);
      back.position.z = -0.045;
      spinner.add(back);
      bars.push(back);
    }

    // Wider than the card and much softer than it, so what it adds is a sense
    // that the card is a source rather than a second bright object in front of
    // it. At 2.2 across at 0.42 opacity it swallowed the glyph whole and every
    // drop photographed as the same white blob - which would have scored WELL
    // on mean luminance, the exact metric that once rewarded the chest's flare.
    const halo = new THREE.Mesh(quadGeo, haloMat);
    halo.scale.setScalar(1.9);
    group.add(halo);

    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);

    /**
     * LOW, WIDE AND WEAK, which is the correction every fixture in this game
     * has needed. 6.5 over 14 units puts a warm pool on the floor a drop is
     * standing on and lights the wall behind it; a hot lamp at half a metre
     * would clip the card to white and leave the room black, and would then
     * score BETTER on mean luminance than the readable version.
     */
    const light = new THREE.PointLight(0xffffff, 0, 16, 2);
    light.castShadow = false;
    group.add(light);

    group.traverse((o) => { o.userData.noHit = true; o.userData.noPick = true; });
    scene.add(group);

    const anchor = new THREE.Object3D();

    drops.push({
      group, spinner, card, bars, halo, ring, light,
      cardMat, runeMat, haloMat, ringMat,
      anchor,
      handle: audio && audio.attachPositional ? audio.attachPositional(anchor, 'box') : null,
      live: false,
      kind: null,
      spec: null,
      /** Seconds since it landed. */
      age: 0,
      groundY: 0,
      blinking: false,
      /** Last painted values, for the harness. Costs nothing. */
      paint: { lit: 0, halo: 0, ring: 0, light: 0 },
    });
  }

  // --- the Second Death's shockwave -----------------------------------------

  /**
   * The nuke's screen event, in the world rather than only on the glass.
   *
   * Killing twenty things at once with no screen event is a bug that looks like
   * a bug. Four parts, because the moment has to land at four distances: the
   * whole frame washing out, a ring expanding from the player's feet so the
   * event has a PLACE, the room genuinely lit by it, and a camera that was
   * visibly hit. Take any one away and it reads as the horde having despawned.
   *
   * THE WASH IS A WORLD-SPACE OBJECT AND THAT IS THE LOAD-BEARING DECISION.
   *
   * The obvious way to white out a frame is the DOM element, and it is in here
   * too - see createFlash in ui/hud.js - but a CSS animation runs on the WALL
   * CLOCK. Under software rendering a frame is most of a second of wall clock
   * while advancing the simulation by 1/20, so a 600-millisecond flash is over
   * before the second frame of the event is drawn: it is invisible to the
   * harness, and on a slow machine it is very nearly invisible to the player.
   * Every attempt to photograph it came back with the flash already faded and
   * the frame identical to the plate.
   *
   * An inverted sphere around the player, with depth testing OFF so nothing can
   * occlude it, is the same white-out on SIMULATED time: it decays at the rate
   * the game is actually running at, it is inside the post chain so it blooms
   * and grades with everything else, and it is photographable because it lasts
   * exactly as long in frames as it does in the fight.
   */
  const washMat = new THREE.MeshBasicMaterial({
    color: 0xfff4d8, transparent: true, opacity: 0, side: THREE.BackSide,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  });
  /**
   * BRIGHTER THAN WHITE, because tone mapping eats a white-out.
   *
   * At an honest 1.0 the wash added a warm haze: measured over the sunlit
   * avenue it lifted the frame from 115 to 131 luma, which is a real change and
   * is not a nuke. The grade compresses highlights hard by design - that is
   * what stops the sand clipping - so a full-frame flash has to arrive with
   * more than one unit of light in it to survive being compressed. Set above 1
   * in linear space, which is legal and is what an emissive value is for.
   */
  washMat.color.setRGB(2.6, 2.45, 2.05);
  const wash = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), washMat);
  wash.visible = false;
  wash.renderOrder = 999;
  wash.frustumCulled = false;
  wash.userData.noHit = true;
  wash.userData.noPick = true;
  scene.add(wash);

  const waveMat = new THREE.MeshBasicMaterial({
    color: 0xfff3d0, transparent: true, opacity: 0, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.72, 1.0, 64), waveMat);
  shock.rotation.x = -Math.PI / 2;
  shock.visible = false;
  shock.userData.noHit = true;
  shock.userData.noPick = true;
  scene.add(shock);

  const shockLight = new THREE.PointLight(0xfff0cc, 0, 60, 2);
  shockLight.castShadow = false;
  scene.add(shockLight);

  const SHOCK_TIME = 0.85;
  /** How long the full-frame wash lasts, as a fraction of the shockwave. */
  const WASH_FRACTION = 0.55;
  let shockT = -1;

  // --- the Second Death's hit records ---------------------------------------

  /**
   * Pre-allocated, in the exact shape systems/damage.js expects, with `silent`
   * declared here rather than assigned at the call site so the record has one
   * shape for the life of the process.
   */
  const nukeHits = [];
  for (let i = 0; i < NUKE_RECORDS; i++) {
    nukeHits.push({
      enemy: null, region: 'body', damage: 0, killed: false,
      dirX: 0, dirZ: 0, silent: true,
    });
  }

  // --- state ----------------------------------------------------------------

  const state = {
    /** Timed effects owned here, by id. Fire Sale is NOT one; see below. */
    effects: {},

    /** Lifetime counters, for the HUD, the harness and the balance pass. */
    kills: 0,
    rolls: 0,
    dropped: 0,
    collected: 0,
    expired: 0,
    droppedThisWave: 0,
    wave: 0,

    /** What each kind has done, so a balance pass has numbers to read. */
    taken: {},

    /** Set while the Second Death is resolving, so it cannot roll its own kills. */
    nuking: false,
  };

  for (const id of KINDS) state.taken[id] = 0;

  let clock = 0;
  let lastSpace = spaces ? spaces.active : null;

  /**
   * The forced-roll escape hatch. `true` means "any kind"; a string names one.
   *
   * The harness cannot test a one-in-sixty roll by killing things until it gets
   * lucky - that is a suite whose runtime is a random variable - so it forces
   * the roll and then tests the ROLL ITSELF separately, over a hundred thousand
   * samples with an injected rng, where it costs nothing.
   */
  let forced = null;

  // ---------------------------------------------------------------------------
  // audio
  // ---------------------------------------------------------------------------

  /**
   * A motif, built by hand out of the shared context.
   *
   * core/audio.js owns the game's sound vocabulary and is not this module's file
   * to edit, so this does what systems/grenades.js does for its report: builds
   * its own nodes and routes them into the panner the audio engine handed over,
   * which means they still land in the room's generated convolution reverb and
   * still tear themselves down on the last `onended`. No audio files, and
   * nothing here is pooled - a Web Audio one-shot cannot be pooled without
   * leaving oscillators running.
   *
   * The DROP and the PICKUP of the same power-up share a motif and differ by an
   * octave and a direction, which is what makes six drops distinguishable from
   * each other AND a drop distinguishable from a collection.
   */
  function motif(handle, notes, { mul = 1, step = 0.075, dur = 0.34, type = 'triangle', gain = 0.22, reverse = false } = {}) {
    if (!audio || !audio.ctx || !handle || !handle.panner) return false;

    const ctx = audio.ctx;
    const t0 = ctx.currentTime + 0.02;
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
    out.gain.value = gain;
    out.connect(handle.panner);

    const order = reverse ? notes.slice().reverse() : notes;

    order.forEach((hz, i) => {
      const o = own(ctx.createOscillator());
      o.type = type;
      o.frequency.value = hz * mul;

      const g = own(ctx.createGain());
      o.connect(g); g.connect(out);

      const t = t0 + i * step;
      // Linear attack - an exponential cannot start from zero - then an
      // exponential decay and a real zero, so the node genuinely stops.
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      g.gain.setValueAtTime(0, t + dur + 0.001);

      pending++;
      o.onended = () => { if (--pending <= 0) teardown(); };
      o.start(t);
      o.stop(t + dur + 0.03);
    });

    return true;
  }

  /** The Second Death's own report: a long fall with a body under it. */
  function boom(handle) {
    if (!audio || !audio.ctx || !handle || !handle.panner) return false;

    const ctx = audio.ctx;
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
    out.gain.value = 1;
    out.connect(handle.panner);

    const start = (src, t0, t1) => {
      pending++;
      src.onended = () => { if (--pending <= 0) teardown(); };
      src.start(t0);
      src.stop(t1);
    };

    const env = (param, t0, peak, attack, decay) => {
      param.setValueAtTime(0, t0);
      param.linearRampToValueAtTime(Math.max(peak, 0.0005), t0 + attack);
      param.exponentialRampToValueAtTime(0.0005, t0 + attack + decay);
      param.setValueAtTime(0, t0 + attack + decay + 0.001);
      return t0 + attack + decay + 0.002;
    };

    // The thump you feel, an octave and a half of fall.
    {
      const o = own(ctx.createOscillator());
      o.type = 'sine';
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(28, t + 1.1);
      const g = own(ctx.createGain());
      o.connect(g); g.connect(out);
      const end = env(g.gain, t, 0.9, 0.006, 1.30);
      start(o, t, end + 0.03);
    }

    // And a detuned pair sliding down over it, which is what turns a thump into
    // a verdict.
    for (const [hz, off] of [[220, 0], [147, 0.04]]) {
      const o = own(ctx.createOscillator());
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(hz, t + off);
      o.frequency.exponentialRampToValueAtTime(hz * 0.32, t + off + 1.5);
      const f = own(ctx.createBiquadFilter());
      f.type = 'lowpass';
      f.frequency.setValueAtTime(2400, t + off);
      f.frequency.exponentialRampToValueAtTime(200, t + off + 1.4);
      const g = own(ctx.createGain());
      o.connect(f); f.connect(g); g.connect(out);
      const end = env(g.gain, t + off, 0.26, 0.02, 1.5);
      start(o, t + off, end + 0.03);
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // the drop
  // ---------------------------------------------------------------------------

  function floorAt(x, z) {
    return world && world.heightAt ? world.heightAt(x, z, 0) : 0;
  }

  function takeSlot() {
    for (const d of drops) if (!d.live) return d;
    // Everything is out. The OLDEST one goes, rather than refusing the drop:
    // a kill that earned a power-up and produced nothing is indistinguishable
    // from the roll being broken.
    let oldest = drops[0];
    for (const d of drops) if (d.age > oldest.age) oldest = d;
    retire(oldest);
    return oldest;
  }

  /** Write one drop into the world. Numbers only. */
  function place(kind, x, z) {
    const spec = POWERUPS[kind];
    if (!spec) return null;

    const d = takeSlot();
    const y = floorAt(x, z);

    d.live = true;
    d.kind = kind;
    d.spec = spec;
    d.age = 0;
    d.groundY = y;
    d.blinking = false;

    d.group.position.set(x, y, z);
    d.group.visible = true;
    d.anchor.position.set(x, y + 1, z);
    d.anchor.updateMatrix();
    d.anchor.matrixWorld.copy(d.anchor.matrix);

    _colour.setHex(spec.colour);
    d.runeMat.color.copy(_colour);
    d.runeMat.emissive.copy(_colour);
    d.cardMat.emissive.copy(_colour);
    d.haloMat.uniforms.uColor.value.copy(_colour);
    d.ringMat.color.copy(_colour);
    d.light.color.copy(_colour);

    // The glyph, written from the table. Six bars, because each of the three
    // is mirrored front and back: a card seen from behind with no mark on it is
    // a blank slab, and the player approaches from wherever they were fighting.
    for (let i = 0; i < 3; i++) {
      const b = spec.bars[i] || [0, 0, 0, 0, 0];
      const rot = b[4] || 0;
      const front = d.bars[i * 2];
      const back = d.bars[i * 2 + 1];
      front.scale.set(b[0], b[1], 0.035);
      front.position.set(b[2], b[3], 0.042);
      front.rotation.z = rot;
      // Mirrored in x, so the glyph reads the same way round from behind. The
      // rotation mirrors with it or a swept feather comes out backwards.
      back.scale.set(b[0], b[1], 0.035);
      back.position.set(-b[2], b[3], -0.042);
      back.rotation.z = -rot;
    }

    state.dropped++;
    state.droppedThisWave++;

    if (d.handle) motif(d.handle, spec.notes, { type: spec.wave, gain: 0.20, mul: 1 });

    return d;
  }

  function retire(d) {
    d.live = false;
    d.kind = null;
    d.spec = null;
    d.blinking = false;
    d.group.visible = false;
    d.light.intensity = 0;
    d.haloMat.uniforms.uOpacity.value = 0;
    d.ringMat.opacity = 0;
    d.paint.lit = d.paint.halo = d.paint.ring = d.paint.light = 0;
  }

  // ---------------------------------------------------------------------------
  // the roll
  // ---------------------------------------------------------------------------

  function pickKind() {
    let sum = 0;
    for (const id of KINDS) sum += POWERUPS[id].weight;

    let r = rng() * sum;
    for (const id of KINDS) {
      r -= POWERUPS[id].weight;
      if (r <= 0) return id;
    }
    return KINDS[0];
  }

  /**
   * A body fell. Roll for it.
   *
   * Wired to systems/damage.js's kill listener rather than to the payout,
   * because the payout knows THAT something died and this needs to know WHERE.
   */
  function onKill(enemy) {
    if (state.nuking) return null;

    state.kills++;

    const p = enemy && enemy.position ? enemy.position : player.position;

    if (forced) {
      const kind = typeof forced === 'string' ? forced : pickKind();
      forced = null;
      return place(kind, p.x, p.z);
    }

    const wave = director && director.state ? director.state.wave : 0;
    if (wave !== state.wave) {
      state.wave = wave;
      state.droppedThisWave = 0;
    }

    if (state.droppedThisWave >= DROPS_PER_WAVE) return null;

    state.rolls++;
    if (rng() >= DROP_CHANCE) return null;

    return place(pickKind(), p.x, p.z);
  }

  // ---------------------------------------------------------------------------
  // the effects
  // ---------------------------------------------------------------------------

  function say(text, ms = 2600) {
    if (notice) notice(text, ms);
  }

  /**
   * Start or REFRESH a timed effect.
   *
   * Refresh rather than stack, which is the reference's behaviour and the only
   * defensible one: two Twin Crowns stacking to quadruple gold would make the
   * rarest sequence in the game the only one worth farming, and two Feathers
   * stacking to nothing-can-hurt-you-twice is not even a coherent sentence.
   * Picking up a second copy resets the clock, and the HUD chip says so by
   * going back to its full width.
   */
  function begin(id) {
    const spec = POWERUPS[id];
    const cur = state.effects[id];

    if (cur) {
      cur.left = spec.seconds;
      return cur;
    }

    const fx = { id, left: spec.seconds, duration: spec.seconds };
    state.effects[id] = fx;
    apply(id, true);
    return fx;
  }

  function end(id) {
    if (!state.effects[id]) return false;
    delete state.effects[id];
    apply(id, false);
    return true;
  }

  /** The one place an effect touches another system, on and off. */
  function apply(id, on) {
    if (id === 'maat') {
      combat.state.instaKill = !!on;
      return;
    }
    if (id === 'crowns') {
      economy.setMultiplier(on ? 2 : 1);
      return;
    }
  }

  /** Max ammo: the reserve of every weapon the player is carrying. */
  function fillAmmo() {
    let filled = 0;
    for (const id of weapons.state.owned) {
      if (weapons.refillAmmo(id)) filled++;
    }
    return filled;
  }

  /**
   * The Second Death.
   *
   * Everything alive dies, and it is resolved through combat.applyBlast rather
   * than by reaching into the actors, so a nuked body topples away from the
   * player exactly as a grenaded one does, `killed` is written back by the same
   * code that writes it for a bullet, and the boss bar empties through the same
   * path that empties it when you shoot the god.
   *
   * IT PAYS ONCE. The per-kill payout is suppressed at the source - `silent` on
   * the record stops the kill listener, so it cannot roll twenty more drops -
   * and the gold is one flat grant. See SECOND_DEATH_GOLD.
   */
  function detonate(handle = null) {
    const liveList = director && director.live ? director.live : [];

    let n = 0;
    for (let i = 0; i < liveList.length && n < NUKE_RECORDS; i++) {
      const a = liveList[i];
      if (!a || !a.live || a.dying) continue;

      const rec = nukeHits[n++];
      rec.enemy = a;
      rec.region = 'body';
      rec.damage = Math.max(1, a.health);
      rec.killed = false;
      rec.dirX = a.position.x - player.position.x;
      rec.dirZ = a.position.z - player.position.z;
    }

    state.nuking = true;
    let killed = 0;
    try {
      combat.applyBlast(nukeHits, n);
      for (let i = 0; i < n; i++) if (nukeHits[i].killed) killed++;
    } finally {
      state.nuking = false;
      // Drop the references, so a pooled record cannot hold a retired actor
      // alive until the next nuke overwrites it.
      for (let i = 0; i < n; i++) nukeHits[i].enemy = null;
    }

    economy.grant(SECOND_DEATH_GOLD, 'seconddeath');
    economy.pop?.(`+${SECOND_DEATH_GOLD}`, 'crit');

    // The report, through the drop's own panner while it still has one - which
    // is why the handle is passed in rather than looked up. Three descending
    // notes are the pickup; this is the thing that arrives underneath them.
    boom(handle);

    // The moment. Wash, ring, light, and a camera that was hit.
    shockT = 0;
    shock.position.set(player.position.x, floorAt(player.position.x, player.position.z) + 0.12, player.position.z);
    shockLight.position.set(player.position.x, player.position.y + 1.4, player.position.z);
    shock.visible = true;
    wash.visible = true;
    wash.position.copy(camera ? camera.position : player.position);
    washMat.opacity = 1;
    rig?.addTrauma?.(0.9);
    flash?.fire?.('#fff2cf', 620);

    return killed;
  }

  /**
   * Take one. The whole surface of "what a power-up does" is these six lines.
   */
  function collect(d) {
    const id = d.kind;
    const spec = d.spec;

    state.collected++;
    state.taken[id]++;

    // The pickup, an octave up and reversed against the drop. Played through
    // the drop's own panner BEFORE it is retired, which is why this happens
    // here and not in retire().
    if (d.handle) {
      motif(d.handle, spec.notes, {
        type: spec.wave, mul: 2, step: 0.05, dur: 0.30, gain: 0.26, reverse: true,
      });
    }

    let detail = '';
    // The Fire Sale announces itself, in more detail than this could, from the
    // chest that is running it. Two banners for one pickup is the second one
    // wiping the first.
    let spoken = false;

    switch (id) {
      case 'maat':
      case 'crowns':
        begin(id);
        detail = ` - ${spec.seconds} SECONDS`;
        break;

      case 'hapi': {
        const n = fillAmmo();
        detail = ` - ${n} WEAPON${n === 1 ? '' : 'S'}`;
        break;
      }

      case 'hoard':
        economy.grant(HOARD_GOLD, 'hoard');
        economy.pop?.(`+${HOARD_GOLD}`, 'crit');
        detail = ` - ${HOARD_GOLD} GOLD`;
        break;

      case 'seconddeath': {
        const n = detonate(d.handle);
        detail = n ? ` - ${n} FELL` : '';
        break;
      }

      case 'nameless':
        if (mysterybox && mysterybox.fireSale) {
          mysterybox.fireSale();
          spoken = true;
        }
        break;

      default:
        break;
    }

    if (!spoken) say(`${spec.name}${detail}`, 2800);
    retire(d);
    return id;
  }

  // ---------------------------------------------------------------------------
  // frame
  // ---------------------------------------------------------------------------

  function update(dt, elapsed = 0) {
    clock += dt;

    // A drop belongs to the space it fell in. The director retires every actor
    // on a transition for the same reason: the courtyard and the interior are
    // 110 units apart and do not share a floor, so a drop left behind is a lit
    // card hanging in the middle of a space the player is not in.
    if (spaces && spaces.active !== lastSpace) {
      lastSpace = spaces.active;
      for (const d of drops) if (d.live) retire(d);
    }

    // --- timed effects --------------------------------------------------------
    for (const id of Object.keys(state.effects)) {
      const fx = state.effects[id];
      fx.left -= dt;
      if (fx.left <= 0) {
        end(id);
        say(`${POWERUPS[id].name} FADES`, 2000);
      }
    }

    // --- the drops ------------------------------------------------------------
    for (const d of drops) {
      if (!d.live) continue;

      d.age += dt;
      const left = DROP_LIFE - d.age;

      if (left <= 0) {
        state.expired++;
        retire(d);
        continue;
      }

      // Turning and bobbing, on SIMULATED time, so a drop rotates at the same
      // rate relative to the fight on any machine.
      d.spinner.rotation.y = clock * 1.5;
      const bob = 0.10 * Math.sin(clock * 2.2 + d.groundY);
      d.group.position.y = d.groundY + 1.05 + bob;

      // Warning. Dim and bright rather than on and off: the read is the same
      // and a photograph of a warning drop is never a photograph of nothing.
      d.blinking = left <= DROP_WARN;
      const blink = d.blinking
        ? (Math.sin(clock * Math.PI * 2 * BLINK_HZ) > 0 ? 1 : 0.28)
        : 1;

      d.runeMat.emissiveIntensity = 0.85 * blink;
      d.cardMat.emissiveIntensity = 0.12 * blink;
      d.light.intensity = 7.5 * blink;
      d.haloMat.uniforms.uOpacity.value = 0.15 * blink;
      d.ringMat.opacity = 0.42 * blink;
      d.ring.position.y = -(d.group.position.y - d.groundY) + 0.06;

      d.paint.lit = +blink.toFixed(2);
      d.paint.halo = +(0.15 * blink).toFixed(3);
      d.paint.ring = +(0.42 * blink).toFixed(3);
      d.paint.light = +(7.5 * blink).toFixed(2);

      // The halo faces the camera. A soft disc that does not is a disc.
      if (camera) d.halo.quaternion.copy(camera.quaternion);

      // Walked into, not bought. The height term is generous because the drop
      // floats a metre off a floor that swells, and a player who is standing
      // ON a power-up and not collecting it has met a bug.
      const dx = d.group.position.x - player.position.x;
      const dz = d.group.position.z - player.position.z;
      const dy = d.group.position.y - player.position.y;
      if (dx * dx + dz * dz <= PICKUP_RADIUS * PICKUP_RADIUS && Math.abs(dy) < PICKUP_HEIGHT) {
        collect(d);
      }
    }

    // --- the shockwave --------------------------------------------------------
    if (shockT >= 0) {
      shockT += dt;
      const k = Math.min(1, shockT / SHOCK_TIME);
      const r = 2 + k * 26;
      shock.scale.set(r, r, 1);
      waveMat.opacity = 0.85 * (1 - k) * (1 - k);
      shockLight.intensity = 22 * (1 - k);

      // The wash rides the camera - it is a full-frame effect, not an object in
      // the room - and clears well before the ring does, so the frame comes
      // back and the player watches the shockwave leave.
      const kw = Math.min(1, k / WASH_FRACTION);
      if (kw < 1) {
        if (camera) wash.position.copy(camera.position);
        washMat.opacity = (1 - kw) * (1 - kw);
      } else if (wash.visible) {
        wash.visible = false;
        washMat.opacity = 0;
      }

      if (k >= 1) {
        shockT = -1;
        shock.visible = false;
        wash.visible = false;
        washMat.opacity = 0;
        waveMat.opacity = 0;
        shockLight.intensity = 0;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // public surface
  // ---------------------------------------------------------------------------

  const unsubscribe = combat.onKill ? combat.onKill(onKill) : () => {};

  const api = {
    state,
    drops,
    POWERUPS,
    KINDS,

    update,

    /**
     * What the HUD paints, newest first.
     *
     * The Fire Sale row is READ FROM THE CHEST rather than tracked here, and
     * that is the whole reason this returns a fresh list instead of exposing
     * `state.effects`. The chest owns whether a sale is running - it is the
     * thing that must not end one in the middle of a roll - so a second
     * countdown here would be a second opinion, and the day the two disagreed
     * the HUD would be the one that was wrong.
     */
    active() {
      const out = [];
      for (const id of KINDS) {
        const fx = state.effects[id];
        if (!fx) continue;
        out.push({
          id,
          name: POWERUPS[id].name,
          plain: POWERUPS[id].plain,
          colour: POWERUPS[id].colour,
          left: Math.max(0, fx.left),
          duration: fx.duration,
        });
      }

      if (mysterybox && mysterybox.state && mysterybox.state.fireSale) {
        const spec = POWERUPS.nameless;
        out.push({
          id: 'nameless',
          name: spec.name,
          plain: `${spec.plain} - ${mysterybox.price} GOLD`,
          colour: spec.colour,
          left: Math.max(0, mysterybox.state.saleLeft),
          duration: mysterybox.state.saleFor || mysterybox.state.saleLeft,
        });
      }

      return out;
    },

    /** Is this effect running right now. */
    has(id) {
      if (id === 'nameless') return !!(mysterybox && mysterybox.state.fireSale);
      return !!state.effects[id];
    },

    /** Seconds left on it, or 0. */
    left(id) {
      if (id === 'nameless') return mysterybox ? mysterybox.state.saleLeft : 0;
      return state.effects[id] ? Math.max(0, state.effects[id].left) : 0;
    },

    /**
     * Put one down at an exact point, bypassing the roll.
     *
     * For the harness and the debug console, on the same terms director.placeAt
     * takes: it still goes through the pool and still behaves exactly as a
     * rolled drop, because an escape hatch that does not is a way to test a
     * game nobody plays.
     */
    placeAt(kind, x, z) { return place(kind, x, z); },

    /** Force the roll to fire on the next kill. Harness only. */
    forceNextDrop(kind = null) {
      forced = kind || true;
      return true;
    },

    /** Take whatever is live, without walking to it. Harness only. */
    collectAll() {
      let n = 0;
      for (const d of drops) if (d.live) { collect(d); n++; }
      return n;
    },

    /** Every live drop, as plain data. */
    liveDrops() {
      return drops.filter((d) => d.live).map((d) => ({
        kind: d.kind,
        x: +d.group.position.x.toFixed(2),
        y: +d.group.position.y.toFixed(2),
        z: +d.group.position.z.toFixed(2),
        age: +d.age.toFixed(2),
        left: +(DROP_LIFE - d.age).toFixed(2),
        blinking: d.blinking,
        ...d.paint,
      }));
    },

    /**
     * Drop every timed effect. Called when the player goes down, alongside the
     * shrines: a run that resets to wave one keeping half a minute of insta-kill
     * would be a death that cost nothing.
     */
    clearEffects() {
      let n = 0;
      for (const id of Object.keys(state.effects)) { end(id); n++; }
      return n;
    },

    /** Everything: effects and anything still standing in the world. */
    clear() {
      const n = api.clearEffects();
      for (const d of drops) if (d.live) retire(d);
      shockT = -1;
      shock.visible = false;
      wash.visible = false;
      washMat.opacity = 0;
      waveMat.opacity = 0;
      shockLight.intensity = 0;
      return n;
    },

    setFidelity(high) {
      for (const d of drops) if (d.handle) d.handle.setFidelity(high);
      // The halo is the first thing to go: it is the only additive surface here
      // and low fidelity has already given up bloom, which is what it is
      // written against.
      for (const d of drops) d.haloMat.uniforms.uPower.value = high ? 2.8 : 3.6;
    },

    stats() {
      return {
        pool: drops.length,
        live: drops.filter((d) => d.live).length,
        kills: state.kills,
        rolls: state.rolls,
        dropped: state.dropped,
        collected: state.collected,
        expired: state.expired,
        droppedThisWave: state.droppedThisWave,
        chance: DROP_CHANCE,
        capPerWave: DROPS_PER_WAVE,
        taken: { ...state.taken },
        active: api.active().map((e) => e.id),
        instaKill: combat.state.instaKill,
        multiplier: economy.multiplier,
        fireSale: !!(mysterybox && mysterybox.state.fireSale),
      };
    },

    dispose() { unsubscribe(); },
  };

  return api;
}
