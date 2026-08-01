/**
 * What does the FIELD think, as opposed to what does an actor do.
 *
 * Separates the two failures that look identical from outside: the field having
 * no route (a carving problem) from an actor unable to walk a route the field
 * has (a steering problem).
 */

import { chromium } from 'playwright';
import { resolveChrome } from '../test/chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4931/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1400);

const HOMES = JSON.parse(process.argv[3] || '[[-24,-193],[0,-170],[0,-177],[-24,-162]]');

const out = await page.evaluate(([homes]) => {
  const g = window.__SANDS__;
  const d = g.director;

  g.spaces.enter('interior', { x: 0, z: 60, rot: 0 });
  for (const b of g.spaces.interior.barriers) b.clearInstantly();
  for (let i = 0; i < 4; i++) d.update(1 / 30, i / 30);

  const pts = [];
  for (const r of g.spaces.interior.rooms) {
    for (const p of r.spawnPoints || []) pts.push({ x: p.x, z: p.z, room: r.id });
  }

  const res = [];
  for (const [hx, hz] of homes) {
    g.player.teleport({ x: hx, y: 0, z: hz });
    g.rig.reset(0, -0.02);
    const st = d.refreshFlow();
    const rows = pts.map((p) => ({
      room: p.room, x: p.x, z: p.z,
      straight: +Math.hypot(p.x - hx, p.z - hz).toFixed(1),
      route: +d.flow.costAt(p.x, p.z, 0).toFixed(1),
    }));
    res.push({
      home: [hx, hz],
      floorUnderHome: g.world.heightAt(hx, hz, 0),
      roomAtHome: g.interior.roomAt(hx, hz)?.id || null,
      stats: st,
      noRoute: rows.filter((r) => r.route < 0),
      rows,
    });
  }
  return { pts: pts.length, res };
}, [HOMES]);

for (const r of out.res) {
  console.log(`\n=== HOME (${r.home[0]}, ${r.home[1]})  room=${r.roomAtHome}  floor=${r.floorUnderHome} ===`);
  console.log(`  field: visited ${r.stats.visited}/${r.stats.cells} cells, ${r.stats.lastMs} ms`);
  console.log(`  spawn points with NO ROUTE: ${r.noRoute.length}/${out.pts}`);
  for (const n of r.noRoute) console.log(`     none  ${n.room.padEnd(20)} (${n.x}, ${n.z})  straight ${n.straight}`);
  const w = r.rows.filter((x) => x.route >= 0);
  console.log(`  routed ${w.length}: ratio route/straight  ` +
    w.map((x) => (x.route / (x.straight || 1)).toFixed(2)).sort().join(' '));
}

console.log('\nerrors:', logs.filter((l) => l.includes('error')).slice(0, 8));
await browser.close();
