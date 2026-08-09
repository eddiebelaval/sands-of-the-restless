/**
 * THE SIEGE: the one line on the HUD that says why the run exists.
 *
 * The owner's premise, 2026-08-08: she is sealed in the Serdab and cannot come
 * out until the dead are down, and the dead are down after wave 25. So the
 * twenty-five waves ARE the rescue. `ui/objective.js` prints it as a standing
 * goal above the step - SHE CANNOT OPEN THE DOOR UNTIL THE DEAD ARE DOWN, and a
 * figure - and flips it to GO TO HER when the horde is finished.
 *
 * ---------------------------------------------------------------------------
 * WHY THE INTERESTING CHECK IS "NEVER A LITERAL"
 * ---------------------------------------------------------------------------
 *
 * The failure mode this file exists to prevent is not the line vanishing. It is
 * the line CONFIDENTLY COUNTING DOWN TO THE WRONG NUMBER. Somebody retunes the
 * run to thirty waves in `director.js`, the HUD keeps promising the player it
 * ends at twenty-five, and nothing anywhere fails: the game still works, the
 * countdown still moves, and the only symptom is a player standing on wave 25
 * being told the dead are down while a god walks at him.
 *
 * A test that asserts `figure === 13 at wave 12` would go green through that
 * whole bug, because it would have baked in the same literal. So the assertion
 * here is a RELATION, checked at several waves:
 *
 *     wave + figure === director.stats().finalWave
 *
 * Read from the director at the moment of the sample. If the HUD ever carries
 * its own copy of the number, that sum stops balancing and this fails.
 *
 * ---------------------------------------------------------------------------
 * AND WHY EVERY CHECK IS READ OFF THE DOM
 * ---------------------------------------------------------------------------
 *
 * `siegeLine()` is not exported, deliberately - the player does not get a
 * return value, they get pixels. The panel repaints only on CHANGE and hides
 * the element when there is nothing to say, and both of those are places a
 * correct string dies on the way to the screen. So every figure below is the
 * text content of `[data-obj-goal]` as it stands in the document, and the
 * hidden flag is checked with it.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4188/index.html';

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
 * Read the goal band exactly as it stands on screen.
 *
 * The panel is pumped with an infinite delta first, because it throttles to
 * 20hz off the frame clock and this suite drives the director by hand rather
 * than by running the game - without the pump every sample below would be
 * whatever the last real frame painted, which is the classic version of this
 * bug and one this project has shipped before.
 */
async function band() {
  return page.evaluate(() => {
    const g = window.__SANDS__;
    g.objectivePanel.update(Infinity);

    const el = document.querySelector('#objective [data-obj-goal]');
    const b = el ? el.querySelector('b') : null;
    const st = g.director.stats ? g.director.stats() : {};

    return {
      present: !!el,
      hidden: el ? !!el.hidden : true,
      text: el ? (el.textContent || '').trim() : '',
      figure: b ? (b.textContent || '').trim() : '',
      wave: g.director.state.wave,
      concluded: !!g.director.state.concluded,
      finalWave: st.finalWave,
    };
  });
}

/** Put the run on a wave without playing to it. */
async function atWave(n) {
  await page.evaluate((w) => {
    const g = window.__SANDS__;
    g.director.forceWave(w);
    for (let i = 0; i < 30; i++) g.director.update(1 / 30, i / 30);
  }, n);
  return band();
}

console.log('');
console.log('=== THE BAND IS ON SCREEN ===');
console.log('');

{
  const b = await band();
  ok(b.present, 'the goal band exists in the document');
  ok(typeof b.finalWave === 'number' && b.finalWave > 0,
    `CONTROL: the director publishes a final wave (${b.finalWave})`);
}

console.log('');
console.log('=== THE FIGURE IS DERIVED, NOT TYPED ===');
console.log('');

/*
 * Several waves, spread across the run, and the relation is checked at each.
 * One sample cannot tell a countdown from a constant.
 */
const samples = [];
for (const w of [1, 7, 12, 20, 24]) {
  const b = await atWave(w);
  samples.push(b);

  const n = parseInt(b.figure, 10);
  console.log(`  wave ${String(b.wave).padStart(2)}  band "${b.text}"`);

  ok(b.hidden === false, `wave ${w}: the band is visible`);
  ok(/SHE CANNOT OPEN THE DOOR/.test(b.text), `wave ${w}: it names the siege`);
  ok(Number.isFinite(n) && b.wave + n === b.finalWave,
    `wave ${w}: ${b.wave} + ${n} = ${b.finalWave}, so the figure comes from the director`);
  ok(n >= 0, `wave ${w}: the figure is not negative`);
}

// A countdown that never moves would satisfy every check above if the relation
// were ever loosened. This is the cheap belt on it.
{
  const figures = samples.map((s) => parseInt(s.figure, 10));
  const descending = figures.every((n, i) => i === 0 || n < figures[i - 1]);
  console.log('');
  console.log(`  figures ${figures.join(' -> ')}`);
  ok(descending, 'and it counts DOWN as the run advances');
}

/*
 * The last wave, on its own, because it is the only one where the noun changes
 * and it is the frame the whole run has been counting towards. The first run of
 * this file printed "1 WAVES" there.
 */
{
  const b = await atWave(24);
  console.log(`  final   band "${b.text}"`);
  ok(/\b1 WAVE\b/.test(b.text) && !/1 WAVES/.test(b.text),
    'the last one is singular: "1 WAVE", not "1 WAVES"');
}

console.log('');
console.log('=== WHEN THE DEAD ARE DOWN ===');
console.log('');

/*
 * Concluded the real way. `state.concluded` is set by the director when the
 * last wave finishes, and setting the flag by hand would test nothing but the
 * panel's ability to read a flag this suite wrote.
 */
{
  const drove = await page.evaluate(() => {
    const g = window.__SANDS__;
    g.director.forceWave(g.director.stats().finalWave);

    let t = 0;
    let guard = 0;
    while (!g.director.state.concluded && guard++ < 4000) {
      g.director.update(1 / 30, t);
      t += 1 / 30;
      for (const a of (g.director.live || []).slice()) a.hurt(1e9, 'body', 0, 1);
    }
    return { concluded: g.director.state.concluded, guard, wave: g.director.state.wave };
  });

  ok(drove.concluded === true,
    `CONTROL: the run actually concluded by being played out (${drove.guard} steps)`);

  const b = await band();
  console.log(`  band "${b.text}"`);
  console.log('');

  ok(b.hidden === false, 'the band is still visible once the horde is finished');
  ok(/THE DEAD ARE DOWN/.test(b.text), 'and it says THE DEAD ARE DOWN');
  ok(b.figure === 'GO TO HER', 'and points at her rather than at a number');
  ok(!/UNTIL/.test(b.text), 'the countdown copy is gone, not appended to');
}

console.log('');
console.log('=== IT GOES BACK ===');
console.log('');

/*
 * The panel repaints only on change, so a line that got to GO TO HER and could
 * not get back would look perfect in every screenshot of a finished run and be
 * wrong for the whole of the next one. Death and restart both put the director
 * back on an early wave.
 */
{
  const b = await atWave(3);
  console.log(`  band "${b.text}"`);
  ok(/SHE CANNOT OPEN THE DOOR/.test(b.text), 'a fresh run gets the countdown back');
  ok(parseInt(b.figure, 10) + b.wave === b.finalWave,
    `and the relation still holds (${b.wave} + ${b.figure})`);
}

console.log('');
ok(errors.length === 0, `no console errors (${errors.length})`);
if (errors.length) for (const e of errors.slice(0, 6)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
