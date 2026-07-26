/**
 * THE SHRINES: six boons, four slots, and one switch that turns them all on.
 *
 * Every one is a shrine to the god whose domain matches its effect, and that is
 * the design rather than a coat of paint. The map is a pyramid; the currency is
 * grave gold; the enemies are the restless dead. A perk machine with a jingle
 * would be borrowing a joke from a different game, and the joke would be the
 * only thing in the room that was not about Egypt.
 *
 *   Sekhmet  2500  +150 vitality        lioness of war, who is survival
 *   Ptah     3000  reload halved        the craftsman, who is hands working fast
 *   Set      2000  more damage, faster  chaos and violence, who is the wrong kind
 *                                       of strength
 *   Shu      2000  endless sprint       god of air, who holds the sky up
 *   Anubis   1500  one free death       who weighs the heart and, once, gives it
 *                                       back
 *   Thoth    3000  double headshot gold scribe and counter of things
 *
 * THE CAP IS DATA. Four is what the player can hold today and six is where it
 * goes when the canopic puzzle lands, so the number lives in CAPACITY with a
 * ceiling next to it and raise() as the only way to change it. A hardcoded 4
 * would be four separate edits later, and the fourth one would be in a comparison
 * somebody forgot about.
 *
 * WHAT EACH BOON TOUCHES, and why none of it is a special case in a frame loop:
 * a boon is a record with apply() and remove(), and the effects reach into the
 * systems that own the numbers rather than the frame loop reaching into the
 * boons. Damage and fire rate go through the weapon stat table. Reload goes
 * through the one reload-scale field the viewmodel's delta and the headless
 * fallback timer both read. Vitality writes the player's own maxHealth, which
 * regeneration and the death check already measure against. The three that
 * cannot be expressed as somebody else's number - sprint, the free death, and
 * the headshot bonus - are read as flags off `has()` at the one place each is
 * decided, and are documented at that place.
 */

import { setGlobalModifiers } from '../player/weapons.js';

/**
 * How many boons the player may hold, and how high that can ever go.
 *
 * `base` is today. `ceiling` is the promise the canopic puzzle is going to
 * keep. raise() refuses to go past it, so a future reward that gets its
 * arithmetic wrong cannot hand the player all six and empty the map of reasons
 * to choose.
 */
export const CAPACITY = { base: 4, ceiling: 6 };

/** Vitality the Shrine of Sekhmet adds. */
const SEKHMET_VITALITY = 150;

/** What the Shrine of Set does. Roughly a Double Tap: more per round, more rounds. */
const SET_DAMAGE = 1.5;
const SET_RATE = 1.33;

/** Reload time multiplier under Ptah. */
const PTAH_RELOAD = 0.5;

export const BOONS = {
  sekhmet: {
    id: 'sekhmet',
    name: 'Shrine of Sekhmet',
    cost: 2500,
    /** One short line, for the HUD strip and the purchase notice. */
    effect: '+150 VITALITY',

    apply({ player }) {
      player.state.maxHealth += SEKHMET_VITALITY;
      // Handed over as health, not just as headroom. A player who pays 2500 for
      // a bigger bar and watches it stay at the same absolute number while the
      // bar gets longer has been sold nothing they can feel.
      player.heal(SEKHMET_VITALITY);
    },
    remove({ player }) {
      player.state.maxHealth = Math.max(1, player.state.maxHealth - SEKHMET_VITALITY);
      if (player.state.health > player.state.maxHealth) {
        player.state.health = player.state.maxHealth;
      }
    },
  },

  ptah: {
    id: 'ptah',
    name: 'Shrine of Ptah',
    cost: 3000,
    effect: 'RELOAD HALVED',

    apply({ weapons }) { weapons.state.reloadScale = PTAH_RELOAD; },
    remove({ weapons }) { weapons.state.reloadScale = 1; },
  },

  set: {
    id: 'set',
    name: 'Shrine of Set',
    cost: 2000,
    effect: 'DAMAGE AND RATE UP',

    apply() { setGlobalModifiers({ damage: SET_DAMAGE, rpm: SET_RATE }); },
    remove() { setGlobalModifiers({ damage: 1, rpm: 1 }); },
  },

  shu: {
    id: 'shu',
    name: 'Shrine of Shu',
    cost: 2000,
    effect: 'ENDLESS SPRINT',
    // No apply(). The frame loop asks has('shu') when it moves the player: see
    // the note in main.js, where the sprint substep is.
  },

  anubis: {
    id: 'anubis',
    name: 'Shrine of Anubis',
    cost: 1500,
    effect: 'ONE DEATH FORGIVEN',
    // No apply() either. This one is a CHARGE rather than a state, and it is
    // spent by consumeAnubis() below when a blow would have finished the run.
  },

  thoth: {
    id: 'thoth',
    name: 'Shrine of Thoth',
    cost: 3000,
    effect: 'DOUBLE HEADSHOT GOLD',
    // Read by payout() in main.js, which is the only place a headshot is priced.
  },
};

export const BOON_ORDER = ['sekhmet', 'ptah', 'set', 'shu', 'anubis', 'thoth'];

export function createShrines({ weapons, player, economy, audio, notice, power }) {
  const held = new Set();
  const listeners = new Set();

  const state = {
    held,
    capacity: CAPACITY.base,
    bought: 0,
    denied: 0,
    /** Times the Shrine of Anubis has given a run back. */
    forgiven: 0,
  };

  const ctx = { weapons, player, economy };

  /** Fixture records, filled by attach() so the HUD can find a shrine by boon. */
  let records = [];

  function notify() {
    for (const fn of listeners) fn(list(), state.capacity);
  }

  function list() {
    return BOON_ORDER.filter((id) => held.has(id)).map((id) => BOONS[id]);
  }

  function has(id) { return held.has(id); }

  // ---------------------------------------------------------------------------
  // prompt
  // ---------------------------------------------------------------------------

  /**
   * Why this shrine will not take gold, or null if gold is the only obstacle.
   *
   * A gated shrine NEVER SHOWS A PRICE. That is the same rule doors.js keeps for
   * the power gate and the puzzle gate, and it is the rule doing the most work
   * in the whole interface: a price on the screen means "come back richer", and
   * a shrine that is dark or a slot that is full will not open for any amount of
   * money at all.
   */
  function lockedBecause(rec) {
    const id = rec.config && rec.config.boon;
    if (!id || !BOONS[id]) return 'No god answers here';

    const dark = power.lockedBecause();
    if (dark) return dark;
    if (held.has(id)) return null;                 // already yours: see describe
    if (held.size >= state.capacity) {
      return `You carry ${state.capacity} boons`;
    }
    return null;
  }

  function describe(rec) {
    const id = rec.config && rec.config.boon;
    const boon = BOONS[id];
    if (!boon) return { text: '', deny: false };

    const name = boon.name.toUpperCase();

    if (held.has(id)) {
      // Held is not a refusal, so it is not red. It is the shrine confirming
      // what the HUD already says.
      return { text: `${name} - ${boon.effect}`, deny: false };
    }

    const why = lockedBecause(rec);
    if (why) return { text: `${name} - ${why.toUpperCase()}`, deny: true };

    const afford = economy.canAfford(boon.cost);
    return {
      text: `${name} - ${boon.cost} GOLD${afford ? '  [F]' : ''}`,
      deny: !afford,
    };
  }

  // ---------------------------------------------------------------------------
  // purchase
  // ---------------------------------------------------------------------------

  function deny(message) {
    state.denied++;
    audio?.purchaseDenied?.();
    if (message && notice) notice(message, 1800);
    return false;
  }

  function buy(rec) {
    const id = rec.config && rec.config.boon;
    const boon = BOONS[id];
    if (!boon) return false;
    if (held.has(id)) return false;

    const why = lockedBecause(rec);
    if (why) {
      if (!power.powered) power.noteRefusal();
      return deny(why);
    }

    if (!economy.canAfford(boon.cost)) {
      return deny(`Need ${boon.cost - economy.gold} more gold`);
    }
    if (!economy.spend(boon.cost, `shrine/${id}`)) return deny();

    grant(id, rec);
    return true;
  }

  /**
   * Take a boon without paying. The purchase path above, the harness, and any
   * future reward that hands one out all land here, so an effect can never be
   * applied by one route and skipped by another.
   */
  function grant(id, rec = null) {
    const boon = BOONS[id];
    if (!boon || held.has(id)) return false;
    if (held.size >= state.capacity) return false;

    held.add(id);
    state.bought++;

    if (boon.apply) boon.apply(ctx);

    const fixture = rec || records.find((r) => (r.config && r.config.boon) === id);
    fixture?.visuals?.setHeld?.(true);

    audio?.shrineChime?.();
    notice?.(`${boon.name.toUpperCase()} - ${boon.effect}`, 2400);
    notify();
    return true;
  }

  function drop(id) {
    const boon = BOONS[id];
    if (!boon || !held.has(id)) return false;

    held.delete(id);
    if (boon.remove) boon.remove(ctx);

    const fixture = records.find((r) => (r.config && r.config.boon) === id);
    fixture?.visuals?.setHeld?.(false);

    notify();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Anubis
  // ---------------------------------------------------------------------------

  /**
   * Spend the free death, if there is one. Returns true if the run continues.
   *
   * The boon is DROPPED as it is spent, which does three useful things at once:
   * the free death is genuinely once, the shrine goes dark again so the map
   * shows the player what they used, and a slot comes free so they can buy
   * something else with the gold they are about to earn. Called from the damage
   * intercept in main.js, which is the only place a fatal blow is known about.
   */
  function consumeAnubis() {
    if (!held.has('anubis')) return false;

    drop('anubis');
    state.forgiven++;

    audio?.bossHorn?.();
    notice?.('ANUBIS WEIGHS YOUR HEART AND RETURNS IT', 3400);
    return true;
  }

  // ---------------------------------------------------------------------------
  // capacity
  // ---------------------------------------------------------------------------

  /** Raise the cap. The canopic puzzle's reward, when it lands. */
  function raise(to) {
    const next = Math.min(CAPACITY.ceiling, Math.max(state.capacity, to));
    if (next === state.capacity) return state.capacity;
    state.capacity = next;
    notify();
    return state.capacity;
  }

  /**
   * Lose every boon, keep the cap.
   *
   * This is what going down costs. The CAP is not touched on purpose: it is
   * the canopic puzzle's reward, which is a thing the player solved rather
   * than a thing they bought, and taking it away for dying would mean the
   * puzzle has to be solved twice.
   */
  function dropAll() {
    const n = held.size;
    for (const id of [...held]) drop(id);
    return n;
  }

  /** Back to the start of a run: no boons, four slots, no debts. */
  function reset() {
    dropAll();
    state.capacity = CAPACITY.base;
    state.forgiven = 0;
  }

  return {
    state,
    BOONS,
    describe,
    buy,
    grant,
    drop,
    dropAll,
    raise,
    reset,
    has,
    list,
    consumeAnubis,
    lockedBecause,

    /** Late binding: the fixtures are picked up from the interact layer. */
    attach(fixtures) {
      records = fixtures.filter((r) => r.type === 'shrine');
      return records.length;
    },

    subscribe(fn) {
      listeners.add(fn);
      fn(list(), state.capacity);
      return () => listeners.delete(fn);
    },

    get capacity() { return state.capacity; },
    get count() { return held.size; },
    get full() { return held.size >= state.capacity; },
  };
}
