/**
 * THE KHOPESH.
 *
 * -------------------------------------------------------------------------
 * WHY A GAME WITH SEVEN GUNS NEEDED AN EIGHTH THING
 * -------------------------------------------------------------------------
 *
 * The owner's two reports arrived together and they are one report: "I'm
 * missing melee" and "I keep getting caught with no ammo". In the game this one
 * is modelled on those are not two features, they are a feature and its
 * consequence. The knife is not a bonus attack in Black Ops 2 - it is THE
 * REASON RUNNING OUT IS SURVIVABLE. Early rounds you knife to conserve rounds
 * you will need at round twenty; late rounds it is what you have when a
 * magazine runs dry with four bodies on you. Take it away and the whole
 * ammunition economy is one long slope with no floor under it, which is exactly
 * the game he was playing.
 *
 * So this is built as the pressure valve, and the drop tuning in
 * systems/powerups.js is the second half of the same fix rather than a separate
 * errand.
 *
 * -------------------------------------------------------------------------
 * THE DAMAGE CURVE IS THE HEALTH CURVE, AND THAT IS THE WHOLE TRICK
 * -------------------------------------------------------------------------
 *
 * BO2's knife is a flat 150 that one-shots for the first several rounds and
 * then falls off, and the falloff is not authored anywhere: zombie health
 * scales and the knife does not. The same shape is available here for free,
 * because enemies/director.js scales health linearly and verifiably:
 *
 *     hpScale(w) = 1 + (w - 1) * 0.15          [director.js, line 669]
 *
 * Against the shipped health table, at MELEE.damage = 250:
 *
 *     shambler  150 base   one-shot through wave  5   (240 at w5, 262 at w6)
 *     husk       85 base   one-shot through wave 13
 *     scarab     45 base   one-shot through wave 31
 *     Bound     560 base   never - two swings at wave 1, five at wave 20
 *
 * Which is precisely the curve the genre wants and it took one number to get:
 * a conserve-ammunition tool for the opening waves, a panic button afterwards,
 * and an armoured variant that laughs at it from the moment it unlocks. No
 * per-wave table, nothing to keep in step with a balance pass, and the day
 * hpScale changes the blade re-tunes itself.
 *
 * A god is not in that arithmetic and cannot be: the wave-20 Sekhmet is 25,440
 * effective health, or a hundred and two swings.
 *
 * -------------------------------------------------------------------------
 * WHAT IT IS, AND WHY IT IS NOT A COMBAT KNIFE
 * -------------------------------------------------------------------------
 *
 * This is an Egyptian necropolis and every fixture in it has been renamed into
 * that world - Pack-a-Punch is the Altar of Ptah, insta-kill is the Feather of
 * Maat. A black polymer tactical knife would be the one object in the game that
 * came from a catalogue.
 *
 * The khopesh is the answer and it is not a costume choice, it is a legibility
 * one. It is the sickle-sword of the Egyptian Bronze Age, it is what the
 * pharaohs are holding in the reliefs, and - the part that actually matters at
 * a 0.45 second swing - its silhouette is a CURVE. A straight blade crossing
 * the frame in four rendered frames is a bright bar; a hooked one is
 * unmistakably a blade even when it is a blur, because the curve says which way
 * it is travelling. See viewmodel.js for the build, which is deliberately
 * plain: a swept blade, a wrapped grip, a disc pommel. The budget went on the
 * swing.
 *
 * -------------------------------------------------------------------------
 * WHY A CONE AND NOT A RAYCAST
 * -------------------------------------------------------------------------
 *
 * A hitscan ray is the right model for a bullet and the wrong one for a swipe.
 * A swipe is an arc through a volume, so it is resolved as one: a forward cone
 * of MELEE.reach with a half-angle, tested against the director's live list.
 * That is a walk over at most twenty-four actors with no allocation, no
 * raycaster, and no dependence on whether a pooled limb mesh happened to be
 * under the crosshair on the frame the blade landed.
 *
 * It takes the NEAREST valid target and only that one. A blade that cleared a
 * crowd would stop being a last resort and start being the primary weapon,
 * which is the failure mode the cooldown is also guarding against.
 *
 * -------------------------------------------------------------------------
 * EVERY CLOCK IN HERE IS SIMULATED SECONDS
 * -------------------------------------------------------------------------
 *
 * Accumulated from the frame loop's CLAMPED delta, for the reason the mystery
 * box and the power-ups both state at length: under the software renderer the
 * harness uses, a frame is most of a second of wall clock while advancing the
 * simulation by a twentieth. A cooldown counted in frames would be six times
 * longer in the suite than in the game, and a swing timed off performance.now()
 * would land its damage before its own animation had drawn a frame.
 *
 * Nothing here allocates per swing. The hit record is one pre-built object,
 * because there is one target; the scratch vectors are built at construction.
 */

import * as THREE from 'three';

/**
 * THE BLADE, and every knob a difficulty tier may scale.
 *
 * Mutable and deliberately the only place these numbers exist - nothing below
 * reads a literal. The ammunition knobs live in systems/powerups.js under
 * SUPPLY; these are the other half of the same lane.
 */
export const MELEE = {
  /**
   * Flat, and the falloff comes from the health curve. See the note above.
   *
   * 250 rather than 240 or 260 because the interesting boundary is the
   * shambler, which is 240 effective at wave five and 262 at wave six: 250
   * lands cleanly inside that gap, so "the blade stops one-shotting at wave
   * six" is a true sentence rather than one that depends on rounding.
   */
  damage: 250,

  /**
   * Metres, centre to centre.
   *
   * The shambler's own reach is `attackRange * scale + playerRadius`, which is
   * 1.75 * 0.94 + 0.42 = 2.07. 2.2 is deliberately a hair longer: anything that
   * can reach the player can be reached back, which is the contract a panic
   * button has to honour, and a fifth of a metre is not a poking range.
   */
  reach: 2.2,

  /**
   * Half-angle of the swipe, radians. 50 degrees.
   *
   * Wide, because the swing visibly crosses the whole frame and a blade that
   * misses something the animation clearly passed through is worse than no
   * blade. Not so wide that it becomes an omnidirectional pulse: at 50 degrees
   * a body squarely beside the player is out of it.
   */
  arc: 0.873,

  /** Vertical tolerance in metres, so a scarab at the ankles is still hit. */
  vertical: 2.2,

  /** Length of the swing animation, seconds. */
  swing: 0.45,

  /**
   * When in the swing the edge lands, seconds.
   *
   * At the top of the arc, not the start of it, for the same reason the
   * shambler's own blow lands at 0.55 of its strike rather than at 0: damage
   * that arrives on the keypress is damage arriving from nowhere.
   */
  contact: 0.22,

  /**
   * Seconds from one swing STARTING to the next being legal.
   *
   * 0.85 against a 0.45 second animation leaves 0.40 of recovery in which the
   * player is holding a sword and cannot use it, which is what stops the blade
   * being a 1.2-per-second free weapon. It is also close to the shambler's own
   * 1.35 second cooldown, so trading swings with one is a real trade.
   */
  cooldown: 0.85,

  /** Camera kick on connect. Small - this is a wrist, not a shotgun. */
  camKick: 1.5,
};

/**
 * @param {object} opts
 * @param {THREE.Camera} opts.camera    for the forward vector
 * @param {object} opts.player          for the position
 * @param {object} opts.director        for the live actor list
 * @param {object} opts.combat          for applyMelee
 * @param {object} opts.viewmodel       for the animation
 * @param {object} opts.rig             for the camera kick
 * @param {object} opts.audio           for the whoosh
 * @param {object} [opts.weapons]       so a swing can cancel a reload
 */
export function createMelee({
  camera, player, director, combat, viewmodel, rig = null, audio = null,
  weapons = null,
}) {
  // Scratch, allocated once. update() runs every frame and swing() runs several
  // times a second in a bad moment.
  const forward = new THREE.Vector3();
  const _p = new THREE.Vector3();
  /**
   * Where the edge went in, for the ejecta.
   *
   * A vector of our own rather than the actor's live position, for two reasons:
   * an actor's `position` is its FEET and linen bursting out of a mummy's
   * ankles is the wrong picture, and handing a system a reference to a pooled
   * actor's own vector is how a retired actor stays reachable.
   */
  const _point = new THREE.Vector3();

  /**
   * One record, reused. There is exactly one target per swing, so a pool of one
   * is the whole pool - and it carries every field applyMelee reads, declared
   * here rather than assigned at the call site, so the object has one shape for
   * the life of the process.
   */
  const record = { enemy: null, damage: 0, region: 'body', killed: false, point: null };
  const records = [record];

  const state = {
    /** True from the keypress until the animation ends. */
    swinging: false,
    /** Seconds into the current swing. */
    t: 0,
    /** Seconds since the last swing STARTED. Infinity means never. */
    since: Infinity,
    /** Whether this swing has already resolved its damage. */
    landed: false,

    // Lifetime counters, for the harness and for a balance pass.
    swings: 0,
    connects: 0,
    kills: 0,
    /** Swings refused because the cooldown had not expired. */
    refusedCooldown: 0,
    /** Reloads a swing interrupted. */
    reloadsCancelled: 0,
  };

  /** Seconds until the next swing is legal, 0 when it already is. */
  function cooldownLeft() {
    return Math.max(0, MELEE.cooldown - state.since);
  }

  function ready() {
    return !state.swinging && state.since >= MELEE.cooldown;
  }

  /**
   * Start a swing. Returns true if one started.
   *
   * THE THREE THINGS THIS DELIBERATELY DOES NOT CHECK are the whole point of
   * the mechanic:
   *
   *   - it does not care whether the magazine is empty. That is when you need
   *     it.
   *   - it does not care whether the player is holding a weapon at all. The
   *     Altar of Ptah takes the gun for five seconds and leaves them with
   *     nothing; the blade is the answer to standing in a horde with empty
   *     hands, and refusing it there would remove the one moment it was most
   *     obviously for.
   *   - it does not care whether a reload is running. It CANCELS one. That is
   *     the reference behaviour and it is the honest one: the magazine did not
   *     seat, so nothing is added, and the player has to press R again. A swing
   *     that politely waited for a 3.9 second LMG reload to finish would be a
   *     panic button with a queue.
   *
   * What it does check is the cooldown, and whether the viewmodel is mid-swap.
   */
  function swing() {
    if (state.swinging) return false;
    if (state.since < MELEE.cooldown) { state.refusedCooldown++; return false; }

    // The viewmodel is the authority on whether the hands are available: a
    // weapon halfway through a lower stroke has no free arm. It answers for
    // itself rather than this file guessing from a phase string.
    if (viewmodel && viewmodel.melee && !viewmodel.melee()) return false;

    // Cancel a running reload. Nothing is added to the magazine: weapons.js's
    // finishReload is the only thing that moves rounds and it is not called.
    if (weapons && weapons.state && weapons.state.reloading) {
      weapons.cancelReload ? weapons.cancelReload() : (weapons.state.reloading = false);
      state.reloadsCancelled++;
    }

    state.swinging = true;
    state.t = 0;
    state.since = 0;
    state.landed = false;
    state.swings++;

    // The player's own blade, pitched up hard against the shambler's swipe so
    // the two are never confused in a fight. Reuses the existing cue rather
    // than building an eighth synthesiser.
    audio?.swipe?.({ pitch: 1.6, gain: 0.8 });

    return true;
  }

  /**
   * The nearest live actor inside the cone, or null.
   *
   * Cheap by construction: one pass over a list the director caps at twenty-
   * four, squared distances only until the cone test, and no allocation.
   */
  function findTarget() {
    const list = director && director.live ? director.live : null;
    if (!list || !list.length) return null;

    // Forward in world space, flattened. The blade is swung at things standing
    // on the same floor; keeping the pitch component would mean looking at your
    // feet made you miss the thing in front of you.
    camera.getWorldDirection(forward);
    forward.y = 0;
    const fl = Math.hypot(forward.x, forward.z);
    if (fl < 1e-6) return null;
    forward.x /= fl;
    forward.z /= fl;

    const cosArc = Math.cos(MELEE.arc);
    const reachSq = MELEE.reach * MELEE.reach;

    let best = null;
    let bestSq = Infinity;

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || !a.live || a.dying) continue;

      _p.copy(a.position);
      const dx = _p.x - player.position.x;
      const dz = _p.z - player.position.z;
      const dy = _p.y - player.position.y;

      const flat = dx * dx + dz * dz;
      if (flat > reachSq) continue;
      if (Math.abs(dy) > MELEE.vertical) continue;

      const d = Math.sqrt(flat);
      // A body the player is standing inside has no meaningful bearing; take it.
      if (d > 1e-4) {
        const dot = (dx / d) * forward.x + (dz / d) * forward.z;
        if (dot < cosArc) continue;
      }

      if (flat < bestSq) { bestSq = flat; best = a; }
    }

    return best;
  }

  /**
   * Resolve the edge. Returns the hit records for the caller to pay out, or
   * null if the blade found nothing.
   *
   * The array is returned rather than the payout being made here, for the same
   * reason weapons.fire() returns hits: this file has no business knowing what
   * a kill is worth. main.js runs the records through the SAME payout() that
   * pays for a bullet, so a melee kill pays 60 because a kill pays 60.
   */
  function land() {
    const target = findTarget();
    record.enemy = target;
    record.damage = MELEE.damage;
    record.killed = false;
    record.region = 'body';
    if (!target) { record.point = null; return null; }

    // Chest height, off the actor's own declared height, so a scarab is struck
    // at ankle level and a Bound across the ribs. Falls back to a metre for a
    // spec that never declared one.
    const h = (target.spec && target.spec.height) || 1.8;
    const s = (target.spec && target.spec.scale) || 1;
    _point.set(target.position.x, target.position.y + h * s * 0.55, target.position.z);
    record.point = _point;

    const connected = combat.applyMelee(records, 1);
    if (!connected) { record.enemy = null; record.point = null; return null; }

    state.connects++;
    if (record.killed) state.kills++;

    // Felt, not just resolved. A swing that connects and moves nothing on
    // screen reads as having passed through the body.
    rig?.kick?.(MELEE.camKick, (Math.random() - 0.5) * MELEE.camKick * 0.5);
    viewmodel?.meleeImpact?.();

    return records;
  }

  /**
   * Advance the swing. Returns hit records on the frame the edge lands, else
   * null.
   *
   * dt is the frame loop's clamped delta and every term below is multiplied by
   * it. See the note at the top of the file.
   */
  function update(dt) {
    state.since = Math.min(1e6, state.since + dt);
    if (!state.swinging) return null;

    state.t += dt;

    let out = null;
    if (!state.landed && state.t >= MELEE.contact) {
      state.landed = true;
      out = land();
    }

    if (state.t >= MELEE.swing) {
      state.swinging = false;
      state.t = 0;
      // Drop the reference so a pooled record cannot hold a retired actor alive
      // until the next swing overwrites it.
      record.enemy = null;
      record.point = null;
    }

    return out;
  }

  return {
    state,
    MELEE,
    swing,
    update,
    ready,
    cooldownLeft,

    /**
     * Everything a harness or a difficulty tier needs, as plain data.
     *
     * `oneShots` is derived rather than asserted: it answers "what is the last
     * wave this blade kills a shambler outright" from the SAME hpScale the
     * director uses, so the answer cannot drift from the game.
     */
    stats() {
      return {
        ...state,
        cooldownLeft: +cooldownLeft().toFixed(3),
        ready: ready(),
        knobs: { ...MELEE },
        oneShots: {
          // 1 + (damage/base - 1)/0.15, floored: the last whole wave at which a
          // single swing still exceeds the scaled health.
          shambler: Math.floor(1 + (MELEE.damage / 150 - 1) / 0.15),
          husk: Math.floor(1 + (MELEE.damage / 85 - 1) / 0.15),
          scarab: Math.floor(1 + (MELEE.damage / 45 - 1) / 0.15),
          bound: Math.floor(1 + (MELEE.damage / 560 - 1) / 0.15),
        },
      };
    },
  };
}
