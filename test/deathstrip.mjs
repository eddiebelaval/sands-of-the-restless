/**
 * FRAME STRIP for the death sequence. Not a suite - an eye.
 *
 * A sequence cannot be judged from one still, so this walks the whole arc and
 * writes a numbered PNG at every beat: alive, the killing hit, the camera
 * falling at three points, the card, the gate arming, and the frame after the
 * reset. It also reports the runtime numbers on both sides of the reset.
 *
 * Usage: node test/deathstrip.mjs [baseUrl] [outDirName]
 */

import { chromium } from 'playwright';
import { resolveChrome, dismissBriefing } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:4591/index.html';
const DIR = process.argv[3] || 'death';
const SLOW = process.argv.includes('--slow');      // simulate 50ms frames
const OUT = new URL(`../shots/${DIR}/`, import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.setDefaultTimeout(180000);
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
// BEGIN raises the briefing card now; the world is held behind it. See chrome.mjs.
await dismissBriefing(page);
await page.waitForTimeout(1800);

let n = 0;
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}${String(++n).padStart(2, '0')}-${name}.png`, timeout: 180000 });
};

/** Wait until the death sequence has run for at least `t` seconds of SIM time. */
const holdSim = (t) => page.evaluate(async (target) => {
  const g = window.__SANDS__;
  const t0 = g.death.state.t;
  for (let i = 0; i < 600; i++) {
    if (g.death.state.t - t0 >= target) return true;
    if (g.death.phase === 'none') return 'ended';
    await new Promise((r) => requestAnimationFrame(r));
  }
  return 'timeout';
}, t);

// ---------------------------------------------------------------------------
// Stage the fight: a wave of shamblers around the player, so the killing blow
// is a real strike from a real enemy rather than a poked number.
// ---------------------------------------------------------------------------
await page.evaluate(() => {
  const g = window.__SANDS__;
  g.economy.grant(1240, 'strip');
  g.director.forceWave(7);
  for (let i = 0; i < 5; i++) {
    g.director.placeAt('shambler',
      g.player.position.x + Math.cos(i * 1.4) * 3.2,
      g.player.position.z + Math.sin(i * 1.4) * 3.2);
  }
});
await page.waitForTimeout(900);
await shot('alive');

const before = await page.evaluate(() => {
  const g = window.__SANDS__;
  return {
    liveEnemies: g.director.live.length,
    wave: g.director.state.wave,
    gold: g.economy.gold,
    health: Math.round(g.player.state.health),
    groundDrops: g.powerups.liveDrops().length,
    activeEffects: g.powerups.active().length,
    weaponsHeld: g.weapons.state.owned.size,
    current: g.weapons.state.current,
    magazine: g.weapons.magazine,
    downs: g.combat.state.downs,
    altarPhase: g.altar.state.phase,
  };
});

// A power-up on the ground and an effect running, so the reset has something to
// prove it swept. And a boon, which main.js drops off the downs counter.
await page.evaluate(() => {
  const g = window.__SANDS__;
  g.powerups.placeAt('seconddeath', g.player.position.x + 2, g.player.position.z + 2);
  g.powerups.placeAt('maat', g.player.position.x - 2, g.player.position.z + 2);
  
});
await page.waitForTimeout(300);

const staged = await page.evaluate(() => {
  const g = window.__SANDS__;
  return { groundDrops: g.powerups.liveDrops().length };
});

// ---------------------------------------------------------------------------
// The hit that kills. Driven through the real damage path.
//
// The confirm key is HELD DOWN before the blow lands and never released, which
// is the case the gate has to refuse: a finger already on the key when the body
// hits the sand must not restart the run.
// ---------------------------------------------------------------------------
await page.evaluate(() => {
  const g = window.__SANDS__;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
  g.player.state.health = 12;
  g.combat.damagePlayer(40, g.player.position.x + 1, g.player.position.z + 1);
});
await page.waitForTimeout(70);
await shot('killed');

if (SLOW) {
  // Choke the machine so frames land near or past MAX_DELTA. The claim under
  // test is that the arc still reads rather than skipping.
  await page.evaluate(() => {
    window.__CHOKE__ = setInterval(() => {
      const end = performance.now() + 48;
      while (performance.now() < end) { /* burn */ }
    }, 4);
  });
}

// The fall, captured as a BURST with the pose measured at each frame rather
// than gated on a clock. A screenshot under swiftshader costs the better part of
// a second of wall time, so any "wait 0.2s then shoot" strip is really shooting
// wherever the sequence happened to be - which is how you end up believing a
// still shows the start of an arc when it shows the end of one. Each file is
// named with the camera's actual eased progress at the moment of capture.
const fall = [];
for (let i = 0; i < 5; i++) {
  const p = await page.evaluate(() => {
    const g = window.__SANDS__;
    return {
      progress: +(g.rig.deathProgress).toFixed(3),
      dying: g.rig.dying,
      roll: +g.camera.rotation.z.toFixed(3),
      eyeY: +g.camera.position.y.toFixed(3),
      vmCamY: +g.viewmodel.camera.position.y.toFixed(3),
      fov: +g.camera.fov.toFixed(1),
      phase: g.death.phase,
      simT: +g.death.state.t.toFixed(3),
    };
  });
  fall.push(p);
  await shot(`fall-p${String(Math.round(p.progress * 100)).padStart(3, '0')}`);
}

// The card.
await page.evaluate(async () => {
  const g = window.__SANDS__;
  for (let i = 0; i < 600 && g.death.phase !== 'waiting'; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
});
await page.waitForTimeout(120);
await shot('card');

const atCard = await page.evaluate(() => {
  const g = window.__SANDS__;
  const s = g.death.stats();
  return {
    phase: g.death.phase, armed: g.death.armed, verdict: g.death.verdict,
    shown: s.shown, wordBox: s.wordBox,
    cardRect: (() => {
      const r = document.querySelector('.death-cartouche').getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })(),
    btnVisible: getComputedStyle(document.getElementById('death-confirm')).visibility,
  };
});

// ---------------------------------------------------------------------------
// THE WORLD MUST BE QUIET WHILE IT WAITS. Hold it and watch the numbers.
// ---------------------------------------------------------------------------
const quiet = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const snap = () => ({
    live: g.director.live.length,
    wave: g.director.state.wave,
    phase: g.director.state.phase,
    timer: +g.director.state.timer.toFixed(3),
    health: +g.player.state.health.toFixed(3),
    px: +g.player.position.x.toFixed(3),
    pz: +g.player.position.z.toFixed(3),
    killed: g.director.state.killed,
    gold: g.economy.gold,
    grenadeCook: +(g.grenades.cook || 0).toFixed(3),
    elapsed: +g.elapsed.toFixed(2),
    simT: +g.death.state.t.toFixed(2),
  });

  const a = snap();
  const t0 = g.death.state.t;
  let frames = 0;
  // Four seconds of SIMULATION time held on the card. Mash fire, reload,
  // sprint and jump the whole way through: none of it may restart the run.
  while (g.death.state.t - t0 < 4.0 && frames < 3000) {
    frames++;
    for (const code of ['KeyR', 'Space', 'ShiftLeft', 'KeyF', 'KeyW']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    }
    window.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    await new Promise((r) => requestAnimationFrame(r));
  }
  const b = snap();
  return { a, b, frames, stillWaiting: g.death.phase === 'waiting' };
});

await shot('waiting-4s');

// The key held since before the death keeps repeating. It must not fire.
const heldEnter = await page.evaluate(async () => {
  const g = window.__SANDS__;
  for (let i = 0; i < 40; i++) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', repeat: true, bubbles: true }));
    await new Promise((r) => requestAnimationFrame(r));
  }
  // And a NON-repeat keydown, still without ever having released it: an
  // autorepeat that the platform did not flag is the same held finger.
  window.dispatchEvent(new KeyboardEvent('Enter' && 'keydown', { code: 'Enter', bubbles: true }));
  await new Promise((r) => requestAnimationFrame(r));
  const heldStill = g.death.phase;

  // Release, then a fresh press. THIS is the deliberate input, and it restarts.
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Enter', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
  for (let i = 0; i < 60 && g.death.phase !== 'none'; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  return { heldStill, afterFreshPress: g.death.phase, resets: g.death.state.resets };
});

if (SLOW) await page.evaluate(() => clearInterval(window.__CHOKE__));
await page.waitForTimeout(140);
await shot('reset');

const after = await page.evaluate(() => {
  const g = window.__SANDS__;
  return {
    liveEnemies: g.director.live.length,
    wave: g.director.state.wave,
    gold: g.economy.gold,
    health: Math.round(g.player.state.health),
    groundDrops: g.powerups.liveDrops().length,
    activeEffects: g.powerups.active().length,
    boons: g.shrines.count,
    weaponsHeld: g.weapons.state.owned.size,
    current: g.weapons.state.current,
    magazine: g.weapons.magazine,
    downs: g.combat.state.downs,
    altarPhase: g.altar.state.phase,
    wash: +g.combat.state.wash.toFixed(3),
    cameraRoll: +g.camera.rotation.z.toFixed(4),
    cameraY: +g.camera.position.y.toFixed(3),
    vmCamY: +g.viewmodel.camera.position.y.toFixed(3),
    cardShown: g.death.stats().shown,
    resets: g.death.state.resets,
  };
});

await page.waitForTimeout(1200);
await shot('running-again');

const runningAgain = await page.evaluate(() => {
  const g = window.__SANDS__;
  return { wave: g.director.state.wave, phase: g.director.state.phase, live: g.director.live.length };
});

// ---------------------------------------------------------------------------
// SECOND DEATH: the harness path. Confirm by clicking the button by id, the
// way every suite in this project clicks `#begin`.
// ---------------------------------------------------------------------------
const byButton = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.player.state.health = 5;
  g.combat.damagePlayer(60, g.player.position.x, g.player.position.z);
  for (let i = 0; i < 900 && g.death.phase !== 'waiting'; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  const waited = g.death.phase;
  // The card must be up and the fall over before the button is worth clicking.
  const shown = g.death.stats().shown;
  document.getElementById('death-confirm').click();
  for (let i = 0; i < 240 && g.death.phase !== 'none'; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  return {
    reachedWaiting: waited, cardShown: shown,
    phaseAfterClick: g.death.phase, resets: g.death.state.resets,
    health: Math.round(g.player.state.health), wave: g.director.state.wave,
  };
});
await page.waitForTimeout(200);
await shot('button-reset');

console.log(JSON.stringify({
  before, staged, fall, atCard, quiet, heldEnter, after, runningAgain, byButton,
  errors: logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]')),
}, null, 2));
console.log('\nstrip -> ' + OUT);

await browser.close();
