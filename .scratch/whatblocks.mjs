import { chromium } from 'playwright';
import { resolveChrome } from '../test/chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4931/index.html';
const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
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
  g.player.teleport({ x: -24, y: 0, z: -193 });
  g.rig.reset(0, -0.02);
  d.refreshFlow();

  const PAD = 0.55, BODY_H = 2.0;
  const why = (x, z, floorY) => {
    const hits = [];
    for (const w of (g.world.walls || [])) {
      if (floorY + BODY_H <= w.y0 || floorY >= w.y1) continue;
      if (Math.abs(x - w.x) < w.w / 2 + PAD && Math.abs(z - w.z) < w.d / 2 + PAD) {
        hits.push(`wall x${w.x} z${w.z} ${w.w}x${w.d} y${w.y0}..${w.y1}`);
      }
    }
    for (const c of g.world.colliders) {
      const base = c.y0 === undefined ? g.world.heightAt(c.x, c.z, floorY) : c.y0;
      if (floorY - base > c.h) continue;
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < (c.r + PAD) ** 2) hits.push(`disc x${c.x.toFixed(1)} z${c.z.toFixed(1)} r${c.r.toFixed(2)} h${c.h} y0=${c.y0}`);
    }
    return hits;
  };

  const rows = [];
  for (const x of [-25.5, -25, -24.5, -24, -23.5, -23, -22, -20, -18, -17, -16]) {
    const z = -163;
    const surf = g.world.heightAt(x, z, 1.55);
    rows.push({
      x, surf,
      routeAt155: +d.flow.costAt(x, z, 1.55).toFixed(1),
      routeAt0: +d.flow.costAt(x, z, 0).toFixed(1),
      blockedAtSurf: why(x, z, surf),
    });
  }
  return { rows, bounds: g.world.bounds };
});

console.log('slice z=-163, player at (-24,-193). ramp surface ~1.5 here.');
for (const r of out.rows) {
  console.log(`  x=${String(r.x).padStart(6)} surface ${String(r.surf).padEnd(6)} route@1.55 ${String(r.routeAt155).padStart(6)}  route@0 ${String(r.routeAt0).padStart(6)}  blocked: ${r.blockedAtSurf.join(' | ') || '-'}`);
}
await browser.close();
