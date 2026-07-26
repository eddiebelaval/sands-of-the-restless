/**
 * The Necropolis Courtyard: the spawn area, and the only exterior space.
 *
 * Everything registers a cylindrical collider into one flat array. Every later
 * system (player, enemies, projectiles) resolves against that same array, so
 * collision has exactly one representation in the codebase.
 *
 * Geometry is created through the helpers in ./uv.js so texture density is
 * constant in world units. Building a box directly here is a bug: it will get
 * one texture tile stretched across whatever size it happens to be.
 */

import * as THREE from 'three';
import { buildMaterials } from './materials.js';
import { box, plane, cylinderUV } from './uv.js';
import { chamferedBox, erode, duneField } from './geometry.js';
import { buildScatter } from './scatter.js';
import { dressAvenue } from './dressing.js';

/** Tiles per world unit, per surface. Roughly one masonry course per metre. */
const DENSITY = {
  limestone: 0.17,
  // Measured, not guessed. A UV probe over the shipped scene reported the
  // chamfered boxes on this material at 0.196-0.200 tiles/unit and the
  // cylinders at 0.266-0.313, so the two were never far apart in tiles/unit.
  // What made the cylinders read as untextured was the SCALE of the scan
  // behind this role: `carved` is backed by rock023, whose features are metres
  // across, so at 0.20 one 1K tile spanned five metres and smeared over a nine
  // metre shaft. 0.32 puts the same grain at roughly one tile per three metres,
  // which is stone-sized. Boxes and cylinders both move, so they stay matched.
  carved: 0.32,
  granite: 0.30,
  sand: 0.22,
  gold: 0.5,
  // Small rubble needs a higher density than large walls. At 0.17 a 2-unit
  // chunk gets a third of a tile, which shows as one absurdly oversized block.
  rubble: 0.45,
};

/**
 * Avenue extents. Declared up here because the colonnade, the terrace, and the
 * near-field dressing all need to know where the walls are, and they are built
 * before the walls themselves.
 */
const AVENUE = {
  halfWidth: 15,     // walls stand at x = +/- 15
  zNear: 36,         // behind the spawn point
  zFar: -30,         // at the portal
  height: 13,
};

const BAY = 9;       // spacing of buttress pylons and wall bays

/** Half-extent of the outer perimeter. */
const WALL = 52;

/**
 * Disc UVs in world units.
 *
 * CircleGeometry maps its bounding square to 0..1, so an untouched disc gets
 * exactly one tile no matter how big it is. Same failure mode as an untouched
 * box, and the reason the sun-disc measured 0.294 tiles/unit against the 0.5
 * of the gilded cornice directly above it.
 */
function discUV(geo, radius, tilesPerUnit) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;

  const s = radius * 2 * tilesPerUnit;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s);

  uv.needsUpdate = true;
  return geo;
}

/** Deterministic PRNG so the courtyard is identical every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildCourtyard(scene) {
  const M = buildMaterials();
  const rand = rng(20260725);

  const group = new THREE.Group();
  group.name = 'courtyard';
  scene.add(group);

  /**
   * The spawn point, and the radius that must stay clear of scattered props.
   * Declared before anything is placed so every placement loop can test it.
   */
  const SPAWN = { x: 0, z: 30 };
  const SPAWN_CLEARANCE = 9;

  /** { x, z, r, h } cylinders. The single source of truth for collision. */
  const colliders = [];
  const addCollider = (x, z, r, h = 4) => colliders.push({ x, z, r, h });

  /**
   * Seal a straight wall run with overlapping cylinders.
   *
   * The collision model is a flat list of cylinders, which is fine for posts
   * and rubble but wrong for a wall: registering one cylinder per 9-unit bay
   * leaves gaps wider than the player and the enclosure silently stops
   * enclosing. Spacing is derived from the radius so the run can never
   * un-seal if either is retuned.
   */
  const addWallRun = (x, z, r, h, axis, length) => {
    const step = r * 1.4;                       // < 2r, so consecutive discs overlap
    const n = Math.max(2, Math.ceil(length / step));
    for (let i = 0; i <= n; i++) {
      const t = (i / n - 0.5) * length;
      addCollider(axis === 'z' ? x : x + t, axis === 'z' ? z + t : z, r, h);
    }
  };

  /**
   * A cut stone block: chamfered edges, optional erosion, world-scale UVs.
   *
   * Chamfer scales with the block so a 60-unit pyramid step and a 2-unit piece
   * of rubble both read as stone rather than one reading as a rounded pillow.
   */
  const stone = (w, h, d, mat, density, { eroded = 0, chamfer = null } = {}) => {
    const c = chamfer ?? Math.min(0.11, Math.min(w, h, d) * 0.055);
    const geo = chamferedBox(w, h, d, c, density);
    if (eroded > 0) erode(geo, eroded, 1.1, (w * 7 + h * 13 + d * 3) % 97);

    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // Kept for flat trim where a chamfer would be invisible and only cost verts.
  const slabMesh = (w, h, d, mat, density) => {
    const m = new THREE.Mesh(box(w, h, d, density), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // -------------------------------------------------------------------------
  // ground
  // -------------------------------------------------------------------------

  // Dunes, not a plane. A perfectly flat floor is unmistakably synthetic, and
  // the swells also give the low sun something to rake across.
  const dunes = duneField(420, 160, DENSITY.sand, { amplitude: 1.25, seed: 7 });
  const ground = new THREE.Mesh(dunes.geometry, M.sand);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // -------------------------------------------------------------------------
  // the pyramid: the destination, visible from spawn
  // -------------------------------------------------------------------------

  const pyramid = new THREE.Group();
  pyramid.position.set(0, 0, -62);
  group.add(pyramid);

  const STEPS = 11;
  for (let i = 0; i < STEPS; i++) {
    const w = 62 - i * 5.2;
    const h = 3.8;

    // Each course is nudged off true and eroded. Eleven perfectly aligned
    // identical boxes is the other half of the "voxel game" read: real
    // masonry has settled, and settled courses are never flush.
    const step = stone(w, h, w, M.limestone, DENSITY.limestone,
      { eroded: 0.10, chamfer: 0.24 });
    step.position.set(
      (rand() - 0.5) * 0.5,
      h * 0.5 + i * h,
      (rand() - 0.5) * 0.5
    );
    step.rotation.y = (rand() - 0.5) * 0.012;
    pyramid.add(step);
  }
  addCollider(0, -62, 32, 44);

  // -------------------------------------------------------------------------
  // the sealed doorway: the 1000g gate into the interior (M2)
  // -------------------------------------------------------------------------

  const portal = new THREE.Group();
  portal.position.set(0, 0, -30.2);
  group.add(portal);

  // Battered (sloped) jambs, which is what actually reads as Egyptian rather
  // than merely rectangular.
  for (const side of [-1, 1]) {
    // Open-ended. cylinderUV scales the CAP uvs by the SIDE's factors - u by
    // circumference, v by height - which is meaningless on a disc and is what
    // inflated the measured whole-mesh density of every cylinder in the scene.
    // These jambs meet the ground below and the lintel above, so the caps were
    // never visible; dropping them makes the measured density exactly the side
    // density, which is the number that has to match the boxes.
    const jamb = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(1.0, 1.5, 9.5, 4, 1, true), 1.5, 9.5, DENSITY.carved),
      M.carved
    );
    jamb.position.set(side * 3.6, 4.75, 0);
    jamb.rotation.y = Math.PI / 4;
    jamb.castShadow = true;
    jamb.receiveShadow = true;
    portal.add(jamb);
    addCollider(side * 3.6, -30.2, 1.4, 9.5);
  }

  const lintel = stone(11, 2.2, 3.0, M.carved, DENSITY.carved, { eroded: 0.03 });
  lintel.position.set(0, 10.6, 0);
  portal.add(lintel);

  // A winged sun-disc over the door: the one piece of real gold at ground
  // level, so the eye lands on the entrance from across the yard.
  const cornice = stone(11.6, 1.1, 3.4, M.gold, DENSITY.gold, { chamfer: 0.07 });
  cornice.position.set(0, 12.1, 0);
  portal.add(cornice);

  const slab = stone(6.0, 8.6, 1.0, M.granite, DENSITY.granite, { chamfer: 0.09 });
  slab.position.set(0, 4.3, 0.4);
  slab.name = 'sealed-doorway';
  portal.add(slab);

  const disc = new THREE.Mesh(
    discUV(new THREE.CircleGeometry(1.7, 32), 1.7, DENSITY.gold), M.gold);
  disc.position.set(0, 5.6, 0.92);
  portal.add(disc);

  addCollider(0, -30.2, 3.2, 9);

  // -------------------------------------------------------------------------
  // colonnade framing the approach
  // -------------------------------------------------------------------------

  //
  // Deliberately NOT mirrored. A bilaterally symmetric avenue reads as a
  // corridor in a tech demo: once the eye has parsed the left half it gets the
  // right half for free and stops looking. The two sides now differ in three
  // ways at once - the west colonnade stands on a raised terrace, the east
  // stands on sand and is half collapsed, and the two rhythms are offset by a
  // third of a bay so no two columns ever line up across the avenue.

  const COL_H = 9;
  const COL_R_BOT = 1.32;
  const COL_R_TOP = 1.15;
  const DRUMS = 4;
  const DRUM_H = COL_H / DRUMS;

  /**
   * A column shaft as a stack of drums, which is how one was actually built.
   *
   * Each drum's bottom radius is flared slightly past the top radius of the
   * drum below it, so every joint is a real overhanging lip that catches its
   * own shadow rather than a line painted into the albedo. This is the cheapest
   * geometric relief available: no extra meshes at all, one crisp horizontal
   * every 2.2 metres, and it breaks what was a nine-metre smear of a single
   * rock scan into four separately-oriented pieces.
   *
   * Open-ended, because a drum's caps are buried in its neighbours, and because
   * cylinderUV scales cap UVs by the SIDE's factors (u by circumference, v by
   * height), which is meaningless on a disc and was inflating the measured
   * density of every closed cylinder in the scene.
   *
   * @param {number} frac  how much of the shaft survives, 0..1
   */
  const shaftDrums = (frac = 1) => {
    const g = new THREE.Group();
    const n = Math.max(1, Math.round(DRUMS * frac));
    const LIP = 0.055;

    for (let d = 0; d < n; d++) {
      const t0 = d / DRUMS, t1 = (d + 1) / DRUMS;
      const rBot = COL_R_BOT + (COL_R_TOP - COL_R_BOT) * t0;
      const rTop = COL_R_BOT + (COL_R_TOP - COL_R_BOT) * t1;

      const m = new THREE.Mesh(
        cylinderUV(
          new THREE.CylinderGeometry(rTop, rBot + LIP, DRUM_H, 20, 1, true),
          rBot, DRUM_H, DENSITY.carved),
        M.carved
      );
      m.position.y = DRUM_H * (d + 0.5);
      // A quarter turn of jitter per drum. Quarried drums were never seated on
      // a common seam, and it stops the scan repeating identically up the shaft.
      m.rotation.y = rand() * Math.PI * 0.5;
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    return g;
  };

  /** Papyrus-bud capital plus its abacus, as one reusable assembly. */
  const capital = () => {
    const g = new THREE.Group();

    const bell = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(1.8, 1.05, 2.0, 20, 1, true), 1.8, 2.0,
        DENSITY.carved),
      M.carved
    );
    bell.position.y = 1.0;
    bell.castShadow = true;
    bell.receiveShadow = true;
    g.add(bell);

    const abacus = stone(3.5, 0.75, 3.5, M.limestone, DENSITY.limestone, { chamfer: 0.08 });
    abacus.position.y = 2.35;
    g.add(abacus);

    return g;
  };

  // --- west terrace ---------------------------------------------------------
  // A raised stylobate under the west colonnade only. One side of the avenue is
  // now a metre and a third higher than the other, which is the single loudest
  // asymmetry available for the cost: it changes the horizon line, the shadow
  // pattern, and the width of the walkable floor all at once.
  const TERRACE = { xIn: -9.4, xOut: -15.2, zNear: -1.5, zFar: -47, h: 1.35 };
  const tW = TERRACE.xIn - TERRACE.xOut;
  const tL = TERRACE.zNear - TERRACE.zFar;
  const tX = (TERRACE.xIn + TERRACE.xOut) / 2;
  const tZ = (TERRACE.zNear + TERRACE.zFar) / 2;

  // Two courses rather than one slab, the upper inset, so the terrace edge is a
  // real step profile instead of a painted line.
  const terraceBase = stone(tW, 0.62, tL, M.limestone, DENSITY.limestone,
    { eroded: 0.05, chamfer: 0.1 });
  terraceBase.position.set(tX, 0.20, tZ);
  group.add(terraceBase);

  const terraceTop = stone(tW - 0.9, 0.78, tL - 0.6, M.limestone, DENSITY.limestone,
    { eroded: 0.05, chamfer: 0.1 });
  terraceTop.position.set(tX + 0.2, 0.92, tZ);
  group.add(terraceTop);

  addWallRun(tX, tZ, tW * 0.5, TERRACE.h, 'z', tL);

  for (const side of [-1, 1]) {
    const west = side < 0;

    // Offset the east rhythm by a third of a bay. Two facing rows on the same
    // z are what makes an avenue read as a mirror.
    const z0 = west ? -4 : -6.4;
    const baseY = west ? TERRACE.h : 0;

    for (let i = 0; i < 7; i++) {
      const x = side * 13;
      const z = z0 - i * 7;

      // The east colonnade has come down. Two columns are on the ground and one
      // is snapped at chest height, so that side reads as ruin and the west
      // reads as intact temple.
      const toppled = !west && (i === 2 || i === 4);
      const snapped = !west && i === 5;

      const col = new THREE.Group();
      col.position.set(x, baseY, z);

      const base = stone(3.3, 0.65, 3.3, M.limestone, DENSITY.limestone, { chamfer: 0.08 });
      base.position.y = 0.32;
      col.add(base);

      if (toppled) {
        // A fallen shaft: the drums have rolled off the base and lie in a line
        // across the floor. Horizontal cylinders at knee height are exactly the
        // kind of mid-scale occluder the avenue floor has none of.
        const dir = i === 2 ? 1 : -1;
        for (let d = 0; d < DRUMS; d++) {
          const drum = new THREE.Mesh(
            cylinderUV(
              new THREE.CylinderGeometry(COL_R_TOP, COL_R_BOT, DRUM_H, 16, 1, true),
              COL_R_BOT, DRUM_H, DENSITY.carved),
            M.carved
          );
          // Rolled apart, so the stack reads as collapsed rather than as a log.
          const spread = 1.0 + d * (DRUM_H + 0.35) + rand() * 0.4;
          drum.position.set(
            x - side * spread * 0.72,
            COL_R_BOT * 0.86,
            z + dir * spread * 0.7
          );
          drum.rotation.z = Math.PI / 2;
          drum.rotation.y = dir * 0.8 + (rand() - 0.5) * 0.4;
          drum.castShadow = true;
          drum.receiveShadow = true;
          col.add(drum);
          addCollider(x - side * spread * 0.72, z + dir * spread * 0.7, 1.25, 2.2);
        }

        // The capital lands face down at the end of the run.
        const cap = capital();
        cap.position.set(x - side * 4.6, 1.5, z + dir * 4.4);
        cap.rotation.z = Math.PI * 0.52;
        cap.rotation.y = dir * 0.6;
        col.add(cap);
        addCollider(x - side * 4.6, z + dir * 4.4, 1.8, 3);

        group.add(col);
        addCollider(x, z, 1.7, 1.2);
        continue;
      }

      const frac = snapped ? 0.5 : 1;
      col.add(shaftDrums(frac));

      if (!snapped) {
        const cap = capital();
        cap.position.y = COL_H;
        col.add(cap);
      } else {
        // A jagged crown on the break, so the stub does not read as a column
        // that was simply built short.
        const crown = stone(2.5, 0.55, 2.5, M.carved, DENSITY.carved, { eroded: 0.22 });
        crown.position.set((rand() - 0.5) * 0.4, COL_H * 0.5 + 0.2, (rand() - 0.5) * 0.4);
        crown.rotation.y = rand();
        crown.rotation.z = (rand() - 0.5) * 0.12;
        col.add(crown);
      }

      group.add(col);
      addCollider(x, z, 1.5, snapped ? 5 : 11);
    }
  }

  // -------------------------------------------------------------------------
  // obelisks
  // -------------------------------------------------------------------------

  // A matched pair on the centreline is the most symmetric object a temple
  // yard can have, so this pair is not matched: one stands, one is down. The
  // standing one is also pushed off the axis and off its partner's z, so a
  // frame down the avenue never brackets the pyramid evenly.
  const OBELISKS = [
    { x: -9.5, z: -20.5, h: 16.0, fallen: false },
    { x: 10.8, z: -13.5, h: 12.5, fallen: true },
  ];

  for (const ob of OBELISKS) {
    const g = new THREE.Group();
    g.position.set(ob.x, 0, ob.z);

    const rBot = 1.05, rTop = 0.78;

    // Slightly tapered, as a real obelisk is. Open-ended: the plinth covers the
    // foot and the pyramidion covers the head.
    const shaft = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(rTop, rBot, ob.h, 4, 1, true),
        rBot, ob.h, DENSITY.carved),
      M.carved
    );
    shaft.rotation.y = Math.PI / 4;
    shaft.castShadow = true;
    shaft.receiveShadow = true;

    // Gilded pyramidion. Genuinely bright, which gives the bloom pass
    // something legitimate to work with instead of blooming the whole frame.
    // ConeGeometry shares CylinderGeometry's UV layout, so the same world-scale
    // pass applies; untouched it carried one tile over the whole cap while the
    // gilded cornice beside it carried half a tile per unit.
    const cap = new THREE.Mesh(
      cylinderUV(new THREE.ConeGeometry(1.12, 2.2, 4, 1, true), 1.12, 2.2, DENSITY.gold),
      M.gold
    );
    cap.rotation.y = Math.PI / 4;
    cap.castShadow = true;

    const plinth = stone(3.2, 1.1, 3.2, M.limestone, DENSITY.limestone, { chamfer: 0.09 });
    plinth.position.y = 0.55;
    g.add(plinth);

    if (ob.fallen) {
      // Down, and lying at an angle to the avenue, so it crosses the frame
      // diagonally instead of adding another line parallel to the walls.
      const yaw = 0.62;
      shaft.rotation.set(Math.PI / 2, 0, 0);
      shaft.position.set(0, rBot + 0.35, 0);
      cap.rotation.set(Math.PI / 2, 0, 0);
      cap.position.set(0, rBot + 0.35, -(ob.h / 2 + 1.1));

      const fall = new THREE.Group();
      fall.rotation.y = yaw;
      fall.add(shaft, cap);
      g.add(fall);

      // Colliders along the shaft, so it is a real obstacle to slide along.
      for (let i = -2; i <= 3; i++) {
        const t = i * (ob.h / 6);
        addCollider(ob.x - Math.sin(yaw) * t, ob.z - Math.cos(yaw) * t, 1.35, 2.6);
      }
    } else {
      shaft.position.y = ob.h / 2 + 1.1;
      cap.position.y = ob.h + 2.2;
      g.add(shaft, cap);
      addCollider(ob.x, ob.z, 1.5, ob.h + 2);
    }

    group.add(g);
  }

  // -------------------------------------------------------------------------
  // the processional avenue: ENCLOSURE
  // -------------------------------------------------------------------------
  //
  // This is the single biggest change to how the scene reads, and it is level
  // design rather than a rendering technique.
  //
  // An open plane with objects standing on it is what a voxel sandbox looks
  // like. A corridor with layered occlusion at three scale tiers is what a
  // shooter looks like. Nothing about the geometry primitive changes here: the
  // same chamfered box that read as "blocky" in an open plaza reads as
  // architecture once it encloses the player, overlaps its neighbours, and has
  // something thin silhouetted in front of it.
  //
  // So: tall flanking walls with buttress pylons, recessed side chapels that
  // give the walls depth instead of making a tunnel, and architraves spanning
  // overhead so the frame is layered vertically as well as horizontally.

  const bays = Math.round((AVENUE.zNear - AVENUE.zFar) / BAY);

  // Which bays open into a side chapel rather than solid wall. Recesses stop
  // the avenue reading as a corridor of two flat slabs.
  //
  // Different sets per side. When both walls opened at the same z the recesses
  // cancelled out: the frame stayed symmetric and the alcoves only widened the
  // corridor rather than reading as rooms off it. Staggered, each recess is
  // read against solid wall opposite, which is what gives it depth.
  const CHAPEL_BAYS = {
    '-1': new Set([1, 4, 6]),
    '1': new Set([2, 3, 7]),
  };

  /** Focal points inside each recess, handed to the dressing pass. */
  const chapelSpots = [];

  /**
   * Per-bay wall height, keyed `${side}:${bay}`.
   *
   * The bays vary in height and some are ruined to a stub, which is good for
   * the silhouette. But anything that SPANS between walls has to know where the
   * wall actually is: an architrave placed at a fixed height over a bay that
   * got ruined to 3 units is a stone beam floating in mid air with nothing
   * holding it up, which is exactly what made the frame read as half rendered.
   */
  const bayHeight = new Map();

  for (const side of [-1, 1]) {
    for (let b = 0; b < bays; b++) {
      const z = AVENUE.zNear - b * BAY - BAY / 2;
      const x = side * AVENUE.halfWidth;
      const isChapel = CHAPEL_BAYS[side].has(b);

      // The east wall has taken a hit across two bays. A single localised
      // collapse is worth more than evenly-distributed damage: even damage
      // averages back out to a symmetric wall, one breach does not.
      const breached = side > 0 && (b === 3 || b === 4);

      // A few bays are ruined down to a stub, so the sun rakes through and the
      // silhouette against the sky is broken rather than a level parapet. Even
      // the intact bays vary in height now: eight bays cut to exactly the same
      // number is the flat horizontal the whole enclosure was reading as.
      const ruined = breached || rand() < 0.18;
      // Intact bays vary only slightly. The wider spread the critics asked for
      // broke the wall into disconnected slabs at eight different heights,
      // which reads as unfinished rather than as varied.
      const h = ruined
        ? AVENUE.height * (0.26 + rand() * 0.26)
        : AVENUE.height * (0.96 + rand() * 0.06);

      bayHeight.set(`${side}:${b}`, { h, ruined });

      if (isChapel) {
        // Recessed alcove: the wall steps back, with a jamb either side. This
        // gives the eye somewhere to travel into, and puts real depth on a
        // surface that would otherwise be flat.
        const DEPTH = 7;

        for (const j of [-1, 1]) {
          const jamb = stone(3.0, h, 2.2, M.carved, DENSITY.carved, { eroded: 0.05 });
          jamb.position.set(x + side * 1.2, h / 2, z + j * (BAY / 2 - 1.1));
          group.add(jamb);
          addCollider(x + side * 1.2, z + j * (BAY / 2 - 1.1), 1.6, h);
        }

        // The chapel's back wall, set back from the avenue line.
        const back = stone(2.0, h * 0.82, BAY - 1.2, M.limestone, DENSITY.limestone,
          { eroded: 0.07 });
        back.position.set(x + side * DEPTH, h * 0.41, z);
        group.add(back);
        addWallRun(x + side * DEPTH, z, 1.5, h * 0.82, 'z', BAY - 1.2);

        // Side returns, closing the alcove into a room rather than a notch.
        for (const j of [-1, 1]) {
          const ret = stone(DEPTH, h * 0.82, 1.6, M.limestone, DENSITY.limestone);
          ret.position.set(x + side * (DEPTH / 2), h * 0.41, z + j * (BAY / 2 - 0.4));
          group.add(ret);
          addWallRun(x + side * (DEPTH / 2), z + j * (BAY / 2 - 0.4),
            1.2, h * 0.82, 'x', DEPTH);
        }

        // A lintel over the opening ties the alcove back into the wall line and
        // frames whatever stands inside it.
        const lint = stone(3.4, 1.5, BAY - 0.6, M.carved, DENSITY.carved);
        lint.position.set(x + side * 1.2, h - 0.75, z);
        group.add(lint);

        // Close the wall above the lintel back up to the bay height. Without
        // this the alcove opening runs clear to the top of the wall and the
        // lintel reads as a floating slab rather than as a header.
        const above = stone(3.0, 1.4, BAY - 0.6, M.limestone, DENSITY.limestone,
          { chamfer: 0.1 });
        above.position.set(x + side * 1.2, h + 0.7, z);
        group.add(above);

        chapelSpots.push({ x: x + side * (DEPTH - 2.2), z, side });

      } else {
        const w = stone(2.6, h, BAY + 0.4, M.limestone, DENSITY.limestone,
          { eroded: 0.07, chamfer: 0.14 });
        w.position.set(x, h / 2, z);
        group.add(w);
        addWallRun(x, z, 1.7, h, 'z', BAY + 0.4);

        if (!ruined) {
          const cap = stone(3.3, 0.8, BAY + 0.8, M.limestone, DENSITY.limestone,
            { chamfer: 0.1 });
          cap.position.set(x, h + 0.4, z);
          group.add(cap);
        }

        // Hero surfaces only: the two bays either side of the spawn point are
        // the masonry the player stands closest to for the whole opening shot.
        // Joints there are projecting string courses with real thickness, not
        // lines in the albedo, so they hold a shadow when the sun rakes along
        // the wall and they still exist when the normal map flattens out at a
        // grazing angle. Three courses per bay is the whole cost.
        if (b <= 1) {
          for (let c = 0; c < 3; c++) {
            // All three sit ABOVE eye height. A course below the eye presents
            // its top face to the camera, and at the 0.3 metres the collider
            // lets the player get to a wall, a 0.16 deep ledge seen at a
            // grazing angle spreads across half the frame. Above the eye the
            // same course shows its underside and the shadow it throws, which
            // is the read that was wanted in the first place.
            const cy = 2.9 + c * 2.5;
            if (cy > h - 1) break;

            // Projection is 0.16, not the 0.45 it started at. The player can be
            // pushed to within 0.4 metres of this wall, and at that range a
            // course that stands nearly half a metre proud is a shelf across
            // the whole frame rather than a joint in a wall.
            const band = stone(2.85, 0.26, BAY + 0.5, M.limestone, DENSITY.limestone,
              { chamfer: 0.06 });
            band.position.set(x - side * 0.04, cy, z + (rand() - 0.5) * 0.1);
            group.add(band);
          }
        }
      }

      // Buttress pylon on the avenue face at every bay joint. These give the
      // wall a rhythm and, more importantly, OVERLAP the wall behind them.
      // Overlapping silhouettes are most of what separates a built space from
      // objects standing apart on a plane.
      //
      // Not at bay 0: that one sits inside the end wall, so it added nothing to
      // the silhouette and only closed a pocket the player could wedge into
      // with a shadowed slab a hand's width from the lens.
      if (b === 0) continue;

      const py = stone(1.9, h * 0.88, 1.9, M.carved, DENSITY.carved, { eroded: 0.05 });
      py.position.set(x - side * 1.5, h * 0.44, z + BAY / 2);
      py.rotation.y = (rand() - 0.5) * 0.02;
      group.add(py);
      addCollider(x - side * 1.5, z + BAY / 2, 1.2, h * 0.88);

      // What came off the wall has to be somewhere. A breach with clean sand at
      // its foot reads as a wall that was built short, not one that fell.
      if (breached) {
        for (let i = 0; i < 5; i++) {
          const bw = 1.5 + rand() * 2.4;
          const bh = 1.0 + rand() * 1.9;
          const bd = 1.4 + rand() * 2.0;
          const bx = x - side * (1.2 + rand() * 5.5);
          const bz = z + (rand() - 0.5) * (BAY - 1);

          const chunk = stone(bw, bh, bd, M.limestone, DENSITY.rubble, { eroded: 0.16 });
          chunk.position.set(bx, bh * 0.42, bz);
          chunk.rotation.y = rand() * Math.PI;
          chunk.rotation.z = (rand() - 0.5) * 0.45;
          chunk.rotation.x = (rand() - 0.5) * 0.3;
          group.add(chunk);
          addCollider(bx, bz, Math.max(bw, bd) * 0.45, bh);
        }
      }
    }
  }

  // Close the near end behind the spawn, so the avenue is a room with one exit
  // rather than a corridor open at both ends.
  //
  // Four bays and a gateway, not one thirty-three metre slab. The slab drew yet
  // another dead level horizontal, and because the sun has a +Z component every
  // square metre of its avenue face was in shadow: back up to it and half the
  // frame went to unlit stone. Broken into bays at four different heights with
  // a gate through the middle, the silhouette steps and the gap lets sky and
  // desert through behind the player. The gate is choked with fallen masonry,
  // so the avenue is still a room with one exit.
  const END_Z = AVENUE.zNear + 1;
  const END_BAYS = [
    { x: -11.5, w: 10.0, h: AVENUE.height * 1.03 },
    { x: -4.85, w: 3.3, h: AVENUE.height * 0.72 },
    { x: 5.10, w: 3.8, h: AVENUE.height * 0.83 },
    { x: 11.75, w: 9.5, h: AVENUE.height * 0.95 },
  ];

  for (const bay of END_BAYS) {
    const w = stone(bay.w, bay.h, 2.6, M.limestone, DENSITY.limestone, { eroded: 0.07 });
    w.position.set(bay.x, bay.h / 2, END_Z);
    group.add(w);
    addWallRun(bay.x, END_Z, 1.7, bay.h, 'x', bay.w);

    const cap = stone(bay.w + 0.5, 0.7, 3.1, M.limestone, DENSITY.limestone,
      { chamfer: 0.1 });
    cap.position.set(bay.x, bay.h + 0.35, END_Z);
    group.add(cap);
  }

  // Lintel over the gate, so the opening reads as a doorway rather than as a
  // missing piece of wall.
  const gateLintel = stone(7.4, 1.6, 2.9, M.carved, DENSITY.carved, { eroded: 0.05 });
  gateLintel.position.set(0, 9.9, END_Z);
  group.add(gateLintel);

  // Fallen masonry choking the gate. Blocks the way, but lets light past.
  for (let i = 0; i < 4; i++) {
    const bw = 1.7 + rand() * 1.6;
    const bh = 1.4 + rand() * 1.7;
    const bx = (rand() - 0.5) * 5.4;
    const bz = END_Z - 1.2 - rand() * 1.6;

    const chunk = stone(bw, bh, bw * 0.9, M.limestone, DENSITY.rubble, { eroded: 0.16 });
    chunk.position.set(bx, bh * 0.44, bz);
    chunk.rotation.y = rand() * Math.PI;
    chunk.rotation.z = (rand() - 0.5) * 0.4;
    group.add(chunk);
    addCollider(bx, bz, bw * 0.55, bh + 1.4);
  }

  // A talus of debris along the foot of the end wall. A wall meeting clean sand
  // is the "clean corner" tell, and it also keeps the player a couple of metres
  // off the masonry rather than letting them wedge their lens into it.
  for (let i = 0; i < 9; i++) {
    const tx = -15 + (i + rand() * 0.6) * 3.4;
    if (Math.abs(tx) < 4.4) continue;      // leave the gate mouth clear

    const tw = 1.8 + rand() * 2.3;
    const th = 1.3 + rand() * 1.5;
    const tz = END_Z - 2.4 - rand() * 1.3;

    const chunk = stone(tw, th, tw * 0.8, M.limestone, DENSITY.rubble, { eroded: 0.17 });
    chunk.position.set(tx, th * 0.4, tz);
    chunk.rotation.y = rand() * Math.PI;
    chunk.rotation.z = (rand() - 0.5) * 0.35;
    group.add(chunk);
    addCollider(tx, tz, Math.max(1.5, tw * 0.55), th + 0.9);
  }

  // --- architraves spanning the avenue --------------------------------------
  // Overhead structure is the vertical half of enclosure. Without it the player
  // is standing in a trench; with it they are inside a building.
  //
  // A beam is only placed where BOTH flanking bays are intact and tall enough
  // to carry it, and it is seated at the LOWER of the two walls it lands on.
  // Spanning a ruined bay leaves the beam hanging in air, which is worse than
  // having no beam at all.
  for (let b = 1; b < bays - 1; b++) {
    const west = bayHeight.get(`-1:${b}`);
    const east = bayHeight.get(`1:${b}`);
    if (!west || !east || west.ruined || east.ruined) continue;

    const z = AVENUE.zNear - b * BAY - BAY / 2;
    const seat = Math.min(west.h, east.h) - 1.1;

    const beam = stone(AVENUE.halfWidth * 2 + 3, 1.8, 2.6, M.carved, DENSITY.carved,
      { eroded: 0.04 });
    beam.position.set(0, seat, z);
    group.add(beam);

    // A second, thinner course above and offset, so the span has depth in
    // profile instead of reading as one slab.
    const upper = stone(AVENUE.halfWidth * 2 + 1.4, 0.9, 1.6, M.limestone, DENSITY.limestone);
    upper.position.set(0, seat + 1.35, z - 0.4);
    group.add(upper);

    // Corbels where the beam meets each wall. Without them the beam appears to
    // pass through the wall rather than rest on it, and the joint is the exact
    // place the eye checks to decide whether a structure is real.
    for (const side of [-1, 1]) {
      const corbel = stone(2.6, 1.0, 3.4, M.carved, DENSITY.carved, { chamfer: 0.12 });
      corbel.position.set(side * (AVENUE.halfWidth - 0.9), seat - 1.2, z);
      group.add(corbel);
    }
  }

  // --- outer perimeter ------------------------------------------------------
  // Kept so the arena still has a hard edge, but pushed well beyond the avenue
  // so it is the avenue walls that actually enclose the player.
  // Deliberately low: 6 units against the avenue's 13. Two wall lines at
  // similar heights read as one confused silhouette, and the avenue is the one
  // that should be doing the enclosing.
  //
  // Built per bay rather than as one extruded box. Three boxes of identical
  // height drew one dead level horizontal straight across every wide frame,
  // which is the single most synthetic line the scene had: nothing in a
  // three-thousand-year-old ruin is level over a hundred metres. Each bay now
  // picks its own height, some are collapsed to a stub, some are missing
  // outright, and towers punch above the run at intervals that differ per side.
  const PERIM_H = 6;
  const PERIM_BAY = 8.5;
  const PERIM_THICK = 3;

  const runs = [
    // axis is the direction the run travels; the wall's thin dimension is the
    // other one. Each run gets its own tower placement so no two sides match.
    { axis: 'x', cx: 0, cz: WALL, towers: new Set([2, 6, 11]), gaps: new Set([8]) },
    { axis: 'z', cx: -WALL, cz: 0, towers: new Set([1, 5, 9]), gaps: new Set([3, 11]) },
    { axis: 'z', cx: WALL, cz: 0, towers: new Set([4, 10]), gaps: new Set([6, 7]) },
  ];

  const runLength = WALL * 2 + 4;
  const perimBays = Math.round(runLength / PERIM_BAY);

  for (const run of runs) {
    for (let b = 0; b < perimBays; b++) {
      const t = (b + 0.5) / perimBays - 0.5;
      const along = t * runLength;
      const x = run.axis === 'x' ? run.cx + along : run.cx;
      const z = run.axis === 'x' ? run.cz : run.cz + along;

      // A missing bay is a hole in the silhouette, which is worth more than any
      // amount of height jitter: it lets sky through at ground level. The
      // player is still fenced in by world.bounds, so a gap costs nothing.
      if (run.gaps.has(b)) {
        for (let i = 0; i < 3; i++) {
          const rw = 1.6 + rand() * 2.2;
          const rh = 0.9 + rand() * 1.6;
          const rx = x + (run.axis === 'x' ? (rand() - 0.5) * PERIM_BAY : (rand() - 0.5) * 5);
          const rz = z + (run.axis === 'x' ? (rand() - 0.5) * 5 : (rand() - 0.5) * PERIM_BAY);

          const chunk = stone(rw, rh, rw * 0.85, M.limestone, DENSITY.rubble,
            { eroded: 0.15 });
          chunk.position.set(rx, rh * 0.45, rz);
          chunk.rotation.y = rand() * Math.PI;
          chunk.rotation.z = (rand() - 0.5) * 0.4;
          group.add(chunk);
        }
        continue;
      }

      const isTower = run.towers.has(b);

      // Ruined stubs and full-height bays, plus a per-bay jitter on top of both,
      // so even the intact stretch never draws two courses at the same y.
      const collapsed = !isTower && rand() < 0.22;
      const h = isTower ? PERIM_H * (1.75 + rand() * 0.35)
        : collapsed ? PERIM_H * (0.25 + rand() * 0.3)
          : PERIM_H * (0.82 + rand() * 0.34);

      const wide = isTower ? PERIM_THICK + 3.4 : PERIM_THICK;
      const long = isTower ? PERIM_BAY * 0.8 : PERIM_BAY + 0.4;
      const sw = run.axis === 'x' ? long : wide;
      const sd = run.axis === 'x' ? wide : long;

      const seg = stone(sw, h, sd, M.limestone, DENSITY.limestone,
        { eroded: collapsed ? 0.22 : 0.07, chamfer: 0.16 });
      seg.position.set(x, h / 2, z);
      seg.rotation.y = (rand() - 0.5) * 0.02;
      group.add(seg);

      addWallRun(x, z, wide * 0.6, h, run.axis, long);

      // A collapsed bay loses its coping, which is most of what makes the break
      // read as damage rather than as a shorter wall.
      if (!collapsed) {
        const cap = stone(sw + 0.6, 0.7, sd + 0.6, M.limestone, DENSITY.limestone,
          { chamfer: 0.1 });
        cap.position.set(x, h + 0.35, z);
        group.add(cap);
      }

      if (isTower) {
        // Merlons: four blocks on the tower head, one of them knocked out. A
        // toothed crown is a strong small-scale silhouette against sky, and the
        // missing tooth is what stops it reading as a repeated stamp.
        const drop = Math.floor(rand() * 4);
        for (let mi = 0; mi < 4; mi++) {
          if (mi === drop) continue;
          const off = (mi - 1.5) * (long / 4);
          const mx = x + (run.axis === 'x' ? off : 0);
          const mz = z + (run.axis === 'x' ? 0 : off);

          const merlon = stone(run.axis === 'x' ? long / 5 : wide * 0.55, 1.15,
            run.axis === 'x' ? wide * 0.55 : long / 5,
            M.limestone, DENSITY.limestone, { eroded: 0.08, chamfer: 0.1 });
          merlon.position.set(mx, h + 1.28, mz);
          group.add(merlon);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // ruins, palms, braziers
  // -------------------------------------------------------------------------

  for (let i = 0; i < 22; i++) {
    const a = rand() * Math.PI * 2;
    const d = 20 + rand() * 26;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d * 0.7 + 8;

    // Keep the approach corridor clear, and keep a hard clearance around the
    // spawn point. Without the second test, rubble lands on the player's face
    // on the very first frame of the game.
    if (Math.abs(x) < 16 && z < -2) continue;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < SPAWN_CLEARANCE) continue;

    const h = 1.4 + rand() * 3.2;
    const w = 1.6 + rand() * 2.2;
    const dd = 1.6 + rand() * 2.2;

    const chunk = stone(w, h, dd, M.limestone, DENSITY.rubble, { eroded: 0.14 });
    chunk.position.set(x, h * 0.5, z);
    chunk.rotation.y = rand() * Math.PI;
    chunk.rotation.z = (rand() - 0.5) * 0.14;
    group.add(chunk);
    addCollider(x, z, Math.max(w, dd) * 0.5, h);
  }

  for (let i = 0; i < 11; i++) {
    const a = rand() * Math.PI * 2;
    const d = 27 + rand() * 20;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d * 0.8 + 12;

    // Palms are the one thing in the scene on a material with NO map at all,
    // so a trunk close to the camera fills the frame with a flat colour ramp.
    // A raycast probe at the end of the walked shot found exactly that: a
    // CylinderGeometry 0.63 metres from the lens with no texture on it, which
    // is the "untextured cylinder" the frame was actually showing. Until the
    // trunk has a map, palms belong OUTSIDE the avenue, where they are a
    // silhouette against sky rather than a near-field surface.
    if (Math.abs(x) < AVENUE.halfWidth + 5 && z > AVENUE.zFar - 6 && z < AVENUE.zNear + 6) continue;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < SPAWN_CLEARANCE) continue;

    group.add(makePalm(x, z, rand, M));
    addCollider(x, z, 0.5, 9);
  }

  const braziers = [];
  // Not a matched pair per bay. Four braziers on two mirrored axes was another
  // way the avenue announced its own symmetry, and the light they cast doubled
  // the effect at night.
  for (const [x, z] of [[-6.5, -26], [7.6, -24], [-11.2, 3], [13.4, -8], [-4.2, 20]]) {
    const b = makeBrazier(x, z, M);
    group.add(b.group);
    braziers.push(b);
    addCollider(x, z, 0.85, 2.2);
  }

  // -------------------------------------------------------------------------
  // near field: the foreground plane
  // -------------------------------------------------------------------------
  //
  // Every reference frame has something large within a few metres of the lens:
  // a barrier, a wall corner, a cart. This scene had nothing at all inside
  // eight metres in any direction, so every shot was a mid-ground and a
  // background with a hole where the foreground should be, and the eye had no
  // near reference to scale the rest against.
  //
  // These sit off the centreline and are staggered in z, so the walk down the
  // avenue passes one, then another, and the foreground keeps changing instead
  // of being one object parked in front of the camera.

  /**
   * A revetment: a low barrier built from individual courses, offset course to
   * course so the joints are REAL recesses rather than painted lines.
   *
   * This is the hero-surface treatment. It is only worth the meshes within a
   * few metres of the player, where a normal map alone flattens out the moment
   * the surface turns away from the light and the silhouette of the joint is
   * the only thing left carrying it.
   */
  const revetment = (cx, cz, len, courses, yaw) => {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = yaw;

    const CH = 0.62;          // course height
    for (let c = 0; c < courses; c++) {
      // Alternate courses step back, which is what cuts the shadow line.
      const inset = (c % 2) * 0.13;
      const blocks = 3;
      for (let b = 0; b < blocks; b++) {
        const bw = len / blocks - 0.12;
        // Stagger the vertical joints course to course, as any bond does.
        const stagger = (c % 2) * (bw * 0.5);
        const bx = (b - (blocks - 1) / 2) * (len / blocks) + stagger;

        const blk = stone(bw, CH, 1.15 - inset * 2, M.limestone, DENSITY.limestone,
          { eroded: 0.05, chamfer: 0.055 });
        blk.position.set(bx, CH * (c + 0.5), (rand() - 0.5) * 0.05);
        blk.rotation.y = (rand() - 0.5) * 0.03;
        g.add(blk);
      }
    }

    // Coping, overhanging on both faces, so the top edge casts onto the courses.
    const cap = stone(len + 0.35, 0.3, 1.5, M.limestone, DENSITY.limestone,
      { chamfer: 0.07 });
    cap.position.y = CH * courses + 0.15;
    g.add(cap);

    group.add(g);
    addWallRun(cx, cz, 0.8, CH * courses + 0.3,
      Math.abs(Math.cos(yaw)) > 0.5 ? 'x' : 'z', len);
    return g;
  };

  // Left of the spawn, four metres out, angled across the frame. This is the
  // one the player sees on the very first frame of the game.
  //
  // Two courses, not four. Chest height is what the reference barriers are, and
  // a taller one here swallowed a sixth of the frame in shadow: the sun sits at
  // +X with only 0.28 of it along +Z, so any camera-facing surface is dim, and
  // trading that much bright sand for dim stone cost enough lit pixels to trip
  // the harness's own black-frame floor. A foreground plane has to frame the
  // shot, not block it.
  revetment(-6.4, 25.0, 6.0, 2, 0.16);

  // Right and further, so the two do not read as a gate.
  revetment(7.4, 21.0, 5.2, 3, -0.42);

  // A third, deeper in, keeps the foreground occupied once the first two are
  // behind the player. It can afford height because distance shrinks it.
  revetment(-8.8, 10.5, 5.6, 4, 0.08);

  // A toppled drum stack beside the near revetment. Cylinders on their side at
  // knee height are the shape the avenue floor has none of, and they overlap
  // the barrier behind them, which is what builds a foreground PLANE rather
  // than a foreground object.
  for (let d = 0; d < 3; d++) {
    const g = new THREE.Group();

    // CLOSED, unlike the stacked drums in a standing shaft.
    //
    // Open-ended is right when a drum's caps are buried in its neighbours. A
    // FALLEN drum lies on its side with an end face square to the player, and
    // leaving it open shows the hollow interior: it stops reading as a block of
    // quarried stone and starts reading as a length of pipe. That single flag
    // was the whole reason these looked wrong.
    const drum = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(COL_R_TOP, COL_R_BOT, DRUM_H, 20, 1, false),
        COL_R_BOT, DRUM_H, DENSITY.carved),
      M.carved
    );
    drum.castShadow = true;
    drum.receiveShadow = true;
    g.add(drum);

    // The dowel socket cut into each end face. Real drums were pinned to their
    // neighbours, and the socket is the detail that says "this was joined to
    // something" rather than "this is a cylinder".
    for (const end of [-1, 1]) {
      const socket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.19, 0.24, 12),
        M.granite
      );
      socket.position.y = end * (DRUM_H / 2 - 0.1);
      g.add(socket);
    }

    const dx = 4.1 + d * 0.55 + rand() * 0.3;
    const dz = 28.6 - d * (DRUM_H + 0.5);
    g.position.set(dx, COL_R_BOT * 0.85, dz);
    g.rotation.z = Math.PI / 2;
    g.rotation.y = 0.35 + (rand() - 0.5) * 0.5;
    group.add(g);
    addCollider(dx, dz, 1.2, 2.1);
  }

  // One block stood on end and leaning on the near revetment. A diagonal in the
  // foreground breaks the grid of horizontals and verticals everything else in
  // the scene is made of.
  const leaner = stone(1.5, 3.4, 0.85, M.carved, DENSITY.carved, { eroded: 0.1 });
  leaner.position.set(-8.0, 1.55, 24.6);
  leaner.rotation.set(0.06, 0.5, 0.31);
  group.add(leaner);
  addCollider(-8.0, 24.6, 1.0, 3.2);

  const dust = makeDust(M, 1600, 110);
  group.add(dust.points);

  // -------------------------------------------------------------------------
  // ground detail
  // -------------------------------------------------------------------------

  // Instanced pebbles, potsherds, bone, scrub, and half-buried drums. Empty
  // ground is the loudest remaining "tech demo" signal: real environments have
  // something to look at in nearly every square metre near the camera.
  //
  // Exclusions are derived from the collider list rather than hand-authored, so
  // scatter can never land inside a column or a doorway, and adding a building
  // later automatically keeps the ground around it clear.
  // Concentrated on the avenue, not the whole arena. Before the enclosure went
  // in, the budget was spread over a 100-unit square; now the walls occlude
  // most of that, so those instances were paying for detail nobody can see.
  const scatter = buildScatter(scene, {
    heightAt: dunes.heightAt,
    bounds: { min: -34, max: 38 },
    exclusions: [
      ...colliders.map((c) => ({ x: c.x, z: c.z, r: c.r + 0.8 })),
      { x: SPAWN.x, z: SPAWN.z, r: 3.5 },
    ],
    // Down from 6200-over-a-100-unit-square. Concentrating the same budget on
    // a third of the area tripled the density and it read as rock soup: an
    // even carpet of same-size, same-value pebbles is its own kind of "one
    // scale tier" failure, just a busier one. The tier 2 and tier 3 props are
    // what should fill this space, not more gravel.
    count: 3400,
    seed: 20260725,
    centre: { x: 0, z: 3 },
    radius: 30,
  });

  // -------------------------------------------------------------------------
  // set dressing
  // -------------------------------------------------------------------------
  //
  // Runs last, so it can occupancy-test against every collider the world has
  // already registered. This is the tier 2 and tier 3 layer: the furniture-
  // scale and thin geometry the scene has had none of, and specifically the
  // lines spanning the avenue overhead, which are the strongest depth cue
  // available and the most identifiable single gap against the reference.
  const dressing = dressAvenue(group, {
    heightAt: dunes.heightAt,
    colliders,
    avenue: AVENUE,
    bay: BAY,
    chapels: chapelSpots,
    seed: 77003,
  });

  return {
    group,
    colliders,
    braziers,
    dust,
    dressing,
    bounds: { min: -WALL + 2.5, max: WALL - 2.5 },

    /**
     * Floor height at a world position. The controller samples the same
     * function the dune mesh was built from, so collision can never drift out
     * of agreement with what is rendered.
     */
    heightAt: dunes.heightAt,

    /** Spawn point, mid-yard, looking down the colonnade at the pyramid. */
    spawn: new THREE.Vector3(SPAWN.x, 0, SPAWN.z),

    scatter,

    update(dt, t) {
      for (const b of braziers) b.update(dt, t);
      dust.update(dt);
      scatter.update(dt, t);
    },

    setFidelity(high) {
      for (const b of braziers) b.setFidelity(high);
      scatter.setFidelity(high);
      dressing.setFidelity(high);
    },
  };
}

// ---------------------------------------------------------------------------
// props
// ---------------------------------------------------------------------------

function makePalm(x, z, rand, M) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);

  const lean = (rand() - 0.5) * 0.18;
  const h = 6.5 + rand() * 3.5;

  // A curved trunk built from stacked segments. A single straight cylinder
  // reads as a pole; the curve is what makes it read as a palm.
  //
  // Each segment flares at its base and pinches at its top, so the joins read
  // as the ring of leaf scars a palm actually has. The trunk material carries
  // no texture map at all, so this ring relief is the only detail the surface
  // has: without it the trunk is a smooth colour ramp, which is what it was.
  const SEGS = 10;
  for (let i = 0; i < SEGS; i++) {
    const t = i / SEGS;
    const segH = h / SEGS;
    const r = 0.34 - t * 0.13;

    const seg = new THREE.Mesh(
      cylinderUV(
        new THREE.CylinderGeometry(r * 0.86, r * 1.08, segH * 1.04, 9, 1, true),
        r, segH, 1.6),
      M.palmTrunk
    );
    seg.position.set(
      lean * h * t * t,
      segH * (i + 0.5),
      lean * 0.4 * h * t * t
    );
    seg.rotation.z = lean * t * 1.6;
    seg.castShadow = true;
    g.add(seg);
  }

  const topX = lean * h;
  const topZ = lean * 0.4 * h;

  // Fronds: each is a tapered strip drooping away from the crown.
  const fronds = 9 + Math.floor(rand() * 4);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rand() * 0.25;
    const droop = 0.55 + rand() * 0.5;
    const len = 2.6 + rand() * 1.4;

    const frond = new THREE.Mesh(makeFrondGeometry(len, 0.62), M.palmFrond);
    frond.position.set(topX, h - 0.15, topZ);
    frond.rotation.order = 'YXZ';
    frond.rotation.y = -a;
    frond.rotation.z = -droop;
    frond.castShadow = true;
    g.add(frond);
  }

  // A few dates under the crown.
  for (let i = 0; i < 3; i++) {
    const a = rand() * Math.PI * 2;
    const cluster = new THREE.Mesh(
      new THREE.SphereGeometry(0.16 + rand() * 0.1, 6, 5),
      M.palmTrunk
    );
    cluster.position.set(
      topX + Math.cos(a) * 0.45,
      h - 0.45 - rand() * 0.3,
      topZ + Math.sin(a) * 0.45
    );
    g.add(cluster);
  }

  return g;
}

/**
 * A frond as a tapered, drooping strip. Built as an explicit BufferGeometry
 * because a PlaneGeometry cannot taper, and a flat untapered rectangle is
 * exactly what makes procedural palms look like cardboard.
 */
function makeFrondGeometry(length, width) {
  const RIBS = 7;
  const pos = [];
  const idx = [];

  for (let i = 0; i <= RIBS; i++) {
    const t = i / RIBS;
    // Taper to a point, and sag increasingly toward the tip.
    const w = width * (1 - t * t) * 0.5;
    const sag = -t * t * length * 0.42;

    pos.push(t * length, sag, -w);
    pos.push(t * length, sag, w);
  }

  for (let i = 0; i < RIBS; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function makeBrazier(x, z, M) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);

  // World-scale UVs, like everything else. Untouched, these two carried one
  // texture tile each: the probe measured the stem at 0.958 tiles/unit against
  // the 0.297 of the granite blocks beside it, which is a three-to-one texel
  // density mismatch on an object the player walks right up to.
  const stem = new THREE.Mesh(
    cylinderUV(new THREE.CylinderGeometry(0.15, 0.32, 1.6, 12, 1, true),
      0.32, 1.6, DENSITY.granite),
    M.granite);
  stem.position.y = 0.8;
  stem.castShadow = true;
  g.add(stem);

  const bowl = new THREE.Mesh(
    // Closed, unlike the stem: an open-ended bowl is see-through from below at
    // eye height, and the coals sit inside it.
    cylinderUV(new THREE.CylinderGeometry(0.76, 0.32, 0.62, 16),
      0.76, 0.62, DENSITY.gold),
    M.gold);
  bowl.position.y = 1.85;
  bowl.castShadow = true;
  g.add(bowl);

  const coals = new THREE.Mesh(new THREE.SphereGeometry(0.52, 12, 8), M.ember.clone());
  coals.position.y = 2.02;
  coals.scale.y = 0.45;
  g.add(coals);

  const light = new THREE.PointLight(0xff8a3c, 9, 22, 2);
  light.position.y = 2.4;
  light.castShadow = false;   // brazier shadows are a per-room budget decision
  g.add(light);

  const phase = (x * 13.7 + z * 7.3) % 6.283;

  return {
    group: g,
    light,
    coals,

    update(dt, t) {
      // Two detuned sines beating against each other reads as flicker without
      // ever settling into an obvious loop.
      const f = Math.sin(t * 11 + phase) * 0.5 + Math.sin(t * 6.7 + phase * 2) * 0.5;
      light.intensity = 9 + f * 2.6;
      coals.material.emissiveIntensity = 3.2 + f * 0.9;
    },

    setFidelity(high) {
      light.distance = high ? 22 : 14;
    },
  };
}

function makeDust(M, count, spread) {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * spread;
    pos[i * 3 + 1] = Math.random() * 18;
    pos[i * 3 + 2] = (Math.random() - 0.5) * spread;

    vel[i * 3]     = (Math.random() - 0.5) * 0.35;
    vel[i * 3 + 1] = 0.04 + Math.random() * 0.1;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.35;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const points = new THREE.Points(geo, M.dust);
  points.frustumCulled = false;

  return {
    points,
    update(dt) {
      const p = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        p[i3]     += vel[i3] * dt;
        p[i3 + 1] += vel[i3 + 1] * dt;
        p[i3 + 2] += vel[i3 + 2] * dt;

        if (p[i3 + 1] > 18) p[i3 + 1] = 0;
        if (p[i3] > spread / 2) p[i3] -= spread;
        if (p[i3] < -spread / 2) p[i3] += spread;
        if (p[i3 + 2] > spread / 2) p[i3 + 2] -= spread;
        if (p[i3 + 2] < -spread / 2) p[i3 + 2] += spread;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
