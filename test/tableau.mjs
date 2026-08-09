/**
 * THE FOUR FRAGMENTS, MEASURED IN PIXELS, WITH A CONTROL IN THE SAME RUN.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS SUSPICIOUS OF ITSELF
 * ---------------------------------------------------------------------------
 *
 * A story surface that renders NOTHING passes every state check ever written.
 * `phase: 'hold'`, `draws: 41`, `holding: true` are all things the code says
 * about itself, and five defects in this project this month went green on
 * exactly that kind of evidence. So every claim below that matters is settled
 * on a SCREENSHOT:
 *
 *   - each fragment is photographed while it is held, and measured against the
 *     world frame it replaced AND against the other three fragments. Four
 *     images that are identical to each other would mean the data is not
 *     reaching the driver, and four images identical to the world would mean
 *     the driver is not reaching the screen.
 *   - the growth's colour is counted by a pixel predicate, and the same
 *     predicate is run over the WORLD frames as its own control: a detector
 *     that fires on torchlight would prove nothing about fragment 2.
 *
 * ---------------------------------------------------------------------------
 * THE CONTROL THAT THIS WHOLE APPROACH LIVES OR DIES ON
 * ---------------------------------------------------------------------------
 *
 * The tableau borrows the game's renderer and draws a second scene straight to
 * the canvas, bypassing the composer. The specific risk - stated in
 * `docs/STORY-DELIVERY.md` section 6 and in `core/post.js:56-75` before it - is
 * the renderer coming back DIRTY: autoClear left off, a render target left
 * bound, a clear colour left black, and the composer producing garbage from the
 * next frame on.
 *
 * So the world is photographed, a fragment is shown, it is dismissed, and the
 * world is photographed again - and the two are compared against a NOISE FLOOR
 * measured in the same run, over the same wall-clock interval, with no fragment
 * in it. The game is alive during both intervals: mummies walk, torches
 * flicker, fog drifts. A fixed threshold would be a number I made up; a
 * time-matched control is the same world drifting for the same length of time.
 *
 * ---------------------------------------------------------------------------
 * WALL CLOCK, NOT SIMULATION TIME
 * ---------------------------------------------------------------------------
 *
 * `docs/WORLD1-POLISH.md` item 0: `ui/ending.js` counted a title card on
 * main.js's clamped delta and six real seconds advanced its clock by 0.7.
 * `ui/briefing.js` hit the same defect with a per-frame accumulator under
 * swiftshader, where one frame can cost 1.7 seconds. This harness reads
 * `Date.now()` on the node side and `performance.now()` on the page side and
 * counts no frames anywhere, because a fragment that takes eleven seconds on
 * the owner's machine and reports four is the third instance of one bug.
 *
 * ---------------------------------------------------------------------------
 * HOW IT DRIVES SOMETHING MAIN.JS DOES NOT KNOW ABOUT YET
 * ---------------------------------------------------------------------------
 *
 * `src/main.js` is contended and is not this lane's to edit, so the integration
 * is performed HERE, in the page, and torn down with the browser: the module is
 * imported dynamically, handed the live `renderer`, and the composer's own
 * `render` is wrapped with the exact branch main.js will get -
 * `if (tableau.holding) return;` - which is the whole of the wiring. Nothing is
 * added to main.js, permanently or otherwise.
 *
 * Port 4188 on purpose. 4177 is the owner's.
 *
 * ---------------------------------------------------------------------------
 * WHAT SWIFTSHADER COSTS, MEASURED BEFORE ANYTHING WAS ASSERTED
 * ---------------------------------------------------------------------------
 *
 * A world frame in this configuration costs 1.9 to 2.9 SECONDS - the whole post
 * chain through a software rasteriser - so the game runs here at roughly a third
 * of a frame per second. Two consequences, and both are load-bearing:
 *
 *   Every deadline below is generous to the point of looking silly, because a
 *   twenty second timeout is seven frames.
 *
 *   THE NUMBERS THIS FILE QUOTES FOR A FRAGMENT'S LENGTH ARE THE PAGE'S OWN
 *   (`stats().lastMs`, measured `performance.now()` to `performance.now()`),
 *   never the node side's. A `page.evaluate()` cannot run while the renderer is
 *   inside a two second frame, so node's stopwatch measures the fragment PLUS
 *   however long the browser took to accept the instruction - which was 1.2
 *   seconds on the first measured run and is not the player's experience of
 *   anything.
 *
 * Fidelity is dropped to low for the same reason: it is the world's cost that
 * makes this slow, and the tableau does not go through the composer at all, so
 * nothing about a fragment's own picture changes. Measured while holding: 50
 * tableau frames per second on the same machine that renders the world at 0.35.
 *
 *   node test/tableau.mjs            starts its own server on 4188
 *   node test/tableau.mjs <url>      drives a server you already have
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { resolveChrome, GL_ARGS } from './chrome.mjs';

const PORT = 4188;
const ROOT = new URL('../', import.meta.url).pathname;
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ARG = process.argv[2] || process.env.SANDS_URL || null;
const BASE = ARG || `http://127.0.0.1:${PORT}/index.html`;

const results = [];
const note = (ok, label, detail) => {
  results.push({ ok, label, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
};

// ---------------------------------------------------------------------------
// pixels
// ---------------------------------------------------------------------------

const LUMA = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * What is actually on the screen, as five numbers.
 *
 * `ink` is the black: silhouettes and void. `lit` is anything above the noise
 * of a dark panel. `bright` is the doorway. `growth` is the one impossible
 * colour in `src/story/fragments.js` - strongly green, weakly red - and it is
 * run over every image including the world's, so its zero on stone and
 * torchlight is measured rather than assumed.
 */
async function measure(buf) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const n = info.width * info.height;
  let sum = 0; let ink = 0; let lit = 0; let bright = 0; let growth = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * ch]; const g = data[i * ch + 1]; const b = data[i * ch + 2];
    const y = LUMA(r, g, b);
    sum += y;
    if (y < 6) ink++;
    if (y >= 12) lit++;
    if (y >= 96) bright++;
    if (g > 60 && g > r * 1.6 && g > b * 1.15) growth++;
  }
  return {
    w: info.width,
    h: info.height,
    mean: sum / n,
    ink: ink / n,
    lit: lit / n,
    bright: bright / n,
    growth: growth / n,
  };
}

/** Mean absolute channel difference, and how much of the frame moved at all. */
async function diff(a, b) {
  const A = await sharp(a).raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(b).raw().toBuffer({ resolveWithObject: true });
  if (A.info.width !== B.info.width || A.info.height !== B.info.height) {
    return { mean: Infinity, moved: 1, note: 'size mismatch' };
  }
  const ch = A.info.channels;
  const n = A.info.width * A.info.height;
  let sum = 0; let moved = 0;
  for (let i = 0; i < n; i++) {
    const dr = Math.abs(A.data[i * ch] - B.data[i * ch]);
    const dg = Math.abs(A.data[i * ch + 1] - B.data[i * ch + 1]);
    const db = Math.abs(A.data[i * ch + 2] - B.data[i * ch + 2]);
    sum += (dr + dg + db) / 3;
    if (dr > 8 || dg > 8 || db > 8) moved++;
  }
  return { mean: sum / n, moved: moved / n };
}

/**
 * The same, over one rectangle of the frame.
 *
 * THE CHECK THAT CAUGHT THE ONE REAL DEFECT IN THIS BUILD. A whole-frame diff
 * said 78% of the picture had changed and passed while the minimap, the gold
 * counter and the ammo plate were sitting on top of a man's memory of his own
 * death - because the world behind them had indeed been replaced. The interface
 * lives in the corners, so the corners are measured on their own.
 */
async function diffRegion(a, b, r) {
  const cut = async (buf) => sharp(buf).extract(r).png().toBuffer();
  return diff(await cut(a), await cut(b));
}

/** Where this game keeps its interface, at 1024 x 640. */
const HUD_REGIONS = [
  { name: 'minimap + objective (left)', left: 16, top: 16, width: 310, height: 500 },
  { name: 'ammo plate (bottom right)', left: 790, top: 450, width: 220, height: 130 },
  { name: 'gold (top right)', left: 880, top: 10, width: 130, height: 60 },
];

const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : String(n));
const pct = (n) => `${(n * 100).toFixed(1)}%`;

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------

const reachable = async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/src/story/tableau.js`, { method: 'HEAD' });
    return r.ok;
  } catch { return false; }
};

let server = null;
if (!ARG) {
  // ADOPT A SERVER RATHER THAN FIGHT ONE. Three lanes are working this tree
  // tonight and a second `http.server` on a bound port exits without saying so,
  // after which this file would poll a stranger's process, pass, and then kill
  // it in the `finally`. Probe first, and only spawn what we will own.
  if (await reachable()) {
    console.log(`note: reusing the server already on ${PORT}`);
  } else {
    server = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: ROOT, stdio: 'ignore',
    });
    const until = Date.now() + 10000;
    let up = false;
    while (Date.now() < until && !up) {
      up = await reachable();
      if (!up) await new Promise((r) => setTimeout(r, 150));
    }
    if (!up) { console.log(`FAIL  server on ${PORT} never came up`); process.exit(1); }
  }
}

const shutdown = () => { if (server) try { server.kill('SIGTERM'); } catch { /* gone */ } };

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
  await page.evaluate(() => {
    window.__SANDS__.start();
    // See the note at the top: the world is what is slow here, and the tableau
    // never touches the chain that makes it slow.
    window.__SANDS__.setFidelity(false);
    // THE FIRST MEASURED RUN KILLED THE PLAYER. A harness that stands still in
    // a courtyard for ninety seconds gets eaten, and `ui/death.js` then puts an
    // UNWORTHY card over the screen - which is a different image, arrives in
    // the middle of the control interval, and looks exactly like the renderer
    // this file exists to exonerate having been left dirty. The horde is not
    // the subject; it is turned off rather than reasoned about.
    window.__SANDS__.combat.state.invulnerable = true;
    // AND THE HORDE IS SENT HOME, which is the difference between a control and
    // a hope. Every "did the world come back" check below is a pixel diff of
    // two world frames, and twenty-four mummies walking between them is noise
    // of exactly the magnitude a dirty renderer would produce. `reset()` clears
    // the live field; `running = false` stops update() at its first line. What
    // is left moving is fog drift, the cloud field and the torches, which is a
    // noise floor small enough to see through.
    window.__SANDS__.director.reset();
    window.__SANDS__.director.state.running = false;
  });
  // Long enough for the courtyard to be a picture rather than a loading screen.
  // At two seconds a frame that is one or two frames, not a hundred.
  await page.waitForTimeout(4000);

  // What a world frame actually costs, measured rather than assumed, so the
  // timings printed below can be read against something.
  const worldFrame = await page.evaluate(() => new Promise((res) => {
    let n = 0; const s = performance.now();
    const tick = () => {
      n++;
      if (n >= 4) return res(Math.round((performance.now() - s) / n));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  console.log(`world frame cost: ${worldFrame}ms under swiftshader`);

  // -------------------------------------------------------------------------
  // wire the tableau exactly the way main.js will
  // -------------------------------------------------------------------------

  const wired = await page.evaluate(async () => {
    const [{ createTableau }, frag] = await Promise.all([
      import('/src/story/tableau.js'),
      import('/src/story/fragments.js'),
    ]);
    const g = window.__SANDS__;

    const before = {
      autoClear: g.renderer.autoClear,
      toneMapping: g.renderer.toneMapping,
      exposure: g.renderer.toneMappingExposure,
      clear: g.renderer.getClearColor(new g.THREE.Color()).getHex(),
      alpha: g.renderer.getClearAlpha(),
      target: g.renderer.getRenderTarget() === null,
    };

    const tab = createTableau({ renderer: g.renderer, doc: document });
    const seq = frag.createFragmentSequence(frag.WORLD_1_FRAGMENTS);

    // THE WIRING, and it is the one branch main.js gets: while a memory is up,
    // the host does not draw the world.
    const composer = g.post.composer;
    const orig = composer.render.bind(composer);
    composer.render = (dt) => { if (tab.holding) return; return orig(dt); };

    // AND THE FRAME GOVERNOR IS GATED WITH IT, which is not a harness
    // convenience - it is where the branch has to go in main.js, discovered by
    // measurement. `governor.sample(raw * 1000)` sits a few lines below the
    // briefing's guard. While a memory is up the composer is skipped, so frames
    // cost 20ms instead of 2100, and a governor fed that burst UPSHIFTS the
    // pixel scale - after which the world comes back at a different resolution
    // and every "is the composer still working" diff in this file spikes for a
    // reason that has nothing to do with the renderer. Measured: 21.57 against
    // a floor of 2.63. The tableau's branch belongs ABOVE the governor, exactly
    // where the briefing's does.
    const gsample = g.governor.sample.bind(g.governor);
    g.governor.sample = (ms) => { if (tab.holding) return; return gsample(ms); };

    window.__TABLEAU__ = {
      tab,
      seq,
      before,
      shownAt: 0,
      /**
       * RAISED FROM INSIDE AN ANIMATION FRAME, and that is measurement hygiene
       * rather than realism. A `page.evaluate` cannot run while the renderer is
       * two seconds into a world frame, so a show() issued from node lands at a
       * random point inside one - and the tableau's first step then arrives up
       * to 2.1s late, which on fragment 4 was enough to SKIP the 1900ms first
       * still entirely and photograph the same frame twice. Issued on a fresh
       * frame, the next one is cheap (the composer is already being skipped)
       * and every phase gets seen.
       */
      show() {
        const rec = seq.next();
        if (!rec) return Promise.resolve(null);
        return new Promise((res) => requestAnimationFrame(() => {
          this.shownAt = performance.now();
          res(tab.show(rec) ? rec.id : null);
        }));
      },
      probe() {
        return {
          autoClear: g.renderer.autoClear,
          toneMapping: g.renderer.toneMapping,
          exposure: g.renderer.toneMappingExposure,
          clear: g.renderer.getClearColor(new g.THREE.Color()).getHex(),
          alpha: g.renderer.getClearAlpha(),
          target: g.renderer.getRenderTarget() === null,
        };
      },
    };

    return { before, fragments: frag.WORLD_1_FRAGMENTS.length, holding: tab.holding };
  });

  note(wired.fragments === 4, 'four fragments authored', `n=${wired.fragments}`);
  note(wired.holding === false, 'holding is false before any fragment');

  // -------------------------------------------------------------------------
  // 1. the noise floor, measured in this run and over a matched interval
  // -------------------------------------------------------------------------
  //
  // Two intervals. The short one is renderer and temporal jitter with the world
  // barely moved. The matched one is the world drifting for as long as a
  // fragment lasts, which is the number every "did the world come back" check
  // below is compared against.

  const FRAGMENT_MS = 7000;   // longer than the longest fragment measured (6.6s)

  const n0 = await page.screenshot();
  await page.waitForTimeout(150);
  const n1 = await page.screenshot();
  await page.waitForTimeout(FRAGMENT_MS);
  const n2 = await page.screenshot();
  writeFileSync(`${OUT}tableau-world-control.png`, n0);

  const noiseShort = await diff(n0, n1);
  const noiseMatched = await diff(n0, n2);
  const worldStats = await measure(n0);

  console.log('');
  console.log(`world control      mean luma ${f2(worldStats.mean)}  lit ${pct(worldStats.lit)}  ink ${pct(worldStats.ink)}  growth-detector ${pct(worldStats.growth)}`);
  console.log(`noise floor 150ms  mean ${f2(noiseShort.mean)}  moved ${pct(noiseShort.moved)}`);
  console.log(`noise floor ${FRAGMENT_MS}ms mean ${f2(noiseMatched.mean)}  moved ${pct(noiseMatched.moved)}`);
  console.log('');

  note(worldStats.growth < 0.002,
    'the growth detector reads ~zero on the world (its own control)',
    `${pct(worldStats.growth)}`);
  note(worldStats.mean > 4, 'the world control is a picture, not a black frame',
    `mean luma ${f2(worldStats.mean)}`);

  // -------------------------------------------------------------------------
  // 2. the four fragments
  // -------------------------------------------------------------------------

  const shots = [];
  const authored = [
    { id: 'w1-f1-the-door', stills: 1, total: 380 + 2600 + 560 },
    { id: 'w1-f2-the-growth', stills: 1, total: 380 + 2800 + 560 },
    { id: 'w1-f3-the-wrong-eye', stills: 1, total: 380 + 3000 + 560 },
    { id: 'w1-f4-she-was-there', stills: 2, total: 420 + 1900 + 2900 + 760 },
  ];

  for (let i = 0; i < 4; i++) {
    const beforeShot = await page.screenshot();
    const shotAt = Date.now();
    const wallStart = Date.now();

    const id = await page.evaluate(() => window.__TABLEAU__.show());
    note(id === authored[i].id, `fragment ${i + 1} raised`, `id=${id}`);

    // Held, curtain fully off. Wall clock on both sides of the wire.
    await page.waitForFunction(
      () => {
        const s = window.__TABLEAU__.tab.stats();
        return s.phase === 'hold' && s.curtain === 0;
      },
      null, { timeout: 60000, polling: 40 },
    );
    const heldAt = Date.now() - wallStart;

    const lifted = await page.evaluate(() => window.__TABLEAU__.tab.stats().canvasLifted);
    note(lifted === true, `fragment ${i + 1} holds the canvas over the interface`);

    // WHICH STILL WAS PHOTOGRAPHED, read on both sides of the shutter. A frame
    // captured across a hard cut belongs to neither still, and a harness that
    // assumed it had still 0 because it asked for one is the exact shape of
    // claim this project has stopped accepting.
    const beforeIdx = await page.evaluate(() => window.__TABLEAU__.tab.stats().still);
    const a = await page.screenshot();
    const afterIdx = await page.evaluate(() => window.__TABLEAU__.tab.stats().still);
    writeFileSync(`${OUT}tableau-f${i + 1}.png`, a);
    shots.push({
      n: i + 1, still: 'a', buf: a,
      idx: beforeIdx === afterIdx ? beforeIdx : null,
    });
    if (authored[i].stills === 2) {
      note(beforeIdx === 0 && afterIdx === 0,
        'fragment 4 still A was photographed before the cut',
        `still index ${beforeIdx} -> ${afterIdx}`);
    }

    // Fragment 4 is the only record with a second still, and the transition to
    // it is a HARD CUT. Photographed separately, because a cut that never fires
    // leaves a passing test with one image.
    if (authored[i].stills === 2) {
      await page.waitForFunction(
        () => {
          const s = window.__TABLEAU__.tab.stats();
          return s.phase === 'hold' && s.still === 1;
        },
        null, { timeout: 60000, polling: 40 },
      );
      const beforeB = await page.evaluate(() => window.__TABLEAU__.tab.stats().still);
      const b = await page.screenshot();
      const afterB = await page.evaluate(() => window.__TABLEAU__.tab.stats().still);
      writeFileSync(`${OUT}tableau-f${i + 1}b.png`, b);
      shots.push({ n: i + 1, still: 'b', buf: b, idx: beforeB === afterB ? beforeB : null });
      note(beforeB === 1 && afterB === 1,
        'fragment 4 still B was photographed after the cut',
        `still index ${beforeB} -> ${afterB}`);
    }

    // Down, and all the way down: 'done' is after the return fade, so the
    // curtain is off the world before anything is photographed.
    await page.waitForFunction(
      () => window.__TABLEAU__.tab.stats().phase === 'done',
      null, { timeout: 90000, polling: 40 },
    );
    const wallTotal = Date.now() - wallStart;

    const s = await page.evaluate(() => window.__TABLEAU__.tab.stats());
    note(s.canvasLifted === false,
      `the canvas is back under the interface after fragment ${i + 1}`);
    const afterShot = await page.screenshot();
    if (i === 0) writeFileSync(`${OUT}tableau-world-after.png`, afterShot);

    const spanMs = Date.now() - shotAt;
    const d = await diff(beforeShot, afterShot);

    /*
     * THE CONTROL, MEASURED PER FRAGMENT AND OVER THE SAME NUMBER OF SECONDS.
     *
     * The run-wide noise floor above is a fixed 7000ms and the interval a
     * fragment actually spans is its own length plus two screenshots and a
     * dozen polls - up to eleven seconds on fragment 4. The world drifts the
     * whole time (the sky is the last thing still moving with the horde sent
     * home), so comparing an eleven second gap against a seven second floor
     * charges the renderer for four seconds of weather. Measured here: the
     * SAME span, taken immediately afterwards, with no fragment in it.
     */
    await page.waitForTimeout(spanMs);
    const driftShot = await page.screenshot();
    const drift = await diff(afterShot, driftShot);

    console.log(`fragment ${i + 1}  in-page ${s.lastMs}ms (authored ${authored[i].total})  draws ${s.draws}  cuts ${s.cuts}  |  harness-side, incl CDP latency: held at ${heldAt}ms, released ${wallTotal}ms`);

    note(s.draws > 0, `fragment ${i + 1} actually called renderer.render`, `draws=${s.draws}`);
    note(s.lastForced === false, `fragment ${i + 1} ended on its own clock, not the safety deadline`);

    // The wall-clock check. A delta-accumulator under swiftshader would blow
    // this out by a factor, which is exactly what it did in ui/ending.js.
    const ratio = s.lastMs / authored[i].total;
    note(ratio > 0.8 && ratio < 1.6,
      `fragment ${i + 1} ran in wall clock`,
      `${s.lastMs}ms vs ${authored[i].total}ms authored, ratio ${f2(ratio)}`);

    // THE CONTROL. The world after a fragment against the world before it,
    // measured against a drift interval of the same length with no fragment.
    note(d.mean <= drift.mean * 1.5 + 1.5,
      `the composer still works after fragment ${i + 1}`,
      `diff ${f2(d.mean)} over ${spanMs}ms vs ${f2(drift.mean)} of pure drift over the same ${spanMs}ms`);

    const probe = await page.evaluate(() => window.__TABLEAU__.probe());
    const clean = probe.autoClear === wired.before.autoClear
      && probe.toneMapping === wired.before.toneMapping
      && probe.exposure === wired.before.exposure
      && probe.clear === wired.before.clear
      && probe.alpha === wired.before.alpha
      && probe.target === wired.before.target;
    note(clean, `renderer handed back as found after fragment ${i + 1}`,
      JSON.stringify(probe));
  }

  // -------------------------------------------------------------------------
  // 3. what the fragments actually look like, and that they are four pictures
  // -------------------------------------------------------------------------

  console.log('');
  const stats = [];
  for (const s of shots) {
    const m = await measure(s.buf);
    stats.push({ ...s, m });
    console.log(`fragment ${s.n}${s.still === 'b' ? 'b' : ' '}  mean luma ${f2(m.mean)}  ink ${pct(m.ink)}  lit ${pct(m.lit)}  bright ${pct(m.bright)}  growth ${pct(m.growth)}`);
  }
  console.log('');

  for (const s of stats) {
    const label = `fragment ${s.n}${s.still === 'b' ? 'b' : ''}`;
    const d = await diff(s.buf, n0);
    note(d.mean > 8 && d.moved > 0.25, `${label} replaced the frame`,
      `diff vs world ${f2(d.mean)}, ${pct(d.moved)} of pixels moved`);
    // 0.08, and the number is set BELOW the widest shot's measured value
    // rather than above a hoped-for one: fragment 1 puts seven small figures in
    // a big room and is the least black frame the set will ever contain.
    note(s.m.ink > 0.08, `${label} has black shapes in it`, `ink ${pct(s.m.ink)}`);
    note(s.m.lit > 0.10, `${label} is not a black screen`, `lit ${pct(s.m.lit)}`);
    note(s.m.bright > 0.002, `${label} has the doorway lit`, `bright ${pct(s.m.bright)}`);

    for (const r of HUD_REGIONS) {
      const rd = await diffRegion(s.buf, n0, r);
      note(rd.moved > 0.4, `${label}: the interface is not on top - ${r.name}`,
        `${pct(rd.moved)} of that corner moved`);
    }
  }

  // Four different pictures. Identical images would mean the driver ignores the
  // record, which every state check in this file would still call green.
  for (let i = 0; i < stats.length; i++) {
    for (let j = i + 1; j < stats.length; j++) {
      const d = await diff(stats[i].buf, stats[j].buf);
      const label = `f${stats[i].n}${stats[i].still === 'b' ? 'b' : ''} vs f${stats[j].n}${stats[j].still === 'b' ? 'b' : ''}`;
      note(d.moved > 0.01, `${label} are different frames`,
        `diff ${f2(d.mean)}, ${pct(d.moved)} moved`);
    }
  }

  // The story checks, made in pixels rather than in prose.
  const f1 = stats.find((s) => s.n === 1);
  const f2s = stats.find((s) => s.n === 2);
  const f4a = stats.find((s) => s.n === 4 && s.still === 'a');
  const f4b = stats.find((s) => s.n === 4 && s.still === 'b');

  note(f1.m.growth < 0.0005 && f2s.m.growth > 0.002,
    'the growth arrives in fragment 2 and is absent from fragment 1',
    `f1 ${pct(f1.m.growth)} -> f2 ${pct(f2s.m.growth)}`);

  const cut = await diff(f4a.buf, f4b.buf);
  note(cut.moved > 0.02, 'fragment 4 hard-cuts to a different frame',
    `${pct(cut.moved)} of pixels moved across the cut`);
  note(f4b.m.ink > f4a.m.ink,
    'the frame after the cut is blacker: he is down and she is in it',
    `${pct(f4a.m.ink)} -> ${pct(f4b.m.ink)}`);

  // -------------------------------------------------------------------------
  // 4. after everything: the game is still a game
  // -------------------------------------------------------------------------

  const spent = await page.evaluate(async () => ({
    spent: window.__TABLEAU__.seq.spent,
    next: await window.__TABLEAU__.show(),
    curtain: getComputedStyle(document.getElementById('tableau-curtain')).display,
    holding: window.__TABLEAU__.tab.holding,
  }));
  note(spent.spent && spent.next === null,
    'a fifth take raises nothing rather than replaying the fourth');
  note(spent.curtain === 'none', 'the curtain is off the screen when nothing is up',
    spent.curtain);
  note(spent.holding === false, 'holding is false with the sequence spent');

  const t0 = await page.evaluate(() => window.__SANDS__.elapsed);
  await page.waitForTimeout(1200);
  const t1 = await page.evaluate(() => window.__SANDS__.elapsed);
  note(t1 > t0, 'the simulation is still advancing after four fragments',
    `elapsed ${f2(t0)} -> ${f2(t1)}`);

  const live = await page.screenshot();
  writeFileSync(`${OUT}tableau-world-final.png`, live);
  const liveStats = await measure(live);
  note(Math.abs(liveStats.mean - worldStats.mean) < Math.max(6, worldStats.mean * 0.35),
    'the final world frame is the same kind of image as the control',
    `mean luma ${f2(worldStats.mean)} -> ${f2(liveStats.mean)}`);

  note(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
} catch (e) {
  note(false, 'harness threw', String(e && e.message ? e.message : e));
} finally {
  await browser.close();
  shutdown();
}

// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(`${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`  FAILED: ${f.label} ${f.detail || ''}`);
console.log(`shots in ${OUT}`);
process.exit(failed.length ? 1 : 0);
