/**
 * Act 1 probe: the numbers, without the pictures.
 *
 * Split out from test/act1.mjs because a screenshot under swiftshader costs
 * about thirty seconds and the numbers cost nothing, and the numbers are what
 * decide whether the geometry is right. Answers three questions:
 *
 *   1. Is the floor where the geometry says it is - the trench three metres
 *      down, the terrace two and a half up, the causeway walkable over and
 *      passable under.
 *   2. Can the player get out. Twenty-four sprint directions from eight
 *      standpoints; anything that finishes on the bounds rectangle got there
 *      through a hole in a wall, because the rectangle is a backstop and not a
 *      surface anything is supposed to touch.
 *   3. Does the circuit connect. The wave director's own flood fill, asked
 *      whether the spawn point and the far side of each new space are on the
 *      same island, before and after the claims are opened.
 *
 * Usage: node test/act1probe.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4177/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist'],
});

const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.evaluate(() => document.getElementById('begin').click());
await page.evaluate(async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r));
});

const sealed = await page.evaluate(() => {
  const g = window.__SANDS__;
  return {
    claims: g.courtyard.claims.map((c) => ({ id: c.id, cost: c.cost, label: c.label })),
    decks: g.courtyard.decks.length,
    colliders: g.world.colliders.length,
    bounds: g.world.bounds,
  };
});

/** Walk probes, run twice: sealed, then open. */
async function walk() {
  return page.evaluate(() => {
    const g = window.__SANDS__;
    const b = g.world.bounds;
    const starts = [
      ['spawn', 0, 30], ['avenue-mid', 0, 0], ['quarry-mouth', 19, 22.5],
      ['quarry-mid', 28, 4], ['quarry-south', 25, -15], ['quarry-terrace', 35, 8],
      ['canal-mouth', -19, -13.5], ['canal-floor', -32, 0], ['canal-north', -27, 16],
      ['forecourt', 0, -25],
    ];
    const out = [];
    for (const [name, sx, sz] of starts) {
      let leaks = 0;
      let far = null;
      for (let d = 0; d < 24; d++) {
        g.player.position.set(sx, 6, sz);
        const yaw = (d / 24) * Math.PI * 2;
        for (let i = 0; i < 300; i++) {
          g.player.update(1 / 60, { forward: 1, strafe: 0, sprint: true, jump: false }, yaw);
        }
        const p = g.player.position;
        const onBound = Math.abs(p.x - b.minX) < 0.06 || Math.abs(p.x - b.maxX) < 0.06
          || Math.abs(p.z - b.minZ) < 0.06 || Math.abs(p.z - b.maxZ) < 0.06;
        if (onBound) leaks++;
        const dist = Math.hypot(p.x - sx, p.z - sz);
        if (!far || dist > far.dist) {
          far = { dist: +dist.toFixed(1), to: [+p.x.toFixed(1), +p.z.toFixed(1)], y: +p.y.toFixed(2) };
        }
      }
      out.push({ from: name, leaks, furthest: far });
    }
    return out;
  });
}

const walkSealed = await walk();

const heights = await page.evaluate(() => {
  const h = window.__SANDS__.world.heightAt;
  const at = (x, z, f) => +h(x, z, f).toFixed(2);
  return {
    avenue_grade: at(0, 10, 0),
    canal_bank_east: at(-19, 0, 0),
    canal_slope_east: at(-26.25, 0, -1),
    canal_floor: at(-32, 0, -3),
    canal_floor_under_causeway: at(-32, 7, -3.2),
    canal_deck_from_bank: at(-32, 7, 0),
    canal_slope_west: at(-39, 0, -2),
    canal_outside_north: at(-32, 24, 0),
    quarry_grade: at(24, 4, 0),
    quarry_ramp_foot: at(35, -7.5, 0),
    quarry_ramp_mid: at(35, -4.5, 1.2),
    quarry_ramp_top: at(35, -1.2, 2.4),
    quarry_terrace_on: at(35, 8, 2.6),
    quarry_terrace_from_below: at(35, 8, 0),
    breach_talus_top: at(17.5, -13.5, 2.5),
    breach_talus_from_avenue: at(17.5, -13.5, 0),
  };
});

/** The director's own connectivity answer. */
async function islands() {
  return page.evaluate(() => {
    const g = window.__SANDS__;
    const d = g.director;
    const nav = d.nav || (d.debug && d.debug.nav) || null;
    if (!nav || !nav.at) return { note: 'director exposes no nav handle; see walk probes' };
    const at = (x, z) => nav.at(x, z);
    return {
      spawn: at(0, 30), avenueMid: at(0, 0),
      quarry: at(28, 4), quarrySouth: at(25, -15),
      canal: at(-32, 0), canalNorth: at(-27, 16),
    };
  });
}
const islandsSealed = await islands();

const opened = await page.evaluate(() => {
  const g = window.__SANDS__;
  return g.courtyard.claims.map((c) => ({ id: c.id, opened: c.open() }));
});
await page.evaluate(async () => {
  for (let i = 0; i < 150; i++) await new Promise((r) => requestAnimationFrame(r));
});

const walkOpen = await walk();
const islandsOpen = await islands();

const after = await page.evaluate(() => ({
  colliders: window.__SANDS__.world.colliders.length,
}));

await browser.close();

const show = (t, v) => { console.log(`--- ${t} ---`); console.log(JSON.stringify(v, null, 2)); };
show('sealed', sealed);
show('heights', heights);
show('walk probes SEALED', walkSealed);
show('nav islands SEALED', islandsSealed);
show('opened', opened);
show('colliders after open', after);
show('walk probes OPEN', walkOpen);
show('nav islands OPEN', islandsOpen);

const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
for (const l of logs) console.log(l);
const leaks = [...walkSealed, ...walkOpen].reduce((a, r) => a + r.leaks, 0);
console.log(leaks ? `FAIL: ${leaks} walk(s) reached the bounds rectangle` : 'PASS: no walk reached the bounds rectangle');
console.log(errs.length ? `FAIL: ${errs.length} console error(s)` : 'PASS: no console errors');
process.exit(errs.length || leaks ? 1 : 0);
