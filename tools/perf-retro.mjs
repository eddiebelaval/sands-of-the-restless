/**
 * WHAT PS1 MODE COSTS, AND WHAT IT BUYS, AT THREE FIXED POSES.
 *
 * `tools/perf.mjs` is the general instrument and everything in its header
 * applies here without repeating it: real GPU, no swiftshader, vsync disabled,
 * `renderer.info` read with autoReset off, median rather than mean. Read that
 * file first.
 *
 * This is the A/B that file cannot do. perf.mjs sweeps CONFIGURATIONS at ONE
 * pose, which is the right shape for "where inside the post chain is the money
 * going". The question here is different and needs a different shape: a render
 * MODE, measured at several places in the level, with the two halves of each
 * pair taken from the same page at the same position seconds apart. The owner's
 * actual problem is a MacBook that cannot run this, and the honest form of the
 * answer is the same scene twice.
 *
 * WHY THE GOVERNOR IS STOOD DOWN FIRST. core/governor.js watches the frame and
 * changes the settings underneath a measurement that is trying to hold them
 * still. Retro mode already stands it down - an explicit player choice ends the
 * automatic one, which is that file's own rule - so the only way to compare
 * like with like is to stand it down for the baseline too. Otherwise the
 * baseline row is measuring whatever rung the ladder happened to be on, which
 * is a different experiment on every machine and on every run.
 *
 * THIS TOOL DOES NOT ASSERT and must never be wired into `npm test`, for the
 * reason perf.mjs gives: a number that depends on what else the machine is
 * doing is a flaky gate, and a flaky gate gets ignored and then deleted.
 *
 * Usage: node tools/perf-retro.mjs [baseUrl] [--frames N]
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { resolveChrome } from '../test/chrome.mjs';

const BASE = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : (process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};

const FRAMES = arg('--frames', 240);

/**
 * The three poses, and they are the same three the screenshots are taken at, so
 * a number in the table and a picture on the page describe one frame.
 *
 * An interior, an exterior, and a close-up is not an arbitrary spread. They are
 * the three cost shapes this renderer has: the exterior is draw-call and shadow
 * bound with the whole facade in frame, the interior is fill bound in a sealed
 * room, and the close-up is almost pure overdraw with a wall filling the
 * screen.
 */
const POSES = [
  { id: 'exterior avenue', place: { x: 0, z: 24, yaw: Math.PI, pitch: -0.02 } },
  { id: 'ground close-up', place: { x: 5, z: 10, yaw: -0.3, pitch: -1.047 } },
  { id: 'interior chamber', interior: true, place: { x: 0, z: -146, yaw: 0, pitch: -0.02 } },
];

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [
    // No swiftshader and no --use-gl override: the question is what the machine
    // really does. See tools/perf.mjs.
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
    '--disable-features=CalculateNativeWinOcclusion',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
  ],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return { renderer: 'NO WEBGL', vendor: '' };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : 'unknown',
  };
});

console.log(`GPU:     ${gpu.renderer}`);
console.log(`vendor:  ${gpu.vendor}`);
if (/swiftshader|software/i.test(gpu.renderer)) {
  console.log('\n  WARNING: SOFTWARE rasteriser. Every number below is fiction as');
  console.log('  far as real hardware is concerned. Do not tune on it.\n');
}

await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(2000);

// The governor stands down for BOTH halves. See the header.
await page.evaluate(() => window.__SANDS__.governor.yieldToPlayer());

async function pose(p) {
  await page.evaluate(async (q) => {
    const g = window.__SANDS__;
    if (q.interior && g.spaces.id !== 'interior') {
      g.spaces.enter('interior', { x: q.place.x, z: q.place.z, rot: q.place.yaw });
    } else if (!q.interior && g.spaces.id === 'interior') {
      g.spaces.enter('exterior', { x: q.place.x, z: q.place.z, rot: q.place.yaw });
    }
    g.player.teleport({ x: q.place.x, y: 0, z: q.place.z });
    g.rig.reset(q.place.yaw, q.place.pitch);
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
  }, p);
}

/**
 * Sample raw rAF deltas plus the draw budget.
 *
 * Lifted from tools/perf.mjs deliberately rather than imported, because that
 * file is a script rather than a module and forking a page-side function is
 * cheaper than making it one. The subtlety it carries is the one that matters:
 * `autoReset = false` and an explicit `reset()` per frame, because three.js
 * clears the counters inside `render()` and a read taken after the frame
 * reports whatever the LAST pass drew rather than the whole frame. That is how
 * a 250-draw-call pass looks free.
 */
async function measure(frames) {
  return page.evaluate(async (n) => {
    const g = window.__SANDS__;
    const info = g.renderer.info;
    info.autoReset = false;

    const dts = [];
    let calls = 0, tris = 0, samples = 0;

    await new Promise((resolve) => {
      let last = performance.now();
      let i = 0;
      const tick = () => {
        const now = performance.now();
        dts.push(now - last);
        last = now;

        calls += info.render.calls;
        tris += info.render.triangles;
        samples++;
        info.reset();

        if (++i >= n) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    info.autoReset = true;

    // Drop the first ten: a mode change costs shader recompiles and render
    // target reallocation, which are real and are paid once.
    const warm = dts.slice(10).sort((a, b) => a - b);
    const at = (q) => warm[Math.min(warm.length - 1, Math.floor(warm.length * q))];

    const buf = g.renderer.getDrawingBufferSize(new g.THREE.Vector2());

    return {
      median: at(0.5),
      p95: at(0.95),
      worst: warm[warm.length - 1],
      calls: samples ? calls / samples : 0,
      tris: samples ? tris / samples : 0,
      w: buf.x,
      h: buf.y,
      rt: `${g.composer.renderTarget1.width}x${g.composer.renderTarget1.height}`,
      passes: g.composer.passes.filter((p) => p.enabled).map((p) => p.constructor.name).join('+'),
    };
  }, frames);
}

const ratio = await page.evaluate(() => ({
  dpr: window.devicePixelRatio, w: window.innerWidth, h: window.innerHeight,
}));

console.log(`window:  ${ratio.w}x${ratio.h} css, devicePixelRatio ${ratio.dpr}`);
console.log(`frames:  ${FRAMES} per row, vsync disabled\n`);

const rows = [];

for (const p of POSES) {
  await pose(p);

  // Baseline first, and the mode is turned off explicitly rather than assumed
  // off, because the previous pose left it in whatever state it ended in.
  await page.evaluate(() => window.__SANDS__.retro.set(false));
  await page.waitForTimeout(500);
  const off = await measure(FRAMES);

  await page.evaluate(() => window.__SANDS__.retro.set(true));
  await page.waitForTimeout(500);
  const on = await measure(FRAMES);

  await page.evaluate(() => window.__SANDS__.retro.set(false));
  await page.waitForTimeout(300);

  rows.push({ pose: p.id, off, on });
}

console.log('POSE               MODE       median      fps     p95     worst   calls    tris     buffer      composer RT');
for (const r of rows) {
  for (const [label, m] of [['current', r.off], ['PS1', r.on]]) {
    console.log(
      `${r.pose.padEnd(18)} ${label.padEnd(9)} ` +
      `${m.median.toFixed(2).padStart(6)} ms ${(1000 / m.median).toFixed(0).padStart(5)} ` +
      `${m.p95.toFixed(1).padStart(7)} ${m.worst.toFixed(1).padStart(7)} ` +
      `${m.calls.toFixed(0).padStart(6)} ${(m.tris / 1000).toFixed(0).padStart(6)}k ` +
      `${`${m.w}x${m.h}`.padStart(11)}  ${m.rt}`
    );
  }
}

console.log('\nWHAT THE MODE IS WORTH, per pose:');
for (const r of rows) {
  const saved = r.off.median - r.on.median;
  const pct = (saved / r.off.median) * 100;
  const px = (r.off.w * r.off.h) / (r.on.w * r.on.h);
  console.log(
    `  ${r.pose.padEnd(18)} ${saved >= 0 ? '-' : '+'}${Math.abs(saved).toFixed(2)} ms  ` +
    `(${(-pct).toFixed(0)}% of the frame, ` +
    `${(1000 / r.off.median).toFixed(0)} -> ${(1000 / r.on.median).toFixed(0)} fps, ` +
    `${px.toFixed(1)}x fewer pixels)`
  );
}

writeFileSync(
  new URL('../.scratch/retro/perf.json', import.meta.url).pathname,
  JSON.stringify({ gpu, window: ratio, frames: FRAMES, rows, errors }, null, 2)
);

if (errors.length) {
  console.log('\nPAGE ERRORS:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}

await browser.close();
