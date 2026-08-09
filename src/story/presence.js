/**
 * HER, AT DISTANCE - the two beats where the archaeologist is a SIGHTING.
 *
 * `docs/PLAYTHROUGH.md` beats 1.5 and 3.7, both of them GAP until this file.
 *
 *   1.5  A woman ahead with a lamp, too far to reach.            (Act 1, outside)
 *   3.7  Her lamp, standing still, and the horde flows PAST it.  (Act 3, inside)
 *
 * ---------------------------------------------------------------------------
 * WHY THEY ARE ONE FILE AND NOT TWO
 * ---------------------------------------------------------------------------
 *
 * They are the same beat at two ends of a world, and they fail the same way. In
 * both cases the thing that has to be got right is not the geometry - it is
 * WHEN THE PLAYER IS ALLOWED TO SEE THE OBJECT CHANGE STATE. A figure that pops
 * in is a bug. A figure that fades out is a trick. A lamp that arrives with a
 * chime is a quest marker. All three failures are one rule, so they get one
 * implementation:
 *
 *     NOTHING IN THIS FILE IS EVER ADDED TO OR REMOVED FROM THE SCENE ON A
 *     FRAME THE PLAYER COULD SEE IT HAPPEN.
 *
 * `visible()` below is the whole file. Everything else is two lists of boxes.
 *
 * ---------------------------------------------------------------------------
 * WHAT "COULD SEE IT" MEANS, MEASURED RATHER THAN ASSUMED
 * ---------------------------------------------------------------------------
 *
 * Three tests, cheapest first, and all three have to pass before a frame counts
 * as one the player can see:
 *
 *   1. THE SPACE. `spaces.active` is the world being drawn. The courtyard group
 *      is `visible = false` while the player is inside the pyramid, so a figure
 *      parented to it is not on screen at all no matter where the camera points.
 *   2. THE FRUSTUM. A sphere at the object's own centre against the camera's
 *      projection. This is exact, it is what three itself culls with, and it
 *      costs six plane tests.
 *   3. THE STONE. A segment from the eye to the object against the COLLIDER
 *      ARRAY - `world.colliders`, the same cylinders the player and the horde
 *      both walk into. courtyard.js: "Collision has exactly one representation
 *      in this codebase and it is the array in this function." Asking the
 *      colliders rather than raycasting the scene graph is thirty times cheaper
 *      and it cannot disagree with what the player can walk through.
 *
 * The occlusion test is THROTTLED to one frame in five and only runs while
 * something is armed or up, because the answer cannot change meaningfully in
 * 80 ms and this is the only part of the file with a loop in it.
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE MODE THIS DESIGN CHOOSES, AND IT IS THE RIGHT ONE
 * ---------------------------------------------------------------------------
 *
 * A player who stares down the avenue and never once looks away keeps her. A
 * player who never enters the Great Gallery after wave 12 never gets the lamp.
 * The beats are MISSABLE, on purpose - PLAYTHROUGH is explicit about 3.7: "If
 * the player misses it, they miss it. That is the design."
 *
 * The alternative is a timer, and a timer is what makes a sighting into a
 * cutscene: it retires her at second six whether or not anybody is looking, and
 * one player in ten watches a woman evaporate. A missed beat costs nothing. A
 * beat that visibly cheats costs the whole conceit.
 *
 * There is still an outer bound - `holdMs` - after which the object is retired
 * at the next unseen frame rather than immediately. It is a bound on how long a
 * prop lingers, not a bound on the beat, and it can never fire in view.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE IS A COLLIDER, AND THAT IS BEAT 3.7's ENTIRE MECHANISM
 * ---------------------------------------------------------------------------
 *
 * `src/world/camp.js` CAMP.lane records what one prop 0.2 m into the player's
 * walking line cost this project: a control build walks the avenue at x 0.000
 * and the same walk with one crate present ends jammed in a corner past the
 * door it was walking to. So this file registers NO collider, at all, anywhere,
 * and it sites the Act 1 figure ON TOP OF A WALL rather than on the floor, which
 * is what "too far to reach" is made of. MEASURED: her feet are at 7.38 m, a
 * body sprinting and jumping at her for 900 controller steps peaks at 1.40 m,
 * and `enemies/flow.js` CLIMB is 0.65 - she is 5.98 m above the best he can do.
 *
 * And it is why the horde flows past the Act 3 lamp rather than around it. The
 * flow field is built from the collider array. A lamp that registers nothing is
 * a lamp the routing has never heard of, so the dead walk through her light
 * without deviating by a centimetre - not because they were told to ignore it,
 * but because to them it is not there. THE BEAT IS TRUE BY CONSTRUCTION rather
 * than scripted, which is the only way it survives a second run with somebody
 * looking for the seams.
 *
 * ---------------------------------------------------------------------------
 * THE SITES ARE GUARDED, NOT AUTHORED
 * ---------------------------------------------------------------------------
 *
 * `src/world/camp.js` site() exists because three of the first six positions
 * tried in that file landed inside a railing, a brazier skirt and a chapel jamb,
 * and none of them would have thrown. The avenue wall this file stands her on is
 * built from a seeded PRNG - `ruined = breached || rand() < 0.18` - so which
 * bays are broken down to a stub is a property of the shipped seed and not of
 * anything written down. Hard-coding a height off one capture is exactly the
 * class of bug that ships as a woman standing in mid air.
 *
 * So both sites are CANDIDATE LISTS and `resolve()` picks the first one the
 * collider array actually supports, reading her standing height off the stone
 * rather than off a constant. Rejections are counted and returned, the way
 * camp.js returns its own, because a beat that quietly relocated itself is worse
 * than one that failed loudly.
 */

import * as THREE from 'three';

/**
 * ACT 3 STARTS AT WAVE 12, AND THE NUMBER COMES FROM THE PAPER CUT.
 *
 * `docs/PLAYTHROUGH.md`: "ACT 3 - THE MACHINE, THE SILENCE, THE NAME (waves ~12
 * to 25)". The Kindling itself is the third jar and the jar chain owns that
 * event, but gating on the jar would make this file import the jar chain to
 * learn one boolean, and a player who has not seated three jars by wave twelve
 * is in Act 3 by every other measure the game applies to him.
 */
export const ACT3_FROM_WAVE = 12;

/** The last wave the Act 1 sighting may arm on. Act 1 is "waves 1 to about 4". */
export const ACT1_TO_WAVE = 4;

/**
 * HOW HIGH SHE HAS TO BE STANDING FOR "TOO FAR TO REACH" TO BE A FACT.
 *
 * `enemies/flow.js` CLIMB is 0.65 and dressing.js's STEP_OVER is 0.75: anything
 * under that is walked onto rather than blocked by. The floor of this range is
 * five times the higher of the two, so there is no reading of the controller
 * under which she is a place the player can get to.
 *
 * The ceiling matters as much and for the opposite reason. The intact bays of
 * the avenue wall stand at 12.5 to 13.25 m, and a 1.7 m figure on top of one is
 * seven pixels of dark against the sky at the distance the player first sees
 * her - which is not a sighting, it is a smudge. The ruined bays are the site;
 * the guard is what makes that a measurement rather than a preference.
 */
const STAND = { min: 3.0, max: 7.0 };

/**
 * How far the DRAWN surface may sit from the collider top before the site is
 * refused. See surfaceAt(): the two disagree by design, but by centimetres or a
 * metre, not by a storey.
 */
const REACH_MAX = 2.0;

/** Metres of clear floor a lamp needs around it before it is sited. */
const LAMP_CLEAR = 1.4;

/**
 * How far from the player each beat must be to arm, in metres.
 *
 * 1.5 is "a woman AHEAD", which is a distance word. 3.7 is "down a LONG
 * sightline", which is the same word again - and there it is load bearing, since
 * the horde has to have somewhere to flow past the lamp FROM. A lamp four metres
 * from the player has the horde arriving at it and him in one step.
 */
const MIN_RANGE = { sighting: 18, lamp: 13 };

/** Wall-clock milliseconds an object may stand before it wants to retire. */
const HOLD_MS = { sighting: 42000, lamp: 34000 };

/**
 * Seconds the player must have actually had eyes on it before a retire is
 * even considered.
 *
 * Without this, arming and retiring can both land inside the same half second
 * of a player sweeping the mouse past, and the beat never existed. With it, the
 * object is guaranteed to have been on screen for a beat and a half before the
 * file will take it away, and it is still only taken away unseen.
 */
const MIN_SEEN_S = 1.5;

/** Frames between occlusion tests. See the header on why this is throttled. */
const OCCLUDE_EVERY = 5;

/**
 * THE OCCLUDERS ARE DELIBERATELY THINNER THAN THE COLLIDERS, AND THE DIRECTION
 * OF THE ERROR IS THE WHOLE REASON THIS CONSTANT EXISTS.
 *
 * The collider array is a SEALING representation, not a visual one:
 * courtyard.js's addWallRun overlaps 1.6 to 1.7 m cylinders along a wall whose
 * stone is nearer 2.2 m thick, because a run that only just touches leaks a
 * body through it. Every cylinder in the map is therefore a little fatter than
 * the thing the player can see.
 *
 * Used raw as an occluder that fat is not a rounding error, it is a defect.
 * MEASURED on the first run of `test/presence.mjs`: from the spawn end of the
 * avenue the sightline to her chest grazes the bay north of hers at x -13.43,
 * 1.57 m from a cylinder of radius 1.60 - so the model said OCCLUDED at a
 * camera angle where the stone is edge-on and she is plainly on screen. That
 * is the one error this file cannot make: an object told it is hidden is an
 * object allowed to appear, and appearing in front of somebody is the bug.
 *
 * So the occluder is shrunk to roughly the visible half-thickness. The error
 * now runs the other way - the model calls her VISIBLE slightly more often than
 * she really is - and that direction is free: the worst it can do is make a
 * beat wait a few more frames for a cleaner moment.
 *
 * `test/presence.mjs` does not take this on trust. It samples the avenue and
 * compares the model's answer against an A/B pixel diff at each point, and
 * fails on any camera where the model says hidden and the frame says otherwise.
 */
const SHRINK = 0.68;
const MIN_OCCLUDER = 0.22;

// ---------------------------------------------------------------------------
// the sites
// ---------------------------------------------------------------------------

/**
 * WHERE SHE STANDS IN ACT 1, in the order the guard tries them.
 *
 * All of them are on the WEST wall line and all of them are south of the camp,
 * which is two decisions:
 *
 *   WEST, because the wreck and its rotor are east of the centreline and the
 *   only exterior sightline that is not allowed to be blocked runs from the
 *   spawn to the sealed doorway. She is on the other side of the frame from the
 *   helicopter and well off the axis of the door - the door subtends about four
 *   degrees from the spawn and she sits fifteen off it.
 *
 *   SOUTH OF THE CAMP, because the camp occupies z 27 down to 9 and a figure
 *   standing over it is a figure standing in front of the one piece of dressing
 *   in Act 1 that has to be read. Down the avenue she is the only thing in the
 *   frame that is not architecture.
 *
 * `x` is the WALL LINE, not the avenue: AVENUE.halfWidth is 15 and the bay
 * cylinders sit at 15 to 16.2 with r 1.6 to 1.7, so a foot placed at 15.0 is
 * inside the footprint of whatever that bay turned out to be, which is the only
 * way `standAt` can find the top of it.
 *
 * ---------------------------------------------------------------------------
 * THE FIRST SITE WAS PICKED BY READING AND IT WAS WRONG. THIS ONE WAS MEASURED.
 * ---------------------------------------------------------------------------
 *
 * The first pass profiled the collider array along both wall lines and found a
 * ruined bay on the WEST wall at z -10..-17, eight metres of stub standing at
 * 3.60 m with twelve and a half metres of intact wall either side of it. On
 * paper that is the composition: a person-shaped gap in a parapet with sky
 * behind her.
 *
 * MEASURED, `test/presence.mjs`, eleven camera positions down the avenue: ZERO
 * pixels from every one of them, and the module's own `explain()` naming the
 * culprit each time - a cylinder at (-13.0, -11.0), r 1.50, h 11.00, and
 * another at (-14.1, -9.68), r 0.27, h 10.36.
 *
 * THE AVENUE IS COLONNADED. There is a row of ten-metre columns standing two
 * metres inboard of the wall line, and no source file says so in a sentence -
 * it is an emergent property of courtyard.js's bay loop. A figure on the wall
 * head behind them is behind a picket fence at every angle except broadside,
 * and broadside is close enough to be a different beat.
 *
 * So the site was chosen by survey instead: `node test/presence.mjs <base>
 * --survey` scores every standable point in the exterior between 3 and 7 m by
 * how many of a hundred positions a player actually occupies can see it. The
 * west stub does not appear in the top forty. What does, at the top, is THE
 * BREACHED EAST BAY:
 *
 *     (14.4,  1)  stand 6.21 m   seen from 78 of 100   from 10 m out to 50
 *     (15.6,  2)  stand 5.98 m   seen from 77 of 101
 *     (13.2, -1)  stand 5.46 m   seen from 77 of  97
 *
 * That is the hit courtyard.js already put in the east wall - "The east wall
 * has taken a hit across two bays. A single localised collapse is worth more
 * than evenly-distributed damage" - and the collapse took the columns with it.
 * She stands on top of it, six metres up, in the one gap in the avenue's
 * colonnade, and three quarters of the walk has a clear line to her.
 *
 * The west stub is kept at the bottom of the list, because the day the avenue
 * is re-rolled it may be the one that is standing.
 */
export const SIGHTING_SITES = [
  { x: 15.0, z: 1.0 },
  { x: 15.0, z: -1.5 },
  { x: 15.0, z: 5.0 },
  { x: 15.0, z: -4.0 },
  { x: -15.0, z: 16.0 },
  { x: -15.6, z: -13.5 },
];

/**
 * WHERE HER LAMP SITS IN ACT 3, in the order the guard tries them.
 *
 * The Great Gallery, in the NORTH half, and that is where the measurement put
 * it rather than where the drama wanted it.
 *
 * The first plan was the opposite - lamp south, player north - and it was wrong
 * for a reason no amount of reading rooms.js would have surfaced. `director
 * .spawnPoints()` is the list the placement filter ACTUALLY offers, not the one
 * rooms.js authors, and of the gallery's five authored points it offers exactly
 * two: (-24, -162) and (24, -162), both at the north end. The three southern
 * ones sit behind Act 3 gates. So the horde enters this room from the north,
 * always, and it walks south, and a lamp at the south end would have been a
 * lamp the horde arrives at rather than one it goes past.
 *
 * That settles the staging, and it happens to be the staging Act 3 was already
 * going to produce: all three Act 3 doors are on the south wall, so the player
 * holds the south end and everything that comes for him crosses the north half
 * on the way.
 *
 * MEASURED, 420 frames of wave 13 with the player parked at (0, -192), the
 * horde's positions read off the scene graph on every frame and binned into 3 m
 * cells. Two streams, one down each side of the nave, and the east one carried
 * three times the traffic on this sample:
 *
 *     ( 9, -183) 338   ( 9, -180) 240   (12, -177) 124   (12, -174) 108
 *     (15, -168) 121   (15, -171)  94   (18, -165) 130
 *     (-18, -165) 196  (-15, -168) 191  (-9, -177) 145   (-12, -174) 48
 *
 * The centre of the nave carries almost nothing, which is not a surprise once
 * it is measured: the mystery box sits at (0, -177) and a rubble pile at
 * (0, -183), so the routing splits around them. A lamp on the centreline would
 * have been a lamp in the one lane of that room nothing walks down.
 *
 * So: the east stream, at (12.5, -174.5). Twenty-one metres from a player at
 * the south doorway, four hundred-odd samples of traffic inside three metres,
 * clear of the ramp footprint (x 17..25) and five metres off the brazier at
 * (8, -170) so the pool it throws is the only warm thing on that floor.
 */
export const LAMP_SITES = [
  { x: 11.0, z: -178.5 },
  { x: 12.5, z: -174.5 },
  { x: -11.0, z: -178.0 },
  { x: -12.5, z: -173.0 },
];

/**
 * AND THE FIRST OF THOSE FOUR IS ALSO A CORRECTION.
 *
 * (12.5, -174.5) was tried first, on the reasoning that further from the player
 * is a longer sightline. Measured over 240 frames of wave 13: twelve actors
 * alive, 1575 samples, and exactly ONE of them ever came inside three metres of
 * it. The other eleven bunched around the player and their closest approach to
 * the lamp was twenty-one metres, which is just the distance from the player to
 * the lamp - they had arrived and stopped.
 *
 * The horde is not a river, it is a river with a drain in it, and the drain is
 * wherever the player is standing. So the lamp has to sit on the last stretch
 * before the drain rather than out at the head of the room. (11.0, -178.5) is
 * seventeen metres from the south doorway instead of twenty-one, and the same
 * survey puts roughly 385 samples inside three metres of it against 230 for the
 * far site.
 *
 * The four metres cost nothing the beat needs: the room is thirty-eight deep
 * with sixteen units of ceiling, and seventeen metres of it with bodies crossing
 * a pool of light is still the longest sightline in World 1.
 */

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

/**
 * A PERSON AT SIXTY PIXELS, WHICH IS THE WHOLE PROBLEM.
 *
 * She is never closer than twenty metres and never has a face, so none of the
 * usual cues are available. What survives at that size is the SILHOUETTE, and
 * a human silhouette is three facts in a row: a head narrower than the
 * shoulders, shoulders wider than the waist, and a vertical that does not move
 * while everything else in the frame does.
 *
 * So the build is a taper, not a mannequin. No hands, no feet, no face, no
 * separated legs - at this range a gap between two legs is sub-pixel and costs
 * two draw calls to be invisible. The one asymmetry is the arm carrying the
 * lamp, which is what stops the silhouette reading as a post.
 *
 * MATERIALS ARE FLAT AND DARK ON PURPOSE. She is lit by desert noon from behind
 * the pyramid, and a figure that takes the sun reads as a statue - the courtyard
 * is full of statues. Dark and matte reads as cloth, and cloth at distance in
 * this light is a person.
 */
function buildFigure() {
  const g = new THREE.Group();

  const cloth = new THREE.MeshStandardMaterial({
    color: 0x24201b, roughness: 1.0, metalness: 0.0,
  });
  const skin = new THREE.MeshStandardMaterial({
    color: 0x4a3b2c, roughness: 0.95, metalness: 0.0,
  });

  const owned = { geo: [], mat: [cloth, skin] };
  const add = (geo, mat, x, y, z, rz = 0) => {
    owned.geo.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rz) m.rotation.z = rz;
    m.castShadow = false;
    m.receiveShadow = false;
    g.add(m);
    return m;
  };

  // Skirt to shoulder, one taper. 0.90 m of it, flared at the hem.
  add(new THREE.CylinderGeometry(0.17, 0.26, 0.92, 8), cloth, 0, 0.46, 0);
  // Torso, boxier than the skirt so the waist reads as a change of shape.
  add(new THREE.BoxGeometry(0.36, 0.56, 0.22), cloth, 0, 1.20, 0);
  // The shoulder line. The single most load-bearing 10 cm in the model: it is
  // what makes the head read as a head rather than as the top of a post.
  add(new THREE.BoxGeometry(0.46, 0.11, 0.24), cloth, 0, 1.50, 0);
  add(new THREE.CylinderGeometry(0.055, 0.06, 0.10, 6), skin, 0, 1.58, 0);
  add(new THREE.SphereGeometry(0.113, 10, 8), skin, 0, 1.68, 0);

  // The arm that carries it, held a little out from the body so the lamp is not
  // buried in the silhouette it is supposed to be beside.
  add(new THREE.BoxGeometry(0.095, 0.52, 0.095), cloth, 0.235, 1.20, 0.02, -0.13);
  add(new THREE.BoxGeometry(0.095, 0.30, 0.095), cloth, 0.285, 0.80, 0.02, 0.0);

  return { group: g, owned, lampAt: [0.285, 0.63, 0.02] };
}

/**
 * THE LAMP, AND IT IS A LIGHT BEFORE IT IS AN OBJECT.
 *
 * At twenty-five metres in a room lit by four braziers, a 12 cm clay vessel is
 * nothing. THE POOL IT THROWS ON THE FLOOR IS THE BEAT: three metres of warm
 * flagstone with bodies crossing it, lit from below, not one of them turning.
 * The object exists so the pool has a source; the pool is what carries.
 *
 * `world/camp.js` LIGHT BUDGET is the constraint and it is respected here: this
 * is ONE non-shadow PointLight, and it exists only for the seconds the beat is
 * up. three.js has no per-object light culling, so a permanent light is paid for
 * by every forward-lit fragment in the frame forever; a light that is added and
 * removed with its own prop costs nothing on any frame the beat is not running.
 *
 * The flame is a MeshBasicMaterial with its colour driven ABOVE 1.0 per channel.
 * That is not a mistake and it is the reason the flame survives the tone map:
 * `core/post.js` runs a bloom pass, bloom keys off luminance, and a value of 1.0
 * is exactly the value that does not bloom. The braziers in this map are legible
 * from across the Great Gallery for the same reason.
 */
function buildLamp() {
  const g = new THREE.Group();

  const clay = new THREE.MeshStandardMaterial({
    color: 0x6b5844, roughness: 0.9, metalness: 0.0,
  });
  const flame = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false });
  flame.color.setRGB(3.4, 1.9, 0.85);

  const owned = { geo: [], mat: [clay, flame] };
  const add = (geo, mat, x, y, z) => {
    owned.geo.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  // A saucer lamp: a shallow bowl with a lip, which is what the map's own oil
  // lamps are and what an archaeologist four days into a tomb would be burning.
  add(new THREE.CylinderGeometry(0.115, 0.085, 0.055, 10), clay, 0, 0.028, 0);
  add(new THREE.TorusGeometry(0.105, 0.018, 5, 10), clay, 0, 0.055, 0)
    .rotation.x = Math.PI / 2;
  add(new THREE.SphereGeometry(0.052, 8, 6), flame, 0, 0.10, 0.055);

  const light = new THREE.PointLight(0xffb26a, 5.5, 9.0, 2);
  // Brazier shadows are a per-room budget decision in this project and the
  // answer has been no every time. See world/camp.js LIGHT BUDGET.
  light.castShadow = false;
  light.position.set(0, 0.24, 0);
  g.add(light);

  return { group: g, owned, light };
}

// ---------------------------------------------------------------------------
// the module
// ---------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {object} o.spaces   systems/spaces.js - the active world and its groups
 * @param {THREE.Camera} o.camera  the rig camera, for the frustum test
 * @param {object} o.player   for the range gates. Only `position` is read.
 * @param {object} o.director enemies/director.js - `wave` and `liveCount` only
 */
export function createPresence({ spaces, camera, player, director = null }) {
  if (!spaces || !camera || !player) {
    throw new Error('createPresence needs spaces, camera and player');
  }

  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const eye = new THREE.Vector3();
  const at = new THREE.Vector3();

  /** Sites the guard refused, and why. Asserted empty-ish by the harness. */
  const rejected = [];

  // -------------------------------------------------------------------------
  // siting
  // -------------------------------------------------------------------------

  /**
   * The top of the tallest collider standing over a point, or 0 for open floor.
   *
   * This is the same question `enemies/flow.js` asks when it decides whether a
   * cell is standable, asked of the same array, which is why it can be trusted
   * to answer "is there stone here and how high is it" for a space this file
   * did not build.
   */
  function standAt(colliders, x, z) {
    let top = 0;
    for (const c of colliders) {
      const dx = c.x - x;
      const dz = c.z - z;
      if (dx * dx + dz * dz > c.r * c.r) continue;
      const t = (c.y0 || 0) + c.h;
      if (t > top) top = t;
    }
    return top;
  }

  /**
   * WHERE THE STONE ACTUALLY IS, as opposed to where the collider says it is.
   *
   * These are two different numbers and the difference put her chest-deep in a
   * wall. `standAt` reads the collider array, which is a SEALING
   * representation: courtyard.js overlaps cylinders to close a run, and their
   * tops are the height a body is stopped at rather than the height the stone
   * is drawn to. MEASURED by A/B pixel diff on the breached east bay: with her
   * feet on the collider top at 6.21 m she contributed an 18 by 19 pixel patch
   * at fifteen metres, against the sixty-odd pixels a 1.7 m figure subtends
   * there. Everything below her shoulders was inside the wall.
   *
   * So the collider array chooses the site - it is the only thing that can
   * answer "can the player get up here" - and then ONE downward raycast against
   * the space's own geometry decides where her feet go. It runs once, at siting,
   * and never again.
   *
   * A miss, or a surface more than 2 m from what the colliders promised, is
   * refused rather than used: a raycast that came back with the roof of
   * something else is exactly how a figure ends up standing in the air.
   */
  function surfaceAt(group, x, z, near) {
    if (!group) return null;
    /*
     * THE RAY STARTS JUST ABOVE THE COLLIDER, NOT HIGH ABOVE THE MAP.
     *
     * The first cut dropped from `near + 12` and it was not deterministic
     * between runs: over the breached east bay it returned 7.38 m once and
     * 12.62 m the next time, because a lintel spans that bay six metres higher
     * and whether the ray met it first depended on what the fidelity switch had
     * hidden that frame. A siting that moves between boots is worse than a
     * siting that is slightly wrong, because only one of the two can be
     * reviewed.
     *
     * The question this is asking is narrow - "the collider says the stone tops
     * out around here, where exactly is its face" - so the ray is given a window
     * of two metres either side of the collider top and nothing else can answer
     * it. Anything above that window is a different piece of architecture.
     */
    const REACH = 2.0;
    const ray = new THREE.Raycaster(
      new THREE.Vector3(x, near + REACH, z), new THREE.Vector3(0, -1, 0), 0, REACH * 2);
    const hits = ray.intersectObject(group, true);
    for (const h of hits) {
      if (!h.object || h.object.visible === false) continue;
      return h.point.y;
    }
    return null;
  }

  /** Metres of daylight between a point and the nearest collider's skin. */
  function clearanceAt(colliders, x, z) {
    let gap = Infinity;
    for (const c of colliders) {
      const d = Math.hypot(c.x - x, c.z - z) - c.r;
      if (d < gap) gap = d;
    }
    return gap;
  }

  /**
   * Pick the first candidate the stone actually supports.
   *
   * `wants` is either 'stand' - a top inside STAND, which is a wall head she can
   * be on and the player cannot get to - or 'floor', which is the opposite: open
   * ground with LAMP_CLEAR of daylight round it, so the lamp is not sited inside
   * a colonnade drum.
   */
  function resolve(kind, sites, colliders, wants, group) {
    for (const s of sites) {
      const top = standAt(colliders, s.x, s.z);

      if (wants === 'stand') {
        if (top < STAND.min || top > STAND.max) {
          rejected.push({ kind, x: s.x, z: s.z,
            why: `stands at ${top.toFixed(2)} m, outside ${STAND.min}..${STAND.max}` });
          continue;
        }
        const face = surfaceAt(group, s.x, s.z, top);
        if (face === null || Math.abs(face - top) > REACH_MAX) {
          rejected.push({ kind, x: s.x, z: s.z,
            why: face === null
              ? `collider top ${top.toFixed(2)} m but the ray found no surface`
              : `surface at ${face.toFixed(2)} m disagrees with the collider's ${top.toFixed(2)} m` });
          continue;
        }
        return { x: s.x, y: face, z: s.z, colliderTop: +top.toFixed(2) };
      }

      if (top > 0.2) {
        rejected.push({ kind, x: s.x, z: s.z, why: `stone at ${top.toFixed(2)} m over the floor` });
        continue;
      }
      const gap = clearanceAt(colliders, s.x, s.z);
      if (gap < LAMP_CLEAR) {
        rejected.push({ kind, x: s.x, z: s.z,
          why: `${gap.toFixed(2)} m of clearance, needs ${LAMP_CLEAR}` });
        continue;
      }
      return { x: s.x, y: 0, z: s.z };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // visibility - the whole file
  // -------------------------------------------------------------------------

  /**
   * IS THE SEGMENT eye -> at BROKEN BY STONE.
   *
   * A collider is a vertical cylinder. The 2D circle/segment intersection gives
   * the parametric window in which the segment is inside the footprint; the
   * segment's height is monotone along t, so the chord is blocked unless BOTH
   * ends of that window pass above the cylinder's top or below its base.
   *
   * Testing the ends rather than the midpoint matters for exactly the geometry
   * this file creates: she stands ON a wall, so the ray to her chest enters the
   * wall's own footprint 1.7 m before it reaches her and is above the wall head
   * for every metre of it. A midpoint test would call that occluded and she
   * would be arm-and-retire in the same frame, forever.
   */
  /** The blocker found by the last blocked() call, for `explain()`. */
  let blocker = null;

  function blocked(colliders, ex, ey, ez, ax, ay, az) {
    blocker = null;
    const dx = ax - ex;
    const dy = ay - ey;
    const dz = az - ez;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) return false;

    for (const c of colliders) {
      const r = c.r * SHRINK < MIN_OCCLUDER ? MIN_OCCLUDER : c.r * SHRINK;
      const fx = ex - c.x;
      const fz = ez - c.z;
      const b = fx * dx + fz * dz;
      const cc = fx * fx + fz * fz - r * r;
      const disc = b * b - len2 * cc;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      let t0 = (-b - sq) / len2;
      let t1 = (-b + sq) / len2;
      if (t1 <= 0.001 || t0 >= 0.999) continue;
      if (t0 < 0.001) t0 = 0.001;
      if (t1 > 0.999) t1 = 0.999;

      const base = c.y0 || 0;
      const top = base + c.h;
      const yA = ey + dy * t0;
      const yB = ey + dy * t1;
      if (yA > top && yB > top) continue;
      if (yA < base && yB < base) continue;
      blocker = { x: +c.x.toFixed(2), z: +c.z.toFixed(2), r: +c.r.toFixed(2), h: +c.h.toFixed(2),
        rUsed: +r.toFixed(2), rayY: [+yA.toFixed(2), +yB.toFixed(2)] };
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // a beat
  // -------------------------------------------------------------------------

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function createBeat(spec) {
    const b = {
      id: spec.id,
      space: spec.space,
      /** 'waiting' | 'armed' | 'up' | 'done' */
      phase: 'waiting',
      site: null,
      built: null,
      group: null,
      upAt: 0,
      seenS: 0,
      seenFrames: 0,
      /** Times the object was added or removed on a frame the player could see
       *  it. The one number in this file that must always be zero. */
      violations: 0,
      /** True if the outer bound rather than the player's attention ended it. */
      lingered: false,
      forced: false,
    };

    /** The point the frustum and the ray are tested against. */
    b.focus = () => at.set(b.site.x, b.site.y + spec.focusY, b.site.z);
    b.radius = spec.radius;
    b.spec = spec;
    return b;
  }

  const sighting = createBeat({
    id: 'sighting',
    space: 'exterior',
    // Her chest, not her feet. A frustum sphere at ground level on a wall head
    // is half inside the wall.
    focusY: 1.15,
    radius: 1.1,
    minRange: MIN_RANGE.sighting,
    holdMs: HOLD_MS.sighting,
  });

  const lamp = createBeat({
    id: 'lamp',
    space: 'interior',
    focusY: 0.35,
    radius: 1.6,
    minRange: MIN_RANGE.lamp,
    holdMs: HOLD_MS.lamp,
  });

  const beats = [sighting, lamp];

  let frameNo = 0;
  const occl = { sighting: false, lamp: false };

  /**
   * Can the player see this beat's object RIGHT NOW.
   *
   * The occlusion half is cached between throttled tests, which is a deliberate
   * bias: a stale cache says "occluded" for up to five frames after the player
   * has actually got line of sight back, so the failure direction is a beat that
   * waits a fraction longer, never a beat that changes state in view.
   */
  function visible(b) {
    if (!b.site) return false;
    if (spaces.active !== b.space) return false;

    b.focus();
    sphere.center.copy(at);
    sphere.radius = b.radius;

    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    if (!frustum.intersectsSphere(sphere)) return false;

    if (frameNo % OCCLUDE_EVERY === 0) {
      camera.getWorldPosition(eye);
      occl[b.id] = blocked(
        spaces.world.colliders || [],
        eye.x, eye.y, eye.z, at.x, at.y, at.z
      );
    }
    return !occl[b.id];
  }

  function rangeTo(b) {
    const p = player.position;
    return Math.hypot(p.x - b.site.x, p.z - b.site.z);
  }

  // -------------------------------------------------------------------------
  // raise and retire, both of them only ever unseen
  // -------------------------------------------------------------------------

  function raise(b) {
    const built = b.spec.build();
    b.built = built;
    b.group = built.group;
    // Named so a harness can find it in the graph and toggle it for an A/B
    // capture without this file growing a seam that only a test uses. batch.js
    // merges by group name and takes no interest in one it does not know.
    b.group.name = `presence:${b.id}`;
    b.group.position.set(b.site.x, b.site.y, b.site.z);
    b.group.rotation.y = b.spec.yaw || 0;

    const parent = b.space === 'interior' ? spaces.interior.group : spaces.courtyard.group;
    parent.add(b.group);

    b.phase = 'up';
    b.upAt = now();
    b.seenS = 0;
    b.lingered = false;
  }

  function retire(b) {
    if (b.group && b.group.parent) b.group.parent.remove(b.group);
    if (b.built) {
      for (const g of b.built.owned.geo) g.dispose();
      for (const m of b.built.owned.mat) m.dispose();
      if (b.built.light && b.built.light.dispose) b.built.light.dispose();
    }
    b.group = null;
    b.built = null;
    b.phase = 'done';
  }

  // -------------------------------------------------------------------------
  // the gates
  // -------------------------------------------------------------------------

  /** Has the world reached the act this beat belongs to. */
  function armable(b) {
    if (b.forced) return true;
    if (!director) return false;
    const w = director.wave;
    if (b.id === 'sighting') return w >= 1 && w <= ACT1_TO_WAVE;
    // The lamp wants a horde to flow past it. Without one it is a lamp, and the
    // room is named because "down a long sightline" is a property of ONE room
    // in this map: sixteen units of ceiling and thirty-eight metres of floor.
    return w >= ACT3_FROM_WAVE
      && director.liveCount >= 4
      && spaces.roomId === 'great-gallery';
  }

  /**
   * THE WINDOW CLOSES, and it closes without ever showing the player a change.
   *
   * A sighting still waiting for its chance two acts later is not a sighting,
   * it is a prop that will surprise somebody at wave nineteen. Same for the
   * lamp once the player has left the room it is staged in. Both of these only
   * ever mark the beat spent - the object itself is still removed by the same
   * unseen rule as everything else.
   */
  function expired(b) {
    if (b.forced || !director) return false;
    if (b.id === 'sighting') return director.wave > ACT1_TO_WAVE + 1;
    return b.phase === 'up' && spaces.roomId !== 'great-gallery';
  }

  function siteFor(b) {
    if (b.site) return true;
    const cols = (b.space === 'interior' ? spaces.interior.colliders : spaces.courtyard.colliders)
      || spaces.world.colliders || [];
    const group = b.space === 'interior' ? spaces.interior.group : spaces.courtyard.group;
    b.site = b.id === 'sighting'
      ? resolve('sighting', SIGHTING_SITES, cols, 'stand', group)
      : resolve('lamp', LAMP_SITES, cols, 'floor', group);
    if (b.site && b.id === 'sighting') {
      // She looks back down the avenue at whoever is walking up it, which means
      // across the avenue and to the north. Resolved from the side the guard
      // landed on rather than written down, because an east-wall fallback faces
      // the other way and a figure with its back turned is a post.
      //
      // yaw convention, from test/act1shots.mjs: forward is (-sin y, 0, -cos y),
      // so -3pi/4 looks north-east and +3pi/4 looks north-west.
      b.spec.yaw = b.site.x < 0 ? -2.25 : 2.25;
    }
    return !!b.site;
  }

  function step(b, dt) {
    if (b.phase === 'done') return;

    if (b.phase === 'waiting') {
      if (expired(b)) { b.phase = 'done'; return; }
      if (!armable(b)) return;
      if (spaces.active !== b.space) return;
      if (!siteFor(b)) { b.phase = 'done'; return; }
      b.phase = 'armed';
    }

    const seen = visible(b);

    if (b.phase === 'armed') {
      if (expired(b)) { b.phase = 'done'; return; }
      // Never within arm's reach, never in view, and only in the space it
      // belongs to. All three have to hold on the same frame.
      if (seen) return;
      if (rangeTo(b) < b.spec.minRange) return;
      raise(b);
      return;
    }

    // ---- up -------------------------------------------------------------
    if (seen) {
      b.seenS += dt;
      b.seenFrames++;
      return;                       // never retire on a frame she is on screen
    }

    const lingered = now() - b.upAt > b.spec.holdMs;
    if (lingered) b.lingered = true;
    if (b.seenS >= MIN_SEEN_S || lingered || expired(b)) retire(b);
  }

  let lastT = now();

  function update() {
    frameNo++;
    const t = now();
    // Wall clock, not the loop's clamped delta. story/tableau.js documents why
    // at length: this project has shipped the same bug three times, and a held
    // beat with nothing moving in it is where it hides best.
    const dt = Math.min(0.25, (t - lastT) / 1000);
    lastT = t;

    for (const b of beats) {
      /**
       * THE INVARIANT, COUNTED RATHER THAN ASSERTED IN A COMMENT.
       *
       * `visible()` is read HERE, before step() runs, and compared against the
       * phase change step() made. If the object went into or out of the scene
       * on a frame where the player had eyes on it, that is the one failure
       * this whole file exists to prevent and it is a number the harness can
       * assert on rather than a claim in a header.
       *
       * Read before rather than after because retire() drops the site's group
       * and a visibility test taken afterwards is a test of nothing.
       */
      const before = b.phase;
      const wasSeen = (before === 'armed' || before === 'up') ? visible(b) : false;
      step(b, dt);
      const crossed = (before === 'armed' && b.phase === 'up')
        || (before === 'up' && b.phase === 'done');
      if (crossed && wasSeen) b.violations++;
    }
  }

  sighting.spec.build = buildFigure;
  lamp.spec.build = buildLamp;

  function reset() {
    for (const b of beats) {
      if (b.phase === 'up') retire(b);
      b.phase = 'waiting';
      b.site = null;
      b.seenS = 0;
      b.seenFrames = 0;
      b.violations = 0;
      b.lingered = false;
      b.forced = false;
    }
    rejected.length = 0;
  }

  return {
    update,
    reset,

    dispose() {
      for (const b of beats) if (b.phase === 'up') retire(b);
    },

    /**
     * THE HARNESS SEAM, and it opens the gate rather than the door.
     *
     * `force` only satisfies the wave and horde conditions. It cannot raise
     * anything: the range check and the two visibility checks still have to pass
     * on their own, which is what makes a suite that drives this a test of the
     * rule rather than of a bypass around it.
     */
    force(id) {
      const b = beats.find((x) => x.id === id);
      if (!b || b.phase === 'done') return false;
      b.forced = true;
      return true;
    },

    /** For the harness. Nothing on screen reads this. */
    stats() {
      const one = (b) => ({
        phase: b.phase,
        site: b.site
          ? { x: b.site.x, y: +b.site.y.toFixed(2), z: b.site.z,
            // Both numbers, because the gap between them is the bug class this
            // beat has already hit once. See surfaceAt().
            colliderTop: b.site.colliderTop === undefined ? null : b.site.colliderTop }
          : null,
        inScene: !!(b.group && b.group.parent),
        meshes: b.group ? b.group.children.length : 0,
        seenS: +b.seenS.toFixed(2),
        seenFrames: b.seenFrames,
        visible: b.site ? visible(b) : false,
        range: b.site ? +rangeTo(b).toFixed(1) : null,
        lingered: b.lingered,
        violations: b.violations,
      });
      return {
        sighting: one(sighting),
        lamp: one(lamp),
        rejected: rejected.slice(),
        violations: sighting.violations + lamp.violations,
      };
    },

    /**
     * WHY THE ANSWER IS THE ANSWER, for one beat, right now.
     *
     * The frustum half of `visible()` can be reasoned about from a screenshot.
     * The occlusion half cannot: it is a claim that a particular cylinder is
     * between the camera and the object, and a claim about what is between two
     * points that cannot be read from outside the page is not a claim worth
     * making. This returns the cylinder, its authored radius, the radius the
     * shrink actually used, and the ray's height where it crossed - which is
     * how the fat-collider defect was found rather than argued about.
     */
    explain(id) {
      const b = beats.find((x) => x.id === id);
      if (!b || !b.site) return null;
      b.focus();
      sphere.center.copy(at);
      sphere.radius = b.radius;
      projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreen);
      const inFrustum = frustum.intersectsSphere(sphere);
      camera.getWorldPosition(eye);
      const hit = blocked(spaces.world.colliders || [], eye.x, eye.y, eye.z, at.x, at.y, at.z);
      return {
        space: spaces.active === b.space,
        inFrustum,
        blocked: hit,
        blocker: hit ? blocker : null,
        eye: [+eye.x.toFixed(2), +eye.y.toFixed(2), +eye.z.toFixed(2)],
        target: [+at.x.toFixed(2), +at.y.toFixed(2), +at.z.toFixed(2)],
      };
    },

    /** The resolved sites, so a suite can photograph them without guessing. */
    get sites() {
      return { sighting: sighting.site, lamp: lamp.site };
    },
  };
}
