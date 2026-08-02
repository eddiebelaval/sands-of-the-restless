/**
 * THE DESCENT: does the player actually go down, and can the horde follow.
 *
 * World 1's Act 2 to Act 3 seam drops six metres. Three doorways out of the
 * Great Gallery open onto three ramps, each sixteen metres of run for six of
 * fall, and everything from the Embalming Chamber to the Serdab sits on a floor
 * at y = -6. That is a claim about geometry, and geometry in this project has a
 * defining failure mode: it gets written, it gets described, and it never
 * renders. So nothing here asserts that a ramp record exists. Every check below
 * either moves a body through the world and reads where it ended up, or asks the
 * horde's own field what it thinks the route costs.
 *
 * ---------------------------------------------------------------------------
 * TWO TIME AXES, AND THIS FILE USES BOTH ON PURPOSE
 * ---------------------------------------------------------------------------
 *
 * The centre descent - the Canopic Crypt door, which is the one on the axis the
 * player walks in on - is walked on REAL requestAnimationFrame FRAMES, driven by
 * REAL keydown events, through the real main loop, its real delta clamp and its
 * real collision resolver. Nothing about that leg is simulated by this file. It
 * is slow under swiftshader, where one frame is most of a second, and it is
 * slow deliberately: calling player.update() in a tight loop has produced false
 * failures in this project before, and the load-bearing route deserves the
 * expensive answer.
 *
 * The west and east descents, and the climb back up, are driven by
 * player.update() directly, which is the idiom the shipped interior suite
 * already uses for geometry work. They are coverage, not the proof, and the
 * report says which is which.
 *
 * Routing is driven through director.update(), like test/nav.mjs, for the reason
 * that file gives: the flood is not a render, and waiting on frames to advance
 * it wastes a second per tick for nothing.
 *
 * Everything waits on STATE or on FRAMES. Never on a wall clock.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** Eye above the feet. Mirrors EYE_HEIGHT in player/controller.js. */
const EYE = 1.68;

/** What rooms.js authors. Read here as the number the world must agree with. */
const ACT2_FLOOR = 0;
const ACT3_FLOOR = -6;

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1400);

await page.addScriptTag({
  content: `
window.__D__ = {
  /** Advance n real frames. */
  async frames(n) {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  },

  /** Harness placement. y is the FEET, and the controller settles it. */
  place(x, z, yaw, y = 0) {
    const g = window.__SANDS__;
    g.player.teleport({ x, y, z });
    g.rig.reset(yaw, -0.02);
  },

  /** Simulated walk: the cheap axis. */
  walk(yaw, steps, sprint = true) {
    const g = window.__SANDS__;
    g.rig.reset(yaw, -0.02);
    for (let i = 0; i < steps; i++) {
      g.player.update(1 / 60, { forward: 1, strafe: 0, sprint, jump: false }, yaw);
    }
  },

  key(code, down) {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  },

  /** Eye position, and the feet under it. */
  pos() {
    const p = window.__SANDS__.player.position;
    return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), feet: +(p.y - ${EYE}).toFixed(2) };
  },

  /** Open every interior barrier as though the tier had never built them. */
  openInterior() {
    let n = 0;
    for (const b of window.__SANDS__.spaces.interior.barriers) if (b.clearInstantly()) n++;
    return n;
  },

  /**
   * One actor, one fixed player, N simulated seconds. Lifted verbatim in shape
   * from test/nav.mjs, including its arrival rule: closest approach reaching
   * melee, not the distance on the final tick, because an actor that arrives and
   * is then pushed back out by the separation force has still arrived.
   */
  chase(id, ax, az, px, pz, seconds, py = 0) {
    const g = window.__SANDS__;
    const d = g.director;
    d.reset();
    window.__D__.place(px, pz, 0, py);
    g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
    const a = d.placeAt(id, ax, az);
    if (!a) return null;

    const dist = () => Math.hypot(a.position.x - g.player.position.x, a.position.z - g.player.position.z);
    const start = dist();
    let closest = start;
    let arrivedAt = -1;
    let lowest = a.position.y;
    let highest = a.position.y;
    const dt = 1 / 30;
    const n = Math.ceil(seconds / dt);
    for (let i = 0; i < n; i++) {
      d.update(dt, i * dt);
      g.combat.update(dt);
      if (!a.live) break;
      lowest = Math.min(lowest, a.position.y);
      highest = Math.max(highest, a.position.y);
      const dd = dist();
      if (dd < closest) closest = dd;
      if (dd <= 3 && arrivedAt < 0) arrivedAt = i * dt;
    }
    return {
      start: +start.toFixed(2),
      closest: +closest.toFixed(2),
      arrivedAt: arrivedAt >= 0 ? +arrivedAt.toFixed(1) : null,
      lowestY: +lowest.toFixed(2),
      highestY: +highest.toFixed(2),
    };
  },

  /**
   * Mean luminance over the top two thirds, which is world and not weapon.
   *
   * THE READ HAPPENS INSIDE THE requestAnimationFrame CALLBACK, and that is the
   * whole of it. The drawing buffer is not preserved, so drawImage from
   * anywhere else in the frame copies a cleared canvas and reports a perfectly
   * black screen for a scene that rendered correctly. Measured here: 0.0 mean
   * against a shot that is plainly lit. Lifted from test/interior.mjs, which
   * already had it right.
   */
  luma() {
    const c = window.__SANDS__.renderer.domElement;
    const sc = document.createElement('canvas');
    sc.width = c.width; sc.height = c.height;
    const cx = sc.getContext('2d', { willReadFrequently: true });

    return new Promise((resolve) => requestAnimationFrame(() => {
      cx.drawImage(c, 0, 0);
      const d = cx.getImageData(0, 0, sc.width, sc.height).data;
      let sum = 0, n = 0, lit = 0;
      const rows = Math.floor(sc.height * 0.66);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < sc.width; x += 4) {
          const i = (y * sc.width + x) * 4;
          const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
          sum += l; n++;
          if (l > 10) lit++;
        }
      }
      resolve({ mean: +(sum / n).toFixed(2), lit: +((lit / n) * 100).toFixed(1) });
    }));
  },
};
`,
});

// The horde is live from wave one and this file is about geometry, not combat.
await page.evaluate(() => { window.__SANDS__.combat.state.invulnerable = true; });

const results = {};

// ---------------------------------------------------------------------------
// 1. the floor table: is every room's floor where rooms.js says it is
// ---------------------------------------------------------------------------
//
// Sampled through world.heightAt, which is the one function the player, the
// mummies, the grenades and the flow field all read. Asked twice at each point,
// with the room's own floor as footY and with undefined, because those are the
// two readings the contract has and a descent breaks them differently: the first
// is "what am I standing on", the second is "what is the highest surface here".

results.floors = await page.evaluate(() => {
  const g = window.__SANDS__;
  g.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
  const h = g.world.heightAt;
  const out = {};
  for (const r of g.spaces.interior.rooms) {
    const base = r.base || 0;
    out[r.id] = {
      authored: base,
      standing: +h(r.bounds.x, r.bounds.z, base).toFixed(3),
      highest: +h(r.bounds.x, r.bounds.z, undefined).toFixed(3),
      ceiling: +(base + r.height).toFixed(2),
    };
  }
  return out;
});

// ---------------------------------------------------------------------------
// 2. the descent, walked on real frames through real input
// ---------------------------------------------------------------------------
//
// Centre door, Great Gallery to Canopic Crypt. The player starts on the gallery
// floor north of the gate, holds W, and the main loop does the rest: real
// deltas, real collision, real floor sampling, real everything. The samples are
// taken every four frames so the descent has a PROFILE rather than a start and
// an end - a player who teleports through the geometry and a player who walks
// down it produce the same two endpoints and completely different middles.

results.realWalk = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
  window.__D__.openInterior();

  /**
   * z -193.5, NOT further back, and the reason is a shipped prop rather than
   * anything to do with the descent.
   *
   * The gallery carries a rubble slot at (0, -190) with a 1.5 m collider, and
   * the two side gates at x +/-20 each have a colonnade standing at z -192,
   * four metres in front of them. A harness that starts at z -186 and holds W
   * walks into stone and reports a descent that does not work. It was measured
   * doing exactly that: stalled at z -187.9 for 176 frames with the key held.
   * A player goes round; a straight line cannot, and the straight line is the
   * only thing this file is able to drive. So the leg starts inside the last
   * clear stretch before the gate, which is what is actually being tested.
   */
  window.__D__.place(0, -193.5, 0);
  await window.__D__.frames(3);

  const start = window.__D__.pos();
  const profile = [start];

  window.__D__.key('KeyW', true);
  window.__D__.key('ShiftLeft', true);

  // Bounded by frames, not by seconds. 180 frames of the delta clamp is nine
  // simulated seconds, which is roughly twice the walk; the count is reported so
  // a route that only just made it is visible as one that only just made it.
  let f = 0;
  for (; f < 180; f++) {
    await new Promise((r) => requestAnimationFrame(r));
    if (f % 4 === 0) profile.push(window.__D__.pos());
    if (g.player.position.z <= -212) break;
  }

  window.__D__.key('KeyW', false);
  window.__D__.key('ShiftLeft', false);
  await window.__D__.frames(4);

  const end = window.__D__.pos();
  profile.push(end);

  // Did the walk ever stall? A wall in the doorway shows up as the z stopping
  // while the key is still held, not as a wrong endpoint.
  let stalledFor = 0, worst = 0, prevZ = start.z;
  for (const p of profile.slice(1)) {
    if (prevZ - p.z < 0.05) stalledFor++; else stalledFor = 0;
    worst = Math.max(worst, stalledFor);
    prevZ = p.z;
  }

  return {
    start, end, frames: f,
    room: g.spaces.roomId,
    longestStallSamples: worst,
    profile: profile.map((p) => [p.z, p.feet]),
    grounded: g.player.state.grounded,
  };
});

// ---------------------------------------------------------------------------
// 3. the other two descents, and the climb back out
// ---------------------------------------------------------------------------
//
// Simulated. The climb is the half that can fail on its own: falling down a
// ramp needs no permission, and walking back UP one is gated by STEP_UP at every
// single frame. A descent you cannot leave is a hole.

results.legs = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
  window.__D__.openInterior();

  const leg = (x, zFrom, zTo, yaw, startFeet) => {
    window.__D__.place(x, zFrom, yaw, startFeet);
    window.__D__.walk(yaw, 420);
    const p = window.__D__.pos();
    return { x: p.x, z: p.z, feet: p.feet, reached: yaw === 0 ? p.z <= zTo : p.z >= zTo };
  };

  /**
   * THE CLIMB STARTS BEYOND THE FOOT OF THE RAMP, at z -216 rather than -208,
   * and that is a property of the map and not a convenience.
   *
   * A ramp is only walkable from ON it. Everywhere along its sixteen metres
   * except the very bottom, the Act 3 floor runs UNDERNEATH it, and a player
   * standing down there is refused the surface overhead by STEP_UP - which is
   * the same rule that stops them being snapped onto the gallery's ledge from
   * below, and it is correct. Measured: placed at z -208 with feet at -6, the
   * player walked north under the ramp and came to rest against the stone under
   * the doorway, still at -6, having never been on the slope at all. The only
   * on-ramp is its foot at z -212, which is exactly where a player coming north
   * out of the King's Chamber meets it.
   */
  return {
    westDown: leg(-20, -194.5, -210, 0, 0),
    eastDown: leg(20, -194.5, -210, 0, 0),
    centreDownAgain: leg(0, -194.5, -210, 0, 0),
    // -194 rather than -192, because the gallery's colonnade stands at z -192
    // on both side gates and stops a straight line four metres inside the room.
    // Clearing the doorway at -196 onto the gallery floor is the claim; getting
    // past the shipped columns is not.
    centreUp: leg(0, -216, -194, Math.PI, -6),
    westUp: leg(-20, -216, -194, Math.PI, -6),
    eastUp: leg(20, -216, -194, Math.PI, -6),
  };
});

// ---------------------------------------------------------------------------
// 4. you cannot walk onto the ramp from underneath it
// ---------------------------------------------------------------------------
//
// The same assertion act1probe.mjs makes about the quarry terrace, asked of the
// three new ramps. A ramp that is walkable from below is not a second storey, it
// is a lid: the player standing on the Act 3 floor gets snapped six metres into
// the air by whatever is over their head.

results.fromBelow = await page.evaluate(() => {
  const h = window.__SANDS__.world.heightAt;
  const at = (x, z, f) => +h(x, z, f).toFixed(2);
  // z -200 is four metres in from each doorway, where the ramp is about 4.5 m
  // above the floor beneath it.
  return {
    west_on: at(-20, -200, -1.5), west_below: at(-20, -200, -6), west_highest: at(-20, -200, undefined),
    centre_on: at(0, -200, -1.5), centre_below: at(0, -200, -6), centre_highest: at(0, -200, undefined),
    east_on: at(20, -200, -1.5), east_below: at(20, -200, -6), east_highest: at(20, -200, undefined),
  };
});

// ---------------------------------------------------------------------------
// 4b. the stone under each doorway actually exists
// ---------------------------------------------------------------------------
//
// A doorway six metres above the floor of the room it opens into has a hole
// under it unless something is built there, and that hole shows the void
// between the rooms. The far room's wall does not cover it: that wall starts at
// ITS floor, which is the sill. This reads world.walls, which is the same list
// the player's resolver and the flow field's clearance test read, so a box that
// is not in here is not stone to anything in the game.
//
// The expected span is the room floor up to one ramp thickness below the sill.
// It stops short rather than reaching the sill because the descent ramp runs
// through the opening and its top surface has already fallen by the gradient a
// metre in; stone taken all the way up would stand proud of the walkway and the
// resolver would refuse to let the player out of the door.

results.underDoor = await page.evaluate(() => {
  const g = window.__SANDS__;
  const out = {};
  for (const [name, x] of [['west', -20], ['centre', 0], ['east', 20]]) {
    // The gap is 4.0 wide on the z = -196 line; the lower room's wall slab is
    // centred half a wall thickness inside it.
    const box = g.world.walls.find((w) =>
      Math.abs(w.z - (-196.5)) < 0.01 && Math.abs(w.x - x) < 0.01 && w.y1 < 0);
    out[name] = box ? { y0: +box.y0.toFixed(2), y1: +box.y1.toFixed(2), w: +box.w.toFixed(2) } : null;
  }
  return out;
});

// ---------------------------------------------------------------------------
// 5. the horde's field: does a route exist across the drop, both ways
// ---------------------------------------------------------------------------

results.flow = await page.evaluate(() => {
  const g = window.__SANDS__;
  const d = g.director;
  g.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
  window.__D__.openInterior();

  // Player on the gallery floor: can the field reach the bottom of all three?
  window.__D__.place(0, -170, 0, 0);
  g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
  d.refreshFlow();
  const fromAbove = {
    westFoot: +d.flow.costAt(-20, -210, -6).toFixed(0),
    centreFoot: +d.flow.costAt(0, -210, -6).toFixed(0),
    eastFoot: +d.flow.costAt(20, -210, -6).toFixed(0),
    kings: +d.flow.costAt(0, -252, -6).toFixed(0),
    serdab: +d.flow.costAt(47, -213, -6).toFixed(0),
  };

  // Player at the bottom: can the field climb back to the gallery and to its
  // upper ring, which is the only other storey in the map.
  window.__D__.place(0, -210, 0, -6);
  g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
  d.refreshFlow();
  const fromBelow = {
    galleryFloor: +d.flow.costAt(0, -170, 0).toFixed(0),
    galleryLedgeW: +d.flow.costAt(-21, -180, 6).toFixed(0),
    galleryLedgeE: +d.flow.costAt(21, -180, 6).toFixed(0),
    chamberOfAscent: +d.flow.costAt(0, -149, 0).toFixed(0),
  };

  const s = d.stats().flow;
  return { fromAbove, fromBelow, layered: s.layered, layersFull: s.layersFull, cells: s.cells };
});

// ---------------------------------------------------------------------------
// 6. an actual body walks it
// ---------------------------------------------------------------------------
//
// A field with a finite cost in it is a claim. An actor that starts on the Act 3
// floor and reaches a player on the gallery floor is the claim cashed, and its
// highest y along the way is the evidence it used the ramp rather than being
// dragged through the stone.

results.actors = await page.evaluate(() => {
  const g = window.__SANDS__;
  g.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
  window.__D__.openInterior();
  return {
    // King's Chamber, two rooms and one climb away from the gallery floor.
    upFromKings: window.__D__.chase('shambler', 0, -252, 0, -170, 70, 0),
    // And the other way: gallery down to a player at the foot of the crypt ramp.
    downToCrypt: window.__D__.chase('shambler', 0, -165, 0, -214, 70, -6),
  };
});

// ---------------------------------------------------------------------------
// 7. it renders
// ---------------------------------------------------------------------------

results.shots = {};
for (const [name, place] of [
  ['descent-head', [0, -190, 0, 0]],
  ['descent-mid', [0, -202, 0, -2.25]],
  ['descent-foot', [0, -213, Math.PI, -6]],
  // Off the axis, looking back at the north wall from the crypt floor. This is
  // the shot that shows the stone UNDER the doorway: without it the wall would
  // carry a four-metre-wide, five-metre-tall hole into the void between the
  // rooms, and no assertion in this file would notice.
  // Off the axis and clear of the ramp's west edge, aimed back at the doorway,
  // so the stone under it is in frame. The assertion for that stone is
  // geometric (section 4b); this is the picture that says the assertion is
  // about the thing a player would see.
  ['descent-underdoor', [6.5, -203, 2.47, -6]],
]) {
  await page.evaluate(([x, z, yaw, y]) => {
    window.__SANDS__.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
    window.__D__.openInterior();
    window.__D__.place(x, z, yaw, y);
  }, place);
  await page.evaluate(() => window.__D__.frames(6));
  await page.screenshot({ path: `${OUT}${name}.png` });
  results.shots[name] = await page.evaluate(() => window.__D__.luma());
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const IGNORABLE = [/GPU stall due to ReadPixels/, /GL Driver Message/];
const errors = logs.filter((l) => /^\[(error|pageerror)\]/.test(l) && !IGNORABLE.some((r) => r.test(l)));

const f = results.floors;
const rw = results.realWalk;
const legs = results.legs;
const fb = results.fromBelow;
const fl = results.flow;
const ac = results.actors;

console.log('\n--- floors, through world.heightAt ---');
for (const [id, v] of Object.entries(f)) {
  console.log(`  ${id.padEnd(20)} authored ${String(v.authored).padStart(3)}  standing ${String(v.standing).padStart(6)}  highest ${String(v.highest).padStart(6)}  ceiling ${String(v.ceiling).padStart(6)}`);
}
console.log('\n--- centre descent, REAL FRAMES, real keydown ---');
console.log(`  start ${JSON.stringify(rw.start)}`);
console.log(`  end   ${JSON.stringify(rw.end)}  after ${rw.frames} frames, room ${rw.room}`);
console.log(`  profile (z, feet): ${rw.profile.map(([z, y]) => `${z}/${y}`).join('  ')}`);
console.log('\n--- other legs, simulated ---');
for (const [k, v] of Object.entries(legs)) console.log(`  ${k.padEnd(10)} ${JSON.stringify(v)}`);
console.log('\n--- ramp read from below ---');
console.log(`  ${JSON.stringify(fb)}`);
console.log('\n--- stone under the doorways (from world.walls) ---');
console.log(`  ${JSON.stringify(results.underDoor)}`);
console.log('\n--- flow ---');
console.log(`  from the gallery floor: ${JSON.stringify(fl.fromAbove)}`);
console.log(`  from the Act 3 floor:   ${JSON.stringify(fl.fromBelow)}`);
console.log(`  layered ${fl.layered}, layersFull ${fl.layersFull}, cells ${fl.cells}`);
console.log('\n--- actors ---');
for (const [k, v] of Object.entries(ac)) console.log(`  ${k.padEnd(14)} ${JSON.stringify(v)}`);
console.log('\n--- shots ---');
for (const [k, v] of Object.entries(results.shots)) console.log(`  ${k.padEnd(14)} ${JSON.stringify(v)}`);

const act3 = ['embalming-chamber', 'canopic-crypt', 'star-shaft', 'kings-chamber', 'serdab'];
const act2 = ['chamber-of-ascent', 'hall-of-offerings', 'granary-vault', 'great-gallery'];

const checks = {
  'act 2 floors sample at 0':
    act2.every((id) => Math.abs(f[id].standing - ACT2_FLOOR) < 0.01),
  'act 3 floors sample at -6':
    act3.every((id) => Math.abs(f[id].standing - ACT3_FLOOR) < 0.01),
  'the entry room is still the datum':
    f['chamber-of-ascent'].authored === 0,
  'every ceiling clears its own floor by its authored height':
    Object.values(f).every((v) => v.ceiling > v.standing + 4),

  'the real-frame walk started on the Act 2 floor':
    Math.abs(rw.start.feet - ACT2_FLOOR) < 0.05,
  'the real-frame walk ended on the Act 3 floor':
    Math.abs(rw.end.feet - ACT3_FLOOR) < 0.15,
  'the real-frame walk got past the doorway':
    rw.end.z < -197,
  'the real-frame walk never stalled':
    rw.longestStallSamples < 4,
  'the real-frame walk ended in the Canopic Crypt':
    rw.room === 'canopic-crypt',
  'the real-frame walk ended grounded, not falling':
    rw.grounded === true,
  'the descent is a slope and not a cliff':
    // Every sample between the doorway and the floor sits strictly between the
    // two levels. A hole reads as one sample at 0 and the next at -6.
    rw.profile.filter(([z]) => z < -197 && z > -211).every(([, y]) => y < 0.05 && y > ACT3_FLOOR - 0.2),

  'the west descent walks down': legs.westDown.reached && Math.abs(legs.westDown.feet - ACT3_FLOOR) < 0.15,
  'the east descent walks down': legs.eastDown.reached && Math.abs(legs.eastDown.feet - ACT3_FLOOR) < 0.15,
  'the centre descent walks down when simulated too':
    legs.centreDownAgain.reached && Math.abs(legs.centreDownAgain.feet - ACT3_FLOOR) < 0.15,
  'the centre descent climbs back out': legs.centreUp.reached && Math.abs(legs.centreUp.feet - ACT2_FLOOR) < 0.15,
  'the west descent climbs back out': legs.westUp.reached && Math.abs(legs.westUp.feet - ACT2_FLOOR) < 0.15,
  'the east descent climbs back out': legs.eastUp.reached && Math.abs(legs.eastUp.feet - ACT2_FLOOR) < 0.15,

  'the ramp is walkable from on it':
    [fb.west_on, fb.centre_on, fb.east_on].every((v) => v < 0 && v > -3),
  'the ramp is NOT walkable from the floor underneath it':
    [fb.west_below, fb.centre_below, fb.east_below].every((v) => Math.abs(v - ACT3_FLOOR) < 0.01),
  'the ramp is the highest surface at its own x/z':
    [fb.west_highest, fb.centre_highest, fb.east_highest].every((v) => v < 0 && v > -3),

  'the field reaches the foot of all three ramps from above':
    fl.fromAbove.westFoot > 0 && fl.fromAbove.centreFoot > 0 && fl.fromAbove.eastFoot > 0,
  'the field reaches the King\'s Chamber and the Serdab':
    fl.fromAbove.kings > 0 && fl.fromAbove.serdab > 0,
  'the field climbs back out of Act 3':
    fl.fromBelow.galleryFloor > 0 && fl.fromBelow.chamberOfAscent > 0,
  'the gallery upper ring is still reachable from the bottom':
    fl.fromBelow.galleryLedgeW > 0 && fl.fromBelow.galleryLedgeE > 0,
  'the two-storey cap is not being hit':
    fl.layersFull === 0,
  'a second storey is still being used':
    fl.layered > 0,

  'a body climbs out of the King\'s Chamber to the gallery':
    !!ac.upFromKings && ac.upFromKings.arrivedAt !== null,
  'that body used the ramp, not the stone':
    !!ac.upFromKings && ac.upFromKings.highestY > -1 && ac.upFromKings.lowestY > ACT3_FLOOR - 0.5,
  'a body walks down into the crypt':
    !!ac.downToCrypt && ac.downToCrypt.arrivedAt !== null,
  'that body descended':
    !!ac.downToCrypt && ac.downToCrypt.lowestY < ACT3_FLOOR + 0.5,

  'the stone under every descent doorway exists':
    Object.values(results.underDoor).every((v) => v && v.y0 < -5.9 && v.y1 < 0 && v.w >= 3.9),
  'that stone stops short of the sill by one ramp thickness':
    Object.values(results.underDoor).every((v) => Math.abs(v.y1 - -0.7) < 0.01),

  // The under-door inspection shot is deliberately a dark corner of a tomb and
  // is not gated: the three route shots are what a player looks at.
  'no black frames on the descent route':
    ['descent-head', 'descent-mid', 'descent-foot']
      .every((k) => results.shots[k].mean > 6 && results.shots[k].lit > 25),
  'no console errors':
    errors.length === 0,
};

console.log('\n--- checks ---');
let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
if (errors.length) console.log(`\nconsole:\n${errors.join('\n')}`);
console.log(`\n${failed ? `${failed} CHECK(S) FAILED` : 'DESCENT: all checks pass'}`);

await browser.close();
process.exit(failed ? 1 : 0);
