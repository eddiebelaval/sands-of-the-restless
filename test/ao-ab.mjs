/**
 * Decisive A/B on the ambient occlusion pass.
 *
 *   node test/ao-ab.mjs [baseUrl]        (or SANDS_URL=... node test/ao-ab.mjs)
 *
 * "I added GTAO" is not the same as "GTAO is contributing". This renders the
 * identical frame with the pass enabled and disabled and measures what changed.
 *
 * THIS FILE PREVIOUSLY REPORTED A PASS THAT WAS DOING NOTHING AS "CONTRIBUTING",
 * and the way it did it is worth keeping, because it is the same failure as a
 * gate calibrated against a broken reader. Three things were wrong and each one
 * alone was enough:
 *
 *   1. NO CONTROL. It diffed two frames taken twelve rendered frames apart from
 *      a LIVE scene - wind on the grass, blowing dust, weapon sway, the sun's
 *      temporal passes - and attributed the whole difference to the pass. Same
 *      build against itself, measured here, comes back at meanAbsDiff 1.17.
 *   2. THE VERDICT THRESHOLD WAS BELOW ITS OWN NOISE FLOOR. It printed "GTAO IS
 *      CONTRIBUTING" above 1.0. So it would have passed with the pass DELETED.
 *   3. LIVE FILM GRAIN. Unseeded, per frame, and worth 3-7 of mean absolute
 *      delta on its own.
 *
 * Measured against the build it was shipped alongside, the AO pass moved the
 * ground-fill frame by 0.03 of 255. This harness said it was contributing.
 *
 * WHAT IT DOES NOW
 *
 *   - Pins the camera to the pose the complaint is actually about: looking down
 *     at open sand with a rock and three potsherds lying on it, three metres
 *     from the eye. AO that only shows up on a brick wall is not the AO anyone
 *     asked for.
 *   - Holds the wave director and freezes the player controller, so nothing
 *     walks through frame between the two exposures.
 *   - Zeroes the film grain for the duration.
 *   - Takes a SAME-BUILD control pair and reports it beside the result. The
 *     verdict is a margin over that control, never an absolute number.
 *   - Measures the statistic the eye actually reads. Mean absolute difference
 *     over the whole frame is the wrong one: a contact shadow is a ring a few
 *     pixels wide around each prop, so it can be completely convincing and still
 *     be a fraction of a per cent of the image. What is gated is HOW MUCH of the
 *     frame darkened MEANINGFULLY, and by how much where it did.
 *   - Reads pixels from `page.screenshot()` decoded in node, never from an
 *     in-page `drawImage(renderer.domElement)`. With preserveDrawingBuffer
 *     false that samples a stale or cleared buffer, and it has reported a
 *     sunlit courtyard at luma 7 on this project before.
 */

import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177';

/**
 * The ground-fill pose, copied from the capture set. Eye at 1.7 m, pitched 60
 * degrees down over the avenue's east verge, which is where the loose scatter
 * lives. This is the frame two blind judges independently described as props
 * sitting ON the sand rather than IN it.
 */
const POSE = { pos: [5, 1.7, 10], yaw: -0.3, pitch: -1.047 };

/**
 * What counts as a pixel that visibly darkened.
 *
 * Four of 255 is a little over one per cent and comfortably above the 8-bit
 * quantisation of the tone curve. Anything smaller is not a shadow, it is a
 * rounding difference, and counting it is how the previous version of this file
 * scored blowing dust as ambient occlusion.
 */
const DARKEN = 4;

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });

await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('!!window.__SANDS__', null, { timeout: 300000 });
await page.evaluate(() => document.getElementById('begin').click());

// Settle in RENDERED FRAMES, never in wall-clock milliseconds. Under software
// rendering the delta clamp makes simulated time run about six times slower
// than the clock, so a fixed wait lands at a different point in the world's
// life every run.
const frames = (n) => page.evaluate((k) => new Promise((res) => {
  let i = 0;
  const tick = () => (++i >= k ? res() : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
}), n);

await frames(90);

// Hold everything that moves.
await page.evaluate((pose) => {
  const g = window.__SANDS__;

  // The wave director starts wave one a few seconds in on its own.
  g.director.reset();
  g.director.state.phase = 'breather';
  g.director.state.timer = 1e9;

  // Freeze the controller by assignment on the exposed object, never by a
  // source edit: ground snap, head bob and friction would all move the eye off
  // the authored pose between the two exposures.
  g.player.update = () => {};
  g.player.velocity.set(0, 0, 0);
  g.player.state.speed = 0;
  g.player.state.sprinting = false;
  g.player.state.grounded = true;
  g.player.state.bobOffset.set(0, 0, 0);
  g.player.state.bobPhase = 0;

  g.player.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
  g.rig.reset(pose.yaw, pose.pitch);
  g.rig.update(0, g.player, false);

  // Unseeded per-frame grain is worth 3-7 of mean absolute delta by itself.
  g.post.grade.uniforms.uGrain.value = 0;

  // PIN EVERYTHING THAT ADVANCES PER FRAME, or the control swallows the result.
  // With only the controller frozen this file measured a same-build control at
  // meanAbsDiff 2.03 and 3.1 per cent of the frame "darkened" - larger than the
  // AO signal it was trying to find. Weapon sway advances per frame and the gun
  // fills a quarter of a downward-pitched frame; the dust, the wind on the
  // scatter and the cloud drift do the rest.
  //
  // Nulled by assignment on the exposed objects rather than by pausing the loop,
  // because the loop is what calls composer.render and the whole exercise needs
  // frames to keep arriving. The world stops; the renderer does not.
  g.viewmodel.update = () => {};
  g.world.update = () => {};
  g.sky.update = () => {};
  g.impacts.update = () => {};

  for (const el of document.querySelectorAll('body > *')) {
    if (el.id !== 'stage' && el.tagName !== 'SCRIPT') el.style.display = 'none';
  }
}, POSE);

await frames(60);

const dir = mkdtempSync(join(tmpdir(), 'sands-ao-'));

/** One settled exposure, decoded in node. */
async function shot(name) {
  await frames(10);
  const file = join(dir, `${name}.png`);
  await page.screenshot({ path: file, type: 'png' });
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}

/**
 * The AO chain is TWO passes now and this toggles both with one flag.
 *
 * GTAOPass no longer composites: it runs at OUTPUT.Off and only fills its
 * denoise target, and `post.aoComposite` is what multiplies that term onto the
 * frame. `aoComposite.enabled` is defined in post.js as a getter that ANDs its
 * own flag with `gtao.enabled`, precisely so that this line keeps meaning what
 * it has always meant. Without that interlock, disabling GTAO here would stop
 * the AO being COMPUTED while the composite went on applying the last buffer
 * that was filled - which, with the world pinned the way it is below, is
 * bit-identical to a live one. This file would then measure a zero delta
 * against a working chain and report "GTAO HAS NO VISIBLE EFFECT".
 *
 * That the control below comes back at exactly 0.000 while the result does not
 * is what proves the interlock is live: a stale-buffer failure would put BOTH
 * at zero.
 */
async function setAO(on) {
  await page.evaluate((v) => { window.__SANDS__.post.gtao.enabled = v; }, on);
}

await setAO(true);
const onA = await shot('on-a');
await setAO(false);
const off = await shot('off');
await setAO(true);
const onB = await shot('on-b');

/**
 * Compare two exposures.
 *
 * `meanAbsDiff` is reported because it is what the old version gated on and the
 * comparison to the control is the point. `darkPct` and `darkMean` are what is
 * actually judged: a contact shadow is a small number of pixels moved a long
 * way, which is the opposite shape to the drifting-scene noise it has to be
 * told apart from.
 */
function compare(a, b) {
  const n = a.w * a.h;
  let sum = 0, maxd = 0, dark = 0, darkSum = 0, bright = 0;
  const L = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  for (let p = 0; p < n; p++) {
    const i = p * a.ch;
    const la = L(a.data, i), lb = L(b.data, i);
    const d = la - lb;
    const ad = Math.abs(d);
    sum += ad;
    if (ad > maxd) maxd = ad;
    if (d <= -DARKEN) { dark++; darkSum += -d; }
    if (d >= DARKEN) bright++;
  }
  return {
    meanAbsDiff: +(sum / n).toFixed(3),
    maxPixelDiff: +maxd.toFixed(1),
    darkPct: +((dark / n) * 100).toFixed(3),
    darkMean: +(dark ? darkSum / dark : 0).toFixed(2),
    brightPct: +((bright / n) * 100).toFixed(3),
  };
}

const ao = compare(onA, off);          // AO on minus AO off: should DARKEN
const control = compare(onA, onB);     // same build twice: the noise floor

await browser.close();

/**
 * The gate.
 *
 * Both clauses are needed and neither is sufficient. `darkPct` alone would pass
 * on a pass that dimmed the whole frame by a flat five per cent, which is a
 * grade change and not occlusion. `darkMean` alone would pass on a single
 * pathological pixel. Together they say: a real amount of the frame went
 * meaningfully darker, and it went darker by a meaningful amount.
 *
 * Both are stated as a MARGIN OVER THE CONTROL, so the numbers cannot drift out
 * of agreement with the machine, the renderer or the day's noise. With the world
 * pinned the control now comes back at exactly 0.000 - two renders of the same
 * build are BIT IDENTICAL, not "within noise" - so the margin is the whole
 * signal and a disabled pass scores zero and fails.
 *
 * WHAT THIS GATE PROVES AND WHAT IT DOES NOT. Measured at this pose, 900x560,
 * swiftshader:
 *
 *                                   darkPct   darkMean   meanAbsDiff
 *     0.85 m architecture radius      1.749      13.57       0.285
 *     0.60 m contact radius           2.680      15.62       0.462
 *
 * Both clear the gate. The first one is the configuration two blind judges
 * described as "every prop sits on the ground with zero grounding darkening",
 * so let this be said plainly: THIS FILE CAN TELL YOU THE PASS IS RUNNING AND
 * IT CANNOT TELL YOU THE PASS IS GOOD. It exists to make "enabled but inert"
 * impossible to ship, which is the failure it previously waved through. Whether
 * a rock sits IN the sand is decided on a 4x crop by eye, and there is no number
 * on this page that substitutes for that.
 */
const MIN_DARK_PCT = 0.75;   // per cent of frame, over control
const MIN_DARK_MEAN = 6.0;   // mean luma drop inside that set

const clearsArea = ao.darkPct - control.darkPct >= MIN_DARK_PCT;
const clearsDepth = ao.darkMean >= MIN_DARK_MEAN;
const darkensNotBrightens = ao.darkPct > ao.brightPct * 2;

const pass = clearsArea && clearsDepth && darkensNotBrightens;

const out = {
  pose: POSE,
  ao,
  control,
  gate: {
    darkPctOverControl: +(ao.darkPct - control.darkPct).toFixed(3),
    minDarkPctOverControl: MIN_DARK_PCT,
    darkMean: ao.darkMean,
    minDarkMean: MIN_DARK_MEAN,
    darkensNotBrightens,
  },
  errors,
  verdict: pass ? 'GTAO IS CONTRIBUTING' : 'GTAO HAS NO VISIBLE EFFECT',
};

console.log(JSON.stringify(out, null, 2));

if (errors.length) {
  console.error('FAIL: console errors during the run');
  process.exit(1);
}
if (!pass) {
  console.error('FAIL: the AO pass is enabled, costing a full extra scene render, and not grounding anything.');
  process.exit(1);
}
