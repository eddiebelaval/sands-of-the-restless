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
 */
export function dressAvenue(parent, {
  heightAt = () => 0,
  colliders = [],
  avenue,
  bay = 9,
  chapels = [],
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

  /** Mount a wall prop flat against a face. `normal` points away from the wall. */
  const placeWall = (name, x, y, z, normalX, normalZ, { scale = 1 } = {}) => {
    if (!PROPS[name]) return false;

    const built = PROPS[name](rand, { scale });
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

  const spanZ = [];
  for (let z = avenue.zNear - bay * 0.5; z > avenue.zFar + bay; z -= bay * 0.85) {
    spanZ.push(z);
  }

  for (let i = 0; i < spanZ.length; i++) {
    const z = spanZ[i] + (rand() - 0.5) * 1.6;
    const y = spanTop - rand() * 1.4;

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

      const x = side * (avenue.halfWidth - 1.6);
      const y = spanTop - 1.8 - rand() * 1.2;

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
      if (rand() > 0.55) continue;

      const z = avenue.zNear - b * bay - bay / 2 + (rand() - 0.5) * 2;
      if (z < avenue.zFar) continue;

      const name = wallProps[Math.floor(rand() * wallProps.length)];
      const x = side * (avenue.halfWidth - 1.35);
      const y = 3.2 + rand() * 4.5;

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

  let attempts = 0;
  let wallPlaced = 0;
  while (wallPlaced < 40 && attempts < 900) {
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

    if (placeGround(name, x, z, { yaw, scale: 0.85 + rand() * 0.45 })) wallPlaced++;
  }

  // Market stalls are big enough to be landmarks; place a few deliberately
  // rather than by rejection sampling, so they punctuate the avenue evenly.
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = avenue.zNear - 8 - i * 12;
    placeGround('marketStall', side * (avenue.halfWidth - 4.4), z, {
      yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      scale: 1.0,
    });
  }

  // Scaffolding against a couple of wall bays: tall, thin, and it overlaps the
  // wall behind it, which is what stops the wall reading as a flat plane.
  for (let i = 0; i < 3; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const z = avenue.zFar + 6 + rand() * (avenue.zNear - avenue.zFar - 12);
    placeGround('scaffold', side * (avenue.halfWidth - 2.6), z, {
      yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      scale: 0.9 + rand() * 0.3,
    });
  }

  // Poles and railings: pure thin geometry, deliberately in the mid-ground.
  for (let i = 0; i < 10; i++) {
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

  for (let i = 0; i < 6; i++) {
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
    // avenue rather than only from in front of it.
    if (rand() < 0.75) {
      placeWall('banner', c.x - c.side * 5.4, 8.2 + rand() * 1.5, c.z,
        -c.side, 0, { scale: 1.0 + rand() * 0.4 });
    }
  });

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
