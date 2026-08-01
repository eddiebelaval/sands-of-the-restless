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
 * ON THE ONE LINE THIS SUITE HAS TO SUPPLY ITSELF. src/main.js is owned by
 * another lane and the poll call belongs in its frame loop, so the browser
 * section calls input.pollPad(rig, dt) from the harness's own animation frame -
 * which is the same call, at the same point in the frame, and is exactly the
 * patch handed over with this work. Everything downstream of it is the real
 * game: the loop drains input.consumeLook() and hands it to rig.look() without
 * knowing where the counts came from.
 *
 * WHAT THIS CANNOT TEST. There is no DualShock 4 attached to the machine this
 * ran on. Every layout claim below is made against a synthetic pad shaped like
 * one, in BOTH the standard mapping and the raw HID layout, which proves the
 * code handles either - and proves nothing about which one Chrome actually
 * hands over for that hardware. The FEEL of the curve, the rates and the
 * deadzone is likewise unverified and unverifiable from here.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS } from './chrome.mjs';
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

/**
 * WHICH TREE IS BEING TESTED, and it is checked rather than trusted.
 *
 * A stale http.server has silently made agents test the wrong tree twice on
 * this project. The bytes the server hands out for the three files this work
 * touches are hashed and compared against the bytes on disk before a single
 * assertion is made, so "the suite was green" cannot mean "the suite was green
 * against something else".
 */
const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
console.log(`testing ${BASE}`);

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const origin = new URL(BASE).origin;
for (const rel of ['src/core/gamepad.js', 'src/core/input.js', 'src/ui/pause.js']) {
  const disk = sha(readFileSync(new URL(`../${rel}`, import.meta.url)));
  let served = 'unreachable';
  try {
    const res = await fetch(`${origin}/${rel}`);
    served = sha(Buffer.from(await res.arrayBuffer()));
  } catch (e) {
    served = `error: ${e.message}`;
  }
  check(served === disk, `SERVED BYTES MATCH DISK: ${rel}`,
    served === disk ? disk.slice(0, 16) : `disk ${disk.slice(0, 16)} vs served ${String(served).slice(0, 16)}`);
}

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--autoplay-policy=no-user-gesture-required'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

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
 * The pad is deliberately placed in SLOT 2 with nulls either side. See the note
 * at the top of this file: reading slot 0 is the failure mode.
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
await page.waitForTimeout(1400);

/**
 * A CLEAN FIELD, and the first run of this suite is why it is here.
 *
 * Every assertion below the halfway mark failed, in a way that read as the pad
 * having gone dead: no movement, no trigger, no reload, and a stick that turned
 * the camera for the first thirty frames of a run and then stopped. The cause
 * was not the pad. The suite takes several minutes of simulated time under
 * software rendering and the wave director had sent a wave in the middle of it;
 * the player was standing in the courtyard doing nothing and was killed, which
 * halts the run and SUSPENDS THE INPUT LAYER - so the pad correctly went into
 * menu mode and correctly stopped driving a game that was no longer running.
 *
 * Worth writing down because the failure was indistinguishable from the feature
 * being broken, and because the fix is the same one test/settings.mjs already
 * carries for the same reason: make the player invulnerable and hold the next
 * wave off. The wave hold is re-applied between sections rather than once,
 * since the director re-arms its own breather.
 */
const stage = () => page.evaluate(() => {
  const g = window.__SANDS__;
  g.combat.state.invulnerable = true;
  g.director.reset();
  g.director.state.timer = 9999;
  g.player.heal(g.player.state.maxHealth);
  return { live: g.director.live.length, halted: g.death.halted };
});

await stage();

/**
 * The harness's half of the frame loop.
 *
 * `run` is the exact call src/main.js's patch makes, driven from the harness's
 * own animation frame because that file belongs to another lane this week.
 * Everything after it is the real game: the loop drains consumeLook() and hands
 * the counts to rig.look() with no idea a controller exists.
 */
await page.addScriptTag({
  content: `
window.__G__ = {
  /** Poll the pad n times at a fixed delta, letting the loop run in between. */
  async run(n, dt) {
    const g = window.__SANDS__;
    for (let i = 0; i < n; i++) {
      g.input.pollPad(g.rig, dt);
      await new Promise((r) => requestAnimationFrame(r));
    }
    // Three more frames with no poll, so anything still sitting in the
    // accumulator has been drained by the loop before it is measured.
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    return g.rig.yaw;
  },

  /** One poll, no frame. For button edges, where the frame does not matter. */
  tick(dt) {
    const g = window.__SANDS__;
    return g.input.pollPad(g.rig, dt === undefined ? 1 / 60 : dt);
  },

  async frames(n) {
    const g = window.__SANDS__;
    const target = g.frameNo + n;
    for (let i = 0; i < n * 40 + 400; i++) {
      if (g.frameNo >= target) return g.frameNo;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return g.frameNo;
  },

  aim() {
    const g = window.__SANDS__;
    g.rig.reset(0, 0);
    g.rig.update(1 / 60, g.player, false);
    return { yaw: g.rig.yaw, pitch: g.rig.pitch };
  },

  look() {
    const g = window.__SANDS__;
    return { yaw: g.rig.yaw, pitch: g.rig.pitch };
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
await page.evaluate(() => window.__G__.tick());
const found = await page.evaluate(() => window.__SANDS__.input.pad.info());

check(found.connected === true, 'a plugged pad is found');
check(found.index === 2,
  'AND IT IS FOUND IN SLOT 2 - every slot is scanned, index 0 is not assumed',
  `index ${found.index}`);
check(found.mapping === 'standard' && found.profile === 'standard',
  'the browser reported the standard mapping and it is read as standard',
  `mapping "${found.mapping}" profile ${found.profile}`);
check(found.assumed === false, 'and the layout was not guessed');
check(found.vibration === true, 'the pad reports a vibration actuator');

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
// It also stabilises everything below. Losing the lock is what main.js opens
// the pause menu on, so this is the last time that can happen.

notes.push('\n--- pointer lock ---');

const unlocked = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const canvas = document.getElementById('stage');
  const had = !!document.pointerLockElement;

  canvas.requestPointerLock = () => {};
  if (document.pointerLockElement) document.exitPointerLock();
  await window.__G__.frames(4);

  // The lock loss opens the menu. Close it the way a player would.
  if (g.pause.paused) g.pause.resume();
  await window.__G__.frames(4);

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

// --- look is a rate, measured through the real camera -----------------------

notes.push('\n--- look ---');

/**
 * What the maths says the game should do, computed here rather than read out of
 * the page. A test that asked the implementation what it expected would pass on
 * any implementation.
 */
const predict = (x, y, frames, dt, o = {}) => {
  const d = lookDelta(x, y, dt, o);
  return { yaw: -d.dxRad * frames, pitch: -d.dyRad * frames };
};

await page.evaluate(() => { window.__PAD__.idle(); window.__G__.aim(); });
await page.evaluate(() => window.__PAD__.ax(2, 0.5));       // right stick, half right
const yawAfter = await page.evaluate(() => window.__G__.run(60, 1 / 60));
const wantHalf = predict(0.5, 0, 60, 1 / 60);

check(near(yawAfter, wantHalf.yaw, 1e-6),
  'HALF A STICK FOR 60 FRAMES TURNS THE CAMERA BY EXACTLY THE PREDICTED ANGLE',
  `predicted ${wantHalf.yaw.toFixed(9)} rad, measured ${yawAfter.toFixed(9)} rad`);
check(yawAfter < 0, 'pushing the stick right turns right', `yaw ${yawAfter.toFixed(6)}`);

// --- frame rate independence, IN THE GAME -----------------------------------

await page.evaluate(() => { window.__G__.aim(); });
const oneSecAt16 = await page.evaluate(() => window.__G__.run(62, 0.016));
await page.evaluate(() => { window.__G__.aim(); });
const oneSecAt33 = await page.evaluate(() => window.__G__.run(30, 0.033));

// 62 frames of 16ms is 0.992s and 30 of 33ms is 0.990s, so the two are compared
// as a RATE rather than as a total. The residual is the 2ms of simulated time
// between them and nothing else.
const rate16 = oneSecAt16 / (62 * 0.016);
const rate33 = oneSecAt33 / (30 * 0.033);

check(near(rate16, rate33, 1e-6),
  'THE SAME STICK TURNS AT THE SAME RATE AT 16MS AND 33MS FRAMES',
  `${rate16.toFixed(9)} rad/s against ${rate33.toFixed(9)} rad/s,`
  + ` difference ${(Math.abs(rate16 - rate33) * 180 / Math.PI).toExponential(3)} deg/s`);
check(near(Math.abs(rate16), 0.186467 * PAD_DEFAULTS.yawRate, 1e-4),
  'and it is the rate the curve and the turn speed predict for half a stick',
  `${(Math.abs(rate16) * 180 / Math.PI).toFixed(4)} deg/s`);

// --- the deadzone, in the game ----------------------------------------------

await page.evaluate(() => { window.__PAD__.idle(); window.__G__.aim(); });
await page.evaluate(() => window.__PAD__.ax(2, 0.05));
const drifted = await page.evaluate(() => window.__G__.run(60, 1 / 60));
check(drifted === 0,
  'a stick resting inside the deadzone moves the camera by EXACTLY nothing over 60 frames',
  `yaw ${drifted}`);

// --- diagonals do not snap, measured on the camera --------------------------

await page.evaluate(() => { window.__PAD__.idle(); window.__G__.aim(); });
await page.evaluate(() => { window.__PAD__.ax(2, 0.5); window.__PAD__.ax(3, 0.5); });
await page.evaluate(() => window.__G__.run(60, 1 / 60));
const diag = await page.evaluate(() => window.__G__.look());
const wantDiag = predict(0.5, 0.5, 60, 1 / 60);

check(near(diag.yaw, wantDiag.yaw, 1e-6) && near(diag.pitch, wantDiag.pitch, 1e-6),
  'a diagonal push moves both axes by their predicted amounts',
  `yaw ${diag.yaw.toFixed(6)}/${wantDiag.yaw.toFixed(6)}`
  + ` pitch ${diag.pitch.toFixed(6)}/${wantDiag.pitch.toFixed(6)}`);
check(near(diag.yaw / diag.pitch, PAD_DEFAULTS.yawRate / PAD_DEFAULTS.pitchRate, 1e-6),
  'and the ratio between them is the ratio of the two turn rates, not 1 and not infinity',
  `${(diag.yaw / diag.pitch).toFixed(6)}`);

// --- the mouse slider does not move the stick -------------------------------

await page.evaluate(() => { window.__PAD__.idle(); window.__G__.aim(); });
await page.evaluate(() => window.__PAD__.ax(2, 1));
const padAtSens1 = await page.evaluate(() => window.__G__.run(30, 1 / 60));
await page.evaluate(() => window.__SANDS__.rig.setSensitivityScale(3.0));
await page.evaluate(() => { window.__G__.aim(); });
const padAtSens3 = await page.evaluate(() => window.__G__.run(30, 1 / 60));
await page.evaluate(() => window.__SANDS__.rig.setSensitivityScale(1.0));

check(near(padAtSens1, padAtSens3, 1e-9),
  'THE MOUSE SENSITIVITY SLIDER DOES NOT CHANGE THE STICK - two sliders on one'
  + ' panel must not multiply each other',
  `${padAtSens1.toFixed(9)} at 1.00x, ${padAtSens3.toFixed(9)} at 3.00x`);

// --- both devices at once ---------------------------------------------------

await page.evaluate(() => { window.__PAD__.idle(); window.__G__.aim(); });
await page.evaluate(() => window.__PAD__.ax(2, 1));
const both = await page.evaluate(async () => {
  const g = window.__SANDS__;
  // A mouse delta pushed onto the same accumulator a real mousemove writes to,
  // in the same frames the stick is being polled.
  for (let i = 0; i < 30; i++) {
    g.input.pollPad(g.rig, 1 / 60);
    g.input.state.dx += 4;
    await new Promise((r) => requestAnimationFrame(r));
  }
  for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
  return g.rig.yaw;
});

const padOnly = predict(1, 0, 30, 1 / 60).yaw;
const mouseOnly = await page.evaluate(async () => {
  const g = window.__SANDS__;
  window.__PAD__.idle();
  window.__G__.aim();
  for (let i = 0; i < 30; i++) {
    g.input.state.dx += 4;
    await new Promise((r) => requestAnimationFrame(r));
  }
  for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
  return g.rig.yaw;
});

check(near(both, padOnly + mouseOnly, 1e-6),
  'A MOUSE AND A STICK MOVING TOGETHER SUM - neither device wins and neither is dropped',
  `pad ${padOnly.toFixed(6)} + mouse ${mouseOnly.toFixed(6)} = ${(padOnly + mouseOnly).toFixed(6)},`
  + ` measured ${both.toFixed(6)}`);

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

await stage();

/** Press, poll, release, poll. One clean edge. */
const tapButton = async (i) => {
  await page.evaluate((n) => { window.__PAD__.btn(n, true); window.__G__.tick(); }, i);
  await page.evaluate(() => window.__G__.frames(2));
  await page.evaluate((n) => { window.__PAD__.btn(n, false); window.__G__.tick(); }, i);
  await page.evaluate(() => window.__G__.frames(2));
};

await page.evaluate(() => { window.__PAD__.idle(); window.__G__.tick(); });

// --- the analog trigger -----------------------------------------------------

const trig = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const out = {};
  // Under the arm point. A digital reading of buttons[7].pressed would already
  // be true here, which is the difference the analog value buys.
  window.__PAD__.val(7, 0.45);
  window.__G__.tick();
  out.at45 = { fire: g.input.state.fire, analog: g.input.pad.snapshot.analog.r2 };

  window.__PAD__.val(7, 0.60);
  window.__G__.tick();
  out.at60 = { fire: g.input.state.fire, analog: g.input.pad.snapshot.analog.r2 };

  // Back off to between the two thresholds. Hysteresis says it stays armed.
  window.__PAD__.val(7, 0.45);
  window.__G__.tick();
  out.back45 = { fire: g.input.state.fire };

  window.__PAD__.val(7, 0.30);
  window.__G__.tick();
  out.back30 = { fire: g.input.state.fire };

  window.__PAD__.val(7, 0);
  window.__G__.tick();
  return out;
});

check(trig.at45.fire === false,
  'R2 AT 0.45 IS NOT FIRING - the trigger is read as an analog pull, not a switch',
  `analog ${trig.at45.analog}, pressed would already be true`);
check(trig.at60.fire === true, 'R2 past the arm point fires', `analog ${trig.at60.analog}`);
check(trig.back45.fire === true,
  'and it STAYS armed between the two thresholds, so a resting spring cannot chatter');
check(trig.back30.fire === false, 'below the disarm point it stops');

// The aim trigger arms earlier than the fire trigger, on purpose.
const adsTrig = await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__PAD__.val(6, 0.35);
  window.__G__.tick();
  const on = g.input.state.ads;
  window.__PAD__.val(6, 0);
  window.__G__.tick();
  return { on, off: g.input.state.ads };
});
check(adsTrig.on === true && adsTrig.off === false,
  'L2 brings the sight up, and it arms earlier in the pull than the trigger does',
  `arm at ${TRIGGER.adsOn} against ${TRIGGER.fireOn}`);

// --- reload, through the weapon system --------------------------------------

/**
 * SPEND A ROUND, THEN RELOAD, and the first half is not scene-setting.
 *
 * The first run of this suite emptied the magazine by writing
 * `weapons.state.magazine = 1`. That field does not exist - the ammunition
 * lives in a map private to the weapon system - so the magazine stayed full,
 * reload() correctly refused, and the check reported a broken binding when the
 * binding was fine and the TEST was wrong. Firing the gun through the pad's own
 * trigger is both the honest way to empty it and a second assertion: the
 * analog trigger is not merely setting a flag, it is putting rounds downrange.
 */
const reloaded = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const full = g.weapons.STATS[g.weapons.state.current].magazine;

  window.__PAD__.val(7, 1);                       // R2, fully pulled
  for (let i = 0; i < 8; i++) { window.__G__.tick(); await raf(); }
  window.__PAD__.val(7, 0);
  window.__G__.tick();
  await raf();
  const spent = g.weapons.magazine;

  window.__PAD__.btn(2, true);                    // Square
  window.__G__.tick();
  await raf();
  const mid = g.weapons.isReloading;
  window.__PAD__.btn(2, false);
  window.__G__.tick();
  return { full, spent, mid };
});
check(reloaded.spent < reloaded.full,
  'R2 PUTS ROUNDS DOWNRANGE - the magazine went down',
  `${reloaded.full} -> ${reloaded.spent}`);
check(reloaded.mid === true,
  'SQUARE RELOADS - asserted on the weapon system, which core/input.js cannot reach',
  `isReloading ${reloaded.mid}`);

await page.evaluate(() => window.__G__.frames(120));

// --- melee, through the melee system ----------------------------------------

const swung = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const before = g.viewmodel.state.phase;
  window.__PAD__.btn(4, true);      // L1
  window.__G__.tick();
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  const during = g.viewmodel.state.phase;
  window.__PAD__.btn(4, false);
  window.__G__.tick();
  return { before, during };
});
check(swung.during === 'melee' || swung.during !== swung.before,
  'L1 SWINGS THE KHOPESH - asserted on the viewmodel state machine',
  `${swung.before} -> ${swung.during}`);

await page.evaluate(() => window.__G__.frames(90));

// --- weapon swap, through the wheel binding ---------------------------------

const swapped = await page.evaluate(async () => {
  const g = window.__SANDS__;
  // A second weapon, or there is nowhere to cycle TO and the check would pass
  // on a Triangle that did nothing at all.
  g.weapons.grant('b3ar');
  g.weapons.equip('mk9');
  await new Promise((r) => requestAnimationFrame(r));
  const before = g.weapons.state.current;
  window.__PAD__.btn(3, true);      // Triangle
  window.__G__.tick();
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  const after = g.weapons.state.current;
  window.__PAD__.btn(3, false);
  window.__G__.tick();
  g.weapons.equip('mk9');
  return { before, after };
});
check(swapped.after !== swapped.before,
  'TRIANGLE SWAPS THE WEAPON - through the same wheel binding the mouse uses',
  `${swapped.before} -> ${swapped.after}`);

// --- the grenade is HELD, not tapped ----------------------------------------

const fuse = await page.evaluate(async () => {
  const g = window.__SANDS__;
  window.__PAD__.btn(5, true);      // R1
  window.__G__.tick();
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  const cooking = g.grenades.state.cooking;
  const cook = g.grenades.cook;
  window.__PAD__.btn(5, false);
  window.__G__.tick();
  await new Promise((r) => requestAnimationFrame(r));
  return { cooking, cook, thrownAfter: g.grenades.state.cooking };
});
check(fuse.cooking === true && fuse.cook > 0,
  'R1 HELD COOKS THE GRENADE - the fuse runs while the button is down',
  `cook ${fuse.cook.toFixed(3)}s`);
check(fuse.thrownAfter === false, 'and releasing it throws');

await page.evaluate(() => window.__G__.frames(150));
await stage();

// --- movement ---------------------------------------------------------------

const moved = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const from = { x: g.player.position.x, z: g.player.position.z };
  window.__PAD__.ax(1, -1);                     // left stick forward
  for (let i = 0; i < 30; i++) {
    g.input.pollPad(g.rig, 1 / 60);
    await new Promise((r) => requestAnimationFrame(r));
  }
  const walked = Math.hypot(g.player.position.x - from.x, g.player.position.z - from.z);
  const fwd = g.input.state.forward;

  // Both devices asking for opposite things must cancel rather than fight.
  g.input.state.forward = -1;                   // as the keyboard's S would
  const summed = g.input.state.forward;
  g.input.state.forward = 0;

  window.__PAD__.ax(1, 0);
  g.input.pollPad(g.rig, 1 / 60);
  return { walked, fwd, summed, after: g.input.state.forward };
});

check(moved.walked > 0.5, 'THE LEFT STICK WALKS THE PLAYER', `${moved.walked.toFixed(3)} m in 30 frames`);
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
await page.evaluate(() => { window.__PAD__.idle(); window.__G__.tick(); });

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

// --- a slider actually moves -------------------------------------------------

const slid = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.pause.show('game');
  // Walk down to the stick sensitivity row, which is the fifth control on the
  // Game tab, by pressing down from Resume until the cursor names it. Bounded,
  // and the bound is well past the row count so a cursor that stopped moving
  // fails the check below rather than spinning the page.
  for (let i = 0; i < 20; i++) {
    if (g.pause.padCursor.id === 'padsens') break;
    g.pause.padMenu('down');
  }
  const landed = g.pause.padCursor.id;
  const from = g.input.pad.sensitivity;
  g.pause.padMenu('right');
  g.pause.padMenu('right');
  const to = g.input.pad.sensitivity;
  const shown = document.querySelector('[data-setting="padsens"] .set-value').textContent;
  g.pause.padMenu('left');
  g.pause.padMenu('left');
  return { landed, from, to, shown, back: g.input.pad.sensitivity };
});

check(slid.landed === 'padsens', 'the cursor reaches the stick sensitivity row', slid.landed);
check(slid.to > slid.from,
  'AND THE PAD MOVES IT - two presses right raise the live setting',
  `${slid.from.toFixed(2)} -> ${slid.to.toFixed(2)}, panel shows ${slid.shown}`);
check(near(slid.back, slid.from, 1e-9), 'and left puts it back', `${slid.back.toFixed(2)}`);

// --- a toggle flips ---------------------------------------------------------

const toggled = await page.evaluate(() => {
  const g = window.__SANDS__;
  for (let i = 0; i < 20; i++) {
    if (g.pause.padCursor.id === 'padinvert') break;
    g.pause.padMenu('down');
  }
  const landed = g.pause.padCursor.id;
  const from = g.input.pad.invertY;
  g.pause.padMenu('accept');
  const to = g.input.pad.invertY;
  g.pause.padMenu('accept');
  return { landed, from, to, back: g.input.pad.invertY };
});
check(toggled.landed === 'padinvert' && toggled.from !== toggled.to,
  'CONFIRM FLIPS A TOGGLE', `${toggled.from} -> ${toggled.to}`);
check(toggled.back === toggled.from, 'and flips it back');

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
for (const [key, word] of [
  ['R2', 'Fire'], ['L2', 'Aim'], ['Square', 'Reload'], ['R1', 'cook'],
  ['Options', 'Pause'], ['L3', 'Sprint'], ['Right stick', 'Look'],
]) {
  const row = padRows.find((b) => b.keys.includes(key));
  check(!!row && row.what.includes(word), `controls: ${key} is documented`,
    row ? row.what : 'missing');
}

// --- and CONFIRM ON RESUME GETS THE PLAYER OUT ------------------------------

const escaped = await page.evaluate(async () => {
  const g = window.__SANDS__;
  // Walk to Resume the way a player would, then press Cross through the REAL
  // input layer rather than by calling padMenu.
  // Bounded. padMenu refuses everything when the panel is not up, so an
  // unbounded walk here would spin the page forever on the one failure mode
  // this section exists to catch.
  for (let i = 0; i < 16 && g.pause.padCursor.id !== 'resume'; i++) g.pause.padMenu('down');
  window.__PAD__.btn(0, true);
  g.input.pollPad(g.rig, 1 / 60);
  window.__PAD__.btn(0, false);
  g.input.pollPad(g.rig, 1 / 60);
  await new Promise((r) => requestAnimationFrame(r));
  return {
    paused: g.pause.paused,
    hidden: document.getElementById('pause').hidden,
    suspended: g.input.state.suspended,
    focused: document.activeElement ? document.activeElement.tagName : 'none',
  };
});

check(escaped.paused === false && escaped.hidden === true,
  'CROSS ON RESUME STARTS THE GAME AGAIN - the pad is not a one-way door into the menu',
  `paused ${escaped.paused}`);
check(escaped.suspended === false, 'and the input layer is unfrozen with it');
check(escaped.focused !== 'INPUT' && escaped.focused !== 'BUTTON',
  'and nothing on the panel is left holding focus, which would eat the jump key',
  `focus on ${escaped.focused}`);

// --- Circle also resumes, which is the console convention -------------------

await tapButton(9);
const backOut = await page.evaluate(async () => {
  const g = window.__SANDS__;
  window.__PAD__.btn(1, true);
  g.input.pollPad(g.rig, 1 / 60);
  window.__PAD__.btn(1, false);
  g.input.pollPad(g.rig, 1 / 60);
  await new Promise((r) => requestAnimationFrame(r));
  return g.pause.paused;
});
check(backOut === false, 'and Circle backs out of the menu too', `paused ${backOut}`);

// --- the look does not leak out of a pause ----------------------------------

const leaked = await page.evaluate(async () => {
  const g = window.__SANDS__;
  window.__PAD__.idle();
  window.__G__.aim();
  g.pause.open();
  window.__PAD__.ax(2, 1);                    // full stick, while paused
  for (let i = 0; i < 20; i++) {
    g.input.pollPad(g.rig, 1 / 60);
    await new Promise((r) => requestAnimationFrame(r));
  }
  const during = g.rig.yaw;
  window.__PAD__.ax(2, 0);
  g.pause.resume();
  for (let i = 0; i < 5; i++) await new Promise((r) => requestAnimationFrame(r));
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
// The standard mapping is what Chrome is documented to give a DualShock 4 and
// is very probably what it gives. It is not ASSUMED, because Gamepad.mapping
// exists precisely so that the browser can say it did not manage it - and a raw
// pad read through standard indices would put reload on the aim trigger, the
// D-pad nowhere, and the analog triggers flat at zero.

notes.push('\n--- the unmapped pad ---');

await page.evaluate(() => {
  window.__PAD__.unplug();
  window.__SANDS__.input.pollPad(window.__SANDS__.rig, 1 / 60);
  window.__PAD__.plug('raw', 1);
  window.__SANDS__.input.pollPad(window.__SANDS__.rig, 1 / 60);
});

const rawInfo = await page.evaluate(() => window.__SANDS__.input.pad.info());
check(rawInfo.connected && rawInfo.index === 1,
  'the unmapped pad is found, in a different slot again', `index ${rawInfo.index}`);
check(rawInfo.profile === 'ds4-raw',
  'AND IT IS READ THROUGH THE RAW LAYOUT rather than through the standard one',
  `mapping "${rawInfo.mapping}" -> ${rawInfo.profileName}`);

const rawRead = await page.evaluate(() => {
  const g = window.__SANDS__;
  const out = {};

  // The trigger is an AXIS on this pad, resting at -1. Read as buttons[7].value
  // it would be flat zero and the gun would never fire.
  window.__PAD__.ax(4, 0.4);                 // r2 axis -> 0.70 once rescaled
  g.input.pollPad(g.rig, 1 / 60);
  out.trigger = { analog: g.input.pad.snapshot.analog.r2, fire: g.input.state.fire };
  window.__PAD__.ax(4, -1);
  g.input.pollPad(g.rig, 1 / 60);

  // The face buttons are in physical order here: index 1 is Cross, not Circle.
  window.__PAD__.btn(1, true);
  g.input.pollPad(g.rig, 1 / 60);
  out.jump = g.input.state.jump;
  window.__PAD__.btn(1, false);
  g.input.pollPad(g.rig, 1 / 60);

  // The D-pad is a hat on axis 9. 0.143 is "down".
  window.__PAD__.ax(9, -1);
  g.input.pollPad(g.rig, 1 / 60);
  out.hatUp = g.input.pad.snapshot.buttons.up;
  window.__PAD__.ax(9, 0.143);
  g.input.pollPad(g.rig, 1 / 60);
  out.hatDown = g.input.pad.snapshot.buttons.down;
  window.__PAD__.ax(9, 1.286);
  g.input.pollPad(g.rig, 1 / 60);
  out.hatCentre = g.input.pad.snapshot.buttons.up || g.input.pad.snapshot.buttons.down;

  // And the right stick's vertical is axis 5, not axis 3.
  window.__G__.aim();
  window.__PAD__.ax(5, 1);
  for (let i = 0; i < 10; i++) g.input.pollPad(g.rig, 1 / 60);
  out.pitchCounts = g.input.state.dy;
  g.input.consumeLook();
  window.__PAD__.ax(5, 0);
  g.input.pollPad(g.rig, 1 / 60);
  return out;
});

check(near(rawRead.trigger.analog, 0.7, 1e-9) && rawRead.trigger.fire === true,
  'THE ANALOG TRIGGER IS READ OFF ITS AXIS on an unmapped pad',
  `axis 0.4 rescaled to ${rawRead.trigger.analog}`);
check(rawRead.jump === true,
  'and the face buttons are read in their physical order - index 1 is Cross here',
  `jump ${rawRead.jump}`);
check(rawRead.hatUp === true && rawRead.hatDown === true && rawRead.hatCentre === false,
  'and the D-pad is decoded from the hat switch on axis 9',
  `up ${rawRead.hatUp} down ${rawRead.hatDown} centred-quiet ${!rawRead.hatCentre}`);
check(rawRead.pitchCounts > 0,
  'and the right stick is found on axis 5 rather than axis 3',
  `${rawRead.pitchCounts.toFixed(2)} counts of look`);

// --- unplugging -------------------------------------------------------------

const gone = await page.evaluate(() => {
  const g = window.__SANDS__;
  // The trigger on THIS pad is axis 4, not button 7. Poking button 7 here is
  // exactly the mistake the raw layout exists to prevent, and doing it in the
  // test would have set up a hold that was never held.
  window.__PAD__.ax(4, 1);
  g.input.pollPad(g.rig, 1 / 60);
  const firing = g.input.state.fire;
  window.__PAD__.unplug();
  g.input.pollPad(g.rig, 1 / 60);
  return { firing, after: g.input.state.fire, info: g.input.pad.info().connected };
});
check(gone.firing === true && gone.after === false && gone.info === false,
  'UNPLUGGING A PAD MID-HOLD DOES NOT LEAVE THE TRIGGER DOWN FOREVER',
  `firing ${gone.firing} -> ${gone.after}`);

// --- and the keyboard still works -------------------------------------------

const keyboardStill = await page.evaluate(async () => {
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

if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S)`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\nall ${notes.filter((n) => n.startsWith('  ok')).length} checks passed`);
