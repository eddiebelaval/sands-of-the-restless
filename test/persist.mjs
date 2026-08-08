/**
 * DOES ANY OF IT ACTUALLY SURVIVE A RELOAD.
 *
 * `test/save.mjs` proves the store is correct against a fake Storage. It cannot
 * prove the game is WIRED to it, and those are different claims: a save module
 * that nothing calls passes every unit test it has and changes nothing a player
 * experiences. This drives the real page, in a real browser, with a real
 * localStorage, and RELOADS IT - which is the only way to test the thing the
 * owner actually asked about.
 *
 * The controls here are the values themselves. Every assertion reads a number
 * back that differs from the shipped default, so a settings panel that silently
 * reset to defaults would fail rather than quietly agree.
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

async function boot() {
  await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
  await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
  await page.waitForTimeout(700);
}

await page.goto(BASE, { waitUntil: 'load' });
await boot();

// Start from a known-clean slate, so a previous run of this file cannot make it
// pass. Then reload, because clear() only empties the store.
await page.evaluate(() => window.__SANDS__.save.clear());
await page.reload({ waitUntil: 'load' });
await boot();

// --------------------------------------------------------------- settings
const before = await page.evaluate(() => {
  const g = window.__SANDS__;
  // Written through the PANEL's own rows, not through the rig, so this tests
  // the wiring the player actually touches. Values chosen well away from the
  // defaults so a reset-to-default cannot look like a pass.
  const rows = {};
  for (const group of g.pause.spec) {
    for (const row of group.rows || []) rows[`${group.id}.${row.id}`] = row;
  }
  rows['game.sensitivity'].write(2.40);
  rows['game.fov'].write(102);
  rows['game.invert'].write(true);
  rows['audio.volume'].write(37);
  g.save.flush();

  return {
    sens: g.rig.sensitivityScale,
    fov: g.rig.baseFov,
    invert: g.rig.invertY,
    volume: Math.round(g.audio.getVolume() * 100),
    saved: g.save.snapshot().settings,
  };
});

ok(Math.abs(before.sens - 2.40) < 0.001, `sensitivity applied in this session (${before.sens})`);
ok(before.fov === 102, `field of view applied (${before.fov})`);
ok(before.invert === true, 'invert applied');
ok(before.volume === 37, `volume applied (${before.volume})`);
ok(Object.keys(before.saved).length >= 4,
  `and all four reached the save (${Object.keys(before.saved).length} keys)`);

await page.reload({ waitUntil: 'load' });
await boot();

const after = await page.evaluate(() => {
  const g = window.__SANDS__;
  return {
    sens: g.rig.sensitivityScale,
    fov: g.rig.baseFov,
    invert: g.rig.invertY,
    volume: Math.round(g.audio.getVolume() * 100),
    restored: g.save.stats().restored,
  };
});

console.log('');
console.log(`  before reload   sens ${before.sens}  fov ${before.fov}  invert ${before.invert}  volume ${before.volume}`);
console.log(`  after  reload   sens ${after.sens}  fov ${after.fov}  invert ${after.invert}  volume ${after.volume}`);
console.log('');

ok(after.restored === true, 'the save was found on the next boot');
ok(Math.abs(after.sens - 2.40) < 0.001, `sensitivity SURVIVED the reload (${after.sens})`);
ok(after.fov === 102, `field of view survived (${after.fov})`);
ok(after.invert === true, 'invert survived');
ok(after.volume === 37, `volume survived (${after.volume})`);

// ---------------------------------------------------------------- records
const rec = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const dt = 1 / 30;

  // A run that gets somewhere and then ends. forceWave puts the state where a
  // real run would be; the death card is then driven the way main.js drives it.
  g.director.forceWave(11);
  for (let i = 0; i < 200; i++) g.director.update(dt, i * dt);
  const wave = g.director.state.wave;
  const gold = g.economy ? g.economy.gold : 0;

  g.death.begin ? g.death.begin() : g.combat.killPlayer?.();
  for (let i = 0; i < 400; i++) g.death.update(dt);
  g.save.flush();

  return {
    wave, gold,
    records: g.save.records(),
    cardText: g.death.stats ? g.death.stats().epitaph : null,
    elapsed: Math.round(g.director.state.elapsed),
  };
});

console.log('');
console.log(`  death card: ${rec.cardText}`);
console.log(`  records:    ${JSON.stringify(rec.records)}`);
console.log('');

ok(rec.elapsed > 0, `the director now tracks run time (${rec.elapsed} s, was always 0)`);
ok(rec.records.erased >= 1, `an erasure was recorded (${rec.records.erased})`);
ok(rec.records.deepestWave >= 1, `the deepest wave was recorded (${rec.records.deepestWave})`);

await page.reload({ waitUntil: 'load' });
await boot();

const kept = await page.evaluate(() => {
  const g = window.__SANDS__;
  return { records: g.save.records(), resets: g.death.stats ? g.death.stats().resets : null };
});

ok(kept.records.erased >= 1, `the erasure count SURVIVED the reload (${kept.records.erased})`);
ok(kept.records.deepestWave >= 1, `so did the deepest wave (${kept.records.deepestWave})`);
ok(kept.resets === kept.records.erased,
  `and the death card is seeded from it, so the tomb remembers (${kept.resets})`);

// ------------------------------------------------------------------ flags
const flag = await page.evaluate(() => {
  const g = window.__SANDS__;
  g.save.setFlag('worldTwoEgg');
  g.save.flush();
  return g.save.getFlag('worldTwoEgg');
});
ok(flag === true, 'a flag can be set in-page');
await page.reload({ waitUntil: 'load' });
await boot();
ok(await page.evaluate(() => window.__SANDS__.save.getFlag('worldTwoEgg')) === true,
  'and survives, which is what World 2\'s Easter egg will stand on');

// Leave the machine as we found it.
await page.evaluate(() => window.__SANDS__.save.clear());

ok(errors.length === 0, 'no console errors');
if (errors.length) for (const e of errors.slice(0, 5)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
