# STATE - where this build actually is

Last updated 2026-07-26. Read this before continuing; it is the handoff note,
not documentation. Architecture lives in README.md, the visual research in
RESEARCH-VISUALS.md, and the teardown of the reference project in
REFERENCE-ANALYSIS.md.

## Run it

```bash
cd ~/Development/sands-of-the-restless
python3 -m http.server 4177
# http://127.0.0.1:4177/index.html
```

Suites, all currently green:

```bash
node test/shot.mjs       # renders, fails on console errors, warnings, OR a black frame
node test/gun.mjs        # 17 combat checks
node test/interior.mjs   # 47 interior and buy-door checks
node test/ao-ab.mjs      # measures whether the AO pass actually contributes
```

## Done and working

- Processional avenue: flanking walls, buttress pylons, three recessed chapels,
  architraves seated on real bays, sealed wall-collider runs.
- 9-room pyramid interior, two-level gallery with ramps, reachable by buying
  the sealed doorway for 1000.
- Buy-doors with three refusal states. Gold economy at 10 / 60 / 100.
- Seven weapons, per-weapon solved ADS, hitscan, pooled impacts, hands rebuilt.
- Post chain: Render, GTAO, height fog, viewmodel, bloom, output, grade, SMAA.
- IBL from a 1k HDRI, CC0 scanned PBR materials, world-space weathering.
- Clouds (2.5D shells), height fog with per-channel extinction.
- Fully synthesized audio with per-room generated convolution reverb.
- 29-prototype prop kit, dressing pass, instanced scatter.

## In flight

**Enemies and the wave director.** An agent wrote `src/enemies/{mummy,variants,
director,boss}.js` and `src/systems/damage.js`. They are committed as a safety
net but NOT WIRED into main.js. Verify them before trusting them.

## Known open items

1. `main.js` has a LABELLED TEMPORARY: shooting scenery pays 10 gold, because
   without it nothing can pay the 500 to 1000 gap and an unaffordable door is
   indistinguishable from a broken one. Delete the labelled branch once enemies
   land.
2. Critic scores as of round 2: lighting 3.5, composition 4.5, materials 5.0,
   viewmodel 4.0, against the reference project's 7.0 to 8.0.
3. On the pistol the hip pose puts the lower half of both hands below frame.
   That is a `hipPose` change in viewmodel.js, deliberately not made.
4. No remote. Nothing pushed.

## Lessons that cost real time today - do not relearn these

- **A green suite is fully compatible with a black frame.** This happened three
  separate times. Harnesses now assert mean frame luminance, sampling the upper
  two thirds, because the lower third is the weapon and it renders fine when
  nothing else does.
- **`renderer.autoClear` defaults to TRUE** and `renderer.render()` clears
  COLOUR as well as depth. Guard it around any render into a composer buffer.
- **`node --check` passes on a backtick that terminates a GLSL template literal
  early.** It is not proof of anything.
- **Measure before believing a finding.** "No cast shadow on the sand" was a P0
  through two critic rounds and was FALSE: 77.7 percent of ground pixels were
  shadowed. The real defect was that the floor was almost ENTIRELY shadowed, so
  there was no lit-to-shadowed boundary. Raising the sun fixed it; debugging the
  shadow system would have wasted hours.
- **Wall colliders must be continuous RUNS of overlapping cylinders.** One disc
  per wall segment leaves gaps wider than the player, and the enclosure silently
  stops enclosing while still looking correct in a screenshot.
- **Under software rendering the delta clamp makes simulated time run about 6x
  slower than the wall clock.** Wait on STATE or frame counts, never on
  `setTimeout` durations, or you photograph things mid-animation and conclude
  they failed to render.
- **An open-ended cylinder shows a hollow tube** when you can see its end face.
  Correct for stacked column drums, wrong for a fallen one.
- **Parallel agents each optimise their own note and nobody holds the frame.**
  Architraves at a fixed height plus randomised wall heights equals beams
  floating in mid-air. Neither change was wrong alone. Integrate by hand.
