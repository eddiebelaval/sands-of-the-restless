/**
 * THE RELOAD ANIMATION AND THE RELOAD TIMER HAVE TO BE THE SAME CLOCK.
 *
 * weapons.js does not own a reload duration. It starts the animation, watches
 * the viewmodel's phase, and calls the reload finished when the hands come back
 * to ready - with a flat 4.0 second timer behind it as a fallback for a
 * headless run with no viewmodel attached. The Shrine of Ptah then halves the
 * reload by setting `reloadScale` to 0.5, and the only thing that can honestly
 * act on that is the loop handing the viewmodel its delta: main.js divides the
 * viewmodel's dt by the scale for the duration of the reloading phase, so the
 * SAME track plays at twice the rate.
 *
 * That is a three-file agreement and it is exactly the kind that rots. If the
 * animation ever grew a duration of its own, the boon would desynchronise it:
 * the magazine would seat after the gun was already firing, or the gun would
 * fire while the hands were still working. So this measures it instead of
 * trusting it.
 *
 * WHAT IT MEASURES, per weapon, at scale 1.0 and at scale 0.5:
 *
 *   - how long the logical reload actually took, in simulation seconds;
 *   - whether it ended because the ANIMATION finished or because the fallback
 *     timer ran out. These are told apart by choosing weapons whose authored
 *     length is far from the 4.0 second fallback: the bolt gun is 3.10s, so at
 *     half rate the animation ends at 1.55s and the fallback at 2.00s, and a
 *     result of 2.00 would mean the animation was NOT being scaled;
 *   - whether the animation was allowed to run to the end of its track rather
 *     than being cut off part-way through by whichever clock fired first.
 *
 * Usage: node test/ptahtiming.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:5237/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.setDefaultTimeout(180000);
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => { window.__SANDS__.setFidelity(false); document.getElementById('begin').click(); });
await page.waitForTimeout(1800);

// The authored lengths, read off the module rather than typed in here, so this
// suite cannot be quietly right about numbers the game no longer uses.
/**
 * Run one real reload through the real loop and time it in SIMULATION seconds.
 *
 * Simulation rather than wall clock, deliberately. Under swiftshader a frame
 * can take 300ms, and `elapsed` is the clock every system in the game is
 * actually on - including the one under test. Timing this against
 * performance.now() would measure the renderer.
 */
const timeReload = (id, scale) => page.evaluate(async ({ id, scale }) => {
  const g = window.__SANDS__;
  const w = g.weapons;

  const frame = () => new Promise((r) => requestAnimationFrame(r));

  w.state.reloadScale = scale;
  w.grant(id);
  w.equip(id);
  g.viewmodel.equip(id);
  /*
   * THE WEAPON HAS TO ACTUALLY BE IN THE HANDS, and asserting it is not
   * paranoia. weapons.equip() refuses for several honest reasons - the weapon
   * is already current, or the Altar has it stowed - and a refusal leaves
   * `state.current` pointing at the PREVIOUS weapon while everything below
   * writes ammunition into this one's row. Run back to back down a list, that
   * produced a reload of a full magazine that never finished and a 150 second
   * 'measurement' of nothing. A suite that reports a number it did not measure
   * is worse than one that reports nothing.
   */
  if (w.state.current !== id) {
    return { skipped: `not in hand: current is ${w.state.current}`, wanted: id };
  }
  for (let i = 0; i < 500 && g.viewmodel.state.phase !== 'ready'; i++) await frame();

  // Empty the magazine and top the reserve up, through the state the module
  // owns rather than by firing: a hundred rounds of hitscan through the real
  // fire path would spawn a hundred impacts and time the renderer.
  w.ammo[id].mag = 0;
  w.ammo[id].reserve = w.STATS[id].reserve;
  w.state.reloading = false;
  await frame();
  // update() starts a reload of its own the frame it sees an empty magazine
  // with reserve behind it, which is the real path a player takes to here.
  for (let i = 0; i < 5 && !w.state.reloading; i++) await frame();
  if (w.state.reloading) {
    // It auto-started. Time THAT, which is the honest case, but the clock has
    // already been running for up to five frames - so restart it cleanly. The
    // viewmodel's animation is NOT cancelled by weapons.cancelReload - by
    // design, that call abandons the logical reload and seats nothing - so
    // wait the animation out before asking for a fresh one, or reload() is
    // refused for being busy and the run measures nothing.
    w.cancelReload();
    for (let i = 0; i < 400 && g.viewmodel.state.phase === 'reloading'; i++) await frame();
  }

  // Reset the ammunition LAST, after every path above that could have spent it.
  // Running several weapons back to back through one page drained the bolt
  // gun's reserve and produced a 149 second 'reload' that seated nothing -
  // which was the harness eating its own tail, not the game.
  w.ammo[id].mag = 0;
  w.ammo[id].reserve = w.STATS[id].reserve;
  w.state.reloading = false;

  const t0 = g.elapsed;
  const reserveBefore = w.reserve;
  const started = w.reload();
  if (!started) return { skipped: 'reload refused', mag: w.magazine };

  let maxProgress = 0, sawReloadingPhase = false;
  /*
   * BOUNDED IN SIMULATION SECONDS, NOT IN FRAMES.
   *
   * A 3000 frame guard is 150 seconds of simulation at the delta clamp, and
   * when the reload never finished that is exactly what this reported: a
   * 149.7 second 'measurement' sitting in the results next to four real ones.
   * A stuck reload should be a fast, labelled failure. Twelve seconds is three
   * times the longest fallback in the game, so nothing legitimate reaches it.
   */
  const deadline = g.elapsed + 12;
  for (let i = 0; i < 3000 && w.state.reloading && g.elapsed < deadline; i++) {
    if (g.viewmodel.state.phase === 'reloading') sawReloadingPhase = true;
    maxProgress = Math.max(maxProgress, g.viewmodel.state.reloadProgress);
    await frame();
  }
  const simSeconds = g.elapsed - t0;

  return {
    timedOut: w.state.reloading,
    reserveBefore,
    reserveAfter: w.reserve,
    simSeconds: +simSeconds.toFixed(3),
    maxProgress: +maxProgress.toFixed(3),
    sawReloadingPhase,
    magAfter: w.magazine,
    fallbackWouldBe: +(4.0 * scale).toFixed(3),
  };
}, { id, scale });

const report = {};
for (const id of (process.env.PTAH_WEAPONS || 'mk9,shotgun,bolt').split(',')) {
  const full = await timeReload(id, 1.0);
  const ptah = await timeReload(id, 0.5);
  report[id] = { full, ptah };
  console.error(id, JSON.stringify(report[id]));
}

await page.evaluate(() => { window.__SANDS__.weapons.state.reloadScale = 1; });
console.log(JSON.stringify({ report, errors: logs }, null, 2));
await browser.close();
