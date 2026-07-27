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

## Shipped

Public as of 2026-07-27.

- Play: https://eddiebelaval.github.io/sands-of-the-restless/
- Source: https://github.com/eddiebelaval/sands-of-the-restless
- Write-up: https://id8labs.app/essays/half-unrendered

`main` is the default branch and Pages deploys from it, so a push to main is a
release. Verify against the LIVE url before calling a deploy good:
`node test/shot.mjs https://eddiebelaval.github.io/sands-of-the-restless`.

## The blind comparison, 2026-07-27

Run against github.com/mshumer/Claude-of-Duty, the reference this project was
built to match. Seven matched scenarios, both games captured on the same machine
under the same hardware renderer (ANGLE Metal, M4 Max - neither fell back to
software), sides randomized independently per pair, all UI hidden, judge told
nothing about which was which and forbidden from reading the key.

**We lost 5-2. Us 2.5/10, them 4/10.**

Lost: spawn view (decisive), ADS (decisive), combat (clear), wide shot
(decisive), muzzle flash (clear).
Won: close ground material (decisive), interior (slight).

The one structural criticism: they have a coherent world-lighting model and we
do not. A sun in a known place that everything obeys, with contact shadows whose
penumbra widens with distance from the caster. That single system won them four
pairs. Ours reads as "a lit-from-nowhere postcard."

Their verdict on us, worth keeping: "It is not an untextured blockout. It is a
textured one."

WHAT WE ACTUALLY WON, because it is not consolation:
- our sand is the best material in either build and theirs is the worst. Pair 5
  used a numerically identical camera in both. Ours holds up filling the frame;
  theirs has no diffuse authorship at all and "reads as wet plastic or dirty ice"
- we are the only build with an authored interior. Theirs is exterior lighting
  with a roof on it
- our muzzle flash propagates light. Theirs does not illuminate the hands
  holding the gun, and its tracer leaves at the wrong angle
- our enemies are readable at range. Theirs needed a 4x crop to confirm one
  existed

THEIR DEFECTS: a see-through glove on the hero asset in five of seven frames,
broken alpha sorting throughout, and that ground texture.

THE FIX LIST, in the judge's priority order:
1. Replace the characters. "Nothing else you fix matters while six untextured
   mannequins float over the sand." They cast no contact shadow, which is why
   they float.
2. Distance fog. Highest gain-to-effort in either build.
3. Make the lights actually light. A brazier does not illuminate the plinth it
   stands on.
4. Break the tiling and bevel the geometry.
5. Dress the set and land everything on the ground with real occlusion contact.

TWO CRITICISMS I VERIFIED IN SOURCE, because both contradicted work we had done,
and both were true in the same specific way - the feature EXISTS and is too weak
to read:

- aerial perspective: fog.js is a real height-fog pass with per-channel
  extinction, but sigmaE at 2.6e-3 contributes only 14% at the pyramid's 60m. A
  previous lighting pass measured far/sky 0.83 -> 0.96 and called it two thirds
  done; the blind judge said nothing recedes. THE METRIC MOVED AND THE IMAGE DID
  NOT. Trust the image.
- the chamfer: it defaults to 0.06 world units. Six centimetres is sub-pixel on
  a 40m pyramid step. The winding fix means the bevels finally DRAW; they are
  still too small to catch a highlight, so stone reads as painted cardboard.

## Open items, in priority order

1. **The pistol pose.** The MK9 camera looks straight down at two hand-BACKS,
   which are legitimately smooth vaults, while every piece of finger
   articulation sits on the far side of the grip where nothing can see it. An
   agent added an unused `hold` parameter to `gripHand` before it died; the hook
   exists, the pose change does not. `wrap` and `a0` on the two-handed hold.
   Judge it BY EYE at playing size and judge it early - two rounds here improved
   every metric and looked worse.
2. **`test/interior.mjs` and `test/shot.mjs` still carry the blind reader.**
   Both measure via `drawImage(renderer.domElement)` with
   `preserveDrawingBuffer: false`, so they sample a stale or cleared buffer, and
   `interior.mjs` still gates at `meanLuma < 6 || percentLit < 25` - a threshold
   calibrated AGAINST the broken reader, so it cannot fire. `enemies.mjs` and
   `mysterybox.mjs` have both been converted to `page.screenshot()` decoded in
   node; copy that. Real frames measure 99-124 luma, black measures 0.14.
3. **Spawn distances are short.** With the walkable rectangle at x +/-23.2 and
   z -33 to 38.4, every out-of-view point is 6-10m behind the player, so the -45
   view penalty makes the director prefer the player's lap over the 22m band it
   asks for. One run spawned a boss at 5.9m. That is a tuning call on
   `SPAWN_NEAR`/`VIEW_COS` with real gameplay blast radius, deliberately not
   made alongside the stall fix.
4. **One thin threshold.** `mysterybox.mjs` findability at spawn B sits at
   1.28-1.29 against a 1.25 gate, +/-0.02 noise. That metric measures the ROOM
   as much as the fixture and the Great Gallery is a lit hall; it previously
   scored 2.0 only because the chest was clipping to white. If it flakes, retire
   that ratio in favour of the per-pixel A/B beside it (`changedPct`, `lift`),
   which has 10x the margin. Do NOT re-inflate the fixture to pass it.
5. The canopic-jar puzzle chain is unbuilt. Shrine cap is already data
   (`{base: 4, ceiling: 6}` with `raise()`), so it can lift the cap without
   touching shrines.js.
6. ~20% of near-surface meshes sit >0.25m above local ground, almost all of it
   the avenue's own architecture at y=0 over a dune floor that swells. Fixing
   means re-seating the finished avenue; judged a worse risk than the defect.

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
- **A metric can REWARD the defect.** The mystery box fixture was clipping to
  white, which made it unreadable, and the findability check scored it on mean
  luminance - so blowing out the highlights made the number go UP. Fixing the
  flare cost that check half its score. Measure clip fraction and spread next to
  any brightness metric.
- **A rubric is a ceiling; a blind comparison has no floor to hide in.** Ten
  critic agents and 1.5M tokens scored this build on lighting, composition and
  materials and moved the mean from 4.1 to 4.25. Every one of those rounds
  KNEW which build was ours. One blind A/B against the reference, with the
  sides randomized and the judge unable to read the key, produced a more useful
  fix list in twenty minutes than the entire scored loop. If you run a critic,
  make it blind or do not bother.
- **Half the "failures" in a suite can be the suite.** Of six failing box
  checks, three were harness bugs: an affordability assertion run on a player
  who genuinely could not afford it, a settle-time assertion that was
  arithmetically impossible because an earlier section had already spent the
  time, and a prompt read from 6.0m when the interaction range is 5.5m. Read the
  assertion before you change the code.
