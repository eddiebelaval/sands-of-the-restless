/**
 * Weapon logic: stats, ammunition, fire rate, hitscan, reload state.
 *
 * This owns WHAT a shot does. The viewmodel owns what a shot LOOKS like, and
 * the audio engine owns what it sounds like. Keeping them apart means the feel
 * of a weapon can be tuned in one file without touching geometry or synthesis.
 *
 * Hitscan is a raycast from the exact centre of the screen with an angular
 * cone of spread applied. It is not fired from the muzzle of the viewmodel:
 * the viewmodel lives in its own scene at its own scale and its barrel is
 * nowhere near where the world thinks it is. Every shooter does it this way.
 */

import * as THREE from 'three';

/**
 * Per-weapon combat stats, AS AUTHORED.
 *
 * `spreadHip` and `spreadAds` are the half-angle of the cone in radians.
 * The gap between them is what makes aiming worth doing, and it is the number
 * to change first if the weapon feels wrong.
 *
 * This table is frozen and never changes. The table the game READS is `STATS`
 * below, which is derived from this one every time a boon is taken or a weapon
 * comes off the Altar. Keeping the authored numbers separate from the live ones
 * is what lets a perk be dropped or a run be reset without anyone having to
 * remember what a weapon was before it was modified - the answer is always here.
 */
export const BASE_STATS = {
  mk9: {
    damage: 42, headshot: 2.6,
    rpm: 410, auto: false,
    magazine: 12, reserve: 96,
    spreadHip: 0.022, spreadAds: 0.0035,
    pellets: 1, range: 90,
    audio: 'pistol',
  },

  smg: {
    damage: 28, headshot: 2.5,
    rpm: 900, auto: true,
    magazine: 32, reserve: 192,
    spreadHip: 0.038, spreadAds: 0.011,
    pellets: 1, range: 70,
    audio: 'smg',
  },

  shotgun: {
    damage: 26, headshot: 2.0,
    rpm: 85, auto: false,
    magazine: 6, reserve: 48,
    spreadHip: 0.105, spreadAds: 0.062,
    pellets: 8, range: 32,
    audio: 'shotgun',
  },

  carbine: {
    damage: 46, headshot: 2.6,
    rpm: 700, auto: true,
    magazine: 30, reserve: 210,
    spreadHip: 0.030, spreadAds: 0.0055,
    pellets: 1, range: 120,
    audio: 'rifle',
  },

  lmg: {
    damage: 52, headshot: 2.4,
    rpm: 620, auto: true,
    magazine: 75, reserve: 225,
    spreadHip: 0.048, spreadAds: 0.013,
    pellets: 1, range: 110,
    audio: 'lmg',
  },

  bolt: {
    damage: 220, headshot: 4.0,
    rpm: 45, auto: false,
    magazine: 5, reserve: 40,
    spreadHip: 0.055, spreadAds: 0.0004,
    pellets: 1, range: 300,
    audio: 'bolt',
  },

  /**
   * THE SUNSPEAR: one shot, one body, through wave twenty.
   *
   * It is the rarest thing in the game - mystery-box exclusive alongside the
   * bolt rifle, with no wall anywhere that sells it - and until this pass it was
   * a 95-damage energy rifle, which is to say it was worse than the carbine you
   * can buy for 1250 gold on wave two. A weapon whose only route in is luck has
   * to be worth the luck.
   *
   * THE NUMBER IS DERIVED, NOT CHOSEN. The binding constraint at wave twenty is
   * the Bound - 560 base health, the armoured variant, unlocked at wave ten -
   * and enemies/director.js scales health linearly:
   *
   *     hpScale(w) = 1 + (w - 1) * 0.15
   *     hpScale(20) = 1 + 19 * 0.15 = 3.85
   *     Bound at wave 20 = 560 * 3.85 = 2156
   *
   * Not the shambler (150 -> 578), not the husk (85 -> 327), not the scarab
   * (45 -> 173). 2400 clears 2156 with room, and because the curve is linear the
   * margin is legible as waves rather than as a percentage: the last wave a
   * 2400-damage body shot still one-shots a Bound is
   *
   *     w = 1 + (2400/560 - 1) / 0.15 = 22.9  ->  through wave 22.
   *
   * Bosses are deliberately NOT in that arithmetic. The wave-20 god is Sekhmet
   * at 9600 base and 2.65 scale - 25,440 - and a boss that dies to one trigger
   * pull is not a boss.
   *
   * WHAT IT COSTS, because one-shot-everything is otherwise strictly dominant.
   * The damage went up 25x and the ammunition came down to a quarter: four in
   * the tube, twenty in reserve, twenty-four rounds in the whole run, at 55
   * rounds a minute rather than 180. Wave twenty sends 34 bodies. The Sunspear
   * cannot clear a wave; it can delete the four things in that wave that were
   * going to kill you, and then it is a paperweight until a Flood of Hapi drops.
   * That is the trade, and it is why the new Max Ammo drop matters to it more
   * than to any other weapon in the armoury.
   *
   * The headshot multiplier stays at 1.6 and is now only meaningful against a
   * god, which is the one target left that a body shot does not finish.
   */
  sunspear: {
    damage: 2400, headshot: 1.6,
    rpm: 55, auto: true,
    magazine: 4, reserve: 20,
    spreadHip: 0.020, spreadAds: 0.006,
    pellets: 1, range: 80,
    audio: 'energy',
  },
};

/** Load order for the number keys and the scroll wheel. */
export const SLOTS = ['mk9', 'smg', 'shotgun', 'carbine', 'lmg', 'bolt', 'sunspear'];

Object.freeze(BASE_STATS);
for (const id of SLOTS) Object.freeze(BASE_STATS[id]);

/**
 * What a weapon is CALLED, before and after the Altar of Ptah.
 *
 * The base names match the viewmodel's own table, because the player reads one
 * name on the HUD and sees one object in their hands and the two disagreeing is
 * the kind of small wrongness nobody can name but everybody notices. The upgrade
 * names are the whole point of an upgrade being an event: the weapon does not
 * get better silently, it comes back with a title.
 */
export const NAMES = {
  mk9:      { base: 'MK9',          upgraded: "Nekhbet's Talon" },
  smg:      { base: 'Wadjet SMG',   upgraded: 'Wadjet Ascendant' },
  shotgun:  { base: 'Sekhem 12',    upgraded: 'Sekhem Devourer' },
  carbine:  { base: 'M4 Ankh',      upgraded: 'Ankh Eternal' },
  lmg:      { base: 'Apis LMG',     upgraded: 'Apis Thunderer' },
  bolt:     { base: 'Sekhmet Bolt', upgraded: "Sekhmet's Verdict" },
  sunspear: { base: 'Sunspear',     upgraded: 'Sunspear Zenith' },
};

/**
 * What the Altar of Ptah does to a weapon, as one record.
 *
 * 2.5x damage rather than a flat bonus, because a flat bonus is worth everything
 * to a pistol and nothing to a bolt rifle, and the whole point is that upgrading
 * whatever you are carrying is worth 5000 gold. The magazine doubles because
 * the wave count keeps climbing and reload time is what actually kills you at
 * wave twenty. The spread comes DOWN rather than the recoil animation changing,
 * because recoil the player sees is the viewmodel's business and this file has
 * no business reaching into it.
 */
export const UPGRADE = Object.freeze({
  damage: 2.5,
  magazine: 2,
  reserve: 2,
  spread: 0.70,
});

/**
 * The LIVE stats table. This is what damage.js, the HUD, and everything else
 * reads, and it is the only one that ever changes.
 *
 * Rebuilt from BASE_STATS by applyModifiers() below rather than edited in place
 * by whoever last had an opinion. A perk that multiplies damage and an upgrade
 * that multiplies damage would otherwise compound differently depending on the
 * order they were bought in, which is a bug that only shows up in one player's
 * run and can never be reproduced.
 */
export const STATS = {};

/** Global multipliers, from the shrines. One set, applied to every weapon. */
const globalMods = { damage: 1, rpm: 1, spread: 1 };

/** Per-weapon multipliers, from the Altar. */
const weaponMods = {};

function applyModifiers() {
  for (const id of SLOTS) {
    const b = BASE_STATS[id];
    const w = weaponMods[id];

    const dmg = globalMods.damage * (w ? w.damage : 1);
    const spread = globalMods.spread * (w ? w.spread : 1);

    const live = STATS[id] || (STATS[id] = { ...b });

    live.damage = b.damage * dmg;
    live.headshot = b.headshot;
    live.rpm = b.rpm * globalMods.rpm;
    live.auto = b.auto;
    live.magazine = Math.round(b.magazine * (w ? w.magazine : 1));
    live.reserve = Math.round(b.reserve * (w ? w.reserve : 1));
    live.spreadHip = b.spreadHip * spread;
    live.spreadAds = b.spreadAds * spread;
    live.pellets = b.pellets;
    live.range = b.range;
    live.audio = b.audio;
    live.upgraded = !!w;
  }
}

applyModifiers();

/**
 * Set a global multiplier and rebuild the table. Used by the Shrine of Set.
 * Passing no value for a field leaves it where it is.
 */
export function setGlobalModifiers(next = {}) {
  if (next.damage !== undefined) globalMods.damage = next.damage;
  if (next.rpm !== undefined) globalMods.rpm = next.rpm;
  if (next.spread !== undefined) globalMods.spread = next.spread;
  applyModifiers();
  return { ...globalMods };
}

/** Put a weapon through the Altar. Idempotent: a second call changes nothing. */
export function markUpgraded(id) {
  if (!BASE_STATS[id] || weaponMods[id]) return false;
  weaponMods[id] = { ...UPGRADE };
  applyModifiers();
  return true;
}

// There is deliberately no resetModifiers(). Every modifier already has an
// owner that can take it back: the Shrine of Set restores its own multipliers
// in remove(), which runs when the boon is dropped, and an Altar upgrade is
// meant to be permanent for the run. A blanket reset would be a function whose
// only plausible caller is somebody who wants to clear a perk and would
// silently clear five thousand gold of Pack-a-Punch with it.

/** What to print on the HUD, on a wall buy, and on the Altar's prompt. */
export function displayName(id) {
  const n = NAMES[id];
  if (!n) return String(id || '').toUpperCase();
  return weaponMods[id] ? n.upgraded : n.base;
}

export function createWeapons({ camera, viewmodel, rig, audio, world, impacts, tracer }) {
  // Ammunition is per weapon and persists across switches, the way it should.
  const ammo = {};
  for (const id of SLOTS) {
    ammo[id] = { mag: STATS[id].magazine, reserve: STATS[id].reserve };
  }

  const state = {
    /**
     * What is in the player's hands, or NULL for nothing at all.
     *
     * Null is a real state and not a bug: the Altar of Ptah takes the weapon
     * away for the length of its ritual, and if that is the only weapon the
     * player owns then for those five seconds they are holding nothing. That is
     * the whole point of the machine - it is a decision because it costs you
     * your gun during a horde - so every read of this field below is guarded
     * rather than the state being faked with a hidden weapon.
     */
    current: 'mk9',
    owned: new Set(['mk9']),   // wall buys and the mystery box add to this
    /**
     * The weapon sitting in the Altar of Ptah, or null.
     *
     * It stays in `owned` while it is in there, because the player has not lost
     * it - they cannot reach it. Keeping ownership is also what lets the upgrade
     * apply while the weapon is on the machine rather than in a hand. What this
     * field does is refuse it to equip() and cycle(), so a number key cannot
     * summon a gun that is visibly lying on an altar in another room.
     */
    stowed: null,
    firing: false,
    reloading: false,
    reloadEnds: 0,
    lastShot: -Infinity,
    upgraded: new Set(),       // weapons put through the Altar of Ptah

    /**
     * Multiplier on how long a reload takes. The Shrine of Ptah sets 0.5.
     *
     * The AUTHORITY on when a reload finishes is the viewmodel animation
     * returning to 'ready', so this number is not the whole story on its own:
     * the frame loop scales the delta it hands the viewmodel by the same factor
     * while a reload is running, and this scales the headless fallback timer to
     * match. Two places, one number, and they are wired to the same field so
     * they cannot drift.
     */
    reloadScale: 1,
  };

  /** Scratch for the tracer endpoint, so a miss does not allocate. */
  const tracerEnd = new THREE.Vector3();

  // Scratch, allocated once. A raycaster and two vectors per shot would be
  // hundreds of allocations a second on an automatic weapon.
  const ray = new THREE.Raycaster();
  const dir = new THREE.Vector3();
  const spreadAxis = new THREE.Vector3();
  const perp = new THREE.Vector3();
  const centre = new THREE.Vector2(0, 0);

  let clock = 0;

  /** Seconds between shots, from rounds per minute. */
  const interval = (id) => 60 / STATS[id].rpm;

  function canFire() {
    if (state.reloading) return false;

    /**
     * THE HANDS ARE BUSY WITH A BLADE.
     *
     * Without this the trigger still works through a swing: canFire only ever
     * looked at `reloading`, so a held mouse button would spend rounds and cast
     * hitscan rays while viewmodel.fire() - which DOES refuse, through busy() -
     * declined to draw the muzzle flash. Ammunition leaving the magazine with
     * no flash, no shell and no kick is the exact shape of a bug that reads as
     * the gun being broken.
     *
     * Read off the animation phase for the same reason the reload below is: the
     * viewmodel is the single authority on whether the hands are free, and a
     * second flag here would be a second opinion about one pair of arms.
     */
    if (viewmodel?.state?.phase === 'meleeing') return false;
    // Empty hands. Checked FIRST, because every line under it indexes a table
    // by the weapon id and there is no id.
    const s = STATS[state.current];
    if (!s) return false;
    if (clock - state.lastShot < interval(state.current)) return false;
    if (ammo[state.current].mag <= 0) return false;
    return true;
  }

  /**
   * Apply a random deviation inside a cone of the given half-angle.
   *
   * Sampling the angle as sqrt(random) rather than random spreads shots evenly
   * over the disc. Using the raw random clusters them toward the centre, which
   * makes a shotgun feel far tighter than its numbers say it is.
   */
  function applySpread(v, halfAngle) {
    if (halfAngle <= 0) return;

    // Any vector not parallel to v gives a usable perpendicular basis.
    perp.set(0, 1, 0);
    if (Math.abs(v.dot(perp)) > 0.99) perp.set(1, 0, 0);

    spreadAxis.crossVectors(v, perp).normalize();
    perp.crossVectors(v, spreadAxis).normalize();

    const angle = Math.sqrt(Math.random()) * halfAngle;
    const roll = Math.random() * Math.PI * 2;

    v.addScaledVector(spreadAxis, Math.tan(angle) * Math.cos(roll));
    v.addScaledVector(perp, Math.tan(angle) * Math.sin(roll));
    v.normalize();
  }

  /**
   * Fire one round. Returns an array of hit records, one per pellet that
   * connected, for the damage and economy systems to consume.
   */
  function fire(ads) {
    // Nothing in your hands fires nothing, and does not click either. A dry-fire
    // snap with no weapon on screen reads as the gun being invisible rather than
    // absent, which is exactly the wrong read while the Altar has it.
    if (!state.current) return null;

    if (!canFire()) {
      // Dry fire only when the trigger is pulled on a genuinely empty magazine,
      // not on every frame the rate limiter says no.
      if (!state.reloading && ammo[state.current].mag <= 0) {
        audio?.dryFire?.();
        if (ammo[state.current].reserve > 0) reload();
      }
      return null;
    }

    const id = state.current;
    const s = STATS[id];

    state.lastShot = clock;
    ammo[id].mag -= 1;

    // The viewmodel owns the kick animation and calls rig.kick() itself.
    viewmodel?.fire();

    audio?.shot?.(s.audio, { upgraded: state.upgraded.has(id) });

    const spread = ads ? s.spreadAds : s.spreadHip;
    const hits = [];

    for (let p = 0; p < s.pellets; p++) {
      ray.setFromCamera(centre, camera);
      dir.copy(ray.ray.direction).normalize();
      applySpread(dir, spread);
      ray.ray.direction.copy(dir);
      ray.far = s.range;

      const its = ray.intersectObjects(world.hitTargets || [], true);
      const hit = its.find((h) => h.object.visible && !h.object.userData?.noHit);

      // The tracer is drawn for EVERY pellet, including the ones that hit
      // nothing. A round that only leaves a streak when it connects is a
      // hitmarker with extra steps; the whole read of a tracer is watching
      // where the ones that missed went.
      if (tracer && STATS[id].upgraded) {
        if (hit) tracerEnd.copy(hit.point);
        else tracerEnd.copy(ray.ray.origin).addScaledVector(dir, s.range);
        tracer(tracerEnd, id);
      }

      if (!hit) continue;

      // An enemy tags its own meshes; anything untagged is scenery.
      const enemy = hit.object.userData?.enemy || hit.object.parent?.userData?.enemy;
      const region = hit.object.userData?.region || 'body';

      hits.push({ point: hit.point, normal: hit.face?.normal, enemy, region, weapon: id });

      impacts?.spawn(hit.point, hit.face?.normal, enemy ? 'flesh' : 'stone');
    }

    if (ammo[id].mag <= 0 && ammo[id].reserve > 0) reload();

    return hits;
  }

  function reload() {
    const id = state.current;
    if (!id) return false;
    if (state.reloading) return false;
    if (ammo[id].mag >= STATS[id].magazine) return false;
    if (ammo[id].reserve <= 0) return false;

    state.reloading = true;

    const started = viewmodel ? viewmodel.reload() : true;
    if (!started) { state.reloading = false; return false; }

    audio?.magOut?.();

    // The viewmodel owns the authored reload length per weapon. Rather than
    // duplicating that number here and letting the two drift, watch its phase
    // and finish the logical reload when the animation returns to ready.
    // The timer is only a fallback for a headless run with no viewmodel.
    state.reloadEnds = clock + 4.0 * state.reloadScale;
    return true;
  }

  /**
   * ABANDON A RELOAD WITH NOTHING SEATED.
   *
   * The khopesh interrupts one - see systems/melee.js - and this is the whole
   * of what that means mechanically: the flag comes down, the fallback timer is
   * pushed out of reach, and finishReload() is NOT called, so not one round
   * moves from the reserve into the magazine. The player pressed R, took a
   * swing instead, and has to press R again.
   *
   * Deliberately does not touch the viewmodel. The animation is already being
   * taken over by the swing that caused this, and two systems both claiming to
   * own the same stroke is how one of them silently loses.
   */
  function cancelReload() {
    if (!state.reloading) return false;
    state.reloading = false;
    state.reloadEnds = Infinity;
    return true;
  }

  function finishReload() {
    const id = state.current;
    // The hands can empty mid-reload: the Altar takes the weapon and the frame
    // loop is still holding a `reloading` flag from the frame before.
    if (!id) { state.reloading = false; return; }
    const need = STATS[id].magazine - ammo[id].mag;
    const take = Math.min(need, ammo[id].reserve);

    ammo[id].mag += take;
    ammo[id].reserve -= take;
    state.reloading = false;
  }

  function equip(id) {
    if (!STATS[id] || !state.owned.has(id)) return false;
    if (id === state.current) return false;
    // It is in the machine. Owned, and out of reach: see state.stowed.
    if (id === state.stowed) return false;

    state.current = id;
    state.reloading = false;
    state.lastShot = -Infinity;

    viewmodel?.equip(id);
    audio?.weaponSwitch?.();
    return true;
  }

  function cycle(delta) {
    const owned = SLOTS.filter((id) => state.owned.has(id) && id !== state.stowed);
    if (!owned.length) return;

    // From empty hands the wheel takes whatever is first rather than doing
    // nothing, which is what a player who has just put their only other weapon
    // on the Altar and spun the wheel is asking for.
    if (!state.current) { equip(owned[0]); return; }
    if (owned.length < 2) return;

    const i = owned.indexOf(state.current);
    const next = owned[(i + delta + owned.length) % owned.length];
    equip(next);
  }

  /**
   * THE ALTAR OF PTAH TAKES THE WEAPON. Returns the id it took, or null.
   *
   * This is the mechanical half of the ritual and the reason the ritual is worth
   * building: for as long as the machine has the weapon, the player does not, so
   * standing at the Altar during a horde is a wager rather than a transaction.
   *
   * WHAT THE PLAYER HOLDS INSTEAD is Black Ops 2's answer, which is "your other
   * weapon, if you brought one". A player carrying two guns comes away from the
   * machine holding the second one; a player carrying one - which is everybody
   * on their first visit, because the MK9 is the only weapon the run starts with
   * - comes away holding NOTHING and cannot shoot until they collect it. Both
   * paths are real: see the note on state.current.
   *
   * Nothing is refunded or destroyed here. The weapon is in `owned` the whole
   * time and the only route out of `stowed` is restore(), which is called from
   * exactly two places in systems/altar.js: the collection, and the refund.
   */
  function stow() {
    const id = state.current;
    if (!id) return null;
    if (state.stowed) return null;      // the machine holds one weapon

    state.stowed = id;
    state.current = null;
    state.firing = false;
    state.reloading = false;
    state.lastShot = -Infinity;

    // Ordered so exactly one of the two animations runs. equip() drives the
    // viewmodel's own lower-and-swap; stow() drives the lower with nothing on
    // the far side of it. Running both would latch two intentions onto one
    // stroke and the loser would be silently dropped.
    const other = SLOTS.find((x) => x !== id && state.owned.has(x));
    if (other) equip(other);
    else viewmodel?.stow?.();

    return id;
  }

  /**
   * Hand a stowed weapon back, straight into the hands.
   *
   * Called on collection and on the Altar's refund path, and it is the same call
   * both times on purpose: a weapon that comes back because the machine finished
   * and a weapon that comes back because the machine refused arrive by one route,
   * so there is no way for one of them to be the path that forgot to give it back.
   */
  function restore(id) {
    if (state.stowed !== id) return false;
    state.stowed = null;
    equip(id);
    return true;
  }

  /** Wall buys, the mystery box, and the puzzle reward all come through here. */
  function grant(id, { refill = true } = {}) {
    if (!STATS[id]) return false;
    state.owned.add(id);
    if (refill) {
      ammo[id].mag = STATS[id].magazine;
      ammo[id].reserve = STATS[id].reserve;
    }
    return true;
  }

  function refillAmmo(id = state.current) {
    if (!STATS[id]) return false;
    ammo[id].reserve = STATS[id].reserve;
    return true;
  }

  /**
   * The Altar of Ptah, applied.
   *
   * Three things happen and they are deliberately in this order: the stat table
   * is rebuilt first, so the new magazine size exists before anything tries to
   * fill it; the ammunition is then handed over full, because a weapon whose
   * magazine just doubled and is still holding the old number reads as the
   * upgrade having failed; and the viewmodel is gilded last, because that is
   * cosmetic and must never be the thing that decides whether the purchase went
   * through.
   */
  function upgrade(id = state.current) {
    if (!STATS[id] || !state.owned.has(id)) return false;
    if (state.upgraded.has(id)) return false;
    if (!markUpgraded(id)) return false;

    state.upgraded.add(id);
    ammo[id].mag = STATS[id].magazine;
    ammo[id].reserve = STATS[id].reserve;

    viewmodel?.upgradeFinish?.(id);
    return true;
  }

  function update(dt, input, ads) {
    clock += dt;

    if (state.reloading) {
      const phase = viewmodel?.state?.phase;
      // The animation leaving 'reloading' is the authoritative signal. The
      // clock is only a safety net for a run with no viewmodel attached.
      const animDone = viewmodel ? (phase !== 'reloading' && phase !== 'raising') : false;
      if (animDone || clock >= state.reloadEnds) finishReload();
    }

    const s = STATS[state.current];

    // Empty hands: the trigger still latches, so holding it down through a
    // collection does not dump the first magazine the moment the weapon is back.
    if (!s) {
      state.firing = !!input.fire;
      return null;
    }

    // Automatic weapons fire while held; everything else needs a fresh press,
    // which is what `firing` latches.
    let hits = null;
    if (input.fire) {
      if (s.auto || !state.firing) hits = fire(ads);
      state.firing = true;
    } else {
      state.firing = false;
    }

    return hits;
  }

  return {
    state,
    ammo,
    STATS,

    update,
    fire,
    reload,
    cancelReload,
    equip,
    cycle,
    grant,
    refillAmmo,
    upgrade,
    stow,
    restore,

    owns(id) { return state.owned.has(id); },
    isUpgraded(id = state.current) { return state.upgraded.has(id); },
    displayName,

    // Zero rather than a throw when the hands are empty. The HUD asks for these
    // every frame and it is not the HUD's business whether the Altar has the gun.
    get magazine() { return state.current ? ammo[state.current].mag : 0; },
    get reserve() { return state.current ? ammo[state.current].reserve : 0; },
    get name() { return STATS[state.current] ? state.current : ''; },
    get isReloading() { return state.reloading; },
  };
}
