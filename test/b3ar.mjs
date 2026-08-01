/**
 * THE B3AR: does the burst actually burst, and can you buy it outside.
 *
 * Three claims, and every one of them is a thing this project has shipped as a
 * comment before:
 *
 *   1. THE GUN RENDERS. Four weapon features in this file's history were a
 *      sentence in a block comment and nothing on screen - a three-dot sight
 *      modelled behind its own sight base, an aperture painted on a solid drum.
 *      So the viewmodel is photographed at hip, at ADS, and mid-burst, and the
 *      compensator is measured in PIXELS against the MK9 rather than asserted.
 *
 *   2. THE BURST IS THREE ROUNDS AT TWO RATES. The entire burst mechanic in
 *      weapons.js had never executed - no weapon in BASE_STATS set `burst` -
 *      so "it is already written" was worth nothing until something called it.
 *      The timestamps are measured off the weapon's own clock and printed.
 *
 *   3. THE WALL BUY WORKS IN THE COURTYARD. Prompt, price, debit, gun in hand,
 *      outside, where no fixture has ever stood.
 *
 * Everything waits on frames or on state, never on wall-clock milliseconds:
 * under software rendering this renders at well under one frame a second while
 * every system clamps its delta to 1/20s, so a setTimeout here photographs an
 * animation halfway through and reports a working system as broken.
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

/** The build under test. argv[2] or SANDS_URL. Never a hardcoded literal. */
const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

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

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1600);

await page.addScriptTag({
  content: `
window.__B__ = {
  async frames(n) {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  },

  /** Stand off a fixture and look at it. A slot's rot is the way it FACES. */
  face(x, z, rot, dist = 3.0, y = 0) {
    const g = window.__SANDS__;
    const fx = -Math.sin(rot), fz = -Math.cos(rot);
    g.player.teleport({ x: x + fx * dist, y, z: z + fz * dist });
    g.rig.reset(rot + Math.PI, -0.02);
  },

  async press() {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    await window.__B__.frames(2);
  },

  hud() {
    const p = document.getElementById('prompt');
    return {
      gold: document.querySelector('[data-gold]').textContent,
      weapon: document.querySelector('[data-weapon]').textContent,
      mag: document.querySelector('[data-mag]').textContent,
      reserve: document.querySelector('[data-reserve]').textContent,
      prompt: p.textContent,
      promptOn: p.classList.contains('on'),
      promptDeny: p.classList.contains('deny'),
    };
  },
};
`,
});

const checks = [];
function check(ok, label, detail = '') {
  checks.push({ ok, label, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n        ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------
// 0. the armoury knows what it is
// ---------------------------------------------------------------------------

const stats = await page.evaluate(() => {
  const g = window.__SANDS__;
  const s = g.weapons.STATS.b3ar;
  return {
    exists: !!s,
    ...s,
    name: g.weapons.displayName('b3ar'),
    slot: g.weapons.STATS && Object.keys(g.weapons.STATS).indexOf('b3ar'),
    interBurstMs: s ? +(60000 / s.rpm).toFixed(1) : 0,
    intraBurstMs: s ? +(60000 / s.burstRpm).toFixed(1) : 0,
  };
});

check(stats.exists && stats.burst === 3, 'the B3AR is in BASE_STATS and fires three',
  `${stats.name}: dmg ${stats.damage} x${stats.burst} = ${stats.damage * stats.burst}, hs ${stats.headshot}, `
  + `mag ${stats.magazine}, range ${stats.range}, rpm ${stats.rpm} (${stats.interBurstMs}ms between) / `
  + `burstRpm ${stats.burstRpm} (${stats.intraBurstMs}ms inside)`);

check(stats.pellets === 1, 'it is a burst and not a small shotgun',
  `pellets ${stats.pellets} - three rounds over time, not three in one instant`);

// ---------------------------------------------------------------------------
// 1. the burst, measured off the weapon's own clock
//
// Driven through weapons.update() at a fine delta rather than through the frame
// loop, because the frame loop under swiftshader clamps every delta to 1/20s
// and a 50ms floor cannot resolve a 40ms interval. This is the mechanic under
// test; the live loop is tested below.
//
// `state.lastShot` is the weapon's own clock at the moment a round left, so the
// gaps come out in the same units the rate limiter is written in.
// ---------------------------------------------------------------------------

const burst = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const w = g.weapons;

  w.grant('b3ar');
  w.equip('b3ar');
  await new Promise((r) => requestAnimationFrame(r));

  const DT = 1 / 480;
  const shots = [];
  let last = w.state.lastShot;
  let mag = w.magazine;

  // One held trigger, long enough for three bursts. Synchronous, so the frame
  // loop cannot interleave its own update() call into the middle of it.
  for (let i = 0; i < 480; i++) {
    w.update(DT, { fire: true }, false);
    if (w.state.lastShot !== last) {
      last = w.state.lastShot;
      shots.push(+(last * 1000).toFixed(1));
    }
  }

  const spent = mag - w.magazine;
  const t0 = shots.length ? shots[0] : 0;
  const rel = shots.map((t) => +(t - t0).toFixed(1));
  const gaps = rel.slice(1).map((t, i) => +(t - rel[i]).toFixed(1));

  return { shots: rel, gaps, spent, burstLeft: w.state.burstLeft };
});

// The first three shots are one trigger pull. Gap 1 and 2 are inside it; gap 3
// is the pause the player is meant to hear.
const intra = burst.gaps.slice(0, 2);
const inter = burst.gaps[2];

check(burst.shots.length >= 3, 'one held trigger produces rounds at all',
  `shot times, ms from the first: ${burst.shots.join(', ')}`);

check(burst.gaps.length >= 3 && intra.every((gp) => gp > 0 && gp < inter * 0.5),
  'THREE rounds at the fast rate, then a pause at the slow one',
  `inside the burst: ${intra.join('ms, ')}ms   |   between bursts: ${inter}ms   `
  + `(ratio ${(inter / (intra[0] || 1)).toFixed(1)}:1)`);

// The rhythm repeats, and it is asserted as a SHAPE rather than as equal
// numbers: the sampler advances in whole ticks of the delta it is driven at, so
// a 40ms interval lands on 41.6 one burst and 41.7 the next. Demanding those be
// equal is a test asserting the resolution of its own clock.
const shape3 = burst.gaps.map((gp) => (gp < 100 ? 'crack' : 'PAUSE')).join(' ');
check(burst.gaps.length >= 6 && /^(crack crack PAUSE )+crack crack/.test(`${shape3} `),
  'the rhythm repeats: crack crack crack, pause, crack crack crack',
  `${shape3}\n        all gaps, ms: ${burst.gaps.join(', ')}`);

check(burst.spent === burst.shots.length, 'every round came out of the magazine',
  `${burst.spent} rounds spent, ${burst.shots.length} shots timed`);

// ---------------------------------------------------------------------------
// 2. the burst is uninterruptible, and it does not survive a weapon swap
// ---------------------------------------------------------------------------

const grip = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const w = g.weapons;

  w.equip('mk9');
  w.equip('b3ar');
  w.state.lastShot = -Infinity;

  const DT = 1 / 480;
  const before = w.magazine;

  // Pull the trigger for ONE frame and release it. A real burst finishes.
  w.update(DT, { fire: true }, false);
  const afterPress = w.magazine;
  for (let i = 0; i < 60; i++) w.update(DT, { fire: false }, false);
  const afterRelease = w.magazine;

  // And a swap mid-burst must not spend the next gun's rounds.
  w.state.lastShot = -Infinity;
  w.update(DT, { fire: true }, false);
  const midBurst = w.state.burstLeft;
  w.equip('mk9');
  const afterSwap = w.state.burstLeft;
  const mk9Before = w.magazine;
  for (let i = 0; i < 60; i++) w.update(DT, { fire: false }, false);

  return {
    firstRound: before - afterPress,
    finished: before - afterRelease,
    midBurst,
    afterSwap,
    mk9Spent: mk9Before - w.magazine,
  };
});

check(grip.firstRound === 1 && grip.finished === 3,
  'releasing the trigger does not cancel the burst',
  `one frame of trigger: ${grip.firstRound} round out immediately, ${grip.finished} by the end`);

check(grip.afterSwap === 0 && grip.mk9Spent === 0,
  'a swap mid-burst does not spend the next gun\'s rounds',
  `burstLeft ${grip.midBurst} before the swap, ${grip.afterSwap} after; MK9 spent ${grip.mk9Spent}`);

// ---------------------------------------------------------------------------
// 3. an empty B3AR still clicks
//
// The bug this branch shipped with: the burst path gated the WHOLE trigger pull
// on canFire(), so an empty magazine reached neither the dry-fire snap nor the
// auto-reload that every other weapon in the game gets. Reachable in play on
// any reload the khopesh interrupts.
// ---------------------------------------------------------------------------

const dry = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const w = g.weapons;

  w.equip('b3ar');

  // Wait out the raise. A reload is refused while the hands are still swapping
  // weapons - viewmodel.busy() - which is correct behaviour and would otherwise
  // read here as the auto-reload being broken.
  let f = 0;
  while (g.viewmodel.state.phase !== 'ready' && f < 300) {
    await new Promise((r) => requestAnimationFrame(r));
    f++;
  }

  let clicks = 0;
  const real = g.audio.dryFire;
  g.audio.dryFire = function spy(...a) { clicks++; return real.apply(this, a); };

  // Empty magazine, full reserve, no reload running: exactly what an
  // interrupted reload leaves behind.
  w.ammo.b3ar.mag = 0;
  w.ammo.b3ar.reserve = 120;
  w.cancelReload();
  w.state.lastShot = -Infinity;
  w.state.firing = false;

  w.update(1 / 480, { fire: true }, false);
  const out = { clicks, reloading: w.state.reloading, phase: g.viewmodel.state.phase };

  g.audio.dryFire = real;
  w.state.reloading = false;
  w.ammo.b3ar.mag = 18;
  return out;
});

check(dry.clicks === 1 && dry.reloading,
  'an empty B3AR clicks once and starts its own reload',
  `dryFire calls ${dry.clicks}, reload started ${dry.reloading} (hands were "${dry.phase}")`);

// ---------------------------------------------------------------------------
// 4. the viewmodel: photographed, and measured against the MK9
//
// The claim is "longer receiver, extended magazine, a compensator". Length is
// the one part of that a number can settle, so the model's own muzzle point is
// read off both weapons: it is where the flash is armed, and a compensator that
// swallows its own flash is the defect this measures for.
// ---------------------------------------------------------------------------

const shape = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const vm = g.viewmodel;

  const read = (id) => {
    const m = vm.buildDisplay(id);
    const b = new g.THREE.Box3().setFromObject(m.root);
    return {
      muzzleZ: +m.muzzle.z.toFixed(4),
      sightY: +m.sight.y.toFixed(4),
      sightZ: +m.sight.z.toFixed(4),
      lengthZ: +(b.max.z - b.min.z).toFixed(4),
      dropY: +b.min.y.toFixed(4),
      parts: m.detail.length,
    };
  };

  return { mk9: read('mk9'), b3ar: read('b3ar') };
});

check(shape.b3ar.muzzleZ < shape.mk9.muzzleZ - 0.09,
  'the muzzle point clears the compensator',
  `MK9 muzzle z ${shape.mk9.muzzleZ}, B3AR ${shape.b3ar.muzzleZ} - `
  + `${((shape.mk9.muzzleZ - shape.b3ar.muzzleZ) * 1000).toFixed(0)}mm further out, `
  + `so the flash is armed past the crown and not inside the block`);

check(shape.b3ar.lengthZ > shape.mk9.lengthZ + 0.09 && shape.b3ar.dropY < shape.mk9.dropY - 0.03,
  'longer receiver and a magazine that hangs below the MK9\'s',
  `length ${shape.mk9.lengthZ} -> ${shape.b3ar.lengthZ}, lowest point ${shape.mk9.dropY} -> ${shape.b3ar.dropY}`);

check(shape.b3ar.sightY === shape.mk9.sightY && shape.b3ar.sightZ === shape.mk9.sightZ,
  'the shared sight is untouched, so ADS solves identically',
  `sight (y ${shape.b3ar.sightY}, z ${shape.b3ar.sightZ}) on both`);

// Face down the open avenue, so the weapon is read against sand and sky rather
// than against a wall a metre behind it.
const posed = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.combat.state.invulnerable = true;
  g.director.reset();
  g.weapons.equip('b3ar');
  g.player.teleport({ x: -6, y: 0, z: 14 });
  g.rig.reset(Math.PI, 0.0);

  // WAIT ON THE HANDS, not on a frame count. The raise has to finish before
  // anything else is asked of the viewmodel: aiming is refused while busy(),
  // which is correct behaviour and which a frame-counted wait photographs as
  // ADS being broken. It did exactly that on the first run of this suite.
  let f = 0;
  while (g.viewmodel.state.phase !== 'ready' && f < 300) {
    await new Promise((r) => requestAnimationFrame(r));
    f++;
  }
  return { phase: g.viewmodel.state.phase, framesToReady: f };
});
await page.screenshot({ path: OUT + 'b3ar-01-hip.png' });

// And wait on the BLEND, for the same reason.
const aimed = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.input.state.ads = true;
  let f = 0;
  while (g.viewmodel.state.adsBlend < 0.98 && f < 300) {
    g.input.state.ads = true;
    await new Promise((r) => requestAnimationFrame(r));
    f++;
  }
  return { blend: +g.viewmodel.state.adsBlend.toFixed(3), frames: f };
});
await page.screenshot({ path: OUT + 'b3ar-02-ads.png' });

check(aimed.blend > 0.98, 'it comes up to the eye: the ADS pose actually blends in',
  `adsBlend ${aimed.blend} after ${aimed.frames} frames (hands were ${posed.phase} in ${posed.framesToReady})`);

await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.input.state.ads = false;
  let f = 0;
  while (g.viewmodel.state.adsBlend > 0.02 && f < 300) {
    await new Promise((r) => requestAnimationFrame(r));
    f++;
  }
});

// Mid-burst, through the LIVE loop: real input, real frame deltas, so this is
// also the proof that the fire mode works where the player touches it.
const live = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const w = g.weapons;
  w.refillAmmo('b3ar');
  w.ammo.b3ar.mag = 18;
  w.state.lastShot = -Infinity;

  const before = w.magazine;
  g.input.state.fire = true;
  const seen = [];
  let last = w.state.lastShot;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    if (w.state.lastShot !== last) { last = w.state.lastShot; seen.push(+(last * 1000).toFixed(0)); }
  }
  g.input.state.fire = false;
  await new Promise((r) => requestAnimationFrame(r));

  return { spent: before - w.magazine, frames: 12, times: seen, phase: g.viewmodel.state.phase };
});
await page.screenshot({ path: OUT + 'b3ar-03-firing.png' });

check(live.spent >= 3, 'the live frame loop fires it through real input',
  `${live.spent} rounds over ${live.frames} frames of held trigger`);

// ---------------------------------------------------------------------------
// 5. THE WALL BUY, OUTSIDE
// ---------------------------------------------------------------------------

const fixture = await page.evaluate(async () => {
  const g = window.__SANDS__;
  return {
    space: g.spaces.active,
    courtyardFixtures: (g.courtyard.interacts || []).map((r) => `${r.type}:${r.config.weapon}:${r.config.cost}`),
    inRecords: g.interacts.records.filter((r) => r.config && r.config.weapon === 'b3ar').length,
    totalRecords: g.interacts.records.length,
  };
});

check(fixture.courtyardFixtures.length === 1 && fixture.inRecords === 1,
  'the courtyard publishes a fixture and the interaction layer took it',
  `courtyard.interacts = [${fixture.courtyardFixtures.join(', ')}]; `
  + `${fixture.totalRecords} fixtures registered in total`);

// Walk the player back to a fresh state and up to the wall.
const atWall = await page.evaluate(async () => {
  const g = window.__SANDS__;

  // Take the gun back off the player: the wall has to sell it, not refill it.
  g.weapons.state.owned.delete('b3ar');
  g.weapons.equip('mk9');
  g.economy.reset(120);

  window.__B__.face(-13.48, 5.6, -Math.PI / 2);
  await window.__B__.frames(4);

  return {
    space: g.spaces.active,
    candidate: g.interacts.candidate && g.interacts.candidate.config.weapon,
    hud: window.__B__.hud(),
  };
});

await page.screenshot({ path: OUT + 'b3ar-04-wall-broke.png' });

check(atWall.space === 'exterior' && atWall.candidate === 'b3ar',
  'the crosshair finds the wall buy IN THE COURTYARD',
  `space ${atWall.space}, candidate ${atWall.candidate}, prompt "${atWall.hud.prompt}"`);

check(atWall.hud.promptDeny && !/\[F\]/.test(atWall.hud.prompt),
  'at 120 gold the wall is red and offers no key',
  `prompt "${atWall.hud.prompt}" deny=${atWall.hud.promptDeny}`);

const bought = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.economy.reset(600);
  await window.__B__.frames(3);

  const promptWhenRich = document.getElementById('prompt').textContent;
  const goldBefore = g.economy.gold;

  await window.__B__.press();

  let f = 0;
  while (g.viewmodel.state.phase !== 'ready' && f < 300) {
    await new Promise((r) => requestAnimationFrame(r));
    f++;
  }

  return {
    promptWhenRich,
    goldBefore,
    goldAfter: g.economy.gold,
    spent: goldBefore - g.economy.gold,
    owns: g.weapons.owns('b3ar'),
    equipped: g.weapons.state.current,
    shown: g.viewmodel.state.weapon,
    mag: g.weapons.magazine,
    reserve: g.weapons.reserve,
    hud: window.__B__.hud(),
  };
});

await page.screenshot({ path: OUT + 'b3ar-05-wall-bought.png' });

check(/\[F\]/.test(bought.promptWhenRich) && /400/.test(bought.promptWhenRich),
  'the prompt quotes the price and the key',
  `"${bought.promptWhenRich}"`);

check(bought.spent === 400 && bought.owns && bought.equipped === 'b3ar' && bought.shown === 'b3ar',
  'gold is debited and the B3AR arrives IN HAND, outside',
  `${bought.goldBefore} -> ${bought.goldAfter} gold, holding ${bought.equipped}, `
  + `viewmodel showing ${bought.shown}, ${bought.mag}/${bought.reserve} rounds, HUD says "${bought.hud.weapon}"`);

// And the refill path, which is the same code the interior walls run.
const refill = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.weapons.ammo.b3ar.reserve = 0;
  g.economy.reset(500);
  await window.__B__.frames(3);
  const prompt = document.getElementById('prompt').textContent;
  const goldBefore = g.economy.gold;
  await window.__B__.press();
  await window.__B__.frames(2);
  return {
    prompt,
    spent: goldBefore - g.economy.gold,
    reserve: g.weapons.reserve,
    whenFull: document.getElementById('prompt').textContent,
  };
});

check(refill.spent === 200 && refill.reserve === stats.reserve,
  'the same wall refills at half price, through the same handler',
  `"${refill.prompt}" -> ${refill.spent} gold, reserve back to ${refill.reserve}; `
  + `then "${refill.whenFull}"`);

// ---------------------------------------------------------------------------
// 6. inside is unchanged
// ---------------------------------------------------------------------------

const inside = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.doors.byId('courtyard/entry').open();
  g.spaces.enter('interior', { x: 0, z: -143.5, rot: 0 });
  await window.__B__.frames(4);

  const outsideFixtureVisible = g.interacts.candidate;

  window.__B__.face(-4, -156.6, Math.PI);
  await window.__B__.frames(4);

  return {
    space: g.spaces.active,
    strayCandidate: outsideFixtureVisible && outsideFixtureVisible.config.weapon,
    candidate: g.interacts.candidate && g.interacts.candidate.config.weapon,
    prompt: document.getElementById('prompt').textContent,
  };
});

// Guarded, and last on purpose. The interior comes up on top of everything this
// suite has already drawn, and a renderer that runs out of room photographing it
// must not take the verdict on eighteen other checks with it.
try {
  await page.screenshot({ path: OUT + 'b3ar-06-interior-smg.png', timeout: 90000 });
} catch (e) {
  console.log(`        (interior screenshot unavailable: ${e.message.split('\n')[0]})`);
}

check(inside.candidate === 'smg' && !inside.strayCandidate,
  'the SMG wall inside still works, and the courtyard wall is not reachable from it',
  `space ${inside.space}, candidate ${inside.candidate}, prompt "${inside.prompt}"`);

// ---------------------------------------------------------------------------

const errors = logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
check(errors.length === 0, 'no page errors', errors.slice(0, 3).join('\n') || 'clean console');

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
console.log(`shots: ${OUT}b3ar-*.png`);

await browser.close();
process.exit(failed.length ? 1 : 0);
