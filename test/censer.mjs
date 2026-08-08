/**
 * THE CENSER DENIES GROUND, AND IT DENIES IT FOR THE THREE REASONS IT CLAIMS TO.
 *
 * The variant's claim, in the form the player has to learn it: ground a Censer
 * can SEE, and that you have not LEFT, starts to burn, and standing in it costs
 * 7 every 2.4 seconds. That sentence has three load-bearing clauses and a
 * harness that checks only the first one would pass for an enemy that simply
 * damages anyone standing near it, which is a thing this game already has five
 * of. So all three are measured, each against its own control, in one run:
 *
 *   A   censer, clean line, player standing still   -> the floor bills them
 *   B   THE SAME censer, player moving              -> nothing. CONTROL
 *   C   a SHAMBLER in the same spot, player still   -> nothing. CONTROL
 *   D   the same censer, stone in the way           -> nothing. CONTROL
 *
 * B and C are the two ways this could pass while measuring nothing. If B fired,
 * the mechanic would be "a censer near you hurts", not "standing still hurts".
 * If C fired, the harness would be reading damage that any body produces and the
 * variant would be incidental. Both are asserted to come back at exactly zero
 * ticks, and C is additionally asserted to take zero damage at all - it is
 * PINNED at range, so an ordinary enemy in that position cannot reach the player
 * and must therefore cost nothing.
 *
 * D IS THE ONE THAT NEEDED THE MAP RATHER THAN A NUMBER, and it is found rather
 * than authored. The suite searches the director's OWN accepted spawn points for
 * a player position that has both a censer spot with a clean line and a censer
 * spot of comparable range with stone in between, and it verifies the pair by
 * reading `stats().censer.seeing` back out of the running director before it
 * trusts either. A hardcoded coordinate would silently become a different test
 * the day the colonnade moved; this fails loudly instead, and prints the two
 * distances so the reader can see they are comparable.
 *
 * E and F are the other two halves of "it is in the game at all":
 *
 *   E   THE STANDOFF. A Censer walks to eight metres and stops, which is the
 *       posture half of the design and the reason holding an angle stops working.
 *       Controlled against a shambler released from the same distance, which
 *       walks all the way in. If both closed, the standoff is not real.
 *   F   IT REACHES THE FLOOR of a real wave through the director's own queue -
 *       POOL, `weight` and UNLOCK - rather than through placeAt.
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1200);

const out = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const d = g.director;
  const dt = 1 / 60;
  let clock = 0;

  const { UNLOCK, VARIANTS } = await import(
    new URL('../src/enemies/variants.js', location.href).href
  );

  if (!d.placeAt) return { fatal: 'director.placeAt not available' };
  if (!d.stats().censer) return { fatal: 'director.stats() reports no censer block' };

  const K = d.stats().censer;

  /**
   * Stop the wave machine without stopping the director.
   *
   * `state.running = false` returns out of update() at the top, which would also
   * stop the thing being measured. A breather with a timer nothing can run down
   * leaves every other system - the actors, the flow field, the smoulder - doing
   * exactly what it does in a real round, with no second wave walking into the
   * middle of the trial and blocking the line.
   */
  function quiet() {
    d.state.phase = 'breather';
    d.state.timer = 1e9;
  }

  function step() { clock += dt; d.update(dt, clock); }

  function heal() { g.player.state.health = g.player.state.maxHealth; }

  function setPlayer(x, z) { g.player.position.x = x; g.player.position.z = z; }

  /**
   * Put one body down at a point and report whether it has the player.
   *
   * Two frames: the first settles the director at the new player position, the
   * second is the one whose `seeing` is read. Used only by the search for the
   * blocked pair.
   */
  function probeSeeing(p, q) {
    d.reset();
    quiet();
    setPlayer(p.x, p.z);
    step();
    const a = d.placeAt('censer', q.x, q.z);
    if (!a) return -1;
    a.position.x = q.x; a.position.z = q.z;
    step();
    return d.stats().censer.seeing;
  }

  /**
   * A player position with two censer spots: one it can be seen from, one it
   * cannot, at comparable range.
   *
   * Drawn from d.spawnPoints() rather than from coordinates, because that list
   * is what the placement filter ACCEPTS - every point in it is somewhere a body
   * can legitimately stand - and because it moves with the map.
   */
  function findPair() {
    const pts = d.spawnPoints();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let clear = null;
      let blocked = null;

      for (let k = 0; k < pts.length && (!clear || !blocked); k++) {
        if (k === i) continue;
        const q = pts[k];
        const dist = Math.hypot(q.x - p.x, q.z - p.z);
        if (dist < 8 || dist > K.sight - 1) continue;

        const seen = probeSeeing(p, q);
        if (seen === 1 && !clear) clear = { q, dist: +dist.toFixed(2) };
        if (seen === 0 && !blocked) blocked = { q, dist: +dist.toFixed(2) };
      }

      if (clear && blocked) return { p, clear, blocked, searched: i + 1 };
    }
    return null;
  }

  const pair = findPair();
  if (!pair) {
    return {
      fatal: 'no player position on this map has both a clear and a blocked censer '
        + 'spot inside sight range, so the line-of-sight control cannot be run',
    };
  }

  /**
   * Run one trial.
   *
   * The enemy is PINNED every frame, which is what makes A, B, C and D differ in
   * exactly one thing each. An unpinned Censer walks toward the player and an
   * unpinned shambler walks into melee, and either would change the range, the
   * sightline, or the damage between one trial and the next.
   *
   * @param {string} variant  what to put down
   * @param {object} at       where to pin it
   * @param {number} move     metres of lateral oscillation for the player, 0 to pin
   */
  function trial(variant, at, move, seconds) {
    d.reset();
    quiet();
    setPlayer(pair.p.x, pair.p.z);
    heal();
    step();

    const a = d.placeAt(variant, at.x, at.z);
    if (!a) return { fatal: `placeAt(${variant}) returned null` };

    const ticks0 = d.stats().censer.ticks;
    let taken = 0;
    let last = g.player.state.health;
    let seeingFrames = 0;
    let peak = 0;

    const frames = Math.round(seconds / dt);
    for (let i = 0; i < frames; i++) {
      // Period two seconds, so a player oscillating over `move` metres either
      // side of the anchor crosses the 2.2 m break several times per fill.
      const t = i * dt;
      setPlayer(pair.p.x + (move ? Math.sin(t * Math.PI) * move : 0), pair.p.z);
      a.position.x = at.x;
      a.position.z = at.z;
      step();

      const h = g.player.state.health;
      if (h < last) taken += last - h;
      // Topped back up well clear of zero, so no trial can end early through the
      // death path - which would reset the director under the loop.
      if (h < 45) heal();
      last = g.player.state.health;

      const s = d.stats().censer;
      if (s.seeing > 0) seeingFrames++;
      if (s.smoulder > peak) peak = s.smoulder;
    }

    const s = d.stats().censer;
    return {
      variant,
      moved: move,
      seconds,
      ticks: s.ticks - ticks0,
      taken,
      seeingPct: Math.round((seeingFrames / frames) * 100),
      peakSmoulder: +peak.toFixed(2),
    };
  }

  /**
   * Release one body from a distance and record how close it ever gets.
   *
   * The player is pinned, so every metre closed is the body's own doing.
   */
  function standoff(variant, seconds) {
    d.reset();
    quiet();
    setPlayer(pair.p.x, pair.p.z);
    heal();
    step();

    // Straight down the clear bearing, pushed out to the edge of sight so the
    // body has ground to cover before it decides anything.
    const dx = pair.clear.q.x - pair.p.x;
    const dz = pair.clear.q.z - pair.p.z;
    const len = Math.hypot(dx, dz) || 1;
    const startD = Math.min(14, K.sight - 1);
    const sx = pair.p.x + (dx / len) * startD;
    const sz = pair.p.z + (dz / len) * startD;

    const a = d.placeAt(variant, sx, sz);
    if (!a) return { fatal: `placeAt(${variant}) returned null` };

    let closest = Infinity;
    const frames = Math.round(seconds / dt);
    for (let i = 0; i < frames; i++) {
      setPlayer(pair.p.x, pair.p.z);
      step();
      if (!a.live) break;
      const dd = Math.hypot(a.position.x - pair.p.x, a.position.z - pair.p.z);
      if (dd < closest) closest = dd;
      if (g.player.state.health < 45) heal();
    }

    return { variant, start: +startD.toFixed(2), closest: +closest.toFixed(2) };
  }

  const SECONDS = 18;
  const A = trial('censer', pair.clear.q, 0, SECONDS);
  const B = trial('censer', pair.clear.q, 3, SECONDS);
  const C = trial('shambler', pair.clear.q, 0, SECONDS);
  const D = trial('censer', pair.blocked.q, 0, SECONDS);

  const standCenser = standoff('censer', 20);
  const standShambler = standoff('shambler', 20);

  /**
   * Does it reach the floor of a real wave.
   *
   * Same shape as test/variantspawn.mjs: force each wave from its unlock to the
   * last and count the frames a body of this variant is standing in one. Nothing
   * here is placed by hand, so this is the POOL entry, the `weight` entry and the
   * UNLOCK entry all being exercised at once - the three tables a variant can be
   * completely authored and still be invisible without.
   */
  d.reset();
  const wave0 = UNLOCK.censer;
  let censerFrames = 0;
  let shamblerFrames = 0;
  let peakLive = 0;
  for (let w = wave0; w <= 25; w++) {
    d.forceWave(w);
    for (let i = 0; i < 260; i++) {
      step();
      let n = 0;
      for (const a of d.live) {
        if (a.variant === 'censer') { censerFrames++; n++; }
        if (a.variant === 'shambler') shamblerFrames++;
      }
      if (n > peakLive) peakLive = n;
    }
  }

  return {
    consts: K,
    pair: {
      player: { x: +pair.p.x.toFixed(2), z: +pair.p.z.toFixed(2) },
      clearAt: pair.clear.dist,
      blockedAt: pair.blocked.dist,
      searched: pair.searched,
    },
    A, B, C, D,
    standCenser, standShambler,
    spawn: { wave0, censerFrames, shamblerFrames, peakLive },
    pooled: !!d.pools.censer && d.pools.censer.length,
    inVariants: !!VARIANTS.censer,
  };
});

if (out.fatal) { console.log(`FATAL  ${out.fatal}`); await browser.close(); process.exit(1); }
for (const k of ['A', 'B', 'C', 'D', 'standCenser', 'standShambler']) {
  if (out[k] && out[k].fatal) {
    console.log(`FATAL  ${k}: ${out[k].fatal}`);
    await browser.close();
    process.exit(1);
  }
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

const K = out.consts;
console.log(`the smoulder, as the running director reports it:`);
console.log(`  sight ${K.sight} m   break ${K.breakAt} m   fill ${K.fill} s   tick ${K.tick} hp   stack ${K.stack}`);
console.log('');
console.log(`player pinned at (${out.pair.player.x}, ${out.pair.player.z}), found after ${out.pair.searched} candidate spots`);
console.log(`  clean line at ${out.pair.clearAt} m      stone in the way at ${out.pair.blockedAt} m`);
console.log('');

const row = (r, label) => console.log(
  `  ${label.padEnd(34)}${String(r.ticks).padStart(6)} ticks${String(r.taken).padStart(7)} hp`
  + `${String(r.seeingPct).padStart(7)}% seen   peak charge ${r.peakSmoulder}`);

console.log(`${out.A.seconds} simulated seconds each, body pinned so only one thing differs per row:`);
row(out.A, 'A  censer, clear, STANDING STILL');
row(out.B, 'B  censer, clear, player MOVING');
row(out.C, 'C  SHAMBLER, clear, standing still');
row(out.D, 'D  censer, BLOCKED, standing still');
console.log('');
console.log('released from the edge of sight, player pinned, 20 s:');
console.log(`  censer     start ${out.standCenser.start} m   closest ${out.standCenser.closest} m`);
console.log(`  shambler   start ${out.standShambler.start} m   closest ${out.standShambler.closest} m`);
console.log('');
console.log(`waves ${out.spawn.wave0}-25 through the real queue: censer alive for ${out.spawn.censerFrames} frames`
  + ` (peak ${out.spawn.peakLive} at once), shambler ${out.spawn.shamblerFrames}`);
console.log('');

// --- the mechanic ----------------------------------------------------------
const wantTicks = Math.floor(out.A.seconds / K.fill) - 1;
ok(out.A.ticks >= wantTicks,
  `A: standing still in a censer's line costs health (${out.A.ticks} ticks in ${out.A.seconds} s, want >= ${wantTicks})`);
ok(out.A.taken === out.A.ticks * K.tick,
  `A: and it costs exactly ${K.tick} a tick (${out.A.taken} hp over ${out.A.ticks} ticks)`);
ok(out.A.peakSmoulder > 0.9, `A: the charge actually fills (peak ${out.A.peakSmoulder})`);
ok(out.A.seeingPct > 95, `A: with the censer seeing the player throughout (${out.A.seeingPct}% of frames)`);

// --- the controls ----------------------------------------------------------
ok(out.B.ticks === 0,
  `B CONTROL: the SAME censer costs a MOVING player nothing (${out.B.ticks} ticks, ${out.B.taken} hp)`);
ok(out.B.seeingPct > 95,
  `B CONTROL: and it is not because it lost sight of them (${out.B.seeingPct}% of frames seen)`);
ok(out.B.peakSmoulder < 1,
  `B CONTROL: the charge never completes (peak ${out.B.peakSmoulder})`);

ok(out.C.ticks === 0,
  `C CONTROL: a shambler in the same spot produces no smoulder (${out.C.ticks} ticks)`);
ok(out.C.taken === 0,
  `C CONTROL: and pinned at that range costs the player nothing at all (${out.C.taken} hp)`);
ok(out.C.seeingPct === 0,
  `C CONTROL: nothing on the field is a censer (${out.C.seeingPct}% of frames seen)`);

ok(out.D.seeingPct === 0,
  `D CONTROL: stone in the way means the censer never has the player (${out.D.seeingPct}% of frames seen)`);
ok(out.D.ticks === 0,
  `D CONTROL: so standing still behind it is free (${out.D.ticks} ticks, ${out.D.taken} hp)`);
ok(Math.abs(out.pair.blockedAt - out.pair.clearAt) < K.sight * 0.5,
  `D CONTROL: at a comparable range to A, so it is cover and not distance`
  + ` (${out.pair.blockedAt} m vs ${out.pair.clearAt} m)`);

// --- the standoff ----------------------------------------------------------
// The band is the two numbers the standoff is actually made of, not a feel.
// mummy.js zeroes a body's desired speed inside 0.85 of its reach, which is
// 8.16 m here, and it also freezes it for the whole wind-up and swing, which
// begin at the full reach of 9.60 m. So a Censer creeps in during its cooldowns
// and settles somewhere in that 1.44 m band. Measured at 8.9.
ok(out.standCenser.closest > 8.0 && out.standCenser.closest < 9.7,
  `E: the censer holds a standoff and never closes (closest ${out.standCenser.closest} m, band 8.16 to 9.60)`);
ok(out.standShambler.closest < 3,
  `E CONTROL: a shambler released from the same distance walks all the way in (${out.standShambler.closest} m)`);

// --- the wiring ------------------------------------------------------------
ok(out.inVariants, 'VARIANTS carries the censer');
ok(out.pooled >= 4, `director POOL allocates censer actors (${out.pooled})`);
ok(out.spawn.censerFrames > 0,
  `F: the censer reaches the floor of a real wave through the queue (${out.spawn.censerFrames} frames alive)`);
ok(out.spawn.shamblerFrames > 0,
  `F CONTROL: the shambler does too, so the wave pump is working (${out.spawn.shamblerFrames} frames)`);

ok(errors.length === 0, 'no console errors');
if (errors.length) for (const e of errors.slice(0, 5)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
