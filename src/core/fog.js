/**
 * Height fog, as a post pass.
 *
 * WHY A POST PASS AND NOT scene.fog
 *
 * `FogExp2` cannot do height. The entire varying three.js gives the fragment
 * stage is `vFogDepth = -mvPosition.z`; there is no world position down there at
 * all, so density cannot vary with altitude. RESEARCH-VISUALS.md section 5.2
 * proposes fixing that with four `THREE.ShaderChunk` overrides. That works, but
 * it is strictly worse than this for three reasons, and the reference project
 * ships none of it:
 *
 *   1. It cannot touch sky pixels. The sky dome opts out of fog (it must, or a
 *      chunk-based fog paints it a flat colour), so the horizon shows a seam
 *      where fogged geometry meets unfogged sky. A post pass runs on every
 *      pixel including the sky, so the two converge on the same colour by
 *      construction and the seam cannot exist.
 *   2. It is a global mutation of every material in the program. The chunk
 *      override is process-wide, and weathering.js already claims
 *      onBeforeCompile on these materials. One more global edit to the same
 *      shaders is one more thing to unpick later.
 *   3. Per-pixel-per-material versus per-pixel-once. Chunk fog runs inside every
 *      fragment shader in the scene and pays for overdraw. This runs exactly
 *      once per screen pixel.
 *
 * The cost is that it needs scene depth. See DEPTH, below.
 *
 * WHY THE FAR FIELD GOES BLUE INSTEAD OF BEIGE
 *
 * This is the whole point of the pass and it is one uniform. Extinction is
 * PER CHANNEL, at roughly (0.94, 1.02, 1.24). Blue is removed fastest, exactly
 * as Rayleigh scattering removes it fastest in the real atmosphere, and the
 * light removed is replaced by the inscattered sky colour, which is blue. So
 * the blue channel converges on the sky hue soonest and the far field cools as
 * it recedes. Our current `FogExp2(0xe8d9b8)` uses one scalar density and one
 * beige colour, so distance converges on beige from every direction: the far
 * wall, the pyramid, and the sky all arrive at the same flat tone and the depth
 * cue dies. That single scalar is most of why our distance reads flat.
 *
 * DEPTH
 *
 * Verified against three.js 0.185.1 sources, not assumed:
 *
 *   - `RenderPass.needsSwap === false` (RenderPass.js:95), so the composer does
 *     not ping-pong after the beauty pass.
 *   - `GTAOPass.setGBuffer()` with no arguments (GTAOPass.js:304-325) creates
 *     its own `WebGLRenderTarget` carrying a `DepthTexture` at
 *     `DepthStencilFormat` / `UnsignedInt248Type`, and `GTAOPass.render()`
 *     refills it every frame via a scene override pass (GTAOPass.js:505). That
 *     texture is public as `gtao.depthTexture`, it is already at composer
 *     resolution, `GTAOPass.setSize()` resizes it with the composer, and
 *     GTAOPass itself samples it with a `.x` swizzle (GTAOPass.js:329).
 *   - `RenderTarget.copy()` CLONES a depth texture rather than sharing it
 *     (RenderTarget.js:381), and the `depthTexture` setter writes a
 *     `renderTarget` back-reference onto the texture (RenderTarget.js:265-270).
 *     So handing the composer a depth-textured render target does NOT give
 *     renderTarget1 and renderTarget2 the same depth attachment, and which of
 *     the two RenderPass drew into is then a thing you have to reason about
 *     every time the pass list changes.
 *
 * Therefore: reuse `gtao.depthTexture`. It is free, it is already correct, and
 * it needs no surgery on the composer. Pass it in as `depthTexture`.
 *
 * If GTAO is off, this pass falls back to rendering its own depth-only
 * G-buffer. That costs a full geometry pass, so it is a fallback and not the
 * plan. See the autoClear note in _renderDepth().
 *
 * Everything is procedural. No loaders, no textures, no storage.
 */

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Tunables. The first five are the reference project's own constants, kept
 * because they are already tuned for an outdoor scene at human scale.
 */
export const FOG_DEFAULTS = {
  sigmaE: 1.45e-3,      // extinction per metre
  heightFalloff: 18,    // metres of e-folding. Small = a shallow ground layer.
  baseY: -2.0,          // world Y at which density is 1.0
  maxDistance: 900,     // clamp. Also the distance assigned to sky pixels.
  nearStart: 0.0,       // no fog at all closer than this
  nearEnd: 12.0,        // full strength by here

  // Per-channel extinction. The reason the distance goes blue. See the header.
  extinctionTint: [0.94, 1.02, 1.24],

  inscatter: 0xa8c3e6,  // the colour distance converges on. Match the zenith.
  inscatterStrength: 1.0,
  sunGlow: 0.85,        // extra inscatter looking into the sun
  sunColor: 0xffe6bd,
};

/**
 * Exponential-height optical depth, in closed form.
 *
 * The integral of exp(-(y - baseY) / H) along a ray has an exact solution, so
 * there is no reason to march it. The abs(x) guard is not decoration: a
 * horizontal ray makes dy zero, the denominator vanishes, and the pixel becomes
 * NaN, which in a HalfFloat buffer propagates through bloom and takes the frame
 * with it. Horizontal rays are the common case in a first-person game.
 */
const HEIGHT_INTEGRAL_GLSL = /* glsl */`
float skHeightIntegral(float y0, float dy, float t) {
  float d0 = exp(-(y0 - uBaseY) * uFalloff);
  float x = dy * uFalloff * t;
  if (abs(x) < 1.0e-4) return d0 * t;
  return d0 * (1.0 - exp(-x)) / (dy * uFalloff);
}
`;

const FOG_VERTEX = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FOG_FRAGMENT = /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;

uniform mat4  uInverseProjection;
uniform mat4  uCameraWorld;
uniform vec3  uCameraPos;
uniform float uNear;
uniform float uFar;

uniform float uSigmaE;
uniform float uFalloff;
uniform float uBaseY;
uniform float uMaxDistance;
uniform float uNearStart;
uniform float uNearEnd;

uniform vec3  uExtinctionTint;
uniform vec3  uInscatter;
uniform float uInscatterStrength;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform float uSunGlow;

varying vec2 vUv;

${HEIGHT_INTEGRAL_GLSL}

void main() {
  vec4 base = texture2D(tDiffuse, vUv);

  // The G-buffer depth texture is DepthStencilFormat / UnsignedInt248Type, so
  // the depth lives in .x. GTAOPass reads it the same way.
  float raw = texture2D(tDepth, vUv).x;

  // --- reconstruct the view ray --------------------------------------------
  // Unproject the pixel to a point on the near plane, then normalise it to a
  // ray with z = -1. Distance along that ray is then just length(ray) * -viewZ,
  // which is a true radial distance rather than the depth-along-Z that a naive
  // reconstruction gives. That difference is visible at the edges of a 75 FOV
  // frame: with -viewZ alone the fog forms a slab and the corners under-fog.
  vec4 clip = vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec4 viewPos = uInverseProjection * clip;
  vec3 ray = viewPos.xyz / viewPos.w;
  ray /= -ray.z;

  // Sky, or anything the depth pass did not draw. Assign the far clamp rather
  // than skipping: the height integral then does the right thing on its own,
  // because a ray pointing up leaves the fog slab within a few tens of metres
  // and picks up almost no optical depth, while a horizon ray stays inside it
  // for the full 900 m and washes out completely. That is what makes the
  // horizon band match the distant geometry with no seam between them.
  bool isSky = raw >= 0.999999;
  float viewZ = isSky
    ? -uMaxDistance
    : (uNear * uFar) / ((uFar - uNear) * raw - uFar);

  float t = min(length(ray) * (-viewZ), uMaxDistance);

  vec3 rd = normalize(mat3(uCameraWorld) * normalize(ray));

  // --- optical depth --------------------------------------------------------
  // The near ramp keeps the wash off anything within arm's reach. The viewmodel
  // is drawn after this pass so it is already immune, but muzzle flashes,
  // impact debris and dust motes are not.
  float nearRamp = smoothstep(uNearStart, uNearEnd, t);

  // Clamped because looking down a steep slope makes the exponential run away,
  // and exp() of a large negative is zero either way.
  float od = min(uSigmaE * skHeightIntegral(uCameraPos.y, rd.y, t) * nearRamp, 40.0);

  vec3 transmittance = exp(-od * uExtinctionTint);

  // --- inscatter ------------------------------------------------------------
  // What replaces the light that was scattered out. Constant plus a forward
  // lobe toward the sun, which is what makes haze glare when you look into it
  // and stay flat when you look away. This runs before tone mapping, so the
  // lobe can legitimately exceed 1.0 and bloom will pick it up.
  float toSun = max(dot(rd, normalize(uSunDir)), 0.0);
  vec3 inscatter = uInscatter * uInscatterStrength
                 + uSunColor * (uSunGlow * pow(toSun, 6.0));

  vec3 col = base.rgb * transmittance + inscatter * (vec3(1.0) - transmittance);

  gl_FragColor = vec4(col, base.a);
}
`;

/**
 * A Pass subclass, following the ViewmodelPass pattern already in post.js.
 */
export class HeightFogPass extends Pass {
  /**
   * @param {THREE.Scene}  scene
   * @param {THREE.Camera} camera
   * @param {object} [options]
   * @param {THREE.DepthTexture} [options.depthTexture] pass gtao.depthTexture here
   * @param {number} [options.width]
   * @param {number} [options.height]
   */
  constructor(scene, camera, options = {}) {
    super();

    const o = { ...FOG_DEFAULTS, ...options };

    this.scene = scene;
    this.camera = camera;

    // A transform, not a composite: read the previous pass, write a new image,
    // let the composer swap. Same shape as ShaderPass.
    this.needsSwap = true;

    this._width = options.width || 1;
    this._height = options.height || 1;

    // --- depth source --------------------------------------------------------
    // External is the intended path. Owning one is the fallback and it costs a
    // whole geometry pass, which is why it is not the default.
    this._ownsDepth = !options.depthTexture;
    this._depthRT = null;
    this._depthMaterial = null;

    if (this._ownsDepth) this._createDepthTarget();

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse:           { value: null },
        tDepth:             { value: options.depthTexture || (this._depthRT && this._depthRT.depthTexture) },

        uInverseProjection: { value: new THREE.Matrix4() },
        uCameraWorld:       { value: new THREE.Matrix4() },
        uCameraPos:         { value: new THREE.Vector3() },
        uNear:              { value: camera.near },
        uFar:               { value: camera.far },

        uSigmaE:            { value: o.sigmaE },
        uFalloff:           { value: 1 / o.heightFalloff },
        uBaseY:             { value: o.baseY },
        uMaxDistance:       { value: o.maxDistance },
        uNearStart:         { value: o.nearStart },
        uNearEnd:           { value: o.nearEnd },

        uExtinctionTint:    { value: new THREE.Vector3(...o.extinctionTint) },
        uInscatter:         { value: new THREE.Color(o.inscatter) },
        uInscatterStrength: { value: o.inscatterStrength },
        uSunDir:            { value: new THREE.Vector3(0.86, 0.30, 0.28).normalize() },
        uSunColor:          { value: new THREE.Color(o.sunColor) },
        uSunGlow:           { value: o.sunGlow },
      },
      vertexShader: FOG_VERTEX,
      fragmentShader: FOG_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });

    this.uniforms = this.material.uniforms;
    this._fsQuad = new FullScreenQuad(this.material);
  }

  _createDepthTarget() {
    // Mirrors GTAOPass.setGBuffer() exactly, so both paths hand the shader a
    // depth texture of the same format and the .x swizzle stays correct.
    const depthTexture = new THREE.DepthTexture();
    depthTexture.format = THREE.DepthStencilFormat;
    depthTexture.type = THREE.UnsignedInt248Type;

    this._depthRT = new THREE.WebGLRenderTarget(this._width, this._height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture,
    });

    // FrontSide, which is what makes this work: the sky dome is BackSide, so it
    // is culled here and never writes depth. Sky pixels keep the cleared 1.0
    // and are recognised as sky by the shader. A DoubleSide override would put
    // the dome at 900 m in every direction and flatten the sky to one tone.
    this._depthMaterial = new THREE.MeshDepthMaterial();
  }

  /**
   * Point the pass at an externally owned depth texture, normally
   * `post.gtao.depthTexture`. Disposes the fallback G-buffer if one was built.
   */
  setDepthTexture(depthTexture) {
    this.uniforms.tDepth.value = depthTexture;

    if (this._ownsDepth && depthTexture) {
      this._depthRT.dispose();
      this._depthRT = null;
      this._depthMaterial.dispose();
      this._depthMaterial = null;
      this._ownsDepth = false;
    }
  }

  setSize(width, height) {
    this._width = width;
    this._height = height;
    if (this._depthRT) this._depthRT.setSize(width, height);
  }

  /**
   * Fill the fallback G-buffer.
   *
   * renderer.autoClear defaults to TRUE and renderer.render() honours it by
   * clearing COLOUR as well as depth. This target is ours, so a clear here is
   * harmless, but the flag is global: leaving it flipped would silently change
   * how every later pass in the composer clears, and a pass that wipes a
   * composer buffer produces a black frame with no console error at all. Save
   * and restore it, always, exactly as GTAOPass._renderOverride() does.
   */
  _renderDepth(renderer) {
    const prevAutoClear = renderer.autoClear;
    const prevTarget = renderer.getRenderTarget();

    renderer.autoClear = false;
    renderer.setRenderTarget(this._depthRT);
    renderer.clear(true, true, false);

    this.scene.overrideMaterial = this._depthMaterial;
    renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  render(renderer, writeBuffer, readBuffer /* , deltaTime, maskActive */) {
    if (this._ownsDepth) this._renderDepth(renderer);

    // Pulled every frame rather than wired from main.js: the camera's FOV
    // changes when the player aims, and a stale inverse projection puts the fog
    // slab at the wrong distance for as long as the zoom lasts.
    const u = this.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.uInverseProjection.value.copy(this.camera.projectionMatrixInverse);
    u.uCameraWorld.value.copy(this.camera.matrixWorld);
    u.uCameraPos.value.setFromMatrixPosition(this.camera.matrixWorld);
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;

    // The quad covers every pixel and samples readBuffer rather than the
    // destination, so whatever autoClear does to writeBuffer here cannot lose
    // anything. This is the safe shape; the dangerous shape is a pass that
    // renders a partial scene into a buffer it also wants to keep.
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this._fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this._fsQuad.dispose();
    if (this._depthRT) this._depthRT.dispose();
    if (this._depthMaterial) this._depthMaterial.dispose();
  }
}

/** Convenience constructor, matching the createX() shape used everywhere else. */
export function createFogPass(scene, camera, options) {
  return new HeightFogPass(scene, camera, options);
}

/*
 * ---------------------------------------------------------------------------
 * INTEGRATION
 * ---------------------------------------------------------------------------
 *
 * src/core/post.js
 *
 *   import { createFogPass } from './fog.js';
 *
 *   // ...after composer.addPass(gtao), BEFORE the viewmodel pass:
 *   const fog = createFogPass(scene, camera, {
 *     width: size.x,
 *     height: size.y,
 *     depthTexture: gtao.depthTexture,
 *   });
 *   composer.addPass(fog);
 *
 * Chain becomes:
 *
 *   RenderPass -> GTAOPass -> HeightFogPass -> ViewmodelPass
 *              -> UnrealBloomPass -> OutputPass -> grade -> SMAAPass
 *
 * That position is load bearing in three ways:
 *   - AFTER GTAO, because GTAO fills the depth texture this pass reads.
 *   - BEFORE the viewmodel, because the depth texture contains the world only.
 *     Fogging after the gun is drawn would fog the gun using the depth of the
 *     wall behind it, and the weapon would haze out at arm's length.
 *   - BEFORE bloom and OutputPass, because this is a linear-HDR scattering
 *     term. Sun-facing haze should be allowed to exceed 1.0, bloom, and then
 *     tone map, in that order.
 *
 * Return it from createPost so main.js can drive it, and gate it in
 * setFidelity() alongside GTAO, since it borrows GTAO's depth:
 *
 *   fog.enabled = high;
 *
 * Per frame, only the sun needs driving, and only if the sun ever moves:
 *
 *   post.fog.uniforms.uSunDir.value.copy(sky.sunDir);
 *
 * Everything else the pass pulls from the camera itself.
 *
 * src/main.js
 *
 *   DELETE line 50:  scene.fog = new THREE.FogExp2(0xe8d9b8, 0.0055);
 *
 * Keeping both double-fogs the frame: FogExp2 washes geometry to beige inside
 * the material, and this pass then extincts what is already beige toward blue,
 * so distance ends up desaturated mud and the per-channel tint has nothing left
 * to work on. The reference project has no scene.fog at all, for this reason.
 *
 * Two follow-ons once it is in:
 *   - The dust cloud and any additive particles were tuned against FogExp2 and
 *     will read hotter without it.
 *   - uInscatter should be matched to the sky dome's uZenith (0x6f95c4) blended
 *     toward uHorizon, or a hue seam appears at the horizon line. The default
 *     0xa8c3e6 is a compromise between the two and is the first thing to tune.
 */
