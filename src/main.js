/**
 * SANDS OF THE RESTLESS
 * Boot, frame loop, and system wiring.
 *
 * M1 scope: stage, post chain, procedural materials, the courtyard, and a
 * player who can walk around it. Weapons, enemies, the interior, the economy,
 * and audio land in later milestones.
 */

import * as THREE from 'three';

import { createRenderer, bindResize, resolutionScale, setGovernorScale } from './core/renderer.js';
import { createGovernor } from './core/governor.js';
import { createPost } from './core/post.js';
import { createRetro } from './core/retro.js';
import { createInput } from './core/input.js';
import { keymap } from './core/keymap.js';
import { createSave } from './core/save.js';
import { createSky } from './world/sky.js';
import { buildCourtyard } from './world/courtyard.js';
import { buildMaterials, applyFidelity, upgradeMaterials } from './world/materials.js';
import { loadAssets } from './world/assets.js';
import { createPlayer, PLAYER_CONSTANTS } from './player/controller.js';
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
import { createJars } from './systems/jars.js';
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
import { createEnding } from './ui/ending.js';
import { createPowerups } from './systems/powerups.js';
import { createPauseMenu } from './ui/pause.js';
import { createDifficulty } from './systems/difficulty.js';
import { createStartScreen } from './ui/start.js';
import { createPacer } from './ui/pacer.js';

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

  /**
   * The local save: settings, records, unlocks.
   *
   * Built here rather than inside the pause menu because it is not the settings
   * panel's - the death card writes the erasure count through it, the ending
   * card writes the clear time, and World 2's Easter egg will read a flag off
   * it. The panel is the biggest READER, which is not the same as the owner.
   *
   * Constructing it cannot throw and cannot fail the boot. See core/save.js:
   * every store failure lands the player on defaults, which is the state they
   * were in before the file existed.
   */
  const save = createSave();

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

  /**
   * THE FOUR-JAR CHAIN, and it is built HERE for two reasons that pull the same
   * way.
   *
   * It needs `doors` and `power`, both of which are above it. And the
   * interaction layer below only builds raycast targets for slot types it has a
   * handler for, so a chain constructed after it would register two handlers
   * against a target list that had already been built without a single jar or
   * niche in it - present, drawn, and unpickable. That is the same ordering the
   * mystery box documents ten lines up, arrived at from the other direction.
   *
   * It writes `doors.state.jarsReturned`, which was declared for M4 and written
   * nowhere, which is why the Serdab - the room World 1 ends in - could not be
   * entered in a shipped build.
   */
  const jars = createJars({
    interior: spaces.interior,
    courtyard,
    doors,
    power,
    audio,
    notice: (text, ms) => showNotice(text, ms),
  });

  const interacts = createInteracts({
    camera,
    interior: spaces.interior,
    // The exterior sells one thing: the B3AR, on the avenue wall. Passed the
    // same way doors.js has always been passed both spaces, so one prompt and
    // one F key serve inside and out. See ui/interact.js.
    courtyard,
    spaces,
    prompt: promptBus.channel('fixtures', 2),
    handlers: {
      wallbuy: wallbuys, shrine: shrines, altar, box: mysterybox,
      // Two more slot types, and until they were registered the interaction
      // layer skipped both: it collects nothing for a type with no handler, so
      // a niche was not merely unpickable, it was not even a raycast target.
      ...jars.handlers,
    },
    // The jars are propSlots rather than interactSlots - build.js says why in
    // the builder - and one of the four stands outside, so they are neither of
    // the two SPACES this layer already took. See the note on `sources`.
    sources: jars.sources,
  });

  shrines.attach(interacts.records);
  mysterybox.attach(interacts.records);
  createBoonStrip(document.getElementById('r-boons'), shrines);

  /**
   * SQUARE IS CONTEXTUAL, and `core/input.js` decides which by reading the
   * prompt element's `on` class. It is deliberately NOT wired to a source-level
   * probe here.
   *
   * `input.setPromptProbe()` exists and takes one - and the obvious call,
   * `() => !!interacts.candidate || !!doors.candidate`, was written, shipped and
   * REVERTED. It reads the arbitrated fact rather than the artefact painted from
   * it, which is better in principle, and it broke three green suites: with a
   * prompt on screen Square reloaded instead of interacting, twice in
   * test/rebind.mjs and once in test/gamepad.mjs.
   *
   * The suites are not wrong. They stage a prompt by writing to the element,
   * because THE SCREEN IS THE CONTRACT: the rule is that Square answers what the
   * player can see, and a probe that answers from state the player cannot see is
   * answering a different question. No case has been demonstrated where the two
   * disagree in play.
   *
   * If one ever is - a prompt suppressed during a transition while a candidate
   * persists is the likely shape - the hook is here and takes one line. Until
   * then this is a theoretical improvement that cost three passing tests.
   */

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

    // Harder and longer than a kill, because being hit is the thing the player
    // most needs to notice and the screen wash alone is easy to miss when the
    // horde is on top of you. Placed on the wrapper rather than inside
    // combat.js so that the pad is not a dependency of the damage system.
    if (amount > 0) input.pad.rumble(0.8, 0.4, 150);

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

  /*
   * THE DEAD ARE SOLID.
   *
   * Wired here rather than handed to createPlayer, because the player is built
   * two hundred lines above this and the director does not exist yet at that
   * point. `director.live` is an array the director splices IN PLACE, so the
   * body is given a reader of it rather than a copy: a copy would go stale the
   * first time an actor was retired and leave a crumbled shambler holding a
   * doorway forever, with nothing on screen to explain it.
   */
  player.setBodies(() => director.live);

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
    // The jar chain, so the ladder can point at the jar the player still has to
    // FETCH rather than at the room the jars eventually go in. See the `jars`
    // rung in ui/objective.js.
    jars,
  });

  const objectivePanel = createObjectivePanel(
    document.getElementById('objective'), objectives);

  const minimap = createMinimap({
    canvas: document.getElementById('map-canvas'),
    roomLabel: document.getElementById('map-room'),
    spaces, interior: spaces.interior, doors, interacts, shrines,
    mysterybox, power, economy, director, rig, player,
    // For the breathing target ring. See `ring()` in ui/minimap.js.
    jars,
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
    // THE COMPOSER NEEDS THE RATIO TOO, and for years it was not given one.
    // EffectComposer captures the renderer's pixel ratio ONCE in its constructor
    // and multiplies every setSize by that frozen value forever, so a later
    // setPixelRatio on the renderer changed the canvas and left the render
    // targets where they were. See setPixelScale below for what that cost.
    post.composer.setPixelRatio(high ? resolutionScale() : 1);
    post.composer.setSize(window.innerWidth, window.innerHeight);

    // A retro mode owns the composer's pixel ratio while it is on, and this
    // function has just overwritten it with the shipping convention. Without
    // this, changing fidelity from the panel while a mode is live leaves the
    // post chain rendering at window resolution into a canvas a third that
    // size: the picture survives, the entire performance argument does not.
    retro?.resize();

    btnHigh.setAttribute('aria-pressed', String(high));
    btnLow.setAttribute('aria-pressed', String(!high));
  }

  /**
   * Apply the governor's pixel scale and rebuild everything sized from it.
   *
   * Kept separate from setFidelity because they answer independent questions -
   * fidelity is WHICH passes run, scale is how many fragments each one covers -
   * and because the bottom rung of the ladder has to lower the scale while
   * fidelity is already low.
   */
  function setPixelScale(k) {
    setGovernorScale(k);
    renderer.setPixelRatio(high ? resolutionScale() : k);
    renderer.setSize(window.innerWidth, window.innerHeight);
    /**
     * WITHOUT THIS LINE THE BOTTOM TWO RUNGS DID NOTHING, which is to say the
     * two rungs a struggling machine actually lands on.
     *
     * Measured before the fix, at a 1280x720 window: at `fewer-px` the canvas
     * was 1088x612 while the composer's render target was still 1280x720, and
     * at `low` the canvas was 921x518 against the same unchanged target. The
     * scene and all nine fullscreen passes were still being drawn at full size
     * and then blitted down. The ladder gave up ambient occlusion, soft
     * shadows, bloom and anti-aliasing on the way to those rungs and then spent
     * every fragment it had saved.
     *
     * `resolutionScale()` already multiplies by the governor's scale, so it
     * carries `k` implicitly on the `high` path; the low path takes it directly.
     */
    post.composer.setPixelRatio(high ? resolutionScale() : k);
    post.composer.setSize(window.innerWidth, window.innerHeight);
    // Same reason as in setFidelity. In practice this path cannot run while a
    // retro mode is on - choosing one stands the governor down for the session -
    // but `governor.force()` exists for the harness and does not, so the two
    // writers are reconciled here rather than assumed apart.
    retro?.resize();
  }

  /**
   * Created further down, once `pause` and `spaces` exist for it to ask about
   * transitions. Declared here because the fidelity buttons have to be able to
   * tell it to stand down, and those are wired at this point in the file.
   */
  let governor = null;

  /**
   * The PS1 render mode, for the same reason and one more.
   *
   * It is built after the governor, because it has to be able to tell it to
   * stand down, and the settings panel is built between the two - so the panel
   * gets an accessor pair over this binding rather than the object itself,
   * exactly as it already does for `fidelity`. Declared null here so that a
   * player who opens Settings before the mode exists gets a control that reads
   * Off and does nothing, rather than a thrown error over a menu.
   */
  let retro = null;

  // An explicit choice by the player ends the automatic one for the session. A
  // system that argues with a button the player just pressed is a bug.
  btnHigh.addEventListener('click', () => { governor?.yieldToPlayer(); setFidelity(true); });
  btnLow.addEventListener('click', () => { governor?.yieldToPlayer(); setFidelity(false); });
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
    // The local save. Every settings row persists through it, and the panel
    // restores from it as it is built. See the pass over `spec` in pause.js.
    save,
    // Handed as an accessor pair rather than as the flag, because `high` is a
    // binding in this scope and the panel has to see the value AFTER the corner
    // buttons change it. Both surfaces write through the same function, so the
    // two can never disagree about which fidelity is live.
    // Setting it by hand also stands the governor down for the session, exactly
    // as the corner buttons do. Two surfaces, one rule: the player's explicit
    // choice is final and nothing overrides it afterwards.
    fidelity: {
      get: () => high,
      set: (v) => { governor?.yieldToPlayer(); setFidelity(!!v); },
    },
    // Same shape, same rule. core/retro.js stands the governor down itself,
    // because the key binding can reach it without going through this panel.
    // The value is the mode ID rather than a boolean, because there are three
    // of them now and a boolean cannot say which.
    retro: {
      get: () => (retro ? retro.mode : 'off'),
      set: (v) => retro && retro.set(v),
      stats: () => (retro ? retro.stats() : null),
    },
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
   * THE GAME NO LONGER ASSUMES IT IS RUNNING ON THE MACHINE IT WAS BUILT ON.
   *
   * `setFidelity(true)` above used to be the entire hardware story: every
   * machine got GTAO, a 4096 shadow map and nine fullscreen passes at 3.5
   * megapixels, because that is what the author's M4 Max could afford. A player
   * on a MacBook could not run it at all, which is the bug this closes.
   *
   * It still STARTS at full, deliberately. A fast machine should not be
   * punished for the existence of slow ones, and starting low and climbing
   * would make every player watch the game improve for the first eight seconds.
   * The difference is that the frame is now measured from the first second and
   * the ladder comes down the moment the budget says so. See core/governor.js
   * for the rungs, and for why detecting the GPU at boot cannot work.
   *
   * Built here rather than beside setFidelity because it needs `pause` and
   * `spaces`, and both are created below that point in this file.
   */
  governor = createGovernor({
    post,
    sky,
    setFidelity,
    setPixelScale,
    // Transition frames are the most expensive in the game and the ones the
    // player sees least of. Sampling them would let walking through a doorway
    // permanently downgrade the picture. The pause menu is excluded for the
    // same reason in reverse: a stopped simulation renders an unrepresentative
    // frame and would look like free headroom.
    paused: () => pause.paused || spaces.transition.phase !== 'idle',
  });

  /**
   * THE RETRO MODES, and P is the key that walks them.
   *
   * The binding had to be one that is free with both hands on the controls and
   * free of any meaning the player already carries. Digit1-8 are the weapons, Q
   * is the khopesh, R reloads, V inspects, F interacts, G cooks a grenade, C
   * and Ctrl crouch, Esc is the menu. P is untouched anywhere else in src/, it
   * is nowhere near WASD so it cannot be hit by accident during a wave, and it
   * is the one letter in the alphabet that already means "PlayStation" to
   * anyone who would want this.
   *
   * IT CYCLES RATHER THAN TOGGLES, and that is the whole reason there is still
   * only one key for three modes. Modern, PS1, N64, modern. A second binding
   * for the second era would mean a key nobody can guess and a control scheme
   * that grows every time a preset is added; a cycle means the player presses
   * the same key again and the next thing happens, which is how every graphics
   * toggle on the hardware being imitated worked. Three states is comfortably
   * inside what a cycle can carry - past about four it becomes a slot machine
   * and it should become a menu instead.
   *
   * The panel carries the same three on the Video tab, because a keystroke
   * nobody is told about is a feature that does not exist - the lesson the
   * CONTROLS tab in ui/pause.js was built out of - and because the panel is
   * the only way to jump straight to a mode rather than walking to it.
   *
   * It switches in place: no reload, no respawn, and the player does not move.
   * The whole argument is a comparison, and a comparison you have to walk back
   * to is not one.
   */
  retro = createRetro({
    renderer, scene, canvas, post, viewmodel, governor,
    onChange: (mode, notice) => {
      showNotice(notice, mode === 'off' ? 1400 : 2600);
      pause.refresh();
    },
  });

  window.addEventListener('keydown', (e) => {
    // Not gated on `started`: the modes are worth seeing on the title card too,
    // which is a full render of the courtyard. It IS gated on the menu, for the
    // same reason every other binding in this file is - a keystroke meant for a
    // text field or a menu button is not a keystroke meant for the renderer.
    // The ACTION rather than the letter. P is still the shipped default and the
    // long note above is still why, but the player can move it, and a handler
    // that kept comparing against 'KeyP' would leave one binding in the game
    // that the controls page lies about.
    if (!keymap.matches('renderMode', e.code) || pause.paused) return;
    retro.cycle();
  });

  /**
   * The jitter grid is in pixels of the drawing buffer, so it has to follow the
   * window. bindResize() above already re-derives the pixel ratio - retro mode
   * is inside resolutionScale(), so it gets the right one for free - but
   * nothing else knows the composer's own pixel ratio and the vertex snap have
   * to move with it.
   */
  window.addEventListener('resize', () => retro.resize());

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
  // EVERY PLACE THE GAME PRINTS A KEY
  // -------------------------------------------------------------------------
  //
  // There are three, and until the bindings became a table all three were
  // hand-written: the title card's controls strip, the two key caps on the HUD,
  // and the slot digit on the ammunition plate. The strip is the one with a
  // documented history of being wrong - it claimed weapons 1 to 7 for as long as
  // there have been eight, and it had no entry for the khopesh at all until
  // somebody noticed - and the reason is not carelessness. A sentence typed into
  // index.html has nothing to disagree with, so nothing can catch it.
  //
  // All three are painted from core/keymap.js now, and repainted on every change
  // to it. A rebind made from the title screen's Settings button moves the strip
  // underneath it while the panel is still open.

  /**
   * The caps for the eight weapon slots, cached.
   *
   * The readout block below runs sixty times a second and asks for one of these
   * every frame. Rebuilding a label array in the frame loop to answer a question
   * whose answer changes twice a year is the kind of allocation this project's
   * governor exists to avoid.
   */
  let slotCaps = [];
  function slotCap(n) {
    if (!n) return '';
    return slotCaps[n - 1] || '';
  }

  /**
   * The title card's controls strip, AS A TABLE.
   *
   * Every entry names actions and the sentence a player reads; the keys come out
   * of the binding table. `joined` concatenates the caps with nothing between
   * them, which is what makes four movement bindings read as WASD rather than as
   * four separate caps.
   */
  const STRIP = [
    [
      { actions: ['forward', 'left', 'back', 'right'], joined: true, what: 'move' },
      { actions: ['sprint'], what: 'sprint' },
      { actions: ['jump'], what: 'jump' },
    ],
    [
      { actions: ['look'], what: 'look' },
      { actions: ['fire'], what: 'fire' },
      { actions: ['aim'], what: 'aim' },
    ],
    [
      { actions: ['reload'], what: 'reload' },
      { actions: ['cycleWeapon'], what: 'next weapon' },
      { slots: true, what: 'weapons' },
      { actions: ['interact'], what: 'buy' },
    ],
    [
      { actions: ['melee'], what: 'khopesh' },
      { actions: ['grenade'], what: 'hold to cook a grenade, release to throw' },
      { actions: ['pause'], what: 'pause and settings' },
    ],
  ];

  const stripEl = document.querySelector('[data-keys]');

  /**
   * The eight slots on one line, WITHOUT claiming a range that is not there.
   *
   * "1-8" is the right thing to print for the shipped scheme and is how this
   * line has always read. It stops being true the moment a player moves one slot
   * off the number row, so the range is printed only when the caps really are a
   * run of single characters from the first to the last; otherwise every cap is
   * printed. That is uglier and it is the whole point - the last version of this
   * line was a range that had quietly stopped being true.
   */
  function slotsLabel() {
    const caps = slotCaps.slice();
    if (!caps.length) return '';
    const run = caps.every((c, i) => c.length === 1
      && (i === 0 || c.charCodeAt(0) === caps[i - 1].charCodeAt(0) + 1));
    return run && caps.length > 2 ? `${caps[0]}-${caps[caps.length - 1]}` : caps.join(' ');
  }

  function paintKeyStrip() {
    slotCaps = [];
    for (let i = 1; i <= SLOTS.length; i++) slotCaps.push(keymap.labels(`weapon${i}`)[0] || '');

    // The HUD's two authored caps. `data-key-cap` names the action; the cap says
    // whatever that action currently answers to.
    for (const node of document.querySelectorAll('[data-key-cap]')) {
      node.textContent = keymap.labels(node.dataset.keyCap)[0] || '';
    }

    if (!stripEl) return;
    stripEl.textContent = '';

    for (const line of STRIP) {
      const row = document.createElement('div');
      let first = true;
      for (const entry of line) {
        if (!first) row.append(' · ');
        first = false;
        const b = document.createElement('b');
        if (entry.slots) b.textContent = slotsLabel();
        else {
          const caps = [];
          for (const id of entry.actions) for (const cap of keymap.labels(id)) {
            if (!caps.includes(cap)) caps.push(cap);
          }
          b.textContent = caps.join(entry.joined ? '' : ' ');
        }
        row.append(b, ` ${entry.what}`);
      }
      stripEl.appendChild(row);
    }
  }

  paintKeyStrip();
  keymap.onChange(paintKeyStrip);

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
    input, audio, spaces, save,
    suspended: () => pause.paused,
  });
  combat.attach({ death });

  /**
   * THE END OF WORLD 1.
   *
   * After the death card because it is that file's sibling and reads as one, and
   * because `main.js`'s freeze is now the OR of the two: whichever one has taken
   * the run, the simulation block is skipped and doors keep their delta. Before
   * anything that reads `halted`.
   *
   * It is handed the three things its gate asks about and nothing else. It does
   * not get the player, the horde, the economy or the world - the ending is a
   * question about a wave counter, a jar counter and a room name, and a module
   * that could reach further would eventually be asked to.
   */
  const ending = createEnding({
    doc: document,
    director, doors, spaces,
    input, audio, rig, save,
    suspended: () => pause.paused,
  });

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

    /**
     * The two Act 3 loop doorways are the one thing in the map whose GEOMETRY
     * depends on the tier, and this is the only line in the game that knows it.
     *
     * They are built as their `onHard` form at boot, because the interior is
     * built at boot and the tier is picked after it - see the note on
     * collectPortals in world/build.js. So Hard is the shape that ships and the
     * gentler tiers delete it here, in the frame the choice becomes a fact,
     * before the player has moved: no animation, no gold debited, no chime, no
     * "the way is open". An Easy player never learns there was a wall.
     *
     * Deliberately NOT routed through systems/doors.js. That file owns what a
     * barrier costs and whether it may be bought, and this transaction has no
     * price and no buyer - putting it there would mean teaching the purchase
     * path about a purchase that never happens.
     */
    spaces.interior.applyTier(tier.id);

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
  /**
   * WHAT EACH ACTION DOES, AS A TABLE THE HANDLER READS.
   *
   * This used to be a ladder of `e.code === 'KeyR'` comparisons and a
   * `Digit([1-8])` regular expression, which was five separate statements of the
   * control scheme in the one file that could not be audited against the panel
   * that documents it. Now the LETTER lives in core/keymap.js and this says only
   * what the verb is, so a rebind moves the key here, on the controls page, on
   * the title card and on the pad's synthetic events at the same instant.
   *
   * Each of these still deserves its own note, and they are kept beside the
   * function that does the thing rather than beside the key that used to.
   */
  const ACTION_DOES = {
    reload: () => weapons.reload(),
    inspect: () => viewmodel.inspect(),

    /**
     * THE BLADE, and its default binding is chosen for one property: you can
     * reach Q without letting go of W.
     *
     * A melee in this genre is a panic button pressed while running backwards
     * from four bodies with an empty magazine, so the only criterion that
     * matters is whether the left hand can hit it without leaving the movement
     * keys. V is the reference game's bind and is already the inspect flourish
     * here; F is the interact and would buy a door mid-swing; anything on the
     * right of the board means letting go of the mouse. A player who disagrees
     * can now move it, which is the point of the editor.
     */
    melee: () => melee.swing(),

    // Interact goes to whatever is under the crosshair, and the two systems that
    // can claim it are arbitrated the SAME WAY the prompt is: a fixture wins
    // over a door. Routing on `candidate` rather than on the return value of
    // interacts.interact() matters - a shrine that refuses returns false, and
    // falling through on false would buy whatever door happened to be behind
    // it. The player would have been refused at one thing and charged for
    // another, in the same keypress.
    interact: () => {
      if (interacts.candidate) interacts.interact();
      else doors.interact();
    },

    /**
     * CYCLE FORWARD, because the digits are unreachable in a fight.
     *
     * The owner's report was that he cannot switch weapons easily. He is right,
     * and the reason is anatomy rather than logic: the eight digit keys are the
     * only way to change gun from the keyboard, and reaching 5 through 8 means
     * taking the hand off WASD in the middle of being chased. The scroll wheel
     * has always cycled, but a right hand on the mouse is aiming with it.
     *
     * So this is the same `cycle()` the wheel calls, on a key the left hand can
     * reach without moving: E sits directly above D by default. Forward only. A
     * reverse bind would need a second key and this exists to REMOVE hand
     * movement, and with at most eight weapons forward-only is never more than
     * seven presses from anything.
     *
     * `cycle` already skips the stowed weapon and no-ops on a single gun, so
     * there is nothing to guard here that weapons.js does not guard already.
     */
    cycleWeapon: () => weapons.cycle(1),
  };

  /**
   * The eight slots, wired by INDEX rather than by digit.
   *
   * Eight because the B3AR is the eighth entry in SLOTS - APPENDED rather than
   * filed next to the MK9, so that the seven weapons the map has been teaching
   * since the first room keep the keys they were learned on. The HUD prints the
   * digit off that same array and test/hud.mjs asserts five of them by number,
   * so inserting would have silently moved four guns under the player's fingers.
   * The digits themselves are now defaults in core/keymap.js and the player may
   * move any of them; what cannot move is which gun is in which slot.
   */
  for (let i = 0; i < SLOTS.length; i++) {
    ACTION_DOES[`weapon${i + 1}`] = () => weapons.equip(SLOTS[i]);
  }

  window.addEventListener('keydown', (e) => {
    if (!started || pause.paused || death.halted || ending.halted) return;
    const does = ACTION_DOES[keymap.actionFor(e.code)];
    if (does) does();
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
    if (!started || pause.paused || death.halted || ending.halted) return;
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
    // `pause` is a FIXED action in core/keymap.js and Escape is what it is bound
    // to, for the reason at the top of ui/pause.js: the browser exits pointer
    // lock on Esc before this handler is consulted, so a pause key bound
    // anywhere else would be a scheme the browser overrules. Read through the
    // table anyway, so that this file states no binding of its own.
    if (!keymap.matches('pause', e.code) || !started) return;
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

  /**
   * THE PILL, and it is a pacer now rather than five lines of last-write-wins.
   *
   * The body of showNotice moved to ui/pacer.js whole; what is left here is the
   * adapter, because the signature is load-bearing. Ten systems are handed
   * `(text, ms) => showNotice(text, ms)` between lines 171 and 396 above, and
   * every one of them keeps the behaviour it was written against: a system
   * notice is instant, in capitals, and expires on the wall clock.
   *
   * What is new is the third argument nobody passes yet. `pacer.speak()` is the
   * voiced entry point and it returns the pill to a person: text that arrives
   * at a readable rate, a hold that a purchase confirmation cannot break, and
   * an interruption that lands on an authored character rather than wherever
   * the reveal happened to be. See the file header there.
   */
  const pacer = createPacer({ el: notice, doc: document, audio });

  /*
   * THE JAR CHAIN TAKES THE PACER, LATE.
   *
   * The chain is built a thousand lines above this, with the doors and the
   * power system, because that is what it is made of; the pill is UI and is
   * built here. So the one thing the chain wants from it - the authored cut in
   * her last line, which is where the Kindling is thrown - arrives through
   * attach(), the same late binding the router, combat and the shrines use.
   *
   * ui/pacer.js documents this call site by name and exports the line for it.
   */
  jars.attach({ pacer });
  function showNotice(text, ms = 2000, opts) {
    return pacer.notice(text, ms, opts);
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

      // A short knock on a kill. Deliberately NOT on every hit: a shambler that
      // takes six rounds would turn the pad into a buzzer, and the thing worth
      // feeling is the body going down rather than the bullet landing. Silent
      // no-op with no pad, no actuator, or rumble switched off.
      if (h.killed) input.pad.rumble(0.55, 0.25, 90);

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

    /**
     * THE PAD, ONCE A FRAME, AND ABOVE THE PAUSE GUARD ON PURPOSE.
     *
     * A stick reports a POSITION and what it drives is an angular VELOCITY, so
     * it needs a delta - and it gets THIS loop's raw one rather than a clock of
     * its own, so there is one clock in the game. core/gamepad.js clamps it to
     * the same 1/20 MAX_DELTA uses, for the same reason.
     *
     * ABOVE the pause, because the pause menu has to be navigable on the pad.
     * A controller that can open the settings panel and cannot then move the
     * selection or resume has trapped the player at the first press of Options,
     * which is worse than not having supported the pad at all. The input layer
     * knows it is suspended and routes the same poll to menu navigation
     * instead - see pollPad() in core/input.js.
     *
     * `rig` is READ, never written: two numbers, the camera's radians-per-count
     * and its invert flag, so the stick can speak the mouse's units and be
     * drained by the same consumeLook() below.
     */
    input.pollPad(rig, raw);

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

    /**
     * One frame of evidence for the governor, on the RAW delta.
     *
     * `dt` above is clamped so that a long frame cannot teleport the player
     * through a wall - see MAX_DELTA. Feeding the governor that number would
     * make it structurally incapable of seeing the frames it exists to react
     * to: every hitch worse than the clamp would arrive as exactly the clamp,
     * and a machine rendering at four frames a second would report the same
     * delta as one merely stuttering. It gets the truth instead.
     */
    governor.sample(raw * 1000);

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

    // THE OTHER WAY A RUN CAN STOP, and it is the one that does not come back.
    //
    // Driven before `halted` is read, and unconditionally, because its own gate
    // is what decides whether the world has ended - a check that only ran while
    // the world was still running could never fire on the frame it has to.
    ending.update(dt);

    // Either card owns the run. `death` restarts it and `ending` does not, and
    // this line does not care which: what it means is that the simulation block
    // below is skipped and doors keep their delta so a curtain in flight can
    // still come down.
    const halted = death.halted || ending.halted;

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

      // The jar chain, and it only ever does anything in the one window
      // between her last line starting and the machine lighting. It is the
      // deadline that stops the Kindling depending on a text effect finishing.
      jars.update();

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
      /**
       * The posture, because the VIEWMODEL DOES NOT SHARE THE PLAYER'S CAMERA.
       *
       * It renders through its own, which is what stops the gun clipping into
       * geometry and what lets the ADS blend be independent of the world view.
       * The cost is that lowering the head does nothing to the weapon: without
       * these two the player drops into a crouch and the gun stays exactly where
       * it was, floating at standing height in front of a crouched man.
       *
       * `crouch` is the BLEND rather than the boolean, 0 to 1, so the gun can
       * follow the head down over the same 0.16s instead of snapping when the
       * posture flips. `sliding` is separate because a slide is not a deep
       * crouch - the body is travelling faster than a sprint and the weapon
       * should read as being carried through it, not aimed.
       */
      crouch: player.state.crouch,
      sliding: player.state.sliding,
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
      /*
       * METRES BELOW THE SAND. The feet, not the eye - a depth gauge that reads
       * 1.68 while standing on the datum is measuring the wrong end of the body.
       * Clamped at zero because the courtyard is a dune field and negative depth
       * is not a thing the player can be asked to interpret.
       */
      depth: Math.max(0, Math.round(-(player.position.y - PLAYER_CONSTANTS.EYE_HEIGHT))),
      magazine: weapons.magazine,
      reserve: weapons.reserve,
      // The weapon's NAME, and the upgraded one once it has been through the
      // Altar. The whole point of an upgrade being an event is that the thing
      // comes back with a title, and a HUD still reading "CARBINE" would be the
      // one place in the game insisting nothing happened.
      weapon: weapons.STATS[weapons.state.current]
        ? weapons.displayName(weapons.state.current).toUpperCase()
        : '',
      // The KEY that recalls this weapon, off the same SLOTS table the digits
      // are bound against and through core/keymap.js, which is what the player
      // may have moved them to. One source per fact: the day the order changed,
      // or the day a player put slot three on Z, the HUD would otherwise be the
      // thing that was wrong. Read from a cache rather than recomputed here,
      // because this line runs every frame and a rebind happens twice a year.
      slot: slotCap(SLOTS.indexOf(weapons.state.current) + 1),
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
    director, combat, melee, death, ending, jars,
    // The local save, so a harness can read records and settings back without
    // reaching into localStorage and guessing at the key.
    save,
    power, wallbuys, shrines, altar, mysterybox, grenades, powerups, interacts, promptBus,
    readouts, powerStrip, grenadeReadout, objectives, objectivePanel, minimap,
    pause,
    // The notice pill's pacer. Exposed on its own line rather than added to one
    // above because main.js is shared this week; test/pacer.mjs reads the
    // revealed substring off it, which is the only way to tell a line that is
    // being spoken from a line that was merely set.
    pacer,
    // The binding table, exposed for the same reason the governor is: a claim
    // about what the keyboard is doing that cannot be read from outside the page
    // is not a claim worth making. test/bindings.mjs reads it to compare what
    // the table holds against what the panel drew, which are two different facts
    // and the gap between them is this project's defining bug.
    keymap,
    difficulty, startScreen,
    setFidelity, setPixelScale, start,
    // The frame governor, and the composer it drives. Exposed so that
    // tools/perf.mjs can toggle individual passes and read the rung the machine
    // actually settled on - a claim about performance that cannot be measured
    // from outside the page is not a claim worth making.
    governor,
    // The retro modes, so tools/perf-retro.mjs can flip them and read the cost.
    // A render mode whose performance claim cannot be measured from outside the
    // page is not a claim worth making, which is the same argument the governor
    // above is exposed for.
    retro,
    composer: post.composer,
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
