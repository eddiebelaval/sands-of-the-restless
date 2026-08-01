/**
 * Scratch probe. Finds actors that get stuck, in both spaces, and reports the
 * numbers. Not a suite; a measuring instrument used to set up the failing case
 * before any fix was written, and re-run against the same points afterwards.
 *
 * Every trial is one actor, one fixed player position, and forty-five simulated
 * seconds. Batched into one page.evaluate per space, because a round trip per
 * trial was most of the wall clock.
 */

import { chromium } from 'playwright';
import { resolveChrome } from '../test/chrome.mjs';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4931/index.html';
const TAG = process.argv[3] || 'run';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1400);

await page.addScriptTag({
  content: `
window.__N__ = {
  place(x, z, yaw = 0) {
    const g = window.__SANDS__;
    g.player.teleport({ x, y: 0, z });
    g.rig.reset(yaw, -0.02);
    g.rig.update(1 / 60, g.player, false);
  },
  openAll() {
    const g = window.__SANDS__;
    let n = 0;
    for (const b of g.spaces.interior.barriers) {
      if (b.clearInstantly()) n++;
    }
    return n;
  },
  trial(id, ax, az, px, pz, seconds) {
    const g = window.__SANDS__;
    const d = g.director;
    d.reset();
    window.__N__.place(px, pz, 0);
    const a = d.placeAt(id, ax, az);
    if (!a) return null;
    const dist = () => Math.hypot(a.position.x - px, a.position.z - pz);
    const start = dist();
    let min = start;
    const dt = 1 / 30;
    const n = Math.ceil(seconds / dt);
    let firstArrive = -1;
    let frozen = 0;
    let lx = a.position.x, lz = a.position.z;
    for (let i = 0; i < n; i++) {
      d.update(dt, i * dt);
      g.combat.update(dt);
      if (!a.live) break;
      const dd = dist();
      if (dd < min) min = dd;
      if (dd <= 3 && firstArrive < 0) firstArrive = i * dt;
      const moved = Math.hypot(a.position.x - lx, a.position.z - lz);
      if (moved < 0.004) frozen++;
      lx = a.position.x; lz = a.position.z;
    }
    return {
      from: [+ax.toFixed(1), +az.toFixed(1)],
      start: +start.toFixed(2),
      end: +dist().toFixed(2),
      closest: +min.toFixed(2),
      arrived: firstArrive >= 0 ? +firstArrive.toFixed(1) : null,
      frozenPct: +(frozen / n * 100).toFixed(0),
      at: [+a.position.x.toFixed(1), +a.position.z.toFixed(1)],
    };
  },
  /** Every trial for one space, in one round trip. */
  sweep(pts, px, pz, seconds) {
    const out = [];
    for (const p of pts) {
      const r = window.__N__.trial('shambler', p.x, p.z, px, pz, seconds);
      if (r) out.push(Object.assign({ room: p.room || null }, r));
    }
    return out;
  },
};
`,
});

const report = [];
const say = (s) => { report.push(s); console.log(s); };

// ---------------------------------------------------------------------------
// interior
// ---------------------------------------------------------------------------

const ires = await page.evaluate(() => {
  const g = window.__SANDS__;
  g.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
  const opened = window.__N__.openAll();
  for (let i = 0; i < 4; i++) g.director.update(1 / 30, i / 30);
  const home = g.spaces.interior.rooms.find((x) => x.id === 'great-gallery').spawnPoints[0];
  const pts = [];
  for (const r of g.spaces.interior.rooms) {
    for (const p of r.spawnPoints || []) pts.push({ x: p.x, z: p.z, room: r.id });
  }
  // FUSED WITH THE SWEEP ON PURPOSE. The page's rAF loop runs between any two
  // page.evaluate calls, and doors.js swaps the active space on the player's
  // position, so a setup call that entered the interior and a sweep call that
  // ran afterwards were measuring the horde in the OTHER world - actors at
  // z = -28 while the player stood at z = -193, every trial a false failure.
  const rows = window.__N__.sweep(pts, home.x, home.z, 45);
  return { opened, home: { x: home.x, z: home.z }, rows, space: g.spaces.active };
});

say(`[${TAG}] interior barriers forced open: ${ires.opened}`);
say(`[${TAG}] player home (great-gallery): (${ires.home.x}, ${ires.home.z})  space at end: ${ires.space}`);

const istuck = ires.rows.filter((r) => r.arrived === null);
say('');
say(`=== INTERIOR  shambler -> player in great-gallery, 45 simulated seconds ===`);
say(`trials ${ires.rows.length}   ARRIVED(<3m) ${ires.rows.length - istuck.length}   NEVER ARRIVED ${istuck.length}`);
for (const r of istuck) {
  say(`  STUCK ${String(r.room).padEnd(20)} from ${JSON.stringify(r.from).padEnd(16)} start ${String(r.start).padStart(6)} -> end ${String(r.end).padStart(6)}  closest ${r.closest}  frozen ${r.frozenPct}%  final ${JSON.stringify(r.at)}`);
}
const arrivedI = ires.rows.filter((r) => r.arrived !== null);
if (arrivedI.length) {
  const t = arrivedI.map((r) => r.arrived).sort((a, b) => a - b);
  say(`  arrival time  min ${t[0]}s  median ${t[t.length >> 1]}s  max ${t[t.length - 1]}s`);
}

// ---------------------------------------------------------------------------
// exterior
// ---------------------------------------------------------------------------

const eres = await page.evaluate(() => {
  const g = window.__SANDS__;
  g.spaces.enter('exterior', { x: 0, z: 30, rot: 0 });
  for (let i = 0; i < 4; i++) g.director.update(1 / 30, i / 30);
  const b = g.world.bounds;
  const minX = (b.minX ?? b.min) + 4, maxX = (b.maxX ?? b.max) - 4;
  const minZ = (b.minZ ?? b.min) + 4, maxZ = (b.maxZ ?? b.max) - 4;
  const pts = [];
  for (let x = minX; x <= maxX; x += 7) {
    for (let z = minZ; z <= maxZ; z += 7) {
      // Only points the director itself calls reachable, so the sweep is about
      // routing and never about a pocket nothing could ever walk out of.
      if (g.director.reachesPlayer(x, z)) pts.push({ x, z });
    }
  }
  return { rows: window.__N__.sweep(pts, 0, 30, 45), n: pts.length, space: g.spaces.active };
});

const estuck = eres.rows.filter((r) => r.arrived === null);
say('');
say(`=== EXTERIOR  shambler -> player at (0, 30), 45 simulated seconds ===`);
say(`trials ${eres.rows.length}   ARRIVED(<3m) ${eres.rows.length - estuck.length}   NEVER ARRIVED ${estuck.length}   (space at end: ${eres.space})`);
for (const r of estuck) {
  say(`  STUCK from ${JSON.stringify(r.from).padEnd(16)} start ${String(r.start).padStart(6)} -> end ${String(r.end).padStart(6)}  closest ${r.closest}  frozen ${r.frozenPct}%  final ${JSON.stringify(r.at)}`);
}
const arrivedE = eres.rows.filter((r) => r.arrived !== null);
if (arrivedE.length) {
  const t = arrivedE.map((r) => r.arrived).sort((a, b) => a - b);
  say(`  arrival time  min ${t[0]}s  median ${t[t.length >> 1]}s  max ${t[t.length - 1]}s`);
}

// ---------------------------------------------------------------------------
// what it cost
// ---------------------------------------------------------------------------

const cost = await page.evaluate(() => {
  const g = window.__SANDS__;
  const s = g.director.stats();
  return s.flow || { absent: true };
});
say('');
say(`=== FLOW FIELD COST (accumulated over the whole sweep) ===`);
say(JSON.stringify(cost, null, 2));

const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
say('');
say(`page errors: ${errs.length}`);
for (const e of errs.slice(0, 10)) say('  ' + e);

writeFileSync(new URL(`./navrepro-${TAG}.txt`, import.meta.url), report.join('\n') + '\n');
await browser.close();
