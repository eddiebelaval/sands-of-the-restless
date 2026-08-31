# WIP - the camp's cloth, and one unresolved number

Saved 2026-08-30 for a machine restart. **Not merged. Not on main.**
Branch `feature/enemies-and-horde`; `main` is at `d8fe46c`.

## What landed

`textures.js` gained `paintCanvasWeave()` - a plain weave with wandering thread
centres, slubs, and directionless soiling, run through the existing
`materialMaps()` pipeline so it produces map + normalMap + roughnessMap the same
way the sand and masonry do. `camp.js` gained `cloth(rx, ry)`, which CLONES those
textures per material so each mesh can carry its own thread count without
re-scaling everybody else's.

Wired to `camp-canvas` (7 x 9) and `camp-tarp` (5 x 5).

Two mistakes made and fixed on the way, both worth not repeating:

- **The first version turned the tent grey.** The map's mean sat at 0.79, so every
  texel multiplied the authored `0xd9d3c0` by four fifths and pulled the warmth
  out - deleting the tint relationship that makes the tent and tarpaulin read as
  one cloth. An albedo map that is not centred on white is a tint nobody asked
  for. Now centred at 0.96 with the weave in a +/-0.09 band.
- **The threads were too coarse.** At 2.2 x 3.0 a yarn was ~4 mm on screen at two
  metres and the tent read as knitwear. 7 x 9 puts the weave just past where the
  eye resolves individual threads.

## WHY THIS WAS BUILT AT ALL - the pivot, so nobody re-litigates it

The owner asked whether better three.js graphics were possible. I proposed
cascaded shadow maps and **was wrong**, and the frame is what proved it:
`shots/shadow-1-crates.png` shows crisp contact shadows with the crates planted
on the sand. sky.js already follows the player, snaps the frustum to texel
increments, and runs 4096 texels over a 136-unit frustum - 3.3 cm per texel.
Round 1's "they cast no contact shadow, which is why they float" is FIXED.

**Do not build CSM.** It would mean patching 92 materials across ~20 files,
fighting the custom passes, to improve something that already works.

The real gap is material COVERAGE, measured:

    MeshStandardMaterial WITH texture maps:   21
    MeshStandardMaterial with NO maps at all: 60
    largest bare cluster: src/world/camp.js (14)

which matches the round-4 blind judge exactly: "Market has better content;
Temple has better rendering."

## THE UNRESOLVED THING - pick this up here

`test/camp.mjs` fails ONE check, the atlas control. It fails at HEAD too, so it
is PRE-EXISTING (I recorded it as 29/30 on 2026-08-09 and declined to widen
another author's threshold). **But my change made the number worse**, and that is
not explained:

| | control reading | painted |
|---|---|---|
| HEAD, without the weave | 0.024 | 0.0954 |
| with the weave | **0.0591** | 0.0939 |

Separation went from ~4x to ~1.6x. Attributed by `git stash`, running the suite,
and popping - so this is measured, not assumed.

**A tent texture should not move a crate-stencil detector at all.** Two
hypotheses, neither confirmed:

1. The control's projected sampling boxes include pixels that are NOT the panel -
   tent behind a crate, most likely - so a surface that went from flat to woven
   adds variance inside a rectangle that expects calm. The suite already knows
   this can happen: it prints "the control is NOT quiet on panel N ... something
   other than the panel is inside that projected rectangle and the reading for it
   is UNVERIFIED", and it keeps every control crop at `shots/control-N.png`.
2. The weave is genuinely too high-frequency and is aliasing.

**NEXT STEP, and it is cheap: open `shots/control-*.png` and look.** The crops
are kept precisely so a number this shape can be resolved by eye. If tent pixels
are inside those boxes, the finding is about the test's sampling boxes and the
weave is fine. If the crops are all panel, the weave needs a lower frequency.

`shots/` is gitignored, so the crops are gone after a restart - re-run
`node test/camp.mjs http://127.0.0.1:4188/index.html` to regenerate them.

RULED OUT already: shared noise state. `fbm()` is pure and seeded, so adding a
painter cannot perturb the ones after it.

## Other suites

`shot` GREEN, `grime` GREEN. Nothing else was run against this change.

## Also known, unrelated, still open

- The memory fragments are still untextured boxes (a person is one slab, no head,
  no shoulder line). Diagnosis and the fix shape are in `docs/PLAYTHROUGH.md`
  finding 9's neighbourhood and the 2026-08-09 session.
- The ka-row reads as a dark blue dado rather than ten standing women.
- At arm's length the tent's remaining weakness is GEOMETRY, not material: hard
  facets, no sag between poles. That is the next camp job and it is a mesh job.
