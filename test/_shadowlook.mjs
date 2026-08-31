/**
 * THROWAWAY: what do the shadows actually look like where things meet the sand?
 *
 * I proposed cascaded shadow maps on the hypothesis that a single directional
 * shadow over a 100m exterior has poor texel density near the camera. The code
 * says otherwise: sky.js follows the player, snaps the frustum to texel
 * increments, and runs 4096 texels over a 136-unit frustum - 3.3 cm per texel,
 * with normalBias carrying the budget so contact shadows do not slide.
 *
 * CSM through three's addon means patching every material (92 MeshStandard
 * across ~20 files, plus actors built at runtime) and it fights custom passes,
 * of which this project has several. That is a large, fragile change to make on
 * a hypothesis the source already contradicts.
 *
 * So: photograph the contact. Close to a prop where it meets the ground, at
 * HIGH fidelity, sun where the game puts it. If the shadows are crisp and the
 * props are planted, CSM is the wrong lever and the honest thing is to say so.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS, dismissBriefing, waitForWorld } from './chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4188/index.html';
const OUT = new URL('../shots/', import.meta.url).pathname;

const browser = await chromium.launch({ executablePath: resolveChrome(), args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start());
await dismissBriefing(page);
await waitForWorld(page);

const info = await page.evaluate(async () => {
  const g = window.__SANDS__;
  // HIGH fidelity: shadows are gated on it in main.js.
  if (g.setFidelity) g.setFidelity(true);
  await new Promise((r) => requestAnimationFrame(r));

  // Hide the HUD so nothing but the world is in frame.
  const hud = document.getElementById('hud');
  if (hud) hud.style.opacity = '0';
  const set = document.getElementById('settings');
  if (set) set.style.opacity = '0';
  if (g.viewmodel) g.viewmodel.group.visible = false;

  return {
    shadowsOn: g.renderer ? g.renderer.shadowMap.enabled : null,
    shadowType: g.renderer ? g.renderer.shadowMap.type : null,
    mapSize: g.sky && g.sky.sun ? g.sky.sun.shadow.mapSize.x : null,
  };
});
console.log('renderer:', JSON.stringify(info));

/** Stand at (x,z), look at a world point, settle, shoot. */
async function shot(name, at, look) {
  await page.evaluate(async ({ at, look }) => {
    const g = window.__SANDS__;
    g.player.teleport({ x: at[0], y: 0, z: at[1] });
    for (let i = 0; i < 220; i++) {
      g.player.update(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false }, 0);
      if (g.player.state.grounded) break;
    }
    const c = g.player.position;
    g.rig.reset(Math.atan2(-(look[0] - c.x), -(look[2] - c.z)),
                Math.atan2(look[1] - c.y, Math.hypot(look[0] - c.x, look[2] - c.z)));
    g.rig.update(1 / 60, g.player, false);
    g.camera.updateMatrixWorld(true);
    if (g.sky && g.sky.follow) g.sky.follow(g.player.position);
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
  }, { at, look });
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(`  ${name}`);
}

// Crates in the camp, close. This is where a contact shadow either exists or
// does not, and it is the exact defect round 1 named: "they cast no contact
// shadow, which is why they float."
await shot('shadow-1-crates', [1.5, 20.5], [3.0, 0.4, 17.2]);
await browser.close();
