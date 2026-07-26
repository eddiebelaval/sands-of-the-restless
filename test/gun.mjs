/**
 * Combat harness.
 *
 * Verifies the gun is actually in the player's hands and doing something:
 * the viewmodel renders, rounds leave the magazine, hitscan connects with the
 * world, reload returns ammunition, ADS changes the pose, and nothing leaks
 * across a few hundred shots.
 *
 * Screenshots let the weapon be judged by eye; the probe numbers stop a
 * good-looking screenshot from hiding a gun that fires blanks.
 */

import { chromium } from '/Users/eddiebelaval/Development/.worktrees/parallax-hotfix-realtime/node_modules/playwright/index.mjs';
import { resolveChrome } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const CHROME = resolveChrome();

const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
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
await page.waitForTimeout(1600);

await page.screenshot({ path: OUT + 'gun-01-hip.png' });

// --- aim down sights -------------------------------------------------------
await page.evaluate(() => { window.__SANDS__.input.state.ads = true; });
await page.waitForTimeout(900);
await page.screenshot({ path: OUT + 'gun-02-ads.png' });
await page.evaluate(() => { window.__SANDS__.input.state.ads = false; });
await page.waitForTimeout(700);

// --- fire ------------------------------------------------------------------
const firing = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const w = g.weapons;

  const magBefore = w.magazine;
  const childrenBefore = g.scene.children.length;

  // Drive the weapon directly so the result does not depend on pointer lock.
  let hitCount = 0;
  for (let i = 0; i < 8; i++) {
    const hits = w.fire(false);
    if (hits) hitCount += hits.length;
    // Respect the rate limiter by advancing its clock the way the loop does.
    w.update(0.25, { fire: false }, false);
    await new Promise((r) => requestAnimationFrame(r));
  }

  return {
    weapon: w.state.current,
    magBefore,
    magAfter: w.magazine,
    roundsSpent: magBefore - w.magazine,
    hitsRegistered: hitCount,
    sceneChildrenDelta: g.scene.children.length - childrenBefore,
  };
});

await page.waitForTimeout(300);
await page.screenshot({ path: OUT + 'gun-03-fired.png' });

// --- reload ----------------------------------------------------------------
const reloading = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const w = g.weapons;

  const magBefore = w.magazine;
  const reserveBefore = w.reserve;
  const started = w.reload();

  // Wait in FRAMES, not wall-clock milliseconds.
  //
  // Every system clamps its delta to 1/20s so a stalled tab cannot teleport the
  // player. Under software rendering a frame takes ~300ms of real time but only
  // ever advances the simulation by 50ms, so simulated time runs roughly six
  // times slower than the wall clock. A wall-clock timeout here fails a reload
  // that is working perfectly, which is a harness bug that reads as a game bug.
  let frames = 0;
  while (w.isReloading && frames < 400) {
    await new Promise((r) => requestAnimationFrame(r));
    frames++;
  }

  return {
    started,
    magBefore,
    magAfter: w.magazine,
    reserveBefore,
    reserveAfter: w.reserve,
    conserved: (w.magazine + w.reserve) === (magBefore + reserveBefore),
    stillReloading: w.isReloading,
    framesWaited: frames,
  };
});

// --- every weapon renders --------------------------------------------------
const perWeapon = [];
for (const id of ['mk9', 'smg', 'shotgun', 'carbine', 'lmg', 'bolt', 'sunspear']) {
  // Equip, then wait in FRAMES for the lower/raise swap to actually finish.
  // A wall-clock wait photographs the weapon mid-stroke, still below frame,
  // and looks exactly like a weapon that failed to render.
  const info = await page.evaluate(async (wid) => {
    const g = window.__SANDS__;
    g.weapons.equip(wid);

    let frames = 0;
    while (g.viewmodel.state.phase !== 'ready' && frames < 200) {
      await new Promise((r) => requestAnimationFrame(r));
      frames++;
    }

    return {
      id: wid,
      equipped: g.weapons.state.current,
      shown: g.viewmodel.state.weapon,
      phase: g.viewmodel.state.phase,
      frames,
    };
  }, id);

  await page.screenshot({ path: `${OUT}gun-w-${id}.png` });
  perWeapon.push(info);
}

// --- leak check across sustained automatic fire ----------------------------
await page.evaluate(() => window.__SANDS__.weapons.equip('carbine'));
await page.waitForTimeout(600);

const leak = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const w = g.weapons;
  const before = g.scene.children.length;
  const vmBefore = g.viewmodel.scene.children.length;

  for (let i = 0; i < 240; i++) {
    w.state.lastShot = -Infinity;      // bypass the rate limiter for the stress
    w.ammo.carbine.mag = 30;
    w.fire(false);
    if (i % 20 === 0) await new Promise((r) => requestAnimationFrame(r));
  }
  await new Promise((r) => setTimeout(r, 500));

  return {
    shots: 240,
    sceneChildrenDelta: g.scene.children.length - before,
    viewmodelChildrenDelta: g.viewmodel.scene.children.length - vmBefore,
    audioVoices: g.audio.stats().voices,
    audioCap: g.audio.stats().cap,
  };
});

// --- render sanity ---------------------------------------------------------
const render = await page.evaluate(() => {
  const g = window.__SANDS__;
  return {
    viewmodelInScene: !!g.viewmodel.group.parent,
    viewmodelChildren: g.viewmodel.group.children.length,
    impactsInScene: !!g.impacts.mesh.parent,
    audioState: g.audio.stats().state,
    audioSpace: g.audio.stats().space,
  };
});

await browser.close();

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));

console.log('--- firing ---');       console.log(JSON.stringify(firing, null, 2));
console.log('--- reload ---');       console.log(JSON.stringify(reloading, null, 2));
console.log('--- per weapon ---');
for (const w of perWeapon) {
  console.log(`  ${w.id.padEnd(9)} shown=${String(w.shown).padEnd(9)} phase=${String(w.phase).padEnd(9)} frames=${w.frames}`);
}
console.log('--- leak ---');         console.log(JSON.stringify(leak, null, 2));
console.log('--- render ---');       console.log(JSON.stringify(render, null, 2));

if (errors.length) {
  console.log('--- errors ---');
  for (const e of errors) console.log(e);
}

// Explicit pass conditions, so a green run means something specific.
const checks = {
  'rounds left the magazine':      firing.roundsSpent === 8,
  'hitscan connected with world':  firing.hitsRegistered > 0,
  'nothing added to scene firing': firing.sceneChildrenDelta === 0,
  'reload started':                reloading.started === true,
  'reload completed':              reloading.stillReloading === false,
  'reload refilled magazine':      reloading.magAfter > reloading.magBefore,
  'ammo conserved':                reloading.conserved === true,
  'all 7 weapons equipped':        perWeapon.every((w, i) =>
    w.equipped === ['mk9','smg','shotgun','carbine','lmg','bolt','sunspear'][i]),
  'all 7 weapons reached ready':   perWeapon.every((w) => w.phase === 'ready' && w.shown === w.id),
  'no scene leak over 240 shots':  leak.sceneChildrenDelta === 0,
  'no viewmodel leak':             leak.viewmodelChildrenDelta === 0,
  'audio within voice cap':        leak.audioVoices <= leak.audioCap,
  'viewmodel is mounted':          render.viewmodelInScene === true,
  'viewmodel has geometry':        render.viewmodelChildren > 0,
  'impacts are mounted':           render.impactsInScene === true,
  'audio context running':         render.audioState === 'running',
  'no console errors':             errors.length === 0,
};

console.log('\n--- checks ---');
let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

console.log(`\nshots -> ${OUT}`);
console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
