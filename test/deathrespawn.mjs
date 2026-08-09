/**
 * THE RUN RESTARTS AT THE BEGINNING, not around the corpse.
 *
 * The owner's report was one sentence: "when I die, I need to spawn back at the
 * beginning, not in the same area where I was in." Before this, `restart()` in
 * ui/death.js reset the director, swept the drops, settled the Altar and stood
 * the player up at full health without ever moving the body - so a death at the
 * far wall restarted wave one at the far wall, and a death in the burial chamber
 * restarted it inside a sealed pyramid.
 *
 * There are two cases and they are not the same operation, which is the whole
 * reason this suite exists rather than one assertion bolted onto deathstrip:
 *
 *   A. DIED OUTSIDE. A teleport back to the courtyard spawn, plus the facing.
 *
 *   B. DIED INSIDE. The player is in a different WORLD - its own colliders, its
 *      own floor sampler, its own bounds, 110 units past the courtyard wall.
 *      Writing courtyard coordinates into a player standing in there would leave
 *      the interior live and put the body outside its rectangle. The return has
 *      to go through systems/spaces.js `enter('exterior')`, which is the only
 *      thing that swaps the world, restores the sky and covers the swap with the
 *      curtain. So B asserts the SPACE as well as the position, and then asserts
 *      that the curtain came back down - a return that strands the player behind
 *      a black sheet has not returned them anywhere.
 *
 * WHAT THIS SUITE REFUSES TO HARDCODE: the spawn. It reads
 * `spaces.courtyard.spawn` out of the running game and compares against that, so
 * a suite that passes is a suite proving the player went where world/courtyard.js
 * says the beginning is, not where this file remembers it being.
 *
 * THE CONTROL. Between the killing blow and the confirm, the body must not have
 * moved at all. ui/death.js's re-entrancy rule is that every world mutation
 * happens in `restart()`, which only ever runs from the frame loop - never from
 * `begin()`, which is called from inside the director's actor loop. A teleport
 * that fired at the moment of death would satisfy every other check in here and
 * would be the exact bug the file was written to design out, so it is checked.
 *
 * Usage: node test/deathrespawn.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { resolveChrome, dismissBriefing } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/death-respawn/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.setDefaultTimeout(180000);

const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[error] ${m.text()}`); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
// BEGIN raises the briefing card now; the world is held behind it. See chrome.mjs.
await dismissBriefing(page);
await page.waitForTimeout(1800);

let n = 0;
const shot = async (name) =>
  page.screenshot({ path: `${OUT}${String(++n).padStart(2, '0')}-${name}.png`, timeout: 180000 });

// The spawn, read from the running game rather than remembered. Everything
// below is measured against these three numbers.
const home = await page.evaluate(() => {
  const s = window.__SANDS__.spaces;
  const v = s.courtyard.spawn;
  return { x: +v.x.toFixed(3), z: +v.z.toFixed(3), wired: !!s };
});

await page.addScriptTag({
  content: `
window.__R__ = {
  async frames(k) {
    for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r));
  },

  /** The killing blow, through the real damage path, and wait for the card. */
  async kill() {
    const g = window.__SANDS__;
    g.player.state.health = 9;
    g.combat.damagePlayer(60, g.player.position.x, g.player.position.z);
    for (let i = 0; i < 900 && g.death.phase !== 'waiting'; i++) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    return g.death.phase;
  },

  /** The way out, clicked by id the way every suite here clicks #begin. */
  async confirm() {
    const g = window.__SANDS__;
    document.getElementById('death-confirm').click();
    for (let i = 0; i < 240 && g.death.phase !== 'none'; i++) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    return g.death.phase;
  },

  /**
   * Where the player is, what world they are in, and what the sheet over the
   * screen is doing. One snapshot shape for every checkpoint, so the two cases
   * are compared on identical terms.
   */
  where() {
    const g = window.__SANDS__;
    const t = g.spaces.transition;
    return {
      x: +g.player.position.x.toFixed(3),
      z: +g.player.position.z.toFixed(3),
      yaw: +g.rig.yaw.toFixed(4),
      space: g.spaces.active,
      room: g.spaces.roomId,
      phase: g.death.phase,
      returned: g.death.stats().returned,
      veil: +t.veil.toFixed(3),
      curtain: t.phase,
      health: Math.round(g.player.state.health),
      wave: g.director.state.wave,
      live: g.director.live.length,
      cardShown: g.death.stats().shown,
      sunIntensity: +(g.sky.sun ? g.sky.sun.intensity : -1).toFixed(3),
    };
  },

  /** Let the curtain finish whatever it is doing, then report. */
  async settled() {
    const g = window.__SANDS__;
    for (let i = 0; i < 400 && g.spaces.transition.phase !== 'idle'; i++) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    await window.__R__.frames(6);
    return window.__R__.where();
  },
};
`,
});

// ---------------------------------------------------------------------------
// A. DIED OUTSIDE, a long way from the spawn.
// ---------------------------------------------------------------------------
//
// Put down at (24, -34): inside the courtyard's playable rectangle, most of the
// way up the avenue toward the pyramid and well off to one side, so a restart
// that does nothing is separated from a restart that works by tens of metres
// rather than by a rounding error.
const outAway = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.player.teleport({ x: 24, y: 0, z: -34 });
  g.rig.reset(2.4, -0.02);
  await window.__R__.frames(10);
  return window.__R__.where();
});
await shot('outside-away-from-spawn');

const outCard = await page.evaluate(async () => {
  await window.__R__.kill();
  return window.__R__.where();
});
await shot('outside-card');

const outAfter = await page.evaluate(async () => {
  await window.__R__.confirm();
  return window.__R__.settled();
});
await shot('outside-after-restart');

// ---------------------------------------------------------------------------
// B. DIED INSIDE the pyramid.
// ---------------------------------------------------------------------------
//
// Staged the way test/deathinside.mjs stages it: buy the doorway, then use the
// router's OWN entry spawn rather than a coordinate this file invented. A
// teleport to a guessed interior position walks straight back out through
// doors.js's exit threshold on the next frame, which is how the first attempt at
// an interior death test ended up photographing a card in the courtyard.
const inEntered = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.economy.grant(4000, 'respawn');
  const d = g.doors.byId('courtyard/entry');
  if (d) d.open();
  await window.__R__.frames(30);

  const mod = await import('../src/world/rooms.js');
  g.spaces.enter('interior', mod.ENTRY.spawn);
  await window.__R__.frames(40);
  return { ...window.__R__.where(), doorOpened: d ? d.opened : null };
});
await shot('inside-alive');

// Walk them deeper than the doorway before the blow lands, so the return is a
// real crossing rather than a step over a threshold they were standing on.
// A room is `{ bounds: { x, z, w, d } }` - the centre is the bounds' own x and
// z, and there is no `cx`. Standing in the middle of the Great Gallery is 37
// units past the entry threshold and two rooms deep, so the way out cannot be
// mistaken for a step backwards over a line the player was already touching.
const inDeep = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const room = g.interior.rooms.find((r) => r.id === 'great-gallery')
    || g.interior.rooms[g.interior.rooms.length - 1];
  g.player.teleport({ x: room.bounds.x, y: 0, z: room.bounds.z });
  await window.__R__.frames(20);
  return { ...window.__R__.where(), roomId: room.id };
});

const inCard = await page.evaluate(async () => {
  await window.__R__.kill();
  return window.__R__.where();
});
await shot('inside-card');

const inAfter = await page.evaluate(async () => {
  await window.__R__.confirm();
  return window.__R__.settled();
});
await shot('inside-after-restart');

// The frame the player is actually looking at once the sheet has lifted. A
// return that leaves them in the dark is a return that failed, and the only
// honest way to ask is to measure the pixels.
const litAfter = await page.evaluate(() => new Promise((resolve) => {
  const c = window.__SANDS__.renderer.domElement;
  const sc = document.createElement('canvas');
  sc.width = c.width; sc.height = c.height;
  const ctx = sc.getContext('2d', { willReadFrequently: true });
  requestAnimationFrame(() => {
    ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(0, 0, sc.width, sc.height).data;
    let sum = 0, count = 0;
    for (let i = 0; i < d.length; i += 64) {
      sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
      count++;
    }
    resolve({ meanLuma: +(sum / count).toFixed(2) });
  });
}));

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

const near = (p, tol = 0.05) =>
  Math.abs(p.x - home.x) <= tol && Math.abs(p.z - home.z) <= tol;

const far = (p) =>
  Math.hypot(p.x - home.x, p.z - home.z) > 10;

const checks = {
  // the fixtures did what they claimed
  'staged away from the spawn outside': far(outAway) && outAway.space === 'exterior',
  'staged inside the pyramid':          inDeep.space === 'interior',
  'the card came up outside':           outCard.phase === 'waiting' && outCard.cardShown,
  'the card came up inside':            inCard.phase === 'waiting' && inCard.cardShown,

  // THE CONTROL: nothing moves at the moment of death, only at the restart
  'the body does not move on death':    outCard.x === outAway.x && outCard.z === outAway.z,
  'the space does not change on death': inCard.space === 'interior',

  // A. outside
  'died outside, back at the spawn':    near(outAfter),
  'and still in the exterior':          outAfter.space === 'exterior',
  'by the teleport route':              outAfter.returned === 'exterior',
  'facing the pyramid again':           Math.abs(outAfter.yaw) < 0.001,

  // B. inside
  'died inside, back in the exterior':  inAfter.space === 'exterior',
  'and back at the courtyard spawn':    near(inAfter),
  'by the router route':                inAfter.returned === 'entered',
  'facing the pyramid again, inside':   Math.abs(inAfter.yaw) < 0.001,
  'no interior room still tracked':     inAfter.room === null,
  'the sky came back on':               inAfter.sunIntensity > 0,

  // the curtain let go of the screen
  'the curtain came down':              inAfter.curtain === 'idle' && inAfter.veil === 0,
  'and the frame is lit':               litAfter.meanLuma > 12,

  // the rest of the reset is untouched by any of this
  'the run restarted, outside':         outAfter.phase === 'none' && !outAfter.cardShown
                                          && outAfter.health === 100 && outAfter.live === 0,
  'the run restarted, inside':          inAfter.phase === 'none' && !inAfter.cardShown
                                          && inAfter.health === 100 && inAfter.live === 0,

  'no page errors':                     errors.length === 0,
};

console.log(JSON.stringify({
  home,
  outside: { away: outAway, atCard: outCard, after: outAfter },
  inside: { entered: inEntered, deep: inDeep, atCard: inCard, after: inAfter, litAfter },
  errors,
}, null, 2));

console.log('\n--- checks ---');
let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

console.log(`\nshots -> ${OUT}`);
console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');

await browser.close();
process.exit(failed ? 1 : 0);
