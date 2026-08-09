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

/**
 * GET PAST THE BRIEFING, WHICH NOW STANDS BETWEEN BEGIN AND THE WORLD.
 *
 * ---------------------------------------------------------------------------
 * WHAT HAPPENED
 * ---------------------------------------------------------------------------
 *
 * Thirty-nine suites in this directory boot the same way:
 *
 *     await page.evaluate(() => document.getElementById('begin').click());
 *     await page.waitForTimeout(1400);
 *
 * That was a complete boot for the whole life of the project. On 2026-08-08 it
 * stopped being one. `ui/briefing.js` landed, `#begin` now calls
 * `briefing.show(enterWorld)` instead of entering the world, and main.js's frame
 * loop returns early on `briefing.holding` - so the click opens a card and the
 * simulation never starts.
 *
 * Nothing errored. The page was healthy, `window.__SANDS__` was there, every
 * handle answered. The world simply never advanced, so every check downstream
 * failed on its own terms: `jars` went 38 for 38, `interior` 30, `hud` lost a
 * 213-check baseline. Four lanes were writing that night and the failures read
 * like four different regressions. They were one line of boot contract.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LIVES HERE AND NOT IN THIRTY-NINE FILES
 * ---------------------------------------------------------------------------
 *
 * `feedback-recurrence-means-the-fix-shape-was-wrong`: N edited literals leave
 * N places to break. The next thing that lands in front of the world - a
 * publisher card, a save-slot picker, a warning screen - would do this again to
 * all thirty-nine. One function means it does it to one.
 *
 * IT IS NOT AN AUTOMATION BACK DOOR. `finish()` is the exact call the card's own
 * Enter key and its GO button make; there is no branch here that the player does
 * not also take, and the game is not told it is being tested. The card's own
 * behaviour - the typing, the codec ticks, the skip, the hold - is covered by
 * `test/briefing.mjs`, which drives the real element and must stay that way.
 *
 * Deliberately tolerant of a page with no briefing at all, so this same call is
 * correct against an older checkout used as a control build.
 */
export async function dismissBriefing(page) {
  await page.evaluate(() => {
    const b = window.__SANDS__ && window.__SANDS__.briefing;
    if (b && b.finish) b.finish();
  });
}

/**
 * WAIT UNTIL THE WORLD IS ACTUALLY RUNNING.
 *
 * ---------------------------------------------------------------------------
 * THE THIRD INSTANCE OF ONE BUG, WHICH IS WHY THIS IS HERE AND NOT IN A SUITE
 * ---------------------------------------------------------------------------
 *
 * main.js's frame loop returns EARLY while anything is holding the world. Three
 * things hold it today - `briefing.holding`, `tableau.holding` and
 * `meeting.holding` - and while any is up, every live system stops: the
 * interact raycast, the director, the objective panel, all of it.
 *
 * The third one arrived on 2026-08-09 and is the first one the PLAYER raises:
 * it starts when F is pressed in the Serdab. It is registered here anyway. This
 * function's name is a question about the world, not about a menu, and the cost
 * of an entry that can never be true at boot is nothing.
 *
 * A suite that keeps going through a hold does not fail with "the world was
 * paused". It fails with whatever it was going to assert anyway, in the voice
 * of the thing it was testing:
 *
 *   `hud`, `interior`, `jars` and 36 others  - the briefing held at BEGIN, so
 *       the sim never started. `jars` reported the ENDING broken, 38 for 38.
 *   `jars` again - a memory fragment held after the first take, so it walked
 *       into the Embalming Chamber and read the courtyard plinth it had left.
 *   `e2e` - same fragment, and it reported "jars returned 1" with nine failures
 *       describing a dead machine and a missing end card.
 *
 * Three lanes chased phantom bugs across two nights. `feedback-recurrence-means
 * -the-fix-shape-was-wrong`: the third occurrence is the signal that per-file
 * copies are the wrong shape. **Anything that lands in front of the world from
 * now on gets added HERE, once.**
 *
 * WAITS ON STATE, NEVER ON A CLOCK. The fragment lets go on its own after about
 * four seconds of wall clock and answers no keypress - both measured, see
 * `test/_holdprobe.mjs` - and under swiftshader with several lanes running,
 * four seconds can be a handful of frames. A fixed sleep would be measuring the
 * machine. The timeout is a safety net so a stuck hold fails loudly rather than
 * hanging, and it RETURNS FALSE rather than throwing so a caller can assert on
 * it.
 */
export async function waitForWorld(page, timeoutMs = 30000) {
  try {
    await page.waitForFunction(() => {
      const g = window.__SANDS__;
      if (!g) return false;
      const held = (g.briefing && g.briefing.holding)
        || (g.tableau && g.tableau.holding)
        || (g.meeting && g.meeting.holding);
      return !held;
    }, null, { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}
