/**
 * THROWAWAY: photograph all four memory fragments at a real viewport.
 *
 * The owner hit these while PLAYING on 2026-08-09 and reported: "every time I
 * grab a jar the screen goes black and then I have these geometric figures. It
 * looks like shit."
 *
 * All four beats are marked WIRED in docs/PLAYTHROUGH.md, which in this project
 * means the suite gates them and NOBODY HAS WATCHED THEM. test/tableau.mjs
 * proves the driver runs, the curtain fades and the composer is not
 * reconfigured - all true, and none of it is a claim about whether the picture
 * reads. This file makes the picture, so the fix is argued from the frame.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS, dismissBriefing, waitForWorld } from './chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4188/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;

const browser = await chromium.launch({ executablePath: resolveChrome(), args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start());
await dismissBriefing(page);
await waitForWorld(page);

await page.addScriptTag({
  type: 'module',
  content: `
    import { WORLD_1_FRAGMENTS } from '/src/story/fragments.js';
    window.__FRAGS__ = WORLD_1_FRAGMENTS;
  `,
});
await page.waitForFunction(() => !!window.__FRAGS__, null, { timeout: 30000 });

const n = await page.evaluate(() => window.__FRAGS__.length);
console.log('fragments:', n);

for (let i = 0; i < n; i++) {
  const info = await page.evaluate(async (k) => {
    const g = window.__SANDS__;
    const t = g.tableau;
    t.finish();
    for (let f = 0; f < 60 && t.holding; f++) {
      await new Promise((r) => requestAnimationFrame(r));
    }

    const rec = window.__FRAGS__[k];
    const ok = t.show(rec);

    // Sit in the MIDDLE of the hold, where the player's eye is: past the fade
    // in, before the fade out. Waits on the phase, never on a clock.
    for (let f = 0; f < 300; f++) {
      await new Promise((r) => requestAnimationFrame(r));
      const s = t.stats();
      if (s.phase === 'hold') break;
    }
    const s = t.stats();
    return {
      ok,
      id: rec.id || null,
      phase: s.phase,
      stills: rec.stills.length,
      shapes: rec.stills.map((x) => (x.shapes || []).length),
    };
  }, i);

  await page.screenshot({ path: `${OUT}frag-${i}.png` });
  console.log(`fragment ${i}  ${info.id}  ok=${info.ok}  phase=${info.phase}  stills=${info.stills}  shapes=${JSON.stringify(info.shapes)}`);
}

await browser.close();
