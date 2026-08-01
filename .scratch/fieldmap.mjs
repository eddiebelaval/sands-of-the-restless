/**
 * Print the field as a picture. The fastest way to see what a flood actually
 * reached, as opposed to what it was supposed to reach.
 */

import { chromium } from 'playwright';
import { resolveChrome } from '../test/chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4931/index.html';
const HX = +(process.argv[3] ?? 0);
const HZ = +(process.argv[4] ?? -170);

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

const out = await page.evaluate(([hx, hz]) => {
  const g = window.__SANDS__;
  const d = g.director;
  g.spaces.enter('interior', { x: 0, z: 60, rot: 0 });
  for (const b of g.spaces.interior.barriers) b.clearInstantly();
  for (let i = 0; i < 4; i++) d.update(1 / 30, i / 30);

  g.player.teleport({ x: hx, y: 0, z: hz });
  g.rig.reset(0, -0.02);
  const st = d.refreshFlow();

  // The same clearance test the field runs, reimplemented from the exposed
  // world so a blocked cell can be attributed to the thing that blocked it.
  const PAD = 0.55, BODY_H = 2.0;
  function blockers(x, z, floorY) {
    const hits = [];
    for (const w of (g.world.walls || [])) {
      if (floorY + BODY_H <= w.y0 || floorY >= w.y1) continue;
      if (Math.abs(x - w.x) < w.w / 2 + PAD && Math.abs(z - w.z) < w.d / 2 + PAD) {
        hits.push(`wall(${w.x},${w.z} ${w.w}x${w.d} y${w.y0}..${w.y1})`);
      }
    }
    for (const c of g.world.colliders) {
      const base = c.y0 === undefined ? g.world.heightAt(c.x, c.z, floorY) : c.y0;
      if (floorY - base > c.h) continue;
      const dx = x - c.x, dz = z - c.z;
      const want = c.r + PAD;
      if (dx * dx + dz * dz < want * want) hits.push(`disc(${c.x.toFixed(1)},${c.z.toFixed(1)} r${c.r} h${c.h} y0=${c.y0})`);
    }
    return hits;
  }

  // ASCII over the gallery and its south neighbours.
  const rows = [];
  for (let z = -160; z >= -235; z -= 1.5) {
    let line = '';
    for (let x = -50; x <= 50; x += 1.5) {
      const c = d.flow.costAt(x, z, 0);
      if (c >= 0) line += (c < 10 ? '.' : c < 30 ? ':' : c < 60 ? '+' : '#');
      else line += blockers(x, z, 0).length ? 'X' : ' ';
    }
    rows.push(`${String(Math.round(z)).padStart(5)} ${line}`);
  }

  // Attribute a few specific dead points.
  const probes = [[0, -190], [0, -193], [0, -196], [-20, -196], [0, -186], [0, -188]];
  const attributed = probes.map(([x, z]) => ({
    at: [x, z],
    route: +d.flow.costAt(x, z, 0).toFixed(1),
    floor: g.world.heightAt(x, z, 0),
    by: blockers(x, z, 0).slice(0, 4),
  }));

  return { st, rows, attributed };
}, [HX, HZ]);

console.log(`field at (${HX}, ${HZ}): visited ${out.st.visited}/${out.st.cells}, ${out.st.lastMs} ms`);
console.log('  legend: . <10m  : <30m  + <60m  # >=60m   X solid   (blank) open but unreached');
console.log('    z     x=-50 ........................................ x=+50');
for (const r of out.rows) console.log(r);
console.log('');
for (const a of out.attributed) console.log(JSON.stringify(a));
console.log('errors', logs.slice(0, 5));
await browser.close();
