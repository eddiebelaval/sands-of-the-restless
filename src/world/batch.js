/**
 * Static-geometry batching: turning a thousand draw calls into a few dozen.
 *
 * WHY THIS FILE EXISTS
 *
 * The courtyard was built as 995 separate meshes, and it was profiled on a
 * quiet machine as costing 4.6 ms a frame INSIDE `composer.render` against a
 * total measured JS budget of 4.8. Every other system in the game - the wave
 * director, the viewmodel, the minimap, impacts, the world tick - added up to
 * 0.09 ms between them. The game logic is free; the frame was being spent
 * issuing draw calls, and the shadow pass issues them a second time.
 *
 * It is worth being precise about what the cost is NOT, because four passes of
 * tuning went at the wrong thing first. It is not the post chain: removing
 * GTAO, bloom and SMAA individually each moved the frame by 0.0-0.1 ms.
 * It is not shading, and it is not fill - dropping to LOW fidelity moved it
 * 0.4 ms. It is the CPU walking a scene graph, testing a thousand bounding
 * spheres, sorting a thousand render items, and pushing a thousand uniform
 * blocks and draw commands at the driver. At a few microseconds each that is
 * the whole 4.6 ms, and none of it buys a single pixel.
 *
 * THE FIX, AND WHY IT IS SAFE HERE IN A WAY IT USUALLY IS NOT
 *
 * Merging geometry normally costs you per-object variation, which is why
 * `temple.js` had to bake its per-stone colour into a VERTEX COLOUR attribute
 * before it could collapse 16,808 triangles of pyramid into one mesh.
 *
 * The courtyard needs none of that, and the reason is a property of how it was
 * already written. Every wall, pylon, chapel, coping and rubble chunk points at
 * the SAME shared material object out of the registry - there is not one
 * per-mesh tint anywhere in the file. What makes two neighbouring walls differ
 * is `weathering.js`, and that is injected into the material as a function of
 * WORLD POSITION, evaluated in the fragment shader. Merging bakes each mesh's
 * world matrix into its vertices and leaves the mesh at the origin, so every
 * vertex arrives at the shader at exactly the world position it had before and
 * the weathering term is bit-identical. UVs are per-vertex data and are not
 * touched by a matrix, and this project's UVs are already world-scaled at
 * construction, so they survive untouched too.
 *
 * So for this scene a merge is an identity transform on the image. That is a
 * claim that has to be proved rather than asserted, and it was: all seven
 * capture poses before and after sit inside the film grain's own noise floor.
 *
 * WHAT IS DELIBERATELY NOT BATCHED
 *
 *   - anything moving. The buy-door's slab and its sun-disc are driven down
 *     into the sand by `doors.js`, which finds them as the direct mesh children
 *     of the portal group standing proud of the jamb line. `temple.js` tags all
 *     twelve `noBatch`.
 *   - anything with its own light, or an animated material. The five ceremonial
 *     braziers flicker a cloned emissive and carry a PointLight; the whole
 *     group is tagged.
 *   - anything a raycast must identify individually. In the courtyard that set
 *     is exactly the door parts above; `world.hitTargets` otherwise wants a hit
 *     against scenery and does not care which piece of scenery it was.
 *   - anything already alone. A batch of one is a rename, not an optimisation,
 *     and it would strip the flags (`frustumCulled`, vertex colours) that the
 *     one-off meshes carry for a reason.
 *   - materials with `vertexColors`. Their geometry carries a colour attribute
 *     this merge does not preserve, and the only such mesh in the world - the
 *     temple mass - is already a single draw.
 *
 * FRUSTUM CULLING, WHICH GETS WORSE
 *
 * One mesh spanning the whole map is never off screen, so a global merge trades
 * 460 draws for one that can never be culled. At this scale that is still a
 * large win, but it is free to do better: batches are keyed by a coarse spatial
 * cell as well as by material, so the perimeter wall behind the player is still
 * dropped by the bounding-sphere test while the avenue in front is drawn. The
 * cell is deliberately large - the point is a handful of regional batches, not
 * a grid fine enough to give the draw calls back.
 *
 * Members whose own bounding sphere is wider than a cell cannot be localised by
 * one, so they go to a `span` bucket per material instead of inflating a cell
 * that other geometry has to share. The perimeter's two 112-metre footing slabs
 * per run are the whole of that set.
 *
 * MERGING BY HAND RATHER THAN WITH BufferGeometryUtils
 *
 * Same call `temple.js` made, for the same two reasons. `three/addons/` resolves
 * through the import map to unpkg, so importing the addon puts a second CDN
 * fetch on the boot path of a build that has no bundler and ships from GitHub
 * Pages. And `mergeGeometries` requires every input to already agree on its
 * attribute set, which this scene's inputs do not: chamfered boxes are
 * non-indexed with position/normal/uv, cylinders and prop geometry are indexed,
 * and the palm frond has no UVs at all. The normalisation that has to happen
 * first is most of the work, and once it is written the concatenation is twenty
 * lines.
 */

import * as THREE from 'three';

/** The only attributes a batch carries. Everything else is dropped. */
const KEEP = ['position', 'normal', 'uv'];

/**
 * How wide a spatial cell is, in metres.
 *
 * Chosen against the level rather than as a round number. The avenue is 30
 * metres across its walls and runs 69 metres; the perimeter stands at +/-52.
 * At 28 the avenue splits into roughly three bands down its length and each
 * perimeter run separates from the avenue and from the run opposite, which is
 * the whole of what culling can usefully distinguish here. Halving it would
 * quadruple the batch count to buy back cull cases that are already covered.
 */
const CELL = 28;

/**
 * Lift one mesh's geometry out of its own frame and into `home`'s.
 *
 * NOT into world space, and the difference is a bug waiting to happen. The
 * batch is re-parented under the nearest named ancestor so the scene graph
 * keeps meaning what it says, and two of those ancestors carry a transform -
 * `portal` stands at z = -30.2 and `gate-structure` hangs under it. World-space
 * vertices added to a node with a translation on it get that translation
 * applied a second time, which would have posted the entire gate thirty metres
 * further into the pyramid. So the matrix baked in is `home^-1 * mesh`, which
 * is the identity transform on the mesh's final world position for every
 * possible choice of home.
 *
 * `applyMatrix4` transforms the normals through the proper normal matrix, so
 * this is correct for the rotations the courtyard uses; there is no negative
 * scale anywhere in the scene for it to get wrong.
 *
 * Everything is flattened to non-indexed. That is not laziness: it makes the
 * concatenation a straight `set()` per attribute with no index rebasing, it is
 * what the chamfered boxes (which are 90 per cent of this by count) already
 * are, and the cost is bounded - the whole courtyard is about 120,000 vertices,
 * so even in the worst case the expansion is single-digit megabytes. Expanding
 * a smooth-shaded cylinder duplicates its vertices but not its normals'
 * values, so nothing about the shading changes.
 */
const _rel = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

function bakeInto(mesh, home) {
  const src = mesh.geometry;
  const geo = src.index ? src.toNonIndexed() : src.clone();

  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) {
    // The palm frond is built as an explicit BufferGeometry with no UVs, and
    // its material carries no map, so zeros are exactly as correct as anything
    // else and they let it share a buffer layout with everything that does.
    geo.setAttribute('uv',
      new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  }
  for (const name of Object.keys(geo.attributes)) {
    if (!KEEP.includes(name)) geo.deleteAttribute(name);
  }

  mesh.updateWorldMatrix(true, false);
  home.updateWorldMatrix(true, false);
  _rel.copy(_inv.copy(home.matrixWorld).invert()).multiply(mesh.matrixWorld);
  geo.applyMatrix4(_rel);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Concatenate geometries that have been normalised to position/normal/uv.
 *
 * The inputs are disposed as they are consumed: they are throwaway world-space
 * copies, and holding a second full set of the scene's vertex data alive until
 * the next GC is a real cost on a page that also just generated sixty textures.
 */
function concat(parts) {
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;

  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);

  let o3 = 0, o2 = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, c * 3), o3);
    nor.set(g.attributes.normal.array.subarray(0, c * 3), o3);
    uv.set(g.attributes.uv.array.subarray(0, c * 2), o2);
    o3 += c * 3;
    o2 += c * 2;
    g.dispose();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/**
 * The nearest ancestor that somebody has named, or the root.
 *
 * Batches are re-parented here rather than dumped at the root, and the same
 * node is part of the batch key so a batch can never span two of them. Named
 * groups in this scene are contracts, not decoration: `portal` is what doors.js
 * reads the door out of, `dressing` is what `setFidelity` traverses to drop
 * tier-3 props, `far-skyline` is the backdrop. A merge that quietly lifted
 * thirty props out of `dressing` and parked them at the courtyard root would
 * leave every one of those traversals looking at a group that no longer
 * contains what it is responsible for - and it would do it silently, because
 * the frame would look exactly the same.
 */
function namedAncestor(o, root) {
  for (let n = o.parent; n && n !== root; n = n.parent) {
    if (n.name) return n;
  }
  return root;
}

/**
 * Whether a mesh may be folded into a batch.
 *
 * Every clause is something that would have broken silently. Note what is NOT
 * here: `castShadow`, `receiveShadow`, `renderOrder` and `noHit` are part of
 * the batch KEY instead, because the merged mesh can carry each of them - two
 * walls that differ only in whether they cast can both be batched, just not
 * with each other.
 */
function eligible(o) {
  if (!o.isMesh) return false;
  if (o.userData && o.userData.noBatch) return false;
  if (Array.isArray(o.material)) return false;         // needs geometry groups
  if (!o.material || !o.geometry) return false;
  if (o.material.vertexColors) return false;           // colour attr not carried
  if (o.isInstancedMesh || o.isSkinnedMesh) return false;
  if (o.frustumCulled === false) return false;         // opted out for a reason
  if (o.visible === false) return false;               // hidden by a system
  if (!o.geometry.attributes || !o.geometry.attributes.position) return false;
  return true;
}

/**
 * Merge the static geometry under `root` in place.
 *
 * Runs as a POST-PASS over a finished scene graph rather than as something the
 * construction code calls per object, and that is the single most important
 * decision in this file. This project has already been burned once by a change
 * that removed a construction loop and silently stole 33 draws from a shared
 * PRNG stream, which moved the ruined bays and the architraves down a finished
 * avenue. A pass that runs after every random number has been drawn cannot do
 * that: it reads the graph, it does not build it.
 *
 * @param {THREE.Object3D} root
 * @param {object}  opts
 * @param {number}  opts.cell      spatial cell width in metres
 * @param {number}  opts.minBatch  fewest meshes worth merging
 * @returns {{ batches:number, merged:number, removed:number, ms:number,
 *             vertices:number, bytes:number }}
 */
export function batchStatics(root, { cell = CELL, minBatch = 2 } = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // Collect first, mutate after. Editing a graph mid-traverse skips siblings.
  const found = [];
  (function walk(o) {
    // Stop descending into a tagged subtree, so tagging a brazier group covers
    // its stem, bowl and coals without tagging each of them.
    if (o.userData && o.userData.noBatch && o !== root) return;
    if (o.isMesh) {
      if (eligible(o)) found.push(o);
      return;                       // meshes do not carry batchable children here
    }
    for (const c of o.children.slice()) walk(c);
  })(root);

  /** key -> { mat, cast, receive, noHit, geos:[], meshes:[] } */
  const groups = new Map();

  const _c = new THREE.Vector3();

  for (const mesh of found) {
    const home = namedAncestor(mesh, root);
    const geo = bakeInto(mesh, home);
    const s = geo.boundingSphere;

    // The cell is a WORLD cell, so that two batches under different parents
    // still partition space the same way. The baked sphere is in home's frame,
    // so it goes back out through home to be binned.
    let region = 'span';
    if (s && s.radius <= cell) {
      _c.copy(s.center).applyMatrix4(home.matrixWorld);
      // A member wider than a cell cannot be localised by one. Bucketing it
      // with its neighbours would inflate their shared bounding sphere and cost
      // the cull for all of them, so oversized members get a bucket of their
      // own - in this scene that is the perimeter's 112-metre footing slabs.
      region = `${Math.floor(_c.x / cell)}.${Math.floor(_c.z / cell)}`;
    }

    const noHit = !!(mesh.userData && mesh.userData.noHit);
    const key = [
      mesh.material.uuid,
      mesh.castShadow ? 1 : 0,
      mesh.receiveShadow ? 1 : 0,
      noHit ? 1 : 0,
      mesh.renderOrder,
      home.uuid,
      region,
    ].join('|');

    let g = groups.get(key);
    if (!g) {
      g = { mat: mesh.material, cast: mesh.castShadow, receive: mesh.receiveShadow,
        noHit, order: mesh.renderOrder, home, region, geos: [], meshes: [] };
      groups.set(key, g);
    }
    g.geos.push(geo);
    g.meshes.push(mesh);
  }

  let batches = 0, merged = 0, vertices = 0, bytes = 0;

  for (const g of groups.values()) {
    if (g.meshes.length < minBatch) {
      // Left where it was. Throw away the world-space copy we speculatively
      // baked; the original mesh is untouched and still owns its geometry.
      for (const geo of g.geos) geo.dispose();
      continue;
    }

    const geo = concat(g.geos);
    const m = new THREE.Mesh(geo, g.mat);
    m.name = `batch:${g.region}`;
    m.castShadow = g.cast;
    m.receiveShadow = g.receive;
    m.renderOrder = g.order;
    // The batch stands in for meshes that were already in world space once the
    // transform was baked, so it sits at the origin with an identity matrix and
    // never needs updating again.
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    if (g.noHit) m.userData.noHit = true;
    m.userData.batched = g.meshes.length;

    g.home.add(m);

    for (const mesh of g.meshes) {
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.geometry.dispose();
    }

    batches++;
    merged += g.meshes.length;
    const n = geo.attributes.position.count;
    vertices += n;
    bytes += n * 8 * 4;              // 3 position + 3 normal + 2 uv, float32
  }

  const removed = prune(root);

  return {
    batches,
    merged,
    removed,
    vertices,
    bytes,
    ms: +((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(1),
  };
}

/**
 * Drop the empty anonymous groups the merge leaves behind.
 *
 * A prop that was three meshes is now three holes in a Group nobody will ever
 * look at again, and `updateMatrixWorld` walks every one of them every frame.
 * Only groups that are unnamed, childless, and carrying no userData go: a named
 * group is part of somebody's contract (`portal`, `dressing`, `far-skyline`)
 * and a group with userData on it is being tracked by the system that made it.
 * Repeated until stable, because emptying a group can empty its parent.
 */
function prune(root) {
  let removed = 0;
  for (let pass = 0; pass < 8; pass++) {
    const dead = [];
    root.traverse((o) => {
      if (o === root) return;
      if (o.type !== 'Group' && o.type !== 'Object3D') return;
      if (o.name) return;
      if (o.children.length) return;
      if (o.userData && Object.keys(o.userData).length) return;
      dead.push(o);
    });
    if (!dead.length) break;
    for (const o of dead) o.parent && o.parent.remove(o);
    removed += dead.length;
  }
  return removed;
}
