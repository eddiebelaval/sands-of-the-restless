/**
 * The Chest of the Nameless: harness.
 *
 * Two things are being tested and they need completely different rigs.
 *
 * THE STATE MACHINE is driven by pumping systems/mysterybox.js's own update()
 * directly, in a tight synchronous loop, with no rendering at all. A full pull
 * is eleven simulated seconds and this project renders at about two frames a
 * second under swiftshader, so testing the go-cold threshold through the frame
 * loop would be twenty minutes of wall clock for one relocation. Pumping runs
 * the identical code with the identical deltas and takes microseconds.
 *
 * THE FRAME is the reason this file is long. A green run of state assertions is
 * fully compatible with a completely black screen - this project has proved
 * that three separate times - so every visual state of the chest is
 * PHOTOGRAPHED and every photograph is MEASURED, over the upper two thirds of
 * the frame only, because the lower third is the weapon and the weapon renders
 * perfectly well when nothing else does.
 *
 * The pump is what makes that affordable: it puts the fixture in an exact state
 * with no wall-clock waiting, and then two real rendered frames photograph it.
 * So the shots are of the real renderer in the real state, and nothing in this
 * file waits on a setTimeout for anything.
 *
 * FINDABILITY IS MEASURED, not asserted by eye. The Anubis shrine was once
 * functionally perfect and photographed at 5.5 mean luminance: right behaviour,
 * right text, impossible to find. So every spawn is photographed with the chest
 * and without it from the same camera, and the difference is the number that
 * decides whether this fixture is done.
 *
 * EVERY NUMBER IN HERE COMES OUT OF A DECODED PNG, and that is a correction.
 * The first version of this file read pixels in the page with
 * `ctx.drawImage(renderer.domElement)`, which is the same reader STATE.md
 * already records as blind: the renderer does not preserve its drawing buffer,
 * so a read that lands in the wrong turn samples a cleared one. It does not fail
 * loudly - it returns a plausible, entirely black measurement. Two of fifteen
 * patches in one probe run came back at mean 1.7 while the frame around them was
 * at 130. So the screenshot IS the measurement now: page.screenshot() to a
 * buffer, inflate it here, and every luminance figure below is of pixels that
 * were definitely on the screen.
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// pixels
// ---------------------------------------------------------------------------

/**
 * Decode a PNG to raw samples. Enough of the format for what Chrome emits:
 * 8-bit, non-interlaced, colour type 2 (RGB) or 6 (RGBA).
 *
 * Deliberately not a dependency. A decoder for the one file format we produce
 * ourselves is forty lines of zlib and arithmetic, and zlib is in the standard
 * library - so the only thing this suite needs installed is the browser driver.
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

  // Undo the per-scanline filters. Each row is prefixed by its filter byte and
  // predicts from the pixel to the left (a), the row above (b) and the pixel
  // above-left (c) - so this has to run in order and cannot be vectorised away.
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

/**
 * Luma over a normalised rect. Defaults to the UPPER TWO THIRDS, because the
 * lower third is the weapon and the weapon renders perfectly well when nothing
 * else in the scene does.
 *
 * Reports the distribution and not only the mean. `clip` and `spread` are the
 * two that decide whether the reveal is a weapon mark or a white blob: a blob
 * has a high mean, a high clip and almost no spread, and a mean alone cannot
 * tell the two apart. That is how a plate lit to the same value as the mark on
 * it passed a brightness check for a fortnight.
 */
function luma(img, rect) {
  const { w, h, ch, data } = img;
  const x0 = Math.floor((rect ? rect[0] : 0) * w);
  const x1 = Math.floor((rect ? rect[2] : 1) * w);
  const y0 = Math.floor((rect ? rect[1] : 0) * h);
  const y1 = Math.floor((rect ? rect[3] : 0.66) * h);

  const hist = new Uint32Array(256);
  let sum = 0, n = 0, lit = 0, peak = 0, clip = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * w + x) * ch;
      const l = ((data[i] + data[i + 1] + data[i + 2]) / 3) | 0;
      hist[l]++;
      sum += l; n++;
      if (l > 10) lit++;
      if (l > peak) peak = l;
      if (l >= 248) clip++;
    }
  }

  const at = (q) => {
    let want = q * n, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= want) return i; }
    return 255;
  };

  return {
    meanLuma: +(sum / n).toFixed(2),
    percentLit: +((lit / n) * 100).toFixed(1),
    peak,
    clip: +((clip / n) * 100).toFixed(2),
    spread: at(0.90) - at(0.10),
  };
}

/**
 * What one fixture did to a frame, pixel by pixel.
 *
 * Two shots from an identical camera with only the chest moved, so every pixel
 * that changed changed because of the chest. This is the findability number
 * that survives the room it is standing in: a ratio of patch means says a chest
 * is twice as findable in a dark hall as in a lit gallery, which is a fact
 * about the halls and not about the chest.
 */
function diff(a, b, rect) {
  const w = a.w, h = a.h;
  const x0 = Math.floor((rect ? rect[0] : 0) * w);
  const x1 = Math.floor((rect ? rect[2] : 1) * w);
  const y0 = Math.floor((rect ? rect[1] : 0) * h);
  const y1 = Math.floor((rect ? rect[3] : 0.66) * h);

  let n = 0, changed = 0, gain = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x += 2) {
      const ia = (y * w + x) * a.ch;
      const ib = (y * w + x) * b.ch;
      const la = (a.data[ia] + a.data[ia + 1] + a.data[ia + 2]) / 3;
      const lb = (b.data[ib] + b.data[ib + 1] + b.data[ib + 2]) / 3;
      n++;
      if (la - lb >= 12) { changed++; gain += la - lb; }
    }
  }

  return {
    changedPct: +((changed / n) * 100).toFixed(2),
    lift: changed ? +(gain / changed).toFixed(1) : 0,
  };
}

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
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
window.__B__ = {
  async frames(n) {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  },

  /**
   * Advance the chest's own clock without rendering.
   *
   * dt is the delta clamp the frame loop itself uses, so a pumped second and a
   * played second are the same second. \`elapsed\` is threaded through because
   * the jingle interval and the idle breath both read it.
   */
  pump(seconds, dt = 1 / 20) {
    const g = window.__SANDS__;
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) {
      window.__B__.clock += dt;
      g.mysterybox.update(dt, window.__B__.clock);
    }
    return g.mysterybox.state.phase;
  },
  clock: 1000,

  /** Pump until the chest reaches a phase, or give up. Returns seconds spent. */
  pumpUntil(phase, limit = 40) {
    const g = window.__SANDS__;
    let spent = 0;
    while (g.mysterybox.state.phase !== phase && spent < limit) {
      window.__B__.pump(1 / 20);
      spent += 1 / 20;
    }
    return +spent.toFixed(2);
  },

  /** Stand a given distance out along a fixture's facing and look back at it. */
  face(x, z, rot, dist = 3.2, pitch = 0.06) {
    const g = window.__SANDS__;
    const fx = -Math.sin(rot), fz = -Math.cos(rot);
    g.player.teleport({ x: x + fx * dist, y: 0, z: z + fz * dist });
    g.rig.reset(rot + Math.PI, pitch);
    g.rig.update(1 / 60, g.player, false);
  },

  /** Stand in front of whichever placement is live. */
  faceBox(dist = 3.4, pitch = 0.06) {
    const rec = window.__SANDS__.mysterybox.record;
    window.__B__.face(rec.x, rec.z, rec.rot || 0, dist, pitch);
    return { x: rec.x, z: rec.z, spawn: rec.config.spawn };
  },

  hud() {
    const p = document.getElementById('prompt');
    return {
      gold: document.querySelector('[data-gold]').textContent,
      weapon: document.querySelector('[data-weapon]').textContent,
      prompt: p.textContent,
      promptOn: p.classList.contains('on'),
      promptDeny: p.classList.contains('deny'),
    };
  },

  async press() {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    await window.__B__.frames(2);
  },

  /**
   * Which weapon mark the chest is SHOWING, straight off the fixture.
   *
   * The state machine's schedule proves what the roll intended. This proves
   * what the chest put on the plate, and the two are only the same thing if
   * the wiring between them works.
   */
  token() {
    const rec = window.__SANDS__.mysterybox.record;
    return rec && rec.visuals ? rec.visuals.token : null;
  },

  /**
   * How square-on the reveal plate lands, measured in SCREEN SPACE.
   *
   * The plate is authored 2.3 wide by 1.5 high, so face-on it projects at about
   * 1.53 wide for tall. Turned away it foreshortens toward zero while its
   * height barely changes, and turned all the way round it foreshortens through
   * zero and comes back - so the aspect alone would not tell a front from a
   * back. The dot of the plate's own normal against the direction to the camera
   * settles that: positive is the face, negative is the back of a slab of
   * granite, and it is the number that would have caught the half-turn.
   *
   * Both are computed from the live object through the live camera. Nothing
   * here reimplements the aiming maths, so agreeing with it proves nothing and
   * disagreeing with it means the player is looking at the wrong side.
   */
  markFacing() {
    const g = window.__SANDS__;
    const rec = g.mysterybox.record;
    const mark = rec && rec.visuals && rec.visuals.mark;
    if (!mark || !mark.visible) return null;

    const { THREE, camera } = g;
    camera.updateMatrixWorld(true);
    mark.updateMatrixWorld(true);

    const project = (x, y) => {
      const v = new THREE.Vector3(x, y, 0).applyMatrix4(mark.matrixWorld).project(camera);
      return v;
    };

    const l = project(-1.15, 0), r = project(1.15, 0);
    const t = project(0, 0.75), b = project(0, -0.75);

    // Aspect in pixels, so the projection's own x/y scaling is accounted for.
    const px = (v) => [v.x * 720, v.y * 430];
    const [lx, ly] = px(l), [rx, ry] = px(r), [tx, ty] = px(t), [bx, by] = px(b);
    const width = Math.hypot(rx - lx, ry - ly);
    const height = Math.hypot(bx - tx, by - ty);

    // The plate's face is its local -Z, the same convention every fixture keeps.
    const normal = new THREE.Vector3(0, 0, -1)
      .transformDirection(mark.matrixWorld).normalize();
    const toCam = new THREE.Vector3()
      .setFromMatrixPosition(camera.matrixWorld)
      .sub(new THREE.Vector3().setFromMatrixPosition(mark.matrixWorld))
      .normalize();

    return {
      aspect: +(width / Math.max(1e-6, height)).toFixed(2),
      facing: +normal.dot(toCam).toFixed(3),
    };
  },

  /** Everything about the chest, in one read. */
  snap() {
    const g = window.__SANDS__;
    const b = g.mysterybox;
    return {
      phase: b.state.phase,
      spawn: b.state.spawn,
      offer: b.state.offer,
      offerLeft: +b.state.offerLeft.toFixed(2),
      pulls: b.state.pulls,
      coldAt: b.state.coldAt,
      pullsTotal: b.state.pullsTotal,
      taken: b.state.taken,
      left: b.state.left,
      relocations: b.state.relocations,
      denied: b.state.denied,
      gold: g.economy.gold,
      owned: [...g.weapons.state.owned],
      current: g.weapons.state.current,
      present: b.placements.map((r) => (r.visuals ? r.visuals.present : null)),
      spawns: b.placements.map((r) => r.config.spawn),
    };
  },
};
`,
});

const shots = [];

/**
 * Render, photograph, and measure THE PHOTOGRAPH.
 *
 * One screenshot, decoded once, measured as many times as the caller likes.
 * The frame figure is the upper two thirds; the patch figure is the centre,
 * which is where the fixture being looked at actually is. The decoded image
 * comes back so findability can diff two of them.
 */
async function shoot(name, label, rect = CENTRE) {
  await page.evaluate(() => window.__B__.frames(3));
  const buf = await page.screenshot({ timeout: 90000 });
  writeFileSync(`${OUT}${name}.png`, buf);

  const img = decodePNG(buf);
  const frame = luma(img);
  const patch = luma(img, rect);

  shots.push({ name, label, ...frame, patchLuma: patch.meanLuma });
  return { img, frame, patch, ...frame };
}

/** The centre of the screen, where the fixture being looked at actually is. */
const CENTRE = [0.30, 0.22, 0.70, 0.72];

// ---------------------------------------------------------------------------
// 0. into the pyramid, and hold the map still
// ---------------------------------------------------------------------------

const opening = await page.evaluate(async () => {
  const g = window.__SANDS__;

  g.combat.state.invulnerable = true;
  g.director.reset();

  g.doors.byId('courtyard/entry').open();
  g.spaces.enter('interior', { x: 0, z: -143.5, rot: 0 });

  // Every gate open, so all three placements are reachable and photographable.
  // The go-cold mechanic sends the chest behind the 1250 gate whether or not
  // the player has bought it, which is the point, and is not this file's
  // subject.
  for (const b of g.interior.barriers) b.open();
  g.interior.setPowered(true);

  await window.__B__.frames(3);

  const b = g.mysterybox;
  return {
    space: g.spaces.active,
    placements: b.placements.length,
    spawns: b.placements.map((r) => r.config.spawn),
    costs: b.placements.map((r) => r.config.cost),
    pool: b.POOL,
    // The stock list against the marks world/build.js actually built. A weapon
    // in the pool with no chalk entry presents a blank plate, and the failure is
    // invisible in every state assertion there is.
    tokenIds: b.placements[0].visuals.tokenIds,
    poolHasMarks: b.POOL.every((id) => b.placements[0].visuals.tokenIds.includes(id)),
    startingOwned: [...g.weapons.state.owned],
    boltReachable: g.weapons.owns('bolt'),
    sunspearReachable: g.weapons.owns('sunspear'),
    coldAt: b.state.coldAt,
    startingSpawn: b.state.spawn,
  };
});

// ---------------------------------------------------------------------------
// 1. exactly one chest is awake, and the other two plinths say nothing
// ---------------------------------------------------------------------------

const placement = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.mysterybox.placeAt('A');
  await window.__B__.frames(2);

  const b = g.mysterybox;
  const present = b.placements.map((r) => r.visuals.present);

  // Look at a plinth that is NOT the live one. Silence is the correct output:
  // there is nothing wrong here and nothing on offer, and a red prompt would be
  // two thirds of the map telling the player off for walking past.
  const dormant = b.placements.find((r) => r.config.spawn !== 'A');
  window.__B__.face(dormant.x, dormant.z, dormant.rot || 0, 3.4);
  await window.__B__.frames(3);

  return {
    present,
    liveSpawn: b.state.spawn,
    dormantSpawn: dormant.config.spawn,
    dormantCandidate: g.interacts.candidate && g.interacts.candidate.config.spawn,
    dormantPrompt: document.getElementById('prompt').textContent,
    dormantPromptOn: document.getElementById('prompt').classList.contains('on'),
  };
});

// ---------------------------------------------------------------------------
// 2. the closed chest, at spawn A: the prompt, and whether it can be FOUND
// ---------------------------------------------------------------------------

const closed = await page.evaluate(async () => {
  const g = window.__SANDS__;

  // RICH FIRST, and this line is the whole of what "the price is not red when
  // rich" was failing on. The run starts on 500 gold and a pull costs 950, so
  // the prompt read here was the AFFORDABILITY REFUSAL, correctly red, being
  // asserted not-red. systems/mysterybox.js's describe() is the same
  // `deny: !afford` that wallbuy.js and doors.js draw - it was never the thing
  // that was wrong. The next section takes the money away again and asserts the
  // red state on purpose.
  g.economy.reset(2000);

  const at = window.__B__.faceBox(3.4);
  await window.__B__.frames(3);

  return {
    at,
    gold: g.economy.gold,
    candidate: g.interacts.candidate && g.interacts.candidate.type,
    ...window.__B__.hud(),
  };
});

await shoot('box-01-closed-A', 'Hall of Offerings: the chest closed, spawn A');

// ---------------------------------------------------------------------------
// 3. broke: the price goes red, F takes nothing
// ---------------------------------------------------------------------------

const broke = await page.evaluate(async () => {
  const g = window.__SANDS__;

  g.economy.reset(100);
  await window.__B__.frames(3);

  const before = window.__B__.hud();
  const deniedBefore = g.mysterybox.state.denied;

  await window.__B__.press();

  return {
    prompt: before.prompt,
    deny: before.promptDeny,
    quotesNoKey: !/\[F\]/.test(before.prompt),
    goldAfter: g.economy.gold,
    phase: g.mysterybox.state.phase,
    denied: g.mysterybox.state.denied - deniedBefore,
  };
});

await shoot('box-02-cannot-afford', 'spawn A: 950 quoted in red on 100 gold');

// ---------------------------------------------------------------------------
// 4. the pull, through the real key handler, and the debit
// ---------------------------------------------------------------------------

const pulled = await page.evaluate(async () => {
  const g = window.__SANDS__;

  g.economy.reset(2000);
  await window.__B__.frames(3);

  const promptBefore = document.getElementById('prompt').textContent;
  const denyBefore = document.getElementById('prompt').classList.contains('deny');
  const goldBefore = g.economy.gold;

  await window.__B__.press();

  return {
    promptBefore,
    denyBefore,
    goldBefore,
    goldAfter: g.economy.gold,
    spent: goldBefore - g.economy.gold,
    phase: g.mysterybox.state.phase,
    pulls: g.mysterybox.state.pulls,
    offer: g.mysterybox.state.offer,
  };
});

// Mid-roll. Pumped to a chosen instant rather than photographed whenever the
// software renderer happened to get round to it: the difference between a
// screenshot of the cycle and a screenshot of an animation that already ended.
const rolling = await page.evaluate(async () => {
  const g = window.__SANDS__;
  window.__B__.pumpUntil('rolling');
  window.__B__.pump(1.6);
  window.__B__.faceBox(4.2, 0.14);
  await window.__B__.frames(3);

  return {
    phase: g.mysterybox.state.phase,
    prompt: document.getElementById('prompt').textContent,
    deny: document.getElementById('prompt').classList.contains('deny'),
  };
});

const rollShot = await shoot('box-03-rolling-A', 'spawn A: open, beam up, marks cycling');
const rollPatch = rollShot.patch;

// The settle. The roll has to land ON the weapon that was drawn before the
// cycle started, or the whole sequence is decoration over a coin flip.
const settled = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const drawn = g.mysterybox.state.offer;

  const reachedIn = window.__B__.pumpUntil('settling');
  const reached = g.mysterybox.state.phase;

  // Photographed at the END of the settle, where the mark is fully risen and
  // has stopped turning. Three rendered frames is 0.15 simulated seconds, which
  // can tip a 0.9-second phase over into the next one - so the phase that is
  // asserted is the one the pump ARRIVED at, and the frame is allowed to be a
  // fraction of a second later than the assertion.
  window.__B__.pump(0.85);
  window.__B__.faceBox(4.2, 0.14);
  await window.__B__.frames(3);

  return {
    reachedIn,
    drawn,
    reached,
    phase: g.mysterybox.state.phase,
    offer: g.mysterybox.state.offer,
    landedOnDraw: g.mysterybox.state.offer === drawn,
    inPool: g.mysterybox.POOL.includes(g.mysterybox.state.offer),
    notThePistol: g.mysterybox.state.offer !== 'mk9',
    offerLeft: +g.mysterybox.state.offerLeft.toFixed(2),
    prompt: document.getElementById('prompt').textContent,
    deny: document.getElementById('prompt').classList.contains('deny'),
    ...window.__B__.markFacing(),
  };
});

const revealShot = await shoot('box-04-reveal-A', 'spawn A: the roll settled, one weapon presented');
const revealPatch = revealShot.patch;

// ---------------------------------------------------------------------------
// 4b. THE ROLL ITSELF, timed off the mark the chest actually showed
// ---------------------------------------------------------------------------

/**
 * The roll is the mechanic. Everything else here is a shop.
 *
 * The old check for this pumped a roll that was ALREADY MOSTLY OVER - the
 * section above spends 1.6 of its 3.1 seconds, and the rendered frames of two
 * screenshots eat more - and then asserted that reaching the settle took over
 * three seconds. It could not: there were not three seconds left to spend. So
 * this measures a roll of its own, from nothing, and it measures the two things
 * that make a roll a moment rather than a slot machine printing a name:
 *
 *   HOW LONG it takes from paying to landing, in simulated seconds.
 *   WHETHER IT SLOWS, by watching the mark on the plate change and comparing
 *   the last gap to the first. Linear cycling reads as the animation running
 *   out of frames; a real deceleration ends with three or four marks the player
 *   can individually read, and that is where the tension is.
 *
 * Pumped at 1/240 rather than the frame delta so a 55-millisecond gap at the
 * start of the cycle is resolvable at all. Nothing is rendered, so it is free.
 */
const cadence = await page.evaluate(() => {
  const g = window.__SANDS__;
  const b = g.mysterybox;

  window.__B__.pumpUntil('idle', 60);
  b.placeAt('A');
  window.__B__.pumpUntil('idle');
  g.economy.reset(5000);

  const paidAt = b.buy(b.record);
  const dt = 1 / 240;
  const changes = [];
  let last = window.__B__.token();
  let t = 0;

  while (b.state.phase !== 'settling' && t < 12) {
    window.__B__.clock += dt;
    b.update(dt, window.__B__.clock);
    t += dt;

    const tok = window.__B__.token();
    if (tok !== last) { changes.push(+t.toFixed(3)); last = tok; }
  }

  const gaps = [];
  for (let i = 1; i < changes.length; i++) gaps.push(+(changes[i] - changes[i - 1]).toFixed(3));

  const head = gaps.slice(0, 3);
  const tail = gaps.slice(-3);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

  return {
    paid: paidAt === true,
    secondsToLand: +t.toFixed(2),
    landedOn: b.state.offer,
    showing: window.__B__.token(),
    marks: changes.length,
    firstGaps: head,
    lastGaps: tail,
    slowdown: +(avg(tail) / Math.max(0.001, avg(head))).toFixed(2),
    // The last few have to be individually readable. A quarter of a second is
    // about the floor for "I saw that one go past" at this size.
    gaps,
    finalGap: gaps.length ? gaps[gaps.length - 1] : 0,
    // Never speeds back up. The tolerance is TWO SAMPLE STEPS and it has to be:
    // a gap found by polling at 1/240 is only known to within one step at each
    // end, so two adjacent 55-millisecond gaps at the head of the cycle can
    // legitimately measure 0.058 and 0.054 while the schedule that produced
    // them is flat. Anything tighter is testing the sampler.
    monotonic: gaps.every((v, i) => i === 0 || v >= gaps[i - 1] - (1 / 120)),
  };
});

// ---------------------------------------------------------------------------
// 5. take it. The weapon has to end up IN THE HANDS, not in an inventory.
// ---------------------------------------------------------------------------

const taken = await page.evaluate(async () => {
  const g = window.__SANDS__;

  const offer = g.mysterybox.state.offer;
  const ownedBefore = [...g.weapons.state.owned];
  const goldBefore = g.economy.gold;

  await window.__B__.press();
  await window.__B__.frames(2);

  return {
    offer,
    ownedBefore,
    owned: g.weapons.owns(offer),
    inHand: g.weapons.state.current === offer,
    hudWeapon: document.querySelector('[data-weapon]').textContent,
    magFull: g.weapons.ammo[offer].mag === g.weapons.STATS[offer].magazine,
    free: g.economy.gold === goldBefore,
    taken: g.mysterybox.state.taken,
    phase: g.mysterybox.state.phase,
  };
});

await shoot('box-05-taken-A', 'spawn A: the weapon taken, chest closing');

// ---------------------------------------------------------------------------
// 6. leave it. The timeout has to be real, and it has to cost nothing.
// ---------------------------------------------------------------------------

const leftIt = await page.evaluate(async () => {
  const g = window.__SANDS__;

  window.__B__.pumpUntil('idle');
  g.economy.reset(2000);

  const rec = g.mysterybox.record;
  const ownedBefore = g.weapons.state.owned.size;
  const takenBefore = g.mysterybox.state.taken;
  const leftBefore = g.mysterybox.state.left;

  g.mysterybox.buy(rec);
  window.__B__.pumpUntil('presenting');

  const offer = g.mysterybox.state.offer;
  const windowAtStart = +g.mysterybox.state.offerLeft.toFixed(2);

  // Half way through the window, the offer is still standing and still takeable.
  window.__B__.pump(3.0);
  const midway = {
    phase: g.mysterybox.state.phase,
    left: +g.mysterybox.state.offerLeft.toFixed(2),
  };

  // Now walk away from it, in the only sense the game has: do nothing.
  const spent = window.__B__.pumpUntil('idle');

  return {
    offer,
    windowAtStart,
    midway,
    spentToIdle: spent,
    phase: g.mysterybox.state.phase,
    ownedUnchanged: g.weapons.state.owned.size === ownedBefore,
    notTaken: g.mysterybox.state.taken === takenBefore,
    leftIncremented: g.mysterybox.state.left === leftBefore + 1,
    offerCleared: g.mysterybox.state.offer === null,
    // The pull was paid for. Leaving the weapon does not refund it, and it must
    // not: the 950 buys the roll, not the gun.
    gold: g.economy.gold,
  };
});

// ---------------------------------------------------------------------------
// 7. the go-cold threshold, and the relocation
// ---------------------------------------------------------------------------

const cold = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const b = g.mysterybox;

  window.__B__.pumpUntil('idle');

  // A fresh placement, so the first run is counted from zero pulls rather than
  // from whatever the sections above left on the counter.
  b.placeAt('A');
  window.__B__.pumpUntil('idle');

  const base = b.state.relocations;
  const runs = [];
  const spawnsSeen = new Set([b.state.spawn]);
  const offered = [];
  const moves = [];

  // Twelve relocations. Enough for the threshold to be seen to vary, enough
  // draws for every weapon in the stock to have turned up, and it costs nothing
  // because none of it is rendered.
  for (let r = 0; r < 12; r++) {
    const spawnBefore = b.state.spawn;
    const threshold = b.state.coldAt;
    let pulls = 0;

    while (b.state.relocations === base + r && pulls < 20) {
      g.economy.grant(1000, 'harness');
      const ok = b.buy(b.record);
      if (!ok) break;
      pulls++;

      window.__B__.pumpUntil('presenting');
      offered.push(b.state.offer);

      // Take every one, so the pool test also proves the grant path works for
      // whatever comes out - including the two weapons no wall sells.
      b.buy(b.record);
      window.__B__.pumpUntil('idle', 60);
    }

    runs.push({ threshold, pulls });
    moves.push({ from: spawnBefore, to: b.state.spawn });
    spawnsSeen.add(b.state.spawn);
  }

  return {
    runs,
    moves,
    everyMoveChangedSpawn: moves.every((m) => m.from !== m.to),
    everyThresholdInRange: runs.every((r) => r.threshold >= 4 && r.threshold <= 8),
    thresholdFiredOnCount: runs.every((r) => r.pulls === r.threshold),
    thresholdsVary: new Set(runs.map((r) => r.threshold)).size > 1,
    spawnsVisited: [...spawnsSeen].sort(),
    relocations: b.state.relocations - base,
    onlyOneAwake: b.placements.filter((p) => p.visuals.present).length,

    offeredKinds: [...new Set(offered)].sort(),
    boltOffered: offered.includes('bolt'),
    sunspearOffered: offered.includes('sunspear'),
    pistolNeverOffered: !offered.includes('mk9'),

    ownsBolt: g.weapons.owns('bolt'),
    ownsSunspear: g.weapons.owns('sunspear'),
    owned: [...g.weapons.state.owned].sort(),
  };
});

// ---------------------------------------------------------------------------
// 8. photograph the go-cold moment: the scarab leaving, the chest going
// ---------------------------------------------------------------------------

const goingCold = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const b = g.mysterybox;

  b.placeAt('B');
  window.__B__.pumpUntil('idle');
  g.economy.reset(20000);

  // Walk the placement up to one pull short of its threshold, cheaply.
  let guard = 0;
  while (b.state.pulls < b.state.coldAt - 1 && guard++ < 20) {
    b.buy(b.record);
    window.__B__.pumpUntil('presenting');
    b.buy(b.record);
    window.__B__.pumpUntil('idle', 60);
  }

  const spawnBefore = b.state.spawn;

  // The pull that ends it.
  b.buy(b.record);
  window.__B__.pumpUntil('presenting');
  b.buy(b.record);
  window.__B__.pumpUntil('cooling', 20);

  /**
   * READ THE BANNER HERE, on the synchronous frame the lid drops on.
   *
   * The notice element is ONE SLOT shared by every system that has something to
   * say, and the wave director is the loudest of them: read two rendered frames
   * later this came back "WAVE 1", which is not the chest failing to speak, it
   * is the chest having been spoken over. The pump is synchronous, so nothing
   * else can have run between the transition into `cooling` and this line.
   */
  const banner = document.getElementById('notice').textContent;

  // A quarter of the way in: the scarab is clear of the chest and the chest is
  // still there. Any later and the photograph is of an empty plinth - and the
  // rendered frames below are themselves simulated time, so this leaves room
  // for the eight of them that follow.
  window.__B__.pump(0.60);

  /**
   * TWO CAMERAS, because the moment says two things and they are said at
   * different distances.
   *
   * The PROMPT is said to whoever is standing at the chest, which is exactly
   * where the player who just spent 950 gold is standing. ui/interact.js reaches
   * 5.5 metres and casts from the crosshair, so a camera six metres back and
   * pitched thirty degrees up - which is what this section used to do, to frame
   * the scarab - is aimed at a wall three metres above a fixture it is already
   * out of range of. It read an empty prompt and called the go-cold moment
   * silent. It is not silent; nobody was standing where it speaks.
   *
   * The NOTICE is the other half, and it is the half that carries across the
   * room: systems/mysterybox.js posts THE CHEST OF THE NAMELESS HAS MOVED to
   * the banner the instant the lid drops, so a player who has already run does
   * not simply find the plinth empty next lap.
   */
  window.__B__.face(b.record.x, b.record.z, b.record.rot || 0, 3.6, 0.02);
  await window.__B__.frames(2);

  const said = {
    candidate: g.interacts.candidate && g.interacts.candidate.type,
    prompt: document.getElementById('prompt').textContent,
    deny: document.getElementById('prompt').classList.contains('deny'),
    notice: banner,
  };

  // Now stand off and look up, for the photograph of the scarab leaving.
  window.__B__.face(b.record.x, b.record.z, b.record.rot || 0, 6.0, 0.30);
  await window.__B__.frames(3);

  return {
    spawnBefore,
    phase: b.state.phase,
    ...said,
  };
});

await shoot('box-06-going-cold-B', 'Great Gallery: the scarab leaving, the chest going cold');

const moved = await page.evaluate(async (before) => {
  const g = window.__SANDS__;
  const b = g.mysterybox;

  window.__B__.pumpUntil('idle', 20);
  await window.__B__.frames(2);

  return {
    spawnBefore: before,
    spawnAfter: b.state.spawn,
    different: b.state.spawn !== before,
    onlyOneAwake: b.placements.filter((p) => p.visuals.present).length,
    awakeIs: b.placements.filter((p) => p.visuals.present)
      .map((p) => p.config.spawn),
    pullsReset: b.state.pulls === 0,
    freshThreshold: b.state.coldAt >= 4 && b.state.coldAt <= 8,
  };
}, goingCold.spawnBefore);

// ---------------------------------------------------------------------------
// 9. all three spawns, photographed, and MEASURED against their own room
// ---------------------------------------------------------------------------

const findability = [];

for (const spawn of ['A', 'B', 'C']) {
  // The chest, seen from six metres: roughly where a player notices a fixture
  // rather than where they buy from.
  const withBox = await page.evaluate(async (s) => {
    const g = window.__SANDS__;
    g.mysterybox.placeAt(s);
    window.__B__.pumpUntil('idle');
    const rec = g.mysterybox.record;
    window.__B__.face(rec.x, rec.z, rec.rot || 0, 6.5, 0.10);
    await window.__B__.frames(4);
    return { room: g.spaces.roomId, x: rec.x, z: rec.z, rot: rec.rot || 0 };
  }, spawn);

  const shot = await shoot(`box-07-${spawn}-present`, `spawn ${spawn}: the chest, from 6.5m`);

  // The same camera, with the chest somewhere else. This is the control, and it
  // is the whole measurement: a fixture is findable if it changes the frame.
  const without = await page.evaluate(async (s) => {
    const g = window.__SANDS__;
    const other = ['A', 'B', 'C'].filter((k) => k !== s)[0];
    const cam = { x: g.player.position.x, z: g.player.position.z, yaw: g.rig.yaw };
    g.mysterybox.placeAt(other);
    window.__B__.pumpUntil('idle');
    g.player.teleport({ x: cam.x, y: 0, z: cam.z });
    g.rig.reset(cam.yaw, 0.10);
    await window.__B__.frames(4);
    return { movedTo: g.mysterybox.state.spawn };
  }, spawn);

  const emptyShot = await shoot(`box-08-${spawn}-empty`, `spawn ${spawn}: the same view, plinth only`);

  /**
   * The per-pixel A/B is the number that decides this, and the patch ratio
   * beside it is context.
   *
   * A ratio of patch means is a measurement of the ROOM as much as of the
   * fixture. The Great Gallery is a lit hall and the Hall of Offerings is not,
   * so the identical chest scores 2.1 in one and 1.3 in the other while being
   * equally impossible to walk past in both. Worse, the ratio REWARDED the one
   * defect worth fixing: a chest whose own lamp clipped it to white scored 2.0
   * everywhere, and dragging it back to a readable object cost it half its
   * score. Counting the pixels the fixture changed, and by how much, cannot be
   * gamed that way and means the same thing in a dark room and a lit one.
   */
  const changed = diff(shot.img, emptyShot.img, CENTRE);

  findability.push({
    spawn,
    room: withBox.room,
    movedTo: without.movedTo,
    frameWith: shot.frame.meanLuma,
    frameWithout: emptyShot.frame.meanLuma,
    patchWith: shot.patch.meanLuma,
    patchWithout: emptyShot.patch.meanLuma,
    patchClip: shot.patch.clip,
    delta: +(shot.patch.meanLuma - emptyShot.patch.meanLuma).toFixed(2),
    ratio: +(shot.patch.meanLuma / Math.max(0.01, emptyShot.patch.meanLuma)).toFixed(2),
    changedPct: changed.changedPct,
    lift: changed.lift,
  });
}

// ---------------------------------------------------------------------------
// 10. a full roll photographed at every spawn, so no room is assumed
// ---------------------------------------------------------------------------

const perSpawn = [];

for (const spawn of ['A', 'B', 'C']) {
  const s = await page.evaluate(async (sp) => {
    const g = window.__SANDS__;
    const b = g.mysterybox;

    b.placeAt(sp);
    window.__B__.pumpUntil('idle');
    g.economy.reset(5000);

    /**
     * STAND THERE FIRST. This ordering is the assertion, not a convenience.
     *
     * systems/mysterybox.js aims the plate once, at the instant the roll lands,
     * at whoever is standing in front of the chest - deliberately, because a
     * plate that tracks the camera every frame is a billboard and a billboard in
     * a room made of stone reads as a bug. This section used to pull, land, and
     * THEN teleport the camera into place, which meant every photograph was of a
     * plate aimed at the previous spawn's camera position: correct code,
     * meaningless shot. Move first, then buy.
     */
    const rec = b.record;
    window.__B__.face(rec.x, rec.z, rec.rot || 0, 4.6, 0.16);
    await window.__B__.frames(2);

    b.buy(b.record);
    window.__B__.pumpUntil('settling');
    const reached = b.state.phase;
    window.__B__.pump(0.85);

    await window.__B__.frames(3);

    return {
      spawn: b.state.spawn,
      room: g.spaces.roomId,
      reached,
      ...window.__B__.markFacing(),
      phase: b.state.phase,
      offer: b.state.offer,
      showing: window.__B__.token(),
      prompt: document.getElementById('prompt').textContent,
    };
  }, spawn);

  const shot = await shoot(`box-09-${spawn}-reveal`, `spawn ${spawn}: the reveal, in its own room`);

  /**
   * READABLE, not merely bright. This is the check that had nothing behind it.
   *
   * The old one asked whether the reveal patch was over 12 mean luminance, and
   * for a fortnight it was over 180 - because the plate, the mark, the beam and
   * the chest were all clipping together into one white rectangle. You could
   * not tell a bolt rifle from a Sunspear in any of the three photographs, and
   * every state assertion around it was green. So:
   *
   *   `clip` is the fraction of the patch pushed past 248. A weapon mark is a
   *   shape; a flare is an area. This ran at 1.0-1.1% and now runs near 0.15%.
   *
   *   `spread` is the 90th percentile minus the 10th. Gold glyph on dark plate
   *   is a wide histogram. A white blob is a narrow one sitting at the top.
   */
  perSpawn.push({
    ...s,
    meanLuma: shot.frame.meanLuma,
    patch: shot.patch.meanLuma,
    peak: shot.patch.peak,
    clip: shot.patch.clip,
    spread: shot.patch.spread,
  });
}

// ---------------------------------------------------------------------------
// 11. the chest in an UNPOWERED pyramid, which is where a player first meets it
// ---------------------------------------------------------------------------

const unpowered = await page.evaluate(async () => {
  const g = window.__SANDS__;

  g.interior.setPowered(false);
  g.mysterybox.placeAt('A');
  window.__B__.pumpUntil('idle');

  const rec = g.mysterybox.record;
  window.__B__.face(rec.x, rec.z, rec.rot || 0, 7.5, 0.08);

  // The power ramp is 1.4 simulated seconds and the interior owns it, so let the
  // real loop carry it rather than assuming it is instant.
  await window.__B__.frames(40);

  return { powered: g.interior.powered, room: g.spaces.roomId };
});

const darkShot = await shoot('box-10-unpowered-A', 'spawn A with the Kindling cold: still findable');
const darkPatch = darkShot.patch;

await browser.close();

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
const IGNORABLE = [/GPU stall due to ReadPixels/, /GL Driver Message/];
const warnings = logs
  .filter((l) => l.startsWith('[warning]'))
  .filter((l) => !IGNORABLE.some((re) => re.test(l)));

const section = (name, v) => { console.log(`--- ${name} ---`); console.log(JSON.stringify(v, null, 2)); };

section('opening', opening);
section('placement', placement);
section('closed chest', closed);
section('cannot afford', broke);
section('pulled', pulled);
section('rolling', { ...rolling, patch: rollPatch });
section('settled', { ...settled, patch: revealPatch });
section('roll cadence', cadence);
section('taken', taken);
section('left it', leftIt);
section('go cold', cold);
section('going cold frame', goingCold);
section('moved', moved);
section('findability', findability);
section('per spawn reveal', perSpawn);
section('unpowered', { ...unpowered, patch: darkPatch, frame: darkShot.frame });

console.log('--- frames ---');
for (const s of shots) {
  console.log(`  ${s.name.padEnd(24)} luma=${String(s.meanLuma).padStart(6)} lit=${String(s.percentLit).padStart(5)}%  ${s.label}`);
}

if (errors.length) { console.log('--- errors ---'); for (const e of errors) console.log(e); }
if (warnings.length) { console.log('--- warnings ---'); for (const w of warnings) console.log(w); }

// An interior lit by point lights is darker than a desert noon, so the floor is
// lower than shot.mjs uses. It is not zero: a room that renders nothing at all
// is the failure this file exists to catch.
const DARK = shots.filter((s) => s.meanLuma < 6 || s.percentLit < 25);

const checks = {
  'three placements exist':          opening.placements === 3,
  'they are A, B and C':             String(opening.spawns) === 'A,B,C',
  'a pull costs 950':                String(opening.costs) === '950,950,950',
  'the stock is six weapons':        opening.pool.length === 6,
  'every stock weapon has a mark':   opening.poolHasMarks === true,
  'the bolt starts unreachable':     opening.boltReachable === false,
  'the Sunspear starts unreachable': opening.sunspearReachable === false,
  'a threshold is drawn at boot':    opening.coldAt >= 4 && opening.coldAt <= 8,
  'the box starts somewhere':        ['A', 'B', 'C'].includes(opening.startingSpawn),

  'exactly one chest is awake':      String(placement.present) === 'true,false,false',
  'a dormant plinth is silent':      placement.dormantPrompt === '' && placement.dormantPromptOn === false,

  'the chest is the look target':    closed.candidate === 'box',
  'the closed chest quotes 950':     /CHEST OF THE NAMELESS - 950 GOLD/.test(closed.prompt),
  'the price is not red when rich':  closed.promptDeny === false,

  'the price goes red when short':   broke.deny === true,
  'a short prompt drops the key':    broke.quotesNoKey === true,
  'F on 100 gold takes nothing':     broke.goldAfter === 100 && broke.phase === 'idle',
  'the refusal was counted':         broke.denied === 1,

  'a pull debits exactly 950':       pulled.spent === 950,
  'the chest opens on the pull':     pulled.phase === 'opening',
  'the pull was counted':            pulled.pulls === 1,
  'a weapon is drawn up front':      !!pulled.offer,

  'the roll runs':                   rolling.phase === 'rolling',
  'the roll says so':                /STIRS/.test(rolling.prompt) && rolling.deny === false,
  'the roll settles':                settled.reached === 'settling',
  'it lands on what was drawn':      settled.landedOnDraw === true,
  'the prize is in the pool':        settled.inPool === true,
  'the prize is never the pistol':   settled.notThePistol === true,
  'the reveal names the weapon':     /^TAKE THE /.test(settled.prompt) && settled.deny === false,
  'the reveal shows a countdown':    /- \d+ +\[F\]$/.test(settled.prompt),
  'the offer is a real window':      settled.offerLeft > 4,

  // The roll, measured on its own. See the note above section 4b.
  'the roll is a real moment':       cadence.paid === true && cadence.secondsToLand > 3,
  'the marks really cycle':          cadence.marks >= 12,
  'the cycle slows into it':         cadence.slowdown > 3 && cadence.monotonic === true,
  'the last marks are readable':     cadence.finalGap > 0.18,
  'and it stops on the prize':       cadence.showing === cadence.landedOn,

  'taking it grants the weapon':     taken.owned === true,
  'taking it puts it in hand':       taken.inHand === true,
  'the HUD names what is held':      taken.hudWeapon.length > 0,
  'it arrives loaded':               taken.magFull === true,
  'taking costs nothing extra':      taken.free === true,
  'the take was counted':            taken.taken === 1,

  'the offer window is finite':      leftIt.windowAtStart > 4 && leftIt.windowAtStart < 12,
  'it is still standing midway':     leftIt.midway.phase === 'presenting' && leftIt.midway.left > 0,
  'leaving it times out':            leftIt.spentToIdle > 0 && leftIt.phase === 'idle',
  'leaving it grants nothing':       leftIt.ownedUnchanged === true && leftIt.notTaken === true,
  'a lapsed offer is counted':       leftIt.leftIncremented === true,
  'the offer is cleared':            leftIt.offerCleared === true,

  'every threshold is 4 to 8':       cold.everyThresholdInRange === true,
  'it goes cold ON the threshold':   cold.thresholdFiredOnCount === true,
  'the threshold varies':            cold.thresholdsVary === true,
  'every move changes spawn':        cold.everyMoveChangedSpawn === true,
  'it reaches more than one room':   cold.spawnsVisited.length >= 2,
  'still exactly one awake':         cold.onlyOneAwake === 1,
  'the pool can produce the bolt':   cold.boltOffered === true,
  'the pool can produce Sunspear':   cold.sunspearOffered === true,
  'the pistol is never stocked':     cold.pistolNeverOffered === true,
  'the bolt reaches the hands':      cold.ownsBolt === true,
  'the Sunspear reaches the hands':  cold.ownsSunspear === true,

  'going cold is a red prompt':      goingCold.phase === 'cooling' && goingCold.deny === true,
  'going cold says so':              /GOES COLD/.test(goingCold.prompt),
  // Across the room as well as at the chest. A player who has already run from
  // the plinth is the one who most needs telling.
  'the room is told it has moved':   /HAS MOVED/.test(goingCold.notice),
  'the chest actually moved':        moved.different === true,
  'one chest awake after the move':  moved.onlyOneAwake === 1,
  'the new placement is fresh':      moved.pullsReset === true && moved.freshThreshold === true,

  'the chest lights its own spot':   findability.every((f) => f.delta > 3),
  'and by a real multiple':          findability.every((f) => f.ratio > 1.25),
  // The A/B that means the same thing in a dark hall and a lit one.
  'it changes the frame it is in':   findability.every((f) => f.changedPct > 3),
  'and changes it by a real amount': findability.every((f) => f.lift > 25),
  'no spawn is a black hole':        findability.every((f) => f.patchWith > 8),
  'no spawn is a white hole':        findability.every((f) => f.patchClip < 0.5),

  'the reveal reads at every spawn': perSpawn.every((p) => p.reached === 'settling' && p.patch > 12),
  'the reveal is not a flare':       perSpawn.every((p) => p.clip < 0.5 && p.peak > 200),
  'the mark has shape on it':        perSpawn.every((p) => p.spread > 90),
  'the plate shows the prize':       perSpawn.every((p) => p.showing === p.offer),
  // Turned TOWARDS whoever paid for it, at every spawn. `facing` is the plate's
  // own normal against the direction to the camera; the half-turn bug put this
  // at about -1.
  'the plate faces the buyer':       settled.facing > 0.8
                                       && perSpawn.every((p) => p.facing > 0.8),
  'and lands square, not edge-on':   settled.aspect > 1.2
                                       && perSpawn.every((p) => p.aspect > 1.2),
  'every spawn names its prize':     perSpawn.every((p) => /^TAKE THE /.test(p.prompt)),
  'findable with the map unlit':     darkPatch.meanLuma > 8 && unpowered.powered === false,

  'no black frames':                 DARK.length === 0,
  'no console errors':               errors.length === 0,
  'no console warnings':             warnings.length === 0,
};

console.log('\n--- checks ---');
let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

if (DARK.length) {
  console.log('--- dark frames ---');
  for (const d of DARK) console.log(`  ${d.name} luma=${d.meanLuma} lit=${d.percentLit}%`);
}

console.log(`\nshots -> ${OUT}`);
console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
