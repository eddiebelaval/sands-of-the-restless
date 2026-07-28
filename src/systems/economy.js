/**
 * The gold economy.
 *
 * One number, one owner. Every price in the map is quoted against this and
 * every payout comes through award(), so rebalancing the game is a change to
 * BOUNTY and to the portal costs in rooms.js, and to nothing else.
 *
 * The award values are the tuned Treyarch numbers, kept exactly. They are not
 * arbitrary: the ratio of hit to kill is what makes emptying a magazine into a
 * crowd pay comparably to finishing one target, and the headshot premium is
 * what makes aiming worth the movement penalty. Changing one without the other
 * breaks the loop, so they live together in one frozen table.
 *
 * The starting purse is 500 against a 1000 doorway on purpose. The player
 * cannot buy their way in on the first breath; the opening minute is spent
 * earning the other half, which is the whole reason a buy-door is a better
 * gate than a locked door.
 *
 * No storage of any kind. Gold resets with the run, which is what a round-based
 * shooter means by a run.
 */

/** Payout per event. Frozen so a stray write cannot rebalance the game. */
export const BOUNTY = Object.freeze({
  /** Any round that connects without finishing the target. */
  hit: 10,
  /** A kill landed anywhere but the head. */
  kill: 60,
  /** A kill landed on the head. */
  headshot: 100,
});

export const STARTING_GOLD = 500;

/**
 * How many floating popups may exist at once.
 *
 * An automatic weapon into a crowd generates ten of these a second. Without a
 * cap the container grows without bound during a long fight and the HUD becomes
 * the most expensive thing on the page.
 */
const MAX_POPUPS = 14;

/** Popup lifetime, in milliseconds. Must match the CSS animation duration. */
const POPUP_MS = 1000;

/**
 * @param {object}      opts
 * @param {number}      [opts.start]    starting purse
 * @param {HTMLElement} [opts.popups]   container for floating gold popups
 */
export function createEconomy({ start = STARTING_GOLD, popups = null } = {}) {
  let gold = start;
  let earned = 0;                 // lifetime, for the end-of-run readout
  let spent = 0;

  /**
   * What every COMBAT payout is multiplied by. The Twin Crowns sets 2.
   *
   * Here rather than anywhere else for the same reason the Shrine of Thoth is
   * paid as a second award and not as a scaled bounty: BOUNTY is the tuned
   * spread and nothing reaches in to rewrite it. This multiplies the payout on
   * its way out of award(), which is the one function every kill in the game
   * comes through, so a bullet kill, a grenade kill and a scarab bitten to
   * death by a shotgun all double together or none of them do.
   *
   * It deliberately does NOT touch grant(), spend() or the puzzle reward. A
   * double-points drop doubles what you EARN IN COMBAT; it is not a discount on
   * doors and it is not a multiplier on a flat bonus that was already sized
   * against the wall buys.
   */
  let multiplier = 1;

  const listeners = new Set();

  // Live popup nodes, oldest first. Tracked rather than queried out of the DOM
  // so the cap costs one array read instead of a layout-forcing selector.
  const live = [];

  function notify(delta, reason) {
    for (const fn of listeners) fn(gold, delta, reason);
  }

  /**
   * Floating "+60" over the crosshair.
   *
   * DOM rather than a sprite, deliberately. A sprite popup needs glyphs, and
   * glyphs mean either a font file (forbidden) or a canvas raster (a texture
   * upload and a material per popup, for text that is legible for one second).
   * The HUD is already DOM, the numbers are already crisp at any resolution,
   * and the cost is one absolutely positioned element that the compositor
   * animates off the main thread.
   *
   * The float itself is a CSS animation, which runs on wall-clock time. That is
   * correct here and only here: this is a readout, not simulation. Nothing in
   * the game state depends on when it finishes, so it cannot desynchronise
   * anything by running at a different rate than the clamped frame delta.
   */
  function pop(text, tone = 'gain') {
    if (!popups) return null;

    const el = document.createElement('span');
    el.className = `gold-pop ${tone}`;
    el.textContent = text;

    // Jitter, so a shotgun's eight pellets do not stack into one illegible
    // slab of overlapping glyphs.
    el.style.setProperty('--dx', `${(Math.random() - 0.5) * 90}px`);
    el.style.setProperty('--dy', `${-26 - Math.random() * 30}px`);

    popups.appendChild(el);
    live.push(el);

    // Cull the oldest rather than waiting for its animation. Sustained fire
    // otherwise outruns the removal timer.
    while (live.length > MAX_POPUPS) {
      const old = live.shift();
      old.remove();
    }

    // A timer, not animationend: animationend never fires if the element is
    // hidden or the animation is disabled by a reduced-motion setting, and a
    // popup that is never removed is a leak with a friendly face.
    setTimeout(() => {
      const i = live.indexOf(el);
      if (i >= 0) live.splice(i, 1);
      el.remove();
    }, POPUP_MS + 60);

    return el;
  }

  /**
   * Pay out for a combat event.
   *
   * @param {'hit'|'kill'|'headshot'} kind
   * @param {object} [opts]
   * @param {boolean} [opts.silent]  award without a popup, for bulk grants
   * @returns {number} the amount awarded, 0 if the kind is unknown
   */
  function award(kind, opts = {}) {
    const amount = (BOUNTY[kind] || 0) * multiplier;
    if (!amount) return 0;

    gold += amount;
    earned += amount;

    if (!opts.silent) pop(`+${amount}`, kind === 'headshot' ? 'crit' : 'gain');
    notify(amount, kind);
    return amount;
  }

  function canAfford(n) {
    return gold >= n;
  }

  /**
   * Take gold for a purchase. Returns false and takes nothing if the purse is
   * short, so a caller can treat it as the buy itself rather than checking
   * first and hoping nothing changed in between.
   */
  function spend(n, reason = 'purchase') {
    if (n <= 0 || gold < n) return false;

    gold -= n;
    spent += n;

    pop(`-${n}`, 'debit');
    notify(-n, reason);
    return true;
  }

  /** Non-combat gold: the puzzle reward, a round bonus, the harness. */
  function grant(n, reason = 'grant') {
    if (n <= 0) return 0;
    gold += n;
    earned += n;
    notify(n, reason);
    return n;
  }

  /**
   * Register a HUD. Fires immediately with the current balance, so a subscriber
   * never has to paint an initial value itself and then hope it matches.
   */
  function subscribe(fn) {
    listeners.add(fn);
    fn(gold, 0, 'subscribe');
    return () => listeners.delete(fn);
  }

  return {
    BOUNTY,
    award,
    canAfford,
    spend,
    grant,
    subscribe,
    pop,

    get gold() { return gold; },
    get earned() { return earned; },
    get spent() { return spent; },

    /**
     * Multiply every combat payout. Clamped to sane ground and returned, so a
     * caller never has to read back what it just set.
     */
    setMultiplier(n) {
      multiplier = Math.max(1, Math.min(8, Number(n) || 1));
      return multiplier;
    },

    get multiplier() { return multiplier; },

    reset(to = start) {
      gold = to;
      earned = 0;
      spent = 0;
      // NOT the multiplier. A reset is a purse operation - the harness uses it
      // between sections, and fell() resets the run - and silently cancelling a
      // live boon from inside a bookkeeping call is exactly the kind of remote
      // effect that takes a day to find. Whoever granted the multiplier takes
      // it back.
      notify(0, 'reset');
    },
  };
}
