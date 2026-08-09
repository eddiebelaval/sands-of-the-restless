/**
 * THE TABLEAU: the missing middle of World 1, and it is four held frames.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 *
 * The owner played World 1 end to end and said "we really didn't get any story.
 * There wasn't any story." The world had a beginning - `ui/briefing.js`, a
 * government file that promises seven people - and an ending - `ui/ending.js`,
 * a struck cartouche and THE NAME IS NOT HERE - and nothing between them.
 *
 * This is the between. `docs/NARRATIVE.md` moves the team's flashbacks off a
 * cut scene at the World 2 gate and onto the four canopic jars, which is the
 * single biggest cost saving in the project: four deliveries where the player
 * already stops and presses a key, spread across a whole world, instead of one
 * scripted sequence welded to a camera rig that is welded to the player's head.
 *
 * ---------------------------------------------------------------------------
 * WHY A SECOND SCENE, AND NOT SILHOUETTES IN THE LIVE ONE
 * ---------------------------------------------------------------------------
 *
 * `docs/STORY-DELIVERY.md` section 6 evaluated both readings and rejected one.
 * Placing seven black meshes in the room the player is standing in needs the
 * player's camera pointed at them, which is either the cut scene this approach
 * exists to avoid, or geometry spawned at an arbitrary angle inside the room's
 * colliders wearing the room's lighting, fog and grade. That reading is dead.
 *
 * What is built here is the other one: a private `THREE.Scene` with its own
 * `PerspectiveCamera`, drawn with `renderer.render()` straight to the canvas
 * while a black curtain sits over the swap in and out. THE PLAYER RIG IS NEVER
 * READ, NEVER WRITTEN, NEVER MOVED. The composer is never reconfigured.
 *
 * ---------------------------------------------------------------------------
 * IT BYPASSES THE COMPOSER ON PURPOSE
 * ---------------------------------------------------------------------------
 *
 * No grade, no vignette, no fog, no bloom, no SMAA, and no tone mapping either.
 * Fragments look flat and hard-edged next to the game, and that is decision 5 in
 * STORY-DELIVERY, decided rather than discovered: A MEMORY SHOULD NOT BE IN THE
 * PRESENT TENSE'S COLOUR SPACE. Routing the tableau through the composer would
 * cost a pass reconfiguration on every fragment and would make his memories the
 * same colour as the room he is standing in.
 *
 * The consequence for authoring is that every hex in `fragments.js` is very
 * nearly the hex that lands on the screen. Nothing is grading it afterwards.
 *
 * ---------------------------------------------------------------------------
 * THE RENDERER IS BORROWED AND HANDED BACK EXACTLY AS IT WAS
 * ---------------------------------------------------------------------------
 *
 * `core/post.js:56-75` documents the hazard this whole approach lives or dies
 * on: `renderer.autoClear` defaults to TRUE and `renderer.render()` honours it
 * by clearing COLOUR as well as depth, so a second scene drawn without a guard
 * wipes whatever the composer just spent five passes building. That file solved
 * it for the viewmodel by scoping the flag - saved, set, restored - rather than
 * turning it off globally, because RenderPass relies on the clear.
 *
 * `draw()` below follows that precedent and widens it to everything it touches:
 * render target, autoClear, clear colour, clear alpha and tone mapping are all
 * read before and written back after, in reverse order. The specific risk of
 * this design is the renderer coming back dirty, and `test/tableau.mjs` renders
 * the world, shows a fragment, dismisses it and renders the world again to
 * measure that the frame came back - which is a claim about pixels and can only
 * be settled in pixels.
 *
 * ---------------------------------------------------------------------------
 * IT KNOWS NOTHING ABOUT WORLD 1
 * ---------------------------------------------------------------------------
 *
 * `show()` takes a DATA RECORD: a camera, and a list of stills, each of which
 * is a list of boxes and planes with a position and a tone. There is no jar in
 * this file, no room name, no son of Horus, no wave number. Worlds 2 and 3 get
 * fragments by writing a data entry, and the cost of that discipline is zero
 * because it was stated before the file was written rather than after.
 *
 * ---------------------------------------------------------------------------
 * THE CLOCK IS THE WALL, AND THAT IS A FIX RATHER THAN A PREFERENCE
 * ---------------------------------------------------------------------------
 *
 * `docs/WORLD1-POLISH.md` item 0 records `ui/ending.js` counting a title card
 * on main.js's CLAMPED simulation delta: MAX_DELTA is 1/20, so six real seconds
 * advanced the card's clock by 0.7. `ui/briefing.js` hit the same defect the
 * same night with a per-frame accumulator under swiftshader, where one frame
 * can cost 1.7 seconds. This is the third instance of one bug, so this file
 * never accumulates anything: every deadline is an absolute timestamp read off
 * `performance.now()`, and a frame that arrives late shortens the phase it
 * arrived in rather than stretching the fragment.
 *
 * A held frame with no animation in it is exactly the surface where that defect
 * hides best, because nothing on screen moves either way.
 *
 * ---------------------------------------------------------------------------
 * HOW IT STOPS THE WORLD, AND WHY IT CANNOT STRAND THE PLAYER
 * ---------------------------------------------------------------------------
 *
 * `holding` is the same contract `ui/briefing.js` exports and main.js already
 * honours one line below the pause: while it is true the host returns before
 * anything advances. Unlike the briefing, the host also skips its own render,
 * because this file is drawing the canvas itself on its own animation frame.
 *
 * That is one more kind of stopped than the game had, so it carries its own
 * dead man's handle: `holding` compares the wall clock against a hard deadline
 * computed from the record when `show()` was called, and finishes itself if the
 * fragment has outlived it. A story surface that can hang the game is a worse
 * bug than no story surface, and the guard costs four lines.
 */

import * as THREE from 'three';

/**
 * THE CANVAS COMES TO THE FRONT, AND THAT IS NOT A DETAIL.
 *
 * FOUND BY SCREENSHOT, not by reading: the first measured run of
 * `test/tableau.mjs` produced four correct memories with THE MINIMAP OVER THEM.
 * `#stage` is `position: fixed; inset: 0` with no z-index, which puts the
 * rendered frame underneath every interface layer in the game - the HUD at 20,
 * the notice at 30, the objective panel, the ammo plate, the fidelity buttons.
 * Painting a second scene onto that canvas replaces the WORLD and nothing else,
 * and a man's memory of his own death with a gold counter and a map of the
 * necropolis on it is not a memory, it is a bug with a story in it.
 *
 * Two ways to fix it and only one of them is this file's business. Hiding the
 * game's interface means naming the game's interface, which is exactly the
 * coupling this module was written to avoid - it would have to know that a HUD
 * exists, and World 2's driver would inherit the list. Raising the canvas needs
 * one element that this file was already handed: `renderer.domElement`.
 *
 * So the canvas is lifted above the interface while a memory is up and put back
 * the moment the world is the player's again, with the curtain one layer above
 * it and the pause menu (60) still above everything. Losing the mouse opens the
 * pause - see the pointerlockchange handler in main.js - and a player who
 * alt-tabs out of a memory must still see the menu they just opened.
 */
const CANVAS_Z = 58;
const CURTAIN_Z = 59;

/** Milliseconds, and all three are overridable per record. */
const FADE = {
  /** Curtain 1 to 0. The memory arriving. */
  in: 380,
  /** Curtain 0 to 1. The memory leaving, and slower, because it is a loss. */
  out: 560,
  /** Curtain 1 to 0 again, over the world. Covers the composer's first frame. */
  back: 460,
};

/** How long a still holds if the record does not say. */
const HOLD = 2600;

/**
 * Slack on the dead man's handle.
 *
 * Generous on purpose: it is not a timeout for pacing, it is the last line of
 * defence against a fragment that stopped stepping - a lost animation frame in
 * a backgrounded tab, an exception in a host's own loop - leaving the world
 * halted behind a black sheet forever.
 */
const SAFETY_MS = 4000;

const BLACK = new THREE.Color(0x000000);

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * The curtain, and it is a DOM sheet rather than a mesh.
 *
 * A quad in the tableau's own scene could only ever fade the tableau. This one
 * has to be full black BEFORE the first tableau frame exists and it has to stay
 * up AFTER the last one, over a world the composer has started drawing again -
 * so it belongs to the page and not to either scene.
 *
 * Never a click target, for the same reason `systems/spaces.js` says it about
 * its own: the player is remembering, not choosing.
 */
function buildCurtain(doc) {
  const el = doc.createElement('div');
  el.id = 'tableau-curtain';
  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    background: '#000',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: String(CURTAIN_Z),
    display: 'none',
  });
  (doc.body || doc.documentElement).appendChild(el);
  return el;
}

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer  the game's renderer, borrowed
 * @param {Document} [o.doc]
 * @param {Function} [o.onEnd]  called with the record when a fragment releases
 */
export function createTableau({ renderer, doc = document, onEnd = null }) {
  if (!renderer) throw new Error('createTableau needs the renderer');

  const view = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  const curtain = buildCurtain(doc);

  const scene = new THREE.Scene();
  // Explicitly nothing. The clear colour is the background, so a fragment that
  // authors no floor is genuinely in the void rather than in whatever colour a
  // default happened to be.
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(55, 1.6, 0.05, 400);
  scene.add(camera);

  /** One group per still. Only one is ever visible. */
  let groups = [];
  /** Everything built for the current record, so finish() can free it. */
  const owned = { geometries: [], materials: [] };

  let record = null;
  let rafId = 0;
  let openedAt = 0;    // timestamp show() was called
  let phaseAt = 0;     // timestamp the current phase began
  let hardEndAt = 0;   // the dead man's handle
  /**
   * The return fade's length, copied out of the record BEFORE the record is
   * dropped. `release()` runs at the top of the 'back' phase - the world is the
   * player's again by then - so the phase that comes after it cannot ask the
   * record how long it is supposed to last.
   */
  let backMs = FADE.back;
  let lastW = 0;
  let lastH = 0;

  const sizeVec = new THREE.Vector2();
  const prevClear = new THREE.Color();

  /** The canvas's own z-index as the page authored it. Restored on release. */
  const canvasEl = renderer.domElement;
  let prevCanvasZ = null;

  function liftCanvas() {
    if (prevCanvasZ === null) prevCanvasZ = canvasEl.style.zIndex;
    canvasEl.style.zIndex = String(CANVAS_Z);
  }

  function dropCanvas() {
    if (prevCanvasZ === null) return;
    canvasEl.style.zIndex = prevCanvasZ;
    prevCanvasZ = null;
  }

  const state = {
    /** 'none' | 'in' | 'hold' | 'out' | 'back' | 'done' */
    phase: 'none',
    /** Which still of the current record is on screen. */
    still: 0,
    /** Fragments shown across the session. Not resettable; it is a life count. */
    shown: 0,
    /** Hard cuts performed. Fragment 4 is the only record that authors one. */
    cuts: 0,
    /** renderer.render() calls made by this file. A surface that draws nothing
     *  passes every state check ever written, so this is counted and asserted. */
    draws: 0,
    /** Curtain opacity as last written. Read by the harness. */
    curtain: 0,
    /** id of the record on screen, or the last one shown. */
    id: null,
    /** Wall-clock ms from show() to release, for the most recent fragment. */
    lastMs: 0,
    /** True if the dead man's handle ended the last fragment, not the clock. */
    lastForced: false,
  };

  const now = () => (view && view.performance ? view.performance.now() : Date.now());

  // ---------------------------------------------------------------------------
  // building a still out of data
  // ---------------------------------------------------------------------------

  /**
   * Grey, or a colour if the record insists on one.
   *
   * `tone` is a single number because almost everything in a fragment is on one
   * axis: black shapes, a stone wall a little above black, a doorway leaking
   * light. `color` exists for the one thing in this story that is not on that
   * axis - the growth around the gate, in a colour that does not occur - and
   * naming it as the exception is the point.
   */
  function materialFor(spec) {
    const hex = spec.color !== undefined
      ? spec.color
      : (() => {
        const v = Math.round(clamp01(spec.tone === undefined ? 0 : spec.tone) * 255);
        return (v << 16) | (v << 8) | v;
      })();

    const m = new THREE.MeshBasicMaterial({
      color: hex,
      // DoubleSide on everything, and it is not laziness. A PlaneGeometry faces
      // +z, so a wall authored on the wrong side of the room is invisible
      // rather than wrong - a failure that looks exactly like the driver not
      // running, which is the one failure this build cannot afford to confuse.
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
      transparent: spec.opacity !== undefined && spec.opacity < 1,
      opacity: spec.opacity === undefined ? 1 : spec.opacity,
      depthWrite: true,
    });
    owned.materials.push(m);
    return m;
  }

  function geometryFor(spec) {
    let g;
    if (spec.box) g = new THREE.BoxGeometry(spec.box[0], spec.box[1], spec.box[2]);
    else if (spec.plane) g = new THREE.PlaneGeometry(spec.plane[0], spec.plane[1]);
    else return null;
    owned.geometries.push(g);
    return g;
  }

  function buildStill(still) {
    const g = new THREE.Group();
    for (const spec of (still.shapes || [])) {
      const geo = geometryFor(spec);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, materialFor(spec));
      const at = spec.at || [0, 0, 0];
      mesh.position.set(at[0] || 0, at[1] || 0, at[2] || 0);
      const rot = spec.rot || [0, 0, 0];
      mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
      // Nothing in a fragment moves, so nothing needs to be re-derived.
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      g.add(mesh);
    }
    g.visible = false;
    return g;
  }

  function teardown() {
    for (const g of groups) scene.remove(g);
    groups = [];
    for (const geo of owned.geometries) geo.dispose();
    for (const m of owned.materials) m.dispose();
    owned.geometries.length = 0;
    owned.materials.length = 0;
  }

  // ---------------------------------------------------------------------------
  // the curtain
  // ---------------------------------------------------------------------------

  function setCurtain(a) {
    const k = clamp01(a);
    state.curtain = k;
    curtain.style.opacity = String(k);
    // display rather than opacity alone, so a dismissed fragment leaves no
    // compositor layer over the game between fragments.
    curtain.style.display = k > 0 ? 'block' : 'none';
  }

  // ---------------------------------------------------------------------------
  // drawing
  // ---------------------------------------------------------------------------

  /**
   * ONE FRAME OF THE MEMORY, WITH THE RENDERER HANDED BACK AS FOUND.
   *
   * The order is: read every piece of state this touches, set what it needs,
   * render, put it all back in reverse. `core/post.js:56-75` is the precedent
   * and its scoped-not-global argument holds here too - the composer's
   * RenderPass relies on autoClear being true, so this cannot simply turn it
   * off and walk away.
   *
   * setRenderTarget(null) rather than trusting the composer to have left the
   * screen bound: this file can be called on any frame, including one where a
   * host chose to draw the world first, and the whole point of a discipline is
   * that it does not depend on who ran last.
   */
  function draw() {
    renderer.getSize(sizeVec);
    if (sizeVec.x !== lastW || sizeVec.y !== lastH) {
      lastW = sizeVec.x;
      lastH = sizeVec.y;
      camera.aspect = sizeVec.x / Math.max(1, sizeVec.y);
      camera.updateProjectionMatrix();
    }

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();
    const prevTone = renderer.toneMapping;

    renderer.setRenderTarget(null);
    renderer.autoClear = true;
    renderer.setClearColor(BLACK, 1);
    // NoToneMapping, and this is decision 5 made in code. ACES would lift the
    // blacks of a frame that is mostly black on purpose and roll off the one
    // bright thing in it, which is the door. A memory is not being photographed.
    renderer.toneMapping = THREE.NoToneMapping;

    renderer.render(scene, camera);

    renderer.toneMapping = prevTone;
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);

    state.draws++;
  }

  // ---------------------------------------------------------------------------
  // phases
  // ---------------------------------------------------------------------------

  const fadeOf = (k) => {
    const f = (record && record.fade) || null;
    return f && f[k] !== undefined ? f[k] : FADE[k];
  };

  const holdOf = (i) => {
    const s = record && record.stills ? record.stills[i] : null;
    return s && s.hold !== undefined ? s.hold : HOLD;
  };

  function showStill(i) {
    for (let n = 0; n < groups.length; n++) groups[n].visible = n === i;
    state.still = i;
  }

  function step(t) {
    switch (state.phase) {
      case 'in': {
        const k = clamp01((t - phaseAt) / Math.max(1, fadeOf('in')));
        setCurtain(1 - k);
        if (k >= 1) { state.phase = 'hold'; phaseAt = t; }
        break;
      }

      case 'hold': {
        if (t - phaseAt < holdOf(state.still)) break;
        // THE HARD CUT. Not a fade, not a camera move, an array index - which
        // is the whole of what STORY-DELIVERY bought for fragment 4, where a
        // single held frame can only be the last moment of a sequence.
        if (state.still + 1 < groups.length) {
          showStill(state.still + 1);
          state.cuts++;
          phaseAt = t;
        } else {
          state.phase = 'out';
          phaseAt = t;
        }
        break;
      }

      case 'out': {
        const k = clamp01((t - phaseAt) / Math.max(1, fadeOf('out')));
        setCurtain(k);
        if (k >= 1) {
          // holding goes false HERE, under a curtain at full black. The host
          // starts drawing the world again on its next frame and the player
          // does not see the composer's first frame back.
          backMs = fadeOf('back');
          state.phase = 'back';
          phaseAt = t;
          release(t);
        }
        break;
      }

      case 'back': {
        const k = clamp01((t - phaseAt) / Math.max(1, backMs));
        setCurtain(1 - k);
        if (k >= 1) { state.phase = 'done'; stop(); }
        break;
      }

      default:
        break;
    }
  }

  /**
   * The scene is freed and the callback fires the moment the world is the
   * player's again, not when the curtain finishes lifting off it. The two are
   * half a second apart and the second one is cosmetic.
   */
  function release(t) {
    const done = record;
    state.lastMs = Math.round(t - openedAt);
    // The interface comes back with the world, under a curtain at full black.
    dropCanvas();
    teardown();
    record = null;
    if (onEnd) { try { onEnd(done); } catch { /* a listener cannot break this */ } }
  }

  function totalOf(rec) {
    if (!rec) return 0;
    const f = (rec.fade || {});
    const fIn = f.in !== undefined ? f.in : FADE.in;
    const fOut = f.out !== undefined ? f.out : FADE.out;
    const fBack = f.back !== undefined ? f.back : FADE.back;
    let holds = 0;
    for (const s of (rec.stills || [])) holds += (s.hold !== undefined ? s.hold : HOLD);
    return fIn + holds + fOut + fBack;
  }

  function pump() {
    rafId = view ? view.requestAnimationFrame(pump) : 0;
    const t = now();

    // The dead man's handle, checked here as well as in `holding`, because a
    // host that never reads the getter must still not be able to hang.
    if (state.phase !== 'none' && state.phase !== 'done' && t > hardEndAt) {
      state.lastForced = true;
      finish();
      return;
    }

    step(t);
    if (state.phase === 'in' || state.phase === 'hold' || state.phase === 'out') draw();
  }

  function stop() {
    if (rafId && view) view.cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // ---------------------------------------------------------------------------
  // the API
  // ---------------------------------------------------------------------------

  /**
   * Raise a fragment. Returns false and does nothing if one is already up or
   * the record is empty - a jar that fires an event with no fragment behind it
   * is a data gap, and a data gap must not black the screen out.
   */
  function show(rec) {
    if (!rec || !rec.stills || !rec.stills.length) return false;
    // Only a fragment that is actually ON SCREEN blocks another. The return
    // fade is not one: it is half a second of black over a world the player
    // already has back, and a jar taken inside it would otherwise be a memory
    // silently dropped - which is the one failure mode a story told in four
    // pieces cannot survive.
    if (state.phase === 'in' || state.phase === 'hold' || state.phase === 'out') return false;

    record = rec;
    teardown();
    groups = rec.stills.map((s) => {
      const g = buildStill(s);
      scene.add(g);
      return g;
    });
    showStill(0);

    const cam = rec.camera || {};
    const at = cam.at || [0, 1.6, 6];
    const look = cam.look || [0, 1.5, -6];
    camera.fov = cam.fov || 55;
    camera.position.set(at[0], at[1], at[2]);
    camera.lookAt(look[0], look[1], look[2]);
    // Force the aspect recompute on the first draw regardless of what the last
    // fragment left behind.
    lastW = 0;
    lastH = 0;
    camera.updateProjectionMatrix();

    const t = now();
    state.phase = 'in';
    state.id = rec.id || null;
    state.lastForced = false;
    state.shown++;
    openedAt = t;
    phaseAt = t;
    hardEndAt = t + totalOf(rec) + SAFETY_MS;

    // Full black IMMEDIATELY and synchronously, before the host's next frame.
    // The canvas still holds the world at this instant and must not be seen
    // being replaced - and it is lifted over the interface in the same tick, so
    // no frame exists in which the HUD is on top of a memory.
    setCurtain(1);
    liftCanvas();

    if (view) { stop(); rafId = view.requestAnimationFrame(pump); }
    return true;
  }

  /**
   * End whatever is up, now, and leave nothing on the screen.
   *
   * Idempotent, and it is what both the safety deadline and a host tearing down
   * a run call. It does NOT run the return fade: this is the abort path, and an
   * abort that spends half a second fading is an abort that has not happened.
   */
  function finish() {
    if (state.phase === 'none' || state.phase === 'done') { setCurtain(0); dropCanvas(); return; }
    if (record) release(now());
    state.phase = 'done';
    setCurtain(0);
    dropCanvas();
    stop();
  }

  function dispose() {
    stop();
    dropCanvas();
    teardown();
    if (curtain.parentNode) curtain.parentNode.removeChild(curtain);
  }

  return {
    show,
    finish,
    dispose,

    /**
     * IS THE MEMORY HOLDING THE WORLD. Same contract as `ui/briefing.js`.
     *
     * True from the frame `show()` is called to the frame the curtain reaches
     * full black on the way out. It is deliberately FALSE during the return
     * fade, because by then the world is what is underneath and the host should
     * be drawing it.
     *
     * The deadline check is the dead man's handle described at the top of the
     * file: a getter that can only ever say "still holding" is a getter that can
     * hang the game.
     */
    get holding() {
      if (state.phase === 'none' || state.phase === 'done' || state.phase === 'back') return false;
      if (now() > hardEndAt) { state.lastForced = true; finish(); return false; }
      return true;
    },

    /** For the harness. Nothing on screen reads this. */
    stats() {
      return {
        phase: state.phase,
        id: state.id,
        still: state.still,
        stills: groups.length,
        shown: state.shown,
        cuts: state.cuts,
        draws: state.draws,
        curtain: state.curtain,
        // Whether the canvas is currently over the interface. A memory with a
        // minimap on it passes every other number in this object.
        canvasLifted: prevCanvasZ !== null,
        lastMs: state.lastMs,
        lastForced: state.lastForced,
        // Measured off the scene graph rather than off the record, for the
        // reason jars.js gives about its own sockets: the bookkeeping and the
        // graph disagreeing is the bug class this project keeps finding.
        meshes: groups.reduce((n, g) => n + g.children.length, 0),
        visibleMeshes: groups.reduce(
          (n, g) => n + (g.visible ? g.children.length : 0), 0),
      };
    },
  };
}
