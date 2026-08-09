/**
 * DOES SHE ACTUALLY SPEAK.
 *
 * Before this lane she said ONE thing in the whole game - the line the Kindling
 * interrupts - which meant the best beat in World 1 was a woman who had never
 * spoken being cut off and then not speaking again. `docs/PLAYTHROUGH.md`
 * finding 3 is the statement of that problem; this is the gate on the fix.
 *
 * ---------------------------------------------------------------------------
 * THE CONTROLS
 * ---------------------------------------------------------------------------
 *
 * "She spoke" is trivially satisfiable and proves almost nothing. The specific
 * traps here, each of which passes a naive check:
 *
 *   A LINE THAT FIRES ANYWHERE would pass "she said something in the gallery".
 *   So each line is checked against the room it was authored for.
 *
 *   A LINE THAT DROPS INSTEAD OF DEFERRING looks identical on a lucky run. A
 *   room is entered ONCE, so a line dropped for arriving mid-wave never exists
 *   again - and every player who moves quickly would lose four of the five. So
 *   the suite deliberately enters a room DURING a fight and proves the line is
 *   still owed afterwards.
 *
 *   A LINE THAT FIRES OVER A BOSS spends the pattern on the one wave nobody
 *   will hear it. Checked explicitly.
 *
 *   TEXT SET BUT NOT DRAWN is this project's signature defect. So the pill is
 *   read for its VISIBLE substring and its laid-out box, not for a variable.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4188/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start());
await page.waitForTimeout(900);

/**
 * Put the player in a room and let the REAL frame loop notice.
 *
 * Two things the first version of this helper got wrong, both of which made it
 * measure nothing while looking thorough:
 *
 *   `spaces.update` DOES NOT EXIST. The helper called it every iteration and
 *   that was a silent no-op, so the room tracker never ran and `spaces.roomId`
 *   stayed null through the whole suite.
 *
 *   ROOM BOUNDS ARE `{x, z, w, d}`, not `{x0, x1, z0, z1}`. Averaging the
 *   corners of a rectangle that has no corner fields produced NaN, the player
 *   was teleported to nowhere, and the centre of every room read as `null`.
 *
 * So: set the position from the real bounds, then WAIT IN WALL CLOCK and let
 * main.js's own loop do the tracking, which is also the only way this measures
 * the path a player takes rather than a path invented for the test.
 */
async function visit(roomId, { fighting = false } = {}) {
  const said0 = await page.evaluate(() => window.__SANDS__.voice.stats().said.length);
  await page.evaluate(({ roomId, fighting }) => {
    const g = window.__SANDS__;

    if (!fighting) {
      for (const a of (g.director.live || [])) {
        if (a && a.live) { try { a.hurt(1e9, 'body', 0, 0); } catch {} }
      }
      g.director.update(1 / 30, 0);
    }

    if (roomId === 'courtyard') {
      g.spaces.enter('courtyard');
      return;
    }
    g.spaces.enter('interior');
    const r = g.interior.rooms.find((x) => x.id === roomId);
    if (r) g.player.position.set(r.bounds.x, (r.base || 0) + 1.7, r.bounds.z);
  }, { roomId, fighting });

  /*
   * WAIT FOR HER TO SPEAK, do not sleep for a guess.
   *
   * A flat 900 ms failed every room after the first, and the voice layer was
   * behaving correctly: a line reveals for two to three seconds and then HOLDS
   * the pill for 1200 ms more, and `free()` refuses to start a second line
   * while the first is still up. So the harness walked into the next room while
   * she was mid-sentence, the new line deferred exactly as designed, and the
   * check called that a failure.
   *
   * Polling for the count to rise measures the thing that matters and reports
   * how long it took, on any machine.
   */
  await page.waitForFunction(
    (n) => window.__SANDS__.voice.stats().said.length > n,
    said0, { timeout: 25000 },
  ).catch(() => {});

  /*
   * AND THEN WAIT FOR THE REVEAL TO FINISH.
   *
   * `said` is recorded the instant `speak()` is called, at which point exactly
   * one character is on the pill. Reading the text there gave "i", "h", "y",
   * "d" - the first letter of each line - and reported four correct lines as
   * four failures. The count says she STARTED; `shown` says the player can read
   * it, and the player being able to read it is the claim under test.
   */
  await page.waitForFunction(() => {
    const t = window.__SANDS__.pacer.stats();
    return t.full && t.shown >= t.full.length;
  }, null, { timeout: 25000 }).catch(() => {});

  return page.evaluate(() => {
    const g = window.__SANDS__;
    const p = g.pacer.stats();
    const v = g.voice.stats();
    return {
      room: g.spaces.roomId,
      said: v.said, armed: v.armed, deferrals: v.deferrals,
      pill: { text: p.text, voice: p.voice, on: p.on, box: p.box },
    };
  });
}

const EXPECT = [
  ['courtyard', 'avenue', 'further back'],
  ['chamber-of-ascent', 'inside', "can't get the door open"],
  ['great-gallery', 'gallery', 'you sound-'],
  ['canopic-crypt', 'crypt', 'anything you'],
];

console.log('');
console.log('  room                  said            pill');

for (const [roomId, id, fragment] of EXPECT) {
  const r = await visit(roomId);
  const t = (r.pill.text || '').slice(0, 34);
  console.log(`  ${roomId.padEnd(20)} ${String(r.said.length).padStart(2)}/4            "${t}"`);

  ok(r.said.includes(id), `${roomId}: line "${id}" was spoken`);
  ok((r.pill.text || '').includes(fragment),
    `  and the PILL shows it (found "${fragment}")`);
  ok(r.pill.voice === 'her', `  in her voice, not the system's (${r.pill.voice})`);
  ok(r.pill.box && r.pill.box.w > 40,
    `  and it occupies a real box (${r.pill.box ? r.pill.box.w : 0} px wide)`);
}
console.log('');

// ---------------------------------------------------------------- lowercase
{
  const cased = await page.evaluate(() => {
    const el = document.getElementById('notice');
    const cs = getComputedStyle(el);
    return { transform: cs.textTransform, text: el.textContent };
  });
  console.log(`  notice text-transform: ${cased.transform}`);
  console.log(`  rendered: "${cased.text}"`);
  console.log('');
  ok(cased.transform !== 'uppercase',
    `her lines are NOT force-uppercased (${cased.transform})`);
  ok(cased.text === cased.text.toLowerCase(),
    'and what is on screen is genuinely lowercase, which is her whole attribution');
}

// ------------------------------------------------- CONTROL: defer, not drop
//
// The trap: a room is entered ONCE. If a line is dropped for arriving mid-wave
// it never exists again, and any player who moves quickly loses four of five.
{
  const r = await page.evaluate(async () => {
    const g = window.__SANDS__;
    g.voice.reset();

    // A live field, so the world is NOT quiet.
    g.director.forceWave(7);
    for (let i = 0; i < 90; i++) g.director.update(1 / 30, i / 30);

    /*
     * PARK IN A ROOM WITH NO LINE FIRST, so the entry into the crypt is a real
     * EDGE. The player is already standing in canopic-crypt when this block
     * starts - the previous section walked them there - and arming is
     * edge-triggered, so without a room in between this raced: sometimes the
     * reset landed before the tracker had moved and nothing armed at all, which
     * read as "dropped" on a run where nothing was ever offered.
     */
    g.spaces.enter('interior');
    const park = g.interior.rooms.find((x) => x.id === 'hall-of-offerings');
    if (park) g.player.position.set(park.bounds.x, (park.base || 0) + 1.7, park.bounds.z);
    await new Promise((r2) => setTimeout(r2, 700));

    const room = g.interior.rooms.find((x) => x.id === 'canopic-crypt');
    if (room) g.player.position.set(room.bounds.x, (room.base || 0) + 1.7, room.bounds.z);
    for (let i = 0; i < 40 && g.voice.stats().armed.length === 0; i++) {
      await new Promise((r2) => setTimeout(r2, 100));
    }
    const during = g.voice.stats();

    /*
     * CLEAR THE FIELD CONTINUOUSLY, not once.
     *
     * Killing every LIVE actor does not end a wave: the director still holds a
     * spawn queue, refills within a second, and never reaches the breather that
     * `quiet()` is waiting for. One sweep therefore looked like "she was
     * dropped" when she was correctly still waiting for a gap that the test was
     * preventing from ever occurring.
     *
     * Sweeping every tick is what a player does when they clear a round, and it
     * lets the queue drain to the breather the deferred line is owed.
     */
    /*
     * SWEEP ONLY UNTIL THE BREATHER OPENS, then stop and let her talk.
     *
     * Sweeping all the way through advances the WAVE - clearing a round fast
     * just starts the next one - and twenty seconds of it walked the director
     * from wave 7 to a boss wave, where `quiet()` correctly refuses to speak
     * forever. The test was manufacturing the exact condition it was asserting
     * against.
     */
    let phase = '', wave = 0, boss = false;
    for (let i = 0; i < 200 && g.voice.stats().said.length === 0; i++) {
      phase = g.director.state.phase;
      wave = g.director.state.wave;
      boss = !!g.director.boss;
      if (phase !== 'breather') {
        for (const a of (g.director.live || [])) {
          if (a && a.live && !a.dying) { try { a.hurt(1e9, 'body', 0, 0); } catch {} }
        }
      }
      await new Promise((r2) => setTimeout(r2, 100));
    }

    return { during, after: g.voice.stats(), pill: g.pacer.stats().text, phase, wave, boss };
  });

  console.log(`  entered mid-fight:  said ${r.during.said.length}, armed ${r.during.armed.length}, deferrals ${r.during.deferrals}`);
  console.log(`  after it cleared:   said ${r.after.said.length}, armed ${r.after.armed.length}  (phase ${r.phase}, wave ${r.wave}, boss ${r.boss})`);
  console.log('');

  ok(r.during.said.length === 0, 'CONTROL: a line does NOT fire into a live fight');
  ok(r.during.armed.length > 0, 'CONTROL: and it is held ARMED rather than thrown away');
  ok(r.during.deferrals > 0, `CONTROL: the deferral was counted (${r.during.deferrals})`);
  ok(r.after.said.length > 0,
    'AND IT ARRIVES once the field is clear - deferred, not dropped');
}

// ----------------------------------------------------- CONTROL: not over a boss
{
  const r = await page.evaluate(async () => {
    const g = window.__SANDS__;
    g.voice.reset();
    g.director.forceWave(5);           // a boss wave
    for (let i = 0; i < 90; i++) g.director.update(1 / 30, i / 30);

    g.spaces.enter('interior');
    const room = g.interior.rooms.find((x) => x.id === 'great-gallery');
    if (room) g.player.position.set(room.bounds.x, (room.base || 0) + 1.7, room.bounds.z);
    await new Promise((r2) => setTimeout(r2, 1000));
    return { boss: !!g.director.boss, stats: g.voice.stats() };
  });

  console.log(`  on a boss wave: boss live ${r.boss}, said ${r.stats.said.length}, armed ${r.stats.armed.length}`);
  console.log('');
  ok(r.boss, 'CONTROL: a god is actually on the field for this check');
  ok(r.stats.said.length === 0,
    'she does NOT speak over a boss, even the line flagged overFight');
  ok(r.stats.armed.length > 0, 'and the line is still owed afterwards');
}

ok(errors.length === 0, `no console errors (${errors.length})`);
if (errors.length) for (const e of errors.slice(0, 5)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
