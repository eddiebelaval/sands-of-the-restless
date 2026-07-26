/**
 * Cloud shells for the sky dome.
 *
 * Not a volume march. Two 2.5D shells evaluated per-pixel inside the sky dome's
 * own fragment shader: cumulus on a deck at ~1.5 km, cirrus at ~7.8 km. The ray
 * from the camera is intersected analytically with each deck plane, and the
 * density is a domain-warped FBM sampled at that intersection.
 *
 * The reason this is worth doing is cost. A raymarched volume is 30 to 60 texture
 * fetches per pixel and needs temporal reprojection to stop it boiling. This is
 * a few dozen ALU-bound noise taps inside a shader we are already running, over
 * the sky pixels only, with nothing to reproject and nothing to dither. It buys
 * most of the read for a small fraction of the cost.
 *
 * Two tricks do the heavy lifting, and neither is obvious:
 *
 *   1. PARALLAX SHEAR. A flat noise field on a plane reads as wallpaper because
 *      it has no thickness. Sampling the field a second time, offset along the
 *      view ray by an amount proportional to the density already there and
 *      inversely proportional to how steeply you are looking, fakes the far side
 *      of a cloud with real depth. Clouds overhead barely shift; clouds near the
 *      horizon smear enormously, which is exactly what a deck of finite
 *      thickness does when you look at it edge on.
 *
 *   2. THREE-TAP SUN SHADOW. Marching three samples across the deck toward the
 *      sun and attenuating by what they find is what makes tops bright and
 *      undersides dark. Without it the clouds are a flat grey stencil no matter
 *      how good the noise is. With it they have a light direction, and a light
 *      direction is what the eye reads as volume.
 *
 * This module deliberately does NOT touch sky.js. It exports GLSL as strings
 * plus a matching uniforms object so the sky dome shader can compose them in.
 * See the integration note at the bottom of this file.
 *
 * Everything is procedural: hash-based value noise, no textures, no loaders.
 */

import * as THREE from 'three';

/**
 * Tunables, all in one place so the look can be dialled without reading GLSL.
 *
 * Heights are metres. The dome radius is only 900 m, but that does not matter:
 * these shells are intersected mathematically against the view ray, not drawn
 * as geometry, so the deck can sit far outside the dome it is painted on.
 */
export const CLOUD_DEFAULTS = {
  // --- cumulus deck ---------------------------------------------------------
  cumulusHeight: 1500,     // metres above the camera
  cumulusSize: 620,        // metres per unit of noise domain. Bigger = bigger clouds.
  cumulusCoverage: 0.46,   // 0 clear, 1 overcast. The one knob to reach for first.
  cumulusContrast: 2.4,    // widens the noise distribution before thresholding
  cumulusEdge: 0.20,       // threshold width. Small = hard cauliflower edges.
  cumulusWarp: 0.75,       // domain warp strength
  cumulusShear: 0.85,      // the parallax constant. This is the reference value.
  cumulusShearMax: 1.8,    // clamp, in domain units. See the note at the shear.
  cumulusOpacity: 1.0,
  cumulusAbsorb: 6.5,      // how fast the sun march darkens the underside
  cumulusShadowStep: 0.42, // sun march step, in noise domain units

  // --- cirrus deck ----------------------------------------------------------
  // Thinner, higher, faster, and stretched along one axis so it reads as
  // wind-combed streaks rather than a second layer of the same puffs.
  cirrusHeight: 7800,
  cirrusSize: 2600,
  cirrusCoverage: 0.40,
  cirrusContrast: 1.8,
  cirrusEdge: 0.30,
  cirrusOpacity: 0.34,
  cirrusStretch: 4.2,      // anisotropy. 1 = isotropic blobs.

  // --- shading --------------------------------------------------------------
  litColor: 0xfff4e2,      // sun-facing tops
  shadowColor: 0x7c8ba8,   // undersides, tinted with the sky rather than grey
  silver: 0.85,            // forward-scatter rim when looking toward the sun

  // --- horizon --------------------------------------------------------------
  // The deck has to dissolve before it reaches the horizon line, or the shells
  // terminate in a hard band exactly where the eye is most sensitive to it.
  horizonFade: 0.115,

  // --- wind, metres per second, advanced on the CPU by advanceClouds() -------
  wind: {
    cumulus: [7.5, 2.4],
    cirrus: [26.0, -9.0],
  },
};

/**
 * Uniforms to merge into the sky dome material.
 *
 * Deliberately prefixed uCld so nothing collides with sky.js's own uSunDir,
 * uHorizon, uZenith and friends. The sun direction and sun colour are passed
 * into the entry function as arguments rather than duplicated as uniforms,
 * because the dome already declares them.
 */
export function createCloudUniforms(overrides = {}) {
  const c = { ...CLOUD_DEFAULTS, ...overrides };

  return {
    uCldCumHeight:     { value: c.cumulusHeight },
    uCldCumSize:       { value: c.cumulusSize },
    uCldCumCoverage:   { value: c.cumulusCoverage },
    uCldCumContrast:   { value: c.cumulusContrast },
    uCldCumEdge:       { value: c.cumulusEdge },
    uCldCumWarp:       { value: c.cumulusWarp },
    uCldCumShear:      { value: c.cumulusShear },
    uCldCumShearMax:   { value: c.cumulusShearMax },
    uCldCumOpacity:    { value: c.cumulusOpacity },
    uCldCumAbsorb:     { value: c.cumulusAbsorb },
    uCldCumShadowStep: { value: c.cumulusShadowStep },
    uCldCumDrift:      { value: new THREE.Vector2(0, 0) },

    uCldCirHeight:     { value: c.cirrusHeight },
    uCldCirSize:       { value: c.cirrusSize },
    uCldCirCoverage:   { value: c.cirrusCoverage },
    uCldCirContrast:   { value: c.cirrusContrast },
    uCldCirEdge:       { value: c.cirrusEdge },
    uCldCirOpacity:    { value: c.cirrusOpacity },
    uCldCirStretch:    { value: c.cirrusStretch },
    uCldCirDrift:      { value: new THREE.Vector2(0, 0) },

    uCldLit:           { value: new THREE.Color(c.litColor) },
    uCldShadow:        { value: new THREE.Color(c.shadowColor) },
    uCldSilver:        { value: c.silver },
    uCldHorizonFade:   { value: c.horizonFade },
  };
}

// A frame that arrives after the tab was backgrounded carries a delta of
// seconds, which would teleport the whole sky sideways in one frame. Same clamp
// the main loop uses, applied again here so this module is safe on its own.
const MAX_DELTA = 1 / 20;

/**
 * Advance the wind. Drift is accumulated in metres, then divided by the deck's
 * domain size in the shader, so changing cloud SIZE never changes wind SPEED.
 *
 * Multiply by dt, never by a per-frame constant: at 30 fps a per-frame constant
 * halves the wind speed, and the sky is the one part of the frame slow enough
 * for that to be visible as a bug rather than as weather.
 */
export function advanceClouds(uniforms, dt, wind = CLOUD_DEFAULTS.wind) {
  const d = Math.min(Math.max(dt, 0), MAX_DELTA);

  uniforms.uCldCumDrift.value.x += wind.cumulus[0] * d;
  uniforms.uCldCumDrift.value.y += wind.cumulus[1] * d;

  uniforms.uCldCirDrift.value.x += wind.cirrus[0] * d;
  uniforms.uCldCirDrift.value.y += wind.cirrus[1] * d;
}

/**
 * The shader half. Paste this into the sky dome's fragment shader anywhere
 * above main(). It declares its own uniforms and defines exactly one entry
 * point:
 *
 *   vec4 skClouds( vec3 rayDir, vec3 sunDir, vec3 sunColor )
 *
 * returning straight (non-premultiplied) colour and coverage.
 *
 * Define SK_CLOUD_LOW to drop the main field from six octaves to four and the
 * sun march from three taps to one. That is the low-fidelity path; it costs
 * roughly 40 percent of the full version and still reads as clouds.
 */
export const CLOUD_GLSL = /* glsl */`
uniform float uCldCumHeight;
uniform float uCldCumSize;
uniform float uCldCumCoverage;
uniform float uCldCumContrast;
uniform float uCldCumEdge;
uniform float uCldCumWarp;
uniform float uCldCumShear;
uniform float uCldCumShearMax;
uniform float uCldCumOpacity;
uniform float uCldCumAbsorb;
uniform float uCldCumShadowStep;
uniform vec2  uCldCumDrift;

uniform float uCldCirHeight;
uniform float uCldCirSize;
uniform float uCldCirCoverage;
uniform float uCldCirContrast;
uniform float uCldCirEdge;
uniform float uCldCirOpacity;
uniform float uCldCirStretch;
uniform vec2  uCldCirDrift;

uniform vec3  uCldLit;
uniform vec3  uCldShadow;
uniform float uCldSilver;
uniform float uCldHorizonFade;

// ---------------------------------------------------------------------------
// noise
// ---------------------------------------------------------------------------

// Two-in one-out hash. Value noise rather than gradient noise on purpose:
// gradient noise is signed and zero at the lattice points, which gives clouds a
// regular grid of holes. Value noise is blobby, and blobby is what we want.
float skCldHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p.yx + 34.79);
  return fract(p.x * p.y * 95.4307);
}

float skCldValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);

  // Quintic rather than cubic smoothstep. The second derivative is continuous,
  // so the lattice does not show up as faint creases under the sun shadow term,
  // which is where cubic interpolation gives itself away.
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  float a = skCldHash(i);
  float b = skCldHash(i + vec2(1.0, 0.0));
  float c = skCldHash(i + vec2(0.0, 1.0));
  float d = skCldHash(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Rotate between octaves. Without it every octave shares the same axes and the
// FBM shows a diagonal grain that no amount of warping will hide.
const mat2 SK_CLD_ROT = mat2(0.80, 0.60, -0.60, 0.80);

// Two octaves, for the sun march. Cheap on purpose.
float skCldFbm2(vec2 p) {
  float f = 0.5 * skCldValueNoise(p);
  p = SK_CLD_ROT * p * 2.07;
  return (f + 0.25 * skCldValueNoise(p)) / 0.75;
}

/**
 * Level-of-detail FBM.
 *
 * The detail argument is a continuous octave count. Octave i fades out as it drops
 * past it, which is the fix for the sparkling band that otherwise appears just
 * above the horizon. That band is real aliasing, not a look: near the horizon
 * the deck coordinate goes as 1/rayDir.y, so the noise domain moves hundreds of
 * units between adjacent pixels and the top octaves undersample violently.
 * There is no texture here to have mipmaps, so the fade is the mip chain.
 *
 * The loop bound stays the literal 6 and the weight is a multiply rather than a
 * break, because GLSL ES 1.00 wants constant loop bounds and a dynamic break is
 * exactly the sort of thing that compiles on a desktop driver and fails
 * elsewhere.
 */
float skCldFbmLod(vec2 p, float detail) {
  float amp = 0.5;
  float sum = 0.0;
  float nrm = 0.0;

  for (int i = 0; i < 6; i++) {
    // Smoothstepped rather than linear. A linear ramp is only C0, and the kink
    // at each end of it shows up in the sky as a hard concentric ring on the
    // iso-elevation line where that octave switches on. The contrast stretch
    // downstream amplifies any such discontinuity into a visible contour.
    float w = clamp(detail - float(i), 0.0, 1.0);
    w = w * w * (3.0 - 2.0 * w);

    sum += amp * w * skCldValueNoise(p);
    nrm += amp * w;
    p = SK_CLD_ROT * p * 2.07;
    amp *= 0.5;
  }

  return sum / max(nrm, 1.0e-4);
}

// Domain warp. Displacing the sample point by a low-octave FBM of itself is
// what turns round noise blobs into the billowed, curdled shapes real cumulus
// has. It is the single cheapest thing here that reads as "not procedural".
//
// Applied ONCE per pixel and the warped coordinate then shared by every
// subsequent tap. That is not just a saving: warping each tap separately puts
// the sun-shadow samples in a different field from the density they are meant
// to be shadowing, and the shading detaches from the shapes. Clouds lit by a
// light that does not match their silhouette read as flat noise no matter how
// good either half is on its own.
vec2 skCldWarp(vec2 p, float amount) {
  float wx = skCldFbm2(p * 0.55 + vec2(11.3, 5.1));
  float wy = skCldFbm2(p * 0.55 + vec2(-3.7, 19.4));
  return p + (vec2(wx, wy) - 0.5) * amount;
}

// ---------------------------------------------------------------------------
// shape
// ---------------------------------------------------------------------------

/**
 * Noise value to cloud density.
 *
 * The contrast stretch has to come first. Value-noise FBM is tightly clustered
 * around 0.5, and thresholding that distribution directly gives a choice
 * between soft vapour (wide threshold) and thin lace (narrow threshold), never
 * a solid cloud with a hard edge. Widening the distribution first is what makes
 * both possible at once.
 *
 * Then the moving threshold: raise coverage, the threshold drops, more of the
 * field survives, the sky fills.
 */
float skCldShape(float f, float contrast, float coverage, float edge) {
  // No clamp before the threshold. smoothstep already clamps its output, and a
  // clamp here would flatten the tails of the distribution into plateaus that
  // then quantise into visible contour steps at the cloud edges.
  f = (f - 0.5) * contrast + 0.5;
  float t = 1.0 - coverage;
  return smoothstep(t, t + edge, f);
}

// ---------------------------------------------------------------------------
// cumulus deck
// ---------------------------------------------------------------------------

vec4 skCumulus(vec3 rayDir, vec3 sunDir, vec3 sunColor) {
  // Below this the ray never reaches the deck within any sane distance, and the
  // 1/rayDir.y term blows up. Bail rather than clamp, so the horizon costs
  // nothing at all on the ground half of the frame.
  if (rayDir.y < 0.010) return vec4(0.0);

  // Ray-plane intersection, expressed directly in noise domain units. Dividing
  // by the deck size here rather than inside the noise means wind drift (which
  // is in metres) stays independent of cloud scale.
  vec2 p0 = (rayDir.xz * (uCldCumHeight / rayDir.y) + uCldCumDrift) / uCldCumSize;
  vec2 q0 = skCldWarp(p0, uCldCumWarp);

  // Detail falls off toward the horizon, where the deck is undersampled.
#ifdef SK_CLOUD_LOW
  float detail = mix(1.4, 4.0, smoothstep(0.04, 0.42, rayDir.y));
#else
  float detail = mix(1.4, 6.0, smoothstep(0.04, 0.42, rayDir.y));
#endif

  // --- the parallax shear -------------------------------------------------
  // Sample once for the near face of the deck, then again offset along the view
  // ray by an amount that grows with the density already found and with how
  // shallowly we are looking. max() keeps the near face from being erased when
  // the sheared sample lands in a hole; the 0.55 floor is what stops the deck
  // going lacy at grazing angles.
  //
  // The clamp is ours, not the reference's, and it earns its place: unclamped,
  // 0.85 / 0.10 is a shear of eight and a half domain units near the horizon,
  // which is several whole clouds' worth of offset. The two samples then have
  // nothing to do with each other and the deck smears into horizontal streaks
  // exactly where it should be reading as distance.
  float dBase = skCldShape(skCldFbmLod(q0, detail), uCldCumContrast, uCldCumCoverage, uCldCumEdge);
  vec2 shear = rayDir.xz * (uCldCumShear * dBase / max(0.10, rayDir.y));
  shear = clamp(shear, -uCldCumShearMax, uCldCumShearMax);

  float dShear = skCldShape(skCldFbmLod(q0 + shear, detail), uCldCumContrast, uCldCumCoverage, uCldCumEdge);
  float d = max(dShear, dBase * 0.55);

  if (d <= 0.001) return vec4(0.0);

  // --- three-tap sun self-shadow ------------------------------------------
  // Walking toward the sun across the deck, in the SAME warped field as the
  // density above. sunDir.xz / sunDir.y is the horizontal distance covered per
  // unit of climb, so a low sun gives a long near-horizontal march and
  // therefore long, strongly directional shading, which is precisely the look a
  // low sun should give.
  vec2 sunStep = (sunDir.xz / max(abs(sunDir.y), 0.16)) * uCldCumShadowStep;
  sunStep = clamp(sunStep, -2.5, 2.5);

#ifdef SK_CLOUD_LOW
  float occ = skCldShape(skCldFbm2(q0 + sunStep * 1.6), uCldCumContrast, uCldCumCoverage, uCldCumEdge);
#else
  float occ = (
      skCldShape(skCldFbm2(q0 + sunStep * 1.0), uCldCumContrast, uCldCumCoverage, uCldCumEdge)
    + skCldShape(skCldFbm2(q0 + sunStep * 2.3), uCldCumContrast, uCldCumCoverage, uCldCumEdge) * 0.7
    + skCldShape(skCldFbm2(q0 + sunStep * 4.1), uCldCumContrast, uCldCumCoverage, uCldCumEdge) * 0.4
  ) / 2.1;
#endif

  // Beer-Lambert through the occluding column. Multiplying by d as well means
  // the wispy edges of a puff stay lit while its solid core goes dark, which is
  // what gives cumulus its bright rim.
  float light = exp(-uCldCumAbsorb * occ * (0.35 + 0.65 * d));

  vec3 col = mix(uCldShadow, uCldLit, light);

  // Forward scattering. Cloud edges facing the sun glow brighter than the sun
  // itself paints them, because light is being scattered through a thin section
  // rather than off a thick one. Weighted by (1 - light) so it appears on the
  // shaded parts near the sun, which is where a real silver lining lives.
  float toSun = max(dot(rayDir, sunDir), 0.0);
  col += sunColor * pow(toSun, 6.0) * (1.0 - light) * uCldSilver;

  // Dissolve into the horizon rather than ending on a line.
  float fade = smoothstep(uCldHorizonFade * 0.35, uCldHorizonFade * 3.0, rayDir.y);

  return vec4(col, clamp(d * uCldCumOpacity * fade, 0.0, 1.0));
}

// ---------------------------------------------------------------------------
// cirrus deck
// ---------------------------------------------------------------------------

vec4 skCirrus(vec3 rayDir, vec3 sunDir, vec3 sunColor) {
  if (rayDir.y < 0.020) return vec4(0.0);

  vec2 p = (rayDir.xz * (uCldCirHeight / rayDir.y) + uCldCirDrift) / uCldCirSize;

  // Anisotropic sampling. Compressing one axis before the FBM stretches every
  // feature along the other, which is the whole visual signature of cirrus:
  // combed, parallel, wind-aligned. Isotropic noise up here reads as a second
  // cumulus layer that forgot to be puffy.
  vec2 q = vec2(p.x / uCldCirStretch, p.y * 1.15);
  q = skCldWarp(q, 0.55);

  // Same horizon LOD fade as the cumulus deck, and for the same reason. Cirrus
  // sits five times higher, so its coordinate runs away five times faster.
#ifdef SK_CLOUD_LOW
  float detail = mix(1.4, 3.0, smoothstep(0.05, 0.48, rayDir.y));
#else
  float detail = mix(1.4, 4.0, smoothstep(0.05, 0.48, rayDir.y));
#endif

  float f = skCldFbmLod(q, detail);
  float d = skCldShape(f, uCldCirContrast, uCldCirCoverage, uCldCirEdge);

  if (d <= 0.001) return vec4(0.0);

  // No sun march here. Cirrus is ice crystals with almost no optical depth, so
  // it has no dark side to find; it brightens toward the sun and that is all.
  float toSun = max(dot(rayDir, sunDir), 0.0);
  vec3 col = mix(uCldLit, sunColor, 0.30) * (0.86 + 0.55 * pow(toSun, 4.0));

  float fade = smoothstep(uCldHorizonFade * 0.8, uCldHorizonFade * 5.0, rayDir.y);

  return vec4(col, clamp(d * uCldCirOpacity * fade, 0.0, 1.0));
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/**
 * Composite both decks and hand back straight colour plus coverage.
 *
 * Cirrus first because it is the higher shell and therefore behind: at 7.8 km
 * it must be occluded by the 1.5 km cumulus, never the other way round.
 */
vec4 skClouds(vec3 rayDir, vec3 sunDir, vec3 sunColor) {
  vec4 cir = skCirrus(rayDir, sunDir, sunColor);
  vec4 cum = skCumulus(rayDir, sunDir, sunColor);

  // Standard over-operator, done in premultiplied space and then un-premultiplied
  // once at the end, because the caller wants straight colour plus coverage.
  float aCir = cir.a * (1.0 - cum.a);
  float a = aCir + cum.a;

  // Guard the divide. Where both decks are empty the colour is meaningless and
  // the caller discards it anyway, but a NaN would propagate into the sky, then
  // into bloom, and take the whole frame with it.
  if (a <= 0.0001) return vec4(0.0);

  return vec4((cir.rgb * aCir + cum.rgb * cum.a) / a, a);
}
`;

/*
 * ---------------------------------------------------------------------------
 * INTEGRATION (four edits in src/world/sky.js, nothing else)
 * ---------------------------------------------------------------------------
 *
 * 1. import:
 *
 *      import { CLOUD_GLSL, createCloudUniforms, advanceClouds } from './clouds.js';
 *
 * 2. uniforms, in the SkyShader.uniforms object literal:
 *
 *      ...createCloudUniforms(),
 *
 * 3. fragment shader, immediately before `void main() {`:
 *
 *      ${CLOUD_GLSL}
 *
 *    (the fragmentShader template literal already interpolates, so this is a
 *    one-line insert)
 *
 * 4. inside main(), replacing the last three lines. The sun disc is multiplied
 *    down by cloud coverage so it is occluded rather than punching through:
 *
 *      col += uSunColor * glow;
 *
 *      vec4 cl = skClouds(d, normalize(uSunDir), uSunColor);
 *      col = mix(col, cl.rgb, cl.a);
 *
 *      col += uSunColor * disc * 6.0 * (1.0 - cl.a);
 *
 * Then in the object returned by createSky(), so the wind actually blows:
 *
 *      update(dt) { advanceClouds(mat.uniforms, dt); },
 *
 * and in setFidelity(high):
 *
 *      mat.defines = high ? {} : { SK_CLOUD_LOW: '' };
 *      mat.needsUpdate = true;
 *
 * main.js then calls sky.update(dt) once per frame next to sky.track(camera).
 */
