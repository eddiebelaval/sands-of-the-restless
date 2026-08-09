/**
 * DOES EACH ENEMY SOUND LIKE THE THING IT IS.
 *
 * The complaint this file exists to answer was that everything in the horde
 * moans, and that the scarabs - which are beetles the size of a dog - moan
 * fastest. That was literally true of the code: mummy.js played 'groan' for
 * every variant in the game and told them apart with `spec.voicePitch`, one
 * scalar, so the roster was one throat played at six speeds.
 *
 * "IT SOUNDS BETTER" IS NOT A MEASUREMENT, and this project has shipped three
 * defects this month through harnesses that measured what the code reported
 * about itself. So nothing here asks the audio module a question. Every sound is
 * RENDERED through an OfflineAudioContext - the real createAudio(), the real
 * buses, the real convolver - and every number below is computed from the
 * samples that came out. That is the audio equivalent of the pixel measurement
 * this project requires of anything visual.
 *
 * THE CONTROL IS IN THE SAME RUN, five times over:
 *
 *   1. DISTINCTNESS. Every enemy's tell is rendered and measured side by side,
 *      and the whole table is printed. A pair that measures nearly identical is
 *      a REPORTED FAILURE, not a number to tune around - two enemies the ear
 *      cannot separate is the original bug, whatever the new code is called.
 *
 *   2. THE OLD SCARAB IS THE CONTROL FOR THE NEW ONE. `groan` at pitch 2.0 is
 *      still reachable through the router and is bit-for-bit the call mummy.js
 *      used to make, so "it stopped being a pitched-up moan" is measured against
 *      the pitched-up moan itself, rendered in the same process, seconds apart.
 *      The number that carries it is the spectral-shape similarity to the
 *      SHAMBLER: same throat means same formant bank means high similarity, and
 *      that is the one measure a change of pitch cannot move.
 *
 *   3. THE STEP RATE IS DRIVEN BY MOVING AN ACTOR, not by reading a timer back.
 *      A scarab is placed in the real world, run at three different speed
 *      scales, and two independent quantities are counted: metres it actually
 *      covered, taken from its own position each frame, and steps that actually
 *      allocated a voice, taken from the audio module's play ledger. Steps per
 *      metre has to hold still while steps per second moves.
 *
 *   4. MASKING. Gunfire and the reload are the priority signals and codecTick
 *      carries every word of story text in the game. The new sounds are measured
 *      in those bands against those sounds.
 *
 *   5. TWENTY-FOUR ACTORS. A per-step tick on a full horde is a far bigger
 *      budget problem than a groan every four to eleven seconds. The live cap is
 *      filled with the worst case - all scarabs, all charging - and the voice
 *      count is sampled every frame off the module's own live set.
 *
 * IT RUNS AGAINST BOTH TREES ON PURPOSE. Everything it needs to know about
 * which sound belongs to which enemy is read out of `variants.js` at run time,
 * and a variant with no `sound` block falls back to the groan the old code
 * played. So the same file produces the BEFORE table and the AFTER table, and
 * the two are comparable because they were produced by identical code.
 *
 *   npm start                  (python3 -m http.server 4177, from the repo root)
 *   node test/enemyaudio.mjs
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4188';
const PAGE = `${BASE}/index.html`;

/**
 * How far apart two enemies must measure before the ear is being given anything
 * to work with, in the log2(centroid) x log2(duration) plane.
 *
 * 0.35 is a shade over a quarter octave of brightness at equal length. Two
 * sounds closer than that in both axes at once are the same sound with the
 * knobs moved, which is what the whole roster was.
 */
const PAIR_MARGIN = 0.35;

/**
 * How far above the humanoids the scarab has to sit.
 *
 * A ratio rather than an absolute, because the humanoids are allowed to move
 * and this has to keep being true after the next person retunes a throat.
 *
 * ONE FULL OCTAVE of spectral centroid, against the BRIGHTEST voice in the
 * roster rather than the average one - so the margin is measured against the
 * worst case and a single bright throat cannot quietly close the gap for
 * everybody. An octave is chosen because it is the interval at which two
 * timbres stop being compared and start being categorised; it is also, as it
 * happens, roughly the distance between a shout and a fingernail on stone.
 */
const SCARAB_CENTROID_RATIO = 2.0;

/** Renders per sound. These are randomised per call; one draw proves nothing. */
const DRAWS = 9;

const fail = [];
const warn = [];
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }
function check(name, ok, detail) {
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) fail.push(name);
}

// ---------------------------------------------------------------------------
// a stale server has made agents test the wrong tree in this repo before
// ---------------------------------------------------------------------------

const diskSha = createHash('sha256')
  .update(readFileSync(new URL('../src/core/audio.js', import.meta.url))).digest('hex');
const servedSha = createHash('sha256')
  .update(Buffer.from(await (await fetch(`${BASE}/src/core/audio.js`)).arrayBuffer())).digest('hex');
if (diskSha !== servedSha) {
  console.error(`served audio.js does not match disk.\n  disk   ${diskSha}\n  served ${servedSha}`);
  console.error('a stale http.server from a previous session is serving an old tree. restart it.');
  process.exit(1);
}
const mummySha = createHash('sha256')
  .update(readFileSync(new URL('../src/enemies/mummy.js', import.meta.url))).digest('hex');

log(`audio.js  sha256 ${diskSha.slice(0, 16)}`);
log(`mummy.js  sha256 ${mummySha.slice(0, 16)}`);
log('');

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    // Without this the AudioContext comes up suspended, ctx.currentTime never
    // advances, no source ever reports ended, and the live voice count climbs
    // to the cap and stays there. That is a measurement of the autoplay policy
    // dressed up as a measurement of the mix.
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });

// ---------------------------------------------------------------------------
// the offline bench
// ---------------------------------------------------------------------------

/**
 * Everything below runs in the page, because the thing under test is a Web
 * Audio graph and there is no Web Audio in node. It is installed once and then
 * called section by section, so a failure in one section still prints the rest.
 */
await page.evaluate(async () => {
  const { createAudio } = await import('/src/core/audio.js');
  const An = await import('/test/gunlab-analysis.js');
  const { VARIANTS } = await import('/src/enemies/variants.js');

  const RATE = 48000;

  /** Render a list of {name, opts, at} into a fresh offline context. */
  async function render(events, seconds = 2.4, setup = {}) {
    const oac = new OfflineAudioContext(2, Math.floor(RATE * seconds), RATE);
    const audio = createAudio({ context: oac, volume: 1 });
    await audio.resume();
    if (setup.space) audio.setSpace(setup.space);
    for (const e of events) {
      if (e.weapon) audio.shot(e.weapon, e.opts || {});
      else audio.play(e.name, e.opts || {});
    }
    const buf = await oac.startRendering();
    return buf;
  }

  /**
   * The shape of a sound's spectrum, independent of its pitch and its level.
   *
   * Third-octave magnitudes, in dB, mean-removed and unit-normalised. Two
   * sounds made by the same filter bank land on the same shape however they are
   * pitched, which is exactly the property that makes this the right measure for
   * "is the scarab still coming out of the mummy's throat": transposition slides
   * the harmonics and leaves the formants where they are.
   */
  function shape(buf) {
    const x = An.toMono(buf);
    // Find the loudest 4096-sample window and take the spectrum there, so a
    // long quiet tail cannot dominate a short loud event or the other way up.
    let best = 0, bestE = -1;
    const win = 4096;
    for (let s = 0; s + win < x.length; s += win / 2) {
      let e = 0;
      for (let i = s; i < s + win; i++) e += x[i] * x[i];
      if (e > bestE) { bestE = e; best = s; }
    }
    const { mag, binHz } = An.spectrum(x, best, win, RATE);
    const bands = [];
    for (let f = 100; f < 16000; f *= Math.pow(2, 1 / 3)) {
      const a = Math.max(1, Math.floor(f / binHz));
      const b = Math.min(mag.length - 1, Math.ceil(f * Math.pow(2, 1 / 3) / binHz));
      let sum = 0;
      for (let i = a; i <= b; i++) sum += mag[i] * mag[i];
      bands.push(20 * Math.log10(Math.sqrt(sum) + 1e-12));
    }
    const mean = bands.reduce((p, q) => p + q, 0) / bands.length;
    const c = bands.map((v) => v - mean);
    const n = Math.sqrt(c.reduce((p, q) => p + q * q, 0)) || 1;
    return c.map((v) => v / n);
  }

  function cosine(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  /** Render one sound `draws` times and average what the samples say. */
  async function profile(events, draws, seconds) {
    const rows = [];
    const shapes = [];
    for (let i = 0; i < draws; i++) {
      const buf = await render(events, seconds);
      rows.push(An.analyse(buf));
      shapes.push(shape(buf));
    }
    const mean = (f) => rows.reduce((p, r) => p + f(r), 0) / rows.length;
    const spread = (f) => {
      const m = mean(f);
      return Math.sqrt(rows.reduce((p, r) => p + (f(r) - m) ** 2, 0) / rows.length);
    };
    // The mean shape, renormalised. Averaging kills the per-draw randomness and
    // leaves the filter bank, which is the part that identifies the throat.
    const ms = shapes[0].map((_, i) => shapes.reduce((p, s) => p + s[i], 0) / shapes.length);
    const n = Math.sqrt(ms.reduce((p, q) => p + q * q, 0)) || 1;
    return {
      centroidHz: Math.round(mean((r) => r.centroidHz)),
      centroidSd: Math.round(spread((r) => r.centroidHz)),
      durationMs: +mean((r) => r.decay40Ms).toFixed(1),
      durationSd: +spread((r) => r.decay40Ms).toFixed(1),
      attackMs: +mean((r) => r.attackMs).toFixed(2),
      peak: +mean((r) => r.peak).toFixed(4),
      rmsDb: +mean((r) => r.rmsDb).toFixed(2),
      crestDb: +mean((r) => r.crestDb).toFixed(2),
      onsets: +mean((r) => r.primaryTransients).toFixed(1),
      bands: rows[0].bands,
      meanBands: An.BANDS.map(([nm]) => [nm,
        +(rows.reduce((p, r) => p + r.bands[nm], 0) / rows.length).toFixed(2)]),
      shape: ms.map((v) => v / n),
    };
  }

  /**
   * What each variant's off-screen tell IS, read out of the spec rather than
   * hardcoded here.
   *
   * A variant with no `sound` block is the old tree, where every enemy's tell
   * was `groan` at its own `voicePitch`. Returning that verbatim is what lets
   * this file produce the before table and the after table with one body of
   * code.
   */
  function tellOf(spec) {
    const S = spec.sound;
    if (!S) return { name: 'groan', opts: { pitch: spec.voicePitch }, legacy: true };
    const idle = S.idle || 'groan';
    // Mirrors say() in mummy.js exactly, including the shell's pitch override.
    // A harness that assembles the options differently from the game is a
    // harness measuring a sound the game never plays.
    const opts = { pitch: S.pitch ?? spec.voicePitch };
    if (S.throat) opts.throat = S.throat;
    if (S.chitin) opts.chitin = S.chitin;
    return { name: idle, opts, legacy: false };
  }

  /** What each variant plays per step, if anything. */
  function stepOf(spec) {
    const S = spec.sound;
    if (!S || !S.step) return { name: 'footfall', opts: { pitch: spec.voicePitch }, legacy: true };
    const opts = { pitch: S.pitch ?? spec.voicePitch };
    if (S.throat) opts.throat = S.throat;
    if (S.chitin) opts.chitin = S.chitin;
    return { name: S.step.name, opts, legacy: false, stride: S.step.stride };
  }

  /**
   * Run something with Math.random replaced by a seeded generator, then put the
   * real one back.
   *
   * Every sound in this module randomises itself per call - that is the whole
   * reason a horde is a crowd and not one voice played twenty times - and it
   * makes an A/B of one PARAMETER impossible by ordinary means: two renders
   * differ by the thing under test and by nine dice rolls, and the dice win.
   * The elevation cue is a few decibels in one band, which is comfortably
   * inside the draw-to-draw spread.
   *
   * With the same seed on both sides, the two renders are bit-identical
   * everywhere except the filter being measured, so the difference IS the cue.
   * This is the same argument the compressor forensics in gunlab.html makes for
   * seeding its test transient, and it is the only honest way to attribute a
   * change to a node.
   */
  async function seeded(seed, fn) {
    const real = Math.random;
    let s = seed >>> 0;
    Math.random = () => {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    try { return await fn(); } finally { Math.random = real; }
  }

  window.__EA__ = { render, profile, shape, cosine, VARIANTS, tellOf, stepOf, An, RATE,
                    createAudio, seeded };
});

// ---------------------------------------------------------------------------
// 0. what exists
// ---------------------------------------------------------------------------

const inventory = await page.evaluate(async () => {
  const { createAudio, VARIANTS, tellOf, stepOf } = window.__EA__;
  const oac = new OfflineAudioContext(1, 128, 48000);
  const audio = createAudio({ context: oac });
  await audio.resume();
  const names = ['groan', 'footfall', 'swipe', 'deathRattle', 'codecTick',
                 'chitinStep', 'chitinRasp', 'shellCrack'];
  const present = {};
  for (const n of names) present[n] = typeof audio[n] === 'function';
  const map = {};
  for (const [id, spec] of Object.entries(VARIANTS)) {
    map[id] = {
      voicePitch: spec.voicePitch,
      speed: spec.speed,
      tell: tellOf(spec),
      step: stepOf(spec),
      hasSoundBlock: !!spec.sound,
    };
  }
  return { present, map, hasPlayLedger: !!(audio.stats().plays) };
});

const TREE = Object.values(inventory.map).some((m) => m.hasSoundBlock) ? 'AFTER' : 'BEFORE';
log(`tree: ${TREE}  (variants carrying a sound block: ` +
    `${Object.values(inventory.map).filter((m) => m.hasSoundBlock).length}/6)`);
log(`router: ${Object.entries(inventory.present).map(([k, v]) => `${k}=${v ? 'y' : 'n'}`).join(' ')}`);
log('');
log('per-variant sound routing as the game will call it:');
for (const [id, m] of Object.entries(inventory.map)) {
  log(`  ${id.padEnd(11)} tell=${m.tell.name.padEnd(11)} step=${m.step.name.padEnd(11)}` +
      ` pitch=${m.voicePitch}  ${m.tell.legacy ? '(legacy: one throat)' : ''}`);
}
log('');

// ---------------------------------------------------------------------------
// 1. distinctness
// ---------------------------------------------------------------------------

log('='.repeat(78));
log('1. DISTINCTNESS  - every enemy tell, rendered and measured side by side');
log('='.repeat(78));

const dist = await page.evaluate(async (draws) => {
  const { profile, VARIANTS, tellOf, cosine } = window.__EA__;
  const out = {};
  for (const [id, spec] of Object.entries(VARIANTS)) {
    const t = tellOf(spec);
    out[id] = await profile([{ name: t.name, opts: t.opts }], draws, 3.2);
    out[id].tell = t.name;
  }
  // Pairwise, in the log2 centroid x log2 duration plane, plus the spectral
  // shape similarity which is the measure a pitch change cannot move.
  const ids = Object.keys(out);
  const pairs = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = out[ids[i]], b = out[ids[j]];
      const dc = Math.abs(Math.log2(a.centroidHz / Math.max(b.centroidHz, 1)));
      const dd = Math.abs(Math.log2(Math.max(a.durationMs, 1) / Math.max(b.durationMs, 1)));
      pairs.push({
        a: ids[i], b: ids[j],
        dCentroidOct: +dc.toFixed(3),
        dDurationOct: +dd.toFixed(3),
        separation: +Math.hypot(dc, dd).toFixed(3),
        shapeSimilarity: +cosine(a.shape, b.shape).toFixed(3),
      });
    }
  }
  for (const id of ids) delete out[id].shape;
  return { table: out, pairs };
}, DRAWS);

log('');
log('  enemy        tell          centroid Hz      duration ms    attack   peak    rms dB  crest  onsets');
log('  ' + '-'.repeat(96));
for (const [id, r] of Object.entries(dist.table)) {
  log(`  ${id.padEnd(12)} ${r.tell.padEnd(13)} ` +
      `${String(r.centroidHz).padStart(6)} +/-${String(r.centroidSd).padStart(4)}  ` +
      `${String(r.durationMs).padStart(7)} +/-${String(r.durationSd).padStart(5)}  ` +
      `${String(r.attackMs).padStart(6)}  ${String(r.peak).padStart(6)}  ` +
      `${String(r.rmsDb).padStart(6)}  ${String(r.crestDb).padStart(5)}  ${String(r.onsets).padStart(4)}`);
}

log('');
log('  pairwise separation (octaves; shapeSim 1.0 = the same filter bank)');
log('  ' + '-'.repeat(78));
const sorted = [...dist.pairs].sort((a, b) => a.separation - b.separation);
for (const p of sorted) {
  const flag = p.separation < PAIR_MARGIN ? '  <-- TOO CLOSE' : '';
  log(`  ${p.a.padEnd(11)} vs ${p.b.padEnd(11)} sep=${String(p.separation).padStart(6)}` +
      ` (dCent=${String(p.dCentroidOct).padStart(6)} dDur=${String(p.dDurationOct).padStart(6)})` +
      ` shapeSim=${String(p.shapeSimilarity).padStart(6)}${flag}`);
}
log('');

const tooClose = dist.pairs.filter((p) => p.separation < PAIR_MARGIN);
check(`every enemy pair separated by >= ${PAIR_MARGIN} octaves`, tooClose.length === 0,
      tooClose.length ? `${tooClose.length} pair(s) too close: ` +
        tooClose.map((p) => `${p.a}/${p.b}=${p.separation}`).join(', ')
        : `worst pair ${sorted[0].a}/${sorted[0].b} = ${sorted[0].separation}`);

const humanoids = ['shambler', 'husk', 'bound', 'censer'];
const brightestHumanoid = Math.max(...humanoids.map((h) => dist.table[h].centroidHz));
const scarabC = dist.table.scarab.centroidHz;
const goldC = dist.table.goldscarab.centroidHz;
check(`scarab is >= ${SCARAB_CENTROID_RATIO}x the brightest humanoid`,
      scarabC >= brightestHumanoid * SCARAB_CENTROID_RATIO,
      `scarab ${scarabC} Hz vs brightest humanoid ${brightestHumanoid} Hz ` +
      `= ${(scarabC / brightestHumanoid).toFixed(2)}x`);
check(`gold scarab is >= ${SCARAB_CENTROID_RATIO}x the brightest humanoid`,
      goldC >= brightestHumanoid * SCARAB_CENTROID_RATIO,
      `goldscarab ${goldC} Hz vs ${brightestHumanoid} Hz = ${(goldC / brightestHumanoid).toFixed(2)}x`);
log('');

// ---------------------------------------------------------------------------
// 2. the scarab, before and after, in the same process
// ---------------------------------------------------------------------------

log('='.repeat(78));
log('2. THE SCARAB  - the old pitched-up moan is the control, rendered alongside');
log('='.repeat(78));

const scarab = await page.evaluate(async (draws) => {
  const { profile, VARIANTS, tellOf, stepOf, cosine } = window.__EA__;

  // The call mummy.js used to make for a scarab, verbatim: groan at the
  // scarab's own voicePitch, through the router, with nothing else set.
  const before = await profile([{ name: 'groan', opts: { pitch: VARIANTS.scarab.voicePitch } }],
                               draws, 3.2);
  // The shambler's groan, which is the throat both of them would be coming out
  // of if nothing had changed.
  const shambler = await profile([{ name: 'groan', opts: { pitch: 1.0 } }], draws, 3.2);

  const t = tellOf(VARIANTS.scarab);
  const s = stepOf(VARIANTS.scarab);
  const afterTell = await profile([{ name: t.name, opts: t.opts }], draws, 3.2);
  const afterStep = await profile([{ name: s.name, opts: s.opts }], draws, 1.2);

  return {
    before, shambler, afterTell, afterStep,
    tellName: t.name, stepName: s.name,
    beforeVsShambler: +cosine(before.shape, shambler.shape).toFixed(3),
    tellVsShambler: +cosine(afterTell.shape, shambler.shape).toFixed(3),
    stepVsShambler: +cosine(afterStep.shape, shambler.shape).toFixed(3),
  };
}, DRAWS);

const row = (label, r) =>
  log(`  ${label.padEnd(34)} centroid ${String(r.centroidHz).padStart(6)} Hz   ` +
      `duration ${String(r.durationMs).padStart(7)} ms   attack ${String(r.attackMs).padStart(6)} ms   ` +
      `onsets ${r.onsets}`);
log('');
row('BEFORE  groan @ pitch 2.0', scarab.before);
row(`AFTER   tell: ${scarab.tellName}`, scarab.afterTell);
row(`AFTER   step: ${scarab.stepName}`, scarab.afterStep);
row('(reference) shambler groan', scarab.shambler);
log('');
log('  spectral-shape similarity to the SHAMBLER GROAN, which is the throat in question');
log('  (1.000 = the same filter bank; pitch cannot move this number)');
log(`    BEFORE scarab (groan @2.0)      ${scarab.beforeVsShambler.toFixed(3)}`);
log(`    AFTER  scarab tell              ${scarab.tellVsShambler.toFixed(3)}`);
log(`    AFTER  scarab step              ${scarab.stepVsShambler.toFixed(3)}`);
log('');

check('the old scarab measurably WAS the shambler\'s throat (shapeSim > 0.6)',
      scarab.beforeVsShambler > 0.6,
      `before/shambler = ${scarab.beforeVsShambler}`);
check('the new scarab step has left the throat (shapeSim < 0.25)',
      scarab.stepVsShambler < 0.25,
      `step/shambler = ${scarab.stepVsShambler} (was ${scarab.beforeVsShambler})`);
check('the new scarab step is a tick, not a vowel (duration < 120 ms)',
      scarab.afterStep.durationMs < 120,
      `${scarab.afterStep.durationMs} ms vs the old ${scarab.before.durationMs} ms`);
check('the step has several legs in it (>= 2 onsets)',
      scarab.afterStep.onsets >= 2, `${scarab.afterStep.onsets} onsets`);
log('');

// ---------------------------------------------------------------------------
// 2b. the ceiling axis
// ---------------------------------------------------------------------------

log('  ---- above the player -------------------------------------------------');
log('  gold scarabs cross ceilings, so a step has to read as overhead. A panner');
log('  cannot say so; a pinna cue can. THE SAME SEED drives all three renders,');
log('  so the material is identical and the only difference is the elevation:');

const elev = await page.evaluate(async (draws) => {
  const { profile, VARIANTS, stepOf, seeded } = window.__EA__;
  const s = stepOf(VARIANTS.goldscarab);
  // Nine draws, but the SAME nine draws at every elevation: the seed is reset
  // per elevation, so run k at elevation 0 and run k at elevation 1 are the
  // same three legs hitting the same three frequencies.
  const at = (e) => seeded(0x5EA5AB,
    () => profile([{ name: s.name, opts: { ...s.opts, elev: e } }], draws, 1.2));
  return {
    name: s.name,
    level: await at(0),
    half: await at(0.5),
    overhead: await at(1),
  };
}, DRAWS);

log('');
log(`  elevation   centroid Hz    high band dB    air band dB`);
log('  ' + '-'.repeat(58));
for (const [k, r] of Object.entries({ 'level (0.0)': elev.level, 'half  (0.5)': elev.half,
                                      'overhead(1)': elev.overhead })) {
  const band = Object.fromEntries(r.meanBands);
  log(`  ${k.padEnd(12)}${String(r.centroidHz).padStart(8)}    ` +
      `${String(band.high).padStart(12)}   ${String(band.air).padStart(12)}`);
}
log('');
const elevRise = elev.overhead.centroidHz / Math.max(elev.level.centroidHz, 1);
check('a step from overhead measures brighter than the same step level with the ear',
      elevRise > 1.05,
      `overhead ${elev.overhead.centroidHz} Hz vs level ${elev.level.centroidHz} Hz ` +
      `= ${elevRise.toFixed(3)}x`);
check('the cue is monotonic in elevation (half sits between level and overhead)',
      elev.half.centroidHz >= elev.level.centroidHz &&
      elev.half.centroidHz <= elev.overhead.centroidHz,
      `${elev.level.centroidHz} -> ${elev.half.centroidHz} -> ${elev.overhead.centroidHz} Hz`);
log('');

// ---------------------------------------------------------------------------
// 3. does the tick rate track the actor's real speed
// ---------------------------------------------------------------------------

log('='.repeat(78));
log('3. STEP RATE  - an actor is actually moved, and two things are counted');
log('='.repeat(78));

await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1500);

const audioState = await page.evaluate(() => {
  const s = window.__SANDS__.audio.stats();
  return { state: s.state, cap: s.cap, fidelity: s.fidelity };
});
log(`  live AudioContext: state=${audioState.state} cap=${audioState.cap} fidelity=${audioState.fidelity}`);
check('the live context is actually running (a suspended one measures nothing)',
      audioState.state === 'running', `state=${audioState.state}`);
log('');

const rate = await page.evaluate(async (cfg) => {
  const g = window.__SANDS__;
  const audio = g.audio;

  /**
   * The Hall of Offerings, player pinned in its north half. Same room the
   * wall-crawl suite uses, for the same reason: it is big, flat and empty.
   *
   * TEN METRES, NOT FIFTEEN, AND THAT IS THE SECOND CORRECTION THIS SECTION
   * NEEDED. The scarab's step block thins its far ticks - past 11 m every other
   * one is dropped, past 17 m three in four - which is deliberate and is what
   * keeps a full horde inside the voice budget. It also means a run started at
   * 15 m measures the THINNING rather than the cadence, and it measures more of
   * it on the slow run than the fast one, because a slow body spends more of
   * its journey far away. That is exactly what the first pass of this file
   * reported: 1.30 steps per metre at full speed and 0.94 at a quarter, on a
   * cadence that is the same number in both cases.
   *
   * Started inside the near band the thinning never engages, so what is left is
   * the thing under test: metres covered against ticks emitted.
   */
  const PLAYER = { x: -45, z: -144 };
  const START = { x: -35, z: -144 };
  const dt = 1 / 60;

  function openEverything() {
    for (const d of g.doors.all) {
      if (d.open) d.open();
      for (let i = 0; i < 400 && !d.opened; i++) if (d.advance) d.advance(1 / 30);
    }
  }

  const ledger = () => {
    const p = audio.stats().plays || {};
    const sum = {};
    for (const [k, v] of Object.entries(p)) sum[k] = { tried: v.tried, played: v.played };
    return sum;
  };

  async function run(id, speedScale, seconds, stepName) {
    g.director.reset();
    g.spaces.enter('interior', { x: PLAYER.x, z: PLAYER.z, rot: 0 });
    openEverything();
    await new Promise((r) => requestAnimationFrame(r));
    g.director.state.timer = 1e9;
    g.player.position.x = PLAYER.x;
    g.player.position.z = PLAYER.z;

    const actor = g.director.placeAt(id, START.x, START.z);
    if (!actor) return { fatal: `could not place a ${id}` };
    // The one knob the director already turns per wave. Set from outside so the
    // SAME body on the SAME tile is measured at three speeds.
    actor.st.speedScale = speedScale;

    const before = ledger();
    let clock = 0, travelled = 0;
    let px = actor.position.x, pz = actor.position.z;
    const frames = Math.round(seconds / dt);
    let elapsed = 0, moving = 0;
    for (let i = 0; i < frames; i++) {
      clock += dt;
      g.player.position.x = PLAYER.x;
      g.player.position.z = PLAYER.z;
      g.director.update(dt, clock);
      if (!actor.live) break;
      const d = Math.hypot(actor.position.x - px, actor.position.y * 0,
                           actor.position.z - pz);
      travelled += d;
      /**
       * TIME SPENT ACTUALLY WALKING, and it has to be separated out.
       *
       * A scarab crosses the fifteen metres to a pinned player and then stops
       * to bite, so a run measured over wall-clock seconds averages a charge
       * together with a standstill, and the fast run and the half-speed run
       * both come out at the same metres per second. That is not a measurement
       * of the cadence, it is a measurement of how far away it started - and it
       * is what the first pass of this file reported.
       */
      if (d > 1e-4) moving += dt;
      px = actor.position.x; pz = actor.position.z;
      elapsed += dt;
      // Real time has to pass or the audio clock never advances and every voice
      // stays live. One yield every four simulated frames keeps the render loop
      // and the audio thread moving without making the run take forever.
      if (i % 4 === 0) await new Promise((r) => requestAnimationFrame(r));
    }
    const after = ledger();
    const delta = (n) => (after[n]?.played || 0) - (before[n]?.played || 0);
    const tried = (n) => (after[n]?.tried || 0) - (before[n]?.tried || 0);
    g.director.reset();
    return {
      id, speedScale,
      seconds: +elapsed.toFixed(2),
      movingS: +moving.toFixed(2),
      metres: +travelled.toFixed(2),
      measuredSpeed: +(travelled / Math.max(moving, 1e-6)).toFixed(3),
      steps: delta(stepName),
      stepsTried: tried(stepName),
      stepsPerMetre: +(delta(stepName) / Math.max(travelled, 1e-6)).toFixed(3),
      stepsPerSecond: +(delta(stepName) / Math.max(moving, 1e-6)).toFixed(3),
    };
  }

  const runs = [];
  for (const s of [1.0, 0.5, 0.25]) {
    runs.push(await run('scarab', s, 11, cfg.stepName));
  }
  return { runs, stepName: cfg.stepName, stride: cfg.stride };
}, { stepName: inventory.map.scarab.step.name, stride: inventory.map.scarab.step.stride });

log('');
log(`  counting successful "${rate.stepName}" plays against metres the body actually covered`);
log('  speedScale   walked s   metres   measured m/s   steps   steps/m   steps/s');
log('  ' + '-'.repeat(75));
for (const r of rate.runs) {
  if (r.fatal) { log(`  ${r.fatal}`); continue; }
  log(`  ${String(r.speedScale).padStart(9)}   ${String(r.movingS).padStart(8)}   ` +
      `${String(r.metres).padStart(6)}   ${String(r.measuredSpeed).padStart(12)}   ` +
      `${String(r.steps).padStart(5)}   ${String(r.stepsPerMetre).padStart(7)}   ` +
      `${String(r.stepsPerSecond).padStart(7)}`);
}
log('');

const good = rate.runs.filter((r) => !r.fatal && r.metres > 1 && r.steps > 0);
if (good.length >= 2) {
  const spm = good.map((r) => r.stepsPerMetre);
  const sps = good.map((r) => r.stepsPerSecond);
  const spread = Math.max(...spm) / Math.min(...spm);
  const speedRatio = Math.max(...good.map((r) => r.measuredSpeed)) /
                     Math.min(...good.map((r) => r.measuredSpeed));
  const rateRatio = Math.max(...sps) / Math.min(...sps);
  log(`  steps per metre spread across speeds: ${spread.toFixed(2)}x  ` +
      `(a distance-driven cadence holds this near 1.0)`);
  log(`  measured speed ratio ${speedRatio.toFixed(2)}x  vs  step rate ratio ${rateRatio.toFixed(2)}x`);
  log('');
  check('the tick rate is driven by real movement, not a fixed loop (steps/m within 1.25x)',
        spread <= 1.25, `spread ${spread.toFixed(2)}x`);
  check('a slower actor ticks proportionally slower (rate ratio within 25% of speed ratio)',
        Math.abs(rateRatio - speedRatio) / speedRatio < 0.25,
        `speed ${speedRatio.toFixed(2)}x, rate ${rateRatio.toFixed(2)}x`);

  /**
   * And the cadence is the number the spec declares, not merely a consistent
   * one. A stride that is honoured consistently but is not the authored value
   * is a second, quieter version of the same bug: the table stops being the
   * thing that decides how the game sounds.
   */
  if (rate.stride) {
    const want = 1 / rate.stride;
    const got = spm.reduce((p, q) => p + q, 0) / spm.length;
    log(`  declared stride ${rate.stride} m = ${want.toFixed(3)} steps/m; ` +
        `measured ${got.toFixed(3)} steps/m`);
    check('the measured cadence is the stride the spec declares (within 15%)',
          Math.abs(got - want) / want < 0.15,
          `${got.toFixed(3)} vs ${want.toFixed(3)} steps/m`);
  }
} else {
  check('the tick rate is driven by real movement', false,
        `only ${good.length} usable run(s) - see the table above`);
}
log('');

// ---------------------------------------------------------------------------
// 4. masking
// ---------------------------------------------------------------------------

log('='.repeat(78));
log('4. MASKING  - against the gunshot and against codecTick, which carries the text');
log('='.repeat(78));

const mask = await page.evaluate(async (cfg) => {
  const { render, An, createAudio, RATE } = window.__EA__;

  const bandsOf = (buf) => {
    const m = An.analyse(buf);
    return { bands: m.bands, peak: m.peak, rmsDb: m.rmsDb };
  };

  /**
   * ONE DRAW OF A RANDOMISED SOUND IS NOT ITS BAND LEVEL.
   *
   * The isolation table below was a single render per sound, and the scarab
   * step's mid-band figure moved THIRTEEN DECIBELS between two consecutive runs
   * of this file - once passing its check and once failing it - because a tap
   * drawn at 3.8 kHz with a Q of 6 leaks into the band being protected and one
   * drawn at 7 kHz with a Q of 13 does not. Both are the same sound; neither is
   * "the" measurement.
   *
   * The lift columns were already averaged for exactly this reason. This is that
   * fix applied to the check that was still rolling dice.
   */
  const meanBandsOf = async (fn, events, seconds, draws) => {
    const acc = {}; let peak = 0;
    for (let i = 0; i < draws; i++) {
      const r = bandsOf(await fn(events, seconds));
      for (const [n] of An.BANDS) acc[n] = (acc[n] || 0) + r.bands[n];
      peak += r.peak;
    }
    const bands = {};
    for (const [n] of An.BANDS) bands[n] = +(acc[n] / draws).toFixed(2);
    return { bands, peak: +(peak / draws).toFixed(5) };
  };

  /**
   * THE SAME CONTEST, AT THE LEVELS THE PLAYER ACTUALLY HEARS THEM AT.
   *
   * The dry comparison above is a worst case that cannot occur, and not by a
   * small margin: it puts six scarabs at zero metres, straight onto the bus,
   * against a codec that is close-miked by convention. Every scarab in the game
   * is on a PannerNode with the 'enemy' distance profile, and codecTick is not
   * on one at all - so in the mix the horde is ten to twenty decibels down on
   * what that render shows and the text is not.
   *
   * So the number that decides this runs the steps through the REAL positional
   * chain: attachPositional(), the real panner, the real distance model, the
   * real reverb send, at the real ring the load test spawns a horde on. Nothing
   * about the attenuation is written down here - it is whatever
   * PANNER_KINDS.enemy says it is, which is the point. A hardcoded "about ten
   * decibels" in a test is a second copy of a constant, and the copy is the one
   * that goes stale.
   *
   * The listener sits at the origin because that is where an AudioListener
   * starts and the game moves it every frame to the camera; the sources are
   * placed on a ring 8 to 16 m out, which is the band a horde arrives in.
   */
  const positioned = async (events, seconds) => {
    const oac = new OfflineAudioContext(2, Math.floor(RATE * seconds), RATE);
    const audio = createAudio({ context: oac, volume: 1 });
    await audio.resume();
    for (const e of events) {
      if (e.at) {
        // attachPositional reads matrixWorld.elements[12..14], so a bare object
        // with a matrix is a valid prop. Nothing here imports three.js, for the
        // same reason core/audio.js does not.
        const obj = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0,
                                                e.at[0], e.at[1], e.at[2], 1] } };
        audio.attachPositional(obj, 'enemy').play(e.name, e.opts || {});
      } else {
        audio.play(e.name, e.opts || {});
      }
    }
    return oac.startRendering();
  };

  const N = 5;
  const pistol = await meanBandsOf(render, [{ weapon: 'pistol' }], 1.6, N);
  const codecHer = await meanBandsOf(render, [{ name: 'codecTick', opts: { voice: 'her' } }], 0.6, N);
  const codecGate = await meanBandsOf(render, [{ name: 'codecTick', opts: { voice: 'gate' } }], 0.6, N);
  const step = await meanBandsOf(render, [{ name: cfg.stepName, opts: cfg.stepOpts }], 1.0, N);
  const tell = await meanBandsOf(render, [{ name: cfg.tellName, opts: cfg.tellOpts }], 2.4, N);

  /**
   * The test that actually matters: a line of codec text with a scarab patter
   * running under it, against the same line of text alone.
   *
   * Twelve ticks at the pacer's cadence, and eight scarab steps over the same
   * window at a realistic in-game level. What is measured is how much the
   * scarab lifts the level in the codec's own band. A sound that buries the
   * text raises it; a sound that sits out of the way does not.
   */
  const TICKS = 12;
  const textOnly = [];
  for (let i = 0; i < TICKS; i++) textOnly.push({ name: 'codecTick', opts: { voice: 'her' } });
  // Offline contexts do not advance currentTime between calls, so every one of
  // these lands on the same sample. That is the worst case for masking, not a
  // flaw. SIX steps rather than an arbitrary number, because six is the step
  // pool's whole budget: it is the largest number of scarab legs this game can
  // ever have sounding at one instant, no matter how many bodies are live.
  const withSteps = textOnly.concat(
    Array.from({ length: 6 }, () => ({ name: cfg.stepName, opts: { ...cfg.stepOpts } })));

  /**
   * FIVE DRAWS, AVERAGED, because one draw of this is not a measurement.
   *
   * Six steps rendered onto the same sample either line their noise offsets up
   * or they do not, and the difference between those two cases measured six
   * decibels between consecutive runs of this file. A gate that swings six
   * decibels on the dice is a gate that will eventually pass a regression and
   * fail a good build, which is worse than not having it.
   */
  const ring = [[8, 0, 2], [-9, 0, 5], [4, 0, -11], [-13, 0, -6], [15, 0, 4], [-6, 0, 16]];
  const posSteps = ring.map((at) => ({ name: cfg.stepName, opts: { ...cfg.stepOpts }, at }));
  const DRAWS_MASK = 5;

  const meanLift = async (fn, base, plus) => {
    const acc = {};
    for (let i = 0; i < DRAWS_MASK; i++) {
      const x = bandsOf(await fn(base, 1.2));
      const y = bandsOf(await fn(plus, 1.2));
      for (const [n] of An.BANDS) acc[n] = (acc[n] || 0) + (y.bands[n] - x.bands[n]);
    }
    const out = {};
    for (const [n] of An.BANDS) out[n] = +(acc[n] / DRAWS_MASK).toFixed(2);
    return out;
  };

  const a = bandsOf(await render(textOnly, 1.2));
  const b = bandsOf(await render(withSteps, 1.2));
  const lift = await meanLift(render, textOnly, withSteps);

  // And the same thing again with the horde where the horde actually is.
  const c = bandsOf(await positioned(textOnly, 1.2));
  const d = bandsOf(await positioned(textOnly.concat(posSteps), 1.2));
  const posLift = await meanLift(positioned, textOnly, textOnly.concat(posSteps));
  const stepAt10 = bandsOf(await positioned(
    [{ name: cfg.stepName, opts: { ...cfg.stepOpts }, at: [10, 0, 0] }], 1.0));

  return {
    pistol, codecHer, codecGate, step, tell, stepAt10, draws: DRAWS_MASK,
    textOnly: a, textPlusSteps: b, lift,
    posTextOnly: c, posTextPlusSteps: d, posLift,
  };
}, {
  stepName: inventory.map.scarab.step.name,
  stepOpts: inventory.map.scarab.step.opts,
  tellName: inventory.map.scarab.tell.name,
  tellOpts: inventory.map.scarab.tell.opts,
});

log('');
log('  band energy, dB, per sound in isolation');
log('  sound                sub      low   lowmid      mid     high      air     peak');
log('  ' + '-'.repeat(78));
for (const [name, r] of Object.entries({
  'pistol shot': mask.pistol,
  'codecTick her': mask.codecHer,
  'codecTick gate': mask.codecGate,
  [`scarab ${inventory.map.scarab.step.name}`]: mask.step,
  [`scarab ${inventory.map.scarab.tell.name}`]: mask.tell,
})) {
  log(`  ${name.padEnd(20)} ` +
      ['sub', 'low', 'lowmid', 'mid', 'high', 'air']
        .map((b) => String(r.bands[b]).padStart(7)).join('  ') +
      `  ${String(r.peak).padStart(7)}`);
}
log('');
log('  codec line alone vs the same line with the whole step pool piled onto it');
log('  (12 ticks and 6 steps, all on the same sample - the true worst case.');
log(`  the band columns are one draw; the lift column is the mean of ${mask.draws}):`);
log('  band      alone   with steps   lift dB');
log('  ' + '-'.repeat(44));
for (const b of ['sub', 'low', 'lowmid', 'mid', 'high', 'air']) {
  log(`  ${b.padEnd(8)} ${String(mask.textOnly.bands[b]).padStart(7)}  ` +
      `${String(mask.textPlusSteps.bands[b]).padStart(10)}  ${String(mask.lift[b]).padStart(8)}`);
}
log('');

log('  the same line with the same six steps, but on the game\'s own panners,');
log('  spread on the 8-16 m ring the director spawns a horde on:');
log('  band      alone   with steps   lift dB');
log('  ' + '-'.repeat(44));
for (const b of ['sub', 'low', 'lowmid', 'mid', 'high', 'air']) {
  log(`  ${b.padEnd(8)} ${String(mask.posTextOnly.bands[b]).padStart(7)}  ` +
      `${String(mask.posTextPlusSteps.bands[b]).padStart(10)}  ${String(mask.posLift[b]).padStart(8)}`);
}
log('');
log(`  one step, dry: peak ${mask.step.peak}   one step at 10 m on the enemy panner: ` +
    `peak ${mask.stepAt10.peak}  ` +
    `(${(20 * Math.log10(mask.stepAt10.peak / mask.step.peak)).toFixed(1)} dB of distance)`);
log('');

// codecTick 'her' lives at 336 Hz through a 2100 Hz bandpass; 'gate' at 168 Hz
// through 820. Both of them are the 'mid' band, 800-3000 Hz.
const codecMid = Math.max(mask.codecHer.bands.mid, mask.codecGate.bands.mid);
check('the scarab step sits below codecTick in the codec band (mid, 800-3000 Hz)',
      mask.step.bands.mid < codecMid,
      `step ${mask.step.bands.mid} dB vs codec ${codecMid} dB ` +
      `= ${(codecMid - mask.step.bands.mid).toFixed(2)} dB of headroom, dry`);
check('a full step pool on the real panners lifts the codec band by under 3 dB',
      mask.posLift.mid < 3,
      `lift ${mask.posLift.mid} dB (dry and at zero metres it would be ${mask.lift.mid} dB, ` +
      `which is the figure to quote if the horde ever gets inside the player)`);
check('the scarab step does not compete with the gunshot low end (60-200 Hz)',
      mask.step.bands.low < mask.pistol.bands.low,
      `step ${mask.step.bands.low} dB vs pistol ${mask.pistol.bands.low} dB`);
check('the scarab step does not compete with the gunshot crack either (mid)',
      mask.step.bands.mid < mask.pistol.bands.mid + 6,
      `step ${mask.step.bands.mid} dB vs pistol ${mask.pistol.bands.mid} dB`);
log('');

// ---------------------------------------------------------------------------
// 5. twenty-four actors
// ---------------------------------------------------------------------------

log('='.repeat(78));
log('5. VOICE COUNT  - the full live cap, worst case, sampled off the live set');
log('='.repeat(78));

const load = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const audio = g.audio;
  const PLAYER = { x: -45, z: -144 };
  const dt = 1 / 60;

  function openEverything() {
    for (const d of g.doors.all) {
      if (d.open) d.open();
      for (let i = 0; i < 400 && !d.opened; i++) if (d.advance) d.advance(1 / 30);
    }
  }

  async function run(id, seconds) {
    g.director.reset();
    g.spaces.enter('interior', { x: PLAYER.x, z: PLAYER.z, rot: 0 });
    openEverything();
    await new Promise((r) => requestAnimationFrame(r));
    g.director.state.timer = 1e9;
    g.player.position.x = PLAYER.x;
    g.player.position.z = PLAYER.z;

    /**
     * PINNED HIGH, AND THE FIRST PASS OF THIS FILE DID NOT DO THAT.
     *
     * The frame governor drops fidelity when it cannot hold rate, and headless
     * swiftshader cannot hold rate, so the shambler run measured a peak of 13
     * against a cap of 14 while the scarab run measured 14 against 28. Those two
     * numbers are not comparable and neither is the number the player's machine
     * would produce. It is re-pinned during the run because the governor is
     * free to change its mind at any point.
     */
    audio.setFidelity(true);

    // Fill the live cap. Placed in a ring around the player at a range where
    // every one of them is inside every distance gate in the game, which is the
    // worst case and not the average one. The ring is widened as it fills so a
    // variant with a big separation radius still reaches 24 bodies.
    let placed = 0;
    for (let i = 0; i < 120 && placed < 24; i++) {
      const th = (i / 11) * 2.399;
      const r = 7 + (i / 120) * 9;
      const a = g.director.placeAt(id, PLAYER.x + Math.cos(th) * r, PLAYER.z + Math.sin(th) * r);
      if (a) placed++;
    }

    const p0 = audio.stats().plays || {};
    const snap0 = {};
    for (const [k, v] of Object.entries(p0)) snap0[k] = { tried: v.tried, played: v.played };

    let clock = 0, maxVoices = 0, sumVoices = 0, samples = 0, maxSteps = 0;
    const frames = Math.round(seconds / dt);
    for (let i = 0; i < frames; i++) {
      clock += dt;
      g.player.position.x = PLAYER.x;
      g.player.position.z = PLAYER.z;
      g.director.update(dt, clock);
      const s = audio.stats();
      if (s.voices > maxVoices) maxVoices = s.voices;
      if ((s.stepVoices || 0) > maxSteps) maxSteps = s.stepVoices || 0;
      sumVoices += s.voices; samples++;
      if (i % 30 === 0) audio.setFidelity(true);
      if (i % 3 === 0) await new Promise((r) => requestAnimationFrame(r));
    }

    const p1 = audio.stats().plays || {};
    const byName = {};
    for (const [k, v] of Object.entries(p1)) {
      const t = v.tried - (snap0[k]?.tried || 0);
      const pl = v.played - (snap0[k]?.played || 0);
      if (t > 0) byName[k] = { tried: t, played: pl, droppedPct: +(100 * (t - pl) / t).toFixed(1) };
    }

    const liveNow = g.director.stats ? g.director.stats().live : placed;
    g.director.reset();
    return {
      id, placed, live: liveNow, seconds,
      maxVoices, meanVoices: +(sumVoices / Math.max(samples, 1)).toFixed(2),
      maxStepVoices: maxSteps,
      cap: audio.stats().cap,
      plays: byName,
    };
  }

  const scarabs = await run('scarab', 14);
  const shamblers = await run('shambler', 14);
  return { scarabs, shamblers };
});

for (const [label, r] of Object.entries({ 'all scarabs': load.scarabs, 'all shamblers': load.shamblers })) {
  log('');
  log(`  ${label}: placed ${r.placed}, ${r.seconds}s at 60Hz, ring 8-14 m around a pinned player`);
  log(`    peak simultaneous voices  ${r.maxVoices} / cap ${r.cap}`);
  log(`    mean simultaneous voices  ${r.meanVoices}`);
  log(`    peak step-pool voices     ${r.maxStepVoices}`);
  log(`    sounds requested:`);
  for (const [n, v] of Object.entries(r.plays)) {
    log(`      ${n.padEnd(13)} tried ${String(v.tried).padStart(5)}  played ${String(v.played).padStart(5)}` +
        `  dropped ${String(v.droppedPct).padStart(5)}%`);
  }
}
log('');

check('the horde never reaches the voice cap (scarabs)',
      load.scarabs.maxVoices < load.scarabs.cap,
      `peak ${load.scarabs.maxVoices} / cap ${load.scarabs.cap}`);
check('the horde never reaches the voice cap (shamblers, control)',
      load.shamblers.maxVoices < load.shamblers.cap,
      `peak ${load.shamblers.maxVoices} / cap ${load.shamblers.cap}`);

const stepDrop = Object.entries(load.scarabs.plays)
  .filter(([n]) => /step/i.test(n)).map(([, v]) => v.droppedPct);
if (stepDrop.length) {
  log(`  step drop rate under a full scarab horde: ${stepDrop[0]}%  ` +
      `(dropping a far tick is the design; dropping a near one is not)`);
}
log('');

// ---------------------------------------------------------------------------
// 6. getting shot
// ---------------------------------------------------------------------------

log('='.repeat(78));
log('6. HIT CONFIRMATION  - a round on a carapace is not a round on a body');
log('='.repeat(78));

/**
 * THE ROUTING CONTROL, AND IT IS THE ONE THAT CATCHES A FIX THAT RETUNED
 * EVERYTHING.
 *
 * Nothing here re-implements the decision in systems/damage.js. It places a real
 * actor, builds a real hit record, calls the real `combat.applyHits`, and reads
 * which sound name actually incremented in the audio module's play ledger - so
 * it measures the routing the game performs rather than a copy of the rule. The
 * humanoid rows are the control: if the chitin work had quietly pulled the
 * humanoids onto a new sound, `shambler body` would stop reporting bodyHit and
 * this table would say so.
 *
 * The gold scarab is the row that matters most. Its skull is region 'body' and
 * its abdomen vent is region 'head', so it is the only body in the game where
 * shooting the head must NOT produce the crit cue.
 */
const routing = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const audio = g.audio;
  const PLAYER = { x: -45, z: -144 };

  function openEverything() {
    for (const d of g.doors.all) {
      if (d.open) d.open();
      for (let i = 0; i < 400 && !d.opened; i++) if (d.advance) d.advance(1 / 30);
    }
  }

  const snap = () => {
    const p = audio.stats().plays || {};
    const o = {};
    for (const [k, v] of Object.entries(p)) o[k] = v.played;
    return o;
  };

  const HIT_NAMES = ['bodyHit', 'headshotHit', 'chitinHit', 'chitinCrit', 'shellCrack',
                     'deathRattle'];

  /**
   * THE WEAPON KEY IS `mk9`, AND THE FIRST RUN OF THIS SECTION USED 'pistol'.
   *
   * 'pistol' is the AUDIO PROFILE name - BASE_STATS.mk9.audio - not the weapon
   * id. applyHits looks the record up in STATS, missed, and `continue`d before
   * it ever reached the sound; every row came back "(none)" and all twelve
   * routing checks failed identically. That is exactly the failure this project
   * keeps shipping - a harness that measured nothing and reported it as a
   * finding - so the key is now asserted before anything is measured, and a
   * miss is one loud specific failure instead of twelve quiet ones.
   */
  const { STATS } = await import('/src/player/weapons.js');
  const WEAPON = 'mk9';
  if (!STATS[WEAPON]) {
    return { fatal: `STATS has no '${WEAPON}'. keys: ${Object.keys(STATS).join(', ')}` };
  }

  const rows = [];
  for (const id of ['shambler', 'husk', 'bound', 'censer', 'scarab', 'goldscarab']) {
    for (const region of ['body', 'head']) {
      g.director.reset();
      g.spaces.enter('interior', { x: PLAYER.x, z: PLAYER.z, rot: 0 });
      openEverything();
      await new Promise((r) => requestAnimationFrame(r));
      g.director.state.timer = 1e9;
      /**
       * PAST THE LETHAL HEADSHOT WINDOW, AND THEN GIVEN ARMOUR.
       *
       * Two separate things would otherwise turn a head row into a death row and
       * make this a measurement of the death cue: HEADSHOT_LETHAL_THROUGH is 6,
       * so inside the first six waves a head hit sets damage to the target's
       * whole remaining health whatever that health is; and even past it, the
       * mk9's 42 x 2.6 is 109, which is over the husk's 85 and the scarab's 45.
       *
       * Wave 7 closes the first and a large health pool closes the second, so
       * every row below is a body that took a round and lived. What a death
       * sounds like is measured on its own, underneath.
       */
      g.director.state.wave = 7;
      g.player.position.x = PLAYER.x;
      g.player.position.z = PLAYER.z;

      const actor = g.director.placeAt(id, PLAYER.x + 6, PLAYER.z);
      if (!actor) { rows.push({ id, region, fatal: 'could not place', fired: [] }); continue; }
      actor.maxHealth = 100000;
      actor.health = 100000;

      const before = snap();
      g.combat.applyHits([{ enemy: actor, weapon: WEAPON, region,
                            point: { x: actor.position.x, y: actor.position.y + 0.4,
                                     z: actor.position.z } }]);
      const after = snap();

      const fired = HIT_NAMES.filter((n) => (after[n] || 0) > (before[n] || 0));
      rows.push({ id, region, fired, killed: !actor.live || actor.dying });
      g.director.reset();
    }
  }

  /**
   * AND WHAT A KILL SOUNDS LIKE, measured separately.
   *
   * The claim being checked is that damage.js does NOT play shellCrack, because
   * enemies/mummy.js already fires it out of beginDeath() through the actor's
   * own emitter - so adding it here would be two carapaces coming apart in one
   * frame from two subsystems. The only way to tell "nobody plays it" from
   * "exactly one subsystem plays it" is to kill something and count.
   */
  g.director.reset();
  g.spaces.enter('interior', { x: PLAYER.x, z: PLAYER.z, rot: 0 });
  openEverything();
  await new Promise((r) => requestAnimationFrame(r));
  g.director.state.timer = 1e9;
  g.player.position.x = PLAYER.x;
  g.player.position.z = PLAYER.z;
  const doomed = g.director.placeAt('scarab', PLAYER.x + 6, PLAYER.z);
  let kill = null;
  if (doomed) {
    const before = snap();
    g.combat.applyHits([{ enemy: doomed, weapon: WEAPON, region: 'body',
                          point: { x: doomed.position.x, y: doomed.position.y + 0.4,
                                   z: doomed.position.z } }]);
    // 45 health against 42 a round: the second one is the kill.
    g.combat.applyHits([{ enemy: doomed, weapon: WEAPON, region: 'body',
                          point: { x: doomed.position.x, y: doomed.position.y + 0.4,
                                   z: doomed.position.z } }]);
    const after = snap();
    kill = {};
    for (const n of HIT_NAMES) kill[n] = (after[n] || 0) - (before[n] || 0);
    kill.died = !doomed.live || doomed.dying;
  }
  g.director.reset();

  return { rows, kill };
});

if (routing.fatal) {
  check('the routing probe could look its weapon up', false, routing.fatal);
}
const rows = routing.rows || [];

log('');
log('  enemy        region   sound the game actually played        survived');
log('  ' + '-'.repeat(68));
for (const r of rows) {
  log(`  ${r.id.padEnd(12)} ${r.region.padEnd(8)} ` +
      `${(r.fatal || r.fired.join(' + ') || '(none)').padEnd(30)} ${r.killed ? 'no' : 'yes'}`);
}
log('');

const routed = (id, region) => (rows.find((r) => r.id === id && r.region === region)?.fired) || [];
for (const h of ['shambler', 'husk', 'bound', 'censer']) {
  check(`CONTROL: ${h} body is still bodyHit, unchanged`,
        routed(h, 'body').includes('bodyHit') && !routed(h, 'body').some((n) => /chitin/.test(n)),
        routed(h, 'body').join(' + ') || 'nothing');
  check(`CONTROL: ${h} head is still headshotHit, unchanged`,
        routed(h, 'head').includes('headshotHit') && !routed(h, 'head').some((n) => /chitin/.test(n)),
        routed(h, 'head').join(' + ') || 'nothing');
}
check('a scarab body is chitinHit, not a flesh thud',
      routed('scarab', 'body').includes('chitinHit') && !routed('scarab', 'body').includes('bodyHit'),
      routed('scarab', 'body').join(' + ') || 'nothing');
check('a scarab crit (its skull) is chitinCrit, not headshotHit',
      routed('scarab', 'head').includes('chitinCrit') &&
      !routed('scarab', 'head').includes('headshotHit'),
      routed('scarab', 'head').join(' + ') || 'nothing');
check('a gold scarab body - which INCLUDES its skull - is chitinHit',
      routed('goldscarab', 'body').includes('chitinHit'),
      routed('goldscarab', 'body').join(' + ') || 'nothing');
check('a gold scarab crit - the abdomen vent - is chitinCrit',
      routed('goldscarab', 'head').includes('chitinCrit') &&
      !routed('goldscarab', 'head').includes('headshotHit'),
      routed('goldscarab', 'head').join(' + ') || 'nothing');
check('CONTROL: every routing row is a body that SURVIVED the round',
      rows.length > 0 && rows.every((r) => !r.killed && !r.fatal),
      `${rows.filter((r) => r.killed).length} row(s) died, which would make this a ` +
      `measurement of the death cue`);
check('a surviving hit never fires shellCrack',
      !rows.some((r) => (r.fired || []).includes('shellCrack')),
      'a hit that also cracked the shell would double with mummy.js beginDeath');

if (routing.kill) {
  const k = routing.kill;
  log('');
  log('  and a scarab actually killed (two rounds), counted by name:');
  log(`    chitinHit ${k.chitinHit}   shellCrack ${k.shellCrack}   ` +
      `deathRattle ${k.deathRattle}   bodyHit ${k.bodyHit}   died=${k.died}`);
  check('the kill really happened', k.died === true, `died=${k.died}`);
  check('shellCrack fires EXACTLY ONCE on a scarab death, from one subsystem',
        k.shellCrack === 1,
        `${k.shellCrack} - 0 means nothing plays the death, 2 means damage.js ` +
        `is doubling mummy.js beginDeath()`);
  check('a dying scarab never falls back to the humanoid death rattle',
        k.deathRattle === 0, `deathRattle ${k.deathRattle}`);
}
log('');

const hits = await page.evaluate(async (draws) => {
  const { profile, VARIANTS } = window.__EA__;
  const at = (name, opts) => profile([{ name, opts }], draws, 1.2);
  return {
    // The calls damage.js used to make, verbatim, still reachable through the
    // router: bodyHit and headshotHit at the scarab's own voicePitch.
    beforeBody: await at('bodyHit', { pitch: VARIANTS.scarab.voicePitch }),
    beforeCrit: await at('headshotHit', { pitch: VARIANTS.scarab.voicePitch }),
    afterBody: await at('chitinHit', { chitin: 'scarab' }),
    afterCrit: await at('chitinCrit', { chitin: 'scarab' }),
    goldBody: await at('chitinHit', { chitin: 'goldscarab' }),
    goldCrit: await at('chitinCrit', { chitin: 'goldscarab' }),
    // The humanoid pair, untouched code, rendered in the same run.
    humanBody: await at('bodyHit', { pitch: 1 }),
    humanCrit: await at('headshotHit', { pitch: 1 }),
  };
}, DRAWS);

const hrow = (label, r) =>
  log(`  ${label.padEnd(38)} centroid ${String(r.centroidHz).padStart(6)} Hz   ` +
      `duration ${String(r.durationMs).padStart(6)} ms   peak ${String(r.peak).padStart(7)}`);
log('  the scarab, shot, before and after:');
hrow('BEFORE body   bodyHit @ pitch 2.0', hits.beforeBody);
hrow('AFTER  body   chitinHit scarab', hits.afterBody);
hrow('BEFORE crit   headshotHit @ pitch 2.0', hits.beforeCrit);
hrow('AFTER  crit   chitinCrit scarab (skull)', hits.afterCrit);
log('');
log('  the gold scarab, whose crit is the vent and not the skull:');
hrow('AFTER  body   chitinHit goldscarab', hits.goldBody);
hrow('AFTER  crit   chitinCrit goldscarab (vent)', hits.goldCrit);
log('');
log('  the humanoids, whose synthesis this pass did not touch:');
hrow('bodyHit @ pitch 1.0', hits.humanBody);
hrow('headshotHit @ pitch 1.0', hits.humanCrit);
log('');

check('the scarab body hit stopped being a flesh thud (centroid at least 2x)',
      hits.afterBody.centroidHz >= hits.beforeBody.centroidHz * 2,
      `${hits.beforeBody.centroidHz} -> ${hits.afterBody.centroidHz} Hz ` +
      `= ${(hits.afterBody.centroidHz / hits.beforeBody.centroidHz).toFixed(2)}x`);
check('the scarab crit is audibly not a skull-and-meat crit',
      Math.abs(Math.log2(hits.afterCrit.centroidHz / hits.beforeCrit.centroidHz)) > 0.3,
      `${hits.beforeCrit.centroidHz} -> ${hits.afterCrit.centroidHz} Hz`);
check('a body hit and a crit are separable ON THE SAME BODY (scarab)',
      Math.abs(Math.log2(hits.afterCrit.centroidHz / hits.afterBody.centroidHz)) > 0.25,
      `body ${hits.afterBody.centroidHz} Hz vs crit ${hits.afterCrit.centroidHz} Hz`);
check('a body hit and a crit are separable ON THE SAME BODY (gold scarab)',
      Math.abs(Math.log2(hits.goldCrit.centroidHz / hits.goldBody.centroidHz)) > 0.25,
      `body ${hits.goldBody.centroidHz} Hz vs crit ${hits.goldCrit.centroidHz} Hz`);
check('the two shells do not sound like each other on a crit',
      Math.abs(Math.log2(hits.goldCrit.centroidHz / hits.afterCrit.centroidHz)) > 0.25,
      `scarab skull ${hits.afterCrit.centroidHz} Hz vs gold vent ${hits.goldCrit.centroidHz} Hz`);
log('');

const hitMask = await page.evaluate(async (draws) => {
  const { render, An } = window.__EA__;
  // Averaged, for the reason meanBandsOf explains in section 4: these are
  // randomised per call, and a single draw of one is not its band level.
  const b = async (name, opts, s) => {
    const acc = {}; let peak = 0;
    for (let i = 0; i < draws; i++) {
      const m = An.analyse(await render([{ name, opts }], s || 1.0));
      for (const [n] of An.BANDS) acc[n] = (acc[n] || 0) + m.bands[n];
      peak += m.peak;
    }
    const bands = {};
    for (const [n] of An.BANDS) bands[n] = +(acc[n] / draws).toFixed(2);
    return { bands, peak: +(peak / draws).toFixed(5) };
  };
  return {
    chitinHit: await b('chitinHit', { chitin: 'scarab' }),
    chitinCrit: await b('chitinCrit', { chitin: 'scarab' }),
    goldCrit: await b('chitinCrit', { chitin: 'goldscarab' }),
    headshotHit: await b('headshotHit', { pitch: 1 }),
    bodyHit: await b('bodyHit', { pitch: 1 }),
  };
}, 5);

log('  band energy, dB - the new hit cues against the ones already in the mix');
log('  sound                sub      low   lowmid      mid     high      air     peak');
log('  ' + '-'.repeat(78));
for (const [name, r] of Object.entries(hitMask)) {
  log(`  ${name.padEnd(20)} ` +
      ['sub', 'low', 'lowmid', 'mid', 'high', 'air']
        .map((k) => String(r.bands[k]).padStart(7)).join('  ') +
      `  ${String(r.peak).padStart(7)}`);
}
log('');

/**
 * The bar is the CUE ALREADY IN THE MIX, not silence.
 *
 * A hit cue has to be heard through the player's own gunshot - that is its whole
 * job - so it necessarily lives in bands the gun occupies, and headshotHit has
 * been doing exactly that since the game shipped. The honest question is not
 * "does the new sound touch the codec's band", it is "is it a worse citizen than
 * the crit cue this game already fires on every headshot". If it is not, the mix
 * is no worse than the one already approved.
 */
for (const [n, r] of Object.entries({ chitinHit: hitMask.chitinHit, chitinCrit: hitMask.chitinCrit,
                                      goldCrit: hitMask.goldCrit })) {
  check(`${n} is no worse than headshotHit in codecTick's band (mid)`,
        r.bands.mid <= hitMask.headshotHit.bands.mid + 1.0,
        `${r.bands.mid} dB vs headshotHit ${hitMask.headshotHit.bands.mid} dB`);
}
check('the new hit cues stay out of the gunshot low end (60-200 Hz)',
      Math.max(hitMask.chitinHit.bands.low, hitMask.chitinCrit.bands.low) < mask.pistol.bands.low,
      `worst ${Math.max(hitMask.chitinHit.bands.low, hitMask.chitinCrit.bands.low)} dB ` +
      `vs pistol ${mask.pistol.bands.low} dB`);
check('chitinHit carries no flesh sine - measurably less low end than bodyHit',
      hitMask.chitinHit.bands.low < hitMask.bodyHit.bands.low - 6,
      `chitinHit ${hitMask.chitinHit.bands.low} dB vs bodyHit ${hitMask.bodyHit.bands.low} dB`);
log('');

// ---------------------------------------------------------------------------

log('='.repeat(78));
if (errors.length) {
  log(`page errors (${errors.length}):`);
  for (const e of errors.slice(0, 8)) log(`  ${e}`);
}
check('no page errors', errors.length === 0, `${errors.length} error(s)`);
log('');
log(`${fail.length ? 'FAILED' : 'ALL PASS'}  ${fail.length} failure(s)` +
    (fail.length ? `: ${fail.join('; ')}` : ''));
log('='.repeat(78));

await browser.close();
process.exit(fail.length ? 1 : 0);
