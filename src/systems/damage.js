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

/**
 * A blast finishes anything it would leave under this fraction of max health.
 *
 * BLASTS ONLY, AND THAT ASYMMETRY IS THE WHOLE JUSTIFICATION. A bullet that
 * leaves a sliver is a fine outcome - the answer is another bullet, half a
 * second away, and the player can see the stagger. A grenade that leaves a
 * sliver is the defect the owner reported in those words: a frag lands at a
 * body's feet, the body is standing afterwards, and the mechanic reads as
 * broken whatever the health bar says. There is no follow-up throw; the pouch
 * has four in it and the round has thirty bodies.
 *
 * It also turns the degrade at the top of the grenade's curve from a cliff into
 * a slope. Against the shipped health table a 400-point centre kills a shambler
 * outright through wave twelve and leaves 4.8 per cent at wave thirteen, which
 * is one round of "it did nothing" sitting between "it kills" and "it wounds".
 * Eight per cent absorbs exactly that round and no more: wave fourteen leaves
 * 9.6 per cent and survives, on purpose, because that is where the frag is
 * meant to become a wounding tool.
 *
 * Eight and not twenty because this must never become the reason something
 * died. A body eight per cent from dead inside a fireball is dead; a body a
 * fifth from dead is a body the player still has to finish.
 */
const BLAST_EXECUTE = 0.08;

export function createCombat({ player, rig, post, audio, impacts, notice, director, death }) {
  /**
   * Late-bound, exactly like the director above it. See attach().
   *
   * This file acquires no opinion about what a grenade is; it holds the
   * reference so that systems/powerups.js - which is constructed after
   * systems/grenades.js and is handed `combat` but not `grenades` - has a seam
   * to reach it through that does not require a line in main.js.
   */
  let grenades = null;

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
     * the shooter, and still returns the one fact the payout reads.
     *
     * IT DOES NOT KILL A BOSS. This reverses what this comment used to say -
     * that "the god fell to one pistol round" was a story worth having. It is
     * a story exactly once, and after that it is the answer to every boss wave
     * the drop happens to land on: hold the Feather, walk in, fire once. The
     * owner hit it in play and it read as the fight being skipped, not won.
     * `executable()` below is the whole of the rule, and it is checked at all
     * three doors that can resolve a lethal hit.
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
   * THE OPENING WAVES: A HEADSHOT IS A KILL, WITH ANY WEAPON.
   *
   * The owner, playing: "headshots don't seem strong enough." He was right, and
   * the arithmetic is worse than it feels. A shambler has 85 health and
   * hpScale is 1 + (wave - 1) x 0.15 on Normal, against an MK9 headshot of
   * 42 x 2.6 = 109.2:
   *
   *     wave 1    85.0    kills
   *     wave 2    97.8    kills
   *     wave 3   110.5    FAILS
   *     wave 6   148.8    fails by 40
   *
   * So precision stopped paying at wave THREE with the starting pistol, and the
   * B3AR at 26 x 2.2 = 57.2 never one-shot anything at all, not even on wave
   * one. The multiplier is a number on a table that the health curve outruns
   * almost immediately, which is exactly what "not strong enough" feels like
   * from behind the crosshair.
   *
   * A FLAT LETHAL WINDOW RATHER THAN BIGGER MULTIPLIERS. Raising `headshot` per
   * weapon would have to be done seven times, would be outrun again two waves
   * later, and would break the one number MAP.md says must not move - the MK9's
   * 2.6 against the B3AR's 2.2 is the whole argument for keeping the pistol, and
   * Thoth's double-gold-on-headshots is priced against it. A window changes when
   * precision is lethal without touching what precision is worth.
   *
   * THROUGH WAVE 6, which is the owner's "at least 5-6" read as its upper end.
   * It also lands on a real seam: the husk unlocks at 6 and the Bound at 10, so
   * the window closes as the roster stops being shamblers and scarabs. After it,
   * headshots go back to the multiplier and the player has had six waves to
   * learn where the head is - which is the actual point, because the habit is
   * what carries into the waves where it only wounds.
   *
   * BOSSES ARE EXEMPT, and that exemption is why this is a function rather than
   * a comparison inlined above. Anubis has 5200 health and arrives on wave 5,
   * INSIDE the window; a boss that dies to one pistol round to the face is not a
   * boss.
   *
   * REVERSED 2026-08-08, BY THE OWNER, AND THE OLD REASONING IS LEFT HERE
   * BECAUSE IT WAS NOT STUPID. This comment used to end: "The Insta-Kill
   * power-up deliberately does drop them, because that is a rare thing the
   * player earns and spends, and it is on its own timer." That is a coherent
   * argument and it lost to the only test that matters, which is a person
   * playing the game: "the one shot kill should never work on the bosses. I'm
   * able to kill the bosses on one shot."
   *
   * Why the argument was wrong in practice. A drop that is rare in the abstract
   * is not rare during the encounter it matters in: a boss wave is long, it is
   * full of adds, and adds are what drop power-ups, so Insta-Kill is MORE likely
   * to be in the player's hand during a god than at any other time. "Rare thing
   * the player earns" described the drop rate and not the situation, and the
   * situation is that the twenty-five wave climb has a delete button on it.
   */
  const HEADSHOT_LETHAL_THROUGH = 6;

  /**
   * MAY THIS ENEMY BE REMOVED BY A SINGLE APPLICATION OF DAMAGE.
   *
   * Extracted from headLethal, which had the rule right and kept it to itself.
   * There were two holes and they were separate:
   *
   *   `state.instaKill` set damage to the target's full remaining health at all
   *   THREE entry points below, and did it by SHORT-CIRCUITING the headshot
   *   test - `state.instaKill || (head && headLethal(...))` never consults
   *   identity when the left side is true. This file already knew a god may not
   *   be one-shot and applied that knowledge to one of the four ways damage
   *   arrives.
   *
   *   systems/powerups.js `detonate()` built every record with
   *   `damage = Math.max(1, a.health)`, boss included, and its own comment
   *   presented that as a feature.
   *
   * IDENTITY, NOT HEALTH. A boss is a boss on the wave it arrives, whatever the
   * tier has done to its bar. A rule written as "over N hit points" would stop
   * protecting the first god the moment somebody retuned Easy.
   *
   * WHAT A BOSS GETS INSTEAD differs by door, on purpose:
   *
   *   A GUN, A BLADE OR A GRENADE falls through to normal damage - which is
   *   exactly what a headshot on a god already did, so this stays one rule
   *   rather than becoming two. Insta-Kill is weak during a boss wave by
   *   design; the alternative is that it deletes the encounter.
   *
   *   THE SECOND DEATH is bounded rather than ignored, over in powerups.js,
   *   because it is a consumable with no second swing behind it.
   */
  function executable(enemy) {
    if (!director) return true;
    return enemy !== director.boss;
  }

  /** Is the execution shortcut allowed against this target right now. */
  function executing(enemy) {
    return state.instaKill && executable(enemy);
  }

  function headLethal(enemy) {
    if (!director) return false;
    if (director.wave > HEADSHOT_LETHAL_THROUGH) return false;
    return executable(enemy);
  }

  /**
   * WHAT A ROUND SOUNDS LIKE WHEN IT LANDS ON THIS PARTICULAR BODY.
   *
   * All three doors below used to say `audio.bodyHit({ pitch: voicePitch })`,
   * which is the same defect the horde's voices had and in the same shape: one
   * sound for six species, told apart by a scalar. bodyHit is a 620 Hz lowpass
   * over a 105 Hz sine - a wet mass absorbing a round - and it is simply the
   * wrong physics for a beetle, which is a thin hard shell over a void. Shooting
   * a scarab sounded like shooting a man.
   *
   * The variants already carry the answer: `spec.sound.chitin` names a shell for
   * the two that have one and is absent for everything with a throat. So this
   * reads it, and nothing here knows what a scarab is.
   *
   * THE CRIT IS NOT THE SAME PLACE ON EVERY BODY, and that is the part worth
   * being careful about. `region === 'head'` means whatever enemies/variants.js
   * tagged 'head', not a skull: on a gold scarab the skull is re-tagged 'body'
   * and the crit is the vent on the back of the abdomen. Because this routes on
   * the REGION rather than on anatomy, that falls out correctly with no special
   * case - a gold scarab's skull gets the plate knock, which is the honest sound
   * for "nothing happened", and only the vent gets the crit cue. The two cues
   * exist to tell the player which payout they earned, and on this variant that
   * lesson is the entire design.
   *
   * NO KILL VARIANT, and that is deliberate rather than an omission. The
   * carapace coming apart is `shellCrack`, and enemies/mummy.js already plays it
   * out of beginDeath() through the actor's own positional emitter - exactly as
   * a humanoid's deathRattle fires there while bodyHit fires here. Playing it
   * again on the killing round would be two shell cracks in one frame, from two
   * subsystems, on top of each other.
   *
   * `pitch` follows the same rule as say() in enemies/mummy.js: `voicePitch` is
   * a larynx and a shell does not have one, so a chitin body uses its declared
   * `sound.pitch` and the scarab's 2.0 never lands on a 2.6 kHz knock.
   */
  function hitSound(enemy, region) {
    const spec = enemy?.spec;
    if (!spec) return;
    const snd = spec.sound;
    const chitin = snd && snd.chitin;
    const crit = region === 'head';

    if (chitin) {
      const opts = { pitch: snd.pitch ?? 1, chitin };
      if (crit) audio?.chitinCrit?.(opts);
      else audio?.chitinHit?.(opts);
      return;
    }

    const opts = { pitch: spec.voicePitch || 1 };
    if (crit) audio?.headshotHit?.(opts);
    else audio?.bodyHit?.(opts);
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
      const damage = (executing(h.enemy) || (head && headLethal(h.enemy)))
        ? Math.max(1, h.enemy.health)
        : s.damage * (head ? s.headshot : 1);

      // Topple away from the shooter. The horizontal component of the line from
      // the player to the body is the only part that matters; a vertical one
      // would roll a corpse sideways off a pitched shot.
      const dx = h.enemy.position.x - player.position.x;
      const dz = h.enemy.position.z - player.position.z;

      // THE POINT, and it is the difference between a stagger and a REACTION.
      //
      // Everything downstream of hurt() used to know which way the shot came
      // from and nothing at all about where it landed, so a round through the
      // left shoulder and a round through the right hip produced the same
      // generic shiver. The hit point is the one fact that turns that into an
      // actor moving the part of itself that was struck, and it is already in
      // the record: the hitscan wrote it. It is optional at the far end, so a
      // blast - which has a direction and no meaningful single point - passes
      // nothing and keeps the whole-body reaction it should have.
      h.killed = h.enemy.hurt(damage, h.region, dx, dz, h.point);
      state.dealt += damage;
      connected++;
      if (h.killed) announceKill(h.enemy, h.region);

      // The ejecta, region-aware.
      //
      // The weapon spawns a region-BLIND burst of its own at the same point,
      // because the region travels on the hit record to this file rather than
      // to the impact system. This is the call that knows a skull was hit, and
      // impacts.spawnEnemyHit is written so the two never double up. See the
      // note above it.
      if (h.point) impacts?.spawnEnemyHit?.(h.point, h.region);

      // Two distinct sounds, because the two payouts are distinct. A player who
      // cannot hear the difference between 60 and 100 has no feedback loop on
      // the one skill the economy rewards. Which PAIR of sounds depends on what
      // was hit - see hitSound.
      hitSound(h.enemy, h.region);
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

      let damage = executing(h.enemy) ? Math.max(1, h.enemy.health) : h.damage;

      // The execution floor. See BLAST_EXECUTE - a body left on a sliver by an
      // explosion is the reported bug, not a near miss. Written as a raise of
      // the damage rather than as a second call to hurt() so everything
      // downstream is unchanged: one stagger, one topple, one `killed`, one
      // payout.
      const left = h.enemy.health - damage;
      if (left > 0 && left <= h.enemy.maxHealth * BLAST_EXECUTE) damage = h.enemy.health;

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
        // 'body', explicitly, and not h.region. A blast cannot land a crit, and
        // the line above is the reason: the cue would teach a payout that was
        // not paid. Passing the literal keeps that true for a chitin body too -
        // a frag beside a gold scarab must not fire the vent cue.
        hitSound(h.enemy, 'body');
      }
    }

    return connected;
  }

  /**
   * Resolve a blade.
   *
   * THE THIRD DOOR, and it is here for the reason the second one is: the three
   * entry points differ by WHERE THE NUMBER CAME FROM, and merging any two of
   * them would mean one of the callers lying about it.
   *
   *   applyHits  - the damage is a property of a gun. It looks the weapon up in
   *                STATS and multiplies by the region, because a headshot with a
   *                bolt rifle is a fact about the bolt rifle.
   *   applyBlast - the damage is a function of a distance. The caller owns the
   *                falloff curve because the caller owns the geometry.
   *   applyMelee - the damage is a property of the SWING, and there is exactly
   *                one swing. See systems/melee.js.
   *
   * It is not applyBlast with a different name, and the difference is not
   * cosmetic. BLAST_EXECUTE exists because there is no second grenade half a
   * second away; there IS a second swing, so a blade that left a sliver is a
   * blade the player has to use again, which is the whole cost of running out of
   * ammunition. And BLAST_VOICES caps a dozen simultaneous thuds - a blade
   * strikes one body, so the cap would only ever be a line that never ran.
   *
   * What it shares with both is the only thing that matters downstream: it
   * writes `killed` onto the record exactly as they do, so a melee kill reaches
   * the frozen payout table through the same path a bullet kill does and pays
   * what a kill pays. No new payout is invented here or anywhere else.
   *
   * The region is forced to 'body'. A blade cannot land a headshot for the same
   * reason a blast cannot: the two cues exist to tell the player which of two
   * payouts they earned, and 60 is the one this pays.
   *
   * @param {Array<{enemy:object, damage:number, killed:boolean}>} records
   * @param {number} [count]
   * @returns {number} how many connected with something living
   */
  function applyMelee(records, count = records ? records.length : 0) {
    if (!records || count <= 0) return 0;

    let connected = 0;

    for (let i = 0; i < count; i++) {
      const h = records[i];
      if (!h) continue;

      h.killed = false;
      if (!h.enemy || !h.enemy.live || h.enemy.dying) continue;
      if (!(h.damage > 0)) continue;

      // Away from the player, because the player is where the arm was. The
      // horizontal component only, exactly as applyHits does it.
      const dx = h.enemy.position.x - player.position.x;
      const dz = h.enemy.position.z - player.position.z;

      h.region = 'body';
      const damage = executing(h.enemy) ? Math.max(1, h.enemy.health) : h.damage;

      // No hit point passed. A swipe has a direction and an arc rather than a
      // single struck texel, so the actor gets its whole-body reaction, which is
      // the correct read for something that was cut across rather than shot
      // through.
      h.killed = h.enemy.hurt(damage, 'body', dx, dz);
      state.dealt += damage;
      connected++;
      if (h.killed) announceKill(h.enemy, 'body');

      // GUARDED, exactly as applyHits guards it. `impacts.spawnEnemyHit` reads
      // `point.x` with no defence of its own, and this was the one of the three
      // doors that handed it the value unchecked.
      //
      // NOT a live bug: systems/melee.js sets `record.point` in the same breath
      // as `record.enemy` and clears the two together, so in the shipped path a
      // record with an enemy always has a point. It is one line to stop that
      // being load-bearing, and the sibling call above already spends it.
      if (h.point) impacts?.spawnEnemyHit?.(h.point, 'body');
      // 'body' for the same reason the region was forced to it above: a blade
      // cannot land a crit, so it must not sound like one.
      hitSound(h.enemy, 'body');
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
   * The player's health reached zero.
   *
   * THIS USED TO BE THE WHOLE OF DYING and it was too small a thing by half.
   * It washed the frame red, healed the player back to full, reset the wave
   * director and printed a line in the notice pill - all between two frames,
   * with the player still standing and still holding the trigger. Two defects
   * came out of that, and they are different defects:
   *
   *   The player was never TOLD. A one-line notice in the corner is what this
   *   game says when a door opens. Death got the same weight as a door.
   *
   *   The restart was AUTOMATIC. A player who walked away from the keyboard
   *   died, restarted, and died again on a loop, forever, which the owner
   *   watched happen. A run has to wait for the person playing it.
   *
   * So this file keeps the one fact it owns - the heart stopped - and hands the
   * consequence to ui/death.js, which owns the fall, the card, the gate and the
   * reset rule. What stays here is only what belongs to combat: the counter, the
   * full red wash, the trauma, and the sound.
   *
   * `state.downs` still increments HERE and still increments FIRST, before the
   * hand-off, because it is the event source main.js watches to drop the shrine
   * boons and it must fire on the frame of the death whether or not a death
   * sequence is wired up.
   *
   * If nothing is attached, the old behaviour stands. That is not a dead branch
   * kept for sentiment: main.js is contended and this module is constructed
   * before ui/death.js exists, so `death` is late-bound through attach() and
   * there is a window - and any harness that builds a combat system without a UI
   * layer at all still needs the run to end rather than to hang at zero health.
   */
  function fell() {
    state.downs++;
    state.wash = 1;
    rig?.addTrauma?.(1);
    audio?.roundEnd?.();

    // Owned from here. The sequence does almost nothing on this call - see the
    // note at the top of ui/death.js - because we are being called from inside
    // the director's actor loop and anything that touches the live list here is
    // the crash test/enemies.mjs pins under "a death mid-tick does not throw".
    if (death?.begin?.()) return;

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
    applyMelee,
    damagePlayer,
    update,

    /** Tell me when something dies. Returns the unsubscribe. */
    onKill(fn) {
      killListeners.add(fn);
      return () => killListeners.delete(fn);
    },

    /** Late binding: the director is constructed FROM this, so it cannot be
     * passed in at construction time. The grenades are the same shape from the
     * other direction - they are constructed from this, and systems/powerups.js
     * needs to reach them. */
    attach(parts) {
      if (parts.director) director = parts.director;
      if (parts.grenades) grenades = parts.grenades;
      // The death sequence is built LAST of all - it needs the director, the
      // power-ups and the Altar, every one of which is constructed from this
      // object - so it arrives the same way they do. See fell().
      if (parts.death) death = parts.death;
    },

    /** Whoever registered themselves as the grenade pouch, or null. */
    get grenades() { return grenades; },

    get health() { return player.state.health; },
  };
}
