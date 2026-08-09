/**
 * CAN YOU ACTUALLY RUN IN ACT 2? Played, not measured off the room records.
 *
 * The owner said twice that the first interior room is too small: "its harad to
 * run from enemies in sucha small space espeacially in later waves. this needs
 * more balance." Two things changed in answer to that - the Chamber of Ascent
 * went from 24 x 18 to 36 x 18, and its west doorway became a genuine opening at
 * cost 0 - and neither of them is verified by the geometry being different.
 * `tools/trainability.mjs` scored that room "on a loop" before the change and
 * scores it "on a loop" after it, because cycle membership is a property of the
 * graph and the complaint was about floor.
 *
 * So this file plays it. Every leg below is driven by REAL keydown events
 * through the real main loop on REAL requestAnimationFrame frames. Nothing calls
 * player.update() directly: this project has twelve confirmed instances of
 * things written that never rendered and a documented history of harnesses
 * reporting success from a canvas that drew nothing, and a movement test driven
 * by a tight update() loop has produced twelve false failures here before.
 *
 * WHAT IT MEASURES, and none of it is "the room is bigger":
 *
 *   - Can the player leave the entry room with no gold and no key press.
 *   - Under a late wave, can they run the whole open route and back without
 *     being corked. A CORKED FRAME is one where the forward key is held, the
 *     player is grounded, and they made less than 2 cm of ground: that is the
 *     signature of standing in a lane a body does not fit down, and it is what
 *     "hard to run from enemies in such a small space" feels like from inside.
 *   - How close the horde got, and whether the run ended with the player alive.
 *
 * It runs the route TWICE: once for free, which is what wave one now buys, and
 * once with the granary door bought, which is the loop closing. The difference
 * between those two is the asymmetry the 750 is there to preserve.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolveChrome, dismissBriefing } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

// 640 x 400 and LOW fidelity, not 1280 x 760. Every leg below is REAL frames through the real
// main loop, and under swiftshader the frame cost is dominated by fragments: at
// the shooter's viewport a three-thousand-frame run takes the better part of an
// hour, which is a test nobody waits for. Nothing here reads a pixel.
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
// BEGIN raises the briefing card now; the world is held behind it. See chrome.mjs.
await dismissBriefing(page);
await page.waitForTimeout(1400);
// Low fidelity: shadows and normal maps off. This file reads no pixels, and the
// frame cost is what decides whether it is a test anybody runs.
await page.evaluate(() => { const b = document.getElementById('fid-low'); if (b) b.click(); });
await page.waitForTimeout(600);

await page.addScriptTag({
  content: `
window.__K__ = {
  key(code, down) {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  },

  pos() {
    const p = window.__SANDS__.player.position;
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), feet: +(p.y - 1.68).toFixed(2) };
  },

  /**
   * Run toward a heading for at most maxFrames real frames, stopping when the
   * player reaches the room named in 'until' or crosses the given line.
   *
   * Returns the leg's own report. 'corked' is the count of frames where the key
   * was held, the player was grounded, and they covered under 2 cm - which is
   * what a lane too narrow to run down does to a body, and is invisible in any
   * measurement of the room's dimensions.
   */
  async leg(yaw, maxFrames, until, empty) {
    const g = window.__SANDS__;
    g.rig.reset(yaw, -0.02);
    window.__K__.key('KeyW', true);
    window.__K__.key('ShiftLeft', true);

    const start = window.__K__.pos();
    let prev = { x: g.player.position.x, z: g.player.position.z };
    let corked = 0, moved = 0, frames = 0, nearest = Infinity;
    let reached = false;

    for (; frames < maxFrames; frames++) {
      // An EMPTY leg is emptied every frame, not once at the start. reset()
      // clears the live actors and does not stop the wave: measured, a leg run
      // after a single reset still had five shamblers on the player by frame
      // forty and reported 94 per cent corked, which is a true reading of being
      // mobbed and says nothing about the doorway it was pointed at.
      if (empty) g.director.reset();
      await new Promise((r) => requestAnimationFrame(r));
      const d = Math.hypot(g.player.position.x - prev.x, g.player.position.z - prev.z);
      moved += d;
      if (d < 0.02 && g.player.state.grounded) corked++;
      prev = { x: g.player.position.x, z: g.player.position.z };

      for (const a of g.director.live) {
        if (!a.live) continue;
        const dd = Math.hypot(a.position.x - g.player.position.x, a.position.z - g.player.position.z);
        if (dd < nearest) nearest = dd;
      }

      if (until.room && g.spaces.roomId === until.room) { reached = true; break; }
      if (until.x !== undefined && (until.dir > 0 ? g.player.position.x >= until.x : g.player.position.x <= until.x)) { reached = true; break; }
      if (until.z !== undefined && (until.dir > 0 ? g.player.position.z >= until.z : g.player.position.z <= until.z)) { reached = true; break; }
    }

    window.__K__.key('KeyW', false);
    window.__K__.key('ShiftLeft', false);
    await new Promise((r) => requestAnimationFrame(r));

    return {
      start, end: window.__K__.pos(), room: g.spaces.roomId,
      frames, reached,
      metres: +moved.toFixed(1),
      corked,
      corkedPct: +((corked / Math.max(1, frames)) * 100).toFixed(0),
      nearestEnemy: nearest === Infinity ? null : +nearest.toFixed(1),
      live: g.director.live.length,
      health: Math.round(g.combat.health),
      gold: g.economy.gold,
    };
  },
};
`,
});

/**
 * INVULNERABLE FOR THE WHOLE FILE, and this is the same call test/descent.mjs
 * makes for the same reason: the question here is whether the player can RUN,
 * not whether they can survive a wave-twelve horde without firing a shot. The
 * harness never pulls the trigger.
 *
 * It is not a convenience. Measured without it, the player died four legs in and
 * every leg after that reported 0 m covered and 100 per cent corked - which is
 * what a corpse does, and which would have been read as eight rooms that cannot
 * be run in, including the Great Gallery, the room this file uses as its
 * control precisely because nobody has ever complained about it.
 */
await page.evaluate(() => { window.__SANDS__.combat.state.invulnerable = true; });

const results = { free: {}, bought: {} };

/** Print a leg the moment it lands. A run this long must not report only at the end. */
const say = (name, v) => { console.log(`  ${name.padEnd(22)} ${JSON.stringify(v)}`); return v; };

/**
 * EVERY LEG STARTS FROM AN EXPLICIT POINT FACING AN EXPLICIT DOORWAY, and that
 * is not tidiness. A leg that begins wherever the previous one happened to stop
 * fails for the previous leg's reasons, and this harness can only drive a
 * straight line: a run that ends four metres off a doorway's centreline walks
 * into stone and reports a route that works as broken.
 *
 * `keepHorde` is the switch between the file's two halves. False empties the
 * room first, so a corked frame can only mean geometry; true leaves the wave
 * standing, which is the kiting measurement and is a different question.
 */
const legFrom = (label, at, yaw, maxFrames, until, keepHorde = false) => page.evaluate(
  async ([a, y, mf, u, keep]) => {
    const g = window.__SANDS__;
    if (!keep) g.director.reset();
    g.player.teleport({ x: a[0], y: 0, z: a[1] });
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    return window.__K__.leg(y, mf, u, !keep);
  }, [at, yaw, maxFrames, until, keepHorde]).then((v) => say(label, v));


// ---------------------------------------------------------------------------
// 1. leave the entry room with nothing in your pocket and no key press
// ---------------------------------------------------------------------------

results.arrival = await page.evaluate(async () => {
  const g = window.__SANDS__;
  // The real arrival: where the sealed doorway puts the player down.
  g.spaces.enter('interior', { x: 0, z: -143.5, rot: 0 });
  g.economy.set ? g.economy.set(0) : null;
  for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
  return {
    room: g.spaces.roomId,
    gold: g.economy.gold,
    pos: window.__K__.pos(),
    barriersInEntryRoom: g.spaces.interior.barriers
      .filter((b) => b.from === 'chamber-of-ascent' || b.to === 'chamber-of-ascent')
      .map((b) => `${b.id}:${b.kind}:${b.cost}`),
  };
});

/**
 * THE ROUTE LEGS RUN WITH THE HORDE CLEARED, AND THAT IS THE POINT OF SPLITTING
 * THIS FILE IN TWO.
 *
 * The first cut of this ran the route with wave one live and reported the free
 * doorway as a failure: 4.8 m of ground in 240 frames, 95 per cent of them
 * corked, with six shamblers on the player and the nearest 1.6 m away. That is a
 * true measurement of being mobbed and it says nothing whatever about whether
 * the doorway is open, which is what this half is for. A leg that cannot tell a
 * blocked doorway from a body standing in it is not an instrument.
 *
 * So: the ROUTE is measured on empty rooms, where a corked frame can only mean
 * geometry. The KITING is measured separately below, under wave twelve, against
 * the Great Gallery as a control - the room nobody has ever complained about.
 */
await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.director.reset();
  g.player.teleport({ x: 0, y: 0, z: -149 });
  for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
});

results.free.out = await legFrom(
  'out of the entry room', [0, -149], Math.PI / 2, 200, { room: 'hall-of-offerings' });

await page.screenshot({ path: `${OUT}kite-01-through-the-free-doorway.png` });

// ---------------------------------------------------------------------------
// 2. the rest of the free route, still on empty rooms
// ---------------------------------------------------------------------------

// hall -> gallery -> hall -> chamber, on the free route.
results.free.toGallery = await legFrom(
  'hall to gallery', [-22, -152], 0, 160, { room: 'great-gallery' });

await page.screenshot({ path: `${OUT}kite-02-gallery-under-a-late-wave.png` });

// Back north through the same opening. x -22 is that portal's centreline.
results.free.backToHall = await legFrom(
  'gallery to hall', [-22, -165], Math.PI, 160, { room: 'hall-of-offerings' });

// And east down the hall, out through the free doorway at x -18, z -149.
results.free.backToChamber = await legFrom(
  'hall to chamber', [-30, -149], -Math.PI / 2, 200, { room: 'chamber-of-ascent' });

// ---------------------------------------------------------------------------
// 2b. THE KITING MEASUREMENT, under wave twelve, against a control
// ---------------------------------------------------------------------------
//
// A lap of the entry room, run round the outside of its pillar ring, with a late
// wave live. The number on its own means nothing - there is no before-number,
// because the old 24 x 18 room no longer exists to measure - so the SAME lap is
// run in the Great Gallery, which is 1,800 m2, is the room every route in the
// map passes through, and is the room nobody has ever complained about. The
// gallery is the bar. If the entry room reads in the same band, it is kiteable
// by the standard the map already sets.

results.wave = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.director.forceWave(12);
  for (let i = 0; i < 40; i++) await new Promise((r) => requestAnimationFrame(r));
  return { wave: g.director.state.wave, live: g.director.live.length, phase: g.director.state.phase };
});

results.free.lapChamber = {};
// YAW 0 IS -Z AND YAW PI IS +Z. The east and west edges were the wrong way
// round in the first cut of this table and both walked into a wall: the east leg
// asked to reach z -155 while heading toward -140. It reported 93 per cent
// corked in the Great Gallery, the room that is supposed to be the control.
for (const [name, at, yaw, until] of [
  ['chamber lap N', [-15, -143.5], -Math.PI / 2, { x: 15, dir: 1 }],
  ['chamber lap E', [15, -143.5], 0, { z: -155, dir: -1 }],
  ['chamber lap S', [15, -155], Math.PI / 2, { x: -15, dir: -1 }],
  ['chamber lap W', [-15, -155], Math.PI, { z: -143.5, dir: 1 }],
]) {
  results.free.lapChamber[name] = await legFrom(name, at, yaw, 110, until, true);
}

// The control. Same shape of lap, same wave, in the room that is the bar.
results.free.lapGallery = {};
for (const [name, at, yaw, until] of [
  ['gallery lap N', [-14, -162], -Math.PI / 2, { x: 14, dir: 1 }],
  ['gallery lap E', [14, -162], 0, { z: -190, dir: -1 }],
  ['gallery lap S', [14, -190], Math.PI / 2, { x: -14, dir: -1 }],
  ['gallery lap W', [-14, -190], Math.PI, { z: -162, dir: 1 }],
]) {
  results.free.lapGallery[name] = await legFrom(name, at, yaw, 110, until, true);
}

await page.screenshot({ path: `${OUT}kite-03-entry-room-lap.png` });

// ---------------------------------------------------------------------------
// 3. buy the granary, and run the loop that 750 closes
// ---------------------------------------------------------------------------

results.bought.purchase = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.economy.grant(750, 'harness');
  const bar = g.spaces.interior.barriers.find((b) => b.id === 'chamber-of-ascent/granary-vault');
  const before = g.economy.gold;
  bar.open();
  let f = 0;
  while (!bar.opened && f < 240) { await new Promise((r) => requestAnimationFrame(r)); f++; }
  return { opened: bar.opened, frames: f, goldBefore: before };
});

/**
 * THE LOOP THE 750 CLOSES, run in the direction the purchase opens.
 *
 * chamber -> granary -> gallery -> hall -> chamber. Each leg starts on the
 * centreline of the doorway it is about to use: the granary door at x 18, the
 * granary's gallery portal at x 22, the hall's gallery portal at x -22, and the
 * free west doorway at x -18. Those four coordinates are the loop.
 */
results.bought.lap = {};
for (const [name, at, yaw, maxF, until] of [
  ['chamber to granary', [10, -149], -Math.PI / 2, 200, { room: 'granary-vault' }],
  ['granary to gallery', [22, -153], 0, 200, { room: 'great-gallery' }],
  ['gallery to hall', [-22, -165], Math.PI, 200, { room: 'hall-of-offerings' }],
  ['hall to chamber', [-30, -149], -Math.PI / 2, 200, { room: 'chamber-of-ascent' }],
]) {
  results.bought.lap[name] = await legFrom(name, at, yaw, maxF, until);
}

await page.screenshot({ path: `${OUT}kite-04-act2-loop-closed.png` });

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const IGNORABLE = [/GPU stall due to ReadPixels/, /GL Driver Message/];
const errors = logs.filter((l) => /^\[(error|pageerror)\]/.test(l) && !IGNORABLE.some((r) => r.test(l)));

const row = (name, v) => console.log(
  `  ${name.padEnd(22)} ${String(v.room).padEnd(18)} ${v.reached ? 'reached' : 'DID NOT REACH'}` +
  `  ${String(v.metres).padStart(6)} m in ${String(v.frames).padStart(4)} f` +
  `  corked ${String(v.corked).padStart(3)} (${String(v.corkedPct).padStart(2)}%)` +
  `  nearest ${String(v.nearestEnemy).padStart(5)}  live ${String(v.live).padStart(2)}  hp ${String(v.health).padStart(3)}`
);

console.log('\n--- arrival ---');
console.log(`  ${JSON.stringify(results.arrival)}`);

console.log('\n--- the free route, empty rooms, so a corked frame means geometry ---');
row('out of the entry room', results.free.out);
row('hall to gallery', results.free.toGallery);
row('gallery to hall', results.free.backToHall);
row('hall to chamber', results.free.backToChamber);

console.log(`\n--- kiting, wave forced: ${JSON.stringify(results.wave)} ---`);
console.log('  the entry room:');
for (const [k, v] of Object.entries(results.free.lapChamber)) row(k, v);
console.log('  the Great Gallery, the control:');
for (const [k, v] of Object.entries(results.free.lapGallery)) row(k, v);

const mean = (o, f) => +(Object.values(o).reduce((s, v) => s + f(v), 0) / Object.values(o).length).toFixed(1);
const chamberCork = mean(results.free.lapChamber, (v) => v.corkedPct);
const galleryCork = mean(results.free.lapGallery, (v) => v.corkedPct);
const chamberM = mean(results.free.lapChamber, (v) => v.metres);
const galleryM = mean(results.free.lapGallery, (v) => v.metres);
console.log(`\n  entry room: ${chamberM} m per leg, ${chamberCork}% corked`);
console.log(`  gallery:    ${galleryM} m per leg, ${galleryCork}% corked`);

console.log(`\n--- the granary bought: ${JSON.stringify(results.bought.purchase)} ---`);
for (const [k, v] of Object.entries(results.bought.lap)) row(k, v);

const routeLegs = [
  results.free.out, results.free.toGallery, results.free.backToHall, results.free.backToChamber,
  ...Object.values(results.bought.lap),
];

const checks = {
  'the entry room has ONE barrier, and it is the granary':
    results.arrival.barriersInEntryRoom.length === 1
    && results.arrival.barriersInEntryRoom[0] === 'chamber-of-ascent/granary-vault:debris:750',
  'walked out of the entry room with no gold':
    results.free.out.reached && results.free.out.room === 'hall-of-offerings'
    && results.free.out.gold === results.arrival.gold,
  'reached the gallery on the free route':
    results.free.toGallery.reached,
  'and came all the way back to the entry room':
    results.free.backToHall.reached && results.free.backToChamber.reached,
  // On empty rooms a corked frame can only be geometry, so this is strict.
  'no route leg was corked on empty rooms':
    routeLegs.every((l) => l.corkedPct <= 10),
  'a late wave is actually live':
    results.wave.live > 0,
  // The bar is the Great Gallery, not a number picked out of the air. The entry
  // room is allowed to be a little worse than 1,800 m2 of open floor; it is not
  // allowed to be a different kind of room.
  'the entry room kites within a fifth of the gallery':
    chamberCork <= galleryCork + 20,
  'and covers comparable ground per leg':
    chamberM >= galleryM * 0.5,
  'the loop closes for 750':
    Object.values(results.bought.lap).every((l) => l.reached),
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
console.log(`\nshots -> ${OUT}`);
console.log(`\n${failed ? `${failed} CHECK(S) FAILED` : 'KITE: all checks pass'}`);

await browser.close();
process.exit(failed ? 1 : 0);
