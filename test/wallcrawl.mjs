/**
 * DOES THE GOLD SCARAB ACTUALLY LEAVE THE FLOOR, AND DOES IT STAND UP ON WHAT
 * IT LEAVES IT FOR.
 *
 * THE CONTROL IS THE POINT OF THIS FILE, and it is written that way because
 * this project has now shipped three green harnesses through the defect they
 * were written for. The identical run is played twice, in the same process, on
 * the same tile of the same room: once with `goldscarab` and once with the
 * ordinary `scarab`, which is the enemy this feature was deliberately NOT given.
 * If the control also leaves the ground plane then the thing being measured is
 * a ramp, or a ledge, or a body being launched by the collision resolver, and
 * not a wall crawl - and the check would then pass forever whether or not
 * enemies/wallcrawl.js existed at all.
 *
 * Four claims, and each of them can fail on its own:
 *
 *   1. it gets off the floor. Measured as height above `ctx.heightAt` under its
 *      own feet, so a room with a raised floor cannot fake it.
 *   2. it ORIENTS. The body's own up-axis is pulled out of the group quaternion
 *      every frame; on a wall it has to lie down flat (up.y near 0) and on a
 *      ceiling it has to invert (up.y near -1). A beetle whose feet still point
 *      at the floor while it slides up stone is the exact failure this is for.
 *   3. it still arrives. A crawler that spends the round on the ceiling is a
 *      round that does not end.
 *   4. the crit survives. The whole gold scarab design is that its one soft
 *      panel is the vent on the back of the abdomen, and a change that moved a
 *      `userData.region` would break it silently: the hitscan would go on
 *      working and simply never pay 100 again.
 *
 * THE ROOM IS THE HALL OF OFFERINGS, base 0 and a 9 m ceiling, with the player
 * pinned in its north half well clear of the column row at z -153.5. The north
 * wall carries no doorway, so the box the crawler mounts runs floor to ceiling
 * and its top is a real ceiling rather than the breast under a sill - which is
 * the distinction topsOut() in wallcrawl.js exists to make.
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1200);

const out = await page.evaluate(async () => {
  const g = window.__SANDS__;

  const PLAYER = { x: -45, z: -144 };
  const START = { x: -34, z: -145 };
  const SECONDS = 45;
  const dt = 1 / 60;

  /** The crawl's surface enum, spelled out for the trace. */
  const NAME = ['floor', 'wall', 'ceiling'];

  if (!g.director.placeAt) return { fatal: 'director.placeAt not available' };

  function openEverything() {
    for (const d of g.doors.all) {
      if (d.open) d.open();
      for (let i = 0; i < 400 && !d.opened; i++) if (d.advance) d.advance(1 / 30);
    }
  }

  /**
   * The body's own up-axis, in world space, straight out of the group
   * quaternion.
   *
   * This is the second column of the rotation matrix and it is written out
   * rather than taken from three, because the claim being tested is about what
   * is ON THE SCENE GRAPH: reading it back through the same library call the
   * renderer uses is the closest a harness gets to reading the pixels.
   */
  function upAxis(q) {
    const { x, y, z, w } = q;
    return {
      x: 2 * (x * y - w * z),
      y: 1 - 2 * (x * x + z * z),
      z: 2 * (y * z + w * x),
    };
  }

  /** One variant, one placement, one pinned player. */
  async function run(id) {
    g.director.reset();
    g.spaces.enter('interior', { x: PLAYER.x, z: PLAYER.z, rot: 0 });
    openEverything();
    await new Promise((r) => requestAnimationFrame(r));

    // No wave may begin during the run. An extra half-dozen shamblers would
    // body-block the approach and turn this into a measurement of separation.
    g.director.state.timer = 1e9;

    g.player.position.x = PLAYER.x;
    g.player.position.z = PLAYER.z;

    const actor = g.director.placeAt(id, START.x, START.z);
    if (!actor) return { fatal: `could not place a ${id}` };

    const ctx = g.director.ctx;
    let clock = 0;
    let maxAbove = 0;
    let framesOff = 0;
    let minUpY = 1;
    let wallUpAbs = 0;      // worst |up.y| while genuinely settled on a wall
    let wallFrames = 0;
    let roofUpY = 1;        // worst (least inverted) up.y while on a ceiling
    let roofFrames = 0;
    let closest = Math.hypot(START.x - PLAYER.x, START.z - PLAYER.z);
    let surfMax = 0;
    let peakUpY = 1;
    let mountedAt = -1;
    const trace = [];
    let lastKey = '';

    const frames = Math.round(SECONDS / dt);
    for (let i = 0; i < frames; i++) {
      clock += dt;
      // Pinned. Every metre closed is the crawler's own doing.
      g.player.position.x = PLAYER.x;
      g.player.position.z = PLAYER.z;
      g.director.update(dt, clock);
      if (!actor.live) break;

      const p = actor.position;
      const floor = ctx.heightAt ? ctx.heightAt(p.x, p.z, 0) : 0;
      const above = p.y - floor;
      const up = upAxis(actor.group.quaternion);
      const c = actor.crawl;

      if (above > maxAbove) { maxAbove = above; peakUpY = up.y; }
      if (above > 0.6) framesOff++;
      if (up.y < minUpY) minUpY = up.y;

      if (c && c.transit <= 0) {
        if (c.surf === 1) { wallFrames++; wallUpAbs = Math.max(wallUpAbs, Math.abs(up.y)); }
        if (c.surf === 2) { roofFrames++; roofUpY = Math.min(roofUpY, up.y); }
        if (c.surf > surfMax) { surfMax = c.surf; if (mountedAt < 0) mountedAt = clock; }
      }

      const d = Math.hypot(p.x - PLAYER.x, p.z - PLAYER.z);
      if (d < closest) closest = d;

      /**
       * The route it actually took, one line per change of surface.
       *
       * Recorded rather than summarised, because a pass on "it reached the
       * ceiling" cannot tell a body that climbed there from a body the
       * collision resolver launched there. These timestamps are the arithmetic
       * in wallcrawl.js checked against the simulation: a climb runs at
       * WALL_MUL x 3.9 = 2.42 m of surface a second, and the gap between the
       * mount and the lip either agrees with the distance covered or it does
       * not.
       */
      if (c) {
        const key = c.transit > 0 ? `turning onto the ${NAME[c.surf]}` : `on the ${NAME[c.surf]}`;
        if (key !== lastKey) {
          lastKey = key;
          trace.push(`${clock.toFixed(2).padStart(6)} s  ${key.padEnd(26)}`
            + `at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`
            + `   ${d.toFixed(1)} m from the player`);
        }
      }
    }

    const rig = actor.rig;
    const neckHeads = rig.neck
      ? rig.neck.children.filter((m) => m.isMesh && m.userData.region === 'head').length
      : -1;
    const heads = rig.meshes.filter((m) => m.userData.region === 'head').length;

    return {
      id,
      maxAbove: +maxAbove.toFixed(2),
      secondsOff: +(framesOff * dt).toFixed(2),
      minUpY: +minUpY.toFixed(3),
      peakUpY: +peakUpY.toFixed(3),
      wallFrames,
      wallUpAbs: +wallUpAbs.toFixed(3),
      roofFrames,
      roofUpY: +roofUpY.toFixed(3),
      surfMax,
      mountedAt: mountedAt < 0 ? null : +mountedAt.toFixed(2),
      closest: +closest.toFixed(2),
      trace,
      hasCrawl: !!actor.crawl,
      vent: rig.vent ? rig.vent.userData.region : null,
      heads,
      neckHeads,
    };
  }

  /**
   * DOES THE ROUND STILL END.
   *
   * The one way this feature could be a net loss is an enemy that lives out of
   * reach: a body that spends the wave on a ceiling is a wave that never
   * concludes, which is the same failure the wedge escape and DETOUR_S's
   * forceSide were both written against, arriving by a new road. Six of them at
   * once in the biggest room on the map - the Great Gallery, 52 x 38 with a 16 m
   * ceiling and two colonnades - is the worst case the map has: the longest
   * climbs, the most stone to be boxed in behind, and every one of them running
   * the wall search on the same wall list in the same frame.
   *
   * IT EARNED ITS PLACE ON THE FIRST RUN. The point (0, -192) drops a body onto
   * the gallery's upper ledge at y 6, and from up there the wall search picked
   * the head slab over a doorway - a box whose base is BELOW the ledge, so it
   * passed every filter - walked at a part of it the ledge does not reach, timed
   * out, and picked the same slab again. That crawler spent the entire 45 s at
   * surface 0 and never got within 13.55 m. See FAIL_GIVEUP in wallcrawl.js for
   * the fix; this paragraph is here so the next person to loosen that cooldown
   * knows what it is holding shut.
   *
   * AND THE BAR IS A COMPARISON, NOT AN ABSOLUTE. The same six points are played
   * twice, gold and ordinary, and the clutch that can leave the floor has to
   * arrive at least as often as the clutch that cannot. The first instinct on
   * seeing one body fail was that the ledge is a second storey and enemies/
   * flow.js only ever floods one - which is true, it says so in its own header,
   * and it was NOT the cause: the control scarab from that identical point
   * arrived at 1.8 m. A control is the difference between fixing this and
   * filing it against the flow field.
   */
  async function swarm(id) {
    g.director.reset();
    g.spaces.enter('interior', { x: 0, z: -177, rot: 0 });
    openEverything();
    await new Promise((r) => requestAnimationFrame(r));
    g.director.state.timer = 1e9;

    const P = { x: 0, z: -177 };
    g.player.position.x = P.x;
    g.player.position.z = P.z;

    const at = [
      { x: -18, z: -190 }, { x: 18, z: -190 }, { x: -18, z: -164 },
      { x: 18, z: -164 }, { x: 0, z: -192 }, { x: 0, z: -163 },
    ];
    const crew = [];
    for (const p of at) {
      const a = g.director.placeAt(id, p.x, p.z);
      if (a) crew.push({ a, closest: Infinity, off: 0 });
    }
    if (crew.length < at.length) return { fatal: `only placed ${crew.length} of ${at.length}` };

    const ctx = g.director.ctx;
    const frames = Math.round(SECONDS / dt);
    let clock = 0;
    for (let i = 0; i < frames; i++) {
      clock += dt;
      g.player.position.x = P.x;
      g.player.position.z = P.z;
      g.director.update(dt, clock);
      for (const c of crew) {
        if (!c.a.live) continue;
        const p = c.a.position;
        const floor = ctx.heightAt ? ctx.heightAt(p.x, p.z, p.y) : 0;
        if (p.y - floor > 0.6) c.off++;
        const d = Math.hypot(p.x - P.x, p.z - P.z);
        if (d < c.closest) c.closest = d;
      }
    }

    return {
      id,
      n: crew.length,
      closest: crew.map((c) => +c.closest.toFixed(2)),
      offPct: crew.map((c) => Math.round((c.off / frames) * 100)),
      arrived: crew.filter((c) => c.closest < 2.5).length,
      climbed: crew.filter((c) => c.off > 0).length,
    };
  }

  const gold = await run('goldscarab');
  const plain = await run('scarab');
  const sixGold = await swarm('goldscarab');
  const sixPlain = await swarm('scarab');
  return { gold, plain, sixGold, sixPlain };
});

if (out.fatal) { console.log(`FATAL  ${out.fatal}`); await browser.close(); process.exit(1); }
for (const r of [out.gold, out.plain, out.sixGold, out.sixPlain]) {
  if (r && r.fatal) { console.log(`FATAL  ${r.fatal}`); await browser.close(); process.exit(1); }
}

const G = out.gold, P = out.plain, S = out.sixGold, SP = out.sixPlain;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

console.log('the Hall of Offerings, 45 simulated seconds, player pinned at (-45, -144):');
const show = (r, label) => {
  console.log(`  ${label.padEnd(20)}peak ${String(r.maxAbove).padStart(6)} m above the floor`
    + `   off-floor ${String(r.secondsOff).padStart(6)} s`
    + `   min up.y ${String(r.minUpY).padStart(7)}`
    + `   closest ${String(r.closest).padStart(6)} m`);
  console.log(`  ${''.padEnd(20)}wall ${String(r.wallFrames).padStart(5)} frames (worst |up.y| ${r.wallUpAbs})`
    + `   roof ${String(r.roofFrames).padStart(5)} frames (worst up.y ${r.roofUpY})`
    + `   first mount ${r.mountedAt === null ? '  never' : `${r.mountedAt} s`}`);
};
show(G, 'goldscarab');
show(P, 'CONTROL scarab');

console.log('\nthe gold scarab\'s route, one line per change of surface:');
for (const t of G.trace) console.log(`  ${t}`);
console.log(`\nthe control has no surface state to trace: actor.crawl is ${P.hasCrawl ? 'ALLOCATED' : 'null'}.`);
console.log('');

// 1. it leaves the floor, and the control does not.
ok(G.maxAbove > 3, `the gold scarab climbs (peak ${G.maxAbove} m above its own floor)`);
ok(G.surfMax === 2, `and reaches the ceiling (deepest surface ${G.surfMax}, 2 = roof)`);
ok(G.secondsOff > 3, `and stays up there long enough to be seen (${G.secondsOff} s off the floor)`);

// THE CONTROL. If this passes, nothing above is measuring a wall crawl.
ok(P.maxAbove < 0.6, `CONTROL: the ordinary scarab never leaves the floor (peak ${P.maxAbove} m)`);
ok(P.secondsOff === 0, `CONTROL: not for a single frame (${P.secondsOff} s)`);
ok(P.minUpY > 0.99, `CONTROL: and never tips off its own up-axis (min up.y ${P.minUpY})`);
ok(!P.hasCrawl, 'CONTROL: it is not even given the state to do it (actor.crawl is null)');
ok(G.hasCrawl, 'and the gold scarab is (actor.crawl is allocated)');

// 2. the body orients to the surface rather than staying +Y.
ok(G.wallFrames > 30 && G.wallUpAbs < 0.2,
  `on a wall its up-axis lies flat with the normal (worst |up.y| ${G.wallUpAbs} over ${G.wallFrames} frames)`);
ok(G.roofFrames > 30 && G.roofUpY < -0.9,
  `on the ceiling it inverts (worst up.y ${G.roofUpY} over ${G.roofFrames} frames)`);
ok(G.minUpY < -0.9, `so the up-axis genuinely tracks the surface, it does not stay +Y (min ${G.minUpY})`);

// 3. it still gets to the player.
ok(G.closest < 2.5, `and it still arrives (closest ${G.closest} m)`);
ok(P.closest < 2.5, `CONTROL: so does the ordinary scarab (closest ${P.closest} m)`);

// 4. the crit surface survived the change.
ok(G.vent === 'head', `the vent is still tagged a crit (region ${G.vent})`);
ok(G.heads === 2, `and only the abdomen and the vent are (${G.heads} crit meshes)`);
ok(G.neckHeads === 0, `the skull is still NOT a crit (${G.neckHeads} crit meshes on the neck)`);

console.log('');
console.log('the same six points in the Great Gallery, 45 s, player pinned at (0, -177):');
const clutch = (r, label) => {
  console.log(`  ${label.padEnd(18)}closest ${r.closest.map((v) => String(v).padStart(6)).join(' ')}  m`);
  console.log(`  ${''.padEnd(18)}off-floor ${r.offPct.map((v) => String(v).padStart(4)).join(' ')}  % of the run`);
  console.log(`  ${''.padEnd(18)}${r.arrived} of ${r.n} arrived, ${r.climbed} left the floor`);
};
clutch(S, 'goldscarab x6');
clutch(SP, 'CONTROL scarab x6');
console.log('');

ok(S.climbed >= 4, `most of a clutch gets off the floor (${S.climbed} of ${S.n} did)`);
ok(SP.climbed === 0, `CONTROL: none of the ordinary clutch does (${SP.climbed} of ${SP.n})`);
// The comparison, not an absolute. See the note on swarm().
ok(S.arrived >= SP.arrived,
  `climbing costs the clutch no arrivals (${S.arrived} of ${S.n} against the control's ${SP.arrived})`);
ok(Math.max(...S.offPct) < 70,
  `and none of them lives up there (worst spends ${Math.max(...S.offPct)}% of the run off the floor)`);

ok(errors.length === 0, 'no console errors');
if (errors.length) for (const e of errors.slice(0, 5)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
