/**
 * THE WEATHERING DATUM: is a room's grime measured from ITS floor, or from zero.
 *
 * `world/weathering.js` darkens stone toward the base of a wall, and it decides
 * where "the base" is with a single uniform, `uGroundLevel`, which was 0 for
 * every material in the game. The moment World 1 grew a descent, every surface
 * in the five Act 3 rooms sat below that datum, saturated the grime term at 1
 * and took the full dirt multiply. docs/DESCENT.md section 6 measured the cost
 * and named it as the one outstanding defect in that work.
 *
 * This file is the instrument that defect was found with and the instrument the
 * fix has to answer to. It does one thing: stand at the centre of each room with
 * the camera the same height above that room's own floor, and read the frame.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MEASURES PIXELS AND NOT UNIFORMS
 * ---------------------------------------------------------------------------
 *
 * Asserting that `uGroundLevel` holds -6 for the Act 3 instance would pass on a
 * build where the Act 3 meshes never got handed that material, which is exactly
 * the failure mode this project keeps hitting: the thing is written, it is
 * described, and it never renders. So the assertions below are about luminance
 * out of the compositor, and the uniform table is printed as evidence rather
 * than asserted on.
 *
 * THE READ HAPPENS INSIDE THE requestAnimationFrame CALLBACK. The drawing buffer
 * is not preserved, so a drawImage from anywhere else in the frame copies a
 * cleared canvas and reports a perfectly black screen for a scene that rendered
 * correctly. Lifted from test/descent.mjs, which lifted it from test/interior.mjs.
 *
 * Run it with no argument to print the table. Run it with --gate to also assert
 * the Act 3 floor is back inside the band Act 2 lives in.
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';

const BASE = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : (process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html');
const GATE = process.argv.includes('--gate');

/**
 * THE CONTROL, and the only honest source for the number the fix is aiming at.
 *
 * `--lift` translates the whole interior group +6 in y and puts the camera six
 * higher too, so every room sits back above the weathering datum carrying its
 * own lights, walls and props, and the camera stands at exactly the same height
 * above the same floor. Nothing about the room, its lighting or the framing
 * changes; only the absolute y the stone is drawn at. Whatever Act 3 reads under
 * --lift is what Act 3 would read if the datum were right, and it is what the
 * unlifted run has to match once the datum travels with the geometry.
 *
 * docs/DESCENT.md section 6 ran this experiment once by hand and recorded 13.83
 * to 21.78 for the Serdab. It lives in the harness now because a proof you have
 * to rebuild from a paragraph is a proof nobody re-runs.
 */
const LIFT = process.argv.includes('--lift') ? 6 : 0;

/**
 * THE DEFECT, PUT BACK, IN THE SAME PROCESS.
 *
 * `--defect` walks every compiled weathering material in the interior and forces
 * its `uGroundLevel` back to 0, which is bit-for-bit what the build did before
 * the per-floor material instances landed. That is a better "before" than a git
 * checkout: same browser, same driver, same frame budget, same everything except
 * the one number under test.
 *
 * It is also self-checking. If the mechanism did not take - if three.js re-ran
 * onBeforeCompile and handed the material its authored datum back - then a
 * --defect run would report the FIXED numbers, and the fixed numbers are already
 * known. A --defect run that matches the fixed table is a broken control and
 * must not be reported as a before.
 */
const DEFECT = process.argv.includes('--defect');

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1400);

await page.addScriptTag({
  content: `
window.__G__ = {
  async frames(n) {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  },

  /** Mean luminance and lit fraction over the top two thirds, world not weapon. */
  luma() {
    const c = window.__SANDS__.renderer.domElement;
    const sc = document.createElement('canvas');
    sc.width = c.width; sc.height = c.height;
    const cx = sc.getContext('2d', { willReadFrequently: true });

    return new Promise((resolve) => requestAnimationFrame(() => {
      cx.drawImage(c, 0, 0);
      const d = cx.getImageData(0, 0, sc.width, sc.height).data;
      let sum = 0, n = 0, lit = 0;
      const rows = Math.floor(sc.height * 0.66);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < sc.width; x += 4) {
          const i = (y * sc.width + x) * 4;
          const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
          sum += l; n++;
          if (l > 10) lit++;
        }
      }
      resolve({ mean: +(sum / n).toFixed(2), lit: +((lit / n) * 100).toFixed(1) });
    }));
  },

  openInterior() {
    let n = 0;
    for (const b of window.__SANDS__.spaces.interior.barriers) if (b.clearInstantly()) n++;
    return n;
  },

  /**
   * Translate the interior geometry, its lights and the floor the controller
   * grounds against, all by the same amount.
   *
   * The floor sampler has to move with the mesh or the control is not a control:
   * world.heightAt answers off the room records, which the group transform does
   * not touch, so a lifted room would drop the player back to the unlifted floor
   * on the first frame and the camera would end up six metres inside the stone.
   * Wrapped rather than replaced, and only once, so re-entering the space does
   * not stack the offset.
   */
  lift(n) {
    const g = window.__SANDS__;
    g.spaces.interior.group.position.y = n;
    if (!n || window.__G__._lifted) return;
    const inner = g.spaces.interior.heightAt;
    g.spaces.interior.heightAt = (x, z, footY) =>
      inner(x, z, footY === undefined ? undefined : footY - n) + n;
    // spaces.enter() copies this onto the live world handle and is a no-op once
    // the player is already inside, so the copy has to be made here as well.
    g.world.heightAt = g.spaces.interior.heightAt;
    window.__G__._lifted = true;
  },

  /**
   * HIDE THE CHEST, IN ALL THREE OF ITS HOMES.
   *
   * The Mystery Box has three authored spawns and it is placed at ONE of them
   * per run: spawn A is the dead centre of the Hall of Offerings, B the dead
   * centre of the Great Gallery, C the dead centre of the Star Shaft. This file
   * reads each room from its centre, so in three of the nine rows the camera is
   * standing inside a gilded, self-lit, animated fixture that is there on some
   * runs and not on others. Measured with it in the frame: the Star Shaft read
   * 24.28 on one run and 53.13 on the next, with nothing changed between them.
   *
   * A luminance instrument that reports two different numbers for one build is
   * not measuring the build. The chest comes out for the duration.
   */
  hideChests() {
    let n = 0;
    for (const rec of window.__SANDS__.spaces.interior.interacts || []) {
      if (rec.type !== 'box' || !rec.group) continue;
      rec.group.visible = false;
      n++;
    }
    return n;
  },

  /**
   * Force every weathering datum in the interior back to world zero, which is
   * the shipped defect. See the note on DEFECT in the harness.
   *
   * needsUpdate is what gets the mutated value uploaded: three.js only re-sends
   * a material's uniform block when the material's version has moved. The
   * compiled program is cached against customProgramCacheKey, which has not
   * changed, so this costs no recompile and does not re-run onBeforeCompile.
   */
  flattenDatums() {
    let n = 0;
    window.__SANDS__.spaces.interior.group.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        const sh = m.userData && m.userData.shader;
        if (!sh || !sh.uniforms || !sh.uniforms.uGroundLevel) continue;
        if (sh.uniforms.uGroundLevel.value === 0) continue;
        sh.uniforms.uGroundLevel.value = 0;
        m.needsUpdate = true;
        n++;
      }
    });
    return n;
  },

  /**
   * Every compiled weathering uniform in the scene, read off the live materials
   * rather than off the registry, so a variant that exists but is worn by
   * nothing shows up as absent from the mesh count.
   */
  datums() {
    const out = new Map();
    const visit = (root, space) => root.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        const sh = m.userData && m.userData.shader;
        if (!sh || !sh.uniforms || !sh.uniforms.uGroundLevel) continue;
        const key = space + '  ' + (m.name || '(unnamed)') + '  datum ' + sh.uniforms.uGroundLevel.value;
        out.set(key, (out.get(key) || 0) + 1);
      }
    });
    visit(window.__SANDS__.spaces.interior.group, 'interior');
    visit(window.__SANDS__.spaces.courtyard.group, 'courtyard');
    return [...out.entries()].sort();
  },
};
`,
});

await page.evaluate(() => { window.__SANDS__.combat.state.invulnerable = true; });

// ---------------------------------------------------------------------------
// the nine interior rooms, each read from its own centre at its own floor
// ---------------------------------------------------------------------------
//
// Feet on the room's own `base` and yaw fixed at 0 for every room, so the only
// thing that differs between two rows is the room. A per-room yaw chosen to
// frame something would make the table prettier and would stop it being a
// controlled comparison.

const rooms = await page.evaluate(() => {
  window.__SANDS__.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
  window.__G__.openInterior();
  return window.__SANDS__.spaces.interior.rooms.map((r) => ({
    id: r.id, x: r.bounds.x, z: r.bounds.z, base: r.base || 0,
  }));
});

const table = [];
for (const r of rooms) {
  await page.evaluate(([room, lift]) => {
    const g = window.__SANDS__;
    g.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
    window.__G__.openInterior();
    window.__G__.hideChests();
    window.__G__.lift(lift);
    g.player.teleport({ x: room.x, y: room.base + lift, z: room.z });
    g.rig.reset(0, -0.02);
  }, [r, LIFT]);
  await page.evaluate(() => window.__G__.frames(8));
  // After the frames, not before them: a material has no compiled shader to
  // reach into until something has actually drawn with it, and three of these
  // instances are only ever drawn in Act 3.
  if (DEFECT) {
    await page.evaluate(() => window.__G__.flattenDatums());
    await page.evaluate(() => window.__G__.frames(4));
  }
  const lum = await page.evaluate(() => window.__G__.luma());
  // The eye is read back rather than assumed. A row measured from the wrong
  // height is not a dark room, it is a broken instrument, and the two look
  // identical in a luminance column.
  const eye = await page.evaluate(() => +window.__SANDS__.player.position.y.toFixed(2));
  table.push({ id: r.id, base: r.base, eye, ...lum });
}

// ---------------------------------------------------------------------------
// one exterior sample, to prove the fix did not strip grime off the courtyard
// ---------------------------------------------------------------------------
//
// The courtyard is the surface `uGroundLevel = 0` was authored for, and the
// obvious wrong fix - lowering the datum globally - shows up here and nowhere
// else. Facing the pyramid from the approach, which is the most stone-filled
// frame the exterior has.

const exterior = await (async () => {
  await page.evaluate(() => {
    const g = window.__SANDS__;
    g.spaces.enter('exterior', { x: 0, z: -60, rot: 0 });
    g.player.teleport({ x: 0, y: 0, z: -60 });
    g.rig.reset(0, -0.02);
  });
  await page.evaluate(() => window.__G__.frames(8));
  return page.evaluate(() => window.__G__.luma());
})();

const datums = await page.evaluate(() => {
  window.__SANDS__.spaces.enter('interior', { x: 0, z: -170, rot: 0 });
  return window.__G__.datums();
});

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const IGNORABLE = [/GPU stall due to ReadPixels/, /GL Driver Message/];
const errors = logs.filter((l) => /^\[(error|pageerror)\]/.test(l) && !IGNORABLE.some((r) => r.test(l)));

console.log(`\n--- centre-of-room luminance, feet on the room floor, yaw 0, chest hidden${LIFT ? `, INTERIOR LIFTED +${LIFT} (control)` : ''}${DEFECT ? ', DATUMS FLATTENED TO 0 (the defect)' : ''} ---`);
console.log('room                  base     eye     mean     lit%');
for (const t of table) {
  console.log(`  ${t.id.padEnd(20)}${String(t.base).padStart(4)}  ${String(t.eye).padStart(6)}  ${String(t.mean).padStart(7)}  ${String(t.lit).padStart(7)}`);
}
console.log(`  ${'EXTERIOR (0,-60)'.padEnd(20)}${'0'.padStart(4)}  ${'-'.padStart(6)}  ${String(exterior.mean).padStart(7)}  ${String(exterior.lit).padStart(7)}`);

console.log('\n--- compiled weathering datums, per material instance, with mesh counts ---');
for (const [k, n] of datums) console.log(`  ${k.padEnd(46)} ${n} mesh(es)`);

const by = Object.fromEntries(table.map((t) => [t.id, t]));
const act2 = ['chamber-of-ascent', 'hall-of-offerings', 'granary-vault', 'great-gallery'];
const act3 = ['embalming-chamber', 'canopic-crypt', 'star-shaft', 'kings-chamber', 'serdab'];

const mean = (ids) => ids.reduce((s, id) => s + by[id].mean, 0) / ids.length;
console.log(`\n  act 2 mean ${mean(act2).toFixed(2)}   act 3 mean ${mean(act3).toFixed(2)}`);

if (GATE) {
  const checks = {
    /**
     * The Serdab is the room the whole ending happens in and the room the defect
     * cost most. Measured on this instrument: 7.64 with the datums flattened,
     * 20.78 with the geometry lifted back above a flat datum, 19.8 with the
     * datum travelling with the geometry and nothing lifted. 17 sits between the
     * defect and the control with room either side for swiftshader, which is not
     * bit-exact frame to frame.
     */
    'the serdab has recovered the albedo the descent cost it':
      by.serdab.mean > 17,

    /**
     * Every Act 3 room dropped when the floor did, and none of them may still be
     * sitting at the bottom of that drop.
     *
     * 17 is a clean separator rather than a tuned one: with the datums flattened
     * the five rooms read 7.6, 12.2, 12.6, 14.1 and 15.8, and with the datum
     * travelling they read 18.8, 19.0, 19.1, 19.8 and 24.1. Nothing lands near
     * the line from either side.
     *
     * NOT stated as "no darker than the darkest Act 2 room", which was the first
     * cut of this check and was wrong: the Embalming Chamber is authored darker
     * than the Chamber of Ascent on purpose and reads 18.8 against 20.1, so that
     * form failed a build with the defect fixed.
     */
    'every Act 3 room is out of the grime hole':
      act3.every((id) => by[id].mean > 17),

    // The exterior is what uGroundLevel = 0 was authored for, and lowering the
    // datum globally was the obvious wrong fix. It would show up here and
    // nowhere else, as the courtyard losing the grime it is supposed to have.
    // Measured across six runs: 66.7 to 69.2, the spread being the clouds.
    'the exterior still has its grime':
      exterior.mean > 60 && exterior.mean < 80,

    // Act 2 is not supposed to have moved at all. Measured 20.1 / 21.3 / 21.8 /
    // 23.6 with the fix in and 20.3 / 21.7 / 21.0 / 23.3 with it flattened.
    'act 2 is untouched':
      act2.every((id) => by[id].mean > 18 && by[id].mean < 27),

    'no console errors': errors.length === 0,
  };

  console.log('\n--- checks ---');
  let failed = 0;
  for (const [name, ok] of Object.entries(checks)) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  }
  if (errors.length) console.log(`\nconsole:\n${errors.join('\n')}`);
  console.log(`\n${failed ? `${failed} CHECK(S) FAILED` : 'GRIME: all checks pass'}`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}

if (errors.length) console.log(`\nconsole:\n${errors.join('\n')}`);
await browser.close();
