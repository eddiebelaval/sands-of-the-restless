/**
 * THE KINDLING: the one switch the second half of the map hangs off.
 *
 * There is exactly one of these, it is in the Embalming Chamber, and until it
 * is thrown every shrine in the pyramid refuses. The refusal is the point. A
 * shrine that says "you cannot afford this" teaches the player to go and earn
 * more gold; a shrine that says THIS SHRINE IS DARK teaches them that there is
 * something else in the map they have not found yet, and sends them looking for
 * it. Those are opposite behaviours and they are separated by one line of copy,
 * which is why the copy lives in a constant with a comment on it rather than
 * inline at the call site.
 *
 * WHERE THE SEAM IS, and why it is here rather than somewhere tidier:
 *
 * systems/doors.js already owns the raycast, the prompt and the F key for the
 * switch itself - it picked up the power slot when the buy-doors were built,
 * because a switch is interacted with exactly like a door and giving it a
 * second interaction path would mean two systems fighting over one prompt. That
 * still holds and it still works, so it has not been moved. What was missing is
 * everything AROUND the throw: this file.
 *
 * Both paths meet at `interior.setPowered()`, which is the choke point in
 * world/build.js and fires this file's listeners once and only once. So the
 * Kindling thrown by the player, by the harness, or by anything added later all
 * produce the same event, and neither this file nor doors.js has to know the
 * other exists.
 *
 * The lighting change itself is build.js's, deliberately: the interior owns its
 * own point lights and its own hemisphere fill, and reaching in from a systems
 * file to multiply intensities would be a second place that decides how bright a
 * room is. This file decides WHEN; build.js decides WHAT, and ramps it over a
 * second and a half so the throw is an event and not a flag.
 */

/**
 * Why a shrine will not take your gold.
 *
 * Present tense, about the FIXTURE and not about the player. "You need power"
 * is a system talking; "this shrine is dark" is the world talking, and the
 * second one is the one that makes somebody go looking for a light.
 */
export const DARK_REASON = 'This shrine is dark';

/** What the map says on the frame the switch goes over. */
const LIT_NOTICE = 'THE KINDLING TAKES - THE PYRAMID WAKES';

export function createPower({ interior, audio, notice }) {
  const state = {
    /** True once the switch has been thrown. The gate every shrine reads. */
    powered: false,
    /** How many times a fixture has refused for want of power. */
    refused: 0,
    /** Set on the frame of the throw, for the harness and for a future stinger. */
    thrownAt: null,
  };

  const listeners = new Set();

  /**
   * The Kindling's own interact record, wherever it came from.
   *
   * doors.js builds one and holds it; this looks it up rather than building a
   * second, because two records for one switch is exactly the kind of thing
   * that works until somebody asks which one is authoritative.
   */
  const slot = interior.interacts.find((i) => i.type === 'power') || null;

  // ---------------------------------------------------------------------------
  // the throw
  // ---------------------------------------------------------------------------

  /**
   * Everything that happens because the map has power now.
   *
   * Called from interior.setPowered's listener list, so it runs exactly once
   * however the switch was thrown. The light ramp has already started by the
   * time this runs - build.js kicks it in the same call - so the sound and the
   * notice land on the front of the ramp rather than after it, which is what
   * makes the two read as one event.
   */
  function onPowered(on) {
    if (!on || state.powered) return;

    state.powered = true;
    state.thrownAt = Date.now();

    // A horn, then a chime a beat later. The horn is the pyramid; the chime is
    // the six shrines. Two sounds because two things happened, and the gap
    // between them is what stops it reading as one undifferentiated noise.
    audio?.bossHorn?.();
    setTimeout(() => audio?.shrineChime?.(), 260);

    notice?.(LIT_NOTICE, 3200);

    for (const fn of listeners) fn(true);
  }

  const unsubscribe = interior.onPowered ? interior.onPowered(onPowered) : null;

  // If the switch was somehow already thrown before this system came up - a
  // harness, a reload, a future save - catch up rather than sit in a state that
  // contradicts the interior.
  if (interior.powered) onPowered(true);

  // ---------------------------------------------------------------------------
  // the gate
  // ---------------------------------------------------------------------------

  /**
   * Why a power-gated fixture will not open, or null if power is not the
   * problem. Same shape and same contract as doors.js's lockedBecause(), so a
   * caller can hand the result straight to a prompt.
   *
   * PURE. This runs once per frame for as long as the player is looking at a
   * dark shrine, so counting a refusal in here would report several hundred
   * refusals for one player standing still. The count is noteRefusal()'s job
   * and it is called from the purchase path, where a refusal is an event.
   */
  function lockedBecause() {
    return state.powered ? null : DARK_REASON;
  }

  /** A fixture actually turned a purchase away for want of power. */
  function noteRefusal() {
    state.refused++;
    return state.refused;
  }

  return {
    state,

    lockedBecause,
    noteRefusal,

    /** Register for the throw. Returns an unsubscribe. */
    onPowered(fn) {
      listeners.add(fn);
      if (state.powered) fn(true);
      return () => listeners.delete(fn);
    },

    /**
     * Throw it directly. The player's route is the F key on the switch, through
     * doors.js; this exists for the harness and for the day the puzzle chain
     * wants to light the map from somewhere else.
     *
     * doors.js keeps its own `thrown` flag on the switch so it can stop offering
     * the prompt, and that flag is private to it. A map lit through here will
     * therefore still prompt at the lever until somebody presses F on it once -
     * at which point interior.setPowered refuses the second throw and no event
     * fires twice. Cosmetic, contained, and preferable to reaching into another
     * system's state to fix it.
     */
    throwSwitch() {
      if (state.powered) return false;
      interior.setPowered(true);
      return true;
    },

    dispose() { if (unsubscribe) unsubscribe(); },

    get powered() { return state.powered; },
    get slot() { return slot; },
    get reason() { return DARK_REASON; },
  };
}
