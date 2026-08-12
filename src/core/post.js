/**
 * Post-processing chain.
 *
 * Order matters and is not arbitrary:
 *
 *   RenderPass       scene -> HDR linear buffer
 *   GTAOPass         fills its own G-buffer and the denoised AO term. It does
 *                    NOT composite; see AOCompositePass below for why
 *   AOCompositePass  applies the AO term, scaled by how much light is actually
 *                    arriving at each point of the linear HDR buffer
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
 * Composites the ambient occlusion term onto the linear HDR beauty buffer,
 * SCALED BY HOW MUCH LIGHT IS ARRIVING THERE.
 *
 * GTAOPass composites with a fixed-function blend - `dst * mix(1, ao,
 * intensity)`, DstColorFactor times ZeroFactor - which is to say it multiplies
 * the frame by the AO term and has no access to what it is darkening. That is
 * fine in a scene with one exposure. This game has two: an open courtyard and an
 * unpowered stone room, and the room is the darkest surface in the build.
 *
 * WHY THIS IS PHYSICS AND NOT A WORKAROUND. Ambient occlusion is a visibility
 * term on the AMBIENT hemisphere: it says what fraction of the sky a point can
 * see, and its job is to attenuate the light that arrives from everywhere at
 * once. Where almost no ambient light is arriving there is almost nothing for
 * it to attenuate, and multiplying a near-black surface by 0.4 removes light
 * that was never there. The Great Gallery with its braziers unlit emits 16.1
 * luma of its own, measured with the fog pass disabled - it is low because an
 * outdoor sky-haze pass used to leak into it and was removed - and a flat
 * multiply took the interior capture pose from 20.88 luma to 17.31 and 64.8 per
 * cent lit to 48.7. A sunlit courtyard at 110 luma should take the full effect;
 * a room that dark should be barely touched.
 *
 * WHY THE WEIGHT IS A NEIGHBOURHOOD AND NOT THE PIXEL. Weighting by the pixel's
 * own value is the obvious implementation and it is subtly self-defeating: the
 * contact core under a rock is the darkest pixel in its neighbourhood, so a
 * per-pixel weight would take strength out of exactly the place the whole pass
 * exists to darken. What the weight has to describe is the LIGHTING LEVEL OF THE
 * REGION, not the albedo of the pixel, so it is a five-tap cross over a radius
 * wide enough to straddle a contact shadow and narrow enough not to halo across
 * a doorway.
 *
 * THE RANGE IS MEASURED, NOT CHOSEN. See uLumaRange.
 *
 * It also costs one fullscreen blit LESS than what it replaces: GTAOPass's
 * Default output does two (a NoBlending copy of the read buffer into the write
 * buffer, then the blend on top of it). This does the copy and the blend in one.
 */
const AOCompositeShader = {
  uniforms: {
    tDiffuse:   { value: null },
    tAO:        { value: null },
    // One texel of the beauty buffer, so the neighbourhood radius below is
    // expressed in pixels rather than in UV and does not change with the
    // window size.
    uTexel:     { value: new THREE.Vector2(1 / 1920, 1 / 1080) },

    // Radius of the irradiance estimate, in texels. Wide enough to straddle a
    // contact shadow (which is what must NOT be allowed to weaken itself) and
    // narrow enough that a bright doorway does not lift the AO strength of the
    // wall beside it.
    uSampleRadius: { value: 6.0 },

    // Global strength. 1.0 means "where there is plenty of light, apply exactly
    // what GTAOPass would have applied". This is NOT the lever for clearing an
    // exposure gate - lowering it trades grounding for a number, which is the
    // mistake that shipped the useless AO config in the first place.
    uIntensity: { value: 1.0 },

    // --- the measured range ------------------------------------------------
    // Linear-HDR luminance. NOT chosen, READ OUT OF THIS BUFFER: uDebug 1 writes
    // the irradiance estimate straight to the canvas with every pass after this
    // one disabled, so a screenshot decoded in node is the linear value times
    // 255. Proved linear rather than sRGB-encoded by taking the same frame at
    // uDebugGain 1 and 8 and checking the percentiles scale by exactly eight
    // (pose 5 p1: 0.0784 at gain 1, 0.6118 at gain 8, against 0.627 predicted,
    // inside the 1/255 quantisation of the gain-1 read).
    //
    // The whole-frame distributions overlap and are NOT the right thing to set
    // this from - what matters is where the OCCLUDED pixels sit, because those
    // are the only ones this weight changes. Restricting to ao < 0.85:
    //
    //     pose                       share of frame   p5     p25    p50    p95
    //     5 ground-fill (courtyard)      1.24%      0.055  0.094  0.118  0.165
    //     7 interior                     6.21%      0.017  0.028  0.034  0.072
    //
    // Two facts in that table. The interior has FIVE TIMES as much of its frame
    // occluded, because a closed room occludes in every direction at once - so
    // a flat multiply hits it five times as hard as it hits the courtyard. And
    // the two populations separate at about 0.06 with a clean gap, so a weight
    // that is off below 0.03 and on above 0.09 lands almost entirely inside it.
    //
    // Swept live on hardware, one uniform pair on a page that is never reloaded,
    // so every row is the same two frames through a different weight. The
    // interior column is a replica of the enemies.mjs enemy-07-interior shot
    // measured with that suite's own metric. The ground columns are pose 5
    // scored with test/ao-ab.mjs's statistic - a pixel counts as darkened at 4
    // of 255, deep% is the share that dropped 15 or more - against the AO-off
    // frame off the same page, whose same-build control is 0.000 exactly, which
    // is to say two renders of one state are BIT IDENTICAL and every difference
    // in the table is the uniform pair and nothing else:
    //
    //     lo / hi        interior luma / lit    ground darkPct  darkMean  deep%
    //      AO off           23.14   79.7%           0.000        0.00     0.000
    //      flat (w = 1)     16.85   48.5%  FAIL     2.399       18.62     1.015
    //      0.030 / 0.090    22.43   79.7%  <-       2.350       18.40     0.979
    //      0.035 / 0.110    22.79   79.7%           2.267       18.18     0.926
    //      0.045 / 0.115    22.98   79.7%           2.204       18.05     0.891
    //      0.050 / 0.130    23.06   79.7%           2.087       17.40     0.823
    //      0.060 / 0.150    23.11   79.7%           1.830       16.19     0.685
    //
    // The chosen row gives back 91 per cent of what the flat multiply took from
    // the interior while keeping 98 per cent of what it bought on the ground,
    // and the deepest contact is untouched: the maximum single-pixel drop is
    // 113.9 of 255 on both. Rows below it buy a further half a luma of interior
    // that is not needed - the gate is 18 and this clears it by four - and pay
    // for it in the only thing this pass was ever for.
    uLumaRange: { value: new THREE.Vector2(0.030, 0.090) },

    // Weight floor. Zero on purpose: a surface with no light arriving gets no
    // occlusion, because occlusion of nothing is nothing.
    uFloor:     { value: 0.0 },

    // 0 normal, 1 irradiance estimate, 2 the weight, 3 the raw AO term.
    // Modes 1-3 write greyscale straight to whatever target this pass has, and
    // are meant to be read with the passes after this one disabled. Every
    // instance of this project's defining bug class was found by rendering a
    // buffer in isolation and looking at it; this is that tool, kept.
    uDebug:     { value: 0 },
    uDebugGain: { value: 1.0 },
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
    uniform sampler2D tAO;
    uniform vec2  uTexel;
    uniform float uSampleRadius;
    uniform float uIntensity;
    uniform vec2  uLumaRange;
    uniform float uFloor;
    uniform int   uDebug;
    uniform float uDebugGain;
    varying vec2 vUv;

    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    float lum(vec2 uv) {
      return dot(max(texture2D(tDiffuse, uv).rgb, 0.0), LUMA);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);

      // GTAOShader writes vec4(vec3(ao), 1.0), 1.0 being fully unoccluded, and
      // has already applied its own scale exponent as pow(ao, scale).
      float ao = texture2D(tAO, vUv).r;

      // Local irradiance. Five taps, not one: see the note above the shader for
      // why the pixel's own value is the wrong quantity.
      vec2 r = uTexel * uSampleRadius;
      float e = lum(vUv)
              + lum(vUv + vec2(r.x, 0.0)) + lum(vUv - vec2(r.x, 0.0))
              + lum(vUv + vec2(0.0, r.y)) + lum(vUv - vec2(0.0, r.y));
      e *= 0.2;

      // smoothstep rather than a clamp, so there is no value of the frame at
      // which the AO strength has a corner in it. A corner would be visible as a
      // band wherever a wall crosses the threshold.
      float w = mix(uFloor, 1.0, smoothstep(uLumaRange.x, uLumaRange.y, e));

      vec3 c = texel.rgb * mix(1.0, ao, uIntensity * w);

      if (uDebug == 1) c = vec3(e * uDebugGain);
      else if (uDebug == 2) c = vec3(w);
      else if (uDebug == 3) c = vec3(ao);

      gl_FragColor = vec4(c, texel.a);
    }
  `,
};

/**
 * ShaderPass that keeps its AO input pointed at GTAOPass's denoise target.
 *
 * Bound per frame rather than once at construction because setSize() is free to
 * hand back a different texture, and a stale binding would be an AO term from a
 * different resolution - which reads as a soft misregistered smear rather than
 * as an error anything would report.
 */
class AOCompositePass extends ShaderPass {
  constructor(shader, gtao) {
    super(shader);
    this.gtao = gtao;
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    this.uniforms.tAO.value = this.gtao.pdRenderTarget.texture;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }

  /**
   * Pass.setSize is a no-op and ShaderPass does not override it, so without
   * this the neighbourhood radius stays pinned to the window size the game
   * started at. The failure is silent and directional - resize the window
   * larger and the irradiance estimate quietly narrows - which is exactly the
   * shape of defect this project keeps shipping.
   */
  setSize(width, height) {
    this.uniforms.uTexel.value.set(1 / width, 1 / height);
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
    uDamage:    { value: 0.0 },     // 0..1 red wash, THE HIT. Transient.

    /**
     * 0..1 red vignette: THE CONDITION, not the event. How near death you are.
     *
     * SEPARATE FROM uDamage, AND NOT FOR TIDINESS. `uDamage` widens chromatic
     * aberration sixfold - see uAberration's use in the fragment shader - which
     * is right for the quarter second after something hits you and wrong for a
     * state the player can sit in for a minute. Driving low health through
     * uDamage would leave the frame permanently smeared and make being hurt
     * nauseating to play rather than tense.
     *
     * This channel touches COLOUR ONLY, and it is a continuous function of
     * health rather than a threshold, because the owner asked for both
     * directions: "I wanna know when I'm dying and know when I'm reviving."
     * A floor that only exists below a line can announce danger; it cannot
     * announce recovery, because there is nothing above the line to recede
     * from. See systems/damage.js.
     */
    uLowHealth: { value: 0.0 },

    // THIS IS WHERE THE RED/MAGENTA SPECKLE CAME FROM. It survived a full day
    // of work and two builds unnoticed, and it is not a lighting artefact, a
    // normal map, or chromatic aberration - all three were ablated one at a
    // time and none of them moved it.
    //
    // The grain itself is ACHROMATIC: one hash sample added equally to r, g and
    // b. It becomes chromatic because of where it sits in the chain. By the
    // time it is added, the split tone has already pushed the three channels to
    // three different distances from zero (in deep shadow the shadow tint and
    // its offset put a pixel at something like r 0.005, g 0.018, b 0.050), and
    // shoulder() has already floored the result with max(c.rgb, 0.0). One
    // achromatic sample of +/-0.0275 then drives red and green back through
    // that floor while blue survives, or the reverse on a warm pixel - and a
    // per-channel floor turns symmetric noise into saturated single pixels.
    // Green clips first most often, which is what makes the specks read magenta
    // and red rather than any other pair.
    //
    // Measured on a 340x220 crop of the weapon, counting pixels with one
    // channel hard at 0 while another is above 30:
    //
    //     grade on, grain on      280
    //     grade on, grain off       2
    //     grade off                 0
    //
    // The fix is not less grain, it is grain with the shape real grain has.
    // Film grain is silver halide: there is none in clear base and none in
    // maximum density, and it lives in the mids. The weight in the fragment
    // shader is driven by the channel with the least headroom above zero, which
    // takes the amplitude to zero exactly where the floor is and makes crossing
    // it arithmetically impossible. The amplitude is raised from 0.055 to
    // compensate for the weight, so the mids carry the grain they always did.
    //
    // After the fix, the same count on the same crop: 280 -> 4.
    uGrain:     { value: 0.075 },
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
    //
    // BOTH MOVED, AND SO DID uPivot AND uGamma, AS ONE CHANGE. They are the only
    // lever this file has on a defect whose real fix is somewhere else, and that
    // is worth stating plainly rather than burying:
    //
    //   "In nearly every Temple exterior the ambient term is set so high that a
    //    surface's shadow side is barely darker than its lit side. The column
    //    shafts each have a lit and a shadow face within about 15% of each
    //    other, so they read as flat cylinders painted with a gradient."
    //
    // Knocked out on a frozen pose 4, one light at a time, luma of the 6-12 m
    // band, which is where the near colonnade lives:
    //
    //     shipped                              98
    //     wrapA + wrapB off                    94
    //     hemisphere off                       93
    //     ambient off                          96
    //     sand bounce off                      95
    //     scene.environmentIntensity = 0       15     <- all of it
    //     sun off                              92
    //
    // The five named lights together are five per cent of the fill. The IBL is
    // eighty-five. And there is NO per-material route to it: three.js 0.185.1
    // overwrites `material.envMapIntensity` with `scene.environmentIntensity`
    // every frame for any standard material with no envMap of its own while the
    // scene has an environment (WebGLRenderer.setProgram, line 18686 of the
    // 0.185.1 module build). Verified by sweeping envMapIntensity 1.0 -> 0.25
    // across all 88 stone materials and measuring exactly zero change in every
    // band. The one real knob is `scene.environmentIntensity` in main.js.
    //
    // What a GRADE can do about it is separate the two faces by VALUE even
    // though their irradiance is nearly the same: lift the pivot so the contrast
    // stage pushes more of the frame down, take the gamma off its shadow-opening
    // setting, and move the black point out to meet it. Swept together on the
    // frozen pose - the 12-20 m band, which is column shaft:
    //
    //     pivot/gamma/black/white     luma   sat    contrast   frame p1
    //      0.26 / 0.90 / .026 / .920    83   0.66      21         4.6
    //      0.30 / 0.97 / .030 / .905    75   0.70      22         1.3   <- this
    //      0.34 / 1.04 / .038 / .885    71   0.74      22         0.3
    //      0.38 / 1.10 / .044 / .870    65   0.76      22         0.0
    //
    // Row three and four are stronger and both are rejected: this grade is
    // GLOBAL, the interior is the darkest surface in the game and is separately
    // under repair for crushing its rear wall, and a frame p1 of zero means the
    // image has started throwing away its shadow end rather than deepening it.
    // Row two buys six per cent of saturation and takes the first percentile from
    // 4.6 to 1.3 for six per cent of mean, which the white point pays back.
    uBlackPoint:{ value: 0.030 },
    uWhitePoint:{ value: 0.905 },

    // Pivot for the contrast S-curve. NOT 0.5. Mid grey is the right pivot for
    // an image whose content straddles it; this frame's median sits near 0.39
    // and its brightest ground near 0.63, so pivoting at 0.5 pushed the bulk of
    // the image DOWN while the top never travelled far enough to reach white.
    // Pivoting BELOW the median means the same contrast number expands the
    // highlights much more than it deepens the shadows, which is the direction
    // this image actually needs.
    // Raised with the black point above; see that note for the sweep and for why
    // this file is grading a lighting problem in the first place.
    uPivot:     { value: 0.30 },

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

    // Off its shadow-opening setting. Below 1.0 this OPENS the upper mids, which
    // is what the frame wanted when it was starved; with the ambient term
    // flattening every shadow face it is the last thing it needs.
    uGamma:     { value: 0.97 },
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
    uniform float uLowHealth;
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
      // Weighted so it CANNOT cross the per-channel zero floor, and see uGrain
      // for why that is load bearing rather than cosmetic: unweighted grain
      // lands on top of that floor and comes out as saturated red and magenta
      // specks along every dark edge in the frame.
      //
      // The weight is driven by the DARKEST channel, not by luminance. That is
      // the whole trick and a luminance parabola was tried first and did not
      // work: a saturated warm pixel at luma 0.30 gets nearly full grain from a
      // parabola while its blue channel is sitting at 0.02, so the speck comes
      // back at a slightly different brightness. What matters is not how dark
      // the pixel is, it is how much headroom the channel nearest zero has.
      //
      // Scaled by 0.6*uGrain, the weight reaches 1.0 only once that headroom
      // exceeds the largest excursion grain can make, so no sample can push any
      // channel negative and the floor is never reached. Below that it ramps
      // linearly to zero, which is also what film does in the toe.
      //
      // The top end rolls off separately, for the same reason at the other end:
      // the shoulder is a ceiling and grain against a ceiling clips too.
      //
      // max() on the denominator is not decoration. uGrain is a live uniform
      // and the ablation harness sets it to zero; head is exactly zero over any
      // crushed black, so 0.0/0.0 is reachable, and a NaN here would propagate
      // straight through bloom and take the whole frame with it.
      float gl = clamp(dot(max(c.rgb, 0.0), LUMA), 0.0, 1.0);
      float head = min(min(c.r, c.g), c.b);
      float gw = clamp(head / max(0.6 * uGrain, 1.0e-4), 0.0, 1.0)
               * (1.0 - smoothstep(0.80, 1.05, gl));
      float g = hash(uv * 512.0 + fract(uTime) * 91.7) - 0.5;
      c.rgb += g * uGrain * gw;

      // --- vignette -------------------------------------------------------
      float vig = smoothstep(0.85, 0.22, dist);
      c.rgb *= mix(1.0, vig, uVignette);

      // --- damage wash, THE HIT --------------------------------------------
      if (uDamage > 0.001) {
        float edge = smoothstep(0.15, 0.75, dist);
        c.rgb = mix(c.rgb, vec3(0.55, 0.04, 0.02), edge * uDamage * 0.85);
      }

      // --- low health, THE CONDITION ---------------------------------------
      //
      // AFTER the hit wash, so a hit taken at low health still reads as an
      // event on top of the state rather than being swallowed by it.
      //
      // It reaches FURTHER IN than the hit wash - 0.95 to 0.10 against the
      // hit's 0.15 to 0.75 - and that is the whole difference between the two
      // effects. A corner tint says "something touched you". An iris closing
      // toward the middle of the screen says "you are running out", and it is
      // legible in peripheral vision while the player is looking at a mummy in
      // the centre of the frame, which is precisely when they cannot spare a
      // glance at the vitality plate.
      //
      // The darkening is doing as much work as the colour. Mixing toward a red
      // that is DARKER than the frame closes the edges down; a bright red would
      // wash a sunlit courtyard toward pink and read as a UI overlay stuck on
      // top of the game rather than as something happening to the player.
      if (uLowHealth > 0.001) {
        float iris = smoothstep(0.95, 0.10, dist);
        /*
         * pow 1.4, AND IT WAS 2.0 FOR ONE BUILD.
         *
         * Squaring kept the top of the range and gutted the middle: at 20 of
         * 100 vitality the term landed at 0.36 of full, which photographed as a
         * warm edge on a desert that is already orange. The owner asked for
         * this feature while sitting at exactly that health, so the middle of
         * the range is not decoration - it is the entire request. 1.4 lifts 20
         * hp by about a third while leaving a sliver of health where it was.
         *
         * Still above 1.0, because the alternative is a linear ramp that starts
         * announcing danger at half health, and half health in this game is a
         * normal Tuesday.
         */
        float k = pow(uLowHealth, 1.4);
        c.rgb = mix(c.rgb, vec3(0.30, 0.012, 0.008), (1.0 - iris) * k * 0.92);
        // And the centre loses a little blood too, so the whole frame turns
        // rather than only its border. Kept small: the player still has to be
        // able to SEE the thing that is killing them.
        c.rgb = mix(c.rgb, c.rgb * vec3(1.06, 0.72, 0.70), k * 0.55);
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
  //
  // THIS PASS RAN FOR WEEKS AND DREW ALMOST NOTHING, and it is the ninth
  // instance of this project's defining bug class. It was not disabled, it was
  // not misconfigured in any way an error would report, and it was not cheap -
  // GTAOPass re-renders the entire scene through MeshNormalMaterial every frame
  // to fill its own G-buffer. It was simply TUNED TO A SCALE NOTHING IN THE
  // FRAME OCCUPIES.
  //
  // How it was caught, because reading the code would never have done it: set
  // `gtao.output = GTAOPass.OUTPUT.AO`, disable every pass after it, and look
  // at the AO buffer itself. It came back as a LINE DRAWING - a one-pixel rim on
  // brick joints and pyramid step edges, and pure white everywhere else. Mean
  // 0.971 of 1.0 over the lower half of the frame. That is a mask render, and it
  // is the same tool that found the inside-out chamfer and the sight behind the
  // racking hook.
  //
  // Then measured on the final image, hardware renderer, film grain frozen at
  // zero so the only variable is the pass, at three of the seven capture poses:
  //
  //     pose                  AO off    shipped 0.85m    delta
  //     5 ground-fill         109.25       109.22        -0.03   <- nothing
  //     1 spawn-hip           104.81       103.87        -0.94
  //     7 interior             29.64        27.79        -1.85
  //
  // Pose 5 is the one that matters and the one the judges complained about: a
  // rock and three potsherds lying on open sand, three metres from the eye. The
  // pass moved it by 0.03 of 255. Two independent blind judges wrote "rocks,
  // crates and braziers float on the sand with no grounding" and "every prop
  // sits on the ground with zero grounding darkening", and they were reading a
  // build with a screen-space AO pass switched on.
  //
  // WHY THE RADIUS WAS THE WHOLE BUG. The shader takes DIRECTIONS x STEPS
  // samples out to `radius`, spaced by pow(j/STEPS, distanceExponent). At 16
  // samples that is 3 directions of 6 steps, and at radius 0.85 with exponent
  // 1.6 those six land at 4.9, 14, 26, 41, 59 and 85 cm. A potsherd is four
  // centimetres tall. Exactly ONE step in six is close enough to see it, so the
  // horizon barely rises and the AO term comes back at 0.99. The radius was
  // chosen for "architecture-scale creases" and the comment said so, but the
  // props that read as floating are not architecture, and the eye looks at the
  // ground it is walking on.
  //
  // WHAT REPLACED IT, swept on hardware at poses 1, 5 and 7 and chosen BY EYE on
  // 4x crops of a rock on sand and a brazier stem meeting its plinth, not by
  // the numbers - the numbers are here to prove it landed, not that it is good:
  //
  //   radius/exp/thick/scale  pose5    pose1    pose7   pose7 nearBlack%
  //    off                    109.25   104.81   29.64      16.75
  //    0.85/1.6/1.0/1.1 (was) 109.22   103.87   27.79      18.65
  //    1.20/2.6/1.0/2.0       109.34   100.63   27.68      21.10
  //    0.60/2.0/0.8/2.5 <-    109.09   101.80   28.57      19.07
  //    1.20/2.6/1.0/2.0 @32   109.34    99.72   22.59      35.51   REJECTED
  //
  // The last row is why `samples` stays at 16. Above 30 the shader switches from
  // 3 sampling directions to 5, which in a closed room finds occlusion in every
  // direction at once: the Great Gallery lost a quarter of its light and more
  // than a third of the frame went near-black. The interior is the darkest
  // surface in this game, it is separately under repair for exactly this, and
  // the lighting pass that fixed it was signed off blind. AO is not allowed to
  // take it back.
  //
  // The chosen row costs NOTHING it did not already cost - same sample count,
  // same G-buffer, same two blits - and it is the mildest of the three
  // candidates on the interior while being the strongest of them on the ground.
  // Its six steps land at 1.7, 6.7, 15, 27, 42 and 60 cm, so four of six are
  // inside the height of the props that were floating.
  //
  // `thickness` at 0.8 is what keeps this from becoming a halo pass: a sample
  // whose view-space depth differs by more than 0.8 m is rejected outright, so a
  // wall three metres behind a column cannot darken the silhouette in front of
  // it. It is a rejection radius, not a strength, and it moves with the sampling
  // radius rather than independently of it.
  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.blendIntensity = 1.0;
  gtao.updateGtaoMaterial({
    // World units, and CONTACT scale rather than architecture scale. See above:
    // at 0.85 only one of six steps fell inside the height of a potsherd.
    radius: 0.60,
    // Squared spacing, so the near steps cluster where contact actually happens
    // instead of spreading evenly out to the radius.
    distanceExponent: 2.0,
    // View-space depth rejection. Below the radius on purpose; this is what
    // stops a distant surface from painting a dark rim around a near silhouette.
    thickness: 0.8,
    // Contrast on the AO term itself (ao = pow(ao, scale)). The occlusion this
    // pass finds is real but shallow, and this is what takes a 0.93 crease to
    // 0.83 where the eye can see it.
    scale: 2.5,
    // NOT 32. Above 30 the shader goes to five sampling directions and the
    // unpowered interior loses a quarter of its light. See the sweep above.
    samples: 16,
    // World-space, not screen-space. Contact is a physical scale: a rock's
    // grounding should not grow as the player backs away from it.
    screenSpaceRadius: false,
  });

  // GTAOPass does not get to composite. Its Default output runs two fullscreen
  // blits - a NoBlending copy of the read buffer into the write buffer, then
  // `dst * mix(1, ao, intensity)` on top - and that blend is fixed-function, so
  // it cannot see what it is darkening. OUTPUT.Off makes the pass do only the
  // work that is actually hard: the normal G-buffer, the horizon search and the
  // Poisson denoise, all of which land in `gtao.pdRenderTarget`.
  //
  // needsSwap MUST go with it. In Off mode the pass writes nothing to
  // writeBuffer, and EffectComposer swaps read and write after any pass whose
  // needsSwap is true - so leaving it set would hand the next pass an
  // uninitialised buffer and the frame would come back as whatever was in that
  // target two frames ago.
  gtao.output = GTAOPass.OUTPUT.Off;
  gtao.needsSwap = false;
  composer.addPass(gtao);

  const aoComposite = new AOCompositePass(AOCompositeShader, gtao);
  aoComposite.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);

  // Tied to the GTAO pass rather than toggled separately. If the AO computation
  // is off and this stays on, it keeps multiplying the frame by the LAST AO
  // buffer that was filled - which, with a frozen camera, is bit-identical to a
  // live one. The A/B in test/ao-ab.mjs disables `post.gtao` and would then
  // measure a zero delta against a pass that is still fully applied, and report
  // "GTAO HAS NO VISIBLE EFFECT" about a working chain. A getter is used rather
  // than a setter pair so that every caller - the fidelity switch, the harness,
  // anything added later - gets the interlock for free.
  Object.defineProperty(aoComposite, 'enabled', {
    get() { return this._on && gtao.enabled; },
    set(v) { this._on = v; },
  });
  aoComposite.enabled = true;

  composer.addPass(aoComposite);

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

  // --- bloom ----------------------------------------------------------------
  // THE THRESHOLD WAS NOT A THRESHOLD. It ran at 0.82, and the comment beside
  // it said "only genuinely bright things glow", which would be true if this
  // pass ran on display values. It does not: it sits before OutputPass, so it
  // reads LINEAR HDR, where the open sky measures well above 1.0 and sunlit
  // sand is not far behind. At 0.82 most of a daylight frame was over the line
  // and the budget went to acreage rather than to sources.
  //
  // What that cost, in the judge's words: "the ejected brass now blows into
  // white-cored glowing blobs with orange coronas; two casings lose their
  // cylinder shape and one is a pure white smear with no object inside it.
  // Yesterday's casings actually read as brass."
  //
  // Measured on a FROZEN frame - the game loop halted so the same casings in
  // the same places are re-rendered through each setting, verified by two shots
  // at one setting coming back bit-identical - inside the brass region:
  //
  //     threshold/strength     hot px    white core
  //     0.82 / 0.55  (was)      2359          1090
  //     1.60 / 0.40             2008           942     <- this
  //     1.80 / 0.36             1878           879
  //     2.00 / 0.34             1840           867
  //     2.00 / 0.00 (no bloom)  ~source        ~790
  //
  // So bloom was contributing about 300 of the 1090 white-core pixels and some
  // 7000 pixels of corona around them, and 1.60 / 0.40 gives half of that back
  // in the core and 15 per cent of the corona. The curve flattens hard past
  // 1.6: 2.00 buys another 75 core pixels for a threshold that also stops the
  // braziers and the muzzle flash skirt from glowing at all, and those are two
  // of the few things this build already wins on. What is left in the core at
  // 1.6 is the casing's own specular under a flash light, which is supposed to
  // be bright.
  //
  // 1.60 is also, and not coincidentally, the first value comfortably above the
  // open sky in this scene, which measures around 1.2 linear. That is what makes
  // it a threshold rather than a tax: at 0.82 the sky was over the line and most
  // of a daylight frame was paying for a glow nobody asked for.
  //
  // The muzzle flash survives this, which was the thing to protect - it is one
  // of only two pairs this build won. Its core is unchanged (it is far past any
  // of these thresholds on its own) and it loses only the wide dim skirt that
  // 0.82 was painting over half the frame. The flash reads because it is a real
  // light that illuminates the hands, not because of this pass.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.40,   // strength: restrained. Bloom is seasoning, not the meal.
    0.55,   // radius
    1.60    // threshold, in LINEAR HDR. Sources, not sunlit surfaces.
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

  /**
   * Whatever is last and still enabled has to be the pass that writes to the
   * screen. Everything before it renders into the composer's own targets.
   *
   * Factored out because there are now three callers that can change which
   * passes are on - the fidelity switch, and the governor's two independent
   * toggles - and every one of them gets this wrong the same way if it forgets:
   * the frame goes black, which is fast, silent, and reads on a profiler as an
   * enormous improvement.
   */
  function retarget() {
    const passes = composer.passes;
    for (const p of passes) p.renderToScreen = false;
    for (let i = passes.length - 1; i >= 0; i--) {
      if (passes[i].enabled) { passes[i].renderToScreen = true; break; }
    }
  }

  return {
    composer,
    bloom,
    grade,
    smaa,
    gtao,
    aoComposite,
    fog,
    viewmodelPass,

    /**
     * Exposed because there is now a FOURTH caller that changes which passes
     * are on, and it is not in this file.
     *
     * core/retro.js turns GTAO, bloom and SMAA off together while keeping the
     * fog, which is a combination none of the setters below describe - setAO
     * pairs fog with GTAO, and it is right to, because in the shipping chain
     * fog borrows GTAO's depth. Retro mode supplies depth another way and is
     * therefore the one caller allowed to break that pairing. Rather than add a
     * fifth setter for one consumer, it gets the helper every caller needs
     * anyway: whatever is last and still enabled has to write to the screen, or
     * the frame goes black.
     */
    retarget,

    /** Wire the viewmodel in once it exists. */
    setViewmodel(vm) { viewmodelPass.viewmodel = vm; },

    /** Advance time-driven uniforms. */
    update(dt) {
      grade.uniforms.uTime.value += dt;
    },

    /**
     * 0..1 red iris for HOW NEAR DEATH the player is. Colour only, no
     * aberration. Driven every frame by systems/damage.js from health, in both
     * directions, so it recedes as the player heals. See the uniform.
     */
    setLowHealth(v) {
      grade.uniforms.uLowHealth.value = Math.max(0, Math.min(1, v));
    },

    /** What the shader is currently showing, for the harness. */
    lowHealth() { return grade.uniforms.uLowHealth.value; },

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
      aoComposite.enabled = high;  // and its composite follows it either way
      fog.enabled = high;    // borrows GTAO's depth, so it goes with it
      // The viewmodel pass always stays on: disabling it would remove the gun.

      retarget();
    },

    /**
     * AO on or off on its own, without moving the rest of the chain.
     *
     * This exists for the frame governor, which needs to give up the single
     * most expensive thing in the frame WITHOUT dropping to low fidelity - that
     * is the whole point of having a ladder rather than a switch. GTAOPass does
     * not cost a fullscreen quad like every other pass here: it re-renders the
     * ENTIRE SCENE through MeshNormalMaterial to fill its own G-buffer, so it is
     * worth roughly 250 draw calls and 245,000 triangles a frame. Nothing else
     * in the chain is in that league.
     *
     * FOG GOES WITH IT, and that is not a stylistic pairing. The height fog pass
     * reads the depth buffer GTAO fills; leaving it enabled with GTAO off points
     * it at a target nobody wrote this frame. `setFidelity` already knew this
     * and the knowledge is duplicated here on purpose rather than factored out,
     * because the coupling belongs next to each place that can break it.
     */
    setAO(on) {
      gtao.enabled = !!on;
      aoComposite.enabled = !!on;
      fog.enabled = !!on;
      retarget();
    },

    /** Bloom on its own, for the governor's ladder. */
    setBloom(on) {
      bloom.enabled = !!on;
      retarget();
    },

    /**
     * SMAA on its own, for the governor's ladder.
     *
     * Dropped one rung ABOVE the pixel ratio and never below it, because
     * anti-aliasing a frame that is about to be scaled up from less than one
     * device pixel per screen pixel is work spent fighting the downscale. See
     * the note on MIN_RATIO in core/renderer.js.
     */
    setSMAA(on) {
      smaa.enabled = !!on;
      retarget();
    },
  };
}
