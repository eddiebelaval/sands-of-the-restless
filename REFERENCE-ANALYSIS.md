# REFERENCE ANALYSIS: mshumer/Claude-of-Duty vs Sands of the Restless

Reference obtained by `git clone --depth 1 https://github.com/mshumer/Claude-of-Duty`
on 2026-07-25. Cloned, `npm install`ed, run under Vite, and screenshotted through
its own shot API on a real GPU (`--use-angle=metal`). Every claim below is
grounded in a file and line I read, or in a PNG I looked at. Where I could not
verify something I say so.

Reference working copy: `/private/tmp/.../scratchpad/cod-ref`
Reference screenshots: `/private/tmp/.../scratchpad/ref-shots/{hero,detail,weapon,sunset,interior,combat}.png`

---

## P0 BEFORE ANYTHING ELSE: our build currently renders a black world

This is not part of the comparison. It is a live regression I hit while trying
to capture our current state, and it invalidates every screenshot in `shots/`
taken after `ibl-on.png`.

`shots/world-assets.png`, `shots/02-courtyard.png`, `shots/03-walked.png` and
all seven `gun-w-*.png` are black frames with only the viewmodel visible. I
first assumed a SwiftShader artefact. It is not: I re-captured on a real GPU
(Metal, 70 fps, zero console errors or warnings) and got the same black frame.

Cause, verified by runtime experiment rather than by reading:

`src/core/post.js:57-64`

```js
render(renderer, writeBuffer, readBuffer) {
    if (!this.viewmodel) return;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.viewmodel.scene, this.viewmodel.camera);
}
```

`WebGLRenderer.autoClear` defaults to `true`, and `src/core/renderer.js` never
turns it off. So `renderer.render(...)` on line 63 clears **colour and depth**
of `readBuffer` before drawing the gun. The world the composer just spent five
passes building is wiped every frame. `clearDepth()` on line 61 is correct and
was clearly the intent; it is simply not sufficient while `autoClear` is true.

Proof: I injected `renderer.autoClear = false` into the running page and the
entire courtyard came back instantly, at high fidelity, with the gun still
composited on top. Screenshot at
`/private/tmp/.../scratchpad/our-shots/fixtest-autoclear-off.png`.

The scoped fix (do not set `autoClear = false` globally, that breaks the
`RenderPass` clear):

```js
render(renderer, writeBuffer, readBuffer) {
    if (!this.viewmodel) return;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.viewmodel.scene, this.viewmodel.camera);
    renderer.autoClear = prevAutoClear;
}
```

Note also that `test/shot.mjs` reported `PASS: no console errors or warnings`
on a completely black frame. A harness that cannot tell "rendered the game"
from "rendered nothing" is worth fixing at the same time: a mean-luminance
assertion on the captured PNG would have caught this.

For the comparison below I use `shots/ibl-on.png` (2026-07-25 20:47) as our
real current state, because it is the last capture that actually contains a
world.

---

## BLUF: the five things they do that we do not, ranked by visual impact

Ranked by how much of the perceived gap each one closes, not by effort.

### 1. Scene content: enclosure, prop density, and silhouette variety

This is the whole ballgame and it is not a rendering technique.

Their `hero` frame is a 120 m market street with buildings on both sides
forming a corridor, market stalls, awnings, sandbag emplacements, jersey
barriers, balconies with railings, drainpipes, power lines catenary-slung
across the street, laundry, palms, and litter in the gutters. Ours is an open
sand plaza with one temple facade, two low walls, one palm, and 6,200
pebble-scale scatter instances.

Concretely, on their side:
- 18 buildings, 3 enterable (`src/world/index.js:25`).
- 62 instanced prop prototypes: 54 in `src/world/props.js:903-994`, 8 more in
  `src/world/dressing.js:153-320`.
- Placement is occupancy-tested and dense: `scatterDebris`
  (`src/world/dressing.js:1731-1863`) alone places 340 items along the building
  line with exponential wall falloff, 180 on the road pushed to the gutters,
  220 vegetation instances in kerb cracks, 60 litter drifts each spawning 2-6
  more. `src/world/ground.js` adds 130 sand drifts, 26 dirt patches, 30 tarmac
  show-through patches, 7 manholes, 10 gully gratings.
- Anti-clone jitter on every loose prop: per-instance yaw, two-axis tilt, scale
  and sink (`src/world/builder.js:239-262`), with the comment "the
  identical-clone read is the loudest tell in an instanced prop cloud."
- Thin geometry everywhere. `plainBox` (12 tris, `src/world/util.js:369`) exists
  specifically for "window frame rails, shutter slats, balusters, grille bars -
  of which the level has tens of thousands". `catenaryTube` (`util.js:991`)
  makes the power lines.

The "Minecraft" read is not caused by blockiness. Our chamfered box and theirs
are the *same primitive at the same triangle count* (see §Geometry below). It is
caused by: everything being at one scale, nothing overlapping anything else,
nothing thin in frame, and no enclosure. An open plane with objects sitting on
it is what Minecraft looks like. A corridor with layered occlusion at three
scale tiers is what a shooter looks like.

**Our change:** `src/world/rooms.js` + `src/world/build.js`. Build an enclosed
space, not an open plaza. Add a prop kit with a scale ladder: architectural
(walls, columns), furniture-scale (crates, urns, braziers, sacks, scaffolding),
and thin (ropes, poles, hanging cloth, chains, railings). `src/world/scatter.js`
already has the instancing machinery; it currently spends its entire 6,200
budget on one scale tier.

### 2. Sky and atmosphere

Second-largest pixel area in every outdoor frame, and ours is the weakest thing
in the build.

Ours (`src/world/sky.js:41-68`) is a three-colour gradient dome plus
`pow(cosA, 28.0)` sun glow, with `FogExp2(0xe8d9b8, 0.0055)` in `main.js:50`.
It has no clouds and no altitude structure.

Theirs is a full physical model:
- `src/sky/atmosphere.js:1-18`: Hillaire 2020 with three LUTs - transmittance
  256x64, multiscatter 32x32, sky-view 384x192. Rayleigh scale height 8 km,
  sigma_s = (5.802, 13.558, 33.1); Mie 1.2 km; **ozone tent at 25 km**, with the
  note "the ozone layer is not a nicety: it is what removes the green from the
  deep zenith blue".
- Mie phase via Cornette-Shanks at **g = 0.8** (`atmosphere.js:138-144`). LUTs:
  transmittance 256x64 Float32 (40 steps), multiscatter 32x32, sky-view 384x192.
  Static LUTs baked once at boot; sky-view rebaked only when the sun moves more
  than 0.35 degrees. Measured cost: 0.15/0.9 ms at boot, 0.6 ms per sun move.
- **The clouds are the cheap part, and this is the most portable finding in the
  whole repo.** They are *not* a volume march. They are two 2.5D shells on the
  dome (cumulus 1.5 km, cirrus 7.8 km, `src/sky/clouds.js:49-50`), evaluated
  per-pixel inside the dome fragment shader. Vertical extent is faked with a
  parallax shear (`clouds.js:271-318`):

```glsl
float dBase = skCumulusDensity( p0, octD );
vec2 shear = rayDir.xz * ( 0.85 * dBase / max( 0.10, rayDir.y ) );
float d = max( skCumulusDensity( p0 + shear, octD ), dBase * 0.55 );
```

  Self-shadowing is a **3-tap** march toward the sun on the deck
  (`clouds.js:179-186`), not a volume integral. Noise is hash-based value-noise
  FBM at 6/4/2 octaves by role. A CPU twin (`cloudSunOcclusion`,
  `clouds.js:364-374`) dims the `DirectionalLight` to match what is drawn. Total
  cost: one extra term in a shader we would already be writing.
- `src/sky/volumetrics.js`: half-resolution raymarch (28/44/56 steps by quality),
  exponentially distributed, IGN-dithered over 64 frames, shadowed by 4 Vogel
  taps into the renderer's live cascade array, temporally reprojected with a
  widened 3x3 neighbourhood clamp at blend 0.9, then depth-aware bilateral
  upsampled. Dual-lobe HG phase, g_fwd 0.76 / g_back -0.36, back weight 0.34.
  No radial blur and no billboard god rays anywhere.
- The sky is baked to a 512x256 equirect and PMREM'd at cube size 128, from the
  *same shader*, regenerated at most every 250 ms when the sun moves
  (`src/sky/index.js:319-324`, `:120-123`).

The distant buildings in their `hero` shot fade to a blue haze. Ours fade to
`0xe8d9b8` uniform fog. That difference is most of the depth read.

**Our change:** `src/world/sky.js` and `src/main.js:50`.
`three/addons/objects/Sky.js` is present at 0.185.1 (verified HTTP 200) and now
carries cloud uniforms alongside the Preetham parameters. Drive it from sun
elevation, PMREM it into `scene.environment` instead of the static Poly Haven
HDRI, and replace `FogExp2` with height fog. Detail in the plan below.

### 3. Shadows: cascades, texel snapping, and PCSS contact hardening

Ours: one `DirectionalLight` with a single 2048 map over a 92x92 ortho box that
follows the player (`src/world/sky.js:98-107`) with no texel snapping, so
shadows crawl as you walk, and one uniform penumbra at all distances.

Theirs (`src/render/csm.js:3-20`, and the class body):
- N cascades in one `WebGLArrayRenderTarget`, R32F, `sampler2DArray` - one
  texture unit total, so materials keep their own map slots (`csm.js:47-58`).
- Cascades fitted to the **bounding sphere** of each sub-frustum so the ortho
  extent is rotation-invariant, then snapped to whole texels. "That removes
  shadow swimming completely: the sampled texel grid is nailed to world space,
  not to the camera."
- PCSS: blocker search, penumbra estimate, Vogel-disk PCF. Contact-hardening -
  sharp where the caster touches the receiver, soft metres away.
- Normal-offset plus slope-scaled bias in **world** units derived from the
  cascade's texel size.
- Deliberate cap at 2048: "4 x 4096 x R32F is a quarter of a gigabyte for
  shadows nobody can see. 2048 with PCSS reads sharper than 4096 without it."
  (`csm.js:38-40`)
- Separately, screen-space **contact shadows**: a 0.4 m depth-buffer ray march
  toward the sun, multiplied onto the sun term only, "because that is the gap a
  cascade texel cannot see and the difference between a crate sitting on the
  floor and a crate stickered onto it" (`src/render/index.js` settings block,
  `contactLength: 0.4`).

**Our change:** `src/world/sky.js`. `three/addons/csm/CSM.js` and
`three/addons/csm/CSMShader.js` are both present at 0.185.1 (verified 200).
Three's CSM does texel snapping but not PCSS; the contact-shadow ray march is a
separate ~150-line pass and is the cheaper half of the win.

### 4. Tone mapping and exposure: AgX + a procedural LUT + GPU EV100 metering

Ours: `ACESFilmicToneMapping` at `toneMappingExposure` 0.98-1.05
(`src/core/renderer.js:22`, `src/main.js:124`), then a display-space lift/gamma/
gain split-tone in `GradeShader`.

Theirs: AgX, applied to the log-normalised value, then a procedurally generated
33-cubed `Data3DTexture` grade LUT, then grain, then sharpen, then sRGB with
ordered dither - all in **one pass** (`src/render/composite.js`).

Four specific things in there that we get wrong, each independently fixable:

**(a) The vignette is in the wrong colour space.** `composite.js` is emphatic:

> "Lens shading is a transmission loss, so it belongs in front of the tone
> curve, not behind it. Applied in display space it was a flat multiply on the
> code value: at 0.24 it scaled everything outside the middle sixth of the frame
> by 0.85..0.81, which put a hard ceiling of ~210 code values on the sky and
> made display white unreachable anywhere but dead centre."

Ours is `uVignette: 0.62` applied in display space, after `OutputPass`
(`post.js:79`, and the shader at `post.js:167-168`). That is 2.5x their
amplitude in the space they specifically identify as wrong. It is a large part
of why our frames read dim and flat around the edges.

**(b) Bloom threshold is below the sky.** Ours is `UnrealBloomPass(..., 0.55,
0.62, 0.82)` (`post.js:212-217`). Theirs is 1.6, and they explain exactly why:

> "1.6, not 0.85. A daylight sky lands around 1.0-1.5 in exposure-scaled linear
> light, so at 0.85 the SKY was the brightest thing in the pyramid and the widest
> mip smeared it four or five pixels over every roofline and every silhouette in
> front of it - an enemy on a balcony measured 3% contrast against the cloud he
> was standing in front of."

Under ACES at exposure ~1.0, our sky is comfortably above 0.82. Every roofline
in our frame is being haloed by the sky.

**(c) Grain is 5.5x too strong and has the wrong response curve.** Ours is
`uGrain: 0.055`, flat across the tonal range (`post.js:78`, shader line 172).
Theirs is `grain: 0.010` with **less** grain in the darks:

> "Real sensor noise is loudest in the mid/upper mids once it has been through a
> display transform; in the darks it is what the eye reads as 'dirty image', so
> the response is deliberately the opposite of the naive 'more grain where it is
> dark'."

**(d) No auto-exposure.** `src/render/exposure.js` meters a centre-weighted
log-average luminance, reduced entirely on the GPU with no readback, converted
via `EV100 = log2(L * 100 / K)` with K = 12.5 and `H = 78/(q*S) * 2^EV100`,
q = 0.65, S = 100. Adaptation is asymmetric (brightens slowly, darkens quickly)
and clamped to `setLimits(-4.3, 20)`. Sky pixels are de-weighted, but only in
proportion to their own luminance so a moonlit sky still anchors the night
frame. We have a fixed `toneMappingExposure`.

**Our change:** all four live in `src/core/post.js`. (a), (b) and (c) are
roughly twenty lines total and are the highest ratio work in this entire
document. (d) is a day.

### 5. The viewmodel: textures, and a light rig fixed in view space

Our weapon has **zero texture maps**. `src/player/viewmodel.js:147-221` is nine
`MeshStandardMaterial`s defined by flat `color` + `roughness` + `metalness` and
nothing else. It occupies a quarter of every frame.

Theirs gets:
- Its own scene and camera: `PerspectiveCamera(60, 1, 0.005, 12)` against the
  world's 80 (`src/core/engine.js:35`, `:29`).
- A **five-light rig with every direction fixed in VIEW space**
  (`src/render/index.js`, viewmodel light rig block):

```js
this.viewSun     = new THREE.DirectionalLight(0xffe8c4, 2.0);  // key
this.viewKeyFill = new THREE.DirectionalLight(0x9ec4ff, 0.6);  // cool fill
this.viewRim     = new THREE.DirectionalLight(0xffd7a8, 1.0);  // rim
this.viewFill    = new THREE.HemisphereLight(0x8fb6ff, 0x36302a, 0.35);
this.viewBounce  = new THREE.DirectionalLight(0xffb87a, 0.5);  // warm, from below
this._viewKeyDir    = new THREE.Vector3(-0.45,  0.75,  0.55).normalize();
this._viewFillDir   = new THREE.Vector3( 0.6,  -0.15,  0.5 ).normalize();
this._viewRimDir    = new THREE.Vector3( 0.2,   0.35, -0.9 ).normalize();
this._viewBounceDir = new THREE.Vector3(-0.2,  -0.86,  0.47).normalize();
```

with the rationale, which is the useful part:

> "Handing it one copy of the world sun means that whenever the sun is behind the
> gun the camera-facing side gets nothing, and weapon albedos are physically
> correct (anodised aluminium is 0.026 linear) so it goes to a black silhouette.
> It gets a real 3-point rig instead, with every direction fixed in VIEW space so
> the weapon reads identically at any world sun azimuth - which is what every
> shipped FPS does, and the reason their guns are always legible."

- Rendered into its **own MSAA colour+depth target** (4x at high quality) after
  the TAA resolve, then composited premultiplied with an FXAA-style edge filter
  on the RGBA (`src/render/composite.js`, `VIEW_COMPOSITE`). The reason is worth
  stealing wholesale even though we do not have TAA yet: everything in the view
  scene moves in *view* space, so a camera-matrix velocity buffer describes none
  of it.
- **61,672 triangles for the rifle** (measured by running their builders in node
  and summing per material bucket: body 53,692 + moving parts 7,980, across 11
  buckets). SMG 49,448, pistol 25,652. All three built at boot.
- **Every box is a `RoundedBoxGeometry` with a 0.3-1.5 mm chamfer.**
  `src/weapons/geometry.js:8-13`: "There is no such thing as a 90-degree edge on a
  real firearm... That single fact is what separates 'modelled' from 'blocked
  out': chamfers catch a specular line and give the silhouette its read." No CSG
  anywhere - `box` (RoundedBox), `latheZ`, `tubeZ`, `dome`, `extrude` with bevel +
  `mergeVertices` weld, `ring`, `screw` with a real counterbore, `knurlBand`,
  `serrations`, `picatinny`, `mlokSlot`. The barrel is a 15-point lathe profile.
- **Hands are NOT skinned.** Two rigid bones per arm with an analytic two-bone IK
  solve, hands welded to the weapon, elbows following
  (`src/weapons/hands.js:3-10`). Far cheaper than a skeleton, and directly
  portable. Their bone lengths are deliberately non-anatomical - `L_UPPER = 0.33`,
  `L_FORE = 0.3` vs a real 300/272 mm - because at real length the support-hand
  target sits at 99.5% extension, the solve clamps, and "the elbow locks into a
  broomstick with the hand sliding off the handguard."
- **Animation is a spring stack with published constants**
  (`src/weapons/viewmodel.js:249-259`): `lag` Spring3(5.4, 0.46), `lagRot`
  Spring3(6.2, 0.42), `recPos`/`recRot` Spring3(9, 0.42), `land` Spring(7.5,
  0.55), `settle` Spring3(2.2, 0.7). Semi-implicit Euler, frequency in Hz plus
  damping ratio (`src/weapons/mathx.js:65-97`). Recoil is a **velocity impulse
  pre-multiplied by omega**, so authored amplitudes are real metres:
  `kickBack: 0.019` m, `kickUp: 0.0072` m, `freq: 8.5` Hz.
- **ADS is deliberately not a spring.** `src/weapons/viewmodel.js:666-672`:
  "Linear rate with a smootherstep shaping: a spring here reads as mushy."
  `adsTime: 0.22` s, un-ADS 1.25x faster. Worth checking ours against.
- **The ADS pose is solved, not authored.** The rig computes the translation that
  lands the weapon's sight node on the camera axis at the eye-relief distance
  (`viewmodel.js:707-717`). That removes an entire class of hand-tuning.
- One instructive bug they found and fixed: the Picatinny rail, being "21 mm x
  4.65 mm of dead-flat metal pointing straight up", caught the whole GGX lobe of
  the view key at once and measured **1.35 stops brighter** than the receiver
  (`geometry.js:284-296`). Fixed with a real 1.5 mm 45-degree chamfer on both top
  edges. Any flat top face on our weapon has the same problem.

Their own README is honest that this is still their weakest element ("blocky
finger slabs that don't convincingly grip the weapon", and a known unfixed bug
where the view rig delivers ~20x the irradiance per unit albedo the world does,
forcing every weapon albedo to be cheated to a third of physical). But their gun
reads as a manufactured object with material separation. Ours reads as two
flat-shaded solids.

**Our change:** `src/player/viewmodel.js` for the maps and the rig,
`src/core/post.js` for the composite.

---

## Side-by-side technique comparison

| Technique | Claude-of-Duty | Sands of the Restless | Gap |
|---|---|---|---|
| Engine | three.js **0.180.0** (`package.json`, verified in `node_modules`) | three.js 0.185.1 | none; we are newer |
| Build | Vite 7.3.6, ES modules | none, raw ES modules + import map | none that matters |
| Size | 64,968 lines across 147 `.js` + 26 `.mjs`, 11 subsystems | 9,630 lines, 21 files | **6.7x** |
| **Binary assets** | **zero.** 185 files: 147 js, 26 mjs, 5 html, 3 md, 2 json. No png/jpg/hdr/glb/wav | 6.7 MB: 5 ambientCG 1K sets + 1 Poly Haven 1k HDRI | we have MORE assets than they do |
| Tone mapping | AgX in log space, slope 1.0 / power 1.0 / sat 1.08 (`composite.js`) | ACES via `OutputPass`, exposure 0.98 | large |
| Colour grade | procedural 33-cubed `Data3DTexture` LUT: ASC-CDL, split tone, luminance-preserving sat 1.20, highlight desat 0.10, S-curve contrast 1.28 pivoted at **0.50**, toe 0.008, normalised shoulder 0.60/1.20 (`lut.js`) | lift/gamma/gain + sat 1.10 + contrast 1.18 in a ShaderPass | large |
| Exposure | GPU log-luminance reduction to EV100, K=12.5, asymmetric adaptation, limits -4.3..20 (`exposure.js`) | fixed `toneMappingExposure` | large |
| Post chain | one custom pass: exposure, CA, additive thresholded bloom, cos^4 vignette **in linear**, AgX, LUT, grain, CAS sharpen, sRGB + dither. "Nothing in the chain uses three's examples/jsm post stack." | `EffectComposer`: Render, GTAO, Viewmodel, UnrealBloom, Output, Grade, SMAA | different philosophy; theirs is 1 read/write |
| Bloom | Karis pyramid, 5-6 mips, soft-knee threshold **1.6**, strength 0.14, **added** not mixed | `UnrealBloomPass` threshold 0.82, strength 0.55, radius 0.62 | ours blooms the sky |
| Vignette | cos^4, **linear light**, 0.24 (0.34 in ADS) | display space, **0.62** | ours is wrong space, 2.5x amplitude |
| Grain | 0.010, **less** in the darks, 2-hash | 0.055, flat, `sin`-hash | ours is 5.5x too loud |
| Sharpen | contrast-adaptive, luminance-only from unshifted centre tap, 0.25 | none | missing |
| AA | TAA (velocity reprojection, YCoCg variance clip, weak rejection, Halton jitter), FXAA fallback, 4x MSAA on the viewmodel target only | SMAAPass | theirs is better; ours is not bad |
| AO | GTAO, 3 slices x 8 steps, radius 1.35 m, intensity 1.1, temporally accumulated, applied to **indirect terms only** inside the base pass | `GTAOPass` radius 0.85, 16 samples, blended as post-multiply over everything | theirs is physically right |
| Contact shadows | 0.4 m screen-space march toward the sun, on the sun term only | none | missing |
| Shadows | 4 cascades in `sampler2DArray` R32F, bounding-sphere fit, texel snapped, PCSS blocker search + Vogel PCF, world-unit normal-offset bias | 1 x 2048, 92x92 ortho, no snapping, `PCFShadowMap`, bias -0.0008 / normalBias 0.035 | large |
| SSR | 28-step depth march, confidence-blended into IBL specular (replaces, not adds) | none | missing, low priority for us |
| Motion blur | velocity-tile reconstruction, shutter 0.42 | none | missing, low priority |
| DoF | ADS-only, half-res gather, 32 taps, maxCoc 3.3 px at 1080p | none | missing, low priority |
| Sky | Hillaire 2020, 3 LUTs (256x64 / 32x32 / 384x192), ozone tent at 25 km, Mie g = 0.8, physical sun (`SCENE_LUX` 25000, 5.12 top-of-atmosphere) | 3-colour gradient dome + `pow(cos,28)` glow, `DirectionalLight` 2.9 | **large** |
| Clouds | **2.5D shells, not a volume march** - two decks on the dome, vertical extent faked by a parallax shear, 3-tap sun self-shadow, CPU twin dims the sun light to match | none | **large, and cheap to close** |
| Volumetrics | half-res raymarch 28-56 steps, CSM-sampled shafts, IGN dither over 64 frames, temporal reproject, dual-lobe HG (0.76 / -0.36) | none | large, low priority |
| Fog | **no `scene.fog` at all** - post pass, exact closed-form exponential-height integral, per-channel extinction tint (0.94, 1.02, 1.24) so distance loses red first, 12 m near-ramp to keep it off the gun | `FogExp2(0xe8d9b8, 0.0055)`, uniform, no height term | **large** |
| IBL | PMREM regenerated from the live sky, 512x256 equirect to cube 128, at most every 250 ms; `envMapIntensity` 1.6 with a separate `iblDiffuse` budget of 0.030 | static 1k Poly Haven HDRI, `environmentIntensity` 0.34 | theirs is dynamic; ours is fine in kind |
| Indirect fill | two-band hemispheric fill with **directional gates** (`owFillDir`), warm sun-bounce wrap, plus an interior indirect floor gated by 10 coarse room volumes | one `HemisphereLight` (0 after HDRI loads) + one warm bounce directional 0.30 | theirs is much more controlled |
| Textures | GPU render-to-target forge, 19 procedural surfaces at 1024 sq (512 for 6), 46 palette variants, 3 maps each (albedo+height / ORM / normal), cached, mip + aniso 16 | 5 CC0 ambientCG scanned 1K sets (color/normalGL/roughness/AO) + procedural canvas textures | **ours is better at close range** |
| Noise | all periodic/tileable, Hoskins hashes (explicitly not `sin`), fbm/ridged/billow 3-5 octaves, domain warp, Worley F1/F2, Quilez voronoi edge, anisotropic shear | canvas painting + Sobel | theirs is far more sophisticated |
| Normals | Sobel over a **HalfFloat height** target, physically scaled (`uStrength = relief_m / worldSize_m`), 8-bit output | scanned normalGL from ambientCG | ours is better in kind |
| Material patches | POM (48-tap max, secant refine, `textureGrad`, 6-14 m fade), triplanar (9 taps, exponent-5 weights, sign-aware frames), stochastic de-tiling with **height-preserving blend**, macro variation, macro relief, repair patches, rain runoff, dust wedges, cloth transmission - all behind `#define`s with `customProgramCacheKey` | world-space weathering: grime, sun bleach, large-scale mottling | large in count, smaller in visual effect |
| Edge wear | **CPU curvature analysis at bake time** into a vertex `color` attribute (`masks.js:39-216`, position-clustered so hard-edged kit geometry still forms adjacency), consumed as `vColor.r/g/b = wear/grime/AO` | none | missing, and cheap |
| Material type | `MeshStandardMaterial`, base roughness/metalness = 1 so the texture *is* the value; `MeshPhysicalMaterial` only for brushed metal (anisotropy 0.65), cloth (sheen 0.3-0.55), glass (ior 1.52) | `MeshStandardMaterial` with per-material scalar roughness/metalness | theirs is more correct |
| Chamfered box | 6 faces + 12 edge strips + 8 corner tris = **44 tris**, three cached variants (12 mm / 4 mm / 30 mm) | 6 faces + 12 edge quads + 8 corner tris = **44 tris** | **identical** |
| Thin geometry | `plainBox` 12 tris for rails, slats, balusters, grille bars "of which the level has tens of thousands" | none | missing |
| Wall thickness | real: `t = 0.34` m, `ExtrudeGeometry` of a `Shape` with `holes`, bevelled reveals; interior partitions 0.16 m | flat panels | missing |
| Texel density | one `owTile` uniform, planar or triplanar projection, metres-per-tile; micro detail density **derived** from prop scale (`shader.js:804-808`) | baked into the UV attribute in `world/uv.js` | different, both valid |
| Batching | `Accum` merges per palette key to one `Mesh`; `InstancedMesh` per prototype per 64 m chunk; ~100 draw calls for a 120 m map | `InstancedMesh` for 6,200 scatter props | ours is thinner but adequate |
| Triangles | 11.3M whole scene after the art passes (README) | ~44 tris/box x a few hundred + 6,200 instances | **very large** |
| Decals | box projector, Sutherland-Hodgman clip against 6 planes, normal-deviation cull, `polygonOffset -4/-8`, budget 512 | none | missing |
| Viewmodel geometry | **61,672 tris** (rifle, measured), every box a `RoundedBoxGeometry` at 0.3-1.5 mm chamfer, lathe barrels, real counterbored screws, knurl bands, Picatinny with chamfered top edges. No CSG | flat `chamferedBox` solids, no maps | **very large** |
| Viewmodel maps | GPU-baked at 512-1024², triplanar in object space, roughness authored as `[scale, offset, min]` against the ORM channel | **zero texture maps**, scalar roughness/metalness only | **very large** |
| Hands | **rigid two-bone arms + analytic IK**, hands welded to the weapon, elbows follow; bone lengths deliberately non-anatomical (330/300 mm) | rigid parts, no IK | moderate |
| Weapon animation | spring stack (Hz + damping ratio, semi-implicit Euler), recoil as velocity impulse pre-multiplied by omega, ADS deliberately linear-rate + smootherstep, ADS pose *solved* from the sight node | springs present, ADS pose authored | moderate |
| Enemies | **real `SkinnedMesh`, 25-bone procedural humanoid rig**, bind pose = patrol carry not T-pose, 4-influence inverse-distance-to-bone-*segment* binding, 4 IK layers, rifle baked into the mesh, ~21-26k tris each, 6 live, behavioural LOD | none yet (M3) | n/a yet |
| Physics | from scratch: binned-SAH BVH, swept-capsule controller with 5-plane crease stack, impulse rigid bodies with CCD, PBD ragdolls, multi-layer penetration | cylinder colliders | n/a for visuals |
| Audio | Web Audio synthesis, convolution reverb, HRTF | procedural | comparable |
| Shader pre-warm | `src/core/prewarm.js`, provably pixel-neutral, removed 728-1236 ms stalls | none | worth stealing later |
| Performance | **28-30 fps p50** at 1512x982 DPR 2 on Apple silicon, `ultra` | 70 fps on the same class of machine | **ours is 2.3x faster** |

---

## Honest assessment: is their look better, or just different?

Their frame is better. It is not close at medium and long range. But the reason
is not what the user assumes, and getting the reason right changes what we
should build.

**Where their advantage is art direction and content, not technology (roughly
70% of the gap):**

Look at their `hero` shot and ours side by side. Theirs is a street: buildings
on both sides, a vanishing point, four or five depth planes, objects overlapping
objects, thin silhouettes (power lines, railings, awning frames, poles) cutting
across every value transition. Ours is a plaza: one object, one depth plane,
nothing overlapping, nothing thin, and a lot of empty sand and empty sky.

You could render our scene with their exact renderer and it would still read as
a prototype, because there is nothing in it. Conversely their scene rendered
with our chain would still read as a place. **The single biggest lever we have is
not a shader.** It is: enclose the space, add a second and third scale tier of
props, and put thin geometry in frame.

Their build has 62 prop prototypes and several thousand placements. We have
one prop tier. That is a content problem with a content solution, and it is
tractable procedurally - all 62 of their prototypes are code.

**Where their advantage is genuinely technical (roughly 30%):**

1. Sky and aerial perspective. A physical atmosphere with clouds is a real
   technical asset and it is 40% of the pixels in an outdoor frame.
2. Cascades with PCSS. Contact-hardening penumbra is the most recognisable
   "this is a real engine" tell after the sky.
3. The tone-mapping and exposure chain. AgX plus a pivoted LUT plus auto EV100
   is measurably better than ACES plus lift/gamma/gain, and our four specific
   errors in that chain (linear-space vignette, bloom threshold, grain amount,
   grain response) are actively hurting us right now.
4. The viewmodel light rig. Fixing it in view space is a one-hour change with a
   disproportionate payoff, because the gun is a quarter of the frame.

**Where we are already ahead, and should not regress:**

- **Close-range material fidelity.** Read their `detail` shot honestly: the
  crates are flat washed plywood, the concrete columns are flat grey, the
  plaster has no near-field grain. Their own README says it: "Surfaces read as
  procedural noise rather than photographed reality at close range - the ceiling
  of generating texture from code." We have CC0 scanned PBR with real
  color/normalGL/roughness/AO. At 1 m we should already beat them, and
  `ibl-on.png` suggests we roughly do on the sand.
- **Performance.** 70 fps vs 28-30. They paid for their look and the bill is
  large. Their own numbers: the art passes took the scene from 5.9M to 11.3M
  triangles and optimisation recovered about half.
- **Codebase size.** 9.6k lines vs 65k. Everything below has to be affordable at
  our scale.

**The one thing that should recalibrate expectations:** the reference project's
own README says it failed at its stated goal.

> "The goal was to match a modern Call of Duty. **It does not.** Eleven
> independent adversarial critics scored the frames against that bar. Scores went
> 3.59 -> 4.14 -> 4.05 -> **5.05** out of 10. Two shots reached 'CLOSE'; the rest
> remain 'AMATEUR'. In a blind A/B, **every critic in every round picked the real
> Call of Duty frame.**"

This confirms rather than contradicts `RESEARCH-VISUALS.md` §9: the realistic
ceiling here is a good 2010-2014 console shooter. The reference is a fair
demonstration of where that ceiling actually sits, built at 6.7x our line count
by an agent fleet. It is a very useful target. It is not Call of Duty, and the
user's framing that "theirs looks like Call of Duty proper" is generous to it.

---

## Compatibility with our hard constraint

Our constraint - procedural geometry + CC0 scanned PBR materials + one HDRI, no
hand-authored models - is **fully compatible with everything worth taking**.

The headline fact, and it is the opposite of what the brief anticipated: **the
reference ships zero binary assets.** I checked exhaustively. 185 files, of which
147 are `.js`, 26 `.mjs`, 5 `.html`, 3 `.md`, 2 `.json`. Zero png, jpg, hdr, exr,
gltf, glb, fbx, obj, mp3, wav, ogg, ktx2, basis, dds, ttf, woff. `README.md:8`:
"There are no art assets. Every texture, mesh, animation and sound is generated
procedurally at load time from code. No models, no HDRIs, no image files, no
audio files."

So the question "is their look achievable procedurally at all" answers itself:
their look **is** the procedural look, achieved at 65k lines. And we are the less
constrained project of the two, because we also allow scanned PBR and an HDRI.

Consequences:

- Every technique in the comparison table is reachable for us. None of it depends
  on an asset.
- Our scanned materials are a genuine advantage at close range that they cannot
  match. Keep them. Do **not** rip them out to chase their procedural forge.
- Their `MeshPhysicalMaterial` usage (sheen for cloth, anisotropy for brushed
  metal, ior for glass) is asset-free and directly portable.
- Their curvature-to-vertex-colour edge wear is pure geometry processing and
  costs nothing but CPU at bake time. Directly portable, and it is the single
  cheapest material upgrade available to us.
- Their prop library is 62 code-generated prototypes. Directly portable in kind.
- The one thing we cannot cheaply match is their **volume** of procedural
  surface variety (19 GPU-forged surfaces, 46 palette variants) - but with 5
  scanned sets plus tint/roughness/detail variation we can get to a comparable
  count of *apparent* materials for far less code.

---

## Implementation plan, ordered, against our actual files

Ratio-ordered. Each stage is independently shippable and visibly better.

### Stage 0 - unblock (30 minutes)

1. **`src/core/post.js:57-64`** - fix `ViewmodelPass.render` to save/restore
   `renderer.autoClear` around the `render()` call, as shown in the P0 section.
   Nothing else in this document is verifiable until this lands.
2. **`test/shot.mjs`** - add a mean-luminance assertion on each captured PNG.
   Fail if the frame is within a few code values of black. The harness reported
   PASS on a black screen; that is the actual bug behind the bug.
3. Re-capture `shots/` and delete the black PNGs so they stop being cited as
   our current state.

### Stage 1 - the post chain, in place (half a day, highest ratio)

All in `src/core/post.js`. No new dependencies.

4. **Move the vignette in front of the tone map.** Today it is in `GradeShader`
   after `OutputPass`. Either move it into a small pass before `UnrealBloomPass`,
   or - simpler - drop it from `GradeShader` and apply `cos4 = pow(1/(1+r2*2.4),
   2.0)` as a linear multiply in a pre-bloom pass. Then set the amount to **0.24,
   not 0.62**.
5. **Raise the bloom threshold.** `post.js:216`: `0.82` -> start at `1.15` and
   tune up until the sky stops haloing rooflines. Under ACES the scale differs
   from their linear-HDR 1.6, so tune by eye against a frame with sky behind a
   silhouette rather than copying the number.
6. **Drop bloom strength** from `0.55` toward `0.20`. `UnrealBloomPass` mixes;
   at 0.55 with a low threshold it is veiling glare, which is exactly the "milky
   pastel wash" failure mode `lut.js` documents at length.
7. **Grain: `0.055` -> `0.012`,** and make the response fall off in the darks:
   `response = uGrain * (0.35 + 0.65 * smoothstep(0.0, 0.30, luma))`.
8. **Replace the `sin`-based hash.** `post.js:105-107` uses
   `fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453)`, which bands badly on
   Apple GPUs - the reference calls this out explicitly and uses Hoskins hashes
   instead (`src/materials/glsl/noise.js:15-40`). Port `owHash12`.
9. **Add an ordered dither before the 8-bit write:**
   `disp += (hash12(gl_FragCoord.xy * 0.5 + t) - 0.5) * 0.0022;`. Kills sky
   banding for one line.
10. **Add contrast-adaptive sharpening**, luminance-only, computed from the
    *unshifted* centre tap. Their warning is worth heeding verbatim: sharpening
    the chromatically-aberrated fetch against unshifted neighbours amplifies the
    CA offset and produces magenta/green fringing.
11. **Pivot the contrast at 0.5.** Our `uContrast` pivots at 0.5 already
    (`post.js:159`) - good, keep it. But move the split-tone out of lift/gain and
    into a proper 33-cubed `Data3DTexture` LUT generated at boot, following
    `lut.js`. `three/addons/postprocessing/LUTPass.js` exists at 0.185.1
    (verified 200) if we want the pass for free; the LUT itself is ~180 lines of
    CPU maths and no assets.

### Stage 2 - sky and atmosphere (1-2 days, second-highest ratio)

12. **`src/world/sky.js`** - replace the gradient dome with
    `three/addons/objects/Sky.js` (verified 200 at 0.185.1), driven from sun
    elevation. It carries cloud uniforms in this release. This is the single
    largest pixel-area change available.
13. **PMREM the live sky into `scene.environment`.** We currently use a static
    Poly Haven HDRI at `environmentIntensity` 0.34 (`main.js:116`). Rendering the
    actual sky to a 512x256 equirect and PMREM'ing it means the environment
    matches the background exactly, at any time of day. Keep the HDRI as the
    fallback. Regenerate only when the sun moves, throttled - theirs gates on
    **both** a 0.35-degree sun movement and a 200 ms minimum interval
    (`sky/index.js:793`, `:491-493`; note their own class header says 250 ms and
    the code says 200 - doc drift). Their env bake also uses a *cheaper* variant
    of the same shader: no sun disc, fewer octaves, no stars
    (`src/sky/dome.js:303-315`). Worth copying, and worth noting their
    `setTimeOfDay` bypasses both throttles and rebakes synchronously
    (`sky/index.js:392-399`) - a time-of-day slider would PMREM every drag frame.
14. **Add a cloud layer using their parallax-shear trick** (quoted in §2 above).
    Two 2.5D shells evaluated in the sky fragment shader with a 3-tap sun march.
    This is a few dozen lines, not a volumetric system, and it is the single
    most visible thing separating their `hero` frame from ours. Do this *before*
    the height fog.
15. **Height fog, replacing `FogExp2`** at `main.js:50`. Note they have **no
    `scene.fog` at all** - it is a post pass with an exact closed-form
    exponential-height optical depth (`src/sky/volumetrics.js:136-141`):

```glsl
float skHeightIntegral( float y0, float dy, float t ) {
  float d0 = exp( -( y0 - uFog.z ) * uFog.y );
  float x = dy * uFog.y * t;
  if ( abs( x ) < 1.0e-4 ) return d0 * t;
  return d0 * ( 1.0 - exp( -x ) ) / ( dy * uFog.y );
}
```

    applied at full resolution as `color * exp(-uFogExt * od) + inscatter`. This
    is simpler than the four chunk overrides in `RESEARCH-VISUALS.md` §5.2 and
    strictly better, because it runs on sky pixels too. Their constants:
    sigma_s 3.6e-3 /m, sigma_e 1.45e-3 /m, 18 m e-folding height, baseY -2.0,
    max distance 900, and a **per-channel extinction tint (0.94, 1.02, 1.24) so
    distance loses red first** - that tint is what makes their far buildings go
    blue instead of beige. Also a `smoothstep(0, 12 m, t)` near-ramp specifically
    to keep the wash off the viewmodel.
16. **A cheap dust/haze layer.** Their god rays are a half-res raymarch against
    the CSM array - out of scope at our line count. Soft-particle dust motes plus
    a screen-space radial pass gets a large fraction of the read.
    `RESEARCH-VISUALS.md` §5.3 already scoped this.

### Stage 3 - shadows (1 day)

17. **`src/world/sky.js`** - swap the single `DirectionalLight` shadow for
    `three/addons/csm/CSM.js` + `CSMShader.js` (both verified 200). 4 cascades,
    2048 each. Three's CSM texel-snaps; that alone kills the crawl.
18. **Screen-space contact shadows** as a small pass in `src/core/post.js`: a
    0.4 m depth-buffer march toward the sun, multiplied onto the sun term. This
    is the "is the crate on the floor or stickered onto it" fix and it is far
    cheaper than PCSS.
19. If PCSS is wanted later, it is a blocker search plus a Vogel-disk PCF inside
    the CSM shader chunk. Do this only after Stages 1, 2 and 4.

### Stage 4 - scene content (2-4 days, largest absolute impact)

This is the one that actually answers "why does ours look like Minecraft".

20. **`src/world/rooms.js` and `src/world/build.js`** - enclose the space.
    Whatever the room graph ends up being, the player should be in a corridor,
    courtyard or hall with occluders on at least two sides, not on an open plane.
21. **`src/world/geometry.js`** - add a `plainBox` (12 tris, no chamfer) beside
    the existing `chamferedBox` (44 tris). Their comment is the whole
    justification: members thin enough that a 4 mm chamfer is invisible number in
    the tens of thousands and would otherwise dominate the triangle budget.
    Then use it: railings, grilles, ladder rungs, scaffolding poles, hanging
    chains, rope.
22. **Real wall thickness.** Their `wallPanel` is an `ExtrudeGeometry` of a
    `Shape` with `holes` at `t = 0.34` m, with bevelled reveals
    (`world/util.js:451-515`). A doorway with a 34 cm reveal and a dark backing
    plane behind it reads completely differently from a hole in a flat panel.
23. **`src/world/scatter.js`** - our 6,200 instances are all one scale tier.
    Split the budget across three: architectural detail, furniture scale, and
    ground litter. Add their anti-clone jitter (per-instance yaw, two-axis tilt,
    scale, sink) - `world/builder.js:239-262`.
24. **Contact fillets.** Their `dust_skirt` (a small fillet dropped under every
    loose prop, `builder.js:193-201`) and `driftBerm` (sand piled against wall
    bases) exist purely to kill the razor polygon line where a prop meets the
    ground. Cheap, and it is one of the loudest "pasted on" tells.
25. **Decals.** A box projector with Sutherland-Hodgman clipping (`fx/decals.js`)
    at ~420 lines. Bullet holes, stains, scorch. `src/systems/impacts.js` is the
    natural home.

### Stage 5 - the viewmodel (1-2 days)

26. **`src/player/viewmodel.js:147-221`** - give the nine materials actual maps.
    We already load ambientCG sets; a scanned brushed-metal and a scanned polymer
    or rubber set applied at prop-scale texel density costs nothing new.
27. **A view-space 3-point rig.** Port the five lights and four direction vectors
    verbatim from `src/render/index.js` (quoted above) into
    `src/player/viewmodel.js`. Keep the directions fixed in view space. This is
    an hour of work and it is the difference between "legible manufactured
    object" and "dark silhouette whenever the sun is behind you". Read do-not-copy
    item 5 before setting the intensities.
28. **Chamfer the weapon.** `three/addons/geometries/RoundedBoxGeometry.js` is
    present at 0.185.1 (verified 200). Replace the flat boxes in
    `src/player/viewmodel.js` with 0.3-1.5 mm rounded boxes, and specifically
    chamfer every upward-facing flat - their measured Picatinny result (1.35 stops
    hot) is the failure mode to avoid.
29. **Port the spring class and constants.** Semi-implicit Euler, frequency in Hz
    + damping ratio, recoil as a velocity impulse pre-multiplied by omega so the
    amplitudes are real metres. Constants in §5 above. Then check whether our ADS
    transition is a spring - theirs is deliberately a linear rate with smootherstep
    shaping because "a spring here reads as mushy".
30. **Consider solving the ADS pose rather than authoring it** - compute the
    translation that lands the sight node on the camera axis at the eye-relief
    distance. Removes a whole class of per-weapon hand-tuning.
31. **Curvature-driven edge wear** on the weapon first, world second. Compute
    convexity per vertex at bake time into the `color` attribute, then in
    `src/world/weathering.js` mix toward a worn metal colour and raise metalness
    where `vColor.r` is high. `masks.js:39-216` is the reference implementation;
    the position-clustering detail matters because our chamfered boxes are
    non-indexed with duplicated vertices, exactly the case they had to solve.
32. Keep the viewmodel inside the post chain (we already do, correctly). Consider
    their premultiplied-alpha separate-target composite only if we ever add TAA.
33. **When we get to hands (M3), do not build a skeleton.** Two rigid bones per
    arm with an analytic two-bone IK solve, hands welded to the weapon, elbows
    following, is what the reference does and it is dramatically cheaper than
    skinning. Use their non-anatomical bone lengths (330/300 mm) for the reason
    they document: real lengths put the support hand at 99.5% extension and the
    solve clamps into a locked elbow.

### Stage 6 - optional, only if the first five land

34. GTAO applied to indirect terms only, inside the base pass, rather than as a
    post-multiply. Physically right; moderate effort. (Note: this is also where
    their own live bug lives - see do-not-copy item 8.)
35. TAA. Real quality win, but it brings the whole class of viewmodel ghosting
    bugs the reference spent effort solving. Not worth it before Stage 4.
36. Shader pre-warm (`src/core/prewarm.js` equivalent). Not a visual change, but
    once Stage 4 triples our material count we will hit the same multi-second
    lazy-compile stalls they measured.
37. **Enemies (M3), when we get there.** Their soldiers are ~21-26k triangles
    each, real `SkinnedMesh` with a 25-bone procedurally generated humanoid rig,
    bind pose authored as a *patrol carry* rather than a T-pose so skin weights
    never cross a 90-degree shoulder rotation, 4-influence inverse-distance
    binding to bone *segments*, four IK layers (foot with ground probes, aim
    spread across three spine bones, look-at, support-hand re-seat), and the rifle
    baked rigidly into the character mesh so it is one geometry. Only 6 soldiers
    are live in their garrison, with no `InstancedMesh` and no `THREE.LOD` - LOD
    is behavioural (irrelevant actors drop to 1-in-3 animation evaluation).

---

## Things they do that we should explicitly NOT copy

**1. Their triangle budget and its frame cost.** 11.3M triangles for 28-30 fps
p50 at Retina. We are at 70 fps. Their own README: "the art passes tripled
geometry cost (5.9M -> 11.3M triangles) and optimization recovered about half."
Adding content is Stage 4's whole point, but budget it and measure. Half their
frame rate is not a good trade for a zombies-economy shooter where wave 30 has
forty enemies on screen.

**2. Replacing our scanned materials with a procedural texture forge.** Their 19
GPU-forged surfaces are impressive engineering and they are also, by their own
assessment, the thing that reads worst at close range. We already have the better
answer for that specific problem. Steal their *shader patches* (de-tiling, macro
variation, curvature wear) and apply them on top of our scanned maps. Do not
steal the generator.

**3. Parallax occlusion mapping.** They have a good implementation (48 taps max,
secant refine, `textureGrad` so mip selection survives the march). It is also
48 texture fetches per pixel on affected surfaces, and `RESEARCH-VISUALS.md` §3.7
already concluded "skip it" for our build. The reference does not change that
conclusion - it disables POM entirely under triplanar
(`materials/shader.js:851`), which is most of their ground.

**4. Writing our own renderer.** "Nothing in the chain uses three's examples/jsm
post stack" is a 5,827-line commitment in `src/render/` alone. It bought them
real things - MRT prepass, velocity, `sampler2DArray` cascades. It is not
affordable at 9.6k lines and it would eat every day we have. Use the addons; they
are all present at 0.185.1 and I verified 24 import paths return HTTP 200,
including `csm/CSM.js`, `objects/Sky.js`, `postprocessing/LUTPass.js`,
`postprocessing/TAARenderPass.js`, `misc/ProgressiveLightMap.js`.

**5. Their viewmodel light intensities.** Documented in their own README and
unfixed: the view rig delivers ~20x the irradiance per unit albedo the world
does, so "every weapon albedo is cheated to a third of physical to compensate,
which caps material separation on the most-looked-at object in the game."

**The root cause is structural, not a magnitude, and this matters for how we
port it.** In full daylight their key resolves to `min(4.6 * 0.55, 2.6) = 2.53`,
and the four directionals sum to `2.53 * (1 + 0.3 + 0.5 + 0.34) = 5.41` units
plus a 0.40 hemisphere - **none of them shadow-casting**, arriving from four
spread view-space directions, so essentially every camera-facing surface is hit
by several at once. The world gets *one* CSM-shadowed sun. Because the specular
F0 = 0.04 floor is albedo-independent, a black material still integrates all five
lobes; that is the README's "black renders at L=110 against a background of 91".

So: copy the *structure* (view-space directions, key/fill/rim/hemi/bounce) and
copy the *ratios*, but treat the count of unoccluded lights as the thing to fix,
not the numbers. Lowering the key alone will re-silhouette the weapon at night -
which is exactly what their `viewKeyGamma: 0.65` exists to prevent. Fewer lights
with some occlusion is the honest fix. Before tuning anything, render a mid-grey
test material in both scenes and check it lands on the same value.

**6. Their GTAO leak into the viewmodel - a live bug they have not caught.**
`src/render/index.js:1391` zeroes contact shadows for the viewmodel pass
(`feat.y = 0; // contact shadows are a world-space buffer; not for the gun`) but
leaves `feat.x`, the AO gate, set. The AO lookup is a screen-space fetch
(`materialpatch.js:282-283`) into a gbuffer that by design describes the world
alone - so the weapon is multiplied by the ambient occlusion of whatever world
geometry happens to be *behind* it. Same class of bug as the one they did catch,
on the buffer they did not. If we ever route AO through the base pass (Stage 6
item 34), gate the viewmodel out of it explicitly.

**7. Their `MeshPhysicalMaterial` sheen on everything cloth-like.** Fine in
principle, but `MeshPhysicalMaterial` is materially more expensive than
`MeshStandardMaterial` and our scene has one cloth surface (`linen`). Use it
there and nowhere else.

**8. Their soldier texel density, when we get to enemies.** Their README blames
"characters read as mannequins at distance" on the rigging and modelling. Reading
the code, that diagnosis looks wrong: the rig is genuinely good (25 bones, four
IK layers, three distinct silhouettes, modelled pouches and radio and knee pads).
The textures are 512-squared CPU-baked `DataTexture` tiles. At 25 m that is the
constraint, not the skeleton. If we build enemies, spend the budget on texel
density before spending it on bones.

**9. Fanning out parallel agents per subsystem.** Not a rendering point, but
their process note is the most transferable finding in the repo and it is a
warning: "Three rounds of six agents each owning one directory moved the score
+0.46 and left frame-ruining defects *higher* than they started (60 -> 47 -> 66),
because tonemapping, sky and indirect light are one coupled system and isolated
agents kept breaking each other's assumptions. One sequential pass with a single
owner per coupled concern moved it +1.00 and cut defects 66 -> 26." Stages 1, 2
and 3 above are one coupled system. Do them sequentially, one owner.

---

## Verification notes

- Repo cloned successfully, `npm install` clean (19 packages, 0 vulnerabilities),
  `three` resolved to **0.180.0**.
- Ran under Vite at `127.0.0.1:5173` and captured six shots (`hero`, `detail`,
  `weapon`, `sunset`, `interior`, `combat`) through the repo's own
  `window.__APPLY_SHOT__` API with 90 settle frames, headless Chrome for Testing
  with `--use-angle=metal`. All six succeeded.
- No live demo exists. No `homepage` in `package.json`, no GitHub Pages, no
  Vercel link in the README.
- Binary asset count verified by exhaustive `find` over 16 extensions: **zero**.
- All 24 three.js import paths recommended or referenced above were verified with
  `curl` against `https://unpkg.com/three@0.185.1/...` and returned HTTP 200.
- Our black-frame regression was reproduced on a real GPU and the cause confirmed
  by live runtime patch, not inferred.
- Weapon and soldier triangle counts were **measured**, not estimated: their
  builders were executed in node and the per-material-bucket `triCount` summed
  (rifle 61,672 / smg 49,448 / pistol 25,652), and `src/ai/selftest.mjs` was run
  for the soldiers (vanguard 25,698 / irregular 21,374 / breacher 25,698).
- Two findings in this document are things the reference project does not appear
  to know about its own code: the GTAO leak into the viewmodel pass (do-not-copy
  item 6), and a 200 ms / 250 ms doc-vs-code drift on the PMREM throttle. Both are
  called out because they change how we should port the surrounding technique, not
  as criticism.
