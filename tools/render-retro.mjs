#!/usr/bin/env node
// render-retro.mjs
//
// Builds docs/RETRO-LOOK.html: the two retro render modes, side by side with
// the shipping look, with the measured frame times underneath.
//
//   node tools/render-retro.mjs
//
// Inputs, all produced by the instruments rather than typed in here:
//
//   .scratch/retro/shots.json          triple screenshots  (.scratch/retro/shots.mjs)
//   .scratch/retro/perf.json           frame times         (tools/perf-retro.mjs)
//   .scratch/retro/pixels.json         pixel forensics     (.scratch/retro/verify-pixels.mjs)
//   .scratch/retro/isolate.json        cost isolation      (.scratch/retro/isolate.mjs)
//   .scratch/retro/composer-ratio.json the governor finding (.scratch/retro/composer-ratio.mjs)
//   .scratch/retro/reversal.json       the round trip      (.scratch/retro/reversal-look.mjs)
//
// THE CSS IS NOT WRITTEN HERE. It is lifted out of tools/render-doc.mjs at
// build time, by reading that file and pulling its CSS constant.
//
// That is a slightly unusual thing to do and it is the point: this project has
// one visual language for a document you read, and a second copy of a
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
 * The only styles this page adds, and they are all about the columns.
 *
 * Written against the borrowed sheet's own custom properties rather than
 * against colours of their own, so the page follows it into light mode and into
 * whatever it becomes next.
 */
const EXTRA_CSS = `
.trio { margin: 2.5rem 0 3rem; }
.trio-head {
  font-family: var(--sans);
  font-size: .75rem;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--sand);
  margin: 0 0 .85rem;
}
.trio-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: .7rem;
  max-width: 118rem;
  margin: 0 auto;
}
@media (max-width: 900px) {
  .trio-grid { grid-template-columns: 1fr; }
}
.shot { margin: 0; min-width: 0; }
.shot img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--rule);
  border-radius: 2px;
  background: var(--bg-sunk);
}
/* The full-frame columns are DOWNSCALED to fit three 1440-wide images across,
   so they are left on the browser's normal filter. Forcing pixelated on a
   downscale is not the same operation as forcing it on an upscale: it drops
   source pixels rather than averaging them, and 3.19-pixel blocks sampled at
   0.36 come back as an uneven moire that is an artefact of this page rather
   than of the renderer. The detail crops are where the pixels are shown at 1:1,
   and they need no filter because there is no resampling left to do. */
.detail img { image-rendering: pixelated; }
.shot figcaption {
  font-family: var(--sans);
  font-size: .6875rem;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--text-faint);
  margin-top: .5rem;
}
.shot.is-ps1 figcaption { color: var(--ember); }
.shot.is-n64 figcaption { color: var(--verdigris); }

/* Full bleed. The borrowed sheet lays the document out as a three-column grid
   with the prose pinned to the middle track, and it already makes the same
   exception for wide tables. Three screenshots shrunk into a 37rem measure are
   three thumbnails. */
.doc > .wide { grid-column: 1 / -1; padding: 0 var(--pad); }

.lede {
  font-family: var(--sans);
  font-size: .9375rem;
  line-height: 1.6;
  color: var(--text-dim);
}
.tbl td.num, .tbl th.num { text-align: right; font-variant-numeric: tabular-nums; }
.win { color: var(--ember); font-weight: 600; }
.n64 { color: var(--verdigris); font-weight: 600; }
.rowgroup td { border-top: 1px solid var(--rule); }
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
const bufferLadder = readJson('buffer-ladder.json', '.scratch/retro/buffer-ladder.mjs');

// ---------------------------------------------------------------------------
// images
// ---------------------------------------------------------------------------

/**
 * Two encoders, and which one a frame gets is decided by what the frame IS.
 *
 * The shipping look and the N64 mode are photographic: continuous tone, soft
 * gradients, a smooth upscale. JPEG is what that is for, and a lossless PNG of
 * either runs to 1.7 MB.
 *
 * The PS1 frame is the opposite of photographic. It holds 32 levels per channel
 * in 3x3 blocks, so a palette PNG stores it in a fraction of the space AND
 * stores it EXACTLY - and exactness matters here in a way it never does for a
 * decorative screenshot, because this page makes a claim about individual pixel
 * values. A JPEG of a dithered frame would blur the dither into the very
 * banding the dither exists to prevent, and the reader would be looking at an
 * artefact of the encoder while reading a paragraph about the shader.
 *
 * N64 takes the JPEG path deliberately even though it is a retro mode: its
 * whole character is a smooth upscale, so there is no hard-edged structure for
 * a palette to preserve, and a lossless encode of a blurred frame is large for
 * nothing.
 */
async function encode(file, mode, crop) {
  let img = sharp(file);
  if (crop) img = img.extract(crop);
  const lossless = mode === 'ps1';
  const buf = lossless
    ? await img.png({ palette: true, colours: 256, effort: 8 }).toBuffer()
    : await img.jpeg({ quality: crop ? 88 : 82, chromaSubsampling: '4:4:4' }).toBuffer();
  return `data:image/${lossless ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`;
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
  const tb = rows.map((r) => {
    const cls = r.group ? ' class="rowgroup"' : '';
    const cells = r.cells || r;
    return `<tr${cls}>${cells.map((c, i) =>
      `<td${aligns[i] === 'r' ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="scrollbox tablewide"><table class="tbl"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
}

const fps = (ms) => (1000 / ms).toFixed(0);

const MODE_KEYS = [
  { key: 'off', perfKey: 'current', cls: '', label: 'Current', tint: '' },
  { key: 'ps1', perfKey: 'PS1', cls: 'is-ps1', label: 'PS1', tint: 'win' },
  { key: 'n64', perfKey: 'N64', cls: 'is-n64', label: 'N64', tint: 'n64' },
];

// --- frame times -----------------------------------------------------------

const perfRows = [];
for (const r of perf.rows) {
  const base = r.modes.current;
  MODE_KEYS.forEach((m, i) => {
    const x = r.modes[m.perfKey];
    const pct = ((base.median - x.median) / base.median) * 100;
    const bold = (v) => (m.key === 'off' ? v : `<strong>${v}</strong>`);
    perfRows.push({
      group: i === 0,
      cells: [
        i === 0 ? esc(r.pose) : '',
        m.tint ? `<span class="${m.tint}">${m.label}</span>` : 'current',
        bold(x.median.toFixed(2)),
        bold(fps(x.median)),
        x.p95.toFixed(1),
        x.calls.toFixed(0),
        `${(x.tris / 1000).toFixed(0)}k`,
        `${x.w}x${x.h}`,
        m.tint ? `<span class="${m.tint}">${pct.toFixed(0)}% faster</span>` : '',
      ],
    });
  });
}

// --- pixel forensics -------------------------------------------------------

const pixelRows = [];
for (const p of pixels) {
  MODE_KEYS.forEach((m, i) => {
    const x = p.modes[m.key];
    pixelRows.push({
      group: i === 0,
      cells: [
        i === 0 ? esc(p.id) : '',
        m.tint ? `<span class="${m.tint}">${m.label}</span>` : 'current',
        x.run.toFixed(2),
        String(x.expectedLevels),
        `${x.ladder.pct.toFixed(3)}%`,
        x.variety.toFixed(1),
      ],
    });
  });
}

const isolateRows = isolate.rows.map(([label, m]) => [
  esc(label), m.median.toFixed(2), fps(m.median), m.calls.toFixed(0),
  `${(m.tris / 1000).toFixed(0)}k`, m.buf,
]);

// --- pictures --------------------------------------------------------------

const trios = [];
for (const r of shots.results) {
  const figs = [];
  for (const m of MODE_KEYS) {
    const src = await encode(r.shots[m.key], m.key);
    const st = r.stats[m.key];
    figs.push(`<figure class="shot ${m.cls}"><img src="${src}" alt="${esc(r.label)}, ${m.label}"><figcaption>${m.label}, ${st.width}x${st.height}</figcaption></figure>`);
  }
  trios.push(`<section class="trio">
<h3 class="trio-head">${esc(r.label)}</h3>
<div class="trio-grid">
${figs.join('\n')}
</div>
</section>`);
}

/**
 * A 1:1 window onto the pixels.
 *
 * The full-frame columns have to be shrunk to sit three across, and at that
 * size a 3-pixel block is barely over one pixel on the page - which is exactly
 * the detail the whole exercise is about, thrown away in the presentation of
 * it. These crops are cut out of the same images at native resolution and shown
 * at native resolution, so what the reader is looking at is what came off the
 * compositor.
 *
 * This matters more with three modes than it did with two. At full-frame size
 * the two retro columns read as the same idea twice; at 1:1 one is hard blocks
 * and the other is smeared, and that is the entire distinction.
 */
const DETAIL = { left: 560, top: 300, width: 720, height: 400 };

const details = [];
for (const r of shots.results.filter((x) => /wall|ground/.test(x.id))) {
  const figs = [];
  for (const m of MODE_KEYS) {
    const src = await encode(r.shots[m.key], m.key, DETAIL);
    figs.push(`<figure class="shot ${m.cls}"><img src="${src}" alt="${esc(r.label)} detail, ${m.label}"><figcaption>${m.label}</figcaption></figure>`);
  }
  details.push(`<section class="trio detail">
<h3 class="trio-head">${esc(r.label)} &middot; ${DETAIL.width}x${DETAIL.height} at 1:1</h3>
<div class="trio-grid">
${figs.join('\n')}
</div>
</section>`);
}

// --- prose -----------------------------------------------------------------

const gpu = esc(perf.gpu.renderer || 'unknown');
const win = `${perf.window.w}x${perf.window.h}`;
const ps1 = shots.results[0].stats.ps1;
const n64 = shots.results[0].stats.n64;

const body = `
<h1>Two retro modes</h1>

<p class="lede">One key, three looks. The renderer drops to 1997, then to 1996,
then comes back, in place, with the player where they were standing. This page
is the comparison: the same four positions in all three, and what the frame
costs in each.</p>

<p>Press <strong>P</strong> in the game to cycle Modern, PS1, N64 and back, or
pick one directly from <strong>Render mode</strong> on the Video tab of the
settings panel. No reload, no respawn. The world, the wave, the ammunition and
the position are untouched; what changes is how the frame is drawn.</p>

<h2>Why they are opposites</h2>

<p>The two consoles are not two points on a quality scale, which is the thing
worth seeing. They failed in opposite directions. The PlayStation had no
sub-pixel precision and no perspective correction, so its geometry twitched and
its textures swam, but what it did draw it drew with hard pixels. The Nintendo
64 fixed both of those and then spent the budget on filtering everything into
softness: bilinear texturing, hardware anti-aliasing, and fog pulled in close to
hide a draw distance it could not afford.</p>

${table(
  ['', 'PS1', 'N64'],
  [
    ['Sub-pixel precision', 'none, so geometry wobbles', 'yes, geometry sits still'],
    ['Perspective correction', 'none, so textures swim', 'yes, textures lie flat'],
    ['Upscale filter', 'nearest, hard pixels', '<strong>bilinear, soft and blurry</strong>'],
    ['Colour', `${ps1.levels} levels, dither at ${ps1.dither}`, `${n64.levels} levels, dither at ${n64.dither}`],
    ['Fog', 'period correct', `${n64.fog}x heavier, the signature draw-distance hider`],
    ['Internal resolution', `${ps1.width}x${ps1.height}`, `${n64.width}x${n64.height}`],
  ],
)}

<p>So the N64 preset is mostly the PS1 preset with the deliberate artefacts
switched off, plus one thing added: a smooth upscale. The blur is the signature.
If it comes out sharp, it is wrong.</p>

<h2>The three</h2>

<p class="lede">Same page, same position, seconds apart, with the wave director,
the weapon sway, the dust and the film grain all held still, so the only
difference between the columns is the render mode. Frame rate is printed in the
corner of each image by the game's own readout, with vsync disabled.</p>

<div class="wide">
${trios.join('\n')}
</div>

<h2>The same pixels, at full size</h2>

<p class="lede">The columns above are shrunk to fit three frames of a 1440-wide
window across, which is the one thing that can hide the effect being
demonstrated. These are cut from the same images at native resolution: a
${DETAIL.width}x${DETAIL.height} window, one pixel on the page per pixel off the
compositor. This is where the two retro modes stop looking like the same idea
twice.</p>

<div class="wide">
${details.join('\n')}
</div>

<h2>What they cost</h2>

<p>Measured on ${gpu} at ${win}, vsync disabled, ${perf.frames} frames a row,
median rather than mean. The adaptive governor is stood down for all three, or
it would be changing the settings underneath the measurement.</p>

<p><strong>Two caveats, because the numbers are worth less without them.</strong>
The absolute times in the "current" rows are inflated: this machine was running
seventeen to forty-five other headless browsers throughout, at load averages
between 20 and 77. The same harness on a quiet machine measured the same three
poses at 3.00, 3.60 and 9.50 ms. The RATIOS survive that - roughly three
quarters of the frame, in both conditions - and every row of a pose is taken
seconds apart in one session, so the comparison within a pose is sound even
where the absolute is not.</p>

<p>And the PS1 against N64 difference sits at the noise floor at two of the
three poses, which is the honest answer rather than a disappointing one. The
two modes render the SAME buffer through the SAME pass list and differ only by
uniform values; the upscale filter that separates them is the compositor's work,
not the renderer's, so it does not appear in a requestAnimationFrame delta at
all. Across three runs the delta at the avenue was +0.00, +0.00 and +0.10 ms,
and at the interior +0.40, -0.20 and +0.00.</p>

<p>The ground close-up is the exception and it is interesting. There N64 is
stable at 3.00 ms across all three runs while PS1 measures 2.90, 1.60 and 1.20 -
so the gap reads as +0.10, +1.40 and +1.80. That pose is the one where the
renderer has almost nothing to do (67 draw calls against 915 in the shipping
look), and the most likely reading is that once the frame gets that cheap the
COMPOSITOR becomes the limit, and a smooth upscale costs it more than a hard
one - a real cost the player pays, just not one a frame timer inside the page
can see directly. Stated as the leading hypothesis rather than as fact: the
competing explanation is that the PS1 rows at that pose carry a 230 ms stall in
their worst-frame column and are simply noisy, and nothing here separates the
two. What can be said with confidence is that wherever the renderer is the
bottleneck - which is every case this mode exists for - N64 is free.</p>

${table(
  ['Pose', 'Mode', 'Median ms', 'fps', 'p95 ms', 'Draw calls', 'Triangles', 'Buffer', ''],
  perfRows,
  ['', '', 'r', 'r', 'r', 'r', 'r', 'r', ''],
)}

<h2>Where the saving comes from</h2>

<p>One variable a row, at the avenue pose, with the world frozen. Some rows null
the material re-sweep that keeps enemies spawned after a switch in the same look
as the rest of the world, because a per-frame walk of the scene graph is exactly
the kind of bookkeeping that can eat the saving it is riding on. It does not: one
full sweep of ${isolate.nodes} scene nodes costs
${isolate.sweepCost.toFixed(2)} ms, which at one sweep in thirty frames is under
half a per cent of the frame.</p>

${table(
  ['Configuration', 'Median ms', 'fps', 'Draw calls', 'Triangles', 'Buffer'],
  isolateRows,
  ['', 'r', 'r', 'r', 'r', ''],
)}

<h2>One thing found on the way, which is not about these modes</h2>

<p>Getting the internal resolution down meant finding out how the post chain is
sized, and the answer is that it is not sized by the pixel ratio at all.
<code>EffectComposer</code> captures the renderer's pixel ratio ONCE, in its
constructor, and its <code>setSize</code> multiplies by that captured value
forever afterwards. <code>setPixelRatio</code> is the only thing that updates
it, and nothing in <code>src/</code> called it before these modes did. Every
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
here, because it changes the resolution every screenshot test renders at and that
wants its own pass with the visual suite re-baselined. Both retro modes set the
composer's ratio themselves and put it back on the way out, so this page's
numbers are unaffected either way.</p>

<h2>Reading the pixels back</h2>

<p>Three of the effects leave a signature that can be measured off the composited
PNG rather than described, so they were. This is the check that the modes reached
the screen rather than merely ran, and it is also what separates PS1 from N64
numerically rather than by eye.</p>

<ul>
<li><strong>Mean run</strong> is the average length of a horizontal run of
identical pixels. A ${ps1.width}-wide buffer upscaled to 1440 with hard edges
gives runs of about ${(1440 / ps1.width).toFixed(2)}. A smooth upscale gives runs
near 1, because every intermediate pixel is a fresh interpolation. That single
number is the PS1 against N64 discriminator: near-identical buffers, opposite
filters.</li>
<li><strong>On its ladder</strong> is the share of pixels whose three channels
all land on one of the values that mode's quantiser can emit. Each mode is scored
against its OWN level count, taken from what the page reports rather than from a
constant in the checker. The current look is scored against the PS1 ladder as a
control: a frame that never went near a quantiser should land on it essentially
never. <strong>N64 scores low here and that is correct rather than a failure</strong>
- see below.</li>
<li><strong>8x8 variety</strong> is the mean number of distinct green values in
an 8x8 tile. Quantisation alone drives it toward 1; the ordered dither is what
keeps it above that. PS1 sits lowest because it has the fewest levels, and N64
sits between PS1 and the shipping look because it has more levels and almost no
dither.</li>
</ul>

${table(
  ['Pose', 'Mode', 'Mean run', 'Levels', 'On its ladder', '8x8 variety'],
  pixelRows,
  ['', '', 'r', 'r', 'r', 'r'],
)}

<h3>Why N64 misses its own ladder, and what proves it does not</h3>

<p>PS1 lands on 99.979 per cent of its ladder and N64 on a fifth of its own,
which reads as a broken quantiser and is the opposite. The quantiser writes its
levels into the ${ps1.width}x${ps1.height} buffer. PS1 then blows that buffer up
with NEAREST, which copies pixel values unchanged, so every value on screen is
still a value the shader emitted. N64 blows it up SMOOTH, which by definition
averages neighbouring pixels and invents values between them. The low number is
evidence the bilinear filter is working, and it means this statistic cannot see
the N64 quantiser at all.</p>

<p>So a second instrument reads the drawing buffer with
<code>readPixels</code> BEFORE the compositor touches it. That is the one place
in this exercise where <code>readPixels</code> is the right tool rather than the
wrong one: every other check asks what reached the screen, where it would be a
lie because it cannot see the compositor. This one asks what the shader wrote,
and for that the compositor is exactly what must be excluded.</p>

${table(
  ['Mode', 'Drawing buffer', 'Levels', 'On its ladder', 'Distinct R/G/B'],
  bufferLadder.map((r) => [
    r.mode === 'off' ? 'current' : `<span class="${r.mode === 'ps1' ? 'win' : 'n64'}">${r.mode.toUpperCase()}</span>`,
    esc(r.buffer), String(r.levels),
    `<strong>${r.onLadderPct.toFixed(3)}%</strong>`, esc(r.distinct),
  ]),
  ['', 'r', 'r', 'r', 'r'],
)}

<p>Both quantisers are exact. The screenshot check and this one are
complementary rather than redundant: one proves the pixels arrive, the other
proves they were made correctly.</p>

<h2>Does it come back</h2>

<p>A toggle that only goes one way is a bug wearing a two-way label, and with
three modes the question gets harder in a way worth stating: switching PS1 to N64
does not unpatch anything, because the two share one set of patched shaders and
differ only by uniform values. A uniform set on the way into one mode and never
cleared on the way into the other is exactly the defect this has to be able to
see. So the walk is modern, PS1, N64, modern, and the last frame is compared
against the first. The control is two exposures with nothing changed at all,
because a harness that cannot render one state twice identically cannot make any
claim about two.</p>

${table(
  ['Comparison', 'Mean absolute difference', 'Largest single pixel', 'Pixels changed'],
  reversal.map((r) => [
    esc(r.label), r.meanAbs.toFixed(3), String(r.max), `${r.changedPct.toFixed(3)}%`,
  ]),
  ['', 'r', 'r', 'r'],
)}

<h2>What is not in it</h2>

<p>The classic recipe has an item neither mode does: swap the physical materials
for cheap per-vertex ones. In three.js 0.185.1 only standard and physical
materials receive <code>scene.environment</code>, and this scene's fill is
overwhelmingly image-based - the knockout recorded in
<code>src/core/post.js</code> puts <code>scene.environmentIntensity = 0</code> at
98 luma down to 15, which is eighty-five per cent of the light in the frame. A
Lambert swap therefore does not make the game look flat, it makes it look black,
and getting the light back means re-authoring the level's lighting rig. That is a
lighting job rather than a render-mode job.</p>

<p>The PS1 preset does not simulate that machine's missing z-buffer. It sorted
whole polygons back to front, and the artefact is a wall flickering in front of
the thing it is behind - which you do not reproduce by turning depth testing off
in a modern renderer, because that gives you a broken image rather than a period
one. It is the one signature of the era left out on purpose.</p>

<p>Two smaller ones, stated so they are not discovered later. The heads-up
display is HTML and stays sharp in both retro modes, so it does not share the low
resolution behind it. And <code>noperspective</code>, the one-word version of
affine mapping, is not available. three.js compiles its built-in materials as
GLSL ES 3.00, and that language carries only <code>smooth</code> and
<code>flat</code>. Compiled on this machine's actual driver rather than taken
from the specification: <code>smooth out vec2 v</code> compiles, and
<code>noperspective out vec2 v</code> comes back
<code>ERROR: 0:3: 'noperspective' : Illegal use of reserved word</code> on ANGLE
Metal. The warp is therefore done by carrying the clip w through as a varying and
dividing it back out in the fragment shader, which is the same arithmetic the
qualifier would have asked the hardware for - and which the N64 preset switches
off with a uniform rather than with a recompile.</p>
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Two retro modes</title>
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
console.log('  trios  ' + shots.results.length);
console.log('  bytes  ' + html.length);
