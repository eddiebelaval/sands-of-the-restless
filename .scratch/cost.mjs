/**
 * What the routing field costs, measured from inside the page.
 *
 * Wall clock is useless here - every suite renders through swiftshader and a
 * frame is most of a second - so this measures the only thing that is honest:
 * the CPU time the flood itself spends, taken with performance.now() around the
 * function, and the RATE at which the running game asks for one.
 *
 * The two are reported separately on purpose. A rebuild that has to re-measure
 * the geometry is a different animal from one that reads a cached clearance map,
 * and quoting an average over both hides the only number that can drop a frame.
 */

import { chromium } from 'playwright';
import { resolveChrome } from '../test/chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4931/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const logs = [];
page.on('pageerror', (e) => logs.push(e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1400);

const out = await page.evaluate(() => {
  const g = window.__SANDS__;
  const d = g.director;

  /**
   * Drive a real fight for `seconds` of simulation with the player WALKING, so
   * the field's move-threshold fires the way it does in play. A stationary
   * player is the cheap case and measuring only that would flatter the result.
   */
  function run(space, seconds) {
    if (space === 'interior') {
      g.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
      for (const b of g.spaces.interior.barriers) b.clearInstantly();
    } else {
      g.spaces.enter('exterior', { x: 0, z: 30, rot: 0 });
    }
    d.reset();
    d.forceWave(8);

    const dt = 1 / 30;
    const n = Math.ceil(seconds / dt);
    const samples = [];
    let prev = d.stats().flow.builds;
    let peakCached = 0, peakGeom = 0;
    let sumCached = 0, nCached = 0, sumGeom = 0, nGeom = 0;
    let prevGeom = d.stats().flow.geometryBuilds;
    let maxLive = 0;

    const p = g.player.position;
    const c0 = { x: p.x, z: p.z };

    for (let i = 0; i < n; i++) {
      // A lap of a small circuit, at about a walking pace, which is what the
      // whole map was rebuilt around the player doing.
      const t = i * dt;
      g.player.teleport({ x: c0.x + Math.sin(t * 0.5) * 9, y: 0, z: c0.z + Math.cos(t * 0.5) * 9 });
      d.update(dt, t);
      g.combat.update(dt);
      if (d.live.length > maxLive) maxLive = d.live.length;

      const f = d.stats().flow;
      if (f.builds !== prev) {
        prev = f.builds;
        if (f.geometryBuilds !== prevGeom) { prevGeom = f.geometryBuilds; sumGeom += f.lastMs; nGeom++; peakGeom = Math.max(peakGeom, f.lastMs); }
        else { sumCached += f.lastMs; nCached++; peakCached = Math.max(peakCached, f.lastMs); }
        samples.push(f.lastMs);
      }
    }

    const f = d.stats().flow;
    return {
      space,
      simSeconds: seconds,
      maxLive,
      cells: f.cells,
      visitedSlots: f.visited,
      layeredCells: f.layered,
      layersFull: f.layersFull,
      rebuilds: samples.length,
      rebuildsPerSimSecond: +(samples.length / seconds).toFixed(2),
      cachedRebuilds: nCached,
      cachedMeanMs: nCached ? +(sumCached / nCached).toFixed(3) : null,
      cachedPeakMs: +peakCached.toFixed(3),
      geometryRebuilds: nGeom,
      geometryMeanMs: nGeom ? +(sumGeom / nGeom).toFixed(3) : null,
      geometryPeakMs: +peakGeom.toFixed(3),
      msPerSimSecond: +((sumCached + sumGeom) / seconds).toFixed(3),
    };
  }

  const ext = run('exterior', 40);
  const int = run('interior', 40);

  /**
   * And the one frame that is meant to be expensive: a barrier opening, which
   * throws away every cached clearance verdict and re-measures the world.
   */
  g.spaces.enter('exterior', { x: 0, z: 30, rot: 0 });
  g.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
  d.reset();
  d.placeAt('shambler', 6, -170);
  d.update(1 / 30, 0);
  d.update(1 / 30, 1 / 30);
  const settled = d.stats().flow.lastMs;
  const shut = g.spaces.interior.barriers.find((b) => !b.opened);
  let doorFrame = null;
  if (shut) {
    shut.open();
    d.update(1 / 30, 2 / 30);
    doorFrame = d.stats().flow;
  }

  return { ext, int, settledMs: settled, doorFrame, renderer: g.renderer.info.render };
});

const show = (r) => {
  console.log(`\n=== ${r.space.toUpperCase()}  ${r.simSeconds} simulated seconds, player walking a 9 m circuit, up to ${r.maxLive} live actors ===`);
  console.log(`  grid                 ${r.cells} cells, ${r.visitedSlots} slots reached, ${r.layeredCells} cells needed a 2nd storey, layersFull ${r.layersFull}`);
  console.log(`  rebuild rate         ${r.rebuilds} in ${r.simSeconds}s  =  ${r.rebuildsPerSimSecond}/s`);
  console.log(`  cached rebuild       n=${r.cachedRebuilds}  mean ${r.cachedMeanMs} ms  peak ${r.cachedPeakMs} ms`);
  console.log(`  geometry rebuild     n=${r.geometryRebuilds}  mean ${r.geometryMeanMs} ms  peak ${r.geometryPeakMs} ms`);
  console.log(`  TOTAL CPU            ${r.msPerSimSecond} ms per simulated second  (a 60 Hz second is 1000 ms of budget)`);
};
show(out.ext);
show(out.int);
console.log(`\nsettled interior rebuild: ${out.settledMs} ms`);
console.log('frame a barrier is bought on:', JSON.stringify(out.doorFrame));
console.log('renderer.info.render:', JSON.stringify(out.renderer));
console.log('errors', logs.slice(0, 5));
await browser.close();
