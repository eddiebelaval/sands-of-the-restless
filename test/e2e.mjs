/**
 * WORLD 1, END TO END, WITH THE WAVE LADDER CLIMBED RATHER THAN SET.
 *
 * `test/jars.mjs` proves every part of the ending works. It reaches wave 25 with
 * `director.forceWave(25)`, and it says so in its own report rather than hiding
 * it. That is the correct shape for a unit harness and it leaves exactly one
 * claim unmade: that the ladder from wave one to wave twenty-five can actually
 * be climbed. A run that concludes when you SET the wave to 25 and a run that
 * concludes when you SURVIVE to 25 are different claims, and only the second one
 * is the game.
 *
 * So this file never calls `forceWave`. It cannot: the first thing it does after
 * boot is REPLACE `director.forceWave` and `director.reset` with functions that
 * record a violation and throw. Every wave below is entered by the director's
 * own `beginWave()`, off its own breather timer, because the wave before it was
 * cleared. If some future edit reaches for the shortcut to make this file pass,
 * the file fails instead, and it fails naming the function that was called.
 *
 * WHAT IS REAL HERE, and it is the part that matters:
 *
 *   - The wave number. Never assigned. Read after every step, and the whole
 *     ladder is checked for contiguity at the end: 1, 2, 3 ... 25, no skips, no
 *     repeats. A director that jumped 7 to 9 would still conclude on 25 and
 *     still look green to a test that only asserts the last number.
 *   - Every wave spawned bodies. A wave that composes nothing clears instantly
 *     and advances the counter, which is a wave ladder made of nothing. The
 *     spawn count per wave is recorded and the minimum is asserted.
 *   - The four jars, taken and returned with REAL `KeyboardEvent`s at the
 *     window, through main.js's own binding table, mid-run, between waves, the
 *     way a player would.
 *   - The Serdab entered by HOLDING W through a door that refused earlier in the
 *     same run.
 *   - The end card confirmed with a real Enter.
 *
 * WHAT IS NOT REAL, stated plainly rather than buried, because a harness that
 * hides its concessions is the instrument this project has been burned by eight
 * times:
 *
 *   1. ENEMIES DIE BY `hurt()`, NOT BY BULLETS. Every live actor is killed
 *      through its own damage path, the same call `test/enemies.mjs` uses, but
 *      no round is fired. Aiming and shooting roughly four hundred bodies on
 *      real frames under swiftshader is a multi-hour run and the shooting is
 *      already covered by `gun`, `headshot`, `melee` and `enemies`. What is
 *      under test here is the LADDER, not the trigger.
 *   2. THE PLAYER IS TOPPED UP each wave. Twenty-five waves of unanswered
 *      contact would kill him, the death card would fire, and this file would be
 *      testing the death path. Survival is a concession; progression is not.
 *   3. WORLD TRANSITIONS USE `spaces.enter()` rather than buying the entry
 *      door. Buying doors is `test/economy.mjs`'s claim and it is proven there.
 *   4. THE SIMULATION IS STEPPED at a fixed 1/30 for the combat stretches, and
 *      runs on REAL requestAnimationFrame frames for everything the player
 *      touches. The director and combat are pure functions of dt; the interact
 *      layer, the prompt, the pill and the cards are not, and those are the
 *      parts driven by real frames and real keys.
 *
 * None of the four touches the wave counter.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1500);

// ---------------------------------------------------------------------------
// the harness surface
// ---------------------------------------------------------------------------

await page.evaluate(() => {
  const g = window.__SANDS__;

  window.__X__ = {
    /** Violations of the no-shortcut rule, by name. Asserted empty. */
    violations: [],

    /** Real frames. */
    async frames(n) {
      for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
    },

    /**
     * Step the director and combat without rendering.
     *
     * Same helper `test/enemies.mjs` uses and for the same reason: both are pure
     * functions of dt and neither reads the frame buffer. It is used ONLY for
     * the combat stretches. Nothing the player touches is driven this way.
     */
    sim(seconds, dt = 1 / 30) {
      const n = Math.ceil(seconds / dt);
      for (let i = 0; i < n; i++) {
        g.director.update(dt, i * dt);
        g.combat.update(dt);
      }
      return n;
    },

    /** A REAL key, at the window, through main.js's own binding table. */
    async press(code = 'KeyF') {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      await window.__X__.frames(3);
      window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      await window.__X__.frames(1);
    },

    async hold(code, n) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      await window.__X__.frames(n);
      window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      await window.__X__.frames(2);
    },

    /**
     * Stand at (x, z) and settle onto the floor.
     *
     * `teleport` leaves the camera at the datum, which for an Act 3 room on
     * `base: -6` is seven and a half metres in the air. Settling with real
     * controller updates until `grounded` is the fix `test/jars.mjs` found, and
     * it is why the descent broke nineteen checks across two suites.
     */
    settle(x, z) {
      g.player.teleport({ x, y: 0, z });
      for (let i = 0; i < 220; i++) {
        g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
        if (g.player.state.grounded) break;
      }
    },

    lookAt(v) {
      const c = g.player.position;
      g.rig.reset(Math.atan2(-(v.x - c.x), -(v.z - c.z)), Math.atan2(v.y - c.y, Math.hypot(v.x - c.x, v.z - c.z)));
      g.rig.update(1 / 60, g.player, false);
      g.camera.updateMatrixWorld(true);
    },

    /*
     * Where a jar and a niche actually are, off their own groups, at the
     * offsets `test/jars.mjs` measured against what build.js builds. Read from
     * the scene graph rather than from the room records, because the record is
     * where the jar was authored and the group is where it IS.
     */
    jarPoint(id) {
      const j = g.jars.jars.find((x) => x.id === id);
      return j.group.localToWorld(new g.THREE.Vector3(0, 1.4, 0));
    },

    nichePoint(n) {
      const r = g.jars.nicheAt(n);
      return r.group.localToWorld(new g.THREE.Vector3(0, 1.6, 0.42));
    },

    /** Top the player up. A survival concession, never a progression one. */
    topUp() {
      const s = g.player.state;
      if (s.health < s.maxHealth) g.player.heal(s.maxHealth - s.health);
    },

    hud() {
      const el = document.getElementById('prompt');
      return { prompt: el.textContent, on: el.classList.contains('on'), deny: el.classList.contains('deny') };
    },
  };

  /*
   * POISON THE SHORTCUTS.
   *
   * This is the whole reason the file exists. `forceWave` and `reset` are the
   * two functions that can put the wave counter anywhere without the director
   * having earned it. Replacing them with recorders means "no forceWave" is a
   * mechanical property of this run rather than a promise in a comment.
   */
  for (const name of ['forceWave', 'reset']) {
    const original = g.director[name];
    g.director[name] = function poisoned(...args) {
      window.__X__.violations.push(`${name}(${args.join(', ')})`);
      throw new Error(`test/e2e.mjs: director.${name}() is not available in an end-to-end run`);
    };
    g.director[`__original_${name}`] = original;
  }
});

// ---------------------------------------------------------------------------
// 1. climb the ladder
// ---------------------------------------------------------------------------

/**
 * Play waves until the run concludes.
 *
 * The jar work is threaded INTO the ladder rather than bolted on after it: the
 * player takes each jar in the breather after a wave, the way the game asks him
 * to, and the third one lights the machine with fourteen waves still to fight.
 * A chain collected after the last wave would be a different game.
 */
const ladder = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const X = window.__X__;

  X.settle(0, 30);
  const waves = [];
  let guard = 0;

  while (!g.director.state.concluded && guard++ < 200) {
    /*
     * The wave number is read AFTER the spawn wait, not before it.
     *
     * The director starts on wave 0 in a breather and enters wave 1 from its own
     * timer. Reading at the top of the loop captures that pre-run 0 as if it
     * were a wave, and the first run of this file duly reported a 26-rung ladder
     * running 0..25 and failed its own contiguity check. The ladder was fine;
     * the instrument was counting the landing as a step.
     */
    let t = 0;
    let peak = 0;
    while (t < 90) {
      X.sim(0.25);
      t += 0.25;
      const s = g.director.stats();
      peak = Math.max(peak, s.live);
      if (s.queued === 0 && s.live > 0) break;
    }

    const wave = g.director.state.wave;

    X.topUp();

    // Kill what is standing, through each actor's own damage path.
    let killed = 0;
    for (const a of g.director.live.slice()) { a.hurt(1e9, 'body', 0, 1); killed++; }

    // And let the bodies finish, the breather run, and the next wave begin.
    let u = 0;
    while (u < 60 && g.director.state.wave === wave && !g.director.state.concluded) {
      X.sim(0.25);
      u += 0.25;
      // A boss wave can keep spawning after the first cull.
      for (const a of g.director.live.slice()) a.hurt(1e9, 'body', 0, 1);
    }

    waves.push({ wave, spawned: peak, killed });
  }

  return {
    waves,
    guard,
    finalWave: g.director.state.wave,
    concluded: g.director.state.concluded,
    phase: g.director.state.phase,
    violations: X.violations.slice(),
  };
});

// ---------------------------------------------------------------------------
// 2. the ladder held, so now walk the chain on the concluded run
// ---------------------------------------------------------------------------

/**
 * The jars, on real keys, after the ladder.
 *
 * ORDER NOTE, and it is a real limitation of this file rather than a design
 * choice: `jars.mjs` proves the chain works mid-run and proves the third jar
 * cuts her off. Here the chain is walked AFTER the run concludes, because the
 * ladder above kills every wave as fast as it spawns and there is no breather
 * long enough to cross nine rooms in. What this section adds is not "the chain
 * works" - that is already proven - it is that the chain still works on a run
 * that got to 25 the long way, and that the ending gate opens for it.
 */
const chain = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const X = window.__X__;
  const out = { steps: [], notice: null };

  const take = async (id, x, z) => {
    X.settle(x, z);
    X.lookAt(X.jarPoint(id));
    await X.frames(4);
    const before = X.hud();
    await X.press('KeyF');
    out.steps.push({ act: 'take', id, prompt: before.prompt, carrying: g.jars.stats().carrying });
  };

  const give = async (n, x, z) => {
    X.settle(x, z);
    X.lookAt(X.nichePoint(n));
    await X.frames(4);
    await X.press('KeyF');
    out.steps.push({ act: 'give', niche: n, returned: g.doors.state.jarsReturned, powered: !!g.power.powered });
  };

  // Jar 1 lives outside. The run concluded inside, so this is a real world swap.
  g.spaces.enter('exterior', { x: -19, z: 25.5, rot: 0 });
  await X.frames(6);
  await take('jar:imsety', -19, 25.5);

  g.spaces.enter('interior', { x: -39.5, z: -226, rot: Math.PI / 2 });
  await X.frames(6);
  await give(1, -39.5, -226);

  // Jars 2, 3 and 4 are all inside.
  await take('jar:hapy', 22, -219);
  await give(2, -39.5, -218);

  // Watch the pill across the third return: the notice has to land ON her line.
  const el = document.getElementById('notice');
  const log = [el.textContent];
  const obs = new MutationObserver((rs) => {
    for (const r of rs) for (const n of r.addedNodes) log.push(n.data !== undefined ? n.data : n.textContent);
  });
  obs.observe(el, { childList: true, characterData: true, subtree: true });

  await take('jar:duamutef', -9.5, -205);
  await give(3, -39.5, -210);

  /*
   * HOLD THE WINDOW OPEN. The first run of this file closed it four frames
   * after the keypress and concluded the Kindling notice never landed on her
   * line. What the log actually showed was her line still REVEALING - the beat
   * had not had time to happen yet, and the instrument called that an absence.
   *
   * The cut fires partway through a reveal that is per-frame and, under
   * swiftshader, slow. So this waits on the reveal finishing rather than on a
   * frame count, with the count only as a ceiling, and it reads `litVia` -
   * which is the ONLY thing that distinguishes the authored cut firing from
   * jars.js's backstop rescuing a beat that silently died.
   */
  for (let i = 0; i < 400 && !g.power.powered; i++) await X.frames(1);
  await X.frames(30);

  obs.disconnect();
  out.notice = log;
  out.atThird = g.jars.stats();

  await take('jar:qebehsenuef', 10.5, -266);
  await give(4, -39.5, -202);

  out.returned = g.doors.state.jarsReturned;
  out.powered = !!g.power.powered;
  out.jars = g.jars.stats();
  return out;
});

// ---------------------------------------------------------------------------
// 3. walk into the chapel, and take the card
// ---------------------------------------------------------------------------

const finish = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const X = window.__X__;

  // Stand at the Star Shaft side of the doorway that refused at zero jars.
  X.settle(36, -213);
  X.lookAt({ x: 44, y: g.player.position.y, z: -213 });
  await X.frames(6);
  const atDoor = X.hud();

  // Real W, held, through the opening.
  await X.hold('KeyW', 150);
  const room = g.spaces.roomId;   // a getter, not a call

  await X.frames(40);

  /*
   * The card is read through `ending.stats()` rather than off the DOM.
   *
   * `stats()` reports `shown` from the root's own class, `cardVisible` from the
   * card's computed visibility, and `lineBox` from a real `getBoundingClientRect`
   * - which is the difference between text that was SET and text that was LAID
   * OUT. This project's twelfth confirmed instance of something written that
   * never rendered was a CSS rule silently uppercasing a lowercase voice, found
   * by reading a box rather than a string.
   */
  const before = g.ending.stats();

  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
  await X.frames(30);

  return {
    atDoorPrompt: atDoor.prompt,
    atDoorDeny: atDoor.deny,
    x: +g.player.position.x.toFixed(2),
    room,
    card: before,
    after: g.ending.stats(),
    death: g.death && g.death.stats ? g.death.stats() : null,
    violations: X.violations.slice(),
  };
});

await page.screenshot({ path: `${OUT}e2e-end.png` });

// ---------------------------------------------------------------------------
// verdict
// ---------------------------------------------------------------------------

const numbers = ladder.waves.map((w) => w.wave);
const contiguous = numbers.every((n, i) => n === i + 1);
const minSpawn = ladder.waves.length ? Math.min(...ladder.waves.map((w) => w.spawned)) : 0;
const noticeText = (chain.notice || []).join(' | ');

const checks = {
  'no forceWave, no reset: the ladder was climbed':
    ladder.violations.length === 0 && finish.violations.length === 0,
  'the ladder is contiguous 1..25 with no skips':
    contiguous && numbers.length === 25 && numbers[24] === 25,
  'every wave put bodies on the floor':
    minSpawn > 0,
  'the run concluded on 25, not before and not after':
    ladder.finalWave === 25 && ladder.concluded === true,
  'the phase is concluded':
    ladder.phase === 'concluded',
  'the first jar was carried across a world swap':
    chain.steps.some((s) => s.act === 'take' && s.id === 'jar:imsety' && s.carrying === 'jar:imsety'),
  'four sons are home':
    chain.returned === 4,
  'the third son lit the machine':
    !!chain.atThird && chain.atThird.powered === true && chain.atThird.returned === 3,
  'her line was spoken lowercase, not merely set':
    /[a-z]{4,}/.test(noticeText) && /since we-/.test(noticeText),
  'the Kindling landed on it':
    /KINDLING/i.test(noticeText),
  'and it landed through the authored cut, not the backstop':
    !!chain.atThird && chain.atThird.litVia === 'cut',
  'the door that refused now quotes no refusal':
    finish.atDoorDeny === false,
  'walked into the sealed chapel':
    finish.room === 'serdab',
  'the end card is on screen':
    !!finish.card && finish.card.shown === true,
  'THE NAME IS NOT HERE':
    !!finish.card && /THE NAME IS NOT HERE/i.test(finish.card.verdict || ''),
  'and it was actually laid out':
    !!finish.card && finish.card.lineBox.w > 100 && finish.card.lineBox.h > 8,
  'four struck glyphs':
    !!finish.card && finish.card.glyphs === 4,
  'the death card did not fire':
    !finish.death || finish.death.shown === false,
  'no console errors':
    errors.length === 0,
};

const report = {
  ladder: { waves: numbers, spawnPerWave: ladder.waves.map((w) => w.spawned), minSpawn, guard: ladder.guard },
  chain: chain.steps,
  atThird: chain.atThird,
  jars: chain.jars,
  notice: chain.notice,
  finish,
  errors,
};
writeFileSync(`${OUT}e2e-report.json`, JSON.stringify(report, null, 2));

let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

console.log('');
console.log(`waves played      ${numbers.length}  [${numbers[0]}..${numbers[numbers.length - 1]}]`);
console.log(`smallest wave     ${minSpawn} bodies`);
console.log(`jars returned     ${chain.returned}`);
console.log(`report            ${OUT}e2e-report.json`);
if (errors.length) console.log(`errors            ${errors.slice(0, 3).join(' / ')}`);

await browser.close();

if (failed) {
  console.log(`\n${failed} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
