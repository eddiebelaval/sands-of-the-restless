/**
 * The two deaths that are not a clean death in an open courtyard.
 *
 * A: DYING MID-RITUAL. The player's weapon is inside the Altar and the machine
 *    is working when the blow lands. Nothing may be left holding it.
 *
 * B: DYING MID-TRANSITION. The door lane is building a fade-to-black pyramid
 *    entry in systems/doors.js and systems/spaces.js, which this lane does not
 *    touch. What CAN be staged today is the door's own in-flight state: a
 *    barrier with `opening: true`. The claim under test is the exemption in
 *    main.js - the door keeps its delta while the run is held, so an animation
 *    that was running when the player died finishes rather than freezing. If a
 *    curtain is driven from doors.update it lifts for the same reason.
 *
 * Usage: node test/deathedge.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:4591/index.html';
const OUT = new URL('../shots/death-edge/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.setDefaultTimeout(180000);
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1800);

let n = 0;
const shot = async (name) =>
  page.screenshot({ path: `${OUT}${String(++n).padStart(2, '0')}-${name}.png`, timeout: 180000 });

const kill = () => page.evaluate(async () => {
  const g = window.__SANDS__;
  g.player.state.health = 8;
  g.combat.damagePlayer(50, g.player.position.x, g.player.position.z);
  for (let i = 0; i < 900 && g.death.phase !== 'waiting'; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  return g.death.phase;
});

const confirm = () => page.evaluate(async () => {
  const g = window.__SANDS__;
  document.getElementById('death-confirm').click();
  for (let i = 0; i < 240 && g.death.phase !== 'none'; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  return g.death.phase;
});

// ---------------------------------------------------------------------------
// A. the Altar mid-ritual
// ---------------------------------------------------------------------------
const altarBefore = await page.evaluate(() => {
  const g = window.__SANDS__;
  g.economy.grant(6000, 'edge');
  const rec = g.interacts.records.find((r) => r.type === 'altar');
  if (!rec) return { error: 'no altar fixture' };
  const ok = g.altar.buy(rec);          // beat one: gold goes, weapon goes in
  return {
    inserted: ok,
    phase: g.altar.state.phase,
    held: g.altar.state.held,
    paid: g.altar.state.paid,
    remaining: +g.altar.state.remaining.toFixed(2),
    inHand: g.weapons.state.current,
    stowed: g.weapons.state.stowed,
    gold: g.economy.gold,
    upgradedBefore: g.weapons.isUpgraded('mk9'),
  };
});

const altarDeath = await kill();
await shot('altar-midritual-card');

const altarHeld = await page.evaluate(() => {
  const g = window.__SANDS__;
  return { phase: g.altar.state.phase, remaining: +g.altar.state.remaining.toFixed(2) };
});

await confirm();
await page.waitForTimeout(500);

const altarAfter = await page.evaluate(() => {
  const g = window.__SANDS__;
  return {
    phase: g.altar.state.phase,
    held: g.altar.state.held,
    remaining: g.altar.state.remaining,
    presented: !!g.altar.presented,
    inHand: g.weapons.state.current,
    stowed: g.weapons.state.stowed,
    upgraded: g.weapons.isUpgraded('mk9'),
    gold: g.economy.gold,
    wave: g.director.state.wave,
    live: g.director.live.length,
    health: Math.round(g.player.state.health),
  };
});
await shot('altar-after-reset');

// ---------------------------------------------------------------------------
// B. dying with a door transition in flight
// ---------------------------------------------------------------------------
const doorBefore = await page.evaluate(() => {
  const g = window.__SANDS__;
  g.economy.grant(4000, 'edge');
  const d = g.doors.byId('courtyard/entry') || g.doors.all[0];
  if (!d) return { error: 'no door' };
  d.open();                              // start the swing
  return { id: d.id, opening: d.opening, opened: d.opened };
});

const doorDeath = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.doors.byId('courtyard/entry') || g.doors.all[0];
  // Kill on the very next frame, while the barrier is still moving.
  g.player.state.health = 8;
  g.combat.damagePlayer(50, g.player.position.x, g.player.position.z);
  const atDeath = { opening: d.opening, opened: d.opened };

  for (let i = 0; i < 900 && g.death.phase !== 'waiting'; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  return { atDeath, phase: g.death.phase, opening: d.opening, opened: d.opened };
});
await shot('door-inflight-card');

// Hold on the card for three seconds of SIM time and watch the door. It must
// have FINISHED - frozen half-open is the failure this exemption prevents.
const doorHeld = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.doors.byId('courtyard/entry') || g.doors.all[0];
  const t0 = g.death.state.t;
  let frames = 0;
  while (g.death.state.t - t0 < 3.0 && frames < 2000) {
    frames++;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return {
    stillWaiting: g.death.phase === 'waiting',
    opening: d.opening, opened: d.opened,
    // The world stayed stopped around it.
    live: g.director.live.length,
    wave: g.director.state.wave,
    health: +g.player.state.health.toFixed(2),
  };
});

await confirm();
await page.waitForTimeout(400);

const doorAfter = await page.evaluate(() => {
  const g = window.__SANDS__;
  const d = g.doors.byId('courtyard/entry') || g.doors.all[0];
  return {
    opening: d.opening, opened: d.opened,
    space: g.spaces.active, room: g.spaces.roomId,
    wave: g.director.state.wave, live: g.director.live.length,
    health: Math.round(g.player.state.health),
    resets: g.death.state.resets,
  };
});

// ---------------------------------------------------------------------------
// C. dying INSIDE the pyramid - the card has to read over a dark interior too
// ---------------------------------------------------------------------------
const inside = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const room = g.interior.rooms[0];
  g.spaces.enter('interior', { x: room.cx ?? 0, z: room.cz ?? 0 });
  for (let i = 0; i < 40; i++) await new Promise((r) => requestAnimationFrame(r));
  return { space: g.spaces.active, room: g.spaces.roomId };
});
await kill();
await page.waitForTimeout(200);
await shot('interior-card');

const insideAfter = await page.evaluate(() => {
  const g = window.__SANDS__;
  return { space: g.spaces.active, room: g.spaces.roomId, phase: g.death.phase };
});
await confirm();
await page.waitForTimeout(500);
await shot('interior-after');

const insideReset = await page.evaluate(() => {
  const g = window.__SANDS__;
  return {
    space: g.spaces.active, room: g.spaces.roomId,
    wave: g.director.state.wave, live: g.director.live.length,
    health: Math.round(g.player.state.health), resets: g.death.state.resets,
    cardShown: g.death.stats().shown,
  };
});

console.log(JSON.stringify({
  altar: { before: altarBefore, deathPhase: altarDeath, heldDuringCard: altarHeld, after: altarAfter },
  door: { before: doorBefore, death: doorDeath, held: doorHeld, after: doorAfter },
  interior: { entered: inside, atCard: insideAfter, afterReset: insideReset },
  errors: logs,
}, null, 2));
console.log('\nstrip -> ' + OUT);

await browser.close();
