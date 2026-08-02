/**
 * World-space weathering, injected into MeshStandardMaterial.
 *
 * The problem: a tiled texture repeats. At gameplay distance the eye picks up
 * the repetition instantly, and a surface that repeats reads as a texture
 * rather than as a material. This is the third big "it looks like a game"
 * tell, after sharp edges and missing ambient occlusion.
 *
 * Real surfaces vary at a scale much larger than any tile: dirt accumulates at
 * the base of a wall, sun bleaches the top, damp darkens the shadowed side,
 * and the stone itself is not one colour across ten metres.
 *
 * Rather than authoring huge unique textures, we modulate the sampled albedo
 * by a low-frequency function of WORLD position. Because it is world-space and
 * not UV-space, it does not repeat with the tile, and two adjacent walls sharing
 * one material still differ from each other.
 *
 * This is done with onBeforeCompile rather than a custom ShaderMaterial so the
 * material keeps three.js lighting, shadows, fog, and tone mapping for free.
 * Writing those by hand is how a scene loses its shadows.
 */

import * as THREE from 'three';

/**
 * The options each weathered material was authored with, so a variant of it can
 * be made later without the caller having to know them.
 *
 * A WeakMap rather than `material.userData`, and that is not fastidiousness:
 * `Material.copy` deep-copies userData through JSON.parse(JSON.stringify(...)),
 * which would turn a THREE.Color into a bare object and, once the material has
 * compiled and `userData.shader` exists, would try to serialise every uniform
 * and texture hanging off it.
 */
const PROFILES = new WeakMap();

/** parent material -> Map(groundLevel -> variant). */
const VARIANTS = new WeakMap();

/** Every variant ever made, for the sync pass. */
const ALL_VARIANTS = [];

/**
 * @param {THREE.MeshStandardMaterial} material  modified in place
 * @param {object} opts
 * @param {number} opts.groundLevel  world Y that counts as "the base"
 * @param {number} opts.dirtHeight   how far up the grime reaches
 * @param {THREE.Color} opts.dirt    grime colour multiplied in at the base
 * @param {THREE.Color} opts.bleach  sun-bleached colour toward the top
 * @param {number} opts.variation    0..1 strength of the large-scale mottling
 */
export function weather(material, opts = {}) {
  const {
    groundLevel = 0,
    dirtHeight = 2.6,
    dirt = new THREE.Color(0x6f5d42),
    bleach = new THREE.Color(0xfff4dc),
    variation = 0.30,
    dirtStrength = 0.55,
    bleachStrength = 0.22,
  } = opts;

  PROFILES.set(material, {
    groundLevel, dirtHeight, dirt, bleach, variation, dirtStrength, bleachStrength,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundLevel = { value: groundLevel };
    shader.uniforms.uDirtHeight = { value: dirtHeight };
    shader.uniforms.uDirt = { value: dirt };
    shader.uniforms.uBleach = { value: bleach };
    shader.uniforms.uVariation = { value: variation };
    shader.uniforms.uDirtStrength = { value: dirtStrength };
    shader.uniforms.uBleachStrength = { value: bleachStrength };

    // --- vertex: carry world position through to the fragment stage --------
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWeatherWorldPos;
         varying vec3 vWeatherWorldNormal;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         // worldPosition is only defined by that chunk when the material needs
         // it, so compute it unconditionally rather than relying on the define.
         vWeatherWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
         vWeatherWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );`
      );

    // --- fragment: modulate albedo before lighting -------------------------
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWeatherWorldPos;
         varying vec3 vWeatherWorldNormal;
         uniform float uGroundLevel;
         uniform float uDirtHeight;
         uniform vec3  uDirt;
         uniform vec3  uBleach;
         uniform float uVariation;
         uniform float uDirtStrength;
         uniform float uBleachStrength;

         // Smooth value noise over world space. Three octaves is enough to
         // break tiling without adding visible structure of its own.
         float wHash(vec3 p) {
           return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
         }

         float wNoise(vec3 p) {
           vec3 i = floor(p);
           vec3 f = fract(p);
           f = f * f * (3.0 - 2.0 * f);

           float n000 = wHash(i + vec3(0,0,0)), n100 = wHash(i + vec3(1,0,0));
           float n010 = wHash(i + vec3(0,1,0)), n110 = wHash(i + vec3(1,1,0));
           float n001 = wHash(i + vec3(0,0,1)), n101 = wHash(i + vec3(1,0,1));
           float n011 = wHash(i + vec3(0,1,1)), n111 = wHash(i + vec3(1,1,1));

           return mix(
             mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
             f.z);
         }

         float wFbm(vec3 p) {
           return wNoise(p) * 0.55 + wNoise(p * 2.3) * 0.30 + wNoise(p * 5.1) * 0.15;
         }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           vec3 wp = vWeatherWorldPos;

           // --- large-scale mottling ---------------------------------------
           // Frequency deliberately far below the texture tile rate, so this
           // varies across a whole wall rather than within one block.
           float mottle = wFbm(wp * 0.055);
           diffuseColor.rgb *= mix(1.0 - uVariation, 1.0 + uVariation * 0.55, mottle);

           // --- grime at the base -------------------------------------------
           // Water wicks up and dust splashes onto the lower courses. The noise
           // term stops the transition from reading as a straight horizontal
           // line, which is what would give the trick away.
           float hb = (wp.y - uGroundLevel) / uDirtHeight;
           float grime = 1.0 - smoothstep(0.0, 1.0, hb + (wFbm(wp * 0.42) - 0.5) * 0.45);
           grime = clamp(grime, 0.0, 1.0);

           // Upward-facing surfaces collect less wicked grime than vertical
           // ones, so weight by how vertical the surface is.
           float verticality = 1.0 - abs(vWeatherWorldNormal.y);
           diffuseColor.rgb = mix(diffuseColor.rgb,
                                  diffuseColor.rgb * uDirt,
                                  grime * uDirtStrength * mix(0.45, 1.0, verticality));

           // --- sun bleaching on upward faces --------------------------------
           float up = max(vWeatherWorldNormal.y, 0.0);
           float bleachAmt = up * uBleachStrength * (0.6 + 0.4 * mottle);
           diffuseColor.rgb = mix(diffuseColor.rgb, uBleach, bleachAmt);
         }`
      )
      // Grime is rougher than clean stone. Varying roughness across a surface
      // is a large part of why real materials do not look uniform.
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         {
           float rGrime = 1.0 - smoothstep(0.0, 1.0,
             (vWeatherWorldPos.y - uGroundLevel) / uDirtHeight);
           roughnessFactor = clamp(roughnessFactor + rGrime * 0.18, 0.04, 1.0);
         }`
      );

    material.userData.shader = shader;
  };

  // Changing onBeforeCompile after a material has been used requires a new
  // program. Bumping the cache key is how three.js is told that.
  material.customProgramCacheKey = () => `weathered-${dirtHeight}-${variation}`;
  material.needsUpdate = true;

  return material;
}

/**
 * ---------------------------------------------------------------------------
 * THE DATUM HAS TO TRAVEL WITH THE GEOMETRY
 * ---------------------------------------------------------------------------
 *
 * `uGroundLevel` above is an absolute world Y, and it was 0 for every material
 * in the game because for a long time every floor in the game was 0. World 1's
 * descent ended that: the five Act 3 rooms sit at y = -6, every surface in them
 * is below the datum, `hb` goes negative, `grime` saturates at 1, and the whole
 * of Act 3 takes the full dirt multiply from floor to ceiling. Measured, that
 * cost the Serdab 43 per cent of its albedo. docs/DESCENT.md section 6 has the
 * table and the proof: translating the interior group +6 at runtime, with
 * identical lights and an identical relative camera, took the Serdab from 13.83
 * to 21.78 without touching anything else.
 *
 * There is no single value of `uGroundLevel` that is right for a courtyard at
 * grade and an interior spanning -6 to +6, so the datum has to become per-room.
 * Two ways to do that, and the choice was argued:
 *
 * A PER-MESH ATTRIBUTE WAS REJECTED, and not on taste. There is no geometry
 * chokepoint in this codebase: roughly 120 sites construct geometry directly
 * (69 raw constructions plus 51 uv.js helper calls), and every one of them would
 * need to bind a `weatherBase` attribute. Leaving it unbound and relying on
 * WebGL's default generic vertex attribute of 0 would render correctly under
 * swiftshader, which is what every harness in this repo uses, and is
 * driver-dependent on real hardware. A fix that is only verifiable on the
 * machine that cannot see it failing is not a fix.
 *
 * PER-BASE MATERIAL INSTANCES, therefore, keyed on the room's own `base`. The
 * objection to this was batching, and that objection was wrong and is retracted:
 * `systems/spaces.js` sets `courtyard.group.visible = !toInterior` and
 * `interior.group.visible = toInterior`, so the two spaces never render in the
 * same frame and an interior-only instance splits nothing the courtyard was
 * sharing. The interior is not batched at all - `world/batch.js` is a courtyard
 * pass - so within the interior the split is purely by distinct base: two today,
 * and the cost is a handful of extra draw calls in a room count of about 1400.
 *
 * A third elevation in World 2 costs one more instance and no new thinking.
 */

/**
 * The weathered material for a given floor elevation.
 *
 * Returns the material itself when the datum already matches, so the courtyard
 * and every room at y = 0 keep the exact object they have always had and no
 * draw call anywhere is split by this function being called.
 *
 * @param {THREE.Material} material  a material previously passed to weather()
 * @param {number} groundLevel       the floor the grime should be measured from
 */
export function weatherVariant(material, groundLevel = 0) {
  const profile = PROFILES.get(material);
  // Not weathered, so there is no datum to move and nothing to gain by cloning.
  // gold, ember, linen and the metals all land here.
  if (!profile) return material;
  if (profile.groundLevel === groundLevel) return material;

  let byLevel = VARIANTS.get(material);
  if (!byLevel) VARIANTS.set(material, (byLevel = new Map()));
  const cached = byLevel.get(groundLevel);
  if (cached) return cached;

  // userData is emptied across the clone because Material.copy runs it through
  // JSON. It is empty at interior build time today, and this is the guard that
  // keeps that from being a thing a future caller has to know.
  const savedUserData = material.userData;
  material.userData = {};
  const variant = material.clone();
  material.userData = savedUserData;
  variant.userData = {};

  /**
   * THE MUTABLE SUB-OBJECTS ARE SHARED WITH THE PARENT ON PURPOSE.
   *
   * `upgradeMaterials` retints in place (`m.limestone.color.setHex(...)`) once
   * the scanned map sets land, and `applyFidelity` zeroes `normalScale` in place
   * on the fidelity toggle. Both of those run long after the interior is built
   * and neither walks a list this variant is on. Pointing at the same Color and
   * Vector2 the parent holds means those two paths keep working with no wiring
   * at all, rather than working until somebody adds a third one.
   *
   * What CANNOT be shared this way is anything assigned rather than mutated -
   * the four texture slots and the scalar roughness - and that is what
   * syncWeatherVariants below exists for.
   */
  variant.color = material.color;
  variant.emissive = material.emissive;
  variant.normalScale = material.normalScale;

  // Named so the harness can tell the instances apart in a mesh census. An
  // unnamed material in a table of material counts is not evidence of anything.
  variant.name = `${material.name || 'stone'}@${groundLevel}`;

  weather(variant, { ...profile, groundLevel });

  byLevel.set(groundLevel, variant);
  ALL_VARIANTS.push({ parent: material, variant });
  return variant;
}

/**
 * Re-copy everything a variant cannot share by reference from its parent.
 *
 * Called after `upgradeMaterials` folds the scanned CC0 map sets in. Those are
 * ASSIGNED onto the parent (`material.map = maps.map`), and assignment does not
 * reach a clone made before it, so without this pass Act 3 would keep the
 * procedural textures while Act 2 got the scans - a difference that renders,
 * that no test asserts, and that reads as "the deep rooms look wrong" rather
 * than as a missing call.
 */
export function syncWeatherVariants() {
  for (const { parent, variant } of ALL_VARIANTS) {
    variant.map = parent.map;
    variant.normalMap = parent.normalMap;
    variant.roughnessMap = parent.roughnessMap;
    variant.aoMap = parent.aoMap;
    variant.roughness = parent.roughness;
    variant.metalness = parent.metalness;
    variant.aoMapIntensity = parent.aoMapIntensity;
    variant.needsUpdate = true;
  }
  return ALL_VARIANTS.length;
}
