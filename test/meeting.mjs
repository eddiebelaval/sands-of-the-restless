/**
 * THE MEETING - beats 4.5 to 4.8, measured in pixels and in wall clock.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS FILE IS THE CHECK ON
 * ---------------------------------------------------------------------------
 *
 * `test/serdabscene.mjs`, 2026-08-09, and the number IS the finding:
 *
 *     phase "none" -> "black" after 2 frame(s)
 *     frame luminance 21.76 (spread 24.77)  ->  5.49 (spread 0.00)
 *
 * The room the entire twenty-five-wave siege exists to reach was on screen for
 * two frames, because `ui/ending.js`'s gate went true the instant the player
 * crossed the threshold and `begin()` raised an opaque wash in the same frame.
 * `docs/PLAYTHROUGH.md` beats 4.5 to 4.8 - the prompt with no price on it, her
 * stand, the boss telegraph in her eyes, and the fact that she asks him nothing
 * - had nowhere in the sequence to happen.
 *
 * ---------------------------------------------------------------------------
 * EVERY CLAIM HERE HAS A CONTROL, AND THE CONTROLS ARE THE POINT
 * ---------------------------------------------------------------------------
 *
 * "The scene played" is satisfiable by a build in which nothing happened: a
 * `done` flag set by a timer passes it, and so does a driver that found no
 * geometry and animated the empty set. So every measurement below is paired.
 *
 *   THE MECHANISM WAS ARMED   `stats().bound` is read off the scene graph - it
 *                             is true only if the driver resolved her figure,
 *                             her legs and her eye MATERIAL by name. A false
 *                             here explains every zero in the run and is the
 *                             difference between "the beat did not play" and
 *                             "the beat played on nothing".
 *
 *   THE FRAME CHANGED         Two screenshots from ONE camera, before the key
 *                             and at the silence, diffed. A scene that runs
 *                             entirely in state produces identical images.
 *
 *   IT WAS NOT THE BACKSTOP   `story/meeting.js` starts itself after thirty
 *                             seconds so a finished run can never be stranded
 *                             behind a prompt that failed to appear. That is a
 *                             safety net and it would mask exactly the bug this
 *                             file exists to catch, so `via` is asserted to be
 *                             'key'.
 *
 *   THE GOLD IS THE REAL ONE  The eye emissive is compared against
 *                             `GODS[0].palette.accent` imported FROM
 *                             `src/enemies/boss.js` inside the page, not
 *                             against a hex written in this file. A telegraph
 *                             that merely looks similar fails.
 *
 *   THE ROOM WAS STILL THERE  The silence frame is asserted to have structure
 *                             (standard deviation), which is what says the
 *                             ending had NOT already washed it out at the
 *                             moment the beat was photographed.
 *
 * NOTHING IS SAMPLED ON A STOPWATCH. Every headless Chrome here renders on CPU
 * via swiftshader and one frame can cost 1.7 seconds; the ramp is sampled by an
 * in-page loop that records a row per animation frame and stops on STATE, and
 * the only wall-clock assertions are the two that are ABOUT wall clock - the
 * dwell the player gets, and the dead man's handle.
 *
 * Run: node test/meeting.mjs http://127.0.0.1:4192/index.html
 * Never 4177 (the owner plays there) and never 4188 (another suite).
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { resolveChrome, GL_ARGS, dismissBriefing } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4192/index.html';
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
const ok = (c, m) => {
  if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); }
};

/** Mean luminance and its SPREAD, 0..255. serdabscene.mjs's instrument. */
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
  return { buf, mean, sd: Math.sqrt(Math.max(0, sumSq / px - mean * mean)) };
}

/** Mean R, G, B over a rectangle of a frame. */
async function patch(buf, box) {
  const { data, info } = await sharp(buf).extract(box).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += info.channels) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  return {
    r: +(r / n).toFixed(1), g: +(g / n).toFixed(1), b: +(b / n).toFixed(1),
    luma: +((0.2126 * r + 0.7152 * g + 0.0722 * b) / n).toFixed(1),
  };
}

/** Fraction of pixels that moved between two frames, and by how much. */
async function diff(a, b) {
  const A = await sharp(a).raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(b).raw().toBuffer({ resolveWithObject: true });
  const ch = A.info.channels;
  const n = A.info.width * A.info.height;
  let moved = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const o = i * ch;
    const d = Math.max(
      Math.abs(A.data[o] - B.data[o]),
      Math.abs(A.data[o + 1] - B.data[o + 1]),
      Math.abs(A.data[o + 2] - B.data[o + 2]));
    sum += d;
    if (d > 8) moved++;
  }
  return { coveragePct: +((moved / n) * 100).toFixed(2), mean: +(sum / n).toFixed(3) };
}

// ---------------------------------------------------------------------------
// 0. boot, THROUGH THE FRONT DOOR
// ---------------------------------------------------------------------------
//
// `#begin` and then dismissBriefing(), which is the boot contract since
// ui/briefing.js landed. Without the second call the click opens a classified
// document and the simulation never starts - and nothing throws, so every check
// below would fail on its own terms and report a confident fictional bug about
// the Serdab. That cost three lanes a night on 2026-08-08; see test/chrome.mjs.

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 90000 });
await page.evaluate(() => document.getElementById('begin').click());
await dismissBriefing(page);

// Wait on the world RUNNING, not on a timer. `frameNo` counts every frame the
// loop has taken, including paused ones, so it moving is the honest proof that
// the loop is alive; `elapsed` only moves when the SIMULATION does, and the
// pair is what says the briefing is really off.
await page.waitForFunction(() => window.__SANDS__.elapsed > 0.5, null, { timeout: 60000 });

const boot = await page.evaluate(() => ({
  elapsed: +window.__SANDS__.elapsed.toFixed(2),
  frameNo: window.__SANDS__.frameNo,
  hasMeeting: !!window.__SANDS__.meeting,
}));

console.log('');
console.log('=== 0. THE WORLD IS RUNNING BEFORE ANYTHING IS ASSERTED ABOUT IT ===');
console.log('');
console.log(`  elapsed ${boot.elapsed}s over ${boot.frameNo} frames`);

ok(boot.hasMeeting === true, 'story/meeting.js is constructed and exposed');
ok(boot.elapsed > 0.5 && boot.frameNo > 5,
  `CONTROL: the simulation advanced past the briefing (${boot.elapsed}s / ${boot.frameNo} frames)`);

// Kept alive: the horde is live from the first breather and this suite is about
// a room. Same exemption test/serdab.mjs and test/jars.mjs take.
await page.evaluate(() => { window.__SANDS__.combat.state.invulnerable = true; });

// ---------------------------------------------------------------------------
// 1. THE DEAD MAN'S HANDLE, exercised through a real host that stops calling it
// ---------------------------------------------------------------------------
//
// story/tableau.js's rule, inherited: "a getter that can only ever say 'still
// holding' is a getter that can hang the game." A scene that stops the
// simulation and never lets go is a strictly worse defect than the two-frame
// wash this whole lane exists to fix, so it is tested FIRST and it is tested by
// the mechanism that would really do it.
//
// THE PAUSE MENU IS THAT MECHANISM AND IT IS NOT A MOCK. main.js's frame loop
// returns on `pause.paused` several branches ABOVE `meeting.update(dt)`, so
// opening the menu genuinely stops the scene being stepped - which is the exact
// shape of the failure (a lost animation frame, a backgrounded tab, an
// exception in a host's own loop) the handle exists for.

console.log('');
console.log("=== 1. THE DEAD MAN'S HANDLE ===");
console.log('');

const handleBudgetMs = await page.evaluate(() => {
  const s = window.__SANDS__.meeting.stats();
  return s.totalMs;
});

const held = await page.evaluate(async (totalMs) => {
  const g = window.__SANDS__;
  const t0 = performance.now();
  const began = g.meeting.begin('key');
  const holdingAtStart = g.meeting.holding;

  // The host stops stepping it.
  g.pause.open();

  // Poll the GETTER on the wall clock, which is the one thing here that is
  // genuinely a wall-clock question. The cap is the scene's own length plus its
  // stated 2500 ms of slack plus a second of headroom.
  const cap = totalMs + 2500 + 1000;
  let releasedAt = null;
  while (performance.now() - t0 < cap) {
    if (!g.meeting.holding) { releasedAt = performance.now() - t0; break; }
    await new Promise((r) => setTimeout(r, 60));
  }

  const s = g.meeting.stats();
  g.pause.resume();
  return {
    began, holdingAtStart, releasedAt,
    ticksWhilePaused: s.ticks,
    forced: s.forced,
    done: s.done,
    phase: s.phase,
    cap,
  };
}, handleBudgetMs);

console.log(`  begin() ${held.began}, holding at start ${held.holdingAtStart}`);
console.log(`  released after ${held.releasedAt === null ? 'NEVER within ' + held.cap + 'ms' : held.releasedAt.toFixed(0) + 'ms'}`
  + `  (scene is ${handleBudgetMs}ms + 2500ms of slack)`);

ok(held.began === true && held.holdingAtStart === true,
  'CONTROL: the scene really started and really held');
ok(held.releasedAt !== null,
  `holding goes FALSE on its own with nobody stepping it (${held.releasedAt === null ? 'never' : Math.round(held.releasedAt) + 'ms'})`);
ok(held.releasedAt !== null && held.releasedAt >= handleBudgetMs,
  'and not early: it released AFTER the scene was due to end, so it is a handle and not a bug');
ok(held.forced === true, "and it says so: stats().forced records that the handle ended it, not the clock");

// ---------------------------------------------------------------------------
// 2. reset() puts the room back exactly as world/serdab.js authored it
// ---------------------------------------------------------------------------

const after = await page.evaluate(() => {
  const g = window.__SANDS__;
  // Un-pause whatever the menu left behind, then put her back.
  if (g.pause.paused) g.pause.resume();
  const before = g.meeting.stats();
  g.meeting.reset();
  return { before, now: g.meeting.stats(), paused: g.pause.paused };
});

console.log('');
console.log('=== 2. reset() ===');
console.log('');
console.log(`  forced pose: lift ${after.before.lift}  knee ${after.before.knee}  `
  + `eye ${after.before.eyeGlow}  sign ${after.before.signGlow}`);
console.log(`  after reset: lift ${after.now.lift}  knee ${after.now.knee}  `
  + `eye ${after.now.eyeGlow}  sign ${after.now.signGlow}`);

ok(after.before.lift === after.before.standLift && after.before.eyeGlow === after.before.telegraph.ceiling,
  'CONTROL: an aborted scene LANDS the pose rather than freezing half way - the next frame is black');
ok(after.now.lift === 0 && after.now.knee === 0
  && after.now.eyeGlow === 0 && after.now.signGlow === 0,
  'reset() returns every driven value to the authored zero');
ok(after.now.done === false && after.now.phase === 'none',
  'and re-arms the gate: done false, phase none');

// ---------------------------------------------------------------------------
// 3. the gate, staged, and the FOURTH condition is the only one left
// ---------------------------------------------------------------------------
//
// The run is CONCLUDED by being played out rather than by writing a flag, so
// the first condition is honest. `jarsReturned` is written directly and that is
// not a test of the jar chain - test/jars.mjs owns that - it is the cheapest way
// to make the other conditions reachable so the question underneath can be
// asked, and the question underneath is about the gate.

console.log('');
console.log('=== 3. THE GATE HAS FOUR CONDITIONS AND THREE OF THEM ARE MET ===');
console.log('');

const staged = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const rf = async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };

  g.director.forceWave(g.director.stats().finalWave);
  let t = 0, guard = 0;
  while (!g.director.state.concluded && guard++ < 4000) {
    g.director.update(1 / 30, t); t += 1 / 30;
    for (const a of (g.director.live || []).slice()) a.hurt(1e9, 'body', 0, 1);
  }

  g.doors.state.jarsReturned = 4;
  g.spaces.enter('interior', { x: 34, z: -213, rot: -Math.PI / 2 });
  await rf(8);
  const rec = g.doors.all.find((x) => x.kind === 'puzzle');
  if (rec) rec.open();
  for (let i = 0; i < 400 && !(rec && rec.opened); i++) await rf(1);

  // Standing three metres short of her, on the walking line, looking at her.
  // Inside REACH (3.0 m) is the offer; this is the pose the beat is delivered
  // from and it is also the pose both screenshots are taken from.
  g.player.teleport({ x: 44.0, y: 0, z: -213.2 });
  for (let i = 0; i < 260; i++) {
    g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
    if (g.player.state.grounded) break;
  }
  const p = g.player.position;
  const her = g.scene.getObjectByName('serdab-archaeologist');
  const hp = new g.THREE.Vector3();
  if (her) her.getWorldPosition(hp);
  g.rig.reset(Math.atan2(-(hp.x - p.x), -(hp.z - p.z)), -0.06);
  await rf(12);

  return {
    concluded: g.director.state.concluded,
    room: g.spaces.roomId,
    jars: g.doors.state.jarsReturned,
    waitingOn: g.ending.state.waitingOn,
    endingPhase: g.ending.state.phase,
    canMeet: g.ending.canMeet,
    meeting: g.meeting.stats(),
    dist: +Math.hypot(p.x - hp.x, p.z - hp.z).toFixed(2),
    eye: +(p.y - g.interior.heightAt(p.x, p.z)).toFixed(2),
  };
});

console.log(`  concluded ${staged.concluded}, jars ${staged.jars}, room ${staged.room}`);
console.log(`  ending phase "${staged.endingPhase}", waiting on "${staged.waitingOn}", canMeet ${staged.canMeet}`);
console.log(`  he is ${staged.dist} m from her, eye ${staged.eye} m above the floor`);

ok(staged.concluded === true, 'CONTROL: the run concluded by being played out');
ok(staged.jars === 4, 'CONTROL: four sons are home');
ok(staged.room === 'serdab', 'CONTROL: and the player is standing in the Serdab');
ok(Math.abs(staged.eye - 1.68) < 0.03,
  `CONTROL: the camera is at player eye height and not a debug camera (${staged.eye} m)`);
ok(staged.endingPhase === 'none',
  'THE ROOM IS NOT BLACK: the ending has not fired with all three old conditions true');
ok(staged.waitingOn === 'meeting',
  'and the gate says exactly what it is waiting for: the meeting');
ok(staged.canMeet === true, 'the meeting is allowed to play');
ok(staged.meeting.bound === true,
  'CONTROL: the driver resolved her figure, her legs and her eye material BY NAME');

// ---------------------------------------------------------------------------
// 4. beat 4.5 - the prompt, and it has no price on it
// ---------------------------------------------------------------------------

console.log('');
console.log('=== 4. BEAT 4.5 - THE PROMPT, AND THIS ONE HAS NO PRICE ON IT ===');
console.log('');

const offered = await page.evaluate(async () => {
  const g = window.__SANDS__;
  for (let i = 0; i < 90 && !g.meeting.offered; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  const el = document.getElementById('prompt');
  return {
    offered: g.meeting.offered,
    // THE SCREEN IS THE CONTRACT. Read off the element the player looks at,
    // not off the channel that fed it: main.js documents at length that a
    // probe answering from state the player cannot see is answering a
    // different question.
    text: el ? el.textContent : null,
    on: el ? el.classList.contains('on') : false,
    deny: el ? el.classList.contains('deny') : false,
    box: el ? (() => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
    speaker: g.promptBus.speaker,
    // THE AUTHORED COLD STATE, read at the only moment it can honestly be read:
    // he is in the room, the prompt is up, and nothing has been pressed. Both
    // are `world/serdab.js`'s authored zero and both are what the ramps below
    // are measured against.
    restEye: g.meeting.stats().eyeGlow,
    restSign: g.meeting.stats().signGlow,
  };
});

console.log(`  #prompt reads "${offered.text}"  (speaker: ${offered.speaker}, box ${offered.box.w}x${offered.box.h})`);

ok(offered.offered === true, 'walking up to her raises an offer');
ok(offered.on === true && !!offered.text,
  'and it reaches the real #prompt element with the class the player sees');
ok(offered.box.w > 40 && offered.box.h > 6,
  `and it is LAID OUT, not merely set (${offered.box.w}x${offered.box.h})`);
ok(/\[F\]$/.test(offered.text || ''),
  'it ends in [F], the same key as every door, gun and shrine in the game');
ok(!/GOLD/.test(offered.text || '') && offered.deny === false,
  `THE BEAT: no price and no refusal state anywhere in it ("${offered.text}")`);
ok(offered.speaker === 'meeting',
  'CONTROL: it is the meeting speaking and not a door that happens to be behind her');
ok(offered.restEye === 0 && offered.restSign === 0,
  'CONTROL: her eyes and the mark on her lamp are COLD while he stands there deciding '
  + `(eye ${offered.restEye}, sign ${offered.restSign})`);

const before = await luma('meeting-1-before');
console.log(`  frame luminance ${before.mean.toFixed(2)} (spread ${before.sd.toFixed(2)})`);
ok(before.mean > 8 && before.sd > 10,
  `CONTROL: the chapel is a LIT, STRUCTURED room at this moment `
  + `(${before.mean.toFixed(2)} mean, ${before.sd.toFixed(2)} spread)`);

// ---------------------------------------------------------------------------
// 4b. THE BACKSTOP'S CLOCK, WHICH IS THE THING THAT SILENTLY DOES NOT RUN
// ---------------------------------------------------------------------------
//
// `story/meeting.js` starts itself after thirty seconds so a finished run can
// never be stranded behind a prompt that failed to appear. Nothing in a normal
// run reaches it, which means nothing in a normal run NOTICES it being broken -
// and `feedback_a_gate_that_never_ran_reports_green` is exactly that shape.
//
// It is not waited out here: thirty seconds against a frame that costs a second
// is most of a minute, and the interesting failure is not the threshold, it is
// the CLOCK. The first cut of this file's subject reset that clock whenever two
// frames were more than a second apart, and a swiftshader frame in this room
// measures 1036 ms - so the arm time tripped over on every single frame and the
// backstop could only ever have fired on a fast machine.
//
// So what is measured is that the clock ACCUMULATES against the wall while he
// stands there, and that stepping out of the room zeroes it.
//
// The round trip has a second job worth stating rather than relying on: staging
// the gate above takes better than twenty seconds on this machine, all of it
// with `canPlay()` true, so by the time section 5 presses F the backstop is
// already most of the way home. Walking him out and back is what puts the arm
// clock back to zero, which is what makes `via === 'key'` a real assertion
// rather than a race.

const backstop = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const t0 = performance.now();
  const seen = [];
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    seen.push({ ms: Math.round(performance.now() - t0), armed: g.meeting.stats().armedMs });
  }

  // Step out of the chapel, the way a player would. `canPlay()` goes false and
  // the thirty seconds must start again.
  const inside = g.player.position.x;
  g.player.teleport({ x: 34, y: 0, z: -213 });
  for (let i = 0; i < 260; i++) {
    g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
    if (g.player.state.grounded) break;
  }
  for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
  const away = { room: g.spaces.roomId, armed: g.meeting.stats().armedMs, canMeet: g.ending.canMeet };

  // And back, to the pose the rest of this file measures from.
  g.player.teleport({ x: inside, y: 0, z: -213.2 });
  for (let i = 0; i < 260; i++) {
    g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
    if (g.player.state.grounded) break;
  }
  for (let i = 0; i < 12; i++) await new Promise((r) => requestAnimationFrame(r));

  return {
    seen, away,
    backstopMs: g.meeting.stats().backstopMs,
    backRoom: g.spaces.roomId,
    backOffered: g.meeting.offered,
    frameCost: Math.round((performance.now() - t0) / 4),
  };
});

console.log('');
console.log(`  the arm clock, standing still: ${backstop.seen.map((s) => `${s.armed}ms@${s.ms}`).join('  ')}`);
console.log(`  frame cost here ~${backstop.frameCost} ms; the backstop is ${backstop.backstopMs} ms`);
console.log(`  stepped out to "${backstop.away.room}": arm clock ${backstop.away.armed}, canMeet ${backstop.away.canMeet}`);

const grew = backstop.seen[backstop.seen.length - 1].armed - backstop.seen[0].armed;
const wall = backstop.seen[backstop.seen.length - 1].ms - backstop.seen[0].ms;

ok(grew > wall * 0.8,
  `THE BACKSTOP'S CLOCK RUNS: it accrued ${grew} ms against ${wall} ms of wall clock, `
  + `on frames costing ~${backstop.frameCost} ms each`);
ok(backstop.away.canMeet === false && backstop.away.armed === 0,
  `CONTROL: and leaving the chapel zeroes it (room "${backstop.away.room}", arm clock ${backstop.away.armed})`);
ok(backstop.backRoom === 'serdab' && backstop.backOffered === true,
  'CONTROL: and walking back in offers her again');

// ---------------------------------------------------------------------------
// 5. beats 4.6 and 4.7 - the stand, the mark, and the telegraph
// ---------------------------------------------------------------------------
//
// One in-page loop, one row per animation frame, stopping on STATE. Sampling
// from Node would put a round trip between every reading and would measure the
// harness; sampling on a timer would measure the machine.

console.log('');
console.log('=== 5. BEATS 4.6 AND 4.7 - SHE STANDS, THE MARK LIGHTS, THE EYES RAMP ===');
console.log('');

const played = await page.evaluate(async () => {
  const g = window.__SANDS__;

  // THE REAL KEY. `KeyF` is core/keymap.js's default for `interact`, and
  // main.js routes that action to the meeting exactly as it routes it to a
  // fixture or a door. Nothing here calls meeting.begin().
  const t0 = performance.now();
  window.__MEET_T0__ = t0;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', bubbles: true }));

  /*
   * The first phase is read SYNCHRONOUSLY off the keypress, before a frame has
   * been allowed to happen. Under swiftshader one frame here costs well over a
   * second, so `settle` - which is 420 ms of her not moving - is a beat that
   * this machine can step straight over. That is the machine and not the game,
   * and the honest instrument for "did the press land on the beat it should
   * have" is the state the press itself left behind.
   */
  const onPress = { phase: g.meeting.state.phase, offered: g.meeting.offered, prompt: (document.getElementById('prompt') || {}).textContent };

  const rows = [];
  let frames = 0;

  /*
   * STOPS AT THE SILENCE, ON STATE, and that is what lets the screenshot below
   * exist at all. Running to the ending would photograph the wash: the gate
   * opens on the frame after `done`, so beat 4.8 - she is standing, turned,
   * her eyes at the ceiling, and nothing has been asked - is the LAST frame of
   * the world and there is exactly one window to catch it in.
   */
  for (let i = 0; i < 4000; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    frames++;
    const s = g.meeting.stats();
    rows.push({
      ms: Math.round(performance.now() - t0),
      phase: s.phase,
      lift: s.lift,
      turn: s.turnDeg,
      knee: s.knee,
      eye: s.eyeGlow,
      sign: s.signGlow,
      ending: g.ending.state.phase,
      prompt: (document.getElementById('prompt') || {}).textContent || '',
    });
    if (s.phase === 'silence' || s.done || g.ending.state.phase !== 'none') break;
  }

  // Independent read of the telegraph's own source, so the colour is compared
  // against boss.js rather than against a hex written into a harness.
  const boss = await import('/src/enemies/boss.js');
  const s = g.meeting.stats();

  /*
   * WHERE HER EYES ARE ON THE SCREEN, projected through the game's own camera.
   *
   * A hardcoded rectangle would be a guess that goes stale the first time
   * anything about the pose or the stance moves. This is the one honest way to
   * ask "what colour are the pixels the player is looking at": ask the camera
   * that drew them.
   */
  const eyesObj = g.scene.getObjectByName('serdab-eyes');
  let box = null;
  if (eyesObj) {
    const v = new g.THREE.Vector3();
    eyesObj.getWorldPosition(v);
    v.project(g.camera);
    const w = g.renderer.domElement.clientWidth;
    const h = g.renderer.domElement.clientHeight;
    box = {
      x: Math.round((v.x * 0.5 + 0.5) * w),
      y: Math.round((-v.y * 0.5 + 0.5) * h),
      w, h,
    };
  }

  return {
    rows, frames, onPress, box,
    final: s,
    silenceMs: rows.length ? rows[rows.length - 1].ms : null,
    bossAccent: boss.GODS[0].palette.accent,
    bossName: boss.GODS[0].name,
    endingPhaseNow: g.ending.state.phase,
  };
});

const rows = played.rows;
const phases = [...new Set(rows.map((r) => r.phase))];
const eyes = rows.map((r) => r.eye).filter((v) => v !== null);
const lifts = rows.map((r) => r.lift).filter((v) => v !== null);
const signs = rows.map((r) => r.sign).filter((v) => v !== null);

console.log(`  ${rows.length} frames sampled, phases seen: ${phases.join(' -> ')}`);
console.log('');
console.log('   ms    phase     lift    turn      knee     eye     sign   ending');
for (const r of rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 14)) === 0 || _ === rows[rows.length - 1])) {
  console.log(
    `  ${String(r.ms).padStart(5)}  ${String(r.phase).padEnd(8)} `
    + `${String(r.lift).padStart(6)}  ${String(r.turn).padStart(7)}  `
    + `${String(r.knee).padStart(6)}  ${String(r.eye).padStart(6)}  `
    + `${String(r.sign).padStart(6)}   ${r.ending}`);
}
console.log('');

const T = played.final.telegraph;

console.log(`  the press itself left phase "${played.onPress.phase}", `
  + `prompt "${played.onPress.prompt}", offered ${played.onPress.offered}`);
console.log('');

ok(played.final.via === 'key',
  'CONTROL: the F key started it - NOT the thirty-second backstop that would mask a dead prompt');
ok(played.final.forced === false,
  "CONTROL: and it ran to its own end rather than being cut off by the dead man's handle");
ok(played.onPress.phase === 'settle',
  'the press lands on beat 4.6\'s pause: she does not move on the frame he asks');
/*
 * THE OFFER IS WITHDRAWN IN TWO STEPS AND THE SECOND ONE IS A FRAME LATER.
 *
 * `meeting.begin()` clears its own channel synchronously, so `offered` is false
 * on the press - but `ui/prompt.js` is an ARBITER and the element is only
 * written by `promptBus.paint()`, which runs once a frame. So the line the
 * player is looking at survives exactly one frame past the key, which is what
 * the first read below records rather than pretends away. What must not happen
 * is the line sitting there through her turn, and that is the second read.
 */
ok(played.onPress.offered === false,
  'the offer is withdrawn on the press: meeting.offered goes false in the same tick');
ok(rows.every((r) => r.phase === 'settle' || !r.prompt),
  'and the #prompt element is EMPTY for every frame from her first movement onward - '
  + 'the line does not sit on screen through her turn');
ok(phases.includes('rise') && phases.includes('tell') && phases.includes('silence'),
  `the stand, the telegraph and the silence were all observed on real frames (${phases.join(' -> ')})`);

// --- 4.6, she stands and turns -------------------------------------------
const liftMax = Math.max(...lifts);
const liftMid = lifts.some((v) => v > 0.02 && v < played.final.standLift - 0.02);
ok(Math.abs(liftMax - played.final.standLift) < 1e-6,
  `4.6 SHE STANDS: the figure rose the authored ${played.final.standLift} m (max ${liftMax})`);
ok(liftMid,
  'CONTROL: and it was sampled part way up, so it is a rise and not a teleport');
ok(Math.abs(played.final.turnDeg) > 60,
  `4.6 SHE TURNS: ${played.final.turnDeg} degrees, measured to where he was actually standing`);
ok(played.final.knee > 1,
  `and her legs came under her (knee ${played.final.knee} rad)`);

// --- 4.6, the mark on the lamp -------------------------------------------
const signMax = Math.max(...signs);
ok(offered.restSign === 0 && signMax > 1,
  `4.6 THE MARK on her lamp lights from inside it (${offered.restSign} -> ${signMax})`);
ok(signs.some((v) => v > 0 && v < signMax),
  'CONTROL: and it came up over the stand rather than switching on');

// --- 4.7, the boss telegraph ---------------------------------------------
//
// THE RAMP IS ASSERTED AS A SHAPE, NOT AS A FRAME COUNT. Every frame here is
// rendered on the CPU by swiftshader and this run measured them at better than
// a second each, so "N frames landed mid-ramp" is a statement about the machine
// - which is the bug this project has shipped six times. What is asserted is
// that the samples never go DOWN, that at least one of them is strictly between
// the ends, and that the ends are boss.js's own numbers.
const eyeMax = Math.max(...eyes);
const eyeMid = eyes.filter((v) => v > 0.05 && v < T.ceiling - 0.05).length;
const eyeMonotonic = eyes.every((v, i) => i === 0 || v >= eyes[i - 1] - 1e-9);
ok(Math.abs(eyeMax - T.ceiling) < 1e-6,
  `4.7 THE TELEGRAPH reaches boss.js's own ceiling of ${T.ceiling} (measured ${eyeMax})`);
ok(eyeMonotonic,
  `CONTROL: it only ever climbs - ${eyes.length} samples, none below the one before it`);
ok(eyeMid >= 1,
  `CONTROL: and it RAMPS rather than switching - ${eyeMid} of ${eyes.length} samples landed `
  + `strictly between 0 and ${T.ceiling} (${eyes.join(', ')})`);
ok(played.final.eyeHex === played.bossAccent,
  `4.7 and it is the REAL gold: her eyes are 0x${played.final.eyeHex.toString(16)}, `
  + `which is ${played.bossName}'s gilding read out of enemies/boss.js`);
// The eyes stay dark until she has turned round. A telegraph that lands on the
// back of a head is a telegraph nobody read.
const eyeBeforeStand = rows.filter((r) => r.lift !== null && r.lift < played.final.standLift - 1e-6)
  .every((r) => r.eye === 0);
ok(eyeBeforeStand,
  'CONTROL: her eyes are cold for the whole stand - the ramp lands on a face that is looking at him');

// --- 4.8, she does not ask him anything ----------------------------------
const spoke = await page.evaluate(() => {
  const p = window.__SANDS__.pacer.stats ? window.__SANDS__.pacer.stats() : null;
  const el = document.getElementById('notice');
  return { holding: p ? p.holding : null, notice: el ? el.textContent : null };
});
ok(!spoke.notice,
  `4.8 SHE DOES NOT ASK HIM ANYTHING: the notice pill is empty ("${spoke.notice || ''}")`);

// ---------------------------------------------------------------------------
// 6. THE FRAME CHANGED - the whole claim, in pixels
// ---------------------------------------------------------------------------
//
// Shot at the SILENCE, which is beat 4.8 and the last frame of the world: she
// is standing, turned, her eyes at the ceiling, and the ending has not fired.

console.log('');
console.log('=== 6. THE PLAYER SEES A DIFFERENT ROOM ===');
console.log('');
console.log(`  the silence was reached at ${played.silenceMs} ms, ending still "${played.endingPhaseNow}"`);

ok(played.final.phase === 'silence' && played.endingPhaseNow === 'none',
  'CONTROL: this frame is beat 4.8 and the world has NOT gone out yet');

const silence = await luma('meeting-2-silence');
const moved = await diff(before.buf, silence.buf);

console.log(`  frame luminance ${before.mean.toFixed(2)} (spread ${before.sd.toFixed(2)})`
  + `  ->  ${silence.mean.toFixed(2)} (spread ${silence.sd.toFixed(2)})`);
console.log(`  ${moved.coveragePct}% of the frame moved, mean channel delta ${moved.mean}`);

ok(silence.sd > 10,
  `CONTROL: the world is still on the screen at the silence (spread ${silence.sd.toFixed(2)})`);
ok(moved.coveragePct > 1.0,
  `THE FRAME CHANGED: ${moved.coveragePct}% of pixels moved between the prompt and the silence`);

/*
 * AND THE TELEGRAPH, IN PIXELS RATHER THAN IN A MATERIAL PROPERTY.
 *
 * `eyeHex === bossAccent` above says the right hex was WRITTEN. It says nothing
 * about what reached the screen: this project's defining bug is UI that was
 * written, believed and never rendered, and an emissive that never got through
 * the composer's tone mapping would pass every number in section 5.
 *
 * TWO CONTROLS, and the second one is the one that matters. The same rectangle
 * before and after says the pixels changed - but she also MOVED into that
 * rectangle, so on its own it would be satisfied by a head with no eyes in it.
 * So the eyes are also measured against her own forehead in the SAME frame,
 * which is the same material, the same lamp and the same angle with no emissive
 * on it. That difference can only be the ramp.
 */
if (played.box) {
  const w = 46, h = 18;
  const eyeBox = {
    left: Math.max(0, Math.min(played.box.w - w, played.box.x - w / 2)),
    top: Math.max(0, Math.min(played.box.h - h, played.box.y - h / 2)),
    width: w, height: h,
  };
  const browBox = { ...eyeBox, top: Math.max(0, eyeBox.top - 24) };

  const eyeNow = await patch(silence.buf, eyeBox);
  const eyeThen = await patch(before.buf, eyeBox);
  const brow = await patch(silence.buf, browBox);

  console.log(`  her eyes project to (${played.box.x}, ${played.box.y})`);
  console.log(`  that rectangle before the key:  R ${eyeThen.r}  G ${eyeThen.g}  B ${eyeThen.b}   luma ${eyeThen.luma}`);
  console.log(`  the same rectangle at 4.8:      R ${eyeNow.r}  G ${eyeNow.g}  B ${eyeNow.b}   luma ${eyeNow.luma}`);
  console.log(`  her forehead in that same frame: R ${brow.r}  G ${brow.g}  B ${brow.b}   luma ${brow.luma}`);

  ok(eyeNow.luma > eyeThen.luma * 2,
    `THE RAMP REACHED THE SCREEN: the eye rectangle went ${eyeThen.luma} -> ${eyeNow.luma} luma`);
  ok(eyeNow.luma > brow.luma * 1.5,
    `CONTROL: and it is the EYES and not the lamp finding her face - `
    + `${eyeNow.luma} against ${brow.luma} on her forehead, same frame, same light`);
  ok(eyeNow.r > eyeNow.b + 10,
    `and it is GOLD rather than a white lamp: R ${eyeNow.r} against B ${eyeNow.b}`);
} else {
  ok(false, 'could not project her eyes to the screen - the pixel check did not run');
}

// ---------------------------------------------------------------------------
// 7. THE DWELL - the number this whole lane exists to move
// ---------------------------------------------------------------------------

console.log('');
console.log('=== 7. THE DWELL ===');
console.log('');

const dwell = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const t0 = window.__MEET_T0__;
  let frames = 0;
  let doneAt = null;
  for (let i = 0; i < 4000; i++) {
    if (g.meeting.state.done && doneAt === null) doneAt = Math.round(performance.now() - t0);
    if (g.ending.state.phase !== 'none') break;
    await new Promise((r) => requestAnimationFrame(r));
    frames++;
  }
  return {
    doneAt,
    endingAt: Math.round(performance.now() - t0),
    extraFrames: frames,
    endingPhase: g.ending.state.phase,
    waitingOn: g.ending.state.waitingOn,
    forced: g.meeting.stats().forced,
  };
});

const heldFrames = played.frames + dwell.extraFrames;
const msPerFrame = heldFrames ? dwell.endingAt / heldFrames : 0;

console.log(`  key pressed -> ending leaves "none":  ${dwell.endingAt} ms over ${heldFrames} frames`);
console.log(`  the scene reported done at:           ${dwell.doneAt} ms`);
console.log(`  its authored length is:               ${played.final.totalMs} ms`);
console.log(`  this machine's frame cost:            ${msPerFrame.toFixed(0)} ms/frame (swiftshader, CPU)`);
console.log(`  ending phase now "${dwell.endingPhase}"`);

/*
 * THE UNIT IS MILLISECONDS AND NOT FRAMES, and the two numbers above are why.
 *
 * `test/serdabscene.mjs` reported the defect as "2 frames" because at two
 * frames the unit does not matter - it is zero time in any unit. It matters
 * here: this machine renders the Serdab at better than a second a frame, so the
 * same 3.5-second scene is four frames on swiftshader and about two hundred on
 * the owner's. Asserting a frame count would be asserting the driver.
 *
 * The dwell overshooting its authored length is the same fact from the other
 * side: `story/meeting.js` advances on an absolute wall clock, so a frame that
 * arrives 1.5 seconds late finds the phase it belongs to already over and the
 * scene lands long rather than skipping a beat. That is the tableau's rule
 * paying out, and it is why the beats are all still observed above.
 */
ok(dwell.endingPhase !== 'none',
  'the ending DOES fire once the meeting has played - the fourth condition is a gate, not a wall');
ok(dwell.forced === false,
  "CONTROL: and it got there on its own clock, not on the dead man's handle");
ok(dwell.doneAt !== null && dwell.doneAt >= played.final.totalMs - 80,
  `the scene ran its full authored length (${dwell.doneAt} ms against ${played.final.totalMs} ms)`);
ok(dwell.endingAt >= 3000,
  `THE DWELL: the room the siege exists to reach is on screen for ${dwell.endingAt} ms of WALL CLOCK `
  + `after the key, at ${msPerFrame.toFixed(0)} ms/frame - against the two frames it got before this lane`);

console.log('');
ok(errors.length === 0, `no console errors (${errors.length})`);
if (errors.length) for (const e of errors.slice(0, 6)) console.log(`  err ${e}`);

console.log('');
console.log(`shots: ${OUT}meeting-1-before.png  ${OUT}meeting-2-silence.png`);
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);

await browser.close();
process.exit(fail === 0 ? 0 : 1);
