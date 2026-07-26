/**
 * The active-space router: which world the player is standing in.
 *
 * The game has two worlds that are never both real at once. The courtyard is a
 * sunlit exterior with a dune floor and a perimeter wall. The interior is a
 * lit-by-fire room graph 110 units past that wall, authored at its own scale
 * because a playable interior is several times larger than the stepped mass
 * that reads correctly as a pyramid on the skyline.
 *
 * Everything downstream of this file asks the same four questions - what do I
 * collide with, where is the floor, where are the edges, what can I shoot - and
 * every one of them is answered by the player controller reading `world.*`.
 *
 * So this hands out ONE world object and rewrites its fields on a transition,
 * rather than teaching each system to ask which space is live. That choice is
 * the whole design:
 *
 *   - No system downstream needs to change. The controller, the weapon
 *     raycast, and the fidelity switch all keep reading `world`, and none of
 *     them acquires a branch or an opinion about the interior.
 *   - There is exactly one place where "which space" is decided, so the two can
 *     never disagree. The alternative - merging both collider sets and both
 *     floor samplers into one permanent world - keeps the player permanently
 *     paying for geometry 110 units away, and puts the interior's walls into
 *     the exterior's bounds check where they mean nothing.
 *   - Handing out a live object rather than a getter means the swap is three
 *     assignments, not a property read on every collider test in the loop.
 *
 * The inactive space is switched off completely: its group is hidden, so three
 * skips the whole subtree including its lights, and its update() is not called,
 * so its braziers, dust, and scatter stop costing anything at all.
 */

import { buildInterior } from '../world/build.js';
import { INTERIOR_BOUNDS } from '../world/rooms.js';

/**
 * Room lighting profile to reverb space. The audio engine has no 'sanctum'
 * convolver and does not need one: a burial chamber and a side chamber are the
 * same box of stone to the ear, and they differ in what is DRIPPING in them,
 * which is the ambience bed's job below.
 */
const SPACE_FOR = {
  corridor: 'corridor',
  chamber: 'chamber',
  gallery: 'gallery',
  shaft: 'shaft',
  sanctum: 'chamber',
};

const AMBIENCE_FOR = {
  corridor: 'corridor',
  chamber: 'chamber',
  gallery: 'gallery',
  shaft: 'shaft',
  sanctum: 'crypt',
};

/**
 * Environment intensity while inside.
 *
 * Not zero. The HDRI is the only thing giving the gold and granite anything to
 * reflect, and a metal with no environment is not dark, it is black. At 0.05 it
 * is a floor under the reflections and contributes nothing to the read of the
 * room, which is entirely the interior's own point lights.
 */
const INTERIOR_ENV = 0.05;

export function createSpaces({ scene, courtyard, sky }) {
  // Built at boot rather than on first entry. It costs a few milliseconds and
  // half a megabyte of geometry, and the alternative is a visible hitch at the
  // exact moment the player has just paid a thousand gold to see it.
  const interior = buildInterior(scene);
  interior.group.visible = false;

  /**
   * The lights that belong to the sky. Inside a sealed pyramid every one of
   * them is wrong: they are added to the scene, not to the courtyard's group,
   * so hiding the courtyard does nothing to them, and nothing in this renderer
   * stops a directional light from shining straight through a wall.
   */
  const skyLights = [sky.sun, sky.hemi, sky.ambient, sky.bounce, sky.wrapA, sky.wrapB]
    .filter(Boolean)
    .map((light) => ({ light, intensity: light.intensity }));

  let savedEnv = scene.environmentIntensity;
  let savedShadow = sky.sun ? sky.sun.castShadow : false;

  let player = null;
  let rig = null;
  let audio = null;

  let active = 'exterior';
  let roomId = null;

  // Mutated in place on a transition rather than reallocated, so the weapon
  // raycast is not handed a fresh array on every shot.
  const hitTargets = [courtyard.group];

  /**
   * The one world object. Its fields are rewritten by enter(); everything
   * downstream keeps the same reference for the life of the process.
   */
  const world = {
    group: courtyard.group,
    colliders: courtyard.colliders,
    walls: null,
    bounds: courtyard.bounds,
    heightAt: courtyard.heightAt,
    spawn: courtyard.spawn,
    hitTargets,

    update(dt, t) {
      if (active === 'interior') {
        interior.update(dt, t);
        trackRoom();
      } else {
        courtyard.update(dt, t);
      }
    },

    setFidelity(high) {
      // Both, not just the live one. The hidden space is entered without
      // warning, and a space that missed a fidelity change comes up wrong.
      courtyard.setFidelity(high);
      interior.setFidelity(high);
    },
  };

  // ---------------------------------------------------------------------------
  // lighting
  // ---------------------------------------------------------------------------

  /**
   * Hold the sky down while the player is inside.
   *
   * Re-checked every frame rather than set once, because the HDRI finishes
   * loading a second or two after boot and rewrites all of these. A player who
   * bought the door quickly would otherwise be standing in a sealed chamber
   * lit by desert noon, and the saved values this restores on the way out would
   * be the pre-load ones.
   */
  function holdSkyDown() {
    for (const s of skyLights) {
      if (s.light.intensity !== 0) {
        s.intensity = s.light.intensity;
        s.light.intensity = 0;
      }
    }
    if (scene.environmentIntensity !== INTERIOR_ENV) {
      savedEnv = scene.environmentIntensity;
      scene.environmentIntensity = INTERIOR_ENV;
    }
  }

  function restoreSky() {
    for (const s of skyLights) s.light.intensity = s.intensity;
    scene.environmentIntensity = savedEnv;
    if (sky.sun) sky.sun.castShadow = savedShadow;
    if (sky.dome) sky.dome.visible = true;
  }

  // ---------------------------------------------------------------------------
  // rooms
  // ---------------------------------------------------------------------------

  /**
   * Retune the reverb and the ambience bed to whichever room the player is in.
   *
   * Only on a CHANGE. setSpace crossfades two convolvers and startAmbience
   * retargets a stack of ramps; calling either every frame would keep both in
   * permanent transition and neither would ever arrive.
   */
  function trackRoom() {
    if (!player) return;

    const room = interior.roomAt(player.position.x, player.position.z);
    const next = room ? room.id : roomId;
    if (!next || next === roomId) return;

    roomId = next;
    applyRoomAudio(room);
  }

  function applyRoomAudio(room) {
    if (!audio || !room) return;
    const profile = room.lightingProfile;
    audio.setSpace(SPACE_FOR[profile] || 'chamber');
    audio.startAmbience(AMBIENCE_FOR[profile] || 'chamber');
  }

  // ---------------------------------------------------------------------------
  // transitions
  // ---------------------------------------------------------------------------

  /**
   * Move the player between worlds.
   *
   * @param {'exterior'|'interior'} name
   * @param {{x:number, z:number, rot:number}} [at]  where to put them down
   */
  function enter(name, at) {
    if (name === active) return false;

    const toInterior = name === 'interior';

    courtyard.group.visible = !toInterior;
    interior.group.visible = toInterior;

    // Scatter is added to the scene, not to the courtyard's group, so it does
    // not come down with it. Left visible it is 3400 instanced pebbles being
    // culled every frame for a space the player is not in.
    if (courtyard.scatter && courtyard.scatter.group) {
      courtyard.scatter.group.visible = !toInterior;
    }

    active = name;
    hitTargets[0] = toInterior ? interior.group : courtyard.group;

    world.group = hitTargets[0];
    world.colliders = toInterior ? interior.colliders : courtyard.colliders;
    world.walls = toInterior ? interior.walls : null;
    world.heightAt = toInterior ? interior.heightAt : courtyard.heightAt;
    world.bounds = toInterior
      // The interior is a long rectangle, not a square, so it needs a real
      // rectangle. maxZ stops half a unit short of the entry wall line so the
      // player can reach the threshold in the doorway and be caught by it
      // rather than walking out over a floor that was never built.
      ? { minX: INTERIOR_BOUNDS.minX, maxX: INTERIOR_BOUNDS.maxX,
          minZ: INTERIOR_BOUNDS.minZ, maxZ: INTERIOR_BOUNDS.maxZ + 0.5 }
      : courtyard.bounds;

    if (toInterior) {
      savedShadow = sky.sun ? sky.sun.castShadow : false;
      if (sky.sun) sky.sun.castShadow = false;   // nothing outside casts in here
      if (sky.dome) sky.dome.visible = false;
      holdSkyDown();
    } else {
      restoreSky();
    }

    if (at && player) {
      player.teleport({ x: at.x, y: 0, z: at.z });
      if (rig && at.rot !== undefined) rig.reset(at.rot, -0.02);
    }

    roomId = null;

    if (toInterior) {
      trackRoom();
    } else if (audio) {
      audio.setSpace('exterior');
      audio.startAmbience('courtyard');
    }

    return true;
  }

  return {
    world,
    interior,
    courtyard,

    /** Late binding: the player is constructed FROM world, so it cannot exist
     * before this does. Same for the camera rig and the audio engine, which
     * cannot come up until a user gesture. */
    attach(parts) {
      if (parts.player) player = parts.player;
      if (parts.rig) rig = parts.rig;
      if (parts.audio) audio = parts.audio;
    },

    enter,

    /** Called from the frame loop while inside, to hold the sky down. */
    tick() {
      if (active === 'interior') holdSkyDown();
    },

    get active() { return active; },
    get roomId() { return roomId; },
    get room() { return roomId ? interior.rooms.find((r) => r.id === roomId) : null; },
  };
}
