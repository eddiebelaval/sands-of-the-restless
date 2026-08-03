/**
 * IS IT A TRAP, OR IS IT JUST SOLID?
 *
 * `test/stuck.mjs` finds places the body cannot walk out of. That is only half a
 * bug report. The inside of a rock face is a place you cannot walk out of and it
 * is not a defect - it is a rock. What makes a stuck place a DEFECT is that a
 * player can get INTO it.
 *
 * Two of the five confirmed stuck areas in the exterior sit past authored
 * boundaries: `quarry x41` is beyond `QUARRY.faceX` 39.6, and `canal x-45.8` is
 * beyond `CANAL.wallX` -45. Reporting those as bugs would send the map lane to
 * fix stone for being stone.
 *
 * So this walks AT each one from open ground nearby, and then tries to walk back
 * out. Three outcomes, and only the third is worth anyone's time:
 *
 *   UNREACHABLE  the approach never gets near it. Solid geometry doing its job.
 *   PASSES       it gets there and leaves again. Not a trap.
 *   TRAP         it gets in and cannot get out. THE BUG.
 *
 * Everything is REAL KeyboardEvents on REAL frames through main.js's own binding
 * table, and the yaw that moves the body is the one handed to update() rather
 * than the one set on the rig - a distinction that invalidated three earlier
 * harnesses in this investigation before it was noticed.
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolveChrome } from './chrome.mjs';

const CASES = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** How close to the target counts as having got there. */
const ARRIVED_M = 1.6;
/** Escape speed floor, as a fraction of the run's own control speed. */
const ESCAPE_FRACTION = 0.25;
/*
 * APPROACH AND ESCAPE ARE TIMED SEPARATELY, and the approach is long.
 *
 * The first run of this file gave both 2000 ms and declared all five targets
 * UNREACHABLE with four to six metres still to go. Under swiftshader the
 * effective walk is around 0.55 m/s of wall clock, so two seconds buys about a
 * metre - the bodies were not blocked, they simply had not arrived yet. An
 * approach that cannot cross the gap cannot report anything about the gap.
 *
 * Twenty seconds covers roughly eleven metres at that rate, against approach
 * vectors of six to seven. The escape stays short because a body that is going
 * to move at all moves immediately.
 */
const APPROACH_MS = 20000;
const ESCAPE_MS = 3000;

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  for (const c of window.__SANDS__.courtyard.claims) {
    if (c.open) c.open();
    for (let i = 0; i < 400 && !c.opened; i++) if (c.advance) c.advance(1 / 30);
  }
});

await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__T__ = {
    async frames(n) { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); },

    settle(x, z) {
      const y = g.world.heightAt ? g.world.heightAt(x, z) : 0;
      g.player.teleport({ x, y, z });
      for (let i = 0; i < 60; i++) {
        g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
        if (g.player.state.grounded) break;
      }
    },

    /** Hold W toward a yaw for ms of wall clock. Returns metres per second. */
    async push(yaw, ms) {
      g.rig.reset(yaw, -0.02);
      g.rig.update(1 / 60, g.player, false);
      const p0 = { x: g.player.position.x, z: g.player.position.z };
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
      while (performance.now() - t0 < ms) await new Promise((r) => requestAnimationFrame(r));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
      const secs = (performance.now() - t0) / 1000;
      await window.__T__.frames(2);
      const d = Math.hypot(g.player.position.x - p0.x, g.player.position.z - p0.z);
      return { mps: d / secs, end: { x: +g.player.position.x.toFixed(2), z: +g.player.position.z.toFixed(2) } };
    },

    /** Yaw that faces from (fx,fz) toward (tx,tz). forward = (-sin, -cos). */
    yawTo(fx, fz, tx, tz) { return Math.atan2(-(tx - fx), -(tz - fz)); },
  };
});

// The control: ordinary open ground, walked the same way, in this same run.
// Every speed below is judged against it rather than against a fixed constant,
// because a swiftshader frame is worth an unpredictable amount of simulated time.
const control = await page.evaluate(async (ms) => {
  window.__T__.settle(30, 5);
  await window.__T__.frames(4);
  let best = 0;
  for (let i = 0; i < 4; i++) {
    window.__T__.settle(30, 5);
    await window.__T__.frames(2);
    const r = await window.__T__.push((i / 4) * Math.PI * 2, ms);
    best = Math.max(best, r.mps);
  }
  return +best.toFixed(2);
}, ESCAPE_MS);

const rows = [];
for (const c of CASES) {
  const r = await page.evaluate(async (cfg) => {
    const g = window.__SANDS__;
    const T = window.__T__;

    // 1. APPROACH. Stand at the start and walk straight at the target.
    T.settle(cfg.from.x, cfg.from.z);
    await T.frames(4);
    const start = { x: +g.player.position.x.toFixed(2), z: +g.player.position.z.toFixed(2) };
    const approach = await T.push(T.yawTo(start.x, start.z, cfg.x, cfg.z), cfg.approachMs);
    const arrivedAt = approach.end;
    const gap = Math.hypot(arrivedAt.x - cfg.x, arrivedAt.z - cfg.z);

    // 2. ESCAPE. From wherever the approach actually ended, try all eight.
    const escapes = [];
    for (let i = 0; i < 8; i++) {
      g.player.position.x = arrivedAt.x;
      g.player.position.z = arrivedAt.z;
      g.player.velocity.set(0, 0, 0);
      for (let k = 0; k < 20; k++) {
        g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
      }
      await T.frames(2);
      const a = (i / 8) * Math.PI * 2;
      const e = await T.push(Math.atan2(-Math.sin(a), Math.cos(a)), cfg.escapeMs);
      escapes.push(+e.mps.toFixed(2));
    }

    return { start, approachMps: +approach.mps.toFixed(2), arrivedAt, gap: +gap.toFixed(2), escapes };
  }, { ...c, approachMs: APPROACH_MS, escapeMs: ESCAPE_MS });

  const floor = control * ESCAPE_FRACTION;
  const arrived = r.gap <= ARRIVED_M;
  const bestEscape = Math.max(...r.escapes);
  const verdict = !arrived ? 'UNREACHABLE' : (bestEscape <= floor ? 'TRAP' : 'passes');
  rows.push({ ...c, ...r, arrived, bestEscape, verdict });
}

writeFileSync(`${OUT}stuck-trap.json`, JSON.stringify({ control, floor: control * ESCAPE_FRACTION, rows, errors }, null, 1));

console.log(`TRAP TEST    control walk ${control} m/s, escape floor ${(control * ESCAPE_FRACTION).toFixed(2)} m/s, approach ${APPROACH_MS} ms`);
console.log('');
console.log('region   target            approach  landed          gap   escape   verdict');
for (const r of rows) {
  console.log(
    `${r.region.padEnd(8)} ${`${r.x},${r.z}`.padEnd(16)}  ${String(r.approachMps).padStart(6)}   ` +
    `${`${r.arrivedAt.x},${r.arrivedAt.z}`.padEnd(15)} ${String(r.gap).padStart(5)}  ` +
    `${String(r.bestEscape).padStart(6)}   ${r.verdict}`
  );
}
console.log('');
const traps = rows.filter((r) => r.verdict === 'TRAP');
console.log(`TRAPS ${traps.length} of ${rows.length}   (unreachable ${rows.filter((r) => r.verdict === 'UNREACHABLE').length}, passes ${rows.filter((r) => r.verdict === 'passes').length})`);
if (errors.length) console.log(`errors: ${errors.slice(0, 2).join(' / ')}`);

await browser.close();
