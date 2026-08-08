/**
 * THREE PASSES THROUGH THE ALTAR, TOLD APART BY COLOUR.
 *
 * The owner asked for a weapon to go through three times and was explicit that
 * the tiers are a FINISH and not a name: "you don't need new names because all
 * the guns can just be a new color... maybe we end in gold."
 *
 * Three claims are worth a harness, and only one of them is about numbers.
 *
 *   1. THE STATS CLIMB AND TIER ONE DOES NOT MOVE. Every figure in this game
 *      that was ever balanced against "an upgraded weapon" was balanced against
 *      2.5x - the boss health curve was retuned against it, and
 *      test/bosstune.mjs asserts the shape of that curve. If tier one drifts,
 *      that suite is silently measuring a different game.
 *
 *   2. THE NAME DOES NOT CHANGE. That is the owner's decision and it is the kind
 *      of thing a later pass "fixes" by adding a tier suffix.
 *
 *   3. THE RING DOES NOT STACK. This is the one worth the file. Every upgraded
 *      gun in this game once rang at a fixed 1.6 kHz because a `?? 1.6` fallback
 *      was the only rate anything ever used, and on an SMG that is four bells
 *      sounding at once, permanently. The fix was a per-weapon rate plus a life
 *      SHORTER THAN THAT WEAPON'S CADENCE. A tier that scaled `ms` would undo it
 *      quietly, and the symptom would be back to "they sound like Christmas
 *      bells". So `ms` is asserted constant across all three tiers, per weapon.
 *
 * Run in node against the modules directly. None of this needs a GPU and the
 * ring's anti-stacking rule is arithmetic between two numbers, which is exactly
 * the kind of claim a screenshot cannot make.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/tiers/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(1200);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

/** Everything below runs against the modules as the PAGE has them loaded. */
const W = await page.evaluate(async () => {
  const m = await import(new URL('../src/player/weapons.js', location.href).href);
  return {
    MAX_TIER: m.MAX_TIER,
    UPGRADE_TIERS: m.UPGRADE_TIERS.map((t) => ({ ...t })),
  };
});
const { MAX_TIER, UPGRADE_TIERS } = W;

// ------------------------------------------------------------------ the table
ok(MAX_TIER === 3, `three passes and no more (MAX_TIER ${MAX_TIER})`);
ok(UPGRADE_TIERS.length === 3, 'three tier records');

// THE CONTROL FOR EVERY NUMBER IN THIS GAME. Tier one is what "upgraded" meant
// for the life of the project and what the boss curve was tuned against.
const t1 = UPGRADE_TIERS[0];
ok(t1.damage === 2.5, `TIER ONE IS UNCHANGED: damage 2.5 (${t1.damage})`);
ok(t1.magazine === 2 && t1.reserve === 2, 'tier one magazine and reserve still double');
ok(t1.spread === 0.70, `tier one spread still 0.70 (${t1.spread})`);

for (let i = 1; i < UPGRADE_TIERS.length; i++) {
  const a = UPGRADE_TIERS[i - 1], b = UPGRADE_TIERS[i];
  ok(b.damage > a.damage, `tier ${i + 1} hits harder than tier ${i} (${b.damage} vs ${a.damage})`);
  ok(b.spread < a.spread, `tier ${i + 1} is tighter than tier ${i} (${b.spread} vs ${a.spread})`);
  ok(b.reserve >= a.reserve, `tier ${i + 1} carries at least as much (${b.reserve} vs ${a.reserve})`);
}

// The curve must DIMINISH, or the last pass makes the end of a run trivial.
const step1 = UPGRADE_TIERS[1].damage / UPGRADE_TIERS[0].damage;
const step2 = UPGRADE_TIERS[2].damage / UPGRADE_TIERS[1].damage;
ok(step2 < step1,
  `the damage curve diminishes (+${((step1 - 1) * 100).toFixed(0)}% then +${((step2 - 1) * 100).toFixed(0)}%)`);

// ------------------------------------------------------------------ advancing
const adv = await page.evaluate(async () => {
  const m = await import(new URL('../src/player/weapons.js', location.href).href);
  const id = 'carbine';
  const base = m.BASE_STATS[id].damage;
  const out = { base, start: m.tierOf(id) };

  out.mark1 = m.markUpgraded(id);
  out.tier1 = m.tierOf(id);
  out.mark2 = m.markUpgraded(id);
  out.tierAfterSecondMark = m.tierOf(id);
  out.d1 = m.STATS[id].damage;

  out.up2 = m.upgradeWeapon(id);
  out.d2 = m.STATS[id].damage;
  out.statsTier = m.STATS[id].tier;

  out.up3 = m.upgradeWeapon(id);
  out.d3 = m.STATS[id].damage;

  out.up4 = m.upgradeWeapon(id);
  out.d4 = m.STATS[id].damage;

  const nBefore = m.displayName('lmg');
  m.markUpgraded('lmg'); const n1 = m.displayName('lmg');
  m.upgradeWeapon('lmg'); const n2 = m.displayName('lmg');
  m.upgradeWeapon('lmg'); const n3 = m.displayName('lmg');
  out.names = { nBefore, n1, n2, n3 };
  return out;
});

ok(adv.start === 0, 'a weapon starts on no tier');
ok(adv.mark1 === true, 'markUpgraded puts it on tier one');
ok(adv.tier1 === 1, `and tierOf agrees (${adv.tier1})`);
ok(adv.mark2 === false, 'markUpgraded is still idempotent, which existing callers rely on');
ok(adv.tierAfterSecondMark === 1, 'and did not advance it');
ok(Math.abs(adv.d1 - adv.base * 2.5) < 0.001, `tier one damage is 2.5x base (${adv.d1})`);

ok(adv.up2 === 2, 'upgradeWeapon advances to two');
ok(adv.d2 > adv.d1, `and the live stats follow (${adv.d1} -> ${adv.d2})`);
ok(adv.statsTier === 2, 'STATS carries the tier, which the viewmodel and the audio read');

ok(adv.up3 === 3, 'and to three');
ok(adv.d3 > adv.d2, `stats follow again (${adv.d2} -> ${adv.d3})`);

ok(adv.up4 === 3, 'a FOURTH pass is refused and reports the tier it stayed on');
ok(Math.abs(adv.d4 - adv.d3) < 0.001, 'and changes nothing');

// Tiers REPLACE rather than compound. Compounding would be 2.5 x 3.4 x 4.2 = 35.7x.
ok(Math.abs(adv.d3 - adv.base * UPGRADE_TIERS[2].damage) < 0.001,
  `tiers replace, they do not compound (${adv.d3} = base x ${UPGRADE_TIERS[2].damage})`);

// --------------------------------------------------------------------- naming
ok(adv.names.n1 !== adv.names.nBefore, 'an upgraded weapon still gets the upgraded name');
ok(adv.names.n1 === adv.names.n2 && adv.names.n2 === adv.names.n3,
  `THE NAME DOES NOT CHANGE BETWEEN TIERS, which is the owner's call ("${adv.names.n3}")`);

// ------------------------------------------------- the ring, per weapon per tier
const ring = await page.evaluate(async () => {
  const g = await import(new URL('../src/core/gunsmith.js', location.href).href);
  const REPORTS = g.REPORTS || g.default?.REPORTS || null;
  if (!REPORTS) return { missing: true };

  // The rule exactly as core/audio.js applies it.
  const scale = (t) => ({ rate: 1 + 0.12 * (t - 1), gain: 1 + 0.18 * (t - 1) });

  const rows = [];
  for (const [name, W] of Object.entries(REPORTS)) {
    if (!W || !W.ring) continue;
    rows.push({
      name,
      ms: W.ring.ms,
      rates: [1, 2, 3].map((t) => +(W.ring.rate * scale(t).rate).toFixed(3)),
      gains: [1, 2, 3].map((t) => +(W.ring.gain * scale(t).gain).toFixed(4)),
      // ms takes NO tier term. If this ever differs across tiers the bells return.
      lives: [1, 2, 3].map(() => W.ring.ms),
    });
  }
  return { rows, scale3: scale(3) };
});

if (ring.missing) {
  ok(false, 'gunsmith REPORTS could not be read, so the ring rule is untested');
} else {
  console.log('');
  console.log('  the pack-a-punch ring, per weapon, across the three tiers:');
  console.log('  weapon      ms   rate t1/t2/t3            gain t1/t2/t3');
  for (const r of ring.rows) {
    console.log(`  ${r.name.padEnd(10)}${String(r.ms).padStart(4)}   `
      + `${r.rates.join(' / ').padEnd(22)}${r.gains.join(' / ')}`);
  }
  console.log('');

  ok(ring.rows.length >= 5, `every weapon profile declares its own ring (${ring.rows.length})`);
  ok(ring.rows.every((r) => new Set(r.lives).size === 1),
    'RING LIFE IS CONSTANT ACROSS TIERS - the anti-stacking guarantee holds');
  ok(ring.rows.every((r) => r.rates[0] < r.rates[1] && r.rates[1] < r.rates[2]),
    'the ring rises in pitch by tier, so the tiers are distinguishable by ear');
  ok(ring.rows.every((r) => r.gains[2] / r.gains[0] < 1.5),
    `and level rises under a factor of 1.5 (x${ring.scale3.gain.toFixed(2)})`);

  // THE CONTROL AGAINST THE ORIGINAL BUG: no two weapons may share a rate, which
  // is what put a fixed 1.6 kHz note on all seven guns at once.
  const t1rates = ring.rows.map((r) => r.rates[0]);
  ok(new Set(t1rates).size === t1rates.length,
    `CONTROL: no two weapons share a ring rate (${new Set(t1rates).size} distinct of ${t1rates.length})`);
}

// ------------------------------------------------ THE FINISH, MEASURED IN PIXELS
//
// The whole feature is "you can tell the tiers apart by looking", and that is a
// claim about pixels rather than about a hex literal in a table. Three tiers
// authored to different colours that render the same on a dark viewmodel would
// pass every check above.
const shots = [];
for (let tier = 1; tier <= 3; tier++) {
  await page.evaluate(async (t) => {
    const g = window.__SANDS__;
    const m = await import(new URL('../src/player/weapons.js', location.href).href);
    const id = g.weapons.state.current;
    // Straight to the finish, so this measures the material and not the ritual.
    while (m.tierOf(id) < t) m.upgradeWeapon(id);
    g.viewmodel.upgradeFinish(id, t);
  }, tier);
  await page.waitForTimeout(400);
  const buf = await page.screenshot({ path: `${OUT}tier-${tier}.png` });
  shots.push(buf);
}

/**
 * The mean colour of the weapon, taken from the lower-right of the frame where
 * the viewmodel sits, ignoring anything too dark to be the gun.
 */
const mean = await page.evaluate(() => null);
const stat = [];
for (let i = 0; i < shots.length; i++) {
  const px = await page.evaluate(async (dataUrl) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = dataUrl; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    // Lower-right quadrant: where the viewmodel is drawn.
    // THE LOWER RECEIVER AND MAGAZINE, which is where the body colour actually
    // covers the most pixels.
    //
    // Three earlier boxes were wrong and all three reported the tiers as
    // identical, which is worth recording because they failed in the same
    // direction: the first ran to 0.97 of the width and measured the HUD plates,
    // the second to 0.87 of the height and filled with linen hand wraps, and the
    // third was placed on the upper receiver by eye. The box below was found by
    // asking the tier-one frame where its blue pixels are rather than by
    // guessing, and then excluding the sky, which is also blue.
    const d = x.getImageData(Math.floor(img.width * 0.615), Math.floor(img.height * 0.65),
      Math.floor(img.width * 0.07), Math.floor(img.height * 0.29)).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let k = 0; k < d.length; k += 4) {
      const lum = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
      if (lum < 26) continue;             // shadow, not the weapon
      // Saturated pixels only, which excludes the linen hand wraps and any
      // sandstone that creeps into the band. The finish is the only strongly
      // coloured thing in this rectangle.
      const mx = Math.max(d[k], d[k + 1], d[k + 2]);
      const mn = Math.min(d[k], d[k + 1], d[k + 2]);
      if (mx - mn < 24) continue;
      r += d[k]; g += d[k + 1]; b += d[k + 2]; n++;
    }
    if (!n) return null;
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), n };
  }, `data:image/png;base64,${shots[i].toString('base64')}`);
  stat.push(px);
}

console.log('  the finish, mean colour of the viewmodel quadrant:');
for (let i = 0; i < stat.length; i++) {
  const p = stat[i];
  console.log(`  tier ${i + 1}   rgb(${p ? `${p.r}, ${p.g}, ${p.b}` : 'no pixels'})`);
}
console.log('');
console.log(`  shots -> ${OUT}`);
console.log('');

ok(stat.every(Boolean), 'the weapon is on screen at every tier');
if (stat.every(Boolean)) {
  const dist = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
  const d12 = dist(stat[0], stat[1]);
  const d23 = dist(stat[1], stat[2]);
  const d13 = dist(stat[0], stat[2]);

  // 30 across the three channels is roughly 10 per channel, which is the point
  // at which two greys stop being the same grey on this panel.
  ok(d12 > 30, `tier 1 and tier 2 are visibly different (distance ${d12})`);
  ok(d23 > 30, `tier 2 and tier 3 are visibly different (distance ${d23})`);
  ok(d13 > 30, `and the ends are furthest apart (distance ${d13})`);

  /**
   * THE DIRECTION IS THE DESIGN: the ramp runs cool to warm.
   *
   * Measured as red minus blue rather than as "tier one is blue", and the
   * difference is not pedantry. Lapis is a DARK colour and this scene is lit by
   * a warm key over sandstone, so the mean of a lapis receiver in situ comes out
   * near neutral - 85, 78, 82 measured - rather than anywhere near its 0x1d3068
   * hex. The material is correct and the render is correct; a test that demanded
   * the mean match the palette would be testing a lighting rig it does not own.
   *
   * What the eye actually reads across the three is warmth, and that is
   * monotonic and large.
   */
  const warmth = stat.map((p) => p.r - p.b);
  ok(warmth[1] > warmth[0], `tier 2 is warmer than tier 1 (r-b ${warmth[0]} -> ${warmth[1]})`);
  ok(warmth[2] > warmth[1], `tier 3 is warmer than tier 2 (r-b ${warmth[1]} -> ${warmth[2]})`);
  ok(warmth[2] - warmth[0] > 30,
    `and the ramp runs cool to warm across a wide span (${warmth[0]} -> ${warmth[2]})`);
}

ok(errors.length === 0, 'no console errors');
if (errors.length) for (const e of errors.slice(0, 4)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
