/**
 * THROWAWAY PROBE: does a god that spawns far away actually WALK?
 *
 * `test/enemies.mjs` "the boss reaches the player" is flaky on a quiet machine:
 * three runs, spawn distances 7.7 / 14.3 / 21.2 m, closest approaches 3.1 /
 * 13.9 / 14.0 m. The spawn point is one of 48 chosen at random, so the check
 * passes when the boss happens to start near.
 *
 * TWO CANDIDATE CAUSES, and this file exists only to tell them apart:
 *
 *   (a) THE ASSERTION IS NONDETERMINISTIC BY CONSTRUCTION. A god charges,
 *       recovers and volleys - it is not a melee chaser - so 40 s is simply not
 *       enough to close 14 m and the check is asking for luck.
 *
 *   (b) A FAR SPAWN STALLS. Run 2 closed 0.4 m in 40 s. That is 1 cm/s. No
 *       standoff behaviour looks like that.
 *
 * The discriminator is the distance TRACE, not the endpoint: (a) predicts the
 * gap opening and closing as it charges and withdraws; (b) predicts a flat line.
 *
 * Prefixed `_` because it answers one question and is then rubbish.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS, dismissBriefing, waitForWorld } from './chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4188/index.html';

const browser = await chromium.launch({ executablePath: resolveChrome(), args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start());
await dismissBriefing(page);
await waitForWorld(page);
const OPEN = process.argv.includes('--open') ? 1 : 0;
await page.evaluate((v) => { window.__OPEN__ = v; }, OPEN);
console.log(OPEN ? 'PLAYER ON OPEN SAND (0,-8)' : 'PLAYER AT THE SPAWN (0,30)');

for (let attempt = 0; attempt < 6; attempt++) {
  const r = await page.evaluate(async () => {
    const g = window.__SANDS__;
    const d = g.director;

    const sim = (seconds, dt = 1 / 30) => {
      const n = Math.ceil(seconds / dt);
      for (let i = 0; i < n; i++) { d.update(dt, i * dt); g.combat.update(dt); }
    };

    d.reset();
    // THE THIRD CANDIDATE: the camp. (0,30) is the SPAWN, and the spawn is
    // ringed with tents, crates and an instrument array. A god is a wide body.
    // If 14 m is the radius of the clutter rather than a behaviour, moving the
    // player to open sand makes it close. Set OPEN=0 to go back to the spawn.
    const OPEN = Number(window.__OPEN__ || 0);
    g.player.teleport(OPEN ? { x: 0, y: 0, z: -8 } : { x: 0, y: 0, z: 30 });
    for (let i = 0; i < 220; i++) {
      g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
      if (g.player.state.grounded) break;
    }
    d.forceWave(5);

    let t = 0;
    while (!d.boss && t < 12) { sim(0.25); t += 0.25; }
    if (!d.boss) return null;

    const boss = d.boss;
    const dist = () => Math.hypot(boss.position.x - g.player.position.x,
                                  boss.position.z - g.player.position.z);

    // The trace: distance every 4 s of sim, ten samples, plus total path walked.
    const trace = [];
    let walked = 0;
    let px = boss.position.x, pz = boss.position.z;
    for (let k = 0; k < 10; k++) {
      sim(4);
      walked += Math.hypot(boss.position.x - px, boss.position.z - pz);
      px = boss.position.x; pz = boss.position.z;
      trace.push(+dist().toFixed(1));
    }

    return {
      variant: boss.variant,
      spawn: +trace.length ? null : null,
      start: +dist().toFixed(1),
      trace,
      // Total ground covered vs net closing. A stalled body walks ~0. A body
      // that circles or withdraws walks a lot and closes little.
      walked: +walked.toFixed(1),
      closest: Math.min(...trace),
      ability: boss.ability || null,
      // Is it even trying? Whatever the actor exposes about its intent.
      state: boss.state ? String(boss.state) : null,
      speed: boss.speed === undefined ? null : boss.speed,
    };
  });

  if (!r) { console.log(`attempt ${attempt}: no boss`); continue; }
  console.log(`attempt ${attempt}  ${r.variant}  start ${r.start} m  closest ${r.closest} m`);
  console.log(`   trace   ${r.trace.join('  ')}`);
  console.log(`   walked  ${r.walked} m of ground over 40 s   speed ${r.speed}   state ${r.state}`);
}

await browser.close();
