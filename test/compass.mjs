/**
 * DOES THE COMPASS POINT THE RIGHT WAY.
 *
 * The whole risk in a compass is a sign error, and a sign error is invisible in
 * a screenshot and obvious the moment somebody turns. `ui/minimap.js` carries a
 * long note recording that it got exactly this wrong twice, in two different
 * places, in a file whose author was being careful.
 *
 * So the reasoning in `bearingOf()` - that the camera's forward vector for
 * `rotation.y = yaw` is `(-sin yaw, 0, -cos yaw)`, so with north at -Z the
 * player's bearing is simply `-yaw` - is exactly the kind of derivation that is
 * convincing and wrong. This drives the real rig to each cardinal and reads
 * back what actually landed under the index.
 *
 * ---------------------------------------------------------------------------
 * THE CONTROLS
 * ---------------------------------------------------------------------------
 *
 * A compass that drew nothing would pass "no cardinal is misplaced". A compass
 * that drew a fixed strip would pass "N is at the centre when facing north". So:
 *
 *   THE STRIP MUST MOVE, and move the correct way. Turning right must send the
 *   marks LEFT. A strip that scrolled backwards passes every static check.
 *
 *   ALL FOUR CARDINALS ARE TESTED, not just north. A convention that is off by
 *   90 degrees puts N at the centre when the player faces east, and a test that
 *   only ever checks north cannot see it.
 *
 *   THE MARKS MUST BE ON THE CANVAS. Pixels, because a strip that computes
 *   perfect bearings into an element with zero size is the failure mode this
 *   project keeps finding.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4188/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start());
await page.waitForTimeout(800);

/** Point the rig at a compass bearing and read the strip back. */
async function face(deg) {
  return page.evaluate((d) => {
    const g = window.__SANDS__;
    // bearingOf() is `-yaw` in degrees, so the inverse is `-deg` in radians.
    g.rig.setYaw ? g.rig.setYaw((-d * Math.PI) / 180) : (g.rig.yaw = (-d * Math.PI) / 180);
    g.compass.update();
    const s = g.compass.stats();
    return {
      bearing: s.bearing,
      centred: s.centred,
      marks: s.marks,
      cardinals: s.marks.filter((m) => m.kind === 'cardinal'),
    };
  }, deg);
}

// The rig may not expose a setter; find out before trusting any of this.
const settable = await page.evaluate(() => {
  const g = window.__SANDS__;
  const before = g.rig.yaw;
  try { g.rig.yaw = before + 1; } catch { /* getter only */ }
  const moved = Math.abs(g.rig.yaw - before) > 0.5;
  try { g.rig.yaw = before; } catch {}
  return { moved, hasSetter: typeof g.rig.setYaw === 'function' };
});

console.log('');
console.log(`  rig yaw writable: ${settable.moved}   setYaw(): ${settable.hasSetter}`);
console.log('');

if (!settable.moved && !settable.hasSetter) {
  // `yaw` is exposed through a getter in player/camera.js, so if neither works
  // this suite cannot steer and must say so rather than passing vacuously.
  ok(false, 'BLOCKED: the rig heading cannot be driven from a harness');
  console.log('');
  console.log(`${fail} FAILED of ${pass + fail}`);
  await browser.close();
  process.exit(1);
}

// ------------------------------------------------------------ the four
console.log('  facing      bearing   nearest mark   off by');
for (const [deg, want] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
  const r = await face(deg);
  console.log(`  ${String(deg).padStart(3)} deg     ${r.bearing.toFixed(1).padStart(6)}    ${r.centred.label}              ${r.centred.off.toFixed(1)}`);
  ok(r.centred.label === want && r.centred.off < 1.0,
    `facing ${deg} puts ${want} under the index (got ${r.centred.label}, off by ${r.centred.off.toFixed(1)} deg)`);
}
console.log('');

// ------------------------------------------------------- control: it moves
// Turning RIGHT must send the marks LEFT. A strip that scrolled the wrong way
// passes every static check above.
{
  const a = await face(0);
  const b = await face(20);
  const nA = a.cardinals.find((m) => m.label === 'N');
  const nB = b.cardinals.find((m) => m.label === 'N');

  ok(!!nA && !!nB, 'north is drawn on both sides of a 20 degree turn');
  if (nA && nB) {
    console.log(`  north at x=${nA.x} facing 0, x=${nB.x} facing 20 (turned right)`);
    console.log('');
    ok(nB.x < nA.x - 20,
      `CONTROL: turning right sends the strip LEFT (${nA.x} -> ${nB.x} px)`);
  }
}

// --------------------------------------------- control: it is on the canvas
{
  await face(0);
  const box = await page.evaluate(() => {
    const el = document.getElementById('compass');
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, top: r.top, hidden: !r.width || !r.height };
  });
  ok(!box.hidden, `the strip occupies real space (${box.w} x ${box.h} at y=${Math.round(box.top)})`);
  ok(box.top < 60, 'and it is at the TOP of the screen, where it was asked for');

  /*
   * READ THE COMPASS CANVAS ITSELF, NOT A SCREENSHOT OF THE PAGE.
   *
   * The first cut cropped a page region at the top of the screen and measured
   * 100.00% "ink" with a warmth of -18: it was photographing the SKY. The strip
   * deliberately has no plate behind it - a panel across the top of the screen
   * would be the largest opaque object in the game - so a page crop is mostly
   * whatever the player happens to be looking at.
   *
   * This is a 2D canvas, so its own backing store can be read directly. Every
   * pixel is either transparent, meaning nothing was drawn, or a mark. There is
   * no background to subtract and nothing else can contaminate it.
   */
  const px = await page.evaluate(() => {
    const el = document.getElementById('compass');
    const d = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
    let lit = 0, total = 0, sumR = 0, sumB = 0, dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      total++;
      const a = d[i + 3];
      if (a <= 8) continue;
      // A MARK, not merely "something was drawn". The strip now paints a dark
      // scrim under itself so the gold survives a sunlit sky, and that scrim
      // has alpha everywhere - so alpha alone would report the ground as ink.
      if (d[i] + d[i + 1] + d[i + 2] > 260) { lit++; sumR += d[i]; sumB += d[i + 2]; }
      else dark++;
    }
    return { frac: lit / total, warmth: lit ? (sumR - sumB) / lit : 0, scrim: dark / total };
  });

  console.log(`  ink on the strip ${(px.frac * 100).toFixed(2)}%   warmth R-B ${px.warmth.toFixed(1)}   scrim ${(px.scrim * 100).toFixed(1)}%`);
  ok(px.frac > 0.002, `CONTROL: there are actually marks on screen (${(px.frac * 100).toFixed(2)}%)`);
  ok(px.warmth > 8, `CONTROL: and they are gold, not white (R-B ${px.warmth.toFixed(1)})`);

  /*
   * CAN YOU SEE IT AGAINST THE SKY. This is the check that matters and it did
   * not exist in the first version, which is why the strip shipped washed out.
   *
   * The compass sits over the courtyard for the whole of Act 1, and ui/tokens.js
   * names that ground - a translucent readout over sunlit sand - as the worst
   * in the game. Measuring the canvas alone says the marks are gold; it cannot
   * say whether a player can find them. So: photograph the same frame twice
   * with only the strip's visibility toggled, and measure how far the composite
   * actually moves where the marks are.
   */
  const ab = await page.evaluate(async () => {
    const el = document.getElementById('compass');
    const r = el.getBoundingClientRect();
    // SIZED FROM THE ELEMENT, not from a literal. The first version hardcoded
    // 420x34 and kept passing until the strip was widened to 560, at which
    // point it sampled a misaligned region and reported the marks as invisible.
    const CW = Math.round(r.width), CH = Math.round(r.height);

    const cv = document.querySelector('canvas:not(#compass):not(#map-canvas)');
    const c = document.createElement('canvas');
    c.width = CW; c.height = CH;
    const x = c.getContext('2d');
    const s = cv.width / cv.clientWidth;
    x.drawImage(cv, r.left * s, r.top * s, CW * s, CH * s, 0, 0, CW, CH);
    const bg = x.getImageData(0, 0, CW, CH).data;

    x.drawImage(el, 0, 0, CW, CH);
    const over = x.getImageData(0, 0, CW, CH).data;

    const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const src = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
    const sc = el.width / CW;
    let moved = 0, sum = 0, worst = 1e9, n = 0;
    for (let y = 0; y < CH; y++) {
      for (let px2 = 0; px2 < CW; px2++) {
        const si = ((y * sc | 0) * el.width + (px2 * sc | 0)) * 4;
        if (src[si] + src[si + 1] + src[si + 2] <= 260 || src[si + 3] <= 8) continue;
        const i = (y * CW + px2) * 4;
        const d = Math.abs(lum(over, i) - lum(bg, i));
        n++; sum += d; if (d < worst) worst = d;
        if (d > 25) moved++;
      }
    }
    return { n, mean: n ? sum / n : 0, worst: n ? worst : 0, strong: n ? moved / n : 0 };
  });

  console.log(`  against the live sky: ${ab.n} mark px, mean dL ${ab.mean.toFixed(1)}, ${(ab.strong * 100).toFixed(0)}% moved >25`);
  console.log('');

  ok(ab.n > 200, `CONTROL: the A/B found the marks to measure (${ab.n} px)`);
  ok(ab.mean > 40,
    `THE MARKS SURVIVE A SUNLIT SKY (mean luminance shift ${ab.mean.toFixed(1)} where they are drawn)`);
  ok(ab.strong > 0.7,
    `and it is most of them, not an average hiding a washout (${(ab.strong * 100).toFixed(0)}% shifted more than 25)`);
}

// ------------------------------------------------ it does not show the horde
{
  const kinds = await page.evaluate(() => {
    const g = window.__SANDS__;
    g.director.forceWave(8);
    for (let i = 0; i < 60; i++) g.director.update(1 / 30, i / 30);
    g.compass.update();
    return [...new Set(g.compass.stats().marks.map((m) => m.kind))];
  });
  console.log(`  mark kinds with a live horde: ${kinds.join(', ')}`);
  console.log('');
  ok(!kinds.includes('enemy'),
    'CONTROL: a live horde puts NOTHING on the compass - locating enemies stays the audio lane\'s job');
}

// ------------------------------------------------------------ the fixtures
//
// The first version of this file could only assert that fixtures were ABSENT,
// because the pips it was written for could never draw. Now they are the
// feature, and the checks that matter are that they exist, that they are the
// same objects the map draws, and that size actually tracks distance - the last
// being the owner's specific ask and the one a static screenshot cannot verify.
{
  const fx = await page.evaluate(() => {
    const g = window.__SANDS__;
    g.director.forceWave(1);
    for (let i = 0; i < 20; i++) g.director.update(1 / 30, i / 30);
    g.compass.update();
    const marks = g.compass.stats().marks.filter((m) => m.kind !== 'cardinal');
    return {
      marks,
      kinds: [...new Set(marks.map((m) => m.kind))],
      records: (g.interacts?.records || []).length,
    };
  });

  console.log(`  ${fx.records} fixture records in the game, ${fx.marks.length} on the strip`);
  for (const m of fx.marks.slice(0, 6)) {
    console.log(`    ${String(m.kind).padEnd(13)} ${String(m.dist).padStart(3)} m   size ${m.size}`);
  }
  console.log('');

  ok(fx.records > 0, `CONTROL: the game publishes fixtures at all (${fx.records})`);
  ok(fx.marks.length > 0, `fixtures reach the compass (${fx.marks.length} drawn)`);
  ok(fx.marks.length <= 12, `and are capped so the strip cannot become a dotted line (${fx.marks.length})`);

  // SIZE TRACKS DISTANCE. Sorted by distance, size must never increase.
  const byDist = fx.marks.slice().sort((a, b) => a.dist - b.dist);
  let monotonic = true;
  for (let i = 1; i < byDist.length; i++) {
    if (byDist[i].size > byDist[i - 1].size + 0.01) { monotonic = false; break; }
  }
  ok(monotonic, 'NEARER IS LARGER, with no exceptions along the whole list');

  if (byDist.length >= 2) {
    const a = byDist[0], b = byDist[byDist.length - 1];
    ok(a.size > b.size,
      `and the spread is real (${a.dist} m at ${a.size} px against ${b.dist} m at ${b.size} px)`);
  }
}

// ------------------------------------------------------------- the beacons
//
// The Easter egg seam. It ships with nothing registered, so the check is that a
// beacon pushed from outside DOES appear - otherwise the hook is a comment.
{
  const beacon = await page.evaluate(() => {
    const g = window.__SANDS__;
    const before = g.compass.stats().marks.filter((m) => m.kind === 'beacon').length;

    // Stand one 12 m in front of the player, the way a hidden thing would be.
    const p = g.player.position;
    g.__SANDS_TEST_BEACON = { id: 'probe', x: p.x, z: p.z - 12, role: 'ready', shape: 'diamond' };
    const list = g.compass.beacons ? null : null;
    // The provider main.js passes reads a live array; reach it the same way.
    if (Array.isArray(g.eggBeacons)) g.eggBeacons.push(g.__SANDS_TEST_BEACON);
    g.compass.update();
    const after = g.compass.stats().marks.filter((m) => m.kind === 'beacon');
    if (Array.isArray(g.eggBeacons)) g.eggBeacons.length = 0;
    return { before, after, exposed: Array.isArray(g.eggBeacons), list };
  });

  if (!beacon.exposed) {
    console.log('  beacon list is not reachable from the harness');
    console.log('');
    ok(false, 'BLOCKED: eggBeacons is not exposed, so the Easter egg seam is untested');
  } else {
    console.log(`  beacons before ${beacon.before}, after pushing one: ${beacon.after.length}`);
    console.log('');
    ok(beacon.before === 0, 'CONTROL: nothing is registered on a clean run');
    ok(beacon.after.length === 1, 'a pushed beacon DOES reach the strip');
  }
}

ok(errors.length === 0, `no console errors (${errors.length})`);
if (errors.length) for (const e of errors.slice(0, 5)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
