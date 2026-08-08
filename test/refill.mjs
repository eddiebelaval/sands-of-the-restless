/**
 * THE WALL YOU ALREADY OWN: does it say anything at all.
 *
 * The owner finished a full run and reported: "I was walking up to the guns that
 * I already owned. I was not getting a reload option. It was literally empty. I
 * would walk up to it, and it would say nothing."
 *
 * He is right, and the previous session read `systems/wallbuy.js`, saw a refill
 * path with a price on it, and reported the feature as shipped without ever
 * driving it. What the code actually does:
 *
 *     if (weapons.state.current !== id) return { kind: 'idle', id };
 *     ...
 *     if (offer.kind === 'idle') return { text: '', deny: false };
 *
 * You are offered a refill ONLY while holding that exact weapon. Walk up holding
 * anything else - which is what a player does, because they are carrying the
 * best gun they own - and the wall is mute. Not a refusal, not a price, nothing.
 * `ui/interact.js` documents the same silence, so this was deliberate and
 * consistently built, and it made the feature invisible for a whole playthrough.
 *
 * The stated reason for the rule is that allowing it "turns every wall in the
 * map into a universal ammo box". That reason does not survive being read
 * closely: a wall only ever refills THE WEAPON IT SELLS. Refilling a carbine at
 * a shotgun wall would be universal; refilling the shotgun at the shotgun wall
 * while holding a carbine is just what the shotgun wall is for. The player still
 * has to walk to the right wall, which is the entire cost the rule was meant to
 * charge.
 *
 * So this file pins BOTH cases, and the second one is the bug:
 *
 *   holding it, empty      -> REFILL <NAME> - <price> GOLD   (worked before)
 *   NOT holding it, empty  -> silence                        (the defect)
 *
 * Read off `#prompt`'s rendered textContent rather than off `offerFor`, because
 * a correct offer that renders as an empty string is exactly the failure being
 * chased, and this project has now had fifteen of those.
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
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const frames = (n) => new Promise((res) => {
    let i = 0;
    const tick = () => (++i >= n ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });

  // The interior has to be the LIVE space before any of its fixtures can be
  // raycast. Without this every read below returns a null candidate and an empty
  // prompt - including the control that is known to work, which is the tell that
  // the harness is standing in the void rather than that the game is silent.
  g.spaces.enter('interior', { x: 0, z: -143.5, rot: 0 });
  await frames(4);

  /*
   * Stand at the SMG wall in the Chamber of Ascent - the same fixture
   * test/economy.mjs uses, so the two files are talking about one wall.
   *
   * INTERIOR ONLY, and economy.mjs paid for that lesson: the B3AR is a wall buy
   * standing in the courtyard, in the same record list because buying inside and
   * outside are deliberately one code path, and walking the whole list teleports
   * the player into a cell the live space is not in - which photographs as a
   * black frame and reports as the wall quoting the wrong price.
   */
  const rec = g.interacts.records.find(
    (r) => r.type === 'wallbuy' && r.room !== 'courtyard'
      && r.config && r.config.weapon === 'smg',
  );
  if (!rec) return { fatal: 'no interior smg wall buy record' };

  /** Stand off the fixture at its own rotation and look straight at it. */
  const face = (x, z, rot, dist = 3.0) => {
    const fx = -Math.sin(rot), fz = -Math.cos(rot);
    g.player.teleport({ x: x + fx * dist, y: 0, z: z + fz * dist });
    g.rig.reset(rot + Math.PI, -0.02);
    for (let i = 0; i < 90; i++) {
      g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, rot + Math.PI);
      if (g.player.state.grounded) break;
    }
  };

  const look = async () => {
    face(rec.x, rec.z, rec.rot || 0);
    await frames(6);
    const el = document.getElementById('prompt');
    return {
      text: (el.textContent || '').trim(),
      candidate: !!g.interacts.candidate,
      kind: g.interacts.candidate ? g.wallbuys.offerFor(g.interacts.candidate).kind : null,
    };
  };

  g.economy.reset(9000);
  g.weapons.grant('smg');
  g.weapons.grant('shotgun');

  // --- case A: own it, HOLDING it, reserve empty -------------------------
  g.weapons.equip('smg');
  g.weapons.ammo.smg.reserve = 0;
  await frames(3);
  const holding = await look();

  // --- case B: own it, holding SOMETHING ELSE, reserve still empty --------
  //
  // The player's real posture. Nothing about the wall or the ammo changed
  // between these two reads; the only difference is which gun is in the hands.
  g.weapons.equip('shotgun');
  await frames(3);
  const notHolding = await look();

  // --- case C: own it, holding it, ammo FULL ------------------------------
  // The control for "silence means nothing is on offer": a wall with genuinely
  // nothing to sell must still SAY so, and this one already did.
  g.weapons.equip('smg');
  g.weapons.refillAmmo('smg');
  await frames(3);
  const full = await look();

  return { holding, notHolding, full, reserveCap: g.weapons.ammo.smg.reserve };
});

if (out.fatal) { console.log(`FATAL  ${out.fatal}`); await browser.close(); process.exit(1); }

await page.screenshot({ path: `${OUT}refill-wall.png` });

const checks = {
  'holding it and empty: the wall offers a REFILL with a price':
    /REFILL/.test(out.holding.text) && /\d+\s*GOLD/.test(out.holding.text),
  'NOT holding it and empty: the wall still says something':
    out.notHolding.text.length > 0,
  'and what it says names the weapon':
    /WADJET|SMG/i.test(out.notHolding.text),
  'and it still quotes the refill price':
    /\d+\s*GOLD/.test(out.notHolding.text),
  'CONTROL: a genuinely full wall says AMMO FULL, not nothing':
    /AMMO FULL/.test(out.full.text),
  'no console errors':
    errors.length === 0,
};

writeFileSync(`${OUT}refill-report.json`, JSON.stringify({ ...out, errors }, null, 1));

console.log(`holding it, empty      "${out.holding.text}"   [${out.holding.kind}]`);
console.log(`NOT holding it, empty  "${out.notHolding.text}"   [${out.notHolding.kind}]`);
console.log(`holding it, full       "${out.full.text}"   [${out.full.kind}]`);
console.log('');

let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`\nreport  ${OUT}refill-report.json`);
if (errors.length) console.log(`errors  ${errors.slice(0, 3).join(' / ')}`);

await browser.close();
if (failed) { console.log(`\n${failed} CHECK(S) FAILED`); process.exit(1); }
console.log('\nALL CHECKS PASSED');
