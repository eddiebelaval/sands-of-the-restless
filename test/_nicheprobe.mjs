/**
 * WHAT FIXTURES ARE IN THE EMBALMING CHAMBER, AND WHERE.
 *
 * `test/jars.mjs` stands the player at (-39.5, -226) expecting niche 1 and the
 * live interact candidate comes back `canopic-jar`. Throwaway diagnostic: list
 * every interact record in that room so the current build can be diffed against
 * HEAD.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS, dismissBriefing } from './chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4188/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => document.getElementById('begin').click());
await dismissBriefing(page);
await page.waitForTimeout(1200);

const r = await page.evaluate(() => {
  const g = window.__SANDS__;
  const recs = (g.interacts && g.interacts.records) || [];
  const here = recs

    .map((c) => ({
      type: c.type,
      x: +Number(c.x).toFixed(2),
      z: +Number(c.z).toFixed(2),
      id: c.id || (c.config && (c.config.jar || c.config.son)) || '',
      room: c.room,
      d: +Math.hypot(c.x + 39.5, c.z + 226).toFixed(2),
    }))
    .sort((a, b) => a.d - b.d);

  const room = g.interior.rooms.find((x) => x.id === 'embalming-chamber');
  return {
    here,
    total: recs.length,
    bounds: room ? { x: room.x, z: room.z, w: room.w, d: room.d } : null,
  };
});

console.log('');
console.log(`embalming-chamber bounds: ${JSON.stringify(r.bounds)}`);
console.log(`${r.total} interact records in the game; ${r.here.length} in this room`);
console.log('');
console.log('  dist to (-39.5,-226)   type            x        z      id');
for (const c of r.here) {
  console.log(`  ${String(c.d).padStart(8)}  ${String(c.type).padEnd(13)} ${String(c.x).padStart(8)} ${String(c.z).padStart(8)}  ${String(c.room).padEnd(20)} ${c.id}`);
}
console.log('');
if (errors.length) for (const e of errors.slice(0, 4)) console.log(`err ${e}`);

await browser.close();
