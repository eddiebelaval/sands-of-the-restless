/**
 * First-person viewmodel: procedural weapons and the animation state machine
 * that carries them.
 *
 * Two decisions shape this file.
 *
 * 1. RENDER PATH. The viewmodel lives in its own scene with its own narrow-FOV
 *    camera, drawn as a second forward pass after the main one with the depth
 *    buffer cleared. The alternative (leave it in the world scene, bump
 *    renderOrder, disable depthTest) is fewer lines but it throws away
 *    self-occlusion: with depthTest off, a forty-part weapon draws in list
 *    order, so the magazine paints over the receiver and the far side of the
 *    handguard paints over the near side. These models are built from many
 *    small parts precisely so they read as machined objects, and that reading
 *    depends on the parts occluding each other correctly. A separate scene
 *    keeps a real depth buffer for the weapon while guaranteeing it can never
 *    clip into a wall, because the world is simply not in it. It also means
 *    the viewmodel carries its own three directional lights without touching
 *    the world's hard-capped light budget, and the muzzle flash PointLight
 *    only ever illuminates the weapon.
 *
 *    The cost is that the viewmodel bypasses the post chain. That is a feature
 *    here: no bloom smear or chromatic aberration on the thing the player
 *    stares at for the whole game.
 *
 * 2. THE ADS POSE IS SOLVED, NOT AUTHORED. Every weapon is modelled with its
 *    bore along -Z and returns the local position of its rear sight element
 *    (aperture centre, notch, or optic axis) as `sight`. The ADS pose is then
 *    derived: put that point at (0, 0, -relief) in view space, which is
 *    exactly where the crosshair is, so
 *
 *        adsPose.pos = (-sight.x, -sight.y, -(relief + sight.z))
 *
 *    This is not a tidiness refactor. The hand-authored version carried one
 *    magic triple per weapon, so moving a model's SIGHT_Y silently broke that
 *    weapon's aim and nothing caught it until a screenshot: the pistol shipped
 *    with 190mm of eye relief instead of 400mm and filled the middle of the
 *    frame with the back of its own slide. Solving it means the sight picture
 *    is a consequence of the model, and the only per-weapon number left is eye
 *    relief, which is a real physical quantity you can sanity check by eye
 *    (a pistol at arm's length is far; a scope is close).
 *
 * Geometry is built from THREE.BoxGeometry directly rather than through
 * world/uv.js. That helper scales UVs by world size, which is right for walls
 * and wrong here: see the procedural surface maps section for why a viewmodel
 * wants constant-per-face UVs and a scale-agnostic pattern instead.
 *
 * Every rate in here is per second and multiplied by delta.
 */

import * as THREE from 'three';
import { buildMaterials } from '../world/materials.js';

// ---------------------------------------------------------------------------
// tuning
// ---------------------------------------------------------------------------

// Narrower than the world camera (75). A wide FOV on a viewmodel stretches the
// near end of the weapon into a fisheye wedge; every shooter renders the gun
// through a tighter lens than the world for exactly this reason.
const VM_FOV = 55;
const VM_NEAR = 0.008;
const VM_FAR = 12;

const MAX_DELTA = 1 / 20;

const RAISE_TIME = 0.34;
const LOWER_TIME = 0.22;
const INSPECT_TIME = 2.3;

// Recoil spring. Same shape as the camera's in player/camera.js, tuned stiffer
// because the model has to return before the next round on an 800rpm weapon.
const RECOIL_STIFF = 210;
const RECOIL_DAMP = 20;

// Emissive strength of the Sunspear core. Bright enough to read as light,
// low enough that the geometry underneath does not blow out to flat cream.
const CORE_EMISSIVE = 1.9;

const SHELL_POOL = 18;
const SHELL_GRAVITY = 3.6;      // exaggerated: view space, short life
const SHELL_FLOOR = -0.52;      // fake floor, see spawnShell
const SHELL_LIFE = 1.35;

// ---------------------------------------------------------------------------
// geometry helpers
//
// Geometries are cached by dimension because seven weapons share a lot of
// small parts (rail teeth, grip ribs, sling loops) and there is no reason to
// hold sixty copies of the same 3mm box.
// ---------------------------------------------------------------------------

const geoCache = new Map();

function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

const boxGeo = (w, h, d) =>
  cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));

const cylGeo = (rt, rb, len, seg) =>
  cached(`c${rt},${rb},${len},${seg}`, () => new THREE.CylinderGeometry(rt, rb, len, seg));

const torusGeo = (r, t, seg) =>
  cached(`t${r},${t},${seg}`, () => new THREE.TorusGeometry(r, t, 6, seg));

const coneGeo = (r, h, seg) =>
  cached(`n${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));

// Open-ended cylinder, for optic housings. A capped cylinder used as a scope
// tube puts an opaque disc across the sight line, which is the difference
// between an optic and a black circle in the middle of the frame.
const tubeGeo = (r, len, seg) =>
  cached(`u${r},${len},${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg, 1, true));

/** Axis-aligned block. The workhorse. */
function box(mat, w, h, d, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/**
 * Cylinder along an axis. Barrels and gas tubes run along z, grips and posts
 * along y, cross pins along x.
 */
function rod(mat, rTop, rBot, len, x, y, z, axis = 'z', seg = 12) {
  const m = new THREE.Mesh(cylGeo(rTop, rBot, len, seg), mat);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  else if (axis === 'x') m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

/** Open tube along the bore. Optic housings only. */
function tube(mat, r, len, x, y, z, seg = 18) {
  const m = new THREE.Mesh(tubeGeo(r, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

/** Ring facing down the bore. Rear apertures, barrel bands, scope bells. */
function ring(mat, r, t, x, y, z, seg = 16) {
  const m = new THREE.Mesh(torusGeo(r, t, seg), mat);
  m.position.set(x, y, z);
  return m;
}

// ---------------------------------------------------------------------------
// procedural surface maps
//
// The world ships scanned PBR materials and the weapon shipped with none, so
// every gun surface was a single flat fill. That is 20-30 percent of every
// frame with no material information in it at all: a big untextured face has
// exactly one value across it, and the eye reads it as painted card rather
// than as steel.
//
// Everything here is drawn into a canvas at first equip and uploaded once. No
// files are loaded, and seven weapons share three surface families, so this is
// nine small textures for the whole viewmodel.
//
// The real constraint is UVs. These parts are BoxGeometry, so every face
// carries 0..1 no matter how big the face is, and a 3mm rail tooth would show
// the same texel count as a 300mm receiver. Rather than fight that with
// per-part UV scaling (which would mean per-part materials, which would mean
// forty draw calls a weapon), every pattern here is deliberately high
// frequency and scale-agnostic: parkerising reads as parkerising whether you
// are seeing one tile of it or nine. Anything with a large feature in it -
// a logo, a panel line, a woven twill - would give the trick away instantly.
// ---------------------------------------------------------------------------

const TEX_SIZE = 128;

const lerpN = (a, b, t) => a + (b - a) * t;

/** Deterministic hash. Seeded per pattern so the three families differ. */
function hash2(x, y, seed) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Value noise on a wrapping lattice. The wrap is what makes the result
 * tileable, which matters here because every one of these maps repeats several
 * times across a face.
 */
function tileNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const wrap = (n) => ((n % period) + period) % period;
  const x0 = wrap(xi), x1 = wrap(xi + 1);
  const y0 = wrap(yi), y1 = wrap(yi + 1);

  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return lerpN(lerpN(a, b, u), lerpN(c, d, u), v);
}

/** Tileable fbm. Each octave doubles the lattice period so the tile survives. */
function tileFbm(x, y, basePeriod, octaves, seed) {
  let sum = 0, amp = 1, norm = 0, p = basePeriod;
  for (let i = 0; i < octaves; i++) {
    sum += tileNoise(x * p, y * p, p, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

/**
 * Height field -> tangent-space normal map, by central difference.
 *
 * Written straight into ImageData rather than through canvas drawing calls
 * because the whole point is per-texel control of the gradient; there is no
 * 2D context operation that produces a normal map.
 */
function normalFromHeight(height, size, strength) {
  const img = new ImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;

      // Normalise (-dx, -dy, 1) and pack to 0..255.
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      img.data[i] = Math.round((-dx / len * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  return img;
}

/** Greyscale field -> texture. Used for roughness and for albedo mottling. */
function fieldTexture(field, size, lo, hi, tint) {
  const img = new ImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = lo + field[i] * (hi - lo);
    const o = i * 4;
    img.data[o] = Math.round(Math.min(255, v * 255 * (tint ? tint[0] : 1)));
    img.data[o + 1] = Math.round(Math.min(255, v * 255 * (tint ? tint[1] : 1)));
    img.data[o + 2] = Math.round(Math.min(255, v * 255 * (tint ? tint[2] : 1)));
    img.data[o + 3] = 255;
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

function imageTexture(imgData, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').putImageData(imgData, 0, 0);
  return c;
}

/** Wrap a canvas as a repeating texture. */
function repeatTex(canvas, repeat, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let texCache = null;

/**
 * Three surface families, each with an albedo mottle, a normal and a
 * roughness. They differ in what the height field is made of, which is the
 * only thing that separates parkerised steel from moulded polymer from worn
 * leather at this distance.
 */
function surfaceMaps() {
  if (texCache) return texCache;

  const S = TEX_SIZE;
  const n = S * S;

  const metalH = new Float32Array(n);
  const polyH = new Float32Array(n);
  const gloveH = new Float32Array(n);
  const handH = new Float32Array(n);

  const metalR = new Float32Array(n);
  const polyR = new Float32Array(n);
  const gloveR = new Float32Array(n);
  const handR = new Float32Array(n);

  const metalA = new Float32Array(n);
  const gloveA = new Float32Array(n);
  const handA = new Float32Array(n);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const u = x / S, v = y / S;

      // --- parkerised steel ------------------------------------------------
      // Two layers. A fine isotropic phosphate speckle, which is the finish
      // itself, plus a faint directional draw line along U, which is the
      // machining. The draw line is what tells the eye the surface is metal
      // rather than stone: stone has no direction.
      const speckle = tileFbm(u, v, 24, 3, 1.0);
      const draw = tileNoise(u * 6, v * 96, 96, 4.0);
      metalH[i] = speckle * 0.75 + draw * 0.25;

      // Rough where the phosphate sits, smooth where it has been rubbed off.
      // A single roughness value over a whole receiver is the reason untextured
      // gunmetal reads as plastic: real steel is polished in the places hands
      // and holsters touch and matte everywhere else.
      const wear = tileFbm(u, v, 4, 4, 9.0);
      metalR[i] = 0.42 + speckle * 0.44 - Math.max(0, wear - 0.62) * 1.5;

      // Albedo mottle: slightly lighter where the finish is worn thin.
      metalA[i] = 0.82 + Math.max(0, wear - 0.58) * 0.9 + speckle * 0.14;

      // --- moulded polymer --------------------------------------------------
      // Stipple, which is what a real grip texture is: a field of raised
      // pyramids, not a crosshatch. Cheap to fake as thresholded high
      // frequency noise, and it survives being seen at any scale.
      const dots = tileNoise(u * 40, v * 40, 40, 21.0);
      polyH[i] = dots > 0.55 ? 1.0 : 0.15 + tileFbm(u, v, 16, 2, 3.0) * 0.2;
      polyR[i] = 0.72 + (dots > 0.55 ? 0.22 : 0) - tileFbm(u, v, 3, 3, 6.0) * 0.16;

      // --- worn leather -----------------------------------------------------
      // Coarse cell structure with a finer grain inside it. The cells are what
      // make a glove read as leather instead of as painted cloth, and they
      // are the difference between a hand and a cream card.
      const cell = tileFbm(u, v, 8, 2, 33.0);
      const grain = tileFbm(u, v, 32, 3, 41.0);
      gloveH[i] = cell * 0.65 + grain * 0.35;
      gloveR[i] = 0.80 + grain * 0.20 - Math.max(0, cell - 0.66) * 0.55;
      gloveA[i] = 0.66 + cell * 0.34 + grain * 0.16;

      // --- glove leather at HAND scale --------------------------------------
      // The family above is authored for a sleeve and its cells land about
      // 15mm apart, which on a 12mm finger segment is one blotch per phalanx:
      // the finger comes out looking like a marbled tile rather than like
      // leather. This is the same idea an octave and a half finer, plus a
      // woven weft - two thread runs at right angles, integer periods so the
      // tile still wraps - because a work glove is cloth-backed and the weave
      // is what says "worn on a hand" instead of "moulded".
      //
      // It also carries a much narrower albedo range than the sleeve. Wide
      // albedo mottle on a part this small competes with the modelled creases
      // and the creases are the whole point.
      const weave = Math.abs(Math.sin(u * Math.PI * 22)) * 0.5
        + Math.abs(Math.sin(v * Math.PI * 22)) * 0.5;
      const pore = tileFbm(u, v, 34, 3, 57.0);
      const fleck = tileNoise(u * 72, v * 72, 72, 63.0);
      handH[i] = weave * 0.30 + pore * 0.52 + fleck * 0.18;
      handR[i] = 0.78 + pore * 0.22 - Math.max(0, pore - 0.72) * 0.7;
      handA[i] = 0.80 + pore * 0.20;
    }
  }

  texCache = {
    metalNormal: repeatTex(imageTexture(normalFromHeight(metalH, S, 2.2), S), 5),
    metalRough: repeatTex(fieldTexture(metalR, S, 0.25, 1.0), 5),
    metalAlbedo: repeatTex(fieldTexture(metalA, S, 0.55, 1.0), 5, true),

    polyNormal: repeatTex(imageTexture(normalFromHeight(polyH, S, 3.0), S), 4),
    polyRough: repeatTex(fieldTexture(polyR, S, 0.35, 1.0), 4),

    gloveNormal: repeatTex(imageTexture(normalFromHeight(gloveH, S, 3.4), S), 3),
    gloveRough: repeatTex(fieldTexture(gloveR, S, 0.45, 1.0), 3),
    gloveAlbedo: repeatTex(fieldTexture(gloveA, S, 0.45, 1.0), 3, true),

    // Repeated eight times rather than three, which is the whole difference:
    // a finger face is 12mm across, so eight tiles put the grain at 1.5mm and
    // it reads as grain instead of as a pattern.
    handNormal: repeatTex(imageTexture(normalFromHeight(handH, S, 2.6), S), 8),
    handRough: repeatTex(fieldTexture(handR, S, 0.50, 1.0), 8),
    handAlbedo: repeatTex(fieldTexture(handA, S, 0.72, 1.0), 8, true),
  };
  return texCache;
}

// ---------------------------------------------------------------------------
// materials
//
// Derived once from the shared registry. The wear strips are the cheapest
// trick in the file: a 1mm sliver of lighter, smoother metal laid along a top
// edge reads as a chamfer polished by holster and hand, and a darker sliver in
// a corner reads as a shadowed seam. Without them a box stays a box.
// ---------------------------------------------------------------------------

/**
 * How much of the scene environment the cloth and leather materials take.
 *
 * This constant exists because main.js replaces this scene's environment with
 * the world's real desert HDRI at intensity 1.15 once the assets resolve. That
 * is the right call for the weapon - steel standing in a desert should reflect
 * the desert - and completely wrong for the hands. A clear-sky HDRI carries a
 * sun disc, and integrated over the hemisphere that is tens of units of
 * diffuse irradiance. Leather rendered under it measured 201,176,143 on the
 * forearm: a flat cream card with every fold clipped out of it, which is
 * exactly the note that came back on the hands.
 *
 * envMapIntensity is the per-material lever for that, and it is the right one:
 * it scales with whatever main.js decides the environment should be, instead
 * of hard-coding an albedo that only looks correct at one exposure. Metal
 * keeps the full desert; cloth takes about a tenth of it.
 */
const CLOTH_ENV = 0.07;

/**
 * The same lever again for the hand proper, held lower still.
 *
 * A sleeve is a big smooth form and a wash of sky over it is harmless. A hand
 * is nothing BUT small creases, and every unit of undirected environment fills
 * those creases at the same rate it lights the ridges beside them, which is
 * flattening in the exact place the shape lives. The hands want to be lit
 * almost entirely by the key, so they have a light side and a dark side and
 * the modelled shadow between two fingers survives.
 */
const HAND_ENV = 0.04;

let paletteCache = null;

function palette(M) {
  if (paletteCache) return paletteCache;

  const T = surfaceMaps();

  // gunmetal and polymer are CLONED out of the shared registry rather than
  // used in place. The world uses those same two materials on props, and
  // hanging viewmodel-scale maps on them would retexture half the courtyard
  // from inside this file.
  const metal = M.gunmetal.clone();
  metal.map = T.metalAlbedo;
  metal.normalMap = T.metalNormal;
  metal.roughnessMap = T.metalRough;
  metal.normalScale = new THREE.Vector2(0.65, 0.65);
  // roughnessMap MULTIPLIES this, and the map averages about 0.7, so the base
  // goes up to land the product near the original 0.35.
  metal.roughness = 0.55;
  // Lifted off black, and de-metalled slightly. At metalness 0.90 under the
  // world's sky HDRI the receiver had almost no diffuse of its own and
  // rendered as a mirror of the sky, which is to say navy. Some diffuse is
  // what stops a weapon taking the colour of whatever is above it.
  //
  // The environment is also held well back here, and that is the other half of
  // the same problem. A dark rough metal under a big bright sky dome averages
  // to light blue-grey no matter what its albedo is, because almost all of
  // what it shows is sky. Weapon metal has to be lit mostly by a KEY, from a
  // direction, so that it has a light side and a dark side; the sky is then a
  // fill on top of that rather than the whole picture.
  metal.color.setHex(0x565049);
  metal.metalness = 0.80;
  metal.envMapIntensity = 0.22;

  const poly = M.polymer.clone();
  poly.normalMap = T.polyNormal;
  poly.roughnessMap = T.polyRough;
  poly.normalScale = new THREE.Vector2(0.85, 0.85);
  poly.roughness = 0.95;
  poly.color.setHex(0x25272c);
  poly.envMapIntensity = 0.10;

  paletteCache = {
    metal,
    poly,

    // Worn edge: brighter and smoother than gunmetal, so it catches the key
    // light along the chamfer and nowhere else. It keeps the normal map (a
    // chamfer is still machined) but not the roughness map, because the whole
    // job of this material is to be the one uniformly polished thing.
    edge: new THREE.MeshStandardMaterial({
      color: 0x9aa2ad, roughness: 0.30, metalness: 0.96,
      normalMap: T.metalNormal, normalScale: new THREE.Vector2(0.3, 0.3),
      envMapIntensity: 0.30,
    }),

    // Shadow seam / port cut / vent slot.
    seam: new THREE.MeshStandardMaterial({
      color: 0x14161b, roughness: 0.55, metalness: 0.70,
      envMapIntensity: 0.12,
    }),

    // Phosphate finish: flatter than gunmetal, for barrels and bolt carriers.
    dark: new THREE.MeshStandardMaterial({
      color: 0x2c2e33, roughness: 0.68, metalness: 0.85,
      map: T.metalAlbedo, normalMap: T.metalNormal, roughnessMap: T.metalRough,
      normalScale: new THREE.Vector2(0.55, 0.55),
      envMapIntensity: 0.20,
    }),

    // Stock furniture on the bolt rifle. Warm, matte, non-metal. It borrows
    // the leather grain rather than getting a fourth family of its own: wood
    // and leather share a coarse-cell-plus-fine-grain structure, and at 40cm
    // through a 55 degree lens nobody is counting pores.
    wood: new THREE.MeshStandardMaterial({
      color: 0x5c452a, roughness: 0.72, metalness: 0.02,
      normalMap: T.gloveNormal, roughnessMap: T.gloveRough,
      normalScale: new THREE.Vector2(0.5, 0.5),
      envMapIntensity: CLOTH_ENV * 2.6,
    }),

    // --- the hand ------------------------------------------------------------
    //
    // Five materials, and the only thing that matters about them is that they
    // form a VALUE LADDER that the modelled geometry can stand on:
    //
    //     gloveDark  crease between two fingers, under-palm
    //     glovePalm  palm and the shaded underside of every segment
    //     glove      the body of the hand
    //     gloveLit   knuckles, tendon ridges, the thumb pad
    //
    // At this polygon count there is no per-pixel occlusion to draw a crease
    // for us, so the crease is a material. Four steps is the minimum that lets
    // a knuckle read as proud of a finger and a finger read as separate from
    // the finger beside it at the same time.
    //
    // Every one of them is roughly a third of the albedo the previous pass
    // used. The measured problem was not hue and not shading: it was that the
    // lit face of a hand came out at 190,160,120 against sand at 189,169,134.
    // Two objects at the same value have no edge between them no matter how
    // well either one is modelled, and the note that came back - "flat cream
    // cards" - is what a shape with no silhouette looks like. A worn glove is
    // a genuinely dark object; against a sunlit desert it should sit two stops
    // under the ground behind it, and then every crease in it has somewhere to
    // go.
    glove: new THREE.MeshStandardMaterial({
      color: 0x3a2a1c, roughness: 0.92, metalness: 0.0,
      map: T.handAlbedo, normalMap: T.handNormal, roughnessMap: T.handRough,
      normalScale: new THREE.Vector2(1.1, 1.1),
      envMapIntensity: HAND_ENV,
    }),

    // The shadow between two fingers, and the seat of every joint. Sunk into
    // the surface rather than laid on it, so it is a gap and not a stripe.
    gloveDark: new THREE.MeshStandardMaterial({
      color: 0x100b07, roughness: 0.97, metalness: 0.0,
      normalMap: T.handNormal, normalScale: new THREE.Vector2(0.7, 0.7),
      envMapIntensity: HAND_ENV * 0.5,
    }),

    // The palm side and the underside of the fingers: in shadow from the key
    // by construction, because the key is above and the palm faces the grip.
    // Modelling that as albedo as well as as geometry doubles the read.
    glovePalm: new THREE.MeshStandardMaterial({
      color: 0x261b10, roughness: 0.95, metalness: 0.0,
      map: T.handAlbedo, normalMap: T.handNormal, roughnessMap: T.handRough,
      normalScale: new THREE.Vector2(1.0, 1.0),
      envMapIntensity: HAND_ENV,
    }),

    // Knuckles, tendon ridges over the back of the hand, and the thumb pad.
    // These are the parts that stand proud and catch the key, and they are the
    // single strongest cue that a shape is a hand: four separate highlights in
    // a row along a fold is a knuckle line and nothing else looks like it.
    gloveLit: new THREE.MeshStandardMaterial({
      color: 0x4f3a24, roughness: 0.74, metalness: 0.0,
      map: T.handAlbedo, normalMap: T.handNormal, roughnessMap: T.handRough,
      normalScale: new THREE.Vector2(1.2, 1.2),
      envMapIntensity: HAND_ENV,
    }),

    // Wrapped linen cuff where the arm leaves the frame. It is the part that
    // says "this is a person" rather than "this is a mitten": an arm that just
    // stops at the wrist edge of the screen reads as a severed prop.
    //
    // This is the one element deliberately LIGHTER than the glove. A hand and
    // a forearm modelled in one value are one tube; the wrist only exists if
    // something changes value there, and a lapped cloth wrap is the cheapest
    // honest reason for the change. It is still a stop under the sand, so it
    // marks the joint without winning the frame.
    cuff: new THREE.MeshStandardMaterial({
      color: 0x4a3520, roughness: 0.95, metalness: 0.0,
      map: T.gloveAlbedo, normalMap: T.gloveNormal, roughnessMap: T.gloveRough,
      normalScale: new THREE.Vector2(1.2, 1.2),
      envMapIntensity: CLOTH_ENV * 0.6,
    }),

    // Sleeve past the cuff. Darkest of the lot, because it is the part that
    // runs off the bottom of the frame and it should fall away rather than
    // glow there.
    sleeve: new THREE.MeshStandardMaterial({
      color: 0x281e15, roughness: 0.97, metalness: 0.0,
      map: T.gloveAlbedo, normalMap: T.gloveNormal, roughnessMap: T.gloveRough,
      normalScale: new THREE.Vector2(1.2, 1.2),
      envMapIntensity: CLOTH_ENV * 0.6,
    }),

    brass: new THREE.MeshStandardMaterial({
      color: 0xb28b3f, roughness: 0.30, metalness: 0.95,
      envMapIntensity: 0.30,
    }),

    // Sunspear core. Emissive hot enough that the bloom pass would have
    // something to chew on if the viewmodel went through post.
    core: new THREE.MeshStandardMaterial({
      color: 0x6b3f12, emissive: 0xff9c22, emissiveIntensity: CORE_EMISSIVE,
      roughness: 0.4, metalness: 0.2,
    }),

    // Optic glass, and the one place transparency earns its cost. The
    // viewmodel is drawn into the already-composited colour buffer, so a
    // translucent lens blends with the world that was rendered a moment ago:
    // a scope you can genuinely see through, at 1x, for one material flag.
    // A solid blue disc where the sight picture should be is the single most
    // obvious tell that a viewmodel was never actually looked at.
    lens: new THREE.MeshStandardMaterial({
      color: 0x203546, emissive: 0x2f5f88, emissiveIntensity: 0.14,
      roughness: 0.16, metalness: 0.4, envMapIntensity: 0.5,
      transparent: true, opacity: 0.20, depthWrite: false,
    }),

    // Optic housing. Double sided, because it is applied to open-ended tubes
    // and the player is looking down the inside of one of them.
    housing: new THREE.MeshStandardMaterial({
      color: 0x24262b, roughness: 0.62, metalness: 0.86,
      side: THREE.DoubleSide,
      map: T.metalAlbedo, normalMap: T.metalNormal, roughnessMap: T.metalRough,
      normalScale: new THREE.Vector2(0.5, 0.5),
      envMapIntensity: 0.20,
    }),

    // Illuminated reticle. Unlit, and its own material rather than P.core,
    // because the Sunspear animates P.core.emissiveIntensity during a reload
    // and a red dot has no business browning out when an energy cell is
    // swapped on a different weapon.
    dot: new THREE.MeshBasicMaterial({ color: 0xff5236 }),

    // Muzzle flash. Unlit and additive: it is light, not a surface.
    flash: new THREE.MeshBasicMaterial({
      color: 0xffd79a, transparent: true, opacity: 0.92,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  };

  return paletteCache;
}

// ---------------------------------------------------------------------------
// shared sub-assemblies
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// hands
//
// A hand at this budget is not a set of boxes NEAR the grip. It is a set of
// slabs lying ON the grip, and that distinction is what this third pass is for.
// The two previous versions authored every knuckle as a free-standing box
// positioned by eye in weapon space, stepped along a straight line. On a GPU
// that read as loose cardboard scattered around the pistol, because nothing in
// it was ever in contact with the thing it was supposed to be holding and
// nothing followed a curve. Fingers that step in a line are slats; fingers that
// follow an arc are fingers.
//
// So everything below is expressed in ONE frame with ONE primitive.
//
//   The frame: the thing being gripped is an elliptical cylinder along local
//   +Z, angle 0 at +X. Elliptical and not circular because a grip is 30mm wide
//   and 48mm deep, and a circular wrap hugs the front strap while floating 6mm
//   off the flanks - which is precisely the gap that read as "floating".
//
//   The primitive: a slab lying on that ellipse at a given angle, a given
//   distance out from the surface, rotated to the surface NORMAL. A phalanx is
//   that slab flush and slightly sunk, so it bites into the grip. A knuckle is
//   the same slab standing proud. The crease between two fingers is the same
//   slab sunk further in. That is the entire vocabulary.
//
// A pistol grip and a handguard are then the same hand with the frame turned a
// quarter turn, which is why there is one hand builder here instead of three.
// ---------------------------------------------------------------------------

/**
 * Outward unit normal of the gripped ellipse at arc parameter `a`.
 *
 * Not simply (cos a, sin a): on an ellipse the parameter angle and the normal
 * angle differ, and using the wrong one skews every finger away from the
 * surface it is meant to be touching by up to fifteen degrees on the flanks.
 */
function arcNormal(e, a) {
  const nx = Math.cos(a) / e.rx;
  const ny = Math.sin(a) / e.ry;
  const nl = Math.hypot(nx, ny) || 1;
  return [nx / nl, ny / nl];
}

/** Straight-line distance across the ellipse between two arc parameters. */
function arcChord(e, a, b) {
  return Math.hypot(
    (Math.cos(b) - Math.cos(a)) * e.rx,
    (Math.sin(b) - Math.sin(a)) * e.ry);
}

/**
 * A slab lying on the gripped ellipse: `t` thick radially, `l` long along the
 * tangent, `w` wide along the cylinder axis, with its centre `out` from the
 * surface. Negative-ish values of `out` sink it in, which is how a crease is
 * made.
 */
function onArc(mat, e, a, z, t, l, w, out) {
  const [ux, uy] = arcNormal(e, a);
  const m = new THREE.Mesh(boxGeo(t, l, w), mat);
  m.position.set(Math.cos(a) * e.rx + ux * out, Math.sin(a) * e.ry + uy * out, z);
  m.rotation.z = Math.atan2(uy, ux);
  return m;
}

/**
 * A local frame standing on the ellipse: +X radially out, +Y tangential, +Z
 * along the cylinder axis. Used for the two parts that run ALONG the gripped
 * object rather than around it - the thumb and the wrist - because those need
 * a second rotation of their own and Euler order on a single object makes that
 * unreadable.
 */
function arcFrame(e, a, z, out) {
  const [ux, uy] = arcNormal(e, a);
  const f = new THREE.Group();
  f.position.set(Math.cos(a) * e.rx + ux * out, Math.sin(a) * e.ry + uy * out, z);
  f.rotation.z = Math.atan2(uy, ux);
  return f;
}

/**
 * One finger: three phalanges following the arc with a proud knuckle at each
 * joint.
 *
 * The taper is not decoration. A finger and a length of hose differ by exactly
 * two things at gameplay distance - the taper and the joints - and both of
 * them are three lines here.
 */
function wrapFinger(g, P, e, z, w, t, a0, a1) {
  const step = (a1 - a0) / 3;

  for (let k = 0; k < 3; k++) {
    const tk = t * (1 - k * 0.15);
    const wk = w * (1 - k * 0.10);
    const sa = a0 + step * k;
    const ea = a0 + step * (k + 1);
    const chord = arcChord(e, sa, ea);

    // Body of the phalanx. Sunk to a third of its thickness, so it bites into
    // the grip instead of resting against it: a finger that only touches is a
    // finger that floats the moment the camera moves.
    g.add(onArc(P.glove, e, (sa + ea) / 2, z, tk, chord * 1.16, wk, tk * 0.45));

    if (k < 2) {
      // Knuckle, and it goes at the START of the segment.
      //
      // The big one is the joint where the finger meets the back of the hand,
      // which sits ON the knuckle line at a0 - not one phalanx further round
      // the wrap, which is where the previous version put it. That is a subtle
      // error on paper and a fatal one in first person: the camera looks
      // straight down at the back of the firing hand for the entire game, so
      // the knuckle row is the one part of the hand always on screen, and a row
      // of bumps parked on the far side of the grip is a row nobody ever sees.
      //
      // Four of them in a line along a fold is the single strongest cue in this
      // whole viewmodel that a shape is a hand. Nothing else looks like it.
      const big = k === 0;
      g.add(onArc(P.gloveLit, e, sa + step * (big ? 0.03 : 0.05), z,
        tk * (big ? 0.80 : 0.58),
        chord * (big ? 0.60 : 0.44),
        wk * (big ? 1.02 : 0.92),
        tk * (big ? 1.02 : 0.86)));
    }
  }
}

/**
 * The shared hand, in the canonical frame. See the section header for what the
 * frame is; everything here is angles around it and steps along it.
 *
 *   a0        angle of the knuckle line, where the fingers leave the hand
 *   dir       which way round the fingers travel, +1 or -1
 *   wrap      how far round they travel, in radians
 *   z0, zDir  the index finger's place along the axis, and the way to the
 *             little finger
 *   back      arc covered by the metacarpals, behind the knuckle line
 *   thumbA    thumb angle, as an offset from a0 in `dir` units
 *   wristA    wrist angle, likewise
 *   wristZ    wrist position along the axis, in finger pitches from z0
 */
function wrappedHand(P, o) {
  const g = new THREE.Group();

  const e = { rx: o.rx, ry: o.ry };
  const dir = o.dir;
  const zd = o.zDir;
  const t = o.t;
  const w = o.w;
  const gap = o.gap;
  const pitch = w + gap;

  const bStart = o.a0;
  const bEnd = o.a0 - dir * o.back;
  const bMid = o.a0 - dir * o.back * 0.5;
  const backLen = arcChord(e, bStart, bEnd);

  // --- fingers -------------------------------------------------------------
  // Index first, and everything shortens toward the little finger, which is
  // the proportion the eye actually checks on a hand. The index gets a much
  // shorter wrap when the weapon has a trigger under it: it is reaching, not
  // gripping, and four equal fingers on a grip is the tell that nobody looked.
  for (let i = 0; i < 4; i++) {
    const z = o.z0 + zd * i * pitch;
    const shorten = (i === 0 && o.triggerWrap) ? o.triggerWrap : 1 - i * 0.055;
    const a1 = o.a0 + dir * o.wrap * shorten;

    wrapFinger(g, P, e, z, w * (1 - i * 0.07), t * (1 - i * 0.07), o.a0, a1);

    // The crease beside it. Sunk into the surface so it reads as the gap it
    // is rather than as a painted stripe, and carried over the near two thirds
    // of the wrap, which is all the camera ever sees of it.
    if (i < 3) {
      const zc = z + zd * pitch * 0.5;
      const cEnd = o.a0 + dir * o.wrap * Math.min(shorten, 1 - (i + 1) * 0.055) * 0.88;
      const cStep = (cEnd - o.a0) / 2;
      for (let k = 0; k < 2; k++) {
        const sa = o.a0 + cStep * k;
        const ea = o.a0 + cStep * (k + 1);
        g.add(onArc(P.gloveDark, e, (sa + ea) / 2, zc, t * 0.55,
          arcChord(e, sa, ea) * 1.10, gap * 2.6, -t * 0.20));
      }
    }
  }

  // --- back of the hand ----------------------------------------------------
  // NOT a plate with grooves cut in it. That is what the previous pass built
  // and it measured as one flat card, for a reason that is obvious once you
  // look for it: there is no boolean here, so a groove modelled INSIDE a solid
  // slab is simply covered by the slab. Nothing sunk below a surface can ever
  // be seen. The mask render found exactly zero visible crease pixels on the
  // firing hand.
  //
  // Relief out of opaque boxes has to be built the other way up: a dark backing
  // spanning the whole width, four raised metacarpal bars standing on it - one
  // running back from each knuckle - and a lighter tendon ridge along each bar.
  // The 4mm of dark backing left showing between the bars IS the channel. Four
  // channels and four ridges is the difference between the back of a hand and
  // a piece of card, and it is the surface the first-person camera spends the
  // entire game looking at.
  const zMid = o.z0 + zd * 1.5 * pitch;
  g.add(onArc(P.gloveDark, e, bMid, zMid, t * 0.90, backLen * 1.04,
    pitch * 4.05, t * 0.30));

  for (let i = 0; i < 4; i++) {
    const z = o.z0 + zd * i * pitch;
    g.add(onArc(P.glove, e, bMid, z, t * 0.95, backLen * 1.00, w * 0.94, t * 0.86));
    // The ridge runs the FULL length of its bar and off the end at the knuckle.
    // Stopped short at both ends it reads as a pale rectangle pasted on the
    // back of the hand rather than as a tendon standing under the leather.
    g.add(onArc(P.gloveLit, e, bMid - dir * o.back * 0.10, z,
      t * 0.30, backLen * 1.06, w * 0.34, t * 1.40));
  }

  // --- palm and heel -------------------------------------------------------
  // The palm is what the fingers close ONTO. Without it they wrap air, and the
  // hollow between them was a large part of why the last pass read as loose
  // slabs: there was simply nothing in the middle of the hand.
  const pA = o.a0 + dir * o.wrap * 0.52;
  g.add(onArc(P.glovePalm, e, pA, zMid, t * 0.70,
    arcChord(e, o.a0 + dir * o.wrap * 0.26, o.a0 + dir * o.wrap * 0.80),
    pitch * 3.4, t * 0.04));

  // Heel: the pad under the little finger. It is the widest part of a hand and
  // the part that actually carries the weapon, so it is the one place the
  // silhouette is allowed to bulge.
  const hz = o.z0 + zd * pitch * 3.85;
  g.add(onArc(P.glove, e, bMid, hz, t * 1.30, backLen * 0.88, pitch * 1.35, t * 0.56));
  g.add(onArc(P.gloveDark, e, bMid, hz + zd * pitch * 0.86, t * 0.50,
    backLen * 0.82, pitch * 0.26, t * 0.30));

  // --- thumb ---------------------------------------------------------------
  // Opposite the fingertips and reaching back along the axis, tilted toward the
  // muzzle. A four-finger wrap with no thumb reads as a claw, and on a pistol
  // this is also the only hand mass on the LEFT of the frame, where there is
  // otherwise nothing at all.
  const th = arcFrame(e, o.a0 + dir * o.thumbA, o.z0 - zd * pitch * 0.5, t * 0.5);
  const tilt = new THREE.Group();
  tilt.rotation.x = o.thumbTilt;
  th.add(tilt);
  g.add(th);

  const tr = -zd;                      // the thumb reaches back past the index
  tilt.add(box(P.glove, t * 1.20, w * 1.35, pitch * 1.45, 0, 0, tr * pitch * 0.62));
  tilt.add(box(P.gloveLit, t * 1.30, w * 1.20, w * 1.00, t * 0.08, 0, tr * pitch * 1.34));
  tilt.add(box(P.glove, t * 1.02, w * 1.06, pitch * 1.30, 0, 0, tr * pitch * 2.02));
  tilt.add(box(P.gloveDark, t * 0.55, w * 0.40, pitch * 2.3,
    -t * 0.28, -w * 0.74, tr * pitch * 1.15));                   // web crease

  // --- wrist ---------------------------------------------------------------
  // It NARROWS, and then the arm widens again past it. That pinch is the place
  // a viewer decides a shape is an arm rather than a tube.
  //
  // It is also the part that has to stay SMALL. On the pistol the weapon sits
  // low enough that the bottom half of the hand falls off the frame entirely,
  // so the wrist inherits the middle of the screen; at the size the previous
  // pass gave it, it filled that space with one 47mm cube and the isolation
  // render showed a box with a hand hidden under the bottom edge. Whatever the
  // camera can see of a hand has to be hand.
  const wr = arcFrame(e, o.a0 + dir * o.wristA, o.z0 + zd * pitch * o.wristZ, t * 0.35);
  g.add(wr);
  wr.add(box(P.glove, t * 1.42, pitch * 2.00, pitch * 0.95, 0, 0, 0));
  wr.add(box(P.glove, t * 1.20, pitch * 1.62, pitch * 0.85, 0, 0, zd * pitch * 0.82));

  return g;
}

/**
 * The arm, from just past the wrist to somewhere beyond the elbow and off the
 * bottom of the frame.
 *
 * This is the part that fixes an empty left half of frame. Every reference
 * first-person shot of a two-handed weapon has a forearm crossing the lower
 * left: it is what stops the viewmodel reading as a floating lump in the
 * bottom-right corner and it is what puts the player inside a body instead of
 * behind a camera.
 *
 * Built as a rotated group rather than as a rod with a rake angle, because the
 * direction that matters is a genuine 3D one. Yaw carries it out to the
 * shooter's left, pitch drops it below the frame, and both have to be large.
 *
 * Two things changed here in the third pass, and both were the note "the
 * forearms read as plain cylinders". First, the section is OVAL: a real forearm
 * is about a third wider than it is deep, and a circular section under a single
 * key has one symmetric gradient and therefore no top and no bottom. Second,
 * the bindings are partial slabs lying across the near face rather than torus
 * rings around the whole limb - a clean ring around a tube is a hose clamp, and
 * two of them turned the last version into a length of plumbing.
 */
function foreArm(P, x, y, z, yaw = -0.85, pitch = 0.80, len = 0.40) {
  const a = new THREE.Group();
  a.position.set(x, y, z);
  a.rotation.set(pitch, yaw, 0);

  // Flatten every rod in the arm's own frame. Scale runs before rotation in the
  // local matrix, so mesh X stays the arm's X and mesh Z becomes the arm's Y:
  // wider across, shallower through.
  const oval = (m) => { m.scale.set(1.28, 1, 0.82); return m; };

  // Local +Z runs from the wrist toward the elbow; the group rotation aims it.
  a.add(oval(rod(P.glove, 0.0165, 0.0185, 0.026, 0, 0, 0.011, 'z', 10)));

  // Cuff: the hard value break, and the one element in the hand family that is
  // deliberately LIGHTER than the glove. A hand and a forearm in one value are
  // one tube; the wrist only exists if something changes value there. Three
  // lapped bands, offset off-axis so the laps are uneven, because an even ring
  // is a fitting and an uneven wrap is cloth.
  for (let i = 0; i < 3; i++) {
    const c = oval(rod(P.cuff, 0.0215 - i * 0.0007, 0.0208 - i * 0.0007, 0.016,
      0, 0, 0.028 + i * 0.012, 'z', 10));
    c.position.x = (i - 1) * 0.0020;
    c.position.y = (i % 2 ? 1 : -1) * 0.0016;
    a.add(c);
  }

  // Forearm proper, in two segments with a slight break at the middle, widening
  // toward the elbow the way a real one does. A straight constant cone has no
  // readable length and no readable direction.
  a.add(oval(rod(P.sleeve, 0.0245, 0.0195, len * 0.46, 0, 0, 0.052 + len * 0.23, 'z', 10)));

  const far = new THREE.Group();
  far.position.set(0, 0, 0.052 + len * 0.46);
  far.rotation.x = -0.17;
  far.add(oval(rod(P.sleeve, 0.032, 0.0245, len * 0.60, 0, 0, len * 0.30, 'z', 10)));
  a.add(far);

  // Bindings, spaced so the taper has something to be measured against: a
  // smooth cone has no readable length. One slab on each side of the limb at
  // the same station, both dark. A single bar across the near face is what the
  // previous pass had, and where it crossed the form line down the arm it drew
  // a plus sign on the forearm from every angle.
  for (let i = 0; i < 2; i++) {
    const zz = 0.070 + i * (len * 0.34);
    const rr = 0.023 + i * 0.004;
    a.add(box(P.gloveDark, rr * 2.4, rr * 0.80, 0.011, 0, -rr * 0.55, zz));
    a.add(box(P.gloveDark, rr * 2.2, rr * 0.66, 0.010, 0, rr * 0.60, zz));
  }

  // A low ridge along the near half of the arm. It is here to give the key an
  // edge to run down, so it stops well short of the elbow: run the length of
  // the limb it stops being a form line and becomes a strip of tape.
  a.add(box(P.glove, 0.009, 0.005, len * 0.34, 0, 0.021, 0.062 + len * 0.17));
  return a;
}

/**
 * Firing hand, wrapped around a grip that runs along the weapon's Y.
 *
 * The canonical hand grips a cylinder along its OWN +Z, so one quarter turn
 * about X is the whole difference, and after that turn the canonical angles
 * land where they should: 0 on the right flank of the grip, 90 degrees on the
 * front strap, 180 on the left flank, 270 on the backstrap.
 *
 * A right-handed hold therefore starts the knuckle line just behind the right
 * flank and wraps forward through the front strap to a little past the left,
 * with the thumb riding the left side above the fingertips.
 */
function gripHand(P, x, y, z, rake = 0, support = false) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.x = rake;

  const h = wrappedHand(P, {
    rx: 0.019, ry: 0.026,          // grips are deeper than they are wide
    a0: -0.78, dir: 1, wrap: 3.90,
    triggerWrap: 0.44,
    z0: 0.022, zDir: -1,
    t: 0.0120, w: 0.0163, gap: 0.0038,
    back: 1.45,
    thumbA: 3.50, thumbTilt: 0.88,
    wristA: -0.62, wristZ: -1.15,
  });
  h.rotation.x = -Math.PI / 2;
  g.add(h);

  // The arm. An arm that stops at a tidy box end behind the wrist reads as a
  // severed prop no matter how good the hand in front of it is, so this one
  // runs a long way and leaves the frame.
  //
  // Which way it leaves is the whole question. A part modelled straight back
  // from the wrist at a constant height RISES on screen, because coming toward
  // the eye shrinks the perspective divisor faster than the height changes, so
  // the arm climbs over the weapon and paints across the fingers. It has to be
  // pitched down hard. The firing arm also gets a little yaw to the right,
  // toward the shoulder it actually belongs to; `support` flips that, for the
  // hands that hold a vertical foregrip from the far side.
  if (support) g.add(foreArm(P, -0.014, 0.014, 0.026, -0.86, 0.88, 0.38));
  else g.add(foreArm(P, 0.026, 0.018, 0.026, 0.44, 1.06, 0.30));
  return g;
}

/**
 * Support hand, wrapped around a handguard that already runs along Z, so this
 * one needs no reframing at all.
 *
 * It comes in from the left and underneath: knuckle line on the left flank,
 * fingers running down under the guard, up the far side, tips hooked over the
 * top, thumb laid forward along the near side. That is the direction a support
 * hand actually goes, and it is also the one that keeps the knuckles on the
 * side of the guard the camera can see.
 */
function guardHand(P, x, y, z, roll = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.z = roll;

  g.add(wrappedHand(P, {
    rx: 0.026, ry: 0.024,
    a0: 2.42, dir: 1, wrap: 3.80,
    z0: -0.030, zDir: 1,
    t: 0.0120, w: 0.0163, gap: 0.0038,
    back: 0.98,
    thumbA: -1.05, thumbTilt: -0.34,
    wristA: 1.05, wristZ: 4.5,
  }));

  // Out to the rear left and down, hard, and long enough to leave the frame.
  // It leaves from the heel of the palm on the far side of the guard, which is
  // the only place a left forearm can actually be.
  g.add(foreArm(P, -0.032, -0.016, 0.072, -0.88, 0.86, 0.44));
  return g;
}

/**
 * Support hand for a two-handed pistol hold. There is no handguard to wrap
 * here: the thing being gripped is the other hand, so this is the same hand
 * mirrored, wrapping a slightly fatter ellipse from the opposite side, with
 * its fingers lying across the firing hand's and the heel of its palm filling
 * the frame's left side - which is exactly what a real two-handed hold does.
 */
function pistolSupportHand(P, x, y, z, rake = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.x = rake;

  const h = wrappedHand(P, {
    rx: 0.028, ry: 0.032,          // wrapping a hand, not a grip: fatter
    a0: 3.62, dir: -1, wrap: 2.30,
    z0: 0.014, zDir: -1,
    t: 0.0118, w: 0.0160, gap: 0.0038,
    back: 1.20,
    thumbA: 2.55, thumbTilt: 0.96,
    wristA: -0.50, wristZ: -1.15,
  });
  h.rotation.x = -Math.PI / 2;
  g.add(h);

  // Same long arm as the two-handed long guns, with less yaw: on a pistol both
  // arms are extended toward the same point, so this one runs closer to the
  // bore line than a handguard grip would. It still has to leave the frame on
  // the left rather than stopping in mid air.
  g.add(foreArm(P, -0.032, -0.008, 0.030, -0.66, 0.94, 0.36));
  return g;
}

/**
 * Picatinny-style rail: a spine plus evenly spaced teeth. The teeth are the
 * whole point. A smooth bar on top of a receiver reads as a handle; a toothed
 * one reads as a rail, and it is four lines of code.
 */
function rail(P, len, x, y, z, detail) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(box(P.metal, 0.021, 0.006, len, 0, 0, 0));

  const teeth = Math.max(3, Math.round(len / 0.0165));
  for (let i = 0; i < teeth; i++) {
    const t = box(P.metal, 0.024, 0.005, 0.008, 0, 0.005,
      -len / 2 + 0.008 + i * (len - 0.016) / (teeth - 1));
    g.add(t);
    detail.push(t);
  }
  return g;
}

/**
 * Trigger guard as a three-piece loop plus the blade. Built as separate boxes
 * because there is no cheap way to punch a hole through a solid, and the gap
 * between grip and guard is a big part of what makes a firearm silhouette
 * legible at a glance.
 */
function triggerGroup(P, x, y, z, w = 0.028) {
  const g = new THREE.Group();
  g.position.set(x, y, z);

  g.add(box(P.metal, w, 0.007, 0.056, 0, -0.040, -0.004));   // bottom strap
  g.add(box(P.metal, w, 0.024, 0.007, 0, -0.028, -0.029));   // front post
  g.add(box(P.metal, w, 0.016, 0.008, 0, -0.010, 0.021));    // rear tang
  g.add(box(P.dark, 0.008, 0.024, 0.007, 0, -0.020, -0.006)); // trigger blade
  return g;
}

/**
 * Vented handguard: four thin panels with a gap between them, wrapped by rib
 * bands, with dark slots inset in the sides. Modelling it as one solid tube
 * and calling it a handguard is exactly the "few grey boxes" failure.
 */
function handguard(P, len, r, x, y, z, detail, slots = 5) {
  const g = new THREE.Group();
  g.position.set(x, y, z);

  const t = 0.006;
  g.add(box(P.poly, r * 2, t, len, 0, r, 0));      // top panel
  g.add(box(P.poly, r * 2, t, len, 0, -r, 0));     // bottom panel
  g.add(box(P.poly, t, r * 2, len, r, 0, 0));      // right panel
  g.add(box(P.poly, t, r * 2, len, -r, 0, 0));     // left panel

  // Vent slots cut into the side panels, faked as recessed dark inserts.
  for (let i = 0; i < slots; i++) {
    const zz = -len / 2 + len * (i + 0.7) / (slots + 0.4);
    for (const side of [-1, 1]) {
      const s = box(P.seam, 0.003, r * 0.9, 0.026, side * (r + 0.001), 0, zz);
      g.add(s);
      detail.push(s);
    }
    const sv = box(P.seam, r * 0.8, 0.003, 0.020, 0, -(r + 0.001), zz);
    g.add(sv);
    detail.push(sv);
  }

  // Rib bands, which is what stops the panels reading as loose cardboard.
  for (let i = 0; i < 3; i++) {
    const zz = -len / 2 + 0.012 + i * (len - 0.024) / 2;
    const b = box(P.poly, r * 2.15, r * 2.15, 0.008, 0, 0, zz);
    g.add(b);
    detail.push(b);
  }
  return g;
}

/**
 * Iron sight pair authored so both elements sit at exactly sightY.
 *
 * `parts` selects which half gets built. A weapon carrying an optic still
 * wants its front sight tower - it is half the AR silhouette - but must not
 * carry a rear aperture, because there would then be two competing things on
 * the sight line and neither would be the one the ADS pose is solved for.
 */
function ironSights(P, sightY, railTop, frontZ, rearZ, detail, hooded = true, parts = 'both') {
  const g = new THREE.Group();

  if (parts !== 'front') {
    // Rear: an aperture ring on a riser. The hole is the sight picture.
    const riserH = sightY - railTop;
    g.add(box(P.metal, 0.016, riserH, 0.014, 0, railTop + riserH / 2, rearZ));
    g.add(ring(P.metal, 0.0075, 0.0022, 0, sightY, rearZ - 0.006, 14));
    const rearWingL = box(P.metal, 0.004, 0.016, 0.010, -0.012, sightY, rearZ);
    const rearWingR = box(P.metal, 0.004, 0.016, 0.010, 0.012, sightY, rearZ);
    g.add(rearWingL, rearWingR);
    detail.push(rearWingL, rearWingR);
  }

  if (parts !== 'rear') {
    // Front: a post on a tower, flanked by protective wings. The post tip is
    // the second half of the sight line, so its top lands on sightY too.
    const towerH = sightY - railTop - 0.008;
    g.add(box(P.metal, 0.014, towerH, 0.020, 0, railTop + towerH / 2, frontZ));
    g.add(rod(P.dark, 0.0022, 0.0026, 0.014, 0, sightY - 0.005, frontZ, 'y', 8));
    if (hooded) {
      for (const side of [-1, 1]) {
        const w = box(P.metal, 0.004, 0.020, 0.012, side * 0.010, sightY - 0.006, frontZ);
        g.add(w);
        detail.push(w);
      }
    }
  }
  return g;
}

/**
 * Tube optic: red dot or magnified scope, depending on the radii you hand it.
 *
 * The reason this exists at all is silhouette. Without an optic the top line
 * of every one of these weapons is a single flat horizontal edge from receiver
 * to muzzle, which is the one shape that reads as "grey box" rather than as a
 * weapon. An optic is the only part of a rifle that breaks that line
 * vertically, and it is the first thing the eye uses to tell one gun from
 * another at a glance.
 *
 * Built around an OPEN tube with a double-sided housing so the sight line is
 * genuinely clear: the viewmodel draws into the already-composited colour
 * buffer, so a translucent lens with the world behind it is a scope you can
 * actually see through. That costs one material flag and is the difference
 * between an optic and a black disc parked over the crosshair.
 */
function tubeOptic(P, axisY, mountTop, z, detail, opt = {}) {
  const g = new THREE.Group();

  const rTube = opt.rTube ?? 0.019;
  const rBell = opt.rBell ?? rTube;
  const len = opt.len ?? 0.100;
  const front = z - len / 2;
  const back = z + len / 2;

  // --- mount: base plate, clamp nut, and a riser tall enough to lift the
  // tube's centre to the sight line ----------------------------------------
  const riserTop = axisY - rTube;
  const riserH = Math.max(0.004, riserTop - mountTop);
  g.add(box(P.metal, 0.030, 0.006, len * 0.62, 0, mountTop + 0.003, z));
  for (const zz of [z - len * 0.22, z + len * 0.22]) {
    g.add(box(P.metal, 0.024, riserH, 0.020, 0, mountTop + riserH / 2, zz));
    const nut = box(P.dark, 0.038, 0.011, 0.016, 0, mountTop + 0.004, zz);
    g.add(nut);
    detail.push(nut);
    // Ring cap over the tube, the part that says "this was bolted on".
    const cap = box(P.dark, 0.040, 0.010, 0.018, 0, axisY + rTube * 0.72, zz);
    g.add(cap);
    detail.push(cap);
  }

  // --- body ----------------------------------------------------------------
  // Rims are P.metal, not P.edge. P.edge is a polished near-mirror and under
  // the world HDRI it reflected the sun disc straight back down the sight
  // line: five concentric mirror rings turned the whole optic into one blown
  // white blob sitting over the crosshair.
  g.add(tube(P.housing, rTube, len, 0, axisY, z));
  if (rBell > rTube) {
    g.add(tube(P.housing, rBell, len * 0.30, 0, axisY, front + len * 0.15));
    g.add(ring(P.metal, rBell, 0.0026, 0, axisY, front, 18));
  } else {
    g.add(ring(P.metal, rTube, 0.0026, 0, axisY, front, 18));
  }
  g.add(ring(P.metal, rTube, 0.0026, 0, axisY, back, 18));

  // Sunshade: two rings on the objective, not a solid hood. Rings read as a
  // shade from every angle and never close the aperture.
  g.add(ring(P.metal, rBell + 0.002, 0.0022, 0, axisY, front - 0.012, 16));
  g.add(ring(P.metal, rBell + 0.002, 0.0022, 0, axisY, front - 0.026, 16));

  // --- glass and reticle ---------------------------------------------------
  const glass = new THREE.Mesh(cylGeo(rBell - 0.002, rBell - 0.002, 0.0015, 18), P.lens);
  glass.rotation.x = Math.PI / 2;
  glass.position.set(0, axisY, front + 0.002);
  g.add(glass);

  const dot = new THREE.Mesh(boxGeo(0.0030, 0.0030, 0.0015), P.dot);
  dot.position.set(0, axisY, z - len * 0.18);
  g.add(dot);

  if (opt.crosshair) {
    // A magnified optic gets a real reticle. Thin enough to read as etched
    // glass rather than as two sticks glued inside the tube.
    const rz = z - len * 0.18;
    g.add(box(P.seam, rTube * 1.7, 0.0016, 0.0010, 0, axisY, rz));
    g.add(box(P.seam, 0.0016, rTube * 1.7, 0.0010, 0, axisY, rz));
  }

  // --- turrets -------------------------------------------------------------
  const tz = z + len * 0.06;
  g.add(rod(P.metal, 0.010, 0.011, 0.017, 0, axisY + rTube + 0.007, tz, 'y', 10));
  const tCap = rod(P.dark, 0.009, 0.009, 0.005, 0, axisY + rTube + 0.017, tz, 'y', 10);
  g.add(tCap);
  detail.push(tCap);
  g.add(rod(P.metal, 0.010, 0.011, 0.017, rTube + 0.007, axisY, tz, 'x', 10));

  return g;
}

/** Curved box magazine: stacked segments, each rotated a little further. */
function curvedMag(P, x, y, z, segs = 4, w = 0.028, d = 0.052, curve = 0.10) {
  const g = new THREE.Group();
  g.position.set(x, y, z);

  const segH = 0.036;
  for (let i = 0; i < segs; i++) {
    const a = curve * i;
    const s = box(P.poly, w, segH * 1.04, d - i * 0.001,
      Math.sin(a) * 0.0, -segH * (i + 0.5) * Math.cos(a),
      -Math.sin(a) * segH * (i + 0.6) * 0.9);
    s.rotation.x = -a;
    g.add(s);
  }
  // Floorplate, and a witness stripe up the spine.
  g.add(box(P.dark, w + 0.004, 0.008, d * 0.7,
    0, -segH * segs * 0.97, -Math.sin(curve * segs) * segH * segs * 0.55));
  return g;
}

// ---------------------------------------------------------------------------
// weapon builders
//
// Convention for all of them: bore along -Z at y = 0, origin at the web of the
// firing hand (roughly the rear of the receiver), +X to the shooter's right.
// Each returns the parts the animation layer needs to move.
// ---------------------------------------------------------------------------

function buildPistol(P) {
  const g = new THREE.Group();
  const detail = [];
  const D = (m) => { g.add(m); detail.push(m); return m; };

  // The starting weapon, so it is the first thing anyone ever sees, and the
  // hardest of the seven to sell: a pistol has no rail, no handguard, no stock
  // and no optic to carry the read, which is why the first pass of it came out
  // as a black brick. Everything that makes it legible is in the proportions
  // and in six or seven small parts.
  //
  // Laid out life-size in metres from the web of the hand: slide rear at
  // z = +0.005, trigger at -0.058, guard front at -0.084, muzzle at -0.196.
  // Slide is 186mm on a 100mm grip raked 19 degrees off vertical, which is the
  // ratio the eye actually checks when it decides whether a shape is a pistol.

  const SIGHT_Y = 0.038;
  const SLIDE_TOP = 0.029;

  // --- slide ---------------------------------------------------------------
  // Built as its own group and returned as `bolt`, so the reload racks it. The
  // sights and the barrel ride with it, because they are bolted to it.
  const slide = new THREE.Group();
  const S = (m) => { slide.add(m); detail.push(m); return m; };

  slide.add(box(P.metal, 0.028, 0.030, 0.186, 0, 0.014, -0.088));
  S(box(P.edge, 0.0292, 0.0025, 0.186, 0, SLIDE_TOP, -0.088));     // polished top flat

  // Chamfers down both top corners. A slide with square corners is a bar of
  // soap; the chamfer is where the light actually breaks.
  for (const side of [-1, 1]) {
    const ch = box(P.edge, 0.009, 0.003, 0.186, side * 0.0125, 0.0265, -0.088);
    ch.rotation.z = side * 0.62;
    slide.add(ch); detail.push(ch);
  }

  // Ejection port, right side: a recess with a bright lip above it and the
  // extractor behind it. The port is the single feature that tells the eye
  // which way a slide is facing.
  S(box(P.seam, 0.004, 0.017, 0.054, 0.0135, 0.013, -0.058));
  S(box(P.edge, 0.0036, 0.0022, 0.054, 0.0140, 0.0228, -0.058));
  S(box(P.dark, 0.005, 0.011, 0.020, 0.0130, 0.010, -0.028));      // extractor

  // Cocking serrations, on the SIDES of the slide and raked forward. Run as
  // bands across the top instead and they read as a radiator; on the flanks
  // they read as the thing a hand grabs to charge the weapon.
  for (let i = 0; i < 7; i++) {
    for (const side of [-1, 1]) {
      const r = box(P.dark, 0.004, 0.025, 0.0045, side * 0.0145, 0.013, -0.014 - i * 0.0098);
      r.rotation.x = 0.22;
      slide.add(r); detail.push(r);
    }
  }
  for (let i = 0; i < 4; i++) {                                    // front serrations
    for (const side of [-1, 1]) {
      const r = box(P.dark, 0.004, 0.021, 0.004, side * 0.0145, 0.013, -0.146 - i * 0.0098);
      r.rotation.x = 0.22;
      slide.add(r); detail.push(r);
    }
  }

  // Muzzle end: slide face, barrel standing proud of it, crown, and the
  // recoil-spring plug underneath. A pistol that just stops at a flat front
  // face has no bore, and a weapon with no visible bore is a prop.
  slide.add(box(P.dark, 0.027, 0.029, 0.007, 0, 0.014, -0.180));
  slide.add(rod(P.dark, 0.0085, 0.0085, 0.026, 0, 0.008, -0.184, 'z', 14));
  S(ring(P.edge, 0.0088, 0.0018, 0, 0.008, -0.194, 16));           // crown
  slide.add(rod(P.metal, 0.005, 0.005, 0.014, 0, -0.006, -0.184, 'z', 10));

  // Rear face and the striker plate, which is what closes the slide off behind
  // the serrations instead of leaving an open box end.
  slide.add(box(P.dark, 0.026, 0.028, 0.004, 0, 0.014, 0.003));
  S(box(P.edge, 0.006, 0.006, 0.003, 0, 0.014, 0.005));            // striker cover

  // --- sights: square notch rear, blade front, both topping out at SIGHT_Y --
  // Three dots, because the front dot alone gives the eye nothing to centre
  // itself between.
  slide.add(box(P.dark, 0.026, 0.006, 0.014, 0, 0.031, -0.012));
  for (const side of [-1, 1]) {
    slide.add(box(P.dark, 0.0085, 0.011, 0.012, side * 0.0088, SIGHT_Y - 0.005, -0.012));
    S(box(P.edge, 0.0026, 0.0026, 0.0024, side * 0.0088, SIGHT_Y - 0.005, -0.0055));
  }
  slide.add(box(P.dark, 0.007, 0.005, 0.013, 0, 0.031, -0.164));
  slide.add(box(P.dark, 0.005, 0.011, 0.007, 0, SIGHT_Y - 0.005, -0.164));
  S(box(P.edge, 0.0028, 0.0028, 0.0024, 0, SIGHT_Y - 0.005, -0.1608));

  g.add(slide);

  // --- frame ---------------------------------------------------------------
  // Dust cover forward of the trigger, receiver block around it, beavertail
  // sweeping back over the web of the hand.
  g.add(box(P.poly, 0.026, 0.023, 0.104, 0, -0.013, -0.126));      // dust cover
  g.add(box(P.poly, 0.028, 0.031, 0.088, 0, -0.011, -0.036));      // receiver block
  D(box(P.seam, 0.0296, 0.0028, 0.176, 0, -0.0018, -0.090));       // slide/frame seam

  // Accessory rail under the dust cover.
  for (let i = 0; i < 3; i++) {
    D(box(P.poly, 0.020, 0.006, 0.007, 0, -0.026, -0.104 - i * 0.014));
  }

  // The controls. Small, but they are the difference between a moulded shape
  // and a machine somebody operates.
  D(box(P.dark, 0.005, 0.010, 0.026, -0.0148, -0.006, -0.064));    // takedown lever
  D(box(P.dark, 0.005, 0.009, 0.032, -0.0150, 0.001, -0.030));     // slide stop
  D(box(P.dark, 0.007, 0.011, 0.011, 0.0150, -0.008, -0.028));     // magazine release

  // Beavertail, kept under the slide line on purpose. The slide is the `bolt`
  // group and travels back over this on the reload the way a real one does, so
  // anything left standing in its path intersects it mid-animation.
  const tang = box(P.poly, 0.026, 0.011, 0.036, 0, -0.006, 0.017);
  tang.rotation.x = 0.24;
  g.add(tang);
  D(box(P.metal, 0.009, 0.016, 0.012, 0, 0.006, 0.020));           // bobbed hammer

  // --- grip ----------------------------------------------------------------
  const grip = new THREE.Group();
  grip.position.set(0, -0.024, -0.004);
  grip.rotation.x = -0.33;                    // 19 degrees: the handgun rake
  grip.add(box(P.poly, 0.030, 0.100, 0.048, 0, -0.050, 0));
  grip.add(box(P.poly, 0.036, 0.010, 0.054, 0, -0.100, 0.002));    // magwell flare

  for (let i = 0; i < 4; i++) {                                    // finger grooves
    const r = box(P.dark, 0.031, 0.008, 0.007, 0, -0.026 - i * 0.021, -0.0235);
    grip.add(r); detail.push(r);
  }
  // Checkering: a recessed dark panel per side with raised ribs standing in
  // it. Two materials at different depths is the cheapest thing that reads as
  // texture rather than as a decal.
  for (const side of [-1, 1]) {
    const panel = box(P.dark, 0.003, 0.064, 0.038, side * 0.0148, -0.052, 0.001);
    grip.add(panel); detail.push(panel);
    for (let i = 0; i < 5; i++) {
      const rib = box(P.poly, 0.004, 0.006, 0.036, side * 0.0156, -0.030 - i * 0.014, 0.001);
      grip.add(rib); detail.push(rib);
    }
  }
  for (let i = 0; i < 4; i++) {                                    // backstrap stipple
    const r = box(P.dark, 0.028, 0.006, 0.005, 0, -0.032 - i * 0.020, 0.0235);
    grip.add(r); detail.push(r);
  }
  g.add(grip);

  // Magazine is a child of nothing: the animation layer moves it on its own.
  const mag = new THREE.Group();
  mag.position.set(0, -0.024, -0.004);
  mag.rotation.x = -0.33;
  mag.add(box(P.dark, 0.023, 0.098, 0.040, 0, -0.052, 0));
  mag.add(box(P.metal, 0.033, 0.010, 0.050, 0, -0.110, 0.001));    // baseplate
  mag.add(box(P.poly, 0.035, 0.007, 0.052, 0, -0.118, 0.002));     // pinky rest
  g.add(mag);

  g.add(triggerGroup(P, 0, -0.004, -0.052, 0.024));

  // --- hands: a two-handed hold, support fingers laid over the firing hand --
  g.add(gripHand(P, 0.000, -0.062, 0.008, -0.33));
  g.add(pistolSupportHand(P, -0.013, -0.056, 0.002, -0.33));

  return {
    root: g, detail, mag,
    bolt: slide, boltLift: 0, boltTravel: 0.022,
    // Rear notch: the blades at z = -0.012, topping out at SIGHT_Y. The front
    // blade is at z = -0.164 on the same line, so solving the pose for this
    // point puts the post in the notch and the notch on the crosshair.
    sight: new THREE.Vector3(0, SIGHT_Y, -0.012),
    muzzle: new THREE.Vector3(0, 0.008, -0.200),
    eject: new THREE.Vector3(0.020, 0.014, -0.055),
  };
}

function buildSmg(P) {
  const g = new THREE.Group();
  const detail = [];
  const D = (m) => { g.add(m); detail.push(m); return m; };

  // --- tubular receiver ---------------------------------------------------
  g.add(rod(P.metal, 0.024, 0.024, 0.230, 0, 0.004, -0.120, 'z', 18));
  D(rod(P.edge, 0.0245, 0.0245, 0.010, 0, 0.004, -0.014, 'z', 18));   // rear band
  D(box(P.seam, 0.004, 0.016, 0.048, 0.023, 0.010, -0.080));          // ejection port

  // Cocking tube along the left, with the handle that the reload pulls.
  g.add(rod(P.metal, 0.010, 0.010, 0.180, -0.026, 0.020, -0.150, 'z', 12));
  const bolt = new THREE.Group();
  bolt.position.set(-0.030, 0.020, -0.100);
  bolt.add(box(P.dark, 0.018, 0.014, 0.030, 0, 0, 0));
  bolt.add(rod(P.metal, 0.006, 0.006, 0.020, -0.012, 0, 0, 'x', 8));
  g.add(bolt);

  // --- lower: grip, trigger group, magazine well --------------------------
  g.add(box(P.poly, 0.030, 0.038, 0.120, 0, -0.026, -0.060));
  const grip = new THREE.Group();
  grip.position.set(0, -0.040, -0.012);
  grip.rotation.x = -0.20;
  grip.add(box(P.poly, 0.028, 0.090, 0.042, 0, -0.045, 0));
  for (let i = 0; i < 4; i++) {
    const r = box(P.dark, 0.029, 0.006, 0.006, 0, -0.020 - i * 0.020, -0.020);
    grip.add(r); detail.push(r);
  }
  g.add(grip);
  g.add(triggerGroup(P, 0, -0.026, -0.058, 0.026));

  const mag = curvedMag(P, 0, -0.042, -0.120, 4, 0.026, 0.048, 0.06);
  g.add(mag);
  D(box(P.poly, 0.034, 0.030, 0.060, 0, -0.038, -0.120));   // mag well collar

  // --- handguard and muzzle ----------------------------------------------
  g.add(handguard(P, 0.110, 0.023, 0, 0.004, -0.290, detail, 4));
  g.add(rod(P.dark, 0.008, 0.008, 0.070, 0, 0.004, -0.360, 'z', 12));
  g.add(rod(P.metal, 0.014, 0.016, 0.026, 0, 0.004, -0.400, 'z', 14));  // comp
  for (let i = 0; i < 3; i++) {
    D(box(P.seam, 0.030, 0.003, 0.006, 0, 0.016, -0.394 + i * 0.008));
  }

  // Vertical foregrip: the detail that makes an SMG read as an SMG.
  const fg = new THREE.Group();
  fg.position.set(0, -0.022, -0.300);
  fg.rotation.x = 0.10;
  fg.add(box(P.poly, 0.024, 0.062, 0.028, 0, -0.031, 0));
  for (let i = 0; i < 3; i++) {
    const r = box(P.dark, 0.025, 0.005, 0.029, 0, -0.016 - i * 0.018, 0);
    fg.add(r); detail.push(r);
  }
  g.add(fg);

  // --- collapsing wire stock ---------------------------------------------
  for (const side of [-1, 1]) {
    g.add(rod(P.metal, 0.005, 0.005, 0.130, side * 0.020, -0.004, 0.062, 'z', 8));
  }
  g.add(box(P.dark, 0.052, 0.044, 0.012, 0, -0.004, 0.124));           // butt plate
  D(box(P.poly, 0.046, 0.020, 0.048, 0, 0.006, 0.086));                // cheek pad

  // --- sights: drum rear, hooded post front -------------------------------
  const SIGHT_Y = 0.052;
  g.add(rod(P.metal, 0.015, 0.015, 0.014, 0, 0.040, -0.022, 'z', 12));  // drum body
  g.add(ring(P.dark, 0.0055, 0.0020, 0, SIGHT_Y, -0.028, 12));
  g.add(box(P.metal, 0.012, 0.022, 0.014, 0, 0.038, -0.360));           // front base
  g.add(ring(P.metal, 0.011, 0.0028, 0, SIGHT_Y, -0.362, 12));          // hood
  g.add(rod(P.dark, 0.0022, 0.0022, 0.012, 0, SIGHT_Y - 0.005, -0.362, 'y', 8));

  g.add(gripHand(P, 0.000, -0.082, -0.006, -0.20));
  // Support hand on the foregrip. Its arm crosses to the left, not back to the
  // firing shoulder, which is the difference between a two-handed hold and two
  // right hands.
  g.add(gripHand(P, -0.010, -0.056, -0.296, 0.10, true));

  return {
    root: g, detail, mag,
    bolt, boltLift: 0, boltTravel: 0.045,
    sight: new THREE.Vector3(0, SIGHT_Y, -0.028),   // rear drum aperture
    muzzle: new THREE.Vector3(0, 0.004, -0.414),
    eject: new THREE.Vector3(0.026, 0.010, -0.080),
  };
}

function buildShotgun(P) {
  const g = new THREE.Group();
  const detail = [];
  const D = (m) => { g.add(m); detail.push(m); return m; };

  // --- receiver -----------------------------------------------------------
  g.add(box(P.metal, 0.044, 0.052, 0.200, 0, 0.002, -0.110));
  D(box(P.edge, 0.045, 0.0025, 0.200, 0, 0.028, -0.110));
  D(box(P.seam, 0.004, 0.020, 0.070, 0.022, 0.000, -0.090));      // ejection port
  D(box(P.seam, 0.026, 0.004, 0.062, 0, -0.025, -0.090));         // loading gate

  // --- barrel over magazine tube -----------------------------------------
  g.add(rod(P.dark, 0.017, 0.018, 0.420, 0, 0.008, -0.420, 'z', 16));
  g.add(rod(P.metal, 0.012, 0.012, 0.360, 0, -0.020, -0.390, 'z', 14));
  g.add(box(P.metal, 0.014, 0.030, 0.016, 0, -0.006, -0.560));    // barrel/tube band
  D(ring(P.edge, 0.018, 0.0022, 0, 0.008, -0.626, 16));           // muzzle crown
  g.add(rod(P.metal, 0.011, 0.011, 0.026, 0, -0.020, -0.560, 'z', 10)); // tube cap

  // --- pump forend, which the reload cycles -------------------------------
  const bolt = new THREE.Group();
  bolt.position.set(0, -0.008, -0.320);
  bolt.add(box(P.poly, 0.046, 0.048, 0.130, 0, 0, 0));
  for (let i = 0; i < 7; i++) {                    // grooves, the pump signature
    const r = box(P.dark, 0.048, 0.006, 0.008, 0, -0.018, -0.052 + i * 0.017);
    bolt.add(r); detail.push(r);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const r = box(P.dark, 0.006, 0.030, 0.008, side * 0.023, 0, -0.052 + i * 0.017);
      bolt.add(r); detail.push(r);
    }
  }
  g.add(bolt);

  // --- stock: comb, wrist, butt pad ---------------------------------------
  g.add(box(P.poly, 0.038, 0.056, 0.090, 0, -0.020, 0.048));
  const comb = box(P.poly, 0.040, 0.050, 0.140, 0, 0.006, 0.130);
  comb.rotation.x = 0.07;
  g.add(comb);
  D(box(P.dark, 0.042, 0.012, 0.100, 0, 0.030, 0.140));           // cheek rest
  const pad = box(P.seam, 0.046, 0.086, 0.016, 0, -0.006, 0.202);
  pad.rotation.x = 0.10;
  g.add(pad);

  const grip = new THREE.Group();
  grip.position.set(0, -0.026, 0.012);
  grip.rotation.x = -0.30;
  grip.add(box(P.poly, 0.030, 0.080, 0.046, 0, -0.040, 0));
  for (let i = 0; i < 4; i++) {
    const r = box(P.dark, 0.031, 0.006, 0.006, 0, -0.016 - i * 0.018, -0.022);
    grip.add(r); detail.push(r);
  }
  g.add(grip);
  g.add(triggerGroup(P, 0, -0.026, -0.052, 0.030));

  // --- sights: bead on a ramp, shallow rear notch on a riser ---------------
  //
  // The sight line sits 12mm higher than the first pass, on purpose. At the
  // old height the eye was only 12mm above the top of a 44mm-wide receiver, so
  // the aimed frame was half filled by one flat grey plane and the bead had
  // nothing behind it. Lifting the line puts the receiver top well down the
  // frame and gives the bead sky and world to read against, which is the whole
  // reason a shotgun has a raised rib in the first place.
  const SIGHT_Y = 0.052;
  g.add(box(P.metal, 0.010, 0.030, 0.020, 0, 0.035, -0.600));       // front ramp
  const bead = new THREE.Mesh(cylGeo(0.0035, 0.0035, 0.005, 8), P.edge);
  bead.position.set(0, SIGHT_Y - 0.002, -0.600);
  g.add(bead);
  g.add(box(P.metal, 0.020, 0.028, 0.014, 0, 0.034, -0.030));       // rear riser
  for (const side of [-1, 1]) {
    D(box(P.dark, 0.006, 0.010, 0.010, side * 0.007, SIGHT_Y - 0.006, -0.030));
  }

  // A loose shell held at the loading gate. The reload pulses it in and out.
  const mag = new THREE.Group();
  mag.position.set(0.006, -0.048, -0.070);
  mag.add(rod(P.seam, 0.010, 0.010, 0.048, 0, 0, 0, 'z', 10));
  mag.add(rod(P.brass, 0.0105, 0.0105, 0.016, 0, 0, 0.020, 'z', 10));
  g.add(mag);

  g.add(gripHand(P, 0.000, -0.070, 0.000, -0.30));
  g.add(guardHand(P, 0.000, -0.002, -0.320));        // support hand rides the pump

  return {
    root: g, detail, mag,
    bolt, boltLift: 0, boltTravel: 0.085,
    sight: new THREE.Vector3(0, SIGHT_Y, -0.030),   // rear notch on the riser
    muzzle: new THREE.Vector3(0, 0.008, -0.636),
    eject: new THREE.Vector3(0.026, 0.004, -0.090),
  };
}

function buildCarbine(P) {
  const g = new THREE.Group();
  const detail = [];
  const D = (m) => { g.add(m); detail.push(m); return m; };

  // --- upper receiver ------------------------------------------------------
  g.add(box(P.metal, 0.042, 0.048, 0.230, 0, 0.014, -0.130));
  D(box(P.edge, 0.043, 0.0022, 0.230, 0, 0.0385, -0.130));         // worn top edge
  D(box(P.seam, 0.0035, 0.018, 0.056, 0.021, 0.014, -0.105));      // ejection port
  D(box(P.metal, 0.008, 0.014, 0.030, 0.024, 0.010, -0.080));      // brass deflector
  D(rod(P.metal, 0.007, 0.007, 0.016, 0.024, 0.004, -0.050, 'x', 8)); // forward assist

  // Charging handle, rear of the upper. The reload pulls this.
  const bolt = new THREE.Group();
  bolt.position.set(0, 0.032, -0.020);
  bolt.add(box(P.metal, 0.046, 0.010, 0.026, 0, 0, 0));
  bolt.add(box(P.dark, 0.016, 0.012, 0.014, -0.020, -0.002, 0.008));  // latch
  g.add(bolt);

  // --- lower receiver ------------------------------------------------------
  g.add(box(P.poly, 0.038, 0.042, 0.140, 0, -0.022, -0.090));
  D(rod(P.metal, 0.005, 0.005, 0.044, 0, -0.014, -0.038, 'x', 8));  // takedown pin
  D(rod(P.metal, 0.005, 0.005, 0.044, 0, -0.014, -0.148, 'x', 8));
  g.add(box(P.poly, 0.042, 0.052, 0.070, 0, -0.030, -0.150));       // magazine well
  D(box(P.dark, 0.010, 0.014, 0.010, -0.022, -0.020, -0.150));      // mag release

  const mag = curvedMag(P, 0, -0.052, -0.150, 5, 0.028, 0.056, 0.075);
  g.add(mag);

  const grip = new THREE.Group();
  grip.position.set(0, -0.038, -0.020);
  grip.rotation.x = -0.28;
  grip.add(box(P.poly, 0.030, 0.096, 0.046, 0, -0.048, 0));
  grip.add(box(P.poly, 0.032, 0.020, 0.030, 0, -0.006, 0.010));      // beavertail
  for (let i = 0; i < 4; i++) {
    const r = box(P.dark, 0.031, 0.006, 0.007, 0, -0.020 - i * 0.020, -0.022);
    grip.add(r); detail.push(r);
  }
  g.add(grip);
  g.add(triggerGroup(P, 0, -0.022, -0.062, 0.030));

  // --- rail, handguard, barrel --------------------------------------------
  g.add(rail(P, 0.250, 0, 0.041, -0.170, detail));
  g.add(handguard(P, 0.180, 0.026, 0, 0.014, -0.330, detail, 5));

  g.add(rod(P.dark, 0.009, 0.010, 0.150, 0, 0.014, -0.470, 'z', 14)); // barrel
  g.add(box(P.metal, 0.022, 0.032, 0.034, 0, 0.024, -0.432));         // gas block
  g.add(rod(P.metal, 0.004, 0.004, 0.170, 0, 0.036, -0.350, 'z', 8)); // gas tube
  g.add(rod(P.dark, 0.014, 0.014, 0.052, 0, 0.014, -0.556, 'z', 14)); // flash hider
  for (let i = 0; i < 4; i++) {                                       // hider slots
    D(box(P.seam, 0.030, 0.003, 0.020, 0, 0.026, -0.546 + i * 0.010));
  }
  D(ring(P.edge, 0.0145, 0.0020, 0, 0.014, -0.580, 14));

  // --- sights: front tower plus a red dot on the rail -----------------------
  //
  // The optic is the sight line, not the irons. The front tower stays because
  // it is half of what makes this shape read as a carbine, and it lands in the
  // bottom of the optic window the way a real lower-third co-witness does.
  // The rear aperture is gone: two elements on the sight line means neither is
  // the one the ADS pose was solved for.
  const IRON_Y = 0.064;
  const SIGHT_Y = 0.081;
  g.add(ironSights(P, IRON_Y, 0.044, -0.432, -0.048, detail, true, 'front'));
  g.add(tubeOptic(P, SIGHT_Y, 0.044, -0.062, detail, {
    rTube: 0.019, rBell: 0.022, len: 0.092,
  }));

  // --- stock ---------------------------------------------------------------
  g.add(rod(P.metal, 0.015, 0.015, 0.150, 0, 0.000, 0.070, 'z', 14));  // buffer tube
  g.add(box(P.poly, 0.036, 0.058, 0.110, 0, -0.006, 0.108));
  D(box(P.poly, 0.040, 0.016, 0.070, 0, 0.026, 0.100));                // cheek weld
  const pad = box(P.seam, 0.040, 0.076, 0.014, 0, -0.008, 0.166);
  pad.rotation.x = 0.08;
  g.add(pad);
  D(box(P.metal, 0.026, 0.010, 0.010, 0, -0.030, 0.150));              // sling loop

  g.add(gripHand(P, 0.000, -0.072, -0.014, -0.28));
  g.add(guardHand(P, 0.000, 0.018, -0.330));

  return {
    root: g, detail, mag,
    bolt, boltLift: 0, boltTravel: 0.052,
    sight: new THREE.Vector3(0, SIGHT_Y, -0.062),   // optic axis, tube centre
    muzzle: new THREE.Vector3(0, 0.014, -0.586),
    eject: new THREE.Vector3(0.026, 0.014, -0.105),
  };
}

function buildLmg(P) {
  const g = new THREE.Group();
  const detail = [];
  const D = (m) => { g.add(m); detail.push(m); return m; };

  // --- receiver, deeper and squarer than the carbine's ---------------------
  g.add(box(P.metal, 0.056, 0.070, 0.300, 0, 0.010, -0.170));
  D(box(P.edge, 0.057, 0.0025, 0.300, 0, 0.046, -0.170));
  // Top cover with hinge knuckles, the belt-fed signature.
  g.add(box(P.metal, 0.050, 0.014, 0.240, 0, 0.050, -0.180));
  for (let i = 0; i < 5; i++) {
    D(rod(P.dark, 0.006, 0.006, 0.052, 0, 0.050, -0.080 - i * 0.048, 'x', 8));
  }
  D(box(P.seam, 0.004, 0.026, 0.090, 0.028, 0.000, -0.150));       // ejection port

  // Carry handle: a three-piece arch, folded to the side.
  g.add(box(P.dark, 0.014, 0.010, 0.090, -0.016, 0.076, -0.230));
  g.add(box(P.dark, 0.014, 0.032, 0.012, -0.016, 0.062, -0.190));
  g.add(box(P.dark, 0.014, 0.032, 0.012, -0.016, 0.062, -0.270));

  const bolt = new THREE.Group();                                  // charging handle
  bolt.position.set(0.032, 0.006, -0.100);
  bolt.add(box(P.dark, 0.020, 0.016, 0.034, 0, 0, 0));
  bolt.add(rod(P.metal, 0.005, 0.005, 0.026, 0.014, 0, 0, 'x', 8));
  g.add(bolt);

  // --- heavy barrel with cooling rings -------------------------------------
  g.add(rod(P.dark, 0.012, 0.014, 0.320, 0, 0.010, -0.480, 'z', 16));
  for (let i = 0; i < 6; i++) {
    D(ring(P.metal, 0.018, 0.0035, 0, 0.010, -0.380 - i * 0.038, 14));
  }
  g.add(box(P.metal, 0.026, 0.038, 0.050, 0, 0.030, -0.380));      // gas block
  g.add(rod(P.metal, 0.018, 0.020, 0.046, 0, 0.010, -0.652, 'z', 14)); // flash hider
  for (let i = 0; i < 3; i++) {
    D(box(P.seam, 0.042, 0.004, 0.018, 0, 0.026, -0.640 - i * 0.012));
  }

  // Barrel-change handle, which is the other thing that says belt-fed.
  D(box(P.poly, 0.012, 0.044, 0.016, -0.026, 0.034, -0.330));

  // --- ammunition box and the belt hanging out of it -----------------------
  // Hung directly off the receiver's underside. The box is the heaviest single
  // shape on the weapon and a gap under the receiver reads instantly as broken.
  const mag = new THREE.Group();
  mag.position.set(0, -0.022, -0.185);
  mag.add(box(P.poly, 0.086, 0.098, 0.140, 0, -0.052, 0));
  mag.add(box(P.dark, 0.090, 0.010, 0.146, 0, -0.006, 0));         // lid lip
  mag.add(box(P.dark, 0.030, 0.012, 0.012, 0, 0.002, -0.076));     // latch
  for (let i = 0; i < 4; i++) {                                    // exposed belt
    const link = box(P.brass, 0.020, 0.008, 0.014, 0, 0.012 + i * 0.010, -0.062 + i * 0.008);
    link.rotation.x = -0.25;
    mag.add(link);
  }
  g.add(mag);

  // --- bipod, legs folded down --------------------------------------------
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.014, -0.010, -0.500);
    leg.rotation.z = side * 0.42;
    leg.rotation.x = 0.16;
    leg.add(rod(P.metal, 0.005, 0.006, 0.120, 0, -0.060, 0, 'y', 8));
    leg.add(box(P.dark, 0.016, 0.008, 0.026, 0, -0.120, -0.004));   // foot
    g.add(leg);
  }
  g.add(box(P.metal, 0.040, 0.016, 0.030, 0, -0.014, -0.500));      // bipod collar

  // --- grip, trigger, stock ------------------------------------------------
  const grip = new THREE.Group();
  grip.position.set(0, -0.032, -0.030);
  grip.rotation.x = -0.26;
  grip.add(box(P.poly, 0.032, 0.100, 0.050, 0, -0.050, 0));
  for (let i = 0; i < 4; i++) {
    const r = box(P.dark, 0.033, 0.006, 0.007, 0, -0.022 - i * 0.021, -0.024);
    grip.add(r); detail.push(r);
  }
  g.add(grip);
  g.add(triggerGroup(P, 0, -0.020, -0.076, 0.034));

  g.add(box(P.poly, 0.044, 0.070, 0.150, 0, 0.000, 0.086));
  D(box(P.poly, 0.048, 0.016, 0.090, 0, 0.040, 0.080));            // cheek rest
  const pad = box(P.seam, 0.048, 0.090, 0.016, 0, -0.004, 0.166);
  pad.rotation.x = 0.09;
  g.add(pad);
  D(box(P.metal, 0.030, 0.012, 0.010, 0, -0.036, 0.140));          // sling loop

  // --- sights: ladder rear, winged post front ------------------------------
  const SIGHT_Y = 0.092;
  g.add(box(P.metal, 0.020, 0.032, 0.012, 0, 0.073, -0.062));
  g.add(ring(P.metal, 0.0080, 0.0024, 0, SIGHT_Y, -0.066, 14));
  for (let i = 0; i < 4; i++) {                                    // ladder rungs
    D(box(P.dark, 0.024, 0.003, 0.008, 0, 0.062 + i * 0.008, -0.062));
  }
  g.add(box(P.metal, 0.016, 0.044, 0.020, 0, 0.058, -0.380));
  g.add(rod(P.dark, 0.0024, 0.0028, 0.016, 0, SIGHT_Y - 0.006, -0.380, 'y', 8));
  for (const side of [-1, 1]) {
    D(box(P.metal, 0.005, 0.024, 0.012, side * 0.012, SIGHT_Y - 0.008, -0.380));
  }

  g.add(gripHand(P, 0.000, -0.074, -0.024, -0.26));
  g.add(guardHand(P, 0.000, 0.026, -0.330));

  return {
    root: g, detail, mag,
    bolt, boltLift: 0, boltTravel: 0.060,
    sight: new THREE.Vector3(0, SIGHT_Y, -0.066),   // rear ladder aperture
    muzzle: new THREE.Vector3(0, 0.010, -0.682),
    eject: new THREE.Vector3(0.032, 0.000, -0.150),
  };
}

function buildBolt(P) {
  const g = new THREE.Group();
  const detail = [];
  const D = (m) => { g.add(m); detail.push(m); return m; };

  // --- receiver, flat-bottomed and long ------------------------------------
  g.add(box(P.metal, 0.038, 0.046, 0.220, 0, 0.008, -0.150));
  D(box(P.edge, 0.039, 0.0022, 0.220, 0, 0.032, -0.150));
  D(box(P.seam, 0.0035, 0.016, 0.060, 0.019, 0.008, -0.120));

  // --- bolt handle: the reload lifts it, pulls it, pushes it home ----------
  const bolt = new THREE.Group();
  bolt.position.set(0, 0.008, -0.080);
  bolt.add(rod(P.metal, 0.006, 0.006, 0.046, 0.030, 0.000, 0, 'x', 10));
  const knob = new THREE.Mesh(cylGeo(0.011, 0.011, 0.014, 12), P.metal);
  knob.rotation.z = Math.PI / 2;
  knob.position.set(0.052, 0.000, 0);
  bolt.add(knob);
  bolt.add(box(P.dark, 0.026, 0.020, 0.040, 0.000, 0.010, 0.010));   // shroud
  g.add(bolt);

  // --- barrel: long, tapered, banded ---------------------------------------
  g.add(rod(P.dark, 0.010, 0.015, 0.480, 0, 0.008, -0.500, 'z', 16));
  D(ring(P.metal, 0.014, 0.0028, 0, 0.008, -0.330, 14));
  D(ring(P.metal, 0.012, 0.0026, 0, 0.008, -0.560, 14));
  D(ring(P.edge, 0.0105, 0.0020, 0, 0.008, -0.738, 14));            // crowned muzzle
  g.add(box(P.metal, 0.014, 0.012, 0.040, 0, -0.008, -0.560));      // front sling base

  // --- stock: wood furniture, comb, wrist, floorplate ----------------------
  g.add(box(P.wood, 0.042, 0.056, 0.300, 0, -0.030, -0.140));       // forend
  for (let i = 0; i < 4; i++) {                                     // checkering
    D(box(P.dark, 0.043, 0.004, 0.006, 0, -0.048, -0.180 - i * 0.026));
  }
  g.add(box(P.wood, 0.042, 0.060, 0.130, 0, -0.020, 0.050));        // wrist
  const comb = box(P.wood, 0.044, 0.062, 0.150, 0, 0.008, 0.140);
  comb.rotation.x = 0.06;
  g.add(comb);
  D(box(P.dark, 0.046, 0.012, 0.110, 0, 0.038, 0.140));             // cheek riser
  const pad = box(P.seam, 0.048, 0.092, 0.016, 0, -0.004, 0.212);
  pad.rotation.x = 0.11;
  g.add(pad);

  const grip = new THREE.Group();
  grip.position.set(0, -0.030, 0.006);
  grip.rotation.x = -0.34;
  grip.add(box(P.wood, 0.032, 0.078, 0.048, 0, -0.038, 0));
  for (let i = 0; i < 3; i++) {
    const r = box(P.dark, 0.033, 0.006, 0.007, 0, -0.018 - i * 0.019, -0.023);
    grip.add(r); detail.push(r);
  }
  g.add(grip);
  g.add(triggerGroup(P, 0, -0.026, -0.062, 0.028));

  // Internal magazine: a hinged floorplate that the stripper-clip reload drops.
  const mag = new THREE.Group();
  mag.position.set(0, -0.052, -0.100);
  mag.add(box(P.metal, 0.034, 0.014, 0.070, 0, 0, 0));
  mag.add(box(P.dark, 0.026, 0.010, 0.030, 0, -0.010, 0));
  mag.add(rod(P.brass, 0.0055, 0.0055, 0.040, 0, 0.014, -0.010, 'z', 8));
  g.add(mag);

  // --- optic: the sight line is the scope axis -----------------------------
  //
  // Sat higher and built bigger than the previous pass. This is the weapon
  // whose whole identity is the glass, and the old version was a 32mm tube
  // lying flat along the receiver, which from the front is the same
  // horizontal line as the barrel. A tall mount and a bell objective give the
  // silhouette the vertical break it needs.
  //
  // Rebuilt on the open-tube helper as well: the old version used capped
  // cylinders for the ocular and objective, which meant the "scope" had an
  // opaque disc across the sight line and could never be looked through.
  const SIGHT_Y = 0.086;
  g.add(tubeOptic(P, SIGHT_Y, 0.032, -0.140, detail, {
    rTube: 0.017, rBell: 0.026, len: 0.230, crosshair: true,
  }));

  // Cheek riser to match the mount height. A scope this tall over a stock the
  // shooter's face cannot reach is the classic modelled-by-eye tell.
  D(box(P.wood, 0.044, 0.020, 0.150, 0, 0.044, 0.140));

  g.add(gripHand(P, 0.000, -0.066, -0.006, -0.34));
  g.add(guardHand(P, 0.000, -0.032, -0.235));

  return {
    root: g, detail, mag,
    bolt, boltLift: 1.15, boltTravel: 0.070,
    sight: new THREE.Vector3(0, SIGHT_Y, -0.140),   // scope axis, tube centre
    muzzle: new THREE.Vector3(0, 0.008, -0.744),
    eject: new THREE.Vector3(0.024, 0.010, -0.120),
  };
}

function buildSunspear(P) {
  const g = new THREE.Group();
  const detail = [];
  const D = (m) => { g.add(m); detail.push(m); return m; };

  // --- chassis: angular, and deliberately not a rifle receiver -------------
  g.add(box(P.metal, 0.050, 0.062, 0.240, 0, 0.010, -0.140));
  D(box(P.edge, 0.051, 0.0025, 0.240, 0, 0.042, -0.140));
  for (const side of [-1, 1]) {                                   // canted flanks
    const f = box(P.dark, 0.010, 0.050, 0.220, side * 0.028, 0.010, -0.140);
    f.rotation.z = side * 0.22;
    g.add(f);
  }

  // Heat sink fins over the chamber. The fins are the "this is not a gun" tell.
  for (let i = 0; i < 7; i++) {
    const fin = box(P.metal, 0.062, 0.020, 0.006, 0, 0.050, -0.070 - i * 0.022);
    g.add(fin); detail.push(fin);
    const slot = box(P.core, 0.056, 0.004, 0.004, 0, 0.040, -0.070 - i * 0.022);
    g.add(slot); detail.push(slot);
  }

  // --- the core: a glowing rod running the length of the weapon ------------
  const core = rod(P.core, 0.008, 0.008, 0.130, 0, 0.006, -0.420, 'z', 14);
  g.add(core);
  // The rest of the run is shrouded, with the glow leaking out at the joints.
  g.add(rod(P.dark, 0.016, 0.016, 0.190, 0, 0.006, -0.270, 'z', 14));
  const coreGlowA = ring(P.core, 0.018, 0.0035, 0, 0.006, -0.362, 18);
  const coreGlowB = ring(P.core, 0.014, 0.0030, 0, 0.006, -0.176, 18);
  g.add(coreGlowA, coreGlowB);

  // --- emitter: three prongs around the core, not a barrel -----------------
  g.add(rod(P.metal, 0.022, 0.028, 0.080, 0, 0.006, -0.300, 'z', 16));
  g.add(ring(P.metal, 0.028, 0.005, 0, 0.006, -0.340, 18));

  // Parallel prongs, each toed in a few degrees so they converge on the core
  // line without meeting. Aiming them at a single point turns the emitter into
  // a pair of scissors, which is what the first pass did.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const prong = box(P.metal, 0.014, 0.014, 0.160,
      Math.cos(a) * 0.024, 0.006 + Math.sin(a) * 0.024, -0.442);
    prong.rotation.x = -Math.sin(a) * 0.09;
    prong.rotation.y = Math.cos(a) * 0.09;
    g.add(prong);

    const tip = box(P.core, 0.007, 0.007, 0.030,
      Math.cos(a) * 0.019, 0.006 + Math.sin(a) * 0.019, -0.516);
    g.add(tip); detail.push(tip);
  }
  D(ring(P.core, 0.015, 0.0028, 0, 0.006, -0.500, 18));

  // --- energy cell: the "magazine" the reload swaps -------------------------
  // Seated hard against the underside of the chassis. A cell floating a
  // centimetre below the receiver reads as a bug, not as a battery.
  g.add(box(P.metal, 0.048, 0.014, 0.084, 0, -0.026, -0.150));   // cell housing
  const mag = new THREE.Group();
  mag.position.set(0, -0.030, -0.150);
  mag.add(box(P.metal, 0.052, 0.062, 0.072, 0, -0.032, 0));
  mag.add(box(P.core, 0.056, 0.010, 0.014, 0, -0.022, 0));       // charge windows
  mag.add(box(P.core, 0.056, 0.010, 0.014, 0, -0.042, 0));
  mag.add(box(P.dark, 0.040, 0.012, 0.062, 0, -0.066, 0));
  g.add(mag);

  // --- grip, trigger, brace ------------------------------------------------
  const grip = new THREE.Group();
  grip.position.set(0, -0.034, -0.026);
  grip.rotation.x = -0.24;
  grip.add(box(P.poly, 0.030, 0.094, 0.046, 0, -0.047, 0));
  for (let i = 0; i < 4; i++) {
    const r = box(P.dark, 0.031, 0.006, 0.007, 0, -0.020 - i * 0.020, -0.022);
    grip.add(r); detail.push(r);
  }
  g.add(grip);
  g.add(triggerGroup(P, 0, -0.020, -0.066, 0.030));

  // Skeleton brace instead of a stock: two struts and a shoulder plate.
  for (const side of [-1, 1]) {
    g.add(rod(P.metal, 0.006, 0.006, 0.150, side * 0.018, 0.020, 0.078, 'z', 8));
  }
  g.add(box(P.poly, 0.048, 0.062, 0.016, 0, 0.006, 0.150));
  D(box(P.core, 0.030, 0.005, 0.008, 0, 0.030, 0.148));

  // Charging lever: the reload racks it to prime the new cell.
  const bolt = new THREE.Group();
  bolt.position.set(-0.034, 0.026, -0.070);
  bolt.add(box(P.metal, 0.018, 0.030, 0.030, 0, 0, 0));
  bolt.add(box(P.core, 0.020, 0.006, 0.006, 0, 0.012, 0));
  g.add(bolt);

  // --- holographic sight: a frame with a floating dot ----------------------
  const SIGHT_Y = 0.078;
  g.add(box(P.metal, 0.038, 0.008, 0.014, 0, 0.056, -0.052));      // mount
  for (const side of [-1, 1]) {
    g.add(box(P.metal, 0.005, 0.034, 0.010, side * 0.018, 0.076, -0.052));
  }
  g.add(box(P.metal, 0.041, 0.006, 0.010, 0, 0.094, -0.052));      // hood
  const pane = new THREE.Mesh(boxGeo(0.030, 0.030, 0.0015), P.lens);
  pane.position.set(0, SIGHT_Y, -0.052);
  g.add(pane);
  const dot = new THREE.Mesh(boxGeo(0.0035, 0.0035, 0.0035), P.core);
  dot.position.set(0, SIGHT_Y, -0.056);
  g.add(dot);

  // Rear ghost ring, so the eye still has two elements to line up on. Carried
  // on two side legs rather than a centre post: a post under the ring reaches
  // up to within a millimetre of the sight line, and at 170mm from the eye
  // that millimetre is a grey slab filling the bottom half of the aperture.
  // Legs at the ring's own width frame it instead of blocking it. The ring is
  // also smaller and set further out, because a ghost ring at arm's reach of
  // the eye stops being a ring and becomes a tunnel.
  for (const side of [-1, 1]) {
    g.add(box(P.metal, 0.004, 0.030, 0.010, side * 0.011, 0.061, -0.030));
  }
  g.add(ring(P.metal, 0.0085, 0.0018, 0, SIGHT_Y, -0.030, 14));

  g.add(gripHand(P, 0.000, -0.070, -0.020, -0.24));
  g.add(guardHand(P, 0.000, 0.014, -0.300));

  return {
    root: g, detail, mag,
    bolt, boltLift: 0, boltTravel: 0.036,
    sight: new THREE.Vector3(0, SIGHT_Y, -0.052),   // holographic pane / dot
    muzzle: new THREE.Vector3(0, 0.006, -0.540),
    eject: null,                       // energy weapons drop no brass
    glowParts: [core, coreGlowA, coreGlowB, dot],
  };
}

// ---------------------------------------------------------------------------
// reload tracks
//
// Keyframes on a normalized 0..1 timeline; each weapon stretches it with its
// own duration, so an LMG takes three times as long as a pistol on the same
// shape. p and r are additive offsets on the hip pose; mag is 0 seated / 1
// removed; bolt is 0 forward / 1 back; glow drives the Sunspear core.
// ---------------------------------------------------------------------------

const MAG_RELOAD = [
  { t: 0.00, p: [0, 0, 0], r: [0, 0, 0], mag: 0, bolt: 0 },
  // Roll the receiver over so the magazine well faces the support hand.
  { t: 0.11, p: [0.012, -0.030, 0.020], r: [-0.14, 0.26, 0.34], mag: 0, bolt: 0 },
  { t: 0.20, p: [0.014, -0.034, 0.022], r: [-0.16, 0.28, 0.36], mag: 1, bolt: 0 },
  // The empty is gone; the hand is off frame getting the fresh one.
  { t: 0.44, p: [0.014, -0.052, 0.016], r: [-0.10, 0.26, 0.33], mag: 1, bolt: 0 },
  { t: 0.58, p: [0.012, -0.038, 0.020], r: [-0.13, 0.26, 0.34], mag: 0, bolt: 0 },
  // The tug that checks the magazine locked. Small, fast, and the beat that
  // makes the whole animation feel like a person did it.
  { t: 0.65, p: [0.012, -0.058, 0.030], r: [-0.18, 0.25, 0.33], mag: 0, bolt: 0 },
  { t: 0.76, p: [0.008, -0.026, 0.014], r: [-0.05, 0.15, 0.18], mag: 0, bolt: 1 },
  { t: 0.85, p: [0.006, -0.016, 0.006], r: [-0.02, 0.09, 0.10], mag: 0, bolt: 0 },
  { t: 1.00, p: [0, 0, 0], r: [0, 0, 0], mag: 0, bolt: 0 },
];

// Shell by shell into the loading gate, then one pump to chamber.
const SHELL_RELOAD = [
  { t: 0.00, p: [0, 0, 0], r: [0, 0, 0], mag: 1, bolt: 0 },
  { t: 0.08, p: [0.014, -0.030, 0.020], r: [-0.10, 0.30, 0.42], mag: 1, bolt: 0 },
  { t: 0.20, p: [0.014, -0.030, 0.020], r: [-0.10, 0.30, 0.42], mag: 0, bolt: 0 },
  { t: 0.28, p: [0.014, -0.024, 0.016], r: [-0.08, 0.30, 0.42], mag: 1, bolt: 0 },
  { t: 0.40, p: [0.014, -0.030, 0.020], r: [-0.10, 0.30, 0.42], mag: 0, bolt: 0 },
  { t: 0.48, p: [0.014, -0.024, 0.016], r: [-0.08, 0.30, 0.42], mag: 1, bolt: 0 },
  { t: 0.60, p: [0.014, -0.030, 0.020], r: [-0.10, 0.30, 0.42], mag: 0, bolt: 0 },
  { t: 0.68, p: [0.014, -0.024, 0.016], r: [-0.08, 0.30, 0.42], mag: 1, bolt: 0 },
  // Level the weapon and work the pump.
  { t: 0.80, p: [0.006, -0.014, 0.010], r: [-0.03, 0.10, 0.12], mag: 1, bolt: 1 },
  { t: 0.90, p: [0.004, -0.008, 0.004], r: [-0.01, 0.05, 0.05], mag: 1, bolt: 0 },
  { t: 1.00, p: [0, 0, 0], r: [0, 0, 0], mag: 1, bolt: 0 },
];

// Bolt up and back, clip pressed in, bolt forward and down.
const CLIP_RELOAD = [
  { t: 0.00, p: [0, 0, 0], r: [0, 0, 0], mag: 0, bolt: 0 },
  { t: 0.14, p: [0.008, -0.020, 0.014], r: [-0.08, 0.18, 0.24], mag: 0, bolt: 1 },
  { t: 0.30, p: [0.010, -0.026, 0.018], r: [-0.10, 0.22, 0.28], mag: 1, bolt: 1 },
  { t: 0.52, p: [0.010, -0.030, 0.016], r: [-0.08, 0.22, 0.28], mag: 1, bolt: 1 },
  { t: 0.66, p: [0.010, -0.024, 0.016], r: [-0.09, 0.20, 0.26], mag: 0, bolt: 1 },
  { t: 0.78, p: [0.006, -0.016, 0.010], r: [-0.04, 0.12, 0.14], mag: 0, bolt: 0 },
  { t: 1.00, p: [0, 0, 0], r: [0, 0, 0], mag: 0, bolt: 0 },
];

// Cell swap. The core browns out while the weapon has no cell in it, then
// overshoots on prime, which is the whole reason to give an energy weapon a
// reload at all.
const CELL_RELOAD = [
  { t: 0.00, p: [0, 0, 0], r: [0, 0, 0], mag: 0, bolt: 0, glow: 1 },
  { t: 0.14, p: [0.012, -0.026, 0.018], r: [-0.12, 0.24, 0.30], mag: 0, bolt: 0, glow: 0.9 },
  { t: 0.24, p: [0.012, -0.030, 0.020], r: [-0.14, 0.26, 0.32], mag: 1, bolt: 0, glow: 0.12 },
  { t: 0.50, p: [0.012, -0.046, 0.016], r: [-0.10, 0.24, 0.30], mag: 1, bolt: 0, glow: 0.12 },
  { t: 0.64, p: [0.012, -0.032, 0.020], r: [-0.13, 0.24, 0.30], mag: 0, bolt: 0, glow: 0.4 },
  { t: 0.76, p: [0.008, -0.022, 0.012], r: [-0.06, 0.14, 0.16], mag: 0, bolt: 1, glow: 0.6 },
  { t: 0.84, p: [0.006, -0.014, 0.006], r: [-0.03, 0.08, 0.08], mag: 0, bolt: 0, glow: 2.1 },
  { t: 1.00, p: [0, 0, 0], r: [0, 0, 0], mag: 0, bolt: 0, glow: 1 },
];

// Turn the weapon over, look at the receiver, drop it back. Pure flourish.
const INSPECT = [
  { t: 0.00, p: [0, 0, 0], r: [0, 0, 0], mag: 0, bolt: 0 },
  { t: 0.18, p: [0.030, -0.020, 0.070], r: [0.10, 0.62, 0.30], mag: 0, bolt: 0 },
  { t: 0.34, p: [0.036, -0.014, 0.080], r: [0.16, 0.78, 0.22], mag: 0, bolt: 0 },
  { t: 0.50, p: [0.030, -0.026, 0.076], r: [-0.06, 0.70, -0.42], mag: 0, bolt: 0 },
  { t: 0.68, p: [0.020, -0.030, 0.050], r: [-0.14, 0.40, -0.70], mag: 0, bolt: 0 },
  { t: 0.84, p: [0.008, -0.014, 0.020], r: [-0.05, 0.16, -0.24], mag: 0, bolt: 0 },
  { t: 1.00, p: [0, 0, 0], r: [0, 0, 0], mag: 0, bolt: 0 },
];

// ---------------------------------------------------------------------------
// weapon table
//
// There is no adsPose here. `relief` is the distance from the eye to the
// weapon's rear sight element when aiming, in metres, and attach() solves the
// pose from it and from the model's own `sight` node. That is the only ADS
// number a weapon gets, and it is one you can check against reality rather
// than against a screenshot: a pistol at arm's length is far, a rifle stock
// against the cheek is close, a scope has a real published eye relief.
//
// Sanity anchors for the numbers below: 0.40 is a two-handed pistol at
// something short of full extension, 0.24-0.29 is a long gun shouldered, and
// the scoped rifle's 0.245 puts the ocular about 130mm from the eye.
// ---------------------------------------------------------------------------

const ADS_RELIEF = 0.27;

const WEAPONS = {
  mk9: {
    name: 'MK9',
    build: buildPistol,
    hipPose: { pos: [0.092, -0.116, -0.400], rot: [-0.010, 0.100, 0.030] },
    relief: 0.40,          // both arms out; the slide has to be far from the eye
    track: MAG_RELOAD, reloadTime: 1.85,
    kick: { back: 1.05, rise: 0.55, pitch: 0.34, yaw: 0.10, roll: 0.9 },
    camKick: 2.6, flash: 0.9, shell: 0.85, sway: 1.0,
  },

  smg: {
    name: 'Wadjet SMG',
    build: buildSmg,
    hipPose: { pos: [0.108, -0.124, -0.330], rot: [-0.014, 0.082, 0.030] },
    relief: 0.245,
    track: MAG_RELOAD, reloadTime: 2.05,
    kick: { back: 0.85, rise: 0.45, pitch: 0.26, yaw: 0.12, roll: 0.7 },
    camKick: 1.9, flash: 0.85, shell: 0.8, sway: 0.95,
  },

  shotgun: {
    name: 'Sekhem 12',
    build: buildShotgun,
    hipPose: { pos: [0.112, -0.130, -0.345], rot: [-0.014, 0.076, 0.030] },
    relief: 0.265,
    track: SHELL_RELOAD, reloadTime: 3.20,
    kick: { back: 2.30, rise: 1.30, pitch: 0.72, yaw: 0.14, roll: 1.6 },
    camKick: 5.4, flash: 1.6, shell: 1.25, sway: 1.05,
  },

  carbine: {
    name: 'M4 Ankh',
    build: buildCarbine,
    hipPose: { pos: [0.110, -0.128, -0.345], rot: [-0.014, 0.078, 0.030] },
    relief: 0.270,
    track: MAG_RELOAD, reloadTime: 2.40,
    kick: { back: 1.05, rise: 0.58, pitch: 0.30, yaw: 0.11, roll: 0.8 },
    camKick: 2.4, flash: 1.0, shell: 1.0, sway: 1.0,
  },

  lmg: {
    name: 'Apis LMG',
    build: buildLmg,
    hipPose: { pos: [0.120, -0.140, -0.360], rot: [-0.012, 0.070, 0.028] },
    relief: 0.290,
    track: MAG_RELOAD, reloadTime: 3.90,
    kick: { back: 1.35, rise: 0.72, pitch: 0.36, yaw: 0.16, roll: 1.0 },
    camKick: 3.0, flash: 1.25, shell: 1.1, sway: 1.35,
  },

  bolt: {
    name: 'Sekhmet Bolt',
    build: buildBolt,
    hipPose: { pos: [0.114, -0.132, -0.350], rot: [-0.012, 0.072, 0.028] },
    relief: 0.245,        // to the tube centre: the ocular lands ~130mm out
    track: CLIP_RELOAD, reloadTime: 3.10,
    kick: { back: 2.60, rise: 1.10, pitch: 0.80, yaw: 0.10, roll: 1.2 },
    camKick: 6.0, flash: 1.4, shell: 1.15, sway: 1.25,
  },

  sunspear: {
    name: 'Sunspear',
    build: buildSunspear,
    hipPose: { pos: [0.110, -0.130, -0.340], rot: [-0.012, 0.074, 0.028] },
    relief: 0.205,
    track: CELL_RELOAD, reloadTime: 2.30,
    kick: { back: 0.70, rise: 0.30, pitch: 0.18, yaw: 0.05, roll: 0.4 },
    camKick: 1.4, flash: 1.5, shell: 0, sway: 1.1,
  },
};

// ---------------------------------------------------------------------------
// small math
// ---------------------------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const smooth = (t) => t * t * (3 - 2 * t);

/** Frame-rate independent easing toward a target. */
const approach = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, dt * rate);

/** Sample a keyframe track. Smoothstepped between keys, so no visible corners. */
function sampleTrack(keys, t, out) {
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t < t) i++;

  const a = keys[i];
  const b = keys[i + 1] || a;
  const span = Math.max(1e-5, b.t - a.t);
  const k = smooth(clamp01((t - a.t) / span));

  out.px = lerp(a.p[0], b.p[0], k);
  out.py = lerp(a.p[1], b.p[1], k);
  out.pz = lerp(a.p[2], b.p[2], k);
  out.rx = lerp(a.r[0], b.r[0], k);
  out.ry = lerp(a.r[1], b.r[1], k);
  out.rz = lerp(a.r[2], b.r[2], k);
  out.mag = lerp(a.mag, b.mag, k);
  out.bolt = lerp(a.bolt, b.bolt, k);
  out.glow = lerp(a.glow === undefined ? 1 : a.glow, b.glow === undefined ? 1 : b.glow, k);
  return out;
}

// ---------------------------------------------------------------------------
// the viewmodel
// ---------------------------------------------------------------------------

/**
 * @param {object} host  the camera rig from player/camera.js (for kick), or a
 *                       raw THREE.PerspectiveCamera. Both are accepted: kick is
 *                       called only if it exists, and aspect is read only if
 *                       the object is a camera.
 * @param {object} materials  the registry from world/materials.js
 */
export function createViewmodel(host, materials) {
  const M = materials || buildMaterials();
  const P = palette(M);

  // --- the second stage ----------------------------------------------------
  const scene = new THREE.Scene();
  const vmCamera = new THREE.PerspectiveCamera(VM_FOV, 1, VM_NEAR, VM_FAR);

  const group = new THREE.Group();
  group.name = 'viewmodel';
  scene.add(group);

  // Three-point lighting, owned by this scene. Directional lights cost nothing
  // against the world's point-light budget, and having our own key means the
  // weapon reads the same at noon in the courtyard and in a sealed chamber.
  //
  // The key sits up and to the RIGHT, on the same side as the player's eye.
  // Gunmetal is dark and glossy; a key from the far side leaves the whole
  // viewmodel as a silhouette of black boxes, which is exactly how the first
  // pass of this file looked in the harness.
  // These read high because main.js multiplies every light in this scene by
  // 0.45 once the desert HDRI lands, to stop the authored studio fighting the
  // sun. Post-scale they are roughly 1.6 / 0.65 / 1.2, which is what the
  // weapon is actually lit by, and it has to be enough to out-sculpt a sky
  // dome: directional light is the only thing here that makes a light side and
  // a dark side, and without one a weapon is a flat cutout of sky colour.
  const key = new THREE.DirectionalLight(0xffeed4, 4.30);
  key.position.set(0.55, 0.90, 0.70);
  const fill = new THREE.DirectionalLight(0x93a9c9, 2.70);
  fill.position.set(-0.85, -0.25, 0.55);
  const rim = new THREE.DirectionalLight(0xffd6a0, 3.10);
  rim.position.set(-0.25, 0.65, -1.0);

  // The ambient term is DELIBERATELY small now, and cutting it is what made
  // the hands legible. AmbientLight contributes to diffuse only, so at
  // metalness 0.90 it was doing nothing at all for the weapon while adding a
  // flat unshaded 1.45 to the gloves - which is how leather at albedo 0x6b563c
  // came out as a blown cream card with no fingers in it. The metal gets its
  // lift from the environment instead, below, where it actually belongs.
  scene.add(key, fill, rim, new THREE.AmbientLight(0x6a7078, 0.75));

  // --- muzzle flash --------------------------------------------------------
  // A cone pointing down the bore plus a cross-glow quad, and a real point
  // light that is on for exactly two frames. See update() for the frame count.
  const flash = new THREE.Group();
  flash.visible = false;

  const flashCone = new THREE.Mesh(coneGeo(0.045, 0.11, 12), P.flash);
  flashCone.rotation.x = -Math.PI / 2;    // apex forward, down -Z
  flashCone.position.z = -0.055;
  flash.add(flashCone);

  const flashCore = new THREE.Mesh(coneGeo(0.022, 0.05, 10), P.flash);
  flashCore.rotation.x = Math.PI / 2;     // a second cone facing back into the barrel
  flashCore.position.z = -0.012;
  flash.add(flashCore);

  const flashStar = new THREE.Mesh(boxGeo(0.14, 0.006, 0.006), P.flash);
  flash.add(flashStar);
  const flashStarV = new THREE.Mesh(boxGeo(0.006, 0.14, 0.006), P.flash);
  flash.add(flashStarV);

  const flashLight = new THREE.PointLight(0xffcf8a, 0, 1.6, 2);
  flashLight.visible = false;
  flash.add(flashLight);
  group.add(flash);

  let flashFrames = 0;

  // --- image-based lighting -------------------------------------------------
  // gunmetal is metalness 0.90, and a metal with nothing to reflect is black
  // everywhere the specular highlights are not. Three lights alone left every
  // weapon reading as a silhouette of dark boxes in the harness. This builds a
  // tiny procedural studio (warm key panel overhead right, cool bounce left,
  // dim floor, dark surround), prefilters it once, and hands it to the scene
  // as an environment. Nothing is downloaded: it is four boxes and a PMREM.
  //
  // It needs the renderer, which only arrives at the first render() call, so
  // it is built lazily there.
  let envBuilt = false;

  function buildEnvironment(renderer) {
    envBuilt = true;

    // Bail before building anything if somebody already installed one.
    // main.js hands this scene the world's real desert HDRI once the assets
    // resolve, and that is the better source: it is the actual place the
    // weapon is standing in. This studio is the fallback for the frames before
    // that lands and for a run where the assets fail, so it must never
    // overwrite the real thing on a late first frame. It also must not build a
    // PMREM it is not going to use.
    if (scene.environment) return;

    const envScene = new THREE.Scene();
    const temp = [];

    const panel = (r, g2, b, w, h, d, x, y, z) => {
      const mat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
      // Values above 1 are legal here and are the point: the PMREM target is
      // half float, so this is a genuine HDR source rather than a grey card.
      mat.color.setRGB(r, g2, b);
      const geo = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      envScene.add(m);
      temp.push(geo, mat);
    };

    // The surround and the floor both came UP hard in this pass.
    //
    // A metal at metalness 0.90 has essentially no diffuse: what it shows is
    // whatever the environment puts in front of it. With a 0.06 surround, most
    // directions reflected black, and the weapon rendered as a black wall in
    // the middle of a sunlit desert. It is also simply wrong for the setting:
    // the player is standing on bright sand under an open sky, so the biggest
    // single source hitting the underside of a weapon is warm ground bounce.
    panel(0.30, 0.33, 0.40, 12, 12, 12, 0, 0, 0);           // surround
    panel(3.60, 3.20, 2.65, 5, 0.2, 5, 1.6, 3.2, 1.2);      // warm key, overhead right
    panel(0.95, 1.05, 1.30, 8, 0.2, 8, 0, 3.4, 0);          // open sky, overhead
    panel(0.60, 0.78, 1.10, 0.2, 4, 4, -3.0, 0.4, 1.0);     // cool bounce, left
    panel(1.10, 0.88, 0.60, 8, 0.2, 8, 0, -3.0, 0);         // sand bounce, below

    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(envScene, 0.03);
    scene.environment = rt.texture;
    // Now carrying the metal rather than garnishing the key light.
    scene.environmentIntensity = 1.30;

    pmrem.dispose();
    for (const t of temp) t.dispose();
  }

  // --- shell casings -------------------------------------------------------
  // Allocated once, on the first equip, and reused for every weapon and every
  // shot after that. Nothing in fire() constructs anything.
  const shells = [];
  let shellCursor = 0;

  function allocShells() {
    if (shells.length) return;
    for (let i = 0; i < SHELL_POOL; i++) {
      const mesh = new THREE.Mesh(cylGeo(0.0045, 0.0045, 0.019, 8), P.brass);
      mesh.visible = false;
      scene.add(mesh);
      shells.push({
        mesh,
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        life: 0,
        active: false,
      });
    }
  }

  // --- state ---------------------------------------------------------------
  const built = new Map();          // weaponId -> built model, so switching back is free

  let current = null;               // the active WEAPONS entry
  let model = null;                 // the active built model
  let pending = null;               // weapon id waiting for the lower to finish

  let adsBlend = 0;
  let sprintBlend = 0;
  let bobPhase = 0;
  let swayT = 0;
  let lagX = 0, lagY = 0;

  let switchT = 1;                  // 0 = fully lowered, 1 = fully up
  let reloadT = 0;                  // seconds into the reload
  let inspectT = 0;
  let highFidelity = true;

  const kick = { z: 0, y: 0, rx: 0, rz: 0, vz: 0, vy: 0, vrx: 0, vrz: 0 };

  const state = {
    weapon: null,
    name: null,
    phase: 'empty',                 // empty | raising | ready | lowering | reloading | inspecting
    ads: false,
    adsBlend: 0,
    sprintBlend: 0,
    reloadProgress: 0,
    shellsActive: 0,
  };

  // Scratch, allocated once. Everything below runs every frame.
  const pos = new THREE.Vector3();
  const rot = new THREE.Vector3();
  const trackOut = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, mag: 0, bolt: 0, glow: 1 };
  const worldPoint = new THREE.Vector3();

  // -------------------------------------------------------------------------
  // equip
  // -------------------------------------------------------------------------

  /**
   * Solve the ADS pose from the model's own sight geometry.
   *
   * Put the weapon's rear sight element at (0, 0, -relief) in view space and
   * leave the bore parallel to -Z. The eye is at the origin looking down -Z
   * and the crosshair is at the centre of the frame, so a sight element on
   * that axis projects to the exact centre at every aspect ratio and every
   * FOV, and the front element - authored at the same x and y - lands on top
   * of it. No screenshot tuning, and no way for a geometry change to silently
   * break the aim of one weapon out of seven.
   *
   * Cached on the model: it depends only on geometry that never moves.
   */
  function solveAdsPose(m, w) {
    const relief = w.relief || ADS_RELIEF;
    m.adsPose = {
      pos: [-m.sight.x, -m.sight.y, -(relief + m.sight.z)],
      rot: [0, 0, 0],
    };
  }

  function attach(id) {
    const w = WEAPONS[id];
    if (!w) return false;

    if (model) group.remove(model.root);

    let m = built.get(id);
    if (!m) {
      m = w.build(P);
      solveAdsPose(m, w);
      built.set(id, m);
      applyDetailVisibility(m);
    }

    current = w;
    model = m;
    group.add(m.root);

    // Park the flash on this weapon's muzzle and size it to the calibre.
    flash.position.copy(m.muzzle);
    flash.scale.setScalar(w.flash);
    if (w.shell > 0) allocShells();

    state.weapon = id;
    state.name = w.name;
    return true;
  }

  function applyDetailVisibility(m) {
    for (const d of m.detail) d.visible = highFidelity;
  }

  /**
   * Swap weapons. If something is already up it is lowered first and the swap
   * happens at the bottom of the stroke, which is the only place a cut is
   * invisible.
   */
  function equip(id) {
    if (!WEAPONS[id]) return false;
    if (state.weapon === id && state.phase !== 'empty') return true;

    if (!model) {
      attach(id);
      switchT = 0;
      state.phase = 'raising';
      return true;
    }

    pending = id;
    state.phase = 'lowering';
    reloadT = 0;
    inspectT = 0;
    return true;
  }

  // -------------------------------------------------------------------------
  // actions
  // -------------------------------------------------------------------------

  function busy() {
    return state.phase === 'reloading'
      || state.phase === 'raising'
      || state.phase === 'lowering';
  }

  /** Returns false when the state machine refused the shot. */
  function fire() {
    if (!model || busy()) return false;

    // Firing cancels an inspect immediately. Waiting for the flourish to
    // finish is the single most annoying thing a viewmodel can do.
    if (state.phase === 'inspecting') { inspectT = 0; state.phase = 'ready'; }

    const k = current.kick;

    // Impulse into the spring. ADS cuts the visual kick roughly in half: the
    // weapon is braced against the shoulder and the sight picture has to
    // survive the shot.
    const scale = 1 - 0.45 * adsBlend;
    kick.vz += k.back * scale;
    kick.vy += k.rise * scale;
    kick.vrx += k.pitch * 9 * scale;
    kick.vrz += (Math.random() - 0.5) * k.roll * 4 * scale;

    // The camera component is the rig's job, not ours.
    if (host && typeof host.kick === 'function') {
      host.kick(current.camKick * (1 - 0.3 * adsBlend),
        (Math.random() - 0.5) * current.camKick * 0.35);
    }

    // Two frames of flash, counted down in update().
    flashFrames = 2;
    flash.visible = true;
    flash.rotation.z = Math.random() * Math.PI * 2;
    const s = current.flash * (0.85 + Math.random() * 0.35);
    flash.scale.set(s, s, s * (0.8 + Math.random() * 0.5));
    if (highFidelity) {
      flashLight.visible = true;
      flashLight.intensity = 5.5 * current.flash;
    }

    if (current.shell > 0 && model.eject) spawnShell();
    return true;
  }

  function reload() {
    if (!model || busy()) return false;
    state.phase = 'reloading';
    reloadT = 0;
    inspectT = 0;
    return true;
  }

  function inspect() {
    if (!model || busy() || state.phase === 'inspecting') return false;
    state.phase = 'inspecting';
    inspectT = 0;
    return true;
  }

  // -------------------------------------------------------------------------
  // shells
  // -------------------------------------------------------------------------

  function spawnShell() {
    const cap = highFidelity ? SHELL_POOL : 6;

    // Round-robin. If every shell in the window is still flying the oldest one
    // is stolen, which is always better than allocating mid-burst.
    const s = shells[shellCursor % cap];
    shellCursor = (shellCursor + 1) % cap;
    if (!s) return;

    group.updateMatrixWorld();
    worldPoint.copy(model.eject);
    group.localToWorld(worldPoint);
    s.mesh.position.copy(worldPoint);
    s.mesh.scale.setScalar(current.shell);
    s.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);

    // Out to the right, up, and a little back past the shoulder.
    s.vel.set(
      1.05 + Math.random() * 0.55,
      1.15 + Math.random() * 0.45,
      0.35 + Math.random() * 0.40
    );
    s.spin.set(
      (Math.random() - 0.5) * 26,
      (Math.random() - 0.5) * 26,
      (Math.random() - 0.5) * 26
    );
    s.life = SHELL_LIFE;
    s.active = true;
    s.mesh.visible = true;
  }

  function updateShells(dt) {
    let active = 0;

    for (const s of shells) {
      if (!s.active) continue;

      s.vel.y -= SHELL_GRAVITY * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;

      // The real ground is 1.68 below the eye, which is off frame long before
      // the shell would reach it. A shallow fake floor keeps the bounce inside
      // the shot, which is the only reason anyone models shells at all.
      if (s.mesh.position.y < SHELL_FLOOR && s.vel.y < 0) {
        s.mesh.position.y = SHELL_FLOOR;
        s.vel.y *= -0.38;
        s.vel.x *= 0.72;
        s.vel.z *= 0.72;
        s.spin.multiplyScalar(0.55);
      }

      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        s.mesh.visible = false;         // recycled: the mesh is never discarded
      } else {
        active++;
      }
    }

    state.shellsActive = active;
  }

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  /**
   * @param {number} dt
   * @param {object} ctx { speed, sprinting, ads, grounded, lookDx, lookDy }
   */
  function update(dt, ctx = {}) {
    dt = Math.min(dt, MAX_DELTA);

    // Muzzle flash lifetime, counted in frames rather than seconds so it is
    // exactly as brief as the display allows and never smears across a long
    // frame. fire() sets the counter to 2 and turns it on; the two updates
    // that follow leave it on and render with it, and the third turns it off.
    // Two rendered frames, and the light is never left running.
    if (flashFrames > 0) {
      flashFrames--;
    } else if (flash.visible) {
      flash.visible = false;
      flashLight.visible = false;
      flashLight.intensity = 0;
    }

    updateShells(dt);
    syncProjection();

    if (!model) return;

    const speed = ctx.speed || 0;
    const grounded = ctx.grounded !== false;
    const sprinting = !!ctx.sprinting && speed > 0.5 && grounded;

    // Aiming is refused while sprinting or busy, which is what makes the
    // sprint pose a real cost rather than decoration.
    const wantAds = !!ctx.ads && !sprinting && !busy();
    state.ads = wantAds;

    // In faster than out: the weapon comes up to the eye decisively and
    // relaxes off it. Same asymmetry the camera uses on FOV.
    adsBlend = approach(adsBlend, wantAds ? 1 : 0, wantAds ? 16 : 9, dt);
    sprintBlend = approach(sprintBlend, sprinting ? 1 : 0, sprinting ? 8 : 11, dt);

    // --- state machine -----------------------------------------------------
    switch (state.phase) {
      case 'raising':
        switchT = Math.min(1, switchT + dt / RAISE_TIME);
        if (switchT >= 1) state.phase = 'ready';
        break;

      case 'lowering':
        switchT = Math.max(0, switchT - dt / LOWER_TIME);
        if (switchT <= 0) {
          // Bottom of the stroke: swap the model where nobody can see the cut.
          if (pending) { attach(pending); pending = null; }
          state.phase = 'raising';
        }
        break;

      case 'reloading':
        reloadT += dt;
        if (reloadT >= current.reloadTime) { reloadT = 0; state.phase = 'ready'; }
        break;

      case 'inspecting':
        inspectT += dt;
        if (inspectT >= INSPECT_TIME) { inspectT = 0; state.phase = 'ready'; }
        break;

      default:
        break;
    }

    // --- base pose ---------------------------------------------------------
    const hp = current.hipPose, ap = model.adsPose;
    pos.set(
      lerp(hp.pos[0], ap.pos[0], adsBlend),
      lerp(hp.pos[1], ap.pos[1], adsBlend),
      lerp(hp.pos[2], ap.pos[2], adsBlend)
    );
    rot.set(
      lerp(hp.rot[0], ap.rot[0], adsBlend),
      lerp(hp.rot[1], ap.rot[1], adsBlend),
      lerp(hp.rot[2], ap.rot[2], adsBlend)
    );

    // --- sprint pose -------------------------------------------------------
    // Drop it, cant it across the body, point the muzzle down and left. The
    // classic read: the weapon is not pointed at anything, so you are running.
    const sp = sprintBlend * (1 - adsBlend);
    if (sp > 0.001) {
      pos.x += 0.030 * sp;
      pos.y += -0.042 * sp;
      pos.z += 0.035 * sp;
      rot.x += -0.22 * sp;
      rot.y += 0.44 * sp;
      rot.z += 0.70 * sp;
    }

    // --- idle sway ---------------------------------------------------------
    // A sum of sines at frequencies with no small rational ratio between them.
    // Any two-sine breather closes its loop in a few seconds and the eye finds
    // it immediately; these never repeat inside a session.
    swayT += dt;
    const t = swayT;

    // Translation sway is all but switched off at full ADS, and that is a
    // correctness fix rather than a taste one. Solving the ADS pose puts the
    // rear sight exactly on the view axis, and then a few millimetres of
    // lateral sway at 200mm from the eye walks it 15 pixels off centre - which
    // is precisely the "off-centre sight notch" the aimed screenshot showed.
    // What survives is roll, which rocks the sight picture around the aim
    // point instead of translating it off the aim point.
    const swayScale = (1 - 0.96 * adsBlend) * current.sway;
    const rollScale = (1 - 0.70 * adsBlend) * current.sway;

    const sx = (Math.sin(t * 0.61) * 0.55
      + Math.sin(t * 1.13 + 1.7) * 0.28
      + Math.sin(t * 2.37 + 0.4) * 0.17) * 0.0125 * swayScale;

    const sy = (Math.sin(t * 0.47 + 2.1) * 0.52
      + Math.sin(t * 1.61 + 0.9) * 0.30
      + Math.sin(t * 2.93 + 1.3) * 0.18) * 0.0110 * swayScale;

    const sr = (Math.sin(t * 0.39 + 0.6) * 0.60
      + Math.sin(t * 0.97 + 2.4) * 0.40) * 0.028 * rollScale;

    pos.x += sx;
    pos.y += sy;
    rot.z += sr;
    rot.x += sy * 0.9;
    rot.y += sx * 0.9;

    // --- look lag ----------------------------------------------------------
    // The weapon trails the camera and catches up. Optional: only runs if the
    // caller passes the frame's mouse delta through.
    lagX = approach(lagX, (ctx.lookDx || 0) * 0.00016, 14, dt);
    lagY = approach(lagY, (ctx.lookDy || 0) * 0.00016, 14, dt);
    lagX = approach(lagX, 0, 6, dt);
    lagY = approach(lagY, 0, 6, dt);
    // Same reasoning as the sway: the translation component is what walks the
    // sight off the crosshair, so it goes almost to nothing when aimed and the
    // rotation component carries the read instead.
    pos.x += lagX * (1 - 0.90 * adsBlend);
    pos.y += -lagY * (1 - 0.90 * adsBlend);
    rot.y += lagX * 2.2 * (1 - 0.55 * adsBlend);
    rot.x += -lagY * 2.2 * (1 - 0.55 * adsBlend);

    // --- walk and sprint bob ------------------------------------------------
    // Driven by real speed, matching the head bob rate in player/controller.js
    // so the weapon and the camera agree about where the footfalls are.
    if (speed > 0.4 && grounded) {
      bobPhase += dt * speed * 1.55;
      // Aimed, the bob is nearly gone for the same reason the sway is: at
      // 270mm from the eye, four millimetres of lateral bob is 25 pixels of
      // sight-picture error, which is more than the width of a front post.
      const amp = Math.min(speed / 8.6, 1) * (1 - 0.92 * adsBlend);

      // Horizontal once per stride, vertical twice: one dip per footfall.
      pos.x += Math.cos(bobPhase) * 0.021 * amp;
      pos.y += Math.abs(Math.sin(bobPhase)) * -0.019 * amp;
      pos.z += Math.sin(bobPhase * 2) * 0.008 * amp;
      rot.z += Math.cos(bobPhase) * 0.055 * amp;
      rot.x += Math.sin(bobPhase * 2) * 0.030 * amp;
    }

    // --- airborne ----------------------------------------------------------
    if (!grounded) {
      pos.y += -0.012;
      rot.x += -0.05;
    }

    // --- reload and inspect tracks -----------------------------------------
    let magOut = 0, boltOut = 0, glow = 1;

    if (state.phase === 'reloading') {
      const s = sampleTrack(current.track, reloadT / current.reloadTime, trackOut);
      pos.x += s.px; pos.y += s.py; pos.z += s.pz;
      rot.x += s.rx; rot.y += s.ry; rot.z += s.rz;
      magOut = s.mag; boltOut = s.bolt; glow = s.glow;
      state.reloadProgress = reloadT / current.reloadTime;
    } else if (state.phase === 'inspecting') {
      const s = sampleTrack(INSPECT, inspectT / INSPECT_TIME, trackOut);
      pos.x += s.px; pos.y += s.py; pos.z += s.pz;
      rot.x += s.rx; rot.y += s.ry; rot.z += s.rz;
      state.reloadProgress = 0;
    } else {
      state.reloadProgress = 0;
    }

    // --- raise / lower ------------------------------------------------------
    if (switchT < 1) {
      const drop = 1 - smooth(switchT);
      pos.y += -0.26 * drop;
      pos.z += 0.06 * drop;
      rot.x += -1.05 * drop;
      rot.z += 0.30 * drop;
    }

    // --- recoil spring ------------------------------------------------------
    // Impulse displaces, spring returns. The same shape as the camera's recoil
    // so the two settle together instead of fighting.
    kick.vz += (-kick.z * RECOIL_STIFF - kick.vz * RECOIL_DAMP) * dt;
    kick.vy += (-kick.y * RECOIL_STIFF - kick.vy * RECOIL_DAMP) * dt;
    kick.vrx += (-kick.rx * RECOIL_STIFF - kick.vrx * RECOIL_DAMP) * dt;
    kick.vrz += (-kick.rz * RECOIL_STIFF - kick.vrz * RECOIL_DAMP) * dt;
    kick.z += kick.vz * dt;
    kick.y += kick.vy * dt;
    kick.rx += kick.vrx * dt;
    kick.rz += kick.vrz * dt;

    pos.z += kick.z * 0.055;
    pos.y += kick.y * 0.030;
    rot.x += kick.rx * 0.030;
    rot.z += kick.rz * 0.020;

    // --- compose ------------------------------------------------------------
    group.position.copy(pos);
    group.rotation.set(rot.x, rot.y, rot.z);

    // --- moving parts -------------------------------------------------------
    if (model.mag) {
      // Straight down and slightly forward, tipping as it falls clear.
      model.mag.position.y = model.mag.userData.baseY ??= model.mag.position.y;
      model.mag.position.y -= magOut * 0.20;
      model.mag.position.z = (model.mag.userData.baseZ ??= model.mag.position.z)
        - magOut * 0.02;
      model.mag.rotation.x = (model.mag.userData.baseRx ??= model.mag.rotation.x)
        - magOut * 0.25;
    }

    if (model.bolt) {
      // A turnbolt lifts before it travels; everything else just travels.
      const lift = model.boltLift > 0 ? smooth(clamp01(boltOut * 2.5)) : 0;
      const travel = model.boltLift > 0
        ? smooth(clamp01((boltOut - 0.4) / 0.6))
        : boltOut;

      model.bolt.position.z = (model.bolt.userData.baseZ ??= model.bolt.position.z)
        + travel * model.boltTravel;
      model.bolt.rotation.z = -lift * model.boltLift;
    }

    if (model.glowParts) {
      // Idle pulse plus whatever the reload track is doing to the cell.
      const pulse = 0.85 + Math.sin(t * 2.7) * 0.10 + Math.sin(t * 6.1) * 0.05;
      P.core.emissiveIntensity = CORE_EMISSIVE * pulse * glow;
    }

    state.adsBlend = adsBlend;
    state.sprintBlend = sprintBlend;
  }

  /** Keep the viewmodel lens matched to the window, not to the world FOV. */
  function syncProjection() {
    const aspect = (host && host.isPerspectiveCamera)
      ? host.aspect
      : window.innerWidth / Math.max(1, window.innerHeight);

    if (Math.abs(vmCamera.aspect - aspect) > 1e-4) {
      vmCamera.aspect = aspect;
      vmCamera.updateProjectionMatrix();
    }
  }

  // -------------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------------

  /**
   * Call after the main pass (after composer.render). Clearing depth is what
   * guarantees the weapon is never clipped by a wall the player is standing
   * against, and rendering into the already-composited colour buffer is what
   * keeps it out of bloom and grain.
   */
  function render(renderer) {
    if (!envBuilt) buildEnvironment(renderer);

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(scene, vmCamera);
    renderer.autoClear = prevAutoClear;
  }

  // -------------------------------------------------------------------------
  // fidelity
  // -------------------------------------------------------------------------

  function setFidelity(high) {
    highFidelity = !!high;

    // Small parts first: rail teeth, grip ribs, vent slots, wear strips. They
    // are the majority of the draw calls and the least of the silhouette.
    for (const m of built.values()) applyDetailVisibility(m);

    // The flash light is the only dynamic light this module owns, and it is
    // the first thing to go on weak hardware.
    if (!highFidelity) {
      flashLight.visible = false;
      flashLight.intensity = 0;
    }

    // Retire shells outside the reduced pool window so the count actually
    // drops rather than waiting for them to expire.
    if (!highFidelity) {
      for (let i = 6; i < shells.length; i++) {
        shells[i].active = false;
        shells[i].mesh.visible = false;
      }
      shellCursor = 0;
    }
  }

  return {
    group,
    scene,
    camera: vmCamera,
    state,

    equip,
    update,
    fire,
    reload,
    inspect,
    setFidelity,
    render,

    /** Optional: build the environment before the first frame instead of on it. */
    prepare(renderer) { if (!envBuilt) buildEnvironment(renderer); },

    /** For the harness and for tuning: the built model of the active weapon. */
    get model() { return model; },
    get weapons() { return Object.keys(WEAPONS); },
    flashLight,
  };
}

export const VIEWMODEL_CONSTANTS = { VM_FOV, RAISE_TIME, LOWER_TIME, INSPECT_TIME };
