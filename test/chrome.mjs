/**
 * Resolve a usable Chrome binary.
 *
 * Hardcoding a Playwright browser revision path breaks the moment Playwright
 * updates and installs a new build number, which happened mid-session here:
 * every harness started failing with "executable doesn't exist" on a path that
 * was correct an hour earlier. Scan for whatever is actually installed instead.
 *
 * CHROME_BIN overrides everything, for CI or an unusual install.
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE = join(homedir(), 'Library/Caches/ms-playwright');

const CANDIDATE_SUFFIXES = [
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
];

const SYSTEM = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

export function resolveChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;

  if (existsSync(CACHE)) {
    // Highest build number first, so we track the newest install.
    const dirs = readdirSync(CACHE)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));

    for (const d of dirs) {
      for (const suffix of CANDIDATE_SUFFIXES) {
        const p = join(CACHE, d, suffix);
        if (existsSync(p)) return p;
      }
    }
  }

  for (const p of SYSTEM) if (existsSync(p)) return p;

  throw new Error(
    'No Chrome binary found. Run `npx playwright install chromium` or set CHROME_BIN.'
  );
}

/** Args that make headless WebGL work on any machine, including CI. */
export const GL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];
