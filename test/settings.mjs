/**
 * THE PAUSE MENU AND THE SETTINGS PANEL.
 *
 * THE CLAIM THIS FILE EXISTS TO TEST is not "an overlay appears". It is:
 *
 *   1. THE SIMULATION STOPS. Not slows, not hides: an enemy's position does not
 *      change across forty real frames, a cooking grenade's fuse does not
 *      advance by a millisecond, and the loop's own simulated clock does not
 *      move while the loop itself keeps running. Those are three separate
 *      numbers because they fail separately, and the third one is the guard
 *      against a vacuous pass: a frame loop that had stopped scheduling would
 *      satisfy the first two perfectly.
 *   2. RESUME PUTS IT BACK, and asks for the mouse back without regressing the
 *      pointer-lock fallback that keeps this game playable in an iframe.
 *   3. THE SLIDERS DO SOMETHING MEASURABLE. The mouse moves the camera further
 *      per count; the camera's own `fov` is a different number.
 *   4. SENSITIVITY AND FIELD OF VIEW DO NOT SILENTLY REDEFINE EACH OTHER. This
 *      is the one worth the file. The look scale is
 *      `0.35 + 0.65 * fovNormalized`, and fovNormalized used to divide by the
 *      literal (BASE_FOV - ADS_FOV). The moment BASE_FOV became a slider that
 *      denominator became a variable that hits zero at 55 and goes negative
 *      below it. See player/camera.js: aiming is now a fixed ZOOM RATIO off
 *      whatever base the player chose, so the scale still runs 1.00 at the hip
 *      and 0.35 at full ADS at EVERY setting - which is what is asserted below,
 *      at both ends of the slider, rather than merely that it does not throw.
 *   5. IT IS READABLE. Contrast on every new label, against the ground it
 *      actually stands on, at the 4.5 floor test/hud.mjs holds the HUD to.
 *
 * ON THE PIXELS, and this is the same reasoning test/hud.mjs carries: a green
 * suite here is fully compatible with a black screen, which has happened three
 * separate times on this project. Every legibility number below comes from
 * `page.screenshot()` decoded in node, never from an in-page
 * `drawImage(renderer.domElement)` - which with preserveDrawingBuffer false
 * samples a stale or cleared buffer and once reported a sunlit courtyard at
 * luma 7.
 *
 * ON WAITING: nothing here waits on a wall clock. Under software rendering the
 * frame loop's delta clamp makes simulated time run about six times slower than
 * the wall, so every wait below is on a FRAME COUNT read out of the running
 * loop or on a piece of state.
 *
 * The PNG decoder and the luminance maths are copied rather than imported, the
 * same way test/mysterybox.mjs and test/hud.mjs carry their own: forty lines of
 * zlib and arithmetic for the one file format this suite produces itself, so
 * the only thing that has to be installed is the driver.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS, dismissBriefing } from './chrome.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const VIEW = { width: 1440, height: 860 };

const GATE = {
  /** WCAG's floor for body text. The HUD is held to it; so is this. */
  contrast: 4.5,
  /** Mean per-pixel change proving the element drew at all. */
  lift: 6,
  /** The frame behind the panel rendered. Black measures 0.14. */
  frameLuma: 12,
  /**
   * The frame loop's own clamp, from main.js. Asserted rather than imported,
   * because the point is that the SHIPPED number has not moved: a resumed
   * frame may never advance the simulation by more than this however long the
   * menu was open.
   */
  maxDelta: 1 / 20,
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

/** 8-bit non-interlaced PNG, colour type 2 or 6. What Chrome emits. */
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

const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const relLuma = (r, g, b) => 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];

/**
 * Luma over an ABSOLUTE pixel rect, with the distribution and not only the
 * mean. `clip` and `spread` travel beside every brightness figure here for the
 * reason STATE.md records: a fixture clipping to white scores WELL on mean
 * luminance, and that is how a broken mystery box passed a findability check
 * for a fortnight.
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

  if (!n) return { meanLuma: 0, percentLit: 0, peak: 0, clip: 0, spread: 0, pct: () => 0, n: 0 };

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

const ratio = (hi, lo) => +(((Math.max(hi, lo) + 0.05) / (Math.min(hi, lo) + 0.05)).toFixed(2));

/** Contrast between two authored CSS colours, for the swatch audit. */
function cssRatio(a, b) {
  const parse = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return [p[0] | 0, p[1] | 0, p[2] | 0];
  };
  const ca = parse(a), cb = parse(b);
  if (!ca || !cb) return null;
  return ratio(relLuma(...ca), relLuma(...cb));
}

// ---------------------------------------------------------------------------
// browser
// ---------------------------------------------------------------------------

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--autoplay-policy=no-user-gesture-required'],
});

const page = await browser.newPage({ viewport: VIEW });

/**
 * Console errors and warnings, MINUS the driver's own performance notices.
 *
 * "GPU stall due to ReadPixels" is ANGLE telling us that a readback stalled the
 * pipeline, and the readbacks are this file's own page.screenshot() calls under
 * swiftshader. It is a true statement about a slow software renderer and says
 * nothing about the page; gating on it would mean a suite that fails because it
 * took a photograph. Everything else - real errors, real page warnings, every
 * pageerror - still counts, and the filter is narrow enough to say out loud.
 */
const DRIVER_NOISE = /GL Driver Message .*Performance/;

const logs = [];
page.on('console', (m) => {
  if (m.type() !== 'error' && m.type() !== 'warning') return;
  const text = m.text();
  if (DRIVER_NOISE.test(text)) return;
  logs.push(`[${m.type()}] ${text}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

/**
 * WHICH TREE IS BEING TESTED. STATE.md's standing instruction is to verify on
 * an ISOLATED tree, and a hardcoded port makes that instruction impossible to
 * follow. Defaults to 4177 so nothing that already worked changes.
 *
 * ARGV FIRST, AND THIS IS THE THIRD TIME THIS EXACT LINE HAS BEEN WRONG.
 *
 * 516937e fixed the suites that silently ignored the URL argument and said "all
 * eight". There were nine - hud.mjs read only SANDS_URL and was caught in
 * 5fb40a5. This file was written afterwards, inherited the same shape, and was
 * the last one left: `node test/settings.mjs http://127.0.0.1:PORT/index.html`
 * quietly tested 4177 instead of the tree it was handed.
 *
 * It is harmless only because 4177 is deliberately kept EMPTY as a tripwire, so
 * the ignored argument fails to connect rather than passing against the wrong
 * build. Put anything on that port and this lies silently.
 *
 * The pattern worth naming: the defect keeps reappearing in NEW files, because
 * each one is written by copying the shape of an existing suite and the broken
 * shape reads exactly like the correct one. An audit that enumerates every file
 * in test/ and reports how each resolves its URL is the only thing that has ever
 * caught it - twice now.
 */
const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
console.log(`testing ${BASE}`);

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
// BEGIN raises the briefing card now; the world is held behind it. See chrome.mjs.
await dismissBriefing(page);
await page.waitForTimeout(1400);

// ---------------------------------------------------------------------------
// helpers, injected once
// ---------------------------------------------------------------------------

await page.addScriptTag({
  content: `
window.__P__ = {
  /**
   * Wait for the GAME LOOP to advance n frames, not for n animation frames of
   * our own.
   *
   * These are different claims and only one of them is the one under test. A
   * requestAnimationFrame the harness schedules proves the browser is painting;
   * frameNo proves the loop that owns the simulation actually ran. It also
   * makes the paused assertions honest: "forty frames of the real loop went by
   * and nothing moved" is the statement, and it cannot be made by counting our
   * own callbacks.
   */
  async frames(n) {
    const g = window.__SANDS__;
    const target = g.frameNo + n;
    // A hard ceiling on iterations rather than on wall time, so a slow machine
    // is slow rather than failing.
    for (let i = 0; i < n * 40 + 400; i++) {
      if (g.frameNo >= target) return g.frameNo;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return g.frameNo;
  },

  /**
   * The one actor the pause assertions follow.
   *
   * Held by IDENTITY and not by live[0]. The wave director is a live system
   * with its own clock, and an index into a list it owns is a reference that
   * silently becomes a reference to something else the moment a wave lands.
   * "The enemy did not move" has to be about the same enemy at both ends.
   */
  _actor: null,

  /** Everything the pause assertions compare, in one read. */
  snap() {
    const g = window.__SANDS__;
    const a = window.__P__._actor;
    return {
      frameNo: g.frameNo,
      elapsed: +g.elapsed.toFixed(6),
      paused: g.pause.paused,
      hidden: document.getElementById('pause').hidden,
      cook: +g.grenades.cook.toFixed(6),
      cooking: g.grenades.stats().cooking,
      grenadeCount: g.grenades.count,
      // The wave director's own clock. A wave that kept counting down behind a
      // settings panel is the second-worst thing this pause could get wrong.
      waveTimer: +g.director.state.timer.toFixed(6),
      wave: g.director.state.wave,
      live: g.director.live.length,
      // FULL PRECISION, deliberately. Rounded to six places this read 0.000001
      // metres of movement across forty paused frames - which was the ROUNDING,
      // not the actor: moved() compares this snapshot against the live float,
      // so a rounded snapshot manufactures a micrometre of drift out of nothing
      // and the assertion has to be loosened to absorb a fault it invented.
      // "Did not move" is an exact claim and is measured exactly.
      enemy: a ? { x: a.position.x, y: a.position.y, z: a.position.z } : null,
      // The viewmodel's own animation phase clock, which is downstream of the
      // same delta and is the cheapest proof the weapon stopped sway too.
      vmPhase: g.viewmodel.state.phase,
      muted: g.audio.isMuted(),
      volume: +g.audio.getVolume().toFixed(4),
      locked: g.input.state.locked,
      fallback: g.input.state.fallback,
      suspended: g.input.state.suspended,
      lockRequests: g.input.state.lockRequests,
      fov: +g.camera.fov.toFixed(4),
      baseFov: +g.rig.baseFov.toFixed(4),
    };
  },

  /** Put the player somewhere and point them along a yaw. */
  place(x, z, yaw) {
    const g = window.__SANDS__;
    g.player.teleport({ x, y: 0, z });
    g.rig.reset(yaw, -0.02);
    g.rig.update(1 / 60, g.player, false);
    g.camera.updateMatrixWorld(true);
  },

  /**
   * A clean field: no horde, no drops, an invulnerable player, and one actor
   * placed by hand where it has room to walk.
   *
   * Invulnerable because a shambler that reaches the player resets the run, and
   * a director.reset() in the middle of a pause assertion would look exactly
   * like the pause having failed.
   */
  stage(dx = 7) {
    const g = window.__SANDS__;
    g.combat.state.invulnerable = true;
    g.director.reset();
    window.__P__.place(0, 24, 0);
    g.world.update(1 / 60, 0);
    const a = g.director.placeAt('shambler', 0, 24 - dx);
    if (!a) return null;
    window.__P__._actor = a;
    // One director step so the actor settles onto the floor before anything
    // measures it, exactly as test/grenades.mjs does before a blast.
    g.director.update(1 / 60, 0);
    return { x: +a.position.x.toFixed(6), y: +a.position.y.toFixed(6), z: +a.position.z.toFixed(6) };
  },

  /**
   * Hold the next wave off.
   *
   * The director's breather is 3.5 seconds and this suite runs for minutes of
   * simulated time, so a wave arriving in the middle of a legibility pass would
   * put twenty actors between the camera and the courtyard. Set high rather
   * than disabled, so the clock is still a clock: "the timer did not move while
   * paused" is only a claim worth making about a timer that moves.
   */
  holdWave() {
    window.__SANDS__.director.state.timer = 9999;
    return window.__SANDS__.director.state.timer;
  },

  /** Pull the pin, through the real input path. */
  cook(on) {
    window.__SANDS__.input.state.grenade = !!on;
  },

  /** Distance the followed actor has travelled since a recorded point. */
  moved(from) {
    const a = window.__P__._actor;
    if (!a || !from) return null;
    // Not rounded either. An exact zero is the claim.
    return Math.hypot(a.position.x - from.x, a.position.y - from.y, a.position.z - from.z);
  },

  // -----------------------------------------------------------------------
  // driving the panel through its own DOM
  // -----------------------------------------------------------------------
  //
  // Every setting below is written by dispatching the event a mouse would
  // dispatch, not by calling rig.setBaseFov(). The claim is that the PANEL
  // works, and a test that reached past the panel to the rig would pass on a
  // panel that was never wired up.

  tab(id) {
    const b = document.querySelector('#pause-tabs [data-tab="' + id + '"]');
    if (!b) return null;
    b.click();
    return window.__SANDS__.pause.tab;
  },

  slide(id, value) {
    const el = document.querySelector('[data-setting="' + id + '"] .set-range');
    if (!el) return null;
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { asked: value, shows: el.value };
  },

  press(id, index = 0) {
    const b = document.querySelectorAll('[data-setting="' + id + '"] .set-btn')[index];
    if (!b) return null;
    b.click();
    return true;
  },

  /** What a row is SHOWING, which is a different claim from what it holds. */
  row(id) {
    const w = document.querySelector('[data-setting="' + id + '"]');
    if (!w) return null;
    const range = w.querySelector('.set-range');
    return {
      label: w.querySelector('.set-label').textContent,
      value: w.querySelector('.set-value').textContent,
      note: w.querySelector('.set-note').textContent,
      range: range ? { value: range.value, min: range.min, max: range.max, step: range.step } : null,
      pressed: [...w.querySelectorAll('.set-btn')].map((b) => b.getAttribute('aria-pressed')),
    };
  },

  /**
   * MEASURE WITH THE GAME RUNNING, THEN PUT THE MENU BACK.
   *
   * Everything below this line is measured through the frame loop, and the
   * frame loop is exactly what a pause stops - so a response measured with the
   * panel up would read zero and would read zero just as convincingly if the
   * slider had never been wired to anything. This is also what a player
   * actually does: open the menu, move the slider, resume, and find the game
   * feels different.
   *
   * The panel's own DOM is driven while PAUSED, up in slide()/press(), which is
   * where a real click lands. Only the measurement is taken running.
   */
  async running(fn) {
    const g = window.__SANDS__;
    const was = g.pause.paused;
    if (was) g.pause.resume();
    try {
      return await fn();
    } finally {
      if (was) g.pause.open();
    }
  },

  /**
   * The look response, end to end, in radians of yaw per mouse count.
   *
   * Driven through the FRAME LOOP - a delta is pushed onto the input state the
   * way a mousemove pushes one, and the loop drains it through
   * rig.look(dx, dy, 0.35 + 0.65 * rig.fovNormalized). Calling rig.look()
   * directly would measure the rig and skip the scale, which is the exact term
   * the FOV slider was capable of redefining.
   */
  lookResponse(counts = 400) {
    return window.__P__.running(async () => {
      const g = window.__SANDS__;
      g.rig.reset(0, 0);
      g.rig.update(1 / 60, g.player, false);
      const before = g.rig.yaw;
      g.input.state.dx += counts;
      await window.__P__.frames(2);
      return {
        yaw: +(g.rig.yaw - before).toFixed(9),
        perCount: +((g.rig.yaw - before) / -counts).toFixed(12),
        scale: +(0.35 + 0.65 * g.rig.fovNormalized).toFixed(6),
      };
    });
  },

  /**
   * The whole FOV/sensitivity relationship at one base setting.
   *
   * wouldHaveBeen is the OLD formula - (fov - 55) / (75 - 55) - evaluated at
   * the same moment and reported rather than asserted. It is the regression
   * this change exists to prevent, and printing the number it would have
   * produced is more useful than asserting it does not happen.
   *
   * NO BACKTICKS ANYWHERE IN THIS INJECTED BLOCK. It is the body of a template
   * literal in the file above, and one backtick in a comment terminates it
   * early - which node --check accepts, because what is left is still valid
   * JavaScript. STATE.md records the same bug closing a GLSL template.
   */
  fovProbe() {
    const g = window.__SANDS__;
    const old = (g.camera.fov - 55) / (75 - 55);
    return {
      baseFov: +g.rig.baseFov.toFixed(4),
      adsFov: +g.rig.adsFov.toFixed(4),
      sprintFov: +g.rig.sprintFov.toFixed(4),
      adsZoom: +g.rig.adsZoom.toFixed(4),
      cameraFov: +g.camera.fov.toFixed(4),
      rigFov: +g.rig.fov.toFixed(4),
      norm: +g.rig.fovNormalized.toFixed(6),
      scale: +(0.35 + 0.65 * g.rig.fovNormalized).toFixed(6),
      span: +(g.rig.baseFov - g.rig.adsFov).toFixed(6),
      wouldHaveBeen: Number.isFinite(old) ? +old.toFixed(4) : String(old),
      wouldHaveScaled: Number.isFinite(old) ? +(0.35 + 0.65 * old).toFixed(4) : String(old),
    };
  },

  /**
   * Hold the sight up (or down) until the FOV has actually eased to it, and
   * report where it landed.
   *
   * Does NOT put it back: the caller drives hip then aim then hip, so an
   * automatic reset would double every ease. ADS eases at rate 14 and the hip
   * return at 9, so eighteen clamped frames is comfortably past both. Frames,
   * never a wall-clock wait - under software rendering simulated time runs
   * about six times slower than the wall.
   */
  ads(on) {
    return window.__P__.running(async () => {
      const g = window.__SANDS__;
      g.input.state.ads = !!on;
      await window.__P__.frames(18);
      return window.__P__.fovProbe();
    });
  },

  /**
   * TIGHT RECTS AROUND THE GLYPHS, AND THE REASON THEY HAVE TO BE TIGHT.
   *
   * The first version of this measured whole SETTING ROWS, and every one of
   * them scored between 1.05 and 3.44 to one while the authored colours audited
   * at 6.13. The tell was in the numbers beside it: spread 1, peak 216. A row
   * is 718px wide and carries one line of 11px text, so ninety-odd per cent of
   * the rect is empty plate - and the 97th percentile of a rect that is ninety
   * per cent background IS background. The peak of 216 says the gold is there;
   * the statistic simply could not see it.
   *
   * That is a MEASUREMENT bug and not a legibility one, and it is the exact
   * trap test/hud.mjs already documents for the map card - "a container is not
   * a readout". Tuning the panel's colours to satisfy it would have been the
   * failure STATE.md records twice: a gate calibrated against a broken reader.
   *
   * So the unit is the text itself. A Range over the element's contents gives
   * the box the glyphs actually occupy, inside which the ink is a large enough
   * fraction for a percentile to find it and the gaps between letters are the
   * plate it stands on.
   */
  textBoxes() {
    const out = {};

    const add = (name, el) => {
      if (!el || !el.getClientRects().length) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const b = range.getBoundingClientRect();
      // Too small to hold a statistic. Reported as absent rather than measured
      // badly, which is the whole lesson above.
      if (b.width < 6 || b.height < 6) return;
      out[name] = { x: b.x, y: b.y, w: b.width, h: b.height, colour: cs.color };
    };

    add('head-title', document.querySelector('.pause-head h2'));
    add('head-said', document.querySelector('.pause-head .said'));
    add('tab-active', document.querySelector('.pause-tab[aria-pressed="true"]'));
    add('tab-idle', document.querySelector('.pause-tab[aria-pressed="false"]'));
    add('foot-fine', document.querySelector('.pause-foot .fine'));
    add('resume', document.getElementById('pause-resume'));

    const panel = document.querySelector('.pause-panel:not([hidden])');
    if (panel) {
      const row = panel.querySelector('.set-row');
      if (row) {
        add('row-label', row.querySelector('.set-label'));
        add('row-value', row.querySelector('.set-value'));
        add('row-note', row.querySelector('.set-note'));
        add('row-btn', row.querySelector('.set-btn'));
      }
      add('bind-group', panel.querySelector('.bind-group'));
      const bindRow = panel.querySelector('.bind-row');
      if (bindRow) {
        add('bind-key', bindRow.querySelector('.key-cap'));
        add('bind-what', bindRow.querySelector('.bind-what'));
      }
    }
    return out;
  },

  /**
   * Every piece of text on the panel with its authored colour.
   *
   * The percentile measurement is BLIND TO DIM TEXT BY CONSTRUCTION - it takes
   * the bright tail inside a rect, so a row whose value is bone and whose note
   * is a muddy brown scores on the bone and reports nothing about the brown.
   * test/hud.mjs found three labels sitting between 2.1 and 3.7 to one that way.
   */
  swatches() {
    const out = [];
    for (const el of document.querySelectorAll('#pause *')) {
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3 && n.textContent.trim())
        .map((n) => n.textContent.trim()).join(' ');
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
      if (!el.getClientRects().length) continue;
      out.push({
        what: el.id || el.className || el.tagName.toLowerCase(),
        text: own.slice(0, 28),
        color: cs.color,
        size: parseFloat(cs.fontSize),
      });
    }
    return out;
  },

  /** Hide the panel WITHOUT resuming, for the paired frame. */
  panel(on) { document.getElementById('pause').hidden = !on; },

  /**
   * DOES THE PANEL FIT, AND IS THE BUTTON ACTUALLY HITTABLE.
   *
   * Two facts that a state assertion cannot see and that failed together the
   * first time this suite ran. .pause-body is a flex item, flex items default
   * to min-height:auto, and auto refuses to shrink below content - so on the
   * tallest tab the body kept its full height and the footer was laid out
   * below the sheet and off the bottom of the screen. Every state check passed.
   * The button reported itself visible, enabled and stable. It could not be
   * clicked, because the topmost element at its own centre was the scrim.
   *
   * So: measure the footer against the sheet, and elementFromPoint the button.
   *
   * AND THE ONE elementFromPoint CANNOT SEE. Both of those passed on the run
   * that found the real bug: while POINTER LOCK is held, every mouse event goes
   * to the locked element with clientX and clientY frozen at zero, so the
   * button was genuinely topmost at its own centre and the mousedown the driver
   * dispatched there was still delivered to #stage at 0,0. A panel over a
   * locked canvas is a picture of a panel. lockHeld is the check that catches
   * it, and it is the reason open() calls document.exitPointerLock().
   */
  fit() {
    const sheet = document.querySelector('.pause-sheet');
    const foot = document.querySelector('.pause-foot');
    const btn = document.getElementById('pause-resume');
    if (!sheet || !foot || !btn) return null;

    const s = sheet.getBoundingClientRect();
    const f = foot.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);

    return {
      tab: window.__SANDS__.pause.tab,
      lockHeld: !!document.pointerLockElement,
      lockedTo: document.pointerLockElement
        ? (document.pointerLockElement.id || 'element') : null,
      sheetBottom: +s.bottom.toFixed(1),
      footBottom: +f.bottom.toFixed(1),
      viewport: window.innerHeight,
      // The body is what is supposed to absorb an overlong tab.
      bodyScrolls: (() => {
        const el = document.querySelector('.pause-body');
        return el ? el.scrollHeight > el.clientHeight : false;
      })(),
      spill: +(f.bottom - s.bottom).toFixed(1),
      hit: hit ? (hit.id || hit.className || hit.tagName) : null,
      hitIsButton: !!hit && (hit === btn || btn.contains(hit)),
    };
  },

  /** Walk into the pyramid, so the panel can be photographed over a chamber. */
  goRoom(id) {
    const g = window.__SANDS__;
    const r = g.interior.rooms.find((x) => x.id === id);
    if (!r) return null;
    window.__P__.place(r.bounds.x, r.bounds.z, 0);
    g.world.update(1 / 60, 0);
    return g.spaces.roomId;
  },
};
`,
});

// ---------------------------------------------------------------------------
// 1. THE GAME IS RUNNING, AND THE DETECTOR CAN SEE IT
// ---------------------------------------------------------------------------
//
// FIRST, and it is not a formality. Every assertion in section 3 is of the form
// "this number did not change", and a number that never changes under any
// circumstances would satisfy all of them. So the control runs the same
// measurement against a RUNNING game and requires it to move. Without this, a
// director that had silently stopped spawning, an actor pool that had failed to
// mount, or a frame loop that had thrown would all read as a perfect pause.

const staged = await page.evaluate(() => window.__P__.stage(7));
check(!!staged, 'control: an actor was placed', staged ? `at ${staged.x}, ${staged.z}` : 'placeAt returned null');

const t0 = await page.evaluate(() => window.__P__.snap());

check(!t0.paused, 'control: the game starts unpaused');
check(t0.hidden, 'control: the panel starts hidden');
check(t0.live >= 1, 'control: one actor is live', `${t0.live}`);

await page.evaluate(() => window.__P__.frames(24));
const t1 = await page.evaluate(() => window.__P__.snap());
const ranMoved = await page.evaluate((f) => window.__P__.moved(f), t0.enemy);

check(t1.frameNo - t0.frameNo >= 20, 'control: the loop ran', `${t1.frameNo - t0.frameNo} frames`);
check(t1.elapsed > t0.elapsed, 'control: simulated time advanced',
  `+${(t1.elapsed - t0.elapsed).toFixed(3)}s over ${t1.frameNo - t0.frameNo} frames`);
check(ranMoved > 0.05, 'control: THE ACTOR MOVES WHEN THE GAME RUNS', `${ranMoved} m`);
check(t1.waveTimer < t0.waveTimer, "control: the wave director's clock runs",
  `${t0.waveTimer} -> ${t1.waveTimer}`);

// From here the next wave is held off. Twenty actors arriving in the middle of
// a legibility pass would put a horde between the camera and the courtyard, and
// the clock is set high rather than stopped so section 3 still has a moving
// number to assert has stopped moving.
await page.evaluate(() => window.__P__.holdWave());

// ---------------------------------------------------------------------------
// 2. Esc OPENS THE MENU
// ---------------------------------------------------------------------------

// Pull the pin first, so the fuse is genuinely burning when the menu opens.
// This is the case the whole feature exists for: a player who opens the
// settings with a live grenade in their hand must not be killed by it.
await page.evaluate(() => window.__P__.cook(true));
await page.evaluate(() => window.__P__.frames(3));
const lit = await page.evaluate(() => window.__P__.snap());
check(lit.cooking, 'a grenade is cooking before the pause', `cook ${lit.cook}`);
check(lit.cook > 0, 'the fuse has actually started', `${lit.cook}`);

await page.keyboard.press('Escape');
await page.waitForTimeout(120);

const p0 = await page.evaluate(() => window.__P__.snap());
check(p0.paused, 'Esc paused the game');
check(!p0.hidden, 'Esc showed the panel');
check(p0.suspended, 'the input layer is suspended');
check(p0.muted, 'audio ducked on pause');

// The pin is still out; the fuse simply stopped. Voiding the cook would have
// been the easy way to make the next assertion pass and would have silently
// eaten a consumable the player had already committed.
check(p0.cooking, 'the pin is still out while paused');
check(p0.grenadeCount === lit.grenadeCount, 'pausing did not consume the grenade',
  `${lit.grenadeCount} -> ${p0.grenadeCount}`);

// ---------------------------------------------------------------------------
// 3. THE SIMULATION HAS ACTUALLY STOPPED
// ---------------------------------------------------------------------------

await page.evaluate(() => window.__P__.frames(40));
const p1 = await page.evaluate(() => window.__P__.snap());
const pausedMoved = await page.evaluate((f) => window.__P__.moved(f), p0.enemy);

const ranFrames = p1.frameNo - p0.frameNo;
check(ranFrames >= 30, 'THE LOOP KEPT RUNNING WHILE PAUSED', `${ranFrames} frames`);
check(p1.elapsed === p0.elapsed, 'simulated time did not advance',
  `${p0.elapsed} -> ${p1.elapsed} over ${ranFrames} frames`);
check(pausedMoved === 0, 'THE ENEMY DID NOT MOVE',
  `${pausedMoved} m over ${ranFrames} frames (exact zero, not a tolerance)`);
check(p1.cook === p0.cook, 'THE FUSE DID NOT BURN',
  `${p0.cook} -> ${p1.cook} over ${ranFrames} frames`);
check(p1.waveTimer === p0.waveTimer, 'the wave director stopped',
  `timer ${p0.waveTimer} -> ${p1.waveTimer}`);
check(p1.wave === p0.wave, 'no wave started behind the panel', `${p0.wave} -> ${p1.wave}`);
check(p1.live === p0.live, 'nothing spawned behind the panel', `${p0.live} -> ${p1.live}`);

// --- put the pin back -------------------------------------------------------
//
// AND THE BEHAVIOUR IT DOCUMENTS, which is emergent rather than designed and is
// worth stating: pausing clears the input layer, so on the frame after Resume
// systems/grenades.js sees the key released while the pin is out and THROWS.
// That is the right outcome of the three available - continuing to cook would
// kill a player whose finger is not on the key, and voiding it would silently
// eat a grenade they had already committed - but it is a real consequence of
// pausing mid-cook and the suite should be the thing that knows it.
const thrown = await page.evaluate(async () => {
  const g = window.__SANDS__;
  window.__P__.cook(false);
  const before = g.grenades.count;
  g.pause.resume();
  await window.__P__.frames(6);
  const live = g.grenades.live;
  // Let the shell go off and the field settle before anything else is staged.
  await window.__P__.frames(90);
  return { before, after: g.grenades.count, live };
});
notes.push(`  note resuming mid-cook THREW the grenade (count ${thrown.before} -> `
  + `${thrown.after}, ${thrown.live} shell(s) in flight) - documented, not asserted`);

await page.evaluate(() => { window.__P__.stage(7); window.__P__.holdWave(); });
await page.evaluate(() => window.__SANDS__.pause.open());

// ---------------------------------------------------------------------------
// 4. THE PANEL, DRIVEN THROUGH ITS OWN DOM
// ---------------------------------------------------------------------------
//
// The panel is PAUSED for all of it, which is where a real click lands. The
// two measurements that need the frame loop - the look response and the ADS
// ease - resume for the duration and put the menu back, inside __P__.running.

const tabIds = await page.evaluate(() => window.__SANDS__.pause.spec.map((t) => t.id));
check(tabIds.join(',') === 'game,video,audio,controls', 'four tabs were built', tabIds.join(','));

// --- mouse sensitivity ------------------------------------------------------

await page.evaluate(() => window.__P__.tab('game'));

const sensRow = await page.evaluate(() => window.__P__.row('sensitivity'));
check(!!sensRow && !!sensRow.range, 'sensitivity is a slider');
check(sensRow.range.min === '0.2' && sensRow.range.max === '3',
  'sensitivity range is 0.20 to 3.00', `${sensRow.range.min}..${sensRow.range.max}`);
// The owner asked for a readout of the actual number, so the row has to carry
// the raw constant and not only the multiplier.
check(/0\.\d{5}/.test(sensRow.note), 'sensitivity prints the real constant', sensRow.note);

await page.evaluate(() => window.__P__.slide('sensitivity', 0.5));
const sensLow = await page.evaluate(() => window.__P__.row('sensitivity'));
const lookLow = await page.evaluate(() => window.__P__.lookResponse(400));

await page.evaluate(() => window.__P__.slide('sensitivity', 2.0));
const sensHigh = await page.evaluate(() => window.__P__.row('sensitivity'));
const lookHigh = await page.evaluate(() => window.__P__.lookResponse(400));

check(sensLow.value.startsWith('0.50'), 'the panel reads back 0.50', sensLow.value);
check(sensHigh.value.startsWith('2.00'), 'the panel reads back 2.00', sensHigh.value);

const gainRatio = lookLow.perCount !== 0 ? lookHigh.perCount / lookLow.perCount : 0;
check(Math.abs(gainRatio - 4) < 0.02,
  'THE MOUSE MOVES THE CAMERA FOUR TIMES AS FAR AT 2.00 AS AT 0.50',
  `${lookLow.perCount.toExponential(4)} -> ${lookHigh.perCount.toExponential(4)} rad/count, ratio ${gainRatio.toFixed(4)}`);

// Back to the shipped feel before anything else is measured against it.
await page.evaluate(() => window.__P__.slide('sensitivity', 1.0));

// --- invert look ------------------------------------------------------------

const invBefore = await page.evaluate(() => window.__P__.row('invert'));
await page.evaluate(() => window.__P__.press('invert'));
const invAfter = await page.evaluate(() => window.__P__.row('invert'));
const invPitch = await page.evaluate(() => window.__P__.running(async () => {
  const g = window.__SANDS__;
  g.rig.reset(0, 0);
  g.input.state.dy += 200;
  await window.__P__.frames(2);
  return +g.rig.pitch.toFixed(9);
}));
check(invBefore.value === 'Off' && invAfter.value === 'On', 'invert look toggles',
  `${invBefore.value} -> ${invAfter.value}`);
check(invPitch > 0, 'inverted, a downward mouse move looks UP', `pitch ${invPitch}`);
await page.evaluate(() => window.__P__.press('invert'));
const invBack = await page.evaluate(() => window.__P__.row('invert'));
check(invBack.value === 'Off', 'invert look toggles back', invBack.value);

// --- field of view ----------------------------------------------------------

const fovRow0 = await page.evaluate(() => window.__P__.row('fov'));
check(fovRow0.range.min === '60' && fovRow0.range.max === '110',
  'FOV range is 60 to 110 degrees', `${fovRow0.range.min}..${fovRow0.range.max}`);
check(fovRow0.value.includes('°'), 'FOV is labelled in degrees', fovRow0.value);

const fovBefore = await page.evaluate(() => window.__P__.fovProbe());
await page.evaluate(() => window.__P__.slide('fov', 100));
// NO FRAMES. The claim is that the slider moves the projection under the drag,
// not that it eases there over the next third of a second - which under
// software rendering is several seconds of wall clock.
const fovAfter = await page.evaluate(() => window.__P__.fovProbe());

check(Math.abs(fovAfter.baseFov - 100) < 0.001, 'the rig took 100 degrees', `${fovAfter.baseFov}`);
check(Math.abs(fovAfter.cameraFov - 100) < 0.5,
  "THE CAMERA'S ACTUAL FOV MOVED, WITHOUT WAITING FOR A FRAME",
  `${fovBefore.cameraFov} -> ${fovAfter.cameraFov}`);

await page.evaluate(() => window.__P__.frames(4));
const fovSettled = await page.evaluate(() => window.__P__.fovProbe());
check(Math.abs(fovSettled.cameraFov - 100) < 0.5, 'and it stays there', `${fovSettled.cameraFov}`);

const fovRow1 = await page.evaluate(() => window.__P__.row('fov'));
check(fovRow1.value === '100°', 'the panel reads back 100 degrees', fovRow1.value);
// The consequence line is the whole reason a player can trust the FOV slider:
// it says what just happened to the sight picture and to sprinting.
check(/aim \d+° · sprint \d+°/.test(fovRow1.note), 'the FOV row states its consequences', fovRow1.note);

// ---------------------------------------------------------------------------
// 5. THE INTERACTION: FOV MUST NOT REDEFINE SENSITIVITY
// ---------------------------------------------------------------------------
//
// The look scale is 0.35 + 0.65 * fovNormalized. It has exactly one job: the
// mouse is gentler when the view is zoomed in. That job is only done if the
// scale runs from 1.00 at the hip to 0.35 at full ADS - and it has to do that
// at EVERY base FOV the slider can reach, or the sensitivity setting means a
// different thing at 60 than it does at 110 and nothing on screen says so.
//
// `wouldHaveBeen` in each row is the old formula, (fov - 55) / (75 - 55),
// evaluated at the same instant. It is reported and not asserted: the point is
// to show what the number would have been rather than to test the dead code.

const fovMatrix = [];
for (const base of [60, 75, 90, 110]) {
  await page.evaluate((b) => window.__P__.slide('fov', b), base);
  const hip = await page.evaluate(() => window.__P__.ads(false));
  const aim = await page.evaluate(() => window.__P__.ads(true));
  fovMatrix.push({ base, hip, aim });
}
// The sight down again, so everything after this measures from the hip.
await page.evaluate(() => window.__P__.ads(false));

for (const r of fovMatrix) {
  const tag = `base ${r.base}`;

  check(r.hip.span > 1, `${tag}: the sensitivity denominator is positive`,
    `span ${r.hip.span}° (aim ${r.hip.adsFov}°, zoom ${r.hip.adsZoom}x)`);

  check(Number.isFinite(r.hip.norm) && Number.isFinite(r.aim.norm),
    `${tag}: fovNormalized is a number`, `hip ${r.hip.norm} aim ${r.aim.norm}`);

  check(Math.abs(r.hip.scale - 1) < 0.02,
    `${tag}: THE HIP SCALE IS STILL 1.00`,
    `${r.hip.scale}  (the old formula would have given ${r.hip.wouldHaveScaled})`);

  check(Math.abs(r.aim.scale - 0.35) < 0.03,
    `${tag}: THE FULL-ADS SCALE IS STILL 0.35`,
    `${r.aim.scale} at ${r.aim.cameraFov}°  (the old formula would have given ${r.aim.wouldHaveScaled})`);

  // Aiming is a fixed magnification, so it is the same lens at every setting.
  check(Math.abs(r.hip.baseFov / r.hip.adsFov - r.hip.adsZoom) < 0.01,
    `${tag}: aiming is the same zoom at every FOV`,
    `${r.hip.baseFov}/${r.hip.adsFov} = ${(r.hip.baseFov / r.hip.adsFov).toFixed(4)}x`);

  // SPRINT_FOV was a fixed 82 written against a base of 75. At 110 a fixed 82
  // would NARROW the view while sprinting, which is the speed cue backwards.
  check(r.hip.sprintFov > r.hip.baseFov,
    `${tag}: sprinting still WIDENS the view`,
    `${r.hip.baseFov}° -> ${r.hip.sprintFov}°  (a fixed 82 would have gone ${82 > r.base ? 'wider' : 'NARROWER'})`);
}

// And the whole point of the change, stated once as a number: the same mouse
// travel has to cover the same angle at 60 and at 110.
await page.evaluate(() => window.__P__.slide('fov', 60));
const look60 = await page.evaluate(() => window.__P__.lookResponse(400));
await page.evaluate(() => window.__P__.slide('fov', 110));
const look110 = await page.evaluate(() => window.__P__.lookResponse(400));
const drift = Math.abs(look110.perCount / look60.perCount - 1);
check(drift < 0.01,
  'MOVING THE FOV SLIDER DOES NOT CHANGE WHAT THE SENSITIVITY SLIDER MEANS',
  `${look60.perCount.toExponential(4)} at 60° vs ${look110.perCount.toExponential(4)} at 110°, drift ${(drift * 100).toFixed(3)}%`);

await page.evaluate(() => window.__P__.slide('fov', 75));

// --- aim zoom ---------------------------------------------------------------

await page.evaluate(() => window.__P__.slide('adszoom', 2.0));
const zoomRow = await page.evaluate(() => window.__P__.row('adszoom'));
const zoomProbe = await page.evaluate(() => window.__P__.fovProbe());
check(zoomRow.value.startsWith('2.00'), 'aim zoom reads back 2.00', zoomRow.value);
check(Math.abs(zoomProbe.adsFov - 37.5) < 0.1, 'aim zoom narrows the sight FOV',
  `${zoomProbe.baseFov}° / 2.00 = ${zoomProbe.adsFov}°`);
await page.evaluate(() => window.__P__.slide('adszoom', 75 / 55));

// --- video and audio --------------------------------------------------------

await page.evaluate(() => window.__P__.tab('video'));
const fidBefore = await page.evaluate(() => window.__P__.row('fidelity'));
await page.evaluate(() => window.__P__.press('fidelity', 1));      // Low
const fidLow = await page.evaluate(() => ({
  row: window.__P__.row('fidelity'),
  shadows: window.__SANDS__.renderer.shadowMap.enabled,
  corner: document.getElementById('fid-low').getAttribute('aria-pressed'),
}));
check(fidBefore.value === 'High' && fidLow.row.value === 'Low', 'fidelity switches',
  `${fidBefore.value} -> ${fidLow.row.value}`);
check(fidLow.shadows === false, 'low fidelity actually turned shadows off');
// One writer, two surfaces. The corner buttons and the panel must never
// disagree about which fidelity is live.
check(fidLow.corner === 'true', 'the corner buttons followed the panel', fidLow.corner);
await page.evaluate(() => window.__P__.press('fidelity', 0));
const fidBack = await page.evaluate(() => ({
  row: window.__P__.row('fidelity'),
  shadows: window.__SANDS__.renderer.shadowMap.enabled,
}));
check(fidBack.row.value === 'High' && fidBack.shadows === true, 'fidelity switches back');

await page.evaluate(() => window.__P__.tab('audio'));
await page.evaluate(() => window.__P__.slide('volume', 40));
const volRow = await page.evaluate(() => window.__P__.row('volume'));
const volNow = await page.evaluate(() => +window.__SANDS__.audio.getVolume().toFixed(4));
check(volRow.value === '40', 'the volume slider reads back 40', volRow.value);
check(Math.abs(volNow - 0.4) < 0.001, 'and the bus took it', `${volNow}`);

// THE MUTE ROW SHOWS THE PLAYER'S SETTING, NOT THE PAUSE DUCK, and right now
// the two are deliberately different: the panel is open, so the bus IS muted,
// while the player has never touched the control. Reading the bus here had the
// row sitting at "On" for everybody who opened the audio tab - and the obvious
// response to a control that says On is to click it, which writes exactly the
// wrong value into the real setting. Found by looking at the screenshot.
const muteState = await page.evaluate(() => ({
  row: window.__P__.row('mute'),
  busMuted: window.__SANDS__.audio.isMuted(),
  paused: window.__SANDS__.pause.paused,
}));
check(muteState.paused && muteState.busMuted,
  'the bus is ducked while the panel is up', `busMuted ${muteState.busMuted}`);
check(muteState.row.value === 'Off',
  'MUTE SHOWS THE PLAYER SETTING, NOT THE PAUSE DUCK',
  `row says "${muteState.row.value}" while the bus is muted=${muteState.busMuted}`);
check(muteState.row.pressed[0] === 'false',
  'and the mute button is not pressed', muteState.row.pressed.join(','));

// --- the controls list ------------------------------------------------------

await page.evaluate(() => window.__P__.tab('controls'));
const binds = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#pause [data-panel="controls"] .bind-row')];
  return rows.map((r) => ({
    keys: [...r.querySelectorAll('.key-cap')].map((k) => k.textContent.trim()),
    what: r.querySelector('.bind-what').textContent,
  }));
});

check(binds.length >= 12, 'the controls tab lists every binding', `${binds.length} rows`);

// THE ONE THE OWNER COULD NOT FIND. Asserted by name rather than by count,
// because "twelve rows exist" is exactly the check that would keep passing on
// the day the grenade row was dropped.
const flat = binds.map((b) => `${b.keys.join('')} ${b.what}`).join(' | ');
for (const [key, word] of [
  ['G', 'cook'], ['R', 'Reload'], ['F', 'Buy'], ['V', 'Inspect'],
  ['Esc', 'Pause'], ['Shift', 'Sprint'], ['Space', 'Jump'], ['RMB', 'Aim'],
]) {
  const row = binds.find((b) => b.keys.includes(key));
  check(!!row && row.what.includes(word), `controls: ${key} is documented`,
    row ? row.what : 'missing');
}
check(/1.*7/.test(flat), 'controls: the weapon slot digits are documented');

// ---------------------------------------------------------------------------
// 6. THE PANEL FITS, ON EVERY TAB
// ---------------------------------------------------------------------------
//
// Before Resume is clicked, because the first run of this suite could not click
// it: the footer had been laid out off the bottom of the screen and the topmost
// element at the button's own centre was the scrim. Every state assertion in
// sections 1 to 5 passed while the one control the player cannot do without was
// unreachable. Measured per tab, because the tallest tab is the one that breaks.

for (const tab of ['game', 'video', 'audio', 'controls']) {
  await page.evaluate((t) => window.__P__.tab(t), tab);
  const fit = await page.evaluate(() => window.__P__.fit());
  check(!!fit, `fit/${tab}: the panel is measurable`);
  if (!fit) continue;

  check(fit.spill <= 1, `fit/${tab}: nothing spills out of the sheet`,
    `footer bottom ${fit.footBottom} vs sheet bottom ${fit.sheetBottom} (spill ${fit.spill}px)`);
  check(fit.footBottom <= fit.viewport,
    `fit/${tab}: the footer is on screen`,
    `${fit.footBottom} of ${fit.viewport}px`);
  check(fit.hitIsButton,
    `fit/${tab}: RESUME IS THE TOPMOST ELEMENT AT ITS OWN CENTRE`,
    `elementFromPoint gave ${fit.hit}`);
  // The one the three checks above cannot see. A locked pointer sends every
  // mouse event to the canvas at 0,0 whatever the layout says.
  check(!fit.lockHeld,
    `fit/${tab}: THE MOUSE IS FREE - pointer lock was released`,
    fit.lockHeld ? `still locked to #${fit.lockedTo}` : 'released');
}

// And the proof, which is a real driver click rather than a hit test: the
// panel's own tab buttons have to respond to the mouse. This is the assertion
// that would have failed on the build that shipped a picture of a menu.
const clickable = await page.evaluate(() => window.__SANDS__.pause.tab);
await page.click('#pause-tabs [data-tab="audio"]');
const clickedTo = await page.evaluate(() => window.__SANDS__.pause.tab);
check(clickedTo === 'audio', 'A REAL MOUSE CLICK REACHES THE PANEL',
  `${clickable} -> ${clickedTo}`);

// ---------------------------------------------------------------------------
// 7. RESUME
// ---------------------------------------------------------------------------

const beforeResume = await page.evaluate(() => window.__P__.snap());
await page.click('#pause-resume');
await page.waitForTimeout(120);
const afterResume = await page.evaluate(() => window.__P__.snap());

check(!afterResume.paused, 'Resume unpaused the game');
check(afterResume.hidden, 'Resume hid the panel');
check(!afterResume.suspended, 'Resume released the input layer');
check(afterResume.muted === false, 'Resume brought the audio back', `muted ${afterResume.muted}`);
check(afterResume.lockRequests > beforeResume.lockRequests,
  'RESUME ASKED FOR POINTER LOCK BACK',
  `${beforeResume.lockRequests} -> ${afterResume.lockRequests} requests`);

// THE FALLBACK MUST NOT HAVE BEEN RE-ARMED, and this is the regression that a
// naive Resume would have caused. input.engage() declares pointer lock
// unavailable if it has not engaged within 400ms, and Chrome refuses a re-lock
// for about a second after Esc released the last one - so a Resume that called
// engage() would flip a perfectly healthy browser into the iframe fallback and
// tell the player to hold a mouse button to look for the rest of the session.
await page.waitForTimeout(700);
const afterSettle = await page.evaluate(() => window.__P__.snap());
check(afterSettle.fallback === beforeResume.fallback,
  'RESUME DID NOT REGRESS THE POINTER-LOCK FALLBACK',
  `fallback ${beforeResume.fallback} -> ${afterSettle.fallback}`);

// Whether the lock actually engaged is a property of the environment, not of
// this change, so it is REPORTED and not gated. Headless Chrome grants it from
// a trusted click on some builds and not others, and a gate here would be a
// gate on the harness.
notes.push(`  note pointer lock after Resume: locked=${afterSettle.locked} `
  + `fallback=${afterSettle.fallback} (environment, not gated)`);

// --- and the game is running again ------------------------------------------
//
// A FRESH actor, because the one staged before section 4 has spent every
// running() excursion walking at the player and may be standing on them by now
// - and an enemy that has arrived and is swinging is an enemy that does not
// travel, which would read as the resume having failed.

await page.evaluate(() => { window.__P__.stage(9); window.__P__.holdWave(); });
const r0 = await page.evaluate(() => window.__P__.snap());
await page.evaluate(() => window.__P__.frames(24));
const r1 = await page.evaluate(() => window.__P__.snap());
const resumedMoved = await page.evaluate((f) => window.__P__.moved(f), r0.enemy);

check(r1.elapsed > r0.elapsed, 'simulated time is advancing again',
  `+${(r1.elapsed - r0.elapsed).toFixed(3)}s`);
check(resumedMoved > 0.02 || r1.live === 0,
  'THE ACTOR IS WALKING AGAIN',
  `${resumedMoved} m over ${r1.frameNo - r0.frameNo} frames, ${r1.live} live`);

// ---------------------------------------------------------------------------
// 8. THE DELTA CLAMP SURVIVED THE PAUSE
// ---------------------------------------------------------------------------
//
// MAX_DELTA is the number that stops a backgrounded tab returning with a
// four-second frame and putting the player on the other side of the map, and a
// pause is the single most likely thing to break it: `last` is a wall clock and
// the menu can be open for a minute. Measured rather than read, by holding the
// pause open across a real wall-clock second and then asking how much
// simulated time the first frame after Resume was worth.

await page.evaluate(() => window.__SANDS__.pause.open());
await page.waitForTimeout(1100);
const clampBefore = await page.evaluate(() => window.__P__.snap());
await page.evaluate(() => window.__SANDS__.pause.resume());

const clamp = await page.evaluate(async (before) => {
  const g = window.__SANDS__;
  for (let i = 0; i < 600; i++) {
    if (g.frameNo > before.frameNo) break;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return { frames: g.frameNo - before.frameNo, elapsed: +(g.elapsed - before.elapsed).toFixed(6) };
}, clampBefore);

check(clamp.frames >= 1, 'a frame ran after Resume', `${clamp.frames}`);
check(clamp.elapsed <= GATE.maxDelta * clamp.frames + 1e-6,
  'THE DELTA CLAMP HELD ACROSS A 1.1 SECOND PAUSE',
  `${clamp.elapsed}s of simulation over ${clamp.frames} frame(s), `
  + `ceiling ${(GATE.maxDelta * clamp.frames).toFixed(6)}s`);

// ---------------------------------------------------------------------------
// 9. THE OTHER TWO WAYS IN
// ---------------------------------------------------------------------------
//
// Esc is only one of them, and it is not the reliable one. Pointer lock exits
// on Esc natively and Chrome does not consistently deliver a keydown for it, so
// the LOCK LOSS is the primary signal - and it also catches alt-tab, a system
// dialog, and a click outside the canvas, none of which produce a keystroke.

const lockPath = await page.evaluate(async () => {
  const g = window.__SANDS__;
  if (g.pause.paused) g.pause.resume();
  const real = document.pointerLockElement === document.getElementById('stage');
  if (real) {
    document.exitPointerLock();
  } else {
    // No lock to lose in this environment. Dispatch the event the browser would
    // dispatch - the handler reads document.pointerLockElement, which is
    // genuinely null - so the WIRING is under test even where the API is not.
    document.dispatchEvent(new Event('pointerlockchange'));
  }
  await new Promise((r) => setTimeout(r, 120));
  return { hadRealLock: real, paused: g.pause.paused, fallback: g.input.state.fallback };
});

check(lockPath.paused || lockPath.fallback,
  'LOSING POINTER LOCK OPENS THE MENU',
  `real lock: ${lockPath.hadRealLock}, paused: ${lockPath.paused}, fallback: ${lockPath.fallback}`);

const hiddenPath = await page.evaluate(async () => {
  const g = window.__SANDS__;
  if (g.pause.paused) g.pause.resume();
  const was = g.pause.paused;
  // document.hidden is read-only and cannot be produced from the page, so the
  // signal is stubbed and the HANDLER is what is under test. Labelled, because
  // a stubbed signal proves the wiring and not the browser.
  const proto = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  await new Promise((r) => setTimeout(r, 60));
  const after = g.pause.paused;
  delete document.hidden;
  if (proto) Object.defineProperty(Document.prototype, 'hidden', proto);
  return { was, after };
});

check(!hiddenPath.was && hiddenPath.after,
  'A HIDDEN TAB PAUSES ITSELF (handler, on a stubbed signal)',
  `${hiddenPath.was} -> ${hiddenPath.after}`);

// Esc, from the keyboard, closing it again.
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
const escClosed = await page.evaluate(() => window.__P__.snap());
check(!escClosed.paused, 'Esc closes the menu as well as opening it');

// ---------------------------------------------------------------------------
// 10. NOTHING GETS THROUGH THE PANEL
// ---------------------------------------------------------------------------
//
// The weapon bindings in main.js read keydown events directly and do NOT go
// through core/input.js, so suspending the input layer is not the whole freeze.
// A paused player who can still reload, swap weapons and buy whatever the
// crosshair was left on is a paused player who can lose the run from a menu.

const leak = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.weapons.equip('mk9');
  await window.__P__.frames(2);
  g.pause.open();
  const before = {
    weapon: g.weapons.state.current,
    gold: g.economy.gold,
    mag: g.weapons.magazine,
  };
  for (const code of ['Digit2', 'KeyR', 'KeyF', 'KeyV']) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  }
  window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
  await window.__P__.frames(4);
  const after = {
    weapon: g.weapons.state.current,
    gold: g.economy.gold,
    mag: g.weapons.magazine,
    paused: g.pause.paused,
  };
  g.pause.resume();
  return { before, after };
});

check(leak.after.weapon === leak.before.weapon,
  'a weapon digit does nothing while paused',
  `${leak.before.weapon} -> ${leak.after.weapon}`);
check(leak.after.gold === leak.before.gold,
  'F does not buy anything while paused',
  `${leak.before.gold} -> ${leak.after.gold}`);
check(leak.after.paused, 'and none of it resumed the game by accident');

// ---------------------------------------------------------------------------
// 11. LOOK AT IT
// ---------------------------------------------------------------------------
//
// Every number above is a state assertion, and STATE.md is explicit that a
// green suite here is fully compatible with a black screen. So the panel is
// photographed over both of the game's two backgrounds - the sunlit avenue at
// luma ~190 and a fire-lit chamber at ~25 - and every label on it is measured
// against the ground it actually stands on.

async function shootPair(name) {
  await page.evaluate(() => window.__P__.frames(2));
  const onBuf = await page.screenshot({ timeout: 90000 });
  writeFileSync(`${OUT}pause-${name}.png`, onBuf);

  // The panel hidden, WITHOUT resuming: the scene behind it is the comparison,
  // and unpausing to get it would photograph a different moment.
  await page.evaluate(() => window.__P__.panel(false));
  await page.evaluate(() => window.__P__.frames(2));
  const offBuf = await page.screenshot({ timeout: 90000 });
  await page.evaluate(() => window.__P__.panel(true));
  await page.evaluate(() => window.__P__.frames(2));

  return { on: decodePNG(onBuf), off: decodePNG(offBuf) };
}

const legibility = [];

/**
 * Where the ink is taken inside a tight text rect.
 *
 * Glyph coverage inside a box drawn around the glyphs themselves runs roughly
 * a fifth to a half depending on the string, so the bright tail is genuinely
 * the ink. p20 is the plate showing between the letters, which is the ground
 * the text actually stands on - and on this panel that ground is the sheet
 * rather than the game, because the sheet is opaque.
 */
const INK = 0.97;
const GROUND = 0.20;

async function measure(where, label) {
  for (const tab of ['game', 'video', 'audio', 'controls']) {
    await page.evaluate((t) => window.__P__.tab(t), tab);
    const { on, off } = await shootPair(`${where}-${tab}`);

    if (on.w !== VIEW.width) {
      throw new Error(`screenshot is ${on.w}px wide, viewport is ${VIEW.width}px: `
        + 'every rect below is in CSS pixels and would be measured in the wrong place');
    }

    // The frame BEHIND the panel, over the upper two thirds. The lower third is
    // the weapon and it renders perfectly well when nothing else does, so a
    // whole-frame mean can be carried entirely by the viewmodel.
    if (tab === 'game') {
      const frame = stats(off, [0, 0, off.w, off.h * 0.66]);
      check(frame.meanLuma > GATE.frameLuma, `${where}: the game is still drawn behind the panel`,
        `meanLuma ${frame.meanLuma} lit ${frame.percentLit}% clip ${frame.clip}% spread ${frame.spread}`);
    }

    // THE PANEL DREW AT ALL, measured once over the whole sheet rather than per
    // label. This is the black-screen guard; the per-label numbers below are
    // about legibility and would be meaningless without it.
    const sheet = await page.evaluate(() => {
      const el = document.querySelector('.pause-sheet');
      const b = el.getBoundingClientRect();
      return [b.x, b.y, b.x + b.width, b.y + b.height];
    });
    const sheetDiff = diff(on, off, sheet);
    check(sheetDiff.lift >= GATE.lift, `${where}/${tab}: THE PANEL ACTUALLY DREW`,
      `lift ${sheetDiff.lift} over ${sheetDiff.changedPct}% of the sheet`);

    const boxes = await page.evaluate(() => window.__P__.textBoxes());

    for (const [id, b] of Object.entries(boxes)) {
      const rect = [b.x, b.y, b.x + b.w, b.y + b.h];
      const s = stats(on, rect);

      const m = {
        contrast: ratio(s.pct(INK), s.pct(GROUND)),
        meanLuma: s.meanLuma,
        peak: s.peak,
        clip: s.clip,
        spread: s.spread,
        px: s.n,
        colour: b.colour,
      };
      legibility.push({ where, tab, id, ...m });

      check(m.contrast >= GATE.contrast, `${where}/${tab}: ${id} contrast`,
        `${m.contrast}:1 on its own ground, ${m.px}px, peak ${m.peak} `
        + `clip ${m.clip}% spread ${m.spread}, ${m.colour}`);
    }
  }
}

// --- over the courtyard -----------------------------------------------------

await page.evaluate(async () => {
  const g = window.__SANDS__;
  if (g.pause.paused) g.pause.resume();
  window.__P__.place(0, 24, 0);
  await window.__P__.frames(3);
  g.pause.open();
});
await measure('courtyard', 'the sunlit avenue');

// --- over a chamber ---------------------------------------------------------

// The router's own entry point, with the spawn pose test/hud.mjs uses. The
// space has to be swapped before the room is chosen, because `spaces.roomId`
// is only rewritten by world.update while the interior is the live space - a
// teleport with no swap leaves the game standing in a chamber that the rest of
// the systems still think is the desert.
const room = await page.evaluate(async () => {
  const g = window.__SANDS__;
  if (g.pause.paused) g.pause.resume();
  g.director.reset();
  g.player.heal(999);
  g.spaces.enter('interior', { x: 0, z: -143.5, rot: 0 });
  g.world.update(1 / 60, 0);
  const id = window.__P__.goRoom('chamber-of-ascent');
  await window.__P__.frames(6);
  g.pause.open();
  return { id, space: g.spaces.active };
});
notes.push(`  note interior shot taken in ${room.space} / ${room.id}`);
await measure('interior', 'a chamber inside the pyramid');

// --- the swatch audit -------------------------------------------------------
//
// The percentile measurement above is blind to dim text by construction: it
// takes the bright tail inside a rect, so a row whose value is bone and whose
// note is a muddy brown scores on the bone. Both methods are kept because
// neither on its own is the answer.

const groundHex = 'rgb(9, 6, 3)';   // the sheet, from the stylesheet
const swatches = await page.evaluate(() => {
  const out = [];
  for (const t of ['game', 'video', 'audio', 'controls']) {
    window.__P__.tab(t);
    for (const s of window.__P__.swatches()) out.push({ tab: t, ...s });
  }
  return out;
});

const swatchRows = [];
for (const s of swatches) {
  const r = cssRatio(s.color, groundHex);
  if (r === null) continue;
  swatchRows.push({ ...s, ratio: r });
}
swatchRows.sort((a, b) => a.ratio - b.ratio);

const worst = swatchRows[0];
check(!!worst && worst.ratio >= GATE.contrast,
  'every authored colour on the panel clears the floor',
  worst ? `worst is "${worst.text}" (${worst.what}) at ${worst.ratio}:1 in ${worst.color}` : 'none found');
check(swatchRows.length >= 20, 'the swatch audit found the panel', `${swatchRows.length} labels`);

// ---------------------------------------------------------------------------
// 12. NO EMOJI, ANYWHERE ON IT
// ---------------------------------------------------------------------------
//
// A house rule, and a testable one. Every mark on this interface is drawn as an
// SVG stroke; nothing is a glyph from an emoji font.

const glyphs = await page.evaluate(() => {
  const bad = [];
  const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
  for (const t of ['game', 'video', 'audio', 'controls']) {
    window.__P__.tab(t);
    for (const el of document.querySelectorAll('#pause *')) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3)
        .map((n) => n.textContent).join('');
      if (re.test(own)) bad.push(`${t}: ${el.className} "${own.trim().slice(0, 24)}"`);
    }
  }
  return bad;
});
check(glyphs.length === 0, 'NO EMOJI ON THE PANEL', glyphs.join(' | ') || 'clean');

const icons = await page.evaluate(() =>
  document.querySelectorAll('#pause svg.ico use').length);
check(icons >= 2, 'the panel uses the drawn icon set', `${icons} marks`);

// ---------------------------------------------------------------------------
// close
// ---------------------------------------------------------------------------

check(logs.length === 0, 'no console errors', logs.slice(0, 4).join(' | '));

await browser.close();

console.log('\nSETTINGS AND PAUSE\n');
for (const n of notes) console.log(n);

console.log('\nFOV / SENSITIVITY MATRIX');
console.log('  base   aim    sprint  span   hip scale  ads scale   OLD hip scale');
for (const r of fovMatrix) {
  console.log(`  ${String(r.base).padEnd(6)}${String(r.hip.adsFov).padEnd(7)}`
    + `${String(r.hip.sprintFov).padEnd(8)}${String(r.hip.span).padEnd(7)}`
    + `${String(r.hip.scale).padEnd(11)}${String(r.aim.scale).padEnd(12)}`
    + `${r.hip.wouldHaveScaled}`);
}

console.log('\nLEGIBILITY, measured on the glyphs and not on the row');
console.log('  where       tab        label          contrast  px     peak  spread  colour');
for (const r of legibility) {
  console.log(`  ${r.where.padEnd(12)}${r.tab.padEnd(11)}${r.id.padEnd(15)}`
    + `${`${r.contrast}:1`.padEnd(10)}${String(r.px).padEnd(7)}`
    + `${String(r.peak).padEnd(6)}${String(r.spread).padEnd(8)}${r.colour}`);
}

console.log('\nAUTHORED COLOURS, worst first');
for (const s of swatchRows.slice(0, 8)) {
  console.log(`  ${`${s.ratio}:1`.padEnd(9)}${String(s.size).padEnd(6)}${s.color.padEnd(20)}`
    + `${s.what.slice(0, 22).padEnd(24)}${s.text}`);
}

console.log(`\nshots -> ${OUT}`);

if (failures.length) {
  console.error(`\n${failures.length} CHECK(S) FAILED`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
