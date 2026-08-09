/**
 * Audio.
 *
 * Every sound in this game is synthesised at runtime. There are no audio files,
 * no decodeAudioData, no network. The reverb is a noise impulse response
 * generated into an AudioBuffer the first time a room asks for it, the enemies
 * are formant-filtered sawtooths, and the weapons are muzzle blasts baked
 * sample by sample into buffers the moment the context comes up.
 *
 * THE WEAPONS MOVED. Everything a gunshot is made of now lives in
 * core/gunsmith.js, which bakes it offline into AudioBuffers; shot() below is
 * the playback and mixing half of that arrangement and holds no synthesis of
 * its own. The long version of why is at the top of that file, but the short
 * version is that the old three-layer live graph could not produce a broadband
 * transient - it was a bandpass, and a bandpass cannot make an edge - and
 * fixing it by adding layers would have put ten more nodes per shot on the
 * audio thread of a game that is already shedding visual quality to hold frame
 * rate.
 *
 * Four rules run through the whole module, and breaking any of them is the
 * usual reason browser audio in a game sounds broken after ten minutes:
 *
 *   1. No AudioContext before a user gesture. Chrome and Safari construct the
 *      context in 'suspended' state otherwise, and a suspended context nobody
 *      resumes is silence with no error message. Nothing here allocates until
 *      resume() has been called once, from inside a click or a keypress.
 *      Calls made before that are remembered, not executed.
 *
 *   2. No abrupt .value writes on a running voice. Every level change is a
 *      ramp. An instant gain change is a step discontinuity in the waveform,
 *      which is a click, and clicks are the single most common Web Audio bug.
 *
 *   3. A hard cap on simultaneous voices. Twenty enemies groaning at once is
 *      forty oscillators, and forty oscillators through a convolver is a
 *      crackling mess on a mid laptop. Over the cap, new sounds are dropped.
 *
 *   4. Everything that finishes gets disconnected. A node kept alive by a live
 *      connection is a node the garbage collector cannot touch, and the leak
 *      shows up as audio that degrades over minutes rather than as a crash.
 *
 * Timing comes from ctx.currentTime, never from wall-clock timers. The one
 * repeating timer in here is a 250ms housekeeping tick, and all it does is
 * decide what to schedule next; the schedule itself is sample accurate.
 *
 * ---------------------------------------------------------------------------
 * API
 * ---------------------------------------------------------------------------
 *
 *   resume()                    create (first call) and start the context.
 *                               Must be called from a user gesture. Returns a
 *                               promise for the resulting state string.
 *   suspend()                   stop the clock without tearing anything down.
 *   ready                       true once a context exists and is running.
 *   ctx                         the AudioContext, or null before resume().
 *
 *   setVolume(v) getVolume()    master level, 0..1, ramped.
 *   setMuted(on) toggleMute()   mute without losing the volume setting.
 *   setFidelity(high)           low halves the voice cap, drops HRTF panning
 *                               to equal power, and thins stinger stacks.
 *
 *   setSpace(name)              'corridor' | 'chamber' | 'gallery' | 'shaft' |
 *                               'exterior'. Crossfades between two convolvers.
 *
 *   shot(weapon, opts)          'pistol' | 'b3ar' | 'smg' | 'shotgun' |
 *                               'rifle' | 'lmg' | 'bolt' | 'energy'.
 *                               opts.upgraded adds the pack-a-punch ring.
 *                               opts.delay schedules it ahead of now.
 *   hasWeapon(name)             is that a real profile, or will it fall back?
 *   weaponNames()               every profile that exists.
 *   reloadClick() magOut() magIn() boltPull()
 *   adsIn() adsOut() weaponSwitch() dryFire()
 *
 *   groan(opts) footfall(opts) swipe(opts) deathRattle(opts)
 *   bodyHit(opts) headshotHit(opts)
 *
 *   groan and deathRattle take opts.throat: 'shambler' | 'husk' | 'bound' |
 *                               'censer'. Omitted is the shambler, which is what
 *                               every caller got before throats existed.
 *   chitinStep(opts)            one tripod of leg taps on stone. opts.chitin
 *                               picks 'scarab' or 'goldscarab'; opts.dist is
 *                               metres to the player and is what the step pool
 *                               allocates on.
 *   chitinRasp(opts)            stridulation. The scarab's whole voice.
 *   shellCrack(opts)            a carapace coming apart. The scarab's death.
 *   chitinHit(opts)             a round off a carapace. The chitin bodyHit.
 *   chitinCrit(opts)            a round through whatever this body's crit
 *                               actually is - a skull on a scarab, the abdomen
 *                               vent on a gold scarab. The chitin headshotHit.
 *
 *   Every enemy sound also takes opts.elev, the vertical component of the unit
 *   vector from the listener to the source, which adds the above-the-head cue a
 *   PannerNode cannot supply. It matters because gold scarabs cross ceilings.
 *
 *   startAmbience(profile)      'courtyard' | 'corridor' | 'chamber' |
 *                               'gallery' | 'shaft' | 'crypt'. Safe to call on
 *                               every room change; it only retargets ramps.
 *   stopAmbience()
 *
 *   waveStart() bossHorn() boxJingle() shrineChime()
 *   purchaseDenied() roundEnd()
 *
 *   attachPositional(object3D, kind)   'brazier' | 'enemy' | 'box' | 'shrine'
 *                               -> { play(name, opts), sync(), dispose() }
 *   syncPositional()            sync every live handle. Call once per frame.
 *   setListener(camera)         Call once per frame, after the camera moves.
 *
 *   play(name, opts)            generic router, same names as the methods.
 *   stats()                     { state, voices, cap, space, ambience, ... }
 *   dispose()                   tear the whole thing down.
 *
 * Every opts object accepts { dest, send, gain, pitch }: dest is a node to
 * route into (a panner, normally), send is the reverb send amount 0..1, gain
 * scales the voice, pitch multiplies every frequency in it.
 */

import { REPORTS, SPACE_SEND, bakeReport, bakeMechanics, bakeRing } from './gunsmith.js';

// Voice caps. These are voices, not nodes: one shotgun blast is one voice
// holding four sources. Low fidelity is roughly what a 2015 laptop survives.
const VOICE_CAP = { high: 28, low: 14 };

/**
 * A SECOND, SMALLER CAP, FOR THE ONE SOUND THAT IS PER-STEP.
 *
 * Everything else the horde makes is an event every few seconds. A scarab's
 * legs are an event every eighth of a second per body, and twenty-four of them
 * charging is a hundred and fifty voice allocations a second against a cap of
 * twenty-eight. The general cap cannot solve that: it is first-come, so a
 * wall of ticks would simply win the race and there would be no slots left for
 * the gunshot, the reload or the line of text the player is being told.
 *
 * So steps get their own budget, INSIDE the general one, and it is allocated by
 * distance rather than by arrival order. A step closer than the furthest one
 * currently sounding takes its slot; a step further away is dropped outright.
 * That is the correct priority for the thing this sound exists to do - the near
 * scarab is the one the player has to locate - and it bounds the whole horde's
 * step cost at six voices no matter how many bodies are live.
 *
 * The rate limiter underneath it is not about voice count, it is about
 * ALLOCATION CHURN: a step builds about a dozen nodes, and a hundred and fifty
 * a second is garbage the audio thread has to survive even when the voices
 * themselves are short. Ten starts per 250ms window is forty a second, which is
 * six or seven bodies' worth of legs and is more patter than the ear resolves.
 */
const STEP_POOL = { high: 6, low: 3 };
const STEP_WINDOW = 0.25;
const STEP_STARTS_PER_WINDOW = 10;

// The housekeeping tick. Long enough to be free, short enough that the
// ambience scheduler always has work queued past the audio callback.
const TICK_MS = 250;
const LOOKAHEAD = 0.6;

// Scheduling everything a few milliseconds ahead means a ramp that starts
// "now" is never already in the past by the time the audio thread reads it.
const SLACK = 0.004;

// Crossfade time for room changes. Long enough to be inaudible as a change,
// short enough that walking through a doorway feels immediate.
const SPACE_XFADE = 0.45;

// Length of the shared white noise buffer, in seconds. Transients read from a
// random offset into it, so no two shots are the identical waveform.
const NOISE_SECONDS = 3.0;

/**
 * The rapid-fire duck. See the long note inside shot().
 *
 * 0.16s is a little over the gap between rounds from the Apis at 620rpm, so
 * every automatic weapon in the game articulates, while a weapon slow enough
 * that its rounds are already separate events - the bolt gun, the shotgun - is
 * never touched. 0.34 is about ten decibels, which is as far as the previous
 * shot can be pulled down before the duck itself becomes the audible event.
 */
const DUCK_WINDOW = 0.16;
const DUCK_FLOOR = 0.34;

/**
 * The pack-a-punch ring, for a profile that has not declared one.
 *
 * A defensive default and nothing more: every profile in REPORTS has a `ring`
 * block. It is written down rather than left as an inline `??` because the
 * previous inline fallback WAS the bug - `W.ringRate ?? 1.6` looked like a
 * default and was in fact the only value the game ever used, on every weapon,
 * for as long as upgraded weapons have existed. A fallback that nothing falls
 * back to is a fallback; a fallback everything falls through is a constant with
 * a disguise on.
 */
const DEFAULT_RING = { rate: 2.4, gain: 0.09, ms: 60 };

/**
 * Impulse response recipes. seconds is the tail length, decay is the exponent
 * of the amplitude envelope (higher = faster collapse), damp is a one-pole
 * lowpass coefficient applied down the tail so stone rooms go dark as they
 * decay instead of hissing, predelay is the gap before the tail starts, which
 * is what actually communicates room size to the ear.
 */
const SPACES = {
  corridor: { seconds: 0.35, decay: 11.0, damp: 0.38, predelay: 0.004, wet: 0.30 },
  chamber:  { seconds: 1.10, decay: 4.6,  damp: 0.24, predelay: 0.013, wet: 0.42 },
  gallery:  { seconds: 2.40, decay: 2.5,  damp: 0.15, predelay: 0.022, wet: 0.58 },
  // A vertical shaft rings between two parallel walls. The flutter term is
  // that slapback made periodic, which is exactly what it sounds like.
  shaft:    { seconds: 1.80, decay: 3.2,  damp: 0.30, predelay: 0.009, wet: 0.50,
              flutter: 47, flutterDepth: 0.55 },
  exterior: { seconds: 0.20, decay: 20.0, damp: 0.45, predelay: 0.002, wet: 0.10 },
};

/**
 * The weapon profiles are the table in core/gunsmith.js. Aliasing it here keeps
 * the router, hasWeapon() and the fall-back in shot() all reading one list, so
 * a profile that exists to the baker cannot be invisible to the caller.
 */
const WEAPONS = REPORTS;

/** Ambience beds. Two brown noise layers, retargeted rather than rebuilt. */
const AMBIENCE = {
  courtyard: { rumbleHz: 110, rumble: 0.055, airHz: 1400, air: 0.070,
               dripEvery: 0,    gustEvery: 5.5, crackleEvery: 1.6 },
  corridor:  { rumbleHz: 70,  rumble: 0.085, airHz: 620,  air: 0.028,
               dripEvery: 3.2,  gustEvery: 11,  crackleEvery: 3.4 },
  chamber:   { rumbleHz: 58,  rumble: 0.105, airHz: 520,  air: 0.024,
               dripEvery: 4.6,  gustEvery: 14,  crackleEvery: 2.6 },
  gallery:   { rumbleHz: 46,  rumble: 0.125, airHz: 780,  air: 0.034,
               dripEvery: 7.0,  gustEvery: 9,   crackleEvery: 3.0 },
  shaft:     { rumbleHz: 64,  rumble: 0.075, airHz: 1150, air: 0.078,
               dripEvery: 6.0,  gustEvery: 4.0, crackleEvery: 0 },
  crypt:     { rumbleHz: 38,  rumble: 0.140, airHz: 340,  air: 0.016,
               dripEvery: 1.9,  gustEvery: 0,   crackleEvery: 5.0 },
};

/** Panner shapes per prop class, in world units. */
const PANNER_KINDS = {
  brazier: { ref: 2.5, max: 26, rolloff: 1.3, send: 0.35 },
  enemy:   { ref: 3.0, max: 45, rolloff: 1.0, send: 0.40 },
  // The mystery box has to be findable from across a room, so it barely rolls
  // off. Gameplay legibility beats physical accuracy here.
  box:     { ref: 8.0, max: 90, rolloff: 0.7, send: 0.55 },
  shrine:  { ref: 6.0, max: 70, rolloff: 0.8, send: 0.60 },
};

export function createAudio(options = {}) {
  // Nothing below this line allocates until resume() runs inside a gesture.
  let ctx = null;
  let unlocked = false;   // set by resume(); the gate on ever creating a ctx

  /**
   * An externally supplied context, used by exactly one caller: the offline
   * measurement harness in test/gunlab.html, which hands us an
   * OfflineAudioContext, fires one shot, and renders the graph to a buffer it
   * can measure.
   *
   * This exists because a gunshot cannot be verified by reading the code that
   * builds it. The defining failure in this codebase is a node that was
   * constructed and never connected, or a gain that was scheduled and left at
   * zero - both of which produce silence that looks exactly like working code.
   * The only way to know a layer is audible is to render it and look at the
   * samples, and the only way to render it is to let a test drive the real
   * graph rather than a reimplementation of it.
   *
   * The alternative considered and rejected was a separate "describe the
   * synthesis" export that the test walks symbolically. That verifies the
   * description, not the sound, which is the same mistake in a new place.
   */
  const injected = options.context || null;
  const offline = !!(injected && typeof injected.startRendering === 'function');

  let master = null;      // the volume fader, last thing before the clipper
  let limiter = null;     // final soft clipper, the only node touching output
  let comp = null;        // mix compressor, on everything EXCEPT the weapons
  let dryBus = null;      // non-weapon voices, unprocessed
  let gunBus = null;      // weapon voices, routed around the compressor
  let sendBus = null;     // voices, into whichever convolver is live
  let convA = null, convB = null;
  let wetA = null, wetB = null;
  let activeSlot = 'a';

  let whiteBuf = null;    // white noise, shared by every transient
  let brownBuf = null;    // brown noise, shared by both ambience beds

  /**
   * The baked weapon material. reports maps a profile name to its array of
   * variants; mechBank and ringBuf are shared by every weapon.
   *
   * Baked once, at ensure(), which runs inside the Begin click - the same
   * gesture that creates the context, while the world is still being built and
   * the player is looking at a title card. bakeMs is reported by stats()
   * because a cost you do not measure is a cost you find out about from a
   * player, and this one lands at the single worst moment to be wrong about.
   */
  const reports = new Map();
  let mechBank = [];
  let ringBuf = null;
  let bakeMs = 0;

  /** Which variant each weapon fired last, so the next one is a different one. */
  const lastVariant = new Map();

  /** The most recent report, for the rapid-fire duck inside shot(). */
  const lastReport = { at: -1, voice: null };

  const irCache = new Map();

  /** Live voices. Nothing outside this module holds a reference to one. */
  const voices = new Set();
  let cap = VOICE_CAP.high;
  let highFidelity = true;

  /**
   * Live step voices, and how far away each one is.
   *
   * A Map rather than a field on the voice so that kill() - which is called
   * from four places and from onended - has one line to clean up and cannot
   * leave a dead voice holding a slot in the pool.
   */
  const stepVoices = new Map();
  let stepWindowAt = -1;
  let stepStarts = 0;

  /**
   * WHAT WAS ASKED FOR, AND WHAT ACTUALLY SOUNDED.
   *
   * Two counters per sound name, because they answer different questions and
   * the gap between them is the interesting one: `tried` is what the game
   * wanted, `played` is what got a voice. A horde that requests four hundred
   * ticks and plays sixty is working exactly as designed; one that requests
   * four hundred and plays four hundred has no budget left for anything else.
   *
   * It exists for the harness, which cannot otherwise tell a sound that was
   * scheduled from a sound that was heard - and this project's defining audio
   * bug is the node that was built and never connected. It is two integer
   * increments on a path that runs a few times a second.
   */
  const playCounts = new Map();

  let volume = options.volume ?? 0.85;
  let muted = false;

  let spaceName = SPACES[options.space] ? options.space : 'exterior';

  // Ambience state. The bed nodes are infrastructure, not voices: a fixed set
  // of nodes that lives for the whole session, so it never pressures the voice
  // cap and never needs rebuilding (rebuilding is what clicks).
  let bed = null;
  let ambienceProfile = null;
  let tickTimer = 0;
  let nextDrip = 0, nextGust = 0, nextCrackle = 0;

  /** Positional handles, including ones created before the context existed. */
  const handles = new Set();

  let disposed = false;

  // ---------------------------------------------------------------------------
  // context and graph
  // ---------------------------------------------------------------------------

  /**
   * Build the context and the fixed bus graph.
   *
   *   voices ---> dryBus ----> compressor --\
   *          \                               >--> master --> soft clip --> out
   *           \-> gunBus ------------------->/
   *            \
   *             \-> sendBus -> convA -> wetA -> compressor
   *                         \-> convB -> wetB /
   *
   * THE WEAPONS TAKE THEIR OWN PATH TO THE FADER, and that split is the single
   * most consequential line in this file.
   *
   * Blink's DynamicsCompressorNode runs a fixed internal lookahead of about six
   * milliseconds so that it can begin reducing gain BEFORE a transient arrives.
   * That is the correct design for mastering music and it is fatal for a
   * gunshot, because a gunshot IS its first three milliseconds. The attack
   * control cannot save you - the reduction is already applied by the time the
   * edge reaches the node. Measured on this graph, in isolation, feeding the
   * same node the same material:
   *
   *     a gunshot-shaped edge, peak 0.270  ->  0.135, and its peak arrives
   *                                            5.9ms late
   *     a steady 440Hz sine, peak 0.240    ->  0.389
   *
   * Six decibels off the transients and four decibels of implicit makeup gain
   * onto everything sustained. That node is the reason every gun in this game
   * sounded thin, and no amount of re-synthesis upstream of it would have
   * helped - the old shots measured a 13 to 18dB crest factor because this was
   * standing on them.
   *
   * IT IS KEPT, UNCHANGED, for everything that is not a weapon. Deleting it
   * looked right and was wrong: that +4dB of makeup is load-bearing, and
   * removing it would have quietly dropped the ambience, the horde and every
   * stinger by four decibels - a mix regression, in the same change that was
   * supposed to be about the guns. Only the weapon voices go around it.
   *
   * The final soft clipper is what stops the two paths summing past full scale.
   * Unlike a compressor it has no detector, no lookahead and no memory, so it
   * cannot touch a transient; it simply bends the top off anything that would
   * have clipped. Measured, it is within 0.02dB of transparent on material
   * below its knee.
   *
   * Gated on `unlocked` so that a call to shot() or attachPositional() from
   * game code that runs before the player has clicked anything cannot quietly
   * strand us with a suspended context.
   */
  function ensure() {
    if (ctx || disposed || !unlocked) return;

    if (injected) {
      ctx = injected;
    } else {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor({ latencyHint: 'interactive' });
    }

    // The soft clipper: identity below 0.62, a smooth bend above it into an
    // asymptote just under one. options.limiter === false takes it out of
    // circuit. Nothing in the game passes that; the offline bench does, because
    // the only honest way to attribute a level change to a node is to measure
    // the same graph with and without it. That is how the compressor was
    // caught, and the same probe then proved this node innocent.
    if (options.limiter === false) {
      limiter = ctx.createGain();
      limiter.gain.value = 1;
    } else {
      limiter = ctx.createWaveShaper();
      limiter.curve = softClipCurve(4096, 0.62);
      // NO OVERSAMPLING, and this was measured rather than assumed.
      //
      // The usual reason to oversample a nonlinearity is that it generates
      // harmonics above Nyquist which fold back down as inharmonic hash. That
      // reasoning does not apply here, because below 0.62 this curve is exactly
      // the identity and generates no harmonics at all - and the loudest thing
      // the game produces, thirty rounds of sustained LMG fire in a stone
      // chamber, measures 0.60. The bend is reached only by genuine overload,
      // which is already an exceptional event.
      //
      // What oversampling DID cost was measurable on every shot: Blink
      // implements it with up and down sampling FIR filters, and those filters
      // ring on a two-sample edge. The same seeded transient measured 0.2796
      // straight to the destination and 0.2692 through the 2x path - a third of
      // a decibel off the peak of every gunshot in the game, permanently, to
      // prevent aliasing in a case that does not occur. At 'none' the same
      // comparison is bit identical.
      limiter.oversample = 'none';
    }
    limiter.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(limiter);

    // Unchanged from the settings this mix was built on. It has simply moved
    // AHEAD of the fader, so how hard it works no longer depends on where the
    // player left the volume slider - which was never intended and was only
    // ever true by accident of ordering.
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    comp.connect(master);

    dryBus = ctx.createGain();
    dryBus.gain.value = 1;
    dryBus.connect(comp);

    // The weapons' own path to the fader. It holds no processing of its own and
    // exists for exactly one reason: to reach the output without passing
    // through the compressor's lookahead.
    gunBus = ctx.createGain();
    gunBus.gain.value = 1;
    gunBus.connect(master);

    sendBus = ctx.createGain();
    sendBus.gain.value = 1;

    convA = ctx.createConvolver();
    convB = ctx.createConvolver();
    convA.normalize = true;
    convB.normalize = true;

    wetA = ctx.createGain();
    wetB = ctx.createGain();
    wetA.gain.value = 0;
    wetB.gain.value = 0;

    // The reverb return goes through the compressor even for a weapon. A tail
    // is not a transient - there is nothing there for the lookahead to destroy -
    // and letting the room duck under a horde is precisely what a mix
    // compressor is for.
    sendBus.connect(convA); convA.connect(wetA); wetA.connect(comp);
    sendBus.connect(convB); convB.connect(wetB); wetB.connect(comp);

    whiteBuf = makeWhiteNoise(NOISE_SECONDS);
    brownBuf = makeBrownNoise(6.0);

    /**
     * Bake every weapon now rather than on first use.
     *
     * Lazily baking each profile the first time it is fired spreads the same
     * work out, but it puts a few milliseconds of synchronous DSP on the frame
     * where a player pulls the trigger on a gun they just bought off a wall,
     * which is a hitch at exactly the moment they are being charged for the
     * thing. Doing it all here spends it once, during a click, before anything
     * is moving.
     */
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    for (const name of Object.keys(REPORTS)) reports.set(name, bakeReport(ctx, name));
    mechBank = bakeMechanics(ctx);
    ringBuf = bakeRing(ctx);
    bakeMs = +(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)).toFixed(2);

    // Prime the active slot at full level. This is the one place a wet gain is
    // written instantly, and it is safe because no signal is flowing yet.
    convA.buffer = impulse(spaceName);
    wetA.gain.value = SPACES[spaceName].wet;
    activeSlot = 'a';

    buildBed();

    // Anything requested before the gesture now takes effect for real.
    for (const h of handles) materialize(h);
    if (ambienceProfile) applyAmbience();

    // An offline render has no wall clock to tick against and no player to
    // hear ambience; a setTimeout there would fire after rendering finished
    // and schedule drips into a context that is already done.
    if (!offline) startTick();
  }

  function now() {
    return ctx.currentTime + SLACK;
  }

  // ---------------------------------------------------------------------------
  // noise sources
  // ---------------------------------------------------------------------------

  /**
   * A soft clip transfer curve: identity below `knee`, then a tanh bend that
   * asymptotes just under unity.
   *
   * Continuous in value AND in slope at the knee, which matters more than it
   * looks: a curve with a corner in it is a piecewise-linear distortion, and
   * piecewise-linear distortion generates strong high harmonics on quiet
   * material that only just crosses the corner. The tanh term is scaled so its
   * derivative at the knee is exactly one.
   */
  function softClipCurve(n, knee) {
    const curve = new Float32Array(n);
    const span = 1 - knee;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const a = Math.abs(x);
      const y = a <= knee ? a : knee + span * Math.tanh((a - knee) / span);
      curve[i] = x < 0 ? -y : y;
    }
    return curve;
  }

  function makeWhiteNoise(seconds) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /**
   * Brown noise by integrating white noise, which is the only cheap way to get
   * the -6dB/octave slope that reads as "room" rather than "hiss".
   *
   * Two corrections matter. The integrator has to leak (the 1/1.02 term) or
   * the random walk drifts into a DC offset and the buffer clips. And the ends
   * have to be matched by subtracting a linear ramp, because this buffer loops
   * forever: without that, every loop point is a step discontinuity, which is
   * an audible tick once per buffer length for the entire session.
   */
  function makeBrownNoise(seconds) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);

    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }

    const drift = d[n - 1] - d[0];
    let peak = 1e-6;
    for (let i = 0; i < n; i++) {
      d[i] -= drift * (i / (n - 1));
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
    const norm = 0.9 / peak;
    for (let i = 0; i < n; i++) d[i] *= norm;

    return buf;
  }

  /**
   * A room's impulse response: a noise burst under an exponential decay, with
   * a one-pole lowpass whose cutoff closes as the tail runs out. Real rooms
   * lose high frequencies fastest, because air and stone absorb them, and a
   * tail that stays bright is the tell of a fake reverb.
   *
   * The two channels are generated independently so the tail is decorrelated,
   * which is what makes it sound wide instead of like a mono echo in the head.
   */
  function impulse(name) {
    if (irCache.has(name)) return irCache.get(name);

    const spec = SPACES[name] || SPACES.chamber;
    const rate = ctx.sampleRate;
    const pre = Math.floor(rate * spec.predelay);
    const tail = Math.floor(rate * spec.seconds);
    const n = pre + tail;

    const buf = ctx.createBuffer(2, n, rate);

    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;

      for (let i = pre; i < n; i++) {
        const t = (i - pre) / rate;
        let a = Math.exp(-spec.decay * t);

        // The metallic flutter in a vertical shaft: the same tail, amplitude
        // modulated by the round trip between two parallel walls.
        if (spec.flutter) {
          a *= 1 + spec.flutterDepth * Math.sin(2 * Math.PI * spec.flutter * t);
        }

        // Damping deepens with time, so late reflections are darker than
        // early ones rather than uniformly filtered.
        const k = Math.max(spec.damp * (1 - 0.65 * (t / spec.seconds)), 0.02);
        lp += k * ((Math.random() * 2 - 1) * a - lp);
        d[i] = lp;
      }
    }

    irCache.set(name, buf);
    return buf;
  }

  // ---------------------------------------------------------------------------
  // voices
  // ---------------------------------------------------------------------------

  /**
   * Allocate a voice, or return null if we are at the cap.
   *
   * Callers must handle null. Dropping a sound is always better than the
   * alternative, which is thirty simultaneous convolved oscillators turning
   * the mix to mush at exactly the moment the player needs to hear where the
   * horde is coming from.
   */
  function voice(opts = {}) {
    if (!ctx || voices.size >= cap) return null;

    const v = {
      out: ctx.createGain(),
      nodes: [],
      pending: 0,
      dead: false,
      expires: ctx.currentTime + 8,
    };
    v.nodes.push(v.out);
    v.out.gain.value = opts.gain ?? 1;

    if (opts.dest) {
      // A panner supplies its own dry and send routing, so the voice just
      // hands it the signal.
      v.out.connect(opts.dest);
    } else {
      // opts.weapon picks the bus that skips the compressor. It is a flag
      // rather than a separate function because everything else about a weapon
      // voice - the cap, the send, the teardown - is identical to every other
      // voice, and forking the allocator would mean two places to forget to
      // disconnect something.
      v.out.connect(opts.weapon ? gunBus : dryBus);
      const s = ctx.createGain();
      s.gain.value = clamp(opts.send ?? 0.25, 0, 1);
      v.out.connect(s);
      s.connect(sendBus);
      v.nodes.push(s);
    }

    voices.add(v);
    return v;
  }

  /** Register a node so it is disconnected when the voice ends. */
  function own(v, node) {
    v.nodes.push(node);
    return node;
  }

  /**
   * Start a source inside a voice. Every source gets an explicit stop time,
   * because onended is the only reliable teardown signal and it never fires
   * for a source that was never told to stop.
   */
  function fire(v, src, t0, t1, offset) {
    v.pending++;
    v.expires = Math.max(v.expires, t1 + 0.5);
    src.onended = () => { if (--v.pending <= 0) kill(v); };
    if (offset === undefined) src.start(t0);
    else src.start(t0, offset);
    src.stop(t1);
    return src;
  }

  function kill(v) {
    if (v.dead) return;
    v.dead = true;
    for (const n of v.nodes) {
      try { n.disconnect(); } catch { /* already detached */ }
    }
    v.nodes.length = 0;
    voices.delete(v);
    stepVoices.delete(v);
  }

  /**
   * Take a slot in the step pool, or say no.
   *
   * The steal is the whole point. At the pool limit this finds the furthest
   * step currently sounding and, if the new one is meaningfully closer, ends it
   * and takes the slot. A player surrounded by scarabs then hears the ones
   * beside them rather than whichever six happened to ask first.
   *
   * The half-metre margin stops two bodies at the same range trading the same
   * slot back and forth every step, which would cost two allocations and a
   * teardown per tick and sound like one stuttering scarab.
   */
  /**
   * Is there room for a step at this range? Asks only; changes nothing.
   *
   * Split from the claim below because the order matters: stealing a slot and
   * THEN discovering the general voice cap is full would have ended a scarab
   * that was sounding perfectly well in exchange for silence.
   */
  function stepSlotOpen(dist) {
    if (!ctx) return false;
    const c = ctx.currentTime;
    if (c - stepWindowAt >= STEP_WINDOW) { stepWindowAt = c; stepStarts = 0; }
    if (stepStarts >= STEP_STARTS_PER_WINDOW) return false;

    const pool = highFidelity ? STEP_POOL.high : STEP_POOL.low;
    if (stepVoices.size < pool) return true;
    let far = -1;
    for (const d of stepVoices.values()) if (d > far) far = d;
    return dist < far - 0.5;
  }

  /** Take the slot, ending the furthest step if that is what it costs. */
  function claimStepSlot(v, dist) {
    const pool = highFidelity ? STEP_POOL.high : STEP_POOL.low;
    while (stepVoices.size >= pool) {
      let furthest = null, far = -1;
      for (const [sv, d] of stepVoices) if (d > far) { far = d; furthest = sv; }
      if (!furthest) break;
      kill(furthest);
    }
    stepStarts++;
    stepVoices.set(v, dist);
  }

  // ---------------------------------------------------------------------------
  // envelope and node helpers
  // ---------------------------------------------------------------------------

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  /**
   * Percussive envelope. The attack is linear, because an exponential ramp
   * cannot start from zero (exponentials never pass through it), and the decay
   * is exponential, which is what every physical decay actually does and what
   * the ear expects. Returns the time the envelope reaches silence.
   */
  function env(param, t0, peak, attack, hold, decay) {
    const p = Math.max(peak, 0.0005);
    param.setValueAtTime(0, t0);
    param.linearRampToValueAtTime(p, t0 + attack);
    if (hold > 0) param.setValueAtTime(p, t0 + attack + hold);
    const end = t0 + attack + hold + decay;
    param.exponentialRampToValueAtTime(0.0005, end);
    // Land on true zero once the exponential has already reached -66dB, so the
    // final step is inaudible but the node genuinely stops contributing.
    param.setValueAtTime(0, end + 0.001);
    return end + 0.002;
  }

  /**
   * Glide an AudioParam, anchored explicitly at t0. Without the setValueAtTime
   * the ramp would start from whenever the previous automation event happened
   * to end, which for a fresh node is the moment the ramp was scheduled rather
   * than the moment the voice starts.
   */
  function glide(param, t0, from, to, dur) {
    param.setValueAtTime(Math.max(from, 0.0001), t0);
    param.exponentialRampToValueAtTime(Math.max(to, 0.0001), t0 + dur);
  }

  /**
   * A random read position in the shared noise buffer that still leaves `dur`
   * seconds of material. Reading past the end is silence, which turns a long
   * rasp into a short one at random.
   */
  function noiseOffset(dur) {
    return Math.random() * Math.max(0, NOISE_SECONDS - dur - 0.05);
  }

  function noiseSrc(v) {
    const s = ctx.createBufferSource();
    s.buffer = whiteBuf;
    own(v, s);
    return s;
  }

  function filt(v, type, hz, q) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    if (q !== undefined) f.Q.value = q;
    own(v, f);
    return f;
  }

  function gain(v, value = 0) {
    const g = ctx.createGain();
    g.gain.value = value;
    own(v, g);
    return g;
  }

  function osc(v, type, hz) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    own(v, o);
    return o;
  }

  // ---------------------------------------------------------------------------
  // space
  // ---------------------------------------------------------------------------

  /**
   * Crossfade to another room size. Two convolvers exist purely so this is a
   * crossfade rather than a buffer swap: swapping the buffer on a live
   * convolver truncates whatever tail is still ringing, which in a big room is
   * a very loud click.
   */
  function setSpace(name) {
    if (!SPACES[name]) return false;
    spaceName = name;
    if (!ctx) return true;   // ensure() will prime the slot with it

    const t = now();
    const incoming = activeSlot === 'a' ? convB : convA;
    const inGain = activeSlot === 'a' ? wetB : wetA;
    const outGain = activeSlot === 'a' ? wetA : wetB;

    incoming.buffer = impulse(name);

    for (const g of [inGain, outGain]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
    }
    inGain.gain.linearRampToValueAtTime(SPACES[name].wet, t + SPACE_XFADE);
    outGain.gain.linearRampToValueAtTime(0, t + SPACE_XFADE);

    activeSlot = activeSlot === 'a' ? 'b' : 'a';
    return true;
  }

  // ---------------------------------------------------------------------------
  // weapons
  // ---------------------------------------------------------------------------

  /**
   * Fire a weapon.
   *
   * The synthesis is in core/gunsmith.js and has already happened; what is left
   * here is the four decisions that have to be made per shot, and every one of
   * them is about making the SAME baked material sound like a different event
   * each time it is fired.
   *
   *   WHICH VARIANT. Three are baked per weapon and the same one is never
   *   played twice running. Identical playback on every shot is the single most
   *   artificial thing a game can do, and it is the one the old shot() failed
   *   worst: two consecutive rounds measured 0.93 to 0.98 correlated, because
   *   the only thing that varied was a filter's centre frequency.
   *
   *   HOW FAST AND HOW LOUD. A few percent of playback rate and about a decibel
   *   of level, both per shot. Rate is doing double duty - it shifts pitch and
   *   duration together, which is what a slightly different charge in a
   *   slightly different chamber actually does.
   *
   *   HOW WET. The profile's send scaled by the space the player is standing
   *   in. The same round in the open courtyard and in the stone gallery is the
   *   same source and a completely different sound, and this module already
   *   knew which one it was in; not using that was leaving the largest free
   *   improvement on the table.
   *
   *   WHETHER TO GET OUT OF THE WAY. See the duck below.
   */
  function shot(weapon = 'pistol', opts = {}) {
    const name = REPORTS[weapon] ? weapon : 'pistol';
    const W = REPORTS[name];
    const bank = reports.get(name);
    if (!bank || !bank.length) return false;

    // opts.delay schedules the shot ahead of now. The game never uses it - a
    // trigger pull is always immediate - but the offline bench does, because an
    // OfflineAudioContext's currentTime does not advance between calls, so
    // three burst rounds would otherwise all land on the same sample.
    const t = now() + (opts.delay || 0);
    const pitch = opts.pitch ?? 1;

    // Never the same variant twice running. Stepping to the next one rather
    // than re-rolling keeps this branchless and bounded; re-rolling can in
    // principle spin, and a loop with an unbounded worst case does not belong
    // on a path that runs ten times a second.
    let idx = Math.floor(Math.random() * bank.length);
    if (bank.length > 1 && idx === lastVariant.get(name)) idx = (idx + 1) % bank.length;
    lastVariant.set(name, idx);
    const buf = bank[idx];

    const rate = pitch * (1 + rand(-W.rateJitter, W.rateJitter));
    const level = (opts.gain ?? 1) *
                  Math.pow(10, rand(-W.levelJitterDb, W.levelJitterDb) / 20);

    const spaceMul = SPACE_SEND[spaceName] ?? 1;
    const v = voice({
      dest: opts.dest,
      send: opts.send ?? clamp(W.send * spaceMul, 0, 1),
      gain: level,
      weapon: true,
    });
    if (!v) return false;

    /**
     * THE DUCK: get the last shot out of the way of this one.
     *
     * This is the piece that makes the B3AR a burst weapon rather than a noise.
     * Its three rounds land 40 ms apart, and even with a body short enough to
     * clear in that window, the previous round's tail is still ringing when the
     * next crack arrives. Three cracks sitting on an accumulating bed of their
     * own tails is measurably a crescendo rather than three hits: on the old
     * synthesis the third round of a burst peaked 9.8 dB ABOVE the first, purely
     * from pile-up.
     *
     * Every mix engineer's answer to this is the same, and it costs one
     * automation event and no nodes: when a new transient arrives, pull down
     * what is already sounding so the new one lands in a hole. The amount is
     * proportional to how close the two are, so an LMG at 620 rounds a minute
     * gets a couple of decibels and a burst at 40 ms gets six.
     *
     * The alternative considered was shortening every tail until nothing ever
     * overlapped. That is the same fix applied permanently instead of when it
     * is needed, and it costs the single shot - the one the player hears most
     * often - all of its size.
     */
    if (lastReport.voice && !lastReport.voice.dead && lastReport.voice !== v) {
      const gap = t - lastReport.at;
      if (gap > 0 && gap < DUCK_WINDOW) {
        const g = lastReport.voice.out.gain;
        const amount = DUCK_FLOOR + (1 - DUCK_FLOOR) * (gap / DUCK_WINDOW);
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(g.value * amount, t + 0.012);
      }
    }
    lastReport.voice = v;
    lastReport.at = t;

    // --- the report ---------------------------------------------------------
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    own(v, src);
    src.connect(v.out);
    fire(v, src, t, t + buf.duration / rate + 0.02);

    // --- the action ---------------------------------------------------------
    //
    // Skipped entirely at low fidelity. It is two of the five nodes a shot
    // costs, which makes it the largest single saving available on this path,
    // and it is the layer whose absence is least noticeable in a firefight -
    // it is quiet, it is late, and at any distance the room has eaten it. The
    // report itself is never degraded, because a machine that cannot afford
    // full quality still has to tell the player where the shooting is.
    if (W.mech && highFidelity && mechBank.length) {
      const mb = mechBank[Math.floor(Math.random() * mechBank.length)];
      const ms = ctx.createBufferSource();
      ms.buffer = mb;
      ms.playbackRate.value = pitch * rand(W.mech.rate[0], W.mech.rate[1]);
      own(v, ms);
      const mg = gain(v, W.mech.gain * rand(0.72, 1.28));
      ms.connect(mg); mg.connect(v.out);
      const mt = t + rand(W.mech.delayMs[0], W.mech.delayMs[1]) / 1000;
      fire(v, ms, mt, mt + mb.duration / ms.playbackRate.value + 0.02);
    }

    // --- the pack-a-punch ring ----------------------------------------------
    //
    // Also baked: five inharmonic partials beating against each other, played
    // back at whatever rate puts them over THIS weapon. It used to be two
    // detuned triangle oscillators through a highpass, which is four nodes and
    // exactly two partials, and two partials beating is a tremolo rather than
    // struck metal.
    //
    // THE PART THAT WAS WRONG, and it was in this line: the rate came from
    // `W.ringRate`, and no weapon profile has ever had one. The `?? 1.6`
    // fallback was therefore the only rate that ever played, on all seven
    // weapons, which put a fixed 1.6 kHz note with a quarter-second decay on
    // every upgraded gun in the game. On an SMG whose rounds land 66.7 ms apart
    // that is four of them sounding at once, permanently. The report on it was
    // "they sound like Christmas bells", which is what a stack of a fixed pitch
    // struck fifteen times a second is.
    //
    // Three things fix it and all three are in REPORTS, per weapon: a rate that
    // is that gun's own, a shorter bake (see RING_DECAY), and the CEILING
    // below. `ms` is derived from the weapon's cadence, so the shimmer from one
    // round is over before the next round leaves the barrel and cannot stack
    // with itself. The forced decay is scheduled on the ring's own gain rather
    // than done by stopping the source early, because a buffer cut mid-partial
    // is a click.
    if (opts.upgraded && ringBuf) {
      const R = W.ring || DEFAULT_RING;

      /**
       * THE TIER IS A PARAMETER OF THE RING, NOT THREE COPIES OF IT.
       *
       * When the Altar started taking a weapon three times this was the one
       * place that could quietly undo the fix above. The handbell bug was a
       * FIXED rate across every weapon stacking on itself; the cure was a rate
       * that is each gun's own plus a life shorter than its own cadence. Three
       * hand-tuned ring blocks per weapon would have been twenty-four numbers
       * with no rule connecting them, and the half that drifted would have been
       * the half nobody was listening to.
       *
       * So a tier scales the weapon's OWN ring by a fixed ladder:
       *
       *   `ms` DOES NOT MOVE. It is derived from the weapon's cadence so the
       *   shimmer from one round is over before the next round leaves the
       *   barrel. That is the entire anti-stacking guarantee and a tier has no
       *   business touching it. This is the load-bearing line of the block.
       *
       *   `rate` steps up 12 per cent a tier, which is close enough to a
       *   semitone to read as the same bell cast smaller rather than as a
       *   different object.
       *
       *   `gain` steps 18 per cent, which is under 1.5 dB - present, and nowhere
       *   near the ceiling the note above describes.
       */
      const tier = Math.max(1, Math.min(3, opts.tier || 1));
      const rate = R.rate * (1 + 0.12 * (tier - 1));
      const rgain = R.gain * (1 + 0.18 * (tier - 1));

      const rs = ctx.createBufferSource();
      rs.buffer = ringBuf;
      rs.playbackRate.value = rate * pitch * rand(0.97, 1.03);
      own(v, rs);
      const rg = gain(v, rgain);
      rs.connect(rg); rg.connect(v.out);

      const rt = t + 0.004;
      // R.ms, never scaled by tier. See above.
      const life = Math.min(R.ms / 1000, ringBuf.duration / rs.playbackRate.value);
      rg.gain.setValueAtTime(rgain, rt);
      rg.gain.exponentialRampToValueAtTime(0.0005, rt + life);
      rg.gain.setValueAtTime(0, rt + life + 0.001);
      fire(v, rs, rt, rt + life + 0.02);
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // mechanical
  // ---------------------------------------------------------------------------

  /**
   * The whole mechanical vocabulary is one shape: a very short noise burst
   * through one filter. What separates a magazine seating from a safety click
   * is entirely filter type, centre frequency, Q, and duration, so they share
   * one implementation and differ only in numbers.
   */
  function transient(spec, opts = {}) {
    const v = voice({ dest: opts.dest, send: opts.send ?? 0.18, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    const pitch = opts.pitch ?? 1;

    const n = noiseSrc(v);
    const f = filt(v, spec.type, spec.hz * pitch, spec.q);
    const g = gain(v);
    n.connect(f); f.connect(g); g.connect(v.out);

    if (spec.sweepTo) glide(f.frequency, t, spec.hz * pitch, spec.sweepTo * pitch, spec.dur);

    const end = env(g.gain, t, spec.gain, spec.attack ?? 0.001, 0, spec.dur);
    fire(v, n, t, end + 0.02, noiseOffset(spec.dur));

    // Some of these have a low knock under them: a magazine hitting the well
    // is a click plus a thud, and the thud is most of the weight.
    if (spec.thumpHz) {
      const o = osc(v, 'sine', spec.thumpHz * pitch);
      const tg = gain(v);
      glide(o.frequency, t, spec.thumpHz * 1.5 * pitch, spec.thumpHz * 0.6 * pitch, 0.07);
      o.connect(tg); tg.connect(v.out);
      const tEnd = env(tg.gain, t, spec.thumpGain ?? 0.2, 0.002, 0, 0.07);
      fire(v, o, t, tEnd + 0.02);
    }

    return true;
  }

  const MECH = {
    // Sharp, dry, metallic. High Q so it rings for a couple of milliseconds.
    reloadClick: { type: 'bandpass', hz: 3200, q: 6,  dur: 0.030, gain: 0.34 },
    // Leaving the well: a scrape that brightens as it clears.
    magOut:      { type: 'bandpass', hz: 900,  q: 2.2, dur: 0.090, gain: 0.30,
                   sweepTo: 2600 },
    // Seating: the opposite sweep, plus the thud of the mag bottoming out.
    magIn:       { type: 'bandpass', hz: 2400, q: 2.0, dur: 0.075, gain: 0.36,
                   sweepTo: 700, thumpHz: 120, thumpGain: 0.30 },
    boltPull:    { type: 'bandpass', hz: 1800, q: 3.0, dur: 0.130, gain: 0.40,
                   sweepTo: 4200 },
    // ADS is cloth and a sling, not metal: lowpassed, soft attack, quiet.
    adsIn:       { type: 'lowpass',  hz: 900,  q: 0.7, dur: 0.070, gain: 0.16,
                   attack: 0.006 },
    adsOut:      { type: 'lowpass',  hz: 700,  q: 0.7, dur: 0.060, gain: 0.14,
                   attack: 0.006 },
    weaponSwitch:{ type: 'bandpass', hz: 1400, q: 1.4, dur: 0.180, gain: 0.26,
                   sweepTo: 520, thumpHz: 90, thumpGain: 0.18 },
    // Dry fire is the sound of nothing happening, and it has to be legible as
    // an error: very narrow, very short, no low end at all.
    dryFire:     { type: 'bandpass', hz: 4600, q: 12, dur: 0.022, gain: 0.30 },
  };

  // ---------------------------------------------------------------------------
  // voices that are not throats
  // ---------------------------------------------------------------------------

  /**
   * THE CODEC TICK: the sound of text being typed, one per character.
   *
   * Metal Gear Solid's codec, not Banjo-Kazooie's mouth. The distinction is the
   * whole design and it is not a downgrade, it is the correct fit twice over.
   *
   * WHAT IT SOLVES. A synthesised vocal blip is `groan()` with a shorter
   * envelope - the same two detuned sawtooths through the same 570 / 1100 /
   * 2410 Hz formant bank - and `groan()` is the mummy. The archaeologist would
   * have been built out of the horde's throat, at a different pitch, and pitch
   * is not what makes a formant bank recognisable. A codec tick is not a voice
   * and structurally cannot have that problem: it is a filtered burst, it
   * shares nothing with the horde but the output bus, and no amount of tuning
   * can make it sound like a body.
   *
   * WHAT MAKES IT READ AS MGS RATHER THAN AS A BEEP, in the order it matters:
   *
   *   ONE TICK PER CHARACTER, fired by the reveal in ui/pacer.js as each glyph
   *   lands. Not per word and not a loop under the line. The sound IS the
   *   typing, which is why this function takes no duration and no rhythm - the
   *   rhythm is the text, including the extra beat a full stop buys.
   *
   *   SHORT, DRY AND PERCUSSIVE. Tens of milliseconds, one-millisecond attack,
   *   exponential decay, no hold. A tick with a tail is a tone, and a tone is a
   *   vowel, and a vowel is the thing this exists to avoid.
   *
   *   SPEAKERS DIFFER BY PITCH AND FILTER, NOTHING ELSE. That is how one
   *   mechanism gave Snake, Campbell and Naomi three recognisable codec voices,
   *   and it is why the table below is two rows rather than two functions.
   *
   * THE SEPARATION, stated in numbers because "an octave or so apart" is not a
   * claim anybody can check:
   *
   *   her    336 Hz square through a 2100 Hz bandpass, Q 3.2, 32 ms
   *   gate   168 Hz square through a  820 Hz bandpass, Q 2.4, 52 ms
   *
   *   Exactly one octave of pitch and 1.36 octaves of filter centre between
   *   them, plus a 1.6x difference in length, which the ear reads as him being
   *   slower and heavier before it reads anything else. Against the horde:
   *   `groan()` runs `rand(62, 104)`, so the floor to clear is 104 Hz, and the
   *   lower of these two speakers sits 1.62x above it - 1.57x at the bottom of
   *   the jitter below. Neither speaker enters the mummy's register at any
   *   point in its range.
   *
   * THE JITTER is +/- 3 percent, about half a semitone. Enough that twenty
   * characters in a row are not a metronome, small enough that it stays a
   * rhythm rather than becoming a melody, and it moves the filter with the
   * pitch so a tick never sounds like a different instrument.
   */
  const CODEC = {
    her:  { hz: 336, filter: 2100, q: 3.2, dur: 0.032, gain: 0.16 },
    gate: { hz: 168, filter: 820,  q: 2.4, dur: 0.052, gain: 0.19 },
  };

  const CODEC_JITTER = 0.03;

  function codecTick(opts = {}) {
    const spec = CODEC[opts.voice] || CODEC.her;

    // A low send. A codec is close-miked by convention - it is in the ear, not
    // in the room - and a tick with the Great Gallery's tail on it stops being
    // percussive. It is not zero, because zero would make her the only sound in
    // the game that does not know which room it is in.
    const v = voice({ dest: opts.dest, send: opts.send ?? 0.10, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    const j = 1 + rand(-CODEC_JITTER, CODEC_JITTER);
    const pitch = (opts.pitch ?? 1) * j;

    const out = gain(v);
    out.connect(v.out);

    // Square rather than saw: an odd-harmonic series through a narrow bandpass
    // is hollow and electronic, which is what a codec is. A sawtooth here is
    // dense enough that the filter starts sounding like a formant, and a
    // formant is a mouth.
    const band = filt(v, 'bandpass', spec.filter * pitch, spec.q);
    band.connect(out);
    const o = osc(v, 'square', spec.hz * pitch);
    o.connect(band);

    const end = env(out.gain, t, spec.gain, 0.001, 0, spec.dur);
    fire(v, o, t, end + 0.01);

    // The consonant. A hair of bandpassed noise on the leading edge, a third of
    // the length of the pitched part, which is what stops each tick reading as
    // a musical note and starts it reading as a key being struck.
    const n = noiseSrc(v);
    const nf = filt(v, 'bandpass', spec.filter * 1.6 * pitch, 1.1);
    const ng = gain(v);
    n.connect(nf); nf.connect(ng); ng.connect(out);
    const nEnd = env(ng.gain, t, spec.gain * 0.42, 0.0008, 0, spec.dur * 0.34);
    fire(v, n, t, nEnd + 0.01, noiseOffset(spec.dur));

    return true;
  }

  // ---------------------------------------------------------------------------
  // enemies
  // ---------------------------------------------------------------------------

  /**
   * THE ROSTER USED TO HAVE ONE THROAT.
   *
   * Every enemy in this game played `groan` and was told apart by
   * `spec.voicePitch`, one scalar, applied to the oscillator and to nothing
   * else. The formant bank - 570 / 1100 / 2410 Hz, the thing that actually
   * makes a sound read as a mouth - was identical on all six. That is why they
   * all sounded like the same creature, and it is why the scarab, a beetle,
   * sounded like a man moaning quickly: it WAS a man moaning quickly.
   *
   * Measured, before this table existed, over nine renders of each enemy's tell:
   * all fifteen pairs sat within a third of an octave of each other in
   * brightness and length, and the spectral-shape similarity between any two of
   * them ran 0.87 to 0.995 against a scale where 1.0 is the same filter bank.
   * Pitch cannot move that number. Only the bank can.
   *
   * So the bank moves. Each throat below owns its own formants, its own
   * register, its own length and its own way of falling apart, and
   * `voicePitch` goes back to being what it always claimed to be: which body
   * this is, not which species.
   *
   *   shambler  the original, unchanged, so the enemy the whole game is tuned
   *             against sounds exactly as it did.
   *   husk      dry and fast. Formants an octave up, a third of the length, and
   *             a papery breath over the top - it is a desiccated thing and it
   *             shrieks rather than moans.
   *   bound     enormous and slow. Formants down to a closed vowel, a sub sine
   *             under it, and nearly three seconds long.
   *   censer    NOT a groan at all. It is the only enemy that stands still and
   *             watches, and its tell has to carry across a room over the
   *             bodies in front of the player, so it intones: near-monotone,
   *             vibrato'd, narrow high-Q formants. A chant, not a moan.
   *
   * A caller that names no throat gets the shambler, so `enemies/boss.js` -
   * which is not this pass's to touch - keeps the voice it was tuned with.
   */
  const THROATS = {
    shambler: {
      base: [62, 104], dur: [0.75, 1.5],
      formants: [[570, 9, 1.0], [1100, 11, 0.55], [2410, 14, 0.22]],
      lean: [[570, 9, 1.0], [1100, 11, 0.50]],
      peak: 0.30, attack: 0.10, hold: 0.35, decay: 0.65,
      sagUp: [1.02, 1.14], sagDown: [0.78, 0.94],
      detune: [-11, 14],
    },

    /**
     * Dried out. The formants sit where a mouth with no soft tissue left in it
     * would resonate, the whole event is a third of a shambler's length, and
     * `breath` is the layer that does most of the work: bandpassed noise riding
     * the same envelope, which is the sound of air moving through something
     * that has no business breathing.
     */
    husk: {
      base: [150, 205], dur: [0.26, 0.46],
      /**
       * The top formant is 0.18 rather than the shambler's 0.22, and the breath
       * is narrow (Q 1.8) rather than the wide band it started as, and both of
       * those were pulled DOWN after measuring rather than chosen by ear.
       *
       * The first draft put the husk's spectral centroid at 3060 Hz. That is a
       * perfectly good shriek and it broke the roster: the scarab has to sit a
       * clear octave above every voice in the game or the tap on stone starts
       * competing with the brightest throat, and at 3060 the husk had eaten most
       * of the gap. A wide breath band is where it went - Q 0.8 at 2.1 kHz is
       * most of an octave of noise sitting directly under the scarab.
       */
      formants: [[790, 8, 1.0], [1620, 10, 0.55], [2800, 12, 0.18]],
      lean: [[790, 8, 1.0], [1620, 10, 0.50]],
      peak: 0.26, attack: 0.018, hold: 0.18, decay: 0.82,
      sagUp: [1.00, 1.06], sagDown: [0.58, 0.74],
      detune: [-23, 27],
      breath: { amt: 0.26, hz: 1600, q: 1.8 },
    },

    /**
     * The big one. Everything is lower and longer, and the sub sine is not
     * decoration: at 0.62 voicePitch the fundamental lands near 30 Hz, which is
     * felt rather than heard, and the half-frequency sine is what puts the mass
     * back into the part of the spectrum a laptop speaker can actually move.
     */
    bound: {
      base: [58, 80], dur: [1.7, 2.7],
      formants: [[300, 8, 1.0], [640, 10, 0.42], [1150, 13, 0.10]],
      lean: [[300, 8, 1.0], [640, 10, 0.40]],
      peak: 0.30, attack: 0.22, hold: 0.40, decay: 0.60,
      sagUp: [1.01, 1.08], sagDown: [0.72, 0.88],
      detune: [-7, 9],
      sub: 0.42,
    },

    /**
     * A CHANT, AND THE STEADINESS IS THE WHOLE CUE.
     *
     * Every other throat here sags: the pitch falls across the sound, because a
     * body running out of air does that, and constant pitch reads as mechanical.
     * This one deliberately does not. It holds its note, wavers on a slow
     * vibrato, and that is what the ear separates first - long before it gets to
     * timbre, it has already heard that this one is not dying, it is singing.
     *
     * The formants are narrow (Q 14 to 18 against the shambler's 9 to 14) and
     * low, which is a closed, nasal intonation rather than an open vowel. It has
     * to be tellable from the bodies actually in front of the player, because
     * this enemy's threat is that it is somewhere else.
     */
    censer: {
      base: [128, 150], dur: [1.2, 1.9],
      formants: [[430, 14, 1.0], [880, 16, 0.45], [1800, 18, 0.12]],
      lean: [[430, 14, 1.0], [880, 16, 0.42]],
      peak: 0.28, attack: 0.26, hold: 0.50, decay: 0.50,
      sagUp: [1.00, 1.02], sagDown: [0.96, 1.00],
      detune: [-5, 6],
      vibrato: { hz: [4.6, 6.2], depth: 0.017 },
    },
  };

  /**
   * A voice: detuned sawtooths through parallel bandpass formants.
   *
   * The formants are what make it read as a throat rather than a synthesiser,
   * and the detune between the two sawtooths gives the beat that makes it sound
   * like a body rather than an oscillator. Which formants, which register and
   * how long is the throat's business; everything below is the same machine
   * driven by the table above.
   */
  function groan(opts = {}) {
    const T = THROATS[opts.throat] || THROATS.shambler;

    const v = voice({ dest: opts.dest, send: opts.send ?? 0.45, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    const base = rand(T.base[0], T.base[1]) * (opts.pitch ?? 1);
    const dur = rand(T.dur[0], T.dur[1]);

    const out = gain(v);
    // A throat is a body in a room. Nothing about the elevation cue is right
    // for it, but routing it through the same helper costs one branch and keeps
    // every enemy sound on one path to the output.
    out.connect(skyward(v, opts.elev));

    // The sawtooths meet here and fan out into the formants. Nothing reaches
    // the output unfiltered, which is the point: raw saw is a synth patch.
    const mix = gain(v, 1);

    // Low fidelity drops to two formants, which halves the filter count across
    // a whole horde and is barely audible on any single enemy.
    const formants = highFidelity ? T.formants : T.lean;

    for (const [hz, q, amt] of formants) {
      const f = filt(v, 'bandpass', hz * rand(0.9, 1.12), q);
      const fg = gain(v, amt);
      mix.connect(f); f.connect(fg); fg.connect(out);
    }

    const end = env(out.gain, t, T.peak, T.attack, dur * T.hold, dur * T.decay);

    // The vibrato, if this throat holds a note rather than losing one. Wired
    // into the oscillators' frequency as a signal, so it sums with the glide
    // automation instead of fighting it for the same AudioParam.
    let vib = null;
    if (T.vibrato && highFidelity) {
      const lfo = osc(v, 'sine', rand(T.vibrato.hz[0], T.vibrato.hz[1]));
      vib = gain(v, base * T.vibrato.depth);
      lfo.connect(vib);
      fire(v, lfo, t, end + 0.03);
    }

    for (const detune of T.detune) {
      const o = osc(v, 'sawtooth', base);
      o.detune.value = detune;
      // The sag: pitch falling across the sound. A throat that holds its note
      // has a sagDown near 1.0 and this becomes the near-flat line it wants.
      glide(o.frequency, t, base * rand(T.sagUp[0], T.sagUp[1]),
            base * rand(T.sagDown[0], T.sagDown[1]), dur);
      if (vib) vib.connect(o.frequency);
      o.connect(mix);
      fire(v, o, t, end + 0.03);
    }

    // Air moving through it, for the throats that have any.
    if (T.breath && highFidelity) {
      const n = noiseSrc(v);
      const nf = filt(v, 'bandpass', T.breath.hz, T.breath.q);
      const ng = gain(v);
      n.connect(nf); nf.connect(ng); ng.connect(out);
      env(ng.gain, t, T.peak * T.breath.amt, T.attack, dur * T.hold, dur * T.decay);
      fire(v, n, t, end + 0.03, noiseOffset(dur + 0.1));
    }

    // The mass under the big one.
    if (T.sub) {
      const s = osc(v, 'sine', base * 0.5);
      const sg = gain(v);
      glide(s.frequency, t, base * 0.5, base * 0.4, dur);
      s.connect(sg); sg.connect(v.out);
      env(sg.gain, t, T.peak * T.sub, T.attack, dur * T.hold, dur * T.decay);
      fire(v, s, t, end + 0.03);
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // the things that are not throats
  // ---------------------------------------------------------------------------

  /**
   * THE ELEVATION CUE, AND WHY IT IS A FILTER RATHER THAN A PANNER SETTING.
   *
   * Gold scarabs crawl walls and ceilings, so for the first time in this game a
   * sound can be directly over the player's head. A PannerNode on HRTF is good
   * at left and right and poor at up and down, and equal-power - which is what
   * low fidelity falls back to - has no elevation information at all. Neither
   * of them can tell you that the scuttling is on the ceiling.
   *
   * The ear does it with the pinna. Sound arriving from above reaches the ear
   * canal without the shadowing the outer ear applies to sound from in front,
   * and the result is a broad rise around seven to eight kilohertz - one of
   * Blauert's directional bands, and the reason a sound EQ'd there is heard as
   * higher even over headphones with no head movement at all.
   *
   * So that is what this does: one peaking filter at 7.4 kHz, scaled by how far
   * overhead the source actually is, and nothing at all when the source is level
   * with or below the player. One node, only when it is needed, and it stacks on
   * top of whatever the panner is already doing rather than replacing it.
   *
   * The caller supplies `elev` as the sine of the elevation angle: the vertical
   * component of the unit vector from the listener to the source, so straight
   * overhead is 1 and level is 0.
   */
  const ELEV_HZ = 7600;
  const ELEV_DB = 9.0;
  // The band the pinna emphasises for sources in FRONT of the listener. Taking
  // it out is the other half of the same cue and it doubles the contrast for
  // one more node: measured, the boost alone moved a step's spectral centroid
  // by 3 per cent, which is inside the draw-to-draw spread and therefore not a
  // cue at all. The pair moves it by enough to survive being measured.
  const ELEV_FRONT_HZ = 4000;
  const ELEV_FRONT_DB = -5.5;
  const ELEV_FLOOR = 0.12;

  function skyward(v, elev) {
    const e = clamp(elev || 0, -1, 1);
    if (e <= ELEV_FLOOR) return v.out;
    const p = filt(v, 'peaking', ELEV_HZ, 1.0);
    p.gain.value = ELEV_DB * e;
    p.connect(v.out);
    const f = filt(v, 'peaking', ELEV_FRONT_HZ, 1.2);
    f.gain.value = ELEV_FRONT_DB * e;
    f.connect(p);
    return f;
  }

  /**
   * CHITIN.
   *
   * "The bug should sound like little steps on brick, coming toward you,
   * because that's what they are." That is the brief, and it is also a very good
   * fit for synthesis: a leg tapping stone is a short filtered transient, which
   * is the one thing synthesis does better than anything else. There is nothing
   * to model here - no glottis, no vocal tract, no vowel - just a small hard
   * thing hitting a big hard thing.
   *
   * FOUR THINGS MAKE IT AN ANIMAL RATHER THAN A METRONOME:
   *
   *   IT IS A GROUP, NOT A TICK. Insects walk in alternating tripods - three
   *   legs down, three legs swinging - so one step event is three taps, not one.
   *   That is why `taps` is three and why they share a voice.
   *
   *   THE TAPS ARE NOT EVENLY SPACED and they are not the same colour. Each one
   *   gets its own gap, its own centre frequency and its own length out of the
   *   ranges below. A perfectly even tick is a machine; three taps at 14, 31 and
   *   22 milliseconds with three different resonances is a creature.
   *
   *   THE RATE IS NOT IN HERE. It belongs to the actor, and enemies/mummy.js
   *   drives it off distance covered rather than off a timer, so a scarab
   *   charging you patters and one picking its way does not. Putting a loop in
   *   this function would be the same mistake the old code made in a new place.
   *
   *   IT LIVES ABOVE EVERYTHING ELSE IN THE MIX. The taps sit at 3.4 to 7 kHz,
   *   which is the 'high' band and above. The gunshot's weight is at 60 to 200,
   *   its crack at 800 to 3000, and codecTick - which carries every word of
   *   story text in this game - is a 336 Hz square through a 2.1 kHz bandpass or
   *   a 168 through an 820. Nothing about a scarab is allowed in there.
   *
   * The body thump is the only low content and it is deliberately tiny: a
   * 200 Hz sine at a twentieth of the tap level for thirty milliseconds, which
   * is the mass behind the leg rather than a footfall. It comes off entirely
   * when the source is overhead, because a body on a ceiling is not coupled to
   * the floor the player is standing on.
   */
  const CHITIN = {
    scarab: {
      taps: 3,
      gap: [0.014, 0.036],
      // The floor is 3.8 kHz and it is a MIXING constraint, not a taste one:
      // the band from 800 to 3000 Hz belongs to the gunshot's crack and to
      // codecTick, and a tap centred at 3.4 with its envelope's sidebands
      // either side of it was putting energy squarely in the middle of it.
      hz: [3800, 7200], q: [6, 13],
      dur: [0.004, 0.010],
      gain: [0.22, 0.38],
      bodyHz: [180, 260], bodyGain: 0.050, bodyDur: 0.030,
      ring: 0,
      // Stridulation: the shell rasp it makes when it rears to bite. Fast
      // amplitude modulation on filtered noise, which is what a file drawn
      // across a ridge actually is.
      rasp: { hz: [2600, 4300], q: 2.2, am: [46, 78], dur: [0.16, 0.30], gain: 0.17 },

      /**
       * A ROUND OFF THE CARAPACE. No sine under it, and that is the whole point.
       *
       * bodyHit is a 620 Hz lowpass over a 105 Hz sine, and that sine is exactly
       * what makes it read as meat: a wet mass absorbing a round. A beetle has
       * no such mass. It has a thin hard shell over a void, so the impact is a
       * knock plus a short resonance, and there is nothing underneath to thud.
       *
       * The two ring partials are deliberately not in a whole-number ratio. A
       * ratio is a pitched note; a carapace is a lumpy irregular cavity that
       * rings at whatever its geometry says rather than at a fundamental with a
       * harmonic series stacked over it.
       */
      // The partials sit at 1.68 and 2.48 kHz rather than the 1.15 and 1.72 they
      // started at. A cavity resonates higher the smaller it is, and the thing
      // being struck is a shell the size of a dog's back, not a chest - the
      // first draft measured a spectral centroid of 2200 Hz against the 1163 of
      // the flesh thud it replaced, which is under an octave of separation and
      // not enough to be sure of by ear.
      hit: { hz: 3100, q: 3.5, dur: 0.018, gain: 0.30,
             ring: [1680, 2480], ringGain: 0.09, ringDecay: 0.055 },

      /**
       * THE ORDINARY SCARAB'S CRIT IS ITS SKULL, and the roster is NOT uniform
       * about that - see the gold scarab's block below, where it is not.
       *
       * buildScarab tags the head, the sockets and the jaws 'head', so a crit
       * here is the same act it is on every humanoid in the game: a hard thing
       * broken. It gets the shatter treatment - a dry bright entry, the
       * descending ping that is this game's shared "you earned 100" marker, and
       * fragments leaving.
       */
      crit: { hz: 3000, q: 4.0, dur: 0.014, gain: 0.34,
              pingFrom: 2600, pingTo: 1000, pingMs: 100, pingGain: 0.20,
              vent: false, fragHz: [3000, 6200], fragGain: 0.13 },
    },

    /**
     * Plated, and heavier. Same creature, three changes: the taps are lower and
     * longer because the leg hitting the stone is armoured and has mass behind
     * it, the gaps are wider because the body is slower, and there is a genuine
     * metallic ring on top - two inharmonic partials, short, which is what gold
     * plate over chitin does that bare chitin does not.
     *
     * The ring is dropped at low fidelity. It is four of the fourteen nodes a
     * gold scarab's step costs and it is the layer whose absence is least
     * noticeable in a fight.
     */
    goldscarab: {
      taps: 3,
      gap: [0.022, 0.050],
      // Lower than the scarab's because the leg is armoured and has mass behind
      // it, and it stops exactly at the highpass corner the tap group runs
      // through. Below 3 kHz is the gunshot's crack and the codec's speech, and
      // a tap placed there would only be attenuated back out again - the weight
      // this variant needs comes from the body thump and the ring, both of
      // which have their own route.
      hz: [3000, 5400], q: [9, 18],
      dur: [0.008, 0.018],
      gain: [0.24, 0.40],
      bodyHz: [120, 185], bodyGain: 0.075, bodyDur: 0.045,
      ring: 0.075, ringHz: [3300, 5200], ringDecay: [0.050, 0.090],
      rasp: { hz: [1500, 2700], q: 3.0, am: [26, 44], dur: [0.22, 0.42], gain: 0.19 },

      // A round off GOLD PLATE. Higher and longer-ringing than bare chitin,
      // because that is what a metal skin over a cavity does - it is the same
      // argument the step's ring block makes, at the moment of impact.
      hit: { hz: 3400, q: 4.5, dur: 0.022, gain: 0.32,
             ring: [2200, 3150], ringGain: 0.12, ringDecay: 0.085 },

      /**
       * THE GOLD SCARAB'S CRIT IS NOT ITS HEAD, AND THIS IS THE ONE SOUND IN THE
       * GAME THAT HAS TO TEACH THAT.
       *
       * buildGoldScarab re-tags the skull, the sockets and the jaws to 'body'
       * and hands 'head' to the abdomen and the vent panel on the back of it.
       * The entire variant is built to punish the headshot habit the first six
       * waves spend teaching, and the payout follows the region - so a player who
       * hears the crit cue when they shoot the skull has been taught a lie about
       * where the hundred comes from.
       *
       * Two consequences, and both fall out of the region tags for free:
       *
       *   A SKULL HIT GETS `hit`, not `crit`, because the skull is region
       *   'body' on this variant. The armour-plate knock is the correct and
       *   honest answer: nothing happened, try somewhere else.
       *
       *   THE VENT GETS A PUNCTURE RATHER THAN A SHATTER. It is the one gap in
       *   the armour, so the round goes IN rather than off - low, wet and
       *   hollow where the scarab's skull crit is high and dry, with the shared
       *   descending ping over it so it still reads as the crit, and a hiss
       *   venting out of the hole afterwards instead of fragments scattering.
       */
      // The escaping gas sits at 3.4 kHz, not the 2.4 it started at, and that is
      // the physically honest place for it as well as the polite one: a jet
      // through a small aperture is high and hissy, not midrange. At 2.4 it was
      // sitting on top of codecTick's band and measured 2.4 dB hotter there than
      // headshotHit, which is the cue this game already fires on every crit and
      // therefore the ceiling this one has to live under.
      /**
       * THE PING IS AN OCTAVE UNDER THE SCARAB'S, and it was measurement rather
       * than taste that put it there.
       *
       * It started at 1500 sweeping to 520, and the band table said this sound
       * carried 11 dB MORE energy in 800-3000 Hz than in the octave below it -
       * which was the tell. The low entry is not what sits in the codec's band;
       * a triangle whose fundamental sweeps from 1500 spends its whole 154 ms
       * crossing the middle of it, and it measured 2.25 dB hotter there than
       * headshotHit, the loudest crit cue in the game and this one's ceiling.
       *
       * Sweeping 1100 to 380 puts the fundamental under the band for most of its
       * life. It also buys the thing the design wanted anyway: the scarab's
       * skull crit pings 2600 to 1000 and this one now answers a full octave
       * below it, so the two crits are told apart by register before anything
       * else - which is correct, because one is a small skull breaking and the
       * other is a round going into a body the size of a wheelbarrow.
       */
      crit: { hz: 700, q: 2.2, dur: 0.032, gain: 0.26,
              pingFrom: 1100, pingTo: 380, pingMs: 140, pingGain: 0.22,
              vent: true, ventHz: 3800, ventQ: 1.0, ventDur: 0.18, ventGain: 0.085 },
    },
  };

  /**
   * ONE STEP: a tripod of leg taps on stone.
   *
   * opts.dist is how far the body is from the player, in metres, and it is not
   * optional in the game - it is what the step pool allocates on. A caller that
   * omits it is treated as standing on the player, which is the right default
   * for a bench and the wrong one for a horde.
   */
  function chitinStep(opts = {}) {
    const C = CHITIN[opts.chitin] || CHITIN.scarab;
    const dist = opts.dist ?? 0;

    if (!stepSlotOpen(dist)) return false;

    const elev = clamp(opts.elev || 0, -1, 1);
    const v = voice({
      dest: opts.dest,
      // A ceiling couples a tick into the room more than a floor does, and the
      // extra send is most of what sells "that is above me" once the filter has
      // told the ear where to look.
      send: opts.send ?? (0.16 + 0.14 * Math.max(elev, 0)),
      gain: opts.gain ?? 1,
    });
    if (!v) return false;
    claimStepSlot(v, dist);

    const t = now();
    const pitch = opts.pitch ?? 1;
    const skyOut = skyward(v, elev);

    /**
     * THE BAND PLAN, ENFORCED RATHER THAN INTENDED, and it took a measurement
     * to find out it was not being honoured.
     *
     * The taps are bandpassed at three and a half to seven kilohertz, so on
     * paper nothing about them is anywhere near codecTick's 820 to 2100 Hz.
     * Measured, a single step put as much energy in the 800-3000 Hz band as a
     * codec tick did, and six of them - the step pool's whole budget - lifted
     * that band by nearly eight decibels underneath a line of story text.
     *
     * The leak is not the filters, it is the ENVELOPE. Gating a signal with a
     * 0.6 ms attack is multiplying it by an edge, and an edge that fast has
     * sidebands more than a kilohertz wide; the gain node sits after the
     * bandpass, so the sidebands are generated downstream of the thing that was
     * supposed to contain them. Sharpening a tick past a certain point stops
     * making it sharper and starts making it broadband.
     *
     * Three corrections, and the first two were not enough on their own -
     * measured, they left the pool lifting the codec's band by ten decibels.
     *
     *   THE ATTACK goes to 1.5 ms. Still far shorter than the ear resolves as
     *   an onset, and it more than halves the sideband width. Softer than that
     *   and the tap stops being a tap.
     *
     *   THE TAP FLOOR moves up, so the sidebands that remain have somewhere to
     *   land that is not the codec's band. See CHITIN: the scarab now starts at
     *   3.8 kHz rather than 3.4, which puts its skirt above 3 kHz instead of
     *   through it.
     *
     *   TWO HIGHPASSES, not one, AT THE TOP OF THE PROTECTED BAND. A single
     *   pole pair at 1800 is barely a decibel down at 2 kHz, which is the middle
     *   of the band being protected - it looked like a fix and measured like
     *   nothing, twice. The corner is 3 kHz because that is exactly where the
     *   crack band ends, which turns the whole arrangement into a rule anyone
     *   can check rather than a number somebody picked: NOTHING A SCARAB'S LEGS
     *   DO IS ALLOWED BELOW 3 kHz. Cascaded there it is sixteen decibels down at
     *   2 kHz and six at the corner itself.
     *
     * The body thump deliberately bypasses all of it - it is the one part of
     * this sound that is allowed to be low, and it goes straight to the voice.
     */
    const out = filt(v, 'highpass', 3000, 0.7);
    const out2 = filt(v, 'highpass', 3000, 0.7);
    out.connect(out2); out2.connect(skyOut);

    // One noise source for the whole group, read once and gated three times.
    // Three separate sources would be three more nodes per step for a
    // difference nobody can hear, and this is the sound that happens most often
    // in the game.
    const span = 0.02 + C.gap[1] * C.taps;
    const n = noiseSrc(v);

    let at = t;
    let last = t;
    for (let i = 0; i < C.taps; i++) {
      const dur = rand(C.dur[0], C.dur[1]);
      const f = filt(v, 'bandpass', rand(C.hz[0], C.hz[1]) * pitch, rand(C.q[0], C.q[1]));
      const g = gain(v);
      n.connect(f); f.connect(g); g.connect(out);
      // The first leg down is the loudest; the two behind it are lighter, which
      // is what stops three taps reading as three separate animals.
      const amp = rand(C.gain[0], C.gain[1]) * (i === 0 ? 1 : rand(0.45, 0.78));
      last = env(g.gain, at, amp, 0.0015, 0, dur);
      at += rand(C.gap[0], C.gap[1]);
    }
    fire(v, n, t, Math.max(last, at) + 0.02, noiseOffset(span + 0.05));

    // The mass behind the leg. It fades out continuously as the body climbs -
    // a scarab on a ceiling is not coupled to the floor the player is standing
    // on - and is skipped outright once the fade has taken it under a sixth,
    // which is two nodes saved on exactly the bodies that are furthest away.
    if (highFidelity && elev < 0.85) {
      const o = osc(v, 'sine', rand(C.bodyHz[0], C.bodyHz[1]) * pitch);
      const og = gain(v);
      glide(o.frequency, t, rand(C.bodyHz[0], C.bodyHz[1]) * pitch, C.bodyHz[0] * 0.7 * pitch,
            C.bodyDur);
      o.connect(og); og.connect(v.out);
      const oEnd = env(og.gain, t, C.bodyGain * (1 - Math.max(elev, 0)), 0.002, 0, C.bodyDur);
      fire(v, o, t, oEnd + 0.02);
    }

    // Gold plate over chitin. Two partials, deliberately not in a ratio, so it
    // rings rather than chimes.
    if (C.ring && highFidelity) {
      const hz = rand(C.ringHz[0], C.ringHz[1]) * pitch;
      for (const [mul, amt] of [[1, 1], [1.41, 0.55]]) {
        const o = osc(v, 'sine', hz * mul);
        const og = gain(v);
        o.connect(og); og.connect(out);
        const d = rand(C.ringDecay[0], C.ringDecay[1]);
        const e = env(og.gain, t + 0.001, C.ring * amt, 0.0008, 0, d);
        fire(v, o, t + 0.001, e + 0.02);
      }
    }

    return true;
  }

  /**
   * The rasp: stridulation, and the scarab's whole vocabulary above the legs.
   *
   * It replaces the groan on a scarab - the wind-up tell and the idle tell both
   * - and it has to be structurally incapable of sounding like a mouth, so it
   * has no oscillator in it at all. Bandpassed noise, amplitude modulated in the
   * forties to seventies, which is a file drawn across a ridge and is exactly
   * what the animal is doing.
   *
   * The modulation is an oscillator wired into a gain param rather than
   * scheduled automation, the same trick deathRattle uses: it is cheaper and it
   * is the only way to get a fast irregular-sounding tremolo without scheduling
   * dozens of ramps.
   */
  function chitinRasp(opts = {}) {
    const C = CHITIN[opts.chitin] || CHITIN.scarab;
    const R = C.rasp;

    const v = voice({ dest: opts.dest, send: opts.send ?? 0.28, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    const pitch = opts.pitch ?? 1;
    const dur = rand(R.dur[0], R.dur[1]);
    const out = skyward(v, opts.elev);

    const g = gain(v);
    g.connect(out);

    const f = filt(v, 'bandpass', rand(R.hz[0], R.hz[1]) * pitch, R.q);
    f.connect(g);

    // The teeth. 0.55 static plus a 0.45 swing means the gain reaches nearly
    // zero between strokes, which is what makes it a rasp and not a warble.
    const trem = gain(v, 0.55);
    trem.connect(f);
    const end = env(g.gain, t, R.gain, 0.008, dur * 0.25, dur * 0.75);

    const lfo = osc(v, 'square', rand(R.am[0], R.am[1]));
    const lfoAmt = gain(v, 0.45);
    lfo.connect(lfoAmt); lfoAmt.connect(trem.gain);
    fire(v, lfo, t, end + 0.02);

    const n = noiseSrc(v);
    n.connect(trem);
    fire(v, n, t, end + 0.02, noiseOffset(dur + 0.1));

    return true;
  }

  /**
   * A shell coming apart: the scarab's death, and the one place it is allowed
   * to be loud.
   *
   * Three layers and none of them is a voice. A dry snap high up, a crunch
   * sweeping down under it as the carapace folds, and then the legs and the
   * pieces scattering - which is the layer that says this was a thing with an
   * exoskeleton rather than a thing with lungs.
   */
  function shellCrack(opts = {}) {
    const C = CHITIN[opts.chitin] || CHITIN.scarab;

    const v = voice({ dest: opts.dest, send: opts.send ?? 0.42, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    const pitch = opts.pitch ?? 1;
    const out = skyward(v, opts.elev);

    // The snap.
    const s = noiseSrc(v);
    const sf = filt(v, 'highpass', 2300 * pitch, 0.9);
    const sg = gain(v);
    s.connect(sf); sf.connect(sg); sg.connect(out);
    const sEnd = env(sg.gain, t, 0.36, 0.0006, 0, 0.030);
    fire(v, s, t, sEnd + 0.02, noiseOffset(0.05));

    // The crunch: the carapace folding, which is a resonance collapsing.
    const c = noiseSrc(v);
    const cf = filt(v, 'bandpass', 1900 * pitch, 3.2);
    const cg = gain(v);
    glide(cf.frequency, t, 1900 * pitch, 520 * pitch, 0.14);
    c.connect(cf); cf.connect(cg); cg.connect(out);
    const cEnd = env(cg.gain, t, 0.26, 0.003, 0, 0.15);
    fire(v, c, t, cEnd + 0.02, noiseOffset(0.18));

    // The pieces. Same tap machinery as a step, scattered wide and falling
    // quiet, so a death is audibly made of the same material as a footstep.
    const p = noiseSrc(v);
    let at = t + 0.05, last = at;
    const pieces = highFidelity ? 4 : 2;
    for (let i = 0; i < pieces; i++) {
      const f = filt(v, 'bandpass', rand(C.hz[0], C.hz[1]) * pitch, rand(C.q[0], C.q[1]));
      const g = gain(v);
      p.connect(f); f.connect(g); g.connect(out);
      last = env(g.gain, at, rand(0.06, 0.17) * (1 - i / (pieces + 1)), 0.0008, 0,
                 rand(0.006, 0.016));
      at += rand(0.030, 0.095);
    }
    fire(v, p, t + 0.05, Math.max(last, at) + 0.02, noiseOffset(0.5));

    return true;
  }

  /** A soft noise thud plus a low knock. Deliberately quiet and dark. */
  function footfall(opts = {}) {
    const v = voice({ dest: opts.dest, send: opts.send ?? 0.30, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    const pitch = (opts.pitch ?? 1) * rand(0.9, 1.12);

    const n = noiseSrc(v);
    const f = filt(v, 'lowpass', 260 * pitch, 1.1);
    const g = gain(v);
    n.connect(f); f.connect(g); g.connect(v.out);
    const end = env(g.gain, t, 0.20, 0.004, 0, 0.11);
    fire(v, n, t, end + 0.02, noiseOffset(0.13));

    const o = osc(v, 'sine', 68 * pitch);
    const og = gain(v);
    glide(o.frequency, t, 68 * pitch, 44 * pitch, 0.08);
    o.connect(og); og.connect(v.out);
    const oEnd = env(og.gain, t, 0.16, 0.003, 0, 0.08);
    fire(v, o, t, oEnd + 0.02);

    return true;
  }

  /** A claw through air: bandpassed noise sweeping upward, then gone. */
  function swipe(opts = {}) {
    return transient({
      type: 'bandpass', hz: 380, q: 1.6, dur: 0.22, gain: 0.28,
      sweepTo: 3200, attack: 0.02,
    }, { ...opts, send: opts.send ?? 0.30 });
  }

  /**
   * A death rattle is a groan with the air running out: lower, longer, and
   * amplitude modulated so it stutters. The stutter comes from an oscillator
   * wired into a gain param rather than from scheduled automation, which is
   * both cheaper and the only way to get an irregular-sounding tremolo without
   * scheduling dozens of ramp events.
   */
  function deathRattle(opts = {}) {
    const v = voice({ dest: opts.dest, send: opts.send ?? 0.50, gain: opts.gain ?? 1 });
    if (!v) return false;

    /**
     * The throat this body had while it was alive, if it named one.
     *
     * A death that came out of a different mouth than the groan did is the same
     * bug as the horde sharing one throat, played once per enemy instead of
     * every four seconds. The register is taken from the throat and dropped to
     * about two thirds - which is what a larynx does when it stops being held
     * up - and the resonance the rattle sweeps down from is the throat's own
     * first formant rather than a fixed 480 Hz.
     */
    const T = THROATS[opts.throat] || THROATS.shambler;
    const top = T.formants[0][0] * 0.85;

    const t = now();
    const base = rand(T.base[0], T.base[1]) * 0.68 * (opts.pitch ?? 1);
    const dur = rand(T.dur[0], T.dur[1]) * 1.25;

    const out = gain(v);
    out.connect(skyward(v, opts.elev));

    const f = filt(v, 'bandpass', top, 4.5);
    glide(f.frequency, t, top, top * 0.38, dur);
    f.connect(out);

    const end = env(out.gain, t, 0.30, 0.06, dur * 0.2, dur * 0.8);

    const trem = gain(v, 0.55);
    trem.connect(f);
    const lfo = osc(v, 'sine', rand(9, 15));
    const lfoAmt = gain(v, 0.42);
    lfo.connect(lfoAmt); lfoAmt.connect(trem.gain);
    fire(v, lfo, t, end + 0.03);

    for (const detune of [-18, 21]) {
      const o = osc(v, 'sawtooth', base);
      o.detune.value = detune;
      glide(o.frequency, t, base, base * 0.62, dur);
      o.connect(trem);
      fire(v, o, t, end + 0.03);
    }

    // A rasp of noise on top, so it is a body and not just a chord.
    const n = noiseSrc(v);
    const nf = filt(v, 'bandpass', 1500, 1.2);
    const ng = gain(v);
    n.connect(nf); nf.connect(ng); ng.connect(out);
    env(ng.gain, t, 0.10, 0.08, dur * 0.2, dur * 0.7);
    fire(v, n, t, end + 0.03, noiseOffset(dur + 0.1));

    return true;
  }

  /** Body hit: dull, dark, no transient edge. Reads as meat. */
  function bodyHit(opts = {}) {
    const v = voice({ dest: opts.dest, send: opts.send ?? 0.25, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    const pitch = (opts.pitch ?? 1) * rand(0.92, 1.10);

    const n = noiseSrc(v);
    const f = filt(v, 'lowpass', 620 * pitch, 1.3);
    const g = gain(v);
    n.connect(f); f.connect(g); g.connect(v.out);
    const end = env(g.gain, t, 0.30, 0.002, 0, 0.085);
    fire(v, n, t, end + 0.02, noiseOffset(0.1));

    const o = osc(v, 'sine', 105 * pitch);
    const og = gain(v);
    glide(o.frequency, t, 105 * pitch, 62 * pitch, 0.09);
    o.connect(og); og.connect(v.out);
    const oEnd = env(og.gain, t, 0.26, 0.002, 0, 0.09);
    fire(v, o, t, oEnd + 0.02);

    return true;
  }

  /**
   * Headshot: the single most important piece of feedback in the game, so it
   * is built to be unmistakable against a body hit. Bright noise crack, a
   * descending ping, a wet crunch under it. Different in register, not merely
   * louder, because level alone is exactly what a player stops noticing.
   */
  function headshotHit(opts = {}) {
    const v = voice({ dest: opts.dest, send: opts.send ?? 0.35, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    const pitch = (opts.pitch ?? 1) * rand(0.96, 1.06);

    const n = noiseSrc(v);
    const f = filt(v, 'highpass', 2000 * pitch, 0.9);
    const g = gain(v);
    n.connect(f); f.connect(g); g.connect(v.out);
    const end = env(g.gain, t, 0.34, 0.001, 0, 0.065);
    fire(v, n, t, end + 0.02, noiseOffset(0.08));

    const o = osc(v, 'triangle', 1900 * pitch);
    const og = gain(v);
    glide(o.frequency, t, 1900 * pitch, 760 * pitch, 0.13);
    o.connect(og); og.connect(v.out);
    const oEnd = env(og.gain, t, 0.20, 0.001, 0, 0.14);
    fire(v, o, t, oEnd + 0.02);

    const c = noiseSrc(v);
    const cf = filt(v, 'bandpass', 320 * pitch, 2.2);
    const cg = gain(v);
    c.connect(cf); cf.connect(cg); cg.connect(v.out);
    const cEnd = env(cg.gain, t, 0.24, 0.003, 0, 0.12);
    fire(v, c, t, cEnd + 0.02, noiseOffset(0.14));

    return true;
  }

  /**
   * A ROUND INTO A CARAPACE, which is the chitin answer to bodyHit.
   *
   * bodyHit and headshotHit were played for every enemy in the game, exactly as
   * groan was, and they are built out of the same assumption: that the thing
   * being shot is a wrapped human body. A 620 Hz lowpass over a 105 Hz sine IS
   * meat - a wet mass absorbing a round - and it is the wrong physics for an
   * insect. A beetle is a thin hard shell over a void.
   *
   * So this has no sine in it at all. A knock, and then the cavity ringing
   * behind it, which is what a hard hollow object does when you hit it and what
   * a body emphatically does not.
   *
   * NOT ROUTED THROUGH A PANNER, deliberately and exactly as bodyHit is not.
   * systems/damage.js plays hit confirmation dry and centred because it is
   * feedback about the player's own trigger pull, not an event in the room; the
   * body's own reaction - the stagger, the shell coming apart - is the part that
   * arrives positionally, from the actor's emitter.
   */
  function chitinHit(opts = {}) {
    const C = CHITIN[opts.chitin] || CHITIN.scarab;
    const H = C.hit;

    const v = voice({ dest: opts.dest, send: opts.send ?? 0.22, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    const pitch = (opts.pitch ?? 1) * rand(0.94, 1.08);
    const out = skyward(v, opts.elev);

    // The knock: the round arriving on plate.
    const n = noiseSrc(v);
    const f = filt(v, 'bandpass', H.hz * pitch, H.q);
    const g = gain(v);
    n.connect(f); f.connect(g); g.connect(out);
    const end = env(g.gain, t, H.gain, 0.0008, 0, H.dur);
    fire(v, n, t, end + 0.02, noiseOffset(H.dur + 0.02));

    // The shell behind it. Two partials, not in a ratio - see the table.
    if (highFidelity) {
      for (let i = 0; i < H.ring.length; i++) {
        const o = osc(v, 'sine', H.ring[i] * pitch * rand(0.97, 1.03));
        const og = gain(v);
        o.connect(og); og.connect(out);
        const rEnd = env(og.gain, t, H.ringGain * (i === 0 ? 1 : 0.62), 0.001, 0,
                         H.ringDecay * rand(0.85, 1.15));
        fire(v, o, t, rEnd + 0.02);
      }
    }

    return true;
  }

  /**
   * THE CRIT ON A CHITIN BODY, AND IT IS NOT THE SAME ACT ON BOTH OF THEM.
   *
   * `region === 'head'` does not mean a skull here. It means whatever
   * enemies/variants.js tagged 'head', and the two chitin variants tag it
   * differently ON PURPOSE:
   *
   *   the scarab      tags its actual head, sockets and jaws. A crit is a skull
   *                   broken, like everywhere else in the game.
   *   the gold scarab tags the ABDOMEN and the vent panel, and re-tags the skull
   *                   to 'body'. Its whole design is that the headshot habit the
   *                   first six waves teach is the wrong play against it.
   *
   * Both of those are the 100 payout, so both get the descending ping - that is
   * the cue the player has learned means a crit, and it is the one layer these
   * two share. What differs underneath it is what actually happened: a hard
   * thing shattering, or a round finding the one hole in the armour. `vent`
   * picks which, and it comes off the table rather than off a variant name, so
   * a third chitin body would declare its own answer rather than inherit one.
   */
  function chitinCrit(opts = {}) {
    const C = CHITIN[opts.chitin] || CHITIN.scarab;
    const K = C.crit;

    const v = voice({ dest: opts.dest, send: opts.send ?? 0.30, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    const pitch = (opts.pitch ?? 1) * rand(0.96, 1.05);
    const out = skyward(v, opts.elev);

    // The entry. High and dry through a skull, low and wet through a vent.
    const n = noiseSrc(v);
    const f = filt(v, 'bandpass', K.hz * pitch, K.q);
    const g = gain(v);
    n.connect(f); f.connect(g); g.connect(out);
    const end = env(g.gain, t, K.gain, 0.0008, 0, K.dur);
    fire(v, n, t, end + 0.02, noiseOffset(K.dur + 0.02));

    // The ping. The shared marker, and the reason a crit is legible as a crit
    // rather than merely as a different noise: it is the same descending
    // gesture headshotHit makes, at this body's own pitch.
    const o = osc(v, 'triangle', K.pingFrom * pitch);
    const og = gain(v);
    glide(o.frequency, t, K.pingFrom * pitch, K.pingTo * pitch, K.pingMs / 1000);
    o.connect(og); og.connect(out);
    const pEnd = env(og.gain, t, K.pingGain, 0.001, 0, K.pingMs / 1000 * 1.1);
    fire(v, o, t, pEnd + 0.02);

    if (!highFidelity) return true;

    if (K.vent) {
      // Pressure leaving through the hole that was just made.
      const h = noiseSrc(v);
      const hf = filt(v, 'bandpass', K.ventHz * pitch, K.ventQ);
      const hg = gain(v);
      h.connect(hf); hf.connect(hg); hg.connect(out);
      const hEnd = env(hg.gain, t + 0.006, K.ventGain, 0.010, 0, K.ventDur);
      fire(v, h, t + 0.006, hEnd + 0.02, noiseOffset(K.ventDur + 0.05));
    } else {
      // Fragments. Two, sharing one source, on the step's own tap machinery -
      // so a skull coming apart is audibly made of the same material the legs
      // are.
      const p = noiseSrc(v);
      let at = t + 0.012, last = at;
      for (let i = 0; i < 2; i++) {
        const ff = filt(v, 'bandpass', rand(K.fragHz[0], K.fragHz[1]) * pitch, rand(5, 11));
        const fg = gain(v);
        p.connect(ff); ff.connect(fg); fg.connect(out);
        last = env(fg.gain, at, K.fragGain * (i === 0 ? 1 : 0.7), 0.0008, 0, rand(0.006, 0.014));
        at += rand(0.018, 0.045);
      }
      fire(v, p, t + 0.012, Math.max(last, at) + 0.02, noiseOffset(0.12));
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // ambience
  // ---------------------------------------------------------------------------

  /**
   * The bed is built once and never rebuilt. Changing room only retargets
   * filter frequencies and gains with ramps, which is the only way to swap
   * ambience mid-stride without a click: stopping one looping source and
   * starting another always leaves a discontinuity at the seam.
   *
   * Two layers, both brown noise:
   *   rumble  heavily lowpassed, the mass of the building.
   *   air     bandpassed and slowly swelled, the movement in it.
   */
  function buildBed() {
    const rumbleSrc = ctx.createBufferSource();
    rumbleSrc.buffer = brownBuf;
    rumbleSrc.loop = true;

    const rumbleFilt = ctx.createBiquadFilter();
    rumbleFilt.type = 'lowpass';
    rumbleFilt.frequency.value = 70;
    rumbleFilt.Q.value = 0.7;

    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;

    const airSrc = ctx.createBufferSource();
    airSrc.buffer = brownBuf;
    airSrc.loop = true;
    // Detuned playback so the two layers do not phase-lock into one louder
    // copy of the same noise.
    airSrc.playbackRate.value = 0.77;

    const airHi = ctx.createBiquadFilter();
    airHi.type = 'highpass';
    airHi.frequency.value = 180;

    const airFilt = ctx.createBiquadFilter();
    airFilt.type = 'lowpass';
    airFilt.frequency.value = 800;
    airFilt.Q.value = 1.1;

    const airGain = ctx.createGain();
    airGain.gain.value = 0;

    // Gusts ride here rather than on airGain, so a gust ramp and a room change
    // ramp never fight over the same AudioParam.
    const gustGain = ctx.createGain();
    gustGain.gain.value = 1;

    rumbleSrc.connect(rumbleFilt); rumbleFilt.connect(rumbleGain);
    airSrc.connect(airHi); airHi.connect(airFilt);
    airFilt.connect(gustGain); gustGain.connect(airGain);

    for (const g of [rumbleGain, airGain]) {
      g.connect(dryBus);
      const s = ctx.createGain();
      s.gain.value = 0.5;
      g.connect(s);
      s.connect(sendBus);
    }

    rumbleSrc.start();
    airSrc.start();

    bed = { rumbleSrc, rumbleFilt, rumbleGain, airSrc, airHi, airFilt, airGain, gustGain };
  }

  function applyAmbience() {
    const P = AMBIENCE[ambienceProfile];
    if (!P || !bed) return;

    const t = now();
    // setTargetAtTime rather than a linear ramp: an exponential approach has
    // no corner at either end, so a room change has no edge to hear at all.
    const TC = 0.9;
    bed.rumbleFilt.frequency.setTargetAtTime(P.rumbleHz, t, TC);
    bed.rumbleGain.gain.setTargetAtTime(P.rumble, t, TC);
    bed.airFilt.frequency.setTargetAtTime(P.airHz, t, TC);
    bed.airGain.gain.setTargetAtTime(P.air, t, TC);

    // Reset the one-shot schedule, so the first drip in a new room does not
    // inherit the last room's cadence.
    const c = ctx.currentTime;
    nextDrip = P.dripEvery ? c + rand(0.5, P.dripEvery) : 0;
    nextGust = P.gustEvery ? c + rand(0.5, P.gustEvery) : 0;
    nextCrackle = P.crackleEvery ? c + rand(0.2, P.crackleEvery) : 0;
  }

  /**
   * Point the bed at a profile. Idempotent and interruptible: calling it every
   * time the player crosses a portal just retargets the ramps in flight. Safe
   * to call before resume(), in which case it takes effect when the context
   * comes up.
   */
  /**
   * THE RETURN VALUE USED TO BE A LITERAL `true`, and it cost us the desert.
   *
   * `main.js` called this with 'exterior', which is a valid SPACE name and not a
   * valid AMBIENCE name. The two namespaces are near-miss neighbours. This
   * function quietly substituted 'chamber' and reported success, so the open
   * courtyard played sealed-room ambience from the day it was wired until
   * somebody happened to listen. The post-mortem is at main.js:859.
   *
   * The call site was fixed then; this default was not, which left the thing
   * that hid the bug in place to hide the next one. It now answers the question
   * it is actually asked: false means the profile was not recognised. The
   * fallback to 'chamber' STAYS, because silence is a worse failure than the
   * wrong room tone and this is called on every portal crossing. What changes is
   * that the substitution is now reportable rather than invisible.
   *
   * `setSpace` twelve hundred lines up has always done this correctly:
   * `if (!SPACES[name]) return false`.
   */
  function startAmbience(profile) {
    const known = !!AMBIENCE[profile];
    ambienceProfile = known ? profile : 'chamber';
    ensure();
    if (bed) applyAmbience();
    return known;
  }

  function stopAmbience() {
    ambienceProfile = null;
    nextDrip = nextGust = nextCrackle = 0;
    if (!ctx || !bed) return;
    const t = now();
    bed.rumbleGain.gain.setTargetAtTime(0, t, 0.5);
    bed.airGain.gain.setTargetAtTime(0, t, 0.5);
  }

  /**
   * A water drip: a two millisecond noise impulse exciting a very high-Q
   * bandpass, which is a plucked resonator in the cheapest possible form. The
   * downward glide on the resonance is what makes it a drip into standing
   * water rather than a woodblock.
   */
  function drip(at, opts = {}) {
    const v = voice({ dest: opts.dest, send: opts.send ?? 0.75, gain: opts.gain ?? 0.5 });
    if (!v) return false;

    const hz = rand(900, 2300) * (opts.pitch ?? 1);
    const n = noiseSrc(v);
    const f = filt(v, 'bandpass', hz, 26);
    const g = gain(v);
    glide(f.frequency, at, hz, hz * 0.55, 0.28);
    n.connect(f); f.connect(g); g.connect(v.out);

    const end = env(g.gain, at, 0.5, 0.001, 0, 0.30);
    fire(v, n, at, end + 0.02, noiseOffset(0.35));
    return true;
  }

  /**
   * A gust is a level and brightness swell on the air layer that already
   * exists. It allocates nothing, which matters because gusts fire forever and
   * a leak here would be a leak for the whole session.
   */
  function gust(at) {
    if (!bed) return false;
    const peak = rand(1.6, 3.4);
    const rise = rand(1.2, 2.6);
    const fall = rand(2.0, 4.5);

    const p = bed.gustGain.gain;
    p.cancelScheduledValues(at);
    p.setValueAtTime(Math.max(p.value, 0.0001), at);
    p.linearRampToValueAtTime(peak, at + rise);
    p.linearRampToValueAtTime(1, at + rise + fall);

    // Wind opens the filter as it rises, because faster air is brighter air.
    const P = AMBIENCE[ambienceProfile] || AMBIENCE.chamber;
    const f = bed.airFilt.frequency;
    f.cancelScheduledValues(at);
    f.setValueAtTime(Math.max(f.value, 20), at);
    f.linearRampToValueAtTime(P.airHz * 2.1, at + rise);
    f.linearRampToValueAtTime(P.airHz, at + rise + fall);
    return true;
  }

  /**
   * Brazier crackle: a handful of tiny filtered clicks scattered in time. All
   * of them share one voice, because five clicks is one event to the ear and
   * charging it five slots against the cap would starve everything else.
   */
  function crackle(at, opts = {}) {
    const v = voice({ dest: opts.dest, send: opts.send ?? 0.3, gain: opts.gain ?? 0.5 });
    if (!v) return false;

    const clicks = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < clicks; i++) {
      const t0 = at + i * rand(0.02, 0.09);
      const dur = rand(0.012, 0.05);
      const src = noiseSrc(v);
      const f = filt(v, 'bandpass', rand(1800, 5200), rand(3, 9));
      const g = gain(v);
      src.connect(f); f.connect(g); g.connect(v.out);
      const end = env(g.gain, t0, rand(0.10, 0.28), 0.001, 0, dur);
      fire(v, src, t0, end + 0.02, noiseOffset(dur + 0.02));
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // stingers
  // ---------------------------------------------------------------------------

  /**
   * A horn: a stack of detuned sawtooths through a lowpass that opens with the
   * envelope, plus a pitch envelope that scoops up into the note. The scoop is
   * why it reads as a horn being blown rather than a synth pad being faded up.
   */
  function horn(baseHz, dur, opts = {}) {
    const v = voice({ dest: opts.dest, send: opts.send ?? 0.55, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    // Five detuned voices is a section, three is a pair. Low fidelity takes
    // the pair, which is where most of the oscillator cost in a stinger is.
    const stack = highFidelity ? [-14, -7, 0, 7, 14] : [-9, 0, 9];

    const out = gain(v);
    const lp = filt(v, 'lowpass', 400, 1.6);
    lp.connect(out); out.connect(v.out);

    lp.frequency.setValueAtTime(320, t);
    lp.frequency.exponentialRampToValueAtTime(baseHz * 9, t + dur * 0.25);
    lp.frequency.exponentialRampToValueAtTime(baseHz * 3, t + dur);

    const end = env(out.gain, t, opts.peak ?? 0.30, dur * 0.12, dur * 0.35, dur * 0.55);

    for (const detune of stack) {
      const o = osc(v, 'sawtooth', baseHz);
      o.detune.value = detune;
      glide(o.frequency, t, baseHz * 0.62, baseHz, dur * 0.16);
      o.connect(lp);
      fire(v, o, t, end + 0.05);
    }

    if (opts.sub) {
      const s = osc(v, 'sine', baseHz * 0.5);
      const sg = gain(v);
      s.connect(sg); sg.connect(v.out);
      const sEnd = env(sg.gain, t, (opts.peak ?? 0.30) * 0.9, dur * 0.08, dur * 0.4, dur * 0.5);
      fire(v, s, t, sEnd + 0.05);
    }

    return true;
  }

  function waveStart(opts = {}) { return horn(98, 1.7, { peak: 0.30, ...opts }); }

  /** An octave under waveStart, with a sub sine, and slower. */
  function bossHorn(opts = {}) {
    return horn(49, 2.6, { peak: 0.34, sub: true, send: 0.7, ...opts });
  }

  /**
   * Two-operator FM: a sine carrier with a sine modulator wired into its
   * frequency, and a modulation index that decays fast. That decay is what
   * makes an FM tone bell-like - bright and inharmonic at the attack, settling
   * to a near-pure sine as it rings out.
   *
   * A ratio at a whole number gives a celesta; a ratio off a whole number
   * gives the clangorous inharmonic partials of a struck bell.
   */
  function fmNote(v, t, hz, ratio, index, dur, peak, dest) {
    const car = osc(v, 'sine', hz);
    const g = gain(v);
    car.connect(g); g.connect(dest);

    const mod = osc(v, 'sine', hz * ratio);
    const modAmt = gain(v, hz * index);
    mod.connect(modAmt); modAmt.connect(car.frequency);
    glide(modAmt.gain, t, hz * index, hz * index * 0.02, dur * 0.55);

    const end = env(g.gain, t, peak, 0.004, 0, dur);
    fire(v, car, t, end + 0.03);
    fire(v, mod, t, end + 0.03);
    return end;
  }

  /** The mystery box: a rising FM arpeggio, deliberately toy-like. */
  function boxJingle(opts = {}) {
    const v = voice({ dest: opts.dest, send: opts.send ?? 0.5, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    // A pentatonic run has no semitones in it, so it cannot sound wrong no
    // matter which note the arpeggio happens to land on.
    const scale = [523.25, 587.33, 698.46, 783.99, 1046.5, 1174.7];
    const notes = highFidelity ? scale : scale.slice(0, 4);

    notes.forEach((hz, i) => {
      fmNote(v, t + i * 0.085, hz, 3.0, 2.4, 0.55, 0.16, v.out);
    });

    return true;
  }

  /** A shrine: one inharmonic bell plus its fifth, long and wet. */
  function shrineChime(opts = {}) {
    const v = voice({ dest: opts.dest, send: opts.send ?? 0.75, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    fmNote(v, t, 660, 1.41, 3.2, 2.6, 0.20, v.out);
    fmNote(v, t + 0.06, 990, 1.41, 2.2, 2.0, 0.11, v.out);
    return true;
  }

  /** Two descending square blips. Cheap, universal, unmistakably "no". */
  function purchaseDenied(opts = {}) {
    const v = voice({ dest: opts.dest, send: opts.send ?? 0.2, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    const lp = filt(v, 'lowpass', 2200, 1.0);
    lp.connect(v.out);

    for (const [hz, off] of [[220, 0], [165, 0.11]]) {
      const o = osc(v, 'square', hz);
      const g = gain(v);
      o.connect(g); g.connect(lp);
      const end = env(g.gain, t + off, 0.16, 0.003, 0.04, 0.06);
      fire(v, o, t + off, end + 0.02);
    }

    return true;
  }

  /** End of round: a low drone sliding down and closing as it fades. */
  function roundEnd(opts = {}) {
    const v = voice({ dest: opts.dest, send: opts.send ?? 0.65, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    const lp = filt(v, 'lowpass', 700, 1.2);
    lp.connect(v.out);
    glide(lp.frequency, t, 700, 180, 2.4);

    const out = gain(v);
    out.connect(lp);
    const end = env(out.gain, t, 0.26, 0.35, 0.7, 1.4);

    for (const [hz, detune] of [[73.4, -8], [110, 6], [146.8, 0]]) {
      const o = osc(v, 'sawtooth', hz);
      o.detune.value = detune;
      glide(o.frequency, t, hz, hz * 0.75, 2.4);
      o.connect(out);
      fire(v, o, t, end + 0.05);
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // positional
  // ---------------------------------------------------------------------------

  /**
   * Attach a panner to an object3D. The handle owns the panner; sounds played
   * through it are ordinary voices routed into the panner instead of straight
   * to the dry bus, so they still count against the cap and still clean
   * themselves up.
   *
   * A handle created before resume() is a real handle with a null panner; it
   * materialises when the context comes up, which is what lets world building
   * attach audio to props long before the player clicks Begin.
   *
   * The object is read through matrixWorld.elements rather than .position, so
   * a prop parented into a group ends up where it actually is. Nothing here
   * imports three.js, which keeps this module testable without a renderer.
   */
  function attachPositional(object3D, kind = 'enemy') {
    const handle = {
      kind: PANNER_KINDS[kind] ? kind : 'enemy',
      object: object3D,
      panner: null,
      send: null,
      disposed: false,

      /** Copy the object's world position into the panner. */
      sync() {
        if (handle.disposed || !handle.panner || !object3D) return;
        let x = 0, y = 0, z = 0;
        const mw = object3D.matrixWorld;
        if (mw && mw.elements) {
          const e = mw.elements;
          x = e[12]; y = e[13]; z = e[14];
        } else if (object3D.position) {
          x = object3D.position.x; y = object3D.position.y; z = object3D.position.z;
        }
        const p = handle.panner;
        setXYZ(p.positionX, p.positionY, p.positionZ, x, y, z,
               (a, b, c) => p.setPosition && p.setPosition(a, b, c));
      },

      /** Play any named sound through this panner. */
      play(name, opts = {}) {
        if (handle.disposed) return false;
        ensure();
        if (!handle.panner) return false;
        return play(name, { ...opts, dest: handle.panner });
      },

      setFidelity(high) {
        if (handle.panner) handle.panner.panningModel = high ? 'HRTF' : 'equalpower';
      },

      dispose() {
        if (handle.disposed) return;
        handle.disposed = true;
        handles.delete(handle);
        try { handle.panner && handle.panner.disconnect(); } catch { /* detached */ }
        try { handle.send && handle.send.disconnect(); } catch { /* detached */ }
        handle.panner = handle.send = null;
      },
    };

    handles.add(handle);
    ensure();
    if (ctx) materialize(handle);
    return handle;
  }

  /** Give a handle its actual nodes. Idempotent. */
  function materialize(handle) {
    if (!ctx || handle.panner || handle.disposed) return;

    const K = PANNER_KINDS[handle.kind];
    const panner = ctx.createPanner();
    // HRTF is markedly better for locating an enemy behind you, and markedly
    // more expensive. It is the first thing low fidelity gives up.
    panner.panningModel = highFidelity ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = K.ref;
    panner.maxDistance = K.max;
    panner.rolloffFactor = K.rolloff;

    panner.connect(dryBus);
    const send = ctx.createGain();
    send.gain.value = K.send;
    panner.connect(send);
    send.connect(sendBus);

    handle.panner = panner;
    handle.send = send;
    handle.sync();
  }

  /**
   * Write a vec3 into an AudioParam triple, or fall back to the deprecated
   * setter on browsers that never shipped the param form. setTargetAtTime
   * rather than setValueAtTime because this runs every frame: instant jumps in
   * panner position are a per-frame zipper on the panning coefficients.
   */
  function setXYZ(px, py, pz, x, y, z, legacy) {
    if (px && typeof px.setTargetAtTime === 'function') {
      const t = ctx.currentTime;
      px.setTargetAtTime(x, t, 0.02);
      py.setTargetAtTime(y, t, 0.02);
      pz.setTargetAtTime(z, t, 0.02);
    } else if (legacy) {
      legacy(x, y, z);
    }
  }

  function syncPositional() {
    if (!ctx) return;
    for (const h of handles) h.sync();
  }

  /**
   * Keep the AudioListener on the camera. Call once per frame, after the
   * camera has been updated, or every positional sound is placed relative to
   * where the player was last frame.
   *
   * A three.js camera looks down its own -Z, so forward is the negated third
   * basis column of matrixWorld and up is the second.
   */
  function setListener(camera) {
    if (!ctx || !camera) return;
    if (typeof camera.updateMatrixWorld === 'function') camera.updateMatrixWorld();

    const e = camera.matrixWorld && camera.matrixWorld.elements;
    if (!e) return;

    const L = ctx.listener;
    setXYZ(L.positionX, L.positionY, L.positionZ, e[12], e[13], e[14],
           (x, y, z) => L.setPosition && L.setPosition(x, y, z));

    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];

    if (L.forwardX && typeof L.forwardX.setTargetAtTime === 'function') {
      const t = ctx.currentTime;
      L.forwardX.setTargetAtTime(fx, t, 0.02);
      L.forwardY.setTargetAtTime(fy, t, 0.02);
      L.forwardZ.setTargetAtTime(fz, t, 0.02);
      L.upX.setTargetAtTime(ux, t, 0.02);
      L.upY.setTargetAtTime(uy, t, 0.02);
      L.upZ.setTargetAtTime(uz, t, 0.02);
    } else if (L.setOrientation) {
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // ---------------------------------------------------------------------------
  // housekeeping
  // ---------------------------------------------------------------------------

  /**
   * One repeating timer for the whole module, and neither of its two jobs is
   * musical timing.
   *
   * It queues ambience one-shots at exact context times a lookahead window
   * ahead of the audio thread, which is the standard two-clock pattern: a
   * coarse timer decides what to schedule, ctx.currentTime decides when it
   * actually sounds. And it reaps any voice whose sources never reported ended
   * (a context suspended mid-shot, a tab backgrounded at the wrong moment).
   * Without the reaper a single missed onended permanently eats a slot.
   */
  function startTick() {
    if (tickTimer) return;
    const step = () => {
      tickTimer = setTimeout(step, TICK_MS);
      if (!ctx || disposed) return;

      const c = ctx.currentTime;
      const horizon = c + LOOKAHEAD;

      if (ambienceProfile && ctx.state === 'running') {
        const P = AMBIENCE[ambienceProfile];

        while (nextDrip && nextDrip < horizon) {
          drip(Math.max(nextDrip, c + SLACK));
          nextDrip += rand(P.dripEvery * 0.4, P.dripEvery * 1.8);
        }
        while (nextGust && nextGust < horizon) {
          gust(Math.max(nextGust, c + SLACK));
          nextGust += rand(P.gustEvery * 0.6, P.gustEvery * 1.6);
        }
        while (nextCrackle && nextCrackle < horizon) {
          crackle(Math.max(nextCrackle, c + SLACK));
          nextCrackle += rand(P.crackleEvery * 0.3, P.crackleEvery * 2.0);
        }
      }

      for (const v of voices) {
        if (c > v.expires) kill(v);
      }
    };
    tickTimer = setTimeout(step, TICK_MS);
  }

  // ---------------------------------------------------------------------------
  // router
  // ---------------------------------------------------------------------------

  const SOUNDS = {
    groan, footfall, swipe, deathRattle, bodyHit, headshotHit,
    // The horde's non-vocal half. A scarab plays no groan and no deathRattle at
    // all; these are its entire vocabulary, and none of them contains an
    // oscillator that could be mistaken for a mouth.
    chitinStep, chitinRasp, shellCrack, chitinHit, chitinCrit,
    waveStart, bossHorn, boxJingle, shrineChime, purchaseDenied, roundEnd,
    // One per revealed character, from ui/pacer.js. It goes through the same
    // router as everything else rather than getting a private entry point,
    // because a second way to make a sound in this file is how the mix drifts.
    codecTick,
    // The ambience one-shots are also playable on demand, which is how a
    // brazier prop gets its own crackle rather than relying on the room bed.
    crackle: (opts) => crackle(now(), opts),
    drip: (opts) => drip(now(), opts),
  };

  for (const [name, spec] of Object.entries(MECH)) {
    SOUNDS[name] = (opts) => transient(spec, opts);
  }

  function play(name, opts = {}) {
    ensure();
    if (!ctx) return false;

    // Both numbers, and the gap between them is the point. See playCounts.
    let rec = playCounts.get(name);
    if (!rec) { rec = { tried: 0, played: 0 }; playCounts.set(name, rec); }
    rec.tried++;

    const ok = WEAPONS[name] ? shot(name, opts)
      : SOUNDS[name] ? SOUNDS[name](opts)
        : false;
    if (ok) rec.played++;
    return ok;
  }

  // ---------------------------------------------------------------------------
  // public surface
  // ---------------------------------------------------------------------------

  const api = {
    get ctx() { return ctx; },
    get ready() { return !!ctx && ctx.state === 'running'; },
    get voiceCount() { return voices.size; },

    /**
     * Create the context if needed and start it. Must be called from inside a
     * user gesture handler: browsers refuse to start audio otherwise, and the
     * refusal is silent. This is also the gate that lets anything else in this
     * module allocate at all.
     */
    async resume() {
      if (disposed) return 'disposed';
      unlocked = true;
      ensure();
      if (!ctx) return 'unavailable';
      // An OfflineAudioContext sits in 'suspended' until startRendering() is
      // called by whoever owns it. Calling resume() on one is either a no-op or
      // an error depending on the browser, and neither is what the harness
      // wants: it wants the graph built and left alone until it renders.
      if (ctx.state !== 'running' && !offline) {
        try { await ctx.resume(); } catch { /* rejected outside a gesture */ }
      }
      return ctx.state;
    },

    /** Suspend without tearing anything down. Cheap to reverse. */
    async suspend() {
      if (!ctx || ctx.state !== 'running') return;
      try { await ctx.suspend(); } catch { /* nothing to do */ }
    },

    setVolume(v) {
      volume = clamp(v, 0, 1);
      if (!ctx) return;
      const t = now();
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(muted ? 0 : volume, t + 0.08);
    },

    getVolume() { return volume; },

    setMuted(on) {
      muted = !!on;
      api.setVolume(volume);
    },

    isMuted() { return muted; },

    toggleMute() { api.setMuted(!muted); return muted; },

    /**
     * Low fidelity halves the voice cap, drops HRTF panning, and thins the
     * stinger oscillator stacks. It deliberately does not touch the reverb:
     * convolver cost is fixed and independent of how many voices feed it, so
     * there is nothing to win there.
     */
    setFidelity(high) {
      highFidelity = !!high;
      cap = highFidelity ? VOICE_CAP.high : VOICE_CAP.low;
      for (const h of handles) h.setFidelity(highFidelity);
      // Trim immediately rather than waiting for voices to expire, otherwise
      // dropping to low leaves the cap over-subscribed for a second or two.
      while (voices.size > cap) {
        const oldest = voices.values().next().value;
        if (!oldest) break;
        kill(oldest);
      }
    },

    getFidelity() { return highFidelity; },

    setSpace(name) { const ok = setSpace(name); ensure(); return ok; },
    getSpace() { return spaceName; },

    shot(weapon, opts = {}) { ensure(); return ctx ? shot(weapon, opts) : false; },

    /**
     * Does a weapon profile of this name exist?
     *
     * shot() deliberately falls back to the pistol for an unknown name, because
     * a weapon that makes the wrong noise is playable and a weapon that makes no
     * noise is not. That fallback is silent, though, which means a caller asking
     * for a profile that was never written gets a plausible sound and no signal.
     * This is how anyone - the bench, a debug panel - finds out.
     */
    hasWeapon(name) { return Object.hasOwn(WEAPONS, name); },
    weaponNames() { return Object.keys(WEAPONS); },

    startAmbience,
    stopAmbience,

    attachPositional,
    syncPositional,
    setListener,

    play,

    /** Every sound the router knows, so a caller can find out rather than guess. */
    soundNames() { return Object.keys(SOUNDS); },

    stats() {
      const plays = {};
      for (const [k, v] of playCounts) plays[k] = { tried: v.tried, played: v.played };
      return {
        state: ctx ? ctx.state : 'uncreated',
        voices: voices.size,
        cap,
        // How much of the voice count is the horde's legs. Reported separately
        // because it is the one class of sound with its own budget, and a
        // number that is always at the pool limit means the limit is the thing
        // being heard rather than the scarabs.
        stepVoices: stepVoices.size,
        stepPool: highFidelity ? STEP_POOL.high : STEP_POOL.low,
        space: spaceName,
        ambience: ambienceProfile,
        handles: handles.size,
        fidelity: highFidelity ? 'high' : 'low',
        bakeMs,
        reportBanks: reports.size,
        plays,
      };
    },

    dispose() {
      disposed = true;
      clearTimeout(tickTimer);
      tickTimer = 0;
      for (const h of Array.from(handles)) h.dispose();
      for (const v of Array.from(voices)) kill(v);
      // Three megabytes of baked float lives in here. Nothing else drops it.
      reports.clear();
      mechBank = [];
      ringBuf = null;
      lastReport.voice = null;
      stepVoices.clear();
      playCounts.clear();
      if (bed) {
        try { bed.rumbleSrc.stop(); bed.airSrc.stop(); } catch { /* not started */ }
        bed = null;
      }
      if (ctx) {
        try { ctx.close(); } catch { /* already closed */ }
        ctx = null;
      }
    },
  };

  // Named wrappers, so callers read as English rather than as string keys.
  for (const name of Object.keys(SOUNDS)) {
    api[name] = (opts) => play(name, opts || {});
  }

  return api;
}
