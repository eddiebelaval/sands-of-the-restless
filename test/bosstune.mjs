/**
 * HOW LONG A GOD ACTUALLY TAKES TO KILL, AND HOW LONG IT TAKES TO KILL YOU.
 *
 * The owner played World 1 and said the bosses were too easy. The first three
 * answers to that were all wrong and all measured wrong: it was not doorway
 * width, not a lintel, and not the flow field. It was that a god could not
 * route the map at all, so it stood in a doorway being shot for free.
 *
 * That is now closed - a god crosses the interior and reaches the player - which
 * means boss health and damage can finally be tuned against a fight that
 * happens rather than against a body stuck on stone. It also means the numbers
 * moved WITHOUT being edited: a god that arrives is strictly more dangerous than
 * one that does not, so "make it harder" is not automatically the answer and
 * this file exists to say which direction is actually needed.
 *
 * WHAT IS MEASURED, and it is deliberately not a simulated firefight.
 *
 * Damage per round comes from `combat.applyHits()`, the same call the real
 * hitscan makes, so every modifier - the upgrade multiplier, the headshot
 * multiplier, any shrine - is applied by the code that owns it rather than
 * re-derived here. Rounds-to-kill is then arithmetic, and seconds-to-kill is
 * rounds divided by the weapon's own rpm. Simulating aim would add a skill
 * variable to a question that is not about skill.
 *
 * The result is a CEILING on difficulty: it assumes every round hits, which no
 * player manages. A god that dies in four seconds here dies in eight in a real
 * run, and one that takes thirty here is a minute of holding an angle.
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1200);

const out = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const weapons = await import(new URL('../src/player/weapons.js', location.href).href);

  const dt = 1 / 30;

  /**
   * The loadout a player plausibly HAS on each boss wave.
   *
   * Not the best gun in the game at every wave, which would report a fantasy.
   * Wave 5 is the first boss and the player has had five waves of wall-buy
   * money, so a base carbine is generous already. The Altar costs 5000, so an
   * upgraded weapon before wave 10 is unusual and by 15 it is the norm.
   */
  const LOADOUT = {
    5: { weapon: 'carbine', upgraded: false },
    10: { weapon: 'lmg', upgraded: false },
    15: { weapon: 'lmg', upgraded: true },
    20: { weapon: 'lmg', upgraded: true },
    25: { weapon: 'lmg', upgraded: true },
  };

  function spawnBossOn(wave) {
    g.director.reset();
    g.director.forceWave(wave);
    let clock = 0;
    for (let i = 0; i < 1200 && !g.director.boss; i++) {
      clock += dt;
      g.director.update(dt, clock);
      g.combat.update(dt);
    }
    return g.director.boss;
  }

  const rows = [];
  for (const wave of [5, 10, 15, 20, 25]) {
    const boss = spawnBossOn(wave);
    if (!boss) { rows.push({ wave, error: 'no boss' }); continue; }

    const { weapon, upgraded } = LOADOUT[wave];
    // Applied through the real path, so the 2.5x is the one the game uses.
    if (upgraded && weapons.markUpgraded) weapons.markUpgraded(weapon);
    const stats = weapons.STATS[weapon];

    const measure = (region) => {
      boss.health = boss.maxHealth;
      const before = boss.health;
      const hits = [{ enemy: boss, weapon, region, point: { ...boss.position } }];
      g.combat.applyHits(hits);
      const per = before - boss.health;
      boss.health = boss.maxHealth;
      return per;
    };

    const body = measure('body');
    const head = measure('head');
    const rps = stats.rpm / 60;

    rows.push({
      wave,
      god: boss.name,
      health: boss.maxHealth,
      damage: boss.spec ? boss.spec.damage : null,
      weapon, upgraded,
      rpm: stats.rpm,
      perBody: +body.toFixed(1),
      perHead: +head.toFixed(1),
      roundsBody: Math.ceil(boss.maxHealth / body),
      roundsHead: Math.ceil(boss.maxHealth / head),
      ttkBody: +(Math.ceil(boss.maxHealth / body) / rps).toFixed(1),
      ttkHead: +(Math.ceil(boss.maxHealth / head) / rps).toFixed(1),
      // How long the god needs to kill a full-health player, ignoring regen,
      // which never engages under sustained contact anyway (REGEN_DELAY is 5 s
      // and a god swings every cooldown).
      hitsToKillPlayer: boss.spec ? Math.ceil(100 / (boss.spec.damage * 0.7)) : null,
      swingEvery: boss.spec ? boss.spec.cooldown : null,
    });
  }

  return { rows, upgrade: weapons.UPGRADE };
});

if (out.fatal) { console.log(`FATAL  ${out.fatal}`); await browser.close(); process.exit(1); }

console.log('TIME TO KILL A GOD, assuming every round hits. This is the difficulty CEILING.');
console.log('');
console.log('wave god       health  loadout            per body  per head   TTK body  TTK head');
for (const r of out.rows) {
  if (r.error) { console.log(`${String(r.wave).padStart(4)}  ${r.error}`); continue; }
  console.log(
    `${String(r.wave).padStart(4)} ${r.god.padEnd(9)}${String(r.health).padStart(6)}  `
    + `${(r.weapon + (r.upgraded ? ' upgraded' : '')).padEnd(18)}`
    + `${String(r.perBody).padStart(8)}${String(r.perHead).padStart(10)}`
    + `${(r.ttkBody + ' s').padStart(11)}${(r.ttkHead + ' s').padStart(10)}`,
  );
}
console.log('');
console.log('and how long the god needs on YOU:');
console.log('wave god       damage  hits to kill  swings every');
for (const r of out.rows) {
  if (r.error) continue;
  console.log(
    `${String(r.wave).padStart(4)} ${r.god.padEnd(9)}${String(r.damage).padStart(6)}  `
    + `${String(r.hitsToKillPlayer).padStart(12)}  ${String(r.swingEvery).padStart(11)} s`,
  );
}
if (errors.length) { console.log(''); for (const e of errors.slice(0, 4)) console.log(`  err ${e}`); }

await browser.close();

/**
 * THE CHECKS.
 *
 * The defect this file was written to find was not a number being wrong, it was
 * the ORDER being wrong: ceiling headshot TTK ran 3.8, 8.2, 5.4, 7.9, 13.5, so
 * the third god was easier than the second and nothing in the code said so. A
 * table can look like it escalates while the fight does the opposite, because
 * the player's damage steps at the Altar and the table cannot see that.
 *
 * So these assert the SHAPE of the curve rather than any particular value. Retune
 * freely; just do not let a later god be a shorter fight than an earlier one.
 */
console.log('');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

const rows = out.rows.filter((r) => !r.error);
ok(rows.length === 5, `all five gods spawned (${rows.length})`);

for (let i = 1; i < rows.length; i++) {
  const a = rows[i - 1], b = rows[i];
  ok(b.ttkHead > a.ttkHead,
    `${b.god} is a longer fight than ${a.god} on headshots (${b.ttkHead}s vs ${a.ttkHead}s)`);
  ok(b.ttkBody > a.ttkBody,
    `${b.god} is a longer fight than ${a.god} on body shots (${b.ttkBody}s vs ${a.ttkBody}s)`);
  ok(b.damage > a.damage, `${b.god} hits harder than ${a.god} (${b.damage} vs ${a.damage})`);
}

// A boss that dies inside one magazine of held aim is not a boss. The first one
// used to take 3.8 s.
ok(rows[0].ttkHead >= 6, `the FIRST god survives held aim (${rows[0].ttkHead}s at the ceiling)`);

// And nothing may kill the player in two hits. The strike applies damage * 0.7
// against 100 health, so anything over 71 crosses that line - a cliff rather
// than a curve, and one the player cannot read before it happens.
for (const r of rows) {
  ok(r.hitsToKillPlayer >= 3, `${r.god} needs at least three hits to kill (${r.hitsToKillPlayer})`);
}

ok(errors.length === 0, 'no console errors');
console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
