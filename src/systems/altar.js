/**
 * THE ALTAR OF PTAH: the top of the economy, and the only sink that never fills.
 *
 * Everything else in the map is a fixed shopping list. There are nine doors,
 * four wall buys and six shrines, and once a player has bought all of them gold
 * has nowhere to go and the back half of a long run stops meaning anything. The
 * Altar is what keeps a wave-thirty purse worth having: 5000 for the first
 * weapon put through it, 2000 for every one after, and there are seven weapons.
 *
 * The FIRST price is the wall and the REST are the choice. 5000 is deliberately
 * more than any other single thing in the map costs, because upgrading the gun
 * in your hands should be a decision the player saves for and not something they
 * wander into; 2000 afterwards is cheap enough that bringing a second weapon
 * back is worth the walk, which is what stops the Altar being a one-time event
 * in a room the player never returns to.
 *
 * WHAT AN UPGRADE IS lives in player/weapons.js, in the UPGRADE record: 2.5x
 * damage, doubled magazine and reserve, spread multiplied by 0.7. This file
 * decides what it COSTS and whether it may be bought, and calls weapons.upgrade()
 * to make it so. Same split as doors and prices everywhere else in this game.
 *
 * WHAT AN UPGRADE LOOKS LIKE is two things, and both are additive by
 * construction because the weapon viewmodels are the one part of this project
 * that is already right and an upgrade is not licence to redraw them:
 *
 *   - the finish. player/viewmodel.js gains ONE new function, upgradeFinish(),
 *     which repoints the weapon-body meshes at gold-and-lapis clones of the same
 *     materials. No geometry, no pose, no keyframe, no base material changes.
 *
 *   - the tracers, which are owned HERE. An upgraded round leaves a streak, and
 *     the streak is drawn from a pool this file allocates into the world scene
 *     and hands weapons.js a callback into. It is the only part of an upgrade
 *     that exists outside the weapon, so it is the only part that needed
 *     somewhere new to live.
 */

import * as THREE from 'three';

/** How many tracers may be in flight. An LMG at 620 rpm will not exceed this. */
const TRACER_POOL = 28;

/** Seconds a streak is visible. Short: this is a bullet, not a laser. */
const TRACER_LIFE = 0.075;

export function createAltar({ scene, camera, weapons, economy, audio, notice }) {
  const state = {
    upgraded: 0,
    denied: 0,
    /** Weapon ids put through, in order, for the harness. */
    order: [],
  };

  // ---------------------------------------------------------------------------
  // tracers
  // ---------------------------------------------------------------------------

  /**
   * One shared geometry running 0..1 along +Z, so a streak is a position, a
   * lookAt, and a Z scale. Object3D.lookAt points a non-camera object's +Z at
   * the target, which is why the geometry is translated forward rather than
   * being centred on the origin.
   */
  const tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
  tracerGeo.translate(0, 0, 0.5);

  // Additive and unlit, because a tracer is light and not a surface. Depth
  // WRITE is off so a hundred overlapping streaks do not fight each other, but
  // depth TEST stays on so a streak going into a wall is occluded by the wall.
  const tracerMat = new THREE.MeshBasicMaterial({
    color: 0xffd27a,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const tracerGroup = new THREE.Group();
  tracerGroup.name = 'tracers';
  // Never a hitscan target. Without this the next round fired can be stopped by
  // the streak the last one left, which is a bug that presents as the weapon
  // randomly missing at close range.
  tracerGroup.userData.noHit = true;
  scene.add(tracerGroup);

  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i++) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.userData.noHit = true;
    tracerGroup.add(mesh);
    tracers.push({ mesh, life: 0 });
  }

  let cursor = 0;
  let highFidelity = true;

  const origin = new THREE.Vector3();
  const offset = new THREE.Vector3();

  /**
   * Draw a streak from roughly the muzzle to where the round landed.
   *
   * "Roughly" is correct and not a shortcut. The hitscan itself is cast from the
   * centre of the screen, because the viewmodel lives in its own scene at its
   * own scale and its barrel is nowhere near where the world thinks it is. A
   * tracer drawn from the camera origin would leave the screen as a dot; drawn
   * from a hand's width down and right of the eye it reads as coming out of the
   * weapon, which is the only thing it has to do.
   */
  function fire(end) {
    if (!highFidelity) return null;

    camera.getWorldPosition(origin);
    offset.set(0.22, -0.16, 0).applyQuaternion(camera.quaternion);
    origin.add(offset);

    const t = tracers[cursor];
    cursor = (cursor + 1) % TRACER_POOL;

    const dist = origin.distanceTo(end);
    if (dist < 0.2) return null;

    t.mesh.position.copy(origin);
    t.mesh.lookAt(end);
    t.mesh.scale.set(1, 1, dist);
    t.mesh.visible = true;
    t.life = TRACER_LIFE;

    return t;
  }

  function update(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.life = 0;
        t.mesh.visible = false;
      }
    }
  }

  function setFidelity(high) {
    highFidelity = !!high;
    if (highFidelity) return;
    for (const t of tracers) { t.life = 0; t.mesh.visible = false; }
  }

  // ---------------------------------------------------------------------------
  // price
  // ---------------------------------------------------------------------------

  function costFor(rec) {
    const cfg = rec.config || {};
    const first = cfg.cost === undefined ? 5000 : cfg.cost;
    const repeat = cfg.repeat === undefined ? 2000 : cfg.repeat;
    return state.upgraded === 0 ? first : repeat;
  }

  /**
   * Why the Altar will not take gold, or null if gold is the only obstacle.
   * A gated Altar quotes no price, the same rule every other fixture keeps.
   */
  function lockedBecause() {
    const id = weapons.state.current;
    if (!id) return 'Nothing in your hands';
    if (weapons.isUpgraded(id)) return 'Already renewed';
    return null;
  }

  // ---------------------------------------------------------------------------
  // prompt
  // ---------------------------------------------------------------------------

  function describe(rec) {
    const label = ((rec.config && rec.config.label) || 'Altar of Ptah').toUpperCase();
    const id = weapons.state.current;
    const name = weapons.displayName(id).toUpperCase();

    const why = lockedBecause();
    if (why) return { text: `${label} - ${name} ${why.toUpperCase()}`, deny: true };

    const cost = costFor(rec);
    const afford = economy.canAfford(cost);

    return {
      text: `${label} - RENEW ${name} - ${cost} GOLD${afford ? '  [F]' : ''}`,
      deny: !afford,
    };
  }

  // ---------------------------------------------------------------------------
  // purchase
  // ---------------------------------------------------------------------------

  function deny(message) {
    state.denied++;
    audio?.purchaseDenied?.();
    if (message && notice) notice(message, 1800);
    return false;
  }

  function buy(rec) {
    const why = lockedBecause();
    if (why) return deny(why);

    const id = weapons.state.current;
    const cost = costFor(rec);

    if (!economy.canAfford(cost)) {
      return deny(`Need ${cost - economy.gold} more gold`);
    }
    if (!economy.spend(cost, `altar/${id}`)) return deny();

    if (!weapons.upgrade(id)) {
      // Should be unreachable: lockedBecause has already established that the
      // weapon is held and un-upgraded. If it ever is reached the gold has
      // already gone, so it is given back rather than quietly kept.
      economy.grant(cost, 'altar/refund');
      return deny('The Altar refuses');
    }

    state.upgraded++;
    state.order.push(id);

    audio?.bossHorn?.();
    notice?.(weapons.displayName(id).toUpperCase(), 3000);
    return true;
  }

  return {
    state,
    describe,
    buy,
    costFor,
    lockedBecause,

    /** Handed to createWeapons, which calls it once per upgraded round fired. */
    tracer: fire,

    update,
    setFidelity,

    get tracerGroup() { return tracerGroup; },
    get liveTracers() { return tracers.filter((t) => t.life > 0).length; },
  };
}
