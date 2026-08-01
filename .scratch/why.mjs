import { chromium } from 'playwright';
import { resolveChrome } from '../test/chrome.mjs';
const browser = await chromium.launch({ executablePath: resolveChrome(),
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto(process.argv[2], { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1400);
console.log(JSON.stringify(await page.evaluate(() => {
  const g = window.__SANDS__, d = g.director;
  g.spaces.enter('interior', { x: 0, z: 60, rot: 0 });
  for (const b of g.spaces.interior.barriers) b.clearInstantly();
  for (let i = 0; i < 4; i++) d.update(1/30, i/30);
  const probe = (x, z, feetY, pad) => {
    const out = { walls: [], discs: [] };
    for (const w of (g.world.walls || [])) {
      if (feetY + 2.0 <= w.y0 || feetY >= w.y1) continue;
      if (Math.abs(x - w.x) < w.w/2 + pad && Math.abs(z - w.z) < w.d/2 + pad)
        out.walls.push({ x:w.x, z:w.z, w:w.w, d:w.d, y0:w.y0, y1:w.y1 });
    }
    for (const c of g.world.colliders) {
      const base = c.y0 === undefined ? g.world.heightAt(c.x, c.z, feetY) : c.y0;
      if (feetY - base > c.h) continue;
      const dx = x - c.x, dz = z - c.z;
      if (dx*dx + dz*dz < (c.r + pad)**2)
        out.discs.push({ x:+c.x.toFixed(1), z:+c.z.toFixed(1), r:+c.r.toFixed(2), h:c.h, y0:c.y0, base:+base.toFixed(2) });
    }
    return out;
  };
  const pts = [[-22.63,-164.39],[-22.9,-165.1],[-23.2,-165.8],[-21.9,-163.7]];
  return pts.map(([x,z]) => ({
    at: [x,z], surface: g.world.heightAt(x,z,2.2),
    actorPad037: probe(x,z,2.2,0.37),
    fieldPad055: probe(x,z,2.2,0.55),
  }));
}), null, 2));
await browser.close();
