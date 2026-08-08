/**
 * WHAT IS STANDING BETWEEN THE GALLERY AND ACT 3.
 *
 * `test/godfield.mjs` narrowed it to a band on the GALLERY side of all three
 * Act 3 doorways, roughly z -189 to -195, which is shut to a god both laterally
 * and overhead while a shambler routes around it. This dumps the actual world at
 * those points - floor height, the surface overhead, and every wall box and
 * collider whose extent reaches a god's 1.805 disc - so the thing blocking it is
 * NAMED rather than inferred.
 *
 * Three hypotheses have already died in this session (doorway width, a lintel,
 * then a god-width flood) and each died to a measurement. This exists so a
 * fourth is not guessed at.
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';

const BASE = process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

/**
 * Where to look, so this is reusable rather than a one-off.
 *
 *   node test/act3probe.mjs "-17,0,17" -228 -238 0
 *
 * xs, then the z range, then the height the floor sampler is asked FROM. That
 * last one matters and is not cosmetic: a descent's surface near the doorway is
 * at the sill, not at the room base, so asking from the base reports a floor six
 * metres under the body's feet. Defaults are the gallery-side Act 3 approach.
 */
const XS = (process.argv[2] || '-20,0,20').split(',').map(Number);
const Z_FROM = Number(process.argv[3] ?? -196);
const Z_TO = Number(process.argv[4] ?? -210);
const FROM_Y = Number(process.argv[5] ?? 0);

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1200);

const out = await page.evaluate(async ({ XS, Z_FROM, Z_TO, FROM_Y }) => {
  const g = window.__SANDS__;
  for (const d of g.doors.all) {
    if (d.open) d.open();
    for (let i = 0; i < 400 && !d.opened; i++) if (d.advance) d.advance(1 / 30);
  }
  g.spaces.enter('interior', { x: 0, z: -143.5, rot: 0 });
  await new Promise((r) => requestAnimationFrame(r));

  const ctx = g.director.ctx;
  const GOD_PAD = 0.95 * 1.9, GOD_H = 2.05 * 1.9;

  // The band the approach profiles put the obstruction in, on the gallery side
  // of the west, centre and east Act 3 doorways.
  const rows = [];
  for (const x of XS) {
    for (let z = Z_FROM; z >= Z_TO - 0.001; z -= 1) {
      // Asked from the THRESHOLD height, not the room base. These approaches are
      // descent ramps running from the doorway sill at absolute 0 down to an Act
      // 3 floor at -6, so a body entering the door is on the ramp, not on the
      // room's floor, and sampling at the base would ask about a surface six
      // metres under its feet.
      const floorY = ctx.heightAt(x, z, FROM_Y);
      const top = ctx.heightAt(x, z);

      const walls = [];
      if (ctx.walls) {
        for (const w of ctx.walls) {
          if (Math.abs(x - w.x) < w.w / 2 + GOD_PAD && Math.abs(z - w.z) < w.d / 2 + GOD_PAD) {
            walls.push({ x: +w.x.toFixed(1), z: +w.z.toFixed(1), w: +w.w.toFixed(1),
              d: +w.d.toFixed(1), y0: +w.y0.toFixed(2), y1: +w.y1.toFixed(2) });
          }
        }
      }

      const cols = [];
      const near = ctx.colliderGrid.near(x, z, GOD_PAD);
      for (let i = 0; i < near; i++) {
        const c = ctx.colliderGrid.out[i];
        const dx = x - c.x, dz = z - c.z;
        if (dx * dx + dz * dz < (c.r + GOD_PAD) * (c.r + GOD_PAD)) {
          cols.push({ x: +c.x.toFixed(1), z: +c.z.toFixed(1), r: +c.r.toFixed(2),
            h: +(c.h ?? 0).toFixed(2), y0: c.y0 === undefined ? null : +c.y0.toFixed(2),
            tag: c.tag || c.type || '' });
        }
      }

      rows.push({
        x, z,
        floorY: +floorY.toFixed(2),
        top: +top.toFixed(2),
        overhead: top > floorY + 0.65 && top - floorY < GOD_H,
        walls, cols,
      });
    }
  }
  return { rows };
}, { XS, Z_FROM, Z_TO, FROM_Y });

for (const r of out.rows) {
  const bits = [];
  if (r.overhead) bits.push(`OVERHEAD top=${r.top} floor=${r.floorY}`);
  for (const w of r.walls) bits.push(`wall(${w.x},${w.z} ${w.w}x${w.d} y${w.y0}..${w.y1})`);
  for (const c of r.cols) bits.push(`col(${c.x},${c.z} r${c.r} h${c.h}${c.y0 === null ? '' : ' y0=' + c.y0}${c.tag ? ' ' + c.tag : ''})`);
  console.log(`x=${String(r.x).padStart(4)} z=${String(r.z).padStart(6)}  floor=${String(r.floorY).padStart(6)} top=${String(r.top).padStart(6)}  ${bits.join('  ') || 'clear'}`);
}
console.log('errors:', errors.length);
await browser.close();
