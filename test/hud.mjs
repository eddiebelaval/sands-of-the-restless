/**
 * HUD, minimap, and objective-tracker harness.
 *
 * THE CLAIM THIS FILE EXISTS TO TEST is "the player can tell, without leaving
 * the crosshair, where they are and what to do next", and that decomposes into
 * four facts that fail independently and silently:
 *
 *   1. the objective is DERIVED. Walk the whole progression - the doorway, the
 *      wall gun, the debris, the gallery gate, the Kindling, a shrine, the
 *      crypt, the King's Chamber, the Altar - and the named next step has to
 *      change at every rung, from live state and not from a script.
 *   2. the map follows the player. A room transition has to move the highlight,
 *      and the fixtures have to actually be marked on it.
 *   3. nothing overlaps. The boss bar, the buy prompt and a gold popup all
 *      arrive during the same second in a real fight.
 *   4. IT IS READABLE. On sand at luma 190 and in a chamber at luma 25.
 *
 * ON THE FOURTH ONE, WHICH IS THE WHOLE REASON THE FILE IS SHAPED LIKE THIS:
 *
 * A green suite here is fully compatible with a completely black screen, and
 * that has happened three separate times on this project. State assertions are
 * not evidence about pixels. So every legibility number below comes from
 * `page.screenshot()` decoded in node - never from an in-page
 * `drawImage(renderer.domElement)`, which with preserveDrawingBuffer false
 * samples a stale or cleared buffer and once reported a sunlit courtyard at
 * luma 7.
 *
 * And contrast is measured against TWO grounds, from two real frames taken from
 * an identical camera with the HUD toggled:
 *
 *   textVsPlate   the text against the plate it actually stands on. This is the
 *                 number that decides legibility, and the one that is gated.
 *   textVsBehind  the same text against the game frame with the HUD removed,
 *                 which is what the readout had before the plates went in and
 *                 is reported to show the fix rather than assert it.
 *   lift          mean per-pixel change between the two frames inside the rect.
 *                 A HUD element that did not draw scores zero here whatever its
 *                 contrast says, which is the guard against a black-screen pass.
 *
 * Brightness never travels alone: clip fraction and spread are reported beside
 * every mean, because a fixture clipping to white scores WELL on mean luminance
 * and that is exactly how a broken mystery box passed a findability check for a
 * fortnight.
 *
 * Everything that waits, waits on STATE or on FRAMES. Under software rendering
 * the delta clamp makes simulated time run about six times slower than the wall
 * clock, so a wall-clock timeout fails systems that are working perfectly.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS } from './chrome.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const VIEW = { width: 1440, height: 860 };

/** Every legibility gate in one place. */
const GATE = {
  /** WCAG's own floor for body text. Nothing on this HUD may sit below it. */
  contrast: 4.5,
  /** Mean per-pixel change proving the element drew at all. */
  lift: 6,
  /** The frame itself rendered. Black measures 0.14; a real frame 99-124. */
  frameLuma: 12,
};

const failures = [];
const notes = [];

function check(ok, label, detail = '') {
  if (ok) { notes.push(`  ok   ${label}${detail ? `  ${detail}` : ''}`); return true; }
  failures.push(`${label}${detail ? `  ${detail}` : ''}`);
  notes.push(`  FAIL ${label}${detail ? `  ${detail}` : ''}`);
  return false;
}

// ---------------------------------------------------------------------------
// pixels
// ---------------------------------------------------------------------------

/**
 * Decode a PNG to raw samples. Enough of the format for what Chrome emits:
 * 8-bit, non-interlaced, colour type 2 (RGB) or 6 (RGBA).
 *
 * Deliberately not a dependency, and the same decoder test/mysterybox.mjs
 * carries: forty lines of zlib and arithmetic for the one file format this
 * suite produces itself, so the only thing it needs installed is the driver.
 */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  let p = 8;
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];

  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const tag = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);

    if (tag === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      depth = body[8]; type = body[9]; interlace = body[12];
    } else if (tag === 'IDAT') {
      idat.push(body);
    } else if (tag === 'IEND') break;

    p += 12 + len;
  }

  if (depth !== 8 || interlace !== 0 || (type !== 2 && type !== 6)) {
    throw new Error(`unsupported PNG: depth ${depth} type ${type} interlace ${interlace}`);
  }

  const ch = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(stride * h);

  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = (y * (stride + 1)) + 1;
    const dst = y * stride;
    const up = dst - stride;

    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= ch ? out[dst + i - ch] : 0;
      const b = y > 0 ? out[up + i] : 0;
      const c = (y > 0 && i >= ch) ? out[up + i - ch] : 0;

      let v;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`bad filter ${f}`);
      }
      out[dst + i] = v & 0xff;
    }
  }

  return { w, h, ch, data: out };
}

/** sRGB channel to linear. The inverse companding WCAG's ratio is defined on. */
const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, 0..1. */
function relLuma(r, g, b) {
  return 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
}

/**
 * Luma over an ABSOLUTE pixel rect [x0, y0, x1, y1].
 *
 * Reports the distribution and not only the mean. `clip` and `spread` are the
 * two that tell a legible readout from a blown-out one: a blob has a high mean,
 * a high clip and almost no spread, and a mean alone cannot separate them.
 */
function stats(img, rect) {
  const { w, h, ch, data } = img;
  const x0 = Math.max(0, Math.floor(rect[0]));
  const y0 = Math.max(0, Math.floor(rect[1]));
  const x1 = Math.min(w, Math.ceil(rect[2]));
  const y1 = Math.min(h, Math.ceil(rect[3]));

  const hist = new Uint32Array(256);
  const lums = [];
  let sum = 0, n = 0, lit = 0, peak = 0, clip = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * ch;
      const l = ((data[i] + data[i + 1] + data[i + 2]) / 3) | 0;
      hist[l]++;
      lums.push(relLuma(data[i], data[i + 1], data[i + 2]));
      sum += l; n++;
      if (l > 10) lit++;
      if (l > peak) peak = l;
      if (l >= 248) clip++;
    }
  }

  if (!n) return { meanLuma: 0, percentLit: 0, peak: 0, clip: 0, spread: 0, pct: () => 0 };

  const at = (q) => {
    const want = q * n;
    let acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= want) return i; }
    return 255;
  };

  lums.sort((a, b) => a - b);
  const pct = (q) => lums[Math.min(lums.length - 1, Math.max(0, Math.round(q * (lums.length - 1))))];

  return {
    meanLuma: +(sum / n).toFixed(2),
    percentLit: +((lit / n) * 100).toFixed(1),
    peak,
    clip: +((clip / n) * 100).toFixed(2),
    spread: at(0.90) - at(0.10),
    meanRel: lums.reduce((a, b) => a + b, 0) / lums.length,
    pct,
    n,
  };
}

/**
 * What changed between two frames inside a rect, as a mean AND as a count.
 *
 * The two answer different questions and the mean is the weaker one. Moving the
 * minimap's highlight from one room to another changes maybe three per cent of
 * the panel by sixty levels, which is a mean of under two - indistinguishable
 * from noise by the mean, and a wide, unambiguous margin by the count. A gate on
 * the mean alone was the first thing this file got wrong.
 */
function diff(a, b, rect) {
  const w = a.w;
  const x0 = Math.max(0, Math.floor(rect[0]));
  const y0 = Math.max(0, Math.floor(rect[1]));
  const x1 = Math.min(w, Math.ceil(rect[2]));
  const y1 = Math.min(a.h, Math.ceil(rect[3]));

  let sum = 0, n = 0, changed = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const ia = (y * w + x) * a.ch;
      const ib = (y * w + x) * b.ch;
      const dr = Math.abs(a.data[ia] - b.data[ib]);
      const dg = Math.abs(a.data[ia + 1] - b.data[ib + 1]);
      const db = Math.abs(a.data[ia + 2] - b.data[ib + 2]);
      sum += dr + dg + db;
      if (Math.max(dr, dg, db) > 12) changed++;
      n++;
    }
  }
  return {
    lift: n ? +(sum / (n * 3)).toFixed(2) : 0,
    changedPct: n ? +((changed / n) * 100).toFixed(2) : 0,
  };
}

const lift = (a, b, rect) => diff(a, b, rect).lift;

const ratio = (hi, lo) => +(((Math.max(hi, lo) + 0.05) / (Math.min(hi, lo) + 0.05)).toFixed(2));

// ---------------------------------------------------------------------------
// browser
// ---------------------------------------------------------------------------

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--autoplay-policy=no-user-gesture-required'],
});

const page = await browser.newPage({ viewport: VIEW });

const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto('http://127.0.0.1:4177/index.html', { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1400);

// ---------------------------------------------------------------------------
// helpers, injected once
// ---------------------------------------------------------------------------

await page.addScriptTag({
  content: `
window.__H__ = {
  async frames(n) {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  },

  /** The tracker's answer right now, straight from the derivation. */
  step() {
    const s = window.__SANDS__.objectives.next();
    return {
      id: s.id, stage: s.stage, text: s.text, detail: s.detail,
      where: s.where || null, cost: s.cost, gold: s.gold, affordable: s.affordable,
    };
  },

  /** What the panel is actually SHOWING, which is a different claim. */
  panel() {
    const p = window.__SANDS__.objectivePanel;
    return { text: p.text, detail: p.detail, where: p.where };
  },

  /** Put the player somewhere and point them along a yaw. */
  place(x, z, yaw) {
    const g = window.__SANDS__;
    g.player.teleport({ x, y: 0, z });
    g.rig.reset(yaw, -0.02);
    g.rig.update(1 / 60, g.player, false);
    g.camera.updateMatrixWorld(true);
  },

  /** Aim the camera at a world point and commit it to the camera matrix. */
  aimAt(x, y, z) {
    const g = window.__SANDS__;
    const c = g.player.position;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const flat = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, flat);
    g.rig.reset(yaw, pitch);
    g.rig.update(1 / 60, g.player, false);
    g.camera.updateMatrixWorld(true);
    return { yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3) };
  },

  /**
   * Move the player into a room and let the router notice.
   *
   * spaces.roomId is only rewritten by world.update while the interior is the
   * live space, so a teleport with no tick leaves the map painting the room the
   * player LEFT - which is a bug in the harness that would read as a bug in the
   * map.
   */
  goRoom(id) {
    const g = window.__SANDS__;
    const r = g.interior.rooms.find((x) => x.id === id);
    if (!r) return null;
    window.__H__.place(r.bounds.x, r.bounds.z, 0);
    g.world.update(1 / 60, 0);
    g.minimap.paint();
    return g.spaces.roomId;
  },

  /** Every visible HUD box, for the overlap check. */
  /**
   * Every visible HUD box, keyed by name.
   *
   * '#map .card-head' and '#map-canvas' are the two halves of the map card and
   * are reported separately, because a container is not a readout: the header is
   * text and the canvas is a drawing, and they are legible for different reasons
   * and have to be measured differently.
   */
  boxes() {
    const want = {
      map: '#map',
      'map-head': '#map .card-head',
      'map-canvas': '#map-canvas',
      objective: '#objective',
      'r-health': '#r-health',
      'r-gold': '#r-gold',
      'r-ammo': '#r-ammo',
      'r-boons': '#r-boons',
      boss: '#boss',
      prompt: '#prompt',
      notice: '#notice',
      crosshair: '#crosshair',
      'gold-pops': '#gold-pops',
    };
    const out = {};
    for (const key in want) {
      const el = document.querySelector(want[key]);
      if (!el || el.hidden) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out[key] = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return out;
  },

  /** The minimap's own rect, in page pixels, for cropping a screenshot. */
  mapRect() {
    const el = document.getElementById('map-canvas');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  },

  hud(on) { document.getElementById('hud').hidden = !on; },

  /**
   * Every piece of text on the HUD, with its authored colour.
   *
   * This exists because the percentile measurement below is BLIND TO DIM TEXT
   * BY CONSTRUCTION. It takes the 97th percentile inside a rect, which is the
   * brightest thing in the cluster - so a plate whose headline is bone and whose
   * third line is a muddy brown scores on the bone and reports nothing about the
   * brown. Three labels were sitting between 2.1 and 3.7 to one while every
   * cluster they live in measured above seven.
   *
   * So the two methods are complementary and both are kept: the pixels say what
   * is actually on the screen, and this says what every individual label is made
   * of. Neither on its own is the answer.
   */
  swatches() {
    const out = [];
    const seen = new Set();

    for (const el of document.querySelectorAll('#hud *')) {
      if (seen.has(el)) continue;
      // Only elements with their own text, not containers full of children.
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3 && n.textContent.trim())
        .map((n) => n.textContent.trim()).join(' ');
      if (!own) continue;

      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
      if (!el.getClientRects().length) continue;

      seen.add(el);
      out.push({
        what: el.id || el.className || el.tagName.toLowerCase(),
        text: own.slice(0, 24),
        color: cs.color,
        size: parseFloat(cs.fontSize),
      });
    }
    return out;
  },
};
`,
});

/**
 * A pair of real frames from one camera: the HUD on, and the HUD off.
 *
 * Both are page.screenshot(), which composites the DOM over the canvas, so the
 * HUD in the first one is genuinely in the pixels being measured.
 */
async function shootPair(name) {
  await page.evaluate(() => window.__H__.frames(3));
  const onBuf = await page.screenshot({ timeout: 90000 });
  writeFileSync(`${OUT}hud-${name}.png`, onBuf);

  await page.evaluate(() => window.__H__.hud(false));
  await page.evaluate(() => window.__H__.frames(3));
  const offBuf = await page.screenshot({ timeout: 90000 });
  await page.evaluate(() => window.__H__.hud(true));
  await page.evaluate(() => window.__H__.frames(2));

  return { on: decodePNG(onBuf), off: decodePNG(offBuf) };
}

/**
 * What is measured, and how.
 *
 * The minimap is deliberately split in two, because a container is not a
 * readout and measuring it as one was this file's second mistake. Nine tenths of
 * the map card is dark canvas by design, so the 97th percentile inside it lands
 * on a room FILL rather than on any ink, and the whole panel scores 1.6:1 while
 * its gold strokes are sitting at full brightness. That is a measurement bug and
 * not a legibility bug, and calibrating the map's colours against it would have
 * been the exact failure STATE.md records: a gate tuned against a broken reader.
 *
 *   map-head   the room name. Real text, measured like every other label.
 *   map-canvas the drawing. The claim there is that the INK stands off the
 *              panel, so the bright tail is taken at p99 - the strokes, the
 *              player wedge and the numerals, which together are about a per
 *              cent of the panel - rather than at p97.
 */
const CLUSTERS = [
  { id: 'map-head', ink: 0.97 },
  { id: 'map-canvas', ink: 0.99 },
  { id: 'objective', ink: 0.97 },
  { id: 'r-health', ink: 0.97 },
  { id: 'r-gold', ink: 0.97 },
  { id: 'r-ammo', ink: 0.97 },
];

const legibility = [];

/**
 * The darkest plate ground measured anywhere, in relative luminance.
 *
 * Filled in from the courtyard shot, which is the worst case by construction:
 * the plates are translucent, so the brightest scene in the game gives the
 * brightest ground, and every other moment is easier. Taken from the PIXELS
 * rather than computed from the CSS alpha, so the two checks share one number
 * and a change to the stylesheet cannot leave the audit calibrated against a
 * plate that no longer exists.
 */
let worstPlate = 0;

/**
 * Measure one moment.
 *
 * The frame itself is gated first, over the UPPER TWO THIRDS: the lower third
 * is the weapon and it renders perfectly well when nothing else in the scene
 * does, so a whole-frame mean can be carried entirely by the viewmodel.
 */
async function measure(name, label) {
  const { on, off } = await shootPair(name);

  if (on.w !== VIEW.width) {
    throw new Error(`screenshot is ${on.w}px wide, viewport is ${VIEW.width}px: `
      + 'every rect below is in CSS pixels and would be measured in the wrong place');
  }

  const frame = stats(off, [0, 0, off.w, off.h * 0.66]);
  check(frame.meanLuma > GATE.frameLuma, `${name}: frame rendered`,
    `meanLuma ${frame.meanLuma} lit ${frame.percentLit}% clip ${frame.clip}% spread ${frame.spread}`);

  const boxes = await page.evaluate(() => window.__H__.boxes());
  const row = { name, label, frame, clusters: {} };

  for (const spec of CLUSTERS) {
    const b = boxes[spec.id];
    if (!b) { check(false, `${name}: ${spec.id} present`); continue; }

    const rect = [b.x, b.y, b.x + b.w, b.y + b.h];
    const sOn = stats(on, rect);
    const sOff = stats(off, rect);

    // The ink is the bright tail inside the plate; the plate is the dark floor
    // it stands on. A percentile rather than the peak, because one antialiased
    // pixel at 255 is not a legible glyph.
    const ink = sOn.pct(spec.ink);
    const plate = sOn.pct(0.20);
    const behind = sOff.meanRel;
    const d = diff(on, off, rect);

    const m = {
      textVsPlate: ratio(ink, plate),
      textVsBehind: ratio(ink, behind),
      lift: d.lift,
      changedPct: d.changedPct,
      meanLuma: sOn.meanLuma,
      peak: sOn.peak,
      clip: sOn.clip,
      spread: sOn.spread,
      behindLuma: sOff.meanLuma,
    };
    row.clusters[spec.id] = m;
    if (plate > worstPlate) worstPlate = plate;

    check(m.textVsPlate >= GATE.contrast, `${name}: ${spec.id} contrast`,
      `${m.textVsPlate}:1 on plate (was ${m.textVsBehind}:1 against the frame, `
      + `behind luma ${m.behindLuma}) peak ${m.peak} clip ${m.clip}% spread ${m.spread}`);
    check(m.lift >= GATE.lift, `${name}: ${spec.id} actually drew`, `lift ${m.lift}`);
  }

  legibility.push(row);
  return row;
}

// ---------------------------------------------------------------------------
// 0. THE FIRST FRAME A PLAYER EVER SEES
// ---------------------------------------------------------------------------
//
// Measured FIRST, before anything below has touched the run, and that ordering
// is load-bearing rather than tidy. The sealed doorway can be opened and cannot
// be closed, so photographing the courtyard after the progression walk produced
// a map with a cleared doorway and no price on it - a picture of a state no new
// player is ever in, standing in for the one state every new player starts in.

await page.evaluate(() => {
  const g = window.__SANDS__;
  g.combat.state.invulnerable = true;
  g.director.reset();
  window.__H__.place(0, 24, 0);
});
await page.evaluate(() => window.__H__.frames(6));
await measure('01-courtyard', 'the sunlit avenue, 500 gold against a 1000 doorway');

// ---------------------------------------------------------------------------
// 1. THE OBJECTIVE, walked end to end
// ---------------------------------------------------------------------------
//
// Every rung is driven by changing STATE and nothing else. Not one line below
// tells the tracker what to say; it is asked, and the answer is asserted.

const progression = [];

async function stage(label, mutate) {
  if (mutate) await page.evaluate(mutate);
  await page.evaluate(() => window.__H__.frames(2));
  const step = await page.evaluate(() => window.__H__.step());
  const panel = await page.evaluate(() => window.__H__.panel());
  progression.push({ label, ...step, panel });
  return { step, panel };
}

// --- reset to a clean run ----------------------------------------------------
await page.evaluate(() => {
  const g = window.__SANDS__;
  g.combat.state.invulnerable = true;
  g.director.reset();
  g.economy.reset(500);
});

// a. the opening minute: 500 gold against a 1000 doorway
{
  const { step, panel } = await stage('courtyard, 500 gold');
  check(step.text === 'BUY THE SEALED DOORWAY', 'objective a: the doorway', step.text);
  check(step.detail === '1000 GOLD  -  500 SHORT', 'objective a: shortfall quoted', step.detail);
  check(step.affordable === false, 'objective a: not affordable');
  check(panel.text === step.text, 'objective a: panel agrees with derivation', panel.text);
}

// b. the purse covers it. Same step, different instruction.
{
  const { step } = await stage('courtyard, 1000 gold',
    () => window.__SANDS__.economy.grant(500, 'harness'));
  check(step.text === 'BUY THE SEALED DOORWAY', 'objective b: still the doorway', step.text);
  check(step.detail === '1000 GOLD  -  PRESS F', 'objective b: instruction, not shortfall', step.detail);
  check(step.affordable === true, 'objective b: affordable');
}

// c. bought, not yet walked through
{
  const { step } = await stage('doorway open, still outside', () => {
    const g = window.__SANDS__;
    const d = g.doors.byId('courtyard/entry');
    g.economy.spend(d.cost, 'harness');
    d.open();
  });
  check(step.text === 'ENTER THE PYRAMID', 'objective c: go through it', step.text);
}

// d. inside. The first wall buy is dead ahead of the spawn.
{
  const { step } = await stage('chamber of ascent', () => {
    const g = window.__SANDS__;
    g.spaces.enter('interior', { x: 0, z: -143.5, rot: 0 });
    g.world.update(1 / 60, 0);
  });
  check(/^BUY THE .+ OFF THE WALL$/.test(step.text), 'objective d: a wall gun', step.text);
  check(step.where === 'CHAMBER OF ASCENT', 'objective d: names the room', String(step.where));
  check(step.cost === 1000, 'objective d: quotes the wall price', String(step.cost));
}

// e. armed. Next is the debris, because the route to the Kindling runs through
//    it - nothing in the tracker knows the word "debris" until the graph says so.
{
  const { step } = await stage('smg in hand', () => {
    const g = window.__SANDS__;
    g.weapons.grant('smg');
    g.weapons.equip('smg');
  });
  check(step.text.startsWith('CLEAR THE DEBRIS TO '), 'objective e: the debris', step.text);
  check(/HALL OF OFFERINGS|GRANARY VAULT/.test(step.text),
    'objective e: names a room the debris actually opens', step.text);
  check(step.cost === 750, 'objective e: the authored debris price', String(step.cost));
}

// f. one half of the map open. The next shut thing on the route is the gate.
{
  const { step } = await stage('hall debris cleared', () => {
    const g = window.__SANDS__;
    const d = g.doors.all.find((x) => x.id === 'chamber-of-ascent/hall-of-offerings');
    d.open();
  });
  check(step.text === 'OPEN THE WAY TO EMBALMING CHAMBER',
    'objective f: the gallery gate', step.text);
  check(step.cost === 1000, 'objective f: the authored gate price', String(step.cost));
}

// g. standing in the room with the lever in it
{
  const { step } = await stage('in the embalming chamber', () => {
    const g = window.__SANDS__;
    g.doors.all.find((x) => x.id === 'great-gallery/embalming-chamber').open();
    window.__H__.goRoom('embalming-chamber');
  });
  check(step.text === 'LIGHT THE KINDLING', 'objective g: the Kindling', step.text);
  check(step.detail === 'PRESS F AT THE LEVER', 'objective g: how', step.detail);
}

// h. the map wakes. Shrines become the next thing that exists.
{
  const { step } = await stage('powered', () => window.__SANDS__.power.throwSwitch());
  check(step.text.startsWith('TAKE THE SHRINE OF '), 'objective h: a boon', step.text);
  check(step.stage === 'boon', 'objective h: on the boon rung', step.stage);
}

// i. carrying one. Next is the Altar, which is behind two more doorways.
{
  const { step } = await stage('one boon held', () => {
    const g = window.__SANDS__;
    g.economy.grant(4000, 'harness');
    g.shrines.grant('sekhmet');
  });
  check(step.text === 'OPEN THE WAY TO CANOPIC CRYPT',
    'objective i: the crypt gate stands between here and the Altar', step.text);
  check(step.stage === 'altar', 'objective i: on the altar rung', step.stage);
}

// j. the power gate. It has a condition, not a price, and says so.
{
  const { step } = await stage('crypt open', () => {
    window.__SANDS__.doors.all.find((x) => x.id === 'great-gallery/canopic-crypt').open();
  });
  check(step.text === "OPEN THE WAY TO KING'S CHAMBER",
    'objective j: the power gate', step.text);
  check(step.cost === 0 && step.detail === 'PRESS F',
    'objective j: no price, because the Kindling already paid for it', step.detail);
}

// k. in the arena with the Altar in it
{
  const { step } = await stage("in the king's chamber", () => {
    window.__SANDS__.doors.all.find((x) => x.id === 'canopic-crypt/kings-chamber').open();
    window.__H__.goRoom('kings-chamber');
  });
  check(step.text === 'RENEW YOUR WEAPON AT THE ALTAR', 'objective k: the Altar', step.text);
  check(step.cost === 5000, 'objective k: the first price is the wall', String(step.cost));
  check(step.affordable === false && /SHORT/.test(step.detail),
    'objective k: shortfall quoted', step.detail);
}

// l. past the spine. The tail names the cheapest thing still unbought, and it
//    must still be a real, reachable, named thing.
{
  const { step } = await stage('one weapon renewed', () => {
    const g = window.__SANDS__;
    g.economy.grant(6000, 'harness');
    const rec = g.interacts.records.find((r) => r.type === 'altar');
    g.altar.buy(rec);
  });
  check(step.stage === 'survive', 'objective l: off the ladder', step.stage);
  check(!!step.text && step.text.length > 3, 'objective l: still names something', step.text);
}

check(new Set(progression.map((p) => p.text)).size >= 8,
  'the objective actually MOVED through the run',
  `${new Set(progression.map((p) => p.text)).size} distinct steps over ${progression.length} stages`);

// ---------------------------------------------------------------------------
// 2. THE MINIMAP
// ---------------------------------------------------------------------------

// --- it follows the player ---------------------------------------------------
{
  const a = await page.evaluate(() => {
    window.__H__.goRoom('great-gallery');
    return { room: window.__SANDS__.minimap.state.room,
             label: document.getElementById('map-room').textContent };
  });
  check(a.room === 'great-gallery', 'minimap: room after transition', String(a.room));
  check(a.label === 'Great Gallery', 'minimap: names the room', a.label);

  const b = await page.evaluate(() => {
    window.__H__.goRoom('star-shaft');
    return { room: window.__SANDS__.minimap.state.room,
             label: document.getElementById('map-room').textContent };
  });
  check(b.room === 'star-shaft', 'minimap: follows a second transition', String(b.room));
  check(b.label === 'Star Shaft', 'minimap: relabels', b.label);
}

// --- the highlight MOVES, in pixels ------------------------------------------
//
// The state assertion above is compatible with a canvas that never repaints.
// Two crops of two real screenshots are not.
{
  const rect = await page.evaluate(() => window.__H__.mapRect());
  const box = [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h];

  await page.evaluate(() => window.__H__.goRoom('chamber-of-ascent'));
  await page.evaluate(() => window.__H__.frames(3));
  const one = decodePNG(await page.screenshot({ timeout: 90000 }));

  await page.evaluate(() => window.__H__.goRoom('kings-chamber'));
  await page.evaluate(() => window.__H__.frames(3));
  const two = decodePNG(await page.screenshot({ timeout: 90000 }));

  // COUNTED, not averaged. Two rooms out of nine changing value is three per
  // cent of the panel: an unambiguous count and a mean under two, which is
  // indistinguishable from noise. See diff() above.
  const moved = diff(one, two, box);
  check(moved.changedPct > 1.5, 'minimap: the highlight repaints on a room change',
    `${moved.changedPct}% of the panel changed (mean lift ${moved.lift})`);

  // Structure means a dark ground with bright ink ON it, which is a claim about
  // the SHAPE of the distribution and not about its width. A flat plate has a
  // peak equal to its mean and a spread near zero; a floorplan of nine mostly
  // unlit rooms is legitimately narrow in the middle and has a long bright tail,
  // and gating on spread alone was asking a floorplan to be a photograph.
  //
  // clip is measured beside peak deliberately. A mark blowing out to white
  // RAISES every brightness number here while being less readable, which is the
  // exact way the mystery box's findability check rewarded a broken fixture.
  const s = stats(one, box);
  check(s.peak > 150 && s.spread > 18, 'minimap: has structure, not a flat plate',
    `peak ${s.peak} spread ${s.spread} mean ${s.meanLuma} lit ${s.percentLit}%`);
  check(s.clip < 2, 'minimap: nothing on it is blowing out', `clip ${s.clip}%`);
}

// --- the fixtures are ON it, in pixels ---------------------------------------
//
// The shrines are the honest probe, because every one of them is drawn in its
// own flame colour out of BOON_LOOK and no other thing on the panel is that
// hue. Counting pixels near those six hues inside the map rect proves the marks
// were rasterised - a state assertion that "there are six shrine records" would
// pass on a canvas that drew nothing at all.
{
  const found = await page.evaluate(() => {
    const g = window.__SANDS__;
    const el = document.getElementById('map-canvas');
    const c = el.getContext('2d');
    const { width, height } = el;
    const px = c.getImageData(0, 0, width, height).data;

    // Read off the CANVAS, which is this file's own output and has no
    // preserveDrawingBuffer problem: a 2D context keeps its bitmap.
    const want = {
      sekhmet: [0xff, 0x3c, 0x14], ptah: [0x1f, 0xd9, 0x7a], set: [0x8a, 0x2f, 0xf0],
      shu: [0x36, 0xc8, 0xff], anubis: [0x9f, 0xb4, 0xff], thoth: [0xff, 0xa0, 0x18],
    };
    const hits = {};
    for (const k in want) hits[k] = 0;

    for (let i = 0; i < px.length; i += 4) {
      for (const k in want) {
        const [r, gg, b] = want[k];
        if (Math.abs(px[i] - r) < 26 && Math.abs(px[i + 1] - gg) < 26
          && Math.abs(px[i + 2] - b) < 26) hits[k]++;
      }
    }

    return {
      hits,
      fixtures: g.interacts.records.length,
      boxes: g.interacts.records.filter((r) => r.type === 'box').length,
      shrines: g.interacts.records.filter((r) => r.type === 'shrine').length,
    };
  });

  const lit = Object.entries(found.hits).filter(([, n]) => n > 8);
  check(lit.length === 6, 'minimap: all six shrines are drawn in their own flame colours',
    Object.entries(found.hits).map(([k, n]) => `${k}:${n}px`).join(' '));
  check(found.boxes === 3, 'minimap: all three chest placements exist to be drawn',
    `${found.boxes} plinths`);
}

// --- the chest, and the fact that it MOVES -----------------------------------
{
  const rect = await page.evaluate(() => window.__H__.mapRect());
  const box = [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h];

  await page.evaluate(() => { window.__SANDS__.mysterybox.placeAt('A'); window.__SANDS__.minimap.paint(); });
  await page.evaluate(() => window.__H__.frames(3));
  const atA = decodePNG(await page.screenshot({ timeout: 90000 }));

  await page.evaluate(() => { window.__SANDS__.mysterybox.placeAt('C'); window.__SANDS__.minimap.paint(); });
  await page.evaluate(() => window.__H__.frames(3));
  const atC = decodePNG(await page.screenshot({ timeout: 90000 }));

  const moved = diff(atA, atC, box);
  check(moved.changedPct > 0.02, 'minimap: the live chest moves with the box',
    `${moved.changedPct}% of the panel changed`);

  const legend = await page.evaluate(() =>
    (document.querySelector('.map-foot .key') || {}).textContent || '');
  check(/chest moves/i.test(legend), 'minimap: says the chest moves', legend.trim());
}

// ---------------------------------------------------------------------------
// 3. NOTHING OVERLAPS, under the worst frame the game can produce
// ---------------------------------------------------------------------------

await page.evaluate(async () => {
  const g = window.__SANDS__;

  // A boss on the bar, a prompt under the crosshair, and a fistful of gold
  // popups: three elements that in a real fight all arrive inside one second.
  g.director.forceWave(5);
  g.director.update(1 / 30, 0);
  for (let i = 0; i < 40 && !g.director.boss; i++) g.director.update(1 / 30, i / 30);

  window.__H__.goRoom('chamber-of-ascent');
  const wall = g.interacts.records.find((r) => r.type === 'wallbuy');
  window.__H__.place(wall.x, wall.z + 3.2, Math.PI);
  window.__H__.aimAt(wall.x, 2.3, wall.z);
  g.interacts.update();
  g.promptBus.paint();

  for (let i = 0; i < 6; i++) g.economy.pop('+100', 'crit');
  g.economy.grant(400, 'harness');
});

await page.evaluate(() => window.__H__.frames(4));

{
  const boxes = await page.evaluate(() => window.__H__.boxes());

  // The two halves of the map card are inside the map card, so a containment
  // test between them and it is not a clash, it is the DOM.
  const ids = Object.keys(boxes).filter((k) => k !== 'map-head' && k !== 'map-canvas');

  // The crosshair, the hitmarker and the popup anchor all live ON the centre of
  // the screen and are meant to. Overlap between those is the design.
  const CENTRE = new Set(['crosshair', 'gold-pops', 'hitmarker']);

  const clashes = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = boxes[ids[i]], b = boxes[ids[j]];
      if (CENTRE.has(ids[i]) && CENTRE.has(ids[j])) continue;
      const over = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
        * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (over > 1) clashes.push(`${ids[i]} x ${ids[j]} = ${Math.round(over)}px2`);
    }
  }

  check(clashes.length === 0,
    'no two HUD elements overlap with a boss, a prompt and gold popups all live',
    clashes.length ? clashes.join('; ') : `${ids.length} elements: ${ids.join(', ')}`);

  const hasBoss = !!boxes.boss;
  const hasPrompt = !!boxes.prompt;
  check(hasBoss && hasPrompt, 'the worst-case frame really had all three up',
    `boss ${hasBoss} prompt ${hasPrompt}`);
}

await measure('05-boss', 'boss bar, buy prompt and gold popups at once');

// ---------------------------------------------------------------------------
// 4. LEGIBILITY, at the moments that matter
// ---------------------------------------------------------------------------

// --- mid-fight, outside ------------------------------------------------------
await page.evaluate(() => {
  const g = window.__SANDS__;
  g.director.reset();
  g.spaces.enter('exterior', { x: 0, z: 24, rot: 0 });
  g.world.update(1 / 60, 0);
  g.director.forceWave(3);
  for (let i = 0; i < 90; i++) g.director.update(1 / 30, i / 30);
  window.__H__.place(0, 20, 0);

  // Hurt, and RECENTLY hurt. systems/damage.js regenerates at 14 a second five
  // seconds after the last blow, and it starts a run with that timer already
  // expired - so a bare write to health was healing back over the third
  // threshold during the two screenshots this measurement takes, and the plate
  // was correctly not red by the time it was asked. Setting the clock is what
  // makes the state the harness asked for the state that is photographed.
  g.combat.state.sinceHit = 0;
  g.player.state.health = g.player.state.maxHealth * 0.24;
  for (let i = 0; i < 4; i++) g.economy.pop('+60', 'gain');
});
await page.evaluate(() => window.__H__.frames(4));
{
  const hurt = await page.evaluate(() => ({
    on: document.getElementById('r-health').classList.contains('hurt'),
    frac: window.__SANDS__.player.state.health / window.__SANDS__.player.state.maxHealth,
  }));
  check(hurt.on, 'the vitality plate turns at a third', `at ${(hurt.frac * 100).toFixed(0)}%`);
  await measure('02-fight', 'mid-fight in the courtyard, vitality low');
}

// --- inside ------------------------------------------------------------------
await page.evaluate(() => {
  const g = window.__SANDS__;
  g.director.reset();
  g.player.heal(999);
  g.spaces.enter('interior', { x: 0, z: -143.5, rot: 0 });
  g.world.update(1 / 60, 0);
});
await page.evaluate(() => window.__H__.frames(6));
await measure('03-interior', 'inside the pyramid, HUD over dark stone');

// --- at a buy-door -----------------------------------------------------------
await page.evaluate(() => {
  const g = window.__SANDS__;
  const b = g.doors.all.find((x) => x.id === 'chamber-of-ascent/granary-vault' && !x.opened);
  const d = b || g.doors.all.find((x) => !x.opened && x.from);
  window.__H__.place(d.x, d.z + 4.4, 0);
  window.__H__.aimAt(d.x, d.y, d.z);
  g.doors.update(1 / 60);
  g.promptBus.paint();
});
await page.evaluate(() => window.__H__.frames(4));
{
  const prompt = await page.evaluate(() => document.getElementById('prompt').textContent);
  check(!!prompt, 'the buy-door prompt is up for the shot', prompt);
  await measure('04-buydoor', 'standing at a buy-door with its price quoted');
}

// --- the mystery box, open ---------------------------------------------------
await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.economy.grant(4000, 'harness');
  g.mysterybox.placeAt('B');
  window.__H__.goRoom('great-gallery');

  const rec = g.mysterybox.record;
  window.__H__.place(rec.x, rec.z + 4.2, 0);
  window.__H__.aimAt(rec.x, 1.6, rec.z);

  g.mysterybox.buy(rec);
  // Simulated seconds, driven directly: the roll is four seconds of simulation
  // and a wall-clock wait for it under software rendering is a minute.
  for (let i = 0; i < 260 && g.mysterybox.phase !== 'presenting'; i++) {
    g.mysterybox.update(1 / 30, i / 30);
  }
  g.interacts.update();
  g.promptBus.paint();
});
await page.evaluate(() => window.__H__.frames(4));
{
  const phase = await page.evaluate(() => window.__SANDS__.mysterybox.phase);
  check(phase === 'presenting' || phase === 'settling',
    'the chest is holding an offer up for the shot', phase);
  await measure('06-box', 'the Chest of the Nameless, offer standing');
}

// ---------------------------------------------------------------------------
// 5. EVERY LABEL, not only the brightest one in each plate
// ---------------------------------------------------------------------------

const swatches = [];
{
  // Put the whole HUD into its busiest state so nothing is skipped for being
  // hidden: the boss bar, the prompt, the notice, a boon chip and the hurt
  // vitality plate all carry text that no other moment above puts on screen.
  await page.evaluate(() => {
    const g = window.__SANDS__;
    g.shrines.grant('thoth');
    g.player.state.health = g.player.state.maxHealth * 0.2;
    g.combat.state.sinceHit = 0;

    // Empty the purse rather than adding the class by hand. The panel rewrites
    // `.short` from state on every frame, so a class poked in from the harness
    // is gone again before the audit reads it - and the red shortfall line, one
    // of the three colours this section exists to catch, would never be seen.
    g.economy.reset(0);

    document.getElementById('notice').textContent = 'THE KINDLING TAKES';
    document.getElementById('notice').classList.add('on');
    // The boss bar carries a name nothing else on the HUD does.
    document.getElementById('boss').hidden = false;
  });
  await page.evaluate(() => window.__H__.frames(3));

  const found = await page.evaluate(() => window.__H__.swatches());

  for (const s of found) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s.color);
    if (!m) continue;
    const l = relLuma(+m[1], +m[2], +m[3]);
    const r = ratio(l, worstPlate);
    swatches.push({ ...s, ratio: r });

    check(r >= GATE.contrast, `label contrast: ${s.what}`,
      `"${s.text}" ${s.color} at ${s.size}px = ${r}:1 on the worst plate `
      + `(rel luma ${worstPlate.toFixed(4)}, measured in the courtyard)`);
  }

  check(swatches.length >= 8, 'the audit actually found the HUD text',
    `${swatches.length} labels`);
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const errors = logs.filter((l) => /pageerror|\[error\]/.test(l));
check(errors.length === 0, 'no console errors', errors.slice(0, 4).join(' | '));

console.log('\n=== THE OBJECTIVE, AT EVERY STAGE ===\n');
for (const p of progression) {
  console.log(`  ${p.label.padEnd(30)} ${p.text}`);
  console.log(`  ${''.padEnd(30)}   ${p.detail}${p.where ? `   [${p.where}]` : ''}`);
}

console.log('\n=== LEGIBILITY (contrast of HUD text against its own plate) ===\n');
console.log(`  ${'moment'.padEnd(14)}${'cluster'.padEnd(11)}${'onPlate'.padEnd(9)}`
  + `${'vsFrame'.padEnd(9)}${'lift'.padEnd(8)}${'clip%'.padEnd(7)}${'spread'.padEnd(7)}behindLuma`);
for (const row of legibility) {
  for (const [id, m] of Object.entries(row.clusters)) {
    console.log(`  ${row.name.padEnd(14)}${id.padEnd(11)}`
      + `${`${m.textVsPlate}:1`.padEnd(9)}${`${m.textVsBehind}:1`.padEnd(9)}`
      + `${String(m.lift).padEnd(8)}${String(m.clip).padEnd(7)}`
      + `${String(m.spread).padEnd(7)}${m.behindLuma}`);
  }
}

console.log('\n=== EVERY LABEL, against the worst plate the game can produce ===\n');
for (const s of swatches.sort((a, b) => a.ratio - b.ratio)) {
  console.log(`  ${String(s.ratio).padStart(6)}:1  ${String(`${s.size}px`).padEnd(7)}`
    + `${s.color.padEnd(20)}${s.what.padEnd(14)}"${s.text}"`);
}

console.log('\n=== CHECKS ===\n');
console.log(notes.join('\n'));

await browser.close();

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`\nHUD suite green: ${notes.length} checks, ${legibility.length} measured moments.`);
console.log(`Shots in ${OUT}hud-*.png`);
