/**
 * THE LOCAL SAVE: settings, records, and unlocks that outlive the tab.
 *
 * WHAT WAS WRONG. Exactly one thing in this game survived a refresh, and it was
 * the key bindings - core/keymap.js has had a versioned store since it was
 * written. Mouse sensitivity, field of view, invert, stick sensitivity, volume,
 * mute and difficulty were all held in JS and nowhere else, so every player
 * retuned the game every time they opened it.
 *
 * And the death card said this:
 *
 *     WAVE 12   ·   3450 GOLD   ·   ERASED 03 TIMES
 *
 * `state.resets` lives in memory. The tomb counted your erasures and then
 * forgot them the moment you reloaded, which makes the one number in the game
 * whose entire conceit is that it REMEMBERS the one number that did not.
 *
 * ONE SAVE, NOT PROFILES, and that is a decision rather than a first cut.
 * "Keep my high scores" is a records problem and not an identity problem;
 * multiple named profiles solve a shared-machine problem this game does not
 * have, and they would put a slot picker in front of a first minute that is
 * currently very good. The shape below is nested under a single slot so that
 * adding real profiles later is a new key rather than a migration of live
 * saves.
 *
 * IT CANNOT THROW AND IT CANNOT BOOT-LOOP. Same reasoning as keymap.js, same
 * failure modes, and they are real: Safari in private mode throws on setItem,
 * an embedded page can throw on getItem from a third-party context, and quota
 * can be full. Every failure here is silent and lands the player on defaults,
 * which is the state they were in before this file existed. A game that fails
 * to start because a volume slider could not be written would be the worst
 * possible trade for this feature.
 *
 * ANYTHING UNRECOGNISED IS DROPPED RATHER THAN TRUSTED. localStorage is player
 * writable and survives across versions of this game, so a saved blob is
 * untrusted input in the same way a query string is. Numbers must be finite,
 * booleans must be booleans, and a key nobody asked for does not come back.
 */

const STORE_KEY = 'sands.save.v1';

/**
 * Bumped when a shape change cannot be absorbed by the validator below.
 *
 * It is deliberately NOT bumped for adding a field. A save written by an older
 * build simply lacks the key and the caller's fallback answers, which is the
 * whole reason every read takes one. Bump this only when an existing key
 * changes MEANING, because that is the case where old data is worse than none.
 */
export const SCHEMA_VERSION = 1;

/**
 * How long a burst of writes is allowed to coalesce, in milliseconds.
 *
 * A range input fires on every pixel of drag, so a player sweeping the
 * sensitivity slider generates dozens of writes in a second. localStorage is
 * synchronous and on the main thread, and this game already has a governor
 * because it could not hold frame rate; serialising the save on every input
 * event would be a stutter the player can feel while adjusting the very control
 * that is meant to make the game feel better.
 *
 * 250 ms is under the time it takes to let go of a slider and look at the
 * result, so a write always lands before the player can act on it, and it
 * collapses a full sweep into one or two writes instead of eighty.
 */
const COALESCE_MS = 250;

/** A localStorage that cannot throw. Lifted deliberately from keymap.js. */
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

/** The shape a fresh save has. Every field is optional to a reader. */
function blank() {
  return { v: SCHEMA_VERSION, settings: {}, records: {}, flags: {} };
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Take only what this build understands, out of whatever was on disk.
 *
 * Returns a fresh blank on anything it cannot read rather than attempting a
 * repair. A half-restored save is the worst outcome available here: it puts the
 * player in a state no code path produced, and it is the state that will be
 * reported as a bug with no way to reproduce it.
 */
function sanitise(raw) {
  if (!raw || typeof raw !== 'object') return blank();
  if (raw.v !== SCHEMA_VERSION) return blank();

  const out = blank();

  // Settings are numbers and booleans keyed by the settings row's own id. The
  // ids are not enumerated here on purpose: this module does not own the list
  // of settings and a copy of it would be a second place to update.
  if (raw.settings && typeof raw.settings === 'object') {
    for (const [k, v] of Object.entries(raw.settings)) {
      if (isNum(v) || typeof v === 'boolean') out.settings[k] = v;
    }
  }

  if (raw.records && typeof raw.records === 'object') {
    for (const [k, v] of Object.entries(raw.records)) {
      // Negative records are meaningless for every figure this game keeps -
      // waves, gold, kills, seconds - and a negative would win a `least`
      // comparison forever.
      if (isNum(v) && v >= 0) out.records[k] = v;
    }
  }

  if (raw.flags && typeof raw.flags === 'object') {
    for (const [k, v] of Object.entries(raw.flags)) {
      if (typeof v === 'boolean') out.flags[k] = v;
    }
  }

  return out;
}

/**
 * @param {object} [o]
 * @param {Storage} [o.storage]  defaults to window.localStorage where it exists
 * @param {object}  [o.win]      for the flush-on-hide listeners. Defaults to window.
 */
export function createSave({ storage, win } = {}) {
  const store = safeStore(storage !== undefined
    ? storage
    : (typeof localStorage !== 'undefined' ? localStorage : null));

  const w = win !== undefined ? win : (typeof window !== 'undefined' ? window : null);

  let data = blank();
  let dirty = false;
  let timer = null;
  const stat = { loads: 0, writes: 0, coalesced: 0, failures: 0, restored: false };

  function commit() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty) return false;
    dirty = false;
    const okWrite = store.write(JSON.stringify(data));
    if (okWrite) stat.writes++; else stat.failures++;
    return okWrite;
  }

  function touch() {
    dirty = true;
    if (timer) { stat.coalesced++; return; }
    // setTimeout rather than rAF: a paused game is not rendering, and the pause
    // menu is exactly where settings are changed.
    timer = setTimeout(() => { timer = null; commit(); }, COALESCE_MS);
  }

  function load() {
    stat.loads++;
    const text = store.read();
    if (!text) { data = blank(); return data; }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    data = sanitise(parsed);
    stat.restored = !!parsed;
    return data;
  }

  load();

  /**
   * FLUSHED WHEN THE PAGE GOES AWAY, because the coalesce window is longer than
   * the gap between changing a setting and closing the tab.
   *
   * `pagehide` and a `visibilitychange` to hidden are the two events that
   * actually fire on a mobile tab being backgrounded and on a desktop tab being
   * closed; `beforeunload` is not reliable on either and is a scroll-blocker on
   * some browsers. Both are registered because neither fires in every case.
   */
  if (w && w.addEventListener) {
    const flush = () => commit();
    w.addEventListener('pagehide', flush);
    if (w.document && w.document.addEventListener) {
      w.document.addEventListener('visibilitychange', () => {
        if (w.document.visibilityState === 'hidden') commit();
      });
    }
  }

  return {
    /**
     * A player preference, by the settings row's own id.
     *
     * The fallback is required rather than defaulted, because the DEFAULT for
     * every setting lives with the thing it configures - the camera rig owns
     * what a sensible field of view is - and a second copy here would be the
     * one that drifts.
     */
    getSetting(id, fallback) {
      const v = data.settings[id];
      return v === undefined ? fallback : v;
    },
    setSetting(id, value) {
      if (!isNum(value) && typeof value !== 'boolean') return false;
      if (data.settings[id] === value) return false;   // no write for no change
      data.settings[id] = value;
      touch();
      return true;
    },

    /**
     * Keep the HIGHEST value ever seen for this record. Returns true if it beat
     * the standing one, so a caller can say so on the card.
     */
    best(id, value) {
      if (!isNum(value) || value < 0) return false;
      const cur = data.records[id];
      if (cur !== undefined && cur >= value) return false;
      data.records[id] = value;
      touch();
      return true;
    },

    /**
     * Keep the LOWEST. For the records where less is better, which on this map
     * is one: the time to clear all twenty-five waves.
     */
    least(id, value) {
      if (!isNum(value) || value < 0) return false;
      const cur = data.records[id];
      if (cur !== undefined && cur <= value) return false;
      data.records[id] = value;
      touch();
      return true;
    },

    /** Add to a running total. The erasure count is the reason this exists. */
    add(id, n = 1) {
      if (!isNum(n)) return 0;
      const next = (data.records[id] || 0) + n;
      if (next < 0) return data.records[id] || 0;
      data.records[id] = next;
      touch();
      return next;
    },

    getRecord(id, fallback = 0) {
      const v = data.records[id];
      return v === undefined ? fallback : v;
    },
    records() { return { ...data.records }; },

    /** Unlocks. The World 2 Easter egg is what this is here for. */
    getFlag(id) { return data.flags[id] === true; },
    setFlag(id, on = true) {
      const v = on === true;
      if (data.flags[id] === v) return false;
      data.flags[id] = v;
      touch();
      return true;
    },

    /** Write now rather than at the end of the coalesce window. */
    flush() { return commit(); },

    /** Everything, for the harness and for a future export button. */
    snapshot() { return JSON.parse(JSON.stringify(data)); },

    /**
     * Wipe. Deliberately not wired to anything yet: a settings panel needs a
     * confirm in front of this, and a control that erases a player's records on
     * one click is a bug with a label on it.
     */
    clear() {
      data = blank();
      dirty = false;
      if (timer) { clearTimeout(timer); timer = null; }
      return store.clear();
    },

    stats() { return { ...stat, key: STORE_KEY, version: SCHEMA_VERSION }; },
  };
}
