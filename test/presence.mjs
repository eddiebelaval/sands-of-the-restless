/**
 * HER, AT DISTANCE - the suite for src/story/presence.js (PLAYTHROUGH 1.5, 3.7).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS ACTUALLY TRYING TO CATCH
 * ---------------------------------------------------------------------------
 *
 * Four claims, and every one of them is satisfiable by a broken build unless it
 * is paired with a control, so every one of them is:
 *
 *   1. "SHE IS UNREACHABLE."   Satisfiable by a build where she was never
 *      placed. Paired with: the site resolved, a second opinion on the height
 *      of the stone under her read straight out of the collider array, and a
 *      real body driven at her for 900 controller steps reporting where it got
 *      to in three dimensions.
 *
 *   2. "SHE IS NEVER SEEN TO APPEAR OR VANISH."   Satisfiable by a build where
 *      she never appears at all. Paired with: a phase that is ARMED, ELIGIBLE
 *      and IN RANGE while the camera is on her and refuses to raise, and then
 *      raises within a few frames of the camera turning away. Both halves in
 *      one run or the claim is worth nothing.
 *
 *   3. "THE VISIBILITY MODEL IS THE TRUTH."   The whole file rests on one
 *      predicate, and a predicate that wrongly says HIDDEN is what lets an
 *      object pop in front of somebody. So the model is checked against PIXELS:
 *      the avenue is sampled, and at every sample the model's answer is
 *      compared with an A/B frame diff. This check found a real defect on the
 *      first run - the collider array is a sealing representation and its
 *      cylinders are fatter than the stone, so a grazing sightline down the
 *      wall reported occluded while she was plainly on screen.
 *
 *   4. "THE HORDE FLOWS PAST THE LAMP."   Satisfiable by a build where the
 *      horde was never spawned and by one where the lamp was never raised.
 *      Paired with: peak live count and total actor-samples are reported, the
 *      collider array is counted before and after the lamp goes in, and the
 *      pass test is not "they came near it" but "a body's centre crossed within
 *      half a metre of the flame", which nothing the routing knows about can do.
 *
 * ---------------------------------------------------------------------------
 * IT DRIVES THE MODULE IN THE REAL GAME AND WIRES IT ITSELF
 * ---------------------------------------------------------------------------
 *
 * `src/main.js` belongs to another lane this week, so presence.js is not
 * constructed by the game yet. This file injects a module script that imports
 * the real file and hands it the real `spaces`, `camera`, `player` and
 * `director` off `window.__SANDS__`, then pumps `update()` on its own animation
 * frame. Those are the exact four objects and the exact call site the
 * integration asks for, so what is measured here is what will run - but it IS a
 * seam, and it stops being honest the day main.js does the wiring. When that
 * lands, delete install() and read `__SANDS__.presence`.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE IS TIMED ON A STOPWATCH
 * ---------------------------------------------------------------------------
 *
 * Headless Chrome renders on CPU through swiftshader and one frame in the Great
 * Gallery at wave 13 measured 341 ms on this machine. Every wait is a wait on
 * STATE with a frame budget as the backstop, and `settle()` dumps the state it
 * gave up on rather than throwing a timeout with nothing in it.
 *
 * Usage: node test/presence.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS, dismissBriefing } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:4193/index.html';
const OUT = new URL('../shots/presence/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const checks = [];
const note = [];
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  -  ${detail}`}`);
}

const browser = await chromium.launch({ executablePath: resolveChrome(), args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 90000 });
await page.evaluate(() => window.__SANDS__.start());
// BEGIN raises the briefing card and the world is held behind it. See chrome.mjs.
await dismissBriefing(page);

/** Advance the world by N DRAWN frames. Never a stopwatch. */
const pump = (n) => page.evaluate(async (k) => {
  for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r));
}, n);

const statsOf = (id) => page.evaluate((k) => window.__PRESENCE__.stats()[k], id);

/**
 * Advance frames until a beat reaches `want`, or give up and hand back the last
 * state seen. Frames, not milliseconds: see the header.
 */
async function settle(id, want, budget = 90) {
  let last = null;
  for (let i = 0; i < budget; i++) {
    last = await statsOf(id);
    if (last.phase === want) return { ok: true, frames: i, stats: last };
    await pump(2);
  }
  return { ok: false, frames: budget, stats: last };
}

await pump(40);

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

/*
 * THE SEAM IS GONE: THIS IS THE GAME'S OWN MODULE NOW.
 *
 * This file used to construct its own `createPresence` and pump `update()` on
 * its own animation frame, because `src/main.js` belonged to another lane. That
 * was honest for exactly as long as it took main.js to do the wiring, and it did
 * on 2026-08-09 - so what is read here is `__SANDS__.presence`, built by the
 * game, updated by the game's frame loop, after the composer.
 *
 * THAT CHANGE IS NOT COSMETIC. The injected version proved the module works when
 * driven correctly. This version proves the GAME drives it correctly, which is a
 * different claim and the only one worth shipping - a suite that wires up its own
 * copy cannot tell you the integration line was ever added.
 *
 * The script tag stays for two things that are genuinely the rig's: the authored
 * constants, which are not on the public handle and should not be, and holding
 * the player alive (see the note below).
 */
await page.addScriptTag({
  type: 'module',
  content: `
    import { SIGHTING_SITES, LAMP_SITES, ACT3_FROM_WAVE }
      from '/src/story/presence.js';
    window.__PRESENCE__ = window.__SANDS__.presence;
    window.__PRESENCE_DATA__ = { SIGHTING_SITES, LAMP_SITES, ACT3_FROM_WAVE };
    window.__PRESENCE_TICKS__ = 0;
    window.__HEALS__ = 0;
    (function keepHimAlive() {
      requestAnimationFrame(keepHimAlive);
      window.__PRESENCE_TICKS__++;
      /**
       * HE IS HELD ALIVE FOR THE WHOLE SUITE, AND THIS IS THE RIG, NOT A CLAIM.
       *
       * Run 2 of this file produced eleven camera positions reporting exactly
       * zero pixels and a visibility model that "disagreed with nothing" -
       * and every one of those numbers was a photograph of the same frozen
       * frame. Wave 1 had started on its own, killed a player who was parked
       * where a teleport had put him, and ui/death.js had halted the world.
       * A halted game answers every question consistently and wrongly.
       *
       * Topping the health up is a property of the measuring rig. Nothing in
       * this suite is a claim about damage, and __HEALS__ is reported so a
       * reader can see how often it was needed rather than wonder.
       */
      const pl = window.__SANDS__.player;
      if (pl.state.health < 100) { window.__HEALS__++; pl.state.health = 100; }
      // NO presence.update() HERE. main.js owns that call now, and calling it a
      // second time per frame would double every tick the module counts and hide
      // a missing integration line behind this file's own diligence.
    })();
  `,
});
await page.waitForFunction(() => !!window.__PRESENCE__, null, { timeout: 30000 });
await pump(6);

/*
 * THE GAME BUILT IT, AND THIS FILE IS HOLDING THE SAME OBJECT.
 *
 * Identity, not truthiness: `!!__SANDS__.presence` would pass against a stub and
 * `!!__PRESENCE__` would pass against a copy this file made. The pair being the
 * SAME reference is what says the integration line is in main.js.
 *
 * That it is also DRIVEN is not asserted here, because nothing at this point in
 * the run has asked it to do anything. It is proved by the first settle() below:
 * a phase only ever advances inside update(), this file no longer calls update(),
 * so a raise that happens at all happened because main.js's frame loop made it
 * happen. If the integration line is ever removed, that check is where it dies.
 */
check('the game constructed it, and this suite holds the game\'s own instance',
  await page.evaluate(() => !!window.__SANDS__.presence
    && window.__PRESENCE__ === window.__SANDS__.presence));

// ---------------------------------------------------------------------------
// SURVEY MODE - how the Act 1 site was chosen, re-runnable
// ---------------------------------------------------------------------------
//
// `node test/presence.mjs <base> --survey` skips the suite and instead scores
// every point in the exterior a 1.7 m figure could stand on at 3 to 7 m, by how
// much of the player's own ground it is visible from. It exists because the
// first site was picked by reading a wall-height profile and was WRONG: the
// avenue is colonnaded, a row of 10.4 m columns stands two metres inboard of
// the wall line, and a figure on the wall head behind them is visible from
// almost nowhere a player stands. That is not a fact any source file states.
//
// Pure maths, no rendering, so it costs seconds rather than the ten minutes the
// suite costs. The suite is still what settles it, in pixels.
if (process.argv.includes('--survey')) {
  const rows = await page.evaluate(() => {
    const g = window.__SANDS__;
    const cols = g.world.colliders;
    const SHRINK = 0.68, MIN_OCC = 0.22;

    function blocked(ex, ey, ez, ax, ay, az) {
      const dx = ax - ex, dy = ay - ey, dz = az - ez;
      const len2 = dx * dx + dz * dz;
      if (len2 < 1e-6) return false;
      for (const c of cols) {
        const r = Math.max(MIN_OCC, c.r * SHRINK);
        const fx = ex - c.x, fz = ez - c.z;
        const b = fx * dx + fz * dz;
        const cc = fx * fx + fz * fz - r * r;
        const disc = b * b - len2 * cc;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        let t0 = (-b - sq) / len2, t1 = (-b + sq) / len2;
        if (t1 <= 0.001 || t0 >= 0.999) continue;
        if (t0 < 0.001) t0 = 0.001;
        if (t1 > 0.999) t1 = 0.999;
        const base = c.y0 || 0, top = base + c.h;
        const yA = ey + dy * t0, yB = ey + dy * t1;
        if (yA > top && yB > top) continue;
        if (yA < base && yB < base) continue;
        return true;
      }
      return false;
    }

    function standAt(x, z) {
      let top = 0;
      for (const c of cols) {
        const dx = c.x - x, dz = c.z - z;
        if (dx * dx + dz * dz > c.r * c.r) continue;
        const t = (c.y0 || 0) + c.h;
        if (t > top) top = t;
      }
      return top;
    }

    // Where a player actually is in Act 1: the avenue, plus a lane either side.
    const views = [];
    for (let z = 30; z >= -30; z -= 3) for (const vx of [-8, -4, 0, 4, 8]) views.push({ x: vx, z });

    const out = [];
    for (let sx = -24; sx <= 24; sx += 1.2) {
      for (let sz = 30; sz >= -32; sz -= 1) {
        const top = standAt(sx, sz);
        if (top < 3 || top > 7) continue;
        let seen = 0; let near = 0; const ds = [];
        for (const v of views) {
          const d = Math.hypot(v.x - sx, v.z - sz);
          if (d < 10 || d > 50) continue;
          near++;
          if (blocked(v.x, 1.85, v.z, sx, top + 1.15, sz)) continue;
          seen++; ds.push(+d.toFixed(0));
        }
        if (!near) continue;
        out.push({ x: +sx.toFixed(1), z: sz, y: +top.toFixed(2), seen, of: near,
          pct: +((seen / near) * 100).toFixed(0), ds: ds.sort((a, b) => a - b) });
      }
    }
    return out.sort((a, b) => b.seen - a.seen).slice(0, 40);
  });

  console.log('--- Act 1 candidate sites, scored by how much of the avenue sees them ---');
  for (const r of rows) {
    console.log(`  (${String(r.x).padStart(6)},${String(r.z).padStart(4)})  stand ${String(r.y).padStart(5)} m  `
      + `seen from ${String(r.seen).padStart(3)}/${String(r.of).padStart(3)} (${String(r.pct).padStart(3)}%)  `
      + `ranges ${r.ds.slice(0, 6).join(',')}`);
  }
  await browser.close();
  process.exit(0);
}

/** Face the rig at, or away from, a world point. Same yaw a player would hold. */
const face = (pt, away) => page.evaluate(({ pt, away }) => {
  const g = window.__SANDS__;
  const p = g.player.position;
  let yaw = Math.atan2(-(pt.x - p.x), -(pt.z - p.z));
  if (away) yaw += Math.PI;
  g.rig.reset(yaw, -0.02);
}, { pt, away });

const at = (x, z) => page.evaluate(({ x, z }) =>
  window.__SANDS__.player.teleport({ x, y: 0, z }), { x, z });

/**
 * IS THE WORLD STILL RUNNING, ASKED BEFORE EVERY MEASUREMENT.
 *
 * The first run of this suite reported three camera positions where she
 * contributed exactly ZERO pixels, and the number was true and meant nothing:
 * the walk probe had driven the player into something that killed him, the
 * death card had frozen the world, and every frame after it was the same frame.
 * A halted game answers every question consistently and wrongly, which is the
 * hardest kind of wrong to see in a log. So: dismiss the card the way the
 * player does - the real button, by id - and never measure anything without
 * having asked first.
 */
async function alive() {
  const phase = await page.evaluate(() => window.__SANDS__.death.phase);
  if (phase === 'none') return { was: 'none', revived: false };
  await page.evaluate(async () => {
    const g = window.__SANDS__;
    for (let i = 0; i < 400 && g.death.phase !== 'waiting'; i++) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    const b = document.getElementById('death-confirm');
    if (b) b.click();
    for (let i = 0; i < 400 && g.death.phase !== 'none'; i++) {
      await new Promise((r) => requestAnimationFrame(r));
    }
  });
  return { was: phase, revived: true, now: await page.evaluate(() => window.__SANDS__.death.phase) };
}

// ---------------------------------------------------------------------------
// 1. THE SITING GUARD
// ---------------------------------------------------------------------------

await at(0, 26);
await page.evaluate(() => window.__PRESENCE__.force('sighting'));
await pump(3);

const siteInfo = await page.evaluate(() => {
  const g = window.__SANDS__;
  const s = window.__PRESENCE__.sites.sighting;
  if (!s) return null;
  // A second opinion, read out of the collider array by this file rather than
  // echoed back from the module.
  let top = 0, under = null;
  for (const c of g.world.colliders) {
    if (Math.hypot(c.x - s.x, c.z - s.z) > c.r) continue;
    const t = (c.y0 || 0) + c.h;
    if (t > top) { top = t; under = { x: +c.x.toFixed(1), z: +c.z.toFixed(1), r: +c.r.toFixed(2), h: +c.h.toFixed(2) }; }
  }
  return { site: s, topFromColliders: +top.toFixed(2), under, colliders: g.world.colliders.length };
});
const rejected = (await statsOf('sighting')) && (await page.evaluate(() => window.__PRESENCE__.stats().rejected));

check('beat 1.5 resolved a site', !!siteInfo, siteInfo && JSON.stringify(siteInfo.site));
check('the guard refused nothing', rejected.length === 0, JSON.stringify(rejected));
check('the collider top the module chose is the one this file reads back',
  siteInfo && Math.abs(siteInfo.site.colliderTop - siteInfo.topFromColliders) < 0.01,
  siteInfo && `module ${siteInfo.site.colliderTop} m, colliders ${siteInfo.topFromColliders} m, under ${JSON.stringify(siteInfo.under)}`);
check('and her feet are on the DRAWN surface, not on the collider top',
  siteInfo && siteInfo.site.y > siteInfo.site.colliderTop
    && siteInfo.site.y - siteInfo.site.colliderTop < 2.0,
  siteInfo && `surface ${siteInfo.site.y.toFixed(2)} m against collider ${siteInfo.site.colliderTop} m `
    + `- the sealing cylinders are ${(siteInfo.site.y - siteInfo.site.colliderTop).toFixed(2)} m short of the stone`);
check('that stone is far above anything the controller can climb (CLIMB 0.65 m)',
  siteInfo && siteInfo.site.y >= 3.0, siteInfo && `${siteInfo.site.y.toFixed(2)} m of wall`);

const her = siteInfo.site;

// ---------------------------------------------------------------------------
// 2. UNREACHABLE - drive a real body at her and see where it stops
// ---------------------------------------------------------------------------

const walk = await page.evaluate(() => {
  const g = window.__SANDS__;
  const s = window.__PRESENCE__.sites.sighting;
  const EYE = 1.68;                       // player.position.y is the eye

  g.player.teleport({ x: 0, y: 0, z: s.z + 6 });
  let best = Infinity, bestAt = null, maxFeet = -Infinity, nearest2d = Infinity;

  const drive = (yaw, steps) => {
    for (let i = 0; i < steps; i++) {
      // Sprinting AND jumping the whole way, which is the strongest thing a
      // player can do to reach something. A gentle probe proves nothing.
      g.player.update(1 / 60, { forward: 1, strafe: 0, sprint: true, jump: true }, yaw);
      const p = g.player.position;
      const d2 = Math.hypot(p.x - s.x, p.z - s.z);
      const feet = p.y - EYE;
      const d3 = Math.hypot(d2, feet - s.y);
      if (d3 < best) { best = d3; bestAt = { x: +p.x.toFixed(2), feetY: +feet.toFixed(2), z: +p.z.toFixed(2) }; }
      if (feet > maxFeet) maxFeet = feet;
      if (d2 < nearest2d) nearest2d = d2;
    }
  };

  const toHer = Math.atan2(-(s.x - g.player.position.x), -(s.z - g.player.position.z));
  drive(toHer, 400);
  drive(toHer + 0.5, 250);
  drive(toHer - 0.5, 250);

  return {
    closest3d: +best.toFixed(2),
    closest2d: +nearest2d.toFixed(2),
    maxFeetY: +maxFeet.toFixed(2),
    at: bestAt,
    herFeetY: +s.y.toFixed(2),
  };
});

check('900 sprinting, jumping controller steps cannot put him on her wall',
  walk.maxFeetY < walk.herFeetY - 1.5,
  `his feet peak at ${walk.maxFeetY} m against her ${walk.herFeetY} m - ${(walk.herFeetY - walk.maxFeetY).toFixed(2)} m short`);
check('and he never closes to arm\'s length in three dimensions',
  walk.closest3d > 2.4,
  `closest ${walk.closest3d} m 3D (${walk.closest2d} m on the floor) at ${JSON.stringify(walk.at)}`);

// Driving a body at a wall for fifteen simulated seconds is exactly the sort of
// thing that kills it. Everything after this point is measurement.
const revived = await alive();
check('CONTROL: the world is running again after the walk probe',
  !revived.revived || revived.now === 'none',
  `death phase was "${revived.was}"${revived.revived ? `, now "${revived.now}"` : ''}`);
await pump(10);

// ---------------------------------------------------------------------------
// 3. THE INVARIANT - armed, eligible, in range, in view, and it refuses
// ---------------------------------------------------------------------------

// Camera and body FIRST, then arm. Arming into a camera that is already on her
// is the only ordering that tests the refusal rather than a race.
await at(0, 22);
await face(her, false);
await pump(4);
await page.evaluate(() => { window.__PRESENCE__.reset(); window.__PRESENCE__.force('sighting'); });
await pump(10);

const watched = await statsOf('sighting');
check('CONTROL: armed, eligible, in range and in view while he watches',
  watched.phase === 'armed' && watched.visible === true && watched.range >= 18,
  `phase ${watched.phase}, visible ${watched.visible}, range ${watched.range} m`);
check('and she does NOT raise while he is looking at her',
  watched.inScene === false && watched.meshes === 0, `inScene ${watched.inScene}`);

await face(her, true);
const rose = await settle('sighting', 'up', 20);
check('she raises once he looks away',
  rose.ok, `after ${rose.frames * 2} frames; meshes ${rose.stats.meshes}`);

await face(her, false);
await pump(14);
const seenNow = await statsOf('sighting');
check('and she is there when he looks back',
  seenNow.phase === 'up' && seenNow.visible === true && seenNow.seenS > 0.05,
  `visible ${seenNow.visible}, seen ${seenNow.seenS} s over ${seenNow.seenFrames} frames, range ${seenNow.range} m`);

await face(her, true);
const went = await settle('sighting', 'done', 25);
check('she is gone the next time he is not looking',
  went.ok, `after ${went.frames * 2} frames; lingered ${went.stats.lingered}`);
check('nothing about her entered or left the scene on a frame he could see it',
  went.stats.violations === 0, `violations ${went.stats.violations}`);

// ---------------------------------------------------------------------------
// 4. PIXELS - and the model checked against them
// ---------------------------------------------------------------------------

await page.setViewportSize({ width: 1280, height: 720 });
await page.addStyleTag({ content: '#hud,#readouts,#minimap,#objective,#notice,.hud{opacity:0 !important}' });
/**
 * THE CANVAS IS NOT PINNED, AND THE COUNTS ARE NORMALISED INSTEAD.
 *
 * core/governor.js drops the render scale when frames get expensive, and under
 * swiftshader they always do: one run of this sweep reported 1280x720, 1088x612
 * and 921x518 across five consecutive camera positions, so the same silhouette
 * got three different areas and none of them was comparable.
 *
 * The obvious fix - governor.force(0), the 'full' rung - was tried and is worse
 * than the problem. GTAO plus full shadows plus bloom plus SMAA at 1280x720 on
 * a CPU rasteriser is the most expensive frame this project can produce, and it
 * crashed the renderer process twice. Measuring something by putting the machine
 * into a state the machine cannot survive is not measuring it.
 *
 * So the governor is left alone, every reading carries the canvas it was taken
 * on, and `norm()` restates it as pixels-per-1280x720 so two readings can be
 * compared. The raw number and the canvas are both printed, because a
 * normalised figure with no denominator beside it is a number nobody can check.
 */
await pump(4);
const norm = (d) => (d && d.changed
  ? Math.round(d.changed * ((1280 * 720) / (d.canvas[0] * d.canvas[1])))
  : 0);

/**
 * A/B ON THE SAME CAMERA, WHICH IS THE ONLY HONEST WAY TO COUNT A SILHOUETTE.
 *
 * "She is forty pixels tall" measured off one frame is a claim about a
 * photograph. The pair - the same frame with her group hidden - makes it a
 * claim about HER: every differing pixel is one she is responsible for, and
 * their bounding box is her footprint on the screen. Same instrument that
 * reversed two design decisions on this project: a night-sky ceiling that lost
 * 69.2% of a gold scarab, and a sunk frieze recess that lost 55.3%.
 */
const diffOf = (label) => page.evaluate((name) => new Promise((resolve) => {
  const g = window.__SANDS__;
  const grp = g.scene.getObjectByName(name);
  if (!grp) { resolve(null); return; }

  /**
   * BOTH HALVES OF THE PAIR ARE DRAWN INSIDE ONE ANIMATION FRAME, AND THAT IS
   * THE WHOLE INSTRUMENT.
   *
   * The first version toggled her visibility and waited three frames for each
   * half. It reported 439,637 differing pixels for a figure thirty metres away,
   * and the number was honest: three frames of a live world is three frames of
   * drifting cloud, blowing dust and guttering brazier, and all of it lands in
   * the diff. An A/B whose two halves are taken at different times measures
   * TIME.
   *
   * So the world is not advanced at all. Inside a single callback the composer
   * is asked to draw the same simulation twice - render(0), which advances no
   * clock - once with her in the graph and once without. Nothing else in the
   * scene can differ between the two, so every differing pixel is hers.
   *
   * It has to be inside the rAF callback: with preserveDrawingBuffer false, a
   * canvas read outside one can come back cleared.
   */
  requestAnimationFrame(() => {
    const c = g.renderer.domElement;
    const s = document.createElement('canvas');
    s.width = c.width; s.height = c.height;
    const ctx = s.getContext('2d', { willReadFrequently: true });

    const shot = () => {
      ctx.clearRect(0, 0, s.width, s.height);
      ctx.drawImage(c, 0, 0);
      return ctx.getImageData(0, 0, s.width, s.height).data;
    };

    grp.visible = true;
    g.post.composer.render(0);
    const A = shot();
    grp.visible = false;
    g.post.composer.render(0);
    const B = shot();
    grp.visible = true;
    g.post.composer.render(0);

    let n = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, lift = 0;
    for (let i = 0; i < A.length; i += 4) {
      const dr = A[i] - B[i], dg = A[i + 1] - B[i + 1], db = A[i + 2] - B[i + 2];
      if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) < 24) continue;
      n++;
      lift += (dr + dg + db) / 3;
      const px = (i / 4) % s.width, py = Math.floor((i / 4) / s.width);
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    resolve({
      canvas: [s.width, s.height], changed: n,
      box: n ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
      meanLift: n ? +(lift / n).toFixed(1) : 0,
    });
  });
}), label);

// Raise her again. Same three gates, run a second time - not a back door.
await at(0, 20);
await face(her, true);
await page.evaluate(() => { window.__PRESENCE__.reset(); window.__PRESENCE__.force('sighting'); });
const again = await settle('sighting', 'up', 30);
check('she can be raised a second time for the capture', again.ok, JSON.stringify(again.stats));

/**
 * THE MODEL AGAINST THE FRAME, at five points down the avenue.
 *
 * The failure that matters is one direction only: the model saying HIDDEN while
 * the frame shows her. That is what lets an object appear in front of somebody,
 * and it is the defect this sweep found on the first run.
 */
const SWEEP = [[0, 28], [0, 16], [0, 4], [0, -6]];
const sweep = [];
for (const [x, z] of SWEEP) {
  await at(x, z);
  await face(her, false);
  await pump(5);
  const s = await statsOf('sighting');
  const why = await page.evaluate(() => window.__PRESENCE__.explain('sighting'));
  const d = await diffOf('presence:sighting');
  sweep.push({ x, z, range: s.range, model: s.visible, px: d ? d.changed : 0,
    norm: norm(d), canvas: d && d.canvas, box: d && d.box, why });
  await page.screenshot({ path: `${OUT}sweep-${String(x).replace('-', 'm')}-${String(z).replace('-', 'm')}.png`, timeout: 180000 });
  console.log(`      sweep (${String(x).padStart(3)},${String(z).padStart(4)})  range ${String(s.range).padStart(5)} m  `
    + `model ${s.visible ? 'VISIBLE' : 'hidden '}  pixels ${String(d ? d.changed : 0).padStart(6)}  `
    + `(${String(norm(d)).padStart(6)} normalised)  canvas ${d ? d.canvas.join('x') : '?'}  `
    + `${why && why.blocker ? 'blocked by ' + JSON.stringify(why.blocker) : ''}`);
}
const lies = sweep.filter((s) => !s.model && s.px > 30);
check('the visibility model never says hidden while the frame shows her',
  lies.length === 0, lies.length ? JSON.stringify(lies) : `${sweep.length} camera positions agree`);

const best = sweep.reduce((a, b) => (b.norm > a.norm ? b : a), sweep[0]);
check('she is on the screen, not only in the scene graph',
  best.norm > 300,
  `${best.px} px on a ${best.canvas && best.canvas.join('x')} canvas (${best.norm} normalised) at ${best.range} m from (${best.x},${best.z})`);
check('her footprint is a tall narrow silhouette rather than a smudge',
  best.box && best.box.h >= 24 && best.box.h > best.box.w, JSON.stringify(best.box));

const far = sweep.reduce((a, b) => (b.range > a.range ? b : a), sweep[0]);
check('and something of her survives from the far end of the avenue',
  far && far.norm > 100,
  far && `${far.px} px (${far.norm} normalised) at ${far.range} m, box ${JSON.stringify(far.box)}`);

note.push(`sighting pixels by camera: ${sweep.map((s) => `${s.range}m:${s.px}px/${s.norm}n`).join('  ')}`);

// The sweep above already photographed every camera it measured, so there is
// no separate beauty pass: the pictures and the numbers are the same frames.

// ---------------------------------------------------------------------------
// 5. THE LAMP, AND THE HORDE GOING PAST IT
// ---------------------------------------------------------------------------

await page.setViewportSize({ width: 960, height: 540 });
await page.evaluate(() => window.__PRESENCE__.reset());
const aliveIn = await alive();
check('CONTROL: still running before the interior measurements',
  !aliveIn.revived || aliveIn.now === 'none', `death phase was "${aliveIn.was}"`);
await page.evaluate(() => window.__SANDS__.spaces.enter('interior', { x: 0, z: -192, rot: 0 }));
await pump(12);

const beforeCols = await page.evaluate(() => window.__SANDS__.world.colliders.length);

await page.evaluate(() => {
  const g = window.__SANDS__;
  g.player.teleport({ x: 0, y: 0, z: -192 });
  g.director.forceWave(13);
  // South, at the door he came in by. The raise has to happen behind him.
  g.rig.reset(0, -0.02);
  window.__PRESENCE__.force('lamp');
});

const lit = await settle('lamp', 'up', 60);
const afterCols = await page.evaluate(() => window.__SANDS__.world.colliders.length);

check('beat 3.7 resolved a site on open floor', !!(lit.stats && lit.stats.site),
  lit.stats && JSON.stringify(lit.stats.site));
check('the lamp raised, and it raised out of view',
  lit.ok && lit.stats.violations === 0,
  `phase ${lit.stats.phase} after ${lit.frames * 2} frames, violations ${lit.stats.violations}`);
check('CONTROL: raising the lamp registers no collider at all',
  beforeCols === afterCols && beforeCols > 0, `${beforeCols} before, ${afterCols} after`);

const lampSite = lit.stats.site;
await face({ x: lampSite.x, z: lampSite.z }, false);
await pump(4);

const flow = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const p = window.__PRESENCE__;
  const s = p.sites.lamp;
  const root = g.scene.getObjectByName('enemies');

  const closest = new Map();
  let samples = 0, frames = 0, liveMax = 0, healed = 0;
  const t0 = performance.now();

  for (let i = 0; i < 240; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    frames++;
    // The flow field follows the player. A body that drifted would be measuring
    // a different room, so he is held at the door he is meant to be holding.
    g.player.teleport({ x: 0, y: 0, z: -192 });
    // AND HELD ALIVE. A motionless player at wave 13 is dead in about eight
    // seconds, the death card halts the director, and the horde this section
    // exists to measure stops existing - which is exactly how the first run of
    // this suite produced a confident "0 of 0 actors". Topping the health up is
    // a property of the rig, not a claim about the game, and the check below
    // reports whether it was ever needed.
    if (g.player.state.health < 100) { healed++; g.player.state.health = 100; }
    liveMax = Math.max(liveMax, g.director.liveCount);
    for (const c of root.children) {
      if (!c.visible) continue;
      samples++;
      const d = Math.hypot(c.position.x - s.x, c.position.z - s.z);
      const cur = closest.get(c);
      if (cur === undefined || d < cur) closest.set(c, d);
    }
  }

  const mins = [...closest.values()].sort((a, b) => a - b).map((d) => +d.toFixed(2));
  return {
    frames, samples, liveMax, healed, wallMs: Math.round(performance.now() - t0),
    actors: mins.length, mins,
    within3: mins.filter((d) => d <= 3).length,
    within1: mins.filter((d) => d <= 1).length,
    within05: mins.filter((d) => d <= 0.5).length,
    lamp: p.stats().lamp,
  };
});

check('CONTROL: the horde was armed and moving while this was measured',
  flow.liveMax >= 4 && flow.samples > 400,
  `${flow.liveMax} live at peak, ${flow.samples} actor-samples over ${flow.frames} frames (${Math.round(flow.wallMs / flow.frames)} ms a frame), health topped up on ${flow.healed} frames`);
check('the horde\'s route crosses the lamp', flow.within3 >= 1,
  `${flow.within3} of ${flow.actors} actors inside 3 m over ${flow.frames} frames; closest approaches ${JSON.stringify(flow.mins.slice(0, 8))}`);
check('PAST it, not around it - a body crossed within half a metre of the flame',
  flow.within05 >= 1, `${flow.within05} inside 0.5 m, ${flow.within1} inside 1 m`);
check('nothing about the lamp entered or left the scene in view',
  flow.lamp.violations === 0, `violations ${flow.lamp.violations}`);

/**
 * THE RATE IS REPORTED RATHER THAN GATED, AND THE REASON IS IN THE NUMBERS.
 *
 * With the player parked at the south door, most of the horde does not traverse
 * this room at all: four of the nine spawn points the placement filter offers
 * near the gallery are in the Act 3 rooms SOUTH of it, so those actors arrive
 * beside him and never go near the lamp. Their closest approach clusters at 17
 * to 27 m, which is just the lamp-to-player distance - they got there and
 * stopped.
 *
 * So the beat is a trickle by construction, and PLAYTHROUGH 3.7 asks for
 * exactly that: "Once, unremarked. If the player misses it, they miss it."
 * The gate is therefore the MECHANISM - a body passing through the flame with
 * no collider anywhere in the file - and the frequency is a number for a reader
 * rather than a threshold for a suite to be tuned against.
 */
note.push(`horde v lamp: ${flow.within3}/${flow.actors} actors inside 3 m and `
  + `${flow.within05} inside 0.5 m, over ${flow.frames} frames (${Math.round(flow.wallMs / 1000)} s) at wave 13 `
  + `with the player stationary at the south door`);

// ---------------------------------------------------------------------------
// 6. THE LAMP IN PIXELS - the pool on the floor is the beat
// ---------------------------------------------------------------------------

/**
 * THE HORDE IS CLEARED BEFORE THE LAMP IS PHOTOGRAPHED, AND NOT TO FLATTER IT.
 *
 * The Great Gallery with thirteen live actors is the most expensive frame this
 * project produces, and asking it for two extra composer passes and two canvas
 * readbacks killed the renderer process three runs in a row. The horde claim was
 * measured a dozen lines above and does not need to be in this photograph; what
 * is being measured here is how much of the screen the lamp is responsible for,
 * and a room with fewer bodies in it makes that measurement CLEANER rather than
 * kinder - there is less in front of it to hide behind.
 *
 * `director.reset()` is the same teardown the death path runs.
 */
await page.evaluate(() => window.__SANDS__.director.reset());
await pump(8);
await face({ x: lampSite.x, z: lampSite.z }, false);
await pump(6);
await page.screenshot({ path: OUT + '20-lamp-down-the-gallery.png', timeout: 180000 });
const lampDiff = await diffOf('presence:lamp');
const lampNow = await statsOf('lamp');

check('the lamp reaches the screen from the far end of the gallery',
  lampDiff && lampDiff.changed > 300,
  lampDiff && `${lampDiff.changed} px differ at ${lampNow.range} m on a ${lampDiff.canvas.join('x')} canvas, box ${JSON.stringify(lampDiff.box)}`);
check('and it lifts the floor rather than only drawing an object',
  lampDiff && lampDiff.meanLift > 2 && lampDiff.box && lampDiff.box.w > 30,
  lampDiff && `mean lift +${lampDiff.meanLift} per channel across ${lampDiff.box && lampDiff.box.w} px of width`);

note.push(`lamp pixels: ${lampDiff && lampDiff.changed} px, box ${JSON.stringify(lampDiff && lampDiff.box)}, lift +${lampDiff && lampDiff.meanLift}`);

// ---------------------------------------------------------------------------
// 7. IT IS NOT ANNOUNCED
// ---------------------------------------------------------------------------

const quiet = await page.evaluate(() => ({
  notice: (document.getElementById('notice') || {}).textContent || '',
  objective: (document.getElementById('objective') || {}).textContent || '',
}));
check('no pill, no objective line, nothing named on screen',
  !/lamp|porter|woman|figure|presence|sighting/i.test(quiet.notice + ' ' + quiet.objective),
  `notice "${quiet.notice.trim().slice(0, 60)}"`);

// ---------------------------------------------------------------------------

await browser.close();

const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
console.log('');
for (const n of note) console.log(`note: ${n}`);
console.log(`shots -> ${OUT}`);
for (const l of errs) console.log(l);
check('no console errors', errs.length === 0, `${errs.length}`);

const failed = checks.filter((c) => !c.pass);
console.log('');
console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
for (const f of failed) console.log(`  FAILED: ${f.name}  -  ${f.detail}`);
process.exit(failed.length ? 1 : 0);
