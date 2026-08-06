/**
 * THE QUARRY: the workmen's yard where the stone was cut.
 *
 * The east half of the Act 1 circuit specified in MAP.md. Its job is ELEVATION.
 * The avenue is a superb corridor and it is dead flat: everything in it happens
 * on one plane, so every fight in it is the same fight read left to right. The
 * quarry answers that with six floor heights inside forty metres - grade, four
 * cut blocks standing at 1.7, 2.9, 4.3 and 5.8, and a terrace at 2.6 with the
 * bedrock face rising nine metres behind it - and with one of them walkable.
 *
 * TWO THINGS HAD TO BE TRUE AT ONCE, and getting both is most of the design.
 *
 * First, "a half-cut block is a mass you can circle". Every free block in here
 * has at least two and a half metres of clear floor on all four sides, measured
 * against the collider skirts rather than against the meshes, because the skirt
 * is what the player actually walks into. A block with a metre of clearance is
 * not a mass you can circle, it is a corner you get caught on, and a corner you
 * get caught on in a herding game is a death.
 *
 * Second, the elevation has to be REACHABLE and it has to be a loop rather than
 * a perch. A shelf with one way up is a place the player stands to be safe and
 * the horde queues at the bottom of, which is the exact failure MAP.md
 * catalogues in the Great Gallery: "go up and the only way down is back past
 * whatever followed you". So the terrace is entered by a ramp at each end and
 * the two ramps are thirty-one metres apart. Up one, along, down the other, and
 * the terrace is a leg of the circuit rather than a hiding place.
 *
 * WHY THE PLAYER CAN STAND ON THINGS OUT HERE AT ALL. A collider in this
 * codebase blocks whenever the actor's feet are within its height OF ITS BASE,
 * and a collider that declares no base is measured from the local floor - which
 * for anything standing on a terrace means it is measured from the terrace and
 * blocks forever. Everything in this file that can be climbed declares its base
 * explicitly and stops twenty centimetres short of the surface it carries, so
 * an actor standing on top is above it and an actor beside it is not. The
 * player and the mummies read that same rule from the same array, so there is
 * no surface here that one of them can use and the other cannot. That was the
 * requirement that killed the first draft, which used no bases at all and
 * produced a shelf the player could reach and nothing else could.
 */

import * as THREE from 'three';
import { cylinderUV } from './uv.js';

export const QUARRY = {
  /** Outer extents of the authored space, for the walkable backstop. */
  minX: 16.0, maxX: 41.0,
  minZ: -20.0, maxZ: 27.0,

  /** The boundary walls. */
  northZ: 26.0,
  southZ: -19.0,
  faceX: 39.6,          // the collider line of the bedrock face

  /** The terrace: a cut bench against the face, with a ramp at each end. */
  terrace: {
    xIn: 32.0,          // its west edge, where the retaining wall stands
    xOut: 38.4,         // where it dies into the face
    zSouth: -1.0,
    zNorth: 16.0,
    top: 2.6,
    rampRun: 7.0,
  },
};

/**
 * The four free blocks, half severed from the bedrock and left standing.
 *
 * Authored coordinates, not a placement loop. A loop would have to reject
 * against the clearance rule above and rejection costs draws, and every draw
 * taken in this file moves every draw after it - the constraint the whole of
 * courtyard.js is built around. Four numbers typed by hand cost nothing and
 * move nothing, which is the same argument the exterior canopic jar makes.
 */
const BLOCKS = [
  { x: 24.0, z: 19.0, w: 7.0, h: 1.7, d: 5.0, yaw: 0.06 },
  { x: 24.0, z: 10.0, w: 7.5, h: 2.9, d: 5.6, yaw: -0.09 },
  { x: 23.0, z: 0.5, w: 6.5, h: 4.3, d: 6.2, yaw: 0.13 },
  // The tallest one is pushed east and south of where it first stood, which was
  // (25.5, -11.5). A screenshot from inside the breach came back as a wall of
  // stone at half a metre: the talus at the one-way mouth runs six metres out
  // from x = 16.6 and the block's west face was at 21.5, so the ramp ended
  // INSIDE it. Nothing in the collider list or the deck list could have said
  // so - both were individually correct - and the only instrument that catches
  // a ramp landing in a rock is a picture taken from the ramp.
  { x: 28.0, z: -12.5, w: 7.0, h: 5.8, d: 5.0, yaw: -0.05 },
];

export function buildQuarry(ctx) {
  const {
    group, M, DENSITY, stone, slabMesh,
    addCollider, addWallRun, fillMass, addDeck, groundY, rand, FILL_R,
  } = ctx;

  const g = new THREE.Group();
  g.name = 'quarry';
  group.add(g);

  const T = QUARRY.terrace;
  const rampSouth = { z0: T.zSouth - T.rampRun, z1: T.zSouth };
  const rampNorth = { z0: T.zNorth, z1: T.zNorth + T.rampRun };

  // -------------------------------------------------------------------------
  // the bedrock face
  // -------------------------------------------------------------------------
  //
  // The east side of the yard is not a wall, it is the rock they were cutting
  // into, and it is built as three stepped masses rather than one slab so the
  // cut reads as courses taken off the top rather than as a cliff that happened
  // to be there. The steps recede eastward going up, which is the direction a
  // quarry face actually retreats.
  //
  // It is also the space's east boundary and it is nine units tall, which is
  // the number that matters: the outer perimeter stands seven units tall at
  // x = 52 and this has to hide its footing from a player standing at the
  // terrace rail. Backdrop is allowed to be cheap because it is out of reach,
  // and the price of putting a walkable space out here is a mass tall enough to
  // keep it out of reach.
  const FACE_STEPS = [
    { x0: 38.4, top: 3.4 },
    { x0: 41.0, top: 6.2 },
    { x0: 43.4, top: 9.0 },
  ];

  for (const step of FACE_STEPS) {
    const w = 4.6;
    const zLen = QUARRY.maxZ - QUARRY.minZ + 2;
    const body = stone(w, step.top + 2.0, zLen, M.limestone, DENSITY.limestone,
      { eroded: 0.13, chamfer: 0.2 });
    body.position.set(step.x0 + w / 2 - 0.4, (step.top + 2.0) / 2 - 2.0,
      (QUARRY.minZ + QUARRY.maxZ) / 2);
    g.add(body);
  }

  // ONE collider run for the whole face, at its westmost step. The steps above
  // are behind it and unreachable, so registering three runs would have been
  // three times the collision cost for a surface the player can only ever touch
  // in one place.
  addWallRun(QUARRY.faceX, (QUARRY.minZ + QUARRY.maxZ) / 2, 2.0, 9.0, 'z',
    QUARRY.maxZ - QUARRY.minZ, -1.0);

  // Cut marks on the working face: the vertical wedge slots the masons drove.
  // Thin, dark, and repeated, and they are the single cheapest thing in this
  // file that says "this is a quarry" rather than "this is a rock".
  for (let i = 0; i < 16; i++) {
    const z = QUARRY.minZ + 2.2 + i * 2.8;
    const y = 0.9 + (i % 3) * 1.1;
    const slot = slabMesh(0.5, 1.5 + (i % 2) * 0.7, 0.34, M.carved, DENSITY.carved);
    slot.position.set(38.2, y, z);
    g.add(slot);
  }

  // -------------------------------------------------------------------------
  // the terrace, and the two ramps that make it a loop
  // -------------------------------------------------------------------------
  //
  // The walkable surface is three deck records handed to the same sampler the
  // interior's ramps use: a rising wedge, a flat bench, a falling wedge. The
  // sampler gates every one of them on the actor's foot height plus a step, so
  // standing at the foot of the retaining wall does not teleport anybody up
  // onto it - they have to walk round to a ramp, exactly as they would have to
  // inside the pyramid.
  addDeck({
    x: (T.xIn + T.xOut) / 2, z: (rampSouth.z0 + rampSouth.z1) / 2,
    w: T.xOut - T.xIn, d: T.rampRun, y0: 0, y1: T.top,
  });
  addDeck({
    x: (T.xIn + T.xOut) / 2, z: (T.zSouth + T.zNorth) / 2,
    w: T.xOut - T.xIn, d: T.zNorth - T.zSouth, y0: T.top, y1: T.top,
  });
  addDeck({
    x: (T.xIn + T.xOut) / 2, z: (rampNorth.z0 + rampNorth.z1) / 2,
    w: T.xOut - T.xIn, d: T.rampRun, y0: T.top, y1: 0,
  });

  /**
   * A ramp mesh whose TOP FACE IS EXACTLY THE PLANE THE SAMPLER RETURNS.
   *
   * This is the one piece of arithmetic in the file worth spelling out, because
   * the obvious constructions are all wrong. Stacking slabs into a stair puts
   * the player's feet up to half a step above the stone they appear to be
   * standing on. Rotating a box and eyeballing its height leaves the same gap
   * with no honest number to check it against. So the box is placed by working
   * BACKWARD from where its top face has to be: rotate by the slope angle, then
   * offset the centre by half the thickness along the rotated up-vector, and
   * the top face lands on the plane by construction rather than by adjustment.
   *
   * Thickness is deliberately large. The underside has to be below the sand at
   * BOTH ends or the ramp shows daylight under its high end, which is the
   * "floating slab" read the perimeter pass spent a paragraph on.
   */
  const wedge = (x, z, w, d, y0, y1, thick, mat, density) => {
    const rise = y1 - y0;
    const len = Math.hypot(d, rise);
    const theta = Math.atan2(rise, d);

    const m = stone(w, thick, len, mat, density, { eroded: 0.08, chamfer: 0.14 });
    m.rotation.x = -theta;
    m.position.set(
      x,
      (y0 + y1) / 2 - (thick / 2) * Math.cos(theta),
      z + (thick / 2) * Math.sin(theta),
    );
    g.add(m);
    return m;
  };

  const rampMidX = (T.xIn + T.xOut) / 2;
  const rampW = T.xOut - T.xIn;

  wedge(rampMidX, (rampSouth.z0 + rampSouth.z1) / 2, rampW, T.rampRun,
    0, T.top, 5.2, M.limestone, DENSITY.limestone);
  wedge(rampMidX, (rampNorth.z0 + rampNorth.z1) / 2, rampW, T.rampRun,
    T.top, 0, 5.2, M.limestone, DENSITY.limestone);

  // The bench between them. Overlapped a little into both wedges, because two
  // chamfered members meeting on a shared plane leave a notch the width of both
  // their bevels, and along a walking surface that notch is a dark line the
  // player's feet visibly cross.
  {
    const d = (T.zNorth - T.zSouth) + 1.2;
    const body = stone(rampW, T.top + 3.0, d, M.limestone, DENSITY.limestone,
      { eroded: 0.1, chamfer: 0.16 });
    body.position.set(rampMidX, T.top - (T.top + 3.0) / 2, (T.zSouth + T.zNorth) / 2);
    g.add(body);
  }

  /**
   * The retaining wall, and the reason it is one run with a varying height.
   *
   * The terrace and its two ramps present one continuous cliff to the yard,
   * thirty-one metres long, standing at 2.6 in the middle and tapering to
   * nothing at both ends. Registering it as a single collider run at one height
   * would wall the ramps off at their feet and there would be no way up.
   * Registering nothing would let the player walk into the side of the wedge.
   *
   * So each cylinder in the run carries the deck height AT ITS OWN z, less a
   * margin. Below the deck it is solid; from on top of the deck every cylinder
   * within reach is already under your feet and skipped, including the ones
   * slightly uphill of you - which is what the margin is for and why it is 0.35
   * rather than the 0.2 the free blocks use. At a one-in-three slope a 0.2
   * margin leaves the uphill cylinder blocking, and the player walks up the
   * ramp and stops dead two thirds of the way.
   */
  const deckHeightAt = (z) => {
    if (z >= T.zSouth && z <= T.zNorth) return T.top;
    if (z > rampSouth.z0 && z < T.zSouth) {
      return T.top * (z - rampSouth.z0) / T.rampRun;
    }
    if (z > T.zNorth && z < rampNorth.z1) {
      return T.top * (rampNorth.z1 - z) / T.rampRun;
    }
    return 0;
  };

  {
    const zA = rampSouth.z0;
    const zB = rampNorth.z1;
    const r = 1.0;
    const step = r * 1.4;
    const n = Math.ceil((zB - zA) / step);

    for (let i = 0; i <= n; i++) {
      const z = zA + (i / n) * (zB - zA);
      const h = deckHeightAt(z) - 0.35;
      if (h <= 0.15) continue;
      addCollider(T.xIn, z, r, h, 0);
    }

    // And its face, so the collider has something to be. Built as separate
    // courses rather than one tapering slab, because a slab cannot taper: the
    // ramp ends need a wall that is 2.6 high in the middle and zero at both
    // ends, and courses of different heights standing side by side is how
    // masonry does that.
    const cw = 1.55;
    const cn = Math.ceil((zB - zA) / cw);
    for (let i = 0; i < cn; i++) {
      const z = zA + (i + 0.5) * cw;
      const h = deckHeightAt(z);
      if (h <= 0.2) continue;
      const course = stone(1.5, h + 1.6, cw + 0.1, M.carved, DENSITY.carved,
        { eroded: 0.07, chamfer: 0.1 });
      course.position.set(T.xIn - 0.35, h - (h + 1.6) / 2, z);
      g.add(course);
    }
  }

  // -------------------------------------------------------------------------
  // the four blocks
  // -------------------------------------------------------------------------
  //
  // Each one is a mass with its footprint sealed rather than a disc inscribed
  // in a square. A single cylinder inside a rectangle leaves all four corners
  // open, and an eight metre block with open corners is a block the player
  // walks into the middle of. `fillMass` lays overlapping cylinders across the
  // whole footprint for the same reason `addWallRun` lays them along a wall.
  //
  // The base is zero and the height stops twenty centimetres short of the top,
  // so anything that gets on top of one is above it. Nothing can today - none
  // of the ramps reach a block - but the rule costs nothing and the alternative
  // is a block that becomes unstandable the day something does reach it.
  for (const b of BLOCKS) {
    const body = stone(b.w, b.h + 1.2, b.d, M.limestone, DENSITY.limestone,
      { eroded: 0.11, chamfer: 0.18 });
    body.position.set(b.x, b.h - (b.h + 1.2) / 2, b.z);
    body.rotation.y = b.yaw;
    g.add(body);

    // The cut line: the slot the masons had driven round the block before they
    // stopped. It is what makes it HALF severed rather than a box sitting on
    // sand, and it is the detail that names the space.
    const collarH = 0.34;
    const collar = stone(b.w + 0.9, collarH, b.d + 0.9, M.carved, DENSITY.carved,
      { chamfer: 0.06 });
    collar.position.set(b.x, groundY(b.x, b.z) + collarH * 0.4, b.z);
    collar.rotation.y = b.yaw;
    g.add(collar);

    /*
     * SEAL TO THE STONE, NOT HALF A RADIUS PAST IT.
     *
     * `fillMass` overhangs the footprint it is given by FILL_R/2 on every side,
     * and its own comment says that is the wrong default "where the stone has a
     * face the player is meant to walk right up to and past". Four blocks
     * standing in the middle of a quarry floor are nothing BUT such faces: this
     * is the space the player runs a circuit in, and the circuit goes around
     * these.
     *
     * Measured before the change: the four blocks show 152 m2 of stone and
     * sealed 227 - 74.5 m2 of collision with nothing in it, against a quarry
     * whose largest connected run of open floor was 374 m2. A fifth of the
     * runnable space was invisible. The owner played it and said the quarry was
     * a mess to run in.
     *
     * The west terrace in courtyard.js has subtracted FILL_R since it was
     * written, for exactly this reason. This is the same call.
     */
    fillMass(b.x, b.z, b.w - FILL_R, b.d - FILL_R, b.h - 0.2, 0);

    // A wedge or two abandoned in the cut. Small, and against the block where
    // they cannot be walked into.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const wx = b.x + side * (b.w / 2 + 0.15);
      const wz = b.z + (rand() - 0.5) * b.d * 0.6;
      const peg = new THREE.Mesh(
        cylinderUV(new THREE.CylinderGeometry(0.11, 0.16, 0.7, 7), 0.16, 0.7, DENSITY.carved),
        M.carved,
      );
      peg.position.set(wx, groundY(wx, wz) + 0.3, wz);
      peg.rotation.z = side * 0.25;
      g.add(peg);
    }
  }

  // -------------------------------------------------------------------------
  // the sledges
  // -------------------------------------------------------------------------
  //
  // Timber sleds and their rollers, which is how the blocks left the yard. They
  // are the only wood in the exterior and they are here because the space is
  // otherwise entirely limestone, and a yard made of one material reads as one
  // object no matter how many pieces it is cut into.
  //
  // Their colliders are 1.35 high and not the 0.9 the geometry suggests. The
  // director's navigation grid ignores anything under 1.2 as "standable beside"
  // while the player's collision loop ignores nothing, so a sledge registered
  // at its real height is an obstacle the player walks into and the horde
  // believes is not there. Matching the two is worth more than the half metre.
  const SLEDGES = [
    { x: 20.6, z: 14.6, yaw: 0.5, laden: true },
    { x: 29.6, z: 4.2, yaw: -1.1, laden: false },
    { x: 20.0, z: -6.4, yaw: 2.2, laden: false },
  ];

  for (const s of SLEDGES) {
    const sled = new THREE.Group();
    sled.position.set(s.x, groundY(s.x, s.z), s.z);
    sled.rotation.y = s.yaw;

    for (const side of [-1, 1]) {
      const runner = slabMesh(0.42, 0.44, 5.4, M.palmTrunk, DENSITY.rubble);
      runner.position.set(side * 1.05, 0.22, 0);
      sled.add(runner);
    }
    for (let i = 0; i < 4; i++) {
      const tie = slabMesh(2.7, 0.3, 0.44, M.palmTrunk, DENSITY.rubble);
      tie.position.set(0, 0.55, -2.0 + i * 1.35);
      sled.add(tie);
    }

    if (s.laden) {
      const load = stone(2.4, 1.5, 3.6, M.limestone, DENSITY.limestone,
        { eroded: 0.09, chamfer: 0.12 });
      load.position.set(0, 1.45, -0.2);
      sled.add(load);
    }

    // Rollers, lying loose in front of the sled where they were pulled out.
    for (let i = 0; i < 3; i++) {
      const roller = new THREE.Mesh(
        cylinderUV(new THREE.CylinderGeometry(0.24, 0.24, 2.5, 8), 0.24, 2.5, DENSITY.rubble),
        M.palmTrunk,
      );
      roller.rotation.z = Math.PI / 2;
      roller.position.set(0, 0.24, 3.4 + i * 0.9);
      sled.add(roller);
    }

    g.add(sled);
    addWallRun(s.x, s.z, 1.25, s.laden ? 2.9 : 1.35,
      Math.abs(Math.cos(s.yaw)) > 0.5 ? 'z' : 'x', 4.4, 0);
  }

  // -------------------------------------------------------------------------
  // the boundary
  // -------------------------------------------------------------------------
  //
  // Spoil banks rather than masonry. This is the far end of a working yard, not
  // a temenos, and the two ends of it should read as what came out of the hole
  // rather than as something anybody built. They are still continuous runs with
  // overlapping cylinders, because a spoil bank the player can walk through is
  // a spoil bank the player walks through into forty metres of backdrop.
  for (const [zc, sign] of [[QUARRY.northZ, 1], [QUARRY.southZ, -1]]) {
    const len = QUARRY.faceX - QUARRY.minX + 2;
    const cx = (QUARRY.minX + QUARRY.faceX) / 2;

    let lo = Infinity;
    for (let i = 0; i <= 24; i++) lo = Math.min(lo, groundY(cx + (i / 24 - 0.5) * len, zc));

    const body = stone(len, 6.4, 3.4, M.limestone, DENSITY.limestone,
      { eroded: 0.2, chamfer: 0.22 });
    body.position.set(cx, lo - 1.6 + 3.2, zc + sign * 0.4);
    g.add(body);
    addWallRun(cx, zc, 1.7, 5.6, 'x', len, lo - 1.6);

    // Broken over the top so the bank does not read as a long box. Nine pieces
    // at three sizes, all of them ON the bank rather than at its foot, because
    // rubble at the foot is rubble the player snags on and rubble on the crest
    // is silhouette.
    for (let i = 0; i < 9; i++) {
      const x = QUARRY.minX + 1.5 + (i + rand() * 0.7) * (len - 4) / 9;
      const w = 1.3 + rand() * 2.4;
      const h = 1.0 + rand() * 2.0;
      const chunk = stone(w, h, w * 0.9, M.limestone, DENSITY.rubble, { eroded: 0.2 });
      chunk.position.set(x, lo + 3.1 + h * 0.3, zc + sign * (0.2 + rand() * 1.4));
      chunk.rotation.y = rand() * Math.PI;
      chunk.rotation.z = (rand() - 0.5) * 0.5;
      g.add(chunk);
    }
  }

  // Debris banked against the avenue's outer wall, which from in here is just
  // another rock face. Kept clear of the two mouths, which is why the z ranges
  // below are the ones they are: bay 1 at z = 22.5 is the way in and bay 5 at
  // z = -13.5 is the way out, and a chunk in either is a chunk in a doorway.
  for (const [z0, z1] of [[-6.0, 6.0], [12.5, 18.5]]) {
    for (let i = 0; i < 5; i++) {
      const z = z0 + rand() * (z1 - z0);
      const x = QUARRY.minX + 1.0 + rand() * 2.6;
      const w = 1.2 + rand() * 2.0;
      const h = 0.9 + rand() * 1.7;
      const chunk = stone(w, h, w * 1.05, M.limestone, DENSITY.rubble, { eroded: 0.19 });
      chunk.position.set(x, groundY(x, z) + h * 0.35, z);
      chunk.rotation.y = rand() * Math.PI;
      chunk.rotation.z = (rand() - 0.5) * 0.45;
      g.add(chunk);
      addCollider(x, z, w * 0.45, h, groundY(x, z));
    }
  }

  return {
    group: g,
    bounds: { minX: QUARRY.minX, maxX: QUARRY.maxX, minZ: QUARRY.minZ, maxZ: QUARRY.maxZ },
  };
}
