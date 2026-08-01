/**
 * Trace one actor: where it is, what the field told it, and where it went.
 */

import { chromium } from 'playwright';
import { resolveChrome } from '../test/chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4931/index.html';
const AX = +(process.argv[3] ?? 24), AZ = +(process.argv[4] ?? -193);
const HX = +(process.argv[5] ?? -24), HZ = +(process.argv[6] ?? -193);

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const logs = [];
page.on('pageerror', (e) => logs.push(e.message));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1400);

const out = await page.evaluate(([ax, az, hx, hz]) => {
  const g = window.__SANDS__;
  const d = g.director;
  g.spaces.enter('interior', { x: 0, z: 60, rot: 0 });
  for (const b of g.spaces.interior.barriers) b.clearInstantly();
  for (let i = 0; i < 4; i++) d.update(1 / 30, i / 30);

  d.reset();
  g.player.teleport({ x: hx, y: 0, z: hz });
  g.rig.reset(0, -0.02);
  const a = d.placeAt('shambler', ax, az);
  const rows = [];
  const o = { x: 0, z: 0 };
  const dt = 1 / 30;
  let lx = a.position.x, lz = a.position.z;
  for (let i = 0; i < Math.ceil(45 / dt); i++) {
    d.update(dt, i * dt);
    g.combat.update(dt);
    if (!a.live) break;
    if (i % 30 === 0) {
      const fy = a.position.y;
      const ok = d.flow.sample(a.position.x, a.position.z, fy, o);
      rows.push({
        t: +(i * dt).toFixed(1),
        p: [+a.position.x.toFixed(2), +a.position.z.toFixed(2)],
        y: +fy.toFixed(2),
        routeUp: +d.flow.costAt(a.position.x, a.position.z, fy).toFixed(1),
        dist: +Math.hypot(a.position.x - hx, a.position.z - hz).toFixed(1),
        route: +d.flow.costAt(a.position.x, a.position.z, 0).toFixed(1),
        fieldOK: ok,
        fdir: ok ? [+o.x.toFixed(2), +o.z.toFixed(2)] : null,
        moved1s: +Math.hypot(a.position.x - lx, a.position.z - lz).toFixed(2),
      });
      lx = a.position.x; lz = a.position.z;
    }
  }
  return { rows, stats: d.stats().flow };
}, [AX, AZ, HX, HZ]);

console.log(`actor (${AX},${AZ}) -> player (${HX},${HZ})`);
for (const r of out.rows) {
  console.log(`t=${String(r.t).padStart(5)}  p=${JSON.stringify(r.p).padEnd(18)} y=${String(r.y).padStart(5)}  dist ${String(r.dist).padStart(5)}  routeGnd ${String(r.route).padStart(6)}  routeFeet ${String(r.routeUp).padStart(6)}  field ${r.fieldOK ? JSON.stringify(r.fdir) : 'NONE      '}  moved/s ${r.moved1s}`);
}
console.log(JSON.stringify(out.stats));
console.log('errors', logs.slice(0, 5));
await browser.close();
