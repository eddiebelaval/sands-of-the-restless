/**
 * THE PACER, verified by looking at it rather than by asserting it was called.
 *
 * This project has twelve confirmed instances of something that was written,
 * believed and never rendered - the twelfth being the `text-transform:
 * uppercase` on #notice, which made her entire lowercase attribution scheme
 * unrenderable at any string. It also has a documented history of FALSE
 * PASSES: renderer.info read after a reset returning zeros, update() called
 * directly instead of through real rAF frames producing twelve false failures,
 * a harness reporting success from a canvas that drew nothing, and a
 * :focus-visible rule silently cancelling an outline while every state
 * assertion passed.
 *
 * So nothing below is satisfied by a property having a value.
 *
 *   1. THE RATE is proved twice, because one measurement cannot carry it.
 *      The AUTHORED rate is the schedule, a pure function, checked exactly.
 *      The DELIVERED rate is sampled off the screen at three moments on real
 *      requestAnimationFrame frames and has to grow between them.
 *   2. THE RENDER is proved by cropping a FIXED band of a real screenshot and
 *      diffing it against the same band with the pill empty. Text that is set
 *      and never painted produces an identical band.
 *   3. THE CSS is proved by reading the COMPUTED text-transform and white-space
 *      on both voices and measuring the laid-out box against the viewport. A
 *      52-character lowercase line that runs off the screen fails here.
 *   4. THE CUT is proved by reading where the reveal stopped and showing it is
 *      the authored character, not a character near it.
 *   5. THE TICK is counted at the audio boundary - every codecTick that reached
 *      core/audio.js - against the characters revealed while it was counting,
 *      with whitespace counted separately.
 *   6. THE TWO SPEAKERS are rendered through the REAL graph in an
 *      OfflineAudioContext and measured: fundamental, spectral centroid, peak
 *      and length, with `groan()` rendered the same way for comparison.
 *
 * ---------------------------------------------------------------------------
 * A NOTE ON THE CLOCK, because it invalidated the first version of this file
 * ---------------------------------------------------------------------------
 *
 * Under swiftshader this game draws a frame every 800 to 1700 ms. Every wait in
 * here is therefore generous to the point of looking silly - a notice asked to
 * live six seconds was gone before three frames had passed, and the harness
 * read an empty pill and called the reveal broken. The product was fine. Any
 * duration below is a headroom number for a machine at one frame a second, not
 * a claim about how long anything should be on screen.
 *
 * Usage:  node test/pacer.mjs [url]
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** Her line 1, verbatim from docs/WORLD-1.md. 51 characters, all lowercase. */
const HER_LINE = 'i keep thinking you were further back. that walk in.';
/** An existing system notice, which must still render exactly as it always has. */
const SYS_LINE = 'THE KINDLING TAKES - THE PYRAMID WAKES';
/** Long enough that a screenshot under swiftshader cannot outlive it. */
const FOREVER = 600000;

const W = 960, H = 560;
/**
 * The band the pill lives in, in screen pixels, fixed.
 *
 * Fixed rather than measured per shot because the whole point of these crops is
 * to be DIFFED, and two crops of different sizes cannot be. #notice sits at
 * top: 62% of 560 = 347, so this band has it with room for the two lines a
 * wrapped line takes.
 */
const BAND = { x: 0, y: 316, width: W, height: 96 };

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

// 960x560 on purpose. It is the small window her 51-character line has to
// survive; at 1440 the old `white-space: nowrap` would have fitted and the
// defect this build exists to fix would not have shown up in a picture.
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1500);

// ---------------------------------------------------------------------------
// the probe
// ---------------------------------------------------------------------------

await page.evaluate(() => {
  const g = window.__SANDS__;

  // COUNT THE TICKS AT THE AUDIO BOUNDARY, not inside the pacer.
  //
  // Wrapping audio.play is the last point the two systems touch: everything
  // upstream is the pacer's belief about what it asked for and everything
  // downstream is WebAudio. A count taken here is a count of sounds the engine
  // was genuinely told to make, which is the claim being tested.
  const realPlay = g.audio.play.bind(g.audio);
  const ticks = [];
  g.audio.play = (name, opts) => {
    if (name === 'codecTick') ticks.push({ t: performance.now(), voice: opts && opts.voice });
    return realPlay(name, opts);
  };

  window.__P__ = {
    ticks,
    async frames(n) {
      for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
    },
    /**
     * What is ACTUALLY on screen.
     *
     * `#notice`.textContent is the wrong read and it is worth saying why: the
     * unrevealed half of a line in flight is a span hidden by VISIBILITY, so it
     * is still in the element's text content. A harness reading textContent
     * would report the whole line on the first frame and call a reveal that
     * never happened a pass.
     */
    said() {
      const s = document.querySelector('#notice .notice-said');
      return s ? s.textContent : (document.getElementById('notice').textContent || '');
    },
    css() {
      const el = document.getElementById('notice');
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        transform: cs.textTransform,
        wrap: cs.whiteSpace,
        align: cs.textAlign,
        color: cs.color,
        size: parseFloat(cs.fontSize),
        tracking: cs.letterSpacing,
        opacity: +cs.opacity,
        box: {
          x: Math.round(r.x), y: Math.round(r.y),
          w: Math.round(r.width), h: Math.round(r.height),
          right: Math.round(r.right), bottom: Math.round(r.bottom),
        },
      };
    },
  };
});

/** Capture the pill's band. Always the same rectangle, so crops are diffable. */
async function shootBand(name) {
  const buf = await page.screenshot({ clip: BAND, timeout: 120000 });
  writeFileSync(`${OUT}pacer-${name}.png`, buf);
  return buf;
}

/** Mean absolute luma difference between two equal-sized crops, 0 to 255. */
async function inkDiff(a, b) {
  const A = await sharp(a).greyscale().raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(b).greyscale().raw().toBuffer({ resolveWithObject: true });
  const n = Math.min(A.data.length, B.data.length);
  let sum = 0, lit = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(A.data[i] - B.data[i]);
    sum += d;
    if (d > 24) lit++;
  }
  return { mean: +(sum / n).toFixed(2), changedPct: +((lit / n) * 100).toFixed(2) };
}

// The control: the band with nothing in the pill. Everything else is diffed
// against this, so it is taken first and never retaken.
await page.evaluate(async () => {
  window.__SANDS__.pacer.clear();
  await window.__P__.frames(2);
});
const emptyBand = await shootBand('00-empty-control');

// ---------------------------------------------------------------------------
// 0. THE AUTHORED RATE, as arithmetic
// ---------------------------------------------------------------------------
//
// The delivered rate is measured off the screen below, and under swiftshader it
// is throttled by the frame clamp - which is a real property of the build and
// a useless way to check that 22 characters per second is what was authored.
// The schedule is a pure function; it is checked exactly, here.

const rate = await page.evaluate(async (line) => {
  const { schedule, CPS, HOLD_MS } = await import('/src/ui/pacer.js');
  const plain = 'abcdefghijklmnopqrst';           // 20 glyphs, no punctuation
  const spaced = 'a a a a a a a a a a';           // 10 glyphs, 9 spaces
  const stopped = 'a. a. a.';                     // full stops cost time

  return {
    cps: CPS,
    holds: HOLD_MS,
    plainMs: +schedule(plain, CPS.her).dur.toFixed(1),
    plainCps: +((plain.length / schedule(plain, CPS.her).dur) * 1000).toFixed(2),
    gatePlainCps: +((plain.length / schedule(plain, CPS.gate).dur) * 1000).toFixed(2),
    spacesCostLess: schedule(spaced, CPS.her).dur < schedule(plain, CPS.her).dur,
    stopsCostMore: +(schedule(stopped, CPS.her).dur
                     - schedule('aa aa aa', CPS.her).dur).toFixed(1),
    herLineMs: +schedule(line, CPS.her).dur.toFixed(1),
    herLineChars: line.length,

    /**
     * HER FIVE WORLD 1 LINES AGAINST THE BREATHER BUDGET, reported and NOT
     * gated.
     *
     * STORY-DELIVERY section 4 sizes every line against the quiet window the
     * director guarantees - 6.0 seconds on Normal, 4.5 on Hard - using
     * `chars / 22 * 1000 + 1200`. That model has no punctuation in it, and
     * punctuation is most of what makes typed text read as speech, so the real
     * schedule is longer than the table in the document. Line 4 is the one that
     * matters: the document has it clearing Hard by a tenth of a second, and
     * with three full stops in it, it does not.
     *
     * Reported rather than failed because the fix is a story call, not a bug
     * fix: it is one constant (the 320 ms a full stop buys, or the 1200 ms
     * hold), and which one gives way belongs to whoever owns her voice.
     */
    budget: [
      'i keep thinking you were further back. that walk in.',
      'how many of us came in. i keep getting it wrong.',
      'you sound-',
      "did anything happen to you. down there. anything you'd want to tell me.",
      "there's something i've been meaning to ask you since we-",
    ].map((l, i) => {
      const total = schedule(l, CPS.her).dur + HOLD_MS.her;
      return {
        line: i + 1,
        chars: l.length,
        totalS: +(total / 1000).toFixed(2),
        fitsNormal6: total <= 6000,
        fitsHard4p5: total <= 4500,
      };
    }),
  };
}, HER_LINE);

// ---------------------------------------------------------------------------
// 1. AN UPPERCASE SYSTEM NOTICE STILL LOOKS LIKE ONE
// ---------------------------------------------------------------------------
//
// Run first, and through the same showNotice path the ten existing call sites
// use, because the whole risk of this change is that fixing her voice broke
// theirs.

const sys = await page.evaluate(async (args) => {
  const g = window.__SANDS__;
  const before = window.__P__.ticks.length;
  const ok = g.pacer.notice(args.text, args.ms);
  const immediate = window.__P__.said();
  await window.__P__.frames(2);
  return {
    accepted: ok,
    immediate,
    said: window.__P__.said(),
    css: window.__P__.css(),
    ticksFired: window.__P__.ticks.length - before,
  };
}, { text: SYS_LINE, ms: FOREVER });
const sysBand = await shootBand('01-system-uppercase');
const sysInk = await inkDiff(sysBand, emptyBand);

// ---------------------------------------------------------------------------
// 2. HER LINE: LOWERCASE, REVEALED, MEASURED AT THREE TIMES
// ---------------------------------------------------------------------------

const reveal = await page.evaluate(async (args) => {
  const g = window.__SANDS__;
  g.pacer.clear();
  await window.__P__.frames(1);

  const tickBase = window.__P__.ticks.length;
  const t0 = performance.now();
  g.pacer.speak(args.text, { voice: 'her', hold: args.ms });

  const samples = [];
  const grab = () => samples.push({
    ms: +(performance.now() - t0).toFixed(0),
    n: window.__P__.said().length,
    ticks: window.__P__.ticks.length - tickBase,
  });

  grab();
  // Sample by FRAMES, not by clock: at one frame a second a wall-clock wait is
  // a wait for a picture that has not been drawn yet.
  const frameGaps = [];
  let prev = performance.now();
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    frameGaps.push(+(now - prev).toFixed(0));
    prev = now;
    if (i === 1 || i === 3 || i === 5) grab();
  }

  return {
    samples,
    frameGaps,
    said: window.__P__.said(),
    css: window.__P__.css(),
    stats: g.pacer.stats(),
  };
}, { text: HER_LINE, ms: FOREVER });
/**
 * A GENUINELY MID-REVEAL PICTURE, which needs the reveal held still.
 *
 * The first version of this shot was taken right after the samples above and
 * came back showing the whole line - correctly, because a screenshot under
 * swiftshader takes several seconds and the reveal is 2.8. It would have been
 * filed as evidence of something it did not show. So the reveal is FROZEN
 * first, and the text is read on both sides of the shutter to prove the picture
 * is of the state that was measured.
 */
const frozen = await page.evaluate(async (args) => {
  const g = window.__SANDS__;
  // A FRESH line, stopped after two frames. Freezing the one sampled above
  // would freeze a line that had already finished: six frames at 750 ms is
  // four and a half seconds and the line is 2.8.
  g.pacer.clear();
  await window.__P__.frames(1);
  g.pacer.speak(args.text, { voice: 'her', hold: args.ms });
  await window.__P__.frames(2);
  g.pacer.typer.freeze();
  await window.__P__.frames(1);
  return { said: window.__P__.said(), css: window.__P__.css() };
}, { text: HER_LINE, ms: FOREVER });
const midBand = await shootBand('02-her-midreveal');
const midInk = await inkDiff(midBand, emptyBand);
const afterShutter = await page.evaluate(() => window.__P__.said());

const settled = await page.evaluate(async (args) => {
  const g = window.__SANDS__;
  // A fresh line, run to the end: the one above was stopped for the picture.
  g.pacer.clear();
  await window.__P__.frames(1);
  g.pacer.speak(args.text, { voice: 'her', hold: args.ms });
  let f = 0;
  while (window.__P__.said().length < args.text.length && f < 90) {
    await new Promise((r) => requestAnimationFrame(r));
    f++;
  }
  await window.__P__.frames(1);
  return {
    framesToFinish: f,
    said: window.__P__.said(),
    css: window.__P__.css(),
    stats: g.pacer.stats(),
    // What the whole element holds, said plus unsaid. Equal to the line once
    // the reveal is complete, which is the check that the reserved box empties.
    dom: document.getElementById('notice').textContent,
    // How many lines it wrapped to, from the real layout rather than from a
    // guess about the font: two client rects means the text broke.
    rects: document.querySelector('#notice .notice-said')?.getClientRects().length ?? 0,
  };
}, { text: HER_LINE, ms: FOREVER });
const restBand = await shootBand('03-her-at-rest');
const herInk = await inkDiff(restBand, emptyBand);

// The whole frame, so the pill can be seen in the game rather than in a strip.
await page.screenshot({ path: `${OUT}pacer-04-her-in-frame.png`, timeout: 120000 });

/**
 * HER LONGEST LINE, which is the one the old `white-space: nowrap` could not
 * render at this window size at all.
 *
 * Line 4 of WHAT SHE IS ACTUALLY ASKING is 70 characters. STORY-DELIVERY
 * measures it at roughly 680 unbreakable pixels, which fits a 1280 window and
 * runs off both edges of a 720 one. It has to WRAP now, and it has to stay
 * inside the viewport while it does.
 */
const LONG_LINE = "did anything happen to you. down there. anything you'd want to tell me.";
const longest = await page.evaluate(async (args) => {
  const g = window.__SANDS__;
  g.pacer.clear();
  await window.__P__.frames(1);
  g.pacer.speak(args.text, { voice: 'her', hold: args.ms });
  let f = 0;
  while (window.__P__.said().length < args.text.length && f < 90) {
    await new Promise((r) => requestAnimationFrame(r)); f++;
  }
  await window.__P__.frames(1);
  return {
    chars: args.text.length,
    said: window.__P__.said(),
    css: window.__P__.css(),
    rects: document.querySelector('#notice .notice-said')?.getClientRects().length ?? 0,
  };
}, { text: LONG_LINE, ms: FOREVER });
await shootBand('09-her-longest-line');

// ---------------------------------------------------------------------------
// 3. THE TICK: ONE PER CHARACTER, SILENT ON SPACES
// ---------------------------------------------------------------------------
//
// Measured over a line with a known composition rather than over hers, so the
// arithmetic is unambiguous: the expected count is the non-whitespace
// characters and nothing else.

const TICK_LINE = 'a b c d e f';   // 6 glyphs, 5 spaces
const tickTest = await page.evaluate(async (args) => {
  const g = window.__SANDS__;
  g.pacer.clear();
  await window.__P__.frames(1);

  const base = window.__P__.ticks.length;
  g.pacer.speak(args.text, { voice: 'her', hold: args.ms });

  let f = 0;
  while (window.__P__.said().length < args.text.length && f < 60) {
    await new Promise((r) => requestAnimationFrame(r));
    f++;
  }
  await window.__P__.frames(1);

  const fired = window.__P__.ticks.slice(base);
  return {
    line: args.text,
    chars: args.text.length,
    glyphs: args.text.replace(/\s/g, '').length,
    spaces: args.text.length - args.text.replace(/\s/g, '').length,
    ticks: fired.length,
    voices: [...new Set(fired.map((t) => t.voice))],
    said: window.__P__.said(),
    // Ticks arrive in bursts here for the same reason the reveal is throttled:
    // several characters cross their reveal time inside one 1.5 second frame.
    // On hardware drawing 60 frames a second this is one tick per character in
    // real time; the COUNT is the claim being tested and it is exact either way.
    gaps: fired.slice(1).map((t, i) => +(t.t - fired[i].t).toFixed(0)),
  };
}, { text: TICK_LINE, ms: FOREVER });

// ---------------------------------------------------------------------------
// 4. THE AUTHORED CUT
// ---------------------------------------------------------------------------

const cut = await page.evaluate(async (ms) => {
  const g = window.__SANDS__;
  const { THE_INTERRUPTED_LINE, schedule, CPS } = await import('/src/ui/pacer.js');

  // What the schedule says the cut should land at, derived here rather than
  // written down as a constant: a gate holding a magic 2336 would have to be
  // hand-edited every time a word of her line changes, and a gate nobody can
  // edit correctly is a gate that gets deleted.
  const idx = THE_INTERRUPTED_LINE.text.indexOf(THE_INTERRUPTED_LINE.cutAt)
            + THE_INTERRUPTED_LINE.cutAt.length;
  const expectCutMs = schedule(THE_INTERRUPTED_LINE.text, CPS.her).at[idx - 1];
  g.pacer.clear();
  await window.__P__.frames(1);

  let kindlingAt = -1;
  const t0 = performance.now();
  g.pacer.speak(THE_INTERRUPTED_LINE.text, {
    ...THE_INTERRUPTED_LINE,
    hold: ms,
    onCut: () => { kindlingAt = performance.now() - t0; },
  });
  const cutAtMs = g.pacer.stats().cutAtMs;

  // Wait for the pacer's own phase rather than for the text to stop moving: a
  // line that stops growing is what a cut LOOKS like, and this asks the thing
  // itself. The text is then read and compared against the authored index.
  let f = 0;
  while (g.pacer.stats().phase !== 'done' && f < 90) {
    await new Promise((r) => requestAnimationFrame(r));
    f++;
  }

  return {
    full: THE_INTERRUPTED_LINE.text,
    cutAt: THE_INTERRUPTED_LINE.cutAt,
    cutAtMs: +cutAtMs.toFixed(0),
    expectCutMs: +expectCutMs.toFixed(0),
    saidAtStop: window.__P__.said(),
    domTotal: document.getElementById('notice').textContent,
    kindlingAtMs: +kindlingAt.toFixed(0),
    framesToCut: f,
    cutMissing: g.pacer.stats().cutMissing,
  };
}, FOREVER);
const cutBand = await shootBand('05-her-cut');

/**
 * THE SAME MECHANISM, CUTTING MID-STRING.
 *
 * Her authored line already ENDS on the dash she is taken away on - "since
 * we-" is the last thing in the string - so cutting after it stops the reveal
 * at the same character the line would have ended on anyway, and the check
 * above cannot tell a working cut from no cut at all. This one can: the same
 * line, cut in the middle, has to stop there and leave the rest unsaid.
 */
const cutMid = await page.evaluate(async (ms) => {
  const g = window.__SANDS__;
  const { THE_INTERRUPTED_LINE } = await import('/src/ui/pacer.js');
  g.pacer.clear();
  await window.__P__.frames(1);

  g.pacer.speak(THE_INTERRUPTED_LINE.text, {
    voice: 'her', cutAt: 'been meaning', cutHold: 250, hold: ms,
  });
  let f = 0;
  while (g.pacer.stats().phase !== 'done' && f < 90) {
    await new Promise((r) => requestAnimationFrame(r)); f++;
  }
  return {
    said: window.__P__.said(),
    domTotal: document.getElementById('notice').textContent,
    full: THE_INTERRUPTED_LINE.text,
  };
}, FOREVER);

// The Kindling landing on top of her, which is what the player sees next.
const clobber = await page.evaluate(async (args) => {
  const g = window.__SANDS__;
  const forced = g.pacer.notice(args.text, args.ms, { force: true });
  await window.__P__.frames(1);
  return { forced, said: window.__P__.said(), css: window.__P__.css() };
}, { text: SYS_LINE, ms: FOREVER });
const clobberBand = await shootBand('06-kindling-over-her');

// ---------------------------------------------------------------------------
// 5. THE HOLD
// ---------------------------------------------------------------------------

const hold = await page.evaluate(async (args) => {
  const g = window.__SANDS__;
  g.pacer.clear();
  await window.__P__.frames(1);
  g.pacer.speak(args.text, { voice: 'her', hold: args.ms });
  await window.__P__.frames(2);

  const during = g.pacer.notice('NEED 400 MORE GOLD', args.ms);
  const afterAttempt = window.__P__.said();
  const dropped = g.pacer.stats().dropped;

  const forced = g.pacer.notice('FORCED', args.ms, { force: true });
  const afterForce = window.__P__.said();

  return { during, afterAttempt, dropped, forced, afterForce };
}, { text: HER_LINE, ms: FOREVER });

// ---------------------------------------------------------------------------
// 5b. THE TEARDOWN RUNS ON THE REVEAL'S CLOCK, NOT ON THE WALL'S
// ---------------------------------------------------------------------------
//
// THE REGRESSION THIS FILE EXISTS FOR MOST. The hold used to be a setTimeout
// armed for `reveal + hold` at the moment the line started, and the reveal is
// a per-frame clock with a ceiling on how far one frame may advance it. Above
// about four frames a second the two agree. Below it they diverge one way, and
// the jar lane measured the consequence under swiftshader: a 2.34 second reveal
// took ten seconds of wall time, the teardown fired at 3.8, the line was wiped
// mid-sentence, the cut was never reached and the interruption never fired -
// with every state check in that lane still green.
//
// So this speaks a line with the DEFAULT hold, on a machine drawing roughly one
// frame a second, and requires the whole line to arrive before the pill goes
// down. This is the one check here that would have failed before the fix.

const teardown = await page.evaluate(async (text) => {
  const g = window.__SANDS__;
  g.pacer.clear();
  await window.__P__.frames(1);

  const t0 = performance.now();
  g.pacer.speak(text, { voice: 'her' });   // no hold override: shipping values

  let wipedAt = -1, longest = 0, f = 0;
  for (; f < 90; f++) {
    await new Promise((r) => requestAnimationFrame(r));
    const n = window.__P__.said().length;
    longest = Math.max(longest, n);
    // The pill going down, or the text going backwards, is the failure. Either
    // means something took the line away while it was still arriving.
    if (longest > 0 && n < longest && wipedAt < 0) wipedAt = f;
    if (!g.pacer.stats().on && longest < text.length && wipedAt < 0) wipedAt = f;
    if (n >= text.length) break;
  }

  const reachedAt = +(performance.now() - t0).toFixed(0);
  const wholeLine = window.__P__.said();

  // And then it does come down on its own, rather than standing forever.
  let g2 = 0;
  while (g.pacer.stats().on && g2 < 40) {
    await new Promise((r) => requestAnimationFrame(r)); g2++;
  }

  return {
    framesToWholeLine: f,
    wallMsToWholeLine: reachedAt,
    longest,
    wholeLine,
    wipedAt,
    framesToFade: g2,
    stillOn: g.pacer.stats().on,
  };
}, HER_LINE);

// ---------------------------------------------------------------------------
// 5c. THE SAME INVARIANT AT ONE FRAME A SECOND, DRIVEN DETERMINISTICALLY
// ---------------------------------------------------------------------------
//
// 5b measures the real thing on whatever frame rate this machine happens to
// produce, and this machine is not always slow enough to reproduce the failure
// - it ran the line above at 630 ms frames. So the invariant is also driven
// directly: a typewriter in MANUAL mode, advanced in one-second steps, which is
// the clock the jar lane was on when the beat disappeared.
//
// This is a unit check on an element nobody can see, and it is deliberately
// paired with the rendered one above rather than replacing it. What it can say
// that a rendered test cannot is that the ORDER holds at any frame rate: the
// reveal completes, then the cut fires, then the hold ends. Never overlapping.

const slow = await page.evaluate(async () => {
  const { createTypewriter, THE_INTERRUPTED_LINE } = await import('/src/ui/pacer.js');

  function run(text, opts, dtMs, steps) {
    const el = document.createElement('div');
    const t = createTypewriter({ el, doc: document, voice: 'her', manual: true });
    const log = [];
    let endedAt = -1, cutAtStep = -1;
    t.play(text, {
      ...opts,
      onCut: () => { cutAtStep = log.length; },
      onEnd: () => { endedAt = log.length; },
    });
    for (let i = 0; i < steps; i++) {
      t.advance(dtMs / 1000);
      log.push({ step: i, n: t.text.length, phase: t.phase });
      if (endedAt >= 0) break;
    }
    return {
      shownAtEnd: t.text,
      full: text,
      // The step the whole reveal was on screen, and the step the hold ended.
      completeAt: log.findIndex((r) => r.n >= (opts.cutAt
        ? text.indexOf(opts.cutAt) + opts.cutAt.length : text.length)),
      cutAtStep,
      endedAt,
      steps: log.length,
      backwards: log.some((r, i) => i > 0 && r.n < log[i - 1].n),
    };
  }

  return {
    // Her line at one frame a second, with the shipping hold.
    plain: run('i keep thinking you were further back. that walk in.',
      { hold: 1200 }, 1000, 40),
    // The interrupted line, at the same rate: this is the jar lane's case.
    cut: run(THE_INTERRUPTED_LINE.text,
      { cutAt: THE_INTERRUPTED_LINE.cutAt, cutHold: 250, hold: 1200 }, 1000, 40),
    // And at a tenth of a frame a second, which nothing should survive but
    // which must still arrive in the right order.
    crawl: run(THE_INTERRUPTED_LINE.text,
      { cutAt: THE_INTERRUPTED_LINE.cutAt, cutHold: 250, hold: 1200 }, 10000, 60),
  };
});

// ---------------------------------------------------------------------------
// 6. THE TWO SPEAKERS, RENDERED AND MEASURED
// ---------------------------------------------------------------------------
//
// Through the REAL createAudio graph in an OfflineAudioContext, which is the
// path test/gunlab.html already established for exactly this reason: a node
// that was built and never connected produces silence that looks like working
// code, and the only way to know a layer is audible is to render it and look at
// the samples.

const codec = await page.evaluate(async () => {
  const { createAudio } = await import('/src/core/audio.js');
  const RATE = 48000;

  /** Goertzel magnitude at one frequency. Cheaper than an FFT for a few bins. */
  const mag = (x, hz, rate) => {
    const w = 2 * Math.PI * hz / rate;
    const c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < x.length; i++) { const s = x[i] + c * s1 - s2; s2 = s1; s1 = s; }
    return Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - c * s1 * s2));
  };

  /**
   * The oscillator's own frequency, by AUTOCORRELATION rather than by looking
   * for the loudest low partial.
   *
   * The first version of this measurement did the latter and was wrong in a way
   * worth recording: a 168 Hz square through an 820 Hz bandpass has almost
   * nothing left at 168, so the strongest partial under 700 Hz is the third
   * harmonic and the measurement reported the gatekeeper at 506 Hz. The ear
   * does not make that mistake - it hears the harmonic SPACING - and neither
   * does a correlation, which finds the period of the wave rather than the
   * energy in a bin.
   *
   * This is the number the separation claim is actually about: `groan()` runs
   * rand(62, 104), so what has to be shown is where each speaker's fundamental
   * sits against that ceiling.
   */
  const fundamental = (x, lo, hi) => {
    const minLag = Math.floor(RATE / hi);
    const maxLag = Math.ceil(RATE / lo);
    let best = -Infinity, bestLag = minLag;
    for (let lag = minLag; lag <= maxLag && lag < x.length; lag++) {
      // AT LEAST FIVE PERIODS OF OVERLAP, or the measurement invents an octave.
      // A 32 ms tick is about ten cycles at 336 Hz, and a lag of 450 samples
      // leaves two cycles to correlate - over which almost anything correlates
      // well, which is how the first run of this reported her fundamental as
      // 106 Hz and put her inside the mummy's register. At three periods it
      // still halved on one render in four; five holds it.
      if (x.length - lag < lag * 5) continue;
      let num = 0, d1 = 0, d2 = 0;
      for (let i = 0; i + lag < x.length; i++) {
        num += x[i] * x[i + lag];
        d1 += x[i] * x[i];
        d2 += x[i + lag] * x[i + lag];
      }
      const r = num / Math.sqrt(Math.max(d1 * d2, 1e-12));
      if (r > best) { best = r; bestLag = lag; }
    }
    // No lag had enough material. Reported as zero rather than as the edge of
    // the search range, so a window too short to measure fails a check instead
    // of returning a plausible number.
    if (best === -Infinity) return 0;
    return Math.round(RATE / bestLag);
  };

  const centroid = (x) => {
    let num = 0, den = 0;
    for (let k = 0; k < 48; k++) {
      const hz = 100 * Math.pow(80, k / 47);
      const m = mag(x, hz, RATE);
      num += hz * m; den += m;
    }
    return Math.round(num / Math.max(den, 1e-12));
  };

  async function renderTick(voice) {
    const oac = new OfflineAudioContext(1, Math.floor(RATE * 0.4), RATE);
    const audio = createAudio({ context: oac, volume: 1 });
    await audio.resume();
    const fired = audio.play('codecTick', { voice });
    const buf = await oac.startRendering();
    const x = buf.getChannelData(0);

    let peak = 0, peakAt = 0;
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > peak) { peak = a; peakAt = i; }
    }
    // The audible body: everything above -40 dB of peak. This is the number
    // that decides percussive versus a tone with a tail.
    const floor = peak * 0.01;
    let first = peakAt, last = peakAt;
    for (let i = peakAt; i < x.length; i++) if (Math.abs(x[i]) > floor) last = i;
    for (let i = peakAt; i >= 0; i--) if (Math.abs(x[i]) > floor) first = i;
    const win = x.slice(first, Math.min(last + 1, x.length));

    return {
      fired,
      peak: +peak.toFixed(5),
      lenMs: +(((last - first) / RATE) * 1000).toFixed(1),
      f0: fundamental(win, 60, 700),
      centroidHz: centroid(win),
    };
  }

  const out = {};
  for (const v of ['her', 'gate']) {
    // Four renders each: the jitter is deliberate, and one sample would report
    // it as the number rather than as a spread.
    const runs = [];
    for (let i = 0; i < 4; i++) runs.push(await renderTick(v));
    const mean = (k, dp = 1) =>
      +(runs.reduce((s, r) => s + r[k], 0) / runs.length).toFixed(dp);
    out[v] = {
      f0: Math.round(mean('f0')),
      f0Range: [Math.min(...runs.map((r) => r.f0)), Math.max(...runs.map((r) => r.f0))],
      centroidHz: Math.round(mean('centroidHz')),
      lenMs: mean('lenMs'),
      peak: mean('peak', 5),
      fired: runs.every((r) => r.fired),
    };
  }

  // The horde, on the same graph with the same measurement, because "separated
  // from the mummy" is a comparison and a comparison needs both sides measured
  // the same way.
  const runs = [];
  for (let i = 0; i < 6; i++) {
    const oac = new OfflineAudioContext(1, Math.floor(RATE * 2.5), RATE);
    const audio = createAudio({ context: oac, volume: 1 });
    await audio.resume();
    audio.play('groan');
    const buf = await oac.startRendering();
    const x = buf.getChannelData(0);
    let peak = 0, peakAt = 0;
    for (let i2 = 0; i2 < x.length; i2++) {
      const a = Math.abs(x[i2]);
      if (a > peak) { peak = a; peakAt = i2; }
    }
    // A window at the peak rather than the whole groan: the patch glides its
    // pitch across the sound on purpose, so a correlation over the full 1.5
    // seconds is a correlation over several different pitches. The search is
    // capped at 200 Hz for the same reason the tick's overlap rule exists -
    // hand a correlation a range it cannot resolve and it will answer anyway.
    const win = x.slice(peakAt, Math.min(peakAt + Math.floor(RATE * 0.25), x.length));
    runs.push({ peak: +peak.toFixed(5), f0: fundamental(win, 40, 200), centroidHz: centroid(win) });
  }
  // The MEDIAN, not the mean. A glide plus two detuned oscillators makes any
  // single reading of this patch noisy, and one octave-down outlier drags a
  // mean of six far enough to change the answer.
  const f0s = runs.map((r) => r.f0).sort((a, b) => a - b);
  out.groan = {
    f0: f0s[Math.floor(f0s.length / 2)],
    f0All: f0s,
    f0Range: [Math.min(...runs.map((r) => r.f0)), Math.max(...runs.map((r) => r.f0))],
    centroidHz: Math.round(runs.reduce((s, r) => s + r.centroidHz, 0) / runs.length),
    peak: +(runs.reduce((s, r) => s + r.peak, 0) / runs.length).toFixed(5),
  };
  return out;
});

// ---------------------------------------------------------------------------
// 7. THE GATEKEEPER'S TWO WORDS, ON THE DEATH CARD
// ---------------------------------------------------------------------------

const card = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.pacer.clear();

  const base = window.__P__.ticks.length;

  // THROUGH THE REAL DAMAGE PATH, which is what test/deathrespawn.mjs does and
  // for a reason this harness rediscovered the hard way: assigning health = 0
  // from outside never calls `fell()`, so on a machine slow enough for
  // regeneration to run first the player simply heals and no death happens.
  // That produced a card that never came up and a suite that blamed the card.
  g.combat.state.invulnerable = false;
  g.player.state.health = 9;
  g.combat.damagePlayer(60, g.player.position.x, g.player.position.z);

  // The card is paced in SIMULATION seconds and the answer types at six
  // characters a second, so this is a wait for frames of the sequence rather
  // than for a clock. The intermediate reads are the evidence it TYPED: a value
  // that appears whole in one frame is a value that was assigned.
  const seen = [];
  let f = 0;
  for (; f < 120; f++) {
    await new Promise((r) => requestAnimationFrame(r));
    const s = g.death.answer;
    if (!seen.length || seen[seen.length - 1] !== s) seen.push(s);
    if (s && s === g.death.stats().answerFull) break;
  }

  const st = g.death.stats();
  const el = document.querySelector('.death-answer');
  const cs = el ? getComputedStyle(el) : null;
  const r = el ? el.getBoundingClientRect() : null;

  return {
    verdict: g.death.verdict,
    answer: g.death.answer,
    answerFull: st.answerFull,
    steps: seen.filter(Boolean),
    epitaph: st.epitaph,
    frames: f,
    gateTicks: window.__P__.ticks.slice(base).filter((t) => t.voice === 'gate').length,
    herTicks: window.__P__.ticks.slice(base).filter((t) => t.voice === 'her').length,
    css: cs ? {
      color: cs.color, transform: cs.textTransform,
      size: parseFloat(cs.fontSize), tracking: cs.letterSpacing,
    } : null,
    box: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
    shown: st.shown,
  };
});
await page.screenshot({ path: `${OUT}pacer-07-death-answer.png`, timeout: 120000 });

// The second death: the answer rotates and the erasure count moves.
const card2 = await page.evaluate(async () => {
  const g = window.__SANDS__;
  document.getElementById('death-confirm').click();
  let f = 0;
  while (g.death.phase !== 'none' && f < 40) {
    await new Promise((r) => requestAnimationFrame(r)); f++;
  }
  const resetsAfterFirst = g.death.stats().resets;

  g.combat.state.invulnerable = false;
  g.player.state.health = 9;
  g.combat.damagePlayer(60, g.player.position.x, g.player.position.z);
  for (f = 0; f < 120; f++) {
    await new Promise((r) => requestAnimationFrame(r));
    const s = g.death.answer;
    if (s && s === g.death.stats().answerFull) break;
  }
  const st = g.death.stats();
  return { resetsAfterFirst, answer: g.death.answer, epitaph: st.epitaph, resets: st.resets };
});
await page.screenshot({ path: `${OUT}pacer-08-death-second.png`, timeout: 120000 });

await browser.close();

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const say = (k, v) => console.log(`  ${String(k).padEnd(20)} ${JSON.stringify(v)}`);

console.log('--- 0. the authored rate (pure schedule, no rendering) ---');
for (const [k, v] of Object.entries(rate)) {
  if (k === 'budget') continue;
  say(k, v);
}
console.log('  her five World 1 lines against the breather (REPORTED, not gated):');
for (const b of rate.budget) {
  console.log(`    line ${b.line}  ${String(b.chars).padStart(2)} chars  `
    + `${b.totalS.toFixed(2)}s  normal ${b.fitsNormal6 ? 'fits' : 'OVER'}`
    + `  hard ${b.fitsHard4p5 ? 'fits' : 'OVER'}`);
}

console.log('--- 1. system notice, uppercase, unchanged ---');
for (const [k, v] of Object.entries({
  accepted: sys.accepted, immediate: sys.immediate, said: sys.said,
  textTransform: sys.css.transform, whiteSpace: sys.css.wrap,
  box: sys.css.box, ticksFired: sys.ticksFired, inkVsEmpty: sysInk,
})) say(k, v);

console.log('--- 2. her line, lowercase, revealed ---');
say('samples', reveal.samples);
say('frameGaps', reveal.frameGaps);
say('textTransform', reveal.css.transform);
say('whiteSpace', reveal.css.wrap);
say('fontSize', reveal.css.size);
say('tracking', reveal.css.tracking);
say('frozenAt', `${frozen.said.length}/${HER_LINE.length}: "${frozen.said}"`);
say('sameAfterShot', afterShutter === frozen.said);
say('frozenBox', frozen.css.box);
say('midInkVsEmpty', midInk);
say('boxAtRest', settled.css.box);
say('wrappedRects', settled.rects);
say('finalSaid', settled.said);
say('domTotal', settled.dom);
say('scheduleMs', settled.stats.durationMs);
say('framesToFinish', settled.framesToFinish);
say('restInkVsEmpty', herInk);
say('longestChars', longest.chars);
say('longestBox', longest.css.box);
say('longestRects', longest.rects);

const grown = (() => {
  const a = reveal.samples[0], b = reveal.samples[reveal.samples.length - 1];
  if (!b || b.ms <= a.ms) return null;
  return { fromN: a.n, toN: b.n, overMs: b.ms - a.ms,
    deliveredCps: +(((b.n - a.n) / (b.ms - a.ms)) * 1000).toFixed(2) };
})();
say('delivered', grown);

console.log('--- 3. the tick ---');
for (const [k, v] of Object.entries(tickTest)) say(k, v);

console.log('--- 4. the authored cut ---');
for (const [k, v] of Object.entries(cut)) say(k, v);
say('midCutSaid', cutMid.said);
say('midCutDom', cutMid.domTotal);
say('forcedOver', clobber.said);

console.log('--- 5. the hold ---');
for (const [k, v] of Object.entries(hold)) say(k, v);

console.log('--- 5b. the teardown runs on the reveal clock ---');
for (const [k, v] of Object.entries(teardown)) say(k, v);

console.log('--- 5c. the same invariant at one frame a second, driven ---');
for (const [k, v] of Object.entries(slow)) say(k, v);

console.log('--- 6. the two speakers, rendered through the real graph ---');
say('her', codec.her);
say('gate', codec.gate);
say('groan (horde)', codec.groan);

console.log('--- 7. the death card ---');
for (const [k, v] of Object.entries(card)) say(k, v);
say('second death', card2);

console.log('--- shots ---');
for (const f of ['00-empty-control', '01-system-uppercase', '02-her-midreveal',
  '03-her-at-rest', '04-her-in-frame', '05-her-cut', '06-kindling-over-her',
  '07-death-answer', '08-death-second', '09-her-longest-line']) {
  console.log(`  shots/pacer-${f}.png`);
}

const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
if (errs.length) { console.log('--- errors ---'); errs.forEach((e) => console.log(e)); }

// ---------------------------------------------------------------------------
// the gates
// ---------------------------------------------------------------------------

const cutIndex = cut.full.indexOf(cut.cutAt) + cut.cutAt.length;
const glyphs = TICK_LINE.replace(/\s/g, '').length;

const checks = {
  // 0. the authored rate
  'her rate is 22 cps':            Math.abs(rate.plainCps - 22) < 0.01,
  'his rate is 6 cps':             Math.abs(rate.gatePlainCps - 6) < 0.01,
  'spaces cost less':              rate.spacesCostLess === true,
  'full stops cost more':          rate.stopsCostMore > 300,

  // 1. the existing callers
  'system notice accepted':        sys.accepted === true,
  'system text is set whole':      sys.immediate === SYS_LINE && sys.said === SYS_LINE,
  'system stays UPPERCASE':        sys.css.transform === 'uppercase',
  'system does not tick':          sys.ticksFired === 0,
  'system fits the window':        sys.css.box.x >= 0 && sys.css.box.right <= W,
  'system pill actually drew':     sysInk.changedPct > 0.4,

  // 2. her line
  'her line is lowercase':         reveal.css.transform === 'none',
  'the pill can wrap now':         reveal.css.wrap === 'normal',
  'reveal starts short':           reveal.samples[0].n < 8,
  'reveal grows over time':        reveal.samples[1].n > reveal.samples[0].n
                                   && reveal.samples[3].n > reveal.samples[1].n,
  'reveal reaches the line':       settled.said === HER_LINE,
  'nothing is left reserved':      settled.dom === HER_LINE,
  'schedule matches 22 cps':       Math.abs(settled.stats.durationMs - rate.herLineMs) < 1,
  'her line fits the window':      settled.css.box.x >= 0 && settled.css.box.right <= W,
  'mid-reveal is partial':         frozen.said.length > 0
                                   && frozen.said.length < HER_LINE.length,
  'the picture is the state':      afterShutter === frozen.said,
  'the box is already full width': frozen.css.box.w > 300,
  'mid-reveal actually drew':      midInk.changedPct > 0.2,
  'her line actually drew':        herInk.changedPct > 0.4,
  'the longest line wraps':        longest.rects >= 2,
  'and stays on the screen':       longest.css.box.x >= 0 && longest.css.box.right <= W,
  'and is revealed whole':         longest.said === LONG_LINE,

  // 3. the tick
  'one tick per glyph':            tickTest.ticks === glyphs,
  'silent on spaces':              tickTest.ticks === tickTest.chars - tickTest.spaces,
  'ticks are her voice':           tickTest.voices.length === 1 && tickTest.voices[0] === 'her',

  // 4. the cut
  'cut point was found':           cut.cutMissing === false,
  'cut at the authored char':      cut.saidAtStop === cut.full.slice(0, cutIndex),
  'the unsaid half is reserved':   cut.domTotal === cut.full,
  'a mid-line cut truncates':      cutMid.said === cutMid.full.slice(0,
                                     cutMid.full.indexOf('been meaning') + 'been meaning'.length),
  'and leaves the rest unsaid':    cutMid.said.length < cutMid.full.length
                                   && cutMid.domTotal === cutMid.full,
  'the cut is where it is authored': Math.abs(cut.cutAtMs - cut.expectCutMs) < 1,
  'the Kindling landed after':     cut.kindlingAtMs > cut.cutAtMs,
  'the Kindling took the pill':    clobber.forced === true && clobber.said === SYS_LINE
                                   && clobber.css.transform === 'uppercase',

  // 5. the hold
  'system dropped during a line':  hold.during === false
                                   && hold.afterAttempt !== 'NEED 400 MORE GOLD'
                                   && hold.dropped === 'NEED 400 MORE GOLD',
  'force still gets through':      hold.forced === true && hold.afterForce === 'FORCED',

  // 5b. the clock the teardown runs on
  'a slow machine still finishes': teardown.wholeLine === HER_LINE,
  'nothing wiped it in flight':    teardown.wipedAt === -1,
  'and it does come down after':   teardown.stillOn === false,
  /*
   * `the reveal outran the wall` USED TO BE A GATE HERE AND IT IS NOW DATA.
   *
   * It asserted `wallMsToWholeLine > 2840`: that this rendered run was slow
   * enough for the two clocks to have diverged, so that the run was a genuine
   * witness to the pre-fix bug rather than a case too fast to show it. That is
   * a reasonable thing to WANT and a bad thing to GATE ON, because it is a
   * claim about how loaded the machine was, not about the code. Run after four
   * other suites it measures ~4.9 s and passes; run first, on a quiet machine,
   * it measured 2653 ms and failed with nothing wrong. A check that flips on
   * CPU contention teaches everyone to re-run until it is green, which is the
   * habit that makes a real failure invisible.
   *
   * The property it was reaching for is covered DETERMINISTICALLY by 5c below,
   * which drives a manual typewriter at 1 fps and at 0.1 fps and asserts the
   * order reveal -> cut -> hold never overlaps. That cannot be outrun by a fast
   * machine because it does not depend on the machine at all. The wall time is
   * still printed in the block above, where an unexpectedly fast or slow number
   * is information rather than a verdict.
   */

  // 5c. and the ORDER holds at any frame rate
  'at 1 fps the line completes':   slow.plain.shownAtEnd === slow.plain.full,
  'the hold ends after it':        slow.plain.endedAt > slow.plain.completeAt,
  'the reveal never goes back':    !slow.plain.backwards && !slow.cut.backwards,
  'at 1 fps the cut still fires':  slow.cut.cutAtStep >= 0
                                   && slow.cut.cutAtStep >= slow.cut.completeAt,
  'and cuts at the right place':   slow.cut.shownAtEnd === slow.cut.full,
  'at 0.1 fps it still fires':     slow.crawl.cutAtStep >= 0
                                   && slow.crawl.endedAt > slow.crawl.cutAtStep,

  // 6. the speakers
  'her tick makes sound':          codec.her.fired && codec.her.peak > 0.005,
  'gate tick makes sound':         codec.gate.fired && codec.gate.peak > 0.005,
  'an octave between speakers':    codec.her.f0 > codec.gate.f0 * 1.7,
  'filters are separated':         codec.her.centroidHz > codec.gate.centroidHz * 1.5,
  'both clear the horde floor':    codec.gate.f0Range[0] > 104 && codec.her.f0Range[0] > 104,
  // groan() runs rand(62, 104) and then glides up to 1.14x of that at the top
  // of its envelope, so the honest window for a measurement taken at the peak
  // is 55 to 130. Both speakers have to sit clear of the TOP of it.
  'the horde is where it was':     codec.groan.f0 >= 55 && codec.groan.f0 <= 130,
  'ticks are percussive':          codec.her.lenMs < 120 && codec.gate.lenMs < 160,

  // 7. the card
  'the verdict is unchanged':      card.verdict === 'UNWORTHY',
  'something answers it':          card.answer.length > 0,
  'the answer was typed':          card.steps.length > 2,
  'the answer is not a sentence':  card.answerFull.split(/\s+/).length <= 3,
  'the answer is his voice':       card.gateTicks > 0 && card.herTicks === 0,
  'the answer is not hers':        card.css.transform !== 'lowercase',
  'the tomb counts erasures':      /ERASED 01 TIME$/.test(card.epitaph),
  'the count moves':               /ERASED 02 TIMES$/.test(card2.epitaph),
  'the answer rotates':            card2.answer !== card.answer,

  'no console errors':             errs.length === 0,
};

console.log('\n--- checks ---');
let failed = 0;
for (const [k, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${k}`);
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
