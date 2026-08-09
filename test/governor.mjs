/**
 * THE FRAME GOVERNOR, DRIVEN THROUGH ITS REAL OBJECT IN A REAL PAGE.
 *
 * A player on a MacBook could not run this game. The cause was that
 * `setFidelity(true)` was called unconditionally at boot with no hardware
 * detection anywhere in the build, so every machine got GTAO, a 4096 shadow map
 * and nine fullscreen passes at a pixel budget measured on an M4 Max.
 *
 * `src/core/governor.js` is the fix and this is its gate. What it asserts is
 * the BEHAVIOUR, not a duration: how many bad frames it tolerates before giving
 * something up, that it gives them up in the right order, that it does not
 * oscillate, that it refuses to argue with the player, and that it ignores the
 * frames it is supposed to ignore.
 *
 * IT DELIBERATELY DOES NOT ASSERT A FRAME TIME. A gate that says "60 fps" is a
 * gate that measures the machine the CI runs on, and it fails on a busy laptop
 * for reasons that have nothing to do with the code. This project already has a
 * section in STATE.md about a gate that sat below its own noise floor and would
 * have passed with the pass under test DELETED. Durations are measured by
 * `tools/perf.mjs`, which is an instrument and prints numbers; correctness is
 * asserted here, where the answers are shapes.
 *
 * Usage: node test/governor.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS, dismissBriefing } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

let pass = 0;
const fails = [];
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail === undefined ? '' : `  (${detail})`}`); }
};

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  // Software rendering is correct here. This suite asserts decisions, not
  // durations, and every frame time it uses is injected by hand.
  args: GL_ARGS,
});

const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.evaluate(() => document.getElementById('begin').click());
// BEGIN raises the briefing card now; the world is held behind it. See chrome.mjs.
await dismissBriefing(page);
await page.waitForTimeout(1500);

const exists = await page.evaluate(() => !!(window.__SANDS__ && window.__SANDS__.governor));
check(exists, 'the governor is exposed on the harness handle');
if (!exists) {
  console.log('\nNothing further can be asserted.');
  await browser.close();
  process.exit(1);
}

/**
 * Feed the governor synthetic frames.
 *
 * Injecting the number is the whole method. Waiting for a real machine to be
 * slow is not a test, it is a hope, and it would make this suite pass or fail
 * on how busy the laptop was. `force(0)` resets to the top of the ladder first
 * so every case starts from a known rung.
 */
async function feed(ms, count, { reset = true } = {}) {
  return page.evaluate(({ ms, count, reset }) => {
    const g = window.__SANDS__.governor;
    if (reset) g.force(0);
    for (let i = 0; i < count; i++) g.sample(ms);
    return { rung: g.rung, id: g.id, ceiling: g.ceiling };
  }, { ms, count, reset });
}

// ---------------------------------------------------------------------------
console.log('\nTHE LADDER COMES DOWN UNDER LOAD');
// ---------------------------------------------------------------------------

const start = await feed(8, 0);
check(start.rung === 0 && start.id === 'full', 'starts at the top rung', start.id);

// 8 ms is a comfortable 125 fps. Nothing should move, in either direction.
const fast = await feed(8, 400);
check(fast.rung === 0, 'a fast machine is left alone', `rung ${fast.rung}`);

// A single window of bad frames is not enough on its own: the rolling median
// needs to fill (60) AND the bad counter needs to reach DEGRADE_AFTER (60).
const brief = await feed(40, 40);
check(brief.rung === 0, 'a brief stutter does not degrade anything', `rung ${brief.rung}`);

// Sustained 40 ms is 25 fps and is exactly the case this exists for.
const slow = await feed(40, 200);
check(slow.rung > 0, 'sustained slow frames give something up', `rung ${slow.rung}`);
check(slow.id === 'no-ao', 'and the first thing given up is GTAO', slow.id);

/**
 * GTAO FIRST IS THE MEASURED CHOICE, NOT AN AESTHETIC ONE.
 *
 * On an M4 Max at 1.24 MP, with vsync disabled, tools/perf.mjs measured the
 * shipping default at 15.00 ms and the same frame with GTAO off at 10.00 ms:
 * a third of the frame, and 183,000 triangles, for one pass. It is the only
 * pass in the chain that re-renders the whole scene rather than compositing a
 * fullscreen quad, and the AO it produced was separately found to be a line
 * drawing with a mean of 0.971. Most expensive, least visible, so it goes first.
 */

// Keep pushing and it keeps stepping, without being reset in between.
const deeper = await feed(40, 200, { reset: false });
check(deeper.rung > slow.rung, 'it keeps stepping while the frames stay bad', `rung ${deeper.rung}`);

// ---------------------------------------------------------------------------
console.log('\nIT DOES NOT CLIMB BACK INTO A RUNG THAT ALREADY FAILED TWICE');
// ---------------------------------------------------------------------------

const ceiling = await page.evaluate(() => {
  const g = window.__SANDS__.governor;
  g.force(0);
  // Fail rung 0 twice, with a full recovery in between, which is the exact
  // oscillation the ceiling exists to stop.
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 200; i++) g.sample(40);   // degrade off rung 0
    g.force(0);                                    // pretend it recovered
  }
  for (let i = 0; i < 200; i++) g.sample(40);
  const afterFall = g.rung;
  // Now hand it a long stretch of clear headroom and see if it climbs back.
  for (let i = 0; i < 2000; i++) g.sample(6);
  return { ceiling: g.ceiling, afterFall, afterRecovery: g.rung };
});

check(ceiling.ceiling >= 1, 'two failures on a rung raise the ceiling', `ceiling ${ceiling.ceiling}`);
check(ceiling.afterRecovery >= ceiling.ceiling,
  'and recovery never climbs above that ceiling',
  `recovered to ${ceiling.afterRecovery}, ceiling ${ceiling.ceiling}`);

// ---------------------------------------------------------------------------
console.log('\nIT RECOVERS, BUT SLOWLY, AND ONLY WITH REAL HEADROOM');
// ---------------------------------------------------------------------------

const recovery = await page.evaluate(() => {
  const g = window.__SANDS__.governor;
  g.force(3);
  // 17 ms sits in the dead band between DEGRADE_MS (20) and RECOVER_MS (13).
  // Neither counter may advance: this is the anti-oscillation band.
  for (let i = 0; i < 1200; i++) g.sample(17);
  const band = g.rung;

  g.force(3);
  for (let i = 0; i < 100; i++) g.sample(6);
  const tooSoon = g.rung;

  for (let i = 0; i < 1000; i++) g.sample(6);
  const eventually = g.rung;

  return { band, tooSoon, eventually };
});

check(recovery.band === 3, 'the dead band moves nothing in either direction', `rung ${recovery.band}`);
check(recovery.tooSoon === 3, 'a short good patch does not climb', `rung ${recovery.tooSoon}`);
check(recovery.eventually < 3, 'sustained headroom does climb', `rung ${recovery.eventually}`);

// ---------------------------------------------------------------------------
console.log('\nTHE PLAYER ALWAYS WINS');
// ---------------------------------------------------------------------------

const yielded = await page.evaluate(() => {
  const g = window.__SANDS__.governor;
  g.force(0);
  g.yieldToPlayer();
  for (let i = 0; i < 600; i++) g.sample(60);   // 16 fps, and it must not care
  return { rung: g.rung, standingDown: g.standingDown };
});

check(yielded.standingDown === true, 'an explicit fidelity choice stands the governor down');
check(yielded.rung === 0, 'and it never moves again, however bad the frames get', `rung ${yielded.rung}`);

// ---------------------------------------------------------------------------
console.log('\nTHE RUNGS ACTUALLY REACH THE RENDERER');
// ---------------------------------------------------------------------------
//
// The ladder deciding to drop GTAO and GTAO still running would be this whole
// system as a no-op, which is the defining failure class of this project - a
// thing that was written and never took effect. So read it back off the passes.

const applied = await page.evaluate(() => {
  const g = window.__SANDS__;
  const gov = g.governor;
  const pass = (re) => g.composer.passes.find((p) => re.test(p.constructor.name));

  gov.force(0);
  const atFull = { gtao: !!pass(/GTAO/i)?.enabled, bloom: !!pass(/Bloom/i)?.enabled };

  gov.force(1);
  const noAO = { gtao: !!pass(/GTAO/i)?.enabled, bloom: !!pass(/Bloom/i)?.enabled };

  gov.force(3);
  const noBloom = { gtao: !!pass(/GTAO/i)?.enabled, bloom: !!pass(/Bloom/i)?.enabled };

  gov.force(0);
  return { atFull, noAO, noBloom };
});

check(applied.atFull.gtao === true, 'rung 0 really has GTAO on');
check(applied.noAO.gtao === false, 'rung 1 really turns GTAO off in the composer');
check(applied.noAO.bloom === true, 'rung 1 leaves bloom alone');
check(applied.noBloom.bloom === false, 'rung 3 really turns bloom off');

// A pass must always be writing to the screen, or the frame is black - which is
// fast, silent, and reads on any profiler as an enormous improvement.
const screenTarget = await page.evaluate(() => {
  const g = window.__SANDS__;
  const out = [];
  for (const n of [0, 1, 3, 5, 6]) {
    g.governor.force(n);
    out.push({
      rung: n,
      writers: g.composer.passes.filter((p) => p.enabled && p.renderToScreen).length,
    });
  }
  g.governor.force(0);
  return out;
});

for (const s of screenTarget) {
  check(s.writers === 1, `rung ${s.rung} has exactly one pass writing to the screen`, `${s.writers}`);
}

check(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | '));

// ---------------------------------------------------------------------------

console.log(`\n${fails.length ? `GOVERNOR: ${fails.length} FAILED of ${pass + fails.length}` : `GOVERNOR: all ${pass} checks green`}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
