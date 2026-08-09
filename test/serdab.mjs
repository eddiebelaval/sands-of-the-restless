/**
 * THE SERDAB, MEASURED IN PIXELS FROM THE DOORWAY.
 *
 * The owner finished a run, walked into the room World 1 ends in, and reported
 * "it just turned black, nothing happened". The card was a clock bug and was
 * fixed (test/endgame.mjs). THE ROOM WAS NEVER BUILT: rooms.js called the
 * Serdab "a 196-unit reward closet", gave it five prop slots and one statue,
 * and everything the ending is about - the ten figures, the empty eleventh
 * niche, the archaeologist and her lamp - existed only in docs/NARRATIVE.md.
 *
 * ---------------------------------------------------------------------------
 * WHY THE UNIT IS PIXELS AND WHY THE CONTROL IS IN THE SAME RUN
 * ---------------------------------------------------------------------------
 *
 * "The room is no longer empty" is a claim about what a player SEES, so a
 * harness that counts prop slots, meshes or colliders is measuring the code's
 * opinion of itself. Five defects in this project passed exactly that kind of
 * green.
 *
 * So the instrument is a pixel diff between two screenshots taken from the SAME
 * camera, at the player's real eye height, one frame apart, with the room's
 * contents visible and then hidden. The lights are NOT touched: hiding a mesh
 * group leaves every point light exactly where it was, so the only variable
 * between the two frames is whether there is anything in the room. That is
 * test/frieze.mjs's swap-in-one-page discipline applied to geometry instead of
 * to a material, and it means the "before" is measured in the same process, on
 * the same driver, at the same light phase as the "after".
 *
 * A run against the unbuilt room and a run against the built one are then two
 * numbers that can be compared, because both were produced by the same control.
 *
 * ---------------------------------------------------------------------------
 * THE THREE CONTROLS THAT ARE NOT ABOUT THE ART
 * ---------------------------------------------------------------------------
 *
 *   1. THE HARD FLAG. docs/WORLD2-PLAN.md: `star-shaft -> serdab` clears the
 *      doorway rule with EXACTLY ZERO SLACK. This reads the live portal record
 *      and prints the slack in metres. Anything other than 0.000 means the
 *      Serdab's floor or ceiling moved, in either direction, and this file is
 *      the place that finds out.
 *
 *   2. THE PLAYER GETS IN AND BACK OUT. The 8/01 playtest found a wreck whose
 *      collider trapped the player. Nothing new in a room with one door may be
 *      allowed to do that, so the player WALKS the doorway on real frames in
 *      both directions and the positions are recorded rather than assumed.
 *
 *   3. NOTHING SPAWNS IN IT. The Serdab is the only room in twenty-five waves
 *      with no spawn points and that is what lets the ending happen at all.
 *      Counted twice - the authored list in rooms.js AND the director's own
 *      accepted placement set, which is the one the game actually draws from.
 *
 * Run: node test/serdab.mjs http://127.0.0.1:4188/index.html
 * Port 4188 rather than 4177 on purpose: the owner plays on 4177 and a
 * concurrent Playwright run starves it.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4188/index.html';
const TAG = (process.argv.find((a) => a.startsWith('--tag=')) || '--tag=now').slice(6);
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** What rooms.js authors for the sealed chapel's doorway. Read, never written. */
const CHAPEL_DOOR = { x: 40, z: -213 };

/** build.js's DOOR_H, and the number the zero-slack flag is against. */
const DOOR_H = 4.2;

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 90000 });
await page.waitForTimeout(2200);

/*
 * `__SANDS__.start()` RATHER THAN THE #begin BUTTON, and the first draft of
 * this file had it the other way round and measured nothing.
 *
 * ui/briefing.js raises a classified-document card over the whole frame when
 * the button is clicked, and it stays up until a player dismisses it. Every
 * screenshot in the first baseline run came back at 5.72 mean luma with 0.39
 * per cent of the frame lit - the briefing's own gold rule and four lines of
 * type on black - and BOTH poses were pixel-identical because neither of them
 * was a picture of a room. main.js exports `start()` as the seam for exactly
 * this, and says so: it starts the run and finishes the card in one tick. The
 * card's own behaviour is test/briefing.mjs's subject and not this file's.
 */
await page.evaluate(() => window.__SANDS__.start());
await page.waitForTimeout(1600);

await page.addScriptTag({
  content: `
window.__S__ = {
  async frames(n) {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  },

  /**
   * Put the body somewhere and let it FALL to the floor before anything is read.
   * Lifted verbatim in intent from test/jars.mjs: teleport arrives at y = 0 and
   * Act 3 is six metres down, so a frame read three frames after placing is read
   * from a camera still inside the ceiling.
   */
  settle() {
    const g = window.__SANDS__;
    for (let i = 0; i < 260; i++) {
      g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
      if (g.player.state.grounded) break;
    }
  },

  lookAt(v) {
    const g = window.__SANDS__;
    const p = g.player.position;
    const dx = v.x - p.x, dz = v.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    g.rig.reset(Math.atan2(-dx, -dz), Math.atan2((v.y === undefined ? p.y : v.y) - p.y, d));
  },

  async standAt(x, z, tx, tz, ty) {
    const g = window.__SANDS__;
    g.player.teleport({ x, y: 0, z });
    window.__S__.settle();
    window.__S__.lookAt({ x: tx, z: tz, y: ty });
    await window.__S__.frames(4);
  },

  pos() {
    const p = window.__SANDS__.player.position;
    return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) };
  },

  async hold(code, n) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    await window.__S__.frames(n);
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    await window.__S__.frames(2);
  },

  /**
   * Hold a key until something is TRUE, and never until a frame count.
   *
   * main.js clamps its simulation delta at 1/20 s, so under swiftshader - and
   * especially with a second harness sharing the machine - a slow frame carries
   * the body LESS ground, not more. A walk written as 'hold W for 200 frames'
   * therefore covers a different distance every run, and it failed this file's
   * walk-out control twice while nothing about the room had changed. Waiting on
   * the predicate is the project's own rule, stated in test/jars.mjs: everything
   * waits on state or on frames, never on a clock.
   *
   * Returns the frames it took, so a run that hit the cap is visible in the
   * output instead of looking like a body that stopped where it meant to.
   */
  async walkUntil(code, test, cap) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    let i = 0;
    for (; i < cap && !test(); i++) await new Promise((r) => requestAnimationFrame(r));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    await window.__S__.frames(2);
    return { frames: i, capped: i >= cap };
  },

  /**
   * Every prop the interior builder parked inside the Serdab, selected by WHERE
   * IT IS rather than by what it is called - so the same selector finds the
   * placeholder dressing and the built chapel and can be compared across the
   * two.
   *
   * THREE EXCLUSIONS, AND ALL THREE WERE MEASURED WRONG FIRST.
   *
   *   LIGHTS. This list is toggled to make the control frame. Hiding the room's
   *   only light would turn a measurement of geometry into a measurement of
   *   darkness.
   *
   *   THE SHELL. 'buildShell' adds the floor as an UNNAMED mesh at the room's
   *   centre, which a naive bounds test picks up. Hiding the floor of the room
   *   you are standing in changes most of the lower half of the frame and
   *   reported 24 per cent of "contents" in a room that had five props in it.
   *   Only Groups are taken, which is exactly what a prop or an interact is.
   *
   *   THE BARRIER. The puzzle gate's group stands at the portal, ON the room's
   *   bounds, and 'clearInstantly'/the animator END by setting 'g.visible =
   *   false'. Toggling it back on would have redrawn a sealed door across the
   *   doorway in every "with" frame. It is found by the 'userData.door' tag its
   *   own meshes carry rather than by its coordinate.
   */
  contents() {
    const g = window.__SANDS__;
    const r = g.interior.rooms.find((x) => x.id === 'serdab').bounds;
    // Shrunk by the wall thickness: anything standing ON the boundary is the
    // shell or the doorway, not the room's contents.
    const x0 = r.x - r.w / 2 + 1, x1 = r.x + r.w / 2 - 1;
    const z0 = r.z - r.d / 2 + 1, z1 = r.z + r.d / 2 - 1;
    return g.interior.group.children.filter((o) => {
      if (!o.isGroup && o.type !== 'Group') return false;
      let door = false;
      o.traverse((c) => { if (c.userData && c.userData.door) door = true; });
      if (door) return false;
      const p = o.position;
      return p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
    });
  },

  /**
   * What the room costs the scene graph, counted off the graph itself.
   *
   * 'merged' is the number of source meshes world/batch.js folded away, read
   * back off the userData tag it leaves on every batch. Without it a claim that
   * the row was merged would be a claim about code that ran, and this project
   * has been burned by exactly that: a merge that silently did nothing looks
   * identical in a screenshot and identical in a triangle count.
   */
  census() {
    const list = window.__S__.contents();
    let meshes = 0, batches = 0, merged = 0, tris = 0;
    const mats = new Set();
    for (const o of list) {
      o.traverse((c) => {
        if (!c.isMesh) return;
        meshes++;
        if (c.material) mats.add(c.material.uuid);
        if (c.userData.batched) { batches++; merged += c.userData.batched; }
        const g = c.geometry;
        if (g && g.attributes && g.attributes.position) {
          tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
        }
      });
    }
    return { groups: list.length, meshes, batches, merged, materials: mats.size, triangles: tris };
  },

  showContents(on) {
    const list = window.__S__.contents();
    for (const o of list) {
      // Restore to what it was, never to 'true': a group the game had hidden
      // for its own reasons must not be switched on by an instrument.
      if (o.userData.__wasVisible === undefined) o.userData.__wasVisible = o.visible;
      o.visible = on ? o.userData.__wasVisible : false;
    }
    return list.length;
  },

  /**
   * Draw calls and triangles for ONE scene pass, with the info counter reset by
   * hand around it.
   *
   * renderer.info.autoReset is true and the post chain issues several render
   * calls per frame, so reading info after a composed frame reports whatever the
   * last full-screen quad cost - which is the same tiny number no matter what is
   * in the room. Turning autoReset off, resetting, and rendering the scene once
   * directly is the only reading that answers "what does this room cost".
   */
  scenePass() {
    const g = window.__SANDS__;
    const info = g.renderer.info;
    const prior = info.autoReset;
    const target = g.renderer.getRenderTarget();
    info.autoReset = false;

    /*
     * RENDERED TWICE AND THE SECOND ONE IS THE READING, and the first version
     * of this reported 14 draw calls and 216 triangles for a whole pyramid.
     *
     * The post chain leaves a render target bound and leaves its own state on
     * the renderer, so the first direct render after a composed frame is not a
     * picture of the scene - it is whatever the composer was in the middle of.
     * Binding the default target and throwing the first pass away costs one
     * frame of a harness and removes a reading that was silently wrong at one
     * of the two poses in three runs out of four.
     */
    g.renderer.setRenderTarget(null);
    info.reset();
    g.renderer.render(g.scene, g.camera);
    info.reset();
    g.renderer.render(g.scene, g.camera);

    const out = {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
    };
    info.autoReset = prior;
    g.renderer.setRenderTarget(target);
    return out;
  },
};
`,
});

// The horde is live from the first breather and this suite is about a room.
// Same exemption test/interior.mjs and test/jars.mjs take.
await page.evaluate(() => { window.__SANDS__.combat.state.invulnerable = true; });

const R = {};

// ---------------------------------------------------------------------------
// 1. the hard flag, read off the live build
// ---------------------------------------------------------------------------

R.flag = await page.evaluate((DOOR_H) => {
  const g = window.__SANDS__;
  const room = g.interior.rooms.find((r) => r.id === 'serdab');
  const shaft = g.interior.rooms.find((r) => r.id === 'star-shaft');
  const p = g.interior.portals.find(
    (q) => (q.from === 'star-shaft' && q.to === 'serdab') || (q.from === 'serdab' && q.to === 'star-shaft'));

  const floor = room.base || 0;
  const ceil = floor + room.height;

  return {
    bounds: room.bounds,
    base: floor,
    height: room.height,
    ceilingAbsolute: ceil,
    shaftBase: shaft.base || 0,
    shaftCeiling: (shaft.base || 0) + shaft.height,
    portal: p ? { from: p.from, to: p.to, at: p.at, width: p.width, kind: p.kind, cost: p.cost, sill: p.sill, clear: p.clear } : null,
    // The whole flag in one number. portalOpening() gives the doorway
    // min(DOOR_H, ceil - sill - 0.8); this is how much room the second term has
    // over the first. Zero is the authored value and anything else is a change
    // to the Serdab's floor or ceiling.
    slack: p ? +((ceil - p.sill - 0.8) - DOOR_H).toFixed(6) : null,
  };
}, DOOR_H);

// ---------------------------------------------------------------------------
// 2. nothing spawns in it, counted from both lists
// ---------------------------------------------------------------------------

R.spawns = await page.evaluate(() => {
  const g = window.__SANDS__;
  const authored = g.interior.rooms.map((r) => ({ id: r.id, n: (r.spawnPoints || []).length }));
  const accepted = g.director.spawnPoints();
  return {
    serdabAuthored: authored.find((r) => r.id === 'serdab').n,
    serdabAccepted: accepted.filter((p) => p.room === 'serdab').length,
    interiorAuthoredTotal: authored.reduce((a, r) => a + r.n, 0),
    interiorAcceptedTotal: accepted.filter((p) => p.room).length,
    perRoom: authored,
  };
});

// ---------------------------------------------------------------------------
// 3. the doorway, walked, in both directions
// ---------------------------------------------------------------------------
//
// The counter is set to four and the gate is then opened through `gate.open()`,
// which is the EXACT call systems/jars.js makes when the fourth son goes home
// ("Unlocking is the state; opening is the event"). The four-jar chain is
// test/jars.mjs's subject and re-staging it here would be a worse copy of a
// passing test; what this file needs is a doorway that is open, obtained
// through the door's own opening path rather than by deleting the barrier.

R.walk = await page.evaluate(async (DOOR) => {
  const g = window.__SANDS__;
  g.spaces.enter('interior', { x: 34, z: -213, rot: -Math.PI / 2 });
  await window.__S__.frames(8);

  g.doors.state.jarsReturned = 4;
  const rec = g.doors.all.find((x) => x.kind === 'puzzle');
  const lockedBefore = !!(rec && !rec.opened && !rec.opening);
  if (rec) rec.open();

  // The barrier drops its colliders on the first frame of the open and animates
  // for OPEN_SECONDS; wait on the record rather than on a clock.
  for (let i = 0; i < 400 && !(rec && rec.opened); i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }

  const start = window.__S__.pos();
  const roomBefore = g.spaces.roomId;

  /*
   * IN. Held W on real frames through the opening, not a teleport.
   *
   * AIMED AT (54, -209.5) RATHER THAN STRAIGHT DOWN THE AXIS, and the offset is
   * the point rather than a dodge. The archaeologist sits near the room's
   * centre line, so a walk aimed at the middle of the back wall is a walk into
   * a person - which stops the body, correctly, and would have made this
   * control measure whether she is solid instead of whether the room can be
   * crossed. This lane passes 2.6 m south of her and clear of both urns, so
   * what stops the player at the far end is the back wall and nothing else.
   */
  await window.__S__.standAt(36, -213, 54, -209.5);
  const legIn = await window.__S__.walkUntil('KeyW', () => g.spaces.roomId === 'serdab', 600);
  const inside = window.__S__.pos();
  const roomInside = g.spaces.roomId;

  // Keep going, on the same heading, until the far end of the room. What is
  // being asked is whether a body can cross the chapel; the cap is the answer
  // "no" rather than a timeout.
  const legDeep = await window.__S__.walkUntil('KeyW', () => g.player.position.x >= 50, 600);
  const deep = window.__S__.pos();

  /*
   * OUT, THE WAY IN, IN TWO LEGS - and the two legs are the harness being
   * honest about what it is testing rather than a workaround.
   *
   * The crossing leg ends in the far corner. A single straight walk from there
   * to a point outside the room does not pass through a 2.4 m opening; the
   * first version of this aimed at (30, -213) and put the player against the
   * west wall at z = -210.7, a metre and a half north of the door, and reported
   * a trapped player. Nothing was trapping them. A body that walks into a wall
   * because the harness pointed it at one is not a defect, and a control that
   * cannot tell those apart is worse than no control.
   *
   * So: line up on the doorway's own axis inside the room, then walk out along
   * it. What is being tested is that the opening lets the player back through,
   * and that is what these two holds do.
   */
  window.__S__.lookAt({ x: 43, z: -213 });
  await window.__S__.frames(4);
  const legLine = await window.__S__.walkUntil(
    'KeyW', () => g.player.position.x < 45 && Math.abs(g.player.position.z + 213) < 0.8, 900);
  const lined = window.__S__.pos();

  window.__S__.lookAt({ x: 30, z: -213 });
  await window.__S__.frames(4);
  const legOut = await window.__S__.walkUntil('KeyW', () => g.spaces.roomId !== 'serdab', 900);
  const out = window.__S__.pos();
  const roomOut = g.spaces.roomId;

  return {
    lockedBefore,
    doorOpened: !!(rec && rec.opened),
    start, roomBefore,
    inside, roomInside,
    deep,
    lined,
    out, roomOut,
    legs: { in: legIn, deep: legDeep, line: legLine, out: legOut },
    // A body that ended the return walk still inside the chapel is a body the
    // room would not let go, which is the trap this control exists to catch.
    escaped: roomOut !== 'serdab',
  };
}, CHAPEL_DOOR);

// ---------------------------------------------------------------------------
// 4. what the player sees, from the doorway, at their real eye height
// ---------------------------------------------------------------------------

/** Fraction of pixels that differ, and how bright each frame is. */
async function compare(a, b) {
  const A = await sharp(a).raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(b).raw().toBuffer({ resolveWithObject: true });
  const ch = A.info.channels;
  const n = A.info.width * A.info.height;

  let diff = 0, lumA = 0, lumB = 0, inkA = 0, inkB = 0;
  for (let i = 0; i < n; i++) {
    const o = i * ch;
    const la = (A.data[o] + A.data[o + 1] + A.data[o + 2]) / 3;
    const lb = (B.data[o] + B.data[o + 1] + B.data[o + 2]) / 3;
    lumA += la; lumB += lb;
    if (la > 12) inkA++;
    if (lb > 12) inkB++;
    const d = Math.max(
      Math.abs(A.data[o] - B.data[o]),
      Math.abs(A.data[o + 1] - B.data[o + 1]),
      Math.abs(A.data[o + 2] - B.data[o + 2]));
    if (d > 8) diff++;
  }

  return {
    pixels: n,
    coveragePct: +((diff / n) * 100).toFixed(2),
    withMeanLuma: +(lumA / n).toFixed(2),
    withoutMeanLuma: +(lumB / n).toFixed(2),
    withLitPct: +((inkA / n) * 100).toFixed(2),
    withoutLitPct: +((inkB / n) * 100).toFixed(2),
  };
}

/**
 * One pose, shot twice: contents shown, contents hidden. Same camera, same
 * lights, one frame apart.
 */
async function pose(name, at, look) {
  const eye = await page.evaluate(async ([a, l]) => {
    await window.__S__.standAt(a.x, a.z, l.x, l.z, l.y);
    await window.__S__.frames(10);
    const p = window.__S__.pos();
    const floor = window.__SANDS__.interior.heightAt(p.x, p.z);
    return {
      pos: p,
      room: window.__SANDS__.spaces.roomId,
      floor: +floor.toFixed(2),
      eyeAboveFloor: +(p.y - floor).toFixed(2),
    };
  }, [at, look]);

  await page.evaluate(() => window.__S__.showContents(true));
  await page.evaluate(() => window.__S__.frames(3));
  const withPath = `${OUT}serdab-${TAG}-${name}-with.png`;
  await page.screenshot({ path: withPath });
  const drawWith = await page.evaluate(() => window.__S__.scenePass());

  const hidden = await page.evaluate(() => window.__S__.showContents(false));
  await page.evaluate(() => window.__S__.frames(3));
  const withoutPath = `${OUT}serdab-${TAG}-${name}-without.png`;
  await page.screenshot({ path: withoutPath });
  const drawWithout = await page.evaluate(() => window.__S__.scenePass());

  await page.evaluate(() => window.__S__.showContents(true));
  await page.evaluate(() => window.__S__.frames(2));

  const cmp = await compare(withPath, withoutPath);

  return {
    ...eye,
    groupsToggled: hidden,
    ...cmp,
    drawCallsWith: drawWith.calls,
    drawCallsWithout: drawWithout.calls,
    trianglesWith: drawWith.triangles,
    trianglesWithout: drawWithout.triangles,
    roomDrawCalls: drawWith.calls - drawWithout.calls,
    roomTriangles: drawWith.triangles - drawWithout.triangles,
  };
}

R.census = await page.evaluate(() => window.__S__.census());

/*
 * BOTH POSES LOOK LEVEL, AND THE FIRST CUT DID NOT.
 *
 * The look targets used to carry `y: 0`, which is an ABSOLUTE world height, and
 * Act 3's floor is at -6. So a camera standing at eye level in the Serdab was
 * aimed 4.32 m above its own eye - twenty-one degrees up - and both "frames the
 * player sees" were photographs of the ceiling with the room along the bottom
 * edge. The coverage numbers were real and were measuring the wrong picture.
 *
 * Omitting y makes lookAt level the gaze on the player's own eye, which is
 * where a player walking through a doorway is looking. It was caught by opening
 * the screenshot, which is the only instrument that would have caught it.
 */

// Just inside the door, looking down the room's long axis at the back wall.
// This is the frame the owner walked into and reported as empty.
R.doorway = await pose('doorway', { x: 41.8, z: -213 }, { x: 53, z: -213 });

// Standing where the beat is delivered, looking at the side wall the eleventh
// niche is cut into - the wall that had nothing on it at all before this lane.
R.chapel = await pose('chapel', { x: 45.0, z: -212.0 }, { x: 50.4, z: -219 });

// ---------------------------------------------------------------------------
// 5. the ending card still fires in the room that is now full
// ---------------------------------------------------------------------------

R.ending = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.player.teleport({ x: 47, y: 0, z: -213 });
  window.__S__.settle();
  // Ten frames, not four. `spaces.roomId` is written by the router inside the
  // frame loop, so a read taken immediately after a teleport reports the room
  // the player was in BEFORE it - which is how a first draft of this file
  // recorded the ending firing from the Star Shaft.
  await window.__S__.frames(10);

  const room = g.spaces.roomId;
  const began = g.ending.begin();

  let f = 0;
  while (g.ending.phase !== 'waiting' && f < 900) {
    await new Promise((r) => requestAnimationFrame(r));
    f++;
  }
  const s = g.ending.stats();
  return { room, began, phase: s.phase, cardVisible: s.cardVisible, verdict: s.verdict, glyphs: s.glyphs };
});

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const checks = {
  'the hard flag holds: doorway slack is exactly zero':
    R.flag.slack === 0,
  'the Serdab floor is still -6 and its ceiling still 5 above it':
    R.flag.base === -6 && R.flag.height === 5,
  'the puzzle portal is unchanged: 2.4 wide, cost 0, at (40, -213)':
    !!R.flag.portal && R.flag.portal.width === 2.4 && R.flag.portal.cost === 0
    && R.flag.portal.at.x === 40 && R.flag.portal.at.z === -213,
  'the doorway still clears DOOR_H exactly':
    !!R.flag.portal && Math.abs(R.flag.portal.clear - DOOR_H) < 1e-9,
  'no spawn points are authored in the Serdab':
    R.spawns.serdabAuthored === 0,
  'and the director accepts none there either':
    R.spawns.serdabAccepted === 0,
  'the sealed chapel opened through the real purchase path':
    R.walk.doorOpened === true,
  'the player WALKED in from the Star Shaft':
    R.walk.roomBefore === 'star-shaft' && R.walk.roomInside === 'serdab',
  // Nine metres of a twelve-metre room, on a lane with nothing authored in it.
  // A body stopped short of that was stopped by something new.
  'and crossed the chapel to the far wall':
    Math.max(R.walk.inside.x, R.walk.deep.x) >= 50 && !R.walk.legs.deep.capped,
  'and WALKED back out again':
    R.walk.escaped === true && R.walk.roomOut === 'star-shaft',
  'the doorway frame is not an empty room':
    R.doorway.coveragePct >= 8,
  'the eye is at the player height, not a debug camera':
    Math.abs(R.doorway.eyeAboveFloor - 1.68) < 0.02,
  'and it is standing in the Serdab when it takes the picture':
    R.doorway.room === 'serdab' && R.chapel.room === 'serdab',
  'the frame is a lit room and not a title card':
    R.doorway.withLitPct > 20,
  'the chapel frame carries the beat as well':
    R.chapel.coveragePct >= 8,
  'the ending card still fires in the room':
    R.ending.room === 'serdab' && R.ending.phase === 'waiting'
    && R.ending.cardVisible === true && R.ending.verdict === 'THE NAME IS NOT HERE',
  'no page errors':
    logs.length === 0,
};

console.log(JSON.stringify(R, null, 2));
console.log('');
console.log('--- the room, off the scene graph -------------------------------');
console.log(
  `groups ${R.census.groups}  meshes ${R.census.meshes}  materials ${R.census.materials}  ` +
  `triangles ${R.census.triangles}  batches ${R.census.batches} (${R.census.merged} meshes merged away)`);
console.log('');
console.log('--- shots -------------------------------------------------------');
for (const k of ['doorway', 'chapel']) {
  const s = R[k];
  console.log(
    `${k.padEnd(9)} coverage ${String(s.coveragePct).padStart(6)}%  ` +
    `luma ${String(s.withoutMeanLuma).padStart(6)} -> ${String(s.withMeanLuma).padStart(6)}  ` +
    `lit ${String(s.withoutLitPct).padStart(6)}% -> ${String(s.withLitPct).padStart(6)}%  ` +
    `draws ${s.drawCallsWithout} -> ${s.drawCallsWith} (+${s.roomDrawCalls})  ` +
    `tris ${s.trianglesWithout} -> ${s.trianglesWith} (+${s.roomTriangles})`);
}
console.log('');
console.log('--- checks ------------------------------------------------------');
let bad = 0;
for (const [k, v] of Object.entries(checks)) {
  if (!v) bad++;
  console.log(`${v ? 'ok  ' : 'FAIL'}  ${k}`);
}
if (logs.length) {
  console.log('');
  for (const l of logs.slice(0, 20)) console.log(l);
}
console.log('');
console.log(bad ? `${bad} FAILED` : 'all checks passed');

await browser.close();
process.exit(bad ? 1 : 0);
