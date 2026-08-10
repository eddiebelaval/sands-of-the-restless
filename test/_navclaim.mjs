/**
 * THROWAWAY: why does "buying the courtyard claim opens a route" fail now?
 *
 * `test/nav.mjs` passes on the control build at 9fa14f8 and fails on the World 1
 * arc, on exactly one check: after `claim.open()`, `flow.costAt(claim.x,
 * claim.z)` is expected to be > 0 and is not. Everything else in nav is green,
 * including the INTERIOR twin of the same pair.
 *
 * This reproduces just that block and prints what nav.mjs does not: which claim,
 * where it is, both cost samples, and every collider within 4 m of the mouth -
 * because the obvious suspect is that something the arc added is standing in it.
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

  g.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
  g.spaces.enter('exterior', { x: 0, z: 30, rot: 0 });
  for (let i = 0; i < 4; i++) d.update(1 / 30, i / 30);

  const all = (g.courtyard.claims || []).map((c) => ({
    id: c.id, x: +c.x.toFixed(2), z: +c.z.toFixed(2),
    opened: c.opened, opening: c.opening,
  }));

  const claim = (g.courtyard.claims || []).find((c) => !c.opened && !c.opening);
  if (!claim) return { all, skipped: 'no unopened claim' };

  g.player.teleport({ x: 0, y: 0, z: 30 });
  for (let i = 0; i < 220; i++) {
    g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
    if (g.player.state.grounded) break;
  }
  d.reset();
  d.placeAt('shambler', claim.x, claim.z);
  d.update(1 / 30, 0);
  const before = d.flow.costAt(claim.x, claim.z, undefined);

  claim.open();
  d.update(1 / 30, 1 / 30);
  const after = d.flow.costAt(claim.x, claim.z, undefined);

  // Give it more frames: if it opens LATE, the defect is timing and not blockage.
  const later = [];
  for (let i = 2; i < 12; i++) {
    d.update(1 / 30, i / 30);
    later.push(+d.flow.costAt(claim.x, claim.z, undefined).toFixed(1));
  }

  // Anything standing in the mouth.
  const near = (g.world.colliders || [])
    .map((c) => ({ d: Math.hypot(c.x - claim.x, c.z - claim.z), c }))
    .filter((o) => o.d < 4)
    .sort((a, b) => a.d - b.d)
    .slice(0, 8)
    .map((o) => ({ at: +o.d.toFixed(2), x: +o.c.x.toFixed(2), z: +o.c.z.toFixed(2),
                   r: +(o.c.r || 0).toFixed(2), h: +(o.c.h || 0).toFixed(2) }));

  // TRANSECT: cost from the yard toward the mouth. A pocket of -1 only near the
  // claim means geometry seals it. -1 across the yard means the FIELD failed.
  const transect = [];
  for (let t = 0; t <= 10; t++) {
    const x = 0 + (claim.x - 0) * (t / 10);
    const z = 10 + (claim.z - 10) * (t / 10);
    transect.push([+x.toFixed(1), +z.toFixed(1), +d.flow.costAt(x, z, undefined).toFixed(1)]);
  }

  return {
    all,
    transect,
    flow: d.stats().flow,
    claim: claim.id,
    at: [+claim.x.toFixed(2), +claim.z.toFixed(2)],
    routeShut: +before.toFixed(1),
    routeOpen: +after.toFixed(1),
    later,
    opened: claim.opened, opening: claim.opening,
    colliders: (g.world.colliders || []).length,
    near,
  };
});

console.log(JSON.stringify(r, null, 1));
await browser.close();
