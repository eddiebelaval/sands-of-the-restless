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
 *
 * THE SWAP IS NOT SOMETHING THE PLAYER MAY SEE.
 *
 * It used to be three assignments in the middle of a frame, and the frame went
 * out. That is one rendered frame in which the interior's geometry is drawn
 * through a camera the loop placed OUTSIDE it half a millisecond earlier -
 * rig.update() runs before doors.update(), so the swap always lands after the
 * camera has been committed - and it is the "we see under the pyramid for a
 * second" the owner reported. Measured: one frame of the interior at mean
 * luminance 127 against the room's own steady 18, and the mirror of it on the
 * way out, the courtyard drawn from a camera still standing in the burial
 * chamber. At the 134 ms frame times this build was running at before the
 * pixel-ratio fix, that is an eighth of a second of somewhere else.
 *
 * So this file now owns a CURTAIN, and the contract is one line: the swap
 * happens at opacity 1 and never anywhere else. Around that:
 *
 *   - The fade OUT is not here at all. It is a function of where the player is
 *     standing, computed in doors.js against the same threshold line that
 *     fires the swap, so by the time the line is crossed the screen is already
 *     black - not because a timer finished, but because the geometry says so.
 *     Walking backwards lightens it again, on the same frame, because it was
 *     never a state.
 *   - The HOLD is counted in frames that have actually been DRAWN, not in
 *     seconds. The comment at the interior build below warns that this swap
 *     costs a visible hitch; the black is what that hitch is for, and holding
 *     it for a fixed duration would be holding it for a guess.
 *   - The fade IN multiplies by the loop's CLAMPED delta, like everything else
 *     that moves in this game, so it plays at the same rate on a machine
 *     spending 134 ms a frame as on one spending 8.
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

/**
 * Seconds of SIMULATED time for the new room to come up out of the black.
 *
 * Half a second reads as a room being revealed rather than a screen being
 * un-dimmed, and it is short enough that a player who already knows what is on
 * the other side is not made to wait for it twice.
 */
const FADE_IN_SECONDS = 0.45;

/**
 * The same reveal, for a swap NOBODY WALKED INTO.
 *
 * The two cases are genuinely different and it is worth being precise about
 * why, because the difference is not "player versus test".
 *
 * The frame that had to be hidden is a frame the loop had ALREADY placed the
 * camera for when the swap landed - rig.update runs, then doors.update swaps,
 * then the composer draws the new world through the old camera. A swap called
 * from outside the loop, between two frames, has no such frame: the next one
 * places the camera from the position enter() just teleported to, and is
 * correct. Measured: the frame counter does not advance across an out-of-band
 * enter().
 *
 * The curtain still goes up for it, because "there was nothing to hide" is a
 * thing to be sure of rather than to assume. But the concealment was not
 * earned by an approach the player watched go dark, so it is not paid off with
 * half a second of black they have no reason to be sitting through. Hold for
 * the same proof that the new world has drawn, then go.
 *
 * The only caller in the repo that takes this branch today is the enemies
 * harness, which drops the player into the Great Gallery to photograph it. It
 * is also what the console takes, which is the point: `spaces.enter(...)`
 * typed at a prompt should not put you in the dark for half a second.
 */
const CUT_IN_SECONDS = 0.10;

/**
 * How many frames must be DRAWN with the new world live before the curtain is
 * allowed to start lifting.
 *
 * Frames, not seconds, and that is the whole point. The expensive frame is the
 * FIRST one after the swap: half a megabyte of geometry becomes visible at
 * once, three compiles its materials lazily on first draw, and the shadow map
 * is re-rendered for a different set of lights. A fixed 100 ms hold would be
 * correct on the machine it was tuned on and wrong on every other; two drawn
 * frames is correct everywhere, because the thing being waited for IS a drawn
 * frame.
 *
 * The hold cannot hang: its condition is a counter that goes up once per frame
 * and never resets, so there is no state in which it fails to end.
 */
const SETTLE_RENDERS = 2;

/**
 * The black itself.
 *
 * A DOM element rather than a pass in the composer, and there were three
 * reasons, in this order:
 *
 *   1. A composer pass fades the WORLD. The health plate, the gold counter,
 *      the minimap and the door prompt are DOM, and they would have stayed at
 *      full brightness over a black screen - which does not read as a cut to
 *      black, it reads as the world disappearing out from under the HUD. The
 *      moment being sold here is "the lights went out", and the HUD is part of
 *      what has to go out.
 *   2. It survives the fidelity switch. post.js drops passes at LOW, and a
 *      transition that stops covering the swap on the machines least able to
 *      afford the swap is exactly backwards.
 *   3. It costs one composited layer and no fragment work, on the two frames
 *      of the game that are already the most expensive ones.
 *
 * Built here rather than declared in index.html because index.html belongs to
 * another lane. Nothing about it needs a stylesheet: it is one opaque
 * rectangle with an opacity on it.
 */
function createCurtain() {
  const el = document.createElement('div');
  el.id = 'curtain';
  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    background: '#000',
    opacity: '0',
    // Never a click target. The player is walking, not choosing.
    pointerEvents: 'none',

    /**
     * UNDER THE HUD (20), not over it, and this is a correction.
     *
     * At z-index 50 the sheet covered the HUD, the door prompt and everything
     * else, which is defensible for the two-frame blackout in the middle of a
     * transition and wrong for the rest of the time - because this curtain is
     * ALSO driven by proximity to a threshold, and that demand persists while the
     * player is simply standing near a doorway playing the game.
     *
     * Measured: three metres inside the Chamber of Ascent the curtain settles at
     * opacity 0.365 in phase `idle` - working exactly as designed - and multiplies
     * the whole composited page by 0.635. Every HUD label lost a third of its
     * luminance with it: peak 216 became 137, and six contrast gates that pass at
     * 5.7:1 to 14.9:1 failed at 2.8:1 to 6.2:1. The HUD had not changed at all.
     *
     * So the sheet darkens the WORLD and leaves the interface alone. That is also
     * the better reading of the request - "it fades to the rooms rendering" is
     * about the room arriving, not about the ammo counter going away - and a
     * player mid-transition keeps their bearings instead of losing the screen.
     *
     * The pause panel (60) and the prompt (45) are above it either way, so the
     * Escape-mid-transition case the old comment worried about still holds.
     */
    zIndex: '10',
  });
  document.body.appendChild(el);

  let shown = 0;

  /**
   * THE CURTAIN HAS A COLOUR NOW, AND IT IS THE DIRECTION OF TRAVEL.
   *
   * Going in, the screen goes to black: you step out of desert noon into a
   * sealed mass and your eyes have not caught up, so the world is gone before
   * the room arrives. That has always been what this sheet sold and it is why
   * the entry reads as well as it does.
   *
   * Coming out is the SAME EFFECT WITH THE SIGN FLIPPED, and it was being
   * played as a second blackout. Eyes adapted to a torchlit chamber do not go
   * dark walking into daylight, they blow out: the doorway is a white hole, the
   * white swallows the frame, and the courtyard resolves down out of it. A fade
   * to black on the way out is the transition running backwards - it says the
   * lights went out at the exact moment the player walked into the sun.
   *
   * LATCHED ON THE RISING EDGE, and that is the whole of the mechanism worth
   * explaining. `active` flips inside `enter()`, which happens at full opacity
   * in the middle of the transition, so a curtain that read the colour every
   * frame would repaint white to black while covering the screen - and a repaint
   * at opacity 1 is not invisible, it is the most visible frame in the sequence.
   * The colour is therefore adopted only on the transition from nothing to
   * something and held until the sheet is fully gone. You cannot change the
   * colour of a curtain that is currently up; the guard is the assignment
   * condition below rather than a comment asking nicely.
   */
  let tint = '#000';
  let pending = '#000';

  return {
    get value() { return shown; },
    get tint() { return tint; },

    /**
     * Ask for the colour the NEXT fade will use. Ignored for as long as the
     * sheet is showing, which is the point - see the note above.
     */
    setTint(next) { pending = next; },

    /**
     * Quantised to the 255 steps the compositor can actually express, so a
     * fade running at 1/20 s per frame does not write a new style string for a
     * change no display can show.
     */
    set(v) {
      const a = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255) / 255;
      if (a === shown) return;

      // Rising out of nothing is the only moment the colour may change.
      if (shown === 0 && a > 0 && tint !== pending) {
        tint = pending;
        el.style.background = tint;
      }

      shown = a;
      el.style.opacity = String(a);
      // Off the compositor entirely when there is nothing to cover, which is
      // every frame of the game except about twenty of them.
      el.style.visibility = a === 0 ? 'hidden' : 'visible';
    },
  };
}

/**
 * The two colours, named rather than inlined because the exit one is not white.
 *
 * A blown highlight on a real sensor is not #ffffff, it is the scene's own light
 * clipped, and out here that light is desert sun off limestone - warm. Pure white
 * reads as a UI flash, an alert, something the interface is doing to you. Pulling
 * it a few points toward the sand keeps it reading as the world being too bright
 * to look at, which is the thing being sold.
 */
const VEIL_IN = '#000';
const VEIL_OUT = '#fffaf0';

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

  const curtain = createCurtain();

  /**
   * Where the curtain is in its life.
   *
   *   idle   - the curtain is whatever the player's position asks for, and
   *            that is usually nothing. This is the only phase in which the
   *            screen can lighten by walking backwards, and it is also the
   *            only phase in which a swap may start.
   *   settle - full black, holding, while the new world draws its first
   *            frames. Ends on a frame count that only ever goes up.
   *   in     - lifting, on the clamped delta. Ends at zero.
   */
  const transition = { phase: 'idle', renders: 0, reveal: FADE_IN_SECONDS };

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

  /**
   * BOTH MAPS COVER EVERY PROFILE rooms.js USES TODAY, and the `||` is what will
   * hide it the day one of them does not.
   *
   * A room's `lightingProfile` is authored in rooms.js and translated here into
   * a reverb space and an ambience bed. The five profiles in use are corridor,
   * chamber, gallery, shaft and sanctum, and both maps carry all five. So these
   * fallbacks never fire in the shipping map and are pure insurance.
   *
   * The trouble is what insurance costs when the map grows. World 2 and World 3
   * will add profiles; an unmapped one would take chamber's reverb and chamber's
   * bed in a room designed for neither, and nothing anywhere would say so. That
   * is exactly how the courtyard played sealed-room ambience for weeks, see the
   * post-mortem at main.js:859 and the note on startAmbience in core/audio.js.
   *
   * So the fallback stays, because wrong tone beats silence when a player is
   * walking through a door, and the SUBSTITUTION is reported. It is quiet while
   * the maps are complete, which is today, and it is loud the moment a profile
   * is added without an entry, which is the only time anyone needs telling.
   */
  const reportedMissing = new Set();

  function applyRoomAudio(room) {
    if (!audio || !room) return;
    const profile = room.lightingProfile;

    const space = SPACE_FOR[profile];
    const ambience = AMBIENCE_FOR[profile];

    // Once per profile per session. This runs on every portal crossing and a
    // warning per doorway would train everyone to ignore the console, which is
    // the same disease as a suite that is always red.
    if ((!space || !ambience) && !reportedMissing.has(profile)) {
      reportedMissing.add(profile);
      console.warn(
        `[spaces] lightingProfile "${profile}" has no ${!space ? 'SPACE_FOR' : ''}` +
        `${!space && !ambience ? ' and no ' : ''}${!ambience ? 'AMBIENCE_FOR' : ''} entry. ` +
        'Falling back to chamber, which is almost certainly wrong for this room.'
      );
    }

    audio.setSpace(space || 'chamber');
    audio.startAmbience(ambience || 'chamber');
  }

  // ---------------------------------------------------------------------------
  // transitions
  // ---------------------------------------------------------------------------

  /**
   * Resolve the curtain for this frame.
   *
   * Called once per frame from doors.js, which is the only system that knows
   * where the thresholds are and therefore the only one that can say how much
   * black the player's position is asking for. Called from THERE rather than
   * from the frame loop for one practical reason: doors.update() is already
   * handed the clamped delta and already runs before the composer, so wiring
   * this needed no change to main.js at all.
   *
   * @param {number} dt       the loop's CLAMPED delta
   * @param {number} demand   0..1 asked for by proximity to a threshold
   */
  function veilTick(dt, demand = 0) {
    if (transition.phase === 'settle') {
      curtain.set(1);
      // Counted after the set, so this frame's render is the one being
      // counted: veilTick runs before the composer, every frame.
      if (++transition.renders >= SETTLE_RENDERS) transition.phase = 'in';
      return;
    }

    if (transition.phase === 'in') {
      const next = curtain.value - dt / transition.reveal;
      if (next <= 0) transition.phase = 'idle';
      curtain.set(next);
      return;
    }

    /**
     * The colour is asked for from the space being LEFT, every idle frame, and
     * the curtain decides whether it is allowed to take it. Inside means the
     * next threshold crossed is the way out, so the fade that starts here is the
     * blow-out; outside it is the blackout.
     *
     * Asked for here rather than at the moment the fade begins because there is
     * no such moment to hook: the fade is a function of DISTANCE, not an event,
     * so the frame the demand first goes positive is the only edge there is and
     * it is the curtain that can see it.
     */
    curtain.setTint(active === 'interior' ? VEIL_OUT : VEIL_IN);
    curtain.set(demand);
  }

  /**
   * Move the player between worlds.
   *
   * @param {'exterior'|'interior'} name
   * @param {{x:number, z:number, rot:number}} [at]  where to put them down
   */
  function enter(name, at) {
    if (name === active) return false;

    // THE ONE INVARIANT: nothing below this line is ever rendered through a
    // camera that has not caught up with it.
    //
    // Every route a player can walk into this function has already brought the
    // curtain to 1, because doors.js fades on DISTANCE and the threshold line
    // sits past the point the fade completes - so this call is a no-op on a
    // real entry and can be read as an assertion. It is not a no-op for a
    // harness that teleports straight onto the threshold, and for that case a
    // hard cut to black is the right trade: an ugly cut is a complaint, the
    // wrong world for one frame is the bug.
    //
    // Reading it BEFORE the set is what tells the two cases apart. See
    // CUT_IN_SECONDS: a screen that was already black is one the player walked
    // into, and it is the only one that has earned a slow reveal.
    const walkedIn = curtain.value >= 1;
    curtain.set(1);

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

    // Hold, and let the expensive frame happen where nobody can see it. The
    // counter restarts here rather than accumulating, so a second transition
    // gets its own full hold and not the tail of the last one's.
    transition.phase = 'settle';
    transition.renders = 0;
    transition.reveal = walkedIn ? FADE_IN_SECONDS : CUT_IN_SECONDS;

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
    veilTick,

    /** Called from the frame loop while inside, to hold the sky down. */
    tick() {
      if (active === 'interior') holdSkyDown();
    },

    /**
     * What the curtain is doing, for the harness and for anything that needs
     * to know a transition is in flight. A COPY, not the live object: this is
     * a readout, and a caller that can write `phase` can strand the player in
     * the dark.
     */
    get transition() {
      return { phase: transition.phase, veil: curtain.value, reveal: transition.reveal };
    },

    get active() { return active; },
    get roomId() { return roomId; },
    get room() { return roomId ? interior.rooms.find((r) => r.id === roomId) : null; },
  };
}
