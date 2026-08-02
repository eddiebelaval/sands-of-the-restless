/**
 * Set dressing: placing the prop kit into the avenue.
 *
 * The prop kit builds objects. This decides WHERE they go, which is the half
 * that determines whether a space reads as built or as a prop showroom.
 *
 * Three placement rules, all taken from what the reference project does and
 * none of them obvious:
 *
 *   1. Loose props cluster against WALLS, not in the middle of the floor.
 *      Real spaces get swept by traffic; the centre of a thoroughfare is clear
 *      and the edges accumulate. Uniform scatter reads as a prop showroom.
 *
 *   2. Things must SPAN. Lines strung between opposing anchors cross the void
 *      overhead and are the single strongest depth cue available, because they
 *      are the only object whose near end and far end are both legible at once.
 *      The reference project's power lines do all the work here.
 *
 *   3. Every instance is jittered in yaw, tilt, scale and sink. The reference
 *      is blunt about this: "the identical-clone read is the loudest tell in an
 *      instanced prop cloud."
 */

import * as THREE from 'three';
import { PROPS, TIERS, PROP_INFO, catenary, propMaterials } from './propkit.js';

/** Deterministic PRNG, so the dressing is identical every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * @param {THREE.Group} parent  the world group
 * @param {object} opts
 * @param {(x:number,z:number)=>number} opts.heightAt  ground sampler
 * @param {Array} opts.colliders  the world collider list, appended to in place
 * @param {object} opts.avenue  { halfWidth, zNear, zFar, height }
 * @param {number} opts.bay  bay spacing, so props align to the architecture
 * @param {Array} opts.chapels  [{ x, z, side }] focal points
 * @param {Map} opts.bayHeight  `${side}:${bay}` -> { h, ruined }, the REAL wall
 *   heights. Anything anchored to a wall has to be seated on this rather than
 *   on avenue.height: the bays vary and some are ruined to a stub, and a line
 *   strung at the nominal height over a three-metre stub hangs from nothing.
 * @param {number} opts.bays  how many bays the wall loop built
 * @param {object} opts.forecourt  { z, halfWidth } the room at the temple front
 */
export function dressAvenue(parent, {
  heightAt = () => 0,
  colliders = [],
  avenue,
  bay = 9,
  chapels = [],
  bayHeight = null,
  bays = 7,
  forecourt = null,
  seed = 77003,
} = {}) {
  const rand = rng(seed);
  const group = new THREE.Group();
  group.name = 'dressing';
  parent.add(group);

  const placed = [];
  let tris = 0;

  const countTris = (g) => {
    g.traverse((o) => {
      if (o.isMesh && o.geometry) {
        const idx = o.geometry.index;
        tris += idx ? idx.count / 3 : (o.geometry.attributes.position?.count || 0) / 3;
      }
    });
  };

  /** Reject a position that would land inside existing geometry. */
  const clear = (x, z, r) => {
    for (const c of colliders) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < (c.r + r) * (c.r + r)) return false;
    }
    for (const p of placed) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz < (p.r + r) * (p.r + r)) return false;
    }
    return true;
  };

  /**
   * Place a ground prop, sunk slightly into the surface.
   *
   * The sink is not cosmetic. A prop resting exactly on a sampled height sits
   * on the interpolated surface, and the dune mesh between samples dips below
   * it, so it floats visibly at grazing angles. Burying a few centimetres is
   * both cheaper and more correct than solving the real contact.
   */
  const placeGround = (name, x, z, { yaw = null, scale = 1, sink = 0.06 } = {}) => {
    const info = PROP_INFO[name];
    if (!info || !PROPS[name]) return false;

    const r = (info.radius || 0.6) * scale;
    if (!clear(x, z, r)) return false;

    const built = PROPS[name](rand, { scale });
    const g = built.group;

    g.position.set(x, heightAt(x, z) - sink, z);
    g.rotation.y = yaw === null ? rand() * Math.PI * 2 : yaw;
    // A two-axis tilt sells "settled into sand" rather than "placed on a plane".
    g.rotation.x = (rand() - 0.5) * 0.05;
    g.rotation.z = (rand() - 0.5) * 0.05;

    group.add(g);
    countTris(g);

    // Only things you could not step over get collision.
    //
    // Registering a collider for every amphora and sack turns a walkable
    // avenue into an obstacle course: the player catches on scenery constantly
    // and movement stops feeling like a shooter. A knee-high pot should be
    // walked through, not negotiated. Anything under STEP_OVER is decoration.
    const STEP_OVER = 0.75;
    for (const c of built.colliders || []) {
      if (c.h < STEP_OVER) continue;
      // Tighten the footprint: prop radii are authored for placement spacing,
      // which is generous on purpose, and reusing them for collision makes
      // every object feel bigger than it looks.
      colliders.push({ x: x + c.x, z: z + c.z, r: c.r * 0.72, h: c.h });
    }
    placed.push({ x, z, r });
    return true;
  };

  /**
   * IS THERE ACTUALLY A WALL BEHIND THIS MOUNT POINT.
   *
   * A wall prop is surface relief. It has no legs, no plinth and no excuse: it
   * is a panel pinned flat to masonry, and with no masonry behind it, it is a
   * lattice hanging in clear sky. The owner photographed one and called it "a
   * broken door", which is exactly what it reads as.
   *
   * The old guard asked the wrong question. It asked HOW TALL the wall at this
   * bay is, and a bay that is a chapel recess or a gate mouth reports a height
   * like any other - the height it would have if it were wall. Height was never
   * the question. PRESENCE is. Measured on the shipped seed, two of the three
   * wall panels were mounted on bays that have no wall at that line at all: a
   * mashrabiya at (-13.65, 3.28, 12.58), which is the canal breach's mouth, and
   * another at (-13.65, 3.52, -22.67), which is the bay 6 chapel recess with
   * its back wall seven and a half metres further west.
   *
   * So this asks presence, against the collider set, which is the one
   * description of the architecture this module is given. It is the same list
   * the wall runs register into, so a bay that is solid answers immediately -
   * the mount point is already INSIDE the wall's own cylinder - and a bay that
   * opens has nothing within reach in any direction the wall could be.
   *
   * TALL ENOUGH, TOO. A prop mounted at 4.6 on a stub that tops out at 3.9 is
   * the same defect one axis over, and the old height guard was catching that
   * case and only that case; this keeps it rather than replacing it.
   *
   * IT MEASURES THICKNESS, NOT TOUCH, and that distinction is the whole test.
   * The first version of this asked whether any collider CONTAINED a point
   * behind the panel, and it passed the breach-bay panel, which is the one the
   * owner photographed. The mouth's return is a 1.7-radius cylinder standing in
   * for a 2.6-thick wall, so it bulges 1.7 metres sideways past the masonry it
   * represents and its edge clips the opening. The ray through it covered 0.53
   * metres of that cylinder against the 2.46 metres it covers on a real wall.
   * Grazing the corner of the stone beside a hole is not being mounted on it.
   *
   * So the question is how much stone the ray actually passes through, in
   * closed form per cylinder: the chord. Over a metre and the panel has a wall
   * behind it; under, and it is hanging in an opening. The two populations on
   * this map are 2.46 and 0.53, so nothing is balanced on the threshold.
   */
  const BACKING_REACH = 2.6;      // the wall face is 1.35 in from a 1.7 radius run
  const BACKING_DEPTH = 1.0;      // metres of stone the ray has to cross
  const backedBy = (x, y, z, normalX, normalZ) => {
    // Into the wall is the opposite of the face normal.
    const dx = -normalX, dz = -normalZ;
    for (const c of colliders) {
      // Stone that does not reach this high cannot be what the panel is on.
      if ((c.y0 || 0) + c.h < y + 0.4) continue;

      const ox = c.x - x, oz = c.z - z;
      const t = ox * dx + oz * dz;                    // depth of closest approach
      if (t < -c.r || t > BACKING_REACH + c.r) continue;

      const latSq = Math.max(0, ox * ox + oz * oz - t * t);
      const halfChordSq = c.r * c.r - latSq;
      if (halfChordSq <= 0) continue;
      if (2 * Math.sqrt(halfChordSq) >= BACKING_DEPTH) return true;
    }
    return false;
  };

  /**
   * Mount a wall prop flat against a face. `normal` points away from the wall.
   *
   * `backing` is the presence test above, and it defaults ON: a caller that
   * wants a panel hanging in an opening has to say so, rather than every caller
   * getting one by accident. The chapel banners are the one deliberate
   * exception and they carry their reason at the call site.
   *
   * THE PROP IS BUILT BEFORE IT IS REJECTED, and that is not waste. Every prop
   * constructor draws from the shared `rand`, and this file's whole layout -
   * the ground clusters, the cover line, the chapel focal points, the forecourt
   * - is downstream of that one stream. Skipping the construction would move
   * every later placement by however many draws the panel would have taken, so
   * a two-panel fix would reshuffle the finished avenue. courtyard.js has
   * burned draws for this exact reason three times and states the rule as THE
   * FINISHED AVENUE IS THE QUALITY BAR; this is that rule, one file over. The
   * geometry of a rejected prop is never added to the scene and is collected.
   */
  const placeWall = (name, x, y, z, normalX, normalZ, { scale = 1, backing = true } = {}) => {
    if (!PROPS[name]) return false;

    const built = PROPS[name](rand, { scale });

    if (backing && !backedBy(x, y, z, normalX, normalZ)) return false;

    const g = built.group;
    g.position.set(x, y, z);
    // The kit builds wall props with +Z out of the panel, so aim +Z along the
    // wall normal.
    g.rotation.y = Math.atan2(normalX, normalZ);

    group.add(g);
    countTris(g);
    return true;
  };

  // -------------------------------------------------------------------------
  // 1. SPANS: lines crossing the avenue overhead
  // -------------------------------------------------------------------------
  //
  // The highest-value placement in this file. A catenary crossing the void is
  // the only object in the scene whose near end and far end are simultaneously
  // legible, which is what makes the space read as having depth rather than
  // being a painted backdrop. It is also the one thing the frame currently has
  // nothing of: everything else is a solid sitting on the floor.

  const mats = propMaterials();
  const spanTop = avenue.height - 1.6;

  /**
   * The bay index nearest a z, and the two wall tops there.
   *
   * Returns null when either wall is ruined at that bay. This is the same rule
   * the architraves use and it exists for the same reason: an object anchored
   * to two walls has to be anchored to the walls that are THERE. The failure it
   * prevents is not subtle - a stone beam, or a rope, floating in mid air with
   * nothing holding either end is precisely what makes a frame read as half
   * built, and it is in this project's notes as having shipped once already.
   */
  const wallsAt = (z) => {
    if (!bayHeight) return { top: spanTop };
    const b = Math.round((avenue.zNear - z - bay / 2) / bay);
    if (b < 0 || b >= bays) return null;
    const w = bayHeight.get(`-1:${b}`);
    const e = bayHeight.get(`1:${b}`);
    if (!w || !e || w.ruined || e.ruined) return null;
    return { top: Math.min(w.h, e.h) - 1.5, west: w.h, east: e.h };
  };

  const spanZ = [];
  for (let z = avenue.zNear - bay * 0.5; z > avenue.zFar + bay; z -= bay * 0.85) {
    spanZ.push(z);
  }

  for (let i = 0; i < spanZ.length; i++) {
    const z = spanZ[i] + (rand() - 0.5) * 1.6;
    const w = wallsAt(z);
    if (!w) continue;
    const y = w.top - rand() * 1.4;

    // Alternate what is strung, so it does not read as a repeated fixture.
    const kind = i % 3;
    const from = new THREE.Vector3(-avenue.halfWidth + 1.2, y, z);
    const to = new THREE.Vector3(avenue.halfWidth - 1.2, y + (rand() - 0.5) * 0.5, z);

    if (kind === 2) {
      // A laundry line carries cloth, which catches the light and moves the
      // eye up. Built by the kit as a span prop.
      const built = PROPS.laundryLine(rand, {
        from, to, sag: 1.1 + rand() * 0.9,
      });
      group.add(built.group);
      countTris(built.group);
    } else {
      const sag = 1.2 + rand() * 1.3;
      const geo = catenary(from, to, sag, { radius: kind === 0 ? 0.035 : 0.05 });
      const line = new THREE.Mesh(geo, kind === 0 ? mats.cord[0] : mats.iron[0]);
      line.castShadow = true;
      group.add(line);
      countTris(line);
    }
  }

  // A second, sparser set running LENGTHWISE down the avenue, between pylons on
  // the same side. Crossing lines at two different angles reads as
  // infrastructure; parallel lines read as a fence.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z0 = avenue.zNear - bay * (1.5 + i * 2);
      const z1 = z0 - bay * 1.6;
      if (z1 < avenue.zFar) continue;

      // Seated on the LOWER of the two bays it runs between, for the same
      // reason the crossing spans are: this line is tied to the pylons on one
      // wall, and if either of those bays came down there is nothing to tie to.
      const a = wallsAt(z0), b2 = wallsAt(z1);
      if (!a || !b2) continue;

      const x = side * (avenue.halfWidth - 1.6);
      const y = Math.min(a.top, b2.top) - 1.4 - rand() * 1.0;

      const geo = catenary(
        new THREE.Vector3(x, y, z0),
        new THREE.Vector3(x + (rand() - 0.5) * 0.6, y, z1),
        0.7 + rand() * 0.6,
        { radius: 0.03 }
      );
      const line = new THREE.Mesh(geo, mats.cord[0]);
      line.castShadow = true;
      group.add(line);
      countTris(line);
    }
  }

  // -------------------------------------------------------------------------
  // 2. WALL FURNITURE
  // -------------------------------------------------------------------------
  // Grilles and shutters break the flat wall face and, more importantly, put
  // thin geometry in the mid-ground where the eye travels.

  const wallProps = ['grille', 'shutter', 'mashrabiya'];
  for (const side of [-1, 1]) {
    for (let b = 0; b < 7; b++) {
      // Thinner than it was. Wall furniture is surface relief rather than an
      // object in the room, so it survives the cull - but at better than one
      // bay in two it stopped being punctuation and became pattern.
      if (rand() > 0.34) continue;

      const z = avenue.zNear - b * bay - bay / 2 + (rand() - 0.5) * 2;
      if (z < avenue.zFar) continue;

      const name = wallProps[Math.floor(rand() * wallProps.length)];
      const x = side * (avenue.halfWidth - 1.35);

      // Mounted on the wall that is actually there. A shutter hung at 7.5 on a
      // bay ruined to 3.4 is a panel hanging in the sky beside a stub, which is
      // the same class of defect as a floating beam and reads exactly as badly.
      //
      // THIS TEST IS NECESSARY AND IT IS NOT SUFFICIENT, which took a bug
      // report to learn. It asks how tall the wall is and gets an answer for
      // every bay, including the three per side that are not wall: the chapel
      // recesses step seven metres back and the gate and breach mouths are a
      // 5.2-metre hole. Those bays report a height like any other and the panel
      // goes up in front of nothing. `placeWall` now asks whether the masonry
      // is THERE, which is the question this one cannot ask, and the two
      // together are the guard this always needed.
      //
      // It also fails open on a miss - `top` falls back to 7.7, which passes -
      // and that shape is worth naming even though it is currently unreachable:
      // courtyard.js fills bayHeight for every b in 0..bays-1 and this loop
      // reads the same range, so the lookup cannot miss today. It is the same
      // shape as the reachesPlayer bug, where a check that could not answer
      // returned the answer meaning "no problem here".
      const wall = bayHeight ? bayHeight.get(`${side}:${b}`) : null;
      const top = wall ? wall.h - 1.4 : 7.7;
      if (top < 3.4) continue;
      const y = 3.2 + rand() * Math.min(4.5, top - 3.2);

      placeWall(name, x, y, z, -side, 0, { scale: 0.85 + rand() * 0.5 });
    }
  }

  // -------------------------------------------------------------------------
  // 3. GROUND CLUSTERS AGAINST THE WALLS
  // -------------------------------------------------------------------------
  // Exponential falloff from the wall line: dense at the edge, clear down the
  // middle. This is the rule that most separates a dressed space from a
  // uniformly scattered one.

  const wallGoods = [
    'crateStack', 'amphoraCluster', 'grainSacks', 'mudbrickPile', 'reedMats',
    'ammoCrates', 'sandbagEmplacement', 'waterTrough', 'bench', 'amphora',
  ];

  // TWELVE, down from forty.
  //
  // The owner's note on the exterior, twice: too many obstacles, still messy.
  // That is a composition note, not a physics one - a previous pass answered it
  // by shrinking collider radii, which fixed the snagging and left the frame
  // exactly as busy. Forty loose objects banked along two walls is a junk shop
  // whatever their collision radius is.
  //
  // The bar each survivor has to clear: it frames the shot, it leads the eye
  // toward the temple entrance, or it is cover worth fighting behind. Goods
  // placed for texture alone are gone, and the ones left are spaced far enough
  // apart to read individually instead of merging into a rubble margin.
  let attempts = 0;
  let wallPlaced = 0;
  while (wallPlaced < 12 && attempts < 700) {
    attempts++;

    const side = rand() < 0.5 ? -1 : 1;
    // Exponential distance from the wall: most props hug it.
    const inset = 1.4 + (-Math.log(1 - rand() * 0.92)) * 1.9;
    const x = side * (avenue.halfWidth - inset);
    const z = avenue.zFar + rand() * (avenue.zNear - avenue.zFar);

    // A wide swept centre. This was 4 units, which still left loose goods well
    // inside the walking line; the reference keeps its whole road clear and
    // banks everything into the gutters.
    if (Math.abs(x) < 8.5) continue;

    const name = wallGoods[Math.floor(rand() * wallGoods.length)];
    // Face the avenue, roughly, with slop.
    const yaw = (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (rand() - 0.5) * 0.9;

    // Hard minimum separation. Twelve props that clump into three piles read
    // as three messy piles; twelve that are eight metres apart read as twelve
    // deliberate placements, which is the whole difference being asked for.
    if (placed.some((q) => Math.hypot(q.x - x, q.z - z) < 7.5)) continue;

    if (placeGround(name, x, z, { yaw, scale: 0.9 + rand() * 0.45 })) wallPlaced++;
  }

  // Market stalls are big enough to be landmarks; place a few deliberately
  // rather than by rejection sampling, so they punctuate the avenue evenly.
  // Two, one per side, well apart. A stall is a landmark; four of them down a
  // sixty-metre avenue is a market, and a market is the busy read.
  for (let i = 0; i < 2; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = avenue.zNear - 11 - i * 27;
    placeGround('marketStall', side * (avenue.halfWidth - 4.4), z, {
      yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      scale: 1.0,
    });
  }

  // Scaffolding against a couple of wall bays: tall, thin, and it overlaps the
  // wall behind it, which is what stops the wall reading as a flat plane.
  // One. It exists to break the flat wall plane with something tall and thin,
  // and one does that; three is a construction site.
  for (let i = 0; i < 1; i++) {
    const side = -1;
    const z = avenue.zFar + 6 + rand() * (avenue.zNear - avenue.zFar - 12);
    placeGround('scaffold', side * (avenue.halfWidth - 2.6), z, {
      yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      scale: 0.9 + rand() * 0.3,
    });
  }

  // Poles and railings: pure thin geometry, deliberately in the mid-ground.
  // Three, not ten. Thin geometry in the mid-ground is worth having and these
  // are the cheapest source of it, but ten sets of posts along a corridor is
  // ten more silhouettes competing with the colonnade.
  for (let i = 0; i < 3; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    // Hard against the wall. These were reaching 5.7 units inboard, which put
    // thin posts right where the player walks.
    const x = side * (avenue.halfWidth - 1.8 - rand() * 1.6);
    const z = avenue.zFar + rand() * (avenue.zNear - avenue.zFar);
    placeGround(rand() < 0.55 ? 'poles' : 'railing', x, z, {
      scale: 0.9 + rand() * 0.4,
    });
  }

  // -------------------------------------------------------------------------
  // 3b. DELIBERATE COVER
  // -------------------------------------------------------------------------
  //
  // Distinct from the loose goods above, and the distinction matters.
  //
  // Debris is stuff that ended up somewhere. Cover is stuff a soldier PUT
  // somewhere, and it reads differently because it is squared to the threat
  // axis, spaced for movement between pieces, and sited where a firefight
  // would actually want it. A field of toppled masonry gives the player things
  // to trip over; a sandbag line gives them somewhere to fight from.
  //
  // Sited in staggered pairs down the avenue, never opposite each other, so
  // the player always has a piece to break toward rather than a gate to funnel
  // through. Left clear of the swept centre line so movement stays open.

  const coverKinds = ['sandbagEmplacement', 'crateStack', 'cart', 'ammoCrates'];
  const coverLane = avenue.halfWidth - 6.2;

  // Four. Cover is the one category the cull protects on its own terms - it is
  // the reason a player moves the way they do in a firefight - but four pieces
  // spread down sixty metres is already a fighting space, and every extra one
  // is another object in a frame that has been called messy twice.
  for (let i = 0; i < 4; i++) {
    // Alternate sides, and offset the two sides by half a step so a pair never
    // lines up into a chokepoint.
    const side = i % 2 === 0 ? -1 : 1;
    const z = avenue.zNear - 11 - i * 8.5 + (side > 0 ? 4.2 : 0);
    if (z < avenue.zFar + 4) continue;

    const name = coverKinds[i % coverKinds.length];
    // Squared to the avenue, with only slight slop. Cover that is visibly
    // aligned to the space reads as placed; cover at a random yaw reads as
    // dropped.
    const yaw = (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (rand() - 0.5) * 0.22;

    placeGround(name, side * (coverLane - rand() * 2.4), z, {
      yaw, scale: 0.95 + rand() * 0.25,
    });
  }

  // -------------------------------------------------------------------------
  // 4. CHAPEL FOCAL POINTS
  // -------------------------------------------------------------------------
  // A recess with nothing in it is a hole. Each alcove gets one thing worth
  // walking over to look at.

  const focal = ['statueTorso', 'offeringTable', 'canopicSet', 'brazier'];
  chapels.forEach((c, i) => {
    placeGround(focal[i % focal.length], c.x, c.z, {
      yaw: c.side > 0 ? -Math.PI / 2 : Math.PI / 2,
      scale: 1.05,
    });

    // A banner hung above the alcove mouth, so the recess reads from down the
    // avenue rather than only from in front of it. Hung BELOW the top of the
    // bay it is nailed to: this bay can be as short as 3.4 units and the banner
    // was pinned at 8.2 regardless, which put a red rectangle in clear sky with
    // no wall behind it.
    //
    // BACKING OFF, and deliberately. This is the one wall prop in the file that
    // is meant to hang across an opening rather than on a face: the alcove
    // mouth is the whole subject, and the nearest stone behind it is its own
    // back wall six and a half metres in. Measured, all four of these sit 6.6 m
    // proud of anything solid, which for a banner over a recess is the intent
    // and for a lattice panel on a wall would be the bug.
    const top = (c.h ?? avenue.height) - 2.6;
    if (top > 3.0 && rand() < 0.75) {
      placeWall('banner', c.x - c.side * 5.4, Math.min(8.2 + rand() * 1.5, top),
        c.z, -c.side, 0, { scale: 1.0 + rand() * 0.4, backing: false });
    }
  });

  // -------------------------------------------------------------------------
  // 5. THE FORECOURT
  // -------------------------------------------------------------------------
  //
  // The room at the temple front. It was outside the dressed zone because it
  // was outside the avenue, and it was outside the avenue because the flanks
  // there were open and the space ran on into the desert. Now that the flanks
  // are closed it is the END of the route and the last thing the player stands
  // in.
  //
  // Two objects and two banners. Nothing else, and deliberately nothing else:
  // the approach to the sealed doorway is the one piece of exterior
  // choreography that already works, so the job here is to give the last twenty
  // metres of it a pair of things to read the door against and then get out of
  // the way. The centre stays swept all the way to the seal.

  if (forecourt) {
    const fz = forecourt.z;
    const fw = forecourt.halfWidth;

    // One offering point per side, squared to the doorway. These are what the
    // approach reads against: an empty forecourt makes the door look like a
    // texture on a cliff rather than the end of a procession.
    for (const side of [-1, 1]) {
      placeGround(side < 0 ? 'offeringTable' : 'brazier',
        side * 8.6, fz + 1.6, {
          yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2, scale: 1.05,
        });
    }

    // A banner on the inner face of each stub, so the forecourt has something
    // thin and moving in it and the corner is not two flat stone planes.
    for (const side of [-1, 1]) {
      placeWall('banner', side * (fw - 1.4), 2.9 + rand() * 0.8, fz + 0.4,
        -side, 0, { scale: 0.9 + rand() * 0.3 });
    }
  }

  return {
    group,
    placedCount: placed.length,
    triangles: Math.round(tris),

    setFidelity(high) {
      // Thin props are the cheapest thing to drop and the most expensive to
      // rasterise per pixel of visual value, so they go first on low.
      group.traverse((o) => {
        if (o.userData?.tier === 3) o.visible = high;
      });
    },
  };
}
