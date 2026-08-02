/**
 * THE CONTROL SCHEME, AS TABLES. ONE FOR THE KEYBOARD, ONE FOR THE PAD.
 *
 * Until this file existed the control scheme was a fact stated in five places
 * and owned by none of them: `e.code === 'KeyG'` in main.js, `keys.has('KeyW')`
 * in core/input.js, a `Digit([1-8])` regular expression, a hand-written list of
 * key caps in ui/pause.js, and a paragraph of bold letters in index.html. Every
 * one of those was individually correct on the day it was written, which is the
 * whole problem: the title card claimed weapons 1 to 7 for a week after the
 * eighth gun shipped, and nothing anywhere could tell, because there was no
 * single fact for it to disagree with.
 *
 * So there is one now. An ACTION has an id, a label, and a list of key codes.
 * The handler reads this table, the panel draws this table, the title card
 * prints this table, and the pad synthesises key events out of this table. A
 * binding changes in exactly one place and every surface that mentions it moves
 * with it, including the ones nobody remembered to update.
 *
 * The pad's table lives beside it, in its own namespace, and is read the same
 * way by the same machinery. What that bought is stated where it happens: the
 * bumper/trigger swap stopped being a boolean beside the bindings and became a
 * write to them, so there is exactly one answer to "what does R2 do" and the
 * controls page redraws itself when it changes. See PAD_ACTIONS below.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT REBINDABLE, AND WHY THAT IS NOT LAZINESS
 * ---------------------------------------------------------------------------
 *
 * Some entries carry `fixed: true`. They are in the table anyway - the table is
 * what the controls page is drawn from, and a control the player cannot change
 * is still a control they need to be able to look up - but the editor refuses
 * them, and refuses anything that would collide with them.
 *
 *   FIRE AND AIM are mouse buttons. Rebinding them means a second capture mode
 *   that listens for mousedown, a rule for what happens when a player binds fire
 *   to the button they must click to dismiss the capture, and a conflict space
 *   that spans two devices. That is a disproportionate amount of machinery for a
 *   binding no shooter has moved since 1996. They are listed and they are fixed.
 *
 *   THE PAD'S FIXED ENTRIES are the sticks, the D-pad and Options, and the
 *   reason is the menu rather than the hardware. See PAD_ACTIONS.
 *
 *   PAUSE IS ESCAPE BECAUSE THE BROWSER SAYS SO. Pointer lock exits on Esc
 *   natively, before any handler on this page is consulted, and ui/pause.js
 *   opens on the LOCK LOSS rather than on the keystroke for exactly that reason.
 *   A player who bound pause to KeyM would get the menu on M and ALSO on Esc,
 *   and the panel would be describing a scheme the browser overrules. Better to
 *   state the truth: Esc is the menu, it cannot move.
 *
 * ---------------------------------------------------------------------------
 * PERSISTENCE, AND THE PROJECT CONSTRAINT IT AMENDS
 * ---------------------------------------------------------------------------
 *
 * STATE.md and the README both carry "No browser storage. All state in memory.",
 * and ui/pause.js says in as many words that making the settings persist is the
 * owner's call and not that file's. The owner has now made it, for this feature
 * specifically: a rebind that does not survive a reload is a rebind the player
 * has to perform again every session, which is worse than not having shipped the
 * editor. So THIS is what persists, and only this - one storage key holding both
 * devices, one schema version, validated on the way in. The sliders still last
 * for the session, and a scheme that is entirely at its defaults writes nothing
 * at all rather than storing a copy of the shipped one.
 *
 * The validation is not defensive decoration. The stored blob is user-writable
 * from the console, it survives across builds that may have renamed an action,
 * and JSON.parse throws on a truncated write. Anything that fails falls back to
 * the DEFAULT for that action alone, so a corrupt entry costs one binding rather
 * than the keyboard.
 */

/**
 * WHAT THE PLAYER CAN DO, and the keys that do it.
 *
 * Ordered, because this order is the order the controls page walks and the
 * order conflicts are resolved in on load.
 *
 * `codes` is a LIST rather than a single value because three of the defaults
 * genuinely are lists: both Shifts sprint, and C and both Control keys crouch,
 * which is the pair every shooter on this layout offers because the two hands
 * disagree about which is natural. A rebind REPLACES the list with the one key
 * the player pressed - that is what "rebind" means to a player - and Reset puts
 * the alternates back.
 *
 * `device: 'mouse'` entries carry pseudo-codes (Mouse0, Mouse2, MouseMove,
 * Wheel) which are never compared against a KeyboardEvent. They exist so that
 * the controls page has one table to draw and not two.
 */
export const ACTIONS = [
  { id: 'forward', label: 'Move forward', codes: ['KeyW'] },
  { id: 'back', label: 'Move back', codes: ['KeyS'] },
  { id: 'left', label: 'Move left', codes: ['KeyA'] },
  { id: 'right', label: 'Move right', codes: ['KeyD'] },
  { id: 'sprint', label: 'Sprint', codes: ['ShiftLeft', 'ShiftRight'] },
  { id: 'jump', label: 'Jump', codes: ['Space'] },
  { id: 'crouch', label: 'Crouch', codes: ['KeyC', 'ControlLeft', 'ControlRight'] },

  { id: 'look', label: 'Look', codes: ['MouseMove'], device: 'mouse', fixed: true },
  { id: 'fire', label: 'Fire', codes: ['Mouse0'], device: 'mouse', fixed: true },
  { id: 'aim', label: 'Aim down sight', codes: ['Mouse2'], device: 'mouse', fixed: true },

  { id: 'reload', label: 'Reload', codes: ['KeyR'] },
  { id: 'grenade', label: 'Grenade', codes: ['KeyG'] },
  { id: 'melee', label: 'Khopesh', codes: ['KeyQ'] },

  { id: 'weapon1', label: 'Weapon slot 1', codes: ['Digit1'] },
  { id: 'weapon2', label: 'Weapon slot 2', codes: ['Digit2'] },
  { id: 'weapon3', label: 'Weapon slot 3', codes: ['Digit3'] },
  { id: 'weapon4', label: 'Weapon slot 4', codes: ['Digit4'] },
  { id: 'weapon5', label: 'Weapon slot 5', codes: ['Digit5'] },
  { id: 'weapon6', label: 'Weapon slot 6', codes: ['Digit6'] },
  { id: 'weapon7', label: 'Weapon slot 7', codes: ['Digit7'] },
  { id: 'weapon8', label: 'Weapon slot 8', codes: ['Digit8'] },
  { id: 'cycleWeapon', label: 'Next weapon', codes: ['KeyE'] },
  { id: 'inspect', label: 'Inspect the weapon', codes: ['KeyV'] },

  { id: 'interact', label: 'Interact', codes: ['KeyF'] },
  { id: 'renderMode', label: 'Render mode', codes: ['KeyP'] },
  { id: 'pause', label: 'Pause', codes: ['Escape'], fixed: true },
];

/** The pseudo-codes above, so a KeyboardEvent can never be matched against one. */
const DEVICE_CODES = new Set(['MouseMove', 'Mouse0', 'Mouse1', 'Mouse2', 'Wheel']);

/**
 * What a key is CALLED on the cap that is drawn for it.
 *
 * The left and right members of a pair deliberately share a label. The controls
 * page dedupes on the printed cap, so sprint on both Shifts draws one cap that
 * says Shift - which is exactly what the hand-written list it replaces drew, and
 * what the player's keyboard says.
 */
const CAP = {
  Space: 'Space', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Bksp',
  ShiftLeft: 'Shift', ShiftRight: 'Shift',
  ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
  AltLeft: 'Alt', AltRight: 'Alt',
  MetaLeft: 'Meta', MetaRight: 'Meta',
  CapsLock: 'Caps',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/',
  PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End', Insert: 'Ins',
  Delete: 'Del', NumLock: 'Num',
  MouseMove: 'Mouse', Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Wheel: 'Wheel',
};

/** The cap text for a code. Never empty, so a row can always draw something. */
export function capFor(code) {
  if (!code) return '?';
  if (CAP[code]) return CAP[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit([0-9])$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(.+)$/.exec(code);
  if (m) return `Num ${CAP[m[1]] || m[1]}`;
  return code;
}

/**
 * The `key` value that belongs with a `code`, for the synthetic events the pad
 * dispatches.
 *
 * A handler is entitled to read either, and a synthetic event that carries half
 * of a real one is a trap for whoever writes the next binding. Derived rather
 * than tabulated, because the table it replaces had five entries and the pad can
 * now be asked for any action in the game.
 */
export function keyFor(code) {
  if (!code) return '';
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].toLowerCase();
  m = /^Digit([0-9])$/.exec(code);
  if (m) return m[1];
  if (code === 'Space') return ' ';
  if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(code)) {
    return code.replace(/(Left|Right)$/, '');
  }
  // Escape, Enter, Tab, Backspace, F1-F12 and the arrows are already their own
  // `key` value. Anything unrecognised returns the code, which is wrong in the
  // same harmless way the old table's fallback was.
  return code;
}

/**
 * THE PAD, AND WHY IT IS A SECOND TABLE RATHER THAN MORE ROWS IN THE FIRST.
 *
 * The two answer different questions and a player reads one or the other. They
 * also live in different namespaces: a KeyboardEvent.code and a button name from
 * core/gamepad.js can never be confused for one another here, which is what lets
 * Fire be on Mouse0 and R2 at the same time without either being a conflict.
 *
 * WHAT IS MOVABLE, AND WHAT IS NOT:
 *
 *   THE STICKS are what they are. Move is the left stick and Look is the right
 *   one; there is no second pair to exchange them with and swapping them is not
 *   a thing any player has ever asked for.
 *
 *   THE D-PAD AND CROSS-IN-A-MENU BELONG TO THE MENU. The pad drives this
 *   settings panel - four directions, a confirm, a back, two tab shoulders - and
 *   that vocabulary is what gets a controller player out of a menu they opened
 *   by accident. A player who bound the khopesh onto D-pad down would be
 *   rebinding the menu's own cursor, and the failure would arrive at the worst
 *   possible moment: stuck in a panel, pressing a direction, and being answered
 *   by a weapon. So inspect and the D-pad weapon cycle stay where they are.
 *
 *   OPTIONS IS PAUSE, for the same reason Escape is on the keyboard: the menu
 *   answers Options as its own back button, and a pause bound elsewhere would
 *   mean two buttons closing the panel and one of them not opening it.
 *
 * Everything a hand actually fights with - fire, aim, grenade, the khopesh,
 * jump, sprint, crouch, interact and the weapon swap on Triangle - is movable,
 * and the four shoulders can be exchanged in one click by the Game tab's Swap
 * setting, which is a write to THIS table and not a flag beside it.
 */
export const PAD_ACTIONS = [
  { id: 'move', label: 'Move', codes: ['lstick'], fixed: true },
  { id: 'look', label: 'Look', codes: ['rstick'], fixed: true },
  { id: 'sprint', label: 'Sprint', codes: ['r3'] },
  { id: 'crouch', label: 'Crouch', codes: ['l3'] },
  { id: 'jump', label: 'Jump', codes: ['cross'] },

  { id: 'fire', label: 'Fire', codes: ['r2'] },
  { id: 'aim', label: 'Aim down sight', codes: ['l2'] },
  { id: 'grenade', label: 'Grenade', codes: ['r1'] },
  /**
   * TWO BUTTONS FOR ONE VERB, and that is deliberate rather than a leftover.
   *
   * Circle is the khopesh's primary binding, at the owner's request, and the
   * shoulder keeps it as a second because that is what the muscle memory in this
   * build is already on. They are OR'd into one held value in core/input.js
   * rather than edge-detected separately, so a hand resting on L1 that also
   * presses Circle gets one swing and not two - which is the failure a second
   * independent edge would produce, exactly in the panic the blade exists for.
   */
  { id: 'melee', label: 'Khopesh', codes: ['circle', 'l1'] },
  { id: 'interact', label: 'Interact and reload', codes: ['square'] },
  { id: 'nextWeapon', label: 'Next weapon', codes: ['triangle'] },
  { id: 'inspect', label: 'Inspect the weapon', codes: ['up'], fixed: true },
  { id: 'pause', label: 'Pause', codes: ['options'], fixed: true },
];

/**
 * Every input name this table will accept, which is exactly the button set
 * core/gamepad.js reports plus the two sticks.
 *
 * A whitelist rather than a shape test, because a pad binding that does not name
 * a button the reader knows about is a binding that can never fire, and a saved
 * blob is user-writable. `lstick` and `rstick` are here so the fixed rows
 * validate on the way back in; nothing can be BOUND to them, they are fixed.
 */
export const PAD_INPUTS = new Set([
  'cross', 'circle', 'square', 'triangle',
  'l1', 'r1', 'l2', 'r2', 'l3', 'r3',
  'up', 'down', 'left', 'right',
  'options', 'share', 'ps',
  'lstick', 'rstick',
]);

/**
 * What a pad input is CALLED on the controls page.
 *
 * The face buttons are named for the DualShock and not for the Xbox pad. The
 * standard gamepad mapping's index 0 is the bottom face button on every
 * controller ever made, so the code is portable; the LABEL has to match the
 * plastic in the owner's hands or it is telling him something untrue.
 */
const PAD_CAP = {
  cross: 'Cross', circle: 'Circle', square: 'Square', triangle: 'Triangle',
  l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', l3: 'L3', r3: 'R3',
  up: 'D-pad up', down: 'D-pad down', left: 'D-pad left', right: 'D-pad right',
  options: 'Options', share: 'Share', ps: 'PS',
  lstick: 'Left stick', rstick: 'Right stick',
};

export function padCapFor(name) {
  return PAD_CAP[name] || name || '?';
}

const STORE_KEY = 'sands.keys.v1';
export const SCHEMA_VERSION = 1;

/** A code we are willing to store. Real codes are alphanumeric, and short. */
const CODE_OK = /^[A-Za-z0-9]{1,24}$/;

/**
 * A localStorage that cannot throw.
 *
 * Safari in private mode throws on setItem, an embedded page can throw on
 * getItem from a third-party context, and a game that fails to boot because a
 * key binding could not be saved would be the worst possible trade for this
 * feature. Every failure here is silent and lands the player on the defaults,
 * which is the state they were in before this file existed.
 */
function safeStore(store) {
  return {
    read() {
      try { return store && store.getItem(STORE_KEY); } catch { return null; }
    },
    write(text) {
      try { store && store.setItem(STORE_KEY, text); return true; } catch { return false; }
    },
    clear() {
      try { store && store.removeItem(STORE_KEY); return true; } catch { return false; }
    },
  };
}

/**
 * @param {object} [o]
 * @param {Storage} [o.storage]  defaults to window.localStorage where it exists
 */
export function createKeymap({ storage } = {}) {
  const store = safeStore(storage !== undefined
    ? storage
    : (typeof localStorage !== 'undefined' ? localStorage : null));

  /**
   * TWO TABLES, ONE MACHINE.
   *
   * The pad's map is the same object as the keyboard's with a different
   * vocabulary: an ordered list of actions, a live list of inputs per action,
   * a swap on collision, a validated restore, and one saved blob. Writing it
   * twice was the first plan and it was wrong for the reason this whole file
   * exists - two implementations of one rule drift, and the half that drifts is
   * always the half nobody is looking at. So the machinery below takes a TABLE
   * and the two public surfaces are thin.
   *
   * What is NOT shared is the vocabulary. A key code is compared against
   * KeyboardEvent.code and a pad input against a button name from
   * core/gamepad.js, and nothing in this file ever lets one be mistaken for the
   * other: they are separate namespaces, so binding Fire to Cross on the pad
   * says nothing about the keyboard's Fire, and a conflict is only ever a
   * conflict within one device.
   */
  function makeTable(actions, kind) {
    const byId = new Map();
    for (const a of actions) byId.set(a.id, a);
    const map = new Map();
    const t = { kind, actions, byId, map };
    setDefaults(t);
    return t;
  }

  function setDefaults(t) {
    t.map.clear();
    for (const a of t.actions) t.map.set(a.id, a.codes.slice());
  }

  const keys = makeTable(ACTIONS, 'key');
  const pads = makeTable(PAD_ACTIONS, 'pad');

  const subs = new Set();

  /**
   * What the last load had to throw away.
   *
   * Kept and exposed rather than logged and forgotten, because "the saved map
   * was rejected" is the one thing a player would otherwise experience as "my
   * bindings randomly reset", and because a test that asserts a corrupt value
   * was rejected has to be able to see that it was.
   */
  let lastLoad = { found: false, ok: false, reason: 'not read', dropped: [] };

  // -------------------------------------------------------------------------
  // reading
  // -------------------------------------------------------------------------

  const codesIn = (t, id) => (t.map.get(id) || []).slice();

  const primaryIn = (t, id) => (t.map.get(id) || [])[0] || null;

  function isFixedIn(t, id) {
    const a = t.byId.get(id);
    return !!(a && a.fixed);
  }

  /** Which action owns this input, or null. Device pseudo-codes never match. */
  function actionForIn(t, code) {
    if (!code || (t.kind === 'key' && DEVICE_CODES.has(code))) return null;
    for (const a of t.actions) {
      const list = t.map.get(a.id);
      if (list && list.includes(code)) return a.id;
    }
    return null;
  }

  const matchesIn = (t, id, code) => !!code
    && !(t.kind === 'key' && DEVICE_CODES.has(code))
    && (t.map.get(id) || []).includes(code);

  /** The caps for an action, deduped, so both Shifts draw one Shift. */
  function labelsIn(t, id) {
    const out = [];
    for (const c of (t.map.get(id) || [])) {
      const cap = t.kind === 'pad' ? padCapFor(c) : capFor(c);
      if (!out.includes(cap)) out.push(cap);
    }
    return out;
  }

  /** Every binding in a table, as plain data. What the harness reads. */
  function snapshotIn(t) {
    const out = {};
    for (const a of t.actions) out[a.id] = codesIn(t, a.id);
    return out;
  }

  /** True when nothing in a table has been moved off its default. */
  function isDefaultIn(t) {
    for (const a of t.actions) {
      const now = t.map.get(a.id) || [];
      if (now.length !== a.codes.length) return false;
      for (let i = 0; i < now.length; i++) if (now[i] !== a.codes[i]) return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // writing
  // -------------------------------------------------------------------------

  function announce(change) {
    for (const fn of subs) {
      // A subscriber must not be able to break a rebind for every other
      // subscriber, exactly as a menu subscriber cannot break input.
      try { fn(change); } catch { /* ignore */ }
    }
  }

  /**
   * Write both tables, or REMOVE the saved blob when neither has been touched.
   *
   * The removal is the part worth stating. A player who rebinds a key and then
   * resets should be left exactly as a player who never opened the panel - no
   * stored object, nothing to restore, nothing to go stale across a build that
   * renames an action. A save that faithfully wrote "everything is at its
   * default" would be a file that exists only to be validated, and the first
   * thing to break a future migration.
   */
  function persist() {
    if (isDefaultIn(keys) && isDefaultIn(pads)) return store.clear();
    const payload = { v: SCHEMA_VERSION, map: {}, pad: {} };
    for (const a of ACTIONS) {
      if (a.fixed || a.device === 'mouse') continue;
      payload.map[a.id] = codesIn(keys, a.id);
    }
    for (const a of PAD_ACTIONS) {
      if (a.fixed) continue;
      payload.pad[a.id] = codesIn(pads, a.id);
    }
    return store.write(JSON.stringify(payload));
  }

  /**
   * BIND, AND THE CONFLICT RULE IS SWAP.
   *
   * Three ways this can end and the caller is told which, because the row has to
   * say what happened and "nothing visibly changed" is the one outcome a player
   * cannot tell apart from a broken menu:
   *
   *   unchanged  the input is already this action's. A no-op, reported as one.
   *
   *   refused    it belongs to a FIXED action - Esc, a mouse button, Options on
   *              the pad. There is nowhere for the incumbent to go, so the only
   *              options were to refuse or to leave the game without a pause
   *              button.
   *
   *   swapped    it belongs to another movable action, which takes over THIS
   *              action's old inputs.
   *
   * SWAP RATHER THAN REFUSE, deliberately, and the argument is about what the
   * player is actually doing when they hit a conflict. Nobody opens this page to
   * bind one key in isolation; they are moving a SCHEME - lefties pushing
   * movement onto the arrows, a player who wants grenade under their thumb. On a
   * refuse-only editor every one of those is a three-step dance: unbind the
   * incumbent somewhere harmless, bind the input you wanted, then go and find
   * the thing you displaced. Swap does that in one press and, critically, IS
   * REVERSIBLE - press the same input again on the other row and the pair goes
   * back. Nothing is ever left unbound and nothing is taken silently, which was
   * the actual failure to avoid.
   */
  function bindIn(t, id, code) {
    const a = t.byId.get(id);
    if (!a) return { ok: false, result: 'unknown', action: id };
    if (a.fixed) return { ok: false, result: 'fixed', action: id };
    const bad = !code || !CODE_OK.test(code)
      || (t.kind === 'key' ? DEVICE_CODES.has(code) : !PAD_INPUTS.has(code));
    if (bad) return { ok: false, result: 'invalid', action: id, code };

    const holder = actionForIn(t, code);
    if (holder === id) return { ok: false, result: 'unchanged', action: id, code };

    if (holder && isFixedIn(t, holder)) {
      return { ok: false, result: 'refused', action: id, code, with: holder };
    }

    const mine = codesIn(t, id);
    t.map.set(id, [code]);

    let result = 'bound';
    if (holder) {
      // The exchange. The displaced action takes everything this one had, which
      // for sprint or crouch is two or three keys rather than one - and that is
      // correct: those keys are now free and the action that lost its key is
      // exactly who should have them.
      t.map.set(holder, mine);
      result = 'swapped';
    }

    persist();
    const change = {
      ok: true, result, device: t.kind, action: id, code, with: holder || null,
    };
    announce(change);
    return change;
  }

  /** One table back to the shipped scheme. */
  function resetIn(t) {
    setDefaults(t);
    persist();
    const change = {
      ok: true, result: 'reset', device: t.kind, action: null, code: null, with: null,
    };
    announce(change);
    return change;
  }

  // -------------------------------------------------------------------------
  // loading
  // -------------------------------------------------------------------------

  /**
   * Restore a saved map, and DISTRUST EVERY FIELD OF IT.
   *
   * The failure this is written against is not a hypothetical. A stored blob
   * outlives the build that wrote it: an action can be renamed, a default can
   * move, the whole file can be truncated by a tab that died mid-write, and a
   * player can type anything they like into it from the console. The rule is
   * that a bad value costs ONE binding and never the boot: anything that does
   * not validate falls back to that action's own default.
   *
   * The second pass is the one that is easy to leave out. Even when every stored
   * value is individually well-formed, two of them can name the same input -
   * which the editor itself will never produce, because a swap moves both sides
   * at once, but which a hand-edited blob absolutely can. A duplicate that
   * survived would give the game two actions on one button and no way to tell
   * from the panel which one fired. So inputs are claimed in table order and one
   * that is already taken is dropped; an action left with nothing falls back to
   * its default, and if that is taken too it is left UNBOUND rather than given
   * an input that belongs to something else.
   */
  function loadTable(t, saved, dropped) {
    const taken = new Set();

    // The fixed actions claim their inputs first, so nothing stored can be
    // given Escape or Options however the blob was written.
    for (const a of t.actions) if (a.fixed) for (const c of a.codes) taken.add(c);

    for (const a of t.actions) {
      if (a.fixed || a.device === 'mouse') { t.map.set(a.id, a.codes.slice()); continue; }

      const rawList = saved ? saved[a.id] : undefined;
      let list = null;

      if (Array.isArray(rawList)
        && rawList.length >= 1 && rawList.length <= 4
        && rawList.every((c) => typeof c === 'string' && CODE_OK.test(c)
          && (t.kind === 'key' ? !DEVICE_CODES.has(c) : PAD_INPUTS.has(c)))) {
        list = rawList.filter((c) => !taken.has(c));
        if (list.length !== rawList.length) dropped.push(`${t.kind}.${a.id}: duplicate`);
      } else if (rawList !== undefined) {
        dropped.push(`${t.kind}.${a.id}: bad value`);
      }

      if (!list || !list.length) {
        list = a.codes.filter((c) => !taken.has(c));
        if (rawList !== undefined && !dropped.some((d) => d.startsWith(`${t.kind}.${a.id}:`))) {
          dropped.push(`${t.kind}.${a.id}: fell back to default`);
        }
      }

      for (const c of list) taken.add(c);
      t.map.set(a.id, list);
      if (!list.length) dropped.push(`${t.kind}.${a.id}: left unbound`);
    }
  }

  function load() {
    const raw = store.read();
    lastLoad = { found: raw != null, ok: false, reason: 'no saved map', dropped: [] };
    if (raw == null) return lastLoad;

    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {
      lastLoad.reason = 'not JSON';
      return lastLoad;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      lastLoad.reason = 'not an object';
      return lastLoad;
    }
    if (parsed.v !== SCHEMA_VERSION) {
      // A different schema is not corruption and is not read half way. The
      // defaults are a known-good state and a future version of this file is
      // free to write a migration here rather than inherit a guess.
      lastLoad.reason = `schema ${parsed.v} is not ${SCHEMA_VERSION}`;
      return lastLoad;
    }

    const ok = (o) => (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
    const dropped = [];
    // A blob with only one of the two sections is not corrupt: it was written
    // by a build where the other device had never been touched, and the missing
    // half restores to defaults exactly as an absent entry does.
    loadTable(keys, ok(parsed.map), dropped);
    loadTable(pads, ok(parsed.pad), dropped);

    lastLoad = { found: true, ok: true, reason: 'restored', dropped };
    return lastLoad;
  }

  load();

  /**
   * THE PAD'S SHOULDER SWAP, AS A WRITE TO THE MAP RATHER THAN A FLAG BESIDE IT.
   *
   * This setting predates the general pad map by a long way, and it is the
   * reason the general map was worth building: it is a rebind that shipped as a
   * boolean because there was nowhere to put it. Folding it in means there is
   * exactly one answer to "what does R2 do", and the controls page redraws
   * itself off the same map every other row is drawn from - where before it
   * carried a hand-written line explaining that the list does not redraw.
   *
   * It stays as a toggle, because it is still the fastest way to get what most
   * hands that want it are asking for: four bindings moved together, in pairs,
   * in one click. A player who wants any other arrangement rebinds the rows.
   *
   * CIRCLE IS NOT PART OF THE EXCHANGE and never moves. The khopesh's shoulder
   * is its second binding; Circle is its first, in both layouts.
   */
  const SHOULDERS = {
    off: { fire: 'r2', aim: 'l2', grenade: 'r1', melee: 'l1' },
    on: { fire: 'r1', aim: 'l1', grenade: 'r2', melee: 'l2' },
  };

  function shouldersAre(which) {
    const s = SHOULDERS[which];
    for (const id of ['fire', 'aim', 'grenade']) {
      const list = pads.map.get(id) || [];
      if (list.length !== 1 || list[0] !== s[id]) return false;
    }
    const melee = pads.map.get('melee') || [];
    return melee.includes(s.melee);
  }

  function setShoulders(on) {
    const s = SHOULDERS[on ? 'on' : 'off'];
    pads.map.set('fire', [s.fire]);
    pads.map.set('aim', [s.aim]);
    pads.map.set('grenade', [s.grenade]);
    // Circle keeps its place at the front of the list; only the shoulder moves.
    pads.map.set('melee', ['circle', s.melee]);
    persist();
    announce({
      ok: true, result: 'swap', device: 'pad', action: null, code: null, with: null,
    });
    return shouldersAre('on');
  }

  return {
    ACTIONS,
    PAD_ACTIONS,
    SCHEMA_VERSION,
    STORE_KEY,

    codes: (id) => codesIn(keys, id),
    primary: (id) => primaryIn(keys, id),
    labels: (id) => labelsIn(keys, id),
    capFor,
    keyFor,
    actionFor: (code) => actionForIn(keys, code),
    matches: (id, code) => matchesIn(keys, id, code),
    isFixed: (id) => isFixedIn(keys, id),
    snapshot: () => snapshotIn(keys),
    isDefault: () => isDefaultIn(keys),
    label: (id) => (keys.byId.get(id) ? keys.byId.get(id).label : id),

    bind: (id, code) => bindIn(keys, id, code),
    reset: () => resetIn(keys),
    save: persist,

    /**
     * THE PAD, THE SAME SHAPE ONE NAMESPACE OVER.
     *
     * Its own object rather than more methods with a `pad` prefix, so that a
     * caller has to say which device it is talking about and cannot half-mean
     * both. core/input.js reads this on the frames where a button is pressed;
     * ui/pause.js draws and edits it.
     */
    pad: {
      ACTIONS: PAD_ACTIONS,
      codes: (id) => codesIn(pads, id),
      primary: (id) => primaryIn(pads, id),
      labels: (id) => labelsIn(pads, id),
      capFor: padCapFor,
      actionFor: (code) => actionForIn(pads, code),
      matches: (id, code) => matchesIn(pads, id, code),
      isFixed: (id) => isFixedIn(pads, id),
      snapshot: () => snapshotIn(pads),
      isDefault: () => isDefaultIn(pads),
      label: (id) => (pads.byId.get(id) ? pads.byId.get(id).label : id),
      bind: (id, code) => bindIn(pads, id, code),
      reset: () => resetIn(pads),

      /** The shoulder swap, read off the map it writes. */
      get swapped() { return shouldersAre('on'); },
      setSwapped: setShoulders,
    },

    /** Re-read the store. Exposed so a harness can prove a reload, in a page. */
    reload() { setDefaults(keys); setDefaults(pads); return load(); },
    get lastLoad() { return lastLoad; },

    /** Told about every accepted change, including reset. Returns an unsubscribe. */
    onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/**
 * THE ONE THE GAME USES.
 *
 * A shared instance rather than something threaded through four constructors,
 * for the same reason there is one table: main.js, core/input.js and ui/pause.js
 * all have to be looking at the same bindings, and a wiring mistake that gave
 * one of them its own copy would produce a game where the panel edits a scheme
 * the handler is not reading. createKeymap is exported beside it so a test can
 * have an isolated one with its own storage.
 */
export const keymap = createKeymap();
