/**
 * Act 1 capture: photograph the two new spaces, plus a flat-colour mask plan.
 *
 * The mask pass is the one that has to exist. This project's defining bug class
 * is geometry that was written and never rendered - wound inside out and culled,
 * modelled inside a solid, or claimed in a comment and never built at all - and
 * a beauty shot from inside a room proves only that the room is not empty at
 * that angle. The mask replaces every material with one flat unlit colour keyed
 * to which space the mesh belongs to, kills the fog, and looks straight down, so
 * "does the Quarry exist and where is it" is answered by counting red pixels
 * rather than by reading the file that was supposed to have built it.
 *
 * Usage: node test/act1shots.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/act1/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.evaluate(() => document.getElementById('begin').click());
await page.evaluate(async () => {
  for (let i = 0; i < 90; i++) await new Promise((r) => requestAnimationFrame(r));
});

// Open both claims and let the rubble finish sinking.
await page.evaluate(() => window.__SANDS__.courtyard.claims.forEach((c) => c.open()));
await page.evaluate(async () => {
  for (let i = 0; i < 120; i++) await new Promise((r) => requestAnimationFrame(r));
});

// Hide the HUD, which otherwise eats a third of every frame.
await page.addStyleTag({ content: '#hud,#readouts,#minimap,#objective,.hud{opacity:0 !important}' });

async function shot(name, x, y, z, yaw, pitch, fov) {
  await page.evaluate(({ x, y, z, yaw, pitch, fov }) => {
    const g = window.__SANDS__;
    g.player.position.set(x, y, z);
    g.camera.position.set(x, y, z);
    g.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    if (fov) { g.camera.fov = fov; g.camera.updateProjectionMatrix(); }
    g.camera.matrixAutoUpdate = false;
    g.camera.updateMatrix();
    g.camera.updateMatrixWorld(true);
  }, { x, y, z, yaw, pitch, fov });
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
  });
  await page.screenshot({ path: OUT + name + '.png' });
  await page.evaluate(() => { window.__SANDS__.camera.matrixAutoUpdate = true; });
}

// yaw convention: forward = (-sin y, 0, -cos y). 0 faces the pyramid (-z),
// -PI/2 faces east (+x), +PI/2 faces west (-x), PI faces the spawn end (+z).
const E = -Math.PI / 2, W = Math.PI / 2, S = 0, N = Math.PI;

const VIEWS = [
  ['20-avenue-east-gate', 6.0, 2.0, 20.0, -1.25, 0.0],
  ['21-quarry-looking-south', 19.0, 2.2, 25.0, S - 0.25, 0.03],
  ['22-quarry-blocks', 18.5, 2.2, 8.0, -0.55, 0.02],
  ['23-quarry-ramp-foot', 33.0, 2.0, -12.0, N - 0.1, 0.08],
  ['24-quarry-on-terrace', 35.0, 4.3, 14.0, S + 0.1, -0.02],
  ['25-quarry-terrace-side', 25.0, 2.2, -3.0, E + 0.25, 0.05],
  ['26-quarry-breach-inside', 24.0, 2.0, -13.5, W, 0.02],
  ['27-avenue-crossroads', 0.0, 2.0, -13.5, E, 0.0],
  ['28-canal-gate-from-avenue', -6.0, 2.0, -13.5, W, 0.0],
  ['29-canal-east-bank', -18.5, 2.0, -6.0, W - 0.35, -0.06],
  ['30-canal-in-channel', -32.0, -1.5, 14.0, S, 0.02],
  ['31-canal-under-causeway', -32.0, -1.5, 10.5, S, 0.10],
  ['32-canal-on-causeway', -25.0, 1.9, 7.0, W, -0.04],
  ['33-canal-from-west-slope', -38.0, -0.6, 2.0, E - 0.2, 0.02],
  ['34-forecourt-mass', 1.0, 2.0, -18.0, S + 0.2, 0.0],
  ['35-quarry-aerial', 27.0, 26.0, 30.0, S - 0.1, -0.75, 78],
  ['36-canal-aerial', -30.0, 26.0, 30.0, S + 0.12, -0.72, 78],
];

for (const v of VIEWS) await shot(...v);

/**
 * The mask pass. Flat unlit colour per space, no fog, straight down.
 */
const mask = await page.evaluate(() => {
  const g = window.__SANDS__;
  const T = g.THREE;

  g.scene.fog = null;
  g.scene.background = new T.Color(0x000000);

  const KEY = { quarry: 0xff2b2b, canal: 0x2b6bff };
  const OTHER = 0x3a3a3a;
  const swapped = [];

  const paint = (obj, colour) => {
    obj.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      swapped.push({ o, mat: o.material });
      o.material = new T.MeshBasicMaterial({ color: colour, fog: false });
    });
  };

  let named = 0;
  g.scene.traverse((o) => {
    if (KEY[o.name] !== undefined) { paint(o, KEY[o.name]); named++; }
  });

  // Everything else grey, but not over the top of what was just keyed.
  const keyed = new Set(swapped.map((s) => s.o));
  g.scene.traverse((o) => {
    if ((o.isMesh || o.isInstancedMesh) && !keyed.has(o)) {
      swapped.push({ o, mat: o.material });
      o.material = new T.MeshBasicMaterial({ color: OTHER, fog: false });
    }
  });

  return { namedGroups: named, meshesPainted: swapped.length };
});

await shot('40-mask-plan', -2.0, 118.0, 2.0, 0, -Math.PI / 2 + 0.001, 70);
await shot('41-mask-plan-tilt', -2.0, 96.0, 46.0, 0, -1.02, 70);

/** Count the red and blue, which is the claim the mask is being asked for. */
const counted = await page.evaluate(() => new Promise((resolve) => {
  const c = window.__SANDS__.renderer.domElement;
  const sc = document.createElement('canvas');
  sc.width = c.width; sc.height = c.height;
  const ctx = sc.getContext('2d', { willReadFrequently: true });
  requestAnimationFrame(() => {
    ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(0, 0, sc.width, sc.height).data;
    let red = 0, blue = 0, grey = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      n++;
      if (r > 120 && gg < 90 && b < 90) red++;
      else if (b > 120 && r < 90) blue++;
      else if (r > 30 && Math.abs(r - gg) < 14 && Math.abs(gg - b) < 14) grey++;
    }
    resolve({
      percentQuarry: +((red / n) * 100).toFixed(2),
      percentCanal: +((blue / n) * 100).toFixed(2),
      percentOther: +((grey / n) * 100).toFixed(2),
    });
  });
}));

await browser.close();

console.log('--- mask ---');
console.log(JSON.stringify(mask, null, 2));
console.log('--- mask plan pixel counts ---');
console.log(JSON.stringify(counted, null, 2));
console.log(`shots -> ${OUT}`);
const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
for (const l of errs) console.log(l);
console.log(errs.length ? `FAIL: ${errs.length} error(s)` : 'PASS: no console errors');
process.exit(errs.length ? 1 : 0);
