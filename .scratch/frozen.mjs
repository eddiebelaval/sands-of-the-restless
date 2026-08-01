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
  d.reset();
  g.player.teleport({ x: -24, y: 0, z: -193 }); g.rig.reset(0,-0.02);
  const a = d.placeAt('shambler', -34, -155);
  const dt = 1/30;
  const rows = [];
  for (let i = 0; i < Math.ceil(20/dt); i++) {
    d.update(dt, i*dt);
    g.combat.update(dt);
    if (i % 60 === 0 || (i > 380 && i % 10 === 0 && rows.length < 24)) {
      rows.push({ t:+(i*dt).toFixed(2), p:[+a.position.x.toFixed(2),+a.position.y.toFixed(2),+a.position.z.toFixed(2)],
        keys: a.st ? Object.keys(a.st).length : null,
        v: a.st ? [+a.st.vx.toFixed(3), +a.st.vz.toFixed(3)] : null,
        vy: a.st ? +a.st.vy.toFixed(2) : null,
        grounded: a.st ? a.st.grounded : null,
        wedge: a.st ? +a.st.wedge.toFixed(2) : null,
        detour: a.st ? +a.st.detour.toFixed(2) : null,
        side: a.st ? a.st.detourSide : null,
        stagger: a.st ? +a.st.stagger.toFixed(2) : null,
      });
    }
  }
  return rows;
}), null, 2));
await browser.close();
