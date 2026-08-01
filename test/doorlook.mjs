/**
 * The entry doorway, photographed from INSIDE.
 *
 * This exists because a comment in systems/doors.js made a claim about pixels -
 * that the interior's entry wall is "already a sealed wall" and needs nothing
 * hung across it - and a claim about pixels is only ever settled by pixels. The
 * repo's own history is nine bugs of the form "written but never rendered", so
 * the standing rule is that the screenshot is the evidence and the source is
 * only the hypothesis.
 *
 * What it does: drop the player into the Chamber of Ascent, turn them round to
 * face the doorway they came in through, and photograph it from three distances.
 * For each shot it also measures the mean luminance of a small box at the centre
 * of the opening, because "is that hole bright or dark" is a number, not an
 * impression, and two people looking at the same PNG will disagree about it.
 *
 * Usage: node test/doorlook.mjs http://127.0.0.1:46xx/index.html
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS } from './chrome.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4611/index.html';
const TAG = process.argv[3] || 'doorlook';

const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: resolveChrome(), args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1200);

await page.addScriptTag({
  content: `
window.__DL__ = {
  async frames(n) {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  },

  /**
   * Put the player inside and point them back at the entry. The curtain is
   * driven off distance, so it is also asserted to be clear before a shot:
   * photographing the transition instead of the doorway is the obvious way for
   * this harness to lie.
   */
  place(z, yaw) {
    const g = window.__SANDS__;
    if (g.spaces.active !== 'interior') g.spaces.enter('interior', { x: 0, z, rot: yaw });
    g.player.teleport({ x: 0, y: 0, z });
    g.rig.reset(yaw, -0.02);
    g.rig.update(0, g.player, false);
  },

  /**
   * Mean luminance of a box in canvas space, given as fractions of the frame.
   *
   * The readback runs INSIDE a requestAnimationFrame callback, which is not a
   * stylistic choice. The renderer is created without preserveDrawingBuffer, so
   * the colour buffer is valid only for the remainder of the frame that drew it;
   * a drawImage from ordinary script time copies a cleared buffer and reports a
   * flat zero for every pixel. That is a harness that says "black" about a frame
   * you can plainly see is orange, which is the exact failure this file exists
   * to avoid, and it produced one on the first run.
   */
  patch(cx, cy, halfW, halfH) {
    const c = window.__SANDS__.renderer.domElement;
    const sc = document.createElement('canvas');
    sc.width = c.width; sc.height = c.height;
    const ctx = sc.getContext('2d', { willReadFrequently: true });

    return new Promise((resolve) => requestAnimationFrame(() => {
      ctx.drawImage(c, 0, 0);

      const x0 = Math.max(0, Math.round((cx - halfW) * sc.width));
      const x1 = Math.min(sc.width, Math.round((cx + halfW) * sc.width));
      const y0 = Math.max(0, Math.round((cy - halfH) * sc.height));
      const y1 = Math.min(sc.height, Math.round((cy + halfH) * sc.height));

      let sum = 0, n = 0, min = 255, max = 0;
      const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
        sum += l; n++;
        if (l < min) min = l;
        if (l > max) max = l;
      }
      resolve({ mean: +(sum / n).toFixed(1), min: +min.toFixed(0), max: +max.toFixed(0) });
    }));
  },

  /**
   * The RENDERED FRAME on its own, with no page over it, as base64 PNG.
   *
   * page.screenshot() photographs the document, which is right for every other
   * shot here and wrong for the paused one: the pause menu dims the whole page
   * through a scrim, so the capture comes back a picture of a scrim rather than
   * of the frame underneath it. The frame itself is untouched - main.js renders
   * it at delta zero while paused - so the fix is to take the canvas and leave
   * the DOM out of it. Same rAF rule as patch() above, and for the same reason.
   */
  canvasPng() {
    const c = window.__SANDS__.renderer.domElement;
    const sc = document.createElement('canvas');
    sc.width = c.width; sc.height = c.height;
    const ctx = sc.getContext('2d');

    return new Promise((resolve) => requestAnimationFrame(() => {
      ctx.drawImage(c, 0, 0);
      resolve(sc.toDataURL('image/png').split(',')[1]);
    }));
  },

  /**
   * Everything sitting in the doorway's opening, by raycast rather than by
   * scene-graph reading. A mesh that exists and is culled, hidden, or behind
   * the wall answers this question differently from a mesh that is actually
   * the first thing the eye meets, and only the ray knows the difference.
   */
  probeRay(dz) {
    const g = window.__SANDS__;
    const T = g.THREE;
    const ray = new T.Raycaster(
      new T.Vector3(0, 2.0, -145),
      new T.Vector3(0, 0, dz),
      0.1, 40,
    );
    return ray.intersectObject(g.scene, true)
      .filter((h) => h.object.visible)
      .slice(0, 6)
      .map((h) => ({
        name: h.object.name || '(unnamed)',
        z: +h.point.z.toFixed(2),
        mat: h.object.material && h.object.material.type,
        // Read in the WORKING (linear) space, unclamped, because the whole
        // point of the daylight sheet is a colour that goes past 1.0 and is
        // brought back down by the tone mapper. getHexString() would clamp it
        // to ffffff and hide exactly the number being checked.
        rgb: h.object.material && h.object.material.color
          ? [h.object.material.color.r, h.object.material.color.g, h.object.material.color.b]
            .map((v) => +v.toFixed(2))
          : null,
      }));
  },
};
`,
});

const shots = [
  // A stride inside the room, which is where the original claim was measured.
  { name: 'a-stride', z: -143.5 },
  // Deeper in, the read the owner describes: standing in the chamber, looking
  // back at the way out.
  { name: 'mid-room', z: -147.0 },
  // Right in the opening, one step from the threshold.
  { name: 'at-jamb', z: -141.2 },
];

const results = [];

for (const s of shots) {
  await page.evaluate(
    ({ z, yaw }) => window.__DL__.place(z, yaw),
    { z: s.z, yaw: s.yaw === undefined ? Math.PI : s.yaw },
  );
  await page.evaluate(() => window.__DL__.frames(20));

  const veil = await page.evaluate(() => window.__SANDS__.spaces.transition);
  const path = `${OUT}${TAG}-${s.name}.png`;
  await page.screenshot({ path });

  // The opening sits on the horizon line dead ahead. A narrow box at the centre
  // of the frame is the doorway and nothing else at every one of these
  // distances; a wide one would start eating jamb.
  const hole = await page.evaluate(() => window.__DL__.patch(0.5, 0.5, 0.035, 0.06));
  const wall = await page.evaluate(() => window.__DL__.patch(0.22, 0.5, 0.035, 0.06));

  results.push({ ...s, path, veil, hole, wall });
}

/**
 * Sweep the sheet's radiance in ONE browser session.
 *
 * The knob is not "how white" - anything past about 1.5 linear already clips to
 * near-white through the tone mapper - it is how far over the bloom pass's 1.60
 * linear threshold the sheet sits, because the pass was tuned for small sources
 * and a 4.5 by 4.2 metre emitter is the acreage its threshold was raised to stop.
 * So the sweep reports two numbers per setting: the opening itself, and a patch
 * of WALL well outside the opening, which is where the halo shows up. A setting
 * where the wall reads brighter than the unlit stone it is made of has eaten the
 * frame, and the doorway has stopped being a doorway.
 *
 * Swept in one page rather than one build per setting because under swiftshader
 * a build-and-shoot cycle is minutes, and because a colour is the one property
 * that can honestly be changed live: nothing downstream of the material caches
 * it.
 */
if (process.env.DL_SWEEP) {
  await page.evaluate((z) => window.__DL__.place(z, Math.PI), -147.0);

  console.log('--- radiance sweep at z -147, base linear (1.000, 0.956, 0.871) ---');
  for (const scale of [1.20, 1.40, 1.55, 1.75, 2.10, 2.60]) {
    const ok = await page.evaluate((s) => {
      const g = window.__SANDS__;
      const sheet = g.scene.getObjectByName('doorway-daylight');
      if (!sheet) return false;
      sheet.material.color.setRGB(1.000 * s, 0.956 * s, 0.871 * s, g.THREE.LinearSRGBColorSpace);
      return true;
    }, scale);
    if (!ok) { console.log('  no doorway-daylight in the scene'); break; }

    await page.evaluate(() => window.__DL__.frames(6));
    const hole = await page.evaluate(() => window.__DL__.patch(0.5, 0.5, 0.035, 0.06));
    const halo = await page.evaluate(() => window.__DL__.patch(0.155, 0.5, 0.03, 0.05));
    await page.screenshot({ path: `${OUT}${TAG}-sweep-${scale.toFixed(2)}.png` });
    console.log(`  x${scale.toFixed(2)}  opening ${JSON.stringify(hole)}  wall ${JSON.stringify(halo)}`);
  }
}

/**
 * THE POCKET. The one shot here that is not about how the doorway looks.
 *
 * A player who arrives and turns straight round has not re-armed the exit
 * threshold - see `armed` in systems/doors.js - so nothing takes them out and
 * nothing darkens the screen, and the interior's z bound lets them walk to
 * -139.5, half a metre PAST the sheet at -141.06. This is that half-metre,
 * looking back at it, and it is the shot that proves the material is genuinely
 * DoubleSide rather than merely commented as such: single-sided, this frame is
 * a hole in the world.
 *
 * Taken THROUGH THE PAUSE, which is the only honest way to reach it from a
 * harness. Teleporting there while the loop is live re-arms the threshold and
 * doors.js takes the player straight out to the courtyard, which is the game
 * working correctly and a photograph of the wrong thing - the first run of this
 * came back a picture of the avenue. Paused, main.js renders the frame at delta
 * zero and calls no update at all, so the camera can stand somewhere the loop
 * would never leave it. The pause panel is hidden for the capture; it is a DOM
 * overlay and hiding it does not touch a pixel of the rendered frame.
 */
{
  await page.evaluate(() => {
    const g = window.__SANDS__;
    g.pause.open();
  });
  await page.evaluate(() => window.__DL__.frames(4));
  await page.evaluate(() => {
    const g = window.__SANDS__;
    g.player.teleport({ x: 0, y: 0, z: -139.6 });
    g.rig.reset(0, -0.02);              // yaw 0 faces -Z, back at the sheet
    g.rig.update(0, g.player, false);
  });
  await page.evaluate(() => window.__DL__.frames(8));

  const back = await page.evaluate(() => window.__DL__.patch(0.5, 0.5, 0.05, 0.08));
  const png = await page.evaluate(() => window.__DL__.canvasPng());
  writeFileSync(`${OUT}${TAG}-pocket.png`, Buffer.from(png, 'base64'));
  await page.evaluate(() => window.__SANDS__.pause.resume());

  console.log(`--- the pocket: z -139.6 facing -Z, BEHIND the sheet, paused ---`);
  console.log(`  back face ${JSON.stringify(back)}   ${OUT}${TAG}-pocket.png`);
  console.log(`  (a black or near-black reading here means the sheet is single-sided)`);
}

const ray = await page.evaluate(() => window.__DL__.probeRay(1));
// The control. A ray the other way must hit the room's far wall; if it does
// not, the raycast is broken and the empty result above says nothing at all.
const control = await page.evaluate(() => window.__DL__.probeRay(-1));

await browser.close();

console.log('--- looking back at the entry from inside ---');
for (const r of results) {
  console.log(`${r.name.padEnd(10)} z=${String(r.z).padStart(7)}  ` +
    `opening ${JSON.stringify(r.hole)}  wall ${JSON.stringify(r.wall)}  ` +
    `veil=${r.veil.veil} (${r.veil.phase})`);
  console.log(`           ${r.path}`);
}

console.log('--- ray from (0, 2.0, -145) toward the entry (+Z) ---');
console.log(ray.length ? ray.map((h) => JSON.stringify(h)).join('\n') : '  NOTHING IN THE OPENING');
console.log('--- control ray, same origin, into the room (-Z) ---');
console.log(control.length ? control.map((h) => JSON.stringify(h)).join('\n') : '  NOTHING (raycast is broken)');

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
if (errors.length) {
  console.log('--- console errors ---');
  for (const e of errors) console.log(e);
}
console.log(errors.length ? `FAIL: ${errors.length} console error(s)` : 'console clean');
