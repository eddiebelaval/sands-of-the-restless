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
 * So nothing here counts frames. Every deadline is WALL CLOCK, which is the only
 * unit the person holding the mouse experiences, and the card is read off
 * `getBoundingClientRect` and off a SCREENSHOT rather than off a flag - a black
 * screen that reports `cardVisible: true` is precisely the failure being chased.
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

const t0 = Date.now();
const timeline = [];
let cardAtMs = null;
let armedAtMs = null;

// The control: the frame immediately after the world ends. Black, and nothing
// else. Every later shot is compared against THIS, not against an assumption.
await page.waitForTimeout(120);
const controlShot = await page.screenshot();
writeFileSync(`${OUT}endgame-0-black.png`, controlShot);

while (Date.now() - t0 < PATIENCE_MS) {
  const s = await page.evaluate(() => {
    const g = window.__SANDS__;
    const st = g.ending.stats();
    const el = document.querySelector('.ending-card');
    const box = el ? el.getBoundingClientRect() : null;
    return {
      phase: st.phase, t: st.t, cardVisible: st.cardVisible, armed: st.armed,
      shown: st.shown, waitingOn: st.waitingOn,
      // LAID OUT, not merely set: a visible card with a zero box is not a card.
      box: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null,
    };
  });
  const ms = Date.now() - t0;
  timeline.push({ ms, ...s });
  if (s.cardVisible && cardAtMs === null) cardAtMs = ms;
  if (s.armed && armedAtMs === null) armedAtMs = ms;
  if (cardAtMs !== null && armedAtMs !== null) break;
  await page.waitForTimeout(150);
}

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
  [`the CARD arrives within ${PATIENCE_MS}ms of a real clock`]:
    cardAtMs !== null,
  'and it is LAID OUT, not merely visible':
    !!(last.box && last.box.w > 80 && last.box.h > 60),
  [`the way out ARMS within ${PATIENCE_MS}ms`]:
    armedAtMs !== null,
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

writeFileSync(`${OUT}endgame-report.json`,
  JSON.stringify({ armed, cardAtMs, armedAtMs, paintDiff, inkOnFinal, timeline, errors }, null, 1));

console.log(`armed          ${JSON.stringify(armed)}`);

console.log('');
console.log(`card visible   ${cardAtMs === null ? 'NEVER within ' + PATIENCE_MS + 'ms' : cardAtMs + 'ms'}`);
console.log(`button armed   ${armedAtMs === null ? 'NEVER within ' + PATIENCE_MS + 'ms' : armedAtMs + 'ms'}`);
console.log(`sim t reached  ${last.t}s   phase ${last.phase}`);
console.log(`paint diff     ${paintDiff}   ink on final ${inkOnFinal}%`);
console.log('');

let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`\nreport  ${OUT}endgame-report.json`);
console.log(`shots   ${OUT}endgame-0-black.png  ${OUT}endgame-1-card.png`);
if (errors.length) console.log(`errors  ${errors.slice(0, 3).join(' / ')}`);

await browser.close();
if (failed) { console.log(`\n${failed} CHECK(S) FAILED`); process.exit(1); }
console.log('\nALL CHECKS PASSED');
