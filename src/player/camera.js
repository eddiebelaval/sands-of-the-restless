/**
 * Camera controller: mouse look, FOV, shake.
 *
 * Yaw is unbounded, pitch is clamped just short of vertical. Everything that
 * changes over time eases toward a target rather than snapping, because the
 * difference between "snaps to 55 FOV" and "eases to 55 FOV" is the entire
 * difference between a prototype and a game.
 */

import * as THREE from 'three';

const BASE_FOV = 75;
const SPRINT_FOV = 82;
const ADS_FOV = 55;

const PITCH_LIMIT = Math.PI / 2 - 0.02;
const SENSITIVITY = 0.0022;

export function createCameraRig(camera) {
  let yaw = 0;
  let pitch = 0;

  let fov = BASE_FOV;
  let targetFov = BASE_FOV;

  // Recoil is a spring: an impulse displaces it, then it settles. A snap-and-
  // decay looks mechanical; a spring looks like a weapon.
  const recoil = { pitch: 0, yaw: 0, vPitch: 0, vYaw: 0 };

  // Trauma-based shake. Squared falloff so small hits barely register and big
  // ones are unmistakable.
  let trauma = 0;

  const shakeOffset = new THREE.Euler();

  function look(dx, dy, sensitivityScale = 1) {
    yaw -= dx * SENSITIVITY * sensitivityScale;
    pitch -= dy * SENSITIVITY * sensitivityScale;
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  }

  function update(dt, player, ads = false) {
    // --- recoil spring -----------------------------------------------------
    // Critically damped-ish: stiff enough to return fast, damped enough not to
    // oscillate visibly.
    const STIFF = 180, DAMP = 22;
    recoil.vPitch += (-recoil.pitch * STIFF - recoil.vPitch * DAMP) * dt;
    recoil.vYaw   += (-recoil.yaw   * STIFF - recoil.vYaw   * DAMP) * dt;
    recoil.pitch += recoil.vPitch * dt;
    recoil.yaw   += recoil.vYaw   * dt;

    // --- shake -------------------------------------------------------------
    trauma = Math.max(0, trauma - dt * 1.8);
    const shake = trauma * trauma;
    if (shake > 0.0001) {
      const t = performance.now() * 0.001;
      shakeOffset.set(
        Math.sin(t * 47) * shake * 0.055,
        Math.sin(t * 37) * shake * 0.055,
        Math.sin(t * 29) * shake * 0.035
      );
    } else {
      shakeOffset.set(0, 0, 0);
    }

    // --- field of view -----------------------------------------------------
    targetFov = ads ? ADS_FOV
      : player.state.sprinting ? SPRINT_FOV
      : BASE_FOV;

    // ADS snaps in faster than it eases out, which is how it feels in the hand.
    const fovRate = ads ? 14 : 9;
    fov += (targetFov - fov) * Math.min(1, dt * fovRate);

    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    // --- compose -----------------------------------------------------------
    camera.position.copy(player.position);

    // Head bob is applied in view space, so it sways with where you are
    // looking rather than along fixed world axes.
    const bob = player.state.bobOffset;
    camera.position.x += bob.x * Math.cos(yaw);
    camera.position.z += bob.x * -Math.sin(yaw);
    camera.position.y += bob.y;

    camera.rotation.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw + recoil.yaw + shakeOffset.y;
    camera.rotation.x = pitch + recoil.pitch + shakeOffset.x;
    camera.rotation.z = shakeOffset.z;
  }

  return {
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    /**
     * 0 at full ADS, 1 at hip. CLAMPED, and the clamp is the whole point.
     *
     * main.js scales mouse sensitivity by this, and sprinting widens the FOV to
     * 82 - PAST BASE_FOV - so unclamped this returned 1.35 and made the player
     * 23% more sensitive while sprinting. Worse than a static offset: the FOV
     * EASES at rate 9, so every sprint start and stop ramped the gain between
     * 1.00 and 1.23 over roughly 400ms. The mouse changed sensitivity under the
     * player's hand several times a minute, which reads as drift or lag rather
     * than as a setting, because nothing on screen says it happened.
     *
     * Sensitivity should track ZOOM and nothing else. At 55 FOV the same
     * angular movement covers more screen, so finer control is correct and
     * physically motivated. A wider sprint FOV is a speed effect and has no
     * business touching aim.
     */
    get fovNormalized() {
      return Math.max(0, Math.min(1, (fov - ADS_FOV) / (BASE_FOV - ADS_FOV)));
    },

    look,
    update,

    /** Kick the camera. Called by the weapon system on each shot. */
    kick(pitchAmount, yawAmount = 0) {
      recoil.vPitch += pitchAmount;
      recoil.vYaw += yawAmount;
    },

    /** Add shake. 0..1, accumulates and decays. */
    addTrauma(n) {
      trauma = Math.min(1, trauma + n);
    },

    reset(y = 0, p = 0) {
      yaw = y; pitch = p;
      recoil.pitch = recoil.yaw = recoil.vPitch = recoil.vYaw = 0;
      trauma = 0;
    },
  };
}

export const CAMERA_CONSTANTS = { BASE_FOV, SPRINT_FOV, ADS_FOV };
