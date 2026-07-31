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

/**
 * THE TWO NUMBERS THAT ARE NOW RATIOS RATHER THAN ABSOLUTES, and this is the
 * whole of the settings panel's interaction with this file.
 *
 * The moment BASE_FOV became a slider, ADS_FOV and SPRINT_FOV stopped being
 * meaningful as constants, for two separate reasons:
 *
 *   ADS_FOV, because `fovNormalized` divides by (BASE_FOV - ADS_FOV). At a
 *   chosen base of 55 that denominator is ZERO and mouse sensitivity becomes
 *   NaN; below 55 it is negative and the whole scale INVERTS, so aiming down a
 *   sight would make the mouse faster instead of slower. And even where the
 *   arithmetic survives, a fixed 55 means the ACTUAL MAGNIFICATION of aiming
 *   changes with a slider that is not labelled magnification: 75->55 is 1.36x,
 *   100->55 is 1.82x, 60->55 is 1.09x - the same right mouse button, doing
 *   three different things, because the player widened their view.
 *
 *   SPRINT_FOV, because 82 is +7 over a base of 75 and means nothing anywhere
 *   else. At a chosen base of 100 a fixed 82 would NARROW the view while
 *   sprinting, which is the speed cue running backwards; at 60 it would be a
 *   37 per cent widening, which is a lurch.
 *
 * So both are kept as RATIOS off whatever base the player has chosen. Aiming is
 * a fixed 1.36x zoom and sprinting a fixed 9.3 per cent widening at every FOV,
 * which is what those two effects have always been AT THE DEFAULT - the numbers
 * below are derived from the shipped constants above rather than picked, so
 * nothing about the default 75 changes by a single degree.
 *
 * The denominator is then baseFov * (1 - 1/adsZoom), which is strictly positive
 * for any adsZoom > 1 and any baseFov > 0. It cannot divide by zero and it
 * cannot invert.
 */
const ADS_ZOOM = BASE_FOV / ADS_FOV;        // 1.3636...
const SPRINT_WIDEN = SPRINT_FOV / BASE_FOV; // 1.0933...

/** What the slider may ask for. Below 55 used to be arithmetically fatal. */
const FOV_MIN = 60;
const FOV_MAX = 110;

/** How far aiming may zoom. 1.0 would make ADS a no-op and the span zero. */
const ADS_ZOOM_MIN = 1.05;
const ADS_ZOOM_MAX = 2.50;

const PITCH_LIMIT = Math.PI / 2 - 0.02;
const SENSITIVITY = 0.0022;

/**
 * ---------------------------------------------------------------------------
 * THE DEATH POSE
 * ---------------------------------------------------------------------------
 *
 * A first-person camera has no body, which is exactly why a cut to a death
 * screen reads as the game being switched off rather than as the player being
 * killed. The fix is not a fade: it is to make the camera behave for one second
 * like a thing that has stopped holding itself up.
 *
 * Three components, and all three are what a body does, not what a camera does:
 *
 *   THE DROP. The eye falls 1.25 m, from standing to a head on the sand. Fast
 *   at the start and slow at the end, because knees give way before a body
 *   lands - a symmetrical ease reads as a lift descending.
 *
 *   THE ROLL. 0.95 rad, about 54 degrees, to one side. This is the single most
 *   important of the three and the one a "camera lowers" implementation always
 *   misses: a body that falls does not stay level, and a level horizon at ankle
 *   height reads as crouching.
 *
 *   THE SETTLE. One damped oscillation on top of both, so the head arrives,
 *   rebounds slightly, and stops. Without it the motion ends on a hard clamp,
 *   which is the tell that a number was lerped to a target.
 *
 * Plus the field of view widening eight per cent across the fall, slowly. The
 * world getting further away is a cheap effect and it is the right one here.
 *
 * WHICH SIDE the body falls to is chosen once, at startDeath(), and alternates
 * rather than randomising: two deaths in a row that fall the same way read as a
 * canned animation, and Math.random() would occasionally give you three.
 *
 * DELTA-TIME. `death.t` accumulates the CLAMPED simulation delta handed to
 * update(), the same clock the horde and the fuses run on, so a machine dropping
 * 50 ms frames plays every part of this arc across twenty frames instead of
 * sixty. A frame-counted fall would finish in a third of a second precisely when
 * the machine was least able to draw it.
 */
const DEATH_FALL = 1.00;
const DEATH_DROP = 1.25;
const DEATH_ROLL = 0.95;
const DEATH_PITCH = 0.30;
const DEATH_YAW = 0.14;
const DEATH_FOV_WIDEN = 1.08;

/** What the sensitivity slider multiplies. 1.0 is the shipped feel. */
const SENS_MIN = 0.20;
const SENS_MAX = 3.00;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createCameraRig(camera) {
  let yaw = 0;
  let pitch = 0;

  // --- live settings --------------------------------------------------------
  // In memory for the session, deliberately. See STATE.md and the README: this
  // project has a standing "no browser storage" constraint, so a setting is
  // a property of the run and not of the machine.

  let baseFov = BASE_FOV;
  let adsZoom = ADS_ZOOM;
  let sensitivity = SENSITIVITY;
  /** +1 normal, -1 inverted. Multiplied into the pitch term only. */
  let invert = 1;

  let fov = BASE_FOV;
  let targetFov = BASE_FOV;

  // Recoil is a spring: an impulse displaces it, then it settles. A snap-and-
  // decay looks mechanical; a spring looks like a weapon.
  const recoil = { pitch: 0, yaw: 0, vPitch: 0, vYaw: 0 };

  // Trauma-based shake. Squared falloff so small hits barely register and big
  // ones are unmistakable.
  let trauma = 0;

  const shakeOffset = new THREE.Euler();

  // The death pose. Plain numbers on the closure, written in place every frame,
  // so the sequence allocates nothing at all - which matters because it runs on
  // the frames immediately after twenty-four actors and a horde were on screen.
  const death = { active: false, t: 0, side: 1 };
  let dEase = 0;      // 0..1 progress along the fall, eased
  let dDrop = 0;      // metres the eye has fallen
  let dRoll = 0;      // radians of roll
  let dPitch = 0;     // radians added to pitch
  let dYaw = 0;       // radians added to yaw
  let deaths = 0;     // which way the last body fell; see DEATH_ROLL

  function look(dx, dy, sensitivityScale = 1) {
    yaw -= dx * sensitivity * sensitivityScale;
    // Invert acts on the vertical only, which is what "invert look" has meant
    // in every flight and shooter menu since it was a hardware switch.
    pitch -= dy * sensitivity * sensitivityScale * invert;
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  }

  /** The FOV aiming eases to, derived. Never an independent number. */
  const adsFov = () => baseFov / adsZoom;
  /** The FOV sprinting eases to, derived, and capped inside the slider's range. */
  const sprintFov = () => Math.min(FOV_MAX + 8, baseFov * SPRINT_WIDEN);

  /**
   * Commit `fov` to the camera.
   *
   * `force` exists for the slider: the 0.01 guard is there so a frame loop does
   * not rebuild the projection matrix sixty times a second over a rounding
   * error, and a player dragging a slider by one degree is not that.
   */
  function applyFov(force = false) {
    if (!force && Math.abs(camera.fov - fov) <= 0.01) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
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

    // --- the death pose ----------------------------------------------------
    // Before the FOV, because it overrides the target, and before the compose
    // below, which reads the four offsets.
    if (death.active) {
      death.t = Math.min(DEATH_FALL, death.t + dt);
      const p = death.t / DEATH_FALL;

      // Fast out of the gate, slow into the sand.
      dEase = 1 - Math.pow(1 - p, 2.6);

      // One damped bounce. Zero at p = 0 and effectively zero by p = 1, so it
      // adds a landing and never a wobble on the way down.
      const settle = Math.sin(p * Math.PI * 2.2) * Math.exp(-p * 5.0);

      dDrop  = DEATH_DROP  * (dEase - settle * 0.085);
      dRoll  = DEATH_ROLL  * (dEase + settle * 0.10) * death.side;
      dPitch = DEATH_PITCH * (dEase + settle * 0.14);
      dYaw   = DEATH_YAW   * dEase * death.side;
    }

    // --- field of view -----------------------------------------------------
    targetFov = death.active ? baseFov * DEATH_FOV_WIDEN
      : ads ? adsFov()
      : player.state.sprinting ? sprintFov()
      : baseFov;

    // ADS snaps in faster than it eases out, which is how it feels in the hand.
    // The death widen is slower than either: it is the world receding, not a
    // sight coming up.
    const fovRate = death.active ? 2.2 : ads ? 14 : 9;
    fov += (targetFov - fov) * Math.min(1, dt * fovRate);

    applyFov();

    // --- compose -----------------------------------------------------------
    camera.position.copy(player.position);

    // Head bob is applied in view space, so it sways with where you are
    // looking rather than along fixed world axes. It is faded out across the
    // fall: a walk cycle still swaying on a body that has stopped walking is
    // the one detail that would undo the whole pose.
    const bob = player.state.bobOffset;
    const bobK = 1 - dEase;
    camera.position.x += bob.x * Math.cos(yaw) * bobK;
    camera.position.z += bob.x * -Math.sin(yaw) * bobK;
    camera.position.y += bob.y * bobK;
    camera.position.y -= dDrop;

    camera.rotation.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw + recoil.yaw + shakeOffset.y + dYaw;
    camera.rotation.x = pitch + recoil.pitch + shakeOffset.x + dPitch;
    camera.rotation.z = shakeOffset.z + dRoll;
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
     *
     * THE DENOMINATOR IS NOW DERIVED, and that is the second half of the same
     * bug. It used to be the literal (BASE_FOV - ADS_FOV) = 20; with a base the
     * player can move it is baseFov * (1 - 1/adsZoom), which is the same 20 at
     * the shipped 75 and is strictly positive everywhere else. A slider at 55
     * would have divided by zero and a slider below it would have inverted the
     * scale - the mouse getting FASTER as the sight came up. See the note at
     * ADS_ZOOM above.
     */
    get fovNormalized() {
      const near = adsFov();
      const span = baseFov - near;
      if (!(span > 1e-6)) return 1;
      return Math.max(0, Math.min(1, (fov - near) / span));
    },

    look,
    update,

    // --- settings -----------------------------------------------------------
    //
    // Read and written by ui/pause.js. Every one of them is a live value the
    // frame loop already reads, so there is nothing to push and nothing to
    // recompute: setting it IS applying it.

    get sensitivity() { return sensitivity; },
    /** @param {number} mult 0.20..3.00, against the shipped 0.0022. */
    setSensitivityScale(mult) {
      const m = clamp(Number(mult) || 0, SENS_MIN, SENS_MAX);
      sensitivity = SENSITIVITY * m;
      return m;
    },
    get sensitivityScale() { return sensitivity / SENSITIVITY; },

    get invertY() { return invert < 0; },
    setInvertY(on) { invert = on ? -1 : 1; return invert < 0; },

    get baseFov() { return baseFov; },
    get adsFov() { return adsFov(); },
    get sprintFov() { return sprintFov(); },
    get fov() { return fov; },

    /**
     * Move the field of view, in degrees, and show it immediately.
     *
     * The current fov is scaled by the SAME ratio rather than left to ease in,
     * for two reasons. A player dragging this slider expects the view to move
     * under the drag - a 300ms ease at rate 9 reads as the slider being broken,
     * and under software rendering that ease takes several seconds of wall
     * clock. And scaling rather than assigning keeps whatever zoom state the
     * player is in: drag the slider while aiming and the sight stays at the
     * same magnification, because adsFov and sprintFov are ratios of this.
     */
    setBaseFov(deg) {
      const next = clamp(Number(deg) || baseFov, FOV_MIN, FOV_MAX);
      if (Math.abs(next - baseFov) < 1e-6) return baseFov;
      const k = next / baseFov;
      baseFov = next;
      fov *= k;
      targetFov *= k;
      applyFov(true);
      return baseFov;
    },

    get adsZoom() { return adsZoom; },
    setAdsZoom(x) {
      adsZoom = clamp(Number(x) || adsZoom, ADS_ZOOM_MIN, ADS_ZOOM_MAX);
      return adsZoom;
    },

    /** Kick the camera. Called by the weapon system on each shot. */
    kick(pitchAmount, yawAmount = 0) {
      recoil.vPitch += pitchAmount;
      recoil.vYaw += yawAmount;
    },

    /** Add shake. 0..1, accumulates and decays. */
    addTrauma(n) {
      trauma = Math.min(1, trauma + n);
    },

    // --- dying ---------------------------------------------------------------
    //
    // Started by ui/death.js at the moment the player goes down and ended when
    // the run restarts. The rig owns the POSE and nothing else: it does not know
    // what a death card is, it does not stop the simulation, and it does not
    // decide when to let go.

    /** The body stops holding itself up. See THE DEATH POSE above. */
    startDeath() {
      if (death.active) return;
      death.active = true;
      death.t = 0;
      // Alternating rather than random: two identical falls in a row read as a
      // canned animation, and random gives you three about one time in eight.
      death.side = (deaths++ % 2) ? -1 : 1;
    },

    /** Stand back up. Instant, because the card is still over the screen. */
    endDeath() {
      death.active = false;
      death.t = 0;
      dEase = dDrop = dRoll = dPitch = dYaw = 0;
      trauma = 0;
      fov = baseFov;
      targetFov = baseFov;
      applyFov(true);
    },

    get dying() { return death.active; },

    /**
     * 0..1 along the fall, EASED - not raw time.
     *
     * ui/death.js drives the weapon out of frame off this so the gun and the
     * head move on one curve. Handing out the eased value rather than the clock
     * is what makes that true; two separate easings of the same duration is two
     * animations that happen to finish together.
     */
    get deathProgress() { return dEase; },

    reset(y = 0, p = 0) {
      yaw = y; pitch = p;
      recoil.pitch = recoil.yaw = recoil.vPitch = recoil.vYaw = 0;
      trauma = 0;
      death.active = false;
      death.t = 0;
      dEase = dDrop = dRoll = dPitch = dYaw = 0;
    },
  };
}

export const CAMERA_CONSTANTS = {
  BASE_FOV, SPRINT_FOV, ADS_FOV,
  ADS_ZOOM, SPRINT_WIDEN,
  FOV_MIN, FOV_MAX,
  ADS_ZOOM_MIN, ADS_ZOOM_MAX,
  SENSITIVITY, SENS_MIN, SENS_MAX,
};
