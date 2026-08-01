/**
 * Input.
 *
 * Pointer Lock is driven against the raw browser API rather than
 * PointerLockControls, so the camera controller stays ours and the iframe
 * fallback is possible at all.
 *
 * The fallback matters: inside an iframe without `allow="pointer-lock"`, the
 * request is denied silently. Rather than leaving the player with a dead mouse,
 * we wait ~400ms for lock to engage and, if it never does, fall back to reading
 * movementX/movementY off plain mousemove events while a button is held.
 *
 * ---------------------------------------------------------------------------
 * THE PAD, AND WHY IT LIVES IN THIS FILE
 * ---------------------------------------------------------------------------
 *
 * core/gamepad.js reads the hardware and shapes the sticks; it does not know
 * what a button means. This file is where a button acquires a meaning, because
 * this is already the file that says W is forward and the right mouse button is
 * the sight. Two files claiming the authority to bind an action is how a game
 * ends up with a pad scheme that disagrees with its keyboard scheme.
 *
 * THE PAD AND THE MOUSE ARE BOTH LIVE, ALWAYS. There is no "input mode" here
 * and there deliberately is not one: a mode has to be entered, which means it
 * can be entered wrongly, and the failure looks like a dead controller with no
 * error anywhere. Instead every shared field below is a pair - what the
 * keyboard and mouse say, and what the pad says - combined on read. Buttons OR
 * together, so a trigger held on the pad and a mouse button held at the same
 * time is one shot rather than a fight. The movement axes SUM and clamp, so
 * holding W while pushing the stick backwards cancels, which is the only
 * physically sensible reading of two devices asking for opposite things. Look
 * ADDS into the same accumulator the mouse writes to, which is what every game
 * that supports both does and is the reason a pad player can nudge the mouse
 * mid-fight without anything switching underneath them.
 *
 * ---------------------------------------------------------------------------
 * POINTER LOCK, AND THE PLAYER WHO NEVER CLICKS ANYTHING
 * ---------------------------------------------------------------------------
 *
 * The mouse path cannot look until pointer lock is held, for the obvious reason
 * that without it there are no movementX deltas to read. The PAD PATH IS NOT
 * GATED ON IT AT ALL, and that is the single most important line in this file
 * for the feature to exist: a player who picked up a controller has no reason
 * to click a canvas, and a camera that is dead until they do would be reported
 * as "the controller does not work".
 *
 * That leaves one real problem rather than an imagined one. Pointer lock
 * requires a transient user activation, and a synthetic click dispatched by the
 * pad does not grant one - so a run STARTED from the pad asks for lock, is
 * refused, and the 400ms probe in engage() below would then declare pointer
 * lock unavailable on a perfectly healthy browser and tell the player to hold a
 * mouse button to look for the rest of the session. The probe is a decision
 * about whether the API works HERE, and a request that was never user-activated
 * is not evidence about that. So the probe is skipped when the pad is the
 * device that entered the game, exactly as relock() already skips it for a
 * re-lock. `lastDevice` is tracked off `isTrusted`, so a synthetic keystroke
 * this file dispatched can never be mistaken for the player's hand.
 */

import {
  createPadReader, createRepeater,
  shapeStick, lookDelta, degPerSecond,
  PAD_DEFAULTS, PAD_LIMITS, MENU,
} from './gamepad.js';

const LOCK_TIMEOUT_MS = 400;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * The `key` value that belongs with each `code` this file synthesises.
 *
 * Both are filled in because a handler is entitled to read either, and a
 * synthetic event that carries half of a real one is a trap for whoever writes
 * the next binding rather than a shortcut for this one.
 */
const KEY_FOR = {
  KeyR: 'r', KeyV: 'v', KeyQ: 'q', KeyF: 'f',
  Escape: 'Escape', Enter: 'Enter',
};

export function createInput(canvas) {
  const keys = new Set();

  /**
   * WHAT THE KEYBOARD AND MOUSE SAY, and what the pad says, kept apart.
   *
   * These two are never read directly by anything outside this file. `state`
   * below exposes the COMBINATION, through accessors, so that every existing
   * reader - the player controller, the weapon system, the grenade system, and
   * four test suites that write to these fields directly - keeps working
   * unchanged while a second device writes to the same names.
   */
  const kb = {
    forward: 0, strafe: 0,
    sprint: false, jump: false, fire: false, ads: false,
    interact: false, grenade: false,
  };

  const pad = {
    forward: 0, strafe: 0,
    sprint: false, jump: false, fire: false, ads: false,
    interact: false, grenade: false,
  };

  const state = {
    // Accumulated look delta, drained once per frame by the camera. The mouse
    // writes counts into these; the pad converts its rate into the same counts
    // before adding, so the frame loop drains ONE number and neither device is
    // a special case downstream.
    dx: 0,
    dy: 0,

    locked: false,
    fallback: false,   // true when pointer lock was denied and we read raw moves
    active: false,     // true once the player has entered the game

    /**
     * True while the pause menu is up.
     *
     * Everything below reads this and does nothing, which is not the same as
     * the frame loop skipping the simulation. A held W with the menu open would
     * otherwise sit in `keys` and the player would walk the moment they hit
     * Resume; a held mouse button in FALLBACK mode - where there is no pointer
     * lock to lose - would keep accumulating look delta while they read the
     * settings, and the whole lot would arrive in one frame on resume.
     *
     * It is also what puts the PAD into menu mode. See pollPad().
     */
    suspended: false,

    /**
     * How many times pointer lock has been ASKED for.
     *
     * A counter rather than a boolean because the interesting question is
     * whether the request was made at all. Chrome refuses a re-lock for about a
     * second after Esc released the last one, so "Resume asked for the mouse
     * back" and "the browser gave it back" are two different facts and the
     * harness has to be able to tell them apart.
     */
    lockRequests: 0,
  };

  /**
   * The shared fields, as accessors over the two records above.
   *
   * Defined rather than declared so that `state.fire = true` - which
   * test/economy.mjs, test/interior.mjs, test/gun.mjs and test/b3ar.mjs all do,
   * and which onMouseDown below does - still means "the mouse is holding the
   * trigger" and cannot silently clobber what the pad is doing. Enumerable and
   * configurable, so `'grenade' in input.state` and every other reflective
   * check in the suites reads exactly as it did.
   */
  const bools = ['sprint', 'jump', 'fire', 'ads', 'interact', 'grenade'];
  for (const name of bools) {
    Object.defineProperty(state, name, {
      enumerable: true,
      configurable: true,
      get() { return kb[name] || pad[name]; },
      set(v) { kb[name] = !!v; },
    });
  }

  for (const name of ['forward', 'strafe']) {
    Object.defineProperty(state, name, {
      enumerable: true,
      configurable: true,
      // SUM AND CLAMP, not "whichever is bigger". Two devices asking for
      // opposite things should cancel: a player leaning on W who pulls the
      // stick back is asking to stop, and a max-by-magnitude rule would have to
      // pick a winner and would pick a different one depending on how far the
      // stick had travelled.
      get() { return clamp(kb[name] + pad[name], -1, 1); },
      set(v) { kb[name] = Number(v) || 0; },
    });
  }

  const oneShot = new Set();   // keys consumed exactly once per press

  /**
   * WHICH DEVICE THE PLAYER'S HAND IS ON, most recently.
   *
   * Used for exactly one decision - whether engage() should probe for pointer
   * lock - and never for gating input, because gating input on a mode is the
   * bug this whole file is written to avoid. Updated only from TRUSTED events,
   * so the synthetic keystrokes the pad dispatches below cannot make the game
   * think a keyboard was touched.
   */
  let lastDevice = 'none';

  // -------------------------------------------------------------------------
  // keyboard
  // -------------------------------------------------------------------------

  const onKeyDown = (e) => {
    if (e.isTrusted) lastDevice = 'key';
    if (e.repeat) return;
    if (state.suspended) return;
    keys.add(e.code);
    oneShot.add(e.code);
    // Space scrolls the page, and the number row can trigger browser UI.
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    syncAxes();
  };

  const onKeyUp = (e) => {
    keys.delete(e.code);
    syncAxes();
  };

  function syncAxes() {
    kb.forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    kb.strafe  = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    kb.sprint  = keys.has('ShiftLeft') || keys.has('ShiftRight');
    kb.jump    = keys.has('Space');
    kb.interact = keys.has('KeyF');
    kb.grenade = keys.has('KeyG');
  }

  // -------------------------------------------------------------------------
  // mouse
  // -------------------------------------------------------------------------

  const onMouseMove = (e) => {
    if (e.isTrusted) lastDevice = 'mouse';
    if (!state.active || state.suspended) return;
    // In fallback mode only look while a button is held, otherwise the camera
    // spins whenever the cursor crosses the page.
    if (state.fallback && e.buttons === 0) return;
    if (!state.locked && !state.fallback) return;

    state.dx += e.movementX || 0;
    state.dy += e.movementY || 0;
  };

  const onMouseDown = (e) => {
    if (e.isTrusted) lastDevice = 'mouse';
    if (!state.active || state.suspended) return;
    if (e.button === 0) kb.fire = true;
    if (e.button === 2) kb.ads = true;
  };

  const onMouseUp = (e) => {
    if (e.button === 0) kb.fire = false;
    if (e.button === 2) kb.ads = false;
  };

  const onContextMenu = (e) => e.preventDefault();

  const onLockChange = () => {
    state.locked = document.pointerLockElement === canvas;
    if (state.locked) state.fallback = false;
  };

  // -------------------------------------------------------------------------
  // wiring
  // -------------------------------------------------------------------------

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('pointerlockchange', onLockChange);

  // Releasing focus should not leave the player sprinting forever.
  window.addEventListener('blur', () => { keys.clear(); syncAxes(); });

  // -------------------------------------------------------------------------
  // the pad
  // -------------------------------------------------------------------------

  const reader = createPadReader();

  /**
   * THE PLAYER'S PAD SETTINGS, live for the session.
   *
   * In memory and not persisted, for the same documented reason every other
   * setting in this game is: STATE.md and the README both carry a standing "no
   * browser storage" constraint. ui/pause.js reads and writes these through the
   * same declarative row spec the mouse sensitivity uses, so there is one
   * writer and the panel cannot drift from the value in force.
   */
  const padSettings = {
    sensitivity: PAD_DEFAULTS.sensitivity,
    deadzone: PAD_DEFAULTS.deadzone,
    exponent: PAD_DEFAULTS.exponent,
    /**
     * The PAD's invert, which is its own setting and not the mouse's.
     *
     * A player who inverts the stick has not asked to invert the mouse, and the
     * two are separate rows in every console shooter that offers both. Because
     * the pad's look is fed through the same camera call the mouse uses - and
     * that call applies the rig's own invert - the rig's flip is CANCELLED at
     * the point of conversion below so that this flag is absolute rather than
     * something that exclusive-ors with another control on the same panel.
     */
    invertY: PAD_DEFAULTS.invertY,
    rumble: true,

    /**
     * SWAP THE BUMPERS WITH THE TRIGGERS. Off by default.
     *
     * The default puts fire and aim on the triggers, which is what a modern
     * console shooter does and what most hands expect. It is not what every hand
     * expects: players who came up on Bumper Jumper, or who find the DualShock's
     * long trigger throw slow for a weapon that wants a fast trigger, put fire
     * on R1 and live with grenades on R2.
     *
     * IT IS NOT A RELABELLING. The two pairs are different KINDS of input and
     * swapping them swaps that too. The triggers are analog and run through a
     * two-threshold hysteresis so a spring resting on one number cannot chatter;
     * the bumpers are plain digital switches. So a swap has to move the
     * hysteresis with the action rather than the button - fire on a bumper reads
     * the switch, and the grenade on a trigger reads the LATCH, not the raw
     * analog value. Getting that backwards gives you a grenade that starts
     * cooking from the weight of a resting finger.
     */
    swapBumpers: false,
  };

  /** The last poll's snapshot, exposed so a harness can see what was read. */
  let snapshot = null;

  /**
   * Sprint, LATCHED, and this is a real design decision rather than a shortcut.
   *
   * Holding a stick clicked while also steering it is genuinely unpleasant over
   * a long wave. So the click latches sprint on and the latch clears when the
   * left stick comes back to centre, which is what "sprint until you stop"
   * means on a pad. Nothing about the keyboard's Shift changes.
   *
   * ON R3, THE RIGHT STICK, at the owner's request. L3 is the more common
   * console default and it was the first binding here, but it asks the thumb
   * that is STEERING to also press, and the click nudges the aim every time.
   * R3 is the aim stick, so the same objection applies in principle - except
   * that sprinting is something you do while running in a straight line and
   * aiming is not, so in practice the two rarely collide. It is the owner's
   * hands that decide this one.
   *
   * R3 used to be a second binding for the khopesh. The khopesh keeps L1, which
   * was always its primary.
   */
  let sprintLatch = false;

  /**
   * Last frame's khopesh input, for the rising edge.
   *
   * Needed only because the swap can put the khopesh on L2, which is analog and
   * has no entry in snap.pressed. Tracked unconditionally rather than only when
   * swapped, so that toggling the setting mid-run cannot leave a stale value
   * that fires one phantom swing.
   */
  let meleeWasHeld = false;

  /** Menu repeat, one per axis, so up-down and left-right time independently. */
  const repeatV = createRepeater();
  const repeatH = createRepeater();

  /** Which generation of pad we last greeted, so a reconnect is felt once. */
  let greeted = 0;

  /**
   * Menu subscribers.
   *
   * ui/pause.js registers here rather than this file importing the panel,
   * because input must not know that a settings panel exists. A subscriber
   * returns true to say it CONSUMED the action; when nobody does, the fallbacks
   * in emitMenu() fire instead, which is what makes the death card - a surface
   * this file has never heard of - answer to the pad's confirm button.
   */
  const menuSubs = new Set();

  /**
   * Dispatch a real DOM key event for an action this file does not own.
   *
   * Reload, inspect, melee, interact, the weapon digits and the pause key are
   * all bound in main.js against raw window keydown events, deliberately and
   * with a comment saying why. The pad therefore speaks the SAME events rather
   * than reaching into those systems: one binding table, no second copy to
   * drift, and any binding added there later works on the pad for free.
   *
   * The alternative was a dozen new lines in main.js calling weapons.reload()
   * and melee.swing() directly, which would mean every action in the game
   * having two places that can trigger it. That is exactly the arrangement that
   * produced a controls list with no entry for the khopesh.
   *
   * `isTrusted` is false on these, which is what keeps lastDevice honest, and
   * they are dispatched on `window` so that main.js's start-screen handler sees
   * a target that is not a BUTTON and proceeds.
   */
  function tap(code) {
    const init = {
      code,
      key: KEY_FOR[code] || code,
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent('keydown', init));
    window.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  /** The wheel, for weapon cycling, which main.js binds the same raw way. */
  function wheel(delta) {
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true }));
  }

  function emitMenu(action) {
    for (const fn of menuSubs) {
      try { if (fn(action) === true) return true; } catch { /* a subscriber must not break input */ }
    }

    // Nobody claimed it. Confirm and back still have to do something, because
    // the surface in front of the player might be the death card, which reads
    // Enter directly and knows nothing about any of this.
    if (action === 'accept') { tap('Enter'); return true; }
    if (action === 'back') { tap('Escape'); return true; }
    return false;
  }

  /** Turn an axis into -1, 0 or +1 with the menu's own hysteresis. */
  function menuAxis(v, prev) {
    if (v >= MENU.on) return 1;
    if (v <= -MENU.on) return -1;
    if (Math.abs(v) <= MENU.off) return 0;
    return prev;
  }
  let menuV = 0;
  let menuH = 0;

  function clearPad() {
    pad.forward = pad.strafe = 0;
    pad.sprint = pad.jump = pad.fire = pad.ads = false;
    pad.interact = pad.grenade = false;
    sprintLatch = false;
    // Cleared with the rest, so a pad that goes away mid-swing does not come
    // back holding an edge and throw one phantom khopesh.
    meleeWasHeld = false;
  }

  /**
   * ONE POLL, ONCE PER FRAME, AND IT RUNS WHILE THE GAME IS PAUSED.
   *
   * That last part is the whole reason main.js calls this ABOVE the pause guard
   * rather than inside the simulation block. A pause menu that cannot be
   * operated from the pad strands a controller player at the first press of
   * Options: they can stop the game and cannot start it again without reaching
   * for a keyboard, which is worse than not having supported the pad at all.
   * So the poll always happens and the MODE changes: gameplay when running,
   * menu navigation when suspended, and one confirm binding on the title screen
   * so the run can be started without touching anything.
   *
   * @param {object} [rig]   player/camera.js. Two numbers are read off it and
   *                         nothing is written. See the conversion note below.
   * @param {number} [dt]    seconds. main.js passes the loop's own RAW delta so
   *                         there is one clock in the game; the harness passes
   *                         an explicit delta to prove the rate maths.
   */
  function pollPad(rig, dt) {
    const snap = reader.poll(dt);
    snapshot = snap;

    if (!snap) {
      clearPad();
      repeatV.reset();
      repeatH.reset();
      menuV = menuH = 0;
      return null;
    }

    if (snap.generation !== greeted) {
      greeted = snap.generation;
      // A short pulse on connect. It is the only feedback in the game that says
      // "the pad is talking to the page", and without it a player whose pad is
      // asleep has no way to tell that from a game that ignores pads.
      if (padSettings.rumble) reader.rumble(0.35, 0.20, 90);
    }

    const t = snap.dt;

    // ----------------------------------------------------------------------
    // TITLE. Nothing has started, so the only verb is "begin".
    // ----------------------------------------------------------------------
    if (!state.active) {
      clearPad();
      if (state.suspended) return menuMode(snap, t);   // settings, from the title
      if (snap.pressed.includes('cross') || snap.pressed.includes('options')) {
        // main.js starts the run on Enter as well as on the button, and takes
        // the same path either way. See the pointer-lock note at the top of
        // this file for what happens to the lock request that follows.
        lastDevice = 'pad';
        tap('Enter');
      }
      return snap;
    }

    // ----------------------------------------------------------------------
    // MENU. The panel is up, or the death card is.
    // ----------------------------------------------------------------------
    if (state.suspended) {
      clearPad();
      return menuMode(snap, t);
    }

    // ----------------------------------------------------------------------
    // GAME.
    // ----------------------------------------------------------------------
    repeatV.reset();
    repeatH.reset();
    menuV = menuH = 0;

    if (padTouched(snap)) lastDevice = 'pad';

    // --- look ---------------------------------------------------------------
    //
    // THE CONVERSION, AND WHY IT DIVIDES.
    //
    // rig.look() multiplies whatever it is given by `rig.sensitivity`, which is
    // radians per mouse count and is what the MOUSE sensitivity slider moves.
    // Handing it raw radians would make the pad four times faster at a mouse
    // setting of 2.00 than at 0.50 - two sliders on one panel silently
    // multiplying each other, which is the exact fault the FOV and sensitivity
    // rows were rewritten to stop. Dividing by the same number cancels it
    // exactly, so the pad's speed is a function of the PAD's slider alone.
    //
    // What survives the cancellation, deliberately, is the frame loop's zoom
    // scale: main.js calls rig.look with 0.35 + 0.65 * fovNormalized, so the
    // stick slows down at full ADS by the same ratio the mouse does. That is
    // correct - at a narrower field of view the same angle covers more screen -
    // and it means the rates named in gamepad.js are HIP rates.
    const radPerCount = (rig && rig.sensitivity) || 0.0022;
    const rigInverts = !!(rig && rig.invertY);

    const look = lookDelta(snap.raw.rx, snap.raw.ry, t, {
      deadzone: padSettings.deadzone,
      exponent: padSettings.exponent,
      sensitivity: padSettings.sensitivity,
      yawRate: PAD_DEFAULTS.yawRate,
      pitchRate: PAD_DEFAULTS.pitchRate,
      // Cancel the rig's own flip so the pad row on the settings panel is an
      // absolute statement rather than one that exclusive-ors with the mouse
      // row above it. See padSettings.invertY.
      invertY: padSettings.invertY !== rigInverts,
    });

    state.dx += look.dxRad / radPerCount;
    state.dy += look.dyRad / radPerCount;

    // --- move ---------------------------------------------------------------
    //
    // The same radial deadzone and the same curve as the look stick. The curve
    // is arguably wasted here - see the note in ui/pause.js - because
    // player/controller.js NORMALISES the wish vector, so the magnitude is
    // thrown away and there is no analog walk. Direction is what survives, and
    // shaping it costs nothing and keeps one rule for both sticks.
    const move = shapeStick(snap.raw.lx, snap.raw.ly, padSettings.deadzone, padSettings.exponent);
    pad.strafe = move.x;
    pad.forward = -move.y;         // a stick reports negative for up

    // Sprint latches on the click of R3 and clears when the stick comes home.
    if (snap.pressed.includes('r3')) sprintLatch = true;
    if (move.mag === 0) sprintLatch = false;
    pad.sprint = sprintLatch;

    /**
     * RESOLVE THE FOUR SHOULDER INPUTS ONCE, HERE, BEFORE ANYTHING READS THEM.
     *
     * The swap moves an ACTION between two different kinds of input, so each
     * action has to take the reading that suits where it now lives:
     *
     *   default   fire and aim on the TRIGGERS, so they take the hysteresis
     *             latches (snap.fire / snap.ads). Grenade on R1 and khopesh on
     *             L1 take the plain switches.
     *
     *   swapped   fire and aim on the BUMPERS, so they take the switches
     *             directly - a switch needs no hysteresis, it has one built in.
     *             Grenade moves to R2 and takes the LATCH rather than the raw
     *             analog value, because a fuse that starts on the weight of a
     *             resting finger is a grenade the player did not throw.
     *
     * The khopesh is a TAP and so needs an EDGE. On L1 the edge is already in
     * snap.pressed; on L2 there is no such list, so the latch's own rising edge
     * is tracked here. That asymmetry is the whole reason this is resolved in
     * one place instead of being scattered through the switch below.
     */
    const swap = padSettings.swapBumpers;
    const meleeHeld = swap ? snap.ads : snap.buttons.l1;
    const meleeEdge = meleeHeld && !meleeWasHeld;
    meleeWasHeld = meleeHeld;

    // --- the held actions ---------------------------------------------------
    pad.jump = snap.buttons.cross;
    pad.fire = swap ? snap.buttons.r1 : snap.fire;
    pad.ads = swap ? snap.buttons.l1 : snap.ads;
    // HELD, exactly as KeyG is. systems/grenades.js runs the fuse while this is
    // true and throws on the release, so a one-shot binding here would give the
    // player a timer they cannot see and cannot stop.
    pad.grenade = swap ? snap.fire : snap.buttons.r1;
    pad.interact = snap.buttons.circle;

    // The khopesh, wherever it currently lives. See the resolution above.
    if (meleeEdge) tap('KeyQ');

    // --- the tapped actions -------------------------------------------------
    for (const name of snap.pressed) {
      switch (name) {
        case 'square': tap('KeyR'); break;                 // reload
        case 'circle': tap('KeyF'); break;                 // buy, open, use
        case 'up': tap('KeyV'); break;                     // inspect
        case 'triangle': wheel(100); break;                // swap weapon
        case 'right': wheel(100); break;
        case 'left': wheel(-100); break;
        case 'options': tap('Escape'); break;              // pause
        default: break;
      }
    }

    return snap;
  }

  /** Has anything on the pad moved enough to call it the player's hand. */
  function padTouched(snap) {
    if (snap.pressed.length) return true;
    const r = snap.raw;
    return Math.hypot(r.lx, r.ly) > padSettings.deadzone
      || Math.hypot(r.rx, r.ry) > padSettings.deadzone;
  }

  /**
   * The pad while a menu is up.
   *
   * Both the D-pad and the left stick drive the same four directions, because a
   * player reaching for a menu uses whichever is under their thumb and finding
   * that one of them does nothing reads as the menu being half wired.
   */
  function menuMode(snap, t) {
    const b = snap.buttons;

    menuV = menuAxis(snap.raw.ly, menuV);
    menuH = menuAxis(snap.raw.lx, menuH);

    const digitalV = (b.down ? 1 : 0) - (b.up ? 1 : 0);
    const digitalH = (b.right ? 1 : 0) - (b.left ? 1 : 0);

    const v = repeatV.step(digitalV !== 0 ? digitalV : menuV, t);
    const h = repeatH.step(digitalH !== 0 ? digitalH : menuH, t);

    if (v > 0) emitMenu('down');
    else if (v < 0) emitMenu('up');

    if (h > 0) emitMenu('right');
    else if (h < 0) emitMenu('left');

    for (const name of snap.pressed) {
      if (name === 'cross') emitMenu('accept');
      else if (name === 'circle' || name === 'options') emitMenu('back');
      else if (name === 'l1') emitMenu('tabPrev');
      else if (name === 'r1') emitMenu('tabNext');
    }

    return snap;
  }

  /** The lock request itself, shared by engage() and relock(). */
  function requestLock() {
    state.lockRequests++;
    try {
      const p = canvas.requestPointerLock?.({ unadjustedMovement: true });
      // Chrome returns a promise for the options form; older paths return
      // undefined. Swallow rejection, the probe below is the real check.
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Older browsers throw on the options argument. Retry bare.
      try { canvas.requestPointerLock?.(); } catch {}
    }
  }

  return {
    state,

    /**
     * Request pointer lock. If it has not engaged within LOCK_TIMEOUT_MS,
     * assume it was denied (iframe, permissions policy) and switch to reading
     * raw mouse deltas so the game stays playable either way.
     *
     * `probe` is that timeout, and it is now optional for TWO reasons.
     *
     * A RE-lock is not evidence about whether pointer lock is available.
     * Chrome refuses requestPointerLock for roughly a second after Esc released
     * the last one, so a Resume button that called the probing form would time
     * out on a perfectly healthy browser, flip `fallback` true, and tell the
     * player to hold a mouse button to look for the rest of the session. The
     * probe is a decision made once, at boot, about whether the API works here
     * at all; every re-acquisition after that goes through relock().
     *
     * AND A RUN STARTED FROM THE PAD IS NOT EVIDENCE EITHER. Pointer lock needs
     * a transient user activation and a synthetic key event does not carry one,
     * so the request is refused for a reason that has nothing to do with the
     * page. Probing there would put a controller player into the iframe
     * fallback and print a notice about mouse buttons at somebody holding a
     * DualShock. The pad does not need the lock, so its absence is not a fault
     * worth reporting - and a later real click on the canvas takes the ordinary
     * relock() path and hands the mouse back.
     *
     * @param {{probe?: boolean}} opts
     */
    engage(opts = {}) {
      const probe = opts.probe !== false && lastDevice !== 'pad';
      state.active = true;

      requestLock();

      if (!probe) return;

      setTimeout(() => {
        if (document.pointerLockElement !== canvas) {
          state.fallback = true;
        }
      }, LOCK_TIMEOUT_MS);
    },

    /**
     * Ask for the mouse back after the menu let it go.
     *
     * Never probes, and never runs in fallback mode - there is no lock to
     * re-acquire there, and asking would only re-arm a decision that has
     * already been made.
     */
    relock() {
      if (state.fallback) return false;
      state.active = true;
      requestLock();
      return true;
    },

    /**
     * Freeze the input layer while the pause menu is up.
     *
     * Clears rather than merely gates: a key that was down when the menu opened
     * must not still be down when it closes, and any look delta accumulated on
     * the way in must not arrive as one enormous frame on the way out. This is
     * the input-side twin of the frame loop's delta clamp.
     *
     * The pad is cleared by the same call and for the same reason. A trigger
     * held at the moment Options was pressed would otherwise still be held on
     * resume, and the player would come back out of the settings panel firing.
     */
    setSuspended(on) {
      state.suspended = !!on;
      if (!state.suspended) return state.suspended;
      keys.clear();
      oneShot.clear();
      syncAxes();
      clearPad();
      state.dx = state.dy = 0;
      kb.fire = false;
      kb.ads = false;
      return state.suspended;
    },

    /** Drain accumulated mouse and stick movement. Call once per frame. */
    consumeLook() {
      const d = { dx: state.dx, dy: state.dy };
      state.dx = state.dy = 0;
      return d;
    },

    /** True exactly once per physical key press. */
    pressed(code) {
      if (oneShot.has(code)) { oneShot.delete(code); return true; }
      return false;
    },

    held(code) { return keys.has(code); },

    /** Which device the player's hand was on last. Diagnostic only. */
    get lastDevice() { return lastDevice; },

    // ----------------------------------------------------------------------
    // the pad, as seen from outside
    // ----------------------------------------------------------------------

    pollPad,

    /**
     * Subscribe to menu actions. Returns an unsubscribe.
     *
     * The subscriber returns true when it has consumed the action. See
     * emitMenu(): anything unclaimed falls through to a synthetic Enter or
     * Escape, which is how surfaces that predate the pad keep working.
     */
    onMenu(fn) {
      if (typeof fn !== 'function') return () => {};
      menuSubs.add(fn);
      return () => menuSubs.delete(fn);
    },

    /**
     * Everything ui/pause.js needs, and everything the console needs to answer
     * "is the controller actually being read".
     */
    pad: {
      get connected() { return reader.connected; },
      get sensitivity() { return padSettings.sensitivity; },
      setSensitivity(v) {
        padSettings.sensitivity = clamp(Number(v) || 0, PAD_LIMITS.sensMin, PAD_LIMITS.sensMax);
        return padSettings.sensitivity;
      },

      get deadzone() { return padSettings.deadzone; },
      setDeadzone(v) {
        padSettings.deadzone = clamp(Number(v) || 0, PAD_LIMITS.deadzoneMin, PAD_LIMITS.deadzoneMax);
        return padSettings.deadzone;
      },

      get exponent() { return padSettings.exponent; },
      setExponent(v) {
        padSettings.exponent = clamp(Number(v) || 1, PAD_LIMITS.exponentMin, PAD_LIMITS.exponentMax);
        return padSettings.exponent;
      },

      get invertY() { return padSettings.invertY; },
      setInvertY(on) { padSettings.invertY = !!on; return padSettings.invertY; },

      get swapBumpers() { return padSettings.swapBumpers; },
      setSwapBumpers(on) {
        padSettings.swapBumpers = !!on;
        // Drop anything currently held on a shoulder button. Toggling this with
        // a finger down would otherwise carry that hold across to whatever the
        // button now means - most visibly as a grenade that starts cooking the
        // instant the setting changes, from a trigger the player was only
        // resting on.
        pad.fire = pad.ads = pad.grenade = false;
        meleeWasHeld = false;
        return padSettings.swapBumpers;
      },

      get rumbleEnabled() { return padSettings.rumble; },
      setRumble(on) {
        padSettings.rumble = !!on;
        // Fire one immediately when it is switched on. A rumble setting whose
        // effect cannot be felt until something explodes is a setting the
        // player has to take on trust.
        if (padSettings.rumble) reader.rumble(0.5, 0.3, 140);
        return padSettings.rumble;
      },

      /**
       * Shake the pad. Exposed for main.js to call on damage or on a kill; see
       * the patch note in the report. Silent and false when there is no pad, no
       * actuator, or the player has turned it off.
       */
      rumble(strong, weak, ms) {
        if (!padSettings.rumble) return false;
        return reader.rumble(strong, weak, ms);
      },

      /** The look rates in force, in degrees per second, for the panel. */
      rates() {
        return {
          yaw: degPerSecond(PAD_DEFAULTS.yawRate, padSettings.sensitivity),
          pitch: degPerSecond(PAD_DEFAULTS.pitchRate, padSettings.sensitivity),
        };
      },

      /**
       * WHAT WAS ACTUALLY READ, and this is the one that matters.
       *
       * Printed in the settings panel and available in the console, because the
       * question "is the pad at index 0 or index 2, and did Chrome give it the
       * standard mapping" cannot be answered from the outside and is exactly
       * where a plausible-looking implementation reads nothing at all.
       */
      info() {
        return {
          connected: reader.connected,
          index: reader.index,
          id: reader.id,
          mapping: reader.mapping,
          profile: reader.profile,
          profileName: reader.profileName,
          assumed: reader.assumed,
          vibration: !!(snapshot && snapshot.vibration),
        };
      },

      /** The raw last poll. Diagnostic, and what test/gamepad.mjs asserts on. */
      get snapshot() { return snapshot; },
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerlockchange', onLockChange);
      menuSubs.clear();
    },
  };
}
