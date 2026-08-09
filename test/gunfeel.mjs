/**
 * GUN FEEL: the two things a player says about an upgraded weapon before they
 * say anything else - where the round came from, and what it sounded like.
 *
 * Written against two reported defects on the upgraded weapons, both of which
 * this file reproduced and measured before either was touched:
 *
 *   THE TRACER CAME FROM THE BOTTOM RIGHT OF THE SCREEN. systems/altar.js took
 *   the camera's world position and added a fixed (0.22, -0.16, 0) in camera
 *   space. The Z of that offset is ZERO, so the streak began exactly on the eye
 *   plane - in front of nothing, behind a near plane at 0.05 - and projected to
 *   an NDC of 4.7e13, -5.9e13. What reaches the screen is the near-plane clip of
 *   a line from a point at infinity past the bottom right corner, which is a
 *   streak flying in from under the player's right hand.
 *
 *   THE UPGRADED GUNS SOUNDED LIKE CHRISTMAS BELLS. core/audio.js played the
 *   pack-a-punch ring at `W.ringRate ?? 1.6`, and NO WEAPON PROFILE HAS EVER
 *   DEFINED A ringRate. Every gun in the armoury therefore played one fixed
 *   1.6 kHz note with a 262 ms decay. On an SMG at 900 rpm - 66.7 ms between
 *   rounds - four of them sound at once, forever, at the same pitch.
 *
 * ---------------------------------------------------------------------------
 * HOW IT IS MEASURED, AND WHY NOT ANY EASIER WAY
 * ---------------------------------------------------------------------------
 *
 * NOTHING BELOW IS SATISFIED BY A PROPERTY HAVING A VALUE. This project has
 * fourteen confirmed instances of something written that never rendered, and
 * three harnesses in one week that reported confident nonsense because they had
 * never measured the broken state they were declaring fixed.
 *
 *   THE TRACER is proved twice. First from the SCENE GRAPH: the mesh's world
 *   position is read on the frame it spawns, taken into camera space, and
 *   projected - so "in front of the eye" and "on the gun" are numbers rather
 *   than adjectives. Then from PIXELS: the composer is rendered twice in one
 *   synchronous block with only the tracer group's visibility changed between
 *   them, and the frames are differenced. A streak that is positioned
 *   perfectly and drawn nowhere produces two identical frames.
 *
 *   THE AUDIO is rendered through the REAL createAudio graph in an
 *   OfflineAudioContext - the path test/gunlab.html established - at each
 *   weapon's OWN cadence, and measured: spectral peakiness, where the loudest
 *   tonal peak sits, how far the envelope falls between rounds, and how long
 *   the sound keeps going after the last one. A bell scores differently from a
 *   gun on every one of those.
 *
 *   EVERY CASE HAS A CONTROL. The audio control is the SAME WEAPON NOT
 *   UPGRADED, rendered in the same run, because the whole claim is about one
 *   extra layer and the only honest comparison is with and without it. The
 *   tracer control is three weapons whose muzzles are 200mm, 540mm and 682mm
 *   in front of the hand: if the probe returns the same screen position for all
 *   three it is reading a constant and the "it comes out of the gun" check is
 *   worth nothing, so that is checked explicitly.
 *
 *   AND THE RING HAS TO STILL BE THERE. A gun that no longer sounds like a bell
 *   because the shimmer was deleted is a different bug with better numbers, so
 *   the last audio gate measures the ring's own fundamental with and without
 *   the upgrade and requires the upgrade to be louder there.
 *
 * ---------------------------------------------------------------------------
 * WHEN TO RUN IT
 * ---------------------------------------------------------------------------
 *
 * After ANY change to: systems/altar.js's tracer pool, player/viewmodel.js's
 * muzzle or flash mounting, player/weapons.js's fire path, core/gunsmith.js's
 * REPORTS table or bakeRing, or core/audio.js's shot(). Also after a weapon's
 * rpm changes in BASE_STATS - the ring's `ms` ceiling is derived from the
 * cadence, and a weapon that got faster without its ring getting shorter is
 * the bell coming back.
 *
 * It is IN `npm test`. It is about a minute: three weapons of real frames for
 * the tracer, and the audio is offline and faster than real time.
 *
 * Usage:  node test/gunfeel.mjs [url]
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS, dismissBriefing } from './chrome.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const ROOT = new URL('../', import.meta.url).pathname;
const OUT = ROOT + 'shots/';
mkdirSync(OUT, { recursive: true });

const W = 1280, H = 720;

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
// BEGIN raises the briefing card now; the world is held behind it. See chrome.mjs.
await dismissBriefing(page);
await page.waitForTimeout(2200);

// ---------------------------------------------------------------------------
// 1. THE TRACER, FROM THE SCENE GRAPH AND FROM THE PIXELS
// ---------------------------------------------------------------------------

/**
 * Three weapons, deliberately chosen for the distance from the shooting hand to
 * the crown: 200mm, 540mm, 682mm. They are the control for each other.
 */
const TRACER_CASES = ['mk9', 'carbine', 'lmg'];

const tracer = [];
for (const weapon of TRACER_CASES) {
  const r = await page.evaluate(async (id) => {
    const g = window.__SANDS__;
    const THREE = g.THREE;
    const frames = (n) => new Promise((res) => {
      let k = 0;
      const step = () => (++k >= n ? res() : requestAnimationFrame(step));
      requestAnimationFrame(step);
    });

    g.weapons.grant(id);
    g.weapons.equip(id);
    g.weapons.upgrade(id);

    // Real frames until the weapon is actually up. The raise track is what puts
    // the muzzle where it lives; measuring during it measures a pose the player
    // never shoots from.
    for (let i = 0; i < 24 && g.viewmodel.state.phase !== 'ready'; i++) await frames(1);
    await frames(2);

    // Capture the streak on the frame it spawns, from the object the game just
    // positioned - not from a re-derivation of where it ought to be.
    const real = g.altar.tracer;
    const rows = [];
    const inv = new THREE.Matrix4();
    g.altar.tracer = (end, wid) => {
      const t = real(end, wid);
      if (!t) return t;
      const p = t.mesh.getWorldPosition(new THREE.Vector3());
      inv.copy(g.camera.matrixWorldInverse);
      const cam = p.clone().applyMatrix4(inv);
      const ndc = p.clone().project(g.camera);
      const endNdc = end.clone().project(g.camera);
      const mz = g.viewmodel.muzzleNdc
        ? g.viewmodel.muzzleNdc(new THREE.Vector3()) : null;
      // The same muzzle, derived HERE instead of asked for: the flash group is
      // what the viewmodel parks on the crown, and projecting it through the
      // viewmodel's camera is a path that does not run a line of the module's
      // own code. If muzzleNdc were returning a plausible constant these two
      // would part company.
      const fp = g.viewmodel.flashLight && g.viewmodel.flashLight.parent;
      const mi = fp ? fp.getWorldPosition(new THREE.Vector3()).project(g.viewmodel.camera) : null;
      rows.push({
        camZ: +cam.z.toFixed(4),
        ndc: [+ndc.x.toFixed(4), +ndc.y.toFixed(4)],
        endNdc: [+endNdc.x.toFixed(4), +endNdc.y.toFixed(4)],
        muzzleNdc: mz ? [+mz.x.toFixed(4), +mz.y.toFixed(4)] : null,
        muzzleIndep: mi ? [+mi.x.toFixed(4), +mi.y.toFixed(4)] : null,
        lenM: +t.mesh.scale.z.toFixed(3),
      });
      return t;
    };

    // REAL INPUT: the game's own mousedown binding, not weapons.fire(). The
    // loop then runs the whole path - input -> weapons.update -> fire -> tracer.
    window.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    let live = null;
    for (let i = 0; i < 14 && rows.length < 1; i++) {
      await frames(1);
      const alive = g.altar.tracerGroup.children.filter((m) => m.visible);
      if (alive.length) live = alive[alive.length - 1];
    }
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    g.altar.tracer = real;

    // --- the pixels ---------------------------------------------------------
    //
    // Two renders of the SAME frame in one synchronous block, with nothing
    // changed between them but the tracer group's visibility. No requestAnimation
    // Frame can interleave inside this, so the grain, the sky, the horde and the
    // viewmodel are bit-identical in both and every differing pixel is a streak.
    let pix = { rendered: false };
    if (live) {
      // No rAF can run between the two renders below, so the streak's 75 ms
      // life is not counted down between them and nothing has to be pinned.
      live.visible = true;

      const gl = g.renderer.getContext();
      const cw = g.renderer.domElement.width, chh = g.renderer.domElement.height;
      const grab = () => {
        const buf = new Uint8Array(cw * chh * 4);
        gl.readPixels(0, 0, cw, chh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        return buf;
      };

      g.altar.tracerGroup.visible = true;
      g.composer.render(0);
      const a = grab();
      g.altar.tracerGroup.visible = false;
      g.composer.render(0);
      const b = grab();
      g.altar.tracerGroup.visible = true;

      // Where did the frame change, and by how much. Coordinates are put back
      // into NDC so they are comparable with everything above; readPixels is
      // bottom-up, which is already NDC's own handedness in y.
      let count = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      let sx = 0, sy = 0, lowSumX = 0, lowN = 0;
      for (let i = 0, px = 0; i < a.length; i += 4, px++) {
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (d < 24) continue;
        const x = px % cw, y = (px / cw) | 0;
        count++; sx += x; sy += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        // The x AT the lowest row, not the middle of the bounding box: the
        // streak is a diagonal, and the centre of its box is nowhere on it.
        if (y < minY) { minY = y; lowSumX = x; lowN = 1; } else if (y === minY) { lowSumX += x; lowN++; }
      }
      const toNdc = (x, y) => [+((x / cw) * 2 - 1).toFixed(4), +((y / chh) * 2 - 1).toFixed(4)];

      /**
       * CONTAINMENT, not extremes.
       *
       * The first version of this took the LOWEST changed pixel in the frame
       * and called it the muzzle end of the streak, and it was wrong for a
       * reason worth keeping: a bright additive line goes through the bloom
       * chain, and the lowest mip of a bloom is effectively global, so a
       * handful of pixels a third of a screen away cross any sane difference
       * threshold. One stray pixel then decides the verdict.
       *
       * Asking whether the changed set CONTAINS pixels at the muzzle, and
       * whether it contains pixels at the impact, has no such failure mode: it
       * is a question about where the streak IS rather than about where the
       * furthest thing that moved happens to be.
       */
      const near = (ndcX, ndcY, radiusPx) => {
        const px = ((ndcX + 1) / 2) * cw, py = ((ndcY + 1) / 2) * chh;
        let n = 0;
        for (let i = 0, k = 0; i < a.length; i += 4, k++) {
          const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          if (d < 24) continue;
          const x = k % cw, y = (k / cw) | 0;
          if ((x - px) * (x - px) + (y - py) * (y - py) <= radiusPx * radiusPx) n++;
        }
        return n;
      };

      const mzNdc = (rows[0] && rows[0].muzzleNdc) || (rows[0] && rows[0].muzzleIndep);
      const imNdc = rows[0] && rows[0].endNdc;

      /**
       * DOES THE PAINTED STREAK LIE ON THE LINE FROM THE MUZZLE TO THE IMPACT?
       *
       * The strongest thing pixels can be asked here, and it needs no tuned
       * radius. A streak that leaves the crown and lands on the hit point is
       * that segment; the broken build's streak is a different segment
       * entirely - it runs from the bottom right CORNER of the frame to the
       * same hit point, so it shares only the last few dozen pixels.
       *
       * Occlusion cannot break it: the viewmodel is drawn over the world and
       * the gun's own slide hides the first centimetres of the streak, which
       * REMOVES painted pixels from the line rather than adding painted pixels
       * off it. Bloom cannot break it either, for the same reason a 14 px
       * tolerance is generous rather than tight.
       */
      const onLine = (() => {
        if (!mzNdc || !imNdc) return null;
        const ax = ((mzNdc[0] + 1) / 2) * cw, ay = ((mzNdc[1] + 1) / 2) * chh;
        const bx = ((imNdc[0] + 1) / 2) * cw, by = ((imNdc[1] + 1) / 2) * chh;
        const vx = bx - ax, vy = by - ay;
        const vv = vx * vx + vy * vy;
        let on = 0, tot = 0;
        for (let i = 0, k = 0; i < a.length; i += 4, k++) {
          const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          if (d < 24) continue;
          tot++;
          const x = k % cw, y = (k / cw) | 0;
          let t = vv > 0 ? ((x - ax) * vx + (y - ay) * vy) / vv : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = x - (ax + t * vx), dy = y - (ay + t * vy);
          if (dx * dx + dy * dy <= 14 * 14) on++;
        }
        return tot ? on / tot : 0;
      })();

      // The frame WITH the streak in it, as a picture. Flipped, because
      // readPixels counts rows from the bottom and a PNG counts from the top.
      const cvs = document.createElement('canvas');
      cvs.width = cw; cvs.height = chh;
      const c2 = cvs.getContext('2d');
      const img = c2.createImageData(cw, chh);
      for (let y = 0; y < chh; y++) {
        img.data.set(a.subarray((chh - 1 - y) * cw * 4, (chh - y) * cw * 4), y * cw * 4);
      }
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      c2.putImageData(img, 0, 0);

      pix = {
        rendered: count > 0,
        changed: count,
        onLineFrac: onLine === null ? null : +onLine.toFixed(3),
        atMuzzle: mzNdc ? near(mzNdc[0], mzNdc[1], 40) : 0,
        atImpact: imNdc ? near(imNdc[0], imNdc[1], 40) : 0,
        lowNdc: count ? toNdc(lowSumX / Math.max(1, lowN), minY) : null,
        bboxNdc: count ? [toNdc(minX, minY), toNdc(maxX, maxY)] : null,
        centroidNdc: count ? toNdc(sx / count, sy / count) : null,
        png: cvs.toDataURL('image/png'),
      };
    }

    return { weapon: id, rows, pix, near: g.camera.near, live: !!live,
             inputActive: !!g.input.state.active, phase: g.viewmodel.state.phase };
  }, weapon);
  if (r.pix && r.pix.png) {
    writeFileSync(`${OUT}gunfeel-tracer-${weapon}.png`,
      Buffer.from(r.pix.png.split(',')[1], 'base64'));
    delete r.pix.png;
  }
  tracer.push(r);
  // Let the pinned streaks expire before the next case.
  await page.evaluate(() => { window.__SANDS__.altar.setFidelity(false); window.__SANDS__.altar.setFidelity(true); });
}

// ---------------------------------------------------------------------------
// 2. THE SOUND, RENDERED AND MEASURED
// ---------------------------------------------------------------------------
//
// Sustained fire at each weapon's real cadence, upgraded and not. Three renders
// per case and the MEDIAN reported: variant choice, playback rate and level are
// randomised per shot, and one render of one draw is a number that moves by
// three decibels between runs.

const lab = await browser.newPage({ viewport: { width: 600, height: 400 } });
lab.on('pageerror', (e) => logs.push(`[lab pageerror] ${e.message}`));
await lab.goto(new URL('test/gunlab.html', BASE).href, { waitUntil: 'load' });
await lab.waitForFunction(() => window.__GUNLAB_READY__, null, { timeout: 30000 });

const audio = await lab.evaluate(async () => {
  // Resolved against the lab page, not the server root: a root-absolute path
  // works on localhost and silently misses on a Pages subpath, which is the one
  // deploy this harness most needs to be able to check.
  const { createAudio } = await import(new URL('../src/core/audio.js', location.href).href);
  const { REPORTS } = await import(new URL('../src/core/gunsmith.js', location.href).href);
  const RATE = 48000;
  const REPEATS = 3;

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  function spectrum(x, from, size) {
    const re = new Float32Array(size), im = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1));
      re[i] = (from + i < x.length ? x[from + i] : 0) * w;
    }
    fft(re, im);
    const half = size >> 1, mag = new Float32Array(half);
    for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]) / half;
    return { mag, binHz: RATE / size };
  }

  /**
   * PEAK OVER MEDIAN across the band a shimmer lives in.
   *
   * The honest measure of "is there a note in here". A gunshot's spectrum in
   * this band is broadband and lumpy, so its loudest bin sits maybe 16-24 dB
   * over the middle of the distribution. A sustained sine stack sits 34-41 dB
   * over it, and the bin it sits in is the note. The median is used rather than
   * the mean because a strong enough tone drags a mean up towards itself and
   * flatters exactly the case being caught.
   */
  function tonality(mag, binHz, lo, hi) {
    const a = Math.max(1, Math.floor(lo / binHz)), b = Math.min(mag.length - 1, Math.ceil(hi / binHz));
    const s = [];
    for (let i = a; i <= b; i++) s.push(mag[i]);
    s.sort((p, q) => p - q);
    const med = s[s.length >> 1] || 1e-12;
    let peak = 0, pi = a;
    for (let i = a; i <= b; i++) if (mag[i] > peak) { peak = mag[i]; pi = i; }
    return { ratioDb: 20 * Math.log10(peak / med), peakHz: pi * binHz };
  }

  /** How far the level falls between rounds, against how loud the rounds are. */
  function gapFillDb(x, from, to) {
    const win = Math.round(RATE * 0.002);
    let hi = 0, lo = Infinity;
    for (let s = from; s + win < to; s += win) {
      let m = 0;
      for (let i = s; i < s + win; i++) { const v = Math.abs(x[i]); if (v > m) m = v; }
      if (m > hi) hi = m;
      if (m < lo) lo = m;
    }
    return 20 * Math.log10(Math.max(lo, 1e-9) / Math.max(hi, 1e-9));
  }

  const goertzel = (x, hz) => {
    const w = 2 * Math.PI * hz / RATE, c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < x.length; i++) { const s = x[i] + c * s1 - s2; s2 = s1; s1 = s; }
    return Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - c * s1 * s2)) / Math.max(1, x.length);
  };

  async function mono(events, seconds) {
    const oac = new OfflineAudioContext(2, Math.floor(RATE * seconds), RATE);
    const a = createAudio({ context: oac, volume: 1 });
    await a.resume();
    a.setSpace('exterior');
    for (const e of events) a.shot(e.w, e.o);
    const b = await oac.startRendering();
    const L = b.getChannelData(0), R = b.getChannelData(1);
    const x = new Float32Array(b.length);
    for (let i = 0; i < b.length; i++) x[i] = (L[i] + R[i]) * 0.5;
    return x;
  }

  const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };

  const realRandom = Math.random;
  const pin = (seed) => {
    let st = seed >>> 0 || 1;
    Math.random = () => {
      st ^= st << 13; st >>>= 0; st ^= st >>> 17; st ^= st << 5; st >>>= 0;
      return st / 4294967296;
    };
  };

  /**
   * One train of sustained fire, measured.
   *
   * THE SEED IS PINNED, AND IT IS THE SAME SEED FOR THE UPGRADED TRAIN AND THE
   * STOCK ONE. Fourteen rounds each choosing one of five baked variants, with a
   * jittered rate, level and mechanical delay, is a different sound every time;
   * comparing an upgraded train against a stock train drawn separately measures
   * that lottery at least as much as it measures the ring. Pinned, the two
   * trains are the same fourteen rounds and the difference between their
   * numbers is the shimmer and nothing else. Three seeds rather than one,
   * because the numbers should be shown to be about the weapon and not about a
   * lucky draw.
   */
  async function train(weapon, rpm, upgraded) {
    const gap = 60 / rpm, rounds = 14;
    const runs = [];
    for (let k = 0; k < REPEATS; k++) {
      pin(0xbeef + k * 7919);
      const ev = [];
      for (let i = 0; i < rounds; i++) ev.push({ w: weapon, o: { delay: i * gap, upgraded } });
      const x = await mono(ev, rounds * gap + 1.0);

      // Steady state only: from the fourth round, by which point whatever the
      // sound does when it piles up is already piled up.
      const from = Math.floor(4 * gap * RATE);
      const to = Math.floor(rounds * gap * RATE);
      const sp = spectrum(x, from, 16384);
      const t = tonality(sp.mag, sp.binHz, 900, 14000);

      // Power inside the ring's own band, +/-4% to cover the per-shot rate
      // jitter. This is the direct form of the question the whole audio half of
      // this file is asking: how much energy is the upgrade piling up at its
      // shimmer's pitch while the weapon is being held down.
      const rr = (REPORTS[weapon].ring || { rate: 1.6 }).rate * 1000;
      let rp = 0;
      for (let i = Math.floor(rr * 0.96 / sp.binHz); i <= Math.ceil(rr * 1.04 / sp.binHz) && i < sp.mag.length; i++) {
        rp += sp.mag[i] * sp.mag[i];
      }

      const lastAt = Math.floor((rounds - 1) * gap * RATE);
      let peak = 0;
      for (let i = lastAt; i < Math.min(x.length, lastAt + RATE * 0.05); i++) peak = Math.max(peak, Math.abs(x[i]));
      let out = lastAt;
      for (let i = lastAt; i < x.length; i++) if (Math.abs(x[i]) > peak * 0.01) out = i;

      // Sustained fire is where a mix clips, and making the shimmer louder is
      // exactly the change that would do it. Nothing in Web Audio reports it.
      let clipped = 0;
      for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= 0.999) clipped++;

      runs.push({
        tonalityDb: t.ratioDb, peakHz: t.peakHz,
        gapDb: gapFillDb(x, from, to),
        ringOutMs: ((out - lastAt) / RATE) * 1000,
        ringBandDb: 10 * Math.log10(Math.max(rp, 1e-24)),
        clipped,
      });
      Math.random = realRandom;
    }
    return {
      weapon, rpm, upgraded,
      tonalityDb: +median(runs.map((r) => r.tonalityDb)).toFixed(2),
      peakHz: Math.round(median(runs.map((r) => r.peakHz))),
      gapDb: +median(runs.map((r) => r.gapDb)).toFixed(2),
      ringOutMs: +median(runs.map((r) => r.ringOutMs)).toFixed(1),
      ringBandDb: +median(runs.map((r) => r.ringBandDb)).toFixed(2),
      ringHz: Math.round((REPORTS[weapon].ring || { rate: 1.6 }).rate * 1000),
      clipped: Math.max(...runs.map((r) => r.clipped)),
    };
  }

  /**
   * IS THE SHIMMER STILL AUDIBLE AT ALL?
   *
   * Without this check, deleting the ring outright passes every gate above with
   * room to spare, and "no longer sounds like a bell" would have been bought by
   * making an upgraded gun sound exactly like a stock one.
   *
   * THIS IS AN EXACT MEASUREMENT, NOT A STATISTICAL ONE, and getting there took
   * three tries that are worth recording because each one produced confident
   * numbers that moved between runs of an unchanged build:
   *
   *   ONE GOERTZEL AT THE RING'S FUNDAMENTAL, mean of five shots. The SMG read
   *   +0.1 dB and +3.8 dB on two runs. A single 20 Hz bin of a noisy signal has
   *   a hundred per cent relative spread, and the ring's rate is jittered
   *   +/-3 per cent per shot so it is not reliably in that bin anyway.
   *
   *   A COMB ACROSS THE INHARMONIC PARTIALS. Better in principle, worse in
   *   fact: the upper partials are the quietest and shortest part of the ring
   *   and they sit where the crack's opening two milliseconds are broadband.
   *
   *   BAND POWER ACROSS f0 +/- 4 PER CENT, median of nine. Closer, and still
   *   moved the carbine from +5.6 dB to +0.4 dB between runs.
   *
   * All three were measuring the same thing the wrong way round: comparing two
   * DIFFERENT shots and attributing the difference to the ring, when five baked
   * variants and three randomised parameters mean two shots of the same weapon
   * differ by far more than a shimmer.
   *
   * So Math.random is PINNED to a seed, the weapon is rendered once without the
   * upgrade and once with it, and the two renders are SUBTRACTED. With the same
   * seed, everything else about the two shots - which variant, its rate, its
   * level, the mechanical layer and its delay - is bit identical, and what is
   * left in the difference is the ring and nothing else. There is no variance
   * left to average away, which is why three seeds are enough and why the
   * numbers below repeat to two decimal places.
   *
   * It runs on test/gunlab.html rather than on the game, because the game's own
   * requestAnimationFrame loop draws from Math.random several times a frame and
   * would pull the two renders out of step while the first one was still
   * rendering.
   */
  async function presence(weapon) {
    const R = REPORTS[weapon].ring || { rate: 1.6 };
    const f0 = R.rate * 1000;
    const realRandom = Math.random;
    const pin = (seed) => {
      let st = seed >>> 0 || 1;
      Math.random = () => {
        st ^= st << 13; st >>>= 0; st ^= st >>> 17; st ^= st << 5; st >>>= 0;
        return st / 4294967296;
      };
    };

    // 60 ms: every ring in the table is over by then, and it is the window in
    // which a shimmer either sits on the shot or does not. Measuring across
    // 200 ms would divide the ring by however long that weapon's tail happens
    // to be, which is a statement about the tail.
    const win = Math.floor(RATE * 0.06);
    const rmsOf = (x) => { let s2 = 0; for (let i = 0; i < win; i++) s2 += x[i] * x[i]; return Math.sqrt(s2 / win); };

    const runs = [];
    try {
      for (let k = 0; k < 3; k++) {
        const seed = 0x51ed + k * 7919;
        pin(seed);
        const base = await mono([{ w: weapon, o: { upgraded: false } }], 0.8);
        pin(seed);
        const up = await mono([{ w: weapon, o: { upgraded: true } }], 0.8);

        const n = Math.min(base.length, up.length);
        const diff = new Float32Array(n);
        let identical = true;
        for (let i = 0; i < n; i++) {
          diff[i] = up[i] - base[i];
          if (identical && Math.abs(diff[i]) > 1e-7) identical = false;
        }

        // WHERE THE ADDED ENERGY SITS.
        //
        // Not always the fundamental, and the reason is in the bake: the ring
        // is five partials at ratios 1, 2.41, 3.17, 4.83, 6.29, the upper ones
        // decay faster, and each weapon's `ms` ceiling cuts the stack at a
        // different point. On the four profiles with a long ceiling the 2.41
        // partial is what is left standing. So the claim checked downstream is
        // that the added energy lands on ONE OF THE RING'S OWN PARTIALS, which
        // nothing but the ring can satisfy - not that it lands on the first.
        const sp = spectrum(diff, 0, 16384);
        let peak = 0, pi = 1;
        for (let i = Math.floor(300 / sp.binHz); i < sp.mag.length; i++) {
          if (sp.mag[i] > peak) { peak = sp.mag[i]; pi = i; }
        }

        runs.push({
          identical,
          addedDb: 20 * Math.log10(Math.max(rmsOf(diff), 1e-12) / Math.max(rmsOf(base), 1e-12)),
          diffPeakHz: pi * sp.binHz,
        });
      }
    } finally {
      Math.random = realRandom;
    }

    const median2 = (a) => { const q = [...a].sort((x, y) => x - y); return q[q.length >> 1]; };
    const hz = median2(runs.map((r) => r.diffPeakHz));
    // The ratios bakeRing() is built from. The measured peak has to be one.
    const PARTIALS = [1, 2.41, 3.17, 4.83, 6.29];
    let bestErr = Infinity, bestP = 1;
    for (const q of PARTIALS) {
      const e = Math.abs(hz - f0 * q) / (f0 * q);
      if (e < bestErr) { bestErr = e; bestP = q; }
    }
    return {
      weapon, ringHz: f0,
      // The upgrade must CHANGE the shot at all. Silence here is a deleted feature.
      identical: runs.some((r) => r.identical),
      // How loud the added layer is against the shot it is added to.
      addedDb: +median2(runs.map((r) => r.addedDb)).toFixed(2),
      diffPeakHz: Math.round(hz),
      partial: bestP,
      partialErrPct: +(100 * bestErr).toFixed(1),
    };
  }

  // The cadences are BASE_STATS' own rpm. mk9 is semi-automatic; 410 is the
  // rate limiter's ceiling and a determined player gets close to it.
  const CADENCE = [['smg', 900], ['lmg', 620], ['rifle', 700], ['pistol', 410]];

  const trains = [];
  for (const [w, rpm] of CADENCE) {
    trains.push(await train(w, rpm, false));
    trains.push(await train(w, rpm, true));
  }

  const pres = [];
  for (const w of Object.keys(REPORTS)) pres.push(await presence(w));

  return { trains, pres, profiles: Object.keys(REPORTS) };
});

await lab.close();
await browser.close();

// ---------------------------------------------------------------------------
// the verdict
// ---------------------------------------------------------------------------

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

// --- tracer ----------------------------------------------------------------

const shots = tracer.flatMap((c) => c.rows.map((r) => ({ ...r, weapon: c.weapon })));
check('a tracer was spawned for every upgraded weapon',
  tracer.every((c) => c.rows.length > 0),
  tracer.map((c) => `${c.weapon}:${c.rows.length}`).join(' '));

// The one that fails outright on the old code: z was exactly 0.
check('the streak starts IN FRONT of the eye, past the near plane',
  shots.length > 0 && shots.every((r) => r.camZ < -tracer[0].near),
  shots.map((r) => `${r.weapon} camZ=${r.camZ}`).join(' '));

check('the streak starts ON the screen',
  shots.length > 0 && shots.every((r) => Math.abs(r.ndc[0]) <= 1 && Math.abs(r.ndc[1]) <= 1),
  shots.map((r) => `${r.weapon} ndc=${r.ndc}`).join(' '));

const nearMuzzle = shots.map((r) => {
  if (!r.muzzleNdc) return Infinity;
  return Math.hypot(r.ndc[0] - r.muzzleNdc[0], r.ndc[1] - r.muzzleNdc[1]);
});
check('the streak starts ON THE MUZZLE, within 0.05 NDC',
  nearMuzzle.length > 0 && nearMuzzle.every((d) => d <= 0.05),
  shots.map((r, i) => `${r.weapon} d=${nearMuzzle[i].toFixed(4)}`).join(' '));

/**
 * THE CONTROL, and without it the check above is worth nothing.
 *
 * Three weapons whose crowns are 200mm, 540mm and 682mm in front of the hand
 * must not all report the same muzzle. If they do, muzzleNdc is returning a
 * constant, and "the streak starts on the muzzle" is a tautology about two
 * copies of one number.
 */
const muzzles = tracer.map((c) => (c.rows[0] && c.rows[0].muzzleNdc) || null).filter(Boolean);
let spread = 0;
for (let i = 0; i < muzzles.length; i++) {
  for (let j = i + 1; j < muzzles.length; j++) {
    spread = Math.max(spread, Math.hypot(muzzles[i][0] - muzzles[j][0], muzzles[i][1] - muzzles[j][1]));
  }
}
check('the probe reads a DIFFERENT muzzle per weapon (control)',
  muzzles.length === TRACER_CASES.length && spread > 0.02,
  `spread=${spread.toFixed(4)} ${JSON.stringify(muzzles)}`);

// --- tracer, in pixels -----------------------------------------------------

const drawn = tracer.filter((c) => c.pix.rendered);
check('the streak actually RENDERS (frame diff, tracer group on vs off)',
  drawn.length === tracer.length,
  tracer.map((c) => `${c.weapon}:${c.pix.changed ?? 0}px`).join(' '));

check('THE PAINTED STREAK LIES ON THE MUZZLE-TO-IMPACT LINE (>= 70% of it)',
  tracer.every((c) => (c.pix.onLineFrac || 0) >= 0.70),
  tracer.map((c) => `${c.weapon}:${Math.round(100 * (c.pix.onLineFrac || 0))}% of ${c.pix.changed}px` +
                    ` (${c.pix.atMuzzle} within 40px of the crown)`).join('  '));

check('and painted pixels at the impact - it is a streak, not a spark',
  tracer.every((c) => (c.pix.atImpact || 0) >= 5),
  tracer.map((c) => `${c.weapon}:${c.pix.atImpact}px within 40px of the hit`).join('  '));

/**
 * The muzzle the streak was built from, against the muzzle this harness derived
 * for itself off the flash group. Two paths, one answer, or muzzleNdc is
 * returning something plausible rather than something true.
 */
const indep = shots.map((r) => (r.muzzleIndep && r.muzzleNdc)
  ? Math.hypot(r.muzzleNdc[0] - r.muzzleIndep[0], r.muzzleNdc[1] - r.muzzleIndep[1])
  : Infinity);
check('muzzleNdc agrees with the harness\'s own projection of the flash group',
  indep.every((d) => d <= 0.005),
  shots.map((r, i) => `${r.weapon} ${JSON.stringify(r.muzzleIndep)} d=${indep[i].toFixed(5)}`).join(' '));

// --- audio -----------------------------------------------------------------

const by = (w, up) => audio.trains.find((t) => t.weapon === w && t.upgraded === up);
const pairs = ['smg', 'lmg', 'rifle', 'pistol'].map((w) => {
  const b = by(w, false), u = by(w, true);
  return { w, b, u,
    dTon: +(u.tonalityDb - b.tonalityDb).toFixed(2),
    dGap: +(u.gapDb - b.gapDb).toFixed(2),
    dRing: +(u.ringOutMs - b.ringOutMs).toFixed(1),
    dBand: +(u.ringBandDb - b.ringBandDb).toFixed(2) };
});

check('the upgrade does not add a TONE to sustained fire (<= 8 dB over its own base)',
  pairs.every((p) => p.dTon <= 8),
  pairs.map((p) => `${p.w} ${p.b.tonalityDb}->${p.u.tonalityDb} (${p.dTon >= 0 ? '+' : ''}${p.dTon})`).join('  '));

check('the gaps between rounds stay gaps (<= 8 dB of fill)',
  pairs.every((p) => p.dGap <= 8),
  pairs.map((p) => `${p.w} ${p.b.gapDb}->${p.u.gapDb} (${p.dGap >= 0 ? '+' : ''}${p.dGap})`).join('  '));

check('the upgrade does not ring on after the last round (<= 60 ms over its own base)',
  pairs.every((p) => p.dRing <= 60),
  pairs.map((p) => `${p.w} ${p.b.ringOutMs}->${p.u.ringOutMs}ms (${p.dRing >= 0 ? '+' : ''}${p.dRing})`).join('  '));

check('sustained fire does not clip, upgraded or not',
  audio.trains.every((t) => t.clipped === 0),
  audio.trains.map((t) => `${t.weapon}${t.upgraded ? '+' : ''}:${t.clipped}`).join(' '));

/**
 * THE UPGRADE MUST NOT PILE A TONE UP AT ITS OWN PITCH.
 *
 * This is the sharpest single number in the file and it is what the report
 * "they sound like Christmas bells" actually describes. Sustained fire is
 * rendered twice off the SAME PINNED SEED - identical variants, identical rate
 * and level jitter, identical mechanical layer - and the only difference
 * between the two trains is the ring. The energy inside the ring's own band is
 * then compared between them, in the steady state, from the fourth round on.
 *
 * A shimmer that decays inside its weapon's cadence adds a few decibels there.
 * A shimmer that outlives the cadence adds the same energy again on every round
 * for as long as the trigger is held, and that is not a few decibels.
 *
 * Measured on the broken build - one fixed 1.6 kHz note, 262 ms of decay, on
 * every weapon in the armoury - and on this one, in the same harness. The gate
 * sits at 12 dB, which is above every correct weapon with room and far below
 * every broken one. (See shots/gunfeel-report.json for the run behind the
 * numbers printed above.)
 */
check('the upgrade does not pile a tone up at its shimmer\'s own pitch (<= 12 dB)',
  pairs.every((p) => p.dBand <= 12),
  pairs.map((p) => `${p.w}@${p.u.ringHz}Hz ${p.b.ringBandDb}->${p.u.ringBandDb}dB (${p.dBand >= 0 ? '+' : ''}${p.dBand})`).join('  '));

check('the pack-a-punch shimmer is still THERE on every profile',
  audio.pres.every((p) => !p.identical),
  audio.pres.map((p) => `${p.weapon}:${p.identical ? 'IDENTICAL TO STOCK' : 'present'}`).join(' '));

/**
 * -36 dB is a FLOOR, not a target, and the number comes from the measurements
 * rather than from taste. Across the eight profiles the shimmer lands between
 * -18 and -31 dB against its own shot over the same 60 ms, and the spread is
 * not slack: it is the rate of fire. The LMG cannot carry a louder one - at
 * 0.175 its ring becomes the loudest tonal peak in sustained fire and the peak
 * check below goes red - so the gate has to sit under the quietest weapon that
 * is CORRECT. What it catches is the ring being deleted, muted, or knocked down
 * by a factor of three by a typo, which are the ways this stops existing.
 */
check('the shimmer is loud enough to hear (>= -36 dB against the shot)',
  audio.pres.every((p) => p.addedDb >= -36),
  audio.pres.map((p) => `${p.weapon} ${p.addedDb}dB`).join('  '));

check('and what was added IS the ring - it lands on one of its partials (<= 3%)',
  audio.pres.every((p) => p.partialErrPct <= 3),
  audio.pres.map((p) => `${p.weapon} ${p.diffPeakHz}Hz = ${p.partial}x${p.ringHz} (${p.partialErrPct}%)`).join('  '));

// ---------------------------------------------------------------------------

const report = {
  url: BASE,
  tracer: tracer.map((c) => ({ weapon: c.weapon, rows: c.rows, pix: c.pix })),
  audio,
  checks,
};
writeFileSync(`${OUT}gunfeel-report.json`, JSON.stringify(report, null, 2));

console.log('\nTRACER');
for (const c of tracer) {
  for (const r of c.rows) {
    console.log(`  ${c.weapon.padEnd(8)} start ndc ${String(r.ndc).padEnd(20)} camZ ${String(r.camZ).padEnd(9)}` +
                ` muzzle ${String(r.muzzleNdc)}  impact ${String(r.endNdc)}`);
  }
  console.log(`  ${c.weapon.padEnd(8)} painted ${c.pix.changed ?? 0} px, ` +
              `${Math.round(100 * (c.pix.onLineFrac || 0))}% of them on the muzzle-to-impact line, ` +
              `bbox ${JSON.stringify(c.pix.bboxNdc)}`);
}

console.log('\nSUSTAINED FIRE, stock -> upgraded off the same pinned seed');
console.log('             tonality           gap fill          ring-out         energy in the ring band');
for (const p of pairs) {
  const f = (b, u, unit = '') => `${String(b).padStart(7)}${unit}->${String(u).padStart(7)}${unit}`;
  console.log(`  ${p.w.padEnd(7)} ${f(p.b.tonalityDb, p.u.tonalityDb, 'dB')}  ${f(p.b.gapDb, p.u.gapDb, 'dB')}  ` +
              `${f(p.b.ringOutMs, p.u.ringOutMs, 'ms')}  ${f(p.b.ringBandDb, p.u.ringBandDb, 'dB')} @${p.u.ringHz}Hz`);
}

console.log('\nSHIMMER (upgraded render minus stock render, RNG pinned)');
for (const p of audio.pres) {
  console.log(`  ${p.weapon.padEnd(8)} added ${String(p.addedDb).padStart(7)} dB   at ${String(p.diffPeakHz).padStart(5)} Hz` +
              ` = partial ${p.partial} of ${p.ringHz} Hz (${p.partialErrPct}% off)`);
}

console.log('');
let failed = 0;
for (const c of checks) {
  if (!c.ok) failed++;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n      ${c.detail}`);
}

const errs = logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
if (errs.length) { console.log('\nPAGE ERRORS'); for (const e of errs.slice(0, 10)) console.log('  ' + e); }

console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
