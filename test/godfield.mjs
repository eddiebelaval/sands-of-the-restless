/**
 * WOULD A SECOND FLOOD CARVED AT GOD WIDTH HAVE ANYWHERE TO GO.
 *
 * `docs/RESUME-HERE.md` names the next change as a second flow field carved at
 * god dimensions, on the reasoning that `flow.js` marks a cell walkable if a
 * 0.55 x 2.0 shambler fits and a god is 1.805 x 3.89. That reasoning is sound
 * and it is not sufficient, because it says nothing about whether the field that
 * results has any route in it at all.
 *
 * The arithmetic that made this file necessary. Portals are authored 4.0 wide in
 * `world/rooms.js`. A flood carving with a disc of radius p leaves 4.0 - 2p of
 * legal centre band, so the shambler's 0.55 leaves 2.9 m and the god's 1.805
 * leaves 0.39 m. `flow.js` picked STEP = 0.7 with the explicit argument that
 * 2.9 m is "four cells across the gap, which is enough that no doorway can be
 * closed by sampling luck". At 0.39 m it is HALF A CELL, and whether a doorway
 * exists at all comes down to where the grid origin happens to fall.
 *
 * A field that seals every door is strictly worse than the one we have: gods
 * would get no route rather than a bad one, fall through to the straight line in
 * mummy.js, and walk into stone with more confidence than before.
 *
 * So this measures, before anything is built:
 *
 *   1. WHOLE MAP. Of the cells the base carve calls walkable, how many survive a
 *      god-width carve, and does the survivor set still connect anything.
 *   2. EVERY COMBAT DOORWAY. A transect ACROSS the opening, perpendicular to the
 *      through-axis, reporting the god-legal band in metres and - the number the
 *      design turns on - HOW MANY OF FLOW'S OWN CELL CENTRES LAND INSIDE IT.
 *
 * MEASURED WITH `flow.clearFor`, which is the flood's own `clear()` with the
 * body size parameterised, so both sides of every comparison run the identical
 * predicate. The base numbers are re-measured through the same call rather than
 * assumed, which makes the base column a control: if it disagrees with what the
 * field actually contains, this file is wrong rather than the map.
 *
 * The grid origin is recomputed here from `ctx.bounds` exactly as flow.js's
 * resize() computes it. That is the one thing this harness reimplements, it is
 * two lines of arithmetic rather than a judgement, and the alternative - guessing
 * at where cells fall - is what would make the doorway answer meaningless.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  const g = window.__SANDS__;

  for (const d of g.doors.all) {
    if (d.open) d.open();
    for (let i = 0; i < 400 && !d.opened; i++) if (d.advance) d.advance(1 / 30);
  }
  g.spaces.enter('interior', { x: 0, z: -143.5, rot: 0 });
  await new Promise((r) => requestAnimationFrame(r));

  const ctx = g.director.ctx;
  const flow = g.director.flow;
  if (!ctx) return { fatal: 'director.ctx not exposed' };
  if (!flow || !flow.clearFor) return { fatal: 'flow.clearFor not exposed' };

  const STEP = flow.step;
  const BASE_PAD = 0.55, BASE_H = 2.0;
  const GOD_PAD = 0.95 * 1.9, GOD_H = 2.05 * 1.9;

  // Exactly flow.js resize(). The only arithmetic this file borrows.
  const b = ctx.bounds;
  const minX = b.minX ?? b.min, maxX = b.maxX ?? b.max;
  const minZ = b.minZ ?? b.min, maxZ = b.maxZ ?? b.max;
  const nx = Math.floor((maxX - minX) / STEP) + 1;
  const nz = Math.floor((maxZ - minZ) / STEP) + 1;

  // ---------------------------------------------------------------- whole map
  //
  // Swept at the base of each room rather than at y=0, because the interior's
  // Act 3 rooms sit at -6 and a sweep that asks about the wrong storey reports
  // a floor nobody stands on. Every cell is asked at the height the floor
  // sampler puts a body at, which is the same question the flood asks.
  let sampled = 0;
  const heightGrid = new Float32Array(nx * nz);
  const liveGrid = new Uint8Array(nx * nz);

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + i * STEP;
      const z = minZ + j * STEP;
      const y = ctx.heightAt ? ctx.heightAt(x, z, 0) : 0;
      if (y === null || y === undefined) continue;
      sampled++;
      liveGrid[j * nx + i] = 1;
      heightGrid[j * nx + i] = y;
    }
  }

  /** Carve the whole grid for a body of this size. */
  function carve(pad, bodyH) {
    const grid = new Uint8Array(nx * nz);
    let open = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!liveGrid[k]) continue;
        if (flow.clearFor(minX + i * STEP, minZ + j * STEP, heightGrid[k], ctx, pad, bodyH)) {
          grid[k] = 1; open++;
        }
      }
    }
    return { grid, open };
  }

  const baseCarve = carve(BASE_PAD, BASE_H);
  const godCarve = carve(GOD_PAD, GOD_H);
  const baseGrid = baseCarve.grid, godGrid = godCarve.grid;
  const baseOpen = baseCarve.open, godOpen = godCarve.open;

  /**
   * Does the god-open set still CONNECT, or is it islands.
   *
   * The count above can look healthy while every room is its own component with
   * no doorway joining them, which is precisely the failure being tested for. A
   * flood-fill from the player's own cell over the god-open set answers the only
   * question that matters: how much of what a shambler can reach can a god.
   */
  function componentFrom(grid, si, sj) {
    const seenC = new Uint8Array(nx * nz);
    const stack = [sj * nx + si];
    seenC[sj * nx + si] = 1;
    let count = grid[sj * nx + si] ? 1 : 0;
    if (!grid[sj * nx + si]) return 0;
    while (stack.length) {
      const k = stack.pop();
      const ki = k % nx, kj = (k / nx) | 0;
      for (let e = 0; e < 4; e++) {
        const ni = ki + [1, -1, 0, 0][e];
        const nj = kj + [0, 0, 1, -1][e];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const nk = nj * nx + ni;
        if (seenC[nk] || !grid[nk]) continue;
        seenC[nk] = 1; count++; stack.push(nk);
      }
    }
    return count;
  }

  // Root every fill in the Great Gallery, which is where the fighting is, at the
  // nearest cell the candidate body can actually stand in. Seeding a heavy body
  // at a cell only a shambler fits reports zero reach for a body that in fact
  // routes fine two cells away, which would be the harness lying in the
  // pessimistic direction rather than the optimistic one - still a lie.
  const pi = Math.round((0 - minX) / STEP);
  const pj = Math.round((-143.5 - minZ) / STEP);
  function reachOf(grid) {
    for (let r = 0; r <= 8; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const i = pi + di, j = pj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        if (baseGrid[j * nx + i] && grid[j * nx + i]) return componentFrom(grid, i, j);
      }
    }
    return 0;
  }
  const baseReach = reachOf(baseGrid);
  const godReach = reachOf(godGrid);

  /**
   * WHICH ROOMS A GOD CAN ACTUALLY GET TO, per room rather than as one total.
   *
   * A count of reachable cells says the horde is stuck and does not say where.
   * With the doorways widened, eight of ten carry two to three god-legal cells
   * and reachability barely moved, which means the barrier is no longer the
   * doorway LINE - it is somewhere in the approach, and only a per-room split
   * can say which side of which door.
   */
  function componentOf(grid, si, sj) {
    const seenC = new Uint8Array(nx * nz);
    if (!grid[sj * nx + si]) return seenC;
    const stack = [sj * nx + si];
    seenC[sj * nx + si] = 1;
    while (stack.length) {
      const k = stack.pop();
      const ki = k % nx, kj = (k / nx) | 0;
      for (let e = 0; e < 4; e++) {
        const ni = ki + [1, -1, 0, 0][e];
        const nj = kj + [0, 0, 1, -1][e];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const nk = nj * nx + ni;
        if (seenC[nk] || !grid[nk]) continue;
        seenC[nk] = 1; stack.push(nk);
      }
    }
    return seenC;
  }

  let gsi = pi, gsj = pj;
  outerSeed: for (let r = 0; r <= 8; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = pi + di, j = pj + dj;
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      if (baseGrid[j * nx + i] && godGrid[j * nx + i]) { gsi = i; gsj = j; break outerSeed; }
    }
  }
  const godComp = componentOf(godGrid, gsi, gsj);

  const perRoom = [];
  for (const room of g.spaces.interior.rooms) {
    const b2 = room.bounds;
    if (!b2) continue;
    const i0r = Math.max(0, Math.floor((b2.x - b2.w / 2 - minX) / STEP));
    const i1r = Math.min(nx - 1, Math.ceil((b2.x + b2.w / 2 - minX) / STEP));
    const j0r = Math.max(0, Math.floor((b2.z - b2.d / 2 - minZ) / STEP));
    const j1r = Math.min(nz - 1, Math.ceil((b2.z + b2.d / 2 - minZ) / STEP));
    let base = 0, god = 0, reached = 0;
    for (let j = j0r; j <= j1r; j++) {
      for (let i = i0r; i <= i1r; i++) {
        const k = j * nx + i;
        if (baseGrid[k]) base++;
        if (godGrid[k]) god++;
        if (godComp[k]) reached++;
      }
    }
    perRoom.push({ id: room.id, base, god, reached });
  }

  /**
   * HOW MUCH OF THE MAP EACH CANDIDATE BODY WIDTH BUYS BACK.
   *
   * The god's collider is 1.44x its own widest visible geometry, and the
   * shambler's is 1.83x its own - so the padding is a CONVENTION rather than
   * anything the god specifically needs. That convention costs a 0.94-scale
   * shambler 0.18m per side and a 1.9-scale god 0.55m, which is more lateral
   * room than a 4.0m doorway has to give in total.
   *
   * So: what does the map look like to a god whose collider is tightened toward
   * its silhouette. Swept rather than argued, because the answer decides whether
   * the geometry has to move at all.
   *
   * Height is held at the god's real 3.895 throughout. Only width is in
   * question; headroom was measured at 4.2m against it and is not binding.
   */
  const sweep = [];
  for (const specR of [0.95, 0.88, 0.82, 0.76, 0.70, 0.66, 0.62]) {
    const pad = specR * 1.9;
    const c = carve(pad, GOD_H);
    sweep.push({
      specRadius: specR,
      worldRadius: +pad.toFixed(3),
      open: c.open,
      openPct: +((c.open / baseOpen) * 100).toFixed(1),
      reach: reachOf(c.grid),
      reachPct: +((reachOf(c.grid) / baseReach) * 100).toFixed(1),
      doorBand: +(4.0 - 2 * pad).toFixed(2),
    });
  }

  // ------------------------------------------------------------- the doorways
  const byId = new Map(g.spaces.interior.rooms.map((r) => [r.id, r]));
  const doors = [];
  const seen = new Set();

  for (const room of g.spaces.interior.rooms) {
    for (const p of room.portals || []) {
      const key = [room.id, p.to].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);

      /**
       * THE AXIS IS THE WALL NORMAL, NOT THE LINE JOINING THE TWO ROOM CENTRES.
       *
       * Centre-to-centre is the obvious choice and it is wrong whenever the two
       * rooms are offset, which on this map is most of them: `hall-of-offerings`
       * is x -56..-18 and the gallery is x -26..26, so the vector between their
       * centres runs diagonally and a transect along it walks straight out of
       * the doorway and into the wall beside it. It printed a doorway that was
       * an island - open in the middle, blocked at both ends - for openings that
       * the per-room reachability in this same run proves a god walks through.
       *
       * `test/chokepoint.mjs` uses centre-to-centre for its corridor scan and so
       * carries this same defect. Its conclusion that gallery obstructions sit
       * "2 to 6 m INSIDE the gallery" should be re-measured before it is trusted.
       *
       * A portal sits ON a wall line, so the direction through it is that wall's
       * normal. Found by asking which of the room's four edges the portal is
       * closest to, and signed to point away from this room's centre, which is
       * into the neighbour.
       */
      const b3 = room.bounds;
      let ax = 0, az = 1;
      if (b3) {
        const dz0 = Math.abs(p.at.z - (b3.z - b3.d / 2));
        const dz1 = Math.abs(p.at.z - (b3.z + b3.d / 2));
        const dx0 = Math.abs(p.at.x - (b3.x - b3.w / 2));
        const dx1 = Math.abs(p.at.x - (b3.x + b3.w / 2));
        const m = Math.min(dz0, dz1, dx0, dx1);
        if (m === dz0) { ax = 0; az = -1; }
        else if (m === dz1) { ax = 0; az = 1; }
        else if (m === dx0) { ax = -1; az = 0; }
        else { ax = 1; az = 0; }
      }
      // Across the opening, not along it.
      const px = -az, pz = ax;

      const x = p.at.x, z = p.at.z;
      const feetY = ctx.heightAt ? ctx.heightAt(x, z, room.base || 0) : 0;

      // The legal band, to the centimetre, by walking out from centre until the
      // predicate flips. Asked at 1cm so the band is measured rather than
      // quantised by the same STEP whose adequacy is the question.
      /**
       * feetY IS RESAMPLED AT EVERY STEP, and the first cut of this file did not
       * do that. Holding the doorway's own floor height across the whole
       * transect reported the two King's Chamber descent portals as UNWIDENED -
       * band 0.48 and 0.46 after their width went to 5.5 - because those two
       * openings sit on a descent and their floor is six metres below the
       * threshold. The clearance test was being asked about a body standing at a
       * height nobody stands at, a metre or more off the real surface.
       *
       * `test/chokepoint.mjs` already carries this exact clause, with this exact
       * reasoning, and it was written days earlier. Making the same mistake in a
       * second harness is why the rule is that every probe resamples the floor.
       */
      function band(pad, bodyH) {
        const at = (t) => {
          const sx = x + px * t, sz = z + pz * t;
          const sy = ctx.heightAt ? ctx.heightAt(sx, sz, room.base || 0) : 0;
          return flow.clearFor(sx, sz, sy, ctx, pad, bodyH);
        };
        let lo = 0, hi = 0;
        for (let t = 0; t >= -3.0; t -= 0.01) { if (!at(t)) break; lo = t; }
        for (let t = 0; t <= 3.0; t += 0.01) { if (!at(t)) break; hi = t; }
        return { lo: +lo.toFixed(2), hi: +hi.toFixed(2), w: +(hi - lo).toFixed(2) };
      }

      const centreOpenGod = flow.clearFor(x, z, feetY, ctx, GOD_PAD, GOD_H);
      const bBase = band(BASE_PAD, BASE_H);
      const bGod = centreOpenGod ? band(GOD_PAD, GOD_H) : { lo: 0, hi: 0, w: 0 };

      /**
       * THE NUMBER THE DESIGN TURNS ON.
       *
       * How many of flow.js's actual cell centres fall inside the god-legal
       * band. Zero means a heavy field at this STEP has no cell in this doorway
       * and therefore no route through it, no matter how correct the carve is.
       */
      let cellsInGodBand = 0;
      const cellHits = [];
      if (bGod.w > 0) {
        for (let t = bGod.lo; t <= bGod.hi + 1e-9; t += 0.01) {
          const sx = x + px * t, sz = z + pz * t;
          const ci = Math.round((sx - minX) / STEP);
          const cj = Math.round((sz - minZ) / STEP);
          const cx = minX + ci * STEP, cz = minZ + cj * STEP;
          // Is that cell CENTRE itself inside the band, not merely the nearest
          // cell to a point that is.
          const dt = (cx - x) * px + (cz - z) * pz;
          const perp = Math.hypot(cx - x - px * dt, cz - z - pz * dt);
          if (perp > STEP * 0.5) continue;
          if (dt < bGod.lo || dt > bGod.hi) continue;
          const kk = `${ci},${cj}`;
          if (cellHits.includes(kk)) continue;
          cellHits.push(kk);
          if (flow.clearFor(cx, cz, ctx.heightAt(cx, cz, room.base || 0), ctx, GOD_PAD, GOD_H)) {
            cellsInGodBand++;
          }
        }
      }

      /**
       * THE APPROACH, as a picture rather than a number.
       *
       * Two rounds of this have now ended the same way: the doorway LINE opens,
       * the reachable count barely moves, and the thing actually blocking a god
       * turns out to be several metres inside the room. A band measured at the
       * threshold cannot see that. So walk the through-axis and print whether a
       * god fits at every half metre, with the shambler's row underneath as the
       * control - where the two rows differ is where the map is only passable
       * for small bodies.
       *
       * '#' fits, '.' does not. t runs from 8 m on this room's side to 8 m on
       * the far side, and the floor is resampled at every step because these
       * approaches are ramps.
       */
      function profile(pad, bodyH) {
        let s = '';
        for (let t = -8; t <= 8.0001; t += 0.5) {
          const sx = x + ax * t, sz = z + az * t;
          const sy = ctx.heightAt ? ctx.heightAt(sx, sz, room.base || 0) : 0;
          s += flow.clearFor(sx, sz, sy, ctx, pad, bodyH) ? '#' : '.';
        }
        return s;
      }

      doors.push({
        godProfile: profile(GOD_PAD, GOD_H),
        baseProfile: profile(BASE_PAD, BASE_H),
        from: room.id, to: p.to, kind: p.kind, nominal: p.width,
        x: +x.toFixed(2), z: +z.toFixed(2),
        baseBand: bBase.w,
        godBand: bGod.w,
        godCentreOpen: centreOpenGod,
        cellsInGodBand,
      });
    }
  }

  return {
    step: STEP, nx, nz, sampled,
    baseOpen, godOpen,
    baseReach, godReach,
    godPad: +GOD_PAD.toFixed(3), godH: +GOD_H.toFixed(3),
    doors, sweep, perRoom,
  };
});

if (out.fatal) { console.log(`FATAL  ${out.fatal}`); await browser.close(); process.exit(1); }

writeFileSync(`${OUT}godfield-report.json`, JSON.stringify({ ...out, errors }, null, 1));

const combat = out.doors.filter((d) => d.kind !== 'puzzle');
const sealed = combat.filter((d) => d.cellsInGodBand === 0);

console.log(`grid            ${out.nx} x ${out.nz} at STEP ${out.step}`);
console.log(`god body        radius ${out.godPad}  height ${out.godH}`);
console.log('');
console.log(`cells sampled   ${out.sampled}`);
console.log(`base-open       ${out.baseOpen}`);
console.log(`god-open        ${out.godOpen}   (${((out.godOpen / out.baseOpen) * 100).toFixed(1)}% of base)`);
console.log('');
console.log(`connected from the gallery, orthogonally:`);
console.log(`  base reaches  ${out.baseReach} cells`);
console.log(`  god reaches   ${out.godReach} cells   (${((out.godReach / out.baseReach) * 100).toFixed(1)}% of base)`);
console.log('');
console.log('doorway            kind     nominal  base band  god band  cells in god band');
for (const d of out.doors) {
  console.log(
    `${(d.from + ' -> ' + d.to).padEnd(34)}${String(d.kind).padEnd(9)}`
    + `${String(d.nominal).padStart(5)}`
    + `${d.baseBand.toFixed(2).padStart(11)}`
    + `${d.godBand.toFixed(2).padStart(10)}`
    + `${String(d.cellsInGodBand).padStart(19)}`,
  );
}
console.log('');
console.log('approach along the through-axis, -8m to +8m. god row over shambler row.');
console.log('the doorway is the middle character. where the rows differ, only small bodies pass.');
for (const d of out.doors) {
  console.log(`  ${d.from} -> ${d.to}`);
  console.log(`    god  ${d.godProfile}`);
  console.log(`    base ${d.baseProfile}`);
}
console.log('');
console.log('per room: cells a shambler can stand in, a god can stand in, a god can REACH');
for (const r of out.perRoom) {
  const flag = r.god > 0 && r.reached === 0 ? '   <- ISLAND' : '';
  console.log(
    `  ${r.id.padEnd(20)}base ${String(r.base).padStart(5)}`
    + `   god ${String(r.god).padStart(5)}`
    + `   reached ${String(r.reached).padStart(5)}${flag}`,
  );
}
console.log('');
console.log('collider sweep, height held at the god\'s real 3.895:');
console.log('spec r   world r   door band   god-open      reachable from the gallery');
for (const s of out.sweep) {
  console.log(
    `${s.specRadius.toFixed(2).padStart(5)}`
    + `${s.worldRadius.toFixed(3).padStart(10)}`
    + `${s.doorBand.toFixed(2).padStart(12)}`
    + `${(s.openPct + '%').padStart(12)}`
    + `${(s.reach + ' cells  ' + s.reachPct + '%').padStart(28)}`,
  );
}
console.log('');
console.log(`combat doorways with NO cell a god can stand in: ${sealed.length} of ${combat.length}`);
for (const d of sealed) console.log(`  SEALED  ${d.from} -> ${d.to}  (god band ${d.godBand.toFixed(2)}m)`);
if (errors.length) { console.log(''); for (const e of errors.slice(0, 5)) console.log(`  err ${e}`); }

await browser.close();
