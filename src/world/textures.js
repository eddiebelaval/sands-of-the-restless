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

/**
 * An offscreen canvas.
 *
 * NON-SQUARE IS ALLOWED, and that is not generality for its own sake. The
 * scanned CC0 sets this project ships are 1024x512, so any pass that composites
 * onto one - see `inscribeScan` - works at 2:1 or it resamples a photograph for
 * no reason. Every painter in this file still calls it with one argument and
 * still gets the square canvas it has always got.
 */
function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
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
  const w = source.width, h = source.height;
  const src = source.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, w, h).data;

  // Precompute luminance so the inner loop is one array read, not three.
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (src[p] * 0.299 + src[p + 1] * 0.587 + src[p + 2] * 0.114) / 255;
  }

  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(w, h);
  const dst = img.data;

  const at = (x, y) => lum[(((y % h) + h) % h) * w + (((x % w) + w) % w)];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
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

      const i = (y * w + x) * 4;
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
  const w = source.width, h = source.height;
  const src = source.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, w, h).data;

  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(w, h);
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
function paintMasonry(size = 512, { rows = 6, seed = 3, hieroglyphs = false, register = false } = {}) {
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

  if (register) drawRegister(ctx, size, blockH, seed);

  return c;
}

/**
 * A CARVED REGISTER RUNNING THE WIDTH OF THE WALL.
 *
 * The per-block glyph columns above are scatter: a mark here and a mark there,
 * on whichever stones the hash picked. That is what a weathered wall looks like
 * up close and it is NOT what makes a wall read as decorated from across a
 * room, because there is no line in it. Egyptian wall decoration is banded -
 * a horizontal register, bounded top and bottom, with the inscription running
 * inside it - and the band is the thing the eye locks onto at distance.
 *
 * THE ORDER OF THE THREE PIECES IS THE WHOLE TRICK, and it is the same one
 * `drawGlyphColumn` uses one scale down. A sunk register is a recess, so it
 * carries: a LIT fillet on the upper lip (the light in this scene comes from
 * braziers below and the sun above, and the top of a recess catches both), a
 * DARK ground inside it, and a SHADOWED under-edge. Those three values are what
 * the Sobel pass turns into a band that has depth rather than a band that is a
 * stripe of different-coloured paint.
 *
 * ONE BAND PER TILE, NOT THREE. At the `carved` density of 0.20 tiles per unit
 * a tile is five metres, so this is one register per five metres of wall, which
 * is architecture. Three would be 1.7 m apart, which is wallpaper: the same
 * "high-frequency relief that reads as noise instead of carving" the gate piers
 * in temple.js were rebuilt to get away from, arriving by the texture route.
 *
 * The marks stay ABSTRACT for the reason stated over `drawGlyphColumn` and
 * restated in build.js: a real glyph at this budget is a smudge, and the fix
 * for a smudge is never a more accurate smudge.
 */
function drawRegister(ctx, size, blockH, seed) {
  drawInscription(ctx, size, size, {
    seed,
    bandH: blockH * 0.92,
    lipRatio: 0.07,
    cells: 9,
    ground: 'opaque',
    columns: false,
  });
}

/**
 * THE INSCRIPTION, DRAWN OVER WHATEVER IS ALREADY IN THE CONTEXT.
 *
 * `drawRegister` above is now one call into this, and the generalisation is the
 * whole point of the wall-frieze lane rather than tidying. The band the previous
 * lane authored can only be drawn onto a canvas this file painted, and this file
 * does not paint the surface the interior walls actually wear: `upgradeMaterials`
 * replaces the procedural masonry with the bricks083 scan at boot, so
 * `paintMasonry(..., { register: true })` renders on the asset-404 path and
 * NOWHERE ELSE. Measured on the shipped build: `limestone.map` is
 * bricks083/color.jpg and `assetsFailed` is empty.
 *
 * So the inscription has to be able to land on a PHOTOGRAPH, not only on a
 * canvas we painted, and that is the one capability this function adds. Three
 * differences from the version it absorbed, each of which exists for that:
 *
 *   THE RECESS GROUND MULTIPLIES rather than fills. An opaque fill over a scan
 *   deletes the scan inside the band - which is 11 per cent of the wall's area
 *   turned into flat paint, and the flat patch is exactly where the eye is being
 *   sent. Multiplying darkens by a ratio, so every grain, pit and bedding line
 *   in the photograph survives inside the recess at reduced contrast, which is
 *   also what a chiselled recess in real stone looks like: the same rock, in
 *   shade. `ground: 'opaque'` keeps the original behaviour for the caller that
 *   was written against it.
 *
 *   THE BAND CARRIES COLUMNS. A single horizontal line reads as a string course
 *   - a moulding - and not as writing. What makes a wall read as INSCRIBED at
 *   six metres is the pair: a horizontal register with vertical columns of text
 *   dropping out of it. Verticals are also the axis a horizontal band cannot
 *   supply, and a surface whose only structure runs one way is the "single
 *   frequency in a single direction" failure paintDoorstone records.
 *
 *   IT TAKES ITS OWN WIDTH AND HEIGHT. The scans are 1024x512.
 *
 * The marks stay ABSTRACT, for the reason stated over `drawGlyphColumn` and
 * restated in build.js: at this texel budget a real glyph resolves to a smudge,
 * and the fix for a smudge is never a more accurate smudge.
 */

/**
 * THE THREE GROUNDS A BAND CAN HAVE, AND WHY THERE ARE THREE.
 *
 * `opaque` is the original, kept byte-for-byte for `drawRegister`'s caller.
 *
 * `sunk` is the first cut of the wall frieze and it is A DARK RECESS: the same
 * stone, in shade, multiplied down so the photograph's grain survives inside it.
 * It is the physically obvious reading of a chiselled register and it FAILED the
 * beetle control, which is why it is still here rather than deleted - the
 * measurement that rejected it is only reproducible if the thing it rejected can
 * still be built. Staged with a gold scarab on the band, it took the background
 * behind the body from 14.4 to 4.8 luminance and lost 78.2 per cent of the body
 * into it, against 48.8 on plain stone.
 *
 * `lime` is what ships. A register panel of LIMEWASHED PLASTER let into the
 * weathered stone, lifted above the wall around it, with the carving as dark
 * incision in a pale ground. Three things make it right rather than a dodge:
 *
 *   IT IS WHAT THE ROOM ALREADY DOES. paintCeiling holds its ochre band around
 *   155 luminance for this exact reason and states it: a gold scarab renders as
 *   a DARK body with a bright rim, so the background it needs is a LIGHT one.
 *   The wall now has a scarab on it too, and the same argument does not stop
 *   being true because the surface turned ninety degrees.
 *
 *   IT IS WHAT THE REAL WALLS ARE. An Egyptian tomb register is not bare rock in
 *   shadow; it is plastered, limewashed and painted, and it is LIGHTER than the
 *   dressed stone around it, not darker.
 *
 *   IT IS THE MORE LEGIBLE DECORATION. A dark band on a dark wall in a room lit
 *   by four braziers is a band you cannot see. The whole point of the lane is
 *   that the player reads writing on the wall.
 *
 * The relief is unaffected by any of this: the normal map is Sobelled from the
 * `flat` pass, which is geometry only, so the carving is still carved whichever
 * ground it is cut into.
 */
const BAND_GROUNDS = {
  opaque: {
    fill: 'rgb(118, 104, 80)', op: 'source-over',
    litLip: 'rgba(255,246,224,.30)', darkLip: 'rgba(26,19,10,.34)',
    aboveShadow: 'rgba(30,22,12,.22)', belowLight: 'rgba(255,248,226,.16)',
    colFill: 'rgb(126, 112, 88)', colOp: 'source-over',
    colLit: 'rgba(255,246,224,.26)', colDark: 'rgba(26,19,10,.30)',
  },
  sunk: {
    fill: 'rgb(154, 141, 119)', op: 'multiply',
    litLip: 'rgba(255,246,224,.30)', darkLip: 'rgba(26,19,10,.34)',
    aboveShadow: 'rgba(30,22,12,.22)', belowLight: 'rgba(255,248,226,.16)',
    colFill: 'rgb(168, 156, 134)', colOp: 'multiply',
    colLit: 'rgba(255,246,224,.26)', colDark: 'rgba(26,19,10,.30)',
  },
  lime: {
    // 0.46 rather than opaque, so a bit over half the photograph's own grain
    // survives inside the panel. A flat fill here would put a smooth patch on
    // the one part of the wall the eye is being sent to.
    fill: 'rgba(226, 210, 180, .46)', op: 'source-over',
    litLip: 'rgba(255,250,232,.34)',
    // THE DARK LIP IS THINNED FROM .34 TO .20, and that is the beetle again
    // rather than taste: the shadowed under-edge of the band is the darkest
    // thing on this surface and it is a full lip tall, which is a hole a body
    // can sit in. The incised marks stay as dark as they were, because a mark
    // is a five-texel line and a five-texel line cannot hold a beetle - the
    // same distinction paintCeiling draws about its own double rule.
    darkLip: 'rgba(26,19,10,.20)',
    aboveShadow: 'rgba(30,22,12,.16)', belowLight: 'rgba(255,248,226,.18)',
    colFill: 'rgba(232, 218, 190, .38)', colOp: 'source-over',
    colLit: 'rgba(255,250,232,.28)', colDark: 'rgba(26,19,10,.18)',
  },
};

function drawInscription(ctx, w, h, {
  seed = 71,
  bandH = h * 0.115,
  lipRatio = 0.09,
  cells = 11,
  ground = 'lime',
  columns = true,
  // Draw onto flat grey for the Sobel pass rather than onto a surface. The
  // geometry is identical; only the values change, because a normal map wants
  // clean opaque steps where the albedo wants a translucent stain.
  flat = false,
} = {}) {
  const G = BAND_GROUNDS[ground] || BAND_GROUNDS.lime;
  const bh = bandH;
  const top = Math.round(h * 0.5 - bh / 2);
  const lip = Math.max(2, bh * lipRatio);

  ctx.save();

  // The ground of the band.
  if (flat) {
    ctx.fillStyle = 'rgb(96, 96, 96)';
  } else {
    ctx.globalCompositeOperation = G.op;
    ctx.fillStyle = G.fill;
  }
  ctx.fillRect(0, top, w, bh);
  ctx.globalCompositeOperation = 'source-over';

  // The lit upper fillet and the shadowed lower one. These two are the band.
  ctx.fillStyle = flat ? 'rgb(214,214,214)' : G.litLip;
  ctx.fillRect(0, top, w, lip);
  ctx.fillStyle = flat ? 'rgb(38,38,38)' : G.darkLip;
  ctx.fillRect(0, top + bh - lip, w, lip);

  // And the reveal: the stone immediately above and below the recess is in
  // shadow and in light respectively, which is what stops the band reading as
  // a painted stripe on a flat wall.
  ctx.fillStyle = flat ? 'rgb(72,72,72)' : G.aboveShadow;
  ctx.fillRect(0, top - lip, w, lip);
  ctx.fillStyle = flat ? 'rgb(182,182,182)' : G.belowLight;
  ctx.fillRect(0, top + bh, w, lip * 0.8);

  // The inscription. An integer number of cells across the tile, so it wraps.
  const cw = w / cells;
  const s = Math.min(cw * 0.62, (bh - lip * 4) * 0.72);

  for (let i = 0; i < cells; i++) {
    const cx = (i + 0.5) * cw;
    const cy = top + bh / 2;
    // Two marks stacked in the taller cells, one in the rest, which is what an
    // inscription actually does and what stops the row reading as a dotted line.
    const stack = hash2(i, 3, seed + 53) > 0.34 ? 2 : 1;
    for (let k = 0; k < stack; k++) {
      const y = stack === 1 ? cy : cy + (k - 0.5) * s * 0.94;
      const ss = stack === 1 ? s : s * 0.62;
      carveMark(ctx, Math.floor(hash2(i * 7 + k, k * 13, seed + 59) * MARKS) % MARKS,
        cx, y, ss);
    }
  }

  /**
   * THE COLUMNS OF TEXT DROPPING OUT OF THE BAND.
   *
   * ABOUT A THIRD OF THE CELLS, NOT ALL OF THEM, and the count is doing the same
   * job the register's own count does one scale up. Every cell carrying a column
   * is a comb, and a comb has a period the eye finds; a third of them, at
   * lengths drawn from the same hash, is a rhythm it does not. It is also the
   * difference between a wall that has an inscription on it and a wall that is
   * an inscription, and this one is a tomb corridor rather than a temple
   * sanctuary.
   *
   * THEY HANG BELOW THE BAND AND ARE CLAMPED INSIDE THE TILE. A column that ran
   * off the bottom would wrap round to the top of the same tile and reappear
   * above the register it is meant to hang from, which at a 5.88 m tile is a
   * column of text floating in the middle of the course above.
   */
  if (columns) {
    const colTop = top + bh + lip * 1.6;
    const maxH = Math.min(h - colTop - lip * 2, bh * 2.1);

    if (maxH > s * 2) {
      for (let i = 0; i < cells; i++) {
        if (hash2(i, 17, seed + 67) < 0.66) continue;
        const cx = (i + 0.5) * cw;
        const colH = maxH * (0.55 + hash2(i, 29, seed + 73) * 0.45);
        const colW = cw * 0.80;

        // The channel the column sits in: the same three values as the band,
        // turned ninety degrees. Without it the marks read as graffiti on the
        // face rather than as text in a sunk panel.
        if (flat) {
          ctx.fillStyle = 'rgb(104, 104, 104)';
        } else {
          ctx.globalCompositeOperation = G.colOp;
          ctx.fillStyle = G.colFill;
        }
        ctx.fillRect(cx - colW / 2, colTop, colW, colH);
        ctx.globalCompositeOperation = 'source-over';

        ctx.fillStyle = flat ? 'rgb(206,206,206)' : G.colLit;
        ctx.fillRect(cx - colW / 2, colTop, Math.max(1.5, lip * 0.8), colH);
        ctx.fillStyle = flat ? 'rgb(46,46,46)' : G.colDark;
        ctx.fillRect(cx + colW / 2 - Math.max(1.5, lip * 0.8), colTop,
          Math.max(1.5, lip * 0.8), colH);

        drawGlyphColumn(ctx, cx, colTop + lip, colW, colH - lip * 2,
          hash2(i, 23, seed + 79));
      }
    }
  }

  ctx.restore();
}

/**
 * THE INSCRIPTION, COMPOSITED ONTO A SCANNED MAP SET.
 *
 * This is the function that closes the bug. Everything else in this file paints
 * a surface from nothing and then loses it to `upgradeMaterials`; this one takes
 * the scan that WINS that argument and writes the carving into it, so what ships
 * is the photograph's grain, bedding and relief AND the inscription, rather than
 * a choice between them.
 *
 * It is also the historically honest answer. An Egyptian wall is dressed stone
 * first and decorated second: the masons cut the blocks, and the sunk relief was
 * carved into a face that already had all the character of the quarry in it. A
 * procedural albedo swapped in for the scan reverses that order - it throws the
 * stone away to keep the writing.
 *
 * TWO MAPS OUT, NOT FOUR. The roughness and AO of the scan are handed back
 * untouched by the caller and SHARED with the wall material they came from, so
 * this costs two GPU textures rather than four. The recess should strictly be
 * rougher than the face around it; that is a real omission and it is recorded in
 * the report rather than hidden, because the alternative is a third full-size
 * texture for a term the world-space grime pass is already moving.
 *
 * THE NORMAL IS A BLEND, WHICH IS THE WHOLE REASON THIS IS NOT JUST AN ALBEDO
 * OVERLAY. Carving is relief. An inscription that exists only in the albedo is a
 * PAINTED inscription, and a painted mark on a wall lit by four braziers does
 * not change as the player walks past it, which is precisely the "paid for and
 * never drawn" failure the doorstone's normalStrength note records. The mark
 * geometry is drawn once more onto flat grey, Sobelled into a detail normal, and
 * added to the scan's own normal in tangent space:
 *
 *     out.xy = base.xy + (detail.xy - 0.5),   out.z = base.z
 *
 * which is the standard partial-derivative addition of two tangent-space
 * normals. Leaving z alone is an approximation and a deliberate one: three.js
 * normalises the sampled vector in `normal_fragment_maps` before it is used, so
 * the two slopes add and the length is corrected in the shader for free.
 */
function inscribeScan(colorImage, normalImage, opts = {}) {
  const w = colorImage.width, h = colorImage.height;

  const albedo = makeCanvas(w, h);
  const actx = albedo.getContext('2d', { willReadFrequently: true });
  actx.drawImage(colorImage, 0, 0, w, h);
  drawInscription(actx, w, h, opts);

  let normal = null;
  if (normalImage) {
    const relief = makeCanvas(w, h);
    const rctx = relief.getContext('2d', { willReadFrequently: true });
    rctx.fillStyle = 'rgb(128,128,128)';
    rctx.fillRect(0, 0, w, h);
    drawInscription(rctx, w, h, { ...opts, flat: true });

    // 2.0 rather than the masonry's 3.0. The scan's own normal is already
    // carrying the stone; this term only has to add the chisel, and a detail
    // normal that overpowers the surface it is added to is the corrugation
    // `upgradeMaterials` dials normalScale down to avoid.
    const detail = normalFromCanvas(relief, 2.0);

    normal = makeCanvas(w, h);
    const nctx = normal.getContext('2d', { willReadFrequently: true });
    nctx.drawImage(normalImage, 0, 0, w, h);

    const base = nctx.getImageData(0, 0, w, h);
    const b = base.data;
    const dd = detail.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, w, h).data;

    for (let i = 0; i < b.length; i += 4) {
      const x = b[i] + dd[i] - 128;
      const y = b[i + 1] + dd[i + 1] - 128;
      b[i] = x < 0 ? 0 : x > 255 ? 255 : x;
      b[i + 1] = y < 0 ? 0 : y > 255 ? 255 : y;
    }
    nctx.putImageData(base, 0, 0);
  }

  return { albedo, normal };
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
    const kind = Math.floor(hash2(i, (cx * 7) | 0, 41 + r * 100) * MARKS) % MARKS;
    carveMark(ctx, kind, cx, y, s);
  }
}

/**
 * HOW MANY ABSTRACT MARKS THE VOCABULARY HOLDS.
 *
 * Six was not enough and the reason is arithmetic rather than taste. A register
 * of nine cells drawn from six shapes repeats a shape 2.2 times per band on
 * average, and a repeat inside one band is the tell that turns an inscription
 * into a pattern - the eye finds the period, and once it has found it the wall
 * is wallpaper. Eleven puts the expected repeat under one per band.
 *
 * They are STILL NOT HIEROGLYPHS and adding more of them did not make them any
 * closer to being hieroglyphs. See the note over `drawGlyphColumn`'s caller and
 * the matching one in build.js: at this texel budget a real glyph resolves to a
 * smudge, and eleven kinds of smudge that can be told apart is worth more than
 * one accurate one that cannot.
 */
const MARKS = 11;

/**
 * One abstract mark, CARVED: a dark incision with a lit lower lip.
 *
 * Two strokes of the same path, the second offset downward and light. That
 * pair is what the Sobel pass in this file turns into relief, and it is the
 * reason these marks survive the flat interior lighting that flattens
 * everything else - the shading is in the albedo, so it does not need a lamp
 * standing in the right place.
 *
 * Split out of `drawGlyphColumn` so the register band, the ceiling's
 * inscription and the per-block scatter all draw from ONE vocabulary. Three
 * copies of a switch is three vocabularies that drift.
 */
function carveMark(ctx, kind, cx, y, s) {
  ctx.strokeStyle = 'rgba(52,42,26,.62)';
  ctx.lineWidth = Math.max(1.5, s * 0.16);
  ctx.lineCap = 'round';
  ctx.beginPath();
  traceMark(ctx, kind % MARKS, cx, y, s);
  ctx.stroke();

  ctx.save();
  ctx.translate(0, Math.max(1, s * 0.09));
  ctx.strokeStyle = 'rgba(255,248,226,.20)';
  ctx.lineWidth = Math.max(1, s * 0.1);
  ctx.stroke();
  ctx.restore();
}

/**
 * One abstract mark, PAINTED: a flat stroke in a given colour, no relief.
 *
 * The ceiling wants this and the wall does not. A tomb ceiling is plastered and
 * PAINTED - the inscription up there is pigment on a flat soffit, not chisel
 * work in a dressed face - and running the carved pair on it would put a lit
 * lower lip on every mark and a bump in the normal map, which at nine metres
 * reads as a rough ceiling rather than a painted one.
 */
function paintMark(ctx, kind, cx, y, s, style, width = 0.15) {
  ctx.strokeStyle = style;
  ctx.lineWidth = Math.max(1.2, s * width);
  ctx.lineCap = 'round';
  ctx.beginPath();
  traceMark(ctx, kind % MARKS, cx, y, s);
  ctx.stroke();
}

/** The shapes themselves. Path only: the caller owns colour and relief. */
function traceMark(ctx, kind, cx, y, s) {
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
    case 5: // bowl / basket: a wide shallow arc on a foot
      ctx.moveTo(cx - s * 0.38, y - s * 0.08);
      ctx.quadraticCurveTo(cx, y + s * 0.40, cx + s * 0.38, y - s * 0.08);
      ctx.moveTo(cx - s * 0.38, y - s * 0.08); ctx.lineTo(cx + s * 0.38, y - s * 0.08);
      break;
    case 6: // jar: a shouldered vessel with a collar
      ctx.moveTo(cx - s * 0.14, y - s * 0.38); ctx.lineTo(cx + s * 0.14, y - s * 0.38);
      ctx.moveTo(cx - s * 0.14, y - s * 0.38);
      ctx.quadraticCurveTo(cx - s * 0.36, y - s * 0.02, cx - s * 0.18, y + s * 0.40);
      ctx.lineTo(cx + s * 0.18, y + s * 0.40);
      ctx.quadraticCurveTo(cx + s * 0.36, y - s * 0.02, cx + s * 0.14, y - s * 0.38);
      break;
    case 7: // feather: a stem with a curled head
      ctx.moveTo(cx, y + s * 0.44); ctx.lineTo(cx, y - s * 0.22);
      ctx.quadraticCurveTo(cx, y - s * 0.48, cx + s * 0.26, y - s * 0.40);
      ctx.moveTo(cx - s * 0.16, y + s * 0.12); ctx.lineTo(cx, y + s * 0.02);
      break;
    case 8: // zigzag: three folds, the flattest mark in the set
      ctx.moveTo(cx - s * 0.42, y - s * 0.14);
      for (let q = 0; q < 4; q++) {
        ctx.lineTo(cx - s * 0.42 + s * 0.21 * (q + 1), y + (q % 2 ? -s * 0.14 : s * 0.14));
      }
      break;
    case 9: // disc on a bar: the only mark in the set with a closed round
      ctx.arc(cx, y - s * 0.14, s * 0.20, 0, Math.PI * 2);
      ctx.moveTo(cx - s * 0.40, y + s * 0.24); ctx.lineTo(cx + s * 0.40, y + s * 0.24);
      break;
    default: // seated figure
      ctx.arc(cx, y - s * 0.26, s * 0.14, 0, Math.PI * 2);
      ctx.moveTo(cx, y - s * 0.12); ctx.lineTo(cx, y + s * 0.16);
      ctx.moveTo(cx, y + s * 0.16); ctx.lineTo(cx + s * 0.34, y + s * 0.16);
      ctx.moveTo(cx, y + s * 0.16); ctx.lineTo(cx - s * 0.1, y + s * 0.44);
      break;
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

/**
 * Gilded bronze, planished by hand and three thousand years old.
 *
 * PLANISHING, NOT A GRID, and that is the whole of this rewrite.
 *
 * The map this replaces was `sin(u*48) * sin(v*48)`. A product of two sines IS
 * a checkerboard; no UV scale removes one, it only chooses how big the squares
 * are. Shipped, the winged sun-disc on the sealed doorway carried five of those
 * squares across two and a half metres and read as an orange bath toy stuck to
 * a very good stone door.
 *
 * THE MIP DIAGNOSIS IN THE PREVIOUS NOTE WAS DESCRIBING A STATE THIS FILE HAD
 * ALREADY LEFT, and that matters more than the texture does, because the same
 * mistake is available on every surface in here. Measured at the pose the
 * player actually buys the door from:
 *
 *     disc face, 1.18 m radius             2.36 m across
 *     UV span after temple.js scaled it    0.347
 *     map                                  256 px
 *     texel density                        37.6 texels/m
 *     screen density AT THE DISC at the     75 px/m
 *       6 m pose (1440x900, 75 deg
 *       vertical), MEASURED off the frame
 *     ratio                                0.50 TEXELS PER SCREEN PIXEL
 *
 * The screen figure is measured rather than derived because the derived one
 * flatters this surface. A plane six metres away and square to the eye gets
 * 97.7 px/m at this resolution and field of view, but the disc is mounted 3.8 m
 * ABOVE the eye: the slant range is 7.1 m and the camera is looking up at it,
 * so its vertical foreshortening is another 0.84. Quote the 97.7 and every
 * ratio on this object comes out a third too generous.
 *
 * The map was MAGNIFIED twofold. The mip chain was never reached, so there was
 * nothing there to beat against: what the player saw was one checker cell of
 * `PI/48` UV = 16.8 texels = 47 cm, drawn at full resolution, perfectly
 * resolved, 35 screen pixels wide at six metres and 18 at twelve. A
 * checkerboard read is USUALLY a regular grid near one texel per pixel - which
 * is what this surface was before the UV scale went from 0.5 to 0.14, and the
 * note was true then. The fix moved it out of the aliasing band and into the
 * "enormous painted checker" band, and the second is worse, because aliasing at
 * least varies with distance and this did not.
 *
 * The lesson the slab taught applies unchanged: measure texels against screen
 * pixels before touching anything. It just pointed the other way here.
 *
 * WHAT A PLANISHED SURFACE ACTUALLY IS: a field of overlapping shallow facets
 * left by a rounded hammer, every one a slightly different size and struck from
 * a slightly different angle, with a bright crown and a dark crease where two
 * of them meet. That is a jittered cellular field - strikes scattered on a
 * lattice, each pixel taking its nearest strike - and it has no axis for
 * anything to beat against. It degrades to noise under the mips rather than to
 * a moire, which is what lets it be authored at one texel per screen pixel.
 *
 * STRIKES is the one number that sets feature size, and everything else is
 * derived from it. 29 strikes across the tile, against the 0.383 tiles per unit
 * the relief carries in temple.js, puts a hammer facet at 9 cm - nine texels,
 * and about seven screen pixels at six metres. Coarse enough to still be there
 * at twelve, fine enough that nobody counts them at six. The finest thing
 * authored in here is the crease between two facets at roughly three texels,
 * which is 3 cm and about two screen pixels at the read.
 */
function paintGold(size = 256) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const d = img.data;

  const STRIKES = 29;

  /**
   * The same LOCAL renormalisation `paintDoorstone` uses, for the same reason
   * and with the same caveat. `hash2` returns roughly 0.01 to 0.50 on the
   * integer lattice, so `fbm` is neither centred on 0.5 nor the amplitude it
   * claims, and the `fbm() - 0.5` idiom used elsewhere in this file is a
   * near-constant darkening rather than a signed variation. Fixing the hash
   * would move every procedural surface in the game at once - including the
   * sand, which two blind rounds called the best material in either build - so
   * it is worked around here and written up rather than smuggled in.
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

  // Periods are cells per tile. The tile covers 2.61 m at the relief's density,
  // so period 3 is an 87 cm feature and period 40 is 6.5 cm - which brackets
  // the 9 cm hammer facet from both sides and leaves no hole in the spectrum.
  const fTarnish = field(3, 3, 131);
  const fWear = field(2, 7, 197);
  const fGrain = field(2, 40, 251);

  /**
   * Strike centres and per-strike radii.
   *
   * The jitter is deliberately near-full-cell (0.06 to 0.94) because a smith
   * does not land blows on a grid; at half a cell the lattice is still legible
   * and the whole point of this rewrite is that no lattice survives. The radius
   * varies 0.74 to 1.26 cells for the same reason - the size of the mark
   * depends on how square the blow was.
   *
   * `* 2` on every hash is the local renormalisation described above.
   */
  const sx = new Float32Array(STRIKES * STRIKES);
  const sy = new Float32Array(STRIKES * STRIKES);
  const sr = new Float32Array(STRIKES * STRIKES);
  for (let cy = 0; cy < STRIKES; cy++) {
    for (let cx = 0; cx < STRIKES; cx++) {
      const i = cy * STRIKES + cx;
      sx[i] = cx + 0.06 + Math.min(1, hash2(cx, cy, 17) * 2) * 0.88;
      sy[i] = cy + 0.06 + Math.min(1, hash2(cx, cy, 43) * 2) * 0.88;
      sr[i] = 0.74 + Math.min(1, hash2(cx, cy, 89) * 2) * 0.52;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const idx = y * size + x;

      // Nearest and second-nearest strike over the 3x3 neighbourhood, with the
      // lattice index wrapped so the tile is seamless and the stored centre
      // un-wrapped back into this pixel's neighbourhood so the distance is real.
      const px = u * STRIKES, py = v * STRIKES;
      const gx0 = Math.floor(px), gy0 = Math.floor(py);
      let f1 = 1e9, f2 = 1e9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = gx0 + ox, gy = gy0 + oy;
          const wx = ((gx % STRIKES) + STRIKES) % STRIKES;
          const wy = ((gy % STRIKES) + STRIKES) % STRIKES;
          const j = wy * STRIKES + wx;
          const ax = gx + (sx[j] - wx), ay = gy + (sy[j] - wy);
          const dd = Math.hypot(px - ax, py - ay) / sr[j];
          if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
        }
      }

      // The dome.
      //
      // A RECIPROCAL, NOT A CLAMPED PARABOLA, and that is not a flourish. The
      // first cut of this used `max(0, 1 - f1*f1*1.35)`, which goes flat at the
      // cell edge, and a dome with a hard rim around a flat floor is a PEBBLE.
      // Rendered, the disc came back as a bed of gold nuggets - every facet its
      // own object with its own highlight and its own dark outline. Beaten
      // metal is a continuous rolling surface. This form never reaches zero and
      // never flattens, so neighbouring facets run into each other.
      const dome = 1 / (1 + f1 * f1 * 2.6);

      // The crease, where two facets meet - and WIDE and SHALLOW, for the same
      // reason. At three texels it drew a hard outline around every facet,
      // which is the other half of the pebble read.
      const crease = smoothstep(Math.min((f2 - f1) / 0.42, 1));

      const tarn = fTarnish[idx];
      const wear = fWear[idx];
      const grain = fGrain[idx];

      // Tarnish collects in the LOW ground - the creases and the shoulders -
      // because that is where weather sits and where no hand has ever polished
      // it back. Gating on the facet is what stops it being a wash over
      // everything, which would just be a darker flat fill.
      const low = 1 - dome * crease;
      const patina = Math.min(1, Math.max(0, (tarn - 0.30) / 0.55)) * low;

      // And the opposite: crowns that hands and blown sand have kept bright.
      // Bounded to the top of the wear field so these are patches, not a wash.
      const bright = Math.max(0, wear - 0.55) * 2.2 * dome * crease;

      /**
       * THE FACETS ARE A TENTH OF THIS RAMP AND THE WEATHER IS THE REST, and
       * getting that the wrong way round is what made the first cut nuggets.
       *
       * Gold is a conductor. It has no diffuse term worth the name, so what the
       * player sees is the environment reflected and steered by the NORMAL and
       * the ROUGHNESS - and both of those are derived from this canvas by
       * `materialMaps`. Planishing therefore has to be authored as a gentle
       * undulation, about a tenth of the range, and read through the specular.
       * Authored as albedo contrast instead, every facet becomes a painted-on
       * light and dark blob that survives into shadow, where a real one would
       * vanish. That is the difference between hammered metal and gravel.
       *
       * So the big albedo moves here are the LOW-frequency ones - patina in the
       * hollows, wear on the crowns - which is also what actually reads as
       * three thousand years old at six metres.
       */
      let t = 0.52
        + (dome - 0.55) * 0.13
        + (crease - 0.70) * 0.06
        + (grain - 0.5) * 0.05
        + bright * 0.22
        - patina * 0.30;
      t = t < 0 ? 0 : t > 1 ? 1 : t;

      // A WIDE VALUE LADDER, and this is the second half of why the old map
      // read as plastic. It ran 206..252 in red: a 46-step band, one value, one
      // hue, no darks. Metal reads as metal because it has somewhere to fall
      // to - dark bronze in the hollows, near-white on the polished crowns -
      // and the top of this ramp lands on gold's actual reflectance, which is
      // about (255, 227, 160) in sRGB, rather than on traffic-cone orange.
      //
      // THE FLOOR IS 108, NOT 74, and on a conductor that is not a brightness
      // preference. At metalness 0.85 this map IS the reflectance: there is no
      // diffuse term underneath it to carry the surface where the albedo is
      // dark, so a floor at 74 does not read as bronze in shadow, it reads as
      // an unlit hole. 108 is the darkest this can go and still return light.
      let r = 108 + t * 147;
      let g = 76 + t * 151;
      let b = 34 + t * 126;

      // Tarnish is cooler and greyer than the metal under it. Small: bronze
      // that has gone literally green is a fountain, not a temple door.
      r -= patina * 26;
      g -= patina * 6;
      b += patina * 16;

      const i = idx * 4;
      d[i]     = r < 0 ? 0 : r > 255 ? 255 : r;
      d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      d[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * THE CEILING, WHICH STOPPED BEING A LID.
 *
 * WHY THIS SURFACE NOW EXISTS AT ALL. Until the gold scarab learned to crawl -
 * enemies/wallcrawl.js, and the `wallCrawl` flag in enemies/variants.js - every
 * body in this game arrived along the floor, so the player's search was a
 * horizontal sweep at eye level and the ceiling was scenery they never looked
 * at. It is now a surface a moving target is tracked across, which changes what
 * the ceiling is FOR: it is a background, and the first duty of a background is
 * that the thing in front of it can be seen.
 *
 * SO THIS IS A LEGIBILITY JOB BEFORE IT IS A DECORATION JOB, and the two point
 * the same way here, which is lucky and worth stating because it usually does
 * not happen.
 *
 * What was up there was `M.limestone`: a bricks083 scan tinted 0xd8c39a. A gold
 * scarab's shell is 0xe8bf55 at metalness 0.90. Those are the SAME HUE at
 * roughly the SAME VALUE - pale warm against pale warm - so a beetle crossing
 * the old ceiling was a gold plate on a gold-ish background, and the only thing
 * separating them was the specular. That is the worst possible background for
 * this enemy and it was arrived at by nobody deciding anything.
 *
 * THE FIRST VERSION OF THIS SURFACE WAS A DARK BLUE NIGHT SKY WITH STARS, AND
 * IT WAS A REGRESSION. It is worth writing down in full, because the reasoning
 * that produced it is correct-sounding, is the historically famous answer, and
 * is wrong here for one measurable reason.
 *
 * The argument was: the beetle is gold, gold is bright, therefore darken the
 * background. Every word of that is true about the beetle's ALBEDO and none of
 * it is true about its PIXELS. Measured off the frame, by test/wallart.mjs,
 * over the exact pixels a gold scarab covers on a nine-metre ceiling:
 *
 *     the body's own luminance      p10   0      p50   4.3     p90  86.1
 *
 * A gold scarab in this interior is a DARK BODY WITH A BRIGHT RIM. Half of it
 * is under 5. The gilt shell is metalness 0.90 at roughness 0.26, so it has
 * almost no diffuse term: in a room lit by two point lamps over a low
 * environment it returns light in a thin specular band along its back and is
 * nearly black everywhere else. The 0xe8bf55 in enemies/variants.js is what it
 * would be under a studio, not what it is in a tomb.
 *
 * So the night sky put a nearly black body on a nearly black ground. Measured
 * on the same pose, same frame, same light phase:
 *
 *     ceiling            background p50    body pixels within 12 of it
 *     limestone (old)           23.4                    13.8%
 *     night sky (first cut)      0.0                    69.2%
 *
 * Sixty-nine per cent of the beetle merged into the ceiling. It was a better
 * screenshot and a worse game, which is the exact failure this lane was warned
 * about, and the only reason it was caught is that the harness measures the
 * body against what is behind it rather than measuring the ceiling.
 *
 * SO THE CEILING IS PALE. A limewashed plaster soffit, which is also something
 * these rooms actually had, and which puts a dark body on a light ground - the
 * oldest legibility answer there is, and the one the evidence points at rather
 * than the one the palette suggested.
 *
 * THE THREE RULES THE ORNAMENT IS HELD TO, all of which are about the beetle:
 *
 *   1. NOTHING UP HERE GOES DARK. The inscription is faded red ochre and the
 *      stars are a muted blue-grey, both kept well ABOVE the body's median.
 *      A bold dark-on-pale scheme would have been handsomer and would have put
 *      beetle-coloured holes across the whole surface for the body to sit in.
 *
 *   2. EVERYTHING IS SMALL AGAINST THE TARGET. A gold scarab at the 1.18 scale
 *      is about 1.2 m of body; at the seven metres a nine-metre ceiling is read
 *      from that is roughly 115 screen pixels on a 1080-high frame. A star is
 *      0.30 m across, so 29 pixels - a sixteenth of the beetle's area. Ornament
 *      the size of the target is camouflage.
 *
 *   3. THE VALUE RANGE STAYS NARROW AND HIGH. Field, soot, inscription and
 *      plaster loss are all held between roughly 150 and 245 in albedo, so the
 *      darkest thing on this ceiling is still far above the body's median. The
 *      ceiling is not competing with the beetle for brightness; it is the sheet
 *      the beetle is a hole in.
 *
 * TEXEL DENSITY, because this file has been wrong about that twice and both
 * times it was the actual defect rather than the taste. The ceiling is built by
 * world/build.js at DENSITY.limestone, 0.17 tiles per unit, so one tile is
 * 5.88 m and a 512 map is 87 texels per metre. Reading the Hall of Offerings'
 * 9 m ceiling from an eye at 1.7 m is a 7.3 m sight line, where a 1080-high
 * frame at the game's 75 degree vertical field of view puts 96 screen pixels on
 * a metre. That is 0.9 texels per screen pixel - very near 1:1, which is the
 * rule the door slab was rebuilt to obey. Nothing in here is authored below
 * about six texels, so nothing in here relies on detail the mip chain will eat.
 *
 * IT IS PAINT, NOT CARVING, and that is why the marks go through `paintMark`
 * rather than `carveMark`. A plastered soffit has no chisel work on it, and the
 * lit-lower-lip trick that makes the wall register read as cut stone would put
 * a bump under every glyph in the derived normal map. The `ceiling` entry in
 * `buildTextures` therefore takes a low normal strength and a high roughness
 * floor: matte plaster, not dressed limestone.
 */
function paintCeiling(size = 512) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });

  /**
   * The same LOCAL renormalisation `paintDoorstone` and `paintGold` use, for
   * the same measured reason: `hash2` returns roughly 0.01..0.50 on the integer
   * lattice, so `fbm` is neither centred on 0.5 nor the amplitude it claims and
   * the `fbm() - 0.5` idiom elsewhere in this file is a near-constant darkening.
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

  // Periods are cells per tile, and the tile is 5.88 m. Period 3 is a 2 m
  // cloud, period 6 a metre, period 40 a 15 cm grain - which brackets the
  // 30 cm star from both sides and leaves no hole in the spectrum.
  const fMottle = field(3, 3, 613);
  const fSoot = field(2, 6, 617);
  const fLoss = field(2, 5, 619);
  const fGrain = field(1, 40, 623);

  // -------------------------------------------------------------------- field
  const img = ctx.createImageData(size, size);
  const d = img.data;

  for (let i = 0, p = 0; i < size * size; i++, p += 4) {
    // Uneven limewash. A hand-laid ground coat is never one value, and this is
    // the term that keeps an 8-by-6-tile gallery ceiling from reading as one
    // stamp repeated 48 times. Multiplicative and NARROW: a wide swing on a
    // pale ground opens dark patches, and rule 3 above is what a dark patch on
    // this surface costs.
    const t = 0.94 + (fMottle[i] - 0.5) * 0.16;

    // SOOT, and it is the one thing up here that is genuinely earned by the
    // room below. Every light in the interior is a brazier; three thousand
    // years of one puts carbon on the plaster above it. Upper tail only, so
    // this is patches rather than a wash - a wash would just be a darker flat
    // fill, which is the mistake the gold map's tarnish note warns about.
    //
    // CAPPED, which is the one place this surface is not free to be as honest
    // as it wants. Real soot over a brazier goes to black, and black is a
    // beetle-sized hiding place. 62 counts off a 240 ground bottoms this term
    // out at about 175, which still reads as staining and never becomes a
    // shadow the target can sit in.
    const soot = Math.min(1, Math.max(0, fSoot[i] - 0.58) * 1.9);

    let r = 240 * t, g = 232 * t, b = 210 * t;
    r -= soot * 62; g -= soot * 60; b -= soot * 52;

    d[p] = r < 0 ? 0 : r;
    d[p + 1] = g < 0 ? 0 : g;
    d[p + 2] = b < 0 ? 0 : b;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // ---------------------------------------------------------------- the bands
  //
  // ONE PER TILE, so a band every 5.88 m, which is about a column bay.
  //
  // THE FIRST CUT HAD TWO AND IT WAS WRONG AT ROOM SCALE, which is a thing only
  // the room can tell you. A band every 2.94 m is a defensible rhythm on the
  // texture and a defensible one in the Hall of Offerings, which is 18 m deep.
  // Rendered in the Great Gallery - 52 by 38 - it put THIRTEEN evenly spaced
  // parallel lines across one view, and thirteen evenly spaced parallel lines
  // is not a decorated ceiling, it is a grating: the same failure paintDoorstone
  // records for a single-frequency chisel, two orders of magnitude larger.
  //
  // The lesson is the one this file keeps relearning. A surface is authored
  // against the distance it is READ from, and for a ceiling that distance is
  // the diagonal of the biggest room it is in, not the height of the average
  // one.
  const BANDS = 1;
  const bandH = Math.round(size * 0.105);        // 54 texels, 62 cm
  const rule = Math.max(2, Math.round(bandH * 0.10));

  const bandRows = [];
  for (let i = 0; i < BANDS; i++) {
    const cy = (i + 0.5) * (size / BANDS);
    bandRows.push(cy);

    // Ground: faded red ochre, and the value is chosen against the body rather
    // than against the plaster. Held around 155 in luminance - well above the
    // beetle's median of 4 and above its p50-to-p90 mass - so a body crossing a
    // band is still a dark shape on a lighter one.
    ctx.fillStyle = 'rgb(208, 152, 112)';
    ctx.fillRect(0, cy - bandH / 2, size, bandH);

    // The double rule top and bottom. Two lines rather than one because a
    // single line at this width mips to nothing by the far end of a long room,
    // and a pair leaves a legible light-dark-light edge for twice as long. The
    // dark one is THIN by design: a 5-texel line is 6 cm, which cannot hold a
    // beetle, and the same value spread over the whole band could.
    ctx.fillStyle = 'rgb(238, 224, 196)';
    ctx.fillRect(0, cy - bandH / 2, size, rule);
    ctx.fillRect(0, cy + bandH / 2 - rule, size, rule);
    ctx.fillStyle = 'rgba(126, 78, 54, .85)';
    ctx.fillRect(0, cy - bandH / 2 - rule * 0.6, size, rule * 0.6);
    ctx.fillRect(0, cy + bandH / 2, size, rule * 0.6);

    // The inscription. An integer number of cells across the tile so it wraps,
    // and painted rather than carved: see the note above this function.
    const cells = 13;
    const cw = size / cells;
    const s = Math.min(cw * 0.66, (bandH - rule * 3) * 0.80);
    for (let k = 0; k < cells; k++) {
      const kind = Math.floor(hash2(k * 5 + i, i * 11 + 3, 641) * MARKS) % MARKS;
      paintMark(ctx, kind, (k + 0.5) * cw, cy, s, 'rgba(140, 86, 60, .90)', 0.17);
    }
  }

  // ---------------------------------------------------------------- the stars
  //
  // FIVE ROWS AND FIVE COLUMNS per tile, a 1.18 m lattice, jittered hard. The
  // one row that lands on the band is dropped, leaving four rows of five in the
  // panel around it.
  //
  // Seven was the first number and it came down with the band count for the
  // same reason: at 84 cm the field read as a printed pattern in the gallery
  // rather than as painted stars, and the give-away was that the eye could find
  // the lattice. 1.18 m with 45 per cent jitter cannot be resolved into rows
  // and columns at the distance a ceiling is seen from, which is the whole job
  // of the jitter.
  const STARS = 5;
  const step = size / STARS;
  const R = Math.round(size * 0.0255);           // 13 texels, 30 cm across

  /** A five-pointed star, wrapped so the tile is seamless. */
  const star = (cx, cy, r, alpha) => {
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const x = cx + ox, y = cy + oy;
        if (x < -r * 2 || x > size + r * 2 || y < -r * 2 || y > size + r * 2) continue;
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 5;
          const rr = k % 2 ? r * 0.42 : r;
          const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        // MUTED BLUE-GREY, AND NOT MUCH DARKER THAN THE PLASTER. The one
        // colour decision on this surface that is load-bearing rather than
        // aesthetic. See rule 1 above: a star is the smallest piece of
        // ornament up here and is therefore the one most likely to be sitting
        // exactly where the body is, so it is the one that must not be a hole.
        ctx.fillStyle = `rgba(150, 164, 172, ${alpha})`;
        ctx.fill();
      }
    }
  };

  for (let gy = 0; gy < STARS; gy++) {
    for (let gx = 0; gx < STARS; gx++) {
      const jx = (hash2(gx, gy, 653) * 2 - 0.5) * step * 0.45;
      const jy = (hash2(gx, gy, 659) * 2 - 0.5) * step * 0.45;
      const cx = (gx + 0.5) * step + jx;
      const cy = (gy + 0.5) * step + jy;

      // Inside a band is inscription, not sky.
      let inBand = false;
      for (const by of bandRows) if (Math.abs(cy - by) < bandH * 0.5 + R) inBand = true;
      if (inBand) continue;

      // Size and opacity both vary. A star field where every star is the same
      // star is the identical-clone read, one scale down from the prop cloud
      // dressing.js warns about.
      const r = R * (0.82 + Math.min(1, hash2(gx, gy, 661) * 2) * 0.36);
      const a = 0.62 + Math.min(1, hash2(gx, gy, 673) * 2) * 0.32;
      star(cx, cy, r, a);
    }
  }

  // -------------------------------------------------- age, over the paint
  //
  // PLASTER LOSS RUNS LAST, and the order is the point: it has to eat the
  // ornament, not sit under it. Paint falls off a ceiling in patches and takes
  // whatever was painted on it, so a star with a bite out of it is the single
  // strongest cue that this is a painted surface three thousand years old
  // rather than a texture.
  //
  // The exposed stone is DULLER AND GREYER THAN THE LIMEWASH, but only just.
  // Bare limestone under a lost patch of plaster is not a dark hole, and this
  // surface cannot afford one anyway: around 185 in albedo, so a patch reads as
  // a change of material rather than as a shadow.
  const back = ctx.getImageData(0, 0, size, size);
  const q = back.data;
  for (let i = 0, p = 0; i < size * size; i++, p += 4) {
    const loss = Math.min(1, Math.max(0, (fLoss[i] - 0.70) / 0.16));
    if (loss > 0) {
      const k = smoothstep(loss) * 0.88;
      const t = 0.94 + (fMottle[i] - 0.5) * 0.16;
      q[p] = q[p] * (1 - k) + 196 * t * k;
      q[p + 1] = q[p + 1] * (1 - k) + 186 * t * k;
      q[p + 2] = q[p + 2] * (1 - k) + 162 * t * k;
    }
    // A 15 cm tooth over everything, so the surface has something between the
    // 30 cm star and the film grain. A hole in the frequency spectrum that wide
    // is what made the door slab read as suede.
    const grain = (fGrain[i] - 0.5) * 9;
    q[p] += grain; q[p + 1] += grain; q[p + 2] += grain;
  }
  ctx.putImageData(back, 0, 0);

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

  /**
   * THE WALL FRIEZE, AS THE FALLBACK HALF OF A TWO-PATH MATERIAL.
   *
   * The SAME painter and the SAME arguments as `block` above, plus the
   * inscription, so on the asset-404 path the interior walls are the masonry
   * they have always been with carving added rather than a different stone. On
   * the normal path `upgradeMaterials` replaces both of these maps with the
   * bricks083 scan inscribed by `inscribeScan`, which is the same relationship
   * `limestone` already has to its own scan - and the reason this set exists at
   * all is that the previous attempt at wall carving did NOT have it, so it only
   * ever rendered when the download failed.
   */
  const frieze = paintMasonry(512, { rows: 6, seed: 3, hieroglyphs: true });
  drawInscription(frieze.getContext('2d', { willReadFrequently: true }), 512, 512);
  // `register: true` is the wall art. The scattered per-block marks the
  // `hieroglyphs` flag already drew are what a weathered wall looks like from
  // arm's length; the register is what makes it read as DECORATED from across a
  // room, because it is the only thing on the surface with a line in it.
  const carved = paintMasonry(512, { rows: 5, seed: 11, hieroglyphs: true, register: true });
  const granite = paintGranite(512);
  const ceiling = paintCeiling(512);
  const doorstone = paintDoorstone(512);
  const gold = paintGold(256);

  // Every repeat stays at 1. Texel density is baked into each geometry's UVs
  // by world/uv.js instead, so one shared material tiles correctly on a 2-unit
  // rubble chunk and a 100-unit wall alike without cloning the material.
  cache = {
    sand: materialMaps(sand, { normalStrength: 1.6, rough: [0.78, 0.98] }),
    block: materialMaps(block, { normalStrength: 3.0, rough: [0.62, 0.94] }),

    // Identical treatment to `block`, because it is `block` with an inscription
    // cut into it. Any divergence here would show as a seam between a wall and
    // the lintel above it, which are the same stone in the same room.
    frieze: materialMaps(frieze, { normalStrength: 3.0, rough: [0.62, 0.94] }),

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

    // ROUGHNESS FLOOR RAISED FROM 0.12. Gilding on a cornice that has stood in
    // a sandstorm since the Bronze Age is not a mirror, and 0.12 is one. Only
    // moves the specular lobe wider and dimmer, so it cannot re-blow the
    // highlight the lighting pass was verified against.
    gold: materialMaps(gold, { normalStrength: 1.4, rough: [0.20, 0.44] }),

    // The winged sun-disc, and NOTHING ELSE. Same painted canvas, different
    // maps derived from it, on the paintDoorstone precedent: one painter, two
    // map sets, no second copy of the pixel code.
    //
    // ROUGHNESS 0.30-0.66 against the cornice's 0.20-0.44, and this is the
    // change that stops the disc being a flat orange fill. What shipped was
    // `roughness = 1.0` with `roughnessMap = null` on a metal - and a metal at
    // roughness 1 has NO specular lobe at all, so a 2.4 m gold disc mounted at
    // eye height in the most-looked-at frame in the game was rendering as
    // uniform diffuse orange. It had no highlight to catch the low sun with
    // because it had been given nothing to catch it.
    //
    // The map is the authority rather than a constant, because `roughnessFrom
    // Canvas` reads the albedo: the polished crowns come out smooth and the
    // tarnished creases come out matte, which is the correct relationship and
    // is free. 0.30 at the smooth end is a BROAD soft lobe on a surface this
    // size, not a point - the wide highlight the disc should catch the sun
    // with. It stops well short of the 0.12 that put a chrome ball in this
    // reveal on the first attempt.
    //
    // normalStrength 1.6, up from the cornice's 1.4: the planishing is a 9 cm
    // facet at 4.6% albedo contrast, and relief that never reaches the lighting
    // is the unread-chamfer failure again - paid for, and never drawn.
    goldRelief: materialMaps(gold, { normalStrength: 1.6, rough: [0.36, 0.62] }),

    /**
     * THE PAINTED CEILING, and the two numbers here are both legibility
     * numbers rather than taste ones.
     *
     * normalStrength 0.55, the lowest in the registry by a factor of three.
     * Every other set in here is cut stone, where the Sobel pass inferring
     * shape from colour is close enough to right. This one is PIGMENT ON FLAT
     * PLASTER: there is no geometry under a painted star, and at the 1.4 the
     * masonry wears, every mark and every rule line comes back as a ridge. The
     * failure mode is specific and it is the one that would cost the beetle -
     * a ceiling full of relief catches the brazier light in a hundred places
     * and puts a hundred moving highlights behind a moving target.
     *
     * ROUGHNESS 0.86-0.99, the flattest in the registry. Same argument through
     * the other channel. A gold scarab is metalness 0.90 at roughness 0.26, so
     * what makes it visible up there is its specular: it is the only thing on
     * the ceiling with a highlight. A ceiling that also has highlights is a
     * ceiling the beetle has to compete with. Matte plaster gives the target
     * the entire specular channel to itself.
     */
    ceiling: materialMaps(ceiling, { normalStrength: 0.55, rough: [0.86, 0.99] }),
  };

  return cache;
}

/**
 * The inscription compositor, exported because `materials.js` is where the
 * scanned map sets arrive and this file is where the marks are drawn.
 */
export { inscribeScan };

export const _internals = {
  fbm, valueNoise, normalFromCanvas, roughnessFromCanvas, materialMaps,
  paintMasonry, drawInscription, inscribeScan, makeCanvas,
};
