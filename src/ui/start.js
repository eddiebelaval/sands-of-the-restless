/**
 * THE TITLE SCREEN.
 *
 * The HUD was repainted into the Egyptian language in 9135f98 and this surface
 * was explicitly left out of that pass, so until now the first thing anybody
 * saw of this game was the only screen in it that had never been designed: a
 * radial scrim, a letterspaced heading, one bordered rectangle, and a paragraph
 * of key bindings. This closes that, and it closes it under the same thesis
 * src/ui/tokens.js states for the HUD - keep the shooter's information
 * architecture, change the material it is made of.
 *
 * What that means HERE, where there is no fight to read through:
 *
 *   THE ARCHITECTURE IS A TITLE SCREEN'S. Name, then the one choice worth
 *   making before entering, then the way in, then the controls. Vertical,
 *   centred, largest thing at the top, primary action unmissable and alone on
 *   its line. Nothing clever with the ordering; a player should not have to
 *   read this screen twice.
 *
 *   THE MATERIAL IS THE CARTOUCHE. The game's name sits inside an oblong with
 *   semicircular ends and a tie-bar at one end, which is what an Egyptian
 *   surface does with a name that matters, and the three tiers are the same
 *   object at badge size. Registers rules divide the bands. Every label is
 *   carved rather than printed - a dark edge down and a lit edge up, at one
 *   pixel, because that is what a chisel leaves.
 *
 *   ORNAMENT IN THE FRAME, NEVER IN THE NUMBER. The selected tier is filled
 *   with lapis and its name is set in bone, which is both the correct Egyptian
 *   move and the only legible one: tokens.js measures lapis at 2.70 to one and
 *   marks it FILL ONLY. A lapis label would have been unreadable and a lapis
 *   ground under a bone label is the actual pectoral.
 *
 * ------------------------------------------------------------------------
 * WHY THE ROWS ARE BUILT FROM A TABLE INSTEAD OF AUTHORED IN index.html
 * ------------------------------------------------------------------------
 *
 * The same reason src/ui/pause.js builds its settings rows from `buildSpec`:
 * the label a player reads and the numbers the director runs on have to be one
 * object. A tier hand-written into the markup as "Easy - a gentler climb" and
 * implemented in systems/difficulty.js as something else is not a bug any test
 * catches, because both halves are individually correct. Here the name and the
 * sentence under it come out of the same record the wave director reads, so the
 * screen cannot describe a tier the game is not playing.
 *
 * ------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT DO: build a settings panel.
 * ------------------------------------------------------------------------
 *
 * There is a full one already - four tabs, twelve controls, its own suite of
 * 212 checks - and the Settings button here opens THAT, through the same
 * `pause.open()` the Esc key uses. A title-screen copy of the sensitivity
 * slider would be a second writer to the camera and the first thing to drift.
 */

/**
 * @param {object} o
 * @param {HTMLElement} o.veil        #veil
 * @param {object} o.difficulty       systems/difficulty.js
 * @param {function} [o.onSettings]   opens the pause panel
 * @param {Document} [o.doc]
 */
export function createStartScreen({ veil, difficulty, onSettings, save, doc = document }) {
  const row = veil && veil.querySelector('[data-tiers]');
  const noteEl = veil && veil.querySelector('[data-tier-note]');
  const settingsBtn = veil && veil.querySelector('[data-open-settings]');
  const recordEl = veil && veil.querySelector('[data-record]');

  /** The in-play stamp. Outside the veil - it lives on the ammunition plate. */
  const stampEl = doc.querySelector('[data-difficulty]');

  if (!row) {
    return { buttons: {}, refresh() {}, lockIn() {}, stamp: stampEl };
  }

  const buttons = {};

  for (const tier of difficulty.TIERS) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'tier';
    b.dataset.tier = tier.id;
    // aria-pressed rather than a class, matching every other toggle in this
    // interface (the fidelity buttons, the settings choices, the pause tabs),
    // so the state is in the accessibility tree and not only in the paint.
    b.setAttribute('aria-pressed', 'false');
    b.textContent = tier.name;
    b.addEventListener('click', () => difficulty.set(tier.id));
    row.appendChild(b);
    buttons[tier.id] = b;
  }

  /**
   * Repaint FROM THE CHOICE, never from what was just clicked.
   *
   * `difficulty.set` refuses once the run has locked, and a handler that
   * painted its own button pressed on the way past would show a tier the game
   * is not running - the same lie a settings slider tells when it echoes the
   * request rather than the result. See the note on `paint` in ui/pause.js.
   */
  function refresh() {
    const tier = difficulty.tier;
    for (const id in buttons) {
      buttons[id].setAttribute('aria-pressed', String(id === tier.id));
      buttons[id].disabled = difficulty.locked;
    }
    if (noteEl) noteEl.textContent = tier.said;
  }

  difficulty.subscribe(refresh);

  /**
   * mm:ss, because a clear time is minutes and nobody reads 878 seconds.
   *
   * Not padded on the minutes: a 9-minute clear reading "09:14" implies a
   * tens-of-minutes column that this game will never fill, and the leading zero
   * is the kind of detail that makes an interface look automatically generated.
   */
  function clock(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /**
   * WHAT THE TOMB REMEMBERS, and it says nothing at all until there is
   * something to say.
   *
   * Every field is conditional on its own record existing rather than on a
   * zero, and the whole line hides when none of them do. A first-time player
   * gets the screen exactly as it was before this existed - which is the point,
   * because an empty scoreboard on a title screen tells a new player they are
   * already behind, and this game's first minute is the part of it that works.
   *
   * The wording is the tomb's rather than a scoreboard's, which is the register
   * the death card already set when it chose ERASED over "deaths": the surface
   * speaks as the thing doing the erasing. DEEPEST is the furthest a run ever
   * got, and it is only worth saying while the player has never finished - once
   * they have, every clear is wave 25 and the interesting number becomes time.
   */
  function paintRecord() {
    if (!recordEl || !save) return null;

    const deepest = save.getRecord('deepestWave', 0);
    const clears = save.getRecord('clears', 0);
    const fastest = save.getRecord('fastestClear', 0);
    const erased = save.getRecord('erased', 0);
    const richest = save.getRecord('richestRun', 0);

    /** {label, value, tail} triples rather than markup. See the build below. */
    const bits = [];
    if (clears > 0) {
      bits.push(['Descended', String(clears), '']);
      if (fastest > 0) bits.push(['Fastest', clock(fastest), '']);
    } else if (deepest > 0) {
      // Only before the first clear. After it, "deepest 25" is true of every
      // finished run and says nothing about this player.
      bits.push(['Deepest', `Wave ${deepest}`, '']);
    }
    if (richest > 0) bits.push(['Richest', String(richest), 'gold']);
    if (erased > 0) bits.push(['Erased', String(erased), '']);

    if (!bits.length) { recordEl.hidden = true; recordEl.textContent = ''; return null; }

    /**
     * BUILT AS NODES, NOT AS AN innerHTML STRING.
     *
     * Every value here is a number that core/save.js has already validated as
     * finite and non-negative, so there is nothing in it that could carry
     * markup. That is an argument for why this is safe TODAY, and it is an
     * argument that lives in a different file: it holds only for as long as
     * that validator keeps its current shape, and this save comes off
     * localStorage, which save.js itself describes as untrusted input in the
     * same way a query string is.
     *
     * Text nodes cost nothing and are correct regardless of what any other file
     * does later, so the safety is a property of this code rather than a
     * property of an agreement between two files.
     *
     * One span per field so the flex row wraps BETWEEN fields and never inside
     * one, which is what keeps "Fastest 14:22" from breaking in half on a phone.
     */
    recordEl.textContent = '';
    for (const [label, value, tail] of bits) {
      const span = doc.createElement('span');
      span.appendChild(doc.createTextNode(`${label} `));
      const b = doc.createElement('b');
      b.textContent = value;
      span.appendChild(b);
      if (tail) span.appendChild(doc.createTextNode(` ${tail}`));
      recordEl.appendChild(span);
    }
    recordEl.hidden = false;
    return { deepest, clears, fastest, erased, richest, fields: bits.length };
  }

  paintRecord();

  if (settingsBtn && onSettings) {
    settingsBtn.addEventListener('click', onSettings);
  }

  return {
    buttons,
    refresh,

    /**
     * Repaint the records line.
     *
     * Exposed because the ending card and the death card both write records
     * while this screen is hidden behind them, and a player who dies, presses
     * again, and quits to the title should not be shown the history they had
     * before the run they just finished.
     */
    paintRecord,

    /**
     * The run has begun: say which tier it is being played on, for as long as
     * it lasts.
     *
     * Written ONCE, here, rather than every frame from the readout loop. The
     * choice is locked for the run by construction, so a per-frame write would
     * be a DOM touch sixty times a second to restate a constant - and a value
     * the loop rewrites every frame is a value that looks live to the next
     * person to read it, which invites exactly the mid-run change this system
     * exists to forbid.
     */
    lockIn() {
      const tier = difficulty.tier;
      if (stampEl) stampEl.textContent = tier.name.toUpperCase();
      refresh();
      return tier;
    },

    stamp: stampEl,
  };
}
