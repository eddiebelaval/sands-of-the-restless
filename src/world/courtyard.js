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

/** Half-extent of the outer perimeter. BACKDROP ONLY - never walked to. */
const WALL = 52;

/**
 * The walkable exterior.
 *
 * This used to be the whole 99x99 metre field out to the perimeter, and that
 * was the defect behind "half unrendered": the avenue was finished to a shipping
 * standard and everything outside it was level-design blockout, so the player
 * could walk out of a game and into a greybox in four seconds.
 *
 * The courtyard was never designed as a sandbox. It is the spawn area that
 * funnels the player into the pyramid, so the walkable space is now the avenue
 * plus the forecourt at the temple front, and the perimeter is a backdrop the
 * player reads at forty metres and never reaches. Tightening beats finishing:
 * every metre of mediocre space competes with the avenue for attention.
 *
 * Nothing here is an invisible wall. Each edge has real geometry on it - the
 * flanking bays east and west, the end wall and its choked gate to the north,
 * the terminal stubs and the temple front to the south - and the numbers below
 * sit OUTSIDE that geometry, so they are a backstop against a collider gap
 * rather than the thing the player actually stops against.
 *
 * The X extent is 23 rather than the 16.6 the avenue wall line would suggest,
 * because the six side chapels are recessed seven metres INTO those walls and
 * their back walls stand at x=+/-22. A rectangle drawn at the wall line put an
 * invisible clamp two metres inside a room whose back wall the player can see,
 * and a walk probe hit it in 36 of 192 directions. A backstop that fires inside
 * a visible space is worse than no backstop at all.
 *
 * minZ is -33 and NOT the -30.2 the temple front would suggest, because the
 * threshold that takes the player inside sits at z=-31.6 (doors.js ENTER_AT),
 * deliberately a short walk PAST the doorway so that paying for the door is not
 * itself the transition. Clamped at -30.2 the player bought the door, watched
 * the slab grind open, walked into an invisible wall, and never got in: the
 * interior suite went from green to 21 failures in one line of this file.
 *
 * The lesson generalises. A walkable bound is not a level-design number, it is
 * a contract with every trigger volume inside it, and the triggers are in
 * another file.
 */
const PLAY = { minX: -23.2, maxX: 23.2, minZ: -33.0, maxZ: 38.4 };

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

  /**
   * A SECOND stream, for everything added by the boundary-and-backdrop pass.
   *
   * Sharing `rand` would have been simpler and wrong: every draw taken by new
   * code shifts the whole sequence downstream of it, so adding four blocks to
   * the gate would have silently moved the outer ruins, the palms, and the
   * near-field jitter that the avenue was tuned around. A separate stream means
   * the finished half of the map is bit-identical to what it was.
   */
  const brand = rng(51501);

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

  /**
   * The floor sampler, aliased for the placement loops below.
   *
   * Anything that stands outside the plaza radius and ignores this is placed at
   * y=0 on a surface that is not at y=0, which is the mechanism behind "no
   * ground contact": the dunes swell to +/-0.55 under the perimeter, so a block
   * seated at zero either hovers or sinks by up to half a metre. Measured on
   * the shipped build, 73 percent of backdrop meshes were off the surface.
   */
  const groundY = dunes.heightAt;

  /** Rubble, seated on the real surface and bedded slightly into it. */
  const bedded = (w, h, d, mat, density, x, z, { eroded = 0.17, bed = 0.35, yaw = null, tilt = 0.35 } = {}) => {
    const m = stone(w, h, d, mat, density, { eroded });
    m.position.set(x, groundY(x, z) + h * (0.5 - bed), z);
    m.rotation.y = yaw === null ? brand() * Math.PI : yaw;
    m.rotation.z = (brand() - 0.5) * tilt;
    m.rotation.x = (brand() - 0.5) * tilt * 0.7;
    group.add(m);
    return m;
  };

  // -------------------------------------------------------------------------
  // the pyramid: the destination, visible from spawn
  // -------------------------------------------------------------------------

  const pyramid = new THREE.Group();
  pyramid.position.set(0, 0, -62);
  group.add(pyramid);

  const STEPS = 11;

  /**
   * How far each course reaches DOWN past the top of the one below it.
   *
   * Not cosmetic, and not a tolerance. Stacked face to face - course i topping
   * out at exactly the height course i+1 starts - the two boxes share a plane,
   * and then `erode` displaces each of them by up to a tenth of a unit using a
   * DIFFERENT seed, because the seed is derived from the box's dimensions and
   * every course is a different size. The shared plane stops being shared and a
   * horizontal slot opens between the courses.
   *
   * That slot runs the full depth of the pyramid, and the inside of a course is
   * back faces, which are culled. So the slot is not a dark line: it is a
   * see-through gap, and what you see through it is the sky BEHIND the temple.
   * Measured on the shipped build, from the middle of the avenue: two bands of
   * open sky flanking the doorway, at y=3.8 - the joint between the first and
   * second courses, at eye level, at the end of the avenue, in the exact spot
   * the player walks toward for the whole game. Under the old flat noon key
   * they were pale. Under the new one they were the brightest thing in frame.
   *
   * The chamfer widens the mouth of that slot by another 0.24 at each lip, and
   * the bevels that would have closed it are not drawn (see the winding note in
   * geometry.js). 0.7 of overlap is more than all three effects put together and
   * costs nothing: the overlap is inset behind the course below, so it is buried
   * in solid stone and the stepped profile the player sees is unchanged.
   */
  const COURSE_LAP = 0.7;

  for (let i = 0; i < STEPS; i++) {
    const w = 62 - i * 5.2;
    const h = 3.8;

    // Each course is nudged off true and eroded. Eleven perfectly aligned
    // identical boxes is the other half of the "voxel game" read: real
    // masonry has settled, and settled courses are never flush.
    const step = stone(w, h + COURSE_LAP, w, M.limestone, DENSITY.limestone,
      { eroded: 0.10, chamfer: 0.24 });
    step.position.set(
      (rand() - 0.5) * 0.5,
      h * 0.5 + i * h - COURSE_LAP * 0.5,
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
  // zFar was -47, which is sixteen metres INSIDE the pyramid: its base step is
  // 62 units square centred at z=-62, so its front face stands at z=-31 and
  // everything past that is solid limestone. Measured on the shipped build,
  // thirty meshes were sitting inside the temple mass. -29 puts the terrace's
  // far end where the avenue's far end actually is.
  const TERRACE = { xIn: -9.4, xOut: -15.2, zNear: -1.5, zFar: -29, h: 1.35 };
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

  // The upper course now TOPS OUT at TERRACE.h and laps down into the base.
  //
  // Two separate errors, both of which the flat noon key hid and the new key
  // does not. It used to be 0.78 tall centred at 0.92, so its top surface was
  // at 1.31 while the west colonnade is seated on TERRACE.h = 1.35: every
  // column on the terrace stood on four centimetres of nothing, and with a real
  // sun that gap is a strip of daylight under a 3.3-metre plinth. Its underside
  // was at 0.53 against a base course topping out at 0.51, so the two courses of
  // the stylobate did not touch each other either.
  //
  // Sized from TERRACE.h down rather than from an authored centre, so the
  // surface the colonnade stands on and the number the colonnade is seated at
  // are the same number and cannot drift apart again.
  const terraceTopH = TERRACE.h - 0.4;
  const terraceTop = stone(tW - 0.9, terraceTopH, tL - 0.6, M.limestone, DENSITY.limestone,
    { eroded: 0.05, chamfer: 0.1 });
  terraceTop.position.set(tX + 0.2, TERRACE.h - terraceTopH / 2, tZ);
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

      // Stop at the temple front. Seven columns at seven metres runs to z=-48,
      // and the pyramid's base step occupies everything past z=-31, so the last
      // three per side were buried in sixty metres of stone: four invisible and
      // two poking out of the first terrace as headless stubs. Six columns and
      // roughly thirty meshes, paying render cost to be inside a solid.
      //
      // Cutting them does not shorten the colonnade the player sees - it ended
      // at z=-27 either way - it just stops building the part nobody can look at.
      if (z < AVENUE.zFar + 1) break;

      // The east colonnade has come down. One column is on the ground and one is
      // snapped at chest height, so that side reads as ruin and the west reads
      // as intact temple.
      //
      // Renumbered because the loop now stops at four columns per side instead
      // of seven: the toppled one was at i=4 and the snapped one at i=5, both of
      // which were inside the pyramid, so the east side had quietly lost its
      // second fallen column and its stub entirely.
      const toppled = !west && i === 1;
      const snapped = !west && i === 3;

      const col = new THREE.Group();
      col.position.set(x, baseY, z);

      const base = stone(3.3, 0.65, 3.3, M.limestone, DENSITY.limestone, { chamfer: 0.08 });
      base.position.y = 0.32;
      col.add(base);

      if (toppled) {
        // A fallen shaft: the drums have rolled off the base and lie in a line
        // across the floor. Horizontal cylinders at knee height are exactly the
        // kind of mid-scale occluder the avenue floor has none of.
        //
        // Positions here are LOCAL to `col`, which is already at (x, baseY, z).
        // They used to be written in world coordinates and then added to a group
        // that applies its own translation on top, so every drum rendered at
        // TWICE its intended offset - the whole fallen column drew at (19..25,
        // -34..-40), inside the pyramid's base step, while the colliders it
        // registered stayed at the intended spot in the avenue.
        //
        // So the avenue carried five invisible obstacles the player collided
        // with and could not see, and the object they belonged to was never on
        // screen. That is the "too many obstacles" note in its purest form, and
        // no amount of tuning collider radii would ever have found it.
        const dir = 1;
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
            -side * spread * 0.72,
            COL_R_BOT * 0.86 - baseY,
            dir * spread * 0.7
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
        cap.position.set(-side * 4.6, 1.5 - baseY, dir * 4.4);
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
    g.position.set(ob.x, groundY(ob.x, ob.z), ob.z);

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

      // Resting height, not centre height. The shaft is a four-sided cylinder,
      // so rBot=1.05 is its CIRCUMradius and the flat it actually lies on is
      // 1.05*cos(45) = 0.74 below the axis. Seated at rBot + 0.35 the whole
      // twelve-metre obelisk hovered two thirds of a metre clear of the sand,
      // which on the largest single object in the avenue is not a small thing.
      // The 0.12 buries it, the way everything else here beds into the surface.
      const REST = rBot * Math.SQRT1_2 - 0.12;
      shaft.rotation.set(Math.PI / 2, 0, 0);
      shaft.position.set(0, REST, 0);
      cap.rotation.set(Math.PI / 2, 0, 0);
      cap.position.set(0, REST, -(ob.h / 2 + 1.1));

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
        //
        // Deliberately NOT lapped down into the lintel, unlike every other
        // stacked pair here. These two are the same depth in z, so an overlap
        // puts two coplanar faces in the same place over the lapped band and
        // trades a joint notch for z-fighting, which is worse. No hole was
        // measured at this joint - the alcove jambs stand proud of it on both
        // sides and there is solid wall behind - so it stays butted.
        const above = stone(3.0, 1.4, BAY - 0.6, M.limestone, DENSITY.limestone,
          { chamfer: 0.1 });
        above.position.set(x + side * 1.2, h + 0.7, z);
        group.add(above);

        // `h` travels with the spot. The banner the dressing hangs over this
        // alcove mouth was pinned at 8.2 to 9.7 regardless, and a chapel bay is
        // as short as 3.4 when the wall loop ruins it, so the banner hung in
        // clear sky beside a stub - a red rectangle floating over nothing, which
        // is exactly the "half rendered" read this pass is chasing out.
        chapelSpots.push({ x: x + side * (DEPTH - 2.2), z, side, h });

      } else {
        // Where a coping is going on, the wall runs up INTO it rather than
        // stopping dead at the line the coping starts. Two chamfered boxes
        // meeting at a shared plane leave a notch at the joint the width of both
        // their bevels, and along the top of a wall that notch is against open
        // sky, so it reads as a bright dash on the parapet. The coping is wider
        // and longer than the wall in both axes, so the extra height is inside
        // it and the silhouette is unchanged.
        const capped = !ruined;
        const wallH = capped ? h + 0.35 : h;

        const w = stone(2.6, wallH, BAY + 0.4, M.limestone, DENSITY.limestone,
          { eroded: 0.07, chamfer: 0.14 });
        w.position.set(x, wallH / 2, z);
        group.add(w);
        // The COLLIDER stays on h. It is the wall's real height and half a dozen
        // other systems are keyed to it; the extra 0.35 is buried masonry.
        addWallRun(x, z, 1.7, h, 'z', BAY + 0.4);

        if (capped) {
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
      // Three chunks, not five. The spill has a real job - a breach with clean
      // sand at its foot reads as a wall that was built short rather than one
      // that fell - and three big pieces do it as well as five for two fewer
      // objects in a frame that has been called messy twice.
      if (breached) {
        for (let i = 0; i < 3; i++) {
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

  // --- the forecourt: where the avenue meets the temple ---------------------
  //
  // The bay loop covers z=36 down to z=-27 and the portal stands at z=-30.2, so
  // the flanking walls stopped three metres short of the temple front and the
  // player could walk out SIDEWAYS into open sand. A walk probe from the far end
  // of the avenue reached (49.5, -49.5): straight through the gap, across the
  // whole field, and into the perimeter. That gap is where every "standing in
  // open sand surrounded by disconnected panels" frame was taken from.
  //
  // It closes with a terminal stub per side - the wall running on toward the
  // pyramid and dying into what fell off it - and the forecourt between the
  // stubs and the temple front stays open, because that is the room the sealed
  // doorway wants around it.
  const FORE_Z = -28.9;

  for (const side of [-1, 1]) {
    const x = side * AVENUE.halfWidth;
    // Asymmetric, like the colonnade: the west wall runs on nearly to full
    // height and the east one is broken down to shoulder height, so the
    // forecourt is lit from one side and enclosed from the other.
    const h = AVENUE.height * (side < 0 ? 0.54 : 0.33);

    const stub = stone(2.6, h, 5.4, M.limestone, DENSITY.limestone,
      { eroded: 0.12, chamfer: 0.14 });
    stub.position.set(x, h / 2, FORE_Z);
    group.add(stub);
    addWallRun(x, FORE_Z, 1.7, h, 'z', 5.4);

    // A jagged crown on the break, so the stub reads as a wall that came down
    // rather than one that was built to this height and stopped.
    const crown = stone(2.4, 0.95, 3.6, M.limestone, DENSITY.rubble, { eroded: 0.3 });
    crown.position.set(x - side * 0.12, h + 0.3, FORE_Z - 0.6);
    crown.rotation.set((brand() - 0.5) * 0.1, brand() * 0.5, side * 0.07);
    group.add(crown);

    // A fallen architrave, one end still lodged in the break and the other in
    // the sand. This is the overhead structure for the one part of the map the
    // player is guaranteed to end up standing in, and a diagonal in a scene
    // otherwise built entirely from right angles.
    // Seated so the low end beds into the sand and the high end lodges at the
    // top of the stub. Both ends have to LAND on something: a beam floating at
    // one end is the exact failure the architrave seating rule exists to stop.
    const BEAM_MID = 2.35;
    const beam = stone(10.4, 1.3, 2.0, M.carved, DENSITY.carved, { eroded: 0.06 });
    beam.position.set(x - side * 5.4, BEAM_MID, FORE_Z + 1.5);
    beam.rotation.set(0, side * 0.15, side * 0.42);
    group.add(beam);

    // Two discs on the low half only, and tight ones. Three at 1.1 walled off
    // the whole corner and shoved the player against the stub with its face in
    // the lens; the beam should be something you walk around, not a second wall.
    for (let i = 0; i < 2; i++) {
      const t = -3.6 + i * 1.8;                       // metres from the beam's centre
      addCollider(x - side * (5.4 - t), FORE_Z + 1.5, 0.85, BEAM_MID + t * 0.41 + 0.65);
    }

    // The talus. Every vertical the player can walk up to gets a foot: a wall
    // growing straight out of clean sand is the junction this whole pass exists
    // to remove, and these are the closest ones to the camera at the end of the
    // only route in the map.
    for (let i = 0; i < 3; i++) {
      const bw = 1.5 + brand() * 2.2;
      const bh = 0.9 + brand() * 1.5;
      const bx = x - side * (1.5 + brand() * 3.6);
      const bz = FORE_Z + (brand() - 0.5) * 6.4;
      bedded(bw, bh, bw * 0.85, M.limestone, DENSITY.rubble, bx, bz, { bed: 0.3 });
      addCollider(bx, bz, Math.max(1.0, bw * 0.5), bh);
    }
  }

  // The temple front is a wall, so give it one.
  //
  // The pyramid registers a single 32-unit cylinder at its centre, which is the
  // right shape for a mass you see from across the yard and the wrong one for a
  // face you walk up to: at the forecourt the cylinder has fallen behind the
  // stepped base, so a player crossing to the corner of the door walked THROUGH
  // sixty metres of limestone until the bounds clamp caught them. A walk probe
  // ended on that clamp in 17 of 192 directions.
  //
  // A run along the face fixes both halves at once: the player is stopped by the
  // temple they can see rather than by a number, and the clamp goes back to
  // being a backstop that never fires.
  // Two runs, not one, with the DOORWAY left open between them. A single run
  // across the whole face walls off the entrance, which is the only reason the
  // forecourt exists. The inner ends stop at x=+/-5.2, which leaves the player
  // a 3.1-unit-wide channel on the centreline - wider than the 2.6 the entry
  // threshold needs and wider than the 1.8 the door jambs allow - and the two
  // inner discs still overlap the sealed slab's own collider, so while the door
  // is shut there is no way around it either.
  for (const side of [-1, 1]) {
    addWallRun(side * 16, -31.3, 1.7, 8, 'x', 18);
  }

  // The temple front meeting the sand. A sixty-metre stepped mass rising out of
  // a clean flat surface is the same bare junction as a wall with no talus, and
  // this one is what the player walks toward for the whole game. The drift sits
  // OUTSIDE the walkable clamp, so it needs no colliders: it is the thing the
  // player stops in front of, not the thing that stops them.
  for (let i = 0; i < 8; i++) {
    const ax = -19 + i * 5.4 + (brand() - 0.5) * 2.2;
    if (Math.abs(ax) < 5.4) continue;               // clear of the doorway
    const az = -30.8 - brand() * 1.2;
    const aw = 1.5 + brand() * 2.2;
    const ah = 0.7 + brand() * 1.2;
    bedded(aw, ah, 1.4 + brand() * 1.5, M.limestone, DENSITY.rubble, ax, az,
      { eroded: 0.2, bed: 0.28, tilt: 0.3 });
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

  /**
   * How far a bay runs on PAST the bay beside it.
   *
   * The four bays were authored edge to edge: -16.5 to -6.5, -6.5 to -3.2, then
   * the gate mouth, then 3.2 to 7.0 and 7.0 to 16.5. Two of those numbers are
   * shared edges, and a shared edge between two independently eroded boxes is
   * not an edge for long - each one is displaced by up to a tenth of a unit on
   * its own noise seed, and a vertical slot opens between them for the full
   * height of the wall.
   *
   * That is the brightest defect in the turn-around frame: a crack of open sky
   * running from the sand to the parapet, with the low sun directly behind it,
   * three metres from where the player spawns. Lapping each bay past its
   * neighbour cannot be undone by any amount of erosion.
   *
   * Only the shared edges lap. The mouth of the gate and the two outer ends are
   * left exactly where the composition put them.
   */
  const END_LAP = 0.45;

  for (let i = 0; i < END_BAYS.length; i++) {
    const bay = END_BAYS[i];
    const next = END_BAYS[i + 1];
    const shared = next && Math.abs((bay.x + bay.w / 2) - (next.x - next.w / 2)) < 0.01;
    const w0 = bay.w + (shared ? END_LAP : 0);
    const x0 = bay.x + (shared ? END_LAP / 2 : 0);

    // Same coping rule as the flanking walls: the bay runs up into its cap. This
    // is the wall the player turns around and looks at, and its parapet is the
    // only place in that frame where masonry meets open sky, so a notch at the
    // joint has nothing behind it to hide in.
    const wallH = bay.h + 0.35;
    const w = stone(w0, wallH, 2.6, M.limestone, DENSITY.limestone, { eroded: 0.07 });
    w.position.set(x0, wallH / 2, END_Z);
    group.add(w);
    addWallRun(x0, END_Z, 1.7, bay.h, 'x', w0);

    // The coping stays on the AUTHORED bay, not on the lapped one: a cap that
    // grew with the lap would cantilever over its neighbour's coping, which is
    // the overhang rule this perimeter already had to be rebuilt once to fix.
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
  // Two pieces here and three squared across the mouth below; five in total
  // where there were seven, because a choked gate needs to READ choked, and
  // past three or four pieces every extra block is just another object.
  for (let i = 0; i < 2; i++) {
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

  // Actually seal it. The four chunks above LOOK like a choked gate and were
  // not one: a walk probe sprinting north from the spawn drove straight between
  // them, out through the end wall, and on to (34.7, 49.5) in the open field.
  // Four blocks landing at random over a six-metre mouth leave a player-width
  // gap most of the time.
  //
  // Three overlapping blocks squared across the mouth, plus one continuous
  // collider run behind them, so what the frame shows and what the player can
  // do finally agree. The opening ABOVE them is untouched: the point of the gate
  // was always to let sky and desert through behind the player.
  for (let i = 0; i < 3; i++) {
    const bw = 2.9 + brand() * 1.2;
    const bh = 2.3 + brand() * 1.0;
    const bx = (i - 1) * 2.3 + (brand() - 0.5) * 0.6;
    const bz = END_Z - 2.2 + (brand() - 0.5) * 0.8;
    bedded(bw, bh, bw * 0.8, M.limestone, DENSITY.rubble, bx, bz,
      { eroded: 0.18, bed: 0.22, tilt: 0.26 });
  }
  addWallRun(0, END_Z - 2.2, 1.5, 2.6, 'x', 7.2);

  // A talus of debris along the foot of the end wall. A wall meeting clean sand
  // is the "clean corner" tell, and it also keeps the player a couple of metres
  // off the masonry rather than letting them wedge their lens into it.
  // Four, spread wider. This is the wall directly behind the spawn point, so
  // it is in frame on the turn-around and nowhere else; it needs a foot, not a
  // rubble field.
  for (let i = 0; i < 4; i++) {
    const tx = -13.5 + (i + rand() * 0.6) * 7.6;
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

  // --- outer perimeter: the backdrop ----------------------------------------
  //
  // The player cannot reach this any more and that is the whole point of the
  // change. Walkable exterior now stops at the avenue and its forecourt, so the
  // perimeter's only job is to close the horizon: it is read at forty metres and
  // over, through the breaches in the avenue wall and over the choked north
  // gate, and never approached. Backdrop geometry is allowed to be cheap
  // BECAUSE it is out of reach - that is what moving it out of reach buys.
  //
  // What it is not allowed to be is thirty-nine separate objects, which is what
  // it was. Every bay picked its own height AND wore its own coping cap, 0.6
  // wider than the bay in both axes, so wherever a tall bay stood beside a short
  // one its cap cantilevered over open air. That is the "floating slab" read,
  // and thirteen of them in a row is the "someone forgot to finish this" read.
  //
  // The intent behind the height variation was right: a level horizontal across
  // a hundred metres is the most synthetic line a ruin can draw. Only the
  // execution failed. So the variation stays and the mechanism that broke the
  // run into separate objects goes:
  //
  //   1. A CONTINUOUS base course at one height for the whole run, in two
  //      stepped slabs so the plinth has a profile, bedded below the lowest
  //      ground along the run so it has contact everywhere. This is the single
  //      change that makes the eye read one ruin rather than many stones.
  //   2. All variation ABOVE that base. Missing upper courses, towers, a leaning
  //      block, rubble spilling from every break. A bay that has lost its upper
  //      course shows the base course, not sand: the silhouette breaks without
  //      the object breaking apart.
  //   3. Coping never overhangs ALONG the run - it is shorter than its own bay -
  //      and projects only across the wall's thickness, where there is wall
  //      underneath it for its whole length. It cannot cantilever into air.
  //
  // No colliders. Nothing that can reach this exists: the player is held by
  // world.bounds and the avenue, and enemy spawn points are searched inside the
  // same bounds. Registering two hundred cylinders for scenery nothing can touch
  // was pure cost in the collision loop.
  const PERIM_H = 7.0;
  const PERIM_BAY = 8.5;
  const PERIM_THICK = 3.2;
  const BASE_TOP = 2.5;                       // top of the continuous course
  const RUN_LEN = WALL * 2 + 8;

  const perimRuns = [
    // `axis` is the direction the run travels; the wall's thin dimension is the
    // other one. Tower and gap placement differs per run so no two sides match.
    { axis: 'x', cx: 0, cz: WALL, len: RUN_LEN, towers: [2, 7, 11], worn: [5, 9], lean: 4 },
    { axis: 'z', cx: -WALL, cz: 0, len: RUN_LEN, towers: [1, 6, 10], worn: [3, 12], lean: 8 },
    { axis: 'z', cx: WALL, cz: 0, len: RUN_LEN, towers: [4, 9], worn: [6, 7, 11], lean: 2 },

    // The fourth side, which had no perimeter at all. It cannot simply cross:
    // the pyramid's base occupies the middle of it, from x=-31 to x=+31. So it
    // runs in from both corners and DIES INTO the temple mass, which is the
    // framing the gap needed - the temenos wall abutting the thing it encloses,
    // rather than an enclosure that is visibly missing a side.
    { axis: 'x', cx: -43, cz: -WALL, len: 30, towers: [1], worn: [], lean: -1 },
    { axis: 'x', cx: 43, cz: -WALL, len: 30, towers: [2], worn: [], lean: -1 },
  ];

  for (const run of perimRuns) {
    const at = (t) => ({
      x: run.axis === 'x' ? run.cx + t : run.cx,
      z: run.axis === 'x' ? run.cz : run.cz + t,
    });

    // Inward normal, so spill and drift land on the face the player can see.
    const inX = run.axis === 'z' ? -Math.sign(run.cx) : 0;
    const inZ = run.axis === 'x' ? -Math.sign(run.cz) : 0;

    // The lowest ground anywhere along the run. The base course is bedded below
    // this, so it is buried for its whole length rather than hovering wherever
    // the dunes happen to dip. The dunes swell +/-0.55 out here; a slab seated
    // at y=0 shows daylight under it from any grazing angle.
    let floorLo = Infinity;
    for (let i = 0; i <= 48; i++) {
      const p = at((i / 48 - 0.5) * run.len);
      floorLo = Math.min(floorLo, groundY(p.x, p.z));
    }

    /** One unbroken slab spanning the whole run. */
    const slabRun = (y0, y1, widen) => {
      const w = PERIM_THICK + widen;
      const s = stone(
        run.axis === 'x' ? run.len : w,
        y1 - y0,
        run.axis === 'x' ? w : run.len,
        M.limestone, DENSITY.limestone, { eroded: 0.05, chamfer: 0.18 });
      s.position.set(run.cx, (y0 + y1) / 2, run.cz);
      group.add(s);
    };

    slabRun(floorLo - 1.1, BASE_TOP - 1.3, 1.9);      // footing, projecting
    slabRun(BASE_TOP - 1.5, BASE_TOP, 0.5);           // base course, set back

    const nb = Math.max(2, Math.round(run.len / PERIM_BAY));
    const bayLen = run.len / nb;
    let prevRise = 0;

    for (let b = 0; b < nb; b++) {
      const p = at(((b + 0.5) / nb - 0.5) * run.len);
      const isTower = run.towers.includes(b);
      const worn = !isTower && run.worn.includes(b);

      // Height ABOVE the base course, never above the ground. A worn bay has
      // none of it, so what shows through is a gap in the parapet rather than a
      // hole where the wall should meet the sand.
      const rise = isTower ? PERIM_H * (1.3 + brand() * 0.34)
        : worn ? 0
          : PERIM_H * (0.44 + brand() * 0.30);

      if (rise > 0) {
        // Bays overlap along the run so consecutive courses share a joint
        // instead of standing shoulder to shoulder with a seam between them.
        const long = bayLen + (isTower ? -1.4 : 0.8);
        const wide = isTower ? PERIM_THICK + 2.8 : PERIM_THICK - 0.5;

        const seg = stone(
          run.axis === 'x' ? long : wide,
          rise + 0.5,
          run.axis === 'x' ? wide : long,
          M.limestone, DENSITY.limestone,
          { eroded: isTower ? 0.06 : 0.12, chamfer: 0.16 });
        seg.position.set(p.x, BASE_TOP - 0.25 + (rise + 0.5) / 2, p.z);
        seg.rotation.y = (brand() - 0.5) * 0.02;
        group.add(seg);

        // Coping. SHORTER than its own bay along the run, and wider only across
        // the thickness. This is the rule the old build broke, and breaking it
        // is what put a cantilevered slab over open air at every height change.
        const cap = stone(
          run.axis === 'x' ? long - 1.2 : wide + 0.55, 0.55,
          run.axis === 'x' ? wide + 0.55 : long - 1.2,
          M.limestone, DENSITY.limestone, { chamfer: 0.1 });
        cap.position.set(p.x, BASE_TOP + rise + 0.52, p.z);
        group.add(cap);
      }

      if (isTower) {
        // Merlons: four blocks on the tower head, one knocked out. A toothed
        // crown is the strongest small-scale silhouette a distant object can
        // have against sky, and the missing tooth stops it reading as a stamp.
        const long = bayLen - 1.4;
        const wide = PERIM_THICK + 2.8;
        const drop = Math.floor(brand() * 4);
        for (let mi = 0; mi < 4; mi++) {
          if (mi === drop) continue;
          const off = (mi - 1.5) * (long / 4.2);
          const merlon = stone(
            run.axis === 'x' ? long / 5.2 : wide * 0.5, 1.2,
            run.axis === 'x' ? wide * 0.5 : long / 5.2,
            M.limestone, DENSITY.limestone, { eroded: 0.08, chamfer: 0.1 });
          merlon.position.set(
            p.x + (run.axis === 'x' ? off : 0),
            BASE_TOP + rise + 1.4,
            p.z + (run.axis === 'x' ? 0 : off));
          group.add(merlon);
        }
      }

      // Spill. Every change in the top line puts stone on the ground under it -
      // that is the connective tissue the run had none of. A break with clean
      // sand at its foot reads as a wall built short, not as one that fell.
      const step = Math.abs(rise - prevRise);
      if (step > 1.3 || worn) {
        const n = worn ? 5 : 3;
        for (let i = 0; i < n; i++) {
          const t = ((b + (i + 0.5) / n) / nb - 0.5) * run.len + (brand() - 0.5) * 2.2;
          const q = at(t);
          const out = PERIM_THICK * 0.5 + 0.4 + brand() * 3.4;
          const rw = 1.4 + brand() * 2.4;
          const rh = 0.8 + brand() * 1.7;
          bedded(rw, rh, rw * 0.85, M.limestone, DENSITY.rubble,
            q.x + inX * out, q.z + inZ * out, { eroded: 0.16, bed: 0.3 });
        }
      }
      prevRise = rise;

      // One leaning stone per run: a block still standing but pushed off plumb,
      // which says the wall MOVED rather than that it was modelled tidy.
      if (b === run.lean && rise > 0) {
        const tilt = 0.19 + brand() * 0.12;
        const s = stone(2.4, 3.6, 2.2, M.limestone, DENSITY.limestone, { eroded: 0.14 });
        const out = PERIM_THICK * 0.5 + 0.55;
        s.position.set(
          p.x + inX * out + (run.axis === 'x' ? (brand() - 0.5) * 3 : 0),
          BASE_TOP + 1.5,
          p.z + inZ * out + (run.axis === 'z' ? (brand() - 0.5) * 3 : 0));
        s.rotation.set(inZ * tilt, brand() * 0.4, -inX * tilt);
        group.add(s);
      }
    }

    // Sand drift and fallen facing along the foot of the whole run, so the base
    // course meets the desert in a scatter rather than at a drawn line.
    for (let i = 0; i < 12; i++) {
      const q = at((brand() - 0.5) * run.len * 0.98);
      const out = PERIM_THICK * 0.5 + 0.5 + brand() * 2.6;
      const dw = 1.1 + brand() * 2.4;
      const dh = 0.45 + brand() * 1.0;
      bedded(dw, dh, dw * 0.8, M.limestone, DENSITY.rubble,
        q.x + inX * out, q.z + inZ * out, { eroded: 0.2, bed: 0.4, tilt: 0.5 });
    }
  }

  // Corner towers. Four runs meeting at right angles need the corners built or
  // the enclosure reads as four unrelated walls that happen to be parallel; the
  // corner is the one place the eye can confirm they are the same structure.
  for (const [cx, cz, h] of [
    [-WALL, WALL, 13.0], [WALL, WALL, 11.2], [-WALL, -WALL, 12.1], [WALL, -WALL, 9.4],
  ]) {
    // Runs up into its cap, like every other coped wall here. A corner tower is
    // read entirely as a silhouette against sky, so a notch at the cap joint is
    // the one defect on it that is guaranteed to be visible.
    const towerH = h + 0.35;
    const t = stone(8.6, towerH, 8.6, M.limestone, DENSITY.limestone,
      { eroded: 0.08, chamfer: 0.2 });
    t.position.set(cx, groundY(cx, cz) - 1.0 + towerH / 2, cz);
    t.rotation.y = (brand() - 0.5) * 0.03;
    group.add(t);

    const cap = stone(9.4, 0.7, 9.4, M.limestone, DENSITY.limestone, { chamfer: 0.12 });
    cap.position.set(cx, groundY(cx, cz) - 1.0 + h + 0.35, cz);
    group.add(cap);

    for (let i = 0; i < 3; i++) {
      const a = brand() * Math.PI * 2;
      const d = 5.4 + brand() * 3.2;
      const rw = 1.5 + brand() * 2.6;
      const rh = 0.8 + brand() * 1.6;
      bedded(rw, rh, rw * 0.85, M.limestone, DENSITY.rubble,
        cx + Math.cos(a) * d, cz + Math.sin(a) * d, { eroded: 0.18, bed: 0.32 });
    }
  }

  // -------------------------------------------------------------------------
  // ruins, palms, braziers
  // -------------------------------------------------------------------------

  // Ruins and palms: MID-GROUND ONLY, and far fewer of them.
  //
  // This loop used to drop 22 chunks on a ring from d=20 to d=46, which put
  // most of them inside the walkable field, and the palm loop after it put 11
  // more trunks in the same space. Between them they were the largest single
  // source of the note this pass exists to answer: too many separate objects in
  // the exterior frame, none of them part of anything.
  //
  // The bar for keeping any one of these is now explicit. It has to frame the
  // shot, lead the eye to the temple entrance, or be cover worth fighting from.
  // Rubble scattered on a ring for texture does none of the three, so almost
  // all of it is gone, and what is left is pushed OUT of the walkable rectangle
  // where it fills the gap between the avenue and the backdrop and is seen
  // through the breaches rather than walked around.
  //
  // A near-empty approach with three deliberate objects photographs better than
  // a field of thirty-nine, and it fixes the movement complaint as a side
  // effect: every chunk deleted is a collider the player no longer snags on.
  const outsidePlay = (x, z) =>
    x < PLAY.minX - 3 || x > PLAY.maxX + 3 || z < PLAY.minZ - 3 || z > PLAY.maxZ + 3;

  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2;
    const d = 26 + rand() * 20;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d * 0.7 + 8;

    if (!outsidePlay(x, z)) continue;

    // Bigger, and fewer. One two-storey block reads as a ruined building; four
    // knee-high ones read as debris someone forgot to clear.
    const h = 2.6 + rand() * 3.4;
    const w = 2.4 + rand() * 3.0;
    const dd = 2.4 + rand() * 3.0;

    const chunk = stone(w, h, dd, M.limestone, DENSITY.rubble, { eroded: 0.14 });
    // Seated on the real surface and bedded into it. These sit well outside the
    // plaza radius where the dunes damp out, so a block placed at y=0 is up to
    // half a metre off the ground it is supposed to be resting on - hovering on
    // one swell and buried in the next.
    chunk.position.set(x, groundY(x, z) + h * 0.4, z);
    chunk.rotation.y = rand() * Math.PI;
    chunk.rotation.z = (rand() - 0.5) * 0.14;
    group.add(chunk);
  }

  // Four palms, not eleven, and every one of them beyond the walkable edge.
  // A palm is a silhouette against sky; it earns its place on the skyline and
  // nowhere else. The trunk material still carries no map, so a close one fills
  // the frame with a flat colour ramp.
  let palms = 0;
  for (let i = 0; i < 40 && palms < 4; i++) {
    const a = rand() * Math.PI * 2;
    const d = 30 + rand() * 17;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d * 0.8 + 12;

    if (!outsidePlay(x, z)) continue;

    group.add(makePalm(x, z, groundY(x, z) - 0.15, rand, M));
    palms++;
  }

  const braziers = [];
  // Not a matched pair per bay. Four braziers on two mirrored axes was another
  // way the avenue announced its own symmetry, and the light they cast doubled
  // the effect at night.
  for (const [x, z] of [[-6.5, -26], [7.6, -24], [-11.2, 3], [13.4, -8], [-4.2, 20]]) {
    const b = makeBrazier(x, z, groundY(x, z) - 0.08, M);
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
    // On the SAND, not on y=0. The dunes are damped inside the plaza but they
    // are not flat: measured at the three revetment positions the floor sits at
    // +0.20, +0.35 and +0.21, so a barrier built from y=0 loses between a third
    // and a half of its bottom course, and the one on the right of the spawn was
    // the worst of the three. That is a foreground object standing at chest
    // height in the first frame of the game, and it was reading a course short.
    // The 0.06 is the same bed every other ground object here gets: resting
    // exactly on the sampled height floats at grazing angles, because the mesh
    // dips below the sample between vertices.
    g.position.set(cx, groundY(cx, cz) - 0.06, cz);
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

    // Pushed out and back. At 4.1 units these read as a dark wall across the
    // right fifth of frame rather than as foreground: a near-field occluder
    // has to sit at the EDGE of the composition, because anything large enough
    // to give depth is also large enough to block the shot if it is centred.
    const dx = 8.6 + d * 0.5 + rand() * 0.3;
    const dz = 31.4 - d * (DRUM_H + 0.5);
    // 0.85 of the radius is a fifteen percent bed into the sand, which is what
    // "settled" looks like. Measured against y=0 it was a THIRTY percent bed,
    // because the floor here stands at +0.29 to +0.33 and the drum did not know
    // that. Seated on the sampled height it beds the fraction it was authored to.
    g.position.set(dx, groundY(dx, dz) + COL_R_BOT * 0.85, dz);
    g.rotation.z = Math.PI / 2;
    g.rotation.y = 0.35 + (rand() - 0.5) * 0.5;
    group.add(g);
    addCollider(dx, dz, 1.2, 2.1);
  }

  // One block stood on end and leaning on the near revetment. A diagonal in the
  // foreground breaks the grid of horizontals and verticals everything else in
  // the scene is made of.
  const leaner = stone(1.5, 3.4, 0.85, M.carved, DENSITY.carved, { eroded: 0.1 });
  leaner.position.set(-8.0, groundY(-8.0, 24.6) + 1.55, 24.6);
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

      // Sweep the centre lane clear, the whole length of the avenue.
      //
      // The dressing already banks its loose goods into the gutters on the
      // principle that a thoroughfare gets swept by traffic and the edges
      // accumulate; the scatter was still carpeting the middle, which put a
      // hundred small stones directly along the line the player walks and
      // directly between them and the door they are walking to. Clearing it
      // does three things at once: the avenue reads as processional, the eye
      // runs straight to the entrance, and the busiest part of the frame is
      // the part that gets quiet.
      ...Array.from({ length: 18 }, (_, i) => ({
        x: 0, z: AVENUE.zNear - i * 4, r: 3.4,
      })),
    ],
    // Down from 6200-over-a-100-unit-square. Concentrating the same budget on
    // a third of the area tripled the density and it read as rock soup: an
    // even carpet of same-size, same-value pebbles is its own kind of "one
    // scale tier" failure, just a busier one. The tier 2 and tier 3 props are
    // what should fill this space, not more gravel.
    // Down again, from 3400. The exterior was called messy twice; an even
    // carpet of pebbles is part of what "messy" means even though not one of
    // them is an obstacle. The dune material and the weathering carry the
    // ground now, and the scatter punctuates it rather than covering it.
    count: 1500,
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
    // The per-bay wall heights, so a span can be seated on the walls it is
    // actually tied to. Handing over the avenue's nominal height and letting
    // the dressing hang everything at 11.4 is the same mistake the architraves
    // made and had to be fixed for: over a bay ruined to a three-metre stub, a
    // line strung at 11.4 is anchored to nothing at both ends.
    bayHeight,
    bays,
    // The forecourt at the temple front is walkable now that the flanks are
    // closed, so it gets dressed rather than left as the one bare room on the
    // route.
    forecourt: { z: FORE_Z, halfWidth: AVENUE.halfWidth },
    seed: 77003,
  });

  return {
    group,
    colliders,
    braziers,
    dust,
    dressing,
    /**
     * The walkable exterior, as a rectangle rather than a square.
     *
     * Both consumers already read the rectangular shape - the player controller
     * takes `minX ?? min` because the interior is a long room, and the wave
     * director builds its exterior spawn lattice from the same four numbers -
     * so the exterior can stop pretending to be a 99-metre square without a
     * change anywhere downstream. It also means enemies now spawn in the space
     * the player is actually in, instead of over a field they can never enter.
     */
    bounds: PLAY,

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

function makePalm(x, z, y, rand, M) {
  const g = new THREE.Group();
  g.position.set(x, y, z);

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

function makeBrazier(x, z, y, M) {
  const g = new THREE.Group();
  g.position.set(x, y, z);

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
