/**
 * PS1 MODE: a 32-bit-console render path, as a toggle rather than as a fork.
 *
 * The point of this file is a COMPARISON the owner can feel. One key flips the
 * whole renderer between the shipping look and a 1997 console look, in place,
 * without a reload and without moving the player, so the visual difference and
 * the frame-time difference are the same experiment. Everything here is
 * reversible by construction: nothing is destroyed, only swapped and put back.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS ALL IN ONE FILE AND PATCHES AT RUNTIME
 * ---------------------------------------------------------------------------
 *
 * The obvious implementation is to author retro materials next to the real ones
 * in world/materials.js and pick between them. That is the wrong shape twice
 * over. It puts a second copy of every material in a file whose job is to
 * describe THIS game's surfaces, and it means every new prop anyone adds has to
 * remember to author its retro twin or it silently keeps the modern look.
 *
 * So instead this walks the live scene graph and patches whatever it finds,
 * through `material.onBeforeCompile`. A prop added next week is picked up with
 * no work, the files that define the world never learn that this mode exists,
 * and the whole feature can be deleted by deleting one file and three call
 * sites. It also means this lane can be built while other lanes are editing the
 * world files, which is what was actually happening.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE THINGS THAT MAKE IT READ AS A PLAYSTATION, IN ORDER OF PAYOFF
 * ---------------------------------------------------------------------------
 *
 *   1. LOW INTERNAL RESOLUTION, HARD UPSCALE. The console rendered 320x240 and
 *      the television did the rest. This renders at 270 lines and lets the
 *      compositor blow it up with `image-rendering: pixelated`, so the pixels
 *      stay square. Lowering the pixel ratio ALONE is not this effect: the
 *      browser's default upscale is bilinear and reads as a smeared modern
 *      frame rather than as a low-resolution one. The hard edges are the look.
 *      It is also, by a distance, the biggest thing on the perf side: every
 *      fullscreen pass in core/post.js is a fill-rate cost and this divides the
 *      fill by about twenty-five.
 *
 *   2. VERTEX JITTER. The console's GTE transformed vertices in fixed point
 *      with no fractional screen precision, so vertices snapped to whole pixels
 *      and geometry visibly swam as the camera moved. Reproduced by quantising
 *      the clip-space position to the render grid in the vertex shader. This is
 *      the effect people actually mean when they say "PS1".
 *
 *   3. AFFINE TEXTURE MAPPING. The hardware had no per-pixel divide, so texture
 *      coordinates were interpolated linearly in screen space and large
 *      polygons visibly warped. Reproduced by carrying uv*w and w as varyings
 *      and doing the divide in the fragment shader; see the note on
 *      RETRO_AFFINE_GLSL for why the obvious `noperspective` qualifier is NOT
 *      available here.
 *
 *   4. NO SHADOW MAPS. Period correct and the second largest saving after fill
 *      rate, because a shadow map is a whole extra scene render. See the note
 *      in `applyShadows` for the half of this item that was NOT done and why.
 *
 *   5. FIVE-BIT COLOUR WITH AN ORDERED DITHER. The console framebuffer was
 *      15-bit and its rasteriser dithered on the way in. This matters more than
 *      it sounds for this game specifically: it is mostly dark, and dithering
 *      is what keeps a dark gradient from banding once you throw away three
 *      bits of every channel.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS TURNED OFF, AND WHY THAT IS THE PERFORMANCE ARGUMENT
 * ---------------------------------------------------------------------------
 *
 * GTAO, bloom and SMAA all go. GTAO because it re-renders the entire scene
 * through MeshNormalMaterial to fill its own G-buffer and is worth roughly 250
 * draw calls a frame; bloom because it is a whole mip chain of fullscreen work;
 * SMAA because in this mode jagged edges are REQUIRED rather than tolerated -
 * anti-aliasing a deliberately aliased image is paying to undo the effect.
 *
 * The height fog STAYS. It is period correct - draw distance is exactly what a
 * console of that era spent fog on - and it is load bearing for this level,
 * which uses it to hide the far field. Keeping it costs one thing that is
 * explained in full beside `RetroDepthBindPass`: core/fog.js normally borrows
 * the depth texture GTAO fills, and GTAO is the first thing this mode turns
 * off.
 */

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { setRetroHeight, resolutionScale } from './renderer.js';

/**
 * The internal render height, in lines.
 *
 * 240 is the console's own number and 270 is what a 16:9 window wants, because
 * the width is derived from the window's aspect rather than fixed: a 4:3 target
 * letterboxed into a widescreen window would either stretch the image or crop
 * the player's field of view, and both are worse lies than a widescreen frame
 * at console line count. 270 lines against a 1440x860 window is 452x270, which
 * is 122k pixels against 3.5 million - a factor of about twenty-eight.
 */
const RETRO_HEIGHT = 270;

/**
 * How coarse the vertex snap is, as a multiple of the render pixel.
 *
 * 1.0 means "snap to the pixel grid the frame is actually being drawn on",
 * which is what the hardware did and what this defaults to. Above 1 the wobble
 * gets stronger and starts to read as a bug rather than as a machine; below 1
 * it disappears entirely at this resolution. The knob is here because the right
 * answer depends on the render height, and the render height is a setting.
 */
const JITTER_COARSENESS = 1.0;

/** Colour levels per channel. 32 is five bits, which is what the console had. */
const COLOUR_LEVELS = 32;

// ---------------------------------------------------------------------------
// the shader injections
// ---------------------------------------------------------------------------

/**
 * Declarations added to both stages of every patched material.
 *
 * `vRetroW` is the clip-space w, interpolated perspective-correctly by the
 * rasteriser, which is what makes the affine trick below work.
 */
const RETRO_PARS_VERTEX = /* glsl */`
uniform vec2 uRetroGrid;
varying float vRetroW;
varying vec2 vRetroMapUv;
`;

const RETRO_PARS_FRAGMENT = /* glsl */`
varying float vRetroW;
varying vec2 vRetroMapUv;
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
 * Multiplying the result back by w is what keeps the perspective divide the
 * rasteriser is about to do from undoing the snap.
 *
 * THE GUARD IS NOT DECORATION. A vertex on the camera plane has w of exactly
 * zero and the division is a NaN, which does not clip - it propagates into the
 * rasteriser and takes whole triangles with it, intermittently, on geometry
 * that happens to graze the near plane. That is a hard bug to find later and a
 * cheap one to prevent here.
 *
 * THE AFFINE HALF. Perspective-correct interpolation of an attribute a gives
 * (sum L*a/w) / (sum L/w) for screen-space barycentrics L. Feed it a = uv*w and
 * it returns (sum L*uv) / (sum L/w); feed it a = w and it returns 1/(sum L/w).
 * Divide the first by the second and the w terms cancel exactly, leaving
 * sum L*uv, which IS the screen-space linear interpolation the console did. So
 * the warp is not an approximation of affine mapping, it is affine mapping.
 *
 * WHY NOT `noperspective`. That qualifier is the one-word version of all of
 * this and it does not exist here. three.js 0.185.1 compiles its built-in
 * materials as GLSL ES 3.00 (verified in the module build: it prepends
 * `#version 300 es` plus `#define varying in` for every material that is not a
 * RawShaderMaterial), and the OpenGL ES Shading Language 3.00 specification
 * carries only `smooth`, `flat` and `centroid` - `noperspective` is a RESERVED
 * word in ES, not a supported one. It is desktop GLSL only. This was checked
 * against the shipped three.js source and then against the driver by compiling
 * a probe shader that uses it; see docs/RETRO-LOOK.html for the result.
 */
const RETRO_VERTEX_TAIL = /* glsl */`
  vRetroW = gl_Position.w;

  #ifdef USE_MAP
    vRetroMapUv = vMapUv * gl_Position.w;
  #endif

  if (abs(gl_Position.w) > 1.0e-5) {
    vec2 ndc = gl_Position.xy / gl_Position.w;
    gl_Position.xy = floor(ndc * uRetroGrid + 0.5) / uRetroGrid * gl_Position.w;
  }
`;

/**
 * The diffuse map lookup, re-expressed in affine coordinates.
 *
 * This replaces `#include <map_fragment>` with three.js's own chunk text, with
 * one substitution in it. Copying the chunk rather than re-authoring it means
 * the sRGB decode and the DECODE_VIDEO_TEXTURE branch keep working and keep
 * tracking whatever three.js does with them next version.
 *
 * ONLY THE DIFFUSE MAP IS MADE AFFINE, and that is a deliberate stopping point
 * rather than an oversight. The same treatment for the normal, roughness and
 * ambient-occlusion maps would need one varying pair each, and at 452x270 a
 * normal map is contributing detail below the size of a pixel. The warp is a
 * DIFFUSE-texture artefact in every reference frame of the era, because that is
 * the only map those machines had.
 */
function affineMapFragment() {
  return THREE.ShaderChunk.map_fragment
    .split('vMapUv').join('(vRetroMapUv / vRetroW)');
}

// ---------------------------------------------------------------------------
// the passes
// ---------------------------------------------------------------------------

/**
 * FIVE-BIT COLOUR AND AN ORDERED DITHER.
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
 * render pixel, and the compositor's nearest-neighbour blow-up carries the
 * pattern up with the image at the same scale as everything else. A dither
 * computed at output resolution would be invisible - a fine screen door over a
 * chunky image, which is a modern artefact, not a console one.
 */
const RetroQuantiseShader = {
  uniforms: {
    tDiffuse: { value: null },
    // Levels per channel. 32 is 5 bits; the console's framebuffer was 15-bit,
    // five bits per channel plus one bit of transparency mask.
    uLevels:  { value: COLOUR_LEVELS },
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

      // floor(x * steps + d) / steps. The dither offset is what decides which
      // side of a step boundary a pixel falls on, so a gradient that would
      // band into flat plateaus breaks up into an alternating pattern of the
      // two nearest levels instead. Amplitude is exactly one level by
      // construction, which is the most a dither may ever add without becoming
      // noise.
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
 * Retro mode needs GTAO gone and fog kept, so it has to supply depth some other
 * way. The three candidates:
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
// the mode
// ---------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {HTMLCanvasElement} o.canvas
 * @param {object} o.post          the object core/post.js returns
 * @param {object} [o.viewmodel]   player/viewmodel.js, so the gun jitters too
 * @param {object} [o.governor]    core/governor.js, told to stand down
 * @param {function} [o.onChange]  called with the new state after every flip
 */
export function createRetro({
  renderer, scene, canvas, post, viewmodel, governor, onChange,
}) {
  let on = false;

  /**
   * The render grid, in half-pixels of the internal buffer, shared by every
   * patched material as ONE uniform object.
   *
   * Shared rather than per-material on purpose: three.js reads the uniform's
   * `value` at draw time off whatever object the shader was given, so handing
   * every program the same object means the resize path updates ninety
   * materials by writing one vector. The alternative is a list to walk and a
   * list to forget to update.
   */
  const gridUniform = { value: new THREE.Vector2(240, 135) };

  /** Materials this mode has patched, and what they looked like before. */
  const patched = new Map();

  /**
   * The pass-enable flags as they were when retro mode was switched on.
   *
   * Snapshotted rather than assumed, because the governor may have already
   * turned some of these off by the time the player presses the key, and a
   * toggle that "restores" a state the game was never in is a one-way door
   * wearing a two-way label.
   */
  let restore = null;

  // --- the passes this mode adds -------------------------------------------

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
   * `image-rendering: pixelated` on the canvas, injected from here rather than
   * declared in index.html.
   *
   * index.html is owned by another lane this week, and a one-line style rule is
   * not worth a merge conflict. It also keeps the whole feature deletable by
   * deleting this file.
   */
  const style = document.createElement('style');
  style.textContent = '#stage.retro { image-rendering: pixelated; }';
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
     * onBeforeCompile on every stone material in the game - grime at the base
     * of a wall, sun bleach on the top, world-space mottling that stops the
     * tile from repeating - and dropping it would change the look of the mode
     * in ways that have nothing to do with the era.
     */
    m.onBeforeCompile = function retroOnBeforeCompile(shader, rendererRef) {
      if (prevCompile) prevCompile.call(this, shader, rendererRef);

      shader.uniforms.uRetroGrid = gridUniform;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${RETRO_PARS_VERTEX}`)
        .replace('#include <project_vertex>',
          `#include <project_vertex>\n${RETRO_VERTEX_TAIL}`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${RETRO_PARS_FRAGMENT}`)
        .replace('#include <map_fragment>', affineMapFragment());
    };

    /**
     * THE CACHE KEY IS THE TRAP IN THIS WHOLE FILE, and it has to be set by
     * hand.
     *
     * three.js keys its compiled programs on `customProgramCacheKey()`, which
     * by default returns `onBeforeCompile.toString()`. Two things break that
     * here at once. First, the function above is a closure, and every closure
     * from one piece of source has the SAME source text - so two materials with
     * different chained hooks would produce identical keys and three.js would
     * happily hand the second one the first one's program. Second,
     * weathering.js already overrides the key with a constant string, which
     * means swapping the hook would not change the key at all and the material
     * would keep the program it was compiled with - the patch would run and
     * nothing would appear. That is this project's defining bug class, arrived
     * at through a caching layer instead of through a render target.
     *
     * So the key carries the ORIGINAL key inside it. Distinct variants stay
     * distinct, and the retro variant of a material can never collide with its
     * own modern one.
     */
    const inner = hadOwnKey ? prevKey.call(m) : (hadOwnCompile ? prevCompile.toString() : 'plain');
    m.customProgramCacheKey = () => `retro:${COLOUR_LEVELS}:${inner}`;

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
   * RE-SWEEP WHILE THE MODE IS LIVE, because the scene is not finished.
   *
   * The wave director builds enemies during play and the mystery box builds
   * weapons, so a one-shot patch at toggle time would leave every enemy that
   * spawned afterwards rendering smooth and perspective-correct in the middle
   * of a jittering world.
   *
   * MEASURED BEFORE IT WAS BELIEVED, because a per-frame walk of the scene
   * graph is exactly the kind of bookkeeping that quietly eats the saving the
   * mode exists to produce. One full sweep of this scene - 1548 nodes, 149
   * patchable materials, a Map lookup each - costs 0.15 ms, so at one sweep in
   * thirty frames it is 0.005 ms a frame against a frame that measures 1.10.
   * That is under half a per cent, and an enemy that spawns is wearing the mode
   * within half a second. The instrument that says so is
   * .scratch/retro/isolate.mjs, which nulls this entirely as one of its rows.
   *
   * Driven off the quantise pass, which is the one thing in this file that is
   * guaranteed to run exactly once per rendered frame while the mode is on.
   */
  let sinceSweep = 0;
  let sweepEvery = 30;
  const baseQuantiseRender = quantise.render.bind(quantise);
  quantise.render = function (...args) {
    if (on && sweepEvery > 0 && ++sinceSweep >= sweepEvery) { sinceSweep = 0; sweep(); }
    return baseQuantiseRender(...args);
  };

  // -------------------------------------------------------------------------
  // the three switches
  // -------------------------------------------------------------------------

  /**
   * Resolution, and the reason this does not simply call setPixelRatio.
   *
   * EffectComposer captures the renderer's pixel ratio ONCE, in its
   * constructor, and `setSize` multiplies by that captured value forever after.
   * So changing the renderer's ratio and calling `composer.setSize(w, h)` -
   * which is what main.js does in both setFidelity and setPixelScale - resizes
   * the CANVAS and leaves every render target in the post chain at the
   * resolution the game booted at. The frame is still rendered at full size and
   * only the final blit is smaller.
   *
   * `composer.setPixelRatio` is the setter that exists for this, and it has to
   * be called or this whole mode is a colour filter with no performance story
   * at all. See the report in docs/RETRO-LOOK.html: this is also why the
   * governor's two pixel-ratio rungs are worth much less than they look.
   */
  function applyResolution(next) {
    setRetroHeight(next ? RETRO_HEIGHT : 0);

    const w = window.innerWidth, h = window.innerHeight;
    const ratio = resolutionScale(w, h);

    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h);

    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());

    /**
     * TWO DIFFERENT WAYS TO SIZE THE COMPOSER, AND BOTH ARE DELIBERATE.
     *
     * In retro mode the ratio is 270/860, which is 0.3139..., and
     * `setPixelRatio(r)` then `setSize(1440, 860)` lands the render targets on
     * 452.093 x 270 - a fractional texture size that WebGL truncates on
     * allocation while three.js keeps the fraction in `renderTarget.width` and
     * uses it to set viewports. Nothing visibly breaks and it is still wrong to
     * ship a target whose recorded size is not the size it has. So retro mode
     * sizes the composer in absolute device pixels off the drawing buffer,
     * which is by definition an integer.
     *
     * Coming back OUT, the composer is handed its ratio and CSS pixels again,
     * because that is the convention the rest of main.js writes in: setFidelity,
     * setPixelScale and bindResize all call `composer.setSize(innerWidth,
     * innerHeight)` and rely on the composer's own ratio to scale it. Leaving
     * the ratio at 1 would silently halve the post chain's resolution on any
     * Retina display the moment the player pressed P twice, which is a quality
     * regression bought by a mode they turned off.
     */
    if (next) {
      post.composer.setPixelRatio(1);
      post.composer.setSize(buffer.x, buffer.y);
    } else {
      post.composer.setPixelRatio(ratio);
      post.composer.setSize(w, h);
    }

    // Half the drawing buffer, because normalised device coordinates span two
    // units across it. This is what makes the vertex snap land on whole pixels
    // of the buffer being drawn rather than on some grid of its own.
    gridUniform.value.set(
      Math.max(1, buffer.x * 0.5 / JITTER_COARSENESS),
      Math.max(1, buffer.y * 0.5 / JITTER_COARSENESS),
    );

    canvas.classList.toggle('retro', next);
  }

  /**
   * SHADOWS OFF, AND THE HALF OF THIS THAT WAS NOT DONE.
   *
   * Turning the shadow map off is period correct and it is the second biggest
   * saving in the mode, because a shadow map is an entire extra render of the
   * scene from the sun's point of view.
   *
   * The other half of the classic recipe - swap MeshStandardMaterial for
   * MeshLambertMaterial so the lighting is cheap and flat - is NOT done here,
   * and the reason is measured rather than aesthetic. In three.js 0.185.1 only
   * standard and physical materials receive `scene.environment`; the classic
   * materials get an environment map only if one is set on the material
   * itself. This scene's fill is overwhelmingly image-based - core/post.js
   * records the knockout, `scene.environmentIntensity = 0` takes the near
   * colonnade from 98 luma to 15, which is eighty-five per cent of the light -
   * so a Lambert swap does not make the game look flat, it makes the game look
   * BLACK, and getting it back means re-authoring the level's lighting rig.
   * That is a lighting job, not a render-mode job, and it is not this lane's
   * file to do it in.
   *
   * `needsUpdate` on every patched material is already being set by the patch
   * itself, which is what makes the shadow define change take effect - three.js
   * bakes shadow support into the program, and toggling the renderer flag
   * without recompiling leaves the old program running.
   */
  function applyShadows(next) {
    renderer.shadowMap.enabled = next ? false : restore.shadows;
  }

  function applyPasses(next) {
    if (next) {
      post.gtao.enabled = false;
      post.aoComposite.enabled = false;
      post.bloom.enabled = false;
      post.smaa.enabled = false;
      // Fog stays. Its depth now comes from the composer's own buffer; see
      // RetroDepthBindPass.
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
   * ATTACH DEPTH TEXTURES TO THE COMPOSER'S BUFFERS, ONCE, LAZILY.
   *
   * Both buffers, because the composer ping-pongs between them and the pass
   * that reads depth does not get to choose which one it is handed. Lazily,
   * because a game that never touches this mode should not pay for a depth
   * texture it will never sample. Once, and never detached, because putting a
   * render target back on an implicit depth renderbuffer mid-session means
   * reallocating it underneath a live frame, and the saving would be a
   * depth-stencil attachment that was already there in another form.
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
  // the toggle
  // -------------------------------------------------------------------------

  function set(next) {
    next = !!next;
    if (next === on) return on;

    if (next) {
      // Snapshot before anything is touched, so "off" means the state the game
      // was actually in and not a remembered default.
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
       * The player has made an explicit choice, so the automatic one is over
       * for the session. This is core/governor.js's own rule - "an automatic
       * system that argues with an explicit choice is a bug, not a feature" -
       * and it matters more here than for the fidelity buttons: the governor
       * would otherwise read the enormous headroom this mode creates, spend
       * eight seconds being sure of it, and start climbing its ladder back up
       * into GTAO underneath a mode whose entire argument is that GTAO is gone.
       */
      governor?.yieldToPlayer?.();

      attachDepth();
      on = true;
      applyResolution(true);
      applyPasses(true);
      applyShadows(true);
      sweep();
    } else {
      on = false;
      applyPasses(false);
      applyShadows(false);
      applyResolution(false);
      for (const [m, saved] of patched) unpatch(m, saved);
      patched.clear();
    }

    onChange?.(on);
    return on;
  }

  return {
    get enabled() { return on; },
    set,
    toggle() { return set(!on); },

    /** Live numbers, for the settings panel and for the perf harness. */
    stats() {
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      return {
        on,
        width: buffer.x,
        height: buffer.y,
        pixels: buffer.x * buffer.y,
        materials: patched.size,
        depthBound: depthBind.bound,
        levels: COLOUR_LEVELS,
        shadows: renderer.shadowMap.enabled,
        passes: post.composer.passes
          .filter((p) => p.enabled)
          .map((p) => p.constructor.name),
      };
    },

    /**
     * Re-apply the resolution without changing the mode, for the resize path.
     * core/renderer.js's bindResize already re-derives the ratio; this exists
     * so the jitter grid follows the new buffer size, which nothing else knows
     * how to do.
     */
    resize() { if (on) applyResolution(true); },

    /** Force a material sweep now. For the harness. */
    sweep,

    /**
     * How often the re-sweep runs, in rendered frames. 0 turns it off.
     *
     * Exposed because the sweep is a REAL per-frame cost averaged over its
     * interval, and an instrument that cannot null it cannot tell the cost of
     * the render mode from the cost of the bookkeeping around it. It was set to
     * every 30 frames first and measured; see docs/RETRO-LOOK.html.
     */
    setSweepEvery(n) { sweepEvery = Math.max(0, Math.floor(n || 0)); },
    get sweepEvery() { return sweepEvery; },
  };
}
