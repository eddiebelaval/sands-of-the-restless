/**
 * WALL BUYS: the second thing gold is for, and the first one that is a choice.
 *
 * A buy-door is a gate. You pay it once, it opens, and the map is bigger. That
 * makes gold a KEY. A wall buy is what makes gold a CURRENCY, because it is the
 * first purchase in the map you can make twice, can decline, and can regret: the
 * thousand you spend on the SMG in the first room is a thousand you are not
 * spending on the gate into the gallery, and both are correct answers.
 *
 * Three states, and the prompt has to tell them apart at a glance, because the
 * player is reading it while something is walking at them:
 *
 *   TAKE     you do not own this weapon. Full price. You leave holding it.
 *   REFILL   you own it AND you are carrying it. Half price, reserve only.
 *   nothing  you own it and are carrying something else. Silence, not a
 *            refusal - there is nothing wrong, there is just nothing on offer,
 *            and a red prompt would be the wall telling you off for walking
 *            past it.
 *
 * That last one is the reason this file exists rather than the whole thing
 * being four lines in a generic buy handler. In this genre a wall buy is a
 * standing offer, and an offer that shouts at you when you are not taking it is
 * an offer you learn to stop reading.
 *
 * REFILL PRICING is half the take price, which is the tuned convention from the
 * games this economy is lifted from and is not arbitrary: at half, topping up
 * the gun you already have always beats buying a second gun you do not need, so
 * the player who commits to a weapon is rewarded for it. An upgraded weapon
 * costs a flat 4500 instead, because the alternative - half of the take price of
 * a weapon that has been through the Altar - would refill the strongest gun in
 * the game for six hundred gold.
 */

import { STATS, displayName } from '../player/weapons.js';

/** What a refill costs once the weapon has been through the Altar of Ptah. */
export const UPGRADED_REFILL = 4500;

/** Take price to refill price. Half, and see the note above. */
export const REFILL_FRACTION = 0.5;

export function createWallBuys({ weapons, economy, audio, notice }) {
  const state = {
    taken: 0,
    refilled: 0,
    denied: 0,
    /** Weapon ids that have ever been bought off a wall, for the harness. */
    bought: new Set(),
  };

  /**
   * What this wall is offering RIGHT NOW.
   *
   * One function, called by both the prompt and the purchase, so the two can
   * never disagree about what the player is being sold. Deciding it twice - once
   * to draw the text and once to take the money - is how a prompt ends up
   * quoting a take price and charging a refill price.
   */
  function offerFor(rec) {
    const cfg = rec.config || {};
    const id = cfg.weapon;
    if (!id || !STATS[id]) return { kind: 'none' };

    const take = cfg.cost || 0;

    if (!weapons.owns(id)) {
      return { kind: 'take', id, cost: take };
    }

    // Refills are for the weapon IN YOUR HANDS. Standing at the shotgun wall
    // topping up a carbine you are not holding is not a thing this genre does,
    // and allowing it turns every wall in the map into a universal ammo box.
    if (weapons.state.current !== id) return { kind: 'idle', id };

    const full = weapons.ammo[id].reserve >= STATS[id].reserve;
    if (full) return { kind: 'full', id };

    const cost = weapons.isUpgraded(id)
      ? UPGRADED_REFILL
      : Math.round(take * REFILL_FRACTION);

    return { kind: 'refill', id, cost };
  }

  // ---------------------------------------------------------------------------
  // prompt
  // ---------------------------------------------------------------------------

  function describe(rec) {
    const offer = offerFor(rec);
    if (offer.kind === 'none') return { text: '', deny: false };

    const name = displayName(offer.id).toUpperCase();

    if (offer.kind === 'idle') return { text: '', deny: false };
    if (offer.kind === 'full') {
      // Not a refusal. The player is being told the answer to the question they
      // walked over to ask, which is "do I need this", and the answer is no.
      return { text: `${name} - AMMO FULL`, deny: false };
    }

    const verb = offer.kind === 'take' ? '' : 'REFILL ';
    const afford = economy.canAfford(offer.cost);

    return {
      text: `${verb}${name} - ${offer.cost} GOLD${afford ? '  [F]' : ''}`,
      deny: !afford,
    };
  }

  // ---------------------------------------------------------------------------
  // purchase
  // ---------------------------------------------------------------------------

  function deny(message) {
    state.denied++;
    audio?.purchaseDenied?.();
    if (message && notice) notice(message, 1600);
    return false;
  }

  function buy(rec) {
    const offer = offerFor(rec);
    if (offer.kind === 'none' || offer.kind === 'idle') return false;
    if (offer.kind === 'full') return false;

    if (!economy.canAfford(offer.cost)) {
      return deny(`Need ${offer.cost - economy.gold} more gold`);
    }

    // spend() IS the purchase, the same contract doors.js buys through. Checking
    // affordability and then deducting as two steps invites the balance to move
    // in between; this way the deduction either happened or the buy did not.
    if (!economy.spend(offer.cost, `wallbuy/${offer.id}`)) return deny();

    if (offer.kind === 'take') {
      weapons.grant(offer.id);
      // Straight into the hands. A weapon you have just paid a thousand gold
      // for and then have to find the number key for is a purchase that did not
      // land, and every game in this genre puts it in your hands.
      weapons.equip(offer.id);

      state.taken++;
      state.bought.add(offer.id);
      audio?.shrineChime?.();
      notice?.(displayName(offer.id).toUpperCase(), 1800);
      return true;
    }

    weapons.refillAmmo(offer.id);
    state.refilled++;
    audio?.magIn?.();
    return true;
  }

  return {
    state,
    describe,
    buy,
    offerFor,

    /** Prices, for the HUD, the harness and the balance pass. */
    priceOf(rec) { return (rec.config && rec.config.cost) || 0; },
    refillPriceOf(rec) {
      const id = rec.config && rec.config.weapon;
      if (id && weapons.isUpgraded(id)) return UPGRADED_REFILL;
      return Math.round(((rec.config && rec.config.cost) || 0) * REFILL_FRACTION);
    },
  };
}
