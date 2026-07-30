/**
 * THE PAUSE MENU, AND THE SETTINGS AND CONTROLS PANEL BEHIND IT.
 *
 * The primary claim of this file is not that an overlay appears. It is that
 * THE SIMULATION STOPS. An overlay over a running game is worse than no menu at
 * all in this particular game, because the most interesting decision in it has a
 * live fuse on it: a player who opens the settings with a grenade cooking, reads
 * two lines about mouse sensitivity, and is killed by their own hand has been
 * punished for using the menu. The same is true, more slowly, of a wave director
 * that keeps sending, of power-ups that keep draining, and of twenty-four actors
 * that keep walking.
 *
 * So the stop is owned by the frame loop and not by this module. main.js reads
 * `paused` at the top of the frame and returns before it advances anything; this
 * file only decides WHEN, paints the panel, and holds the settings. Nothing here
 * simulates and nothing here renders.
 *
 * ------------------------------------------------------------------------
 * WHY Esc, AND WHY THE MENU OPENS ON LOSING THE MOUSE RATHER THAN ON THE KEY
 * ------------------------------------------------------------------------
 *
 * Pointer lock already exits on Esc, natively, before any handler in this
 * codebase gets a say. Two things follow. First, Esc is the key the player will
 * press whatever we bind, so binding anything else would be an argument with the
 * browser that the browser wins. Second - and this is the part worth writing
 * down - the RELIABLE signal is not the keystroke but the LOCK LOSS: Chrome does
 * not consistently deliver a keydown for the Esc that released the lock, and
 * alt-tab, a system dialog and a click outside the canvas all drop the lock with
 * no keystroke at all. Every one of those is a moment the player has stopped
 * playing.
 *
 * So main.js opens this from `pointerlockchange`, and the Esc keydown is the
 * SECOND path, for the case where there is no lock to lose: the iframe fallback,
 * where pointer lock was denied and the game reads raw mouse deltas instead.
 * Both call open(), which is idempotent, so the two firing together is a
 * no-event rather than a race.
 *
 * ---------------------------------
 * WHY BLUR DOES NOT PAUSE, AND WHY HIDDEN DOES
 * ---------------------------------
 *
 * `window.blur` fires when devtools takes focus, when an OS notification steals
 * it, and when a second monitor is clicked - all cases where the player is still
 * looking at the game and would find it frozen for no reason they can see.
 * `document.hidden` is the honest signal that the game is not on screen at all,
 * and that is what auto-pauses. The alt-tab case, which is the one that actually
 * matters, is covered twice over: it drops pointer lock AND it hides the tab.
 *
 * The frame loop's MAX_DELTA clamp stays exactly where it was and is untouched
 * by any of this. It is the last line of defence for the case this file cannot
 * see - a tab that was never hidden and never lost lock and still came back with
 * a four-second frame - and a pause that made the clamp look unnecessary would
 * be the most expensive kind of wrong.
 *
 * -----------
 * PERSISTENCE
 * -----------
 *
 * There is none, ON PURPOSE. STATE.md and the README both carry the project
 * constraint "No browser storage. All state in memory.", inherited from the
 * original design spec, and a settings panel is exactly the feature that would
 * quietly break it. Every value below lives for the session and resets on
 * reload. Making them persist is one localStorage read at construction and one
 * write in `apply`, and it is the owner's call and not this file's.
 */

/**
 * Every binding in the game, and this table is the point of the CONTROLS tab.
 *
 * The owner spent a day unable to find the grenade key. The bindings were stated
 * in exactly one place - the title card - which is gone the moment play starts,
 * so the control scheme was something the player had to memorise in the ten
 * seconds before the game began or go without. The HUD's key caps fixed that for
 * the two verbs that have a readout to sit beside; this fixes it for all of
 * them.
 *
 * Kept as data rather than as markup so the list cannot drift from the panel it
 * is drawn into, and grouped the way a player thinks about them rather than the
 * way the source is laid out.
 */
export const BINDINGS = [
  {
    group: 'Movement',
    rows: [
      { keys: ['W', 'A', 'S', 'D'], what: 'Move' },
      { keys: ['Shift'], what: 'Sprint' },
      { keys: ['Space'], what: 'Jump' },
      { keys: ['Mouse'], what: 'Look' },
    ],
  },
  {
    group: 'Fighting',
    rows: [
      { keys: ['LMB'], what: 'Fire' },
      { keys: ['RMB'], what: 'Aim down sight' },
      { keys: ['R'], what: 'Reload' },
      // The one the owner could not find. Stated in full, because "throw
      // grenade" would not have told him the fuse starts when the key goes DOWN.
      { keys: ['G'], what: 'Hold to cook a grenade, release to throw' },
    ],
  },
  {
    group: 'Weapons',
    rows: [
      { keys: ['1', '-', '7'], what: 'Select a weapon by slot' },
      { keys: ['Wheel'], what: 'Cycle weapons' },
      { keys: ['V'], what: 'Inspect the weapon in hand' },
    ],
  },
  {
    group: 'The world',
    rows: [
      { keys: ['F'], what: 'Buy, open, and use - whatever is under the crosshair' },
      { keys: ['Esc'], what: 'Pause, and this panel' },
    ],
  },
];

/**
 * The tabs, and every control on them.
 *
 * ONE TABLE, and it carries the label, the range, the formatting and the effect
 * together. The alternative - markup in index.html and a switch statement here -
 * is how a slider ends up labelled in one unit and applied in another, which on
 * a field-of-view control means degrees against radians and a game that looks
 * like it is being viewed through a drinking straw.
 *
 * `read` and `write` both go straight at the live system. Nothing is cached and
 * nothing is pushed: setting the value IS applying it, and the readout is
 * re-derived from the system afterwards rather than from what was typed in. A
 * slider that reports what it asked for rather than what happened is the same
 * class of lie as a HUD that reads its own last write.
 */
function buildSpec({ rig, audio, mute, fidelity }) {
  const deg = (n) => `${Math.round(n)}°`;

  return [
    {
      id: 'game',
      name: 'Game',
      rows: [
        {
          id: 'sensitivity',
          kind: 'range',
          label: 'Mouse sensitivity',
          min: 0.20, max: 3.00, step: 0.01,
          read: () => rig.sensitivityScale,
          write: (v) => rig.setSensitivityScale(v),
          // The multiplier is what the player tunes; the constant underneath is
          // what the camera actually multiplies the mouse delta by, and it is
          // printed because the owner asked for the actual number and because
          // it is the only figure that can be compared against another game.
          value: () => `${rig.sensitivityScale.toFixed(2)}×`,
          note: () => `${rig.sensitivity.toFixed(5)} rad per count`
            + ` · ${(rig.sensitivity * 0.35).toFixed(5)} at full zoom`,
        },
        {
          id: 'invert',
          kind: 'toggle',
          label: 'Invert look',
          read: () => rig.invertY,
          write: (on) => rig.setInvertY(on),
          value: () => (rig.invertY ? 'On' : 'Off'),
          note: () => 'Vertical only. Pushing the mouse forward looks '
            + (rig.invertY ? 'up' : 'down'),
        },
        {
          id: 'fov',
          kind: 'range',
          label: 'Field of view',
          min: 60, max: 110, step: 1,
          read: () => rig.baseFov,
          write: (v) => rig.setBaseFov(v),
          value: () => deg(rig.baseFov),
          // THE INTERACTION, MADE VISIBLE. Aiming and sprinting are ratios of
          // this number rather than constants beside it - see player/camera.js
          // for why they had to become ratios - and printing both here means a
          // player dragging the FOV slider can watch them follow instead of
          // discovering later that their sight picture moved.
          note: () => `aim ${deg(rig.adsFov)} · sprint ${deg(rig.sprintFov)}`,
        },
        {
          id: 'adszoom',
          kind: 'range',
          label: 'Aim zoom',
          min: 1.05, max: 2.50, step: 0.01,
          read: () => rig.adsZoom,
          write: (v) => rig.setAdsZoom(v),
          value: () => `${rig.adsZoom.toFixed(2)}×`,
          note: () => `sight at ${deg(rig.adsFov)}`
            + ' · mouse slows to match the zoom',
        },
      ],
    },
    {
      id: 'video',
      name: 'Video',
      rows: [
        {
          id: 'fidelity',
          kind: 'choice',
          label: 'Fidelity',
          choices: [['High', true], ['Low', false]],
          read: () => fidelity.get(),
          write: (v) => fidelity.set(v),
          value: () => (fidelity.get() ? 'High' : 'Low'),
          note: () => (fidelity.get()
            ? 'Shadows, full post chain, device pixel ratio'
            : 'No shadows, thinned post chain, one pixel per pixel'),
        },
      ],
    },
    {
      id: 'audio',
      name: 'Audio',
      rows: [
        {
          id: 'volume',
          kind: 'range',
          label: 'Master volume',
          min: 0, max: 100, step: 1,
          read: () => Math.round(audio.getVolume() * 100),
          write: (v) => audio.setVolume(v / 100),
          value: () => `${Math.round(audio.getVolume() * 100)}`,
          note: () => 'Ramped, never stepped. An instant gain change is audible',
        },
        {
          id: 'mute',
          kind: 'toggle',
          label: 'Mute',
          /**
           * THE PLAYER'S SETTING, NOT THE BUS.
           *
           * Reading audio.isMuted() here was wrong in the one place this
           * control is ever seen: the menu ducks the game, so the bus is muted
           * for the whole time the panel is up, and the row sat at "On" for
           * every player who had never touched it. A control that reports a
           * state the player did not choose is worse than no control - the
           * obvious response is to click it, which sets the real setting to
           * exactly the wrong value. Caught by looking at the audio tab, not by
           * any assertion. See the `mute` facade in createPauseMenu.
           */
          read: () => mute.get(),
          write: (on) => mute.set(on),
          value: () => (mute.get() ? 'On' : 'Off'),
          note: () => 'Keeps the volume setting. The game ducks while paused'
            + ' whatever this says',
        },
        {
          id: 'voices',
          kind: 'readout',
          label: 'Simultaneous voices',
          value: () => `${audio.stats().voices} of ${audio.stats().cap}`,
          note: () => 'The cap follows fidelity. Twenty enemies groaning at'
            + ' once is a wall of noise and a dropped frame',
        },
      ],
    },
    {
      id: 'controls',
      name: 'Controls',
      rows: [],
      bindings: BINDINGS,
    },
  ];
}

/**
 * @param {object} o
 * @param {HTMLElement} o.root       #pause, OUTSIDE #hud - see index.html
 * @param {object} o.rig             player/camera.js
 * @param {object} o.audio           core/audio.js
 * @param {object} o.input           core/input.js
 * @param {{get: function, set: function}} o.fidelity
 * @param {function} [o.onResume]    called after the menu closes
 */
export function createPauseMenu({ root, rig, audio, input, fidelity, onResume }) {
  if (!root) {
    return {
      get paused() { return false; },
      open() {}, resume() {}, toggle() {}, refresh() {}, spec: [], rows: {},
    };
  }

  /**
   * WHAT THE PLAYER CHOSE, kept separately from what the bus is doing.
   *
   * The menu ducks the game while it is up, so for the entire time the audio
   * tab is visible the bus is muted. One boolean cannot be both "the player
   * asked for silence" and "the menu is open", and conflating them made the
   * Mute row read On for everyone. This is the setting; the duck is temporary
   * and is applied over the top of it.
   */
  let userMuted = audio.isMuted();
  let paused = false;

  const mute = {
    get: () => userMuted,
    set(on) {
      userMuted = !!on;
      // While paused the bus stays ducked regardless; resume() applies this.
      if (!paused) audio.setMuted(userMuted);
      return userMuted;
    },
  };

  const spec = buildSpec({ rig, audio, mute, fidelity });

  const tabsEl = root.querySelector('[data-pause-tabs]');
  const bodyEl = root.querySelector('[data-pause-body]');
  const resumeEl = root.querySelector('[data-pause-resume]');

  /** Every built row, by id, so refresh() is a walk and not a search. */
  const rows = {};
  const panels = {};
  const tabs = {};

  let active = spec[0].id;

  // -------------------------------------------------------------------------
  // building
  // -------------------------------------------------------------------------

  const el = (tag, cls, parent) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  };

  function buildRow(row, parent) {
    const wrap = el('div', 'set-row', parent);
    wrap.dataset.setting = row.id;

    const head = el('div', 'set-head', wrap);
    const label = el('span', 'set-label', head);
    label.textContent = row.label;
    const value = el('span', 'set-value', head);

    const control = el('div', 'set-control', wrap);
    const note = el('div', 'set-note', wrap);

    let input_ = null;
    const buttons = [];

    if (row.kind === 'range') {
      input_ = el('input', 'set-range', control);
      input_.type = 'range';
      input_.min = String(row.min);
      input_.max = String(row.max);
      input_.step = String(row.step);
      input_.setAttribute('aria-label', row.label);
      // BOTH events. `input` is the drag, which is what makes the slider feel
      // live; `change` is the keyboard and the click on the track, which on
      // some paths does not emit `input` at all.
      const push = () => { row.write(Number(input_.value)); paint(row); };
      input_.addEventListener('input', push);
      input_.addEventListener('change', push);
    } else if (row.kind === 'toggle') {
      const b = el('button', 'set-btn', control);
      b.type = 'button';
      b.addEventListener('click', () => { row.write(!row.read()); paint(row); });
      buttons.push([b, null]);
    } else if (row.kind === 'choice') {
      for (const [name, val] of row.choices) {
        const b = el('button', 'set-btn', control);
        b.type = 'button';
        b.textContent = name;
        b.addEventListener('click', () => { row.write(val); paint(row); });
        buttons.push([b, val]);
      }
    }

    rows[row.id] = { row, wrap, value, note, input: input_, buttons };
    return rows[row.id];
  }

  /** The controls tab: a read-only list, built once, never repainted. */
  function buildBindings(groups, parent) {
    for (const g of groups) {
      const block = el('div', 'bind-block', parent);
      const h = el('div', 'bind-group', block);
      h.textContent = g.group;

      for (const r of g.rows) {
        const line = el('div', 'bind-row', block);
        const keys = el('span', 'bind-keys', line);
        for (const k of r.keys) {
          // A separator inside a range - "1 - 7" - is not a key and must not be
          // drawn as one, or the panel claims a binding that does not exist.
          if (k === '-') {
            const sep = el('span', 'bind-sep', keys);
            sep.textContent = 'to';
            continue;
          }
          const cap = el('kbd', 'key-cap', keys);
          cap.textContent = k;
        }
        const what = el('span', 'bind-what', line);
        what.textContent = r.what;
      }
    }
  }

  for (const tab of spec) {
    const b = el('button', 'pause-tab', tabsEl);
    b.type = 'button';
    b.textContent = tab.name;
    b.dataset.tab = tab.id;
    b.addEventListener('click', () => show(tab.id));
    tabs[tab.id] = b;

    const panel = el('div', 'pause-panel', bodyEl);
    panel.dataset.panel = tab.id;
    for (const row of tab.rows) buildRow(row, panel);
    if (tab.bindings) buildBindings(tab.bindings, panel);
    panels[tab.id] = panel;
  }

  // -------------------------------------------------------------------------
  // painting
  // -------------------------------------------------------------------------

  /**
   * Repaint one row FROM THE SYSTEM.
   *
   * Never from the slider's own value. The camera clamps what it is given, the
   * audio bus clamps what it is given, and a panel that echoed the request
   * rather than the result would show 3.40x sensitivity on a rig running at
   * 3.00x - the one number on the screen that the player has no other way to
   * check.
   */
  function paint(row) {
    const built = rows[row.id];
    if (!built) return;

    built.value.textContent = row.value ? row.value() : '';
    built.note.textContent = row.note ? row.note() : '';

    if (built.input && row.read) {
      const v = row.read();
      const s = String(v);
      if (built.input.value !== s) built.input.value = s;
    }

    for (const [b, val] of built.buttons) {
      if (val === null) {
        // A toggle. The button IS the state, so it says what it currently is
        // and is pressed when it is on.
        const on = !!row.read();
        b.textContent = on ? 'On' : 'Off';
        b.setAttribute('aria-pressed', String(on));
      } else {
        b.setAttribute('aria-pressed', String(row.read() === val));
      }
    }
  }

  /** Every row on every tab, including the ones not being looked at. */
  function refresh() {
    for (const tab of spec) for (const row of tab.rows) paint(row);
  }

  function show(id) {
    if (!panels[id]) return active;
    active = id;
    for (const k in panels) {
      panels[k].hidden = k !== id;
      tabs[k].setAttribute('aria-pressed', String(k === id));
    }
    refresh();
    return active;
  }

  // -------------------------------------------------------------------------
  // opening and closing
  // -------------------------------------------------------------------------

  /**
   * Stop the game.
   *
   * IDEMPOTENT, and that is load-bearing rather than defensive: main.js calls
   * this from both the Esc keydown and the pointerlockchange that the same Esc
   * produced, and on most paths both arrive. Two opens must be one pause.
   */
  function open() {
    if (paused) return false;
    paused = true;

    /**
     * TAKE THE CURSOR BACK, AND THIS LINE IS THE WHOLE MENU.
     *
     * While pointer lock is held EVERY mouse event goes to the locked element -
     * the canvas - with clientX/clientY frozen at zero. A panel drawn over a
     * locked canvas is a picture of a panel: the buttons highlight nothing, the
     * sliders do not drag, and clicking Resume clicks the game.
     *
     * Measured, because this is not a thing state assertions can see. With the
     * menu up and the lock still held, `document.elementFromPoint` at the
     * Resume button's own centre correctly returned the button, the button
     * reported itself visible, enabled and stable - and the real mousedown the
     * driver dispatched at that point was delivered to `#stage` at 0,0. Every
     * check passed and the one control the player cannot do without was inert.
     *
     * The Esc path did not show it, because Esc exits pointer lock natively
     * before any of this runs. The paths that DO need it are the ones where
     * nothing released the lock for us: the tab-hidden auto-pause, and any
     * programmatic open. Those are exactly the cases where the player comes
     * back to a menu they cannot use.
     *
     * Safe against the listener in main.js: exiting fires pointerlockchange,
     * whose handler calls open(), which is idempotent and has already set
     * `paused` above. One pause, no loop.
     */
    if (document.pointerLockElement) document.exitPointerLock();

    // The input layer freezes SEPARATELY from the frame loop. See
    // input.setSuspended: the loop not reading the keys is not the same as the
    // keys not being held, and a W that was down when the menu opened would
    // otherwise still be down when it closed.
    input.setSuspended(true);

    // Duck. The ambience beds and every live voice go with it. The player's own
    // setting is untouched - it lives in `userMuted` and is reapplied on the way
    // out, so a menu can never silently un-mute a game somebody silenced.
    audio.setMuted(true);

    root.hidden = false;
    show(active);
    // Focus the resume button so the panel is keyboard-reachable the moment it
    // appears, and so Enter does the obvious thing.
    if (resumeEl) resumeEl.focus({ preventScroll: true });
    return true;
  }

  /** Start it again, and ask for the mouse back. */
  function resume() {
    if (!paused) return false;
    paused = false;

    root.hidden = true;
    // Hand focus back before anything else. The Resume button was focused so
    // the panel was keyboard-reachable, and a focused button consumes Space -
    // which is Jump. Hiding it would blur it in every browser tested, and
    // relying on that is how a game ships where the player cannot jump until
    // they click.
    if (resumeEl) resumeEl.blur();

    input.setSuspended(false);
    audio.setMuted(userMuted);

    if (onResume) onResume();
    return true;
  }

  function toggle() { return paused ? resume() : open(); }

  if (resumeEl) resumeEl.addEventListener('click', resume);

  // A click on the scrim outside the sheet resumes, which is what every menu
  // that has ever had a scrim does. Guarded on the target being the scrim
  // itself, or a click that started on a slider and ended off it would resume.
  root.addEventListener('mousedown', (e) => {
    if (e.target === root) resume();
  });

  refresh();

  return {
    get paused() { return paused; },
    get tab() { return active; },
    open,
    resume,
    toggle,
    show,
    refresh,
    spec,
    rows,
    tabs,
    panels,
    bindings: BINDINGS,
  };
}
