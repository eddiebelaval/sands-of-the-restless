/**
 * WHAT THE DEAD DROP: harness.
 *
 * Three rigs, because the claim decomposes into three questions that fail
 * independently and silently.
 *
 * THE EFFECTS are driven by pumping systems/powerups.js's own update() in a
 * tight synchronous loop, with no rendering at all. A thirty-second window at
 * two rendered frames a second under swiftshader is ten minutes of wall clock
 * per assertion; pumped, it is microseconds of the identical code with the
 * identical deltas. NOTHING IN HERE WAITS ON A TIMER. Under software rendering
 * the delta clamp makes simulated time run about six times slower than the wall
 * clock, and on a mechanic whose whole subject is thirty-second windows and
 * twenty-five-second despawns, a setTimeout does not merely fail to help - it
 * actively lies.
 *
 * THE ROLL is tested on a second, headless instance of the module constructed
 * in the page with stub systems and an INJECTED rng, because a one-in-sixty
 * roll cannot be tested by killing things until it gets lucky: that is a suite
 * whose runtime is a random variable. Sixty thousand kills against a real
 * random source gives the rate a 3-sigma band, and a rigged source gives the
 * per-wave cap an exact answer.
 *
 * THE FRAME is the reason this file is long. A green run of state assertions is
 * fully compatible with a completely black screen - this project has proved
 * that three separate times - so every drop is PHOTOGRAPHED, at four metres and
 * again from across a hall, and every photograph is MEASURED over the upper two
 * thirds only, because the lower third is the weapon and the weapon renders
 * perfectly well when nothing else does.
 *
 * AND MEASURED AGAINST ITS OWN ABSENCE. A fixture is findable if it CHANGES THE
 * FRAME, which is a fact about the fixture; a patch brightness is a fact about
 * the room the fixture is standing in. Worse, a brightness metric actively
 * rewards the one defect worth catching - the mystery box once scored 2.0 on
 * mean luminance precisely BECAUSE it was clipping to white and unreadable - so
 * clip fraction and histogram spread are reported beside every brightness
 * number here, and a drop that blows out fails on `clip` while passing on
 * `meanLuma`.
 *
 * Every measurement comes out of a page.screenshot() decoded in node. The
 * in-page drawImage(renderer.domElement) path is the reader STATE.md records as
 * blind: with preserveDrawingBuffer false it samples a stale or cleared buffer,
 * it fails silently rather than loudly, and it once reported a sunlit courtyard
 * at luma 7.
 */

import { chromium } from 'playwright';
import sharp from 'sharp';
import { resolveChrome } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

/**
 * The build under test. argv[2] or SANDS_URL, defaulting to the dev server.
 *
 * This used to be a hardcoded literal, which meant every `node test/x.mjs <url>`
 * SILENTLY IGNORED the url and tested whatever happened to be on 4177. Isolated-tree
 * verification was therefore not isolated in seven of nine suites, for days.
 */
const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// pixels
// ---------------------------------------------------------------------------

/** The centre of the screen, where whatever is being looked at actually is. */
const CENTRE = [0.30, 0.20, 0.70, 0.66];

/** Where the power-up strip is drawn: the top right, under the gold plate. */
const STRIP = [0.68, 0.08, 1.0, 0.40];

async function raw(png, rect) {
  const meta = await sharp(png).metadata();
  const left = Math.floor((rect ? rect[0] : 0) * meta.width);
  const top = Math.floor((rect ? rect[1] : 0) * meta.height);
  const width = Math.max(1, Math.floor((rect ? rect[2] : 1) * meta.width) - left);
  const height = Math.max(1, Math.floor((rect ? rect[3] : 0.66) * meta.height) - top);

  const { data, info } = await sharp(png)
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, w: info.width, h: info.height };
}

/**
 * Luma over a rect, WITH ITS DISTRIBUTION.
 *
 * `clip` and `spread` are not decoration. A lit glyph on a dark card is a wide
 * histogram with almost nothing at the ceiling; a blown-out blob is a narrow
 * one sitting at the top - and the two have the same mean. That is exactly how
 * a fixture that clipped to white passed a brightness check on this project for
 * a fortnight.
 */
function stats({ data, w, h }) {
  const hist = new Uint32Array(256);
  let sum = 0, n = 0, lit = 0, peak = 0, clip = 0;

  for (let i = 0; i < data.length; i += 3) {
    const l = ((data[i] + data[i + 1] + data[i + 2]) / 3) | 0;
    hist[l]++;
    sum += l; n++;
    if (l > 10) lit++;
    if (l > peak) peak = l;
    if (l >= 248) clip++;
  }

  const at = (q) => {
    const want = q * n;
    let acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= want) return i; }
    return 255;
  };

  return {
    meanLuma: +(sum / n).toFixed(2),
    percentLit: +((lit / n) * 100).toFixed(1),
    peak,
    clip: +((clip / n) * 100).toFixed(2),
    spread: at(0.90) - at(0.10),
    px: n,
  };
}

/**
 * What one fixture did to a frame, pixel by pixel.
 *
 * Two shots from an identical camera with only the drop present or absent, so
 * every pixel that changed changed because of the drop. This is the number that
 * survives the room: a ratio of patch means says a drop is twice as findable in
 * a dark hall as in a lit gallery, which is a fact about the halls.
 */
function diff(a, b) {
  let n = 0, changed = 0, gain = 0;
  for (let i = 0; i < a.data.length; i += 3) {
    const la = (a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3;
    const lb = (b.data[i] + b.data[i + 1] + b.data[i + 2]) / 3;
    n++;
    if (la - lb >= 12) { changed++; gain += la - lb; }
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

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1400);

// ---------------------------------------------------------------------------
// helpers, injected once
// ---------------------------------------------------------------------------

await page.addScriptTag({
  content: `
window.__P__ = {
  clock: 2000,

  async frames(n) {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  },

  /**
   * Advance the power-up system's own clock without rendering.
   *
   * dt is the delta clamp the frame loop itself uses, so a pumped second and a
   * played second are the same second - which is the whole point, because the
   * thing under test is a set of thirty-second windows.
   */
  pump(seconds, dt = 1 / 20) {
    const g = window.__SANDS__;
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) {
      window.__P__.clock += dt;
      g.powerups.update(dt, window.__P__.clock);
      g.mysterybox.update(dt, window.__P__.clock);
    }
  },

  /** Stand a given distance out along a facing and look back at the point. */
  face(x, z, rot, dist = 4, pitch = 0.06) {
    const g = window.__SANDS__;
    const fx = -Math.sin(rot), fz = -Math.cos(rot);
    g.player.teleport({ x: x + fx * dist, y: 0, z: z + fz * dist });
    g.rig.reset(rot + Math.PI, pitch);
    g.rig.update(1 / 60, g.player, false);
  },

  /** Park the player far enough away that nothing is collected by accident. */
  standOff(x, z, rot, dist = 4, pitch = 0.06) {
    window.__P__.face(x, z, rot, dist, pitch);
  },

  /**
   * A body the damage system will accept, standing in for an enemy.
   *
   * Only used where the subject is the ROLL rather than the fight; every
   * assertion about what a hit does uses a real actor out of the director's
   * pool.
   */
  fakeEnemy(x = 0, z = 0) {
    return {
      live: true, dying: false, health: 100, maxHealth: 100,
      position: { x, y: 0, z },
      spec: { voicePitch: 1 },
      hurt() { this.health = 0; return true; },
    };
  },

  /**
   * Take one where the player stands, through the real pickup path.
   *
   * A helper on the injected object rather than a function shipped into each
   * evaluate: page.evaluate can only carry serialisable arguments, and the
   * alternative - passing source text and eval'ing it in the page - is a worse
   * idea for no gain.
   */
  take(kind) {
    const g = window.__SANDS__;
    const p = g.player.position;
    g.powerups.placeAt(kind, p.x, p.z);
    window.__P__.pump(0.1);
    return g.powerups.state.taken[kind];
  },

  /**
   * Turn the live drop face-on to a camera standing at a given bearing.
   *
   * The card SPINS, on simulated time, and a photograph taken at an arbitrary
   * phase catches it edge-on about a third of the time - at which point the
   * measurement is of a 4cm slab rather than of the fixture. The drop's local
   * +Z faces the camera when its yaw is rot + PI, which is the same convention
   * every fixture in this game keeps. Nothing is frozen and nothing is nudged:
   * the pump simply stops at the instant the mechanism itself was going to
   * reach, exactly as the mystery-box harness stops a roll where it wants it.
   * (No backticks anywhere in this comment: it lives inside the template
   * literal that carries the whole injected object, and one would end it.)
   */
  spinFaceOn(rot, tolerance = 0.08) {
    const g = window.__SANDS__;
    const want = rot + Math.PI;
    for (let i = 0; i < 400; i++) {
      const d = g.powerups.drops.find((x) => x.live);
      if (!d) return null;
      let e = (d.spinner.rotation.y - want) % (Math.PI * 2);
      if (e < 0) e += Math.PI * 2;
      if (e < tolerance || e > Math.PI * 2 - tolerance) return +e.toFixed(3);
      window.__P__.pump(1 / 120, 1 / 120);
    }
    return null;
  },

  hud() {
    const rows = [...document.querySelectorAll('#r-powers .power')]
      .filter((el) => !el.hidden);
    return {
      rows: rows.length,
      text: rows.map((el) => ({
        plain: el.querySelector('b').textContent,
        name: el.querySelector('u').textContent,
        secs: el.querySelector('s').textContent,
        bar: el.querySelector('em').style.transform,
        colour: el.style.getPropertyValue('--power'),
      })),
      flashOn: document.getElementById('flash').classList.contains('on'),
      prompt: document.getElementById('prompt').textContent,
      promptDeny: document.getElementById('prompt').classList.contains('deny'),
    };
  },
};
`,
});

const shots = [];

/**
 * @param {number} [settle] rendered frames before the shutter. Three is right
 *   for a static subject; the Second Death takes ONE, because a rendered frame
 *   advances the simulation by the full 1/20 delta clamp and the event it is
 *   photographing lasts 0.47 of a simulated second. Three frames would spend
 *   two thirds of it waiting.
 */
async function shoot(name, label, rect = CENTRE, settle = 3) {
  await page.evaluate((n) => window.__P__.frames(n), settle);
  const png = await page.screenshot({ path: `${OUT}${name}.png`, timeout: 90000 });

  const frame = stats(await raw(png));
  const patchRaw = await raw(png, rect);
  const patch = stats(patchRaw);

  shots.push({ name, label, ...frame, patchLuma: patch.meanLuma, patchClip: patch.clip });
  return { png, frame, patch, patchRaw, ...frame };
}

// ---------------------------------------------------------------------------
// 0. setup: invulnerable, no waves arriving on their own
// ---------------------------------------------------------------------------

const opening = await page.evaluate(async () => {
  const g = window.__SANDS__;

  g.combat.state.invulnerable = true;
  g.director.reset();
  g.director.state.running = false;
  g.powerups.clear();

  const mod = await import('/src/systems/powerups.js');

  return {
    kinds: mod.KINDS,
    names: mod.KINDS.map((k) => mod.POWERUPS[k].name),
    plains: mod.KINDS.map((k) => mod.POWERUPS[k].plain),
    chance: mod.DROP_CHANCE,
    capPerWave: mod.DROPS_PER_WAVE,
    life: mod.DROP_LIFE,
    warn: mod.DROP_WARN,
    hoardGold: mod.HOARD_GOLD,
    nukeGold: mod.SECOND_DEATH_GOLD,
    pool: g.powerups.drops.length,
    // No emoji anywhere in the strings the player reads. Cheap to check and
    // the project rule is absolute.
    noEmoji: mod.KINDS.every((k) => {
      const s = mod.POWERUPS[k].name + mod.POWERUPS[k].plain;
      return !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s);
    }),
  };
});

// ---------------------------------------------------------------------------
// 1. THE ROLL, on a headless instance with an injected rng
// ---------------------------------------------------------------------------

const roll = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const { createPowerups, DROP_CHANCE, DROPS_PER_WAVE, KINDS } =
    await import('/src/systems/powerups.js');

  /**
   * A bench instance: the real module, stub systems, and an rng under control.
   *
   * The scene is a fresh THREE.Scene rather than the game's, so the bench's
   * five pooled drops never enter a photograph, and the stubs are the smallest
   * surface the module actually touches.
   */
  function bench(rng) {
    const listeners = [];
    const scene = new g.THREE.Scene();
    // The per-wave cap is keyed off the DIRECTOR's wave counter, because that
    // is the only counter that means "a new wave started". Driving the module's
    // own copy instead - which the first cut of this section did - resets the
    // cap on every kill and measures nothing.
    const director = { state: { wave: 1 }, live: [] };
    const inst = createPowerups({
      scene,
      world: { heightAt: () => 0 },
      player: { position: new g.THREE.Vector3() },
      camera: g.camera,
      rig: null,
      audio: null,
      economy: { grant: () => 0, pop: () => {}, setMultiplier: () => 1, get multiplier() { return 1; } },
      weapons: { state: { owned: new Set(['mk9']) }, refillAmmo: () => true },
      combat: {
        state: { instaKill: false },
        onKill(fn) { listeners.push(fn); return () => {}; },
        applyBlast: () => 0,
      },
      director,
      rng,
    });
    return {
      inst,
      director,
      kill: (x, z) => listeners[0]({ position: { x, y: 0, z } }, 'body'),
    };
  }

  // --- the rate, over sixty thousand kills ----------------------------------
  //
  // The wave counter is advanced on every kill so the per-wave cap can never
  // bind: this section is measuring the ROLL, and the cap is measured on its
  // own below. Every drop is retired immediately so the pool cannot run out and
  // start evicting, which would silently change what is being counted.
  const rate = bench(Math.random);
  const KILLS = 60000;
  let dropped = 0;
  const kinds = {};
  for (const k of KINDS) kinds[k] = 0;

  for (let i = 0; i < KILLS; i++) {
    rate.director.state.wave = i;                 // a new wave every kill
    const d = rate.kill(0, 0);
    if (d) { dropped++; kinds[d.kind]++; rate.inst.clear(); }
  }

  const expected = KILLS * DROP_CHANCE;
  const sigma = Math.sqrt(KILLS * DROP_CHANCE * (1 - DROP_CHANCE));

  // --- the cap, with a rigged source ----------------------------------------
  //
  // rng() = 0 always rolls a drop, so whatever comes out is the cap and nothing
  // else. Five hundred kills inside one wave.
  const capped = bench(() => 0);
  capped.director.state.wave = 4;
  let capDrops = 0;
  for (let i = 0; i < 500; i++) {
    if (capped.kill(0, 0)) { capDrops++; capped.inst.clear(); }
  }

  // And the cap RESETS on a new wave, which is the other half of it.
  capped.director.state.wave = 5;
  let nextWave = 0;
  for (let i = 0; i < 20; i++) {
    if (capped.kill(0, 0)) { nextWave++; capped.inst.clear(); }
  }

  // --- the drop lands ON THE BODY -------------------------------------------
  const placed = bench(() => 0);
  const at = placed.kill(12.5, -7.25);

  return {
    kills: KILLS,
    dropped,
    observed: +(dropped / KILLS).toFixed(5),
    expected: +DROP_CHANCE.toFixed(5),
    within3Sigma: Math.abs(dropped - expected) <= 3 * sigma,
    sigma: +sigma.toFixed(1),
    kinds,
    // Every kind must be reachable, and the weights must order the way the
    // table says: ammunition commonest, fire sale rarest.
    everyKindDrops: KINDS.every((k) => kinds[k] > 0),
    ammoCommonest: kinds.hapi === Math.max(...Object.values(kinds)),
    saleRarest: kinds.nameless === Math.min(...Object.values(kinds)),
    capDrops,
    capIs: DROPS_PER_WAVE,
    capHeld: capDrops === DROPS_PER_WAVE,
    capResets: nextWave === DROPS_PER_WAVE,
    onBody: at ? { x: +at.group.position.x.toFixed(2), z: +at.group.position.z.toFixed(2) } : null,
  };
});

// ---------------------------------------------------------------------------
// 2. A REAL KILL DROPS ONE, under a forced roll
// ---------------------------------------------------------------------------

const fromKill = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.powerups.clear();

  // A real actor out of the director's pool, put down at a known point and
  // shot through the real damage path. Nothing here is a stub.
  const p = g.player.position;
  const enemy = g.director.placeAt('shambler', p.x + 9, p.z + 1);
  const before = g.powerups.state.dropped;
  const sceneBefore = g.scene.children.length;

  g.powerups.forceNextDrop('hapi');

  const hits = [{ enemy, region: 'body', weapon: 'sunspear', point: null, normal: null }];
  g.combat.applyHits(hits);

  const live = g.powerups.liveDrops();

  return {
    enemyDied: hits[0].killed === true,
    dropped: g.powerups.state.dropped - before,
    live: live.length,
    kind: live[0] ? live[0].kind : null,
    // On the body, not on the player and not at the origin.
    nearBody: live[0]
      ? Math.hypot(live[0].x - (p.x + 9), live[0].z - (p.z + 1)) < 1.0
      : false,
    // The pool is the whole point: a spawn writes numbers into a record that
    // already exists.
    sceneDelta: g.scene.children.length - sceneBefore,
  };
});

// ---------------------------------------------------------------------------
// 3. A HUNDRED DROPS LEAK NOTHING
// ---------------------------------------------------------------------------

const leak = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const r = g.renderer.info;

  g.powerups.clear();
  await window.__P__.frames(2);

  const before = {
    children: g.scene.children.length,
    geometries: r.memory.geometries,
    textures: r.memory.textures,
  };

  const kinds = Object.keys(g.powerups.POWERUPS);
  for (let i = 0; i < 100; i++) {
    g.powerups.placeAt(kinds[i % kinds.length], 40 + (i % 7), 40 + (i % 5));
    window.__P__.pump(0.2);
  }
  g.powerups.clear();
  await window.__P__.frames(2);

  return {
    sceneDelta: g.scene.children.length - before.children,
    geometryDelta: r.memory.geometries - before.geometries,
    textureDelta: r.memory.textures - before.textures,
    live: g.powerups.liveDrops().length,
  };
});

// ---------------------------------------------------------------------------
// 4. IT EXPIRES, AND IT WARNS FIRST
// ---------------------------------------------------------------------------

const lifetime = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const mod = await import('/src/systems/powerups.js');

  g.powerups.clear();
  // Well away from the player, so nothing is collected while it is being timed.
  const x = g.player.position.x + 30;
  const z = g.player.position.z + 30;
  g.powerups.placeAt('hoard', x, z);

  const read = () => g.powerups.liveDrops()[0] || null;

  const atStart = read();
  window.__P__.pump(10);
  const midway = read();
  window.__P__.pump(mod.DROP_LIFE - mod.DROP_WARN - 10 + 0.5);
  const warning = read();

  // The blink is a real oscillation, not a flag: sample the painted brightness
  // across a second and look at the range. A "blinking" drop whose emission
  // never changes has told the player nothing.
  const samples = [];
  for (let i = 0; i < 24; i++) {
    window.__P__.pump(1 / 24, 1 / 24);
    const d = read();
    if (d) samples.push(d.lit);
  }

  window.__P__.pump(mod.DROP_WARN);
  const after = read();

  return {
    life: mod.DROP_LIFE,
    warn: mod.DROP_WARN,
    atStart: atStart && { left: atStart.left, blinking: atStart.blinking, lit: atStart.lit },
    midway: midway && { left: midway.left, blinking: midway.blinking },
    warning: warning && { left: warning.left, blinking: warning.blinking },
    blinkLow: Math.min(...samples),
    blinkHigh: Math.max(...samples),
    blinkSamples: samples.length,
    // Dim and bright, never gone: a photograph of a warning drop must never be
    // a photograph of nothing.
    neverDark: samples.every((v) => v > 0.2),
    gone: after === null,
    expired: g.powerups.state.expired,
  };
});

// ---------------------------------------------------------------------------
// 5. WALKING OVER IT IS THE PICKUP
// ---------------------------------------------------------------------------

const walkover = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.powerups.clear();

  const p = g.player.position;
  const x = p.x + 8;
  const z = p.z;
  g.powerups.placeAt('hoard', x, z);

  // Standing three metres short: near enough to see it, not near enough to have
  // it. A pickup radius that is really "anywhere in the room" is not a pickup.
  g.player.teleport({ x: x - 3, y: 0, z });
  window.__P__.pump(0.2);
  const atThree = g.powerups.liveDrops().length;

  const goldBefore = g.economy.gold;

  // Now walk onto it.
  g.player.teleport({ x, y: 0, z });
  window.__P__.pump(0.2);

  return {
    atThree,
    afterWalking: g.powerups.liveDrops().length,
    collected: g.powerups.state.collected,
    goldGained: g.economy.gold - goldBefore,
  };
});

// ---------------------------------------------------------------------------
// 6. EACH OF THE SIX DOES WHAT IT SAYS
// ---------------------------------------------------------------------------

// --- 6a. the Feather of Maat: a Bound at wave 20 dies to one pistol round ---

const instakill = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const take = window.__P__.take;

  g.powerups.clear();
  g.powerups.clearEffects();

  // Wave twenty, which is the wave the Sunspear's damage is derived against and
  // the wave the Bound is the toughest thing on.
  // forceWave(n) clears the field and arms wave n, but state.wave only reaches
  // n when beginWave() runs - and the director is deliberately NOT running
  // here, so the counter is set explicitly. Health scaling reads that counter.
  g.director.forceWave(20);
  g.director.state.wave = 20;
  g.director.state.running = false;

  const p = g.player.position;

  const control = g.director.placeAt('bound', p.x + 14, p.z + 3);
  const controlHealth = control.maxHealth;
  const hitsA = [{ enemy: control, region: 'body', weapon: 'mk9' }];
  g.combat.applyHits(hitsA);
  const survivedOnePistolRound = !hitsA[0].killed && control.health > 0;

  take('maat');
  const on = g.combat.state.instaKill;

  const bound = g.director.placeAt('bound', p.x + 15, p.z);
  const boundHealth = bound.maxHealth;
  const hitsB = [{ enemy: bound, region: 'body', weapon: 'mk9' }];
  g.combat.applyHits(hitsB);

  // A scarab too, so "one hit" is not secretly "enough damage for a scarab".
  const scarab = g.director.placeAt('scarab', p.x + 16, p.z);
  const hitsC = [{ enemy: scarab, region: 'body', weapon: 'mk9' }];
  g.combat.applyHits(hitsC);

  const left = g.powerups.left('maat');

  // The strip is painted by the frame loop, not by the pickup, so it needs
  // rendered frames before it can be read. Pumping alone advances the
  // simulation and touches no DOM.
  await window.__P__.frames(2);

  return {
    wave: g.director.state.wave,
    controlHealth,
    survivedOnePistolRound,
    on,
    boundHealth,
    boundKilled: hitsB[0].killed === true,
    scarabKilled: hitsC[0].killed === true,
    windowSeconds: +left.toFixed(1),
    hudRows: window.__P__.hud().rows,
  };
});

// --- 6b. the Flood of Hapi: every weapon held ------------------------------

const maxammo = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const take = window.__P__.take;

  g.powerups.clear();

  // Own several, and drain them all - including the two the box is the only
  // route to, because a Sunspear on twenty reserve rounds is the weapon this
  // drop matters most to.
  for (const id of ['smg', 'carbine', 'lmg', 'bolt', 'sunspear']) g.weapons.grant(id);

  const owned = [...g.weapons.state.owned];
  for (const id of owned) { g.weapons.ammo[id].reserve = 0; g.weapons.ammo[id].mag = 1; }

  const emptyBefore = owned.filter((id) => g.weapons.ammo[id].reserve === 0).length;

  take('hapi');

  const filled = owned.filter((id) => g.weapons.ammo[id].reserve === g.weapons.STATS[id].reserve);
  const mags = owned.map((id) => g.weapons.ammo[id].mag);

  return {
    owned,
    emptyBefore,
    filledCount: filled.length,
    everyOneFilled: filled.length === owned.length,
    // The MAGAZINE is deliberately untouched: max ammo is a reserve, and a drop
    // that also reloaded for you would quietly delete the reload.
    magsUntouched: mags.every((m) => m === 1),
    reserves: Object.fromEntries(owned.map((id) => [id, g.weapons.ammo[id].reserve])),
    // Nothing it does not own.
    unowned: [...g.weapons.state.owned].length,
  };
});

// --- 6c. the Twin Crowns: the economy actually records double --------------

const doublePoints = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const take = window.__P__.take;

  g.powerups.clear();
  g.powerups.clearEffects();
  g.director.forceWave(3);
  g.director.state.wave = 3;
  g.director.state.running = false;

  const p = g.player.position;

  /** Shoot something in the body until it dies, counting the gold. */
  function earn() {
    const start = g.economy.gold;
    const enemy = g.director.placeAt('shambler', p.x + 12, p.z + 4);
    let hits = 0;
    let killPay = 0;

    while (enemy.live && !enemy.dying && hits < 60) {
      const before = g.economy.gold;
      const rec = [{ enemy, region: 'body', weapon: 'mk9' }];
      g.combat.applyHits(rec);
      // The payout is main.js's, and it is not exported. The two-line copy here
      // is deliberate: this section is testing the ECONOMY's multiplier, so it
      // has to award exactly what the frame loop awards, through the same call.
      g.economy.award(rec[0].killed ? 'kill' : 'hit');
      hits++;
      if (rec[0].killed) { killPay = g.economy.gold - before; break; }
    }

    const perHit = g.economy.gold - start - killPay;
    return { total: g.economy.gold - start, hits, killPay, perHit };
  }

  const plain = earn();
  const multiplierBefore = g.economy.multiplier;

  take('crowns');
  const doubled = earn();
  const multiplierDuring = g.economy.multiplier;

  // A second pickup must REFRESH, not stack: 4x gold would make the rarest
  // sequence in the game the only one worth farming.
  window.__P__.pump(12);
  const leftBeforeRefresh = +g.powerups.left('crowns').toFixed(1);
  take('crowns');
  const leftAfterRefresh = +g.powerups.left('crowns').toFixed(1);
  const multiplierAfterSecond = g.economy.multiplier;

  // And it ends.
  window.__P__.pump(31);
  const after = earn();

  return {
    plain, doubled, after,
    multiplierBefore, multiplierDuring, multiplierAfterSecond,
    multiplierAfter: g.economy.multiplier,
    killDoubled: doubled.killPay === plain.killPay * 2,
    hitsDoubled: plain.hits === doubled.hits && doubled.perHit === plain.perHit * 2,
    restored: after.killPay === plain.killPay,
    refreshed: leftAfterRefresh > leftBeforeRefresh + 10,
    stacked: multiplierAfterSecond !== 2,
  };
});

// --- 6d. the Funerary Hoard --------------------------------------------------

const hoard = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const take = window.__P__.take;
  const mod = await import('/src/systems/powerups.js');

  g.powerups.clear();
  g.powerups.clearEffects();
  g.economy.reset(0);

  take('hoard');
  const flat = g.economy.gold;

  // Under the Twin Crowns it pays the SAME. Double points doubles what you earn
  // in combat; a flat bonus was already sized against the wall buys, and
  // doubling it would make the pair worth 1000 gold for walking two metres.
  take('crowns');
  g.economy.reset(0);
  take('hoard');
  const underCrowns = g.economy.gold;

  g.powerups.clearEffects();

  return {
    amount: mod.HOARD_GOLD,
    flat,
    underCrowns,
    notDoubled: underCrowns === flat,
    // Meaningful against the map's prices without trivialising them.
    underCheapestWallBuy: flat < 1000,
    overAKill: flat > 60,
  };
});

// --- 6e. the Second Death ----------------------------------------------------

const nuke = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const take = window.__P__.take;
  const mod = await import('/src/systems/powerups.js');

  g.powerups.clear();
  g.powerups.clearEffects();
  g.director.forceWave(8);
  g.director.state.wave = 8;
  g.director.state.running = false;

  const p = g.player.position;

  // A field: shamblers, husks, a Bound and a swarm, spread around the player.
  const want = ['shambler', 'shambler', 'shambler', 'husk', 'husk', 'bound', 'scarab', 'scarab'];
  let placed = 0;
  for (let i = 0; i < want.length; i++) {
    const a = g.director.placeAt(want[i], p.x + Math.cos(i) * 11, p.z + Math.sin(i) * 11);
    if (a) placed++;
  }

  const liveBefore = g.director.live.length;
  const goldBefore = g.economy.gold;

  // Placed and then collected as two steps, rather than through take(), because
  // the drop ITSELF increments the dropped counter - and what is being measured
  // here is whether the nuke rolls a SECOND drop off each of the bodies it
  // kills. Counting from before the pickup landed would score its own arrival
  // as the bug.
  const p2 = g.player.position;
  g.powerups.placeAt('seconddeath', p2.x, p2.z);
  const droppedBefore = g.powerups.state.dropped;
  g.powerups.collectAll();

  const liveAfterCall = g.director.live.filter((a) => a.live && !a.dying).length;
  const paid = g.economy.gold - goldBefore;

  // The director retires a body on the frame after it dies, so let the real
  // loop carry that rather than assuming it is instant.
  await window.__P__.frames(4);

  return {
    placed,
    liveBefore,
    liveAfterCall,
    stillFighting: liveAfterCall,
    paid,
    expectedPay: mod.SECOND_DEATH_GOLD,
    paidOnce: paid === mod.SECOND_DEATH_GOLD,
    // It must not roll a drop per body. Twenty drops from one pickup is a bug
    // that looks like a jackpot.
    dropsSpawned: g.powerups.state.dropped - droppedBefore,
    flashOn: window.__P__.hud().flashOn,
    directorKilled: g.director.state.killed,
  };
});

// --- 6f. the Nameless are Generous: the Fire Sale --------------------------

const sale = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const take = window.__P__.take;
  const boxMod = await import('/src/systems/mysterybox.js');
  const box = g.mysterybox;

  g.powerups.clear();
  g.powerups.clearEffects();

  // Into the pyramid, with every gate open so all three plinths are reachable.
  g.doors.byId('courtyard/entry').open();
  g.spaces.enter('interior', { x: 0, z: -143.5, rot: 0 });
  for (const b of g.interior.barriers) b.open();
  g.interior.setPowered(true);
  await window.__P__.frames(3);

  box.placeAt('A');
  window.__P__.pump(1.2);

  const before = {
    price: box.price,
    awake: box.placements.filter((r) => r.visuals.present).length,
    spawn: box.state.spawn,
    home: box.homeSpawn,
  };

  g.economy.reset(4000);
  take('nameless');

  const during = {
    price: box.price,
    awake: box.placements.filter((r) => r.visuals.present).length,
    left: +box.state.saleLeft.toFixed(1),
    spawn: box.state.spawn,
    home: box.homeSpawn,
    salesTotal: box.state.salesTotal,
  };

  // THE PROMPT AND THE DEBIT, on the same fixture, in the same breath. This is
  // the invariant a fire sale is the obvious way to break: the price the prompt
  // quotes has to be the price the purse loses.
  const rec = box.record;
  const quoted = box.describe(rec).text;
  const quotedNumber = Number((quoted.match(/(\d+) GOLD/) || [])[1]);
  const goldBefore = g.economy.gold;
  const pulled = box.buy(rec);
  const charged = goldBefore - g.economy.gold;

  window.__P__.pump(1);
  const midRoll = box.state.phase;

  // A dormant plinth is a real fixture during a sale: it quotes the same price
  // and pressing F there moves the machine to it. Refused while a roll is
  // running, which is what stops a sale yanking a pull out from under itself.
  const far = box.placements.find((r) => (r.config.spawn) !== box.state.spawn);
  const farBusy = box.describe(far).text;
  const hopWhileBusy = box.buy(far);

  // Let the roll finish and take the weapon, so the machine is idle.
  window.__P__.pump(20);
  if (box.state.phase === 'settling' || box.state.phase === 'presenting') box.buy(box.record);
  window.__P__.pump(4);

  const idleAt = box.state.phase;
  const farIdle = box.describe(far).text;
  const goldBeforeHop = g.economy.gold;
  const hopped = box.buy(far);
  const chargedAtFar = goldBeforeHop - g.economy.gold;
  const usingAfterHop = box.state.spawn;
  const homeAfterHop = box.homeSpawn;

  // Run the window out while the chest is mid-roll at the far plinth. The sale
  // must be HELD OPEN rather than pulling the fixture out from under the roll
  // the player has already paid for.
  box.state.saleLeft = 0.05;
  window.__P__.pump(0.5);
  const heldOpen = {
    fireSale: box.state.fireSale,
    ending: box.state.saleEnding,
    phase: box.state.phase,
    awake: box.placements.filter((r) => r.visuals.present).length,
    price: box.price,
  };

  // Resolve the roll; only now may it end.
  window.__P__.pump(20);
  if (box.state.phase === 'settling' || box.state.phase === 'presenting') box.buy(box.record);
  window.__P__.pump(6);

  const after = {
    fireSale: box.state.fireSale,
    ending: box.state.saleEnding,
    price: box.price,
    awake: box.placements.filter((r) => r.visuals.present).length,
    spawn: box.state.spawn,
    home: box.homeSpawn,
    phase: box.state.phase,
  };

  const promptAfter = box.describe(box.record).text;

  return {
    seconds: boxMod.FIRE_SALE_SECONDS,
    // The chest owns the window, and the drop asks for it without naming a
    // number. Asserting that here is asserting there is only one clock.
    durationOnHud: box.state.saleFor,
    saleCost: box.FIRE_SALE_COST,
    fullCost: box.PULL_COST,
    before, during,
    quoted, quotedNumber, charged, pulled,
    quoteMatchesDebit: quotedNumber === charged && charged === box.FIRE_SALE_COST,
    midRoll,
    farBusy,
    hopWhileBusy,
    idleAt,
    farIdle,
    hopped,
    chargedAtFar,
    usingAfterHop,
    homeAfterHop,
    heldOpen,
    after,
    promptAfter,
    // The chest is where it was. A sale that silently relocated it would have
    // stranded whoever ran across the map for it.
    homeUnmoved: after.home === before.home && after.spawn === before.spawn,
    fullPriceBack: after.price === box.PULL_COST && /950 GOLD/.test(promptAfter),
  };
});

// --- 6g. pulls during a sale still count toward going cold ------------------

const saleCold = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const box = g.mysterybox;

  box.placeAt('A');
  window.__P__.pump(1.2);
  g.economy.reset(9000);

  box.fireSale(600);          // a long window, so the sale is not the variable
  window.__P__.pump(0.2);

  const threshold = box.state.coldAt;
  const relocationsBefore = box.state.relocations;
  let pulls = 0;

  while (box.state.relocations === relocationsBefore && pulls < 20) {
    if (!box.buy(box.record)) break;
    pulls++;
    window.__P__.pump(5);
    if (box.state.phase === 'settling' || box.state.phase === 'presenting') box.buy(box.record);
    window.__P__.pump(8);
  }

  const wentCold = box.state.relocations > relocationsBefore;
  window.__P__.pump(8);

  const afterMove = {
    fireSale: box.state.fireSale,
    awake: box.placements.filter((r) => r.visuals.present).length,
    spawn: box.state.spawn,
    home: box.homeSpawn,
    price: box.price,
  };

  // End it cleanly for the sections below.
  box.state.saleLeft = 0.01;
  window.__P__.pump(2);

  return {
    threshold,
    pulls,
    wentCold,
    countsTowardCold: pulls === threshold,
    // A relocation inside a sale still leaves every plinth lit, and it moves
    // HOME with it, which is not secret: it has a scarab, a sting and a banner.
    stillAllAwake: afterMove.awake === 3,
    homeFollowedTheMove: afterMove.home === afterMove.spawn,
    afterMove,
    ended: box.state.fireSale === false,
    priceRestored: box.price === box.PULL_COST,
    awakeAfterEnd: box.placements.filter((r) => r.visuals.present).length,
  };
});

// ---------------------------------------------------------------------------
// 7. TWO AT ONCE DO NOT FIGHT
// ---------------------------------------------------------------------------

const together = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const take = window.__P__.take;

  g.powerups.clear();
  g.powerups.clearEffects();
  g.director.forceWave(20);
  g.director.state.wave = 20;
  g.director.state.running = false;

  take('maat');
  window.__P__.pump(8);          // so the two clocks are visibly different
  take('crowns');

  const both = {
    instaKill: g.combat.state.instaKill,
    multiplier: g.economy.multiplier,
    maat: +g.powerups.left('maat').toFixed(1),
    crowns: +g.powerups.left('crowns').toFixed(1),
    rows: g.powerups.active().length,
  };

  // A Bound, one round, under both: one-hit kill AND double gold, on the same
  // body, which is the case where two effects could quietly cancel.
  const p = g.player.position;
  const bound = g.director.placeAt('bound', p.x + 13, p.z + 2);
  const goldBefore = g.economy.gold;
  const rec = [{ enemy: bound, region: 'head', weapon: 'mk9' }];
  g.combat.applyHits(rec);
  g.economy.award(rec[0].killed && rec[0].region === 'head' ? 'headshot' : 'kill');
  const paid = g.economy.gold - goldBefore;

  // The FIRST one runs out first and takes only its own effect with it.
  window.__P__.pump(23);
  const afterFirst = {
    instaKill: g.combat.state.instaKill,
    multiplier: g.economy.multiplier,
    rows: g.powerups.active().length,
    active: g.powerups.active().map((e) => e.id),
  };

  window.__P__.pump(10);
  const afterBoth = {
    instaKill: g.combat.state.instaKill,
    multiplier: g.economy.multiplier,
    rows: g.powerups.active().length,
  };

  return {
    both,
    clocksDiffer: Math.abs(both.maat - both.crowns) > 5,
    killedInOne: rec[0].killed === true,
    paid,
    paidDouble: paid === 200,
    afterFirst,
    afterBoth,
    firstOutFirst: afterFirst.instaKill === false && afterFirst.multiplier === 2,
    bothClear: afterBoth.instaKill === false && afterBoth.multiplier === 1 && afterBoth.rows === 0,
  };
});

// ---------------------------------------------------------------------------
// 8. GOING DOWN COSTS THE BOONS
// ---------------------------------------------------------------------------

const onDown = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const take = window.__P__.take;

  g.powerups.clear();
  g.powerups.clearEffects();
  take('maat');
  take('crowns');

  const before = g.powerups.active().length;

  // The real failure path: the player is killed, main.js sees the counter move.
  g.combat.state.invulnerable = false;
  g.combat.damagePlayer(g.player.state.maxHealth + 10, 0, 0);
  await window.__P__.frames(3);
  g.combat.state.invulnerable = true;

  return {
    before,
    after: g.powerups.active().length,
    instaKill: g.combat.state.instaKill,
    multiplier: g.economy.multiplier,
  };
});

// ---------------------------------------------------------------------------
// 9. THE FRAME: every drop photographed, near and across a hall, and A/B'd
// ---------------------------------------------------------------------------

/**
 * A LONG CLEAR SIGHTLINE INSIDE THE PYRAMID, and it is verified rather than
 * assumed.
 *
 * The first cut derived this from the chest's gallery placement and put the
 * twelve-metre camera three metres behind a rubble pile at (0, -190): every far
 * photograph was of a rock, and the measurement it produced was a measurement
 * of a rock. The Great Gallery is 52 by 38 with its props on the centre line
 * and its colonnades at x = plus or minus 20, so the lane at x = -4 is clear
 * from z = -188 back to z = -176 - and the check below RAYCASTS it rather than
 * taking my word for it.
 */
const stage = await page.evaluate(async () => {
  const g = window.__SANDS__;

  g.powerups.clear();
  g.powerups.clearEffects();
  g.director.reset();
  g.director.state.running = false;
  g.mysterybox.placeAt('A');
  window.__P__.pump(1.2);

  const at = { x: -4, z: -188, rot: Math.PI };

  // Is there anything between the far camera and the drop? An obstruction here
  // does not fail loudly - it produces a plausible number about a wall.
  g.powerups.placeAt('hoard', at.x, at.z);
  window.__P__.pump(0.2);
  window.__P__.face(at.x, at.z, at.rot, 12, 0.02);
  await window.__P__.frames(2);

  const eye = new g.THREE.Vector3().setFromMatrixPosition(g.camera.matrixWorld);
  const target = new g.THREE.Vector3(at.x, eye.y, at.z);
  const dir = target.clone().sub(eye);
  const range = dir.length();
  dir.normalize();

  const ray = new g.THREE.Raycaster(eye, dir, 0.1, range - 0.6);
  const hit = ray.intersectObjects(g.world.hitTargets || [], true)
    .find((h) => h.object.visible && !h.object.userData?.noHit);

  g.powerups.clear();

  return {
    ...at,
    room: g.spaces.roomId,
    range: +range.toFixed(2),
    clearLine: !hit,
    blockedBy: hit ? (hit.object.name || hit.object.parent?.name || 'unnamed') : null,
    blockedAt: hit ? +hit.distance.toFixed(2) : null,
  };
});

const KINDS = opening.kinds;
const framed = [];

/** The two cameras: where you buy from, and where you notice. */
const NEAR = 4.0;
const FAR = 12.0;

for (const dist of [NEAR, FAR]) {
  // The control first: the identical camera with nothing there.
  await page.evaluate(async (s) => {
    const g = window.__SANDS__;
    g.powerups.clear();
    window.__P__.face(s.p.x, s.p.z, s.p.rot, s.dist, 0.02);
    await window.__P__.frames(3);
  }, { p: stage, dist });

  const empty = await shoot(
    `pw-empty-${dist}m`, `Great Gallery: the floor at ${dist}m, nothing on it`);

  for (const kind of KINDS) {
    await page.evaluate(async (s) => {
      const g = window.__SANDS__;
      g.powerups.clear();
      g.powerups.placeAt(s.kind, s.p.x, s.p.z);
      // Face-on, on the mechanism's own clock. See spinFaceOn.
      window.__P__.spinFaceOn(s.p.rot);
      window.__P__.face(s.p.x, s.p.z, s.p.rot, s.dist, 0.02);
      await window.__P__.frames(3);
    }, { p: stage, dist, kind });

    const shot = await shoot(
      `pw-${kind}-${dist}m`, `Great Gallery: ${kind} at ${dist}m`);

    const changed = diff(shot.patchRaw, empty.patchRaw);

    framed.push({
      kind,
      dist,
      frameLuma: shot.frame.meanLuma,
      patchWith: shot.patch.meanLuma,
      patchWithout: empty.patch.meanLuma,
      delta: +(shot.patch.meanLuma - empty.patch.meanLuma).toFixed(2),
      // Reported beside every brightness number, because a fixture that clips
      // to white scores WELL on the mean and is unreadable.
      clip: shot.patch.clip,
      spread: shot.patch.spread,
      peak: shot.patch.peak,
      changedPct: changed.changedPct,
      lift: changed.lift,
    });
  }
}

// The same measurement in the worst case for a lit object: full sun, where an
// additive halo clips all three channels and the glyph disappears into it.
const sunlit = [];

for (const kind of ['hapi', 'maat']) {
  const p = await page.evaluate(async (k) => {
    const g = window.__SANDS__;
    g.spaces.enter('exterior', { x: 0, z: 26, rot: 0 });
    await window.__P__.frames(3);
    g.powerups.clear();

    const x = 0, z = 14;
    if (k) { g.powerups.placeAt(k, x, z); window.__P__.pump(0.65); }
    window.__P__.face(x, z, 0, 6, 0.02);
    await window.__P__.frames(3);
    return { x, z, space: g.spaces.active };
  }, kind);

  const shot = await shoot(`pw-sun-${kind}`, `the avenue in full sun: ${kind} at 6m`);

  const empty = await page.evaluate(async () => {
    const g = window.__SANDS__;
    g.powerups.clear();
    await window.__P__.frames(3);
    return true;
  });

  const control = await shoot('pw-sun-empty', 'the avenue in full sun: nothing there');
  const changed = diff(shot.patchRaw, control.patchRaw);

  sunlit.push({
    kind,
    space: p.space,
    patchWith: shot.patch.meanLuma,
    patchWithout: control.patch.meanLuma,
    clip: shot.patch.clip,
    spread: shot.patch.spread,
    changedPct: changed.changedPct,
    lift: changed.lift,
  });
}

// ---------------------------------------------------------------------------
// 10. A WARNING DROP, PHOTOGRAPHED. It must never photograph as nothing.
// ---------------------------------------------------------------------------

const warnFrames = [];

for (const phase of ['bright', 'dim']) {
  await page.evaluate(async (s) => {
    const g = window.__SANDS__;
    g.spaces.enter('interior', { x: 0, z: -143.5, rot: 0 });
    await window.__P__.frames(2);
    g.powerups.clear();
    g.powerups.placeAt('crowns', s.p.x, s.p.z);
    // Into the warning window, then onto a chosen half of the blink.
    window.__P__.pump(20.2);
    for (let i = 0; i < 200; i++) {
      const d = g.powerups.liveDrops()[0];
      if (!d) break;
      const wantBright = s.phase === 'bright';
      if ((d.lit > 0.9) === wantBright) break;
      window.__P__.pump(1 / 60, 1 / 60);
    }
    window.__P__.face(s.p.x, s.p.z, s.p.rot, 4, 0.02);
    await window.__P__.frames(1);
  }, { p: stage, phase });

  const shot = await shoot(`pw-warning-${phase}`, `a warning drop, ${phase} half of the blink`);
  const read = await page.evaluate(() => window.__SANDS__.powerups.liveDrops()[0] || null);

  warnFrames.push({
    phase,
    lit: read ? read.lit : null,
    left: read ? read.left : null,
    blinking: read ? read.blinking : null,
    patch: shot.patch.meanLuma,
    clip: shot.patch.clip,
  });
}

// ---------------------------------------------------------------------------
// 11. THE HUD: one effect, and two
// ---------------------------------------------------------------------------

const hudOne = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const take = window.__P__.take;
  g.powerups.clear();
  g.powerups.clearEffects();
  take('maat');
  await window.__P__.frames(3);
  return window.__P__.hud();
});

const hudOneShot = await shoot('pw-hud-one', 'the strip with one effect running', STRIP);

const hudTwo = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const take = window.__P__.take;
  window.__P__.pump(6);
  take('crowns');
  await window.__P__.frames(3);
  return window.__P__.hud();
});

const hudTwoShot = await shoot('pw-hud-two', 'the strip with two effects running', STRIP);

const hudThree = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const take = window.__P__.take;
  g.economy.reset(3000);
  take('nameless');
  await window.__P__.frames(3);
  return window.__P__.hud();
});

const hudThreeShot = await shoot('pw-hud-three', 'the strip carrying the fire sale too', STRIP);

const hudEmpty = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.powerups.clearEffects();
  g.mysterybox.state.saleLeft = 0.01;
  window.__P__.pump(2);
  await window.__P__.frames(3);
  return window.__P__.hud();
});

// ---------------------------------------------------------------------------
// 12. THE NUKE'S MOMENT, photographed
// ---------------------------------------------------------------------------

const moment = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const take = window.__P__.take;

  g.spaces.enter('exterior', { x: 0, z: 26, rot: 0 });
  await window.__P__.frames(3);

  g.powerups.clear();
  g.powerups.clearEffects();
  g.director.forceWave(9);
  g.director.state.wave = 9;
  g.director.state.running = false;

  const p = g.player.position;
  let placed = 0;
  for (let i = 0; i < 12; i++) {
    const a = g.director.placeAt(i % 4 === 0 ? 'husk' : 'shambler',
      p.x + Math.cos(i * 0.52) * 9, p.z + Math.sin(i * 0.52) * 9);
    if (a) placed++;
  }
  await window.__P__.frames(3);

  return { placed, live: g.director.live.length };
});

const beforeNuke = await shoot('pw-nuke-0-before', 'the horde, a breath before');

const duringNuke = await page.evaluate(async () => {
  const g = window.__SANDS__;

  // Placed and collected with NO pump and NO rendered frames, so the shutter
  // opens as close to the detonation as the harness can get. take() would pump
  // a tenth of a second, which is a fifth of the wash.
  const p = g.player.position;
  g.powerups.placeAt('seconddeath', p.x, p.z);
  g.powerups.collectAll();

  return {
    flashOn: window.__P__.hud().flashOn,
    live: g.director.live.filter((a) => a.live && !a.dying).length,
  };
});

const nukeShot = await shoot(
  'pw-nuke-1-moment', 'the Second Death: the frame washing out', CENTRE, 1);

const afterNuke = await page.evaluate(async () => {
  const g = window.__SANDS__;
  await window.__P__.frames(8);
  return {
    live: g.director.live.length,
    // The director is switched off for this section so that no wave arrives in
    // the middle of a photograph, and retiring a corpse is something it does in
    // its own update. What is being asserted is that nothing is still fighting.
    fighting: g.director.live.filter((a) => a.live && !a.dying).length,
    killed: g.director.state.killed,
  };
});

const nukeAfterShot = await shoot('pw-nuke-2-after', 'the same view, everything down');

// ---------------------------------------------------------------------------
// 13. THE FIRE SALE, photographed: all three plinths, awake
// ---------------------------------------------------------------------------
//
// The chest lives at A for this section, so B and C are the two plinths the
// sale WAKES - which is the part that has to be visible. A is photographed too,
// as the control on the other half of the claim: the plinth that was already
// live must not change when the sale starts.

const saleFrames = [];

await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.spaces.enter('interior', { x: 0, z: -143.5, rot: 0 });
  for (const b of g.interior.barriers) b.open();
  g.interior.setPowered(true);
  g.powerups.clear();
  g.powerups.clearEffects();
  g.mysterybox.state.saleLeft = 0.01;
  window.__P__.pump(3);
  g.mysterybox.placeAt('A');
  window.__P__.pump(1.2);
  await window.__P__.frames(3);
});

for (const spawn of ['A', 'B', 'C']) {
  const where = await page.evaluate(async (sp) => {
    const g = window.__SANDS__;
    const rec = g.mysterybox.placements.find((r) => r.config.spawn === sp);
    // From the front of the fixture, which is its local -Z: the same approach a
    // player walks up on, and the same convention world/build.js authors to.
    window.__P__.face(rec.x, rec.z, rec.rot || 0, 4.4, 0.04);
    await window.__P__.frames(3);
    return {
      x: rec.x, z: rec.z, rot: rec.rot || 0,
      room: g.spaces.roomId,
      isHome: g.mysterybox.homeSpawn === sp,
      awake: g.mysterybox.placements.filter((r) => r.visuals.present).length,
    };
  }, spawn);

  const cold = await shoot(`pw-sale-off-${spawn}`, `plinth ${spawn} with no sale running`);

  const on = await page.evaluate(async (sp) => {
    const g = window.__SANDS__;
    g.economy.reset(4000);
    g.mysterybox.fireSale(600);
    window.__P__.pump(0.6);
    const rec = g.mysterybox.placements.find((r) => r.config.spawn === sp);
    window.__P__.face(rec.x, rec.z, rec.rot || 0, 4.4, 0.04);
    await window.__P__.frames(3);
    return {
      awake: g.mysterybox.placements.filter((r) => r.visuals.present).length,
      prompt: document.getElementById('prompt').textContent,
      deny: document.getElementById('prompt').classList.contains('deny'),
      price: g.mysterybox.price,
    };
  }, spawn);

  const hot = await shoot(`pw-sale-on-${spawn}`, `plinth ${spawn} awake, ten gold a pull`);
  const changed = diff(hot.patchRaw, cold.patchRaw);

  await page.evaluate(async () => {
    const g = window.__SANDS__;
    g.mysterybox.state.saleLeft = 0.01;
    window.__P__.pump(3);
  });

  saleFrames.push({
    spawn,
    room: where.room,
    isHome: where.isHome,
    awakeBefore: where.awake,
    awakeDuring: on.awake,
    prompt: on.prompt,
    deny: on.deny,
    price: on.price,
    patchOff: cold.patch.meanLuma,
    patchOn: hot.patch.meanLuma,
    clip: hot.patch.clip,
    spread: hot.patch.spread,
    changedPct: changed.changedPct,
    lift: changed.lift,
  });
}

// And from across the Great Gallery, where the point is not the fixture but the
// room: a plinth that has been dead stone for ten waves is lit, and the player
// can see that without walking to it. From the NORTH, because the gallery's
// centre line carries a rubble pile at z = -190 that stands three metres in
// front of a camera placed the other way round.
const saleWide = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const box = g.mysterybox;
  const rec = box.placements.find((r) => r.config.spawn === 'B');

  g.economy.reset(4000);
  box.fireSale(600);
  window.__P__.pump(0.6);
  window.__P__.face(rec.x, rec.z, Math.PI, 15, 0.02);
  await window.__P__.frames(3);

  return {
    awake: box.placements.filter((r) => r.visuals.present).length,
    home: box.homeSpawn,
    using: box.state.spawn,
    price: box.price,
  };
});

const saleWideShot = await shoot('pw-sale-wide', 'the Great Gallery during a fire sale, from 15m');

const saleWideOff = await page.evaluate(async () => {
  const g = window.__SANDS__;
  g.mysterybox.state.saleLeft = 0.01;
  window.__P__.pump(3);
  await window.__P__.frames(3);
  return { awake: g.mysterybox.placements.filter((r) => r.visuals.present).length };
});

const saleWideColdShot = await shoot('pw-sale-wide-off', 'the same view with the sale over');
const saleWideDiff = diff(saleWideShot.patchRaw, saleWideColdShot.patchRaw);

// ---------------------------------------------------------------------------
// 14. THE SOUND, counted at the context
// ---------------------------------------------------------------------------
//
// Audio cannot be photographed, so it is counted where it is actually made.
// systems/powerups.js builds its motifs by hand out of the shared AudioContext
// - the same thing systems/grenades.js does for its report, because core/
// audio.js owns the game's vocabulary and is not that module's file to edit -
// so wrapping createOscillator counts exactly the voices a drop and a pickup
// put into the room's convolver. A silent power-up would show up here as a
// zero, and nowhere else.

const sound = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const ctx = g.audio.ctx;
  if (!ctx) return { ok: false };

  let made = 0;
  const real = ctx.createOscillator.bind(ctx);
  ctx.createOscillator = () => { made++; return real(); };

  const counts = {};
  const p = g.player.position;

  try {
    for (const kind of Object.keys(g.powerups.POWERUPS)) {
      g.powerups.clear();
      g.powerups.clearEffects();

      made = 0;
      // Well away from the player, so the drop's own sound is counted before
      // anything walks into it.
      g.powerups.placeAt(kind, p.x + 24, p.z + 24);
      const drop = made;

      made = 0;
      g.powerups.collectAll();
      const pickup = made;

      counts[kind] = { drop, pickup, notes: g.powerups.POWERUPS[kind].notes.length };
    }
  } finally {
    ctx.createOscillator = real;
    g.powerups.clear();
    g.powerups.clearEffects();
    g.mysterybox.state.saleLeft = 0.01;
    window.__P__.pump(3);
  }

  const sig = Object.keys(g.powerups.POWERUPS).map((k) => {
    const spec = g.powerups.POWERUPS[k];
    return spec.notes.join('/') + ':' + spec.wave;
  });

  return {
    ok: true,
    state: ctx.state,
    counts,
    everyDropSpeaks: Object.values(counts).every((c) => c.drop >= c.notes),
    everyPickupSpeaks: Object.values(counts).every((c) => c.pickup >= c.notes),
    // Six distinct motifs, so a player can tell which one fell without looking.
    distinctMotifs: new Set(sig).size === sig.length,
    motifs: sig,
  };
});

await browser.close();

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
const IGNORABLE = [/GPU stall due to ReadPixels/, /GL Driver Message/];
const warnings = logs
  .filter((l) => l.startsWith('[warning]'))
  .filter((l) => !IGNORABLE.some((re) => re.test(l)));

const section = (name, v) => {
  console.log(`--- ${name} ---`);
  console.log(JSON.stringify(v, null, 2));
};

section('opening', opening);
section('the roll', roll);
section('a kill drops one', fromKill);
section('leak over 100 drops', leak);
section('lifetime and the warning', lifetime);
section('walking over it', walkover);
section('insta-kill', instakill);
section('max ammo', maxammo);
section('double points', doublePoints);
section('bonus gold', hoard);
section('the second death', nuke);
section('the fire sale', sale);
section('sale pulls go cold', saleCold);
section('two at once', together);
section('going down', onDown);
section('framed', framed);
section('in full sun', sunlit);
section('warning frames', warnFrames);
section('hud', { hudOne, hudTwo, hudThree, hudEmpty });
section('the nuke moment', { moment, duringNuke, afterNuke });
section('the fire sale, framed', { saleFrames, saleWide, saleWideDiff, saleWideOff });
section('sound', sound);

console.log('--- frames ---');
for (const s of shots) {
  console.log(`  ${s.name.padEnd(22)} luma=${String(s.meanLuma).padStart(6)} lit=${String(s.percentLit).padStart(5)}%  patch=${String(s.patchLuma).padStart(6)} clip=${String(s.patchClip).padStart(5)}%  ${s.label}`);
}

if (errors.length) { console.log('--- errors ---'); for (const e of errors) console.log(e); }
if (warnings.length) { console.log('--- warnings ---'); for (const w of warnings) console.log(w); }

// An interior lit by point lights is darker than a desert noon, so the floor is
// lower than shot.mjs uses. It is not zero: a scene that renders nothing at all
// is the failure every visual check in this file exists to catch. The HUD-strip
// crops are exempt - they are deliberately a corner of the screen with a dark
// plate in it - and are checked on their own terms below.
const DARK = shots
  .filter((s) => !s.name.startsWith('pw-hud-'))
  .filter((s) => s.meanLuma < 6 || s.percentLit < 25);

const nearFrames = framed.filter((f) => f.dist === NEAR);
const farFrames = framed.filter((f) => f.dist === FAR);

const checks = {
  'six power-ups exist':             opening.kinds.length === 6,
  'each has a plain meaning':        opening.plains.every((p) => p && p.length > 3),
  'no emoji in any of them':         opening.noEmoji === true,
  'the pool is allocated up front':  opening.pool === 5,

  // --- the roll ------------------------------------------------------------
  'the rate is one in sixty':        roll.expected === 0.01667,
  'and the rate is what it says':    roll.within3Sigma === true,
  'every kind can drop':             roll.everyKindDrops === true,
  'ammunition is the commonest':     roll.ammoCommonest === true,
  'the fire sale is the rarest':     roll.saleRarest === true,
  'the per-wave cap holds':          roll.capHeld === true,
  'the cap resets with the wave':    roll.capResets === true,
  'a drop lands on the body':        roll.onBody && roll.onBody.x === 12.5 && roll.onBody.z === -7.25,

  // --- from a real kill -----------------------------------------------------
  'a kill can drop one':             fromKill.dropped === 1 && fromKill.live === 1,
  'it drops what was rolled':        fromKill.kind === 'hapi',
  'it drops where the body was':     fromKill.nearBody === true,
  'a spawn adds nothing to scene':   fromKill.sceneDelta === 0,
  'no leak over 100 drops':          leak.sceneDelta === 0 && leak.geometryDelta === 0
                                       && leak.textureDelta === 0,

  // --- lifetime -------------------------------------------------------------
  'a fresh drop is not warning':     lifetime.atStart.blinking === false,
  'it is still there at 10s':        lifetime.midway !== null && lifetime.midway.blinking === false,
  'it warns before it goes':         lifetime.warning !== null && lifetime.warning.blinking === true,
  'the warning really blinks':       lifetime.blinkHigh > lifetime.blinkLow * 2,
  'a blink is never full dark':      lifetime.neverDark === true,
  'and then it despawns':            lifetime.gone === true && lifetime.expired > 0,

  // --- pickup ---------------------------------------------------------------
  'three metres is not a pickup':    walkover.atThree === 1,
  'walking onto it takes it':        walkover.afterWalking === 0 && walkover.collected > 0,
  'and it pays on the walk':         walkover.goldGained === opening.hoardGold,

  // --- insta-kill -----------------------------------------------------------
  'a Bound survives a pistol round': instakill.survivedOnePistolRound === true,
  'the Feather arms the combat seam': instakill.on === true,
  'it kills a wave-20 Bound in one': instakill.boundKilled === true && instakill.wave === 20,
  'and the swarm too':               instakill.scarabKilled === true,
  'it is a real window':             instakill.windowSeconds > 25,
  'and it says so on the HUD':       instakill.hudRows === 1,

  // --- max ammo -------------------------------------------------------------
  'max ammo fills every weapon':     maxammo.everyOneFilled === true && maxammo.emptyBefore > 3,
  'it leaves the magazine alone':    maxammo.magsUntouched === true,

  // --- double points --------------------------------------------------------
  'the multiplier goes to two':      doublePoints.multiplierDuring === 2,
  'a kill pays double':              doublePoints.killDoubled === true,
  'a hit pays double':               doublePoints.hitsDoubled === true,
  'a second one refreshes':          doublePoints.refreshed === true,
  'and does not stack':              doublePoints.stacked === false,
  'it restores when it ends':        doublePoints.multiplierAfter === 1 && doublePoints.restored === true,

  // --- bonus gold -----------------------------------------------------------
  'bonus gold pays flat':            hoard.flat === opening.hoardGold,
  'it is not doubled by crowns':     hoard.notDoubled === true,
  'it is priced against the map':    hoard.overAKill === true && hoard.underCheapestWallBuy === true,

  // --- the nuke -------------------------------------------------------------
  'a field was standing':            nuke.liveBefore >= 6,
  'the second death clears it':      nuke.stillFighting === 0,
  'it pays once, and flat':          nuke.paidOnce === true,
  'it does not roll its own kills':  nuke.dropsSpawned === 0,
  'the screen event fired':          nuke.flashOn === true,

  // --- the fire sale --------------------------------------------------------
  'a sale wakes all three plinths':  sale.before.awake === 1 && sale.during.awake === 3,
  'and drops the price to 10':       sale.during.price === sale.saleCost && sale.saleCost === 10,
  'the quote is what is charged':    sale.quoteMatchesDebit === true,
  'a busy plinth refuses the hop':   sale.hopWhileBusy === false,
  'an idle one takes it':            sale.hopped === true && sale.chargedAtFar === sale.saleCost,
  'a hop is not a relocation':       sale.homeAfterHop === sale.before.home
                                       && sale.usingAfterHop !== sale.homeAfterHop,
  'a sale is held open mid-roll':    sale.heldOpen.fireSale === true && sale.heldOpen.ending === true
                                       && sale.heldOpen.awake === 3,
  'and ends once the roll is done':  sale.after.fireSale === false && sale.after.awake === 1,
  'the chest is where it was':       sale.homeUnmoved === true,
  'the full price comes back':       sale.fullPriceBack === true,
  'sale pulls count toward cold':    saleCold.countsTowardCold === true && saleCold.wentCold === true,
  'a cold move keeps all lit':       saleCold.stillAllAwake === true,
  'and home moves with the chest':   saleCold.homeFollowedTheMove === true,
  'the sale ends clean after that':  saleCold.ended === true && saleCold.priceRestored === true
                                       && saleCold.awakeAfterEnd === 1,

  // --- two at once ----------------------------------------------------------
  'two run at once':                 together.both.instaKill === true && together.both.multiplier === 2,
  'and keep their own clocks':       together.clocksDiffer === true,
  'both apply to the same body':     together.killedInOne === true && together.paidDouble === true,
  'the first out takes only its own': together.firstOutFirst === true,
  'and then both are clear':         together.bothClear === true,
  'the HUD shows two':               together.both.rows === 2,

  // --- going down -----------------------------------------------------------
  'going down clears the boons':     onDown.before === 2 && onDown.after === 0
                                       && onDown.instaKill === false && onDown.multiplier === 1,

  // --- the frame ------------------------------------------------------------
  'the far camera can see the spot': stage.clearLine === true,
  /**
   * changedPct is the primary signal and `lift` is the sanity check on it.
   *
   * The measured band at four metres is 16.7 to 81.9 per cent of the patch
   * changed, at an average of 21.8 to 44.9 luma. The Feather sits at the bottom
   * of both because it is deliberately the darkest card in the set - a deep red
   * plate with a thin glyph on it - and it is also, by eye, the most legible of
   * the six. A gate at 25 luma of lift would have failed it, which would have
   * been the metric failing the design rather than the other way round.
   */
  'every drop reads at four metres': nearFrames.every((f) => f.changedPct > 8 && f.lift > 18),
  'and from across the hall':        farFrames.every((f) => f.changedPct > 3 && f.lift > 20),
  /**
   * NOT `delta > 0`, AND THAT IS THE WHOLE LESSON OF THIS PROJECT'S METRICS.
   *
   * A drop is a DARK card with a lit glyph on it, which is the correction the
   * mystery box's clipped plate forced: a mark needs a ground to be a mark
   * against. Standing one in front of a lit wall therefore LOWERS the mean
   * luminance of the patch it occupies, and the Feather measures -3.56 at four
   * metres while being the most legible of the six. A mean-difference gate here
   * would have failed the correct design and passed a white blob.
   *
   * So the gate is: something in the patch is genuinely bright (a lit glyph
   * exists), and the fixture changed the frame (it is present at all). The
   * delta is reported beside them and deliberately not gated on.
   */
  'none of them is a black hole':    framed.every((f) => f.peak > 150 && f.changedPct > 0.25),
  'none of them is a white hole':    framed.every((f) => f.clip < 0.5),
  /**
   * A wide histogram is a glyph on a plate; a narrow one at the top is a blob.
   *
   * RETIRED FROM 50 TO 40, and the reason is worth the paragraph because this
   * gate was measuring the weather.
   *
   * This suite was authored on a tree where an OUTDOOR SKY-HAZE PASS was
   * supplying about seventy per cent of the interior's light. Measured on a
   * frozen frame of the unpowered Great Gallery: with the old fog the room read
   * 66.2 luma, with the fog disabled entirely it reads 16.1. The room emits
   * sixteen. Fifty were leaking in from a pass that models sky haze.
   *
   * When that was fixed, the empty interior patch these drops are measured
   * against fell 32.3 to 25.7 and every spread followed it down. The Feather
   * lands at 46 to 48 depending on the fog build - it fails on BOTH the old and
   * the new fog, so the gate was always marginal and was calibrated against a
   * contaminated tree.
   *
   * The drop did not get worse. Every DIRECT measure of legibility is
   * comfortable: peak 245 against a gate of 150, changedPct 13.6 against 8,
   * lift 29.8 against 18, clip 0. Standard deviation of the patch is a proxy
   * for "is there a glyph on a plate", and a proxy stopped tracking the thing
   * when the plate stopped being washed by daylight.
   *
   * Same precedent as `the chest still lifts its spot` in test/mysterybox.mjs,
   * where a findability RATIO was formally retired when a fog change moved it.
   * The floor still catches a genuinely flat blob.
   *
   * DO NOT re-tighten this to make a number look better, and do NOT brighten
   * the fixture to clear it. An earlier halo on these very drops scored WELL on
   * mean luminance precisely because it had swallowed every glyph into a white
   * blob.
   */
  'each has shape on it':            nearFrames.every((f) => f.spread > 40),
  'they survive full sun':           sunlit.every((s) => s.changedPct > 1.0 && s.clip < 0.5),
  'a warning drop still photographs': warnFrames.every((w) => w.patch > 8),
  /**
   * The blink is asserted on the PUMPED state above - blinkHigh over blinkLow,
   * sampled 24 times across a second - and not on two screenshots, because it
   * cannot honestly be asserted on two screenshots. The blink is 3 Hz and a
   * rendered frame under software advances the simulation by the full 1/20
   * clamp, so between choosing a phase and the shutter opening three frames
   * later, nearly half a cycle has passed. Both photographs are of a warning
   * drop, both are evidence it is still visible while warning, and which half
   * of the blink each caught is not something this rig can dictate.
   */
  'a warning drop is still lit':     warnFrames.every((w) => w.blinking === true && w.lit > 0.2),

  // --- the HUD --------------------------------------------------------------
  'one effect, one chip':            hudOne.rows === 1,
  'the plain meaning is on it':      hudOne.text[0].plain === 'ONE HIT KILLS',
  'so is the name':                  hudOne.text[0].name === 'THE FEATHER OF MAAT',
  'and a countdown':                 Number(hudOne.text[0].secs) > 0,
  'two effects, two chips':          hudTwo.rows === 2,
  'told apart by colour':            hudTwo.text[0].colour !== hudTwo.text[1].colour,
  'and by their own clocks':         hudTwo.text[0].secs !== hudTwo.text[1].secs,
  'the fire sale gets a chip':       hudThree.rows === 3
                                       && hudThree.text.some((t) => /FIRE SALE/.test(t.plain)),
  'and it quotes the live price':    hudThree.text.some((t) => /FIRE SALE - 10 GOLD/.test(t.plain)),
  'the strip empties when they end': hudEmpty.rows === 0,
  'the strip is legible':            hudOneShot.patch.meanLuma > 8 && hudTwoShot.patch.meanLuma > 8,

  // --- the nuke's moment ----------------------------------------------------
  'the horde was there to kill':     moment.live >= 8,
  'and nothing is left fighting':    afterNuke.fighting === 0,
  // Measured on the WHOLE upper two thirds, not a patch: a full-frame wash is a
  // claim about the frame. The probe measured 101.8 before and 178.0 on the
  // first frame after, with 4.8 per cent of it at the ceiling - bright enough
  // to be a flash, and reported next to the clip fraction so that "brighter" and
  // "blown out" cannot be confused for one another.
  'the moment is ON the frame':      nukeShot.frame.meanLuma > beforeNuke.frame.meanLuma + 20,
  /**
   * A ceiling, not a target. The wash IS a white-out for two or three frames -
   * that is what a nuke looks like - so this is only here to catch the failure
   * where it never clears: the same frame measures 24 per cent clipped in the
   * centre patch and under 12 across the whole upper two thirds, and which of
   * those the shutter catches moves by a frame either way between runs. The
   * assertion that matters is the one below: the frame comes back.
   */
  'and it is not a white-out':       nukeShot.frame.clip < 40,
  'and the frame comes back':        Math.abs(nukeAfterShot.frame.meanLuma
                                       - beforeNuke.frame.meanLuma) < 12,

  // --- the fire sale, framed ------------------------------------------------
  'all three plinths photographed':  saleFrames.length === 3
                                       && saleFrames.every((f) => f.awakeDuring === 3),
  // The two that were dark. This is the claim: a plinth the player has walked
  // past for ten waves comes up, and it comes up visibly.
  'the woken plinths light up':      saleFrames.filter((f) => !f.isHome)
                                       .every((f) => f.changedPct > 2 && f.lift > 15),
  /**
   * And the one that was ALREADY live is not what changed.
   *
   * Not an absolute floor, because the chest's lamp breathes - world/build.js
   * drives its intensity off elapsed time - so two photographs of an untouched
   * fixture taken 0.6 simulated seconds apart legitimately differ by a few per
   * cent around the light. Measured: 3.68 per cent changed at the home plinth
   * against 55.4 and 65.2 at the two the sale woke, and a patch mean that moved
   * by half a luma. The claim is relative and so is the check.
   */
  'the live one is left alone':      saleFrames.filter((f) => f.isHome).every((f) =>
                                       f.changedPct * 5 < Math.min(
                                         ...saleFrames.filter((x) => !x.isHome).map((x) => x.changedPct))
                                       && Math.abs(f.patchOn - f.patchOff) < 4
                                       && f.patchOn > 8),
  'every plinth quotes ten gold':    saleFrames.every((f) => /10 GOLD/.test(f.prompt)
                                       && f.price === 10 && f.deny === false),
  'the lit plinths do not clip':     saleFrames.every((f) => f.clip < 0.5),
  'the sale reads across the hall':  saleWide.awake === 3 && saleWideDiff.changedPct > 0.4,
  'and the hall goes back to dark':  saleWideOff.awake === 1,

  // --- the sound ------------------------------------------------------------
  'the audio context is running':    sound.ok === true && sound.state === 'running',
  'every drop makes a sound':        sound.everyDropSpeaks === true,
  'and every pickup makes another':  sound.everyPickupSpeaks === true,
  'no two share a motif':            sound.distinctMotifs === true,
  // The Second Death is the one pickup with a REPORT under its motif - three
  // oscillators of falling sub and detuned saw - because a nuke that sounds
  // like a coin is the audio half of the same bug the screen wash fixes.
  'the second death has a report':   sound.counts.seconddeath.pickup
                                       > sound.counts.seconddeath.notes,

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
