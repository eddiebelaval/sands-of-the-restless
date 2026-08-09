/**
 * THE CONTROLLER.
 *
 * THE CLAIM THIS FILE EXISTS TO TEST is not "gamepad code was written". It is
 * four separate things, and they fail separately:
 *
 *   1. THE MATHS IS RIGHT. The deadzone is radial and rescaled, the response
 *      curve shapes the live travel and not the dead travel, and look is a RATE
 *      multiplied by delta time rather than a per-frame constant. Those are
 *      pure functions and are asserted here with no browser at all, at exact
 *      equalities rather than tolerances wherever an equality is the honest
 *      claim.
 *
 *   2. FRAME RATE DOES NOT CHANGE THE FEEL. The same stick deflection held for
 *      one simulated second turns the same angle at 16ms frames and at 33ms
 *      frames. This is the check that matters most on this project: core/
 *      governor.js exists precisely because frame time varies by machine, and a
 *      rate-per-frame implementation would be fast on the machine it was
 *      written on and broken on every other one. Asserted twice - once on the
 *      pure function and once through the LIVE GAME, because a correct function
 *      wired up wrongly is this project's defining bug.
 *
 *   3. THE WIRE IS CONNECTED. A synthetic pad is injected into
 *      navigator.getGamepads before the game boots and driven axis by axis and
 *      button by button, and the assertions are made on the GAME - the camera's
 *      yaw, the weapon's reload state, the pause menu's own flags - and never
 *      on the input layer's opinion of itself. STATE.md records ten instances
 *      of code that was written and never took effect; a gamepad reader is the
 *      perfect substrate for an eleventh.
 *
 *      THE PAD IS PUT IN SLOT 2, NOT SLOT 0. getGamepads() returns a sparse
 *      array and which slot a pad lands in depends on the order things were
 *      connected. `pads[0]` is the exact shape of the failure above: correct
 *      looking code that reads nothing on the one machine that matters.
 *
 *   4. THE MENU IS OPERABLE. A pad that can open the pause panel and cannot
 *      move the selection, change a row or resume has trapped the player, and
 *      is worse than no pad support. Driven through the real input layer, with
 *      the assertions on ui/pause.js's own cursor and on the settings the rows
 *      actually wrote.
 *
 * WHO POLLS. THE FRAME LOOP DOES, and this file no longer does - which is a
 * correction rather than a preference. An earlier version supplied the poll
 * itself, because it was written before src/main.js carried the call. Once the
 * call landed, every look measurement was the sum of two polls, at two different
 * deltas, and read about four times the predicted angle. That suite was green
 * against a tree where nothing else polled, and it was measuring a path
 * production does not use. See the long note above section 2 for the whole
 * reconstruction; the rule that came out of it is that the harness sets the pad
 * and reads the camera, and the only thing between those two is the shipping
 * game.
 *
 * There are exactly TWO deliberate calls to pollPad left in this file. Both are
 * labelled where they appear, both exist to exercise something the environment
 * refuses to vary on its own, and both account for the loop's own polls rather
 * than pretending they do not happen.
 *
 * WHAT THIS CANNOT TEST. There is no DualShock 4 attached to the machine this
 * ran on. Every layout claim below is made against a synthetic pad shaped like
 * one, in BOTH the standard mapping and the raw HID layout, which proves the
 * code handles either - and proves nothing about which one Chrome actually
 * hands over for that hardware. The FEEL of the curve, the rates and the
 * deadzone is likewise unverified and unverifiable from here.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS, dismissBriefing } from './chrome.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  radialDeadzone, shapeStick, lookDelta, createRepeater, resolveProfile,
  PAD_DEFAULTS, TRIGGER, MENU, MAX_POLL_DELTA,
} from '../src/core/gamepad.js';

const failures = [];
const notes = [];

function check(ok, label, detail = '') {
  if (ok) { notes.push(`  ok   ${label}${detail ? `  ${detail}` : ''}`); return true; }
  failures.push(`${label}${detail ? `  ${detail}` : ''}`);
  notes.push(`  FAIL ${label}${detail ? `  ${detail}` : ''}`);
  return false;
}

const near = (a, b, eps) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------
// 1. THE MATHS, WITH NO BROWSER AT ALL
// ---------------------------------------------------------------------------

notes.push('\n--- the maths ---');

// --- the deadzone is radial -------------------------------------------------

{
  const dz = 0.12;

  const dead = shapeStick(0.05, 0, dz, 2);
  check(dead.x === 0 && dead.y === 0 && dead.mag === 0,
    'at 0.05 with a 0.12 deadzone the output is EXACTLY zero',
    `x ${dead.x} y ${dead.y}`);

  const edge = shapeStick(0.12, 0, dz, 2);
  check(edge.mag === 0, 'and exactly at the deadzone it is still zero', `${edge.mag}`);

  // The rescale. Without it the first live sample would arrive at 0.12 worth of
  // speed, which is a visible lurch at the start of every turn.
  const just = shapeStick(0.13, 0, dz, 2);
  check(just.x > 0, 'at 0.13 it is alive', `${just.x.toExponential(3)}`);
  check(just.x < 0.01,
    'and it is NEAR ZERO rather than near 0.13 - the output ramps from the edge',
    `${just.x.toExponential(3)} against a raw 0.13`);

  const full = shapeStick(1, 0, dz, 2);
  check(full.mag === 1, 'the rim is still the rim', `${full.mag}`);

  // THE PER-AXIS BUG, ASSERTED AS AN ANGLE. A per-axis deadzone would zero the
  // 0.05 and leave the 0.9, snapping this to straight up. The angle is
  // preserved to the last place a double can hold.
  const rawAngle = Math.atan2(0.9, 0.05);
  const near0 = shapeStick(0.05, 0.9, dz, 2);
  const gotAngle = Math.atan2(near0.y, near0.x);
  check(near(gotAngle, rawAngle, 1e-12),
    'A NEAR-AXIS DIAGONAL KEEPS ITS ANGLE - the deadzone does not snap it',
    `${(rawAngle * 180 / Math.PI).toFixed(6)} deg in, ${(gotAngle * 180 / Math.PI).toFixed(6)} deg out`);
  check(near0.x > 0, 'and the small axis survives at all', `${near0.x.toFixed(6)}`);

  const diag = shapeStick(0.5, 0.5, dz, 2);
  check(near(Math.atan2(diag.y, diag.x), Math.PI / 4, 1e-12),
    'a 45 degree push is still 45 degrees after the curve',
    `${(Math.atan2(diag.y, diag.x) * 180 / Math.PI).toFixed(6)} deg`);

  // The magnitude is the LENGTH of the vector, not the larger axis. A stick on
  // the diagonal rim reads 1.0 and not 0.707.
  const rim = radialDeadzone(Math.SQRT1_2, Math.SQRT1_2, 0);
  check(near(rim.mag, 1, 1e-12), 'the diagonal rim is full deflection', `${rim.mag}`);
}

// --- the response curve -----------------------------------------------------

{
  const dz = 0;
  const lin = shapeStick(0.5, 0, dz, 1);
  const sq = shapeStick(0.5, 0, dz, 2);
  const cube = shapeStick(0.5, 0, dz, 3);

  check(near(lin.x, 0.5, 1e-12), 'at exponent 1.0 the stick is linear', `${lin.x}`);
  check(near(sq.x, 0.25, 1e-12), 'at 2.0 half a stick is a quarter of the speed', `${sq.x}`);
  check(near(cube.x, 0.125, 1e-12), 'at 3.0 it is an eighth', `${cube.x}`);

  check(near(shapeStick(1, 0, dz, 2).x, 1, 1e-12),
    'and the curve NEVER costs the top end - full stick is full speed at any exponent');

  // The curve shapes the LIVE travel, which is why it is applied after the
  // deadzone rescale. If it were applied to the raw magnitude, moving the curve
  // slider would move where the deadzone effectively sits.
  const a = shapeStick(0.12 + 1e-9, 0, 0.12, 3);
  check(a.mag < 1e-20, 'the curve is applied past the deadzone edge, not before it',
    `${a.mag.toExponential(3)}`);
}

// --- the rate is a rate -----------------------------------------------------

{
  const opts = {};   // the shipped defaults
  const one = lookDelta(1, 0, 1 / 60, opts);
  const two = lookDelta(1, 0, 2 / 60, opts);

  check(near(two.dxRad / one.dxRad, 2, 1e-12),
    'DOUBLING DELTA TIME EXACTLY DOUBLES THE ANGLE TURNED',
    `${one.dxRad.toFixed(9)} -> ${two.dxRad.toFixed(9)} rad, ratio ${(two.dxRad / one.dxRad).toFixed(12)}`);

  check(lookDelta(1, 0, 0, opts).dxRad === 0, 'a zero frame turns nothing');

  // ONE SIMULATED SECOND, TWO FRAME RATES. This is the assertion the whole
  // design exists for. 16ms is a 60fps machine; 33ms is what the frame governor
  // was written to cope with.
  const sumAt = (dt) => {
    let total = 0;
    let t = 0;
    while (t < 1 - 1e-12) {
      const step = Math.min(dt, 1 - t);
      total += lookDelta(1, 0, step, opts).dxRad;
      t += step;
    }
    return total;
  };

  const at16 = sumAt(0.016);
  const at33 = sumAt(0.033);
  const at8 = sumAt(0.008);

  check(near(at16, at33, 1e-9) && near(at16, at8, 1e-9),
    'ONE SECOND OF FULL STICK TURNS THE SAME ANGLE AT 8, 16 AND 33 MS FRAMES',
    `${at8.toFixed(9)} / ${at16.toFixed(9)} / ${at33.toFixed(9)} rad`);
  check(near(at16, PAD_DEFAULTS.yawRate, 1e-9),
    'and that angle is the stated turn rate',
    `${(at16 * 180 / Math.PI).toFixed(4)} deg/s against a stated ${(PAD_DEFAULTS.yawRate * 180 / Math.PI).toFixed(4)}`);

  // Pitch is deliberately slower than yaw. The vertical axis is clamped to 180
  // degrees of total travel by the camera, so the same rate would run floor to
  // ceiling in a flick.
  const p = lookDelta(0, 1, 1, opts);
  check(near(p.dyRad, PAD_DEFAULTS.pitchRate, 1e-12) && PAD_DEFAULTS.pitchRate < PAD_DEFAULTS.yawRate,
    'pitch is slower than yaw', `${(p.dyRad * 180 / Math.PI).toFixed(2)} deg/s`);

  const inv = lookDelta(0, 1, 1, { invertY: true });
  check(inv.dyRad === -p.dyRad, 'invert flips the vertical and only the vertical',
    `${p.dyRad.toFixed(4)} -> ${inv.dyRad.toFixed(4)}`);

  const half = lookDelta(1, 0, 1, { sensitivity: 0.5 });
  const dbl = lookDelta(1, 0, 1, { sensitivity: 2.0 });
  check(near(dbl.dxRad / half.dxRad, 4, 1e-12),
    'sensitivity is a straight multiplier, four times the speed at 2.00 against 0.50',
    `${half.dxRad.toFixed(6)} -> ${dbl.dxRad.toFixed(6)}`);
}

// --- the repeat and the profiles -------------------------------------------

{
  const r = createRepeater();
  check(r.step(1, 0) === 1, 'the first press of a direction is immediate');
  check(r.step(1, MENU.delay * 0.5) === 0, 'and the second does not come early');
  check(r.step(1, MENU.delay * 0.6) === 1, 'it comes after the initial delay');
  check(r.step(1, MENU.repeat * 1.1) === 1, 'then repeats at the fast rate');
  check(r.step(-1, 0) === -1, 'and a direction CHANGE presses immediately again');
  check(r.step(0, 1) === 0, 'centre is silent');

  check(resolveProfile({ mapping: 'standard', id: 'anything', axes: [0, 0, 0, 0] }).profile.id === 'standard',
    'a pad the browser mapped is read through the standard layout');

  const raw = resolveProfile({
    mapping: '',
    id: 'Wireless Controller (Vendor: 054c Product: 09cc)',
    axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  });
  check(raw.profile.id === 'ds4-raw' && raw.assumed === false,
    'AN UNMAPPED DUALSHOCK IS RECOGNISED AND READ THROUGH THE RAW HID LAYOUT',
    raw.profile.name);

  const guess = resolveProfile({ mapping: '', id: 'Some Unknown Pad', axes: [0, 0, 0, 0] });
  check(guess.profile.id === 'standard' && guess.assumed === true,
    'and anything unrecognised falls back to standard AND SAYS IT GUESSED');

  check(MAX_POLL_DELTA === 1 / 20,
    'the pad clamps its delta to the same 1/20 the frame loop clamps the simulation to');
  check(TRIGGER.fireOn > TRIGGER.fireOff && TRIGGER.adsOn > TRIGGER.adsOff,
    'both triggers arm high and disarm low, so a resting spring cannot chatter',
    `fire ${TRIGGER.fireOff}..${TRIGGER.fireOn}, aim ${TRIGGER.adsOff}..${TRIGGER.adsOn}`);
}

// ---------------------------------------------------------------------------
// 2. THE WIRE, IN A REAL BROWSER, WITH A SYNTHETIC PAD
// ---------------------------------------------------------------------------
//
// EVERYTHING BELOW LETS THE REAL FRAME LOOP DO THE POLLING, and the first
// version of this file did not, which is worth writing down because the way it
// broke is the way this project's defining bug class always breaks.
//
// src/main.js now calls `input.pollPad(rig, raw)` once per frame. This suite was
// written before that landed, so it supplied the poll itself from its own
// animation frame and then awaited a requestAnimationFrame - during which the
// real loop polled AGAIN, at its own delta. Every measurement was the sum of two
// polls and read about four times the predicted angle. The suite was green
// against a tree where nothing else polled, and the patch landing is what
// invalidated it. A harness that drives a path production does not use is not
// testing production; it is testing the harness.
//
// So the model here is: SET THE PAD, WAIT FOR GAME FRAMES, MEASURE THE CAMERA.
// Nothing calls pollPad except the frame loop, with two deliberate and
// clearly-labelled exceptions: THE PACING TEST below, which exists because of
// what the clamp does to this environment, and the IDEMPOTENCE CHECK in section
// 3, whose entire subject is what happens when pollPad is called more than once
// in a frame. Both of them are about the poll itself rather than about any
// binding, and neither is used to measure a rate the loop should have measured.
//
// ---------------------------------------------------------------------------
// HOW MUCH TIME THE LOOP SPENT, WITHOUT THE LOOP TELLING US
// ---------------------------------------------------------------------------
//
// A rate can only be checked against the time it was spent over, and the loop
// polls at whatever delta the machine gave it. That number is not exported -
// but it does not have to be, because it is already observable:
//
//   main.js:  input.pollPad(rig, raw)          <- pad clamps raw to [0, 1/20]
//             if (pause.paused) { ...; return }
//             const dt = Math.min(raw, MAX_DELTA)   <- the SAME 1/20
//             elapsed += dt
//
// For any raw >= 0 those two clamps are identical, so on every unpaused frame
// the pad is handed exactly the delta that `elapsed` advances by. The total time
// the pad was polled over IS the change in `__SANDS__.elapsed`, exactly, with no
// new instrumentation in the production files. Paused frames poll the pad but
// generate no look at all - it routes to menu mode - and do not advance elapsed,
// so the identity survives them too.
//
// ---------------------------------------------------------------------------
// AND WHY FRAME-RATE INDEPENDENCE CANNOT BE TESTED THROUGH THE LOOP HERE
// ---------------------------------------------------------------------------
//
// Measured on this machine, before writing any of this, at four different render
// costs:
//
//     viewport / fidelity      wall ms/frame     sim ms/frame
//     1280x760 high              1286.4             50.000
//     320x240  low                157.8             50.000
//     240x180  low                130.0             50.000
//
// A TEN-FOLD change in how fast the browser painted moved the delta the loop
// hands out by nothing at all, because every frame under software rendering is
// slower than MAX_DELTA and is clamped to exactly 1/20. The loop's delta is a
// CONSTANT in this harness.
//
// That has a sharp consequence and it is the reason the pacing test below is
// shaped the way it is: while dt is constant, an implementation that multiplies
// by dt and one that adds a fixed amount per frame produce identical output. No
// test that only watches the shipping loop under swiftshader can tell them
// apart. The variation has to be injected, and the honest place to inject it is
// the argument itself.

/**
 * WHICH TREE IS BEING TESTED, and it is checked rather than trusted.
 *
 * A stale http.server has silently made agents test the wrong tree twice on
 * this project. The bytes the server hands out are hashed against the bytes on
 * disk before a single assertion is made.
 *
 * src/main.js IS IN THIS LIST even though this work does not own it. The poll
 * call lives there now, so a tree serving a main.js without it would fail every
 * assertion below for a reason that has nothing to do with the pad, and the
 * suite should say which file was wrong rather than leave it to be guessed.
 */
const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
console.log(`testing ${BASE}`);

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const origin = new URL(BASE).origin;
const hashes = {};
for (const rel of ['src/core/gamepad.js', 'src/core/input.js', 'src/ui/pause.js', 'src/main.js']) {
  const disk = sha(readFileSync(new URL(`../${rel}`, import.meta.url)));
  let served = 'unreachable';
  try {
    const res = await fetch(`${origin}/${rel}`);
    served = sha(Buffer.from(await res.arrayBuffer()));
  } catch (e) {
    served = `error: ${e.message}`;
  }
  hashes[rel] = disk;
  check(served === disk, `SERVED BYTES MATCH DISK: ${rel}`,
    served === disk ? disk.slice(0, 16) : `disk ${disk.slice(0, 16)} vs served ${String(served).slice(0, 16)}`);
}

// The poll call itself, asserted by reading the file rather than by inferring it
// from behaviour. If it is missing, every look check below fails and this line
// is the one that says why.
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check(/input\.pollPad\s*\(/.test(mainSrc),
  'main.js calls input.pollPad - the one line this feature needs from the frame loop',
  (/input\.pollPad\s*\([^)]*\)/.exec(mainSrc) || ['missing'])[0]);

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--autoplay-policy=no-user-gesture-required'],
});

/**
 * A SMALL VIEWPORT, AND THAT IS A BUDGET DECISION RATHER THAN A CORNER CUT.
 *
 * Every measurement in this file now waits on real GAME frames, and a game frame
 * at 1280x760 on high fidelity costs 1.29 seconds under swiftshader against 0.16
 * at 480x360 on low. The same assertions at the large size would take well over
 * an hour.
 *
 * It is safe HERE and would not be safe in test/settings.mjs or test/hud.mjs,
 * and the difference is the whole justification: this suite makes no claim about
 * a pixel. It asserts angles, flags and state. Nothing below reads a screenshot,
 * so render size cannot change an answer - and the delta the loop hands out is
 * clamped to the same 1/20 at every size, which was measured rather than assumed
 * (see the table above).
 */
const page = await browser.newPage({ viewport: { width: 480, height: 360 } });

const DRIVER_NOISE = /GL Driver Message .*Performance/;
const logs = [];
page.on('console', (m) => {
  if (m.type() !== 'error' && m.type() !== 'warning') return;
  const text = m.text();
  if (DRIVER_NOISE.test(text)) return;
  logs.push(`[${m.type()}] ${text}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

/**
 * THE SYNTHETIC PAD, installed before a line of the game runs.
 *
 * navigator.getGamepads is replaced rather than shimmed on top of, because the
 * reader is supposed to call it and nothing else, and a partial replacement
 * would let a real pad on the developer's machine change the result of a suite.
 *
 * The pad is deliberately placed in SLOT 2 with nulls either side. Reading slot
 * 0 is the failure mode this project keeps producing: correct looking code that
 * reads nothing on the one machine that matters.
 */
await page.addInitScript(() => {
  const button = () => ({ pressed: false, touched: false, value: 0 });

  const makeStandard = () => ({
    id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
    index: 2,
    mapping: 'standard',
    connected: true,
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, button),
    vibrationActuator: {
      playEffect(type, params) {
        window.__PAD__.effects.push({ type, params });
        return Promise.resolve('complete');
      },
    },
  });

  /**
   * The raw HID layout a DualShock 4 reports when nobody has remapped it.
   * Face buttons in physical order, triggers as axes 3 and 4 resting at -1,
   * the right stick's vertical on axis 5, and the D-pad as a hat on axis 9
   * whose centred value is 1.286 rather than 0.
   */
  const makeRaw = () => ({
    id: 'Wireless Controller (Vendor: 054c Product: 09cc)',
    index: 2,
    mapping: '',
    connected: true,
    timestamp: 0,
    axes: [0, 0, 0, -1, -1, 0, 0, 0, 0, 1.286],
    buttons: Array.from({ length: 14 }, button),
    vibrationActuator: null,
  });

  window.__PAD__ = {
    slots: [null, null, null, null],
    effects: [],
    kind: 'none',

    plug(kind = 'standard', slot = 2) {
      this.kind = kind;
      this.slots = [null, null, null, null];
      this.slots[slot] = kind === 'raw' ? makeRaw() : makeStandard();
      this.slots[slot].index = slot;
      return { slot, kind };
    },
    unplug() { this.slots = [null, null, null, null]; this.kind = 'none'; },
    get gp() { return this.slots.find((s) => s) || null; },

    ax(i, v) { const g = this.gp; if (g) g.axes[i] = v; return v; },
    btn(i, down) {
      const g = this.gp;
      if (!g) return false;
      g.buttons[i].pressed = !!down;
      g.buttons[i].value = down ? 1 : 0;
      return !!down;
    },
    /** An ANALOG press, which is what the two triggers actually report. */
    val(i, v) {
      const g = this.gp;
      if (!g) return 0;
      g.buttons[i].value = v;
      g.buttons[i].pressed = v > 0.5;
      return v;
    },
    /** All buttons up, both sticks home. */
    idle() {
      const g = this.gp;
      if (!g) return;
      for (const b of g.buttons) { b.pressed = false; b.value = 0; }
      for (let i = 0; i < g.axes.length; i++) g.axes[i] = 0;
      if (this.kind === 'raw') { g.axes[3] = -1; g.axes[4] = -1; g.axes[9] = 1.286; }
    },
  };

  navigator.getGamepads = () => window.__PAD__.slots;
});

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
// BEGIN raises the briefing card now; the world is held behind it. See chrome.mjs.
await dismissBriefing(page);
await page.waitForTimeout(1400);

/**
 * A CLEAN FIELD, and an earlier run of this suite is why it is here.
 *
 * Every assertion below the halfway mark failed once, in a way that read as the
 * pad having gone dead: no movement, no trigger, no reload. The cause was not
 * the pad. This suite spends minutes of simulated time, the wave director sent a
 * wave in the middle of it, and the player - standing in the courtyard doing
 * nothing - was killed. That halts the run and SUSPENDS the input layer, so the
 * pad correctly went to menu mode and correctly stopped driving a game that was
 * no longer running.
 *
 * Worth writing down because the failure was indistinguishable from the feature
 * being broken. The wave hold is re-applied between sections rather than once,
 * since the director re-arms its own breather.
 *
 * Fidelity goes down and the governor is stood down at the same time, for the
 * budget reason in the viewport note above: the governor would otherwise spend
 * the first seconds of every section climbing back up a ladder this suite has no
 * opinion about.
 */
const stage = () => page.evaluate(() => {
  const g = window.__SANDS__;
  g.combat.state.invulnerable = true;
  g.director.reset();
  g.director.state.timer = 9999;
  g.player.heal(g.player.state.maxHealth);
  g.governor.yieldToPlayer();
  g.setFidelity(false);
  return { live: g.director.live.length, halted: g.death.halted };
});

await stage();

/**
 * The harness's half, and it no longer polls anything.
 *
 * `live` is the shape of every look measurement below: point the camera, let the
 * REAL loop run n frames with the pad already deflected, and read back both the
 * angle turned and the simulated time it was turned over. The second number is
 * what makes a rate assertable without the loop having to export its delta.
 */
await page.addScriptTag({
  content: `
window.__G__ = {
  async frames(n) {
    const g = window.__SANDS__;
    const target = g.frameNo + n;
    // A ceiling on iterations rather than on wall time, so a slow machine is
    // slow rather than failing.
    for (let i = 0; i < n * 80 + 800; i++) {
      if (g.frameNo >= target) return g.frameNo;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return g.frameNo;
  },

  /**
   * Every number a look assertion needs, read in ONE synchronous turn.
   *
   * All four together or none: a frame cannot interleave inside a synchronous
   * read, so the yaw and the elapsed clock are always describing the same
   * instant. Reading them in two evaluates would let a frame land between and
   * would attribute that frame's angle to the wrong window.
   */
  snap() {
    const g = window.__SANDS__;
    return { frameNo: g.frameNo, elapsed: g.elapsed, yaw: g.rig.yaw, pitch: g.rig.pitch };
  },

  aim() {
    const g = window.__SANDS__;
    g.rig.reset(0, 0);
    g.rig.update(1 / 60, g.player, false);
    return { yaw: g.rig.yaw, pitch: g.rig.pitch };
  },

  /**
   * THE SHIPPING PATH. Nothing here calls pollPad; the frame loop does.
   *
   * Returns the angle turned and the simulated seconds it was turned over, so
   * the caller divides one by the other and gets a rate that is independent of
   * how many frames the machine managed.
   */
  async live(n) {
    const g = window.__SANDS__;
    window.__G__.aim();
    const a = window.__G__.snap();
    await window.__G__.frames(n);
    const b = window.__G__.snap();
    return {
      frames: b.frameNo - a.frameNo,
      sim: b.elapsed - a.elapsed,
      yaw: b.yaw - a.yaw,
      pitch: b.pitch - a.pitch,
    };
  },

  /**
   * Inject mouse counts the way a mousemove does, over n frames, and report the
   * total pushed. Used for the both-devices-at-once check.
   */
  async mouse(n, per) {
    const g = window.__SANDS__;
    let counts = 0;
    for (let i = 0; i < n; i++) {
      g.input.state.dx += per;
      counts += per;
      await new Promise((r) => requestAnimationFrame(r));
    }
    await window.__G__.frames(2);
    return counts;
  },

  /**
   * THE PACING TEST, and the ONE place in this file that calls pollPad.
   *
   * It is here because the frame loop's delta is a constant in this harness -
   * every frame is slower than MAX_DELTA and is clamped to exactly 1/20, at
   * every render size measured. While dt never varies, multiplying by dt and
   * adding a constant per frame are the same function, so watching the loop
   * cannot distinguish the correct implementation from the broken one. The
   * quantity under test has to be varied, and the only way to vary it is to
   * pass it.
   *
   * This is NOT the harness-only path that made the first version of this file
   * wrong. It calls the same function main.js calls, with the same reader, the
   * same accumulator and the same camera; the only substitution is the VALUE of
   * the argument, which is exactly the variable being tested. And the loop's own
   * polls are not ignored this time - they are measured, through elapsed, and
   * added to the total the rate is computed against. That is what the first
   * version failed to do.
   */
  async paced(count, dt) {
    const g = window.__SANDS__;
    window.__G__.aim();
    const a = window.__G__.snap();

    let mine = 0;
    for (let i = 0; i < count; i++) {
      g.input.pollPad(g.rig, dt);
      mine += Math.min(dt, 1 / 20);
      await new Promise((r) => requestAnimationFrame(r));
    }
    // Two clean frames so the last injected counts have been drained by the
    // loop before anything is read. The stick is still deflected, so these
    // frames contribute to BOTH the angle and the elapsed clock and the
    // identity holds.
    await window.__G__.frames(2);

    const b = window.__G__.snap();
    const loop = b.elapsed - a.elapsed;
    return {
      polls: count,
      dt,
      mine: +mine.toFixed(9),
      loop: +loop.toFixed(9),
      total: +(mine + loop).toFixed(9),
      yaw: b.yaw - a.yaw,
      loopFrames: b.frameNo - a.frameNo,
    };
  },
};
`,
});

// --- the pad is FOUND, in slot 2 --------------------------------------------

notes.push('\n--- finding the pad ---');

const before = await page.evaluate(() => window.__SANDS__.input.pad.info());
check(before.connected === false, 'with nothing plugged in, no pad is reported',
  `index ${before.index}`);

await page.evaluate(() => window.__PAD__.plug('standard', 2));
await page.evaluate(() => window.__G__.frames(2));
const found = await page.evaluate(() => window.__SANDS__.input.pad.info());

check(found.connected === true,
  'A PLUGGED PAD IS FOUND BY THE FRAME LOOP ITSELF - nothing in this suite polled it');
check(found.index === 2,
  'AND IT IS FOUND IN SLOT 2 - every slot is scanned, index 0 is not assumed',
  `index ${found.index}`);
check(found.mapping === 'standard' && found.profile === 'standard',
  'the browser reported the standard mapping and it is read as standard',
  `mapping "${found.mapping}" profile ${found.profile}`);
check(found.assumed === false, 'and the layout was not guessed');
check(found.vibration === true, 'the pad reports a vibration actuator');

// --- the loop's delta, stated -----------------------------------------------

const pacing = await page.evaluate(() => window.__G__.live(10));
check(pacing.frames > 0 && pacing.sim > 0,
  'the loop is running and its simulated clock is advancing',
  `${pacing.frames} frames, ${pacing.sim.toFixed(4)}s of simulated time,`
  + ` mean ${(pacing.sim / pacing.frames * 1000).toFixed(3)}ms per frame`);

// --- POINTER LOCK IS DENIED FROM HERE ON ------------------------------------
//
// The claim being set up is the one that decides whether this feature exists at
// all: a player who picked up a controller has no reason to click a canvas, and
// a camera that is dead until they do would be reported as "the pad does not
// work". So the request is refused for the whole rest of the suite - which is
// the honest way to test it, because a headless browser will happily grant
// pointer lock and a check that merely READ `locked` would be asserting nothing
// about the code path.
//
// It also stabilises everything below. Losing the lock is what main.js opens the
// pause menu on, so this is the last time that can happen.

notes.push('\n--- pointer lock ---');

const unlocked = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const canvas = document.getElementById('stage');
  const had = !!document.pointerLockElement;

  canvas.requestPointerLock = () => {};
  if (document.pointerLockElement) document.exitPointerLock();
  await window.__G__.frames(3);

  if (g.pause.paused) g.pause.resume();
  await window.__G__.frames(3);

  return {
    had,
    locked: g.input.state.locked,
    fallback: g.input.state.fallback,
    paused: g.pause.paused,
  };
});

check(unlocked.locked === false && unlocked.paused === false,
  'pointer lock is released and refused for the rest of this suite',
  `was held: ${unlocked.had}, now locked ${unlocked.locked}, paused ${unlocked.paused}`);

// ---------------------------------------------------------------------------
// LOOK, MEASURED OFF THE CAMERA WITH THE LOOP DOING THE POLLING
// ---------------------------------------------------------------------------

notes.push('\n--- look ---');

/**
 * The rate the maths says the game should turn at, in radians per second of
 * simulated time, computed HERE rather than read out of the page.
 *
 * rig.look() subtracts, so a stick pushed right produces a negative yaw. The
 * counts conversion in core/input.js divides by the same radians-per-count that
 * rig.look multiplies by, so the two cancel and what survives is exactly the
 * radians gamepad.js asked for - which is why this prediction can be made from
 * the pure function with no knowledge of the mouse sensitivity in force.
 */
const rateFor = (x, y, o = {}) => {
  const d = lookDelta(x, y, 1, o);
  return { yaw: -d.dxRad, pitch: -d.dyRad };
};

await page.evaluate(() => { window.__PAD__.idle(); });
await page.evaluate(() => window.__PAD__.ax(2, 0.5));       // right stick, half right
const half = await page.evaluate(() => window.__G__.live(20));
const wantHalf = rateFor(0.5, 0);
const halfRate = half.yaw / half.sim;

check(near(halfRate, wantHalf.yaw, Math.abs(wantHalf.yaw) * 1e-6),
  'HALF A STICK TURNS THE CAMERA AT EXACTLY THE PREDICTED RATE, through the real loop',
  `predicted ${wantHalf.yaw.toFixed(9)} rad/s, measured ${halfRate.toFixed(9)} rad/s`
  + ` over ${half.frames} frames and ${half.sim.toFixed(3)}s`);
check(half.yaw < 0, 'pushing the stick right turns right', `yaw ${half.yaw.toFixed(6)}`);

// --- the deadzone -----------------------------------------------------------

await page.evaluate(() => { window.__PAD__.idle(); });
await page.evaluate(() => window.__PAD__.ax(2, 0.05));
const drifted = await page.evaluate(() => window.__G__.live(20));
check(drifted.yaw === 0,
  'a stick resting inside the deadzone moves the camera by EXACTLY nothing',
  `yaw ${drifted.yaw} over ${drifted.frames} frames`);

// --- diagonals do not snap --------------------------------------------------

await page.evaluate(() => { window.__PAD__.idle(); });
await page.evaluate(() => { window.__PAD__.ax(2, 0.5); window.__PAD__.ax(3, 0.5); });
const diag = await page.evaluate(() => window.__G__.live(20));
const wantDiag = rateFor(0.5, 0.5);
const diagYaw = diag.yaw / diag.sim;
const diagPitch = diag.pitch / diag.sim;

check(near(diagYaw, wantDiag.yaw, Math.abs(wantDiag.yaw) * 1e-6)
  && near(diagPitch, wantDiag.pitch, Math.abs(wantDiag.pitch) * 1e-6),
  'a diagonal push moves both axes at their predicted rates',
  `yaw ${diagYaw.toFixed(6)}/${wantDiag.yaw.toFixed(6)}`
  + ` pitch ${diagPitch.toFixed(6)}/${wantDiag.pitch.toFixed(6)} rad/s`);
check(near(diagYaw / diagPitch, PAD_DEFAULTS.yawRate / PAD_DEFAULTS.pitchRate, 1e-6),
  'and the ratio between them is the ratio of the two turn rates, not 1 and not infinity',
  `${(diagYaw / diagPitch).toFixed(6)}`);

// --- FRAME RATE INDEPENDENCE, ON THE SHIPPING FUNCTION ----------------------
//
// See __G__.paced and the note at the top of this section. The loop's delta is
// pinned at 1/20 here whatever the machine does, so the variation is injected
// through the argument - and the loop's own share is measured through `elapsed`
// and added to the divisor rather than pretended away.
//
// The two runs are chosen so that a WRONG implementation is caught starkly. Run
// A makes twice as many polls as run B for roughly the same injected time. An
// implementation that added a fixed amount per poll rather than a rate times a
// delta would turn about twice as far in A as in B while the total time differs
// by much less, and the two rates would separate by tens of per cent.

notes.push('\n--- frame rate independence ---');

await page.evaluate(() => { window.__PAD__.idle(); });
await page.evaluate(() => window.__PAD__.ax(2, 1));

const pacedA = await page.evaluate(() => window.__G__.paced(40, 0.016));
const pacedB = await page.evaluate(() => window.__G__.paced(20, 0.033));

const rateA = pacedA.yaw / pacedA.total;
const rateB = pacedB.yaw / pacedB.total;
const wantFull = rateFor(1, 0).yaw;

check(near(rateA, rateB, Math.abs(wantFull) * 1e-6),
  'THE SAME STICK TURNS AT THE SAME RATE AT 16MS AND 33MS INJECTED FRAMES',
  `${rateA.toFixed(9)} against ${rateB.toFixed(9)} rad/s,`
  + ` difference ${(Math.abs(rateA - rateB) * 180 / Math.PI).toExponential(3)} deg/s`);
check(near(rateA, wantFull, Math.abs(wantFull) * 1e-6)
  && near(rateB, wantFull, Math.abs(wantFull) * 1e-6),
  'and both are the turn rate a full stick is specified to give',
  `${(Math.abs(rateA) * 180 / Math.PI).toFixed(4)} and`
  + ` ${(Math.abs(rateB) * 180 / Math.PI).toFixed(4)} deg/s against a stated`
  + ` ${(Math.abs(wantFull) * 180 / Math.PI).toFixed(4)}`);
check(pacedA.polls === pacedB.polls * 2 && Math.abs(pacedA.mine - pacedB.mine) < 0.05,
  'and run A really did poll twice as often for the same injected time,'
  + ' which is what makes this discriminating',
  `A ${pacedA.polls} polls / ${pacedA.mine}s injected + ${pacedA.loop}s from the loop;`
  + ` B ${pacedB.polls} polls / ${pacedB.mine}s injected + ${pacedB.loop}s from the loop`);

// --- the mouse slider does not move the stick -------------------------------

await page.evaluate(() => { window.__PAD__.idle(); });
await page.evaluate(() => window.__PAD__.ax(2, 1));
const sens1 = await page.evaluate(() => window.__G__.live(16));
await page.evaluate(() => window.__SANDS__.rig.setSensitivityScale(3.0));
const sens3 = await page.evaluate(() => window.__G__.live(16));
await page.evaluate(() => window.__SANDS__.rig.setSensitivityScale(1.0));

const r1 = sens1.yaw / sens1.sim;
const r3 = sens3.yaw / sens3.sim;

check(near(r1, r3, Math.abs(wantFull) * 1e-6),
  'THE MOUSE SENSITIVITY SLIDER DOES NOT CHANGE THE STICK - two sliders on one'
  + ' panel must not multiply each other',
  `${r1.toFixed(9)} rad/s at 1.00x, ${r3.toFixed(9)} rad/s at 3.00x`);

// --- both devices at once ---------------------------------------------------
//
// Three windows rather than one comparison, because the mouse is a DELTA and the
// stick is a RATE and the two cannot be added without a common term. The pad's
// contribution is its measured rate times the simulated time of the window it is
// being predicted for; the mouse's is whatever the same number of counts moved
// the camera on its own.

await page.evaluate(() => { window.__PAD__.idle(); });
await page.evaluate(() => window.__PAD__.ax(2, 1));
const padWindow = await page.evaluate(() => window.__G__.live(16));
const padRate = padWindow.yaw / padWindow.sim;

await page.evaluate(() => { window.__PAD__.idle(); });
const mouseWindow = await page.evaluate(async () => {
  window.__G__.aim();
  const a = window.__G__.snap();
  const counts = await window.__G__.mouse(16, 4);
  const b = window.__G__.snap();
  return { counts, yaw: b.yaw - a.yaw, sim: b.elapsed - a.elapsed };
});

await page.evaluate(() => window.__PAD__.ax(2, 1));
const bothWindow = await page.evaluate(async () => {
  window.__G__.aim();
  const a = window.__G__.snap();
  const counts = await window.__G__.mouse(16, 4);
  const b = window.__G__.snap();
  return { counts, yaw: b.yaw - a.yaw, sim: b.elapsed - a.elapsed };
});

const expectedBoth = padRate * bothWindow.sim + mouseWindow.yaw;

check(mouseWindow.counts === bothWindow.counts && mouseWindow.yaw < 0,
  'the mouse moved the camera on its own, with the same counts both times',
  `${bothWindow.counts} counts, ${mouseWindow.yaw.toFixed(6)} rad`);
check(near(bothWindow.yaw, expectedBoth, Math.abs(expectedBoth) * 1e-4),
  'A MOUSE AND A STICK MOVING TOGETHER SUM - neither device wins and neither is dropped',
  `pad ${(padRate * bothWindow.sim).toFixed(6)} + mouse ${mouseWindow.yaw.toFixed(6)}`
  + ` = ${expectedBoth.toFixed(6)}, measured ${bothWindow.yaw.toFixed(6)}`);

// --- and none of that needed pointer lock -----------------------------------

const lockState = await page.evaluate(() => ({
  locked: window.__SANDS__.input.state.locked,
  fallback: window.__SANDS__.input.state.fallback,
  paused: window.__SANDS__.pause.paused,
}));
check(lockState.locked === false && lockState.paused === false,
  'EVERY LOOK MEASUREMENT ABOVE WAS TAKEN WITH POINTER LOCK REFUSED - a pad'
  + ' player is never asked to click the canvas',
  `locked ${lockState.locked}, mouse fallback ${lockState.fallback}`);

// ---------------------------------------------------------------------------
// 3. THE BUTTONS, ASSERTED ON THE GAME AND NOT ON THE INPUT LAYER
// ---------------------------------------------------------------------------

notes.push('\n--- the buttons ---');

await page.evaluate(() => { window.__PAD__.idle(); });
await stage();

/**
 * Press, let the loop see it, release, let the loop see that.
 *
 * Two frames each way, which is 0.1 simulated seconds - comfortably inside the
 * 0.4s menu repeat delay, so a tap is exactly one action and never two.
 */
const tapButton = async (i) => {
  await page.evaluate((n) => window.__PAD__.btn(n, true), i);
  await page.evaluate(() => window.__G__.frames(2));
  await page.evaluate((n) => window.__PAD__.btn(n, false), i);
  await page.evaluate(() => window.__G__.frames(2));
};

/**
 * A DOUBLE POLL OF A HELD BUTTON IS IDEMPOTENT, and it is checked rather than
 * assumed - it was the assumption that made the first version of this file
 * wrong, so the same assumption does not get made twice.
 *
 * This is the property that lets anything call pollPad more than once in a frame
 * without an action firing twice. Edges are computed against the previous poll's
 * state, so the second poll of an unchanged button reports no edge at all.
 */
const idempotent = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__PAD__.btn(0, true);                 // Cross, held
  const first = g.input.pollPad(g.rig, 1 / 60);
  const second = g.input.pollPad(g.rig, 1 / 60);
  const third = g.input.pollPad(g.rig, 1 / 60);
  window.__PAD__.btn(0, false);
  g.input.pollPad(g.rig, 1 / 60);
  return {
    first: first.pressed.slice(),
    second: second.pressed.slice(),
    third: third.pressed.slice(),
    stillHeld: second.buttons.cross && third.buttons.cross,
  };
});
check(idempotent.first.includes('cross')
  && idempotent.second.length === 0 && idempotent.third.length === 0,
  'A SECOND POLL OF A HELD BUTTON REPORTS NO EDGE - polling twice cannot fire twice',
  `first ${JSON.stringify(idempotent.first)}, second ${JSON.stringify(idempotent.second)}`);
check(idempotent.stillHeld === true,
  'while the button is still correctly reported as down');

await page.evaluate(() => window.__G__.frames(2));

// --- the analog trigger -----------------------------------------------------

const trigAt = async (v) => {
  await page.evaluate((n) => window.__PAD__.val(7, n), v);
  await page.evaluate(() => window.__G__.frames(2));
  return page.evaluate(() => ({
    fire: window.__SANDS__.input.state.fire,
    analog: window.__SANDS__.input.pad.snapshot.analog.r2,
  }));
};

const at45 = await trigAt(0.45);
const at60 = await trigAt(0.60);
const back45 = await trigAt(0.45);
const back30 = await trigAt(0.30);
await page.evaluate(() => window.__PAD__.val(7, 0));
await page.evaluate(() => window.__G__.frames(2));

check(at45.fire === false,
  'R2 AT 0.45 IS NOT FIRING - the trigger is read as an analog pull, not a switch',
  `analog ${at45.analog}, and .pressed would already be true here`);
check(at60.fire === true, 'R2 past the arm point fires', `analog ${at60.analog}`);
check(back45.fire === true,
  'and it STAYS armed between the two thresholds, so a resting spring cannot chatter');
check(back30.fire === false, 'below the disarm point it stops');

await page.evaluate(() => window.__PAD__.val(6, 0.35));
await page.evaluate(() => window.__G__.frames(2));
const adsOn = await page.evaluate(() => window.__SANDS__.input.state.ads);
await page.evaluate(() => window.__PAD__.val(6, 0));
await page.evaluate(() => window.__G__.frames(2));
const adsOff = await page.evaluate(() => window.__SANDS__.input.state.ads);

check(adsOn === true && adsOff === false,
  'L2 brings the sight up, and it arms earlier in the pull than the trigger does',
  `arm at ${TRIGGER.adsOn} against ${TRIGGER.fireOn}`);

// --- firing and reloading, through the weapon system ------------------------
//
// SPEND A ROUND FIRST, and that half is not scene-setting. An earlier version
// emptied the magazine by writing `weapons.state.magazine = 1`. That field does
// not exist - the ammunition lives in a map private to the weapon system - so
// the magazine stayed full, reload() correctly refused, and the check reported a
// broken binding when the binding was fine and the TEST was wrong.

const full = await page.evaluate(() =>
  window.__SANDS__.weapons.STATS[window.__SANDS__.weapons.state.current].magazine);

await page.evaluate(() => window.__PAD__.val(7, 1));       // R2, fully pulled
await page.evaluate(() => window.__G__.frames(4));
await page.evaluate(() => window.__PAD__.val(7, 0));
await page.evaluate(() => window.__G__.frames(2));
const spent = await page.evaluate(() => window.__SANDS__.weapons.magazine);

check(spent < full, 'R2 PUTS ROUNDS DOWNRANGE - the magazine went down',
  `${full} -> ${spent}`);

await page.evaluate(() => window.__PAD__.btn(2, true));    // Square
await page.evaluate(() => window.__G__.frames(2));
const reloading = await page.evaluate(() => window.__SANDS__.weapons.isReloading);
await page.evaluate(() => window.__PAD__.btn(2, false));
await page.evaluate(() => window.__G__.frames(2));

check(reloading === true,
  'SQUARE RELOADS WHEN THERE IS NO PROMPT - asserted on the weapon system, which core/input.js cannot reach',
  `isReloading ${reloading}`);

await page.evaluate(() => window.__G__.frames(40));

// --- and Square does NOT reload when there is a prompt up --------------------
//
// SQUARE IS CONTEXTUAL NOW. The check above is made in an empty courtyard,
// which is where a Square that always reloads would pass every test anyone
// thought to write - so the interesting half is this one, and it has to be
// asserted on the weapon system for the same reason: input.js dispatches a key
// event and cannot see what happened to it.
//
// The prompt is put up the way the game puts it up, through the element the
// prompt bus paints, because that class IS the condition core/input.js reads.

await page.evaluate(async () => {
  const g = window.__SANDS__;
  // Spend a round again, so a refused reload and a reload that had nothing to
  // do are not the same observation.
  window.__PAD__.val(7, 1);
  await window.__G__.frames(4);
  window.__PAD__.val(7, 0);
  await window.__G__.frames(30);

  const el = document.getElementById('prompt');
  el.textContent = 'OPEN THE GATE  [F]';
  el.classList.add('on');
});

await page.evaluate(() => window.__PAD__.btn(2, true));    // Square, with a prompt up
await page.evaluate(() => window.__G__.frames(2));
const promptedReload = await page.evaluate(() => window.__SANDS__.weapons.isReloading);
await page.evaluate(() => window.__PAD__.btn(2, false));
await page.evaluate(() => window.__G__.frames(2));

check(promptedReload === false,
  'AND SQUARE DOES NOT RELOAD WITH A PROMPT UP - it went to the interact instead',
  `isReloading ${promptedReload}`);

await page.evaluate(() => {
  const el = document.getElementById('prompt');
  el.textContent = '';
  el.classList.remove('on', 'deny');
});
await page.evaluate(() => window.__G__.frames(40));

// --- melee ------------------------------------------------------------------
//
// CIRCLE IS THE KHOPESH'S PRIMARY BINDING and L1 is a second one, so both are
// asserted. Not because two bindings are twice as likely to break, but because
// the failure that matters is the SILENT one: Circle used to be the interact,
// and a Circle that swung AND still bought whatever the crosshair was on would
// look correct in every empty room in the map.

await page.evaluate(() => window.__PAD__.btn(1, true));    // Circle
await page.evaluate(() => window.__G__.frames(2));
const circlePhase = await page.evaluate(() => window.__SANDS__.viewmodel.state.phase);
await page.evaluate(() => window.__PAD__.btn(1, false));
await page.evaluate(() => window.__G__.frames(2));

check(circlePhase === 'meleeing',
  'CIRCLE SWINGS THE KHOPESH - asserted on the viewmodel state machine',
  `viewmodel phase ${circlePhase}`);

await page.evaluate(() => window.__G__.frames(40));

await page.evaluate(() => window.__PAD__.btn(4, true));    // L1
await page.evaluate(() => window.__G__.frames(2));
const meleePhase = await page.evaluate(() => window.__SANDS__.viewmodel.state.phase);
await page.evaluate(() => window.__PAD__.btn(4, false));
await page.evaluate(() => window.__G__.frames(2));

check(meleePhase === 'meleeing',
  'AND L1 KEEPS IT as a second binding - asserted the same way',
  `viewmodel phase ${meleePhase}`);

await page.evaluate(() => window.__G__.frames(30));

// --- L3 is the crouch, and the posture is the PLAYER'S and not the input's ---
//
// Asserted on player/controller.js's own eye height, not on the input flag. A
// crouch binding that sets a boolean nothing acts on is this project's defining
// bug shape, and it is the reason test/crouchslide.mjs exists; this is the
// smallest version of that check, made where the rest of the pad is tested.

await stage();
await page.evaluate(() => window.__G__.frames(2));
const standTall = await page.evaluate(() => +window.__SANDS__.player.state.eyeHeight.toFixed(3));
await tapButton(10);                                       // L3
await page.evaluate(() => window.__G__.frames(8));
const crouchedLow = await page.evaluate(() => +window.__SANDS__.player.state.eyeHeight.toFixed(3));
await tapButton(10);                                       // L3 again
await page.evaluate(() => window.__G__.frames(10));
const standAgain = await page.evaluate(() => +window.__SANDS__.player.state.eyeHeight.toFixed(3));

check(standTall === 1.68 && crouchedLow === 0.95 && standAgain === 1.68,
  'L3 CROUCHES THE BODY - the eye went 1.68 to 0.95 and back, measured on the controller',
  `${standTall} -> ${crouchedLow} -> ${standAgain}`);

await page.evaluate(() => { window.__SANDS__.input.state.crouch = false; });
await page.evaluate(() => window.__G__.frames(10));

// --- weapon swap ------------------------------------------------------------

await page.evaluate(() => {
  const g = window.__SANDS__;
  // A second weapon, or there is nowhere to cycle TO and the check would pass on
  // a Triangle that did nothing at all.
  g.weapons.grant('b3ar');
  g.weapons.equip('mk9');
});
await page.evaluate(() => window.__G__.frames(2));
const swapBefore = await page.evaluate(() => window.__SANDS__.weapons.state.current);
await tapButton(3);                                        // Triangle
const swapAfter = await page.evaluate(() => window.__SANDS__.weapons.state.current);

check(swapAfter !== swapBefore,
  'TRIANGLE SWAPS THE WEAPON - through the same wheel binding the mouse uses',
  `${swapBefore} -> ${swapAfter}`);

await page.evaluate(() => window.__SANDS__.weapons.equip('mk9'));
await page.evaluate(() => window.__G__.frames(20));

// --- the grenade is HELD, not tapped ----------------------------------------

await page.evaluate(() => window.__PAD__.btn(5, true));    // R1
await page.evaluate(() => window.__G__.frames(3));
const cooking = await page.evaluate(() => ({
  cooking: window.__SANDS__.grenades.state.cooking,
  cook: window.__SANDS__.grenades.cook,
}));
await page.evaluate(() => window.__PAD__.btn(5, false));
await page.evaluate(() => window.__G__.frames(3));
const thrown = await page.evaluate(() => window.__SANDS__.grenades.state.cooking);

check(cooking.cooking === true && cooking.cook > 0,
  'R1 HELD COOKS THE GRENADE - the fuse runs while the button is down',
  `cook ${cooking.cook.toFixed(3)}s`);
check(thrown === false, 'and releasing it throws');

await page.evaluate(() => window.__G__.frames(80));
await stage();

// --- movement ---------------------------------------------------------------

const moved = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const from = { x: g.player.position.x, z: g.player.position.z };
  window.__PAD__.ax(1, -1);                     // left stick forward
  await window.__G__.frames(12);
  const walked = Math.hypot(g.player.position.x - from.x, g.player.position.z - from.z);
  const fwd = g.input.state.forward;

  // Both devices asking for opposite things must cancel rather than fight.
  g.input.state.forward = -1;                   // as the keyboard's S would
  const summed = g.input.state.forward;
  g.input.state.forward = 0;

  window.__PAD__.ax(1, 0);
  await window.__G__.frames(2);
  return { walked, fwd, summed, after: g.input.state.forward };
});

check(moved.walked > 0.5, 'THE LEFT STICK WALKS THE PLAYER',
  `${moved.walked.toFixed(3)} m`);
check(moved.fwd > 0.9, 'a full stick forward is full forward', `${moved.fwd.toFixed(4)}`);
check(near(moved.summed, 0, 1e-9),
  'and a keyboard asking for the opposite CANCELS it rather than one winning',
  `pad +1 and key -1 gives ${moved.summed}`);
check(moved.after === 0, 'the axis returns to nothing when the stick comes home');

// ---------------------------------------------------------------------------
// 4. THE PAUSE MENU IS OPERABLE ON THE PAD
// ---------------------------------------------------------------------------

notes.push('\n--- the menu ---');

await stage();
await page.evaluate(() => window.__PAD__.idle());
await page.evaluate(() => window.__G__.frames(2));

await tapButton(9);                                   // Options
const opened = await page.evaluate(() => ({
  paused: window.__SANDS__.pause.paused,
  hidden: document.getElementById('pause').hidden,
  suspended: window.__SANDS__.input.state.suspended,
  cursor: window.__SANDS__.pause.padCursor,
}));

check(opened.paused === true && opened.hidden === false,
  'OPTIONS OPENS THE PAUSE MENU', `paused ${opened.paused}`);
check(opened.cursor.id === 'resume',
  'and the pad cursor starts on Resume, where the keyboard focus already is',
  `${opened.cursor.id} (${opened.cursor.index + 1} of ${opened.cursor.count})`);
check(opened.cursor.armed === false,
  'unarmed, so nothing is drawn until the pad is actually used');

// --- the D-pad moves the cursor ---------------------------------------------

await tapButton(12);                                  // D-pad up
const up1 = await page.evaluate(() => window.__SANDS__.pause.padCursor);
check(up1.index === up1.count - 2 && up1.id !== 'resume',
  'THE D-PAD MOVES THE SELECTION off Resume and onto a real control',
  `now on "${up1.id}" (${up1.index + 1} of ${up1.count})`);
check(up1.armed === true, 'and the cursor is now drawn');

// --- the shoulders change tab -----------------------------------------------

const tabBefore = await page.evaluate(() => window.__SANDS__.pause.tab);
await tapButton(5);                                   // R1
const tabAfter = await page.evaluate(() => window.__SANDS__.pause.tab);
check(tabBefore !== tabAfter, 'R1 CHANGES TAB', `${tabBefore} -> ${tabAfter}`);
await tapButton(4);                                   // L1
const tabBack = await page.evaluate(() => window.__SANDS__.pause.tab);
check(tabBack === tabBefore, 'and L1 changes it back', `${tabAfter} -> ${tabBack}`);

// --- a slider actually moves, DRIVEN FROM THE PAD ---------------------------
//
// The walk to the row goes through pause.padMenu directly, because forty
// D-pad taps at two game frames each is forty seconds of wall clock for a claim
// the tap above already made. The ADJUSTMENT itself is driven from the pad
// hardware, which is the part that has to be proven end to end.

const walked = await page.evaluate(() => {
  const g = window.__SANDS__;
  g.pause.show('game');
  for (let i = 0; i < 20; i++) {
    if (g.pause.padCursor.id === 'padsens') break;
    g.pause.padMenu('down');
  }
  return { landed: g.pause.padCursor.id, from: g.input.pad.sensitivity };
});
check(walked.landed === 'padsens', 'the cursor reaches the stick sensitivity row',
  walked.landed);

await tapButton(15);                                  // D-pad right
await tapButton(15);
const slid = await page.evaluate(() => ({
  to: window.__SANDS__.input.pad.sensitivity,
  shown: document.querySelector('[data-setting="padsens"] .set-value').textContent,
}));
check(slid.to > walked.from,
  'AND THE PAD MOVES IT - two presses of D-pad right raise the live setting',
  `${walked.from.toFixed(2)} -> ${slid.to.toFixed(2)}, panel shows ${slid.shown}`);

await tapButton(14);                                  // D-pad left
await tapButton(14);
const slidBack = await page.evaluate(() => window.__SANDS__.input.pad.sensitivity);
check(near(slidBack, walked.from, 1e-9), 'and left puts it back',
  `${slidBack.toFixed(2)}`);

// --- a toggle flips ---------------------------------------------------------

const toToggle = await page.evaluate(() => {
  const g = window.__SANDS__;
  for (let i = 0; i < 20; i++) {
    if (g.pause.padCursor.id === 'padinvert') break;
    g.pause.padMenu('down');
  }
  return { landed: g.pause.padCursor.id, from: g.input.pad.invertY };
});
await tapButton(0);                                   // Cross
const flipped = await page.evaluate(() => window.__SANDS__.input.pad.invertY);
await tapButton(0);
const flippedBack = await page.evaluate(() => window.__SANDS__.input.pad.invertY);

check(toToggle.landed === 'padinvert' && flipped !== toToggle.from,
  'CROSS FLIPS A TOGGLE, from the pad', `${toToggle.from} -> ${flipped}`);
check(flippedBack === toToggle.from, 'and flips it back');

// --- the panel says which pad it found ---------------------------------------

const infoRow = await page.evaluate(() => {
  window.__SANDS__.pause.show('game');
  window.__SANDS__.pause.refresh();
  const w = document.querySelector('[data-setting="padinfo"]');
  return w ? {
    value: w.querySelector('.set-value').textContent,
    note: w.querySelector('.set-note').textContent,
  } : null;
});
check(!!infoRow && /Wireless Controller/.test(infoRow.value),
  'THE PANEL NAMES THE PAD IT IS READING', infoRow ? infoRow.value : 'missing');
check(!!infoRow && /Slot 2/.test(infoRow.note) && /standard/.test(infoRow.note),
  'and says which slot and which mapping, which is the only way to debug a dead pad',
  infoRow ? infoRow.note : 'missing');

// --- the controls tab documents the pad -------------------------------------

const padRows = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#pause [data-panel="controls"] .bind-row')];
  return rows.map((r) => ({
    keys: [...r.querySelectorAll('.key-cap')].map((k) => k.textContent.trim()),
    what: r.querySelector('.bind-what').textContent,
  }));
});
// R3, not L3. Sprint moved to the right stick at the owner's request, and this
// assertion caught the controls page still saying L3 - which is exactly what a
// documentation check is for. A controls panel that disagrees with the bindings
// is worse than no controls panel, because the player trusts it and then blames
// their own hands.
//
// SEVERAL KEYS NOW CARRY MORE THAN ONE ROW - Square is contextual, L3 is both
// crouch and slide, the khopesh has two buttons - so this searches every row
// bearing the key rather than the first one. `find` would have reported the
// slide undocumented purely because crouch is listed above it.
for (const [key, word] of [
  ['R2', 'Fire'], ['L2', 'Aim'], ['R1', 'cook'],
  ['Options', 'Pause'], ['R3', 'Sprint'], ['Right stick', 'Look'],

  // The five rows tonight's rebind put on the page. Square is asserted twice
  // because a controls page that states only half of a contextual binding is
  // worse than one that states neither: the player trusts it, presses it in
  // front of a wall buy, and blames their own hands.
  ['Square', 'Interact'], ['Square', 'Reload'],
  ['Circle', 'Khopesh'],
  ['L3', 'Crouch'], ['L3', 'Slide'],
]) {
  const rows = padRows.filter((b) => b.keys.includes(key));
  check(rows.some((r) => r.what.includes(word)), `controls: ${key} is documented as ${word}`,
    rows.map((r) => r.what).join(' | ') || 'no row with that key');
}

// AND THE SUPERSEDED CLAIM IS GONE, not merely outnumbered. Circle documented
// as the interact is the exact line this rebind invalidated, and a page that
// still carries it is the failure this whole section exists to catch.
check(!padRows.some((b) => b.keys.includes('Circle') && /Buy, open/.test(b.what)),
  'controls: the page no longer says Circle interacts',
  padRows.filter((b) => b.keys.includes('Circle')).map((r) => r.what).join(' | '));

// --- and CONFIRM ON RESUME GETS THE PLAYER OUT ------------------------------

await page.evaluate(() => {
  const g = window.__SANDS__;
  // Bounded. padMenu refuses everything when the panel is not up, so an
  // unbounded walk would spin the page forever on the one failure mode this
  // section exists to catch.
  for (let i = 0; i < 16 && g.pause.padCursor.id !== 'resume'; i++) g.pause.padMenu('down');
  return g.pause.padCursor.id;
});

await tapButton(0);                                   // Cross, on Resume
const escaped = await page.evaluate(() => ({
  paused: window.__SANDS__.pause.paused,
  hidden: document.getElementById('pause').hidden,
  suspended: window.__SANDS__.input.state.suspended,
  focused: document.activeElement ? document.activeElement.tagName : 'none',
}));

check(escaped.paused === false && escaped.hidden === true,
  'CROSS ON RESUME STARTS THE GAME AGAIN - the pad is not a one-way door into the menu',
  `paused ${escaped.paused}`);
check(escaped.suspended === false, 'and the input layer is unfrozen with it');
check(escaped.focused !== 'INPUT' && escaped.focused !== 'BUTTON',
  'and nothing on the panel is left holding focus, which would eat the jump key',
  `focus on ${escaped.focused}`);

// --- Circle also resumes, which is the console convention -------------------

await tapButton(9);                                   // Options, back in
await tapButton(1);                                   // Circle
const backOut = await page.evaluate(() => window.__SANDS__.pause.paused);
check(backOut === false, 'and Circle backs out of the menu too', `paused ${backOut}`);

// --- the look does not leak out of a pause ----------------------------------

const leaked = await page.evaluate(async () => {
  const g = window.__SANDS__;
  window.__PAD__.idle();
  window.__G__.aim();
  g.pause.open();
  window.__PAD__.ax(2, 1);                    // full stick, while paused
  await window.__G__.frames(10);
  const during = g.rig.yaw;
  window.__PAD__.ax(2, 0);
  g.pause.resume();
  await window.__G__.frames(3);
  return { during, after: g.rig.yaw };
});
check(leaked.during === 0 && leaked.after === 0,
  'A STICK HELD OVER WHILE PAUSED DOES NOT TURN THE CAMERA, then or on resume',
  `during ${leaked.during}, after ${leaked.after}`);

// ---------------------------------------------------------------------------
// 5. RUMBLE
// ---------------------------------------------------------------------------

notes.push('\n--- rumble ---');

const buzz = await page.evaluate(() => {
  window.__PAD__.effects.length = 0;
  const ok = window.__SANDS__.input.pad.rumble(0.8, 0.4, 150);
  return { ok, effects: window.__PAD__.effects.slice() };
});
check(buzz.ok === true && buzz.effects.length === 1,
  'rumble reaches the pad actuator', `${buzz.effects.length} effect(s)`);
check(buzz.effects[0] && buzz.effects[0].type === 'dual-rumble'
  && buzz.effects[0].params.strongMagnitude === 0.8,
  'and it asks for the effect it was told to',
  buzz.effects[0] ? JSON.stringify(buzz.effects[0].params) : 'none');

const muted = await page.evaluate(() => {
  const g = window.__SANDS__;
  g.input.pad.setRumble(false);
  window.__PAD__.effects.length = 0;
  const ok = g.input.pad.rumble(0.8, 0.4, 150);
  const n = window.__PAD__.effects.length;
  g.input.pad.setRumble(true);
  return { ok, n };
});
check(muted.ok === false && muted.n === 0, 'and the setting genuinely switches it off');

// ---------------------------------------------------------------------------
// 6. THE PAD THAT CHROME DID NOT MAP
// ---------------------------------------------------------------------------
//
// The standard mapping is what Chrome is documented to give a DualShock 4 and is
// very probably what it gives. It is not ASSUMED, because Gamepad.mapping exists
// precisely so the browser can say it did not manage it - and a raw pad read
// through standard indices would put reload on the aim trigger, the D-pad
// nowhere, and the analog triggers flat at zero.

notes.push('\n--- the unmapped pad ---');

await stage();
await page.evaluate(() => window.__PAD__.unplug());
await page.evaluate(() => window.__G__.frames(2));
await page.evaluate(() => window.__PAD__.plug('raw', 1));
await page.evaluate(() => window.__G__.frames(2));

const rawInfo = await page.evaluate(() => window.__SANDS__.input.pad.info());
check(rawInfo.connected && rawInfo.index === 1,
  'the unmapped pad is found, in a different slot again', `index ${rawInfo.index}`);
check(rawInfo.profile === 'ds4-raw',
  'AND IT IS READ THROUGH THE RAW LAYOUT rather than through the standard one',
  `mapping "${rawInfo.mapping}" -> ${rawInfo.profileName}`);

// The trigger is an AXIS on this pad, resting at -1. Read as buttons[7].value it
// would be flat zero and the gun would never fire.
await page.evaluate(() => window.__PAD__.ax(4, 0.4));      // -> 0.70 once rescaled
await page.evaluate(() => window.__G__.frames(2));
const rawTrigger = await page.evaluate(() => ({
  analog: window.__SANDS__.input.pad.snapshot.analog.r2,
  fire: window.__SANDS__.input.state.fire,
}));
await page.evaluate(() => window.__PAD__.ax(4, -1));
await page.evaluate(() => window.__G__.frames(2));

check(near(rawTrigger.analog, 0.7, 1e-9) && rawTrigger.fire === true,
  'THE ANALOG TRIGGER IS READ OFF ITS AXIS on an unmapped pad',
  `axis 0.4 rescaled to ${rawTrigger.analog}`);

// The face buttons are in physical order here: index 1 is Cross, not Circle.
await page.evaluate(() => window.__PAD__.btn(1, true));
await page.evaluate(() => window.__G__.frames(2));
const rawJump = await page.evaluate(() => window.__SANDS__.input.state.jump);
await page.evaluate(() => window.__PAD__.btn(1, false));
await page.evaluate(() => window.__G__.frames(2));

check(rawJump === true,
  'and the face buttons are read in their physical order - index 1 is Cross here',
  `jump ${rawJump}`);

// The D-pad is a hat on axis 9.
await page.evaluate(() => window.__PAD__.ax(9, -1));
await page.evaluate(() => window.__G__.frames(2));
const hatUp = await page.evaluate(() => window.__SANDS__.input.pad.snapshot.buttons.up);
await page.evaluate(() => window.__PAD__.ax(9, 0.143));
await page.evaluate(() => window.__G__.frames(2));
const hatDown = await page.evaluate(() => window.__SANDS__.input.pad.snapshot.buttons.down);
await page.evaluate(() => window.__PAD__.ax(9, 1.286));
await page.evaluate(() => window.__G__.frames(2));
const hatCentre = await page.evaluate(() => {
  const b = window.__SANDS__.input.pad.snapshot.buttons;
  return b.up || b.down || b.left || b.right;
});

check(hatUp === true && hatDown === true && hatCentre === false,
  'and the D-pad is decoded from the hat switch on axis 9',
  `up ${hatUp} down ${hatDown} centred-quiet ${!hatCentre}`);

// And the right stick's vertical is axis 5, not axis 3.
await page.evaluate(() => { window.__PAD__.idle(); });
await page.evaluate(() => window.__PAD__.ax(5, 1));
const rawPitch = await page.evaluate(() => window.__G__.live(12));
await page.evaluate(() => window.__PAD__.ax(5, 0));

check(rawPitch.pitch < 0 && rawPitch.yaw === 0,
  'and the right stick is found on axis 5 rather than axis 3',
  `pitch ${rawPitch.pitch.toFixed(6)} rad, yaw ${rawPitch.yaw}`);

// --- unplugging -------------------------------------------------------------

await page.evaluate(() => window.__PAD__.ax(4, 1));        // the raw pad's trigger
await page.evaluate(() => window.__G__.frames(2));
const heldBefore = await page.evaluate(() => window.__SANDS__.input.state.fire);
await page.evaluate(() => window.__PAD__.unplug());
await page.evaluate(() => window.__G__.frames(2));
const heldAfter = await page.evaluate(() => ({
  fire: window.__SANDS__.input.state.fire,
  connected: window.__SANDS__.input.pad.info().connected,
}));

check(heldBefore === true && heldAfter.fire === false && heldAfter.connected === false,
  'UNPLUGGING A PAD MID-HOLD DOES NOT LEAVE THE TRIGGER DOWN FOREVER',
  `firing ${heldBefore} -> ${heldAfter.fire}`);

// --- and the keyboard still works -------------------------------------------

const keyboardStill = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
  const fwd = g.input.state.forward;
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
  return { fwd, after: g.input.state.forward };
});
check(keyboardStill.fwd === 1 && keyboardStill.after === 0,
  'AND W STILL WALKS with the whole pad layer in the file',
  `${keyboardStill.fwd} -> ${keyboardStill.after}`);

check(logs.length === 0, 'no console errors', logs.slice(0, 4).join(' | '));

await browser.close();

// ---------------------------------------------------------------------------

console.log('\nGAMEPAD\n');
for (const n of notes) console.log(n);

console.log('\nTHE NUMBERS');
console.log(`  deadzone   ${PAD_DEFAULTS.deadzone}  radial, rescaled from the edge`);
console.log(`  curve      ${PAD_DEFAULTS.exponent}  half a stick gives ${(Math.pow(0.5, PAD_DEFAULTS.exponent) * 100).toFixed(0)}% of full speed`);
console.log(`  yaw        ${PAD_DEFAULTS.yawRate} rad/s  ${(PAD_DEFAULTS.yawRate * 180 / Math.PI).toFixed(1)} deg/s at full tilt`);
console.log(`  pitch      ${PAD_DEFAULTS.pitchRate} rad/s  ${(PAD_DEFAULTS.pitchRate * 180 / Math.PI).toFixed(1)} deg/s at full tilt`);
console.log(`  fire       arms ${TRIGGER.fireOn}, disarms ${TRIGGER.fireOff}`);
console.log(`  aim        arms ${TRIGGER.adsOn}, disarms ${TRIGGER.adsOff}`);
console.log(`  menu       ${MENU.delay}s to the first repeat, then ${MENU.repeat}s`);

console.log('\nTHE LOOP');
console.log(`  ${pacing.frames} frames advanced the simulated clock by ${pacing.sim.toFixed(4)}s`);
console.log(`  mean ${(pacing.sim / pacing.frames * 1000).toFixed(3)}ms per frame, which is the MAX_DELTA clamp`);
console.log('  the loop\'s delta cannot be varied here, which is why the pacing test injects it');

if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S)`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\nall ${notes.filter((n) => n.startsWith('  ok')).length} checks passed`);
