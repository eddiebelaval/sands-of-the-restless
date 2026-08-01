/**
 * Gun lab driver.
 *
 * Serves the tree, opens test/gunlab.html in headless Chromium, renders every
 * weapon offline through the real audio graph, and writes two things: a JSON
 * report of the numbers, and a PNG of the envelopes into shots/.
 *
 * The picture is not decoration. This project treats a rendered image as
 * evidence in a way it does not treat a claim, and an envelope plot is the one
 * form in which "the three cracks of a burst stayed separate" can be SEEN by
 * somebody who was not there when it ran.
 *
 * BEFORE TRUSTING A RUN, it SHAs the bytes the server actually returned for
 * src/core/audio.js against the bytes on disk. A stale http.server left running
 * from a previous session has silently made agents test the wrong tree, and a
 * green run against the wrong tree is worse than a red one.
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import sharp from 'sharp';

/** A 5x7 stroke font. Enough for labels; nothing here needs typography. */
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '10000', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'],
  H: ['10001', '10001', '11111', '10001', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '11100', '10010', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '11110', '10000', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '11110', '10100', '10010', '10001', '10001'],
  S: ['01111', '10000', '01110', '00001', '00001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00010', '00100', '01000', '10000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '01110', '10001', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function drawText(px, x, y, text, c) {
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch] || GLYPHS[' '];
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] === '1') px(cx + col, y + r, c[0], c[1], c[2]);
      }
    }
    cx += 6;
  }
}

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'shots');
const LABEL = process.argv[2] || 'after';
const PORT = Number(process.env.GUNLAB_PORT || 5041);

if (PORT === 4177) {
  console.error('port 4177 is a deliberate tripwire; pick something in 5000-5099');
  process.exit(2);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.css': 'text/css',
};

// A server of our own rather than `python3 -m http.server`, so the port, the
// bind address and the lifetime are all owned by this process and there is
// nothing left listening when it exits.
const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  // Read whole rather than stream: the headers have to be written AFTER the
  // read succeeds, or a missing file produces a 200 whose body is an exception
  // and the harness tests nothing while reporting nothing wrong.
  readFile(file).then((body) => {
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream',
                         'cache-control': 'no-store' });
    res.end(body);
  }).catch(() => { res.writeHead(404); res.end('not found'); });
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}`;

// --- served bytes must be the bytes on disk ---------------------------------
const diskSha = createHash('sha256').update(readFileSync(join(ROOT, 'src/core/audio.js'))).digest('hex');
const servedSha = createHash('sha256')
  .update(Buffer.from(await (await fetch(`${BASE}/src/core/audio.js`)).arrayBuffer()))
  .digest('hex');
if (diskSha !== servedSha) {
  console.error(`served audio.js != disk audio.js\n  disk   ${diskSha}\n  served ${servedSha}`);
  server.close();
  process.exit(2);
}
console.log(`audio.js sha256 ${diskSha}`);
console.log(`serving ${ROOT} on ${BASE}\n`);

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto(`${BASE}/test/gunlab.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__GUNLAB_READY__ === true, { timeout: 15000 });

const WEAPONS = ['pistol', 'smg', 'shotgun', 'rifle', 'lmg', 'bolt', 'energy'];

const report = { label: LABEL, audioSha: diskSha, when: new Date().toISOString(), weapons: {} };
const plots = [];

// --- one shot of each weapon, outdoors and in a chamber ----------------------
for (const w of WEAPONS) {
  const ext = await page.evaluate(([n]) => window.__GUNLAB__.shot(n, { space: 'exterior' }), [w]);
  const cham = await page.evaluate(([n]) => window.__GUNLAB__.shot(n, { space: 'chamber' }), [w]);
  const varn = await page.evaluate(([n]) => window.__GUNLAB__.variation(n, { space: 'exterior' }), [w]);
  const cost = await page.evaluate(([n]) => window.__GUNLAB__.cost(n, 8), [w]);
  report.weapons[w] = { exterior: ext.metrics, chamber: cham.metrics, variation: varn.cmp, cost };
  plots.push({ title: `${w} / exterior`, plot: ext.plot });
}

// --- the B3AR burst ----------------------------------------------------------
//
// 41.6ms between rounds, which is what weapons.js actually produces at
// burstRpm 1500 and what was measured off the live weapon, not the 40ms the
// design doc rounds it to.
//
// BOTH profiles are measured, deliberately. src/player/weapons.js maps the
// B3AR to the 'pistol' audio profile, and that file is not mine to edit, so the
// pistol row is what a player hears tonight and the b3ar row is what the
// one-line patch in the report would buy. Reporting only the second would be
// reporting a result nobody can hear yet.
const BURST_GAP_MS = 41.6;
const profiles = await page.evaluate(() => window.__GUNLAB__.profiles());
console.log(`weapon profiles in audio.js: ${profiles.join(', ')}\n`);

report.burst = {};
for (const prof of ['pistol', 'b3ar']) {
  if (!profiles.includes(prof)) continue;
  const b = await page.evaluate(([p, g]) => window.__GUNLAB__.burst(p, {
    count: 3, gapMs: g, space: 'exterior', plotSeconds: 0.5,
  }), [prof, BURST_GAP_MS]);
  report.burst[prof] = b;
  plots.push({ title: `B3AR burst on ${prof} profile 3 x ${BURST_GAP_MS}ms`, plot: b.plot });
}

if (profiles.includes('b3ar')) {
  const b = await page.evaluate(() => window.__GUNLAB__.shot('b3ar', { space: 'exterior' }));
  report.weapons.b3ar = {
    exterior: b.metrics,
    variation: await page.evaluate(() => window.__GUNLAB__.variation('b3ar', { space: 'exterior' })).then((r) => r.cmp),
    cost: await page.evaluate(() => window.__GUNLAB__.cost('b3ar', 8)),
  };
  plots.push({ title: 'b3ar single / exterior', plot: b.plot });
}

// --- sustained fire, as a load figure ---------------------------------------
report.variants = {};
for (const w of ['pistol', 'b3ar', 'lmg', 'bolt']) {
  report.variants[w] = await page.evaluate(([n]) => window.__GUNLAB__.variants(n), [w]);
}
report.bakeCost = await page.evaluate(() => window.__GUNLAB__.bakeCost());
report.idleCost = await page.evaluate(() => window.__GUNLAB__.idleCost(3.6, { space: 'chamber' }));
report.compressorForensics = await page.evaluate(() => window.__GUNLAB__.compressorForensics());
report.limiterEffect = {};
for (const n of ['boxJingle', 'headshotHit', 'magIn']) {
  report.limiterEffect[n] = await page.evaluate(([s]) => window.__GUNLAB__.limiterEffect(s), [n]);
}
report.renderCost = {
  lmg: await page.evaluate(() => window.__GUNLAB__.renderCost('lmg', 30, { space: 'chamber' })),
  smg: await page.evaluate(() => window.__GUNLAB__.renderCost('smg', 30, { space: 'chamber' })),
};

// --- nothing else regressed --------------------------------------------------
report.other = {};
for (const n of ['magIn', 'weaponSwitch', 'dryFire', 'groan', 'headshotHit', 'boxJingle']) {
  report.other[n] = (await page.evaluate(([s]) => window.__GUNLAB__.sound(s), [n])).metrics;
}

await browser.close();
server.close();

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, `gunlab-${LABEL}.json`), JSON.stringify(report, null, 2));

// --- the picture -------------------------------------------------------------
await drawPlots(plots, join(OUT, `gunlab-${LABEL}.png`), LABEL, diskSha);

// --- the table ---------------------------------------------------------------
const head = ['weapon', 'peakdB', 'crest', 'atk ms', 'slew/pk', 'd20 ms', 'd60 ms',
              'sub', 'low', 'lowmid', 'mid', 'high', 'air', 'E-air', 'corr'];
const rows = [];
for (const [w, r] of Object.entries(report.weapons)) {
  const m = r.exterior, b = m.bands;
  rows.push([w, m.peakDb, m.crestDb, m.attackMs, m.slewPerPeak, m.decay20Ms, m.decay60Ms,
             b.sub, b.low, b.lowmid, b.mid, b.high, b.air, m.edgeBands.air,
             r.variation ? r.variation.correlation : '-']);
}
const widths = head.map((h, i) => Math.max(String(h).length,
  ...rows.map((r) => String(r[i]).length)));
const line = (cells) => cells.map((c, i) => String(c).padStart(widths[i])).join('  ');

console.log(`--- ${LABEL}: one shot, exterior ---`);
console.log(line(head));
for (const r of rows) console.log(line(r));

for (const [prof, b] of Object.entries(report.burst)) {
  const c = b.cracks;
  console.log(`\n--- ${LABEL}: B3AR burst on the '${prof}' profile, 3 rounds ${b.gapMs}ms apart ---`);
  for (const k of c.cracks) console.log(`  crack ${k.round} at ${String(k.ms).padStart(6)}ms   ${String(k.level).padStart(7)}dB`);
  for (const t of c.troughs) console.log(`  trough ${t.between} at ${String(t.ms).padStart(6)}ms   fell ${t.depthDb}dB below the quieter neighbour`);
  console.log(`  SPREAD across the three cracks ${c.spreadDb}dB   ` +
              `SHALLOWEST TROUGH ${c.minTroughDb}dB`);
  console.log(`  (under ~3dB of trough the ear hears one event; over ~8dB, three)`);
}

console.log(`\n--- ${LABEL}: cost ---`);
if (report.bakeCost) {
  console.log(`  one-off bake at the Begin click: ${report.bakeCost.bakeMs}ms, ` +
              `${report.bakeCost.buffers} buffers, ${report.bakeCost.megabytes}MB of float resident`);
}
for (const [w, r] of Object.entries(report.weapons)) {
  if (r.cost) console.log(`  ${w.padEnd(9)} ${r.cost.nodesPerShot} nodes/shot, ${r.cost.buildMsPerShot}ms to build`);
}
console.log(`  idle graph, 3.6s of silence: ${report.idleCost.renderMs}ms of DSP ` +
            `(the ${report.idleCost.bakeMs}ms bake every offline render pays is excluded)`);
for (const [w, r] of Object.entries(report.renderCost)) {
  console.log(`  ${w} 30 shots: rendered ${r.audioSeconds}s in ${r.renderMs}ms (${r.realtimeFactor}x realtime), ` +
              `${(r.renderMs - report.idleCost.renderMs).toFixed(1)}ms of that is the shots ` +
              `= ${((r.renderMs - report.idleCost.renderMs) / r.shots).toFixed(2)}ms/shot of rendered DSP`);
  console.log(`      sustained peak ${r.sustainedPeak}, clipped samples ${r.clippedSamples}`);
}
console.log(`  idle graph without the soft clipper: ${report.idleCost.withoutLimiterMs}ms ` +
            `(the clipper costs ${(report.idleCost.renderMs - report.idleCost.withoutLimiterMs).toFixed(1)}ms per 3.6s)`);
console.log('\n--- what the old master compressor did, isolated ---');
for (const [k, v] of Object.entries(report.compressorForensics)) {
  console.log(`  ${k}`);
  for (const [m, r] of Object.entries(v)) console.log(`    ${m.padEnd(9)} peak ${r.peak} at ${r.peakMs}ms`);
}
if (Object.keys(report.variants || {}).length) {
  console.log('\n--- do the baked variants actually differ? ---');
  for (const [w, v] of Object.entries(report.variants)) {
    if (!v) continue;
    console.log(`  ${w.padEnd(8)} ${v.count} variants, ${v.distinctLengths} distinct buffer lengths, ` +
                `crack correlation mean ${v.meanCrack} / worst ${v.worstCrack}, ` +
                `any identical pair: ${v.anyIdentical}`);
  }
}
console.log('\n  limiter in circuit vs bypassed (peak dBFS):');
for (const [n, r] of Object.entries(report.limiterEffect)) {
  console.log(`    ${n.padEnd(12)} ${r.inCircuit.peakDb} vs ${r.bypassed.peakDb}`);
}

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
if (errors.length) { console.log('\n--- errors ---'); for (const e of errors) console.log(e); }

console.log(`\nreport -> shots/gunlab-${LABEL}.json`);
console.log(`plot   -> shots/gunlab-${LABEL}.png`);

/**
 * Draw the envelope plots into a single PNG.
 *
 * Raw RGB into a buffer and sharp to encode it, rather than a canvas in the
 * browser, because the browser is already closed by the time the numbers are
 * assembled and reopening it to draw a chart is a second failure mode for no
 * benefit. The y axis is dB relative to that plot's own peak, so the SHAPE is
 * comparable across weapons of very different levels, which is the question the
 * plot is here to answer.
 */
async function drawPlots(list, path, label, sha) {
  const W = 1180, ROW = 116, PAD = 54, TOP = 46;
  const H = TOP + list.length * ROW + 26;
  const buf = Buffer.alloc(W * H * 3, 14);

  const px = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
  };
  const hline = (y, x0, x1, c) => { for (let x = x0; x < x1; x++) px(x, y, c[0], c[1], c[2]); };
  const vline = (x, y0, y1, c) => { for (let y = y0; y < y1; y++) px(x, y, c[0], c[1], c[2]); };

  const FLOOR = -60;
  list.forEach((item, k) => {
    const y0 = TOP + k * ROW + 8;
    const h = ROW - 30;
    const x0 = PAD, x1 = W - 18;

    // -20dB and -40dB rules, so decay can be read off the picture.
    for (const d of [-20, -40]) {
      const y = y0 + Math.round(h * (d / FLOOR));
      hline(y, x0, x1, [44, 44, 52]);
    }
    hline(y0 + h, x0, x1, [70, 70, 80]);
    vline(x0, y0, y0 + h + 1, [70, 70, 80]);

    // 100ms gridlines.
    const secs = item.plot.seconds;
    for (let t = 0.1; t < secs; t += 0.1) {
      const x = x0 + Math.round((x1 - x0) * (t / secs));
      for (let y = y0; y < y0 + h; y += 4) px(x, y, 40, 40, 48);
    }

    const pts = item.plot.points;
    for (let i = 0; i < pts.length; i++) {
      const x = x0 + Math.round((x1 - x0) * i / pts.length);
      const v = Math.max(FLOOR, pts[i]);
      const y = y0 + Math.round(h * (v / FLOOR));
      // Fill down to the floor: an envelope reads far better as a filled shape
      // than as a line, and the filled area is where the energy is.
      for (let yy = y; yy <= y0 + h; yy++) {
        const f = 1 - (yy - y) / Math.max(1, y0 + h - y);
        px(x, yy, 40 + Math.round(180 * f), 150 + Math.round(90 * f), 90 + Math.round(60 * f));
      }
      px(x, y, 235, 250, 210);
    }

    drawText(px, 6, y0 - 2, String(k + 1), [150, 150, 160]);
    drawText(px, PAD + 6, y0 + 2, item.title.toUpperCase(), [190, 210, 230]);
    drawText(px, x1 - 96, y0 + 2, `${Math.round(secs * 1000)}MS`, [110, 110, 125]);
  });

  drawText(px, 8, 10, `GUNLAB ${label.toUpperCase()}  DB VS TIME  RULES AT -20 -40  SHA ${sha.slice(0, 12)}`, [200, 200, 210]);

  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path);
}
