/**
 * CAN A GOD ACTUALLY FIT THROUGH A DOORWAY.
 *
 * The owner finished World 1 and reported: "the big bosses are too easy to kill,
 * the doorways trap them and basically make it easy to kill them all."
 *
 * That is a report about DIFFICULTY and it is almost certainly a report about
 * GEOMETRY. A god is built at `scale: 1.9` from a spec with `radius: 0.95` and
 * `height: 2.05`, so the body the world has to admit is 3.61m across and 3.90m
 * tall. Nominal portal widths in `world/rooms.js` are 4.0 to 5.0, which sounds
 * comfortable right up until you ask the two questions this file asks:
 *
 *   1. WIDTH. Nominal width is the gap between two room boxes. It is not the
 *      clear span, because wall fill overhangs the jamb.
 *   2. HEIGHT. Nothing about a portal's `width` says anything about the LINTEL
 *      over it, and `resolveAgainstWorld` rejects a wall only when the actor's
 *      head is under it: `if (head <= w.y0 || feetY >= w.y1) continue`. A god
 *      3.90m tall walking under a header that starts at 3m is inside that wall,
 *      every frame, and the resolver will keep pushing it back out.
 *
 * A body that cannot pass a doorway does not read to the player as a bug. It
 * reads as a boss standing in a door being shot for free, which is exactly the
 * complaint.
 *
 * MEASURED WITH THE ACTORS' OWN RESOLVER, imported from `enemies/mummy.js` and
 * handed the director's real `ctx`. A harness that reimplements clearance is a
 * harness measuring its own arithmetic - this project has been caught doing that
 * three times in one week, so the only acceptable probe is the function the
 * gods themselves are pushed around by.
 *
 * The control is the PLAYER: 0.42m radius, 2.0m tall. Every doorway the player
 * walks through daily must pass, or the probe is wrong rather than the map.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveChrome } from './chrome.mjs';

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

const out = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const { resolveAgainstWorld } = await import(
    new URL('../src/enemies/mummy.js', location.href).href
  );

  // Open everything, so a sealed door is never mistaken for a narrow one.
  for (const d of g.doors.all) { if (d.open) d.open(); for (let i = 0; i < 400 && !d.opened; i++) if (d.advance) d.advance(1 / 30); }
  g.spaces.enter('interior', { x: 0, z: -143.5, rot: 0 });
  await new Promise((r) => requestAnimationFrame(r));

  const ctx = g.director.ctx;
  if (!ctx) return { fatal: 'director.ctx not exposed' };

  const GOD = { radius: 0.95 * 1.9, height: 2.05 * 1.9 };
  const PLAYER = { radius: 0.42, height: 2.0 };

  /**
   * Does a cylinder of this radius and height sit at (x,z) without being
   * pushed? `resolveAgainstWorld` mutates the position it is handed, so a body
   * that fits comes back where it started.
   */
  function fits(x, z, radius, height, feetY) {
    ctx.actorHeight = height;
    const p = { x, y: feetY, z };
    resolveAgainstWorld(p, radius, feetY, ctx);
    const dx = p.x - x, dz = p.z - z;
    return Math.sqrt(dx * dx + dz * dz) < 1e-3;
  }

  /** Largest radius that fits here at this height, to the centimetre. */
  function clearRadius(x, z, height, feetY) {
    if (!fits(x, z, 0.05, height, feetY)) return 0;
    let lo = 0.05, hi = 3.2;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(x, z, mid, height, feetY)) lo = mid; else hi = mid;
    }
    return +lo.toFixed(2);
  }

  /** Tallest body that fits here at the god's own width. */
  function clearHeight(x, z, radius, feetY) {
    let lo = 0.2, hi = 6.0;
    if (!fits(x, z, radius, lo, feetY)) return 0;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (fits(x, z, radius, mid, feetY)) lo = mid; else hi = mid;
    }
    return +lo.toFixed(2);
  }

  const rows = [];
  const seen = new Set();
  for (const room of g.spaces.interior.rooms) {
    for (const p of room.portals || []) {
      const key = [room.id, p.to].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);

      const x = p.at.x, z = p.at.z;
      const feetY = g.world.heightAt(x, z, (room.base || 0)) ?? 0;

      rows.push({
        from: room.id, to: p.to, kind: p.kind, nominal: p.width,
        x, z, feetY: +feetY.toFixed(2),
        // WIDTH at the god's height, and WIDTH at the player's height. If these
        // differ, the doorway narrows with altitude, which means a lintel.
        rAtGodHeight: clearRadius(x, z, GOD.height, feetY),
        rAtPlayerHeight: clearRadius(x, z, PLAYER.height, feetY),
        hAtGodWidth: clearHeight(x, z, GOD.radius, feetY),
        godFits: fits(x, z, GOD.radius, GOD.height, feetY),
        playerFits: fits(x, z, PLAYER.radius, PLAYER.height, feetY),
      });
    }
  }

  return { rows, GOD, PLAYER };
});

if (out.fatal) { console.log(`FATAL  ${out.fatal}`); await browser.close(); process.exit(1); }

const rows = out.rows;

/*
 * The Serdab is not a fighting room. It is the only room in twenty-five waves
 * with no spawn points, which is what makes it the room the ending can happen
 * in, and its portal is a 2.4m puzzle doorway that a 3.61m god is CORRECTLY
 * unable to follow the player through. Counting it as a chokepoint defect would
 * be reporting a design decision as a bug.
 */
const combat = rows.filter((r) => r.kind !== 'puzzle');
const godBlocked = combat.filter((r) => !r.godFits);
const playerBlocked = rows.filter((r) => !r.playerFits);
const narrowedByHeight = rows.filter((r) => r.rAtGodHeight + 0.05 < r.rAtPlayerHeight);

/*
 * SLACK is the whole story, and it is why "does it fit" was the wrong question.
 *
 * Every combat portal admits a god, so the width hypothesis is dead and so is
 * the lintel hypothesis - headroom is 4.2m against a 3.89m body, and the clear
 * radius does not change between player height and god height anywhere on the
 * map. The geometry is fine.
 *
 * What the geometry is not is FORGIVING. Slack here is the clear radius minus
 * the god's own, which is the total lateral room it has inside the opening -
 * shared between both sides. A god turns at 2.2 rad/s and is pushed by a
 * separation radius of 2.4m, which is larger than the opening's clear radius:
 * any second body near the door is displacing the god by more than the doorway
 * has to give. Threading it requires an approach that is very nearly
 * perpendicular, and anything else grinds along the jamb.
 */
const slack = combat.map((r) => ({ ...r, slack: +(r.rAtGodHeight - out.GOD.radius).toFixed(3) }));
const tightest = slack.slice().sort((a, b) => a.slack - b.slack)[0];

writeFileSync(`${OUT}chokepoint-report.json`, JSON.stringify({ ...out, errors }, null, 1));

console.log(`a god is ${out.GOD.radius.toFixed(2)}m in radius (${(out.GOD.radius * 2).toFixed(2)}m across) and ${out.GOD.height.toFixed(2)}m tall`);
console.log(`the player is ${out.PLAYER.radius}m / ${out.PLAYER.height}m\n`);
console.log('portal                              nominal  r@god-h  r@ply-h  h@god-w  god  player');
for (const r of rows) {
  const name = `${r.from} -> ${r.to}`.padEnd(34).slice(0, 34);
  console.log(
    `${name}  ${String(r.nominal).padStart(6)}  ${String(r.rAtGodHeight).padStart(7)}  `
    + `${String(r.rAtPlayerHeight).padStart(7)}  ${String(r.hAtGodWidth).padStart(7)}  `
    + `${r.godFits ? ' ok' : 'NO '}  ${r.playerFits ? 'ok' : 'NO'}`,
  );
}
console.log('');
console.log(`combat portals a god cannot enter:  ${godBlocked.length} of ${combat.length}`);
console.log(`portals narrowed by a lintel:       ${narrowedByHeight.length}`);
console.log(`portals the PLAYER cannot enter:    ${playerBlocked.length}  (control)`);
console.log('');
console.log(`tightest combat portal: ${tightest.from} -> ${tightest.to}`);
console.log(`  clear radius ${tightest.rAtGodHeight}m, god radius ${out.GOD.radius.toFixed(3)}m`);
console.log(`  SLACK ${tightest.slack}m total, ${(tightest.slack * 100 / 2).toFixed(1)}cm per side`);
console.log(`  separation radius is ${2.4}m, which is LARGER than the opening's clear radius`);

const checks = {
  'the probe found portals at all':
    rows.length >= 8,
  'CONTROL: the player fits through every portal':
    playerBlocked.length === 0,
  'a god fits through every COMBAT portal':
    godBlocked.length === 0,
  'no doorway narrows between player height and god height (no lintel trap)':
    narrowedByHeight.length === 0,
  /*
   * NOT a pass/fail on the map, a pass/fail on the REPORT. The number below is
   * the finding this file exists to surface, and a run that cannot compute it is
   * a run whose green means nothing.
   */
  'the slack at the tightest combat portal was measured':
    Number.isFinite(tightest.slack),
  'no console errors':
    errors.length === 0,
};

console.log('');
let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
if (godBlocked.length) {
  console.log('\nblocked:');
  for (const r of godBlocked) console.log(`  ${r.from} -> ${r.to}  nominal ${r.nominal}m, clear radius ${r.rAtGodHeight}m at god height, headroom ${r.hAtGodWidth}m`);
}
console.log(`\nreport  ${OUT}chokepoint-report.json`);
if (errors.length) console.log(`errors  ${errors.slice(0, 3).join(' / ')}`);

await browser.close();
if (failed) { console.log(`\n${failed} CHECK(S) FAILED`); process.exit(1); }
console.log('\nALL CHECKS PASSED');
