/**
 * CAN YOU WALK THROUGH A ZOMBIE? Played, not asserted.
 *
 * The owner: "the zombies need to be solid objects so that we can't walk
 * through them." Before this build the player controller had never heard of an
 * actor - `resolveCollisions` knew about `world.colliders` and `world.walls` and
 * nothing else - so the player passed through the horde because NOTHING TESTED
 * IT, not because a test was failing.
 *
 * WHAT IS MEASURED, and it is one number: the CLOSEST the player's centre ever
 * gets to the actor's centre across a walk straight at it. That invariant does
 * not care whether the actor is standing still or walking into the player, which
 * matters because a shambler chases and cannot be asked to hold still. If the
 * body is solid, centre-to-centre never goes below `playerRadius + actorRadius`
 * whoever is doing the moving. If it is not, the number goes to nearly zero.
 *
 * THERE IS A CONTROL AND IT IS NOT OPTIONAL. Every case runs twice: once with
 * `player.setBodies(null)` - the behaviour that shipped until today - and once
 * with the horde wired in. A harness that reports "solid" without ever having
 * seen "not solid" has not demonstrated it can tell the difference, and three
 * separate harnesses in this project's stuck-corner investigation reported
 * confident nonsense for exactly that reason.
 *
 * FOUR CLAIMS:
 *   1. a living shambler cannot be walked through
 *   2. a CORPSE can - a body mid-topple must not hold a doorway
 *   3. contact damage still lands, because a solid body that cannot reach you
 *      is a different bug wearing this fix as a costume
 *   4. the horde cannot post the player INTO stone: bodies resolve before the
 *      static world, so geometry has the last word on where the player ends up
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/*
 * How long each walk is held, in wall clock, and it is long on purpose.
 *
 * The first run of this file gave it 2500 ms and started the player 4 m out.
 * Under swiftshader the effective walk is around 0.5 m/s of wall clock, so the
 * player covered 1.28 m, the shambler closed 1.53 m, and the gap bottomed out at
 * 1.40 m - well outside the 0.82 m at which a solid body would have stopped
 * anything. Both arms returned 1.40 and the file reported four failures without
 * either arm ever having touched the other. A walk that cannot reach the thing
 * it is walking at cannot report anything about it.
 */
const WALK_MS = 8000;

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

await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__S__ = {
    async frames(n) { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); },

    settle(x, z) {
      const y = g.world.heightAt ? g.world.heightAt(x, z) : 0;
      g.player.teleport({ x, y, z });
      for (let i = 0; i < 60; i++) {
        g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
        if (g.player.state.grounded) break;
      }
    },

    /** Clear the floor so only the actor under test is in the way. */
    clearHorde() { g.director.reset(); },

    /** The one number this file exists for. */
    minGap(a) {
      return Math.hypot(g.player.position.x - a.position.x, g.player.position.z - a.position.z);
    },
  };
});

/**
 * Walk at an actor and report the closest the two centres ever came.
 *
 * `solid` selects whether the horde is wired into the body at all, which is the
 * control: the same walk, the same actor, the same frames, one line different.
 */
async function approach(opts) {
  return page.evaluate(async (cfg) => {
    const g = window.__SANDS__;
    const S = window.__S__;

    g.player.setBodies(cfg.solid ? () => g.director.live : null);

    S.clearHorde();
    await S.frames(2);

    const a = g.director.placeAt('shambler', cfg.ax, cfg.az);
    if (!a) return { error: 'no actor placed' };
    if (cfg.kill) {
      a.hurt(1e9, 'body', 0, 1);
      // One frame so the death state actually latches before the walk.
      await S.frames(2);
    }

    const minDist = 0.42 + (a.radius ?? 0.42) * (a.scale ?? a.spec?.scale ?? 1);

    S.settle(cfg.px, cfg.pz);
    await S.frames(4);

    // Face the actor. The yaw that MOVES the body is the third argument to
    // update(); the rig is set too so anything reading the camera agrees.
    const dx = cfg.ax - g.player.position.x, dz = cfg.az - g.player.position.z;
    const yaw = Math.atan2(-dx, -dz);
    g.rig.reset(yaw, -0.02);
    g.rig.update(1 / 60, g.player, false);

    const health0 = g.player.state.health;
    let closest = Infinity;
    const t0 = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    while (performance.now() - t0 < cfg.walkMs) {
      await new Promise((r) => requestAnimationFrame(r));
      if (a.live !== false) closest = Math.min(closest, S.minGap(a));
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    await S.frames(2);

    return {
      minDist: +minDist.toFixed(3),
      closest: +closest.toFixed(3),
      ratio: +(closest / minDist).toFixed(3),
      dying: !!(a.dying || a.dead),
      healthLost: health0 - g.player.state.health,
      playerEnd: { x: +g.player.position.x.toFixed(2), z: +g.player.position.z.toFixed(2) },
      actorEnd: { x: +a.position.x.toFixed(2), z: +a.position.z.toFixed(2) },
    };
  }, { ...opts, walkMs: WALK_MS });
}

/*
 * THE SPOT HAS TO BE GENUINELY EMPTY, AND THE FIRST ONE WAS NOT.
 *
 * This file originally ran at (30, 5), which `test/stuck-pins.mjs` had already
 * reported as carrying one overlapping cylinder and which was used as a control
 * anyway. Measured clearance there is MINUS 0.80 m: the player stands inside
 * stone. Every "the body stopped at the actor's radius" reading taken there was
 * really the static resolver pushing them off a collider, and the corpse case
 * failed for the same reason - the thing holding the player was never the corpse.
 *
 * These coordinates were chosen by sweeping the courtyard for the point with the
 * largest clearance along a straight six-metre lane. It measures 6.98 m clear,
 * so nothing but the actor under test can touch the player.
 */
const SPOT = { px: -2, pz: 1.5, ax: -2, az: -1 };

const through = await approach({ solid: false, kill: false, ...SPOT });
const solid = await approach({ solid: true, kill: false, ...SPOT });
const corpse = await approach({ solid: true, kill: true, ...SPOT });

// --- can the horde post the player into stone? -----------------------------
//
// The player stands with their back a body's width from the quarry face and a
// shambler walks into them. Bodies resolve BEFORE the static world, so the wall
// gets the last word; if that ordering were reversed the player would end up
// inside the rock, which the census below would show as a collider overlap.
const pinned = await page.evaluate(async (walkMs) => {
  const g = window.__SANDS__;
  const S = window.__S__;
  g.player.setBodies(() => g.director.live);
  S.clearHorde();
  await S.frames(2);

  // Against the quarry's bedrock face line (QUARRY.faceX = 39.6).
  S.settle(38.9, 6);
  await S.frames(4);
  const a = g.director.placeAt('shambler', 36.5, 6);
  if (!a) return { error: 'no actor placed' };

  const t0 = performance.now();
  while (performance.now() - t0 < walkMs) await new Promise((r) => requestAnimationFrame(r));

  // Is the player inside any static collider? That is the failure this checks.
  const p = g.player.position;
  const feet = p.y - 1.68;
  let worstOverlap = 0;
  for (const c of g.world.colliders) {
    const base = c.y0 === undefined ? (g.world.heightAt ? g.world.heightAt(c.x, c.z) : 0) : c.y0;
    if (feet - base > c.h) continue;
    if (base - feet > 1.68) continue;
    const d = Math.hypot(p.x - c.x, p.z - c.z);
    worstOverlap = Math.max(worstOverlap, (c.r + 0.42) - d);
  }
  return {
    playerEnd: { x: +p.x.toFixed(2), z: +p.z.toFixed(2) },
    worstOverlap: +worstOverlap.toFixed(3),
    gapToActor: +Math.hypot(p.x - a.position.x, p.z - a.position.z).toFixed(2),
  };
}, WALK_MS);

// ---------------------------------------------------------------------------
// verdict
// ---------------------------------------------------------------------------

const checks = {
  'CONTROL: with the horde unwired, the player walks through':
    !through.error && through.ratio < 0.5,
  'a living shambler cannot be walked through':
    !solid.error && solid.ratio >= 0.95,
  'and it stops them at the drawn radius, not near it':
    !solid.error && solid.closest >= solid.minDist - 0.06,
  'the control and the fix disagree, so the test can see the difference':
    !through.error && !solid.error && solid.closest > through.closest + 0.3,
  'a corpse is walked straight through':
    !corpse.error && corpse.dying === true && corpse.ratio < 0.5,
  'contact damage still lands through a solid body':
    solid.healthLost > 0,
  'the horde cannot post the player into stone':
    !pinned.error && pinned.worstOverlap <= 0.02,
  'no console errors':
    errors.length === 0,
};

writeFileSync(`${OUT}solid-report.json`,
  JSON.stringify({ through, solid, corpse, pinned, errors }, null, 1));

console.log('                                        minDist  closest  ratio');
for (const [n, r] of [['CONTROL not solid', through], ['solid', solid], ['corpse', corpse]]) {
  if (r.error) { console.log(`${n.padEnd(40)} ERROR ${r.error}`); continue; }
  console.log(`${n.padEnd(40)} ${String(r.minDist).padStart(6)}  ${String(r.closest).padStart(7)}  ${String(r.ratio).padStart(5)}`);
}
console.log('');
console.log(`damage taken walking into a solid body   ${solid.healthLost}`);
console.log(`pinned against the quarry face           overlap ${pinned.worstOverlap} m, ${pinned.gapToActor} m off the actor`);
console.log('');

let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log('');
console.log(`report  ${OUT}solid-report.json`);
if (errors.length) console.log(`errors  ${errors.slice(0, 3).join(' / ')}`);

await browser.close();

if (failed) { console.log(`\n${failed} CHECK(S) FAILED`); process.exit(1); }
console.log('\nALL CHECKS PASSED');
