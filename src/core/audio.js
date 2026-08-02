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
    // back at whatever rate puts them over this weapon. It used to be two
    // detuned triangle oscillators through a highpass, which is four nodes and
    // exactly two partials, and two partials beating is a tremolo rather than
    // struck metal.
    if (opts.upgraded && ringBuf) {
      const rs = ctx.createBufferSource();
      rs.buffer = ringBuf;
      rs.playbackRate.value = (W.ringRate ?? 1.6) * pitch * rand(0.97, 1.03);
      own(v, rs);
      const rg = gain(v, 0.16);
      rs.connect(rg); rg.connect(v.out);
      fire(v, rs, t + 0.004, t + 0.004 + ringBuf.duration / rs.playbackRate.value + 0.02);
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
  // enemies
  // ---------------------------------------------------------------------------

  /**
   * A groan is two detuned sawtooths through parallel bandpass formants.
   *
   * The formants are what make it read as a throat rather than a synthesiser.
   * Resonances near 570 / 1100 / 2400 Hz are roughly an open vowel; the detune
   * between the two sawtooths gives the beat that makes it sound like a body
   * rather than an oscillator. Pitch is randomised per call, so a horde is a
   * crowd and not one voice played twenty times.
   */
  function groan(opts = {}) {
    const v = voice({ dest: opts.dest, send: opts.send ?? 0.45, gain: opts.gain ?? 1 });
    if (!v) return false;

    const t = now();
    const base = rand(62, 104) * (opts.pitch ?? 1);
    const dur = rand(0.75, 1.5);

    const out = gain(v);
    out.connect(v.out);

    // The sawtooths meet here and fan out into the formants. Nothing reaches
    // the output unfiltered, which is the point: raw saw is a synth patch.
    const mix = gain(v, 1);

    // Low fidelity drops to two formants, which halves the filter count across
    // a whole horde and is barely audible on any single enemy.
    const formants = highFidelity
      ? [[570, 9, 1.0], [1100, 11, 0.55], [2410, 14, 0.22]]
      : [[570, 9, 1.0], [1100, 11, 0.50]];

    for (const [hz, q, amt] of formants) {
      const f = filt(v, 'bandpass', hz * rand(0.9, 1.12), q);
      const fg = gain(v, amt);
      mix.connect(f); f.connect(fg); fg.connect(out);
    }

    const end = env(out.gain, t, 0.30, 0.10, dur * 0.35, dur * 0.65);

    for (const detune of [-11, 14]) {
      const o = osc(v, 'sawtooth', base);
      o.detune.value = detune;
      // A slow sag in pitch across the groan. Constant pitch sounds mechanical.
      glide(o.frequency, t, base * rand(1.02, 1.14), base * rand(0.78, 0.94), dur);
      o.connect(mix);
      fire(v, o, t, end + 0.03);
    }

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

    const t = now();
    const base = rand(44, 66) * (opts.pitch ?? 1);
    const dur = rand(1.1, 1.7);

    const out = gain(v);
    out.connect(v.out);

    const f = filt(v, 'bandpass', 480, 4.5);
    glide(f.frequency, t, 480, 180, dur);
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
    waveStart, bossHorn, boxJingle, shrineChime, purchaseDenied, roundEnd,
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
    if (WEAPONS[name]) return shot(name, opts);
    const fn = SOUNDS[name];
    return fn ? fn(opts) : false;
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

    stats() {
      return {
        state: ctx ? ctx.state : 'uncreated',
        voices: voices.size,
        cap,
        space: spaceName,
        ambience: ambienceProfile,
        handles: handles.size,
        fidelity: highFidelity ? 'high' : 'low',
        bakeMs,
        reportBanks: reports.size,
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
