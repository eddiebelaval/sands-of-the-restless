/**
 * DID THE CARVING REACH THE SHIPPED BUILD, AND WHAT DID IT COST THE BEETLE.
 *
 * THE DEFECT THIS FILE EXISTS FOR. world/textures.js paints a register band and
 * a scatter of carved marks, and world/materials.js throws the whole canvas away
 * at boot: `applyMaps(m.limestone, sets.limestone)` replaces every map on the
 * wall material with the bricks083 photograph, and `assetsFailed` is empty in
 * every normal run. So `paintMasonry(..., { hieroglyphs: true, register: true })`
 * rendered on the asset-404 path and NOWHERE ELSE. The owner asked for carving
 * on the interior walls and it could not physically appear.
 *
 * The previous lane's harness measured the register by swapping two canvases it
 * built ITSELF onto the wall in the page. That proves the painter draws a band.
 * It cannot prove the band is on screen in a normal run, and it was not.
 *
 * SO THE FIRST CONTROL IS THE ONE THAT MATTERS, and it is the trap:
 *
 *   EVERY PIXEL MEASUREMENT IN THIS FILE IS TAKEN IN A RUN WHERE THE SCANS
 *   LOADED, AND THAT IS ASSERTED FROM OUTSIDE THE PAGE BEFORE ANY OF IT.
 *
 * Three separate facts, because any one alone can be true while the lane has
 * failed: `assetsFailed` is empty; `limestone.map` is a downloaded image whose
 * URL names bricks083; and `frieze.userData.friezeSource` is 'scan', which is
 * only written by the branch of applyFrieze that composites onto a photograph.
 * A harness that skips these is measuring the code that already worked.
 *
 * WHAT IS ACTUALLY BEING CHOSEN. Putting an inscription on a wall that wears a
 * photographic scan is a trade, and there is more than one way to make it. FIVE
 * states are rendered at ONE pose in ONE frozen frame, differing only in what
 * the wall wears:
 *
 *   before   the shipped wall today: bricks083, no carving. The control.
 *   proc     a wholly procedural frieze set, the obvious move. Painted masonry
 *            with the inscription in it, Sobelled normal, derived roughness -
 *            and no photograph anywhere.
 *   hybrid   the procedural albedo over the SCAN's normal, roughness and AO.
 *            Close to real Egyptian practice: decoration on dressed stone.
 *   sunk     the inscription composited INTO the scan as a dark recess. The
 *            first cut of this lane, and rejected by the beetle control below.
 *   ship     the same composite with the band as a LIMEWASHED PANEL - lifted
 *            above the wall rather than cut dark into it.
 *
 * and they are judged on two numbers pulling in opposite directions: how much
 * the inscription reaches the frame, and how much of the stone's own
 * high-frequency detail is still there once it has.
 *
 * THE BEETLE IS THE THIRD CONTROL AND IT DID VETO A DESIGN. enemies/wallcrawl.js
 * put a gold scarab on the WALLS, so a decorated wall is now the background of a
 * fight. The previous lane had to reverse its first ceiling design because it
 * lost 69.2 per cent of the scarab's body; the dark-recess band did the same
 * thing here and `sunk` is in the list above so that rejection stays
 * reproducible. The scarab is staged on a wall and measured on the pixels it
 * covers, before and after, in the same frozen frame - and then again with the
 * body LIFTED ONTO THE BAND, because a beetle that happens to have stopped on
 * plain stone proves nothing about a beetle standing on the carving.
 *
 * A REGRESSION IS A FAILURE TO REPORT, NOT A NUMBER TO TUNE AROUND.
 *
 * Serve the repo root with `python3 -m http.server 4177`, then `node
 * test/frieze.mjs`. `--census` prints only the scene census and exits, so the
 * same script can be run against a stashed tree for the matching before.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveChrome, GL_ARGS } from './chrome.mjs';

// argv[2] is the URL, but only if it looks like one: `--census` is a flag and
// handing it to page.goto is a protocol error rather than a helpful message.
const ARG_URL = (process.argv[2] || '').startsWith('http') ? process.argv[2] : null;
const BASE = ARG_URL || process.env.SANDS_URL || 'http://127.0.0.1:4177/index.html';
const OUT = new URL('../shots/frieze/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
await page.waitForTimeout(2200);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

/** Tiles per world unit on a wall. Mirrors DENSITY.limestone in world/build.js. */
const WALL_DENSITY = 0.17;

/**
 * THE SCENE CENSUS, AT ONE FIXED POSE, AND IT RUNS BEFORE ANYTHING ELSE.
 *
 * `--census` runs ONLY this and exits, so the same script can be pointed at a
 * tree with the frieze disabled and at this one, and the two numbers compared.
 * It is placed HERE rather than at the end on purpose: a draw call and texture
 * count taken after this harness has built three candidate map sets, uploaded
 * them and spawned two actors is not a measurement of what ships.
 */
const census = () => page.evaluate(async () => {
  const g = window.__SANDS__;
  window.__FREEZE__ && window.__FREEZE__.off();
  g.director.reset();
  g.spaces.enter('interior', { x: -45, z: -147, rot: 0 });
  for (let i = 0; i < 120; i++) {
    g.player.position.x = -45;
    g.player.position.z = -147;
    await new Promise((r) => requestAnimationFrame(r));
  }
  g.rig.reset(-2.536, 0.13);

  /**
   * THE HORDE IS CLEARED IMMEDIATELY BEFORE THE COUNT, AND THE FIRST CUT WAS NOT.
   *
   * 120 frames of pinning the player is 120 frames in which the director is
   * alive and spawning, and a mummy is a dozen meshes with its own materials. The
   * first before/after taken this way read +67 scene meshes, +66 geometries and
   * +19 unique materials for a change that adds ONE material and touches no
   * geometry at all - the interior mesh count was identical at 913 in both, which
   * is the tell. That is a census of whatever happened to be walking toward the
   * camera, and it would have been reported as the cost of this lane.
   */
  g.director.reset();
  g.director.state.timer = 1e9;
  for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r));

  g.renderer.info.autoReset = false;
  g.renderer.info.reset();
  await new Promise((r) => requestAnimationFrame(r));
  const render = { ...g.renderer.info.render };
  const memory = { ...g.renderer.info.memory };
  g.renderer.info.autoReset = true;

  const names = new Map();
  let meshes = 0;
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) if (m) names.set(m.uuid, m.name || m.type);
  });

  const interior = g.scene.getObjectByName('interior');
  let interiorMeshes = 0;
  const matUse = {};
  interior && interior.traverse((o) => {
    if (!o.isMesh) return;
    interiorMeshes++;
    const n = o.material?.name || o.material?.type;
    matUse[n] = (matUse[n] || 0) + 1;
  });

  return { render, memory, uniqueMaterials: names.size, meshes, interiorMeshes, matUse };
});

if (process.argv.includes('--census')) {
  const c = await census();
  console.log(JSON.stringify(c, null, 2));
  await browser.close();
  process.exit(0);
}

// ===========================================================================
// PART ZERO: THE RUN IS A NORMAL RUN
// ===========================================================================

const provenance = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const M = await import(new URL('../src/world/materials.js', location.href).href);
  const reg = M.buildMaterials();

  const src = (t) => {
    if (!t) return null;
    const im = t.image;
    if (!im) return 'no-image';
    if (im.src) return im.src.split('/').slice(-2).join('/');
    return im.constructor ? im.constructor.name : 'unknown';
  };

  // Every frieze instance in the scene, including the per-elevation weathering
  // variants, because a fix that lands on the datum-0 rooms and misses the five
  // rooms at -6 is half a fix and renders as "the deep rooms look wrong".
  const instances = [];
  g.scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const m = o.material;
    if (!/^frieze/.test(m.name || '')) return;
    if (instances.some((i) => i.mat === m)) return;
    instances.push({ mat: m, name: m.name });
  });

  return {
    assetsFailed: g.assetsFailed || null,
    limestoneMap: src(reg.limestone.map),
    friezeSource: reg.frieze.userData.friezeSource || null,
    friezeMap: src(reg.frieze.map),
    friezeNormal: src(reg.frieze.normalMap),
    // Shared by reference with limestone's, which is the claim applyFrieze makes
    // about costing two GPU textures instead of four.
    roughShared: reg.frieze.roughnessMap === reg.limestone.roughnessMap,
    aoShared: reg.frieze.aoMap === reg.limestone.aoMap,
    friezeInstances: instances.map((i) => ({
      name: i.name,
      map: src(i.mat.map),
      rough: src(i.mat.roughnessMap),
      ns: i.mat.normalScale.x,
    })),
    inRegistry: Object.keys(reg).includes('frieze'),
  };
});

console.log('');
console.log('PART ZERO: IS THIS A NORMAL RUN');
console.log(`  assetsFailed              ${JSON.stringify(provenance.assetsFailed)}`);
console.log(`  limestone.map             ${provenance.limestoneMap}`);
console.log(`  frieze.userData.source    ${provenance.friezeSource}`);
console.log(`  frieze.map / normalMap    ${provenance.friezeMap} / ${provenance.friezeNormal}`);
console.log(`  roughness/AO shared       ${provenance.roughShared} / ${provenance.aoShared}`);
for (const i of provenance.friezeInstances) {
  console.log(`  instance ${i.name.padEnd(12)} map ${i.map}, rough ${i.rough}, normalScale ${i.ns}`);
}

ok(Array.isArray(provenance.assetsFailed) && provenance.assetsFailed.length === 0,
  'CONTROL 1a: no asset failed, so this is the path the player is on');
ok(/bricks083/.test(provenance.limestoneMap || ''),
  `CONTROL 1b: the wall scan genuinely loaded (limestone.map = ${provenance.limestoneMap})`);
ok(provenance.friezeSource === 'scan',
  'CONTROL 1c: the frieze was built by compositing ONTO that scan, not by the 404 fallback');
ok(provenance.friezeMap === 'HTMLCanvasElement' && provenance.friezeNormal === 'HTMLCanvasElement',
  'the frieze carries composited maps and survived upgradeMaterials');
ok(provenance.roughShared && provenance.aoShared,
  'roughness and AO are the scan objects themselves, so the cost is +2 textures not +4');
ok(provenance.friezeInstances.length >= 2
  && provenance.friezeInstances.every((i) => i.map === 'HTMLCanvasElement'),
  `every frieze instance got the composite, including the -6 variant (${provenance.friezeInstances.length} instances)`);
ok(provenance.inRegistry,
  'the frieze is a registry member, so applyFidelity walks it (see the LOW check below)');

/**
 * THE INSCRIPTION IS IN THE SHIPPED TEXTURE, MEASURED AGAINST THE RAW SCAN.
 *
 * A texture-level check, and it is deliberately NOT the claim this file is here
 * to make - the claim is pixels on screen, and that is Part Two. This one is
 * here because if it fails, the render measurement is measuring nothing and the
 * failure should be legible rather than arriving as a mysterious null delta.
 */
const texProof = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const M = await import(new URL('../src/world/materials.js', location.href).href);
  const reg = M.buildMaterials();

  const read = (image) => {
    const c = document.createElement('canvas');
    c.width = image.width; c.height = image.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(image, 0, 0);
    return { w: image.width, h: image.height, d: x.getImageData(0, 0, image.width, image.height).data };
  };

  const scan = read(reg.limestone.map.image);
  const frieze = read(reg.frieze.map.image);
  if (scan.w !== frieze.w || scan.h !== frieze.h) return { fatal: 'size mismatch' };

  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

  // Per-row mean absolute difference. A register is a horizontal band, so the
  // signature is a few rows moving a long way and the rest not moving at all.
  const rows = [];
  for (let y = 0; y < scan.h; y++) {
    let s = 0;
    for (let x = 0; x < scan.w; x++) {
      const i = (y * scan.w + x) * 4;
      s += Math.abs(lum(frieze.d, i) - lum(scan.d, i));
    }
    rows.push(s / scan.w);
  }
  const sorted = rows.slice().sort((a, b) => a - b);
  return {
    size: `${scan.w}x${scan.h}`,
    peakRow: +Math.max(...rows).toFixed(2),
    medianRow: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
    changedRowsPct: +((rows.filter((v) => v > 1).length / rows.length) * 100).toFixed(1),
    // Where the band sits in the tile, as a fraction of tile height, so the
    // world height it lands at can be derived rather than assumed.
    peakAtV: +(rows.indexOf(Math.max(...rows)) / scan.h).toFixed(3),
  };
});

console.log('');
console.log(`  the shipped frieze albedo against the raw scan (${texProof.size})`);
console.log(`  peak row |dL| ${texProof.peakRow}, median row ${texProof.medianRow}`
  + `, ${texProof.changedRowsPct}% of rows changed, peak at v ${texProof.peakAtV}`);
ok(texProof.peakRow > 8 && texProof.medianRow < 3,
  'the inscription is IN the shipped albedo and is a band, not a retint');

// ===========================================================================
// THE PAGE-SIDE TOOLKIT
// ===========================================================================

await page.evaluate(() => {
  window.__PIX__ = {
    async load(dataUrl) {
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = dataUrl; });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      return { w: img.width, h: img.height, d: x.getImageData(0, 0, img.width, img.height).data };
    },
    lum(d, i) { return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; },
  };
});

/**
 * Everything needed to hold one frame absolutely still.
 *
 * `post.update` and `viewmodel.update` are in here for a measured reason the
 * previous lane paid for: core/post.js's GradePass hashes `uTime` into a film
 * grain, so two screenshots of a frozen scene differ EVERYWHERE and every delta
 * arrives with sand on it; and the player's hands sway on their own clock and
 * are the only other thing moving while paused.
 */
await page.evaluate(() => {
  const g = window.__SANDS__;
  window.__FREEZE__ = {
    saved: null,
    on() {
      if (this.saved) return;
      this.saved = {
        d: g.director.update, i: g.interior.update,
        p: g.post.update, v: g.viewmodel.update,
      };
      g.director.update = () => {};
      g.interior.update = () => {};
      g.post.update = () => {};
      g.viewmodel.update = () => {};
    },
    off() {
      if (!this.saved) return;
      g.director.update = this.saved.d;
      g.interior.update = this.saved.i;
      g.post.update = this.saved.p;
      g.viewmodel.update = this.saved.v;
      this.saved = null;
    },
  };
});

/**
 * THE FOUR WALL STATES, BUILT ONCE AND SWAPPED IN ONE FRAME.
 *
 * `before` is the material world/build.js hung on `mesh.userData.priorMaterial`,
 * which is the SAME OBJECT the shipped build was using last week rather than a
 * reconstruction of it. The other three are three map sets installed onto the
 * frieze material itself, so the mesh list, the geometry, the weathering
 * injection and the draw order are identical across all four and the only
 * variable in the comparison is what is sampled.
 */
const build = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const T = await import(new URL('../src/world/textures.js', location.href).href);
  const M = await import(new URL('../src/world/materials.js', location.href).href);
  const THREE = g.THREE;
  const reg = M.buildMaterials();

  const wrap = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 1);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };

  // --- candidate: wholly procedural, the obvious move ----------------------
  const procCanvas = T._internals.paintMasonry(512, { rows: 6, seed: 3, hieroglyphs: true });
  T._internals.drawInscription(
    procCanvas.getContext('2d', { willReadFrequently: true }), 512, 512);
  const procSet = T._internals.materialMaps(procCanvas, {
    normalStrength: 3.0, rough: [0.62, 0.94],
  });

  // --- candidate: the same composite with the DARK RECESS ground -----------
  //
  // The first cut of this lane, and the physically obvious reading of a
  // chiselled register. It is built here rather than described, so the beetle
  // measurement that rejected it is reproducible in the same run as the one that
  // chose the replacement.
  const sunk = T._internals.inscribeScan(
    reg.limestone.map.image, reg.limestone.normalMap.image, { ground: 'sunk' });

  // --- the shipped composite, as it stands on the material right now -------
  const ship = {
    map: reg.frieze.map,
    normalMap: reg.frieze.normalMap,
    roughnessMap: reg.frieze.roughnessMap,
    aoMap: reg.frieze.aoMap,
    normalScale: reg.frieze.normalScale.x,
  };

  const SETS = {
    // Procedural albedo, procedural normal, procedural roughness, no AO.
    proc: {
      map: procSet.map,
      normalMap: procSet.normalMap,
      roughnessMap: procSet.roughnessMap,
      aoMap: null,
      normalScale: 1.1,
    },
    // Procedural albedo over the SCAN's normal, roughness and AO.
    hybrid: {
      map: procSet.map,
      normalMap: reg.limestone.normalMap,
      roughnessMap: reg.limestone.roughnessMap,
      aoMap: reg.limestone.aoMap,
      normalScale: 1.0,
    },
    // The composite, dark-recess ground.
    sunk: {
      map: wrap(sunk.albedo, true),
      normalMap: wrap(sunk.normal, false),
      roughnessMap: reg.limestone.roughnessMap,
      aoMap: reg.limestone.aoMap,
      normalScale: 1.0,
    },
    ship,
  };

  // Every frieze instance, so a swap covers the -6 rooms as well as the datum.
  const friezes = [];
  g.scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if (!/^frieze/.test(o.material.name || '')) return;
    if (!friezes.includes(o.material)) friezes.push(o.material);
  });

  window.__WALL__ = {
    modes: Object.keys(SETS).concat('before'),
    /** Put every wall mesh on the shipped frieze material, or on the old stone. */
    material(which) {
      let n = 0;
      const names = new Set();
      g.scene.traverse((o) => {
        if (!o.isMesh || !o.userData.wall) return;
        if (!o.userData.friezeMaterial) o.userData.friezeMaterial = o.material;
        o.material = which === 'before' ? o.userData.priorMaterial : o.userData.friezeMaterial;
        names.add(o.material.name);
        n++;
      });
      return { n, materials: [...names] };
    },
    /** Install one of the three candidate map sets on the frieze material. */
    maps(which) {
      const s = SETS[which];
      for (const m of friezes) {
        m.map = s.map;
        m.normalMap = s.normalMap;
        m.roughnessMap = s.roughnessMap;
        m.aoMap = s.aoMap;
        m.normalScale.setScalar(s.normalScale);
        m.needsUpdate = true;
      }
      return which;
    },
  };

  return { friezeInstances: friezes.map((m) => m.name) };
});

console.log('');
console.log(`  ${build.friezeInstances.length} frieze instances under test: ${build.friezeInstances.join(', ')}`);

const shot = async (name) => {
  const buf = await page.screenshot({ path: `${OUT}${name}.png` });
  return `data:image/png;base64,${buf.toString('base64')}`;
};
const settle = async () => { await page.waitForTimeout(140); };

const setMaterial = (w) => page.evaluate((m) => window.__WALL__.material(m), w);
const setMaps = (w) => page.evaluate((m) => window.__WALL__.maps(m), w);

// ===========================================================================
// PART ONE: THE WALL, AND WHICH OF THE THREE TRADES IS THE RIGHT ONE
// ===========================================================================

/**
 * The pose is DERIVED, not typed in.
 *
 * The band sits at texture v 0.5, the wall UVs are world-scaled at 0.17 tiles
 * per unit by world/uv.js, and a wall's v origin is its own bottom - so the band
 * is at floor + 0.5/0.17 = 2.94 m and the camera can be aimed at a number rather
 * than at a guess. The Hall of Offerings for the same reasons every wall harness
 * in this repo picks it: base 0, a 9 m ceiling, and a north wall carrying no
 * doorway, so the span in frame runs floor to ceiling.
 */
const wallPose = await page.evaluate(async (density) => {
  const g = window.__SANDS__;
  window.__FREEZE__.off();

  /**
   * THE KINDLING IS THROWN, and the first cut of this pose did not throw it.
   *
   * That version stood in an unlit Hall of Offerings, and every state in the
   * comparison came back at a mean luminance of 12.8 with the four candidates
   * separated by 0.01. It reported the carving as absent and it was reporting
   * the DARK: a surface nobody can see is a surface no material change moves.
   * Powered is also the state the player fights in for most of a run.
   */
  if (g.power && !g.power.powered) g.power.throwSwitch();

  const PLAYER = { x: -45, z: -147.0 };
  const WALL_Z = -140.5;                       // inner face of the south wall
  const AIM_X = -40.5;
  const BAND_Y = 0 + 0.5 / density;

  g.director.reset();
  g.spaces.enter('interior', { x: PLAYER.x, z: PLAYER.z, rot: 0 });
  for (const d of g.doors.all) {
    if (d.open) d.open();
    for (let i = 0; i < 400 && !d.opened; i++) if (d.advance) d.advance(1 / 30);
  }
  g.director.state.timer = 1e9;

  /**
   * THE PLAYER IS RE-PINNED EVERY FRAME, AND THE FIRST CUT PINNED THEM ONCE.
   *
   * `spaces.enter` is a transition rather than a teleport: it finishes over
   * several frames and writes the player's position when it lands. A single
   * assignment before that is therefore overwritten, and it was - the camera sat
   * at the courtyard spawn (0, 1.9, 30) for the whole pose. Everything then
   * aimed itself from a stale eye 175 m away, the wall plane landed BEHIND the
   * camera, and `Vector3.project` mirrored every window: the "clear" rectangle
   * two metres above the band came back below it, and the four states were
   * compared over a rectangle of floor. Two of the five failures in the first
   * run of this file were that, and neither of them was about the art.
   *
   * The loop also advances the power ramp, which is 1.4 s of real time driven by
   * interior.update, and it has to finish BEFORE the freeze or the five frames
   * in the comparison are lit differently from each other.
   */
  for (let i = 0; i < 150; i++) {
    g.player.position.x = PLAYER.x;
    g.player.position.z = PLAYER.z;
    g.player.state.health = g.player.state.maxHealth;
    await new Promise((r) => requestAnimationFrame(r));
  }

  const eye = g.camera.position.clone();
  const dx = AIM_X - eye.x, dz = WALL_Z - eye.z, dy = BAND_Y - eye.y;
  const flat = Math.hypot(dx, dz) || 1;
  g.rig.reset(Math.atan2(-dx / flat, -dz / flat), Math.atan2(dy, flat));
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));

  window.__FREEZE__.on();
  await new Promise((r) => requestAnimationFrame(r));

  /**
   * THE MEASUREMENT WINDOWS ARE PROJECTED WORLD RECTANGLES ON THE WALL FACE.
   *
   * Not a fraction of the frame. A window typed in as "the middle 40 per cent"
   * is a window that silently starts containing the floor the moment the pose
   * moves, and every figure taken through it then averages two surfaces, one of
   * which this lane did not touch. These four rectangles are points on the wall
   * plane at known heights, so what is inside them is wall by construction.
   */
  const rect = (x0, y0, x1, y1) => {
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => {
      const v = new g.THREE.Vector3(x, y, WALL_Z).project(g.camera);
      return {
        x: (v.x * 0.5 + 0.5) * window.innerWidth,
        y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      };
    });
    return {
      x0: Math.round(Math.min(...pts.map((p) => p.x))),
      x1: Math.round(Math.max(...pts.map((p) => p.x))),
      y0: Math.round(Math.min(...pts.map((p) => p.y))),
      y1: Math.round(Math.max(...pts.map((p) => p.y))),
    };
  };

  const X0 = AIM_X - 2.6, X1 = AIM_X + 2.6;

  /**
   * WHAT IS ACTUALLY BEHIND EACH WINDOW, by raycast rather than by belief.
   *
   * A window is only a wall measurement if a ray through it hits a wall. This
   * reports the material name and the range at the centre of each rectangle, so
   * "the clear window is on the wall" is a fact in the log rather than an
   * assumption in a comment.
   */
  const ray = new g.THREE.Raycaster();
  const probe = (r) => {
    const cx = ((r.x0 + r.x1) / 2 / window.innerWidth) * 2 - 1;
    const cy = -(((r.y0 + r.y1) / 2 / window.innerHeight) * 2 - 1);
    ray.setFromCamera(new g.THREE.Vector2(cx, cy), g.camera);
    const hit = ray.intersectObject(g.scene, true)
      .find((x) => x.object.isMesh && x.object.visible && x.object.material);
    return hit
      ? { material: hit.object.material.name || hit.object.name,
          range: +hit.distance.toFixed(2), y: +hit.point.y.toFixed(2) }
      : null;
  };

  const face = rect(X0, 0.6, X1, 5.4);
  const band = rect(X0, BAND_Y - 0.40, X1, BAND_Y + 0.40);
  const clear = rect(X0, BAND_Y + 1.15, X1, BAND_Y + 2.45);

  return {
    player: PLAYER, wallZ: WALL_Z, aimX: AIM_X,
    bandY: +BAND_Y.toFixed(2),
    eye: { x: +eye.x.toFixed(2), y: +eye.y.toFixed(2), z: +eye.z.toFixed(2) },
    eyeY: +eye.y.toFixed(2),
    powered: !!(g.power && g.power.powered),
    hits: { face: probe(face), band: probe(band), clear: probe(clear) },
    // The whole face in view, for the row profile.
    face,
    // The band itself.
    band,
    // A stretch of wall with no carving on it in ANY state, for the "did the
    // stone survive" figure. Above the band, below the ceiling.
    clear,
  };
}, WALL_DENSITY);

console.log('');
console.log('PART ONE: THE WALL');
console.log(`  standing at ${wallPose.player.x}, ${wallPose.player.z}, eye ${wallPose.eyeY} m`
  + `, wall at z ${wallPose.wallZ}, powered ${wallPose.powered}`);
console.log(`  the band is at y ${wallPose.bandY} (0.5 tile / ${WALL_DENSITY} per unit)`);
console.log(`  face window   ${JSON.stringify(wallPose.face)}  ->  ${JSON.stringify(wallPose.hits.face)}`);
console.log(`  band window   ${JSON.stringify(wallPose.band)}  ->  ${JSON.stringify(wallPose.hits.band)}`);
console.log(`  clear window  ${JSON.stringify(wallPose.clear)}  ->  ${JSON.stringify(wallPose.hits.clear)}`);

const onWall = (h) => !!h && /^(frieze|limestone)/.test(h.material || '');
ok(onWall(wallPose.hits.face) && onWall(wallPose.hits.band) && onWall(wallPose.hits.clear),
  'CONTROL: all three measurement windows are on a WALL, by raycast, not by belief');
ok(wallPose.hits.clear && wallPose.hits.clear.y > wallPose.bandY + 0.9,
  `CONTROL: the "clear" window really is above the band`
  + ` (hits the wall at y ${wallPose.hits.clear?.y}, band at ${wallPose.bandY})`);

const WALL_MODES = ['before', 'proc', 'hybrid', 'sunk', 'ship'];

const wallFrames = {};
for (const mode of WALL_MODES) {
  if (mode === 'before') {
    await setMaterial('before');
  } else {
    await setMaterial('frieze');
    await setMaps(mode);
  }
  await settle();
  wallFrames[mode] = await shot(`wall-${mode}`);
}

/**
 * THE ORDERING CONTROL. `before` is the first frame of five, so anything in this
 * page that is still settling - a power ramp, a shadow map, an accumulation
 * buffer - lands on it alone and then reads as a material difference in all four
 * of the others at once. Taking `before` again LAST is what tells those two
 * apart, and the first run of this file needed it: every candidate came back
 * 27.3 per cent brighter than `before` and identical to each other, which is not
 * a texture difference, it is a frame-one difference.
 */
await setMaterial('before');
await settle();
wallFrames.before2 = await shot('wall-before-2');

// The noise floor, taken in the same run: two captures of an unchanged scene.
// Everything below is a difference between two screenshots and a difference
// means nothing until you know what two identical screenshots differ by.
await setMaterial('frieze');
await setMaps('ship');
await settle();
wallFrames.ship1 = await shot('wall-ship-1');
await settle();
wallFrames.ship2 = await shot('wall-ship-2');

const W = await page.evaluate(async ({ f, pose, modes }) => {
  const P = window.__PIX__;
  const imgs = {};
  for (const k of Object.keys(f)) imgs[k] = await P.load(f[k]);
  const { w, h } = imgs.before;

  const clip = (r) => ({
    x0: Math.max(0, r.x0), x1: Math.min(w, r.x1),
    y0: Math.max(0, r.y0), y1: Math.min(h, r.y1),
  });
  const FACE = clip(pose.face), BAND = clip(pose.band), CLEAR = clip(pose.clear);

  /**
   * HIGH-FREQUENCY DETAIL, measured on a stretch of wall that has NO carving on
   * it in any state.
   *
   * This is the number that decides the trade. What a photographic scan buys is
   * grain, mortar depth and tool relief at the texel scale; what a procedural
   * masonry painter gives instead is flat blocks with a Sobelled edge. The mean
   * absolute first difference along each axis is exactly that content, and it is
   * measured ABOVE the band precisely so the band's own strong edges cannot
   * flatter whichever state has one.
   */
  const detail = (S, R) => {
    let gx = 0, gy = 0, n = 0, sum = 0, sum2 = 0;
    for (let y = R.y0 + 1; y < R.y1 - 1; y++) {
      for (let x = R.x0 + 1; x < R.x1 - 1; x++) {
        const i = (y * w + x) * 4;
        const l = P.lum(S.d, i);
        gx += Math.abs(P.lum(S.d, i + 4) - l);
        gy += Math.abs(P.lum(S.d, i + w * 4) - l);
        sum += l; sum2 += l * l; n++;
      }
    }
    const mean = sum / Math.max(1, n);
    return {
      meanLum: +mean.toFixed(1),
      sd: +Math.sqrt(Math.max(0, sum2 / Math.max(1, n) - mean * mean)).toFixed(2),
      gradX: +(gx / Math.max(1, n)).toFixed(3),
      gradY: +(gy / Math.max(1, n)).toFixed(3),
      px: n,
    };
  };

  /** Per-row mean |dL| against the shipped-today wall, over the wall face. */
  const rowsVsBefore = (S) => {
    const rows = [];
    for (let y = FACE.y0; y < FACE.y1; y++) {
      let s = 0, n = 0;
      for (let x = FACE.x0; x < FACE.x1; x++) {
        const i = (y * w + x) * 4;
        s += Math.abs(P.lum(S.d, i) - P.lum(imgs.before.d, i)); n++;
      }
      rows.push(s / Math.max(1, n));
    }
    const sorted = rows.slice().sort((a, b) => a - b);
    const peak = Math.max(...rows);
    return {
      mean: +(rows.reduce((a, b) => a + b, 0) / rows.length).toFixed(2),
      peak: +peak.toFixed(2),
      median: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
      changedPct: +((rows.filter((v) => v > 1).length / rows.length) * 100).toFixed(1),
      aboveHalfPeakPct: +((rows.filter((v) => v > peak * 0.5).length / rows.length) * 100).toFixed(1),
      peakRowOffset: rows.indexOf(peak),
    };
  };

  /**
   * The band's own luminance against the wall directly above and below it.
   *
   * Reported SIGNED rather than as a magnitude, because the sign is the design
   * decision: a band DARKER than the wall it is cut into is the sunk-recess
   * reading, and a band LIGHTER than it is the limewashed-panel reading. The
   * beetle cares which, and a Michelson figure hides it.
   */
  const bandContrast = (S) => {
    const strip = (R) => {
      let s = 0, n = 0;
      for (let y = R.y0; y < R.y1; y++) {
        for (let x = R.x0; x < R.x1; x++) { s += P.lum(S.d, (y * w + x) * 4); n++; }
      }
      return n ? s / n : 0;
    };
    const bh = BAND.y1 - BAND.y0;
    const inBand = strip(BAND);
    const above = strip({ ...BAND, y0: Math.max(0, BAND.y0 - bh), y1: BAND.y0 });
    const below = strip({ ...BAND, y0: BAND.y1, y1: Math.min(h, BAND.y1 + bh) });
    const around = (above + below) / 2;
    return {
      inBand: +inBand.toFixed(1),
      around: +around.toFixed(1),
      signedDelta: +(inBand - around).toFixed(1),
      michelson: +(Math.abs(inBand - around) / Math.max(1, inBand + around)).toFixed(4),
    };
  };

  const out = { window: { FACE, BAND, CLEAR }, states: {} };
  for (const k of modes) {
    out.states[k] = {
      detail: detail(imgs[k], CLEAR),
      band: bandContrast(imgs[k]),
      vs: k === 'before' ? null : rowsVsBefore(imgs[k]),
    };
  }

  // CONTROL: two frames of the SAME state, over the same window - and the same
  // state taken FIRST and LAST, which is the ordering control.
  const pairDelta = (a, b) => {
    let s = 0, n = 0;
    for (let y = FACE.y0; y < FACE.y1; y++) {
      for (let x = FACE.x0; x < FACE.x1; x++) {
        const i = (y * w + x) * 4;
        s += Math.abs(P.lum(a.d, i) - P.lum(b.d, i)); n++;
      }
    }
    return +(s / Math.max(1, n)).toFixed(3);
  };
  out.noiseFloor = pairDelta(imgs.ship1, imgs.ship2);
  out.orderDrift = pairDelta(imgs.before, imgs.before2);
  return out;
}, { f: wallFrames, pose: wallPose, modes: WALL_MODES });

console.log('');
console.log('  DID THE CARVING REACH THE FRAME, against the shipped wall as it is today');
console.log('  state     meanRow|dL|   peakRow   medianRow   rowsChanged%   band vs wall');
for (const k of WALL_MODES) {
  const s = W.states[k];
  const v = s.vs;
  const d = s.band.signedDelta;
  console.log(`  ${k.padEnd(9)}${String(v ? v.mean : '-').padStart(11)}`
    + `${String(v ? v.peak : '-').padStart(10)}${String(v ? v.median : '-').padStart(12)}`
    + `${String(v ? v.changedPct : '-').padStart(15)}`
    + `${`${d > 0 ? '+' : ''}${d}`.padStart(15)}`);
}

console.log('');
console.log('  WHAT IT COST THE STONE, on a stretch of wall with no carving on it in any state');
console.log('  state        meanLum      sd    gradX    gradY    gradX vs before');
for (const k of WALL_MODES) {
  const d = W.states[k].detail;
  const rel = ((d.gradX / W.states.before.detail.gradX - 1) * 100).toFixed(1);
  console.log(`  ${k.padEnd(11)}${String(d.meanLum).padStart(9)}${String(d.sd).padStart(8)}`
    + `${String(d.gradX).padStart(9)}${String(d.gradY).padStart(9)}`
    + `${(k === 'before' ? '-' : `${rel > 0 ? '+' : ''}${rel}%`).padStart(19)}`);
}

console.log('');
console.log(`  CONTROL: noise floor, two frames of the SAME state        ${W.noiseFloor}`);
console.log(`  CONTROL: ordering drift, "before" taken first AND last    ${W.orderDrift}`);
ok(W.orderDrift < 0.5,
  `CONTROL: nothing was still settling - the same state first and last differs by ${W.orderDrift}`);

ok(W.states.ship.vs.mean > W.noiseFloor * 8,
  `THE CARVING IS ON SCREEN IN A NORMAL RUN: mean row |dL| ${W.states.ship.vs.mean}`
  + ` against a noise floor of ${W.noiseFloor}`);
ok(W.states.ship.vs.peak > 6,
  `and it is a strong band, not a wash (peak row |dL| ${W.states.ship.vs.peak})`);
ok(W.states.ship.vs.aboveHalfPeakPct < 30,
  `CONTROL: the change is CONFINED to a band, not a retint of the wall`
  + ` (${W.states.ship.vs.aboveHalfPeakPct}% of rows above half peak)`);

// THE TRADE, stated as the comparison that chose the design.
const gShip = W.states.ship.detail.gradX;
const gProc = W.states.proc.detail.gradX;
const gBefore = W.states.before.detail.gradX;
ok(gShip > gProc,
  `THE TRADE: the composite keeps more of the stone than the procedural set does`
  + ` (gradX ${gShip} vs ${gProc}, scan-only ${gBefore})`);
ok(Math.abs(gShip / gBefore - 1) < 0.08,
  `and it keeps essentially all of it off the band`
  + ` (${((gShip / gBefore - 1) * 100).toFixed(1)}% against the undecorated scan)`);

// ===========================================================================
// PART TWO: THE BEETLE
// ===========================================================================
//
// enemies/wallcrawl.js put a gold scarab on the walls. A decorated wall is now
// the background of a fight, and the previous lane had to REVERSE its first
// ceiling design because it lost 69.2 per cent of the scarab's body. The same
// thing can happen here and the same rule applies: a regression is reported.

const stage = async (variant) => page.evaluate(async (id) => {
  const g = window.__SANDS__;
  window.__FREEZE__.off();

  const PLAYER = { x: -45, z: -148 };
  g.director.reset();
  g.spaces.enter('interior', { x: PLAYER.x, z: PLAYER.z, rot: 0 });
  for (const d of g.doors.all) {
    if (d.open) d.open();
    for (let i = 0; i < 400 && !d.opened; i++) if (d.advance) d.advance(1 / 30);
  }
  await new Promise((r) => requestAnimationFrame(r));
  g.director.state.timer = 1e9;
  g.player.position.x = PLAYER.x;
  g.player.position.z = PLAYER.z;

  const actor = g.director.placeAt(id, -34, -149);
  if (!actor) return { fatal: `could not place a ${id}` };

  // Step by hand until the body is settled ON A WALL - surface 1, not the
  // ceiling this time - and high enough off the floor to be read against stone
  // rather than against the skirting.
  const dt = 1 / 60;
  let clock = 0, reached = false;
  for (let i = 0; i < 90 * 60; i++) {
    clock += dt;
    g.player.position.x = PLAYER.x;
    g.player.position.z = PLAYER.z;
    // Pinned players get bitten to death, and a dead player photographs the
    // death screen instead of the wall. The previous lane lost a whole section
    // of its harness to exactly this.
    g.player.state.health = g.player.state.maxHealth;
    g.director.update(dt, clock);
    if (!actor.live) break;
    const c = actor.crawl;
    if (!c || c.transit > 0 || c.surf !== 1) continue;
    reached = true;
    if (actor.position.y > 1.6) break;
  }

  window.__FREEZE__.on();
  window.__ACTOR__ = actor;

  await new Promise((r) => requestAnimationFrame(r));
  const eye = g.camera.position.clone();
  const p = actor.position;
  const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  g.rig.reset(Math.atan2(-dx / len, -dz / len), Math.asin(dy / len));
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));

  const v = new g.THREE.Vector3(p.x, p.y, p.z).project(g.camera);
  return {
    id, reached,
    surf: actor.crawl ? actor.crawl.surf : null,
    at: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
    aboveFloor: +(p.y - (g.director.ctx.heightAt ? g.director.ctx.heightAt(p.x, p.z, 0) : 0)).toFixed(2),
    screen: { x: Math.round((v.x * 0.5 + 0.5) * window.innerWidth),
              y: Math.round((-v.y * 0.5 + 0.5) * window.innerHeight) },
    seconds: +clock.toFixed(1),
  };
}, variant);

const setActorVisible = (v) => page.evaluate((vis) => { window.__ACTOR__.group.visible = vis; }, v);

/**
 * Four frames, two states, one pose, plus a fifth for the noise floor.
 *
 * The beetle's pixels are exactly the pixels that differ between visible and
 * hidden, and the background behind it is those same pixels read out of the
 * hidden frame. One mask, the UNION of the two states, used for both: a mask
 * taken from one state alone silently drops the pixels that state was already
 * hiding, which is to say it drops the evidence against it.
 */
const measureBeetle = async (label, screen, win = 130) => {
  const frames = {};
  for (const state of ['after', 'before']) {
    await setMaterial(state === 'after' ? 'frieze' : 'before');
    await settle();
    await setActorVisible(true);
    await settle();
    frames[`${state}On`] = await shot(`${label}-${state}-beetle`);
    await setActorVisible(false);
    await settle();
    frames[`${state}Off`] = await shot(`${label}-${state}-empty`);
    await setActorVisible(true);
  }

  await setMaterial('frieze');
  await settle();
  await setActorVisible(false);
  await settle();
  frames.afterOff2 = await shot(`${label}-after-empty-2`);
  await setActorVisible(true);

  return page.evaluate(async ({ f, screen, win }) => {
    const P = window.__PIX__;
    const A = { on: await P.load(f.afterOn), off: await P.load(f.afterOff) };
    const B = { on: await P.load(f.beforeOn), off: await P.load(f.beforeOff) };
    const A2 = await P.load(f.afterOff2);
    const { w, h } = A.on;

    const x0 = Math.max(0, screen.x - win), x1 = Math.min(w, screen.x + win);
    const y0 = Math.max(0, screen.y - win), y1 = Math.min(h, screen.y + win);

    const mask = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        const db = Math.abs(B.on.d[i] - B.off.d[i]) + Math.abs(B.on.d[i + 1] - B.off.d[i + 1])
          + Math.abs(B.on.d[i + 2] - B.off.d[i + 2]);
        const da = Math.abs(A.on.d[i] - A.off.d[i]) + Math.abs(A.on.d[i + 1] - A.off.d[i + 1])
          + Math.abs(A.on.d[i + 2] - A.off.d[i + 2]);
        if (db > 18 || da > 18) mask.push(i);
      }
    }

    const stats = (S) => {
      if (!mask.length) return null;
      let body = 0, behind = 0;
      const per = [], bodyL = [], behindL = [];
      for (const i of mask) {
        const lb = P.lum(S.on.d, i), lg = P.lum(S.off.d, i);
        body += lb; behind += lg;
        bodyL.push(lb); behindL.push(lg);
        per.push(Math.abs(lb - lg));
      }
      per.sort((a, b) => a - b);
      bodyL.sort((a, b) => a - b);
      behindL.sort((a, b) => a - b);
      const pc = (arr, p) => +arr[Math.floor(arr.length * p)].toFixed(1);
      const Lb = body / mask.length, Lg = behind / mask.length;
      return {
        pixels: mask.length,
        bodyLum: +Lb.toFixed(1),
        behindLum: +Lg.toFixed(1),
        michelson: +(Math.abs(Lb - Lg) / Math.max(1, Lb + Lg)).toFixed(4),
        meanDelta: +(per.reduce((s, v) => s + v, 0) / per.length).toFixed(1),
        p10Delta: +per[Math.floor(per.length * 0.10)].toFixed(1),
        p50Delta: +per[Math.floor(per.length * 0.50)].toFixed(1),
        lostPct: +((per.filter((v) => v < 12).length / per.length) * 100).toFixed(1),
        bodyP10: pc(bodyL, 0.10), bodyP50: pc(bodyL, 0.50), bodyP90: pc(bodyL, 0.90),
        bgP10: pc(behindL, 0.10), bgP50: pc(behindL, 0.50), bgP90: pc(behindL, 0.90),
      };
    };

    let noise = 0, move = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        noise += Math.abs(P.lum(A.off.d, i) - P.lum(A2.d, i));
        move += Math.abs(P.lum(A.off.d, i) - P.lum(B.off.d, i));
        n++;
      }
    }

    return {
      after: stats(A), before: stats(B),
      noiseFloor: +(noise / Math.max(1, n)).toFixed(3),
      windowMove: +(move / Math.max(1, n)).toFixed(2),
    };
  }, { f: frames, screen, win });
};

const report = (title, R) => {
  console.log('');
  console.log(`  ${title}`);
  console.log('  state    px    body   behind   Michelson   meanDL   p50DL   p10DL   lost%');
  for (const [k, s] of [['BEFORE', R.before], ['AFTER ', R.after]]) {
    if (!s) { console.log(`  ${k}   no pixels`); continue; }
    console.log(`  ${k}  ${String(s.pixels).padStart(5)}  ${String(s.bodyLum).padStart(6)}  `
      + `${String(s.behindLum).padStart(6)}   ${String(s.michelson).padStart(9)}   `
      + `${String(s.meanDelta).padStart(6)}  ${String(s.p50Delta).padStart(6)}  `
      + `${String(s.p10Delta).padStart(6)}  ${String(s.lostPct).padStart(5)}`);
  }
  console.log(`  noise floor ${R.noiseFloor}, the swap moved the window by ${R.windowMove}`);
};

const bar = (label, R) => {
  if (!R.before || !R.after) { ok(false, `${label}: the beetle was segmented in both states`); return; }
  ok(R.after.michelson >= R.before.michelson * 0.98,
    `${label}: CONTRAST DID NOT GET WORSE (Michelson ${R.before.michelson} -> ${R.after.michelson})`);
  ok(R.after.meanDelta >= R.before.meanDelta * 0.98,
    `${label}: mean body-to-background separation held (${R.before.meanDelta} -> ${R.after.meanDelta})`);
  ok(R.after.p10Delta >= R.before.p10Delta * 0.95,
    `${label}: the WORST TENTH of the body held (p10 ${R.before.p10Delta} -> ${R.after.p10Delta})`);
  ok(R.after.lostPct <= R.before.lostPct + 1.0,
    `${label}: no more of the body vanishes into the wall (${R.before.lostPct}% -> ${R.after.lostPct}%)`);
};

await setMaterial('frieze');
await setMaps('ship');

const gold = await stage('goldscarab');
if (gold.fatal) { console.log(`FATAL ${gold.fatal}`); await browser.close(); process.exit(1); }

console.log('');
console.log('PART TWO: THE BEETLE ON A DECORATED WALL');
console.log(`  gold scarab reached surface ${gold.surf} (1 = wall) after ${gold.seconds} s`);
console.log(`  body at ${gold.at.x}, ${gold.at.y}, ${gold.at.z}  -  ${gold.aboveFloor} m above its floor`);
console.log(`  the band is at y ${wallPose.bandY}; the body is ${Math.abs(gold.at.y - wallPose.bandY).toFixed(2)} m from it`);
ok(gold.reached && gold.surf === 1, 'the beetle is genuinely on a WALL, not near one');

const G = await measureBeetle('beetle', gold.screen);
report('THE BEETLE WHERE IT LANDED, measured on the pixels it covers', G);
bar('as it lands', G);

/**
 * THE WORST CASE, AND IT IS THE BODY THAT MOVES, NOT THE BAND.
 *
 * The band is a tenth of the wall's height, so a scarab left to its own devices
 * is almost always standing on plain stone and the measurement above is the easy
 * case. It has to be measured standing ON the carving or the control is worth
 * nothing.
 *
 * THE FIRST WAY OF DOING THIS WAS WRONG AND IS RECORDED BECAUSE IT LOOKS RIGHT.
 * The obvious move is to slide the BAND up to the body by texture offset - and
 * that also slides the PHOTOGRAPH the band is composited into, so the "after"
 * wall then differs from the "before" wall by a vertical shift of the whole scan
 * as well as by the carving. Every delta in the comparison arrives inflated by a
 * difference this lane did not make. What is measured instead is the world
 * frozen, the textures untouched, and the BODY lifted 1.3 m up the same wall
 * onto the band.
 */
const raised = await page.evaluate(async (y) => {
  const g = window.__SANDS__;
  const a = window.__ACTOR__;
  a.group.position.y = y;
  if (a.position && a.position !== a.group.position) a.position.y = y;
  a.group.updateMatrixWorld(true);

  // Re-aim, because the body has moved and a window centred on where it used to
  // be is a window measuring wall.
  const eye = g.camera.position.clone();
  const p = a.group.getWorldPosition(new g.THREE.Vector3());
  const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  g.rig.reset(Math.atan2(-dx / len, -dz / len), Math.asin(dy / len));
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));

  const p2 = a.group.getWorldPosition(new g.THREE.Vector3());
  const v = p2.clone().project(g.camera);
  return {
    at: { x: +p2.x.toFixed(2), y: +p2.y.toFixed(2), z: +p2.z.toFixed(2) },
    screen: { x: Math.round((v.x * 0.5 + 0.5) * window.innerWidth),
              y: Math.round((-v.y * 0.5 + 0.5) * window.innerHeight) },
  };
}, wallPose.bandY);
await settle();

console.log('');
console.log(`  WORST CASE: the same body lifted to y ${raised.at.y}, which is the band`);

// Both grounds, in the same run, on the same body, at the same pose. This is
// the comparison that chose the shipped art.
const onBand = {};
for (const cand of ['sunk', 'ship']) {
  await setMaps(cand);
  await settle();
  onBand[cand] = await measureBeetle(`beetle-onband-${cand}`, raised.screen);
  report(`THE BEETLE STANDING ON THE CARVING - ${cand === 'sunk'
    ? 'DARK RECESS (rejected)' : 'LIMEWASHED PANEL (shipped)'}`, onBand[cand]);
}

console.log('');
console.log('  THE CHOICE, on the pixels the body covers while standing on the band');
console.log('  ground        behind    meanDL   p10DL   lost%');
for (const [k, R] of [['sunk  ', onBand.sunk], ['ship  ', onBand.ship]]) {
  const s = R.after;
  if (!s) { console.log(`  ${k}  no pixels`); continue; }
  console.log(`  ${k}   ${String(s.behindLum).padStart(8)}${String(s.meanDelta).padStart(10)}`
    + `${String(s.p10Delta).padStart(8)}${String(s.lostPct).padStart(8)}`);
}
const base = onBand.ship.before;
if (base) {
  console.log(`  plain stone (the control in the same frames)`
    + `   ${String(base.behindLum).padStart(6)}${String(base.meanDelta).padStart(10)}`
    + `${String(base.p10Delta).padStart(8)}${String(base.lostPct).padStart(8)}`);
}

ok(onBand.ship.after && onBand.sunk.after
  && onBand.ship.after.lostPct < onBand.sunk.after.lostPct,
  `THE CHOICE IS MEASURED: the limewashed panel loses less of the body than the`
  + ` dark recess (${onBand.ship.after?.lostPct}% vs ${onBand.sunk.after?.lostPct}%)`);

bar('on the band', onBand.ship);

await setMaps('ship');

// CONTROL: the variant without wallCrawl cannot be on a wall. If the staging
// reports it on surface 1, the segmentation is picking up something that is not
// a beetle on a wall and the whole section is measuring air.
await setMaterial('frieze');
const plain = await stage('scarab');
console.log('');
console.log(`  CONTROL: the ordinary scarab reached surface ${plain.surf === null ? 'none' : plain.surf}`
  + ` and got ${plain.aboveFloor} m off the floor`);
ok(!plain.reached && plain.aboveFloor < 0.6,
  `CONTROL: the variant without wallCrawl never gets onto a wall (${plain.aboveFloor} m up)`);

// ===========================================================================
// PART THREE: FIDELITY, AND THE COST
// ===========================================================================

/**
 * The LOW fidelity setting zeroes normalScale on every material applyFidelity
 * can see, and a material outside the registry silently misses that. This is the
 * check that the frieze is genuinely inside it, run through the same public
 * entry the settings panel uses rather than by reading a list.
 */
const fidelity = await page.evaluate(async () => {
  const g = window.__SANDS__;
  const M = await import(new URL('../src/world/materials.js', location.href).href);
  const reg = M.buildMaterials();
  const authored = reg.frieze.normalScale.x;
  g.setFidelity(false);
  const low = reg.frieze.normalScale.x;
  g.setFidelity(true);
  const high = reg.frieze.normalScale.x;
  return { authored, low, high, remembered: reg.frieze.userData.authoredNormalScale };
});

console.log('');
console.log('PART THREE: FIDELITY AND COST');
console.log(`  frieze normalScale  authored ${fidelity.authored}, LOW ${fidelity.low}, back to HIGH ${fidelity.high}`
  + ` (userData remembers ${fidelity.remembered})`);
ok(fidelity.low === 0 && fidelity.high === fidelity.authored,
  'applyFidelity SEES the frieze: LOW flattens it and HIGH restores the authored scale');

// The end-of-run census is reported for completeness and is NOT the shipping
// cost: by this point the harness has uploaded three candidate map sets and
// spawned two actors. The comparable number is `node test/frieze.mjs --census`,
// which runs on a fresh interior and exits.
const cost = await census();
console.log('  (this is the post-harness count; the comparable one is --census)');
console.log(`  draw calls           ${cost.render.calls}`);
console.log(`  triangles            ${cost.render.triangles}`);
console.log(`  scene meshes         ${cost.meshes}   (interior ${cost.interiorMeshes})`);
console.log(`  unique materials     ${cost.uniqueMaterials}`);
console.log(`  GPU textures         ${cost.memory.textures}`);
console.log(`  interior material use ${JSON.stringify(cost.matUse)}`);

writeFileSync(`${OUT}measurements.json`, JSON.stringify({
  provenance, texProof, wallPose, wall: W, gold, beetle: G, raised, onBand, plain,
  fidelity, cost,
}, null, 2));
console.log(`\n  shots and measurements -> ${OUT}`);

ok(errors.length === 0, 'no console errors');
if (errors.length) for (const e of errors.slice(0, 6)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
