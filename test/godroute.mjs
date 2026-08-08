/**
 * DOES A GOD WALK THE MAP, OR DOES IT WALK THE BEARING.
 *
 * Until this change a god read no routing at all. `enemies/boss.js` said so in
 * its own comment - "it has no local avoidance at all, it steers straight at the
 * player by design, because a colossus that side-steps scenery reads as timid" -
 * and it relied on a wedge detector plus a committed detour to get round
 * whatever it walked into. That is local steering, and local steering has the
 * one failure no tuning removes: it cannot see a doorway it is not facing. It is
 * the failure `enemies/flow.js` was written to end for the horde, left standing
 * for the single body the player stops moving in order to fight.
 *
 * A god now reads `ctx.flowHeavy`, a second flood over the same grid carved at
 * 1.805 x 3.9 instead of the horde's 0.55 x 2.0.
 *
 * THE CONTROL IS THE WHOLE POINT OF THIS FILE. The same run is played twice:
 * once with the field and once with `ctx.flowHeavy` removed, which is exactly
 * the behaviour that shipped before. If the second run also arrives then the
 * route is not what delivered the god and this test is measuring nothing - the
 * map is simply open enough that the straight line works, and the check would
 * pass forever regardless of whether the field existed. Three separate defects
 * this week passed a green harness for precisely that reason, so the control
 * runs in the same process, on the same route, and is asserted to FAIL.
 *
 * The route is the Star Shaft to the Hall of Offerings: diagonally across the
 * whole interior, Act 3 to the entry band, and the bearing between the two ends
 * passes through several rooms' worth of stone. An earlier draft ran the King's
 * Chamber to the Great Gallery and the CONTROL PASSED - those two are stacked
 * almost straight up x 0, so the straight line walks it unaided and the run
 * proved nothing. That is the failure this file's control exists to expose, and
 * it exposed it here first.
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

  // The player stands in the Hall of Offerings and never moves, so every metre
  // the god closes is the god's own doing.
  const PLAYER = { x: -37, z: -149 };
  // The Star Shaft, at the east end of Act 3. Reaching the player from here means
  // the gallery doorway, the length of the gallery, and then the hall doorway.
  const START = { x: 27, z: -214 };
  const SECONDS = 60;
  const dt = 1 / 60;

  function openEverything() {
    for (const d of g.doors.all) {
      if (d.open) d.open();
      for (let i = 0; i < 400 && !d.opened; i++) if (d.advance) d.advance(1 / 30);
    }
  }

  /**
   * Run one god from the Star Shaft and report how it did.
   *
   * @param {boolean} withField  false removes ctx.flowHeavy for the whole run,
   *                             which is the behaviour that shipped before.
   */
  async function run(withField) {
    g.director.reset();
    g.spaces.enter('interior', { x: PLAYER.x, z: PLAYER.z, rot: 0 });
    openEverything();
    await new Promise((r) => requestAnimationFrame(r));

    g.player.position.x = PLAYER.x;
    g.player.position.z = PLAYER.z;

    g.director.forceWave(5);
    // Pump until the god exists. forceWave queues it rather than placing it.
    let clock = 0;
    for (let i = 0; i < 600 && !g.director.boss; i++) {
      clock += dt;
      g.director.update(dt, clock);
    }
    const boss = g.director.boss;
    if (!boss) return { fatal: 'no boss spawned on wave five' };

    const saved = g.director.ctx.flowHeavy;
    if (!withField) g.director.ctx.flowHeavy = null;

    boss.position.x = START.x;
    boss.position.z = START.z;
    // Its own state must agree with where it now is, or the first frame reads a
    // feet height from the room it was placed in.
    if (boss.st) { boss.st.vx = 0; boss.st.vz = 0; boss.st.routeX = 0; boss.st.routeZ = 0; }

    const start = Math.hypot(boss.position.x - PLAYER.x, boss.position.z - PLAYER.z);
    let best = start;
    let stalledFrames = 0;
    let lastX = boss.position.x, lastZ = boss.position.z;
    let travelled = 0;
    let sampled = 0;

    const frames = Math.round(SECONDS / dt);
    for (let i = 0; i < frames; i++) {
      clock += dt;
      // The player is pinned. A god that arrives because the player drifted
      // toward it has not routed anywhere.
      g.player.position.x = PLAYER.x;
      g.player.position.z = PLAYER.z;
      g.director.update(dt, clock);
      if (!boss.live) break;

      const step = Math.hypot(boss.position.x - lastX, boss.position.z - lastZ);
      travelled += step;
      if (step < 0.002) stalledFrames++;
      lastX = boss.position.x; lastZ = boss.position.z;

      const d = Math.hypot(boss.position.x - PLAYER.x, boss.position.z - PLAYER.z);
      if (d < best) best = d;
      if (withField && g.director.flowHeavy && g.director.flowHeavy.valid) sampled++;
    }

    const heavy = g.director.flowHeavy ? g.director.flowHeavy.stats() : null;
    g.director.ctx.flowHeavy = saved;

    return {
      withField,
      start: +start.toFixed(2),
      closest: +best.toFixed(2),
      closed: +(start - best).toFixed(2),
      travelled: +travelled.toFixed(1),
      stalledPct: Math.round((stalledFrames / frames) * 100),
      framesWithField: sampled,
      endRoom: g.spaces.roomAt ? g.spaces.roomAt(boss.position.x, boss.position.z) : null,
      heavy: heavy && { name: heavy.name, pad: heavy.pad, bodyH: heavy.bodyH, visited: heavy.visited, meanMs: heavy.meanMs },
    };
  }

  const routed = await run(true);
  const control = await run(false);
  return { routed, control };
});

if (out.fatal) { console.log(`FATAL  ${out.fatal}`); await browser.close(); process.exit(1); }

const R = out.routed, C = out.control;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

const show = (r, label) => {
  console.log(`  ${label.padEnd(22)}start ${String(r.start).padStart(6)}  closest ${String(r.closest).padStart(6)}`
    + `  closed ${String(r.closed).padStart(6)}  walked ${String(r.travelled).padStart(6)}  stalled ${r.stalledPct}%`);
};

console.log('the Star Shaft to the Hall of Offerings, 60 simulated seconds, player pinned:');
show(R, 'with the god field');
show(C, 'CONTROL, no field');
if (R.heavy) console.log(`\n  field: ${R.heavy.name}  carved ${R.heavy.pad} x ${R.heavy.bodyH}`
  + `  visited ${R.heavy.visited} slots  mean ${R.heavy.meanMs} ms`);
console.log('');

ok(R.heavy && R.heavy.name === 'god', 'the god reads a field carved for a god, not the horde\'s');
ok(R.heavy && R.heavy.pad > 1.5, `that field is carved wide (${R.heavy && R.heavy.pad})`);
ok(R.heavy && R.heavy.visited > 100, `and it actually floods (${R.heavy && R.heavy.visited} slots)`);
ok(R.closed > 40, `the god crosses the map (closed ${R.closed} m of ${R.start})`);
ok(R.closest < 12, `and arrives at the player (closest ${R.closest} m)`);
ok(R.stalledPct < 35, `without grinding on stone (stalled ${R.stalledPct}% of frames)`);

// THE CONTROL. If this passes, the field is not what delivered the god.
ok(C.closed < R.closed - 15,
  `CONTROL: without the field it does markedly worse (${C.closed} m vs ${R.closed} m)`);
ok(errors.length === 0, 'no console errors');
if (errors.length) for (const e of errors.slice(0, 4)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
