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
 * @param {THREE.MeshStandardMaterial} material  modified in place
 * @param {object} opts
 * @param {number} opts.groundLevel  world Y that counts as "the base"
 * @param {number} opts.dirtHeight   how far up the grime reaches
 * @param {THREE.Color} opts.dirt    grime colour multiplied in at the base
 * @param {THREE.Color} opts.bleach  sun-bleached colour toward the top
 * @param {number} opts.variation    0..1 strength of the large-scale mottling
 */
export function weather(material, {
  groundLevel = 0,
  dirtHeight = 2.6,
  dirt = new THREE.Color(0x6f5d42),
  bleach = new THREE.Color(0xfff4dc),
  variation = 0.30,
  dirtStrength = 0.55,
  bleachStrength = 0.22,
} = {}) {

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
