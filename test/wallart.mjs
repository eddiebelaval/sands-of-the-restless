/**
 * IS THE BEETLE STILL READABLE, AND DID THE WALL GET ANY ART.
 *
 * THE ONE CLAIM THIS FILE EXISTS FOR. enemies/wallcrawl.js put a gold scarab on
 * the ceiling, so for the first time in this game the player looks UP during a
 * fight and tracks a moving target across a surface. That turns the ceiling
 * from decoration into a BACKGROUND, and decorating a background is a change
 * that can make the game worse while making the screenshot better. So the bar
 * for this lane is not "the ceiling looks nicer". It is:
 *
 *     A GOLD SCARAB'S CONTRAST AGAINST THE CEILING DID NOT GET WORSE.
 *
 * and if it did, that is a failure to report rather than a threshold to tune.
 *
 * HOW THE BEFORE AND THE AFTER ARE BOTH MEASURED IN ONE RUN. world/build.js
 * hangs the ceiling's previous material on `mesh.userData.priorMaterial` and
 * names every ceiling mesh, so this harness can swap the whole map's ceilings
 * between the painted soffit and the limestone they used to wear WITHOUT
 * reloading, rebuilding, or reconstructing anything. Same beetle, same pose,
 * same frozen light phase, same frame: the only variable in the comparison is
 * the material. A harness that measured the old build in one process and the
 * new one in another would be comparing two runs of a flickering brazier.
 *
 * HOW THE BEETLE IS SEGMENTED FROM ITS BACKGROUND, which is the part that makes
 * this a pixel measurement rather than an opinion. Four frames are taken at one
 * pose - {old ceiling, new ceiling} x {beetle visible, beetle hidden} - with
 * the simulation frozen so all four are the same frame of the same world. The
 * beetle's pixels are then exactly the pixels that differ between visible and
 * hidden, and the background BEHIND the beetle is those same pixels read out of
 * the hidden frame. No box drawn by eye, no colour key, no guess about where
 * the body is.
 *
 * That gives the number that actually matters: for every pixel of beetle, how
 * far is it from the thing directly behind it. Reported as a mean and as a 10th
 * percentile, because a body that is bright over most of its area and vanishes
 * along one edge is a body that is hard to track, and a mean hides that.
 *
 * THREE CONTROLS, and the first two are the ones that stop this passing for the
 * wrong reason:
 *
 *   1. THE FLOOR STRIP. A rectangle at the bottom of the frame that contains no
 *      ceiling at all. It must be pixel-identical between the two states. If it
 *      moves, the two frames differ by something other than the swap - a light
 *      phase, a bob, a dust mote - and every delta above it is noise.
 *
 *   2. THE ORDINARY SCARAB. The same measurement run on the variant that does
 *      NOT have `wallCrawl`, which therefore cannot be on the ceiling. If it
 *      reports a ceiling background too, the segmentation is picking up
 *      something that is not the ceiling and the whole file is measuring air.
 *
 *   3. THE UNREGISTERED WALL. For the wall lane, the same masonry painter run
 *      with `register: false` and swapped onto the same stone in the same
 *      frame, so "the register put a line in the wall" is a delta between two
 *      renders rather than a claim about a canvas.
 *
 * Serve the repo root with `python3 -m http.server 4177`, then `node
 * test/wallart.mjs`.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/wallart/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1500);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

/**
 * The scene census, at one fixed pose.
 *
 * `--census` runs ONLY this and exits, so the same script can be pointed at a
 * stashed tree and at the working tree and the two numbers compared. A draw
 * call count taken after this harness has spawned actors and swapped materials
 * is not the same measurement as one taken on a fresh interior, and a
 * before/after that mixes the two says whatever you want it to say.
 */
const census = () => page.evaluate(async () => {
  const g = window.__SANDS__;
  g.director.reset();
  g.spaces.enter('interior', { x: -45, z: -148, rot: 0 });
  g.rig.reset(0, 0.9);
  for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));

  g.renderer.info.autoReset = false;
  g.renderer.info.reset();
  await new Promise((r) => requestAnimationFrame(r));
  const render = { ...g.renderer.info.render };
  const memory = { ...g.renderer.info.memory };
  g.renderer.info.autoReset = true;

  const names = new Map();
  let meshes = 0;
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) if (m) names.set(m.uuid, m.name || m.type);
  });

  const interior = g.scene.getObjectByName('interior');
  let interiorMeshes = 0;
  const matUse = {};
  interior.traverse((o) => {
    if (!o.isMesh) return;
    interiorMeshes++;
    const n = o.material?.name || o.material?.type;
    matUse[n] = (matUse[n] || 0) + 1;
  });

  return { render, memory, uniqueMaterials: names.size, meshes, interiorMeshes, matUse };
});

if (process.argv.includes('--census')) {
  const c = await census();
  console.log(JSON.stringify(c, null, 2));
  await browser.close();
  process.exit(0);
}

const shot = async (name) => {
  const buf = await page.screenshot({ path: `${OUT}${name}.png` });
  return `data:image/png;base64,${buf.toString('base64')}`;
};

/**
 * The pixel arithmetic, run in the page because that is where a PNG can be
 * decoded back into samples without pulling an image library into this repo.
 */
await page.evaluate(() => {
  window.__PIX__ = {
    async load(dataUrl) {
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = dataUrl; });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      return { w: img.width, h: img.height, d: x.getImageData(0, 0, img.width, img.height).data };
    },
    lum(d, i) { return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; },
  };
});

/**
 * Everything the harness needs to hold a single frame absolutely still.
 *
 * `director.update` and the interior's `update` are the two calls main.js makes
 * that move anything in here: the first walks every actor, the second runs the
 * brazier flicker and the power ramp. Replacing both with a no-op is the whole
 * of the freeze, and it is reversible, which matters because this file takes
 * two poses in one page.
 */
await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__FREEZE__ = {
    saved: null,
    on() {
      if (this.saved) return;
      this.saved = {
        d: g.director.update, i: g.interior.update,
        p: g.post.update, v: g.viewmodel.update,
      };
      g.director.update = () => {};
      g.interior.update = () => {};
      /**
       * THE POST CHAIN IS PART OF THE FREEZE, and leaving it out is what put a
       * noise floor of 2.4 luminance under every figure in this file.
       *
       * core/post.js's GradePass adds film grain from a per-pixel hash of
       * `uTime`, and `post.update(dt)` is what advances it. With the world
       * frozen and the grain still running, two screenshots of an unchanged
       * scene differ everywhere - which is not a bug in the game, it is the
       * grain doing exactly its job, and it means every delta measured here
       * arrives with 2.4 of sand on it.
       *
       * The viewmodel goes too. The player's hands sway on their own clock and
       * they are the only other thing in the frame that moves while paused.
       */
      g.post.update = () => {};
      g.viewmodel.update = () => {};
    },
    off() {
      if (!this.saved) return;
      g.director.update = this.saved.d;
      g.interior.update = this.saved.i;
      g.post.update = this.saved.p;
      g.viewmodel.update = this.saved.v;
      this.saved = null;
    },
  };
});

// ===========================================================================
// PART ONE: THE CEILING, AND THE BEETLE ON IT
// ===========================================================================

/**
 * Put a crawler on the ceiling and stop the world.
 *
 * The Hall of Offerings for the same reasons test/wallcrawl.mjs picks it: base
 * 0, a 9 m ceiling, and a north wall with no doorway in it, so the box the
 * crawler mounts runs floor to ceiling and its top is a real ceiling rather
 * than the breast under a sill.
 */
const stage = async (variant) => page.evaluate(async (id) => {
  const g = window.__SANDS__;
  window.__FREEZE__.off();

  /**
   * THE PLAYER STANDS IN THE MIDDLE OF THE ROOM, and that is a measurement
   * decision rather than a staging one.
   *
   * A first cut pinned them at (-45, -144), four metres off the north wall.
   * The crawler duly reached the ceiling and stopped a metre and a half from
   * that wall, so the camera looking up at it framed a diagonal: ceiling in one
   * corner, wall in the other, and the body sitting on the join. Every figure
   * that came out of it was a blend of two surfaces, one of which this lane did
   * not touch - which is how the "background" luminance came back at 32 while
   * the ceiling around it measured 12.
   *
   * (-45, -148) is eight metres off the north wall, ten off the south and
   * eleven off the west. The crawl's last leg takes the body to a point OVER
   * the player before it drops, so waiting for it to get overhead puts nothing
   * but ceiling in the frame.
   */
  const PLAYER = { x: -45, z: -148 };
  g.director.reset();
  g.spaces.enter('interior', { x: PLAYER.x, z: PLAYER.z, rot: 0 });
  for (const d of g.doors.all) {
    if (d.open) d.open();
    for (let i = 0; i < 400 && !d.opened; i++) if (d.advance) d.advance(1 / 30);
  }
  await new Promise((r) => requestAnimationFrame(r));
  g.director.state.timer = 1e9;

  g.player.position.x = PLAYER.x;
  g.player.position.z = PLAYER.z;

  const actor = g.director.placeAt(id, -34, -149);
  if (!actor) return { fatal: `could not place a ${id}` };

  // Step the simulation by hand until the body is settled on a ceiling AND
  // overhead, or until the budget runs out - which is the expected outcome for
  // the control, which has no ceiling behaviour at all.
  const dt = 1 / 60;
  let clock = 0, reached = false, overhead = false;
  for (let i = 0; i < 90 * 60; i++) {
    clock += dt;
    g.player.position.x = PLAYER.x;
    g.player.position.z = PLAYER.z;
    /**
     * INVULNERABLE WHILE STAGING, and this line is here because leaving it out
     * silently destroyed a whole section of this file.
     *
     * The player is PINNED for the staging loop, so they cannot back off and
     * the approaching body bites them at 14 a time until they are dead. The
     * ceiling measurement survived that - the gold scarab leaves the floor
     * before it has done enough damage - but the ordinary scarab in the control
     * run has ninety seconds and nothing else to do, and it killed them. The
     * next pose in the file then photographed the death screen and reported the
     * word UNWORTHY as the wall's horizontal structure.
     */
    g.player.state.health = g.player.state.maxHealth;
    g.director.update(dt, clock);
    if (!actor.live) break;
    const c = actor.crawl;
    if (!c || c.transit > 0 || c.surf !== 2) continue;
    reached = true;
    const p = actor.position;
    if (Math.hypot(p.x - PLAYER.x, p.z - PLAYER.z) < 3.4) { overhead = true; break; }
  }

  window.__FREEZE__.on();
  window.__ACTOR__ = actor;

  // Aim the camera along the eye-to-body line. Two frames first, so the rig has
  // put the camera at the player's eye before the angle is computed off it.
  await new Promise((r) => requestAnimationFrame(r));
  const eye = g.camera.position.clone();
  const p = actor.position;
  const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  g.rig.reset(Math.atan2(-dx / len, -dz / len), Math.asin(dy / len));
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));

  // Where the body lands on screen, so the measurement window is placed by
  // projection rather than by eye.
  const v = new g.THREE.Vector3(p.x, p.y, p.z).project(g.camera);
  const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;

  return {
    id, reached, overhead,
    surf: actor.crawl ? actor.crawl.surf : null,
    at: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
    aboveFloor: +(p.y - (g.director.ctx.heightAt ? g.director.ctx.heightAt(p.x, p.z, 0) : 0)).toFixed(2),
    screen: { x: Math.round(sx), y: Math.round(sy) },
    seconds: +clock.toFixed(1),
  };
}, variant);

/** Swap every ceiling in the map between the painted soffit and the old stone. */
const setCeiling = async (mode) => page.evaluate((m) => {
  const g = window.__SANDS__;
  let n = 0;
  const names = new Set();
  g.scene.traverse((o) => {
    if (!o.isMesh || !o.userData.ceiling) return;
    if (m === 'before') {
      if (!o.userData.newMaterial) o.userData.newMaterial = o.material;
      o.material = o.userData.priorMaterial;
    } else if (o.userData.newMaterial) {
      o.material = o.userData.newMaterial;
    }
    names.add(o.material.name);
    n++;
  });
  return { n, materials: [...names] };
}, mode);

const setActorVisible = async (v) => page.evaluate((vis) => {
  window.__ACTOR__.group.visible = vis;
}, v);

const settle = async () => { await page.waitForTimeout(140); };

/**
 * Four frames, two states, one pose. Returns the legibility figures.
 *
 * `win` is the half-width of the measurement window around the projected body.
 * 150 px on a 900x620 frame is a generous margin round a body that covers
 * roughly 60, which is what makes the "around" background figure meaningful.
 */
const measurePose = async (label, screen, win = 150) => {
  const frames = {};
  for (const state of ['after', 'before']) {
    await setCeiling(state);
    await settle();
    await setActorVisible(true);
    await settle();
    frames[`${state}On`] = await shot(`${label}-${state}-beetle`);
    await setActorVisible(false);
    await settle();
    frames[`${state}Off`] = await shot(`${label}-${state}-empty`);
    await setActorVisible(true);
  }

  /**
   * THE NOISE FLOOR, TAKEN IN THE SAME RUN.
   *
   * Two frames of the SAME state with nothing changed between them. Everything
   * this harness reports is a difference between two screenshots, and a
   * difference is meaningless until you know what two screenshots of an
   * unchanged scene differ by. This scene is not still even when frozen - the
   * post chain has a grain, the composer resolves an accumulating buffer, and
   * the viewmodel sways on its own clock - so the answer is not zero and
   * pretending it is zero is how a harness certifies noise as a result.
   *
   * A first cut used a fixed strip at the bottom of the frame as the control
   * and it FAILED at 6.19, which looked like a broken freeze. It was not: that
   * strip had the player's hands in it. The control was measuring the one thing
   * in the frame that was still animating.
   */
  await setCeiling('after');
  await settle();
  await setActorVisible(false);
  await settle();
  frames.afterOff2 = await shot(`${label}-after-empty-2`);
  await setActorVisible(true);

  return page.evaluate(async ({ f, screen, win }) => {
    const P = window.__PIX__;
    const A = { on: await P.load(f.afterOn), off: await P.load(f.afterOff) };
    const B = { on: await P.load(f.beforeOn), off: await P.load(f.beforeOff) };
    const A2 = await P.load(f.afterOff2);
    const { w, h } = A.on;

    const x0 = Math.max(0, screen.x - win), x1 = Math.min(w, screen.x + win);
    const y0 = Math.max(0, screen.y - win), y1 = Math.min(h, screen.y + win);

    /**
     * ONE MASK, THE UNION OF THE TWO STATES, USED FOR BOTH.
     *
     * The body is in the identical place in all four frames, so one mask is
     * correct for both, and using ONE is what makes the two measurements
     * comparable: a mask derived per state would grow and shrink with the very
     * contrast it is being used to measure, which flatters whichever state
     * happens to segment more easily.
     *
     * THE UNION RATHER THAN EITHER ONE ALONE, and that is not a detail. A mask
     * taken from the old state alone contains only the pixels where the body
     * ALREADY stood out against the old ceiling - it silently drops the places
     * the old ceiling was already hiding it, which is to say it drops exactly
     * the evidence that would count against the old ceiling. Taken from the new
     * state alone it does the same favour to the new one. The union is every
     * pixel the body covers in either, which is the body.
     */
    const mask = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        const db = Math.abs(B.on.d[i] - B.off.d[i])
          + Math.abs(B.on.d[i + 1] - B.off.d[i + 1])
          + Math.abs(B.on.d[i + 2] - B.off.d[i + 2]);
        const da = Math.abs(A.on.d[i] - A.off.d[i])
          + Math.abs(A.on.d[i + 1] - A.off.d[i + 1])
          + Math.abs(A.on.d[i + 2] - A.off.d[i + 2]);
        if (db > 18 || da > 18) mask.push(i);
      }
    }

    const stats = (S) => {
      if (!mask.length) return null;
      let body = 0, behind = 0;
      const per = [], bodyL = [], behindL = [];
      for (const i of mask) {
        const lb = P.lum(S.on.d, i);
        const lg = P.lum(S.off.d, i);
        body += lb; behind += lg;
        bodyL.push(lb); behindL.push(lg);
        per.push(Math.abs(lb - lg));
      }
      per.sort((a, b) => a - b);
      bodyL.sort((a, b) => a - b);
      behindL.sort((a, b) => a - b);
      const pc = (arr, p) => +arr[Math.floor(arr.length * p)].toFixed(1);
      // The background AROUND the body, out of the empty frame, over the window
      // minus the mask. This is what the eye is actually comparing the body to
      // while tracking it.
      const inMask = new Set(mask);
      let around = 0, an = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          if (inMask.has(i)) continue;
          around += P.lum(S.off.d, i); an++;
        }
      }
      const Lb = body / mask.length, Lg = behind / mask.length, La = around / an;
      return {
        pixels: mask.length,
        bodyLum: +Lb.toFixed(1),
        behindLum: +Lg.toFixed(1),
        aroundLum: +La.toFixed(1),
        // Michelson, the standard form for a target on a background.
        michelson: +(Math.abs(Lb - Lg) / Math.max(1, Lb + Lg)).toFixed(4),
        meanDelta: +(per.reduce((s, v) => s + v, 0) / per.length).toFixed(1),
        p10Delta: +per[Math.floor(per.length * 0.10)].toFixed(1),
        p50Delta: +per[Math.floor(per.length * 0.50)].toFixed(1),
        // How much of the body is within 12 luminance of what is behind it -
        // the fraction that is, locally, invisible.
        lostPct: +((per.filter((v) => v < 12).length / per.length) * 100).toFixed(1),
        // The two DISTRIBUTIONS, which is what the design decision is actually
        // made against. A background is only a good background if it sits
        // clear of the whole of the body's range, not clear of its mean: a
        // gold scarab is a bright shell on dark legs over a dark abdomen, so
        // its own pixels span most of the scale and a background that lands in
        // the middle of that span hides some of it whichever way it moves.
        bodyP10: pc(bodyL, 0.10), bodyP50: pc(bodyL, 0.50), bodyP90: pc(bodyL, 0.90),
        bgP10: pc(behindL, 0.10), bgP50: pc(behindL, 0.50), bgP90: pc(behindL, 0.90),
      };
    };

    // CONTROL: the noise floor against the cross-state move, over the same
    // window the legibility figures come from.
    let noise = 0, ceilMove = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        noise += Math.abs(P.lum(A.off.d, i) - P.lum(A2.d, i));
        ceilMove += Math.abs(P.lum(A.off.d, i) - P.lum(B.off.d, i));
        n++;
      }
    }

    return {
      window: { x0, x1, y0, y1 },
      after: stats(A),
      before: stats(B),
      noiseFloor: +(noise / Math.max(1, n)).toFixed(3),
      ceilingWindowMove: +(ceilMove / Math.max(1, n)).toFixed(2),
    };
  }, { f: frames, screen, win });
};

// --------------------------------------------------------------------- gold
const gold = await stage('goldscarab');
if (gold.fatal) { console.log(`FATAL ${gold.fatal}`); await browser.close(); process.exit(1); }

console.log('');
console.log('THE POSE');
console.log(`  gold scarab reached surface ${gold.surf} (2 = ceiling) after ${gold.seconds} s`
  + `, overhead: ${gold.overhead}`);
console.log(`  body at ${gold.at.x}, ${gold.at.y}, ${gold.at.z}  -  ${gold.aboveFloor} m above its own floor`);
console.log(`  projects to screen ${gold.screen.x}, ${gold.screen.y}`);

ok(gold.reached && gold.surf === 2, 'the beetle is genuinely on a ceiling, not near one');

const ceilStates = await setCeiling('after');
console.log(`  ${ceilStates.n} ceiling meshes, materials: ${ceilStates.materials.join(', ')}`);

const G = await measurePose('ceiling', gold.screen);

console.log('');
console.log('THE BEETLE AGAINST THE CEILING, measured on the pixels it covers');
console.log('  state    px    body   behind  around   Michelson   meanDL   p50DL   p10DL   lost%');
for (const [k, s] of [['BEFORE', G.before], ['AFTER ', G.after]]) {
  if (!s) { console.log(`  ${k}   no pixels`); continue; }
  console.log(`  ${k}  ${String(s.pixels).padStart(5)}  ${String(s.bodyLum).padStart(6)}  `
    + `${String(s.behindLum).padStart(6)}  ${String(s.aroundLum).padStart(6)}   `
    + `${String(s.michelson).padStart(9)}   ${String(s.meanDelta).padStart(6)}  `
    + `${String(s.p50Delta).padStart(6)}  ${String(s.p10Delta).padStart(6)}  ${String(s.lostPct).padStart(5)}`);
}

console.log('');
console.log('  the two distributions, luminance percentiles over the same pixels');
console.log('  state    body p10/p50/p90        background p10/p50/p90');
for (const [k, s] of [['BEFORE', G.before], ['AFTER ', G.after]]) {
  if (!s) continue;
  console.log(`  ${k}  ${String(s.bodyP10).padStart(6)} ${String(s.bodyP50).padStart(6)} ${String(s.bodyP90).padStart(6)}`
    + `        ${String(s.bgP10).padStart(6)} ${String(s.bgP50).padStart(6)} ${String(s.bgP90).padStart(6)}`);
}

console.log('');
console.log('  CONTROLS');
console.log(`  noise floor, two frames of the SAME state   ${G.noiseFloor}`);
console.log(`  the move between the two states            ${G.ceilingWindowMove}`);

ok(G.before && G.after, 'the beetle was segmented in both states');

if (G.before && G.after) {
  // THE BAR. Not "it improved" - the owner's requirement is that decoration did
  // not cost legibility, so the test is >=, and any regression is reported as a
  // regression rather than absorbed by a tolerance.
  ok(G.after.michelson >= G.before.michelson,
    `CONTRAST DID NOT GET WORSE: Michelson ${G.before.michelson} -> ${G.after.michelson}`);
  ok(G.after.meanDelta >= G.before.meanDelta,
    `mean body-to-background separation did not get worse (${G.before.meanDelta} -> ${G.after.meanDelta})`);
  ok(G.after.p10Delta >= G.before.p10Delta,
    `and the WORST TENTH of the body did not get worse (p10 ${G.before.p10Delta} -> ${G.after.p10Delta})`);
  ok(G.after.lostPct <= G.before.lostPct,
    `no more of the body vanishes into the background (${G.before.lostPct}% -> ${G.after.lostPct}%)`);
}

ok(G.ceilingWindowMove > G.noiseFloor * 8,
  `CONTROL: the swap moved the frame far past the noise floor (${G.noiseFloor} -> ${G.ceilingWindowMove})`);

// ------------------------------------------------------- the ordinary scarab
//
// CONTROL 2. This variant has no `wallCrawl`, so it cannot be on a ceiling. If
// the staging above reports it on surface 2, the harness is not measuring what
// it says it is.
const plain = await stage('scarab');
console.log('');
console.log(`  CONTROL: the ordinary scarab reached surface ${plain.surf === null ? 'none' : plain.surf}`
  + ` and got ${plain.aboveFloor} m off the floor`);
ok(!plain.reached && plain.aboveFloor < 0.6,
  `CONTROL: the variant without wallCrawl never gets on the ceiling (${plain.aboveFloor} m up)`);

// ===========================================================================
// PART TWO: THE WALL
// ===========================================================================
//
// The register is a change to the PROCEDURAL masonry, and the A/B swaps the
// same painter's two outputs onto the same stone in the same frame. See the
// report on this lane for the reason a shipped build does not show it.

const wall = await page.evaluate(async () => {
  const g = window.__SANDS__;
  window.__FREEZE__.off();
  g.director.reset();
  // The Great Gallery's west colonnade, read from four metres - which is where
  // a player fighting in this room actually stands relative to it.
  g.spaces.enter('interior', { x: -19.5, z: -184, rot: 0 });
  await new Promise((r) => requestAnimationFrame(r));
  g.director.state.timer = 1e9;
  g.player.position.x = -19.5;
  g.player.position.z = -184;
  g.player.state.health = g.player.state.maxHealth;
  g.rig.reset(Math.PI / 2, 0.22);
  await new Promise((r) => requestAnimationFrame(r));
  window.__FREEZE__.on();
  await new Promise((r) => requestAnimationFrame(r));

  const T = await import(new URL('../src/world/textures.js', location.href).href);
  const THREE = g.THREE;

  const wrap = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 1);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };

  // The two variants of the same painter, same seed, same row count. The only
  // difference between them is the register band.
  const noReg = T._internals.paintMasonry(512, { rows: 5, seed: 11, hieroglyphs: true });
  const withReg = T._internals.paintMasonry(512, { rows: 5, seed: 11, hieroglyphs: true, register: true });

  const sets = {
    plain: { map: wrap(noReg, true), normalMap: wrap(T._internals.normalFromCanvas(noReg, 3.6), false) },
    register: { map: wrap(withReg, true), normalMap: wrap(T._internals.normalFromCanvas(withReg, 3.6), false) },
  };

  // Every `carved` instance in the scene, including the per-elevation
  // weathering variants, so the swap covers whatever this pose is looking at.
  const carved = [];
  g.scene.traverse((o) => {
    if (!o.isMesh || !o.material || !/^carved/.test(o.material.name || '')) return;
    if (!carved.includes(o.material)) carved.push(o.material);
  });

  window.__WALLSWAP__ = (which) => {
    for (const m of carved) {
      if (!m.userData.origMap) { m.userData.origMap = m.map; m.userData.origNorm = m.normalMap; }
      if (which === 'ship') { m.map = m.userData.origMap; m.normalMap = m.userData.origNorm; }
      else { m.map = sets[which].map; m.normalMap = sets[which].normalMap; }
      m.needsUpdate = true;
    }
  };

  return { carvedMaterials: carved.map((m) => m.name) };
});

console.log('');
console.log(`THE WALL: ${wall.carvedMaterials.length} carved material instances (${wall.carvedMaterials.join(', ')})`);

const wallFrames = {};
for (const which of ['ship', 'plain', 'register']) {
  await page.evaluate((w) => window.__WALLSWAP__(w), which);
  await settle();
  wallFrames[which] = await shot(`wall-${which}`);
}
await page.evaluate(() => window.__WALLSWAP__('ship'));

const W = await page.evaluate(async (f) => {
  const P = window.__PIX__;
  const out = {};
  const imgs = {};
  for (const k of Object.keys(f)) imgs[k] = await P.load(f[k]);

  // The column fills the middle of the frame at this pose. Measured on the
  // centre band rather than the whole frame so the floor, the ceiling and the
  // far wall do not dilute the figure.
  // The column itself, not the wall behind it. Measured off the frame rather
  // than guessed: the shaft spans roughly 38 to 56 per cent of the width at
  // this pose, and including the masonry behind it dilutes every figure with
  // pixels the swap does not touch.
  const { w, h } = imgs.ship;
  const x0 = Math.round(w * 0.38), x1 = Math.round(w * 0.56);
  const y0 = Math.round(h * 0.10), y1 = Math.round(h * 0.62);

  for (const [k, S] of Object.entries(imgs)) {
    const rows = [];
    let sum = 0, sum2 = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      let rs = 0, rn = 0;
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        const l = P.lum(S.d, i);
        sum += l; sum2 += l * l; n++;
        rs += l; rn++;
      }
      rows.push(rs / rn);
    }
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    const rMean = rows.reduce((a, b) => a + b, 0) / rows.length;
    const rSd = Math.sqrt(rows.reduce((a, b) => a + (b - rMean) ** 2, 0) / rows.length);
    // The strongest single row-to-row step: a register band is a horizontal
    // discontinuity, and this is the number that a horizontal discontinuity
    // moves and that isotropic pitting does not.
    let step = 0;
    for (let i = 1; i < rows.length; i++) step = Math.max(step, Math.abs(rows[i] - rows[i - 1]));
    out[k] = {
      mean: +mean.toFixed(1),
      sd: +sd.toFixed(2),
      rowSd: +rSd.toFixed(3),
      maxRowStep: +step.toFixed(3),
    };
  }

  /**
   * WHERE the register changed the column, row by row.
   *
   * A first cut asserted that the register RAISED the variance of the row
   * means, and it did not - it lowered it, 8.86 to 7.60, and the check failed
   * on a change that had plainly worked when the frame was looked at. The
   * metric was wrong rather than the art: an unregistered ashlar column already
   * has five courses of strong horizontal banding across this tile, so row
   * variance was already high, and dropping a flat register into one of those
   * courses REPLACES banded pixels with even ones.
   *
   * What "a band appeared" actually means is that the change is CONCENTRATED IN
   * A FEW ROWS. So: the per-row mean absolute difference between the two
   * variants, and the ratio of its peak to its median. Uniform noise across the
   * whole column gives a ratio near 1; a register gives a spike.
   */
  const rowDelta = [];
  for (let y = y0; y < y1; y++) {
    let s = 0, n = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      s += Math.abs(P.lum(imgs.register.d, i) - P.lum(imgs.plain.d, i)); n++;
    }
    rowDelta.push(s / n);
  }
  const sorted = rowDelta.slice().sort((a, b) => a - b);
  out.registerVsPlainMeanAbsDelta =
    +(rowDelta.reduce((a, b) => a + b, 0) / rowDelta.length).toFixed(2);
  out.bandPeakRowDelta = +Math.max(...rowDelta).toFixed(2);
  out.bandMedianRowDelta = +sorted[Math.floor(sorted.length / 2)].toFixed(2);
  // How tall the changed region is, as a fraction of the column in frame. A
  // register is a band; a retint is the whole shaft. Reported as two numbers
  // rather than a ratio: the median row delta came out at exactly 0 - more than
  // half the column is PIXEL-IDENTICAL between the two variants - and a
  // peak-over-median ratio against that is a division by nothing, which prints
  // an impressive number that means only "the denominator was zero".
  out.bandChangedRowsPct =
    +((rowDelta.filter((v) => v > 0.5).length / rowDelta.length) * 100).toFixed(1);
  out.bandRowsAboveHalfPeak =
    +((rowDelta.filter((v) => v > out.bandPeakRowDelta * 0.5).length / rowDelta.length) * 100).toFixed(1);
  return out;
}, wallFrames);

console.log('  the carved column, centre band of the frame:');
console.log('  variant     mean     sd    rowSd   maxRowStep');
for (const k of ['ship', 'plain', 'register']) {
  const s = W[k];
  console.log(`  ${k.padEnd(10)}${String(s.mean).padStart(6)}  ${String(s.sd).padStart(6)}  `
    + `${String(s.rowSd).padStart(6)}  ${String(s.maxRowStep).padStart(10)}`);
}
console.log(`  register vs plain: mean row |dL| ${W.registerVsPlainMeanAbsDelta}`
  + `, peak row ${W.bandPeakRowDelta}, median row ${W.bandMedianRowDelta}`
  + `, ${W.bandChangedRowsPct}% of rows changed at all`
  + `, ${W.bandRowsAboveHalfPeak}% above half peak`);

ok(W.registerVsPlainMeanAbsDelta > 1.0,
  `the register reaches the frame (mean row |dL| ${W.registerVsPlainMeanAbsDelta} against the same painter without it)`);
ok(W.bandChangedRowsPct > 3 && W.bandChangedRowsPct < 45,
  `and the change is a BAND: ${W.bandChangedRowsPct}% of rows moved and the rest are pixel-identical`);
ok(W.bandRowsAboveHalfPeak < 45,
  `CONTROL: it is confined to part of the shaft, not a retint of all of it (${W.bandRowsAboveHalfPeak}% of rows)`);

// ===========================================================================
// PART THREE: THE COST
// ===========================================================================

await page.evaluate(() => window.__FREEZE__.off());
const cost = await census();

console.log('');
console.log('THE COST, at the Hall of Offerings pose looking up');
console.log('  (run with --census on a stashed tree for the matching before)');
console.log(`  draw calls           ${cost.render.calls}`);
console.log(`  triangles            ${cost.render.triangles}`);
console.log(`  scene meshes         ${cost.meshes}   (interior ${cost.interiorMeshes})`);
console.log(`  unique materials     ${cost.uniqueMaterials}`);
console.log(`  GPU textures         ${cost.memory.textures}`);
console.log(`  interior material use ${JSON.stringify(cost.matUse)}`);

writeFileSync(`${OUT}measurements.json`,
  JSON.stringify({ gold, plain, ceiling: G, wall: W, cost }, null, 2));
console.log(`\n  shots and measurements -> ${OUT}`);

ok(errors.length === 0, 'no console errors');
if (errors.length) for (const e of errors.slice(0, 6)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
