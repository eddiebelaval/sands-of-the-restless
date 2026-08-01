/**
 * THE GUNSMITH: muzzle blasts, baked.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * The gunshots this replaces were three Web Audio layers assembled per shot: a
 * bandpassed noise burst, a sine sliding down, and a high-Q ring. Measured
 * offline (test/gunlab.mjs), that construction had one characteristic that
 * explains the whole complaint. The MK9's energy above 8 kHz sat 32 dB below its
 * energy at 60-200 Hz, and 18 dB below the midrange. There was nothing up
 * there. A BiquadFilter set to bandpass at 2.4 kHz with Q 0.9 cannot produce a
 * gunshot's opening edge, because a gunshot's opening edge is broadband: it is
 * a pressure discontinuity, and a discontinuity has energy at every frequency
 * the medium can carry. Band-limit it and you have a beep with a fast attack.
 *
 * The same measurement showed a crest factor of 13-18 dB. A close report is
 * 25-35 dB. And two consecutive shots correlated at 0.93 to 0.98, which is to
 * say they were the same waveform with the crack filter nudged a few percent.
 *
 * None of that is fixable by re-tuning the numbers in a bandpass. It needs a
 * different construction.
 *
 * ---------------------------------------------------------------------------
 * WHY BAKED BUFFERS RATHER THAN A BIGGER NODE GRAPH
 * ---------------------------------------------------------------------------
 *
 * The obvious answer is more layers: add a broadband click, add a mechanical
 * layer, add a second body. That is the right sound and the wrong mechanism.
 * Every layer is another BufferSource, another BiquadFilter and another
 * GainNode on the audio thread, per shot, and the LMG fires ten rounds a second
 * into a room that may already be holding twenty enemy voices. This game
 * already has a frame governor shedding visual quality to hold frame rate; the
 * audio is not allowed to become the new cost.
 *
 * So the layering happens ONCE, offline, into an AudioBuffer, and a shot is a
 * buffer read. That buys three things a node graph cannot:
 *
 *   1. It is CHEAPER. A shot went from ten nodes - two BufferSources, two
 *      Biquads, five Gains, one Oscillator - to five, none of which is a filter
 *      or an oscillator. A biquad is a per-sample IIR evaluated for the whole
 *      life of a voice; a buffer read is an interpolated table lookup.
 *
 *   2. It allows sample-rate DSP that Web Audio has no node for: a genuine
 *      N-wave, a lowpass whose cutoff collapses from 18 kHz to 2 kHz in eight
 *      milliseconds, tanh saturation on the body to give it harmonics that a
 *      laptop speaker can actually reproduce, and an attack that reaches full
 *      scale in two samples rather than in the one millisecond that is the
 *      practical floor for a scheduled linearRampToValueAtTime.
 *
 *   3. It makes variation FREE. Five baked variants per weapon, each with its
 *      own body pitch, body length, crack decay and tail length (see vary()),
 *      chosen at random without immediate repetition. Five genuinely different
 *      waveforms, not one waveform detuned.
 *
 * The cost is memory and a one-off bake, both measured rather than estimated:
 * 47 buffers, 5.85 MB of stereo float at 48 kHz, and 88 ms to generate. That
 * bake runs inside the same user gesture that starts the AudioContext - the
 * Begin click, while the world is still being built and the player is looking
 * at a title card - and it is reported by audio.stats().bakeMs so that it
 * cannot quietly grow.
 *
 * ---------------------------------------------------------------------------
 * WHAT A SHOT IS MADE OF NOW
 * ---------------------------------------------------------------------------
 *
 *   CRACK    The report. A pressure discontinuity: an N-wave (the actual shape
 *            of a muzzle blast in air - an near-instant jump, a ramp down
 *            through ambient to a negative peak, a jump back) mixed with
 *            full-band noise, under a two-stage decay, through a lowpass whose
 *            cutoff collapses over a few milliseconds. That collapse is what a
 *            report does in air and is why the first two milliseconds are white
 *            and everything after them is dark.
 *
 *   BODY     The pressure wave, the part that tells you the calibre. A sine
 *            gliding down through tanh saturation, which is what puts odd
 *            harmonics over the fundamental. A pure 90 Hz sine is inaudible on
 *            a laptop; its third and fifth harmonics are not, and they are what
 *            carry the weight to a speaker that cannot reproduce the
 *            fundamental at all.
 *
 *   TAIL     The gun's own ring plus the crack coming back off whatever is out
 *            there. Generated independently for left and right, so it is wide,
 *            while the crack and body are common to both channels, so the
 *            transient stays a point source. That is the correct physics and it
 *            is also the only way to get width without smearing the attack.
 *
 *   MECH     The action. Bolt, carrier, brass. Baked separately and fired at a
 *            randomised delay behind the report, because it is a different
 *            event with its own timing and because sharing one bank across all
 *            weapons costs one buffer instead of eight.
 *
 * The room is still the convolver in audio.js. Nothing in here knows about it.
 */

/**
 * A small deterministic PRNG.
 *
 * The bake is seeded rather than using Math.random, and that is deliberate. If
 * the bake were random, every session's guns would differ slightly - harmless -
 * but the offline bench would measure that difference as per-shot variation and
 * report a passing grade for a weapon that plays one identical buffer forever.
 * Making the bake reproducible means the variation the bench measures is the
 * variation the player actually hears: variant choice, rate, level, and the
 * mechanical layer's independent timing.
 */
function rng(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** One-pole lowpass coefficient for a cutoff in Hz at a given sample rate. */
function poleK(hz, rate) {
  const k = 1 - Math.exp(-2 * Math.PI * Math.max(hz, 1) / rate);
  return k > 1 ? 1 : k;
}

/**
 * Exponential interpolation between two frequencies, 0..1.
 * Linear interpolation of a frequency is wrong: the ear hears ratios, and a
 * linear sweep from 18 kHz to 2 kHz spends most of its time above 10 kHz, which
 * is the opposite of what a collapsing muzzle blast does.
 */
function glideHz(a, b, u) {
  return a * Math.pow(b / a, u < 0 ? 0 : u > 1 ? 1 : u);
}

/**
 * The weapon table.
 *
 * Every number here is modelling something, and the comment on each block says
 * what. The names are the audio profiles src/player/weapons.js asks for, not
 * the weapon names the player sees - one profile can serve two guns.
 *
 * peak is the normalisation target, and it is the loudness relationship between
 * weapons expressed in one place. Normalising each baked variant to its own
 * target is what keeps every variant of the same gun at the same level, so that
 * the per-shot level randomisation is the only level variation there is and it
 * stays as small as it was designed to be.
 */
export const REPORTS = {
  /**
   * MK9 pistol. A 9mm out of a short barrel: not much powder, so the crack is
   * quick and the body is small and brief. The barrel is short enough that
   * there is very little ring, so the tail is mostly the room, which the
   * convolver supplies.
   */
  pistol: {
    seconds: 0.30, peak: 0.3, variants: 5,
    crack: { level: 1.00, openHz: 15000, closeHz: 1700, glideMs: 7,
             d1: 0.0016, d2: 0.014, mix: 0.62, nwaveMs: 0.9, hpHz: 150 },
    body:  { level: 0.62, hz0: 200, hz1: 88, ms: 48, drive: 2.6 },
    tail:  { level: 0.10, ms: 150, openHz: 3000, closeHz: 500 },
    slap:  null,
    mech:  { gain: 0.13, delayMs: [26, 42], rate: [1.05, 1.25] },
    send: 0.28, rateJitter: 0.035, levelJitterDb: 1.1,
  },

  /**
   * B3AR. The same calibre as the MK9 out of the same class of barrel, so the
   * crack is a sibling of the pistol's - but the BODY IS HALF AS LONG and the
   * tail is a third, and that is the entire design of this profile.
   *
   * Its three rounds land 40 ms apart. A 48 ms body and a 150 ms tail, fired
   * three times at 40 ms, is one continuous noise with lumps in it: the second
   * crack arrives while the first body is still at full level, and the third
   * arrives on top of both. The burst then reads as one long report rather than
   * as three, and the weapon loses the thing it is named for.
   *
   * 24 ms of body clears with 16 ms to spare before the next round. That is the
   * whole reason this is a separate profile and not an alias of the pistol, and
   * it is measurable: test/gunlab.mjs reports the trough depth between the three
   * transients, and that number is what these two figures buy.
   */
  b3ar: {
    seconds: 0.22, peak: 0.29, variants: 5,
    crack: { level: 1.00, openHz: 16000, closeHz: 2000, glideMs: 5,
             d1: 0.0012, d2: 0.0090, mix: 0.66, nwaveMs: 0.7, hpHz: 180 },
    body:  { level: 0.58, hz0: 215, hz1: 96, ms: 24, drive: 2.9 },
    tail:  { level: 0.055, ms: 60, openHz: 3400, closeHz: 800 },
    slap:  null,
    mech:  { gain: 0.045, delayMs: [20, 29], rate: [1.15, 1.35] },
    send: 0.22, rateJitter: 0.030, levelJitterDb: 0.9,
  },

  /**
   * SMG. Small round, high rate. Brighter and shorter than the pistol in every
   * layer, because at 900 rounds a minute anything longer than about 60 ms of
   * body is still sounding when the next round leaves the barrel.
   */
  smg: {
    seconds: 0.24, peak: 0.24, variants: 5,
    crack: { level: 1.00, openHz: 17000, closeHz: 2300, glideMs: 5,
             d1: 0.0011, d2: 0.0095, mix: 0.70, nwaveMs: 0.6, hpHz: 190 },
    body:  { level: 0.44, hz0: 185, hz1: 84, ms: 30, drive: 2.4 },
    tail:  { level: 0.07, ms: 90, openHz: 3600, closeHz: 700 },
    slap:  null,
    mech:  { gain: 0.15, delayMs: [14, 24], rate: [1.20, 1.45] },
    send: 0.24, rateJitter: 0.045, levelJitterDb: 1.4,
  },

  /**
   * Shotgun. Mostly a pressure event rather than a supersonic crack: a large
   * volume of gas leaving slowly. The crack therefore opens lower and collapses
   * over 20 ms rather than 6, and the body is the loudest of any weapon here
   * relative to its own crack. Heavily driven, because a shotgun's low end is
   * not a clean tone, it is a distorted thump.
   */
  shotgun: {
    seconds: 0.44, peak: 0.46, variants: 5,
    crack: { level: 1.00, openHz: 11000, closeHz: 900, glideMs: 20,
             d1: 0.0045, d2: 0.045, mix: 0.80, nwaveMs: 2.4, hpHz: 70 },
    body:  { level: 1.05, hz0: 105, hz1: 40, ms: 150, drive: 4.5 },
    tail:  { level: 0.20, ms: 300, openHz: 2000, closeHz: 260 },
    slap:  { level: 0.10, ms: [42, 51], lpHz: 1400 },
    mech:  { gain: 0.2, delayMs: [150, 200], rate: [0.62, 0.74] },
    send: 0.42, rateJitter: 0.030, levelJitterDb: 1.0,
  },

  /**
   * Carbine. A rifle round out of a medium barrel: the hardest, brightest crack
   * in the game short of the bolt gun, a fast collapse, and a real tail because
   * a rifle round is supersonic and the crack goes somewhere and comes back.
   */
  rifle: {
    seconds: 0.38, peak: 0.4, variants: 5,
    crack: { level: 1.00, openHz: 18000, closeHz: 2100, glideMs: 6,
             d1: 0.0013, d2: 0.016, mix: 0.66, nwaveMs: 0.8, hpHz: 110 },
    body:  { level: 0.86, hz0: 145, hz1: 58, ms: 70, drive: 3.6 },
    tail:  { level: 0.15, ms: 250, openHz: 3200, closeHz: 380 },
    slap:  { level: 0.075, ms: [38, 46], lpHz: 2600 },
    mech:  { gain: 0.14, delayMs: [22, 34], rate: [0.92, 1.10] },
    send: 0.38, rateJitter: 0.035, levelJitterDb: 1.2,
  },

  /**
   * Apis LMG. The heaviest sustained weapon: a belt-fed gun's signature is
   * WEIGHT, not sharpness, so the crack collapses further down than the
   * carbine's and the body is longer, lower and driven harder than anything but
   * the shotgun. It should be separable from the pistol by low-frequency
   * content alone, with the difference in tens of decibels rather than a few.
   */
  lmg: {
    seconds: 0.38, peak: 0.44, variants: 5,
    crack: { level: 1.00, openHz: 15000, closeHz: 1450, glideMs: 9,
             d1: 0.0019, d2: 0.020, mix: 0.72, nwaveMs: 1.4, hpHz: 80 },
    body:  { level: 1.10, hz0: 118, hz1: 44, ms: 105, drive: 4.2 },
    tail:  { level: 0.17, ms: 280, openHz: 2600, closeHz: 300 },
    slap:  { level: 0.07, ms: [44, 53], lpHz: 1900 },
    mech:  { gain: 0.17, delayMs: [16, 26], rate: [0.78, 0.92] },
    send: 0.36, rateJitter: 0.040, levelJitterDb: 1.5,
  },

  /**
   * Bolt rifle. One heavy round, and most of what you hear is what happens
   * afterwards. The hardest crack in the game, the deepest body, and by far the
   * longest tail with a distinct return off the surroundings 60 ms later. In a
   * stone chamber the convolver takes it from there; outdoors that baked return
   * is the only thing standing between this weapon and a dead click, because
   * the exterior impulse response is 200 ms of almost nothing, correctly.
   */
  bolt: {
    seconds: 0.58, peak: 0.52, variants: 5,
    crack: { level: 1.00, openHz: 19000, closeHz: 1900, glideMs: 5,
             d1: 0.0011, d2: 0.018, mix: 0.60, nwaveMs: 0.7, hpHz: 90 },
    body:  { level: 1.00, hz0: 128, hz1: 38, ms: 130, drive: 4.0 },
    tail:  { level: 0.20, ms: 460, openHz: 3000, closeHz: 260 },
    slap:  { level: 0.13, ms: [56, 68], lpHz: 2200 },
    mech:  { gain: 0.2, delayMs: [240, 310], rate: [0.68, 0.80] },
    send: 0.52, rateJitter: 0.025, levelJitterDb: 0.8,
  },

  /**
   * Sunspear. An energy weapon plays by different rules and gets a different
   * generator (see bakeEnergy): there is no pressure wave to model, so there is
   * no N-wave and no saturated body. What there is instead is a capacitor
   * discharging into air - a brief charge, a hard ionisation crackle, and a
   * resonance that falls rather than an amplitude that decays.
   *
   * It keeps a mechanical layer, quiet and high, because even an energy weapon
   * in this game is a machine somebody is holding.
   */
  energy: {
    seconds: 0.42, peak: 0.34, variants: 5, kind: 'energy',
    charge: { ms: 15, hz0: 900, hz1: 5600, level: 0.14 },
    zap:    { level: 1.0, hz0: 5600, hz1: 320, ms: 190, q: 0.006, crackle: 0.20,
              ignition: 0.75, d1: 0.0035 },
    tail:   { level: 0.20, ms: 340, openHz: 6000, closeHz: 1200 },
    mech:   { gain: 0.07, delayMs: [40, 60], rate: [1.5, 1.8] },
    send: 0.44, rateJitter: 0.050, levelJitterDb: 1.6,
  },
};

/**
 * How wet each space makes a weapon, as a multiplier on the profile's send.
 *
 * A shot in a stone gallery and the same shot in open desert are the same
 * source and completely different sounds, and audio.js already knows which one
 * the player is standing in. Not using that was leaving the single largest
 * free improvement on the table: the exterior figure here is what stops the
 * courtyard sounding like a bathroom, and the gallery figure is what makes
 * walking indoors change the guns rather than only the ambience.
 */
export const SPACE_SEND = {
  exterior: 0.30,
  corridor: 0.85,
  chamber: 1.00,
  shaft: 1.10,
  gallery: 1.25,
};

// The bake seed. Any constant does; this one is arbitrary.
const SEED = 0x5a17c0de;

/**
 * Bake every variant of one weapon into an array of AudioBuffers.
 *
 * Stereo, with the crack and body written identically to both channels and the
 * tail generated twice from independent noise. A gunshot you are holding is a
 * point source: its transient arrives at both ears at the same instant, and
 * decorrelating it would smear the attack, which is the one thing that must not
 * be smeared. Its reverberant return is not a point source, and decorrelating
 * THAT is what makes the shot sound like it happened in a place.
 */
export function bakeReport(ctx, name) {
  const spec = REPORTS[name];
  if (!spec) return null;
  const out = [];
  for (let v = 0; v < spec.variants; v++) {
    const seed = SEED + v * 7919 + name.length * 104729;
    const s = v === 0 ? spec : vary(spec, seed);
    out.push(spec.kind === 'energy' ? bakeEnergy(ctx, s, seed) : bakeFirearm(ctx, s, seed));
  }
  return out;
}

/**
 * Give a variant its own dimensions, not just its own noise.
 *
 * The first pass baked three variants that differed ONLY in which random
 * numbers fed the noise layers. Everything deterministic - the N-wave, the
 * saturated body, both envelopes - was bit identical between them, and since
 * the body carries most of the energy in the heavier weapons, two "different"
 * variants still measured 0.95 correlated. That is a variation system that
 * produces almost no variation, which is precisely the failure this codebase
 * keeps hitting: code that was written, ran, and did not take effect.
 *
 * So each variant now gets its own body pitch, its own body length, its own
 * crack decay and its own tail length. A few percent of each, which is roughly
 * the round to round spread of real ammunition out of the same barrel, and
 * enough that the deterministic layers stop lining up.
 *
 * Deterministic, from the same seed as the bake, so the bench still measures
 * per-shot variation rather than per-session luck.
 */
function vary(spec, seed) {
  const r = rng(seed ^ 0x51ed);
  const j = (amount) => 1 + (r() * 2 - 1) * amount;
  const out = { ...spec };
  // The N-wave and the noise/N-wave balance both get jittered, not just the
  // envelope. The N-wave is the deterministic half of a crack, and in the
  // lighter weapons it is the LOUDER half, so leaving its length and its share
  // fixed left five "different" pistol variants correlating at 0.95 across the
  // only 15ms anybody identifies a gunshot by. Varying those two is what
  // actually separates them.
  if (spec.crack) out.crack = { ...spec.crack, d1: spec.crack.d1 * j(0.16),
                                closeHz: spec.crack.closeHz * j(0.10),
                                nwaveMs: spec.crack.nwaveMs * j(0.28),
                                mix: Math.min(0.92, spec.crack.mix * j(0.14)) };
  // The body gets a start phase as well as its own pitch and length. Phase is
  // free - the ear cannot hear the absolute phase of a 120Hz thump underneath a
  // muzzle blast - but it is what stops five variants whose bodies are within a
  // few percent of each other from staying in step for the whole 100ms and
  // dominating every similarity measure taken across the buffer.
  if (spec.body) out.body = { ...spec.body, hz0: spec.body.hz0 * j(0.11),
                              hz1: spec.body.hz1 * j(0.11), ms: spec.body.ms * j(0.20),
                              phase: r() * Math.PI * 2 };
  if (spec.tail) out.tail = { ...spec.tail, ms: spec.tail.ms * j(0.10) };
  if (spec.zap) out.zap = { ...spec.zap, hz0: spec.zap.hz0 * j(0.08),
                            ms: spec.zap.ms * j(0.10) };
  return out;
}

function bakeFirearm(ctx, spec, seed) {
  const rate = ctx.sampleRate;
  const n = Math.ceil(rate * spec.seconds);
  const buf = ctx.createBuffer(2, n, rate);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const rand = rng(seed);

  // --- crack, common to both channels ---------------------------------------
  //
  // Two decays rather than one. A single exponential is the shape of an ideal
  // resonator and the shape of every cheap synthesised gunshot; a real report
  // has a very fast initial collapse as the blast escapes and a slower one as
  // the barrel and the air settle, and the ear reads the ratio between them as
  // "how big was that". d1 carries the snap, d2 carries the size.
  const c = spec.crack;
  const crackLen = Math.min(n, Math.ceil(rate * (c.d2 * 7 + 0.005)));
  const glideS = c.glideMs / 1000;
  const nwaveS = c.nwaveMs / 1000;
  // 60 microseconds of rise. Not zero: a true step is a full-scale
  // discontinuity at the buffer's first sample, which reads as a digital click
  // sitting on top of the shot rather than as part of it.
  const riseS = 0.00006;
  const hpK = poleK(c.hpHz, rate);

  let lp = 0, hp = 0, prev = 0;
  for (let i = 0; i < crackLen; i++) {
    const t = i / rate;
    const rise = t < riseS ? t / riseS : 1;
    const a = rise * (0.74 * Math.exp(-t / c.d1) + 0.26 * Math.exp(-t / c.d2));

    // The N-wave: the pressure signature of a blast in air. It is what makes
    // this read as an explosion rather than as a burst of hiss, and it is the
    // deterministic part of a shot that is otherwise all noise.
    const nw = t < nwaveS ? (1 - 2 * (t / nwaveS)) : 0;
    const w = rand() * 2 - 1;
    const s = w * c.mix + nw * (1 - c.mix) * 2.2;

    // The collapsing lowpass. THIS is the layer that was missing: at t=0 the
    // cutoff is above the top of hearing, so the first sample is genuinely
    // broadband, and eight milliseconds later it is down at 1.7 kHz. A fixed
    // bandpass cannot do this and it is why the old shots had nothing above
    // 8 kHz to hear.
    const k = poleK(glideHz(c.openHz, c.closeHz, t / glideS), rate);
    lp += k * (s - lp);

    // One-pole highpass, so the crack does not compete with the body for the
    // low end. Without it the two layers sum into mud rather than stacking.
    hp = (1 - hpK) * (hp + lp - prev);
    prev = lp;

    const val = hp * a * c.level;
    L[i] += val; R[i] += val;
  }

  // --- body, common to both channels ----------------------------------------
  const b = spec.body;
  const bodyS = b.ms / 1000;
  const bodyLen = Math.min(n, Math.ceil(rate * bodyS * 4));
  const tanhD = Math.tanh(b.drive);
  let phase = b.phase || 0;
  for (let i = 0; i < bodyLen; i++) {
    const t = i / rate;
    const f = glideHz(b.hz0, b.hz1, t / bodyS);
    phase += 2 * Math.PI * f / rate;
    // A 0.8 ms rise on the body. Shorter and the body's own onset becomes a
    // second click competing with the crack; longer and the shot feels late.
    const a = Math.exp(-t / (bodyS * 0.42)) * (1 - Math.exp(-t / 0.0008));
    // tanh saturation. A pure sine at 88 Hz has one partial and a laptop
    // speaker reproduces none of it. Driven into tanh it grows odd harmonics at
    // 264 and 440 Hz, which that speaker CAN reproduce, and the ear reconstructs
    // the missing fundamental from them. This is why the body is audible at all
    // on the hardware most of these players are using.
    const s = Math.tanh(Math.sin(phase) * b.drive) / tanhD;
    const val = s * a * b.level;
    L[i] += val; R[i] += val;
  }

  // --- tail, generated twice ------------------------------------------------
  const tl = spec.tail;
  const tailS = tl.ms / 1000;
  const tailLen = Math.min(n, Math.ceil(rate * tailS * 3));
  for (const ch of [L, R]) {
    let tlp = 0;
    for (let i = 0; i < tailLen; i++) {
      const t = i / rate;
      const a = Math.exp(-t / (tailS * 0.34));
      const k = poleK(glideHz(tl.openHz, tl.closeHz, t / tailS), rate);
      tlp += k * ((rand() * 2 - 1) - tlp);
      ch[i] += tlp * a * tl.level;
    }
  }

  // --- slap: the crack coming back ------------------------------------------
  //
  // A delayed, darkened, quiet copy of the crack. The two channels use
  // different delays, which is both physically right - the return path to each
  // ear is a different length - and the cheapest possible way to make the tail
  // feel like it has a direction rather than sitting in the middle of the head.
  if (spec.slap) {
    const sp = spec.slap;
    const chans = [L, R];
    for (let ci = 0; ci < 2; ci++) {
      const off = Math.floor(rate * sp.ms[ci] / 1000);
      const k = poleK(sp.lpHz, rate);
      let slp = 0;
      for (let i = 0; i + off < n && i < crackLen; i++) {
        slp += k * (chans[ci][i] - slp);
        chans[ci][i + off] += slp * sp.level;
      }
    }
  }

  normalise(buf, spec.peak);
  return buf;
}

/**
 * The Sunspear.
 *
 * No blast, so no N-wave and no saturated thump. Three parts instead:
 *
 *   CHARGE   26 ms of resonance sweeping UP into the shot. It is what makes the
 *            weapon read as something that had to build before it could fire,
 *            which is the single cue that separates an energy weapon from a
 *            firearm with the low end removed.
 *   ZAP      a two-pole resonator whose centre frequency falls two decades over
 *            190 ms, excited by noise. The resonance falling rather than the
 *            amplitude decaying is the discharge.
 *   CRACKLE  amplitude modulation by band-limited noise, so the discharge is
 *            unstable. A clean glide is a synthesiser; an unstable one is an arc.
 */
function bakeEnergy(ctx, spec, seed) {
  const rate = ctx.sampleRate;
  const n = Math.ceil(rate * spec.seconds);
  const buf = ctx.createBuffer(2, n, rate);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const rand = rng(seed);

  const ch = spec.charge;
  const chS = ch.ms / 1000;
  const chLen = Math.floor(rate * chS);
  let cphase = 0;
  for (let i = 0; i < chLen; i++) {
    const u = i / chLen;
    const f = glideHz(ch.hz0, ch.hz1, u);
    cphase += 2 * Math.PI * f / rate;
    // Squared ramp, so the charge is quiet until it is nearly there and then
    // arrives. A linear fade-in sounds like a fade-in.
    const a = u * u * ch.level;
    const val = Math.sin(cphase) * a;
    L[i] += val; R[i] += val;
  }

  const z = spec.zap;
  const zS = z.ms / 1000;
  const zLen = Math.min(n - chLen, Math.ceil(rate * zS * 2.2));
  // Two-pole resonator, retuned every sample. r sets the bandwidth: closer to
  // one is a narrower, longer ring, and 0.006 of the sample rate is wide enough
  // to stay a noise and narrow enough to have a pitch.
  const r = Math.exp(-Math.PI * z.q * 2);
  let y1 = 0, y2 = 0, crk = 0;
  for (let i = 0; i < zLen; i++) {
    const t = i / rate;
    const u = t / zS;
    const f = glideHz(z.hz0, z.hz1, u);
    const w0 = 2 * Math.PI * f / rate;

    // Two-stage excitation, for the same reason the firearms have two decays:
    // the ignition is the arc striking and it is nearly instant, the remainder
    // is the capacitor emptying. One envelope gives a discharge with no onset,
    // and a weapon with no onset does not read as having been fired - it reads
    // as having been faded in, which is what the first version of this did.
    const ex = z.ignition * Math.exp(-t / z.d1) + (1 - z.ignition) * Math.exp(-t / (zS * 0.5));
    const x = (rand() * 2 - 1) * ex;
    const y = x + 2 * r * Math.cos(w0) * y1 - r * r * y2;
    y2 = y1; y1 = y;

    // Band-limited noise as a modulator: one-pole smoothed white, which is a
    // cheap 200 Hz-ish wander rather than per-sample hash. Kept shallow and
    // clamped positive, because a modulator that can exceed unity moves the
    // loudest sample of the whole shot to a random point in the middle of it.
    crk += 0.02 * ((rand() * 2 - 1) - crk);
    const m = Math.max(0.25, 1 + z.crackle * crk * 4);

    const val = y * (1 - r) * 3.2 * m * z.level;
    L[chLen + i] += val; R[chLen + i] += val;
  }

  const tl = spec.tail;
  const tailS = tl.ms / 1000;
  const tailLen = Math.min(n - chLen, Math.ceil(rate * tailS * 2.4));
  for (const chan of [L, R]) {
    let tlp = 0;
    for (let i = 0; i < tailLen; i++) {
      const t = i / rate;
      const a = Math.exp(-t / (tailS * 0.36));
      const k = poleK(glideHz(tl.openHz, tl.closeHz, t / tailS), rate);
      tlp += k * ((rand() * 2 - 1) - tlp);
      chan[chLen + i] += tlp * a * tl.level;
    }
  }

  normalise(buf, spec.peak);
  return buf;
}

/**
 * The mechanical bank: the action cycling.
 *
 * This is the layer whose ABSENCE reads as fake without the listener being able
 * to say why. A gun is a machine, and after every round something heavy moves,
 * hits a stop, and comes back. There was none of it in the old shot() - the
 * mechanical vocabulary existed in audio.js but only for reloads, so the guns
 * fired without ever cycling.
 *
 * One bank of six shared by every weapon, rather than a bank per weapon. What
 * distinguishes an SMG's bolt from a shotgun's pump in practice is rate, level
 * and delay, all of which are per-weapon and all of which are free; baking eight
 * near-identical banks would cost eight times the memory to encode the same
 * information twice.
 *
 * Each variant is a noise burst exciting two or three metal resonators plus a
 * low clack. Resonators rather than filtered noise because metal rings at
 * specific inharmonic frequencies and a bandpass does not: the beating between
 * two close resonances is most of what "metallic" means.
 */
export function bakeMechanics(ctx, count = 6) {
  const rate = ctx.sampleRate;
  const out = [];

  for (let v = 0; v < count; v++) {
    const rand = rng(SEED ^ (0xbeef * (v + 1)));
    const seconds = 0.16;
    const n = Math.ceil(rate * seconds);
    const buf = ctx.createBuffer(1, n, rate);
    const d = buf.getChannelData(0);

    // Excitation: 1.5 ms of noise, which is a strike. Anything longer stops
    // being a strike and starts being a scrape.
    const exLen = Math.floor(rate * 0.0015);
    const ex = new Float32Array(n);
    for (let i = 0; i < exLen; i++) {
      ex[i] = (rand() * 2 - 1) * (1 - i / exLen);
    }

    // Two or three resonances, scattered. The spread is deliberately wide
    // across variants: a bolt does not land the same way twice.
    const modes = 2 + Math.floor(rand() * 2);
    for (let m = 0; m < modes; m++) {
      const hz = 900 + rand() * 4200;
      const decay = 0.012 + rand() * 0.055;
      const amp = 0.55 / (m + 1);
      const r = Math.exp(-1 / (decay * rate));
      const w0 = 2 * Math.PI * hz / rate;
      let y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) {
        const y = ex[i] + 2 * r * Math.cos(w0) * y1 - r * r * y2;
        y2 = y1; y1 = y;
        d[i] += y * (1 - r) * amp;
      }
    }

    // The clack under it: the mass of the part arriving, not the ring.
    const clackHz = 95 + rand() * 70;
    const clackS = 0.028 + rand() * 0.02;
    let ph = 0;
    const clackLen = Math.floor(rate * clackS * 4);
    for (let i = 0; i < clackLen && i < n; i++) {
      const t = i / rate;
      ph += 2 * Math.PI * glideHz(clackHz * 1.7, clackHz * 0.7, t / clackS) / rate;
      d[i] += Math.tanh(Math.sin(ph) * 2) * 0.5 *
              Math.exp(-t / (clackS * 0.4)) * (1 - Math.exp(-t / 0.0006)) * 0.42;
    }

    normalise(buf, 0.85);
    out.push(buf);
  }

  return out;
}

/**
 * Bake the upgrade ring once, at a nominal pitch, and let playbackRate move it.
 *
 * The pack-a-punch shimmer used to be two live oscillators through a highpass,
 * four nodes on every shot from an upgraded automatic. As a buffer it is two
 * nodes and it can be a better sound, because offline there is nothing stopping
 * it from being five inharmonic partials beating against each other instead of
 * two detuned triangles.
 */
export function bakeRing(ctx) {
  const rate = ctx.sampleRate;
  const seconds = 0.7;
  const n = Math.ceil(rate * seconds);
  const buf = ctx.createBuffer(2, n, rate);
  const rand = rng(SEED ^ 0x1234abcd);

  // Ratios off whole numbers, which is what makes struck metal clangorous
  // rather than musical. A stack at 1:2:3 is an organ pipe.
  const partials = [1, 2.41, 3.17, 4.83, 6.29];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let p = 0; p < partials.length; p++) {
      const hz = 1000 * partials[p] * (1 + (rand() - 0.5) * 0.004 * (ch ? 1 : -1));
      const decay = 0.42 / (1 + p * 0.5);
      const amp = 0.6 / (1 + p * 1.1);
      let ph = rand() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        ph += 2 * Math.PI * hz / rate;
        d[i] += Math.sin(ph) * amp * Math.exp(-t / decay) * (1 - Math.exp(-t / 0.0015));
      }
    }
  }

  normalise(buf, 0.7);
  return buf;
}

/**
 * Scale a buffer so its loudest sample hits `target`.
 *
 * Peak rather than loudness normalisation, because these are transients: an
 * RMS-matched set of gunshots would make the bolt rifle quieter than the SMG,
 * since the SMG has far less dynamic range. Peak keeps the relationships in the
 * table meaning what they say.
 */
function normalise(buf, target) {
  let peak = 1e-9;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = d[i] < 0 ? -d[i] : d[i];
      if (a > peak) peak = a;
    }
  }
  const g = target / peak;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= g;
  }
}
