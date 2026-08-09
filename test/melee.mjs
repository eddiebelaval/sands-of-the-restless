/**
 * Khopesh integration gate.
 *
 * The visual swing was measured while it was built; this suite protects the
 * gameplay contract that is easier to regress silently: a reload is abandoned
 * without moving ammunition, the gun cannot fire through the swing, contact
 * happens at the authored point in the animation, only the nearest actor in the
 * cone is struck, and the cooldown is measured in simulated seconds.
 */

import { chromium } from 'playwright';
import { resolveChrome, dismissBriefing } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
// BEGIN raises the briefing card now; the world is held behind it. See chrome.mjs.
await dismissBriefing(page);
// SwiftShader can deliver fewer than one game frame per wall-clock second.
// The hands own their readiness, so wait on that state rather than guessing how
// long the opening raise animation will take on this machine.
await page.waitForFunction(
  () => window.__SANDS__?.viewmodel?.state?.phase === 'ready',
  null,
  { timeout: 120000 },
);

const result = await page.evaluate(() => {
  const g = window.__SANDS__;
  const melee = g.melee;
  const weapon = g.weapons.state.current;
  const ammo = g.weapons.ammo[weapon];

  g.combat.state.invulnerable = true;
  g.director.reset();
  g.player.teleport({ x: 0, y: 0, z: 30 });
  g.rig.reset(0, 0);
  g.rig.update(1 / 60, g.player, false);
  g.camera.updateMatrixWorld(true);

  // Two bodies in the arc and one beside the player. The nearer body must take
  // the one allowed hit; the farther and side bodies are controls.
  const near = g.director.placeAt('shambler', 0, 28.2);
  const far = g.director.placeAt('shambler', 0, 27.9);
  const side = g.director.placeAt('shambler', 1.8, 30);
  const before = {
    near: near?.health,
    far: far?.health,
    side: side?.health,
  };

  // Start a real reload, then interrupt it with the blade.
  ammo.mag = Math.max(0, ammo.mag - 1);
  const rounds = { mag: ammo.mag, reserve: ammo.reserve };
  const reloadStarted = g.weapons.reload();
  const swingStarted = melee.swing();
  const reloadCancelled = !g.weapons.state.reloading;
  const roundsUnmoved = ammo.mag === rounds.mag && ammo.reserve === rounds.reserve;

  // A held trigger during the swing must spend nothing.
  const magBeforeFire = ammo.mag;
  const fireDuringSwing = g.weapons.fire();
  const gunBlocked = fireDuringSwing === null && ammo.mag === magBeforeFire;

  const early = melee.update(melee.MELEE.contact - 0.01);
  const atContact = melee.update(0.02);
  const afterContact = {
    near: near?.health,
    far: far?.health,
    side: side?.health,
  };

  // Finish the animation, prove the recovery lock, then advance only the
  // system clock until another swing is logically available.
  melee.update(melee.MELEE.swing);
  const refusedDuringRecovery = melee.swing() === false;
  melee.update(melee.MELEE.cooldown);

  return {
    wired: !!melee,
    knobs: { ...melee.MELEE },
    oneShots: melee.stats().oneShots,
    placed: !!near && !!far && !!side,
    reloadStarted,
    swingStarted,
    reloadCancelled,
    roundsUnmoved,
    gunBlocked,
    noEarlyHit: early === null,
    connected: !!atContact && atContact.length === 1,
    killedNearest: before.near > 0 && near?.dying === true,
    farUntouched: afterContact.far === before.far,
    sideUntouched: afterContact.side === before.side,
    refusedDuringRecovery,
    readyAfterRecovery: melee.ready(),
    stats: melee.stats(),
  };
});

await browser.close();

const checks = {
  'the melee system is wired':          result.wired,
  'all three controls were placed':     result.placed,
  'the authored damage is 250':         result.knobs.damage === 250,
  'the shambler curve ends at wave 5':  result.oneShots.shambler === 5,
  'a reload really began':              result.reloadStarted,
  'the khopesh swing began':            result.swingStarted,
  'the swing cancels the reload':       result.reloadCancelled,
  'cancelled reload moves no rounds':   result.roundsUnmoved,
  'the gun cannot fire through it':     result.gunBlocked,
  'damage does not arrive early':       result.noEarlyHit,
  'one target connects at contact':     result.connected,
  'the nearest target takes the hit':   result.killedNearest,
  'the farther target is untouched':    result.farUntouched,
  'a target outside the cone is safe':  result.sideUntouched,
  'recovery refuses an early swing':    result.refusedDuringRecovery,
  'simulated time clears the cooldown': result.readyAfterRecovery,
  'no console errors':                  errors.length === 0,
};

console.log(JSON.stringify(result, null, 2));
console.log('--- checks ---');

let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

if (errors.length) {
  console.log('--- errors ---');
  for (const error of errors) console.log(error);
}

if (failed) {
  console.error(`${failed} CHECK(S) FAILED`);
  process.exit(1);
}

console.log('ALL CHECKS PASSED');
