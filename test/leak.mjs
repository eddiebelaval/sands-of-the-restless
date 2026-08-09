/**
 * The one thing that must be impossible.
 *
 * The strip harness samples once per animation frame, which is close but not
 * exact: it reads state from OUTSIDE the loop and cannot promise the numbers
 * belong to the frame that was drawn. This does not sample. It wraps
 * composer.render itself, so every record is taken at the instant a frame is
 * committed, from inside the call that commits it.
 *
 * A LEAK is a committed frame in which the world being drawn is not the world
 * the camera is standing in - the two cells are 110 units apart on z, so which
 * one the camera is in is never ambiguous - AND the curtain in front of it was
 * not fully black. That is the "see under the pyramid for a second" frame, and
 * this counts them.
 *
 * Usage:  node test/leak.mjs <url>
 */

import { chromium } from 'playwright';
import { resolveChrome, dismissBriefing } from './chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4581/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage({ viewport: { width: 960, height: 560 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
// BEGIN raises the briefing card now; the world is held behind it. See chrome.mjs.
await dismissBriefing(page);
await page.waitForTimeout(1400);

await page.evaluate(() => {
  const g = window.__SANDS__;
  g.combat.state.invulnerable = true;
  g.economy.grant(4000);

  const rec = [];
  window.__LEAK__ = rec;

  const composer = g.post.composer;
  const original = composer.render.bind(composer);

  composer.render = function patched(dt) {
    const el = document.getElementById('curtain');
    const veil = !el || el.style.visibility === 'hidden'
      ? 0
      : parseFloat(el.style.opacity || '0');

    rec.push({
      camZ: +g.camera.position.z.toFixed(2),
      space: g.spaces.active,
      inVis: g.interior.group.visible,
      cyVis: g.courtyard.group.visible,
      veil,
    });

    return original(dt);
  };

  window.__W__ = {
    async frames(n) { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); },
    place(x, z, yaw) { g.player.teleport({ x, y: 0, z }); g.rig.reset(yaw, -0.02); },
    key(code, down = true) {
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    },
  };
});

// Buy the door, wait for the slab.
await page.evaluate(async () => {
  window.__W__.place(0, -24, 0);
  await window.__W__.frames(3);
  window.__W__.key('KeyF');
  await window.__W__.frames(2);
  window.__W__.key('KeyF', false);
  let f = 0;
  while (!window.__SANDS__.doors.byId('courtyard/entry').opened && f < 300) {
    await new Promise((r) => requestAnimationFrame(r)); f++;
  }
});

// Walk in for real, then out for real, then in again - three crossings, so a
// transition that only works the first time is caught.
await page.evaluate(async () => {
  window.__W__.place(0, -26.5, 0);
  await window.__W__.frames(2);
  window.__W__.key('KeyW');
});
await page.evaluate(() => window.__W__.frames(46));

await page.evaluate(async () => {
  window.__W__.key('KeyW', false);
  window.__W__.place(0, -146, Math.PI);
  await window.__W__.frames(4);
  window.__W__.key('KeyW');
});
await page.evaluate(() => window.__W__.frames(46));

await page.evaluate(async () => {
  window.__W__.key('KeyW', false);
  window.__W__.place(0, -26.5, 0);
  await window.__W__.frames(4);
  window.__W__.key('KeyW');
});
await page.evaluate(() => window.__W__.frames(46));
await page.evaluate(() => window.__W__.key('KeyW', false));

const rec = await page.evaluate(() => window.__LEAK__);
await browser.close();

// Which cell is the camera standing in? The interior begins 110 units past the
// courtyard's outer wall and the courtyard's own minZ is -33, so -100 splits
// them with sixty units of clearance either side.
const cell = (camZ) => (camZ < -100 ? 'interior' : 'exterior');

const drawn = (r) => (r.inVis && !r.cyVis ? 'interior' : r.cyVis && !r.inVis ? 'exterior' : 'both');

const mismatched = rec.filter((r) => drawn(r) !== cell(r.camZ));
const leaks = mismatched.filter((r) => r.veil < 1);

console.log(`frames committed:            ${rec.length}`);
console.log(`frames where the drawn world`);
console.log(`  disagrees with the camera: ${mismatched.length}`);
console.log(`  ... of those, not black:   ${leaks.length}   <-- LEAKS`);

if (mismatched.length) {
  console.log('\nevery disagreeing frame:');
  for (const r of mismatched) {
    console.log(`  camZ=${String(r.camZ).padStart(9)} camera-in=${cell(r.camZ).padEnd(9)}`
      + ` drawing=${drawn(r).padEnd(9)} veil=${r.veil}`);
  }
}

// The other half of the promise: the curtain must always come back down.
const stuck = rec.length && rec[rec.length - 1].veil > 0;
console.log(`\ncurtain at rest at the end:   ${stuck ? `NO (${rec[rec.length - 1].veil})` : 'yes (0)'}`);

const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
if (errs.length) { console.log('--- errors ---'); errs.forEach((e) => console.log(e)); }

const ok = leaks.length === 0 && !stuck && errs.length === 0;
console.log(ok ? '\nPASS  no frame of the wrong world ever reached the screen'
  : '\nFAIL');
process.exit(ok ? 0 : 1);
