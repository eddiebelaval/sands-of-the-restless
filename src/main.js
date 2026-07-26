/**
 * SANDS OF THE RESTLESS
 * Boot, frame loop, and system wiring.
 *
 * M1 scope: stage, post chain, procedural materials, the courtyard, and a
 * player who can walk around it. Weapons, enemies, the interior, the economy,
 * and audio land in later milestones.
 */

import * as THREE from 'three';

import { createRenderer, bindResize } from './core/renderer.js';
import { createPost } from './core/post.js';
import { createInput } from './core/input.js';
import { createSky } from './world/sky.js';
import { buildCourtyard } from './world/courtyard.js';
import { buildMaterials, applyFidelity, upgradeMaterials } from './world/materials.js';
import { loadAssets } from './world/assets.js';
import { createPlayer } from './player/controller.js';
import { createCameraRig } from './player/camera.js';
import { createViewmodel } from './player/viewmodel.js';
import { createWeapons, SLOTS } from './player/weapons.js';
import { createImpacts } from './systems/impacts.js';
import { createAudio } from './core/audio.js';
import { createSpaces } from './systems/spaces.js';
import { createEconomy } from './systems/economy.js';
import { createDoors } from './systems/doors.js';

// A single frame can never advance the simulation by more than this. A tab
// that was backgrounded for a minute comes back with an enormous delta, and
// without this clamp the player is instantly on the other side of the map.
const MAX_DELTA = 1 / 20;

function boot() {
  const canvas = document.getElementById('stage');
  const veil = document.getElementById('veil');
  const hud = document.getElementById('hud');
  const beginBtn = document.getElementById('begin');
  const notice = document.getElementById('notice');
  const fpsEl = document.getElementById('fps');

  // -------------------------------------------------------------------------
  // stage
  // -------------------------------------------------------------------------

  const renderer = createRenderer(canvas);

  const scene = new THREE.Scene();
  // No scene.fog. Atmospheric perspective is done by the height fog PASS in
  // core/fog.js, which has a per-channel extinction tint so distance loses red
  // first and the far field goes cool rather than beige.
  //
  // Running both would double-fog: FogExp2 washes geometry to beige inside the
  // material, and the pass would then extinct already-beige pixels toward blue,
  // landing distance on desaturated mud with nothing left for the tint to act on.

  const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.05, 1200);

  buildMaterials();

  const sky = createSky(scene);
  const courtyard = buildCourtyard(scene);

  // Two worlds, one `world` handle. The router rewrites its fields when the
  // player crosses the doorway, so nothing downstream needs to know there is
  // more than one space. See systems/spaces.js.
  const spaces = createSpaces({ scene, courtyard, sky });
  const world = spaces.world;

  const post = createPost(renderer, scene, camera);
  bindResize(renderer, camera, post.composer);

  const player = createPlayer(world);
  const rig = createCameraRig(camera);
  const input = createInput(canvas);

  // --- combat ---------------------------------------------------------------
  // The raycast needs an explicit target list. Handing it the whole scene would
  // test the sky dome and the dust cloud on every pellet. The router owns
  // world.hitTargets and repoints it at whichever space is live.

  const audio = createAudio();
  const impacts = createImpacts(scene);
  const viewmodel = createViewmodel(rig, buildMaterials());

  const weapons = createWeapons({
    camera, viewmodel, rig, audio, world, impacts,
  });

  viewmodel.equip('mk9');

  // Draw the weapon inside the post chain rather than over the finished frame,
  // so it receives the same bloom, grade, and anti-aliasing as the world.
  post.setViewmodel(viewmodel);

  // Everything is owned from the start while there is no economy to buy with.
  // M4 removes this and makes the wall buys and the mystery box the only way in.
  for (const id of SLOTS) weapons.state.owned.add(id);

  // --- economy and doors ----------------------------------------------------

  const goldEl = document.querySelector('[data-gold]');

  const economy = createEconomy({ popups: document.getElementById('gold-pops') });
  economy.subscribe((gold) => { goldEl.textContent = gold; });

  const doors = createDoors({
    scene, camera, player, economy, audio, spaces,
    interior: spaces.interior,
    courtyard,
    prompt: document.getElementById('prompt'),
    notice: (text, ms) => showNotice(text, ms),
  });

  // The router needs these three, and none of them can exist before it does:
  // the player is constructed FROM world, and the audio context is illegal
  // outside a user gesture.
  spaces.attach({ player, rig, audio });

  // -------------------------------------------------------------------------
  // assets
  // -------------------------------------------------------------------------

  // The game is fully playable on the procedural path before this resolves.
  // Loading upgrades the look in place rather than gating the boot on a
  // network round trip, so a slow connection costs fidelity, never the game.
  const loadStatus = document.getElementById('load-status');
  const loadBar = document.getElementById('load-bar');

  loadAssets(renderer, (frac, label) => {
    if (loadBar) loadBar.style.width = `${Math.round(frac * 100)}%`;
    if (loadStatus) loadStatus.textContent = label;
  }).then(({ env, sets, failed }) => {
    if (env) {
      scene.environment = env;

      // An HDRI adds a full hemisphere of light. Leaving the direct lights
      // where they were double-counts illumination: the frame goes pale, the
      // shadows wash out, and the geometry flattens. Every one of these comes
      // down together, and the sun comes down MOST, because the environment
      // already carries the sun disc that lit the plate.
      // Environment is FILL, not key. At 0.62 it was filling the shadows as
      // brightly as the sun was lighting the lit faces, so cast shadows
      // vanished and the scene went flat. Desert noon is brutal contrast:
      // the sun must dominate and the sky must only lift the shadows.
      scene.environmentIntensity = 0.34;
      sky.hemi.intensity = 0.0;      // the environment IS the sky bounce now
      sky.ambient.intensity = 0.0;   // and it is directional, unlike ambient
      sky.bounce.intensity = 0.30;
      sky.sun.intensity = 2.85;

      // Contrast has to be pushed back in after the exposure drop, or the
      // scene reads correctly lit but lifeless.
      renderer.toneMappingExposure = 0.98;
      post.grade.uniforms.uContrast.value = 1.18;
      post.grade.uniforms.uSaturation.value = 1.10;

      // The viewmodel is lit as a foreground element, but by the SAME desert it
      // stands in. Its own three-point studio was authored cool and neutral, so
      // the gun rendered navy in an amber world and read as pasted on. The
      // studio now only fills; the environment does the character.
      viewmodel.scene.environment = env;
      // 1.15 made the gun BLUE, not bright. Gunmetal at metalness 0.90 is a
      // mirror, and the environment it mirrors is a clear blue sky, so raising
      // this drives saturation rather than luminance. The studio lights below
      // carry the exposure; the environment only needs to supply the sense
      // that the weapon is in the same place as the world.
      viewmodel.scene.environmentIntensity = 0.45;

      // Warm and dim the authored studio so it stops fighting the sun.
      viewmodel.scene.traverse((o) => {
        if (!o.isLight) return;
        if (o.isAmbientLight) { o.intensity *= 0.55; o.color.setHex(0x9c8a6e); return; }
        o.intensity *= 0.95;
        o.color.lerp(new THREE.Color(0xffdca8), 0.85);
      });
    }

    upgradeMaterials(sets);
    applyFidelity(buildMaterials(), high);

    if (loadStatus) {
      loadStatus.textContent = failed.length
        ? `${failed.length} asset(s) unavailable - running procedural`
        : '';
    }
    if (loadBar) loadBar.parentElement.style.opacity = '0';

    // Report rather than swallow: a silent fallback to procedural is exactly
    // the kind of degradation nobody notices until the screenshots look wrong.
    if (failed.length) console.warn('[assets] failed:', failed);
    window.__SANDS__ && (window.__SANDS__.assetsFailed = failed);
  });

  // Face the pyramid on spawn. Forward is (-sin yaw, 0, -cos yaw), so yaw 0
  // looks down -Z, which is where the pyramid is.
  rig.reset(0, -0.03);
  rig.update(0, player, false);
  sky.track(camera);
  sky.follow(player.position);

  // -------------------------------------------------------------------------
  // fidelity
  // -------------------------------------------------------------------------

  let high = true;
  const btnHigh = document.getElementById('fid-high');
  const btnLow = document.getElementById('fid-low');

  function setFidelity(next) {
    high = next;
    post.setFidelity(high);
    sky.setFidelity(high);
    world.setFidelity(high);
    applyFidelity(buildMaterials(), high);
    viewmodel.setFidelity(high);
    impacts.setFidelity(high);
    audio.setFidelity(high);
    renderer.shadowMap.enabled = high;
    renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 2) : 1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.composer.setSize(window.innerWidth, window.innerHeight);

    btnHigh.setAttribute('aria-pressed', String(high));
    btnLow.setAttribute('aria-pressed', String(!high));
  }

  btnHigh.addEventListener('click', () => setFidelity(true));
  btnLow.addEventListener('click', () => setFidelity(false));
  setFidelity(true);

  // -------------------------------------------------------------------------
  // entering the game
  // -------------------------------------------------------------------------

  let started = false;

  function start() {
    if (started) return;
    started = true;

    veil.hidden = true;
    hud.hidden = false;
    input.engage();

    // Browsers refuse to create an AudioContext outside a user gesture, so
    // this is the only moment audio can legally come up.
    audio.resume();
    audio.setSpace('exterior');
    // 'courtyard', not 'exterior'. startAmbience falls back to 'chamber' on an
    // unknown profile RATHER than throwing, so this failed silently and the
    // open desert has been playing sealed-room ambience since it was wired.
    // A forgiving default turns a typo into a bug with no symptom in any log.
    audio.startAmbience('courtyard');

    // If pointer lock was denied, say so rather than leaving the player
    // wondering why the mouse feels wrong.
    setTimeout(() => {
      if (input.state.fallback) {
        showNotice('Pointer lock unavailable - hold a mouse button to look', 4200);
      }
    }, 600);
  }

  // --- weapon bindings -----------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (!started) return;

    if (e.code === 'KeyR') { weapons.reload(); return; }
    if (e.code === 'KeyV') { viewmodel.inspect(); return; }
    if (e.code === 'KeyF') { doors.interact(); return; }

    // Digit1..Digit7 select a weapon directly.
    const n = /^Digit([1-7])$/.exec(e.code);
    if (n) weapons.equip(SLOTS[Number(n[1]) - 1]);
  });

  window.addEventListener('wheel', (e) => {
    if (!started) return;
    weapons.cycle(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  beginBtn.addEventListener('click', start);
  window.addEventListener('keydown', (e) => {
    if (!started && (e.code === 'Enter' || e.code === 'Space')) start();
  });

  // Re-acquire lock after Esc, without going back through the title card.
  canvas.addEventListener('click', () => {
    if (started && !input.state.locked && !input.state.fallback) input.engage();
  });

  let noticeTimer = 0;
  function showNotice(text, ms = 2000) {
    notice.textContent = text;
    notice.classList.add('on');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice.classList.remove('on'), ms);
  }

  // -------------------------------------------------------------------------
  // frame loop
  // -------------------------------------------------------------------------

  // Own clock rather than THREE.Clock, which is deprecated in current three.js
  // and whose replacement is not present in this release's addon tree.
  let last = performance.now();
  let elapsed = 0;

  // FPS readout, averaged over a window so it is readable rather than jittery.
  let frames = 0, fpsAccum = 0;

  const healthEl = document.querySelector('[data-health]');
  const ammoEl = document.getElementById('r-ammo');
  const magEl = document.querySelector('[data-mag]');
  const reserveEl = document.querySelector('[data-reserve]');
  const weaponEl = document.querySelector('[data-weapon]');
  const hitmarkerEl = document.getElementById('hitmarker');

  /**
   * Pay the player for a burst of hits.
   *
   * The kill values are wired and waiting: an enemy will tag its own meshes,
   * and the moment one reports that a hit finished it, this awards 'kill' or
   * 'headshot' instead.
   *
   * TEMPORARY, DELETE WITH M5: until enemies exist, a hit on scenery pays the
   * non-lethal rate. Without it the economy is unreachable - the player starts
   * on 500 against a 1000 doorway with nothing in the world that can pay the
   * difference - and a buy-door nobody can afford is indistinguishable from a
   * buy-door that is broken. The line to delete is the `else` branch.
   */
  function payout(hits) {
    for (const h of hits) {
      if (h.enemy) {
        economy.award(h.killed ? (h.region === 'head' ? 'headshot' : 'kill') : 'hit');
      } else {
        economy.award('hit');
      }
    }
  }

  let hitmarkerTimer = 0;
  function showHitmarker(crit) {
    hitmarkerEl.classList.toggle('crit', !!crit);
    hitmarkerEl.classList.remove('fade');
    hitmarkerEl.classList.add('on');
    clearTimeout(hitmarkerTimer);
    hitmarkerTimer = setTimeout(() => {
      hitmarkerEl.classList.remove('on');
      hitmarkerEl.classList.add('fade');
    }, 60);
  }

  function frame() {
    requestAnimationFrame(frame);

    const now = performance.now();
    const raw = (now - last) / 1000;
    last = now;

    const dt = Math.min(raw, MAX_DELTA);
    elapsed += dt;

    let lookDx = 0, lookDy = 0;

    if (started) {
      const look = input.consumeLook();
      lookDx = look.dx; lookDy = look.dy;
      // Sensitivity scales with zoom so aiming does not feel twitchy at 55 FOV.
      rig.look(look.dx, look.dy, 0.35 + 0.65 * rig.fovNormalized);
      player.update(dt, input.state, rig.yaw);
    }

    // Aiming is refused while sprinting, so the two never fight over the pose.
    const ads = input.state.ads && !player.state.sprinting;

    rig.update(dt, player, ads);

    if (started) {
      // Weapons update after the camera, because hitscan rays are cast through
      // the camera and must use this frame's orientation, not last frame's.
      const hits = weapons.update(dt, input.state, ads);
      if (hits && hits.length) {
        showHitmarker(hits.some((h) => h.region === 'head'));
        payout(hits);
      }

      // Doors resolve after the camera too: the prompt is whatever the
      // crosshair is on THIS frame, and a frame of lag on a prompt reads as the
      // prompt being wrong rather than late.
      doors.update(dt);
    }

    viewmodel.update(dt, {
      speed: player.state.speed,
      sprinting: player.state.sprinting,
      ads,
      grounded: player.state.grounded,
      lookDx, lookDy,
    });

    impacts.update(dt, camera);

    sky.track(camera);
    sky.follow(player.position);
    sky.update(dt);                         // drift the cloud field
    post.fog.uniforms.uSunDir.value.copy(sky.sunDir);
    world.update(dt, elapsed);
    spaces.tick();      // holds the sky's lights down while the player is inside
    post.update(dt);
    audio.setListener(camera);

    // The viewmodel is drawn by a pass inside the composer, so one render call
    // covers the whole frame including the weapon.
    post.composer.render(dt);

    // --- readouts ----------------------------------------------------------
    frames++;
    fpsAccum += raw;
    if (fpsAccum >= 0.5) {
      fpsEl.textContent = `${Math.round(frames / fpsAccum)} fps`;
      frames = 0;
      fpsAccum = 0;
    }
    healthEl.textContent = Math.round(player.state.health);

    magEl.textContent = weapons.magazine;
    reserveEl.textContent = weapons.reserve;
    weaponEl.textContent = weapons.STATS[weapons.state.current] ? weapons.state.current.toUpperCase() : '';
    ammoEl.classList.toggle('empty', weapons.magazine === 0);
    ammoEl.classList.toggle('reloading', weapons.isReloading);
  }

  frame();

  // Expose the running game for the headless harness and for console poking.
  window.__SANDS__ = {
    THREE, renderer, scene, camera, post, world, player, rig, input, sky,
    viewmodel, weapons, impacts, audio,
    spaces, economy, doors, courtyard, interior: spaces.interior,
    setFidelity, start,
    get elapsed() { return elapsed; },
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
