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
export function createStartScreen({ veil, difficulty, onSettings, doc = document }) {
  const row = veil && veil.querySelector('[data-tiers]');
  const noteEl = veil && veil.querySelector('[data-tier-note]');
  const settingsBtn = veil && veil.querySelector('[data-open-settings]');

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

  if (settingsBtn && onSettings) {
    settingsBtn.addEventListener('click', onSettings);
  }

  return {
    buttons,
    refresh,

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
