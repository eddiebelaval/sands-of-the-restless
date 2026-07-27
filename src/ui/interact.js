/**
 * The crosshair interaction layer for fixtures: wall buys, shrines, the Altar.
 *
 * This is systems/doors.js's pattern, applied to the things that are not doors.
 * Deliberately so, because the door loop is the one part of this game the owner
 * has said outright feels right, and everything the player buys should feel like
 * it came from the same hand:
 *
 *   - one raycast from the exact centre of the screen, against an EXPLICIT
 *     target list rather than the whole scene
 *   - a prompt that quotes the price when the thing is for sale
 *   - a prompt that turns red and drops the [F] when you are short
 *   - a prompt that quotes NO PRICE AT ALL when the thing is not for sale at
 *     any figure, because a player who cannot tell "come back richer" from
 *     "come back later" will stand in front of a dark shrine grinding gold for
 *     a purchase that will never be offered
 *
 * What this file does NOT own is what anything costs or what buying it does.
 * Each fixture type registers a handler with two methods - describe() and buy()
 * - and this file only picks what is under the crosshair and routes the F key
 * to it. Same split doors.js keeps with world/build.js, for the same reason:
 * prices move without geometry moving, and geometry moves without prices.
 */

import * as THREE from 'three';

/**
 * How far the player can reach a fixture from, in world units.
 *
 * The same number doors.js uses. Two different reaches would be felt long
 * before they were understood: the player would learn one distance from the
 * doors and then find the shrines refusing them at it.
 */
const REACH = 5.5;

export function createInteracts({ camera, interior, spaces, prompt, handlers = {} }) {
  /**
   * Meshes a look-at ray may hit. An explicit list, because handing a raycaster
   * the interior group would test several hundred wall and prop meshes every
   * frame to answer a question about eleven fixtures.
   */
  const targets = [];

  /** Every fixture with a handler, in build order. */
  const records = [];

  for (const slot of interior.interacts) {
    if (!handlers[slot.type]) continue;
    records.push(slot);

    // `noPick` is how a fixture keeps its own effects out of its own hitbox.
    // The mystery box's beam is a five-metre cone of additive light standing on
    // top of a one-metre chest, and without this the prompt for the chest
    // appears when the player is looking at the ceiling three metres above it.
    // Note that three.js does NOT skip invisible objects when raycasting, so
    // "it is hidden most of the time" is not a defence.
    slot.group.traverse((o) => {
      if (o.isMesh && !o.userData.noPick) targets.push(o);
    });
  }

  const ray = new THREE.Raycaster();
  const centre = new THREE.Vector2(0, 0);

  let candidate = null;

  const state = {
    bought: 0,
    denied: 0,
  };

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

  /**
   * Ask the fixture's owner what to say.
   *
   * A handler returns `{ text, deny }` and may return an empty text to mean
   * "nothing to offer here" - a wall buy the player already owns and is not
   * carrying, say. An empty prompt is not an error and must not become one:
   * silence is the correct output for a fixture that has nothing to sell you
   * this second.
   */
  function describe(rec) {
    if (!rec) return { text: '', deny: false };

    const h = handlers[rec.type];
    if (!h || !h.describe) return { text: '', deny: false };

    const out = h.describe(rec) || {};
    return { text: out.text || '', deny: !!out.deny };
  }

  // ---------------------------------------------------------------------------
  // interaction
  // ---------------------------------------------------------------------------

  /** The F key, for fixtures. True only if something in the world changed. */
  function interact() {
    const rec = candidate;
    if (!rec) return false;

    const h = handlers[rec.type];
    if (!h || !h.buy) return false;

    const ok = h.buy(rec);
    if (ok) state.bought++;
    else state.denied++;
    return ok;
  }

  // ---------------------------------------------------------------------------
  // frame
  // ---------------------------------------------------------------------------

  function pick() {
    // The interior is the only space with fixtures in it. Outside, this whole
    // system is a no-op and must not be paying for a raycast against a hidden
    // group to find that out.
    if (spaces.active !== 'interior' || !targets.length) return null;

    ray.setFromCamera(centre, camera);
    ray.far = REACH;

    const hits = ray.intersectObjects(targets, false);
    for (const h of hits) {
      const rec = h.object.userData.interact;
      if (rec && handlers[rec.type]) return rec;
    }

    return null;
  }

  function update() {
    candidate = pick();
    const { text, deny } = describe(candidate);
    setPrompt(text, deny);
  }

  return {
    state,
    update,
    interact,
    records,

    /** The fixture currently under the crosshair, for the HUD and the harness. */
    get candidate() { return candidate; },
    get prompt() { return promptText; },
    get deny() { return promptDeny; },

    byId(id) {
      return records.find((r) => r.id === id)
        || records.find((r) => (r.config && r.config.boon) === id)
        || records.find((r) => (r.config && r.config.weapon) === id)
        || null;
    },
  };
}
