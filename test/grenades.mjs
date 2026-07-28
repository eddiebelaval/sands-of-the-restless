/**
 * Grenade harness.
 *
 * The module under test is NOT wired into main.js - two other lanes own that
 * file - so this harness is also the integration document. It boots the real
 * game, imports src/systems/grenades.js in the page, constructs it against the
 * live scene, world, player, camera, director, combat and economy, and then
 * installs the exact rAF driver main.js will install. If this file runs, the
 * wiring works; the lines to copy are marked INTEGRATION below.
 *
 * The claim is "a grenade is a wager with a real arc and a real blast", and it
 * decomposes into ten facts that fail independently and silently:
 *
 *   1. the arc is a PARABOLA. Not a lerp, not a curve that looks about right:
 *      constant horizontal velocity and a constant second difference in y.
 *   2. it BOUNCES off a wall rather than passing through it, and the wall it
 *      bounces off is one of the world's own cylinders.
 *   3. it comes to REST. A shell that slides forever cannot be placed.
 *   4. the fuse fires ON TIME, in simulated seconds.
 *   5. cooking SHORTENS it, by exactly what was cooked.
 *   6. an overcooked one KILLS YOU. Without this the mechanic is a button.
 *   7. damage FALLS OFF with distance, monotonically, and stops at the rim.
 *   8. geometry BLOCKS it, against a control at the same distance in the open.
 *   9. a grenade kill PAYS 60, through the same record the bullet path uses.
 *  10. a hundred throws leak NOTHING - no geometry, no texture, no scene child.
 *
 * TIME IS SIMULATED, NEVER WALL-CLOCK. Under software rendering the 1/20 delta
 * clamp makes the simulation run about six times slower than the wall, so a
 * fuse test written against setTimeout would report a working three-second fuse
 * as an eighteen-second one. Everything that measures time drives update() at a
 * fixed dt and counts. The only things that wait on frames are the screenshots,
 * and those wait on frames, not on milliseconds.
 *
 * THE FRAMES ARE MEASURED FROM page.screenshot() DECODED IN NODE, over the
 * UPPER TWO THIRDS. The in-page drawImage(renderer.domElement) path samples a
 * cleared buffer with preserveDrawingBuffer:false and once reported a sunlit
 * courtyard at luma 7. And because the thing being photographed is an
 * EXPLOSION - the one subject where blowing the highlights raises every
 * brightness metric while destroying the image - every shot is also measured
 * for clipped fraction and for spread, and the explosion gate asserts all
 * three: brighter than the plate, not clipped, and not flattened.
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
// construct the module, exactly the way main.js will
// ---------------------------------------------------------------------------

const construction = await page.evaluate(async () => {
  const g = window.__SANDS__;

  const before = {
    sceneChildren: g.scene.children.length,
    geometries: g.renderer.info.memory.geometries,
    textures: g.renderer.info.memory.textures,
  };

  // INTEGRATION, line 1 of 3: the import.
  const { createGrenades, GRENADE_CONSTANTS } =
    await import('/src/systems/grenades.js');

  // INTEGRATION, line 2 of 3: the construction. Every argument already exists
  // in main.js by the time the director does, and nothing here is new.
  const grenades = createGrenades({
    scene: g.scene,
    camera: g.camera,
    world: g.world,
    player: g.player,
    rig: g.rig,
    audio: g.audio,
    impacts: g.impacts,
    combat: g.combat,
    economy: g.economy,
    director: g.director,
    spaces: g.spaces,
    notice: (t, ms) => { window.__LAST_NOTICE__ = t; },
  });

  window.__G__ = grenades;
  window.__K__ = GRENADE_CONSTANTS;
  g.grenades = grenades;

  // INTEGRATION, line 3 of 3: one call per frame, after the camera has moved.
  // In main.js this is a single line inside frame(); here it is its own rAF so
  // the harness can drive the real render path without touching main.js.
  window.__GD__ = { on: true, last: performance.now() };
  (function drive() {
    requestAnimationFrame(drive);
    const now = performance.now();
    const dt = Math.min((now - window.__GD__.last) / 1000, 1 / 20);
    window.__GD__.last = now;
    if (window.__GD__.on) grenades.update(dt, g.input.state);
  })();

  return {
    before,
    after: {
      sceneChildren: g.scene.children.length,
      geometries: g.renderer.info.memory.geometries,
      textures: g.renderer.info.memory.textures,
    },
    stats: grenades.stats(),
    K: GRENADE_CONSTANTS,
    inputHasGrenadeKey: 'grenade' in g.input.state,
    combatHasApplyBlast: typeof g.combat.applyBlast === 'function',
  };
});

const K = construction.K;

// ---------------------------------------------------------------------------
// helpers, injected once
// ---------------------------------------------------------------------------

await page.addScriptTag({
  content: `
window.__H__ = {
  async frames(n) {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  },

  /**
   * Advance the grenade simulation at a FIXED dt without rendering.
   *
   * Nothing in the module reads the frame buffer, so this is the whole
   * simulation and it is deterministic. It is also the only honest way to
   * measure a 3.4 second fuse on a renderer whose frames arrive four times a
   * second.
   */
  sim(seconds, dt = 1 / 60) {
    const n = Math.ceil(seconds / dt);
    for (let i = 0; i < n; i++) window.__G__.update(dt, null);
    return n * dt;
  },

  /** Suspend the rAF driver so a scripted sim owns the clock outright. */
  hold(on) { window.__GD__.on = !on; },

  place(x, z, yaw, pitch = -0.02) {
    const g = window.__SANDS__;
    g.player.teleport({ x, y: 0, z });
    g.rig.reset(yaw, pitch);
    g.rig.update(1 / 60, g.player, false);
    g.camera.updateMatrixWorld(true);
  },

  aimAt(x, y, z) {
    const g = window.__SANDS__;
    const c = g.player.position;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const flat = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, flat);
    g.rig.reset(yaw, pitch);
    g.rig.update(1 / 60, g.player, false);
    g.camera.updateMatrixWorld(true);
    return { yaw, pitch };
  },

  /**
   * A column to bounce off and to hide behind, WITH A CLEAR RUN AT IT.
   *
   * Three constraints and every one of them was learned by getting a wrong
   * answer without it:
   *
   *   NOT TOO BIG. The courtyard's largest cylinder is the pyramid itself -
   *   radius 32, height 44, sixty metres off the map - and "the tallest,
   *   fattest collider" picks it every time. The second largest is the 3.2 m
   *   doorway pylon, which is wide enough that a body on each side of it is
   *   8.6 m apart, which is outside the blast radius, which made the cover
   *   experiment measure nothing at all and report a pass. Two metres is the
   *   ceiling because 2r + 1.8 has to stay inside OUTER.
   *
   *   TALL ENOUGH to shadow a blast at chest height rather than being stepped
   *   over.
   *
   *   A CLEAR APPROACH. The avenue is dressed with crates, braziers and rubble.
   *   A shell that bounces off a plank two metres short of the column passes
   *   every assertion in the bounce test for entirely the wrong reason.
   */
  findWall(x, z, radius, approach = 6) {
    const g = window.__SANDS__;
    const cols = g.world.colliders;
    const b = g.world.bounds;
    let best = null;

    for (const c of cols) {
      if (c.h < 2.4 || c.r < 0.55 || c.r > 2.0) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d > radius) continue;
      if (best && c.r * c.h <= best.r * best.h) continue;

      const ang = Math.atan2(c.z - z, c.x - x) || 0;
      const cx = Math.cos(ang), cz = Math.sin(ang);
      const ox = c.x - cx * (c.r + approach);
      const oz = c.z - cz * (c.r + approach);

      if (ox < (b.minX ?? b.min) + 1 || ox > (b.maxX ?? b.max) - 1) continue;
      if (oz < (b.minZ ?? b.min) + 1 || oz > (b.maxZ ?? b.max) - 1) continue;

      // Sample the run in, stopping just short of the target's own face, and
      // reject anything else standing in it.
      let clear = true;
      for (let t = 0; t <= 1 && clear; t += 1 / 24) {
        const sx = ox + cx * approach * t;
        const sz = oz + cz * approach * t;
        for (const o of cols) {
          if (o === c || o.h < 0.9) continue;
          const ex = sx - o.x, ez = sz - o.z;
          const want = o.r + 0.35;
          if (ex * ex + ez * ez < want * want) { clear = false; break; }
        }
      }
      if (!clear) continue;

      best = { x: c.x, z: c.z, r: c.r, h: c.h, d, ang, ox, oz };
    }

    return best;
  },

  /**
   * The MOST open patch of ground, not the first adequate one.
   *
   * Measured, this courtyard's best is 8.26 m of clearance at (3.8, 12), and it
   * is 300 colliders dense everywhere else. A first-match search returns a
   * different point whenever the threshold moves, which makes every distance in
   * every test downstream depend on a constant nobody thinks about. The maximum
   * is one number and it does not move.
   */
  findOpen(want = 7) {
    const g = window.__SANDS__;
    const b = g.world.bounds;
    const minX = (b.minX ?? b.min) + 2, maxX = (b.maxX ?? b.max) - 2;
    const minZ = (b.minZ ?? b.min) + 2, maxZ = (b.maxZ ?? b.max) - 2;

    let best = null;
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        let m = Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
        for (const c of g.world.colliders) {
          if (c.h < 0.5) continue;
          const d = Math.hypot(x - c.x, z - c.z) - c.r;
          if (d < m) m = d;
        }
        if (!best || m > best.clear) best = { clear: +m.toFixed(2), x, z };
      }
    }
    if (!best || best.clear < want) return null;
    best.y = g.world.heightAt(best.x, best.z, 0);
    return best;
  },

  /**
   * Is the straight line between two ground points free of standing stone?
   *
   * Written here rather than borrowed from the module, deliberately. The cover
   * test uses this to CHOOSE where the control body goes, and if it used the
   * module's own occlusion query then a query that always answered "clear"
   * would place the control behind a pillar and the experiment would quietly
   * invert. Two independent implementations, one conclusion.
   */
  lineClear(ax, az, bx, bz, pad = 0.5) {
    const g = window.__SANDS__;
    const dx = bx - ax, dz = bz - az;
    const d = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.ceil(d / 0.4));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const sx = ax + dx * t, sz = az + dz * t;
      for (const c of g.world.colliders) {
        if (c.h < 0.9) continue;
        const ex = sx - c.x, ez = sz - c.z;
        const want = c.r + pad;
        if (ex * ex + ez * ez < want * want) return false;
      }
    }
    return true;
  },

  /**
   * Empty the map and keep it empty.
   *
   * Through forceWave, which calls the director's own clearLive() and therefore
   * retires actors properly - back to the pool, off the root, emitters freed.
   * Marking them dead and stepping the director does the same thing ONLY while
   * the director is running, and this harness needs it stopped so its targets
   * stand still.
   */
  clearEnemies() {
    const g = window.__SANDS__;
    g.director.state.running = true;
    g.director.forceWave(1);
    g.director.state.running = false;
    g.director.state.timer = 9999;
    g.director.state.phase = 'breather';
  },
};
`,
});

// ---------------------------------------------------------------------------
// screenshots
// ---------------------------------------------------------------------------

const shots = [];

/**
 * Decode the captured frame in node and read the upper two thirds.
 *
 * Three numbers, not one. `meanLuma` says the frame is lit. `clipPct` says the
 * brightness is not being bought by blowing the highlights - the failure mode
 * that made a clipped-to-white mystery box score BETTER on findability than the
 * fixed one. `spread` is the standard deviation, which collapses toward zero
 * both when a frame goes black and when it goes white, so it is the one number
 * that cannot be gamed in either direction.
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
  let sum = 0, sumSq = 0, lit = 0, clipped = 0;

  for (let i = 0; i < data.length; i += 3) {
    const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
    sum += l;
    sumSq += l * l;
    if (l > 10) lit++;
    if (data[i] >= 250 && data[i + 1] >= 250 && data[i + 2] >= 250) clipped++;
  }

  const mean = sum / n;
  return {
    meanLuma: +mean.toFixed(2),
    percentLit: +((lit / n) * 100).toFixed(1),
    clipPct: +((clipped / n) * 100).toFixed(2),
    spread: +Math.sqrt(Math.max(0, sumSq / n - mean * mean)).toFixed(2),
  };
}

async function shoot(name, label, waitFrames = 3) {
  if (waitFrames) await page.evaluate((n) => window.__H__.frames(n), waitFrames);
  const png = await page.screenshot({ path: `${OUT}${name}.png` });
  const stats = await measure(png);
  shots.push({ name, label, ...stats });
  return stats;
}

// ---------------------------------------------------------------------------
// 1. the arc is a real parabola
// ---------------------------------------------------------------------------

/**
 * Sampled high above the ground so the window contains no bounce at all.
 *
 * A parabola has TWO signatures and both are asserted, because either one alone
 * has a false positive: constant horizontal velocity (rules out drag and any
 * steering) and a constant second difference in y equal to -g*h^2 (rules out a
 * linear fall, a lerp, and a wrong gravity). The residual against a least
 * squares quadratic is the third, and it is the one that would catch a curve
 * that satisfies both averages while wobbling.
 */
const arc = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.reset();
  window.__H__.clearEnemies();

  // Fifteen metres up and slow across the ground, so the sampled second
  // contains no bounce and never leaves the open patch. A fast flat throw would
  // clip a colonnade column at ten metres and the "arc" would then be measuring
  // a collision.
  const open = window.__H__.findOpen(7);
  const s = window.__G__.placeAt(open.x, open.y + 15, open.z, 3.0, 5.0, 0, 99);

  const h = 1 / 120;
  const ys = [], xs = [], zs = [];
  for (let i = 0; i < 120; i++) {
    window.__G__.update(h, null);
    xs.push(s.p.x); ys.push(s.p.y); zs.push(s.p.z);
  }

  // horizontal speed, frame to frame
  const vx = [];
  for (let i = 1; i < xs.length; i++) {
    vx.push(Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]) / h);
  }
  const vxMean = vx.reduce((a, b) => a + b, 0) / vx.length;
  const vxSpread = Math.max(...vx) - Math.min(...vx);

  // second difference in y, which for a parabola is exactly -g*h^2
  const d2 = [];
  for (let i = 2; i < ys.length; i++) d2.push(ys[i] - 2 * ys[i - 1] + ys[i - 2]);
  const d2Mean = d2.reduce((a, b) => a + b, 0) / d2.length;
  const gFit = -d2Mean / (h * h);

  // least squares quadratic in t, and the worst residual
  const n = ys.length;
  let S0 = n, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i * h, y = ys[i];
    S1 += t; S2 += t * t; S3 += t * t * t; S4 += t * t * t * t;
    T0 += y; T1 += t * y; T2 += t * t * y;
  }
  const det = S0 * (S2 * S4 - S3 * S3) - S1 * (S1 * S4 - S3 * S2) + S2 * (S1 * S3 - S2 * S2);
  const a0 = (T0 * (S2 * S4 - S3 * S3) - S1 * (T1 * S4 - S3 * T2) + S2 * (T1 * S3 - S2 * T2)) / det;
  const a1 = (S0 * (T1 * S4 - S3 * T2) - T0 * (S1 * S4 - S3 * S2) + S2 * (S1 * T2 - T1 * S2)) / det;
  const a2 = (S0 * (S2 * T2 - T1 * S3) - S1 * (S1 * T2 - T1 * S2) + T0 * (S1 * S3 - S2 * S2)) / det;

  let worst = 0;
  for (let i = 0; i < n; i++) {
    const t = i * h;
    worst = Math.max(worst, Math.abs(ys[i] - (a0 + a1 * t + a2 * t * t)));
  }

  window.__G__.clearLive();
  window.__H__.hold(false);

  return {
    samples: n,
    vxMean: +vxMean.toFixed(4),
    vxSpread: +vxSpread.toFixed(5),
    gFit: +gFit.toFixed(3),
    quadCoef: +(-2 * a2).toFixed(3),
    worstResidual: +worst.toFixed(6),
    rose: Math.max(...ys) > ys[0],
    fell: ys[ys.length - 1] < Math.max(...ys),
  };
});

// ---------------------------------------------------------------------------
// 2. it bounces off a wall rather than passing through it
// ---------------------------------------------------------------------------

const bounce = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.clearLive();

  const wall = window.__H__.findWall(0, 0, 45);
  if (!wall) return { found: false };

  // Fired at the collider's axis from six metres out, at a height inside its
  // body, so a pass-through is unambiguous. The origin comes from findWall,
  // which has already proved the run in is clear of everything else.
  const ang = wall.ang;
  const ox = wall.ox, oz = wall.oz;
  const floor = g.world.heightAt(ox, oz, 0);

  const s = window.__G__.placeAt(ox, floor + 1.1, oz,
    Math.cos(ang) * 15, 0.4, Math.sin(ang) * 15, 99);

  const h = 1 / 120;
  let closest = Infinity;
  let inside = 0;
  let reversedAt = -1;

  for (let i = 0; i < 240; i++) {
    window.__G__.update(h, null);
    const d = Math.hypot(s.p.x - wall.x, s.p.z - wall.z);
    closest = Math.min(closest, d);
    if (d < wall.r - 0.02) inside++;
    const away = (s.v.x * Math.cos(ang) + s.v.z * Math.sin(ang));
    if (reversedAt < 0 && away < -0.5) reversedAt = i;
  }

  const endD = Math.hypot(s.p.x - wall.x, s.p.z - wall.z);
  const crossed =
    ((s.p.x - wall.x) * Math.cos(ang) + (s.p.z - wall.z) * Math.sin(ang)) > 0;

  window.__G__.clearLive();
  window.__H__.hold(false);

  return {
    found: true,
    wallR: +wall.r.toFixed(2), wallH: +wall.h.toFixed(2),
    startD: +(wall.r + 6).toFixed(2),
    closest: +closest.toFixed(3),
    framesInside: inside,
    reversedAt,
    endD: +endD.toFixed(2),
    crossedToFarSide: crossed,
  };
});

// ---------------------------------------------------------------------------
// 3. it comes to rest
// ---------------------------------------------------------------------------

const rest = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.clearLive();

  const open = window.__H__.findOpen(7);
  const s = window.__G__.placeAt(open.x, open.y + 1.6, open.z, 11, 3.2, 2.0, 999);

  const h = 1 / 120;
  let sleptAt = -1;
  let peakSpeed = 0;
  for (let i = 0; i < 1200; i++) {
    window.__G__.update(h, null);
    peakSpeed = Math.max(peakSpeed, s.v.length());
    if (s.asleep && sleptAt < 0) sleptAt = i * h;
  }

  const floor = g.world.heightAt(s.p.x, s.p.z, s.p.y);
  const out = {
    asleep: s.asleep,
    sleptAfter: +sleptAt.toFixed(2),
    speed: +s.v.length().toFixed(5),
    aboveFloor: +(s.p.y - floor).toFixed(3),
    peakSpeed: +peakSpeed.toFixed(2),
    bounces: s.bounces,
  };

  window.__G__.clearLive();
  window.__H__.hold(false);
  return out;
});

// ---------------------------------------------------------------------------
// 4. the fuse fires on time, and 5. cooking shortens it
// ---------------------------------------------------------------------------

const fuse = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.reset();
  window.__H__.clearEnemies();
  g.combat.state.invulnerable = true;      // this block is about the clock only

  const open = window.__H__.findOpen(7);
  const h = 1 / 120;

  // --- a plain fuse --------------------------------------------------------
  const want = 2.0;
  window.__G__.placeAt(open.x, open.y + 0.4, open.z, 0, 0, 0, want);
  const before = window.__G__.state.detonated;
  let firedAt = -1;
  for (let i = 0; i < 600 && firedAt < 0; i++) {
    window.__G__.update(h, null);
    if (window.__G__.state.detonated > before) firedAt = (i + 1) * h;
  }

  // --- a cooked one --------------------------------------------------------
  // Cook for two seconds of SIMULATED time, then release and read the fuse
  // written onto the shell. The reported remainder is the whole mechanic.
  window.__G__.reset();
  window.__G__.beginCook();
  const cook = 2.0;
  for (let i = 0; i < Math.round(cook / h); i++) window.__G__.update(h, { grenade: true });
  const cookedAt = window.__G__.state.cookT;
  const s = window.__G__.release();
  const remaining = s ? s.fuse : -1;

  const before2 = window.__G__.state.detonated;
  let cookedFiredAt = -1;
  for (let i = 0; i < 600 && cookedFiredAt < 0; i++) {
    window.__G__.update(h, null);
    if (window.__G__.state.detonated > before2) cookedFiredAt = (i + 1) * h;
  }

  window.__G__.clearLive();
  window.__H__.hold(false);

  return {
    want,
    firedAt: +firedAt.toFixed(4),
    cookedFor: +cookedAt.toFixed(3),
    remaining: +remaining.toFixed(3),
    cookedFiredAt: +cookedFiredAt.toFixed(4),
    fuseConstant: window.__K__.FUSE,
  };
});

// ---------------------------------------------------------------------------
// 6. an overcooked grenade kills the player
// ---------------------------------------------------------------------------

const overcook = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.reset();
  window.__H__.clearEnemies();

  // The one block in this file that lets the player be hurt. The rest of the
  // harness is invulnerable because it is not here to survive.
  g.combat.state.invulnerable = false;
  g.player.heal(g.player.state.maxHealth);

  const open = window.__H__.findOpen(7);
  window.__H__.place(open.x, open.z, 0);

  const healthBefore = g.player.state.health;
  const downsBefore = g.combat.state.downs;
  const countBefore = window.__G__.count;

  window.__G__.beginCook();

  const h = 1 / 120;
  let healthAfterRevive = -1;
  let firedAt = -1;
  for (let i = 0; i < Math.round(5.0 / h); i++) {
    window.__G__.update(h, { grenade: true });     // never let go
    if (firedAt < 0 && window.__G__.state.cookedOff > 0) {
      firedAt = (i + 1) * h;
      healthAfterRevive = g.player.state.health;
    }
  }

  const out = {
    healthBefore,
    cookedOff: window.__G__.state.cookedOff,
    firedAt: +firedAt.toFixed(3),
    // 100, AND THAT IS THE KILL. systems/damage.js stands the player back up at
    // full health inside fell(), so health sampled after the blast is always
    // maxHealth and proves nothing either way. The monotonic `downs` counter is
    // the honest event source - it is what main.js watches to strip the boons -
    // and `selfDamage` below is what was actually dealt.
    healthAfterRevive: +healthAfterRevive.toFixed(1),
    downsDelta: g.combat.state.downs - downsBefore,
    selfDamage: +window.__G__.state.selfDamage.toFixed(1),
    consumed: countBefore - window.__G__.count,
    stillCooking: window.__G__.state.cooking,
  };

  // A survivable one, from six metres, to prove the same curve does not kill
  // at range. Placed rather than thrown so the distance is exact.
  g.player.heal(g.player.state.maxHealth);
  const survivorBefore = g.player.state.health;
  const p = g.player.position;
  window.__G__.detonate(p.x + 6.2, p.y - 0.85, p.z, false);
  out.atSixMetres = +(survivorBefore - g.player.state.health).toFixed(1);
  out.survivedSix = g.player.state.health > 0;

  g.player.heal(g.player.state.maxHealth);
  g.combat.state.invulnerable = true;
  window.__G__.reset();
  window.__H__.hold(false);
  return out;
});

// ---------------------------------------------------------------------------
// 7. damage falls off with distance
// ---------------------------------------------------------------------------

/**
 * Measured on REAL ENEMIES, not on the curve.
 *
 * damageAt() is exposed and it would be much easier to assert against, and it
 * would prove nothing: the question is whether the blast finds the bodies and
 * charges them the right amount, which involves the chest offset, the enemy
 * list, and the damage system. Three shamblers, three distances, one blast, one
 * health reading each side.
 */
const falloff = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.reset();
  window.__H__.clearEnemies();
  g.combat.state.invulnerable = true;

  const open = window.__H__.findOpen(7);
  const at = [1.2, 3.6, 6.2, 9.0];
  const placed = [];

  for (const d of at) {
    const a = g.director.placeAt('shambler', open.x + d, open.z);
    if (a) placed.push({ d, a, before: a.health });
  }

  // One frame so the actors settle onto the floor before the blast measures to
  // their chests.
  g.director.update(1 / 60, 0);

  window.__G__.detonate(open.x, open.y + 0.1, open.z, false);

  const rows = placed.map((p) => ({
    d: p.d,
    took: +(p.before - p.a.health).toFixed(1),
    dead: p.a.dying || p.a.dead || p.a.health <= 0,
    curve: +window.__G__.damageAt(p.d).toFixed(1),
  }));

  window.__H__.clearEnemies();
  window.__H__.hold(false);

  return {
    rows,
    inner: window.__K__.INNER,
    outer: window.__K__.OUTER,
    max: window.__K__.BLAST_MAX,
    beyondRim: +window.__G__.damageAt(window.__K__.OUTER + 0.01).toFixed(2),
    atRim: +window.__G__.damageAt(window.__K__.OUTER - 0.01).toFixed(2),
    atCentre: +window.__G__.damageAt(0).toFixed(1),
  };
});

// ---------------------------------------------------------------------------
// 7b. IT KILLS. Real bodies, at the health the director actually hands out.
// ---------------------------------------------------------------------------

/**
 * The check the owner's report is actually about, and the one that was missing.
 *
 * Everything above measures the blast against itself - the curve is monotone,
 * the rim is a scratch, the centre equals the constant - and every one of those
 * passed while a grenade at a wave-eight shambler's feet did four fifths of its
 * job and left it walking. A damage number is not a claim. "This kills that" is
 * a claim, and it needs the enemy's OWN health at the wave in question on one
 * side of it.
 *
 * Health comes from the director rather than from arithmetic here: `place()`
 * scales by `hpScale(max(1, state.wave))`, so moving the director's counter and
 * placing a body is the same code path a real wave uses, and `maxHealth` is
 * read back off the actor rather than recomputed. If the scaling curve ever
 * moves, this fails instead of quietly agreeing with a stale copy of it.
 */
const lethality = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.reset();
  window.__H__.clearEnemies();
  g.combat.state.invulnerable = true;

  const open = window.__H__.findOpen(7);

  /**
   * One body, at its feet, at a given wave. 0.6 m out and the blast on the
   * deck, which is a grenade that landed - not one detonated inside the model.
   */
  function atFeet(id, wave) {
    window.__H__.clearEnemies();
    g.director.state.wave = wave;

    const a = g.director.placeAt(id, open.x + 0.6, open.z);
    if (!a) return null;

    const max = a.maxHealth;
    const before = a.health;
    window.__G__.detonate(open.x, open.y + 0.05, open.z, false);

    return {
      wave,
      maxHealth: Math.round(max),
      took: +(before - a.health).toFixed(1),
      leftPct: +((100 * a.health) / max).toFixed(1),
      dead: !!(a.dying || a.dead || a.health <= 0),
    };
  }

  const shambler = [1, 5, 10, 12, 13, 14, 20].map((w) => atFeet('shambler', w));
  const bound = [10, 15].map((w) => atFeet('bound', w));
  const husk = [10].map((w) => atFeet('husk', w));

  // A body at the rim of the same blast, at wave one, which is the cheapest
  // health in the game. If THAT survives, distance still means something.
  window.__H__.clearEnemies();
  g.director.state.wave = 1;
  const far = g.director.placeAt('shambler', open.x + 6.3, open.z);
  const farBefore = far ? far.health : 0;
  window.__G__.detonate(open.x, open.y + 0.05, open.z, false);
  const distant = far ? {
    d: 6.3,
    maxHealth: Math.round(far.maxHealth),
    took: +(farBefore - far.health).toFixed(1),
    dead: !!(far.dying || far.dead || far.health <= 0),
  } : null;

  window.__H__.clearEnemies();
  g.director.state.wave = 0;
  window.__H__.hold(false);

  return { shambler, bound, husk, distant, blastMax: window.__K__.BLAST_MAX };
});

// ---------------------------------------------------------------------------
// 8. geometry blocks it
// ---------------------------------------------------------------------------

/**
 * A shielded enemy and a control at the SAME distance in the open.
 *
 * One reading proves nothing here: a blast that hurt nobody would pass a test
 * that only asserts the shielded one took zero. The control is the whole
 * experiment, and it is placed at the same range so the only variable is the
 * stone.
 */
const cover = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.reset();
  window.__H__.clearEnemies();
  g.combat.state.invulnerable = true;

  const wall = window.__H__.findWall(0, 0, 45);
  if (!wall) return { found: false };

  // Along the axis through the collider, one on each side of it. The blast sits
  // just outside the near face, the shielded body just outside the far face,
  // and the 0.9 m stand-off is what keeps 2r + 1.8 comfortably inside the seven
  // metre blast radius - a separation wider than OUTER would make the stone
  // irrelevant and the experiment vacuous.
  const ang = wall.ang;
  const cx = Math.cos(ang), cz = Math.sin(ang);

  const bx = wall.x - cx * (wall.r + 0.9);
  const bz = wall.z - cz * (wall.r + 0.9);
  const sx = wall.x + cx * (wall.r + 0.9);
  const sz = wall.z + cz * (wall.r + 0.9);

  const range = Math.hypot(sx - bx, sz - bz);

  const shielded = g.director.placeAt('shambler', sx, sz);

  // THE CONTROL IS THE EXPERIMENT. Same range from the same blast, different
  // bearing, chosen by sweeping every direction and taking the first one whose
  // line is genuinely free of standing stone - measured by the harness's own
  // sampler, not by the module's. A control that happened to land behind a
  // second column would report "geometry blocks it" for a blast that was
  // simply broken.
  let ox = 0, oz = 0, bearing = -1;
  for (let k = 1; k < 32; k++) {
    const a = ang + (k / 32) * Math.PI * 2;
    const tx = bx + Math.cos(a) * range;
    const tz = bz + Math.sin(a) * range;
    const b = g.world.bounds;
    if (tx < (b.minX ?? b.min) + 1 || tx > (b.maxX ?? b.max) - 1) continue;
    if (tz < (b.minZ ?? b.min) + 1 || tz > (b.maxZ ?? b.max) - 1) continue;
    if (!window.__H__.lineClear(bx, bz, tx, tz, 0.45)) continue;
    ox = tx; oz = tz; bearing = +(k / 32).toFixed(3);
    break;
  }

  const control = bearing >= 0 ? g.director.placeAt('shambler', ox, oz) : null;

  const out = {
    found: true,
    range: +range.toFixed(2),
    wallR: +wall.r.toFixed(2),
    wallH: +wall.h.toFixed(2),
    wallAt: { x: +wall.x.toFixed(1), z: +wall.z.toFixed(1) },
    blastAt: { x: +bx.toFixed(1), z: +bz.toFixed(1) },
    controlBearing: bearing,
    shieldedPlaced: !!shielded,
    controlPlaced: !!control,
    // The harness's own answer for the shielded line, so a disagreement between
    // the two implementations shows up as data rather than as a silent pass.
    harnessSaysShieldedBlocked: !window.__H__.lineClear(bx, bz, sx, sz, 0.45),
    // Where the bodies ACTUALLY ended up: placeAt puts them down but the
    // director's own push-out can move them, and a control that slid behind a
    // pillar would silently invert the experiment.
    shieldedRange: shielded
      ? +Math.hypot(shielded.position.x - bx, shielded.position.z - bz).toFixed(2) : -1,
    controlRange: control
      ? +Math.hypot(control.position.x - bx, control.position.z - bz).toFixed(2) : -1,
  };

  const sBefore = shielded ? shielded.health : 0;
  const cBefore = control ? control.health : 0;

  const by = g.world.heightAt(bx, bz, 0) + 0.1;
  window.__G__.detonate(bx, by, bz, false);

  out.shieldedTook = shielded ? +(sBefore - shielded.health).toFixed(1) : -1;
  out.controlTook = control ? +(cBefore - control.health).toFixed(1) : -1;

  window.__H__.clearEnemies();
  window.__H__.hold(false);
  return out;
});

// ---------------------------------------------------------------------------
// 9. a grenade kill pays gold
// ---------------------------------------------------------------------------

const gold = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.reset();
  window.__H__.clearEnemies();
  g.combat.state.invulnerable = true;

  const open = window.__H__.findOpen(7);

  // --- a kill --------------------------------------------------------------
  const victim = g.director.placeAt('shambler', open.x + 1.0, open.z);
  g.director.update(1 / 60, 0);

  const goldBefore = g.economy.gold;
  const killsBefore = window.__G__.state.kills;
  window.__G__.detonate(open.x, open.y + 0.1, open.z, false);

  const killPay = g.economy.gold - goldBefore;
  const killed = !!victim && (victim.dying || victim.dead || victim.health <= 0);
  // Sampled HERE, not at the end of the block. The group section below adds
  // five more to the same lifetime counter, and reading it once at the return
  // reported six for a check whose whole subject is "one".
  const kills = window.__G__.state.kills - killsBefore;

  window.__H__.clearEnemies();

  // --- a hit that does not finish ------------------------------------------
  // The Bound has 560 health, so a rim hit cannot kill it, which is the only
  // way to separate the 10 from the 60 on one record.
  const tough = g.director.placeAt('bound', open.x + 6.4, open.z);
  g.director.update(1 / 60, 0);

  const goldBefore2 = g.economy.gold;
  window.__G__.detonate(open.x, open.y + 0.1, open.z, false);
  const hitPay = g.economy.gold - goldBefore2;
  const survived = !!tough && !tough.dying && tough.health > 0;

  window.__H__.clearEnemies();

  // --- nothing in range pays nothing ---------------------------------------
  const goldBefore3 = g.economy.gold;
  window.__G__.detonate(open.x, open.y + 0.1, open.z, false);
  const emptyPay = g.economy.gold - goldBefore3;

  // --- ONCE EACH, NOT ONCE PER PASS ----------------------------------------
  //
  // One kill proves the record reaches the payout table; it does NOT prove the
  // payout runs once. `applyBlast` writes `killed` and `payHits` reads it, and
  // both walk the same pooled array - a blast that paid per record AND per
  // listener, or that failed to null a record between detonations, would show
  // up here and nowhere above. Five bodies in the core of one blast: five
  // kills, five bounties, no sixth.
  window.__H__.clearEnemies();
  g.director.state.wave = 1;

  const group = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const e = g.director.placeAt('shambler',
      open.x + Math.cos(a) * 1.4, open.z + Math.sin(a) * 1.4);
    if (e) group.push(e);
  }

  const goldBefore4 = g.economy.gold;
  const killsBefore4 = window.__G__.state.kills;
  window.__G__.detonate(open.x, open.y + 0.1, open.z, false);
  const groupPay = g.economy.gold - goldBefore4;
  const groupDead = group.filter((e) => e.dying || e.dead || e.health <= 0).length;
  const groupKills = window.__G__.state.kills - killsBefore4;

  // And the SAME pooled records again, on an empty field. A record still
  // holding a corpse would pay a second time for a body that is already gone.
  window.__H__.clearEnemies();
  const goldBefore5 = g.economy.gold;
  window.__G__.detonate(open.x, open.y + 0.1, open.z, false);
  const replayPay = g.economy.gold - goldBefore5;

  g.director.state.wave = 0;
  window.__H__.hold(false);
  return {
    killed, killPay, hitPay, survived, emptyPay, kills,
    bounty: g.economy.BOUNTY,
    groupPlaced: group.length, groupDead, groupKills, groupPay, replayPay,
  };
});

// ---------------------------------------------------------------------------
// 10. a hundred throws leak nothing
// ---------------------------------------------------------------------------

const leak = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.reset();
  window.__H__.clearEnemies();
  g.combat.state.invulnerable = true;

  const before = {
    geometries: g.renderer.info.memory.geometries,
    textures: g.renderer.info.memory.textures,
    sceneChildren: g.scene.children.length,
    programs: g.renderer.info.programs ? g.renderer.info.programs.length : 0,
  };

  const open = window.__H__.findOpen(7);
  const h = 1 / 60;
  let thrown = 0;

  for (let i = 0; i < 100; i++) {
    // Fanned out, so the throws land on genuinely different ground and take
    // genuinely different bounces rather than replaying one trajectory.
    const a = (i / 100) * Math.PI * 2;
    window.__G__.placeAt(
      open.x, open.y + 1.5, open.z,
      Math.cos(a) * 13, 3.4, Math.sin(a) * 13, 0.9 + (i % 7) * 0.12);
    thrown++;
    for (let k = 0; k < 90; k++) window.__G__.update(h, null);
  }

  // Let every fixture expire.
  for (let k = 0; k < 120; k++) window.__G__.update(h, null);

  const after = {
    geometries: g.renderer.info.memory.geometries,
    textures: g.renderer.info.memory.textures,
    sceneChildren: g.scene.children.length,
    programs: g.renderer.info.programs ? g.renderer.info.programs.length : 0,
  };

  const st = window.__G__.stats();
  window.__H__.hold(false);

  return {
    thrown,
    detonated: st.detonated,
    liveAfter: st.live,
    poolDepth: st.pool,
    fxPool: st.fxPool,
    mounted: st.mounted,
    geometriesDelta: after.geometries - before.geometries,
    texturesDelta: after.textures - before.textures,
    sceneChildrenDelta: after.sceneChildren - before.sceneChildren,
    audioVoices: g.audio.stats().voices,
    audioCap: g.audio.stats().cap,
  };
});

// ---------------------------------------------------------------------------
// 11. the supply
// ---------------------------------------------------------------------------

/**
 * FOUR AT THE TOP OF EVERY ROUND, and the refill is driven through the
 * DIRECTOR'S REAL WAVE START rather than by poking its counter.
 *
 * The previous version of this section set `director.state.wave = 2` by hand
 * and asserted a dividend, which tested a poll that no longer exists and would
 * have passed against a module that refilled on any write to that field. The
 * hook now lives inside `beginWave()`, so the only honest way to fire it is to
 * let the director run a breather out and begin a wave - which also proves the
 * thing the poll could never prove: that the count and the wave number the HUD
 * paints move on the SAME statement.
 */
const supply = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.reset();
  window.__H__.clearEnemies();
  g.combat.state.invulnerable = true;

  const start = window.__G__.count;

  // --- spending ------------------------------------------------------------
  const spend = [];
  for (let i = 0; i < start; i++) {
    window.__G__.throwNow(99);
    spend.push(window.__G__.count);
  }
  const emptied = window.__G__.count;
  const refusedWhenEmpty = window.__G__.throwNow(99) === null;
  const cookRefused = window.__G__.beginCook() === false;
  window.__G__.clearLive();

  // --- the hook exists at all ----------------------------------------------
  const hasHook = typeof g.director.onWaveStart === 'function';

  /** Run the director far enough to begin one wave, and report both numbers. */
  function beginWave(n) {
    g.director.state.running = true;
    g.director.forceWave(n);
    const waveBefore = g.director.state.wave;
    g.director.update(1 / 60, 0);
    const out = {
      waveBefore,
      wave: g.director.state.wave,
      count: window.__G__.count,
    };
    g.director.state.running = false;
    g.director.state.phase = 'breather';
    g.director.state.timer = 9999;
    return out;
  }

  // From empty, a round start hands back a full pouch.
  const fromEmpty = beginWave(7);

  // From PARTIAL, it tops up rather than adding - throw one, start a round,
  // and the pouch is four again, not five and not three.
  window.__G__.throwNow(99);
  const partial = window.__G__.count;
  window.__G__.clearLive();
  const fromPartial = beginWave(8);

  // From FULL, a second round start changes nothing. A refill written as an
  // add with a clamp and a refill written as a set look identical here only
  // because the clamp is right; the check is cheap and the cap is the promise.
  const fromFull = beginWave(9);

  // --- the cap holds against everything else that grants -------------------
  window.__G__.give(9);
  const afterGive = window.__G__.count;
  window.__G__.refill();
  const afterRefill = window.__G__.count;

  // --- the purchase --------------------------------------------------------
  window.__G__.throwNow(99);
  const beforeBuy = window.__G__.count;
  const goldBefore = g.economy.gold;
  const bought = window.__G__.buy();
  const spent = goldBefore - g.economy.gold;
  const afterBuy = window.__G__.count;

  // Refused at the cap, so the buy can never be the route past four either.
  const refusedAtCap = window.__G__.buy() === false;

  window.__G__.clearLive();
  window.__G__.reset();
  window.__H__.clearEnemies();
  window.__H__.hold(false);

  return {
    start, spend, emptied, refusedWhenEmpty, cookRefused,
    hasHook, fromEmpty, partial, fromPartial, fromFull,
    afterGive, afterRefill,
    beforeBuy, bought, spent, afterBuy, refusedAtCap,
    price: window.__K__.GRENADE_PRICE,
    max: window.__K__.MAX_COUNT,
    refillTo: window.__K__.WAVE_REFILL,
  };
});

// ---------------------------------------------------------------------------
// 12. the other side of the doorway
// ---------------------------------------------------------------------------

/**
 * The interior hands over AXIS-ALIGNED BOXES as well as cylinders, because a
 * cylinder cannot approximate a wall with a doorway in it without either
 * leaking at the corners or eating the opening. That is a second branch in the
 * bounce path and it has no coverage at all from the courtyard, where
 * `world.walls` is null.
 *
 * And the transition itself is a claim: a shell left in the courtyard when the
 * player walks into the pyramid is 110 units from anything, and it would go off
 * in an empty desert three seconds later. The director retires its actors
 * across that line for the same reason.
 */
const inside = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.reset();
  window.__H__.clearEnemies();
  g.combat.state.invulnerable = true;

  // A shell in flight in the courtyard, and then the player leaves.
  window.__G__.placeAt(g.player.position.x, g.player.position.y, g.player.position.z,
    4, 3, 0, 99);
  const liveBefore = window.__G__.live;

  const room = g.spaces.interior.rooms.find((r) => (r.spawnPoints || []).length)
    || g.spaces.interior.rooms[0];
  const at = (room.spawnPoints && room.spawnPoints[0]) || { x: room.x || 0, z: room.z || 0 };

  g.spaces.enter('interior', { x: at.x, z: at.z, rot: 0 });
  window.__G__.update(1 / 60, null);          // the frame that notices the swap

  const out = {
    space: g.spaces.active,
    liveBefore,
    liveAfterTransition: window.__G__.live,
    walls: g.world.walls ? g.world.walls.length : 0,
    room: room.id,
  };

  // The nearest wall box tall enough to stop a shell at chest height, and thin
  // enough that a pass-through would be unmistakable.
  let wall = null, best = Infinity;
  const py = g.player.position.y;
  for (const w of g.world.walls || []) {
    if (w.y1 < py - 0.6 || w.y0 > py - 0.4) continue;
    const d = Math.hypot(w.x - at.x, w.z - at.z);
    if (d < 2 || d > 14) continue;
    if (d < best) { best = d; wall = w; }
  }

  if (!wall) { window.__H__.hold(false); return { ...out, found: false }; }

  // Fire along the wall's THIN axis, from three metres out on the room side.
  const thinX = wall.w < wall.d;
  const half = (thinX ? wall.w : wall.d) / 2;
  const sign = (thinX ? at.x - wall.x : at.z - wall.z) < 0 ? -1 : 1;

  const ox = thinX ? wall.x + sign * (half + 3) : wall.x;
  const oz = thinX ? wall.z : wall.z + sign * (half + 3);
  const oy = Math.max(wall.y0 + 0.25, Math.min(wall.y1 - 0.25, py - 0.5));

  const s = window.__G__.placeAt(ox, oy, oz,
    thinX ? -sign * 13 : 0, 0.3, thinX ? 0 : -sign * 13, 99);

  let crossed = 0;
  let reversed = -1;
  for (let i = 0; i < 400; i++) {
    window.__G__.update(1 / 240, null);
    const off = thinX ? (s.p.x - wall.x) * sign : (s.p.z - wall.z) * sign;
    if (off < 0) crossed++;
    const vel = thinX ? s.v.x * sign : s.v.z * sign;
    if (reversed < 0 && vel > 0.5) reversed = i;
  }

  const endOff = thinX ? (s.p.x - wall.x) * sign : (s.p.z - wall.z) * sign;

  window.__G__.clearLive();
  g.spaces.enter('exterior', { x: 0, z: 30, rot: 0 });
  window.__G__.update(1 / 60, null);
  window.__H__.hold(false);

  return {
    ...out,
    found: true,
    wall: { w: +wall.w.toFixed(2), d: +wall.d.toFixed(2),
            y0: +wall.y0.toFixed(2), y1: +wall.y1.toFixed(2) },
    thinAxis: thinX ? 'x' : 'z',
    half: +half.toFixed(2),
    framesPastTheMidPlane: crossed,
    reversedAt: reversed,
    endOffset: +endOff.toFixed(3),
    backOutside: g.spaces.active,
  };
});

// ---------------------------------------------------------------------------
// 13. LOOK AT IT
// ---------------------------------------------------------------------------

/**
 * Four frames, driven through the real render path with the rAF driver live.
 *
 * The plate is taken first, from the same camera, so the explosion frame has
 * something to be brighter THAN. Comparing an explosion against an absolute
 * luminance number is how you end up calibrating a gate to a fixture that is
 * clipping to white.
 */
const framing = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.clearEnemies();
  window.__G__.reset();
  g.combat.state.invulnerable = true;

  const open = window.__H__.findOpen(7);
  // Stand back and look at the patch, so the arc, the bounce and the blast are
  // all in frame rather than under the crosshair.
  window.__H__.place(open.x - 11, open.z + 5, 0);
  window.__H__.aimAt(open.x + 3, open.y + 1.4, open.z);
  return { open, player: { x: g.player.position.x, z: g.player.position.z } };
});

const plate = await shoot('gren-0-plate', 'the ground before anything happens', 4);

// --- the arc, mid-flight ---------------------------------------------------
//
// THE DRIVER IS HELD OFF FOR EVERY STAGED FRAME. The renderer keeps composing
// frames either way - that is main.js's loop, not this one - so freezing the
// simulation means the shot is of an exact, reproducible moment rather than of
// whatever moment a software renderer happened to arrive at. It is also the
// only way to photograph one frame of a 0.6 second explosion on a machine
// producing two frames a second.
const arcFrame = await page.evaluate((o) => {
  window.__H__.hold(true);
  window.__G__.clearLive();

  const s = window.__G__.placeAt(o.x + 6, o.y + 0.6, o.z - 5, -4.5, 9.6, 4.0, 99);
  for (let i = 0; i < 58; i++) window.__G__.update(1 / 120, null);

  // Close enough that a 17 cm shell is 30 pixels rather than 9, and offset so
  // the ground under it is in frame and the height reads.
  window.__H__.place(s.p.x + 3.6, s.p.z + 4.2, 0);
  window.__H__.aimAt(s.p.x, s.p.y, s.p.z);
  return { x: +s.p.x.toFixed(2), y: +s.p.y.toFixed(2), z: +s.p.z.toFixed(2),
           speed: +s.v.length().toFixed(2) };
}, framing.open);
const arcShot = await shoot('gren-1-arc', 'shell near the top of its arc', 3);

// --- the bounce ------------------------------------------------------------
const bounceFrame = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.clearLive();

  const wall = window.__H__.findWall(0, 0, 45, 5);
  const ang = wall.ang;
  const cx = Math.cos(ang), cz = Math.sin(ang);
  const ox = wall.ox, oz = wall.oz;
  const floor = g.world.heightAt(ox, oz, 0);

  const s = window.__G__.placeAt(ox, floor + 1.3, oz, cx * 13, 1.2, cz * 13, 99);

  // Stepped to the frame AFTER the reversal, so the shell is caught coming off
  // the stone rather than approaching it.
  let hit = -1;
  for (let i = 0; i < 600; i++) {
    window.__G__.update(1 / 240, null);
    if (s.v.x * cx + s.v.z * cz < -0.2) { hit = i; break; }
  }
  for (let i = 0; i < 30; i++) window.__G__.update(1 / 240, null);

  // Standing beside the column, looking along its face, so the stone the shell
  // came off is in the same frame as the shell.
  window.__H__.place(wall.x - cx * (wall.r + 4.5) - cz * 3.0,
                     wall.z - cz * (wall.r + 4.5) + cx * 3.0, 0);
  window.__H__.aimAt(s.p.x, s.p.y, s.p.z);

  return {
    hit,
    wall: { x: +wall.x.toFixed(1), z: +wall.z.toFixed(1), r: +wall.r.toFixed(2) },
    shell: { x: +s.p.x.toFixed(2), y: +s.p.y.toFixed(2), z: +s.p.z.toFixed(2) },
    distFromWall: +Math.hypot(s.p.x - wall.x, s.p.z - wall.z).toFixed(2),
  };
});
const bounceShot = await shoot('gren-2-bounce', 'shell coming off the stone', 3);

// --- the explosion at its brightest ----------------------------------------
//
// THE COMPARISON PLATE IS TAKEN FROM THE SAME CAMERA. The opening plate is
// framed from somewhere else entirely, and comparing an explosion against it
// would fold the difference between two viewpoints into a number reported as
// "the explosion lifted the frame". Two shots, one camera, one variable.
await page.evaluate((o) => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.clearLive();
  window.__H__.clearEnemies();
  g.combat.state.invulnerable = true;

  // Something to be lit BY it. An explosion with nothing in it is a sprite.
  g.director.placeAt('shambler', o.x + 1.9, o.z + 0.7);
  g.director.placeAt('shambler', o.x - 1.6, o.z - 1.2);

  window.__H__.place(o.x - 8, o.z + 3.5, 0);
  window.__H__.aimAt(o.x, o.y + 1.1, o.z);
}, framing.open);

const blastPlate = await shoot('gren-3a-before', 'same camera, one frame before', 3);

const blastState = await page.evaluate((o) => {
  window.__G__.detonate(o.x, o.y + 0.35, o.z, false);

  // Stepped to 0.067 s, which is where the fireball has opened to four metres
  // and the point light is still at half strength. At t = 0 the ball is barely
  // a metre across and the frame is mostly light; by 0.3 s the light is gone and
  // the frame is mostly smoke. This is the moment the event actually looks like
  // an explosion, and it is chosen by the numbers rather than by waiting for a
  // renderer running at two frames a second to land on it.
  for (let i = 0; i < 8; i++) window.__G__.update(1 / 120, null);

  const fx = window.__G__.effects.find((f) => f.t >= 0) || window.__G__.effects[0];
  const p = fx.paint;
  return {
    visible: fx.group.visible,
    lightIntensity: +p.light.toFixed(1),
    ballOpacity: +p.ball.toFixed(3),
    ballRadius: +p.ballR.toFixed(2),
    coreOpacity: +p.core.toFixed(3),
    smokeOpacity: +p.smoke.toFixed(3),
    ringOpacity: +p.ring.toFixed(3),
    ringRadius: +p.ringR.toFixed(2),
    age: +fx.t.toFixed(3),
    lastBlast: window.__G__.state.lastBlast,
  };
}, framing.open);

const blastShot = await shoot('gren-3-blast', 'the flash, stepped to u=0.11', 3);

// --- the aftermath ---------------------------------------------------------
// Stepped to 0.79 s: fire out, light out, ring gone, smoke at two thirds and
// spreading. This is what the player is actually looking at when they decide
// whether to push through the crater, so it is the frame worth judging.
const afterFrame = await page.evaluate(() => {
  for (let i = 0; i < 87; i++) window.__G__.update(1 / 120, null);
  const fx = window.__G__.effects.find((f) => f.t >= 0);
  return fx ? { age: +fx.t.toFixed(3), ...fx.paint } : null;
});
const afterShot = await shoot('gren-4-aftermath', 'smoke at 0.79 s, fire and light out', 3);

// Then let it run all the way out and confirm nothing is left behind.
await page.evaluate(() => {
  for (let i = 0; i < 120; i++) window.__G__.update(1 / 120, null);
  window.__H__.hold(false);
});

const afterState = await page.evaluate(() => {
  const st = window.__G__.stats();
  return {
    activeFx: window.__G__.effects.filter((f) => f.t >= 0).length,
    lights: window.__G__.effects.map((f) => +f.light.intensity.toFixed(2)),
    opacities: window.__G__.effects.map((f) =>
      +(f.paint.ball + f.paint.core + f.paint.smoke + f.paint.ring).toFixed(3)),
    live: st.live,
    detonated: st.detonated,
  };
});

// ---------------------------------------------------------------------------
// 14. LOOK AT A KILL. A frame with bodies still standing in it is the bug.
// ---------------------------------------------------------------------------

/**
 * The owner's report was a picture, not a number: "they just hit them".
 *
 * So this is the picture. Six shamblers in a ring inside the lethal core, one
 * frag, three frames - before, the flash, and the aftermath a second and a bit
 * later - and the assertion is on what is STANDING in the last one.
 *
 * THE DIRECTOR HAS TO RUN FOR THE AFTERMATH, which is the whole reason this is
 * a separate section from the staged blast above. Every other block in this
 * file stops the director so its targets hold still, and a corpse in a stopped
 * director never topples: `beginDeath` sets `dying` and the actual fall is
 * integrated in `actor.update`, which only `director.update` calls. Photographed
 * with the director held, six dead mummies stand bolt upright in the smoke -
 * which is the reported defect, staged by the harness, and it would have been
 * read as the defect itself.
 *
 * The wave counter is parked and the phase pinned to a breather with a long
 * timer, so running the director advances the BODIES and nothing else.
 */
const groupStaged = await page.evaluate((o) => {
  const g = window.__SANDS__;
  window.__H__.hold(true);
  window.__G__.clearLive();
  window.__H__.clearEnemies();
  g.combat.state.invulnerable = true;

  g.director.state.wave = 1;
  const bodies = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const e = g.director.placeAt('shambler',
      o.x + Math.cos(a) * 1.6, o.z + Math.sin(a) * 1.6);
    if (e) bodies.push(e);
  }
  window.__BODIES__ = bodies;

  // Back and slightly high, so all six and the ground they are on are in frame.
  window.__H__.place(o.x - 9.5, o.z + 4.0, 0);
  window.__H__.aimAt(o.x, o.y + 1.0, o.z);

  return {
    placed: bodies.length,
    health: bodies.map((e) => Math.round(e.maxHealth)),
    standing: bodies.filter((e) => e.live && !e.dying).length,
  };
}, framing.open);

const groupBefore = await shoot('gren-5-group-before', 'six bodies, before the frag', 4);

const groupBlast = await page.evaluate((o) => {
  const g = window.__SANDS__;
  window.__G__.detonate(o.x, o.y + 0.35, o.z, false);

  // Same 0.067 s the staged flash uses, so the two frames are comparable.
  g.director.state.running = true;
  for (let i = 0; i < 8; i++) {
    window.__G__.update(1 / 120, null);
    g.director.update(1 / 120, 0);
  }
  g.director.state.running = false;

  const b = window.__BODIES__;
  return {
    reached: window.__G__.state.lastBlast.enemies,
    dead: b.filter((e) => e.dying || e.dead || e.health <= 0).length,
    standing: b.filter((e) => e.live && !e.dying).length,
  };
}, framing.open);

const groupFlash = await shoot('gren-6-group-blast', 'the frag among six bodies', 3);

const groupAfter = await page.evaluate(() => {
  const g = window.__SANDS__;

  /**
   * 0.90 s, and the number is chosen against the death phases in
   * enemies/mummy.js rather than by taste: topple runs 0.62 s, then the body
   * LIES for 0.45 s, and only then does a 0.9 s crumble begin. 0.90 s is a
   * quarter of a second into the lie - every body is flat, every body is still
   * fully opaque, and the smoke has about a third of its opacity left.
   *
   * The first cut of this stepped to 1.3 s and photographed an EMPTY PATCH OF
   * SAND. Six corpses had crumbled and been retired, which is a frame that
   * proves the kill by absence and is worth nothing as evidence: it is what a
   * blast that deleted the actors outright would also look like, and it is not
   * what the player sees when they throw one. The aftermath has to have the
   * bodies IN it.
   */
  g.director.state.running = true;
  for (let i = 0; i < 108; i++) {
    window.__G__.update(1 / 120, null);
    g.director.update(1 / 120, 0);
  }
  g.director.state.running = false;

  const b = window.__BODIES__;

  /**
   * How far each body has actually FALLEN, as the angle its own up-axis makes
   * with the world's. `dying` is a flag anyone can set; this is the thing on
   * screen, and a corpse at zero is a corpse standing bolt upright in the frame
   * being photographed.
   *
   * MEASURED AS A TILT, NOT AS rotation.x. `beginDeath` topples AWAY FROM THE
   * BLAST, around the horizontal axis perpendicular to it, so six bodies in a
   * ring fall around six different axes - reading rotation.x reported 0.459 for
   * the two that fell sideways and 1.515 for the two that fell backwards, and
   * a threshold on it would have failed a third of a group that was flat on the
   * ground. The angle between the body's up and the world's is the same number
   * whichever way it went over.
   */
  const UP = new g.THREE.Vector3(0, 1, 0);
  const _v = new g.THREE.Vector3();

  const pitch = b.map((e) => +Math.abs(e.group ? e.group.rotation.x : 0).toFixed(3));
  const tilt = b.map((e) => {
    const body = e.group && e.group.children ? e.group.children[0] : null;
    if (!body) return 0;
    return +_v.set(0, 1, 0).applyQuaternion(body.quaternion).angleTo(UP).toFixed(3);
  });

  return {
    dead: b.filter((e) => e.dying || e.dead || e.health <= 0).length,
    standing: b.filter((e) => e.live && !e.dying).length,
    retired: b.filter((e) => !e.live).length,
    // Still parented AND still drawing. A body that has been unhooked from the
    // scene graph, or whose meshes have gone invisible, is not in the frame
    // this section exists to photograph.
    inScene: b.filter((e) => !!(e.group && e.group.parent)).length,
    visible: b.filter((e) => !!(e.group && e.group.visible)).length,
    pitch,
    tilt,
    // Past 1.0 rad - 57 degrees off vertical - is past anything that could read
    // as a stumble. A completed topple lands near pi/2.
    toppled: tilt.filter((p) => p > 1.0).length,
    liveInDirector: g.director.liveCount,
  };
});

const groupAftermath = await shoot('gren-7-group-aftermath', 'the crater, 0.9 s later', 3);

await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__H__.clearEnemies();
  g.director.state.wave = 0;
  window.__G__.reset();
  window.__H__.hold(false);
});

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
const warnings = logs.filter((l) => l.startsWith('[warning]'));

const show = (name, o) => console.log(`\n--- ${name} ---\n` + JSON.stringify(o, null, 2));

show('construction', construction);
show('arc', arc);
show('bounce', bounce);
show('rest', rest);
show('fuse', fuse);
show('overcook', overcook);
show('falloff', falloff);
show('lethality', lethality);
show('cover', cover);
show('gold', gold);
show('leak', leak);
show('supply', supply);
show('interior', inside);
show('arc frame', arcFrame);
show('bounce frame', bounceFrame);
show('blast frame', blastState);
show('aftermath frame', afterFrame);
show('aftermath', afterState);
show('group staged', groupStaged);
show('group blast', groupBlast);
show('group aftermath', groupAfter);

/**
 * The damage curve, printed rather than asserted.
 *
 * The assertions below fix the two ends - it kills a shambler at ten, it does
 * not delete a Bound - and this is the middle, so the next person to touch
 * BLAST_MAX can see the whole shape it produced without re-deriving it.
 */
console.log('\n--- the curve, on real bodies ---');
for (const r of lethality.shambler) {
  console.log(`  shambler w${String(r.wave).padStart(2)}  hp ${String(r.maxHealth).padStart(4)}` +
    `  took ${String(r.took).padStart(6)}  left ${String(r.leftPct).padStart(5)}%  ` +
    (r.dead ? 'DEAD' : 'walks'));
}
for (const r of lethality.bound) {
  console.log(`  BOUND    w${String(r.wave).padStart(2)}  hp ${String(r.maxHealth).padStart(4)}` +
    `  took ${String(r.took).padStart(6)}  left ${String(r.leftPct).padStart(5)}%  ` +
    (r.dead ? 'DEAD' : 'walks'));
}

console.log('\n--- shots ---');
for (const s of shots) {
  console.log(`  ${s.name.padEnd(22)} luma=${String(s.meanLuma).padStart(6)} ` +
    `lit=${String(s.percentLit).padStart(5)}% clip=${String(s.clipPct).padStart(5)}% ` +
    `sd=${String(s.spread).padStart(6)}  ${s.label}`);
}

if (errors.length) { console.log('\n--- errors ---'); for (const e of errors) console.log(e); }
if (warnings.length) { console.log('\n--- warnings ---'); for (const w of warnings) console.log(w); }

/**
 * The same gate enemies.mjs uses, for the same reason. A genuinely black
 * captured frame measures 0.14 luma and 0.1% lit; the exterior shots this suite
 * takes measure 90 to 130. Eighteen and 55 per cent sit two orders of magnitude
 * above black and comfortably under anything legitimate.
 */
const DARK = shots.filter((s) => s.meanLuma < 18 || s.percentLit < 55);

const rows = falloff.rows;
const monotone = rows.every((r, i) => i === 0 || r.took <= rows[i - 1].took);

const checks = {
  // --- construction --------------------------------------------------------
  'module constructs against the live game':
    construction.stats.pool === K.POOL && construction.stats.fxPool === K.FX,
  'shells and fixtures allocated at boot':
    construction.after.sceneChildren - construction.before.sceneChildren === K.POOL + K.FX,
  'construction added no textures':
    construction.after.textures === construction.before.textures,
  'input publishes the grenade key':      construction.inputHasGrenadeKey === true,
  'damage system exposes applyBlast':     construction.combatHasApplyBlast === true,

  // --- 1. the arc ----------------------------------------------------------
  'the shell rises then falls':           arc.rose && arc.fell,
  'horizontal velocity is constant':      arc.vxSpread < 0.002,
  'the second difference gives gravity':  Math.abs(arc.gFit - K.GRAVITY) < 0.05,
  'a quadratic fits it exactly':          arc.worstResidual < 1e-9,
  'the fitted curvature is gravity':      Math.abs(arc.quadCoef - K.GRAVITY) < 0.05,

  // --- 2. the bounce -------------------------------------------------------
  'a wall was found to bounce off':       bounce.found === true,
  'the shell never enters the collider':  bounce.framesInside === 0,
  'it never crosses to the far side':     bounce.crossedToFarSide === false,
  'the velocity reverses at the stone':   bounce.reversedAt > 0,
  'it ends on the near side, further out': bounce.endD > bounce.wallR,

  // --- 3. rest -------------------------------------------------------------
  'the shell comes to rest':              rest.asleep === true,
  'it rests within a few seconds':        rest.sleptAfter > 0 && rest.sleptAfter < 7,
  'resting means zero velocity':          rest.speed === 0,
  'it rests ON the ground, not in it':    rest.aboveFloor > 0.05 && rest.aboveFloor < 0.30,
  'it actually bounced on the way':       rest.bounces > 0,

  // --- 4 and 5. the fuse ---------------------------------------------------
  'the fuse fires on time':               Math.abs(fuse.firedAt - fuse.want) <= 1 / 60,
  'cooking runs the real clock':          Math.abs(fuse.cookedFor - 2.0) < 0.02,
  'cooking shortens the fuse':
    Math.abs(fuse.remaining - (K.FUSE - 2.0)) < 0.03,
  'a cooked shell fires early':           fuse.cookedFiredAt < fuse.want,

  // --- 6. the wager --------------------------------------------------------
  'an overcooked grenade goes off in hand': overcook.cookedOff === 1,
  'it goes off at the end of the fuse':   Math.abs(overcook.firedAt - K.FUSE) < 0.05,
  'it kills the player':                  overcook.downsDelta === 1,
  'it costs a grenade':                   overcook.consumed === 1,
  'cooking stops after it fires':         overcook.stillCooking === false,
  'the same blast is survivable at six metres':
    overcook.survivedSix === true && overcook.atSixMetres > 0,

  // --- 7. falloff ----------------------------------------------------------
  'four bodies were placed in the blast': rows.length === 4,
  'the nearest body dies':                rows[0] && rows[0].dead === true,
  'damage falls off monotonically':       monotone === true,
  'the far body takes nothing':           rows[3] && rows[3].took === 0,
  'the rim is survivable, not zero':      falloff.atRim > 0 && falloff.atRim < 40,
  'past the rim is exactly nothing':      falloff.beyondRim === 0,
  'the centre is lethal':                 falloff.atCentre === K.BLAST_MAX,

  // --- 7b. it actually kills -----------------------------------------------
  //
  // THE CHECK THE REPORT WAS ABOUT. Asserted against the body's own maxHealth
  // at the wave the director would have handed it out at, not against the
  // curve. The three waves the owner named are named here.
  'a frag kills a shambler at wave 1':
    lethality.shambler[0].wave === 1 && lethality.shambler[0].dead === true,
  'a frag kills a shambler at wave 5':
    lethality.shambler[1].wave === 5 && lethality.shambler[1].dead === true,
  'a frag kills a shambler at wave 10':
    lethality.shambler[2].wave === 10 && lethality.shambler[2].dead === true,
  // Twelve is the designed end of the reliable band and thirteen is the round
  // the execution floor in systems/damage.js absorbs, so the practical line is
  // thirteen. Pinned, because "it kills forever" is the failure on the other
  // side of the one being fixed.
  'it still kills a shambler at wave 12': lethality.shambler[3].dead === true,
  'the execution floor carries wave 13':  lethality.shambler[4].dead === true,
  'it stops killing after that':          lethality.shambler[5].dead === false
                                          && lethality.shambler[6].dead === false,
  // ...and what it does instead is a wound worth the throw, not a scratch.
  'a wave-20 shambler is badly hurt':     lethality.shambler[6].leftPct < 35,
  'a frag kills a husk at wave 10':       lethality.husk[0].dead === true,

  // THE BOUND. It arrives at wave ten and it must NOT be deleted by a frag -
  // that is the variant's entire job - but a fifth of its health was the
  // owner's complaint, so the floor is a real quarter and the ceiling is alive.
  'a Bound survives a frag at wave 10':   lethality.bound[0].dead === false,
  'a Bound survives a frag at wave 15':   lethality.bound[1].dead === false,
  'a frag takes a real bite out of a Bound at 10':
    lethality.bound[0].leftPct < 75 && lethality.bound[0].leftPct > 55,
  'and still a quarter of one at 15':
    lethality.bound[1].leftPct < 80 && lethality.bound[1].leftPct > 60,

  // Distance still decides. Same blast, same wave-one body, six metres out.
  'a distant body survives the same blast':
    !!lethality.distant && lethality.distant.dead === false,
  'and it was genuinely in range':        lethality.distant.took > 0,

  // --- 8. cover ------------------------------------------------------------
  'a wall was found to hide behind':      cover.found === true,
  'both bodies were placed':              cover.shieldedPlaced && cover.controlPlaced,
  'the control is in range':              cover.controlRange > 0 && cover.controlRange < K.OUTER,
  'geometry blocks the blast':            cover.shieldedTook === 0,
  'the control at the same range is hurt': cover.controlTook > 0,

  // --- 9. gold -------------------------------------------------------------
  'a grenade kill lands':                 gold.killed === true,
  'a grenade kill pays 60':               gold.killPay === gold.bounty.kill,
  'the module counted the kill':          gold.kills === 1,
  'a non-lethal blast pays 10':           gold.hitPay === gold.bounty.hit && gold.survived,
  'a blast that hits nothing pays nothing': gold.emptyPay === 0,
  // ONCE EACH. Five bodies, five bounties - not ten, and not one.
  'a blast killed all five':              gold.groupPlaced === 5 && gold.groupDead === 5,
  'five kills pay five bounties, once':   gold.groupPay === 5 * gold.bounty.kill,
  'the module counted five':              gold.groupKills === 5,
  'the pooled records do not pay twice':  gold.replayPay === 0,

  // --- 10. leaks -----------------------------------------------------------
  'a hundred throws ran':                 leak.thrown === 100 && leak.detonated >= 100,
  'no geometry leak':                     leak.geometriesDelta === 0,
  'no texture leak':                      leak.texturesDelta === 0,
  'no scene graph leak':                  leak.sceneChildrenDelta === 0,
  'the pool returned everything':         leak.liveAfter === 0,
  'pool depth unchanged':                 leak.poolDepth === K.POOL,
  'everything is still mounted':          leak.mounted === K.POOL + K.FX,
  'no audio voice leak':                  leak.audioVoices <= leak.audioCap,

  // --- 11. supply ----------------------------------------------------------
  'the player starts with a full pouch':  supply.start === K.MAX_COUNT
                                          && K.START_COUNT === K.MAX_COUNT,
  'throwing spends one at a time':
    supply.spend.join(',') === [3, 2, 1, 0].join(',') && supply.emptied === 0,
  'an empty pouch refuses the throw':     supply.refusedWhenEmpty === true,
  'an empty pouch refuses the cook':      supply.cookRefused === true,

  // THE REFILL, through the director's own wave start rather than a poll.
  'the director publishes a wave start':  supply.hasHook === true,
  'a round start refills to four':        supply.fromEmpty.count === K.WAVE_REFILL,
  'the wave counter moved with it':       supply.fromEmpty.wave === 7
                                          && supply.fromEmpty.waveBefore === 6,
  'a round tops a partial pouch up':      supply.partial === K.MAX_COUNT - 1
                                          && supply.fromPartial.count === K.MAX_COUNT,
  'a round on a full pouch adds nothing': supply.fromFull.count === K.MAX_COUNT,

  // THE CAP. Nothing - the refill, a grant, or a purchase - goes past four.
  'the pouch caps against a grant':       supply.afterGive === K.MAX_COUNT,
  'refill never exceeds the cap':         supply.afterRefill === K.MAX_COUNT,
  'a grenade can be bought':              supply.beforeBuy === K.MAX_COUNT - 1
                                          && supply.bought === true
                                          && supply.spent === K.GRENADE_PRICE
                                          && supply.afterBuy === K.MAX_COUNT,
  'the buy is refused at the cap':        supply.refusedAtCap === true,

  // --- 12. inside ----------------------------------------------------------
  'the router swapped to the interior':   inside.space === 'interior',
  'the interior hands over wall boxes':   inside.walls > 0,
  'a shell in flight existed before':     inside.liveBefore === 1,
  'the transition retires live shells':   inside.liveAfterTransition === 0,
  'a wall box was found':                 inside.found === true,
  'a shell does not cross a wall box':    inside.framesPastTheMidPlane === 0,
  'it bounces off the wall box':          inside.reversedAt > 0 && inside.endOffset > 0,
  'the harness came back outside':        inside.backOutside === 'exterior',

  // --- 13. the frames ------------------------------------------------------
  'the flash fixture is visible':         blastState.visible === true,
  'the flash carries a real light':       blastState.lightIntensity > 40,
  'the fireball has opened':              blastState.ballOpacity > 0.5
                                          && blastState.ballRadius > 2.0,
  'there is smoke as well as fire':       blastState.smokeOpacity > 0.05,
  'the shockwave ring is running':        blastState.ringOpacity > 0.1
                                          && blastState.ringRadius > 1.0,
  'the blast in frame reached the horde': blastState.lastBlast.enemies === 2,
  // BRIGHTER THAN THE SAME FRAME WITHOUT IT, NOT WHITER. An explosion is the
  // exact subject that will pass a mean-luminance gate by blowing out, so the
  // lift is asserted against a plate from the SAME camera, alongside a clip
  // ceiling and a spread floor. The first cut of this fixture scored a clean
  // 0.1 per cent clip and a healthy lift while looking like a hard white disc
  // stuck on the lens; the spread term is what would have caught it.
  'the explosion lifts the frame':        blastShot.meanLuma > blastPlate.meanLuma + 1.5,
  'the explosion does not clip the frame': blastShot.clipPct < 3,
  'the explosion does not flatten it':    blastShot.spread > blastPlate.spread * 0.9,
  // The aftermath is a frame in its own right, not the plate again. Smoke is
  // still up and the fire is entirely gone, which is what makes it aftermath.
  'smoke outlives the fire':              !!afterFrame && afterFrame.smoke > 0.15
                                          && afterFrame.ball === 0
                                          && afterFrame.light === 0,
  'the aftermath is a different frame':   afterShot.meanLuma < blastPlate.meanLuma - 1.0,
  'the fixture retires':                  afterState.activeFx === 0
                                          && afterState.lights.every((l) => l === 0)
                                          && afterState.opacities.every((o) => o === 0),
  // --- 14. the kill, in frame ----------------------------------------------
  'six bodies were staged':               groupStaged.placed === 6
                                          && groupStaged.standing === 6,
  'the frag reached all six':             groupBlast.reached === 6,
  'all six died to one frag':             groupBlast.dead === 6,
  // THE REPORTED BUG, AS AN ASSERTION. Nothing is left on its feet.
  'nothing is standing in the aftermath': groupAfter.standing === 0,
  // And they are visibly DOWN, not merely flagged dead. The pitch is what the
  // camera sees; `dying` is what the code believes. Past 0.6 rad is past the
  // point a fall reads as a fall rather than as a stumble.
  'the bodies are on the ground':         groupAfter.toppled === 6,
  // ...and they are still IN the photographed frame, rather than crumbled and
  // retired. See the note on the step count: an empty patch of sand proves the
  // kill by absence, which is exactly what a broken blast would also look like.
  'the corpses are in the aftermath frame':
    groupAfter.inScene === 6 && groupAfter.visible === 6 && groupAfter.retired === 0,
  'the crater frame is not the plate':    groupAftermath.meanLuma !== groupBefore.meanLuma,
  'the blast frame lifts the group plate':
    groupFlash.meanLuma > groupBefore.meanLuma + 1.5,
  'the group blast does not clip':        groupFlash.clipPct < 3,
  'the group blast does not flatten it':  groupFlash.spread > groupBefore.spread * 0.9,

  'every shot rendered a lit frame':      DARK.length === 0,
  'no console errors':                    errors.length === 0,
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

await browser.close();
process.exit(failed ? 1 : 0);
