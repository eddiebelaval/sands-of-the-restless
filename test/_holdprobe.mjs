/**
 * DOES TAKING A JAR FREEZE THE WORLD, AND DOES IT LET GO.
 *
 * `jars.onTake` now raises a memory fragment, and main.js's frame loop returns
 * early while `tableau.holding` is true. If that hold is still up when the next
 * thing happens, every live system - interacts included - is reading state from
 * before the jar was taken. Throwaway diagnostic.
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
await page.waitForTimeout(1400);

const r = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const frames = async (n) => {
    for (let i = 0; i < n; i++) await new Promise((res) => requestAnimationFrame(res));
  };

  const has = { tableau: !!g.tableau, fragments: !!g.fragments };
  const before = g.tableau ? g.tableau.holding : null;

  // Stand at the outside jar the way test/jars.mjs does and take it.
  const j = g.jars.jars.find((x) => x.id === 'jar:imsety');
  const target = j.group.localToWorld(new g.THREE.Vector3(0, 1.4, 0));
  g.player.teleport({ x: -19, y: 0, z: 25.5 });
  for (let i = 0; i < 220; i++) {
    g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
    if (g.player.state.grounded) break;
  }
  const dx = target.x - g.player.position.x, dz = target.z - g.player.position.z;
  g.rig.reset(Math.atan2(-dx, -dz), 0);
  await frames(4);

  const candBefore = g.interacts.candidate && g.interacts.candidate.id;

  // Take it, through the real key.
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', bubbles: true }));
  await frames(6);

  const holdingAfterTake = g.tableau ? g.tableau.holding : null;
  const carrying = g.jars.stats().carrying;

  // Now do what the suite does next: cross into the interior and stand at a
  // niche. If the world is held, none of this reaches any live system.
  g.spaces.enter('interior', { x: -39.5, z: -226, rot: Math.PI / 2 });
  await frames(4);

  const heldAtNiche = g.tableau ? g.tableau.holding : null;
  const candAtNiche = g.interacts.candidate && g.interacts.candidate.type;
  const promptAtNiche = document.getElementById('prompt').textContent;

  // Does it let go on a keypress, the way the player would dismiss it?
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
  await frames(30);
  const heldAfterKey = g.tableau ? g.tableau.holding : null;

  // And does it let go on its own, given time?
  await new Promise((res) => setTimeout(res, 4000));
  await frames(20);
  const heldAfterWait = g.tableau ? g.tableau.holding : null;

  return {
    has, before, candBefore, carrying,
    holdingAfterTake, heldAtNiche, candAtNiche, promptAtNiche,
    heldAfterKey, heldAfterWait,
    room: g.spaces.roomId,
  };
});

console.log('');
console.log(`tableau present: ${r.has.tableau}   fragments: ${r.has.fragments}`);
console.log(`holding at rest, before anything:     ${r.before}`);
console.log(`candidate before the take:            ${r.candBefore}`);
console.log(`carrying after the take:              ${r.carrying}`);
console.log('');
console.log(`HOLDING right after the take:         ${r.holdingAfterTake}`);
console.log(`HOLDING once inside at the niche:     ${r.heldAtNiche}`);
console.log(`  room ${r.room}   candidate ${r.candAtNiche}   prompt "${String(r.promptAtNiche).trim()}"`);
console.log('');
console.log(`holding after a keypress:             ${r.heldAfterKey}`);
console.log(`holding after 4 more seconds:         ${r.heldAfterWait}`);
console.log('');
if (errors.length) for (const e of errors.slice(0, 5)) console.log(`err ${e}`);

await browser.close();
