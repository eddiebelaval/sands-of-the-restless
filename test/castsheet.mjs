/**
 * THE CAST SHEET: every character in the game, on one page, in the game's own light.
 *
 * The owner's ask: "Can I have a sprite sheet with every character that we've
 * got so I can judge it from there instead of trying to play the game to see
 * it."
 *
 * That is the right instrument and it is overdue. A gold scarab is 7% of spawns
 * at wave 20 and spends a quarter of its life off the floor, so the only way to
 * review one by playing is to survive fifteen waves and then get lucky while
 * being chased. Every art decision about that enemy has therefore been made
 * from code and from screenshots of something else.
 *
 * ---------------------------------------------------------------------------
 * IT SHOOTS THEM IN THE GAME'S LIGHT, NOT IN A STUDIO
 * ---------------------------------------------------------------------------
 *
 * This is the whole design of the tool and it is the opposite of what a model
 * viewer does.
 *
 * A neutral three-point studio would flatter everything and answer no question
 * anybody has. The live question right now is "why is the gold scarab black",
 * and the answer is suspected to be `scene.environmentIntensity = 0.17` in
 * main.js - a metal with nothing to reflect is a dark object no matter what its
 * colour says. A studio rig with its own environment would light that problem
 * away and report that the beetle is beautifully gold.
 *
 * So: the real scene, the real lights, the real post chain, the real fog. Each
 * actor is placed a fixed distance in front of the live camera and photographed
 * where the player would meet it. What comes out is what the player sees.
 *
 * Not a test. A tool. Nothing here asserts; it writes one PNG and prints paths.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS, dismissBriefing } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4191/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;

/** How far in front of the camera a subject is staged, in metres. */
const RANGE = { small: 2.6, tall: 4.6, god: 9.0 };

/** Which boss wave produces which god. */
const GOD_WAVES = [5, 10, 15, 20, 25];

const CELL = 300;          // px per cell in the finished sheet
const COLS = 4;

/**
 * ---------------------------------------------------------------------------
 * TWO SHEETS, AND THE SECOND ONE IS THE WHOLE REASON THIS FILE WAS REOPENED
 * ---------------------------------------------------------------------------
 *
 * The tool above was written to answer "why is the gold scarab black" and then
 * only ever shot in ONE lighting condition - the courtyard, where the beetle is
 * fine and where nobody has a question. The room the player actually meets a
 * gold scarab in from wave fifteen is the interior, and the interior is not the
 * courtyard turned down: `INTERIOR_ENV = 0.05` in systems/spaces.js against the
 * courtyard's `scene.environmentIntensity = 0.17` in main.js. Three and a half
 * times less environment for a shell at metalness 0.90, which has almost
 * nothing BUT the environment.
 *
 * So every actor is now photographed twice, in both, and the pair is the
 * argument. A single sheet can be explained away; two sheets of the same body
 * in the same pose under the two lights the game actually has cannot.
 */
const SPACES = [
  { id: 'exterior', label: 'THE COURTYARD', at: null },
  // The Hall of Offerings. 38 x 18, 9 m ceiling, base 0, and the room
  // test/wallcrawl.mjs fights its gold scarabs in.
  { id: 'interior', label: 'THE HALL OF OFFERINGS', at: { x: -45, z: -144, rot: 0 } },
];

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--disable-gpu-sandbox'],
});
/**
 * 800 x 500, DOWN FROM 1280 x 800, AND IT IS NOT A COSMETIC CHOICE.
 *
 * At 1280 x 800 the renderer process CRASHED partway through the first space -
 * "Target crashed", not a timeout - and took the whole sheet with it. At
 * 960 x 600 the courtyard finished and the INTERIOR crashed it, which is the
 * telling half: the interior carries a second world's geometry and comes up
 * through a transition that makes both live at once, so it is the peak of the
 * run and the exterior number never predicts it.
 *
 * 800 x 500 is 0.40 megapixels against 1.02, and it is the viewport
 * test/goldscarab.mjs has been driving through the same two spaces all night
 * without a crash. Swiftshader draws every fragment on the CPU and the composer
 * holds several full-size targets alongside the page's own backing store, so
 * this is 61 per cent off all of it.
 *
 * It costs nothing that matters. Each subject is staged a fixed number of metres
 * in front of the camera and the cell is cropped around it, so the body is the
 * same size in the sheet either way; only the surrounding room is tighter.
 */
const VIEW = { width: 800, height: 500 };
const page = await browser.newPage({ viewport: VIEW });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start());
/**
 * THE BOOT CONTRACT. `start()` finishes the briefing card in the same tick, but
 * this is the call that keeps the file correct when that seam moves - and it
 * did move, on 2026-08-08, and took a night off three lanes.
 */
await dismissBriefing(page);
await page.waitForFunction(() => window.__SANDS__.frameNo > 3, null, { timeout: 420000 });

/**
 * Freeze everything that would move the subject or the frame between placing it
 * and photographing it.
 *
 * THE GOVERNOR IS ONE OF THEM, and it is not obvious. It watches the rolling
 * median frame time and drops GTAO, shadow resolution, bloom, SMAA and finally
 * the pixel ratio; under swiftshader it walks the whole ladder DURING a run, so
 * two cells of one sheet can be shot at two different qualities and the sheet
 * silently stops being a comparison. Pinned at the bottom rung, which is where
 * it ends up here anyway, and then stood down. `actor.setFidelity` is
 * `castShadow` and nothing else, so no material on any cast member moves with
 * it.
 */
await page.evaluate(() => {
  const g = window.__SANDS__;
  g.governor.force(6);
  g.governor.yieldToPlayer();
  g.__castHold = {
    viewmodel: g.viewmodel.update,
    post: g.post.update,
  };
  // The hands are not cast members and they cover a third of the frame.
  g.viewmodel.update = () => {};
  if (g.viewmodel.group) g.viewmodel.group.visible = false;
  // The damage wash and the grain would make two captures of one pose differ.
  g.post.update = () => {};
  const hud = document.getElementById('hud');
  if (hud) hud.style.opacity = '0';
});

/** Wait for N more RENDERED frames. Never a timer: see the note in hold(). */
async function waitFrames(n = 1) {
  const from = await page.evaluate(() => window.__SANDS__.frameNo);
  await page.waitForFunction((f) => window.__SANDS__.frameNo >= f, from + n, { timeout: 420000 });
}

/**
 * Move the camera into a space and wait for the curtain to be DOWN.
 *
 * spaces.enter() slams the curtain to full black and reveals it over simulated
 * seconds. A timer here would photograph a black rectangle and file it as
 * evidence that the cast is black, which is precisely the defect this tool
 * exists to investigate. So the wait is on `spaces.transition.veil`.
 */
async function enterSpace(space) {
  await page.evaluate(({ id, at }) => {
    const g = window.__SANDS__;
    g.director.reset();
    if (g.spaces.active !== id) g.spaces.enter(id, at || undefined);
    if (at) { g.player.position.x = at.x; g.player.position.z = at.z; }
    g.director.state.timer = 1e9;
  }, space);

  await page.waitForFunction(
    (id) => {
      const g = window.__SANDS__;
      return g.spaces.active === id && g.spaces.transition.veil <= 0.01;
    },
    space.id,
    { timeout: 300000 }
  );

  return page.evaluate(() => ({
    env: +window.__SANDS__.scene.environmentIntensity.toFixed(4),
    room: window.__SANDS__.spaces.roomId || '-',
  }));
}

/**
 * Stage one subject in front of the camera and hold it there.
 *
 * Placement is computed FROM the live camera each frame rather than from world
 * coordinates, so the subject is centred whatever the player happens to be
 * looking at, and the actor's own AI cannot walk it out of frame between the
 * placement and the shutter.
 */
async function hold(kind, id, range) {
  /*
   * THE PINNING IS DRIVEN FROM NODE, NOT FROM ONE LONG evaluate().
   *
   * The first cut awaited fourteen requestAnimationFrames inside a single
   * evaluate. Under swiftshader a frame here is well over a second, so that one
   * call held the page busy for roughly twenty seconds and the screenshot that
   * followed timed out at thirty every single time. Same lesson the briefing
   * card taught earlier tonight: never count frames on a machine whose frames
   * are not the player's.
   *
   * So each evaluate does one cheap thing and returns, and the waiting happens
   * out here where it costs nothing.
   */
  const staged = await page.evaluate(({ kind, id }) => {
    const g = window.__SANDS__;

    // Clear the field so nothing else wanders into the shot.
    for (const a of (g.director.live || [])) {
      if (a && a.live && a !== g.director.boss) { try { a.hurt(1e9, 'body', 0, 0); } catch {} }
    }

    let actor = null;
    if (kind === 'god') {
      g.director.forceWave(id);
      for (let i = 0; i < 60; i++) g.director.update(1 / 30, i / 30);
      actor = g.director.boss;
    } else {
      g.director.spawnOne(id);
      const live = g.director.live || [];
      for (let i = live.length - 1; i >= 0; i--) {
        if (live[i] && live[i].live && live[i].variant === id) { actor = live[i]; break; }
      }
    }
    window.__castActor = actor;
    return { ok: !!actor };
  }, { kind, id });

  if (!staged.ok) return { ok: false };

  /** One placement, cheap, returning where the subject landed on screen. */
  const pin = () => page.evaluate((range) => {
    const g = window.__SANDS__;
    const actor = window.__castActor;
    if (!actor || !actor.live) return { ok: false };

    const cam = g.camera;
    const dir = new g.THREE.Vector3();
    cam.getWorldDirection(dir);
    dir.y = 0; dir.normalize();

    actor.position.x = cam.position.x + dir.x * range;
    actor.position.z = cam.position.z + dir.z * range;
    // Face the camera, so the sheet shows the silhouette the player meets.
    if (actor.group) actor.group.rotation.y = Math.atan2(-dir.x, -dir.z);

    const p = new g.THREE.Vector3(actor.position.x, actor.position.y, actor.position.z);
    p.project(cam);
    return {
      ok: true,
      sx: (p.x * 0.5 + 0.5) * window.innerWidth,
      sy: (-p.y * 0.5 + 0.5) * window.innerHeight,
      health: actor.health,
    };
  }, range);

  // Three placements with a RENDERED FRAME between them: the actor's own AI
  // walks it off the mark between frames, so the LAST pin is the one the
  // shutter sees.
  //
  // Waiting on `frameNo` rather than on 220 ms, because 220 ms is not a frame
  // here - it is roughly an eighth of one. A wait that is shorter than the
  // thing it is waiting for is not a wait, and this file already carries the
  // note about counting frames on a machine whose frames are not the player's.
  let out = { ok: false };
  for (let i = 0; i < 3; i++) {
    out = await pin();
    if (!out.ok) return { ok: false };
    await waitFrames(1);
  }
  return await pin();
}

/** Photograph a square around a screen point, clamped to the viewport. */
async function shoot(sx, sy, size) {
  const half = size / 2;
  const x = Math.max(0, Math.min(VIEW.width - size, Math.round(sx - half)));
  const y = Math.max(0, Math.min(VIEW.height - size, Math.round(sy - half)));
  // Generous timeout and no animation waiting: swiftshader frames are slow and
  // the page is deliberately still by this point.
  const buf = await page.screenshot({
    clip: { x, y, width: size, height: size },
    timeout: 420000,
    animations: 'disabled',
  });
  return buf.toString('base64');
}

const CAST = [
  { kind: 'variant', id: 'shambler',   label: 'SHAMBLER',    wave: 1,  range: RANGE.tall, box: 300 },
  { kind: 'variant', id: 'scarab',     label: 'SCARAB',      wave: 4,  range: RANGE.small, box: 220 },
  { kind: 'variant', id: 'husk',       label: 'HUSK',        wave: 6,  range: RANGE.tall, box: 300 },
  { kind: 'variant', id: 'bound',      label: 'BOUND',       wave: 10, range: RANGE.tall, box: 300 },
  { kind: 'variant', id: 'goldscarab', label: 'GOLD SCARAB', wave: 15, range: RANGE.small, box: 220 },
  { kind: 'variant', id: 'censer',     label: 'CENSER',      wave: 20, range: RANGE.tall, box: 300 },
];
for (const w of GOD_WAVES) {
  CAST.push({ kind: 'god', id: w, label: `GOD - WAVE ${w}`, wave: w, range: RANGE.god, box: 420 });
}


/**
 * `--only=goldscarab,scarab` shoots a subset.
 *
 * The full cast in two lighting conditions is twenty-two captures and the gods
 * are the expensive ones. When the question is about ONE body - and it usually
 * is, and today it is the gold scarab - the rest of the sheet is a tax on
 * finding out.
 */
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()) : null;
const ROSTER = ONLY ? CAST.filter((c) => ONLY.includes(String(c.id))) : CAST;

// ---------------------------------------------------------------------------
// compose
// ---------------------------------------------------------------------------

/** Lay a set of captures out on one page and return it as base64 PNG. */
async function compose(cells, title, subtitle) {
  return page.evaluate(async ({ cells, CELL, COLS, title, subtitle }) => {
    const rows = Math.ceil(cells.length / COLS);
    const PAD = 14;
    const LABEL = 30;
    const HEAD = 54;
    const c = document.createElement('canvas');
    c.width = COLS * CELL + PAD * (COLS + 1);
    c.height = HEAD + rows * (CELL + LABEL) + PAD * (rows + 1);
    const x = c.getContext('2d');

    x.fillStyle = '#0b0908';
    x.fillRect(0, 0, c.width, c.height);

    x.fillStyle = 'rgb(232,191,85)';
    x.font = 'bold 20px monospace';
    x.fillText(title, PAD, 30);
    x.fillStyle = 'rgba(160,139,100,0.9)';
    x.font = '12px monospace';
    x.fillText(subtitle, PAD, 46);

    for (let i = 0; i < cells.length; i++) {
      const f = cells[i];
      const col = i % COLS, row = (i / COLS) | 0;
      const cx = PAD + col * (CELL + PAD);
      const cy = HEAD + PAD + row * (CELL + LABEL + PAD);

      x.strokeStyle = 'rgba(217,178,106,0.22)';
      x.lineWidth = 1;
      x.strokeRect(cx + 0.5, cy + 0.5, CELL, CELL);

      if (f.png) {
        const img = new Image();
        img.src = 'data:image/png;base64,' + f.png;
        await img.decode();
        x.drawImage(img, cx, cy, CELL, CELL);
      } else {
        x.fillStyle = 'rgba(224,86,60,0.75)';
        x.font = '13px monospace';
        x.fillText('NOT CAPTURED', cx + 12, cy + CELL / 2);
      }

      x.fillStyle = 'rgb(217,178,106)';
      x.font = 'bold 14px monospace';
      x.fillText(f.label, cx + 2, cy + CELL + 18);
      x.fillStyle = 'rgba(160,139,100,0.9)';
      x.font = '12px monospace';
      x.fillText(`wave ${f.wave}`, cx + 2, cy + CELL + 31);
    }

    return c.toDataURL('image/png').split(',')[1];
  }, { cells, CELL, COLS, title, subtitle });
}

// ---------------------------------------------------------------------------
// shoot
// ---------------------------------------------------------------------------

const { writeFileSync } = await import('node:fs');
const written = [];

for (const space of SPACES) {
  const where = await enterSpace(space);
  console.log('');
  console.log(`${space.label}  -  scene.environmentIntensity ${where.env}`
    + (where.room !== '-' ? `, room ${where.room}` : ''));

  const cells = [];
  for (const c of ROSTER) {
    const h = await hold(c.kind, c.id, c.range);
    if (!h.ok) { console.log(`  MISSING  ${c.label}`); cells.push({ ...c, png: null }); continue; }
    /**
     * A CAPTURE THAT TIMES OUT MUST NOT TAKE THE SHEET WITH IT.
     *
     * The god at wave 10 produced a frame this machine could not finish inside
     * two minutes and the whole tool died on it, throwing away the seven cells
     * it had already taken - including the gold scarab, which is the one body
     * anybody had asked about. A missing cell is a red rectangle that says so.
     */
    let png = null;
    try {
      png = await shoot(h.sx, h.sy, c.box);
      console.log(`  captured ${c.label.padEnd(12)} hp ${String(Math.round(h.health)).padStart(6)}`);
    } catch (e) {
      console.log(`  TIMED OUT ${c.label.padEnd(12)} ${String(e).split('\n')[0]}`);
    }
    cells.push({ ...c, png });
  }

  const sheet = await compose(
    cells,
    `SANDS OF THE RESTLESS - THE CAST IN ${space.label}`,
    `the game's own light. scene.environmentIntensity ${where.env}. governor pinned on rung "low".`
  );
  const path = `${OUT}cast-sheet-${space.id}.png`;
  writeFileSync(path, Buffer.from(sheet, 'base64'));
  written.push(path);
}

console.log('');
for (const p of written) console.log(p);
if (errors.length) { console.log(''); for (const e of errors.slice(0, 4)) console.log(`  err ${e}`); }
await browser.close();
