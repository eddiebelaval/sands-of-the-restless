/**
 * HER VOICE - the five things the archaeologist says in World 1.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE HAD TO EXIST BEFORE ANYTHING ELSE IN THE STORY WORKED
 * ---------------------------------------------------------------------------
 *
 * Until now she spoke ONCE. `ui/pacer.js` held `THE_INTERRUPTED_LINE` and the
 * jar chain fired it, and that was the whole of her.
 *
 * Which meant the best beat in World 1 did not exist. The design is that she
 * asks the player four questions across a world, in a recognisable shape, always
 * offering him the chance to correct her, and he never takes it - and then, at
 * the machine, she starts a fifth and the power notice lands on top of her
 * mid-sentence and she never speaks again. `docs/PLAYTHROUGH.md` finding 3 states
 * the consequence plainly: with only line 5 in the game, the beat reads as *a
 * woman who has never spoken being interrupted, and then not speaking again*,
 * which is nothing. An interruption needs a pattern to interrupt.
 *
 * So this is not four extra lines of flavour. It is the thing that makes the one
 * line already in the game mean anything.
 *
 * ---------------------------------------------------------------------------
 * WHAT SHE IS ACTUALLY ASKING
 * ---------------------------------------------------------------------------
 *
 * Never "how are you alive". That question is unaskable, so she goes around it,
 * and every one of them is her checking whether SHE is the one who is wrong. The
 * strings are `docs/WORLD-1.md` verbatim, lowercase, including the punctuation
 * she does not use - she is the only lowercase text in a game where every other
 * character on screen is a capital, and that is her entire attribution. No name
 * tag, no portrait, no new UI element.
 *
 * ---------------------------------------------------------------------------
 * THE GATE, AND WHY FAILING IT DEFERS RATHER THAN DROPS
 * ---------------------------------------------------------------------------
 *
 * A room is entered once. A line dropped because the player happened to walk in
 * mid-wave is a line that never exists for that run, and four of the five would
 * be lost by any player who moves quickly - which is every player who is good at
 * the game. So a line that fails its gate stays armed and takes the next
 * opportunity: a slightly wrong room and a completely correct beat, which is the
 * right way round.
 *
 * `docs/STORY-DELIVERY.md` measured the budget and there is no scarcity problem.
 * Normal gives a 6.0 second breather and `director.js` only enters it when the
 * field is empty, so 25 waves is about 144 seconds of guaranteed quiet against a
 * script of five lines - roughly 8 to 1.
 */

import { THE_INTERRUPTED_LINE } from '../ui/pacer.js';

/**
 * THE FIVE, in the order the map hands them over.
 *
 * `room` is the `spaces.roomId` that arms the line. `overFight` opts out of the
 * breather requirement. Line 5 has no room of its own because it is not fired
 * from here at all - see the note on it.
 */
export const LINES = [
  {
    id: 'avenue',
    room: 'courtyard',
    text: 'i keep thinking you were further back. that walk in.',
    /*
     * SHE IS DESCRIBING THE ORDER THEY WALKED IN WHEN HE WAS KILLED, and asking
     * him to tell her she has it wrong. On a first run it is small talk under
     * stress. It is the only one of the five a player is guaranteed to hear,
     * because the courtyard is where the game starts.
     */
  },
  {
    id: 'inside',
    room: 'chamber-of-ascent',
    text: "i can't get the door open from in here. how many of us came in.",
    /*
     * TWO JOBS, AND THE FIRST ONE IS NEW.
     *
     * The owner's siege, 2026-08-08: she is sealed in the Serdab and cannot come
     * out until the dead are down. This is the only line in the game that says
     * so out loud, and it says it in six words while she is busy asking about
     * something else - which is how a person who has been stuck for four days
     * actually mentions it, and keeps it from reading as a quest brief.
     *
     * The second job is the original one: she is counting the crew and getting a
     * number she cannot make work, because the number she keeps arriving at
     * includes him. The player has the manifest and she does not know it.
     */
  },
  {
    id: 'gallery',
    room: 'great-gallery',
    text: 'you sound-',
    /*
     * MID-FIGHT, FROM A LEDGE SIX METRES UP, IN THE LOUDEST ROOM IN THE MAP, and
     * the player is not meant to hear it properly. She almost has it and stops
     * herself. `docs/WORLD-1.md` calls this the owner's "very intense scene" and
     * fixes that it passes by.
     *
     * It is also a REMOVAL INSIDE THE PATTERN: a line that stops short, twenty
     * waves before the line that stops short. It pre-trains the player on her
     * being cut off without them ever knowing they were trained.
     */
    overFight: true,
  },
  {
    id: 'crypt',
    room: 'canopic-crypt',
    text: "did anything happen down there. anything you'd want to tell me.",
    /*
     * The last question she ever finishes. She is holding the door open for him
     * to say it, and he cannot, because the player character has no voice - which
     * is so ordinary in a first-person game that nobody notices it is happening.
     * To her it is a man who will not speak.
     */
  },
];

/**
 * LINE 5 IS NOT FIRED FROM HERE, and that is deliberate.
 *
 * It is not a room entry, it is a COLLISION: she starts it and the Kindling
 * notice overwrites her, composed to the frame in data by `cutAt`. The only
 * thing that knows when the third jar seats is the jar chain, so the jar chain
 * owns the call - `systems/jars.js` already makes it and this file must not make
 * a second one.
 *
 * Re-exported so there is one import site for her voice rather than two, and so
 * a reader of this file sees all five.
 */
export { THE_INTERRUPTED_LINE };

export function createVoice({ pacer, spaces, director, save = null }) {
  const state = {
    /** Ids that have been spoken this run. */
    said: new Set(),
    /** Ids armed by a room entry and still waiting for a quiet moment. */
    armed: new Set(),
    /** How many were deferred rather than dropped, for the harness. */
    deferrals: 0,
    /** The last room this saw, so entry is an edge and not a level. */
    room: null,
  };

  const byId = new Map(LINES.map((l) => [l.id, l]));

  /** Is the world quiet enough for a line that is not flagged overFight. */
  function quiet(line) {
    if (!director) return true;
    // NEVER OVER A BOSS. `docs/WORLD-1.md`: her lines defer rather than spend
    // the pattern on the one wave nobody will hear it.
    if (director.boss) return false;
    if (line.overFight) return true;
    return director.state.phase === 'breather';
  }

  /** Is the pill free. A system notice may be mid-reveal. */
  function free() {
    const s = pacer?.stats?.();
    if (!s) return true;
    return !s.holding;
  }

  function speak(line) {
    if (!pacer?.speak) return false;
    const ok = pacer.speak(line.text, { voice: 'her' });
    if (!ok) return false;
    state.said.add(line.id);
    state.armed.delete(line.id);
    return true;
  }

  function update() {
    // ---- arm on the EDGE of a room entry ---------------------------------
    const now = spaces?.roomId ?? (spaces?.active === 'courtyard' ? 'courtyard' : null);
    if (now !== state.room) {
      state.room = now;
      for (const line of LINES) {
        if (line.room !== now) continue;
        if (state.said.has(line.id) || state.armed.has(line.id)) continue;
        state.armed.add(line.id);
      }
    }

    if (!state.armed.size) return;

    // ---- fire the first armed line that can be heard ---------------------
    //
    // In authored order, not in arming order, so a player who doubles back does
    // not hear line 4 before line 2. The five are a sequence she is building,
    // and out of order they stop being one person thinking.
    for (const line of LINES) {
      if (!state.armed.has(line.id)) continue;
      if (!quiet(line) || !free()) { state.deferrals++; return; }
      speak(line);
      return;
    }
  }

  function reset() {
    state.said.clear();
    state.armed.clear();
    state.deferrals = 0;
    state.room = null;
  }

  return {
    update,
    reset,
    LINES,
    /** For the harness. Nothing on screen reads this. */
    stats() {
      return {
        said: [...state.said],
        armed: [...state.armed],
        deferrals: state.deferrals,
        room: state.room,
        total: LINES.length,
      };
    },
  };
}
