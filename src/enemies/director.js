/**
 * The wave director: what the map sends, from where, and when.
 *
 * Four jobs, and they are separated on purpose because each has a different
 * failure mode:
 *
 *   1. COMPOSITION. What a wave is made of, and how that changes with the wave
 *      number. Wrong here and the game is either trivial or unsurvivable.
 *   2. PLACEMENT. Where a spawn is allowed to happen. Wrong here and enemies
 *      appear inside a pillar, or in front of the player's crosshair, and
 *      either one destroys the illusion instantly.
 *   3. POOLING. Every actor is allocated at boot and reused forever. Wrong here
 *      and wave twelve stutters every time a corpse crumbles.
 *   4. PACING. A breather between waves and a horn on the way in. Without it a
 *      round-based shooter is one continuous fight with a counter on it.
 *
 * THE POOL IS THE LOAD-BEARING DECISION. `spawn()` on an actor writes numbers
 * into a record that already exists; it constructs no mesh, no material, no
 * vector, and no array. The pool is deeper than the live cap on purpose, so
 * that an actor which is mid-crumble is not blocking the wave behind it.
 *
 * SPACE. The player can be in the courtyard or 110 units away inside the
 * pyramid, and the two spaces do not share a floor, a collider set, or a
 * coordinate region. The director watches the router and, on a transition,
 * retires every live actor immediately and rebuilds its placement set for the
 * new space. Walking an enemy through the doorway is not a feature the doorway
 * supports: it is a teleport between cells, and an actor that survived it would
 * be pathing toward a player it can never reach.
 */

import * as THREE from 'three';
import { createEnemy } from './mummy.js';
import { VARIANTS, UNLOCK } from './variants.js';
import { createBossPack } from './boss.js';
import { allPortals } from '../world/rooms.js';
import { PLAYER_CONSTANTS } from '../player/controller.js';

/**
 * How many actors may be alive at once.
 *
 * Not a memory limit, a READABILITY limit. Past about two dozen the horde stops
 * being individually legible and the player is shooting a texture. It is also
 * the number the audio emitter pool is sized to, because every live actor needs
 * somewhere to groan from.
 */
const LIVE_CAP = 24;

/** Pool depth per variant. Deeper than the cap so crumbling corpses never
 * starve the wave behind them. */
const POOL = { shambler: 16, husk: 10, bound: 6, scarab: 12 };

/** Seconds of quiet between waves. The first one is shorter: a player who has
 * just pressed Begin should not be standing in silence. */
const BREATHER = 6.0;
const FIRST_BREATHER = 3.5;

/** Distance band a spawn point must fall in, relative to the player. */
const SPAWN_NEAR = 13;
const SPAWN_FAR = 55;

/** Half-angle of the cone counted as "the player is looking at this". */
const VIEW_COS = Math.cos(0.95);   // about 54 degrees off the view axis

// ---------------------------------------------------------------------------
// spatial hash
// ---------------------------------------------------------------------------

/**
 * A uniform grid over the collider list.
 *
 * The courtyard carries 461 collision cylinders and the interior a comparable
 * number. Twenty-four actors each walking that list three times a frame - twice
 * for the two resolve passes and once for the avoidance probe - is over thirty
 * thousand distance tests before anything has moved, and it grows with every
 * prop anyone adds to the map. This turns it into a handful.
 *
 * Each collider goes in exactly ONE bucket, the one its centre falls in, and a
 * query widens by the largest radius in the grid. That is what keeps the query
 * free of duplicates without a per-item visited stamp, which would mean
 * mutating records this module does not own.
 *
 * THE SPLIT IS THE POINT. The courtyard's pyramid is a single cylinder of
 * radius 32, and widening every query by 32 makes the grid a linear scan with
 * extra steps: measured, it forced a 64-unit cell, which is most of the
 * playable yard. So anything bigger than half a cell goes into a short list
 * that is always scanned instead. Fewer than one collider in ten lands there,
 * and the whole structure is only worth building because that ratio holds.
 */
const CELL = 5;
const BIG_R = CELL * 0.5;

function createColliderGrid() {
  const buckets = new Map();
  const big = [];
  const out = [];

  const cell = CELL;
  let maxR = 0;
  let source = null;
  let sourceLen = -1;

  const key = (ix, iz) => ix * 100003 + iz;

  function build(list) {
    maxR = 0;
    buckets.clear();
    big.length = 0;

    for (const c of list) {
      if (c.r > BIG_R) { big.push(c); continue; }
      if (c.r > maxR) maxR = c.r;

      const k = key(Math.floor(c.x / cell), Math.floor(c.z / cell));
      let b = buckets.get(k);
      if (!b) { b = []; buckets.set(k, b); }
      b.push(c);
    }

    source = list;
    sourceLen = list.length;
  }

  /**
   * Rebuild if the underlying array has been swapped or resized.
   *
   * A barrier opening SPLICES its discs out of the live collider array, which
   * is the whole reason a buy-door lets the player walk through it. A grid
   * built once at boot would keep a bought doorway blocked for the horde and
   * nobody would ever work out why the wave had stopped arriving.
   */
  function sync(list) {
    if (list !== source || list.length !== sourceLen) build(list);
  }

  function near(x, z, r) {
    out.length = 0;
    const reach = r + maxR;
    const x0 = Math.floor((x - reach) / cell), x1 = Math.floor((x + reach) / cell);
    const z0 = Math.floor((z - reach) / cell), z1 = Math.floor((z + reach) / cell);

    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const b = buckets.get(key(ix, iz));
        if (!b) continue;
        for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    }

    // The oversized few, filtered by their own reach so a query on the far side
    // of the yard does not drag the pyramid into every push-out test.
    for (let i = 0; i < big.length; i++) {
      const c = big[i];
      const dx = x - c.x, dz = z - c.z;
      const want = c.r + r;
      if (dx * dx + dz * dz <= want * want) out.push(c);
    }

    return out.length;
  }

  return {
    build, sync, near, out,
    get cellSize() { return cell; },
    get gridded() { return sourceLen - big.length; },
    get oversized() { return big.length; },
  };
}

// ---------------------------------------------------------------------------
// director
// ---------------------------------------------------------------------------

export function createDirector({
  scene, world, spaces, audio, player, rig, camera, combat, impacts, notice,
}) {
  // One root for every actor, added to the SCENE rather than to a space group,
  // so it survives a transition and is never hidden along with the courtyard.
  const root = new THREE.Group();
  root.name = 'enemies';
  scene.add(root);

  // The weapon raycast tests an explicit list. Index 0 is rewritten by the
  // router on every transition; appending here means the horde is shootable in
  // both spaces without the router needing to know it exists.
  world.hitTargets.push(root);

  const grid = createColliderGrid();
  grid.build(world.colliders);

  // --- the pool -------------------------------------------------------------
  const pools = {};
  let triangles = 0;
  for (const [id, n] of Object.entries(POOL)) {
    const spec = VARIANTS[id];
    pools[id] = [];
    for (let i = 0; i < n; i++) {
      const a = createEnemy(spec, i);
      pools[id].push(a);
      triangles += a.triangles;
    }
  }

  const bosses = createBossPack(scene);

  /** Live actors, in no particular order. Mutated in place; never reallocated. */
  const live = [];

  // --- audio emitters -------------------------------------------------------
  //
  // A PannerNode is not free and it runs whether or not anything is playing
  // through it, so there is one per LIVE slot rather than one per pooled actor:
  // the audio cost of the horde is bounded by how many can be heard at once,
  // not by how deep the pool happens to be.
  //
  // Each slot owns a bare Object3D that the director drives to the actor's
  // position. Attaching the handle to the actor's own group would work, and
  // would also mean allocating forty-odd panners for a cap of twenty-four.
  const emitters = [];
  for (let i = 0; i <= LIVE_CAP; i++) {
    const dummy = new THREE.Object3D();
    emitters.push({
      dummy,
      handle: audio.attachPositional(dummy, 'enemy'),
      taken: false,
      actor: null,
    });
  }

  function takeEmitter() {
    for (const e of emitters) {
      if (!e.taken) { e.taken = true; return e; }
    }
    return null;
  }

  function freeEmitter(actor) {
    if (!actor.emitter) return;
    for (const e of emitters) {
      if (e.handle === actor.emitter) { e.taken = false; e.actor = null; break; }
    }
  }

  // --- placement ------------------------------------------------------------

  /** Candidate spawn points for the live space. Rebuilt on a transition. */
  let points = [];
  let pointSpace = null;

  function isClear(x, z, pad) {
    const n = grid.near(x, z, pad + 0.5);
    const list = grid.out;
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (c.h < 1.2) continue;             // rubble is standable-beside, not solid
      const dx = x - c.x, dz = z - c.z;
      const want = c.r + pad;
      if (dx * dx + dz * dz < want * want) return false;
    }
    return true;
  }

  /**
   * The courtyard has no authored spawn points, so they are found rather than
   * declared: a coarse lattice over the playable rectangle, every node tested
   * against the live collider set. Doing it once at the transition rather than
   * per spawn is what keeps the placement search off the spawn path.
   */
  function buildExteriorPoints() {
    const b = world.bounds;
    const min = (b.minX ?? b.min) + 3;
    const max = (b.maxX ?? b.max) - 3;
    const minZ = (b.minZ ?? b.min) + 3;
    const maxZ = (b.maxZ ?? b.max) - 3;

    const out = [];
    for (let x = min; x <= max; x += 3.5) {
      for (let z = minZ; z <= maxZ; z += 3.5) {
        if (isClear(x, z, 1.5)) out.push({ x, z, room: null });
      }
    }
    return out;
  }

  /** The interior declares its own, one per room, in rooms.js. */
  function buildInteriorPoints() {
    const out = [];
    for (const room of spaces.interior.rooms) {
      for (const p of room.spawnPoints || []) {
        if (isClear(p.x, p.z, 1.2)) out.push({ x: p.x, z: p.z, room: room.id });
      }
    }
    return out;
  }

  /**
   * Which rooms an enemy spawned in could actually WALK to the player from.
   *
   * Spawning behind a barrier the player has not bought produces a wave that
   * never arrives and never ends, and the player has no way to tell that from a
   * bug. Reachability is recomputed per spawn because a door can be bought
   * mid-wave, and it is a ten-node breadth-first search over a graph that is
   * already in memory.
   */
  const reach = new Set();
  const frontier = [];

  function computeReach(fromId) {
    reach.clear();
    if (!fromId) return;

    frontier.length = 0;
    frontier.push(fromId);
    reach.add(fromId);

    const portals = allPortals();
    const barriers = spaces.interior.barriers;

    while (frontier.length) {
      const id = frontier.pop();
      for (const p of portals) {
        if (p.from !== id && p.to !== id) continue;
        const other = p.from === id ? p.to : p.from;
        if (reach.has(other)) continue;

        if (p.kind !== 'open') {
          const b = barriers.find((x) => x.from === p.from && x.to === p.to);
          if (b && !b.opened && !b.opening) continue;
        }

        reach.add(other);
        frontier.push(other);
      }
    }
  }

  /**
   * How much stone stands between a candidate point and the player.
   *
   * THE COURTYARD IS NOT ONE OPEN ROOM. A colonnade wall runs the length of the
   * avenue at x = plus or minus 15, and the yard reaches to 49. A spawn point
   * outside that wall is thirty metres from the player as the crow flies and
   * sixty as a shambler walks, because it has to go round the open end - and
   * the horde then reads as a wave that never arrives, which is the same
   * symptom as a horde that is broken.
   *
   * Sampling the straight line is not pathfinding and does not pretend to be.
   * It answers one question - "is there a wall in the way of the obvious
   * route" - and that is enough to keep the director from choosing the far side
   * of a barrier when the near side is available. It scores rather than vetoes,
   * so a map with no clear line still spawns.
   *
   * Returns 0 for a clean line, 1 for a solid one.
   */
  function obstruction(px, pz) {
    const dx = player.position.x - px;
    const dz = player.position.z - pz;
    const d = Math.hypot(dx, dz);
    if (d < 2) return 0;

    const steps = Math.min(14, Math.max(3, Math.round(d / 3.5)));
    let blocked = 0;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!isClear(px + dx * t, pz + dz * t, 0.5)) blocked++;
    }
    return blocked / (steps - 1);
  }

  const _fwd = new THREE.Vector3();

  /**
   * Choose where to put one enemy down.
   *
   * Scored rather than filtered, so the search always returns something. A
   * filter that finds nothing has to fall back to a point it already rejected,
   * which means the rejection rule was never really a rule.
   *
   * Behind the player beats in front of the player, and a point in the right
   * distance band beats one that is not; a random sample of the candidate set
   * is enough to find a good one without walking eight hundred points.
   */
  function pickPoint() {
    if (!points.length) return null;

    const interior = spaces.active === 'interior';
    if (interior) computeReach(spaces.roomId);

    // Forward is (-sin yaw, 0, -cos yaw), the same convention the player
    // controller and the camera rig use.
    _fwd.set(-Math.sin(rig.yaw), 0, -Math.cos(rig.yaw));

    let best = null;
    let bestScore = -Infinity;
    const tries = Math.min(24, points.length);

    for (let i = 0; i < tries; i++) {
      const p = points[(Math.random() * points.length) | 0];
      if (interior && p.room && reach.size && !reach.has(p.room)) continue;

      const dx = p.x - player.position.x;
      const dz = p.z - player.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 6) continue;                       // never in the player's lap

      let score = 0;
      score -= Math.abs(d - (SPAWN_NEAR + 9)) * 0.6;
      if (d > SPAWN_FAR) score -= 60;

      // Heavier than the view penalty on purpose. An enemy the player can see
      // arrive is a small cost; an enemy that has to walk round a colonnade to
      // arrive at all is the round not ending.
      score -= obstruction(p.x, p.z) * 90;

      // In view is a heavy penalty, not a veto: in a small chamber with the
      // player facing the only doorway, every legal point is in front of them,
      // and refusing to spawn is worse than spawning where they can see it.
      const dot = (dx * _fwd.x + dz * _fwd.z) / (d || 1);
      if (dot > VIEW_COS) score -= 45;

      score += Math.random() * 4;                // break ties, spread the horde

      if (score > bestScore) { bestScore = score; best = p; }
    }

    return best;
  }

  // --- wave composition -----------------------------------------------------

  /**
   * What a wave is made of.
   *
   * The curve is the classic one: numbers first, then variety, then weight. A
   * player meets the shambler alone for three waves, the swarm at four, the
   * husk at six, and the Bound at ten, by which point they have had a chance to
   * buy something that can deal with it.
   *
   * The queue is a plain array of variant ids, drained by the spawner. It is
   * emptied and refilled in place so a wave costs no allocation either.
   */
  const queue = [];

  function compose(wave) {
    queue.length = 0;

    const boss = wave % 5 === 0;
    const total = boss
      ? Math.min(16, 4 + Math.round(wave * 0.8))
      : Math.min(34, 5 + Math.round(wave * 2.1));

    // Weights, evaluated against the unlock table. A variant that has not
    // unlocked contributes nothing rather than being clamped to a small share,
    // which is what keeps wave three genuinely a wave of shamblers.
    const weight = {
      shambler: 1.0,
      scarab: wave >= UNLOCK.scarab ? 0.30 + Math.min(0.35, wave * 0.012) : 0,
      husk: wave >= UNLOCK.husk ? 0.25 + Math.min(0.55, (wave - 6) * 0.035) : 0,
      bound: wave >= UNLOCK.bound ? 0.10 + Math.min(0.30, (wave - 10) * 0.02) : 0,
    };

    let sum = 0;
    for (const k in weight) sum += weight[k];

    for (let i = 0; i < total; i++) {
      let r = Math.random() * sum;
      let pick = 'shambler';
      for (const k in weight) {
        r -= weight[k];
        if (r <= 0) { pick = k; break; }
      }
      queue.push(pick);
      // The swarm arrives as a swarm. One scarab is a curiosity; four is a
      // problem, which is the only reason the variant exists.
      if (pick === 'scarab' && i < total - 2) { queue.push('scarab'); i++; }
    }

    return { boss, total: queue.length };
  }

  // --- spawning -------------------------------------------------------------

  const hpScale = (wave) => 1 + (wave - 1) * 0.15;
  const speedScale = (wave) => Math.min(1.45, 1 + (wave - 1) * 0.022);

  function takeFromPool(id) {
    const p = pools[id];
    if (p) {
      for (const a of p) if (!a.live) return a;
    }
    // Pool exhausted. Substituting the base variant is the honest degradation:
    // the wave stays the right SIZE, which is what the player feels, and only
    // its composition drifts.
    for (const a of pools.shambler) if (!a.live) return a;
    return null;
  }

  function place(actor, x, z) {
    // Wave zero exists between reset() and the first horn. Scaling health by it
    // would hand out 0.85x enemies to anything that places one during the
    // breather, which is the harness and every scripted encounter.
    const w = Math.max(1, state.wave);
    actor.spawn(x, z, ctx, hpScale(w), speedScale(w));

    const slot = takeEmitter();
    actor.emitter = slot ? slot.handle : null;
    if (slot) slot.actor = actor;

    root.add(actor.group);
    live.push(actor);
    return actor;
  }

  function spawnOne(id) {
    if (live.length >= LIVE_CAP) return null;

    const point = pickPoint();
    if (!point) return null;

    const actor = takeFromPool(id);
    if (!actor) return null;

    return place(actor, point.x, point.z);
  }

  /** Called by a boss's summon ability. Adds are free of the wave queue. */
  function summon(n) {
    let made = 0;
    for (let i = 0; i < n; i++) {
      const id = state.wave >= UNLOCK.husk && Math.random() < 0.5 ? 'husk' : 'shambler';
      if (spawnOne(id)) made++;
    }
    return made;
  }

  function retire(actor, index) {
    freeEmitter(actor);
    actor.retire();
    root.remove(actor.group);
    // Swap-and-pop. Order in the live list carries no meaning and splice on a
    // list this hot is a copy of the tail on every kill.
    live[index] = live[live.length - 1];
    live.pop();
  }

  function clearLive() {
    for (let i = live.length - 1; i >= 0; i--) retire(live[i], i);
    bosses.effects.clear();
    state.boss = null;
  }

  // --- state ----------------------------------------------------------------

  const state = {
    wave: 0,
    phase: 'breather',        // breather | spawning | clearing
    timer: FIRST_BREATHER,
    spawnIn: 0,
    boss: null,
    running: true,
    remaining: 0,
    killed: 0,
    stall: 0,
  };

  const ctx = {
    dt: 0,
    elapsed: 0,
    playerPos: player.position,
    playerYaw: 0,
    playerRadius: PLAYER_CONSTANTS.RADIUS,
    actorHeight: 2,
    heightAt: null,
    bounds: null,
    walls: null,
    colliderGrid: grid,
    live,
    combat,
    impacts,
    rig,
    director: null,
  };

  function beginWave() {
    state.wave++;
    const { boss } = compose(state.wave);
    state.phase = 'spawning';
    state.spawnIn = 0;
    state.remaining = queue.length + (boss ? 1 : 0);

    if (boss) {
      const god = bosses.forWave(state.wave);
      const point = pickPoint();
      if (point) {
        god.spawn(point.x, point.z, ctx, 1 + (state.wave / 5 - 1) * 0.55);
        const slot = takeEmitter();
        god.emitter = slot ? slot.handle : null;
        if (slot) slot.actor = god;
        root.add(god.group);
        live.push(god);
        state.boss = god;
      }
      audio.bossHorn?.();
      notice?.(`${bosses.forWave(state.wave).name} STIRS`, 3200);
    } else {
      audio.waveStart?.();
      notice?.(`WAVE ${state.wave}`, 1800);
    }
  }

  // --- space routing --------------------------------------------------------

  let lastSpace = null;

  function retarget() {
    // The router has already rewritten world.* in place, so this only has to
    // re-point the context and rebuild what depends on the space.
    ctx.heightAt = world.heightAt;
    ctx.bounds = world.bounds;
    ctx.walls = world.walls;

    grid.build(world.colliders);

    points = spaces.active === 'interior' ? buildInteriorPoints() : buildExteriorPoints();
    pointSpace = spaces.active;
  }

  function onSpaceChange() {
    // Everything live belongs to the space that was. An actor kept across the
    // doorway would be pathing toward a player 110 units away through solid
    // rock, and would never arrive, and the wave would never end.
    clearLive();
    retarget();

    // The wave keeps its remaining queue: crossing the threshold does not buy
    // the player a skipped round, it relocates the fight.
    if (state.phase === 'spawning') state.spawnIn = 1.2;
  }

  retarget();
  lastSpace = spaces.active;

  // --- frame ----------------------------------------------------------------

  function update(dt, elapsed) {
    if (!state.running) return;

    if (spaces.active !== lastSpace) {
      lastSpace = spaces.active;
      onSpaceChange();
    }

    // A bought door splices colliders out of the live array; the grid has to
    // notice or the horde keeps walking into a doorway that is already open.
    grid.sync(world.colliders);

    ctx.dt = dt;
    ctx.elapsed = elapsed;
    ctx.playerYaw = rig.yaw;

    // --- pacing --------------------------------------------------------------
    if (state.phase === 'breather') {
      state.timer -= dt;
      if (state.timer <= 0) beginWave();
    } else if (state.phase === 'spawning') {
      state.spawnIn -= dt;
      if (state.spawnIn <= 0 && queue.length && live.length < LIVE_CAP) {
        if (spawnOne(queue[queue.length - 1])) { queue.pop(); state.stall = 0; }
        // Faster later, but never a firehose: the interval floor is what stops
        // wave thirty from being a wall that materialises in one second.
        state.spawnIn = Math.max(0.28, 1.5 - state.wave * 0.045);
      }

      // A queue that cannot place anything with nothing alive to wait for is a
      // hung round, and a hung round is indistinguishable from a hung game. It
      // should not be reachable; if it ever is, the wave ends rather than the
      // session. Reported, because a silent recovery here would hide the bug
      // that caused it.
      if (queue.length && !live.length) {
        state.stall += dt;
        if (state.stall > 6) {
          console.warn('[director] no placeable spawn point, dropping', queue.length);
          queue.length = 0;
          state.stall = 0;
        }
      } else {
        state.stall = 0;
      }

      if (!queue.length) state.phase = 'clearing';
    } else if (state.phase === 'clearing') {
      if (!live.length) {
        state.phase = 'breather';
        state.timer = BREATHER;
        state.boss = null;
      }
    }

    state.remaining = queue.length + live.length;

    // --- actors --------------------------------------------------------------
    for (let i = live.length - 1; i >= 0; i--) {
      const a = live[i];
      a.update(dt, ctx);
      if (a.dead) {
        state.killed++;
        if (a === state.boss) state.boss = null;
        retire(a, i);
      }
    }

    bosses.update(dt, ctx);

    // --- positional audio ----------------------------------------------------
    // The handles read matrixWorld, and these dummies are not in the scene
    // graph, so they are driven by hand. One matrix write per live actor is
    // cheaper by a wide margin than forty resident panners.
    for (const e of emitters) {
      if (!e.taken || !e.actor || !e.actor.live) continue;
      e.dummy.position.copy(e.actor.position);
      e.dummy.updateMatrix();
      e.dummy.matrixWorld.copy(e.dummy.matrix);
    }
    audio.syncPositional?.();
  }

  const api = {
    root,
    state,
    live,
    bosses,
    pools,

    update,
    summon,
    spawnOne,

    /**
     * Put one enemy down at an exact point, bypassing the placement search.
     *
     * For scripted encounters and for the harness, which has to be able to say
     * "a Bound, twenty metres away, in frame" to judge whether the silhouette
     * reads. It still respects the live cap and the pool, because an escape
     * hatch that ignores those is a way to test a game nobody plays.
     */
    placeAt(id, x, z) {
      if (live.length >= LIVE_CAP) return null;
      const actor = takeFromPool(id);
      if (!actor) return null;
      return place(actor, x, z);
    },

    /** Skip the breather. The harness and the debug console both want this. */
    forceWave(n) {
      clearLive();
      queue.length = 0;
      state.wave = (n ?? state.wave + 1) - 1;
      state.phase = 'breather';
      state.timer = 0;
    },

    reset() {
      clearLive();
      queue.length = 0;
      state.wave = 0;
      state.phase = 'breather';
      state.timer = FIRST_BREATHER;
      state.killed = 0;
    },

    setFidelity(high) {
      for (const id in pools) for (const a of pools[id]) a.setFidelity(high);
      bosses.setFidelity(high);
      for (const e of emitters) e.handle.setFidelity(high);
    },

    stats() {
      let pooled = 0;
      for (const id in pools) pooled += pools[id].length;
      return {
        wave: state.wave,
        phase: state.phase,
        live: live.length,
        queued: queue.length,
        pooled,
        cap: LIVE_CAP,
        spawnPoints: points.length,
        space: pointSpace,
        killed: state.killed,
        boss: state.boss ? state.boss.name : null,
        bossHealth: state.boss ? state.boss.health : 0,
        bossMax: state.boss ? state.boss.maxHealth : 0,
        trianglesPooled: triangles,
        trianglesPerEnemy: Math.round(triangles / pooled),
        trianglesBosses: bosses.triangles,
        colliderCell: grid.cellSize,
        collidersGridded: grid.gridded,
        collidersOversized: grid.oversized,
      };
    },

    get wave() { return state.wave; },
    get boss() { return state.boss; },
    get liveCount() { return live.length; },
  };

  ctx.director = api;
  return api;
}

export { LIVE_CAP };
