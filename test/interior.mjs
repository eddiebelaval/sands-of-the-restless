/**
 * Interior + economy harness.
 *
 * Drives the actual loop the player will: walk down the avenue, look at the
 * sealed doorway, fail to afford it, earn gold by shooting, buy it, watch the
 * slab move, walk through it, and then buy and walk a route through the map.
 *
 * The screenshots are the point. A green run of state assertions is perfectly
 * compatible with a black frame - that is exactly how a room that renders
 * nothing passes a connectivity test - so every shot is measured for mean
 * luminance and lit coverage, and the PNGs are meant to be looked at.
 *
 * Everything that waits, waits on STATE or on FRAMES. Under software rendering
 * a frame takes about a second of wall clock but only ever advances the
 * simulation by the 1/20s delta clamp, so a wall-clock timeout fails systems
 * that are working perfectly.
 */

import { chromium } from 'playwright';
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
window.__H__ = {
  /** Advance n real frames. */
  async frames(n) {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  },

  /** Drive the player's own update directly, so pointer lock is irrelevant. */
  walk(yaw, steps, sprint = true) {
    const g = window.__SANDS__;
    g.rig.reset(yaw, -0.02);
    for (let i = 0; i < steps; i++) {
      g.player.update(1 / 60, { forward: 1, strafe: 0, sprint, jump: false }, yaw);
    }
  },

  /**
   * Put the player somewhere and point them. Harness only.
   *
   * IT SETTLES THE BODY BEFORE RETURNING, and that is not a convenience.
   *
   * teleport() arrives at y = 0 and the controller resolves the floor on the
   * frames that follow - it always has, and while every interior floor WAS y = 0
   * that resolution was a snap of at most a step and finished before anybody
   * looked. It does not any more. World 1's Act 3 sits at y = -6, so a placement
   * in the Canopic Crypt, the Embalming Chamber or the King's Chamber starts the
   * player seven and a half metres in the air and FALLING, at 24 m/s/s, which
   * takes about 0.8 s to land.
   *
   * Measured, before this settle existed: three call sites read a raycast prompt
   * three real frames after placing, the camera was still seven metres over the
   * fixture and aimed level, and four checks failed - the power gate's prompt,
   * the Kindling, the powered gate and the arrival in the King's Chamber - none
   * of them because anything they test was broken. The screenshot taken at the
   * same moment was a dark ceiling and tripped the black-frame gate too.
   *
   * The loop drives the player's own update with no input, so it is the real
   * fall through the real resolver, just finished now instead of over the next
   * second of wall clock. It changes nothing about WHERE a placement lands: a
   * body dropped from y = 0 settles on the same surface it always did, which is
   * why the gallery's ledge tests are unaffected. 180 steps is three simulated
   * seconds, against the 0.8 the deepest drop in the map needs.
   */
  place(x, z, yaw) {
    const g = window.__SANDS__;
    g.player.teleport({ x, y: 0, z });
    g.rig.reset(yaw, -0.02);
    for (let i = 0; i < 180; i++) {
      g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, yaw);
      if (g.player.state.grounded) break;
    }
  },

  pos() {
    const p = window.__SANDS__.player.position;
    return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) };
  },

  /** Count gold popups as they are CREATED. Reading the container later counts
   * nothing: a popup lives one second of wall clock and a software-rendered
   * frame takes about that long, so they are always already gone. */
  watchPops() {
    window.__H__.popCount = 0;
    const box = document.getElementById('gold-pops');
    new MutationObserver((records) => {
      for (const r of records) window.__H__.popCount += r.addedNodes.length;
    }).observe(box, { childList: true });
  },

  hud() {
    return {
      gold: document.querySelector('[data-gold]').textContent,
      prompt: document.getElementById('prompt').textContent,
      promptOn: document.getElementById('prompt').classList.contains('on'),
      promptDeny: document.getElementById('prompt').classList.contains('deny'),
      pops: document.getElementById('gold-pops').children.length,
    };
  },

  /** Mean luminance of the rendered canvas. The black-frame gate. */
  luma() {
    const c = window.__SANDS__.renderer.domElement;
    const sc = document.createElement('canvas');
    sc.width = c.width; sc.height = c.height;
    const ctx = sc.getContext('2d', { willReadFrequently: true });

    return new Promise((resolve) => requestAnimationFrame(() => {
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(0, 0, sc.width, sc.height).data;
      let sum = 0, n = 0, lit = 0;
      // Upper two thirds only: the lower third is the weapon, which renders
      // even when the world does not.
      const rows = Math.floor(sc.height * 0.66);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < sc.width; x += 4) {
          const i = (y * sc.width + x) * 4;
          const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
          sum += l; n++;
          if (l > 10) lit++;
        }
      }
      resolve({ meanLuma: +(sum / n).toFixed(2), percentLit: +((lit / n) * 100).toFixed(1) });
    }));
  },
};
`,
});

const shots = [];

async function shoot(name, label) {
  await page.evaluate(() => window.__H__.frames(3));
  const stats = await page.evaluate(() => window.__H__.luma());
  await page.screenshot({ path: `${OUT}${name}.png` });
  shots.push({ name, label, ...stats });
  return stats;
}

// The horde is live from the first breather, and this suite is about doors and
// rooms rather than about surviving. Left alone, a wave that catches the player
// mid-route drops them to zero, the run resets to wave one, and a door test
// fails for a reason that has nothing to do with doors.
await page.evaluate(() => { window.__SANDS__.combat.state.invulnerable = true; });

// ---------------------------------------------------------------------------
// 1. the purse starts where it should, and the HUD says so
// ---------------------------------------------------------------------------

const opening = await page.evaluate(() => ({
  gold: window.__SANDS__.economy.gold,
  hudGold: document.querySelector('[data-gold]').textContent,
  doors: window.__SANDS__.doors.all.length,
  barriers: window.__SANDS__.interior.barriers.map((b) => `${b.id}:${b.kind}:${b.cost}`),
  interiorHidden: window.__SANDS__.interior.group.visible === false,
  space: window.__SANDS__.spaces.active,
  /**
   * The two Act 3 loop doorways carry `onHard` in rooms.js: they are a
   * 1250-gold debris wall on Hard and nothing at all on the tier this suite
   * runs, which is Normal. The interior is built before the tier is known, so
   * both are BUILT as their Hard form and dissolved by start() - which is why
   * the door count below is ten rather than the eight the map used to have.
   *
   * Counting them is not enough on its own. A build that forgot to dissolve
   * them would have exactly the same ten records and two invisible walls
   * across the ring, so the state is asserted as well as the count.
   */
  hardOnly: window.__SANDS__.interior.barriers
    .filter((b) => b.hardOnly)
    .map((b) => `${b.id}:${b.opened ? 'cleared' : 'SHUT'}`),
  hardOnlyColliders: window.__SANDS__.interior.colliders
    .filter((c) => Math.abs(c.z + 232) < 1.2 && Math.abs(Math.abs(c.x) - 17) < 2.6).length,
}));

// ---------------------------------------------------------------------------
// 2. walk to the sealed doorway
// ---------------------------------------------------------------------------

await page.evaluate(() => window.__H__.walk(0, 700));
await page.evaluate(() => window.__H__.frames(4));

const atDoor = await page.evaluate(() => ({
  pos: window.__H__.pos(),
  candidate: window.__SANDS__.doors.candidate && window.__SANDS__.doors.candidate.id,
  hud: window.__H__.hud(),
}));

await shoot('int-01-at-door', 'looking at the sealed doorway, 500 gold');

// ---------------------------------------------------------------------------
// 3. cannot afford it: F must refuse and take nothing
// ---------------------------------------------------------------------------

const refused = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const before = g.economy.gold;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
  await window.__H__.frames(2);
  return {
    goldBefore: before,
    goldAfter: g.economy.gold,
    denied: g.doors.state.denied,
    opened: g.doors.byId('courtyard/entry').opened,
  };
});

// ---------------------------------------------------------------------------
// 4. earn gold through the real path: fire, hit, get paid
// ---------------------------------------------------------------------------

const earning = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const before = g.economy.gold;
  window.__H__.watchPops();

  // Shooting scenery does not pay any more. The stand-in payout that carried
  // the economy while there was nothing alive in the map went out with the
  // horde's arrival, so earning is tested the way the game earns: put something
  // in front of the player and shoot it.
  //
  // Turned away from the doorway first, because the crosshair is currently on a
  // barrier and a barrier is not a target. The look is restored before the next
  // section, which needs the door back under the crosshair.
  const yaw0 = g.rig.yaw, pitch0 = g.rig.pitch;
  const yaw = yaw0 + Math.PI;
  g.rig.reset(yaw, 0);
  g.rig.update(1 / 60, g.player, false);

  // The avenue is DRESSED. Picking a point seven metres behind the player and
  // trusting it puts the target behind a crate about half the time, and the
  // symptom - a shot that pays nothing - is indistinguishable from a broken
  // payout. So the placement is searched and confirmed with a probe ray before
  // a round is spent on it.
  const THREE = g.THREE;
  const probe = new THREE.Raycaster();
  const centre = new THREE.Vector2(0, 0);
  let target = null;

  for (const dist of [7, 9, 5, 11, 13]) {
    for (const side of [0, -3, 3, -6, 6]) {
      g.director.reset();
      const x = g.player.position.x - Math.sin(yaw) * dist + Math.cos(yaw) * side;
      const z = g.player.position.z - Math.cos(yaw) * dist - Math.sin(yaw) * side;

      const a = g.director.placeAt('shambler', x, z);
      if (!a) continue;
      a.st.speedScale = 0;

      // Aim at the chest rather than trusting a level ray: the courtyard floor
      // is a dune field and seven metres of it is not flat.
      const m = a.rig.meshes[0];
      m.updateWorldMatrix(true, false);
      const e = m.matrixWorld.elements;
      const c = g.player.position;
      g.rig.reset(Math.atan2(-(e[12] - c.x), -(e[14] - c.z)),
        Math.atan2(e[13] - c.y, Math.hypot(e[12] - c.x, e[14] - c.z)));
      g.rig.update(1 / 60, g.player, false);
      g.camera.updateMatrixWorld(true);

      probe.setFromCamera(centre, g.camera);
      probe.far = 120;
      const first = probe.intersectObjects(g.world.hitTargets, true)
        .find((h) => h.object.visible && !h.object.userData?.noHit);

      if (first && first.object.userData?.enemy === a) { target = a; break; }
    }
    if (target) break;
  }

  // An automatic weapon, held down.
  //
  // The pistol fires exactly once on a held trigger, so the whole measurement
  // rode on a single round landing - and the target is a live actor that turns
  // to face the player between the probe and the shot. One frame of that
  // rotation is enough to move a 43 cm chest off the crosshair at thirteen
  // metres, and the run then failed a payout that was working perfectly. A
  // burst removes the coin flip without weakening what is being tested: every
  // round still goes through weapons.update -> applyHits -> payout.
  //
  // GRANTED first, because the player now starts with the MK9 and nothing
  // else: every other weapon is bought off a wall, which is what makes gold a
  // currency rather than a key. Without this, equip() refuses, the pistol stays
  // up, a held trigger fires exactly one semi-automatic round, and a payout
  // that is working perfectly measures zero. What this section tests is the
  // weapons.update -> applyHits -> payout chain, not whether the player has
  // been shopping; wall-buy ownership is tested in test/economy.mjs.
  g.weapons.grant('carbine');
  g.weapons.equip('carbine');

  // The live input flag, so the award runs through the frame loop's own
  // weapons.update -> payout -> economy.award chain rather than a shortcut.
  g.input.state.fire = true;
  await window.__H__.frames(24);
  g.input.state.fire = false;
  await window.__H__.frames(2);

  g.weapons.equip('mk9');
  g.director.reset();
  g.rig.reset(yaw0, pitch0);
  g.rig.update(1 / 60, g.player, false);
  await window.__H__.frames(2);

  return {
    placed: !!target,
    goldBefore: before,
    goldAfter: g.economy.gold,
    gained: g.economy.gold - before,
    earned: g.economy.earned,
    hudGold: document.querySelector('[data-gold]').textContent,
    popsSeen: window.__H__.popCount,
  };
});

await shoot('int-02-earning', 'gold popups over the crosshair');

// ---------------------------------------------------------------------------
// 5. top up and buy the doorway
// ---------------------------------------------------------------------------

const bought = await page.evaluate(async () => {
  const g = window.__SANDS__;

  // Skip the grind, not the purchase. Shooting scenery for the remaining
  // hundreds would take several hundred software-rendered frames and prove
  // nothing that step 4 has not already proved.
  if (g.economy.gold < 1000) g.economy.grant(1000 - g.economy.gold, 'harness');
  await window.__H__.frames(2);

  const promptBefore = document.getElementById('prompt').textContent;
  const denyBefore = document.getElementById('prompt').classList.contains('deny');
  const goldBefore = g.economy.gold;

  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
  await window.__H__.frames(2);

  const door = g.doors.byId('courtyard/entry');
  return {
    promptBefore,
    denyBefore,
    goldBefore,
    goldAfter: g.economy.gold,
    spent: goldBefore - g.economy.gold,
    opening: door.opening,
    doorwayCleared: g.doors.state.doorwayCleared,
    colliders: g.world.colliders.length,
  };
});

await shoot('int-03-door-opening', 'the slab grinding down out of the doorway');

// ---------------------------------------------------------------------------
// 6. walk through, into the pyramid
// ---------------------------------------------------------------------------

const entered = await page.evaluate(async () => {
  const g = window.__SANDS__;

  // Wait for the slab to finish, on STATE.
  let f = 0;
  while (!g.doors.byId('courtyard/entry').opened && f < 200) {
    await new Promise((r) => requestAnimationFrame(r));
    f++;
  }

  const openedAfterFrames = f;
  const posBefore = window.__H__.pos();

  // Walk forward through the doorway. The threshold does the rest.
  window.__H__.walk(0, 60, false);
  await window.__H__.frames(3);

  return {
    openedAfterFrames,
    posBefore,
    posAfter: window.__H__.pos(),
    space: g.spaces.active,
    room: g.spaces.roomId,
    entered: g.doors.state.entered,
    audioSpace: g.audio.stats().space,
    ambience: g.audio.stats().ambience,
    colliders: g.world.colliders.length,
    walls: g.world.walls ? g.world.walls.length : 0,
    courtyardVisible: g.courtyard.group.visible,
    interiorVisible: g.interior.group.visible,
    sunIntensity: +g.sky.sun.intensity.toFixed(3),
  };
});

await shoot('int-04-chamber-of-ascent', 'inside: Chamber of Ascent, looking down the axis');

// Turn around and look back at the entry doorway, to prove the room is a room.
await page.evaluate(async () => {
  window.__H__.place(0, -146, Math.PI);
  await window.__H__.frames(3);
});
await shoot('int-05-chamber-looking-back', 'Chamber of Ascent, looking back at the entry');

// ---------------------------------------------------------------------------
// 7. WALK OUT OF THE ENTRY ROOM WITHOUT PAYING, through the free west doorway
// ---------------------------------------------------------------------------
//
// The west portal into the Hall of Offerings used to be 750 of debris and is now
// `kind: 'open'` at cost 0. The distinction this block exists to hold is not the
// price: a barrier record is built for every portal whose kind is not 'open', so
// a FREE DEBRIS DOOR would still stand in the opening and still prompt "OPEN
// HALL OF OFFERINGS [F]", and the player would still have to reach it, stop, aim
// at it and press a key. With a horde behind them that is a completely different
// thing from an opening.
//
// So this asserts three separate facts: no barrier exists for that portal, no
// prompt appears when the player stands in front of it, and holding W carries
// them into the next room having spent nothing.

const freeExit = await page.evaluate(async () => {
  const g = window.__SANDS__;

  const barrier = g.interior.barriers.find(
    (b) => b.id === 'chamber-of-ascent/hall-of-offerings') || null;

  // FOUR METRES OFF THE DOORWAY, facing -X. Forward is (-sin yaw, 0, -cos yaw),
  // so yaw PI/2 looks down -X. The distance is load-bearing for the assertion
  // that follows: "no prompt appears" is worth nothing from across the room, and
  // the room got twelve metres wider. This is the same stand-off the purchase
  // block below uses on the east door, where a prompt DOES appear.
  window.__H__.place(-14, -149, Math.PI / 2);
  await window.__H__.frames(3);

  const cand = g.doors.candidate;
  const prompt = document.getElementById('prompt').textContent;

  // Broke on purpose. If a prompt or a toll existed this is where it would bite.
  const goldBefore = g.economy.gold;

  window.__H__.walk(Math.PI / 2, 260, true);
  await window.__H__.frames(3);

  return {
    barrier: barrier && barrier.id,
    candidate: cand && cand.id,
    prompt,
    goldBefore,
    goldAfter: g.economy.gold,
    pos: window.__H__.pos(),
    room: g.spaces.roomId,
    audioSpace: g.audio.stats().space,
  };
});

await shoot('int-07-hall-of-offerings', 'Hall of Offerings, through the free doorway');

// ---------------------------------------------------------------------------
// 7b. buy the debris door into the Granary Vault
// ---------------------------------------------------------------------------
//
// The tutorial purchase moved here when the west door became free, and the
// granary keeping its 750 is the point rather than an oversight: with the hall
// open, this price stops being a toll on leaving the first room and becomes the
// purchase that CLOSES the Act 2 loop, chamber to hall to gallery to granary to
// chamber.

const debris = await page.evaluate(async () => {
  const g = window.__SANDS__;

  // Back in the entry room, four metres off the EAST doorway, facing +X.
  window.__H__.place(14, -149, -Math.PI / 2);
  await window.__H__.frames(3);

  const cand = g.doors.candidate;
  const prompt = document.getElementById('prompt').textContent;
  const deny = document.getElementById('prompt').classList.contains('deny');

  g.economy.grant(1000, 'harness');
  await window.__H__.frames(2);

  const goldBefore = g.economy.gold;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
  await window.__H__.frames(2);

  return {
    candidate: cand && cand.id,
    prompt,
    denyWhenBroke: deny,
    goldBefore,
    goldAfter: g.economy.gold,
    spent: goldBefore - g.economy.gold,
    opening: cand && cand.opening,
  };
});

await shoot('int-06-debris-clearing', 'the rubble sinking out of the east doorway');

const throughDebris = await page.evaluate(async () => {
  const g = window.__SANDS__;

  let f = 0;
  const door = g.interior.barriers.find((b) => b.to === 'granary-vault');
  while (!door.opened && f < 200) { await new Promise((r) => requestAnimationFrame(r)); f++; }

  // Walk east through the cleared doorway.
  window.__H__.walk(-Math.PI / 2, 260, true);
  await window.__H__.frames(3);

  return {
    frames: f,
    pos: window.__H__.pos(),
    room: g.spaces.roomId,
    audioSpace: g.audio.stats().space,
  };
});

// ---------------------------------------------------------------------------
// 8. the Great Gallery, through the free portal, and up the ramp
// ---------------------------------------------------------------------------

const gallery = await page.evaluate(async () => {
  const g = window.__SANDS__;

  // The hall opens onto the gallery at (-22, -158) with no barrier at all, so
  // this is a walk and not a purchase. yaw 0 moves toward -Z. The portal moved
  // three west with the room; see the note on it in rooms.js.
  window.__H__.place(-22, -155, 0);
  window.__H__.walk(0, 200, true);
  await window.__H__.frames(3);

  const arrived = { pos: window.__H__.pos(), room: g.spaces.roomId };

  // Then stand on the centre line and look down the long axis, so the frame
  // actually contains the room rather than the underside of one ledge.
  window.__H__.place(0, -163, 0);
  await window.__H__.frames(3);

  return {
    ...arrived,
    audioSpace: g.audio.stats().space,
    ambience: g.audio.stats().ambience,
  };
});

await shoot('int-08-great-gallery', 'Great Gallery from the floor, two levels');

const ramp = await page.evaluate(async () => {
  const g = window.__SANDS__;

  // The west ramp rises from y=0 at z=-160 to y=6 at z=-172.
  window.__H__.place(-21, -161, 0);
  await window.__H__.frames(2);
  const yBefore = +g.player.position.y.toFixed(2);

  window.__H__.walk(0, 200, false);            // up the ramp, toward -Z
  await window.__H__.frames(2);
  const yTop = +g.player.position.y.toFixed(2);
  const posTop = window.__H__.pos();

  // Now step off the ledge sideways and confirm the drop is a real fall. The
  // ledge runs x -25..-17, so this has to cross eight units to leave it, past
  // the column at x=-20 that carries it.
  window.__H__.place(-24, -183, -Math.PI / 2); // face +X, out over the drop
  g.player.position.y = 6 + 1.68;              // feet on the ledge, not the floor
  await window.__H__.frames(2);
  const yOnLedge = +g.player.position.y.toFixed(2);

  window.__H__.walk(-Math.PI / 2, 140, false);
  g.rig.reset(-Math.PI / 2, -0.02);
  await window.__H__.frames(20);

  return {
    yBefore,
    yTop,
    posTop,
    yOnLedge,
    yAfterStepOff: +g.player.position.y.toFixed(2),
    grounded: g.player.state.grounded,
  };
});

await page.evaluate(async () => {
  // Back on the ledge, looking down the gallery, for the money shot.
  const g = window.__SANDS__;
  window.__H__.place(-21, -180, 0);
  g.player.position.y = 6 + 1.68;
  await window.__H__.frames(4);
});
await shoot('int-09-gallery-upper-ledge', 'Great Gallery from the upper ledge');

// ---------------------------------------------------------------------------
// 9. the power gate refuses, the Kindling lights it, then it opens
// ---------------------------------------------------------------------------

const power = await page.evaluate(async () => {
  const g = window.__SANDS__;

  // In the Canopic Crypt, facing the gate to the King's Chamber at z = -232.
  window.__H__.place(0, -229, 0);
  await window.__H__.frames(3);

  const lockedPrompt = document.getElementById('prompt').textContent;
  const lockedDeny = document.getElementById('prompt').classList.contains('deny');
  const goldBefore = g.economy.gold;
  const deniedBefore = g.doors.state.denied;

  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
  await window.__H__.frames(2);

  const gate = g.interior.barriers.find((b) => b.kind === 'power');

  return {
    lockedPrompt,
    lockedDeny,
    stillClosed: !gate.opened && !gate.opening,
    goldUnchanged: g.economy.gold === goldBefore,
    deniedIncremented: g.doors.state.denied > deniedBefore,
    powered: g.interior.powered,
  };
});

await shoot('int-10-power-gate-locked', 'the sealed gate to the King\'s Chamber');

const kindled = await page.evaluate(async () => {
  const g = window.__SANDS__;

  // The Kindling faces +Z, so it is approached from the +Z side looking -Z.
  window.__H__.place(-29, -221.6, 0);
  await window.__H__.frames(3);

  /*
   * IT IS NOT A LEVER ANY MORE, AND THAT IS WHAT THIS NOW CHECKS.
   *
   * The trigger moved onto the four-jar chain - the third jar going home calls
   * throwSwitch() - and the fire bowl stayed exactly where it was as scenery
   * that lights. So the prompt is asserted EMPTY and the key is pressed anyway,
   * because "the fixture no longer prompts" and "the key no longer works" are
   * two claims and a suite that only made the first would miss a lever that
   * still fired silently.
   */
  const prompt = document.getElementById('prompt').textContent;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
  await window.__H__.frames(3);
  const poweredByKey = g.interior.powered;

  g.power.throwSwitch();
  await window.__H__.frames(3);

  return { prompt, poweredByKey, powered: g.interior.powered, room: g.spaces.roomId };
});

await shoot('int-11-embalming-kindling', 'Embalming Chamber, the Kindling lit');

const opened = await page.evaluate(async () => {
  const g = window.__SANDS__;

  window.__H__.place(0, -229, 0);
  await window.__H__.frames(3);

  const prompt = document.getElementById('prompt').textContent;
  const deny = document.getElementById('prompt').classList.contains('deny');
  const goldBefore = g.economy.gold;

  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));

  const gate = g.interior.barriers.find((b) => b.kind === 'power');
  let f = 0;
  while (!gate.opened && f < 200) { await new Promise((r) => requestAnimationFrame(r)); f++; }

  window.__H__.walk(0, 200, true);   // through, into the King's Chamber
  await window.__H__.frames(3);

  return {
    prompt,
    deny,
    freeOfCharge: g.economy.gold === goldBefore,
    frames: f,
    room: g.spaces.roomId,
    pos: window.__H__.pos(),
  };
});

await shoot('int-12-kings-chamber', 'King\'s Chamber, through the powered gate');

// ---------------------------------------------------------------------------
// 10. walls actually contain the player
// ---------------------------------------------------------------------------

const containment = await page.evaluate(async () => {
  const g = window.__SANDS__;

  // Run at the south wall of the King's Chamber and confirm it holds.
  window.__H__.place(0, -262, Math.PI);
  window.__H__.walk(Math.PI, 400, true);
  await window.__H__.frames(2);
  const south = window.__H__.pos();

  // And at the east wall.
  window.__H__.place(0, -252, -Math.PI / 2);
  window.__H__.walk(-Math.PI / 2, 400, true);
  await window.__H__.frames(2);
  const east = window.__H__.pos();

  return { south, east, room: g.spaces.roomId };
});

// ---------------------------------------------------------------------------
// 11. back out to the courtyard
// ---------------------------------------------------------------------------

const back = await page.evaluate(async () => {
  const g = window.__SANDS__;

  window.__H__.place(0, -144, Math.PI);
  window.__H__.walk(Math.PI, 120, true);
  await window.__H__.frames(4);

  return {
    space: g.spaces.active,
    pos: window.__H__.pos(),
    courtyardVisible: g.courtyard.group.visible,
    interiorVisible: g.interior.group.visible,
    sunIntensity: +g.sky.sun.intensity.toFixed(3),
    audioSpace: g.audio.stats().space,
  };
});

await shoot('int-13-back-outside', 'back out in the courtyard, sun restored');

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
section('at the door', atDoor);
section('refused when broke', refused);
section('earning', earning);
section('bought', bought);
section('entered', entered);
section('free west exit', freeExit);
section('debris door', debris);
section('through the debris', throughDebris);
section('gallery', gallery);
section('ramp', ramp);
section('power gate locked', power);
section('kindling', kindled);
section('power gate opened', opened);
section('containment', containment);
section('back outside', back);

console.log('--- frames ---');
for (const s of shots) {
  console.log(`  ${s.name.padEnd(28)} luma=${String(s.meanLuma).padStart(6)} lit=${String(s.percentLit).padStart(5)}%  ${s.label}`);
}

if (errors.length) { console.log('--- errors ---'); for (const e of errors) console.log(e); }
if (warnings.length) { console.log('--- warnings ---'); for (const w of warnings) console.log(w); }

// An interior lit by point lights is darker than a desert noon, so the floor is
// lower than shot.mjs uses. It is not zero: a room that renders nothing at all
// is the failure this exists to catch.
const DARK = shots.filter((s) => s.meanLuma < 6 || s.percentLit < 25);

const checks = {
  'starts on 500 gold':              opening.gold === 500 && opening.hudGold === '500',
  'interior built and hidden':       opening.interiorHidden === true,
  // ELEVEN, DOWN FROM TWELVE, and the one that went is the entry room's west
  // doorway. `doors.all` is every door in the GAME rather than every door in the
  // pyramid: the sealed doorway, the Quarry and the Canal outside, and the
  // interior barriers.
  //
  // It dropped because that portal became `kind: 'open'` at cost 0, and a
  // barrier record is only ever built for a doorway with something standing in
  // it. The count going down IS the assertion that the change landed as an
  // opening rather than as a free door.
  //
  // This assertion has now failed twice for good reasons - once when the two
  // courtyard mouths were wired and once here - which is an exact count doing
  // its job: it is the only thing that catches a door authored and never
  // adopted. Same shape as the fixture count in test/economy.mjs.
  'eleven doors exist':              opening.doors === 11,
  'the two hard-only walls cleared': opening.hardOnly.length === 2
                                       && opening.hardOnly.every((s) => s.endsWith(':cleared')),
  'and took their colliders':        opening.hardOnlyColliders === 0,
  'walked to the sealed doorway':    atDoor.pos.z < -26 && atDoor.pos.z > -28,
  'doorway is the look target':      atDoor.candidate === 'courtyard/entry',
  'prompt shows the price':          /1000 GOLD/.test(atDoor.hud.prompt),
  'prompt is red when short':        atDoor.hud.promptDeny === true,
  'F refuses when short':            refused.goldAfter === refused.goldBefore && refused.opened === false,
  'refusal was counted':             refused.denied > 0,
  'a target was placed to shoot':    earning.placed === true,
  'shooting pays gold':              earning.gained > 0 && earning.gained % 10 === 0,
  'HUD tracks the purse':            earning.hudGold === String(earning.goldAfter),
  'gold popups appeared':            earning.popsSeen > 0,
  'prompt clears when affordable':   bought.denyBefore === false,
  'buying deducted 1000':            bought.spent === 1000,
  'the door started opening':        bought.opening === true,
  'the doorway collider was freed':  bought.doorwayCleared === true,
  'the slab finished moving':        entered.openedAfterFrames < 200,
  'walked into the pyramid':         entered.space === 'interior',
  'landed in the entry chamber':     entered.room === 'chamber-of-ascent',
  'the interior is what renders':    entered.interiorVisible === true && entered.courtyardVisible === false,
  'the sun is off inside':           entered.sunIntensity === 0,
  'reverb switched to the room':     entered.audioSpace === 'chamber',
  'interior walls are live':         entered.walls > 60,
  // THE FREE EXIT. Three separate facts, because "free" and "open" are not the
  // same claim and only the second one is worth anything with a horde behind
  // you: nothing stands in the doorway, nothing asks the player to press a key,
  // and holding W gets them into the next room having spent nothing.
  'the west doorway has no barrier':  freeExit.barrier === null,
  'the west doorway offers no prompt': !freeExit.candidate && freeExit.prompt.trim() === '',
  'walked out of the entry room free': freeExit.room === 'hall-of-offerings',
  'and it cost nothing':             freeExit.goldAfter === freeExit.goldBefore,
  'hall reverb is corridor':         freeExit.audioSpace === 'corridor',

  // The tutorial purchase, now on the EAST doorway. The granary keeps its 750
  // on purpose; see the portal note in rooms.js.
  'debris door is the look target':  debris.candidate === 'chamber-of-ascent/granary-vault',
  'debris quotes 750':               /750 GOLD/.test(debris.prompt),
  'debris cost 750':                 debris.spent === 750,
  'walked into the granary':         throughDebris.room === 'granary-vault',
  'reached the great gallery':       gallery.room === 'great-gallery',
  'gallery reverb is gallery':       gallery.audioSpace === 'gallery',
  'ramp starts near the floor':      ramp.yBefore < 2.6,
  'ramp climbs to the ledge':        ramp.yTop > 7 && ramp.yTop < 8.2,
  'stepping off the ledge falls':    ramp.yAfterStepOff < ramp.yOnLedge - 3,
  'power gate refuses':              power.stillClosed === true && power.goldUnchanged === true,
  'power gate explains itself':      /KINDLING/.test(power.lockedPrompt),
  'power refusal is not a price':    !/GOLD/.test(power.lockedPrompt),
  'the fire bowl offers no prompt':  kindled.prompt.trim() === '',
  'F at the bowl does nothing':      kindled.poweredByKey === false,
  'the chain lights the map':        kindled.powered === true,
  'powered gate opens free':         opened.freeOfCharge === true && opened.frames < 200,
  'reached the King\'s Chamber':     opened.room === 'kings-chamber',
  'south wall holds':                containment.south.z > -271 && containment.room === 'kings-chamber',
  'east wall holds':                 containment.east.x < 20,
  'walked back out':                 back.space === 'exterior',
  'the sun came back':               back.sunIntensity > 1,
  'the courtyard renders again':     back.courtyardVisible === true && back.interiorVisible === false,
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
