/**
 * Screenshot + console harness.
 *
 * Boots the game in a real Chromium with WebGL, drives it for a moment, and
 * writes PNGs plus a console log. This is the pass that catches "it loads but
 * renders nothing", which a syntax check never will.
 *
 * Usage: node test/shot.mjs [baseUrl]
 */

import { chromium } from '/Users/eddiebelaval/Development/.worktrees/parallax-hotfix-realtime/node_modules/playwright/index.mjs';
import { resolveChrome } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// The bundled playwright build and the installed browser revisions do not
// always line up, so point at a real Chrome for Testing binary explicitly and
// let CHROME_BIN override it.
const CHROME = resolveChrome();

const browser = await chromium.launch({
  executablePath: CHROME,
  args: [
    // Software WebGL so this works headless on any machine, including CI.
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2500);   // texture generation + first frames

await page.screenshot({ path: OUT + '01-title.png' });

// Enter the game.
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1800);
await page.screenshot({ path: OUT + '02-courtyard.png' });

// Look around and walk, to prove the controller and colliders work.
const probe = await page.evaluate(async () => {
  const g = window.__SANDS__;
  if (!g) return { error: 'game did not expose __SANDS__' };

  const before = g.player.position.clone();

  // Drive the simulation directly rather than faking input events, so the
  // result is deterministic regardless of pointer lock.
  g.rig.look(-900, 0);              // turn to face down the colonnade
  for (let i = 0; i < 120; i++) {
    g.player.update(1 / 60, { forward: 1, strafe: 0, sprint: true, jump: false }, g.rig.yaw);
  }

  const after = g.player.position.clone();

  return {
    moved: +before.distanceTo(after).toFixed(2),
    from: [+before.x.toFixed(1), +before.z.toFixed(1)],
    to: [+after.x.toFixed(1), +after.z.toFixed(1)],
    y: +after.y.toFixed(2),
    grounded: g.player.state.grounded,
    speed: +g.player.state.speed.toFixed(2),
    colliders: g.world.colliders.length,
    sceneChildren: g.scene.children.length,
    fov: +g.camera.fov.toFixed(1),
  };
});

await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '03-walked.png' });

// Low fidelity pass.
await page.evaluate(() => window.__SANDS__.setFidelity(false));
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + '04-low-fidelity.png' });

// Frame timing at high fidelity.
await page.evaluate(() => window.__SANDS__.setFidelity(true));
await page.waitForTimeout(500);
const timing = await page.evaluate(() => new Promise((resolve) => {
  const samples = [];
  let last = performance.now();
  let n = 0;
  const tick = () => {
    const now = performance.now();
    samples.push(now - last);
    last = now;
    if (++n < 90) requestAnimationFrame(tick);
    else {
      samples.sort((a, b) => a - b);
      resolve({
        medianMs: +samples[Math.floor(samples.length / 2)].toFixed(2),
        p95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(2),
      });
    }
  };
  requestAnimationFrame(tick);
}));

// --- did we actually render a world? ------------------------------------
//
// A harness that reports PASS on a black frame is worse than no harness: it
// converts "I broke rendering" into "tests are green". This caught nothing when
// the viewmodel pass wiped the colour buffer every frame, because zero console
// errors is perfectly compatible with zero pixels.
const frame = await page.evaluate(() => {
  const c = window.__SANDS__.renderer.domElement;
  const sc = document.createElement('canvas');
  sc.width = c.width; sc.height = c.height;
  const ctx = sc.getContext('2d', { willReadFrequently: true });

  return new Promise((resolve) => requestAnimationFrame(() => {
    ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(0, 0, sc.width, sc.height).data;

    let sum = 0, n = 0, lit = 0;
    // Sample the upper two thirds only: the lower third is the weapon, which
    // renders even when the world does not, and would mask exactly this bug.
    const rows = Math.floor(sc.height * 0.66);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < sc.width; x += 4) {
        const i = (y * sc.width + x) * 4;
        const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
        sum += l; n++;
        if (l > 12) lit++;
      }
    }
    resolve({ meanLuma: +(sum / n).toFixed(2), percentLit: +((lit / n) * 100).toFixed(1) });
  }));
});

await browser.close();

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));

// Warnings are NOT noise. A three.js deprecation warning is how RGBELoader
// being a shim went unnoticed for an entire session: the harness filtered for
// errors only, and the one line telling us so was thrown away.
const IGNORABLE = [
  /GPU stall due to ReadPixels/,      // swiftshader only, not a real issue
  /GL Driver Message/,
];
const warnings = logs
  .filter((l) => l.startsWith('[warning]'))
  .filter((l) => !IGNORABLE.some((re) => re.test(l)));

console.log('--- probe ---');
console.log(JSON.stringify(probe, null, 2));
console.log('--- frame timing (swiftshader, not representative of GPU) ---');
console.log(JSON.stringify(timing, null, 2));
console.log('--- console ---');
for (const l of logs) console.log(l);
console.log(`\nshots -> ${OUT}`);
if (warnings.length) {
  console.log('--- warnings (not ignorable) ---');
  for (const w of warnings) console.log(w);
}

// A real frame of this game is a sunlit desert. Anything under these floors
// means the world did not draw.
const blackFrame = frame.meanLuma < 25 || frame.percentLit < 60;

console.log('--- frame content ---');
console.log(JSON.stringify(frame, null, 2));
if (blackFrame) {
  console.log('FAIL: the world did not render (black or near-black frame)');
}

const bad = errors.length + warnings.length + (blackFrame ? 1 : 0);
console.log(bad
  ? `FAIL: ${errors.length} error(s), ${warnings.length} warning(s)${blackFrame ? ', black frame' : ''}`
  : 'PASS: world rendered, no console errors or warnings');

process.exit(bad ? 1 : 0);
