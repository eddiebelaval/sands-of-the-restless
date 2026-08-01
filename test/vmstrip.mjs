/**
 * FRAME STRIPS for the viewmodel's two hand animations: the reload and the
 * khopesh swing. Not a pass/fail suite - an eye, and a measurement beside it.
 *
 * WHY A STRIP AND NOT A SCREENSHOT. One still of a reload proves the gun was
 * somewhere at some instant. It cannot show whether the magazine actually left
 * the well, whether the bolt travelled, or whether the pose SNAPPED between two
 * keys instead of blending through them. Four of this project's confirmed
 * never-rendered bugs were in this exact file, and every one of them survived
 * because the evidence offered was a single frame. So the sequence is walked end
 * to end and a numbered PNG is written at each beat.
 *
 * WHY THE GAME IS PAUSED AND THE ANIMATION IS HAND-CRANKED. Two reasons, and
 * both are about the strip being the same strip twice:
 *
 *   1. Sway advances per FRAME, off a delta this loop hands out. A strip that
 *      waits on the wall clock renders at a different sway phase under
 *      different machine load, so two runs of the same code produce two
 *      different pictures and nothing can be compared against anything. Here
 *      EVERY delta the viewmodel sees is issued by this file, so swayT is a
 *      pure function of which frame we are on.
 *   2. A screenshot under swiftshader costs the better part of a second. A
 *      0.45 second swing would be over before the second frame landed. Paused,
 *      main.js still renders the composer at delta zero every frame - so the
 *      canvas stays live for the capture while nothing advances - and the pose
 *      only moves when this file says so.
 *
 * WHY THE POSE IS DRIVEN TO A TARGET PROGRESS RATHER THAN FOR A FIXED TIME.
 * The reload's length is per weapon and the Shrine of Ptah halves it at
 * runtime. A strip keyed to seconds would sample seven weapons at seven
 * different points of the same animation and a boon would move all of them.
 * Keyed to the normalised progress the animation itself reports, frame 5 of the
 * LMG and frame 5 of the pistol are the same MOMENT of the same track, which is
 * the only way the two can be looked at side by side.
 *
 * Usage:
 *   node test/vmstrip.mjs <baseUrl> <outDirName> [--weapons=mk9,shotgun] [--only=reload|melee]
 */

import { chromium } from 'playwright';
import { resolveChrome } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:5237/index.html';
const DIR = process.argv[3] || 'vm';
const argOf = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const WEAPONS = argOf('weapons', 'mk9').split(',').filter(Boolean);
const ONLY = argOf('only', 'both');

const OUT = new URL(`../shots/${DIR}/`, import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/**
 * Where along each track a frame is taken.
 *
 * Nine samples rather than an even ten, and the values are not evenly spaced:
 * they are clustered where the tracks put their keys. An even sweep spends
 * frames on the long dwell in the middle of a reload - where the hand is off
 * frame and nothing moves - and skips the seat-and-tug beat, which is the part
 * that either reads as a person or does not.
 */
const RELOAD_MARKS = [0.00, 0.10, 0.20, 0.34, 0.46, 0.58, 0.66, 0.78, 0.90, 0.98];

/**
 * The swing, sampled around CONTACT. MELEE.contact / MELEE.swing in
 * systems/melee.js is 0.22/0.45 = 0.489, so 0.49 is the frame the damage lands
 * on and it gets a sample on each side of it.
 */
const MELEE_MARKS = [0.00, 0.12, 0.20, 0.28, 0.36, 0.44, 0.49, 0.56, 0.64, 0.72, 0.80, 0.90, 0.98];

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.setDefaultTimeout(180000);
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2600);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1800);

// ---------------------------------------------------------------------------
// Freeze. The pause panel is DOM, so it is hidden by style rather than by not
// opening it: the pause is what stops the loop advancing anything, and the
// panel is what would otherwise be sitting over the gun in every frame.
// ---------------------------------------------------------------------------
await page.evaluate(() => {
  const g = window.__SANDS__;
  g.pause.open();
  for (const el of document.querySelectorAll('#pause, .pause, #pause-root')) {
    el.style.visibility = 'hidden';
  }
  // Belt and braces: whatever the panel's root element is, it is the one that
  // just became visible and covers the screen.
  for (const el of document.body.children) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && cs.visibility === 'visible'
        && el.tagName !== 'CANVAS' && el.offsetHeight > 400) {
      el.dataset.stripHidden = '1';
      el.style.visibility = 'hidden';
    }
  }
});

/** The context main.js hands the viewmodel, standing still, on the ground. */
const CTX = { speed: 0, grounded: true, ads: false, sprinting: false, lookDx: 0, lookDy: 0 };

/**
 * Crank the animation forward until it reports `target` progress.
 *
 * 4ms per step, which is finer than any frame the game will ever run at. The
 * sampling has to be finer than the beats or a step lands past a key and the
 * strip shows a pose the animation never actually held.
 *
 * ALWAYS AT LEAST ONE STEP, including at target zero. Without it the frame at
 * progress 0.00 is captured before update() has run once, which is the frame
 * before the animation exists rather than its first frame - and for the swing
 * that is the difference between a blade parked off screen and a blade sitting
 * at the group origin in the middle of the view. The strip caught that; the
 * fix is in viewmodel.js and this line is what keeps the strip honest about it.
 */
const crankTo = (kind, target) => page.evaluate(({ kind, target, ctx }) => {
  const vm = window.__SANDS__.viewmodel;
  const read = () => (kind === 'reload' ? vm.state.reloadProgress : vm.state.meleeProgress);
  let guard = 0;
  vm.update(0.004, ctx);
  while (read() < target && guard++ < 5000) vm.update(0.004, ctx);
  return {
    phase: vm.state.phase,
    progress: +read().toFixed(4),
    steps: guard,
    melee: vm.state.melee,
  };
}, { kind, target, ctx: CTX });

/**
 * DOES THE THING ON SCREEN ACTUALLY DRAW PIXELS.
 *
 * Renders the frame twice - once as it is, once with the object switched off -
 * and counts how many pixels changed. A pose that is correct in the transform
 * and invisible in the buffer is this project's single most repeated defect,
 * and the only claim that closes it is a pixel count taken from the frame the
 * strip is showing.
 *
 * Returns the changed-pixel count and it as a fraction of the frame.
 */
const pixelProof = async (name, toggle) => {
  const a = await page.screenshot({ path: `${OUT}proof-${name}-on.png`, timeout: 180000 });
  await page.evaluate((t) => {
    const vm = window.__SANDS__.viewmodel;
    const target = t === 'blade' ? vm.khopesh : vm.model.root;
    target.userData.stripWas = target.visible;
    target.visible = false;
  }, toggle);
  await page.waitForTimeout(160);
  const b = await page.screenshot({ path: `${OUT}proof-${name}-off.png`, timeout: 180000 });
  await page.evaluate((t) => {
    const vm = window.__SANDS__.viewmodel;
    const target = t === 'blade' ? vm.khopesh : vm.model.root;
    target.visible = target.userData.stripWas !== false;
  }, toggle);
  await page.waitForTimeout(160);

  const sharp = (await import('sharp')).default;
  const [ra, rb] = await Promise.all([
    sharp(a).raw().ensureAlpha().toBuffer({ resolveWithObject: true }),
    sharp(b).raw().ensureAlpha().toBuffer({ resolveWithObject: true }),
  ]);
  let changed = 0;
  const A = ra.data, B = rb.data;
  for (let i = 0; i < A.length; i += 4) {
    if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 12) changed++;
  }
  const total = ra.info.width * ra.info.height;
  return { changed, fraction: +(changed / total).toFixed(4) };
};

const report = { base: BASE, out: OUT, reload: {}, melee: null };

// ---------------------------------------------------------------------------
// THE RELOAD, per weapon
// ---------------------------------------------------------------------------
if (ONLY !== 'melee') {
  for (const id of WEAPONS) {
    const ready = await page.evaluate(async (w) => {
      const g = window.__SANDS__;
      const vm = g.viewmodel;
      vm.equip(w);
      // Run the raise on hand-cranked deltas too, so the weapon arrives at the
      // same pose every run rather than wherever the wall clock left it.
      const ctx = { speed: 0, grounded: true, ads: false, sprinting: false };
      for (let i = 0; i < 400 && vm.state.phase !== 'ready'; i++) vm.update(0.008, ctx);
      return { phase: vm.state.phase, weapon: vm.state.weapon };
    }, id);

    const started = await page.evaluate(() => window.__SANDS__.viewmodel.reload());
    const frames = [];

    for (const mark of RELOAD_MARKS) {
      const at = await crankTo('reload', mark);
      const parts = await page.evaluate(() => {
        const vm = window.__SANDS__.viewmodel;
        const m = vm.model;
        return {
          magY: m.mag ? +m.mag.position.y.toFixed(4) : null,
          magDrop: m.mag ? +(m.mag.position.y - (m.mag.userData.baseY ?? m.mag.position.y)).toFixed(4) : null,
          boltZ: m.bolt ? +m.bolt.position.z.toFixed(4) : null,
          boltTravel: m.bolt ? +(m.bolt.position.z - (m.bolt.userData.baseZ ?? m.bolt.position.z)).toFixed(4) : null,
          groupY: +vm.group.position.y.toFixed(4),
          groupZ: +vm.group.position.z.toFixed(4),
          groupRz: +vm.group.rotation.z.toFixed(4),
        };
      });
      const tag = String(Math.round(mark * 100)).padStart(3, '0');
      await page.screenshot({ path: `${OUT}reload-${id}-p${tag}.png`, timeout: 180000 });
      frames.push({ mark, ...at, ...parts });
    }

    report.reload[id] = { ready, started, frames };

    // Let it run out so the next weapon starts from 'ready'.
    await page.evaluate(() => {
      const vm = window.__SANDS__.viewmodel;
      const ctx = { speed: 0, grounded: true, ads: false, sprinting: false };
      for (let i = 0; i < 2000 && vm.state.phase === 'reloading'; i++) vm.update(0.008, ctx);
    });
  }
}

// ---------------------------------------------------------------------------
// THE SWING
// ---------------------------------------------------------------------------
if (ONLY !== 'reload') {
  await page.evaluate(async () => {
    const vm = window.__SANDS__.viewmodel;
    const ctx = { speed: 0, grounded: true, ads: false, sprinting: false };
    vm.equip('mk9');
    for (let i = 0; i < 400 && vm.state.phase !== 'ready'; i++) vm.update(0.008, ctx);
  });

  const started = await page.evaluate(() => window.__SANDS__.viewmodel.melee());
  const frames = [];
  let contactProof = null, gunProof = null;

  for (const mark of MELEE_MARKS) {
    const at = await crankTo('melee', mark);
    const pose = await page.evaluate(() => {
      const g = window.__SANDS__;
      const vm = g.viewmodel;
      const k = vm.khopesh;
      // Where the blade is ON SCREEN, in normalised device coordinates. A
      // transform is not evidence on its own, but a tip that never enters
      // [-1,1] is proof the swing happened off camera.
      const tip = new g.THREE.Vector3(0, 0.36, 0);
      k.updateMatrixWorld(true);
      tip.applyMatrix4(k.matrixWorld).project(vm.camera);
      return {
        bladeVisible: k.visible,
        bladeP: [+k.position.x.toFixed(3), +k.position.y.toFixed(3), +k.position.z.toFixed(3)],
        bladeR: [+k.rotation.x.toFixed(3), +k.rotation.y.toFixed(3), +k.rotation.z.toFixed(3)],
        tipNdc: [+tip.x.toFixed(3), +tip.y.toFixed(3)],
        gunVisible: !!(vm.model && vm.model.root.visible),
        groupP: [+vm.group.position.x.toFixed(4), +vm.group.position.y.toFixed(4), +vm.group.position.z.toFixed(4)],
        groupR: [+vm.group.rotation.x.toFixed(4), +vm.group.rotation.y.toFixed(4), +vm.group.rotation.z.toFixed(4)],
      };
    });
    const tag = String(Math.round(mark * 100)).padStart(3, '0');
    await page.screenshot({ path: `${OUT}melee-p${tag}.png`, timeout: 180000 });
    frames.push({ mark, ...at, ...pose });

    /*
     * THE BLADE'S DRAWN AREA AT EVERY BEAT, not just at contact.
     *
     * One pixel count at the strike proves the blade is on screen when it
     * matters. It says nothing at all about the thing the note was actually
     * complaining about, which is the SHAPE of the entry - and an entry that
     * pops and an entry that travels both end with the same blade at contact.
     * The curve across the swing is the claim: it has to climb rather than
     * step, and it has to come back down the far side without crossing the
     * middle of the frame on its way to the park.
     */
    frames[frames.length - 1].bladePixels =
      (await pixelProof(`blade-p${tag}`, 'blade')).changed;

    // At contact, the gun as well. This is the frame the owner's note is
    // about - the blade over the gun, BOTH on screen at once.
    if (mark === 0.49) {
      contactProof = { changed: frames[frames.length - 1].bladePixels };
      gunProof = await pixelProof('gun-at-contact', 'gun');
    }
  }

  report.melee = { started, frames, contactProof, gunProof };
}

console.log(JSON.stringify({ ...report, errors: logs.filter((l) => l.startsWith('[pageerror]')) }, null, 2));
console.log('\nstrip -> ' + OUT);

await browser.close();
