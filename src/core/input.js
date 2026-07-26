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

    // Accumulated mouse delta, drained once per frame by the camera.
    dx: 0,
    dy: 0,

    locked: false,
    fallback: false,   // true when pointer lock was denied and we read raw moves
    active: false,     // true once the player has entered the game
  };

  const oneShot = new Set();   // keys consumed exactly once per press

  // -------------------------------------------------------------------------
  // keyboard
  // -------------------------------------------------------------------------

  const onKeyDown = (e) => {
    if (e.repeat) return;
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
  }

  // -------------------------------------------------------------------------
  // mouse
  // -------------------------------------------------------------------------

  const onMouseMove = (e) => {
    if (!state.active) return;
    // In fallback mode only look while a button is held, otherwise the camera
    // spins whenever the cursor crosses the page.
    if (state.fallback && e.buttons === 0) return;
    if (!state.locked && !state.fallback) return;

    state.dx += e.movementX || 0;
    state.dy += e.movementY || 0;
  };

  const onMouseDown = (e) => {
    if (!state.active) return;
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

  return {
    state,

    /**
     * Request pointer lock. If it has not engaged within LOCK_TIMEOUT_MS,
     * assume it was denied (iframe, permissions policy) and switch to reading
     * raw mouse deltas so the game stays playable either way.
     */
    engage() {
      state.active = true;

      try {
        const p = canvas.requestPointerLock?.({ unadjustedMovement: true });
        // Chrome returns a promise for the options form; older paths return
        // undefined. Swallow rejection, the timeout below is the real check.
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        // Older browsers throw on the options argument. Retry bare.
        try { canvas.requestPointerLock?.(); } catch {}
      }

      setTimeout(() => {
        if (document.pointerLockElement !== canvas) {
          state.fallback = true;
        }
      }, LOCK_TIMEOUT_MS);
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
