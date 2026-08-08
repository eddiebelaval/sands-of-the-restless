/**
 * EVERY VARIANT IN THE UNLOCK TABLE ACTUALLY REACHES THE FLOOR.
 *
 * A variant is declared in `enemies/variants.js` and SPAWNED by two hardcoded
 * literal tables in `enemies/director.js` - `POOL`, which allocates the actors
 * at boot, and `weight`, which decides what goes into a wave queue. Neither
 * enumerates `VARIANTS`. So a variant can be completely and correctly authored,
 * exported, given an UNLOCK entry, and never once appear in the game.
 *
 * That is not hypothetical. The gold scarab was built, verified through
 * `createEnemy()` in a live page, and passed all 52 checks in `test/enemies.mjs`
 * while being unspawnable, because that suite enumerates
 * `['shambler', 'husk', 'bound', 'scarab']` at four call sites and its "all four
 * variants build" check is a list it was handed rather than the roster the game
 * actually has. A test that hardcodes the thing it is meant to be checking
 * cannot fail when that thing is wrong.
 *
 * So this reads UNLOCK at runtime and asserts, per variant, that a body of that
 * type is alive on the floor at a wave past its own unlock. It has no list in
 * it. Add a variant and this covers it the day it lands, or fails until it does.
 *
 * THE CONTROL is the shambler, which has spawned since wave one for the life of
 * the project. If the shambler row fails, this harness is broken and the roster
 * is not.
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1200);

const out = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const { UNLOCK } = await import(
    new URL('../src/enemies/variants.js', location.href).href
  );

  if (!g.director.forceWave) return { fatal: 'director.forceWave not available' };
  if (!g.director.live) return { fatal: 'director.live not available' };

  const dt = 1 / 60;
  let clock = 0;
  const seen = {};
  for (const k of Object.keys(UNLOCK)) seen[k] = 0;

  /**
   * Pump a wave and record what is standing in it.
   *
   * Sampled every frame rather than once at the end, because the director holds
   * a live cap and trickles the queue in: a body can spawn, cross the room and
   * die inside one wave, and a single sample at the end would miss it and report
   * a variant that spawns fine as one that never spawns.
   */
  function runWave(w, frames) {
    g.director.forceWave(w);
    for (let i = 0; i < frames; i++) {
      clock += dt;
      g.director.update(dt, clock);
      for (const a of g.director.live) {
        if (a.variant && seen[a.variant] !== undefined) seen[a.variant]++;
      }
    }
  }

  // Every wave from 1 to FINAL, so each variant is observed at waves well past
  // its own unlock rather than exactly on it - a 0.12 weight will not show up
  // reliably in one wave of one sample.
  for (let w = 1; w <= 25; w++) runWave(w, 220);

  return { unlock: UNLOCK, seen };
});

if (out.fatal) { console.log(`FATAL  ${out.fatal}`); await browser.close(); process.exit(1); }

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

console.log('variant        unlock   frames observed alive');
for (const [k, w] of Object.entries(out.unlock)) {
  console.log(`  ${k.padEnd(14)}${String(w).padStart(4)}${String(out.seen[k]).padStart(12)}`);
}
console.log('');

// The control first. If this fails nothing else in the file means anything.
ok(out.seen.shambler > 0, 'CONTROL: the shambler spawns');

for (const [k, w] of Object.entries(out.unlock)) {
  ok(out.seen[k] > 0, `${k} (unlock ${w}) actually reaches the floor`);
}
ok(errors.length === 0, 'no console errors');
if (errors.length) for (const e of errors.slice(0, 5)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
