/**
 * Can you train in this map? A loop is the core survival mechanic, so ask the
 * room graph directly instead of reading the layout by eye.
 */
import { ROOMS, allPortals, neighbors } from '../src/world/rooms.js';

const ids = ROOMS.map((r) => r.id);

// --- degree: a room with one portal is a place you get cornered in ---
console.log('ROOM                  portals  area     h   verdict');
for (const r of ROOMS) {
  const n = neighbors(r.id);
  const area = r.bounds.w * r.bounds.d;
  const verdict = n.length <= 1 ? 'DEAD END' : n.length === 2 ? 'through-route' : 'hub';
  console.log(
    `${r.id.padEnd(20)}  ${String(n.length).padStart(4)}  ${String(area).padStart(6)}  ${String(r.height).padStart(3)}   ${verdict}`
  );
}

// --- cycles: enumerate every simple cycle in the undirected graph ---
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

// --- the upper level of the gallery: ring or two shelves? ---
const g = ROOMS.find((r) => r.id === 'great-gallery');
console.log('\nGREAT GALLERY UPPER LEVEL');
const spans = g.ramps.map((r) => ({
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
// Do the two ledges touch anywhere?
const ledges = spans.filter((s) => s.flat);
const overlap = (a, b) => a[0] < b[1] && b[0] < a[1];
const joined = ledges.length === 2 && overlap(ledges[0].x, ledges[1].x) && overlap(ledges[0].z, ledges[1].z);
console.log(`  the two ledges ${joined ? 'CONNECT - upper level is a ring' : 'DO NOT CONNECT - upper level is two dead-end shelves'}`);
