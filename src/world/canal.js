/**
 * THE CANAL: the dried channel that floated the limestone barges in.
 *
 * The west half of the Act 1 circuit specified in MAP.md. Its job is the SUNKEN
 * READ - you run the channel while the horde spills down the banks, which is a
 * wholly different pressure to the avenue's flat corridor, where everything
 * that is coming for you arrives in the same plane you are standing in.
 *
 * THE GROUND ACTUALLY MOVES, and that is the whole point of the space. A trench
 * painted on a flat floor is a texture; a trench you drop into is a room with
 * two storeys. So `depthAt` below is subtracted from the dune sampler BEFORE
 * anything else in the courtyard reads it, which means one function answers
 * "how high is the ground here" for the mesh, the player controller, the
 * mummies, the grenades and every prop seated out here. There is no second
 * representation of the floor to drift out of agreement with the first, which
 * is the same guarantee `duneField` already makes and for the same reason.
 *
 * WHY THE BREAKPOINTS ARE THE NUMBERS THEY ARE. The dune mesh is a 420 unit
 * plane at 160 segments, so its vertices fall on multiples of 2.625 and nowhere
 * else. Every breakpoint in this file is an exact multiple of 2.625. That is
 * not tidiness: the mesh samples the height function at its vertices and
 * interpolates linearly between them, so a slope whose start and end land on
 * vertices is reproduced EXACTLY by the mesh, while one that starts midway
 * across a cell is reproduced as a wrong straight line and the player walks
 * through the picture. The one place the two still disagree is the four corners
 * where the x ramp and the z ramp overlap, because a product of two linear
 * ramps has a twist term the triangles cannot carry; that error peaks at 13 cm
 * and it is confined to four cells, which is smaller than the dune noise the
 * same mesh already approximates.
 *
 * The alternative considered and rejected was cutting a hole in the dune mesh
 * and dropping a separate trench object through it. It is what a level editor
 * would do and it fails here for two reasons: the hole has to be stitched or it
 * leaks sky at grazing angles, and the trench object then owns a second height
 * function that the dune sampler knows nothing about, which is exactly the
 * class of bug this project has been bitten by nine times.
 */

import * as THREE from 'three';
import { cylinderUV } from './uv.js';

/**
 * The channel in cross section, west to east. All six numbers are multiples of
 * 2.625 for the reason given above.
 *
 *        WALL   west slope    channel floor    east slope    east bank
 *   x  -45.0  -42.0 ....... -36.75 ....... -28.875 ...... -23.625 ..... -15.0
 *   y    0        0 \____________ -3.2 ____________/ 0                    0
 *
 * The east bank is the wide one and it is deliberate. It is the side the player
 * arrives on, it is the side the two crossings land on, and it is the only
 * flat ground in the space, so the choice the room offers is "stay high on the
 * bank and cross on a causeway" against "commit to the channel". Two loop
 * scales in one room, which is the property MAP.md asks Act 1 for twice.
 */
export const CANAL = {
  /** Outer extents of the authored space, for the walkable backstop. */
  minX: -46.0, maxX: -15.0,
  minZ: -21.0, maxZ: 21.0,

  /** Cross-section breakpoints, west to east. */
  wallX: -45.0,        // the boundary wall's collider line
  slopeWestTop: -42.0,
  floorWest: -36.75,
  floorEast: -28.875,
  slopeEastTop: -23.625,

  /** Along the channel: full depth in the middle, silted back up to grade at
   *  both ends, so the trench dies into the ground rather than ending in a
   *  cliff the mesh would have to carry as a vertical quad. */
  siltSouth: -21.0,
  floorSouth: -13.125,
  floorNorth: 13.125,
  siltNorth: 21.0,

  depth: 3.2,

  /** The two crossing points, at grade, spanning bank to bank. */
  crossings: [-7.0, 7.0],

  /** Where the boundary walls stand. */
  endSouthZ: -19.5,
  endNorthZ: 19.5,
};

/** Linear 0..1 ramp, clamped, with a zero-length guard. */
function ramp(v, a, b) {
  if (a === b) return v >= b ? 1 : 0;
  return Math.min(1, Math.max(0, (v - a) / (b - a)));
}

/**
 * How far below the dune surface the ground has been cut, at a world position.
 *
 * Pure, cheap, and free of any dependency on the scene, because it is called
 * per vertex when the ground mesh is displaced AND once per frame per actor
 * when anything asks where the floor is. It has to be the same function in both
 * places or the picture and the collision are two different opinions.
 */
export function canalDepthAt(x, z) {
  if (x <= CANAL.wallX || x >= CANAL.slopeEastTop) return 0;
  if (z <= CANAL.siltSouth || z >= CANAL.siltNorth) return 0;

  const across = x < CANAL.floorWest
    ? ramp(x, CANAL.slopeWestTop, CANAL.floorWest)
    : ramp(x, CANAL.slopeEastTop, CANAL.floorEast);

  const along = z < 0
    ? ramp(z, CANAL.siltSouth, CANAL.floorSouth)
    : ramp(z, CANAL.siltNorth, CANAL.floorNorth);

  return CANAL.depth * across * along;
}

/**
 * Push the dune mesh down into the trench.
 *
 * Runs over the plane's own position attribute rather than rebuilding it, so
 * the ground stays ONE mesh with one material and one draw call. The plane is
 * authored in XY and rotated into place by the courtyard, so its local y is
 * world -z and its local z is world y, which is the same convention
 * `duneField` writes under.
 */
export function cutCanalIntoGround(geometry) {
  const pos = geometry.attributes.position;
  let touched = 0;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = -pos.getY(i);
    const d = canalDepthAt(x, z);
    if (d === 0) continue;
    pos.setZ(i, pos.getZ(i) - d);
    touched++;
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return touched;
}

/**
 * Build the space.
 *
 * `ctx` is the courtyard's own vocabulary handed over intact: the same `stone`
 * and `slabMesh` builders, the same collider array through `addCollider` and
 * `addWallRun`, the same material set and the same density table. This file
 * deliberately owns no helpers of its own beyond the ones that are specific to
 * a canal, because a second way to build a wall in this codebase is a second
 * way for a wall to leak.
 */
export function buildCanal(ctx) {
  const {
    group, M, DENSITY, stone, slabMesh,
    addCollider, addWallRun, addDeck, groundY, rand,
  } = ctx;

  const g = new THREE.Group();
  g.name = 'canal';
  group.add(g);

  const floorY = -CANAL.depth;
  const midX = (CANAL.floorWest + CANAL.floorEast) / 2;

  // -------------------------------------------------------------------------
  // the boundary: three walls, and none of them a row of separate discs
  // -------------------------------------------------------------------------
  //
  // The west wall is the temenos of the canal yard and it is doing a second job
  // as well: it stands between the player and the outer perimeter, which is
  // backdrop geometry built to be read at forty metres and is now nine metres
  // away. A four and a half metre wall at the top of the west slope puts the
  // perimeter's upper courses above the eyeline and its unfinished footing out
  // of sight, which is what lets this space be authored without reopening the
  // greybox MAP.md forbids reopening.
  //
  // Every run below goes through `addWallRun`. One cylinder per wall segment
  // leaves gaps wider than the player - this is a documented past bug in this
  // file, and the reason `addWallRun` derives its spacing from its radius
  // rather than taking one.
  const wallRuns = [
    // west, the long one, standing at the top of the west slope
    { x: CANAL.wallX, z: 0, axis: 'z', len: CANAL.maxZ - CANAL.minZ, h: 4.6, r: 1.4 },
    // south and north, closing the yard onto the avenue's west wall
    { x: (CANAL.wallX + CANAL.maxX) / 2, z: CANAL.endSouthZ, axis: 'x', len: 31, h: 4.0, r: 1.5 },
    { x: (CANAL.wallX + CANAL.maxX) / 2, z: CANAL.endNorthZ, axis: 'x', len: 31, h: 4.0, r: 1.5 },
  ];

  for (const run of wallRuns) {
    // Seated on the LOWEST ground along the run, sampled rather than assumed.
    // The end walls cross the silted tail of the trench, where the ground is up
    // to forty centimetres below grade, and a wall seated at zero there shows
    // daylight under its middle from any grazing angle. The perimeter pass in
    // courtyard.js had to learn the same thing and this is the same fix.
    let lo = Infinity;
    for (let i = 0; i <= 32; i++) {
      const t = (i / 32 - 0.5) * run.len;
      const px = run.axis === 'x' ? run.x + t : run.x;
      const pz = run.axis === 'x' ? run.z : run.z + t;
      lo = Math.min(lo, groundY(px, pz));
    }

    const thick = run.r * 1.45;
    const bodyH = run.h + 1.4;                       // 1.4 of it buried
    const w = run.axis === 'x' ? run.len : thick;
    const d = run.axis === 'x' ? thick : run.len;

    const body = stone(w, bodyH, d, M.limestone, DENSITY.limestone,
      { eroded: 0.09, chamfer: 0.16 });
    body.position.set(run.x, lo - 1.4 + bodyH / 2, run.z);
    g.add(body);

    // A coping course, shorter than the wall along the run so it can never
    // cantilever into air at a break, which is the failure the perimeter pass
    // catalogued as "floating slab".
    const cap = stone(
      run.axis === 'x' ? run.len - 1.2 : thick + 0.7,
      0.7,
      run.axis === 'x' ? thick + 0.7 : run.len - 1.2,
      M.limestone, DENSITY.limestone, { chamfer: 0.12 });
    cap.position.set(run.x, lo - 1.4 + bodyH + 0.25, run.z);
    g.add(cap);

    addWallRun(run.x, run.z, run.r, run.h + 1.0, run.axis, run.len, lo - 1.4);
  }

  // -------------------------------------------------------------------------
  // the quay: the revetment the barges tied up against
  // -------------------------------------------------------------------------
  //
  // The west slope is bare cut sand and the east one is faced in stone, and the
  // asymmetry is the same trick the avenue plays with its two colonnades: a
  // channel revetted identically on both sides reads as an extruded profile,
  // which is what a trench modelled by a tool looks like. One worked face and
  // one raw bank reads as a place where work stopped.
  //
  // The facing stands ON the east slope rather than replacing it. It is a
  // course of blocks stepping down the batter, which is how a real revetment is
  // laid, and it means the slope stays walkable - the stone is the picture and
  // the sand under it is the floor. Facing the slope with a vertical wall was
  // the first version and it was wrong twice over: it made the east side a
  // cliff the player could not get down, and it deleted the one route the horde
  // is supposed to spill along.
  const COURSES = 4;
  for (let c = 0; c < COURSES; c++) {
    const t = (c + 0.5) / COURSES;
    const x = CANAL.slopeEastTop + (CANAL.floorEast - CANAL.slopeEastTop) * t;
    const y = -CANAL.depth * t;

    for (let z = CANAL.floorSouth + 1.2; z < CANAL.floorNorth; z += 4.6) {
      // Blocks laid along the batter, each one bedded into the slope so only
      // its outer face and a hand's width of its top are proud. Anything more
      // and the course reads as a shelf, and four shelves read as stairs.
      const blk = slabMesh(1.9, 0.85, 4.3, M.limestone, DENSITY.limestone);
      blk.position.set(x, groundY(x, z + 2.15) + 0.18, z + 2.15);
      blk.rotation.x = -0.52;                 // lying along the batter
      blk.rotation.y = (rand() - 0.5) * 0.05;
      g.add(blk);
    }
  }

  // Mooring bollards on the east bank, at the top of the revetment. Three, not
  // a row: a row would restate the wall's rhythm, and these exist to say what
  // the channel was FOR, which one of them does as well as ten.
  // z is kept clear of the two mouths at -13.5 and 13.5 and of the six metres
  // of talus behind each of them. A bollard is a metre and a half of solid
  // cylinder, and one standing in a doorway is a doorway two thirds shut.
  for (const z of [-8.0, 1.0, 8.5]) {
    const x = CANAL.slopeEastTop + 1.5;
    const post = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(0.42, 0.52, 1.35, 10), 0.52, 1.35, DENSITY.carved),
      M.carved,
    );
    post.position.set(x, groundY(x, z) + 0.6, z);
    post.castShadow = true;
    g.add(post);
    addCollider(x, z, 0.55, 1.4);
  }

  // -------------------------------------------------------------------------
  // the two crossings
  // -------------------------------------------------------------------------
  //
  // MAP.md asks for two crossing points and this is the mechanic that makes
  // them worth having: a player on a causeway is at grade with the banks while
  // whatever is chasing them is three metres down in the channel, and it has to
  // climb a slope to get back level. That is a tempo change you cannot get out
  // of the avenue at any price.
  //
  // A deck is a `{x, z, w, d, y0, y1}` record read by the same sampler the
  // interior's ramps and ledges use, INCLUDING its foot test: a surface only
  // counts as floor if it is within a step of where your feet already are. That
  // one clause is the whole reason a causeway can be walked over and under. It
  // is not new machinery invented here - `build.js` has carried it since the
  // gallery got an upper level - and reusing it is what keeps the exterior and
  // the interior answering the floor question the same way.
  const DECK_Y = 0.2;
  const DECK_W = 3.6;

  for (const cz of CANAL.crossings) {
    addDeck({
      x: (CANAL.slopeWestTop + CANAL.slopeEastTop) / 2,
      z: cz,
      w: CANAL.slopeEastTop - CANAL.slopeWestTop,
      d: DECK_W,
      y0: DECK_Y,
      y1: DECK_Y,
    });

    // The deck itself: a rubble causeway with a stone kerb either side, so the
    // edge of the drop is legible from on top of it. A bare plank with no kerb
    // was tried in the head and rejected on the same grounds the gallery ledge
    // failed on - an unmarked edge over a three metre fall is a trap, not a
    // choice.
    const span = CANAL.slopeEastTop - CANAL.slopeWestTop;
    const cx = (CANAL.slopeWestTop + CANAL.slopeEastTop) / 2;

    const deck = slabMesh(span, 0.55, DECK_W, M.limestone, DENSITY.limestone);
    deck.position.set(cx, DECK_Y - 0.275, cz);
    g.add(deck);

    for (const s of [-1, 1]) {
      const kerb = stone(span, 0.42, 0.5, M.carved, DENSITY.carved, { chamfer: 0.08 });
      kerb.position.set(cx, DECK_Y + 0.21, cz + s * (DECK_W / 2 - 0.25));
      g.add(kerb);
    }

    // Piers, standing in the channel and carrying the span.
    //
    // Their colliders declare a BASE of the channel floor and a height that
    // stops just under the deck, which is what makes them solid to somebody
    // running the channel and invisible to somebody standing on the causeway.
    // A collider with no declared base is measured from whatever the local
    // floor happens to be, which for a pier means it blocks from both, and the
    // causeway would have been a wall with a bridge painted on it.
    for (const px of [midX - 4.0, midX + 4.0]) {
      const pier = stone(1.7, CANAL.depth + 0.6, 1.7, M.limestone, DENSITY.limestone,
        { eroded: 0.1, chamfer: 0.1 });
      pier.position.set(px, floorY + (CANAL.depth + 0.6) / 2 - 0.4, cz);
      g.add(pier);
      addCollider(px, cz, 1.15, CANAL.depth - 0.15, floorY);
    }
  }

  // -------------------------------------------------------------------------
  // the channel floor
  // -------------------------------------------------------------------------
  //
  // Dressing goes IN the channel and not on the banks, because the channel is
  // where the player's eye is when the space is doing its job. Everything here
  // is low: a stranded sledge timber, silt drifts, the ribs of a barge that was
  // never got out. Nothing tall, because a tall object in a three metre trench
  // is a corner the horde disappears behind, and the whole read of this space
  // is that you can SEE what is coming down the bank at you.
  const barge = { z: -4.0 };
  {
    // The barge: a keel timber with ribs, half buried, lying along the channel.
    // Built rather than bought because there is no boat in the prop kit and one
    // recognisable wreck is worth more here than any amount of scattered stone.
    const keel = slabMesh(1.1, 0.7, 13.0, M.palmTrunk, DENSITY.rubble);
    keel.position.set(midX + 1.1, floorY + 0.2, barge.z);
    keel.rotation.y = 0.06;
    g.add(keel);
    addWallRun(midX + 1.1, barge.z, 0.85, 0.9, 'z', 13.0, floorY);

    for (let i = 0; i < 7; i++) {
      const rz = barge.z - 5.6 + i * 1.9;
      const lean = 0.34 + (i % 3) * 0.07;
      for (const s of [-1, 1]) {
        const rib = slabMesh(0.32, 2.1, 0.5, M.palmTrunk, DENSITY.rubble);
        rib.position.set(midX + 1.1 + s * 0.9, floorY + 0.85, rz);
        rib.rotation.z = s * lean;
        g.add(rib);
      }
    }
  }

  // Silt drifts and fallen facing blocks, banked against the west slope where a
  // dry channel actually collects them. The draws come off the caller's own
  // stream, which is an INDEPENDENT one - see the comment on `qrand` in
  // courtyard.js - so nothing here can move a stone the avenue was tuned around.
  for (let i = 0; i < 14; i++) {
    const z = CANAL.floorSouth + 1 + rand() * (CANAL.floorNorth - CANAL.floorSouth - 2);
    const x = CANAL.floorWest + 0.6 + rand() * 3.4;
    const w = 1.0 + rand() * 2.1;
    const h = 0.7 + rand() * 1.3;
    const d = 1.0 + rand() * 1.9;

    const chunk = stone(w, h, d, M.limestone, DENSITY.rubble, { eroded: 0.18 });
    chunk.position.set(x, groundY(x, z) + h * 0.34, z);
    chunk.rotation.y = rand() * Math.PI;
    chunk.rotation.z = (rand() - 0.5) * 0.5;
    chunk.rotation.x = (rand() - 0.5) * 0.3;
    g.add(chunk);
    addCollider(x, z, Math.max(w, d) * 0.44, h, groundY(x, z));
  }

  // A few on the east bank as well, but fewer and smaller. The bank is the
  // route, and a route with obstacles on it is not a route.
  //
  // Confined to the middle of the bank on purpose. The two mouths are at
  // z = -13.5 and z = 13.5 with six metres of talus behind each, and a chunk
  // dropped at random over the whole bank lands in one about a third of the
  // time - which is a doorway blocked by a rock in one run out of three and
  // clear in the other two, the worst kind of defect to reproduce.
  for (let i = 0; i < 6; i++) {
    const z = -9.0 + rand() * 18.0;
    const x = CANAL.slopeEastTop + 0.8 + rand() * 4.0;
    const w = 0.9 + rand() * 1.4;
    const h = 0.6 + rand() * 0.9;

    const chunk = stone(w, h, w * 0.85, M.limestone, DENSITY.rubble, { eroded: 0.2 });
    chunk.position.set(x, groundY(x, z) + h * 0.32, z);
    chunk.rotation.y = rand() * Math.PI;
    chunk.rotation.z = (rand() - 0.5) * 0.4;
    g.add(chunk);
    addCollider(x, z, w * 0.46, h, groundY(x, z));
  }

  // -------------------------------------------------------------------------
  // the silted ends
  // -------------------------------------------------------------------------
  //
  // Where the channel rises back to grade it is choked with drift, and the
  // drift is what tells the player the trench ends there rather than continuing
  // out of the map. Two heaps per end, offset, never a symmetric pair.
  for (const [sz, sign] of [[CANAL.floorSouth - 3.5, -1], [CANAL.floorNorth + 3.5, 1]]) {
    for (let i = 0; i < 5; i++) {
      const x = CANAL.floorWest + 1.5 + i * 2.0 + (rand() - 0.5) * 1.4;
      const z = sz + sign * rand() * 3.0;
      const w = 1.6 + rand() * 2.6;
      const h = 0.9 + rand() * 1.5;

      const drift = stone(w, h, w * 1.1, M.limestone, DENSITY.rubble, { eroded: 0.22 });
      drift.position.set(x, groundY(x, z) + h * 0.3, z);
      drift.rotation.y = rand() * Math.PI;
      drift.rotation.z = (rand() - 0.5) * 0.3;
      g.add(drift);
      addCollider(x, z, w * 0.45, h, groundY(x, z));
    }
  }

  return {
    group: g,
    bounds: { minX: CANAL.minX, maxX: CANAL.maxX, minZ: CANAL.minZ, maxZ: CANAL.maxZ },
  };
}
