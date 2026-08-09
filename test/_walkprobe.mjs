/**
 * WHERE DOES A PLAYER WALKING STRAIGHT AT THE PYRAMID ACTUALLY STOP.
 *
 * `test/interior.mjs` sprints forward 700 simulation steps from spawn and
 * expects to arrive at the sealed doorway (z between -26 and -28). It does not
 * arrive, and every one of the twenty-nine checks after it is downstream of
 * that one fact. This finds out what is in the way.
 *
 * Throwaway diagnostic. Not a suite, not a gate.
 */

import { chromium } from 'playwright';
import { resolveChrome, GL_ARGS, dismissBriefing } from './chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4188/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: [...GL_ARGS, '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => document.getElementById('begin').click());
await dismissBriefing(page);
await page.waitForTimeout(1400);

const r = await page.evaluate(() => {
  const g = window.__SANDS__;
  const p = () => ({
    x: +g.player.position.x.toFixed(2),
    y: +g.player.position.y.toFixed(2),
    z: +g.player.position.z.toFixed(2),
  });

  const start = p();
  g.rig.reset(0, -0.02);

  // Step one at a time and record where forward progress dies.
  const track = [];
  let stuckAt = null;
  let prevZ = g.player.position.z;
  let still = 0;

  for (let i = 0; i < 700; i++) {
    g.player.update(1 / 60, { forward: 1, strafe: 0, sprint: true, jump: false }, 0);
    const z = g.player.position.z;
    if (i % 100 === 0) track.push({ step: i, ...p() });
    // "Stopped" = less than a millimetre of forward progress for 30 steps.
    if (prevZ - z < 0.001) { still++; } else { still = 0; }
    if (still >= 30 && stuckAt === null) stuckAt = { step: i, ...p() };
    prevZ = z;
  }
  const end = p();

  // What is nearest, in the collider array the controller actually reads.
  const cols = (g.courtyard && g.courtyard.colliders) || g.interior.colliders || [];
  const near = cols
    .map((c) => ({
      x: +c.x?.toFixed?.(2), z: +c.z?.toFixed?.(2), r: c.r, h: c.h,
      d: +Math.hypot(c.x - g.player.position.x, c.z - g.player.position.z).toFixed(2),
    }))
    .filter((c) => Number.isFinite(c.d))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);

  return { start, end, stuckAt, track, near, colliderCount: cols.length };
});

console.log('');
console.log(`start   x ${r.start.x}  y ${r.start.y}  z ${r.start.z}`);
console.log(`end     x ${r.end.x}  y ${r.end.y}  z ${r.end.z}     (target z between -26 and -28)`);
console.log(`stuck   ${r.stuckAt ? `at step ${r.stuckAt.step}, x ${r.stuckAt.x} z ${r.stuckAt.z}` : 'never stopped moving'}`);
console.log('');
console.log('track:');
for (const t of r.track) console.log(`  step ${String(t.step).padStart(3)}   x ${t.x}  z ${t.z}`);
console.log('');
console.log(`nearest colliders (${r.colliderCount} total):`);
for (const c of r.near) console.log(`  d ${String(c.d).padStart(6)}   x ${c.x}  z ${c.z}  r ${c.r}  h ${c.h}`);
console.log('');
if (errors.length) for (const e of errors.slice(0, 4)) console.log(`err ${e}`);

await browser.close();
