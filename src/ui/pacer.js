/**
 * THE PACER - the notice pill, turned from a shout into a voice.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACES
 * ---------------------------------------------------------------------------
 *
 * `showNotice(text, ms)` in main.js was seven lines: write textContent, add a
 * class, clear one timer, set another. Ten systems were handed it. That is
 * last-write-wins with no transition at all - a second call overwrites the
 * first mid-sentence, instantly - and it is fine for THE KINDLING TAKES,
 * because a system notice is a stamp rather than a sentence.
 *
 * It is not fine for a person. `docs/WORLD-1.md` SHE ASKS, AND THEN SHE STOPS
 * needs three things the old function cannot do at any string:
 *
 *   1. Text that ARRIVES at a readable rate, so a line has a length the player
 *      can feel and an interruption has something to interrupt.
 *   2. A HOLD, so "NEED 400 MORE GOLD" cannot eat her mid-word.
 *   3. ATTRIBUTION, which in this interface is the shape of the text rather
 *      than a name: she is the only lowercase text in a game of capitals.
 *
 * This file is those three things and nothing else. It does not know who
 * speaks, when, or where - `src/story/voice.js` will own that (STORY-DELIVERY
 * item B) and it is not built here. This is the primitive underneath it.
 *
 * ---------------------------------------------------------------------------
 * SYSTEM NOTICES ARE INSTANT, AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------
 *
 * The ten existing call sites pass `(text, ms)` and expect what they have
 * always got: the string, now, in capitals, for exactly that many
 * milliseconds. So `voice: 'system'` reveals nothing - it writes textContent in
 * one go, the way the old function did, and it does not tick.
 *
 * That is not a shortcut, it is the correct reading of the surface. A system
 * notice has no speaker; a reveal implies one. Ticking a purchase confirmation
 * would tell the player that the shop is talking to them, and the whole scheme
 * here depends on the pill being silent until a person uses it.
 *
 * ---------------------------------------------------------------------------
 * THE RESERVED BOX, and why the text does not grow from the centre
 * ---------------------------------------------------------------------------
 *
 * The pill is `left: 50%; transform: translateX(-50%)`, so an element that
 * shrink-wraps a growing string re-centres on every character and the line
 * jitters sideways for its whole reveal. That reads as a bug, and this project
 * has twelve confirmed instances of things that shipped looking like bugs.
 *
 * So a revealing line is TWO spans: what has been said, and what has not, the
 * second one at `visibility: hidden`. Hidden by visibility rather than removed,
 * because visibility keeps the layout - which means the box is the finished
 * line's box from the first character, every glyph appears at the exact
 * position it will occupy when the line is done, and nothing moves.
 *
 * It also gives the interruption its picture for free: when she is cut, the
 * remainder is still holding the space she was going to fill.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DRIVES ITSELF OFF rAF AND NOT THE FRAME LOOP
 * ---------------------------------------------------------------------------
 *
 * The old function's expiry was already a `setTimeout`, so the pill has always
 * run on the wall clock rather than on simulation time, and a notice that
 * survives a pause menu at its full length is the behaviour that shipped.
 * Keeping that means main.js does not acquire a new per-frame call, which
 * matters this week: the frame loop is another lane's file.
 *
 * ONE CLOCK PER LINE, THOUGH. A spoken line's reveal, its cut and its hold are
 * all counted by the same per-frame clock, and NOTHING about it is timed by a
 * `setTimeout` armed when it started. That mix is a real bug this file shipped
 * with for a day: see the note on `holdMs` in `createTypewriter`, and the jar
 * lane's measurement of what it cost. A system notice, which has no reveal to
 * drift from, keeps the shipped `setTimeout` exactly as it was.
 *
 * `createTypewriter` below can also be driven MANUALLY, one `advance(dt)` at a
 * time, and ui/death.js uses it that way because the death card is paced in
 * simulation seconds and its harnesses step it directly.
 */

// ---------------------------------------------------------------------------
// the rate
// ---------------------------------------------------------------------------

/**
 * Milliseconds per character, before punctuation.
 *
 * 22 characters per second is about 240 words per minute, above broadcast
 * subtitle practice and defensible here for the reason STORY-DELIVERY gives:
 * these are single lines of eight to twelve words with nothing else in the
 * centre of the screen. Measured against her five World 1 lines it puts the
 * longest (70 characters) at 3.2 seconds of reveal, which fits inside the
 * 4.5 second breather Hard difficulty guarantees.
 *
 * The gatekeeper runs at 6, which is the same mechanism with one number
 * changed, and slowness is his entire characterisation.
 */
export const CPS = { her: 22, gate: 6 };

/**
 * How long a finished line stands before the pill fades.
 *
 * Separate from the reveal because they are different jobs: the reveal is
 * reading speed and the hold is the beat after a sentence lands. A line's total
 * life is `reveal + hold`, which is what makes a long line take longer than a
 * short one instead of every line taking two seconds.
 */
export const HOLD_MS = { her: 1200, gate: 1400 };

/**
 * WHAT MAKES TYPED TEXT READ AS SPEECH RATHER THAN AS A PROGRESS BAR.
 *
 * A constant rate is a teleprinter. A full stop that holds, a comma that holds
 * less, and a space that costs almost nothing is most of the difference between
 * a machine printing and a person talking, and it costs one lookup per
 * character.
 *
 * These are ADDED to the base cost of the character they follow, in
 * milliseconds, and they are deliberately not scaled by the voice's rate: a
 * beat between sentences is a beat, and the gatekeeper taking four times as
 * long to reach the full stop does not mean he should then pause four times as
 * long on it.
 */
const PUNCT_MS = {
  '.': 320, '?': 320, '!': 320,
  ',': 150, ';': 150, ':': 150,
  // A dash is the sound of a sentence being taken away, and her last line ends
  // on one. Short: it is a snatched breath, not a full stop.
  '-': 90,
};

/**
 * A space costs less than a letter and makes no sound.
 *
 * Ticking on whitespace turns a codec into a machine gun, and the word gap is
 * the one place the ear expects the rhythm to breathe.
 */
const SPACE_SCALE = 0.6;

/** Characters that never tick. Whitespace only; punctuation still speaks. */
const SILENT = /\s/;

// ---------------------------------------------------------------------------
// the typewriter
// ---------------------------------------------------------------------------

/**
 * Precompute when every character appears, and how long the whole line takes.
 *
 * Built once per line rather than integrated per frame, for two reasons. The
 * reveal has to be a pure function of elapsed time so that a slow frame skips
 * characters instead of stretching the line - an interruption authored at 2.4
 * seconds has to land at 2.4 seconds on a machine dropping frames. And the cut
 * point below needs to know, before the first character, exactly when the
 * reveal will reach a given substring.
 *
 * @param {string} text
 * @param {number} cps
 * @returns {{at: number[], dur: number}}  `at[i]` is when character i appears
 */
export function schedule(text, cps) {
  const base = 1000 / Math.max(cps, 0.001);
  const at = new Array(text.length);
  let t = 0;
  for (let i = 0; i < text.length; i++) {
    at[i] = t;
    const ch = text[i];
    t += (SILENT.test(ch) ? base * SPACE_SCALE : base) + (PUNCT_MS[ch] || 0);
  }
  return { at, dur: t };
}

/**
 * Reveal text into an element one character at a time, ticking as it goes.
 *
 * Shared by the notice pill and the death card, which is the reason it is its
 * own thing: the two surfaces are paced identically and styled nothing alike,
 * and a second implementation of the schedule above is how two speakers end up
 * with two different ideas of what a comma is worth.
 *
 * @param {object} p
 * @param {HTMLElement|null} p.el      where the text goes. Null is legal.
 * @param {Document} [p.doc]           for createElement and rAF.
 * @param {object} [p.audio]           core/audio.js, or anything with play().
 * @param {'her'|'gate'} [p.voice]     which speaker's rate and tick.
 * @param {boolean} [p.manual]         true: caller drives advance(dt).
 */
export function createTypewriter({ el, doc, audio, voice = 'her', manual = false }) {
  const view = doc?.defaultView || (typeof window !== 'undefined' ? window : null);

  const said = doc ? doc.createElement('span') : null;
  const rest = doc ? doc.createElement('span') : null;
  if (said) said.className = 'notice-said';
  if (rest) rest.className = 'notice-rest';

  const state = {
    /** The whole line, including anything a cut will never show. */
    full: '',
    /** How many characters are on screen. */
    shown: 0,
    /** Milliseconds since the first character. */
    t: 0,
    /** null | 'revealing' | 'cut' | 'done' */
    phase: null,
    /** Ticks actually fired, for the harness. This is a count of SOUNDS. */
    ticks: 0,
    /** Where the reveal stops, or -1. See `cutAt` in play(). */
    cutIndex: -1,
    /** True when `cutAt` was authored and not found in the string. */
    cutMissing: false,
  };

  let sched = { at: [], dur: 0 };
  let cps = CPS[voice] ?? CPS.her;
  let rafId = 0;
  let lastFrame = 0;
  let onCut = null;
  let cutHoldMs = 0;
  let cutFiredAt = -1;

  /**
   * THE HOLD IS COUNTED ON THE SAME CLOCK THE REVEAL IS, and this is a fix
   * rather than a preference.
   *
   * It was a `setTimeout` in the pacer, armed for `reveal + hold` at the moment
   * the line started. That is a wall clock, and the reveal is a per-frame clock
   * with a ceiling on how much any one frame may advance it - so the two agree
   * above about four frames a second and diverge, one way, below it. Measured
   * by the jar lane under swiftshader at roughly one frame a second: a 2.34
   * second reveal took about ten seconds of wall time, the teardown fired at
   * 3.8, `clear()` wiped the line mid-sentence, the reveal never reached the
   * cut, and `onCut` never fired. Every check in that lane went green with the
   * best beat in World 1 silently gone, which is precisely the failure shape
   * this project keeps finding.
   *
   * So nothing about a spoken line is timed from outside it. The reveal
   * finishes, THEN the hold starts, on the same clamped per-frame clock, and
   * `onEnd` is what takes the pill down. A slow machine now stretches the whole
   * line - reveal and hold together - instead of cutting it off partway.
   */
  let holdMs = 0;
  let holdLeft = 0;
  let onEnd = null;

  /**
   * Write the two spans.
   *
   * Rebuilt from scratch on every call to play() rather than reused, because
   * anything else in the page is free to assign `el.textContent` - the old
   * showNotice did exactly that for years, and test/hud.mjs still does - and a
   * typewriter holding stale references to detached spans would then reveal
   * into nothing while every state check on it passed.
   */
  function mount() {
    if (!el || !said || !rest) return;
    el.textContent = '';
    el.appendChild(said);
    el.appendChild(rest);
  }

  function paint() {
    if (!said || !rest) return;
    said.textContent = state.full.slice(0, state.shown);
    rest.textContent = state.full.slice(state.shown);
  }

  /**
   * One tick per character as it appears, and the sound IS the typing.
   *
   * Not per word, not a loop under the line. Whitespace is silent; see
   * SPACE_SCALE above.
   */
  function tick(ch) {
    if (SILENT.test(ch)) return;
    state.ticks++;
    audio?.play?.('codecTick', { voice });
  }

  /** Bring the reveal up to `state.t`. Returns true while work remains. */
  function resolve() {
    if (state.phase !== 'revealing') return false;

    const limit = state.cutIndex >= 0 ? state.cutIndex : state.full.length;
    let n = state.shown;
    while (n < limit && sched.at[n] <= state.t) n++;

    if (n !== state.shown) {
      for (let i = state.shown; i < n; i++) tick(state.full[i]);
      state.shown = n;
      paint();
    }

    if (n >= limit) {
      // THE CUT IS NOT THE END OF A LINE, it is a line that stopped.
      //
      // The phase says which, and it says so permanently: nothing here resumes
      // a cut reveal, because the whole beat is that she does not finish and
      // never speaks again.
      if (state.cutIndex >= 0) {
        state.phase = 'cut';
        cutFiredAt = state.t + cutHoldMs;
        return true;
      }
      state.phase = 'done';
      holdLeft = onEnd ? holdMs : 0;
      return holdLeft > 0;
    }
    return true;
  }

  /**
   * Advance by `ms` of whatever clock the caller is on.
   *
   * Manual mode hands this simulation seconds through `advance(dt)` below; the
   * self-driving loop hands it wall-clock milliseconds. Either way it is ONE
   * clock: the reveal, the cut's quarter second and the hold after the line are
   * all counted here, so they cannot drift apart on a slow machine.
   */
  function step(ms) {
    if (!state.phase) return false;
    state.t += ms;

    // The reveal owns the frame it is still running on. resolve() sets up
    // whichever phase comes next and says whether there is more to do, so the
    // branches below never run on the same call that finished the reveal - the
    // hold would otherwise lose its first frame to the reveal's own delta.
    if (state.phase === 'revealing') return resolve();

    // Cut, and holding. The pause before the capitals land is the beat that
    // makes an interruption read as an interruption rather than as a dropped
    // frame, so it is measured from the cut character rather than from a timer
    // somebody started elsewhere.
    if (state.phase === 'cut') {
      if (cutFiredAt < 0 || state.t < cutFiredAt) return true;
      cutFiredAt = -1;
      const fn = onCut;
      onCut = null;
      state.phase = 'done';
      holdLeft = onEnd ? holdMs : 0;
      // Usually this hands the pill to the Kindling, which clears us on the
      // way past - so what is left to do is re-read rather than assumed.
      if (fn) fn();
      return state.phase !== null && holdLeft > 0;
    }

    if (state.phase === 'done') {
      if (holdLeft <= 0) return false;
      holdLeft -= ms;
      if (holdLeft > 0) return true;
      holdLeft = 0;
      const fn = onEnd;
      onEnd = null;
      if (fn) fn();
      return false;
    }

    return false;
  }

  /**
   * The per-frame clamp, and it is the same argument main.js makes for
   * MAX_DELTA one file over.
   *
   * A tab that was hidden for thirty seconds comes back with one enormous
   * delta, and without a ceiling the whole line would appear in a single step
   * with every tick firing at once. With one, the reveal degrades into SLOWER
   * rather than into SKIPPED, which is the property ui/death.js states for sim
   * time and which matters more here than fidelity to the wall clock: a line
   * that stretches on a struggling machine is still readable, and a line that
   * teleports is not a reveal at all.
   *
   * 500 ms rather than 250 because a machine drawing two frames a second is a
   * machine this game is still trying to be playable on - measured under
   * swiftshader, frames land 800 to 1700 ms apart, and a 250 ms ceiling there
   * ran her lines at a sixth speed.
   */
  const MAX_STEP_MS = 500;

  function loop() {
    rafId = 0;
    const now = view ? view.performance.now() : Date.now();
    const ms = Math.min(now - lastFrame, MAX_STEP_MS);
    lastFrame = now;
    if (step(ms)) pump();
  }

  function pump() {
    if (manual || !view || rafId) return;
    rafId = view.requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (rafId && view) view.cancelAnimationFrame(rafId);
    rafId = 0;
  }

  return {
    /**
     * Start a line.
     *
     * @param {string} text
     * @param {object} [opts]
     * @param {string} [opts.cutAt]    a substring the reveal stops after. THE
     *   AUTHORED CUT POINT: see the block comment on `speak()` below.
     * @param {number} [opts.cutHold]  ms the truncated line holds before onCut.
     * @param {function} [opts.onCut]  fired at the authored frame, once.
     * @param {number} [opts.hold]     ms the finished line stands, counted on
     *   THIS clock and not on a timer somebody else owns. See the note on
     *   holdMs above for what the timer version cost.
     * @param {function} [opts.onEnd]  fired when the hold runs out, once.
     */
    play(text, opts = {}) {
      stopLoop();
      state.full = String(text ?? '');
      state.shown = 0;
      state.t = 0;
      state.ticks = 0;
      state.phase = 'revealing';
      state.cutMissing = false;
      cutFiredAt = -1;
      onCut = opts.onCut || null;
      cutHoldMs = opts.cutHold ?? 250;
      onEnd = opts.onEnd || null;
      holdMs = opts.hold ?? 0;
      holdLeft = 0;

      sched = schedule(state.full, cps);

      // THE CUT IS AUTHORED AS TEXT, NOT AS A TIMESTAMP.
      //
      // "cut her at 2410ms" is a number that silently stops meaning anything
      // the moment CPS is retuned or a word is rewritten, and what it stops
      // meaning is the best beat in World 1. "cut her after `since we-`" is a
      // claim about the SCRIPT, and the schedule above turns it into the
      // timestamp on every play.
      if (opts.cutAt) {
        const i = state.full.indexOf(opts.cutAt);
        if (i < 0) {
          // Authoring error, and it is reported rather than swallowed: a line
          // that was supposed to be interrupted and instead runs to the end is
          // exactly the class of defect this project keeps finding by reading.
          state.cutMissing = true;
          state.cutIndex = -1;
        } else {
          state.cutIndex = i + opts.cutAt.length;
        }
      } else {
        state.cutIndex = -1;
      }

      mount();
      // The first character is on screen on the frame play() is called rather
      // than one frame later, so a line and its first tick are simultaneous.
      resolve();

      lastFrame = view ? view.performance.now() : Date.now();
      pump();
      return this;
    },

    /** Manual clock, in SECONDS, to match every other update() in this build. */
    advance(dt) { return step(dt * 1000); },

    /**
     * Stop where we are and leave the text standing, indefinitely.
     *
     * The hold is abandoned with the loop, on purpose: this exists so a harness
     * can photograph a line mid-reveal, and a picture of a state that takes
     * itself down two frames later is a picture of a race.
     */
    freeze() {
      stopLoop();
      if (state.phase === 'revealing') state.phase = 'done';
      holdLeft = 0;
      onEnd = null;
    },

    /** Wipe. The element is left empty rather than holding a stale line. */
    clear() {
      stopLoop();
      state.full = '';
      state.shown = 0;
      state.phase = null;
      onCut = null;
      onEnd = null;
      holdLeft = 0;
      if (el) el.textContent = '';
    },

    /** Change speaker. Takes effect on the next play(), never mid-line. */
    setVoice(next) {
      voice = next;
      cps = CPS[voice] ?? CPS.her;
    },

    /** Total wall time this line will take, reveal only, in ms. */
    get duration() { return sched.dur; },

    /** When the cut lands, in ms from the first character. -1 if there is none. */
    get cutAtMs() { return state.cutIndex < 0 ? -1 : sched.at[state.cutIndex - 1] ?? -1; },

    /**
     * The phase, and it is PUBLIC and stable on purpose.
     *
     * null before a line and after a clear, 'revealing' while it arrives, 'cut'
     * between the authored character and the interruption firing, 'done' once
     * the reveal is over - including through the hold. The jar lane reads this
     * to tell a beat that landed from a beat its own backstop rescued, which is
     * a distinction no harness can make from the text alone.
     */
    get phase() { return state.phase; },

    /**
     * Is this line still entitled to the pill.
     *
     * True from the first character until the hold runs out, measured on the
     * reveal's own clock. The pacer's drop policy asks THIS rather than
     * comparing wall-clock timestamps, because a line that is still arriving on
     * a slow machine is still arriving whatever the clock says.
     */
    get holding() {
      return state.phase !== null && (state.phase !== 'done' || holdLeft > 0);
    },

    /** What is left of the hold, in ms of the reveal's clock. */
    get holdLeft() { return Math.max(0, Math.round(holdLeft)); },

    get text() { return state.full.slice(0, state.shown); },
    get full() { return state.full; },
    get shown() { return state.shown; },
    get ticks() { return state.ticks; },
    get cutMissing() { return state.cutMissing; },
  };
}

// ---------------------------------------------------------------------------
// the pill
// ---------------------------------------------------------------------------

/**
 * Which voice gets which treatment.
 *
 * The classes are the attribution. `ui/tokens.js` states the principle this is
 * an instance of - "the one signal on the HUD a player can read without reading
 * it" - and lowercase in a game with no lowercase in it is that signal in a
 * channel nobody has used.
 */
const VOICE_CLASS = { her: 'voice-her', gate: 'voice-gate' };

/**
 * @param {object} p
 * @param {HTMLElement|null} p.el   the real #notice element, or null headless
 * @param {Document} [p.doc]
 * @param {object} [p.audio]
 */
export function createPacer({ el, doc, audio }) {
  const d = doc || el?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const view = d?.defaultView || (typeof window !== 'undefined' ? window : null);

  const typer = createTypewriter({ el, doc: d, audio });

  /**
   * The fade-out timer, and it is for SYSTEM NOTICES ONLY.
   *
   * A system notice has no reveal, so there is no second clock for a wall-clock
   * expiry to drift away from, and this is exactly what the ten existing call
   * sites have always had: a string, a number of milliseconds, a setTimeout.
   * Unchanged on purpose.
   *
   * A SPOKEN line does not use this. Its hold is counted by the typewriter on
   * the same per-frame clock its reveal is, and `down()` below is handed to it
   * as `onEnd`. The two are separated because that is the whole bug: the timer
   * fired on schedule while the reveal was running at a third speed, and it
   * wiped her line mid-sentence with every state check still green.
   */
  let expiry = 0;
  let current = 'system';  // who owns the pill right now
  let lastDropped = null;  // what the hold ate, for the harness

  function dress(voice) {
    if (!el) return;
    for (const cls of Object.values(VOICE_CLASS)) el.classList.remove(cls);
    if (VOICE_CLASS[voice]) el.classList.add(VOICE_CLASS[voice]);
    current = voice;
  }

  /** Take the pill down. The end of every line, spoken or system. */
  function down() {
    el?.classList.remove('on');
    typer.clear();
  }

  function armSystem(ms) {
    if (view) view.clearTimeout(expiry);
    expiry = view ? view.setTimeout(down, ms) : 0;
  }

  return {
    /**
     * A system notice: instant, capitals, exactly as it has always been.
     *
     * Returns false when the hold ate it, which is a real answer rather than a
     * failure: STORY-DELIVERY section 4 rejects a queue on the grounds that a
     * queue makes the game talk over itself several seconds later, which is
     * worse than dropping. A dropped purchase confirmation costs the player
     * nothing; a line of hers cut in half by one costs the beat.
     *
     * @param {string} text
     * @param {number} [ms]
     * @param {object} [opts]
     * @param {boolean} [opts.force]  clobber a held line. One caller: the cut.
     */
    notice(text, ms = 2000, opts = {}) {
      // ASK THE LINE, DO NOT ASK THE CLOCK. Whether she is still speaking is a
      // fact about the reveal's own progress; a wall-clock deadline computed
      // when the line started is a guess about it, and on a slow machine the
      // guess expires first and lets a purchase confirmation eat her.
      if (!opts.force && current !== 'system' && typer.holding) {
        lastDropped = String(text ?? '');
        return false;
      }
      typer.clear();
      dress('system');
      if (el) {
        el.textContent = String(text ?? '');
        el.classList.add('on');
      }
      armSystem(ms);
      return true;
    },

    /**
     * A person speaks.
     *
     * ---------------------------------------------------------------------
     * THE AUTHORED CUT POINT, and the call site the jar lane wants
     * ---------------------------------------------------------------------
     *
     * `docs/WORLD-1.md` WHERE SHE STOPS fixes the beat: she starts her fifth
     * line, THE KINDLING TAKES overwrites it mid-sentence, and she never
     * speaks again. Fired the instant the third jar lands, that overwrite
     * severs her at whatever character the reveal happened to reach, and
     * "there's some" does not read as an interruption. It reads as a bug.
     *
     * So the interruption is composed rather than emergent. The jar chain does
     * not fire the Kindling notice; it fires HER LINE, and hands the Kindling
     * to `onCut`, which this file calls at the authored character:
     *
     *     pacer.speak(THE_INTERRUPTED_LINE.text, {
     *       ...THE_INTERRUPTED_LINE,
     *       onCut: () => pacer.notice(
     *         'THE KINDLING TAKES - THE PYRAMID WAKES', 4000, { force: true }),
     *     });
     *
     * That call belongs in systems/jars.js at the moment the third jar seats,
     * in place of whatever it currently calls to announce the power coming up.
     * It is the ONLY `force: true` in the game and the only thing allowed to
     * take the pill off her.
     *
     * @param {string} text
     * @param {object} [opts]
     * @param {'her'|'gate'} [opts.voice]
     * @param {string} [opts.cutAt]
     * @param {number} [opts.cutHold]
     * @param {function} [opts.onCut]
     * @param {number} [opts.hold]     ms the finished line stands
     */
    speak(text, opts = {}) {
      const voice = opts.voice || 'her';
      typer.setVoice(voice);
      dress(voice);

      // A system notice may have a wall-clock expiry in flight. It would take
      // this line down partway through, which is the bug this whole path exists
      // to remove, so it goes before the line starts.
      if (view) view.clearTimeout(expiry);

      if (el) el.classList.add('on');

      // The hold is handed to the typewriter rather than armed here. It covers
      // the beat AFTER the last character - a system notice arriving on the
      // final glyph is still arriving during the line - and it is counted on
      // the reveal's clock, so the two cannot come apart.
      typer.play(text, {
        ...opts,
        hold: opts.hold ?? HOLD_MS[voice] ?? 1200,
        onEnd: down,
      });
      return true;
    },

    /** Take the pill down now. */
    clear() {
      if (view) view.clearTimeout(expiry);
      typer.clear();
      dress('system');
      el?.classList.remove('on');
    },

    /**
     * Everything a harness needs to prove this rendered, rather than to prove
     * it was called. The bug class here is UI that was written, believed and
     * never drawn, so what is reported is what is ON SCREEN: the visible
     * substring, its length, and the laid-out box it occupies.
     */
    stats() {
      const r = el?.getBoundingClientRect?.();
      return {
        voice: current,
        phase: typer.phase,
        text: typer.phase ? typer.text : (el?.textContent ?? ''),
        full: typer.full,
        shown: typer.shown,
        ticks: typer.ticks,
        cutAtMs: typer.cutAtMs,
        cutMissing: typer.cutMissing,
        durationMs: typer.duration,
        // Whether the pill is still spoken for, and how much of the hold is
        // left, both on the reveal's clock rather than on the wall's.
        holding: typer.holding,
        holdLeft: typer.holdLeft,
        dropped: lastDropped,
        on: !!el?.classList?.contains('on'),
        box: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
      };
    },

    /** The typewriter itself, for ui/death.js and for the harness. */
    typer,
  };
}

/**
 * HER LAST LINE, and the one authored cut in World 1.
 *
 * The string is `docs/WORLD-1.md` line 5 of WHAT SHE IS ACTUALLY ASKING,
 * verbatim, lowercase, ending on the dash it is taken away on. It lives here
 * rather than in a story file because there is no story file yet - item B of
 * STORY-DELIVERY builds `src/story/voice.js` and this record moves there whole
 * when it lands, with the jar chain's call site unchanged.
 *
 * `cutAt` stops the reveal after "since we-", which is the last thing she ever
 * says. Measured off the schedule, that is 2336 ms in - the line is 56
 * characters, nine of them are spaces and spaces cost less, so it is not 56
 * over 22. `cutHold` then gives the frozen half-sentence a quarter of a second
 * alone before the capitals land on it.
 */
export const THE_INTERRUPTED_LINE = {
  text: "there's something i've been meaning to ask you since we-",
  voice: 'her',
  cutAt: 'since we-',
  cutHold: 250,
};
