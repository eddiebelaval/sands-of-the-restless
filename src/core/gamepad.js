/**
 * THE GAMEPAD READER.
 *
 * This file does two things and deliberately does not do a third. It READS a
 * physical pad out of the browser's Gamepad API and it SHAPES the two analog
 * sticks into numbers a camera can use. It does not touch the DOM, it does not
 * know what a weapon is, and it never decides what a button MEANS - that is
 * core/input.js, which is the only file in the project allowed to say that R2
 * is the trigger. Keeping the split means the whole of the maths below is
 * testable with no browser at all, which is the only way any of it was checked
 * on a machine with no controller attached to it.
 *
 * ---------------------------------------------------------------------------
 * WHY A STICK IS NOT A MOUSE, WHICH IS THE ENTIRE DESIGN
 * ---------------------------------------------------------------------------
 *
 * A mouse reports a DELTA: how far it moved since the last event. That number
 * is already frame-rate independent, because a slow frame simply collects more
 * of them, and core/input.js accumulates them into state.dx / state.dy exactly
 * as they arrive.
 *
 * A stick reports a POSITION, and a position held still forever is a request to
 * keep turning forever. What it drives is an angular VELOCITY - radians per
 * second - and the only correct way to spend a velocity is to multiply it by
 * the frame's delta time. The naive implementation adds the raw axis value to
 * the camera angle once per frame, and that is the single most common reason
 * browser games with pad support are unplayable: the turn speed becomes a
 * function of the frame rate. On this project that is not a theoretical
 * complaint. core/governor.js exists precisely because frame time is expected
 * to VARY BY MACHINE, so a rate-per-frame implementation would turn at one
 * speed on the author's desktop, half that on a laptop, and a different speed
 * again the moment the governor dropped a rung mid-fight.
 *
 * So everything below returns rates, and the multiply by dt happens in exactly
 * one place: lookDelta(). Doubling dt doubles the angle turned, exactly, and
 * test/gamepad.mjs asserts that as an equality rather than as a tolerance.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DEADZONE IS RADIAL AND NOT PER AXIS
 * ---------------------------------------------------------------------------
 *
 * The obvious implementation is `if (Math.abs(x) < dz) x = 0` on each axis
 * separately, and it is wrong in a way that is instantly felt and hard to name.
 * A stick pushed diagonally at 30 degrees off vertical has a small x and a
 * large y; a per-axis deadzone zeroes the x and leaves the y, so the aim SNAPS
 * to the vertical. Every diagonal near an axis collapses onto that axis, and
 * the player experiences a crosshair that refuses to move smoothly in any
 * direction except the four cardinals, which reads as the aim sticking rather
 * than as a deadzone doing its job.
 *
 * The correct unit is the MAGNITUDE of the (x, y) vector. Below the deadzone
 * the stick is silent in every direction equally; above it the output is
 * rescaled so it ramps from zero at the deadzone edge rather than jumping to
 * the deadzone's own value. That rescale is the second half of the fix and is
 * as important as the first: without it, the instant the stick crosses 0.12 the
 * camera starts turning at 12 per cent of full speed, which is a visible lurch
 * every time the player begins a turn.
 *
 * ---------------------------------------------------------------------------
 * THE NUMBERS, AND WHAT EACH ONE IS MODELLING
 * ---------------------------------------------------------------------------
 *
 * DEADZONE 0.12. A DualShock 4 potentiometer at rest does not read zero. A pad
 * out of the box sits within roughly 0.02 to 0.05, and a worn one - which is
 * the one that matters, because it is the one people own - drifts to 0.08 and
 * beyond. 0.12 is the smallest number that covers a worn stick without eating
 * so much of the travel that fine aim has nowhere to live, and it is where the
 * shooters this game is modelled on sit. It is exposed as a slider anyway,
 * because the correct value is a property of the physical pad and no constant
 * can be right for every one of them.
 *
 * EXPONENT 2.0. A linear stick makes fine aim impossible: half deflection gives
 * half the maximum turn rate, and the maximum has to be fast enough to spin
 * round when something is behind you, so the whole lower half of the travel is
 * still too fast to track a head with. Raising the magnitude to a power keeps
 * the full-deflection speed and buys precision near the centre. At 2.0, half
 * deflection is 25 per cent of full speed and a quarter deflection is 6 per
 * cent, which is the band a player actually aims in. 1.5 leaves the mid range
 * fast enough that small corrections overshoot; 2.5 flattens the middle so far
 * that the stick feels dead until it is nearly at the edge, and the response
 * then arrives as a jump. 2.0 is the middle of the range the genre uses and is
 * exposed as a slider for the same reason the deadzone is. THIS IS THE ONE
 * NUMBER HERE THAT CANNOT BE FINISHED WITHOUT A PAD IN HAND: the maths is
 * asserted, the feel is not, and the slider exists so the owner can move it.
 *
 * YAW 2.6 rad/s (149 deg/s) and PITCH 1.9 rad/s (109 deg/s) at full deflection
 * and sensitivity 1.00. Yaw is the speed at which a full sweep of the stick
 * turns the player right round in about two and a half seconds, which is the
 * console shooter's standing compromise between being able to answer something
 * behind you and being able to hold a line. Pitch is deliberately slower - a
 * touch under three quarters of yaw - because the vertical axis is CLAMPED to
 * 180 degrees total by the camera and the same rate would run from floor to
 * ceiling in a flick. The sensitivity slider multiplies both, 0.20 to 3.00, the
 * same range and the same shape as the mouse row it sits under.
 *
 * NO ACCELERATION RAMP. The other lever the genre uses is to ramp the turn rate
 * up while the stick is held at full deflection. It was considered and rejected
 * here: it makes the stick feel like it lags at the start of every turn, it
 * makes the same physical input mean two different things depending on how long
 * ago it started, and it is the first thing serious players switch off. The
 * response curve above buys the precision that acceleration is usually reached
 * for, without making the mapping time-dependent.
 *
 * TRIGGERS, WITH HYSTERESIS. buttons[6] and buttons[7] on a DualShock 4 are
 * genuinely analog: they carry a `.value` from 0 to 1 and not just `.pressed`.
 * Fire arms at 0.55 and disarms at 0.40, aim arms at 0.30 and disarms at 0.20.
 * Two numbers per action rather than one because a spring that is resting right
 * on a single threshold chatters, and a trigger that fires four times a second
 * while the player thinks they are holding it steady is the kind of fault that
 * gets blamed on the gun. Aim arms earlier than fire because bringing a sight
 * up should be the quicker half of the pull; they are separate triggers so
 * there is no ordering between them to get wrong.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS POLLS AND NEVER LISTENS
 * ---------------------------------------------------------------------------
 *
 * There is a `gamepadconnected` event and this file does not use it. The
 * defining bug class on this project is code that was written and never took
 * effect, and a handler bound to an event that does not fire is the purest form
 * of it. `navigator.getGamepads()` is the ground truth, it is cheap, and the
 * frame loop is already running, so connection is DERIVED from the poll: a pad
 * exists when a poll finds one. Nothing can silently fail to be notified.
 *
 * EVERY SLOT IS SCANNED, and index 0 is not assumed. getGamepads() returns a
 * sparse array - four entries on Chrome, most of them null - and which slot a
 * pad lands in depends on the order things were connected. Reading [0] is the
 * exact shape of failure the project keeps hitting: correct-looking code that
 * reads nothing on the one machine that matters.
 */

/** What the settings panel starts at, and what the maths is tuned around. */
export const PAD_DEFAULTS = {
  deadzone: 0.12,
  exponent: 2.0,
  sensitivity: 1.0,
  invertY: false,
  /** Radians per second at full deflection and sensitivity 1.00. */
  yawRate: 2.6,
  pitchRate: 1.9,
};

/** What the sliders may ask for. The mouse row's range, for the sensitivity. */
export const PAD_LIMITS = {
  deadzoneMin: 0.02, deadzoneMax: 0.35,
  exponentMin: 1.0, exponentMax: 3.0,
  sensMin: 0.20, sensMax: 3.00,
};

/** Arm and disarm points for the two analog triggers. See the note above. */
export const TRIGGER = {
  fireOn: 0.55, fireOff: 0.40,
  adsOn: 0.30, adsOff: 0.20,
};

/**
 * Turning a stick into menu presses.
 *
 * `on` and `off` are the same hysteresis idea as the triggers, for the same
 * reason: a stick resting near the threshold would walk the cursor down a list
 * on its own. `delay` and `repeat` are the standard two-stage key repeat - a
 * long first wait so a deliberate single press moves exactly one row, then a
 * fast repeat so holding it is a scroll rather than a hundred presses.
 */
export const MENU = { on: 0.55, off: 0.35, delay: 0.40, repeat: 0.10 };

/**
 * The most the pad may advance in one poll, in seconds.
 *
 * The same 1/20 the frame loop clamps its simulation delta to, and here for the
 * same reason: a tab that was backgrounded comes back with an enormous delta,
 * and an unclamped rate would spend all of it at once and spin the player round
 * several times before the first frame they can see.
 */
export const MAX_POLL_DELTA = 1 / 20;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * The canonical button names, in the order the standard mapping lists them.
 *
 * Named for the DualShock 4 face rather than for the Xbox one because the pad
 * in the owner's hands is a DualShock 4 and a controls list that says "A" in
 * front of a player looking at a Cross is a controls list that is lying. The
 * standard mapping's index 0 is the bottom face button on every pad, whatever
 * the manufacturer printed on it.
 */
export const BUTTONS = [
  'cross', 'circle', 'square', 'triangle',
  'l1', 'r1', 'l2', 'r2',
  'share', 'options',
  'l3', 'r3',
  'up', 'down', 'left', 'right',
  'ps',
];

/**
 * THE TWO LAYOUTS, AND WHY THE SECOND ONE HAS TO EXIST.
 *
 * Chrome is documented to expose a DualShock 4 through the "standard" gamepad
 * mapping, which fixes every index below. That is very probably what will
 * happen on the owner's machine and it is NOT ASSUMED, because the whole point
 * of `Gamepad.mapping` being a string on the object is that the browser is
 * telling you whether it managed it. Bluetooth versus USB, an OS-level driver,
 * a third-party pad reporting a Sony vendor id, and Chrome's own remapping
 * table all decide this at runtime, and a pad that comes through unmapped with
 * these indices applied would put reload on the aim trigger.
 *
 * So the mapping is READ, and when it is not "standard" the fallback below is
 * used instead. That is the raw HID order a DualShock 4 reports when nobody has
 * remapped it: the face buttons are in the physical order Square, Cross,
 * Circle, Triangle rather than the standard's Cross, Circle, Square, Triangle;
 * the triggers arrive as extra AXES rather than as button values; and the D-pad
 * is a single hat switch on axis 9 rather than four buttons. Every one of those
 * three differences would produce a control scheme that looked wired up and did
 * the wrong thing.
 */
const STANDARD = {
  id: 'standard',
  name: 'Standard mapping',
  axes: { lx: 0, ly: 1, rx: 2, ry: 3 },
  buttons: {
    cross: 0, circle: 1, square: 2, triangle: 3,
    l1: 4, r1: 5, l2: 6, r2: 7,
    share: 8, options: 9,
    l3: 10, r3: 11,
    up: 12, down: 13, left: 14, right: 15,
    ps: 16,
  },
  /** Which buttons carry a meaningful analog `.value`. */
  analog: { l2: 6, r2: 7 },
  hat: null,
};

const DS4_RAW = {
  id: 'ds4-raw',
  name: 'DualShock 4, unmapped',
  axes: { lx: 0, ly: 1, rx: 2, ry: 5 },
  buttons: {
    square: 0, cross: 1, circle: 2, triangle: 3,
    l1: 4, r1: 5, l2: 6, r2: 7,
    share: 8, options: 9,
    l3: 10, r3: 11,
    ps: 12,
    // No D-pad buttons at all in this layout. See `hat`.
    up: -1, down: -1, left: -1, right: -1,
  },
  /**
   * The triggers as axes, running -1 released to +1 fully pressed, which is
   * rescaled to 0..1 below. This is the difference that a "standard mapping"
   * assumption gets most wrong: read as buttons[6].value they would be flat
   * zero, and the analog pull the owner asked for would silently not exist.
   */
  analogAxes: { l2: 3, r2: 4 },
  analog: {},
  /**
   * The D-pad as a HID hat switch. Eight directions encoded as
   * value = direction * (2/7) - 1, clockwise from up, and anything above about
   * 1.1 (typically 1.286, or exactly 9/7 - 1 for "no direction") means centred.
   */
  hat: 9,
};

export const PAD_PROFILES = { standard: STANDARD, 'ds4-raw': DS4_RAW };

/** Does this look like a Sony pad, whatever the browser managed to do with it. */
const LOOKS_LIKE_DS4 = /054c|dualshock|dual\s*shock|dualsense|wireless controller/i;

/**
 * Which profile to read a pad through, and whether that was a guess.
 *
 * `assumed` travels with the answer and is printed in the settings panel. A
 * layout the code had to guess at is exactly the thing the owner needs to be
 * told about, because it is the one that will be subtly wrong in a way no
 * assertion here can see without the hardware.
 */
export function resolveProfile(gp) {
  if (!gp) return { profile: STANDARD, assumed: false };

  if (gp.mapping === 'standard') return { profile: STANDARD, assumed: false };

  const axes = gp.axes ? gp.axes.length : 0;
  if (LOOKS_LIKE_DS4.test(gp.id || '') && axes >= 6) {
    return { profile: DS4_RAW, assumed: false };
  }

  // Nothing recognised. The standard order is still the best guess there is,
  // and saying so out loud is better than refusing to work at all.
  return { profile: STANDARD, assumed: true };
}

// ---------------------------------------------------------------------------
// the maths, which is pure and is where the feel lives
// ---------------------------------------------------------------------------

/**
 * A RADIAL deadzone with the output rescaled to ramp from zero.
 *
 * Returns the direction unchanged and the magnitude remapped, so a stick at
 * 30 degrees off vertical is still at 30 degrees off vertical afterwards. See
 * the long note at the top for why the per-axis version is the classic error.
 *
 * @returns {{x: number, y: number, mag: number}} mag is 0..1
 */
export function radialDeadzone(x, y, deadzone) {
  const dz = clamp(Number(deadzone) || 0, 0, 0.9);
  const mag = Math.hypot(x, y);
  if (!(mag > dz)) return { x: 0, y: 0, mag: 0 };

  // (mag - dz) / (1 - dz) is the rescale. Without it the first live sample
  // jumps straight to `dz` worth of speed, which is a lurch at the start of
  // every single turn the player makes.
  const live = Math.min(1, (mag - dz) / (1 - dz));
  const k = live / mag;
  return { x: x * k, y: y * k, mag: live };
}

/**
 * The deadzone and then the response curve, in that order.
 *
 * ORDER MATTERS AND IS NOT ARBITRARY. The curve is applied to the RESCALED
 * magnitude, so it shapes the live travel between the deadzone edge and the
 * rim. Applying it to the raw magnitude first would shape the dead travel as
 * well and would change where the deadzone effectively sits every time the
 * curve slider moved, which makes the two controls fight each other.
 */
export function shapeStick(x, y, deadzone, exponent) {
  const dz = radialDeadzone(x, y, deadzone);
  if (dz.mag === 0) return { x: 0, y: 0, mag: 0 };

  const e = clamp(Number(exponent) || 1, 1, 4);
  const shaped = Math.pow(dz.mag, e);
  const k = shaped / dz.mag;
  return { x: dz.x * k, y: dz.y * k, mag: shaped };
}

/**
 * One frame of look, IN RADIANS, in the same sense a mouse delta is.
 *
 * The return is deliberately named dxRad / dyRad rather than yaw / pitch: it is
 * a delta in the mouse's own convention - positive dx turns right, positive dy
 * looks down - because core/input.js feeds it into the same accumulator the
 * mouse writes to, and a value that had already been converted into world yaw
 * would have to be un-converted there.
 *
 * dt is the ONLY place time enters this file. Everything above is a rate.
 */
export function lookDelta(x, y, dt, opts = {}) {
  const {
    deadzone = PAD_DEFAULTS.deadzone,
    exponent = PAD_DEFAULTS.exponent,
    sensitivity = PAD_DEFAULTS.sensitivity,
    yawRate = PAD_DEFAULTS.yawRate,
    pitchRate = PAD_DEFAULTS.pitchRate,
    invertY = false,
  } = opts;

  const s = shapeStick(x, y, deadzone, exponent);
  const sens = clamp(Number(sensitivity) || 0, PAD_LIMITS.sensMin, PAD_LIMITS.sensMax);
  const t = Math.max(0, Number(dt) || 0);

  return {
    dxRad: s.x * yawRate * sens * t,
    // A gamepad's vertical axis reports negative for up, which is the same
    // sense as a mouse reporting negative movementY for up. So the pass-through
    // is already correct and invert is a straight sign flip on top of it.
    dyRad: s.y * pitchRate * sens * t * (invertY ? -1 : 1),
    mag: s.mag,
  };
}

/** Degrees per second at full deflection, for the settings panel to print. */
export function degPerSecond(rate, sensitivity) {
  const sens = clamp(Number(sensitivity) || 0, PAD_LIMITS.sensMin, PAD_LIMITS.sensMax);
  return rate * sens * (180 / Math.PI);
}

// ---------------------------------------------------------------------------
// the reader
// ---------------------------------------------------------------------------

/** Eight hat directions, clockwise from up, as {up,down,left,right} flags. */
function decodeHat(v) {
  const none = { up: false, down: false, left: false, right: false };
  if (typeof v !== 'number' || !Number.isFinite(v) || v > 1.05 || v < -1.05) return none;

  // direction = (v + 1) * 3.5, rounded. 0 is up, then clockwise in eighths.
  const dir = Math.round((v + 1) * 3.5);
  switch (((dir % 8) + 8) % 8) {
    case 0: return { up: true, down: false, left: false, right: false };
    case 1: return { up: true, down: false, left: false, right: true };
    case 2: return { up: false, down: false, left: false, right: true };
    case 3: return { up: false, down: true, left: false, right: true };
    case 4: return { up: false, down: true, left: false, right: false };
    case 5: return { up: false, down: true, left: true, right: false };
    case 6: return { up: false, down: false, left: true, right: false };
    default: return { up: true, down: false, left: true, right: false };
  }
}

/**
 * Create the reader.
 *
 * @param {object} [o]
 * @param {function} [o.getPads]  injected for tests. Defaults to the real API.
 */
export function createPadReader({ getPads } = {}) {
  const source = getPads || (() => (
    typeof navigator !== 'undefined' && navigator.getGamepads
      ? navigator.getGamepads()
      : []
  ));

  /**
   * The slot the adopted pad is in, and it is FOUND rather than assumed.
   *
   * Kept across polls so that a second pad appearing does not steal the game
   * from the one being played on, and re-found the moment the adopted slot goes
   * empty. -1 means nothing is adopted.
   */
  let index = -1;
  let id = '';
  let mapping = '';
  let profile = STANDARD;
  let assumed = false;
  /** Bumped every time a DIFFERENT pad is adopted, so callers can greet it. */
  let generation = 0;

  /** Last frame's digital state, for edge detection. */
  let held = Object.create(null);
  /** The two triggers' latched digital state. See TRIGGER and the note above. */
  let fireLatch = false;
  let adsLatch = false;

  function forget() {
    index = -1; id = ''; mapping = '';
    profile = STANDARD; assumed = false;
    held = Object.create(null);
    fireLatch = false;
    adsLatch = false;
  }

  /**
   * Find a live pad, scanning EVERY slot.
   *
   * A pad is only adopted if it has axes, which rejects the placeholder entries
   * some drivers leave behind on disconnect - an object that exists, reports
   * connected, and has nothing on it.
   */
  function find() {
    const pads = source() || [];

    // Keep the one already in hand if it is still there.
    if (index >= 0) {
      const cur = pads[index];
      if (cur && cur.connected !== false && cur.axes && cur.axes.length >= 2 && cur.id === id) {
        return cur;
      }
      forget();
    }

    for (let i = 0; i < pads.length; i++) {
      const gp = pads[i];
      if (!gp) continue;
      if (gp.connected === false) continue;
      if (!gp.axes || gp.axes.length < 2) continue;
      if (!gp.buttons || gp.buttons.length < 4) continue;

      index = i;
      id = gp.id || '';
      mapping = gp.mapping || '';
      const r = resolveProfile(gp);
      profile = r.profile;
      assumed = r.assumed;
      generation++;
      return gp;
    }

    return null;
  }

  const axisOf = (gp, i) => (
    typeof i === 'number' && i >= 0 && i < gp.axes.length ? (gp.axes[i] || 0) : 0
  );

  const pressedAt = (gp, i) => {
    if (typeof i !== 'number' || i < 0 || i >= gp.buttons.length) return false;
    const b = gp.buttons[i];
    if (!b) return false;
    // A GamepadButton on Chrome, a bare number on some polyfills and on the
    // synthetic pads the harness injects. Both are honoured, because a reader
    // that only understood one of them would be untestable.
    return typeof b === 'object' ? !!b.pressed : b > 0.5;
  };

  const valueAt = (gp, i) => {
    if (typeof i !== 'number' || i < 0 || i >= gp.buttons.length) return 0;
    const b = gp.buttons[i];
    if (!b) return 0;
    if (typeof b === 'object') return typeof b.value === 'number' ? b.value : (b.pressed ? 1 : 0);
    return Number(b) || 0;
  };

  /**
   * One poll. Returns null when there is no pad, and a full snapshot when there
   * is. `dt` is clamped here rather than by the caller so that every consumer
   * gets the same guarantee.
   */
  function poll(dt) {
    const gp = find();
    if (!gp) {
      // Nothing attached. Latches are cleared so that unplugging a pad mid-hold
      // cannot leave the trigger down forever.
      held = Object.create(null);
      fireLatch = false;
      adsLatch = false;
      return null;
    }

    const t = clamp(Number(dt) || 0, 0, MAX_POLL_DELTA);
    const B = profile.buttons;

    // --- digital state, including the two synthesised from the hat ----------
    const now = Object.create(null);
    for (const name of BUTTONS) now[name] = pressedAt(gp, B[name]);

    if (profile.hat !== null && profile.hat !== undefined) {
      const hat = decodeHat(axisOf(gp, profile.hat));
      now.up = hat.up; now.down = hat.down; now.left = hat.left; now.right = hat.right;
    }

    // --- the analog triggers ------------------------------------------------
    const rawL2 = profile.analogAxes
      ? (axisOf(gp, profile.analogAxes.l2) + 1) / 2
      : valueAt(gp, B.l2);
    const rawR2 = profile.analogAxes
      ? (axisOf(gp, profile.analogAxes.r2) + 1) / 2
      : valueAt(gp, B.r2);

    const l2 = clamp(rawL2, 0, 1);
    const r2 = clamp(rawR2, 0, 1);

    // Hysteresis. Arm high, disarm low, and hold whatever was decided between
    // the two. See TRIGGER for why one threshold chatters.
    if (fireLatch) { if (r2 < TRIGGER.fireOff) fireLatch = false; }
    else if (r2 >= TRIGGER.fireOn) fireLatch = true;

    if (adsLatch) { if (l2 < TRIGGER.adsOff) adsLatch = false; }
    else if (l2 >= TRIGGER.adsOn) adsLatch = true;

    // The digital view of the triggers is the LATCH and not the raw press, so
    // a caller reading `buttons.r2` and a caller reading `fire` can never
    // disagree about whether the trigger is down.
    now.r2 = fireLatch;
    now.l2 = adsLatch;

    // --- edges --------------------------------------------------------------
    const pressed = [];
    const released = [];
    for (const name of BUTTONS) {
      const was = !!held[name];
      if (now[name] && !was) pressed.push(name);
      else if (!now[name] && was) released.push(name);
    }
    held = now;

    const A = profile.axes;
    return {
      index,
      id,
      mapping,
      profile: profile.id,
      profileName: profile.name,
      assumed,
      generation,
      dt: t,
      /** Raw, before any deadzone. Exposed so a test can prove the shaping. */
      raw: {
        lx: axisOf(gp, A.lx), ly: axisOf(gp, A.ly),
        rx: axisOf(gp, A.rx), ry: axisOf(gp, A.ry),
      },
      analog: { l2, r2 },
      buttons: now,
      pressed,
      released,
      /** Convenience aliases for the two actions the triggers own. */
      fire: fireLatch,
      ads: adsLatch,
      vibration: !!gp.vibrationActuator,
    };
  }

  /**
   * Rumble, if the pad and the browser can.
   *
   * Wrapped in every guard there is because this is a progressive-enhancement
   * feature on a moving target: `vibrationActuator` is absent on most pads,
   * `playEffect` rejects rather than throwing when the effect type is not
   * supported, and the older `.type` property was removed from the spec. None
   * of that may ever surface as an unhandled rejection in the console, because
   * a console error in this project is a test failure.
   */
  function rumble(strong = 0.6, weak = 0.3, ms = 120) {
    const pads = source() || [];
    const gp = index >= 0 ? pads[index] : null;
    const act = gp && gp.vibrationActuator;
    if (!act || typeof act.playEffect !== 'function') return false;

    try {
      const p = act.playEffect('dual-rumble', {
        startDelay: 0,
        duration: clamp(ms, 0, 2000),
        strongMagnitude: clamp(strong, 0, 1),
        weakMagnitude: clamp(weak, 0, 1),
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  return {
    poll,
    rumble,
    forget,
    get index() { return index; },
    get id() { return id; },
    get mapping() { return mapping; },
    get profile() { return profile.id; },
    get profileName() { return profile.name; },
    get assumed() { return assumed; },
    get generation() { return generation; },
    get connected() { return index >= 0; },
  };
}

/**
 * A two-stage repeat, for turning a held stick or D-pad into menu presses.
 *
 * Its own tiny state machine rather than a flag beside the caller's, because
 * the interesting part is the TIMING and the timing has to survive a direction
 * change: pressing up, then down without letting go, must give one immediate
 * press and then a fresh long delay, not an instant repeat inherited from the
 * previous direction.
 */
export function createRepeater({ delay = MENU.delay, rate = MENU.repeat } = {}) {
  let dir = 0;
  let timer = 0;
  let repeating = false;

  return {
    /**
     * @param {number} next   -1, 0 or +1, this frame's direction
     * @param {number} dt     seconds
     * @returns {number}      -1, 0 or +1, the direction to ACT on this frame
     */
    step(next, dt) {
      if (next === 0) { dir = 0; timer = 0; repeating = false; return 0; }

      if (next !== dir) {
        dir = next;
        timer = 0;
        repeating = false;
        return next;                       // the first press is immediate
      }

      timer += Math.max(0, dt);
      const wait = repeating ? rate : delay;
      if (timer < wait) return 0;

      timer -= wait;
      repeating = true;
      return next;
    },
    reset() { dir = 0; timer = 0; repeating = false; },
  };
}
