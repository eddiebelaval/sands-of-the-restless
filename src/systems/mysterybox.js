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
  };

  /** Fixture records, filled by attach(). Index into this is the placement. */
  let records = [];
  let index = -1;

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
    state.spawn = (records[next].config && records[next].config.spawn) || String(next);
    state.pulls = 0;
    state.coldAt = randInt(COLD_AFTER.min, COLD_AFTER.max);

    const v = visuals();
    if (v) {
      v.setPresent(true);
      v.setArrive(announce ? 0 : 1);
    }

    setPhase(announce ? 'arriving' : 'idle');
    if (announce) voices[index] && voices[index].play('boxJingle', { gain: 0.55 });
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
    if (!economy.canAfford(PULL_COST)) {
      return deny(`Need ${PULL_COST - economy.gold} more gold`);
    }

    // spend() IS the purchase, the same contract doors.js and wallbuy.js buy
    // through. Checking the purse and then deducting as two steps invites the
    // balance to move in between; this way the deduction either happened or the
    // pull did not.
    if (!economy.spend(PULL_COST, 'mysterybox')) return deny();

    const i = Math.floor(rng() * POOL.length);
    state.offer = POOL[i];
    state.offered.push(state.offer);
    schedule = buildSchedule(i);

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
    if (!isActive(rec)) return { text: '', deny: false };

    switch (state.phase) {
      case 'idle': {
        const afford = economy.canAfford(PULL_COST);
        return {
          text: `CHEST OF THE NAMELESS - ${PULL_COST} GOLD${afford ? '  [F]' : ''}`,
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
    const want = Math.atan2(dx, dz) - (rec.rot || 0);

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
    describe,
    buy,
    update,

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
