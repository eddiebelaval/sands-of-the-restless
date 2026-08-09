/**
 * WHAT IS STANDING ON THE LINE FROM SPAWN TO THE DOOR.
 *
 * Throwaway diagnostic. Lists every collider whose disc reaches within a body
 * radius of the straight walk x=0, z=30 -> z=-30, so the current build can be
 * diffed against HEAD.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS, dismissBriefing } from './chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4188/index.html';
const BODY = 0.42;      // the player's radius, per world/camp.js's note

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => document.getElementById('begin').click());
await dismissBriefing(page);
await page.waitForTimeout(1200);

const r = await page.evaluate((body) => {
  const g = window.__SANDS__;
  const cols = (g.courtyard && g.courtyard.colliders) || [];
  const on = cols
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.z))
    .filter((c) => c.z < 32 && c.z > -32)
    // Does the disc reach the centre line at all?
    .filter((c) => Math.abs(c.x) - (c.r + body) < 0)
    .map((c) => ({
      x: +c.x.toFixed(2), z: +c.z.toFixed(2),
      r: +c.r.toFixed(2), h: +(c.h ?? 0).toFixed(2),
      // How far the disc reaches ACROSS the line.
      over: +((c.r + body) - Math.abs(c.x)).toFixed(2),
    }))
    .sort((a, b) => b.z - a.z);
  return { on, total: cols.length };
}, BODY);

console.log('');
console.log(`${r.total} courtyard colliders; ${r.on.length} of them block the centre line`);
console.log('');
console.log('    z        x      r      h     reaches over the line by');
for (const c of r.on) {
  console.log(`  ${String(c.z).padStart(7)}  ${String(c.x).padStart(6)}  ${String(c.r).padStart(5)}  ${String(c.h).padStart(5)}     ${c.over} m`);
}
console.log('');

await browser.close();
