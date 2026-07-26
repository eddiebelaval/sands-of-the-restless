/**
 * World-scale UV mapping.
 *
 * The problem this solves: three.js gives every BoxGeometry face UVs of 0..1
 * regardless of size, so one shared masonry texture stretches to fit whatever
 * it lands on. A 2-unit rubble chunk and a 104-unit wall both get exactly one
 * tile, and the wall ends up with bricks the size of a car.
 *
 * The naive fix is to clone the material per mesh and set `map.repeat`, but
 * that defeats material batching and multiplies draw calls.
 *
 * Instead, bake the world scale into the geometry's UV attribute. One shared
 * material, correct texel density everywhere.
 */

import * as THREE from 'three';

/**
 * Rewrite a BoxGeometry's UVs so texture density is constant in world units.
 *
 * BoxGeometry lays out its six faces in a known order: +X, -X, +Y, -Y, +Z, -Z,
 * four vertices each. Each face is mapped from the two world dimensions that
 * actually lie in its plane, which is what keeps the grain continuous around
 * a corner instead of stretching on the long faces.
 *
 * @param {THREE.BoxGeometry} geo
 * @param {number} w  box width  (x)
 * @param {number} h  box height (y)
 * @param {number} d  box depth  (z)
 * @param {number} tilesPerUnit  how many texture tiles per world unit
 */
export function boxUV(geo, w, h, d, tilesPerUnit = 0.25) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;

  const s = tilesPerUnit;

  // [uScale, vScale] per face, in BoxGeometry's face order.
  const faces = [
    [d * s, h * s],  // +X : depth  x height
    [d * s, h * s],  // -X
    [w * s, d * s],  // +Y : width  x depth
    [w * s, d * s],  // -Y
    [w * s, h * s],  // +Z : width  x height
    [w * s, h * s],  // -Z
  ];

  for (let f = 0; f < 6; f++) {
    const [su, sv] = faces[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
  }

  uv.needsUpdate = true;
  return geo;
}

/** BoxGeometry with world-scale UVs already applied. */
export function box(w, h, d, tilesPerUnit = 0.25) {
  return boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, tilesPerUnit);
}

/**
 * Rewrite a PlaneGeometry's UVs to a fixed world-unit density.
 * Used for the ground, where `map.repeat` would otherwise have to be
 * hand-tuned against the plane size every time either one changes.
 */
export function planeUV(geo, w, h, tilesPerUnit = 0.25) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;

  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * w * tilesPerUnit, uv.getY(i) * h * tilesPerUnit);
  }

  uv.needsUpdate = true;
  return geo;
}

/** PlaneGeometry with world-scale UVs already applied. */
export function plane(w, h, segs = 1, tilesPerUnit = 0.25) {
  return planeUV(new THREE.PlaneGeometry(w, h, segs, segs), w, h, tilesPerUnit);
}

/**
 * Scale a CylinderGeometry's UVs. The side wall maps circumference to u and
 * height to v, so both need scaling to keep density even.
 */
export function cylinderUV(geo, radius, height, tilesPerUnit = 0.25) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;

  const circumference = 2 * Math.PI * radius;
  const su = circumference * tilesPerUnit;
  const sv = height * tilesPerUnit;

  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }

  uv.needsUpdate = true;
  return geo;
}
