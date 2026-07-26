/**
 * Bullet impacts: dust bursts, sparks, and hitmarkers.
 *
 * Without these, firing at scenery produces a sound and nothing else, and the
 * weapon reads as a prop rather than a tool. The feedback loop of "I pulled the
 * trigger and the world reacted there" is most of what makes shooting feel
 * good, and it matters more than the damage number.
 *
 * Everything is pooled and allocated once. Spawning geometry inside the fire
 * path of an 900 rpm weapon is how a smooth game turns into a stuttering one.
 */

import * as THREE from 'three';

const POOL = 48;            // simultaneous impact bursts
const PARTICLES = 10;       // per burst

export function createImpacts(scene) {
  // One InstancedMesh for every particle of every burst. A single draw call
  // covers all of them regardless of how many are alive.
  const total = POOL * PARTICLES;

  const geo = new THREE.PlaneGeometry(0.055, 0.055);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xd9c5a0,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, total);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = total;
  scene.add(mesh);

  if (!mesh.instanceColor) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(total * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }

  // Flat parallel arrays rather than an array of objects: no allocation, no
  // pointer chasing, and the whole simulation is one tight loop.
  const px = new Float32Array(total);
  const py = new Float32Array(total);
  const pz = new Float32Array(total);
  const vx = new Float32Array(total);
  const vy = new Float32Array(total);
  const vz = new Float32Array(total);
  const life = new Float32Array(total);     // seconds remaining
  const maxLife = new Float32Array(total);
  const size = new Float32Array(total);

  let cursor = 0;

  const dummy = new THREE.Object3D();
  const colour = new THREE.Color();

  const PALETTE = {
    stone: { c: 0xd8c8a6, spread: 2.6, life: 0.55, grav: 5.5, size: 1.0 },
    flesh: { c: 0x7a1f18, spread: 2.2, life: 0.42, grav: 6.5, size: 0.85 },
    metal: { c: 0xffd08a, spread: 3.4, life: 0.28, grav: 8.0, size: 0.6 },
    sand:  { c: 0xe4d3ac, spread: 1.9, life: 0.70, grav: 4.5, size: 1.25 },
  };

  /**
   * Spawn a burst at a world point.
   *
   * @param {THREE.Vector3} point
   * @param {THREE.Vector3} normal  surface normal; particles bias along it
   * @param {string} kind  key into PALETTE
   */
  function spawn(point, normal, kind = 'stone') {
    const p = PALETTE[kind] || PALETTE.stone;
    colour.setHex(p.c);

    // The normal can be missing when a raycast hits a geometry without faces.
    const nx = normal ? normal.x : 0;
    const ny = normal ? normal.y : 1;
    const nz = normal ? normal.z : 0;

    for (let i = 0; i < PARTICLES; i++) {
      const s = cursor;
      cursor = (cursor + 1) % total;

      px[s] = point.x;
      py[s] = point.y;
      pz[s] = point.z;

      // Hemisphere around the surface normal, so debris comes off the surface
      // rather than through it.
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      const jx = Math.cos(a) * r;
      const jy = Math.sin(a) * r;

      vx[s] = (nx * 1.4 + jx) * p.spread * (0.4 + Math.random() * 0.8);
      vy[s] = (ny * 1.4 + jy + 0.6) * p.spread * (0.4 + Math.random() * 0.8);
      vz[s] = (nz * 1.4 + jx * 0.7) * p.spread * (0.4 + Math.random() * 0.8);

      maxLife[s] = p.life * (0.7 + Math.random() * 0.6);
      life[s] = maxLife[s];
      size[s] = p.size * (0.6 + Math.random() * 0.9);

      mesh.setColorAt(s, colour);
    }

    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function update(dt, camera) {
    let anyAlive = false;

    for (let i = 0; i < total; i++) {
      if (life[i] <= 0) {
        // Park dead instances at zero scale rather than shrinking the count,
        // because the pool is a ring buffer and holes are not contiguous.
        dummy.position.set(0, -9999, 0);
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      anyAlive = true;
      life[i] -= dt;

      const p = PALETTE.stone;
      vy[i] -= p.grav * dt;

      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      pz[i] += vz[i] * dt;

      // Air drag, so debris decelerates instead of flying forever.
      const drag = Math.max(0, 1 - dt * 2.4);
      vx[i] *= drag; vy[i] *= drag; vz[i] *= drag;

      const t = Math.max(0, life[i] / maxLife[i]);

      dummy.position.set(px[i], py[i], pz[i]);
      // Billboard toward the camera so a flat quad never turns edge-on and
      // vanishes, which is the classic particle-sheet artefact.
      if (camera) dummy.quaternion.copy(camera.quaternion);
      dummy.scale.setScalar(size[i] * t);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = anyAlive;
  }

  return {
    mesh,
    spawn,
    update,

    setFidelity(high) {
      mesh.count = high ? total : Math.floor(total / 2);
    },

    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
