/**
 * THE WALK CYCLE, PHOTOGRAPHED AND MEASURED.
 *
 * The owner's note was "the wobble from the mummies is not what we want. can we
 * make it so they react differently and more realistically". That is a judgement
 * about motion, and no assertion already in the suite can settle it: enemies.mjs
 * will happily pass a mummy that seeks, staggers and dies while swaying like a
 * metronome, because swaying is not a defect by any test written there.
 *
 * So this does two things the other suites do not.
 *
 *   1. A STRIP. Frames across one gait cycle at the distance a player actually
 *      fights from, written to shots/, so the motion can be judged by looking
 *      rather than by reading a report about looking.
 *
 *   2. THE ASYMMETRY, AS A NUMBER. The change under test replaces a symmetric
 *      sine with a lead leg and a drag leg - DRAG_SWING = 0.64 in
 *      enemies/mummy.js. If that landed, the two hips do NOT trace the same
 *      curve half a period apart: the drag side swings visibly shallower. A
 *      symmetric gait shows the two amplitudes within a few per cent of each
 *      other, and that IS the wobble being complained about, so it is the thing
 *      worth being able to fail on.
 *
 * Deliberately NOT in npm test: it writes images for a human to look at, and its
 * numeric gate is a floor on a ratio rather than a correctness claim. It is a
 * measuring instrument, not a gate.
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: resolveChrome(), args: ['--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'load' });
await page.click('#begin');
await page.waitForFunction(() => window.__SANDS__ && window.__SANDS__.director, null, { timeout: 60000 });

/**
 * One shambler, walking, in front of a fixed camera.
 *
 * placeAt is the director's own harness door - it still respects the pool and
 * the live cap, so the actor is a real actor driven by the real update, which is
 * the only way the gait code under test is the code that runs in a fight.
 */
const staged = await page.evaluate(() => {
  const g = window.__SANDS__;
  g.director.reset();

  g.player.teleport({ x: 0, y: 0, z: 0 });
  // Yaw 0 faces -Z (forward is -sin yaw, 0, -cos yaw), which is where the actor
  // is put below. Yaw PI faces +Z and photographs an empty avenue with the
  // subject behind the camera - which is exactly what the first run of this file
  // did, and the images looked perfectly fine.
  g.rig.reset(0, 0.02);
  g.rig.update(1 / 60, g.player, false);

  // Far enough out that the whole body is in frame with the legs legible. At 7m
  // the actor closes to touching within the trace and the strip photographs an
  // attack animation instead of a walk - which is what the first version did.
  const actor = g.director.placeAt('shambler', 0, -22);
  return {
    placed: !!actor,
    live: g.director.live.length,
    kind: actor && actor.spec ? actor.spec.id : null,
  };
});

if (!staged.placed) { console.log('FAIL: could not place an actor'); await browser.close(); process.exit(1); }

/**
 * IS THE SUBJECT ACTUALLY IN SHOT?
 *
 * Project it to screen space before photographing anything. The first run of
 * this file faced the camera the wrong way down the avenue and wrote eight
 * perfectly clean frames of empty sand; nothing in the output said so, because
 * a strip of the wrong thing looks exactly like a strip of the right thing until
 * someone opens it. Cheaper to assert it than to trust it.
 */
const inShot = await page.evaluate(() => {
  const g = window.__SANDS__;
  const a = g.director.live[0];
  const p = (a.group || a.rig.group).position.clone();
  p.y += 1.0;
  p.project(g.camera);
  return { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
           onScreen: Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1 };
});
console.log('--- subject in frame ---');
console.log(JSON.stringify(inShot));
if (!inShot.onScreen) {
  console.log('FAIL: the subject is not on screen - the strip would photograph nothing');
  await browser.close();
  process.exit(1);
}

/**
 * Sample both hips across a cycle, then photograph the same span.
 *
 * The rig is read straight off the live actor rather than recomputed here: the
 * question is what the animation DID, and a reimplementation of the maths would
 * only ever agree with itself.
 */
const SAMPLES = 96;
const DT = 1 / 20;                     // the frame loop's own delta clamp

/**
 * THE STRIP FIRST, WHILE THE SUBJECT IS STILL AT WALKING DISTANCE.
 *
 * The actor seeks the player, so every second of simulation spends part of the
 * distance the shot needs. Photograph the approach and then measure, rather than
 * measuring and then photographing whatever is left - which is an attack pose at
 * arm's length with the legs out of frame.
 */
for (let i = 0; i < 8; i++) {
  await page.evaluate(async ({ dt, k }) => {
    const g = window.__SANDS__;
    for (let j = 0; j < k; j++) g.director.update(dt, g.player, 0);
    await new Promise((r) => requestAnimationFrame(r));
  }, { dt: DT, k: 4 });
  await page.screenshot({ path: `${OUT}gait-${String(i).padStart(2, '0')}.png` });
}

const afterStrip = await page.evaluate(() => {
  const g = window.__SANDS__;
  const a = g.director.live[0];
  const p = (a.group || a.rig.group).position;
  return { z: +p.z.toFixed(2), distance: +Math.hypot(p.x, p.z).toFixed(2) };
});
console.log('--- after the strip ---');
console.log(JSON.stringify(afterStrip));

const trace = await page.evaluate(async ({ n, dt }) => {
  const g = window.__SANDS__;
  const a = g.director.live[0];
  const rows = [];

  // The rig exposes `legs` as an array of {hip, knee, side} - see the return at
  // enemies/mummy.js:1086. Reading it by name off the scene graph finds nothing,
  // because these are plain Groups the builder never named.
  const rig = a.rig || a;
  for (let i = 0; i < n; i++) {
    g.director.update(dt, g.player, 0);
    const legs = (rig.legs || []).map((L, k) => ({
      name: `${L.side ?? k}`,
      x: +L.hip.rotation.x.toFixed(4),
      knee: +L.knee.rotation.x.toFixed(4),
    }));
    rows.push(legs);
  }
  return rows;
}, { n: SAMPLES, dt: DT });

// Fold the trace into per-hip amplitude.
const names = trace[0] ? trace[0].map((l) => l.name) : [];
const amps = names.map((nm, idx) => {
  const series = trace.map((row) => (row[idx] ? row[idx].x : 0));
  return { name: nm, min: Math.min(...series), max: Math.max(...series), amp: +(Math.max(...series) - Math.min(...series)).toFixed(4) };
});

console.log('--- staging ---');
console.log(JSON.stringify(staged, null, 2));
console.log('--- hip amplitude over one cycle ---');
console.log(JSON.stringify(amps, null, 2));

let ratio = null;
if (amps.length >= 2) {
  const sorted = [...amps].sort((p, q) => q.amp - p.amp);
  ratio = sorted[1].amp > 0 ? +(sorted[1].amp / sorted[0].amp).toFixed(3) : 0;
  console.log(`\nlead ${sorted[0].amp}  drag ${sorted[1].amp}  ratio ${ratio}`);
  console.log(ratio < 0.92
    ? 'ASYMMETRIC - the legs do not swing alike, which is the limp'
    : 'SYMMETRIC - both legs swing the same, which is the wobble');
}

console.log(`\nstrip -> ${OUT}gait-00..07.png`);
console.log(`console errors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));

await browser.close();
