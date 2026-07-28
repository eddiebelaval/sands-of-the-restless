/**
 * THE CHEST OF THE NAMELESS: the mystery box.
 *
 * Everything else in the economy is a shop. A wall buy is a price tag on a
 * weapon you can see before you pay; a shrine is a named effect for a named
 * figure; the Altar takes what is in your hands and gives it back better. All
 * three are transactions, and a player who has learned the map knows the answer
 * to every one of them before they walk up.
 *
 * This is the only thing in the game you can spend gold on and NOT KNOW WHAT
 * YOU BOUGHT. That is the whole reason it exists and it is why none of the
 * three obvious simplifications are taken:
 *
 *   - it does not print a name. It rolls, and the roll is long enough to be a
 *     moment and slows into its result rather than stopping dead. A box that
 *     instantly prints a weapon name is a vending machine with a random stock,
 *     and nobody has ever gathered round one of those.
 *
 *   - the offer is REFUSABLE and the refusal is a timeout, not a menu. The
 *     chest holds the weapon up for a few seconds and then takes it back. A
 *     dialogue with a Take and a Leave button would make the decision free;
 *     making the player decide while a wave closes on them is the decision.
 *
 *   - it MOVES. After four to eight pulls - randomised per placement, so the
 *     count can never be learned - a scarab comes out of it, the lid drops, and
 *     the chest is somewhere else. Without that the box is a corner of the map
 *     you stand in for twenty waves. rooms.js authors three spawns for exactly
 *     this and world/build.js builds a plinth at all three.
 *
 * WHY THE TWO MISSING WEAPONS ARE HERE. The bolt rifle and the Sunspear have no
 * wall anywhere in the pyramid. Until this file existed they were built, tested,
 * and unreachable - two of seven weapons that no run could ever hold. The box is
 * their only route in, and it is the right one: the two strongest weapons in the
 * armoury should be luck and 950 gold rather than a price on a wall that any
 * player can walk to on wave four.
 *
 * The split with world/build.js is the one every fixture in this game keeps.
 * build.js owns what a chest IS - the plinth, the lid, the beam, the mark that
 * rides it, the scarab - and exposes a handle of setters. This file owns what a
 * pull COSTS, what it may produce, how long the roll takes, when the box goes
 * cold and where it goes next. Neither knows how the other does its half.
 *
 * EVERY DURATION IN HERE IS SIMULATED SECONDS, accumulated from the clamped
 * frame delta. Under software rendering that runs about six times slower than
 * the wall clock, which is exactly why nothing in this file or its harness may
 * ever wait on a timer.
 */

import { STATS, displayName } from '../player/weapons.js';

/** What one pull costs. */
export const PULL_COST = 950;

/**
 * WHAT ONE PULL COSTS DURING A FIRE SALE.
 *
 * Ten, which is the canonical number and reads as a joke the player is in on:
 * it is not a discount, it is the necropolis briefly not caring. A pull is
 * still a spend rather than free, so the purchase path is the identical path -
 * economy.spend() is still the buy, it can still fail on an empty purse, and
 * there is no second branch through this file that grants a roll without taking
 * anything.
 */
export const FIRE_SALE_COST = 10;

/** How long a sale runs, in simulated seconds, if nobody says otherwise. */
export const FIRE_SALE_SECONDS = 30;

/**
 * THE STOCK LIST.
 *
 * Six of the seven weapons. The MK9 is left out deliberately and it is the one
 * judgement call in this file: every player starts holding it, so a 950-gold
 * roll that lands on it is not a bad prize, it is the box handing back a gun the
 * player already has and charging them for the privilege. Treyarch's box does
 * not stock the starting pistol either, and for the same reason.
 *
 * Every id here MUST have a chalk mark in world/build.js's CHALK table or the
 * chest presents a blank plate. test/mysterybox.mjs asserts the two lists agree.
 */
export const POOL = ['smg', 'shotgun', 'carbine', 'lmg', 'bolt', 'sunspear'];

/**
 * Pulls before the chest goes cold, drawn fresh for every placement.
 *
 * A FIXED count would be learned in one session and then counted, and a box you
 * can count is a box you can camp until the last safe pull. Four is enough that
 * a placement is worth walking to; eight is few enough that the map keeps
 * moving underneath a long run.
 */
export const COLD_AFTER = { min: 4, max: 8 };

/**
 * The shape of a pull, in simulated seconds.
 *
 * `rolling` plus `settling` is four seconds of not knowing, which is long
 * enough to be a moment and short enough to spend under fire. `presenting` is
 * the refusal window, and it is the number to change first if the box feels
 * generous: at six and a half seconds a player can look at what they were
 * offered, look at what is in their hands, and still decide.
 */
export const PHASE = Object.freeze({
  opening: 0.55,
  rolling: 3.10,
  settling: 0.90,
  presenting: 6.50,
  withdrawing: 0.70,
  cooling: 2.30,
  arriving: 0.85,
});

/** Seconds between marks at the start of the roll, and at the end of it. */
const CYCLE_FAST = 0.055;
const CYCLE_SLOW = 0.46;

/**
 * How hard the cycle decelerates. 1 is linear and reads as the roll simply
 * running out of frames; above 2 the first half is a blur and the last four
 * marks are individually readable, which is the part the player actually
 * watches.
 */
const CYCLE_EASE = 2.2;

/** How often the jingle re-triggers while the chest is open. */
const JINGLE_EVERY = 1.30;

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInCubic(t) { return t * t * t; }

/**
 * When each mark changes during a roll, and which mark to start from.
 *
 * The schedule is built BACKWARDS from the answer. The eased interval decides
 * how many marks there is time for; knowing that count, the starting offset is
 * chosen so the LAST one to appear is the weapon that was already drawn. So the
 * cycle is a genuine cycle through the stock in order - not a stream of
 * unrelated random picks that stops on a rigged frame - and it still cannot
 * land anywhere but on the prize.
 */
function buildSchedule(resultIndex, duration = PHASE.rolling) {
  const times = [];
  let t = 0;

  while (t < duration) {
    times.push(t);
    const p = t / duration;
    t += CYCLE_FAST + (CYCLE_SLOW - CYCLE_FAST) * Math.pow(p, CYCLE_EASE);
  }
  if (!times.length) times.push(0);

  const n = times.length;
  const offset = ((resultIndex - (n - 1)) % POOL.length + POOL.length) % POOL.length;
  return { times, offset };
}

/**
 * @param {object}   opts
 * @param {object}   opts.weapons   player/weapons.js
 * @param {object}   opts.economy   systems/economy.js
 * @param {object}   opts.player    for pointing the reveal at whoever is watching
 * @param {object}   [opts.audio]
 * @param {Function} [opts.notice]
 * @param {Function} [opts.rng]     injectable, so the harness can force a result
 */
export function createMysteryBox({ weapons, economy, player, audio, notice, rng = Math.random }) {
  const state = {
    /**
     * 'dormant'  no chest anywhere yet (before attach)
     * 'idle'     closed, for sale
     * 'opening'  lid rising, beam coming up
     * 'rolling'  marks cycling
     * 'settling' the roll landing on its result. Takeable.
     * 'presenting' the offer standing. Takeable, and running out.
     * 'withdrawing' the offer resolved either way, chest closing
     * 'cooling'  the scarab leaving, the chest going
     * 'arriving' the chest seating itself somewhere new
     */
    phase: 'dormant',

    /** Which spawn letter is live. */
    spawn: null,

    /** Pulls at THIS placement, and what it takes to move it. */
    pulls: 0,
    coldAt: 0,

    /** Lifetime counters, for the HUD, the harness and the balance pass. */
    pullsTotal: 0,
    taken: 0,
    left: 0,
    relocations: 0,
    denied: 0,

    /** The weapon currently on offer, and every weapon ever offered. */
    offer: null,
    offered: [],
    granted: [],

    /** Seconds left on the refusal window. Quoted in the prompt. */
    offerLeft: 0,

    /**
     * THE FIRE SALE.
     *
     * `fireSale` is whether one is running, `saleLeft` the simulated seconds
     * remaining, and `saleEnding` whether the window has run out and the sale
     * is being HELD OPEN because the chest is mid-pull. See endSale().
     */
    fireSale: false,
    saleLeft: 0,
    /** The window this sale was STARTED with, so a HUD bar has a denominator. */
    saleFor: 0,
    saleEnding: false,
    salesTotal: 0,
    saleHops: 0,
  };

  /** Fixture records, filled by attach(). Index into this is the placement. */
  let records = [];
  let index = -1;

  /**
   * WHERE THE CHEST LIVES, as against where it is being USED.
   *
   * Outside a Fire Sale these are the same number and `home` is dead weight.
   * During one, every plinth is awake and the player may pull at any of them,
   * so `index` follows whichever one they walked to while `home` stays on the
   * placement the chest actually occupies. When the sale ends, the chest is at
   * `home` and the other two go dark.
   *
   * That is the whole reason a sale cannot secretly relocate the chest. It is
   * moved by exactly one thing - going cold, which announces itself with a
   * scarab, a sting and a banner - and settle() is the only function that
   * writes `home`.
   */
  let home = -1;

  /** Positional audio handles, one per chest, keyed by the same index. */
  const voices = [];

  let t = 0;                 // seconds inside the current phase
  let schedule = null;
  let goingCold = false;
  let jingleAt = 0;

  // The reveal's rotation. Kept across frames so the spin decelerates into the
  // player's facing rather than snapping to it.
  let spin = 0;
  let spinTarget = 0;

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const randInt = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

  function current() { return index >= 0 ? records[index] : null; }
  function visuals() { const r = current(); return r && r.visuals; }
  function isActive(rec) { return !!rec && rec === current(); }

  /**
   * ONE PRICE, READ FROM ONE PLACE.
   *
   * describe() quotes this and pull() spends this, and they are one function
   * call rather than two constants precisely because a Fire Sale is the obvious
   * way to break the invariant every purchase in this game keeps: what the
   * prompt says is what the purse loses. There is no path through this file
   * where the quote and the debit can be computed differently, and the harness
   * asserts the two against each other rather than against 10.
   */
  function price() {
    return state.fireSale ? FIRE_SALE_COST : PULL_COST;
  }

  /**
   * Is this plinth lit and open for business at all.
   *
   * Outside a sale that is exactly one of the three. During a sale it is all of
   * them, which is the part that makes it an EVENT rather than a discount: the
   * two dormant plinths the player has walked past for ten waves come up
   * together, and the one they are nearest is the one they use.
   */
  function isAwake(rec) {
    if (!rec) return false;
    if (isActive(rec)) return true;
    return state.fireSale && records.includes(rec);
  }

  /** Wake or sleep every placement that is not the one in use. */
  function setExtrasAwake(on) {
    for (let i = 0; i < records.length; i++) {
      if (i === index) continue;
      const v = records[i].visuals;
      if (!v) continue;
      if (on) { v.setPresent(true); v.setArrive(1); } else { v.setPresent(false); }
    }
  }

  // ---------------------------------------------------------------------------
  // placement
  // ---------------------------------------------------------------------------

  /**
   * Put the chest at a placement. `announce` is false only for the first one,
   * because a chest that plays its arrival sting during the loading screen has
   * announced itself to nobody.
   */
  function settle(next, announce = true) {
    const prev = current();
    if (prev && prev.visuals) prev.visuals.setPresent(false);

    index = next;
    home = next;
    state.spawn = (records[next].config && records[next].config.spawn) || String(next);
    state.pulls = 0;
    state.coldAt = randInt(COLD_AFTER.min, COLD_AFTER.max);

    const v = visuals();
    if (v) {
      v.setPresent(true);
      v.setArrive(announce ? 0 : 1);
    }

    // A relocation inside a Fire Sale still leaves every plinth lit. setPresent
    // above has just put the one it moved AWAY from to sleep, which is right
    // outside a sale and wrong inside one.
    if (state.fireSale) setExtrasAwake(true);

    setPhase(announce ? 'arriving' : 'idle');
    if (announce) voices[index] && voices[index].play('boxJingle', { gain: 0.55 });
  }

  /**
   * Move which plinth is BEING USED, without moving the chest.
   *
   * Only legal during a Fire Sale and only from idle, so it can never land
   * inside a roll: the player walks to a lit plinth, presses F, and the machine
   * runs there. The pull counter and the go-cold threshold deliberately do NOT
   * reset - see the note on pull() - because the three plinths in a sale are one
   * chest with three doors, not three chests.
   */
  function hopTo(next) {
    if (next === index) return false;
    index = next;
    state.spawn = (records[next].config && records[next].config.spawn) || String(next);
    state.saleHops++;
    spin = 0;
    return true;
  }

  /**
   * Somewhere else. Uniform among the placements that are not this one, which
   * with three spawns is a coin flip and is deliberately not weighted: a box
   * that prefers the room it is already near would be a box the player can
   * predict, and predicting it is the thing this mechanic is against.
   */
  function relocate() {
    const others = records.map((_, i) => i).filter((i) => i !== index);
    if (!others.length) { setPhase('idle'); return; }

    state.relocations++;
    settle(others[Math.floor(rng() * others.length)], true);
  }

  // ---------------------------------------------------------------------------
  // phases
  // ---------------------------------------------------------------------------

  function setPhase(next) {
    state.phase = next;
    t = 0;
  }

  function deny(message) {
    state.denied++;
    audio?.purchaseDenied?.();
    if (message && notice) notice(message, 1600);
    return false;
  }

  /** Pay, draw, and start the roll. */
  function pull() {
    const cost = price();

    if (!economy.canAfford(cost)) {
      return deny(`Need ${cost - economy.gold} more gold`);
    }

    // spend() IS the purchase, the same contract doors.js and wallbuy.js buy
    // through. Checking the purse and then deducting as two steps invites the
    // balance to move in between; this way the deduction either happened or the
    // pull did not.
    if (!economy.spend(cost, 'mysterybox')) return deny();

    const i = Math.floor(rng() * POOL.length);
    state.offer = POOL[i];
    state.offered.push(state.offer);
    schedule = buildSchedule(i);

    /**
     * A SALE PULL STILL COUNTS TOWARD GOING COLD.
     *
     * The alternative is a thirty-second window of unbounded ten-gold rolls,
     * which is not a bonus, it is the armoury handed over. Counting them means
     * a sale is worth four to eight pulls at most - the same budget any
     * placement has ever had - and what the sale actually buys is that those
     * pulls cost 10 instead of 950 and can be taken at whichever of the three
     * plinths the player is nearest. That is already an enormous swing: 950 to
     * 10 is the entire price of the mechanic.
     */
    state.pulls++;
    state.pullsTotal++;
    goingCold = state.pulls >= state.coldAt;

    setPhase('opening');
    jingleAt = -Infinity;
    spin = 0;
    return true;
  }

  /** The player takes what is on offer. */
  function take() {
    const id = state.offer;
    if (!id || !STATS[id]) return false;

    const isNew = !weapons.owns(id);

    // grant() refills as it grants, which is what makes a duplicate roll worth
    // taking: the box hands back a full weapon rather than the same empty one.
    weapons.grant(id);
    // Straight into the hands. The same argument wall buys make: a weapon you
    // just paid for and then have to find the number key for is a purchase that
    // did not land.
    weapons.equip(id);

    state.taken++;
    state.granted.push(id);

    voices[index] && voices[index].play('shrineChime', { gain: 1.0 });
    notice?.(`${displayName(id).toUpperCase()}${isNew ? '' : ' - RESTOCKED'}`, 2400);

    resolve();
    return true;
  }

  /** The offer is over, taken or not. */
  function resolve() {
    state.offerLeft = 0;
    setPhase('withdrawing');
  }

  // ---------------------------------------------------------------------------
  // the fire sale
  // ---------------------------------------------------------------------------

  /**
   * THE NAMELESS ARE GENEROUS.
   *
   * Two things happen and the second is the one that makes it an event: the
   * price drops to a token, and every plinth on the map wakes up. The dormant
   * plinths are already built, already placed and already silent when asleep,
   * so waking them is one call each - and the player who has spent ten waves
   * walking past a dead slab in the Great Gallery watches it come up.
   *
   * Re-triggering refreshes the window rather than extending it, on the same
   * principle the power-up effects use: two of the same boon is not double the
   * boon.
   */
  function fireSale(seconds = FIRE_SALE_SECONDS) {
    const fresh = !state.fireSale;

    state.fireSale = true;
    state.saleEnding = false;
    state.saleLeft = Math.max(state.saleLeft, seconds);
    state.saleFor = Math.max(state.saleFor, seconds);

    if (fresh) {
      state.salesTotal++;
      setExtrasAwake(true);
      notice?.('THE NAMELESS ARE GENEROUS - EVERY CHEST, 10 GOLD', 3400);
      for (let i = 0; i < records.length; i++) {
        voices[i] && voices[i].play('boxJingle', { gain: 0.5 });
      }
    }

    return true;
  }

  /**
   * End it, or ASK to end it.
   *
   * THE ONE CASE THAT MATTERS is the window running out while the player is
   * standing at a plinth that is not the chest's home, mid-roll, watching marks
   * cycle on 10 gold they have already spent. Ending the sale there would put
   * the chest back at `home` and the fixture they are looking at to sleep, with
   * their pull inside it. So the sale is HELD OPEN until the machine is idle
   * again, and `saleEnding` says so on the HUD. The player keeps the roll they
   * paid for and cannot keep starting new ones, because the price restores the
   * moment the window is genuinely over.
   *
   * The same rule covers a sale that runs out while the chest is COOLING: the
   * scarab, the sting and the relocation all finish, the chest settles at its
   * new home, and only then do the extras go dark.
   */
  function endSale() {
    if (state.phase !== 'idle') {
      state.saleEnding = true;
      return false;
    }

    state.fireSale = false;
    state.saleEnding = false;
    state.saleLeft = 0;
    state.saleFor = 0;

    // Back to the chest's own plinth. This is a no-op unless the player pulled
    // somewhere else during the window.
    if (home >= 0 && home !== index) {
      index = home;
      state.spawn = (records[home].config && records[home].config.spawn) || String(home);
      const v = visuals();
      if (v) { v.setPresent(true); v.setArrive(1); }
    }

    setExtrasAwake(false);
    notice?.('THE NAMELESS CLOSE THEIR HANDS', 2600);
    return true;
  }

  // ---------------------------------------------------------------------------
  // prompt
  // ---------------------------------------------------------------------------

  /**
   * A dormant plinth says NOTHING.
   *
   * Not a refusal, and this is the same call wallbuy.js makes for a weapon you
   * own and are not carrying: there is nothing wrong here, there is simply
   * nothing on offer, and a red prompt would be two thirds of the map's plinths
   * telling the player off for walking past them.
   */
  function describe(rec) {
    if (!isActive(rec)) {
      // A plinth woken by a Fire Sale is a real fixture with a real price, and
      // it quotes the SAME price() the debit reads. While the chest is busy at
      // one of the three, the other two say what the busy one says, because
      // "the chest is stirring" is true of all of them at once during a sale.
      if (!isAwake(rec)) return { text: '', deny: false };
      if (state.phase !== 'idle') {
        return { text: 'THE CHEST OF THE NAMELESS STIRS', deny: false };
      }
      const affordHere = economy.canAfford(price());
      return {
        text: `THE NAMELESS ARE GENEROUS - ${price()} GOLD${affordHere ? '  [F]' : ''}`,
        deny: !affordHere,
      };
    }

    switch (state.phase) {
      case 'idle': {
        const afford = economy.canAfford(price());
        if (state.fireSale) {
          return {
            text: `THE NAMELESS ARE GENEROUS - ${price()} GOLD${afford ? '  [F]' : ''}`,
            deny: !afford,
          };
        }
        return {
          text: `CHEST OF THE NAMELESS - ${price()} GOLD${afford ? '  [F]' : ''}`,
          deny: !afford,
        };
      }

      case 'opening':
      case 'rolling':
        return { text: 'THE CHEST OF THE NAMELESS STIRS', deny: false };

      case 'settling':
      case 'presenting': {
        // The countdown is the refusal window made legible. Without it the
        // player has no way to tell an offer that is about to lapse from one
        // that has just landed, and the only way to learn is to lose one.
        const left = Math.max(1, Math.ceil(state.offerLeft));
        return {
          text: `TAKE THE ${displayName(state.offer).toUpperCase()} - ${left}  [F]`,
          deny: false,
        };
      }

      case 'withdrawing':
        return { text: 'THE CHEST CLOSES', deny: false };

      // Red, and rightly: this is the one state where the fixture is refusing
      // the player rather than the player refusing the fixture.
      case 'cooling':
        return { text: 'THE CHEST GOES COLD', deny: true };

      default:
        return { text: '', deny: false };
    }
  }

  // ---------------------------------------------------------------------------
  // interaction
  // ---------------------------------------------------------------------------

  function buy(rec) {
    // A sale plinth that is not the one in use. Walking up to it and pressing F
    // moves the machine there and pulls, in one keypress - which is what the
    // player thinks they are doing. It is refused unless the chest is idle, so
    // this can never yank a roll out from under itself.
    if (!isActive(rec) && isAwake(rec) && state.phase === 'idle') {
      const i = records.indexOf(rec);
      if (i < 0) return false;
      hopTo(i);
      return pull();
    }

    if (!isActive(rec)) return false;
    if (state.phase === 'idle') return pull();
    if (state.phase === 'settling' || state.phase === 'presenting') return take();
    return false;
  }

  // ---------------------------------------------------------------------------
  // frame
  // ---------------------------------------------------------------------------

  /** Which mark the schedule is showing at time `time` into the roll. */
  function markAt(time) {
    if (!schedule) return null;
    const { times, offset } = schedule;

    let i = 0;
    while (i + 1 < times.length && times[i + 1] <= time) i++;
    return POOL[(offset + i) % POOL.length];
  }

  /**
   * Point the reveal at whoever is standing there.
   *
   * A flat plate that always faces the chest's authored front is edge-on and
   * unreadable from two of the three sides a player can approach any of these
   * spawns from. Recomputed once, at the moment the roll lands, rather than
   * every frame: a plate that tracks the player is a billboard, and a billboard
   * in a world of stone reads as a bug.
   */
  function aimAtPlayer() {
    const rec = current();
    if (!rec) return;

    const dx = player.position.x - rec.x;
    const dz = player.position.z - rec.z;

    /**
     * THE HALF TURN IS NOT A FUDGE.
     *
     * atan2(dx, dz) - rot is the player's bearing in the fixture's own frame,
     * measured off local +Z. The mark's FACE is on local -Z - the same
     * convention every fixture in world/build.js keeps, because -Z is the side
     * the player walks up to - so pointing the face at a bearing means turning
     * to that bearing plus half a turn.
     *
     * Without it the plate turned its BACK on whoever had just paid 950 gold,
     * at every spawn, in every room, and the bug survived a green suite because
     * the only thing measured was how bright the reveal was. A slab of granite
     * lit from behind by a beam is very bright indeed.
     */
    const want = Math.atan2(dx, dz) - (rec.rot || 0) + Math.PI;

    // Keep turning the way it was already turning. Unwrapping to the nearest
    // equivalent angle is what stops the mark snapping backwards through three
    // quarters of a turn on the last frame of the roll.
    spinTarget = want;
    while (spinTarget < spin) spinTarget += Math.PI * 2;
  }

  function update(dt, elapsed = 0) {
    const v = visuals();
    if (!v) return;

    t += dt;
    v.tick(dt, elapsed);

    // --- the fire sale --------------------------------------------------------
    //
    // Simulated seconds, like every other duration in this file. The extras
    // breathe too, because a lit plinth that is perfectly still next to one that
    // is breathing reads as the still one being broken.
    if (state.fireSale) {
      for (let i = 0; i < records.length; i++) {
        if (i !== index && records[i].visuals) records[i].visuals.tick(dt, elapsed);
      }

      if (state.saleLeft > 0) {
        state.saleLeft = Math.max(0, state.saleLeft - dt);
        if (state.saleLeft <= 0) endSale();
      } else {
        // Held open past its window because the chest was busy. Try again every
        // frame; endSale() is the thing that knows when it is safe.
        endSale();
      }
    }

    switch (state.phase) {
      case 'arriving': {
        const k = clamp01(t / PHASE.arriving);
        // A little past one and back, so the chest lands rather than inflates.
        v.setArrive(easeOutCubic(k) * (1 + 0.12 * Math.sin(Math.PI * k)));
        if (k >= 1) { v.setArrive(1); setPhase('idle'); }
        break;
      }

      case 'idle':
        break;

      case 'opening': {
        const k = clamp01(t / PHASE.opening);
        v.setLid(easeOutCubic(k));
        v.setBeam(k * k);

        // The jingle re-triggers on a simulated-time interval rather than
        // looping, so it stays in step with a roll that is running six times
        // slower than the wall clock under software rendering.
        if (elapsed - jingleAt >= JINGLE_EVERY) {
          voices[index] && voices[index].play('boxJingle');
          jingleAt = elapsed;
        }
        if (k >= 1) {
          setPhase('rolling');
          v.setToken(markAt(0));
        }
        break;
      }

      case 'rolling': {
        const k = clamp01(t / PHASE.rolling);
        v.setLid(1);
        v.setBeam(0.75 + 0.25 * Math.sin(t * 9));
        v.setToken(markAt(t));

        // Spinning while it cycles, because a mark that only changes texture is
        // a slideshow. The spin slows with the cycle.
        spin += dt * (7.5 * (1 - k) + 1.2);
        v.setTokenPose(0.35 + 0.25 * k, spin, 0.82 + 0.1 * k, 1.0);

        if (elapsed - jingleAt >= JINGLE_EVERY) {
          voices[index] && voices[index].play('boxJingle', { gain: 0.8 });
          jingleAt = elapsed;
        }

        if (k >= 1) {
          v.setToken(state.offer);
          aimAtPlayer();
          state.offerLeft = PHASE.settling + PHASE.presenting;
          setPhase('settling');
          voices[index] && voices[index].play('shrineChime', { gain: 0.7 });
        }
        break;
      }

      // The settle is the whole feel of the thing: the mark rises out of the
      // chest, grows, stops turning, and lights up. It is takeable throughout,
      // so this reads as a flourish and never as a lockout.
      case 'settling': {
        const k = clamp01(t / PHASE.settling);
        const e = easeOutCubic(k);
        state.offerLeft = Math.max(0, state.offerLeft - dt);

        spin += (spinTarget - spin) * Math.min(1, dt * 7);
        v.setBeam(1);
        v.setTokenPose(0.6 + 0.5 * e, spin, 0.92 + 0.38 * e, 1.0 + 0.6 * e);

        if (k >= 1) setPhase('presenting');
        break;
      }

      case 'presenting': {
        state.offerLeft = Math.max(0, state.offerLeft - dt);

        const bob = Math.sin(elapsed * 2.1) * 0.06;
        // Running out is VISIBLE, not only counted: the mark dims and sinks as
        // the window closes, so a player who never reads the prompt still knows
        // the offer is going.
        const life = clamp01(state.offerLeft / PHASE.presenting);
        spin += (spinTarget - spin) * Math.min(1, dt * 4);
        v.setBeam(0.55 + 0.45 * life);
        v.setTokenPose(1.1 + bob - 0.25 * (1 - life), spin, 1.30, 0.55 + 1.05 * life);

        if (state.offerLeft <= 0) {
          state.left++;
          notice?.('THE CHEST WITHDRAWS ITS GIFT', 2200);
          resolve();
        }
        break;
      }

      case 'withdrawing': {
        const k = clamp01(t / PHASE.withdrawing);
        const e = easeInCubic(k);
        v.setTokenPose(1.35 - 1.35 * e, spin, 1.30 - 0.9 * e, 1.0 - k);
        v.setBeam(1 - k);
        v.setLid(1 - easeInCubic(k));

        if (k >= 1) {
          v.setToken(null);
          v.setBeam(0);
          v.setLid(0);
          state.offer = null;

          if (goingCold) {
            goingCold = false;
            setPhase('cooling');
            // The distinct sting. roundEnd is a collapsing, detuned descent
            // through a closing lowpass - as far from the jingle's bright
            // ascending pentatonic as this synth gets - and it is played THROUGH
            // the chest's own panner, so the player hears which side of the room
            // just lost its box.
            voices[index] && voices[index].play('roundEnd', { gain: 1.0 });
            audio?.bossHorn?.({ gain: 0.45 });
            notice?.('THE CHEST OF THE NAMELESS HAS MOVED', 3000);
          } else {
            setPhase('idle');
          }
        }
        break;
      }

      case 'cooling': {
        const k = clamp01(t / PHASE.cooling);
        v.setCold(easeOutCubic(k));
        v.setScarab(k);
        // The chest holds for the first third while the scarab climbs out of
        // it, then goes. Collapsing it immediately would have the scarab
        // hatching out of thin air.
        v.setArrive(k < 0.34 ? 1 : 1 - easeInCubic((k - 0.34) / 0.66));

        if (k >= 1) relocate();
        break;
      }

      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // public surface
  // ---------------------------------------------------------------------------

  return {
    state,
    POOL,
    PULL_COST,
    FIRE_SALE_COST,
    describe,
    buy,
    update,

    /** Start or refresh a Fire Sale. The power-up drop is the only caller. */
    fireSale,

    /** What a pull costs RIGHT NOW. The prompt and the debit both read this. */
    get price() { return price(); },

    /** Whether a plinth is lit at all, which a Fire Sale changes. */
    isAwake,

    /** Where the chest actually lives, as against where it is being used. */
    get homeSpawn() {
      return home >= 0 && records[home]
        ? (records[home].config && records[home].config.spawn) || String(home)
        : null;
    },

    /** Late binding: the fixtures come from the interaction layer. */
    attach(fixtures) {
      records = fixtures.filter((r) => r.type === 'box');
      if (!records.length) return 0;

      for (const rec of records) {
        voices.push(audio && audio.attachPositional
          ? audio.attachPositional(rec.group, 'box')
          : null);
        if (rec.visuals) rec.visuals.setPresent(false);
      }

      settle(Math.floor(rng() * records.length), false);
      return records.length;
    },

    /** Every placement, in build order. For the HUD and the harness. */
    get placements() { return records.slice(); },
    get record() { return current(); },
    get spawn() { return state.spawn; },
    get phase() { return state.phase; },
    get offer() { return state.offer; },

    /** Whether this fixture is the one that is awake. */
    isActive,

    /**
     * Force a placement. The harness photographs all three, and a mechanic that
     * can only be reached by pulling four to eight times per spawn is a mechanic
     * that is never photographed at the third one.
     */
    placeAt(spawnOrIndex) {
      const i = typeof spawnOrIndex === 'number'
        ? spawnOrIndex
        : records.findIndex((r) => (r.config && r.config.spawn) === spawnOrIndex);
      if (i < 0 || i >= records.length) return false;
      settle(i, false);
      return true;
    },
  };
}
