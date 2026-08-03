/**
 * WHERE CAN YOU STAND IN THE QUARRY AND THE CANAL AND NOT BE ABLE TO MOVE?
 *
 * The owner: "theres a few corners where we get stuck, like litereqally cant
 * move." That is a report about specific places, and the only useful answer is
 * a list of coordinates - not a theory about the resolver, and not a fix
 * applied to whatever geometry looked suspicious when someone read the file.
 *
 * So this sweeps. Both spaces, on a grid, and at every point it asks the body
 * to walk in eight directions and measures how far it actually got.
 *
 * WHAT MAKES A POINT BAD, and the two are different failures:
 *
 *   - STUCK: no direction moves the player more than STUCK_M. This is the
 *     owner's report exactly. You are standing still and the game will not let
 *     you leave.
 *   - POCKET: fewer than three of the eight work. You can leave, but only by
 *     finding the one gap, which from inside the game reads as the world
 *     grabbing you. Worth reporting separately because it is the shape a stuck
 *     corner has just before it closes, and because a fix that clears every
 *     STUCK while leaving POCKETs everywhere has not fixed the feel.
 *
 * TWO STAGES, because the wide net and the trustworthy instrument are not the
 * same tool:
 *
 *   1. SWEEP with direct `player.update()` calls. Thousands of points, cheap.
 *      `test/kite.mjs` warns in its own header that a movement test driven by a
 *      tight update() loop has produced twelve false failures on this project,
 *      and that warning is respected rather than ignored: stage one's output is
 *      treated as CANDIDATES, never as findings.
 *   2. CONFIRM every candidate cluster on REAL requestAnimationFrame frames
 *      with REAL KeyboardEvents through main.js's own binding table. A point
 *      only appears in the verdict if it failed both.
 *
 * The collider census at each bad point is reported with it - how many cylinders
 * overlap the body there, and their radii - so the diagnosis is data rather than
 * a story about what probably happened.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** A point is STUCK if the best of eight directions moved it less than this. */
const STUCK_M = 0.12;
/** Fewer than this many working directions is a POCKET. */
const MIN_EXITS = 3;
/*
 * TWO GRIDS, because one grid fine enough to trust is too slow to run.
 *
 * Every `player.update()` tests the body against all 662 exterior cylinders,
 * twice, so the cost of this file is (points x directions x frames x 1324).
 * A 0.5 m grid over both spaces came to roughly five billion distance checks
 * and was still running after five minutes with no way to tell how far along it
 * was. That is not a harness, it is a hang.
 *
 * So: a COARSE pass at 1.0 m to find neighbourhoods, then a FINE pass at 0.35 m
 * in a ring around every hit. The body is 0.84 m wide, so a 1.0 m grid can
 * straddle a narrow trap - the fine pass is what makes the coordinates worth
 * quoting, and the coarse pass is what makes it affordable to get there.
 */
const COARSE = 1.0;
const FINE = 0.35;
/** How far around a coarse hit the fine pass looks. */
const REFINE_R = 1.2;
/** At most this many STUCK neighbourhoods get the fine treatment. */
const MAX_REFINE = 40;

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

// ---------------------------------------------------------------------------
// open both gates, because a sealed gate is a wall and a wall is not a bug
// ---------------------------------------------------------------------------

const gates = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const out = [];
  for (const c of g.courtyard.claims) {
    if (c.open) c.open();
    // The slab grinds down over about a second and a half; advance it to done
    // rather than waiting on wall clock.
    for (let i = 0; i < 400 && !c.opened; i++) if (c.advance) c.advance(1 / 30);
    out.push({ id: c.id, opened: !!c.opened });
  }
  return out;
});

// ---------------------------------------------------------------------------
// stage 1: the sweep
// ---------------------------------------------------------------------------

const sweepPromise = page.evaluate(async (cfg) => {
  const g = window.__SANDS__;
  const RADIUS = 0.42, EYE = 1.68;
  const world = g.world;

  const DIRS = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    DIRS.push({ i, x: Math.sin(a), z: -Math.cos(a) });
  }

  /** Cylinders whose footprint overlaps the body standing at (x, z). */
  const census = (x, z) => {
    const feet = world.heightAt ? world.heightAt(x, z) : 0;
    const hits = [];
    for (const c of world.colliders) {
      const base = c.y0 === undefined ? feet : c.y0;
      if (feet - base > c.h) continue;
      if (base - feet > EYE) continue;
      const dx = x - c.x, dz = z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < c.r + RADIUS) hits.push({ r: +c.r.toFixed(2), d: +d.toFixed(2), overlap: +(c.r + RADIUS - d).toFixed(2) });
    }
    return hits;
  };

  /*
   * Settle the body onto the ground ONCE per point, then reset to that settled
   * pose before each of the eight walks.
   *
   * `teleport` takes the FLOOR the player arrives standing on, so the ground
   * height is read here rather than assumed to be zero - the same assumption
   * that broke nineteen checks when the descent shipped. Re-settling before
   * every direction was most of the cost of the first version of this file and
   * bought nothing: the settled pose is the same pose every time.
   */
  const settle = (x, z) => {
    const y = world.heightAt ? world.heightAt(x, z) : 0;
    g.player.teleport({ x, y, z });
    for (let i = 0; i < 12; i++) {
      g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
      if (g.player.state.grounded) break;
    }
    return { x: g.player.position.x, y: g.player.position.y, z: g.player.position.z };
  };

  const restore = (p) => {
    g.player.position.x = p.x; g.player.position.y = p.y; g.player.position.z = p.z;
    g.player.velocity.x = 0; g.player.velocity.y = 0; g.player.velocity.z = 0;
  };

  const walk = (dir) => {
    const p0 = { x: g.player.position.x, z: g.player.position.z };
    /*
     * THE YAW IS THE THIRD ARGUMENT TO update(), AND IT IS NOT READ FROM THE RIG.
     *
     * update() does `forward.set(-sin(yaw), 0, -cos(yaw))` from the value it is
     * PASSED. The first version of this file set the rig and then passed 0, so
     * every one of the eight directions walked due -z and the file reported one
     * direction eight times.
     *
     * The tell was in its own output and went unread: 947 bad points, 100% of
     * them STUCK, ZERO pockets. A world does not fail that uniformly. Uniformity
     * across every case is the shape of a broken instrument, which is the same
     * lesson the sixteen unreachable spawn points taught this project in July.
     *
     * The rig is still set, because the crosshair and anything reading the
     * camera should agree with the direction being walked, but the yaw that
     * MOVES the body is the one handed to update().
     */
    const yaw = Math.atan2(-dir.x, -dir.z);
    g.rig.reset(yaw, -0.02);
    g.rig.update(1 / 60, g.player, false);
    for (let i = 0; i < 14; i++) {
      g.player.update(1 / 60, { forward: 1, strafe: 0, sprint: false, jump: false }, yaw);
    }
    return Math.hypot(g.player.position.x - p0.x, g.player.position.z - p0.z);
  };

  /** Probe one standing position. Returns null when the point is fine. */
  const probe = (regionName, x, z) => {
    const pose = settle(x, z);
    // A point the body could not even be placed at is not a stuck corner, it is
    // outside the world. Skip rather than report.
    if (Math.hypot(pose.x - x, pose.z - z) > 1.5) return null;

    const moved = [];
    for (const d of DIRS) {
      restore(pose);
      moved.push(+walk(d).toFixed(3));
    }

    const best = Math.max(...moved);
    const exits = moved.filter((m) => m > cfg.stuckM).length;
    if (best > cfg.stuckM && exits >= cfg.minExits) return null;

    return {
      region: regionName,
      x: +x.toFixed(2), z: +z.toFixed(2),
      best, exits, moved,
      kind: best <= cfg.stuckM ? 'STUCK' : 'POCKET',
      census: census(x, z),
    };
  };

  const results = [];
  const seen = new Set();
  const key = (x, z) => `${x.toFixed(2)}:${z.toFixed(2)}`;
  let coarsePoints = 0;

  /*
   * PROGRESS, because the first two versions of this file were indistinguishable
   * from a hang. A sweep that prints nothing until it finishes is not something
   * anyone can decide to wait for. The node side polls this between phases.
   */
  window.__STUCK_PROGRESS__ = { phase: 'coarse', done: 0, total: 0, found: 0 };

  const P = window.__STUCK_PROGRESS__;
  for (const region of cfg.regions) {
    P.total += Math.ceil((region.maxX - region.minX) / cfg.coarse + 1)
             * Math.ceil((region.maxZ - region.minZ) / cfg.coarse + 1);
  }

  for (const region of cfg.regions) {
    // --- coarse
    P.phase = `coarse:${region.name}`;
    const hits = [];
    for (let x = region.minX; x <= region.maxX; x += cfg.coarse) {
      for (let z = region.minZ; z <= region.maxZ; z += cfg.coarse) {
        coarsePoints++;
        P.done++;
        const r = probe(region.name, x, z);
        if (r) { hits.push(r); results.push(r); seen.add(key(x, z)); P.found++; }
        // Yield so the node side can read progress and so the tab stays alive.
        if (coarsePoints % 200 === 0) await new Promise((res) => setTimeout(res, 0));
      }
    }

    /*
     * FINE PASS, AROUND STUCK POINTS ONLY, AND CAPPED.
     *
     * Refining around every coarse hit was the second thing that made this file
     * look like a hang: POCKET points are common along any wall - a wall is
     * SUPPOSED to remove most of your exits - and each one bought a 7x7 ring of
     * fine probes. That is thousands of extra points spent confirming that walls
     * are solid. Only STUCK points get refined, because only STUCK is the bug
     * the owner reported, and the count is capped so one bad region cannot
     * silently turn a three-minute run into an hour.
     */
    P.phase = `fine:${region.name}`;
    const toRefine = hits.filter((h) => h.kind === 'STUCK').slice(0, cfg.maxRefine);
    for (const h of toRefine) {
      for (let x = h.x - cfg.refineR; x <= h.x + cfg.refineR + 1e-6; x += cfg.fine) {
        for (let z = h.z - cfg.refineR; z <= h.z + cfg.refineR + 1e-6; z += cfg.fine) {
          if (x < region.minX || x > region.maxX || z < region.minZ || z > region.maxZ) continue;
          if (seen.has(key(x, z))) continue;
          seen.add(key(x, z));
          const r = probe(region.name, x, z);
          if (r) { results.push(r); P.found++; }
        }
      }
      await new Promise((res) => setTimeout(res, 0));
    }
  }

  return { results, coarsePoints, probed: seen.size };
}, {
  coarse: COARSE,
  fine: FINE,
  refineR: REFINE_R,
  maxRefine: MAX_REFINE,
  stuckM: STUCK_M,
  minExits: MIN_EXITS,
  regions: [
    { name: 'quarry', minX: 16.0, maxX: 41.0, minZ: -20.0, maxZ: 27.0 },
    { name: 'canal', minX: -46.0, maxX: -15.0, minZ: -21.0, maxZ: 21.0 },
  ],
});

/*
 * Poll the in-page counter while the sweep runs.
 *
 * The sweep yields to the event loop every 200 points precisely so this can get
 * a word in. Without it there is no way to tell a long run from a hung one, and
 * this file was killed twice for exactly that reason before it ever produced a
 * number.
 */
let sweepDone = false;
sweepPromise.then(() => { sweepDone = true; }, () => { sweepDone = true; });
console.log('sweeping...');
while (!sweepDone) {
  await new Promise((r) => setTimeout(r, 4000));
  if (sweepDone) break;
  try {
    const p = await page.evaluate(() => window.__STUCK_PROGRESS__ || null);
    if (p) console.log(`  ${String(p.phase).padEnd(16)} ${p.done}/${p.total} points   ${p.found} bad`);
  } catch { /* the page is mid-loop; try again next tick */ }
}
const sweep = await sweepPromise;
console.log('');

// ---------------------------------------------------------------------------
// cluster, so a wall does not read as two hundred separate findings
// ---------------------------------------------------------------------------

function cluster(points, radius = 1.6) {
  const left = points.slice();
  const out = [];
  while (left.length) {
    const seed = left.shift();
    const group = [seed];
    for (let i = left.length - 1; i >= 0; i--) {
      if (group.some((p) => Math.hypot(p.x - left[i].x, p.z - left[i].z) <= radius)) {
        group.push(left.splice(i, 1)[0]);
        i = left.length;   // a joined point can pull in its own neighbours
      }
    }
    const stuck = group.filter((p) => p.kind === 'STUCK');
    out.push({
      region: seed.region,
      n: group.length,
      stuck: stuck.length,
      // The worst point in the cluster is the one worth confirming and quoting.
      worst: group.reduce((a, b) => (a.best <= b.best ? a : b)),
      cx: +(group.reduce((s, p) => s + p.x, 0) / group.length).toFixed(2),
      cz: +(group.reduce((s, p) => s + p.z, 0) / group.length).toFixed(2),
    });
  }
  return out.sort((a, b) => (b.stuck - a.stuck) || (a.worst.best - b.worst.best));
}

const clusters = cluster(sweep.results);
const stuckClusters = clusters.filter((c) => c.stuck > 0);

// ---------------------------------------------------------------------------
// stage 2: confirm the worst on real frames with real keys
// ---------------------------------------------------------------------------

const CONFIRM = stuckClusters.slice(0, 12);

const confirmed = [];
for (const c of CONFIRM) {
  const r = await page.evaluate(async (p) => {
    const g = window.__SANDS__;
    const world = g.world;

    const frames = async (n) => {
      for (let i = 0; i < n; i++) await new Promise((res) => requestAnimationFrame(res));
    };

    const y = world.heightAt ? world.heightAt(p.x, p.z) : 0;
    g.player.teleport({ x: p.x, y, z: p.z });
    for (let i = 0; i < 60; i++) {
      g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
      if (g.player.state.grounded) break;
    }
    await frames(4);

    const start = { x: g.player.position.x, z: g.player.position.z };
    let best = 0;
    const per = [];

    // Eight real walks, each with a real key held for 30 real frames.
    for (let i = 0; i < 8; i++) {
      g.player.teleport({ x: p.x, y, z: p.z });
      await frames(2);
      /*
       * Same yaw convention as the sweep, and it has to be: forward in this
       * game is (-sin yaw, 0, -cos yaw), so a direction (dx, dz) is faced by
       * yaw = atan2(-dx, -dz). Feeding the angle straight in as the yaw would
       * walk each probe ninety degrees away from the direction it is named
       * after, and eight wrong directions still cover the compass - which is
       * exactly the kind of bug that passes.
       */
      const a = (i / 8) * Math.PI * 2;
      const dx = Math.sin(a), dz = -Math.cos(a);
      g.rig.reset(Math.atan2(-dx, -dz), -0.02);
      g.rig.update(1 / 60, g.player, false);
      const p0 = { x: g.player.position.x, z: g.player.position.z };

      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
      await frames(30);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
      await frames(2);

      const d = Math.hypot(g.player.position.x - p0.x, g.player.position.z - p0.z);
      per.push(+d.toFixed(3));
      best = Math.max(best, d);
    }

    return { start, best: +best.toFixed(3), per };
  }, { x: c.worst.x, z: c.worst.z });

  confirmed.push({
    region: c.region,
    x: c.worst.x, z: c.worst.z,
    sweepBest: c.worst.best,
    realBest: r.best,
    realPer: r.per,
    agrees: r.best <= STUCK_M,
    n: c.n, stuck: c.stuck,
    census: c.worst.census,
  });
}

const realStuck = confirmed.filter((c) => c.agrees);

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

writeFileSync(`${OUT}stuck-report.json`, JSON.stringify({
  gates, stuckM: STUCK_M, coarse: COARSE, fine: FINE,
  totals: {
    badPoints: sweep.results.length,
    stuckPoints: sweep.results.filter((p) => p.kind === 'STUCK').length,
    pocketPoints: sweep.results.filter((p) => p.kind === 'POCKET').length,
    clusters: clusters.length,
    stuckClusters: stuckClusters.length,
  },
  clusters, confirmed, sweep: sweep.results, probed: sweep.probed, coarsePoints: sweep.coarsePoints, errors,
}, null, 1));

console.log(`gates            ${gates.map((g) => `${g.id}=${g.opened}`).join('  ')}`);
console.log(`grid             coarse ${COARSE} m, fine ${FINE} m, stuck threshold ${STUCK_M} m`);
console.log(`probed           ${sweep.probed} standing positions (${sweep.coarsePoints} coarse)`);
console.log('');
console.log(`bad points       ${sweep.results.length}  (${sweep.results.filter((p) => p.kind === 'STUCK').length} stuck, ${sweep.results.filter((p) => p.kind === 'POCKET').length} pocket)`);
console.log(`clusters         ${clusters.length}  (${stuckClusters.length} containing stuck points)`);
console.log(`confirmed real   ${realStuck.length} of ${confirmed.length} checked on real frames`);
console.log('');

for (const c of confirmed) {
  const tag = c.agrees ? 'STUCK' : 'sweep-only';
  console.log(`${tag.padEnd(11)} ${c.region.padEnd(7)} x ${String(c.x).padStart(7)}  z ${String(c.z).padStart(7)}   sweep ${String(c.sweepBest).padStart(6)}  real ${String(c.realBest).padStart(6)}  cluster ${c.n} pts  ${c.census.length} cylinders`);
}

console.log('');
console.log(`report           ${OUT}stuck-report.json`);
if (errors.length) console.log(`errors           ${errors.slice(0, 3).join(' / ')}`);

await browser.close();
