/**
 * Renderer setup.
 *
 * ACESFilmicToneMapping is one line and it is the single biggest lever on how
 * the game reads. Without it, bright sand clips to flat white and the whole
 * frame looks like a prototype. With it, highlights roll off like film.
 */

import * as THREE from 'three';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,          // SMAA in the post chain handles this instead
    powerPreference: 'high-performance',
    stencil: false,
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    renderer.setSize(w, h);
    composer?.setSize(w, h);
  };

  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}
