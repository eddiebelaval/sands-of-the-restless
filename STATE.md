# STATE - where this build actually is

Last updated 2026-08-01. Read this before continuing; it is the handoff note,
not documentation. Architecture lives in README.md, the visual research in
RESEARCH-VISUALS.md, and the teardown of the reference project in
REFERENCE-ANALYSIS.md.

## RIGHT NOW, 2026-08-02 22:25

Everything below "Run it" is history. This is where the work actually is.

### Live on main at 87df93b

The descent (Act 3 at y -6, three ramps, correctly lit), three render modes on
`P` (Modern / PS1 / N64), the control centre (every key AND pad button
rebindable, persisted under `sands.keys.v1`), `E` cycles weapons, the entry room
widened to 544 m2 with a free west door, and four bugs the owner found by
playing: the canal seal, the quarry breach window, floating wall props and
`reachesPlayer`.

### Committed, NOT pushed

  b69bb65  docs: World 1's map scope, from the narrative
  32b4066  docs: how the story reaches a player being chased

### TWO LANES IN FLIGHT. Nothing of theirs is committed.

**1. THE JAR CHAIN AND THE ENDING** (build items 1 and 6, owner approved).
Four jars carryable and returnable; `jarsReturned` is declared 0 at
`doors.js:289` and written NOWHERE, so the Serdab is unreachable and World 1's
entire ending happens in it. Three jars run the machine, the fourth opens the
Serdab. Kindling gets OPTION C: keep the system, delete only the lever's
interactability, jars call the existing `throwSwitch()`. THE BEAT THAT MUST
SURVIVE: the Kindling notice OVERWRITES THE ARCHAEOLOGIST MID-SENTENCE, now on
the third jar, same room.
Also: WORLD 1 CANNOT CURRENTLY END. Verified in source, there is no `gameWon`,
no victory, no wave ceiling; `director.js` does `state.wave++` with nothing to
stop it. Owner's call: terminate at wave 25, ending gated on the jars.

**2. THE PACER, MGS STYLE** (owner overrode the design's Banjo-Kazooie vocal
blips and asked for Metal Gear Solid codec). One tick per character as it
appears, short dry percussive burst, speakers separated by PITCH AND FILTER not
phonemes, punctuation costs time, spaces silent, small pitch jitter. His call is
better: a codec tick is not a voice, so it dissolves the defect where her blip
would have shared `groan()`'s formant bank and made her sound like the horde.
Also fixing INSTANCE TWELVE (below) and the gatekeeper's two words on the death
card.

### INSTANCE TWELVE of "written but never rendered"

`index.html` sets `text-transform: uppercase` AND `white-space: nowrap` on
`#notice`. Her authored lines are LOWERCASE and run to 52 characters. The entire
scheme where she is the only lowercase text in the game is unrenderable at any
string, on a pill that would not fit the line anyway. Found by reading the CSS.

### The map scope's answer to "we need more space"

NINE INTERIOR ROOMS STILL SUFFICE, and the case got stronger, not weaker: the
widening answered "too small to run in" without a room, and the descent gave
"deeper and deeper" a built home. What is missing is OUTDOORS, IN PROPS AND IN
SYSTEMS. Total ~2,000-2,700 lines, ONE new exterior space (the expedition camp,
the biggest single build), ZERO new interior rooms.

### The story fits in the silences that already exist

Normal's breather is 6.0 s and the director only enters it when nothing is
alive. Twenty-four of them is ~144 s of quiet against a World 1 script of 233
characters, about 17 s of speech. An 8 to 1 budget. That measurement is what
made the delivery layer worth designing at all.

### Owner decisions already taken, do not re-ask

- HETEPHERES (the queen) and THE ANCIENTS (the pre-Egyptian builders). Locked.
  "Meresankh" appears nowhere in the repo.
- All five map-scope questions: camp doubles as the forecourt mass; camp is
  FREE, not a fourth purchase; Kindling Option C; World 1 ends at wave 25 gated
  on jars; all three forward plants ship now.
- MGS codec over vocal blips.
- Story transcripts are NEVER edited to match later decisions. They are the
  record.

### The landmine at the top of World 2

`star-shaft -> serdab` sits at EXACTLY 0.00 SLACK on `height >= drop + 5.0`.
When that rule breaks the builder does not refuse: it shrinks the clearance past
zero, emits the lintel below the sill, and ships a door nobody can walk through,
logging nothing. WORLDS.md specifies World 2 ceilings under six, which caps a
World 2 drop at 0.9 m. Recorded in MAP-SURVEY section 7 and WORLDS.md.

### Still open

- 20 fail-open findings unfixed (`docs/FAIL-OPEN-AUDIT.md`), 5 of them in tests.
- `test/grenades.mjs` RED ON A PRISTINE HEAD TREE at 13.95. Pre-existing and
  drifting. Do not chase it and do not move the threshold.
- The Serdab's unexplained 0.76 in the weathering fix, flagged not explained.
- Five story-delivery decisions in `docs/STORY-DELIVERY.md` section 11.

### What the instruments cost, and the rule that keeps paying

The harness has lied at least eight times across this work: `reachesPlayer`, the
wall-height lookup, an FPS counter read off the HUD, a colour statistic measured
after the blur instead of before, three suites pointed at dead ports, a nav
probe that hardcoded `footY: 0` and declared sixteen spawn points unreachable on
a map where the horde walked every one, and `teleport()` leaving the camera 7.5 m
in the air in Act 3, which failed 15 checks in economy.mjs and 4 in interior.mjs
for reasons unrelated to what they test.

RULE: read the thing, not the thing that reports on it. And read WHAT THE PROBE
ASKS, not just what it answers: a correct answer to the wrong question is
indistinguishable from a correct answer. A result that is UNIFORM across every
case is the shape of a broken instrument, not of a severe bug.

## Run it

```bash
cd ~/Development/sands-of-the-restless
python3 -m http.server 4177
# http://127.0.0.1:4177/index.html
```

Suites:

```bash
npm install     # playwright and sharp, for the harness only
npm start       # serve on 4177
npm test        # TEN of the thirteen files in test/: shot gun interior economy
                # enemies mysterybox grenades powerups hud probe
```

Those eight are green as of 2026-07-29, verified on an ISOLATED tree rather than
the working tree. That distinction matters and is not pedantry: three separate
times this session, failures on the working tree turned out to be another
agent's uncommitted work, and once I committed a lane as "verified" when the
verification had been contaminated the same way. Extract with `git archive HEAD`
into a temp dir, copy in only the files under test, serve that, and run against
it.

### THE INVENTORY IS NOT THE GATE. Read this before trusting any pass.

Thirteen files in `test/`, eight in `npm test`. The gap is where two real defects
sat undetected, and it is the root cause of both.

| file | in `npm test` | state |
|---|---|---|
| shot gun interior economy enemies mysterybox grenades powerups | yes | green |
| hud.mjs | **yes, now** | **211 checks, green** |
| probe.mjs | **yes, now** | green |
| ao-ab.mjs | no | a measurement tool; correctly not a gate |
| settings.mjs | **yes, now** | **212 checks, green** |
| chrome.mjs | n/a | helper, not a suite |

**hud and probe were wired into `npm test` once hud went green**, which is the
durable half of the fix. The eight failures were three separate faults and none of
them were in the game:

- **Seven** were one harness bug counted once per pose. `walkTest()` sampled the
  minimap wedge along m0's spine AFTER a second `mark()` call had cleared the
  canvas and redrawn the wedge 18-29 px away. It could never have scored anything
  but zero, on any build. Two earlier fixes had already attacked it and both read
  "no pixels" as a question about WHERE to sample, building better instruments
  while the frame under test was already gone.
- **One** was a stage that walked up to the SMG wall and asserted a prompt
  appeared, after its own earlier stages had bought the SMG. A wall whose weapon
  you own but are not holding is deliberately silent - `offerFor()` returns 'idle'
  so that a wall does not become a universal ammo box. It now picks a wall by the
  condition that produces text.
- That last one was **hiding a weaker assertion**: the overlap check above it,
  "no two HUD elements overlap with a boss, a prompt and gold popups all live",
  was passing against a frame with no prompt in it. It now runs on ten elements
  including the prompt rather than nine.

Because nothing ran `hud.mjs` routinely for as long as it existed, two things
rotted inside it. Both are fixed, and both are recorded here because the mechanism
matters more than the fix:

1. **It ignored the URL argument** until 5fb40a5 - it read only `SANDS_URL`, so
   every `node test/hud.mjs http://127.0.0.1:PORT/index.html` silently tested
   4177. The commit that fixed the other suites said "all eight". There were
   NINE. Any "hud verified on an isolated tree" claim before 5fb40a5 is FALSE and
   tested the wrong build. It surfaced only because 4177 is kept deliberately
   EMPTY as a tripwire, so the ignored argument produced a connection refusal
   rather than a confident pass. Had anything been serving that port it would
   have lied.
2. **It has 8 failing checks at HEAD**, confirmed against a pristine
   `git archive HEAD` tree, so they are nobody's regression. Seven are minimap
   "the wedge is drawn toward its tip" reporting **0 bone pixels** along the
   spine - at every yaw, in both the courtyard and the interior. Not a threshold
   miss; none at all. Either the player wedge has not rendered for some time, or
   the assertion samples a colour that no longer exists. The eighth is "the
   worst-case frame really had all three up: boss true prompt false".
   **UNRESOLVED**, under investigation in the minimap lane.

**hud is green as of 2026-07-29 at 211 checks and is now in `npm test`.** The
197-pass / 8-fail baseline it had to be read against is history; a failure there is
now a real failure.

`test/settings.mjs` had the SAME defect hud.mjs had, and was the THIRD file to carry
it. Fixed 2026-07-30 once the pause/settings work was committed. **All twelve suites
now honour `argv[2] || SANDS_URL`**, verified by enumeration rather than by counting.

The pattern is worth naming because it keeps recurring in NEW files: each suite is
written by copying the shape of an existing one, and the broken shape reads exactly
like the correct one. Enumerating `test/*.mjs` and printing how each resolves its URL
is the only thing that has ever caught it, twice now. Run that audit whenever a suite
is added.

**The lesson, because this is the second time this shape has appeared:** a claim
of the form "all N are fixed" or "all N are green" must be produced by
ENUMERATING the files, not by counting the ones you happened to edit or the ones
a script happens to invoke. The audit that found both defects was a loop over
`test/*.mjs` printing how each file resolves its URL. That same audit cleared
`ao-ab.mjs`, which looks broken to a naive grep because it navigates via a
template literal.

Still outside the gate on purpose: `ao-ab.mjs` is a measurement tool, not an
assertion suite. `settings.mjs` belongs to in-flight work and should be added when
that lands - and given the one-line URL fix first.

### THE GATING GAP, audited 2026-08-01 by enumeration

**Thirty-one suites exist. Fifteen are in `npm test`.** The audit that produced
that number is the one this file already prescribes - a loop over `test/*.mjs`
rather than a count of the ones anybody remembered - and it found the defect this
file calls the project's oldest, at seven times the size it was.

These are REAL ASSERTION SUITES, written in the last day, that NOTHING RUNS:

| suite | checks | what ships unguarded without it |
|---|---|---|
| `gamepad` | 112 | the whole controller: deadzone, curve, frame-rate independence |
| `governor` | 24 | the per-machine quality ladder, which is the only reason this runs on a MacBook |
| `b3ar` | 22 | the burst weapon and the exterior wall-buy |
| `deathrespawn` | 21 | respawning at the start instead of on your own corpse |
| `nav` | 16 | the horde routing to the player instead of into a wall |
| `doorlook` | - | the daylight doorway |
| `curtain-rules` | - | the transition veil |

Roughly two hundred assertions covering seven features shipped in a day, none of
which a regression would ever trip. **Wire them.** The only reason it was not
done in the same pass is that `package.json` was contended by three live lanes at
the moment of the audit.

Correctly OUTSIDE the gate and they should stay there: `ao-ab` and `gunlab` are
measurement instruments that print numbers rather than assert; `act1shots`,
`deathstrip`, `gaitstrip` and `vmstrip` render frame strips whose output is a
picture for a person to look at; `deathedge` and `deathinside` REPORT rather than
assert - worth knowing, because `deathinside`'s own header claims it asserts.

**A second finding from the same audit.** This file used to record that "all
twelve suites now honour `argv[2] || SANDS_URL`, verified by enumeration". That
has not been true for some time: `shot`, `act1probe`, `act1shots`,
`curtain-rules`, `deathedge`, `deathinside`, `deathstrip`, `gunlab` and `leak`
read `argv[2]` ONLY. Harmless while every caller passes a URL, and a trap the
moment one does not - which is exactly how `hud.mjs` silently tested the wrong
build for its entire existence. Recorded rather than quietly corrected, because
the lesson is that a verified-by-enumeration claim goes stale the moment somebody
adds a file, and this one did.

### GATE STATUS as of 2026-07-30, measured on a clean tree at 67941f9

**STALE - two days and roughly twenty commits behind.** Kept because the three
failure ANALYSES below are still the best record of those particular flakes, and
because the load-sensitivity note on `shot` is still true and still bites. What
suites exist and which are green has moved underneath all of it. Re-measure
before trusting the table.

`npm test` is RED, and it was red BEFORE hud and probe were wired in, so do not
read the wiring as having made it green. Two known failures, neither of them
introduced by this run of work, both reproduced on trees that predate it:

| suite | result | |
|---|---|---|
| enemies | 52 / 0 | green |
| gun | 17 / 0 | green |
| economy | 100 / 0 | green |
| hud | 211 / 0 | green |
| interior | pass | green |
| mysterybox | pass | green |
| probe | exit 0 | diagnostic, asserts nothing |
| shot | pass **when run alone** | see the load note below |
| **grenades** | **1 FAIL** `the aftermath is a different frame` | PRE-EXISTING |
| **powerups** | **1 FAIL** `the live one is left alone` | PRE-EXISTING, flaky |

- **grenades** wants the aftermath at least 1.0 luma below the pre-blast plate. It
  currently misses by 0.15. Before the AO composite landed it missed by 1.87 IN THE
  WRONG DIRECTION, so AO moved this check substantially toward passing and it is
  now the closest it has ever been. Reproduced twice on each of two trees.
- **powerups** `the live one is left alone` is a flake, not a threshold: the patch
  it measures contains the weapon viewmodel, and which weapon that is depends on a
  mystery-box roll earlier in the run. Confirmed failing twice on a tree with no AO
  change at all. The same noise source is what forced `each has shape on it` to be
  re-based onto the fixture's own pixels; this check has not been given the same
  treatment yet, and that is the obvious next fix.
- **shot** fails with "the world did not render (black or near-black frame)" and
  ZERO console errors when the machine is saturated - it captured before the first
  frame drew. Run alone on the same tree it passes at meanLuma 44.9. Seventeen local
  servers and several concurrent Chrome instances will do it. If you see a black
  frame, re-run it alone before believing it.

**So: two real known-red checks, one load-sensitive flake.** A third failure, or a
different name, is a genuine regression.

`node test/ao-ab.mjs` separately measures whether the AO pass contributes.

## ALL SIX LANES LANDED, 2026-07-31

Every owner playtest note from the 2026-07-30 sessions is in.

| lane | commit | what shipped |
|---|---|---|
| melee + ammo | `0c5a370` + `a1f4846` | khopesh on Q / middle mouse, 250 flat, 2.2m, 50-degree cone; ammo weight 26 -> 34 plus a SUPPLY floor with a low-reserve tilt and a pity floor |
| gait | `0b7063c` | lead leg / drag leg at DRAG_SWING 0.64, weight transfer, torso lag; measured ratio 0.64 invariant to speed |
| pyramid entry | `f000841` | black held until the room has RENDERED (counts frames, not time); curtain moved under the HUD |
| difficulty | `bee7a25` | Easy / Normal / Hard as curves through 1.00x at wave one; Normal is the shipped game to the digit; cartouche start screen |
| death | `a8baa5b` | 1s camera fall, UNWORTHY card, and a confirm gate with NO timeout - Enter only, refused if held from before the death |
| perf | `8dd5dd8` | pixel budget; see below |

**The cross-lane assumption held.** The death lane exempts `doors.update(dt)` from its
freeze, assuming a transition lifts its own curtain from there. The door lane drives its
curtain through `spaces.veilTick(dt, want)` called from `doors.js:520` and `:524` -
inside `doors.update`. Dying mid-transition cannot strand the player under a black sheet.

**The ammo split held too.** Melee owns the supply floor and annotated it as the surface
a tier scales; difficulty deliberately touched nothing in the ammo economy and moved only
starting gold (750/500/400). They compose.

## WHAT VERIFICATION COST, AND THE ONE RULE THAT PAID FOR ITSELF

Every lane self-reported green. Every lane had something. Not carelessness - a lane
verifies against the tree it built in, and the defects live in the interaction.

Three real bugs were caught only by landing and re-running:

- **The curtain dimmed the entire HUD.** At z-index 50 it covered the interface, and it
  is driven by PROXIMITY as well as by transitions - so standing three metres inside the
  Chamber of Ascent held it at opacity 0.365 forever, multiplying the page by 0.635. HUD
  text peak 216 -> 137; six contrast gates that pass at 5.7-14.9:1 failed at 2.8-6.2:1
  with the HUD unchanged.
- **The death gate froze `powerups.mjs`.** The suite stages fields of six-plus enemies,
  dies partway through, and then photographed a stopped world. Seven checks red at once.
  The tell: drops that "read at four metres" earlier in the same run matched an empty
  floor to a hundredth, 41.74 against 41.78.
- **The flaky powerups check was the gun in the frame**, not the threshold. The mystery
  box hands the player a random weapon and the viewmodel sits inside the measured patch.

**THE RULE: A/B against a clean baseline BEFORE writing a fix.** It found the real cause
twice. The one time it was skipped, a fix was written for a theory that changed the
numbers by 0.01 and had to be reverted.

## THE HARNESS LIED MORE THAN THE CODE DID

Four instruments were wrong today, and the code was right:

- `shot.mjs` held `waitForTimeout(1800)`. Under swiftshader a busy machine renders at
  ~2fps, so 1.8s can be one frame. It reported `the world did not render` THREE times on
  builds that were fine and nearly cost the gait lane a revert. **Measured: alone
  meanLuma 44.88, with nine concurrent browsers 0.00, same server same commit.** The
  first diagnosis was "stale http.server" and that was WRONG - replacing the server
  changed nothing; dropping the load fixed it every time. Now polls `readPixels` until
  something is drawn.
- `test/gaitstrip.mjs` first searched the scene graph for nodes named `/hip/i` and found
  none - the legs are a plain `{hip, knee, side}` array on the rig. It printed an empty
  list and would have announced a limp it never measured.
- The same file then pointed the camera at yaw PI, which faces +Z, and wrote eight
  immaculate frames of empty avenue with the subject behind the lens. It now projects the
  subject to screen space and refuses to photograph what it cannot see.
- `${PIPESTATUS[0]}` is bash; this shell is zsh. `timeout` is not on macOS.

**If a verification run matters, restart the static server and run it on a quiet
machine.** A black frame is load until proven otherwise.

## STILL OPEN

- **Three flaky pixel-threshold checks**, all comparing small deltas near a gate:
  `powerups`'s `the live one is left alone` (FIXED by unhooking the gun), `and from
  across the hall`, and `grenades`'s `the aftermath is a different frame` - which has now
  been observed BOTH red and green on the same tree, so it is intermittent rather than
  broken. Do not loosen thresholds; find the variance.
- **Names, owner's call:** the death card verdict (currently UNWORTHY), the new med-tier
  battle rifle, the Act 1 triple-shot pistol.
- **The map rebuild** - see `MAP.md`, ratified 2026-07-30. Three acts, three loops. The
  trainability law and `tools/trainability.mjs` are in; nothing in `rooms.js` or
  `courtyard.js` has been touched yet.
- **Dying sweeps ground drops.** Deliberate and documented, but it now interacts with the
  ammo scarcity the melee lane was built to fix. Worth feeling in play before deciding.

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

## Blind comparison round 2, 2026-07-27 evening

Same protocol, both games hardware-rendered, sides randomized per pair, judge
told nothing. Camera poses are now EXTERNAL DATA (`scratchpad/shot-poses.json`)
replayed against any build via `poses/capture.mjs`, which fixed round 1's worst
flaw - their authored framings against our accidental ones.

  round 1: lost 2-5, us 2.5/10 against their 4/10
  round 2: WON 4 pairs of 7, us 3/10 against their 4/10

We won atmosphere, the close material read, the interior ("the best-lit frame in
all 14"), and combat staging. We lost spawn, ADS and muzzle flash - which the
judge correctly weighted higher, because those are what a player looks at second
to second. Its verdict: "Mediocre finished assets beat beautiful lighting
wrapped around placeholders."

A SECOND judge compared yesterday's build against ours on identical poses and
scored the day "substantial, not transformative", 2.5 -> 3.5. It found four
regressions the head-to-head could not see, all since fixed, and proved pair 5
was a genuine TIE with arithmetic - mean absolute difference 5.86 of 255, the
delta being dither and wind on three grass tufts. "A day of work did zero to the
surface you spend the most pixels on."

Everything after that judgement (pyramid, arms, powerups, fog) is UNJUDGED.
Round 3 has not been run.

## Blind round 4, 2026-07-28 - WE WON THE HEAD-TO-HEAD

  round 1  lost 2-5   us 2.5  them 4
  round 2  won 4-3    us 3    them 4     (lost overall on weighting)
  round 3  lost 1-5   us 3    them 4.5
  round 4  WON        us 4.5  them 3.5

Scores are NOT comparable across rounds: the reference build is byte-identical
every round and has been scored 4, 4.5 and 3.5 by different judges. Only
within-round comparisons hold.

The judge's summary, worth keeping: "Market has better content; Temple has
better rendering. Rendering is the harder gap to close on a deadline, and it is
the one the eye reads first." And: "Temple is the only build with an authored
lighting model - every surface has a lit side and a shadow side in a different
HUE, not just a different value." That is the exact criticism levelled at US in
round 1, reversed.

Its warning: "If Market fixed only its exposure curve and its ground texture,
two contained jobs, it would take the set outright on content alone, because
Temple has no answer to a densely dressed street."

A separate delta judge confirmed the interrupted lighting lane DID land: washed
sky fixed, exterior ambient fixed, interior crush fixed, gate blowout contained,
far-plane separation partial, door slab untouched. It also independently
confirmed the static merge is picture-safe: "prop for prop identical."

## THE HARNESS LIED. Fixed 2026-07-29 in 516937e - read this before trusting any past verification

Seven of nine suites hardcoded port 4177 TWICE, as a default AND as a literal
inside `page.goto(...)`. Every `node test/x.mjs <url>` silently ignored the
argument and tested whatever was listening on 4177 - usually the live working
tree, which is the most contaminated thing on the machine.

So every "verified on an isolated tree" claim in this repo's history, for gun,
interior, economy, enemies, mysterybox, grenades and powerups, was FALSE,
including in commit messages. The runs passed and were real signals about a real
build; they were never about the build they claimed.

All eight now resolve `process.argv[2] || process.env.SANDS_URL`. ALWAYS PASS THE
URL EXPLICITLY. Proven, not asserted: with 4177 empty a suite now fails loudly;
with a URL it reaches that tree.

Two traps that go with it:
- **A port can lie.** A leftover server holding IPv4 while a new one silently
  binds the IPv6 wildcard; `curl` returns 200 from the OLD tree. `lsof -ti:<port>`
  first, bind explicitly to `127.0.0.1`, and SHA the SERVED bytes against disk.
- **Fixing it partially looks identical to fixing it.** I added a BASE constant,
  parsed clean, declared it fixed - and it still went to 4177 because there were
  two occurrences per file. Found only by emptying the port and watching it
  connect anyway.

## AO: caused, measured, being fixed

  pristine HEAD        enemy-07-interior  luma 20.88  lit 64.8%  PASSED
  HEAD + the AO fix    enemy-07-interior  luma 17.31  lit 48.7%  FAILED (gate 18/55)

The AO retune is otherwise GOOD and must survive: the old pass was tuned to 0.85m
radius when the floating props are 4cm, its AO buffer rendered as a line drawing
at mean 0.971, and it moved the ground frame by 0.03 of 255 while costing 832
draw calls against 582. The new numbers (radius 0.60, distanceExponent 2.0,
thickness 0.8, scale 2.5, samples held at 16) give real contact cores.

THE FIX IN FLIGHT: replace GTAOPass's fixed-function blend `dst * mix(1, ao,
intensity)` - which cannot see what it is darkening - with a composite in post.js
that scales AO by scene luminance in linear HDR. AO attenuates ambient light;
where almost none arrives there is almost nothing to attenuate. A 16-luma chamber
should be barely touched, a 110-luma courtyard fully. DO NOT lower `scale` to
clear the gate; that trades the grounding for the number.

## IN FLIGHT at 2026-07-29 12:50

- **AO fix, UNCOMMITTED**: `src/core/post.js` and `test/ao-ab.mjs`. Verified by
  the agent (economy, enemies green); my own isolated run had shot clean and was
  still going. Commit once green.
- **A FORKED SESSION is editing this same checkout** - adding a pause menu and a
  settings panel (mouse sensitivity, FOV slider). It will touch `index.html`,
  `src/main.js`, `src/ui/*`, `src/player/camera.js`.
  **CONSEQUENCE FOR VERIFICATION: do NOT build isolated trees by copying every
  dirty file.** That sweeps the other session's half-written work into your test
  tree. Copy only the files your lane owns, by name.
  **AND WARN IT**: sensitivity is scaled by `fovNormalized`, which is computed
  against the BASE_FOV constant. A slider that changes base FOV must recompute
  against the player's chosen value or it reintroduces the sprint-sensitivity
  bug fixed in 67fa127.
- **Queued, in the owner's stated order**: (3) distant background structures
  render as flat untextured pale boxes, made MORE conspicuous by the better sky;
  (4) the enemies - four judges across four rounds have called them the ceiling,
  and the last was explicit that "no lighting pass will fix this, that is a
  material and silhouette problem."

## Open items, in priority order

1. **The unpowered Great Gallery emits almost no light of its own** - 16.1 luma
   with the fog pass disabled. It looked lit for weeks only because an outdoor
   sky-haze pass was leaking into it. The real fix is either gating that pass
   when `spaces` reports an interior (needs a caller in `main.js`) or giving the
   room real fill light (the level's job). Until then the interior is darker
   than it was designed to be and three suites' gates sit close to their floors.
2. **The weapon RECEIVERS still read as stacked boxes.** `chamferFor()` scales
   bevels with member size, but it lives in `world/geometry.js` and the
   viewmodel builds its own boxes, so no weapon ever got the fix. They need
   bevels wide enough to catch a highlight at 300mm, not more small parts.
3. **The hand is better, not finished.** Four rounds in. The forearm is fixed -
   bracer, straps, buckle, wrap - but on a two-handed pistol hold the camera
   sees mostly hand-backs and fingertips read as smooth lozenges. The honest
   finding from round 4: this camera can only ever see the back of the hand on
   that grip, which is true of every FPS. The remaining target is the LONG GUNS'
   support hand on the handguard, where the camera gets a side view of fingers.
   Judge BY EYE at playing size and judge early - three rounds here improved
   every metric and looked worse.
4. **Scope MAGNIFICATION is not implemented.** ADS_FOV is one global 55 in
   `player/camera.js` (1.36x for every weapon). True per-weapon zoom needs that
   made per-weapon, or a render-target pass - and `createViewmodel` receives the
   rig, which exposes no camera and no scene, so the viewmodel cannot reach the
   world to render a zoomed view. The occlusion half (a flared eyepiece that
   takes the frame) is done.
5. **`test/interior.mjs` and `test/shot.mjs` still carry the blind reader.**
   Both measure via `drawImage(renderer.domElement)` with
   `preserveDrawingBuffer: false`, so they sample a stale or cleared buffer, and
   `interior.mjs` still gates at `meanLuma < 6 || percentLit < 25` - a threshold
   calibrated AGAINST the broken reader, so it cannot fire. `enemies.mjs` and
   `mysterybox.mjs` have both been converted to `page.screenshot()` decoded in
   node; copy that. Real frames measure 99-124 luma, black measures 0.14.
6. **Spawn distances are short.** With the walkable rectangle at x +/-23.2 and
   z -33 to 38.4, every out-of-view point is 6-10m behind the player, so the -45
   view penalty makes the director prefer the player's lap over the 22m band it
   asks for. One run spawned a boss at 5.9m. That is a tuning call on
   `SPAWN_NEAR`/`VIEW_COS` with real gameplay blast radius, deliberately not
   made alongside the stall fix.
7. **One thin threshold.** `mysterybox.mjs` findability at spawn B sits at
   1.28-1.29 against a 1.25 gate, +/-0.02 noise. That metric measures the ROOM
   as much as the fixture and the Great Gallery is a lit hall; it previously
   scored 2.0 only because the chest was clipping to white. If it flakes, retire
   that ratio in favour of the per-pixel A/B beside it (`changedPct`, `lift`),
   which has 10x the margin. Do NOT re-inflate the fixture to pass it.
8. The canopic-jar puzzle chain is unbuilt. Shrine cap is already data
   (`{base: 4, ceiling: 6}` with `raise()`), so it can lift the cap without
   touching shrines.js.
9. ~20% of near-surface meshes sit >0.25m above local ground, almost all of it
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
- **THE BIGGEST ONE: things that were written were never being RENDERED. Five
  separate times.** This is the defining bug class of this project and every
  instance was found the same way - by rendering the thing in isolation and
  looking, never by reading the code.
    1. `chamferedBox` wound 28 of 44 triangles inside out, so the chamfer that
       the module exists to draw was culled. Two days.
    2. Hand creases were modelled INSIDE a solid plate. Three passes of "add
       grooves" had drawn zero pixels.
    3. The MK9's three-dot sight sat behind the racking hook and the sight base.
       Two separate passes of "three-dot sight" were a claim in a comment.
    4. The finger crease cord was built 4.9mm wide inside a 1.9mm gap, 3mm below
       the crowns.
    5. The SMG's rear aperture ring was painted on the face of a SOLID drum.
       Aiming showed you the back of a plug.
  A flat-colour MASK RENDER is the tool that found most of these. If a feature
  is supposed to be visible and the frame does not look different, do not add
  more of it - prove it draws a pixel first.
- **AN OUTDOOR PASS WAS LIGHTING THE INTERIOR, and three suites passed on it.**
  The height-fog pass supplied ~70% of the unpowered Great Gallery's light:
  the room reads 66.2 with it and 16.1 without, and it emits sixteen. The
  enemies readability gate, the grenades smoke gate and the powerups spread gate
  had all been calibrated against weather leaking indoors. When a gate that has
  always passed suddenly fails after an unrelated change, suspect the gate.
- **VSYNC HIDES THE COST OF EVERYTHING.** I profiled the post chain by disabling
  passes and reported "GTAO 15.4 -> 15.4, bloom 15.4, SMAA 15.3, so the chain is
  free." It is not. GTAOPass re-renders the WHOLE SCENE through
  MeshNormalMaterial to fill its own G-buffer: 832 draw calls and 503,723
  triangles with it, 582 and 258,489 without. Wall-clock was identical because
  the frame is vsync-bound at 60Hz. Measure `renderer.info` with `autoReset`
  off, or measure uncapped; never conclude anything from wall-clock rAF deltas
  on a machine that is hitting vsync.
- **A PORT CAN LIE.** A leftover `python3 -m http.server` held IPv4 on a port; a
  new server silently bound the IPv6 wildcard instead; `curl` returned 200 and
  the harness measured the OLD TREE. Two agents lost time to this. Always
  `lsof -ti:<port>` before binding, bind explicitly to `127.0.0.1`, and SHA the
  SERVED bytes against the file on disk before trusting a capture.
- **TUNE A SAMPLER TO THE SIZE OF THE THING IT MUST SEE.** The AO pass ran, cost
  a full extra scene render, and grounded nothing: at radius 0.85m its six steps
  landed at 4.9, 14, 26, 41, 59 and 85cm, and a potsherd is FOUR centimetres. It
  was tuned for architecture-scale creases while the things that read as
  floating were pebbles. Rendering the AO buffer as a mask showed a LINE
  DRAWING - a 1px rim on brick joints, white everywhere else, mean 0.971.
- **A GATE BELOW ITS OWN NOISE FLOOR PROVES NOTHING.** `test/ao-ab.mjs` had no
  control, a verdict threshold of 1.0 against a measured same-build noise floor
  of 1.17, and live film grain. It would have passed with the AO pass DELETED.
  That is why a useless AO config shipped. Any A/B gate needs a same-build
  control measured first, and the threshold set above it.
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
- **THE INSTRUMENT LIED SEVEN TIMES IN ONE SESSION, AND THE CODE WAS FINE EVERY
  TIME.** This is now the second-biggest failure class in the project after
  written-but-never-rendered, and unlike that one it produces FALSE PASSES as
  well as false failures, which is worse. Every instance below reported a
  confident result that was about the harness rather than about the game:
    1. `drawImage(renderer.domElement)` read from a plain `evaluate` returns an
       EMPTY buffer - a WebGL canvas without `preserveDrawingBuffer` is only
       readable inside the frame that drew it. Both rows read 0.00 and the script
       printed a verdict on top of two zeroes.
    2. `renderer.info` resets itself inside `render()`, so a count read after the
       frame reports whatever the last pass did. One draw call, not 1296.
    3. `timeout` does not exist on macOS. The loop reported exit 0 having run
       nothing at all.
    4. `doors.pick()` casts from the CAMERA, and the camera is driven from the
       rig inside the frame loop - so a harness that teleports and then calls
       `doors.update()` itself asks the question through a camera that has not
       moved. Twelve failures against a perfectly good door.
    5. The page's rAF loop runs BETWEEN `page.evaluate` calls, and `doors.js`
       swaps the active space on player position - so a probe that entered the
       interior in one evaluate and swept in the next measured the horde IN THE
       OTHER WORLD. Actors at z -28 while the player stood at z -193.
    6. `sprintLatch` is sticky by design and clears only at stick centre, so a
       test case that never released the stick inherited the previous case's
       sprint and reported the new binding as broken.
    7. The GitHub Pages builds endpoint reported `built` for the PREVIOUS commit
       and kept doing so. The live BYTES had already updated. Trusting the status
       field would have meant reporting a deploy that had happened as not having.
  The rule that caught all seven: **read the thing itself, not the thing that
  reports on it.** Bytes over status fields, pixels over graph inspection,
  positions over flags. And when a result arrives that would be surprising if
  true, suspect the instrument BEFORE the code - six of these seven looked
  exactly like a real defect.

- **A TEST WRITTEN AGAINST A TREE WHERE NOTHING ELSE POLLED WAS GREEN AND WRONG.**
  `test/gamepad.mjs` passed 105/105 by supplying the pad poll itself. The moment
  `main.js` polled once a frame, as it always would in the shipping build, every
  look measurement became two polls at two different deltas. The suite was
  testing a path production does not have. When a feature needs a call from a
  file the author does not own, the suite has to be re-verified AFTER that call
  lands - green before the wiring means nothing.

- **THE GATE I ASKED FOR COULD NOT HAVE EXISTED, AND MEASURING SAID SO.** I
  specified a frame-rate independence check comparing the turn rate at two frame
  pacings. Under swiftshader every frame is slower than MAX_DELTA, so the loop's
  delta is a CONSTANT 1/20 and a tenfold change in render cost moves it by
  nothing - measured at 1286ms and 158ms per frame, both reporting 50.000ms
  simulated. While dt never varies, "multiply by dt" and "add a constant per
  frame" are the same function, so the gate would have PASSED THE BUG IT WAS
  WRITTEN TO CATCH. The replacement injects the delta and was MUTATION-TESTED
  against a deliberately broken build: real 0% gap, mutant 20.27%, tolerance
  2.6e-6. **If a new gate cannot be shown to fail on a broken build, it is not a
  gate.**

- **THE NIGHTLY EOD BOT SHIPPED AN ENTIRE IN-FLIGHT LANE TO PRODUCTION.** At
  02:00 it committed the working tree - four agents' worth of half-finished work
  plus 22 files of scratch - and the next `git push` sent it to the live site
  because the range was never read. This file already warned about the bot. The
  warning was not enough; the habit is. **Read `git log @{u}..HEAD` before every
  push, and check the AUTHORS in that range, not just the count.** `.scratch/` is
  now gitignored, which removes one whole class of what the bot can catch.

- **A ONE-SIDED TEST IS A BUG THAT ONLY APPEARS AT THE OTHER END.** The collider
  height check skipped anything the actor had climbed ON TOP OF and never
  anything the actor stood UNDERNEATH, so a cylinder with no floor turned out to
  have no ceiling: the Altar of Ptah at y0 6 blocked a 2.1m circle of the gallery
  floor SIX METRES BENEATH ITSELF, for the player as well as the horde. The
  correct pattern was already in the file - `flow.js` tests walls with
  `head <= w.y0 || floorY >= w.y1`, both ends, eight lines above the collider
  loop that checked one. Boxes carry a top in their record and cylinders do not,
  so the collider path grew the cheap half and stopped. When a predicate has a
  `>` in it, ask what the `<` case does.
