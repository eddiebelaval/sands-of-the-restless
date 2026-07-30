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
 */

const LOCK_TIMEOUT_MS = 400;

export function createInput(canvas) {
  const keys = new Set();

  const state = {
    forward: 0,
    strafe: 0,
    sprint: false,
    jump: false,
    fire: false,
    ads: false,
    interact: false,

    // HELD, not pressed. The grenade is the one action in the game whose input
    // has a duration: the fuse runs while the key is down, and releasing it is
    // the throw. A one-shot `pressed('KeyG')` would give the player a timer they
    // cannot see and cannot stop, which is the mechanic with the wager removed.
    grenade: false,

    // Accumulated mouse delta, drained once per frame by the camera.
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

  const oneShot = new Set();   // keys consumed exactly once per press

  // -------------------------------------------------------------------------
  // keyboard
  // -------------------------------------------------------------------------

  const onKeyDown = (e) => {
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
    state.forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    state.strafe  = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    state.sprint  = keys.has('ShiftLeft') || keys.has('ShiftRight');
    state.jump    = keys.has('Space');
    state.interact = keys.has('KeyF');
    state.grenade = keys.has('KeyG');
  }

  // -------------------------------------------------------------------------
  // mouse
  // -------------------------------------------------------------------------

  const onMouseMove = (e) => {
    if (!state.active || state.suspended) return;
    // In fallback mode only look while a button is held, otherwise the camera
    // spins whenever the cursor crosses the page.
    if (state.fallback && e.buttons === 0) return;
    if (!state.locked && !state.fallback) return;

    state.dx += e.movementX || 0;
    state.dy += e.movementY || 0;
  };

  const onMouseDown = (e) => {
    if (!state.active || state.suspended) return;
    if (e.button === 0) state.fire = true;
    if (e.button === 2) state.ads = true;
  };

  const onMouseUp = (e) => {
    if (e.button === 0) state.fire = false;
    if (e.button === 2) state.ads = false;
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
     * `probe` is that timeout, and it is now optional for ONE reason: a RE-lock
     * is not evidence about whether pointer lock is available. Chrome refuses
     * requestPointerLock for roughly a second after Esc released the last one,
     * so a Resume button that called the probing form would time out on a
     * perfectly healthy browser, flip `fallback` true, and tell the player to
     * hold a mouse button to look for the rest of the session. The probe is a
     * decision made once, at boot, about whether the API works here at all;
     * every re-acquisition after that goes through relock().
     *
     * @param {{probe?: boolean}} opts
     */
    engage(opts = {}) {
      const probe = opts.probe !== false;
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
     */
    setSuspended(on) {
      state.suspended = !!on;
      if (!state.suspended) return state.suspended;
      keys.clear();
      oneShot.clear();
      syncAxes();
      state.dx = state.dy = 0;
      state.fire = false;
      state.ads = false;
      return state.suspended;
    },

    /** Drain accumulated mouse movement. Call once per frame. */
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

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerlockchange', onLockChange);
    },
  };
}
