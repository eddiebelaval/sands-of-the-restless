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

/**
 * THE BINDINGS, from the one table that owns them.
 *
 * This file used to spell them: `keys.has('KeyW')`, a CROUCH_KEYS array, and a
 * KEY_FOR lookup for the four codes the pad synthesises. Every one of those was
 * a second statement of a fact stated somewhere else, which is precisely how a
 * controls page ends up describing a scheme the game is not running. See
 * core/keymap.js. Nothing here caches a code: a rebind takes effect on the next
 * keystroke without this file being told.
 */
import { keymap, keyFor } from './keymap.js';

const LOCK_TIMEOUT_MS = 400;

/**
 * CROUCH IS A TAP RATHER THAN A HOLD, and the keys are keymap's to say.
 *
 * The default is C and the control keys, which is the pair every shooter on this
 * keyboard layout offers, because the two hands disagree about which one is
 * natural and the argument is older than the genre.
 *
 * A TAP because the PAD's crouch is a tap - L3 is under the thumb that steers,
 * and a held stick-click while steering is the input the sprint latch below was
 * already rewritten to avoid. Two devices with two different crouch semantics is
 * the drift this whole file is arranged to prevent, so the keyboard takes the
 * pad's shape rather than the other way round: one rule, both hands, and the
 * controls panel can state it in four words.
 */
const isCrouchKey = (code) => keymap.matches('crouch', code);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Keys the BROWSER does something with, which have to be swallowed when the
 * player has bound one of them to a verb.
 *
 * Space scrolls the page and Tab walks the focus ring, which is why those two
 * were always here. The arrows and the page keys join them the moment a rebind
 * can put movement on them: a player who binds forward to ArrowUp and finds the
 * settings panel scrolling underneath the game has been given a broken binding
 * rather than a new one. Nothing else is preventDefault'ed, because swallowing
 * keys the game does not use is how a page stops being usable with a keyboard.
 */
const BROWSER_KEYS = new Set([
  'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Home', 'End',
]);

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

  /**
   * CROUCH IS ONE LATCH SHARED BY BOTH DEVICES, and it is the one field in this
   * file that is deliberately NOT a kb/pad pair.
   *
   * Everything else here is a held input, so a pair combined with OR is the
   * right reading: two hands asking for the trigger is one shot. Crouch is a
   * POSTURE toggled by a TAP, and a pair would give the player two independent
   * postures - tap C to crouch, tap L3 expecting to stand, and stand up
   * according to the pad while the keyboard still says crouched, so the OR
   * keeps you down and the button reads as broken. One latch, flipped by an
   * edge from whichever device produced it, is the only arrangement in which
   * the second device can undo what the first one did.
   *
   * It survives setSuspended() for the same reason: a posture is not a held
   * key. A player who crouches, opens the settings panel and resumes is still
   * crouching, exactly as they are still holding the weapon they had out.
   */
  let crouchLatch = false;

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

    /**
     * The crouch posture, as an ordinary readable and writable field.
     *
     * Defined here rather than in the `bools` loop below because it reads from
     * the single latch above instead of from a kb/pad pair. The SETTER is not
     * decoration: player/controller.js clears it at the end of a slide, which
     * is what turns "tap crouch while sprinting" into slide-and-stand rather
     * than slide-and-crawl. See the note on the slide in that file.
     */
    get crouch() { return crouchLatch; },
    set crouch(v) { crouchLatch = !!v; },
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

    // The crouch toggle, on the DOWN edge only. `e.repeat` has already returned
    // above, so a held C cannot flip the posture sixty times a second - which is
    // what a toggle bound to a held key looks like, and it looks like the camera
    // vibrating rather than like a bug in an input file.
    if (isCrouchKey(e.code)) crouchLatch = !crouchLatch;

    // Space scrolls the page, Tab walks the focus ring, and a rebind can put a
    // verb on either. Tab is swallowed whether or not it is bound, exactly as it
    // always has been; everything else only when the player has claimed it.
    if (e.code === 'Tab' || (BROWSER_KEYS.has(e.code) && keymap.actionFor(e.code))) {
      e.preventDefault();
    }
    syncAxes();
  };

  const onKeyUp = (e) => {
    keys.delete(e.code);
    syncAxes();
  };

  /**
   * Held, by ACTION rather than by key.
   *
   * An action can own more than one key - both Shifts sprint on the shipped
   * scheme - so this is an any-of over the codes in force at the moment the
   * question is asked. Asked fresh every time rather than cached at boot,
   * because the whole point of the table is that a binding can move while the
   * game is running and nothing downstream should have to be told.
   */
  const heldAction = (id) => {
    for (const code of keymap.codes(id)) if (keys.has(code)) return true;
    return false;
  };

  function syncAxes() {
    kb.forward = (heldAction('forward') ? 1 : 0) - (heldAction('back') ? 1 : 0);
    kb.strafe  = (heldAction('right') ? 1 : 0) - (heldAction('left') ? 1 : 0);
    kb.sprint  = heldAction('sprint');
    kb.jump    = heldAction('jump');
    kb.interact = heldAction('interact');
    kb.grenade = heldAction('grenade');
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
   * SETTING in this game is: STATE.md and the README both carry a standing "no
   * browser storage" constraint. ui/pause.js reads and writes these through the
   * same declarative row spec the mouse sensitivity uses, so there is one
   * writer and the panel cannot drift from the value in force.
   *
   * The BINDINGS are the exception the owner asked for and they are not here -
   * they live in core/keymap.js, which is the only thing in this game that
   * writes to storage. That is also why `swapBumpers` is gone from this object:
   * it was never a setting, it was four bindings wearing a boolean, and it is
   * four rows in the pad's table now.
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
  };

  /**
   * WHICH BUTTON, ASKED OF THE MAP, AND WHY THE TRIGGERS NEED NO SPECIAL CASE.
   *
   * The swap used to be resolved here, by hand, with a long note about the two
   * pairs being different KINDS of input: the triggers are analog and run
   * through a two-threshold hysteresis so a spring resting on one number cannot
   * chatter, and the bumpers are plain switches. Fire on a bumper had to read
   * the switch and a grenade on a trigger had to read the LATCH rather than the
   * raw analog value, or the fuse started on the weight of a resting finger.
   *
   * That distinction has not gone away; it has moved to where it belongs.
   * core/gamepad.js writes the hysteresis latch INTO `buttons.r2` and
   * `buttons.l2` before the snapshot leaves it, so every button in the snapshot
   * is a clean digital state and the edge list is computed from all of them
   * alike. Which means a general map can be read the obvious way - is any button
   * this action is bound to down - and there is no arrangement of bindings that
   * needs a special case. That is the whole reason the swap could stop being a
   * flag and become four rows in a table.
   */
  const padHeld = (snap, id) => {
    for (const b of keymap.pad.codes(id)) if (snap.buttons[b]) return true;
    return false;
  };

  /** The same question about the rising edge, for the taps. */
  const padEdge = (snap, id) => {
    for (const b of keymap.pad.codes(id)) if (snap.pressed.includes(b)) return true;
    return false;
  };

  /** The last poll's snapshot, exposed so a harness can see what was read. */
  let snapshot = null;

  /**
   * ---------------------------------------------------------------------------
   * IS THERE AN INTERACT PROMPT ON SCREEN, and why this file asks the SCREEN.
   * ---------------------------------------------------------------------------
   *
   * Square is contextual: it interacts when the player is standing in front of
   * something they can buy, open or use, and reloads the rest of the time. That
   * is not a compromise forced by running out of buttons, it is what every
   * console shooter in this genre does, and it works because the two are almost
   * never both wanted - you are not reloading while pressed against a wall buy,
   * and when you are, THE PROMPT IS ON THE SCREEN and the player's intent is not
   * in doubt. The prompt is the contract, so the prompt is what gets asked.
   *
   * The authority on that question is ui/prompt.js's bus, which arbitrates
   * systems/doors.js and ui/interact.js and paints one line. This file has no
   * business importing either of those - input must not know that a shop exists,
   * for the same reason it does not import the settings panel - so it reads the
   * ARTEFACT instead: the `on` class the bus puts on the prompt element. That is
   * the same single fact both systems already agree on, it is true exactly when
   * a prompt is visible to the player, and it costs one classList read on the
   * frames where Square is actually pressed.
   *
   * A DENIED prompt - the red "come back richer" - still counts as a prompt, and
   * that is deliberate. The player is looking at a thing, they pressed the
   * button, and the game refuses them at the thing. Falling through to a reload
   * there would answer a question they did not ask.
   *
   * setPromptProbe() lets main.js hand over the authoritative predicate
   * (`interacts.candidate || doors.candidate`) if it would rather not route this
   * through the DOM. The default is written to be correct without that patch, so
   * the binding is not waiting on another file to become real.
   */
  let promptEl;
  let promptProbe = () => {
    if (promptEl === undefined) promptEl = document.getElementById('prompt');
    return !!promptEl && promptEl.classList.contains('on');
  };

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

  /**
   * THE PANEL, WAITING FOR A BUTTON.
   *
   * ui/pause.js arms this while a pad row is being rebound, and it is the exact
   * mirror of the keyboard's capture-phase keydown listener: for as long as it
   * is set, the next button the player presses is DELIVERED TO THE PANEL AND
   * CONSUMED rather than steering the menu. Without the consume, the button that
   * is being bound would also move the cursor or resume the game on its way
   * past, which is the same defect the keyboard capture stops by calling
   * stopImmediatePropagation.
   *
   * It only ever runs while the game is suspended - there is no way to reach the
   * controls page otherwise - and it is cleared the moment the capture ends, so
   * a panel that is torn down mid-capture cannot leave the pad talking to a row
   * that no longer exists.
   */
  let padCapture = null;

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
    if (!code) return false;
    const init = {
      code,
      key: keyFor(code),
      bubbles: true,
      cancelable: true,
    };
    window.dispatchEvent(new KeyboardEvent('keydown', init));
    window.dispatchEvent(new KeyboardEvent('keyup', init));
    return true;
  }

  /**
   * The same thing, addressed by ACTION, which is what every call site here
   * actually means.
   *
   * This is the line that keeps the pad honest across a rebind. Square used to
   * dispatch a literal 'KeyR' for reload; on a build where the player has moved
   * reload to M, that event would arrive at a handler that no longer answers to
   * it and the pad's reload would silently stop working - with the keyboard
   * still reloading fine, which is the hardest possible version of this bug to
   * find. Resolving through the table means the pad speaks whatever the keyboard
   * currently speaks.
   *
   * An UNBOUND action - which only a hand-edited saved map can produce - is a
   * no-op rather than a dispatch of `undefined`.
   */
  function tapAction(id) {
    return tap(keymap.primary(id));
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

    // Sprint latches on the click of its button and clears when the stick comes
    // home. R3 by default, at the owner's request; the player may move it.
    if (padEdge(snap, 'sprint')) sprintLatch = true;
    if (move.mag === 0) sprintLatch = false;
    pad.sprint = sprintLatch;

    /**
     * L3 IS CROUCH, AND IT IS ALSO SLIDE, AND THAT IS ONE BINDING NOT TWO.
     *
     * A slide is not its own verb here and must not become one. The pad has no
     * free button left - Square went contextual to make room for the khopesh on
     * Circle - and inventing a fourth binding for a movement the genre has
     * always spelled "crouch while already running" would be spending the last
     * button in the game on something the player already knows how to do.
     *
     * So this reports ONE thing: the posture flipped. player/controller.js is
     * the only file that knows how fast the body is travelling when it flips,
     * and it is therefore the only file that can decide whether a crouch is a
     * crouch or a slide. Input reports intent; the body decides what to do with
     * it. See the slide note in that file.
     */
    if (padEdge(snap, 'crouch')) crouchLatch = !crouchLatch;

    /**
     * THE KHOPESH, WHICH IS A TAP AND THEREFORE NEEDS AN EDGE OF ITS OWN.
     *
     * It is the one action with two buttons on it - Circle, which is its primary
     * binding at the owner's request, and a shoulder, which is what the muscle
     * memory in this build is already on. They are OR'd into ONE held value and
     * edged once, rather than edge-detected separately, so a hand resting on the
     * shoulder that also presses Circle gets one swing and not two. That is the
     * failure two independent edges would produce, and it would produce it
     * exactly in the panic the blade exists for.
     *
     * The held value is tracked across frames rather than read off snap.pressed
     * because the shoulder can be a TRIGGER after a swap. core/gamepad.js does
     * put trigger latches in the edge list, so snap.pressed would in fact work
     * now - this stays because it is the only reading that cannot care where the
     * binding moves to next, which is the whole point of the table.
     */
    const meleeHeld = padHeld(snap, 'melee');
    const meleeEdge = meleeHeld && !meleeWasHeld;
    meleeWasHeld = meleeHeld;

    // --- the held actions ---------------------------------------------------
    pad.jump = padHeld(snap, 'jump');
    pad.fire = padHeld(snap, 'fire');
    pad.ads = padHeld(snap, 'aim');
    // HELD, exactly as the grenade key is. systems/grenades.js runs the fuse
    // while this is true and throws on the release, so a one-shot binding here
    // would give the player a timer they cannot see and cannot stop.
    pad.grenade = padHeld(snap, 'grenade');

    /**
     * The interact FIELD, kept truthful even though nothing reads it.
     *
     * Square's actual effect is dispatched as a key event below, the same way
     * every other action this file does not own is - so this boolean is not
     * load-bearing. It is set anyway, because a state field that says `false`
     * while the player is buying a door is a lie sitting in the harness waiting
     * for the first person who trusts it.
     */
    pad.interact = padHeld(snap, 'interact') && promptProbe();

    // The khopesh, wherever it currently lives. See the resolution above.
    if (meleeEdge) tapAction('melee');

    // --- the tapped actions -------------------------------------------------
    //
    // The two that are BOUND are read as action edges, above the switch, so that
    // a player who has moved interact onto Triangle gets the interact and not
    // the weapon swap that used to live there. What is left in the switch is the
    // D-pad and Options, which are deliberately not movable: they are the menu's
    // own vocabulary. See PAD_ACTIONS in core/keymap.js.
    if (padEdge(snap, 'interact')) tapAction(promptProbe() ? 'interact' : 'reload');
    if (padEdge(snap, 'nextWeapon')) wheel(100);

    for (const name of snap.pressed) {
      switch (name) {
        /**
         * SQUARE, AND IT ASKS THE SCREEN WHAT IT MEANS.
         *
         * Interact when there is a prompt up, reload when there is not. See the
         * long note on promptProbe above for why the prompt is the condition and
         * why an ambiguous case is not really ambiguous.
         *
         * The interact and reload ACTIONS rather than calls to weapons.reload()
         * or interacts.interact(): main.js owns both bindings against raw
         * keydown events, and the whole point of tapAction() is that there is
         * exactly one binding table and the pad reads the player's edits to it
         * for free. In particular F's arbitration between a fixture and a
         * door lives in main.js and is subtle - a shrine that refuses must not
         * fall through and buy the door behind it - and a second copy of that
         * decision here is how the two would drift.
         */
        case 'up': tapAction('inspect'); break;            // inspect
        case 'right': wheel(100); break;
        case 'left': wheel(-100); break;
        case 'options': tapAction('pause'); break;         // pause
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

    // A row on the controls page is waiting for a button. The first press goes
    // to it and nothing else happens this frame; the sticks are ignored entirely
    // rather than bound, because a stick is not a binding and a player nudging
    // one while reaching for a button has not chosen anything.
    if (padCapture && snap.pressed.length) {
      const taken = padCapture(snap.pressed[0]);
      if (taken !== false) return snap;
    }

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
     * Replace the "is there an interact prompt up" predicate that Square reads.
     *
     * The default reads the prompt element's `on` class, which is true exactly
     * when the player can see a prompt and needs no cooperation from any other
     * file. main.js may hand over the authoritative form instead - the two
     * candidate records the prompt bus is arbitrating - if it would rather this
     * decision did not travel through the DOM. Passing anything that is not a
     * function restores the default rather than installing a predicate that
     * throws once a frame.
     *
     * @param {() => boolean} fn
     */
    setPromptProbe(fn) {
      if (typeof fn !== 'function') return false;
      promptProbe = () => {
        // A predicate that throws must not take the reload with it. A Square
        // that reloads is the safe half of this binding: it costs the player a
        // wasted animation, where a Square that does nothing costs them the
        // magazine they were trying to fill.
        try { return !!fn(); } catch { return false; }
      };
      return true;
    },

    /**
     * Hand the next pad BUTTON to a rebinding row instead of to the menu.
     *
     * Returns a disposer, exactly as onMenu does. Passing anything that is not a
     * function clears the capture rather than installing something that throws
     * once a frame, which on this path would be a controller that has stopped
     * answering with no error anywhere.
     *
     * @param {(button: string) => boolean} fn  return false to let the press
     *                                          fall through to the menu
     */
    setPadCapture(fn) {
      if (typeof fn !== 'function') { padCapture = null; return () => {}; }
      padCapture = fn;
      return () => { if (padCapture === fn) padCapture = null; };
    },

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

      /**
       * THE SHOULDER SWAP, WHICH IS NOW A VIEW OF THE MAP.
       *
       * It reads the four bindings rather than a boolean beside them, so the
       * setting cannot disagree with what the buttons do - which is the failure
       * that made this whole pass worth doing. A player who rebinds fire onto R1
       * by hand and leaves the rest alone gets Off here, correctly: the layout
       * this toggle describes is all four moved together, and reporting On for
       * one of them would be a control lying about a state.
       */
      get swapBumpers() { return keymap.pad.swapped; },
      setSwapBumpers(on) {
        keymap.pad.setSwapped(!!on);
        // Drop anything currently held on a shoulder button. Toggling this with
        // a finger down would otherwise carry that hold across to whatever the
        // button now means - most visibly as a grenade that starts cooking the
        // instant the setting changes, from a trigger the player was only
        // resting on.
        pad.fire = pad.ads = pad.grenade = false;
        meleeWasHeld = false;
        return keymap.pad.swapped;
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
