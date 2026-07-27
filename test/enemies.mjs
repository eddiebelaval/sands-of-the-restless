/**
 * Enemy, director, and boss harness.
 *
 * The claim this file exists to test is "the wave shooter has something to
 * shoot", and that claim decomposes into six facts that can each fail
 * independently and silently:
 *
 *   1. a wave arrives, and it WALKS TO THE PLAYER. An enemy that spawns and
 *      then stands in a colonnade is indistinguishable, from the HUD, from an
 *      enemy that is on its way.
 *   2. the hitscan finds both regions. A head that is never hit is a headshot
 *      premium that never pays, and the player has no way to see that.
 *   3. the payouts are the frozen ones: 10 / 60 / 100.
 *   4. the pool turns over. Several hundred spawns must add nothing to the
 *      scene graph and nothing to GPU memory.
 *   5. wave five brings a god, with a named bar in the HUD.
 *   6. all of it works on both sides of the doorway.
 *
 * Everything that waits, waits on STATE or on FRAMES. Under software rendering
 * a frame is most of a second of wall clock but only ever advances the
 * simulation by the 1/20s delta clamp, so a wall-clock timeout fails systems
 * that are working perfectly.
 *
 * The long-running checks drive `director.update` directly instead of waiting
 * for frames. That is not a shortcut around the render path - the screenshots
 * are still real frames, and every one is gated on mean luminance - it is the
 * only way to put four hundred spawns and four hundred deaths through a
 * simulation whose clock runs six times slower than the wall.
 */

import { chromium } from 'playwright';
import sharp from 'sharp';
import { resolveChrome } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto('http://127.0.0.1:4177/index.html', { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1400);

// ---------------------------------------------------------------------------
// helpers, injected once
// ---------------------------------------------------------------------------

await page.addScriptTag({
  content: `
window.__E__ = {
  async frames(n) {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  },

  /**
   * Advance the simulation without rendering.
   *
   * The director, the actors, and the combat system are all pure functions of
   * dt; nothing in them reads the frame buffer. Driving them at a fixed 1/30
   * lets four hundred spawn-and-die cycles run in a couple of seconds of wall
   * clock instead of half an hour.
   */
  sim(seconds, dt = 1 / 30) {
    const g = window.__SANDS__;
    const n = Math.ceil(seconds / dt);
    for (let i = 0; i < n; i++) {
      g.director.update(dt, i * dt);
      g.combat.update(dt);
    }
    return n;
  },

  /** Put the player somewhere and point them along a yaw. */
  place(x, z, yaw) {
    const g = window.__SANDS__;
    g.player.teleport({ x, y: 0, z });
    g.rig.reset(yaw, -0.02);
    g.rig.update(1 / 60, g.player, false);
    g.camera.updateMatrixWorld(true);
  },

  /** Aim the camera at a world point and commit it to the camera matrix. */
  aimAt(x, y, z) {
    const g = window.__SANDS__;
    const c = g.player.position;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const flat = Math.hypot(dx, dz);
    // Forward is (-sin yaw, 0, -cos yaw), the game's convention throughout.
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, flat);
    g.rig.reset(yaw, pitch);
    g.rig.update(1 / 60, g.player, false);
    g.camera.updateMatrixWorld(true);
    return { yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3) };
  },

  /** World position of the first mesh of an actor tagged with a region. */
  regionPoint(actor, region) {
    const m = actor.rig.meshes.find((x) => x.userData.region === region);
    if (!m) return null;
    m.updateWorldMatrix(true, false);
    const e = m.matrixWorld.elements;
    return { x: e[12], y: e[13], z: e[14] };
  },

  /**
   * Is the named region of this actor the FIRST thing a centre shot would hit?
   *
   * The courtyard is dressed: there are crates, braziers, and rubble between
   * any two points you pick blind, and the first version of this harness
   * reported a broken headshot when what it had actually done was shoot a
   * plank. Probing with a bare raycaster rather than the weapon means the test
   * costs no ammunition and no impact particles.
   */
  sightClear(actor, region, halfAngle = 0.008) {
    const g = window.__SANDS__;
    const THREE = g.THREE;
    const p = window.__E__.regionPoint(actor, region);
    if (!p) return false;
    window.__E__.aimAt(p.x, p.y, p.z);

    const ray = new THREE.Raycaster();
    const centre = new THREE.Vector2(0, 0);
    const axis = new THREE.Vector3();
    const perp = new THREE.Vector3();

    // A CONE, not a line.
    //
    // A shot carries the weapon's aimed spread, so a single centre ray that
    // clips the very edge of a skull reports a clean line for a shot that will
    // sail past it into the scenery behind. That is a one-in-four flake, and
    // one-in-four is worse than always failing: it teaches you to re-run.
    // Probing the four corners of the cone as well makes the answer mean what
    // the caller thinks it means.
    for (let i = 0; i < 5; i++) {
      ray.setFromCamera(centre, g.camera);
      ray.far = 120;

      if (i > 0) {
        const dir = ray.ray.direction;
        perp.set(0, 1, 0);
        if (Math.abs(dir.dot(perp)) > 0.99) perp.set(1, 0, 0);
        axis.crossVectors(dir, perp).normalize();
        perp.crossVectors(dir, axis).normalize();

        const roll = (i - 1) * Math.PI / 2;
        dir.addScaledVector(axis, Math.tan(halfAngle) * Math.cos(roll));
        dir.addScaledVector(perp, Math.tan(halfAngle) * Math.sin(roll));
        dir.normalize();
      }

      const first = ray.intersectObjects(g.world.hitTargets, true)
        .find((h) => h.object.visible && !h.object.userData?.noHit);

      if (!(first
        && first.object.userData?.enemy === actor
        && first.object.userData?.region === region)) return false;
    }
    return true;
  },

  /** Put one enemy somewhere the player has a clean line to the named region. */
  placeInSight(id, region) {
    const g = window.__SANDS__;
    const d = g.director;
    const px = g.player.position.x, pz = g.player.position.z;

    for (const dist of [7, 9, 11, 6, 13, 15]) {
      for (const off of [0, -3, 3, -6, 6, -9, 9]) {
        d.reset();
        const a = d.placeAt(id, px + off, pz - dist);
        if (!a) continue;
        a.st.speedScale = 0;
        if (window.__E__.sightClear(a, region)) return a;
      }
    }
    return null;
  },

  /** One aimed shot, with the rate limiter stood down. */
  shootAt(actor, region, weapon) {
    const g = window.__SANDS__;
    const p = window.__E__.regionPoint(actor, region);
    if (!p) return null;

    if (weapon) { g.weapons.state.owned.add(weapon); g.weapons.equip(weapon); }
    g.weapons.state.lastShot = -Infinity;
    g.weapons.state.reloading = false;
    g.weapons.ammo[g.weapons.state.current].mag = g.weapons.STATS[g.weapons.state.current].magazine;

    window.__E__.aimAt(p.x, p.y, p.z);

    const goldBefore = g.economy.gold;
    const hits = g.weapons.fire(true) || [];

    // The frame loop routes hits through damage and then through the economy;
    // driving both here keeps this identical to what the game does.
    g.combat.applyHits(hits);
    for (const h of hits) {
      if (!h.enemy) continue;
      g.economy.award(h.killed ? (h.region === 'head' ? 'headshot' : 'kill') : 'hit');
    }

    return {
      count: hits.length,
      regions: hits.map((h) => h.region),
      onEnemy: hits.filter((h) => h.enemy).length,
      killed: hits.some((h) => h.killed),
      goldDelta: g.economy.gold - goldBefore,
    };
  },

  mem() {
    const g = window.__SANDS__;
    return {
      geometries: g.renderer.info.memory.geometries,
      textures: g.renderer.info.memory.textures,
      sceneChildren: g.scene.children.length,
      rootChildren: g.director.root.children.length,
      calls: g.renderer.info.render.calls,
      triangles: g.renderer.info.render.triangles,
    };
  },
};
`,
});

const shots = [];

/**
 * THE BLACK-FRAME GATE READS THE FRAME THAT WAS ACTUALLY CAPTURED.
 *
 * The previous reader ran inside the page: it drew `renderer.domElement` into a
 * 2D canvas and sampled that. With `preserveDrawingBuffer: false` - which is
 * what this renderer is built with, and what it should be built with - the
 * WebGL back buffer is not guaranteed to hold anything after the compositor has
 * taken it, so `drawImage` samples whatever is left, which is a cleared buffer
 * as often as not. It reported a sunlit courtyard at luma 7. The dark-frame
 * gate was then calibrated to `meanLuma < 6` so that the harness would go
 * green - a threshold set to accommodate a broken instrument, which is the
 * project's most expensive recurring failure written into the test suite.
 *
 * `page.screenshot()` goes through the browser's own capture path and returns
 * the composited frame, which is the same image a human would see. Decoding it
 * in node rather than back in the page keeps the measurement independent of
 * whatever state the page is in.
 *
 * UPPER TWO THIRDS ONLY. The bottom third is the viewmodel, and the weapon
 * renders correctly when nothing else does; including it lifts a fully black
 * scene to a number that passes.
 */
async function measure(png) {
  const meta = await sharp(png).metadata();
  const rows = Math.floor(meta.height * 0.66);

  const { data, info } = await sharp(png)
    .extract({ left: 0, top: 0, width: meta.width, height: rows })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const n = info.width * info.height;
  let sum = 0;
  let lit = 0;
  for (let i = 0; i < data.length; i += 3) {
    const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
    sum += l;
    if (l > 10) lit++;
  }

  return { meanLuma: +(sum / n).toFixed(2), percentLit: +((lit / n) * 100).toFixed(1) };
}

async function shoot(name, label) {
  await page.evaluate(() => window.__E__.frames(3));
  const png = await page.screenshot({ path: `${OUT}${name}.png` });
  const stats = await measure(png);
  shots.push({ name, label, ...stats });
  return stats;
}

// ---------------------------------------------------------------------------
// 1. the pool exists before anything has spawned
// ---------------------------------------------------------------------------

const boot = await page.evaluate(() => {
  const g = window.__SANDS__;
  g.combat.state.invulnerable = true;     // the harness is not here to survive
  return {
    stats: g.director.stats(),
    hitTargets: g.world.hitTargets.length,
    rootMounted: !!g.director.root.parent,
  };
});

// ---------------------------------------------------------------------------
// 2. a wave arrives and walks to the player
// ---------------------------------------------------------------------------

/**
 * THE START DISTANCE IS SAMPLED AT SPAWN, NOT NINE SECONDS IN.
 *
 * This block used to sim(9) to get the wave down, call the distances at that
 * moment the "start", and assert the mean fell by another three metres. Two
 * things are wrong with that. A wave of seven spawns over about nine seconds at
 * the 1.455s interval, so at the moment of sampling the first arrivals are
 * already in melee and the last has not been placed - the "start" mean is a
 * blend of both, and it moves with spawn order. And when the horde is FAST the
 * mean has already collapsed before the window opens, so there is no room left
 * to fall by three: measured five times over on a build where every enemy
 * arrived, the delta came out 4.70, 2.71, 6.54, 3.68, 3.23 and the check failed
 * once. A test that fails because the thing it tests works is not a test.
 *
 * So each actor is measured the frame it goes live, which is what "spawns at
 * X metres" actually means, and the arrival is asserted directly: not that a
 * mean moved, but that NOTHING IS LEFT BEHIND. That is strictly the harder
 * claim, and it is the one that catches the bug this block exists for - a
 * stranded enemy holding 16.75 m forever while its neighbours reach melee and
 * drag the mean down over it.
 */
const approach = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;

  d.reset();
  window.__E__.place(0, 30, 0);
  d.forceWave(1);

  const dist = (a) => Math.hypot(a.position.x - g.player.position.x,
                                 a.position.z - g.player.position.z);

  // Spawn the wave, catching each actor on its first live frame.
  const spawnDist = new Map();
  const dt = 1 / 30;
  for (let i = 0; i < Math.ceil(9 / dt); i++) {
    g.director.update(dt, i * dt);
    g.combat.update(dt);
    for (const a of d.live) if (!spawnDist.has(a)) spawnDist.set(a, dist(a));
  }

  const first = d.stats();

  // Let them walk. The player does not move, so any closing is theirs.
  //
  // Twenty simulated seconds, because a shambler covers 2.25 m/s and the
  // placement band puts it twenty metres out. Nine seconds was inside the
  // margin, and a test that fails when the horde is merely SLOW is a test that
  // reports the wrong thing.
  window.__E__.sim(20);

  const end = [];
  let closest = Infinity;
  let furthest = 0;
  for (const a of d.live) {
    const d2 = dist(a);
    end.push(d2);
    if (d2 < closest) closest = d2;
    if (d2 > furthest) furthest = d2;
  }

  const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const start = [...spawnDist.values()];

  return {
    spawned: first.live,
    queued: first.queued,
    spawnPoints: first.spawnPoints,
    spawnPointsReachable: first.spawnPointsReachable,
    meanStart: +mean(start).toFixed(2),
    maxStart: +Math.max(...start).toFixed(2),
    meanEnd: +mean(end).toFixed(2),
    closest: +closest.toFixed(2),
    furthest: +furthest.toFixed(2),
    stillLive: d.live.length,
    variants: d.live.map((a) => a.variant),
    // Nobody sealed in a pocket. Asked of the director's own walk field, so it
    // is the same answer the placement search uses rather than a second guess.
    allOnPlayersIsland: d.live.every((a) => d.reachesPlayer(a.position.x, a.position.z)),
    stranded: d.live
      .filter((a) => !d.reachesPlayer(a.position.x, a.position.z))
      .map((a) => ({ v: a.variant, x: +a.position.x.toFixed(1), z: +a.position.z.toFixed(1) })),
  };
});

// A shot of the horde coming down the avenue.
await page.evaluate(() => window.__E__.place(0, 34, 0));
const shotWave = await shoot('enemy-01-wave-courtyard', 'wave incoming, courtyard');

// ---------------------------------------------------------------------------
// 3. silhouettes: one of each variant at twenty metres
// ---------------------------------------------------------------------------

const lineup = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;
  d.reset();
  window.__E__.place(0, 34, 0);

  // Four abreast, twenty metres out, on the avenue's centre line. Spread wide
  // enough that no two overlap at this distance.
  const at = -20 + 34;
  const made = [
    d.placeAt('shambler', -4.5, at),
    d.placeAt('husk', -1.5, at),
    d.placeAt('bound', 1.5, at),
    d.placeAt('scarab', 4.5, at),
  ];

  // Hold them still so the lineup is a lineup: zero speed leaves the walk cycle
  // idling, which is what a silhouette should be judged against.
  for (const a of made) if (a) a.st.speedScale = 0;
  window.__E__.sim(1.2);
  for (const a of made) if (a) a.st.speedScale = 0;

  return {
    placed: made.filter(Boolean).map((a) => a.variant),
    heights: made.filter(Boolean).map((a) => ({
      v: a.variant,
      h: +(a.spec.height * a.spec.scale).toFixed(2),
      tri: a.triangles,
    })),
  };
});

const shotLineup = await shoot('enemy-02-lineup-20m', 'four variants at 20 m');

await page.evaluate(() => window.__E__.place(0, 27, 0));
const shotMid = await shoot('enemy-03-lineup-13m', 'four variants at 13 m');

await page.evaluate(() => window.__E__.place(0, 21, 0));
const shotClose = await shoot('enemy-03b-lineup-close', 'four variants at 7 m');

// ---------------------------------------------------------------------------
// 4. hitscan finds both regions, and the payouts are the frozen ones
// ---------------------------------------------------------------------------

const hitting = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;

  d.reset();
  window.__E__.place(0, 30, 0);

  const out = {};

  // --- a body hit that does not kill: the pistol, 42 damage into 150 health.
  let a = window.__E__.placeInSight('shambler', 'body');
  out.placed = !!a;
  out.body = a ? window.__E__.shootAt(a, 'body', 'mk9') : null;

  // --- a head hit that does not kill either: 42 * 2.6 into what is left.
  // Placed fresh so the two are independent measurements.
  a = window.__E__.placeInSight('shambler', 'head');
  out.head = a ? window.__E__.shootAt(a, 'head', 'mk9') : null;

  // --- a body KILL with the bolt: 220 into 150.
  a = window.__E__.placeInSight('shambler', 'body');
  out.bodyKill = a ? window.__E__.shootAt(a, 'body', 'bolt') : null;

  // --- a head KILL with the bolt: 220 * 4 into 150.
  a = window.__E__.placeInSight('shambler', 'head');
  out.headKill = a ? window.__E__.shootAt(a, 'head', 'bolt') : null;

  // --- scenery still pays nothing, which is the M4 stand-in being gone.
  d.reset();
  window.__E__.place(0, 30, 0);
  g.weapons.equip('mk9');
  g.weapons.state.lastShot = -Infinity;
  window.__E__.aimAt(0, 0.2, -20);
  const before = g.economy.gold;
  const sceneryHits = g.weapons.fire(true) || [];
  g.combat.applyHits(sceneryHits);
  for (const h of sceneryHits) {
    if (!h.enemy) continue;
    g.economy.award(h.killed ? (h.region === 'head' ? 'headshot' : 'kill') : 'hit');
  }
  out.scenery = {
    count: sceneryHits.length,
    onEnemy: sceneryHits.filter((h) => h.enemy).length,
    goldDelta: g.economy.gold - before,
  };

  return out;
});

// The corpse mid-topple, which is the one animation a still can actually show.
const dying = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;
  d.reset();
  window.__E__.place(0, 30, 0);
  const a = d.placeAt('shambler', -1.5, 24);
  const b = d.placeAt('bound', 2.0, 24);
  a.st.speedScale = 0; b.st.speedScale = 0;
  window.__E__.sim(0.5);
  a.hurt(9999, 'body', 0, -1);
  window.__E__.sim(0.35);
  window.__E__.aimAt(0, 1.2, 24);
  return { dying: a.dying, dead: a.dead, health: a.health };
});

const shotDying = await shoot('enemy-04-topple', 'a shambler mid-topple');

// ---------------------------------------------------------------------------
// 5. the pool does not leak over several hundred spawns
// ---------------------------------------------------------------------------

const leak = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;

  d.reset();
  window.__E__.place(0, 30, 0);
  window.__E__.sim(0.2);

  const before = window.__E__.mem();
  const ids = ['shambler', 'husk', 'bound', 'scarab'];

  let spawned = 0;
  let peakLive = 0;

  // Twenty rounds of fill-the-cap, kill-everything, wait-for-the-pool.
  for (let round = 0; round < 20; round++) {
    for (let i = 0; i < 24; i++) {
      const a = d.placeAt(ids[i % ids.length], (i % 8) * 3 - 12, 18 + Math.floor(i / 8) * 4);
      if (a) spawned++;
    }
    peakLive = Math.max(peakLive, d.live.length);

    for (const a of d.live.slice()) a.hurt(1e9, 'body', 0, 1);
    // Long enough for topple, lie, and crumble to finish and the pool to take
    // them back. Waiting on STATE rather than a duration: the loop below is the
    // condition, the 12 seconds is only its ceiling.
    let t = 0;
    while (d.live.length && t < 12) { window.__E__.sim(0.25); t += 0.25; }
  }

  const after = window.__E__.mem();

  return {
    spawned,
    peakLive,
    liveAfter: d.live.length,
    geometriesDelta: after.geometries - before.geometries,
    texturesDelta: after.textures - before.textures,
    sceneChildrenDelta: after.sceneChildren - before.sceneChildren,
    rootChildrenDelta: after.rootChildren - before.rootChildren,
    rootChildren: after.rootChildren,
    pooled: d.stats().pooled,
  };
});

// ---------------------------------------------------------------------------
// 6. the cap holds under a wave that wants more than it
// ---------------------------------------------------------------------------

const cap = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;

  d.reset();
  window.__E__.place(0, 30, 0);
  d.forceWave(18);              // composes far more than the cap

  let peak = 0;
  for (let i = 0; i < 240; i++) {
    window.__E__.sim(0.25);
    peak = Math.max(peak, d.live.length);
  }

  return {
    wave: d.state.wave,
    peakLive: peak,
    cap: d.stats().cap,
    variants: Array.from(new Set(d.live.map((a) => a.variant))),
  };
});

// Frame cost with the cap full, measured on real frames.
const frameCost = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;

  d.reset();
  window.__E__.place(0, 34, 0);
  for (let i = 0; i < 24; i++) {
    d.placeAt(['shambler', 'husk', 'bound', 'scarab'][i % 4],
      (i % 6) * 4 - 10, 22 - Math.floor(i / 6) * 4);
  }
  await window.__E__.frames(6);

  const sample = async (n) => {
    const t = [];
    let last = performance.now();
    for (let i = 0; i < n; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      t.push(now - last);
      last = now;
    }
    t.sort((a, b) => a - b);
    return +t[Math.floor(t.length / 2)].toFixed(2);
  };

  const withHorde = await sample(24);
  const live = d.live.length;

  // Draw calls and triangles are counted from the scene graph, not from
  // renderer.info: the composer's last pass is a fullscreen quad and it resets
  // the counters, so info.render reports 1 call and 1 triangle no matter what
  // was drawn. A screenshot-driven harness that trusted that number would
  // report a horde of twenty-four as free.
  let meshes = 0, tris = 0;
  for (const a of d.live) { meshes += a.rig.meshes.length; tris += a.triangles; }

  // Simulation cost on its own, with rendering out of the way. This is the
  // number that transfers to a real GPU; the frame time below is dominated by
  // software rasterisation and is not representative of anything else.
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) d.update(1 / 60, i / 60);
  const simMs = (performance.now() - t0) / 200;

  d.reset();
  await window.__E__.frames(6);
  const empty = await sample(24);

  return {
    live,
    meshesLive: meshes,
    meshesPerEnemy: +(meshes / (live || 1)).toFixed(1),
    trianglesLive: tris,
    trianglesPerEnemy: Math.round(tris / (live || 1)),
    simMsPer24Actors: +simMs.toFixed(3),
    medianMsWithHorde: withHorde,
    medianMsEmpty: empty,
    medianMsDelta: +(withHorde - empty).toFixed(1),
  };
});

// ---------------------------------------------------------------------------
// 7. wave five brings a god, with a bar
// ---------------------------------------------------------------------------

const bossRun = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;

  d.reset();
  window.__E__.place(0, 30, 0);
  d.forceWave(5);

  // Wave five composes a boss the moment the breather elapses.
  let t = 0;
  while (!d.boss && t < 12) { window.__E__.sim(0.25); t += 0.25; }
  if (!d.boss) return { spawned: false };

  const boss = d.boss;
  const startHealth = boss.health;

  const dist = () => Math.hypot(boss.position.x - g.player.position.x,
                                boss.position.z - g.player.position.z);
  const spawnDist = dist();

  // Let it act, so an ability is observed rather than assumed.
  //
  // CLOSEST APPROACH, not the distance on the final tick. A god charges,
  // recovers and volleys, so where it happens to be standing forty seconds in
  // says very little; whether it ever got its hands on the player says
  // everything, and it is the number that catches a boss that cannot arrive.
  // Wave five ends when the boss dies. A boss walled off from the player can
  // neither reach them nor be shot by them, so a stall here does not slow the
  // round down, it ends the run.
  const seen = new Set();
  let closest = spawnDist;
  for (let i = 0; i < 400; i++) {
    window.__E__.sim(0.1);
    if (boss.ability) seen.add(boss.ability);
    const now = dist();
    if (now < closest) closest = now;
  }

  boss.hurt(boss.maxHealth * 0.55, 'body', 0, 1);

  return {
    spawned: true,
    name: boss.name,
    variant: boss.variant,
    maxHealth: boss.maxHealth,
    startHealth,
    healthNow: boss.health,
    abilitiesSeen: Array.from(seen),
    spawnDistance: +spawnDist.toFixed(1),
    closest: +closest.toFixed(1),
    distance: +dist().toFixed(1),
    spawnPointsForBoss: d.stats().spawnPointsForBoss,
  };
});

// Real frames, so the HUD actually paints, then read the bar out of the DOM.
await page.evaluate(async () => {
  const g = window.__SANDS__;
  const b = g.director.boss;
  if (b) {
    // Bring it into frame at a distance where the whole colossus is visible.
    b.position.set(0, b.position.y, 20);
    window.__E__.place(0, 34, 0);
    window.__E__.aimAt(0, 2.4, 20);
  }
  await window.__E__.frames(4);
});

const bossHud = await page.evaluate(() => {
  const el = document.getElementById('boss');
  return {
    hidden: el.hidden,
    name: document.getElementById('boss-name').textContent,
    width: document.getElementById('boss-bar').style.width,
  };
});

const shotBoss = await shoot('enemy-05-boss', 'a god, with its bar');

// Each god, so all five crowns are judged rather than one.
const gods = [];
for (const id of ['anubis', 'ammit', 'apep', 'sekhmet', 'set']) {
  await page.evaluate(async (gid) => {
    const g = window.__SANDS__;
    const d = g.director;
    d.reset();
    window.__E__.place(0, 34, 0);
    const boss = d.bosses.get(gid);
    boss.spawn(0, 20, { heightAt: g.world.heightAt, bounds: g.world.bounds,
      walls: g.world.walls, colliderGrid: { near: () => 0, out: [] } }, 1);
    d.root.add(boss.group);
    d.live.push(boss);
    d.state.boss = boss;
    window.__E__.aimAt(0, 2.6, 20);
    await window.__E__.frames(3);
  }, id);
  const s = await shoot(`enemy-06-god-${id}`, `${id} at 14 m`);
  gods.push({ id, ...s });
}

// ---------------------------------------------------------------------------
// 8. the interior: spawn, path, and shoot on the other side of the doorway
// ---------------------------------------------------------------------------

const interior = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;

  d.reset();

  // Straight through the router, which is what the doorway does once bought.
  g.spaces.enter('interior', { x: 0, z: -177, rot: 0 });
  g.player.teleport({ x: 0, y: 0, z: -170 });

  // One update for the director to notice the transition and retarget.
  window.__E__.sim(0.1);
  const afterSwap = d.stats();

  d.forceWave(3);
  window.__E__.sim(10);

  const spawned = d.live.length;
  const rooms = new Set();
  const start = [];
  for (const a of d.live) {
    const r = g.interior.roomAt(a.position.x, a.position.z);
    rooms.add(r ? r.id : 'solid-rock');
    start.push(Math.hypot(a.position.x - g.player.position.x,
                          a.position.z - g.player.position.z));
  }

  window.__E__.sim(10);

  const end = [];
  for (const a of d.live) {
    end.push(Math.hypot(a.position.x - g.player.position.x,
                        a.position.z - g.player.position.z));
  }

  const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

  // And they are shootable in here too.
  let shot = null;
  if (d.live.length) {
    const target = d.live[0];
    target.st.speedScale = 0;
    shot = window.__E__.shootAt(target, 'head', 'mk9');
  }

  return {
    space: g.spaces.active,
    spawnPoints: afterSwap.spawnPoints,
    pointSpace: afterSwap.space,
    liveAfterSwap: afterSwap.live,
    spawned,
    rooms: Array.from(rooms),
    meanStart: +mean(start).toFixed(2),
    meanEnd: +mean(end).toFixed(2),
    shot,
  };
});

await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;

  // A framed shot, not whatever the fight happened to leave in front of the
  // lens. The first version photographed the horde at nought metres because it
  // shot after twenty seconds of them charging, which proves they charge and
  // nothing about whether they read.
  d.reset();
  window.__E__.place(0, -166, Math.PI);
  const at = -178;
  for (const [id, x] of [['shambler', -5], ['husk', -1.7], ['bound', 1.7], ['scarab', 5]]) {
    const a = d.placeAt(id, x, at);
    if (a) a.st.speedScale = 0;
  }
  window.__E__.sim(1.0);
  for (const a of d.live) a.st.speedScale = 0;
  window.__E__.aimAt(0, 1.6, at);
  await window.__E__.frames(3);
});
const shotInterior = await shoot('enemy-07-interior', 'four variants in the Great Gallery');

// The transition itself: nothing survives it.
const transition = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;
  const liveInside = d.live.length;

  g.spaces.enter('exterior', { x: 0, z: 30, rot: 0 });
  window.__E__.sim(0.1);

  const afterOut = { live: d.live.length, stats: d.stats() };

  d.forceWave(2);
  window.__E__.sim(9);

  return {
    liveInside,
    liveImmediatelyAfter: afterOut.live,
    pointSpaceAfter: afterOut.stats.space,
    respawnedOutside: d.live.length,
    allOutside: d.live.every((a) => a.position.z > -60),
  };
});

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

await browser.close();

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
const IGNORABLE = [/GPU stall due to ReadPixels/, /GL Driver Message/];
const warnings = logs
  .filter((l) => l.startsWith('[warning]'))
  .filter((l) => !IGNORABLE.some((re) => re.test(l)));

const show = (name, o) => { console.log(`--- ${name} ---`); console.log(JSON.stringify(o, null, 2)); };

show('boot', boot);
show('approach', approach);
show('lineup', lineup);
show('hitting', hitting);
show('dying', dying);
show('pool', leak);
show('cap', cap);
show('frame cost', frameCost);
show('boss', bossRun);
show('boss hud', bossHud);
show('interior', interior);
show('transition', transition);

console.log('--- shots ---');
for (const s of shots) {
  console.log(`  ${s.name.padEnd(30)} luma=${String(s.meanLuma).padStart(6)} lit=${String(s.percentLit).padStart(5)}%  ${s.label}`);
}

if (errors.length) { console.log('--- errors ---'); for (const e of errors) console.log(e); }
if (warnings.length) { console.log('--- warnings ---'); for (const w of warnings) console.log(w); }

/**
 * A shot of an unlit frame proves nothing about a silhouette, so every one is
 * gated before it is allowed to count as evidence.
 *
 * RECALIBRATED AGAINST WHAT A REAL FRAME MEASURES. The old threshold - luma 6,
 * lit 25% - was set so that a reader which reported a sunlit courtyard at luma
 * 7 would still go green. It could not have failed on anything, which on a
 * project that has shipped a fully black screen under a fully green suite three
 * times is the failure written into the gate. Every number below was measured
 * on this build through the reader above, at 1440x860, upper two thirds:
 *
 *     courtyard, sunlit                     116.44 luma    95.1% lit
 *     this suite's eleven exterior shots    99.10-123.65   90.6-98.3%
 *     this suite's interior shot             42.02-43.43   97.9-98.8%
 *     the darkest lit interior reachable      6.21-14.79   13.8-41.7%
 *     the whole canvas at 12% brightness       5.47         4.4%
 *     the whole canvas at 4% brightness        1.90         0.1%
 *     A GENUINELY BLACK CAPTURED FRAME         0.14         0.1%
 *
 * Black is not near the floor of the legitimate range, it is two orders of
 * magnitude below it, so the gate does not have to be brave. Eighteen sits 2.3x
 * under the darkest shot this suite actually takes and 128x over black; 55 per
 * cent lit sits 1.65x under the least-lit shot and 550x over black. Both catch
 * the 4% and 12% cases, which are what a scene that renders but is never lit
 * looks like.
 *
 * If a future shot in this suite is framed somewhere that reads under 18, that
 * is not a reason to lower this number. It is a shot too dark to judge a
 * silhouette in, which is the thing the gate is for.
 */
const DARK = shots.filter((s) => s.meanLuma < 18 || s.percentLit < 55);

const checks = {
  'pool allocated at boot':            boot.stats.pooled >= 40,
  'bosses allocated at boot':          boot.stats.trianglesBosses > 0,
  'enemy root is mounted':             boot.rootMounted === true,
  'enemy root is a hit target':        boot.hitTargets === 2,
  'spawn points found in courtyard':   boot.stats.spawnPoints > 50,

  'wave one spawned':                  approach.spawned > 0,
  'no enemy is sealed off from the player':
                                       approach.allOnPlayersIsland === true,
  'the horde closes on the player':    approach.meanEnd < approach.meanStart - 3,
  'something reached melee range':     approach.closest < 4,
  // The one that catches a stranded actor. A mean can be dragged down over the
  // top of an enemy pinned in a pocket forever; a maximum cannot.
  'the WHOLE horde arrives':           approach.furthest < 6 && approach.meanEnd < 4,

  'all four variants build':           lineup.placed.length === 4,
  'variants differ in height':         new Set(lineup.heights.map((h) => h.h)).size >= 3,

  'a clean line was found':            hitting.placed === true,
  'body hit registers on an enemy':    !!hitting.body && hitting.body.onEnemy === 1 && hitting.body.regions[0] === 'body',
  'head hit registers on an enemy':    !!hitting.head && hitting.head.onEnemy === 1 && hitting.head.regions[0] === 'head',
  'a non-lethal hit pays 10':          hitting.body.goldDelta === 10,
  'a body kill pays 60':               !!hitting.bodyKill && hitting.bodyKill.killed && hitting.bodyKill.goldDelta === 60,
  'a headshot kill pays 100':          !!hitting.headKill && hitting.headKill.killed && hitting.headKill.goldDelta === 100,
  'scenery pays nothing':              hitting.scenery.count > 0 && hitting.scenery.goldDelta === 0,

  'death toppling begins':             dying.dying === true && dying.health === 0,

  'several hundred spawns ran':        leak.spawned >= 400,
  'no geometry leak':                  leak.geometriesDelta === 0,
  'no texture leak':                   leak.texturesDelta === 0,
  'no scene graph leak':               leak.sceneChildrenDelta === 0,
  'pool returned everything':          leak.rootChildren === 0 && leak.liveAfter === 0,
  'pool depth unchanged':              leak.pooled === boot.stats.pooled,

  'live cap holds':                    cap.peakLive <= cap.cap && cap.peakLive >= 20,
  'late waves mix variants':           cap.variants.length >= 3,

  'boss spawned on wave five':         bossRun.spawned === true,
  'boss is the first god':             bossRun.variant === 'anubis',
  'boss used a telegraphed ability':   bossRun.abilitiesSeen.length > 0,
  // A god is 1.81 m wide against the horde's 0.74, so it needs its own answer
  // to "can this point walk to the player". These two are that answer's gate.
  'boss has somewhere a god can fit':  bossRun.spawnPointsForBoss > 10,
  'the boss reaches the player':       bossRun.closest < 6,
  'boss bar is shown':                 bossHud.hidden === false,
  'boss bar is named':                 bossHud.name === bossRun.name,
  'boss bar tracks health':            /^[0-9.]+%$/.test(bossHud.width),

  'router swapped to interior':        interior.space === 'interior',
  'interior spawn points found':       interior.spawnPoints > 10,
  'transition cleared the horde':      interior.liveAfterSwap === 0,
  'interior wave spawned':             interior.spawned > 0,
  'interior spawns are inside rooms':  !interior.rooms.includes('solid-rock'),
  'the horde closes inside too':       interior.meanEnd < interior.meanStart - 2,
  'hitscan works inside':              interior.shot && interior.shot.onEnemy === 1,

  'leaving cleared the horde':         transition.liveImmediatelyAfter === 0,
  'placement retargeted on exit':      transition.pointSpaceAfter === 'exterior',
  'waves resume outside':              transition.respawnedOutside > 0 && transition.allOutside,

  'every shot rendered a lit frame':   DARK.length === 0,
  'no console errors':                 errors.length === 0,
};

console.log('\n--- checks ---');
let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

if (DARK.length) {
  console.log('--- dark shots ---');
  for (const d of DARK) console.log(`  ${d.name} luma=${d.meanLuma} lit=${d.percentLit}%`);
}

console.log(`\nshots -> ${OUT}`);
console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
