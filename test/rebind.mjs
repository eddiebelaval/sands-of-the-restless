/**
 * THE PAD LAYOUT, ASSERTED AS ACTIONS.
 *
 * Driven through the real input layer with a synthetic pad, asserting the
 * ACTIONS rather than the buttons - the point of every rebind in this file is
 * that the same button means different things, so a test that checked buttons
 * would pass on a build where nothing moved.
 *
 * Three rounds of rebinding live here now:
 *
 *   SPRINT MOVED TO R3, off L3, at the owner's request.
 *
 *   THE BUMPER/TRIGGER SWAP, which exchanges four actions in pairs and moves
 *   each one onto a different KIND of input - a digital switch or an analog
 *   latch - so the reading has to move with the action and not with the button.
 *
 *   THE KHOPESH TO CIRCLE, WHICH PUSHED INTERACT ONTO SQUARE, WHICH MADE SQUARE
 *   CONTEXTUAL. That chain is the reason this file grew: the request was for
 *   three things and it cost five bindings, and the only one that can be got
 *   wrong invisibly is the last. A Square that always reloads passes any check
 *   made in an empty room, which is where every check in this file is made
 *   unless the prompt is put up on purpose. It is put up on purpose below.
 *
 *   AND L3 BECAME CROUCH, which is also the slide. What is asserted here is
 *   only that the POSTURE toggled - whether a given toggle becomes a crouch or
 *   a slide is a fact about the body's speed and belongs to
 *   test/crouchslide.mjs, which measures the body.
 */
import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS } from './chrome.mjs';

const browser = await chromium.launch({ executablePath: resolveChrome(), args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

// A fake pad, installed before the game boots.
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

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1500);

let pass = 0; const fails = [];
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail === undefined ? '' : `  (${detail})`}`); }
};

const IDX = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, l3: 10, r3: 11 };

/** Set buttons, poll twice through the real path, read the resolved actions. */
async function press(names, { swap = false, stick = 0 } = {}) {
  return page.evaluate(async ({ names, IDX, swap, stick }) => {
    const g = window.__SANDS__;
    const st = window.__PAD__;

    g.input.pad.setSwapBumpers(swap);

    // Release everything and let the stick come home first: the sprint latch is
    // sticky on purpose and only clears at stick centre, so without this each
    // case inherits the previous one's sprint.
    for (const b of st.buttons) { b.pressed = false; b.value = 0; }
    st.axes[0] = 0; st.axes[1] = 0;
    g.input.pollPad(g.rig, 1 / 60);

    for (const b of st.buttons) { b.pressed = false; b.value = 0; }
    st.axes[0] = 0; st.axes[1] = stick;
    for (const n of names) {
      const i = IDX[n];
      st.buttons[i].pressed = true;
      st.buttons[i].value = 1;
    }

    // Two polls: the first establishes the edge, the second proves it is not
    // repeating. Held state is read after both.
    //
    // The three key counts are how the actions this file does not own are
    // observed. core/input.js dispatches a real DOM key event for the reload,
    // the interact and the khopesh rather than reaching into weapons.js or
    // melee.js, so counting those events is reading the binding at exactly the
    // seam where it is made - and counting them means a binding that fires
    // TWICE fails as loudly as one that fires not at all.
    let swings = 0;
    let reloads = 0;
    let interacts = 0;
    const onKey = (e) => {
      if (e.code === 'KeyQ') swings++;
      if (e.code === 'KeyR') reloads++;
      if (e.code === 'KeyF') interacts++;
    };
    window.addEventListener('keydown', onKey);
    g.input.pollPad(g.rig, 1 / 60);
    g.input.pollPad(g.rig, 1 / 60);
    window.removeEventListener('keydown', onKey);

    const s = g.input.state;
    return {
      fire: s.fire, ads: s.ads, grenade: s.grenade, sprint: s.sprint,
      crouch: s.crouch, swings, reloads, interacts,
    };
  }, { names, IDX, swap, stick });
}

/** Put an interact prompt on the screen, or take it away. */
const setPrompt = (on, deny = false) => page.evaluate(({ on, deny }) => {
  const el = document.getElementById('prompt');
  el.textContent = on ? 'OPEN THE GATE  [F]' : '';
  el.classList.toggle('on', on);
  el.classList.toggle('deny', on && deny);
  return el.className;
}, { on, deny });

console.log('\nSPRINT IS ON R3');
const r3 = await press(['r3'], { stick: -1 });
check(r3.sprint === true, 'R3 with the stick pushed starts a sprint', `sprint=${r3.sprint}`);
const l3 = await press(['l3'], { stick: -1 });
check(l3.sprint === false, 'L3 no longer does', `sprint=${l3.sprint}`);

console.log('\nDEFAULT SHOULDERS: fire R2, aim L2, grenade R1, khopesh L1');
const dR2 = await press(['r2']);
check(dR2.fire === true && dR2.grenade === false, 'R2 fires', `fire=${dR2.fire} nade=${dR2.grenade}`);
const dL2 = await press(['l2']);
check(dL2.ads === true, 'L2 aims', `ads=${dL2.ads}`);
const dR1 = await press(['r1']);
check(dR1.grenade === true && dR1.fire === false, 'R1 cooks a grenade', `nade=${dR1.grenade} fire=${dR1.fire}`);
const dL1 = await press(['l1']);
check(dL1.swings === 1, 'L1 swings the khopesh exactly once for one press', `swings=${dL1.swings}`);

console.log('\nSWAPPED: fire R1, aim L1, grenade R2, khopesh L2');
const sR1 = await press(['r1'], { swap: true });
check(sR1.fire === true && sR1.grenade === false, 'R1 fires', `fire=${sR1.fire} nade=${sR1.grenade}`);
const sL1 = await press(['l1'], { swap: true });
check(sL1.ads === true, 'L1 aims', `ads=${sL1.ads}`);
const sR2 = await press(['r2'], { swap: true });
check(sR2.grenade === true && sR2.fire === false, 'R2 cooks a grenade', `nade=${sR2.grenade} fire=${sR2.fire}`);
const sL2 = await press(['l2'], { swap: true });
check(sL2.swings === 1, 'L2 swings the khopesh exactly once for one press', `swings=${sL2.swings}`);

console.log('\nTHE SWAP IS A REAL EXCHANGE, NOT AN ADDITION');
const sR2fire = await press(['r2'], { swap: true });
check(sR2fire.fire === false, 'swapped, R2 no longer fires', `fire=${sR2fire.fire}`);
const dR1fire = await press(['r1'], { swap: false });
check(dR1fire.fire === false, 'default, R1 does not fire', `fire=${dR1fire.fire}`);

console.log('\nTHE KHOPESH IS ON CIRCLE, AND L1 KEEPS IT');
const oCircle = await press(['circle']);
check(oCircle.swings === 1, 'Circle swings the khopesh exactly once for one press',
  `swings=${oCircle.swings}`);
// The half of the move that could have been made and never noticed. Circle
// interacting AND swinging would look right in every empty room in the map and
// would buy a door every time the player knifed a body standing in a doorway.
check(oCircle.interacts === 0, 'and Circle no longer interacts',
  `KeyF x${oCircle.interacts}`);
const oBoth = await press(['l1', 'circle']);
check(oBoth.swings === 1, 'holding L1 and Circle together is ONE swing, not two',
  `swings=${oBoth.swings}`);
const oCircleSwap = await press(['circle'], { swap: true });
check(oCircleSwap.swings === 1, 'and Circle is outside the bumper/trigger swap, so it swings either way',
  `swings=${oCircleSwap.swings}`);

console.log('\nSQUARE IS CONTEXTUAL: INTERACT WHEN A PROMPT IS UP, RELOAD WHEN IT IS NOT');
await setPrompt(false);
const sqQuiet = await press(['square']);
check(sqQuiet.reloads === 1 && sqQuiet.interacts === 0, 'with no prompt, Square reloads',
  `KeyR x${sqQuiet.reloads}, KeyF x${sqQuiet.interacts}`);

await setPrompt(true);
const sqOn = await press(['square']);
check(sqOn.interacts === 1 && sqOn.reloads === 0, 'with a prompt up, the same button interacts',
  `KeyF x${sqOn.interacts}, KeyR x${sqOn.reloads}`);

// A denied prompt - the red "come back richer" - is still a prompt. The player
// is looking at the thing and pressed the button; the game refuses them AT the
// thing rather than answering a question they did not ask.
await setPrompt(true, true);
const sqDeny = await press(['square']);
check(sqDeny.interacts === 1 && sqDeny.reloads === 0,
  'a DENIED prompt still routes to interact and not to an unasked-for reload',
  `KeyF x${sqDeny.interacts}, KeyR x${sqDeny.reloads}`);

await setPrompt(false);
const sqClear = await press(['square']);
check(sqClear.reloads === 1 && sqClear.interacts === 0,
  'and it is back to reloading the moment the prompt clears - the state is the SCREEN, not a latch',
  `KeyR x${sqClear.reloads}, KeyF x${sqClear.interacts}`);

console.log('\nL3 IS CROUCH, AND IT IS A TOGGLE');
await page.evaluate(() => { window.__SANDS__.input.state.crouch = false; });
const c1 = await press(['l3']);
check(c1.crouch === true, 'one press of L3 puts the posture on', `crouch=${c1.crouch}`);
const c2 = await press(['l3']);
check(c2.crouch === false, 'and a second press takes it off', `crouch=${c2.crouch}`);
// press() polls TWICE per call. A toggle that flipped per POLL rather than per
// PRESS would land back where it started and both checks above would pass on a
// binding that is doing the wrong thing twice. This is the one that catches it.
const c3 = await press(['l3']);
check(c3.crouch === true, 'and the flip is once per PRESS, not once per poll', `crouch=${c3.crouch}`);
const c4 = await press(['r3'], { stick: -1 });
check(c4.crouch === true && c4.sprint === true,
  'R3 sprints without disturbing the posture, which is what lets the two be pressed together',
  `crouch=${c4.crouch} sprint=${c4.sprint}`);
await page.evaluate(() => { window.__SANDS__.input.state.crouch = false; });

check(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | '));
console.log(`\n${fails.length ? `${fails.length} FAILED of ${pass + fails.length}` : `all ${pass} checks green`}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
