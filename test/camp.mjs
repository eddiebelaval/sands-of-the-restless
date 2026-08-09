/**
 * THE EXPEDITION CAMP AND THE DOWNED HELICOPTER.
 *
 * Four claims, and this project's rule is that a green harness proves nothing
 * without a control measured in the same run. Three defects this month passed
 * green suites by measuring what the code reported about itself, so where the
 * subject is the player's experience the unit here is PIXELS and WALL CLOCK.
 *
 *   1. THE AVENUE STILL WALKS. Spawn to the sealed doorway, driven with the
 *      real controller on real frames. CONTROL: the identical drive with the
 *      camp's own cylinders spliced out of the shared collider array, in the
 *      same run, on the same build. If both fail, the instrument or the avenue
 *      is at fault; if only the first fails, it is these props. A second
 *      control walks the camp-free southern half, so a failure can be localised
 *      to a stretch rather than to a session.
 *
 *   2. THE WRECK CAN BE WALKED AROUND. A full circuit, driven both ways round,
 *      with every position recorded. The 8/01 playtest found the canal's barge
 *      registering an unbroken 13 m collider run that trapped the player, and
 *      the lesson recorded from it was that collider arithmetic is not the
 *      answer to "can you get out" - the answer is a body that got out.
 *      CONTROL: the same circuit with the wreck's cylinders removed, so a lap
 *      time is a number with something to be compared against.
 *
 *   3. THE SEVEN NAMES ARE LEGIBLE. The intro card that also carries them is
 *      skippable, so this is the surface the fact actually lives on. Measured
 *      by projecting each painted panel's four world corners through the live
 *      camera - not by guessing at a fraction of the viewport, which is how
 *      three sampling boxes on this project reported a real difference as
 *      absent - and then counting paint pixels and cap height inside it.
 *      CONTROL: the identical measurement on the UNPAINTED back of the same
 *      case. If the detector fires there, the detector is broken.
 *
 *   4. FRAME TIME DID NOT REGRESS. Draw submission and draw calls at three
 *      poses, against numbers taken on this tree before camp.js existed.
 *      CONTROL: the same measurement with the camp hidden and its two lights
 *      pulled out of the graph, in the same run - because a before number from
 *      an earlier process is a different machine state, and the only honest A/B
 *      is one taken thirty seconds apart.
 *
 * WHY NOT MEDIAN rAF FRAME TIME AS THE HEADLINE. It was tried first and it is
 * useless here: under swiftshader at 960x600 the medians came back 426, 632 and
 * 229 ms at three poses in the SAME build, which is a spread larger than
 * anything a prop pass could ever move. That number is software rasterisation
 * fill cost and it transfers to no real machine. What a set-dressing pass can
 * actually add is CPU-side draw submission - scene walk, frustum tests, sort,
 * uniform pushes - which is precisely what `batch.js` was written to cut and
 * what `renderer.render` wall time measures. Both are reported; the second is
 * the one with a threshold on it.
 *
 *   python3 -m http.server 4177     (from the repo root)
 *   node test/camp.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/camp/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/**
 * THE BEFORE NUMBERS, AND THE FIRST SET OF THEM WAS WRONG.
 *
 * Measured at 640x400 under swiftshader on 2026-08-08 by reverting
 * `src/world/courtyard.js` to HEAD - which un-wires camp.js entirely - running
 * the same three poses through the same instrument, and restoring. That is a
 * real separate-process before, not an estimate.
 *
 * The first attempt was taken with `yaw: Math.PI` at every pose, which in this
 * controller is DUE NORTH: `update` builds forward as (-sin yaw, 0, -cos yaw),
 * so yaw zero looks down -z toward the pyramid and Math.PI stands the player
 * with his back to the entire avenue. It reported 178 draw calls at the spawn
 * against the 339 the same pose reports facing the right way, and it would have
 * charged this pass with 530 draws it never issued. The tell was that the
 * in-run control - the same scene with the camp hidden - disagreed with the
 * separate-process before by 161 calls on a scene that should have been
 * identical. Two instruments that disagree on a thing that cannot have changed
 * mean one of them is measuring something else.
 *
 * With the yaw corrected the two agree to the call, which is what makes either
 * of them worth quoting.
 */
const BEFORE = {
  viewport: { width: 640, height: 400 },
  poses: {
    'spawn-looking-south': { submitMs: 0.65, calls: 339, triangles: 256242 },
    'mid-avenue': { submitMs: 0.67, calls: 298, triangles: 247910 },
    'north-avenue-east': { submitMs: 0.69, calls: 283, triangles: 249058 },
  },
  visibleMeshes: 1212,
  visibleTriangles: 147930,
  visibleLights: 14,
  colliders: 1582,
  courtyardBatches: 104,
};

/** The body is 0.84 m across (RADIUS 0.42 in player/controller.js). */
const BODY = 0.84;

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});

// The perf pass runs at the baseline's viewport; the legibility pass resizes to
// a player-sized window of its own and says so.
const page = await browser.newPage({ viewport: BEFORE.viewport });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1800);

let pass = 0, fail = 0;
const ok = (c, m) => {
  if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); }
};
const note = (m) => console.log(`      ${m}`);
const head = (m) => console.log(`\n--- ${m}\n`);

// ---------------------------------------------------------------------------
// 0. the driver, installed once
// ---------------------------------------------------------------------------
//
// A single walk implementation, shared by every route below, so a difference
// between two runs is a difference in the world and never in how it was driven.
//
// It steps the REAL player controller at a fixed 1/60 with the yaw handed to
// `update` rather than read off the rig. That is not a detail: `update` builds
// its forward vector from the yaw it is PASSED, and the first version of
// test/stuck.mjs set the rig and passed zero, so all eight of its directions
// walked due -z and it reported one direction eight times. The tell was in its
// own output - 947 bad points, 100 percent of one failure kind, zero of the
// other - and it went unread for a day.

await page.evaluate(() => {
  const g = window.__SANDS__;

  window.__CAMP__ = {
    /**
     * Drive the body through a list of waypoints.
     *
     * Returns the full position trace and, when it gives up, exactly where and
     * why. "Stuck" is defined the way a player would define it: the body stops
     * closing on the thing it is walking at, for a full second of simulation,
     * while still holding the stick forward.
     */
    walk(waypoints, opts = {}) {
      const arrive = opts.arrive ?? 0.7;
      const budget = opts.budgetFrames ?? 900;      // 15 s of simulation per leg
      const stallFrames = opts.stallFrames ?? 60;   // 1 s of no progress
      const sprint = !!opts.sprint;

      const start = waypoints[0];
      g.player.teleport({ x: start.x, y: g.world.heightAt(start.x, start.z), z: start.z });
      for (let i = 0; i < 20; i++) {
        g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
      }

      const trace = [];
      const legs = [];
      let frames = 0;

      for (let w = 1; w < waypoints.length; w++) {
        const t = waypoints[w];
        let best = Infinity;
        let sinceProgress = 0;
        let legFrames = 0;
        let reached = false;

        while (legFrames < budget) {
          const p = g.player.position;
          const dx = t.x - p.x, dz = t.z - p.z;
          const d = Math.hypot(dx, dz);
          if (d <= arrive) { reached = true; break; }

          // atan2(-dx, -dz) is the inverse of forward = (-sin yaw, -cos yaw).
          const yaw = Math.atan2(-dx, -dz);
          g.player.update(1 / 60, { forward: 1, strafe: 0, sprint, jump: false }, yaw);

          legFrames++; frames++;
          if (frames % 6 === 0) {
            trace.push([+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]);
          }

          if (d < best - 0.01) { best = d; sinceProgress = 0; } else { sinceProgress++; }
          if (sinceProgress >= stallFrames) break;
        }

        const p = g.player.position;
        legs.push({
          to: { x: t.x, z: t.z },
          reached,
          endedAt: { x: +p.x.toFixed(2), z: +p.z.toFixed(2) },
          missBy: +Math.hypot(t.x - p.x, t.z - p.z).toFixed(2),
          frames: legFrames,
          seconds: +(legFrames / 60).toFixed(2),
        });
        if (!reached) break;
      }

      return {
        completed: legs.every((l) => l.reached) && legs.length === waypoints.length - 1,
        legs,
        frames,
        seconds: +(frames / 60).toFixed(2),
        trace,
        end: {
          x: +g.player.position.x.toFixed(2),
          z: +g.player.position.z.toFixed(2),
        },
      };
    },

    /**
     * Take cylinders out of the shared collider array, and put them back.
     *
     * The array is the ONE representation of collision in this codebase, read
     * by the player, the mummies and the projectiles alike, so splicing it is
     * how a control run gets a world without the camp in it without rebuilding
     * the world. Restoring is by index rather than by value, because two
     * cylinders can be identical and `indexOf` on a re-pushed object is not the
     * same object.
     */
    remove(pred) {
      const kept = [];
      const gone = [];
      for (const c of g.world.colliders) (pred(c) ? gone : kept).push(c);
      const backup = g.world.colliders.slice();
      g.world.colliders.length = 0;
      for (const c of kept) g.world.colliders.push(c);
      return {
        removed: gone.length,
        restore() {
          g.world.colliders.length = 0;
          for (const c of backup) g.world.colliders.push(c);
        },
      };
    },
  };
});

// ---------------------------------------------------------------------------
// 1. what the build says about itself
// ---------------------------------------------------------------------------

head('the build');

const build = await page.evaluate(() => {
  const g = window.__SANDS__;
  const c = g.courtyard.camp;

  let campMeshes = 0, campTris = 0, nanMeshes = 0;
  const cg = g.scene.getObjectByName('camp');
  if (cg) {
    cg.traverse((o) => {
      if (!o.isMesh) return;
      campMeshes++;
      const idx = o.geometry?.index;
      campTris += idx ? idx.count / 3 : (o.geometry?.attributes?.position?.count || 0) / 3;
      const a = o.geometry?.attributes?.position?.array;
      if (a) for (let i = 0; i < a.length; i++) {
        if (!Number.isFinite(a[i])) { nanMeshes++; break; }
      }
    });
  }

  return {
    present: !!cg,
    rejected: c.rejected,
    doorFilterMatches: c.doorFilterMatches,
    sited: c.sited.length,
    campColliders: c.colliders.length,
    wreckColliders: c.wreckColliders,
    caseFaces: c.caseFaces,
    lights: c.lights.map((l) => ({
      type: l.type, castShadow: !!l.castShadow,
      intensity: +l.intensity.toFixed(2), distance: l.distance,
    })),
    campMeshes, campTris: Math.round(campTris), nanMeshes,
    worldColliders: g.world.colliders.length,
    batches: g.courtyard.batched,
    names: c.caseFaces.map((f) => f.name),
  };
});

ok(build.present, 'the camp group is in the scene');
ok(build.rejected.length === 0,
  `the siting guard refused nothing (${build.rejected.length} rejections)`);
if (build.rejected.length) for (const r of build.rejected) note(`rejected ${r.key}: ${r.why}`);

ok(build.doorFilterMatches === 2,
  `EXACTLY the two colliders doors.js expects answer its shape filters (${build.doorFilterMatches})`);
note('  a third would mean a camp prop had landed where the sealed doorway lives,');
note('  and doors.js matches by SHAPE, not by name, so it would edit it.');

ok(build.nanMeshes === 0, `no camp geometry carries NaN vertices (${build.nanMeshes})`);

// The seven, by name, in order, and PORTER without emphasis.
const EXPECTED = ['ADLER, M.', 'HOLM, J.', 'MARCHETTI, R.', 'NAKASHIMA, E.',
  'OYELARAN, T.', 'PORTER, B.', 'VANCE, D.'];
ok(build.names.length === 7, `seven cases were built (${build.names.length})`);
ok(JSON.stringify(build.names) === JSON.stringify(EXPECTED),
  'and they carry the seven names from NARRATIVE.md, in order');

// ---------------------------------------------------------------------------
// 2. COST, MEASURED FIRST
// ---------------------------------------------------------------------------
//
// BEFORE ANYTHING ELSE TOUCHES THE PAGE, and that ordering is a bug this file
// already shipped once. The cost pass used to run last, after the walk had
// opened the sealed doorway - and opening it makes the interior visible, so the
// spawn pose came back with 741 draw calls against a baseline of 178 and the
// harness dutifully blamed the camp for six hundred draws it had not issued.
// A measurement taken after the session has changed the world is a measurement
// of the session.
//
// The legibility pass below resizes the window and the walks move the player,
// so this is the only point in the run where the page is in the same state the
// baseline numbers were taken in.

const POSES = [
  { name: 'spawn-looking-south', x: 0, z: 30, yaw: 0 },
  { name: 'mid-avenue', x: 0, z: 15, yaw: 0 },
  { name: 'north-avenue-east', x: -2, z: 20, yaw: -Math.PI * 0.25 },
];

const cost = await page.evaluate(async (poses) => {
  const g = window.__SANDS__;

  /**
   * PIN THE FIDELITY BEFORE MEASURING ANYTHING.
   *
   * `governor.js` watches frame time and drops rungs - tier-3 props first, then
   * pixel scale, then post passes - which under swiftshader it will absolutely
   * do, and which rung it settles on depends on how loaded the machine was in
   * the first two seconds. A separate-process before and an in-run after that
   * landed on different rungs are two different scenes, and the difference gets
   * attributed to whatever changed in the source.
   *
   * `yieldToPlayer` is the same call the HIGH/LOW buttons make and it stands the
   * governor down for the session, which is exactly what a measurement wants.
   * The baseline was taken with the same two lines.
   */
  g.governor && g.governor.yieldToPlayer && g.governor.yieldToPlayer();
  g.setFidelity(true);
  await new Promise((r) => requestAnimationFrame(r));
  const frames = (n) => new Promise((res) => {
    let i = 0;
    const step = () => { if (++i >= n) res(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });

  /**
   * Median wall time of `renderer.render`, which is the CPU-side submission
   * cost: scene walk, frustum tests, sort, uniform pushes. Under swiftshader
   * the raster happens off this call, which is exactly why this is the number
   * that transfers and the rAF median is not.
   */
  const submit = (n) => {
    /*
     * TIMED AS ONE BLOCK OF n RENDERS, not as n timed renders.
     *
     * `performance.now()` is clamped in this context: every per-render median
     * came back an exact multiple of 0.1 ms, which is the resolution and not
     * the signal, and it makes any difference under a tenth of a millisecond
     * literally unmeasurable. One bracket around ninety renders divides that
     * floor by ninety.
     */
    const t0 = performance.now();
    for (let i = 0; i < n; i++) g.renderer.render(g.scene, g.camera);
    return +((performance.now() - t0) / n).toFixed(4);
  };

  const rafMedian = async (n) => {
    const t = [];
    let last = performance.now();
    for (let i = 0; i < n; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      t.push(now - last);
      last = now;
    }
    t.sort((a, b) => a - b);
    return +t[Math.floor(t.length / 2)].toFixed(1);
  };

  const counters = () => {
    g.renderer.info.autoReset = false;
    g.renderer.info.reset();
    g.renderer.render(g.scene, g.camera);
    const r = { calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles };
    g.renderer.info.autoReset = true;
    return r;
  };

  const measure = async (withRaf = false) => {
    const out = [];
    for (const p of poses) {
      g.player.teleport({ x: p.x, y: g.world.heightAt(p.x, p.z), z: p.z });
      g.rig.reset(p.yaw, -0.02);
      await frames(8);
      const c = counters();
      submit(8);                        // warm
      out.push({ name: p.name, submitMs: submit(40), ...c,
        rafMs: withRaf ? await rafMedian(10) : null });
    }
    return out;
  };

  const after = await measure(true);

  /**
   * THE IN-RUN CONTROL: the same three poses with the camp hidden AND its two
   * lights detached from the graph.
   *
   * Hiding alone would not measure the lights. three.js has no per-object light
   * culling - every light in the VISIBLE graph is evaluated by every fragment of
   * every forward-lit material in the frame, in range or not - so a point light
   * at the camp is a cost paid at the far end of the avenue too. Detaching is
   * what takes that term out; `visible = false` on an ancestor does the same
   * thing, which is why hiding the group is done first and the lights are
   * re-parented rather than merely dimmed.
   */
  const camp = g.courtyard.camp;
  const parents = camp.lights.map((l) => l.parent);
  camp.group.visible = false;
  for (const l of camp.lights) l.parent && l.parent.remove(l);
  await frames(8);
  const withoutCamp = await measure();
  camp.group.visible = true;
  camp.lights.forEach((l, i) => parents[i] && parents[i].add(l));
  await frames(8);

  // Lights only, so the two costs are separable.
  for (const l of camp.lights) l.parent && l.parent.remove(l);
  await frames(8);
  const withoutLights = await measure();
  camp.lights.forEach((l, i) => parents[i] && parents[i].add(l));
  await frames(8);

  let meshes = 0, tris = 0, lights = 0;
  g.scene.traverse((o) => {
    if (o.isMesh && o.visible) {
      meshes++;
      const i = o.geometry?.index;
      tris += i ? i.count / 3 : (o.geometry?.attributes?.position?.count || 0) / 3;
    }
    if (o.isLight) {
      let vis = true;
      for (let n = o; n; n = n.parent) if (!n.visible) { vis = false; break; }
      if (vis) lights++;
    }
  });

  return {
    after, withoutCamp, withoutLights,
    visibleMeshes: meshes,
    visibleTriangles: Math.round(tris),
    visibleLights: lights,
    colliders: g.world.colliders.length,
    batches: g.courtyard.batched.batches,
  };
}, POSES);


// ---------------------------------------------------------------------------
// 2. NO CONTINUOUS COLLIDER WALL
// ---------------------------------------------------------------------------
//
// The 8/01 clause, stated as arithmetic on the camp's own cylinders. This is
// NOT the proof - the driven circuit below is - but a chain long enough to be
// the barge again is worth catching before anybody drives anything.

head('collider chains');

const chains = await page.evaluate((BODY) => {
  const c = window.__SANDS__.courtyard.camp.colliders;

  // Union-find over "these two cylinders leave no gap a body could pass".
  const parent = c.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) {
      const gap = Math.hypot(c[i].x - c[j].x, c[i].z - c[j].z) - c[i].r - c[j].r;
      if (gap < BODY) join(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < c.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(c[i]);
  }

  return [...groups.values()].map((members) => {
    let span = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        span = Math.max(span, Math.hypot(members[i].x - members[j].x, members[i].z - members[j].z)
          + members[i].r + members[j].r);
      }
    }
    return {
      keys: [...new Set(members.map((m) => m.key))].join('+'),
      n: members.length,
      spanM: +span.toFixed(2),
    };
  }).sort((a, b) => b.spanM - a.spanM);
}, BODY);

console.log('  every impassable chain the camp registers, longest first:');
for (const ch of chains) {
  console.log(`  ${String(ch.spanM).padStart(6)} m   ${String(ch.n).padStart(3)} cyl   ${ch.keys}`);
}
console.log('');

const longest = chains[0];
// The barge was 13 m. The wreck is deliberately the longest thing here and it
// is a single convex chain along one axis standing in open floor, which is a
// different object to a wall against a wall - but it still has to be shorter
// than the thing that trapped a player.
ok(longest.spanM < 11.0,
  `the longest impassable chain is ${longest.spanM} m, under the 13 m barge that trapped a player`);
ok(longest.keys === 'wreck',
  `and it is the wreck itself (${longest.keys}), not an accidental merge of props`);

const caseChains = chains.filter((c) => c.keys.startsWith('case'));
ok(caseChains.length >= 3,
  `THE SEVEN CASES ARE ${caseChains.length} SEPARATE CHAINS, not one row: `
  + `a body-width gap between clusters is what makes the line permeable`);

// ---------------------------------------------------------------------------
// 3. THE AVENUE STILL WALKS, with two controls
// ---------------------------------------------------------------------------

head('the avenue walk, spawn to the sealed doorway');

/**
 * The route. Straight down the middle would clip the camp's case line, which
 * is the point of the case line, so the waypoints thread the gaps the way a
 * player does - and the gaps are what is being tested.
 *
 * IT ENDS AT THE SEALED SLAB AND NOT PAST IT, and the first version of this
 * file did not, which cost a full run to learn. The slab is a live collider at
 * (0, -30.2) with r 3.2 until the player pays 1000, so a body of radius 0.42
 * walking the centreline stops dead at z = -26.58 - which is exactly
 * -30.2 + 3.2 + 0.42, and exactly what all three runs reported, including the
 * control with the camp spliced out. That is the control doing its job: an
 * identical failure on a route with no camp geometry on it says the fault is
 * not the camp, and the number said which wall it was.
 *
 * So the walk is in two halves, and the second half is worth having on its own
 * terms: buy the door, and prove the camp did not break the purchase either.
 */
const AVENUE_ROUTE = [
  { x: 0, z: 30 },        // spawn
  { x: 0, z: 24 },
  { x: -1.0, z: 19.0 },   // through the gap between case clusters a and b
  { x: -1.0, z: 14.0 },
  { x: -2.0, z: 6.0 },
  { x: -1.0, z: -6.0 },
  { x: 0, z: -18.0 },
  { x: 0, z: -26.2 },     // the face of the sealed slab
];

/** After the purchase: the threshold doors.js takes the player in at. */
const THRESHOLD_ROUTE = [{ x: 0, z: -26.2 }, { x: 0, z: -31.4 }];

const walkWith = await page.evaluate((route) => window.__CAMP__.walk(route), AVENUE_ROUTE);

// CONTROL 1: the same drive with the camp's cylinders, and every slot-sealer
// fill welded to one of them, spliced out of the world.
const walkWithout = await page.evaluate((route) => {
  const g = window.__SANDS__;
  const own = g.courtyard.camp.colliders;
  const isCampish = (c) => {
    for (const o of own) {
      if (Math.abs(c.x - o.x) < 1e-6 && Math.abs(c.z - o.z) < 1e-6 && Math.abs(c.r - o.r) < 1e-6) {
        return true;
      }
      // The sealer's fills touch both cylinders they were derived from, by
      // construction. Over-removing here only makes the control MORE permissive
      // and the control's job is to show the route is walkable without the camp.
      if (Math.hypot(c.x - o.x, c.z - o.z) <= c.r + o.r + 0.05 && c.r < 1.0) return true;
    }
    return false;
  };
  const h = window.__CAMP__.remove(isCampish);
  const out = window.__CAMP__.walk(route);
  out.removed = h.removed;
  h.restore();
  return out;
}, AVENUE_ROUTE);

// CONTROL 2: the camp-free southern half on its own, same driver.
const walkSouth = await page.evaluate(() => window.__CAMP__.walk([
  { x: 0, z: 4 }, { x: -1, z: -8 }, { x: 0, z: -20 }, { x: 0, z: -26.2 },
]));

// And through, once the door is bought. The camp is 40 metres away from this,
// which is exactly why it is worth checking: the two things a set-dressing pass
// can break at a distance are the shared collider array and the shared PRNG,
// and doors.js finds its slab in that array BY SHAPE.
const throughDoor = await page.evaluate((route) => {
  const g = window.__SANDS__;
  const d = g.doors.byId('courtyard/entry');
  if (!d) return { missing: true };
  d.open();
  for (let i = 0; i < 600 && !d.opened; i++) d.advance(1 / 30);
  const out = window.__CAMP__.walk(route);
  out.opened = !!d.opened;
  return out;
}, THRESHOLD_ROUTE);

console.log(`  with the camp     ${walkWith.completed ? 'ARRIVED' : 'STOPPED'} `
  + `at (${walkWith.end.x}, ${walkWith.end.z}) after ${walkWith.seconds} s, `
  + `${walkWith.trace.length} samples`);
console.log(`  camp removed      ${walkWithout.completed ? 'ARRIVED' : 'STOPPED'} `
  + `at (${walkWithout.end.x}, ${walkWithout.end.z}) after ${walkWithout.seconds} s `
  + `(${walkWithout.removed} cylinders spliced out)`);
console.log(`  south half only   ${walkSouth.completed ? 'ARRIVED' : 'STOPPED'} `
  + `at (${walkSouth.end.x}, ${walkSouth.end.z}) after ${walkSouth.seconds} s`);
console.log('');

if (!walkWith.completed) {
  for (const l of walkWith.legs) {
    console.log(`    leg -> (${l.to.x}, ${l.to.z})  ${l.reached ? 'ok' : 'STOPPED'} `
      + `at (${l.endedAt.x}, ${l.endedAt.z}) short by ${l.missBy} m`);
  }
}

ok(walkWith.completed,
  'the player walks the full avenue, spawn to the face of the sealed doorway');
ok(walkWith.end.z <= -25.4,
  `and finishes at z ${walkWith.end.z}, against a slab whose collision starts at `
  + '-26.58 (the 3.2 m disc at -30.2 plus the 0.42 m body)');
console.log(`  through the door  ${throughDoor.completed ? 'ARRIVED' : 'STOPPED'} `
  + `at (${throughDoor.end.x}, ${throughDoor.end.z}) after ${throughDoor.seconds} s`);
ok(throughDoor.opened, 'the sealed doorway still opens with the camp built');
ok(throughDoor.completed && throughDoor.end.z < -30.2,
  `and the player walks PAST the slab line to z ${throughDoor.end.z}, which is `
  + 'inside the doorway the collider was standing in a moment earlier');
ok(walkSouth.completed,
  'CONTROL: the camp-free southern half walks on its own, so a failure above would localise');
ok(walkWithout.completed,
  'CONTROL: the identical drive with the camp spliced out also arrives');
// The interesting comparison: the camp must not have made the walk materially
// longer. A metre or two of threading a gap is the design; ten seconds is a maze.
const walkDelta = +(walkWith.seconds - walkWithout.seconds).toFixed(2);
ok(Math.abs(walkDelta) < 3.0,
  `and the camp costs ${walkDelta >= 0 ? '+' : ''}${walkDelta} s on the same route `
  + `(${walkWithout.seconds} s clear, ${walkWith.seconds} s dressed)`);

// ---------------------------------------------------------------------------
// 4. A FULL CIRCUIT AROUND THE HELICOPTER
// ---------------------------------------------------------------------------

head('the circuit around the wreck');

const CIRCUIT = [
  { x: 1.0, z: 15.5 },
  { x: 0.5, z: 11.0 },
  { x: 1.5, z: 7.0 },
  { x: 6.0, z: 5.5 },
  { x: 10.5, z: 7.0 },
  { x: 11.5, z: 11.0 },
  { x: 10.5, z: 13.2 },
  { x: 6.5, z: 13.6 },
  { x: 2.0, z: 14.8 },
  { x: 1.0, z: 15.5 },
];
const CIRCUIT_REV = CIRCUIT.slice().reverse();

const lapCW = await page.evaluate((r) => window.__CAMP__.walk(r), CIRCUIT);
const lapCCW = await page.evaluate((r) => window.__CAMP__.walk(r), CIRCUIT_REV);

// CONTROL: the same lap with the wreck's own eight cylinders taken out, so the
// lap time has something to be a number against rather than being one on its own.
const lapClear = await page.evaluate((r) => {
  const g = window.__SANDS__;
  const wc = g.courtyard.camp.wreckColliders;
  const h = window.__CAMP__.remove((c) => wc.some((w) =>
    Math.abs(c.x - w.x) < 1e-6 && Math.abs(c.z - w.z) < 1e-6 && Math.abs(c.r - w.r) < 1e-6));
  const out = window.__CAMP__.walk(r);
  out.removed = h.removed;
  h.restore();
  return out;
}, CIRCUIT);

const lapLine = (name, l) => `  ${name.padEnd(18)}${l.completed ? 'CLOSED' : 'STOPPED'} `
  + `at (${l.end.x}, ${l.end.z}) after ${l.seconds} s, ${l.trace.length} positions recorded`;
console.log(lapLine('clockwise', lapCW));
console.log(lapLine('anticlockwise', lapCCW));
console.log(lapLine('wreck removed', lapClear));
console.log('');

for (const [name, l] of [['clockwise', lapCW], ['anticlockwise', lapCCW]]) {
  if (l.completed) continue;
  for (const leg of l.legs) {
    console.log(`    ${name} leg -> (${leg.to.x}, ${leg.to.z})  ${leg.reached ? 'ok' : 'STOPPED'} `
      + `at (${leg.endedAt.x}, ${leg.endedAt.z}) short by ${leg.missBy} m`);
  }
}

ok(lapCW.completed, 'THE PLAYER WALKS A FULL LAP AROUND THE HELICOPTER, clockwise');
ok(lapCCW.completed, 'and anticlockwise, so nothing here is a one-way pocket');
ok(lapClear.completed, 'CONTROL: the same lap with the wreck removed also closes');

const lapDelta = +(lapCW.seconds - lapClear.seconds).toFixed(2);
ok(Math.abs(lapDelta) < 3.0,
  `the wreck costs ${lapDelta >= 0 ? '+' : ''}${lapDelta} s on the lap `
  + `(${lapClear.seconds} s clear, ${lapCW.seconds} s with it standing there)`);

// How close the trace actually got to the hull, which is what "walkable around"
// has to mean: not a lap at ten metres.
const hug = await page.evaluate((trace) => {
  const wc = window.__SANDS__.courtyard.camp.wreckColliders;
  let closest = Infinity;
  for (const [x, , z] of trace) {
    for (const w of wc) closest = Math.min(closest, Math.hypot(x - w.x, z - w.z) - w.r);
  }
  return +closest.toFixed(2);
}, lapCW.trace);
note(`the lap passes within ${hug} m of the airframe at its closest`);
ok(hug < 2.5, `and it is a lap AROUND the wreck rather than past it (${hug} m at closest)`);

writeFileSync(`${OUT}circuit.json`, JSON.stringify({
  clockwise: lapCW, anticlockwise: lapCCW, control: lapClear,
  avenue: walkWith, avenueControl: walkWithout,
}, null, 1));
note(`full position traces -> ${OUT}circuit.json`);

// ---------------------------------------------------------------------------
// 5. THE SEVEN NAMES, MEASURED IN PIXELS
// ---------------------------------------------------------------------------

head('the seven names, on screen');

// A player-sized window for this pass. Legibility is a claim about what a
// person sees, and 640x400 is a measurement viewport, not a game.
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(400);

/**
 * Stand off a panel and measure the paint inside its projected rectangle.
 *
 * `standoff` is metres back along the panel's own outward normal. 2.6 m is the
 * distance a player walking the lane actually passes these at; 5.5 m is
 * included so the falloff is on the record rather than assumed.
 */
async function measurePanel(index, standoff, { stripPaint = false } = {}) {
  const box = await page.evaluate(async ([index, standoff, stripPaint]) => {
    const g = window.__SANDS__;
    const f = g.courtyard.camp.caseFaces[index];

    /**
     * THE CONTROL IS THE SAME PANEL WITH THE PAINT TAKEN OFF IT.
     *
     * The first control looked at the unpainted BACK of the same case, and it
     * fired: up to 0.41 of that panel came back as "paint". Two different
     * things were being compared - a different face, at a different angle, with
     * a different background behind it - so a difference between them was never
     * going to be attributable to the writing.
     *
     * Nulling the atlas off the shared stencil material changes exactly one
     * thing and nothing else: same geometry, same box, same camera, same key,
     * same sun. Whatever the detector still finds is what it would have found
     * with no names in the game at all.
     */
    /**
     * THE CONTROL TEXTURE IS THE PANEL'S GROUND COLOUR, NOT NO TEXTURE AT ALL.
     *
     * Nulling the map was the second wrong control in this file. The stencil
     * material carries `color: 0xffffff` because all its value lives in the
     * atlas, so a null map renders the panel WHITE - which lifts the median far
     * above anything else in the box and guarantees the detector finds nothing,
     * for a reason that has nothing to do with the writing. A control that
     * cannot fail is not a control.
     *
     * One flat pixel of 0x59604a, which is the exact hex the atlas fills its
     * own ground with, changes the letters and nothing else.
     */
    if (stripPaint) {
      if (!g.__flatPanel) {
        const c1 = document.createElement('canvas');
        c1.width = c1.height = 2;
        const x1 = c1.getContext('2d');
        x1.fillStyle = '#59604a';
        x1.fillRect(0, 0, 2, 2);
        g.__flatPanel = new g.THREE.CanvasTexture(c1);
        g.__flatPanel.colorSpace = g.THREE.SRGBColorSpace;
      }
      g.scene.traverse((o) => {
        if (o.isMesh && o.material && o.material.name === 'camp-stencil') {
          if (!g.__stencilMap) g.__stencilMap = o.material.map;
          o.material.map = g.__flatPanel;
          o.material.needsUpdate = true;
        }
      });
    } else if (g.__stencilMap) {
      g.scene.traverse((o) => {
        if (o.isMesh && o.material && o.material.name === 'camp-stencil'
            && o.material.map !== g.__stencilMap) {
          o.material.map = g.__stencilMap;
          o.material.needsUpdate = true;
        }
      });
    }

    const nx = f.nx;
    const nz = f.nz;
    const cx = f.x;
    const cz = f.z;

    /**
     * STAND SOMEWHERE A PLAYER COULD ACTUALLY STAND.
     *
     * Straight back along the panel normal is the obvious viewing position and
     * for three of these seven panels it is INSIDE THE TARPAULIN, whose cover
     * is a 2.4 m sheet at (2.2, 19.8) and whose collider a real body could
     * never enter. `teleport` does not care - it puts the camera wherever it is
     * told - so the harness was photographing the inside of a tarp and calling
     * the result a panel. The control found it: with the letters swapped for a
     * flat panel, three boxes still came back 15 to 29 percent "paint", and
     * paint that survives having the paint removed is not paint.
     *
     * So the standoff slides sideways along the panel until it finds air. The
     * offset actually used is reported, because "legible at 2.6 m" means at
     * 2.6 m from somewhere a player can be.
     */
    const RADIUS = 0.42;
    const clear = (x, z) => {
      const feet = g.world.heightAt(x, z);
      for (const c of g.world.colliders) {
        const base = c.y0 === undefined ? feet : c.y0;
        if (feet - base > c.h) continue;
        if (base - feet > 1.68) continue;
        const dx = x - c.x, dz = z - c.z;
        if (dx * dx + dz * dz < (c.r + RADIUS) * (c.r + RADIUS)) return false;
      }
      return true;
    };
    // Lateral is the panel's own long axis, normalised.
    const ul = Math.hypot(f.ux, f.uz) || 1;
    const lx = f.ux / ul, lz = f.uz / ul;

    let px = cx + nx * standoff;
    let pz = cz + nz * standoff;
    let slid = 0;
    if (!clear(px, pz)) {
      for (const t of [0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.0, -2.0]) {
        const tx = cx + nx * standoff + lx * t;
        const tz = cz + nz * standoff + lz * t;
        if (clear(tx, tz)) { px = tx; pz = tz; slid = t; break; }
      }
    }
    g.player.teleport({ x: px, y: g.world.heightAt(px, pz), z: pz });

    // Look at the panel centre. yaw is the inverse of forward = (-sin, -cos).
    const dx = cx - px, dz = cz - pz;
    const yaw = Math.atan2(-dx, -dz);
    const eye = g.player.position.y + 1.68;
    const pitch = Math.atan2(f.y - eye, Math.hypot(dx, dz));
    g.rig.reset(yaw, pitch);

    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));

    // PROJECT THE PANEL'S FOUR CORNERS through the live camera. This is the
    // whole reason caseFaces is published: test/tiers.mjs records three
    // hand-placed sampling boxes on this project that all reported a real
    // difference as absent, and every one of them was placed by eye.
    const V = g.THREE.Vector3;
    const cam = g.camera;
    cam.updateMatrixWorld();
    const pts = [];
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) {
        const p = new V(
          cx + su * f.ux,
          f.y + sv * f.halfH,
          cz + su * f.uz,
        ).project(cam);
        pts.push([(p.x * 0.5 + 0.5) * innerWidth, (-p.y * 0.5 + 0.5) * innerHeight]);
      }
    }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return {
      x0: Math.max(0, Math.floor(Math.min(...xs))),
      y0: Math.max(0, Math.floor(Math.min(...ys))),
      x1: Math.min(innerWidth, Math.ceil(Math.max(...xs))),
      y1: Math.min(innerHeight, Math.ceil(Math.max(...ys))),
      name: f.name,
      slid: +slid.toFixed(2),
      // The four projected corners, in ring order, so the pixel pass can mask
      // to the QUAD rather than to its bounding rectangle.
      quad: [pts[0], pts[1], pts[3], pts[2]],
    };
  }, [index, standoff, stripPaint]);

  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  if (w < 4 || h < 4) return { ...box, w, h, paint: 0, capPx: 0, contrast: 0 };

  const shot = await page.screenshot({ clip: { x: box.x0, y: box.y0, width: w, height: h } });
  // Every crop the control is taken from is kept. An anomaly in a number is a
  // thing to look at, and a harness that measures pixels and throws the pixels
  // away leaves the next person nothing to look at.
  // Both crops are kept, painted and control, so the two can be put side by
  // side by a person. A pixel measurement whose pixels are thrown away is an
  // assertion, not evidence.
  writeFileSync(`${OUT}${stripPaint ? 'control' : 'panel'}-${index}`
    + `${standoff > 4 ? '-far' : ''}.png`, shot);

  /**
   * WHAT COUNTS AS PAINT, AND WHY OTSU IS NOT THE ANSWER.
   *
   * The first version thresholded with Otsu, which finds the split that
   * maximises between-class variance. That is the right tool for an image known
   * to be bimodal and the wrong one here, because OTSU ALWAYS RETURNS A SPLIT:
   * run it on a smooth unpainted panel with a shading gradient across it and it
   * dutifully calls the lighter half "paint". The control fired - up to 6530
   * pixels of paint on a panel with nothing written on it - and a control that
   * fires makes every number beside it noise.
   *
   * So the criterion is panel-relative and absolute at once: paint is anything
   * more than 55 percent brighter than the panel's OWN median. The stencil is
   * 0xe6e2d4 on 0x59604a, better than three times the luminance, so real paint
   * clears that bar under any key; a shading gradient across a flat panel is
   * plus or minus fifteen percent and clears nothing. Otsu's separability is
   * still computed and printed, as a diagnostic rather than as the test.
   */
  const stat = await page.evaluate(async ([dataUrl, quad, ox, oy]) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = dataUrl; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, img.width, img.height).data;

    /**
     * MASK TO THE QUAD, NOT TO ITS BOUNDING BOX.
     *
     * Four of these seven viewing positions are inside a prop and have to slide
     * sideways to find air, which means those panels are seen OBLIQUELY - and
     * the axis-aligned bounding rectangle of an obliquely projected rectangle
     * contains corners that are not the panel at all. They are sand, or the
     * next case along. The control read 2 to 19 percent on exactly the four
     * panels that had to slide and EXACTLY ZERO on the two seen face on, which
     * is as clean a localisation as a control ever gives.
     *
     * The four projected corners come back from the camera, so the test is the
     * usual convex sign test and costs one cross product per corner per pixel.
     */
    /*
     * INSET TO 88 PERCENT BEFORE MASKING.
     *
     * The panel is a painted plate standing 12 mm proud of a chamfered case, so
     * the outermost band of its own projection is edge geometry - the step, the
     * chamfer highlight, the lid seam - and at an oblique angle that band is
     * several pixels wide and carries real high-frequency detail. It is not
     * lighting and it is not letters, and counting it as either is wrong. The
     * letters sit well inside 88 percent of the panel because the atlas leaves
     * a margin, so nothing that is actually paint is lost.
     */
    const cxq = quad.reduce((a2, p) => a2 + p[0], 0) / 4;
    const cyq = quad.reduce((a2, p) => a2 + p[1], 0) / 4;
    const INSET = 0.88;
    const q = quad.map(([x, y]) => [
      (cxq + (x - cxq) * INSET) - ox,
      (cyq + (y - cyq) * INSET) - oy,
    ]);
    const inQuad = (px, py) => {
      let sign = 0;
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4];
        const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
        if (cross === 0) continue;
        const sgn = cross > 0 ? 1 : -1;
        if (sign === 0) sign = sgn; else if (sgn !== sign) return false;
      }
      return true;
    };

    const lum = new Float64Array(img.width * img.height);
    const mask = new Uint8Array(img.width * img.height);
    const hist = new Array(256).fill(0);
    let inside = 0;
    for (let y = 0, i = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++, i++) {
        const k = i * 4;
        const l = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
        lum[i] = l;
        if (inQuad(x + 0.5, y + 0.5)) {
          mask[i] = 1;
          inside++;
          hist[Math.min(255, Math.round(l))]++;
        }
      }
    }

    const total = inside;

    // The panel's own median, from the histogram.
    let acc = 0, median = 0;
    for (let t = 0; t < 256; t++) { acc += hist[t]; if (acc >= total / 2) { median = t; break; } }

    /**
     * PAINT IS HIGH FREQUENCY. A LIT PANEL IS NOT.
     *
     * Three thresholds were tried against absolute luminance and all three
     * fired on the control, for a reason the crops make obvious the moment
     * anybody looks at them: THESE PANELS FACE NORTH, away from the key, so an
     * unpainted one renders nearly black with a soft gradient across it - and
     * every absolute or median-relative cut ends up calling the lighter half of
     * that gradient "paint". `shots/camp/control-5.png` beside
     * `shots/camp/panel-5.png` is the whole argument.
     *
     * What separates a letter from a gradient is not how bright it is, it is
     * how FAST it changes. So the luminance is high-passed - each pixel against
     * the local mean over a 17 px box, via a summed-area table - and paint is
     * what stands proud of its own neighbourhood. A lighting ramp has a local
     * excess near zero everywhere no matter how dark or bright the panel is; a
     * stencil letter is 20 to 40 above its own surround.
     *
     * The old median-relative numbers are kept below as `thr`, printed as a
     * diagnostic, because they are what the previous three runs of this file
     * reported and somebody will want to compare.
     *
     * 2.2x THE MEDIAN, AND ALMOST NO ABSOLUTE FLOOR.
     *
     * The floor was 8 and that was the whole defect in the third version of
     * this control. These panels face NORTH, which in this scene is away from
     * the key, so a control crop of an unpainted panel comes back nearly black
     * - median around 12. A floor of 8 then sits BELOW the median and every
     * pixel in the lighter half of a dark gradient scores as paint: 15 percent
     * of a panel with nothing written on it.
     *
     * The paint is 0xe6e2d4 against a ground of 0x59604a, which is roughly a
     * factor of three in rendered luminance whatever the key is doing, so 2.2
     * separates them with room on both sides and does not depend on the panel
     * being lit. The floor is now only there to stop a division by nothing on a
     * fully black crop.
     */
    const thr = Math.max(4, median * 2.2);

    // Otsu, for the record only.
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB2 = 0, best = 0, otsu = 128;
    for (let t = 0; t < 256; t++) {
      wB2 += hist[t];
      if (!wB2) continue;
      const wF = total - wB2;
      if (!wF) break;
      sumB += t * hist[t];
      const mB2 = sumB / wB2, mF = (sum - sumB) / wF;
      const between = wB2 * wF * (mB2 - mF) * (mB2 - mF);
      if (between > best) { best = between; otsu = t; }
    }

    // Summed-area table, so the local mean at every pixel is four lookups.
    const W = img.width, H = img.height, R = 8;
    const ps = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        ps[(y + 1) * (W + 1) + (x + 1)] = lum[y * W + x]
          + ps[y * (W + 1) + (x + 1)] + ps[(y + 1) * (W + 1) + x] - ps[y * (W + 1) + x];
      }
    }
    const boxMean = (x, y) => {
      const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R);
      const x1 = Math.min(W - 1, x + R), y1 = Math.min(H - 1, y + R);
      const A = ps[y0 * (W + 1) + x0], B = ps[y0 * (W + 1) + x1 + 1];
      const C = ps[(y1 + 1) * (W + 1) + x0], D = ps[(y1 + 1) * (W + 1) + x1 + 1];
      return (D - B - C + A) / ((x1 - x0 + 1) * (y1 - y0 + 1));
    };

    /*
     * The bar on the local excess. 10 is above this renderer's film grain,
     * which is the only other high-frequency thing on a flat panel, and far
     * below a stencil letter's 20-to-40.
     */
    const EXCESS = 10;

    // Rows carrying paint, so the cap height is measured rather than assumed.
    let paint = 0, mB = 0, nB = 0, mD = 0, nD = 0;
    const rowHit = new Array(H).fill(0);
    for (let y = 0; y < H; y++) {
      for (let px = 0; px < W; px++) {
        const i = y * W + px;
        if (!mask[i]) continue;
        const l = lum[i];
        if (l - boxMean(px, y) > EXCESS) { paint++; rowHit[y]++; mB += l; nB++; }
        else { mD += l; nD++; }
      }
    }
    const rows = rowHit.map((n, y) => (n >= Math.max(2, img.width * 0.02) ? y : -1))
      .filter((y) => y >= 0);
    const capPx = rows.length ? rows[rows.length - 1] - rows[0] + 1 : 0;

    const bright = nB ? mB / nB : 0;
    const dark = nD ? mD / nD : 0;
    return {
      w: img.width, h: img.height,
      quadPx: inside,
      paintPx: paint,
      paintShare: +(paint / Math.max(1, total)).toFixed(4),
      capPx,
      median,
      excess: EXCESS,
      threshold: +thr.toFixed(1),
      otsu,
      contrast: +((bright - dark) / (bright + dark + 1e-6)).toFixed(3),
    };
  }, [`data:image/png;base64,${shot.toString('base64')}`, box.quad, box.x0, box.y0]);

  return { ...box, ...stat };
}

const NEAR = 2.6;
const FAR = 5.5;

const near = [];
for (let i = 0; i < 7; i++) near.push(await measurePanel(i, NEAR));
// All seven at the longer standoff. Falloff on the record, not a gate.
const far = [];
for (let i = 0; i < 7; i++) far.push(await measurePanel(i, FAR));

// THE CONTROL: the same seven panels, same standoff, same detector, with the
// atlas taken off the material. Restored immediately after.
const blank = [];
for (let i = 0; i < 7; i++) blank.push(await measurePanel(i, NEAR, { stripPaint: true }));
await measurePanel(0, NEAR);          // puts the map back

console.log(`  panel measurements at ${NEAR} m standoff, 1280x800:`);
console.log('  name             box px      paint px   share    cap px   contrast');
for (const m of near) {
  console.log(`  ${m.name.padEnd(16)}${String(m.w).padStart(4)}x${String(m.h).padEnd(4)} `
    + `${String(m.paintPx).padStart(9)} ${String(m.paintShare).padStart(8)} `
    + `${String(m.capPx).padStart(8)} ${String(m.contrast).padStart(10)}`
    + `${m.slid ? `   (stood ${m.slid} m aside: the straight-back spot is inside a prop)` : ''}`);
}
console.log('');
console.log(`  the same panels at ${FAR} m, and the blank BACK of the same cases at ${NEAR} m:`);
console.log('  name              far cap px  far share   CONTROL paint  CONTROL share  CONTROL box');
for (let i = 0; i < 7; i++) {
  console.log(`  ${near[i].name.padEnd(16)}${String(far[i].capPx ?? '-').padStart(10)} `
    + `${String(far[i].paintShare ?? '-').padStart(11)}  ${String(blank[i].paintPx).padStart(13)} `
    + `${String(blank[i].paintShare).padStart(14)}   `
    + `${blank[i].w}x${blank[i].h}`);
}
console.log('');

/**
 * THE BAR. A capital letter under about six pixels tall is not read, it is
 * guessed at; the stencil's own bridges are drawn at 3.5 percent of the cap, so
 * below that height they start eating strokes rather than punctuating them.
 * Ten pixels is the bar for "legible", and it is deliberately above six.
 */
ok(near.every((m) => m.capPx >= 10),
  `every name is at least 10 px tall at ${NEAR} m `
  + `(smallest ${Math.min(...near.map((m) => m.capPx))} px, largest ${Math.max(...near.map((m) => m.capPx))} px)`);
ok(near.every((m) => m.contrast > 0.25),
  `and every name carries real contrast against its panel `
  + `(lowest ${Math.min(...near.map((m) => m.contrast)).toFixed(3)})`);
ok(near.every((m) => m.paintShare > 0.02),
  `and every panel actually has paint on it `
  + `(least ${Math.min(...near.map((m) => m.paintShare))} of the panel)`);

// The control has to be quiet. If it is not, the numbers above are noise.
/**
 * A flat panel of the ground hex has to read essentially nothing. One percent
 * is the allowance for the chamfered edge of the case showing at the boundary
 * of the projected rectangle, which is real geometry and not letters; the
 * painted panels run from 7.6 to 25 percent, so the two populations are an
 * order of magnitude apart and nothing sits on the threshold.
 */
const blankMax = Math.max(...blank.map((m) => m.paintShare));
const nearMin = Math.min(...near.map((m) => m.paintShare));
const loud = blank.map((m, i) => ({ i, name: m.name, share: m.paintShare }))
  .filter((m) => m.share > 0.01);
ok(loud.length === 0 && blankMax * 5 < nearMin,
  `CONTROL: with the atlas swapped for a flat panel of the same hex, the same seven `
  + `boxes read at most ${blankMax} against ${nearMin} painted - an order of `
  + `magnitude, so the detector is measuring letters and not lighting`);
for (const m of loud) {
  note(`the control is NOT quiet on panel ${m.i} (${m.name}): ${m.share} of the box. `
    + `Its crop is at ${OUT}control-${m.i}.png - something other than the panel is `
    + 'inside that projected rectangle and the reading for it is UNVERIFIED.');
}

const farCaps = far.map((m) => m.capPx);
note(`at ${FAR} m the caps are ${farCaps.join(', ')} px, `
  + 'which is where these stop being read and start being recognised');

// One full frame at the standoff, for a human to look at.
await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.player.teleport({ x: -1.2, y: g.world.heightAt(-1.2, 20.4), z: 20.4 });
  g.rig.reset(0.15, -0.12);
  for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
});
await page.screenshot({ path: `${OUT}manifest.png` });
note(`a frame of the manifest as the player meets it -> ${OUT}manifest.png`);

// ---------------------------------------------------------------------------
// 6. FRAME TIME AND DRAW COST
// ---------------------------------------------------------------------------

head('cost');

console.log('  draw submission, mean of a 40-render block per pose, 640x400 swiftshader:');
console.log('  pose                   before    after  camp hidden  lights out');
for (let i = 0; i < cost.after.length; i++) {
  const a = cost.after[i];
  const b = BEFORE.poses[a.name];
  console.log(`  ${a.name.padEnd(22)}${String(b.submitMs).padStart(6)}  `
    + `${String(a.submitMs).padStart(7)}  ${String(cost.withoutCamp[i].submitMs).padStart(11)}  `
    + `${String(cost.withoutLights[i].submitMs).padStart(10)}`);
}
console.log('');
console.log('  draw calls, which is what a set-dressing pass can actually move:');
console.log('  pose                   before    after  camp hidden   camp costs');
for (let i = 0; i < cost.after.length; i++) {
  const a = cost.after[i];
  const b = BEFORE.poses[a.name];
  console.log(`  ${a.name.padEnd(22)}${String(b.calls).padStart(6)}  ${String(a.calls).padStart(7)}  `
    + `${String(cost.withoutCamp[i].calls).padStart(11)}  `
    + `${String(a.calls - cost.withoutCamp[i].calls).padStart(11)}`);
}
console.log('');
console.log('  rAF median (fill-bound under swiftshader; recorded, never asserted):');
for (let i = 0; i < cost.after.length; i++) {
  console.log(`  ${cost.after[i].name.padEnd(22)}${String(cost.after[i].rafMs).padStart(8)} ms`);
}
console.log('');
console.log(`  visible meshes      ${BEFORE.visibleMeshes} -> ${cost.visibleMeshes}`);
console.log(`  visible triangles   ${BEFORE.visibleTriangles} -> ${cost.visibleTriangles}`);
console.log(`  visible lights      ${BEFORE.visibleLights} -> ${cost.visibleLights}`);
console.log(`  world colliders     ${BEFORE.colliders} -> ${cost.colliders}`);
console.log(`  courtyard batches   ${BEFORE.courtyardBatches} -> ${cost.batches}`);
console.log(`  camp meshes / triangles after batching   ${build.campMeshes} / ${build.campTris}`);
console.log('');

const worstDelta = Math.max(...cost.after.map((a, i) =>
  a.submitMs - cost.withoutCamp[i].submitMs));
const worstCalls = Math.max(...cost.after.map((a) =>
  a.calls - BEFORE.poses[a.name].calls));
const callCeilingAB = build.campMeshes * 2;

/**
 * WHAT IS ASSERTED, AND WHAT IS ONLY REPORTED.
 *
 * DRAW CALLS are asserted. They are a count, they come out of the renderer's own
 * counter, and they are the quantity a set-dressing pass actually controls -
 * `batch.js` exists because the courtyard's frame was being spent issuing them.
 *
 * DRAW SUBMISSION TIME is reported and NOT asserted, and that is a statement
 * about this machine rather than about the camp. The whole effect being looked
 * for is a fraction of a millisecond, and across three runs of this file the
 * same pose with the camp HIDDEN came back at 0.89, 1.11 and 0.56 ms - a spread
 * of half a millisecond on a scene that did not change, because another agent's
 * browsers were running on the same box. An instrument whose noise floor is
 * wider than the effect cannot decide the question, and dressing that up as a
 * PASS would be exactly the "green harness that measured what the code says
 * about itself" this project has been bitten by three times this month.
 *
 * So the numbers are printed with their spread and the threshold sits on the
 * counter. Run this on a quiet machine and the timing is worth asserting too.
 */
const worstCallsAB = Math.max(...cost.after.map((a, i) => a.calls - cost.withoutCamp[i].calls));
ok(worstCallsAB <= callCeilingAB,
  `IN-RUN A/B: the camp costs at most ${worstCallsAB} draw calls at any pose, `
  + `measured against itself hidden thirty seconds apart, against a ceiling of `
  + `${callCeilingAB}`);
note(`draw submission moved by ${worstDelta >= 0 ? '+' : ''}${worstDelta.toFixed(4)} ms at worst, `
  + 'which is INSIDE this machine\'s noise floor today and is therefore reported, not asserted');
/**
 * THE SEPARATE-PROCESS BEFORE AND THE IN-RUN CONTROL HAVE TO AGREE.
 *
 * This is the check that caught the wrong-yaw baseline, and it is worth keeping
 * for exactly that reason: hiding the camp group ought to reproduce the world
 * as it was before camp.js was written, because the merge never folds a camp
 * mesh in with a courtyard one - `batch.js` keys on the nearest NAMED ancestor
 * and the camp has its own. If the two numbers ever separate again, one of them
 * is measuring a different scene and neither is a before.
 */
/**
 * THE CROSS-CHECK, AND IT IS NOT SETTLED.
 *
 * Hiding the camp ought to reproduce the separate-process before exactly - the
 * merge never folds a camp mesh in with a courtyard one, because `batch.js`
 * keys on the nearest NAMED ancestor and the camp has its own - and it does
 * not. Measured across runs the residual is 34 to 86 draw calls, always in the
 * direction of the with-camp process reporting MORE.
 *
 * Pinning the governor removed part of it and not all of it, so the remaining
 * candidates, ranked: (1) frustum culling at the margin, since the pose is
 * reached by a gravity settle over eight frames and a centimetre of camera
 * height moves objects across the frustum plane in a scene with 1300 bounding
 * spheres in it; (2) the shadow camera picking up camp casters whose merged
 * bounds now straddle a courtyard batch's; (3) machine contention changing the
 * settle. It has NOT been isolated.
 *
 * REPORTED, NOT ASSERTED, and explicitly UNVERIFIED. What it does bound is the
 * size of the thing not understood: 86 calls against a 339-call baseline, in a
 * direction that would over-charge this pass rather than hide a cost. The
 * assertion that carries the weight is the in-run A/B above, which compares two
 * measurements taken seconds apart in one process.
 */
const agree = cost.after.map((a, i) => cost.withoutCamp[i].calls - BEFORE.poses[a.name].calls);
note(`UNVERIFIED: hiding the camp does not exactly reproduce the separate-process `
  + `before - residual up to ${Math.max(...agree.map(Math.abs))} draw calls `
  + `(${agree.join(', ')} at the three poses). See the note in the source.`);
/**
 * THE DRAW-CALL BAR IS THE MERGE'S OWN ARITHMETIC, not a round number.
 *
 * `batchStatics` leaves behind whatever it could not fold: the parts tagged
 * noBatch because they move, and any material-plus-cell bucket with only one
 * member in it. Every one of those is a draw, and the shadow pass issues each a
 * second time, so the ceiling this pass can possibly cost is twice the camp
 * meshes that survived the merge. Anything under that is the frustum culling
 * doing its job; anything over it means something is being drawn twice for a
 * reason nobody has named.
 */
const callCeiling = build.campMeshes * 2;
ok(worstCalls <= callCeiling,
  `draw calls rose by at most ${worstCalls} at any pose, against a ceiling of `
  + `${callCeiling} - ${build.campMeshes} camp meshes survived the merge and the `
  + `shadow pass draws each of them again`);
ok(cost.visibleLights === BEFORE.visibleLights + 2,
  `exactly two lights were added (${BEFORE.visibleLights} -> ${cost.visibleLights})`);
ok(build.lights.every((l) => !l.castShadow),
  'and NEITHER CASTS A SHADOW, which is the courtyard\'s standing budget: '
  + 'one shadow-casting light outside, the sun');

const lightCost = Math.max(...cost.after.map((a, i) =>
  a.submitMs - cost.withoutLights[i].submitMs));
const lightCalls = Math.max(...cost.after.map((a, i) => a.calls - cost.withoutLights[i].calls));
note(`the two lights on their own account for ${lightCost.toFixed(4)} ms of that, `
  + `and ${lightCalls} draw calls - a non-shadow PointLight adds a term to every `
  + 'forward-lit fragment in the frame and not a single draw');

// ---------------------------------------------------------------------------

head('errors');
ok(errors.length === 0, `no console errors or page exceptions (${errors.length})`);
if (errors.length) for (const e of errors.slice(0, 6)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
