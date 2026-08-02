/**
 * CAN YOU TRAIN IN THIS MAP?
 *
 * Herding is the core survival mechanic of this genre. You pull the horde into a
 * line behind you, run a circuit, and turn and cut them down when the line is
 * long and you have room. A space you cannot run a circuit in is a space you die
 * in, and no amount of ammo or damage fixes it. So:
 *
 *   Every room with spawn points must be in a cycle, or be able to become one
 *   for a price.
 *
 * That is the whole law and it admits no exemption. A dead end you can buy your
 * way out of is a difficulty choice; a dead end with no exit at any price is a
 * bug.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ASKS THE GRAPH RATHER THAN COUNTING DOORS
 * ---------------------------------------------------------------------------
 *
 * The first version of this file scored a room by its DEGREE: one portal was a
 * DEAD END, two was a through-route, more was a hub. That is the reading a level
 * designer does by eye, and it is wrong in exactly the way eyes are wrong about
 * topology. The Star Shaft has two portals and scored 'through-route', but its
 * second portal goes to the Serdab, which has no third door - so everything that
 * follows you into the shaft has to come back out the way it went in. Degree two
 * into a dead end IS a dead end, and no amount of staring at the room finds it.
 *
 * CYCLE MEMBERSHIP is the property the mechanic actually needs, so cycle
 * membership is what gets asserted. It costs a graph walk and it cannot be
 * fooled by a corridor.
 *
 * The map is data with no THREE import, which is what lets any of this be
 * checked without a GPU - the same property the module graph test relies on.
 */

import { ROOMS, allPortals, neighbors } from '../src/world/rooms.js';

const ids = ROOMS.map((r) => r.id);

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };
const pass = (msg) => { console.log(`  ok    ${msg}`); };

// ---------------------------------------------------------------------------
// every simple cycle in the undirected room graph
// ---------------------------------------------------------------------------

const adj = new Map(ids.map((id) => [id, neighbors(id)]));
const cycles = [];
const seen = new Set();

function walk(start, node, path) {
  for (const next of adj.get(node)) {
    if (next === start && path.length >= 3) {
      const key = [...path].sort().join('|');
      if (!seen.has(key)) { seen.add(key); cycles.push([...path]); }
    } else if (!path.includes(next) && next > start) {
      walk(start, next, [...path, next]);
    }
  }
}
for (const id of ids) walk(id, id, [id]);

/** Rooms that lie on at least one cycle. The only rooms you can train in. */
const onACycle = new Set(cycles.flat());

/**
 * SPAWN COUNT, and why this is not `(r.spawnPoints || []).length`.
 *
 * The law below exempts rooms with no spawn points, correctly: a room the horde
 * never appears in is not a room you can be cornered in. But `|| []` cannot tell
 * "this room deliberately spawns nothing" from "the field this tool reads is not
 * there any more", and it supplies exactly the value that triggers the exemption.
 *
 * So a rename of `spawnPoints` in rooms.js, or moving it behind a getter, would
 * exempt EVERY room at once while the act-train and gallery-ring sections still
 * passed from portal data, and this tool would print "the law holds" over a map
 * where the Serdab is a spawning dead end. A law that switches itself off when it
 * loses sight of its subject is not a law.
 *
 * An absent field is a defect in this tool, not a property of the room, so it is
 * reported as one and it is fatal. An empty array is a real answer and stays
 * exempt.
 */
function spawnCount(r) {
  if (!Array.isArray(r.spawnPoints)) {
    fail(
      `${r.id} has no spawnPoints ARRAY (${typeof r.spawnPoints}). ` +
      'This tool reads rooms.js directly; the field has moved or been renamed, ' +
      'and every room would otherwise be silently exempt.'
    );
    return null;
  }
  return r.spawnPoints.length;
}

// ---------------------------------------------------------------------------
// the report
// ---------------------------------------------------------------------------

console.log('ROOM                  portals  spawns  area     h   verdict');
for (const r of ROOMS) {
  const n = neighbors(r.id);
  const spawns = spawnCount(r);
  const area = r.bounds.w * r.bounds.d;

  const verdict = spawns === null
    ? 'SPAWN FIELD MISSING'
    : onACycle.has(r.id)
      ? (n.length > 2 ? 'hub, on a loop' : 'on a loop')
      : spawns === 0 ? 'no spawns, exempt' : 'NO LOOP';

  console.log(
    `${r.id.padEnd(20)}  ${String(n.length).padStart(4)}  ${String(spawns).padStart(6)}  ` +
    `${String(area).padStart(6)}  ${String(r.height).padStart(3)}   ${verdict}`
  );
}

console.log('\nCYCLES (a loop you can actually train on):');
if (!cycles.length) console.log('  NONE');
for (const c of cycles) {
  // What does it cost to unlock every door in this loop?
  let cost = 0;
  const doors = [];
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    const p = allPortals().find(
      (p) => (p.from === a && p.to === b) || (p.from === b && p.to === a)
    );
    cost += p.cost;
    doors.push(`${p.kind}${p.cost ? ' ' + p.cost : ''}`);
  }
  console.log(`  ${c.join(' -> ')} -> ${c[0]}`);
  console.log(`    doors: ${doors.join(', ')}   TOTAL TO UNLOCK: ${cost}g`);
}

// ---------------------------------------------------------------------------
// THE LAW
// ---------------------------------------------------------------------------

console.log('\nTHE LAW: every room with spawn points is in a cycle');
for (const r of ROOMS) {
  // spawnCount has already reported an absent field as a failure in the report
  // above; skipping here would double-count it, and the room cannot be judged.
  const spawns = Array.isArray(r.spawnPoints) ? r.spawnPoints.length : null;
  if (spawns === null || !spawns) continue;
  if (onACycle.has(r.id)) pass(`${r.id} (${spawns} spawns) is on a loop`);
  else fail(`${r.id} spawns ${spawns} enemies and is on NO loop at any price`);
}

// ---------------------------------------------------------------------------
// each act has its own train
// ---------------------------------------------------------------------------
//
// The act breaks already existed in the economy and were never named: the sealed
// doorway is the 1 -> 2 break and the gallery's three gates are the 2 -> 3
// break. An act has to be survivable on its own terms, so a loop that leaves the
// act does not count - it is only reachable once the next door is paid for.
//
// AN ACT'S HUB COUNTS AS INSIDE IT. Act 3's five rooms all hang off the Great
// Gallery and nothing in the design proposes they should not; the ratified loop
// is written `gallery -> embalming -> kings -> crypt -> gallery` in MAP.md
// itself. A player standing in Act 3 has already paid for the gallery and is
// never sent back through a door to reach it, so a loop through the hub is a
// loop they can actually run. Scoring it as leaving the act was this check
// over-specifying its own rule, and it failed a map the design says is correct.

const ACTS = {
  2: { rooms: ['chamber-of-ascent', 'hall-of-offerings', 'granary-vault'], hub: 'great-gallery' },
  3: { rooms: ['embalming-chamber', 'canopic-crypt', 'star-shaft', 'kings-chamber', 'serdab'], hub: 'great-gallery' },
};

console.log('\nEACH ACT HAS ITS OWN TRAIN');
for (const [act, { rooms, hub }] of Object.entries(ACTS)) {
  const set = new Set([...rooms, hub]);
  // A loop that lies entirely in the hub's own act does not count as this act's
  // train, so it has to touch at least one room the act actually owns.
  const own = cycles.filter((c) => c.every((id) => set.has(id)) && c.some((id) => rooms.includes(id)));
  if (own.length) pass(`act ${act}: ${own.length} loop(s), e.g. ${own[0].join(' -> ')}`);
  else fail(`act ${act} has no loop of its own`);
}

// ---------------------------------------------------------------------------
// the gallery's upper level: a ring, or shelves?
// ---------------------------------------------------------------------------
//
// The two shelves used to span the same z on opposite walls and never meet, so
// going up meant the only way down was back past whatever had followed you. This
// is the same question as above asked of walkable surfaces instead of rooms, and
// it is asked the same way: build the adjacency and walk it. Two spans are
// adjacent when their footprints touch or overlap in BOTH axes - touching
// counts, because the builder butts slabs edge to edge on purpose and `heightAt`
// reads inclusive bounds, so a shared edge is walkable.

const g = ROOMS.find((r) => r.id === 'great-gallery');
console.log('\nGREAT GALLERY UPPER LEVEL');

const spans = g.ramps.map((r, i) => ({
  i,
  x: [r.x - r.w / 2, r.x + r.w / 2],
  z: [r.z - r.d / 2, r.z + r.d / 2],
  flat: r.y0 === r.y1,
  y: [r.y0, r.y1],
}));

for (const s of spans) {
  console.log(
    `  x ${String(s.x[0]).padStart(6)}..${String(s.x[1]).padEnd(6)}  ` +
    `z ${String(s.z[0]).padStart(7)}..${String(s.z[1]).padEnd(7)}  ` +
    `y ${s.y[0]}->${s.y[1]}  ${s.flat ? 'LEDGE' : 'ramp'}`
  );
}

const EPS = 1e-6;
const touches = (a, b) => a[0] <= b[1] + EPS && b[0] <= a[1] + EPS;
const adjacent = (a, b) => touches(a.x, b.x) && touches(a.z, b.z);

// One connected component over the spans, seeded anywhere.
const reached = new Set([0]);
for (let changed = true; changed;) {
  changed = false;
  for (const a of spans) {
    if (!reached.has(a.i)) continue;
    for (const b of spans) {
      if (reached.has(b.i) || !adjacent(a, b)) continue;
      reached.add(b.i);
      changed = true;
    }
  }
}

const oneSurface = reached.size === spans.length;
const rampsUp = spans.filter((s) => !s.flat && reached.has(s.i)).length;

console.log(
  `  ${oneSurface ? 'ONE CONNECTED SURFACE' : 'SPLIT INTO PIECES'}` +
  `, reachable by ${rampsUp} ramp(s) from the floor`
);

if (!oneSurface) fail('the gallery upper level is not one connected surface');
else if (rampsUp < 2) fail('the gallery upper level has only one way up and down');
else pass('the gallery upper level is a ring: up one ramp, across, down the other');

// ---------------------------------------------------------------------------

console.log(`\n${failures ? `TRAINABILITY: ${failures} VIOLATION(S)` : 'TRAINABILITY: the law holds'}`);
process.exit(failures ? 1 : 0);
