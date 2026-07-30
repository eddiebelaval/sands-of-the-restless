/**
 * Bullet impacts: what comes OFF the thing you just shot.
 *
 * Without these, firing at scenery produces a sound and nothing else, and the
 * weapon reads as a prop rather than a tool. The feedback loop of "I pulled the
 * trigger and the world reacted there" is most of what makes shooting feel
 * good, and it matters more than the damage number.
 *
 * Everything is pooled and allocated once. Spawning geometry inside the fire
 * path of a 900 rpm weapon is how a smooth game turns into a stuttering one.
 *
 * -----------------------------------------------------------------------------
 * FOUR THINGS THE PREVIOUS VERSION GOT WRONG, ALL OF THEM INVISIBLE FROM THE
 * CODE AND ALL OF THEM MEASURED ON SCREEN.
 *
 * 1. SIZE. Every particle was a 5.5 cm quad scaled 0.6 to 1.5. The vertical FOV
 *    is 75 degrees over 860 rows, which is 560/d pixels per metre: at fifteen
 *    metres that debris is one to two and a half pixels, and at twenty-five it
 *    is sub-pixel. This is the tatters defect exactly - a thing that is present,
 *    correct, and three pixels wide at the distance it has to work at. Hard grit
 *    is still small because grit IS small; what carries the read at range is now
 *    a DUST PUFF that expands past half a metre, and half a metre at twenty-five
 *    metres is twelve pixels.
 *
 * 2. VALUE. One colour per surface. A pale dust puff is invisible against a
 *    sunlit limestone wall and a dark one is invisible in an unpowered chamber,
 *    and this level has both, ten metres apart. So every burst now carries BOTH
 *    values - bright motes and dark motes in the same cloud - which is also what
 *    real dust does, because a cloud is lit on one side.
 *
 * 3. MATERIAL. The enemy surface was `flesh`, at 0x7a1f18, which is blood. These
 *    are linen-wrapped corpses over dry bone and there is no blood in them. The
 *    key is kept under its old name because the weapon calls it by that name and
 *    the weapon is not this file's to edit, but what it emits is linen fibre,
 *    wrap dust and bone chip.
 *
 * 4. GRAVITY. `update` read `PALETTE.stone` for the gravity term on every
 *    particle regardless of what spawned it, so the per-surface `grav` numbers
 *    below it had never once been applied. Sand fell at the same rate as sparks
 *    for the life of the project. Gravity and drag are now per particle.
 *
 * -----------------------------------------------------------------------------
 * WHICH WAY THE DEBRIS GOES, AND WHY IT IS NOT ALWAYS THE NORMAL.
 *
 * `Raycaster` reports `face.normal` in the struck object's LOCAL space and does
 * not transform it. For a wall that is usually harmless. For an enemy - which is
 * a group under a yaw that changes every frame - it is a direction with no
 * relation to the world, so a hemisphere built around it sprays debris through
 * the body as often as off it.
 *
 * A bullet strikes the side of a thing that is FACING THE SHOOTER, so the axis
 * that is always right and never needs transforming is the one from the impact
 * point back to the camera. Surfaces the caller genuinely knows the normal of -
 * the grenade builds a dome out of six authored directions - keep using it.
 */

import * as THREE from 'three';

/**
 * Soft expanding puffs. The thing that is legible past ten metres.
 *
 * Sized for the worst case in the game: a shotgun's eight pellets into a crowd
 * is eight bursts in one frame, and a burst is up to six puffs.
 */
const DUST_POOL = 192;

/** Hard chips, bone and linen fibre. Near-field detail, short-lived. */
const GRIT_POOL = 384;

/**
 * Per-instance alpha.
 *
 * `instanceColor` is RGB only, so without this the only fade available is a
 * shrink to zero - which is exactly wrong for dust, because a dust cloud
 * disperses by GROWING and thinning. The patch is two lines in each stage and
 * follows the same onBeforeCompile route world/weathering.js already uses on
 * this renderer.
 */
function withInstanceAlpha(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        `#include <common>
         attribute float aAlpha;
         varying float vInstanceAlpha;`)
      .replace('#include <begin_vertex>',
        `#include <begin_vertex>
         vInstanceAlpha = aAlpha;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        `#include <common>
         varying float vInstanceAlpha;`)
      .replace('#include <color_fragment>',
        `#include <color_fragment>
         diffuseColor.a *= vInstanceAlpha;`);
  };
  return material;
}

/**
 * The soft blob the dust layer is drawn with.
 *
 * Generated, like everything else in this project. A hard quad of dust reads as
 * a piece of paper; the whole point of a puff is that it has no edge.
 */
function dustTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');

  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0.00, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.72)');
  grad.addColorStop(0.70, 'rgba(255,255,255,0.20)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);

  // A little grain, so a big puff does not read as an airbrushed circle. Done
  // by punching holes rather than adding light: dust thins unevenly.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * S * 0.48;
    g.beginPath();
    g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 1 + Math.random() * 3.2, 0, 6.283);
    g.fillStyle = `rgba(0,0,0,${0.10 + Math.random() * 0.22})`;
    g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * One pooled particle layer: a single InstancedMesh and a block of flat arrays.
 *
 * Flat parallel arrays rather than an array of objects: no allocation, no
 * pointer chasing, and the whole simulation is one tight loop.
 */
function makeLayer(scene, count, material, geometry) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.count = count;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // Particles are not hitscan targets and must never be raycast. They are not
  // in world.hitTargets, but a stray intersectObjects(scene.children) - which
  // the harness does - would otherwise pick them up.
  mesh.userData.noHit = true;
  scene.add(mesh);

  if (!mesh.instanceColor) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }

  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  alpha.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aAlpha', alpha);

  return {
    mesh,
    alpha,
    active: count,
    cursor: 0,
    px: new Float32Array(count),
    py: new Float32Array(count),
    pz: new Float32Array(count),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    vz: new Float32Array(count),
    life: new Float32Array(count),
    maxLife: new Float32Array(count),
    w0: new Float32Array(count),
    h0: new Float32Array(count),
    grow: new Float32Array(count),
    grav: new Float32Array(count),
    drag: new Float32Array(count),
    roll: new Float32Array(count),
    rollV: new Float32Array(count),
    a0: new Float32Array(count),
    // 1 while the instance is parked at zero scale, so the dead ones cost one
    // compare a frame instead of a matrix write.
    parked: new Uint8Array(count),
  };
}

export function createImpacts(scene) {
  const dustTex = dustTexture();

  const dustGeo = new THREE.PlaneGeometry(1, 1);
  const gritGeo = new THREE.PlaneGeometry(1, 1);

  const dustMat = withInstanceAlpha(new THREE.MeshBasicMaterial({
    map: dustTex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    toneMapped: true,
  }));

  const gritMat = withInstanceAlpha(new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    toneMapped: true,
  }));

  const dust = makeLayer(scene, DUST_POOL, dustMat, dustGeo);
  const grit = makeLayer(scene, GRIT_POOL, gritMat, gritGeo);

  const dummy = new THREE.Object3D();
  const colour = new THREE.Color();

  // The axis a burst comes off, resolved once per spawn. Module-scoped so the
  // fire path allocates nothing.
  let ax = 0, ay = 1, az = 0;
  // Where the camera was on the last update. Used for the shooter-facing axis
  // and for the billboard.
  let camX = 0, camY = 1.6, camZ = 0;
  let camQuat = null;

  // ---------------------------------------------------------------------------
  // palettes
  // ---------------------------------------------------------------------------
  //
  // Two values in every list, always. The bright entries are what read against
  // the unpowered interior and the dark ones are what read against sunlit
  // limestone and sand; a burst that carried only one of them would be correct
  // in one room of this level and invisible in the other.

  /** Wrap dust and bone: what a linen-over-bone corpse actually sheds. */
  const LINEN_DUST = [0xe8dcc0, 0xd6c49c, 0x8a7757, 0x5d4e39];
  const LINEN_GRIT = [0xf1e9d4, 0xcbb999, 0x9d8a67, 0x554733];
  const BONE_GRIT  = [0xf7f1e0, 0xe9dfc6, 0xbfae8c];

  const STONE_DUST = [0xe4d8bb, 0xcbbb95, 0x8d7d5f];
  const STONE_GRIT = [0xd9c8a6, 0xa8916c, 0x6a5a41];
  const SAND_DUST  = [0xeadab4, 0xd3bf94, 0x93805c];
  const METAL_GRIT = [0xffd9a0, 0xff9d4a, 0xd8c9a6];

  function pick(list) {
    return list[(Math.random() * list.length) | 0];
  }

  // ---------------------------------------------------------------------------
  // the recipes
  // ---------------------------------------------------------------------------
  //
  // ONE OBJECT PER SURFACE, BUILT ONCE, AND THE FIRE PATH ONLY READS THEM.
  //
  // These were object literals written inline at each emit call, which is ten
  // fresh objects per body hit and eighty per shotgun trigger pull - a small
  // allocation, but a per-hit one, in the one function in the game that is
  // guaranteed to run fifteen times a second for the whole of a run. The rule in
  // this file is that spawning allocates nothing, and an options literal is
  // still an allocation however cheap the collector makes it look.
  //
  // Frozen so a future emitter cannot quietly tune a shared recipe from inside a
  // loop and leave every later caller using the mutated one.

  const R_LINEN_BLOOM = Object.freeze({
    palette: LINEN_DUST, size: 0.30, grow: 1.1, life: 0.14,
    speed: 0.5, spread: 0.5, lift: 0.2, grav: 0.4, drag: 4.0,
    alpha: 0.95, off: 0.04, jitter: 0.01,
  });
  const R_LINEN_CLOUD = Object.freeze({
    palette: LINEN_DUST, size: 0.20, grow: 1.15, life: 0.62,
    speed: 1.5, spread: 0.85, lift: 0.55, grav: 0.55, drag: 3.2,
    alpha: 0.58, off: 0.06, jitter: 0.05,
  });
  const R_LINEN_GRIT = Object.freeze({
    palette: LINEN_GRIT, size: 0.07, fibre: 0.6, life: 0.5,
    speed: 3.6, spread: 0.95, lift: 0.5, grav: 7.5, drag: 1.7,
    alpha: 0.95,
  });

  const R_BONE_SPRAY = Object.freeze({
    palette: BONE_GRIT, size: 0.065, fibre: 0.15, life: 0.62,
    speed: 6.2, spread: 0.42, lift: 0.35, grav: 8.5, drag: 1.1,
    alpha: 1.0,
  });
  const R_BONE_CORE = Object.freeze({
    palette: BONE_GRIT, size: 0.38, grow: 1.6, life: 0.28,
    speed: 1.1, spread: 0.5, lift: 0.7, grav: 0.35, drag: 3.4,
    alpha: 0.90, off: 0.05, jitter: 0.02,
  });
  const R_BONE_CLOUD = Object.freeze({
    palette: BONE_GRIT, size: 0.26, grow: 1.25, life: 0.58,
    speed: 1.8, spread: 0.8, lift: 0.85, grav: 0.45, drag: 3.0,
    alpha: 0.60, off: 0.06, jitter: 0.05,
  });

  const R_METAL_FLASH = Object.freeze({
    palette: METAL_GRIT, size: 0.14, grow: 0.5, life: 0.10,
    speed: 0.6, spread: 0.5, lift: 0.2, grav: 0.5, drag: 4.0,
    alpha: 0.8, off: 0.03, jitter: 0.01,
  });
  const R_METAL_SPARK = Object.freeze({
    palette: METAL_GRIT, size: 0.04, fibre: 0.75, life: 0.26,
    speed: 5.4, spread: 0.9, lift: 0.45, grav: 9.5, drag: 1.2,
    alpha: 1.0,
  });

  const R_STONE_BLOOM = Object.freeze({
    palette: STONE_DUST, size: 0.24, grow: 0.95, life: 0.13,
    speed: 0.6, spread: 0.55, lift: 0.25, grav: 0.5, drag: 3.8,
    alpha: 0.8, off: 0.05, jitter: 0.02,
  });
  const R_STONE_CLOUD = Object.freeze({
    palette: STONE_DUST, size: 0.14, grow: 1.0, life: 0.66,
    speed: 1.9, spread: 0.9, lift: 0.65, grav: 0.7, drag: 3.0,
    alpha: 0.42, off: 0.06, jitter: 0.05,
  });
  const R_STONE_GRIT = Object.freeze({
    palette: STONE_GRIT, size: 0.05, fibre: 0.25, life: 0.45,
    speed: 4.2, spread: 0.95, lift: 0.55, grav: 9.0, drag: 1.6,
    alpha: 0.95,
  });

  const R_SAND_BLOOM = Object.freeze({
    palette: SAND_DUST, size: 0.30, grow: 1.15, life: 0.16,
    speed: 0.6, spread: 0.55, lift: 0.25, grav: 0.5, drag: 3.8,
    alpha: 0.8, off: 0.05, jitter: 0.02,
  });
  const R_SAND_CLOUD = Object.freeze({
    palette: SAND_DUST, size: 0.18, grow: 1.25, life: 0.85,
    speed: 1.7, spread: 0.9, lift: 0.65, grav: 0.5, drag: 3.0,
    alpha: 0.42, off: 0.06, jitter: 0.05,
  });
  const R_SAND_GRIT = Object.freeze({
    palette: SAND_DUST, size: 0.045, fibre: 0.25, life: 0.5,
    speed: 3.0, spread: 0.95, lift: 0.55, grav: 6.5, drag: 1.6,
    alpha: 0.95,
  });

  // ---------------------------------------------------------------------------
  // the double-burst guard
  // ---------------------------------------------------------------------------
  //
  // See spawnEnemyHit. A ring of the linen bursts emitted since the last frame,
  // by position, so the region-aware call can tell whether the region-blind one
  // has already covered this exact impact. Sixteen is a shotgun's eight pellets
  // twice over; a fixed ring means the fire path still allocates nothing.

  const RING = 16;
  const linenX = new Float32Array(RING);
  const linenY = new Float32Array(RING);
  const linenZ = new Float32Array(RING);
  const linenTick = new Int32Array(RING).fill(-1);
  let linenAt = 0;
  let tick = 0;

  function noteLinen(x, y, z) {
    linenX[linenAt] = x; linenY[linenAt] = y; linenZ[linenAt] = z;
    linenTick[linenAt] = tick;
    linenAt = (linenAt + 1) % RING;
  }

  /** Same tick, same point to within a millimetre. */
  function alreadyLinen(x, y, z) {
    for (let i = 0; i < RING; i++) {
      if (linenTick[i] !== tick) continue;
      if (Math.abs(linenX[i] - x) < 1e-3
        && Math.abs(linenY[i] - y) < 1e-3
        && Math.abs(linenZ[i] - z) < 1e-3) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // emission
  // ---------------------------------------------------------------------------

  /**
   * Resolve the axis a burst throws along.
   *
   * `shooter` ignores whatever normal was handed in. See the header: a hitscan
   * normal on a rotating actor is a local-space direction and means nothing in
   * the world.
   */
  function axisFor(px, py, pz, normal, policy) {
    if (policy === 'normal' && normal) {
      const l = Math.hypot(normal.x, normal.y, normal.z) || 1;
      ax = normal.x / l; ay = normal.y / l; az = normal.z / l;
      return;
    }

    let dx = camX - px, dy = camY - py, dz = camZ - pz;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-4) { ax = 0; ay = 1; az = 0; return; }
    ax = dx / l; ay = dy / l; az = dz / l;
  }

  /** One dust puff. Sizes are METRES; see the header for why that matters. */
  function emitDust(x, y, z, o) {
    const L = dust;
    const i = L.cursor;
    L.cursor = (L.cursor + 1) % L.active;

    const jx = (Math.random() - 0.5) * 2;
    const jy = (Math.random() - 0.5) * 2;
    const jz = (Math.random() - 0.5) * 2;

    L.px[i] = x + ax * o.off * 0.5 + jx * o.jitter;
    L.py[i] = y + ay * o.off * 0.5 + jy * o.jitter;
    L.pz[i] = z + az * o.off * 0.5 + jz * o.jitter;

    const sp = o.speed * (0.45 + Math.random() * 0.9);
    L.vx[i] = (ax + jx * o.spread) * sp;
    L.vy[i] = (ay + jy * o.spread + o.lift) * sp;
    L.vz[i] = (az + jz * o.spread) * sp;

    L.maxLife[i] = o.life * (0.75 + Math.random() * 0.55);
    L.life[i] = L.maxLife[i];

    const s = o.size * (0.7 + Math.random() * 0.7);
    L.w0[i] = s;
    L.h0[i] = s;
    L.grow[i] = o.grow * (0.7 + Math.random() * 0.7);
    L.grav[i] = o.grav;
    L.drag[i] = o.drag;
    L.roll[i] = Math.random() * 6.283;
    L.rollV[i] = (Math.random() - 0.5) * 1.6;
    L.a0[i] = o.alpha * (0.75 + Math.random() * 0.45);
    L.parked[i] = 0;

    colour.setHex(pick(o.palette));
    L.mesh.setColorAt(i, colour);
  }

  /** One hard fragment: a bone chip, a stone shard, or a strip of linen. */
  function emitGrit(x, y, z, o) {
    const L = grit;
    const i = L.cursor;
    L.cursor = (L.cursor + 1) % L.active;

    const jx = (Math.random() - 0.5) * 2;
    const jy = (Math.random() - 0.5) * 2;
    const jz = (Math.random() - 0.5) * 2;

    L.px[i] = x;
    L.py[i] = y;
    L.pz[i] = z;

    const sp = o.speed * (0.4 + Math.random() * 1.1);
    L.vx[i] = (ax + jx * o.spread) * sp;
    L.vy[i] = (ay + jy * o.spread + o.lift) * sp;
    L.vz[i] = (az + jz * o.spread) * sp;

    L.maxLife[i] = o.life * (0.6 + Math.random() * 0.8);
    L.life[i] = L.maxLife[i];

    // A fibre is a sliver and a chip is a speck. The aspect ratio is the whole
    // difference between "linen came off that" and "sparks came off that".
    const fibre = Math.random() < o.fibre;
    const s = o.size * (0.6 + Math.random() * 0.9);
    L.w0[i] = fibre ? s * 0.22 : s;
    L.h0[i] = fibre ? s * 3.4 : s;
    L.grow[i] = 0;
    L.grav[i] = o.grav;
    L.drag[i] = o.drag;
    L.roll[i] = Math.random() * 6.283;
    L.rollV[i] = (Math.random() - 0.5) * (fibre ? 22 : 9);
    L.a0[i] = o.alpha;
    L.parked[i] = 0;

    colour.setHex(pick(o.palette));
    L.mesh.setColorAt(i, colour);
  }

  function flushColours() {
    if (dust.mesh.instanceColor) dust.mesh.instanceColor.needsUpdate = true;
    if (grit.mesh.instanceColor) grit.mesh.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // the bursts
  // ---------------------------------------------------------------------------

  /**
   * The linen burst. Every hit on a wrapped body, from either entry point.
   *
   * `scale` is 1 for a body hit and rises for a head hit; the head burst adds a
   * bone component on top rather than replacing this, so the two read as the
   * same material struck two ways rather than as two different creatures.
   */
  function linenBurst(x, y, z) {
    // The bloom. Full size on the frame of the hit and gone in a seventh of a
    // second - this is the part that is legible at twenty-five metres, where the
    // individual fragments are under a pixel and the drifting cloud has not had
    // time to grow yet.
    emitDust(x, y, z, R_LINEN_BLOOM);

    // The cloud. Slow, expanding, two-value, and it is what a player sees when
    // they are looking at the body rather than at the crosshair.
    emitDust(x, y, z, R_LINEN_CLOUD);
    emitDust(x, y, z, R_LINEN_CLOUD);

    // Fibre and wrap grit, thrown back at the shooter.
    for (let i = 0; i < 7; i++) emitGrit(x, y, z, R_LINEN_GRIT);
  }

  // ---------------------------------------------------------------------------
  // public spawn
  // ---------------------------------------------------------------------------

  /**
   * Spawn a burst at a world point.
   *
   * @param {THREE.Vector3} point
   * @param {THREE.Vector3|null} normal  surface normal, honoured only for the
   *                                     surfaces whose callers actually know it
   * @param {string} kind  'stone' | 'sand' | 'metal' | 'flesh'
   */
  function spawn(point, normal, kind = 'stone') {
    const x = point.x, y = point.y, z = point.z;

    if (kind === 'flesh' || kind === 'linen') {
      axisFor(x, y, z, null, 'shooter');
      linenBurst(x, y, z);
      noteLinen(x, y, z);
      flushColours();
      return;
    }

    axisFor(x, y, z, normal, 'normal');

    if (kind === 'metal') {
      emitDust(x, y, z, R_METAL_FLASH);
      for (let i = 0; i < 9; i++) emitGrit(x, y, z, R_METAL_SPARK);
      flushColours();
      return;
    }

    const sand = kind === 'sand';
    emitDust(x, y, z, sand ? R_SAND_BLOOM : R_STONE_BLOOM);
    for (let i = 0; i < 3; i++) emitDust(x, y, z, sand ? R_SAND_CLOUD : R_STONE_CLOUD);
    for (let i = 0; i < 7; i++) emitGrit(x, y, z, sand ? R_SAND_GRIT : R_STONE_GRIT);
    flushColours();
  }

  /**
   * An enemy took a hit, and this one knows WHERE.
   *
   * Kept separate from spawn() because the region is a fact the weapon does not
   * carry into the impact system - it goes to the damage system instead - and
   * because a headshot has to be legible as a headshot BEFORE the number
   * arrives. The economy pays 100 against 60; a player who can only tell the
   * two apart by reading the gold counter has no feedback loop on the one skill
   * the economy rewards.
   *
   * A head hit is the linen burst plus a bone component the body hit never has:
   * bright, fast, narrow, thrown along the line of the shot. Different in KIND
   * rather than merely in quantity, exactly as the two hit sounds already are.
   *
   * IT DOES NOT DOUBLE UP, AND IT DOES NOT DEPEND ON WHO CALLED FIRST. The
   * weapon spawns a region-blind `flesh` burst of its own on the same frame,
   * because a hitscan knows a point and a surface but hands the region to the
   * damage system rather than to this one. Rather than either trusting that call
   * to be there - it is one line in a file this system does not own - or firing
   * a second full burst on top of it, this checks whether a linen burst has
   * already landed at this exact point THIS TICK. If it has, only the head
   * signature is added; if it has not, the base burst is emitted here. Correct
   * either way, and correct if that call is ever removed.
   */
  function spawnEnemyHit(point, region) {
    const x = point.x, y = point.y, z = point.z;
    axisFor(x, y, z, null, 'shooter');

    // THE BASE BURST IS THE SAME FOR BOTH REGIONS. In the shipped path the
    // weapon's region-blind call always lands first, so a "harder burst on a
    // headshot" written on this branch would be in code that never runs - a
    // number that looks load bearing and is not, which is the shape of most of
    // the defects in this project's history. The head's extra weight is added
    // BELOW, on the path that always executes.
    if (!alreadyLinen(x, y, z)) {
      linenBurst(x, y, z);
      noteLinen(x, y, z);
    }

    if (region !== 'head') { flushColours(); return; }

    // The bone. Tight cone, high speed, near-white, and long-lived enough that
    // the eye catches the direction it went.
    for (let i = 0; i < 6; i++) emitGrit(x, y, z, R_BONE_SPRAY);

    // A bright core over the top of the linen cloud, so the burst has a white
    // centre a body hit does not, and one more pale puff so the head cloud is
    // visibly the larger of the two at range.
    emitDust(x, y, z, R_BONE_CORE);
    emitDust(x, y, z, R_BONE_CLOUD);

    flushColours();
  }

  // ---------------------------------------------------------------------------
  // frame
  // ---------------------------------------------------------------------------

  function step(L, dt) {
    let anyAlive = false;
    let touched = false;

    for (let i = 0; i < L.active; i++) {
      if (L.life[i] <= 0) {
        if (!L.parked[i]) {
          L.parked[i] = 1;
          L.alpha.array[i] = 0;
          dummy.position.set(0, -9999, 0);
          dummy.quaternion.set(0, 0, 0, 1);
          dummy.scale.setScalar(0);
          dummy.updateMatrix();
          L.mesh.setMatrixAt(i, dummy.matrix);
          touched = true;
        }
        continue;
      }

      anyAlive = true;
      touched = true;
      L.life[i] -= dt;

      L.vy[i] -= L.grav[i] * dt;

      L.px[i] += L.vx[i] * dt;
      L.py[i] += L.vy[i] * dt;
      L.pz[i] += L.vz[i] * dt;

      // Air drag, so debris decelerates instead of flying forever. Frame-rate
      // independent: the same 1/e is reached in the same number of SECONDS
      // whether the software renderer is giving three frames a second or a GPU
      // is giving three hundred.
      const drag = Math.max(0, 1 - dt * L.drag[i]);
      L.vx[i] *= drag; L.vy[i] *= drag; L.vz[i] *= drag;

      L.roll[i] += L.rollV[i] * dt;

      const t = Math.max(0, L.life[i] / L.maxLife[i]);
      const age = L.maxLife[i] - L.life[i];

      // Grow while fading. A puff that shrank as it faded would read as a thing
      // retreating rather than as a cloud dispersing, and the shrink was also
      // the old system's only fade - which is why nothing it emitted ever got
      // BIGGER than the pixel it started at.
      const w = L.w0[i] + L.grow[i] * age;
      const h = L.h0[i] + L.grow[i] * age;

      // Squared, so the tail of a puff thins out rather than switching off.
      L.alpha.array[i] = L.a0[i] * t * t;

      dummy.position.set(L.px[i], L.py[i], L.pz[i]);
      // Billboard toward the camera so a flat quad never turns edge-on and
      // vanishes, which is the classic particle-sheet artefact. The roll is
      // applied AFTER, about the view axis, so a fibre tumbles in the plane the
      // player is looking at instead of spinning invisibly in depth.
      if (camQuat) dummy.quaternion.copy(camQuat);
      else dummy.quaternion.set(0, 0, 0, 1);
      dummy.rotateZ(L.roll[i]);
      dummy.scale.set(w, h, 1);
      dummy.updateMatrix();
      L.mesh.setMatrixAt(i, dummy.matrix);
    }

    if (touched) {
      L.mesh.instanceMatrix.needsUpdate = true;
      L.alpha.needsUpdate = true;
    }
    L.mesh.visible = anyAlive;
    return anyAlive;
  }

  function update(dt, camera) {
    // One tick per frame. The double-burst guard is scoped to it: two calls
    // about the same impact always arrive inside one frame, because the weapon
    // fires and the damage resolves in the same block of main.js.
    tick++;

    if (camera) {
      camX = camera.position.x;
      camY = camera.position.y;
      camZ = camera.position.z;
      camQuat = camera.quaternion;
    }

    step(dust, dt);
    step(grit, dt);
  }

  /** Live particles, for the harness and the cost budget. */
  function alive() {
    let n = 0;
    for (let i = 0; i < dust.active; i++) if (dust.life[i] > 0) n++;
    for (let i = 0; i < grit.active; i++) if (grit.life[i] > 0) n++;
    return n;
  }

  return {
    // The grit layer keeps the old `mesh` name so anything holding it still
    // resolves; `meshes` is the honest answer now that there are two.
    mesh: grit.mesh,
    meshes: [dust.mesh, grit.mesh],
    spawn,
    spawnEnemyHit,
    update,
    alive,

    setFidelity(high) {
      // The cursor has to wrap at the ACTIVE count, not the pool size. It did
      // not before: on low fidelity every second burst was written into
      // instances above `mesh.count` and never drawn, so half the impacts in
      // the game silently did nothing on exactly the machines that needed the
      // feedback most.
      for (const L of [dust, grit]) {
        const n = high ? L.mesh.geometry.attributes.aAlpha.count
          : Math.floor(L.mesh.geometry.attributes.aAlpha.count / 2);
        L.active = n;
        L.mesh.count = n;
        if (L.cursor >= n) L.cursor = 0;
      }
    },

    dispose() {
      scene.remove(dust.mesh);
      scene.remove(grit.mesh);
      dustGeo.dispose();
      gritGeo.dispose();
      dustMat.dispose();
      gritMat.dispose();
      dustTex.dispose();
      dust.mesh.dispose();
      grit.mesh.dispose();
    },
  };
}
