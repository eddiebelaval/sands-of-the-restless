/**
 * A HEADSHOT IS A KILL THROUGH WAVE 6, WITH ANY WEAPON, EXCEPT ON A BOSS.
 *
 * The owner reported that headshots did not feel strong enough. They were not:
 * a shambler has 85 health growing 15% a wave on Normal, and even the MK9's
 * 42 x 2.6 stopped being lethal at wave THREE. The B3AR at 26 x 2.2 = 57.2 never
 * one-shot anything.
 *
 * What this asserts is the RULE and its two edges - the wave it stops at, and
 * the boss that is exempt inside it - rather than a damage number. A test that
 * asserted "109.2 damage" would pass on a build where the lethal window had been
 * deleted, because the multiplier would still be doing its old arithmetic.
 *
 * Usage: node test/headshot.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

const browser = await chromium.launch({ executablePath: resolveChrome(), args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1500);

let pass = 0; const fails = [];
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail === undefined ? '' : `  (${detail})`}`); }
};

/**
 * Fire one synthetic hit at a fresh actor and report whether it died.
 *
 * Goes through combat.applyHits, which is the real resolution path the frame
 * loop calls, rather than reaching into the actor's health directly - the whole
 * question is what that function decides.
 */
async function shoot({ wave, weapon, region, variant = 'shambler' }) {
  return page.evaluate(({ wave, weapon, region, variant }) => {
    const g = window.__SANDS__;

    g.director.state.wave = wave;

    // Drive the director until it has put something on the floor. There is no
    // spawn-one API and inventing a call into the actor pool would be testing a
    // path the game does not use; test/enemies.mjs drives update() for the same
    // reason. 1/30 because everything in here is a pure function of dt.
    let actor = g.director.live.find((a) => a && a.live && !a.dying);
    for (let i = 0; i < 900 && !actor; i++) {
      g.director.update(1 / 30, i / 30);
      g.combat.update(1 / 30);
      actor = g.director.live.find((a) => a && a.live && !a.dying);
    }
    if (!actor) return { error: 'no live actor to shoot' };

    // The wave is re-asserted AFTER the sim, because driving update() advances
    // it and the whole question is what happens on a stated wave.
    g.director.state.wave = wave;

    // Full health at this wave, so the test is about the RULE and not about
    // whatever damage the horde had already taken.
    actor.health = actor.maxHealth;

    const before = actor.health;
    const hits = [{ enemy: actor, weapon, region, point: { ...actor.position } }];
    g.combat.applyHits(hits);

    return {
      wave: g.director.wave,
      variant: actor.spec ? actor.spec.id : '?',
      maxHealth: +actor.maxHealth.toFixed(1),
      before: +before.toFixed(1),
      after: +Math.max(0, actor.health).toFixed(1),
      killed: !!hits[0].killed,
    };
  }, { wave, weapon, region, variant });
}

console.log('\nTHE WEAKEST GUN IN THE GAME STILL KILLS WITH ONE HEADSHOT');
// B3AR: 26 x 2.2 = 57.2, against 85 health at wave 1. It could never do this
// on damage alone, which is what makes it the right weapon to prove the rule.
for (const wave of [1, 3, 6]) {
  const r = await shoot({ wave, weapon: 'b3ar', region: 'head' });
  if (r.error) { check(false, `wave ${wave}: ${r.error}`); continue; }
  check(r.killed === true,
    `wave ${wave}: a B3AR headshot kills outright`,
    `${r.variant} ${r.before} -> ${r.after}, killed=${r.killed}`);
}

console.log('\nAND STOPS AFTER THE WINDOW');
{
  const r = await shoot({ wave: 7, weapon: 'b3ar', region: 'head' });
  check(r.killed === false,
    'wave 7: a B3AR headshot no longer kills outright',
    `${r.before} -> ${r.after}, killed=${r.killed}`);
  check(r.after > 0 && r.after < r.before,
    'and it still WOUNDS by the multiplier',
    `${r.before} -> ${r.after}`);
}

console.log('\nBODY SHOTS ARE UNTOUCHED INSIDE THE WINDOW');
{
  const r = await shoot({ wave: 1, weapon: 'b3ar', region: 'body' });
  check(r.killed === false,
    'wave 1: a B3AR body shot does not kill',
    `${r.before} -> ${r.after}, killed=${r.killed}`);
  check(Math.abs((r.before - r.after) - 26) < 0.5,
    'and takes exactly its base damage, 26',
    `dealt ${(r.before - r.after).toFixed(1)}`);
}

console.log('\nEVERY WEAPON, NOT JUST THE PISTOL');
for (const weapon of ['mk9', 'smg', 'shotgun', 'carbine', 'lmg', 'bolt', 'b3ar']) {
  const r = await shoot({ wave: 5, weapon, region: 'head' });
  check(r.killed === true, `wave 5: ${weapon} headshot kills`, `killed=${r.killed}`);
}

console.log('\nTHE BOSS IS EXEMPT, INSIDE THE WINDOW');
{
  /**
   * Tests the RULE, with a designated boss, rather than waiting for Anubis.
   *
   * A boss spawns on `wave % 5 === 0` and only onto a point `pickPoint(true)`
   * will yield, which the courtyard has none of - so 666 simulated seconds
   * outside produced no boss at all and this check SKIPPED. A skipped check is
   * not a passing one, and this is the most important assertion in the file:
   * Anubis has 5200 health and arrives on wave 5, INSIDE the window, so a
   * missing exemption would let one pistol round to the face delete him. That
   * is a strictly worse bug than the one this change fixes.
   *
   * The exemption is `enemy !== director.boss`, so pointing that reference at a
   * live actor exercises exactly the branch a real boss would take, on the wave
   * a real boss would arrive. What it does not prove is that a real Anubis ends
   * up in `director.boss` - beginWave does that, and test/enemies.mjs covers it.
   */
  const boss = await page.evaluate(() => {
    const g = window.__SANDS__;

    let actor = g.director.live.find((a) => a && a.live && !a.dying);
    for (let i = 0; i < 900 && !actor; i++) {
      g.director.update(1 / 30, i / 30);
      g.combat.update(1 / 30);
      actor = g.director.live.find((a) => a && a.live && !a.dying);
    }
    if (!actor) return { error: 'no actor to designate' };

    g.director.state.wave = 5;
    g.director.state.boss = actor;
    actor.health = actor.maxHealth;

    const before = actor.health;
    const hits = [{ enemy: actor, weapon: 'mk9', region: 'head', point: { ...actor.position } }];
    g.combat.applyHits(hits);
    const after = actor.health;

    // And the control: the SAME actor, same wave, same shot, once it is no
    // longer the boss. Without this the check would pass on a build where the
    // lethal window simply did not work.
    g.director.state.boss = null;
    actor.health = actor.maxHealth;
    const hits2 = [{ enemy: actor, weapon: 'mk9', region: 'head', point: { ...actor.position } }];
    g.combat.applyHits(hits2);

    return {
      wave: g.director.wave,
      before: +before.toFixed(1),
      after: +Math.max(0, after).toFixed(1),
      killedAsBoss: !!hits[0].killed,
      killedAsHorde: !!hits2[0].killed,
    };
  });

  if (boss.error) {
    check(false, `boss exemption: ${boss.error}`);
  } else {
    check(boss.killedAsBoss === false,
      'wave 5: a headshot does NOT insta-kill the designated boss',
      `${boss.before} -> ${boss.after}, killed=${boss.killedAsBoss}`);
    check(boss.after < boss.before,
      'but it still wounds it by the multiplier',
      `${boss.before} -> ${boss.after}`);
    check(boss.killedAsHorde === true,
      'CONTROL: the same shot on the same actor kills once it is not the boss',
      `killed=${boss.killedAsHorde}`);
  }
}

check(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | '));
console.log(`\n${fails.length ? `HEADSHOT: ${fails.length} FAILED of ${pass + fails.length}` : `HEADSHOT: all ${pass} checks green`}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
