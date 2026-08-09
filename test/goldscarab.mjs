/**
 * IS THE GOLD SCARAB GOLD WHERE THE PLAYER ACTUALLY FIGHTS IT.
 *
 * The owner, playing: "they're not golden. I think they might have... I think I
 * may have seen them, and they were black with blue eyes. They need to be gold.
 * Shining shimmering gold."
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A PIXEL HARNESS AND NOT A PALETTE ASSERTION
 * ---------------------------------------------------------------------------
 *
 * The palette in variants.js says `accent: 0xe8bf55`, which is gold, and the
 * material in mummy.js reads it, so every check that could be written against
 * the code passes today while the beetle on the screen is black. The colour a
 * MeshStandardMaterial ends up rendering at metalness 0.90 is not its albedo,
 * it is the albedo times what the environment has to offer, and the environment
 * indoors is `INTERIOR_ENV = 0.05` in systems/spaces.js. So the only honest
 * instrument is the frame buffer.
 *
 * ---------------------------------------------------------------------------
 * THE SILHOUETTE MASK: MEASURING THE BEETLE AND NOT THE ROOM
 * ---------------------------------------------------------------------------
 *
 * "The gold scarab is dark" and "the room is dark" produce the same number if
 * you average a rectangle. So every measurement here is taken twice on the same
 * clip - once with the body visible, once with `group.visible = false` - and
 * the pixels that CHANGED are the body. Everything reported is computed over
 * that mask, and the pixels outside it are reported separately as the
 * background the body is read against.
 *
 * The frame is frozen before either shutter: `world.update`, `director.update`,
 * `post.update` and the viewmodel are all held, because the interior's braziers
 * flicker on a sine and a light that moved between the two shots would light up
 * half the wall as "the beetle". The harness proves the freeze held rather than
 * assuming it: `noisePx` is the count of changed pixels OUTSIDE the body's own
 * bounding box, and it is printed on every row.
 *
 * ---------------------------------------------------------------------------
 * FOUR CONTROLS, BECAUSE "IT IS GOLD NOW" IS TOO EASY TO SATISFY
 * ---------------------------------------------------------------------------
 *
 *   1. THE ORDINARY SCARAB, same room, same range, same clip. It is the same
 *      body with a brown shell. If the gold scarab is not measurably brighter
 *      and more saturated than it, the gold is not doing anything - and a build
 *      where somebody turned the room lights up would fail this while passing
 *      any absolute threshold.
 *   2. THE COURTYARD. The same gold scarab outdoors, where the owner agrees it
 *      already reads. It proves the instrument is pointed at a beetle and not
 *      at a wall, and it is the ceiling the interior number is compared to.
 *   3. THE BACKGROUND. The unmasked pixels of the same frame. A body has to be
 *      SEPARATED from the stone behind it; a fix that lifts the beetle onto the
 *      wall's own value is a different way to be invisible, and the EMISSIVE
 *      FLOOR note in mummy.js already rejected 0.11 for exactly that.
 *   4. THE BOUND, which carries the same `accentMetal` band on TRIM rather than
 *      on a carapace. It is the body the original "accent is metal that already
 *      catches a highlight" reasoning was true for, and it must not regress.
 *
 * ---------------------------------------------------------------------------
 * NO STOPWATCHES
 * ---------------------------------------------------------------------------
 *
 * A frame under swiftshader here costs well over a second, so nothing waits on
 * a timer. Every wait is on state: `__SANDS__.frameNo` advancing for a rendered
 * frame, `spaces.transition.veil` falling for a room change. This project has
 * shipped the stopwatch bug six times.
 *
 * Modes:
 *   node test/goldscarab.mjs [url]            assert
 *   node test/goldscarab.mjs [url] --sweep    print the candidate table, no asserts
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS, dismissBriefing } from './chrome.mjs';

const args = process.argv.slice(2);
const SWEEP = args.includes('--sweep');
const BASE = args.find((a) => a.startsWith('http'))
  || process.env.SANDS_URL || 'http://127.0.0.1:4191/index.html';

/**
 * Where the player is standing when the fight happens, per space.
 *
 * The exterior is deliberately NOT teleported. `start()` leaves the player
 * exactly where the game begins, which is the courtyard the owner is describing
 * when he says the beetle is gold out there; picking a coordinate for it would
 * be inventing a second opinion about what the control is.
 */
const PLACES = {
  // The Hall of Offerings, 38 x 18 with a 9 m ceiling, base 0. The room
  // test/wallcrawl.mjs already fights in.
  interior: { x: -45, z: -144, rot: 0 },
  exterior: null,
};

/** Metres in front of the camera. Six is inside a gold scarab's charge. */
const RANGE = 6.0;
const CLIP = 320;

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start());
// The boot contract. `start()` finishes the card itself, but calling this is
// what makes the file correct against a build where that seam moves.
await dismissBriefing(page);
await page.waitForFunction(() => window.__SANDS__.frameNo > 4, null, { timeout: 120000 });

/**
 * Hold everything cosmetic that would make two shots of one pose differ.
 *
 * THE GOVERNOR IS THE ONE THAT MATTERS AND IT COST A WHOLE SWEEP TO FIND. It
 * watches the rolling median frame time and drops GTAO, then shadow resolution,
 * then bloom, then SMAA, then the pixel ratio. Under swiftshader every frame is
 * a catastrophe by its standards, so it walks down the ladder DURING a run: one
 * row of the first sweep came back with 81,611 changed pixels out of 102,400
 * because a rung fell between the two shutters and the whole image moved. The
 * seam for this already exists and is the honest one - `force()` is the rung
 * pin core/governor.js publishes for exactly this, and `yieldToPlayer()` is
 * what ui/pause.js calls when a player picks a fidelity by hand, after which
 * the governor stands down for the session.
 *
 * RUNG 6, `low`, and it is the bottom of the ladder on purpose. Rung 5 could
 * not finish a single screenshot inside three minutes on this machine, which is
 * the honest reading of what swiftshader is: rung 6 is where the unpinned
 * governor walks itself to anyway, and pinning there is the difference between
 * a harness that runs and one that times out.
 *
 * IT DOES NOT MOVE THE THING BEING MEASURED, and that was checked rather than
 * assumed. The fidelity switch reaches enemy actors through
 * `director.setFidelity`, which reaches `actor.setFidelity`, whose entire body
 * is `for (const m of rig.meshes) m.castShadow = high`. Not one property of the
 * accent material is on that path. The rung changes shadows, post passes and
 * pixel scale; it is a constant across every row below, and the numbers are
 * comparable to each other rather than to a different machine.
 */
await page.evaluate(() => {
  const g = window.__SANDS__;
  g.governor.force(6);
  g.governor.yieldToPlayer();
  g.viewmodel.update = () => {};
  if (g.viewmodel.group) g.viewmodel.group.visible = false;
  g.post.update = () => {};
  const hud = document.getElementById('hud');
  if (hud) hud.style.opacity = '0';
});

/** Wait for N more RENDERED frames. State, never a timer. */
async function frames(n = 2) {
  const from = await page.evaluate(() => window.__SANDS__.frameNo);
  await page.waitForFunction((f) => window.__SANDS__.frameNo >= f, from + n, { timeout: 420000 });
}

/**
 * Move into a space and wait for the curtain to actually be down.
 *
 * enter() slams the curtain to 1 and reveals over SIMULATED seconds, so the
 * only correct wait is on `spaces.transition.veil` reaching zero. A timer here
 * would photograph a black rectangle and report that the beetle is black, which
 * is the exact defect under investigation.
 */
async function enterSpace(name) {
  const at = PLACES[name];
  await page.evaluate(({ name, at }) => {
    const g = window.__SANDS__;
    g.director.reset();
    if (g.spaces.active !== name) g.spaces.enter(name, at || undefined);
    if (at) {
      g.player.position.x = at.x;
      g.player.position.z = at.z;
    }
    // No wave may start under the shot.
    g.director.state.timer = 1e9;
  }, { name, at });

  await page.waitForFunction(
    (n) => {
      const g = window.__SANDS__;
      return g.spaces.active === n && g.spaces.transition.veil <= 0.01;
    },
    name,
    { timeout: 240000 }
  );
  return page.evaluate(() => ({
    active: window.__SANDS__.spaces.active,
    veil: +window.__SANDS__.spaces.transition.veil.toFixed(3),
    env: +window.__SANDS__.scene.environmentIntensity.toFixed(4),
  }));
}

/**
 * Stand one actor a fixed distance in front of the live camera and freeze the
 * world around it.
 *
 * The freeze is the reason two shutters of one pose are comparable at all, and
 * it is taken AFTER the actor is pinned so the pin is the last thing that moved.
 */
async function stage(variant) {
  return page.evaluate(({ variant, range }) => {
    const g = window.__SANDS__;

    // Clear the field so nothing else wanders into the clip.
    for (const a of (g.director.live || [])) {
      if (a && a.live) { try { a.hurt(1e9, 'body', 0, 0); } catch {} }
    }

    const cam = g.camera;
    const dir = new g.THREE.Vector3();
    cam.getWorldDirection(dir);
    dir.y = 0; dir.normalize();

    const x = cam.position.x + dir.x * range;
    const z = cam.position.z + dir.z * range;

    const actor = g.director.placeAt(variant, x, z);
    if (!actor) return { ok: false, why: `placeAt(${variant}) returned null` };

    /**
     * TICK THE DIRECTOR BEFORE FREEZING IT, AND THIS IS NOT A COURTESY.
     *
     * The first cut froze the world the instant the body was placed, and it
     * would have reported the fix doing NOTHING while the fix was in the build.
     * `chamberGlow` in mummy.js writes the accent's emissive intensity once per
     * frame from `update()`, because which room a body is standing in is a
     * property of this frame and not of its spawn. Freeze `director.update` and
     * that write never happens: a freshly placed actor is still wearing the
     * zero it was constructed with, and a harness photographing it is
     * photographing a material the running game never shows anybody.
     *
     * Three simulated steps, then the pin, then the freeze - so the last thing
     * to touch the body is this function and the last thing to touch the
     * material is the game.
     */
    for (let i = 0; i < 3; i++) g.director.update(1 / 60, i / 60);
    if (!actor.live) return { ok: false, why: `${variant} did not survive staging` };

    actor.position.x = x;
    actor.position.z = z;
    if (actor.group) actor.group.rotation.y = Math.atan2(-dir.x, -dir.z);

    // FREEZE. Held on the handle rather than on a flag so nothing in the game
    // has to know it is being photographed.
    if (!g.__goldHold) {
      g.__goldHold = { world: g.spaces.world.update, director: g.director.update };
      g.spaces.world.update = () => {};
      g.director.update = () => {};
    }

    window.__goldActor = actor;

    const acc = actor.materials && actor.materials.accent;
    const p = new g.THREE.Vector3(actor.position.x, actor.position.y, actor.position.z);
    p.project(cam);
    return {
      ok: true,
      sx: (p.x * 0.5 + 0.5) * window.innerWidth,
      sy: (-p.y * 0.5 + 0.5) * window.innerHeight,
      atX: +x.toFixed(2), atZ: +z.toFixed(2),
      y: +actor.position.y.toFixed(2),
      // WHAT THE MATERIAL IS ACTUALLY WEARING when the shutter opens. This is
      // the armed/not-armed reading: a gold row that looks good with `glow` at
      // zero is a row measuring something other than the fix.
      accent: acc ? {
        metal: acc.metalness,
        rough: acc.roughness,
        emissive: '0x' + acc.emissive.getHexString(),
        glow: acc.emissiveIntensity,
      } : null,
      walls: !!(g.spaces.world.walls && g.spaces.world.walls.length),
    };
  }, { variant, range: RANGE });
}

/** Hand the world back. */
async function unfreeze() {
  await page.evaluate(() => {
    const g = window.__SANDS__;
    if (!g.__goldHold) return;
    g.spaces.world.update = g.__goldHold.world;
    g.director.update = g.__goldHold.director;
    g.__goldHold = null;
  });
}

/** Apply a candidate accent material to the staged actor, or restore the spec's. */
async function paint(cand) {
  return page.evaluate((c) => {
    const g = window.__SANDS__;
    const a = window.__goldActor;
    if (!a || !a.materials) return null;
    const m = a.materials.accent;
    if (!m.userData.__gold0) {
      m.userData.__gold0 = {
        rough: m.roughness, metal: m.metalness,
        emissive: m.emissive ? m.emissive.getHex() : 0x000000,
        ei: m.emissiveIntensity,
      };
    }
    const base = m.userData.__gold0;
    m.roughness = c && c.rough !== undefined ? c.rough : base.rough;
    m.metalness = c && c.metal !== undefined ? c.metal : base.metal;
    const hex = c && c.emissive !== undefined ? c.emissive : base.emissive;
    if (m.emissive) m.emissive.setHex(hex); else m.emissive = new g.THREE.Color(hex);
    m.emissiveIntensity = c && c.ei !== undefined ? c.ei : base.ei;
    m.needsUpdate = true;
    return { rough: m.roughness, metal: m.metalness, emissive: m.emissive.getHex(), ei: m.emissiveIntensity };
  }, cand || null);
}

/**
 * Photograph a fixed square. Same clip for every shutter, always.
 *
 * The timeout is enormous and the elapsed time is printed, because on this
 * machine a single frame is a real risk rather than a formality: the run that
 * introduced the staging ticks below died at 180 s on its first capture with no
 * indication of which capture it was. A tool that cannot say where it stopped
 * costs a whole re-run to find out.
 */
let shots = 0;
async function shoot(box, tag = '') {
  const t0 = Date.now();
  const buf = await page.screenshot({
    clip: box, timeout: 420000, animations: 'disabled',
  });
  shots++;
  if (process.env.GOLD_VERBOSE) {
    console.log(`    shot ${String(shots).padStart(3)} ${tag.padEnd(10)} ${Date.now() - t0} ms`);
  }
  return buf.toString('base64');
}

/**
 * THREE shutters, and the third one is the control on the other two.
 *
 * The first two are identical: same pose, same body, nothing touched between
 * them. Every pixel that differs across THAT pair is the instrument's own
 * noise, and `stablePx` reports it. Then the body is hidden and the third shot
 * is taken; the mask is what changed, MINUS whatever the first pair already
 * proved was unstable.
 *
 * Without this, the harness cannot tell a gold beetle from a brazier that
 * flickered, and the first sweep run proved that is not hypothetical: a
 * governor rung fell mid-row and 80 per cent of the clip changed. A "noise
 * outside the mask's own bounding box" check could not see it, because a mask
 * that covers the frame has a bounding box that covers the frame. A pair of
 * identical frames is the only control that cannot be fooled that way.
 */
async function measure(sx, sy) {
  const box = {
    x: Math.max(0, Math.min(800 - CLIP, Math.round(sx - CLIP / 2))),
    y: Math.max(0, Math.min(500 - CLIP, Math.round(sy - CLIP / 2))),
    width: CLIP, height: CLIP,
  };

  await frames(2);
  const ctrl = await shoot(box, 'control');
  await frames(2);
  const withBody = await shoot(box, 'body');

  await page.evaluate(() => { window.__goldActor.group.visible = false; });
  await frames(2);
  const without = await shoot(box, 'hidden');
  await page.evaluate(() => { window.__goldActor.group.visible = true; });

  return page.evaluate(async ({ a, b, c }) => {
    const load = async (s) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + s;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      return x.getImageData(0, 0, img.width, img.height);
    };
    const C = await load(c), A = await load(a), B = await load(b);
    const n = A.width * A.height;

    // sRGB luma, the value the player's eye is actually given.
    const luma = (r, g, bl) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    // 6/255. Under a frozen tone curve a genuinely unchanged pixel comes back
    // identical, so this only has to survive PNG rounding.
    const moved = (P, Q, j) => Math.max(
      Math.abs(P.data[j] - Q.data[j]),
      Math.abs(P.data[j + 1] - Q.data[j + 1]),
      Math.abs(P.data[j + 2] - Q.data[j + 2])
    ) > 6;

    const mask = new Uint8Array(n);
    let stablePx = 0;
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      // The instrument's own noise: two identical frames, nothing touched.
      if (moved(C, A, j)) { stablePx++; continue; }
      if (moved(A, B, j)) mask[i] = 1;
    }

    const body = [], bodyRGB = [0, 0, 0], bodySat = [];
    const bg = [];
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      const r = A.data[j], g = A.data[j + 1], bl = A.data[j + 2];
      const L = luma(r, g, bl);
      if (mask[i]) {
        body.push(L);
        bodyRGB[0] += r; bodyRGB[1] += g; bodyRGB[2] += bl;
        const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
        bodySat.push(mx === 0 ? 0 : (mx - mn) / mx);
      } else {
        bg.push(L);
      }
    }

    if (!body.length) return { px: 0, stablePx };
    body.sort((p, q) => p - q);
    bg.sort((p, q) => p - q);
    const pc = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
    const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const sd = (arr) => {
      const m = mean(arr);
      return Math.sqrt(arr.reduce((s, v) => s + (v - m) * (v - m), 0) / arr.length);
    };

    return {
      px: body.length,
      stablePx,
      p10: +pc(body, 0.10).toFixed(1),
      p50: +pc(body, 0.50).toFixed(1),
      p90: +pc(body, 0.90).toFixed(1),
      max: +body[body.length - 1].toFixed(1),
      sd: +sd(body).toFixed(1),
      // The project's own legibility metric, from the EMISSIVE FLOOR note in
      // mummy.js: how much of the body is flat black.
      blackPct: +((body.filter((v) => v < 8).length / body.length) * 100).toFixed(1),
      r: +(bodyRGB[0] / body.length).toFixed(1),
      g: +(bodyRGB[1] / body.length).toFixed(1),
      b: +(bodyRGB[2] / body.length).toFixed(1),
      sat: +mean(bodySat).toFixed(3),
      bgP50: +pc(bg, 0.50).toFixed(1),
      bgMean: +mean(bg).toFixed(1),
    };
  }, { a: withBody, b: without, c: ctrl });
}

/** Kill the staged actor so the next stage starts clean. */
async function clear() {
  await unfreeze();
  await page.evaluate(() => {
    const g = window.__SANDS__;
    for (const a of (g.director.live || [])) {
      if (a && a.live) { try { a.hurt(1e9, 'body', 0, 0); } catch {} }
    }
    window.__goldActor = null;
  });
  await frames(1);
}

/** One full observation: enter, stage, optionally repaint, measure, tear down. */
async function observe(space, variant, cand) {
  const room = await enterSpace(space);
  const st = await stage(variant);
  if (!st.ok) { await clear(); return { fatal: st.why }; }
  const applied = cand !== undefined ? await paint(cand) : null;
  const m = await measure(st.sx, st.sy);
  await clear();
  return { space, variant, room, at: st, applied, ...m };
}

/**
 * THE FIX, AND THE SAME BODY WITH THE FIX SWITCHED OFF.
 *
 * One staging, two measurements, and the second one puts the accent's emissive
 * intensity back to the zero it had before this change while leaving everything
 * else - the pose, the room, the clip, the camera, the frame - exactly where it
 * was. That is the only before/after on this project that cannot be explained
 * by a different staging, and the exterior columns of the first sweep are why
 * it is here: eight separate stagings of one courtyard produced a fifty-luma
 * spread with no material change to account for it.
 */
async function observeAB(space, variant) {
  const room = await enterSpace(space);
  const st = await stage(variant);
  if (!st.ok) { await clear(); return { fatal: st.why }; }
  const after = await measure(st.sx, st.sy);
  const offAt = await paint({ ei: 0 });
  const before = await measure(st.sx, st.sy);
  await clear();
  return {
    space, variant, room, at: st, ...after,
    before: { ...before, applied: offAt },
  };
}

// ---------------------------------------------------------------------------
// candidates
// ---------------------------------------------------------------------------

/**
 * The sweep, and the reasoning behind each row.
 *
 * The shipped material is metalness 0.90 / roughness 0.26 with no emissive. A
 * metal's DIFFUSE term is albedo x (1 - metalness), so at 0.90 the shell keeps
 * one tenth of its own colour under a point light and gets the rest from an
 * environment that is at 0.05 indoors. Two of the three levers below attack
 * that directly and one routes around it:
 *
 *   metal   give the point lights something to light, at the cost of the crisp
 *           carapace the palette note asked for.
 *   rough   spread the specular lobe so a highlight is a sheen rather than two
 *           bright dots. Cannot make light that is not there.
 *   ei      an EMISSIVE FLOOR, exactly the fix mummy.js already applies to the
 *           linen. Additive, so it is invisible in sun and decisive in a
 *           chamber. It is what the accent was explicitly excluded from.
 */
const GOLD = 0xe8bf55;
const CANDIDATES = [
  { name: 'shipped',            cand: undefined },
  { name: 'ei 0.08',            cand: { emissive: GOLD, ei: 0.08 } },
  { name: 'ei 0.18',            cand: { emissive: GOLD, ei: 0.18 } },
  { name: 'ei 0.30',            cand: { emissive: GOLD, ei: 0.30 } },
  { name: 'ei 0.45',            cand: { emissive: GOLD, ei: 0.45 } },
  { name: 'metal .55 rough .34', cand: { metal: 0.55, rough: 0.34 } },
  { name: 'metal .55 + ei .18', cand: { metal: 0.55, rough: 0.34, emissive: GOLD, ei: 0.18 } },
  { name: 'metal .70 + ei .30', cand: { metal: 0.70, rough: 0.30, emissive: GOLD, ei: 0.30 } },
];

const row = (label, m) =>
  `  ${label.padEnd(24)}px ${String(m.px).padStart(6)}  drift ${String(m.stablePx).padStart(6)}`
  + `   luma p10 ${String(m.p10).padStart(6)} p50 ${String(m.p50).padStart(6)} p90 ${String(m.p90).padStart(6)} max ${String(m.max).padStart(6)}`
  + `   sd ${String(m.sd).padStart(5)}  black ${String(m.blackPct).padStart(5)}%`
  + `   rgb ${String(m.r).padStart(5)} ${String(m.g).padStart(5)} ${String(m.b).padStart(5)}`
  + `   sat ${String(m.sat).padStart(5)}   bg p50 ${String(m.bgP50).padStart(5)}`;

const rig = await page.evaluate(() => ({
  rung: window.__SANDS__.governor.id,
  standingDown: window.__SANDS__.governor.standingDown,
}));

if (SWEEP) {
  /**
   * ONE ACTOR, ONE POSE, ONE CLIP, AND THE MATERIAL REPAINTED UNDER IT.
   *
   * THE FIRST CUT OF THIS SWEEP STAGED A FRESH BODY PER ROW AND THE EXTERIOR
   * NUMBERS CAME BACK IMPOSSIBLE: the shipped material read p50 160.1 and
   * adding a pure emissive - which can only ever ADD light - read 108.2. A
   * material change cannot subtract fifty luma. What differed between those two
   * rows was not the material, it was everything else about the two stagings,
   * and in a sunlit courtyard "everything else" is worth more than the thing
   * being measured.
   *
   * So the body is staged ONCE per space and every candidate is painted onto
   * the material it is already wearing. Same actor, same pose, same pixels, one
   * number different - which is the shape of control the roughness note in
   * mummy.js used to overturn its own proposal, and it is the only shape that
   * can survive a background this bright.
   *
   * THE LAST ROW IS THE DRIFT CONTROL. It repaints the shipped values and
   * re-measures them. If it does not come back on top of the first row, then
   * something OTHER than the material moved during the run and every row
   * between them is suspect.
   */
  console.log(`the sweep. one gold scarab staged at ${RANGE} m, repainted in place.`);
  console.log(`governor rung "${rig.rung}", standing down: ${rig.standingDown}\n`);

  for (const space of ['interior', 'exterior']) {
    const room = await enterSpace(space);
    const st = await stage('goldscarab');
    if (!st.ok) { console.log(`${space}: FATAL ${st.why}`); continue; }

    console.log(`${space}  (environmentIntensity ${room.env}, staged at `
      + `${st.atX}, ${st.y}, ${st.atZ}, screen ${Math.round(st.sx)}, ${Math.round(st.sy)}):`);

    for (const c of [...CANDIDATES, { name: 'shipped (again)', cand: null }]) {
      await paint(c.cand === undefined ? null : c.cand);
      const m = await measure(st.sx, st.sy);
      if (!m.px) { console.log(`  ${c.name.padEnd(24)}NOTHING IN FRAME  drift ${m.stablePx}`); continue; }
      console.log(row(c.name, m));
    }
    await clear();
    console.log('');
  }
  if (errors.length) for (const e of errors.slice(0, 5)) console.log(`  err ${e}`);
  await browser.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// the check
// ---------------------------------------------------------------------------

const inGold = await observeAB('interior', 'goldscarab');
const inPlain = await observe('interior', 'scarab');
const inBound = await observe('interior', 'bound');
const outGold = await observe('exterior', 'goldscarab');
const outPlain = await observe('exterior', 'scarab');

for (const r of [inGold, inPlain, inBound, outGold, outPlain]) {
  if (r.fatal) { console.log(`FATAL  ${r.fatal}`); await browser.close(); process.exit(1); }
}

const mat = (m) => (m.at.accent
  ? `metal ${m.at.accent.metal}  rough ${m.at.accent.rough}  `
    + `emissive ${m.at.accent.emissive} x ${m.at.accent.glow}  walls ${m.at.walls}`
  : 'no accent material');

console.log(`the shell the player is given, ${RANGE} m in front of the camera,`);
console.log('measured over the pixels the body itself changed:\n');
console.log(`interior  (environmentIntensity ${inGold.room.env}, the Hall of Offerings):`);
console.log(row('GOLD SCARAB', inGold));
console.log(row('  same body, glow OFF', inGold.before));
console.log(row('CONTROL ordinary scarab', inPlain));
console.log(row('CONTROL the Bound', inBound));
console.log(`\nexterior  (environmentIntensity ${outGold.room.env}, the courtyard):`);
console.log(row('CONTROL GOLD SCARAB', outGold));
console.log(row('CONTROL ordinary scarab', outPlain));

console.log('\nwhat each accent material was actually wearing at the shutter:');
console.log(`  gold scarab, interior   ${mat(inGold)}`);
console.log(`  gold scarab, courtyard  ${mat(outGold)}`);
console.log(`  the Bound,   interior   ${mat(inBound)}`);
console.log(`  scarab,      interior   ${mat(inPlain)}`);
console.log('');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

// -- the mask is real ------------------------------------------------------
// Everything below is computed over it, so it is checked first.
/**
 * 400 PIXELS IS A STATISTICAL FLOOR, NOT A CLAIM ABOUT BEETLE SIZE.
 *
 * The first draft said `px > 1500`, which is a number nobody measured, and it
 * went red at 1278 on a run where everything else passed. A gold scarab's mask
 * at six metres in this viewport runs anywhere from about 1,000 to 2,200 px
 * depending on where in its scuttle the pose was frozen, so 1500 was testing
 * the animation cycle. What the checks below actually need is enough samples
 * for a p10 and a p90 to mean something, and 400 is a twenty-by-twenty patch -
 * every real failure mode of this harness (nothing staged, body behind the
 * camera, wrong room) returns zero, not 399.
 *
 * The second line is the one doing real work: the two spaces have to be
 * photographing comparably sized bodies, or the interior and exterior columns
 * are not each other's control.
 */
ok(inGold.px > 400 && outGold.px > 400,
  `the body covers enough pixels for a percentile to mean anything `
  + `(interior ${inGold.px} px, exterior ${outGold.px} px)`);
ok(Math.max(inGold.px, outGold.px) < Math.min(inGold.px, outGold.px) * 2,
  `and the two spaces are photographing the same enemy at the same range, `
  + `so they are each other's control (${inGold.px} px against ${outGold.px} px)`);
ok(inGold.stablePx < inGold.px * 0.25 && outGold.stablePx < outGold.px * 0.25,
  `the freeze held: two identical frames drifted by ${inGold.stablePx} px in `
  + `and ${outGold.stablePx} px out, against bodies of ${inGold.px} and ${outGold.px}`);

/**
 * THE MECHANISM WAS ARMED.
 *
 * Everything below is satisfiable by a build where somebody turned the room
 * lights up, so the first thing to establish is that the thing under test is
 * switched on in the interior frame and switched OFF in the courtyard frame.
 * The harness reads this off the live material at the moment of the shutter,
 * not off the spec.
 */
ok(inGold.at.accent && inGold.at.accent.glow > 0,
  `ARMED: the interior shell is carrying its chamber floor `
  + `(emissive ${inGold.at.accent && inGold.at.accent.emissive} x ${inGold.at.accent && inGold.at.accent.glow})`);
ok(outGold.at.accent && outGold.at.accent.glow === 0,
  `and the courtyard shell is NOT (glow ${outGold.at.accent && outGold.at.accent.glow}), `
  + `so the exterior rows below are the shipped material`);
ok(inGold.at.accent && inGold.at.accent.metal === 0.9 && inGold.at.accent.rough === 0.26,
  `and the palette's measured 0.90 / 0.26 is untouched `
  + `(metal ${inGold.at.accent && inGold.at.accent.metal}, rough ${inGold.at.accent && inGold.at.accent.rough})`);

// -- 1. it is not black ----------------------------------------------------
// The bar is the project's own, from the EMISSIVE FLOOR note in mummy.js: a
// body more than a third flat black is the "black robot" reading in numbers.
ok(inGold.blackPct < 20,
  `indoors the shell is not a void (${inGold.blackPct}% of the body under luma 8)`);
ok(inGold.p50 >= 24,
  `and its median pixel is lit (p50 ${inGold.p50})`);

// -- 2. it is GOLD, not merely bright -------------------------------------
// Hue rather than luminance, because a white beetle would pass a luminance bar.
ok(inGold.r > inGold.b * 1.6,
  `indoors the shell is warm, not neutral (r ${inGold.r} against b ${inGold.b})`);
ok(inGold.sat > 0.30,
  `and it is saturated (mean saturation ${inGold.sat})`);

// -- 3. THE BEFORE/AFTER, on one body, one pose, one frame.
/**
 * THE MASK SHRINKS WHEN THE GLOW COMES OFF, AND THAT IS A FINDING RATHER THAN
 * A TOLERANCE PROBLEM.
 *
 * This check was first written as "the two masks are within 5 per cent, so it
 * is the same body", and it went red at 2219 px against 1868. Nothing moved:
 * same actor, same pose, same clip, one uniform different. What changed is how
 * much of the beetle is DETECTABLE. The mask is the set of pixels that move by
 * more than 6/255 when the body is hidden, so a shell sitting on the wall's own
 * value contributes nothing to it - and with the floor off, 351 pixels of this
 * beetle are within six levels of the stone behind them.
 *
 * That is the defect stated in its own units: about a sixth of the animal is
 * not merely dark against the wall, it is INDISTINGUISHABLE from it. So the
 * band here is wide enough to confirm it is one body and one pose, and the
 * shrinkage is printed rather than smoothed away.
 */
const maskLost = inGold.px - inGold.before.px;
ok(inGold.before.px > 0 && Math.abs(maskLost) < inGold.px * 0.30,
  `the before/after is the SAME BODY in the same pose (${inGold.px} px armed, `
  + `${inGold.before.px} px with the glow off)`);
ok(maskLost > 0,
  `and with the floor off ${maskLost} px of it - ${((maskLost / inGold.px) * 100).toFixed(1)}% - `
  + `are within six levels of the wall behind them, which is not "dark", it is invisible`);
ok(inGold.p50 > inGold.before.p50 * 2.5,
  `and switching the chamber floor off puts it straight back in the dark `
  + `(p50 ${inGold.before.p50} off, ${inGold.p50} on)`);
ok(inGold.before.blackPct > inGold.blackPct,
  `with more of the body crushed to flat black `
  + `(${inGold.before.blackPct}% off against ${inGold.blackPct}% on)`);

// -- 4. THE CONTROL. It has to beat the beetle that is not supposed to be gold.
ok(inGold.p50 > inPlain.p50 * 1.5,
  `CONTROL: gold reads brighter than the ordinary scarab in the same room `
  + `(p50 ${inGold.p50} against ${inPlain.p50})`);
/**
 * SATURATION IS NOT USABLE AS A COMPARISON HERE, AND THE FIRST DRAFT OF THIS
 * FILE ASSERTED IT ANYWAY.
 *
 * It read `inGold.sat > inPlain.sat` and went red at 0.594 against 0.651 - the
 * gold shell scoring LESS saturated than the brown one. That is not a defect in
 * the shell, it is the metric collapsing: saturation is (max - min) / max, and
 * the ordinary scarab's median pixel indoors is luma 8.1 with half its body
 * under 8. At those values a pixel of (4, 2, 1) scores 0.75, so a body that is
 * essentially black returns a high number built out of quantisation.
 *
 * The same shape as the note about asserting "luminance under 2" for flat
 * black and measuring 5.49 because the palette's black is warm: an invented
 * threshold on the wrong instrument. The gold shell's saturation is asserted in
 * ABSOLUTE terms above, where it means something; what the control is actually
 * for is that the ordinary scarab STAYS DARK, and that is what it now says.
 */
ok(inPlain.p50 < inGold.p50 * 0.25 && inPlain.blackPct > 25,
  `CONTROL: and the ordinary scarab is left in the dark, which is the proof this `
  + `is not the room getting brighter (p50 ${inPlain.p50}, ${inPlain.blackPct}% flat black)`);

// -- 4. THE CONTROL THE OWNER SIGNED OFF ON. The courtyard is the ceiling.
ok(outGold.blackPct < 20,
  `CONTROL: the courtyard beetle is still gold (${outGold.blackPct}% black, p50 ${outGold.p50})`);
ok(outGold.sat > 0.30,
  `CONTROL: and still saturated outdoors (${outGold.sat})`);
ok(inGold.p50 > outGold.p50 * 0.30,
  `the interior shell is within reach of the exterior one `
  + `(indoor p50 ${inGold.p50} is ${(inGold.p50 / outGold.p50).toFixed(2)} of outdoor ${outGold.p50})`);

// -- 5. SEPARATION. Lifting the body onto the wall's value is a different way
// to be invisible; the EMISSIVE FLOOR note rejected 0.11 for exactly this.
ok(Math.abs(inGold.p50 - inGold.bgP50) > 8,
  `it is separated from the stone behind it `
  + `(body p50 ${inGold.p50} against background p50 ${inGold.bgP50})`);

// -- 6. THE OTHER BODY ON THE SAME METAL BAND MUST NOT MOVE.
// The Bound wears accentMetal 0.88 as TRIM. If the fix reaches it, a gilded
// mummy turns into a lamp and this file is why nobody noticed.
ok(inBound.px > 1500, `CONTROL: the Bound was measured too (${inBound.px} px)`);
/**
 * A RELATIONSHIP, NOT AN INVENTED THRESHOLD.
 *
 * The first draft of this check asserted "the Bound's p50 is under 60", which
 * is a number nobody measured and which would have been testing the Bound's
 * palette rather than testing whether this change reached it. What the change
 * actually promises is narrower and checkable: `accentGlow` is opt-in, so the
 * Bound's accent must be wearing NOTHING, and its body must still sit far below
 * the one body that opted in.
 */
ok(inBound.at.accent && inBound.at.accent.glow === 0
  && inBound.at.accent.emissive === '0x000000',
  `CONTROL: the Bound's gilding never opted in `
  + `(emissive ${inBound.at.accent && inBound.at.accent.emissive} x ${inBound.at.accent && inBound.at.accent.glow})`);
ok(inBound.p50 < inGold.p50 * 0.6,
  `CONTROL: so it still reads as trim on a dark body, well under the gold scarab's shell `
  + `(p50 ${inBound.p50} against ${inGold.p50})`);

ok(errors.length === 0, 'no console errors');
if (errors.length) for (const e of errors.slice(0, 5)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
