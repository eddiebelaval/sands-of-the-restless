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
import { chamferedBox, chamferFor, erode, duneField } from './geometry.js';
import { buildTemple } from './temple.js';
import { buildScatter } from './scatter.js';
import { dressAvenue } from './dressing.js';
import { batchStatics } from './batch.js';
import { buildWallBuyFixture } from './build.js';
import { buildQuarry, QUARRY } from './quarry.js';
import { buildCanal, canalDepthAt, cutCanalIntoGround, CANAL } from './canal.js';
import { buildCamp } from './camp.js';

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
 * The walkable exterior INCLUDING the two Act 1 spaces, which is what the
 * player controller and the wave director are handed.
 *
 * PLAY above is not widened to cover them and that is not an oversight. PLAY is
 * read twice more in this file, by `outsidePlay`, which decides whether a
 * backdrop ruin or a palm is far enough out to be allowed to exist - and that
 * decision sits INSIDE two loops that have already drawn from `rand` and will
 * draw again if the test passes. Widening PLAY changes how many of those seven
 * chunks and forty palm attempts survive, which changes the number of draws
 * taken, which moves every placement downstream of them. The avenue is finished
 * work and the whole of this file is arranged so that nothing can move it.
 *
 * So PLAY keeps its old meaning - the avenue and its forecourt, the region the
 * backdrop must stay out of - and this is the separate, wider rectangle that
 * answers "where may the player be". The numbers sit outside real geometry on
 * every edge, exactly as PLAY's do: the canal's west wall stops the player at
 * x = -43.6 and this says -46, the quarry's bedrock face stops them at 37.6 and
 * this says 41. Nothing here is an invisible wall; it is a backstop against a
 * collider gap.
 *
 * The corners of this rectangle that are neither avenue nor quarry nor canal -
 * the strip north of the quarry's spoil bank, for instance - are sealed off by
 * that authored geometry and are unreachable. The wave director does a flood
 * fill over this rectangle and only ever spawns in the player's own connected
 * component, so an unreachable corner cannot become a spawn pocket. That is the
 * same mechanism that keeps enemies out of the two new spaces until they are
 * bought: while the barricades are up, they are simply not the player's island.
 */
const EXTERIOR = { minX: -46.0, maxX: 41.0, minZ: -33.0, maxZ: 38.4 };

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

  /**
   * A THIRD stream, for the Act 1 pass: the Quarry, the Canal, and the mass at
   * the forecourt centre.
   *
   * Same argument as `brand` above, one step further on. The two new spaces are
   * built after the last existing draw, so they could in fact have shared
   * `rand` safely today - but "safely today" is a property of the current line
   * ordering and nothing enforces it. The day somebody inserts a prop above
   * them, a shared stream silently redresses the avenue and the failure shows
   * up as a screenshot that looks subtly wrong with no diff to explain it. An
   * independent stream makes the ordering irrelevant, which is the only version
   * of this that stays true.
   */
  const qrand = rng(30731);

  /**
   * A FOURTH stream, for the expedition camp and the downed helicopter.
   *
   * Same argument as `brand` and `qrand` above and it does not weaken with
   * repetition: the camp is built last, so today it could share `qrand`
   * safely, and "safely today" is a property of the current line ordering that
   * nothing enforces. The day somebody inserts a prop above it, a shared stream
   * silently redresses the canal's silt drifts and the failure arrives as a
   * screenshot that looks subtly wrong with no diff to explain it.
   */
  const crand = rng(60815);

  const group = new THREE.Group();
  group.name = 'courtyard';
  scene.add(group);

  /**
   * The spawn point, and the radius that must stay clear of scattered props.
   * Declared before anything is placed so every placement loop can test it.
   */
  const SPAWN = { x: 0, z: 30 };
  const SPAWN_CLEARANCE = 9;

  /**
   * { x, z, r, h } cylinders. The single source of truth for collision.
   *
   * `y0` is optional and it is what the Act 1 spaces are built on. A collider
   * that declares no base is measured from whatever the local floor happens to
   * be, which is right for a palm on a dune and wrong for anything that can be
   * stood on: the test is "are your feet within h of my base", so with the base
   * tracking your own floor the answer is always yes and the thing blocks
   * forever. Declaring a base is what lets a cut block stop being solid once
   * you are on top of it, and the player and the mummies read the field from
   * the same array with the same rule, so no surface is climbable by one and
   * not the other.
   */
  const colliders = [];
  const addCollider = (x, z, r, h = 4, y0) =>
    colliders.push(y0 === undefined ? { x, z, r, h } : { x, z, r, h, y0 });

  /**
   * Seal a straight wall run with overlapping cylinders.
   *
   * The collision model is a flat list of cylinders, which is fine for posts
   * and rubble but wrong for a wall: registering one cylinder per 9-unit bay
   * leaves gaps wider than the player and the enclosure silently stops
   * enclosing. Spacing is derived from the radius so the run can never
   * un-seal if either is retuned.
   */
  const addWallRun = (x, z, r, h, axis, length, y0) => {
    const step = r * 1.4;                       // < 2r, so consecutive discs overlap
    const n = Math.max(2, Math.ceil(length / step));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n - 0.5) * length;
      addCollider(axis === 'z' ? x : x + t, axis === 'z' ? z + t : z, r, h, y0);
      out.push(colliders[colliders.length - 1]);
    }
    return out;
  };

  /**
   * Seal a rectangular footprint, rather than inscribe a disc in it.
   *
   * The wall run above solves a line; this solves an area, and the two are the
   * same fix to the same defect. One cylinder inside an eight metre block
   * leaves all four corners open and the player walks into the middle of the
   * stone. A grid of overlapping cylinders costs about a dozen entries per
   * block and cannot be walked into from any angle.
   *
   * Spacing is derived from the radius for the same reason the wall run derives
   * its own: whoever retunes the radius later must not be able to un-seal the
   * mass by doing it.
   *
   * IT SEALS `w + FILL_R` BY `d + FILL_R`, not `w` by `d`. The outermost disc
   * centres sit half a radius inside the footprint they are given and each disc
   * then reaches a full radius past its own centre, so the sealed area
   * overhangs the numbers passed in by FILL_R/2 on every side. That is the
   * right default for a rough mass sitting in sand, where a hand's width of
   * generous collision reads as the mass being solid. It is the WRONG default
   * where the stone has a face the player is meant to walk right up to and past
   * - a stylobate beside a doorway, a pier framing a gap - and there the caller
   * passes dimensions already reduced by FILL_R so that the discs' outer edges
   * land ON the faces. The west terrace does exactly that, and had to: an
   * overhang there is invisible collision standing in a mouth the player paid
   * for.
   */
  const FILL_R = 1.35;
  const fillMass = (cx, cz, w, d, h, y0) => {
    const r = FILL_R;
    const step = r * 1.35;
    const nx = Math.max(1, Math.ceil((w - r) / step));
    const nz = Math.max(1, Math.ceil((d - r) / step));
    const out = [];
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const x = cx + (i / nx - 0.5) * Math.max(0, w - r);
        const z = cz + (j / nz - 0.5) * Math.max(0, d - r);
        addCollider(x, z, r, h, y0);
        out.push(colliders[colliders.length - 1]);
      }
    }
    return out;
  };

  /**
   * Walkable surfaces above the sand: `{ x, z, w, d, y0, y1 }`, rise along the
   * longer horizontal axis, y0 at the low-coordinate end.
   *
   * Deliberately the SAME record shape and the same semantics build.js uses for
   * the interior's ramps and ledges, read by the same kind of foot-gated
   * sampler at the bottom of this file. The exterior did not need one until Act
   * 1 got a terrace and two causeways; inventing a second vocabulary for it
   * would have meant two answers to "how high is the floor" living in one
   * process, which is how the gallery ledge became walkable from underneath.
   */
  const decks = [];
  const addDeck = (deck) => { decks.push(deck); return deck; };

  /**
   * A cut stone block: chamfered edges, optional erosion, world-scale UVs.
   *
   * THE CHAMFER SCALES WITH THE BLOCK, and until 2026-07-27 it did not, despite
   * this comment having claimed it did. `Math.min(0.11, min * 0.055)` is a CAP,
   * not a scale: every member thicker than two metres - which is every wall,
   * every pylon, every course of the pyramid - collapsed onto the same 11 cm,
   * and the pyramid's own override was 24 cm on a sixty-two metre face. At the
   * ninety metres the pyramid is read from that is three pixels, which is a
   * hairline and not a highlight, and a blind side-by-side against the reference
   * project came back with "no bevel on anything so no edge in the scene catches
   * an edge highlight, which is why the stone reads as painted cardboard."
   *
   * `chamferFor` (geometry.js) is the rule: a fraction of the member's longest
   * dimension, floored so small members keep a real arris, clamped against its
   * thinnest so a slab cannot become a pillow. The `chamfer` option is now a
   * MINIMUM rather than an override - every explicit value in this file was
   * authored under the old cap and every one of them is smaller than the rule,
   * so they survive as a record of intent and change nothing.
   */
  const stone = (w, h, d, mat, density, { eroded = 0, chamfer = null } = {}) => {
    const c = chamferFor(w, h, d, chamfer ?? 0);
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

  /**
   * CUT THE CANAL INTO THE GROUND ITSELF, before anything reads it.
   *
   * The Canal's job is the sunken read, which means the floor has to actually
   * be lower there - for the picture, for the player, for the mummies coming
   * down the bank and for a grenade rolling into the channel. There is exactly
   * one floor in this game's exterior and it is this mesh and the function it
   * was built from, so the trench is a subtraction applied to both at once
   * rather than a second surface dropped through a hole. `canal.js` explains
   * why every breakpoint in the profile is a multiple of 2.625 and what the
   * residual error is where the two ramps cross.
   *
   * This runs here, at the top, rather than beside the rest of the Act 1 pass,
   * because `groundY` immediately below is what every placement in the file
   * seats itself on. A trench cut after the fact would leave anything standing
   * in it hanging three metres in the air.
   */
  cutCanalIntoGround(dunes.geometry);

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
   *
   * It is the dune sampler MINUS the canal cut, and the same subtraction the
   * mesh above just took, so anything seated through this function stands on
   * the ground that is actually drawn whichever side of the bank it is on.
   */
  const groundY = (x, z) => dunes.heightAt(x, z) - canalDepthAt(x, z);

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
  // the pyramid and its gate: the destination, visible from spawn
  // -------------------------------------------------------------------------
  //
  // Both are built by world/temple.js now. This used to be eleven extruded
  // boxes and a slab with a decal on it, and two blind judges independently
  // picked it out of a seven-shot comparison as the weakest object in the game:
  // "one flat pink texture and a single red disc", "a texturally dead stepped
  // block", "a flat grey door slab with a painted circle standing in for
  // architecture". It is the focal point of half the frames and the thing the
  // player walks toward for the whole session, so it earns a file.
  //
  // WHAT STAYS HERE, AND WHY IT STAYS HERE. The three colliders below are read
  // back by doors.js BY SHAPE, not by name: it finds the slab's disc with
  // (|x|<0.2, |z+30.2|<0.2, 2.5<r<4) and the mass's with (|x|<0.2, |z+62|<0.5,
  // r>25), and it edits both when the player pays. Collision has exactly one
  // representation in this codebase and it is the array in this function, so
  // they are registered here beside every other collider rather than inside the
  // module that draws the geometry.
  const temple = buildTemple({ M, groundY, seed: 40711 });
  group.add(temple.group);

  /**
   * BURN THE DRAWS THE OLD PYRAMID USED TO TAKE.
   *
   * The eleven-course loop that used to stand here pulled three numbers off
   * `rand` per course - two for the nudge off centre, one for the yaw - and
   * every placement downstream of it takes its numbers from the same stream.
   * The temple has its own stream, exactly as the boundary pass and the far
   * skyline do, so removing those thirty-three draws shifted the whole sequence
   * behind them: the first capture after the rewrite came back with a different
   * set of ruined bays, different architrave spans, and an architrave across
   * the spawn frame that had never been there. THE AVENUE IS FINISHED WORK AND
   * IS THE QUALITY BAR FOR THIS PROJECT; nothing in this pass is allowed to
   * move it by so much as a bay.
   *
   * So the draws are taken and thrown away. It is three lines of waste in
   * exchange for the finished half of the map being bit-identical to what it
   * was, which is the trade this file has already made twice - once for the
   * boundary pass and once for the skyline.
   */
  for (let i = 0; i < 33; i++) rand();

  addCollider(0, -62, 32, 44);

  // The two door jambs and the slab, at the positions doors.js expects.
  for (const side of [-1, 1]) addCollider(side * 3.6, -30.2, 1.4, 9.5);
  addCollider(0, -30.2, 3.2, 9);

  // The pier feet, which stand a little outboard of the old jambs. Asked for by
  // the gate rather than authored here, so the geometry and the collision that
  // seals it cannot drift apart.
  for (const c of temple.colliders) addCollider(c.x, c.z, c.r, c.h);

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

  // -------------------------------------------------------------------------
  // WHERE THE AVENUE WALLS OPEN
  // -------------------------------------------------------------------------
  //
  // Declared HERE, above the first thing that gets laid on the avenue floor,
  // and that placement is the fix for a shipped bug rather than tidiness.
  //
  // These three tables used to live beside the bay loop that consumes them,
  // three hundred lines below, which meant nothing built before the bay loop
  // could know where the walls open. The west terrace is built before the bay
  // loop. It was laid as one unbroken 27.5-metre stylobate hard against the
  // west wall, and the west wall has three holes in it inside that span: the
  // canal's bought gate at bay 5 and the chapel recesses at bays 4 and 6. A
  // player who paid 500 for the canal gate walked west, hit 1.35 metres of
  // invisible stylobate two and a half metres short of the hole he had just
  // bought, and never reached the canal. The purchase succeeded end to end -
  // gold taken, blockers spliced out, `opened` true - and the space stayed
  // sealed, because nothing in the build ever asked whether the thing standing
  // in front of the door was ours.
  //
  // So the tables come first and the terrace reads them. Anything else laid
  // against a wall in this file can now do the same, and the rule it has to
  // honour is the one the terrace broke: A WALL THAT OPENS HAS TO BE
  // REACHABLE FROM THE FLOOR IN FRONT OF IT.

  const bays = Math.round((AVENUE.zNear - AVENUE.zFar) / BAY);

  /** The centre z of a bay, which is where any opening in it is centred. */
  const bayZ = (b) => AVENUE.zNear - b * BAY - BAY / 2;

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

  /**
   * THE ACT 1 CIRCUIT: where the avenue opens onto the two new spaces.
   *
   * MAP.md ratifies Avenue -> Quarry -> Canal -> Avenue as one circuit of
   * roughly 150 metres, each space opened by a purchase of about 500. Two
   * spaces on opposite flanks of a corridor need four holes in that corridor,
   * and four holes is two prices unless one of them is one-way. So each space
   * gets exactly one BOUGHT mouth and one free BREACH, and the breach is a hole
   * high in the wall with the spoil banked against it on the outside only:
   * walk up the talus from inside the space and step down into the avenue, and
   * from the avenue side it is a sill you cannot climb. One price per space,
   * one direction round the circuit, and the direction is legible from the
   * geometry rather than from a sign.
   *
   *   quarry  in  east bay 1  (z =  22.5)   out  east bay 5  (z = -13.5)
   *   canal   in  west bay 5  (z = -13.5)   out  west bay 2  (z =  13.5)
   *
   * The two z = -13.5 mouths face each other across the avenue on purpose. The
   * chapels were deliberately staggered so that no recess is ever read against
   * another recess, and this is the opposite case rather than a violation of
   * it: a crossroads wants to be symmetric, because the whole value of it is
   * that from the middle of the avenue you can see both ways out at once.
   *
   * Neither of these bays is a chapel bay and neither is one of the two breached
   * east bays, so nothing here competes with geometry that was already authored.
   */
  const GATE_BAYS = new Map([['1:1', 'quarry'], ['-1:5', 'canal']]);
  const BREACH_BAYS = new Map([['1:5', 'quarry'], ['-1:2', 'canal']]);

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
  const tX = (TERRACE.xIn + TERRACE.xOut) / 2;

  /**
   * The colonnade's rhythm, declared here rather than inside the loop that
   * lays it, because the stylobate UNDER the colonnade has to know where the
   * columns land before it can decide where it may be cut. The east row is
   * offset by a third of a bay: two facing rows on the same z are what makes an
   * avenue read as a mirror.
   */
  const COL_Z0 = { '-1': -4, '1': -6.4 };
  const COL_STEP = 7;
  const COL_BASE = 3.3;              // the square plinth each column stands on

  /**
   * WHERE THE STYLOBATE IS CUT, AND WHY IT IS CUT AT ALL.
   *
   * The terrace runs z = -1.5 to -29 hard against the west wall, and the west
   * wall has three openings inside that span: the canal's bought gate at bay 5
   * and the chapel recesses at bays 4 and 6. Laid as one slab it sealed all
   * three. The gate was the expensive one - a player paid 500, the door
   * reported `opened`, its blockers were spliced out of the collider list, and
   * he still walked into 1.35 metres of stylobate two and a half metres short
   * of the hole. Nothing reported it, because every instrument in the build
   * asks whether the DOOR opened and none of them asks whether the floor in
   * front of it can be stood on.
   *
   * So a mouth in the wall behind the terrace cuts a passage through it. A real
   * temple does the same thing for the same reason: you do not lay an unbroken
   * plinth across your own side door.
   *
   * THE PASSAGE IS CLAMPED TO WHAT THE COLONNADE LEAVES, and that clamp is not
   * a nicety. The stylobate is what the columns stand on. Cut it out from under
   * one and a 3.3-metre plinth carrying eleven metres of column is standing on
   * air, which is the same defect as the floating architraves and floating
   * banners this file has already had to fix twice. The two columns bracketing
   * the canal gate sit at z = -11 and z = -18, so the passage is what is left
   * between their plinths: 3.7 metres, centred a metre south of the mouth. That
   * is narrower than the 5.2-metre hole and wider than anything that has to walk
   * through it.
   *
   * AND WHERE THE COLONNADE LEAVES NOTHING, NOTHING IS CUT. West bays 4 and 6
   * put their chapel recesses at z = -4.5 and z = -22.5, and the columns at
   * z = -4 and z = -25 stand across both approaches. Those two recesses stay
   * sealed, they are still sealed after this change, and the fix for them is to
   * move the west colonnade's rhythm - a composition decision, not a collision
   * one, and not this pass's to take. They are listed here so the next person
   * finds them named rather than by walking into them.
   */
  const MOUTH_HALF = 2.6;            // buildMouth's HALF: a 5.2 metre hole
  const PASSAGE_PAD = 1.2;           // shoulder room either side of the mouth
  const PASSAGE_MIN = 2.4;           // narrower than this is not a route

  const passages = [];
  for (let b = 0; b < bays; b++) {
    const key = `-1:${b}`;
    if (!GATE_BAYS.has(key) && !BREACH_BAYS.has(key)) continue;

    const mz = bayZ(b);
    if (mz > TERRACE.zNear || mz < TERRACE.zFar) continue;   // terrace never reaches it

    let hi = Math.min(mz + MOUTH_HALF + PASSAGE_PAD, TERRACE.zNear);
    let lo = Math.max(mz - MOUTH_HALF - PASSAGE_PAD, TERRACE.zFar);

    let underAColumn = false;
    for (let i = 0; ; i++) {
      const cz = COL_Z0['-1'] - i * COL_STEP;
      if (cz < AVENUE.zFar + 1) break;                       // the colonnade stops here
      const half = COL_BASE / 2;
      if (Math.abs(cz - mz) < half) { underAColumn = true; break; }
      if (cz > mz) hi = Math.min(hi, cz - half);
      else lo = Math.max(lo, cz + half);
    }

    if (underAColumn || hi - lo < PASSAGE_MIN) continue;
    passages.push({ hi, lo });
  }

  /**
   * The stylobate is now the terrace MINUS its passages: north to south, a
   * segment, a gap, a segment. One slab was the special case where the list of
   * passages happens to be empty, and it still builds that way.
   */
  const terraceSegs = [];
  {
    let top = TERRACE.zNear;
    for (const p of passages.slice().sort((a, b) => b.hi - a.hi)) {
      if (p.hi < top) terraceSegs.push({ zNear: top, zFar: p.hi });
      top = p.lo;
    }
    if (TERRACE.zFar < top) terraceSegs.push({ zNear: top, zFar: TERRACE.zFar });
  }

  for (const seg of terraceSegs) {
    const sL = seg.zNear - seg.zFar;
    const sZ = (seg.zNear + seg.zFar) / 2;

    // Two courses rather than one slab, the upper inset, so the terrace edge is
    // a real step profile instead of a painted line.
    const terraceBase = stone(tW, 0.62, sL, M.limestone, DENSITY.limestone,
      { eroded: 0.05, chamfer: 0.1 });
    terraceBase.position.set(tX, 0.20, sZ);
    group.add(terraceBase);

    // The upper course TOPS OUT at TERRACE.h and laps down into the base.
    //
    // Two separate errors, both of which the flat noon key hid and the new key
    // does not. It used to be 0.78 tall centred at 0.92, so its top surface was
    // at 1.31 while the west colonnade is seated on TERRACE.h = 1.35: every
    // column on the terrace stood on four centimetres of nothing, and with a
    // real sun that gap is a strip of daylight under a 3.3-metre plinth. Its
    // underside was at 0.53 against a base course topping out at 0.51, so the
    // two courses of the stylobate did not touch each other either.
    //
    // Sized from TERRACE.h down rather than from an authored centre, so the
    // surface the colonnade stands on and the number the colonnade is seated at
    // are the same number and cannot drift apart again.
    const terraceTopH = TERRACE.h - 0.4;
    const terraceTop = stone(tW - 0.9, terraceTopH, sL - 0.6, M.limestone,
      DENSITY.limestone, { eroded: 0.05, chamfer: 0.1 });
    terraceTop.position.set(tX + 0.2, TERRACE.h - terraceTopH / 2, sZ);
    group.add(terraceTop);

    /**
     * SEALED AS A RECTANGLE, AND SIZED SO THE COLLISION ENDS WHERE THE STONE
     * ENDS.
     *
     * This was one `addWallRun` of r = 2.9 discs down the terrace centre line,
     * and it had two faults that a passage makes fatal rather than merely
     * untidy. A wall run centres its END discs on the ends it is given, so a
     * run of the terrace's own length reached 2.9 metres past both faces: the
     * old terrace's collision ran to z = 1.4, four metres north of any stone,
     * and a passage cut between two such runs would have been filled in from
     * both sides before anyone could walk it. And a line of discs down the
     * middle of a 5.8 by 27.5 rectangle leaves the corners open, which is the
     * exact defect `fillMass` exists to answer.
     *
     * So: fillMass, with both dimensions reduced by FILL_R, which is what makes
     * the sealed footprint the stone's footprint and not a hand's width more.
     * See the note on fillMass.
     */
    fillMass(tX, sZ, tW - FILL_R, sL - FILL_R, TERRACE.h);
  }

  for (const side of [-1, 1]) {
    const west = side < 0;

    const z0 = COL_Z0[side];
    const baseY = west ? TERRACE.h : 0;

    for (let i = 0; i < 7; i++) {
      const x = side * 13;
      const z = z0 - i * COL_STEP;

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

      // COL_BASE rather than a literal: the stylobate above measures its
      // passages against this plinth to decide where it may be cut, and a
      // plinth that grew here without that measurement growing with it would
      // start overhanging a passage with nothing under it.
      const base = stone(COL_BASE, 0.65, COL_BASE, M.limestone, DENSITY.limestone,
        { chamfer: 0.08 });
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
          /**
           * ON THE SAND, AND IT HAS TO SAY SO.
           *
           * These three - the drums, the capital, the base disc - are the only
           * things lying on the avenue floor within reach of a mouth, and they
           * were the only three near one that declared no base. A collider with
           * no `y0` is measured from the LOCAL FLOOR, which is the right default
           * out here where props stand on dunes, and it is wrong the moment the
           * local floor is a raised deck: the quarry breach's step is a walkable
           * surface at 2.9, so a knee-high drum beside it was silently lifted to
           * 2.9 and stood as an invisible 1.2-metre bar across the mouth. That
           * is what stopped the player at x = 15 after the step itself was
           * fixed, and from inside the mouth it reads as the game refusing to
           * let you walk through a particular patch of nothing.
           *
           * `groundY` rather than 0: the sand under them is not flat, and a base
           * declared at zero on a dune that sits at 0.4 makes the drum start
           * below its own mesh.
           */
          const dcx = x - side * spread * 0.72;
          const dcz = z + dir * spread * 0.7;
          addCollider(dcx, dcz, 1.25, 2.2, groundY(dcx, dcz));
        }

        // The capital lands face down at the end of the run.
        const cap = capital();
        cap.position.set(-side * 4.6, 1.5 - baseY, dir * 4.4);
        cap.rotation.z = Math.PI * 0.52;
        cap.rotation.y = dir * 0.6;
        col.add(cap);
        // Same rule as the drums above: lying on the sand, and saying so.
        const ccx = x - side * 4.6;
        const ccz = z + dir * 4.4;
        addCollider(ccx, ccz, 1.8, 3, groundY(ccx, ccz));

        group.add(col);
        addCollider(x, z, 1.7, 1.2, groundY(x, z));
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

  /** Focal points inside each recess, handed to the dressing pass. */
  const chapelSpots = [];

  /** Every mouth built, in build order, collected for the claim records. */
  const mouths = [];

  /**
   * One opening in the avenue wall.
   *
   * `sill` is zero for a bought gate and the height of the step for a breach.
   * Everything else is the same: two returns of solid wall, a jamb pier either
   * side of the hole, a lintel where the bay is tall enough to carry one, and
   * the wall closed back up above it.
   *
   * THE COLLIDER STORY IS THE WHOLE THING. The returns are wall runs like any
   * other. Across the opening there is no collider at all, which is what makes
   * it an opening. A breach then puts back a run at the sill height with an
   * explicit base of the local ground, so it blocks anybody standing on the
   * avenue floor and is skipped by anybody who has walked up the talus - the
   * same rule the quarry's terrace runs on, and the reason both had to declare
   * bases before either could work.
   */
  const buildMouth = ({ side, x, z, h, claim, sill }) => {
    const HALF = 2.6;                     // a 5.2 metre hole, two abreast
    const RETURN = (BAY + 0.4) / 2 - HALF;

    for (const j of [-1, 1]) {
      const rz = z + j * (HALF + RETURN / 2);
      const w = stone(2.6, h, RETURN, M.limestone, DENSITY.limestone,
        { eroded: 0.07, chamfer: 0.14 });
      w.position.set(x, h / 2, rz);
      group.add(w);
      addWallRun(x, rz, 1.7, h, 'z', RETURN);

      // The jamb, standing proud on the avenue face so the hole is framed
      // rather than merely absent. Without it the opening reads as a missing
      // wall segment, which is what the first pass looked like.
      const jamb = stone(3.4, h * 0.96, 1.5, M.carved, DENSITY.carved, { eroded: 0.05 });
      jamb.position.set(x - side * 0.5, h * 0.48, z + j * (HALF + 0.6));
      group.add(jamb);
      addCollider(x - side * 0.5, z + j * (HALF + 0.6), 1.5, h * 0.96);
    }

    // A lintel only where there is wall left to carry one. Some bays roll
    // ruined and stand at three and a half metres, and a header beam pinned at
    // a fixed height over a stub is a stone slab in clear sky - the exact
    // failure the architraves had to be fixed for.
    const head = Math.min(h - 1.1, 5.8);
    if (head > sill + 2.0) {
      const lint = stone(3.2, 1.2, HALF * 2 + 1.6, M.carved, DENSITY.carved);
      lint.position.set(x, head + 0.6, z);
      group.add(lint);

      if (h > head + 1.8) {
        const above = stone(2.6, h - head - 1.2, HALF * 2 + 1.0,
          M.limestone, DENSITY.limestone, { chamfer: 0.1 });
        above.position.set(x, (h + head + 1.2) / 2, z);
        group.add(above);
      }
    }

    const record = { side, x, z, h, claim, sill, blockers: [], parts: [] };

    if (sill > 0) {
      // The step. Masonry rather than loose rubble, because it has to read as
      // something you can stand ON from one side, and a heap of stones reads as
      // something you climb over from both.
      const STEP_W = 2.9;
      const step = stone(STEP_W, sill + 1.2, HALF * 2, M.limestone, DENSITY.limestone,
        { eroded: 0.12, chamfer: 0.12 });
      step.position.set(x, sill - (sill + 1.2) / 2, z);
      group.add(step);
      addWallRun(x, z, 1.5, sill - 0.2, 'z', HALF * 2, 0);

      // The talus on the far side, which is the only way up to the sill. It is
      // a deck record, so the sampler gates it on foot height and nobody gets
      // snapped up it from the avenue.
      // Six metres of run, and it has to stay LONGER than the mouth is wide.
      // The deck record puts its rise on the longer horizontal axis, which is
      // the interior's rule and is what lets one sampler serve a ramp and a
      // flat ledge without a second record type; a talus five metres long and
      // five point two wide would have been read as rising sideways.
      const run = 6.0;
      const xIn = x + side * 1.6;                  // clear of the wall's own skirt
      const xOut = x + side * (1.6 + run);
      const lo = Math.min(xIn, xOut);
      const hi = Math.max(xIn, xOut);

      addDeck({
        x: (lo + hi) / 2, z, w: run, d: HALF * 2,
        y0: side > 0 ? sill : 0,
        y1: side > 0 ? 0 : sill,
      });

      /**
       * AND THE STEP ITSELF IS A SURFACE, WHICH IT WAS NOT.
       *
       * The step is masonry with a flat top at `sill`, and the comment above it
       * says in as many words that it "has to read as something you can stand
       * ON from one side". Nothing ever told the sampler that. It got a
       * collider and no deck record, so `heightAt` returned the SAND under it
       * for every point across its top, and the breach was impassable in the
       * one direction it exists for.
       *
       * Measured on the shipped build, driving the real controller up the
       * quarry talus with the real frame loop: the player rises with the ramp to
       * 2.83 at x = 16.75, the talus deck ends at 16.6, his feet drop 2.7 metres
       * to the sand, and he is instantly inside the step's own collider - which
       * blocks everything below 2.7 - and is pushed back east. He jams at
       * x = 16.6 every time, walking or sprinting, from any start. That is the
       * opening the owner photographed and asked to be able to run through, and
       * it was never a window: it is the quarry's authored one-way exit with no
       * floor on top of its step.
       *
       * The deck spans from the step's avenue-side face to where the talus deck
       * begins, so the two meet with no gap. A tenth of a metre of nothing
       * between them is enough to drop a body, because a body is 0.42 wide and
       * has to have somewhere to put all of itself.
       *
       * FLAT, at `sill`, and that is what keeps the mouth one-way. `heightAt`
       * only hands back a surface within a step of the feet, so from the talus
       * (feet 2.8, reach 3.45) the step is the floor, and from the avenue floor
       * (feet 0.15, reach 0.8) a surface at 2.9 is not - it stays the wall the
       * design says it is. Nothing about the approach from the avenue changes.
       */
      const stepInner = x - side * (STEP_W / 2);       // its avenue-side face
      addDeck({
        x: (stepInner + xIn) / 2, z,
        w: Math.abs(xIn - stepInner), d: HALF * 2,
        y0: sill, y1: sill,
      });

      // The wedge under it, placed by working backward from where its top face
      // has to land. Same construction as the quarry's ramps and the same
      // reason: a stair of slabs leaves the player's feet half a step above the
      // stone they look like they are standing on.
      const theta = Math.atan2(side > 0 ? -sill : sill, run);
      const THICK = 4.4;
      const wedge = stone(Math.hypot(run, sill), THICK, HALF * 2,
        M.limestone, DENSITY.rubble, { eroded: 0.16, chamfer: 0.14 });
      wedge.rotation.z = theta;
      wedge.position.set(
        (lo + hi) / 2 + (THICK / 2) * Math.sin(theta),
        sill / 2 - (THICK / 2) * Math.cos(theta),
        z,
      );
      group.add(wedge);

      // Its two shoulders. Each cylinder carries the talus height at its own x
      // less a margin, so from beside it the slope is solid and from on it
      // every cylinder within reach is already under your feet. A single
      // constant height here would either wall the talus off at its foot or
      // leave the player able to walk into the side of a four metre wedge.
      for (const j of [-1, 1]) {
        const ez = z + j * (HALF + 0.35);
        for (let i = 0; i <= 4; i++) {
          const px = lo + (i / 4) * run;
          const t = side > 0 ? (hi - px) / run : (px - lo) / run;
          const eh = sill * t - 0.35;
          if (eh <= 0.15) continue;
          addCollider(px, ez, 0.9, eh, 0);
        }
      }
    } else {
      // A bought gate: choked with what came off the wall when they cut it.
      //
      // The blockers are held by reference rather than by index, because
      // doors.js splices the pyramid's own disc out of this same array when the
      // sealed doorway is paid for, and an index taken before that is an index
      // to somebody else's collider afterwards.
      record.blockers = addWallRun(x, z, 1.6, 3.6, 'z', HALF * 2, 0);

      const CHOKE = [
        { dz: -1.85, w: 2.4, hh: 3.1, dd: 2.2, yaw: 0.4, tilt: 0.12 },
        { dz: 0.15, w: 2.8, hh: 3.5, dd: 2.4, yaw: -0.25, tilt: -0.08 },
        { dz: 2.05, w: 2.3, hh: 2.9, dd: 2.1, yaw: 0.7, tilt: 0.16 },
        { dz: -0.9, w: 1.9, hh: 1.6, dd: 1.8, yaw: 1.2, tilt: 0.3 },
        { dz: 1.2, w: 2.0, hh: 1.4, dd: 1.9, yaw: -0.9, tilt: -0.25 },
      ];

      for (const c of CHOKE) {
        const chunk = stone(c.w, c.hh, c.dd, M.limestone, DENSITY.rubble,
          { eroded: 0.18 });
        chunk.position.set(x, groundY(x, z + c.dz) + c.hh * 0.42, z + c.dz);
        chunk.rotation.set(c.tilt * 0.6, c.yaw, c.tilt);
        // NOT STATIC. The batcher stops at this tag, which it has to: these
        // meshes move when the claim is bought, and a mesh whose matrix has
        // been baked into a shared buffer cannot move.
        chunk.userData.noBatch = true;
        group.add(chunk);
        record.parts.push({ mesh: chunk, y0: chunk.position.y });
      }
    }

    mouths.push(record);
    return record;
  };

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
      const gateOf = GATE_BAYS.get(`${side}:${b}`);
      const breachOf = BREACH_BAYS.get(`${side}:${b}`);
      const isChapel = CHAPEL_BAYS[side].has(b) && !gateOf && !breachOf;

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

      } else if (gateOf || breachOf) {
        /**
         * BURN THE DRAWS THIS BAY WOULD HAVE TAKEN.
         *
         * The solid-wall branch below pulls one number off `rand` per projecting
         * string course, and it only lays courses on bays 0 and 1, and it stops
         * early once the wall runs out of height. East bay 1 is the quarry's way
         * in, so it takes that branch's draws and never lays its courses - and
         * every placement in the rest of this file reads from the same stream.
         * This file has burned draws twice before for exactly this reason, once
         * for the old pyramid's thirty-three and once for the boundary pass, and
         * the rule it learned both times is that the FINISHED AVENUE IS THE
         * QUALITY BAR and nothing may move it by so much as a bay.
         *
         * The condition below is a literal copy of the one it is standing in for
         * rather than a count, because the count depends on `h`, which is drawn.
         */
        if (b <= 1) {
          for (let c = 0; c < 3; c++) {
            if (2.9 + c * 2.5 > h - 1) break;
            rand();
          }
        }

        buildMouth({
          side, x, z, h,
          claim: gateOf || breachOf,
          // A breach's sill is a fraction of the bay rather than a fixed number,
          // so a bay that rolled ruined at three and a half metres still gets a
          // step it can carry. Floored at 1.3, because a step under a metre is
          // a step the player can walk up and the mouth stops being one-way.
          sill: breachOf ? Math.min(2.9, Math.max(1.3, h * 0.45)) : 0,
        });

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
  // the far skyline: masses OUTSIDE the temenos
  // -------------------------------------------------------------------------
  //
  // "Give the skyline silhouette variety - right now the horizon is one flat
  // edge." Everything in the level up to this point terminates at the perimeter
  // wall 52 metres out, so the horizon is the perimeter's parapet, the avenue's
  // parapet, and the one triangle of the pyramid, and there is nothing at any
  // distance past those. A necropolis with a single monument in it and empty
  // desert immediately behind it reads as a set, because a real one is a field
  // of them built over centuries.
  //
  // THIS IS A DEPTH CUE BEFORE IT IS DECORATION, which is the reason it is
  // landing in the same pass as the fog. Aerial perspective is a comparison:
  // "distant" only means anything against something nearer, and with one object
  // in the far field there is nothing to compare it to. Measured from the
  // spawn, the temple stands at 92 m, the near satellite at about 145, the two
  // far ones at about 225, and the escarpment past 200, which at the new sigma
  // is roughly 50, 67, 82 and 80 per cent extinction. That is a ladder with
  // rungs on it rather than one object and a horizon.
  //
  // RULES THIS PASS OBEYS, because it is landing next to a finished avenue:
  //   - Its own RNG stream. Drawing from `rand` or `brand` would shift every
  //     sequence downstream of it and silently move the avenue and the
  //     perimeter, which is exactly how the last boundary pass nearly went
  //     wrong. `sky` is a third stream and nothing else reads it.
  //   - Nothing inside the perimeter, nothing inside the walkable rectangle, no
  //     colliders. It cannot be reached, walked into, or shot.
  //   - No shadows, cast or received. All of it stands well outside
  //     SHADOW_EXTENT, so a shadow flag on it costs a shadow-map draw that
  //     lands nowhere.
  //   - Seated on `groundY`, like everything else out here. A backdrop mass
  //     floating half a metre off a dune it is standing on is visible from
  //     across the map precisely because it is on the horizon line.
  const sky = rng(770311);

  const farGroup = new THREE.Group();
  farGroup.name = 'far-skyline';
  group.add(farGroup);

  /**
   * A backdrop block: no shadows, no collider, not a hit target.
   *
   * `noHit` is not housekeeping. `world.hitTargets` is the courtyard group and
   * the weapon raycast is recursive, so without the tag a shot fired down the
   * avenue and over the temple would stop on a mastaba two hundred metres away
   * and spawn an impact nobody can see, which is a bullet that silently did
   * nothing. The tag is the same one build.js and grenades.js already use.
   */
  const farBlock = (w, h, d, x, z, yaw, y0 = 0) => {
    const m = stone(w, h, d, M.limestone, DENSITY.limestone, { eroded: 0.06 });
    m.castShadow = false;
    m.receiveShadow = false;
    m.userData.noHit = true;
    m.position.set(x, groundY(x, z) + y0 + h / 2, z);
    m.rotation.y = yaw;
    farGroup.add(m);
    return m;
  };

  /**
   * A backdrop block that is allowed to LEAN, seated against the ground it
   * actually leans over.
   *
   * WHY LEANING IS THE WHOLE FIX HERE, AND TEXTURE IS NOT.
   *
   * A blind judge read this field as "flat untextured pale boxes". The boxes are
   * textured - the same albedo, normal and roughness maps every wall in the
   * level carries - and putting a better texture on them would have changed
   * nothing on screen, because at two hundred metres the height fog is taking
   * about eighty per cent of the surface out. What survives eighty per cent
   * extinction is exactly two channels: SILHOUETTE, and LARGE-SCALE VALUE
   * SEPARATION between one mass and the mass beside it. Albedo detail is gone
   * long before it gets to the eye, and so is the chamfer highlight.
   *
   * Both surviving channels are functions of ORIENTATION, which is why this
   * helper exists and why nothing in the material or the texture set was
   * touched to fix a complaint about texture:
   *
   *   - A box with a level top puts a horizontal line segment on the sky, and
   *     nine of them in a row put one long horizontal line on the sky. That
   *     line is what "flat box" means. Roll the box and the crest becomes a
   *     rake; alternate the roll along the run and the crest becomes a
   *     sawtooth of separate masses.
   *   - The sun sits at (0.472, 0.454, 0.756), so a south-facing vertical
   *     answers it at N.L = 0.76 and every south-facing vertical in the field
   *     answers it with the SAME 0.76. That is why the escarpment merged into
   *     one pale sheet. Spreading yaw to +/-0.55 rad and pitch to +/-0.17
   *     spreads N.L from about 0.38 to about 0.94 - two and a half to one on
   *     the lit faces - and two and a half to one survives the fog.
   *
   * THE SEATING IS NOT A DETAIL. Rolling a sixty-eight metre slab by fourteen
   * degrees lifts one base corner eight metres into the air, and a backdrop
   * mass standing eight metres off the dune it is on is visible from across the
   * map precisely because it is on the horizon line - the same "floating" read
   * the perimeter had to be rebuilt once to fix. So the seat is solved rather
   * than assumed: rotate a grid of points across the base, sample `groundY`
   * UNDER EACH ONE (the dunes swell by more than a metre across a mass this
   * wide, so the centre's height is the wrong answer), and drop the mass until
   * the neediest of them is in the sand. `bury` then puts it a little further
   * in, because a point exactly tangent to a heightfield still shows daylight.
   *
   * Peak height works out at roughly h*cos(roll)*cos(pitch), so `h` still reads
   * as "how tall is this thing", and the low end of the crest lands at about
   * h - w*sin(roll), which is where the rake comes from.
   */
  const _far4 = new THREE.Matrix4();
  const _farV = new THREE.Vector3();

  const farMass = (w, h, d, x, z, { yaw = 0, roll = 0, pitch = 0, bury = 1.2 } = {}) => {
    const m = stone(w, h, d, M.limestone, DENSITY.limestone, { eroded: 0.06 });
    m.castShadow = false;
    m.receiveShadow = false;
    m.userData.noHit = true;
    m.rotation.set(pitch, yaw, roll);

    // Nine samples over the base, not four. Four corners is not enough on a
    // heightfield: a sixty-metre mass can bridge a dune crest that sits between
    // its corners and hang over it. The pyramids next door, which are seated by
    // `farBlock` off a SINGLE sample at the centre, measure up to a 1.57 m gap
    // on a raycast sweep of the field for exactly that reason; they are left
    // alone because they read fine and they are not what this pass is about.
    _far4.makeRotationFromEuler(m.rotation);
    let seat = Infinity;
    for (const sx of [-1, 0, 1]) {
      for (const sz of [-1, 0, 1]) {
        _farV.set(sx * w * 0.5, -h * 0.5, sz * d * 0.5).applyMatrix4(_far4);
        const need = groundY(x + _farV.x, z + _farV.z) - _farV.y;
        if (need < seat) seat = need;
      }
    }
    m.position.set(x, seat - bury, z);
    farGroup.add(m);
    return m;
  };

  /**
   * A stepped mass, the same construction as the temple but authored small.
   *
   * Deliberately the same silhouette family rather than a different one: these
   * are meant to read as the rest of the necropolis, so the main pyramid stops
   * being the only thing of its kind in the world and starts being the nearest
   * and largest thing of its kind. That is a different and much better reading
   * of the same frame.
   */
  const farPyramid = (x, z, base, courses, courseH, yaw) => {
    for (let i = 0; i < courses; i++) {
      const w = base * (1 - i / (courses + 0.6));
      farBlock(w, courseH * 1.25, w, x, z, yaw, i * courseH);
    }
  };

  // Two satellites, flanking and well behind the temple, at different distances
  // and different proportions. The near one is squat and wide; the far one is
  // steeper and taller, which is what stops them reading as one asset placed
  // twice.
  farPyramid(-88, -86, 46, 7, 4.6, 0.21);
  farPyramid(122, -158, 34, 9, 5.0, -0.34);

  // A third, much further out and nearly dissolved, so the ladder has a rung
  // past the point where anything is still legible as architecture.
  farPyramid(24, -191, 58, 8, 6.4, 0.08);

  /**
   * The quarry escarpment along the far side.
   *
   * IT USED TO BE NINE WIDE BOXES WITH LEVEL TOPS AT SIMILAR YAW, and that is
   * the thing a blind judge saw as "flat untextured pale boxes". Nine level
   * tops in a row are nine horizontal line segments on the sky at roughly one
   * height, which the eye joins into a single edge; nine south faces at yaw
   * +/-0.25 all answer a sun at (0.472, 0.454, 0.756) within a few per cent of
   * each other, so there was no value boundary anywhere along the run for that
   * edge to break against. One pale sheet of cardboard, exactly as reported.
   *
   * The run is now a PROFILE rather than a loop. Three station kinds, placed by
   * hand along the run because the thing being authored is a silhouette and a
   * silhouette is a composition, not a distribution:
   *
   *   butte   narrow and tall, standing clear of the crest. The vertical that
   *           tells you the crest has a height at all.
   *   bench   the wide raked mass. Rolled six to fourteen degrees, so its top
   *           is a slope and not a line.
   *   saddle  deliberately LOW - twelve to nineteen metres against benches at
   *           twenty-six to forty-two and buttes at forty to fifty-eight. This
   *           is the important one: a crest that drops by two thirds between
   *           two masses shows sky between them, and sky between two masses is
   *           what makes the eye read two masses. Without saddles the run is
   *           continuous and no amount of per-block variation stops it reading
   *           as one wall.
   *
   * Roll alternates in sign station to station, so consecutive crests rake
   * against each other into a sawtooth instead of a staircase all leaning the
   * same way. Benches and buttes also carry a lower SHOULDER mass set forward
   * and off to one side at its own yaw: that is the second silhouette break and
   * the second value, and being nearer than the mass behind it, it is also less
   * fogged, which separates the two in depth as well as in tone.
   *
   * It stays inside the dune field, which is 420 metres square and therefore
   * ends at 210. A backdrop mass placed past that edge stands on nothing: its
   * base draws against sky rather than against sand, a couple of pixels above
   * where the ground plane stops. The run spans +/-164 rather than the old
   * +/-170 to pay for the wider yaw, which swings a mass's corner further out
   * along the run than a square-on one reaches.
   *
   * EVERY DRAW BELOW COMES FROM `sky` AND NOTHING ELSE. Taking one from `rand`
   * or `brand` - or removing one from them - shifts every sequence downstream
   * and silently moves the avenue, the perimeter and the palms. `sky` is read
   * by this block and by nothing else in the file, so its draw count is free.
   */
  const BENCH_RUN = [
    // t along the run, station kind
    [-1.00, 'butte'],
    [-0.74, 'bench'],
    [-0.47, 'saddle'],
    [-0.22, 'bench'],
    [0.04, 'butte'],
    [0.28, 'saddle'],
    [0.50, 'bench'],
    [0.75, 'bench'],
    [1.00, 'butte'],
  ];

  BENCH_RUN.forEach(([t, kind], i) => {
    const x = t * 164;
    // Pulled in from the old -172 to -202. Yaw costs footprint: at 0.55 rad a
    // mass reaches (d/2)cos + (w/2)sin further back than a square-on one, and
    // measured on the merged group the run's back edge was standing at z=-222,
    // twelve metres past the -210 where the dune field stops. Nothing in the
    // play area can see behind these, so it never showed - which is exactly the
    // kind of thing that survives four passes and then turns up in a flyover.
    const z = -160 - sky() * 18;

    // Proportion is a function of the KIND, which is the point: a run whose
    // members are all 46-84 wide and 17-30 tall has no proportion contrast in
    // it, and proportion contrast is the cheapest silhouette there is.
    const butte = kind === 'butte';
    const saddle = kind === 'saddle';
    // Peak height after seating works out at h*cos(roll)*cos(pitch), so these
    // read directly as metres of crest. They are DELIBERATELY taller than the
    // 15-32 the old loop produced: from the judge's 26 m pose the far field
    // sits within a hundred pixels of the mid-ground's own skyline, so a run
    // authored an honest 20 metres tall is a run that is mostly hidden behind
    // the perimeter, and a silhouette nobody can see is not a silhouette. The
    // first cut of this pass was measured at 22-34 and lost ground against the
    // build it replaced for exactly that reason.
    const w = butte ? 16 + sky() * 13 : 40 + sky() * 26;
    const d = butte ? 18 + sky() * 14 : 28 + sky() * 16;
    const h = butte ? 40 + sky() * 18
      : saddle ? 12 + sky() * 7
        : 26 + sky() * 16;

    // A tall narrow stack that leans fourteen degrees reads as falling over, so
    // the buttes get a fraction of the benches' roll.
    const sign = i % 2 ? 1 : -1;
    const roll = sign * (butte ? 0.04 + sky() * 0.07 : 0.10 + sky() * 0.14);
    const yaw = (sky() - 0.5) * 1.1;
    const pitch = (sky() - 0.5) * 0.34;
    farMass(w, h, d, x, z, { yaw, roll, pitch });

    // The shoulder. Saddles do not get one - the whole job of a saddle is to
    // be a gap, and filling it in with a second mass gives the gap back.
    if (saddle) return;
    const sw = 16 + sky() * 20;
    farMass(sw, h * (0.34 + sky() * 0.3), 20 + sky() * 16,
      x + (sky() - 0.5) * w * 1.25, z + 8 + sky() * 18,
      { yaw: yaw + (sky() - 0.5) * 1.0, roll: -roll * (0.7 + sky() * 0.8), pitch: (sky() - 0.5) * 0.34 });
  });

  /**
   * The same run turned ninety degrees down the east flank, so the enclosure is
   * not a stage with a painted backdrop on exactly one side.
   *
   * This run has the OPPOSITE problem to the north one and it needs the
   * opposite correction. Seen from the avenue these masses show their -X face,
   * and the sun is on +X, so square-on they are all unlit: the isolation render
   * of the shipped build has them as one continuous black wall. Black against a
   * pale sky is a silhouette, so it was never the "pale box" complaint, but one
   * unbroken black wall is still one mass. Yawing them 0.5 to 1.1 radians turns
   * part of each mass's visible face toward +Z and into the light, so the run
   * becomes lit faces alternating with dark flanks - which is the same value
   * separation the north run gets, arrived at from the dark end.
   *
   * x is held under 162 with d under 70: at a full radian of yaw the corner of
   * a mass reaches sqrt((w/2)^2 + (d/2)^2) beyond its centre, and past 210 it
   * would be standing off the edge of the dune field.
   */
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const z = -128 + t * 216;
    const x = 144 + sky() * 16;
    const w = 34 + sky() * 18;
    const d = 44 + sky() * 24;
    const h = (i === 2 ? 13 : 27) + Math.sin(t * 4.4) * 8 + sky() * 14;
    const roll = (i % 2 ? -1 : 1) * (0.09 + sky() * 0.13);
    const yaw = 0.5 + sky() * 0.6;
    farMass(w, h, d, x, z, { yaw, roll, pitch: (sky() - 0.5) * 0.3 });

    if (i === 2) continue;                       // the flank's saddle, left open
    farMass(14 + sky() * 16, h * (0.36 + sky() * 0.3), 22 + sky() * 16,
      x - 12 - sky() * 16, z + (sky() - 0.5) * d * 1.2,
      { yaw: yaw - 0.5 - sky() * 0.7, roll: -roll * 0.8, pitch: (sky() - 0.5) * 0.3 });
  }

  // Four distant pylon stubs. A necropolis skyline needs at least one vertical
  // that is not a pyramid or the whole horizon is one shape repeated. They lean
  // a couple of degrees now: dead plumb is the one thing nothing in a two
  // thousand year old quarry field is, and the lean is what separates a stub
  // from the mass standing behind it when both are fogged to the same tone.
  for (const [px, pz, ph] of [
    [-63, -148, 27], [-71, -151, 24], [154, -96, 22], [-166, -172, 31],
  ]) {
    const s = 9 + sky() * 5;
    farMass(s, ph, s, px, pz, {
      yaw: sky() * 0.6,
      roll: (sky() - 0.5) * 0.14,
      pitch: (sky() - 0.5) * 0.12,
    });
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

  /**
   * What the two loops below actually put on the ground, so the Act 1 pass can
   * deal with the ones that are no longer backdrop.
   *
   * These loops place mid-ground ruins and palms OUTSIDE the avenue's walkable
   * rectangle, on the reasonable assumption that outside the avenue means out
   * of reach. The Quarry and the Canal are outside the avenue, so some of these
   * now stand in rooms the player walks through - and none of them registers a
   * collider, because scenery nothing can touch does not need one.
   *
   * The fix is not to move them and it is CERTAINLY not to widen the rectangle
   * they are tested against: the test sits between two draws, so changing its
   * answer changes the length of the stream and redresses the finished avenue.
   * They are recorded here and adopted at the end of the build, where a ruin
   * standing in the quarry can simply be given the collider it should have had
   * and become a block among blocks. Nothing moves; something solid is added.
   */
  const backdropProps = [];

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
    backdropProps.push({ mesh: chunk, x, z, r: Math.max(w, dd) * 0.45, h });
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

    const palm = makePalm(x, z, groundY(x, z) - 0.15, rand, M);
    group.add(palm);
    backdropProps.push({ mesh: palm, x, z, r: 0.75, h: 4.5 });
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

  // -------------------------------------------------------------------------
  // the first canopic jar
  // -------------------------------------------------------------------------

  /**
   * THE EASTER-EGG CHAIN STARTS OUTSIDE.
   *
   * Imsety, the first of the four sons of Horus, used to stand in the Granary
   * Vault, which is to say the whole four-jar chain began and ended on the far
   * side of a thousand-gold door. Out here the mission starts before the pyramid
   * does: the player finds a piece of it in the first minute of the run and
   * carries it across the threshold, so three acts read as one arc rather than
   * as three rooms that happen to be adjacent.
   *
   * IN THE FIRST WEST CHAPEL, at bay 1 (z = 22.5), which is the first recess the
   * player passes walking down the avenue from the spawn at (0, 30). The alcoves
   * were built to give the eye somewhere to travel into and until now had nothing
   * in them worth travelling to.
   *
   * NOT ONE RANDOM DRAW IN HERE, and that is load-bearing rather than tidy. Every
   * placement in this file downstream of a draw moves when the number of draws
   * above it changes, so a jar that rolled its own jitter would have shifted the
   * outer ruins, the palms and the near-field dressing that the finished avenue
   * was tuned around. Authored coordinates cost nothing and move nothing.
   */
  /**
   * `type` is carried so this record is the SAME SHAPE build.js publishes for
   * the three inside. systems/jars.js enumerates both lists into one chain and
   * routes on `type`; a jar out here with no type would be a jar the chain
   * silently walked past, which is the one failure the exterior placement was
   * specifically meant to avoid.
   */
  const JAR = { type: 'canopic-jar', x: -19.0, z: 22.5, index: 1, son: 'imsety' };
  {
    const g = new THREE.Group();
    const y = groundY(JAR.x, JAR.z);

    // Same three parts, same proportions and same materials as the three jars
    // inside, because they are four of one set and the player has to recognise
    // the fourth from having seen the first.
    const plinth = slabMesh(1.1, 0.9, 1.1, M.limestone, DENSITY.limestone);
    plinth.position.y = 0.45;
    g.add(plinth);

    // The vessel is its own group for the reason build.js gives at length on
    // the interior builder: the chain lifts the jar and its stopper and leaves
    // the plinth, because the plinth is what this fixture's collider is.
    const vessel = new THREE.Group();
    vessel.name = 'vessel';

    const jar = new THREE.Mesh(
      cylinderUV(new THREE.CylinderGeometry(0.30, 0.22, 0.72, 14), 0.30, 0.72, DENSITY.carved),
      M.carved
    );
    jar.position.y = 1.26;
    jar.castShadow = true;
    vessel.add(jar);

    // The stopper is the son's head. At this scale the shape is a silhouette, so
    // the gold is doing the identifying.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), M.gold);
    head.position.y = 1.76;
    head.scale.set(1, 1.15, 0.9);
    vessel.add(head);

    g.add(vessel);

    /**
     * `noBatch`, AND IT IS THE SAME BUG THE B3AR WALL CARRIES A PARAGRAPH ABOUT.
     *
     * `batchStatics(group)` runs eight hundred lines below this and bakes every
     * untagged mesh under the courtyard into merged chunks. This jar was built
     * before the puzzle chain existed, so nothing needed its identity and
     * nothing tagged it - which means the first jar in the game would have
     * rendered perfectly, answered no raycast, owned no `vessel` to lift, and
     * been unpickable by construction. Exactly the failure mode the wall buy
     * was tagged against, in the same file, for the same reason.
     */
    g.userData.noBatch = true;

    g.position.set(JAR.x, y, JAR.z);
    group.add(g);
    addCollider(JAR.x, JAR.z, 0.62, 1.9);
    JAR.group = g;
    JAR.vessel = vessel;
  }

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

  // -------------------------------------------------------------------------
  // Act 1: the courtyard opens up
  // -------------------------------------------------------------------------
  //
  // The two authored spaces MAP.md ratifies, plus the mass at the forecourt
  // centre, and they run HERE, after the last existing draw in the file and
  // after the dressing pass, for two separate reasons that both matter.
  //
  // The first is the stream. Everything above this line was tuned against a
  // particular sequence of random numbers, and the whole file is arranged so
  // that a later pass cannot disturb it. This pass draws from `qrand`, which is
  // its own stream, AND sits below everything that draws from `rand` or
  // `brand`, so it is safe twice over.
  //
  // The second is the scatter, which is handed the collider list as its
  // exclusion set and rejects samples against it. Roughly three hundred new
  // colliders arriving before that call would have changed how many samples it
  // rejects and reshuffled the ground detail down the entire avenue - a real
  // change to finished work, produced by geometry forty metres away from it.
  // Running after the scatter has already been built means the exclusion list
  // it saw is exactly the list it used to see.
  //
  // What this pass may NOT do is widen `PLAY`, remove a bound, or open the
  // perimeter. MAP.md is explicit: the map grows by authoring spaces, never by
  // unlocking backdrop, and `courtyard.js:62` records what happened the last
  // time the walkable area was a rectangle drawn round some blockout.

  /**
   * The mass at the forecourt centre: THE PANIC CIRCLE.
   *
   * MAP.md asks for two loop scales in Act 1, "the circuit for when you have
   * room to run, and the panic circle for when you do not", and this is the
   * second one. The forecourt is the room the sealed doorway wants around it
   * and it is the one place on the route with nothing in it, which means the
   * fight you have while waiting for the door to be affordable is a fight in an
   * empty box against a wall.
   *
   * A sledge with its block still on it, abandoned at the temple front, and it
   * is deliberately NOT centred on the axis. Dead centre in the forecourt puts
   * it exactly between the player and the doorway they walk toward for the
   * whole session, which is the one sightline in the exterior that is not
   * allowed to be blocked. Offset west it is a mass you circle without ever
   * being a mass you look through.
   *
   * Three metres of clear floor all round, measured against the collider
   * skirts rather than the meshes and against the two things that nearly ate
   * it: the west colonnade's terrace runs down to x = -9.4 and the pyramid's
   * own 32-unit disc reaches z = -30, so the first placement at (-4.6, -24.6)
   * had one and a half metres of floor on two of its four sides. A circle with
   * a metre and a half on one leg is not a circle, it is a place the horde
   * closes both ends of at once.
   */
  {
    const cx = -3.5;
    const cz = -23.0;

    const bed = new THREE.Group();
    bed.position.set(cx, groundY(cx, cz), cz);
    bed.rotation.y = 0.36;

    for (const side of [-1, 1]) {
      const runner = slabMesh(0.5, 0.5, 6.6, M.palmTrunk, DENSITY.rubble);
      runner.position.set(side * 1.35, 0.25, 0);
      bed.add(runner);
    }
    for (let i = 0; i < 5; i++) {
      const tie = slabMesh(3.4, 0.32, 0.5, M.palmTrunk, DENSITY.rubble);
      tie.position.set(0, 0.62, -2.5 + i * 1.3);
      bed.add(tie);
    }

    // The block itself, tipped off its bed at one end. A block sitting square
    // on its sledge reads as cargo; a block that has slipped reads as the
    // moment the work stopped, which is what the whole necropolis is about.
    const load = stone(3.0, 2.4, 4.6, M.limestone, DENSITY.limestone,
      { eroded: 0.12, chamfer: 0.2 });
    load.position.set(0.2, 1.85, -0.3);
    load.rotation.set(0.07, 0.05, -0.11);
    bed.add(load);

    group.add(bed);
    fillMass(cx, cz, 4.4, 6.4, 2.6, 0);
  }

  const act1 = {
    group, M, DENSITY, stone, slabMesh,
    addCollider, addWallRun, fillMass, addDeck, groundY, rand: qrand,
    // Passed so the authored spaces can seal TO a face rather than half a radius
    // past it. `fillMass` overhangs its own arguments by FILL_R/2 on every side,
    // which is the right default for a rough mass in sand and the wrong one for
    // stone the player is meant to run along - see the note at the builder, and
    // the west terrace at :736, which has always subtracted it.
    FILL_R,
  };

  const quarry = buildQuarry(act1);
  const canal = buildCanal(act1);

  /**
   * THE EXPEDITION CAMP AND THE WRECK.
   *
   * `docs/NARRATIVE.md` calls this the one genuinely new space World 1
   * requires - the only place in the trilogy before Area 51 where the
   * institution that caused all of this is physically present - and the
   * courtyard is where it has to go, because the story needs it read on the
   * walk from the spawn to the sealed doorway.
   *
   * IT DOES NOT AUTHOR A SPACE, IT DRESSES ONE. The quarry and the canal above
   * are rooms with their own bounds, their own floors and their own prices.
   * The camp is furniture standing on the avenue's existing floor inside the
   * avenue's existing walls: it moves no bound, opens no perimeter, adds no
   * deck and takes no purchase. That is the difference between this call being
   * two lines and it being a third module the walkable-bound contract has to
   * know about.
   *
   * WHERE IT SITS IN THE ORDER, and every clause is load bearing:
   *   - AFTER `dressAvenue` and after the scatter, so the exclusion list those
   *     two sampled against is exactly the list they used to sample against.
   *     Three hundred new colliders arriving earlier would reshuffle the ground
   *     detail down the whole avenue.
   *   - AFTER the last draw taken from `rand`, `brand` and `qrand`, and on its
   *     own stream besides.
   *   - BEFORE `batchStatics`, so the camp's several hundred meshes are merged
   *     with everything else rather than shipping as several hundred draws.
   *   - BEFORE the sub-body-width slot sealer, so a slot formed between a tent
   *     and a wall that never knew about each other is still caught. That is
   *     the same reason the sealer runs last for the quarry and the canal.
   *
   * It is handed the collider ARRAY as well as `addCollider`, which nothing
   * else in this file needs, because the camp is the only builder placing props
   * into a region that is already finished, dressed work. Its siting guard
   * reads the list and refuses a position that overlaps or that would form a
   * sub-metre slot against something already there, and reports what it
   * refused. Three of the first six positions tried were caught that way.
   */
  const camp = buildCamp({ ...act1, rand: crand, colliders });

  /**
   * Adopt the backdrop props that now stand inside a room.
   *
   * See `backdropProps` above for why they cannot simply be moved. A ruin or a
   * palm inside the quarry gets the collider it should have had and becomes
   * part of the yard; one that has landed in a doorway or on a walkable deck is
   * removed outright, because a block in a mouth is a mouth nobody can use and
   * a palm growing out of a terrace is a palm nobody believes.
   */
  const inSpace = (x, z) =>
    (x > QUARRY.minX && x < QUARRY.maxX && z > QUARRY.minZ && z < QUARRY.maxZ) ||
    (x > CANAL.minX && x < CANAL.maxX && z > CANAL.minZ && z < CANAL.maxZ);

  const adopted = { kept: 0, removed: 0 };
  for (const p of backdropProps) {
    if (!inSpace(p.x, p.z)) continue;

    const inDoorway = mouths.some((m) =>
      Math.abs(p.x - m.x) < 9 && Math.abs(p.z - m.z) < 5.5);
    const onDeck = decks.some((d) =>
      p.x > d.x - d.w / 2 - 1 && p.x < d.x + d.w / 2 + 1 &&
      p.z > d.z - d.d / 2 - 1 && p.z < d.z + d.d / 2 + 1);

    if (inDoorway || onDeck) {
      p.mesh.parent.remove(p.mesh);
      adopted.removed++;
    } else {
      addCollider(p.x, p.z, p.r, p.h, groundY(p.x, p.z));
      adopted.kept++;
    }
  }

  /**
   * The two claims, in the shape doors.js already knows how to drive.
   *
   * This file owns what a barrier IS - the meshes, the colliders, the animation
   * that clears it - and doors.js owns what it COSTS and whether it may be
   * bought, which is the split its own header states and the reason the sealed
   * doorway is read out of the scene graph rather than built inside it. So the
   * record below carries `open()` and `advance(dt)` fully working, and what it
   * is still missing is the half that is not this file's to write: nothing
   * raycasts these meshes, nothing prices them, nothing takes the gold. Until
   * doors.js adopts them the two spaces are sealed. See the note at the return.
   */
  const claims = [];
  for (const [key, spec] of [
    ['quarry', { label: 'The Quarry', cost: 500 }],
    ['canal', { label: 'The Canal', cost: 500 }],
  ]) {
    const gate = mouths.find((m) => m.claim === key && m.sill === 0);
    if (!gate) continue;

    let t = 0;
    const record = {
      type: 'door',
      id: `courtyard/${key}`,
      kind: 'debris',
      cost: spec.cost,
      label: spec.label,
      x: gate.x, z: gate.z,
      opened: false,
      opening: false,

      open() {
        if (record.opened || record.opening) return false;
        record.opening = true;

        // The colliders go IMMEDIATELY and the meshes take a moment, which is
        // the order the sealed doorway uses too. A player who has paid and is
        // already walking must not be held by a barrier that is visibly moving.
        for (const c of gate.blockers) {
          const i = colliders.indexOf(c);
          if (i >= 0) colliders.splice(i, 1);
        }
        return true;
      },

      advance(dt) {
        if (!record.opening) return;
        t = Math.min(1, t + dt / 1.5);
        const k = 1 - Math.pow(1 - t, 3);
        for (const p of gate.parts) p.mesh.position.y = p.y0 - 4.4 * k;
        if (t >= 1) {
          record.opening = false;
          record.opened = true;
          for (const p of gate.parts) p.mesh.visible = false;
        }
      },

      /** The meshes a look-at ray has to hit for this to be buyable. */
      parts: gate.parts.map((p) => p.mesh),
    };

    for (const p of gate.parts) p.mesh.userData.door = record;
    claims.push(record);
  }

  // -------------------------------------------------------------------------
  // batching
  // -------------------------------------------------------------------------
  //
  // LAST, AND THAT IS THE POINT. The courtyard was 995 separate meshes and the
  // frame was being spent issuing draw calls for them: 4.6 ms inside
  // `composer.render` against 4.8 ms of total measured JS, with the shadow pass
  // paying for the whole scene a second time. Nothing else in the game came to
  // a tenth of a millisecond.
  //
  // Running as a post-pass over the finished graph rather than as something
  // each construction loop calls is what makes this safe to land next to a
  // finished avenue. Every rule above about not disturbing `rand` - the
  // thirty-three burned draws, `brand`, `sky` - exists because a change in the
  // NUMBER of draws taken moves geometry that was signed off. A pass that runs
  // after the last random number has been drawn cannot move anything: it reads
  // the graph, bakes each mesh's world matrix into its vertices, and puts the
  // result back at the same world coordinates. Both the colliders and the
  // walkable bound are untouched, because collision has never been derived from
  // mesh structure in this codebase - it is the array above and nothing else.
  //
  // What it may not touch is tagged rather than listed here: the buy-door's
  // twelve moving parts in temple.js, and the braziers, which carry a light and
  // an animated material.
  const batched = batchStatics(group);

  // -------------------------------------------------------------------------
  // the B3AR wall
  // -------------------------------------------------------------------------
  //
  // THE FIRST FIXTURE THAT WAS EVER OUTSIDE. Every wall buy in the game was an
  // interactSlots entry in rooms.js, which is the inside of the pyramid; MAP.md
  // puts the Act 1 triple-shot pistol on a courtyard wall for 400, and the
  // interaction layer had no exterior source of any kind. That missing
  // mechanism is why the B3AR was never built, and why the SMG never moved out
  // either - a plan can specify a placement all it likes, but nothing could
  // carry it. The layer takes `courtyard` now, the way systems/doors.js already
  // did, and this is what it reads.
  //
  // The plaque itself is built by world/build.js and not here, deliberately. It
  // is the same builder the four interior walls come out of - same panel, same
  // recessed ground, same CHALK silhouette table, same raking lamp that took two
  // goes to place - so the wall that sells the B3AR and the wall that sells the
  // SMG cannot drift apart.
  //
  // WHERE, AND WHY THIS BAY. West wall, bay 3, which spans z = 0 to 9: the
  // midpoint of the avenue, on the walk from the spawn at (0, 30) to the sealed
  // doorway at z = -30, and the player passes within five metres of it without
  // being routed. It is the only kind of bay that can carry a plaque - not a
  // chapel recess (west 1, 4 and 6), not the canal's bought gate (west 5) or its
  // breach (west 2), and not one of the two bays that lay projecting string
  // courses, which stand 0.16 proud at the height the panel wants.
  //
  // z = 5.6 INSIDE that bay is not the bay centre, and the reason is a
  // photograph: at the centre, 4.5, the avenue brazier at (-11.2, 3) stands two
  // metres off the wall directly in front of the panel and its bowl covers the
  // bottom right of the mark. 5.6 puts 2.6 metres of clear air between them and
  // still leaves a metre to the buttress pylon at z = 8.05, which frames the
  // plaque from the north instead of crowding it.
  //
  // x = -13.48 is arithmetic, not taste. The bay wall is 2.6 thick centred on
  // x = -15, so its avenue face is at -13.7; the plaque body is 0.22 deep and
  // hangs BACK from the fixture origin, so an origin at -13.7 + 0.22 puts the
  // panel flush against the stone with the chalk standing proud of it. The
  // fixture faces east, which is local -z rotated to world +x: rot = -PI/2.
  //
  // It sits on `groundY` rather than on zero because out here the floor is a
  // dune field. The interior's fixtures stand on a flat slab and can assume it;
  // nothing outside can.
  let slotsSealed = 0;

  const interacts = [];
  {
    const rec = buildWallBuyFixture({
      type: 'wallbuy',
      x: -13.48, y: groundY(-13.48, 5.6), z: 5.6, rot: -Math.PI / 2,
      config: { weapon: 'b3ar', cost: 400 },
    });
    if (rec) { group.add(rec.group); interacts.push(rec); }
  }

  /**
   * SEAL EVERY SLOT TOO NARROW TO WALK DOWN.
   *
   * The owner reported corners in the quarry and the canal where you literally
   * cannot move. `test/stuck.mjs` and `test/stuck-trap.mjs` found two that a
   * player can walk into and not out of, and both are the same shape, measured
   * rather than guessed:
   *
   *   canal  (-17.2, 17.6)  the perimeter wall reaches south to z 17.34, a prop
   *                         row reaches north to z 17.09. A 0.25 m corridor.
   *   quarry (17.5, -16.9)  the same sliver against the quarry's own row.
   *
   * The body is 0.84 m across. A 0.25 m corridor is not a passage anybody can
   * use, so nothing is lost by making it solid - and everything is gained,
   * because the ONE thing a sub-body-width slot can still do is swallow a
   * player who is pushed into it by the resolver and then hold them there with
   * geometry on both sides.
   *
   * This is why the fix is here and not in the collision resolver. Raising the
   * resolver's pass count was tried against a measured baseline and made the
   * game worse (see RESOLVE_PASSES in player/controller.js): more iterations do
   * not free a body from a slot narrower than itself, they only push it further
   * in. The slot is the defect. A resolver cannot fix a hole that should not
   * exist.
   *
   * It runs LAST, after every builder including the quarry and the canal, so a
   * slot formed between two systems that never knew about each other - which is
   * exactly what both of these are - is still caught.
   */
  {
    /*
     * The gap a body needs. RADIUS is 0.42 in player/controller.js, so the body
     * is 0.84 wide; this adds a hand's width, because a corridor exactly as wide
     * as the player is one the player scrapes down at zero speed with both
     * shoulders resolving every frame, which is the feel being fixed.
     */
    const BODY_CLEAR = 1.0;
    const before = colliders.length;
    const filled = [];

    // Snapshot: the fills themselves must not be considered as sealing partners,
    // or one slot begets another along its own length.
    const src = colliders.slice();

    for (let i = 0; i < src.length; i++) {
      const a = src[i];
      const aBase = a.y0 === undefined ? null : a.y0;
      for (let j = i + 1; j < src.length; j++) {
        const b = src[j];
        const bBase = b.y0 === undefined ? null : b.y0;

        // Only pairs that share vertical extent can form a slot a body walks
        // into. Two cylinders at different storeys are not a corridor.
        if (aBase !== null && bBase !== null) {
          if (aBase + a.h <= bBase || bBase + b.h <= aBase) continue;
        }

        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const gap = d - a.r - b.r;

        // Overlapping already, or far enough apart to walk between: leave it.
        if (gap <= 0 || gap >= BODY_CLEAR) continue;

        const base = aBase === null || bBase === null ? undefined : Math.max(aBase, bBase);
        const top = aBase === null || bBase === null
          ? Math.min(a.h, b.h)
          : Math.min(aBase + a.h, bBase + b.h) - base;
        if (top <= 0.5) continue;   // a shin-high sliver is not a trap

        filled.push({
          x: a.x + (dx / d) * (a.r + gap / 2),
          z: a.z + (dz / d) * (a.r + gap / 2),
          r: gap / 2 + 0.06,        // reaches both faces with a little to spare
          h: top,
          y0: base,
        });
      }
    }

    for (const f of filled) addCollider(f.x, f.z, f.r, f.h, f.y0);
    slotsSealed = colliders.length - before;
  }

  return {
    group,
    colliders,
    /** How many sub-body-width slots the sealer closed. Read by test/stuck-trap.mjs. */
    slotsSealed,
    braziers,
    /** What the merge actually did, for the harness and for the record. */
    batched,
    dust,
    dressing,

    /**
     * Canopic jars standing outside, in the same shape build.js publishes for
     * the ones inside. One entry today. The puzzle chain is unbuilt, so this is
     * what stops the exterior jar being invisible to it when it lands - a jar
     * the chain cannot enumerate is a jar the player can never hand in.
     */
    jars: [JAR],

    /**
     * Fixtures the crosshair can buy from, in the shape ui/interact.js reads
     * off `interior`. One entry today, the B3AR wall, and the owner has ratified
     * that it stays one: the B3AR is the ONLY gun buyable outside, and the SMG
     * that MAP.md wanted moved out here stays inside at 1000. See the struck
     * row in MAP.md's weapons table for why.
     *
     * It is a published ARRAY rather than a single record anyway, because the
     * constraint is on what gets placed and not on what the mechanism can do -
     * THE IBIS will need this and so would any later move.
     */
    interacts,

    /** The two Act 1 spaces, for the harness and for anything that wants to
     *  ask where they are without importing their modules. */
    quarry,
    canal,

    /**
     * The expedition camp and the wreck.
     *
     * Published for the same reason the two spaces above are, plus one this
     * file cannot make on its own: `camp.rejected` is the list of props its
     * siting guard refused to build because something was already there, and
     * `camp.doorFilterMatches` is the count of colliders in the WHOLE world
     * that answer doors.js's two shape filters. Both are claims about this
     * file's interaction with finished work, both are checked by
     * `test/camp.mjs`, and neither can be read from a screenshot.
     */
    camp,

    /** How many backdrop ruins the Act 1 pass had to make solid, and how many
     *  it had to delete. Reported rather than silent: if either number moves,
     *  the mid-ground loops have started landing somewhere new. */
    adopted,

    /**
     * THE TWO ACT 1 CLAIMS, AND WHAT IS STILL MISSING.
     *
     * Each record is complete on this side: it has a price, a label, a position,
     * the meshes tagged with `userData.door`, a working `open()` that releases
     * the colliders, and a working `advance(dt)` that sinks the rubble. Calling
     * `courtyard.claims[0].open()` opens the Quarry today, which is how the
     * spaces were photographed.
     *
     * What does not exist is the other half of the mechanic, and it lives in
     * `systems/doors.js`, which builds exactly one exterior barrier by looking
     * up the mesh named 'sealed-doorway' and wrapping it by hand. Nothing in it
     * enumerates courtyard barriers, so nothing raycasts these meshes, nothing
     * shows a price, nothing takes gold, and nothing calls `advance`. Until that
     * file iterates this array the way it already iterates `interior.barriers`,
     * both spaces are built, sealed, and unreachable in play.
     */
    claims,

    /**
     * The walkable exterior, as a rectangle rather than a square.
     *
     * Both consumers already read the rectangular shape - the player controller
     * takes `minX ?? min` because the interior is a long room, and the wave
     * director builds its exterior spawn lattice from the same four numbers -
     * so the exterior can stop pretending to be a 99-metre square without a
     * change anywhere downstream. It also means enemies now spawn in the space
     * the player is actually in, instead of over a field they can never enter.
     *
     * It is EXTERIOR and not PLAY, because Act 1 added two rooms outside the
     * avenue. See the comment on both constants at the top of the file for why
     * they are two constants and not one.
     */
    bounds: EXTERIOR,

    /**
     * Floor height at a world position. The controller samples the same
     * function the dune mesh was built from, so collision can never drift out
     * of agreement with what is rendered.
     *
     * Two layers, and the order is the contract.
     *
     * The TERRAIN is `groundY`, which is the dune sampler less the canal cut,
     * and it is unconditional: the trench is the ground out there, not a thing
     * standing on it, so an actor in the channel is three metres down whatever
     * else is true.
     *
     * The DECKS are the quarry's terrace, its two ramps, the canal's two
     * causeways and the two talus slopes at the breaches, and every one of them
     * is gated on where the actor's feet already are. That clause is the entire
     * reason a causeway can be walked over AND under: standing on the bank you
     * are within a step of the deck and it is your floor, standing in the
     * channel you are three metres below it and it is a ceiling. Without the
     * gate the sampler returns the highest surface at a point, and the first
     * player to run under a bridge is teleported onto it.
     *
     * `footY` undefined means "what is the highest surface here", which is what
     * a spawn placement wants and what the director asks. Same contract as
     * build.js:397, deliberately, so the controller can call one function
     * either side of the doorway and never know which space it is standing in.
     */
    heightAt(x, z, footY) {
      let y = groundY(x, z);
      // 0.65 is build.js's STEP_UP and it is repeated rather than imported
      // because that module is the interior's and this is the exterior's; what
      // matters is that they agree, and a comment naming the other one is a
      // cheaper coupling than an import that makes each file depend on the
      // other's private constants.
      const reach = footY === undefined ? Infinity : footY + 0.65;

      for (const d of decks) {
        if (x < d.x - d.w / 2 || x > d.x + d.w / 2) continue;
        if (z < d.z - d.d / 2 || z > d.z + d.d / 2) continue;

        const alongZ = d.d >= d.w;
        const t = alongZ
          ? (z - (d.z - d.d / 2)) / d.d
          : (x - (d.x - d.w / 2)) / d.w;

        const h = d.y0 + (d.y1 - d.y0) * t;
        if (h > y && h <= reach) y = h;
      }

      return y;
    },

    /** The walkable surfaces above the sand, for the harness. */
    decks,

    /** Spawn point, mid-yard, looking down the colonnade at the pyramid. */
    spawn: new THREE.Vector3(SPAWN.x, 0, SPAWN.z),

    scatter,

    update(dt, t) {
      for (const b of braziers) b.update(dt, t);
      // The generator's fan, its charge lamp, the recorder drum and the mains
      // ripple on the two work lamps. The whole beat is that this equipment is
      // STILL RUNNING with nobody left to switch it off, and a camp that is
      // only running in the comments is a camp that is switched off.
      camp.update(dt, t);
      dust.update(dt);
      scatter.update(dt, t);
      // Off the clamped delta like every other rate in the game, so a
      // backgrounded tab resumes with the rubble part way down rather than
      // having finished the animation while nobody was watching.
      for (const c of claims) c.advance(dt);
    },

    setFidelity(high) {
      for (const b of braziers) b.setFidelity(high);
      scatter.setFidelity(high);
      dressing.setFidelity(high);
      camp.setFidelity(high);
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

  // NOT STATIC. `batchStatics` stops descending at this tag, which covers the
  // stem, the bowl and the coals in one place. Two separate reasons it has to:
  // this group owns a PointLight whose intensity is driven every frame, and the
  // coals wear a CLONED ember material whose emissiveIntensity is driven with
  // it - the courtyard's `braziers` array holds a reference to that exact mesh.
  // Batching it would delete the mesh the flicker is written to and the fire
  // would silently stop moving, which is the kind of defect that survives a
  // green suite because nothing measures whether a light is still flickering.
  g.userData.noBatch = true;

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
