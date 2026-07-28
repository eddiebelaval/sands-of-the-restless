/**
 * Procedural texture generation.
 *
 * Everything is drawn to an offscreen <canvas>, then the albedo is run through
 * a Sobel operator to derive a tangent-space normal map. That single trick is
 * what separates "flat coloured box" from "surface with relief" and it costs
 * about twenty lines. Roughness maps come from the same luminance data.
 *
 * No image files, ever. Every byte here is generated at boot.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// deterministic noise
// ---------------------------------------------------------------------------

/** Cheap deterministic hash. Same seed always yields the same map. */
function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1274126177;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/** Tiling value noise. Wraps at `period` so textures repeat seamlessly. */
function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const w = (n) => ((n % period) + period) % period;

  const a = hash2(w(xi),     w(yi),     seed);
  const b = hash2(w(xi + 1), w(yi),     seed);
  const c = hash2(w(xi),     w(yi + 1), seed);
  const d = hash2(w(xi + 1), w(yi + 1), seed);

  const u = smoothstep(xf), v = smoothstep(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Fractal brownian motion over tiling value noise. Returns 0..1. */
function fbm(x, y, octaves, basePeriod, seed) {
  let sum = 0, amp = 1, norm = 0, period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise((x * period), (y * period), period, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// canvas helpers
// ---------------------------------------------------------------------------

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(canvas, repeat = 1, colorSpace = THREE.SRGBColorSpace) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = colorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Sobel the albedo's luminance into a tangent-space normal map.
 * `strength` scales the perceived depth of the relief.
 */
function normalFromCanvas(source, strength = 2.4) {
  const size = source.width;
  const src = source.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, size, size).data;

  // Precompute luminance so the inner loop is one array read, not three.
  const lum = new Float32Array(size * size);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (src[p] * 0.299 + src[p + 1] * 0.587 + src[p + 2] * 0.114) / 255;
  }

  const out = makeCanvas(size);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const dst = img.data;

  const at = (x, y) => lum[(((y % size) + size) % size) * size + (((x % size) + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sobel kernels, 3x3, wrapped so the normal map tiles like the albedo.
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l  = at(x - 1, y),                       r  = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

      // Normalise (-dx, -dy, 1/strength) into 0..255 RGB.
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;

      const i = (y * size + x) * 4;
      dst[i]     = (nx * 0.5 + 0.5) * 255;
      dst[i + 1] = (ny * 0.5 + 0.5) * 255;
      dst[i + 2] = (nz * 0.5 + 0.5) * 255;
      dst[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return out;
}

/** Derive a roughness map: darker/rougher where the albedo is busy. */
function roughnessFromCanvas(source, lo = 0.55, hi = 0.95) {
  const size = source.width;
  const src = source.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, size, size).data;

  const out = makeCanvas(size);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const dst = img.data;

  for (let i = 0; i < src.length; i += 4) {
    const l = (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
    // Bright, polished areas read as smoother.
    const v = (hi - (hi - lo) * l) * 255;
    dst[i] = dst[i + 1] = dst[i + 2] = v;
    dst[i + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
  return out;
}

/** Bundle an albedo canvas into the full {map, normalMap, roughnessMap} set. */
function materialMaps(canvas, { repeat = 1, normalStrength = 2.4, rough = [0.55, 0.95] } = {}) {
  return {
    map: toTexture(canvas, repeat),
    normalMap: toTexture(normalFromCanvas(canvas, normalStrength), repeat, THREE.NoColorSpace),
    roughnessMap: toTexture(roughnessFromCanvas(canvas, rough[0], rough[1]), repeat, THREE.NoColorSpace),
  };
}

// ---------------------------------------------------------------------------
// surface painters
// ---------------------------------------------------------------------------

/** Wind-rippled desert sand. */
function paintSand(size = 512) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const d = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;

      // Grain, plus long wind ripples running on a diagonal.
      const grain = fbm(u, v, 5, 8, 11);
      const ripple = Math.sin((u * 34 + v * 12) + fbm(u, v, 3, 4, 27) * 6) * 0.5 + 0.5;
      const t = grain * 0.62 + ripple * 0.38;

      const i = (y * size + x) * 4;
      d[i]     = 196 + t * 44;
      d[i + 1] = 168 + t * 44;
      d[i + 2] = 122 + t * 40;
      d[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Limestone ashlar. Courses of blocks with recessed mortar, per-block tint
 * variation, and weathering. Drawn with the 2D API rather than per-pixel
 * because rectangles are exactly what a masonry wall is.
 */
function paintMasonry(size = 512, { rows = 6, seed = 3, hieroglyphs = false } = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });

  const blockH = size / rows;

  // Mortar / shadow gap behind everything.
  ctx.fillStyle = '#4a4032';
  ctx.fillRect(0, 0, size, size);

  for (let row = 0; row < rows; row++) {
    // Alternate courses are offset by half a block, like real ashlar.
    const offset = (row % 2) * (blockH * 0.9);
    const cols = Math.max(2, Math.round(size / (blockH * 1.8)));
    const blockW = size / cols;

    for (let col = -1; col <= cols; col++) {
      const x = col * blockW + offset;
      const y = row * blockH;
      const r = hash2(col, row, seed);

      // Per-block tint so the wall never reads as a repeated stamp.
      const base = 150 + r * 46;
      ctx.fillStyle = `rgb(${base | 0}, ${(base * 0.92) | 0}, ${(base * 0.74) | 0})`;
      ctx.fillRect(x + 2, y + 2, blockW - 4, blockH - 4);

      // Lit top edge and shadowed bottom edge give each block volume.
      ctx.fillStyle = 'rgba(255,246,224,.22)';
      ctx.fillRect(x + 2, y + 2, blockW - 4, 2);
      ctx.fillStyle = 'rgba(30,22,12,.30)';
      ctx.fillRect(x + 2, y + blockH - 5, blockW - 4, 3);

      // Chipped corners and pitting.
      const pits = 3 + Math.floor(hash2(col, row, seed + 7) * 5);
      for (let p = 0; p < pits; p++) {
        const px = x + 4 + hash2(col * 31 + p, row, seed + 13) * (blockW - 10);
        const py = y + 4 + hash2(col, row * 31 + p, seed + 17) * (blockH - 10);
        const pr = 1 + hash2(p, col + row, seed + 19) * 3;
        ctx.fillStyle = `rgba(70,58,40,${0.10 + hash2(p, row, seed + 23) * 0.16})`;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }

      if (hieroglyphs && hash2(col, row, seed + 29) > 0.28) {
        drawGlyphColumn(ctx, x + blockW * 0.5, y + 6, blockW, blockH - 12,
          hash2(col, row, seed + 31));
      }
    }
  }

  return c;
}

/**
 * A vertical cartouche of carved glyphs. These are abstract marks, not real
 * hieroglyphs. They read correctly at gameplay distance and carry the normal
 * map, which is the actual job.
 */
function drawGlyphColumn(ctx, cx, top, colW, colH, r) {
  const n = 2 + Math.floor(r * 3);
  const cell = colH / n;
  const s = Math.min(colW * 0.34, cell * 0.62);

  for (let i = 0; i < n; i++) {
    const y = top + cell * (i + 0.5);
    const kind = Math.floor(hash2(i, (cx * 7) | 0, 41 + r * 100) * 6);

    // Carved: a dark incision with a light lower lip, which is what the
    // Sobel pass turns into real-looking relief.
    ctx.strokeStyle = 'rgba(52,42,26,.62)';
    ctx.lineWidth = Math.max(1.5, s * 0.16);
    ctx.lineCap = 'round';
    ctx.beginPath();

    switch (kind) {
      case 0: // ankh
        ctx.moveTo(cx, y - s * 0.1); ctx.lineTo(cx, y + s * 0.5);
        ctx.moveTo(cx - s * 0.32, y + s * 0.06); ctx.lineTo(cx + s * 0.32, y + s * 0.06);
        ctx.moveTo(cx, y - s * 0.1);
        ctx.arc(cx, y - s * 0.26, s * 0.18, Math.PI * 0.5, Math.PI * 2.5);
        break;
      case 1: // eye
        ctx.moveTo(cx - s * 0.4, y);
        ctx.quadraticCurveTo(cx, y - s * 0.38, cx + s * 0.4, y);
        ctx.quadraticCurveTo(cx, y + s * 0.28, cx - s * 0.4, y);
        ctx.moveTo(cx + s * 0.12, y + s * 0.1); ctx.lineTo(cx + s * 0.2, y + s * 0.42);
        break;
      case 2: // waves
        for (let k = -1; k <= 1; k++) {
          const yy = y + k * s * 0.26;
          ctx.moveTo(cx - s * 0.42, yy);
          for (let q = 0; q <= 4; q++) {
            ctx.quadraticCurveTo(
              cx - s * 0.42 + s * 0.21 * q + s * 0.105, yy + (q % 2 ? s * 0.12 : -s * 0.12),
              cx - s * 0.42 + s * 0.21 * (q + 1), yy);
          }
        }
        break;
      case 3: // bird
        ctx.moveTo(cx - s * 0.4, y + s * 0.28);
        ctx.lineTo(cx - s * 0.05, y - s * 0.3);
        ctx.lineTo(cx + s * 0.4, y + s * 0.02);
        ctx.moveTo(cx - s * 0.05, y - s * 0.3); ctx.lineTo(cx + s * 0.1, y + s * 0.34);
        break;
      case 4: // reed / staff
        ctx.moveTo(cx, y - s * 0.44); ctx.lineTo(cx, y + s * 0.44);
        ctx.moveTo(cx - s * 0.22, y - s * 0.2); ctx.lineTo(cx, y - s * 0.44);
        ctx.moveTo(cx + s * 0.22, y - s * 0.2); ctx.lineTo(cx, y - s * 0.44);
        break;
      default: // seated figure
        ctx.arc(cx, y - s * 0.26, s * 0.14, 0, Math.PI * 2);
        ctx.moveTo(cx, y - s * 0.12); ctx.lineTo(cx, y + s * 0.16);
        ctx.moveTo(cx, y + s * 0.16); ctx.lineTo(cx + s * 0.34, y + s * 0.16);
        ctx.moveTo(cx, y + s * 0.16); ctx.lineTo(cx - s * 0.1, y + s * 0.44);
        break;
    }
    ctx.stroke();

    // The lit lower lip of the incision.
    ctx.save();
    ctx.translate(0, Math.max(1, s * 0.09));
    ctx.strokeStyle = 'rgba(255,248,226,.20)';
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Dressed granite: a monolithic slab, bedded and tooled.
 *
 * WHAT WAS HERE WAS A COUNTERTOP. Four octaves of isotropic fbm plus a
 * per-pixel fleck at one pixel in seventy, and nothing else - no bedding, no
 * course lines, no direction, no scale. The owner's words, playing the shipped
 * build: "the entrance to the pyramid is not rendering correctly." What he was
 * looking at reads as poured concrete or a granite worktop standing in an
 * Egyptian temple, and the specific failure is the FREQUENCY: isotropic noise
 * with no feature larger than a pixel has nothing for the eye to lock onto at
 * any distance, so at six metres it aliases into a shimmer and at twelve it
 * flattens into grey.
 *
 * This is the most-looked-at surface in the game. The player walks toward it for
 * the whole first act, it costs a thousand gold, and it fills the frame at the
 * moment of purchase.
 *
 * Three features, at three scales the eye can actually resolve:
 *
 *   BEDDING, four courses across the map. On the door's UV scale that is
 *   metre-sized, so it reads as structure. Each course carries its own value,
 *   because a bed that only differs from its neighbour by a drawn line reads as
 *   a scratch on one stone rather than as two stones.
 *
 *   TOOL MARKS, parallel. Parallel is the entire point. A dressed face carries
 *   chisel work that runs one way, and one direction at one frequency is what
 *   separates "worked stone" from "noise". Patchy, because a mason does not
 *   dress a four-metre slab evenly.
 *
 *   CRYSTALS, because granite has them and that is the one thing the old
 *   texture was right about. Density cut from one pixel in seventy to one in six
 *   hundred and the contrast roughly halved, so they read as flecks in a stone
 *   rather than as the stone itself.
 *
 * Everything tiles: the bed count divides the map, and the chisel is an integer
 * number of cycles across u.
 */
function paintGranite(size = 512) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const d = img.data;

  const BEDS = 4;
  const TAU = Math.PI * 2;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    const f = v * BEDS;
    const bed = Math.floor(f) % BEDS;
    const inBed = f - Math.floor(f);

    // Per-course value. Deterministic off the bed index so it tiles.
    // hash2 is a weak hash on small integers: the obvious `hash2(bed, k, seed)`
    // returned 0.27 / 0.22 / 0.25 / 0.31 for the four beds, a spread of 0.09,
    // and every course came out the same value. Rendered and looked at, which is
    // the only reason it was caught - the number was in the code and doing
    // nothing, which is this project's defining bug. Varying BOTH inputs with
    // the index spreads it to 0.46.
    const bedTone = (hash2(bed * 17, bed * 29, 7) - 0.5) * 0.30;

    // The seam: a dark recess, with a lighter weathered lip on the upper side of
    // the course below it. The lip is what makes a joint read as a joint and not
    // as a drawn line - it is the same cue the interior's raking brazier light
    // gives every course of masonry, baked in so it survives flat lighting.
    const edge = Math.min(inBed, 1 - inBed);
    const seam = 1 - smoothstep(Math.min(edge / 0.030, 1));
    const lipT = Math.min(Math.max(inBed - 0.030, 0) / 0.055, 1);
    const lip = smoothstep(lipT) * (1 - smoothstep(Math.min(Math.max(inBed - 0.085, 0) / 0.07, 1)));

    for (let x = 0; x < size; x++) {
      const u = x / size;

      // Broad quarry drift. Low frequency on purpose: this is the scale that
      // keeps a 4 m slab from reading as one flat value, and it is the scale the
      // old texture had none of.
      const drift = fbm(u, v, 4, 3, 71) - 0.5;
      const mottle = fbm(u, v, 3, 13, 137) - 0.5;

      // Chisel work. 19 whole cycles across u, so it tiles, wandered by a slow
      // noise so the lines are not a ruled grating.
      const chisel = Math.sin(u * TAU * 19 + (fbm(u, v, 2, 5, 23) - 0.5) * 9.0);
      const dressed = 0.45 + 0.55 * fbm(u, v, 2, 4, 51);

      const fleck = hash2(x, y, 97) > 0.9983 ? 0.40 : 0;

      const t = 0.50
        + bedTone
        + drift * 0.46
        + mottle * 0.22
        + chisel * 0.050 * dressed
        - seam * 0.30
        + lip * 0.09
        + fleck;

      const k = t < 0 ? 0 : t > 1 ? 1 : t;
      const i = (y * size + x) * 4;
      // Cool, and only just. This is the one cold object in a hot scene and that
      // is what makes the eye go to it, but the replaced scan's pink was fighting
      // the limestone rather than sitting under it. Blue leads red by eight parts
      // in 255, not thirty.
      d[i]     = 60 + k * 118;
      d[i + 1] = 63 + k * 121;
      d[i + 2] = 68 + k * 126;
      d[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * The sealed doorway's own stone. A DRESSED MONOLITH, not a quarry face.
 *
 * WHY THIS EXISTS RATHER THAN REUSING A SCAN
 *
 * This surface has now been wrong twice, in two different ways, and both were
 * a FREQUENCY error rather than a taste one.
 *
 *   1. `granite003a`, a photograph of polished worktop granite: isotropic
 *      pink-grey crystal speckle with no feature above a few texels. That is
 *      what the owner saw and called "not rendering correctly", and what a
 *      blind judge called poured concrete.
 *
 *   2. `rock023`, a scan of a weathered cliff ledge, which replaced it. Better
 *      - it has bedding - but wrong twice over. It is what `carved` already
 *      wears, so the sealed door lost every bit of material identity against
 *      the facade around it; and it is a QUARRIED face, all crag and flake and
 *      spall, when the thing being depicted is a slab a mason DRESSED.
 *
 * The measurable failure both share is texel density. rock023 is 1024 across a
 * 3.33 m tile, so 307 texels per metre. At the six metres the player reads this
 * door from, one metre of slab covers about 117 screen pixels, so every screen
 * pixel is averaging 2.6 texels. Detail at that rate cannot resolve; it goes
 * into the mip chain and comes back as noise. That is the shimmer, and it is
 * why changing the contrast never fixed it.
 *
 * So: authored at the scale it is viewed. One tile is 4.3 m, half the slab's
 * height, on a 512 map. That is 119 texels per metre - about one texel per
 * screen pixel at the read distance - and nothing in here is smaller than a
 * texel by construction.
 *
 * THREE FEATURES, LARGEST FIRST, and the sizes are the point:
 *
 *   BEDDING, two courses per tile, so 2.15 m per course and four courses up
 *   the 8.6 m slab. Large enough to be structure the eye locks onto, few
 *   enough that it still reads as a monolith rather than as coursed masonry.
 *   Each course carries its own value: a joint that is only a drawn line reads
 *   as a scratch on one stone, not as two stones meeting.
 *
 *   TOOL MARKS, parallel and DIAGONAL, at a 15 cm pitch. Parallel is what
 *   separates worked stone from noise - one direction at one frequency is a
 *   mason's arm, anything isotropic is weather. Diagonal because the geometry
 *   already puts three horizontal bars across this face and a horizontal
 *   chisel would fight them. 27 cycles in u against 9 in v are both integers,
 *   which is what lets a diagonal tile at all. 15 cm is about 21 screen pixels
 *   at six metres and mips to flat by twenty, which is what a real dressed
 *   face does.
 *
 *   MINERAL DRIFT, at half a metre to two metres. This is the granite cue, and
 *   it is deliberately NOT crystals. Individual crystals are the thing that was
 *   wrong the first time. What granite looks like at six metres is patches of
 *   lighter, warmer feldspar in a darker matrix, and a patch is something a
 *   pixel can hold.
 *
 * COLOUR is warm-neutral, not blue. The brief for this object has always been
 * "the one cold thing in a hot scene, which is what makes the eye go to it",
 * and the previous two colours chased that literally with a blue-grey.
 * Rendered, that reads as an unrelated material bolted into a sandstone wall,
 * and in the shadowed reveals it picks up the sky and goes frankly navy. A
 * NEUTRAL grey already reads cool against an orange facade - it is the oldest
 * trick there is - and it stays stone when the light leaves it.
 *
 * Everything tiles: the bed count divides the map, both chisel terms are whole
 * cycles, and every noise term is the wrapping `fbm`.
 */
function paintDoorstone(size = 512) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const d = img.data;

  const TAU = Math.PI * 2;
  const BEDS = 2;                       // courses per tile -> 2.15 m each

  /**
   * The chisel, as THREE frequencies along one direction rather than one.
   *
   * A single sine is what a first pass put here and it is unusable: 28 evenly
   * spaced parallel lines across a four-metre face reads as brushed aluminium
   * or corduroy, not as stone. The regularity is the tell, and it is a stronger
   * tell than the crag it replaced, because nothing in nature is that even.
   *
   * Three incommensurate frequencies along nearly the same direction beat
   * against each other, so the spacing wanders between roughly 12 and 30 cm
   * and no two bands are the same width. That is what a mason's arm leaves.
   * Every coefficient is an integer, which is the condition for a diagonal
   * pattern to tile at all.
   */
  const CHISEL = [
    [19, 6, 0.55],    // ~21 cm pitch, the dominant one
    [11, 4, 0.30],    // ~37 cm, broad sweeps
    [31, 11, 0.22],   // ~13 cm, the fine tooth
  ];

  /**
   * Evaluate one noise field over the whole tile and RENORMALISE it to a true
   * 0..1, because `fbm` in this file does not return one and every painter
   * above assumes it does.
   *
   * MEASURED, not suspected. `hash2` returns roughly 0.01 to 0.50 on the
   * integer lattice - never the top half of its nominal range - so `fbm`, which
   * is a weighted mean of hash2 samples, comes back narrower still. Sampled at
   * 512x512 over the exact parameters used below:
   *
   *     fbm(u, v, 3, 2,  71)    0.202 .. 0.382   mean 0.294
   *     fbm(u, v, 2, 8, 137)    0.023 .. 0.462   mean 0.237
   *     fbm(u, v, 2, 4, 211)    0.097 .. 0.409   mean 0.251
   *
   * The consequence is that the idiom used everywhere in this file - `fbm(...)
   * - 0.5`, meaning "signed variation about zero" - is not centred and not the
   * amplitude it says. For the drift field it evaluates to -0.113 give or take
   * 0.034: a near-constant darkening with 18% of the intended contrast. A first
   * cut of this texture measured a standard deviation of 5.07 out of 255 - a
   * flat panel - against 22.97 for the rock scan it replaces, and it rendered
   * as one. A threshold term written against the nominal range is worse than
   * weak, it is dead: `max(0, fbm - 0.52)` for the feldspar could never once
   * have been greater than zero.
   *
   * NORMALISING HERE AND NOT IN `hash2`, deliberately. Fixing the hash would
   * change the contrast of every procedural surface in the game at once,
   * including the sand - which a blind comparison called the best material in
   * either build and which the owner is happy with - on no evidence beyond this
   * one door. That is a separate change with its own before-and-after, and it
   * is written up rather than smuggled in here.
   *
   * Rescaling per tile rather than by a hard-coded constant also means the
   * field keeps its full range if anyone ever does fix the hash.
   */
  const field = (octaves, period, seed) => {
    const a = new Float32Array(size * size);
    let lo = Infinity, hi = -Infinity;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const t = fbm(x / size, y / size, octaves, period, seed);
        a[y * size + x] = t;
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      }
    }
    const k = hi > lo ? 1 / (hi - lo) : 0;
    for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * k;
    return a;
  };

  const fDrift = field(3, 2, 71);     // 2.15 m .. 54 cm
  const fGrain = field(2, 8, 137);    //   54 cm .. 27 cm
  const fMineral = field(2, 4, 211);  //  1.1 m  .. 54 cm

  /**
   * The fine end, and it is NOT the speckle that started all this.
   *
   * A cut with only bedding and a 21 cm chisel on it rendered as suede: at
   * three times magnification there was nothing at all between the tool marks
   * and the film grain, and a surface with a hole in its frequency spectrum
   * that wide does not read as stone at any distance.
   *
   * The lesson from the countertop scan was never "no fine detail". It was that
   * fine detail must be RESOLVABLE and STRUCTURED. granite003a failed both:
   * isotropic, and at 307 texels per metre its features were a third of a screen
   * pixel, so the mip chain turned them into shimmer. These two are authored
   * against the same 119 texels per metre as everything else here:
   *
   *   fFine  9 cm and 4.5 cm cells - five texels at the finest, about five
   *          screen pixels at the six-metre read. Low amplitude, so when it
   *          does mip away past twenty metres it averages to flat rather than
   *          to noise.
   *   fPit   6.7 cm cells, thresholded to roughly the top eighth, which is
   *          chipping and point-work on a dressed face. Sparse and localised is
   *          the whole difference between chips and static.
   */
  const fFine = field(2, 24, 307);    //    9 cm .. 4.5 cm
  const fPit = field(1, 64, 401);     //  6.7 cm

  /**
   * Per-course tone, spread across the full amplitude by construction.
   *
   * The same `hash2` narrowing that flattened the noise fields lands here too,
   * and harder, because there are only BEDS samples for it to be unlucky on.
   * Hashing the bed index directly returned 0.47 and 0.49 for the two courses -
   * a spread of two hundredths where the coefficient asks for seventeen - so
   * both courses came out the same value and the bedding read as a pair of
   * ruled lines on one flat stone rather than as stones.
   *
   * Ranking the raw hashes and spacing the ranks evenly gives a guaranteed
   * spread for any BEDS and any seed, while keeping WHICH course is light and
   * which is dark deterministic off the hash. That is the property that
   * actually mattered; the magnitude never should have been left to it.
   */
  const bedTones = (() => {
    const raw = [];
    for (let i = 0; i < BEDS; i++) raw.push({ i, h: hash2(i * 17 + 3, i * 29 + 11, 7) });
    const order = raw.slice().sort((a, b) => a.h - b.h);
    const out = new Float32Array(BEDS);
    order.forEach((e, rank) => {
      out[e.i] = (BEDS === 1 ? 0 : rank / (BEDS - 1) - 0.5) * 0.17;
    });
    return out;
  })();

  for (let y = 0; y < size; y++) {
    const v = y / size;
    const f = v * BEDS;
    const bed = Math.floor(f) % BEDS;
    const inBed = f - Math.floor(f);

    const bedTone = bedTones[bed];

    // The joint: a dark recess about 4 cm wide with a lighter weathered lip on
    // the course below it. The lip is what makes a joint read as two stones
    // rather than as a line ruled across one, and it survives flat lighting
    // because it is in the albedo rather than left to a grazing lamp.
    const edge = Math.min(inBed, 1 - inBed);
    const seam = 1 - smoothstep(Math.min(edge / 0.020, 1));
    const lipT = Math.min(Math.max(inBed - 0.020, 0) / 0.030, 1);
    const lip = smoothstep(lipT) *
      (1 - smoothstep(Math.min(Math.max(inBed - 0.060, 0) / 0.070, 1)));

    for (let x = 0; x < size; x++) {
      const u = x / size;

      // Three renormalised fields, reused for five purposes. Period is in cells
      // per tile, so period 2 is a 2.15 m feature and period 16 - the finest
      // octave present anywhere in here - is 27 cm.
      const idx = y * size + x;
      const nDrift = fDrift[idx];
      const nGrain = fGrain[idx];
      const nMineral = fMineral[idx];
      const nFine = fFine[idx];

      // Chipping. Only the top eighth of the field counts and it goes one way
      // only - stone comes off a face, it does not grow back - so these are
      // pits rather than a bidirectional wobble.
      const pit = Math.max(0, fPit[idx] - 0.86) * 7.0;

      // Chisel work: three beating frequencies, phase-wandered hard by the
      // drift field so the bands bend across the face, and MASKED so a third of
      // the surface carries no tooling at all. Both matter. Without the wander
      // the bands are dead straight; without the mask they cover every square
      // centimetre evenly, and a face that is uniformly tooled is a machined
      // face. Nobody dresses four metres of granite to one standard.
      // The LEAN flips on the drift field, which gives large contiguous regions
      // dressed one way and the rest the other, with the boundary falling on a
      // metre-scale contour. That is what a real dressed face looks like -
      // a mason works a patch, moves his feet, and the draft direction changes -
      // and it is the single thing that stops parallel tooling reading as
      // brushed metal, which is where the first cut of this ended up.
      const lean = nDrift > 0.5 ? 1 : -1;
      const wander = (nDrift - 0.5) * 7.0;
      let chisel = 0;
      for (const [cu, cv, amp] of CHISEL) {
        chisel += Math.sin((u * cu + lean * v * cv) * TAU + wander) * amp;
      }
      // A FLOOR under the mask, not a plain 0..1. With the mask running all the
      // way to zero the untooled regions came back as large smooth patches, and
      // a large smooth patch on a stone slab is the poured-concrete read this
      // whole job exists to remove - arrived at from the opposite direction, but
      // the same picture. 0.34 is enough tooling that no part of the face is
      // ever blank, and the remaining 0.66 keeps the worked and unworked areas
      // properly different from each other.
      const worked = 0.34 + 0.66 *
        smoothstep(Math.min(Math.max((nMineral - 0.28) / 0.34, 0), 1));

      const t = 0.50
        + bedTone
        + (nDrift - 0.5) * 0.40
        + (nGrain - 0.5) * 0.13
        + (nFine - 0.5) * 0.13
        + chisel * 0.034 * worked
        - seam * 0.24
        + lip * 0.07
        - pit * 0.10;

      const k = t < 0 ? 0 : t > 1 ? 1 : t;

      // Faintly cool, and the size of "faintly" is the whole argument.
      //
      // Blue leads red by three parts in 255 at the bottom of the ramp and nine
      // at the top. The two colours this replaces led by thirty and by twenty-
      // three, which is a blue-grey object, and rendered as an unrelated
      // material bolted into a sandstone wall that went navy wherever the sun
      // left it. A neutral albedo is not the answer either: everything lighting
      // this scene is warm, and a truly neutral slab came back tan and read as
      // suede. Three parts is what lands grey under this sun and stays stone in
      // the shadow, which is where the player is standing when they buy it.
      //
      // The ramp is wide (65 to 205) because this slab stands in a reveal
      // between two piers and is in the sun's shadow from every position the
      // player reads it from. A surface the light will not model has to carry
      // its own form in the albedo or it is a flat grey rectangle, which is
      // most of what "it does not read as dressed stone" has always meant here.
      let r = 65 + k * 133;
      let g = 66 + k * 136;
      let b = 68 + k * 142;

      // Feldspar. Only the upper tail of the field counts, so this is patches
      // in a matrix rather than a wash over everything, and it lifts red and
      // green far more than blue.
      const felds = Math.max(0, nMineral - 0.62) * 2.6;
      r += felds * 22;
      g += felds * 17;
      b += felds * 7;

      const i = (y * size + x) * 4;
      d[i]     = r > 255 ? 255 : r;
      d[i + 1] = g > 255 ? 255 : g;
      d[i + 2] = b > 255 ? 255 : b;
      d[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return c;
}

/** Hammered gold leaf. Bright, warm, with tooling marks. */
function paintGold(size = 256) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const d = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // Overlapping dimples read as hammered metal.
      const dimple = Math.sin(u * 48 + fbm(u, v, 2, 6, 5) * 8) *
                     Math.sin(v * 48 + fbm(u, v, 2, 6, 9) * 8);
      const t = dimple * 0.5 + 0.5;

      const i = (y * size + x) * 4;
      d[i]     = 206 + t * 46;
      d[i + 1] = 158 + t * 56;
      d[i + 2] =  62 + t * 48;
      d[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

let cache = null;

/**
 * Build every texture set once and hand back the registry.
 * Called at boot; subsequent calls return the cached result.
 */
export function buildTextures() {
  if (cache) return cache;

  const sand = paintSand(512);
  const block = paintMasonry(512, { rows: 6, seed: 3 });
  const carved = paintMasonry(512, { rows: 5, seed: 11, hieroglyphs: true });
  const granite = paintGranite(512);
  const doorstone = paintDoorstone(512);
  const gold = paintGold(256);

  // Every repeat stays at 1. Texel density is baked into each geometry's UVs
  // by world/uv.js instead, so one shared material tiles correctly on a 2-unit
  // rubble chunk and a 100-unit wall alike without cloning the material.
  cache = {
    sand: materialMaps(sand, { normalStrength: 1.6, rough: [0.78, 0.98] }),
    block: materialMaps(block, { normalStrength: 3.0, rough: [0.62, 0.94] }),
    carved: materialMaps(carved, { normalStrength: 3.6, rough: [0.58, 0.92] }),
    // ROUGHNESS FLOOR RAISED FROM 0.22, AND THAT NUMBER WAS A BUG WITH A LIGHT
    // ATTACHED TO IT. At 0.22 the slab is a near-mirror, and the sun's specular
    // lobe off it is the "blown highlight washing out the right third of the
    // gate" the owner reported. Knocked out on a frozen frame at the reproducing
    // pose, whole-frame mean luminance:
    //
    //     shipped                        120
    //     bloom disabled                  78     <- bloom was 42 of 120
    //     sun disabled                    38     <- and the sun is its source
    //
    // The band around the door measured 108 with bloom and 38 without, so two
    // thirds of that surface was glow rather than surface. The fix is here and
    // in the material, NOT in the bloom pass: the same judge that reported this
    // called the braziers the best local lighting in either build, and raising
    // the bloom threshold to fix a mirror would flatten them.
    //
    // 0.50-0.80 is dressed granite. Polished granite exists, but a sealed tomb
    // door that has stood in a sandstorm for three thousand years is not it.
    granite: materialMaps(granite, { normalStrength: 1.7, rough: [0.50, 0.80] }),

    // The door slab, and the ONLY set in here that is not overwritten by a scan
    // at boot. See paintDoorstone: the scans available to this project are a
    // polished worktop and a cliff ledge, and this object is neither.
    //
    // normalStrength 2.2, up from granite's 1.7, because the whole relief in
    // this map is a 15 cm chisel at 4.6% albedo contrast and a 4 cm joint. At
    // 1.7 the tool marks are present in the albedo and invisible in the
    // lighting, which is the same failure as an unread chamfer: paid for, and
    // never drawn.
    //
    // ROUGHNESS 0.62-0.86, tighter and rougher than granite's 0.50-0.80. This
    // slab is the one four-metre flat facing the sun square-on, and the blown
    // highlight the owner reported at the right of the gate is a specular lobe
    // off exactly this surface. 0.50 leaves a lobe on a face that size; 0.62
    // does not, and 0.86 at the dark end keeps the shadowed reveals from
    // turning glassy where the world-space grime term pushes roughness up.
    doorstone: materialMaps(doorstone, { normalStrength: 2.2, rough: [0.62, 0.86] }),

    gold: materialMaps(gold, { normalStrength: 1.0, rough: [0.12, 0.34] }),
  };

  return cache;
}

export const _internals = { fbm, valueNoise, normalFromCanvas, paintMasonry };
