/**
 * WHAT THE FRAME ACTUALLY COSTS, ON A REAL GPU, WITH VSYNC OFF.
 *
 * A player on a MacBook reports the game is slow. Nothing in `test/` can answer
 * that, and it is worth being precise about why, because both reasons have
 * already produced a confidently wrong perf conclusion in this project.
 *
 *   1. EVERY EXISTING HARNESS RENDERS ON THE CPU. `test/chrome.mjs` exports
 *      GL_ARGS with `--use-angle=swiftshader`, which is a software rasteriser.
 *      That is the correct choice for a screenshot suite that has to run
 *      anywhere, and it makes every timing number those files could produce
 *      meaningless for real hardware. A software rasteriser has no shadow map
 *      cost curve, no fill-rate cliff and no bandwidth limit resembling a real
 *      GPU's.
 *
 *   2. VSYNC HIDES THE COST OF EVERYTHING. This is written down in STATE.md
 *      because it has already burned this project once: the post chain was
 *      profiled by disabling passes one at a time, every configuration measured
 *      15.4 ms, and the conclusion recorded was "the chain is free". It is not.
 *      GTAOPass re-renders the WHOLE SCENE through MeshNormalMaterial to fill
 *      its own G-buffer. The wall clock was identical because the frame was
 *      pinned at 60 Hz and had headroom to hide in. Every configuration was
 *      simply waiting for the same flip.
 *
 * So: real GPU, `--disable-gpu-vsync` and `--disable-frame-rate-limit`, and the
 * frame budget read from `renderer.info` with `autoReset` turned OFF so the
 * counters survive being read.
 *
 * THIS TOOL DOES NOT ASSERT. It is an instrument, like `test/ao-ab.mjs` and
 * unlike `tools/trainability.mjs`, and it must never be wired into `npm test` -
 * a number that depends on what else the machine is doing is a flaky gate, and
 * a flaky gate gets ignored and then deleted. Read it, decide, and put the
 * DECISION in a gate somewhere that measures a shape rather than a duration.
 *
 * Usage: node tools/perf.mjs [baseUrl] [--frames N] [--ratio R]
 */

import { chromium } from 'playwright';
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
 * The configurations to sweep, in the order a person would actually try them.
 *
 * `fidelity` is the switch main.js already owns and defaults to TRUE for every
 * machine on earth with no hardware detection of any kind, which is the first
 * thing to quantify. The per-pass rows below it exist to find out where inside
 * "high" the money is going, because "turn everything off" is not a shippable
 * answer and "turn off the one pass that costs half the frame" might be.
 */
const CONFIGS = [
  { label: 'high (shipping default)', apply: null },
  { label: 'high, GTAO off',          apply: { gtao: false } },
  { label: 'high, bloom off',         apply: { bloom: false } },
  { label: 'high, SMAA off',          apply: { smaa: false } },
  { label: 'high, GTAO + bloom off',  apply: { gtao: false, bloom: false } },
  { label: 'low (fidelity switch)',   apply: 'low' },
];

const CHROME = resolveChrome();

const browser = await chromium.launch({
  executablePath: CHROME,
  args: [
    /**
     * NO swiftshader here, and no `--use-gl=angle` override. We want whatever
     * the machine would really use, because the question is what the machine
     * really does.
     */
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
    // Without this the compositor can still pace us even with vsync off.
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

/** Confirm we are actually on a GPU and say which, so the numbers are readable. */
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
  console.log('\n  WARNING: this is a SOFTWARE rasteriser. Every number below is');
  console.log('  fiction as far as real hardware is concerned. Do not tune on it.\n');
}

await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(2000);

/**
 * Park the player somewhere expensive and REPRODUCIBLE.
 *
 * Measuring wherever the camera happened to land compares different scenes to
 * each other. The avenue looking at the pyramid is the worst honest case
 * outdoors: the full facade, the sun shadow cascade, and the dust all in frame
 * at once.
 */
await page.evaluate(() => {
  const g = window.__SANDS__;
  if (!g) return;
  g.player.teleport({ x: 0, y: 0, z: 24 });
  g.rig.reset(Math.PI, -0.02);
});
await page.waitForTimeout(600);

/**
 * Sample raw rAF deltas plus the draw budget.
 *
 * `autoReset = false` then an explicit `reset()` per frame, because three.js
 * clears the counters inside `render()` by default and a read taken after the
 * frame would report whatever the LAST pass happened to draw rather than the
 * whole frame. That subtlety is how a 250-draw-call pass can look free.
 *
 * The median is the headline, not the mean. One 400 ms hitch from a texture
 * upload or a GC drags a mean across the threshold and tells you nothing about
 * what the frame normally costs. p95 is reported next to it because the hitches
 * are the thing a player actually feels.
 */
async function measure(frames) {
  return page.evaluate(async (n) => {
    const g = window.__SANDS__;
    const info = g && g.renderer ? g.renderer.info : null;
    if (info) info.autoReset = false;

    const dts = [];
    let calls = 0, tris = 0, samples = 0;

    await new Promise((resolve) => {
      let last = performance.now();
      let i = 0;
      const tick = () => {
        const now = performance.now();
        dts.push(now - last);
        last = now;

        if (info) {
          calls += info.render.calls;
          tris += info.render.triangles;
          samples++;
          info.reset();
        }

        if (++i >= n) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    // Drop the first few: the first frames after a config change include
    // shader recompiles and render-target reallocation, which are real costs
    // but are paid once and are not what the steady state looks like.
    const warm = dts.slice(10).sort((a, b) => a - b);
    const at = (q) => warm[Math.min(warm.length - 1, Math.floor(warm.length * q))];

    return {
      median: at(0.5),
      p95: at(0.95),
      worst: warm[warm.length - 1],
      calls: samples ? calls / samples : 0,
      tris: samples ? tris / samples : 0,
    };
  }, frames);
}

/** Reach into the live post chain by pass constructor name. */
async function applyConfig(cfg) {
  await page.evaluate((c) => {
    const g = window.__SANDS__;
    if (!g) return;

    if (c === 'low') { g.setFidelity(false); return; }

    g.setFidelity(true);
    if (!c) return;

    // The composer is not exposed by name, so find passes by their class.
    const passes = g.composer ? g.composer.passes : [];
    const find = (re) => passes.filter((p) => re.test(p.constructor.name));

    if (c.gtao === false) for (const p of find(/GTAO/i)) p.enabled = false;
    if (c.bloom === false) for (const p of find(/Bloom/i)) p.enabled = false;
    if (c.smaa === false) for (const p of find(/SMAA/i)) p.enabled = false;

    // Whatever is last and enabled has to write to the screen, exactly as
    // setFidelity does. Without this the frame goes black and the numbers are
    // measuring an empty canvas, which is fast and useless.
    for (const p of passes) p.renderToScreen = false;
    for (let i = passes.length - 1; i >= 0; i--) {
      if (passes[i].enabled) { passes[i].renderToScreen = true; break; }
    }
  }, cfg);
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------------------

const exposed = await page.evaluate(() => {
  const g = window.__SANDS__;
  return { sands: !!g, renderer: !!(g && g.renderer), composer: !!(g && g.composer) };
});

if (!exposed.sands) {
  console.log('\nwindow.__SANDS__ is not exposed. Nothing can be measured.');
  await browser.close();
  process.exit(1);
}
if (!exposed.composer) {
  console.log('\nNOTE: window.__SANDS__.composer is not exposed, so the per-pass');
  console.log('rows below cannot toggle anything and will repeat the default.');
}
if (!exposed.renderer) {
  console.log('\nNOTE: window.__SANDS__.renderer is not exposed, so draw calls and');
  console.log('triangles will read zero. Frame times are still real.');
}

const ratio = await page.evaluate(() => {
  const g = window.__SANDS__;
  return {
    pixelRatio: g && g.renderer ? g.renderer.getPixelRatio() : 0,
    dpr: window.devicePixelRatio,
    w: window.innerWidth,
    h: window.innerHeight,
  };
});

console.log(`window:  ${ratio.w}x${ratio.h} css, devicePixelRatio ${ratio.dpr}`);
console.log(`render:  pixelRatio ${ratio.pixelRatio.toFixed(2)} = ` +
  `${((ratio.w * ratio.pixelRatio) * (ratio.h * ratio.pixelRatio) / 1e6).toFixed(2)} MP`);
console.log(`frames:  ${FRAMES} per configuration, vsync disabled\n`);

console.log('CONFIGURATION               median      fps    p95      worst    calls    tris');

const rows = [];
for (const cfg of CONFIGS) {
  await applyConfig(cfg.apply);
  const r = await measure(FRAMES);
  rows.push({ label: cfg.label, ...r });
  console.log(
    `${cfg.label.padEnd(26)}  ${r.median.toFixed(2).padStart(6)} ms  ` +
    `${(1000 / r.median).toFixed(0).padStart(4)}  ` +
    `${r.p95.toFixed(1).padStart(6)}  ${r.worst.toFixed(1).padStart(7)}  ` +
    `${r.calls.toFixed(0).padStart(6)}  ${(r.tris / 1000).toFixed(0).padStart(5)}k`
  );
}

// ---------------------------------------------------------------------------

const base = rows[0];
console.log('\nWHAT EACH PASS IS WORTH, against the shipping default:');
for (const r of rows.slice(1)) {
  const saved = base.median - r.median;
  const pct = (saved / base.median) * 100;
  console.log(
    `  ${r.label.padEnd(26)} ${saved >= 0 ? '-' : '+'}${Math.abs(saved).toFixed(2)} ms  ` +
    `(${pct >= 0 ? '' : '+'}${(-pct).toFixed(0)}% of the frame)`
  );
}

if (errors.length) {
  console.log('\nPAGE ERRORS:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}

await browser.close();
