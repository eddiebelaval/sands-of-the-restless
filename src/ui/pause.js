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
 * There is none for the SETTINGS, still on purpose. STATE.md and the README both
 * carry the project constraint "No browser storage. All state in memory.",
 * inherited from the original design spec, and a settings panel is exactly the
 * feature that would quietly break it. Every slider below lives for the session
 * and resets on reload.
 *
 * THE KEY BINDINGS ARE THE ONE EXCEPTION, and it is the owner's call rather than
 * this file's, made when he asked for a control centre. A rebind that does not
 * survive a reload is a rebind the player performs again every session, which is
 * worse than not having shipped the editor at all. So core/keymap.js persists
 * ONE key, with a schema version and validation on the way in, and nothing else
 * here writes to storage.
 */

import { keymap } from '../core/keymap.js';

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
 * WHAT CHANGED WHEN THE LIST BECAME EDITABLE: the key caps are no longer written
 * here. A row names ACTIONS and core/keymap.js says which keys those actions
 * currently answer to, so a rebind moves the caps on this page in the same frame
 * it moves the handler, and the list can no longer be right on the day it was
 * written and wrong a month later. That was the whole failure this tab exists to
 * close, and a hand-written cap would have reopened it one layer down.
 *
 * The sentence stays here, because it is a sentence about the GAME - "the fuse
 * starts when the key goes down" is not a fact about a key code - and because it
 * is written for the player rather than for the handler.
 */
const KEY_ROWS = [
  {
    group: 'Movement',
    rows: [
      { actions: ['forward', 'left', 'back', 'right'], what: 'Move' },
      { actions: ['sprint'], what: 'Sprint' },
      { actions: ['jump'], what: 'Jump' },
      // A TAP AND NOT A HOLD, and the row says so, because a player who holds C
      // and watches the camera stay down has learned the wrong thing about the
      // binding and will blame the second tap when it stands them up.
      { actions: ['crouch'], what: 'Crouch - tap to go down, tap again to stand' },
      // The slide is stated as what it is: a crouch taken at speed. It has no
      // key of its own and the row is written so nobody goes looking for one.
      //
      // ECHO: it restates the row above rather than owning a binding, so it is
      // drawn with the crouch keys and is NOT an edit target. Two rows arming
      // the same capture is a menu that looks like it has two bindings for one
      // verb, which is the confusion the row's own sentence exists to prevent.
      { actions: ['crouch'], echo: true, what: 'Slide - crouch while you are already sprinting' },
      { actions: ['look'], what: 'Look' },
    ],
  },
  {
    group: 'Fighting',
    rows: [
      { actions: ['fire'], what: 'Fire' },
      { actions: ['aim'], what: 'Aim down sight' },
      { actions: ['reload'], what: 'Reload' },
      // THE BLADE, which was missing from this list entirely until the editor
      // was built. It was taught by a one-time notice the first time the player
      // ran dry and by the title card, and a player who missed both had a weapon
      // with no entry in the one place a control scheme is looked up. Nothing
      // caught it, because a list cannot be audited against a scheme that was
      // only ever written down here.
      { actions: ['melee'], what: 'Khopesh - the blade, for an empty magazine' },
      // The one the owner could not find. Stated in full, because "throw
      // grenade" would not have told him the fuse starts when the key goes DOWN.
      { actions: ['grenade'], what: 'Hold to cook a grenade, release to throw' },
    ],
  },
  {
    group: 'Weapons',
    rows: [
      /**
       * EIGHT ACTIONS ON ONE ROW, and that is a layout decision with a reason.
       *
       * Every slot has to be individually rebindable or the editor has a hole in
       * it, and eight rows of "Weapon slot 5" would be eight rows the tab cannot
       * afford - see the note beside the pad settings on the Game tab for what
       * six extra rows did to this page the last time. So the caps ARE the
       * controls: each one is its own edit target, the row is one line high, and
       * the range a player reads is the range the game runs, which is how the
       * old hand-written "1 to 7" survived the arrival of the eighth gun.
       */
      {
        actions: ['weapon1', 'weapon2', 'weapon3', 'weapon4',
          'weapon5', 'weapon6', 'weapon7', 'weapon8'],
        what: 'Select a weapon by slot',
      },
      // The wheel is a second way in and has no binding of its own, so it is
      // drawn as a plain cap beside the key that can be moved.
      { actions: ['cycleWeapon'], extra: ['Wheel'], what: 'Next weapon, and the wheel does the same' },
      { actions: ['inspect'], what: 'Inspect the weapon in hand' },
    ],
  },
  {
    group: 'The world',
    rows: [
      { actions: ['interact'], what: 'Buy, open, and use - whatever is under the crosshair' },
      { actions: ['pause'], what: 'Pause, and this panel' },
      // The same control as the Video tab's Render mode row. Both are listed
      // on purpose: a player looking for a key looks here, and a player looking
      // for a setting looks there.
      { actions: ['renderMode'], what: 'Cycle the render mode - Modern, PS1, N64' },
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
 * Kept apart from the keyboard rows rather than folded in, because the two
 * answer different questions and a player reads one or the other. Mixing them
 * would put "Square" and "Shift" in the same column and make both lists harder
 * to scan than either is alone.
 *
 * IT IS ALSO EDITABLE NOW, and it lost its hand-written key caps in the same
 * pass the keyboard list did, for the same reason: this page carried "L3
 * sprints" for a build after sprint moved to R3, and a controls page that
 * disagrees with the bindings is worse than no controls page, because the player
 * trusts it and then blames their own hands. The buttons come from
 * core/keymap.js and cannot be a build behind.
 *
 * The face buttons are named for the DualShock and not for the Xbox pad. The
 * standard gamepad mapping's index 0 is the bottom face button on every
 * controller ever made, so the code is portable; the LABEL has to match the
 * plastic in the owner's hands or it is telling him something untrue.
 */
const PAD_ROWS = [
  {
    group: 'Controller - moving and looking',
    rows: [
      { actions: ['move'], what: 'Move' },
      { actions: ['look'], what: 'Look' },
      { actions: ['sprint'], what: 'Sprint - click once, it holds until you stop' },
      { actions: ['crouch'], what: 'Crouch - tap to go down, tap again to stand' },
      // Stated as one binding doing two things rather than as a second binding,
      // because that is what it is, and because a player hunting the pad for a
      // slide button will find nothing and conclude the game has no slide.
      { actions: ['crouch'], echo: true, what: 'Slide - crouch while you are already sprinting' },
      { actions: ['jump'], what: 'Jump' },
    ],
  },
  {
    group: 'Controller - fighting',
    rows: [
      { actions: ['fire'], what: 'Fire - the trigger is read as an analog pull' },
      { actions: ['aim'], what: 'Aim down sight' },
      // SQUARE IS CONTEXTUAL and the row has to say both halves in the order
      // they resolve, because a player who reads only "Reload" will press it in
      // front of a wall buy and be surprised, and a player who reads only
      // "Interact" will hunt the pad for a reload that is under their thumb.
      { actions: ['interact'], what: 'Interact when a prompt is up - Reload when it is not' },
      { actions: ['grenade'], what: 'Hold to cook a grenade, release to throw' },
      // TWO CAPS, ONE ROW. Circle and a shoulder are one action with two
      // buttons - see PAD_ACTIONS - so this is one row where it used to be two,
      // and the second row saying "Khopesh, second binding" is gone with them.
      { actions: ['melee'], what: 'Khopesh' },
      // The shoulder rows above are the DEFAULT and the Game tab's Swap setting
      // exchanges them in pairs. THE LIST NOW REDRAWS ITSELF when it does, which
      // is the opposite of what this row used to say: the swap became a write to
      // the same table these caps are drawn from, so stating the rule in prose
      // would be stating it twice and the prose would be the half that goes
      // stale. Circle is not part of the exchange and never moves.
      { actions: [], extra: ['Swap'], echo: true, what: 'Bumpers and triggers exchange - see the Game tab' },
    ],
  },
  {
    group: 'Controller - the world and the menu',
    rows: [
      { actions: ['interact'], echo: true, what: 'Buy, open, and use - whatever is under the crosshair' },
      { actions: ['nextWeapon'], what: 'Next weapon' },
      // THE D-PAD IS THE MENU'S, AND IS NOT MOVABLE. See PAD_ACTIONS: a player
      // who bound a weapon onto D-pad down would be rebinding the cursor that
      // gets them out of this panel.
      { actions: ['inspect'], what: 'D-pad left and right cycle weapons, up inspects' },
      { actions: ['pause'], what: 'Pause, and this panel' },
      { actions: [], extra: ['Cross'], echo: true, what: 'In a menu: choose. Circle goes back and resumes' },
      { actions: [], extra: ['L1', 'R1'], echo: true, what: 'In a menu: previous and next tab' },
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
function buildSpec({ rig, audio, mute, fidelity, retro, pad }) {
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
          // The khopesh named here is the SHOULDER binding, which is the only
          // one this setting moves. Circle is the khopesh in either layout and
          // is left out rather than repeated on both lines, because a fact that
          // is true on both sides of a toggle is not what the toggle is about.
          /**
           * PRINTED FROM THE MAP, not from the two strings this used to carry.
           *
           * The swap is a write to the pad's binding table now, so the buttons
           * it produces are a fact that can be read rather than a sentence that
           * has to be kept in step. It also means this line stays true for a
           * player who has moved one of these rows by hand on the Controls tab,
           * where the old pair of strings would have been confidently wrong.
           */
          note: () => {
            const one = (id) => keymap.pad.labels(id).join('/');
            // The khopesh's SHOULDER, which is the only half of it this setting
            // moves. Circle is the khopesh in either layout and is left out
            // rather than repeated on both sides.
            const shoulder = keymap.pad.labels('melee').filter((c) => c !== 'Circle').join('/');
            return `Fire ${one('fire')}, aim ${one('aim')}, grenade ${one('grenade')}`
              + (shoulder ? `, khopesh ${shoulder}` : '');
          },
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
        {
          id: 'retro',
          kind: 'choice',
          label: 'Render mode',
          /**
           * THREE, NOT A TOGGLE, and the middle one is not a halfway house.
           *
           * The two consoles failed in opposite directions: the PlayStation had
           * no sub-pixel precision and no perspective correction, so it wobbled
           * and swam but drew hard pixels; the Nintendo 64 fixed both and spent
           * the difference on filtering everything soft. Listing them as a
           * choice rather than as a quality slider is the honest shape, because
           * neither is "more" than the other.
           */
          choices: [['Modern', 'off'], ['PS1', 'ps1'], ['N64', 'n64']],
          read: () => retro.get(),
          write: (v) => retro.set(v),
          value: () => {
            const s = retro.stats && retro.stats();
            return s ? s.name : 'Modern';
          },
          /**
           * The note prints the LIVE buffer size and filter rather than the
           * setting, because the setting is a number of lines and what the
           * player wants to know is how few pixels that turned out to be in
           * their window, and which way they are being scaled up. It is also
           * the cheapest possible check that the mode did what it says: a row
           * naming a mode over an unchanged pixel count is the whole of this
           * project's defining bug, visible from the menu.
           */
          note: () => {
            const s = retro.stats && retro.stats();
            if (!s) return 'Press P to cycle. Modern, then 1997, then 1996';
            const px = `${s.width}x${s.height}`;
            if (s.mode === 'ps1') {
              return `${px}, scaled up hard. Vertex wobble, warped textures,`
                + ` ${s.levels} colour levels. No AO, bloom, AA or shadows`;
            }
            if (s.mode === 'n64') {
              return `${px}, scaled up SMOOTH. No wobble, flat textures,`
                + ` ${s.levels} levels, ${s.fog}x fog. The blur is the point`;
            }
            return `Press P at any time. Currently rendering ${px}`;
          },
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
      // No settings rows. This tab is the keyboard's EDITABLE list and the pad's
      // read-only one, and the keyboard list has to stay at the top of it - see
      // the note beside the pad settings on the Game tab for what happened when
      // six controls were put above it. The editor was built under that same
      // budget: the edit affordance is the row and the caps themselves, so the
      // list gained one line for the khopesh and not a control panel.
      rows: [],
      keyRows: KEY_ROWS,
      padRows: PAD_ROWS,
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
export function createPauseMenu({ root, rig, audio, input, fidelity, retro, onResume }) {
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
   * The same idea one file over. The panel is constructed BEFORE core/retro.js
   * exists - main.js declares the binding, builds this, then builds the mode -
   * and it is also reachable from the title screen. Both cases want a control
   * that reads Off and does nothing rather than a thrown error over an open
   * menu.
   */
  const NO_RETRO = { get: () => 'off', set: () => {}, stats: () => null };

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

  const spec = buildSpec({ rig, audio, mute, fidelity, retro: retro || NO_RETRO, pad: (input && input.pad) || NO_PAD });

  const tabsEl = root.querySelector('[data-pause-tabs]');
  const bodyEl = root.querySelector('[data-pause-body]');
  const resumeEl = root.querySelector('[data-pause-resume]');
  const titleEl = root.querySelector('[data-pause-title]');
  const saidEl = root.querySelector('[data-pause-said]');
  const markEl = root.querySelector('[data-pause-mark]');
  const fineEl = root.querySelector('.pause-foot .fine');

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

  // -------------------------------------------------------------------------
  // THE KEYBOARD LIST, WHICH IS ALSO THE EDITOR
  // -------------------------------------------------------------------------
  //
  // WHY THE ROW IS THE CONTROL, and why there is no rebinding UI beyond it.
  //
  // This tab has a measured LAYOUT BUDGET. Six extra rows once pushed the key
  // bindings past the bottom of the scrolling body and test/settings.mjs
  // correctly reported the controls list at 1.01 to one, because it was no
  // longer on the screen - a player opening Controls to find the grenade key
  // would have found a stick sensitivity slider instead. Every obvious shape for
  // an editor spends that budget: a "change" button per row is a column, a
  // capture dialog is a second surface over the first, and a "currently binding"
  // banner is a row that exists to say what the row underneath it is doing.
  //
  // So the list stays the list, and the list is clickable. A click on a row -
  // or on one particular cap, which is how eight weapon slots fit on one line -
  // arms the capture, and everything the editor has to say is said IN THE ROW'S
  // OWN SENTENCE for a couple of seconds. Nothing appears, nothing moves, and
  // the page is exactly as tall while it is being edited as it is while it is
  // being read.
  //
  // The one thing that is added is a Reset control, and it sits on the FIRST
  // GROUP HEADING rather than under the list, on the line that already exists
  // and beside the only word on it. It is a sibling of .bind-group rather than a
  // child, so the legibility pass in test/settings.mjs keeps measuring a
  // heading made of text and not a heading with a button in it.

  /** Every built keyboard row, so a rebind can repaint both sides of a swap. */
  const bindRows = [];

  /**
   * Where the editor is, or null.
   *
   * One capture at a time, by construction: arming a second row disarms the
   * first. Two live captures would mean the next keystroke binding two actions
   * to one key, which the keymap would then have to resolve as a conflict with
   * itself.
   */
  let capture = null;

  /** Rows currently showing a message instead of their sentence, and the timer. */
  let messageTimer = 0;
  let messageRow = null;

  /**
   * The table a row is drawn from and edited against.
   *
   * The keyboard and the pad are the same machine over two namespaces, and this
   * is the only line that has to know which one a row belongs to. See the note
   * on makeTable in core/keymap.js for why they are not one namespace: a button
   * name and a key code must never be comparable, or Fire on Mouse0 and Fire on
   * R2 would be a conflict with itself.
   */
  const tableFor = (device) => (device === 'pad' ? keymap.pad : keymap);

  function drawCaps(built) {
    const keysEl = built.keys;
    const table = tableFor(built.device);
    keysEl.textContent = '';
    built.caps.clear();

    for (const id of built.spec.actions) {
      const fixed = table.isFixed(id);
      // One cap per DISTINCT label. Sprint answers to both Shifts and crouch to
      // both Control keys, and a row that drew "Shift Shift" would be reporting
      // an implementation detail as if it were two bindings.
      for (const cap of table.labels(id)) {
        const node = el('kbd', 'key-cap', keysEl);
        node.textContent = cap;
        if (!fixed && !built.spec.echo) {
          node.classList.add('key-edit');
          node.dataset.bindAction = id;
          node.setAttribute('role', 'button');
          node.setAttribute('tabindex', '0');
          node.title = `Change ${table.label(id)}`;
        }
        if (!built.caps.has(id)) built.caps.set(id, node);
      }
    }

    // Caps with no binding behind them: the wheel, which cycles weapons and
    // cannot be moved because it is not a key.
    for (const extra of (built.spec.extra || [])) {
      el('kbd', 'key-cap', keysEl).textContent = extra;
    }
  }

  /** Repaint every keyboard row from the table. Called after any change. */
  function drawBindings() {
    for (const built of bindRows) {
      drawCaps(built);
      if (built !== messageRow && built !== (capture && capture.built)) {
        built.what.textContent = built.spec.what;
      }
    }
  }

  /**
   * Say something in the row's own sentence, then put the sentence back.
   *
   * The message is where the conflict is reported, and reporting it is the whole
   * of the conflict rule that a player can see: a rebind that silently took a
   * key off another action would leave them hunting for a binding that has
   * moved, which is worse than the collision itself.
   */
  function say(built, text) {
    if (messageTimer) clearTimeout(messageTimer);
    if (messageRow && messageRow !== built) messageRow.what.textContent = messageRow.spec.what;
    messageRow = built;
    built.what.textContent = text;
    messageTimer = setTimeout(() => {
      messageTimer = 0;
      if (messageRow) messageRow.what.textContent = messageRow.spec.what;
      messageRow = null;
    }, 2400);
  }

  /**
   * The capture keydown, ON THE CAPTURE PHASE, and that is load-bearing.
   *
   * Every other binding on this page is a bubble-phase listener on `window`:
   * main.js reads the weapon digits and the render mode there, and the Esc that
   * would close this panel is read there too. A capture-phase listener on the
   * same target runs BEFORE all of them, so stopping propagation here means the
   * key the player is binding cannot also fire the thing it is currently bound
   * to. Without it, pressing P to bind something would cycle the render mode on
   * the way past, and pressing Esc to cancel would resume the game.
   */
  function onCaptureKey(e) {
    if (!capture) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;

    const built = capture.built;
    // A capture armed on a PAD row is waiting for a button, so a keystroke can
    // only cancel it. Binding the key that was pressed would put a keyboard code
    // in the pad's table, and the pad would be looking for a button called
    // KeyM for the rest of the session.
    if (built.device === 'pad' && e.code !== 'Escape') return;
    take(built, capture.action, e.code, e.code === 'Escape');
  }

  /**
   * ONE PLACE WHERE A CAPTURE RESOLVES, whichever device produced the input.
   *
   * Every branch says something, because "nothing visibly changed" is the one
   * outcome a player cannot tell apart from a menu that has stopped working -
   * and because a swap that was not announced is exactly the silent theft this
   * conflict rule exists to avoid.
   */
  function take(built, action, code, cancelled) {
    const table = tableFor(built.device);
    const was = table.labels(action).join(' ');
    disarm();

    if (cancelled) {
      say(built, 'Cancelled. Still on ' + (was || 'nothing'));
      drawBindings();
      return;
    }

    const res = table.bind(action, code);
    const cap = table.capFor(code);
    drawBindings();

    if (res.result === 'swapped') say(built, `${cap} bound. ${table.label(res.with)} took ${was}`);
    else if (res.result === 'bound') say(built, `Bound to ${cap}`);
    else if (res.result === 'unchanged') say(built, `Already ${cap}`);
    else if (res.result === 'refused') say(built, `${cap} is ${table.label(res.with)}, which cannot move`);
    else say(built, `${cap} cannot be bound`);
  }

  function disarm() {
    if (!capture) return;
    window.removeEventListener('keydown', onCaptureKey, true);
    if (capture.detachPad) capture.detachPad();
    capture.built.line.classList.remove('binding');
    capture.built.what.textContent = capture.built.spec.what;
    capture = null;
  }

  function arm(built, action) {
    const table = tableFor(built.device);
    if (!action || table.isFixed(action) || built.spec.echo) {
      if (action && table.isFixed(action)) say(built, `${table.label(action)} cannot be moved`);
      return false;
    }
    disarm();
    if (messageTimer) { clearTimeout(messageTimer); messageTimer = 0; }
    if (messageRow) { messageRow.what.textContent = messageRow.spec.what; messageRow = null; }

    capture = { built, action, detachPad: null };
    built.line.classList.add('binding');

    /**
     * THE PAD'S CAPTURE, THROUGH THE INPUT LAYER RATHER THAN AROUND IT.
     *
     * core/input.js already owns the poll and already knows that a suspended
     * game means menu mode; this asks it for the next BUTTON instead of the next
     * menu action, for exactly as long as a row is armed. The panel does not
     * poll the hardware and input does not know what a row is, which is the same
     * seam the menu subscription uses.
     *
     * OPTIONS CANCELS, and is the pad's Escape. It is the one button a player
     * cannot bind - it is Pause - so treating it as a binding would only ever
     * produce a refusal, and a controller player who armed a row by accident
     * needs a way out that does not involve finding a keyboard.
     */
    if (built.device === 'pad') {
      built.what.textContent = 'Press a button. Options cancels';
      capture.detachPad = (input && input.setPadCapture)
        ? input.setPadCapture((button) => {
          if (!capture) return false;
          take(built, action, button, button === 'options');
          return true;
        })
        : null;
    } else {
      // Short, because it replaces a sentence on a row that must not grow a
      // second line while it is being edited.
      built.what.textContent = 'Press a key. Esc cancels';
    }

    // The keyboard listener is armed either way: Escape cancels a pad capture
    // too, for the player who has both devices in front of them.
    window.addEventListener('keydown', onCaptureKey, true);
    return true;
  }

  /**
   * A binding list: built once, repainted on every change.
   *
   * ONE BUILDER FOR BOTH DEVICES. The keyboard list came first and the pad's was
   * a second, read-only function beside it that drew a hand-written table - and
   * that second table is where "R3 sprints" and "L3 sprints" managed to disagree
   * for a build. Drawing both from the same code against the same kind of table
   * is what makes that impossible rather than merely unlikely.
   */
  function buildBindings(groups, parent, device) {
    let first = true;

    for (const g of groups) {
      const block = el('div', 'bind-block', parent);

      const head = el('div', 'bind-head', block);
      const h = el('div', 'bind-group', head);
      h.textContent = g.group;

      // ONE reset, on the first heading. It resets the whole scheme rather than
      // the group it sits on, so a second copy further down would be the same
      // button twice and an invitation to think otherwise.
      if (first) {
        first = false;
        const table = tableFor(device);
        const btn = el('button', 'bind-reset', head);
        btn.type = 'button';
        btn.textContent = device === 'pad' ? 'Reset buttons' : 'Reset keys';
        btn.title = 'Back to the shipped scheme. Bindings are saved in this browser';
        const firstOfThis = bindRows.length;
        btn.addEventListener('click', () => {
          disarm();
          table.reset();
          drawBindings();
          const row = bindRows[firstOfThis];
          if (row) say(row, 'Back to the shipped scheme');
        });
      }

      for (const spec of g.rows) {
        const line = el('div', 'bind-row', block);
        const keys = el('span', 'bind-keys', line);
        const what = el('span', 'bind-what', line);
        what.textContent = spec.what;

        const built = { spec, line, keys, what, device, caps: new Map() };
        bindRows.push(built);
        drawCaps(built);

        /**
         * The row's own edit target is its FIRST movable action, which is what a
         * click anywhere on the line means. On the weapon row, where eight
         * actions share a line, the caps are individually addressed below and
         * stop the click from reaching this.
         *
         * A row whose actions are ALL fixed - Fire, Aim, Look, Pause - still
         * names one, so that clicking it says why it cannot be changed. A
         * control that ignores a click is indistinguishable from a broken one,
         * and this list is a list a player is going to click on.
         */
        const table = tableFor(device);
        const movable = spec.echo ? null : spec.actions.find((id) => !table.isFixed(id));
        const rowAction = movable || (spec.echo ? null : spec.actions[0]) || null;

        if (movable) {
          line.classList.add('bind-edit');
          line.setAttribute('role', 'button');
          line.setAttribute('tabindex', '0');
        }

        line.addEventListener('click', (e) => {
          const capEl = e.target instanceof HTMLElement
            ? e.target.closest('[data-bind-action]') : null;
          arm(built, capEl ? capEl.dataset.bindAction : rowAction);
        });

        // Enter and Space on a focused row, because the panel is reachable from
        // the keyboard and a control that can only be clicked is half a control.
        // Space is deliberately included even though it is Jump: the game is
        // stopped, the row has focus, and a focused control answering Space is
        // what every other button on this panel does.
        line.addEventListener('keydown', (e) => {
          if (capture) return;
          if (e.code !== 'Enter' && e.code !== 'Space') return;
          e.preventDefault();
          const capEl = e.target instanceof HTMLElement
            ? e.target.closest('[data-bind-action]') : null;
          arm(built, capEl ? capEl.dataset.bindAction : rowAction);
        });
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
    if (tab.keyRows) buildBindings(tab.keyRows, panel, 'key');
    // The pad's list is drawn from a second table and after the first, so the
    // keyboard scheme stays where it has always been on the page. It also keeps
    // the "find the row that documents R" style of check in test/settings.mjs
    // resolving to the keyboard row it was written about.
    if (tab.padRows) buildBindings(tab.padRows, panel, 'pad');
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

  /**
   * The fine print, WHICH TAB IT IS ABOUT.
   *
   * "Settings last for this run" is true of every slider on this panel and is
   * now false of exactly one tab: the key bindings are the only thing in the
   * game that is written to storage. A footer that states the general rule over
   * the one page it does not apply to is the same species of drift as a controls
   * list that has to be updated by hand - so it says which is which, on the line
   * that already exists, and the tab costs no height for it.
   */
  const FINE = {
    controls: 'Bindings are saved. Click one to change',
    other: 'Settings last for this run',
  };

  function show(id) {
    if (!panels[id]) return active;
    // A capture cannot outlive the tab it was armed on. The next keystroke would
    // otherwise bind a key on a page the player is no longer looking at.
    disarm();
    active = id;
    if (fineEl) fineEl.textContent = id === 'controls' ? FINE.controls : FINE.other;
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

  /**
   * REDRAW WHEN ANYTHING CHANGES A BINDING, INCLUDING THINGS THAT ARE NOT THIS
   * LIST.
   *
   * The Game tab's Swap setting moves four pad bindings, and it is a row on a
   * different tab that knows nothing about the controls page. Before this
   * subscription the swap was a hand-written sentence on the pad list precisely
   * because the list did not redraw; now it does, and the sentence is gone. The
   * console can also reset the map, and a panel that painted its caps once at
   * construction is the stale surface this whole feature exists to abolish.
   */
  const detachKeymap = keymap.onChange(() => drawBindings());

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
    // Redraw the key caps from the table on the way in. This panel is not the
    // only thing that can change a binding - core/keymap.js is a shared object
    // and the console can reset it - and a page that painted its caps once at
    // construction would be the exact stale surface this whole feature exists to
    // stop existing.
    drawBindings();
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

    // A live capture must never survive the panel closing. Its listener is on
    // the capture phase of `window` and would eat the first keystroke of the
    // resumed game - and bind it.
    disarm();

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
    keyRows: KEY_ROWS,
    padRows: PAD_ROWS,

    /**
     * THE EDITOR, EXPOSED FOR THE HARNESS, and only as far as it has to be.
     *
     * `binding` reports which action is armed, so a suite can prove that a click
     * on a row entered the capture state rather than inferring it from the text
     * on the row. `rebindRows` is what is currently DRAWN, which is a different
     * claim from what core/keymap.js holds - the whole class of bug this project
     * keeps hitting is a value that changed and a surface that did not, and the
     * only way to catch it is to read the two separately and compare them.
     *
     * Nothing here binds a key. test/bindings.mjs drives real clicks and real
     * keystrokes for that, on purpose: a rebind proved by calling the binder is
     * a rebind that proves nothing about the panel.
     */
    get binding() { return capture ? capture.action : null; },
    rebindRows() {
      return bindRows.map((b) => ({
        what: b.what.textContent,
        sentence: b.spec.what,
        device: b.device,
        actions: b.spec.actions.slice(),
        editable: b.line.classList.contains('bind-edit'),
        keys: [...b.keys.querySelectorAll('.key-cap')].map((k) => k.textContent),
      }));
    },
    keymap,

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

    dispose() { detachMenu(); detachKeymap(); clearCursor(); disarm(); },
  };
}
