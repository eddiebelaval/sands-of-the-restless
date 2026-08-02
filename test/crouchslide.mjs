/**
 * CROUCH, SLIDE, AND THE REBOUND OF THE PAD LAYOUT AROUND THEM.
 *
 * WHAT THIS FILE EXISTS TO CATCH is one specific failure and it is the one this
 * project keeps producing: code that was written and never took effect. For a
 * movement feature the equivalent is a crouch that moves the CAMERA and not the
 * BODY. It looks completely correct - the view goes down, the view comes up, the
 * flag is set - right up until a player ducks under a doorway and is stopped by
 * a wall that is not there, at which point the bug is three weeks old and reads
 * as "the collision feels bad".
 *
 * So nothing here asserts a flag. Every claim is measured off the body:
 *
 *   THE EYE HEIGHT, sampled every frame across the transition, as a trace and
 *   not as a before and after. A before and after cannot tell a 0.16 s ease from
 *   a teleport, and the teleport is the thing that would be wrong.
 *
 *   THE CAMERA, read off the live three.js camera and differenced against the
 *   player's own position, because the camera is where the player's eye actually
 *   is and everything else is a claim about it.
 *
 *   THE COLLISION BODY, proved by walking a real wall record. A bar is injected
 *   into the live `world.walls` array - the same array world/build.js writes and
 *   the same array the resolver reads - low enough to stop a standing body and
 *   high enough to pass a crouched one. Standing into it must stop. Crouched
 *   into it must pass. That is the only assertion in this file that can tell a
 *   real crouch from a camera trick, and it is why the bar is here at all: the
 *   shipped map has no headroom under 4.2 m, so there is nowhere to walk to that
 *   would ask the question.
 *
 *   THE POSITION, traced through a whole slide, so the distance and the
 *   deceleration curve are read off where the body went rather than off the
 *   constants that were supposed to send it there.
 *
 * TWO WAYS OF DRIVING, on purpose.
 *
 *   THROUGH THE PAD, into the running game, for the one thing that has to be
 *   proved end to end: a slide a real player could have started, off a real
 *   button, in the live loop, held under the pause menu. WHICH button does what
 *   is not asserted here at all - test/rebind.mjs owns the action level and
 *   test/gamepad.mjs owns the system level, and a third statement of the layout
 *   is how a controls page comes to disagree with its own bindings.
 *
 *   DIRECTLY INTO THE CONTROLLER, AT A FIXED DELTA, WITH THE GAME PAUSED, for
 *   everything about NUMBERS. A slide is 0.58 s long and the loop under software
 *   rendering runs at the 50 ms MAX_DELTA clamp, which is eleven samples across
 *   the whole arc and no way to tell 0.58 from 0.62. Pausing stops the loop
 *   calling update() at all - that is exactly how the pause works - so the
 *   harness owns the clock and can step 1/120 s at a time. The body being
 *   measured is the shipping one either way.
 *
 * Usage: node test/crouchslide.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS } from './chrome.mjs';

// 4177 is the port `npm start` serves and the port every other suite defaults
// to. This one defaulted to 5317, which nothing in the repo ever serves, so
// `npm test` - which invokes it bare - could only ever fail here on a connection
// refused. A suite that cannot pass in its own runner stops being read, and a
// suite nobody reads is where a real regression goes to hide.
const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

const browser = await chromium.launch({ executablePath: resolveChrome(), args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.setDefaultTimeout(180000);

const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });

// A synthetic pad in slot 2, installed before the game boots. Slot 2 rather
// than 0 for test/gamepad.mjs's documented reason: reading pads[0] is the exact
// shape of code that looks right and reads nothing.
await page.addInitScript(() => {
  const button = () => ({ pressed: false, touched: false, value: 0 });
  const gp = {
    id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
    index: 2, mapping: 'standard', connected: true, timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, button),
    vibrationActuator: { playEffect: () => Promise.resolve('complete') },
  };
  const slots = [null, null, gp, null];

  window.__PAD__ = {
    gp,
    ax(i, v) { gp.axes[i] = v; return v; },
    btn(i, down) { gp.buttons[i].pressed = !!down; gp.buttons[i].value = down ? 1 : 0; return !!down; },
    val(i, v) { gp.buttons[i].value = v; gp.buttons[i].pressed = v > 0.5; return v; },
    idle() {
      for (const b of gp.buttons) { b.pressed = false; b.value = 0; }
      for (let i = 0; i < gp.axes.length; i++) gp.axes[i] = 0;
    },
  };
  navigator.getGamepads = () => slots;
});

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1400);

let pass = 0;
const fails = [];
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail === undefined ? '' : `  (${detail})`}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/**
 * A clean field, re-applied between sections.
 *
 * test/gamepad.mjs learned this the hard way: this suite spends real time, the
 * wave director sends a wave into the middle of it, the player standing still
 * gets killed, the run halts, the input layer suspends, and every assertion
 * after that point fails in a way indistinguishable from the feature being
 * broken.
 */
const stage = () => page.evaluate(() => {
  const g = window.__SANDS__;
  g.combat.state.invulnerable = true;
  g.director.reset();
  g.director.state.timer = 9999;
  g.player.heal(g.player.state.maxHealth);
  g.governor.yieldToPlayer();
  g.setFidelity(false);
  window.__PAD__.idle();
  g.input.state.crouch = false;
  return { live: g.director.live.length, halted: g.death.halted };
});

await page.addScriptTag({ content: `
window.__C__ = {
  /** Let the REAL loop run n frames. */
  async frames(n) {
    const g = window.__SANDS__;
    const target = g.frameNo + n;
    for (let i = 0; i < n * 80 + 800; i++) {
      if (g.frameNo >= target) return g.frameNo;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return g.frameNo;
  },

  /** Every number about the body, read in ONE synchronous turn. */
  body() {
    const g = window.__SANDS__;
    const s = g.player.state;
    return {
      frameNo: g.frameNo,
      elapsed: +g.elapsed.toFixed(4),
      x: +g.player.position.x.toFixed(4),
      y: +g.player.position.y.toFixed(4),
      z: +g.player.position.z.toFixed(4),
      camY: +g.camera.position.y.toFixed(4),
      crouch: +s.crouch.toFixed(4),
      eye: +s.eyeHeight.toFixed(4),
      drop: +s.viewDrop.toFixed(4),
      sliding: s.sliding,
      slideT: +s.slideT.toFixed(4),
      ceilinged: s.ceilinged,
      sprinting: s.sprinting,
      grounded: s.grounded,
      speed: +s.speed.toFixed(4),
      intent: g.input.state.crouch,
    };
  },

  /** A trace of the body, one sample per real frame. */
  async trace(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(this.body());
      await new Promise((r) => requestAnimationFrame(r));
    }
    out.push(this.body());
    return out;
  },

  /**
   * Put the body somewhere and let the teleport SETTLE before measuring.
   *
   * player/controller.js schedules a posture reset on a teleport - somewhere
   * new is entered standing - and that reset is applied on the next update()
   * by clearing the crouch field on whatever intent record it is handed. Two
   * idle steps absorb it, so a sequence that sets crouch afterwards is not
   * silently undone on its own first frame. Missing this reads as the crouch
   * binding being dead, which is exactly the wrong conclusion.
   */
  place(x, z, yaw = 0) {
    const g = window.__SANDS__;
    g.player.teleport({ x, y: 0, z });
    g.rig.reset(yaw, 0);
    this.step(1 / 120, { forward: 0, strafe: 0, sprint: false, jump: false, crouch: false }, 2);
    return { x: g.player.position.x, z: g.player.position.z };
  },

  /**
   * STEP THE BODY BY HAND, at a delta the harness chooses.
   *
   * Only legitimate while the game is PAUSED, because a paused loop does not
   * call player.update() at all and there is therefore nothing to interleave
   * with. The function being stepped is the shipping one; only the clock and
   * the intent record are the harness's.
   */
  step(dt, intent, n = 1) {
    const g = window.__SANDS__;
    const out = [];
    for (let i = 0; i < n; i++) {
      g.player.update(dt, intent, g.rig.yaw);
      const s = g.player.state;
      out.push({
        t: +((i + 1) * dt).toFixed(4),
        x: +g.player.position.x.toFixed(4),
        y: +g.player.position.y.toFixed(4),
        z: +g.player.position.z.toFixed(4),
        speed: +Math.hypot(g.player.velocity.x, g.player.velocity.z).toFixed(4),
        vy: +g.player.velocity.y.toFixed(4),
        grounded: s.grounded,
        crouch: +s.crouch.toFixed(4),
        eye: +s.eyeHeight.toFixed(4),
        sliding: s.sliding,
        slideT: +s.slideT.toFixed(4),
        ceilinged: s.ceilinged,
        intent: intent.crouch,
      });
    }
    return out;
  },
};
` });

await stage();

const notes = [];

// ===========================================================================
// THE BINDINGS ARE NOT TESTED HERE
// ===========================================================================
//
// Which button crouches, which button swings and what Square decides are
// ACTION-level claims about core/input.js, and test/rebind.mjs is the file that
// makes them - it already has the synthetic pad, the two-poll edge discipline
// and the key-event counters that read an action at the seam where it is bound.
// test/gamepad.mjs makes the same claims a second time at SYSTEM level, on
// weapons.js and on the viewmodel, which input cannot reach.
//
// A third copy of that harness here would be a second place for the layout to
// be stated, which is the arrangement that produced a controls page disagreeing
// with the bindings in the first place. What this file owns is the BODY. The
// pad above is installed for exactly one purpose - section 7 needs a slide that
// a real player could have started, in the live loop, off a real button - and
// it is used for nothing else.

// ===========================================================================
// 2. THE KEYBOARD
// ===========================================================================

console.log('\n--- THE KEYBOARD ---');

const keyCrouch = await page.evaluate(() => {
  const g = window.__SANDS__;
  g.input.state.crouch = false;

  const tap = (code) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
    return g.input.state.crouch;
  };

  const afterC = tap('KeyC');
  const afterC2 = tap('KeyC');
  const afterCtrl = tap('ControlLeft');
  const afterCtrl2 = tap('ControlRight');

  // A HELD key must not oscillate the posture. `repeat` is what the browser
  // sends for autorepeat and it is the whole of the defence; a toggle without
  // it flips sixty times a second and reads as the camera vibrating.
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', bubbles: true }));
  const held1 = g.input.state.crouch;
  for (let i = 0; i < 8; i++) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', repeat: true, bubbles: true }));
  }
  const held2 = g.input.state.crouch;
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyC', key: 'c', bubbles: true }));

  g.input.state.crouch = false;
  return { afterC, afterC2, afterCtrl, afterCtrl2, held1, held2 };
});

check(keyCrouch.afterC === true && keyCrouch.afterC2 === false,
  'C CROUCHES AND STANDS - the same toggle the pad has',
  `${keyCrouch.afterC} then ${keyCrouch.afterC2}`);
check(keyCrouch.afterCtrl === true && keyCrouch.afterCtrl2 === false,
  'LeftControl and RightControl are the same binding, so both hands find it',
  `${keyCrouch.afterCtrl} then ${keyCrouch.afterCtrl2}`);
check(keyCrouch.held1 === true && keyCrouch.held2 === true,
  'AND A HELD KEY DOES NOT OSCILLATE - eight autorepeats changed nothing',
  `${keyCrouch.held1} then ${keyCrouch.held2}`);

// ===========================================================================
// 3. THE BODY GOES DOWN, AND SO DOES THE CAMERA
// ===========================================================================

console.log('\n--- THE BODY, TRACED ---');

await stage();

// Somewhere flat and clear. The gallery floor is a plane at y 0, which the
// courtyard's dune field is not, and a slide measured on a slope would be
// measuring the slope.
await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.spaces.enter('interior', { x: 3, z: -164, rot: 0 });
  await new Promise((r) => setTimeout(r, 500));
  g.player.teleport({ x: 3, y: 0, z: -164 });
  g.rig.reset(0, 0);
});
await page.evaluate(() => window.__C__.frames(10));

const standing = await page.evaluate(() => window.__C__.body());
check(near(standing.eye, 1.68, 0.001) && near(standing.crouch, 0, 0.001),
  'a standing body has its eye at the shipped 1.68 and a crouch of 0',
  `eye ${standing.eye}, crouch ${standing.crouch}`);
check(near(standing.camY - (standing.y - standing.eye), 1.68, 0.08),
  'and the CAMERA is at the eye, measured off the live three.js camera',
  `camera ${standing.camY} against feet ${(standing.y - standing.eye).toFixed(3)}`);

// Crouch, and trace every frame of it.
await page.evaluate(() => { window.__SANDS__.input.state.crouch = true; });
const downTrace = await page.evaluate(() => window.__C__.trace(10));
const down = downTrace[downTrace.length - 1];

notes.push('\nEYE HEIGHT GOING DOWN (one sample per frame)');
for (const s of downTrace.slice(0, 8)) {
  notes.push(`  t+${(s.elapsed - downTrace[0].elapsed).toFixed(3)}s  crouch ${s.crouch.toFixed(3)}`
    + `  eye ${s.eye.toFixed(3)}  camera ${s.camY.toFixed(3)}  feet ${(s.y - 1.68).toFixed(3)}`);
}

check(near(down.eye, 0.95, 0.001),
  'CROUCHED, THE EYE IS AT 0.95 - 57% of standing, which is a squat and not a kneel',
  `eye ${down.eye}`);
check(downTrace.some((s) => s.crouch > 0.02 && s.crouch < 0.98),
  'AND IT GOT THERE OVER TIME - at least one frame caught the body mid-move, so it is not a teleport',
  downTrace.map((s) => s.crouch).join(' '));
check(near(down.camY, standing.camY - 0.73, 0.09),
  'THE CAMERA WENT WITH IT, by the 0.73 m the posture says and not by a number of its own',
  `${standing.camY} -> ${down.camY}`);
check(near(down.y, standing.y, 0.02),
  'and player.position.y did NOT move, which is what keeps the horde pathing on the right storey',
  `${standing.y} -> ${down.y}`);

// Stand up again.
await page.evaluate(() => { window.__SANDS__.input.state.crouch = false; });
const upTrace = await page.evaluate(() => window.__C__.trace(12));
const up = upTrace[upTrace.length - 1];
check(near(up.eye, 1.68, 0.001), 'and the body stands all the way back up', `eye ${up.eye}`);
check(upTrace.some((s) => s.crouch > 0.02 && s.crouch < 0.98),
  'over time on the way up too', upTrace.map((s) => s.crouch).join(' '));

// ===========================================================================
// 4. THE COLLISION BODY IS THE ONE THAT SHRANK
// ===========================================================================

console.log('\n--- THE COLLISION BODY ---');

/**
 * A bar across the corridor, pushed into the live wall array.
 *
 * y0 1.20 is under a standing head (1.68 + the resolver's own 0.12 margin) and
 * over a crouched one (0.95 + 0.12). The shipped map has nothing this low - the
 * lowest door head is 4.2 - so without injecting one there is no question to
 * ask, and a crouch that never has to fit under anything is a crouch nobody can
 * prove is real. Removed again at the end of the section.
 */
const barrier = await page.evaluate(() => {
  const g = window.__SANDS__;
  g.pause.open();                     // the harness owns the clock from here
  window.__C__.place(3, -164);        // yaw 0 is forward = -z

  const bar = { x: 3, z: -168, w: 10, d: 0.8, y0: 1.20, y1: 4.0, __harness: true };
  g.world.walls.push(bar);
  return { walls: g.world.walls.length, bar };
});

const INTENT_RUN = { forward: 1, strafe: 0, sprint: false, jump: false, crouch: false, fire: false, ads: false, grenade: false };

// Standing, straight at it.
const standIntoBar = await page.evaluate((intent) => {
  const g = window.__SANDS__;
  window.__C__.place(3, -164);
  const t = window.__C__.step(1 / 120, { ...intent }, 300);
  return { z: t[t.length - 1].z, eye: t[t.length - 1].eye };
}, INTENT_RUN);

check(standIntoBar.z > -168 + 0.4 - 0.42 - 0.15,
  'STANDING, THE BAR STOPS THE BODY - the resolver saw a head above 1.20',
  `stopped at z ${standIntoBar.z}, bar face at ${(-168 + 0.4 + 0.42).toFixed(2)}`);

// Crouched, straight at it, same run.
const crouchThroughBar = await page.evaluate((intent) => {
  const g = window.__SANDS__;
  window.__C__.place(3, -164);
  // Settle the posture first so the run is made by a body that is already down,
  // rather than by one still on its way and briefly tall enough to catch.
  window.__C__.step(1 / 120, { ...intent, crouch: true }, 60);
  const t = window.__C__.step(1 / 120, { ...intent, crouch: true }, 300);
  const last = t[t.length - 1];
  return { z: last.z, eye: last.eye, crouch: last.crouch };
}, INTENT_RUN);

check(near(crouchThroughBar.eye, 0.95, 0.001),
  'crouched, the collision body is 0.95 tall', `eye ${crouchThroughBar.eye}`);
check(crouchThroughBar.z < -171,
  'AND IT WALKS CLEAN UNDER THE BAR. This is the check that tells a real crouch from a camera trick',
  `reached z ${crouchThroughBar.z}, bar at z -168`);

notes.push('\nWALKING AT A BAR WHOSE UNDERSIDE IS AT 1.20');
notes.push(`  standing  stopped at z ${standIntoBar.z}   (bar face z -167.18)`);
notes.push(`  crouched  reached  z ${crouchThroughBar.z}`);

// ===========================================================================
// 5. YOU CANNOT STAND UP UNDER A LEDGE
// ===========================================================================

console.log('\n--- STANDING UP UNDER STONE ---');

const refusal = await page.evaluate(() => {
  const g = window.__SANDS__;
  const dt = 1 / 120;
  const still = { forward: 0, strafe: 0, sprint: false, jump: false, crouch: true };

  // Under the bar, crouched, at rest.
  window.__C__.place(3, -168);
  window.__C__.step(dt, { ...still }, 60);
  const under = window.__C__.step(dt, { ...still }, 1)[0];

  // Ask to stand. There is 1.20 m of headroom and the body needs 1.78.
  const asked = window.__C__.step(dt, { ...still, crouch: false }, 90);
  const refused = asked[asked.length - 1];

  // Walk out from under it and ask again. Backwards, so nothing about the bar
  // is in the way.
  const out = window.__C__.step(dt, { forward: -1, strafe: 0, sprint: false, jump: false, crouch: false }, 240);
  const freed = out[out.length - 1];

  // And the jump, which must also be refused while the body is pinned down.
  window.__C__.place(3, -168);
  window.__C__.step(dt, { ...still }, 60);
  const jumped = window.__C__.step(dt, { forward: 0, strafe: 0, sprint: false, jump: true, crouch: false }, 30);
  const airborne = jumped.some((s) => !s.grounded);
  const peakVy = Math.max(...jumped.map((s) => s.vy));

  return {
    under: { eye: under.eye, ceilinged: under.ceilinged },
    refused: { eye: refused.eye, crouch: refused.crouch, ceilinged: refused.ceilinged },
    freed: { eye: freed.eye, z: freed.z, ceilinged: freed.ceilinged },
    airborne, peakVy,
  };
});

check(near(refusal.refused.eye, 0.95, 0.001) && refusal.refused.ceilinged === true,
  'STANDING IS REFUSED UNDER THE BAR - 90 frames of asking and the body stayed at 0.95',
  `eye ${refusal.refused.eye}, ceilinged ${refusal.refused.ceilinged}`);
check(near(refusal.freed.eye, 1.68, 0.001) && refusal.freed.ceilinged === false,
  'and it stands the moment the body is clear of it, without the player asking twice',
  `eye ${refusal.freed.eye} at z ${refusal.freed.z}`);
check(refusal.airborne === false && refusal.peakVy <= 0,
  'A PINNED BODY CANNOT JUMP EITHER, which is the same rule stopping a head being launched into stone',
  `airborne ${refusal.airborne}, peak vy ${refusal.peakVy}`);

notes.push('\nSTANDING UP UNDER A 1.20 m CEILING');
notes.push(`  crouched under it   eye ${refusal.under.eye}`);
notes.push(`  asked to stand      eye ${refusal.refused.eye}  ceilinged ${refusal.refused.ceilinged}`);
notes.push(`  walked out          eye ${refusal.freed.eye}  at z ${refusal.freed.z}`);

// The bar goes away. Anything after this point is measured against the shipped
// map and not against the harness's furniture.
const cleaned = await page.evaluate(() => {
  const g = window.__SANDS__;
  const before = g.world.walls.length;
  for (let i = g.world.walls.length - 1; i >= 0; i--) {
    if (g.world.walls[i].__harness) g.world.walls.splice(i, 1);
  }
  return { before, after: g.world.walls.length };
});
check(cleaned.after === cleaned.before - 1,
  'the harness takes its bar back out of the world', `${cleaned.before} -> ${cleaned.after}`);

// ===========================================================================
// 6. THE SLIDE
// ===========================================================================

console.log('\n--- THE SLIDE ---');

const SLIDE = await page.evaluate(() => {
  const g = window.__SANDS__;
  const dt = 1 / 120;
  const run = { forward: 1, strafe: 0, sprint: true, jump: false, crouch: false };

  window.__C__.place(3, -164);
  g.input.state.crouch = false;

  // Build up to a real sprint first. The slide refuses a standing start on
  // purpose, so this is not scene-setting, it is the precondition.
  const runUp = window.__C__.step(dt, { ...run }, 120);
  const atSprint = runUp[runUp.length - 1];

  // The crouch edge, taken at speed.
  const intent = { ...run, crouch: true };
  const trace = window.__C__.step(dt, intent, 200);

  const peak = Math.max(...trace.map((s) => s.speed));
  const slid = trace.filter((s) => s.sliding);
  const last = trace[trace.length - 1];
  const endIdx = trace.findIndex((s, i) => i > 0 && !s.sliding && trace[i - 1].sliding);
  const end = endIdx > 0 ? trace[endIdx] : null;

  return {
    atSprint,
    peak,
    frames: slid.length,
    duration: slid.length ? +(slid.length * dt).toFixed(4) : 0,
    startZ: atSprint.z,
    endZ: end ? end.z : last.z,
    endSpeed: end ? end.speed : last.speed,
    endCrouch: end ? end.crouch : last.crouch,
    intentAfter: intent.crouch,
    tail: trace.slice(0, 90).filter((_, i) => i % 8 === 0)
      .map((s) => ({ t: s.t, speed: s.speed, sliding: s.sliding, eye: s.eye })),
    finalEye: last.eye,
    finalCrouch: last.crouch,
  };
});

check(SLIDE.atSprint.speed > 8.0,
  'the run-up reached a real sprint before anything was asked of the slide',
  `${SLIDE.atSprint.speed} m/s`);
// The launch is 10.8 and the first sample the harness can take is already one
// 1/120 s of deceleration past it, so the observable peak is a shade under. The
// window is tight enough that a launch of 9 or of 12 would not fit through it.
check(SLIDE.peak > 10.60 && SLIDE.peak <= 10.81,
  'THE SLIDE LAUNCHES AT 10.8 m/s - 1.26x the sprint, which is why it is worth pressing',
  `peak ${SLIDE.peak}`);
check(SLIDE.frames > 0, 'and the body reports itself sliding', `${SLIDE.frames} frames`);
check(SLIDE.duration > 0.45 && SLIDE.duration < 0.90,
  'IT ENDS, on the speed floor rather than on the 0.90 s guarantee',
  `${SLIDE.duration}s`);
// It ends AT the floor and hands the body straight to the walk cap, with no
// lurch in between. The number to fail on is a slide that drops the player to
// the 2.6 crouch pace on its exit frame - see the speed cap note in the
// controller for why that was the first thing this trace caught.
check(SLIDE.endSpeed > 5.0 && SLIDE.endSpeed <= 5.7,
  'and it ends AT the floor, which is what makes it read as friction and not as a timer',
  `${SLIDE.endSpeed} m/s against a floor of 5.6 and a walk cap of 5.4`);

const dist = Math.abs(SLIDE.endZ - SLIDE.startZ);
check(dist > 3.6 && dist < 6.0,
  'THE BODY ACTUALLY TRAVELLED - about two strides, measured off the position and not off the constants',
  `${dist.toFixed(3)} m`);

check(SLIDE.intentAfter === false,
  'AND IT HANDS THE CROUCH BACK, so the player comes out of it running rather than crawling',
  `crouch intent after ${SLIDE.intentAfter}`);
check(near(SLIDE.finalEye, 1.68, 0.001),
  'and the body is standing again by the end of the trace', `eye ${SLIDE.finalEye}`);

notes.push('\nTHE SLIDE, SAMPLED EVERY 8 STEPS OF 1/120s');
for (const s of SLIDE.tail) {
  notes.push(`  t+${s.t.toFixed(3)}s  ${s.speed.toFixed(3)} m/s  ${s.sliding ? 'SLIDING' : '       '}  eye ${s.eye.toFixed(3)}`);
}
notes.push(`  peak ${SLIDE.peak} m/s   duration ${SLIDE.duration}s   distance ${dist.toFixed(3)} m`);

// --- it is not chainable ----------------------------------------------------

const chain = await page.evaluate(() => {
  const g = window.__SANDS__;
  const dt = 1 / 120;
  const run = { forward: 1, strafe: 0, sprint: true, jump: false, crouch: false };

  window.__C__.place(3, -162);

  const intent = { ...run };
  window.__C__.step(dt, intent, 120);              // run up

  intent.crouch = true;
  const first = window.__C__.step(dt, intent, 120);  // slide one, to the end
  const firstFrames = first.filter((s) => s.sliding).length;

  // Immediately ask again. The intent was handed back at the end of the slide,
  // so this is a genuine fresh rising edge and the ONLY thing refusing it is
  // the cooldown.
  intent.crouch = true;
  const second = window.__C__.step(dt, intent, 40);
  const secondFrames = second.filter((s) => s.sliding).length;
  const secondPeak = Math.max(...second.map((s) => s.speed));

  // And once the cooldown has run out, a slide is available again - the bar is
  // a cooldown and not a one-per-life.
  intent.crouch = false;
  window.__C__.step(dt, intent, 120);
  intent.crouch = true;
  const third = window.__C__.step(dt, intent, 60);

  return {
    firstFrames, secondFrames, secondPeak,
    thirdFrames: third.filter((s) => s.sliding).length,
  };
});

check(chain.firstFrames > 0 && chain.secondFrames === 0,
  'A SECOND SLIDE IS REFUSED IMMEDIATELY - the 0.5 s cooldown is what stops this being infinite movement',
  `first ${chain.firstFrames} frames, second ${chain.secondFrames}`);
check(chain.secondPeak <= 10.9,
  'and nothing compounded: the refused attempt did not add speed to the body',
  `peak after the refusal ${chain.secondPeak.toFixed(3)} m/s`);
check(chain.thirdFrames > 0,
  'but a slide IS available again once the cooldown has run, so it is a rhythm and not a ration',
  `${chain.thirdFrames} frames`);

// --- a standing start buys nothing ------------------------------------------

const standingStart = await page.evaluate(() => {
  const g = window.__SANDS__;
  const dt = 1 / 120;
  window.__C__.place(3, -166);

  // The sprint button is held from the first frame, but the BODY is at rest.
  const intent = { forward: 1, strafe: 0, sprint: true, jump: false, crouch: true };
  const t = window.__C__.step(dt, intent, 40);
  return {
    slid: t.filter((s) => s.sliding).length,
    peak: Math.max(...t.map((s) => s.speed)),
    crouch: t[t.length - 1].crouch,
  };
});

check(standingStart.slid === 0 && standingStart.peak < 8.0,
  'A STANDING START CANNOT BUY 10.8 m/s - holding sprint is not the same as travelling',
  `${standingStart.slid} sliding frames, peak ${standingStart.peak.toFixed(3)}`);
check(standingStart.crouch > 0.9,
  'and the tap did the other thing it means: the body crouched',
  `crouch ${standingStart.crouch}`);

// --- a jump cannot escape it -------------------------------------------------

const slideJump = await page.evaluate(() => {
  const g = window.__SANDS__;
  const dt = 1 / 120;
  const run = { forward: 1, strafe: 0, sprint: true, jump: false, crouch: false };

  window.__C__.place(3, -164);
  const intent = { ...run };
  window.__C__.step(dt, intent, 120);

  intent.crouch = true;
  window.__C__.step(dt, intent, 12);        // mid-slide
  const midSliding = g.player.state.sliding;

  intent.jump = true;
  const t = window.__C__.step(dt, intent, 24);
  const leftGround = t.some((s) => !s.grounded);
  const peakVy = Math.max(...t.map((s) => s.vy));

  return { midSliding, leftGround, peakVy };
});

check(slideJump.midSliding === true, 'the body was mid-slide when the jump was asked for');
check(slideJump.leftGround === false && slideJump.peakVy <= 0,
  'AND THE JUMP IS REFUSED - a slide-hop would carry 10.8 m/s into a frictionless arc, which is the exploit',
  `left ground ${slideJump.leftGround}, peak vy ${slideJump.peakVy}`);

// ===========================================================================
// 7. THE PAUSE DOES NOT LET THE SLIDE TRAVEL
// ===========================================================================

console.log('\n--- THE FRAME GOVERNOR AND THE DEATH GATE ---');

await page.evaluate(() => { window.__SANDS__.pause.resume(); });
await stage();
await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.player.teleport({ x: 3, y: 0, z: -164 });
  g.rig.reset(0, 0);
  g.input.state.crouch = false;
  await window.__C__.frames(4);
});

// Get a slide running in the LIVE loop this time, off the pad, so what is
// frozen is the same slide a player would have.
const frozen = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const p = window.__PAD__;

  p.idle();
  p.ax(1, -1);            // left stick fully forward
  p.btn(11, true);        // R3, sprint
  await window.__C__.frames(3);
  p.btn(11, false);
  await window.__C__.frames(10);

  const beforeTap = window.__C__.body();

  p.btn(10, true);        // L3, at speed
  await window.__C__.frames(1);
  p.btn(10, false);
  await window.__C__.frames(1);

  const mid = window.__C__.body();
  if (!mid.sliding) return { started: false, mid };

  g.pause.open();
  const atPause = window.__C__.body();

  // A whole second of WALL time with the game stopped. A slide clocked off
  // performance.now() would finish behind the menu and deliver the player
  // somewhere else; one clocked off the loop's delta cannot move at all,
  // because a paused loop returns before player.update() is reached.
  const t0 = performance.now();
  while (performance.now() - t0 < 1000) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  const afterHold = window.__C__.body();

  g.pause.resume();
  await window.__C__.frames(2);
  const afterResume = window.__C__.body();

  p.idle();
  return { started: true, beforeTap, mid, atPause, afterHold, afterResume, held: performance.now() - t0 };
});

check(frozen.started === true,
  'a slide started from the PAD in the live loop, which is the one a player would have',
  frozen.started ? '' : `sliding ${frozen.mid && frozen.mid.sliding}, speed ${frozen.mid && frozen.mid.speed}`);

if (frozen.started) {
  check(frozen.afterHold.slideT === frozen.atPause.slideT,
    'THE SLIDE CLOCK DOES NOT TICK BEHIND THE PAUSE MENU',
    `slideT ${frozen.atPause.slideT} -> ${frozen.afterHold.slideT} over ${Math.round(frozen.held)}ms of wall time`);
  check(frozen.afterHold.z === frozen.atPause.z && frozen.afterHold.x === frozen.atPause.x,
    'AND THE BODY DOES NOT TRAVEL BEHIND IT EITHER - a paused slide resumes where it stopped',
    `(${frozen.atPause.x}, ${frozen.atPause.z}) -> (${frozen.afterHold.x}, ${frozen.afterHold.z})`);
  check(frozen.afterResume.slideT > frozen.atPause.slideT || !frozen.afterResume.sliding,
    'and it carries on the moment the game does',
    `slideT ${frozen.afterResume.slideT}, sliding ${frozen.afterResume.sliding}`);

  notes.push('\nA SLIDE HELD UNDER THE PAUSE MENU');
  notes.push(`  at the pause     slideT ${frozen.atPause.slideT}  z ${frozen.atPause.z}  eye ${frozen.atPause.eye}`);
  notes.push(`  after ${Math.round(frozen.held)}ms    slideT ${frozen.afterHold.slideT}  z ${frozen.afterHold.z}  eye ${frozen.afterHold.eye}`);
  notes.push(`  after resume     slideT ${frozen.afterResume.slideT}  z ${frozen.afterResume.z}  sliding ${frozen.afterResume.sliding}`);
}

// The death gate is the same mechanism from this file's point of view - main.js
// gates player.update() on `!halted` exactly as it returns early on paused - so
// the check that matters is that going down clears the posture rather than
// respawning the player mid-slide.
await stage();
const afterDeath = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.combat.state.invulnerable = false;
  g.input.state.crouch = true;
  await window.__C__.frames(6);
  const beforeDown = window.__C__.body();

  g.player.state.health = 5;
  g.combat.damagePlayer(60, g.player.position.x, g.player.position.z);
  for (let i = 0; i < 900 && g.death.phase !== 'waiting'; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  const held = window.__C__.body();

  document.getElementById('death-confirm').click();
  for (let i = 0; i < 240 && g.death.phase !== 'none'; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
  await window.__C__.frames(3);
  const after = window.__C__.body();

  g.input.state.crouch = false;
  g.combat.state.invulnerable = true;
  return { beforeDown, held, after };
});

check(afterDeath.beforeDown.crouch > 0.9,
  'the player was crouched when they went down', `crouch ${afterDeath.beforeDown.crouch}`);
check(afterDeath.after.sliding === false && near(afterDeath.after.eye, 1.68, 0.02),
  'A RESPAWN STANDS THE BODY BACK UP and cannot arrive mid-slide',
  `eye ${afterDeath.after.eye}, sliding ${afterDeath.after.sliding}`);

// ===========================================================================
// 8. THE CONTROLS PAGE AGREES WITH ALL OF IT
// ===========================================================================

console.log('\n--- THE CONTROLS PAGE ---');

await page.evaluate(() => window.__SANDS__.pause.open());
await page.waitForTimeout(200);
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('#pause [data-tab]')]
    .find((t) => t.dataset.tab === 'controls');
  if (tab) tab.click();
});
await page.waitForTimeout(200);

const bindRows = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#pause [data-panel="controls"] .bind-row')];
  return rows.map((r) => ({
    keys: [...r.querySelectorAll('.key-cap')].map((k) => k.textContent.trim()),
    what: r.querySelector('.bind-what').textContent,
  }));
});

const documented = (key, word) => bindRows.some((r) => r.keys.includes(key) && r.what.includes(word));

for (const [key, word, label] of [
  ['L3', 'Crouch', 'L3 is documented as crouch'],
  ['L3', 'Slide', 'and as the slide, on the same button, so nobody hunts for a fourth'],
  ['Circle', 'Khopesh', 'Circle is documented as the khopesh'],
  ['Square', 'Interact', 'Square is documented as the interact'],
  ['Square', 'Reload', 'and as the reload, in the order they resolve'],
  ['C', 'Crouch', 'C is documented as crouch'],
  ['Ctrl', 'Crouch', 'and so is Ctrl'],
  ['C', 'Slide', 'and the keyboard slide is stated as a crouch taken at speed'],
]) {
  check(documented(key, word), `controls: ${label}`,
    bindRows.filter((r) => r.keys.includes(key)).map((r) => r.what).join(' | ') || 'no row');
}

// The old claims are GONE, not merely outnumbered. A controls page that still
// carries the superseded line is the failure this section exists for.
check(!bindRows.some((r) => r.keys.includes('Circle') && /Buy, open/.test(r.what)),
  'and the page no longer says Circle interacts, which it did until tonight',
  bindRows.filter((r) => r.keys.includes('Circle')).map((r) => r.what).join(' | '));

await page.evaluate(() => window.__SANDS__.pause.resume());

// ===========================================================================

check(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));

console.log(notes.join('\n'));
console.log(`\n${fails.length ? `${fails.length} FAILED of ${pass + fails.length}` : `all ${pass} checks green`}`);

await browser.close();
process.exit(fails.length ? 1 : 0);
