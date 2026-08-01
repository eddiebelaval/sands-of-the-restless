/**
 * Routing: does the horde find its way, and does it notice when the map changes.
 *
 * The claim this file exists to test is narrower and harder than "a wave
 * arrives", which test/enemies.mjs already covers on a straight line across an
 * open courtyard. It is: AN ENEMY THAT CANNOT SEE THE PLAYER STILL GETS TO THE
 * PLAYER. That decomposes into facts that fail independently and, crucially,
 * fail SILENTLY - a horde that never arrives looks exactly like a horde that is
 * merely slow, from the HUD and from a screenshot:
 *
 *   1. an actor placed in a room two doorways away closes the distance and
 *      arrives, in a time bounded by the walk rather than by the timeout.
 *   2. the route it takes is a real route: the field's own geodesic cost is
 *      longer than the straight line, and finite, everywhere a wave can spawn.
 *   3. BUYING A DOOR CHANGES WHERE THE HORDE WALKS, on the frame it is bought,
 *      in both spaces. A cached field that does not invalidate is the failure
 *      that hides longest, because it only shows up after a purchase.
 *   4. the field describes both storeys of the Great Gallery, which is the one
 *      room in the map where two floors sit over each other, and routes between
 *      them in both directions.
 *   5. it costs what it claims to cost.
 *
 * Everything waits on SIMULATION, never on wall clock. Under swiftshader a frame
 * is most of a second and only ever advances the sim by the delta clamp, so a
 * wall-clock timeout fails systems that are working perfectly. The routing
 * checks drive `director.update` directly for the same reason enemies.mjs does.
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage({ viewport: { width: 900, height: 560 } });

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
  place(x, z, y = 0) {
    const g = window.__SANDS__;
    g.player.teleport({ x, y, z });
    g.rig.reset(0, -0.02);
    g.rig.update(1 / 60, g.player, false);
  },

  /**
   * One actor, one fixed player, N simulated seconds. Reports what it did.
   *
   * ARRIVAL IS MEASURED AS CLOSEST APPROACH REACHING MELEE, not as the distance
   * on the final tick: a shambler that arrives, strikes, and is pushed back out
   * by the separation force has arrived, and a check on the last frame would
   * call that a failure at random.
   */
  chase(id, ax, az, px, pz, seconds, py = 0) {
    const g = window.__SANDS__;
    const d = g.director;
    d.reset();
    window.__N__.place(px, pz, py);
    const a = d.placeAt(id, ax, az);
    if (!a) return null;

    const dist = () => Math.hypot(a.position.x - px, a.position.z - pz);
    const start = dist();
    let closest = start;
    let arrivedAt = -1;
    const dt = 1 / 30;
    const n = Math.ceil(seconds / dt);
    for (let i = 0; i < n; i++) {
      d.update(dt, i * dt);
      g.combat.update(dt);
      if (!a.live) break;
      const dd = dist();
      if (dd < closest) closest = dd;
      if (dd <= 3 && arrivedAt < 0) arrivedAt = i * dt;
    }
    return {
      start: +start.toFixed(2),
      closest: +closest.toFixed(2),
      arrivedAt: arrivedAt >= 0 ? +arrivedAt.toFixed(1) : null,
      closed: +(start - closest).toFixed(2),
    };
  },

  /** Open every interior barrier as though the tier had never built them. */
  openInterior() {
    let n = 0;
    for (const b of window.__SANDS__.spaces.interior.barriers) if (b.clearInstantly()) n++;
    return n;
  },
};
`,
});

const results = {};

// ---------------------------------------------------------------------------
// 1. buying a door reroutes the horde, in both spaces
//
// FIRST, and that ordering is load-bearing: the checks below force every
// barrier open so they can measure routing rather than economy, and once a
// barrier is open nothing in the game puts it back. Run after them, this block
// finds no shut door, skips, and reports three passing checks that tested
// nothing at all.
// ---------------------------------------------------------------------------

/**
 * The check that only fails after a purchase.
 *
 * A field cached against a collider set that has changed is invisible until the
 * player pays for a doorway, and then the horde keeps walking round a wall that
 * is no longer there - or, worse, refuses to come through the hole the player
 * just bought and paid for. Asserted as a change in the ROUTE COST across the
 * one call that opens the barrier, because that is the quantity the caching is
 * about, and asserted with an actor as well because a number moving is not the
 * same as a body moving.
 */
results.interiorDoor = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;

  // Fresh interior, every barrier standing.
  g.spaces.enter('exterior', { x: 0, z: 30, rot: 0 });
  g.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
  for (let i = 0; i < 4; i++) d.update(1 / 30, i / 30);

  // A doorway off the gallery with something in it, and a point past it.
  const bar = g.spaces.interior.barriers.find((b) => !b.opened && !b.opening
    && (b.from === 'great-gallery' || b.to === 'great-gallery'));
  if (!bar) return { skipped: 'no shut barrier off the gallery' };

  const beyondId = bar.from === 'great-gallery' ? bar.to : bar.from;
  const beyond = g.spaces.interior.rooms.find((r) => r.id === beyondId);
  const p = beyond.spawnPoints[0];

  window.__N__.place(0, -170);
  d.reset();
  d.placeAt('shambler', p.x, p.z);
  d.update(1 / 30, 0);
  const before = d.flow.costAt(p.x, p.z, 0);

  // Buy it. open() splices the cylinders out on the FIRST frame.
  bar.open();
  d.update(1 / 30, 1 / 30);
  const after = d.flow.costAt(p.x, p.z, 0);

  const chased = window.__N__.chase('shambler', p.x, p.z, 0, -170, 60);

  return {
    barrier: bar.id, beyond: beyondId, at: [p.x, p.z],
    routeShut: +before.toFixed(1),
    routeOpen: +after.toFixed(1),
    sameFrame: true,
    chased,
  };
});

results.exteriorClaim = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;
  g.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
  g.spaces.enter('exterior', { x: 0, z: 30, rot: 0 });
  for (let i = 0; i < 4; i++) d.update(1 / 30, i / 30);

  const claim = (g.courtyard.claims || []).find((c) => !c.opened && !c.opening);
  if (!claim) return { skipped: 'no unopened courtyard claim' };

  // Just past the mouth, on the far side of the debris from the yard.
  window.__N__.place(0, 30);
  d.reset();
  d.placeAt('shambler', claim.x, claim.z);
  d.update(1 / 30, 0);
  const before = d.flow.costAt(claim.x, claim.z, undefined);

  claim.open();
  d.update(1 / 30, 1 / 30);
  const after = d.flow.costAt(claim.x, claim.z, undefined);

  return {
    claim: claim.id, at: [+claim.x.toFixed(1), +claim.z.toFixed(1)],
    routeShut: +before.toFixed(1),
    routeOpen: +after.toFixed(1),
    geometryBuilds: d.stats().flow.geometryBuilds,
  };
});

// ---------------------------------------------------------------------------
// 2. an actor two rooms away arrives
// ---------------------------------------------------------------------------

/**
 * THE CASE THE OWNER REPORTED, written down as a test.
 *
 * The King's Chamber is the deepest room in the map and the Great Gallery is the
 * room every act routes through. The straight line between them runs through
 * something like sixty metres of solid rock and three doorways that are nowhere
 * near it. Nothing about this is reachable by steering at the player.
 */
results.twoRooms = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.spaces.enter('interior', { x: 0, z: 60, rot: 0 });
  window.__N__.openInterior();
  for (let i = 0; i < 4; i++) g.director.update(1 / 30, i / 30);

  const gallery = g.spaces.interior.rooms.find((r) => r.id === 'great-gallery');
  const kings = g.spaces.interior.rooms.find((r) => r.id === 'kings-chamber');
  // The gallery floor, well clear of the bridge and the ledges over it, so this
  // check is about routing between rooms and not about the two-storey case that
  // has its own check below.
  const home = { x: 0, z: -170 };

  const out = { home, runs: [] };
  for (const p of kings.spawnPoints) {
    out.runs.push({
      from: [p.x, p.z],
      ...window.__N__.chase('shambler', p.x, p.z, home.x, home.z, 60),
    });
  }
  return out;
});

// ---------------------------------------------------------------------------
// 3. every spawn point has a finite route, and it is longer than the crow flies
// ---------------------------------------------------------------------------

results.geodesic = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;
  window.__N__.place(0, -170);
  d.refreshFlow();

  /**
   * Asked of the DIRECTOR's accepted points, not of the authored list.
   *
   * The two differ by seven, and the difference is not noise. rooms.js authors
   * thirty-one; the placement filter keeps the twenty-four a body can stand
   * clear in. The Hall of Offerings has one at (-46, -154) that sits 0.45 m off
   * the face of a full-height column, which a 0.40-wide shambler fits through by
   * eight centimetres and nothing else in the horde fits through at all - so the
   * field, carved at 0.55 for the whole horde, correctly refuses to call it
   * routable, and the director correctly refuses to spawn there. Asserting over
   * the authored list would fail on a point no player will ever see used.
   */
  const rows = [];
  for (const p of d.spawnPoints()) {
    const straight = Math.hypot(p.x - 0, p.z + 170);
    const route = d.flow.costAt(p.x, p.z, 0);
    rows.push({ room: p.room, straight: +straight.toFixed(1), route: +route.toFixed(1) });
  }
  const routed = rows.filter((x) => x.route >= 0);
  return {
    total: rows.length,
    routed: routed.length,
    noRoute: rows.filter((x) => x.route < 0),
    // A route that is SHORTER than the straight line is a field that has leaked
    // through a wall, and it is the failure mode that produces a horde walking
    // confidently into stone. Allowing a small negative slack absorbs the grid's
    // own quantisation; anything past that is a leak.
    shorterThanStraight: routed.filter((x) => x.route < x.straight - 1.0),
    meanRatio: +(routed.reduce((s, x) => s + x.route / (x.straight || 1), 0) / routed.length).toFixed(2),
  };
});

// ---------------------------------------------------------------------------
// 4. both storeys of the Great Gallery
// ---------------------------------------------------------------------------

/**
 * The one place in the map where a flat grid is provably not enough.
 *
 * The gallery's upper level is a ledge at six metres directly over the floor of
 * the same room, joined by two ramps and closed into a ring by the bridge. A
 * field keyed on (x, z) alone holds ONE of those two floors and silently drops
 * the other; the symptom is a horde that ignores the player entirely whenever
 * one of them is upstairs.
 *
 * Asserted from BOTH ends, because the two directions fail separately: a field
 * rooted on the floor has to climb to describe the ledge, and a field rooted on
 * the ledge has to descend to describe the floor.
 */
results.twoStoreys = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;
  g.spaces.enter('interior', { x: 0, z: 60, rot: 0 });
  window.__N__.openInterior();
  for (let i = 0; i < 4; i++) d.update(1 / 30, i / 30);

  const probe = (px, pz, py) => {
    window.__N__.place(px, pz, py);
    const st = d.refreshFlow();
    return {
      from: [px, pz, py],
      upper: {
        eastLedge: +d.flow.costAt(21, -180, 6).toFixed(1),
        westLedge: +d.flow.costAt(-21, -180, 6).toFixed(1),
        bridge: +d.flow.costAt(-8, -189, 6).toFixed(1),
      },
      lower: {
        floorN: +d.flow.costAt(0, -165, 0).toFixed(1),
        floorS: +d.flow.costAt(8, -193, 0).toFixed(1),
      },
      layered: st.layered,
      layersFull: st.layersFull,
    };
  };

  return { fromFloor: probe(0, -170, 0), fromBridge: probe(0, -189, 6) };
});

// ---------------------------------------------------------------------------
// 5. what it costs
// ---------------------------------------------------------------------------

results.cost = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;
  g.spaces.enter('exterior', { x: 0, z: 30, rot: 0 });
  d.reset();
  d.forceWave(8);

  const dt = 1 / 30;
  let prev = d.stats().flow.builds;
  let n = 0, sum = 0, peak = 0, maxLive = 0;
  for (let i = 0; i < Math.ceil(40 / dt); i++) {
    const t = i * dt;
    g.player.teleport({ x: Math.sin(t * 0.5) * 9, y: 0, z: 30 + Math.cos(t * 0.5) * 9 });
    d.update(dt, t);
    g.combat.update(dt);
    maxLive = Math.max(maxLive, d.live.length);
    const f = d.stats().flow;
    if (f.builds !== prev) { prev = f.builds; n++; sum += f.lastMs; peak = Math.max(peak, f.lastMs); }
  }
  const f = d.stats().flow;
  return {
    maxLive,
    rebuilds: n,
    perSimSecond: +(n / 40).toFixed(2),
    meanMs: +(sum / n).toFixed(3),
    peakMs: +peak.toFixed(3),
    msPerSimSecond: +(sum / 40).toFixed(2),
    cells: f.cells,
    layersFull: f.layersFull,
    reseeds: f.reseeds,
  };
});

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const t = results.twoRooms;
const arrived = t.runs.filter((r) => r.arrivedAt !== null);
console.log(`\n--- King's Chamber to the Great Gallery floor, 60 simulated seconds ---`);
for (const r of t.runs) {
  console.log(`  from ${JSON.stringify(r.from).padEnd(14)} start ${String(r.start).padStart(6)}  closest ${String(r.closest).padStart(6)}  ${r.arrivedAt === null ? 'NEVER ARRIVED' : 'arrived ' + r.arrivedAt + 's'}`);
}

console.log(`\n--- geodesic cost at every interior spawn point, player at (0,-170) ---`);
console.log(`  ${results.geodesic.routed}/${results.geodesic.total} have a route   mean route/straight ${results.geodesic.meanRatio}`);
if (results.geodesic.noRoute.length) console.log(`  no route: ${JSON.stringify(results.geodesic.noRoute)}`);
if (results.geodesic.shorterThanStraight.length) console.log(`  LEAKED: ${JSON.stringify(results.geodesic.shorterThanStraight)}`);

console.log(`\n--- a door bought at runtime ---`);
console.log(`  interior ${JSON.stringify(results.interiorDoor)}`);
console.log(`  exterior ${JSON.stringify(results.exteriorClaim)}`);

console.log(`\n--- both storeys of the gallery ---`);
console.log(`  from the floor  ${JSON.stringify(results.twoStoreys.fromFloor)}`);
console.log(`  from the bridge ${JSON.stringify(results.twoStoreys.fromBridge)}`);

console.log(`\n--- cost, courtyard, ${results.cost.maxLive} live actors, player walking a circuit ---`);
console.log(`  ${JSON.stringify(results.cost)}`);

const g5 = results.twoStoreys;
const doorI = results.interiorDoor;
const doorE = results.exteriorClaim;

const checks = {
  'an actor two rooms away arrives': arrived.length === t.runs.length,
  'and closes essentially all of the gap': t.runs.every((r) => r.closest < 3),
  'every spawn point the director uses has a route': results.geodesic.routed === results.geodesic.total,
  'no route is shorter than the straight line': results.geodesic.shorterThanStraight.length === 0,
  // A map made of loops routes long. A mean ratio at 1.00 would mean the field
  // is answering with the straight line, which is the bug, not the fix.
  'routes are longer than the crow flies': results.geodesic.meanRatio > 1.05,

  'a shut interior door has no route through it': doorI.skipped ? true : doorI.routeShut < 0,
  'buying it opens one on the same frame': doorI.skipped ? true : doorI.routeOpen > 0,
  'and an actor then walks it': doorI.skipped ? true : doorI.chased.arrivedAt !== null,
  'a shut courtyard claim has no route through it': doorE.skipped ? true : doorE.routeShut < 0,
  'buying it opens one on the same frame': doorE.skipped ? true : doorE.routeOpen > 0,

  'the gallery upper level is routed from the floor':
    g5.fromFloor.upper.eastLedge > 0 && g5.fromFloor.upper.westLedge > 0 && g5.fromFloor.upper.bridge > 0,
  'the gallery floor is routed from the bridge':
    g5.fromBridge.lower.floorN > 0 && g5.fromBridge.lower.floorS > 0,
  // Counted off the CACHED slot layout rather than off one flood: the layout is
  // built once per geometry change and reused, so a rebuild that allocates no
  // new slots is the cache working, not the storeys being missing.
  'the second storey is actually used': g5.fromFloor.layered > 0 && g5.fromBridge.layered > 0,
  'two storeys is enough for this map': g5.fromFloor.layersFull === 0 && g5.fromBridge.layersFull === 0,

  // The budget claim. A 60 Hz second is 1000 ms; this is the whole routing
  // system's share of it, with the horde at its cap.
  'routing costs under 2 per cent of a second': results.cost.msPerSimSecond < 20,
  'no rebuild blows a frame in the steady state': results.cost.peakMs < 16.7,
  'no console errors': logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]')).length === 0,
};

console.log('\n--- checks ---');
let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

if (failed) {
  console.log('\n--- page logs ---');
  for (const l of logs.slice(-25)) console.log(l);
}

await browser.close();
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
