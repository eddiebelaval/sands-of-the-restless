/**
 * Sky dome and sun.
 *
 * A gradient dome with a sun-glow term, not a flat background colour. This is
 * cheap and it is most of why the opening shot reads as "outdoors under a
 * bleached sky" instead of "grey void".
 *
 * This file also owns the sun as a LIGHT, which makes it the file that decides
 * whether the architecture throws readable shadows. It did not, and the reason
 * was measured rather than guessed: see the note on uSunDir.
 */

import * as THREE from 'three';
import { CLOUD_GLSL, createCloudUniforms, advanceClouds } from './clouds.js';

/**
 * Half-width of the sun's ortho shadow frustum, in world units.
 *
 * This has to cover the whole VISIBLE avenue, not just the player's immediate
 * surroundings. The avenue is 66 units long and the player spawns 30 units
 * from one end, so a frustum that only reached 46 units silently stopped
 * casting shadows a third of the way down the corridor: the far end rendered
 * with no cast shadow at all and nothing in the console said so.
 */
const SHADOW_EXTENT = 56;

/** How far along the sun direction the light sits. Only affects near/far. */
const SUN_DISTANCE = 120;

const SkyShader = {
  uniforms: {
    // Sun position, and the single most consequential number in the file.
    //
    // This was (0.86, 0.30, 0.28): 17.5 degrees of elevation, on the theory
    // that a low raking sun throws the longest shadows. It does. It threw them
    // so far that they missed the frame entirely.
    //
    // The processional avenue is 30 units wide between walls 13 units tall. At
    // 17.5 degrees a 13-unit wall throws 41 units of shadow, so the upwind wall
    // alone blanketed the entire floor and then some. Measured by raycasting a
    // grid of floor samples at the sun: 1.2 PER CENT of the avenue floor could
    // see the sun. The scene was not missing its shadows, it was ENTIRELY
    // inside one, and a shadow with no edge anywhere in frame is indistinguish-
    // able from ambient dimming. That is the whole of "the ground is immune to
    // the sun": there was no boundary left to read.
    //
    // 34 degrees puts the wall's shadow edge back inside the avenue, so the
    // floor carries a hard diagonal boundary the eye can actually find, and
    // the columns and architraves lay bars across it.
    //
    // The bearing is 65 degrees off the avenue axis, on the FAR side, for two
    // reasons. Shadows now fall toward the camera instead of hiding behind the
    // things that cast them, which is the difference between a shadow you can
    // see and a shadow that is merely present. And it puts the sun's aureole
    // just outside the frame edge, so the horizon band is lit from one side
    // without the player having to stare into a 6x overbright disc while they
    // walk down the corridor the level wants them to walk down.
    uSunDir:     { value: new THREE.Vector3(0.7513, 0.5592, -0.3503).normalize() },

    uZenith:     { value: new THREE.Color(0x5f88bd) },
    uHorizon:    { value: new THREE.Color(0xdcc49a) },
    // The bright deck glow, hugging the horizon itself. Deliberately NOT near
    // white: the band already sits on top of a cream horizon, so anything
    // brighter than this mixes the two straight to paper and trades a flat
    // cream band for a flat white one.
    uHazeBand:   { value: new THREE.Color(0xf2dfba) },
    // The forward-scatter warmth on the sun's bearing. A separate, dirtier
    // colour from uSunColor, which is a light source and nearly white.
    uAureole:    { value: new THREE.Color(0xf6cf93) },
    // Blown sand in the inversion layer: warmer and dirtier than the air above.
    uDust:       { value: new THREE.Color(0xd2b183) },
    // The anti-sun horizon. Colder and duller, because it is not forward-
    // scattering anything.
    uAway:       { value: new THREE.Color(0xb9bfc4) },
    uGround:     { value: new THREE.Color(0xb59d76) },
    uSunColor:   { value: new THREE.Color(0xffeec4) },
    uHaze:       { value: 0.55 },
    ...createCloudUniforms(),
  },

  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main() {
      // World-space direction from the camera through this vertex.
      vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */`
    uniform vec3  uSunDir;
    uniform vec3  uZenith;
    uniform vec3  uHorizon;
    uniform vec3  uHazeBand;
    uniform vec3  uAureole;
    uniform vec3  uDust;
    uniform vec3  uAway;
    uniform vec3  uGround;
    uniform vec3  uSunColor;
    uniform float uHaze;
    varying vec3 vDir;

${CLOUD_GLSL}

    void main() {
      vec3 d = normalize(vDir);
      float h = d.y;

      // Bearing on the compass, kept as a point on the unit circle rather than
      // an angle. atan(d.z, d.x) would put a wrap seam at +/-pi straight down
      // the middle of the sky; sampling noise on a circle IN the noise plane
      // wraps for free because the circle closes.
      vec2 az    = normalize(d.xz + vec2(1e-5));
      vec2 sunAz = normalize(uSunDir.xz + vec2(1e-5));
      float toSun = dot(az, sunAz);          // 1 on the sun's bearing, -1 opposite

      // --- vertical structure -------------------------------------------------
      //
      // smoothstep() up from the horizon is the wrong curve, and it is exactly
      // why the band read as dead flat cream: smoothstep's SLOPE IS ZERO at its
      // lower edge, so the first tenth of its range barely moves. The first
      // tenth of the range is where the horizon is, and the horizon is where
      // the eye is. An exponential is steepest at zero, so the band compresses
      // upward and the colour changes fastest precisely where the frame spends
      // most of its sky.
      float deep = exp(-max(h, 0.0) * 2.7);    // the broad warm lift
      float band = exp(-max(h, 0.0) * 11.0);   // the tight bright deck glow

      vec3 col = mix(uZenith, uHorizon, deep);
      col = mix(col, uHazeBand, band * 0.58);

      // --- horizontal structure -----------------------------------------------
      //
      // A horizon that is one colour all the way round is a gradient, not a
      // sky. Real low sky is brightest on the sun's bearing, because that is
      // the longest forward-scattering air path, and colder opposite it. With
      // the sun off frame that gradient is the only thing telling the player
      // which way they are facing.
      //
      // It is a TINT, not a lift. Mixing a light-source colour in at strength
      // here turned the sunward fifth of the frame to paper: a near-white sun
      // colour over an already-cream band has nowhere left to go but white, and
      // a flat white band is not an improvement on a flat cream one. uAureole
      // is dirtier than uSunColor for exactly that reason, and it reaches
      // further up the sky than the deck glow so the two do not share an edge.
      float aureole = pow(max(toSun, 0.0), 2.4);
      float reach = mix(band, deep, 0.35);
      col = mix(col, uAureole, aureole * reach * 0.34);
      col = mix(col, uAway, pow(max(-toSun, 0.0), 1.7) * band * 0.34);

      // --- the dust deck ------------------------------------------------------
      //
      // Blown sand does not thin out smoothly with altitude, it STOPS: the
      // daytime inversion puts a lid on it. That lid is the most legible
      // feature of a real desert horizon and a pure vertical ramp has no way to
      // express it. The lid height is noised around the compass so it undulates
      // instead of reading as a ruled line, and the sampling circle is the
      // seamless trick from above.
      float lid  = 0.072 + 0.030 * skCldFbm2(az * 2.6);
      float deck = smoothstep(lid, lid - 0.055, h) * smoothstep(-0.03, 0.02, h);
      col = mix(col, uDust, deck * 0.42);

      // A second, fainter deck above the first, offset in the noise field so
      // the two lids never agree. One band is a stripe; two unequal bands with
      // clear air between them read as distance.
      float lid2  = 0.185 + 0.055 * skCldFbm2(az * 1.7 + vec2(31.7, 8.3));
      float deck2 = smoothstep(lid2, lid2 - 0.09, h) * smoothstep(lid, lid + 0.06, h);
      col = mix(col, uDust, deck2 * 0.16);

      // Mottle. A mathematically perfect ramp is what actually reads as "flat",
      // and at 8 bits it also bands into visible steps across a fifth of the
      // frame. Expanding the sampling circle with altitude sweeps through fresh
      // noise at every height without ever introducing a wrap seam.
      float mottle = skCldFbm2(az * (3.4 + h * 9.0) + vec2(5.9, -2.1)) - 0.5;
      col *= 1.0 + mottle * 0.085 * (band * 0.7 + deep * 0.3);

      // Below the horizon: the ground haze the dome is standing in.
      col = mix(uGround, col, smoothstep(-0.22, 0.02, h));

      // Sun disc plus a wide atmospheric glow around it.
      float cosA = max(dot(d, normalize(uSunDir)), 0.0);
      float glow = pow(cosA, 28.0) * 0.7 + pow(cosA, 4.0) * uHaze * 0.35;
      float disc = smoothstep(0.9987, 0.9995, cosA);

      col += uSunColor * glow;

      // Clouds are evaluated per-pixel inside the dome rather than as separate
      // geometry: two 2.5D shells with a parallax shear faking vertical extent.
      // A volume march would cost 100x for a result nobody would call better.
      vec4 cl = skClouds(d, normalize(uSunDir), uSunColor);
      col = mix(col, cl.rgb, cl.a);

      // The sun disc is occluded by whatever cloud is in front of it.
      col += uSunColor * disc * 6.0 * (1.0 - cl.a);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createSky(scene, { radius = 900 } = {}) {
  const geo = new THREE.SphereGeometry(radius, 32, 20);

  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms),
    vertexShader: SkyShader.vertexShader,
    fragmentShader: SkyShader.fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const dome = new THREE.Mesh(geo, mat);
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  scene.add(dome);

  // --- the sun as an actual light -------------------------------------------
  const sunDir = mat.uniforms.uSunDir.value.clone();
  const sunDirInit = sunDir.clone();
  const sun = new THREE.DirectionalLight(0xffe0ad, 2.9);
  sun.position.copy(sunDir).multiplyScalar(SUN_DISTANCE);
  sun.castShadow = true;

  // An ortho frustum that follows the player, sized to the space rather than
  // to a round number. Too wide wastes the map on geometry nobody is looking
  // at; too narrow, and shadows stop existing partway down the view with no
  // error of any kind. SHADOW_EXTENT is derived from the avenue's length.
  sun.shadow.camera.left = -SHADOW_EXTENT;
  sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_EXTENT;

  // Bracket the scene instead of spanning 1..320. The depth bias below is a
  // fraction of the near-far range, so a range three times larger than it needs
  // to be makes the same bias value three times as likely to peter-pan the
  // contact shadows off the bottoms of the props.
  sun.shadow.camera.near = SUN_DISTANCE - 100;
  sun.shadow.camera.far = SUN_DISTANCE + 140;
  sun.shadow.camera.updateProjectionMatrix();

  // Widening the frustum from 46 to 56 costs texel density, so the map grows
  // to pay it back: 112 units over 3072 texels is 0.036 per texel, which is
  // finer than the 0.045 the narrower frustum was getting at 2048.
  let shadowTexels = 3072;
  sun.shadow.mapSize.set(shadowTexels, shadowTexels);

  // Constant bias is what detaches a shadow from the object casting it.
  // normalBias does the same job by pushing the LOOKUP along the surface
  // normal instead, which scales correctly with the shadow texel and does not
  // slide contact shadows out from under things. So: most of the budget in
  // normalBias, and only enough constant bias to kill acne on the dunes.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.055;

  scene.add(sun);
  scene.add(sun.target);

  // Sky bounce, deliberately dimmer than the sun. Uniform fill light is the
  // enemy of form: when ambient is high, every surface reads the same
  // brightness regardless of orientation and the geometry goes flat. Real
  // desert noon has brutal contrast between lit and shadowed faces.
  const hemi = new THREE.HemisphereLight(0xa8c6ea, 0xd9b98a, 0.42);
  scene.add(hemi);

  // Almost nothing. The GTAO pass supplies occlusion detail that flat ambient
  // would otherwise wash straight back out.
  const ambient = new THREE.AmbientLight(0xffffff, 0.05);
  scene.add(ambient);

  // A warm bounce from the sand, coming from below and opposite the sun. This
  // is the cheap stand-in for global illumination and it is what keeps shadowed
  // faces from going dead black now that ambient has been pulled down.
  const bounce = new THREE.DirectionalLight(0xffd9a0, 0.55);
  bounce.position.set(-sunDirInit.x, -0.35, -sunDirInit.z).multiplyScalar(60);
  scene.add(bounce);

  // --- sand wrap ------------------------------------------------------------
  //
  // Two adjacent faces of the same limestone were landing at luma 40 and luma
  // 190: one backlit, one square to the sun. 40 is not "stone in shade", it is
  // a hole in the frame, and no amount of grading fixes it because the value is
  // simply not there to lift.
  //
  // The fix has to lift the SHADOWED VERTICAL FACES without lifting the sand,
  // or it buys the walls back at the cost of the cast shadows this file just
  // spent its whole budget making visible. That constraint picks the light for
  // us: a bounce aimed HORIZONTALLY contributes cos(90 deg) = 0 to a floor
  // whose normal points straight up, and its full value to a wall. So these sit
  // a hair BELOW the horizon and wrap around the anti-sun bearing, which is
  // physically what a sunlit courtyard floor actually does to the walls around
  // it.
  //
  // Two of them at +/-72 degrees rather than one, because a single fill leaves
  // every face perpendicular to it as black as before, just in a different
  // direction.
  const antiSun = new THREE.Vector2(-sunDirInit.x, -sunDirInit.z).normalize();

  const wrapLight = (deg, intensity, hex) => {
    const a = deg * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const l = new THREE.DirectionalLight(hex, intensity);
    l.position.set(
      antiSun.x * c - antiSun.y * s,
      -0.10,                                  // just under the horizon
      antiSun.x * s + antiSun.y * c,
    ).multiplyScalar(70);
    scene.add(l);
    return l;
  };

  const wrapA = wrapLight(72, 0.38, 0xffcf9a);
  const wrapB = wrapLight(-72, 0.38, 0xf6d9b6);

  // Scratch vectors for the shadow snap, allocated once. follow() runs every
  // frame and this is not a place to be making garbage.
  const _dir = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _centre = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);

  return {
    dome,
    sun,
    hemi,
    ambient,
    bounce,
    wrapA,
    wrapB,
    sunDir,

    /**
     * Keep the shadow frustum centred on the player, snapped to the texel grid.
     *
     * The snap is the part that is easy to leave out and impossible to unsee
     * afterwards. A frustum that slides continuously re-rasterises the same
     * shadow edge into a different set of texels every frame, so every boundary
     * in the scene crawls and fizzes while you walk. Quantising the centre to
     * whole texels makes the sample pattern identical frame to frame and the
     * edges hold still. It costs nothing and it does not show up in a still.
     */
    follow(target) {
      _dir.copy(sunDir).normalize();

      // Basis of the shadow camera's image plane. Degenerate only if the sun is
      // exactly overhead, which no sun in this file ever is.
      _right.crossVectors(WORLD_UP, _dir).normalize();
      _up.crossVectors(_dir, _right).normalize();

      const texel = (SHADOW_EXTENT * 2) / shadowTexels;
      const a = Math.round(target.dot(_right) / texel) * texel;
      const b = Math.round(target.dot(_up) / texel) * texel;
      const c = target.dot(_dir);

      _centre.copy(_right).multiplyScalar(a)
        .addScaledVector(_up, b)
        .addScaledVector(_dir, c);

      sun.target.position.copy(_centre);
      sun.position.copy(_centre).addScaledVector(_dir, SUN_DISTANCE);
      sun.target.updateMatrixWorld();
    },

    /** Drift the cloud field. Wind is time-based, so it needs the delta. */
    update(dt) {
      advanceClouds(mat.uniforms, dt);
    },

    /** Keep the dome centred on the camera so it never gets walked out of. */
    track(camera) {
      dome.position.copy(camera.position);
    },

    setFidelity(high) {
      // Fewer noise octaves in the cloud shader on the low setting.
      mat.defines = high ? {} : { SK_CLOUD_LOW: '' };
      mat.needsUpdate = true;

      sun.castShadow = high;
      // follow() derives the texel snap from this, so it has to be the same
      // number the shadow map is actually allocated at.
      shadowTexels = high ? 3072 : 1024;
      sun.shadow.mapSize.set(shadowTexels, shadowTexels);
    },
  };
}
