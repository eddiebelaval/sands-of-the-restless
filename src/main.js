/**
 * SANDS OF THE RESTLESS
 * Boot, frame loop, and system wiring.
 *
 * M1 scope: stage, post chain, procedural materials, the courtyard, and a
 * player who can walk around it. Weapons, enemies, the interior, the economy,
 * and audio land in later milestones.
 */

import * as THREE from 'three';

import { createRenderer, bindResize, resolutionScale } from './core/renderer.js';
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
import { createCombat } from './systems/damage.js';
import { createMelee } from './systems/melee.js';
import { createDirector } from './enemies/director.js';
import { createPower } from './systems/power.js';
import { createWallBuys } from './systems/wallbuy.js';
import { createMysteryBox } from './systems/mysterybox.js';
import { createShrines } from './systems/shrines.js';
import { createAltar } from './systems/altar.js';
import { createPromptBus } from './ui/prompt.js';
import { createInteracts } from './ui/interact.js';
import {
  createBoonStrip, createReadouts, createPowerStrip, createFlash, createGrenadeReadout,
} from './ui/hud.js';
import { createMinimap } from './ui/minimap.js';
import { createObjectives, createObjectivePanel } from './ui/objective.js';
import { createGrenades } from './systems/grenades.js';
import { createDeath } from './ui/death.js';
import { createPowerups } from './systems/powerups.js';
import { createPauseMenu } from './ui/pause.js';
import { createDifficulty } from './systems/difficulty.js';
import { createStartScreen } from './ui/start.js';

// A single frame can never advance the simulation by more than this. A tab
// that was backgrounded for a minute comes back with an enormous delta, and
// without this clamp the player is instantly on the other side of the map.
const MAX_DELTA = 1 / 20;

/**
 * How much extra ground the Shrine of Shu covers while sprinting, as a fraction
 * of the frame. See the note at the call site: it is a second controller step,
 * not a speed multiplier, so collision stays honest.
 */
const SHU_SPRINT_BONUS = 0.25;

function boot() {
  const canvas = document.getElementById('stage');
  const veil = document.getElementById('veil');
  const hud = document.getElementById('hud');
  const beginBtn = document.getElementById('begin');
  const notice = document.getElementById('notice');

  // Every DOM write the frame loop used to do itself now goes through here.
  // See ui/hud.js: the loop had acquired a dozen element handles and a bar
  // width calculation, none of which is anything a frame loop is about.
  const readouts = createReadouts(document);

  /**
   * THE TERMS OF THE RUN, chosen at the title and fixed for its length.
   *
   * Constructed first because the director and economy both read it below.
   * The director keeps the live object rather than a copied tier, since the
   * player makes the choice after boot but before the first wave.
   */
  const difficulty = createDifficulty();

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

  // The Altar owns the tracer pool an upgraded weapon fires, and it cannot be
  // constructed before the weapons it upgrades. The callback closes over the
  // binding rather than the value, so the weapon is wired to a system that does
  // not exist yet and finds it by the time a round is fired through it.
  let altar = null;

  const weapons = createWeapons({
    camera, viewmodel, rig, audio, world, impacts,
    tracer: (end, id) => altar && altar.tracer(end, id),
  });

  viewmodel.equip('mk9');

  // Draw the weapon inside the post chain rather than over the finished frame,
  // so it receives the same bloom, grade, and anti-aliasing as the world.
  post.setViewmodel(viewmodel);

  // The player starts with the MK9 and nothing else. Every other weapon is
  // bought off a wall, which is what makes gold a currency rather than a key.
  // The bolt rifle and the Sunspear have no wall of their own on purpose: they
  // are the Chest of the Nameless's stock and its only exclusive, so the two
  // strongest weapons in the armoury are luck rather than a price tag any
  // player can walk to. See systems/mysterybox.js.

  // --- economy, doors, and the fixtures -------------------------------------

  const economy = createEconomy({ popups: document.getElementById('gold-pops') });
  economy.subscribe((gold) => readouts.gold(gold));

  // One line of prompt text, two systems that want it. doors.js is handed a
  // channel that answers to textContent and classList.toggle exactly as the
  // element does, so it keeps writing the way it always has and does not have
  // to know anything changed. See ui/prompt.js.
  const promptBus = createPromptBus(document.getElementById('prompt'));

  const doors = createDoors({
    scene, camera, player, economy, audio, spaces,
    interior: spaces.interior,
    courtyard,
    prompt: promptBus.channel('doors', 1),
    notice: (text, ms) => showNotice(text, ms),
  });

  const power = createPower({
    interior: spaces.interior,
    audio,
    notice: (text, ms) => showNotice(text, ms),
  });

  // The viewmodel goes in because the Altar's ritual PRESENTS the weapon it is
  // working on: the thing that sits on the plate for those five seconds is a copy
  // built by viewmodel.buildDisplay(), from the same builders and the same gild
  // map as the gun in the player's hands. See systems/altar.js.
  altar = createAltar({
    scene, camera, weapons, viewmodel, economy, audio,
    notice: (text, ms) => showNotice(text, ms),
  });

  const wallbuys = createWallBuys({
    weapons, economy, audio,
    notice: (text, ms) => showNotice(text, ms),
  });

  const shrines = createShrines({
    weapons, player, economy, audio, power,
    notice: (text, ms) => showNotice(text, ms),
  });

  // The mystery box. Constructed before the interaction layer because that
  // layer only builds targets for slot types it has a handler for, and attached
  // after it because the fixtures come back out of it - the same late binding
  // the shrines and the router use, for the same reason.
  const mysterybox = createMysteryBox({
    weapons, economy, player, audio,
    notice: (text, ms) => showNotice(text, ms),
  });

  const interacts = createInteracts({
    camera,
    interior: spaces.interior,
    spaces,
    prompt: promptBus.channel('fixtures', 2),
    handlers: { wallbuy: wallbuys, shrine: shrines, altar, box: mysterybox },
  });

  shrines.attach(interacts.records);
  mysterybox.attach(interacts.records);
  createBoonStrip(document.getElementById('r-boons'), shrines);

  // The router needs these three, and none of them can exist before it does:
  // the player is constructed FROM world, and the audio context is illegal
  // outside a user gesture.
  spaces.attach({ player, rig, audio });

  // --- the dead -------------------------------------------------------------
  // Combat first, because the director damages the player through it; the
  // director second, because combat's failure path resets the run. The two are
  // mutually dependent and the cycle is closed by attach(), the same late
  // binding the router uses for exactly the same reason.

  const combat = createCombat({
    player, rig, post, audio, impacts,
    notice: (text, ms) => showNotice(text, ms),
  });

  /**
   * The Shrine of Anubis, spliced in front of incoming damage.
   *
   * A free death has to be decided at the exact moment a blow would have been
   * fatal, and the only thing that knows that is systems/damage.js - which does
   * not know shrines exist and should not. Every enemy in the game reaches the
   * player through `ctx.combat.damagePlayer`, a property lookup on this object,
   * so replacing that one property is the whole intercept: nothing calls the
   * original by any other name and nothing else has to change.
   *
   * The blow is CLAMPED rather than cancelled. The player still takes the hit,
   * still gets the camera lurch and the red wash, and is left standing on one
   * point of vitality, at which point the boon is spent and the shrine goes
   * dark. Cancelling it outright would make a fatal swing indistinguishable
   * from a miss, and the whole value of a free death is knowing you used it.
   */
  const takeDamage = combat.damagePlayer;
  combat.damagePlayer = function damagePlayerWithBoons(amount, x, z) {
    const fatal = !combat.state.invulnerable
      && amount > 0
      && player.state.health > 0
      && player.state.health - amount <= 0;

    if (fatal && shrines.has('anubis')) {
      const survivable = Math.max(0, player.state.health - 1);
      const dealt = takeDamage(survivable, x, z);
      shrines.consumeAnubis();
      // Back to full on the far side. Anubis returns the heart; it does not
      // return it in pieces.
      player.heal(player.state.maxHealth);
      return dealt;
    }

    return takeDamage(amount, x, z);
  };

  const director = createDirector({
    scene, world, spaces, audio, player, rig, camera, impacts, combat,
    difficulty,
    notice: (text, ms) => showNotice(text, ms),
  });

  combat.attach({ director });

  /**
   * THE KHOPESH.
   *
   * After the director, because a swing resolves against THIS frame's live
   * actors - the same reason a blast does - and after combat because it damages
   * through combat.applyMelee. Before the grenades only because nothing depends
   * on the order of those two.
   *
   * It is handed `weapons` so a swing can cancel a running reload, and
   * `viewmodel` so the state machine that owns every other animation in the
   * player's hands owns this one too. See systems/melee.js.
   */
  const melee = createMelee({
    camera, player, director, combat, viewmodel, rig, audio, weapons,
  });

  /**
   * Grenades.
   *
   * After the director because a blast measures THIS frame's bodies, and after
   * combat because `combat` here already carries the Anubis intercept on
   * `.damagePlayer` - the module calls it as a property lookup, so the free
   * death covers blowing yourself up. That is deliberate: cooking one off in
   * your hand is the most Anubis-shaped way to die in the game.
   */
  const grenades = createGrenades({
    scene, camera, world, player, rig, audio, impacts,
    combat, economy, director, spaces,
    notice: (text, ms) => showNotice(text, ms),
  });

  /**
   * What the dead drop.
   *
   * After the director, because the Second Death resolves against THIS frame's
   * live actors, and after combat because the roll hangs off combat's kill
   * listener - which is the only seam in the game that knows both that
   * something died and where its body was. It is handed the chest as well,
   * because the Fire Sale is a power-up whose entire effect is a change to the
   * chest, and the chest is the thing that owns whether one is running.
   *
   * `flash` is the full-frame element the Second Death fires; it is a readout,
   * so it comes from the HUD layer and not from a system.
   */
  const powerups = createPowerups({
    scene, world, player, camera, rig, audio,
    economy, weapons, combat, director, mysterybox, spaces,
    notice: (text, ms) => showNotice(text, ms),
    flash: createFlash(document.getElementById('flash')),
  });

  const powerStrip = createPowerStrip(document.getElementById('r-powers'), powerups);

  /**
   * The ordnance readout, and the reason it is constructed HERE.
   *
   * The cap is a constant inside systems/grenades.js and is reported by
   * stats(), so it is read once at wiring time rather than being duplicated as
   * a literal on the HUD - a HUD that says "of four" while the system says five
   * is the kind of disagreement that only shows up in the one screenshot
   * nobody takes. stats() also walks the pools, which is why it is called once
   * and not once a frame; the frame loop uses the cheap getters.
   */
  const grenadeReadout = createGrenadeReadout(document, { max: grenades.stats().max });

  // -------------------------------------------------------------------------
  // where am I, and what next
  // -------------------------------------------------------------------------
  //
  // Both of these READ the systems above and write nothing back to any of them.
  // That is the whole of their contract: they are handed the live objects rather
  // than copies of their state, so nothing has to be pushed at them and they
  // cannot fall out of step; and because they only ever return values, a HUD
  // element in this game cannot break the game it is describing.
  //
  // Built HERE, after the director, rather than up with the rest of the UI,
  // because both want the live actor list and neither is worth a late-binding
  // attach() when moving three lines down the file does the same job.

  // Wall buys and the mystery box are deliberately NOT handed over. The tracker
  // reaches those two through the fixture records the interaction layer already
  // holds, so passing the systems as well would be a second route to the same
  // facts - and the day the two disagreed, the HUD would be the thing that was
  // wrong. One source per fact.
  const objectives = createObjectives({
    spaces, interior: spaces.interior, doors, economy, power, shrines,
    altar, weapons, interacts, director, player,
  });

  const objectivePanel = createObjectivePanel(
    document.getElementById('objective'), objectives);

  const minimap = createMinimap({
    canvas: document.getElementById('map-canvas'),
    roomLabel: document.getElementById('map-room'),
    spaces, interior: spaces.interior, doors, interacts, shrines,
    mysterybox, power, economy, director, rig, player,
  });

  // The map asks the armoury one question - do you own this - and is given a
  // predicate rather than the module, so it cannot reach for anything else.
  minimap.attach({ owns: (id) => weapons.owns(id) });

  // The readouts take the same shape for the same reason: weapon select draws
  // the whole rack, so it needs to know which slots are held and which have been
  // through the Altar, and the ammunition plate wears a lapis inlay while the
  // gun in hand is a renewed one. Three predicates and the slot order, not the
  // armoury - a readout that held `weapons` could change it.
  readouts.attach({
    owns: (id) => weapons.owns(id),
    upgraded: (id) => weapons.isUpgraded(id),
    slots: SLOTS,
  });

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
      // vanished and the scene went flat.
      //
      // 0.34 WAS STILL THE KEY, and it took a knockout test to see it. With the
      // camera on the sand and every ground pixel in the frame sampled:
      //
      //     baseline                groundLuma 175.2
      //     sun off                 groundLuma 174.7
      //     ALL scene lights off    groundLuma 174.5
      //     scene.environment off   groundLuma  14.5
      //
      // Turning off every light in the scene moved the sand by four tenths of
      // one per cent. Turning off the environment took it to nothing. The sand
      // was not being lit by the sun at all; it was being lit by a constant,
      // and a constant has no falloff, no direction, and no shadow, which is
      // the whole of why it read as a near-white flat plane at the same value
      // near and far. It is also why a cast shadow landing on it changed
      // almost nothing: measured, shadowed sand 174 against lit sand 191.
      //
      // The two lines below are the fix and they have to move together. Swept:
      //
      //     env    lit sand   shadowed sand   separation
      //     0.34     205.8        177.7          28
      //     0.22     179.4        142.9          37
      //     0.14     156.2        109.4          48
      //
      // 0.17, and the sun goes up to carry what the environment stops carrying.
      scene.environmentIntensity = 0.17;
      // Not zero any more. With the environment down this far, a shadowed
      // horizontal surface has NO light on it at all: the bounce and both wrap
      // lights are aimed horizontally and contribute cos(90) = 0 to a floor by
      // construction. Small, and cool, so it reads as sky rather than as fill.
      sky.hemi.intensity = 0.15;
      sky.ambient.intensity = 0.02;
      sky.bounce.intensity = 0.34;
      sky.sun.intensity = 3.5;

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
    grenades.setFidelity(high);
    powerups.setFidelity(high);
    director.setFidelity(high);
    altar.setFidelity(high);
    audio.setFidelity(high);
    renderer.shadowMap.enabled = high;
    // High asks for the budgeted ratio rather than the raw device ratio. On a
    // Retina display the old line rendered four times the fragments and took the
    // frame from 60 fps to 7; see resolutionScale() in core/renderer.js for the
    // table. Low still pins 1, so the toggle remains a real lever.
    renderer.setPixelRatio(high ? resolutionScale() : 1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.composer.setSize(window.innerWidth, window.innerHeight);

    btnHigh.setAttribute('aria-pressed', String(high));
    btnLow.setAttribute('aria-pressed', String(!high));
  }

  btnHigh.addEventListener('click', () => setFidelity(true));
  btnLow.addEventListener('click', () => setFidelity(false));
  setFidelity(true);

  // -------------------------------------------------------------------------
  // pause, and the settings panel behind it
  // -------------------------------------------------------------------------
  //
  // The menu decides WHEN the game is stopped. The frame loop below decides
  // what stopping means, and it means the simulation does not advance at all -
  // see the guard at the top of frame(). An overlay over a running game would
  // leave a cooked grenade counting down while the player reads about mouse
  // sensitivity, and the wave director sending into an empty crosshair.

  const pause = createPauseMenu({
    root: document.getElementById('pause'),
    rig,
    audio,
    input,
    // Handed as an accessor pair rather than as the flag, because `high` is a
    // binding in this scope and the panel has to see the value AFTER the corner
    // buttons change it. Both surfaces write through the same function, so the
    // two can never disagree about which fidelity is live.
    fidelity: { get: () => high, set: (v) => setFidelity(!!v) },
    onResume: () => {
      // Settings is also reachable from the title screen, where there is no
      // pointer lock to reacquire yet.
      if (!started) return;

      // NEVER the probing form. input.engage() arms a 400ms timer that declares
      // pointer lock unavailable if it has not engaged, and Chrome refuses a
      // re-lock for about a second after Esc released the last one - so calling
      // engage() here would flip a healthy browser into the iframe fallback and
      // tell the player to hold a mouse button to look for the rest of the
      // session. See input.relock(), which is that decision left alone.
      input.relock();
    },
  });

  /**
   * The title screen reuses the existing settings panel rather than owning a
   * second copy of those controls.
   */
  const startScreen = createStartScreen({
    veil,
    difficulty,
    onSettings: () => pause.open('title'),
  });

  // Keep the corner fidelity buttons and the panel in step. setFidelity is the
  // one writer; this is the panel finding out about a write it did not make.
  btnHigh.addEventListener('click', () => pause.refresh());
  btnLow.addEventListener('click', () => pause.refresh());

  // -------------------------------------------------------------------------
  // dying
  // -------------------------------------------------------------------------
  //
  // Built LAST, because it is the only thing in the file that needs everything:
  // the camera to fall, the viewmodel to drop the weapon out of frame, the
  // director and the power-ups and the Altar to be swept, and the pause menu to
  // know when the keyboard is not its. It reaches combat the same way the
  // director does - through attach(), late, because combat is what constructs
  // the failure path that calls it.
  //
  // The overlay is created in JavaScript rather than declared in index.html, on
  // purpose: another lane owns that file this week.
  const death = createDeath({
    doc: document,
    rig, player, viewmodel, combat, director, powerups, altar, economy,
    input, audio,
    suspended: () => pause.paused,
  });
  combat.attach({ death });

  // -------------------------------------------------------------------------
  // entering the game
  // -------------------------------------------------------------------------

  let started = false;

  function start() {
    if (started) return;
    started = true;

    // Lock the selected curve for this run, seed its starting purse, stamp the
    // choice onto the HUD, and re-arm the first breather from the chosen tier.
    const tier = difficulty.lock();
    economy.reset(tier.startGold);
    startScreen.lockIn();
    director.reset();

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

  /**
   * TELL THEM THE BLADE IS THERE, AT THE ONE MOMENT IT MATTERS.
   *
   * A mechanic nobody knows about is a mechanic that does not exist, and the
   * controls list in the pause menu is not this pass's file to edit. A banner
   * on a five-second timer was the first idea and it is the wrong one twice
   * over: it teaches the player something they have no use for yet, and it
   * teaches it while they are still looking at the pyramid.
   *
   * This fires the first time they are genuinely out - magazine empty, reserve
   * empty, nothing to reload - which is the exact sentence the owner wrote when
   * he asked for this. Once per session, watched off the numbers the HUD is
   * already reading rather than hooked into the weapon.
   */
  let bladeHintShown = false;

  // --- weapon bindings -----------------------------------------------------
  //
  // `pause.paused` as well as `started`, and this listener is the reason
  // input.setSuspended() is not the whole of the freeze. These bindings do not
  // go through core/input.js at all - they read the event directly - so
  // suspending the input layer would leave a paused player still able to
  // reload, inspect, swap weapons and buy whatever the crosshair was left on.
  //
  // `death.halted` joins them for exactly the same reason pause did. These
  // bindings read the raw event, so suspending the input layer does not reach
  // them: without this a player lying on the sand under a death card could
  // still reload, inspect, swap weapons, and - through F - buy a door and walk
  // the run's gold while the run was supposed to be stopped.
  window.addEventListener('keydown', (e) => {
    if (!started || pause.paused || death.halted) return;

    if (e.code === 'KeyR') { weapons.reload(); return; }
    if (e.code === 'KeyV') { viewmodel.inspect(); return; }

    /**
     * Q IS THE BLADE, and the binding is chosen for one property: you can reach
     * it without letting go of W.
     *
     * A melee in this genre is a panic button pressed while running backwards
     * from four bodies with an empty magazine, so the only criterion that
     * matters is whether the left hand can hit it without leaving the movement
     * keys. V is the reference game's bind and is already the inspect flourish
     * here; F is the interact and would buy a door mid-swing; anything on the
     * right of the board means letting go of the mouse.
     *
     * Not routed through core/input.js because none of these bindings are - see
     * the note above this listener. `pause.paused` is checked there for all of
     * them, which is what stops a paused player knifing through the menu.
     */
    if (e.code === 'KeyQ') { melee.swing(); return; }

    // F goes to whatever is under the crosshair, and the two systems that can
    // claim it are arbitrated the SAME WAY the prompt is: a fixture wins over a
    // door. Routing on `candidate` rather than on the return value of
    // interacts.interact() matters - a shrine that refuses returns false, and
    // falling through on false would buy whatever door happened to be behind
    // it. The player would have been refused at one thing and charged for
    // another, in the same keypress.
    if (e.code === 'KeyF') {
      if (interacts.candidate) interacts.interact();
      else doors.interact();
      return;
    }

    // Digit1..Digit7 select a weapon directly.
    const n = /^Digit([1-7])$/.exec(e.code);
    if (n) weapons.equip(SLOTS[Number(n[1]) - 1]);
  });

  /**
   * And the middle mouse button, because that is where a lot of people's melee
   * lives and the thumb is not doing anything else.
   *
   * Its own listener rather than a field in core/input.js: every other binding
   * on this page reads the event directly for the reason above, and adding a
   * third mouse button to the input layer would mean the pause menu had to
   * learn to clear it. preventDefault stops the browser's autoscroll cursor,
   * which otherwise appears in the middle of the screen and stays there.
   */
  window.addEventListener('mousedown', (e) => {
    if (!started || pause.paused || e.button !== 1) return;
    e.preventDefault();
    melee.swing();
  });

  // Scrolling the settings panel must not swap the weapon underneath it.
  window.addEventListener('wheel', (e) => {
    if (!started || pause.paused || death.halted) return;
    weapons.cycle(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  beginBtn.addEventListener('click', start);
  window.addEventListener('keydown', (e) => {
    if (started || pause.paused) return;
    if (e.code !== 'Enter' && e.code !== 'Space') return;

    // Activating a difficulty or Settings button must not also start the run.
    const el = e.target;
    if (el instanceof HTMLElement && el.tagName === 'BUTTON' && el.id !== 'begin') return;

    start();
  });

  // Re-acquire lock after the menu let it go, without going back through the
  // title card. relock() rather than engage(), for the reason in onResume.
  canvas.addEventListener('click', () => {
    if (started && !pause.paused && !input.state.locked) input.relock();
  });

  // -------------------------------------------------------------------------
  // what opens the menu
  // -------------------------------------------------------------------------

  /**
   * LOSING THE MOUSE IS THE SIGNAL, not the keystroke.
   *
   * Pointer lock exits on Esc natively, before any handler here is consulted,
   * and Chrome does not reliably deliver a keydown for the Esc that did it.
   * Fighting that - swallowing the key, re-requesting lock, re-binding to a
   * different key - is an argument with the browser that the browser wins.
   *
   * It is also the more complete signal. Alt-tab, a system dialog and a click
   * outside the canvas all drop the lock with no keystroke at all, and every
   * one of those is a moment the player has stopped playing and the simulation
   * should stop with them.
   */
  document.addEventListener('pointerlockchange', () => {
    if (!started) return;
    if (document.pointerLockElement === canvas) return;
    // In fallback mode there is no lock, so its absence says nothing. Esc below
    // is the only path in that case.
    if (input.state.fallback) return;
    pause.open();
  });

  /**
   * Esc, as the second path.
   *
   * Carries the fallback case, where there is no pointer lock to lose, and
   * closes the menu from the keyboard. open() is idempotent, so this firing
   * alongside the pointerlockchange the same key produced is a no-event.
   */
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !started) return;
    if (pause.paused) pause.resume();
    else pause.open();
  });

  /**
   * A tab that is not on screen is paused, and `hidden` is the signal rather
   * than `blur`.
   *
   * blur fires when devtools takes focus, when a notification steals it, and
   * when a second monitor is clicked - all cases where the player is still
   * looking at the game and would find it frozen for no reason they can see.
   * document.hidden is the honest one. The alt-tab case, which is the one that
   * matters, is already covered by the lock loss above; this catches the rest.
   *
   * MAX_DELTA is untouched by all of it. A tab can be backgrounded without ever
   * being hidden and without ever holding the lock, and the clamp is the only
   * thing standing between that and the player teleporting.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && started) pause.open();
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

  /**
   * Pay the player for a burst of hits.
   *
   * Only hits on something living pay now. The scenery payout that stood in
   * for the horde through M4 is GONE with the horde's arrival: it existed
   * because the player started on 500 against a 1000 doorway with nothing in
   * the world that could earn the difference, and a buy-door nobody can afford
   * is indistinguishable from a buy-door that is broken. There is something to
   * shoot now, so shooting a wall pays what shooting a wall is worth.
   *
   * `killed` is written onto the record by systems/damage.js, which is the only
   * thing that knows how much a given weapon takes off a given region.
   */
  function payout(hits) {
    for (const h of hits) {
      if (!h.enemy) continue;

      const headshotKill = h.killed && h.region === 'head';
      economy.award(h.killed ? (headshotKill ? 'headshot' : 'kill') : 'hit');

      // The Shrine of Thoth. Paid as a SECOND award rather than by scaling the
      // frozen bounty table, for two reasons: BOUNTY is the tuned Treyarch
      // spread and nothing should be reaching in to multiply it, and paying it
      // twice puts two popups over the crosshair, which is how the player finds
      // out the boon is working without ever reading a menu.
      if (headshotKill && shrines.has('thoth')) economy.award('headshot');
    }
  }

  // The last value of combat.state.downs the loop has acted on. See the note
  // in the frame loop: a monotonic counter is the event source for going down.
  let downsSeen = combat.state.downs;

  // How many times frame() has run. Monotonic, and it counts PAUSED frames as
  // well - which is the point of it: "the loop kept running and the simulation
  // did not" is the claim the pause has to support, and it takes two numbers to
  // state. test/settings.mjs reads this against `elapsed`.
  let frameNo = 0;

  function frame() {
    requestAnimationFrame(frame);
    frameNo++;

    const now = performance.now();
    const raw = (now - last) / 1000;
    last = now;

    // -----------------------------------------------------------------------
    // THE PAUSE, AND IT IS HERE BECAUSE THIS IS THE ONLY PLACE IT CAN BE
    // -----------------------------------------------------------------------
    //
    // Every clock in this game is the delta this loop hands out. The wave
    // director's breather, a grenade's 3.4 second fuse, a power-up's remaining
    // seconds, twenty-four actors' walk cycles, the reload animation, the fog
    // drift and the cloud field are all downstream of the calls below, so not
    // making them is the whole of stopping the game. There is no per-system
    // pause flag anywhere and there should not be: one of them would be missed,
    // and the one that gets missed is always the fuse.
    //
    // `last` was rewritten above before this return, so the frame after Resume
    // measures from now and not from when the menu opened. MAX_DELTA would have
    // caught it anyway; belt and braces, on the number that teleports the
    // player when it is wrong.
    //
    // The frame is still RENDERED, at delta zero. The scene behind the panel has
    // to be there - it is what the player is deciding about - and re-rendering
    // rather than trusting the last committed buffer is the difference between a
    // menu over the game and a menu over whatever the compositor happened to
    // keep. Nothing advances: post.update and the composer are handed 0.
    if (pause.paused) {
      post.composer.render(0);
      return;
    }

    const dt = Math.min(raw, MAX_DELTA);
    elapsed += dt;

    // -----------------------------------------------------------------------
    // THE DEATH GATE, and it is a second and narrower kind of stopped.
    // -----------------------------------------------------------------------
    //
    // The pause above returns before anything advances INCLUDING the render.
    // This one is different: the camera still falls, the world still draws, and
    // the composer still runs - because the whole point is that the player
    // watches themselves go down. What stops is the SIMULATION: the player does
    // not move, the horde does not step, no wave begins, no fuse burns, no
    // power-up expires, health does not regenerate and nothing can be damaged.
    //
    // It holds until the player presses Enter or clicks the card's button.
    // There is no timeout, because a timeout is the bug it was written to fix -
    // a run that restarts itself is a run that kills an absent player on a loop.
    death.update(dt);
    const halted = death.halted;

    // GOING DOWN COSTS THE BOONS, and it has to, or none of this is a wager.
    //
    // ui/death.js resets the run to wave one and stands the player back up at
    // full health, and it does not know shrines exist. If the boons survived
    // that, a death would cost a wave counter and nothing else - and the Shrine
    // of Anubis, whose entire product is one death forgiven, would be 1500 gold
    // for the right to skip a free inconvenience.
    //
    // Watched off the counter rather than hooked, because `fell()` is private to
    // a file this system has no business reaching into, and a counter that only
    // ever goes up is a perfectly honest event source.
    //
    // MOVED ABOVE THE GATE, and that is not tidying. This block used to sit at
    // the bottom of the simulation block, which was correct while nothing could
    // switch that block off - but the death gate switches it off from the frame
    // AFTER the counter moves, so an event handler for going down was sitting
    // inside the branch that going down disables. In the game the death lands
    // mid-block and the handler still fired the same frame, which is why it
    // looked fine; test/economy.mjs kills the player from OUTSIDE the loop and
    // caught it immediately, as "going down costs every boon" and "Sekhmet
    // vitality came back off". A death cost nothing at all.
    if (combat.state.downs !== downsSeen) {
      downsSeen = combat.state.downs;
      // The power-ups go with them, and for the identical reason: a run that
      // resets to wave one while keeping half a minute of one-hit kills is a
      // death that cost a counter. What is still on the FLOOR is swept by
      // ui/death.js at the restart, not here - see the reset rule in that file.
      powerups.clearEffects();
      if (shrines.count) {
        shrines.dropAll();
        showNotice('THE GODS WITHDRAW THEIR FAVOUR', 3000);
      }
    }

    let lookDx = 0, lookDy = 0;

    if (started && !halted) {
      const look = input.consumeLook();
      lookDx = look.dx; lookDy = look.dy;
      // Sensitivity scales with zoom so aiming does not feel twitchy at 55 FOV.
      rig.look(look.dx, look.dy, 0.35 + 0.65 * rig.fovNormalized);
      player.update(dt, input.state, rig.yaw);

      // THE SHRINE OF SHU, and it is worth saying why it is a second call to
      // the controller rather than a bigger number inside it.
      //
      // There is no stamina in this game - sprint is already unlimited - so
      // "endless sprint" as written has nothing to switch off. What the perk it
      // is named after actually buys the player is GROUND COVERED while running
      // from something, so that is what it buys here: a quarter of an extra
      // step, taken through the controller's own update.
      //
      // Running it again with a shorter delta rather than scaling the speed
      // constant is the whole point. Acceleration, friction, the floor sampler,
      // the wall boxes and the collider push-out are all inside that function,
      // and every one of them stays correct. A speed multiplier applied outside
      // it would move the player through a wall a quarter of the time.
      if (player.state.sprinting && shrines.has('shu')) {
        player.update(dt * SHU_SPRINT_BONUS, input.state, rig.yaw);
      }
    }

    // Aiming is refused while sprinting, so the two never fight over the pose.
    const ads = input.state.ads && !player.state.sprinting;

    rig.update(dt, player, ads);

    if (started && halted) {
      // THE ONE EXEMPTION FROM THE FREEZE, and it is for the transition lane.
      //
      // A fade-to-black pyramid entry is being built in systems/doors.js and
      // systems/spaces.js. If the player dies with that curtain halfway up and
      // this loop freezes its clock with everything else, the curtain never
      // comes down again: a black screen, held forever, over a death card
      // nobody can see. So doors keep their delta while the run is held, on the
      // assumption that a transition finishes and lifts its own curtain from
      // here. Everything else in the block below stays stopped.
      //
      // Nothing else is reachable through it while dead - the prompt is not
      // repainted, and the thresholds it checks are measured off a player
      // position that cannot change.
      doors.update(dt);
    }

    if (started && !halted) {
      // Weapons update after the camera, because hitscan rays are cast through
      // the camera and must use this frame's orientation, not last frame's.
      const hits = weapons.update(dt, input.state, ads);
      if (hits && hits.length) {
        // Damage first: the payout needs to know whether the round finished
        // what it hit, and only the damage system can answer that.
        combat.applyHits(hits);

        // A HITMARKER IS A PROMISE THAT YOU HIT SOMETHING ALIVE.
        //
        // This used to fire on `hits.length`, and `hits` contains scenery - which
        // is why payout() below has to filter it and why the enemies suite has a
        // "scenery pays nothing" check. The head test was only choosing crit red
        // over normal white, never whether to show the mark at all, so a round
        // into a wall confirmed a kill-in-progress that was never happening.
        // Verified by probe: aimed at bare sand, zero enemies hit, marker on.
        //
        // In a shooter that is worse than a missing marker. A missing one costs
        // you information; a false one makes you stop firing at something you
        // never touched.
        const live = hits.filter((h) => h.enemy);
        if (live.length) readouts.hitmarker(live.some((h) => h.region === 'head'));

        payout(hits);
      }

      /**
       * The blade, on the same terms as the trigger.
       *
       * AFTER the weapon so a swing and a shot resolved on the same frame are
       * paid in the order they landed, and it returns records in the same shape
       * weapons.update does - so they go through the SAME combat resolution and
       * the SAME payout(). That is the whole reason melee.js returns an array
       * instead of paying itself: a melee kill pays 60 because a kill pays 60,
       * and there is exactly one table that says so.
       *
       * The hitmarker is fired with `false` unconditionally: a blade cannot land
       * a headshot, so the crit mark would be teaching a lie about which payout
       * was just earned. See systems/damage.js's applyMelee.
       */
      const swung = melee.update(dt);
      if (swung && swung.length && swung[0].enemy) {
        readouts.hitmarker(false);
        payout(swung);
      }

      // See bladeHintShown. The one moment the lesson is worth teaching.
      if (!bladeHintShown
        && weapons.STATS[weapons.state.current]
        && weapons.magazine === 0
        && weapons.reserve === 0) {
        bladeHintShown = true;
        showNotice('OUT OF AMMUNITION - Q FOR THE KHOPESH', 3600);
      }

      // Doors resolve after the camera too: the prompt is whatever the
      // crosshair is on THIS frame, and a frame of lag on a prompt reads as the
      // prompt being wrong rather than late.
      doors.update(dt);

      // The chest advances BEFORE the fixture layer reads it. Its prompt is a
      // running countdown on an offer that expires, so a frame of lag here is
      // not a late prompt, it is a prompt quoting a second that has already
      // gone - and on the last frame of an offer it would let the player take a
      // weapon the box has already withdrawn.
      mysterybox.update(dt, elapsed);

      // Then the fixtures, then the arbiter. Both write to their own channel
      // and neither can see the other's, so the order of these two is a matter
      // of taste; paint() is what has to come last.
      interacts.update();
      promptBus.paint();

      // After the player and the camera, because the horde seeks THIS frame's
      // position and a frame of lag on twenty-four actors reads as swimming.
      director.update(dt, elapsed);

      // After the director so a blast measures this frame's bodies, and BEFORE
      // combat.update so the red wash from your own frag reaches post.setDamage
      // on the frame it happened rather than the frame after.
      grenades.update(dt, input.state);

      // After both, because a drop is rolled from a kill either of them just
      // resolved, and because the Second Death measures the field the director
      // has already advanced this frame.
      powerups.update(dt, elapsed);

      combat.update(dt);
    }

    // THE SHRINE OF PTAH, and this is the whole of it.
    //
    // The viewmodel owns the authored reload length per weapon and weapons.js
    // deliberately does not duplicate that number - it watches the animation
    // phase and finishes the logical reload when the hands return to ready. So
    // the only honest way to halve a reload is to run the animation at twice
    // the rate, and the only place with the authority to do that is the loop
    // that hands the viewmodel its delta.
    //
    // Scoped to the reloading phase, so sway, kick decay and the shell physics
    // run at true rate every other frame of the game.
    const reloadScale = weapons.state.reloadScale;
    const vmDt = (reloadScale !== 1 && viewmodel.state.phase === 'reloading')
      ? dt / reloadScale
      : dt;

    viewmodel.update(vmDt, {
      speed: player.state.speed,
      sprinting: player.state.sprinting,
      ads,
      grounded: player.state.grounded,
      lookDx, lookDy,
    });

    impacts.update(dt, camera);
    altar.update(dt);

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
      readouts.fps(Math.round(frames / fpsAccum));
      frames = 0;
      fpsAccum = 0;
    }

    readouts.update({
      health: player.state.health,
      maxHealth: player.state.maxHealth,
      wave: director.state.wave,
      magazine: weapons.magazine,
      reserve: weapons.reserve,
      // The weapon's NAME, and the upgraded one once it has been through the
      // Altar. The whole point of an upgrade being an event is that the thing
      // comes back with a title, and a HUD still reading "CARBINE" would be the
      // one place in the game insisting nothing happened.
      weapon: weapons.STATS[weapons.state.current]
        ? weapons.displayName(weapons.state.current).toUpperCase()
        : '',
      // The digit that recalls this weapon, 1-based, straight off the same
      // SLOTS table main.js binds Digit1..Digit7 against. One source per fact:
      // the day the order changed, the HUD would otherwise be the thing that
      // was wrong.
      slot: SLOTS.indexOf(weapons.state.current) + 1 || '',
      empty: weapons.magazine === 0,
      reloading: weapons.isReloading,
      canReload: !weapons.isReloading
        && weapons.reserve > 0
        && !!weapons.STATS[weapons.state.current]
        && weapons.magazine < weapons.STATS[weapons.state.current].magazine,
      boss: director.boss,
      // The CLAMPED delta, for the same reason the ordnance readout is handed
      // it below: weapon select has a clock in it, and simulated time runs
      // several times slower than the wall under software rendering.
      dt: started ? dt : 0,
    });

    // Ordnance. Handed the numbers rather than the system, exactly as the
    // readouts above are, and handed the CLAMPED delta because the one-time
    // hint has a clock in it and simulated time runs several times slower than
    // the wall under software rendering.
    grenadeReadout.update({
      count: grenades.count,
      cooking: grenades.state.cooking,
      cook: grenades.cook,
    }, started ? dt : 0);

    // The map and the tracker, last, because both describe the frame that has
    // just been resolved. The tracker runs every frame and is cheap - a walk
    // over ten rooms and a dozen fixtures, guarded by a compare before any DOM
    // is touched - while the map throttles itself off the CLAMPED delta, so it
    // repaints at the same rate relative to the simulation on any machine.
    objectivePanel.update(dt);
    minimap.update(dt);
    // Cheap when nothing is running: it reads a list that is empty and touches
    // no DOM at all.
    powerStrip.update();
  }

  frame();

  // Expose the running game for the headless harness and for console poking.
  window.__SANDS__ = {
    THREE, renderer, scene, camera, post, world, player, rig, input, sky,
    viewmodel, weapons, impacts, audio,
    spaces, economy, doors, courtyard, interior: spaces.interior,
    director, combat, melee, death,
    power, wallbuys, shrines, altar, mysterybox, grenades, powerups, interacts, promptBus,
    readouts, powerStrip, grenadeReadout, objectives, objectivePanel, minimap,
    pause,
    difficulty, startScreen,
    setFidelity, start,
    get elapsed() { return elapsed; },
    // Frames the loop has run, INCLUDING paused ones. Against `elapsed`, which
    // only moves when the simulation does, the pair is the whole claim.
    get frameNo() { return frameNo; },
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
