/**
 * PBR material registry.
 *
 * One place that owns every material in the game, so tuning the look is a
 * single-file operation and nothing allocates a duplicate MeshStandardMaterial
 * inside a hot path.
 */

import * as THREE from 'three';
import { buildTextures } from './textures.js';
import { weather } from './weathering.js';
import { applyMaps } from './assets.js';

let cache = null;

export function buildMaterials() {
  if (cache) return cache;
  const tex = buildTextures();

  const m = {
    // --- ground and structure -------------------------------------------
    sand: new THREE.MeshStandardMaterial({
      ...tex.sand,
      // Warm, slightly desaturated. Pure white multiplied the texture straight
      // through and left the ground reading as bare albedo.
      color: 0xf2e0bd,
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(0.7, 0.7),
    }),

    limestone: new THREE.MeshStandardMaterial({
      ...tex.block,
      // Pale, slightly cool limestone. Kept distinct in hue from the warm sand
      // so wall and ground never merge into one tone at distance.
      color: 0xded3bb,
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(1.1, 1.1),
    }),

    carved: new THREE.MeshStandardMaterial({
      ...tex.carved,
      // Warmer and slightly pinker than plain limestone: the dressed stone of
      // the facade should read as a different quarry from the bulk masonry.
      color: 0xdcc4a2,
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(1.4, 1.4),
    }),

    granite: new THREE.MeshStandardMaterial({
      ...tex.granite,
      // Genuinely dark and cool. The sealed doorway is the one cold object in
      // a hot scene, which is what makes the eye go to it.
      color: 0x5c6470,
      roughness: 1.0,
      metalness: 0.22,
      normalScale: new THREE.Vector2(0.8, 0.8),
    }),

    // --- metals ----------------------------------------------------------
    gold: new THREE.MeshStandardMaterial({
      ...tex.gold,
      color: 0xffd98a,
      roughness: 1.0,
      metalness: 0.92,
      normalScale: new THREE.Vector2(0.5, 0.5),
      emissive: 0x2a1c05,
      emissiveIntensity: 0.4,
    }),

    gunmetal: new THREE.MeshStandardMaterial({
      color: 0x3a3d42,
      roughness: 0.35,
      metalness: 0.90,
    }),

    polymer: new THREE.MeshStandardMaterial({
      color: 0x22242a,
      roughness: 0.70,
      metalness: 0.05,
    }),

    // --- vegetation and cloth --------------------------------------------
    palmTrunk: new THREE.MeshStandardMaterial({
      color: 0x6b563a,
      roughness: 0.95,
      metalness: 0.0,
    }),

    palmFrond: new THREE.MeshStandardMaterial({
      // Dusty olive, not a saturated leaf green. The only cool-adjacent colour
      // in the courtyard, so it needs to sit in the palette rather than shout.
      color: 0x5c6b34,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),

    linen: new THREE.MeshStandardMaterial({
      color: 0xbcae91,
      roughness: 0.95,
      metalness: 0.0,
    }),

    // --- emissive --------------------------------------------------------
    ember: new THREE.MeshStandardMaterial({
      color: 0xff8c32,
      emissive: 0xff6a12,
      emissiveIntensity: 3.2,
      roughness: 0.6,
      metalness: 0.0,
    }),

    // Airborne dust. Additive points catch the light and cost almost nothing.
    dust: new THREE.PointsMaterial({
      color: 0xd8c49a,
      size: 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  };

  // --- weathering ----------------------------------------------------------
  // World-space grime, sun bleaching, and large-scale mottling, injected into
  // the standard material so it keeps three.js lighting, shadows, and fog.
  // This is what stops a tiled texture from reading as a tiled texture.

  weather(m.limestone, {
    dirtHeight: 3.2,
    dirt: new THREE.Color(0x7a6547),
    variation: 0.34,
    dirtStrength: 0.60,
    bleachStrength: 0.13,
  });

  weather(m.carved, {
    dirtHeight: 2.8,
    dirt: new THREE.Color(0x74603f),
    variation: 0.30,
    dirtStrength: 0.52,
    bleachStrength: 0.12,
  });

  weather(m.granite, {
    dirtHeight: 2.2,
    dirt: new THREE.Color(0x53585e),
    variation: 0.26,
    dirtStrength: 0.40,
    bleachStrength: 0.08,
  });

  // Sand gets mottling only. Grime and bleach make no sense on a dune field,
  // but the large-scale variation is what breaks up the tiling across 420 units.
  weather(m.sand, {
    dirtHeight: 0.001,
    variation: 0.22,
    dirtStrength: 0.0,
    bleachStrength: 0.10,
  });

  cache = m;
  return cache;
}

/**
 * Upgrade the procedural materials in place with scanned CC0 map sets.
 *
 * In place, not replaced: every mesh already points at these material objects,
 * and the world-space weathering injection is already installed on them. That
 * injection is what keeps a 1K tiled scan from reading as a 1K tiled scan, so
 * the two are complementary rather than redundant.
 */
export function upgradeMaterials(sets) {
  const m = buildMaterials();
  if (!sets) return m;

  // normalScale is dialled per surface. Scanned normals are far stronger than
  // the Sobel-derived ones they replace, and at 1.0 the masonry reads as
  // corrugated rather than as cut stone.
  applyMaps(m.sand,      sets.sand,      { normalScale: 0.85, aoIntensity: 0.9 });
  applyMaps(m.limestone, sets.limestone, { normalScale: 1.00, aoIntensity: 1.0 });
  // Weathered rock, NOT the tile scan. Tiles139 is square floor tiles: correct
  // for a plaza, catastrophic on a column, where it reads as a checkerboard
  // and announces that the surface is a photograph.
  applyMaps(m.carved,    sets.rock,      { normalScale: 1.05, aoIntensity: 1.0 });
  applyMaps(m.granite,   sets.granite,   { normalScale: 0.75 });

  // The scans carry their own colour, so the procedural tints that were
  // standing in for it must go back to white or they double up.
  m.sand.color.setHex(0xffffff);
  m.limestone.color.setHex(0xd8c39a);
  m.carved.color.setHex(0xd6bb90);   // sandstone, not quarry grey
  m.granite.color.setHex(0xaab2bd);

  // The authored normalScale is the new baseline for the fidelity toggle.
  for (const mat of [m.sand, m.limestone, m.carved, m.granite]) {
    mat.userData.authoredNormalScale = mat.normalScale.x;
  }

  return m;
}

/**
 * Drop shadow-map sampling and normal maps on the low fidelity setting.
 * Cheapest large win on weak hardware after disabling post entirely.
 */
export function applyFidelity(materials, high) {
  for (const mat of Object.values(materials)) {
    if (!mat.isMeshStandardMaterial || !mat.normalScale) continue;

    // Remember the authored value the first time through, so toggling back to
    // high restores the tuned scale rather than flattening everything to 1.
    if (mat.userData.authoredNormalScale === undefined) {
      mat.userData.authoredNormalScale = mat.normalScale.x;
    }

    mat.normalScale.setScalar(high ? mat.userData.authoredNormalScale : 0);
    mat.needsUpdate = true;
  }
}
