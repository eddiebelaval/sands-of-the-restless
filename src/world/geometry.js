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
