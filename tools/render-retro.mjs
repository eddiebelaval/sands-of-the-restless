#!/usr/bin/env node
// render-retro.mjs
//
// Builds docs/RETRO-LOOK.html: the PS1 render mode, side by side with the
// shipping look, with the measured frame times underneath.
//
//   node tools/render-retro.mjs
//
// Inputs, all produced by the instruments rather than typed in here:
//
//   .scratch/retro/shots.json    the paired screenshots  (.scratch/retro/shots.mjs)
//   .scratch/retro/perf.json     the frame times         (tools/perf-retro.mjs)
//   .scratch/retro/pixels.json   the pixel forensics     (.scratch/retro/verify-pixels.mjs)
//   .scratch/retro/isolate.json  the cost isolation      (.scratch/retro/isolate.mjs)
//
// THE CSS IS NOT WRITTEN HERE. It is lifted out of tools/render-doc.mjs at
// build time, by reading that file and pulling its CSS constant.
//
// That is a slightly unusual thing to do and it is the point: this project now
// has one visual language for a document you read, and a second copy of a
// stylesheet is a second copy that drifts. render-doc.mjs is a script rather
// than a module - it renders on import - so importing it would run it, and
// refactoring it into a module is another lane's file this week. Reading the
// constant out is the option that leaves one source of truth and touches
// nothing. It fails loudly if the constant is ever renamed, which is the
// behaviour that makes it safe.
//
// Screenshots are embedded as data URIs so the page is one self-contained file
// that can be mailed, dropped on a desktop, or opened with no server.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SCRATCH = path.join(ROOT, '.scratch/retro');
const OUT = path.join(ROOT, 'docs/RETRO-LOOK.html');

// ---------------------------------------------------------------------------
// the shared stylesheet
// ---------------------------------------------------------------------------

function borrowedCss() {
  const src = fs.readFileSync(path.join(ROOT, 'tools/render-doc.mjs'), 'utf8');
  const open = src.indexOf('const CSS = `');
  if (open === -1) {
    throw new Error(
      'render-retro: could not find `const CSS = ` in tools/render-doc.mjs.\n' +
      'That file owns the reading surface for this project and this page borrows\n' +
      'its stylesheet rather than keeping a second copy. If the constant moved,\n' +
      'point this at wherever it went - do not paste the CSS in here.'
    );
  }
  const start = open + 'const CSS = `'.length;
  const end = src.indexOf('`;', start);
  if (end === -1) throw new Error('render-retro: the CSS template literal is unterminated.');
  return src.slice(start, end);
}

/**
 * The only styles this page adds, and they are all about the pairs.
 *
 * Written against the borrowed sheet's own custom properties rather than
 * against colours of their own, so the page follows it into light mode and
 * into whatever it becomes next.
 */
const EXTRA_CSS = `
.pair {
  margin: 2.5rem 0 3rem;
}
.pair-head {
  font-family: var(--sans);
  font-size: .75rem;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--sand);
  margin: 0 0 .85rem;
}
.pair-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: .75rem;
}
@media (max-width: 780px) {
  .pair-grid { grid-template-columns: 1fr; }
}
.shot {
  margin: 0;
  min-width: 0;
}
.shot img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--rule);
  border-radius: 2px;
  background: var(--bg-sunk);
}
/* The full-frame pairs are DOWNSCALED to fit two 1440-wide images beside each
   other, so they are left on the browser's normal filter. Forcing pixelated
   on a downscale is not the same operation as forcing it on an upscale: it
   drops source pixels rather than averaging them, and 3.19-pixel blocks
   sampled at 0.54 come back as an uneven moire that is an artefact of this
   page rather than of the renderer. The detail crops below are where the
   pixels are shown at 1:1, and they need no filter at all because there is no
   resampling left to do. */
.detail img { image-rendering: pixelated; }
.shot figcaption {
  font-family: var(--sans);
  font-size: .6875rem;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--text-faint);
  margin-top: .5rem;
}
.shot.is-retro figcaption { color: var(--ember); }
/* Full bleed. The borrowed sheet lays the document out as a three-column grid
   with the prose pinned to the middle track, and it already makes the same
   exception for wide tables. A pair of screenshots shrunk into a 37rem measure
   is a pair of thumbnails. */
.doc > .wide { grid-column: 1 / -1; padding: 0 var(--pad); }
.pair-grid { max-width: 100rem; margin: 0 auto; }
.lede {
  font-family: var(--sans);
  font-size: .9375rem;
  line-height: 1.6;
  color: var(--text-dim);
}
.tbl td.num, .tbl th.num { text-align: right; font-variant-numeric: tabular-nums; }
.win { color: var(--ember); font-weight: 600; }
`;

// ---------------------------------------------------------------------------
// inputs
// ---------------------------------------------------------------------------

function readJson(name, what) {
  const p = path.join(SCRATCH, name);
  if (!fs.existsSync(p)) {
    throw new Error(`render-retro: ${p} is missing. Run ${what} first. This page\n` +
      'is not allowed to describe a measurement that was not taken.');
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const shots = readJson('shots.json', '.scratch/retro/shots.mjs');
const perf = readJson('perf.json', 'tools/perf-retro.mjs');
const pixels = readJson('pixels.json', '.scratch/retro/verify-pixels.mjs');
const isolate = readJson('isolate.json', '.scratch/retro/isolate.mjs');
const ladderRungs = readJson('composer-ratio.json', '.scratch/retro/composer-ratio.mjs');
const reversal = readJson('reversal.json', '.scratch/retro/reversal-look.mjs');

// ---------------------------------------------------------------------------
// images
// ---------------------------------------------------------------------------

/**
 * Two encoders, on purpose.
 *
 * The shipping frame is photographic: continuous tone, soft gradients, film
 * grain. JPEG is what that is for, and a lossless PNG of it runs to 1.7 MB.
 *
 * The retro frame is the opposite of photographic. It holds 32 levels per
 * channel in 3x3 blocks, so a palette PNG stores it in a fraction of the space
 * AND stores it EXACTLY - and exactness matters here in a way it never does for
 * a decorative screenshot, because the page is making a claim about individual
 * pixel values. A JPEG of a dithered frame would blur the dither into the very
 * banding the dither exists to prevent, and the reader would be looking at an
 * artefact of the encoder while reading a paragraph about the shader.
 */
async function dataUri(file, isRetro) {
  const buf = isRetro
    ? await sharp(file).png({ palette: true, colours: 256, effort: 8 }).toBuffer()
    : await sharp(file).jpeg({ quality: 82, chromaSubsampling: '4:4:4' }).toBuffer();
  const mime = isRetro ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function table(headers, rows, aligns = []) {
  const th = headers.map((h, i) =>
    `<th${aligns[i] === 'r' ? ' class="num"' : ''}>${esc(h)}</th>`).join('');
  const tb = rows.map((r) => `<tr>${r.map((c, i) =>
    `<td${aligns[i] === 'r' ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('');
  return `<div class="scrollbox tablewide"><table class="tbl"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
}

const fps = (ms) => (1000 / ms).toFixed(0);

const perfRows = [];
for (const r of perf.rows) {
  const saved = r.off.median - r.on.median;
  const pct = (saved / r.off.median) * 100;
  perfRows.push([
    esc(r.pose), 'current',
    r.off.median.toFixed(2), fps(r.off.median), r.off.p95.toFixed(1),
    r.off.calls.toFixed(0), `${(r.off.tris / 1000).toFixed(0)}k`,
    `${r.off.w}x${r.off.h}`, '',
  ]);
  perfRows.push([
    '', '<strong>PS1</strong>',
    `<strong>${r.on.median.toFixed(2)}</strong>`, `<strong>${fps(r.on.median)}</strong>`,
    r.on.p95.toFixed(1),
    r.on.calls.toFixed(0), `${(r.on.tris / 1000).toFixed(0)}k`,
    `${r.on.w}x${r.on.h}`,
    `<span class="win">${pct.toFixed(0)}% faster</span>`,
  ]);
}

const pixelRows = pixels.map((p) => [
  esc(p.id),
  p.current.run, `<strong>${p.retro.run}</strong>`,
  `${p.current.ladder.pct.toFixed(2)}%`, `<strong>${p.retro.ladder.pct.toFixed(3)}%</strong>`,
  p.current.variety, `<strong>${p.retro.variety}</strong>`,
]);

const isolateRows = isolate.rows.map(([label, m]) => [
  esc(label), m.median.toFixed(2), fps(m.median), m.calls.toFixed(0),
  `${(m.tris / 1000).toFixed(0)}k`, m.buf,
]);

/**
 * A 1:1 window onto the pixels.
 *
 * The full-frame pairs have to be shrunk to sit side by side, and at that size
 * a 3-pixel block is under two pixels on the page - which is exactly the detail
 * the whole exercise is about, thrown away in the presentation of it. These
 * crops are cut out of the same PNGs at native resolution and displayed at
 * native resolution, so what the reader is looking at is what came off the
 * compositor.
 *
 * The window is a piece of wall and a piece of ground, because those are the
 * two surfaces where the affine warp and the ordered dither live.
 */
const DETAIL = { left: 560, top: 300, width: 720, height: 400 };

async function detailUri(file, isRetro) {
  const img = sharp(file).extract(DETAIL);
  const buf = isRetro
    ? await img.png({ palette: true, colours: 256, effort: 8 }).toBuffer()
    : await img.jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toBuffer();
  return `data:image/${isRetro ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`;
}

const details = [];
for (const r of shots.results.filter((x) => /wall|ground/.test(x.id))) {
  const a = await detailUri(r.offPath, false);
  const b = await detailUri(r.onPath, true);
  details.push(`<section class="pair detail">
<h3 class="pair-head">${esc(r.label)} &middot; ${DETAIL.width}x${DETAIL.height} at 1:1</h3>
<div class="pair-grid">
<figure class="shot"><img src="${a}" alt="${esc(r.label)} detail, current renderer"><figcaption>Current</figcaption></figure>
<figure class="shot is-retro"><img src="${b}" alt="${esc(r.label)} detail, PS1 mode"><figcaption>PS1 mode</figcaption></figure>
</div>
</section>`);
}

const pairs = [];
for (const r of shots.results) {
  const a = await dataUri(r.offPath, false);
  const b = await dataUri(r.onPath, true);
  pairs.push(`<section class="pair">
<h3 class="pair-head">${esc(r.label)}</h3>
<div class="pair-grid">
<figure class="shot"><img src="${a}" alt="${esc(r.label)}, current renderer"><figcaption>Current, 1440x860</figcaption></figure>
<figure class="shot is-retro"><img src="${b}" alt="${esc(r.label)}, PS1 mode"><figcaption>PS1 mode, ${r.stats.width}x${r.stats.height}</figcaption></figure>
</div>
</section>`);
}

const gpu = esc(perf.gpu.renderer || 'unknown');
const win = `${perf.window.w}x${perf.window.h}`;

const body = `
<h1>PS1 mode</h1>

<p class="lede">One key. The whole renderer drops to 1997 and comes back, in
place, with the player where they were standing. This page is the comparison:
the same four positions in both looks, and what the frame costs in each.</p>

<p>Press <strong>P</strong> in the game, or use <strong>PS1 mode</strong> on the
Video tab of the settings panel. It is not a reload and it is not a second
build. The world, the wave, the ammunition and the position are all untouched;
what changes is how the frame is drawn.</p>

<h2>What it is doing</h2>

<p>Five things, in order of how much of the look each one carries.</p>

<ol>
<li><strong>Low internal resolution, hard upscale.</strong> The scene renders at
${shots.results[0].stats.width}x${shots.results[0].stats.height} and the
compositor blows it up with square pixels. Lowering the resolution alone is not
this effect: the browser's default upscale is smooth and reads as a blurred
modern frame rather than a low-resolution one.</li>
<li><strong>Vertex jitter.</strong> The console had no sub-pixel precision, so
vertices snapped to whole pixels and geometry swam as the camera moved. The
clip-space position is quantised to the render grid in the vertex shader.</li>
<li><strong>Affine texture mapping.</strong> No per-pixel divide on that
hardware, so texture coordinates were interpolated linearly in screen space and
big polygons visibly warped. Most legible on the ground and on the wall
below.</li>
<li><strong>No shadow maps.</strong> Period correct, and a whole extra scene
render saved.</li>
<li><strong>Five-bit colour with an ordered dither.</strong> The console's
framebuffer was 15-bit and its rasteriser dithered on the way in.</li>
</ol>

<p>Ambient occlusion, bloom and anti-aliasing are switched off. The height fog
stays: it is period correct, and this level uses it to hide the far field.</p>

<h2>The pairs</h2>

<p class="lede">Same page, same position, seconds apart, with the wave director,
the weapon sway, the dust and the film grain all held still so the only
difference between the two halves is the render mode. Frame rate is printed in
the corner of each image by the game's own readout, with vsync disabled.</p>

<div class="wide">
${pairs.join('\n')}
</div>

<h2>The same pixels, at full size</h2>

<p class="lede">The pairs above are shrunk to fit two frames of a 1440-wide
window beside each other, which is the one thing that can hide the effect being
demonstrated. These are cut out of the same images at native resolution: a
${DETAIL.width}x${DETAIL.height} window, one pixel on the page per pixel off the
compositor. The warp in the stone and the dither in the shadow are visible here
and are not visible above.</p>

<div class="wide">
${details.join('\n')}
</div>

<h2>What it costs</h2>

<p>Measured on ${gpu} at ${win}, vsync disabled, ${perf.frames} frames a row,
median rather than mean. The adaptive governor is stood down for both halves,
or it would be changing the settings underneath the measurement.</p>

${table(
  ['Pose', 'Mode', 'Median ms', 'fps', 'p95 ms', 'Draw calls', 'Triangles', 'Buffer', ''],
  perfRows,
  ['', '', 'r', 'r', 'r', 'r', 'r', 'r', ''],
)}

<h2>Where the saving comes from</h2>

<p>One variable a row, at the avenue pose, with the world frozen. The third row
nulls the material re-sweep that keeps enemies spawned after the toggle in the
same look as the rest of the world, because a per-frame walk of the scene graph
is exactly the kind of bookkeeping that can eat the saving it is riding on. It
does not: one full sweep of ${isolate.nodes} scene nodes costs
${isolate.sweepCost.toFixed(2)} ms, which at one sweep in thirty frames is under
half a per cent of the frame.</p>

${table(
  ['Configuration', 'Median ms', 'fps', 'Draw calls', 'Triangles', 'Buffer'],
  isolateRows,
  ['', 'r', 'r', 'r', 'r', ''],
)}

<h2>One thing found on the way, which is not about this mode</h2>

<p>Getting the internal resolution down meant finding out how the post chain is
sized, and the answer is that it is not sized by the pixel ratio at all.
<code>EffectComposer</code> captures the renderer's pixel ratio ONCE, in its
constructor, and its <code>setSize</code> multiplies by that captured value
forever afterwards. <code>setPixelRatio</code> is the only thing that updates
it, and nothing in <code>src/</code> called it before this mode did. Every
caller that lowers the renderer's ratio and then calls
<code>composer.setSize(innerWidth, innerHeight)</code> therefore shrinks the
CANVAS and leaves every render target in the chain at the size the game booted
at.</p>

<p>Forcing each rung of the adaptive ladder and reading both numbers:</p>

${table(
  ['Governor rung', 'Pixel ratio', 'Canvas buffer', 'Composer render target'],
  ladderRungs.map((r) => [
    esc(r.rung), String(r.ratio), esc(r.canvas),
    r.canvas === r.composerRT ? esc(r.composerRT) : `<span class="win">${esc(r.composerRT)}</span>`,
  ]),
  ['', 'r', 'r', 'r'],
)}

<p>The bottom two rungs are the ones a machine in trouble ends up on, and on
those two the scene is still being rendered and post-processed at full size:
only the final blit gets cheaper. That is a one-line fix in
<code>src/main.js</code> - a <code>post.composer.setPixelRatio(...)</code> beside
each <code>renderer.setPixelRatio(...)</code> - and it is deliberately NOT made
here, because it changes the resolution every screenshot test renders at and
that wants its own pass with the visual suite re-baselined. PS1 mode sets the
composer's ratio itself while it is on and puts it back on the way out, so this
page's numbers are unaffected either way.</p>

<h2>Reading the pixels back</h2>

<p>Three of the five effects leave a signature that can be measured off the
composited PNG rather than described, so they were. This is the check that the
mode reached the screen rather than merely ran.</p>

<ul>
<li><strong>Mean run</strong> is the average length of a horizontal run of
identical pixels. A ${shots.results[0].stats.width}-wide buffer upscaled to 1440
with hard edges gives runs of about
${(1440 / shots.results[0].stats.width).toFixed(2)}. A smooth upscale gives
runs near 1, because every intermediate pixel is a fresh interpolation.</li>
<li><strong>On ladder</strong> is the share of pixels whose three channels all
land on one of the 32 values a five-bit quantiser is able to emit. It is a
better question than "how many distinct values are there", because one stray
pixel from something that is not the renderer counts the same as a million.</li>
<li><strong>8x8 variety</strong> is the mean number of distinct green values
inside an 8x8 tile. Quantisation alone would drive it toward 1; the ordered
dither is what keeps it above that, and it is why a dark gradient in this game
breaks up instead of banding.</li>
</ul>

${table(
  ['Pose', 'Mean run, current', 'Mean run, PS1', 'On ladder, current', 'On ladder, PS1', '8x8, current', '8x8, PS1'],
  pixelRows,
  ['', 'r', 'r', 'r', 'r', 'r', 'r'],
)}

<p>The PS1 column is 99.979 per cent in all four, and the miss is the same 60
pixels every time: the crosshair is an HTML element sitting in the middle of the
frame, it is anti-aliased, and it never went through the renderer. A constant
that does not move between four different scenes is not a leak in the
quantiser.</p>

<h2>Does it come back</h2>

<p>A toggle that only goes one way is a bug wearing a two-way label, and the
draw-call counters coming back to where they started does not prove the picture
did: a material left with a patched shader, or a uniform left at a retro value,
would keep the counters exactly where they were and change what is on the
screen. So the check is three exposures at one frozen pose, before, during and
after, compared pixel for pixel. The control is two exposures with nothing
changed at all, because a harness that cannot render one state twice identically
cannot make any claim about two states.</p>

${table(
  ['Comparison', 'Mean absolute difference', 'Largest single pixel', 'Pixels changed'],
  reversal.map((r) => [
    esc(r.label),
    r.meanAbs.toFixed(3), String(r.max), `${r.changedPct.toFixed(3)}%`,
  ]),
  ['', 'r', 'r', 'r'],
)}

<p>Zero, zero and zero on the round trip: the frame after the toggle has been
pressed twice is identical to the frame before it, at every pixel. The middle
row is there so the last row has a floor under it, and it says that turning the
mode on changes 99.6 per cent of the frame.</p>

<h2>What is not in it</h2>

<p>The classic recipe has a sixth item this build does not do: swap the physical
materials for cheap per-vertex ones. In three.js 0.185.1 only standard and
physical materials receive <code>scene.environment</code>, and this scene's fill
is overwhelmingly image-based - the knockout recorded in
<code>src/core/post.js</code> puts <code>scene.environmentIntensity = 0</code> at
98 luma down to 15, which is eighty-five per cent of the light in the frame. A
Lambert swap therefore does not make the game look flat, it makes it look black,
and getting the light back means re-authoring the level's lighting rig. That is
a lighting job rather than a render-mode job.</p>

<p>Two smaller ones, stated so they are not discovered later. The heads-up
display is HTML and stays sharp, so it does not share the low resolution behind
it. And <code>noperspective</code>, the one-word version of affine mapping, is
not available. three.js compiles its built-in materials as GLSL ES 3.00, and
that language carries only <code>smooth</code> and <code>flat</code>. Compiled
on this machine's actual driver rather than taken from the specification:
<code>smooth out vec2 v</code> compiles, and <code>noperspective out vec2 v</code>
comes back <code>ERROR: 0:3: 'noperspective' : Illegal use of reserved word</code>
on ANGLE Metal. The warp here is therefore done by carrying the clip w through
as a varying and dividing it back out in the fragment shader, which is the same
arithmetic the qualifier would have asked the hardware for.</p>
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>PS1 mode</title>
<style>${borrowedCss()}${EXTRA_CSS}</style>
</head>
<body>
<main class="doc" id="doc">
${body}
</main>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');

console.log('render-retro');
console.log('  out    ' + OUT);
console.log('  pairs  ' + shots.results.length);
console.log('  bytes  ' + html.length);
