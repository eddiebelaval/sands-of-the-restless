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

/** Polished granite: dark, speckled, low roughness. */
function paintGranite(size = 512) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const d = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const mottle = fbm(u, v, 4, 6, 71);
      const fleck = hash2(x, y, 97) > 0.986 ? 0.5 : 0;
      const t = mottle * 0.5 + fleck;

      const i = (y * size + x) * 4;
      d[i]     = 44 + t * 90;
      d[i + 1] = 38 + t * 78;
      d[i + 2] = 40 + t * 84;
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
  const gold = paintGold(256);

  // Every repeat stays at 1. Texel density is baked into each geometry's UVs
  // by world/uv.js instead, so one shared material tiles correctly on a 2-unit
  // rubble chunk and a 100-unit wall alike without cloning the material.
  cache = {
    sand: materialMaps(sand, { normalStrength: 1.6, rough: [0.78, 0.98] }),
    block: materialMaps(block, { normalStrength: 3.0, rough: [0.62, 0.94] }),
    carved: materialMaps(carved, { normalStrength: 3.6, rough: [0.58, 0.92] }),
    granite: materialMaps(granite, { normalStrength: 1.2, rough: [0.22, 0.52] }),
    gold: materialMaps(gold, { normalStrength: 1.0, rough: [0.12, 0.34] }),
  };

  return cache;
}

export const _internals = { fbm, valueNoise, normalFromCanvas, paintMasonry };
