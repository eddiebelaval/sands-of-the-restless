/**
 * FRAME STRIP for the crouch and the slide. Not a suite - an eye.
 *
 * test/crouchslide.mjs proves the numbers. It cannot tell anyone whether the
 * move LOOKS like a body, and that is the half a movement feature is judged on.
 * A crouch can be exactly 0.95 m and exactly 0.16 s and still read as a lift
 * descending; a slide can travel exactly 4.7 m and still read as the player
 * being dragged. So this walks the whole arc and writes a numbered PNG at every
 * beat, with the runtime numbers printed beside them.
 *
 * Same shape as test/deathstrip.mjs, deliberately, and for the same reason: a
 * sequence cannot be judged from one still.
 *
 * THE BAR IS PART OF THE PICTURE. The shipped map has no headroom under 4.2 m,
 * so a screenshot of "crouching under something" cannot be taken in it. A wall
 * record whose underside is at 1.20 is pushed into the live world for the last
 * three frames and taken out again - the same bar the suite walks the body at -
 * so the strip shows the one thing the crouch is FOR alongside the one thing it
 * currently cannot do anywhere in the map as authored.
 *
 * Usage: node test/crouchstrip.mjs [baseUrl] [outDirName]
 */

import { chromium } from 'playwright';
import { resolveChrome, dismissBriefing } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:5317/index.html';
const DIR = process.argv[3] || 'crouch';
const OUT = new URL(`../shots/${DIR}/`, import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.setDefaultTimeout(180000);
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
// BEGIN raises the briefing card now; the world is held behind it. See chrome.mjs.
await dismissBriefing(page);
await page.waitForTimeout(1800);

let n = 0;
const rows = [];

const shot = async (name) => {
  const b = await page.evaluate(() => {
    const g = window.__SANDS__;
    const s = g.player.state;
    return {
      eye: +s.eyeHeight.toFixed(3),
      crouch: +s.crouch.toFixed(3),
      camY: +g.camera.position.y.toFixed(3),
      posY: +g.player.position.y.toFixed(3),
      z: +g.player.position.z.toFixed(3),
      speed: +s.speed.toFixed(2),
      sliding: s.sliding,
      slideT: +s.slideT.toFixed(3),
      ceilinged: s.ceilinged,
    };
  });
  const label = String(++n).padStart(2, '0');
  await page.screenshot({ path: `${OUT}${label}-${name}.png`, timeout: 180000 });
  rows.push(`${label}-${name.padEnd(16)} eye ${String(b.eye).padEnd(6)} camera ${String(b.camY).padEnd(7)}`
    + ` z ${String(b.z).padEnd(10)} ${String(b.speed).padStart(5)} m/s`
    + `${b.sliding ? '  SLIDING' : ''}${b.ceilinged ? '  CEILINGED' : ''}`);
  return b;
};

// A clean field. The director sending a wave into the middle of a strip is the
// difference between a picture of a crouch and a picture of a mummy.
await page.evaluate(() => {
  const g = window.__SANDS__;
  g.combat.state.invulnerable = true;
  g.director.reset();
  g.director.state.timer = 9999;
  g.player.heal(g.player.state.maxHealth);
  g.governor.yieldToPlayer();
});

// Inside, in the gallery, in the lane test/crouchslide.mjs verified is clear of
// colliders for 34 m. Outside is a dune field and a slide measured on a slope
// is a picture of the slope.
await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.spaces.enter('interior', { x: 3, z: -164, rot: 0 });
  await new Promise((r) => setTimeout(r, 700));
  g.player.teleport({ x: 3, y: 0, z: -164 });
  g.rig.reset(0, 0);
});
await page.waitForTimeout(900);

const hold = (frames) => page.evaluate(async (nf) => {
  const g = window.__SANDS__;
  const target = g.frameNo + nf;
  for (let i = 0; i < nf * 80 + 400; i++) {
    if (g.frameNo >= target) return g.frameNo;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return g.frameNo;
}, frames);

// ---------------------------------------------------------------------------
// THE CROUCH
// ---------------------------------------------------------------------------

await shot('standing');

await page.evaluate(() => { window.__SANDS__.input.state.crouch = true; });
await hold(1);
await shot('crouch-mid');
await hold(4);
await shot('crouched');

await page.evaluate(() => { window.__SANDS__.input.state.crouch = false; });
await hold(2);
await shot('rising');
await hold(6);
await shot('standing-again');

// ---------------------------------------------------------------------------
// THE SLIDE, off the same button, taken at speed
// ---------------------------------------------------------------------------

await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.player.teleport({ x: 3, y: 0, z: -164 });
  g.rig.reset(0, 0);
  g.input.state.crouch = false;
  g.input.state.forward = 1;
  g.input.state.sprint = true;
});
await hold(8);
await shot('sprinting');

await page.evaluate(() => { window.__SANDS__.input.state.crouch = true; });
await hold(1);
await shot('slide-launch');
await hold(3);
await shot('slide-mid');
await hold(5);
await shot('slide-late');
await hold(6);
await shot('slide-over');

await page.evaluate(() => {
  const g = window.__SANDS__;
  g.input.state.forward = 0;
  g.input.state.sprint = false;
  g.input.state.crouch = false;
});
await hold(10);

// ---------------------------------------------------------------------------
// UNDER SOMETHING, which the map cannot currently show on its own
// ---------------------------------------------------------------------------

await page.evaluate(() => {
  const g = window.__SANDS__;
  g.player.teleport({ x: 3, y: 0, z: -164 });
  g.rig.reset(0, 0);
  g.world.walls.push({ x: 3, z: -168, w: 10, d: 0.8, y0: 1.20, y1: 4.0, __harness: true });
});
await hold(4);
await shot('bar-ahead');

await page.evaluate(() => {
  const g = window.__SANDS__;
  g.input.state.crouch = true;
  g.input.state.forward = 1;
});
await hold(14);
await shot('under-the-bar');

// Ask to stand, under 1.20 m of stone. It must be refused, and the picture is
// of the refusal: the view stays down while the button says up.
await page.evaluate(() => { window.__SANDS__.input.state.crouch = false; });
await hold(10);
const pinned = await shot('refused-to-stand');

await page.evaluate(() => {
  const g = window.__SANDS__;
  g.input.state.forward = 0;
  for (let i = g.world.walls.length - 1; i >= 0; i--) {
    if (g.world.walls[i].__harness) g.world.walls.splice(i, 1);
  }
});
await hold(12);
await shot('stone-gone-stood-up');

console.log(rows.join('\n'));
console.log(`\nrefused-to-stand: ceilinged ${pinned.ceilinged}, eye held at ${pinned.eye}`);
console.log(`\nstrip -> ${OUT}`);
if (logs.length) console.log('\n' + logs.join('\n'));

await browser.close();
