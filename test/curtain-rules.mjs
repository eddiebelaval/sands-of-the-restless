/**
 * The interruption rules, checked rather than asserted in a comment.
 *
 *   1. Walking backwards out of the doorway lightens the screen again, on the
 *      same frame, because the fade out is a function of position and not a
 *      timer that has been started.
 *   2. Pausing mid-transition leaves the pause panel readable. A curtain that
 *      outranks the menu is a soft lock that looks like a crash.
 *   3. Resuming finishes the transition rather than leaving it hung.
 *   4. Dying inside does not strand the player behind a curtain.
 *   5. LOW fidelity still gets the curtain, because it is not in the composer.
 *
 * Usage:  node test/curtain-rules.mjs <url>
 */

import { chromium } from 'playwright';
import { resolveChrome, dismissBriefing } from './chrome.mjs';

// Two defects in one line, and the second is why `npm test` has never passed in
// one invocation: 4581 is served by nothing (4177 is what `npm start` serves and
// what every other suite defaults to), and this was the only suite in the
// directory with no SANDS_URL escape, so it could not even be pointed elsewhere.
const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 560 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
// BEGIN raises the briefing card now; the world is held behind it. See chrome.mjs.
await dismissBriefing(page);
await page.waitForTimeout(1400);

await page.evaluate(() => {
  const g = window.__SANDS__;
  g.economy.grant(4000);
  window.__C__ = {
    async frames(n) { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); },
    place(x, z, yaw) { g.player.teleport({ x, y: 0, z }); g.rig.reset(yaw, -0.02); },
    veil() {
      const el = document.getElementById('curtain');
      if (!el) return 0;
      const cs = getComputedStyle(el);
      return cs.visibility === 'hidden' ? 0 : +parseFloat(cs.opacity || '0').toFixed(3);
    },
    key(code, down = true) {
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    },
  };
});

// Buy the door.
await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.combat.state.invulnerable = true;
  window.__C__.place(0, -24, 0);
  await window.__C__.frames(3);
  window.__C__.key('KeyF');
  await window.__C__.frames(2);
  window.__C__.key('KeyF', false);
  let f = 0;
  while (!g.doors.byId('courtyard/entry').opened && f < 300) {
    await new Promise((r) => requestAnimationFrame(r)); f++;
  }
});

// --- 1. walking back out of the fade lightens it again ----------------------
const reversible = await page.evaluate(async () => {
  const out = [];
  for (const z of [-27.0, -28.4, -29.6, -28.4, -27.0]) {
    window.__C__.place(0, z, 0);
    await window.__C__.frames(2);
    out.push({ z, veil: window.__C__.veil() });
  }
  return out;
});

// --- 2 + 3. pause and resume mid-transition ---------------------------------
const paused = await page.evaluate(async () => {
  const g = window.__SANDS__;

  // Put them one step short of the line and walk in for real.
  window.__C__.place(0, -31.0, 0);
  await window.__C__.frames(2);
  window.__C__.key('KeyW');

  // Step until the swap lands, then pause immediately - inside the hold.
  let f = 0;
  while (g.spaces.active !== 'interior' && f < 60) {
    await new Promise((r) => requestAnimationFrame(r)); f++;
  }
  window.__C__.key('KeyW', false);
  g.pause.open();
  await window.__C__.frames(3);

  const panel = document.getElementById('pause');
  const curtain = document.getElementById('curtain');
  const zPanel = +getComputedStyle(panel).zIndex || 0;
  const zCurtain = +getComputedStyle(curtain).zIndex || 0;

  const state = {
    swappedAfterFrames: f,
    veilWhilePaused: window.__C__.veil(),
    phaseWhilePaused: g.spaces.transition.phase,
    panelVisible: !panel.hidden,
    panelAboveCurtain: zPanel > zCurtain,
    zPanel, zCurtain,
  };

  g.pause.resume();
  let r = 0;
  while (window.__C__.veil() > 0 && r < 200) {
    await new Promise((res) => requestAnimationFrame(res)); r++;
  }
  state.veilAfterResume = window.__C__.veil();
  state.framesToClear = r;
  return state;
});

// --- 4. dying mid-transition -------------------------------------------------
//
// The arming rule means the doorway just walked through is inert until the
// player has genuinely left it, so getting back out takes a walk to the far
// side of the fade zone first. Skipping that step is what made the first
// version of this test measure nothing.
const died = await page.evaluate(async () => {
  const g = window.__SANDS__;

  window.__C__.place(0, -150, 0);          // clear of the exit's fade zone: re-arms
  await window.__C__.frames(3);
  const rearmed = g.doors.armed;

  window.__C__.place(0, -142.5, Math.PI);  // back at the entry wall, facing out
  await window.__C__.frames(2);
  window.__C__.key('KeyW');

  let f = 0;
  while (g.spaces.active !== 'exterior' && f < 90) {
    await new Promise((r) => requestAnimationFrame(r)); f++;
  }
  window.__C__.key('KeyW', false);

  // Kill them while the curtain is still up.
  const veilAtDeath = window.__C__.veil();
  const phaseAtDeath = g.spaces.transition.phase;
  const downsBefore = g.combat.state.downs;
  g.combat.state.invulnerable = false;
  g.player.state.health = 0;
  await window.__C__.frames(3);
  // NOT asserted on `downs`. That counter belongs to damage.js and only moves
  // when damage.js is the thing that killed you; zeroing health from outside
  // is a state change it never sees. What is being tested here is the
  // curtain's promise, not the damage system's - so the signal is health, and
  // the claim is that a hard state change at full black still lifts.
  const healthAfter = g.player.state.health;

  let r = 0;
  while (window.__C__.veil() > 0 && r < 200) {
    await new Promise((res) => requestAnimationFrame(res)); r++;
  }
  return {
    rearmed,
    crossedAfterFrames: f,
    veilAtDeath,
    phaseAtDeath,
    downsBefore,
    healthAfter,
    veilAfter: window.__C__.veil(),
    framesToClear: r,
    space: g.spaces.active,
  };
});

// --- 5. LOW fidelity ---------------------------------------------------------
const low = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.combat.state.invulnerable = true;
  g.setFidelity(false);
  await window.__C__.frames(3);

  window.__C__.place(0, -20, 0);       // clear of the entry fade zone: re-arms
  await window.__C__.frames(3);
  const rearmed = g.doors.armed;

  window.__C__.place(0, -29.6, 0);
  await window.__C__.frames(2);
  return { rearmed, space: g.spaces.active, veil: window.__C__.veil() };
});

await browser.close();

const say = (k, v) => console.log(`${k.padEnd(34)} ${JSON.stringify(v)}`);
console.log('--- 1. reversible fade out ---');
for (const r of reversible) say(`  at z=${r.z}`, r.veil);
console.log('--- 2/3. pause and resume ---');
for (const [k, v] of Object.entries(paused)) say(`  ${k}`, v);
console.log('--- 4. death after a transition ---');
for (const [k, v] of Object.entries(died)) say(`  ${k}`, v);
console.log('--- 5. LOW fidelity ---');
for (const [k, v] of Object.entries(low)) say(`  ${k}`, v);

const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
if (errs.length) { console.log('--- errors ---'); errs.forEach((e) => console.log(e)); }

const checks = {
  'fade rises walking in':        reversible[1].veil > reversible[0].veil
                                  && reversible[2].veil > reversible[1].veil,
  'fade FALLS walking back out':  reversible[3].veil < reversible[2].veil
                                  && reversible[4].veil < reversible[3].veil,
  'back where it started':        Math.abs(reversible[4].veil - reversible[0].veil) < 0.02,
  'pause panel outranks curtain': paused.panelAboveCurtain === true,
  'pause panel is up':            paused.panelVisible === true,
  'resume clears the curtain':    paused.veilAfterResume === 0,
  'the exit re-armed on leaving': died.rearmed === true,
  'zeroed health at full black':  died.veilAtDeath === 1 && died.phaseAtDeath !== 'idle',
  'death does not strand':        died.veilAfter === 0,
  'LOW fidelity still fades':     low.veil > 0.5 && low.space === 'exterior',
  'no console errors':            errs.length === 0,
};

console.log('\n--- checks ---');
let failed = 0;
for (const [k, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${k}`);
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
