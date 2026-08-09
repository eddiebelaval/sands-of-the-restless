/**
 * THE END OF WORLD 1, MEASURED IN WALL CLOCK AND READ OFF THE SCREEN.
 *
 * The owner finished a real run, walked into the Serdab, and reported: "it just
 * turned black. The screen turned black, and nothing happened."
 *
 * `test/e2e.mjs` asserts the opposite and passes. Both can be true, and the gap
 * between them is this file's whole subject:
 *
 *   e2e pumps `X.frames(40)` and then reads `ending.stats()`. Under swiftshader
 *   a frame costs 100ms to 1.7s, so forty frames can be half a minute of
 *   SIMULATION time - vastly past the 1.25s the card waits. On the owner's
 *   machine forty frames is two thirds of a second and the card is still hidden.
 *   The harness was not lying about the card; it was measuring a clock the
 *   player does not have.
 *
 * So this file measures in WALL CLOCK, which is the only unit the person holding
 * the mouse experiences, and the card is read off `getBoundingClientRect` and
 * off a SCREENSHOT rather than off a flag - a black screen that reports
 * `cardVisible: true` is precisely the failure being chased.
 *
 * AMENDED 2026-08-09: it counts frames TOO, and the two units answer different
 * questions. This file originally said "nothing here counts frames", and that
 * sentence is what made it fail 4/8 on a loaded machine while the game was
 * perfectly healthy - a wall clock with no frame count cannot tell a broken card
 * from a box that drew four frames in six seconds. The frame count is not a
 * retreat from the wall clock; it is what lets the wall clock be trusted when it
 * speaks. See the note on PATIENCE_MS below.
 *
 * The controls matter as much as the checks. A screenshot of a black frame and a
 * screenshot of a card are different images; a card that is coded and never
 * reached makes them identical. The first frame after the world ends is kept as
 * that control.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveChrome } from './chrome.mjs';
import sharp from 'sharp';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** What a player would call "nothing is happening". */
const PATIENCE_MS = 6000;

/**
 * THE CARD IS PAID FOR IN FRAMES, AND THE PLAYER IS CHARGED IN SECONDS.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE NOW MEASURES BOTH
 * ---------------------------------------------------------------------------
 *
 * `ui/ending.js` clamps its own clock at `MAX_STEP` 0.25 s per frame, so the
 * card cannot arrive in fewer than `1.25 / 0.25 = 5` drawn frames and the button
 * cannot arm in fewer than `(1.25 + 0.55) / 0.25 = 8`. That is a property of the
 * game and it is true on every machine ever built.
 *
 * PATIENCE_MS is a property of the PLAYER: six seconds of a black screen is the
 * owner's original complaint - "it just turned black, and nothing happened."
 *
 * On a real machine the two never conflict: 8 frames at 16 ms is 128 ms against
 * a 6000 ms budget, and this suite measured 3551 ms / 3992 ms on a quiet machine
 * on 2026-08-09. Under swiftshader with other work on the box, ONE FRAME COST
 * 1036 ms - an 8288 ms floor against a 6000 ms budget - and this file reported
 * 7/8 at load 15 and 4/8 at load 46. It was reporting the machine as a defect in
 * the ending, on the very screen a player complained about, which is the most
 * expensive place in the project to cry wolf.
 *
 * So: the FRAME claim is asserted always, because it is about the game. The
 * WALL CLOCK claim is asserted only when the measured frame cost leaves it
 * achievable, and when it does not it prints SKIPPED with the arithmetic that
 * excused it. It never prints PASS on a run where it did not run - a gate that
 * fails open silently is worse than the bug it was watching for.
 */
const CARD_MIN_FRAMES = 5;
const ARM_MIN_FRAMES = 8;

/** Generous: the claim is "a handful of frames", not an exact count. */
const FRAME_BUDGET = 40;

/** A hard stop so a genuinely dead card fails loudly instead of hanging. */
const HARD_CEILING_MS = 180000;

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1500);

// ---------------------------------------------------------------------------
// end the world, and do it through the front door
// ---------------------------------------------------------------------------
//
// `ending.begin()` rather than a staged gate, and the split is deliberate.
//
// WHETHER THE GATE OPENS is settled: test/e2e.mjs climbs all twenty-five waves
// with forceWave and reset replaced by recorders, returns four jars on real
// keys, walks into the Serdab and asserts the gate fired. Re-staging that here
// would be a worse copy of a passing test.
//
// WHAT HAPPENS IN THE 1.25 SECONDS AFTERWARDS is what the owner actually hit,
// and `begin()` is the same call the gate makes - one line further down the
// same function - so driving it directly tests the sequence the player watched
// without faking anything about the sequence itself.

const armed = await page.evaluate(() => {
  const g = window.__SANDS__;
  const began = g.ending.begin();
  return { began, phase: g.ending.state.phase, halted: g.ending.halted };
});

/*
 * COUNT DRAWN FRAMES FROM THE INSTANT THE WORLD ENDS.
 *
 * Installed after begin() and not before, so frame zero is the black frame. The
 * counter is the denominator for everything below: it is what turns "the card
 * took 8288 ms" into "the card took 8 frames on a box that draws one a second",
 * which are the same run and only one of them is a bug report.
 */
await page.evaluate(() => {
  window.__EG_FRAMES__ = 0;
  (function tick() {
    requestAnimationFrame(tick);
    window.__EG_FRAMES__++;
  })();
});

const t0 = Date.now();
const timeline = [];
let cardAtMs = null;
let armedAtMs = null;
let cardAtFrames = null;
let armedAtFrames = null;

// The control: the frame immediately after the world ends. Black, and nothing
// else. Every later shot is compared against THIS, not against an assumption.
await page.waitForTimeout(120);
const controlShot = await page.screenshot();
writeFileSync(`${OUT}endgame-0-black.png`, controlShot);

/*
 * KEEPS POLLING PAST PATIENCE_MS, and that is the change.
 *
 * The loop used to stop at six seconds, which meant a slow machine produced
 * `cardAtMs === null` and no information at all about WHY - the run could not
 * tell "the card is broken" from "this box drew four frames". It now runs until
 * the card and button are both seen, or until the frame budget is spent, and
 * PATIENCE_MS becomes something the results are compared against rather than
 * something that cuts the measurement short.
 */
let frames = 0;
while (Date.now() - t0 < HARD_CEILING_MS) {
  const s = await page.evaluate(() => {
    const g = window.__SANDS__;
    const st = g.ending.stats();
    const el = document.querySelector('.ending-card');
    const box = el ? el.getBoundingClientRect() : null;
    return {
      phase: st.phase, t: st.t, cardVisible: st.cardVisible, armed: st.armed,
      shown: st.shown, waitingOn: st.waitingOn,
      frames: window.__EG_FRAMES__,
      // LAID OUT, not merely set: a visible card with a zero box is not a card.
      box: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null,
    };
  });
  const ms = Date.now() - t0;
  frames = s.frames;
  timeline.push({ ms, ...s });
  if (s.cardVisible && cardAtMs === null) { cardAtMs = ms; cardAtFrames = s.frames; }
  if (s.armed && armedAtMs === null) { armedAtMs = ms; armedAtFrames = s.frames; }
  if (cardAtMs !== null && armedAtMs !== null) break;
  if (s.frames > FRAME_BUDGET) break;
  await page.waitForTimeout(150);
}

/**
 * What one frame cost on this machine, during this measurement.
 *
 * Not read from the FPS readout: that is a rolling average over the whole run
 * including the courtyard, and what matters is the cost of the frames the CARD
 * was waiting on, which are the most expensive in the game.
 */
const elapsedMs = Date.now() - t0;
const frameMs = frames > 0 ? Math.round(elapsedMs / frames) : null;

/** Whether this box could physically have met the budget. Arithmetic, not taste. */
const wallClockAchievable = frameMs !== null && frameMs * ARM_MIN_FRAMES <= PATIENCE_MS;

const finalShot = await page.screenshot();
writeFileSync(`${OUT}endgame-1-card.png`, finalShot);

/** How different two frames are, 0..255. A card that never paints scores ~0. */
async function diff(a, b) {
  const A = await sharp(a).greyscale().raw().toBuffer();
  const B = await sharp(b).greyscale().raw().toBuffer();
  let sum = 0; const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) sum += Math.abs(A[i] - B[i]);
  return +(sum / n).toFixed(3);
}
const paintDiff = await diff(controlShot, finalShot);

/** How much ink is on the final frame at all. Flat black is ~0. */
const inkOnFinal = await (async () => {
  const raw = await sharp(finalShot).greyscale().raw().toBuffer();
  let lit = 0;
  for (let i = 0; i < raw.length; i++) if (raw[i] > 24) lit++;
  return +((lit / raw.length) * 100).toFixed(3);
})();

const last = timeline[timeline.length - 1] || {};

const checks = {
  'the world ended':
    armed.began === true && armed.halted === true,
  'the world went black':
    last.shown === true,
  // THE GAME'S OWN CLAIM, true on any machine: the card is a handful of frames
  // behind the black, not an unbounded wait.
  [`the CARD arrives within ${FRAME_BUDGET} drawn frames`]:
    cardAtFrames !== null && cardAtFrames <= FRAME_BUDGET,
  'and it took at least the frames its own clamp requires':
    cardAtFrames !== null && cardAtFrames >= CARD_MIN_FRAMES,
  'and it is LAID OUT, not merely visible':
    !!(last.box && last.box.w > 80 && last.box.h > 60),
  [`the way out ARMS within ${FRAME_BUDGET} drawn frames`]:
    armedAtFrames !== null && armedAtFrames <= FRAME_BUDGET,
  /*
   * The threshold is MEASURED, not chosen. Against the sim-time clock this card
   * never arrived inside six seconds and both frames were the same flat black:
   * diff 0.000, ink 0.000%. With the wall clock it is diff 0.314, ink 1.676%.
   * The card is a small object on a large black field, so 0.314 is what "it
   * painted" actually looks like here - a round number like 1.0 would have been
   * a threshold picked to be impressive and would fail on a true pass.
   */
  'CONTROL: the card frame differs from the black frame':
    paintDiff > 0.1,
  'there is ink on the final frame':
    inkOnFinal > 0.5,
  'no console errors':
    errors.length === 0,
};

/*
 * THE PLAYER'S CLAIM, ASSERTED ONLY WHEN THIS BOX COULD HAVE MET IT.
 *
 * Kept separate from `checks` because it has three outcomes and the others have
 * two. It is never folded into a PASS: an unmet-because-impossible run prints
 * SKIPPED, is counted on its own line, and says out loud what excused it.
 */
const wallClock = {
  name: `the CARD arrives within ${PATIENCE_MS}ms of a real clock`,
  skipped: !wallClockAchievable,
  pass: cardAtMs !== null && cardAtMs <= PATIENCE_MS
    && armedAtMs !== null && armedAtMs <= PATIENCE_MS,
  why: wallClockAchievable
    ? null
    : `${frameMs}ms a frame x ${ARM_MIN_FRAMES} frames the clamp requires = `
      + `${frameMs === null ? '?' : frameMs * ARM_MIN_FRAMES}ms floor, against a `
      + `${PATIENCE_MS}ms budget - this machine cannot answer the question`,
};

writeFileSync(`${OUT}endgame-report.json`,
  JSON.stringify({ armed, cardAtMs, armedAtMs, cardAtFrames, armedAtFrames,
    frames, elapsedMs, frameMs, wallClock, paintDiff, inkOnFinal, timeline, errors }, null, 1));

console.log(`armed          ${JSON.stringify(armed)}`);

console.log('');
console.log(`card visible   ${cardAtMs === null ? 'NEVER' : cardAtMs + 'ms'}`
  + `   after ${cardAtFrames === null ? '?' : cardAtFrames} frames`);
console.log(`button armed   ${armedAtMs === null ? 'NEVER' : armedAtMs + 'ms'}`
  + `   after ${armedAtFrames === null ? '?' : armedAtFrames} frames`);
console.log(`frame cost     ${frameMs === null ? '?' : frameMs + 'ms'} `
  + `(${frames} frames in ${elapsedMs}ms)`);
console.log(`sim t reached  ${last.t}s   phase ${last.phase}`);
console.log(`paint diff     ${paintDiff}   ink on final ${inkOnFinal}%`);
console.log('');

let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

if (wallClock.skipped) {
  // Loud on purpose, and never the word PASS. A reader scanning this output has
  // to be able to see that the player-facing latency claim did not run.
  console.log(`SKIP  ${wallClock.name}`);
  console.log(`      ${wallClock.why}`);
  console.log('      RE-RUN ON A QUIET MACHINE BEFORE BELIEVING THIS SUITE GREEN.');
} else {
  if (!wallClock.pass) failed++;
  console.log(`${wallClock.pass ? 'PASS' : 'FAIL'}  ${wallClock.name}`);
}
console.log(`\nreport  ${OUT}endgame-report.json`);
console.log(`shots   ${OUT}endgame-0-black.png  ${OUT}endgame-1-card.png`);
if (errors.length) console.log(`errors  ${errors.slice(0, 3).join(' / ')}`);

await browser.close();
if (failed) { console.log(`\n${failed} CHECK(S) FAILED`); process.exit(1); }
console.log('\nALL CHECKS PASSED');
