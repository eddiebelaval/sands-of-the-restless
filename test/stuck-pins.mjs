/**
 * RE-WALK A FIXED LIST OF COORDINATES ON REAL FRAMES. The A/B instrument.
 *
 * `test/stuck.mjs` finds stuck places. It cannot compare a fix against a
 * baseline, because its own clustering picks which points to confirm and a code
 * change moves that choice - a run that reports twelve different coordinates
 * before and after has measured two different things and can prove nothing.
 *
 * So this takes the coordinates as an argument and only ever walks those. Same
 * points, same eight directions, same real KeyboardEvents through main.js's own
 * binding table, before and after. The only variable is the code.
 *
 *   node test/stuck-pins.mjs pins.json
 *
 * where pins.json is [{ region, x, z }, ...]. It also reports WHY a point is
 * bad rather than only that it is: the per-frame displacement of the first
 * blocked direction, which separates a body being held still from a body
 * oscillating in place, and the collider census at the settled position.
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolveChrome } from './chrome.mjs';

const PINS = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const LABEL = process.argv[3] || 'run';
const BASE = process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/**
 * SPEED, NOT DISTANCE, AND THIS IS THE WHOLE INSTRUMENT.
 *
 * The first version of this file walked a fixed 30 real frames and compared the
 * DISTANCE. Under swiftshader a frame is anywhere from 100 ms to 1.7 s, so
 * thirty frames is between three and fifty seconds of walking and two runs of
 * the same code on the same point returned 0 and 35.24 m. Neither number was
 * wrong; they were answers to different questions.
 *
 * So the walk is timed and the verdict is a SPEED. A body that cannot move
 * reads near zero however long the frames take, and a body that walks normally
 * reads near WALK_SPEED whether that took two seconds or twenty.
 */
const STUCK_MPS = 0.35;      // walk is 5.4 m/s; this is under 7% of it
const WALK_MS = 1600;        // how long each direction is held, in wall clock

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1500);

await page.evaluate(async () => {
  const g = window.__SANDS__;
  for (const c of g.courtyard.claims) {
    if (c.open) c.open();
    for (let i = 0; i < 400 && !c.opened; i++) if (c.advance) c.advance(1 / 30);
  }
});

const rows = [];
for (const pin of PINS) {
  const r = await page.evaluate(async (p) => {
    const g = window.__SANDS__;
    const world = g.world;
    const RADIUS = 0.42, EYE = 1.68;

    const frames = async (n) => {
      for (let i = 0; i < n; i++) await new Promise((res) => requestAnimationFrame(res));
    };

    const settle = () => {
      const y = world.heightAt ? world.heightAt(p.x, p.z) : 0;
      g.player.teleport({ x: p.x, y, z: p.z });
      for (let i = 0; i < 60; i++) {
        g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
        if (g.player.state.grounded) break;
      }
    };

    settle();
    await frames(4);
    const settled = {
      x: +g.player.position.x.toFixed(2),
      y: +g.player.position.y.toFixed(2),
      z: +g.player.position.z.toFixed(2),
      grounded: g.player.state.grounded,
    };

    // Census at where the body actually ENDED UP, not where it was asked to go.
    const feet = settled.y - EYE;
    const census = [];
    for (const c of world.colliders) {
      const base = c.y0 === undefined ? (world.heightAt ? world.heightAt(settled.x, settled.z) : 0) : c.y0;
      if (feet - base > c.h) continue;
      if (base - feet > EYE) continue;
      const d = Math.hypot(settled.x - c.x, settled.z - c.z);
      if (d < c.r + RADIUS) census.push({ r: +c.r.toFixed(2), d: +d.toFixed(2), ov: +(c.r + RADIUS - d).toFixed(2) });
    }

    const per = [];
    let best = 0, trace = null, frames0 = 0, secs0 = 0;
    for (let i = 0; i < 8; i++) {
      settle();
      await frames(2);
      const a = (i / 8) * Math.PI * 2;
      const dx = Math.sin(a), dz = -Math.cos(a);
      g.rig.reset(Math.atan2(-dx, -dz), -0.02);
      g.rig.update(1 / 60, g.player, false);

      const p0 = { x: g.player.position.x, z: g.player.position.z };
      const steps = [];
      const t0 = performance.now();
      let fr = 0;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
      while (performance.now() - t0 < p.walkMs) {
        await new Promise((res) => requestAnimationFrame(res));
        fr++;
        if (i === 0) steps.push(+Math.hypot(g.player.position.x - p0.x, g.player.position.z - p0.z).toFixed(3));
      }
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
      const secs = (performance.now() - t0) / 1000;
      await frames(2);

      const d = Math.hypot(g.player.position.x - p0.x, g.player.position.z - p0.z);
      const mps = d / secs;
      per.push(+mps.toFixed(2));
      best = Math.max(best, mps);
      if (i === 0) { trace = steps.filter((_, k) => k % 4 === 0); frames0 = fr; secs0 = +secs.toFixed(2); }
    }

    return { settled, census, per, best: +best.toFixed(2), trace, frames0, secs0 };
  }, { ...pin, walkMs: WALK_MS });

  rows.push({ ...pin, ...r, exits: r.per.filter((m) => m > STUCK_MPS).length });
}

writeFileSync(`${OUT}stuck-pins-${LABEL}.json`, JSON.stringify({ label: LABEL, rows, errors }, null, 1));

console.log(`PINNED WALK  [${LABEL}]   ${rows.length} points, 8 real-key directions, ${WALK_MS} ms each`);
console.log(`stuck below ${STUCK_MPS} m/s   (walk speed is 5.4 m/s)`);
console.log('');
console.log('region   x         z       m/s     exits  cyl  frames  verdict');
for (const r of rows) {
  const v = r.best <= STUCK_MPS ? 'STUCK' : (r.exits < 3 ? 'pocket' : 'ok');
  console.log(
    `${r.region.padEnd(8)} ${String(r.x).padStart(7)}  ${String(r.z).padStart(7)}  ` +
    `${String(r.best).padStart(6)}   ${String(r.exits).padStart(2)}/8   ${String(r.census.length).padStart(2)}  ${String(r.frames0).padStart(5)}   ${v}`
  );
}
const stuck = rows.filter((r) => r.best <= STUCK_MPS).length;
console.log('');
console.log(`STUCK ${stuck} of ${rows.length}`);
if (errors.length) console.log(`errors: ${errors.slice(0, 2).join(' / ')}`);

await browser.close();
