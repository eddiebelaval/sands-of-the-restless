/**
 * Bodies, not boxes: the geometry primitives a wrapped corpse is built from.
 *
 * WHY THIS LIVES HERE AND NOT IN world/geometry.js
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * The first is that a character needs a shape the world does not: a TAPERED
 * member. Architecture is made of prisms - a course, a lintel, a drum - and a
 * prism is the right answer for all of them. A body is made of nothing else.
 * A thigh is thick at the hip and thin at the knee, a forearm narrows to a
 * wrist, and a torso is a wedge that is wide at the shoulders and narrow at the
 * waist. That single property is most of what separates a humanoid silhouette
 * from a mannequin's, and it is unavailable from a box.
 *
 * The second is DRAW CALLS. Twenty-four actors is the live cap, and at nineteen
 * meshes each that is 456 draw calls before the world has drawn a single stone.
 * Triangles are close to free here and draw calls are not, so this module is
 * built around an accumulator rather than a factory: you push as many members as
 * you like into one `parts()` and get ONE BufferGeometry out. Everything that
 * shares a rig group and a material collapses into a single mesh, which is how
 * this rebuild adds hands, feet, a neck, deltoids and tapered limbs and comes
 * out with FEWER draw calls than the box-man it replaces.
 *
 * The bevel is reimplemented here rather than imported. It is thirty lines, and
 * owning it means a change to the world's chamfer rule - which is tuned for a
 * forty-metre pyramid step - can never silently reshape a fourteen-centimetre
 * forearm.
 */

import * as THREE from 'three';

/**
 * How wide a bevel should be on a member of a given thickness.
 *
 * The world's rule scales with the LONGEST dimension and floors at 9 cm,
 * because it is sizing an arris on a stone course read from ninety metres. On a
 * limb that floor is the whole member. Here the bevel scales with the THINNEST
 * dimension and caps at 3.5 cm, which at the seven-to-twenty metres an enemy is
 * actually read from is two to four pixels: enough to hold a highlight, not
 * enough to turn an arm into a lozenge.
 */
export function limbChamfer(w, h, d) {
  const thin = Math.min(w, h, d);
  return Math.min(Math.max(thin * 0.26, 0.010), 0.035, thin * 0.32);
}

/**
 * An accumulator that welds many members into one geometry.
 *
 * Every member is generated in its own local frame, tapered, rotated,
 * translated, and appended to shared arrays. Normals are recomputed per
 * TRIANGLE from the final vertex positions, which keeps the flat shading that
 * makes a bevel read as a cut edge, and keeps it correct through the rotation.
 *
 * UVs are projected from the POST-transform position onto the dominant axis of
 * the post-transform normal. That is what makes a wrap line continue across a
 * shin and its foot instead of restarting at every member, and it is why the
 * bandage rings on a vertical limb come out horizontal without a UV pass: on
 * any side face the dominant axis is horizontal, so the texture's V runs with
 * world height.
 */
export function parts(tilesPerUnit = 2.6) {
  const pos = [];
  const nor = [];
  const uv = [];

  const _v = new THREE.Vector3();
  const _e = new THREE.Euler();
  const _m = new THREE.Matrix4();

  function emit(tri3, uvOffU, uvOffV) {
    const [a, b, c] = tri3;

    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return;           // a taper can collapse a bevel sliver
    nx /= len; ny /= len; nz /= len;

    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let uAxis, vAxis;
    if (ax >= ay && ax >= az)      { uAxis = 2; vAxis = 1; }
    else if (ay >= ax && ay >= az) { uAxis = 0; vAxis = 2; }
    else                           { uAxis = 0; vAxis = 1; }

    for (const p of tri3) {
      pos.push(p[0], p[1], p[2]);
      nor.push(nx, ny, nz);
      uv.push(p[uAxis] * tilesPerUnit + uvOffU, p[vAxis] * tilesPerUnit + uvOffV);
    }
  }

  const api = {
    /**
     * One member.
     *
     * @param {number} w  width at the widest cross-section
     * @param {number} h  height along the member's own +Y
     * @param {number} d  depth at the widest cross-section
     * @param {object} o
     *   x,y,z      translation, applied last
     *   rx,ry,rz   rotation, XYZ order, applied before the translation
     *   top        cross-section scale at +h/2, default 1
     *   bottom     cross-section scale at -h/2, default 1
     *   depthTop   an independent depth scale at +h/2, so a chest can taper
     *              in width and stay deep
     *   depthBottom same at -h/2
     *   chamfer    override; otherwise limbChamfer()
     *   u, v       UV offset in tiles, so two members cut from the same shape
     *              do not wear the identical patch of linen
     */
    box(w, h, d, o = {}) {
      const c = o.chamfer ?? limbChamfer(w, h, d);
      const cc = Math.min(c, Math.min(w, h, d) * 0.32);

      const x = w / 2, y = h / 2, z = d / 2;
      const xi = x - cc, yi = y - cc, zi = z - cc;

      const top = o.top ?? 1, bottom = o.bottom ?? 1;
      const dTop = o.depthTop ?? top, dBottom = o.depthBottom ?? bottom;

      const hasRot = o.rx || o.ry || o.rz;
      if (hasRot) {
        _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ');
        _m.makeRotationFromEuler(_e);
      }

      const tx = o.x || 0, ty = o.y || 0, tz = o.z || 0;
      const u0 = o.u || 0, v0 = o.v || 0;

      /** local -> tapered -> rotated -> translated */
      const P = (px, py, pz) => {
        const t = h > 1e-9 ? (py + y) / h : 0.5;         // 0 at the base, 1 at the top
        const sw = bottom + (top - bottom) * t;
        const sd = dBottom + (dTop - dBottom) * t;
        _v.set(px * sw, py, pz * sd);
        if (hasRot) _v.applyMatrix4(_m);
        return [_v.x + tx, _v.y + ty, _v.z + tz];
      };

      const quad = (a, b, e, f) => {
        emit([P(...a), P(...b), P(...e)], u0, v0);
        emit([P(...a), P(...e), P(...f)], u0, v0);
      };
      const tri = (a, b, e) => emit([P(...a), P(...b), P(...e)], u0, v0);

      // --- the six inset flats, wound counter-clockwise seen from outside ----
      quad([x, -yi, zi], [x, -yi, -zi], [x, yi, -zi], [x, yi, zi]);
      quad([-x, -yi, -zi], [-x, -yi, zi], [-x, yi, zi], [-x, yi, -zi]);
      quad([-xi, y, zi], [xi, y, zi], [xi, y, -zi], [-xi, y, -zi]);
      quad([-xi, -y, -zi], [xi, -y, -zi], [xi, -y, zi], [-xi, -y, zi]);
      quad([-xi, -yi, z], [xi, -yi, z], [xi, yi, z], [-xi, yi, z]);
      quad([xi, -yi, -z], [-xi, -yi, -z], [-xi, yi, -z], [xi, yi, -z]);

      // --- twelve edge bevels -----------------------------------------------
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
        const flip = sx * sz < 0;
        const a = [sx * x, -yi, sz * zi];
        const b = [sx * xi, -yi, sz * z];
        const e = [sx * xi, yi, sz * z];
        const f = [sx * x, yi, sz * zi];
        if (flip) quad(a, b, e, f); else quad(b, a, f, e);
      }
      for (const sy of [1, -1]) for (const sz of [1, -1]) {
        const flip = sy * sz < 0;
        const a = [-xi, sy * y, sz * zi];
        const b = [xi, sy * y, sz * zi];
        const e = [xi, sy * yi, sz * z];
        const f = [-xi, sy * yi, sz * z];
        if (flip) quad(a, b, e, f); else quad(b, a, f, e);
      }
      for (const sy of [1, -1]) for (const sx of [1, -1]) {
        const flip = sy * sx > 0;
        const a = [sx * xi, sy * y, -zi];
        const b = [sx * xi, sy * y, zi];
        const e = [sx * x, sy * yi, zi];
        const f = [sx * x, sy * yi, -zi];
        if (flip) quad(a, b, e, f); else quad(b, a, f, e);
      }

      // --- eight corner triangles -------------------------------------------
      for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
        const a = [sx * x, sy * yi, sz * zi];
        const b = [sx * xi, sy * y, sz * zi];
        const e = [sx * xi, sy * yi, sz * z];
        if (sx * sy * sz > 0) tri(a, b, e); else tri(a, e, b);
      }

      return api;
    },

    /** How many members have been pushed, in triangles. */
    get triangles() { return pos.length / 9; },
    get empty() { return pos.length === 0; },

    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeBoundingSphere();
      return g;
    },
  };

  return api;
}

/**
 * A torn wrap.
 *
 * Unchanged in spirit from the strip this replaces: a flat quad hanging off a
 * box-man is another box-man edge, so the strip tapers as it falls, its hem is
 * torn at three lengths, and it curls out of its own plane so it still reads
 * from the side rather than vanishing edge-on.
 *
 * `cut` seeds the tear, so a shape is stable across a run and shareable between
 * every instance that asks for the same one.
 */
export function tornStrip(w, h, cut = 0, segments = 5, tilesPerUnit = 2.6) {
  const g = new THREE.PlaneGeometry(w, h, 2, segments);

  let seed = (cut + 1) * 9301 + 49297;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const pos = g.attributes.position;
  const uv = g.attributes.uv;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const t = (h / 2 - y) / h;                   // 0 at the top, 1 at the hem

    pos.setX(i, x * (1 - t * (0.30 + rnd() * 0.34)));
    if (t > 0.66) pos.setY(i, y + (rnd() - 0.55) * h * 0.34);
    pos.setZ(i, (rnd() - 0.5) * w * 0.6 * t);    // the curl, growing downward
  }

  // Texel density in the same units as everything else, so a hanging wrap wears
  // the same weave as the limb it came off.
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * w * tilesPerUnit, uv.getY(i) * h * tilesPerUnit);
  }

  pos.needsUpdate = true;
  uv.needsUpdate = true;
  g.computeVertexNormals();
  // Built in XY around its centre; the anchor swings from the top, so shift it
  // down once here rather than on every instance.
  g.translate(0, -h / 2, 0);
  g.computeBoundingSphere();
  return g;
}
