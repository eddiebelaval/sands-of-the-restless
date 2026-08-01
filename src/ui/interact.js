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

/**
 * BOTH SPACES CAN SELL YOU SOMETHING.
 *
 * This layer took `interior` and nothing else, and the pick() below refused to
 * raycast at all unless the player was inside, so a fixture in the courtyard
 * was not merely unbuilt - it was unbuyable by construction. MAP.md puts the
 * B3AR wall in Act 1, outside, which made that the actual work rather than a
 * row in a stats table.
 *
 * The shape is systems/doors.js's, taken deliberately: that file has been
 * handed `interior` AND `courtyard` since the sealed doorway was built, and a
 * player who has learned to buy a door out of one of them should not have to
 * learn a second interface to buy a gun out of the other. One handler table,
 * one prompt, one F key, two sources of fixtures.
 *
 * Targets are kept PER SPACE rather than in one list, and that is not an
 * optimisation. three.js does not skip invisible objects when raycasting, so a
 * single pooled list would let the player stand in the pyramid and buy a
 * weapon off a plaque hanging in a courtyard that is not being drawn.
 */
export function createInteracts({ camera, interior, courtyard = null, spaces, prompt, handlers = {} }) {
  /**
   * Meshes a look-at ray may hit, keyed by the space they stand in. An explicit
   * list, because handing a raycaster the interior group would test several
   * hundred wall and prop meshes every frame to answer a question about eleven
   * fixtures.
   *
   * The keys are `spaces.active`'s own vocabulary, so pick() is a lookup rather
   * than a branch that has to be extended for the next space.
   */
  const targets = { interior: [], exterior: [] };

  /** Every fixture with a handler, in build order, inside then out. */
  const records = [];

  /**
   * Take one source's fixtures. A source is anything publishing an `interacts`
   * array of slot records - build.js's interior does, and the courtyard does
   * for the one fixture standing on the avenue wall.
   *
   * Tolerant of a missing source on purpose: the exterior did not have fixtures
   * until tonight, and the harness builds an interior with no courtyard at all.
   */
  const collect = (source, space) => {
    for (const slot of (source && source.interacts) || []) {
      if (!handlers[slot.type]) continue;
      records.push(slot);

      // `noPick` is how a fixture keeps its own effects out of its own hitbox.
      // The mystery box's beam is a five-metre cone of additive light standing
      // on top of a one-metre chest, and without this the prompt for the chest
      // appears when the player is looking at the ceiling three metres above it.
      // Note that three.js does NOT skip invisible objects when raycasting, so
      // "it is hidden most of the time" is not a defence.
      slot.group.traverse((o) => {
        if (o.isMesh && !o.userData.noPick) targets[space].push(o);
      });
    }
  };

  collect(interior, 'interior');
  collect(courtyard, 'exterior');

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
    // Only the space the player is standing in, and only if it has anything to
    // offer. A space with no fixtures must not pay for a raycast to find that
    // out, which is what this used to say about the whole outdoors.
    const list = targets[spaces.active];
    if (!list || !list.length) return null;

    ray.setFromCamera(centre, camera);
    ray.far = REACH;

    const hits = ray.intersectObjects(list, false);
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
