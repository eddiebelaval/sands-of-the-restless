/**
 * Gun lab: measurement, not opinion.
 *
 * You cannot hear a build from a terminal, and neither can the person who asked
 * for it while a test is running. What you CAN do is render the real audio graph
 * into a buffer and measure the buffer, and a thin gunshot differs from a fat
 * one in every number below - not subtly, by margins of tens of decibels.
 *
 * This module is loaded over http by test/gunlab.html and runs inside the page,
 * because that is where the AudioBuffer is. It deliberately contains no
 * knowledge of how any sound is synthesised: it is handed samples and it
 * reports what is in them. If it imported anything from audio.js it would be
 * measuring the description of a shot rather than the shot, which is the same
 * class of mistake as asserting that a node was created.
 *
 * The envelope everything else is derived from is a WINDOWED PEAK, not an RMS
 * and not a one-pole follower. A gunshot's opening edge is two or three
 * milliseconds wide; an RMS window long enough to be stable is longer than the
 * feature being measured, and a one-pole follower with a time constant short
 * enough to catch the edge is dominated by the noise it is following. A peak
 * over a short sliding window has neither problem and is exactly what the ear's
 * transient detection approximates.
 */

/** Envelope hop and window, in samples at 48k: 0.33ms steps, 1ms window. */
const HOP = 16;
const WIN = 48;

const EPS = 1e-12;

export function db(x) { return 20 * Math.log10(Math.max(Math.abs(x), EPS)); }

/** Sum an AudioBuffer to mono. Level metrics want the event, not a channel. */
export function toMono(buffer) {
  const n = buffer.length;
  const out = new Float32Array(n);
  const chs = buffer.numberOfChannels;
  for (let c = 0; c < chs; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i];
  }
  if (chs > 1) for (let i = 0; i < n; i++) out[i] /= chs;
  return out;
}

/**
 * Windowed peak envelope. Returns { env, hop, rate } where env[k] is the peak
 * absolute sample in [k*HOP, k*HOP + WIN).
 */
export function envelope(x, rate) {
  const steps = Math.max(1, Math.floor((x.length - WIN) / HOP));
  const env = new Float32Array(steps);
  for (let k = 0; k < steps; k++) {
    const s = k * HOP;
    let m = 0;
    for (let i = s; i < s + WIN; i++) {
      const a = x[i] < 0 ? -x[i] : x[i];
      if (a > m) m = a;
    }
    env[k] = m;
  }
  return { env, hop: HOP, rate, secondsPerStep: HOP / rate };
}

/**
 * Iterative radix-2 FFT, in place, on interleaved-free real/imag arrays.
 * Length must be a power of two. Written out rather than pulled from a library
 * because this project has no bundler and no dependency it does not build.
 */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/**
 * Magnitude spectrum of `size` samples starting at `from`, Hann windowed.
 * Hann rather than rectangular because a gunshot chopped at an arbitrary point
 * has a discontinuity at the window edge, and a rectangular window turns that
 * discontinuity into broadband energy that would be read as brightness.
 */
export function spectrum(x, from, size, rate) {
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const s = from + i;
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1));
    re[i] = (s < x.length ? x[s] : 0) * w;
  }
  fft(re, im);
  const half = size / 2;
  const mag = new Float32Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]) / half;
  return { mag, binHz: rate / size };
}

/** The bands the ear reads a gunshot in. Names are what they contribute. */
export const BANDS = [
  ['sub', 20, 60],        // felt more than heard; chest
  ['low', 60, 200],       // calibre and weight. Pistol vs LMG lives here.
  ['lowmid', 200, 800],   // the body of the report
  ['mid', 800, 3000],     // the crack proper
  ['high', 3000, 8000],   // the snap, the edge
  ['air', 8000, 20000],   // brass, air, the part that reads as "recorded"
];

export function bandLevels(mag, binHz) {
  const out = {};
  for (const [name, lo, hi] of BANDS) {
    let sum = 0;
    const a = Math.max(1, Math.floor(lo / binHz));
    const b = Math.min(mag.length - 1, Math.ceil(hi / binHz));
    for (let i = a; i <= b; i++) sum += mag[i] * mag[i];
    out[name] = +db(Math.sqrt(sum)).toFixed(2);
  }
  return out;
}

export function centroid(mag, binHz) {
  let num = 0, den = 0;
  for (let i = 1; i < mag.length; i++) {
    num += i * binHz * mag[i];
    den += mag[i];
  }
  return den > 0 ? num / den : 0;
}

/**
 * Distinct transients in an envelope.
 *
 * This is the strongest single check available for the B3AR, whose three cracks
 * land 40ms apart and must stay individually audible. A peak alone is not
 * enough - a smeared hump has peaks too. The test that matters is whether the
 * envelope FELL between them, so a candidate only counts if it is the maximum
 * in a window around itself AND the level dipped meaningfully below it within
 * the preceding `lookbackMs`. Three cracks whose bodies overlap into one plateau
 * fail that test, which is exactly the failure we are trying to detect.
 *
 * dipRatio 0.55 is roughly a 5dB dip. Below about 3dB the ear stops hearing two
 * events and starts hearing one event with a bump in it.
 */
export function transients(env, secondsPerStep, opts = {}) {
  const minSepMs = opts.minSepMs ?? 15;
  const lookbackMs = opts.lookbackMs ?? 30;
  const floorRatio = opts.floorRatio ?? 0.14;
  const dipRatio = opts.dipRatio ?? 0.55;

  const stepMs = secondsPerStep * 1000;
  const sep = Math.max(1, Math.round(minSepMs / stepMs));
  const back = Math.max(1, Math.round(lookbackMs / stepMs));

  let peak = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > peak) peak = env[i];
  if (peak <= 0) return [];

  const found = [];
  for (let i = 1; i < env.length - 1; i++) {
    const v = env[i];
    if (v < peak * floorRatio) continue;

    let isMax = true;
    for (let j = Math.max(0, i - sep); j <= Math.min(env.length - 1, i + sep); j++) {
      if (env[j] > v) { isMax = false; break; }
    }
    if (!isMax) continue;

    // The dip test, and the number that matters more than the count.
    //
    // dipDb is how far the envelope FELL below this peak in the window before
    // it. Three cracks with a 12dB trough between them are three cracks; three
    // cracks with a 2dB trough between them are one noise with lumps in it, and
    // the count alone cannot tell those apart. The count is the headline, the
    // dip is the evidence behind it.
    let floor = v;
    for (let j = Math.max(0, i - back); j < i; j++) if (env[j] < floor) floor = env[j];
    const dipDb = +(db(v) - db(floor)).toFixed(2);
    if (floor >= v * dipRatio) continue;

    if (found.length && (i - found[found.length - 1].step) < sep) continue;
    found.push({ step: i, ms: +(i * stepMs).toFixed(2), level: +db(v).toFixed(2), dipDb });
  }
  return found;
}

/**
 * THE BURST CHECK, and the sharpest single measurement in this file.
 *
 * transients() above finds whatever transients happen to be in a buffer, which
 * is the right tool for "is there structure here" and the wrong one for "did
 * the three rounds I fired stay separate". It cannot tell a crack from a bolt
 * cycling, so a burst that also has a mechanical layer in the gaps reports five
 * events and the count stops meaning anything.
 *
 * This goes the other way round. It is TOLD when the rounds were fired, looks
 * only where each one must be, and reports two things:
 *
 *   the level of each crack   three cracks that climb in level are a burst
 *                             piling up on its own tails, which reads as a
 *                             crescendo rather than as three hits.
 *
 *   the TROUGH between them   how far the envelope actually fell in the gap.
 *                             This is the number that decides whether the burst
 *                             is three events or one noise with lumps in it.
 *                             Under about 3dB the ear stops hearing two things;
 *                             over about 8dB they are unmistakably separate.
 *
 * Everything else about the B3AR is somebody else's file. This is the part that
 * decides whether the weapon still sounds like the thing it is named after, and
 * it is directly measurable, so it gets measured rather than described.
 */
export function burstCracks(buffer, gapMs, count, opts = {}) {
  const rate = buffer.sampleRate;
  const x = toMono(buffer);
  const { env, secondsPerStep } = envelope(x, rate);
  const stepMs = secondsPerStep * 1000;

  let peak = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > peak) peak = env[i];
  if (peak <= 0) return null;

  let onset = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > peak * 0.02) { onset = i; break; }

  // Look within +/-12ms of where each round is due. Wide enough to absorb the
  // per-shot playback rate jitter and the scheduling slack, narrow enough that
  // it can never wander onto the neighbouring round 41.6ms away.
  const win = Math.round((opts.windowMs ?? 12) / stepMs);
  const cracks = [];
  for (let k = 0; k < count; k++) {
    const centre = onset + Math.round(k * gapMs / stepMs);
    let m = 0, mi = centre;
    for (let i = Math.max(0, centre - win); i <= Math.min(env.length - 1, centre + win); i++) {
      if (env[i] > m) { m = env[i]; mi = i; }
    }
    cracks.push({ round: k + 1, ms: +((mi - onset) * stepMs).toFixed(2),
                  level: +db(m).toFixed(2), step: mi, lin: m });
  }

  const troughs = [];
  for (let k = 0; k < count - 1; k++) {
    let lo = Infinity, li = cracks[k].step;
    for (let i = cracks[k].step + 1; i < cracks[k + 1].step; i++) {
      if (env[i] < lo) { lo = env[i]; li = i; }
    }
    // Measured against the QUIETER of the two cracks it sits between. Against
    // the louder one, a shallow trough beside one loud round would look deep,
    // which is exactly the case this exists to catch.
    const ref = Math.min(cracks[k].lin, cracks[k + 1].lin);
    troughs.push({ between: `${k + 1}-${k + 2}`, ms: +((li - onset) * stepMs).toFixed(2),
                   depthDb: +(db(ref) - db(lo)).toFixed(2) });
  }

  const levels = cracks.map((c) => c.level);
  const depths = troughs.map((t) => t.depthDb);
  return {
    gapMs, count,
    cracks: cracks.map(({ step, lin, ...c }) => c),
    troughs,
    spreadDb: +(Math.max(...levels) - Math.min(...levels)).toFixed(2),
    minTroughDb: +Math.min(...depths).toFixed(2),
  };
}

/**
 * The whole measurement of one rendered event.
 *
 * attackMs is onset to peak. A convincing gunshot is a few milliseconds here;
 * tens of milliseconds is a synth pad with a fast attack, and it is the single
 * number that most reliably separates the two.
 */
export function analyse(buffer, opts = {}) {
  const rate = buffer.sampleRate;
  const x = toMono(buffer);
  const { env, secondsPerStep } = envelope(x, rate);

  let peak = 0, peakStep = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > peak) { peak = env[i]; peakStep = i; }

  let samplePeak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > samplePeak) samplePeak = a; }

  // Onset at -34dB below peak. Lower thresholds start tracking the render's
  // own noise floor and report an onset before the sound exists.
  let onsetStep = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > peak * 0.02) { onsetStep = i; break; }

  /**
   * ATTACK IS MEASURED TO THE REPORT, NOT TO THE LOUDEST SAMPLE IN THE BUFFER.
   *
   * A weapon with a mechanical layer has a second event in it - a bolt gun's
   * action cycles about 280ms after the round leaves - and taking the global
   * maximum makes "attack time" mean "how long until the bolt was worked",
   * which was 290ms and read as a catastrophic regression when the report's own
   * attack was under a millisecond. The report is whatever is loudest in the
   * first 60ms, which is well past any muzzle blast and well short of any
   * action.
   */
  const reportWin = Math.round(0.06 / secondsPerStep);
  let rPeak = 0, rStep = onsetStep;
  for (let i = onsetStep; i < Math.min(env.length, onsetStep + reportWin); i++) {
    if (env[i] > rPeak) { rPeak = env[i]; rStep = i; }
  }
  const peakStepUsed = rStep;

  const after = (ratio) => {
    for (let i = peakStepUsed; i < env.length; i++) if (env[i] < rPeak * ratio) return i;
    return env.length - 1;
  };
  const d20 = after(0.1);
  const d40 = after(0.01);
  const d60 = after(0.001);

  // RMS across the event only. Including the silence after it would make a
  // long tail look quiet and a short one look loud, which is backwards.
  const a = onsetStep * HOP;
  const b = Math.min(x.length, d60 * HOP + WIN);
  let sq = 0;
  for (let i = a; i < b; i++) sq += x[i] * x[i];
  const rms = Math.sqrt(sq / Math.max(1, b - a));

  const fftSize = opts.fftSize ?? 8192;
  const { mag, binHz } = spectrum(x, a, fftSize, rate);

  // A second, short spectrum over the first 12ms only: the transient's own
  // colour, unpolluted by the tail. This is what "sharpness" actually means.
  // A short spectrum over the first ~21ms only. Band levels taken over the
  // whole event are diluted by however long the tail happens to be, which makes
  // a short bright weapon look darker than a long dull one; over the transient
  // alone the comparison is between the edges, which is what "bright" means.
  const tSize = 1024;
  const tSpec = spectrum(x, a, tSize, rate);

  const ms = (step) => +((step - onsetStep) * secondsPerStep * 1000).toFixed(2);

  // Clipping. Nothing downstream of ctx.destination will tell you about it and
  // the ear hears it as the guns having gone crunchy, not as a level problem.
  let clipped = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= 0.999) clipped++;

  /**
   * EDGE SHARPNESS, and why it is the honest version of "is it broadband".
   *
   * Band energy over a window is a poor test of a gunshot's opening edge,
   * because it is dominated by whatever the signal does for the REST of the
   * window. A band-limited noise burst that rings for 55ms accumulates more
   * 8-20kHz energy over 21ms than a genuine two-sample discontinuity that has
   * gone dark by millisecond three - and the second one is the gunshot.
   *
   * Maximum sample-to-sample slew, as a fraction of the peak, has no such
   * problem: it is a property of the sharpest single moment in the buffer and
   * band-limiting caps it outright. A signal with no content above f cannot
   * slew faster than peak * 2*pi*f/rate per sample, so at 48kHz a 4kHz-limited
   * signal is stuck below about 0.52 no matter how it is enveloped, while a
   * true edge approaches 1. It cannot be faked by making something louder,
   * longer or more enveloped.
   */
  let maxSlew = 0;
  for (let i = 1; i < x.length; i++) {
    const d = Math.abs(x[i] - x[i - 1]);
    if (d > maxSlew) maxSlew = d;
  }

  // The spectrum of the first 2.7ms alone: the edge, and nothing after it.
  const eSpec = spectrum(x, a, 128, rate);

  const tr = transients(env, secondsPerStep);
  let loudest = -Infinity;
  for (const t of tr) if (t.level > loudest) loudest = t.level;

  return {
    rate,
    peak: +samplePeak.toFixed(5),
    peakDb: +db(samplePeak).toFixed(2),
    clippedSamples: clipped,
    rms: +rms.toFixed(5),
    rmsDb: +db(rms).toFixed(2),
    crestDb: +(db(samplePeak) - db(rms)).toFixed(2),
    attackMs: ms(peakStepUsed),
    globalPeakMs: ms(peakStep),
    reportPeakDb: +db(rPeak).toFixed(2),
    primaryTransients: tr.filter((t) => t.level > loudest - 10).length,
    decay20Ms: ms(d20),
    decay40Ms: ms(d40),
    decay60Ms: ms(d60),
    centroidHz: Math.round(centroid(mag, binHz)),
    transientCentroidHz: Math.round(centroid(tSpec.mag, tSpec.binHz)),
    bands: bandLevels(mag, binHz),
    transientBands: bandLevels(tSpec.mag, tSpec.binHz),
    edgeBands: bandLevels(eSpec.mag, eSpec.binHz),
    maxSlew: +maxSlew.toFixed(5),
    slewPerPeak: +(maxSlew / Math.max(samplePeak, 1e-9)).toFixed(4),
    transients: tr,
    onsetStep,
    secondsPerStep,
  };
}

/** Downsample an envelope to `points` for plotting, in dB relative to peak. */
export function plotEnvelope(buffer, points = 1400, seconds = 0.9) {
  const rate = buffer.sampleRate;
  const x = toMono(buffer);
  const n = Math.min(x.length, Math.floor(rate * seconds));
  const out = new Array(points);
  let peak = 1e-12;
  for (let i = 0; i < n; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  for (let p = 0; p < points; p++) {
    const s = Math.floor(p * n / points);
    const e = Math.max(s + 1, Math.floor((p + 1) * n / points));
    let m = 0;
    for (let i = s; i < e; i++) { const a = Math.abs(x[i]); if (a > m) m = a; }
    out[p] = +(20 * Math.log10(Math.max(m, 1e-6) / peak)).toFixed(2);
  }
  return { points: out, seconds: n / rate, peak: +peak.toFixed(5) };
}

/**
 * How different are two renders of the same sound?
 *
 * Identical playback on every shot is the most artificial thing a game can do,
 * and it is trivially detectable: two renders of a varied sound differ in peak,
 * in length, and sample by sample. `identical` true is a hard failure, not a
 * warning.
 */
export function compare(a, b) {
  const xa = toMono(a), xb = toMono(b);
  const n = Math.min(xa.length, xb.length);
  let diff = 0, same = 0, ea = 0, eb = 0, cross = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(xa[i] - xb[i]);
    if (d > diff) diff = d;
    if (d < 1e-9) same++;
    ea += xa[i] * xa[i];
    eb += xb[i] * xb[i];
    cross += xa[i] * xb[i];
  }
  const corr = (ea > 0 && eb > 0) ? cross / Math.sqrt(ea * eb) : 1;
  return {
    maxSampleDiff: +diff.toFixed(6),
    identicalFraction: +(same / n).toFixed(4),
    correlation: +corr.toFixed(4),
    identical: diff < 1e-9,
  };
}
