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
 */

import { chromium } from '/Users/eddiebelaval/Development/.worktrees/parallax-hotfix-realtime/node_modules/playwright/index.mjs';
import { resolveChrome } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

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
   * Mean luminance and lit coverage.
   *
   * Whole-frame default samples the UPPER TWO THIRDS only. Pass a normalised
   * rect to measure a patch instead, which is how the chest is weighed against
   * the room it is standing in.
   */
  luma(rect) {
    const c = window.__SANDS__.renderer.domElement;
    const sc = document.createElement('canvas');
    sc.width = c.width; sc.height = c.height;
    const ctx = sc.getContext('2d', { willReadFrequently: true });

    return new Promise((resolve) => requestAnimationFrame(() => {
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(0, 0, sc.width, sc.height).data;

      const x0 = Math.floor((rect ? rect[0] : 0) * sc.width);
      const x1 = Math.floor((rect ? rect[2] : 1) * sc.width);
      const y0 = Math.floor((rect ? rect[1] : 0) * sc.height);
      const y1 = Math.floor((rect ? rect[3] : 0.66) * sc.height);

      let sum = 0, n = 0, lit = 0, peak = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * sc.width + x) * 4;
          const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
          sum += l; n++;
          if (l > 10) lit++;
          if (l > peak) peak = l;
        }
      }
      resolve({
        meanLuma: +(sum / n).toFixed(2),
        percentLit: +((lit / n) * 100).toFixed(1),
        peak: +peak.toFixed(0),
      });
    }));
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

async function shoot(name, label) {
  await page.evaluate(() => window.__B__.frames(3));
  const stats = await page.evaluate(() => window.__B__.luma());
  await page.screenshot({ path: `${OUT}${name}.png`, timeout: 90000 });
  shots.push({ name, label, ...stats });
  return stats;
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
  const at = window.__B__.faceBox(3.4);
  await window.__B__.frames(3);

  return {
    at,
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

await shoot('box-03-rolling-A', 'spawn A: open, beam up, marks cycling');
const rollPatch = await page.evaluate(() => window.__B__.luma([0.30, 0.22, 0.70, 0.72]));

// The settle. The roll has to land ON the weapon that was drawn before the
// cycle started, or the whole sequence is decoration over a coin flip.
const settled = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const drawn = g.mysterybox.state.offer;

  const spent = window.__B__.pumpUntil('settling');
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
    spent,
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
  };
});

await shoot('box-04-reveal-A', 'spawn A: the roll settled, one weapon presented');
const revealPatch = await page.evaluate(() => window.__B__.luma([0.30, 0.22, 0.70, 0.72]));

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

  // A third of the way in: the scarab is clear of the chest and the chest is
  // still there. Any later and the photograph is of an empty plinth.
  window.__B__.pump(0.75);
  window.__B__.face(b.record.x, b.record.z, b.record.rot || 0, 6.0, 0.30);
  await window.__B__.frames(3);

  return {
    spawnBefore,
    phase: b.state.phase,
    prompt: document.getElementById('prompt').textContent,
    deny: document.getElementById('prompt').classList.contains('deny'),
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
  const patch = await page.evaluate((r) => window.__B__.luma(r), CENTRE);

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
  const emptyPatch = await page.evaluate((r) => window.__B__.luma(r), CENTRE);

  findability.push({
    spawn,
    room: withBox.room,
    movedTo: without.movedTo,
    frameWith: shot.meanLuma,
    frameWithout: emptyShot.meanLuma,
    patchWith: patch.meanLuma,
    patchWithout: emptyPatch.meanLuma,
    patchPeakWith: patch.peak,
    patchPeakWithout: emptyPatch.peak,
    delta: +(patch.meanLuma - emptyPatch.meanLuma).toFixed(2),
    ratio: +(patch.meanLuma / Math.max(0.01, emptyPatch.meanLuma)).toFixed(2),
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

    b.buy(b.record);
    window.__B__.pumpUntil('settling');
    const reached = b.state.phase;
    window.__B__.pump(0.85);

    const rec = b.record;
    window.__B__.face(rec.x, rec.z, rec.rot || 0, 4.6, 0.16);
    await window.__B__.frames(3);

    return {
      spawn: b.state.spawn,
      room: g.spaces.roomId,
      reached,
      phase: b.state.phase,
      offer: b.state.offer,
      prompt: document.getElementById('prompt').textContent,
    };
  }, spawn);

  const shot = await shoot(`box-09-${spawn}-reveal`, `spawn ${spawn}: the reveal, in its own room`);
  const patch = await page.evaluate((r) => window.__B__.luma(r), CENTRE);
  perSpawn.push({ ...s, meanLuma: shot.meanLuma, patch: patch.meanLuma, peak: patch.peak });
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
const darkPatch = await page.evaluate((r) => window.__B__.luma(r), CENTRE);

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
section('taken', taken);
section('left it', leftIt);
section('go cold', cold);
section('going cold frame', goingCold);
section('moved', moved);
section('findability', findability);
section('per spawn reveal', perSpawn);
section('unpowered', { ...unpowered, patch: darkPatch, frame: darkShot });

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
  'the roll settles':                settled.reached === 'settling' && settled.spent > 3,
  'it lands on what was drawn':      settled.landedOnDraw === true,
  'the prize is in the pool':        settled.inPool === true,
  'the prize is never the pistol':   settled.notThePistol === true,
  'the reveal names the weapon':     /^TAKE THE /.test(settled.prompt) && settled.deny === false,
  'the reveal shows a countdown':    /- \d+ +\[F\]$/.test(settled.prompt),
  'the offer is a real window':      settled.offerLeft > 4,

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
  'the chest actually moved':        moved.different === true,
  'one chest awake after the move':  moved.onlyOneAwake === 1,
  'the new placement is fresh':      moved.pullsReset === true && moved.freshThreshold === true,

  'the chest lights its own spot':   findability.every((f) => f.delta > 3),
  'and by a real multiple':          findability.every((f) => f.ratio > 1.25),
  'no spawn is a black hole':        findability.every((f) => f.patchWith > 8),
  'the reveal reads at every spawn': perSpawn.every((p) => p.reached === 'settling' && p.patch > 12),
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
