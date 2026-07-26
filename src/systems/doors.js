/**
 * Buy-doors: the loop the whole map is built around.
 *
 * A barrier is a price tag with geometry attached. Look at one, see what it
 * costs, pay it, and the map gets bigger. That is the entire mechanic, and it
 * is load-bearing for two reasons: it paces how fast the player meets the map,
 * and it gives gold somewhere to go, which is what makes gold worth earning.
 *
 * The split with world/build.js is deliberate. build.js owns what a barrier IS
 * (meshes, colliders, the animation that clears it). This file owns what it
 * COSTS, whether it may be bought at all, and what it says when it may not.
 * Neither knows how the other does its half, which is what lets the geometry be
 * retuned without touching the economy and the prices be retuned in rooms.js
 * without touching geometry.
 *
 * Three kinds of refusal, and they read differently on purpose:
 *   - too poor:  the price goes red. The door is for sale, you are short.
 *   - power:     no price at all. It is not for sale, it needs the Kindling.
 *   - puzzle:    no price at all. It needs the four sons returned.
 * A player who cannot tell "come back richer" from "come back later" will grind
 * gold at a door that will never open for gold.
 *
 * Every rate in here is multiplied by the clamped frame delta, including the
 * courtyard slab's descent, so a backgrounded tab resumes with the door part
 * way open rather than having finished it while nobody was watching.
 */

import * as THREE from 'three';
import { ENTRY } from '../world/rooms.js';

/** How far the player can reach a barrier from, in world units. */
const REACH = 5.5;

/** Seconds for the courtyard slab to grind down out of its doorway. */
const SLAB_SECONDS = 1.6;

/**
 * The threshold the player crosses to be taken inside, and the one they cross
 * to come back out.
 *
 * Both sit a short walk PAST the doorway they belong to rather than in it, so
 * paying for the door does not itself trigger the transition. The player pays,
 * watches the stone move, and then walks through it. That step is the whole
 * moment.
 */
const ENTER_AT = { z: -31.6, halfWidth: 2.6 };
const EXIT_AT = { z: -140.8, halfWidth: 2.2 };

/** Where the player is put down when they come back out of the pyramid. */
const RETURN_TO = { x: 0, z: -27.0, rot: Math.PI };

export function createDoors({
  scene, camera, player, economy, audio, spaces, interior,
  courtyard, prompt, notice,
}) {
  /** Meshes a look-at ray may hit, per space. Explicit lists, because handing
   * a raycaster the whole scene would test five hundred interior meshes and
   * the entire courtyard every frame for an answer that involves nine doors. */
  const courtyardTargets = [];
  const interiorTargets = [];

  const state = {
    /** How many canopic jars are back in their niches. The puzzle gate reads
     * this; the jar system that will write it lands with M5. */
    jarsReturned: 0,
    /** Set once the courtyard's collider has actually been released, so a
     * harness can tell a working purchase from a purchase that changed a flag
     * and left the doorway solid. */
    doorwayCleared: false,
    bought: 0,
    denied: 0,
    entered: 0,
  };

  const ray = new THREE.Raycaster();
  const centre = new THREE.Vector2(0, 0);

  let candidate = null;

  // ---------------------------------------------------------------------------
  // the courtyard's sealed doorway
  // ---------------------------------------------------------------------------

  /**
   * Wrap the courtyard's granite slab in the same record shape the interior
   * barriers use, so the prompt and the purchase path have exactly one kind of
   * thing to handle.
   *
   * The slab is read out of the scene graph rather than built here: it is a
   * courtyard object, authored in the courtyard, and this file has no business
   * owning a second copy of it.
   */
  function makeSealedDoorway() {
    const slab = scene.getObjectByName('sealed-doorway');
    if (!slab || !slab.parent) return null;

    const frame = slab.parent;

    // The moving parts are the pieces standing proud of the jamb line: the
    // slab itself and the sun-disc mounted on its face. The jambs, lintel, and
    // cornice sit ON the line and are the doorway, not the door.
    const parts = frame.children
      .filter((o) => o.isMesh && o.position.z > 0.2)
      .map((o) => ({ mesh: o, y0: o.position.y }));

    const drop = 9.4;   // the slab is 8.6 tall and its foot is on the sand

    const record = {
      type: 'door',
      id: 'courtyard/entry',
      kind: ENTRY.kind,
      cost: ENTRY.cost,
      label: 'Sealed Doorway',
      x: frame.position.x,
      z: frame.position.z,
      opened: false,
      opening: false,

      open() {
        if (record.opened || record.opening) return false;
        record.opening = true;
        releaseDoorway();
        return true;
      },
    };

    let t = 0;
    record.advance = (dt) => {
      if (!record.opening) return;

      t = Math.min(1, t + dt / SLAB_SECONDS);
      // Ease out. Nine tonnes of granite does not stop dead.
      const k = 1 - Math.pow(1 - t, 3);
      for (const p of parts) p.mesh.position.y = p.y0 - drop * k;

      if (t >= 1) {
        record.opening = false;
        record.opened = true;
        for (const p of parts) p.mesh.visible = false;
      }
    };

    for (const p of parts) p.mesh.userData.door = record;
    courtyardTargets.push(...parts.map((p) => p.mesh));

    return record;
  }

  /**
   * Let the player through the doorway they just paid for.
   *
   * Two collider edits, and the second is the one that is easy to miss. The
   * slab's own disc obviously has to go. But the pyramid is also a collider - a
   * single 32-unit cylinder standing in for a 62-unit stepped mass - and its
   * edge falls almost exactly on the doorway. With it in place the player is
   * held half a metre off the open door and can never step through.
   *
   * It is nudged back and narrowed rather than deleted. Deleting it would leave
   * the whole exterior pyramid non-solid, and the player would walk into the
   * side of it. Sliding the disc two units further into the mass leaves four
   * units of clear approach at the doorway and still seals every face, which is
   * all the original disc ever did: a circle inscribed in a square never
   * covered the corners either.
   */
  function releaseDoorway() {
    const list = courtyard.colliders;

    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (Math.abs(c.x) < 0.2 && Math.abs(c.z + 30.2) < 0.2 && c.r > 2.5 && c.r < 4) {
        list.splice(i, 1);
        state.doorwayCleared = true;
      }
    }

    for (const c of list) {
      if (Math.abs(c.x) < 0.2 && Math.abs(c.z + 62) < 0.5 && c.r > 25) {
        c.z = -64;
        c.r = 30;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // the interior
  // ---------------------------------------------------------------------------

  const sealed = makeSealedDoorway();

  for (const b of interior.barriers) {
    b.type = 'door';
    // Named for the room on the far side, which is what the player is buying.
    // Portals are authored on the room nearer the entrance, so `to` is always
    // the side the player has not seen yet.
    b.label = roomName(b.to);
    interiorTargets.push(...b.meshes);
  }

  /**
   * The Kindling. Not a door, but it is the gate condition for one, and the
   * player interacts with it the same way, so it lives on the same prompt.
   */
  const kindling = (() => {
    const slot = interior.interacts.find((i) => i.type === 'power');
    if (!slot) return null;

    const record = {
      type: 'switch',
      id: 'kindling',
      label: (slot.config && slot.config.label) || 'The Kindling',
      thrown: false,
    };

    slot.group.traverse((o) => { if (o.isMesh) o.userData.door = record; });
    slot.group.traverse((o) => { if (o.isMesh) interiorTargets.push(o); });

    return record;
  })();

  function roomName(id) {
    const room = interior.rooms.find((r) => r.id === id);
    return room ? room.name : 'Passage';
  }

  // ---------------------------------------------------------------------------
  // gates
  // ---------------------------------------------------------------------------

  /**
   * Why this barrier will not open, or null if gold is the only obstacle.
   * A gated barrier never shows a price: it is not for sale at any figure.
   */
  function lockedBecause(rec) {
    if (rec.kind === 'power') {
      return interior.powered ? null : 'The Kindling is cold';
    }
    if (rec.kind === 'puzzle') {
      return `${state.jarsReturned} of 4 sons returned`;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // prompt
  // ---------------------------------------------------------------------------

  let promptText = '';
  let promptDeny = false;

  function setPrompt(text, deny) {
    if (text === promptText && deny === promptDeny) return;
    promptText = text;
    promptDeny = deny;

    if (!prompt) return;
    prompt.textContent = text;
    prompt.classList.toggle('on', !!text);
    prompt.classList.toggle('deny', !!deny);
  }

  function describe(rec) {
    if (!rec) return { text: '', deny: false };

    if (rec.type === 'switch') {
      return rec.thrown
        ? { text: '', deny: false }
        : { text: `${rec.label.toUpperCase()}  [F]`, deny: false };
    }

    const why = lockedBecause(rec);
    if (why) return { text: `${rec.label.toUpperCase()} - ${why.toUpperCase()}`, deny: true };

    // A gate whose condition has been met has no price to quote. The power
    // gate costs nothing once the Kindling is lit; the payment was the trip to
    // the embalming chamber.
    if (rec.cost <= 0) return { text: `OPEN ${rec.label.toUpperCase()}  [F]`, deny: false };

    const afford = economy.canAfford(rec.cost);
    return {
      text: `${rec.label.toUpperCase()} - ${rec.cost} GOLD${afford ? '  [F]' : ''}`,
      deny: !afford,
    };
  }

  // ---------------------------------------------------------------------------
  // interaction
  // ---------------------------------------------------------------------------

  function deny(message) {
    state.denied++;
    audio?.purchaseDenied?.();
    if (message && notice) notice(message, 1600);
    return false;
  }

  /** The F key. Returns true only if something in the world actually changed. */
  function interact() {
    const rec = candidate;
    if (!rec) return false;

    if (rec.type === 'switch') {
      if (rec.thrown) return false;
      rec.thrown = true;
      interior.setPowered(true);
      audio?.bossHorn?.();
      notice?.('The Kindling is lit', 2600);
      return true;
    }

    if (rec.opened || rec.opening) return false;

    const why = lockedBecause(rec);
    if (why) return deny(why);

    if (!economy.canAfford(rec.cost)) {
      return deny(`Need ${rec.cost - economy.gold} more gold`);
    }

    // spend() is the purchase. Checking affordability and then deducting as two
    // steps invites the state to change in between; this way the deduction
    // either happens or the buy did not. A free gate skips it entirely: spend()
    // refuses a zero charge, and rightly, so asking it to make one is a bug.
    if (rec.cost > 0 && !economy.spend(rec.cost, rec.id)) return deny();

    rec.open();
    state.bought++;
    audio?.shrineChime?.();

    if (rec.id === 'courtyard/entry') notice?.('The way is open', 2600);
    return true;
  }

  // ---------------------------------------------------------------------------
  // thresholds
  // ---------------------------------------------------------------------------

  /**
   * Teleport, not a tunnel, and the reason is in rooms.js: the interior is a
   * separate cell 110 units beyond the courtyard's outer wall, because the
   * playable interior is several times larger than the 62-unit stepped mass
   * that reads correctly on the skyline. There is no scale at which both are
   * true, so the two spaces are never both real at once. The doorway is the
   * seam, and it is hidden by the one thing that hides a seam perfectly: the
   * player walks through a hole in a wall and comes out somewhere dark.
   */
  function checkThresholds() {
    const p = player.position;

    if (spaces.active === 'exterior') {
      if (!sealed || !sealed.opened) return;
      if (p.z > ENTER_AT.z || Math.abs(p.x) > ENTER_AT.halfWidth) return;

      spaces.enter('interior', ENTRY.spawn);
      state.entered++;
      return;
    }

    // Coming back out. Without this the player can walk through the entry
    // doorway from the inside and out over a floor that does not exist.
    if (p.z < EXIT_AT.z || Math.abs(p.x) > EXIT_AT.halfWidth) return;
    spaces.enter('exterior', RETURN_TO);
  }

  // ---------------------------------------------------------------------------
  // frame
  // ---------------------------------------------------------------------------

  function pick() {
    const list = spaces.active === 'interior' ? interiorTargets : courtyardTargets;
    if (!list.length) return null;

    ray.setFromCamera(centre, camera);
    ray.far = REACH;

    const hits = ray.intersectObjects(list, false);
    for (const h of hits) {
      const rec = h.object.userData.door;
      if (!rec) continue;
      if (rec.type === 'switch') return rec.thrown ? null : rec;
      if (rec.opened || rec.opening) continue;
      return rec;
    }

    return null;
  }

  function update(dt) {
    if (sealed) sealed.advance(dt);

    candidate = pick();
    const { text, deny: red } = describe(candidate);
    setPrompt(text, red);

    checkThresholds();
  }

  return {
    state,
    update,
    interact,

    /** The barrier currently under the crosshair, for the harness and the HUD. */
    get candidate() { return candidate; },
    get prompt() { return promptText; },

    /** Every door in the game, courtyard slab first. */
    get all() { return sealed ? [sealed, ...interior.barriers] : interior.barriers.slice(); },

    byId(id) { return this.all.find((d) => d.id === id) || null; },
  };
}
