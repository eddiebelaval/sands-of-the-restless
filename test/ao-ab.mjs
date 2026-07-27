/**
 * Decisive A/B on the ambient occlusion pass.
 *
 * "I added GTAO" is not the same as "GTAO is contributing". This renders the
 * identical frame with the pass enabled and disabled and measures the mean
 * absolute pixel difference. A near-zero difference means the pass is running,
 * costing frame time, and doing nothing, which is the failure mode that looks
 * exactly like success in a screenshot.
 *
 * The diff runs in-page against the WebGL canvas rather than against saved
 * PNGs, so it needs no image decoding dependency.
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';

const CHROME = resolveChrome();

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:4177/index.html', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1500);

const result = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const canvas = g.renderer.domElement;

  const scratch = document.createElement('canvas');
  scratch.width = canvas.width;
  scratch.height = canvas.height;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });

  const nextFrames = (n) => new Promise((resolve) => {
    let i = 0;
    const tick = () => (++i >= n ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });

  // The canvas must be sampled in the same frame it was drawn, because the
  // drawing buffer is cleared before the next composite.
  const grab = async () => {
    await nextFrames(6);
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        ctx.drawImage(canvas, 0, 0);
        resolve(ctx.getImageData(0, 0, scratch.width, scratch.height).data);
      });
    });
  };

  g.post.gtao.enabled = true;
  const on = await grab();

  g.post.gtao.enabled = false;
  const off = await grab();

  g.post.gtao.enabled = true;   // leave it as we found it

  let sum = 0, n = 0, maxd = 0, darker = 0;
  for (let i = 0; i < on.length; i += 4) {
    const lOn = (on[i] + on[i + 1] + on[i + 2]) / 3;
    const lOff = (off[i] + off[i + 1] + off[i + 2]) / 3;
    const d = Math.abs(lOn - lOff);
    sum += d; n++;
    if (d > maxd) maxd = d;
    if (lOn < lOff - 1) darker++;   // AO should darken, never brighten
  }

  return {
    meanAbsDiff: +(sum / n).toFixed(3),
    maxPixelDiff: +maxd.toFixed(1),
    percentDarkened: +((darker / n) * 100).toFixed(1),
  };
});

await browser.close();

result.verdict = result.meanAbsDiff > 1.0
  ? 'GTAO IS CONTRIBUTING'
  : 'GTAO HAS NO VISIBLE EFFECT';

console.log(JSON.stringify(result, null, 2));
