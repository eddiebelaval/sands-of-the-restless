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
 * Per-weapon combat stats.
 *
 * `spreadHip` and `spreadAds` are the half-angle of the cone in radians.
 * The gap between them is what makes aiming worth doing, and it is the number
 * to change first if the weapon feels wrong.
 */
export const STATS = {
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

  sunspear: {
    damage: 95, headshot: 1.6,     // splash weapons reward volume, not precision
    rpm: 180, auto: true,
    magazine: 20, reserve: 60,
    spreadHip: 0.020, spreadAds: 0.006,
    pellets: 1, range: 80,
    audio: 'energy',
  },
};

/** Load order for the number keys and the scroll wheel. */
export const SLOTS = ['mk9', 'smg', 'shotgun', 'carbine', 'lmg', 'bolt', 'sunspear'];

export function createWeapons({ camera, viewmodel, rig, audio, world, impacts }) {
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
  };

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
    state.reloadEnds = clock + 4.0;
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

    get magazine() { return ammo[state.current].mag; },
    get reserve() { return ammo[state.current].reserve; },
    get name() { return STATS[state.current] ? state.current : ''; },
    get isReloading() { return state.reloading; },
  };
}
