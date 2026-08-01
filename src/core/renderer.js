/**
 * Renderer setup.
 *
 * ACESFilmicToneMapping is one line and it is the single biggest lever on how
 * the game reads. Without it, bright sand clips to flat white and the whole
 * frame looks like a prototype. With it, highlights roll off like film.
 */

import * as THREE from 'three';

/**
 * THE PIXEL BUDGET, AND WHY IT IS NOT devicePixelRatio.
 *
 * This was the frame-rate bug, and it was invisible to every measurement taken
 * during development because the automation window reports devicePixelRatio 1 -
 * where high and low fidelity are LITERALLY THE SAME SETTING and both sit at a
 * locked 60. On the owner's Retina display they are not the same at all.
 *
 * Measured on an M4 Max, same scene, same window, only the ratio changed:
 *
 *     ratio   pixels     median frame        worst
 *     1.0      3.9 MP    16.7 ms   60 fps    18 ms
 *     1.5      8.9 MP    30.3 ms   33 fps   119 ms
 *     2.0     15.7 MP   134.3 ms  7.4 fps   438 ms
 *
 * Eight times the frame time for four times the pixels, because the cost is not
 * linear: nine fullscreen passes run at that resolution and the bloom chain
 * multiplies it again. A ratio of 2 was asking a browser to do roughly a quarter
 * of a billion fragment operations per frame.
 *
 * So the ratio is now a BUDGET rather than a device property. Cap the total
 * pixels and derive the ratio from the window, so a small window may render
 * crisply at 2x while a maximised one on a 4K panel drops toward 1x instead of
 * falling off a cliff. Same number of fragments either way, which is the thing
 * the GPU actually cares about.
 *
 * 3.5 MP is set just under the 3.9 MP that measured comfortable, leaving headroom
 * for the horde. The floor of 1 exists because below that the SMAA pass has less
 * signal than it needs and the frame turns to mush - at which point you are
 * paying for anti-aliasing that is fighting your own downscale.
 */
const PIXEL_BUDGET = 3.5e6;
const MAX_RATIO = 2;
const MIN_RATIO = 1;

/**
 * THE BUDGET ABOVE IS ONE MACHINE'S ANSWER, AND THE GOVERNOR OVERRIDES IT.
 *
 * Every number in this file was measured on an M4 Max. That was honest work and
 * it fixed a real bug, but a constant cannot describe a machine it has never
 * run on: a player on a MacBook found the game unplayable at exactly these
 * settings. 3.5 megapixels through nine fullscreen passes is a comfortable
 * frame on the machine it was measured on and an impossible one two tiers down.
 *
 * So `resolutionScale` keeps deciding what the WINDOW can afford, and this
 * multiplier lets `core/governor.js` say what the GPU can afford, which is the
 * half nothing here could ever know. It is deliberately allowed below MIN_RATIO:
 * that floor exists because SMAA has too little signal underneath it, which is a
 * true statement about image quality and an irrelevant one at fifteen frames a
 * second. The governor only goes there after it has already turned SMAA off, so
 * the anti-aliasing is not fighting the downscale - it is not running at all.
 */
let governorScale = 1;

export function setGovernorScale(k) {
  governorScale = Math.max(0.5, Math.min(1, k));
}

export function resolutionScale(w = window.innerWidth, h = window.innerHeight) {
  const device = Math.min(window.devicePixelRatio || 1, MAX_RATIO);
  const area = Math.max(1, w * h);
  const affordable = Math.sqrt(PIXEL_BUDGET / area);
  const budgeted = Math.max(MIN_RATIO, Math.min(device, affordable));
  return budgeted * governorScale;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,          // SMAA in the post chain handles this instead
    powerPreference: 'high-performance',
    stencil: false,
  });

  renderer.setPixelRatio(resolutionScale());
  renderer.setSize(window.innerWidth, window.innerHeight);

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap is deprecated in current three.js and silently downgrades
  // to PCFShadowMap anyway. Ask for what we actually get.
  renderer.shadowMap.type = THREE.PCFShadowMap;

  return renderer;
}

/**
 * Keep the renderer, camera, and post chain in step with the window.
 * Returns a disposer so the listener can be torn down in tests.
 */
export function bindResize(renderer, camera, composer) {
  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    // The ratio is re-derived on every resize, because the budget is in PIXELS
    // and the window is the thing that changes. Dragging a window onto a 4K panel
    // used to quadruple the fragment load silently; now it lowers the ratio and
    // holds the frame time instead. See resolutionScale() for the measurements.
    renderer.setPixelRatio(resolutionScale(w, h));
    renderer.setSize(w, h);
    composer?.setSize(w, h);
  };

  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}
