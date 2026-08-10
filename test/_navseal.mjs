/**
 * THROWAWAY: WHICH colliders seal the corridor to the Quarry claim?
 *
 * The transect in test/_navclaim.mjs shows the flow field losing the route at
 * (9.0, 17.5) on the World 1 arc and holding it on the control at 9fa14f8. This
 * lists every collider near that point on whichever build it is pointed at, so
 * the two lists can be diffed and the culprit NAMED rather than guessed at from
 * camp.js coordinates that merely look close.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS, dismissBriefing, waitForWorld } from './chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4188/index.html';

const browser = await chromium.launch({ executablePath: resolveChrome(), args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start());
await dismissBriefing(page);
await waitForWorld(page);

const r = await page.evaluate(() => {
  const g = window.__SANDS__;
  // The whole corridor, not just the one dead sample: the seal is a wall and a
  // wall is several cylinders.
  const CORRIDOR = [[7.5, 16.3], [9.0, 17.5], [10.5, 18.8], [12.0, 20.0], [13.5, 21.3]];
  const hits = new Map();
  for (const [x, z] of CORRIDOR) {
    for (const c of (g.world.colliders || [])) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d > 2.6) continue;
      const key = `${c.x.toFixed(2)},${c.z.toFixed(2)},${(c.r || 0).toFixed(2)}`;
      if (!hits.has(key)) {
        hits.set(key, { x: +c.x.toFixed(2), z: +c.z.toFixed(2),
                        r: +(c.r || 0).toFixed(2), h: +(c.h || 0).toFixed(2) });
      }
    }
  }
  return { total: (g.world.colliders || []).length,
           near: Array.from(hits.values()).sort((a, b) => a.x - b.x || a.z - b.z) };
});

console.log(JSON.stringify(r));
await browser.close();
