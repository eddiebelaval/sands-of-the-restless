/**
 * RETRO RENDER MODES: two consoles, one pipeline, one key.
 *
 * The point of this file is a COMPARISON the owner can feel. One key cycles the
 * whole renderer between the shipping look, a 1997 PlayStation look and a 1996
 * Nintendo 64 look, in place, without a reload and without moving the player, so
 * the visual difference and the frame-time difference are the same experiment.
 * Everything here is reversible by construction: nothing is destroyed, only
 * swapped and put back.
 *
 * ---------------------------------------------------------------------------
 * THE TWO CONSOLES ARE OPPOSITES, AND THAT IS THE WHOLE REASON FOR BOTH
 * ---------------------------------------------------------------------------
 *
 * It is tempting to read N64 as "PS1 but nicer" and build it as a quality
 * setting. That is wrong and it would produce a mode nobody could tell apart
 * from the first one. The two machines failed in OPPOSITE directions:
 *
 *                          PS1                      N64
 *   sub-pixel precision    none, geometry wobbles   has it, geometry is still
 *   perspective correct    no, textures swim        yes, textures lie flat
 *   texture filtering      nearest, hard pixels     BILINEAR, soft and blurry
 *   anti-aliasing          none, jagged             hardware AA, soft edges
 *   depth                  no z-buffer, sort pops   z-buffer, clean
 *   colour                 5-bit, heavy dither      more levels, little dither
 *   fog                    period correct           HEAVIER, its signature
 *
 * So structurally the N64 preset is this file's PS1 preset with the deliberate
 * artefacts REMOVED, plus one thing added: a smooth upscale. The blur is the
 * signature. If it comes out sharp, it is wrong.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE SYSTEM WITH A PRESET TABLE RATHER THAN TWO MODES
 * ---------------------------------------------------------------------------
 *
 * Every difference between the two consoles above is a NUMBER, not a different
 * pipeline: a resolution, a filter, a jitter strength, an affine strength, a
 * level count, a dither strength, a fog multiplier, an AA flag. So the presets
 * are data and there is exactly one implementation underneath them.
 *
 * That is not only tidiness. It buys a property that matters at the keyboard:
 * BOTH PRESETS COMPILE TO THE SAME SHADER. The jitter and the affine warp are
 * driven by uniforms rather than by string substitution, so switching PS1 to
 * N64 writes two floats and does not recompile ninety materials. A mode switch
 * that hitches is a mode switch the owner cannot A/B, and the whole feature is
 * an A/B.
 *
 * ---------------------------------------------------------------------------
 * WHY IT PATCHES AT RUNTIME
 * ---------------------------------------------------------------------------
 *
 * The obvious implementation is to author retro materials next to the real ones
 * in world/materials.js. That is the wrong shape twice over: it puts a second
 * copy of every material in a file whose job is to describe THIS game's
 * surfaces, and every new prop anyone adds has to remember to author its retro
 * twin or it silently keeps the modern look.
 *
 * So this walks the live scene graph and patches whatever it finds, through
 * `material.onBeforeCompile`. A prop added next week is picked up with no work,
 * the files that define the world never learn that these modes exist, and the
 * feature can be deleted by deleting one file and three call sites.
 */

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { setRetroHeight, resolutionScale } from './renderer.js';

/**
 * THE PRESETS. Every difference between the two eras lives here as data.
 *
 * `height`  internal render height in lines. The width follows the window's
 *           aspect rather than being fixed, because a 4:3 target letterboxed
 *           into a widescreen window would either stretch the image or crop the
 *           player's field of view, and both are worse lies than a widescreen
 *           frame at console line count.
 * `filter`  what the compositor does on the way up. THIS IS THE SINGLE BIGGEST
 *           difference between the two presets.
 * `jitter`  0..1 strength of the clip-space vertex snap.
 * `affine`  0..1 blend from perspective-correct to screen-linear texture uv.
 * `levels`  colour levels per channel.
 * `dither`  0..1 strength of the ordered dither.
 * `fog`     multipliers on the height fog: extinction, and where the near ramp
 *           reaches full strength.
 * `smaa`    whether anti-aliasing is put back in the chain. See the note on the
 *           N64 preset: it is false for both, and that was measured rather than
 *           assumed.
 */
const PRESETS = {
  /**
   * 1997. 240 lines was the console's own number; 270 is what a 16:9 window
   * wants. Everything else is the machine's limitations reproduced faithfully.
   */
  ps1: {
    id: 'ps1',
    name: 'PS1',
    height: 270,
    filter: 'nearest',
    jitter: 1.0,
    affine: 1.0,
    levels: 32,
    dither: 1.0,
    fog: { sigma: 1.0, nearEnd: 1.0 },
    smaa: false,
    notice: 'PS1 mode - 270 lines, hard pixels, vertex wobble, warped textures',
  },

  /**
   * 1996, and almost every field is the opposite of the row above.
   *
   * THE RESOLUTION IS TWICE PS1'S, AND THE FIRST ATTEMPT GOT THIS BADLY WRONG.
   *
   * It shipped at 270 lines - the same buffer as PS1 - for a reason that was
   * about MEASURING rather than about playing: at an identical buffer the two
   * presets differ by exactly one visible thing, so the frame-time gap between
   * them was the mode's own cost rather than a resolution change wearing a
   * mode's name, and the mean-run statistic became an exact discriminator.
   *
   * The owner played it and said: "why is it so blurry?" He was right, and the
   * mistake is worth naming precisely because it is easy to make again. At 270
   * lines into a 1440-wide window, bilinear performs a 3.2x magnification, so
   * every source pixel becomes a 3x3 smear. That is not softness, it is out of
   * focus. The real machine put the same filtering on a CRT at close to its
   * output resolution; a modern panel magnifying 3.2x is a different operation
   * wearing the same name.
   *
   * THE BLUR IS SUPPOSED TO COME FROM THE FILTER, NOT FROM AN ABSENCE OF
   * PIXELS, and the two had been conflated.
   *
   * Re-tuned by looking, at the wall pose, against one test: can the masonry
   * courses and the carved bands be READ at mid distance while the edges stay
   * soft. 270 fails it outright - the carvings are mush. 480 passes but the
   * bands are indistinct. 640 passes easily and by then the magnification is
   * 1.34x, at which point it stops reading as a console and starts reading as a
   * slightly soft modern frame. 540 lines is 904x540, a 1.59x magnification:
   * the courses are comfortably legible, the carved figures resolve, and the
   * texel boundaries still visibly smear.
   *
   * The cost of being right is that N64 now renders 2.7x the pixels PS1 does,
   * so the frame-time gap between the two presets is a resolution difference
   * PLUS a filter difference and no longer isolates either. That is a real loss
   * of measurement precision and it is the correct trade: the owner is playing
   * the mode, not measuring it. docs/RETRO-LOOK.html says so beside the table.
   *
   * THE FOG IS THE OTHER SIGNATURE and it is doing two things at once. The
   * extinction is nearly doubled AND the near ramp is pulled in to a bit over
   * half its distance, because what people remember is not thicker haze on the
   * horizon, it is haze that starts CLOSE - that machine's whole draw-distance
   * strategy was to hide the middle of the level.
   */
  n64: {
    id: 'n64',
    name: 'N64',
    height: 540,
    filter: 'linear',
    jitter: 0.0,
    affine: 0.0,
    levels: 128,
    dither: 0.15,
    fog: { sigma: 1.9, nearEnd: 0.55 },

    /**
     * NO ANTI-ALIASING, AND THIS IS THE ONE FIELD THAT LOOKS WRONG.
     *
     * That console had hardware AA and it is a real part of why its output
     * reads soft, so putting SMAA back for this preset was a live question
     * rather than an obvious no. It was answered with two measurements instead
     * of a preference.
     *
     * IT WAS MEASURED TWICE, because the reason for the first answer stopped
     * applying when the resolution changed. At 270 lines the argument was that
     * SMAA ran before a 3.2x magnification, so every edge it softened was
     * averaged away by the blow-up. At 540 the magnification is 1.59x and that
     * argument genuinely weakens, so carrying the old conclusion forward would
     * have been laziness dressed as consistency.
     *
     * WHAT IT COSTS at 540, on a quiet machine: 0.10 ms, 1.50 to 1.60 at the
     * avenue pose. Cheap - cheaper than the 0.6 ms measured at 270, which was a
     * loaded machine rather than a real difference.
     *
     * WHAT IT BUYS at 540: 1.329 mean absolute difference inside the 1:1 wall
     * crop, the frame where it should show most. That is LESS than the 2.085 it
     * bought at 270, and the direction is the point: at a higher internal
     * resolution there are fewer aliased edges per screen pixel to begin with,
     * so there is less for an anti-aliaser to find. Put the two crops side by
     * side and they are indistinguishable.
     *
     * So the answer is unchanged and the reason for it is not. It is no longer
     * a cost argument at all - a tenth of a millisecond is affordable - it is
     * that the pass has nothing visible left to do. The instruments are
     * .scratch/retro/isolate.mjs for the cost and .scratch/retro/tune-aa.mjs
     * for the picture; both keep working if anyone wants to re-open it again.
     */
    smaa: false,

    notice: 'N64 mode - 540 lines, bilinear blur, no wobble, flat textures, heavy fog',
  },
};

/** The cycle order the key walks, and the order the panel lists. */
const ORDER = ['off', 'ps1', 'n64'];

/**
 * How coarse the vertex snap is, as a multiple of the render pixel.
 *
 * 1.0 means "snap to the pixel grid the frame is actually being drawn on",
 * which is what the hardware did. Above 1 the wobble reads as a bug rather than
 * as a machine; below 1 it disappears at this resolution.
 */
const JITTER_COARSENESS = 1.0;

// ---------------------------------------------------------------------------
// the shader injections
// ---------------------------------------------------------------------------

/**
 * Declarations added to both stages of every patched material.
 *
 * `vRetroW` is the clip-space w, interpolated perspective-correctly by the
 * rasteriser, which is what makes the affine trick below work. `vRetroMapUv` is
 * the diffuse uv pre-multiplied by that same w.
 */
const RETRO_PARS_VERTEX = /* glsl */`
uniform vec2  uRetroGrid;
uniform float uRetroJitter;
varying float vRetroW;
varying vec2  vRetroMapUv;
`;

const RETRO_PARS_FRAGMENT = /* glsl */`
uniform float uRetroAffine;
varying float vRetroW;
varying vec2  vRetroMapUv;
`;

/**
 * The vertex snap, injected immediately after `#include <project_vertex>` -
 * that chunk is where `gl_Position` comes into existence, and nothing after it
 * in the standard vertex shader reads `gl_Position.xy` for anything but the
 * rasteriser.
 *
 * The maths: `gl_Position.xy / w` is normalised device coordinates spanning
 * -1..1 across the viewport, so multiplying by half the render resolution puts
 * it in pixels. Floor, then undo both, and the vertex lands on a whole pixel.
 * Multiplying back by w keeps the perspective divide the rasteriser is about to
 * do from undoing the snap.
 *
 * THE STRENGTH IS A UNIFORM AND THE MIX IS WHY BOTH PRESETS SHARE ONE PROGRAM.
 * At uRetroJitter 0 this is the identity and the N64 preset gets the sub-pixel
 * precision its hardware had, without a second shader variant and without a
 * recompile when the player switches.
 *
 * THE GUARD IS NOT DECORATION. A vertex on the camera plane has w of exactly
 * zero and the division is a NaN, which does not clip - it propagates into the
 * rasteriser and takes whole triangles with it, intermittently, on geometry
 * that happens to graze the near plane.
 *
 * THE AFFINE HALF. Perspective-correct interpolation of an attribute a gives
 * (sum L*a/w) / (sum L/w) for screen-space barycentrics L. Feed it a = uv*w and
 * it returns (sum L*uv) / (sum L/w); feed it a = w and it returns 1/(sum L/w).
 * Divide the first by the second and the w terms cancel exactly, leaving
 * sum L*uv, which IS the screen-space linear interpolation the PlayStation did.
 * So the warp is not an approximation of affine mapping, it is affine mapping -
 * and the N64 preset turns it off by setting one uniform to zero, which is
 * exactly what that machine's perspective-correcting rasteriser did for real.
 *
 * WHY NOT `noperspective`. That qualifier is the one-word version of all of
 * this and it does not exist here. three.js 0.185.1 compiles its built-in
 * materials as GLSL ES 3.00 (verified in the module build: it prepends
 * `#version 300 es` plus `#define varying in` for every material that is not a
 * RawShaderMaterial), and the OpenGL ES Shading Language 3.00 specification
 * carries only `smooth`, `flat` and `centroid` - `noperspective` is a RESERVED
 * word in ES, not a supported one. Checked against the shipped three.js source
 * and then against the driver by compiling a probe shader, which comes back
 * `ERROR: 0:3: 'noperspective' : Illegal use of reserved word` on ANGLE Metal.
 */
const RETRO_VERTEX_TAIL = /* glsl */`
  vRetroW = gl_Position.w;

  #ifdef USE_MAP
    vRetroMapUv = vMapUv * gl_Position.w;
  #endif

  if (uRetroJitter > 0.0 && abs(gl_Position.w) > 1.0e-5) {
    vec2 ndc = gl_Position.xy / gl_Position.w;
    vec2 snapped = floor(ndc * uRetroGrid + 0.5) / uRetroGrid * gl_Position.w;
    gl_Position.xy = mix(gl_Position.xy, snapped, uRetroJitter);
  }
`;

/**
 * The uv the diffuse lookup actually uses, blended between the two behaviours.
 *
 * Declared after `#include <uv_pars_fragment>` rather than after `<common>`,
 * because `vMapUv` does not exist until that chunk has been expanded and a
 * function referencing it earlier will not compile. Wrapped in the same
 * `USE_MAP` guard the varying itself carries, for the same reason.
 *
 * max() on the denominator is not decoration: at uRetroAffine 0 the affine term
 * is multiplied by zero, and zero times an infinity is a NaN, not a zero. A
 * NaN uv reads a garbage texel and the pixel comes back black, intermittently,
 * only on geometry near the camera plane, only in the mode where the warp is
 * supposed to be OFF. That is a bug that would have been blamed on anything but
 * this line.
 */
const RETRO_UV_FN = /* glsl */`
#ifdef USE_MAP
  vec2 retroMapUv() {
    vec2 affine = vRetroMapUv / max(abs(vRetroW), 1.0e-6);
    return mix(vMapUv, affine, uRetroAffine);
  }
#endif
`;

/**
 * The diffuse map lookup, re-expressed through that function.
 *
 * This replaces `#include <map_fragment>` with three.js's own chunk text, with
 * one substitution in it. Copying the chunk rather than re-authoring it means
 * the sRGB decode and the DECODE_VIDEO_TEXTURE branch keep working and keep
 * tracking whatever three.js does with them next version.
 *
 * ONLY THE DIFFUSE MAP IS MADE AFFINE, and that is a deliberate stopping point
 * rather than an oversight. The same treatment for the normal, roughness and
 * ambient-occlusion maps would need one varying pair each, and at 452x270 a
 * normal map contributes detail below the size of a pixel. The warp is a
 * DIFFUSE-texture artefact in every reference frame of the era, because that is
 * the only map those machines had.
 */
function affineMapFragment() {
  return THREE.ShaderChunk.map_fragment
    .split('vMapUv').join('retroMapUv()');
}

// ---------------------------------------------------------------------------
// the passes
// ---------------------------------------------------------------------------

/**
 * COLOUR QUANTISATION AND AN ORDERED DITHER.
 *
 * Runs last, after the grade, because quantisation is a DISPLAY-referred
 * operation: it describes what the framebuffer could hold, so everything that
 * decides what the image looks like has to have happened already. Putting it
 * before the tone mapper would quantise linear HDR, where five bits is a
 * catastrophe rather than an era.
 *
 * The dither is a 4x4 Bayer matrix read straight off `gl_FragCoord`, which is
 * correct here and would not be if the upscale were happening inside the
 * composer: this pass runs at the RENDER resolution, so one dither cell is one
 * render pixel and the compositor's blow-up carries the pattern up with the
 * image at the same scale as everything else. A dither computed at output
 * resolution would be a fine screen door over a chunky image, which is a modern
 * artefact rather than a console one.
 *
 * BOTH PRESETS USE THIS PASS, at different settings, and that is the honest
 * shape: the N64 had a deeper framebuffer and dithered far less, not never.
 */
const RetroQuantiseShader = {
  uniforms: {
    tDiffuse: { value: null },
    // Levels per channel. The PS1's framebuffer was 15-bit, five bits per
    // channel plus a transparency mask; the N64's was deeper.
    uLevels:  { value: 32 },
    // 0 disables the dither and leaves flat quantisation, which is worth having
    // as an A/B: it is how you prove the dither is doing anything at all.
    uDither:  { value: 1.0 },
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
    uniform float uLevels;
    uniform float uDither;
    varying vec2 vUv;

    /**
     * 4x4 Bayer, as arithmetic rather than as a const array.
     *
     * Dynamic indexing of a const array is legal in GLSL ES and has been a
     * source of driver bugs for a decade, so this uses the closed form of the
     * recursive construction instead. bayer2 produces
     *
     *     0  2        0.00  0.50
     *     3  1   /4 = 0.75  0.25
     *
     * and one level of the recursion - a quarter of the coarser matrix laid
     * over the finer one - produces the 4x4. Returns [0, 1).
     */
    float bayer2(vec2 a) {
      a = floor(a);
      return fract(a.x * 0.5 + a.y * a.y * 0.75);
    }

    float bayer4(vec2 a) {
      return bayer2(a * 0.5) * 0.25 + bayer2(a);
    }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      float steps = max(uLevels - 1.0, 1.0);
      float d = bayer4(gl_FragCoord.xy);

      // floor(x * steps + d) / steps. The dither offset decides which side of a
      // step boundary a pixel falls on, so a gradient that would band into flat
      // plateaus breaks into an alternating pattern of the two nearest levels
      // instead. Amplitude is exactly one level by construction, which is the
      // most a dither may ever add without becoming noise.
      vec3 q = floor(c.rgb * steps + mix(0.5, d, uDither)) / steps;

      gl_FragColor = vec4(clamp(q, 0.0, 1.0), c.a);
    }
  `,
};

/**
 * KEEPING THE FOG WITHOUT KEEPING GTAO.
 *
 * core/fog.js reads scene depth, and in the shipping chain it borrows the depth
 * texture GTAOPass fills as a side effect of its own G-buffer. That coupling is
 * documented in both files and `post.setAO` enforces it by turning fog off with
 * GTAO - because a fog pass reading a depth buffer nobody wrote this frame
 * hazes the scene by the shape of wherever the camera USED to be, which is a
 * defect that looks like a smear rather than like an error.
 *
 * Both retro modes need GTAO gone and fog kept - and N64 needs it MORE than
 * PS1, since heavy fog is that machine's signature. The three candidates:
 *
 *   1. Let HeightFogPass render its own depth-only G-buffer. It has that
 *      fallback. It costs a whole extra geometry pass - about 250 draw calls -
 *      which is most of what turning GTAO off just bought back.
 *   2. Render a depth prepass here. Same cost, plus a second copy of the code.
 *   3. THIS. Attach a depth texture to the composer's own colour buffers, so
 *      the beauty pass fills depth as a side effect of drawing the scene, which
 *      it was going to do anyway. Zero extra geometry.
 *
 * The reason fog.js did not do (3) itself is written in its header and it is a
 * real objection: `RenderTarget.copy()` CLONES a depth texture rather than
 * sharing it, so the composer's two ping-pong buffers end up with two different
 * depth attachments, and which one the beauty pass drew into depends on how
 * many swapping passes ran before it - which changes every time the pass list
 * changes.
 *
 * This pass answers that objection by not reasoning about it at all. It sits
 * immediately before the fog pass with `needsSwap = false`, so the buffer the
 * composer hands it as `readBuffer` is, by definition, the same one it is about
 * to hand the fog pass. It reads the depth texture off THAT buffer and points
 * the fog shader at it. No bookkeeping, no assumption about the rest of the
 * chain, and it stays correct if somebody inserts another pass upstream.
 *
 * It draws nothing.
 */
class RetroDepthBindPass extends Pass {
  constructor(fog) {
    super();
    this.fog = fog;
    this.needsSwap = false;
    /** Set false if a buffer ever arrives without a depth texture. */
    this.bound = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    const depth = readBuffer && readBuffer.depthTexture;
    if (!depth) { this.bound = false; return; }
    this.fog.uniforms.tDepth.value = depth;
    this.bound = true;
  }
}

// ---------------------------------------------------------------------------
// the modes
// ---------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {HTMLCanvasElement} o.canvas
 * @param {object} o.post          the object core/post.js returns
 * @param {object} [o.viewmodel]   player/viewmodel.js, so the gun gets it too
 * @param {object} [o.governor]    core/governor.js, told to stand down
 * @param {function} [o.onChange]  called with the new mode id after every switch
 */
export function createRetro({
  renderer, scene, canvas, post, viewmodel, governor, onChange,
}) {
  /** 'off' | 'ps1' | 'n64'. */
  let mode = 'off';

  /**
   * The uniforms every patched material shares, as ONE object each.
   *
   * Shared rather than per-material on purpose: three.js reads a uniform's
   * `value` at draw time off whatever object the shader was given, so handing
   * every program the same object means switching presets updates ninety
   * materials by writing one number. The alternative is a list to walk and a
   * list to forget to update.
   *
   * This is also what makes a preset switch free. Nothing here changes the
   * SHADER, so nothing recompiles: PS1 to N64 is three float writes.
   */
  const uGrid = { value: new THREE.Vector2(240, 135) };
  const uJitter = { value: 0 };
  const uAffine = { value: 0 };

  /** Materials this system has patched, and what they looked like before. */
  const patched = new Map();

  /**
   * The render state as it was when the first retro mode was switched on.
   *
   * Snapshotted rather than assumed, because the governor may have already
   * turned some of these off by the time the player presses the key, and a
   * switch that "restores" a state the game was never in is a one-way door
   * wearing a two-way label. Taken once on the way IN from modern, and not
   * touched again when moving between retro presets.
   */
  let restore = null;

  // --- the passes these modes add ------------------------------------------

  const quantise = new ShaderPass(RetroQuantiseShader);
  quantise.enabled = false;

  const depthBind = new RetroDepthBindPass(post.fog);
  depthBind.enabled = false;

  // Insert the depth binder immediately before the fog pass, and the quantiser
  // at the very end. insertPass rather than addPass for the first, because
  // position is the whole of its contract.
  const fogIndex = post.composer.passes.indexOf(post.fog);
  post.composer.insertPass(depthBind, fogIndex >= 0 ? fogIndex : 0);
  post.composer.addPass(quantise);

  /**
   * The fog's authored settings, read once so the presets can scale them.
   *
   * Read here rather than hardcoded because core/fog.js's numbers are the
   * product of a long measured sweep and they will move again. A preset that
   * said "sigmaE 16.1e-3" would silently stop being a multiple of the shipping
   * fog the first time that file is retuned.
   */
  const fogBase = {
    sigma: post.fog.uniforms.uSigmaE.value,
    nearEnd: post.fog.uniforms.uNearEnd.value,
  };

  /**
   * The upscale filter, injected from here rather than declared in index.html.
   *
   * index.html is owned by another lane this week, and a two-line style rule is
   * not worth a merge conflict. It also keeps the whole feature deletable by
   * deleting this file.
   *
   * `pixelated` is the PS1 half. The N64 half is `auto`, which is the browser's
   * normal smooth upscale and IS the bilinear filter the mode is about - there
   * is no cheaper or more honest way to get it, because scaling a canvas is
   * exactly what the compositor is for. Both are written explicitly rather than
   * leaving one class off, so that reading the DOM tells you which mode is live.
   */
  const style = document.createElement('style');
  style.textContent =
    '#stage.retro-nearest { image-rendering: pixelated; }\n' +
    '#stage.retro-linear { image-rendering: auto; }';
  document.head.appendChild(style);

  // -------------------------------------------------------------------------
  // material patching
  // -------------------------------------------------------------------------

  /**
   * Which materials get the treatment.
   *
   * ShaderMaterial is excluded and that exclusion is doing real work: the sky
   * dome is one, and its vertex shader has no `#include <project_vertex>` for
   * the snap to attach to. A no-op would be harmless; what would not be is a
   * silent half-patch on a material whose shader this file does not understand.
   * The same goes for sprites and points, which have their own vertex path.
   */
  function patchable(m) {
    if (!m || m.isShaderMaterial || m.isRawShaderMaterial) return false;
    if (m.isSpriteMaterial || m.isPointsMaterial || m.isLineBasicMaterial) return false;
    return !!(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial
      || m.isMeshLambertMaterial || m.isMeshPhongMaterial
      || m.isMeshBasicMaterial || m.isMeshToonMaterial);
  }

  function patch(m) {
    if (patched.has(m)) return;

    // hasOwnProperty rather than a truthiness test, because Material.prototype
    // carries a no-op onBeforeCompile: reading it always returns a function, so
    // "was there one" and "restore what was there" are different questions and
    // only the own property answers both.
    const hadOwnCompile = Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile');
    const hadOwnKey = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey');
    const prevCompile = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey;

    patched.set(m, { hadOwnCompile, hadOwnKey, prevCompile, prevKey });

    /**
     * The previous hook is CHAINED, not replaced. world/weathering.js owns
     * onBeforeCompile on every stone material in the game - grime at the base of
     * a wall, sun bleach on the top, world-space mottling that stops the tile
     * from repeating - and dropping it would change the look of both modes in
     * ways that have nothing to do with either era.
     */
    m.onBeforeCompile = function retroOnBeforeCompile(shader, rendererRef) {
      if (prevCompile) prevCompile.call(this, shader, rendererRef);

      shader.uniforms.uRetroGrid = uGrid;
      shader.uniforms.uRetroJitter = uJitter;
      shader.uniforms.uRetroAffine = uAffine;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${RETRO_PARS_VERTEX}`)
        .replace('#include <project_vertex>',
          `#include <project_vertex>\n${RETRO_VERTEX_TAIL}`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${RETRO_PARS_FRAGMENT}`)
        .replace('#include <uv_pars_fragment>',
          `#include <uv_pars_fragment>\n${RETRO_UV_FN}`)
        .replace('#include <map_fragment>', affineMapFragment());
    };

    /**
     * THE CACHE KEY IS THE TRAP IN THIS WHOLE FILE, and it has to be set by
     * hand.
     *
     * three.js keys its compiled programs on `customProgramCacheKey()`, which by
     * default returns `onBeforeCompile.toString()`. Two things break that here
     * at once. First, the function above is a closure, and every closure from
     * one piece of source has the SAME source text - so two materials with
     * different chained hooks would produce identical keys and three.js would
     * happily hand the second one the first one's program. Second,
     * weathering.js already overrides the key with a constant string, which
     * means swapping the hook would not change the key at all and the material
     * would keep the program it was compiled with - the patch would run and
     * nothing would appear. That is this project's defining bug class, arrived
     * at through a caching layer instead of through a render target.
     *
     * So the key carries the ORIGINAL key inside it. Distinct variants stay
     * distinct, and a retro variant can never collide with its own modern one.
     *
     * There is deliberately NO preset in this key. Both presets compile to the
     * same program and differ only by uniform values, which is what makes
     * switching between them free.
     */
    const inner = hadOwnKey ? prevKey.call(m) : (hadOwnCompile ? prevCompile.toString() : 'plain');
    m.customProgramCacheKey = () => `retro:v2:${inner}`;

    m.needsUpdate = true;
  }

  function unpatch(m, saved) {
    if (saved.hadOwnCompile) m.onBeforeCompile = saved.prevCompile;
    else delete m.onBeforeCompile;

    if (saved.hadOwnKey) m.customProgramCacheKey = saved.prevKey;
    else delete m.customProgramCacheKey;

    m.needsUpdate = true;
  }

  /** Every material reachable from a root, including hidden subtrees. */
  function eachMaterial(root, fn) {
    if (!root) return;
    root.traverse((o) => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) { for (const one of m) if (patchable(one)) fn(one); return; }
      if (patchable(m)) fn(m);
    });
  }

  /**
   * Walk the world and the viewmodel and bring every material into line.
   *
   * The viewmodel is included deliberately. It is a separate scene rendered by
   * its own pass, so it does not come along for free, and a jittering world
   * behind a perfectly smooth weapon is the one composition that would give the
   * whole effect away - the gun is a quarter of the frame.
   */
  function sweep() {
    eachMaterial(scene, patch);
    if (viewmodel && viewmodel.scene) eachMaterial(viewmodel.scene, patch);
  }

  /**
   * RE-SWEEP WHILE A MODE IS LIVE, because the scene is not finished.
   *
   * The wave director builds enemies during play and the mystery box builds
   * weapons, so a one-shot patch at switch time would leave every enemy that
   * spawned afterwards rendering modern in the middle of a retro world.
   *
   * MEASURED BEFORE IT WAS BELIEVED, because a per-frame walk of the scene graph
   * is exactly the kind of bookkeeping that quietly eats the saving these modes
   * exist to produce. One full sweep of this scene - 1548 nodes, 149 patchable
   * materials, a Map lookup each - costs 0.15 ms, so at one sweep in thirty
   * frames it is 0.005 ms a frame against a frame that measures 1.10. That is
   * under half a per cent, and an enemy that spawns is wearing the mode within
   * half a second. The instrument that says so is .scratch/retro/isolate.mjs,
   * which nulls this entirely as one of its rows.
   *
   * Driven off the quantise pass, which is the one thing in this file that is
   * guaranteed to run exactly once per rendered frame while a mode is on.
   */
  let sinceSweep = 0;
  let sweepEvery = 30;
  const baseQuantiseRender = quantise.render.bind(quantise);
  quantise.render = function (...args) {
    if (mode !== 'off' && sweepEvery > 0 && ++sinceSweep >= sweepEvery) {
      sinceSweep = 0;
      sweep();
    }
    return baseQuantiseRender(...args);
  };

  // -------------------------------------------------------------------------
  // applying a preset
  // -------------------------------------------------------------------------

  /**
   * Resolution, and the reason this does not simply call setPixelRatio.
   *
   * EffectComposer captures the renderer's pixel ratio ONCE, in its constructor,
   * and `setSize` multiplies by that captured value forever after. So changing
   * the renderer's ratio and calling `composer.setSize(w, h)` - which is what
   * main.js does in both setFidelity and setPixelScale - resizes the CANVAS and
   * leaves every render target in the post chain at the resolution the game
   * booted at. The frame is still rendered at full size and only the final blit
   * is smaller.
   *
   * `composer.setPixelRatio` is the setter that exists for this, and it has to
   * be called or these modes are colour filters with no performance story at
   * all. See docs/RETRO-LOOK.html: this is also why the governor's two
   * pixel-ratio rungs are worth much less than they look.
   */
  function applyResolution(preset) {
    setRetroHeight(preset ? preset.height : 0);

    const w = window.innerWidth, h = window.innerHeight;
    const ratio = resolutionScale(w, h);

    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h);

    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());

    /**
     * TWO DIFFERENT WAYS TO SIZE THE COMPOSER, AND BOTH ARE DELIBERATE.
     *
     * In a retro mode the ratio is something like 270/860, which is 0.3139...,
     * and `setPixelRatio(r)` then `setSize(1440, 860)` lands the render targets
     * on 452.093 x 270 - a fractional texture size that WebGL truncates on
     * allocation while three.js keeps the fraction in `renderTarget.width` and
     * uses it to set viewports. Nothing visibly breaks and it is still wrong to
     * ship a target whose recorded size is not the size it has. So retro modes
     * size the composer in absolute device pixels off the drawing buffer, which
     * is by definition an integer.
     *
     * Coming back OUT, the composer is handed its ratio and CSS pixels again,
     * because that is the convention the rest of main.js writes in. Leaving the
     * ratio at 1 would silently halve the post chain's resolution on any Retina
     * display the moment the player pressed P three times, which is a quality
     * regression bought by a mode they turned off.
     */
    if (preset) {
      post.composer.setPixelRatio(1);
      post.composer.setSize(buffer.x, buffer.y);
    } else {
      post.composer.setPixelRatio(ratio);
      post.composer.setSize(w, h);
    }

    // Half the drawing buffer, because normalised device coordinates span two
    // units across it. This is what makes the vertex snap land on whole pixels
    // of the buffer being drawn rather than on some grid of its own.
    uGrid.value.set(
      Math.max(1, buffer.x * 0.5 / JITTER_COARSENESS),
      Math.max(1, buffer.y * 0.5 / JITTER_COARSENESS),
    );

    canvas.classList.toggle('retro-nearest', !!preset && preset.filter === 'nearest');
    canvas.classList.toggle('retro-linear', !!preset && preset.filter === 'linear');
  }

  /**
   * SHADOWS OFF FOR BOTH, AND THE HALF OF THIS THAT WAS NOT DONE.
   *
   * Turning the shadow map off is period correct for both machines and it is
   * the second biggest saving in either mode, because a shadow map is an entire
   * extra render of the scene from the sun's point of view.
   *
   * The other half of the classic recipe - swap MeshStandardMaterial for
   * MeshLambertMaterial so the lighting is cheap and flat - is NOT done, and the
   * reason is measured rather than aesthetic. In three.js 0.185.1 only standard
   * and physical materials receive `scene.environment`; the classic materials
   * get an environment map only if one is set on the material itself. This
   * scene's fill is overwhelmingly image-based - core/post.js records the
   * knockout, `scene.environmentIntensity = 0` takes the near colonnade from 98
   * luma to 15, which is eighty-five per cent of the light - so a Lambert swap
   * does not make the game look flat, it makes the game look BLACK, and getting
   * it back means re-authoring the level's lighting rig. That is a lighting job,
   * not a render-mode job.
   *
   * `needsUpdate` on every patched material is already set by the patch itself,
   * which is what makes the shadow define change take effect - three.js bakes
   * shadow support into the program, and toggling the renderer flag without
   * recompiling leaves the old program running.
   */
  function applyShadows(preset) {
    renderer.shadowMap.enabled = preset ? false : restore.shadows;
  }

  function applyPasses(preset) {
    if (preset) {
      post.gtao.enabled = false;
      post.aoComposite.enabled = false;
      post.bloom.enabled = false;
      // The only pass either preset disagrees about. See the note on `smaa` in
      // the preset table and the measured row in .scratch/retro/isolate.mjs.
      post.smaa.enabled = preset.smaa;
      // Fog stays for both, and N64 leans on it. Its depth now comes from the
      // composer's own buffer; see RetroDepthBindPass.
      post.fog.enabled = true;
      depthBind.enabled = true;
      quantise.enabled = true;
    } else {
      post.gtao.enabled = restore.gtao;
      post.aoComposite.enabled = restore.aoComposite;
      post.bloom.enabled = restore.bloom;
      post.smaa.enabled = restore.smaa;
      post.fog.enabled = restore.fog;
      // Put the fog back on the depth texture it was reading before, which is
      // GTAO's. Leaving it pointed at a composer buffer would be correct only
      // for as long as nothing upstream swaps, and the full chain swaps twice.
      post.fog.uniforms.tDepth.value = restore.fogDepth;
      depthBind.enabled = false;
      quantise.enabled = false;
    }

    // Whatever is last and still enabled has to be the pass that writes to the
    // screen. Forgetting this is the failure mode core/post.js already wrote a
    // helper for: the frame goes black, which is fast, silent, and reads on a
    // profiler as an enormous improvement.
    post.retarget();
  }

  /**
   * The uniforms, which is where the two eras actually differ.
   *
   * Every value here is a write to a shared object, so this is the whole of a
   * PS1-to-N64 switch: no recompile, no reallocation, no hitch.
   */
  function applyUniforms(preset) {
    uJitter.value = preset ? preset.jitter : 0;
    uAffine.value = preset ? preset.affine : 0;

    quantise.uniforms.uLevels.value = preset ? preset.levels : 32;
    quantise.uniforms.uDither.value = preset ? preset.dither : 1;

    post.fog.uniforms.uSigmaE.value = preset
      ? fogBase.sigma * preset.fog.sigma
      : fogBase.sigma;
    post.fog.uniforms.uNearEnd.value = preset
      ? fogBase.nearEnd * preset.fog.nearEnd
      : fogBase.nearEnd;
  }

  /**
   * ATTACH DEPTH TEXTURES TO THE COMPOSER'S BUFFERS, ONCE, LAZILY.
   *
   * Both buffers, because the composer ping-pongs between them and the pass that
   * reads depth does not get to choose which one it is handed. Lazily, because a
   * game that never touches these modes should not pay for a depth texture it
   * will never sample. Once, and never detached, because putting a render target
   * back on an implicit depth renderbuffer mid-session means reallocating it
   * underneath a live frame, and the saving would be a depth-stencil attachment
   * that was already there in another form.
   *
   * DepthStencilFormat / UnsignedInt248Type is not a free choice: core/fog.js
   * samples depth with a `.x` swizzle and GTAOPass fills its own G-buffer at
   * exactly this format, so matching it is what lets one shader read either
   * source with no branch.
   */
  let depthAttached = false;
  function attachDepth() {
    if (depthAttached) return;

    for (const rt of [post.composer.renderTarget1, post.composer.renderTarget2]) {
      const d = new THREE.DepthTexture(rt.width, rt.height);
      d.format = THREE.DepthStencilFormat;
      d.type = THREE.UnsignedInt248Type;
      rt.depthTexture = d;
    }

    depthAttached = true;
  }

  // -------------------------------------------------------------------------
  // the switch
  // -------------------------------------------------------------------------

  /**
   * Accepts an id, a boolean, or null, and that tolerance is on purpose.
   *
   * `true` means PS1 because that was this system's only mode before the N64
   * preset existed, and the harnesses written against it are instruments that
   * should not have to be rewritten to keep reporting on a thing that did not
   * change. Anything unrecognised is 'off' rather than an exception: a settings
   * panel handing this a stale value should give the player the shipping look,
   * not a broken frame.
   */
  function normalise(v) {
    if (v === true) return 'ps1';
    if (v === false || v === null || v === undefined) return 'off';
    return PRESETS[v] ? v : 'off';
  }

  function set(next) {
    const id = normalise(next);
    if (id === mode) return mode;

    const preset = id === 'off' ? null : PRESETS[id];
    const wasOff = mode === 'off';

    if (preset && wasOff) {
      // Snapshot before anything is touched, so 'off' means the state the game
      // was actually in and not a remembered default. Taken only on the way in
      // from modern - moving between presets must not overwrite it with the
      // previous preset's settings.
      restore = {
        gtao: post.gtao.enabled,
        aoComposite: post.aoComposite.enabled,
        bloom: post.bloom.enabled,
        smaa: post.smaa.enabled,
        fog: post.fog.enabled,
        fogDepth: post.fog.uniforms.tDepth.value,
        shadows: renderer.shadowMap.enabled,
      };

      /**
       * The player has made an explicit choice, so the automatic one is over for
       * the session. This is core/governor.js's own rule - "an automatic system
       * that argues with an explicit choice is a bug, not a feature" - and it
       * matters more here than for the fidelity buttons: the governor would
       * otherwise read the enormous headroom these modes create, spend eight
       * seconds being sure of it, and start climbing its ladder back up into
       * GTAO underneath a mode whose entire argument is that GTAO is gone.
       */
      governor?.yieldToPlayer?.();

      attachDepth();
    }

    mode = id;

    if (preset) {
      applyResolution(preset);
      applyPasses(preset);
      applyShadows(preset);
      applyUniforms(preset);
      // Only the first entry needs the walk; a preset switch is uniforms only.
      if (wasOff) sweep();
    } else {
      applyPasses(null);
      applyShadows(null);
      applyUniforms(null);
      applyResolution(null);
      for (const [m, saved] of patched) unpatch(m, saved);
      patched.clear();
    }

    onChange?.(mode, preset ? preset.notice : 'Modern rendering');
    return mode;
  }

  return {
    /** 'off' | 'ps1' | 'n64'. */
    get mode() { return mode; },
    /** True in either retro mode, for callers that only care that one is on. */
    get enabled() { return mode !== 'off'; },
    /** The cycle order, for the panel and for the key. */
    get modes() { return ORDER.slice(); },

    set,

    /**
     * Modern, PS1, N64, modern. One key has to reach all three or the third one
     * is only discoverable through a menu, and a keystroke nobody is told about
     * is a feature that does not exist.
     */
    cycle() {
      const i = ORDER.indexOf(mode);
      return set(ORDER[(i + 1) % ORDER.length]);
    },

    /** Live numbers, for the settings panel and for the perf harness. */
    stats() {
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      const p = mode === 'off' ? null : PRESETS[mode];
      return {
        mode,
        name: p ? p.name : 'Modern',
        width: buffer.x,
        height: buffer.y,
        pixels: buffer.x * buffer.y,
        filter: p ? p.filter : 'none',
        levels: p ? p.levels : 0,
        dither: p ? p.dither : 0,
        jitter: p ? p.jitter : 0,
        affine: p ? p.affine : 0,
        fog: p ? p.fog.sigma : 1,
        materials: patched.size,
        depthBound: depthBind.bound,
        shadows: renderer.shadowMap.enabled,
        passes: post.composer.passes
          .filter((q) => q.enabled)
          .map((q) => q.constructor.name),
      };
    },

    /**
     * Re-apply the resolution without changing the mode, for the resize path.
     * core/renderer.js's bindResize already re-derives the ratio; this exists so
     * the jitter grid and the composer's own ratio follow the new buffer size,
     * which nothing else knows how to do.
     */
    resize() { if (mode !== 'off') applyResolution(PRESETS[mode]); },

    /** Force a material sweep now. For the harness. */
    sweep,

    /**
     * Override a preset's internal height, for the tuning harness ONLY.
     *
     * The right internal resolution for N64 is a question about how a picture
     * looks, not about a spec sheet, and the only way to answer it is to put
     * four candidates side by side. Doing that by editing this file between
     * runs would compare four page loads; doing it through here compares four
     * settings on one, which is the same discipline every other instrument in
     * this project follows.
     */
    debugSetHeight(id, px) {
      if (!PRESETS[id]) return;
      PRESETS[id].height = Math.max(60, Math.floor(px));
      if (mode === id) applyResolution(PRESETS[id]);
    },

    /**
     * How often the re-sweep runs, in rendered frames. 0 turns it off.
     *
     * Exposed because the sweep is a REAL per-frame cost averaged over its
     * interval, and an instrument that cannot null it cannot tell the cost of
     * the render mode from the cost of the bookkeeping around it.
     */
    setSweepEvery(n) { sweepEvery = Math.max(0, Math.floor(n || 0)); },
    get sweepEvery() { return sweepEvery; },
  };
}
