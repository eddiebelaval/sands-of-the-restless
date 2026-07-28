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
    current: 'mk9',
    owned: new Set(['mk9']),   // wall buys and the mystery box add to this
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
    const s = STATS[state.current];
    if (clock - state.lastShot < interval(state.current)) return false;
    if (ammo[state.current].mag <= 0) return false;
    return !!s;
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

  function finishReload() {
    const id = state.current;
    const need = STATS[id].magazine - ammo[id].mag;
    const take = Math.min(need, ammo[id].reserve);

    ammo[id].mag += take;
    ammo[id].reserve -= take;
    state.reloading = false;
  }

  function equip(id) {
    if (!STATS[id] || !state.owned.has(id)) return false;
    if (id === state.current) return false;

    state.current = id;
    state.reloading = false;
    state.lastShot = -Infinity;

    viewmodel?.equip(id);
    audio?.weaponSwitch?.();
    return true;
  }

  function cycle(delta) {
    const owned = SLOTS.filter((id) => state.owned.has(id));
    if (owned.length < 2) return;

    const i = owned.indexOf(state.current);
    const next = owned[(i + delta + owned.length) % owned.length];
    equip(next);
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
    equip,
    cycle,
    grant,
    refillAmmo,
    upgrade,

    owns(id) { return state.owned.has(id); },
    isUpgraded(id = state.current) { return state.upgraded.has(id); },
    displayName,

    get magazine() { return ammo[state.current].mag; },
    get reserve() { return ammo[state.current].reserve; },
    get name() { return STATS[state.current] ? state.current : ''; },
    get isReloading() { return state.reloading; },
  };
}
