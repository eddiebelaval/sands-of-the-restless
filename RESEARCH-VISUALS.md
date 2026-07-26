# RESEARCH: Closing the gap to AAA-shooter visuals in the browser

Target: three.js r0.185.1, WebGL2, ES modules, procedural-only assets.
Researched 2026-07-25. Every import path below was verified by HTTP HEAD against
`https://unpkg.com/three@0.185.1/...` and cross-checked against the actual npm
tarball (`three-0.185.1.tgz`), not against the `dev` branch. Where something does
not exist, it is called out explicitly rather than guessed at.

---

## BLUF: the top 5 changes, ranked by visual impact over implementation cost

These are ordered by ratio, not by absolute impact. The ordering is driven by
what the current screenshots (`shots/02-courtyard.png`, `shots/03-walked.png`,
`shots/gun-02-ads.png`) actually show, not by a generic checklist.

**1. Set `scene.environment`. You currently have no environment map at all.**
Grep confirms `scene.environment` is never assigned anywhere in `src/`. Every
metal in the game is therefore lit by nothing: `gunmetal` at `metalness: 0.90`,
`gold` at `0.92`, `granite` at `0.22`. Metals have no diffuse term, so their
entire appearance is reflected environment. With no environment they render as
flat dark grey, which is exactly what the weapon looks like in
`shots/gun-02-ads.png`. This is roughly six lines of code and it is the single
largest visual delta available to you.

**2. Give the viewmodel material work and put it inside the post chain.**
The weapon occupies 20-30 percent of every frame and is the object the player
stares at for the entire session. It currently has zero textures (`viewmodel.js`
line 34 says so outright: "gunmetal and polymer carry no maps"), zero normal
maps, zero env reflection, zero wear. It is also rendered *after*
`post.composer.render()` (`main.js:265-270`), so it receives no AO, no bloom, no
colour grade and no SMAA. It is literally a different image pasted on top of the
graded one. In Call of Duty the viewmodel is the highest-fidelity asset in the
build. Yours is the lowest.

**3. Cascaded shadow maps. `three/addons/csm/CSM.js` ships in your version.**
Verified present in the tarball and 200 over HTTP. Your current setup is one
2048 map over a 92x92 unit ortho box that follows the player *without texel
snapping*, so shadows crawl as you walk. CSM texel-snaps every cascade
(`Math.floor(_center.x / texelWidth) * texelWidth`, CSM.js line 394) and gives
you 4x1024 across the view distance instead of 1x2048 across everything.

**4. Kill the Sobel-from-albedo normal maps; author height fields instead.**
`textures.js:104` runs a Sobel over albedo luminance. In `paintMasonry` you
deliberately paint a lit top edge (`rgba(255,246,224,.22)`) and a shadowed bottom
edge (`rgba(30,22,12,.30)`) into the albedo, and then derive normals from that
painted lighting. You are baking fake light into the albedo and then converting
that same fake light into geometry, so it gets lit a second time. That
double-shading is a large part of the "toy" read.

**5. Height fog and a real sky. Both are cheap and both sell scale.**
`FogExp2` cannot do height fog because the fog varying is `vFogDepth = -mvPosition.z`
with no world position available in the fragment stage. Overriding four shader
chunks globally fixes it. `three/addons/objects/Sky.js` exists at 0.185.1 and
now carries cloud uniforms as well as the Preetham parameters.

Everything below is detail, verification, and the things that did not make the
top five.

---

## 0. What the current build actually looks like, and why

I read the screenshots in `shots/` rather than reasoning about the code alone.
This changed the priority order materially.

From `shots/gun-02-ads.png` and `shots/02-courtyard.png`:

- **The weapon is untextured boxes.** Flat charcoal and flat mid-grey, no maps,
  no reflection, no edge wear, no AO. This is the dominant object in frame.
- **Metals read as matte plastic.** Consistent with no environment map.
- **The architecture is the best part of the frame.** The masonry painter and the
  world-space weathering in `weathering.js` are doing real work. Do not throw
  that away.
- **Sand has no near-field detail.** At close range it is mip-blurred to nearly
  flat colour. One 512px texture stretched over a 420-unit dune field cannot
  carry grain at 1m and ripples at 100m simultaneously.
- **Value separation is weak.** Sand and limestone occupy nearly the same
  luminance and hue band, so the composition flattens.

From `shots/03-walked.png` (which does show shadows working):

- Shadow edges are hard with a **uniform penumbra at all distances**. Real
  shadows soften with occluder distance. This is the single most recognisable
  "one shadow map" tell.
- The chamfer highlight along the top of the wall is **blown to pure white**. The
  chamfer idea is correct; the intensity is not.
- Surfaces fully in shadow go **dead and detail-free**, because indirect light is
  a constant hemisphere term with nothing to modulate it.
- The palm is five flat quads and reads as a PS1 asset next to the masonry.

The gap to "Call of Duty proper" is not one missing effect. It is roughly:
material response (env map, roughness variation), asset fidelity on the hero
object (the weapon), shadow quality, and near-field surface detail. Post-processing
is the *last* of these, and you already have more post than the scene can justify.

---

## 1. three.js addons at 0.185.1: what actually exists

Method: downloaded `https://registry.npmjs.org/three/-/three-0.185.1.tgz`,
extracted, enumerated `examples/jsm/`. Then HTTP-verified each recommended
specifier against unpkg pinned to `0.185.1`. All 38 paths below returned **200**.

### 1.1 The headline finding: there are two rendering stacks in your version

`package.json` `exports` at 0.185.1:

```json
".":         "./build/three.module.js",
"./addons/*":"./examples/jsm/*",
"./webgpu":  "./build/three.webgpu.js",
"./tsl":     "./build/three.tsl.js"
```

`WebGPURenderer` **falls back to a WebGL2 backend automatically**. Verified in
`src/renderers/webgpu/WebGPURenderer.js` line 41:

> `@property {boolean} [forceWebGL=false] - If set to 'true', the renderer uses a WebGL 2 backend no matter if WebGPU is supported or not.`

and lines 57-72 install a `getFallback` that constructs `WebGLBackend` when
WebGPU is unavailable. So the node/TSL stack is not gated on WebGPU adoption.
For reference, caniuse currently reports WebGPU at **83.63 percent** global
(`https://caniuse.com/webgpu`), Firefox still off by default. The fallback makes
that number largely irrelevant to the decision.

This matters because the TSL effect library is dramatically richer than the
classic `postprocessing/` folder. Full contents of `examples/jsm/tsl/display/`
at 0.185.1:

```
AfterImageNode  AnaglyphPassNode  BilateralBlurNode  BleachBypass  BloomNode
boxBlur  ChromaticAberrationNode  CRT  DenoiseNode  depthAwareBlend
DepthOfFieldNode  DotScreenNode  FilmNode  FSR1Node  FXAANode  GaussianBlurNode
GodraysNode  GTAONode  hashBlur  ImportanceSampledEnvironment  LensflareNode
Lut3DNode  MotionBlur  OutlineNode  ParallaxBarrierPassNode  PixelationPassNode
radialBlur  RecurrentDenoiseNode  RetroPassNode  RGBShiftNode  Sepia  Shape
SharpenNode  SMAANode  SobelOperatorNode  SSAAPassNode  SSGINode  SSRNode
SSSNode  StereoCompositePassNode  StereoPassNode  TAAUNode  TemporalReprojectNode
TRAANode  TransitionNode
```

Things in that list with no WebGL-path equivalent: **GodraysNode** (raymarched,
shadow-map sampling), **SSGINode** (screen-space global illumination),
**TRAANode** (temporal reprojection AA with velocity buffer), **TAAUNode**
(temporal AA + upsampling), **MotionBlur**, **SharpenNode**, **FSR1Node**
(FSR1 EASU+RCAS), **DenoiseNode**, **SSSNode**.

I grepped all of `tsl/display/*.js` for `.compute(` and `computeAsync` and got
**zero hits**. Every one of these is fragment-shader based, which is why they
work on the WebGL2 backend.

Also present, WebGPU-path only:
- `examples/jsm/tsl/shadows/TileShadowNode.js` (tiled shadow maps)
- `examples/jsm/csm/CSMShadowNode.js` (CSM for the node renderer)
- `examples/jsm/lighting/ClusteredLighting.js` (`new ClusteredLighting(maxLights = 1024, tileSize = 32, zSlices = 24, maxLightsPerCluster = 64)`) - relevant to your interior point lights in `build.js`

**Naming trap:** `PostProcessing` was renamed at r183. From
`src/renderers/common/PostProcessing.js` line 20, verbatim:

> `PostProcessing: "PostProcessing" has been renamed to "RenderPipeline". Please update your code to use "THREE.RenderPipeline" instead.` `// @deprecated, r183`

Use `import { RenderPipeline } from 'three/webgpu'`. Confirmed exported from
`src/Three.WebGPU.js` line 14.

**Second trap:** `examples/jsm/tsl/WebGLNodesHandler.js` lets you use TSL node
*materials* with the classic `WebGLRenderer`, but its own header lists the
limitations verbatim, including `// - WebGPU postprocessing stack not supported`.
So you cannot get GodraysNode/TRAANode that way. The node postprocessing stack
requires `WebGPURenderer` (which may itself be running a WebGL2 backend).

### 1.2 Verified import paths, WebGL path (all 200 at 0.185.1)

```
three/addons/csm/CSM.js
three/addons/csm/CSMShader.js
three/addons/csm/CSMHelper.js
three/addons/postprocessing/EffectComposer.js
three/addons/postprocessing/SSRPass.js
three/addons/postprocessing/TAARenderPass.js
three/addons/postprocessing/SSAARenderPass.js
three/addons/postprocessing/LUTPass.js
three/addons/postprocessing/BokehPass.js
three/addons/postprocessing/GTAOPass.js
three/addons/postprocessing/SMAAPass.js
three/addons/postprocessing/OutputPass.js
three/addons/objects/Sky.js
three/addons/environments/RoomEnvironment.js
three/addons/geometries/DecalGeometry.js
three/addons/math/MeshSurfaceSampler.js
three/addons/math/ImprovedNoise.js
three/addons/math/SimplexNoise.js
three/addons/modifiers/TessellateModifier.js
three/addons/utils/BufferGeometryUtils.js
three/addons/utils/SceneOptimizer.js
three/addons/misc/TileCreasedNormalsPlugin.js
three/addons/misc/ProgressiveLightMap.js
```

### 1.3 Verified import paths, node/TSL path (all 200 at 0.185.1)

```
three/webgpu                                   (RenderPipeline, WebGPURenderer)
three/tsl                                      (pass, mrt, velocity, uniform, Fn, ...)
three/addons/csm/CSMShadowNode.js
three/addons/tsl/shadows/TileShadowNode.js
three/addons/tsl/display/GodraysNode.js
three/addons/tsl/display/SSGINode.js
three/addons/tsl/display/TRAANode.js
three/addons/tsl/display/TAAUNode.js
three/addons/tsl/display/SharpenNode.js
three/addons/tsl/display/MotionBlur.js
three/addons/tsl/display/DepthOfFieldNode.js
three/addons/tsl/display/BilateralBlurNode.js
three/addons/tsl/display/depthAwareBlend.js
three/addons/tsl/display/Lut3DNode.js
three/addons/tsl/display/ChromaticAberrationNode.js
three/addons/tsl/utils/Raymarching.js
three/addons/lighting/ClusteredLighting.js
```

### 1.4 Exact constructor signatures (read from source, not docs)

```js
// three/addons/csm/CSM.js  -- single options object
new CSM({
  camera,                 // required
  parent,                 // required, usually the scene
  cascades: 3,            // default
  maxFar: 100000,         // default
  mode: 'practical',      // 'practical' | 'uniform' | 'logarithmic' | 'custom'
  shadowMapSize: 2048,    // applied to EVERY cascade, not per-cascade
  shadowBias: 0.000001,
  lightDirection: new Vector3(1, -1, 1).normalize(),
  lightIntensity: 3,
  lightNear: 1,
  lightFar: 2000,
  lightMargin: 200,
  customSplitsCallback,   // required only when mode === 'custom'
});
// methods: setupMaterial(material), update(), updateFrustums(), remove(), dispose()
// NOT in the options object: csm.fade  (hardcoded `this.fade = false` at line 147)

new SSRPass({ renderer, scene, camera, width = 512, height = 512,
              selects = null, bouncing = false, groundReflector = null });

new TAARenderPass(scene, camera, clearColor, clearAlpha);   // .sampleLevel, .accumulate
new SSAARenderPass(scene, camera, clearColor = 0x000000, clearAlpha = 0); // .sampleLevel = 4
new LUTPass({ lut, intensity = 1 });                        // lut is a Data3DTexture
new BokehPass(scene, camera, { focus, aperture = 0.025, maxblur = 1.0 });
new GTAOPass(scene, camera, width = 512, height = 512, parameters, aoParameters, pdParameters);
new SMAAPass();                                             // takes NO arguments
new OutputPass();
new UnrealBloomPass(resolution, strength = 1, radius, threshold);
new RenderPass(scene, camera, overrideMaterial = null, clearColor = null, clearAlpha = null);
new EffectComposer(renderer, renderTarget);
```

TSL factory functions (exact, from the `export const` lines):

```js
godrays(depthNode, camera, light)          // light: DirectionalLight | PointLight
ssgi(beautyNode, depthNode, normalNode, camera)
ssr(colorNode, depthNode, normalNode, options = {})
traa(beautyNode, depthNode, velocityNode, camera)
taau(beautyNode, depthNode, velocityNode, camera)
dof(node, viewZNode, focusDistance = 1, focalLength = 1, bokehScale = 1)
sharpen(node, sharpness, denoise)
fsr1(node, sharpness, denoise)
lut3D(node, lut, size, intensity)
chromaticAberration(node, strength = 1.0, center = null, scale = 1.1)
motionBlur(inputNode, velocity, numSamples = int(16))
denoise(node, depthNode, normalNode, camera)
```

### 1.5 Verified NEGATIVE list. Do not chase these.

- `three/addons/shaders/GodRaysShader.js` - **404**. Removed from three.js. The
  full `examples/jsm/shaders/` listing at 0.185.1 contains no GodRays entry.
- `three/addons/postprocessing/GodRaysPass.js` - **404**.
- `three/addons/shaders/ParallaxShader.js` - **404**. Existed at r130, gone by
  r140. Verified by HTTP status across tags r120/r130/r140/r150/r160/r165/r185.
- Per-cascade shadow resolution in `CSM.js` - not supported. `_createLights()`
  (line 198) applies one `shadowMapSize` to all cascades.
- Hosek-Wilkie sky, aerial perspective node - not in three.js core at all.
- Height fog / volumetric lighting / custom fog scattering examples - **WebGPU
  only**. `examples/files.json` lists `webgpu_fog_height`, `webgpu_custom_fog`,
  `webgpu_custom_fog_scattering`, `webgpu_volume_lighting`. There is no WebGL
  equivalent shipped.
- Screen-space contact shadows - no addon. `webgl_shadow_contact` is a
  render-target blob shadow (ortho camera + patched `MeshDepthMaterial` +
  H/V blur onto a ground plane), not SSCS.
- Capsule shadows - no three.js implementation. Could not verify a fetchable
  primary source; treat as hand-roll, low priority.
- `three-csm` standalone repo (`github.com/StrandedKitty/three-csm`) - last push
  2023-12-11, zero published releases. The maintained copy is the core addon.

### 1.6 One live bug worth knowing about

The `webgl_shadowmap_pcss` example still exists at 0.185.1, but **its shader
patch no longer applies**. It does:

```js
shader = shader.replace(
  '\t\t\tif ( frustumTest ) {\n\t\t\t\tfloat depth = texture2D( shadowMap, shadowCoord.xy ).r;',
  ...
);
```

The current `shadowmap_pars_fragment.glsl.js` has a blank line between those two
statements, so the needle does not match. `String.replace` silently returns the
original on a miss, so the PCSS helper functions get injected but **the call site
is never inserted** and you get plain `BasicShadowMap` hard shadows. If you copy
this pattern for any chunk patching, assert that the string actually changed.

---

## 2. Shadow quality

### 2.1 What your current setup does wrong, specifically

From `src/world/sky.js` lines 83-99 and `src/core/renderer.js` line 29:

1. **One cascade.** A 92x92 unit ortho box at 2048 resolution is ~22 texels per
   world unit. Fine at 5m, mush at 60m, and wasted on the half of the box behind
   the player.
2. **No texel snapping.** `follow()` does
   `sun.position.copy(target).addScaledVector(sunDir, 120)` with no quantisation.
   The shadow map origin moves by sub-texel amounts every frame, so every shadow
   edge crawls and shimmers while you walk. This is highly visible in motion and
   invisible in a screenshot, which is why it survives.
3. **Uniform penumbra.** `PCFShadowMap` at a fixed `shadow.radius` gives the same
   softness for a pebble 30cm off the ground and a pyramid 40m up.
4. **`bias: -0.0008` is doing work that `normalBias` should do.** Flat depth bias
   is what causes peter-panning (contact detachment). Your `normalBias: 0.035` is
   the right instinct; lean harder on it and take `bias` toward 0.

Your comment in `renderer.js` that `PCFSoftShadowMap` is deprecated and silently
downgrades is **correct**. Verified in `src/renderers/webgl/WebGLShadowMap.js`
line 99-101:

```js
if ( this.type === PCFSoftShadowMap ) {
  warn( 'WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.' );
```

### 2.2 What PCF actually does at 0.185.1 (this is newer than most docs)

From `src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js`, the
`SHADOWMAP_TYPE_PCF` branch is a **5-tap Vogel disk with interleaved gradient
noise rotation**, on top of hardware PCF:

```glsl
// Hardware PCF with LinearFilter gives us 4-tap filtering per sample
// 5 samples using Vogel disk + IGN = effectively 20 filtered taps with better distribution
vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
float radius = shadowRadius * texelSize.x;
float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
shadow = ( texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) )
         + ... 4 more ... ) * 0.2;
```

Two consequences you can exploit:

- **`shadow.radius` now works in the PCF path.** In older three.js it only
  affected VSM. You can dial penumbra width directly.
- **The IGN rotation produces per-pixel dither noise.** That is exactly the
  signal a temporal accumulator resolves into smooth gradients. If you ever add
  TRAA, your shadows get dramatically softer for free. This is the same
  relationship AAA engines exploit: noisy-but-unbiased sampling plus temporal
  reconstruction beats a wide blur.

### 2.3 CSM: exact integration, and the two gotchas that will bite you

Import (from the file's own `@three_import` tag):

```js
import { CSM } from 'three/addons/csm/CSM.js';
import { CSMHelper } from 'three/addons/csm/CSMHelper.js';
```

Reference usage from the official example
(`https://threejs.org/examples/webgl_shadowmap_csm.html`, source at
`https://github.com/mrdoob/three.js/blob/dev/examples/webgl_shadowmap_csm.html`):

```js
const csm = new CSM({
  maxFar: 300,
  cascades: 4,
  mode: 'practical',
  parent: scene,
  shadowMapSize: 1024,
  lightDirection: new THREE.Vector3(-0.52, -0.44, -0.73).normalize(),
  camera: camera,
});
csm.fade = true;          // MUST be set after construction, see below
csm.updateFrustums();

for (const mat of Object.values(materials)) csm.setupMaterial(mat);

// per frame, before render:
camera.updateMatrixWorld();
csm.update();
```

**Gotcha 1: `setupMaterial` overwrites `onBeforeCompile`.** From CSM.js line 443:

```js
material.onBeforeCompile = function ( shader ) { ... };
```

Straight assignment, no chaining. Your `weathering.js` already assigns
`onBeforeCompile` on `limestone`, `carved`, `granite` and `sand`. Calling
`csm.setupMaterial()` on those will silently delete your weathering. You must
compose them yourself:

```js
csm.setupMaterial(mat);              // CSM installs its hook
const csmHook = mat.onBeforeCompile; // capture it
mat.onBeforeCompile = (shader, renderer) => {
  csmHook.call(mat, shader, renderer);
  weatherHook.call(mat, shader, renderer);   // your existing patch, refactored to a fn
};
```

Order matters: CSM's hook only adds uniforms, it does not touch the shader
strings (the string work is done globally, see below), so running it first is
safe.

**Gotcha 2: `csm.fade` defaults to `false` and is not settable via the options
object.** Verified: `this.fade = false;` at line 147, and `fade` does not appear
in the `data.*` reads. With `fade` off you get a hard, visible seam where one
cascade hands off to the next, plus no shadow-distance fade at the far plane.
Set it and call `updateFrustums()`.

**How CSM patches the shader:** `_injectInclude()` (line 415) globally overwrites
`THREE.ShaderChunk.lights_fragment_begin` and `lights_pars_begin`. This is
process-wide, not per-material. `CSMShader.js` guards both cases
(`#if ... && defined( USE_CSM )` at line 118 and
`#if ... && !defined( USE_CSM )` at line 224), so materials you never call
`setupMaterial` on still light correctly.

**What CSM buys you that you cannot get otherwise:**

- Texel snapping, lines 394-395:
  `_center.x = Math.floor( _center.x / texelWidth ) * texelWidth;`
  This is the fix for shadow crawl and it is not something you would think to
  add yourself.
- Practical split scheme (Zhang et al.) instead of a fixed box.
- Cascade fade blending.

**What CSM costs you:** it creates its own `DirectionalLight` per cascade
(`_createLights()`, line 198), all at `0xffffff` and `lightIntensity`. Your warm
sun tint `0xfff0d0` will be lost. Fix after construction:

```js
for (const l of csm.lights) {
  l.color.setHex(0xfff0d0);
  l.shadow.normalBias = 0.02;   // CSM sets shadow.bias but never normalBias
}
```

Note the shader comment at CSMShader.js: `// note: no loop here - all CSM lights
are in fact one light only`. The N lights contribute lighting once, not N times.

### 2.4 Contact-hardening (PCSS)

The example exists but its patch is broken (section 1.6). If you want
contact-hardening you are re-deriving the patch yourself. The tuning constants
from the example, for reference:

```
LIGHT_WORLD_SIZE 0.005, LIGHT_FRUSTUM_WIDTH 3.75,
LIGHT_SIZE_UV = LIGHT_WORLD_SIZE / LIGHT_FRUSTUM_WIDTH,
NEAR_PLANE 9.5, NUM_SAMPLES 17, NUM_RINGS 11
```

PCSS also requires `BasicShadowMap` ("PCSS requires reading raw depth values"),
while CSM's example runs `PCFShadowMap`. They patch different chunks so they can
technically coexist, but that combination is unshipped and untested.

**My call: do not do PCSS.** Do CSM plus a distance-scaled `shadow.radius`
instead. You get most of the perceptual benefit (near shadows tighter than far
shadows) for a fraction of the risk. Revisit only if the softness still reads
wrong after CSM lands.

### 2.5 VSM

`THREE.VSMShadowMap` exists and is the only genuinely soft option in the WebGL
path. `shadow.radius` becomes a real texel blur radius and `shadow.blurSamples`
(default 8) controls quality. The blocking caveat is in `src/constants.js`
verbatim: **"When using VSMShadowMap all shadow receivers will also cast
shadows."** You lose receive-only geometry, which for a 6200-instance scatter
field is a meaningful cost. Plus classic VSM light bleeding on overlapping
occluders, which a colonnade produces constantly.

Reference tuning from `webgl_shadowmap_vsm.html`: `mapSize.set(512,512)`,
`radius = 4`, `bias = -0.0005`.

**My call: skip VSM. CSM + PCF is the right answer for this scene.**

### 2.6 Bias, verbatim from `src/lights/LightShadow.js`

- `bias` (default `0`): "Very tiny adjustments here (in the order of 0.0001) may
  help reduce artifacts in shadows."
- `normalBias` (default `0`): "Defines how much the position used to query the
  shadow map is offset along the object normal... Increasing this value can be
  used to reduce shadow acne especially in large scenes where light shines onto
  geometry at a shallow angle. The cost is that shadows may appear distorted."
- `radius` (default `1`): "has no effect when the shadow map type is
  BasicShadowMap".
- `blurSamples` (default `8`): "The amount of samples to use when blurring a VSM
  shadow map" - VSM only.
- `intensity` (default `1`, range `[0,1]`): useful to lift shadow floor to a
  stylised value rather than crushing to ambient.

Guidance: `normalBias` is your primary acne control, `bias` your last resort.
Flat depth bias lifts every shadow uniformly, which is precisely peter-panning.
The canonical reference is Daniel Holbert's "Saying Goodbye to Shadow Acne"
(GDC 2011); the original host now 404s, indexed at
`https://www.realtimerendering.com/blog/gdc-2011-links/`. Readable secondary:
`https://willpgfx.com/2015/05/dealing-with-shadow-map-artifacts/`.

### 2.7 What real engines do, with sources

Activision publishes the actual Call of Duty shadow literature at
`https://research.activision.com/publications`. Directly on-point:

- Kevin Myers, **"Shadows of Cold War: A Scalable Approach to Shadowing"** (2021) -
  `https://research.activision.com/publications/2021/10/shadows-of-cold-war--a-scalable-approach-to-shadowing`
- Kevin Myers, **"Sparse Shadow Trees"** (2016) - large outdoor scenes
- Olejnik & Kozlowski, **"Raytraced Shadows in Call of Duty: Modern Warfare"** (2020)
- Jimenez et al., **"Practical Real-Time Strategies for Accurate Indirect Occlusion"**
  (GTAO, 2016/2020) -
  `https://research.activision.com/publications/2020-03/practical-real-time-strategies-for-accurate-indirect-occlusion`

The deltas from a single 2048 map, in order of what you can actually get:
cascades (yes, via CSM), texel snapping (yes, free with CSM), cascade fade (yes,
one flag), per-cascade resolution (no, would need patching `csm.lights[i].shadow.mapSize`
after construction), screen-space contact shadows (no addon), capsule shadows
(no implementation), raytraced shadows (not in a browser).

---

## 3. Surface detail at close range

### 3.1 Why Sobel-from-albedo is the wrong primitive

The Polycount normal map wiki (`http://wiki.polycount.com/wiki/Normal_map`,
HTTP only, HTTPS refuses) states it directly:

> "Most image conversion tools assume the input is a heightmap, where black is
> low and white is high. **If you try to convert a color texture that you've
> painted, the results are often very poor.**"

Sobel reads luminance gradients. In your albedo, luminance gradients come from
three unrelated sources: actual intended relief (the only correct signal), pure
pigment variation at constant height (a false cliff), and painted shading (a
false slope, often sign-inverted). Your `paintMasonry` paints all three. The
`rgba(255,246,224,.22)` top lip and `rgba(30,22,12,.30)` bottom lip are painted
lighting; Sobel converts them into geometry; the renderer then lights that
geometry a second time. Under a moving sun the fake cue and the real cue
disagree, and the brain reads "painted texture".

Marmoset's PBR primer states the contract on albedo
(`https://marmoset.co/posts/physically-based-rendering-and-you-can-too/`):

> "One of the biggest differences between an albedo map in a PBR system and a
> traditional diffuse map is **the lack of directional light or ambient
> occlusion**."

Adobe's Substance 3D Designer `Normal` node documents its input as "Input image
interpreted as a **height map**", grayscale
(`https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/atomic-nodes/normal`).

### 3.2 The correct procedural pipeline

Author height first. Height is the ground truth; albedo decorates it.

```
h(u,v)  <- FBM / worley / ridged noise, in [0,1]
normal  <- gradient of h  (analytic, or central differences)
albedo  <- tint(h) + INDEPENDENT colour noise   // colour noise must NOT feed the normal
rough   <- f(h) + INDEPENDENT roughness noise
```

Central differences, which is what you want instead of Sobel:

```glsl
float hL = height(uv - vec2(e, 0.0));
float hR = height(uv + vec2(e, 0.0));
float hD = height(uv - vec2(0.0, e));
float hU = height(uv + vec2(0.0, e));
float dhdx = (hR - hL) / (2.0 * e);
float dhdy = (hU - hD) / (2.0 * e);
vec3 n = normalize(vec3(-dhdx * strength, -dhdy * strength, 1.0));
```

The math: a height field `z = h(x,y)` is a Monge patch with tangents
`Tu = (1,0,dh/dx)` and `Tv = (0,1,dh/dy)`, so the normal is
`Tu x Tv = (-dh/dx, -dh/dy, 1)` normalized. The minus signs are load-bearing;
get them wrong and lighting inverts.

Sobel is central differences plus a `[1 2 1]` smoothing kernel perpendicular to
the gradient. That blur is a feature for edge detection in photographs and a bug
here, where you generated the height analytically and want its exact slope.
Sobel is 8 samples, central differences is 4.

**Best option for your case: derive the normal analytically.** Your textures are
procedural, so you can accumulate the derivative alongside the value in your
`fbm()` (standard analytic-derivative FBM). That gives you a correct normal at
any magnification, which matters enormously in an FPS where you walk up to a
wall. It also sidesteps the 8-bit quantisation problem entirely.

### 3.3 8-bit normal banding

Canvas `ImageData` is hard-locked to 8 bits per channel. 256 levels across
`[-1,1]` is ~0.0078 per step. On low-slope, large-radius surfaces - which is
exactly what a chamfered box is made of - the true normal changes by less than
one quantisation step across many pixels, giving flat plateaus separated by
1-step jumps that specular amplifies into visible terraces.

Ben Golus, "Generating Perfect Normal Maps for Unity"
(`https://bgolus.medium.com/generating-perfect-normal-maps-for-unity-f929e673fc57`):

> "A dithered normal map can look a little better than the streaks, but
> unfortunately not a lot of tools offer that. Otherwise 16 bit normal maps are
> an option."

Mitigations in order of value: compute analytically in-shader (no quantisation at
all); if you must bake, render to a `HalfFloatType` render target rather than a
2D canvas; add high-frequency detail normal so the plateau edges stop being the
only structure; blue-noise dither the encode.

### 3.4 Detail normal blending: use RNM

The definitive reference is Barre-Brisebois & Hill, "Blending in Detail",
`https://blog.selfshadow.com/publications/blending-in-detail/`. Formulas as
published:

```glsl
// Linear      (n1, n2 unpacked to [-1,1])
normalize(n1 + n2)

// Whiteout
normalize(vec3(n1.xy + n2.xy, n1.z * n2.z))

// UDN
normalize(vec3(n1.xy + n2.xy, n1.z))

// Partial Derivative
normalize(vec3(n1.xy * n2.z + n2.xy * n1.z, n1.z * n2.z))

// Reoriented Normal Mapping (RNM) -- takes n1, n2 STILL IN [0,1]
vec3 t = n1 * vec3( 2,  2, 2) + vec3(-1, -1,  0);
vec3 u = n2 * vec3(-2, -2, 2) + vec3( 1,  1, -1);
vec3 r = normalize(t * dot(t, u) - u * t.z);
```

Published ALU cost (SM3.0): Linear 5, UDN 5, PD 7, Whiteout 7, RNM 8, Overlay 9.
Their verdict, quoted: **"Linear and Overlay blending have no redeeming value."**
RNM "can make a difference in retaining more detail at similar instruction cost".

RNM is derived from the shortest-arc quaternion rotating `[0,0,1]` onto the base
normal, applied to the detail normal. Caveat they flag: RNM output can have
negative z; clamp before renormalising if you ever pack to two channels.

**Use RNM.** Three extra ALU is nothing next to your texture fetch and fill cost,
and RNM is the one that keeps detail alive on sloped faces and chamfers instead
of flattening it out.

### 3.5 Wiring a detail normal into MeshStandardMaterial

The hook is `normal_fragment_maps`. Verbatim from
`src/renderers/shaders/ShaderChunk/normal_fragment_maps.glsl.js` at 0.185.1:

```glsl
#elif defined( USE_NORMALMAP_TANGENTSPACE )

	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;

	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif

	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );

#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif
```

Two things that matter:

- **`tbn` is already built for you** by `normal_fragment_begin`. Your chamfered
  boxes have no tangent attribute, so three.js synthesises one per-pixel with
  `getTangentFrame()` (the thetenthplanet.de derivation). That works, but detail
  UV derivatives must be non-degenerate - use real UVs, not a constant.
- **`USE_PACKED_NORMALMAP` is new** and does not appear in older tutorials. It is
  opt-in so it will not interfere.

The patch, blending in tangent space before the `tbn` transform:

```js
material.onBeforeCompile = (shader) => {
  shader.uniforms.detailNormalMap    = { value: detailTex };
  shader.uniforms.detailNormalScale  = { value: new THREE.Vector2(1, 1) };
  shader.uniforms.detailNormalRepeat = { value: 12.0 };

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <normal_pars_fragment>', `#include <normal_pars_fragment>
      uniform sampler2D detailNormalMap;
      uniform vec2 detailNormalScale;
      uniform float detailNormalRepeat;
      vec3 rnmBlend(vec3 n1, vec3 n2) {           // Barre-Brisebois & Hill, inputs in [0,1]
        vec3 t = n1 * vec3( 2.0,  2.0, 2.0) + vec3(-1.0, -1.0,  0.0);
        vec3 u = n2 * vec3(-2.0, -2.0, 2.0) + vec3( 1.0,  1.0, -1.0);
        return normalize(t * dot(t, u) - u * t.z);
      }`)
    .replace('#include <normal_fragment_maps>', `
      #ifdef USE_NORMALMAP_TANGENTSPACE
        vec3 baseN01   = texture2D(normalMap, vNormalMapUv).xyz;
        vec3 detailN01 = texture2D(detailNormalMap, vNormalMapUv * detailNormalRepeat).xyz;
        detailN01.xy = (detailN01.xy - 0.5) * detailNormalScale + 0.5;
        vec3 mapN = rnmBlend(baseN01, detailN01);
        mapN.xy *= normalScale;
        normal = normalize(tbn * mapN);
      #else
        #include <normal_fragment_maps>
      #endif`);

  material.userData.shader = shader;
};
material.customProgramCacheKey = () => 'detailNormal-v1';
```

`material.normalMap` must be assigned or `USE_NORMALMAP_TANGENTSPACE` is never
defined and the branch is dead code. `customProgramCacheKey` is required or
three.js hands you a cached program compiled without your uniforms.

This is the single highest-value fix for the "sand has no near-field detail"
problem in your screenshots: one shared high-frequency grain normal, tiled 8-16x,
RNM-blended over the base.

### 3.6 Macro / meso / micro layering, and a free specular-aliasing fix

The strongest verifiable primary source is Ready At Dawn's **The Order: 1886**
SIGGRAPH 2013 course notes,
`https://blog.selfshadow.com/publications/s2013-shading-course/rad/s2013_pbs_rad_notes.pdf`:

> "We integrated the maps into our material pipeline using a **detail layer** in
> our material, in order to overlay the high-frequency normal and albedo
> variation."

and, on their scanned fabric:

> "Almost all the lighting information is removed from the albedo map. The normal
> map retains both the high-frequency micro detail of the fabric and the larger
> wavey details from folds."

Note the discipline: light removed from albedo, both frequency bands kept in the
*normal*. That is the exact inverse of a Sobel-from-albedo pipeline.

The same notes give a second technique that is free at runtime and worth doing:
**bake normal-map variance into roughness per mip** so distant surfaces stop
sparkling. `alpha' = sqrt(alpha^2 + (2*kappa)^-1)` where `kappa` is the vMF
concentration of the normals in the texel footprint. Their HLSL:

```hlsl
float3 avgNormal = 0; // average unit normals over the mip footprint
float r = length(avgNormal);
float kappa = 10000.0f;
if (r < 1.0f) kappa = (3*r - r*r*r) / (1 - r*r);
return sqrt(roughness*roughness + (1.0f/kappa));
```

Run this in JS when you generate the maps: build the normal mip chain, and write
a roughness mip that has absorbed the lost normal variance. This is what stops
high-frequency detail from reading as "shimmery CG".

*Unverified:* I could not find a fetchable primary source for a Star Citizen
macro/meso/micro system. Treat that reference as unconfirmed. The Frostbite
"Moving Frostbite to PBR" notes exist at
`https://seblagarde.wordpress.com/2015/07/14/siggraph-2014-moving-frostbite-to-physically-based-rendering/`
but were not read, so no claim is made about their detail-map content.

### 3.7 Parallax occlusion mapping: skip it

`ParallaxShader.js` does not exist at 0.185.1 (404, verified across tags). The
old `webgl_materials_parallaxmap` example is gone. The historical shader survives
at `https://github.com/shapespark/parallax-mapping` but it is a standalone
`ShaderMaterial` with no PBR, no IBL, no roughness.

There is no maintained POM-on-MeshStandardMaterial implementation. The canonical
forum thread
(`https://discourse.threejs.org/t/parallax-mapping-with-meshstandardmaterial-pbr/6105`)
says it "is not supported right now" and warns "you have to ensure correct
lighting calculations after the patch. In the worst case you break the physically
correct lighting."

Reference algorithm if you ever do it, from LearnOpenGL
(`https://learnopengl.com/Advanced-Lighting/Parallax-Mapping`): 8-32 layers
depending on view angle, ray march until `currentLayerDepth >= currentDepthMapValue`,
then one interpolation refinement between the last two samples.

**Cost:** 8-32 dependent texture fetches before you can fetch albedo/normal/
roughness, because those must use the displaced UV. Dependent fetches defeat
prefetch and the loop is divergent across a quad. Realistically 3-6x the fragment
cost of the same material.

**My call: skip POM.** Your problem is macro (flat-looking faces, no environment
response, no roughness variation), not meso. POM only pays off on surfaces with
real depth at grazing angles within about 2m, and its flat-silhouette failure
mode is maximally visible on hard-edged chamfered boxes, which is all you have.
Detail normals plus a cavity/AO term is visually indistinguishable at mid
distance for a fraction of the cost. Revisit later on two or three hero surfaces
behind a distance fade, if at all.

### 3.8 Tiling suppression

Inigo Quilez, "Texture repetition", `https://iquilezles.org/articles/texturerepetition/`,
gives three techniques with full source:

- **Technique 1** - per-tile random offset plus mirror, blended with
  `smoothstep(0.25, 0.75, fract(uv))`. **4 `textureGrad` fetches per map.**
  Derivatives are transformed by the same sign flip. Aliases under heavy
  minification.
- **Technique 2** - Voronoi texture bombing, 3x3 neighbourhood with
  `w = exp(-5.0*d)` weights. **9 fetches per map.** Highest quality,
  bandwidth-brutal.
- **Technique 3** - virtual pattern interpolation. Sample a low-frequency
  variation texture, pick two of eight offsets, blend. **2 fetches plus one
  low-frequency lookup.** IQ notes the variation texture stays in cache, which is
  why this is the cheap one.

For you: **Technique 3** on sand and large walls. 9 fetches per map times 3 maps
is 27 fetches per pixel, which is not viable in a browser.

The academic ceiling is Heitz & Neyret, "High-Performance By-Example Noise using
a Histogram-Preserving Blending Operator" (HPG 2018),
`https://eheitzresearch.wordpress.com/722-2/`: triangle-grid partition, 3 patch
fetches per map, blended in a Gaussianised space via a precomputed 1D LUT so the
histogram survives (linear blending of 3 samples destroys contrast and invents
colours). The variance-preserving blend rescales by `1/sqrt(sum w_i^2)` rather
than `1/sum w_i`. Follow-up is Deliot & Heitz, "Procedural Stochastic Textures by
Tiling and Blending" (GPU Zen 2), `https://jcgt.org/published/0008/04/02/paper.pdf`.

*Could not verify:* the JCGT PDF exceeded the fetch size limit and Unity's
implementation blog returns 403. The algorithm summary above is from Heitz's own
project page. Lift the exact shader code in a browser if you go this route.

The pragmatic shipped variant is Jason Booth's
(`https://medium.com/@jasonbooth_86226/stochastic-texturing-3c2e58d76a14`): drop
the LUTs entirely ("No LUTs and therefore no dependent texture reads"), replace
the variance-preserving blend with a **height blend**, and use that one height
decision to drive albedo, normal and roughness coherently. He reports dynamic
sample culling brings 3 samples down to "~1.5 samples in practice". This shipped
in MicroSplat.

**Hard constraint on all of these:** they only work on stochastic content.
Bricks, tiles, and your `paintMasonry` output will smear. Apply to sand, granite,
grunge - not to the ashlar.

### 3.9 Triplanar: do not bother, here

Ben Golus, "Normal Mapping for a Triplanar Shader"
(`https://bgolus.medium.com/normal-mapping-for-a-triplanar-shader-10bf39dca05a`)
is the definitive modern reference. Naive triplanar normal mapping is wrong
because "the mesh's tangents are based on the UVs stored in the mesh" and
triplanar-projected UVs do not align with them.

Weights, normalised by sum not magnitude:

```glsl
vec3 blend = pow(abs(worldNormal), vec3(4.0));
blend /= dot(blend, vec3(1.0));
```

Basic swizzle (correct only on axis-aligned geometry):

```glsl
normalize(tnormalX.zyx * blend.x + tnormalY.xzy * blend.y + tnormalZ.xyz * blend.z)
```

His conclusion, quoted: **"Whiteout offers the best balance of quality and
performance, particularly on modern platforms"**, with RNM "quite close to ground
truth".

**For you: no.** Your surfaces are axis-aligned boxes with correct UVs already
generated per-facet in `geometry.js`. Triplanar costs 3x the fetches and buys you
nothing except removing stretch on chamfer bevels. Keep it in your pocket for
terrain or non-box geometry later; if you do it, use Whiteout.

---

## 4. Geometry density

AAA assets are 10k-100k triangles. Yours are 44. But the honest framing is that
**triangle count is not what your screenshots are missing.** The pyramid and
colonnade read acceptably. What is missing is silhouette variety, asset-class
fidelity on the hero object, and near-field detail. Raising the world to 10k
tris per block would cost enormously and change almost nothing.

### 4.1 What actually reads as "geometric complexity"

In priority order for your scene:

1. **The chamfer highlight is already your best geometry idea.** The comment in
   `geometry.js` is right: an infinitely sharp edge reads as "computer". But in
   `shots/03-walked.png` the chamfer catches pure white and blows out. Dial the
   chamfer's roughness up and let it read as a lit bevel rather than a specular
   stripe. This is a material fix, not a geometry fix.
2. **Silhouette irregularity.** Every column in the courtyard is an identical
   stack of identical drums. Real ruins have chipped capitals, missing drums,
   leaning shafts, and rubble at the base. This costs zero extra triangles: it is
   per-instance random rotation, scale jitter, and occasional omission at build
   time.
3. **Edge-damage geometry, not edge-damage texture.** Chip a random corner off
   one block per ten by displacing three vertices of the chamfered box. Still 44
   tris, entirely different read.
4. **Instanced detail scatter clustered around contacts.** Your `scatter.js`
   already runs 6200 instances but distributes them evenly. Real deserts pile
   sand against obstacles and clear it from exposed faces. Weighting placement by
   distance to the nearest wall does more for realism than any texture change.

### 4.2 The tools that exist for this at 0.185.1

- `three/addons/math/MeshSurfaceSampler.js` - weighted point sampling on a mesh
  surface. This is the right primitive for scattering rubble at the base of walls
  and grass in crevices.
- `three/addons/geometries/DecalGeometry.js` - projects a decal mesh onto
  existing geometry. This is how AAA breaks up tiling and adds localised damage
  without touching the base texture: scorch marks, grime pools, cracks, bullet
  holes. Very high value for you and completely unused.
- `THREE.BatchedMesh` (core, `src/objects/BatchedMesh.js`) - multi-draw with
  per-instance geometry, so you can batch *different* meshes into one draw call.
  `InstancedMesh` requires identical geometry; `BatchedMesh` does not.
- `three/addons/utils/SceneOptimizer.js` - has `toBatchedMesh()` and
  `toInstancingMesh()` methods that will auto-merge a scene graph.
- `three/addons/modifiers/TessellateModifier.js` - subdivide, then displace in a
  vertex shader from your height field. This is the procedural route to real
  geometric relief on the ground plane.
- `three/addons/utils/BufferGeometryUtils.js` exports, verified:
  `computeMikkTSpaceTangents, mergeGeometries, mergeAttributes, deepCloneAttribute,
  deinterleaveAttribute, deinterleaveGeometry, interleaveAttributes,
  estimateBytesUsed, mergeVertices, toTrianglesDrawMode, computeMorphedAttributes,
  mergeGroups, toCreasedNormals`.
  `computeMikkTSpaceTangents` matters: real tangents beat the per-pixel
  `getTangentFrame()` fallback for normal map quality.
- `three/addons/misc/TileCreasedNormalsPlugin.js` - creased normals for
  non-indexed positions.

### 4.3 Trim sheets and texel density

The reason your architecture reads better than your sand is texel density
consistency. Your `uv.js` bakes density in world units, which is the right call.
Standard targets from the game-art literature: **512 px/m for third-person
environments, 1024 px/m for close-up first-person props**
(`https://rebusfarm.net/blog/texel-density-basics-every-artist-should-know`,
`https://polycount.com/discussion/194677/texel-density-vs-trim-sheet`).

Your weapon is a first-person prop at 1024 px/m and currently has zero px/m.

The Sunset Overdrive "ultimate trim" technique
(`https://polycount.com/discussion/160794/the-ultimate-trim-technique-from-sunset-overdrive`)
bakes a 45-degree bevel into the normal map so flat geometry shades as beveled.
Note this is the *opposite* trade from yours: they use flat geometry plus a bevel
normal, you use bevel geometry plus no normal. Theirs produces fewer subpixel
triangles. Since you have chamfer geometry already, the lesson to take is not
"add trim sheets" but "your chamfer needs a matching roughness/cavity response,
not just a shading discontinuity".

On breaking up repetition, from Alex Senechal's 80.lv interview
(`https://80.lv/articles/tiling-textures-in-game-environments`): the "70-30"
principle for primary/secondary/tertiary material proportions, ID/RGB masks to
modulate roughness and albedo across a tiling texture, and normal map "floaters"
for unique local detail. Your `weathering.js` is already a world-space version of
the ID-mask idea; extend it to drive roughness, not just albedo.

---

## 5. Atmosphere

### 5.1 Sky: use the real one

`three/addons/objects/Sky.js` verified 200. It is Preetham **plus** a procedural
cloud layer, which most tutorials predate. Exact uniforms at 0.185.1, read from
source:

```js
turbidity: 2, rayleigh: 1, mieCoefficient: 0.005, mieDirectionalG: 0.8,
sunPosition: new Vector3(), up: new Vector3(0, 1, 0),
cloudScale: 0.0002, cloudSpeed: 0.0001, cloudCoverage: 0.4,
cloudDensity: 0.4, cloudElevation: 0.5,
showSunDisc: 1, time: 0.0
```

`class Sky extends Mesh` on a `BoxGeometry(1,1,1)`, so you must
`sky.scale.setScalar(...)`. The WebGPU counterpart is `SkyMesh`.

Tuned values from `webgl_shaders_sky.html`: `turbidity: 10, rayleigh: 3,
mieCoefficient: 0.005, mieDirectionalG: 0.7`, `toneMappingExposure: 0.5`.

**Migration warning**, from the official guide r185 to r186: "A legacy gamma
correction of Sky and SkyMesh has been removed. The effect looks different
compared to previous versions and it is not possible to restore the previous look
with a different parameterization." If you tune Sky now, budget for a re-tune on
the next major bump.

Your existing `sky.js` gradient dome is decent and hand-tuned. The reason to
switch is not the visual on its own; it is that `Sky` gives you a physically
plausible source to prefilter into an environment map (section 7.5), and one sun
vector shared between sky, CSM and IBL. That coupling is most of the "AAA" read.

### 5.2 Height fog: four chunk overrides, near-zero cost

`FogExp2` cannot do height fog. From `fog_vertex.glsl.js`, the entire varying is:

```glsl
vFogDepth = - mvPosition.z;
```

and `fog_pars_fragment` declares only `uniform vec3 fogColor; varying float vFogDepth;`.
There is no world position in the fragment stage at all. `fog_fragment`:

```glsl
#ifdef FOG_EXP2
  float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
#else
  float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
#endif
gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
```

The fix is exactly four overrides: add `varying vec3 vWorldPosition` to
`fog_pars_vertex`, write it in `fog_vertex`, declare it plus height uniforms in
`fog_pars_fragment`, and compute density from `vWorldPosition.y` in
`fog_fragment`. `cameraPosition` is already a three.js built-in uniform, so
camera height is free.

**Do this as a global `THREE.ShaderChunk` override, not `onBeforeCompile`.**
Reason: CSM already claims `onBeforeCompile` on every material you call
`setupMaterial` on, and your `weathering.js` claims it too. Fog via global chunk
composes cleanly with both.

References: Sneha Belkhale, "Three.js Fog Hacks",
`https://snayss.medium.com/three-js-fog-hacks-fc0b42f63386` (runnable StackBlitz,
covers the exact 4-chunk pattern); and
`https://discourse.threejs.org/t/high-performance-ground-fog-for-games-three-js/88522`
which is FBM ground fog explicitly targeted at FPS use with early shader exits
above the fog plane.

Height fog is the highest value-per-hour item in this whole section. It is what
makes a desert read as a *large* desert.

### 5.3 God rays: the honest options

**There is no god rays shader in three.js.** Both
`examples/jsm/shaders/GodRaysShader.js` and
`examples/jsm/postprocessing/GodRaysPass.js` return 404. They were removed.

What the official example actually uses. From
`examples/webgl_postprocessing_godrays.html` at r185, verbatim importmap:

```html
"postprocessing": "https://cdn.jsdelivr.net/npm/postprocessing@6.39.1/build/index.js",
"goodrays":       "https://cdn.jsdelivr.net/npm/three-good-godrays@0.12.0/build/three-good-godrays.esm.js"
```

```js
import { EffectComposer, RenderPass } from 'postprocessing';
import { GodraysPass } from 'goodrays';

const godraysPass = new GodraysPass(pointLight, camera, {
  density: 1 / 128, maxDensity: 0.5, edgeStrength: 2, edgeRadius: 2,
  distanceAttenuation: 2, color: new THREE.Color(0xf6287d),
  raymarchSteps: 60, blur: true, gammaCorrection: true,
});
```

This is **raymarched volumetric sampling the shadow map**, which is the technique
you want. From the library README: "The godrays effect works by raymarching
through the scene and sampling the shadow map to determine which points are in
shadow." Supports `PointLight` and `DirectionalLight`. Repo
`Ameobea/three-good-godrays`, pushed 2026-05-22, 228 stars, not archived.

**Two real constraints.** First, it brings in the `pmndrs/postprocessing`
composer alongside or instead of three's `EffectComposer` - that is an
architectural decision, not a drop-in, and you already have a working
`EffectComposer` chain. Second, versions: `three-good-godrays@0.12.0` declares
peer `three: ">= 0.125.0 <= 0.182.0"` (stale metadata - the official r185 example
ships exactly this version, so it works), and `postprocessing@6.39.x` declares
peer `three: ">= 0.168.0 < 0.186.0"`. You are inside that window at 0.185.1 but
**r186 will break it**.

The other option, `pmndrs/postprocessing` `GodRaysEffect`, is the screen-space
radial blur variant. Defaults: `samples: 60.0, density: 0.96, decay: 0.9,
weight: 0.4, exposure: 0.6, resolutionScale: 0.5`. It only produces rays from an
on-screen light source and dies the moment the sun leaves the frustum. **For an
FPS where the player looks around freely this is a trap.** Do not use it.

The clean option is `three/addons/tsl/display/GodraysNode.js`, which is the same
`three-good-godrays` algorithm vendored into three.js (its own header says so:
"Reference: This Node is a part of three-good-godrays"). Verified present at
0.185.1. Params: `raymarchSteps` default `uint(60)`, `density` `0.7`,
`maxDensity` `0.5`, `distanceAttenuation` `2`. Its header also documents the
correct compositing:

```js
const godraysPass = godrays(scenePassDepth, camera, light);
const blurPass = bilateralBlur(godraysPassColor);
const output = depthAwareBlend(scenePassColor, blurPassColor, scenePassDepth, camera, {...});
```

and states the limitations: "Only point and directional lights are currently
supported" and "The effect requires a full shadow setup." This requires
`WebGPURenderer`, which falls back to WebGL2. That is the strategically cleaner
path if you are willing to migrate the renderer.

### 5.4 Volumetric fog: the primary sources, and why you cannot have it

- Bartlomiej Wronski, **"Volumetric Fog: Unified Compute Shader Based Solution to
  Atmospheric Scattering"**, SIGGRAPH 2014 (Assassin's Creed 4). PDF live:
  `https://bartwronski.com/wp-content/uploads/2014/08/bwronski_volumetric_fog_siggraph2014.pdf`
- Sebastien Hillaire, **"Physically Based and Unified Volumetric Rendering in
  Frostbite"**, SIGGRAPH 2015:
  `https://www.ea.com/frostbite/news/physically-based-unified-volumetric-rendering-in-frostbite`
  (note: the only download on the advances index is a 158 MB PPTX, no PDF)
- Course indexes: `https://advances.realtimerendering.com/s2014/`,
  `https://advances.realtimerendering.com/s2015/`

Both are froxel (frustum-voxel) approaches: a 3D texture of scattering and
extinction, in-scatter accumulated per froxel with shadow map lookups, then a
raymarch or prefix sum along Z. **This needs compute shaders and 3D texture
writes. WebGL2 has neither.** Your ceiling on the WebGL path is the per-pixel
raymarch in `three-good-godrays`, which is the same idea one dimension down.
On the WebGPU path with a WebGPU backend you could in principle do the real
thing, but nothing in three.js ships it.

### 5.5 Dust motes and soft particles

You already have additive `THREE.Points` dust in `materials.js`. What is missing
is **depth fade**, without which every mote pops as a hard-edged disc where it
intersects geometry.

Three.js has no soft-particle material. You need a scene depth texture:
`renderTarget.depthTexture = new THREE.DepthTexture(w, h)` (the pattern is in
`examples/webgl_depth_texture.html`, present at 0.185.1), fed into your particle
`ShaderMaterial`. The clearest verified implementation is Oleksandr Popov's
(`https://dev.to/keaukraine/implementing-soft-particles-in-webgl-and-opengl-es-3l6e`,
source at
`https://github.com/keaukraine/webgl-buddha/blob/master/js/app/SoftDiffuseColoredShader.js`):

```glsl
float calc_depth(in float z) {
  return (2.0 * uCameraRange.x)
       / (uCameraRange.y + uCameraRange.x - z * (uCameraRange.y - uCameraRange.x));
}
vec2 coords = gl_FragCoord.xy * uInvViewportSize;
float sceneDepth    = calc_depth(texture2D(sDepth, coords).r);
float particleDepth = calc_depth(gl_FragCoord.z);
float a = clamp(sceneDepth - particleDepth, 0.0, 1.0);
gl_FragColor = diffuse * smoothstep(0.0, uTransitionSize, a);
```

Keep `transparent: true`, `depthWrite: false`, `blending: AdditiveBlending`, and
update `uInvViewportSize` on resize.

### 5.6 Cheapest high-impact atmosphere, ranked

1. `Sky` plus one shared sun vector plus ACES at exposure ~0.5. Half a day. Zero
   per-frame cost.
2. **Height fog via global ShaderChunk override.** A few hours, near-zero GPU
   cost, biggest depth and scale payoff.
3. CSM with `cascades: 4`, `shadowMapSize: 1024`, `fade = true`.
4. `GTAOPass` (already in your chain) retuned - see section 6.4.
5. God rays. Real cost, architectural decision. Do it after 1-4.
6. Soft dust in beams. Only pays off once you have the beams from 5.

---

## 6. Cinematic post

You already have more post than the scene justifies. The changes here are mostly
subtractive and corrective.

### 6.1 The viewmodel is outside the post chain. Fix this first.

`main.js` lines 265-270:

```js
post.composer.render(dt);
viewmodel.render(renderer);
```

`viewmodel.render` does `renderer.autoClear = false; renderer.clearDepth();
renderer.render(scene, vmCamera);`. The separate camera and depth clear are
architecturally **correct** - that is exactly the double-camera pattern real
shooters use to stop the weapon clipping into walls
(`https://sahildhanju.com/posts/render-first-person-fov/`,
`https://github.com/tiger-punch-sports-club/ue4-fps-double-camera-separate-fov`).

The problem is *where* it happens. Drawing after the composer means the weapon
receives no GTAO, no bloom, no colour grade, and no SMAA. It has jagged edges,
no film grain, no vignette, and a different colour response from the world it is
held in. That is a large part of why it reads as pasted on.

The fix: render the viewmodel **into the composer's target** rather than to
screen. Add a custom pass after `RenderPass` that does the depth clear and
renders the viewmodel scene with `vmCamera`, so everything downstream sees it.
Keep the separate camera and near plane; only move where the draw lands.

### 6.2 TAA vs SMAA

Your `SMAAPass` is fine as far as it goes, but morphological AA cannot fix
specular aliasing, shadow edge crawl, or the alpha-tested palm fronds. Those need
temporal accumulation.

**What exists on the WebGL path:**
- `TAARenderPass(scene, camera, clearColor, clearAlpha)` with `.sampleLevel` and
  `.accumulate`. This is *accumulation* TAA: it only converges while the camera
  is still. Useless for an FPS in motion.
- `SSAARenderPass` with `.sampleLevel = 4` (2^4 = 16 samples). Same problem, it
  is supersampling across frames.

Neither is real motion-vector TAA. **There is no true TAA on the WebGL path.**

**What exists on the node path:** `TRAANode` is real temporal reprojection AA.
Read from source, it implements `_haltonOffsets` jitter, `clipAABB`,
`varianceClipping`, `subpixelCorrection` and `flickerReduction` - i.e. the full
modern TAA feature set. Its own header cites `https://alextardif.com/TAA.html`
and `https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/`, and
warns "MSAA must be disabled when TRAA is in use."

```js
traa(beautyNode, depthNode, velocityNode, camera)
```

It needs a velocity buffer, which means MRT on the scene pass:
`scenePass.setMRT(mrt({ output, velocity }))` using `velocity` from `three/tsl`
(verified exported: `src/Three.TSL.js` line 612).

The reference literature is Jorge Jimenez's, all at Activision:
- **"Filmic SMAA: Sharp Morphological and Temporal Antialiasing"** (SIGGRAPH 2016) -
  `https://research.activision.com/publications/archives/filmic-smaasharp-morphological-and-temporal-antialiasing`
- **"Dynamic Temporal Antialiasing and Upsampling in Call of Duty"** (2020) -
  `https://www.activision.com/cdn/research/Dynamic_Temporal_Antialiasing_and_Upsampling_in_Call_of_Duty_v4.pdf`
  (this URL reset the connection on automated fetch; open in a browser)

The Call of Duty answer to AA is SMAA *plus* temporal, not one or the other.

### 6.3 Sharpening (CAS)

Every temporal or morphological AA softens the image. AAA compensates with a
contrast-adaptive sharpen. AMD's CAS "adjusts the amount of sharpening per pixel
to target an even level of sharpness across the image"; RCAS "uses a more exact
mechanism, solving for the maximum local sharpness possible before clipping" and
"has a built-in process to limit the sharpening of what it detects as possible
noise" (`https://gpuopen.com/fidelityfx-cas/`,
`https://gpuopen.com/manuals/fidelityfx_sdk/reference_documentation/sdk/effect_components/fidelityfx_cas/ffx_cas/`).

three.js ships both on the node path: `sharpen(node, sharpness, denoise)` and
`fsr1(node, sharpness, denoise)` (FSR1 is EASU upscale + RCAS sharpen). Nothing
equivalent on the WebGL path - you would hand-roll a 3x3 CAS kernel, which is
about 15 lines and worth doing regardless of which stack you land on. It is the
single cheapest way to make a post-processed frame stop looking soft.

### 6.4 Your current chain, reviewed

Order in `post.js` is `RenderPass -> GTAOPass -> UnrealBloomPass -> OutputPass ->
GradePass -> SMAAPass`. The reasoning in the comments is correct: bloom in linear
HDR before tone mapping, grade after. Specific notes:

- **GTAO `radius: 0.85` world units is too large for what you need.** GTAOPass
  defaults to `0.25`. At 0.85 it produces broad soft darkening rather than the
  tight contact darkening that makes the 6200 scattered rocks sit on the ground.
  In `shots/02-courtyard.png` the pebbles look pasted on. Try `radius: 0.3` with
  `screenSpaceRadius: false`, and consider a second cheap term for large-scale
  occlusion if you miss it. Note GTAOPass renders its own normal pass with a
  `MeshNormalMaterial` override, which is a full extra geometry pass.
- **Chromatic aberration at `0.0009` scaled by `dist * 2.0`** is reasonable, but
  it is applied to a *tone-mapped, graded* image. Real lens CA happens at
  capture. Practically this reads fine; leave it.
- **Film grain via `fract(sin(dot(...)))`** is the cheap version and it shows: it
  is a static-frequency hash that produces a faint fixed pattern. Real film grain
  is luminance-dependent (more grain in midtones, less in highlights and blacks)
  and is not per-pixel white noise. Cheap upgrade: modulate by
  `luma * (1.0 - luma) * 4.0` so grain vanishes in the blacks and blown highs,
  and animate with a per-frame offset rather than `fract(uTime)`.
- **`uSaturation: 1.14` plus `uContrast: 1.10` plus split-tone plus vignette at
  0.62** is a lot of grade stacked on a scene whose underlying material response
  is flat. Grade is compensating for missing lighting. Once the environment map
  lands, back these off - you will not need them, and they are currently crushing
  the shadow detail you are about to gain.
- **LUT grading** is available: `LUTPass({ lut, intensity })` where `lut` is a
  `Data3DTexture`, verified at 0.185.1. This is the professional version of your
  hand-written lift/gamma/gain. Worth moving to once the look is locked, because
  a LUT is one texture fetch versus your current dozen ALU ops, and it lets a
  colourist hand you a `.cube` file.

### 6.5 Depth of field and motion blur

`BokehPass(scene, camera, { focus, aperture, maxblur })` exists on the WebGL
path. For an FPS, DOF belongs on the ADS transition and nowhere else - a
permanently defocused background reads as a cutscene. You already have an
`fovNormalized` accessor in `camera.js`; drive `aperture` from it.

Motion blur: `motionBlur(inputNode, velocity, numSamples = int(16))` on the node
path only. No WebGL equivalent. Per-object motion blur is arguably wrong for a
shooter anyway (it hurts target acquisition); camera-only blur on fast turns is
the shipped compromise.

---

## 7. Materials: what makes PBR read as real

### 7.1 The single biggest lever is roughness variation

Marmoset's PBR primer states the argument precisely
(`https://marmoset.co/posts/physically-based-rendering-and-you-can-too/`):

> "Its important to note how narrow the range of reflectivity is for insulative
> materials. Combined with the concept of energy conservation it's easy to
> conclude that **surface variation should generally be represented in the
> microsurface map, not the reflectivity map.** For a given material type,
> reflectivity tends to remain fairly constant."

Non-metals all sit near F0 = 0.04. Albedo range is narrow. Metalness is
effectively binary. **Roughness is the only channel with real expressive range
left.** A uniform roughness value therefore describes a surface that does not
exist in the physical world.

Your materials are `roughness: 1.0` across sand, limestone, carved and granite,
with a `roughnessMap` derived from albedo luminance by
`v = hi - (hi - lo) * luminance`. That mapping says "bright means smoother",
which on your masonry means **the fake painted highlight on every block's top
edge becomes the smoothest, most specular part of the wall**. That is backwards
and it is visible.

Fix: generate 3-4 independent roughness octaves at different world scales (one at
~4x object scale, one at surface scale, one at grain scale), plus a term driven
by your height field, and drop the albedo-luminance coupling entirely.

### 7.2 Curvature-driven edge wear

This is the highest-leverage single addition after roughness variation, precisely
*because* your objects are chamfered boxes. The chamfer is the only interesting
feature a 44-triangle object has, and edge wear is what makes a chamfer read as a
manufactured edge rather than a bevel modifier.

Curvature is the Laplacian of height, computable at texture-generation time:

```
curv(u,v) = h(u+e,v) + h(u-e,v) + h(u,v+e) + h(u,v-e) - 4*h(u,v)
edgeWear = smoothstep(0.2, 0.8,  curv)   // convex -> polished, base metal shows
grime    = smoothstep(0.2, 0.8, -curv)   // concave -> dirt accumulates
```

Wire `edgeWear` into roughness down / metalness up / albedo toward base metal.
Wire `grime` into roughness up / albedo darker / AO down. This is what Substance's
curvature generators do; you are doing it in JS.

For *geometric* curvature (the chamfer itself, which your height field knows
nothing about) you can add a screen-space term:

```glsl
vec3 dN = fwidth(normal);
float geoCurv = (dN.x + dN.y + dN.z) / max(fwidth(vViewPosition.z), 1e-4);
```

This is view-dependent and distance-varying, so use it only as a soft additive on
top of the texture-space term.

Reference: `http://wiki.polycount.com/wiki/Curvature_map`.

### 7.3 aoMap, and a correction to stale advice

The r0.185.1 `aomap_fragment` chunk, verbatim:

```glsl
#ifdef USE_AOMAP
	// reads channel R, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif
```

**The "aoMap needs uv2" advice you will find everywhere is stale.** Pre-r151 it
was hardwired to `vUv2`. Since the r151 UV refactor the chunk uses `vAoMapUv` and
the source attribute is chosen by `texture.channel`, which defaults to `0`
(verified: `src/textures/Texture.js` line 118, `this.channel = 0`; and
`src/renderers/webgl/WebGLProgram.js` line 535,
`parameters.aoMapUv ? '#define AOMAP_UV ' + parameters.aoMapUv : ''`).

So at 0.185.1, `aoMap` works with your existing single UV set out of the box. No
second UV attribute needed.

**But note the second-order consequence:** `aoMap` multiplies **indirect** light
only. With no environment map and `AmbientLight` at intensity `0.05`, there is
almost no indirect term to occlude, so an AO map would currently do nearly
nothing. AO becomes valuable *after* you add the environment map, not before.
That is a dependency in your implementation order.

Cavity (tight, small-radius occlusion: mortar lines, scratch creases) is a
different thing from AO and three.js has no slot for it. Fold cavity into your
generated albedo and roughness at texture-generation time - the concave half of
the curvature signal above is exactly it.

### 7.4 MeshPhysicalMaterial at 0.185.1

Verified present in `src/materials/MeshPhysicalMaterial.js`: `anisotropy`,
`anisotropyRotation`, `anisotropyMap`, `clearcoat`, `clearcoatMap`,
`clearcoatRoughness`, `clearcoatRoughnessMap`, `clearcoatNormalMap`,
`clearcoatNormalScale`, `ior` (default 1.5), `iridescence`, `iridescenceMap`,
`iridescenceIOR` (1.3), `iridescenceThicknessRange` (`[100, 400]`),
`iridescenceThicknessMap`, `sheen`, `sheenColor` (`0x000000`), `sheenColorMap`,
`sheenRoughness` (1.0), `sheenRoughnessMap`, `transmission`, `transmissionMap`,
`thickness` (0), `thicknessMap`, `attenuationDistance` (`Infinity`),
`attenuationColor`, `specularIntensity` (1.0), `specularIntensityMap`,
`specularColor`, `specularColorMap`, `dispersion`.

`reflectivity` is not a stored field - it is a computed property over `ior`:
`clamp(2.5 * (ior - 1) / (ior + 1), 0, 1)`.

Warning from the class JSDoc, verbatim: "As a result of these complex shading
features, MeshPhysicalMaterial has a higher performance cost, per pixel, than
other three.js materials... **For best results, always specify an environment map
when using this material.**"

Also: `anisotropy`, `clearcoat`, `dispersion`, `iridescence`, `sheen` and
`transmission` are getter/setters that bump `material.version` when crossing
zero, forcing a shader recompile. Do not animate them per frame.

**For your game:** stay on `MeshStandardMaterial` for the world. Use
`MeshPhysicalMaterial` selectively: `clearcoat` on the weapon's painted metal
and any wet surface, `sheen` on the linen, `anisotropy` on brushed gun parts.
Skip `transmission` entirely (separate render pass, expensive) unless you want
real glass in the scope.

### 7.5 Environment map: the fix, in full

This is BLUF item 1. Without an env map, `reflectedLight.indirectSpecular` has
essentially nothing in it. Metals have no diffuse term at all, so they render
near-black. Roughness stops mattering because there is nothing for it to blur.
Fresnel does nothing at grazing angles because there is nothing to reflect. That
combination is precisely the plastic look in your screenshots.

`PMREMGenerator` is a **core** export from `three`, not an addon. Signatures
verified from `src/extras/PMREMGenerator.js`:

```js
new PMREMGenerator(renderer)
  .fromScene(scene, sigma = 0, near = 0.1, far = 100, options = {})   // options.size = 256, options.position
  .fromEquirectangular(equirectangular, renderTarget = null)
  .fromCubemap(cubemap, renderTarget = null)
  .compileEquirectangularShader()
  .dispose()
```

Worth knowing: PMREM prefiltering at r185 uses **GGX VNDF importance sampling**
(`GGX_SAMPLES = 256`) so the prefiltered map matches the GGX BRDF the materials
actually use. Env maps at this version match better than older releases.

**Five-minute version, do this today:**

```js
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;   // dial to taste
```

**Correct version for your outdoor scene**, prefiltering the actual sky. This is
the pattern from `examples/webgl_shaders_ocean.html` at r185:

```js
const sky = new Sky();
sky.scale.setScalar(10000);
scene.add(sky);

const pmrem = new THREE.PMREMGenerator(renderer);
const sceneEnv = new THREE.Scene();
let envRT;

function updateSun(sunVec) {
  sky.material.uniforms.sunPosition.value.copy(sunVec);

  if (envRT) envRT.dispose();               // or you leak GPU memory

  sky.material.uniforms.showSunDisc.value = 0;   // see note below
  sceneEnv.add(sky);                             // sky must be alone in the captured scene
  envRT = pmrem.fromScene(sceneEnv);
  scene.add(sky);                                // move it back for background rendering
  sky.material.uniforms.showSunDisc.value = 1;

  scene.environment = envRT.texture;
}
```

Two details that matter. **Hide the sun disc before prefiltering** - `Sky.js`
exposes `showSunDisc` for exactly this reason, and if you leave it on, the disc
becomes a searing hot spot in the prefiltered map and every rough surface gets a
blown-out blob. **Do not regenerate per frame** - PMREM is a multi-pass GPU job.
Regenerate only when the sun moves, which for you is never or once per wave.

Then feed the same sun vector into `csm.lightDirection` (negated). Sky, shadows
and IBL agreeing on one sun is the coupling that reads as "real engine".

Expected effect on your existing materials: `gunmetal` and `gold` come alive,
`granite` gains a real specular response, the chamfer highlight stops being a
blown white stripe and becomes a graded reflection, and every shadowed face gains
directional fill instead of the flat hemisphere term. You will then want to
reduce `HemisphereLight` intensity from `0.42` and possibly delete the `bounce`
directional light entirely, because the env map is doing that job properly.

### 7.6 Call of Duty's own material literature

If you want the actual source material for how CoD authors surfaces, it is public
at `https://research.activision.com/publications`:

- Danny Chan, **"Real-World Measurements for Call of Duty: Advanced Warfare"** (2018)
- Danny Chan, **"Material Advances in Call of Duty: WWII"** (2018)
- Michal Drobot, **"Practical Multilayered Materials in Call of Duty: Infinite
  Warfare"** (2017) - multilayer PBR optimised for Forward+
- Chan & Iwanicki, **"Reflectometer Material Capture"** (2024) - a portable device
  measuring "diffuse albedo, smoothness, and specular F0 in the field"

The through-line across all of them is measurement: they built hardware to
measure real F0 and smoothness because guessing produces the plastic look. You
cannot measure, but you can respect the constraint: keep non-metal F0 at 0.04,
keep metalness binary, and put all your variation in roughness.

---

## 8. Browser games that have actually got close

The short version: **no shipped browser game matches current AAA, and the ones
that look best did not get there through the rendering pipeline.** They got there
through art direction that hides the gap, aggressive payload reduction, and
baking whatever could be baked. That is the single most useful finding in this
whole document, because it is directly actionable for you.

### 8.1 The one you should study first: Seemore (Arm + PlayCanvas)

Live: `https://playcanv.as/p/MflWvdTW/`
Writeups: `https://blog.playcanvas.com/the-making-of-seemore-webgl/` and
`https://blog.playcanvas.com/arm-and-playcanvas-open-source-seemore-webgl-demo/`

Relevant because its headline technique is **exactly the thing you are missing**:

- **Prefiltered cubemaps** where each mip level corresponds to a different
  roughness, generated by GPU importance sampling and consumed via
  `EXT_shader_texture_lod`. This is PMREM by hand, before three.js had
  `PMREMGenerator`. It is what makes their materials read as materials.
- **Box-projected cubemap environment mapping** - the reflection vector is
  intersected against a world-space AABB rather than treated as infinitely
  distant. Applied to both reflection and refraction. For your interior rooms
  (`build.js` corridors, chambers, sanctum), this is the upgrade path after a
  global env map: a per-room box-projected cubemap makes enclosed spaces read as
  enclosed.
- Custom shader chunks for dual baked AO with dynamic interpolation, fake foliage
  translucency via emission attenuation, procedural vertex animation.

### 8.2 After the Flood (PlayCanvas, WebGL2, 2017)

Demo: `https://playcanv.as/p/44MRmJRU/`
Engine blog: `https://blog.playcanvas.com/mozilla-launches-webgl-2-with-playcanvas/`
Developer writeup: `https://ndotl.wordpress.com/2017/01/27/after-the-flood/`

Probably the highest-fidelity pure-WebGL2 scene ever shipped. Techniques cited:
HDR rendering with MSAA, transform feedback for GPU leaf particles, 3D textures
for procedural clouds, hardware PCF shadows, **alpha-to-coverage for antialiased
foliage**, runtime lightmap baking, planar mirrors, compressed textures.

Two directly transferable ideas:

- **Alpha-to-coverage for foliage.** Your palm fronds are `DoubleSide` opaque
  quads. Alpha-tested foliage with A2C is the standard fix and it is the cheapest
  route to a palm that does not look like a PS1 asset.
- **Water normals built from mixed small-scale ripple and large-scale wave
  normal maps, regenerated by a fragment shader every frame** at a quality-tiered
  rate. The same two-scale structure is exactly what your sand needs: a large
  ripple field plus a fine grain field, blended, rather than one 512px texture
  doing both jobs badly.

Source is not public (`https://github.com/playcanvas/engine/issues/1192`, asked
2018, never answered). No performance numbers were ever published.

Note the same developer built **Robostorm**, a shipped PlayCanvas browser game,
and his CV (`https://ndotl.wordpress.com/cv/`) lists the engine work behind it:
particle systems, the in-engine lightmapper, "migration from basic phong shading
to PBR", point light shadows.

### 8.3 Star-Lord: the only case study with a real before/after table

`https://blog.playcanvas.com/webgl-case-study-rebuilding-the-star-lord-pbr-demo/`

2014 versus 2021, same asset, cache disabled:

| Metric | 2014 | 2021 |
|---|---|---|
| HTTP requests | 220 | 39 |
| Preload transfer | 10.1 MB | 5.6 MB |
| Total resources | 26.0 MB | 12.1 MB |
| Load time | 1.8 s | 1.2 s |

Texture format comparison from the same page: DXT 7.56 MB, ETC1 7.18 MB, PVR
6.09 MB, **Basis 2.38 MB**. Cubemap prefiltering collapsed 180 PNGs (6 faces x 6
mips x 5 cubemaps) into 5 DDS files.

Less relevant to you directly, since you ship zero texture bytes. Worth knowing
as the benchmark for what "shipping a high-fidelity asset to a browser" costs
when you do use assets - which is the trade you would be making if you hand-author
the weapon.

### 8.4 Active Theory, Pottermore "Welcome to Hogwarts"

`https://medium.com/active-theory/hogwarts-a66678d66283`

The most instructive case study I found, and the one whose *lesson* applies most
directly to your situation.

They cut **6,000,000 triangles down to 210,000**. A custom Maya Python exporter
stripped UVs and normals and stored positions at 4 decimal places, producing
**2.1 MB gzipped versus 24.1 MB glTF and 37.4 MB OBJ**. A single lantern
compressed to 1 KB plus 500 bytes of placement data. The whole castle loads in
under 5 seconds on mobile.

Then the part that matters: **they explicitly refused realism.** Fog-heavy
stylisation that reads silhouettes rather than textures, which removed the need
for large textures and real-time lighting entirely. Window glow was done by
expanding geometry in the vertex shader rather than a bloom pass.

The transferable insight is not "give up on realism". It is that **atmosphere and
silhouette carry more perceived quality per byte and per millisecond than surface
detail does.** That is precisely why height fog ranks above god rays and above
POM in my ordering.

### 8.5 Active Theory's engine choices

`https://medium.com/active-theory/the-story-of-technology-built-at-active-theory-5d17ae0e3fb4`

They replaced three.js with their own engine, Hydra. The single architectural
decision they call out: **abstract materials replaced with explicit shaders.**

Worth reading before you invest further in `onBeforeCompile` patching. You are
currently at three overlapping patch sites (weathering, and soon CSM and detail
normals), all fighting over one hook on the same materials. At some point the
honest move is a purpose-built `ShaderMaterial` for your world surfaces, or a
migration to TSL where composition is a first-class operation rather than string
replacement. You are not there yet, but you are on that road.

Also from Active Theory: **composite rendering**
(`https://tympanus.net/codrops/2026/02/23/composite-rendering-the-brilliance-behind-inspiring-webgl-transitions/`)
- render scenes to `WebGLRenderTarget`s and composite with a single fullscreen
clip-space quad, folding all post into that one pass. This is the clean pattern
for getting your viewmodel into the post chain (section 6.1).

### 8.6 Lusion

Studio case study: `https://www.awwwards.com/case-study-for-lusion-by-lusion-winner-of-site-of-the-month-may.html`
Car demo: `https://exp-gemini.lusion.co/`

Their look comes from **offline precomputation smuggled into runtime data**:
cloth pre-simulated in Houdini and blended at runtime; vertex animation baked
into PNG position and normal maps (exploiting LZW compression); 11 keyframes
instead of 66 with runtime interpolation; 32-bit floats downgraded to 16-bit ints
with a divider, recovered in the shader. Matcaps and pre-rendered normal maps for
translucency, with the base pre-rendered in Redshift and composited live.

Final payloads: desktop cloth 4,096 verts at 983 KB, interactive cloth buffer
220 KB gzipped.

The lesson for a procedural project: **precomputation at boot is free realism.**
You generate everything at load already. Generating *more* at load - curvature
maps, cavity maps, roughness octaves, mip chains with baked normal variance - costs
you milliseconds once and nothing per frame.

### 8.7 Runtime lightmap baking, which you can actually do

PlayCanvas Sponza demo: `https://playcanv.as/p/txPePQvy/`

PlayCanvas bakes **65 lightmaps from 5 lights across a 240,000-triangle scene in
a few hundred milliseconds at app start**, hitting 60 fps on a MacBook Pro, Nexus
5 and iPhone 6 where 5 filtered shadow maps would not.

**three.js has an equivalent and it ships in your version.** Verified 200:

```js
import { ProgressiveLightMap } from 'three/addons/misc/ProgressiveLightMap.js';
const plm = new ProgressiveLightMap(renderer, 1024);   // (renderer, res = 1024)
plm.addObjectsToLightMap([...staticMeshes, ...lights]);
// then per frame while converging:
plm.update(camera, blendWindow = 100, blurEdges = true);
```

From its own header: "Progressive Light Map Accumulator, by zalo... add an array
of semi-static objects and lights to the class once, and then call
`plmap.update(camera)` every frame to begin accumulating lighting samples."
It atlases UVs with `potpack` and accumulates into a float render target.
`ProgressiveLightMapGPU.js` is the WebGPURenderer counterpart, also 200.

Your courtyard is built once at boot and never moves. It is a textbook candidate.
Converge over the title screen and you get soft indirect shadowing on all static
architecture for free at runtime. This is the closest thing to baked GI available
to you and I nearly missed it.

### 8.8 Browser games specifically, and the honest verdict

- **Krunker.io** is built on three.js and is deliberately low-poly. It was never
  trying to look AAA; the art direction *is* the performance strategy.
- **Venge.io, Bullet Bonanza (Kiloo), Mini Royale: Nations, Warbands, Fields of
  Fury, Robostorm** are all PlayCanvas, per the official
  `https://github.com/playcanvas/awesome-playcanvas`. **No technical writeup
  exists for any of them.**
- **Epic Citadel** (UE3 via asm.js, 2013,
  `https://blog.mozilla.org/futurereleases/2013/05/02/epic-citadel-demo-shows-the-power-of-the-web-as-a-platform-for-gaming/`)
  was the high-water mark for "AAA engine in a browser", and Epic subsequently
  abandoned the path. There has been no official Unreal web export since 4.23.
  UE5's answer is Pixel Streaming, which is server-side rendering plus WebRTC
  video - not applicable to you.

**Verdict: there is no shipped browser FPS whose visuals you should be
benchmarking against.** Your realistic comparison set is the demos above, and the
demos beat every shipped browser game by a wide margin. That is good news: the
bar you are actually chasing is "After the Flood" and "Seemore", not Call of
Duty, and both of those are reachable.

### 8.9 One more tier, for context: what genuinely looks photoreal on the web

Gaussian splatting is the only browser rendering that a layperson calls
photoreal. PlayCanvas's SuperSplat numbers
(`https://blog.playcanvas.com/new-in-supersplat-webgpu-and-streaming-bring-huge-performance-wins/`)
on an M4 Max at 1298x962: 10M gaussians at 124 fps under WebGPU versus 48 under
WebGL2; 30M at 85 fps versus 15.6. World Labs' Spark 2.0
(`https://www.worldlabs.ai/blog/spark-2.0`) runs continuous LOD against a fixed
budget of 500K to 2.5M splats depending on device, on **WebGL2 exclusively**.

Not applicable to a procedural game - splats are captured reality, you cannot
author them - but it establishes where the photoreal ceiling actually sits on the
web, and it is nowhere near traditional rasterised PBR.



---

## 9. What we cannot get, and why

Being honest about the ceiling, because knowing where it is stops you burning
weeks on the wrong thing.

**Hard platform limits (WebGL2):**

- **No compute shaders.** This rules out froxel volumetric fog (Wronski/Hillaire),
  GPU-driven culling, clustered light binning done properly, and most modern
  particle systems. The WebGPU backend lifts this, but nothing in three.js ships
  a froxel volumetric even there.
- **No ray tracing, at all, on either backend.** No RT shadows, no RT reflections,
  no RT GI. Everything is screen-space or precomputed.
- **No mesh shaders, no bindless.** Nanite-class geometry is not on the table.
- **No hardware VRS.** CoD's software VRS (Drobot, SIGGRAPH 2020) is not
  reproducible without compute.

**Practical limits of procedural-only authoring:**

- **You will not get asset-quality hero props.** A CoD weapon is 30-80k triangles
  with 4K hand-authored albedo, normal, roughness, metalness, AO and cavity maps,
  built by an artist over days. Procedural generation gets you a good *system* and
  a mediocre *object*. The gap on the weapon specifically is the one place where
  the honest answer is "hand-author this one asset, or accept it will never look
  AAA".
- **You will not get production-grade baked GI, but you can get more than I first
  assumed.** CoD's look leans enormously on precomputed lighting - Silvennoinen's
  "Large-Scale Global Illumination in Call of Duty" (2021), Sloan &
  Silvennoinen's "Precomputed Lighting Advances in Modern Warfare" (2020),
  Iwanicki's "The Neural Light Grid" (2024). Those are multi-hour offline bakes
  over hand-placed geometry with artist-authored probe volumes. That is out of
  reach.

  **However**, runtime lightmap accumulation is not. `ProgressiveLightMap`
  ships in your version (section 8.7) and PlayCanvas does the same thing in
  production on a 240k-triangle Sponza in a few hundred milliseconds. Your
  courtyard is static after boot, which is exactly the precondition. This gets
  you soft indirect shadowing on static architecture, not full GI - no colour
  bleeding worth the name, no dynamic objects - but it is a real intermediate
  tier between "nothing" and "CoD". Combine it with a prefiltered env map and
  GTAO, and `SSGINode` if you migrate renderers.
- **Procedural noise has a signature.** FBM-derived surfaces read as FBM to a
  trained eye no matter how well you layer them. Real materials have structure at
  scales noise does not produce: tool marks, wear paths that follow use, damage
  that follows physics. You mitigate with decals and hand-placed variation, not
  with more octaves.
- **No character/animation fidelity.** Nothing in this document addresses
  characters, and an FPS with AAA environments and blocky enemies reads as a
  prototype regardless of the rendering.

**Realistic target:** you can credibly reach the visual quality of a good
2010-2014 console shooter - Crysis 2 / Battlefield 3 era. That is a very good
place to land and it is a completely different category from where the
screenshots currently sit. "Call of Duty proper" in the 2024 sense is not
reachable in a browser with procedural assets, and any plan that assumes it is
will waste effort.

The gap that closes fastest is **lighting response** (env map, cascades,
atmosphere). The gap that closes slowest is **asset fidelity**. Spend
accordingly.

---

## 10. Prioritised implementation order

Grouped into passes. Each pass is independently shippable and visibly better than
the one before.

### Pass 1: lighting response (highest ratio, roughly one day)

1. `scene.environment` from `RoomEnvironment` + `PMREMGenerator`. Ten lines.
   Immediately fixes every metal in the game.
2. Reduce `HemisphereLight` from `0.42`, consider deleting the `bounce`
   directional. The env map does that job correctly now.
3. Back off the grade in `post.js`: `uSaturation` and `uContrast` toward 1.0,
   `uVignette` down. They are currently compensating for missing lighting.
4. Retune `GTAOPass` `radius` from `0.85` toward `0.3` for real contact darkening.

### Pass 2: shadows (roughly one day)

5. Swap the single directional shadow for `CSM` with `cascades: 4`,
   `shadowMapSize: 1024`, `maxFar` tuned to your actual view distance.
6. **Set `csm.fade = true`** after construction and call `updateFrustums()`.
7. Compose `csm.setupMaterial()` with your existing `weathering.js`
   `onBeforeCompile` hooks. Do not let CSM clobber them.
8. Restore the warm sun tint on `csm.lights[i].color` and set `normalBias` per
   cascade light. Move acne control off `bias`.

### Pass 3: the weapon (highest absolute impact, two to three days)

9. Move the viewmodel render **inside** the composer so it gets AO, bloom, grade
   and AA. Keep the separate camera and depth clear.
10. Author real materials for it: procedural gunmetal with roughness variation,
    edge wear from curvature, a detail normal, and env reflection. It is one
    object at 1024 px/m equivalent - this is where hand-tuning pays most.
11. Add AO baked or screen-space on the weapon specifically; a gun with no
    occlusion in its crevices reads as a toy.

### Pass 4: surfaces (two to three days)

12. Replace the Sobel with analytic-derivative height fields. Start with sand,
    which is the worst offender at close range.
13. Remove the painted lighting from `paintMasonry` albedo (the light top lip and
    dark bottom lip). Let the normal map and the actual sun do that work.
14. Decouple `roughnessMap` from albedo luminance. Generate independent roughness
    octaves.
15. Add one shared high-frequency detail normal, RNM-blended via the
    `normal_fragment_maps` patch, tiled 8-16x. This is the fix for near-field
    flatness.
16. Add curvature-driven edge wear and crevice grime masks.

### Pass 5: atmosphere (one to two days)

17. Height fog via global `ShaderChunk` override. Highest value in this pass.
18. Swap the gradient dome for `Sky`, share the sun vector with CSM and re-derive
    the env map from it.
19. Soft-particle depth fade on the existing dust.
20. `ProgressiveLightMap` convergence over the title screen for static
    architecture (section 8.7). Your courtyard never moves after boot, so this is
    nearly free indirect lighting.
21. Alpha-to-coverage foliage for the palms, replacing the opaque `DoubleSide`
    quads (After the Flood, section 8.2).

### Pass 6: composition and detail (ongoing)

22. Silhouette variety: per-instance jitter, missing drums, chipped corners.
23. `DecalGeometry` for localised grime, scorch, cracks. Big tiling-breaker.
24. Cluster the `scatter.js` instances against walls instead of distributing
    evenly.
25. IQ Technique 3 tiling suppression on sand and large walls only.
26. vMF roughness bake into the mip chain to kill distant specular shimmer.
27. Box-projected cubemaps per interior room, once the global env map is in
    (Seemore, section 8.1).

### Pass 7: decide on the renderer (a strategic fork, not a task)

28. Evaluate migrating to `WebGPURenderer` + `RenderPipeline` + TSL. What it
    unlocks that WebGL2 cannot give you at all: `GodraysNode` (raymarched
    volumetrics), `TRAANode` (real motion-vector TAA), `SSGINode` (screen-space
    GI), `MotionBlur`, `SharpenNode`/`FSR1Node` (CAS), `ClusteredLighting` for
    your interior point lights.

    The cost is real: node materials are a different authoring model, your
    `onBeforeCompile` patches all become TSL, and the WebGL2 fallback path for
    the node postprocessing stack needs validating on your target hardware.

    My read: **do Passes 1 through 5 on WebGL first.** They are where the visual
    return is, they are all portable in concept, and they will tell you whether
    the remaining gap is worth a renderer migration. Do not start with the
    migration.

---

## Appendix: uncertainty register

Things stated with less than full confidence, flagged so nobody builds on sand.

- Could not fetch the Deliot & Heitz JCGT paper body (size limit) or Unity's
  stochastic texturing blog (403). The algorithm summary in 3.8 comes from
  Heitz's project page and Jason Booth's writeup, not the paper itself.
- Could not fetch the Polycount "Of Bit Depths, Banding and Normal Maps" thread
  (403). The banding analysis in 3.3 is from Ben Golus plus first-principles
  quantisation math.
- Could not fetch the Activision TAA PDF or the Filmic SMAA PDF (connection
  reset / refused). URLs are correct and the papers are real; the TAA feature
  descriptions in 6.2 come from reading `TRAANode.js` source directly, which is
  better evidence anyway.
- No verifiable primary source found for a Star Citizen macro/meso/micro normal
  layering system. Treat as unconfirmed.
- Capsule shadows: no three.js implementation, and the Unreal documentation
  returned 403. Not verified beyond "does not exist here".
- The PCSS example's broken `.replace()` was verified by exact string comparison
  against the current chunk source, not by running the page in a browser.
- `three-good-godrays@0.12.0` peer range excludes 0.185.1, but the official r185
  example ships exactly that version. Treated as stale metadata. Verify at
  runtime before committing to it.
</content>
</invoke>
