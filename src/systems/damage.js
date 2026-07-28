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
 * A BLAST ARRIVES THE OTHER WAY ROUND and gets its own entry point. Explosive
 * damage is not a property of a weapon, it is a function of a distance, and the
 * thing that owns the distance is the thing that owns the geometry of the
 * explosion. So applyBlast() takes the number already computed and does only
 * what this file can do - apply it, mark the kill, make the noise - while
 * applyHits() keeps looking damage up in STATS. Two doors, one room, because
 * one door would have meant one of the two callers lying about where its number
 * came from. See the note above applyBlast.
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

/** How many body-hit cues one blast may play. See the note in applyBlast. */
const BLAST_VOICES = 3;

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

    /**
     * THE FEATHER OF MAAT, and it belongs exactly here.
     *
     * Insta-kill is not a property of a weapon and not a property of an enemy;
     * it is a rule about what a hit RESOLVES TO, and this file is the only
     * place in the game where that resolution happens. Both entry points read
     * it - a grenade fragment under the Feather kills as surely as a pistol
     * round - and neither of them has to know what set it.
     *
     * It is applied as damage equal to the target's remaining health rather
     * than as a separate "die now" path, so everything downstream is unchanged:
     * hurt() still computes the stagger share, still topples the body away from
     * the shooter, and still returns the one fact the payout reads. A boss dies
     * to it too, which is correct: the drop is rare, it lasts thirty seconds,
     * and "the god fell to one pistol round" is a story.
     */
    instaKill: false,

    /** Lifetime kills resolved through this file, for the harness. */
    kills: 0,
  };

  /**
   * Who wants to know that something died, and where.
   *
   * The power-up roll needs two facts at the moment of a kill - that it
   * happened, and the position to put a drop at - and both are known here and
   * nowhere else with any certainty. main.js's payout() sees `killed` but not
   * the body; the director sees the body but only a frame later, once it is
   * already crumbling. So this is the seam, and it is a listener rather than an
   * injected system because this file must not acquire an opinion about what a
   * power-up is.
   */
  const killListeners = new Set();

  function announceKill(enemy, region) {
    state.kills++;
    if (!killListeners.size) return;
    for (const fn of killListeners) fn(enemy, region);
  }

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
      const damage = state.instaKill
        ? Math.max(1, h.enemy.health)
        : s.damage * (head ? s.headshot : 1);

      // Topple away from the shooter. The horizontal component of the line from
      // the player to the body is the only part that matters; a vertical one
      // would roll a corpse sideways off a pitched shot.
      const dx = h.enemy.position.x - player.position.x;
      const dz = h.enemy.position.z - player.position.z;

      h.killed = h.enemy.hurt(damage, h.region, dx, dz);
      state.dealt += damage;
      connected++;
      if (h.killed) announceKill(h.enemy, h.region);

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
   * Resolve a blast.
   *
   * The same contract as applyHits and deliberately a SEPARATE function, because
   * the two answer "how much damage" from opposite directions and merging them
   * would mean one of the two lying about where its number came from.
   *
   * A bullet's damage is a property of the gun: applyHits looks the weapon up in
   * STATS and multiplies by the region, and it is right to, because a headshot
   * with a bolt rifle is a fact about the bolt rifle. A blast has no weapon and
   * no region - it has a distance, and the falloff curve that turns a distance
   * into a number lives with the thing that owns the geometry of the explosion.
   * So the caller arrives with the damage already computed and this does the
   * three things only this file can do: apply it, mark whether it finished the
   * target, and make the right noise.
   *
   * `killed` is written back onto each record exactly as applyHits writes it,
   * which is the single fact the payout table needs, so a grenade kill pays a
   * kill through the same path a bullet kill does.
   *
   * @param {Array<{enemy:object, damage:number, region?:string,
   *                dirX?:number, dirZ?:number, killed:boolean}>} records
   * @param {number} [count]  how many leading entries are live, so a pooled
   *                          array can be passed without being trimmed
   * @returns {number} how many connected with something living
   */
  function applyBlast(records, count = records ? records.length : 0) {
    if (!records || count <= 0) return 0;

    let connected = 0;
    let voiced = 0;

    for (let i = 0; i < count; i++) {
      const h = records[i];
      if (!h) continue;

      h.killed = false;
      if (!h.enemy || !h.enemy.live || h.enemy.dying) continue;
      if (!(h.damage > 0)) continue;

      // Topple AWAY from the blast, not away from the shooter. The direction
      // travels on the record because the explosion knows where it was and this
      // file does not; a corpse thrown toward the crater is the single most
      // obvious tell that an explosion was faked.
      const dx = h.dirX ?? (h.enemy.position.x - player.position.x);
      const dz = h.dirZ ?? (h.enemy.position.z - player.position.z);

      h.region = h.region || 'body';
      const damage = state.instaKill ? Math.max(1, h.enemy.health) : h.damage;
      h.killed = h.enemy.hurt(damage, h.region, dx, dz);
      state.dealt += damage;
      connected++;
      // Suppressible, because the Second Death kills the whole field through
      // this path and a nuke that rolled twenty drops would be a bug that looks
      // like a jackpot. See systems/powerups.js.
      if (h.killed && !h.silent) announceKill(h.enemy, h.region);

      // The body sound, never the headshot sound. A blast cannot land a
      // headshot, and the two cues exist to tell the player which payout they
      // just earned - so playing the crit cue here would teach a lie.
      //
      // AND ONLY THE FIRST FEW. A frag in a crowd connects with a dozen bodies
      // in one frame; twelve simultaneous thuds is not "a dozen hits", it is one
      // mush that arrives on top of the explosion's own report and buries it.
      // The voice cap in core/audio.js would drop most of them anyway - this
      // decides WHICH ones get dropped rather than leaving it to allocation
      // order, and leaves the cap free for the horde the player still has to
      // hear.
      if (voiced < BLAST_VOICES) {
        voiced++;
        audio?.bodyHit?.({ pitch: h.enemy.spec?.voicePitch || 1 });
      }
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
    applyBlast,
    damagePlayer,
    update,

    /** Tell me when something dies. Returns the unsubscribe. */
    onKill(fn) {
      killListeners.add(fn);
      return () => killListeners.delete(fn);
    },

    /** Late binding: the director is constructed FROM this, so it cannot be
     * passed in at construction time. */
    attach(parts) {
      if (parts.director) director = parts.director;
    },

    get health() { return player.state.health; },
  };
}
