/**
 * THE EXPEDITION CAMP AND THE DOWNED HELICOPTER.
 *
 * The only modern thing in World 1, and the only place in the trilogy before
 * Area 51 where the institution that caused all of this is physically present.
 * `docs/NARRATIVE.md` states the fact this space exists to make true without a
 * line of text: "There is a camp outside the pyramid with nobody in it and the
 * generators are still running." Everything below is that sentence, built.
 *
 * TWO BEATS, IN THE ORDER THE PLAYER WALKS THEM.
 *
 *   1. THE CAMP, z 27 down to 19. The arrival. Tents standing and shut,
 *      a generator still turning over, two work lamps still burning in
 *      daylight, an instrument array still writing a trace nobody is reading,
 *      and seven stencilled transit cases laid out across the last few metres
 *      of it. The message is: people came here on purpose, with equipment, and
 *      are not here now.
 *
 *   2. THE WRECK, z 18 down to 9. The departure that failed. Something tried
 *      to leave and did not. It is four days old and cold: down and broken,
 *      never exploded and never burning.
 *
 * The order is not an accident of siting. It is the whole point: an abandoned
 * camp on its own reads as "they left", and only the wreck behind it says they
 * could not.
 *
 * WHY THE NAMES ARE ON THE CRATES AND NOT ONLY ON THE INTRO CARD.
 *
 * The intro card is skippable and no load-bearing fact may live only on a
 * surface the player can miss. So the seven names are stencilled on seven
 * transit cases across the camp's south edge, at eye-down distance on the
 * walking line, facing NORTH so they are read on approach rather than in the
 * rear-view. PORTER, B. is the archaeologist the player follows for the whole
 * world and her case gets no emphasis whatsoever: she is one line of seven
 * until much later, and a highlight here would spend the reveal forty minutes
 * early.
 *
 * WHY THE HELICOPTER IS UNMARKED.
 *
 * No insignia, no national markings, and the tail number PAINTED OVER rather
 * than absent. An aircraft with no number was never issued one; an aircraft
 * with a rectangle of not-quite-matching paint where its number was had one
 * taken away, and that is the cover-up made physical. It is on the STARBOARD
 * boom, which faces away from the walking line, so it is found by a player who
 * walks around the tail and by nobody else. Nothing depends on finding it.
 *
 * WHY THE ROTOR MATTERS MORE THAN THE AIRFRAME.
 *
 * It is the only non-Egyptian shape on the skyline and nothing else in the
 * world reads like it. So the mast, hub and blades survive the crash even
 * though the airframe does not: two blades drooped to the sand, one bent up
 * mid-span, one sheared at the root with its outer section standing in the sand
 * eight metres away like a stele. The disc is canted, because a level disc seen
 * from a 1.68 m eye height is a line.
 *
 * ------------------------------------------------------------------------
 * FOUR CONSTRAINTS THIS FILE IS WRITTEN AGAINST, ALL OF THEM SCARS
 * ------------------------------------------------------------------------
 *
 * 1. IT MAY NOT MOVE THE AVENUE. Everything here draws from its own PRNG
 *    stream (`crand` in courtyard.js), is built after the last draw taken by
 *    `rand`, `brand` and `qrand`, and after the scatter has already sampled the
 *    collider list. courtyard.js states the rule three times over and burns
 *    thirty-three draws to keep it: THE FINISHED AVENUE IS THE QUALITY BAR.
 *
 * 2. IT MAY NOT REGISTER A COLLIDER ANY DOOR FILTER COULD CATCH.
 *    `releaseDoorway` finds the slab by (|x|<0.2, |z+30.2|<0.2, 2.5<r<4) and
 *    the pyramid by (|x|<0.2, |z+62|<0.5, r>25). Nothing here is south of
 *    z = 8, so neither filter can see any of it. `assertNoDoorFilterMatch`
 *    below proves that at build time rather than trusting the arithmetic.
 *
 * 3. NO CONTINUOUS COLLIDER WALL. The 8/01 playtest found the canal's barge
 *    wreck registered a 13 m unbroken run and trapped the player against it.
 *    The helicopter is a SINGLE CONVEX CHAIN along one axis with open floor on
 *    every side - no U shapes, no alcoves, nothing to be cornered in - and the
 *    seven cases are three clusters with two-metre gaps rather than one nine
 *    metre line. `test/camp.mjs` drives a circuit rather than believing it.
 *
 * 4. NOTHING IS PLACED AT THE SPAWN. `NARRATIVE.md` calls this the most
 *    protected decision in the project: the first frame of the game is a man
 *    standing on his own grave and the game never says so. courtyard.js keeps
 *    SPAWN_CLEARANCE = 9 around (0, 30) and so does every placement here, which
 *    is also why the camp curves - it is an arc at ten to fourteen metres,
 *    which is what a camp pitched around an open middle looks like anyway.
 *
 * THE GRADIENT. `docs/WORLD-1.md` sets Act 1 as SUN-BLEACHED - "rope frayed,
 * chalk washed out, a survey peg leaning over, weeks old" - against Act 2 crisp
 * and Act 3 warm. So the canvas here is bleached to nearly white, the cordage
 * is grey rather than tan, and the two work lamps are COLD white. The warm
 * lamps belong to her, four hours ahead, at the bottom of the pyramid.
 */

import * as THREE from 'three';
import { box, plane, cylinderUV } from './uv.js';
import { chamferedBox, chamferFor } from './geometry.js';
import { propMaterials, catenary } from './propkit.js';
import { buildTextures } from './textures.js';

// ---------------------------------------------------------------------------
// the site
// ---------------------------------------------------------------------------

/**
 * Every authored position in this file, in one table, because siting is the
 * decision that is worth reviewing and the geometry is not.
 *
 * These numbers were not chosen by reading courtyard.js. They were chosen by
 * running a free-floor probe over the shipped scene on a one-metre grid - "can
 * a 0.42 m body stand here" against the real collider array through the real
 * `heightAt` - and picking the holes. The avenue is already dressed, and three
 * of the first six positions tried in this file landed inside a railing, a
 * brazier skirt or a chapel jamb that nothing in the source would have warned
 * about. `site()` below re-runs that test at build time so the next person to
 * move one of these numbers finds out immediately rather than in a screenshot.
 */
export const CAMP = {
  /** The seven, in the order NARRATIVE.md lists them. Alphabetical, no rank. */
  names: [
    'ADLER, M.',
    'HOLM, J.',
    'MARCHETTI, R.',
    'NAKASHIMA, E.',
    'OYELARAN, T.',
    'PORTER, B.',
    'VANCE, D.',
  ],

  /** The spawn, and the radius nothing here may enter. Mirrors courtyard.js. */
  spawn: { x: 0, z: 30 },
  spawnClearance: 9.0,

  /**
   * THE WALKING LINE, AND WHY IT IS ITS OWN RULE.
   *
   * The player spawns at x 0 and the sealed doorway is at x 0. The first thing
   * anybody does in this game is hold forward, and that walk is a straight line
   * down the middle of the avenue.
   *
   * The slot rule below protects props from each other and the spawn clearance
   * protects the first nine metres. Neither of them knows this line exists, and
   * on 2026-08-08 the third stencilled case landed at x 0.70 with r 0.48 - two
   * tenths of a metre over the line, thirteen metres from spawn, and 0.84 m
   * tall against a 0.75 m step-over.
   *
   * MEASURED, against a HEAD build with no camp in it: the control walks the
   * whole avenue at x 0.000 and stops in the doorway at z -26.58. The same walk
   * with that one crate present slides to x -0.55 by z 16, never recovers the
   * centre, and ends jammed in the corner at x 3.16, z -28.43 - past the door
   * it was walking to. One prop, two tenths of a metre, and the player does not
   * arrive at the entrance to the building the game is about.
   *
   * It cost twenty-nine failures in `test/interior.mjs`, none of which mentioned
   * a crate: they said the doorway was not the look target, the prompt did not
   * quote a price, the slab never moved. A body that cannot reach a door reports
   * the door as broken.
   *
   * HALF A BODY OF MARGIN EITHER SIDE, not a clean pass. A prop that merely
   * fails to overlap still makes the player scrape along it, and a scrape steers
   * - which is the whole defect. `laneHalfWidth` is the body radius plus that
   * margin, and a disc may not reach inside it anywhere along the avenue.
   */
  lane: { x: 0, fromZ: 30, toZ: -30.2 },
  laneHalfWidth: 0.42 + 0.42,

  /**
   * WHERE THE CAMP ACTUALLY FITS, WHICH IS NOT WHERE IT WAS FIRST DRAWN.
   *
   * The first pass put the camp in the north avenue, z 20 to 30, on the
   * reasoning that the player should meet it immediately. Then the guard was
   * run and the north avenue turned out to have almost no floor left in it:
   * the 9 m spawn clearance alone reaches z = 21 on the centreline, and what it
   * does not take, the existing dressing does - a railing at z 25 spanning
   * x -9.4 to -3.4, a scaffold at (-8.0, 24.6), a crate row at z 21 spanning
   * x 4.8 to 10, and a cart line down the east at x 9. Measured against a
   * 1 m clearance the whole band z 23 to 27 is unusable at every radius.
   *
   * So the camp sits where there IS floor: a west pocket at x -11 to -6 and the
   * open ground from z 13 to 22, with the wreck below it in the room from z 5
   * to 13. The order the player reads them in survives intact, which was the
   * only thing that mattered - camp first, wreck second - and the two are now
   * close enough that both are in the same frame from the spawn, which is
   * better than the first plan rather than a compromise on it: the tents read
   * against the pyramid and the rotor reads past the tents.
   *
   * The camp still SPREADS across the whole north avenue, because most of what
   * a camp is made of - the collapsed tent, the cable runs, the pegs, the
   * spilled kit - is under the 0.75 m step-over bar and registers no collision
   * at all. It reads big and blocks almost nothing, which is the correct
   * proportion for a wave 1 to 3 arena.
   */

  /** Tents. `w` runs east-west, `d` north-south, `h` is the ridge. */
  tents: [
    // The command tent: the biggest thing in the camp and the one that carries
    // the silhouette. Shut, and that is the point - you cannot get in, because
    // there is nobody to let you in.
    { key: 'command', x: -8.6, z: 18.6, w: 3.4, d: 4.6, h: 2.75, yaw: 0.06, solid: true },
    // A two-man ridge tent, pitched off the axis of the first and well east of
    // it, because two tents squared to each other read as a diagram.
    { key: 'ridge', x: 9.4, z: 16.8, w: 2.6, d: 3.2, h: 2.25, yaw: -0.34, solid: true },
    // The third came down. No collider: it is 0.7 m at the peak and the whole
    // of this file follows dressing.js's STEP_OVER rule - anything you could
    // step over is decoration and does not get to stop you. Which is also why
    // it can stand where nothing solid could, out in the north avenue where the
    // camp needs to read from the spawn.
    { key: 'collapsed', x: -10.6, z: 27.4, w: 3.0, d: 3.8, h: 0.70, yaw: 0.9, solid: false },
  ],

  /** The generator, at the camp's south-west corner with the cables running
   *  back up to the lamps. */
  generator: { x: -4.2, z: 13.8, yaw: 0.5 },

  /**
   * The two work lamps, and they are the only lights this file adds.
   * See `LIGHT BUDGET` at buildCamp for what they cost and why there are two.
   */
  lamps: [
    { x: -10.2, z: 22.9, yaw: 2.1 },     // over the camp, from the north-west
    { x: 11.0, z: 10.6, yaw: -1.9 },     // over the wreck's tail, from the east
  ],

  /**
   * The array that is still logging, and the table with the recorder on it.
   *
   * WEST, off the centreline, and that is a correction rather than a choice.
   * The first siting put the tripod at (-1.0, 19.4), which is a 3.4 m mast with
   * a canister on top standing in the middle of the one exterior sightline that
   * is not allowed to be blocked: a capture from the spawn had it covering the
   * sealed doorway outright. Off the axis it does a better job anyway, because
   * the mast now leads the eye ACROSS the frame toward the wreck instead of
   * standing in front of the thing the player is walking to.
   */
  instrument: { x: -5.8, z: 22.0, yaw: 0.35 },
  fieldTable: { x: -4.7, z: 22.6, yaw: -0.5 },

  /** A tarpaulin staked over a stack of gear nobody came back for. */
  tarp: { x: 2.2, z: 19.8, yaw: 0.4 },

  /**
   * The seven cases, in THREE CLUSTERS with walkable gaps.
   *
   * One row of seven at 1.15 m spacing is an eight metre collider wall across
   * the lane, which is the canal barge defect restated in crates. Three
   * clusters leave gaps of 3.1 and 1.5 metres - wider than the 0.84 m body and
   * wider than the 1.0 m that courtyard.js's slot sealer fills in - so the line
   * is cover you break through rather than a fence you walk to the end of.
   *
   * It runs ACROSS the lane rather than along it, at the camp's south edge,
   * because the player is walking south and a line across his path is read and
   * a line beside it is passed. Staggered in z by a few tens of centimetres
   * because gear put down by people is never on a survey line.
   *
   * ---------------------------------------------------------------------------
   * CLUSTERS B AND C MOVED 0.90 m EAST ON 2026-08-09, AND THE GAP WAS ALWAYS THE
   * POINT - IT WAS JUST IN THE WRONG PLACE
   * ---------------------------------------------------------------------------
   *
   * The a-to-b gap was 2.24 m of clear floor and it ran from x -2.02 to x +0.22.
   * The player walks down x = 0. So the widest gap in the row missed the only
   * line anybody actually walks by two tenths of a metre, and case 3 caught the
   * body on its left shoulder every single run.
   *
   * Nothing about the design was wrong. The row still reads as three clusters,
   * the gaps are still walkable, the stagger is untouched. The gap is simply
   * centred on the walk now instead of beside it, which is what "cover you break
   * through" required all along. See CAMP.lane, and the guard that now enforces
   * it so this cannot be re-authored by hand.
   */
  cases: [
    { name: 0, cluster: 'a', x: -4.80, z: 17.50 },
    { name: 1, cluster: 'a', x: -3.65, z: 17.40 },
    { name: 2, cluster: 'a', x: -2.50, z: 17.30 },
    { name: 3, cluster: 'b', x: 1.40, z: 17.10 },
    { name: 4, cluster: 'b', x: 2.55, z: 17.00 },
    { name: 5, cluster: 'c', x: 5.05, z: 16.80 },
    { name: 6, cluster: 'c', x: 6.00, z: 16.70 },
  ],

  /**
   * THE WRECK.
   *
   * Sited in the open room the guard found below the camp - z 5 to 13, x -3 to
   * +11 - because the one thing this object has to support is a full circuit
   * around it, and because `MAP.md` calls the courtyard "the worst of the four"
   * for trainability: "a straight corridor with recessed pockets, closed at
   * both ends, NOTHING TO CIRCLE". This is the something to circle.
   *
   * `yaw` is -3pi/4, which points the nose north-west: up the avenue, away
   * from the pyramid, back the way it came in. It was leaving.
   *
   * It is EAST of the centreline and every solid part of it stays east of
   * x = 2.4, so the one exterior sightline that is not allowed to be blocked -
   * spawn to the sealed doorway, which the player walks toward for the whole
   * session - is clear. The sledge at the forecourt centre was moved off axis
   * for exactly this reason and the note is at courtyard.js:2688. The one part
   * that reaches further west is the drooped north-west blade, whose tip lands
   * at x = 1.3 and 1.3 m off the ground: clear of the walking line, and under
   * the cone that the nine-metre doorway subtends from the spawn.
   */
  wreck: {
    x: 5.0, z: 10.6,
    yaw: -Math.PI * 0.75,
    roll: 0.26,          // canted onto the collapsed starboard skid
    pitch: -0.09,        // nose down into the sand
  },

  /** Where the sheared blade tip came to rest: south-west of the wreck, on
   *  the walking line, so the player passes it on the way to the pyramid. */
  shearedBlade: { x: 0.6, z: 6.4, yaw: 0.9, lean: 0.62 },
};

/** Tiles per world unit, per surface. Matched to the prop kit's own table. */
const DENSITY = {
  hull: 1.05,
  rotor: 1.4,
  canvas: 0.85,
  cord: 2.4,
  metal: 1.6,
};

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

let matCache = null;

/**
 * The camp palette.
 *
 * Deliberately NOT drawn from the registry in materials.js. Every material in
 * there carries the world-space weathering injection, which is exactly right
 * for limestone standing in a necropolis and exactly wrong for a machine that
 * arrived four days ago: the whole read of this space is that the modern kit
 * has NOT been here long enough to be weathered by the same rule the tomb has.
 * The prop kit's timber, cord, cloth and iron ladders ARE reused, through
 * `propMaterials()`, because a rope is a rope.
 *
 * Metalness is kept well under 1 for the reason propkit.js states: a fully
 * metallic surface has no diffuse response, and with the procedural path
 * running without an environment map it renders black.
 */
/**
 * The camp's cloth maps at a given thread count, CLONED.
 *
 * `buildTextures()` caches one set of canvas textures and hands the same three
 * objects to everybody who asks. A THREE.Texture's `repeat` lives on the
 * texture, not on the material, so setting it in place would change the thread
 * count of every other thing sharing that map - the tarpaulin would silently
 * re-scale the tents. `clone()` keeps the decoded image (the expensive part is
 * shared) and gives each material its own repeat.
 *
 * Two numbers rather than one because tent panels are not square. A wall three
 * metres long and two high wants more repeats across than up, or the weave
 * stretches, and a stretched weave is the most obvious tell there is.
 */
function cloth(rx, ry) {
  const w = buildTextures().canvasWeave;
  const at = (t) => {
    const c = t.clone();
    c.repeat.set(rx, ry);
    // A clone starts life with needsUpdate false and its own uuid; the image is
    // already uploaded, but the repeat is a uniform that has to be pushed.
    c.needsUpdate = true;
    return c;
  };
  return { map: at(w.map), normalMap: at(w.normalMap), roughnessMap: at(w.roughnessMap) };
}

function campMaterials() {
  if (matCache) return matCache;
  const P = propMaterials();

  matCache = {
    /**
     * The airframe. Grey-green, unmarked, dulled by four days of blown sand.
     * It is close enough to the prop kit's drab to belong to the same
     * institution as the ammunition crates already on the avenue, and far
     * enough from the sand palette to read as intrusion at forty metres, which
     * is the only job it has on the skyline.
     */
    hull: new THREE.MeshStandardMaterial({
      // LIGHTER THAN IT WANTS TO BE ON PAPER, and the first pass was not. At
      // 0x5b6154 / metalness 0.30 the airframe rendered as a black cutout from
      // every angle where the sun was behind it - metalness suppresses diffuse
      // response, and with no environment map there is nothing to put back. The
      // shaded side of a helicopter has to stay READABLE AS A HELICOPTER,
      // because the shape is the entire payload of this object.
      color: 0x7b8175, roughness: 0.70, metalness: 0.18, name: 'camp-hull',
    }),

    /** Underside, door recesses, anything that wants to sit back. */
    hullDark: new THREE.MeshStandardMaterial({
      color: 0x585d51, roughness: 0.78, metalness: 0.16, name: 'camp-hull-dark',
    }),

    /**
     * THE PAINTED-OVER TAIL NUMBER.
     *
     * A repaint never matches, and that mismatch IS the story. It is one value
     * step lighter and a touch greener than the hull and rougher than it, which
     * is what a brush coat over a sprayed finish actually looks like. Too close
     * and nobody ever sees it; too far and it reads as damage rather than as
     * somebody having done it on purpose.
     */
    patch: new THREE.MeshStandardMaterial({
      color: 0x8d947f, roughness: 0.90, metalness: 0.06, name: 'camp-patch',
    }),

    /** Rotor blades and the tail rotor: dark composite, near matte. */
    rotor: new THREE.MeshStandardMaterial({
      color: 0x3b3e37, roughness: 0.58, metalness: 0.18, name: 'camp-rotor',
    }),

    /**
     * Glass. Opaque, and that is a budget decision rather than an oversight: a
     * transparent material costs a sort and buys a view of an empty cabin
     * interior that would then have to be built. Low roughness so it catches
     * the sky, which is what makes a windscreen read as glass at distance.
     */
    glass: new THREE.MeshStandardMaterial({
      color: 0x1b2228, roughness: 0.18, metalness: 0.16, name: 'camp-glass',
    }),

    /** Soot aft of the exhaust. Four days cold, so a stain and not a fire. */
    soot: new THREE.MeshStandardMaterial({
      color: 0x22231f, roughness: 0.97, metalness: 0.0, name: 'camp-soot',
    }),

    /**
     * Tent canvas, bleached almost white. This is the Act 1 end of the camp
     * gradient in WORLD-1.md: weeks in this sun takes everything out of a
     * fabric. DoubleSide because a tent panel is a single sheet and its inside
     * is visible through the door.
     *
     * THE COLOUR IS UNCHANGED AND THE WEAVE IS NEW. `textures.js`'s
     * `canvasWeave` is painted neutral precisely so these two hexes keep doing
     * their job: the tent and the tarpaulin are one cloth a shade apart, and
     * that relationship lives here, not in the painter.
     *
     * Until 2026-08-27 both of these were a flat colour with no maps, which is
     * why a tent two metres from a stencilled ammunition crate read as a
     * cardboard cutout standing next to a prop.
     */
    canvas: new THREE.MeshStandardMaterial({
      color: 0xd9d3c0, roughness: 0.97, metalness: 0.0,
      // Thread count, not a style knob. At 2.2 x 3.0 a single yarn was about
      // four millimetres on screen at two metres and the tent read as knitwear.
      // Heavy duck is roughly 12 threads to the centimetre; these numbers put
      // the weave just past the point where the eye stops resolving individual
      // threads and starts reading "cloth", which is where it should sit.
      ...cloth(7, 9),
      side: THREE.DoubleSide, name: 'camp-canvas',
    }),

    /** The tarpaulin. Same fabric, one shade down, so the two read as a set. */
    tarp: new THREE.MeshStandardMaterial({
      color: 0xbfb9a4, roughness: 0.97, metalness: 0.0,
      // A tarpaulin is a coarser cloth than a tent wall and it is a smaller
      // object, so it takes fewer threads across it, not more.
      ...cloth(5, 5),
      side: THREE.DoubleSide, name: 'camp-tarp',
    }),

    /** Case bodies. The SAME hex the stencil atlas fills its ground with, so
     *  a stencilled face and an unstencilled one are one object. */
    caseBody: new THREE.MeshStandardMaterial({
      color: 0x59604a, roughness: 0.85, metalness: 0.10, name: 'camp-case',
    }),

    /** Cable, and the rubber feet everything modern stands on. */
    rubber: new THREE.MeshStandardMaterial({
      color: 0x1e1f1d, roughness: 0.95, metalness: 0.0, name: 'camp-rubber',
    }),

    /**
     * The lamp lens. Emissive so the fixture reads as ON even at midday and
     * even on LOW, where the PointLight's range is cut. A practical whose only
     * evidence is the light it casts stops existing the moment the budget
     * moves; a practical with a hot lens does not.
     *
     * COLD white, against a warm key over sandstone. That contrast is the
     * loudest single statement in the camp that this equipment is not from
     * here, and it is the Act 1 end of the lamp gradient.
     */
    lens: new THREE.MeshStandardMaterial({
      color: 0xdfe9ff, roughness: 0.3, metalness: 0.0,
      emissive: 0xcfe0ff, emissiveIntensity: 2.6, name: 'camp-lens',
    }),

    /** The instrument readout. Green phosphor, the one saturated thing here. */
    screen: new THREE.MeshStandardMaterial({
      color: 0x0d1a12, roughness: 0.35, metalness: 0.0,
      emissive: 0x39d07a, emissiveIntensity: 1.5, name: 'camp-screen',
    }),

    /** The generator's running lamp. Cloned per instance, because it blinks. */
    led: new THREE.MeshStandardMaterial({
      color: 0x2b1210, roughness: 0.4, metalness: 0.0,
      emissive: 0xff5522, emissiveIntensity: 2.2, name: 'camp-led',
    }),

    /** Recorder paper: the trace nobody is reading. */
    paper: new THREE.MeshStandardMaterial({
      color: 0xe8e2d2, roughness: 0.95, metalness: 0.0, name: 'camp-paper',
    }),

    /** From the kit, by reference, so a rope here matches a rope anywhere. */
    cord: P.cord[1],
    iron: P.iron[0],
    rust: P.iron[1],
    timber: P.timber[2],
    drab: P.drab[0],
    drabDark: P.drab[2],
  };

  return matCache;
}

// ---------------------------------------------------------------------------
// the stencil atlas
// ---------------------------------------------------------------------------

/**
 * SEVEN NAMES, ONE TEXTURE, ONE MATERIAL.
 *
 * The obvious build is a canvas per case, which is seven textures and seven
 * materials, and `batch.js` keys its merge on `material.uuid` - so seven
 * materials is seven draw calls that can never be folded together, for two
 * hundred bytes of text. One atlas with seven rows and per-face UVs into it is
 * one texture, one material, and one merged draw for the whole manifest.
 *
 * The ground is filled with the case body's own hex rather than left white, so
 * the painted panel and the box it is painted on are the same colour by
 * construction and cannot drift apart when somebody retunes one of them.
 *
 * THE BRIDGES ARE DRAWN, NOT PUNCHED. A real stencil letter has gaps where the
 * counters would fall out, and the natural way to get them is
 * `globalCompositeOperation = 'destination-out'`, which on an opaque canvas
 * punches holes in the panel itself rather than in the paint. So the bridges
 * are three thin bars painted back over the text in the ground colour, which is
 * both correct and one composite mode simpler.
 */
function stencilAtlas(names) {
  const W = 1024;
  const ROW = 128;
  const H = ROW * names.length;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');

  const GROUND = '#59604a';
  const PAINT = '#e6e2d4';

  g.fillStyle = GROUND;
  g.fillRect(0, 0, W, H);

  // Wear, before the paint. A perfectly even panel is the clone tell, and
  // these are cases that have been in and out of an aircraft.
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 900; i++) {
    const s = 1 + rnd() * 5;
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.055)';
    g.fillRect(rnd() * W, rnd() * H, s, s * (0.4 + rnd()));
  }

  for (let i = 0; i < names.length; i++) {
    const y0 = i * ROW;

    // A scuff per panel, so no two rows are the same panel with different text.
    g.fillStyle = 'rgba(0,0,0,0.13)';
    g.fillRect(rnd() * W * 0.7, y0 + 8 + rnd() * (ROW - 30), 40 + rnd() * 200, 3 + rnd() * 5);

    // ---- the name, fitted to the panel rather than assumed to fit
    g.fillStyle = PAINT;
    g.textBaseline = 'alphabetic';
    let size = 74;
    g.font = `bold ${size}px "Courier New", "DejaVu Sans Mono", monospace`;
    const target = W * 0.86;
    const w = g.measureText(names[i]).width;
    if (w > target) {
      size = Math.floor(size * (target / w));
      g.font = `bold ${size}px "Courier New", "DejaVu Sans Mono", monospace`;
    }
    const nameW = g.measureText(names[i]).width;
    const nameX = (W - nameW) / 2;
    const nameBase = y0 + ROW * 0.63;
    g.fillText(names[i], nameX, nameBase);

    // The bridges. Three bars across the cap band, thin enough to vanish at
    // player standoff and unmistakable at arm's length.
    g.fillStyle = GROUND;
    const capTop = nameBase - size * 0.72;
    for (const t of [0.24, 0.55, 0.84]) {
      g.fillRect(nameX - 6, capTop + size * 0.72 * t, nameW + 12, Math.max(2, size * 0.035));
    }

    // ---- the lot line. No agency, no country, no flag: seven cases issued to
    // seven named people by nobody, which is the file being closed in advance.
    g.fillStyle = 'rgba(230,226,212,0.72)';
    const small = Math.round(ROW * 0.155);
    g.font = `bold ${small}px "Courier New", "DejaVu Sans Mono", monospace`;
    const lot = `FIELD KIT  ${String(i + 1).padStart(2, '0')}/07`;
    g.fillText(lot, nameX, y0 + ROW * 0.87);
  }

  const t = new THREE.CanvasTexture(canvas);
  // SRGB, like every other canvas texture in this project (textures.js and
  // temple.js both default their `toTexture` to it). A colour map left in
  // linear space renders washed out, and on a panel whose whole job is
  // legibility that is the difference between paint and a smudge.
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/**
 * A quad carrying row `i` of the atlas.
 *
 * PlaneGeometry's UVs are rewritten in place rather than the texture being
 * offset/repeated per mesh, because an offset lives on the MATERIAL and there
 * is one material for all seven. Per-vertex UVs are per-geometry, survive the
 * matrix bake in batch.js untouched, and are therefore the only way seven
 * different names can share one draw call.
 */
function stencilFace(w, h, row, rows, mat) {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv;
  const v0 = 1 - (row + 1) / rows;
  const v1 = 1 - row / rows;
  for (let i = 0; i < uv.count; i++) {
    uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  }
  uv.needsUpdate = true;
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

/**
 * A panel: chamfered where a chamfer would be visible, plain where it is not.
 *
 * `chamfer: false` is an explicit REFUSAL and not a missing value, which is why
 * it cannot go through `?? 0` - nullish coalescing passes `false` straight
 * through to `chamferFor`, which would then treat it as a floor of zero and
 * chamfer the member anyway. propkit.js's `blockMesh` draws the same
 * distinction and this is the same policy in one place, so no call site has to
 * remember it and no thin member accidentally costs 44 triangles.
 */
function panel(w, h, d, mat, density = DENSITY.hull, { chamfer = null, cast = true } = {}) {
  const min = Math.min(w, h, d);
  const wants = chamfer !== false && min >= 0.10;
  const geo = wants
    ? chamferedBox(w, h, d, chamferFor(w, h, d, chamfer === null ? 0 : chamfer), density)
    : box(w, h, d, density);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

/** A tube with world-scale UVs. Open-ended where the caps are buried. */
function tube(rTop, rBot, h, seg, mat, density = DENSITY.metal, open = false) {
  const m = new THREE.Mesh(
    cylinderUV(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open),
      Math.max(rTop, rBot), h, density),
    mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

/**
 * @param {object} ctx  the courtyard's own vocabulary, handed over intact:
 *   the same collider array through `addCollider`, the same ground sampler,
 *   the same group, and an INDEPENDENT PRNG stream. canal.js takes the same
 *   shape for the same reason - a second way to build a wall in this codebase
 *   is a second way for a wall to leak.
 */
export function buildCamp(ctx) {
  const { group, addCollider, groundY, rand } = ctx;
  const M = campMaterials();

  const g = new THREE.Group();
  g.name = 'camp';                    // batch.js re-parents merges here, and
  group.add(g);                       // setFidelity traverses it

  /**
   * SITING GUARD.
   *
   * Every position in CAMP goes through this before anything is built. It asks
   * the one question the source cannot answer: is there already something
   * here? The avenue is finished, dressed work with three hundred colliders in
   * the region this camp occupies, and three of the first six positions tried
   * in this file landed inside a railing, a brazier skirt and a chapel jamb
   * respectively. None of those would have thrown, and all three would have
   * shipped as a prop growing out of another prop.
   *
   * It also rejects a position that would form a SLOT rather than an overlap.
   * courtyard.js's slot sealer fills any gap under BODY_CLEAR = 1.0 with solid
   * collision, which means a prop landing 0.4 m from a wall does not read as a
   * near miss - it silently welds itself to that wall and takes the floor
   * between them with it. So the guard demands either a clean metre of daylight
   * or nothing at all.
   *
   * And it enforces the spawn clearance, which is doctrine rather than physics.
   *
   * Rejections are COUNTED AND RETURNED, not silently swallowed. A camp that
   * quietly loses its generator is worse than one that fails loudly, and
   * `test/camp.mjs` asserts the count is zero.
   */
  const SLOT = 1.0;
  const rejected = [];
  const sited = [];

  /**
   * Every collider this file registers, kept so the guard can test camp props
   * against each other and so `test/camp.mjs` can walk the chain rather than
   * take this file's word for its shape.
   */
  const campColliders = [];

  /**
   * IT TESTS THE DISCS THE PROP WILL ACTUALLY REGISTER, NOT A CIRCLE ROUND IT.
   *
   * The first version of this guard took a centre and one radius, and it
   * refused the command tent, the generator and the tarpaulin - all three of
   * them for "slotting" against something between 0.86 and 0.99 m away, and all
   * three of them wrongly. A 3.4 by 4.6 tent has a circumradius of 2.86, so a
   * single circle bulges 1.4 m past the corners of its own footprint and
   * reports a clash with stone the tent has two and a quarter metres of
   * daylight from.
   *
   * A guard that fails conservatively is not free. It rejects real placements,
   * and then the author moves the prop somewhere worse to satisfy an instrument
   * that was measuring the wrong thing. So the caller hands over the exact list
   * of cylinders it is about to add and every one of them is tested.
   */
  /**
   * THE WORLD AS IT WAS BEFORE THIS FILE TOUCHED IT.
   *
   * `solid()` appends into the SAME array the guard reads, so without this the
   * second case in a cluster is judged against the first and the lamp is judged
   * against the tent that was pitched four lines earlier - both under the slot
   * rule, which is the wrong rule for two pieces of one prop. Freezing the
   * length at entry is the whole fix and it costs nothing, because the array is
   * only ever appended to.
   */
  const preCamp = (ctx.colliders || []).length;

  const site = (key, discs) => {
    for (const d of discs) {
      const spawnGap = Math.hypot(d.x - CAMP.spawn.x, d.z - CAMP.spawn.z) - d.r;
      if (spawnGap < CAMP.spawnClearance) {
        rejected.push({ key, x: d.x, z: d.z,
          why: `inside spawn clearance (${spawnGap.toFixed(2)} m of the 9)` });
        return false;
      }

      /*
       * THE WALKING LINE. See CAMP.lane for what this cost when it did not
       * exist. Only discs the player could actually walk into are tested - a
       * disc under the step-over bar is stepped on, not steered by.
       */
      if ((d.h ?? 1) >= STEP_OVER
          && d.z <= CAMP.lane.fromZ && d.z >= CAMP.lane.toZ) {
        const intrude = CAMP.laneHalfWidth - (Math.abs(d.x - CAMP.lane.x) - d.r);
        if (intrude > 0) {
          rejected.push({ key, x: d.x, z: d.z,
            why: `reaches ${intrude.toFixed(2)} m into the walking line `
              + `(needs ${CAMP.laneHalfWidth.toFixed(2)} m of clearance from x ${CAMP.lane.x})` });
          return false;
        }
      }

      const world = ctx.colliders || [];
      for (let i = 0; i < preCamp; i++) {
        const c = world[i];
        const gap = Math.hypot(d.x - c.x, d.z - c.z) - c.r - d.r;
        if (gap < SLOT) {
          rejected.push({ key, x: d.x, z: d.z,
            why: `${gap < 0 ? 'overlaps' : 'slots against'} `
              + `(${c.x.toFixed(1)}, ${c.z.toFixed(1)}) r${c.r.toFixed(2)} `
              + `by ${gap.toFixed(2)} m` });
          return false;
        }
      }
      /**
       * CAMP AGAINST CAMP, and the rule is different on purpose.
       *
       * Two pieces of the SAME prop - the twelve discs under one tent, two
       * cases in one cluster - are 0.19 m apart because that is what a stack of
       * gear looks like, and the slot sealer welding them into a single solid
       * clump is the right answer rather than a defect. Two DIFFERENT props get
       * the full slot rule like anything else, because a lamp mast a third of a
       * metre from a tent is the same trap whether or not one file built both.
       */
      for (const c of campColliders) {
        if (c.key === key) continue;
        const gap = Math.hypot(d.x - c.x, d.z - c.z) - c.r - d.r;
        if (gap < SLOT) {
          rejected.push({ key, x: d.x, z: d.z,
            why: `${gap < 0 ? 'overlaps' : 'slots against'} own prop ${c.key} `
              + `by ${gap.toFixed(2)} m` });
          return false;
        }
      }
    }
    sited.push({ key, discs });
    return true;
  };

  /** Register collision, and never for anything a player could step over. */
  const STEP_OVER = 0.75;
  const solid = (key, x, z, r, h) => {
    if (h < STEP_OVER) return;
    addCollider(x, z, r, h, groundY(x, z));
    campColliders.push({ key, x, z, r, h });
  };

  const jit = (a) => (rand() - 0.5) * 2 * a;

  // =========================================================================
  // 1. THE CAMP
  // =========================================================================

  // --- tents ---------------------------------------------------------------
  //
  // SHUT, and solid. A tent you can walk into is a room with one door, which is
  // a dead end for the player and a corner for the horde, and this space is a
  // wave 1 to 3 arena. It is also the wrong read: a tent you can enter invites
  // you to look for who is inside, and the whole beat is that there is nobody
  // to let you in. Closed canvas with the door laced from the OUTSIDE says the
  // last person out expected to come back.

  /**
   * The grid of cylinders a tent's footprint seals, in world coordinates.
   *
   * ONE FUNCTION, used by the guard to decide and by the builder to register,
   * so there is exactly one description of what a tent occupies. The alternative
   * - a radius for the test and a loop for the build - is two representations
   * of the same fact, which is the class of bug this codebase has been bitten
   * by nine times and the reason `canalDepthAt` is one function serving the
   * mesh, the player, the mummies and the grenades.
   *
   * A grid rather than an inscribed disc for the reason courtyard.js gives at
   * `fillMass`: one cylinder inside a 3.4 by 4.6 rectangle leaves all four
   * corners open and the player walks into the middle of the canvas.
   */
  const TENT_R = 0.62;
  const tentDiscs = (t) => {
    const out = [];
    const nx = Math.max(1, Math.ceil((t.w - TENT_R) / (TENT_R * 1.3)));
    const nz = Math.max(1, Math.ceil((t.d - TENT_R) / (TENT_R * 1.3)));
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const lx = (i / nx - 0.5) * Math.max(0, t.w - TENT_R);
        const lz = (j / nz - 0.5) * Math.max(0, t.d - TENT_R);
        out.push({
          x: t.x + lx * Math.cos(t.yaw) + lz * Math.sin(t.yaw),
          z: t.z - lx * Math.sin(t.yaw) + lz * Math.cos(t.yaw),
          r: TENT_R,
        });
      }
    }
    return out;
  };

  for (const t of CAMP.tents) {
    if (t.solid && !site(`tent:${t.key}`, tentDiscs(t))) continue;

    const tent = new THREE.Group();
    tent.position.set(t.x, groundY(t.x, t.z) - 0.04, t.z);
    tent.rotation.y = t.yaw;
    g.add(tent);

    const wallH = t.solid ? t.h * 0.48 : t.h * 0.35;
    const ridgeY = t.h;

    if (t.solid) {
      // Four walls, as a wall tent actually has: vertical to about waist, then
      // the roof. A pure A-frame from the ground up is a pup tent and reads as
      // camping rather than as a field station.
      for (const s of [-1, 1]) {
        const side = new THREE.Mesh(plane(t.d, wallH, 1, DENSITY.canvas), M.canvas);
        side.rotation.y = s * Math.PI / 2;
        side.position.set(s * t.w / 2, wallH / 2, 0);
        side.castShadow = true;
        side.receiveShadow = true;
        tent.add(side);

        const end = new THREE.Mesh(plane(t.w, wallH, 1, DENSITY.canvas), M.canvas);
        end.position.set(0, wallH / 2, s * t.d / 2);
        end.rotation.y = s > 0 ? 0 : Math.PI;
        end.castShadow = true;
        end.receiveShadow = true;
        tent.add(end);
      }

      // Two roof slopes, sagging between the ridge and the eaves the way canvas
      // over a pole actually does. A flat plane here is a folded paper hat.
      const slope = Math.atan2(ridgeY - wallH, t.w / 2);
      const runLen = Math.hypot(t.w / 2, ridgeY - wallH);
      for (const s of [-1, 1]) {
        // Authored FLAT in the XZ plane by rotating the geometry, then tilted
        // by the mesh. Sagging a plane that has already been rotated by its
        // mesh transform makes canvas that sags sideways, which is the same
        // class of error as building a fallen column in world coordinates and
        // then adding it to a group that translates it again.
        const geo = plane(runLen, t.d, 3, DENSITY.canvas);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const u = pos.getX(i) / runLen + 0.5;
          const v = pos.getY(i) / t.d + 0.5;
          pos.setZ(i, -0.055 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
        }
        pos.needsUpdate = true;
        geo.rotateX(-Math.PI / 2);
        geo.computeVertexNormals();

        const roof = new THREE.Mesh(geo, M.canvas);
        roof.position.set(s * t.w / 4, (wallH + ridgeY) / 2, 0);
        // MINUS s, and the sign is the difference between a roof and a gutter.
        // A rotation of +theta about Z lifts the +x end; the +x end of the east
        // panel is its EAVE, so +s pitched both slopes inward and the tent came
        // out as a shallow valley with the ridge pole floating over the middle
        // of it. With -s the inner end lands exactly on ridgeY and the outer on
        // wallH, which is checkable arithmetic rather than a look.
        roof.rotation.z = -s * slope;
        roof.castShadow = true;
        roof.receiveShadow = true;
        tent.add(roof);
      }

      // Gable triangles, so the tent is closed at both ends and no sky shows
      // through the ridge from an oblique angle.
      for (const s of [-1, 1]) {
        const tri = new THREE.BufferGeometry();
        const hw = t.w / 2;
        tri.setAttribute('position', new THREE.Float32BufferAttribute([
          -hw, 0, 0, hw, 0, 0, 0, ridgeY - wallH, 0,
        ], 3));
        tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
        tri.computeVertexNormals();
        const gable = new THREE.Mesh(tri, M.canvas);
        gable.position.set(0, wallH, s * t.d / 2);
        gable.rotation.y = s > 0 ? 0 : Math.PI;
        tent.add(gable);
      }

      // The ridge pole standing proud at both ends, and two uprights. The pole
      // is what makes the silhouette read as pitched rather than as a box with
      // a pointed lid.
      const pole = tube(0.045, 0.045, t.d + 0.5, 6, M.iron);
      pole.rotation.x = Math.PI / 2;
      pole.position.set(0, ridgeY, 0);
      tent.add(pole);

      for (const s of [-1, 1]) {
        const up = tube(0.05, 0.06, ridgeY, 6, M.iron);
        up.position.set(0, ridgeY / 2, s * (t.d / 2 - 0.12));
        tent.add(up);
      }

      // The door, laced shut from the outside. Four ties across a flap.
      const flap = new THREE.Mesh(plane(t.w * 0.62, wallH * 0.92, 1, DENSITY.canvas), M.canvas);
      flap.position.set(0, wallH * 0.47, t.d / 2 + 0.03);
      tent.add(flap);
      for (let i = 0; i < 4; i++) {
        const tie = tube(0.012, 0.012, t.w * 0.2, 4, M.cord, DENSITY.cord);
        tie.rotation.z = Math.PI / 2;
        tie.rotation.x = jit(0.2);
        tie.position.set(jit(0.05), wallH * (0.2 + i * 0.2), t.d / 2 + 0.05);
        tent.add(tie);
      }

      // Sealed as a rectangle. The SAME list the guard just tested, so the
      // footprint that was approved and the footprint that is registered are
      // one thing and cannot drift apart.
      for (const d of tentDiscs(t)) solid(`tent:${t.key}`, d.x, d.z, d.r, wallH + 0.35);
    } else {
      /**
       * THE COLLAPSED ONE.
       *
       * A sheet lying over the shape of the frame that used to hold it up, with
       * one pole still standing at an angle out of the middle of it. This is
       * the single cheapest object in the camp and one of the loudest: two
       * tents standing and one down says the camp was struck in a hurry by
       * somebody who did not finish, which no amount of intact canvas can.
       */
      const sheet = plane(t.w, t.d, 7, DENSITY.canvas);
      const pos = sheet.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) / t.w + 0.5;
        const v = pos.getY(i) / t.d + 0.5;
        const lump = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
        const fold = Math.sin(u * 8.2 + 1.4) * Math.cos(v * 6.1) * 0.09;
        pos.setZ(i, t.h * lump * 0.72 + fold * lump);
      }
      pos.needsUpdate = true;
      sheet.rotateX(-Math.PI / 2);
      sheet.computeVertexNormals();

      const down = new THREE.Mesh(sheet, M.canvas);
      down.position.y = 0.03;
      down.castShadow = true;
      down.receiveShadow = true;
      tent.add(down);

      const leaning = tube(0.045, 0.05, t.h * 2.4, 6, M.iron);
      leaning.position.set(t.w * 0.14, t.h * 0.9, -t.d * 0.1);
      leaning.rotation.z = 0.72;
      leaning.rotation.x = 0.18;
      tent.add(leaning);
      // No collider. 0.7 m at the peak is under STEP_OVER.
    }

    // Guy lines and pegs, on the two windward corners only. Frayed and grey:
    // Act 1 is the bleached end of the gradient and this cordage has been in
    // this sun for weeks.
    for (const s of [-1, 1]) {
      const ax = s * t.w * 0.5;
      const az = t.d * 0.42;
      const px = s * (t.w * 0.5 + 1.25);
      const pz = t.d * 0.42 + 0.5;

      const line = new THREE.Mesh(
        catenary(new THREE.Vector3(ax, t.solid ? ridgeY * 0.92 : t.h * 0.6, az),
          new THREE.Vector3(px, 0.06, pz), 0.11,
          { radius: 0.016, segments: 8, tilesPerUnit: DENSITY.cord }),
        M.cord);
      line.userData.tier = 3;
      tent.add(line);

      const peg = tube(0.028, 0.034, 0.42, 5, M.iron);
      peg.position.set(px, 0.1, pz);
      peg.rotation.z = s * 0.34;
      tent.add(peg);
    }
  }

  // --- the generator -------------------------------------------------------
  //
  // The one object in this world that is doing something right now.
  //
  // Its whole job is to be RUNNING, and running is motion: a cooling fan
  // turning behind a grille and a charge lamp blinking. Both are driven from
  // `update` below, which is why this group is tagged noBatch - `batch.js`
  // bakes world matrices into vertices and deletes the originals, so a merged
  // fan would be welded to the courtyard for ever with the animation writing to
  // a mesh that is no longer in the scene. The braziers carry the same tag for
  // the same reason and courtyard.js states it at makeBrazier.

  const animated = [];
  let generatorLed = null;
  let generatorFan = null;

  {
    const gen = CAMP.generator;
    if (site('generator', [{ x: gen.x, z: gen.z, r: 0.98 }])) {
      /**
       * TAGGED AT THE PART, NOT AT THE PROP.
       *
       * The first pass put `noBatch` on this whole group, which is what the
       * braziers do - and on a brazier that is right, because a brazier is four
       * meshes. A generator is twenty, and `batch.js` STOPS DESCENDING at a
       * tagged subtree, so twenty static meshes stayed out of the merge to
       * protect two that move. Measured: draw calls at the spawn pose went from
       * 178 to 741 with the camp in, and the three noBatch groups in this file
       * were most of it.
       *
       * So the skid, the body, the louvres, the stack and the cans batch like
       * anything else, and only the fan and the charge lamp carry the tag.
       */
      const grp = new THREE.Group();
      grp.name = 'camp-generator';
      grp.position.set(gen.x, groundY(gen.x, gen.z), gen.z);
      grp.rotation.y = gen.yaw;
      g.add(grp);

      // Skid frame: four feet and two rails, so it stands ON the sand rather
      // than being a box half sunk in it.
      for (const sx of [-1, 1]) {
        const rail = panel(0.10, 0.13, 2.05, M.iron, DENSITY.metal, { chamfer: 0.02 });
        rail.position.set(sx * 0.62, 0.10, 0);
        grp.add(rail);
        for (const sz of [-1, 1]) {
          const foot = panel(0.24, 0.055, 0.24, M.rubber, DENSITY.metal, { chamfer: false });
          foot.position.set(sx * 0.62, 0.028, sz * 0.86);
          grp.add(foot);
        }
      }

      const body = panel(1.28, 0.86, 1.90, M.drab, DENSITY.metal, { chamfer: 0.05 });
      body.position.y = 0.62;
      grp.add(body);

      // Louvres down the long side. Four thin members, and they are the only
      // reason the body reads as machinery rather than as a crate.
      for (let i = 0; i < 4; i++) {
        const lv = panel(0.03, 0.055, 1.56, M.drabDark, DENSITY.metal, { chamfer: false });
        lv.position.set(0.655, 0.44 + i * 0.15, 0);
        lv.rotation.z = 0.28;
        grp.add(lv);
      }

      // The fan, behind a grille at the near end. It turns.
      const fan = new THREE.Group();
      fan.userData.noBatch = true;        // it turns
      fan.position.set(0, 0.66, -0.98);
      grp.add(fan);
      for (let i = 0; i < 5; i++) {
        const bl = panel(0.30, 0.015, 0.075, M.rust, DENSITY.metal, { chamfer: false });
        bl.rotation.z = (i / 5) * Math.PI * 2;
        bl.position.set(Math.cos((i / 5) * Math.PI * 2) * 0.16,
          Math.sin((i / 5) * Math.PI * 2) * 0.16, 0);
        fan.add(bl);
      }
      generatorFan = fan;

      const ring = tube(0.36, 0.36, 0.05, 12, M.iron, DENSITY.metal, true);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 0.66, -0.99);
      grp.add(ring);

      // Exhaust stack, up and over. The tallest thing in the camp after the
      // masts, and a vertical the eye can find from the spawn.
      const stack = tube(0.075, 0.095, 1.15, 8, M.rust);
      stack.position.set(-0.40, 1.62, 0.66);
      grp.add(stack);
      const elbow = tube(0.075, 0.075, 0.34, 8, M.rust);
      elbow.rotation.z = Math.PI / 2;
      elbow.position.set(-0.24, 2.14, 0.66);
      grp.add(elbow);

      // Control panel, and the lamp that says it is alive.
      const face = panel(0.05, 0.34, 0.52, M.drabDark, DENSITY.metal, { chamfer: 0.01 });
      face.position.set(0.66, 0.86, 0.52);
      grp.add(face);

      const led = new THREE.Mesh(new THREE.SphereGeometry(0.038, 6, 5), M.led.clone());
      led.userData.noBatch = true;        // a cloned emissive, driven per frame
      led.position.set(0.70, 0.95, 0.66);
      grp.add(led);
      generatorLed = led;

      const dial = tube(0.075, 0.075, 0.035, 10, M.paper);
      dial.rotation.z = Math.PI / 2;
      dial.position.set(0.70, 0.80, 0.40);
      grp.add(dial);

      // A jerrycan beside it, and a second one on its side and empty. Somebody
      // topped this up expecting to be back before it ran dry.
      for (const [cx, cz, tipped] of [[0.95, -0.60, false], [1.05, 0.30, true]]) {
        const can = panel(0.32, tipped ? 0.24 : 0.46, 0.20, M.drabDark,
          DENSITY.metal, { chamfer: 0.03 });
        can.position.set(cx, tipped ? 0.12 : 0.23, cz);
        can.rotation.y = jit(0.6);
        if (tipped) can.rotation.z = Math.PI * 0.5;
        grp.add(can);
      }

      solid('generator', gen.x, gen.z, 0.98, 1.25);
    }
  }

  // --- the work lamps ------------------------------------------------------
  //
  // LIGHT BUDGET, measured rather than assumed.
  //
  // The courtyard runs ONE shadow-casting light in the whole exterior - the sun
  // in sky.js, on a 4096 map with a 68-unit ortho frustum - and every other
  // light out here is a non-shadow PointLight. The five ceremonial braziers say
  // so in one line each: `light.castShadow = false; // brazier shadows are a
  // per-room budget decision`. A shadow-casting point light is six more shadow
  // passes over a scene that already pays for one, which on this scene is the
  // whole frame.
  //
  // So these two are non-shadow PointLights and there are TWO of them, not six.
  // three.js has no per-object light culling: every light in the visible graph
  // is evaluated by every fragment of every forward-lit material in the frame,
  // whether or not it is within range. A light here is therefore a cost paid at
  // the far end of the avenue and inside the quarry as well, so the count is
  // the budget and the range is only the picture. Two is what it takes to
  // bracket the camp and the wreck's nose from opposite flanks; a third bought
  // nothing the emissive lenses were not already giving.
  //
  // `test/camp.mjs` measures draw submission with the lights present and with
  // them removed in the same run, so this paragraph is a claim with a number.

  const lampLights = [];
  for (let i = 0; i < CAMP.lamps.length; i++) {
    const L = CAMP.lamps[i];
    if (!site(`lamp:${i}`, [{ x: L.x, z: L.z, r: 0.34 }])) continue;

    /**
     * NOT TAGGED noBatch, and the first pass had it wrong.
     *
     * The reasoning was "it carries a light", which is true and irrelevant:
     * `batch.js` only ever merges MESHES, and a PointLight is not one. Nothing
     * on this mast is driven per frame - the flicker is on the light's
     * intensity and the lens is a static emissive - so all thirteen of its
     * meshes belong in the merge. Two masts tagged at the group cost 26 draws
     * plus their shadow-pass twins to protect nothing at all.
     */
    const mast = new THREE.Group();
    mast.name = `camp-lamp-${i}`;
    mast.position.set(L.x, groundY(L.x, L.z), L.z);
    mast.rotation.y = L.yaw;
    g.add(mast);

    const H = 3.55;

    // A tripod base, splayed. A single pole in sand is a pole that fell over,
    // and the splay is what makes the object read as portable field kit.
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      const leg = tube(0.026, 0.034, 1.15, 5, M.iron);
      leg.position.set(Math.cos(a) * 0.29, 0.52, Math.sin(a) * 0.29);
      leg.rotation.z = -Math.cos(a) * 0.5;
      leg.rotation.x = Math.sin(a) * 0.5;
      mast.add(leg);
    }

    const pole = tube(0.045, 0.062, H, 7, M.iron);
    pole.position.y = H / 2;
    mast.add(pole);

    // The crossbar and two heads, aimed down and outward.
    const bar = panel(1.26, 0.05, 0.05, M.iron, DENSITY.metal, { chamfer: false });
    bar.position.y = H;
    mast.add(bar);

    for (const s of [-1, 1]) {
      const head = new THREE.Group();
      head.position.set(s * 0.52, H - 0.02, 0);
      head.rotation.x = 0.62;
      mast.add(head);

      const shell = panel(0.38, 0.30, 0.26, M.drabDark, DENSITY.metal, { chamfer: 0.02 });
      head.add(shell);

      const lens = new THREE.Mesh(plane(0.32, 0.24, 1, 1), M.lens);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, -0.155, 0);
      head.add(lens);

      // A wire cage over the lens: thin geometry, and it is what stops the head
      // reading as a television.
      for (let b = -1; b <= 1; b++) {
        const bar2 = panel(0.02, 0.02, 0.28, M.iron, DENSITY.metal, { chamfer: false });
        bar2.position.set(b * 0.11, -0.17, 0);
        bar2.userData.tier = 3;
        head.add(bar2);
      }
    }

    /**
     * ONE PointLight PER MAST, not one per head. Two heads on a bar 1.04 m
     * apart are one light source at any distance the player reads them from,
     * and the second would double the per-fragment cost of the entire frame to
     * move a highlight half a metre.
     */
    const light = new THREE.PointLight(0xcfe0ff, 6.5, 17, 2);
    light.position.set(0, H - 0.35, 0);
    light.castShadow = false;
    mast.add(light);
    lampLights.push(light);

    // The cable, dropped down the pole and run off into the sand toward the
    // generator. Where the power comes from is a fact the camp can state.
    const drop = new THREE.Mesh(
      catenary(new THREE.Vector3(0.1, H - 0.5, 0), new THREE.Vector3(0.24, 0.12, 0.34), 0.5,
        { radius: 0.018, segments: 10, tilesPerUnit: DENSITY.cord }),
      M.rubber);
    drop.userData.tier = 3;
    mast.add(drop);
  }

  /**
   * CABLE RUNS, on the sand, generator to lamp to instrument.
   *
   * Lines that cross the floor are the cheapest legibility in the camp: they
   * say the objects are one system rather than a scatter of props, and they
   * lead the eye from the thing that is running to the thing that is being
   * powered. dressing.js makes the same argument one tier up for the spans
   * across the avenue.
   *
   * They lie ON the ground sampler, in short segments, so a cable does not
   * float over a dune or vanish into one. No collider at any point: a cable is
   * 36 mm thick and the day it stops a player is the day it becomes a bug.
   */
  const cableRun = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.6));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const x0 = a[0] + (b[0] - a[0]) * t0, z0 = a[1] + (b[1] - a[1]) * t0;
        const x1 = a[0] + (b[0] - a[0]) * t1, z1 = a[1] + (b[1] - a[1]) * t1;
        const seg = new THREE.Mesh(
          catenary(new THREE.Vector3(x0, groundY(x0, z0) + 0.035, z0),
            new THREE.Vector3(x1, groundY(x1, z1) + 0.035, z1), 0.02,
            { radius: 0.018, segments: 4, tilesPerUnit: DENSITY.cord }),
          M.rubber);
        seg.userData.tier = 3;
        seg.castShadow = false;
        g.add(seg);
      }
    }
  };

  cableRun([[-11.3, 23.6], [-8.9, 23.1], [-5.6, 22.6]]);
  cableRun([[-5.4, 21.8], [-4.1, 19.9], [-2.9, 18.3]]);

  // --- the instrument array ------------------------------------------------
  //
  // THE ANOMALY, STILL BEING LOGGED, WITH NOBODY LEFT TO READ IT.
  //
  // NARRATIVE.md's first cause: "a government instrument reads something at
  // Giza that should not be there... something measurable, difficult to read,
  // and wrong", and the pull the instruments picked up is the door leaning
  // open. This is that instrument, four days after the last person who
  // understood it went inside.
  //
  // The mechanism is a DRUM RECORDER rather than a screen, and that is the
  // whole design decision. A screen showing a waveform is a texture that has to
  // be re-uploaded every frame to move, and if it does not move it is a picture
  // of an instrument. A paper drum turning under a pen arm is pure geometry
  // motion: it costs two rotations a frame, it is legible from four metres
  // without a single readable glyph, and a player who watches it for two
  // seconds knows the machine is still writing.

  let recorderDrum = null;
  let recorderPen = null;

  {
    const I = CAMP.instrument;
    if (site('instrument', [{ x: I.x, z: I.z, r: 0.34 }])) {
      const arr = new THREE.Group();
      arr.position.set(I.x, groundY(I.x, I.z), I.z);
      arr.rotation.y = I.yaw;
      g.add(arr);

      const H = 3.35;

      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        const leg = tube(0.024, 0.030, 1.30, 5, M.iron);
        leg.position.set(Math.cos(a) * 0.34, 0.58, Math.sin(a) * 0.34);
        leg.rotation.z = -Math.cos(a) * 0.52;
        leg.rotation.x = Math.sin(a) * 0.52;
        arr.add(leg);

        const foot = panel(0.14, 0.03, 0.14, M.rubber, DENSITY.metal, { chamfer: false });
        foot.position.set(Math.cos(a) * 0.62, 0.015, Math.sin(a) * 0.62);
        arr.add(foot);
      }

      const mast = tube(0.032, 0.048, H, 7, M.iron);
      mast.position.y = H / 2;
      arr.add(mast);

      // The sensor head: a canister with three short booms off it. Not a dish -
      // a dish points at the sky and this thing is listening to the ground.
      const can = tube(0.15, 0.15, 0.44, 10, M.drabDark);
      can.position.y = H + 0.16;
      arr.add(can);

      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.9;
        const boom = tube(0.014, 0.014, 0.86, 4, M.iron);
        boom.rotation.z = Math.PI / 2;
        boom.rotation.y = -a;
        boom.position.set(Math.cos(a) * 0.5, H + 0.30, Math.sin(a) * 0.5);
        boom.userData.tier = 3;
        arr.add(boom);
      }

      // Guy lines to three pegs. An array this tall in sand is guyed or it is
      // lying down, and the lines are the thin geometry the mid-ground wants.
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.5;
        const px = Math.cos(a) * 1.75, pz = Math.sin(a) * 1.75;
        const line = new THREE.Mesh(
          catenary(new THREE.Vector3(0, H * 0.86, 0), new THREE.Vector3(px, 0.08, pz), 0.14,
            { radius: 0.011, segments: 8, tilesPerUnit: DENSITY.cord }),
          M.cord);
        line.userData.tier = 3;
        arr.add(line);

        const peg = tube(0.024, 0.030, 0.38, 5, M.iron);
        peg.position.set(px, 0.09, pz);
        peg.rotation.z = 0.3;
        arr.add(peg);
      }

      solid('instrument', I.x, I.z, 0.34, 1.85);
    }

    // The table. 0.72 m tall and therefore NO collider: dressing.js's
    // STEP_OVER rule, and the reason it is authored at 0.72 rather than at the
    // 0.80 a real field table would be. A table is not worth stopping a player.
    const T = CAMP.fieldTable;
    const tbl = new THREE.Group();
    tbl.position.set(T.x, groundY(T.x, T.z), T.z);
    tbl.rotation.y = T.yaw;
    g.add(tbl);

    const top = panel(1.35, 0.045, 0.72, M.timber, DENSITY.metal, { chamfer: 0.01 });
    top.position.y = 0.70;
    tbl.add(top);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = tube(0.022, 0.022, 0.70, 4, M.iron);
        leg.position.set(sx * 0.60, 0.35, sz * 0.30);
        leg.rotation.z = sx * 0.06;
        leg.rotation.x = sz * 0.06;
        tbl.add(leg);
      }
    }

    // The recorder: a paper drum on its side, a pen arm resting on it, and a
    // control box beside it with a live readout.
    const rec = new THREE.Group();
    rec.name = 'camp-recorder';
    rec.position.set(-0.28, 0.72, 0);
    tbl.add(rec);

    const cradle = panel(0.56, 0.10, 0.40, M.drabDark, DENSITY.metal, { chamfer: 0.02 });
    cradle.position.y = 0.05;
    rec.add(cradle);

    const drum = tube(0.145, 0.145, 0.46, 14, M.paper);
    drum.rotation.z = Math.PI / 2;
    drum.position.y = 0.25;
    // Tagged at the mesh: it turns, and `batch.js` bakes world matrices into
    // vertices and then deletes the original, so a merged drum would be welded
    // to the courtyard with the rotation written to a mesh nobody draws. The
    // three paper bands are its CHILDREN, and batch.js never descends into a
    // mesh's children, so they are already out of the merge and turn with it.
    drum.userData.noBatch = true;
    rec.add(drum);
    recorderDrum = drum;

    // The trace already on the paper: three fine bands round the drum. They are
    // children of the DRUM, not of the recorder, so they turn with it - which
    // is the entire reason the drum reads as paper being written on rather than
    // as a tin can spinning. Their positions are therefore in the drum's own
    // frame, which is lying on its side, so the axis they step along is local y.
    for (let k = 0; k < 3; k++) {
      const band = tube(0.1495, 0.1495, 0.007, 14, M.rubber, DENSITY.metal, true);
      band.position.set(0, -0.14 + k * 0.14, 0);
      drum.add(band);
    }

    const arm = new THREE.Group();
    arm.userData.noBatch = true;         // the pen rides the trace
    arm.position.set(0.30, 0.27, 0);
    rec.add(arm);
    const armBar = panel(0.34, 0.018, 0.018, M.iron, DENSITY.metal, { chamfer: false });
    armBar.position.x = -0.17;
    arm.add(armBar);
    const nib = panel(0.02, 0.05, 0.02, M.rubber, DENSITY.metal, { chamfer: false });
    nib.position.set(-0.33, -0.03, 0);
    arm.add(nib);
    recorderPen = arm;

    const boxk = panel(0.34, 0.22, 0.30, M.drabDark, DENSITY.metal, { chamfer: 0.02 });
    boxk.position.set(0.46, 0.83, 0.02);
    tbl.add(boxk);

    const screen = new THREE.Mesh(plane(0.22, 0.12, 1, 1), M.screen);
    screen.position.set(0.46, 0.86, 0.175);
    tbl.add(screen);

    // A notebook, open, face down on the table. Nobody closed it.
    const bookL = panel(0.20, 0.012, 0.26, M.paper, DENSITY.metal, { chamfer: false });
    bookL.position.set(-0.06, 0.735, 0.24);
    bookL.rotation.set(0, 0.5, 0.02);
    tbl.add(bookL);
    const bookR = panel(0.20, 0.012, 0.26, M.paper, DENSITY.metal, { chamfer: false });
    bookR.position.set(0.13, 0.735, 0.30);
    bookR.rotation.set(0, 0.5, -0.02);
    tbl.add(bookR);
  }

  // --- the tarpaulin over the gear -----------------------------------------

  {
    const T = CAMP.tarp;
    if (site('tarp', [{ x: T.x, z: T.z, r: 0.92 }])) {
      const grp = new THREE.Group();
      grp.position.set(T.x, groundY(T.x, T.z), T.z);
      grp.rotation.y = T.yaw;
      g.add(grp);

      // What is under it: two drums and a box, so the sheet has a real shape to
      // take rather than being a lump.
      for (const [dx, dz] of [[-0.42, -0.30], [0.44, 0.18]]) {
        const drum = tube(0.29, 0.29, 0.86, 10, M.rust);
        drum.position.set(dx, 0.43, dz);
        grp.add(drum);
      }
      const crate = panel(0.9, 0.55, 0.7, M.timber, DENSITY.metal, { chamfer: 0.02 });
      crate.position.set(0.05, 0.28, -0.65);
      grp.add(crate);

      // The sheet, draped over the top of them and pulled down at the corners.
      const sheet = plane(2.4, 2.2, 8, DENSITY.canvas);
      const pos = sheet.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) / 2.4 + 0.5;
        const v = pos.getY(i) / 2.2 + 0.5;
        /**
         * CLAMPED AT ZERO BEFORE THE POWER, and it is not defensive coding.
         *
         * PlaneGeometry lays its last column at `8 * 0.3 - 1.2`, which in
         * float64 is 1.2000000000000002 rather than 1.2, so u comes out at
         * 1.0000000000000002 and `sin(PI * u)` is MINUS 6.9e-16. Raise that to
         * a fractional power and the answer is NaN, which propagates through
         * `computeVertexNormals` into a bounding sphere of NaN and a mesh that
         * fails frustum culling in ways nothing reports except one console
         * warning. It shipped that way for exactly one build of this file and
         * the only symptom was a line in the log.
         */
        const dome = Math.max(0, Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
        pos.setZ(i, 0.94 * Math.pow(dome, 0.62) + Math.sin(u * 9.1) * 0.035 * dome);
      }
      pos.needsUpdate = true;
      sheet.rotateX(-Math.PI / 2);
      sheet.computeVertexNormals();
      const cover = new THREE.Mesh(sheet, M.tarp);
      cover.castShadow = true;
      cover.receiveShadow = true;
      grp.add(cover);

      // Corner ties down to pegs. A tarp with no ties is a bedsheet.
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const line = new THREE.Mesh(
          catenary(new THREE.Vector3(sx * 1.12, 0.16, sz * 1.02),
            new THREE.Vector3(sx * 1.52, 0.06, sz * 1.38), 0.05,
            { radius: 0.012, segments: 5, tilesPerUnit: DENSITY.cord }),
          M.cord);
        line.userData.tier = 3;
        grp.add(line);
      }

      solid('tarp', T.x, T.z, 0.92, 1.0);
    }
  }

  // --- the seven ------------------------------------------------------------

  const atlas = stencilAtlas(CAMP.names);
  const stencilMat = new THREE.MeshStandardMaterial({
    map: atlas, color: 0xffffff, roughness: 0.85, metalness: 0.10,
    name: 'camp-stencil',
  });

  const CASE = { w: 1.15, h: 0.74, d: 0.66, pallet: 0.10 };

  /**
   * THE PAINTED PANELS, AS WORLD RECTANGLES.
   *
   * Published because the claim "the seven names are legible" is a claim about
   * PIXELS, and a harness measuring pixels has to know exactly which rectangle
   * of the screen to look in. `test/tiers.mjs` records what happens otherwise:
   * three separate sampling boxes on this project were placed by eye and all
   * three reported a real difference as absent, in the same direction. So the
   * harness projects these four corners through the live camera rather than
   * guessing at a fraction of the viewport - and after `batchStatics` merges the
   * seven faces into one draw there is no per-case mesh left to ask.
   */
  const caseFaces = [];

  for (const c of CAMP.cases) {
    if (!site(`case:${c.cluster}`, [{ x: c.x, z: c.z, r: 0.48 }])) continue;

    const grp = new THREE.Group();
    grp.position.set(c.x, groundY(c.x, c.z), c.z);
    // Barely yawed. These were PUT here by people working to a list, and the
    // difference between a stack of debris and a laid-out manifest is entirely
    // in how square it is. dressing.js makes the same distinction between its
    // loose goods and its deliberate cover.
    grp.rotation.y = jit(0.07);
    g.add(grp);

    // The pallet under it, because gear does not go straight onto sand.
    const pal = panel(CASE.w + 0.14, CASE.pallet, CASE.d + 0.14, M.timber,
      DENSITY.metal, { chamfer: 0.02 });
    pal.position.y = CASE.pallet / 2;
    grp.add(pal);

    const body = panel(CASE.w, CASE.h, CASE.d, M.caseBody, DENSITY.metal, { chamfer: 0.03 });
    body.position.y = CASE.pallet + CASE.h / 2;
    grp.add(body);

    // The lid seam, the latches and the corner blocks. Six thin members that
    // are the difference between a transit case and a painted cube.
    const seam = panel(CASE.w * 1.01, 0.028, CASE.d * 1.01, M.iron, DENSITY.metal,
      { chamfer: false });
    seam.position.y = CASE.pallet + CASE.h * 0.68;
    grp.add(seam);

    for (const sx of [-1, 1]) {
      const latch = panel(0.07, 0.10, 0.035, M.iron, DENSITY.metal, { chamfer: false });
      latch.position.set(sx * CASE.w * 0.31, CASE.pallet + CASE.h * 0.66, CASE.d / 2 + 0.02);
      grp.add(latch);

      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.085, 0.014, 3, 7, Math.PI), M.iron);
      handle.position.set(sx * (CASE.w / 2 + 0.012), CASE.pallet + CASE.h * 0.5, 0);
      handle.rotation.set(0, sx > 0 ? 0 : Math.PI, -Math.PI / 2);
      grp.add(handle);
    }

    /**
     * THE NAME, ON THE NORTH FACE.
     *
     * North is the direction the player arrives from - spawn is at z = 30 and
     * the whole walk runs toward -z - so the manifest is read on approach.
     * Painted on the back it would be a fact delivered to the rear-view.
     *
     * It stands 12 mm proud of the case face rather than being coplanar with
     * it. Two surfaces on the same plane z-fight, and a z-fighting name is the
     * one failure mode that would make this unreadable at exactly the distance
     * it has to be readable at.
     */
    const face = stencilFace(CASE.w * 0.94, CASE.h * 0.70, c.name, CAMP.names.length,
      stencilMat);
    face.position.set(0, CASE.pallet + CASE.h * 0.44, CASE.d / 2 + 0.012);
    grp.add(face);

    // The panel in world coordinates, derived from the same numbers that just
    // placed it rather than restated. `grp.rotation.y` is the only rotation in
    // the chain, so the panel's outward normal is +Z turned by it.
    {
      const yaw = grp.rotation.y;
      const fw = CASE.w * 0.94, fh = CASE.h * 0.70;
      const oz = CASE.d / 2 + 0.012;
      caseFaces.push({
        name: CAMP.names[c.name],
        index: c.name,
        cluster: c.cluster,
        y: groundY(c.x, c.z) + CASE.pallet + CASE.h * 0.44,
        // Centre, pushed out along the face normal.
        x: c.x + oz * Math.sin(yaw),
        z: c.z + oz * Math.cos(yaw),
        // Half-width along the panel, and the outward normal.
        ux: Math.cos(yaw) * fw / 2, uz: -Math.sin(yaw) * fw / 2,
        halfH: fh / 2,
        nx: Math.sin(yaw), nz: Math.cos(yaw),
      });
    }

    solid(`case:${c.cluster}`, c.x, c.z, 0.48, CASE.pallet + CASE.h);
  }

  // A survey peg and a coil of line at the camp's edge, leaning over. The
  // WORLD-1 gradient asks for exactly this at the bleached end.
  for (const [px, pz, lean] of [[-7.6, 18.2, 0.5], [1.4, 22.4, 0.22]]) {
    const peg = tube(0.032, 0.040, 0.9, 5, M.timber);
    peg.position.set(px, groundY(px, pz) + 0.36, pz);
    peg.rotation.z = lean;
    peg.rotation.y = jit(1.0);
    g.add(peg);

    const flag = new THREE.Mesh(plane(0.16, 0.11, 1, 1), M.tarp);
    flag.position.set(px + 0.09, groundY(px, pz) + 0.72, pz);
    flag.rotation.y = jit(1.0);
    g.add(flag);
    // Under STEP_OVER. No collider.
  }

  // =========================================================================
  // 2. THE WRECK
  // =========================================================================
  //
  // Built in the AIRCRAFT'S OWN FRAME - +X out the nose, +Y up, +Z out the port
  // side - and then placed once, yawed, rolled and pitched by the group above
  // it. Authoring a canted object in world coordinates is how the toppled
  // column in courtyard.js ended up drawing at twice its intended offset with
  // its colliders left behind in the avenue; the fix there and the rule here
  // are the same, and the collider chain below is derived from the same local
  // coordinates through the same transform rather than being a second list of
  // numbers that has to be kept in agreement with the first.

  const W = CAMP.wreck;
  const baseY = groundY(W.x, W.z);

  const heli = new THREE.Group();
  heli.name = 'wreck';
  heli.position.set(W.x, baseY, W.z);
  heli.rotation.y = W.yaw;
  g.add(heli);

  // Default XYZ order, which composes as Rx * Ry * Rz: the pitch is applied in
  // the aircraft's own frame FIRST and the roll turns the pitched aircraft,
  // which is the order the two things actually happened in.
  const air = new THREE.Group();
  air.rotation.z = W.pitch;
  air.rotation.x = W.roll;
  heli.add(air);

  /** Local (x, z) to world. The one place the aircraft's transform is written. */
  const toWorld = (lx, lz) => ({
    x: W.x + lx * Math.cos(W.yaw) + lz * Math.sin(W.yaw),
    z: W.z - lx * Math.sin(W.yaw) + lz * Math.cos(W.yaw),
  });

  // --- airframe ------------------------------------------------------------

  // Cabin. The biggest single mass, and it carries the roll.
  const cabin = panel(3.05, 1.92, 2.10, M.hull, DENSITY.hull, { chamfer: 0.09 });
  cabin.position.set(0.15, 1.24, 0);
  air.add(cabin);

  // Cabin floor pan and the belly, one value down so the underside reads.
  const belly = panel(3.20, 0.30, 1.86, M.hullDark, DENSITY.hull, { chamfer: 0.06 });
  belly.position.set(0.15, 0.34, 0);
  air.add(belly);

  // Nose: two stacked masses stepping down and in, which is the cheapest way to
  // get a snout out of boxes without a lathe.
  const nose = panel(1.05, 1.30, 1.72, M.hull, DENSITY.hull, { chamfer: 0.10 });
  nose.position.set(2.02, 1.06, 0);
  nose.rotation.z = -0.10;
  air.add(nose);

  const chin = panel(0.86, 0.52, 1.40, M.hullDark, DENSITY.hull, { chamfer: 0.07 });
  chin.position.set(2.55, 0.62, 0);
  chin.rotation.z = -0.22;
  air.add(chin);

  /**
   * WINDSCREEN: two panes meeting on the centreline, raked back.
   *
   * ROTATION ORDER 'YXZ', and the default order was a real bug rather than a
   * detail. three.js composes the default 'XYZ' as Rx * Ry * Rz, so the Z term
   * is applied FIRST, in the plane's own untuned frame - which spins the pane
   * about its own face instead of raking it back, and then the Y term turns the
   * spun pane to face forward. Measured on the shipped capture the nose was a
   * bare grey wedge with no glass in it at any angle. Under 'YXZ' the rake
   * happens in the aircraft's frame and the yaw turns the raked pane, which is
   * the order the two operations mean.
   *
   * Low roughness, so at any angle one of the two catches the sky. That is what
   * makes a windscreen read as glass rather than as a dark patch, and it is the
   * one feature that tells a player which end of this thing is the front.
   */
  for (const s of [-1, 1]) {
    const pane = new THREE.Mesh(plane(1.05, 1.20, 1, 1), M.glass);
    pane.rotation.order = 'YXZ';
    pane.rotation.y = Math.PI / 2 + s * 0.34;
    pane.rotation.x = -0.40;
    pane.position.set(2.26, 1.46, s * 0.44);
    air.add(pane);
  }

  // The anti-glare panel: a matt black band over the nose deck, in front of the
  // windscreen. Six triangles, and it is the single most recognisable marking
  // on any helicopter that carries no markings at all.
  const glare = panel(1.15, 0.03, 1.34, M.soot, DENSITY.hull, { chamfer: false, cast: false });
  glare.position.set(2.30, 1.72, 0);
  glare.rotation.z = -0.12;
  air.add(glare);

  // Side windows and the cabin door glass.
  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(plane(1.00, 0.62, 1, 1), M.glass);
    win.position.set(1.15, 1.62, s * 1.055);
    win.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    air.add(win);
  }

  // Engine deck and the intake, on top and aft.
  const deck = panel(1.60, 0.58, 1.42, M.hullDark, DENSITY.hull, { chamfer: 0.06 });
  deck.position.set(-0.05, 2.36, 0);
  air.add(deck);

  const intake = tube(0.30, 0.30, 0.42, 10, M.rotor);
  intake.rotation.z = Math.PI / 2;
  intake.position.set(0.78, 2.36, 0);
  air.add(intake);

  // The exhaust, out the starboard side, with a soot band aft of it.
  const exh = tube(0.20, 0.24, 0.52, 8, M.rotor);
  exh.rotation.x = Math.PI / 2;
  exh.rotation.z = 0.2;
  exh.position.set(-0.55, 2.24, -0.86);
  air.add(exh);

  const stain = new THREE.Mesh(plane(1.05, 0.62, 1, 1), M.soot);
  stain.position.set(-1.15, 1.98, -1.06);
  stain.rotation.y = -Math.PI / 2;
  air.add(stain);

  // --- the tail, cracked ---------------------------------------------------
  //
  // BROKEN, NOT MISSING, and it folds rather than snapping clean. A tail boom
  // that has simply gone is an aircraft that was assembled wrong; one that is
  // kinked twenty degrees down with torn skin at the fold is one that hit
  // something. It is also the reason the tail rotor is still attached and still
  // legible - which matters, because the tail rotor is the second most
  // recognisable shape on this object after the main disc.

  const boom = new THREE.Group();
  boom.position.set(-1.35, 1.86, 0);
  air.add(boom);

  const boom1 = tube(0.30, 0.38, 1.95, 9, M.hull, DENSITY.hull);
  boom1.rotation.z = Math.PI / 2;
  boom1.position.set(-0.95, 0, 0);
  boom.add(boom1);

  const fold = new THREE.Group();
  fold.position.set(-1.92, 0, 0);
  fold.rotation.z = 0.38;              // the kink, down
  fold.rotation.y = 0.12;              // and slightly across
  boom.add(fold);

  const boom2 = tube(0.19, 0.29, 1.55, 9, M.hull, DENSITY.hull);
  boom2.rotation.z = Math.PI / 2;
  boom2.position.set(-0.78, 0, 0);
  fold.add(boom2);

  // Torn skin at the fold: three plates peeled out of the break. Thin, angular,
  // and the only jagged silhouette on an object that is otherwise all curves
  // and boxes.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    const tearPlate = panel(0.30, 0.02, 0.20, M.hullDark, DENSITY.hull, { chamfer: false });
    tearPlate.position.set(-0.08, Math.sin(a) * 0.24, Math.cos(a) * 0.24);
    tearPlate.rotation.set(a, 0.3 + i * 0.2, -0.5 - i * 0.25);
    fold.add(tearPlate);
  }

  /**
   * THE TAIL NUMBER, PAINTED OVER.
   *
   * STARBOARD, which under this yaw faces north-east, away from the walking
   * line: found by a player who walks around the tail and by nobody else. It
   * is a rectangle of not-quite-matching paint standing 8 mm proud of the boom,
   * with the number underneath still faintly readable through it, because a
   * single coat of brush enamel over sprayed digits never quite covers.
   *
   * Nothing depends on finding this. NARRATIVE.md's rule is that no LOAD-
   * BEARING fact may live only on a surface the player can miss, and the seven
   * names are the load-bearing fact and they are on the crates. This is the
   * reward for looking.
   */
  const patch = panel(1.05, 0.008, 0.40, M.patch, DENSITY.hull, { chamfer: false, cast: false });
  patch.rotation.x = Math.PI / 2;
  patch.rotation.z = 0.04;
  patch.position.set(-0.85, -0.02, -0.295);
  boom.add(patch);

  // The ghost of the digits under it: four faint blocks, barely a value step
  // off the patch. Deliberately not text - a legible number would be an answer,
  // and the point of an effaced number is that somebody decided you may not
  // have one.
  for (let i = 0; i < 4; i++) {
    const ghost = panel(0.115, 0.004, 0.20, M.hullDark, DENSITY.hull,
      { chamfer: false, cast: false });
    ghost.rotation.x = Math.PI / 2;
    ghost.position.set(-1.16 + i * 0.20, -0.02, -0.299);
    boom.add(ghost);
  }

  // Vertical fin and the horizontal stabiliser.
  const fin = panel(0.62, 1.15, 0.09, M.hull, DENSITY.hull, { chamfer: 0.04 });
  fin.position.set(-1.40, 0.44, 0);
  fin.rotation.z = -0.18;
  fold.add(fin);

  const stab = panel(0.48, 0.07, 1.55, M.hull, DENSITY.hull, { chamfer: 0.03 });
  stab.position.set(-1.05, 0.06, 0);
  fold.add(stab);

  // Tail rotor: hub plus two blades, still on its shaft.
  const trHub = tube(0.10, 0.10, 0.16, 8, M.rotor);
  trHub.rotation.x = Math.PI / 2;
  trHub.position.set(-1.44, 0.52, 0.14);
  fold.add(trHub);

  for (let i = 0; i < 2; i++) {
    const bl = panel(0.10, 0.86, 0.035, M.rotor, DENSITY.rotor, { chamfer: false });
    bl.position.set(-1.44, 0.52 + Math.cos(i * Math.PI + 0.5) * 0.45,
      0.20 + Math.sin(i * Math.PI + 0.5) * 0.45);
    bl.rotation.x = i * Math.PI + 0.5;
    fold.add(bl);
  }

  // --- skids ---------------------------------------------------------------
  //
  // The starboard one has collapsed outward, which is what puts the whole
  // aircraft on its cant. Without it the roll reads as the model being placed
  // badly; with it the roll has a cause on screen.

  for (const s of [-1, 1]) {
    const collapsed = s < 0;                        // starboard is local -Z
    const skid = new THREE.Group();
    skid.position.set(0.1, collapsed ? 0.06 : 0.10, s * (collapsed ? 1.32 : 1.02));
    skid.rotation.x = collapsed ? -0.22 : 0;
    air.add(skid);

    const rail = tube(0.075, 0.075, 3.30, 7, M.iron);
    rail.rotation.z = Math.PI / 2;
    skid.add(rail);

    // Upturned toe at the front, as every skid has.
    const toe = tube(0.070, 0.070, 0.50, 7, M.iron);
    toe.rotation.z = Math.PI / 2 - 0.5;
    toe.position.set(1.78, 0.11, 0);
    skid.add(toe);

    for (const fx of [-0.85, 0.85]) {
      const strut = tube(0.055, 0.062, 1.05, 6, M.iron);
      strut.position.set(fx, 0.50, -s * 0.24);
      strut.rotation.x = s * (collapsed ? 0.80 : 0.36);
      strut.rotation.z = collapsed ? 0.22 : 0;
      skid.add(strut);
    }
  }

  // --- the cargo door ------------------------------------------------------
  //
  // OPEN, on the PORT side, which faces the walking line. Whatever this
  // aircraft was for, the last thing it did was let people out, and the cabin
  // behind the opening is empty. That emptiness is the beat; a closed door
  // would keep the question shut.

  const doorway = panel(1.42, 1.28, 0.07, M.hullDark, DENSITY.hull, { chamfer: 0.02 });
  doorway.position.set(0.10, 1.20, 1.03);
  air.add(doorway);

  const slid = panel(1.30, 1.22, 0.08, M.hull, DENSITY.hull, { chamfer: 0.03 });
  slid.position.set(-1.15, 1.22, 1.10);
  air.add(slid);

  const rail2 = panel(2.90, 0.05, 0.05, M.iron, DENSITY.metal, { chamfer: false });
  rail2.position.set(-0.20, 1.86, 1.09);
  air.add(rail2);

  // The other door is off entirely and lying in the sand, four metres out. A
  // panel on the ground beside a wreck is the single cheapest way to say that
  // pieces came off this rather than that it was built like this.
  {
    const p = toWorld(-0.4, 4.4);
    const off = panel(1.30, 0.07, 1.22, M.hull, DENSITY.hull, { chamfer: 0.03 });
    off.position.set(p.x, groundY(p.x, p.z) + 0.05, p.z);
    off.rotation.set(0.04, W.yaw + 0.7, -0.06);
    off.castShadow = true;
    off.receiveShadow = true;
    g.add(off);
    // Under STEP_OVER. No collider, deliberately: a door panel flat on the sand
    // that stops a player is the canal barge defect in miniature.
  }

  // --- the rotor -----------------------------------------------------------
  //
  // The single highest-value element in this build.
  //
  // The disc is CANTED, and that is not decoration. Read from a 1.68 m eye
  // height at twenty to forty metres, a level rotor disc is a line: the one
  // shape in this world that nothing else resembles collapses into a horizontal
  // stroke and stops being recognisable at exactly the distance it has to work
  // from. A canted disc keeps its span.
  //
  // FOUR BLADES, FOUR DIFFERENT FATES, because four identical blades is a
  // machine at rest and this one hit the ground:
  //   0  drooped hard, tip in the sand
  //   1  drooped, and bent up at mid span where it struck
  //   2  the survivor, high and out, and this is the one on the skyline
  //   3  sheared at the root; its outer section is standing in the sand eight
  //      metres away, which is both a second landmark and the reason the player
  //      believes the rest of it

  const mast = tube(0.115, 0.135, 0.72, 8, M.rotor);
  mast.position.set(0.12, 2.92, 0);
  mast.rotation.z = 0.12;
  air.add(mast);

  const rotor = new THREE.Group();
  rotor.position.set(0.14, 3.26, 0);
  rotor.rotation.z = 0.20;             // the cant
  rotor.rotation.x = 0.07;
  air.add(rotor);

  const hub = tube(0.34, 0.40, 0.26, 10, M.rotor);
  rotor.add(hub);

  const swash = tube(0.22, 0.22, 0.10, 10, M.iron);
  swash.position.y = -0.24;
  rotor.add(swash);

  const BLADE_L = 4.55;
  const BLADE_C = 0.44;

  /** One blade, as a chain of segments so it can droop and kink. */
  const blade = (azimuth, { droop = 0, kink = 0, kinkAt = 0.55, length = BLADE_L }) => {
    const arm = new THREE.Group();
    arm.rotation.y = azimuth;
    rotor.add(arm);

    // The grip and the pitch link, which is what stops a blade reading as a
    // plank glued to a can.
    const grip = tube(0.075, 0.085, 0.42, 6, M.iron);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(0.36, 0, 0);
    arm.add(grip);

    const link = tube(0.022, 0.022, 0.28, 4, M.iron);
    link.position.set(0.46, -0.16, 0.12);
    arm.add(link);

    const inner = new THREE.Group();
    inner.position.set(0.56, 0, 0);
    inner.rotation.z = -droop;
    arm.add(inner);

    const l1 = length * kinkAt;
    const s1 = panel(l1, 0.075, BLADE_C, M.rotor, DENSITY.rotor, { chamfer: false });
    s1.position.set(l1 / 2, 0, 0);
    inner.add(s1);

    const outer = new THREE.Group();
    outer.position.set(l1, 0, 0);
    outer.rotation.z = kink;
    inner.add(outer);

    const l2 = length - l1;
    if (l2 > 0.05) {
      const s2 = panel(l2, 0.068, BLADE_C * 0.92, M.rotor, DENSITY.rotor, { chamfer: false });
      s2.position.set(l2 / 2, 0, 0);
      outer.add(s2);

      // The tip cap: a slightly wider block, which is what a real blade tip
      // looks like and what stops the blade reading as an extruded rectangle.
      const tip = panel(0.16, 0.075, BLADE_C * 1.02, M.iron, DENSITY.rotor, { chamfer: false });
      tip.position.set(l2 - 0.08, 0, 0);
      outer.add(tip);
    }
    return arm;
  };

  /**
   * THE AZIMUTHS ARE OFFSET BY 0.30 RADIAN, and the reason is the walking line.
   *
   * At azimuth zero the first blade points along the nose, which under this yaw
   * is due north-west, and its tip landed at x = 0.3 at chest height - directly
   * over the lane the player walks. A capture from underneath is a flat black
   * plane filling the whole frame. It has no collider so nothing stops the
   * player, which makes it worse rather than better: you walk through it.
   *
   * A third of a radian swings the drooped blade east to x = 2.6, which leaves
   * two clear metres between it and the walking line, keeps it inside the
   * wreck's own footprint, and costs the composition nothing.
   */
  const AZ = 0.30;
  blade(AZ,                     { droop: 0.46, kink: -0.10 });
  blade(AZ + Math.PI * 0.5,     { droop: 0.10, kink: -0.05 });   // the survivor
  blade(AZ + Math.PI,           { droop: 0.42, kink: 0.62, kinkAt: 0.46 });
  blade(AZ + Math.PI * 1.5,     { droop: 0.30, kink: 0.0, length: 1.35 }); // stub

  // The sheared section, standing in the sand where it came down. Eight metres
  // out, canted, and tall enough to be a landmark of its own: it is the object
  // that makes a player walk off the line to look, which is exactly the
  // circulation MAP.md says the courtyard has none of.
  {
    const S = CAMP.shearedBlade;
    const y = groundY(S.x, S.z);
    const shard = new THREE.Group();
    shard.position.set(S.x, y, S.z);
    shard.rotation.y = S.yaw;
    shard.rotation.z = S.lean;
    g.add(shard);

    const len = 3.15;
    const sec = panel(0.09, len, BLADE_C * 0.95, M.rotor, DENSITY.rotor, { chamfer: false });
    sec.position.y = len / 2 - 0.35;         // buried by a third of a metre
    shard.add(sec);

    const cap = panel(0.10, 0.16, BLADE_C, M.iron, DENSITY.rotor, { chamfer: false });
    cap.position.y = len - 0.42;
    shard.add(cap);

    // No collider. It is 90 mm thick, and a 90 mm obstacle that stops a body
    // 840 mm wide is a bug rather than a barrier.
  }

  // --- drifted sand --------------------------------------------------------
  //
  // Four days of wind. A low bank against the windward flank, so the aircraft
  // is BEDDED in the ground rather than resting on top of it - the same fault
  // the courtyard had to fix on 73 percent of its backdrop meshes and the same
  // fix: seat on the real sampler, and bury a little.

  for (let i = 0; i < 7; i++) {
    const lx = -3.6 + i * 1.25;
    const lz = -1.35 - rand() * 0.55;
    const p = toWorld(lx, lz);
    const w = 1.5 + rand() * 1.4;
    const h = 0.34 + rand() * 0.30;
    const drift = new THREE.Mesh(
      chamferedBox(w, h, w * 0.72, 0.12, 0.30), ctx.M.sand);
    drift.position.set(p.x, groundY(p.x, p.z) + h * 0.18, p.z);
    drift.rotation.y = rand() * Math.PI;
    drift.rotation.z = (rand() - 0.5) * 0.16;
    drift.receiveShadow = true;
    g.add(drift);
    // Under STEP_OVER at every draw. No collider.
  }

  // --- the wreck's collision -----------------------------------------------
  //
  // ONE CONVEX CHAIN ALONG THE FUSELAGE AXIS, and nothing else.
  //
  // This is the clause the 8/01 playtest wrote. The canal's barge registered an
  // unbroken 13 m run of collision and the player who walked down its lee side
  // could not get back out. Two things make this different and both are
  // deliberate: the chain is 8 m rather than 13, and it stands in the middle of
  // the widest open floor on the map with two metres or more of walkable sand
  // on every side, so there is no second surface for it to form a corridor
  // against. There is no branch, no return leg and no alcove, so there is no
  // concave pocket for a body to be pushed into.
  //
  // NOTHING ELSE ON THIS AIRCRAFT IS SOLID. Not the rotor, which is overhead
  // and 75 mm thick; not the drooped blade tips, which are decoration a player
  // walks through; not the door in the sand, not the sheared section, not the
  // drifts. Every one of them is under the 0.75 m STEP_OVER bar that
  // dressing.js sets, and every one of them would otherwise be an invisible
  // snag in the one space that exists to be run around.
  //
  // `test/camp.mjs` DRIVES a full circuit rather than reasoning about this.

  const WRECK_COLLIDERS = [
    // local x, radius, height above the local floor
    [2.45, 0.78, 1.55],       // nose, low: the sightline down the avenue passes over it
    [1.35, 0.95, 2.05],
    [0.35, 1.05, 2.35],       // cabin
    [-0.70, 1.02, 2.30],
    [-1.65, 0.62, 1.95],      // boom root
    [-2.70, 0.48, 1.60],
    [-3.70, 0.40, 1.30],      // the fold
    [-4.55, 0.34, 1.15],      // tail
  ];

  const wreckColliders = [];
  for (const [lx, r, h] of WRECK_COLLIDERS) {
    const p = toWorld(lx, 0);
    solid('wreck', p.x, p.z, r, h);
    wreckColliders.push({ x: p.x, z: p.z, r, h });
  }

  /**
   * PROOF, AT BUILD TIME, THAT NOTHING HERE CAN BE MISTAKEN FOR THE DOOR.
   *
   * `releaseDoorway` in doors.js reaches into the shared collider array and
   * edits whatever matches two shape filters. It does not match by name,
   * because collision has exactly one representation in this codebase and it is
   * an array of anonymous cylinders. That means ANY module adding a collider is
   * one arithmetic slip away from having its prop deleted when the player buys
   * the door - or worse, from having the door refuse to open because a crate
   * answered the filter first.
   *
   * The camp is nowhere near z = -30, so this can never fire. It is here
   * anyway, because "it can never fire" is exactly what is said about every
   * check that later fires, and because a comment asserting the arithmetic is
   * not the same thing as the arithmetic being checked.
   */
  const caught = [];
  for (const c of ctx.colliders || []) {
    if (Math.abs(c.x) < 0.2 && Math.abs(c.z + 30.2) < 0.2 && c.r > 2.5 && c.r < 4) {
      caught.push({ filter: 'door-slab', ...c });
    }
    if (Math.abs(c.x) < 0.2 && Math.abs(c.z + 62) < 0.5 && c.r > 25) {
      caught.push({ filter: 'pyramid', ...c });
    }
  }
  // Exactly the two courtyard.js registers, and no more. Three would mean this
  // file put a prop where the door lives.
  const doorFilterMatches = caught.length;

  // =========================================================================

  return {
    group: g,

    /** What the siting guard refused to build. `test/camp.mjs` demands zero. */
    rejected,

    /** Where everything ended up, for the harness and for the next author. */
    sited,
    wreckColliders,

    /** The seven painted panels as world rectangles, for the pixel harness. */
    caseFaces,

    /**
     * EVERY cylinder this file added to the world's one collider array.
     *
     * Published because the claim that matters about this build is a claim
     * about collision - that there is no continuous wall, and that the wreck
     * can be walked around - and a harness that had to guess which of the
     * world's 1600 cylinders were the camp's would be measuring the courtyard
     * as well. The 8/01 playtest found the canal's barge wreck trapping the
     * player behind an unbroken 13 m run; this is the list somebody can check
     * that against without reading the file.
     */
    colliders: campColliders,

    /** Two, and they are courtyard.js's own: proof no camp prop answers a
     *  door filter. Any other number is a bug in this file. */
    doorFilterMatches,

    /** The lights this file added, so the cost can be measured, not asserted. */
    lights: lampLights,

    update(dt, t) {
      // The generator. A fan you can see turning is the whole claim.
      if (generatorFan) generatorFan.rotation.z += dt * 17.0;
      if (generatorLed) {
        // A slow charge blink, not a flicker: this thing is idling happily,
        // which is what makes it unsettling.
        const on = (t % 2.6) < 0.16;
        generatorLed.material.emissiveIntensity = on ? 3.6 : 0.35;
      }

      // The recorder. The drum turns about once every forty seconds and the pen
      // rides an anomaly it has been riding for four days.
      if (recorderDrum) recorderDrum.rotation.x += dt * 0.16;
      if (recorderPen) {
        recorderPen.rotation.z = 0.06 * Math.sin(t * 0.9)
          + 0.028 * Math.sin(t * 3.7)
          + 0.02 * Math.sin(t * 11.3);
      }

      // Mains ripple on the lamps. Two per cent, which is a generator under
      // load and not a torch about to die.
      const r = 1 + 0.02 * Math.sin(t * 7.3) + 0.012 * Math.sin(t * 23.1);
      for (const l of lampLights) l.intensity = 6.5 * r;
    },

    setFidelity(high) {
      for (const l of lampLights) l.distance = high ? 17 : 11;
      // Thin geometry first, exactly as dressing.js drops its tier 3: it is the
      // cheapest thing to remove and the most expensive to rasterise per pixel
      // of value. The lamps and the wreck stay at every setting, because the
      // camp is a story beat and not decoration.
      g.traverse((o) => {
        if (o.userData?.tier === 3) o.visible = high;
      });
    },
  };
}
