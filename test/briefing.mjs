/**
 * DOES THE BRIEFING ACTUALLY REACH A PLAYER.
 *
 * This file exists because `__SANDS__.start()` deliberately bypasses the card.
 * Nineteen suites drive a running game through that entry and none of them
 * should hang on a classified document, so the harness entry starts the run and
 * dismisses the briefing in the same tick. That seam is only honest while
 * SOMETHING covers the path it skips, and this is that something.
 *
 * So: this suite never calls `__SANDS__.start()`. It clicks the real `#begin`
 * button, the way a player does, and measures what happens to the screen.
 *
 * ---------------------------------------------------------------------------
 * THE CONTROLS, WHICH ARE THE POINT
 * ---------------------------------------------------------------------------
 *
 * Three defects this month passed a green harness, every one of them because
 * the harness measured what the code reported about itself. The specific traps
 * available here:
 *
 *   A CARD THAT WAS ALWAYS THERE would pass any "is it visible" check. So the
 *   first assertions run BEFORE the click and require it absent and empty.
 *
 *   A CARD THAT DUMPS ALL ITS TEXT AT ONCE would pass any "does the text
 *   render" check, and the entire design of this surface is that it reveals at
 *   reading speed. So the reveal is sampled twice and required to have GROWN,
 *   with neither sample complete.
 *
 *   A CARD THAT RENDERS INTO A HIDDEN ELEMENT passes every DOM check ever
 *   written. So the sheet is screenshotted and its pixels are measured against
 *   the black it sits on. That is the check that cannot be satisfied by a lie.
 *
 *   A CARD THAT DOES NOT HOLD THE WORLD BACK would look identical in every
 *   screenshot and be a completely different game. So the HUD and the input
 *   layer are read DURING the card and required to be shut.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

/** The seven, in the order the sheet prints them. Asserted, not derived. */
const EXPECTED = ['ADLER', 'HOLM', 'MARCHETTI', 'NAKASHIMA', 'OYELARAN', 'PORTER', 'VANCE'];

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let pass = 0, fail = 0;
/** Characters in the complete sheet, measured on the first run. */
let fullPrinted = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });

// Start from a clean save so the first-run reveal is what we measure. A second
// run fills the sheet instantly by design, which would silently defeat the
// growth control below.
await page.evaluate(() => window.__SANDS__.save.clear());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });

// ---------------------------------------------------------------- control A
// Nothing before the click.
{
  const before = await page.evaluate(() => {
    const root = document.getElementById('briefing');
    const sheet = document.querySelector('[data-briefing-sheet]');
    return {
      exists: !!root,
      on: root ? root.classList.contains('on') : null,
      boxes: root ? root.getClientRects().length : -1,
      text: sheet ? sheet.textContent.trim() : null,
      phase: window.__SANDS__.briefing.stats().phase,
    };
  });

  ok(before.exists === true, 'the card is built at boot');
  ok(before.on === false, 'CONTROL: and is NOT showing before the player begins');
  ok(before.text === '', 'CONTROL: and holds no text at all');
  ok(before.phase === 'none', `CONTROL: its phase is idle (${before.phase})`);
}

// ------------------------------------------------------------------ the click
// The real button, the way a player reaches it.
await page.click('#begin');

/*
 * WAIT FOR THE FIRST CHARACTER RATHER THAN FOR A FIXED TIME.
 *
 * The first cut sampled at a flat 450 ms and read zero, every run. That was the
 * harness being unfair rather than the card being broken: the click that starts
 * a run also builds the world and compiles shaders, and under swiftshader the
 * first animation frame after it can be most of a second away. A fixed sample
 * was measuring the machine.
 *
 * So it waits for the reveal to genuinely begin and REPORTS how long that took,
 * which is a number worth having on its own - it is the delay a player sees
 * between pressing BEGIN and the game saying anything.
 */
const clicked = Date.now();
await page.waitForFunction(() => window.__SANDS__.briefing.stats().printed > 0,
  null, { timeout: 20000 });
const firstInk = Date.now() - clicked;

const first = await page.evaluate(() => {
  const s = window.__SANDS__.briefing.stats();
  const hud = document.getElementById('hud');
  return {
    phase: s.phase,
    printed: s.printed,
    ticks: s.ticks,
    index: s.index,
    lines: s.lines,
    hudHidden: !!(hud && hud.hidden),
    locked: !!window.__SANDS__.input.state.locked,
    veilHidden: !!document.getElementById('veil').hidden,
  };
});

ok(first.veilHidden === true, 'the title screen is gone');
ok(first.phase === 'typing', `the card is revealing (${first.phase})`);
ok(first.printed > 0, `it has printed something (${first.printed} chars)`);
ok(first.printed < 400, `CONTROL: and NOT the whole sheet at once (${first.printed})`);
ok(firstInk < 4000, `first character within four seconds of BEGIN (${firstInk} ms, swiftshader)`);

// ---------------------------------------------------------------- control D
// The world is held back while the card is up.
ok(first.hudHidden === true, 'CONTROL: the HUD is shut while the card is up');
ok(first.locked === false, 'CONTROL: and the player does not have the mouse');

// ---------------------------------------------------------------- control B
//
// IT GROWS - WAITED FOR, NOT SAMPLED. This is the check a dump-it-all-at-once
// card fails, and it is the FOURTH assertion in this file to have been written
// as a fixed-time sample and then rewritten. The lesson is identical every
// time: a wall-clock deadline on a swiftshader machine running three other
// agents measures the machine.
//
// The specific failure this replaces: both samples read 37 characters, because
// 37 is the whole first line and the second sample landed inside the beat that
// follows it. The card was correct and the test was not.
const grew = await page.waitForFunction(
  (base) => window.__SANDS__.briefing.stats().printed > base,
  first.printed, { timeout: 30000 },
).then(() => true).catch(() => false);

const second = await page.evaluate(() => window.__SANDS__.briefing.stats());

console.log('');
console.log(`  first sample   ${String(first.printed).padStart(4)} chars   ${first.ticks} ticks   line ${first.index}/${first.lines}`);
console.log(`  after growth   ${String(second.printed).padStart(4)} chars   ${second.ticks} ticks   line ${second.index}/${second.lines}`);
console.log('');

ok(grew, `CONTROL: the reveal GREW (${first.printed} -> ${second.printed} chars)`);

/*
 * TICKS ARE RATE LIMITED, SO "more ticks" IS THE WRONG ASSERTION.
 *
 * The reported bug was that the intro "tweaks out and gets stuck and stutters",
 * and one of its two causes was this file's own subject: a codec tick per
 * character at up to 90 characters a second, capped only per frame, allocating
 * an oscillator, a filter and a gain apiece. TICK_MIN_MS now floors the gap
 * between two ticks at 42 ms.
 *
 * So the meaningful claim is no longer "it ticked more", it is "it ticks, and
 * it never ticks faster than the floor". A regression that removed the limiter
 * would fail the second half; a regression that muted the card would fail the
 * first.
 */
// MEASURED OVER PROGRESS, NOT OVER A STOPWATCH, for the same reason as
// everything else in this file. A two-second window read 0.0 ticks per second
// and the card was fine: swiftshader delivers a frame roughly every 1.4
// seconds, so the FRAME RATE is the binding constraint here and not the
// limiter. Waiting for the document to move several lines gives the mechanism
// something to be measured across on any machine.
{
  const t0 = await page.evaluate(() => window.__SANDS__.briefing.stats());
  const start = Date.now();
  const target = Math.min(t0.index + 4, t0.lines - 1);
  await page.waitForFunction((n) => window.__SANDS__.briefing.stats().index >= n,
    target, { timeout: 40000 }).catch(() => {});
  const t1 = await page.evaluate(() => window.__SANDS__.briefing.stats());
  const secs = Math.max(0.001, (Date.now() - start) / 1000);
  const rate = (t1.ticks - t0.ticks) / secs;

  console.log(`  ticks ${t0.ticks} -> ${t1.ticks} across lines ${t0.index} -> ${t1.index}`);
  console.log(`  tick rate ${rate.toFixed(1)}/s (limiter ceiling ${(1000 / 42).toFixed(1)}/s)`);
  console.log('');

  ok(t1.ticks > t0.ticks,
    `the card is audible while it types (${t0.ticks} -> ${t1.ticks} ticks over ${t1.index - t0.index} lines)`);
  ok(rate <= 1000 / 42 + 2,
    `CONTROL: and never exceeds the rate limiter (${rate.toFixed(1)}/s against a ${(1000 / 42).toFixed(1)}/s ceiling)`);
}

/*
 * PROGRESSION IS WAITED FOR, NOT SAMPLED AT A FIXED TIME - for the third time
 * in this file, and the lesson is the same one each time.
 *
 * A flat "is it past line 0 by 1.85 seconds" failed here, and the card was
 * fine: swiftshader delivers an animation frame roughly every 1.4 seconds
 * while the world renders behind the black, so the reveal resolves about a line
 * per frame. That is a statement about the test machine, not about the design,
 * and on real hardware at 60fps the same code reveals at the authored rate.
 *
 * What is worth asserting is that the document ADVANCES AT ALL, which is the
 * thing that would break if a line never finished or a beat never expired.
 */
{
  const t0 = Date.now();
  let reached = true;
  try {
    await page.waitForFunction(() => window.__SANDS__.briefing.stats().index >= 3,
      null, { timeout: 25000 });
  } catch { reached = false; }
  const took = Date.now() - t0;
  ok(reached, `the document advances under its own power (line 3 reached in ${took} ms)`);
}

// ---------------------------------------------------------------- control C
// PIXELS. A card rendering into a hidden element passes every DOM check.
{
  /*
   * DO NOT HURRY BEFORE PHOTOGRAPHING. This is measured on the card as it
   * naturally reveals.
   *
   * Two earlier versions of this block pressed a key to fill the sheet first,
   * and both photographed the wrong thing. Hurrying calls fill() and then
   * IMMEDIATELY starts the clearing fade - so every millisecond spent waiting
   * for the fill to render is a millisecond of the sheet fading out from under
   * the shutter. The measurement drifted from 3.97% ink coverage down to 0.41%,
   * a hair over its 0.4% floor, and nothing about the card had changed.
   *
   * Waiting for the reveal to reach the manifest instead measures a real frame
   * of a real player's screen, with no interference at all.
   */
  await page.waitForFunction(() => window.__SANDS__.briefing.stats().index >= 16,
    null, { timeout: 60000 }).catch(() => {});

  const shot = await page.screenshot({ clip: { x: 190, y: 120, width: 720, height: 440 } });
  const px = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;

    let lit = 0, total = 0, sumR = 0, sumB = 0;
    for (let i = 0; i < d.length; i += 4) {
      total++;
      // Anything meaningfully above the near-black wash is ink.
      if (d[i] + d[i + 1] + d[i + 2] > 96) { lit++; sumR += d[i]; sumB += d[i + 2]; }
    }
    return { lit, total, warmth: lit ? (sumR - sumB) / lit : 0 };
  }, shot.toString('base64'));

  const frac = px.lit / px.total;
  console.log(`  ink coverage ${(frac * 100).toFixed(2)}%   warmth R-B ${px.warmth.toFixed(1)}`);
  console.log('');

  ok(frac > 0.004, `CONTROL: there is actually ink on the screen (${(frac * 100).toFixed(2)}% of the crop)`);
  ok(px.warmth > 20, `CONTROL: and it is gold, not white (R-B ${px.warmth.toFixed(1)})`);
}

// --------------------------------------------------------------- the setup
//
// REWRITTEN with the card. This block used to assert seven names and their
// specialities. The owner's verdict on that version was that it "doesn't set up
// a story, doesn't set up anything", and he was right - so what is checked now
// is that the card ANSWERS THE QUESTIONS AN OPENING HAS TO ANSWER, which is the
// job it failed. The names moved to the camp crates and test/camp.mjs owns them.
{
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__SANDS__.briefing.stats().printed > 250,
    null, { timeout: 30000 }).catch(() => {});

  const sheet = await page.evaluate(() => {
    const el = document.querySelector('[data-briefing-sheet]');
    // JOINED WITH A SPACE, not read as textContent. Each line is its own
    // element, so textContent runs the last word of one line into the first
    // word of the next - "the dead,and they are awake" - and a regex spanning a
    // line break silently never matches.
    const all = [...el.children].map((c) => c.textContent.trim()).filter(Boolean).join(' ');
    return { all: all.replace(/\s+/g, ' ').trim(), lines: el.children.length };
  });

  console.log('');
  console.log(`  the card, in full: "${sheet.all}"`);
  console.log('');

  const asks = [
    [/GIZA/i,                        'WHERE: it names the place'],
    [/seven went down/i,             'WHAT HAPPENED: seven went down'],
    [/none came back/i,              '  and none came back'],
    [/file was closed/i,             'THE COVER-UP: one line, unexplained'],
    [/four days later/i,             'WHEN: four days later'],
    [/stood up in the sand/i,        'WHO: one of them stood up'],
    [/does not remember/i,           'WHY LOST: he remembers none of it'],
    [/still down there, waiting/i,   'THE WANT: a woman is still down there'],
    [/dead,? and they are awake/i,   'THE OBSTACLE: the dead are awake'],
  ];
  for (const [re, what] of asks) ok(re.test(sheet.all), what);

  // LENGTH IS A REQUIREMENT NOW, not an accident. "It's too long" was half the
  // complaint, so the ceiling is asserted rather than left to drift back.
  fullPrinted = await page.evaluate(() => window.__SANDS__.briefing.stats().printed);
  const words = sheet.all.split(/\s+/).filter(Boolean).length;
  console.log(`  ${words} words, ${sheet.lines} lines`);
  console.log('');
  ok(words < 90, `SHORT: the whole card is ${words} words (was roughly twice that)`);

  ok(!/gate|gatekeeper|Ancient|Area 51|parallel|universe/i.test(sheet.all),
    'CONTROL: and it still spends NOTHING - no gate, no gatekeeper, no Area 51');
  ok(!/ADLER|MARCHETTI|NAKASHIMA|OYELARAN/i.test(sheet.all),
    'CONTROL: the personnel table is gone; the crates carry the names now');
}

// ------------------------------------------------------------ the handover
{
  // Run it out to the slug and the armed button. Each press advances one phase
  // and the waits are generous, because swiftshader frames are slow and this
  // suite is measuring the card's design rather than its frame budget.
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(900);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(900);

  const armed = await page.evaluate(() => {
    const root = document.getElementById('briefing');
    const slug = document.querySelector('[data-briefing-slug]');
    return {
      phase: window.__SANDS__.briefing.stats().phase,
      slug: slug ? slug.textContent.trim() : '',
      armed: root.classList.contains('armed'),
    };
  });

  ok(armed.slug === 'HE IS ONE OF THEM', `THE HOOK lands (${armed.slug})`);
  ok(armed.phase === 'waiting', `and the card waits for the player (${armed.phase})`);
  ok(armed.armed === true, 'and the confirm is armed');

  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => {
    const root = document.getElementById('briefing');
    const hud = document.getElementById('hud');
    return {
      phase: window.__SANDS__.briefing.stats().phase,
      on: root.classList.contains('on'),
      hudHidden: !!(hud && hud.hidden),
      flag: window.__SANDS__.save.getFlag('sawBriefing'),
      room: window.__SANDS__.spaces.active,
    };
  });

  ok(after.phase === 'done', 'it dismisses');
  ok(after.on === false, 'and leaves the screen');
  ok(after.hudHidden === false, 'THE WORLD IS HANDED OVER: the HUD comes up');
  ok(after.room === 'courtyard' || after.room === 'exterior',
    `and the player is outside (${after.room})`);
  ok(after.flag === true, 'and the save remembers it was read');
}

// -------------------------------------------------- a returning player
// Seen before means the sheet is already there. Still has to be dismissed:
// the document is evidence, and evidence a second-run player cannot re-read is
// evidence the game took away when it started to matter.
{
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
  await page.click('#begin');
  await page.waitForTimeout(260);

  const again = await page.evaluate(() => {
    const s = window.__SANDS__.briefing.stats();
    const sheet = document.querySelector('[data-briefing-sheet]');
    return {
      seen: s.seen, printed: s.printed, phase: s.phase,
      // Compared against the card's OWN count of the document rather than a
      // number typed in here, so adding a line to the sheet cannot fail this.
      rendered: sheet.children.length, expected: s.lines,
    };
  });

  ok(again.seen === true, 'a returning player is known');
  // Derived from the card, not a literal: the sheet was rewritten once already
  // and a hardcoded length is a check that fails for the wrong reason next time.
  ok(again.printed >= fullPrinted,
    `and gets the whole sheet at once (${again.printed} chars, full sheet is ${fullPrinted})`);
  ok(again.rendered === again.expected,
    `every line of it (${again.rendered}/${again.expected})`);
  ok(again.phase !== 'none', 'and still has to dismiss it');
}

ok(errors.length === 0, `no console errors (${errors.length})`);
if (errors.length) for (const e of errors.slice(0, 6)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
