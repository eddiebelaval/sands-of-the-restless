/**
 * Chamfered geometry.
 *
 * THE single biggest reason procedural scenes read as "blocky voxel game" is
 * the perfectly sharp 90-degree edge. A real cut stone has a chamfer, and that
 * chamfer catches a thin bright line of light along every edge. Physically,
 * an infinitely sharp edge cannot exist at any scale, so the eye reads one as
 * "computer" immediately and without being told to.
 *
 * A BoxGeometry has 12 hard edges and no bevel. This module replaces it with a
 * chamfered box built as:
 *
 *     6 inset face quads   (the flats)
 *   + 12 edge quads        (the bevels that catch the light)
 *   +  8 corner triangles  (where three bevels meet)
 *
 * Geometry is non-indexed so every facet gets a flat normal. Smooth-shading
 * the bevels would defeat the point: it is the crisp shading discontinuity
 * that reads as a cut edge.
 *
 * UVs are projected per facet onto the dominant axis of its normal and scaled
 * in world units, so texel density is correct without a separate UV pass.
 */

import * as THREE from 'three';

/**
 * How wide a bevel has to be, on a member of this size, to actually read.
 *
 * WHY A CONSTANT CHAMFER CANNOT WORK
 *
 * A chamfer sells a cut edge because it holds a THIRD shading value between two
 * faces: the flat facing the sun, the flat facing away, and a narrow band at an
 * angle to both that catches a bright line. A band can only hold a value if it
 * is several pixels wide. So the useful size of a chamfer is set by how big the
 * object is on screen, and that is set by how big the object is in the world -
 * a 2 m rock is read from two metres and a 62 m pyramid course is read from
 * ninety.
 *
 * At 1440 px across a 75 degree frame one pixel subtends about 9.1e-4 radians,
 * so a bevel needs roughly `0.0018 * distance` metres to be two pixels and
 * about five times that to be a band with a value in it rather than a hairline.
 * The shipped numbers were a flat 6 cm default with an 11 cm cap in the
 * courtyard, which is five pixels on a crate at arm's length and under one on
 * the pyramid. That is the whole of "no bevel on anything so no edge in the
 * scene catches an edge highlight, which is why the stone reads as painted
 * cardboard": the bevels were being drawn, paid for in triangles, and were too
 * small to carry a highlight.
 *
 * THE RULE
 *
 * Scale with the member's longest dimension, floor it so small members keep a
 * real edge, and clamp it against the member's THINNEST dimension so a slab
 * does not turn into a rounded pillow. The thin clamp is what keeps a 2 m
 * rubble chunk reading as stone: a sixth of the thin axis is a cut arris, not a
 * fillet.
 *
 * `floor` lets a call site ask for MORE than the rule gives without being able
 * to ask for a bevel too small to see. Every explicit chamfer in the courtyard
 * predates this function and every one of them was smaller than the rule, so
 * they now act purely as documentation of intent.
 */
export const CHAMFER_RULE = {
  frac: 0.02,      // of the longest dimension
  min: 0.09,       // metres. Below this a bevel is decoration on any member.
  // Hard ceiling as a fraction of the thinnest dimension. This is the number
  // that keeps a 2 m rubble chunk a stone instead of a pillow, and it is also
  // what stops the pyramid's courses eating their own risers: at 0.22 a 4.5 m
  // course took a 0.99 m arris top and bottom and only 2.5 m of it was left
  // flat, which turns a stepped profile into a batter.
  thinFrac: 0.16,
  max: 1.1,        // metres. Nothing in this world wants a wider arris.
};

/**
 * @param {number} w
 * @param {number} h
 * @param {number} d
 * @param {number} [floor] a minimum in world units, still subject to the clamps
 */
export function chamferFor(w, h, d, floor = 0) {
  const R = CHAMFER_RULE;
  const span = Math.max(w, h, d);
  const thin = Math.min(w, h, d);
  const want = Math.max(floor, span * R.frac, R.min);
  return Math.min(want, thin * R.thinFrac, R.max);
}

/**
 * @param {number} w width  (x)
 * @param {number} h height (y)
 * @param {number} d depth  (z)
 * @param {number} chamfer  bevel size in world units. Clamped so it can never
 *                          exceed half the smallest dimension.
 * @param {number} tilesPerUnit texture tiles per world unit
 */
export function chamferedBox(w, h, d, chamfer = 0.06, tilesPerUnit = 0.25) {
  const c = Math.min(chamfer, Math.min(w, h, d) * 0.32);

  const x = w / 2, y = h / 2, z = d / 2;
  const xi = x - c, yi = y - c, zi = z - c;   // inset extents

  const pos = [];
  const nor = [];
  const uv = [];

  /**
   * Push a triangle, computing its flat normal and projecting UVs onto
   * whichever world axis the normal points along most strongly.
   */
  function tri(a, b, e) {
    // Newell normal, robust for the near-degenerate slivers a tiny chamfer
    // can produce.
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = e[0] - a[0], vy = e[1] - a[1], vz = e[2] - a[2];

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;

    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    // Dominant axis decides the UV projection plane.
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let uAxis, vAxis;
    if (ax >= ay && ax >= az)      { uAxis = 2; vAxis = 1; }   // project zy
    else if (ay >= ax && ay >= az) { uAxis = 0; vAxis = 2; }   // project xz
    else                           { uAxis = 0; vAxis = 1; }   // project xy

    for (const p of [a, b, e]) {
      pos.push(p[0], p[1], p[2]);
      nor.push(nx, ny, nz);
      uv.push(p[uAxis] * tilesPerUnit, p[vAxis] * tilesPerUnit);
    }
  }

  const quad = (a, b, e, f) => { tri(a, b, e); tri(a, e, f); };

  // -------------------------------------------------------------------------
  // the six inset flats
  // -------------------------------------------------------------------------

  // +X and -X
  //
  // Both were reversed. Counter-clockwise seen from OUTSIDE is what the
  // rasteriser culls on, and these two wound clockwise, so the +X and -X flats
  // were back faces: culled when you looked at them, and drawn at the depth of
  // the far side of the box when you did not.
  quad([x, -yi, zi], [x, -yi, -zi], [x, yi, -zi], [x, yi, zi]);
  quad([-x, -yi, -zi], [-x, -yi, zi], [-x, yi, zi], [-x, yi, -zi]);

  // +Y and -Y
  quad([-xi, y, zi], [xi, y, zi], [xi, y, -zi], [-xi, y, -zi]);
  quad([-xi, -y, -zi], [xi, -y, -zi], [xi, -y, zi], [-xi, -y, zi]);

  // +Z and -Z
  quad([-xi, -yi, z], [xi, -yi, z], [xi, yi, z], [-xi, yi, z]);
  quad([xi, -yi, -z], [-xi, -yi, -z], [-xi, yi, -z], [xi, yi, -z]);

  // -------------------------------------------------------------------------
  // the twelve edge bevels
  // -------------------------------------------------------------------------

  // Four vertical edges (running along Y), one per XZ corner.
  const vertical = [
    [ 1,  1], [ 1, -1], [-1, -1], [-1,  1],
  ];
  for (const [sx, sz] of vertical) {
    // Winding flips with the sign product so every bevel faces outward.
    // The sense was inverted: all twelve bevels wound inward, so the chamfer -
    // the whole reason this module exists, the bright line along every edge -
    // was culled and never drawn once.
    const flip = sx * sz < 0;
    const a = [sx * x,  -yi, sz * zi];
    const b = [sx * xi, -yi, sz * z ];
    const e = [sx * xi,  yi, sz * z ];
    const f = [sx * x,   yi, sz * zi];
    if (flip) quad(a, b, e, f); else quad(b, a, f, e);
  }

  // Four edges along X (top and bottom, front and back).
  for (const sy of [1, -1]) {
    for (const sz of [1, -1]) {
      const flip = sy * sz < 0;
      const a = [-xi, sy * y,  sz * zi];
      const b = [ xi, sy * y,  sz * zi];
      const e = [ xi, sy * yi, sz * z ];
      const f = [-xi, sy * yi, sz * z ];
      if (flip) quad(a, b, e, f); else quad(b, a, f, e);
    }
  }

  // Four edges along Z (top and bottom, left and right).
  for (const sy of [1, -1]) {
    for (const sx of [1, -1]) {
      const flip = sy * sx > 0;
      const a = [sx * xi, sy * y,  -zi];
      const b = [sx * xi, sy * y,   zi];
      const e = [sx * x,  sy * yi,  zi];
      const f = [sx * x,  sy * yi, -zi];
      if (flip) quad(a, b, e, f); else quad(b, a, f, e);
    }
  }

  // -------------------------------------------------------------------------
  // the eight corner triangles
  // -------------------------------------------------------------------------

  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) {
        const a = [sx * x,  sy * yi, sz * zi];
        const b = [sx * xi, sy * y,  sz * zi];
        const e = [sx * xi, sy * yi, sz * z ];

        // Winding depends on the parity of the octant.
        if (sx * sy * sz > 0) tri(a, b, e); else tri(a, e, b);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();

  return geo;
}

/**
 * Displace a geometry's vertices with smooth noise, so nothing in the scene is
 * a perfect primitive. Perfectly regular geometry is the second-biggest tell
 * after sharp edges: real ruins have settled, cracked, and eroded.
 *
 * Normals are recomputed, which is what actually sells the erosion. Skipping
 * that leaves the lighting flat and the displacement invisible.
 *
 * @param {number} amount  displacement magnitude in world units
 * @param {number} scale   noise frequency. Lower is broader, lumpier damage.
 */
export function erode(geo, amount = 0.03, scale = 1.4, seed = 1) {
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);

    // Three decorrelated sine products stand in for 3D noise. Cheap, smooth,
    // and deterministic, which matters because vertices shared between facets
    // must displace identically or the mesh splits open.
    const n1 = Math.sin(x * scale + seed) * Math.cos(z * scale * 1.3 + seed * 2);
    const n2 = Math.sin(y * scale * 1.7 + seed * 3) * Math.cos(x * scale * 0.9);
    const n3 = Math.sin(z * scale * 1.1 + seed * 5) * Math.cos(y * scale * 1.4);

    pos.setXYZ(
      i,
      x + n1 * amount,
      y + n2 * amount * 0.6,
      z + n3 * amount
    );
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * A displaced ground plane. A perfectly flat floor plane is unmistakably
 * synthetic: real desert has dune swells at every scale.
 *
 * Returns { geometry, heightAt(x, z) } so the player controller can sample the
 * same function the mesh was built from, rather than a second approximation
 * that drifts out of agreement with what is drawn.
 */
export function duneField(size, segments, tilesPerUnit, {
  amplitude = 1.35,
  seed = 7,
  plazaRadius = 46,
  plazaAmplitude = 0.28,
} = {}) {
  /**
   * One height function, used both to build the mesh and to answer queries, so
   * the collision floor can never drift out of agreement with what is drawn.
   *
   * Dunes are damped inside the plaza radius. Full-height dunes under the
   * architecture would leave buildings floating or half-buried, and a player
   * walking a rolling floor between colonnades feels seasick rather than
   * atmospheric. Outside the walls they rise to full height, where they do the
   * actual work of making the horizon read as desert.
   */
  const heightAt = (x, z) => {
    const a = Math.sin(x * 0.021 + seed) * Math.cos(z * 0.017 - seed);
    const b = Math.sin(x * 0.058 - z * 0.041 + seed * 2) * 0.45;
    const c = Math.sin(z * 0.094 + x * 0.033) * 0.18;

    const r = Math.hypot(x, z);
    const t = Math.min(1, Math.max(0, (r - plazaRadius) / 40));
    const amp = plazaAmplitude + (amplitude - plazaAmplitude) * (t * t * (3 - 2 * t));

    return (a + b + c) * amp;
  };

  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;

  for (let i = 0; i < pos.count; i++) {
    // The plane is built in XY and rotated into place by the caller, so its
    // local y is world z.
    const x = pos.getX(i);
    const z = -pos.getY(i);
    pos.setZ(i, heightAt(x, z));

    uv.setXY(i, uv.getX(i) * size * tilesPerUnit, uv.getY(i) * size * tilesPerUnit);
  }

  pos.needsUpdate = true;
  uv.needsUpdate = true;
  geo.computeVertexNormals();

  return { geometry: geo, heightAt };
}
