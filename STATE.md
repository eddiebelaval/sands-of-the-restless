# STATE - where this build actually is

Last updated 2026-08-01. Read this before continuing; it is the handoff note,
not documentation. Architecture lives in README.md, the visual research in
RESEARCH-VISUALS.md, and the teardown of the reference project in
REFERENCE-ANALYSIS.md.

## RIGHT NOW, 2026-08-02 23:30

Everything below "Run it" is history. This is where the work actually is.

### Live on main at 87df93b

The descent (Act 3 at y -6, three ramps, correctly lit), three render modes on
`P` (Modern / PS1 / N64), the control centre (every key AND pad button
rebindable, persisted under `sands.keys.v1`), `E` cycles weapons, the entry room
widened to 544 m2 with a free west door, and four bugs the owner found by
playing: the canal seal, the quarry breach window, floating wall props and
`reachesPlayer`.

### Committed and pushed, HEAD a199408

  b69bb65  docs: World 1's map scope, from the narrative
  32b4066  docs: how the story reaches a player being chased
  a199408  docs: RIGHT NOW before compaction, two lanes in flight

### WORLD 1 CAN NOW BE FINISHED. Built 2026-08-02, NOT COMMITTED.

**BUILD 1 and BUILD 6 landed together**, because the ending was gated on the
jars. New: `src/systems/jars.js`, `src/ui/ending.js`, `test/jars.mjs`,
`test/e2e.mjs`. Changed: `doors.js`, `director.js`, `boss.js`, `objective.js`,
`interact.js`, `minimap.js`, `build.js`, `courtyard.js`. `test/jars.mjs` is
65/65, re-run independently rather than taken from the building lane's report.

- **The counter has ONE writer**, `jars.js` -> `publish()`, two pre-existing
  readers, no derivation anywhere else.
- **There were TWO bugs in the gate, not one.** The missing writer was known.
  The second was not: `lockedBecause` returned the progress string
  unconditionally, so it stayed truthy at 4 of 4 and the Serdab denied. A puzzle
  whose completed state is indistinguishable from its refusal is a door with no
  open position.
- **Option C held. `systems/power.js` is byte-for-byte untouched.** The fire
  bowl still stands and still lights; only its interactability is gone, and
  interior and economy now assert that ABSENCE as two separate claims (no
  prompt, and F does nothing).
- **The beat survived.** Third jar seats, her line reveals lowercase, stops dead
  at "since we-", and the machine starts inside that callback. `litVia: "cut"`
  in an independent run, so it fired through the authored cut, not the backstop.
- **INSTANCE THIRTEEN, and the only one ever caught BEFORE it shipped.** The
  courtyard jar - the first jar a player ever sees - was untagged, so
  `batchStatics` would have merged it into the static mesh. It would have
  rendered perfectly and been unpickable by construction. Now `noBatch`.

**THE LADDER IS NOW CLIMBED, NOT SET. `test/e2e.mjs`, 19/19.** `jars.mjs`
reaches wave 25 with `forceWave`, which is right for a unit harness and leaves
the climb unproven; "concludes when you SET 25" and "concludes when you SURVIVE
to 25" are different claims. `e2e.mjs` REPLACES `forceWave` and `reset` with
functions that record a violation and throw, so the shortcut is mechanically
unavailable rather than merely unused, then plays 1 to 25 and checks the ladder
for CONTIGUITY rather than its last number - a director that skipped 7 to 9
would still conclude on 25 and still pass a test that reads only the end. Run
with `npm run test:e2e`; deliberately out of `npm test`, on the kite precedent.

Measured spawn curve, the difficulty ramp made visible: 7, 8, 10, 12, **7**, 17,
19, 21, 23, **11**, 24, 24, 24, 24, **15** ... The dips are the boss waves, one
god instead of a crowd; 24 is the live cap holding from wave 11 on.

Its concessions are in its own header rather than buried: kills go through
`hurt()` not bullets, the player is topped up each wave, and world swaps use
`spaces.enter()` rather than buying the entry door. None of the three touches
the wave counter, which is the thing under test.

**Two of its first three failures were the instrument, not the game**, and the
file now carries both fixes with the reason beside them: it read the wave number
at the TOP of the loop and counted the pre-run wave 0 as a rung, and it closed
the notice observer four frames after the keypress while her line was still
revealing, then reported the Kindling beat as absent. That second one is worth
remembering - **a window closed too early and a beat that genuinely died produce
identical evidence.** `litVia` is what tells them apart, and the run reports
`"cut"`.

### DEPTH IS A DIMENSION NOW - 2026-08-06

The owner sent a design diagram: a TEMPLE/DUNGEON drawn as a tall stack of thin
floors, beside a TOWN drawn as one wide flat plane with landmarks and a winding
path. "our map should feel like this."

**He is right, and the measurement says the gap is wider than it looks:**

    interior footprint   132 m long  (z -140 to -272)
    vertical drop          6 m       (two levels, base 0 and -6)
    ratio                 22 : 1     horizontal to vertical

**The pyramid is currently shaped like the town, not the dungeon.** The exterior
half is already right - the avenue IS the winding path, the pyramid the
landmark, the quarry and canal the buildings off it. The interior is a second
town: a 132 m sprawl with one incidental step, which is why four rooms of jars
were hard to hold in the head.

**What the diagram is really claiming** is not geometry, it is that each space
gets ONE DOMINANT AXIS. A town is legible because it is all visible at once. A
dungeon is legible because there is only ever one question: how deep am I. The
interior had no dominant axis at all.

**BUILT: the two cheapest halves, because depth existed in the geometry and was
expressed NOWHERE in the interface** - no readout, and one incidental mention of
`base` in the whole of `ui/minimap.js`.

- **The depth readout** (BUILD 9, scoped since 08-02, unbuilt until now) sits
  beside the wave counter: the wave is where the run is on the TIME axis, this is
  where the player is on the SPACE axis. It reads LIVE POSITION, not
  deepest-reached - the map scope said "derived from the deepest room reached
  rather than from the wave" and the load-bearing half of that is the second one.
  A depth faked off the wave number is a progress bar in a gauge's clothes; a
  number that only goes up cannot tell the player they walked back up a ramp.
- **Storey contours on the minimap.** A line inset inside every room below the
  datum, ONE PER SIX METRES so a third and fourth level get two and three without
  this code being told. Chosen over a fill or a hue because the fill already
  carries state (current / adjacent / seen / unseen) and the panel's colour rule -
  gold is THERE, lapis is WAITING - has no spare term for "lower". A line inside
  a line is a step down and costs no colour.
- **The room label carries it**: `King's Chamber . 6m down`.

**Verified against controls.** The contours are proved by FLATTENING all five
lower rooms to the datum and diffing the canvas: 0.458. Contours that were coded
and never reached would produce identical images. `guide` 12/12, `hud`,
`settings`, `jars` green.

**NOT DONE, and the open question this makes answerable:** whether the geometry
itself has to move. 6 m across 132 is still a ribbon with a step in it. If it
still reads flat when played, the next move is re-basing the nine rooms across
four or five levels - they already sit at distinct z, so extra levels cost ramps
and ceiling-rule checks rather than a nav rewrite; the flow field's LAYERS = 2
only bites when rooms stack over the SAME x/z, which these do not.

**REFUSED, and worth writing down:** the literal tall box. Stacking rooms above
each other breaks the two-storey cap AND fights a fact the narrative keeps on
purpose - "the building is bigger inside than outside, and nobody mentions it".
The diagram's LEGIBILITY is the thing to take. Its footprint is not.

### WAYFINDING, AND THE QUARRY'S INVISIBLE STONE - 2026-08-05

The owner played the shipped build: "i cant find 2 of the jars... the outside
canal and the quarry are so full of obstacles its a mess to run in... next step
maybe needs to pulse on the map so i can find it."

**THE JAR CHAIN WAS NEVER THE PROBLEM. The guidance was.**

- **The objective pointed at the DESTINATION.** The rung routed to the Embalming
  Chamber for the whole step, because that is where the niches are - the right
  answer to "where does a jar go" and the wrong answer to "what do I do now". A
  player carrying nothing was sent to a room they had no reason to stand in, and
  the four rooms that hold the jars were never named on any surface in the game.
  It now names the jar and its room, RANKED BY ROUTE through the room graph, so
  the door it quotes is the one actually in the way.
- **The map drew the jars and nothing said which one.** A static gold dot among a
  dozen gold marks is found only by somebody already looking. The current target
  now breathes on a 1.6 s cycle, one at a time.

The two he could not find were the **Star Shaft** (a dead end holding a jar and
a rope, which nothing routes a player through) and the **King's Chamber**.

**A REORDER WAS TRIED AND REVERTED.** `arm` - buy a wall gun - sits above the
machine and its `done()` needs a wall-bought weapon, so a pistol-only player
never sees the jars NAMED at all. Promoting the jars broke nine `hud` checks by
displacing wall-gun onboarding at three stages, which is a documented decision.
And it was not the reported defect: he knew he needed four jars, he could not
find WHERE. **Fix the reported defect, not the one the fix made visible.**
Residual, accepted: a pistol-only player's guidance is the map pulse alone.

**THE QUARRY WAS 74 SQUARE METRES OF COLLISION WITH NO STONE IN IT.**

`fillMass` seals `w + FILL_R` by `d + FILL_R` and overhangs its own arguments by
FILL_R/2 - 0.675 m - on every side. Its own comment says that is the wrong
default "where the stone has a face the player is meant to walk right up to and
past", and the west terrace has subtracted `FILL_R` since it was written. The
quarry's four free blocks never did: they showed 152 m2 of stone and sealed 227.

    largest connected open floor   374 -> 430 m2   (+15%, zero visual change)

For scale: the entry room the owner already called too small is 544 m2, the
Great Gallery about 1800. **The measured tell was not clutter, it was being
stopped two feet short of rock you can see.**

NOT thinned further, deliberately. The rest of the mass is the bedrock face, the
two spoil banks and the terrace bench - all boundaries - plus the blocks, which
are SUPPOSED to be obstacles: running around cover is the training mechanic. The
same file already got this right elsewhere; the bank's decorative rubble carries
no colliders at all, with the comment "rubble at the foot is rubble the player
snags on".

**THE SLOT SEALER WAS SUSPECTED AND EXONERATED BY MEASUREMENT**, before any of
the above. It added 1104 colliders on 08-03 and was the obvious culprit:

    region   BEFORE sealer            AFTER sealer      (open/tight/blocked %)
    quarry   15.7 / 18.4 / 65.9       15.7 / 18.4 / 65.9
    canal    36.5 / 16.9 / 46.6       36.5 / 16.7 / 46.8

Identical. It only ever filled gaps too narrow to walk down.

**Verified:** `guide` 8/8 (new - reads the rendered panel and pixel-diffs the
pulse against a stubbed-target control), `hud`, `jars` 65/65, `economy`, `nav`,
`stuck-trap` 0 traps. Canal untouched at 705 m2 connected: tight, defensible,
and not what he was complaining about.

### THE DEAD ARE SOLID - BUILT 2026-08-03

Owner: "the zombies need to be solid objects so that we can't walk through
them." They were not, and not because a test was failing: `resolveCollisions`
knew about `world.colliders` and `world.walls` and had never heard of an actor.
NOTHING TESTED IT.

`player/controller.js` gains `resolveBodies()` and a `setBodies()` late-bind;
`main.js` wires `player.setBodies(() => director.live)` after the director
exists, because the player is built at :121 and the director at :342. A FUNCTION
rather than an array: the director splices its pool in place, and a snapshot
would leave a crumbled shambler holding a doorway forever.

**Three calls, all reversible, all written down where they live:**

- **ONE-WAY.** The horde pushes the player; the player never pushes the horde.
  A player who could shove the dead aside would walk through a horde at walking
  pace, which is the thing being fixed, and `mummy.js` already owns the horde's
  own spacing solver that a second opinion from here would fight.
- **BODIES RESOLVE BEFORE STONE**, so static geometry has the last word. The
  horde can pin the player against a wall; it can never post them into it.
  Measured: a shambler driving the player into the quarry face leaves collider
  overlap 0.000.
- **CORPSES ARE NOT SOLID.** `dying` and `dead` are skipped, so a body in its
  topple is walked through. Otherwise a kill the player already earned keeps
  holding a doorway for the length of an animation. `mummy.js` skips the same
  two flags in its own separation pass, so the horde and the player now agree
  what a corpse is.

**Verified by `test/solid.mjs`, 8/8, and it carries its own control** - every
case is walked twice, once with `setBodies(null)` and once wired:

    control (not solid)   closest 0.015   walks straight through
    solid                 closest 0.766   stopped at the 0.780 radius
    corpse                closest 0.025   walks straight through
    contact damage        16 hp taken     pinned overlap 0.000

**The regression that was NOT there:** contact damage fires at 2.57 m and the
body stops at 0.78 m, so making the horde solid cannot starve the attack. That
margin is the thing to re-measure if `attackRange`, the actor radius or the
player radius ever move - a solid body that cannot reach you is this fix wearing
a costume.

**`kite` and `enemies` both pass, and the entry room is untouched**: all four
laps reached at 0-3 per cent corked, so the owner's original "hard to run from
enemies in such a small space" is NOT re-broken by solid bodies.

**A BASELINE WAS RUN BEFORE BELIEVING THE SCARY NUMBER.** The solid run showed
two of four Great Gallery laps failing at 80 and 92 per cent corked, which reads
as the horde pinning the player in the biggest room in the game. It is not.
`kite` with bodies UNWIRED fails two of four gallery laps as well, and
`gallery lap E` returns 3.1 m at 92 per cent in BOTH runs, identical to the
decimal. It is deterministic because it is a COLUMN: a 0.5 m gallery pillar
centred at `(14, -166)`, and kite holds W in a straight line into it. A
straight-line probe walking into a pillar is a limitation of the probe, not a
defect in the room.

**Two of my own errors on this build, both the same shape as the stuck-corner
ones:** the first three runs of `solid.mjs` were staged at `(30, 5)`, which
`stuck-pins` had already reported as carrying a collider and which measures
MINUS 0.80 m clearance - the player stands inside stone, so every reading was
the static resolver rather than the zombie, and the corpse case "failed" because
the thing holding the player was never the corpse. And a "corpse coming back to
life" was the actor POOL recycling the object into the next spawn, not a bug.

**Known and NOT this change's to fix:** `kite` runs its chamber laps while the
wave is still spawning (6-14 live) and its gallery laps at the full cap (24), so
`chamberCork <= galleryCork + 20` is a softer check than it reads. Pre-existing.

### THE STUCK CORNERS - FIXED 2026-08-03

Owner: "theres a few corners where we get stuck, like litereqally cant move."
TWO were real. Both fixed, and the fix is NOT where anyone would look first.

**It was geometry, not the collision resolver.** Two systems that never knew
about each other left slots narrower than the player:

    canal  (-17.2, 17.6)   perimeter wall reaches south to z 17.34
                           prop row reaches north to z 17.09   = 0.25 m corridor
    quarry (17.5, -16.9)   the same sliver against the quarry's own row

The body is 0.84 m across. A 0.25 m slot is not a passage anyone can use, and
the one thing it can still do is swallow a player the resolver pushes into it
and hold them with stone on both sides.

**The fix is a post-build sealer in `world/courtyard.js`**, running LAST after
every builder including the quarry and the canal, so a slot formed between two
systems that never coordinated is still caught. It fills any gap narrower than
the body. 1104 slots sealed; colliders 662 -> 1766; measured cost **0.0054 ->
0.0151 ms per frame**, about 0.09 per cent of a 16.7 ms budget.

    instrument          bad    stuck   confirmed   TRAPS
    baseline           1052     1031           5       2
    8-pass resolver    1235     1224           8       2     <- REJECTED
    slot sealer         708      694           4       0

`nav`, `economy`, `governor`, `enemies` all pass, including nav's own routing
cost gates. The four remaining stuck places are all behind `faceX` or `wallX`,
inside rock, and the trap test confirms every one is unreachable.

**THE REJECTED FIX IS WORTH REMEMBERING.** Raising the resolver's pass count
from 2 to 8 was the obvious move and the reasoning was sound - three overlapping
cylinders cannot converge in two passes. It made the game measurably WORSE.
More iterations do not free a body from a slot narrower than itself; they push
it further in. The numbers live in `RESOLVE_PASSES` so nobody re-derives it.
The resolver keeps ONE real fix: a body landing exactly on a cylinder's axis
used to get no push at all, because the guard `distSq > 1e-8` skipped it.

**Three harnesses, and only one of them gets to have an opinion.**
`test/stuck.mjs` sweeps and finds CANDIDATES. `test/stuck-trap.mjs` decides,
because a place you cannot walk out of is only a bug if you can walk INTO it -
the inside of a rock face is not a defect. `test/stuck-pins.mjs` is the A/B
instrument: the sweep's own clustering picks its points, so before and after
runs report different coordinates and prove nothing.

**MY OWN INSTRUMENTS WERE WRONG THREE TIMES IN THIS ONE INVESTIGATION**, and the
tells were all in their own output:

1. `player.update(dt, input, yaw)` takes the yaw as its THIRD ARGUMENT and does
   not read the rig. Every probe passed 0 and set the rig separately, so all
   eight "directions" walked due -z. THE TELL: 947 bad points, 100 per cent
   STUCK, ZERO pockets. A world does not fail that uniformly. Same signature as
   the sixteen unreachable spawn points in July.
2. Distance measured over a fixed FRAME count, when a swiftshader frame is worth
   between 100 ms and 1.7 s. Same code, same point, two runs: 0 m and 35.24 m.
3. An approach walk given 2 s to cross 6 m, which reported every target
   UNREACHABLE with four metres still to go.

Every harness now carries a CONTROL in open ground, in the same run, and judges
speeds against it rather than against a constant.

### THE 2AM EOD BOT COMMITTED KNOWN-BAD CODE

`d5b6575` swept up `controller.js` mid-investigation - the 8-pass version that
had just been measured as a regression - plus three harness files and a
throwaway probe. It was caught before pushing and the commit was reset. The
pre-push divergence guard would also have stopped it at the push. Worth knowing
the sweep runs at 02:00 and does not care whether the tree is mid-experiment.

### THE PACER, MGS STYLE - BUILT 2026-08-02

Owner overrode the design's Banjo-Kazooie vocal blips and asked for Metal Gear
Solid codec. One tick per character as it appears, short dry percussive burst,
speakers separated by PITCH AND FILTER not phonemes, punctuation costs time,
spaces silent, small pitch jitter. His call is better: a codec tick is not a
voice, so it dissolves the defect where her blip would have shared `groan()`'s
formant bank and made her sound like the horde. Also fixing INSTANCE TWELVE
(below) and the gatekeeper's two words on the death card.

`src/ui/pacer.js` (new, 751 lines), `codecTick()` in `core/audio.js`, the
gatekeeper's two words on `ui/death.js`, `test/pacer.mjs` (66 checks, wired into
`npm test`). Two exports: `createTypewriter` (the reveal primitive) and
`createPacer` (the pill's voice and hold policy). Punctuation costs time (stop
320 ms, comma 150, dash 90); spaces cost 0.6x and are SILENT.

**The two speakers are separated by pitch and filter, not phonemes**, which is
what makes a codec tick not a voice. Measured by rendering through the real
graph, by AUTOCORRELATION rather than loudest bin - the lane's first attempt
reported the gatekeeper at 506 Hz, his third harmonic, and it caught that before
believing it:

    archaeologist   337 Hz, centroid 1229 Hz, 30.5 ms
    gatekeeper      169 Hz, centroid  566 Hz, 50.0 ms
    groan(), horde   89 Hz median  (rand 62-104)

Exactly one octave apart, and the lower speaker sits 1.59x above the horde's
ceiling at the bottom of its jitter. That is the defect the owner's MGS call
dissolved: a formant-based blip would have shared `groan()`'s bank and made her
sound like the thing chasing him.

**INSTANCE TWELVE IS FIXED, AND SCOPED RATHER THAN RIPPED OUT.**
`text-transform: uppercase` STAYS on the base `#notice` rule and is overridden
only on `#notice.voice-her`, so not one of the ten existing callers has its
rendering renegotiated. `white-space` went global to `normal` with
`max-width: min(34em, 78vw)`, on the argument that wrapping cannot change a line
that already fits on one line. Verified by reading the CSS, not the report.

**THE TWO-CLOCK DEFECT IS FIXED AND THE GUARD IS OUT.** `arm()` is deleted; a
spoken line's reveal, cut and hold are counted on ONE per-frame clock inside the
typewriter. `jars.js`'s `hold: 12000` guard has been REMOVED and the beat
re-verified without it rather than assumed to survive. A guard that is never
removed is a bug that is never fixed.

### TWO OPEN CALLS FOR THE OWNER, both from the pacer lane

1. **RESOLVED 2026-08-03. Her line 4 overran the Hard breather** at 71 chars and
   5.17 s against a 4.5 s window. NO CONSTANT FIXED IT: stop 320 to 200 left it
   at 4.81, hold 1200 to 800 at 4.77, and both together at 4.63, while making
   every other line flatter for nothing. 71 characters at 22 cps is 3.23 s
   before punctuation, and the line carried three full stops. It was too long,
   not the constants too slow.

   Fixed in two halves. **A trailing full stop was being charged twice** -
   `PUNCT_MS` buys the beat that FOLLOWS a mark, and after the last character
   `HOLD_MS` is already that beat, so an end-of-line pause cost 1520 ms against
   an internal break's 320. `schedule()` no longer charges the final character,
   which gives every line 0.3 to 1.0 s back. **And the line was edited**, from

       did anything happen to you. down there. anything you'd want to tell me.
       did anything happen down there. anything you'd want to tell me.

   which keeps `did`, keeps `you'd want to tell me` (the ask, and the point of
   the line), and pays only by folding the `down there.` fragment into the first
   sentence. 63 chars, 4.20 s, 0.30 s of room - the widest margin of the six
   candidates timed. All five lines now clear Normal AND Hard.

2. **RESOLVED 2026-08-04. The gatekeeper's two words are RATIFIED.**

       NOT YET · STAND UP · GO DEEPER · NOT FINISHED · MINE STILL · WALK AGAIN

   Rotating by death count, `NOT YET` always first because it is the one every
   player meets; `setAnswer(null)` still withholds them for World 3's last card,
   whose whole trick is that the words do not arrive.

   **The rule that settled it: HE IS NOT KIND.** `NARRATIVE.md` has him standing
   the corpse up "because he needs it to reach the bottom", telling the player
   nothing ever, and at the end throwing him through the gate for being what the
   OTHER power made him - the being who has been standing him up for three worlds
   is the one holding the list he is on. `COME BACK` was the lane's original pick
   and was cut as the only warm line in the set: it implies he misses the player,
   and that the player went somewhere, which muddles which power owns the death
   loop. `GO DEEPER` is the one thing the narrative says he actually wants.
   `MINE STILL` is load-bearing - a claim of possession on the most-read text in
   the game, and what makes the ending a betrayal rather than a twist.

   **All six are now RENDERED in the harness, not just declared.** `pacer.mjs`
   only ever exercised slots 0 and 1, which left four of his lines written and
   never drawn - this project's single most repeated defect. It now walks the
   whole rotation with real Enter presses (`state.resets` moves only on the
   CONFIRM) and measures the laid-out box of each, because a word that is
   assigned but not painted has width zero:

       NOT YET 84x13   STAND UP 97x13   GO DEEPER 110x13
       NOT FINISHED 141x13   MINE STILL 115x13   WALK AGAIN 122x13

### INSTANCE TWELVE of "written but never rendered" - FIXED 2026-08-02

`index.html` set `text-transform: uppercase` AND `white-space: nowrap` on
`#notice`. Her authored lines are LOWERCASE and run to 52 characters. The entire
scheme where she is the only lowercase text in the game was unrenderable at any
string, on a pill that would not fit the line anyway. Found by reading the CSS.
Fixed by the pacer lane, scoped rather than ripped out - see above.

### INSTANCE THIRTEEN - FIXED 2026-08-02, AND CAUGHT BEFORE IT SHIPPED

The courtyard jar, the first jar a player ever sees, carried no `noBatch` tag,
so `batchStatics` would have merged it into the static mesh. It would have
rendered perfectly and been unpickable by construction - the pickup prompt would
simply never appear, on an object visibly sitting right there. Found while
building the verb that picks it up, which is the only reason it was found at
all. Every other instance on this list was found after it shipped.

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
