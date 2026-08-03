/**
 * THE FOUR-JAR CHAIN: the only puzzle in the game, and the spine of Acts 2 and 3.
 *
 * Four canopic jars stand in four rooms - one in the courtyard's west chapel,
 * one at the foot of the failed ascent in the Star Shaft, one in the Canopic
 * Crypt, one in the King's Chamber with the sarcophagus. Four niches wait in the
 * Embalming Chamber, one per son of Horus. The player carries them home one at a
 * time. The third one going home turns the building on; the fourth one opens the
 * sealed chapel at the bottom, which is the room World 1 ends in.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE EXISTS TO FIX
 * ---------------------------------------------------------------------------
 *
 * Every piece of this was already in the map except the verb. The jars were
 * meshed, collidered and published. The niches were authored, one per son, with
 * `accepts: 'canopic-jar'` written on them. The Serdab's portal was cut,
 * `kind: 'puzzle'`, cost zero. `systems/doors.js` declared a `jarsReturned`
 * counter and `ui/objective.js` printed it as the gate's detail line.
 *
 * And nothing anywhere wrote it. The counter was a literal 0 for the whole of
 * M4, so the puzzle gate quoted "0 of 4 sons returned" forever and the room the
 * world ends in could not be entered in a shipped build. That is the single
 * fact this file changes: the count is real, and it is written here.
 *
 * ---------------------------------------------------------------------------
 * THE SPLIT: THREE JARS RUN THE MACHINE, THE FOURTH OPENS THE ROOM
 * ---------------------------------------------------------------------------
 *
 * Not four-then-everything, and the first reason is a hard engineering one
 * rather than a dramatic one. JAR 4 IS IN THE KING'S CHAMBER, AND ONE OF THE
 * TWO DOORS INTO THE KING'S CHAMBER IS THE POWER GATE. On Normal there is a
 * second, free door from the Embalming Chamber so four-then-power is not
 * strictly circular; on Hard that free door is 1250 gold of debris, so a player
 * who has not paid it needs power to reach the jar that would give him power.
 * Three-then-one removes the dependency outright instead of relying on the
 * player having bought a door.
 *
 * It also paces the silence correctly - her last line is cut off on jar 3, which
 * lands around the Act 2 to Act 3 seam, and the quiet then runs through the
 * King's Chamber, jar 4, Set and the Serdab - and it makes the fourth jar the
 * only one that is both the last fragment and the thing that opens the door.
 *
 * ---------------------------------------------------------------------------
 * THE KINDLING: THE TRIGGER MOVED, THE SYSTEM DID NOT
 * ---------------------------------------------------------------------------
 *
 * `systems/power.js` is untouched by this change and so is every one of its
 * seven API members. Its own comment says it exists "for the day the puzzle
 * chain wants to light the map from somewhere else", and this is that day: the
 * third jar landing calls `power.throwSwitch()`, which is the same function the
 * harness has always used, which goes through `interior.setPowered` exactly as
 * the lever did. Six shrines, the light ramp across nine rooms, the horn, the
 * chime two hundred and sixty milliseconds later, the notice, and the power gate
 * into the King's Chamber all fire the way they always have, from a caller that
 * is not a lever.
 *
 * The fire bowl in the Embalming Chamber is still built and still lights. It has
 * stopped being a thing you pull, and that is the entire diff on the fixture.
 *
 * ---------------------------------------------------------------------------
 * THE BEAT THAT MUST NOT BE LOST
 * ---------------------------------------------------------------------------
 *
 * The archaeologist has been asking the player the same question in five
 * different shapes since the avenue, and on the third jar she finally starts the
 * real one. THE KINDLING TAKES - THE PYRAMID WAKES lands in the same one-line
 * pill and overwrites her mid-sentence, in a frame where nine rooms are coming
 * up and two sounds are landing and six shrines are waking and the player is
 * looking at anything else. She never speaks again.
 *
 * THIS FILE DOES NOT OWN HER VOICE and it does not own the copy either. Her
 * lines, the lowercase treatment that is her only attribution, the reveal rate,
 * the hold that stops a purchase confirmation eating her mid-word, and the
 * AUTHORED CUT POINT all live in `ui/pacer.js`, which exports the one line this
 * chain needs as `THE_INTERRUPTED_LINE` and documents this exact call site.
 *
 * What lives here is the ORDER, because the order is the beat: her line starts
 * on the frame the third jar seats, the pacer reveals it at reading speed and
 * stops it dead after "since we-", and the machine starts inside the callback
 * that fires there. The light across nine rooms, the horn, the chime and the
 * capitals all land on the frame her sentence stops.
 *
 * AND THE MACHINE IS NOT ALLOWED TO DEPEND ON THAT CALLBACK ARRIVING. See
 * KINDLE_DEADLINE_MS: whichever of the cut and the deadline comes first throws
 * the switch, and the other is a no-op. A puzzle chain that hangs because a
 * text effect did not finish is a bricked world with no error in it.
 *
 * ---------------------------------------------------------------------------
 * WHAT CARRYING ACTUALLY IS
 * ---------------------------------------------------------------------------
 *
 * No inventory, no slot, no HUD element. One nullable reference. The jar's
 * `vessel` group - its body and its stopper, and NOT the plinth they stand on,
 * see the note in world/build.js - is hidden when it is taken and reparented
 * into the niche when it is given. The plinth stays behind, which is both the
 * honest read and the reason the collider is not a lie: collision in this
 * codebase is the authored array and never the mesh graph, so hiding the whole
 * fixture would have left a knee-high invisible obstacle in a chapel.
 *
 * The player can hold exactly one. Four jars, four trips, and the map is the
 * puzzle.
 */

import { THE_INTERRUPTED_LINE } from '../ui/pacer.js';

/**
 * The sons, in the order the niches are authored. Uppercase at the point of
 * use, because the whole interface is capitals and a name that arrives already
 * shouted cannot be reused anywhere quieter.
 */
const SONS = {
  imsety: 'Imsety',
  hapy: 'Hapy',
  duamutef: 'Duamutef',
  qebehsenuef: 'Qebehsenuef',
};

/** How many jars run the machine. See THE SPLIT above. */
const MACHINE_AT = 3;

/** How many open the sealed chapel. */
const CHAPEL_AT = 4;

/**
 * Where the jar sits once it is home, in the niche group's own frame.
 *
 * Measured against what world/build.js's `niche` builder actually puts there
 * rather than eyeballed: the gold socket is a 0.28-tall cylinder centred at
 * y 1.34, so its lip is at 1.48, and the vessel's own jar mesh is 0.72 tall
 * centred at 1.26, so its base sits at 0.90 in vessel space. 1.48 - 0.90 is
 * this number, and it is what makes the jar STAND IN the socket rather than
 * float over it or sink through it. `z` is the socket's own 0.42, which is how
 * far the shelf stands proud of the recess.
 */
const SOCKET = { y: 0.58, z: 0.42 };

/**
 * HOW LONG THE MACHINE WILL WAIT FOR A UI CALLBACK BEFORE LIGHTING ITSELF.
 *
 * The Kindling is thrown at the authored cut point in her line, which is a
 * moment the TYPEWRITER decides - see `machine()`. That is right for the beat
 * and it is an unacceptable dependency for the map: if the reveal never reaches
 * its cut, because the tab was hidden or the cut string was edited out from
 * under it or the pill was cleared by something else, then six shrines, a
 * doorway and the whole back half of World 1 stay dark forever with no error
 * anywhere. A game system may not hang on a text effect.
 *
 * So the throw is ALSO backstopped, from this file's own update(), and the
 * PRIMARY backstop is not a clock at all: the typewriter publishes its phase,
 * and a reveal that has reached `done` without this file having been called
 * back is a cut that is never coming. That is exact, it costs one property
 * read a frame, and it cannot fire early.
 *
 * The wall-clock deadline below is the second belt, for the case where the
 * reveal is somehow still 'revealing' forever. IT IS DELIBERATELY ENORMOUS
 * against the 2.6 seconds the beat actually takes, and that is measured rather
 * than cautious: the typewriter advances on wall-clock milliseconds clamped to
 * 250 a frame, so under software rendering at about one frame a second the same
 * 2.6-second reveal takes eleven seconds of wall clock. A deadline tuned to the
 * line's nominal length would fire FIRST on exactly the machines the harness
 * runs on, throw the switch early, and destroy the beat it exists to protect -
 * while every check about power still passed. Thirty seconds cannot be reached
 * by a reveal that is progressing at all.
 */
const KINDLE_DEADLINE_MS = 30000;

/*
 * THE TWO-CLOCK GUARD USED TO LIVE HERE. IT IS GONE BECAUSE THE BUG IS GONE.
 *
 * The history is worth keeping, because the failure shape is one this project
 * keeps meeting. `ui/pacer.js` revealed a line on a PER-FRAME clock clamped to
 * 250 ms a frame, which is correct - it is what stops a backgrounded tab
 * dumping a whole line in one step - and then armed its teardown with
 * `setTimeout(duration + hold)`, which is WALL CLOCK. Above about four frames a
 * second the two track each other and nothing is wrong. Below it they diverge,
 * one-way: the reveal falls behind and the teardown does not wait for it.
 *
 * Measured under swiftshader at roughly one frame a second: her 2.34 s reveal
 * took about ten seconds of wall clock, the teardown fired at 3.8, the line was
 * wiped in flight, the authored cut was never reached and `onCut` never fired.
 * THE MAP STILL LIT, because the backstop below caught it, and the best beat in
 * World 1 was gone with every check about power still green.
 *
 * This file guarded it with a 12-second hold and said in its own comment that
 * the real fix belonged to the pacer. The pacer lane then made it: `arm()` is
 * deleted, and a spoken line's reveal, cut and hold are counted on ONE
 * per-frame clock inside the typewriter. So the guard came out, and the beat
 * was re-verified without it rather than assumed to survive - `test/jars.mjs`
 * and `test/e2e.mjs` both report `litVia: "cut"` with no hold override in the
 * call below. A guard that is never removed is a bug that is never fixed.
 */

/** What the fourth jar reveals. The cartouche is BUILD 5's; the name is hers. */
const THE_NAME = 'HETEPHERES';

/**
 * @param {object} parts
 * @param {object} parts.interior   world/build.js - publishes `jars`, `interacts`
 * @param {object} [parts.courtyard] world/courtyard.js - publishes `jars`
 * @param {object} parts.doors      systems/doors.js - THE counter lives on its state
 * @param {object} parts.power      systems/power.js - `throwSwitch()`, untouched
 * @param {object} [parts.audio]
 * @param {function} [parts.notice]
 */
export function createJars({ interior, courtyard = null, doors, power, audio, notice }) {
  /**
   * The notice pill's pacer, attached late.
   *
   * It is constructed a thousand lines below this system in main.js - the pill
   * is UI and this is a puzzle - so it arrives through attach() rather than
   * through the constructor, which is the same late binding the router, the
   * combat system and the shrines already use for the same reason.
   *
   * OPTIONAL, and the optionality is real rather than defensive: without it the
   * chain still lights the map and still writes her line to the plain notice
   * channel. What is lost is the reveal and the authored cut, which is a
   * presentation, and a puzzle that refuses to work without one would be a
   * puzzle with a UI dependency.
   */
  let pacer = null;
  /**
   * Every jar in the world, inside and out, as one list.
   *
   * Both sources publish the same record shape and the exterior one says so in
   * its own comment. Concatenating them here rather than asking each space for
   * its own is what makes "four jars" a fact this file can count rather than an
   * arrangement it has to reason about: the chain does not care that one of
   * them is on the far side of a thousand-gold door and a world swap.
   */
  const jars = [
    ...((courtyard && courtyard.jars) || []).map((j) => ({ ...j, space: 'exterior' })),
    ...((interior && interior.jars) || []).map((j) => ({ ...j, space: 'interior' })),
  ];

  /*
   * NORMALISED, BECAUSE THE TWO SOURCES DISAGREE ABOUT ONE LEVEL OF NESTING.
   *
   * The three inside are propSlots, so their identity is under `config` - that
   * is the shape every authored slot in rooms.js takes. The one outside is a
   * hand-built record in world/courtyard.js and carries `index` and `son` flat.
   * Both are correct in their own file and neither is going to change to suit
   * this one.
   *
   * So it is flattened HERE, once, at the boundary - rather than every read
   * site carrying `(rec.config ? rec.config.son : rec.son)`, which is the shape
   * that works until somebody adds the fifth read and writes only half of it.
   *
   * `id` so `interacts.byId` and the harness can name one; `taken` and `home` so
   * the handlers have somewhere to say the plinth is empty and the socket is
   * full. All of it on the copies above, never on the builders' own records.
   */
  for (const j of jars) {
    if (j.index === undefined) j.index = (j.config && j.config.index) || 0;
    if (j.son === undefined) j.son = (j.config && j.config.son) || '';
    // `room`, because every other fixture record in the game carries one and
    // ui/minimap.js sorts the two panels by exactly this field - `rec.room ===
    // 'courtyard'`. The three inside get theirs from build.js; the one outside
    // had none, and an absent room is not 'courtyard', so without this line the
    // jar standing in the west chapel would have been drawn on the map of the
    // inside of the pyramid.
    if (j.room === undefined) j.room = 'courtyard';
    j.id = `jar:${j.son}`;
    j.taken = false;
    j.home = false;
  }

  /** The four sockets, in authored order. Already interact records. */
  const niches = ((interior && interior.interacts) || [])
    .filter((i) => i.type === 'niche');

  const state = {
    /** The jar in the player's hands, or null. There is only ever one. */
    carrying: null,
    /** How many are home. The number `doors.state.jarsReturned` mirrors. */
    returned: 0,
    /** How many times a jar was picked up, including ones put back. */
    taken: 0,
    /** The wave-independent record of the two landmark frames, for the harness. */
    litAt: null,
    openedAt: null,
    /**
     * Her line, exactly as authored, recorded on the frame she started it.
     *
     * The pill cannot be asked afterwards - the whole point of the beat is that
     * her sentence does not survive - so what the game intended to say is
     * recorded by the thing that said it. `ui/pacer.js` owns the string; this
     * is a copy for the harness, not a second source.
     */
    interruptedLine: null,
    /** Set when the Serdab barrier was actually opened, not merely unlocked. */
    chapelOpened: false,
    /** When her last line started. The deadline above is measured from it. */
    spokeAt: null,
    /** 'cut' when the beat landed; anything else is a backstop having fired. */
    litVia: null,
  };

  const takeListeners = new Set();
  const homeListeners = new Set();

  /** UPPERCASE son, for a prompt. Falls back to the raw key rather than to ''. */
  const sonOf = (rec) => {
    const key = (rec && rec.config ? rec.config.son : rec && rec.son) || '';
    return (SONS[key] || key || 'HORUS').toUpperCase();
  };

  const nicheIndex = (rec) => (rec.config && rec.config.index) || 0;

  const filled = new Set();

  // ---------------------------------------------------------------------------
  // the counter
  // ---------------------------------------------------------------------------

  /**
   * Publish the count to the one place two other systems already read it.
   *
   * `doors.state.jarsReturned` gates the Serdab portal and supplies
   * `ui/objective.js`'s detail line, and both of those were written before this
   * file existed and were correct. Mirroring into it - rather than asking them
   * both to reach in here - keeps the number in the place its readers already
   * look and makes this function the only writer in the codebase.
   */
  function publish() {
    if (doors && doors.state) doors.state.jarsReturned = state.returned;
  }

  publish();

  // ---------------------------------------------------------------------------
  // taking
  // ---------------------------------------------------------------------------

  const jarHandler = {
    describe(rec) {
      if (rec.taken) return { text: '', deny: false };

      // Hands full. A refusal rather than silence, because the player standing
      // in front of a jar they cannot pick up has to be told WHY, and "you are
      // already carrying one" is a fact about them rather than about the jar.
      if (state.carrying) {
        return { text: `HANDS FULL - THE JAR OF ${sonOf(state.carrying)}`, deny: true };
      }

      return { text: `TAKE THE JAR OF ${sonOf(rec)}  [F]`, deny: false };
    },

    buy(rec) {
      if (rec.taken || state.carrying) return false;

      rec.taken = true;
      state.carrying = rec;
      state.taken++;

      // The vessel leaves the world. The plinth does not - see the note at the
      // top and the longer one in world/build.js.
      if (rec.vessel) rec.vessel.visible = false;

      audio?.shrineChime?.();
      notice?.(`THE JAR OF ${sonOf(rec)}`, 2200);

      /*
       * THE SEAM FOR THE FLASHBACK FRAGMENTS, AND IT IS DELIBERATELY EMPTY.
       *
       * Taking a jar gives the player a quarter of his memory back, four times,
       * in the order the map hands them over. That is a held black frame with
       * unlit shapes on it and no camera move, and it is a separate build with
       * its own module. What it needs from here is the EVENT and which jar it
       * was, which is this listener, so nothing about the fragment lane has to
       * reach into the chain or duplicate its bookkeeping.
       */
      for (const fn of takeListeners) fn(rec);
      return true;
    },
  };

  // ---------------------------------------------------------------------------
  // giving
  // ---------------------------------------------------------------------------

  const nicheHandler = {
    describe(rec) {
      if (filled.has(nicheIndex(rec))) return { text: '', deny: false };

      if (!state.carrying) {
        return { text: `THE NICHE OF ${sonOf(rec)} - EMPTY`, deny: true };
      }

      // ANY JAR IN ANY NICHE, and rooms.js authored it that way: "the order
      // they are filled in does not matter". It is also the fiction - the
      // notebook on the table has the four niches chalk-numbered in the wrong
      // order, because she tried this and got it wrong - and a chain that
      // enforced the correct pairing would be the game quietly insisting she
      // was right after all.
      return { text: `RETURN THE JAR OF ${sonOf(state.carrying)}  [F]`, deny: false };
    },

    buy(rec) {
      const idx = nicheIndex(rec);
      if (filled.has(idx) || !state.carrying) return false;

      const jar = state.carrying;
      state.carrying = null;
      jar.home = true;
      filled.add(idx);
      state.returned++;
      publish();

      // The jar goes into the socket. Reparented, not rebuilt: one jar exists
      // and it is in one place at a time.
      if (jar.vessel) {
        rec.group.add(jar.vessel);
        jar.vessel.position.set(0, SOCKET.y, SOCKET.z);
        jar.vessel.rotation.set(0, 0, 0);
        jar.vessel.visible = true;
      }

      for (const fn of homeListeners) fn(jar, state.returned);

      if (state.returned === MACHINE_AT) machine();
      else if (state.returned === CHAPEL_AT) chapel();
      else audio?.shrineChime?.();

      return true;
    },
  };

  // ---------------------------------------------------------------------------
  // the two landmarks
  // ---------------------------------------------------------------------------

  /**
   * The third jar going home turns the building on.
   *
   * SHE STARTS SPEAKING HERE AND THE MACHINE STARTS IN THE CALLBACK. The order
   * is the beat and it is the whole of what this function owns.
   *
   * No sound of its own: `power.js` fires the horn and then the chime 260 ms
   * later on its own listener, and a third noise from here would step on the
   * gap between them, which is the thing that stops the two reading as one
   * undifferentiated noise.
   */
  function machine() {
    state.interruptedLine = THE_INTERRUPTED_LINE.text;
    state.spokeAt = Date.now();

    if (pacer && pacer.speak) {
      /*
       * THE CUT IS COMPOSED, NOT EMERGENT, and that is the delivery lane's
       * call rather than this one's.
       *
       * Firing the Kindling the instant the third jar seats would sever her at
       * whatever character the reveal happened to have reached, and "there's
       * some" does not read as an interruption, it reads as a dropped frame.
       * So `ui/pacer.js` reveals her line at reading speed and stops it at an
       * AUTHORED character - "since we-", the last thing she ever says - holds
       * the frozen half-sentence for a quarter of a second, and then calls
       * back. This is that callback, and the machine starts inside it.
       *
       * Which is also the narrative order exactly: she is speaking WHEN IT
       * HAPPENS. The light across nine rooms, the horn, the chime and the
       * capitals all land on the frame her sentence stops.
       */
      pacer.speak(THE_INTERRUPTED_LINE.text, {
        ...THE_INTERRUPTED_LINE,
        onCut: () => kindle('cut'),
      });

      // If the authored cut point is not in the text the pacer says so, and a
      // beat that cannot be composed must not take the map down with it.
      if (pacer.typer && pacer.typer.cutMissing) kindle('no-cut-point');
      return;
    }

    notice?.(THE_INTERRUPTED_LINE.text, 4200);
    kindle('no-pacer');
  }

  /**
   * Light the map. Idempotent, and it may be reached two ways.
   *
   * THE PILL IS RELEASED RATHER THAN CLOBBERED, and the difference is who owns
   * the copy. `pacer.notice(..., { force: true })` is the documented way to
   * take the pill off her, and using it here would mean writing THE KINDLING
   * TAKES - THE PYRAMID WAKES into this file - a second copy of a string
   * `systems/power.js` owns, in the one change whose entire point is that
   * power.js is untouched. So the HOLD is dropped instead, and power.js's own
   * listener writes power.js's own line through the channel it always used.
   *
   * Both calls are in one synchronous tick, so the pill paints once: her frozen
   * half-sentence is replaced by the capitals in a single frame, which is the
   * beat.
   */
  function kindle(via) {
    if (!power || power.powered) return;

    pacer?.clear?.();
    if (power.throwSwitch()) {
      state.litAt = Date.now();
      // WHICH ROUTE THREW IT, reported rather than inferred. Every backstop
      // below 'cut' is a beat that did not land, and a harness that cannot
      // tell them apart would report a green power system over a dead one.
      state.litVia = via || null;
    }
  }

  /**
   * The fourth jar opens the sealed chapel at the bottom of the building.
   *
   * The gate was ALREADY unlocked by `publish()` above - `doors.lockedBecause`
   * reads the counter and returns null at four - so the player could walk down
   * and press F on it. It is opened here anyway, and the difference matters:
   * the narrative is that the cartouche completes and THE DOOR OPENS, not that
   * a fourth errand earns the right to do one more errand. Unlocking is the
   * state; opening is the event.
   *
   * One notice, and it is the name. The struck cartouche lighting one glyph at
   * a time is geometry in the Serdab and belongs to the lane that owns that
   * room's art; what this frame owes the player is the word, and the door
   * moving is heard and seen rather than narrated.
   */
  function chapel() {
    notice?.(THE_NAME, 4200);
    state.openedAt = Date.now();

    const gate = doors && doors.all
      ? doors.all.find((d) => d.kind === 'puzzle')
      : null;

    if (gate && !gate.opened && !gate.opening) {
      gate.open();
      state.chapelOpened = true;
      audio?.shrineChime?.();
    }
  }

  // ---------------------------------------------------------------------------
  // api
  // ---------------------------------------------------------------------------

  return {
    state,
    jars,
    niches,

    /** Late binding for the notice pill's pacer. See the note on `pacer`. */
    attach(parts) {
      if (parts && parts.pacer) pacer = parts.pacer;
    },

    /**
     * One frame. Only ever does anything in the window between her line
     * starting and the machine lighting, which happens once per run.
     *
     * Wall clock rather than the simulation delta, deliberately: the thing
     * being backstopped is a wall-clock reveal in ui/pacer.js, and a deadline
     * measured on a different clock than the event it is guarding would drift
     * against it on exactly the slow frames that make the guard necessary.
     */
    update() {
      if (!state.spokeAt || state.litAt) return;
      if (power && power.powered) return;

      const t = pacer && pacer.typer;

      // No typewriter at all, or a reveal that has finished without calling
      // back. `step()` in ui/pacer.js sets the phase to 'done' and then fires
      // onCut, so a 'done' phase with the switch still cold means the callback
      // did not happen. Exact, and it cannot fire early.
      if (!t || !t.phase || t.phase === 'done') { kindle('backstop'); return; }

      if (Date.now() - state.spokeAt > KINDLE_DEADLINE_MS) kindle('deadline');
    },

    /** The two handler types ui/interact.js routes the F key through. */
    handlers: {
      'canopic-jar': jarHandler,
      niche: nicheHandler,
    },

    /**
     * The jar fixtures, split by the space they stand in, in the shape
     * `ui/interact.js` collects sources in.
     *
     * Split rather than pooled because three.js does not skip invisible objects
     * when raycasting, and a single list would let a player standing in the
     * pyramid pick up a jar off a plinth in a courtyard that is not being drawn.
     * That is interact.js's own argument for keeping targets per space, and this
     * is what lets it keep making it.
     */
    sources: [
      { space: 'interior', interacts: jars.filter((j) => j.space === 'interior') },
      { space: 'exterior', interacts: jars.filter((j) => j.space === 'exterior') },
    ],

    /** Register for a jar being picked up. Returns an unsubscribe. */
    onTake(fn) { takeListeners.add(fn); return () => takeListeners.delete(fn); },

    /** Register for a jar going home, called `(jar, count)`. */
    onHome(fn) { homeListeners.add(fn); return () => homeListeners.delete(fn); },

    byIndex(n) { return jars.find((j) => j.index === n) || null; },
    nicheAt(n) { return niches.find((r) => nicheIndex(r) === n) || null; },

    get carrying() { return state.carrying; },
    get returned() { return state.returned; },
    get complete() { return state.returned >= CHAPEL_AT; },

    stats() {
      return {
        returned: state.returned,
        taken: state.taken,
        carrying: state.carrying ? state.carrying.id : null,
        counter: doors && doors.state ? doors.state.jarsReturned : null,
        powered: !!(power && power.powered),
        chapelOpened: state.chapelOpened,
        interruptedLine: state.interruptedLine,
        spokeAt: state.spokeAt,
        litAt: state.litAt,
        litVia: state.litVia,
        // Measured off the graph rather than off the flags: a jar is home when
        // its vessel's PARENT is a niche group, which is a fact about the scene
        // and not about this file's bookkeeping. The two disagreeing is exactly
        // the bug class this project keeps finding.
        inSockets: niches.reduce(
          (n, r) => n + (r.group.children.some((c) => c.name === 'vessel') ? 1 : 0), 0),
        jars: jars.map((j) => ({ id: j.id, taken: j.taken, home: j.home, space: j.space })),
      };
    },
  };
}
