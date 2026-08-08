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

  /**
   * THE PLAYER HAS TO ACTUALLY BE DEAD, which is not what the first cut did.
   *
   * `death.update` opens with
   *
   *     if (phase !== 'restarting' && player.state.health > 0 && !state.pending)
   *       { standDown(); return; }
   *
   * so calling begin() on a living player sets the phase to 'falling' and the
   * very next frame stands it back down. The first version of this test passed
   * only when the horde happened to kill the player during the director frames
   * above, which made it flaky in the worst way available: it reported "an
   * erasure was recorded (undefined)" and looked exactly like the save being
   * unwired, on a build where the save was fine.
   *
   * Killing the player outright is the honest precondition. A death card is for
   * a dead player.
   */
  g.player.state.health = 0;
  g.death.begin && g.death.begin();
  let epitaph = '';
  for (let i = 0; i < 900 && !epitaph; i++) {
    g.death.update(dt);
    epitaph = (g.death.stats && g.death.stats().epitaph) || '';
  }
  g.save.flush();

  return {
    wave, gold,
    records: g.save.records(),
    cardText: epitaph,
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

// ----------------------------------------------------- the records line
//
// THE CONTROL IS THE EMPTY CASE, and it is the one worth asserting. A records
// line that renders "Deepest Wave 0 · Erased 0" for someone who has never
// played would pass any check that only looks for the numbers to be right.
{
  await page.evaluate(() => window.__SANDS__.save.clear());
  await page.reload({ waitUntil: 'load' });
  await boot();

  const fresh = await page.evaluate(() => {
    const el = document.querySelector('[data-record]');
    return { hidden: el.hidden, text: el.textContent.trim(), boxes: el.getClientRects().length };
  });
  ok(fresh.hidden === true, 'a first-time player is shown NO records line');
  ok(fresh.text === '', 'and it holds no text at all, not even placeholders');
  ok(fresh.boxes === 0, 'and it occupies no space on the title screen');

  // Now give it a history and reload into it.
  await page.evaluate(() => {
    const s = window.__SANDS__.save;
    s.best('deepestWave', 17);
    s.best('richestRun', 9250);
    s.best('erased', 6);
    s.flush();
  });
  await page.reload({ waitUntil: 'load' });
  await boot();

  const shown = await page.evaluate(() => {
    const el = document.querySelector('[data-record]');
    return {
      hidden: el.hidden,
      text: el.textContent.replace(/\s+/g, ' ').trim(),
      fields: el.querySelectorAll('span').length,
      // Every figure is a <b>, which is what carries the readable colour.
      figures: [...el.querySelectorAll('b')].map((b) => b.textContent),
    };
  });

  console.log('');
  console.log(`  before a clear:  ${shown.text}`);

  ok(shown.hidden === false, 'a returning player IS shown one');
  ok(/Deepest/i.test(shown.text) && shown.figures.includes('Wave 17'),
    'it names the deepest wave reached (17)');
  ok(shown.figures.includes('6'), 'and the erasure count (6)');
  ok(shown.figures.includes('9250'), 'and the richest run (9250)');
  ok(!/Fastest/i.test(shown.text), 'and does NOT claim a clear time before a clear');

  // And after a clear, deepest stops being interesting and time takes over.
  await page.evaluate(() => {
    const s = window.__SANDS__.save;
    s.add('clears', 1);
    s.least('fastestClear', 878);
    s.flush();
  });
  await page.reload({ waitUntil: 'load' });
  await boot();

  const cleared = await page.evaluate(() => {
    const el = document.querySelector('[data-record]');
    return { text: el.textContent.replace(/\s+/g, ' ').trim(),
      figures: [...el.querySelectorAll('b')].map((b) => b.textContent) };
  });
  console.log(`  after  a clear:  ${cleared.text}`);
  console.log('');

  ok(cleared.figures.includes('14:38'), 'after a clear it shows the time as mm:ss (878 s = 14:38)');
  ok(/Descended/i.test(cleared.text), 'and how many times the tomb was cleared');
  ok(!/Deepest/i.test(cleared.text),
    'and DROPS deepest wave, which is 25 for everyone who has finished');
}

// Leave the machine as we found it.
await page.evaluate(() => window.__SANDS__.save.clear());

ok(errors.length === 0, 'no console errors');
if (errors.length) for (const e of errors.slice(0, 5)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
