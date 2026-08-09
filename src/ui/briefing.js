/**
 * THE OPENING: where you are, what happened, and what you want.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 *
 * The owner's note after the first full human run was "we really didn't get any
 * story. There wasn't any story." What World 1 actually had was an ENDING -
 * `ui/ending.js`, a struck cartouche and THE NAME IS NOT HERE - arriving cold
 * after twenty-five waves that had told nobody anything. An absence only reads
 * as an absence if something promised a presence, and nothing did.
 *
 * This is the promise.
 *
 * ---------------------------------------------------------------------------
 * REWRITTEN 2026-08-08. THE FIRST VERSION WAS CLEVER AND DID NOT WORK.
 * ---------------------------------------------------------------------------
 *
 * It shipped as a CLASSIFIED GOVERNMENT FILE: letterhead, a gravimetric anomaly,
 * a personnel table of seven names with their specialities, and an order. The
 * argument for it was structural and genuinely good on paper - it spent none of
 * the supernatural plot, it was a LIE the four jar fragments would later
 * contradict, and it opened a gap where the player knew there were seven people
 * and the amnesiac character did not.
 *
 * The owner played it: "that opening intro thing, it's too long, and kinda
 * doesn't make any sense. It doesn't give us any setup. It doesn't set up a
 * story. It doesn't set up anything."
 *
 * He is right, and the failure is worth writing down because it is a trap this
 * whole project is prone to. THE CARD WAS OPTIMISED FOR A PROPERTY IT WOULD HAVE
 * LATER - becoming evidence - AT THE COST OF THE JOB IT HAD IMMEDIATELY. Seven
 * names a player has never heard are seven strings; a gravimetric anomaly is an
 * abstraction; an order given to somebody else four days ago is not a thing the
 * player wants. None of it answered the only questions an opening has to answer.
 *
 * So the rewrite answers them in order, in about sixty words:
 *
 *   WHERE AM I           Giza.
 *   WHAT HAPPENED        Seven went down. None came back. The file was closed.
 *   WHO AM I             One of them stood up four days later.
 *   WHY AM I LOST        He remembers none of it.
 *   WHAT DO I WANT       A woman is still down there, waiting for him.
 *   WHAT IS IN MY WAY    The sand is full of the dead, and they are awake.
 *   AND THE HOOK         HE IS ONE OF THEM.
 *
 * The last line is the whole game stated in five words on the first screen, and
 * it will not read as literal until the fourth jar. That is the property the old
 * card was reaching for, and it costs one sentence instead of a page.
 *
 * WHAT SURVIVED THE REWRITE, because the owner named them: the typewriter reveal
 * and the codec tick. "I like the typewriter. I like the codec sound."
 *
 * WHAT THE CARD DELIBERATELY STILL DOES NOT SAY: the gate, the gatekeeper, the
 * Ancients, Area 51, the other side, or that the woman is not what she is. The
 * requirement in `docs/NARRATIVE.md` that World 1 plants everything and confirms
 * nothing survives intact - "the file was closed that same week" is the entire
 * government thread, one line, unexplained.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS MONOSPACE, WHICH IS THE ONLY BREAK FROM THE GAME'S LANGUAGE
 * ---------------------------------------------------------------------------
 *
 * Every other surface in this build is Egyptian material: a cartouche incised
 * into painted plaster with gold in the cuts, per `ui/tokens.js`. This one is a
 * typewriter, and the contrast is the beat - the tomb has one visual language
 * and the modern world that broke into it has another. Reaching for Cinzel here
 * would make the expedition part of the tomb, which is the one thing it must
 * never look like until the player is inside.
 *
 * Colour still comes from tokens.js. The FORM breaks; the palette does not.
 *
 * ---------------------------------------------------------------------------
 * THE TICK, AND WHAT IT DOES NOT CLAIM
 * ---------------------------------------------------------------------------
 *
 * The reveal fires `codecTick` at the 'gate' setting - 168 Hz through an 820 Hz
 * bandpass, per the table in `core/audio.js`. That is chosen for its ACOUSTICS
 * and nothing else: low, dry, mechanical, a teletype rather than a throat.
 *
 * It is explicitly NOT a claim that the gatekeeper is reading this to you.
 * `docs/STORY-DELIVERY.md` keeps the two voices on separate surfaces on purpose
 * - she owns the notice pill, he owns the death card, they never share - and a
 * document is neither of them. If this ever reads as authorship rather than as
 * machinery, change the voice here and nothing else in the game moves.
 *
 * ---------------------------------------------------------------------------
 * SKIPPABLE, AND WHAT THAT COSTS
 * ---------------------------------------------------------------------------
 *
 * Intros get skipped. `docs/STORY-DELIVERY.md` section 5 states the rule this
 * project holds itself to: NO LOAD-BEARING PLOT FACT MAY LIVE ONLY ON A SURFACE
 * THE PLAYER CAN MISS. Every fact on this card is repeated in the world: the
 * seven names are stencilled on the expedition crates, the closed file is a camp
 * with nobody in it and the generators still running, and the woman is a lamp
 * moving ahead of the player within the first two minutes.
 *
 * This card is therefore Tier B, not Tier A, and it is written on the assumption
 * that it will sometimes be dismissed in one second. Sixty words is also short
 * enough that a returning player is not punished for having read it once, which
 * the previous version - about twice as long, and mostly a table - was not.
 */

import { PIGMENT, ROLE, FORM, ink, incised, registerRules } from './tokens.js';
import { schedule } from './pacer.js';

const ROOT_ID = 'briefing';
const CONFIRM_ID = 'briefing-go';
const CONFIRM_CODE = 'Enter';

/**
 * Characters per second, per band.
 *
 * `ui/pacer.js` exports CPS as { her: 22, gate: 6 } and neither is right here.
 * 22 is a person speaking a sentence; 6 is the gatekeeper taking as long over
 * two words as she takes over twelve. This is neither - it is a machine typing,
 * and its two headings are recognised rather than read.
 *
 * Both numbers came DOWN twice: once for the stutter (see TICK_MIN_MS) and once
 * because 90 characters a second was never readable, it was a blur with a sound
 * effect on it.
 *
 * These are the only new numbers in this file. Everything about HOW the reveal
 * is spaced - the extra beat after a full stop, the cheaper beat for a space -
 * comes from `schedule()` in the pacer, so this card's rhythm is the same
 * rhythm as every spoken line in the game.
 */
const CPS = {
  head: 46,   // GIZA PLATEAU, and the cut. Recognised rather than read.
  body: 26,   // prose. Above speech, below machine.
};

/**
 * THE FLOOR BETWEEN TWO TICKS, in milliseconds.
 *
 * REPORTED: "the intro typing out sequence tweaks out and gets stuck and
 * stutters." Two causes, and this is the smaller one - see the `holding` getter
 * below for the larger.
 *
 * The first cut fired one codec tick per character with the reveal running as
 * fast as 90 characters a second, capped only at three ticks per FRAME. Three a
 * frame is a hundred and eighty a second at 60fps, each one allocating its own
 * oscillator, filter and gain through core/audio.js. That is not a typewriter,
 * it is a denial of service with a nice comment on it.
 *
 * 42 ms puts the ceiling near twenty-four ticks a second, which is also simply
 * the right sound: Metal Gear's codec runs in that region and anything faster
 * stops reading as discrete taps and becomes a tone. The CPS numbers above came
 * down for the same reason twice over - 90 cps was never readable, it was a
 * blur with a sound effect.
 *
 * CHARACTERS ARE NEVER THINNED, ONLY TICKS. The text still reveals on its
 * authored schedule; what is rate limited is how often that gets a sound.
 */
const TICK_MIN_MS = 42;

/** Milliseconds of stillness AFTER a line finishes, before the next begins. */
const BEAT = {
  none: 0,
  line: 90,
  para: 520,
  block: 900,
  slug: 1400,
};

/**
 * THE DOCUMENT.
 *
 * `cls` selects the type treatment, `cps` the reveal rate, `after` the pause
 * that follows. A null `text` is a blank line: it costs its beat and nothing
 * else, which is how the sheet gets its spacing without margin rules that would
 * have to be kept in step with the content.
 *
 * THE SEVEN NAMES ARE THE LOAD-BEARING CONTENT and they are duplicated, on
 * purpose, onto the camp's crate stencils in `world/camp.js`. If a name changes
 * it must change in both places; `test/briefing.mjs` asserts the roster here and
 * `test/camp.mjs` asserts the stencils, so a drift fails a harness rather than
 * quietly shipping two rosters.
 *
 * PORTER, B. gets no emphasis whatsoever. She is the archaeologist the player
 * follows for the entire world and she is one line of seven, in alphabetical
 * order, in the same weight as the other six. The whole point is that on a first
 * read she is nobody.
 */
const SHEET = [
  { text: 'GIZA PLATEAU', cls: 'place', cps: CPS.head, after: BEAT.para },

  { text: null },
  { text: 'Seven went down into the pyramid.', cls: 'body', cps: CPS.body, after: BEAT.line },
  { text: 'None came back up.',                cls: 'body', cps: CPS.body, after: BEAT.para },

  { text: null },
  { text: 'The file was closed that same week.', cls: 'body', cps: CPS.body, after: BEAT.block },

  { text: null },
  { text: 'FOUR DAYS LATER', cls: 'beat', cps: CPS.head, after: BEAT.block },

  { text: null },
  { text: 'One of them stood up in the sand', cls: 'body', cps: CPS.body, after: BEAT.none },
  { text: 'outside the door.',                cls: 'body', cps: CPS.body, after: BEAT.para },

  { text: null },
  { text: 'He does not remember going in.',   cls: 'body', cps: CPS.body, after: BEAT.line },
  { text: 'He does not remember the six.',    cls: 'body', cps: CPS.body, after: BEAT.line },
  { text: 'He does not remember the woman',   cls: 'body', cps: CPS.body, after: BEAT.none },
  { text: 'still down there, waiting for him.', cls: 'body', cps: CPS.body, after: BEAT.block },

  { text: null },
  { text: 'The sand is full of the dead,', cls: 'body', cps: CPS.body, after: BEAT.none },
  { text: 'and they are awake.',           cls: 'body', cps: CPS.body, after: BEAT.block },
];

/** The hook, alone on black, after the sheet clears. */
const SLUG = 'HE IS ONE OF THEM';

/**
 * The expedition roster.
 *
 * IT IS NO LONGER ON THE CARD, and that is the point of this rewrite. It used to
 * be seven typed lines with ranks and specialities, and the owner's verdict on
 * the whole card was blunt and correct: "it's too long, and kinda doesn't make
 * any sense. It doesn't set up a story. It doesn't set up anything."
 *
 * Seven names a player has never heard are seven STRINGS. They become people
 * across the next hour - four of them arrive in his hands as jars - but on a
 * first read they are inert, and they were the largest block on a card that had
 * about twelve seconds of attention.
 *
 * So the names moved entirely to the stencilled crates in the expedition camp,
 * where a player meets them while walking past equipment somebody left running.
 * That is a better first meeting than a list: it is a place rather than a form.
 *
 * Kept exported because `world/camp.js` and `test/camp.mjs` assert the stencils
 * against it, so one array is still the single source for the roster.
 */
export const MANIFEST = ['ADLER', 'HOLM', 'MARCHETTI', 'NAKASHIMA', 'OYELARAN', 'PORTER', 'VANCE'];

/** How long the sheet takes to fade before the slug arrives, in ms. */
const CLEAR_MS = 900;
/** How long the slug holds before the confirm arms, in ms. */
const SLUG_MS = 1600;

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

/**
 * Built in JavaScript for `ui/death.js`'s reason, which `ui/ending.js` restates:
 * this is not part of the document, it is part of a sequence, and a game nobody
 * has started should not have a classified file sitting in its markup.
 */
function build(doc) {
  const style = doc.createElement('style');
  style.id = 'briefing-style';
  style.textContent = css();
  doc.head.appendChild(style);

  const root = doc.createElement('div');
  root.id = ROOT_ID;

  // Flat black, matching ending.js and for its stated reason: the world is not
  // there yet, and a vignette is a picture of a room with the lights down
  // whereas this is the absence of a picture.
  const wash = doc.createElement('div');
  wash.className = 'briefing-wash';
  root.appendChild(wash);

  const sheet = doc.createElement('div');
  sheet.className = 'briefing-sheet';
  sheet.setAttribute('data-briefing-sheet', '');
  root.appendChild(sheet);

  const slug = doc.createElement('div');
  slug.className = 'briefing-slug';
  slug.setAttribute('data-briefing-slug', '');
  root.appendChild(slug);

  const go = doc.createElement('button');
  go.id = CONFIRM_ID;
  go.className = 'briefing-go';
  go.type = 'button';
  go.textContent = 'BEGIN   [ENTER]';
  root.appendChild(go);

  doc.body.appendChild(root);
  return { root, sheet, slug, go };
}

function css() {
  const gold = ink(ROLE.text, 0.86);
  const dim = ink(ROLE.textDim, 0.62);
  const bone = ink(ROLE.textBright, 0.94);

  /*
   * The one break from the game's type. See the header.
   *
   * The stack is deliberately plain: a classified file typed on whatever the
   * office had is not a design decision anybody made, and a hunted-for display
   * face would undo the whole contrast this card exists to draw.
   */
  const mono = `'Courier New', Courier, 'DejaVu Sans Mono', monospace`;

  return `
#${ROOT_ID} {
  position: fixed; inset: 0; z-index: 57;
  display: none;
  flex-direction: column; align-items: center; justify-content: center;
  font-family: ${mono};
  pointer-events: none;
}
#${ROOT_ID}.on { display: flex; }

.briefing-wash {
  position: absolute; inset: 0;
  background: ${ink(PIGMENT.shadow, 1)};
}

/*
 * CENTRED, and that is a change with the rewrite rather than a preference.
 *
 * The first version was a FORM - letterhead, fields, a personnel table - and a
 * form is flush left or it stops looking like paper. What replaced it is prose:
 * eight short statements that set a place, a disappearance, a man and a want.
 * Centred, that reads as a title sequence, which is what it now is.
 */
.briefing-sheet {
  position: relative;
  width: min(88vw, 640px);
  text-align: center;
  white-space: pre-wrap;
  font-size: clamp(11px, 1.7vw, 19px);
  line-height: 1.75;
  color: ${dim};
  opacity: 1;
  transition: none;
}
#${ROOT_ID}.clearing .briefing-sheet {
  opacity: 0; transition: opacity ${CLEAR_MS}ms linear;
}

.briefing-line { display: block; min-height: 1.75em; }

/* Where you are. The only proper noun on the card. */
.briefing-line.place {
  color: ${gold};
  letter-spacing: 0.34em;
  font-size: 1.12em;
  text-shadow: ${incised()};
  padding-bottom: ${FORM.hairline + FORM.ruleGap}px;
  background: ${registerRules('bottom', ROLE.frame, 0.42)};
}

/*
 * The cut. It used to be its own full-screen card after the sheet faded, which
 * cost a second fade in and out for three words. Inside the sheet it does the
 * same job for nothing, and the shape of the story is clearer for having the
 * disappearance and the waking on one page.
 */
.briefing-line.beat {
  color: ${bone};
  letter-spacing: 0.42em;
  text-shadow: ${incised()};
}

.briefing-line.body { color: ${dim}; }

.briefing-slug {
  position: absolute;
  left: 50%; top: 50%; transform: translate(-50%, -50%);
  font-size: clamp(14px, 2.7vw, 32px);
  letter-spacing: 0.44em;
  /* Bone, not gold. It is the last thing on screen before the courtyard and it
     is the only sentence on the card that is about HIM. */
  color: ${bone};
  text-shadow: ${incised()};
  opacity: 0;
  transition: none;
}
#${ROOT_ID}.slugging .briefing-slug {
  opacity: 1; transition: opacity ${CLEAR_MS}ms linear;
}

.briefing-go {
  position: absolute;
  left: 50%; bottom: clamp(28px, 7vh, 74px); transform: translateX(-50%);
  appearance: none; border: 0; background: transparent;
  font-family: ${mono};
  font-size: clamp(10px, 1.3vw, 15px);
  letter-spacing: 0.3em;
  color: ${ink(ROLE.text, 0.72)};
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 420ms linear;
}
#${ROOT_ID}.armed .briefing-go { opacity: 1; pointer-events: auto; }

/*
 * NO USER-AGENT FOCUS RING.
 *
 * arm() focuses this button so a keyboard player knows where they are, and the
 * browser paid for that with a bright blue outline in the middle of a
 * composition that is gold on near-black - caught in shots/briefing-slug.png,
 * not by any assertion, which is the argument for looking at the thing.
 *
 * The ring is REPLACED rather than removed: focus still reads, in the palette,
 * as the same brightening hover gives. Deleting the indicator outright would
 * trade an ugly affordance for an invisible one.
 */
.briefing-go:focus { outline: none; }
.briefing-go:hover, .briefing-go:focus-visible {
  color: ${ink(ROLE.ready, 0.95)};
  text-shadow: ${incised(6)};
}
`;
}

// ---------------------------------------------------------------------------
// the card
// ---------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {Document} o.doc
 * @param {object} [o.audio]   core/audio.js, for the codec tick
 * @param {object} [o.save]    core/save.js, for the seen flag
 */
export function createBriefing({ doc, audio = null, save = null }) {
  const el = build(doc);
  const view = doc.defaultView || (typeof window !== 'undefined' ? window : null);

  const state = {
    /** 'none' | 'typing' | 'clearing' | 'slug' | 'waiting' | 'done' */
    phase: 'none',
    /** Which SHEET entry is being revealed. */
    index: 0,
    /** Characters printed across the whole sheet, for the harness. */
    printed: 0,
    /** Codec ticks actually fired. A count of SOUNDS, not of characters. */
    ticks: 0,
    /** True once the player has hurried or dismissed it. */
    skipped: false,
    /** True when this is not the player's first run. */
    seen: false,
  };

  let onDone = null;
  let rafId = 0;

  /**
   * ABSOLUTE TIMESTAMPS, NOT ACCUMULATED DELTAS, and this is a fix rather than
   * a style choice - it is the third instance of one defect in this project.
   *
   * The first cut of this file advanced its clock by `min(200, now - last)` per
   * frame, on the usual reasoning that a backgrounded tab must not jump. Under
   * swiftshader a frame can take 1.7 seconds (see the note in
   * `docs/WORLD1-POLISH.md` item 0, and `test/endgame.mjs`, which exists
   * because of it), so the clamp meant the card's clock advanced 200 ms for
   * every 1700 ms the player experienced. Measured by test/briefing.mjs on the
   * first run: 21 characters revealed in 1.85 seconds of wall time on a line
   * scheduled at 90 characters per second.
   *
   * `ui/ending.js` had the same bug against main.js's clamped simulation delta
   * and was fixed the same way. A title card on a black screen has no
   * simulation to stay in step with, so it reads the only clock the player has
   * and asks what time it is, rather than counting how many times it has been
   * asked.
   */
  let line = null;      // the current .briefing-line element
  let sched = null;     // schedule() output for the current line
  let shown = 0;        // characters of the current line on screen
  let lineAt = 0;       // timestamp the current line began revealing
  let waitUntil = 0;    // timestamp the current line's `after` beat expires
  let phaseUntil = 0;   // timestamp the clearing / slug phase expires
  let openedAt = 0;     // timestamp show() was called

  // ---------------------------------------------------------------------------
  // the reveal
  // ---------------------------------------------------------------------------

  function startLine(now) {
    const rec = SHEET[state.index];
    if (!rec) return false;

    line = doc.createElement('div');
    line.className = `briefing-line ${rec.cls || ''}`.trim();
    el.sheet.appendChild(line);

    shown = 0;
    lineAt = now;

    if (!rec.text) {
      // A blank line costs its beat and nothing else.
      sched = null;
      waitUntil = now + (rec.after || BEAT.line);
      return true;
    }

    sched = schedule(rec.text, rec.cps || CPS.body);
    waitUntil = 0;
    return true;
  }

  /**
   * One tick per printed character.
   *
   * Whitespace is silent, matching `ui/pacer.js` - a tick on a space makes the
   * rhythm even, and an even rhythm is a machine gun rather than a typewriter.
   */
  let lastTickAt = 0;

  function tick(ch, t) {
    if (!ch || ch === ' ' || ch === '\t') return;
    // See TICK_MIN_MS. The character is already on screen by the time this is
    // called; all that is skipped is the sound.
    if (t - lastTickAt < TICK_MIN_MS) return;
    lastTickAt = t;
    state.ticks++;
    audio?.play?.('codecTick', { voice: 'gate' });
  }

  /** Bring the sheet up to `now`. Returns true while it still has work. */
  function advance(now) {
    const rec = SHEET[state.index];
    if (!rec) return false;

    if (sched) {
      const t = now - lineAt;
      const full = rec.text;
      let n = shown;
      while (n < full.length && sched.at[n] <= t) n++;

      if (n !== shown) {
        // ONE tick attempt per step, rate limited by wall clock inside tick().
        // A slow frame resolves many characters at once and firing a sound for
        // each of them lands them all on the same audio timestamp, which is a
        // click rather than a sound - the same reason `fill()` below is silent.
        tick(full[shown], now);
        state.printed += n - shown;
        shown = n;
        line.textContent = full.slice(0, n);
      }

      if (n < full.length) return true;

      // The line finished. Pay its beat before moving on.
      sched = null;
      waitUntil = now + (rec.after || 0);
    }

    if (waitUntil && now < waitUntil) return true;

    state.index++;
    if (state.index >= SHEET.length) return false;
    return startLine(now);
  }

  /**
   * Print the whole sheet at once.
   *
   * Used by the skip and by `seen` players. Deliberately silent: firing four
   * hundred codec ticks in one frame is not a sound, it is a click, and the
   * player who skipped has said they do not want this.
   */
  function fill() {
    el.sheet.textContent = '';
    // Recounted from zero rather than added to, because fill() can arrive after
    // a partial reveal and "printed" must mean what is on screen, not what was
    // typed plus what was pasted over it.
    state.printed = 0;
    for (const rec of SHEET) {
      const d = doc.createElement('div');
      d.className = `briefing-line ${rec.cls || ''}`.trim();
      d.textContent = rec.text || '';
      el.sheet.appendChild(d);
      if (rec.text) state.printed += rec.text.length;
    }
    sched = null;
    waitUntil = 0;
    state.index = SHEET.length;
  }

  // ---------------------------------------------------------------------------
  // phases
  // ---------------------------------------------------------------------------

  function now() {
    return (view && view.performance ? view.performance.now() : Date.now());
  }

  function toClearing(t = now(), ms = CLEAR_MS) {
    state.phase = 'clearing';
    phaseUntil = t + ms;
    el.root.classList.add('clearing');
  }

  function toSlug(t = now(), ms = SLUG_MS) {
    state.phase = 'slug';
    phaseUntil = t + ms;
    el.slug.textContent = SLUG;
    el.root.classList.add('slugging');
  }

  function arm() {
    state.phase = 'waiting';
    el.root.classList.add('armed');
    // Focus so a keyboard player can see where they are, but never steal it
    // from a pointer user mid-click.
    try { el.go.focus({ preventScroll: true }); } catch { /* jsdom */ }
  }

  /**
   * The frame pump.
   *
   * WALL CLOCK, NOT SIMULATION TIME, and that is a fix rather than a preference.
   * `docs/WORLD1-POLISH.md` item 0 records `ui/ending.js` counting its opening
   * beat on main.js's CLAMPED delta: MAX_DELTA is 1/20, so under 20fps the card
   * ran slow rather than skipping, and six real seconds advanced its clock by
   * 0.7. A title card on a black screen has no simulation to stay in step with,
   * and the player's experience of it is measured in the only clock they have.
   */
  function frame(t) {
    rafId = view.requestAnimationFrame(frame);

    if (state.phase === 'typing') {
      if (!advance(t)) toClearing(t);
      return;
    }
    if (state.phase === 'clearing') {
      if (t >= phaseUntil) toSlug(t);
      return;
    }
    if (state.phase === 'slug') {
      if (t >= phaseUntil) arm();
    }
  }

  // ---------------------------------------------------------------------------
  // input
  // ---------------------------------------------------------------------------

  /**
   * ANY key or click hurries. A SECOND one dismisses.
   *
   * Two presses rather than one because the player has just clicked BEGIN on the
   * title screen and may well still be holding the key that did it. A single
   * press that both hurried and dismissed would mean a held Enter took the whole
   * card off screen before a frame of it had been read, which is not a skip, it
   * is a card that never rendered - the exact failure shape this project keeps
   * finding.
   */
  function hurry() {
    if (state.phase === 'none' || state.phase === 'done') return false;
    state.skipped = true;

    if (state.phase === 'typing') { fill(); toClearing(now(), 260); return true; }
    if (state.phase === 'clearing') { toSlug(now(), 420); return true; }
    if (state.phase === 'slug') { arm(); return true; }
    return false;
  }

  /**
   * THE HELD-KEY GUARD, and the first version of it was too blunt.
   *
   * The title screen starts a run on Enter or Space, so a key can already be
   * down when this card opens and a bare `stale` flag cleared only on keyup is
   * correct for that case. But the run can also start from a CLICK on #begin,
   * and then no keyup ever arrives - so the flag stayed set and the card
   * swallowed the player's first deliberate keypress forever. Measured: the
   * harness pressed a key to hurry, nothing happened, and the sheet sat on line
   * zero while every DOM check passed.
   *
   * So the guard also expires. A key held over from the title screen is gone
   * inside GRACE_MS; a key pressed on purpose after that is not.
   */
  const GRACE_MS = 350;
  let stale = true;

  function stillStale() {
    if (!stale) return false;
    if (now() - openedAt > GRACE_MS) { stale = false; return false; }
    return true;
  }

  function onKeyDown(e) {
    if (state.phase === 'none' || state.phase === 'done') return;
    if (e.repeat) return;
    if (stillStale()) return;
    if (state.phase === 'waiting') {
      // Enter and Space only. NOT Escape, for two reasons that both matter:
      // Escape is the pause binding everywhere else in this game, and it is the
      // key browsers use to LEAVE pointer lock - so dismissing with it would
      // hand main.js a gesture and then cancel the lock that gesture bought.
      if (e.code !== CONFIRM_CODE && e.code !== 'Space') return;
      e.preventDefault();
      finish();
      return;
    }
    e.preventDefault();
    hurry();
  }

  function onKeyUp() { stale = false; }

  function onPointerDown() {
    if (state.phase === 'none' || state.phase === 'done') return;
    if (state.phase === 'waiting') { finish(); return; }
    hurry();
  }

  if (view) {
    view.addEventListener('keydown', onKeyDown);
    view.addEventListener('keyup', onKeyUp);
  }
  el.root.addEventListener('pointerdown', onPointerDown);
  el.go.addEventListener('click', (e) => { e.stopPropagation(); finish(); });

  // ---------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------

  function finish() {
    if (state.phase === 'done') return;
    state.phase = 'done';
    if (rafId && view) view.cancelAnimationFrame(rafId);
    rafId = 0;
    el.root.classList.remove('on', 'clearing', 'slugging', 'armed');

    try { save?.setFlag?.('sawBriefing'); } catch { /* never throw at a player */ }

    const fn = onDone;
    onDone = null;
    if (fn) fn();
  }

  /**
   * Show the card. `done` fires when the player has dismissed it, which is the
   * signal main.js uses to engage input and hand over the world.
   */
  function show(done) {
    if (state.phase !== 'none' && state.phase !== 'done') return;
    onDone = done || null;

    state.phase = 'typing';
    state.index = 0;
    state.printed = 0;
    state.ticks = 0;
    state.skipped = false;
    state.seen = !!(save?.getFlag?.('sawBriefing'));

    el.sheet.textContent = '';
    el.slug.textContent = '';
    el.root.classList.add('on');
    el.root.classList.remove('clearing', 'slugging', 'armed');

    // A returning player gets the whole sheet immediately and still has to
    // dismiss it. The document stays available on every run - it is evidence,
    // and evidence a second-run player cannot re-read is evidence the game took
    // away at exactly the moment it started to mean something.
    openedAt = now();
    stale = true;

    if (state.seen) {
      fill();
      toClearing(openedAt);
    } else {
      startLine(openedAt);
    }

    if (view) rafId = view.requestAnimationFrame(frame);
  }

  function dispose() {
    if (rafId && view) view.cancelAnimationFrame(rafId);
    if (view) {
      view.removeEventListener('keydown', onKeyDown);
      view.removeEventListener('keyup', onKeyUp);
    }
  }

  return {
    show,
    finish,
    dispose,
    MANIFEST,

    /**
     * IS THE CARD HOLDING THE WORLD, and this is the fix for the reported
     * stutter rather than a convenience flag.
     *
     * REPORTED: "the intro typing out sequence tweaks out and gets stuck and
     * stutters."
     *
     * The card is an OPAQUE BLACK SHEET at z-index 57. Behind it, main.js was
     * running a complete frame: the wave director, twenty-four actors' walk
     * cycles, physics, fog drift, the cloud field, the whole post chain, the
     * viewmodel. Every clock in this game is that loop's delta. So the machine
     * was rendering a 3D scene nobody could see, at full cost, while the only
     * thing actually on screen was text arriving one character at a time - and
     * the reveal is driven by a requestAnimationFrame that was queued behind all
     * of it. A frame that arrives late does not slow the reveal down (it reads
     * an absolute clock), it makes the reveal JUMP, which is exactly what
     * stuttering and sticking look like from the other side of the screen.
     *
     * main.js already has the correct shape for this and has had it for months:
     * the pause guard renders at delta zero and returns before anything
     * advances, with a note saying that not making those calls IS the whole of
     * stopping the game. This is that, one line lower down.
     *
     * The scene still renders at delta zero rather than being skipped, matching
     * the pause precedent, so the canvas holds a valid frame for the moment the
     * card clears.
     */
    get holding() {
      return state.phase !== 'none' && state.phase !== 'done';
    },
    /** For the harness. Nothing on screen reads this. */
    stats() {
      return {
        phase: state.phase,
        index: state.index,
        lines: SHEET.length,
        printed: state.printed,
        ticks: state.ticks,
        skipped: state.skipped,
        seen: state.seen,
        manifest: MANIFEST.slice(),
      };
    },
  };
}
