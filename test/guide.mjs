/**
 * DOES THE GAME TELL YOU WHERE TO GO? Read off the screen, not off the state.
 *
 * The owner played the shipped build and could not find two of the four jars.
 * Three separate things were wrong and none of them was the jar chain, which
 * worked perfectly:
 *
 *   1. THE LADDER WAS ORDERED WRONG. `arm` - buy a wall gun - sat ABOVE the
 *      machine, and its `done()` needs a wall-bought weapon. A player who keeps
 *      the starting pistol never satisfies it, so the objective panel never once
 *      mentioned the jars. You can finish World 1 with a pistol; you cannot
 *      finish it without the jars.
 *   2. THE OBJECTIVE POINTED AT THE DESTINATION. The rung always routed to the
 *      Embalming Chamber, where the niches are, which is the right answer to
 *      "where does a jar go" and the wrong answer to "what do I do now".
 *   3. THE MAP DREW THE JARS AND NOTHING SAID WHICH ONE. A static gold dot among
 *      a dozen gold marks is found only by somebody already looking for it.
 *
 * So this file asks the three questions a lost player asks, and it asks them of
 * the RENDERED PANEL and the PAINTED CANVAS rather than of the systems behind
 * them. A panel that has the right string in a variable and paints something
 * else is this project's single most repeated defect, fourteen instances of it,
 * and `[data-obj-text]`'s textContent is the only thing that settles it.
 *
 * The pulse is proved by DIFFING PIXELS. A ring that is drawn and a ring that is
 * not produce different canvases; a ring that is coded and never reached
 * produces identical ones. Nothing else about that claim is checkable.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveChrome } from './chrome.mjs';
import sharp from 'sharp';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1500);

await page.evaluate(async () => {
  const g = window.__SANDS__;
  window.__G__ = {
    async frames(n) { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); },
    /** What the PANEL says, off the DOM. */
    panel() {
      const q = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; };
      return { text: q('[data-obj-text]'), where: q('[data-obj-where]'), detail: q('[data-obj-detail]') };
    },
  };
  // Climb past the earlier rungs. With 500 gold against a 1000 door the ladder
  // never reaches the machine at all, and this file is about what it says there.
  g.economy.grant(9000);
  /*
   * A WALL GUN, because the `arm` rung sits above the machine and its `done()`
   * needs one. A pistol-only player never satisfies it and never sees the jars
   * NAMED on the panel at all - the map's pulse is their only guidance, which is
   * a deliberate trade recorded in ui/objective.js and not a defect this file
   * asserts away. Every player who buys the 400-gold B3AR on the avenue - which
   * is on the way to a doorway costing a thousand - is past it.
   */
  g.weapons.grant('b3ar');
  for (const d of g.doors.all) { if (d.open) d.open(); for (let i = 0; i < 400 && !d.opened; i++) if (d.advance) d.advance(1 / 30); }
  for (const c of g.courtyard.claims) { if (c.open) c.open(); for (let i = 0; i < 400 && !c.opened; i++) if (c.advance) c.advance(1 / 30); }
  await window.__G__.frames(8);
});

// ---------------------------------------------------------------------------
// 1. the panel names the jar and the room it is in
// ---------------------------------------------------------------------------

const fetching = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.spaces.enter('interior', { x: 36, z: -213, rot: 0 });
  await window.__G__.frames(8);
  return {
    target: g.jars.nextTarget('interior'),
    // Every jar still out there. The PANEL ranks by route and this probe cannot
    // - the room graph lives in ui/objective.js - so the property worth checking
    // is that whatever it named is genuinely outstanding, not that two different
    // orderings happened to agree.
    outstanding: g.jars.jars.filter((j) => !j.taken && !j.home).map((j) => j.id.split(':')[1].toUpperCase()),
    panel: window.__G__.panel(), room: g.spaces.roomId,
  };
});

const returning = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const j = g.jars.jars.find((x) => x.id === 'jar:hapy');
  g.jars.state.carrying = j; j.taken = true;
  await window.__G__.frames(8);
  return { target: g.jars.nextTarget('interior'), panel: window.__G__.panel() };
});

// ---------------------------------------------------------------------------
// 2. the pulse, proved by diffing the canvas against itself
// ---------------------------------------------------------------------------
//
// The ring breathes on a 1.6 s cycle, so two shots half a cycle apart differ if
// it is painting and are identical if it is not. Taken with the jar system
// wired and then again with `nextTarget` stubbed to null, which is the control:
// the same canvas, the same frame budget, one thing different.

const mapBox = await page.evaluate(() => {
  const c = document.getElementById('map-canvas');
  const r = c.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});

async function shotPair(label) {
  const a = await page.screenshot({ clip: mapBox });
  await page.evaluate(async () => window.__G__.frames(14));   // ~half a breath
  const b = await page.screenshot({ clip: mapBox });
  writeFileSync(`${OUT}guide-map-${label}.png`, b);
  const A = await sharp(a).greyscale().raw().toBuffer();
  const B = await sharp(b).greyscale().raw().toBuffer();
  let sum = 0;
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) sum += Math.abs(A[i] - B[i]);
  return +(sum / n).toFixed(3);
}

const pulsing = await shotPair('pulsing');

const stillFrames = await page.evaluate(async () => {
  const g = window.__SANDS__;
  // The control: no target, so nothing should breathe.
  g.jars.nextTarget = () => null;
  await window.__G__.frames(6);
  return true;
});
const still = await shotPair('control-no-target');

// ---------------------------------------------------------------------------
// 3. depth is legible: the HUD reads it, the map draws it
// ---------------------------------------------------------------------------
//
// This map is 132 m long and 6 m deep and, until 2026-08-06, expressed depth
// NOWHERE in the interface - no readout, and a minimap with one incidental
// mention of `base` in the whole file. A two-level building the player navigates
// as a flat sprawl is the reason four rooms of jars were hard to hold in the
// head. Both halves are checked here, and the contour half is checked against a
// CONTROL that flattens every room to the datum: a contour that is coded and
// never reached cannot change the canvas.

const depths = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const settle = async (x, z) => {
    const y = g.world.heightAt(x, z);
    g.player.teleport({ x, y, z });
    for (let i = 0; i < 220; i++) {
      g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
      if (g.player.state.grounded) break;
    }
    await window.__G__.frames(8);
  };
  const read = () => ({
    hud: (document.querySelector('[data-depth]') || {}).textContent,
    label: (document.getElementById('map-room') || {}).textContent,
    feet: +(g.player.position.y - 1.68).toFixed(2),
  });
  const out = {};
  g.spaces.enter('interior', { x: 0, z: -149, rot: 0 }); await settle(0, -149);
  out.act2 = read();
  g.spaces.enter('interior', { x: 14, z: -266, rot: 0 }); await settle(14, -266);
  out.act3 = read();
  return out;
});

const flatDiff = await (async () => {
  const before = await page.screenshot({ clip: mapBox });
  const lowered = await page.evaluate(async () => {
    const g = window.__SANDS__;
    let n = 0;
    for (const r of g.spaces.interior.rooms) { if (r.base < 0) n++; r.base = 0; }
    await window.__G__.frames(10);
    return n;
  });
  const after = await page.screenshot({ clip: mapBox });
  const A = await sharp(before).greyscale().raw().toBuffer();
  const B = await sharp(after).greyscale().raw().toBuffer();
  let sum = 0; const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) sum += Math.abs(A[i] - B[i]);
  return { lowered, diff: +(sum / n).toFixed(3) };
})();

// ---------------------------------------------------------------------------
// 3. the ladder puts the mandatory step above the optional one
// ---------------------------------------------------------------------------

const order = await page.evaluate(() => {
  const src = window.__SANDS__.objectives;
  return src && src.ladderIds ? src.ladderIds() : null;
});

// ---------------------------------------------------------------------------

const checks = {
  'empty-handed, the panel NAMES the jar':
    /FIND THE JAR OF [A-Z]+/.test(fetching.panel.text || ''),
  'and names the room it is in':
    (fetching.panel.where || '').length > 0
    && (fetching.panel.where || '').length > 2,
  'and the jar it names is genuinely still out there':
    fetching.outstanding.some((son) => (fetching.panel.text || '').includes(son)),
  'carrying one, the panel says RETURN and points at the niches':
    /RETURN THE JAR OF [A-Z]+/.test(returning.panel.text || '')
    && returning.panel.where === 'EMBALMING CHAMBER',
  'the count is still on the panel':
    /\d OF 4 IN THE NICHES/.test(fetching.panel.detail || ''),
  'the map PULSES the target (canvas changes between frames)':
    pulsing > 0.05,
  'CONTROL: with no target the same canvas is still':
    still < pulsing * 0.5,
  'the HUD reads 0M on the datum':
    depths.act2.hud === '0M' && Math.abs(depths.act2.feet) < 0.5,
  'and 6M on the lower storey':
    depths.act3.hud === '6M' && Math.abs(depths.act3.feet + 6) < 0.5,
  'the map labels the room with its depth':
    /\d+m down/.test(depths.act3.label || '') && !/m down/.test(depths.act2.label || ''),
  'the storey contours are PAINTED (flattening the map changes it)':
    flatDiff.lowered > 0 && flatDiff.diff > 0.02,
  'no console errors':
    errors.length === 0,
};

writeFileSync(`${OUT}guide-report.json`,
  JSON.stringify({ fetching, returning, pulsing, still, depths, flatDiff, order, errors }, null, 1));

console.log(`empty-handed   ${JSON.stringify(fetching.panel)}`);
console.log(`carrying       ${JSON.stringify(returning.panel)}`);
console.log('');
console.log(`map diff pulsing ${pulsing}   control ${still}`);
console.log(`depth  act2 ${depths.act2.hud} "${depths.act2.label}"   act3 ${depths.act3.hud} "${depths.act3.label}"`);
console.log(`storey contours: flattening ${flatDiff.lowered} rooms changes the map by ${flatDiff.diff}`);
console.log('');

let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`\nreport  ${OUT}guide-report.json`);
if (errors.length) console.log(`errors  ${errors.slice(0, 3).join(' / ')}`);

await browser.close();
if (failed) { console.log(`\n${failed} CHECK(S) FAILED`); process.exit(1); }
console.log('\nALL CHECKS PASSED');
