/**
 * THE KEY BINDINGS, DRIVEN THROUGH THE REAL PANEL.
 *
 * The feature under test is a control centre: every keyboard action is
 * rebindable from the CONTROLS tab, the map persists, and a conflict is
 * announced rather than silently resolved. The way that feature fails is not
 * subtle and it is not new to this project - twelve times now something has been
 * written, looked correct, and never taken effect - so every claim here is made
 * against the running game rather than against the module that owns the data.
 *
 * WHAT THAT MEANS, CONCRETELY, AND WHY EACH RULE IS HERE:
 *
 *   NOTHING IS BOUND BY CALLING THE BINDER. A rebind is a real click on a real
 *   row followed by a real key event. keymap.bind() being correct says nothing
 *   about whether the row is wired to it, and the row is the whole feature: the
 *   panel is the only place a player can reach this.
 *
 *   A REBIND IS PROVED BY THE VERB, NOT BY THE TABLE. It is not enough that the
 *   table says reload is on M. The suite spends the magazine by holding the real
 *   mouse button through real frames, presses M, and watches the magazine come
 *   back - and then spends it again, presses the OLD key, and watches nothing
 *   happen. Half of that pair is the half that catches a handler which reads the
 *   table for the new key while something else still answers to the old one.
 *
 *   FRAMES ARE THE GAME'S, NOT OURS. `frames()` waits on __SANDS__.frameNo,
 *   which only advances when the loop that owns the simulation runs. Counting
 *   our own requestAnimationFrame callbacks proves the browser is painting and
 *   nothing else - the mistake that once produced twelve false failures in
 *   test/crouchslide.mjs by calling update() directly.
 *
 *   PERSISTENCE IS PROVED BY A REAL RELOAD. page.reload(), the game boots again
 *   from nothing, and the question asked afterwards is not "is the value in
 *   localStorage" but "does the rebound key still do the thing".
 *
 *   THE PANEL AND THE TABLE ARE READ SEPARATELY. What core/keymap.js holds and
 *   what the row DREW are two different facts, and the gap between them is this
 *   project's defining bug. Every binding assertion below compares both.
 *
 * The one path this suite cannot reach through the UI is the refusal of a fixed
 * binding, and that is a property of the design rather than a hole in the test.
 * The only fixed KEY is Escape, and Escape is how a capture is cancelled, so a
 * player can never ask for it. It is asserted at the table instead, and the
 * fixed MOUSE rows are asserted where a player meets them: clicking Fire does
 * not arm anything.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS } from './chrome.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const VIEW = { width: 1440, height: 860 };

/**
 * The URL, and the argument is READ.
 *
 * test/settings.mjs records the defect this line avoids: four suites in this
 * directory took a URL argument, ignored it, and quietly tested port 4177
 * instead of the tree they were handed. The pattern reappears in every new file
 * because each is written by copying the shape of an existing one.
 */
const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';

const failures = [];
let passed = 0;

function check(ok, label, detail = '') {
  if (ok) { passed++; console.log(`  ok    ${label}${detail ? `  ${detail}` : ''}`); return true; }
  failures.push(`${label}${detail ? `  ${detail}` : ''}`);
  console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  return false;
}

const browser = await chromium.launch({ executablePath: resolveChrome(), args: GL_ARGS });
const page = await browser.newPage({ viewport: VIEW });

/**
 * Thrown errors only, deliberately.
 *
 * Console noise under a software renderer is ANGLE talking about readbacks and
 * says nothing about the page - test/settings.mjs documents that exclusion at
 * length. An uncaught exception is a different thing entirely, and a corrupt
 * saved map that threw during boot would show up here and nowhere else.
 */
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

/**
 * A PAD THAT IS NOT THERE, installed before the game boots.
 *
 * The same synthetic controller test/rebind.mjs and test/gamepad.mjs use, and it
 * is installed as an init script so it survives every page.reload() this suite
 * performs - the persistence assertions would otherwise be made on a build with
 * no pad attached, and the pad half of the map would never be exercised at all.
 *
 * It reports the standard mapping, because that is what Chrome gives a DualShock
 * and what the button INDICES below mean. Index 0 is the bottom face button on
 * every controller ever made.
 */
const PAD = {
  cross: 0, circle: 1, square: 2, triangle: 3,
  l1: 4, r1: 5, l2: 6, r2: 7,
  share: 8, options: 9, l3: 10, r3: 11,
  up: 12, down: 13, left: 14, right: 15,
};

await page.addInitScript(() => {
  const st = {
    axes: [0, 0, 0, 0],
    buttons: new Array(17).fill(0).map(() => ({ pressed: false, value: 0 })),
  };
  window.__PAD__ = st;
  navigator.getGamepads = () => [{
    id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
    index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
    axes: st.axes, buttons: st.buttons, vibrationActuator: null,
  }];
});

console.log(`testing ${BASE}`);

// ---------------------------------------------------------------------------
// helpers, in the page
// ---------------------------------------------------------------------------

const HELPERS = `
window.__B__ = {
  async frames(n) {
    const g = window.__SANDS__;
    const target = g.frameNo + n;
    for (let i = 0; i < n * 40 + 400; i++) {
      if (g.frameNo >= target) return g.frameNo;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return g.frameNo;
  },

  /** What the TABLE holds. */
  map() { return window.__SANDS__.keymap.snapshot(); },

  /** What the PANEL DREW. A different fact, deliberately read a different way. */
  rows() {
    return [...document.querySelectorAll('#pause [data-panel="controls"] .bind-row')].map((r) => ({
      keys: [...r.querySelectorAll('.key-cap')].map((k) => k.textContent.trim()),
      what: r.querySelector('.bind-what').textContent,
      editable: r.classList.contains('bind-edit'),
      arming: r.classList.contains('binding'),
    }));
  },

  /** The row that documents an action, by the cap it is currently drawing. */
  rowWith(cap) {
    return this.rows().find((r) => r.keys.includes(cap)) || null;
  },

  /**
   * The same row, WITH THE SENTENCE IT IS SUPPOSED TO BE SHOWING.
   *
   * A row that has just been edited is showing a message for a couple of
   * seconds - "M bound. Reload took F" - in place of its own sentence, which is
   * the whole of the conflict announcement. So "which row drew this cap" cannot
   * be answered by reading the visible text at that moment. The sentence is what
   * the row is FOR and 'what' is what it currently says, and both are read.
   */
  keyRowWith(cap) {
    return window.__SANDS__.pause.rebindRows().find((r) => r.keys.includes(cap)) || null;
  },

  stored() { try { return localStorage.getItem('sands.keys.v1'); } catch { return null; } },

  /**
   * KEEP THE HORDE OFF, AND KEEP THE PLAYER ALIVE.
   *
   * Not tidiness. Every binding in main.js is gated on death.halted as well as
   * on the pause, so a player who is killed while this suite is measuring turns
   * every "the key did nothing" assertion into a pass for the wrong reason -
   * which is a FALSE PASS of exactly the kind this project keeps producing. The
   * wave is held the way test/settings.mjs holds it, and alive() is asserted
   * beside every claim that a key did or did not do something.
   */
  holdWave() {
    window.__SANDS__.director.state.timer = 9999;
    return window.__SANDS__.director.state.timer;
  },

  alive() {
    const g = window.__SANDS__;
    return !g.death.halted && !g.pause.paused;
  },

  strip() {
    const el = document.querySelector('[data-keys]');
    return el ? [...el.children].map((c) => c.textContent) : null;
  },

  /**
   * Is the first binding row ON THE SCREEN, inside the scrolling body.
   *
   * This is the constraint the CONTROLS tab is built under, written down as a
   * measurement. Six extra rows once pushed this list past the bottom of the
   * body and the legibility pass in test/settings.mjs reported it at 1.01 to one
   * because it was no longer visible. A row that is in the DOM is not a row the
   * player can read.
   */
  listVisible() {
    const body = document.querySelector('.pause-body');
    const row = document.querySelector('#pause [data-panel="controls"] .bind-row');
    if (!body || !row) return null;
    const b = body.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return {
      rowTop: Math.round(r.top), rowBottom: Math.round(r.bottom),
      bodyTop: Math.round(b.top), bodyBottom: Math.round(b.bottom),
      inside: r.top >= b.top - 1 && r.bottom <= b.bottom + 1,
      // The whole tab, so a change that makes the list taller is visible as a
      // number rather than as a failure three passes later.
      panelHeight: Math.round(
        document.querySelector('#pause [data-panel="controls"]').getBoundingClientRect().height),
      scrolls: body.scrollHeight > body.clientHeight,
    };
  },

  /** Resume is still the topmost thing at its own centre. From settings.mjs. */
  fit() {
    const sheet = document.querySelector('.pause-sheet');
    const foot = document.querySelector('.pause-foot');
    const btn = document.getElementById('pause-resume');
    if (!sheet || !foot || !btn) return null;
    const s = sheet.getBoundingClientRect();
    const f = foot.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return {
      spill: +(f.bottom - s.bottom).toFixed(1),
      footBottom: +f.bottom.toFixed(1),
      viewport: window.innerHeight,
      hitIsButton: !!hit && (hit === btn || btn.contains(hit)),
      hit: hit ? (hit.id || hit.className || hit.tagName) : null,
    };
  },
};
`;

async function boot({ first = false } = {}) {
  if (first) await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  await page.addScriptTag({ content: HELPERS });
  await page.evaluate(() => document.getElementById('begin').click());
  await page.waitForTimeout(1400);
  await page.evaluate(() => window.__B__.holdWave());
}

async function reboot() {
  await page.reload({ waitUntil: 'load' });
  await boot();
}

/** Open the panel with the real key, and land on the real tab button. */
async function openControls() {
  const already = await page.evaluate(() => window.__SANDS__.pause.paused);
  if (!already) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  await page.click('#pause-tabs [data-tab="controls"]');
  await page.waitForTimeout(150);
}

async function closePanel() {
  const open = await page.evaluate(() => window.__SANDS__.pause.paused);
  if (!open) return;
  await page.click('#pause-resume');
  await page.waitForTimeout(250);
}

/**
 * Rebind by CLICKING THE ROW and PRESSING THE KEY.
 *
 * `cap` addresses the row the way a player does: by the letter printed on it.
 * Nothing here touches keymap.
 */
async function rebindByCap(cap, code) {
  const sel = `#pause [data-panel="controls"] .bind-row:has(.key-cap:text-is("${cap}"))`;
  await page.click(sel);
  await page.waitForTimeout(120);
  const armed = await page.evaluate(() => window.__SANDS__.pause.binding);
  await page.keyboard.press(code);
  await page.waitForTimeout(160);
  return armed;
}

// ---------------------------------------------------------------------------
// 1. A CLEAN SLATE IS THE SHIPPED SCHEME
// ---------------------------------------------------------------------------

await boot({ first: true });

const stored0 = await page.evaluate(() => window.__B__.stored());
check(stored0 === null, 'a fresh browser has nothing saved', String(stored0));

const map0 = await page.evaluate(() => window.__B__.map());
const DEFAULTS = {
  forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  sprint: ['ShiftLeft', 'ShiftRight'], jump: ['Space'],
  crouch: ['KeyC', 'ControlLeft', 'ControlRight'],
  reload: ['KeyR'], grenade: ['KeyG'], melee: ['KeyQ'],
  weapon1: ['Digit1'], weapon8: ['Digit8'],
  cycleWeapon: ['KeyE'], inspect: ['KeyV'],
  interact: ['KeyF'], renderMode: ['KeyP'], pause: ['Escape'],
};
for (const [id, want] of Object.entries(DEFAULTS)) {
  check(JSON.stringify(map0[id]) === JSON.stringify(want),
    `default: ${id}`, `${JSON.stringify(map0[id])} wanted ${JSON.stringify(want)}`);
}

// THE TITLE CARD IS BUILT FROM THE SAME TABLE. It is read here, before any
// rebind, because the claim is that it says the same thing the hand-written
// version said - a player who never opens the panel must see today's game.
const strip0 = await page.evaluate(() => window.__B__.strip());
check(!!strip0 && strip0.length === 4, 'the title card prints four lines of controls',
  strip0 ? String(strip0.length) : 'missing');
check(!!strip0 && strip0[0].startsWith('WASD move'), 'and it still opens with WASD move',
  strip0 ? strip0[0] : '');
check(!!strip0 && /1-8 weapons/.test(strip0[2]),
  'and it names all eight weapon slots', strip0 ? strip0[2] : '');
check(!!strip0 && /Q khopesh/.test(strip0[3]),
  'and it names the khopesh', strip0 ? strip0[3] : '');

// ---------------------------------------------------------------------------
// 2. THE CONTROLS TAB IS THE EDITOR
// ---------------------------------------------------------------------------

await openControls();

const rows0 = await page.evaluate(() => window.__B__.rows());
check(rows0.length >= 17, 'the controls tab lists the keyboard and the pad',
  `${rows0.length} rows`);

const reloadRow0 = await page.evaluate(() => window.__B__.rowWith('R'));
check(!!reloadRow0 && reloadRow0.editable, 'the reload row is an edit target',
  reloadRow0 ? String(reloadRow0.editable) : 'missing');

const fireRow = await page.evaluate(() => window.__B__.rowWith('LMB'));
check(!!fireRow && !fireRow.editable, 'the mouse rows are not',
  fireRow ? String(fireRow.editable) : 'missing');

// Clicking a fixed row arms nothing and says why, rather than doing nothing at
// all - a control that ignores a click is indistinguishable from a broken one.
await page.click('#pause [data-panel="controls"] .bind-row:has(.key-cap:text-is("LMB"))');
await page.waitForTimeout(120);
const afterFireClick = await page.evaluate(() => ({
  binding: window.__SANDS__.pause.binding,
  what: window.__B__.rowWith('LMB').what,
}));
check(afterFireClick.binding === null, 'clicking Fire arms nothing',
  String(afterFireClick.binding));
check(/cannot be moved/.test(afterFireClick.what), 'and the row says so',
  afterFireClick.what);

// --- the rebind itself ------------------------------------------------------

const armedReload = await rebindByCap('R', 'KeyM');
check(armedReload === 'reload', 'clicking the reload row arms reload', String(armedReload));

const afterReload = await page.evaluate(() => ({
  map: window.__B__.map().reload,
  row: window.__B__.keyRowWith('M'),
  oldRow: window.__B__.rowWith('R'),
}));
check(JSON.stringify(afterReload.map) === '["KeyM"]', 'the table has reload on M',
  JSON.stringify(afterReload.map));
check(!!afterReload.row && /Reload/.test(afterReload.row.sentence),
  'and the panel DREW the new cap',
  afterReload.row ? `${afterReload.row.keys.join(' ')} | ${afterReload.row.sentence}` : 'no row says M');
check(!afterReload.oldRow, 'and no row still claims R',
  afterReload.oldRow ? afterReload.oldRow.what : 'none');

// Escape cancels rather than binding. Asserted here because Escape is the one
// key a player cannot bind and the one they will press by accident.
await page.click('#pause [data-panel="controls"] .bind-row:has(.key-cap:text-is("V"))');
await page.waitForTimeout(120);
const armedInspect = await page.evaluate(() => window.__SANDS__.pause.binding);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const afterCancel = await page.evaluate(() => ({
  binding: window.__SANDS__.pause.binding,
  inspect: window.__B__.map().inspect,
  paused: window.__SANDS__.pause.paused,
}));
check(armedInspect === 'inspect', 'the inspect row arms', String(armedInspect));
check(afterCancel.binding === null, 'Escape ends the capture', String(afterCancel.binding));
check(JSON.stringify(afterCancel.inspect) === '["KeyV"]',
  'and binds nothing', JSON.stringify(afterCancel.inspect));
check(afterCancel.paused === true,
  'and the Escape that cancelled did NOT resume the game', String(afterCancel.paused));

// ---------------------------------------------------------------------------
// 3. CONFLICT
// ---------------------------------------------------------------------------
//
// Interact is asked for M, which reload now holds. The rule is a swap: interact
// takes M, reload takes interact's F, nothing is left unbound, and the row says
// what happened.

const armedInteract = await rebindByCap('F', 'KeyM');
check(armedInteract === 'interact', 'clicking the interact row arms interact',
  String(armedInteract));

const afterSwap = await page.evaluate(() => ({
  map: window.__B__.map(),
  onM: window.__B__.keyRowWith('M'),
  onF: window.__B__.keyRowWith('F'),
}));
check(JSON.stringify(afterSwap.map.interact) === '["KeyM"]', 'interact took M',
  JSON.stringify(afterSwap.map.interact));
check(JSON.stringify(afterSwap.map.reload) === '["KeyF"]', 'AND RELOAD TOOK F',
  JSON.stringify(afterSwap.map.reload));
check(!!afterSwap.onM && /Buy/.test(afterSwap.onM.sentence),
  'the panel drew M on the interact row', afterSwap.onM ? afterSwap.onM.sentence : 'missing');
check(!!afterSwap.onF && /Reload/.test(afterSwap.onF.sentence),
  'and F on the reload row', afterSwap.onF ? afterSwap.onF.sentence : 'missing');
// THE ANNOUNCEMENT. Silently stealing a binding is the failure this rule exists
// to prevent, so the row has to have said something about the exchange.
const swapSaid = await page.evaluate(() => window.__B__.rowWith('M').what);
check(/took|Reload/.test(swapSaid), 'and the row announced the exchange', swapSaid);

// Nothing may be left unbound by a swap, on any action.
const unbound = await page.evaluate(() => {
  const m = window.__B__.map();
  return Object.keys(m).filter((k) => !m[k].length);
});
check(unbound.length === 0, 'no action was left without a key', unbound.join(',') || 'none');

// The fixed refusal, at the table, because the UI cannot ask for it: Escape is
// the cancel key, so a player never gets to offer it as a binding.
const refusal = await page.evaluate(() => window.__SANDS__.keymap.bind('melee', 'Escape'));
check(refusal.result === 'refused' && refusal.with === 'pause',
  'Escape is refused rather than taken from Pause', JSON.stringify(refusal));
const meleeAfter = await page.evaluate(() => window.__B__.map().melee);
check(JSON.stringify(meleeAfter) === '["KeyQ"]', 'and the khopesh kept its key',
  JSON.stringify(meleeAfter));

// ---------------------------------------------------------------------------
// 4. THE NEW KEY DOES THE THING, AND THE OLD ONE DOES NOT
// ---------------------------------------------------------------------------
//
// The end of the chain, driven through the running game. Reload is the verb
// because it has a number attached to it that only the weapon system can move.

await closePanel();
await page.evaluate(() => window.__B__.frames(4));

/**
 * Spend the magazine by HOLDING THE REAL MOUSE BUTTON through real frames.
 *
 * The driver's own mousedown, not a write to input.state.fire. Four suites in
 * this directory set that field directly and are right to - they are testing
 * the weapon and not the wire - but every keystroke and every click in THIS
 * file has to be one the browser delivered, because the wire is the thing under
 * test and a harness that pokes state cannot tell a live binding from a dead
 * one.
 */
async function spend(rounds) {
  await page.mouse.move(VIEW.width / 2, VIEW.height / 2);
  // ONE CLICK PER ROUND. The starting pistol is semi-automatic, so a held
  // button fires once and then waits for a rising edge - measured, after a held
  // mouse over four hundred frames spent exactly one round and left this suite
  // asserting a reload against a magazine that was already effectively full.
  for (let i = 0; i < rounds; i++) {
    await page.mouse.down();
    await page.evaluate(() => window.__B__.frames(3));
    await page.mouse.up();
    await page.evaluate(() => window.__B__.frames(3));
  }
  return page.evaluate(() => window.__SANDS__.weapons.magazine);
}

/**
 * Run frames until the magazine comes back, or give up.
 *
 * Returns the magazine either way, so the assertion is made on the number and
 * the wait is only a wait. A fixed frame count would have to be the worst case -
 * a reload is seconds of simulated time and this machine renders in software -
 * and a suite nobody runs because it takes ten minutes is a suite that catches
 * nothing.
 */
async function waitReload(from, frames = 400) {
  return page.evaluate(async ([was, n]) => {
    const g = window.__SANDS__;
    for (let i = 0; i < n; i++) {
      if (g.weapons.magazine > was) return g.weapons.magazine;
      await window.__B__.frames(1);
    }
    return g.weapons.magazine;
  }, [from, frames]);
}

const full = await page.evaluate(() => window.__SANDS__.weapons.magazine);
const spent1 = await spend(3);
check(spent1 < full, 'the magazine was spent by firing', `${full} -> ${spent1}`);
check(await page.evaluate(() => window.__B__.alive()),
  'and the player is alive and unpaused to be measured');

await page.keyboard.press('KeyF');            // reload's NEW key
const afterNewKey = await waitReload(spent1);
check(afterNewKey > spent1, 'THE NEW KEY RELOADS', `${spent1} -> ${afterNewKey}`);

const spent2 = await spend(3);
await page.keyboard.press('KeyR');            // the key it used to be on
// The same wait the new key was given, so the two claims are made on equal
// terms: this one has to fail to reload for the whole of it.
const afterOldKey = await waitReload(spent2, 120);
// The negative claim is only worth anything if the game was still listening.
// Every binding in main.js is gated on death.halted, so a dead player would
// make this pass for the wrong reason.
check(await page.evaluate(() => window.__B__.alive()),
  'the game was still running for the negative claim');
check(afterOldKey === spent2, 'AND THE OLD KEY DOES NOTHING',
  `${spent2} -> ${afterOldKey}`);

// The same pair on a second action, chosen because its effect is instant and
// needs no simulation: a reload that fails to finish would look like the same
// failure as a binding that never fired.
await openControls();
await rebindByCap('P', 'KeyJ');
await closePanel();

const modeBefore = await page.evaluate(() => window.__SANDS__.retro.mode);
await page.keyboard.press('KeyJ');
await page.evaluate(() => window.__B__.frames(3));
const modeAfterNew = await page.evaluate(() => window.__SANDS__.retro.mode);
check(modeAfterNew !== modeBefore, 'the render mode moved on its new key',
  `${modeBefore} -> ${modeAfterNew}`);

await page.keyboard.press('KeyP');
await page.evaluate(() => window.__B__.frames(3));
const modeAfterOld = await page.evaluate(() => window.__SANDS__.retro.mode);
check(modeAfterOld === modeAfterNew, 'and stayed put on the old one',
  `${modeAfterNew} -> ${modeAfterOld}`);

// Put the picture back before anything is photographed.
await page.evaluate(() => window.__SANDS__.retro.set('off'));

// The title card is behind the game now, but it was repainted when the binding
// moved, and that is what a player who dies and returns to it would read.
const stripLive = await page.evaluate(() => window.__B__.strip());
check(!!stripLive && /F reload/.test(stripLive[2]),
  'the title card followed the rebind', stripLive ? stripLive[2] : 'missing');
check(!!stripLive && /M buy/.test(stripLive[2]),
  'on both sides of the swap', stripLive ? stripLive[2] : 'missing');

// And the HUD's own cap, which is the other place a key is printed.
const hudCap = await page.evaluate(() =>
  (document.querySelector('#r-ammo [data-key-cap="reload"]') || {}).textContent);
check(hudCap === 'F', 'and so did the reload cap on the ammunition plate', String(hudCap));

// ---------------------------------------------------------------------------
// 5. THE LAYOUT BUDGET
// ---------------------------------------------------------------------------

await openControls();
const vis = await page.evaluate(() => window.__B__.listVisible());
check(!!vis && vis.inside,
  'THE FIRST BINDING ROW IS ON THE SCREEN',
  vis ? `row ${vis.rowTop}-${vis.rowBottom} in body ${vis.bodyTop}-${vis.bodyBottom}` : 'missing');
const fit = await page.evaluate(() => window.__B__.fit());
check(!!fit && fit.spill <= 1, 'nothing spills out of the sheet',
  fit ? `${fit.spill}px` : 'missing');
check(!!fit && fit.hitIsButton, 'Resume is still the topmost element at its own centre',
  fit ? String(fit.hit) : 'missing');

writeFileSync(`${OUT}bindings-controls.png`, await page.screenshot({ timeout: 90000 }));

// Photographed mid-capture as well, because the row saying "press a key" is the
// state a player spends the most confusing second of this feature in.
await page.click('#pause [data-panel="controls"] .bind-row:has(.key-cap:text-is("G"))');
await page.waitForTimeout(150);
const arming = await page.evaluate(() => window.__B__.rowWith('G'));
check(!!arming && arming.arming, 'the armed row is marked', arming ? arming.what : 'missing');
check(!!arming && /Press a key/.test(arming.what), 'and says what it wants',
  arming ? arming.what : '');
writeFileSync(`${OUT}bindings-capture.png`, await page.screenshot({ timeout: 90000 }));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// ---------------------------------------------------------------------------
// 6. PERSISTENCE, ACROSS A REAL RELOAD
// ---------------------------------------------------------------------------

const storedNow = await page.evaluate(() => window.__B__.stored());
check(typeof storedNow === 'string' && storedNow.includes('"v":1'),
  'the map was written with a schema version', String(storedNow).slice(0, 60));

await reboot();

const mapAfterReload = await page.evaluate(() => window.__B__.map());
check(JSON.stringify(mapAfterReload.reload) === '["KeyF"]',
  'reload survived the reload', JSON.stringify(mapAfterReload.reload));
check(JSON.stringify(mapAfterReload.interact) === '["KeyM"]',
  'and so did interact', JSON.stringify(mapAfterReload.interact));
check(JSON.stringify(mapAfterReload.renderMode) === '["KeyJ"]',
  'and the render mode key', JSON.stringify(mapAfterReload.renderMode));

// AND IT STILL WORKS. A restored value that is never wired back into the
// handler is the same bug as a value that never took effect in the first place.
const modeBefore2 = await page.evaluate(() => window.__SANDS__.retro.mode);
await page.keyboard.press('KeyJ');
await page.evaluate(() => window.__B__.frames(3));
const modeAfter2 = await page.evaluate(() => window.__SANDS__.retro.mode);
check(modeAfter2 !== modeBefore2, 'AND THE RESTORED KEY STILL DOES THE THING',
  `${modeBefore2} -> ${modeAfter2}`);
await page.evaluate(() => window.__SANDS__.retro.set('off'));

const stripReload = await page.evaluate(() => window.__B__.strip());
check(!!stripReload && /F reload/.test(stripReload[2]),
  'and the title card came back saying the same thing', stripReload ? stripReload[2] : 'missing');

// ---------------------------------------------------------------------------
// 7. RESET
// ---------------------------------------------------------------------------

await openControls();
await page.click('#pause [data-panel="controls"] .bind-reset');
await page.waitForTimeout(200);

const afterReset = await page.evaluate(() => ({
  map: window.__B__.map(),
  stored: window.__B__.stored(),
  onR: window.__B__.rowWith('R'),
  onP: window.__B__.rowWith('P'),
}));
for (const [id, want] of Object.entries(DEFAULTS)) {
  check(JSON.stringify(afterReset.map[id]) === JSON.stringify(want),
    `reset: ${id}`, `${JSON.stringify(afterReset.map[id])}`);
}
check(afterReset.stored === null, 'reset removed the saved map', String(afterReset.stored));
check(!!afterReset.onR && /Reload/.test(afterReset.onR.what),
  'and the panel drew R again', afterReset.onR ? afterReset.onR.what : 'missing');

await closePanel();
const spent3 = await spend(3);
await page.keyboard.press('KeyR');
const afterResetKey = await waitReload(spent3);
check(afterResetKey > spent3, 'AND R RELOADS AGAIN', `${spent3} -> ${afterResetKey}`);

await reboot();
const mapAfterResetReload = await page.evaluate(() => window.__B__.map());
check(JSON.stringify(mapAfterResetReload.reload) === '["KeyR"]',
  'the reset survived a reload too', JSON.stringify(mapAfterResetReload.reload));

// ---------------------------------------------------------------------------
// 8. A CORRUPT SAVED MAP COSTS ONE BINDING, NEVER THE BOOT
// ---------------------------------------------------------------------------
//
// Each case is written into storage and the page is reloaded into it, because
// the only interesting moment is the boot that reads it.

async function loadWith(text, label) {
  await page.evaluate((t) => {
    if (t === null) localStorage.removeItem('sands.keys.v1');
    else localStorage.setItem('sands.keys.v1', t);
  }, text);
  const before = errs.length;
  await reboot();
  const map = await page.evaluate(() => window.__B__.map());
  const load = await page.evaluate(() => window.__SANDS__.keymap.lastLoad);
  check(errs.length === before, `${label}: the game booted without an error`,
    errs.slice(before).join(' | '));
  return { map, load };
}

const garbage = await loadWith('{not json at all', 'garbage');
check(JSON.stringify(garbage.map.reload) === '["KeyR"]',
  'garbage: every action fell back to its default', JSON.stringify(garbage.map.reload));
check(garbage.load.ok === false, 'garbage: and the load said so', garbage.load.reason);

const stale = await loadWith('{"v":99,"map":{"reload":["KeyM"]}}', 'a future schema');
check(JSON.stringify(stale.map.reload) === '["KeyR"]',
  'a future schema is not read half way', JSON.stringify(stale.map.reload));

const dirty = await loadWith(JSON.stringify({
  v: 1,
  map: {
    reload: ['KeyM'],
    // The same key twice, which the editor can never produce and a hand-edited
    // file can. The first claim in table order keeps it.
    interact: ['KeyM'],
    jump: 12345,                     // not a list
    grenade: ['not a real code!!'],   // not a code
    melee: [],                        // empty
    bogus: ['KeyZ'],                  // an action that does not exist
    pause: ['KeyZ'],                  // a fixed action, which may not be moved
  },
}), 'a hand-edited map');
check(JSON.stringify(dirty.map.reload) === '["KeyM"]',
  'the one good entry was kept', JSON.stringify(dirty.map.reload));
check(JSON.stringify(dirty.map.interact) === '["KeyF"]',
  'the duplicate fell back to its default', JSON.stringify(dirty.map.interact));
check(JSON.stringify(dirty.map.jump) === '["Space"]',
  'the malformed entry fell back', JSON.stringify(dirty.map.jump));
check(JSON.stringify(dirty.map.grenade) === '["KeyG"]',
  'the invalid code fell back', JSON.stringify(dirty.map.grenade));
check(JSON.stringify(dirty.map.melee) === '["KeyQ"]',
  'the empty list fell back', JSON.stringify(dirty.map.melee));
check(JSON.stringify(dirty.map.pause) === '["Escape"]',
  'AND PAUSE WAS NOT MOVED', JSON.stringify(dirty.map.pause));
check(!('bogus' in dirty.map), 'an unknown action is not adopted',
  Object.keys(dirty.map).join(',').slice(0, 40));

// The game is still playable on the map it salvaged: W still walks.
await page.keyboard.down('KeyW');
await page.evaluate(() => window.__B__.frames(10));
const walked = await page.evaluate(() => window.__SANDS__.player.position.z);
await page.keyboard.up('KeyW');
await page.evaluate(() => window.__B__.frames(2));
const walkedTo = await page.evaluate(() => window.__SANDS__.player.position.z);
check(typeof walked === 'number' && typeof walkedTo === 'number',
  'and the player still moves on the salvaged map', `${walked} -> ${walkedTo}`);

// ---------------------------------------------------------------------------
// 9. THE PAD, THE SAME FEATURE ONE NAMESPACE OVER
// ---------------------------------------------------------------------------
//
// Everything above is asserted again here for the controller, because the two
// tables share a machine and a shared machine is exactly where "it works for the
// keyboard" stops being evidence about the pad. The claims are made in the same
// order and by the same rules: a real click arms the row, a real BUTTON binds
// it, the verb is proved by the game rather than by the table, and the map is
// proved across a real reload.

/** Hold a pad button through real frames, then release it. */
async function padPress(button, frames = 4) {
  await page.evaluate(async ([i, n]) => {
    window.__PAD__.buttons[i] = { pressed: true, value: 1 };
    await window.__B__.frames(n);
    window.__PAD__.buttons[i] = { pressed: false, value: 0 };
    await window.__B__.frames(3);
  }, [PAD[button], frames]);
}

/** Arm a pad row by clicking it, then press the button that should take it. */
async function padRebind(cap, button) {
  await page.click(`#pause [data-panel="controls"] .bind-row:has(.key-cap:text-is("${cap}"))`);
  await page.waitForTimeout(120);
  const armed = await page.evaluate(() => window.__SANDS__.pause.binding);
  await padPress(button);
  await page.waitForTimeout(150);
  return armed;
}

const padSeen = await page.evaluate(() => window.__SANDS__.input.pad.info());
check(padSeen.connected, 'the synthetic pad is being read',
  `slot ${padSeen.index}, mapping ${padSeen.mapping}`);

const padMap0 = await page.evaluate(() => window.__SANDS__.keymap.pad.snapshot());
for (const [id, want] of Object.entries({
  sprint: ['r3'], crouch: ['l3'], jump: ['cross'],
  fire: ['r2'], aim: ['l2'], grenade: ['r1'],
  melee: ['circle', 'l1'], interact: ['square'], nextWeapon: ['triangle'],
  pause: ['options'],
})) {
  check(JSON.stringify(padMap0[id]) === JSON.stringify(want),
    `pad default: ${id}`, `${JSON.stringify(padMap0[id])} wanted ${JSON.stringify(want)}`);
}
// THE TWO THE OWNER ASKED FOR BY NAME. Sprint moved to R3 at his request and the
// bumper swap exists because he asked for it; both had to survive becoming rows
// in a general table rather than special cases beside it.
check(JSON.stringify(padMap0.sprint) === '["r3"]', 'SPRINT IS STILL ON R3');
check(await page.evaluate(() => window.__SANDS__.input.pad.swapBumpers) === false,
  'and the shoulder swap is still off by default');

await openControls();
const padRows0 = await page.evaluate(() => window.__B__.keyRowWith('R3'));
check(!!padRows0 && /Sprint/.test(padRows0.sentence) && padRows0.device === 'pad',
  'the pad list draws R3 against Sprint', padRows0 ? padRows0.sentence : 'missing');

// --- rebinding a pad row ----------------------------------------------------

const armedJump = await padRebind('Cross', 'triangle');
check(armedJump === 'jump', 'clicking the pad jump row arms jump', String(armedJump));

const afterPadSwap = await page.evaluate(() => ({
  map: window.__SANDS__.keymap.pad.snapshot(),
  onTriangle: window.__B__.keyRowWith('Triangle'),
  onCross: window.__B__.keyRowWith('Cross'),
  keys: window.__B__.map().jump,
}));
check(JSON.stringify(afterPadSwap.map.jump) === '["triangle"]', 'jump took Triangle',
  JSON.stringify(afterPadSwap.map.jump));
check(JSON.stringify(afterPadSwap.map.nextWeapon) === '["cross"]',
  'AND THE WEAPON SWAP TOOK CROSS', JSON.stringify(afterPadSwap.map.nextWeapon));
check(!!afterPadSwap.onTriangle && /Jump/.test(afterPadSwap.onTriangle.sentence),
  'the pad list drew Triangle on the jump row',
  afterPadSwap.onTriangle ? afterPadSwap.onTriangle.sentence : 'missing');
// THE TWO TABLES ARE SEPARATE NAMESPACES. Binding a pad button must not touch
// the keyboard's Space, and the only way to know is to look.
check(JSON.stringify(afterPadSwap.keys) === '["Space"]',
  'and the KEYBOARD jump was not touched', JSON.stringify(afterPadSwap.keys));

// Options cancels a pad capture, the way Escape cancels a keyboard one. It is
// also the one button a pad player has when they armed a row by accident.
await page.click('#pause [data-panel="controls"] .bind-row:has(.key-cap:text-is("R3"))');
await page.waitForTimeout(120);
const armedSprint = await page.evaluate(() => window.__SANDS__.pause.binding);
await padPress('options');
await page.waitForTimeout(200);
const afterPadCancel = await page.evaluate(() => ({
  binding: window.__SANDS__.pause.binding,
  sprint: window.__SANDS__.keymap.pad.snapshot().sprint,
  paused: window.__SANDS__.pause.paused,
}));
check(armedSprint === 'sprint', 'the pad sprint row arms', String(armedSprint));
check(afterPadCancel.binding === null, 'Options ends the capture',
  String(afterPadCancel.binding));
check(JSON.stringify(afterPadCancel.sprint) === '["r3"]', 'and binds nothing',
  JSON.stringify(afterPadCancel.sprint));
check(afterPadCancel.paused === true, 'and did not resume the game',
  String(afterPadCancel.paused));

// --- the moved button does the thing ---------------------------------------

const armedFire = await padRebind('R2', 'square');
check(armedFire === 'fire', 'the pad fire row arms fire', String(armedFire));
const firePlaced = await page.evaluate(() => window.__SANDS__.keymap.pad.snapshot());
check(JSON.stringify(firePlaced.fire) === '["square"]', 'fire took Square',
  JSON.stringify(firePlaced.fire));

await closePanel();
await page.evaluate(() => window.__B__.frames(4));

const padMagBefore = await page.evaluate(() => window.__SANDS__.weapons.magazine);
await padPress('square', 6);
const padMagAfter = await page.evaluate(() => window.__SANDS__.weapons.magazine);
check(padMagAfter < padMagBefore, 'THE NEW BUTTON FIRES', `${padMagBefore} -> ${padMagAfter}`);
check(await page.evaluate(() => window.__B__.alive()),
  'and the game was running for the negative claim that follows');

await padPress('r2', 6);
const padMagOld = await page.evaluate(() => window.__SANDS__.weapons.magazine);
check(padMagOld === padMagAfter, 'AND THE OLD TRIGGER DOES NOT',
  `${padMagAfter} -> ${padMagOld}`);

// --- persistence ------------------------------------------------------------

await reboot();
const padAfterReload = await page.evaluate(() => window.__SANDS__.keymap.pad.snapshot());
check(JSON.stringify(padAfterReload.fire) === '["square"]',
  'the pad map survived a reload', JSON.stringify(padAfterReload.fire));
check(JSON.stringify(padAfterReload.jump) === '["triangle"]',
  'all of it', JSON.stringify(padAfterReload.jump));

const padMagBefore2 = await page.evaluate(() => window.__SANDS__.weapons.magazine);
await padPress('square', 6);
const padMagAfter2 = await page.evaluate(() => window.__SANDS__.weapons.magazine);
check(padMagAfter2 < padMagBefore2, 'AND THE RESTORED BUTTON STILL FIRES',
  `${padMagBefore2} -> ${padMagAfter2}`);

// --- the shoulder swap is a write to the same table --------------------------

await openControls();
const swapBefore = await page.evaluate(() => ({
  fireRow: window.__B__.keyRowWith('L2'),
  swapped: window.__SANDS__.input.pad.swapBumpers,
}));
check(swapBefore.swapped === false, 'the swap reads Off before it is pressed',
  String(swapBefore.swapped));

// Pressed on the GAME tab, through the real button, which is a different tab
// from the list it changes. That is the point: the list has to follow a control
// it knows nothing about.
await page.click('#pause-tabs [data-tab="game"]');
await page.waitForTimeout(120);
await page.click('#pause [data-setting="padswap"] .set-btn');
await page.waitForTimeout(200);

const swapAfter = await page.evaluate(() => ({
  map: window.__SANDS__.keymap.pad.snapshot(),
  swapped: window.__SANDS__.input.pad.swapBumpers,
  note: document.querySelector('#pause [data-setting="padswap"] .set-note').textContent,
}));
check(swapAfter.swapped === true, 'the swap reads On after it is pressed',
  String(swapAfter.swapped));
check(JSON.stringify(swapAfter.map.aim) === '["l1"]', 'and aim moved to L1',
  JSON.stringify(swapAfter.map.aim));
check(JSON.stringify(swapAfter.map.grenade) === '["r2"]', 'and the grenade to R2',
  JSON.stringify(swapAfter.map.grenade));
check(swapAfter.map.melee.includes('l2') && swapAfter.map.melee.includes('circle'),
  'and the khopesh shoulder to L2, with Circle where it was',
  JSON.stringify(swapAfter.map.melee));
check(/L1/.test(swapAfter.note) && /R2/.test(swapAfter.note),
  'and the note prints the buttons it produced', swapAfter.note);
// FIRE WAS ON SQUARE, moved there by hand, and the swap is a four-binding
// layout rather than an exchange of whatever happens to be there.
check(JSON.stringify(swapAfter.map.fire) === '["r1"]',
  'the swap places fire on R1 whatever it was on', JSON.stringify(swapAfter.map.fire));

await page.click('#pause-tabs [data-tab="controls"]');
await page.waitForTimeout(150);
const swappedRow = await page.evaluate(() => window.__B__.keyRowWith('L1'));
check(!!swappedRow && /Aim/.test(swappedRow.sentence),
  'AND THE CONTROLS LIST REDREW ITSELF for a control on another tab',
  swappedRow ? `${swappedRow.keys.join(' ')} | ${swappedRow.sentence}` : 'missing');

// --- reset ------------------------------------------------------------------

const resets = await page.$$('#pause [data-panel="controls"] .bind-reset');
check(resets.length === 2, 'there is a reset for each device', `${resets.length} buttons`);
// Read the KEYBOARD map first and compare against itself afterwards. Asserting
// a literal here would be asserting what section 8 left behind rather than what
// this button did, which is the kind of check that fails for the wrong reason
// the day somebody inserts a section above it.
const keysBeforePadReset = await page.evaluate(() => window.__B__.map());
await resets[1].click();
await page.waitForTimeout(200);

const padReset = await page.evaluate(() => ({
  map: window.__SANDS__.keymap.pad.snapshot(),
  swapped: window.__SANDS__.input.pad.swapBumpers,
  keys: window.__B__.map(),
}));
check(JSON.stringify(padReset.map.fire) === '["r2"]', 'reset put fire back on R2',
  JSON.stringify(padReset.map.fire));
check(JSON.stringify(padReset.map.sprint) === '["r3"]', 'AND SPRINT IS STILL R3',
  JSON.stringify(padReset.map.sprint));
check(JSON.stringify(padReset.map.jump) === '["cross"]', 'and jump is back on Cross',
  JSON.stringify(padReset.map.jump));
check(padReset.swapped === false, 'and the swap reads Off again',
  String(padReset.swapped));
check(JSON.stringify(padReset.keys) === JSON.stringify(keysBeforePadReset),
  'and the KEYBOARD map was not reset with it',
  `${JSON.stringify(padReset.keys.reload)} was ${JSON.stringify(keysBeforePadReset.reload)}`);

await closePanel();
const padMagBefore3 = await page.evaluate(() => window.__SANDS__.weapons.magazine);
await padPress('r2', 6);
const padMagAfter3 = await page.evaluate(() => window.__SANDS__.weapons.magazine);
check(padMagAfter3 < padMagBefore3, 'AND R2 FIRES AGAIN', `${padMagBefore3} -> ${padMagAfter3}`);

await page.evaluate(() => localStorage.removeItem('sands.keys.v1'));

// ---------------------------------------------------------------------------

check(errs.length === 0, 'no page errors', errs.join(' | '));

await browser.close();

console.log(`\nshots -> ${OUT}bindings-controls.png, ${OUT}bindings-capture.png`);
if (failures.length) {
  console.log(`\n${failures.length} FAILED of ${failures.length + passed}:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\nall ${passed} checks green`);
