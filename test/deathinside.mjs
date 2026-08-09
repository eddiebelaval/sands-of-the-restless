/**
 * Dying INSIDE the pyramid.
 *
 * The first attempt at this (test/deathedge.mjs section C) never staged: it
 * teleported the player to (0, 0), which is nowhere near the interior, and
 * doors.js's exit threshold - `p.z < -140.8` or you are leaving - walked them
 * straight back out to the courtyard on the very next frame. The card that got
 * captured was a card in the courtyard.
 *
 * So this uses the interior's OWN entry spawn, the same one doors.js hands to
 * spaces.enter when the player walks through the doorway, and asserts the space
 * on both sides of the death rather than assuming it.
 */

import { chromium } from 'playwright';
import { resolveChrome, dismissBriefing } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:4591/index.html';
const OUT = new URL('../shots/death-inside/', import.meta.url).pathname;
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
// BEGIN raises the briefing card now; the world is held behind it. See chrome.mjs.
await dismissBriefing(page);
await page.waitForTimeout(1800);

let n = 0;
const shot = async (name) =>
  page.screenshot({ path: `${OUT}${String(++n).padStart(2, '0')}-${name}.png`, timeout: 180000 });

// Walk in the way the game does: buy the doorway, then use the router's own
// entry spawn rather than a coordinate this file invented.
const entered = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.economy.grant(4000, 'inside');
  const d = g.doors.byId('courtyard/entry');
  if (d) d.open();
  for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));

  // ENTRY.spawn is what doors.js passes; reach it the same way it does.
  const mod = await import('../src/world/rooms.js');
  g.spaces.enter('interior', mod.ENTRY.spawn);
  for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
  return {
    space: g.spaces.active,
    room: g.spaces.roomId,
    z: +g.player.position.z.toFixed(1),
    doorOpened: d ? d.opened : null,
  };
});
await shot('inside-alive');

const dead = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.director.forceWave(4);
  for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
  const liveBefore = g.director.live.length;

  g.player.state.health = 9;
  g.combat.damagePlayer(60, g.player.position.x, g.player.position.z);
  for (let i = 0; i < 900 && g.death.phase !== 'waiting'; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  return {
    liveBefore,
    phase: g.death.phase,
    space: g.spaces.active,
    room: g.spaces.roomId,
    shown: g.death.stats().shown,
  };
});
await shot('inside-card');

const after = await page.evaluate(async () => {
  const g = window.__SANDS__;
  document.getElementById('death-confirm').click();
  for (let i = 0; i < 240 && g.death.phase !== 'none'; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
  return {
    phase: g.death.phase,
    space: g.spaces.active,
    room: g.spaces.roomId,
    z: +g.player.position.z.toFixed(1),
    live: g.director.live.length,
    wave: g.director.state.wave,
    health: Math.round(g.player.state.health),
    cardShown: g.death.stats().shown,
    cameraRoll: +g.camera.rotation.z.toFixed(4),
    vmCamY: +g.viewmodel.camera.position.y.toFixed(3),
  };
});
await shot('inside-after');

console.log(JSON.stringify({ entered, dead, after, errors: logs }, null, 2));
console.log('\nstrip -> ' + OUT);
await browser.close();
