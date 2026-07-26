/**
 * Asset loading: HDRI environment and CC0 PBR material sets.
 *
 * This is the hybrid line. Real scanned materials and a real environment map
 * replace the two things procedural generation was doing badly:
 *
 *   1. Normal maps derived by running a Sobel filter over our own albedo. That
 *      infers SHAPE from COLOUR, which is simply wrong wherever the two
 *      disagree: a dark stain became a dent, a light patch became a bump.
 *      A scanned normal map is baked from real geometry.
 *
 *   2. Lighting metals. A metal is a mirror, and metalness 0.9 with nothing in
 *      the scene to reflect renders near-black. That is why the gunmetal
 *      viewmodel read as a brick and why the weapons needed a hand-built fake
 *      studio to be visible at all. One HDRI fixes every metal at once.
 *
 * What stays procedural: layout, scatter, geometry variation, and the
 * world-space weathering injection. Those are the things procedural is good at,
 * and the weathering in particular is what stops a 1K tiled scan from reading
 * as a 1K tiled scan.
 *
 * All assets are CC0 (Poly Haven, ambientCG). No attribution required.
 */

import * as THREE from 'three';
// HDRLoader, not RGBELoader: as of r180 RGBELoader is a 268-byte shim that
// extends this and logs a deprecation warning on construction.
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// 1k, deliberately. PMREMGenerator's own docs state the ideal input is
// 1024x512 because that matches its 256x256 cubemap output; a 2k source is
// four times the download for no extra prefiltered detail. sky.js draws the
// visible background, so this file is a pure light probe.
const HDRI_URL = './assets/hdri/qwantani_noon_puresky_1k.hdr';
const MATERIAL_ROOT = './assets/materials-1k/';

/**
 * Which scanned material backs each surface role.
 *
 * `tiles` is how many texture repeats per world unit, and it has to be
 * authored per material because a scan of brickwork and a scan of sand have
 * completely different real-world scales baked into them.
 */
export const MATERIAL_SETS = {
  sand:      { dir: 'ground054',   maps: ['color', 'normalgl', 'roughness', 'ambientocclusion'] },
  limestone: { dir: 'bricks083',   maps: ['color', 'normalgl', 'roughness', 'ambientocclusion'] },
  carved:    { dir: 'tiles139',    maps: ['color', 'normalgl', 'roughness'] },
  granite:   { dir: 'granite003a', maps: ['color', 'normalgl', 'roughness'] },
  rock:      { dir: 'rock023',     maps: ['color', 'normalgl', 'roughness', 'ambientocclusion'] },
};

/** Which maps are colour data and which are raw linear data. Getting this
 *  wrong is subtle and ruinous: an sRGB-decoded roughness map makes every
 *  surface too glossy, and a linear albedo makes the whole scene muddy. */
const COLOR_SPACE = {
  color: THREE.SRGBColorSpace,
  normalgl: THREE.NoColorSpace,
  roughness: THREE.NoColorSpace,
  ambientocclusion: THREE.NoColorSpace,
  displacement: THREE.NoColorSpace,
};

/** Map file stem to the MeshStandardMaterial property it feeds. */
const SLOT = {
  color: 'map',
  normalgl: 'normalMap',
  roughness: 'roughnessMap',
  ambientocclusion: 'aoMap',
  displacement: 'displacementMap',
};

/**
 * Load everything. Returns { env, sets, failed }.
 *
 * Never rejects. A missing asset degrades to the procedural path rather than
 * taking the whole game down, because a texture 404 on someone else's machine
 * should not be a black screen.
 */
export async function loadAssets(renderer, onProgress = () => {}) {
  const failed = [];

  // Total units of work, for an honest progress bar rather than a fake one.
  const jobs = 1 + Object.values(MATERIAL_SETS).reduce((n, s) => n + s.maps.length, 0);
  let done = 0;
  const tick = (label) => { done++; onProgress(done / jobs, label); };

  // --- environment ---------------------------------------------------------
  let env = null;
  try {
    const hdr = await new HDRLoader().loadAsync(HDRI_URL);

    // PMREM prefilters the equirectangular HDR into the mip chain that a PBR
    // shader actually samples for roughness-dependent reflections. Handing the
    // raw texture to scene.environment gives mirror-sharp reflections at every
    // roughness value, which looks worse than no environment at all.
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    env = pmrem.fromEquirectangular(hdr).texture;

    hdr.dispose();
    pmrem.dispose();
  } catch (e) {
    failed.push({ asset: 'hdri', error: String(e) });
  }
  tick('environment');

  // --- material sets -------------------------------------------------------
  const loader = new THREE.TextureLoader();
  const sets = {};

  await Promise.all(Object.entries(MATERIAL_SETS).map(async ([role, spec]) => {
    const maps = {};

    await Promise.all(spec.maps.map(async (stem) => {
      const url = `${MATERIAL_ROOT}${spec.dir}/${stem}.jpg`;
      try {
        const tex = await loader.loadAsync(url);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = COLOR_SPACE[stem] ?? THREE.NoColorSpace;
        tex.anisotropy = 8;
        // Texel density is baked into each geometry's UVs by world/uv.js, so
        // repeat stays at 1 and one material tiles correctly at any scale.
        tex.repeat.set(1, 1);
        maps[SLOT[stem]] = tex;
      } catch (e) {
        failed.push({ asset: `${spec.dir}/${stem}`, error: String(e) });
      }
      tick(`${spec.dir}/${stem}`);
    }));

    // A set is only usable if it at least has an albedo.
    if (maps.map) sets[role] = maps;
  }));

  return { env, sets, failed };
}

/**
 * Fold a loaded map set into an existing material.
 *
 * Done in place so every mesh already referencing the material picks up the
 * upgrade without being rebuilt, and so the procedural weathering injection
 * already installed on it survives.
 */
export function applyMaps(material, maps, { normalScale = 1, aoIntensity = 1 } = {}) {
  if (!material || !maps) return material;

  // Dispose the procedural textures being replaced, or they leak on the GPU.
  for (const slot of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
    if (maps[slot] && material[slot] && material[slot] !== maps[slot]) {
      material[slot].dispose();
    }
  }

  if (maps.map) material.map = maps.map;
  if (maps.normalMap) {
    material.normalMap = maps.normalMap;
    material.normalScale.setScalar(normalScale);
  }
  if (maps.roughnessMap) {
    material.roughnessMap = maps.roughnessMap;
    // The scan carries the roughness detail now, so the scalar must be 1 or it
    // multiplies the map down and everything turns to chrome.
    material.roughness = 1.0;
  }
  if (maps.aoMap) {
    material.aoMap = maps.aoMap;
    material.aoMapIntensity = aoIntensity;
  }

  material.needsUpdate = true;
  return material;
}
