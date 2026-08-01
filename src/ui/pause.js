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
 * THE CONTROLLER, and it is a second table rather than more rows in the first.
 *
 * A player cannot discover a pad layout by pressing keys. The keyboard scheme
 * above is at least self-teaching - the caps are printed on the hardware and
 * the HUD carries the two verbs that matter - but a DualShock has four
 * identical-feeling face buttons and no labels at all for what they do in THIS
 * game. Without this list the only way to find the khopesh on a pad is to press
 * everything during a wave, which is the same failure the grenade key had.
 *
 * Kept apart from BINDINGS rather than folded in, because the two answer
 * different questions and a player reads one or the other. Mixing them would
 * put "Square" and "Shift" in the same column and make both lists harder to
 * scan than either is alone.
 *
 * The face buttons are named for the DualShock and not for the Xbox pad. The
 * standard gamepad mapping's index 0 is the bottom face button on every
 * controller ever made, so the code is portable; the LABEL has to match the
 * plastic in the owner's hands or it is telling him something untrue.
 */
export const PAD_BINDINGS = [
  {
    group: 'Controller - moving and looking',
    rows: [
      { keys: ['Left stick'], what: 'Move' },
      { keys: ['Right stick'], what: 'Look' },
      { keys: ['R3'], what: 'Sprint - click once, it holds until you stop' },
      { keys: ['Cross'], what: 'Jump' },
    ],
  },
  {
    group: 'Controller - fighting',
    rows: [
      { keys: ['R2'], what: 'Fire - the trigger is read as an analog pull' },
      { keys: ['L2'], what: 'Aim down sight' },
      { keys: ['Square'], what: 'Reload' },
      { keys: ['R1'], what: 'Hold to cook a grenade, release to throw' },
      { keys: ['L1'], what: 'Khopesh' },
      // The four rows above are the DEFAULT. Swap bumpers and triggers on the
      // Game tab and they exchange in pairs: fire to R1, aim to L1, grenade to
      // R2, khopesh to L2. Written here rather than redrawing the list, because
      // a controls page that silently rearranges itself is harder to read
      // against a pad in your hands than one that states the rule.
      { keys: ['Swap'], what: 'Bumpers and triggers exchange - see the Game tab' },
    ],
  },
  {
    group: 'Controller - the world and the menu',
    rows: [
      { keys: ['Circle'], what: 'Buy, open, and use - whatever is under the crosshair' },
      { keys: ['Triangle'], what: 'Next weapon' },
      { keys: ['D-pad'], what: 'Left and right cycle weapons, up inspects the one in hand' },
      { keys: ['Options'], what: 'Pause, and this panel' },
      { keys: ['Cross'], what: 'In a menu: choose. Circle goes back and resumes' },
      { keys: ['L1', 'R1'], what: 'In a menu: previous and next tab' },
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
function buildSpec({ rig, audio, mute, fidelity, pad }) {
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
        /**
         * THE PAD'S SETTINGS, UNDER THE MOUSE'S AND NOT ON A TAB OF THEIR OWN.
         *
         * A fifth tab was the first idea and it is wrong twice over: a tab
         * named "Gamepad" is a tab nobody opens until they already suspect
         * something is broken, and test/settings.mjs pins the tab list at four
         * on purpose, because the tabs are the panel's shape and are not
         * something a passing change should be able to add to quietly.
         *
         * The CONTROLS tab was the second idea, and it was measured out. Six
         * more rows there pushed the key bindings past the bottom of the
         * scrolling body, and the legibility pass in test/settings.mjs - which
         * samples the first binding row's pixels - correctly reported the
         * controls list at 1.01 to one, because it was no longer on the screen.
         * That is a real regression and not a measurement artefact: a player
         * opening Controls to find the grenade key would have found a stick
         * sensitivity slider instead. The mapping list stays at the top of that
         * tab; the pad's LIST of buttons is appended below it, where a player
         * who has scrolled past the keyboard scheme is looking for it anyway.
         *
         * So they sit here, under the mouse rows, which is also the honest
         * grouping: this whole tab is "how the game reads your hands", and a
         * player looking for a sensitivity slider looks in one place whichever
         * device they are holding.
         *
         * Every one of these is a live value on core/input.js, read and written
         * exactly the way the mouse rows above read and write the camera rig.
         * There is no cached copy of a pad setting anywhere.
         */
        {
          id: 'padsens',
          kind: 'range',
          label: 'Stick sensitivity',
          min: 0.20, max: 3.00, step: 0.01,
          read: () => pad.sensitivity,
          write: (v) => pad.setSensitivity(v),
          value: () => `${pad.sensitivity.toFixed(2)}×`,
          /**
           * DEGREES PER SECOND, because that is the only unit in which a stick
           * sensitivity can be compared to anything.
           *
           * A stick is a RATE and not a distance: the number that describes it
           * is how fast the world turns while it is held over, which is what
           * this line prints. The mouse row above it prints radians per count
           * for the same reason - a multiplier on its own tells the player
           * nothing they can check.
           *
           * Both figures are the HIP rate. Aiming narrows the field of view and
           * the frame loop scales look by the same 0.35 at full zoom that it
           * applies to the mouse, so the sight slows down to match.
           */
          note: () => {
            const r = pad.rates();
            return `${Math.round(r.yaw)}°/s turning · ${Math.round(r.pitch)}°/s`
              + ' vertical, at full tilt from the hip';
          },
        },
        {
          id: 'paddead',
          kind: 'range',
          label: 'Stick deadzone',
          min: 0.02, max: 0.35, step: 0.01,
          read: () => pad.deadzone,
          write: (v) => pad.setDeadzone(v),
          value: () => `${Math.round(pad.deadzone * 100)}%`,
          /**
           * RADIAL is stated out loud because it is the difference between this
           * control working and the classic broken version of it. A per-axis
           * deadzone snaps every diagonal onto the nearest axis; this one is
           * measured on the length of the stick's own vector, so a stick held
           * at 30 degrees stays at 30 degrees. See core/gamepad.js.
           */
          note: () => 'Radial, not per axis, so diagonals do not snap.'
            + ' Below this the stick is silent; above it the response ramps'
            + ' from zero rather than jumping',
        },
        {
          id: 'padcurve',
          kind: 'range',
          label: 'Stick response curve',
          min: 1.0, max: 3.0, step: 0.1,
          read: () => pad.exponent,
          write: (v) => pad.setExponent(v),
          value: () => pad.exponent.toFixed(1),
          /**
           * The number that is printed is the one the player is actually
           * choosing: what half a stick gets you. A linear stick gives 50 per
           * cent at half tilt and leaves nowhere to aim finely, because the top
           * of the range has to be fast enough to turn round in.
           */
          note: () => {
            const half = Math.round(Math.pow(0.5, pad.exponent) * 100);
            return `Half tilt gives ${half}% of full speed.`
              + ' 1.0 is linear and has no fine control at all';
          },
        },
        {
          id: 'padinvert',
          kind: 'toggle',
          label: 'Invert stick look',
          read: () => pad.invertY,
          write: (on) => pad.setInvertY(on),
          value: () => (pad.invertY ? 'On' : 'Off'),
          // Its own setting rather than a second reading of the mouse row.
          // Inverting a stick and inverting a mouse are different preferences
          // and a player who holds one does not necessarily hold the other.
          note: () => 'Vertical only, and separate from the mouse setting.'
            + ' Pushing the stick forward looks '
            + (pad.invertY ? 'up' : 'down'),
        },
        {
          id: 'padswap',
          kind: 'toggle',
          label: 'Swap bumpers and triggers',
          read: () => pad.swapBumpers,
          write: (on) => pad.setSwapBumpers(on),
          value: () => (pad.swapBumpers ? 'On' : 'Off'),
          /**
           * The note prints the resulting layout rather than the word "on",
           * because the setting's name says which buttons move and not what
           * they become, and a player reaching for this row is trying to find
           * out where fire ends up.
           */
          note: () => (pad.swapBumpers
            ? 'Fire R1, aim L1, grenade R2, khopesh L2'
            : 'Fire R2, aim L2, grenade R1, khopesh L1'),
        },
        {
          id: 'padrumble',
          kind: 'toggle',
          label: 'Rumble',
          read: () => pad.rumbleEnabled,
          write: (on) => pad.setRumble(on),
          value: () => (pad.rumbleEnabled ? 'On' : 'Off'),
          // Switching it on fires one pulse from input.setRumble, so the
          // control proves itself instead of being taken on trust.
          note: () => (pad.info().vibration
            ? 'The pad reports a vibration motor. Switching this on fires a test pulse'
            : 'No vibration motor reported by this pad, or no pad connected'),
        },
        {
          id: 'padinfo',
          kind: 'readout',
          label: 'Controller',
          /**
           * THE ROW THAT EXISTS BECAUSE OF THIS PROJECT'S DEFINING BUG.
           *
           * Ten times now something here has been written, looked correct, and
           * never taken effect. A gamepad is the perfect substrate for an
           * eleventh: navigator.getGamepads() returns a sparse array, the slot
           * a pad lands in depends on the order things were plugged in, and
           * whether Chrome managed to put a DualShock on the standard mapping
           * is a runtime fact and not a documented guarantee. Every one of
           * those failures looks identical from the sofa - nothing happens.
           *
           * So the panel says what was READ. Which slot, which mapping string
           * the browser reported, and which layout the code chose off the back
           * of it. If that layout had to be guessed, it says so.
           */
          value: () => {
            const i = pad.info();
            if (!i.connected) return 'None detected';
            // The id is long and vendor-formatted. The tail in brackets is the
            // useful half and is dropped, since mapping and slot are printed
            // underneath anyway.
            const name = i.id.replace(/\s*\(.*\)\s*$/, '').trim();
            return name || 'Connected';
          },
          note: () => {
            const i = pad.info();
            if (!i.connected) {
              return 'Press a button on the pad. A browser hides controllers'
                + ' until one has been used on the page';
            }
            return `Slot ${i.index} · browser mapping "${i.mapping || 'none'}"`
              + ` · reading it as ${i.profileName}`
              + (i.assumed ? ' (layout GUESSED - report if a button is wrong)' : '');
          },
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
      // No rows. This tab is two read-only lists and the keyboard one has to
      // stay at the top of it - see the note beside the pad settings on the
      // Game tab for what happened when six controls were put above it.
      rows: [],
      bindings: BINDINGS,
      padBindings: PAD_BINDINGS,
    },
  ];
}

/**
 * WHAT THE PANEL SAYS IT IS, and there are two answers now.
 *
 * This surface is reached from two places: a stopped game, and the title screen
 * - src/ui/start.js opens it rather than building a second settings panel
 * beside it, because a title-screen copy of the sensitivity slider would be a
 * second writer to the camera and the first thing to drift. But a panel headed
 * PAUSED in front of a player who has not started a run is describing a state
 * they are not in, and the `.said` line exists precisely to state the state.
 *
 * One table, applied on open(), for the same reason the settings rows come out
 * of one: a heading authored in markup and a mode decided in code is two places
 * to say the same thing.
 */
const HEADINGS = {
  paused: ['Paused', 'The sands are still', '#i-pause'],
  title: ['Settings', 'Before the descent', '#i-rule'],
};

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
      get padCursor() { return null; },
    };
  }

  /**
   * What the pad rows read when there is no pad layer to read.
   *
   * A safety net rather than a feature: createPauseMenu is handed whatever
   * core/input.js exposes, and a panel that threw on construction because an
   * input module was swapped for a stub would take the whole game down with it.
   * Values are the shipped defaults so the rows still say something true.
   */
  const NO_PAD = {
    connected: false,
    sensitivity: 1.0, setSensitivity: (v) => v,
    deadzone: 0.12, setDeadzone: (v) => v,
    exponent: 2.0, setExponent: (v) => v,
    invertY: false, setInvertY: (v) => !!v,
    rumbleEnabled: false, setRumble: (v) => !!v,
    rumble: () => false,
    rates: () => ({ yaw: 0, pitch: 0 }),
    info: () => ({
      connected: false, index: -1, id: '', mapping: '',
      profile: 'standard', profileName: 'Standard mapping',
      assumed: false, vibration: false,
    }),
  };

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

  const spec = buildSpec({ rig, audio, mute, fidelity, pad: (input && input.pad) || NO_PAD });

  const tabsEl = root.querySelector('[data-pause-tabs]');
  const bodyEl = root.querySelector('[data-pause-body]');
  const resumeEl = root.querySelector('[data-pause-resume]');
  const titleEl = root.querySelector('[data-pause-title]');
  const saidEl = root.querySelector('[data-pause-said]');
  const markEl = root.querySelector('[data-pause-mark]');

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
    // The pad's list is drawn from a second table and after the first, so the
    // keyboard scheme stays where it has always been on the page. It also keeps
    // the "find the row that documents R" style of check in test/settings.mjs
    // resolving to the keyboard row it was written about.
    if (tab.padBindings) buildBindings(tab.padBindings, panel);
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
    // The cursor indexes THIS tab's controls, so it cannot survive a tab
    // change. Parked on Resume, which is where open() leaves it and which is
    // the one item every tab has.
    cursor = navList().length - 1;
    paintCursor();
    return active;
  }

  // -------------------------------------------------------------------------
  // THE PAD, ON THE MENU
  // -------------------------------------------------------------------------
  //
  // WHY THIS IS NOT OPTIONAL, and why it is in this file rather than in the
  // input layer.
  //
  // Options opens this panel. If the pad can do that and cannot then move the
  // selection, change a row, or resume, the player is STUCK: the only way out
  // is a keyboard they picked the controller up to avoid, and the feature is
  // worse than not having shipped it. A pad that can pause and cannot unpause
  // is a trap.
  //
  // It lives here because this file is the only thing that knows what a row is.
  // core/input.js emits four directions, a confirm, a back, and two tab
  // shoulders - the vocabulary of any menu - and knows nothing about sliders.
  // The subscription is the seam: input does not import the panel, and the
  // panel does not poll the hardware.

  /**
   * Where the pad's selection is, as an index into navList().
   *
   * The LAST entry is always the Resume button, and that is where the cursor
   * starts, because open() already focuses Resume for the keyboard. Two
   * different ideas of "the selected thing" on one panel is how a player ends
   * up pressing confirm and watching something else happen.
   */
  let cursor = 0;

  /** The element currently wearing the cursor mark, so it can be cleaned off. */
  let marked = null;

  /**
   * Whether the pad has actually driven this panel yet.
   *
   * Nothing is drawn until it has. The mark is a real visual change and drawing
   * it the moment the menu opens would put a gold rectangle on Resume in every
   * screenshot of this panel, on machines with no controller attached, for a
   * cursor nobody is steering.
   */
  let padArmed = false;

  /**
   * Every control on the active tab, in the order a thumb walks them.
   *
   * Rebuilt per call rather than cached. It is a walk over at most seven rows
   * and it happens on a keypress in a stopped game, and a cached list is a
   * cached list that can be stale after a tab change - which is precisely the
   * kind of bug that makes a menu select the wrong row.
   *
   * Readout rows are skipped. There is nothing to do to them and a cursor that
   * stops on an inert line reads as the menu having frozen.
   */
  function navList() {
    const tab = spec.find((t) => t.id === active);
    const out = [];

    for (const row of (tab ? tab.rows : [])) {
      const built = rows[row.id];
      if (!built) continue;
      if (built.input) out.push({ id: row.id, kind: 'range', row, el: built.input, wrap: built.wrap });
      else if (built.buttons.length) {
        out.push({
          id: row.id,
          kind: row.kind === 'choice' ? 'choice' : 'toggle',
          row,
          el: built.buttons[0][0],
          wrap: built.wrap,
          buttons: built.buttons,
        });
      }
    }

    out.push({ id: 'resume', kind: 'resume', el: resumeEl, wrap: resumeEl });
    return out;
  }

  /**
   * Draw the cursor.
   *
   * INLINE, and that is a deliberate choice rather than laziness. The mark
   * wants to be a class in index.html beside `#pause :focus-visible`, which is
   * where the panel's other focus treatment lives - but another lane owns that
   * file this week, the same constraint that put the death overlay in
   * JavaScript. It is authored to match that rule exactly, a 1px gold hairline
   * offset by 3px, so the two cannot look like two different affordances.
   *
   * The element is also FOCUSED, because focus is what makes Enter and the
   * arrow keys work on the same row a moment later, and what makes the browser
   * scroll a row into view inside a panel body that is taller than the sheet.
   */
  function paintCursor() {
    if (marked) { marked.style.outline = ''; marked.style.outlineOffset = ''; }
    marked = null;
    if (!padArmed || !paused) return;

    const list = navList();
    if (!list.length) return;
    cursor = Math.max(0, Math.min(list.length - 1, cursor));

    const item = list[cursor];
    if (!item || !item.wrap) return;

    marked = item.wrap;
    marked.style.outline = '1px solid var(--gold)';
    marked.style.outlineOffset = '3px';

    if (item.el && item.el.focus) item.el.focus({ preventScroll: true });
    if (item.wrap.scrollIntoView) item.wrap.scrollIntoView({ block: 'nearest' });
  }

  function clearCursor() {
    if (marked) { marked.style.outline = ''; marked.style.outlineOffset = ''; }
    marked = null;
    padArmed = false;
  }

  /**
   * How far one press moves a slider.
   *
   * A quarter of a per cent per press - which is what the row's own `step` is
   * on the sensitivity control - would take four hundred presses to cross the
   * range, so a pad player would give up before reaching the other end. Forty
   * presses is roughly two seconds of holding the stick over at the repeat rate
   * in core/gamepad.js, and is snapped to a whole number of the row's steps so
   * the value still lands on the grid the mouse would land on.
   */
  function padStep(row) {
    const span = Math.abs(row.max - row.min);
    const n = Math.max(1, Math.round((span / 40) / row.step));
    return n * row.step;
  }

  /** Steps are decimal fractions, and floats accumulate. Snap to the grid. */
  function snap(v, row) {
    const steps = Math.round((v - row.min) / row.step);
    const out = row.min + steps * row.step;
    // Six places is well past any step this panel uses and well short of where
    // the double's own error lives.
    return Math.min(row.max, Math.max(row.min, +out.toFixed(6)));
  }

  /** Left and right: change the thing the cursor is on. */
  function adjust(dir) {
    const list = navList();
    const item = list[Math.max(0, Math.min(list.length - 1, cursor))];
    if (!item) return;

    if (item.kind === 'range') {
      const next = snap(Number(item.row.read()) + dir * padStep(item.row), item.row);
      item.row.write(next);
      paint(item.row);
      return;
    }

    if (item.kind === 'toggle') {
      item.row.write(!item.row.read());
      paint(item.row);
      return;
    }

    if (item.kind === 'choice') {
      const vals = item.row.choices.map(([, v]) => v);
      const at = vals.indexOf(item.row.read());
      const next = vals[(at + dir + vals.length * 2) % vals.length];
      item.row.write(next);
      paint(item.row);
      return;
    }

    // Resume has nothing to adjust. Left and right there move the TAB instead,
    // which is what a thumb sitting on the bottom of the panel expects to
    // happen and costs nothing to grant.
    stepTab(dir);
  }

  function stepTab(dir) {
    const ids = spec.map((t) => t.id);
    const at = ids.indexOf(active);
    show(ids[(at + dir + ids.length) % ids.length]);
  }

  /**
   * The handler core/input.js calls.
   *
   * Returns true when it CONSUMED the action, which is the contract that lets
   * the same confirm button answer the death card: an unclaimed 'accept' falls
   * through to a synthetic Enter in the input layer, and the card reads Enter.
   * So this refuses everything unless the panel is genuinely up.
   */
  function padMenu(action) {
    if (!paused) return false;

    padArmed = true;

    switch (action) {
      case 'up': cursor -= 1; break;
      case 'down': cursor += 1; break;
      case 'left': adjust(-1); break;
      case 'right': adjust(1); break;
      case 'tabPrev': stepTab(-1); padArmed = true; break;
      case 'tabNext': stepTab(1); padArmed = true; break;
      case 'accept': {
        const list = navList();
        const item = list[Math.max(0, Math.min(list.length - 1, cursor))];
        if (item && item.kind === 'resume') { resume(); return true; }
        // On anything else confirm means the same as a nudge to the right: it
        // flips a toggle, advances a choice, and raises a slider. A confirm
        // that did nothing on four rows out of six would read as broken.
        adjust(1);
        break;
      }
      case 'back':
        resume();
        return true;
      default:
        return false;
    }

    // WRAPPING, not clamping. A list of seven items on a stopped game is short
    // enough that walking off the bottom and arriving at the top is faster than
    // walking back up, and a cursor that jams at the end of a list feels like
    // the input died.
    const n = navList().length;
    if (n > 0) cursor = ((cursor % n) + n) % n;
    paintCursor();
    return true;
  }

  const detachMenu = (input && input.onMenu) ? input.onMenu(padMenu) : () => {};

  // -------------------------------------------------------------------------
  // opening and closing
  // -------------------------------------------------------------------------

  /**
   * Stop the game.
   *
   * IDEMPOTENT, and that is load-bearing rather than defensive: main.js calls
   * this from both the Esc keydown and the pointerlockchange that the same Esc
   * produced, and on most paths both arrive. Two opens must be one pause.
   *
   * @param {'paused'|'title'} [mode]  what the panel is being opened AS
   */
  function open(mode = 'paused') {
    if (paused) return false;
    paused = true;

    // Say which state this is BEFORE the panel is shown, so there is never a
    // frame of the wrong heading. Defaults to 'paused', which is what every
    // existing caller - the Esc key, the pointer-lock loss, the tab going
    // hidden, and the harness - passes by passing nothing.
    const [name, said, mark] = HEADINGS[mode] || HEADINGS.paused;
    if (titleEl) titleEl.textContent = name;
    if (saidEl) saidEl.textContent = said;
    // setAttribute rather than `.href`, which on an SVGUseElement is a
    // read-only SVGAnimatedString: assigning it sets an expando and changes
    // nothing on screen. Same class of failure as `.hidden` on an <svg>, which
    // is how the fuse ring shipped invisible.
    if (markEl) markEl.setAttribute('href', mark);

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
    // The pad cursor starts unarmed and parked on Resume every time the panel
    // opens. Carrying a selection over from the last pause would put the mark
    // on a row the player has forgotten choosing.
    clearCursor();
    show(active);
    // Focus the resume button so the panel is keyboard-reachable the moment it
    // appears, and so Enter does the obvious thing. The pad's cursor is parked
    // on the same button by show(), so both devices agree about what confirm
    // would do before either has been touched.
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

    /**
     * AND WHATEVER THE PAD LEFT FOCUSED, for exactly the same reason one line
     * up. The pad's cursor focuses the control it is sitting on, so resuming
     * from a toggle would leave a BUTTON focused and swallow the jump key; and
     * resuming from a slider would leave an input focused that eats the arrow
     * keys. The Resume blur above only covers the row the keyboard uses.
     */
    const held = document.activeElement;
    if (held && held !== document.body && root.contains(held) && held.blur) held.blur();
    clearCursor();

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
    padBindings: PAD_BINDINGS,

    /**
     * The pad's own way in, and out, exposed for the harness.
     *
     * padMenu is what core/input.js calls; driving it directly is how
     * test/gamepad.mjs proves the panel navigates without having to pretend to
     * be a controller for the DOM's benefit as well as for the input layer's.
     * The pad is ALSO driven end to end in that suite through a synthetic
     * gamepad, because these two are different claims: one says the menu logic
     * is right, the other says the wire from the hardware to it is connected.
     */
    padMenu,
    get padCursor() {
      const list = navList();
      const at = Math.max(0, Math.min(list.length - 1, cursor));
      const item = list[at];
      return {
        index: at,
        count: list.length,
        id: item ? item.id : null,
        kind: item ? item.kind : null,
        armed: padArmed,
      };
    },

    dispose() { detachMenu(); clearCursor(); },
  };
}
