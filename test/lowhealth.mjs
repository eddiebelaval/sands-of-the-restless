/**
 * DYING AND REVIVING, READ OFF THE SCREEN.
 *
 * The owner played the shipped build on 2026-08-12 and asked for a red vignette
 * that deepens as vitality drops - a feature systems/damage.js already had. It
 * was not missing, it was inaudible: the old floor produced about a sixteen
 * percent tint in the extreme corners at 20 of 100 health, on a sunlit desert
 * frame. Nobody could see it, including the person who wrote it.
 *
 * That is the failure this file exists to make impossible to repeat, so NOTHING
 * HERE ASSERTS ON A UNIFORM. `post.lowHealth()` would happily report 0.6 while
 * the shader multiplies it by a term that lands nowhere. Every check below is a
 * measurement of PIXELS, taken through the game's own composer.
 *
 * The second half of the ask was "I wanna see the red clear out, and we get
 * better - I wanna know when I'm dying and know when I'm reviving", so recovery
 * is measured as its own claim rather than assumed from the fall.
 *
 * THE INSTRUMENT. Redness is measured as R minus the mean of G and B, in an
 * EDGE band and separately in the CENTRE, because the two carry different
 * claims: the edge is the iris closing, and the centre is how much of the
 * player's view of the thing killing them has been eaten. A frame that simply
 * got darker moves neither, which is what makes this different from luminance.
 *
 * Usage: node test/lowhealth.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import sharp from 'sharp';
import { resolveChrome, GL_ARGS, dismissBriefing, waitForWorld } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4188/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;

const W = 1024;
const H = 640;

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`PASS  ${msg}`); }
  else { fail++; console.log(`FAIL  ${msg}`); }
}

const browser = await chromium.launch({ executablePath: resolveChrome(), args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start());
await dismissBriefing(page);
await waitForWorld(page);

/**
 * Redness of a band, and of the middle.
 *
 * `edge` is the outer eighth of the frame on all four sides; `centre` is the
 * middle third. Both are means of (R - (G+B)/2), which is zero on any grey or
 * white surface and rises only when the frame actually turns red.
 */
async function redness(name) {
  const buf = await page.screenshot();
  if (name) await sharp(buf).toFile(`${OUT}${name}.png`);
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const bx = Math.round(info.width / 8);
  const by = Math.round(info.height / 8);

  let eSum = 0, eN = 0, cSum = 0, cN = 0, lum = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const red = r - (g + b) / 2;
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const inEdge = x < bx || x >= info.width - bx || y < by || y >= info.height - by;
      const inMid = x > info.width / 3 && x < (info.width * 2) / 3
        && y > info.height / 3 && y < (info.height * 2) / 3;
      if (inEdge) { eSum += red; eN++; }
      if (inMid) { cSum += red; cN++; }
    }
  }
  return {
    edge: +(eSum / eN).toFixed(2),
    centre: +(cSum / cN).toFixed(2),
    luma: +(lum / (info.width * info.height)).toFixed(2),
  };
}

/**
 * Put the player at a health and let the effect settle.
 *
 * Drives `combat.update` directly at a fixed dt rather than waiting on real
 * frames: the ramp is authored in wall clock (LOW_RISE/LOW_FALL per second) and
 * one frame here can cost a second, so real frames would make "settled" a
 * property of the machine. This is the same reason test/serdabscene.mjs counts
 * milliseconds. The world still renders every frame underneath.
 */
async function atHealth(hp, seconds = 3) {
  await page.evaluate(async ({ hp, seconds }) => {
    const g = window.__SANDS__;
    g.player.state.health = hp;
    const n = Math.ceil(seconds / (1 / 60));
    for (let i = 0; i < n; i++) {
      // Health is pinned each step: REGEN would otherwise heal the player out
      // from under the measurement and this would be a test of regen.
      g.player.state.health = hp;
      g.combat.update(1 / 60);
    }
    /*
     * AND HELD PINNED AFTER THIS CALL RETURNS, WHICH IS THE PART THAT MATTERED.
     *
     * The screenshot is taken in a SEPARATE round trip, and the page's real
     * animation frame keeps running `combat.update` in between with health
     * nobody is pinning any more. Regeneration is 14 a second; on the
     * swiftshader boxes this project targets, where one frame can cost a
     * second, the row labelled "20 hp" could be photographed at thirty-something
     * and the headline check would fail on a build where the feature is fine.
     *
     * `sinceHit = 0` is the repo's own idiom for this (test/hud.mjs does the
     * same) and it buys REGEN_DELAY - five seconds of wall clock - with no
     * regeneration at all, which covers the screenshot and the uniform read
     * that follow. Health and `state.low` both stand still while they happen.
     */
    g.combat.state.sinceHit = 0;
    g.player.state.health = hp;
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
  }, { hp, seconds });
}

console.log('');
console.log('=== HOW RED, AT EVERY HEALTH A PLAYER PASSES THROUGH ===');
console.log('');

const LADDER = [100, 75, 50, 40, 30, 20, 10, 5];
const rows = [];
for (const hp of LADDER) {
  await atHealth(hp);
  const m = await redness(hp === 100 || hp === 20 ? `lowhealth-${hp}` : null);
  const chan = await page.evaluate(() => ({
    low: window.__SANDS__.post.lowHealth(),
    // The HIT channel, sampled at the same instant. See the check below.
    wash: window.__SANDS__.combat.state.wash,
  }));
  const low = chan.low;
  rows.push({ hp, ...m, low: +low.toFixed(3), wash: +chan.wash.toFixed(3) });
  console.log(`  ${String(hp).padStart(3)} hp   edge ${String(m.edge).padStart(7)}`
    + `   centre ${String(m.centre).padStart(7)}   luma ${String(m.luma).padStart(6)}`
    + `   uniform ${low.toFixed(3)}`);
}

const at = (hp) => rows.find((r) => r.hp === hp);

console.log('');

/*
 * EVERY REDNESS CLAIM IS RELATIVE TO THE HEALTHY FRAME, AND THAT IS THE POINT.
 *
 * The first cut of this file asserted `Math.abs(at(100).edge) < 2` on the idea
 * that an unaffected frame scores about zero. It scores 12.2. THE DESERT IS
 * RED - sandstone and low sun put R above the mean of G and B across the whole
 * picture - so that assertion was a test of the art direction, and it failed on
 * a build where the feature works perfectly.
 *
 * This is the third time in this project an ABSOLUTE threshold has been written
 * where a RELATIVE one was meant (see test/serdabscene.mjs on "flat black",
 * which tested PIGMENT.shadow rather than the wash). The baseline is measured,
 * not assumed, and every number below is a delta from it.
 */
const BASE_RED = at(100).edge;
const dEdge = (hp) => +(at(hp).edge - BASE_RED).toFixed(2);

console.log(`  baseline: a healthy desert frame already scores ${BASE_RED} red.`);
console.log('  every claim below is a DELTA from that.');
console.log('');

ok(at(100).low === 0,
  `CONTROL: at full health the effect is off (uniform 0, edge ${BASE_RED} = the desert)`);
ok(Math.abs(at(75).edge - BASE_RED) < 2,
  `CONTROL: nothing happens at 75 hp either (${dEdge(75) >= 0 ? '+' : ''}${dEdge(75)} on the baseline)`);
ok(at(50).low === 0,
  'and the effect starts AT half health, not above it');

// The ask: it gets redder as you die.
const falling = rows.filter((r) => r.hp <= 50);
let monotonic = true;
for (let i = 1; i < falling.length; i++) {
  if (falling[i].edge < falling[i - 1].edge - 0.5) monotonic = false;
}
ok(monotonic,
  `it deepens all the way down: ${falling.map((r) => `${r.hp}:${r.edge}`).join('  ')}`);

// LEGIBILITY, which is the whole reason this was rebuilt. The old build scored
// about a sixteen percent tint in the corners at 20 hp and the owner could not
// see it, so a threshold that merely beats zero is not good enough.
ok(dEdge(20) > 8,
  `AT 20 HP IT IS UNMISSABLE: +${dEdge(20)} over the desert's own red `
  + `(${at(20).edge} against ${BASE_RED}). The shipped build was invisible at this `
  + 'exact health, which is why this has a floor and not a sign test');
ok(at(5).edge > at(20).edge,
  `and a sliver is worse than a wound: ${at(5).edge} against ${at(20).edge}`);
ok(at(10).centre - at(100).centre > 3,
  `it reaches the MIDDLE of the frame, not just the corners `
  + `(centre +${(at(10).centre - at(100).centre).toFixed(2)} at 10 hp) - peripheral vision is `
  + 'the point, the player is looking at what is killing them');
ok(at(5).luma < at(100).luma,
  `and the frame closes DOWN rather than washing pink (luma ${at(5).luma} against ${at(100).luma})`);

/*
 * THE TWO CHANNELS STAY SEPARATE, AND THIS CHECK EXISTS BECAUSE THEY DID NOT.
 *
 * The first cut of this feature added uLowHealth and left the OLD health-driven
 * floor on `state.wash` in place, so both ramps drove red from the same health
 * at the same time. That is not merely redundant: `uDamage` widens chromatic
 * aberration sixfold (core/post.js), so a floor holding it at ~0.19 for as long
 * as the player sat at 20 health smeared the frame permanently - the exact
 * failure the separate channel was written to prevent. It survived writing,
 * measuring and a full green suite, because every check here measured REDNESS
 * and redness looked correct with two ramps feeding it.
 *
 * So: with no hit for three seconds, the HIT channel must be at zero at every
 * health on the ladder. If someone reintroduces a floor, this is what fails.
 */
const washAtRest = rows.filter((r) => r.wash > 0.001);
ok(washAtRest.length === 0,
  `the hit channel is silent when nothing has hit you, at every health `
  + `(${washAtRest.length ? washAtRest.map((r) => `${r.hp}hp:${r.wash}`).join(' ') : 'all zero'}) `
  + '- two ramps driving one colour is how the aberration bug shipped');

console.log('');
console.log('=== AND THE RED CLEARS OUT WHEN YOU GET BETTER ===');
console.log('');

/*
 * The owner asked for this half explicitly. It is measured as a SEQUENCE rather
 * than an endpoint, because "it ends at zero" is also true of a red that
 * vanishes in one frame, and a recovery nobody can watch is not a recovery
 * signal - it is a bug that happens to end in the right state.
 */
await atHealth(5, 3);
const hurt = await redness('lowhealth-recovery-0');

const trace = await page.evaluate(async () => {
  const g = window.__SANDS__;
  // Full health, then watch the red drain. Health is pinned so this measures
  // the CLEARING and not the regen curve.
  g.player.state.health = g.player.state.maxHealth;
  const out = [];
  for (let step = 0; step < 6; step++) {
    for (let i = 0; i < 15; i++) { g.combat.update(1 / 60); }   // 0.25 s each
    out.push(+g.post.lowHealth().toFixed(3));
  }
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  return out;
});

const healed = await redness('lowhealth-recovery-1');
console.log(`  hurt   edge ${hurt.edge}   centre ${hurt.centre}`);
console.log(`  healed edge ${healed.edge}   centre ${healed.centre}`);
console.log(`  drain, every 0.25 s: ${trace.join('  ')}`);
console.log('');

ok(hurt.edge - BASE_RED > 8,
  `CONTROL: it really was red before the heal (+${(hurt.edge - BASE_RED).toFixed(2)})`);
ok(Math.abs(healed.edge - BASE_RED) < 2,
  `and a healed player gets the DESERT back, not a pink one `
  + `(${healed.edge} against the baseline ${BASE_RED})`);
ok(trace.length >= 3 && trace[0] > trace[1] && trace[1] > trace[2],
  `the clearing is WATCHABLE, not a snap: ${trace.slice(0, 3).join(' -> ')}`);
ok(trace[trace.length - 1] === 0,
  'and it reaches exactly zero rather than easing forever at a faint red');

/*
 * THE ASYMMETRY IS DELIBERATE AND IT IS ASSERTED, because it is the difference
 * between the two halves of the ask. Going red rides on a hit that already has
 * a flash; clearing is the only signal that says "you are coming back", so it
 * is slower on purpose. A future edit that makes them equal would pass every
 * check above and quietly delete the recovery read.
 */
/*
 * TIMED OFF `combat.state.low`, NOT off `post.lowHealth()`, AND THAT MATTERS.
 *
 * The first cut timed the uniform and got 0.788, 0.913, 0.994, 0.831, 0.826,
 * 0.991 - a rise that goes UP, DOWN and up again, which no ramp does. Below 22
 * per cent health the effect BREATHES (PULSE_HZ 1.15 in systems/damage.js), and
 * the uniform carries that breath while `state.low` does not. Timing a rate
 * against a signal with a sine riding on it measures the sine.
 *
 * Sampled at 0.1 s rather than 0.25 s for the same reason: LOW_RISE is 4.5 a
 * second, so the whole rise is over inside two of the old buckets and any
 * comparison between rise and fall was quantisation noise.
 */
const timings = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const settle = (hp, secs) => {
    for (let i = 0; i < Math.ceil(secs * 60); i++) {
      g.player.state.health = hp;
      g.combat.update(1 / 60);
    }
  };
  const sample = (hp, steps) => {
    const out = [];
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < 6; i++) { g.player.state.health = hp; g.combat.update(1 / 60); }
      out.push(+g.combat.state.low.toFixed(3));
    }
    return out;
  };

  settle(g.player.state.maxHealth, 4);           // fully clear
  const rise = sample(5, 14);                    // 1.4 s of going red
  settle(5, 3);                                  // fully red
  const fall = sample(g.player.state.maxHealth, 14);
  return { rise, fall };
});

console.log(`  rise, every 0.1 s: ${timings.rise.join(' ')}`);
console.log(`  fall, every 0.1 s: ${timings.fall.join(' ')}`);

const roseIn = timings.rise.findIndex((v) => v >= 0.85);
const fellIn = timings.fall.findIndex((v) => v <= 0.15);
ok(roseIn >= 0 && fellIn >= 0 && roseIn < fellIn,
  `going red is faster than coming back (${((roseIn + 1) * 0.1).toFixed(1)}s up against `
  + `${((fellIn + 1) * 0.1).toFixed(1)}s down) - the recovery is the only signal that says `
  + '"you are coming back", so it is slower ON PURPOSE and an edit that equalises them '
  + 'would pass every other check here while deleting the read');

console.log('');
ok(errors.length === 0, `no console errors (${errors.length})`);
if (errors.length) for (const e of errors.slice(0, 5)) console.log(`  err ${e}`);

console.log('');
console.log(`shots: lowhealth-100.png  lowhealth-20.png  lowhealth-recovery-0/1.png`);
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);

await browser.close();
process.exit(fail === 0 ? 0 : 1);
