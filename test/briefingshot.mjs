/**
 * WHAT THE BRIEFING ACTUALLY LOOKS LIKE.
 *
 * `test/briefing.mjs` proves the card behaves. It cannot tell anyone whether it
 * is worth looking at, and this project's owner reviews by eye. So this writes
 * three PNGs to shots/ and prints nothing but paths.
 *
 * Not part of the gate. A tool, not a test.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4188/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.save.clear());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });

await page.click('#begin');

// Mid-reveal: whatever is on screen once the manifest has started.
await page.waitForFunction(() => window.__SANDS__.briefing.stats().index >= 12,
  null, { timeout: 120000 });
await page.screenshot({ path: `${OUT}briefing-typing.png` });

// The full sheet. Caught FAST: hurrying from the reveal fills the document and
// then starts a 260ms fade, so a 300ms wait here photographed the slug instead
// of the page - which is how the first version of this tool produced three
// shots of the same frame.
await page.keyboard.press('KeyE');
await page.waitForTimeout(60);
await page.screenshot({ path: `${OUT}briefing-full.png` });

// The slug, armed, so the confirm is in frame.
await page.waitForTimeout(400);
await page.keyboard.press('KeyE');
await page.waitForFunction(() => window.__SANDS__.briefing.stats().phase === 'waiting',
  null, { timeout: 20000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}briefing-slug.png` });

console.log(`${OUT}briefing-typing.png`);
console.log(`${OUT}briefing-full.png`);
console.log(`${OUT}briefing-slug.png`);
await browser.close();
