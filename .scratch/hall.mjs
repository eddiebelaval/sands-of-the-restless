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
  const near = [];
  for (const c of g.world.colliders) {
    const dx = c.x + 46, dz = c.z + 154;
    const r = Math.hypot(dx, dz);
    if (r < 4) near.push({ x:+c.x.toFixed(1), z:+c.z.toFixed(1), r:+c.r.toFixed(2), h:c.h, gap:+(r - c.r).toFixed(2) });
  }
  near.sort((a,b)=>a.gap-b.gap);
  // Does the DIRECTOR itself consider this a usable spawn point?
  const used = d.stats().spawnPoints;
  return { nearestColliders: near.slice(0,6), directorSpawnPoints: used,
           // widest disc that fits at the point
           fits: [0.37, 0.45, 0.55, 0.7].map(p => ({ pad: p, clear: near.every(c => c.gap > p) })) };
}), null, 2));
await browser.close();
