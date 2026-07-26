/**
 * Combat resolution: who hurt whom, and what the player feels about it.
 *
 * This is the seam between three systems that must not know about each other.
 * The weapon knows how far a bullet went and what it struck. The enemy knows
 * how much health it has. The economy knows what a kill is worth. None of them
 * should have to know the other two exist, so the hit record travels through
 * here and comes out the far side carrying one extra fact - whether that round
 * finished the target - which is the only thing the payout table needs.
 *
 * The damage numbers themselves are not owned here. They live on the weapon,
 * in player/weapons.js, alongside fire rate and spread, because damage is a
 * property of a gun and not of a bookkeeping layer. This file multiplies them
 * by the region and hands the result over.
 *
 * INCOMING damage has three jobs and all three are feel, not simulation: the
 * camera lurches, the frame washes red, and the player has to be told which
 * direction it came from. The wash is driven from post.setDamage, which already
 * exists; the lurch from rig.addTrauma, which already exists. Neither is
 * reinvented here.
 *
 * Regeneration is deliberate and it is not generosity. A round-based shooter
 * with permanent chip damage is a run that ends to attrition the player cannot
 * see coming; every game in this genre regenerates, and the tuning knob that
 * matters is the DELAY before it starts, because that is what makes a bad trade
 * cost something.
 */

import { STATS } from '../player/weapons.js';

/** Seconds without being hit before health starts coming back. */
const REGEN_DELAY = 5.0;

/** Health per second once it does. */
const REGEN_RATE = 14;

/**
 * Below this fraction of maximum health the red wash never fully clears.
 *
 * A damage indicator that only flashes tells the player they were hit. One that
 * stays on tells them they are about to die, which is the more useful fact and
 * the one a health bar in the corner is bad at communicating.
 */
const CRITICAL = 0.35;

export function createCombat({ player, rig, post, audio, impacts, notice, director }) {
  const state = {
    /** 0..1 red wash, decayed every frame. */
    wash: 0,
    sinceHit: REGEN_DELAY,
    downs: 0,
    dealt: 0,
    taken: 0,
    /** Harness escape hatch. Nothing in the game sets this. */
    invulnerable: false,
  };

  /**
   * Resolve a burst of hits from one trigger pull.
   *
   * Mutates each record in place with `killed`, and returns the number that
   * connected with something living. Mutation rather than a fresh array
   * because a shotgun's eight pellets go through here at eighty-five rounds a
   * minute and the frame loop already owns the array.
   */
  function applyHits(hits) {
    if (!hits || !hits.length) return 0;

    let connected = 0;

    for (const h of hits) {
      h.killed = false;
      if (!h.enemy || !h.enemy.live || h.enemy.dying) continue;

      const s = STATS[h.weapon];
      if (!s) continue;

      const head = h.region === 'head';
      const damage = s.damage * (head ? s.headshot : 1);

      // Topple away from the shooter. The horizontal component of the line from
      // the player to the body is the only part that matters; a vertical one
      // would roll a corpse sideways off a pitched shot.
      const dx = h.enemy.position.x - player.position.x;
      const dz = h.enemy.position.z - player.position.z;

      h.killed = h.enemy.hurt(damage, h.region, dx, dz);
      state.dealt += damage;
      connected++;

      // Two distinct sounds, because the two payouts are distinct. A player who
      // cannot hear the difference between 60 and 100 has no feedback loop on
      // the one skill the economy rewards.
      const opts = { pitch: h.enemy.spec.voicePitch || 1 };
      if (head) audio?.headshotHit?.(opts);
      else audio?.bodyHit?.(opts);
    }

    return connected;
  }

  /**
   * The player takes a hit.
   *
   * The position is used for the shake magnitude only. A directional indicator
   * is the obvious next thing to hang off it and the argument is here for that
   * reason; it is not a HUD element yet.
   */
  function damagePlayer(amount, x, z) {
    if (state.invulnerable || amount <= 0) return 0;
    if (player.state.health <= 0) return 0;

    player.damage(amount);
    state.taken += amount;
    state.sinceHit = 0;

    // Trauma is squared inside the rig, so a scarab's nibble has to be small
    // here or it reads the same as a Bound's swing.
    rig?.addTrauma?.(Math.min(0.7, 0.12 + amount * 0.010));
    state.wash = Math.min(1, state.wash + 0.35 + amount * 0.011);

    if (player.state.health <= 0) fell();
    return amount;
  }

  /**
   * The minimum honest failure state.
   *
   * The run resets to wave one and the player comes back at full health. It is
   * not a death screen and it is not meant to be; what it IS, is a consequence,
   * and the alternative - health that bottoms out at zero and stays there while
   * the waves keep coming - is a game that has quietly stopped having stakes.
   */
  function fell() {
    state.downs++;
    state.wash = 1;
    rig?.addTrauma?.(1);
    audio?.roundEnd?.();
    notice?.('THE SANDS TAKE YOU - THE VIGIL BEGINS AGAIN', 3600);
    player.heal(player.state.maxHealth);
    director?.reset?.();
  }

  function update(dt) {
    state.sinceHit += dt;

    if (state.sinceHit > REGEN_DELAY && player.state.health < player.state.maxHealth) {
      player.heal(REGEN_RATE * dt);
    }

    // Decay toward the floor the current health implies rather than toward
    // zero, so the wash is a state readout at low health and an event at high.
    const frac = player.state.health / player.state.maxHealth;
    const floor = frac < CRITICAL ? (1 - frac / CRITICAL) * 0.45 : 0;

    state.wash = Math.max(floor, state.wash - dt * 1.6);
    post?.setDamage?.(state.wash);
  }

  return {
    state,
    applyHits,
    damagePlayer,
    update,

    /** Late binding: the director is constructed FROM this, so it cannot be
     * passed in at construction time. */
    attach(parts) {
      if (parts.director) director = parts.director;
    },

    get health() { return player.state.health; },
  };
}
