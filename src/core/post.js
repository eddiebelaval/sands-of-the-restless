/**
 * Post-processing chain.
 *
 * Order matters and is not arbitrary:
 *
 *   RenderPass       scene -> HDR linear buffer
 *   UnrealBloomPass  bloom must happen in linear HDR, before tone mapping,
 *                    or bright areas are already clipped and there is nothing
 *                    left to bloom
 *   OutputPass       tone mapping + sRGB conversion (this pass owns it when a
 *                    composer is in play, not the renderer)
 *   GradePass        grain, chromatic aberration, vignette, damage wash. These
 *                    are display-referred effects and belong AFTER tone mapping
 *   SMAAPass         anti-aliasing runs last, on the final image
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { createFogPass } from './fog.js';

/**
 * Draws the first-person viewmodel INSIDE the post chain.
 *
 * The weapon is its own scene with its own narrow-FOV camera, so it can never
 * clip into a wall. The mistake is drawing it to the screen after the composer
 * has finished: it then receives no bloom, no colour grade, and no
 * anti-aliasing, and reads as a separate image pasted onto a graded one. The
 * weapon fills a quarter of every frame, so that seam is extremely visible.
 *
 * This pass is inserted after ambient occlusion and before bloom. AO is
 * deliberately skipped: it is computed from the world's depth and normals, and
 * injecting a viewmodel that sits centimetres from the near plane into that
 * buffer produces a dark halo around the weapon rather than useful occlusion.
 * Bloom, tone mapping, grade, and AA all apply, which is what matters.
 */
class ViewmodelPass extends Pass {
  constructor(viewmodel) {
    super();
    this.viewmodel = viewmodel;
    // Draw in place into the buffer the next pass will read, rather than
    // ping-ponging, because this pass composites rather than transforms.
    this.needsSwap = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!this.viewmodel) return;

    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);

    // autoClear defaults to TRUE, and renderer.render() honours it by clearing
    // COLOUR as well as depth. Calling clearDepth() first is necessary but not
    // sufficient: without this guard, render() then wipes the world the
    // composer just spent five passes building, and the frame goes black with
    // only the gun on it.
    //
    // Scoped rather than global. Setting renderer.autoClear = false once at
    // startup would break RenderPass, which relies on the clear.
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    renderer.clearDepth();
    renderer.render(this.viewmodel.scene, this.viewmodel.camera);

    renderer.autoClear = prevAutoClear;
  }
}

/**
 * One composite shader doing four effects in a single pass. Four separate
 * ShaderPasses would mean four full-screen buffer round-trips for no benefit,
 * because none of them need the others' output as a separate texture.
 */
const GradeShader = {
  uniforms: {
    tDiffuse:   { value: null },
    uTime:      { value: 0 },
    uAberration:{ value: 0.00045 }, // widens when the player takes a hit
    uDamage:    { value: 0.0 },     // 0..1 red wash
    uGrain:     { value: 0.055 },
    // Was 0.62, which read as a lens defect rather than a lens. The corner
    // falloff is worth keeping (it is half of why these frames read as
    // photographed), but at 0.62 it was eating the avenue walls, which is
    // where the geometry is.
    uVignette:  { value: 0.38 },

    // --- black and white point ------------------------------------------
    // ACES lands nothing at 0.0 and nothing at 1.0 by design: it protects both
    // ends of the range. Protected is not the same as used. Measured off the
    // courtyard frame, the darkest one percent sat at 0.10 and the brightest
    // one percent at 0.85, so the whole image lived in the middle third with a
    // grey floor and no white anywhere. These two reclaim the ends.
    // uWhitePoint below 1.0 is a gain, and the shoulder further down is what
    // makes that gain safe.
    uBlackPoint:{ value: 0.026 },
    uWhitePoint:{ value: 0.920 },

    // Pivot for the contrast S-curve. NOT 0.5. Mid grey is the right pivot for
    // an image whose content straddles it; this frame's median sits near 0.39
    // and its brightest ground near 0.63, so pivoting at 0.5 pushed the bulk of
    // the image DOWN while the top never travelled far enough to reach white.
    // Pivoting BELOW the median means the same contrast number expands the
    // highlights much more than it deepens the shadows, which is the direction
    // this image actually needs.
    uPivot:     { value: 0.26 },

    // Knee where the highlight shoulder takes over. See the shoulder in the
    // fragment shader: past this point values approach 1.0 asymptotically
    // instead of clipping.
    uKnee:      { value: 0.86 },

    // --- split tone -------------------------------------------------------
    // A single-hue scene reads as flat no matter how good the geometry is,
    // because real film and real eyes never see one tone across a whole frame.
    //
    // This was previously an additive lift plus a multiplicative gain, and it
    // did not work: the lift was small enough to be invisible against warm
    // stone yet large enough to put a grey pedestal under every shadow, so it
    // cost blacks and bought no hue separation. Measured, shadows came out at
    // blue-minus-red of -5, warmer than neutral, in a frame whose highlights
    // were -31. Every surface sat on the same side of neutral.
    //
    // The replacement is multiplicative and weighted by luminance, so it tints
    // without moving the black point, and it can therefore be pushed hard
    // enough to actually cross neutral. Shadows go cool because sky is what
    // lights them; direct sun stays warm.
    //
    // Tuned against a measurement, not against taste. A first pass at
    // (0.750, 0.970, 1.255) hit the target hue split but took mean shadow
    // saturation to 0.43 against the reference's 0.29: shaded stone stopped
    // reading as stone in shade and started reading as blue stone. Backing all
    // the way off to a 0.285 spread put shadows at -3.9, warm again, which is
    // the original complaint. These sit between the two measured points: cool
    // shadows are DESATURATED and slightly blue, not saturated and blue.
    //
    // Hue split and chroma are coupled through this one spread, so the
    // reference's 0.29 shadow chroma is not reachable from here without
    // desaturating the frame globally. It should not be: the reference is
    // concrete, this is sandstone, and the sandstone is the point.
    uShadowTint:   { value: new THREE.Color(0.785, 0.975, 1.235) },
    uHighlightTint:{ value: new THREE.Color(1.028, 1.000, 0.972) },

    // A multiplicative tint has nothing to work with as it approaches zero, and
    // the deepest shadows would fall back to neutral exactly where the coolness
    // matters most. This small shadow-only offset carries the hue down into the
    // near-blacks. Kept tiny: the blue term is under six parts in 255, enough
    // to colour a shadow, not enough to be a pedestal.
    uShadowOffset: { value: new THREE.Vector3(-0.006, 0.003, 0.027) },

    // Luminance window over which shadow tint crossfades to highlight tint.
    // Deliberately narrow and low: with the midpoint near the frame median the
    // whole image would sit in the crossfade and average back to one hue, which
    // is the failure this is fixing. Below the floor is fully cool, above the
    // ceiling fully warm, and the mids resolve to one side or the other rather
    // than mush.
    //
    // The ceiling moved from 0.50 to 0.58 when the sun came down to 27 degrees,
    // because the frame it is describing moved with it. The window has to
    // straddle the frame's own histogram, not a remembered one: after the time
    // of day changed, the lower quartile of the spawn frame sat around 0.27,
    // which under a 0.05-to-0.50 window resolved to almost exactly half of each
    // tint and therefore to no tint at all. Measured, blue-minus-red in that
    // quartile was -1.3 against -16.3 in the top quartile: the right sign, but
    // a quarter of the separation the same lights gave in the avenue.
    uToneRange: { value: new THREE.Vector2(0.04, 0.58) },

    uGamma:     { value: 0.90 },
    uSaturation:{ value: 1.14 },
    uContrast:  { value: 1.10 },
  },

  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uDamage;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uBlackPoint;
    uniform float uWhitePoint;
    uniform float uPivot;
    uniform float uKnee;
    uniform vec3  uShadowTint;
    uniform vec3  uHighlightTint;
    uniform vec3  uShadowOffset;
    uniform vec2  uToneRange;
    uniform float uGamma;
    uniform float uSaturation;
    uniform float uContrast;
    varying vec2 vUv;

    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    // Cheap hash for per-pixel grain. Good enough and costs one sin.
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    // Highlight shoulder, replacing a hard clamp.
    //
    // Everything above reclaims range by scaling values up, which sends the
    // brightest pixels past 1.0. Clamping them there would flatten the sky to
    // paper white and throw away the one thing this renderer already does
    // better than its reference: an ACES chain that never clips. Above the knee
    // this rolls off asymptotically instead, so bright values keep separating
    // from each other however far they overshoot, and nothing ever reaches 1.0.
    //
    // Continuous in value AND slope at the knee, so there is no visible seam
    // where the roll begins.
    vec3 shoulder(vec3 x, float knee) {
      vec3 over = max(x - knee, 0.0);
      float span = 1.0 - knee;
      return min(x, vec3(knee)) + span * over / (span + over);
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float dist = length(center);

      // --- chromatic aberration ---------------------------------------
      // Scales with distance from centre so the middle of the screen, where
      // the player is aiming, stays clean.
      float ab = uAberration * (1.0 + uDamage * 6.0);
      // Linear in distance, not quadratic. The squared falloff was invisible
      // over open sand but fringes hard against high-contrast stone at the
      // frame edge, which is all the avenue walls are.
      vec2 offset = center * ab;

      vec4 c;
      c.r = texture2D(tDiffuse, uv + offset).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - offset).b;
      c.a = 1.0;

      // --- colour grade -------------------------------------------------
      // Applied here, after tone mapping, so it operates on display-referred
      // values the way a real grade does.
      //
      // Order is deliberate: reclaim the value range FIRST, colour it SECOND.
      // Doing it the other way round is what the old chain did, and the tint
      // it laid down became a floor the contrast stage then had to fight.

      // Black and white point. Maps the range the image actually occupies onto
      // the range the display actually has.
      c.rgb = max(c.rgb - uBlackPoint, 0.0) / (uWhitePoint - uBlackPoint);

      // Gamma bends the midtones. Below 1.0 it opens the upper mids, which is
      // where this frame was most starved.
      c.rgb = pow(c.rgb, vec3(uGamma));

      // Contrast about uPivot, not mid grey. See uPivot for why 0.5 was wrong
      // for this image specifically.
      c.rgb = (c.rgb - uPivot) * uContrast + uPivot;

      // Split tone. Weighted by luminance measured HERE, after the range work,
      // so the crossfade window refers to final values rather than to whatever
      // the tone mapper happened to hand over.
      float toneW = smoothstep(uToneRange.x, uToneRange.y, dot(max(c.rgb, 0.0), LUMA));
      c.rgb = c.rgb * mix(uShadowTint, uHighlightTint, toneW)
            + uShadowOffset * (1.0 - toneW);

      // Saturation, against luminance rather than a simple average, so the
      // greens of the palms do not go grey faster than the warm stone. It runs
      // after the split tone on purpose: it amplifies the hue separation the
      // split tone just created instead of the single cast it replaced.
      float luma = dot(c.rgb, LUMA);
      c.rgb = mix(vec3(luma), c.rgb, uSaturation);

      // Floor at zero, then roll the top off rather than clipping it.
      c.rgb = shoulder(max(c.rgb, 0.0), uKnee);

      // --- film grain ---------------------------------------------------
      float g = hash(uv * 512.0 + fract(uTime) * 91.7) - 0.5;
      c.rgb += g * uGrain;

      // --- vignette -------------------------------------------------------
      float vig = smoothstep(0.85, 0.22, dist);
      c.rgb *= mix(1.0, vig, uVignette);

      // --- damage wash -----------------------------------------------------
      if (uDamage > 0.001) {
        float edge = smoothstep(0.15, 0.75, dist);
        c.rgb = mix(c.rgb, vec3(0.55, 0.04, 0.02), edge * uDamage * 0.85);
      }

      gl_FragColor = c;
    }
  `,
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());

  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);

  composer.addPass(new RenderPass(scene, camera));

  // --- ambient occlusion ---------------------------------------------------
  // Contact darkening where surfaces meet. Without this, objects look pasted
  // onto the scene instead of sitting in it, and every crease reads flat.
  // It runs immediately after the beauty pass, before bloom, so occluded
  // creases do not glow.
  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.blendIntensity = 1.0;
  gtao.updateGtaoMaterial({
    radius: 0.85,            // world units. Architecture-scale creases.
    distanceExponent: 1.6,
    thickness: 1.0,
    scale: 1.1,
    samples: 16,
    screenSpaceRadius: false,
  });
  composer.addPass(gtao);

  // --- height fog -----------------------------------------------------------
  // This slot is load-bearing three ways. AFTER GTAO, because it borrows the
  // depth texture GTAO already fills. BEFORE the viewmodel, because that depth
  // is world-only and fogging afterwards would haze the gun using the distance
  // of the wall behind it. BEFORE bloom and OutputPass, because this is a
  // linear-HDR scattering term: sun-facing haze should exceed 1.0 and bloom.
  const fog = createFogPass(scene, camera, {
    width: size.x, height: size.y, depthTexture: gtao.depthTexture,
  });
  composer.addPass(fog);

  // The viewmodel slots in here: after AO, before bloom, so the weapon picks up
  // bloom, tone mapping, grade, and AA along with the rest of the frame.
  const viewmodelPass = new ViewmodelPass(null);
  composer.addPass(viewmodelPass);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.55,   // strength: restrained. Bloom is seasoning, not the meal.
    0.62,   // radius
    0.82    // threshold: only genuinely bright things glow
  );
  composer.addPass(bloom);

  // OutputPass performs tone mapping and colour space conversion. Once a
  // composer is in the pipeline this is where that happens, not the renderer.
  composer.addPass(new OutputPass());

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  // SMAAPass takes no constructor arguments in current three.js. Older
  // examples pass (width, height); that signature is gone.
  const smaa = new SMAAPass();
  composer.addPass(smaa);

  return {
    composer,
    bloom,
    grade,
    smaa,
    gtao,
    fog,
    viewmodelPass,

    /** Wire the viewmodel in once it exists. */
    setViewmodel(vm) { viewmodelPass.viewmodel = vm; },

    /** Advance time-driven uniforms. */
    update(dt) {
      grade.uniforms.uTime.value += dt;
    },

    /** 0..1 red wash and aberration widening, driven by the damage system. */
    setDamage(v) {
      grade.uniforms.uDamage.value = Math.max(0, Math.min(1, v));
    },

    /**
     * Low fidelity disables bloom, SMAA, and grade entirely. The RenderPass
     * then needs to write to screen itself, so it gets renderToScreen.
     */
    setFidelity(high) {
      bloom.enabled = high;
      smaa.enabled = high;
      grade.enabled = high;
      gtao.enabled = high;   // AO is the most expensive pass in the chain
      fog.enabled = high;    // borrows GTAO's depth, so it goes with it
      // The viewmodel pass always stays on: disabling it would remove the gun.

      const passes = composer.passes;
      for (const p of passes) p.renderToScreen = false;
      for (let i = passes.length - 1; i >= 0; i--) {
        if (passes[i].enabled) { passes[i].renderToScreen = true; break; }
      }
    },
  };
}
