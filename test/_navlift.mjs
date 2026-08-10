/**
 * THIS PROBE DID NOT WORK. ITS NUMBERS ARE INVALID. DO NOT QUOTE THEM.
 *
 * Run 2026-08-09 against the arc build, it returned -1 at EVERY sample on both
 * legs - including the yard at (0,10), where test/_navclaim.mjs reads 20.3 - and
 * `d.stats().flow` came back `valid: false, builds: 0`. Mutating
 * `world.colliders` in place and calling `flow.invalidate()` left the field
 * never rebuilt, so the "before" and "after" it compared were both measurements
 * of a field that did not exist. It cannot tell you whether lifting the tent
 * opens the route, and a reader who trusts its zeros will conclude the corridor
 * is sealed by something other than the camp.
 *
 * Kept rather than deleted so the next person does not spend the same hour
 * inventing it. To make it honest it needs a real rebuild path - find what
 * director.js:1393 does with `flow.rebuild(ctx, px, pz, feetY)` and drive that,
 * then assert `valid === true` BEFORE reading any cost. A probe that does not
 * check its own instrument is the thing this project keeps relearning.
 *
 * ---------------------------------------------------------------------------
 *
 * THROWAWAY, AND IT IS AN EXPERIMENT RATHER THAN A TEST.
 *
 * The corridor from the yard to the Quarry claim gained 90 colliders in the
 * World 1 arc, all h~1.43, spanning x 8.04..10.76 and z 15.25..18.35 - the exact
 * footprint of camp.js's `ridge` tent at (9.4, 16.8), 2.6 x 3.2, solid.
 *
 * Rather than move art on a hunch and pay a multi-minute nav run per guess, this
 * LIFTS that footprint out of world.colliders at runtime, rebuilds the flow
 * field, and re-measures the route. If the route opens, the tent is the whole
 * cause and the fix is a coordinate. If it does not, the camp seals the approach
 * in more than one place and moving one tent would have been a fix that did not
 * fix anything - which is worth knowing BEFORE editing the map.
 *
 * Nothing here is a claim about the shipping build; it deliberately mutates it.
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

const r = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;
  const out = {};

  const settle = () => {
    g.player.teleport({ x: 0, y: 0, z: 30 });
    for (let i = 0; i < 220; i++) {
      g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
      if (g.player.state.grounded) break;
    }
  };

  const measure = () => {
    const claim = (g.courtyard.claims || []).find((c) => c.id === 'courtyard/quarry');
    d.reset();
    settle();
    for (let i = 0; i < 6; i++) d.update(1 / 30, i / 30);
    if (!claim.opened && !claim.opening) claim.open();
    for (let i = 0; i < 8; i++) d.update(1 / 30, i / 30);
    const line = [];
    for (let t = 0; t <= 10; t++) {
      const x = (15 * t) / 10;
      const z = 10 + (12.5 * t) / 10;
      line.push(+d.flow.costAt(x, z, undefined).toFixed(1));
    }
    return { atMouth: +d.flow.costAt(15, 22.5, undefined).toFixed(1), line };
  };

  out.before = measure();

  // LIFT the tent footprint. Bounds come from the measured cluster, not from
  // camp.js - the point is to remove what is THERE, whatever authored it.
  const cols = g.world.colliders;
  const kept = cols.filter((c) => !(c.x >= 7.9 && c.x <= 10.9 && c.z >= 15.1 && c.z <= 18.5
                                    && (c.h || 0) > 1.0 && (c.h || 0) < 2.0));
  out.lifted = cols.length - kept.length;
  cols.length = 0;
  for (const c of kept) cols.push(c);

  // Force the field to notice. reset() alone reuses geometry in some paths.
  if (d.flow.invalidate) d.flow.invalidate();
  else if (d.flow.rebuild) d.flow.rebuild();
  d.reset();
  for (let i = 0; i < 10; i++) d.update(1 / 30, i / 30);

  out.after = measure();
  out.flow = d.stats().flow;
  return out;
});

console.log(JSON.stringify(r, null, 1));
await browser.close();
