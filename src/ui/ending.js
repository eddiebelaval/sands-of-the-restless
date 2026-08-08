/**
 * THE END OF WORLD 1: the card that is the death card's sibling, and the gate
 * that decides the run is over.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS MISSING
 * ---------------------------------------------------------------------------
 *
 * Nothing in `src/` could conclude a run. There was no `gameWon`, no victory
 * path, no wave ceiling: `director.beginWave()` incremented forever and
 * `bosses.forWave()` cycled the five gods forever, so the only way a run ended
 * was the player dying. A world with a written ending had no mechanism able to
 * reach it. `enemies/director.js` now stops at wave twenty-five; this file is
 * the other half, and the halves are deliberately separate - the director's job
 * is "no more waves", and whether the WORLD ends is a question about canopic
 * jars and about which room the player is standing in, neither of which a wave
 * director should ever have heard of.
 *
 * ---------------------------------------------------------------------------
 * THE GATE: THREE CONDITIONS, AND WAVE 25 IS ONLY ONE OF THEM
 * ---------------------------------------------------------------------------
 *
 *   1. The run has CONCLUDED. Set fell on wave twenty-five and the field is
 *      clear. Necessary, and on its own not sufficient.
 *   2. FOUR SONS ARE HOME. The chain is finished, which is what unsealed the
 *      chapel in the first place - a player who reaches wave twenty-five having
 *      ignored the jars has not finished World 1 and is not shown its ending.
 *   3. THE PLAYER IS IN THE SERDAB. Not near it, not looking at it. Inside.
 *
 * The third one is why this beat can exist at all, and it is architecture
 * rather than staging: the Serdab is the only room in twenty-five waves with no
 * spawn points, so it is the only room in the game where the player can be
 * alone. Every other space has a horde in it or a horde arriving.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SIBLING OF ui/death.js AND NOT A FLAG ON IT
 * ---------------------------------------------------------------------------
 *
 * The two cards share a shape, a stylesheet vocabulary and a confirm gate, and
 * they share them THROUGH `ui/tokens.js`, which is what that file is for. What
 * they do not share is a sequence: the death card judges the player, erases
 * them and stands them back up twenty times a run, and this one happens once
 * and does not stand anybody back up. A flag on death.js would have put "the
 * run restarts" and "the run is over" in one state machine with a boolean
 * deciding which, and the reset rule at the top of that file - what carries
 * over and what does not - would then have had to be read twice, once for each
 * meaning.
 *
 * The echo is deliberate and it is the point: the player has read the death
 * card twenty times, so a card in that shape arriving after they have WON is
 * the game saying something it has never said in words. Inside the cartouche
 * the glyphs are struck out again. Underneath: THE NAME IS NOT HERE.
 *
 * ---------------------------------------------------------------------------
 * WHAT CONFIRM DOES, AND WHAT IT HONESTLY CANNOT DO YET
 * ---------------------------------------------------------------------------
 *
 * The narrative is that he confirms, and when the frame comes back he is in the
 * eleventh niche going down. THE FRAME COMES BACK IN WORLD 2, and World 2 does
 * not exist. So confirm takes the screen to black and leaves it there, holding
 * the run, and fires `onDescend` for whoever eventually catches it.
 *
 * That is the honest shape rather than a placeholder: World 1's own boundary is
 * "the moment the player climbs into the eleventh niche", and there is nothing
 * on the far side of that boundary in this build. A fake return to the start
 * screen would be inventing an ending the story does not have. The one line
 * that changes when World 2 lands is inside `descend()`.
 *
 * THE ELEVENTH NICHE IS NOT BUILT AND MUST NOT BE BUILT FROM HERE. It is a
 * recess in the Serdab's side wall and it belongs to that room's art lane, along
 * with the ten figures, the archaeologist and the struck cartouche. It also sits
 * behind a hard flag: `star-shaft -> serdab` clears the doorway rule with
 * exactly zero slack, so nothing may change the Serdab's floor or its ceiling,
 * and the niche stays a recess that becomes a shaft precisely because that costs
 * no room geometry.
 *
 * ---------------------------------------------------------------------------
 * TIME AND THE FREEZE
 * ---------------------------------------------------------------------------
 *
 * Every clock here is main.js's CLAMPED simulation delta, the same one the
 * horde and the death card run on, for the reason death.js states at length:
 * sim time degrades into "slower" rather than into "skipped".
 *
 * `halted` is read by main.js exactly as `death.halted` is, and it is true from
 * the frame the ending begins and never goes false again. The world stops. That
 * is not a freeze bug, it is the end of the world.
 */

import { PIGMENT, ROLE, FORM, ink, incised, registerRules } from './tokens.js';

// ---------------------------------------------------------------------------
// the beats, in seconds of SIMULATION time
// ---------------------------------------------------------------------------

/**
 * How long the screen is black before the card lands.
 *
 * Longer than the death card's 0.88, and for the opposite reason. The death
 * card lands on the tail of the camera's fall so the verdict reads as the last
 * beat of the motion; here there is no motion, and the black IS the beat. She
 * has just looked at him with nothing to ask and the frame went out.
 */
const CARD_AT = 1.25;

/** How long the card stands alone before the way out appears. death.js's number. */
const ARM_AFTER = 0.55;

/** How long the card takes to go out again once confirmed. */
const DESCEND = 0.70;

/** Enter, and nothing else. Same argument as death.js's CONFIRM_CODE. */
const CONFIRM_CODE = 'Enter';

const CONFIRM_ID = 'ending-confirm';
const ROOT_ID = 'ending';

/** The line under the cartouche, and it is the last text in World 1. */
const VERDICT = 'THE NAME IS NOT HERE';

/**
 * How many struck glyphs stand inside the cartouche.
 *
 * FOUR, matching the four sons whose jars completed the name on the Serdab's
 * back wall an hour of play ago. Nothing points at that and nothing should:
 * the player restored a cartouche with four things in it and is now looking at
 * a cartouche with four things struck out of it.
 */
const GLYPHS = 4;

/**
 * Build the overlay in JavaScript, for death.js's reason: this is not part of
 * the document, it is part of a sequence, and it should not exist in the page
 * of a game nobody has finished.
 */
function build(doc) {
  const style = doc.createElement('style');
  style.id = 'ending-style';
  style.textContent = css();
  doc.head.appendChild(style);

  const root = doc.createElement('div');
  root.id = ROOT_ID;

  /*
   * FLAT BLACK, NOT A VIGNETTE, and it is the one place this card deliberately
   * refuses the death card's treatment.
   *
   * death.js washes the frame from the edges the way vision goes, because the
   * player is still IN the world and dying in it. Here the world is gone: the
   * narrative word is "then black", and a vignette is a picture of a room with
   * the lights down whereas this is the absence of a picture. It is also what
   * makes the black the card confirms into indistinguishable from the black it
   * arrived out of, which is what lets the descent be a fade of the text alone.
   */
  const wash = doc.createElement('div');
  wash.className = 'ending-wash';
  root.appendChild(wash);

  const card = doc.createElement('div');
  card.className = 'ending-card';

  const ruleTop = doc.createElement('div');
  ruleTop.className = 'ending-rule';
  card.appendChild(ruleTop);

  // The cartouche, the same oval a name goes in, with no name in it.
  const cart = doc.createElement('div');
  cart.className = 'ending-cartouche';

  const glyphs = doc.createElement('div');
  glyphs.className = 'ending-glyphs';
  for (let i = 0; i < GLYPHS; i++) {
    const g = doc.createElement('span');
    g.className = 'ending-glyph';
    glyphs.appendChild(g);
  }
  cart.appendChild(glyphs);

  // The shen bar. Frame ornament, exactly as on the death card.
  const shen = doc.createElement('div');
  shen.className = 'ending-shen';
  cart.appendChild(shen);

  card.appendChild(cart);

  const line = doc.createElement('div');
  line.className = 'ending-line';
  line.textContent = VERDICT;
  card.appendChild(line);

  const ruleBot = doc.createElement('div');
  ruleBot.className = 'ending-rule';
  card.appendChild(ruleBot);

  const on = doc.createElement('button');
  on.id = CONFIRM_ID;
  on.className = 'ending-again';
  on.type = 'button';
  on.textContent = 'GO DOWN   [ENTER]';
  card.appendChild(on);

  root.appendChild(card);
  doc.body.appendChild(root);

  return { root, card, cart, glyphs, line, again: on };
}

function css() {
  const gold = ink(ROLE.frame, 0.85);
  const goldDim = ink(ROLE.frame, 0.30);

  return `
#${ROOT_ID} {
  position: fixed; inset: 0; z-index: 56;
  display: none;
  align-items: center; justify-content: center;
  pointer-events: none;
  font-family: 'Cinzel', 'Trajan Pro', Georgia, serif;
}
#${ROOT_ID}.on { display: flex; }

.ending-wash {
  position: absolute; inset: 0;
  background: ${ink(PIGMENT.shadow, 1)};
}

.ending-card {
  position: relative;
  display: flex; flex-direction: column; align-items: center;
  gap: clamp(10px, 1.6vh, 20px);
  padding: clamp(18px, 3vh, 40px) clamp(24px, 5vw, 76px);
  max-width: 92vw;
  text-align: center;
  /* The whole card fades on the descent. The wash does not: black stays. */
  opacity: 1;
  transition: none;
}
#${ROOT_ID}.going .ending-card { opacity: 0; transition: opacity ${DESCEND}s linear; }

.ending-rule {
  width: min(70vw, 760px); height: ${FORM.hairline + FORM.ruleGap}px;
  background: ${registerRules('top', ROLE.frame, 0.55)};
}

.ending-cartouche {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  max-width: 94vw;
  padding: clamp(10px, 2.2vh, 26px) clamp(34px, 6vw, 96px)
           clamp(10px, 2.2vh, 26px) clamp(26px, 5vw, 76px);
  border: ${FORM.hairline}px solid ${gold};
  border-radius: ${FORM.pillRadius};
  background:
    linear-gradient(${ink(PIGMENT.plaster, 0.34)}, ${ink(PIGMENT.stone, 0.46)});
  box-shadow:
    inset 0 ${FORM.incisionDepth}px 0 ${ink(PIGMENT.shadow, 0.9)},
    inset 0 -${FORM.incisionDepth}px 0 ${ink(PIGMENT.goldDeep, 0.5)};
}

.ending-shen {
  position: absolute; right: clamp(14px, 2.4vw, 34px);
  top: 22%; bottom: 22%;
  width: ${FORM.hairline * 2}px;
  background: ${gold};
}

/*
 * THE STRUCK GLYPHS.
 *
 * Blocks, not letters, and that is the requirement rather than a shortcut: a
 * struck-out name is a name you cannot read, so anything legible in here would
 * be the card handing back the thing it is withholding. Each one is a slab of
 * incised stone with a single hard rule driven across it, which is what
 * effacement actually looks like on a wall - the glyph is still cut, and
 * somebody came back and cut through it.
 *
 * Sized off the same clamp the death card's word uses, scaled down, so the
 * cartouche keeps the proportions the player has learned to read it at.
 */
.ending-glyphs {
  display: flex; align-items: center;
  gap: clamp(10px, 1.6vw, 22px);
}
.ending-glyph {
  position: relative;
  display: block;
  width: clamp(20px, 4.0vw, 56px);
  height: clamp(30px, 6.0vw, 84px);
  background: linear-gradient(${ink(PIGMENT.stone, 0.85)}, ${ink(PIGMENT.shadow, 0.92)});
  border: ${FORM.hairline}px solid ${ink(ROLE.frame, 0.42)};
  box-shadow: inset 0 ${FORM.incisionDepth}px 0 ${ink(PIGMENT.shadow, 0.95)};
}
.ending-glyph::after {
  content: '';
  position: absolute; left: -12%; right: -12%; top: 50%;
  height: ${Math.max(2, FORM.hairline * 3)}px;
  transform: translateY(-50%) rotate(-8deg);
  background: ${ink(ROLE.frame, 0.9)};
}

.ending-line {
  font-size: clamp(13px, 2.2vw, 30px);
  letter-spacing: ${FORM.labelTracking};
  color: ${ink(ROLE.textBright)};
  text-shadow: ${incised(10)};
}

.ending-again {
  margin-top: clamp(4px, 1vh, 14px);
  pointer-events: auto;
  font: inherit;
  font-size: clamp(11px, 1.3vw, 17px);
  letter-spacing: ${FORM.labelTracking};
  color: ${ink(ROLE.ready)};
  background: linear-gradient(${ink(PIGMENT.plaster, 0.5)}, ${ink(PIGMENT.stone, 0.6)});
  border: ${FORM.hairline}px solid ${goldDim};
  border-radius: ${FORM.pillRadius};
  padding: 0.62em 1.9em;
  cursor: pointer;
  text-shadow: ${incised()};
  visibility: hidden;
}
.ending-again.armed { visibility: visible; }
.ending-again:hover { color: ${ink(ROLE.textBright)}; border-color: ${gold}; }
`;
}

/**
 * @param {object} parts
 * @param {Document} parts.doc
 * @param {object} parts.director  the wave ceiling: `state.concluded`
 * @param {object} parts.doors     the jar counter: `state.jarsReturned`
 * @param {object} parts.spaces    which room the player is standing in
 * @param {object} [parts.input]   frozen while the ending holds
 * @param {object} [parts.audio]
 * @param {object} [parts.rig]
 * @param {function} [parts.suspended] true while the pause menu is up
 */
export function createEnding({
  doc, director, doors, spaces, input, audio, rig, suspended,
}) {
  const el = build(doc);

  const state = {
    /** 'none' | 'black' | 'waiting' | 'going' | 'descended' */
    phase: 'none',
    /** Seconds of SIM time since the world ended. */
    t: 0,
    armed: false,
    pending: false,
    /** The wave it ended on, frozen at the moment it did. */
    wave: 0,
    /** Which of the three gate conditions was last missing, for the harness. */
    waitingOn: null,
  };

  const listeners = new Set();

  // The same held-key defence the death card carries, for the same reason: the
  // player has been holding fire and mashing reload for twenty-five waves, and
  // a key already down when the card appears must not satisfy the gate.
  let heldNow = false;
  let stale = false;

  function onKeyDown(e) {
    if (e.code !== CONFIRM_CODE) return;
    heldNow = true;
    if (e.repeat) return;
    if (stale) return;
    if (suspended && suspended()) return;
    if (state.phase !== 'waiting' || !state.armed) return;
    e.preventDefault();
    confirm();
  }

  function onKeyUp(e) {
    if (e.code !== CONFIRM_CODE) return;
    heldNow = false;
    stale = false;
  }

  doc.defaultView.addEventListener('keydown', onKeyDown);
  doc.defaultView.addEventListener('keyup', onKeyUp);

  el.again.addEventListener('click', () => {
    if (state.phase !== 'waiting') return;
    confirm();
  });

  function suspendInput(on) {
    if (!input || !input.setSuspended) return;
    if (!!input.state.suspended === !!on) return;
    input.setSuspended(on);
  }

  // ---------------------------------------------------------------------------
  // the gate
  // ---------------------------------------------------------------------------

  /**
   * Are all three conditions true right now.
   *
   * Records WHICH one is missing rather than returning a bare boolean, because
   * "the ending did not fire" has three completely different causes and a
   * harness that cannot tell them apart cannot tell a broken gate from a run
   * that has not finished the puzzle. Nothing on screen ever reads this.
   */
  function ready() {
    if (!director || !director.state.concluded) { state.waitingOn = 'wave'; return false; }
    if (!doors || doors.state.jarsReturned < 4) { state.waitingOn = 'jars'; return false; }
    if (!spaces || spaces.active !== 'interior' || spaces.roomId !== 'serdab') {
      state.waitingOn = 'room';
      return false;
    }
    state.waitingOn = null;
    return true;
  }

  /** The world ends. Only ever called from update(), which is the frame loop. */
  function begin() {
    if (state.phase !== 'none') return false;

    state.phase = 'black';
    state.t = 0;
    lastTick = 0;
    state.armed = false;
    state.pending = false;
    state.wave = (director && director.state && director.state.wave) || 0;

    stale = heldNow;
    suspendInput(true);

    // The world is behind the wash from this frame, so the card's root goes on
    // now and the card inside it appears at CARD_AT. One class, two beats.
    el.root.classList.add('on');
    el.card.style.visibility = 'hidden';

    // No fanfare. The frame going out IS the event, and the last thing the
    // player heard was a room with nothing in it.
    audio?.stopAll?.();
    return true;
  }

  function confirm() {
    if (state.phase !== 'waiting') return false;
    state.pending = true;
    return true;
  }

  /**
   * He climbs into the eleventh niche.
   *
   * The card fades and the black stays, and the run is held from here forever.
   * See the header: the frame comes back in World 2, and the listeners are how
   * it will. Everything World 2 needs to know is "this happened"; it does not
   * need anything from this file's state.
   */
  function descend() {
    state.phase = 'going';
    state.t = 0;
    lastTick = 0;
    el.root.classList.add('going');
    el.again.classList.remove('armed');
    for (const fn of listeners) fn();
  }

  /**
   * THE CARD RUNS ON THE WALL CLOCK, AND IT IS THE ONE CLOCK IN THIS FILE THAT
   * IS NOT THE SIMULATION'S.
   *
   * It used to add main.js's clamped `dt`, on the header's stated reasoning that
   * this card should keep time the way the death card does. That reasoning does
   * not survive contact with what the two cards actually are.
   *
   * `MAX_DELTA` is 1/20, so a frame contributes at most 0.05s of sim time no
   * matter how long it really took. Under 20fps the simulation deliberately
   * runs SLOW rather than skipping - which is right for a player who must not
   * be teleported through a wall, and wrong for a title card on a black screen,
   * because there is no longer a world to be teleported through. Worse, the
   * frame the world ends on is the most expensive in the game: twenty-five waves
   * of dressing, and the renderer still drawing all of it behind an opaque wash
   * nobody can see through.
   *
   * Measured: six seconds of real time advanced this clock by 0.7s, against the
   * 1.25s the card waits. The owner finished a real run, walked into the Serdab
   * and reported "the screen turned black and nothing happened". Nothing was
   * broken. The card was coming, on a clock that had slowed to a crawl at the
   * exact moment the thing keeping it slow had stopped mattering.
   *
   * The death card keeps sim time and should: its beat lands on the tail of a
   * camera fall that IS simulation, so the two must degrade together. Here
   * nothing moves. There is nothing to stay in step with.
   *
   * Accrued per call rather than measured from the phase start so that a frame
   * loop which stops calling update - the pause menu returns before this - costs
   * the card no time, and clamped per step so a backgrounded tab resumes into
   * the beat it left rather than skipping straight past the card.
   */
  const clock = () => (doc.defaultView.performance || Date).now();
  const MAX_STEP = 0.25;
  let lastTick = 0;

  function step() {
    if (state.phase === 'none') {
      if (ready()) begin();
      return;
    }

    const t = clock();
    state.t += lastTick ? Math.min((t - lastTick) / 1000, MAX_STEP) : 0;
    lastTick = t;

    if (state.phase === 'black') {
      if (state.t >= CARD_AT) {
        el.card.style.visibility = 'visible';
        state.phase = 'waiting';
      }
      return;
    }

    if (state.phase === 'waiting') {
      if (!state.armed && state.t >= CARD_AT + ARM_AFTER) {
        state.armed = true;
        el.again.classList.add('armed');
      }
      if (state.pending) descend();
      return;
    }

    if (state.phase === 'going') {
      if (state.t >= DESCEND) {
        state.phase = 'descended';
        el.card.style.visibility = 'hidden';
      }
    }
  }

  return {
    state,
    begin,
    confirm,

    update() {
      step();
      // Re-asserted rather than set once: ui/pause.js is the other writer of
      // the input freeze and does not know the world has ended. death.js keeps
      // the same guard for the same reason.
      if (state.phase !== 'none') suspendInput(true);
    },

    /** Register for the descent. World 2's one-line hook. */
    onDescend(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /**
     * THE FREEZE. main.js reads this beside `death.halted` and skips the whole
     * simulation block. True from the frame the world ends, with no way back.
     */
    get halted() { return state.phase !== 'none'; },

    get phase() { return state.phase; },
    get waiting() { return state.phase === 'waiting'; },
    get armed() { return state.armed; },

    /** The line on the card, so a suite can assert the card and not the DOM. */
    get verdict() { return el.line.textContent; },

    confirmId: CONFIRM_ID,

    stats() {
      // Measured, not assumed. This project's defining bug is UI that was
      // written, believed and never rendered, so the harness is handed the
      // laid-out box of the line and the struck glyph count off the DOM rather
      // than the fact that both were created.
      const r = el.line.getBoundingClientRect();
      return {
        phase: state.phase,
        t: +state.t.toFixed(2),
        armed: state.armed,
        wave: state.wave,
        waitingOn: state.waitingOn,
        shown: el.root.classList.contains('on'),
        cardVisible: el.card.style.visibility === 'visible',
        verdict: el.line.textContent,
        lineBox: { w: Math.round(r.width), h: Math.round(r.height) },
        glyphs: el.glyphs.children.length,
      };
    },
  };
}
