/**
 * THE ROOM THE WHOLE RUN IS A SIEGE TO REACH, AND HOW LONG IT IS ON SCREEN.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS, AND WHAT IT FOUND
 * ---------------------------------------------------------------------------
 *
 * `ui/ending.js` step() was:
 *
 *     if (state.phase === 'none') { if (ready()) begin(); return; }
 *
 * and `ready()` was true the first frame `spaces.roomId === 'serdab'`, with
 * `begin()` putting `.ending-wash` up - `background: black`, `transition: none`
 * - in that same frame. There was no dwell anywhere between the two, and this
 * file measured it on 2026-08-09:
 *
 *     phase "none" -> "black" after 2 frame(s)
 *     frame luminance 21.76 (spread 24.77)  ->  5.49 (spread 0.00)
 *
 * That was FINE while the Serdab was an empty stone box: black on entry was
 * black over nothing. It stopped being fine the day the room was furnished with
 * ten rock-cut figures of the same woman, an empty eleventh niche, the
 * archaeologist on a stool with her back to the door, and her lamp - measured
 * at 48.1% of the frame from the chapel pose. `docs/PLAYTHROUGH.md` beats 4.2
 * through 4.8 are all things the player is supposed to SEE, and the gate as
 * written handed them one frame.
 *
 * The owner had already reported the symptom from the other side, before any of
 * that geometry existed: "it just turned black. The screen turned black, and
 * nothing happened." `test/endgame.mjs` chased that into the 1.25 seconds AFTER
 * begin() and found the card healthy. This file looks at the frame BEFORE it.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED, 2026-08-09 LATE - AND WHY THE CHECK IS KEPT RATHER THAN CUT
 * ---------------------------------------------------------------------------
 *
 * `ui/ending.js` now has a FOURTH gate condition - the meeting has played - and
 * `src/story/meeting.js` owns beats 4.5 to 4.8. So the two-frame measurement
 * below no longer describes the build.
 *
 * IT IS UPDATED RATHER THAN DELETED, and section 3 is the reason: the question
 * it asks - "how many frames does the room get to itself" - is exactly as worth
 * asking after the fix as before it, and a suite that stops asking a question
 * the moment the answer improves cannot notice the answer going back. The old
 * numbers are kept above, in prose, as the before. What section 3 prints now is
 * the after, in the same unit plus the one the player actually experiences.
 *
 * The dwell is quoted in MILLISECONDS as well as frames from here on. At two
 * frames the unit did not matter - it is zero time in any unit - but every
 * headless Chrome here renders on the CPU via swiftshader at better than half a
 * second a frame, so a frame count now measures the driver.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS MEASURED, AND THE CONTROL FOR IT
 * ---------------------------------------------------------------------------
 *
 * A screenshot of the room with the player standing in it and the ending not
 * yet armed, against a screenshot of the same camera one call later. The number
 * that matters is the luminance the player loses, and the control is that the
 * first frame is genuinely a LIT ROOM rather than a dark one - a scene that
 * measures near-black on its own would make "it goes black" meaningless.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolveChrome, GL_ARGS } from './chrome.mjs';
import sharp from 'sharp';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4188/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

/**
 * Mean luminance of a frame AND its spread, 0..255.
 *
 * The spread is here because the first cut of this file asserted `after < 2` -
 * a number invented rather than measured - and the wash duly came back at 5.49
 * and "failed". The screenshot was flat black to the eye: `.ending-wash` paints
 * PIGMENT.shadow, which is a very dark warm brown and not #000, so an absolute
 * darkness threshold was testing the palette rather than the transition.
 *
 * What actually distinguishes a wash from a room is that the wash has NO
 * STRUCTURE. Standard deviation says that and cannot be fooled by a designer
 * choosing a warmer black.
 */
async function luma(name) {
  const buf = await page.screenshot();
  await sharp(buf).toFile(`${OUT}${name}.png`);
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;
  let sum = 0, sumSq = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const v = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += v; sumSq += v * v;
  }
  const mean = sum / px;
  return { mean, sd: Math.sqrt(Math.max(0, sumSq / px - mean * mean)) };
}

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start());
await page.waitForTimeout(1500);

console.log('');
console.log('=== THE PLAYER IS IN THE CHAPEL AND THE WORLD IS STILL THERE ===');
console.log('');

/*
 * Into the room, facing the figures. Teleport rather than a walk: this file is
 * about what is on the screen once he is in, and `test/serdab.mjs` already
 * walks the doorway on real frames and asserts the room resolves.
 */
const placed = await page.evaluate(async () => {
  const g = window.__SANDS__;
  /*
   * `spaces.enter`, NOT a bare teleport. The first cut of this file called
   * `player.teleport` alone, `spaces.active` stayed 'exterior', and every number
   * it printed was a photograph of the COURTYARD - including a confident
   * "the chapel is a lit room, 45.08". Reading `room` back is what caught it,
   * and it is asserted below rather than logged for exactly that reason.
   */
  const frames = async (n) => {
    for (let i = 0; i < n; i++) await new Promise((res) => requestAnimationFrame(res));
  };
  const settle = () => {
    // Act 3's floor is at y = -6 and a placement arrives at y = 0, so the body
    // has seven metres to fall before this is a photograph of anything.
    for (let i = 0; i < 260; i++) {
      g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
      if (g.player.state.grounded) break;
    }
  };

  // Arrive on the STAR SHAFT side and open the chapel through the door's own
  // path, the way test/serdab.mjs does. Entering straight into a sealed room
  // rendered a black viewport with the courtyard still on the minimap, which is
  // what the first cut of this file photographed and nearly reported.
  g.spaces.enter('interior', { x: 34, z: -213, rot: -Math.PI / 2 });
  await frames(8);

  g.doors.state.jarsReturned = 4;
  const rec = g.doors.all.find((x) => x.kind === 'puzzle');
  if (rec) rec.open();
  for (let i = 0; i < 400 && !(rec && rec.opened); i++) await frames(1);

  g.player.teleport({ x: 47, y: 0, z: -213 });
  settle();
  // Facing +x, which is the ka-row on the back wall - the way a player walking
  // in through the doorway at x=40 is already looking.
  g.rig.setYaw(-Math.PI / 2);
  await frames(8);
  return {
    room: g.spaces.roomId,
    space: g.spaces.active,
    phase: g.ending.state.phase,
    waitingOn: g.ending.state.waitingOn,
  };
});

console.log(`  room ${placed.room}  phase ${placed.phase}  gate waiting on ${placed.waitingOn}`);

ok(placed.room === 'serdab', 'the player is standing in the Serdab');
ok(placed.phase === 'none',
  `CONTROL: the ending has NOT fired, so this frame is the room itself (waiting on ${placed.waitingOn})`);

const beforeM = await luma('serdab-scene-before');
const before = beforeM.mean;
console.log(`  frame luminance ${before.toFixed(2)}  (spread ${beforeM.sd.toFixed(2)})`);
console.log('');

ok(before > 8,
  `CONTROL: the chapel is a LIT room, not a dark one (${before.toFixed(2)} mean luminance)`);

console.log('');
console.log('=== AND THE FRAME THE GATE OPENS ===');
console.log('');

/*
 * `begin()` is the exact call `step()` makes one line after `ready()` returns
 * true - test/endgame.mjs establishes that seam and uses it for the same
 * reason. Driving it here measures the transition itself rather than the gate,
 * which is what is in question.
 */
await page.evaluate(() => window.__SANDS__.ending.begin());
const afterM = await luma('serdab-scene-after');
const after = afterM.mean;

console.log(`  frame luminance ${after.toFixed(2)}  (spread ${afterM.sd.toFixed(2)})   was ${before.toFixed(2)} (spread ${beforeM.sd.toFixed(2)})`);
const lost = before > 0 ? (1 - after / before) * 100 : 0;
// WHAT THE WASH COSTS, and it is a measurement of the TRANSITION rather than of
// the gate: `begin()` is driven directly here, one line past where `ready()`
// returns true, so this number is unchanged by the fourth condition and is
// meant to be. How long the room gets BEFORE this happens is section three.
console.log(`  the player loses ${lost.toFixed(1)}% of the frame the instant begin() is called`);
console.log('');

ok(after < before, 'the wash is up: the world went out');
ok(afterM.sd < 2 && beforeM.sd > 10,
  `and it is FLAT: the wash has no structure left (spread ${afterM.sd.toFixed(2)}) `
  + `where the room had plenty (${beforeM.sd.toFixed(2)})`);

console.log('');
console.log('=== THE DWELL: HOW LONG THE ROOM IS THE PLAYER\'S ===');
console.log('');

/*
 * The structural half, ON A FRESH PAGE.
 *
 * `ending.halted` is documented as true from the frame the world ends "with no
 * way back" - there is no reset - so this cannot run after the section above.
 * A reload is the only honest way to ask the question twice.
 *
 * The question: how many frames stand between the gate being satisfied and the
 * phase leaving 'none'. If the answer is zero, the room gets no time of its own
 * and every beat built into it is unreachable.
 *
 * `jarsReturned` is written directly here and that is NOT a test of the jar
 * chain - `test/jars.mjs` owns that. It is the cheapest way to make `ready()`
 * true so the question underneath can be asked, which is a question about
 * TIMING and not about the flag.
 */
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start());
await page.waitForTimeout(1200);

const dwell = await page.evaluate(async () => {
  const g = window.__SANDS__;

  // Conclude the run the real way, so `ready()`'s first condition is honest.
  g.director.forceWave(g.director.stats().finalWave);
  let t = 0, guard = 0;
  while (!g.director.state.concluded && guard++ < 4000) {
    g.director.update(1 / 30, t); t += 1 / 30;
    for (const a of (g.director.live || []).slice()) a.hurt(1e9, 'body', 0, 1);
  }

  const before2 = g.ending.state.phase;
  g.doors.state.jarsReturned = 4;
  const rf = async (n) => { for (let i = 0; i < n; i++) await new Promise((res) => requestAnimationFrame(res)); };
  g.spaces.enter('interior', { x: 34, z: -213, rot: -Math.PI / 2 });
  await rf(8);
  const rec2 = g.doors.all.find((x) => x.kind === 'puzzle');
  if (rec2) rec2.open();
  for (let i = 0; i < 400 && !(rec2 && rec2.opened); i++) await rf(1);
  g.player.teleport({ x: 47, y: 0, z: -213 });
  for (let i = 0; i < 260; i++) {
    g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
    if (g.player.state.grounded) break;
  }

  // Let the router publish the room and the meeting see him arrive. Frames,
  // not a clock: this project's standing rule.
  await rf(8);

  /*
   * WHAT THE GATE IS WAITING FOR, BEFORE ANY KEY IS PRESSED.
   *
   * This is the whole of the fix in one field. Three conditions are true - the
   * dead are down, four sons are home, he is standing in the chapel - and the
   * world has NOT gone black, because there is now a fourth.
   */
  const waitingOn = g.ending.state.waitingOn;
  const phaseSettled = g.ending.state.phase;
  const offered = g.meeting ? g.meeting.offered : null;
  const prompt = (document.getElementById('prompt') || {}).textContent || '';

  /*
   * COUNT THE FRAMES the room gets to itself, AND THE MILLISECONDS.
   *
   * A single frame is not enough to observe this: `spaces.roomId` and
   * `ending.step()` both run inside main.js's loop and the order between them
   * decides whether the gate sees the new room on this frame or the next. The
   * first cut of this file sampled once, saw 'none', and printed "the room is
   * held before the wash" - the exact opposite of the truth.
   *
   * THE REAL KEY, not `meeting.begin()`. `KeyF` is core/keymap.js's default for
   * `interact` and main.js routes that action to the meeting exactly as it
   * routes it to a door - which is the only version of this measurement that is
   * about what a player gets. The beats themselves are test/meeting.mjs's.
   */
  const t0 = performance.now();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', bubbles: true }));

  let framesHeld = 0;
  for (let i = 0; i < 240; i++) {
    if (g.ending.state.phase !== 'none') break;
    await new Promise((r) => requestAnimationFrame(() => r()));
    framesHeld++;
  }

  return {
    concluded: g.director.state.concluded,
    phaseBefore: before2,
    phaseSettled,
    waitingOn,
    offered,
    prompt,
    phaseAfter: g.ending.state.phase,
    framesHeld,
    msHeld: Math.round(performance.now() - t0),
    meeting: g.meeting ? g.meeting.stats() : null,
    room: g.spaces.roomId,
  };
});

console.log(`  concluded ${dwell.concluded}, room ${dwell.room}`);
console.log(`  with three conditions true the gate is waiting on "${dwell.waitingOn}" `
  + `and the ending is still "${dwell.phaseSettled}"`);
console.log(`  the room offers "${dwell.prompt}"`);
console.log(`  phase "${dwell.phaseBefore}"  ->  "${dwell.phaseAfter}" after `
  + `${dwell.framesHeld} frame(s) / ${dwell.msHeld} ms`);
console.log('');

ok(dwell.concluded === true, 'CONTROL: the run concluded by being played out');
ok(dwell.room === 'serdab', 'CONTROL: and the player is in the chapel');
ok(dwell.phaseBefore === 'none', 'CONTROL: the ending was reset and idle first');

/*
 * THE MEASUREMENT THIS FILE EXISTED TO MAKE, KEPT AND TURNED THE RIGHT WAY UP.
 *
 * It used to print a FINDING - "the world goes out after 2 frames, the room
 * gets no time of its own" - because there was nothing to assert against. There
 * is now, so the same measurement becomes an assertion. The threshold is the
 * scene's own authored length taken off `meeting.stats()` rather than a number
 * invented here, and the unit is milliseconds because at better than half a
 * second a frame a frame count is a photograph of swiftshader.
 */
const authored = dwell.meeting ? dwell.meeting.totalMs : 0;

ok(dwell.waitingOn === 'meeting' && dwell.phaseSettled === 'none',
  'THE FOURTH CONDITION: three conditions true and the room is NOT black - the gate names the beat it wants');
ok(!!dwell.offered && /\[F\]$/.test(dwell.prompt) && !/GOLD/.test(dwell.prompt),
  `and the room offers him a prompt with no price on it ("${dwell.prompt}")`);
ok(dwell.msHeld >= authored,
  `THE DWELL: the room is the player's for ${dwell.msHeld} ms across ${dwell.framesHeld} frames, `
  + `against the authored ${authored} ms - and against the TWO FRAMES measured here on 2026-08-09`);
ok(!!dwell.meeting && dwell.meeting.via === 'key' && dwell.meeting.done === true,
  'CONTROL: it was the F key that played the scene, not the thirty-second backstop');

console.log('');
console.log('=== AND THE FURNITURE GOES QUIET WHILE SHE DOES IT ===');
console.log('');

/*
 * COHERENCE FINDING 9, MEASURED.
 *
 * The finding was made by opening a screenshot: beat 4.8 is a silence and it was
 * playing behind the full siege HUD with the MK9 pointed at her. The fix is a
 * class on the root and one boolean on the viewmodel group.
 *
 * MEASURED IN PIXELS AND NOT IN CLASS NAMES. `classList.contains('is-meeting')`
 * would pass with the stylesheet deleted, and this project has twelve confirmed
 * instances of something written that never rendered. So this reads the COMPUTED
 * opacity and then crops the corner the ammunition plate lives in and compares
 * the ink in it - which is the only version of the question that is about what
 * the player sees.
 *
 * The crop is the bottom-right quarter at 1024x640. It holds the ammunition
 * plate and the fidelity buttons, and the fidelity buttons are the reason the
 * class is on the ROOT: #settings sits outside #hud.
 */
const CORNER = { left: 640, top: 400, width: 384, height: 240 };

async function cornerInk(name) {
  const buf = await page.screenshot();
  // The crop is what gets MEASURED and the full frame is what gets LOOKED AT.
  // Finding 9 was made by eye, on a whole screen, and the number below cannot
  // tell anyone whether the shot reads.
  await sharp(buf).toFile(`${OUT}${name}-full.png`);
  await sharp(buf).extract(CORNER).toFile(`${OUT}${name}.png`);
  const { data, info } = await sharp(buf).extract(CORNER)
    .raw().toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;
  let sum = 0, sumSq = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const v = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += v; sumSq += v * v;
  }
  const mean = sum / px;
  return { mean, sd: Math.sqrt(Math.max(0, sumSq / px - mean * mean)) };
}

await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start());
await page.waitForTimeout(1200);

// Same placement as the dwell, stopping one line short of the keypress.
await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.director.forceWave(g.director.stats().finalWave);
  let t = 0, guard = 0;
  while (!g.director.state.concluded && guard++ < 4000) {
    g.director.update(1 / 30, t); t += 1 / 30;
    for (const a of (g.director.live || []).slice()) a.hurt(1e9, 'body', 0, 1);
  }
  g.doors.state.jarsReturned = 4;
  const rf = async (n) => { for (let i = 0; i < n; i++) await new Promise((res) => requestAnimationFrame(res)); };
  g.spaces.enter('interior', { x: 34, z: -213, rot: -Math.PI / 2 });
  await rf(8);
  const rec = g.doors.all.find((x) => x.kind === 'puzzle');
  if (rec) rec.open();
  for (let i = 0; i < 400 && !(rec && rec.opened); i++) await rf(1);
  g.player.teleport({ x: 47, y: 0, z: -213 });
  for (let i = 0; i < 260; i++) {
    g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
    if (g.player.state.grounded) break;
  }
  await rf(8);
});

const hudRead = () => page.evaluate(() => {
  const g = window.__SANDS__;
  const hud = document.getElementById('hud');
  const set = document.getElementById('settings');
  return {
    hud: +getComputedStyle(hud).opacity,
    settings: +getComputedStyle(set).opacity,
    gun: g.viewmodel ? g.viewmodel.group.visible : null,
    holding: g.meeting ? g.meeting.holding : null,
  };
});

const loudState = await hudRead();
const loudInk = await cornerInk('serdab-hud-loud');

await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', bubbles: true }));
});

/*
 * WAIT ON THE OPACITY, NOT ON 1100 MILLISECONDS.
 *
 * The transition is authored in wall clock and a frame here can cost a second,
 * so sleeping the authored duration would be sampling the machine - and worse,
 * the scene itself only lasts about three and a half seconds, so an overshoot
 * lands in the ending wash and would measure black.
 */
const faded = await page.waitForFunction(() => {
  const g = window.__SANDS__;
  if (!g.meeting || !g.meeting.holding) return false;
  return +getComputedStyle(document.getElementById('hud')).opacity < 0.05;
}, null, { timeout: 30000 }).then(() => true).catch(() => false);

const quietState = await hudRead();
const quietInk = await cornerInk('serdab-hud-quiet');

console.log(`  #hud opacity     ${loudState.hud.toFixed(2)}  ->  ${quietState.hud.toFixed(2)}`);
console.log(`  #settings        ${loudState.settings.toFixed(2)}  ->  ${quietState.settings.toFixed(2)}`);
console.log(`  viewmodel shown  ${loudState.gun}  ->  ${quietState.gun}`);
console.log(`  corner ink       ${loudInk.mean.toFixed(2)} (spread ${loudInk.sd.toFixed(2)})`
  + `  ->  ${quietInk.mean.toFixed(2)} (spread ${quietInk.sd.toFixed(2)})`);
console.log('');

ok(quietState.holding === true,
  'CONTROL: this was sampled DURING her turn, not after it');
ok(loudState.hud > 0.95 && loudState.gun === true,
  `CONTROL: the siege HUD and the gun are up right until F (opacity ${loudState.hud.toFixed(2)})`);
ok(faded && quietState.hud < 0.05,
  `the HUD goes out for her (opacity ${quietState.hud.toFixed(2)})`);
ok(quietState.settings < 0.05,
  `and so do the fidelity buttons, which live OUTSIDE #hud (${quietState.settings.toFixed(2)})`);
ok(quietState.gun === false,
  'the gun is no longer pointed at her');
ok(quietInk.sd < loudInk.sd * 0.6,
  `IN PIXELS: the corner loses its structure, spread ${loudInk.sd.toFixed(2)} -> ${quietInk.sd.toFixed(2)} `
  + '- the readouts are not merely class-named away, they stopped being drawn');

console.log('');
ok(errors.length === 0, `no console errors (${errors.length})`);
if (errors.length) for (const e of errors.slice(0, 6)) console.log(`  err ${e}`);

console.log('');
console.log(`shots: serdab-scene-before.png / serdab-scene-after.png`);
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
