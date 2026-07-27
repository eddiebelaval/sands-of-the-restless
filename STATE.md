# STATE - where this build actually is

Last updated 2026-07-27. Read this before continuing; it is the handoff note,
not documentation. Architecture lives in README.md, the visual research in
RESEARCH-VISUALS.md, and the teardown of the reference project in
REFERENCE-ANALYSIS.md.

## Run it

```bash
cd ~/Development/sands-of-the-restless
python3 -m http.server 4177
# http://127.0.0.1:4177/index.html
```

Suites:

```bash
node test/shot.mjs         # renders; fails on console errors, warnings, OR a black frame
node test/gun.mjs          # combat
node test/interior.mjs     # interior and buy-doors
node test/economy.mjs      # wall buys, shrines, power, the Altar
node test/enemies.mjs      # horde and bosses    <- CURRENTLY 1 FAILING, see below
node test/mysterybox.mjs   # the chest           <- UNVERIFIED, see below
node test/ao-ab.mjs        # measures whether the AO pass contributes
```

## Done and working

- Processional avenue, 9-room pyramid interior, two-level gallery, buy-doors
  with three refusal states.
- Purchase economy: four wall buys, six shrines behind the Kindling power gate,
  the Altar of Ptah at 5000 then 2000. Gold is a currency, not a key.
- Seven weapons, per-weapon solved ADS, hitscan, pooled impacts.
- Mummies, husk, the Bound, scarab swarm, five bosses with telegraphed abilities.
- Post chain, IBL, CC0 PBR, world-space weathering, synthesized audio with
  per-room generated convolution reverb.

## THE BIG ONE, fixed 2026-07-26

`chamferedBox()` emitted **28 of its 44 triangles wound inside out** - all twelve
edge bevels and both X flats. Audited by recomputing winding normals from vertex
order (not the stored normal attribute, which agreed with the error): 16 outward,
28 inward, which across the shipped scene was 14,448 of 22,724 triangles in 517
geometries.

The chamfer - the entire reason that module exists - had NEVER BEEN DRAWN. Plus
see-through slivers on every box edge, X faces at the far side's depth, and wrong
shadow depths for thin slabs. Fixed in 1e4c9df; the walked frame went meanLuma
45.59 -> 54.97, percentLit 88.6 -> 95.0.

This is what the owner meant by "half unrendered", said on day one from a
screenshot. Four scored critic rounds never found it because they graded the
symptom - "materials 5.0", "composition 4.5" - and never asked whether the
geometry was being drawn at all.

## Open items, in priority order

1. **THE HORDE STALLS. Gameplay-breaking.** `test/enemies.mjs` fails
   `the horde closes on the player`. Wave one closes 16.7m -> 10.3m then stops
   dead: mean and max distance identical at t=14, t=20 and t=29 simulated
   seconds, one enemy pinned at 16.96m having never moved. `the horde closes
   inside too` PASSES and the same run reports a closest of 1.57m, so SOME
   arrive and others never do - outdoor steering fails where indoor works.
   Proven unrelated to the palette (reproduces byte-for-byte with the emissive
   floor at 0.0). Repro probe: `scratchpad/approach.mjs`. Ask which of three
   bugs it is - failing to path, physically wedged, or never ticked - because
   they have three different fixes.
2. **The mystery box is UNVERIFIED.** Committed by the nightly bot at 02:00 from
   a dying agent, 631 lines plus an 877-line suite. It IS fully wired (main.js
   32, 174, 188, 607) and its pool includes bolt and sunspear, the two weapons
   with no other route into the player's hands. Nobody has confirmed it works.
3. **The pistol pose.** The MK9 camera looks straight down at two hand-BACKS,
   which are legitimately smooth vaults, while every piece of finger
   articulation sits on the far side of the grip where nothing can see it. The
   dead agent added an unused `hold` parameter to `gripHand`; the hook exists,
   the pose change does not. `wrap` and `a0` on the two-handed hold.
4. **`test/enemies.mjs` is partly blind.** Its `luma()` reads back via
   `drawImage(renderer.domElement)` with `preserveDrawingBuffer: false`, so it
   samples a stale or cleared buffer - it reported a sunlit courtyard at luma 7.
   Its dark-frame gate sits at `meanLuma < 6` and proves nothing.
   `page.screenshot()` is the correct path.
5. The canopic-jar puzzle chain is unbuilt. Shrine cap is already data
   (`{base: 4, ceiling: 6}` with `raise()`), so it can lift the cap without
   touching shrines.js.
6. ~20% of near-surface meshes sit >0.25m above local ground, almost all of it
   the avenue's own architecture at y=0 over a dune floor that swells. Fixing
   means re-seating the finished avenue; judged a worse risk than the defect.
7. No remote. Nothing pushed. Branch is `feature/enemies-and-horde`.

## Lessons that cost real time - do not relearn these

- **A green suite is fully compatible with a black frame.** Three separate
  times. Assert mean luminance over the UPPER TWO THIRDS; the lower third is the
  weapon and it renders fine when nothing else does. See open item 4 for a gate
  that was calibrated against a broken reader - the failure institutionalised.
- **METRICS TELL YOU WHETHER A CHANGE LANDED, NOT WHETHER IT IS GOOD.** A
  viewmodel round improved crop coverage, value ladder, mask pixel counts and
  saturation ratios, and produced hands that read as four machined dowels. It was
  rejected on sight. Render it at playing size and look at it.
- **Agent findings are hypotheses, not results.** Four separate P0s yesterday
  evaporated under measurement: one measured a file another agent was mid-edit
  in, one judged from a screenshot taken under lighting that had been replaced,
  one ("no cast shadow on the sand") was false with 77.7% of ground pixels
  shadowed, and one counted film grain as shadow area.
- **Change one variable and see what moves.** Repainting the sky dome magenta
  proved the bright bars by the pyramid door were HOLES, not props. A knockout
  test proved the IBL was the key light: turning off every light in the scene
  moved the sand 0.4%.
- **`renderer.autoClear` defaults TRUE** and `renderer.render()` clears COLOUR as
  well as depth. Guard it around any render into a composer buffer.
- **`node --check` passes on a backtick that terminates a GLSL template literal
  early.** It proves nothing.
- **Under software rendering the delta clamp makes simulated time run ~6x slower
  than the wall clock.** Wait on state or frame counts, never on setTimeout
  durations. This actively misleads on pathing bugs.
- **Wall colliders must be continuous RUNS of overlapping cylinders.** One disc
  per segment leaves gaps wider than the player.
- **A walkable bound is a contract with every trigger volume inside it.** minZ at
  -30.2 sat inside doors.js's entry threshold at -31.6: the player bought the
  door, watched it open, and hit an invisible wall. 21 failures on one number.
- **Sway advances per FRAME**, so a fixed wall-clock wait renders at a different
  phase under different machine load. Pin the viewmodel transform to diff
  weapons; two same-code renders then differ by 0.0000, not "within noise."
- **Parallel agents each optimise their own note and nobody holds the frame.**
  Architraves at fixed height plus randomised wall heights equals beams floating
  in mid-air. Neither change wrong alone.
- **The nightly EOD bot commits whatever is in the tree at 02:00.** When agents
  die mid-write, their partial work gets committed unverified. Check
  `git show --stat` on any `chore(eod)` commit before trusting the tree.
