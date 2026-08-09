/**
 * THE MEETING: the last ninety seconds of World 1, and the four beats that had
 * nowhere to happen.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS MISSING, AND IT WAS MEASURED RATHER THAN NOTICED
 * ---------------------------------------------------------------------------
 *
 * `test/serdabscene.mjs`, 2026-08-09:
 *
 *     phase "none" -> "black" after 2 frame(s)
 *     frame luminance 21.76 (spread 24.77)  ->  5.49 (spread 0.00)
 *
 * `ui/ending.js` step() was `if (state.phase === 'none') { if (ready()) begin(); }`
 * and `ready()` was true the first frame `spaces.roomId === 'serdab'`. So the
 * room the entire twenty-five-wave siege exists to reach was on screen for TWO
 * FRAMES, and beats 4.2 to 4.8 of `docs/PLAYTHROUGH.md` - the ten figures, the
 * empty eleventh niche, her, her lamp, the prompt, the stand, the telegraph,
 * the silence - had nowhere in the sequence to occur.
 *
 * **Nothing in `ending.js` was wrong when it was written.** It was correct while
 * the Serdab was an empty stone box: black on entry was black over nothing. The
 * geometry landed underneath it on 2026-08-08 and made a finished file wrong
 * without touching a line of it. That is the whole shape of the finding and it
 * is why the fix is a FOURTH GATE CONDITION rather than a timer bolted onto the
 * card: the ending was never early, it was simply unqualified.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR BEATS, AND WHAT EACH ONE REUSES
 * ---------------------------------------------------------------------------
 *
 * 4.5 THE PROMPT. He is prompted the way he has been at every door, gun and
 *     shrine in this game, and THIS ONE HAS NO PRICE ON IT. It is written
 *     through `ui/prompt.js`'s own bus, in the exact grammar the rest of the
 *     game uses - `VERB NOUN` then two spaces then `[F]` - and the whole of
 *     the beat is the substring that every other prompt has and this one does
 *     not: ` - N GOLD`.
 *
 * 4.6 SHE STANDS AND TURNS, and the mark he has been finding on walls is on
 *     her lamp, lit from inside it. The pose lives in `world/serdab.js` as
 *     `STAND`, because standing is geometry; the lerp between the two poses is
 *     this file, because a sequence is not.
 *
 * 4.7 HER EYES TAKE THE BOSS TELEGRAPH. Not a similar gold and not a similar
 *     curve - the real one, read out of `enemies/boss.js`:
 *
 *         glow = 1 - tLeft / ABILITY[ability].tell        (boss.js:922)
 *         mats.accent.emissiveIntensity = glow * 3.6      (boss.js:690)
 *
 *     A linear ramp from nothing to 3.6 over the length of a tell, on the
 *     GILDING - "the only surface on the body with metalness high enough to
 *     hold a colour against a bloom pass". The colour is `GODS[0].palette.accent`,
 *     imported rather than copied, so the gold on her face is the same value as
 *     the gold on the first god the player ever had to read, on wave five.
 *     `TELL_S` is 0.95, which is `ABILITY.charge.tell` - the tell that literally
 *     gives the player about one second to answer.
 *
 *     `ABILITY` and the 3.6 are not exported from `boss.js` and this lane does
 *     not own that file, so they are quoted here with their line numbers and
 *     carried as named constants. `test/meeting.mjs` asserts the ramp it
 *     measures against those constants; if boss.js retunes the telegraph, the
 *     right failure is a suite that says so.
 *
 * 4.8 SHE DOES NOT ASK HIM ANYTHING. Which is a beat made entirely of a thing
 *     not happening, so it is built as one: a phase with a length, no pacer
 *     call in it, and nothing on screen. `story/voice.js` holds her four lines
 *     and this file deliberately never imports it. The last thing she said was
 *     cut off ten waves ago by a system notice.
 *
 * ---------------------------------------------------------------------------
 * IT HOLDS THE SIMULATION AND NOT THE FRAME, WHICH IS THE OPPOSITE OF THE
 * TABLEAU
 * ---------------------------------------------------------------------------
 *
 * `story/tableau.js` replaces the world - it draws a second scene straight to
 * the canvas and main.js's branch for it must NOT call the composer, or the
 * courtyard paints over the memory. This file is the other kind of scene
 * entirely: it happens IN the world, to geometry the room already contains, and
 * the entire point of it is that the player is looking at the Serdab while it
 * runs. So its branch in main.js belongs BELOW `governor.sample()` and inside
 * the normal render path, and the shape it borrows is the DEATH GATE's rather
 * than the memory's: the camera still draws, the composer still runs, and what
 * stops is the simulation.
 *
 * The one thing it takes from the tableau is the discipline: every deadline is
 * an ABSOLUTE timestamp read off `performance.now()`, never an accumulator, for
 * the reason recorded three times in this project - `ui/ending.js` counted a
 * title card on a clamped simulation delta and six real seconds advanced it by
 * 0.7, and under swiftshader one frame can cost 1.7 seconds.
 *
 * ---------------------------------------------------------------------------
 * TWO DEAD MAN'S HANDLES, BECAUSE THIS ONE CAN STRAND A FINISHED RUN
 * ---------------------------------------------------------------------------
 *
 * `tableau.js` carries one and states the rule: a getter that can only ever say
 * "still holding" is a getter that can hang the game. `holding` here obeys it -
 * a hard wall-clock deadline computed when the scene starts, checked in the
 * getter and in `update()`, and past it the scene finishes itself and says so
 * in `stats().forced`.
 *
 * THE SECOND ONE IS NEW AND IT GUARDS SOMETHING WORSE. World 1's ending is now
 * downstream of a player pressing a key. If the prompt never appears - a
 * proximity test that misses, geometry that failed to build, a name that got
 * renamed - then a player who has fought twenty-five waves and returned four
 * jars is standing in a sealed room with no ending in it, which is a strictly
 * worse defect than the two-frame wash this file exists to fix. So `canPlay()`
 * being continuously true for `BACKSTOP_MS` starts the scene on its own. It is
 * thirty seconds, which is far longer than anyone stands in a fourteen-metre
 * room without pressing the key the game has trained them on for an hour, and
 * `stats().via` records which of the two started it so a suite can tell a
 * working prompt from a backstop covering for a broken one.
 *
 * The offer is deliberately PROXIMITY and not a crosshair raycast, and that is
 * the same argument one notch smaller. `ui/interact.js` picks fixtures by a ray
 * from the exact centre of the screen because a wall is covered in them; this
 * room contains one person, one lamp and nothing else, and being within three
 * metres of the only other living thing in Egypt is not ambiguous. A ray is a
 * second way for the last beat in the world to fail to fire.
 */

import * as THREE from 'three';
import { GODS } from '../enemies/boss.js';
import { SERDAB_NAMES, STAND } from '../world/serdab.js';

// ---------------------------------------------------------------------------
// the telegraph, quoted from enemies/boss.js
// ---------------------------------------------------------------------------

/**
 * The gilding of ANUBIS: the first telegraph in the game, on wave five.
 *
 * Imported rather than transcribed. Five gods carry five accents and the ramp
 * is shared between all of them; the one the player LEARNED the ramp on is the
 * first one, and picking any other would be picking a colour rather than
 * quoting a mechanic.
 */
const TELEGRAPH_GOLD = (GODS[0] && GODS[0].palette && GODS[0].palette.accent) || 0xd8b25c;

/** boss.js:690 - `mats.accent.emissiveIntensity = k * 3.6`. */
const TELEGRAPH_CEILING = STAND.eyeGlow;

// ---------------------------------------------------------------------------
// the beats, in milliseconds of WALL CLOCK
// ---------------------------------------------------------------------------

const BEAT = {
  /**
   * He presses F and nothing happens for four hundred milliseconds.
   *
   * The one beat here with no content, and it is the one that makes the rest
   * read as a person rather than as a trigger. Every other prompt in this game
   * pays out on the frame it is pressed.
   */
  settle: 420,

  /**
   * She stands and turns, and the mark on the lamp comes up over the same
   * window. One curve drives all three so they cannot drift apart.
   */
  rise: 900,

  /** boss.js:342 - `ABILITY.charge.tell`. About a second to answer it. */
  tell: 950,

  /** She holds, and asks nothing. Beat 4.8, which is entirely an absence. */
  silence: 1200,
};

const TOTAL_MS = BEAT.settle + BEAT.rise + BEAT.tell + BEAT.silence;

/** tableau.js's number, and its argument: this is not pacing, it is the floor. */
const SAFETY_MS = 2500;

/** See the header. The ending must not be reachable only by a keypress. */
const BACKSTOP_MS = 30000;

/**
 * How close he has to be. Three metres, against `ui/interact.js`'s REACH of
 * 5.5 - shorter, because a prompt that fires from across the chapel would land
 * before he has walked up to her, and "he walks up to her" is the beat.
 */
const REACH = 3.0;

/** The line, and the whole of beat 4.5 is what is not in it. */
const OFFER = 'REACH HER  [F]';

/** How hot the mark on the lamp gets. Under the lens's own 2.9: it is a sign
 *  cut in a case, not a second lamp. */
const SIGN_GLOW = 2.2;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Ease in and out. A person rising accelerates off the stool and settles. */
const smooth = (k) => k * k * (3 - 2 * k);

/** Shortest way round. A turn of 200 degrees is a turn of -160. */
function wrapPi(a) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/**
 * @param {object} o
 * @param {THREE.Object3D} o.scene    where the archaeologist is, by name
 * @param {object} o.player           `position`, for the proximity offer
 * @param {object} [o.prompt]         a ui/prompt.js channel, or null headless
 * @param {object} [o.input]          frozen while the scene holds
 * @param {function} [o.canPlay]      the ending's first three conditions
 * @param {Document} [o.doc]
 */
export function createMeeting({
  scene, player, prompt = null, input = null, canPlay = null, doc = document,
}) {
  const view = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
  const now = () => (view && view.performance ? view.performance.now() : Date.now());

  const state = {
    /** 'none' | 'settle' | 'rise' | 'tell' | 'silence' | 'done' */
    phase: 'none',
    /** True while the prompt is up and the key would start it. */
    offered: false,
    /** Set once, and never cleared except by reset(). The ending's condition. */
    done: false,
    /** 'key' | 'backstop' | null. Which handle started it. */
    via: null,
    /** update() calls. A scene that never ticked passes every state check. */
    ticks: 0,
    /** Times it has played this session. */
    plays: 0,
    /** True if the hard deadline ended it rather than the clock. */
    forced: false,
    /** Wall-clock ms from begin() to done, for the harness. */
    lastMs: 0,
    /** Whether the geometry was found. A false here explains every zero below. */
    bound: false,
    /** How long canPlay() has been continuously true, ms. Drives the backstop. */
    armedMs: 0,
  };

  let startedAt = 0;
  let hardEndAt = 0;
  let armedAt = 0;

  /** Handles into world/serdab.js, resolved once and cached. */
  let rig = null;

  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _her = new THREE.Vector3();

  /** How far she has to turn to be looking at him, in her own frame. Set once,
   *  at begin(), off where he is actually standing. */
  let turn = 0;

  // ---------------------------------------------------------------------------
  // binding
  // ---------------------------------------------------------------------------

  /**
   * Find her.
   *
   * BY NAME AND NOT BY POSITION, and `world/serdab.js` exports the names for
   * exactly this. Nothing here reaches into a child index or a coordinate, so
   * the day a mesh is added to her the driver still drives the right subtree.
   *
   * Tolerant of every piece being absent, and the tolerance is the point: a
   * missing handle must degrade to "the beat did not animate" and never to "the
   * run cannot end". `bound` is what a harness reads to tell those apart.
   */
  function bind() {
    if (rig || !scene || !scene.getObjectByName) return rig;

    const her = scene.getObjectByName(SERDAB_NAMES.her);
    if (!her) return null;

    const figure = her.getObjectByName(SERDAB_NAMES.figure) || null;
    const legs = her.getObjectByName(SERDAB_NAMES.legs) || null;
    const torso = her.getObjectByName(SERDAB_NAMES.torso) || null;
    const eyes = her.getObjectByName(SERDAB_NAMES.eyes) || null;
    const forearms = her.getObjectByName(SERDAB_NAMES.forearms) || null;

    const lamp = scene.getObjectByName(SERDAB_NAMES.lamp);
    const sign = lamp ? lamp.getObjectByName(SERDAB_NAMES.sign) : null;

    // The two materials the ramp is written onto, taken off the meshes rather
    // than imported: what is on the graph is what the player sees, and this
    // project's defining bug is code that was written, believed and never
    // reached the screen.
    const eyeMat = eyes && eyes.children[0] ? eyes.children[0].material : null;
    const signMat = sign ? sign.material : null;

    if (eyeMat) eyeMat.emissive.setHex(TELEGRAPH_GOLD);

    rig = { her, figure, legs, torso, eyes, forearms, lamp, sign, eyeMat, signMat };
    state.bound = !!(figure && legs && eyeMat);
    return rig;
  }

  // ---------------------------------------------------------------------------
  // the pose
  // ---------------------------------------------------------------------------

  /**
   * Write the whole figure at a single parameter.
   *
   * ONE FUNCTION OF k RATHER THAN A LITTLE STATE MACHINE PER LIMB, for
   * `boss.js`'s own reason about its farewell curve: it is driven from one
   * place, once a frame, and a curve that can be evaluated at any k cannot get
   * stuck part way through on a frame that was dropped. It is also what makes
   * `reset()` a call with k = 0 rather than a second copy of the authored pose.
   */
  function pose(k) {
    if (!rig) return;
    const e = smooth(clamp01(k));

    if (rig.figure) {
      rig.figure.position.y = STAND.lift * e;
      rig.figure.rotation.y = turn * e;
    }
    if (rig.legs) {
      rig.legs.rotation.x = STAND.knee * e;
      rig.legs.position.y = STAND.hip.y + STAND.legShift.y * e;
      rig.legs.position.z = STAND.hip.z + STAND.legShift.z * e;
    }
    if (rig.torso) rig.torso.rotation.x = STAND.torsoLean * (1 - e);
    if (rig.forearms) rig.forearms.rotation.x = STAND.forearm * e;
    if (rig.signMat) rig.signMat.emissiveIntensity = SIGN_GLOW * e;
  }

  /** Beat 4.7. Linear, because boss.js:922 is linear. */
  function gaze(k) {
    if (rig && rig.eyeMat) rig.eyeMat.emissiveIntensity = TELEGRAPH_CEILING * clamp01(k);
  }

  // ---------------------------------------------------------------------------
  // the offer
  // ---------------------------------------------------------------------------

  function withinReach() {
    if (!rig || !rig.her || !player || !player.position) return false;
    rig.her.getWorldPosition(_her);
    const dx = player.position.x - _her.x;
    const dz = player.position.z - _her.z;
    return dx * dx + dz * dz <= REACH * REACH;
  }

  function setPrompt(on) {
    if (state.offered === on) return;
    state.offered = on;
    if (!prompt) return;
    prompt.textContent = on ? OFFER : '';
    prompt.classList.toggle('on', on);
    prompt.classList.toggle('deny', false);
  }

  // ---------------------------------------------------------------------------
  // the scene
  // ---------------------------------------------------------------------------

  function suspendInput(on) {
    if (!input || !input.setSuspended || !input.state) return;
    if (!!input.state.suspended === !!on) return;
    input.setSuspended(on);
  }

  /**
   * Start it. Returns false if it cannot, which is the whole of the guard
   * against a held F key firing this twice.
   */
  function begin(via = 'key') {
    if (state.phase !== 'none' || state.done) return false;
    bind();

    setPrompt(false);

    /**
     * WHICH WAY SHE TURNS IS MEASURED OFF WHERE HE IS STANDING, not authored.
     *
     * Her slot rotation is derived in rooms.js from where the eleventh niche
     * is, so a hardcoded 180 degrees is only correct while the player arrives
     * on exactly the axis the room was authored on. He arrives through one
     * door and then walks wherever he likes, and "she turns and looks at him"
     * is the beat rather than "she turns round".
     */
    turn = 0;
    if (rig && rig.her && player && player.position) {
      rig.her.getWorldPosition(_her);
      _v.set(0, 0, 1).applyQuaternion(rig.her.getWorldQuaternion(_q));
      const herYaw = Math.atan2(_v.x, _v.z);
      const toHim = Math.atan2(player.position.x - _her.x, player.position.z - _her.z);
      turn = wrapPi(toHim - herYaw);
    }

    const t = now();
    state.phase = 'settle';
    state.via = via;
    state.forced = false;
    state.plays++;
    startedAt = t;
    hardEndAt = t + TOTAL_MS + SAFETY_MS;

    pose(0);
    gaze(0);

    // The world stops the way it stops for the death card: the frame still
    // draws and the composer still runs. Deliberately NOT handed back at the
    // end - `ui/ending.js` takes the run over on the very next frame and
    // suspends it again, and a single frame of a live mouse between the two
    // would let the player spin the camera off her as the wash comes up.
    suspendInput(true);
    return true;
  }

  /** Idempotent, and what both the deadline and a host teardown call. */
  function finish(forced = false) {
    if (state.phase === 'none' || state.phase === 'done') return;
    // Land the pose rather than leaving it half way: an aborted scene must
    // leave a standing woman looking at him, because the next frame is black.
    pose(1);
    gaze(1);
    state.forced = !!forced;
    state.lastMs = Math.round(now() - startedAt);
    state.phase = 'done';
    state.done = true;
  }

  function step(t) {
    const since = t - startedAt;

    if (since < BEAT.settle) {
      state.phase = 'settle';
      return;
    }
    if (since < BEAT.settle + BEAT.rise) {
      state.phase = 'rise';
      pose((since - BEAT.settle) / BEAT.rise);
      return;
    }
    pose(1);

    if (since < BEAT.settle + BEAT.rise + BEAT.tell) {
      state.phase = 'tell';
      gaze((since - BEAT.settle - BEAT.rise) / BEAT.tell);
      return;
    }
    gaze(1);

    if (since < TOTAL_MS) {
      state.phase = 'silence';
      return;
    }
    finish(false);
  }

  return {
    state,
    begin,
    finish,

    /**
     * One frame. Driven UNCONDITIONALLY from main.js, beside `ending.update`,
     * for the reason that file states about its own gate: a check that only ran
     * while the world was still running could never fire on the frame it has to.
     */
    update() {
      state.ticks++;
      const t = now();

      if (state.phase !== 'none' && state.phase !== 'done') {
        if (t > hardEndAt) { finish(true); return; }
        step(t);
        return;
      }

      if (state.done) { setPrompt(false); return; }

      // ---- the offer, and the backstop behind it ---------------------------
      const can = !!(canPlay && canPlay());
      if (!can) {
        armedAt = 0;
        state.armedMs = 0;
        setPrompt(false);
        return;
      }

      bind();

      /**
       * THE ARM CLOCK IS RESET BY `canPlay()` GOING FALSE AND BY NOTHING ELSE.
       *
       * The first cut reset it whenever two frames were more than a second
       * apart, on the reasoning that a gap meant the player had been elsewhere.
       * That is a frame-rate test wearing a gameplay test's clothes, and it was
       * measured wrong the same afternoon: a swiftshader frame in this room
       * costs 1036 ms, so the gap tripped on EVERY frame and the backstop could
       * never fire - a safety net that is only ever armed on a fast machine.
       *
       * `canPlay()` already answers the real question. It is false the instant
       * he steps out of the Serdab, so leaving is what restarts the thirty
       * seconds, at any frame rate.
       */
      if (!armedAt) armedAt = t;
      state.armedMs = Math.round(t - armedAt);

      setPrompt(withinReach());

      if (state.armedMs >= BACKSTOP_MS) begin('backstop');
    },

    /**
     * IS THE SCENE HOLDING THE SIMULATION.
     *
     * tableau.js's contract and tableau.js's dead man's handle, for the reason
     * written on that getter: one that can only ever say yes can hang the game.
     */
    get holding() {
      if (state.phase === 'none' || state.phase === 'done') return false;
      if (now() > hardEndAt) { finish(true); return false; }
      return true;
    },

    /** The ending's fourth condition, and the only thing ui/ending.js reads. */
    get done() { return state.done; },

    /** For main.js's interact routing. The F key means her, or it means a door. */
    get offered() { return state.offered; },

    get phase() { return state.phase; },

    /** The line, so a suite can assert the offer without reading the DOM. */
    offer: OFFER,

    /**
     * Put the room back exactly as `world/serdab.js` authored it.
     *
     * pose(0) and gaze(0) rather than a second transcription of the seated
     * numbers - see the note on pose(). The materials are module-level
     * singletons in serdab.js, so a scene that ran and was reset must leave
     * them cold or the next run starts with her eyes already lit.
     */
    reset() {
      bind();
      pose(0);
      gaze(0);
      if (rig && rig.signMat) rig.signMat.emissiveIntensity = 0;
      setPrompt(false);
      state.phase = 'none';
      state.done = false;
      state.via = null;
      state.forced = false;
      state.lastMs = 0;
      state.armedMs = 0;
      armedAt = 0;
      startedAt = 0;
      hardEndAt = 0;
      turn = 0;
    },

    /**
     * For the harness. Nothing on screen reads this.
     *
     * Every number that CAN be read back off the scene graph is read back off
     * the scene graph rather than off this file's intentions - the eye and sign
     * intensities off the live materials, the lift and the turn off the live
     * transforms. tableau.js counts its own `draws` for the same reason: a
     * surface that draws nothing satisfies every state check ever written.
     */
    stats() {
      const eye = rig && rig.eyeMat ? rig.eyeMat.emissiveIntensity : null;
      const sign = rig && rig.signMat ? rig.signMat.emissiveIntensity : null;
      return {
        phase: state.phase,
        offered: state.offered,
        done: state.done,
        via: state.via,
        forced: state.forced,
        ticks: state.ticks,
        plays: state.plays,
        lastMs: state.lastMs,
        bound: state.bound,
        armedMs: state.armedMs,
        // Measured off the graph.
        lift: rig && rig.figure ? +rig.figure.position.y.toFixed(4) : null,
        turnDeg: rig && rig.figure
          ? +(rig.figure.rotation.y * 180 / Math.PI).toFixed(2) : null,
        knee: rig && rig.legs ? +rig.legs.rotation.x.toFixed(4) : null,
        eyeGlow: eye === null ? null : +eye.toFixed(4),
        signGlow: sign === null ? null : +sign.toFixed(4),
        eyeHex: rig && rig.eyeMat ? rig.eyeMat.emissive.getHex() : null,
        // Quoted so a suite asserts against boss.js's numbers rather than its
        // own idea of them.
        telegraph: { gold: TELEGRAPH_GOLD, ceiling: TELEGRAPH_CEILING, tellMs: BEAT.tell },
        totalMs: TOTAL_MS,
        standLift: STAND.lift,
        backstopMs: BACKSTOP_MS,
      };
    },
  };
}
