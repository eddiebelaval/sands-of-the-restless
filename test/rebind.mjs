/**
 * Sprint moved to R3, and the bumper/trigger swap.
 *
 * Driven through the real input layer with a synthetic pad, asserting the
 * ACTIONS rather than the buttons - the point of the swap is that the same
 * button means different things, so a test that checked buttons would pass on a
 * build where nothing moved.
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
    let swings = 0;
    const onKey = (e) => { if (e.code === 'KeyQ') swings++; };
    window.addEventListener('keydown', onKey);
    g.input.pollPad(g.rig, 1 / 60);
    g.input.pollPad(g.rig, 1 / 60);
    window.removeEventListener('keydown', onKey);

    const s = g.input.state;
    return { fire: s.fire, ads: s.ads, grenade: s.grenade, sprint: s.sprint, swings };
  }, { names, IDX, swap, stick });
}

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

check(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | '));
console.log(`\n${fails.length ? `${fails.length} FAILED of ${pass + fails.length}` : `all ${pass} checks green`}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
