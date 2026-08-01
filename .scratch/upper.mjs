/**
 * Does the field describe the gallery's UPPER level, and can it route between
 * the two storeys? Asked at explicit heights, because the whole question is
 * which floor a point is on.
 */

import { chromium } from 'playwright';
import { resolveChrome } from '../test/chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4931/index.html';

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

const out = await page.evaluate(() => {
  const g = window.__SANDS__;
  const d = g.director;
  g.spaces.enter('interior', { x: 0, z: 60, rot: 0 });
  for (const b of g.spaces.interior.barriers) b.clearInstantly();
  for (let i = 0; i < 4; i++) d.update(1 / 30, i / 30);

  const probe = (hx, hz, hy) => {
    g.player.teleport({ x: hx, y: hy, z: hz });
    g.rig.reset(0, -0.02);
    const st = d.refreshFlow();
    // Points on the gallery upper ring, and their matching ground points.
    const pts = [
      ['east ledge  (24,-193)', 24, -193, 6],
      ['east ledge  (21,-180)', 21, -180, 6],
      ['east ramp   (21,-166)', 21, -166, 3.0],
      ['bridge      (8,-189)', 8, -189, 6],
      ['bridge      (-8,-189)', -8, -189, 6],
      ['west ledge  (-21,-180)', -21, -180, 6],
      ['west ramp   (-21,-166)', -21, -166, 3.0],
      ['floor N     (0,-165)', 0, -165, 0],
      ['floor S     (8,-193)', 8, -193, 0],
      ['floor W     (-24,-180)', -24, -180, 0],
    ];
    return {
      from: [hx, hz, hy],
      floorHere: g.world.heightAt(hx, hz, hy),
      st,
      rows: pts.map(([n, x, z, y]) => ({
        n,
        y,
        surface: g.world.heightAt(x, z, y),
        route: +d.flow.costAt(x, z, y).toFixed(1),
      })),
    };
  };

  return [probe(-24, -193, 0), probe(0, -189, 6)];
});

for (const r of out) {
  console.log(`\n=== player at (${r.from[0]}, ${r.from[1]}) feet ${r.from[2]}  surface under them ${r.floorHere} ===`);
  console.log(`  visited ${r.st.visited} slots / ${r.st.cells} cells   layered ${r.st.layered}  layersFull ${r.st.layersFull}   ${r.st.lastMs} ms`);
  for (const p of r.rows) {
    console.log(`   ${p.n.padEnd(24)} askedAt y=${String(p.y).padEnd(4)} surface ${String(p.surface).padEnd(6)} route ${p.route < 0 ? 'NO ROUTE' : p.route + ' m'}`);
  }
}
console.log('\nerrors', logs.slice(0, 5));
await browser.close();
