/**
 * Diagnostic probe. Raycasts from the camera into the scene at given screen
 * positions and reports what was hit, so a visual anomaly can be traced to the
 * object that caused it instead of guessed at.
 */

import { chromium } from '/Users/eddiebelaval/Development/.worktrees/parallax-hotfix-realtime/node_modules/playwright/index.mjs';
import { resolveChrome } from './chrome.mjs';

const CHROME = resolveChrome();

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:4177/index.html', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.evaluate(() => document.getElementById('begin').click());
await page.waitForTimeout(1200);

const report = await page.evaluate(() => {
  const g = window.__SANDS__;
  const { THREE, scene, camera } = g;

  const ray = new THREE.Raycaster();

  // Normalised device coords for a few interesting screen points.
  const points = {
    'top-left':     [-0.80,  0.85],
    'left-mid':     [-0.90,  0.10],
    'centre':       [ 0.00,  0.00],
    'pyramid':      [ 0.00,  0.35],
    'right-mid':    [ 0.90,  0.10],
  };

  const hits = {};
  for (const [name, [x, y]] of Object.entries(points)) {
    ray.setFromCamera(new THREE.Vector2(x, y), camera);
    const its = ray.intersectObjects(scene.children, true);
    const h = its[0];
    hits[name] = h ? {
      dist: +h.distance.toFixed(1),
      pos: [+h.object.position.x.toFixed(1), +h.object.position.y.toFixed(1), +h.object.position.z.toFixed(1)],
      parent: h.object.parent?.name || h.object.parent?.type,
      name: h.object.name || '(unnamed)',
      geo: h.object.geometry?.type,
      mat: h.object.material?.name || h.object.material?.type,
      verts: h.object.geometry?.attributes?.position?.count,
      indexed: !!h.object.geometry?.index,
      worldY: +h.point.y.toFixed(2),
    } : null;
  }

  // Largest objects in the scene, to catch anything accidentally enormous.
  const big = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingSphere?.();
    const r = o.geometry.boundingSphere?.radius || 0;
    if (r > 12) {
      big.push({
        r: +r.toFixed(1),
        pos: [+o.position.x.toFixed(1), +o.position.y.toFixed(1), +o.position.z.toFixed(1)],
        parent: o.parent?.name || o.parent?.type,
      });
    }
  });
  big.sort((a, b) => b.r - a.r);

  return {
    hits,
    cameraPos: [+camera.position.x.toFixed(1), +camera.position.y.toFixed(2), +camera.position.z.toFixed(1)],
    biggest: big.slice(0, 8),
    meshCount: (() => { let n = 0; scene.traverse((o) => { if (o.isMesh) n++; }); return n; })(),
  };
});

await browser.close();
console.log(JSON.stringify(report, null, 2));
