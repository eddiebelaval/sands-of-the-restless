/**
 * The five gods, one per fifth wave.
 *
 * THE RULE EVERY ABILITY IN THIS FILE IS WRITTEN AGAINST: an ability that fires
 * without a wind-up the player can read is not an ability, it is damage. So
 * every one of them runs the same three-phase machine -
 *
 *     telegraph  ->  active  ->  recover
 *
 * - and the telegraph is never silent and never invisible. It costs a pose
 * change, an emissive ramp on the god's gilding, and a horn. A player who is
 * looking at the boss gets the pose, a player who is reloading behind a pillar
 * gets the horn, and a player who is neither gets hit, which is correct.
 *
 * The gods are five behaviour tables over one body. Anubis summons and charges;
 * Ammit slams and volleys; Apep teleports and volleys; Sekhmet charges and
 * slams; Set does all five and unlocks them as it loses health, so the last
 * fight of the cycle is the only one where the player has to read more than two
 * tells at once.
 *
 * Everything is pooled: all five bodies, the projectile pool, and the shockwave
 * ring are allocated when the pack is built at boot. A boss wave allocates
 * nothing, because the frame a boss lands is the worst frame in the game to
 * pay for a garbage collection.
 */

import * as THREE from 'three';
import { chamferedBox } from '../world/geometry.js';
import {
  MUMMY, buildHumanoid, animateHumanoid, groundAt, resolveAgainstWorld,
} from './mummy.js';

const _v = new THREE.Vector3();

/** Shared crown geometry. Five gods, a dozen shapes, built once. */
const CGEO = new Map();
function cgeo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  let g = CGEO.get(key);
  if (!g) { g = chamferedBox(w, h, d, Math.min(w, h, d) * 0.18, 1.0); CGEO.set(key, g); }
  return g;
}

// ---------------------------------------------------------------------------
// heads
// ---------------------------------------------------------------------------

/**
 * The god's head, which is the ONLY thing distinguishing five bodies that are
 * otherwise the same wrapped colossus.
 *
 * That is deliberate rather than lazy. The gods are the same order of being;
 * what an Egyptian pantheon actually varies is the head, and it is also the
 * part of a silhouette that reads at the top of the frame where the player's
 * crosshair already is. Every crown here is three to six boxes.
 */
function addCrown(rig, mats, kind, P, tag) {
  const neck = rig.neck;
  const add = (g, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(g, mat);
    m.userData.enemy = tag;
    m.userData.region = 'head';
    m.castShadow = true;
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    neck.add(m);
    rig.meshes.push(m);
    rig.triangles += g.attributes.position.count / 3;
    return m;
  };

  const H = P.headH, W = P.headW, D = P.headD;

  if (kind === 'jackal') {
    // Long muzzle and two tall upright ears. The most recognisable outline in
    // the whole pantheon, and it survives being three boxes.
    add(cgeo(W * 0.52, H * 0.36, D * 1.5), mats.deep, 0, H * 0.34, D * 0.9);
    for (const s of [-1, 1]) {
      add(cgeo(W * 0.26, H * 1.15, 0.07), mats.deep,
        s * W * 0.34, H * 1.05, -D * 0.1, 0, 0, s * 0.12);
    }
  } else if (kind === 'crocodile') {
    // A long low jaw with a visible tooth line, and a stubby mane behind it.
    add(cgeo(W * 0.72, H * 0.30, D * 2.0), mats.deep, 0, H * 0.22, D * 1.15);
    add(cgeo(W * 0.66, H * 0.16, D * 1.8), mats.accent, 0, H * 0.40, D * 1.05);
    for (const s of [-1, 1]) {
      add(cgeo(0.09, H * 0.55, 0.09), mats.accent, s * W * 0.42, H * 0.75, -D * 0.2);
    }
  } else if (kind === 'serpent') {
    // A flared hood. Two wide thin slabs angled out of the skull, which reads
    // as a cobra from any angle including directly overhead.
    for (const s of [-1, 1]) {
      add(cgeo(W * 0.9, H * 1.5, 0.07), mats.accent,
        s * W * 0.62, H * 0.62, -D * 0.15, 0, 0, s * -0.42);
    }
    add(cgeo(W * 0.6, H * 0.34, D * 1.3), mats.deep, 0, H * 0.30, D * 0.8);
  } else if (kind === 'lioness') {
    // A ring of mane slabs and a solar disc over the crown.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(cgeo(0.10, H * 0.75, 0.10), mats.accent,
        Math.sin(a) * W * 0.66, H * 0.55, Math.cos(a) * D * 0.66 - D * 0.1,
        0, a, Math.sin(a) * 0.3);
    }
    add(cgeo(W * 0.9, W * 0.9, 0.09), mats.accent, 0, H * 1.45, -D * 0.1);
    add(cgeo(W * 0.45, H * 0.28, D * 1.1), mats.deep, 0, H * 0.26, D * 0.72);
  } else {
    // Set: the animal nobody has ever identified. Square-cut ears and a long
    // down-curved snout, which is exactly why it reads as WRONG rather than as
    // any animal the player can name.
    add(cgeo(W * 0.5, H * 0.30, D * 1.7), mats.deep, 0, H * 0.20, D * 1.0, 0.22);
    for (const s of [-1, 1]) {
      add(cgeo(W * 0.34, H * 1.0, 0.08), mats.accent,
        s * W * 0.36, H * 1.02, -D * 0.15, -0.16, 0, s * 0.1);
    }
    add(cgeo(W * 1.3, 0.09, D * 0.7), mats.accent, 0, H * 1.3, -D * 0.3);
  }
}

// ---------------------------------------------------------------------------
// the pantheon
// ---------------------------------------------------------------------------

/** Base body: the shambler's proportions, thickened and doubled in size. */
const COLOSSUS = {
  hipY: 0.92, hipW: 0.50, bodyD: 0.40,
  legX: 0.18, legW: 0.26, thighL: 0.44, shinL: 0.48,
  torsoY: 0.13, chestW: 0.74, chestH: 0.60,
  shoulderX: 0.40, shoulderY: 0.50, armW: 0.22, upperL: 0.44, foreL: 0.46,
  headY: 0.70, headW: 0.30, headH: 0.32, headD: 0.30,
  plate: { w: 0.56, h: 0.34 },
  shoulderSlab: { w: 0.34, h: 0.16, d: 0.50 },
  tatterRest: 0.06,
  // Narrow and low, for the same reason the shambler's are: a wide rag on a
  // shoulder photographs as a flag, and a god does not need help being seen.
  tatters: [
    { on: 'torso', x: -0.30, y: 0.20, z: -0.21, w: 0.15, h: 0.95, yaw: 0.28, swing: 0.7 },
    { on: 'torso', x: 0.30, y: 0.14, z: -0.21, w: 0.13, h: 0.80, yaw: -0.28, swing: 0.7 },
    { on: 'arm', side: 1, x: 0, y: -0.34, z: 0, w: 0.11, h: 0.52, yaw: 1.1, swing: 1.2 },
  ],
};

const GOD_GAIT = {
  rate: 1.25,
  stride: 0.40,
  armSwing: 0.16,
  armReach: -0.55,
  armSplay: 0.40,
  elbowBend: 0.55,
  lean: -0.10,
  sway: 0.06,
  hipTwist: 0.05,
  bob: 0.05,
  headLoll: 0.06,
  headDroop: -0.10,
};

/**
 * The five.
 *
 * `abilities` is an ORDERED list. Set reads it as an escalation ladder gated on
 * health; everyone else picks from it at random, which is what keeps a
 * two-ability god from becoming a metronome.
 */
export const GODS = [
  {
    id: 'anubis', name: 'ANUBIS', crown: 'jackal',
    health: 5200, speed: 2.6, damage: 42,
    abilities: ['summon', 'charge'],
    palette: { wrap: 0x8d7f62, wrapDark: 0x4a3f2b, deep: 0x14100b, eye: 0x64d0ff, accent: 0xd8b25c },
  },
  {
    id: 'ammit', name: 'AMMIT', crown: 'crocodile',
    health: 6800, speed: 2.1, damage: 52,
    abilities: ['slam', 'volley'],
    palette: { wrap: 0x7f7554, wrapDark: 0x3d3a24, deep: 0x120f08, eye: 0xffc14a, accent: 0x9fae5c },
  },
  {
    id: 'apep', name: 'APEP', crown: 'serpent',
    health: 8200, speed: 2.4, damage: 46,
    abilities: ['teleport', 'volley'],
    palette: { wrap: 0x6b6a74, wrapDark: 0x2e2d38, deep: 0x0d0c12, eye: 0x9a4aff, accent: 0x4e6fb0 },
  },
  {
    id: 'sekhmet', name: 'SEKHMET', crown: 'lioness',
    health: 9600, speed: 3.0, damage: 58,
    abilities: ['charge', 'slam'],
    palette: { wrap: 0xa3835a, wrapDark: 0x5c3f22, deep: 0x1a0f08, eye: 0xff7a20, accent: 0xe0a63e },
  },
  {
    id: 'set', name: 'SET', crown: 'set',
    health: 13500, speed: 2.8, damage: 64,
    // Escalating: one more tell to read every quarter of its health bar.
    abilities: ['charge', 'slam', 'volley', 'teleport', 'summon'],
    escalating: true,
    palette: { wrap: 0x7a5f52, wrapDark: 0x3b2620, deep: 0x120806, eye: 0xff2a2a, accent: 0xb03a2a },
  },
];

/**
 * Ability timings, in seconds.
 *
 * `tell` is the readable wind-up. Nothing here is under half a second, because
 * half a second is roughly where a telegraph stops being a decision the player
 * makes and starts being a reflex test.
 */
const ABILITY = {
  charge:   { tell: 0.95, active: 1.30, recover: 0.90, cool: 6.5 },
  slam:     { tell: 0.90, active: 0.75, recover: 1.10, cool: 7.5 },
  volley:   { tell: 0.80, active: 0.90, recover: 0.80, cool: 8.0 },
  teleport: { tell: 0.60, active: 0.35, recover: 0.55, cool: 9.0 },
  summon:   { tell: 1.15, active: 0.40, recover: 0.90, cool: 14.0 },
};

/** How far a shockwave travels, and how fast. */
const SHOCK_RANGE = 13;
const SHOCK_SPEED = 17;

// ---------------------------------------------------------------------------
// effects
// ---------------------------------------------------------------------------

/**
 * Projectiles and the shockwave ring, pooled and shared by all five gods.
 *
 * Only one god is ever live, so one pool is enough, and sharing it means the
 * cost is paid once at boot rather than five times.
 */
function createEffects(scene) {
  const group = new THREE.Group();
  group.name = 'boss-effects';
  scene.add(group);

  const COUNT = 20;
  const geo = new THREE.SphereGeometry(0.26, 10, 8);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffd08a,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const shots = [];
  for (let i = 0; i < COUNT; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    // Not a hit target: shooting a boss projectile out of the air is a feature
    // this game does not have, and leaving it raycastable would let a stray
    // pellet register as a hit on nothing.
    m.userData.noHit = true;
    m.frustumCulled = false;
    group.add(m);
    shots.push({ mesh: m, live: false, vx: 0, vy: 0, vz: 0, life: 0, damage: 0 });
  }

  // The shockwave. A flat ring scaled outward from the slam point, additive so
  // it reads on a dark chamber floor and on bright sand alike.
  const ringGeo = new THREE.RingGeometry(0.86, 1.0, 44);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffb04a,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.userData.noHit = true;
  ring.frustumCulled = false;
  ring.visible = false;
  group.add(ring);

  const shock = { live: false, r: 0, damage: 0, hit: false };

  function fire(x, y, z, dx, dy, dz, speed, damage) {
    for (const s of shots) {
      if (s.live) continue;
      s.live = true;
      s.mesh.visible = true;
      s.mesh.position.set(x, y, z);
      s.vx = dx * speed; s.vy = dy * speed; s.vz = dz * speed;
      s.life = 4;
      s.damage = damage;
      return true;
    }
    return false;   // pool exhausted, which is a volley the player already dodged
  }

  function slam(x, y, z, damage) {
    shock.live = true;
    shock.r = 1.2;
    shock.damage = damage;
    shock.hit = false;
    ring.position.set(x, y + 0.08, z);
    ring.visible = true;
  }

  function update(dt, ctx) {
    for (const s of shots) {
      if (!s.live) continue;

      s.life -= dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      s.vy -= 3.2 * dt;              // a slow arc, so a volley can be walked out of

      const p = s.mesh.position;
      const dx = p.x - ctx.playerPos.x;
      const dy = p.y - ctx.playerPos.y;
      const dz = p.z - ctx.playerPos.z;

      if (dx * dx + dy * dy + dz * dz < 1.1) {
        ctx.combat.damagePlayer(s.damage, p.x, p.z);
        s.live = false; s.mesh.visible = false;
        continue;
      }

      // Into the floor, out of time, or into stone. A projectile that sails
      // through a pillar tells the player the pillar is not cover, which is a
      // lie the whole arena is built on.
      const floor = groundAt(ctx, p.x, p.z, p.y);
      if (s.life <= 0 || p.y < floor + 0.05 || blocked(p, ctx)) {
        s.live = false;
        s.mesh.visible = false;
        ctx.impacts?.spawn(p, null, 'metal');
      }
    }

    if (shock.live) {
      shock.r += SHOCK_SPEED * dt;
      const k = shock.r / SHOCK_RANGE;
      ring.scale.setScalar(shock.r);
      ringMat.opacity = Math.max(0, 0.85 * (1 - k));

      if (!shock.hit) {
        const dx = ctx.playerPos.x - ring.position.x;
        const dz = ctx.playerPos.z - ring.position.z;
        const d = Math.hypot(dx, dz);
        // The wave is a band, not a disc: standing still at the epicentre is
        // safe once it has passed, which is what makes it dodgeable.
        if (Math.abs(d - shock.r) < 1.4) {
          shock.hit = true;
          ctx.combat.damagePlayer(shock.damage, ring.position.x, ring.position.z);
        }
      }

      if (shock.r >= SHOCK_RANGE) {
        shock.live = false;
        ring.visible = false;
      }
    }
  }

  function blocked(p, ctx) {
    const n = ctx.colliderGrid.near(p.x, p.z, 0.4);
    const list = ctx.colliderGrid.out;
    for (let i = 0; i < n; i++) {
      const c = list[i];
      const base = c.y0 === undefined ? 0 : c.y0;
      if (p.y < base || p.y > base + c.h) continue;
      const dx = p.x - c.x, dz = p.z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) return true;
    }
    return false;
  }

  function clear() {
    for (const s of shots) { s.live = false; s.mesh.visible = false; }
    shock.live = false;
    ring.visible = false;
  }

  return { group, fire, slam, update, clear, get liveShots() { return shots.filter((s) => s.live).length; } };
}

// ---------------------------------------------------------------------------
// one god
// ---------------------------------------------------------------------------

function createGod(god, effects) {
  const spec = {
    ...MUMMY,
    id: god.id,
    name: god.name,
    health: god.health,
    speed: god.speed,
    accel: 5.0,
    turn: 2.2,
    damage: god.damage,
    attackRange: 3.0,
    windup: 0.75,
    strikeTime: 0.50,
    cooldown: 2.2,
    // A god does not flinch. Stagger on a boss reads as a stun the player did
    // not earn, and it makes an automatic weapon a lock rather than a choice.
    staggerTake: 0,
    scale: 1.9,
    height: 2.05,
    radius: 0.95,
    sepRadius: 2.4,
    voicePitch: 0.5,
    palette: { ...MUMMY.palette, ...god.palette, accentMetal: 0.85, accentRough: 0.3 },
    proportions: COLOSSUS,
    gait: GOD_GAIT,
    build: buildHumanoid,
    animate: animateHumanoid,
  };

  const actor = {
    spec,
    variant: god.id,
    name: god.name,
    boss: true,
    live: false,
    dead: false,
    dying: false,
    health: god.health,
    maxHealth: god.health,
    radius: spec.radius,
    emitter: null,
    ability: null,
  };

  // Materials, per god rather than per instance: only one is ever live, and the
  // hit flash is therefore never shared with anything.
  const mats = {
    wrap: new THREE.MeshStandardMaterial({ color: god.palette.wrap, roughness: 0.94 }),
    wrapDark: new THREE.MeshStandardMaterial({ color: god.palette.wrapDark, roughness: 0.98 }),
    // Flat dark. The glow lives on `eye` alone, or the whole head becomes a
    // lantern and the crown that distinguishes one god from another is lost
    // inside it - which is exactly what the first Anubis screenshot showed.
    deep: new THREE.MeshStandardMaterial({
      color: god.palette.deep, roughness: 0.8,
    }),
    eye: new THREE.MeshStandardMaterial({
      color: god.palette.deep, roughness: 0.6,
      emissive: god.palette.eye, emissiveIntensity: 2.6,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: god.palette.accent, roughness: 0.3, metalness: 0.85,
      emissive: god.palette.eye, emissiveIntensity: 0,
    }),
    tatter: new THREE.MeshStandardMaterial({
      color: god.palette.wrapDark, roughness: 1.0, side: THREE.DoubleSide,
    }),
  };

  const rig = buildHumanoid(spec, mats, actor);
  addCrown(rig, mats, god.crown, COLOSSUS, actor);

  actor.group = rig.group;
  actor.rig = rig;
  actor.materials = mats;
  actor.triangles = Math.round(rig.triangles);
  actor.position = rig.group.position;

  const st = {
    vx: 0, vz: 0, feetY: 0,
    phase: 0,
    windup: 0, strike: 0, cooldown: 0, struck: false,
    flash: 0,
    // ability machine
    phaseName: 'idle',      // idle | tell | active | recover
    ability: null,
    tLeft: 0,
    nextAbility: 4,
    chargeX: 0, chargeZ: 0,
    volleyLeft: 0, volleyIn: 0,
    summonWanted: 0,
    deathT: 0,
    toppleX: 0, toppleZ: 0,
  };
  actor.st = st;

  const anim = {
    phase: 0, speed: 0, windup: 0, strike: 0,
    stagger: 0, staggerRoll: 0, staggerPitch: 0,
  };

  function setGlow(k) {
    // The gilding is the telegraph channel. It is the only surface on the body
    // with metalness high enough to hold a colour against a bloom pass, so a
    // ramp on it is visible across a gallery at 16 units of ceiling height.
    mats.accent.emissiveIntensity = k * 3.2;
    mats.eye.emissiveIntensity = 2.6 + k * 4.0;
    const e = st.flash * 0.9;
    mats.wrap.emissive.setRGB(e * 0.75, e * 0.18, e * 0.10);
    mats.wrapDark.emissive.setRGB(e * 0.75, e * 0.18, e * 0.10);
  }

  function spawn(x, z, ctx, hpScale) {
    actor.live = true;
    actor.dead = false;
    actor.dying = false;
    actor.maxHealth = god.health * hpScale;
    actor.health = actor.maxHealth;

    st.vx = st.vz = 0;
    st.windup = st.strike = st.cooldown = 0;
    st.struck = false;
    st.flash = 0;
    st.phaseName = 'idle';
    st.ability = null;
    st.tLeft = 0;
    st.nextAbility = 4.5;
    st.deathT = 0;

    st.feetY = groundAt(ctx, x, z, undefined);
    rig.group.position.set(x, st.feetY, z);
    rig.group.rotation.set(0, 0, 0);
    rig.group.scale.setScalar(spec.scale);
    rig.body.position.set(0, 0, 0);
    rig.body.rotation.set(0, 0, 0);
    for (const m of rig.meshes) m.visible = true;
    setGlow(0);
  }

  function retire() {
    actor.live = false;
    actor.dying = false;
    actor.dead = false;
    actor.ability = null;
    actor.emitter = null;
  }

  function hurt(damage, region, dirX = 0, dirZ = 0) {
    if (!actor.live || actor.dying) return false;
    actor.health -= damage;
    st.flash = 1;
    if (actor.health <= 0) {
      actor.health = 0;
      actor.dying = true;
      st.deathT = 0;
      st.vx = st.vz = 0;
      st.phaseName = 'idle';
      actor.ability = null;
      const len = Math.hypot(dirX, dirZ) || 1;
      st.toppleX = dirZ / len;
      st.toppleZ = -dirX / len;
      actor.emitter?.play('deathRattle', { pitch: 0.4 });
      return true;
    }
    return false;
  }

  /** Which abilities are legal right now. Set unlocks as its bar comes down. */
  function pool() {
    if (!god.escalating) return god.abilities;
    const lost = 1 - actor.health / actor.maxHealth;
    const n = Math.max(1, Math.min(god.abilities.length, 1 + Math.floor(lost * 4.2)));
    return god.abilities.slice(0, n);
  }

  function beginAbility(name, ctx) {
    const A = ABILITY[name];
    st.ability = name;
    actor.ability = name;
    st.phaseName = 'tell';
    st.tLeft = A.tell;

    // Every telegraph is audible as well as visible. A player behind a pillar
    // is exactly the player who most needs to know a slam is coming.
    if (name === 'summon' || name === 'teleport') actor.emitter?.play('bossHorn');
    else actor.emitter?.play('groan', { pitch: 0.45 });

    if (name === 'charge') {
      // The charge line is locked at the END of the tell, not here, so a player
      // who reads the pose can still move out of it. Stored anyway so the god
      // faces its intent for the whole wind-up.
      st.chargeX = ctx.playerPos.x;
      st.chargeZ = ctx.playerPos.z;
    }
  }

  function fireAbility(ctx) {
    const name = st.ability;
    const A = ABILITY[name];
    st.phaseName = 'active';
    st.tLeft = A.active;

    const p = rig.group.position;

    if (name === 'charge') {
      const dx = ctx.playerPos.x - p.x;
      const dz = ctx.playerPos.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      st.chargeX = dx / d;
      st.chargeZ = dz / d;
      actor.emitter?.play('swipe', { pitch: 0.5 });
    } else if (name === 'slam') {
      effects.slam(p.x, st.feetY, p.z, spec.damage * 0.9);
      ctx.rig?.addTrauma(0.55);
      actor.emitter?.play('swipe', { pitch: 0.35 });
    } else if (name === 'volley') {
      st.volleyLeft = 5;
      st.volleyIn = 0;
    } else if (name === 'teleport') {
      // Behind the player, at arm's length past their shoulder, on a point the
      // world says is standable. A teleport into stone is the one failure the
      // player cannot recover from.
      const yaw = ctx.playerYaw ?? 0;
      const bx = ctx.playerPos.x + Math.sin(yaw) * 7.5;
      const bz = ctx.playerPos.z + Math.cos(yaw) * 7.5;
      p.set(bx, groundAt(ctx, bx, bz, undefined), bz);
      st.feetY = p.y;
      resolveAgainstWorld(p, spec.radius * spec.scale, st.feetY, ctx);
      actor.emitter?.play('bossHorn', { pitch: 1.2 });
    } else if (name === 'summon') {
      st.summonWanted = 5;
      actor.emitter?.play('waveStart');
    }
  }

  function update(dt, ctx) {
    if (!actor.live) return;

    ctx.actorHeight = spec.height * spec.scale;

    st.flash = Math.max(0, st.flash - dt * 6.0);

    if (actor.dying) {
      st.deathT += dt;
      const k = Math.min(1, st.deathT / 1.1) ** 2;
      rig.body.rotation.x = st.toppleX * k * (Math.PI / 2);
      rig.body.rotation.z = st.toppleZ * k * (Math.PI / 2);
      setGlow(Math.max(0, 1 - st.deathT * 0.6));
      if (st.deathT > 1.9) {
        const s = Math.min(1, (st.deathT - 1.9) / 1.4);
        rig.group.position.y = st.feetY - s * spec.height * spec.scale;
        rig.group.scale.setScalar(spec.scale * (1 - s * 0.5));
        if (s >= 1) { actor.dead = true; actor.live = false; }
      }
      return;
    }

    const p = rig.group.position;
    const tx = ctx.playerPos.x - p.x;
    const tz = ctx.playerPos.z - p.z;
    const dist = Math.hypot(tx, tz) || 1;

    // --- the ability machine -------------------------------------------------
    // One glow value is computed here and written ONCE at the bottom, because
    // setGlow also carries the hit flash: writing it from three branches means
    // a frame where a branch returns early is a frame the flash never lands.
    let charging = false;
    let glow = 0;

    if (st.phaseName === 'idle') {
      st.nextAbility -= dt;
      if (st.nextAbility <= 0) {
        const list = pool();
        beginAbility(list[Math.floor(Math.random() * list.length)], ctx);
      }
    } else {
      st.tLeft -= dt;

      if (st.phaseName === 'tell') {
        glow = 1 - st.tLeft / ABILITY[st.ability].tell;
        if (st.tLeft <= 0) fireAbility(ctx);
      } else if (st.phaseName === 'active') {
        glow = 1;

        if (st.ability === 'charge') {
          charging = true;
          st.vx = st.chargeX * spec.speed * 4.4;
          st.vz = st.chargeZ * spec.speed * 4.4;
          if (dist < spec.radius * spec.scale + 1.6) {
            ctx.combat.damagePlayer(spec.damage, p.x, p.z);
            st.tLeft = Math.min(st.tLeft, 0.05);
          }
        } else if (st.ability === 'volley' && st.volleyLeft > 0) {
          st.volleyIn -= dt;
          if (st.volleyIn <= 0) {
            st.volleyIn = 0.16;
            st.volleyLeft--;
            const oy = st.feetY + spec.height * spec.scale * 0.72;
            _v.set(ctx.playerPos.x - p.x, ctx.playerPos.y - oy, ctx.playerPos.z - p.z)
              .normalize();
            // Fanned, so a volley is a zone to leave rather than a hitscan.
            const spread = 0.10;
            effects.fire(p.x, oy, p.z,
              _v.x + (Math.random() - 0.5) * spread,
              _v.y + 0.06,
              _v.z + (Math.random() - 0.5) * spread,
              21, spec.damage * 0.42);
          }
        } else if (st.ability === 'summon' && st.summonWanted > 0) {
          ctx.director?.summon(st.summonWanted);
          st.summonWanted = 0;
        }

        if (st.tLeft <= 0) {
          st.phaseName = 'recover';
          st.tLeft = ABILITY[st.ability].recover;
        }
      } else if (st.phaseName === 'recover') {
        glow = Math.max(0, st.tLeft / ABILITY[st.ability].recover) * 0.5;
        if (st.tLeft <= 0) {
          st.nextAbility = ABILITY[st.ability].cool * (god.escalating ? 0.6 : 1);
          st.phaseName = 'idle';
          st.ability = null;
          actor.ability = null;
        }
      }
    }

    // --- melee, which never stops running --------------------------------------
    const reach = spec.attackRange * spec.scale * 0.55 + ctx.playerRadius;
    st.cooldown = Math.max(0, st.cooldown - dt);

    if (st.strike > 0) {
      st.strike = Math.max(0, st.strike - dt / spec.strikeTime);
      if (!st.struck && st.strike < 0.55) {
        st.struck = true;
        if (dist <= reach + 1.0) ctx.combat.damagePlayer(spec.damage * 0.7, p.x, p.z);
      }
    } else if (st.windup > 0) {
      st.windup = Math.min(1, st.windup + dt / spec.windup);
      if (st.windup >= 1) {
        st.windup = 0; st.strike = 1; st.struck = false;
        actor.emitter?.play('swipe', { pitch: 0.5 });
      }
    } else if (dist <= reach && st.cooldown <= 0 && st.phaseName === 'idle') {
      st.windup = 0.001;
      st.cooldown = spec.cooldown;
    }

    // --- movement -------------------------------------------------------------
    if (!charging) {
      const busy = st.windup > 0 || st.strike > 0
        || st.phaseName === 'tell' || st.phaseName === 'recover';
      const want = busy || dist < reach * 0.9 ? 0 : spec.speed;
      const a = Math.min(1, spec.accel * dt);
      st.vx += ((tx / dist) * want - st.vx) * a;
      st.vz += ((tz / dist) * want - st.vz) * a;
    }

    p.x += st.vx * dt;
    p.z += st.vz * dt;

    st.feetY = groundAt(ctx, p.x, p.z, st.feetY);
    resolveAgainstWorld(p, spec.radius * spec.scale, st.feetY, ctx);
    p.y = st.feetY;

    const wantYaw = Math.atan2(tx, tz);
    let d = wantYaw - rig.group.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    rig.group.rotation.y += d * Math.min(1, (charging ? 0.8 : spec.turn) * dt);

    // --- pose ------------------------------------------------------------------
    const speed = Math.hypot(st.vx, st.vz);
    st.phase += dt * (0.7 + speed * spec.gait.rate);

    anim.phase = st.phase;
    anim.speed = speed;
    // The ability tell borrows the melee wind-up pose: arms up, torso reared.
    // One pose vocabulary for every tell means a player who has learned to read
    // one has learned to read all of them.
    anim.windup = st.phaseName === 'tell'
      ? 1 - st.tLeft / ABILITY[st.ability].tell
      : st.windup;
    anim.strike = st.phaseName === 'active' && st.ability !== 'charge' ? 1 : st.strike;
    anim.stagger = 0;
    anim.staggerRoll = 0;
    anim.staggerPitch = 0;
    animateHumanoid(rig, spec, anim);

    setGlow(glow);
  }

  actor.spawn = spawn;
  actor.retire = retire;
  actor.hurt = hurt;
  actor.update = update;
  actor.setFidelity = (high) => { for (const m of rig.meshes) m.castShadow = high; };

  return actor;
}

// ---------------------------------------------------------------------------
// the pack
// ---------------------------------------------------------------------------

/**
 * Build all five gods and the effects they share.
 *
 * All at boot. Five colossi is about 4,700 triangles and five material sets,
 * which is cheaper than the courtyard's palm trees, and the alternative is a
 * multi-hundred-millisecond geometry build on the frame the horn sounds.
 */
export function createBossPack(scene) {
  const effects = createEffects(scene);
  const list = GODS.map((g) => createGod(g, effects));
  const byId = new Map(list.map((b) => [b.variant, b]));

  return {
    list,
    effects,

    /** Which god belongs to a given wave number. Cycles past the fifth. */
    forWave(wave) {
      const i = (Math.floor(wave / 5) - 1) % list.length;
      return list[(i + list.length) % list.length];
    },

    get(id) { return byId.get(id) || null; },

    update(dt, ctx) { effects.update(dt, ctx); },

    setFidelity(high) { for (const b of list) b.setFidelity(high); },

    triangles: list.reduce((n, b) => n + b.triangles, 0),
  };
}
