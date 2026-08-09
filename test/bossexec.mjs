/**
 * A GOD CANNOT BE DELETED IN ONE BLOW.
 *
 * Reported by the owner, playing, on 2026-08-08: "the one shot kill should
 * never work on the bosses. I'm able to kill the bosses on one shot."
 *
 * There were two holes and they were separate, so this suite tests both and
 * keeps them apart:
 *
 *   `state.instaKill` in systems/damage.js set damage to the target's full
 *   remaining health at all three entry points - bullets, blasts and the blade -
 *   and short-circuited the headshot rule that already knew better.
 *
 *   `detonate()` in systems/powerups.js built every nuke record with the
 *   actor's full health, boss included.
 *
 * ---------------------------------------------------------------------------
 * THE CONTROLS ARE THE ENTIRE VALUE OF THIS FILE
 * ---------------------------------------------------------------------------
 *
 * "The boss survived" is trivially satisfiable by a build where the damage
 * never landed at all, where the power-up never switched on, or where the boss
 * was never really the boss. A suite that only asserts survival would go green
 * on all three and this project has shipped that mistake four times this month.
 *
 * So every check that says a god SURVIVES is paired, in the same run, with:
 *   - a NON-BOSS actor taking the identical treatment and dying, which proves
 *     the mechanism is armed and the damage is arriving;
 *   - a measurement that the boss's health actually MOVED, which separates
 *     "correctly refused the shortcut" from "the shot missed entirely".
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start());
await page.waitForTimeout(800);

/**
 * Put a god on the field and hand back a live handle to it plus one ordinary
 * actor, which is the control subject for every case below.
 */
async function stage(wave) {
  return page.evaluate((w) => {
    const g = window.__SANDS__;
    g.director.forceWave(w);
    for (let i = 0; i < 90; i++) g.director.update(1 / 30, i / 30);

    const boss = g.director.boss;
    const mook = (g.director.live || []).find((a) => a && a.live && !a.dying && a !== boss);
    return {
      hasBoss: !!boss,
      hasMook: !!mook,
      bossHealth: boss ? boss.health : 0,
      bossMax: boss ? (boss.maxHealth || boss.health) : 0,
      mookHealth: mook ? mook.health : 0,
      wave: g.director.state.wave,
    };
  }, wave);
}

console.log('');
console.log('=== INSTA-KILL, THE THREE DOORS ===');
console.log('');

for (const door of ['bullet', 'blast', 'blade']) {
  const r = await page.evaluate((which) => {
    const g = window.__SANDS__;
    g.director.forceWave(25);
    for (let i = 0; i < 90; i++) g.director.update(1 / 30, i / 30);

    const boss = g.director.boss;
    const mook = (g.director.live || []).find((a) => a && a.live && !a.dying && a !== boss);
    if (!boss || !mook) return { staged: false };

    // Arm the power-up through the same flag the pickup sets.
    g.combat.state.instaKill = true;

    const b0 = boss.health, m0 = mook.health;

    const hit = (enemy, region) => {
      if (which === 'bullet') {
        const recs = [{ enemy, weapon: 'mk9', region, point: null, killed: false }];
        g.combat.applyHits(recs);
        return recs[0].killed;
      }
      if (which === 'blast') {
        const recs = [{ enemy, damage: 50, region, dirX: 1, dirZ: 0, killed: false }];
        g.combat.applyBlast(recs, 1);
        return recs[0].killed;
      }
      // A point is passed because the real caller passes one: systems/melee.js
      // sets record.point beside record.enemy on every landed swing. A record
      // without it is not a swing this game can produce.
      const p = { x: enemy.position.x, y: enemy.position.y + 1, z: enemy.position.z };
      const recs = [{ enemy, damage: 50, point: p, killed: false }];
      g.combat.applyMelee(recs, 1);
      return recs[0].killed;
    };

    // THE CONTROL FIRST, so a mechanism that is not armed fails loudly before
    // the boss assertion has a chance to pass for the wrong reason.
    const mookKilled = hit(mook, 'body');
    const bossKilled = hit(boss, 'body');

    const out = {
      staged: true,
      mookKilled, bossKilled,
      mookHealth0: m0,
      bossHealth0: b0,
      bossHealth1: boss.health,
      bossMax: boss.maxHealth || b0,
      bossLive: !!boss.live && !boss.dying,
    };
    g.combat.state.instaKill = false;
    return out;
  }, door);

  if (!r.staged) { ok(false, `${door}: could not stage a god and a control actor`); continue; }

  const took = r.bossHealth0 - r.bossHealth1;
  console.log(`  ${door.padEnd(7)} control mook ${r.mookHealth0} hp -> killed ${r.mookKilled}`);
  console.log(`  ${door.padEnd(7)} god ${r.bossHealth0} -> ${r.bossHealth1}  (took ${Math.round(took)})`);

  ok(r.mookKilled === true,
    `CONTROL ${door}: insta-kill DOES delete an ordinary actor (mechanism armed)`);
  ok(r.bossKilled === false, `${door}: and does NOT delete the god`);
  ok(r.bossLive === true, `${door}: the god is still standing`);
  ok(took > 0,
    `CONTROL ${door}: the god still took real damage (${Math.round(took)}), so this is a refused shortcut and not a missed shot`);
  ok(took < r.bossMax * 0.5,
    `${door}: and nowhere near a health bar (${Math.round(took)} of ${r.bossMax})`);
}

console.log('');
console.log('=== THE SECOND DEATH ===');
console.log('');

{
  const r = await page.evaluate(() => {
    const g = window.__SANDS__;
    g.director.forceWave(25);
    for (let i = 0; i < 90; i++) g.director.update(1 / 30, i / 30);

    const boss = g.director.boss;
    if (!boss) return { staged: false };
    const before = (g.director.live || []).filter((a) => a && a.live && !a.dying).length;
    const b0 = boss.health;
    const bMax = boss.maxHealth || b0;

    g.powerups.detonate();

    const after = (g.director.live || []).filter((a) => a && a.live && !a.dying).length;
    return {
      staged: true, before, after,
      bossHealth0: b0, bossHealth1: boss.health, bossMax: bMax,
      bossLive: !!boss.live && !boss.dying,
    };
  });

  if (!r.staged) {
    ok(false, 'could not stage a god for the nuke');
  } else {
    const took = r.bossHealth0 - r.bossHealth1;
    const frac = took / r.bossMax;
    console.log(`  field ${r.before} live -> ${r.after} live`);
    console.log(`  god   ${r.bossHealth0} -> ${r.bossHealth1}  (took ${Math.round(took)}, ${(frac * 100).toFixed(1)}% of max)`);
    console.log('');

    ok(r.before > 1, `CONTROL: there was a field to clear (${r.before} live)`);
    ok(r.after < r.before,
      `CONTROL: the nuke DID clear the field (${r.before} -> ${r.after}), so it is armed`);
    ok(r.bossLive === true, 'THE GOD KEEPS WALKING');
    ok(took > 0, `CONTROL: and was still bitten (${Math.round(took)}), not skipped`);
    ok(frac > 0.05 && frac < 0.25,
      `the bite is bounded and worth having (${(frac * 100).toFixed(1)}% of max health)`);
  }
}

console.log('');
console.log('=== THE RULE IS IDENTITY, NOT HEALTH ===');
console.log('');

// Anubis arrives on wave 5 INSIDE the headshot-lethal window, which is the case
// the original headLethal exemption was written for. If the new predicate were
// written as "anything over N hit points" instead of "is the boss", a retuned
// Easy tier would silently reopen the hole here first.
{
  const r = await page.evaluate(() => {
    const g = window.__SANDS__;
    g.director.forceWave(5);
    for (let i = 0; i < 90; i++) g.director.update(1 / 30, i / 30);
    const boss = g.director.boss;
    const mook = (g.director.live || []).find((a) => a && a.live && !a.dying && a !== boss);
    if (!boss || !mook) return { staged: false };

    const mookRec = [{ enemy: mook, weapon: 'mk9', region: 'head', point: null, killed: false }];
    g.combat.applyHits(mookRec);

    const b0 = boss.health;
    const bossRec = [{ enemy: boss, weapon: 'mk9', region: 'head', point: null, killed: false }];
    g.combat.applyHits(bossRec);

    return {
      staged: true,
      wave: g.director.state.wave,
      mookKilled: mookRec[0].killed,
      bossKilled: bossRec[0].killed,
      bossTook: b0 - boss.health,
      bossHealth: boss.health,
    };
  });

  if (!r.staged) {
    ok(false, 'could not stage wave 5');
  } else {
    console.log(`  wave ${r.wave}: headshot kills a mook (${r.mookKilled}), god took ${Math.round(r.bossTook)}`);
    console.log('');
    ok(r.mookKilled === true,
      'CONTROL: inside the lethal window a headshot still deletes an ordinary actor');
    ok(r.bossKilled === false, 'and still does not delete a god that arrived inside it');
    ok(r.bossTook > 0, `CONTROL: while landing real damage (${Math.round(r.bossTook)})`);
  }
}

ok(errors.length === 0, `no console errors (${errors.length})`);
if (errors.length) for (const e of errors.slice(0, 6)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
