# WORLD 1 - THE BUILDABLE MAP SCOPE

Written 2026-08-02, against `docs/NARRATIVE.md` lines 394 to 718 (World 1's
section, between its two WORLD BOUNDARY markers), `docs/WORLD-1.md`, `MAP.md`
and `docs/MAP-SURVEY.md` (both rewritten today), `docs/DESCENT.md`, and
`src/world/rooms.js` read in full.

**Downstream of the narrative, upstream of the map lane.** For every dramatic
beat World 1 requires: where it lands, and what has to be built for it to land
there. **PURPOSES, NOT GEOMETRY. No coordinates, no dimensions, no layout.**

**Nothing below is claimed built or unbuilt from a document.** Every such claim
was checked against `rooms.js`, `doors.js`, `interact.js`, `build.js`,
`courtyard.js`, `boss.js` or today's survey. This project has thirteen confirmed
instances of things written that never rendered. The thirteenth was found while
building BUILD 1 and is the only one caught before it shipped: the courtyard
jar, the first jar a player ever sees, was untagged, so `batchStatics` would
have merged it into the static mesh. It would have rendered perfectly and been
unpickable by construction.

**STATUS, 2026-08-02, updated after the build rather than before it: BUILD 1
and BUILD 6 ARE BUILT.** World 1 can be finished. `test/jars.mjs` is 65 checks
of real key events on real frames and it passes. Rows and items below are marked
**BUILT** where that is now true; everything unmarked is still scope.

**Names, as locked by the owner:** the queen is **HETEPHERES**, the
pre-Egyptian builders are **THE ANCIENTS**. Checked: "Meresankh" appears
nowhere in this repository, in source or in documents. Nothing to correct.

---

## 1. BLUF

- **Nine build items. Two of them, BUILD 1 and BUILD 6, are now BUILT.** Of the
  seven left, one is a new exterior space and six are additive work inside
  surfaces that already exist.
- **The most consequential item is DONE.** The four-jar chain blocked everything
  and it shipped: the counter has one writer, the Serdab opens, the run
  terminates at wave 25 and the end card lands. **The biggest single build left
  is the EXPEDITION CAMP**, a new authored exterior space at the scale of
  `quarry.js` or `canal.js`, roughly 500 to 700 lines plus its courtyard wiring
  and its own probe.
- **Total honest size: roughly 2,000 to 2,700 lines of new or changed source,
  ONE new exterior space, ZERO new interior rooms**, about fourteen to eighteen
  new prop and fixture types, two new interact handler types, and two or three
  new harnesses. **Roughly 1,750 of those lines are now spent**, across BUILD 1
  and BUILD 6 plus their harness, both interact handler types, and one of the
  three harnesses.
- **The nine interior rooms still suffice, and the case is STRONGER than when
  the map brief said so.** Every interior purpose in the narrative has a home
  among the nine. The two changes since the brief both removed reasons to add
  rooms rather than creating them: the entry room widened and its west door
  became an opening, which answers "too small to run in" without a room, and the
  descent shipped, which gives "deeper and deeper" a built home. What is missing
  is outdoors, in props, and in systems.
- **Gap 2 is CLOSED. Do not re-scope the descent.** Rooms carry a `base`, Act
  3's five rooms sit lower, three ramps stand at the Act 2 to Act 3 break, and
  `test/descent.mjs` walks all six legs. Gap 1, the camp, is still mandatory and
  still unbuilt.

---

## 2. THE BEAT TABLE

Every beat in World 1's narrative section, in story order. BUILD n refers to
section 3.

### Act 1, outside

| # | Beat | Where it lands today | Exists | What is missing |
|---|---|---|---|---|
| 1 | The first frame is him standing on the spot where he died, facing the pyramid | the courtyard spawn, which `courtyard.js` names in its own comments | yes | nothing. The refusal holds: nothing is placed there, ever |
| 2 | A modern expedition camp with nobody in it: generators running, tents up, crates stencilled | nowhere | **no** | BUILD 2, the whole space |
| 3 | An instrument array still logging an anomaly nobody is reading | nowhere. It can live inside the camp | **no** | BUILD 2 |
| 4 | The dead come across the sand, he kills them and takes their gold | the avenue plus the Quarry and the Canal, both built and both wired as purchases in `doors.all` | yes | nothing. Act 1 has its circuit |
| 5 | Somewhere to circle when the circuit is too long to run | the avenue only | partly | the forecourt mass is unbuilt and `courtyard.js` states the opposite intent. Folded into BUILD 2, see section 4 |
| 6 | The doorway is blocked, and the first purchase in the game is the way back in | the sealed doorway, `ENTRY`, a gate in the courtyard | yes | nothing. Refusal: no line ever explains that he came OUT through it |
| 7 | Jar 1 in a side chapel on the walk down the avenue | the courtyard west chapel. The jar is meshed, collidered and published on `courtyard.jars` | **yes, BUILT** | nothing. The verb shipped with BUILD 1, and the jar was made `noBatch` in the same pass: it would have merged into the static mesh and been unpickable while looking perfect |
| 8 | Fragment 1 on taking it: seven black shapes in a stone room, doing something to a door | nowhere | **no** | BUILD 4 |
| 9 | She calls out on the avenue. Question 1 | the notice pill, `main.js` `showNotice` | channel yes | BUILD 3: the line list, the lowercase mode, the hold |
| 10 | Her lamp, ahead of him in the dark | nowhere. There is no lamp prop of any kind | **no** | BUILD 7 |

### Act 2, inside, and the survey

| # | Beat | Where it lands today | Exists | What is missing |
|---|---|---|---|---|
| 11 | The doorway opens and the building is bigger inside than outside, and nobody mentions it | the Chamber of Ascent, and `rooms.js` states the fact in its own header | yes | nothing. It is a refusal: never fix it, never excuse it |
| 12 | The first room inside has to be somewhere he can run | the Chamber of Ascent, widened, with its west door now `kind: 'open'` rather than a zero-cost door | yes | nothing. This closed after the map brief was written |
| 13 | Rooms full of somebody's work: chalk numbers, a folding stool, survey pegs, rope strung as a handline, a notebook | the Chamber of Ascent, Hall of Offerings, Granary Vault, Great Gallery | rooms yes | BUILD 7. None of the six prop types exist; `build.js` `PROPS` has eleven types and none of them is one of these |
| 14 | The camp gradient: bleached in Act 1, crisp in Act 2, warm in Act 3, nothing modern in the boss room | the same rooms plus the Canopic Crypt | rooms yes | BUILD 7 |
| 15 | Question 2, just inside, counting the crew | the Chamber of Ascent | yes | BUILD 3 |
| 16 | Question 3, mid-fight, from a ledge above the loudest room, and it does not finish | the Great Gallery's upper ring, ledges and bridge, built | yes | BUILD 3, plus her lamp on the ledge from BUILD 7 |
| 17 | Jar 2 up the shaft that points at the sky | the Star Shaft. Jar 2 is placed and meshed | **yes, BUILT** | nothing. The pickup shipped with BUILD 1 |
| 18 | A rope in the shaft going up into the dark, ending at nothing | the Star Shaft | room yes | BUILD 7. Verified today: there is no rope prop, mesh or slot type anywhere in `src/` |
| 19 | Fragment 2: the same room, growth on the wall, one shape too close to the door | nowhere | **no** | BUILD 4 |

### Act 3, the machine, the silence, and the name

| # | Beat | Where it lands today | Exists | What is missing |
|---|---|---|---|---|
| 20 | Deeper. The rooms get lower and he physically goes down | the descent: five rooms on the lower datum, three ramps at the Act 2 to Act 3 break | **yes, BUILT** | nothing. Do not re-scope this |
| 21 | The world tells him how deep he is | nowhere on the HUD | **no** | BUILD 9, one span beside the wave counter |
| 22 | The room with four empty niches, and a notebook with them chalk-numbered in the wrong order | the Embalming Chamber. Four `niche` interact slots are authored, one per son | **yes, BUILT** | `niche` is a registered handler type now and the niches accept. BUILD 7 still owes the notebook |
| 23 | He puts the jars in the niches. Jar 3, fragment 3: he is watching himself from where she was hiding | the Embalming Chamber | **the returns are BUILT** | BUILD 4 for fragment 3. `jars.onTake(fn)` is live and unused, and is the seam the four fragments want |
| 24 | The third jar going home turns the building on: light across nine rooms, a horn then a chime, six shrines waking, a gate opening, the notice | `systems/power.js`, and the fire bowl stands in the Embalming Chamber | **yes, BUILT** | nothing. Option C landed: the third jar calls `throwSwitch()`, the lever's interactability is deleted, and **`systems/power.js` is byte-for-byte untouched** |
| 25 | THE KINDLING TAKES overwrites her mid-sentence, and she never speaks again | the notice pill, which already overwrites everything | **the beat is BUILT** | nothing for this beat: the third jar seats, her line reveals lowercase, stops dead at "since we-", and the machine starts inside that callback. `test/jars.mjs` reports `litVia: "cut"`, so it fires through the authored cut rather than a backstop. BUILD 3 still owes the other four lines and the hold |
| 26 | Ten waves of silence follow and nothing visibly changes | everywhere | yes | nothing, once BUILD 3 exists. This beat is a refusal |
| 27 | Down a long sightline, her lamp stands still and the horde flows around it, once, unremarked | Act 3 has the sightlines: each descent gate looks down its own ramp into a room, and the boss arena is the largest floor in the map | yes | BUILD 7 for the lamp. The exact placement is the map lane's call |
| 28 | Jar 4 in the room with the sarcophagus, the biggest room, the boss arena, nothing modern in it | the King's Chamber. Jar 4 and the sarcophagus are both placed | **yes, BUILT** | nothing. Refusal still stands: this room stays clear of every BUILD 7 prop |
| 29 | Fragment 4: he sees himself die, and that she was there | nowhere | **no** | BUILD 4 |
| 30 | He carries it back to the fourth niche, and the struck cartouche lights one glyph at a time: HETEPHERES | the Serdab | room yes, surface no | BUILD 5. There is no way to write text on a wall; the only cartouche in the codebase is the death card's, in `ui/death.js` |

### The boss, the law, and the chapel at the bottom

| # | Beat | Where it lands today | Exists | What is missing |
|---|---|---|---|---|
| 31 | The five gods are the tomb's staff, and the ending is rehearsed five times as boss fights | `boss.js` ships five gods on the five-wave cycle | yes | nothing. It is a reading, not a build |
| 32 | Wave 25. Set falls, the gilding flares once on a corpse, brighter than any telegraph, then goes out | `boss.js` has one death path shared by all five gods | **yes, BUILT** | nothing. `farewell: true` on Set only; measured flare peak 6.4 against the telegraph's ceiling of 3.6, eye emissive to zero first |
| 33 | Every living thing stops for one second and turns to face the door of the sealed chapel | `director.js` | **yes, BUILT** | nothing. Sixteen live bodies turned to the chapel door with worst error 0.0000 rad |
| 34 | The doorway that gold cannot open is open now | the Serdab portal, `kind: 'puzzle'`, cost 0 | **yes, BUILT** | nothing. **Two bugs, not one: the counter had no writer, and `lockedBecause` returned the progress string unconditionally, so it stayed truthy at 4 of 4 and denied. `systems/jars.js` is the one writer; the gate returns `null` at four** |
| 35 | The only room in twenty-five waves with no spawn points, so he can be alone | the Serdab. `spawnPoints: []`, deliberately, with the reason written in the record | yes | nothing. This is the beat's load-bearing fact and it already ships |
| 36 | Ten rock-cut figures of the same woman, and an eleventh niche cut on its own, empty | the Serdab, which carries one statue today | room yes | BUILD 5 |
| 37 | She is sitting on a stool with her back to the door, the lamp beside her. The first time she has a body | the Serdab | room yes | BUILD 5: a fixture type, plus BUILD 7's stool and lamp |
| 38 | He is prompted, and this one has no price | `ui/prompt.js` already has a refusal path that quotes no price | channel yes | BUILD 5: a handler whose `buy()` fires the sequence and returns false. Four slot types are registered today and hers is not one |
| 39 | The mark he has been finding chiselled into walls is on her lamp, lit from inside | nowhere. The effaced cartouche does not exist as a world object | **no** | BUILD 7 |
| 40 | Her eyes take the boss telegraph, on a person, in the one room with nothing to shoot | `boss.js` `setGlow` owns the curve | curve yes | BUILD 5: apply it to her fixture |
| 41 | Black, and a card in the death card's shape: struck glyphs, THE NAME IS NOT HERE | `ui/death.js` machinery, tokens, confirm gate | **yes, BUILT** | nothing. `ui/ending.js` is a sibling module sharing `ui/tokens.js`, not a flag on the death card. Laid-out box measured 427x32 px, four struck glyphs, death card does not fire |
| 42 | He confirms, and when the frame comes back he is in the eleventh niche going down | `spaces.enter()` swaps the world behind a curtain held for two drawn frames | **the run can END** | BUILD 5 still owes the eleventh niche as a place. `FINAL_WAVE = 25`, a `concluded` phase, and `onDescend` all ship; endless mode is `setEndless`, off by default |
| 43 | On the boundary, twenty times a run: the death card judges him, erases him, and then he stands up | `ui/death.js`, shipping | yes | nothing |
| 44 | Two or three words under the verdict, in a different treatment, disagreeing with it | the same card | frame yes | BUILD 8 |
| 45 | The game counts the returns | `state.resets` exists in `ui/death.js` | yes | BUILD 8: print it |

---

## 3. BUILD ITEMS

Ranked by what the story cannot survive without. Sizes are in this project's own
units: lines of source, new rooms, new props.

### BUILD 1. The four-jar chain, and the Kindling repointed onto it - BUILT 2026-08-02

- **Built as `src/systems/jars.js`**, about 640 lines, plus `ui/interact.js`,
  `systems/doors.js`, `ui/objective.js`, `ui/minimap.js`, `world/build.js`,
  `world/courtyard.js`. Harness `test/jars.mjs`, 952 lines, 65 checks, wired
  into `npm test` and `test:jars`. Option C was taken as recommended.
- **What actually landed, against what was scoped.** The estimate was 250 to 400
  lines for the chain plus 150 for the repoint; the chain came in at the top of
  that and the repoint under it. Two things were not in the scope and are worth
  recording: `lockedBecause` had a second bug independent of the missing writer,
  and the courtyard jar needed `noBatch` or it would have been unpickable.
- **Verified by playing it, not by asserting it.** Every pickup and return in the
  harness is a real `KeyboardEvent` at the window, through `main.js`'s own
  binding table, on real frames, using the game's own crosshair raycast. Where a
  jar ended up is read off the scene graph rather than off the system's own
  bookkeeping.
- **What.** A carried-item verb, four niches that accept, a counter that is
  written, and the third jar landing calls the existing `throwSwitch()`.
- **Beats.** 7, 8, 17, 19, 22, 23, 24, 25, 28, 29, 30, 34. The spine of Acts 2
  and 3, and the gate on shipping World 1 at all.
- **Touches.** A new system module; `ui/interact.js`, two new handler types,
  `canopic-jar` to take and `niche` to give, because the interact layer skips
  any slot type with no handler and only four are registered; `systems/doors.js`,
  write `jarsReturned` and delete the lever's `switch` record and its F-key
  branch; `ui/objective.js`, where the rung already reads `power.powered` so
  only its text changes; the minimap glyph. **`systems/power.js` is untouched**,
  which is the point of the repoint: its own comment says it exists "for the day
  the puzzle chain wants to light the map from somewhere else".
- **Size.** Roughly 250 to 400 lines for the chain plus roughly 150 across five
  files for the repoint, plus one harness. No new rooms, no new geometry.
- **Without it.** World 1 has no ending. The Serdab cannot be entered, the
  cartouche never completes, the fragments have no delivery point, and the frame
  that erases her never fires.

### BUILD 2. The expedition camp

Section 4. Roughly 500 to 700 lines of new exterior space plus about 80 of
courtyard wiring, six to ten new prop kinds, one new authored exterior space,
no new interior rooms.

### BUILD 3. Her voice: the list, the lowercase, the hold, and the one exception

- **What.** A flat data list of `{ room, line }` fired on first entry and
  suppressed during boss waves; lowercase styling on the notice pill; a hold so
  a system notice arriving during one of her lines is dropped rather than
  deferred; and exactly one deliberate exception to that hold, at the machine.
- **Beats.** 9, 15, 16, 25, 26.
- **Touches.** One new data file, `main.js` `showNotice` (seven lines today,
  last-write-wins, no queue, no attribution), one CSS class, and a room helper
  `ui/objective.js` and `spaces.roomId` already answer.
- **Size.** Roughly 80 to 140 lines plus the five-line list. One boolean, one
  timestamp, one class.
- **Without it.** Five beats do not exist, the ten waves of silence have nothing
  to be the absence of, and the Serdab reveal loses the one channel the player
  can feel without having worked anything out.

### BUILD 4. The flashback fragments

- **What.** One held-tableau driver plus four authored fragments: unlit black
  shapes on a held frame, no camera move, no animation, no choreography.
- **Beats.** 8, 19, 23, 29. World 1's second stated purpose, giving him a
  quarter of his memory back four times.
- **Touches.** A new module using the curtain's existing full-black hold and the
  post chain's grade and vignette. **Do not build a camera detach.** The rig is
  welded to the player's head and the moment it moves this becomes a cut scene
  and triples.
- **Size.** Roughly 190 to 240 lines plus four short data authorings.
- **Without it.** The origin has no delivery mechanism in the world that ships
  first, and the cut scene comes back at the World 2 gate at three times the
  price.

### BUILD 5. The Serdab's ending fixtures

- **What.** Ten rock-cut figures and an eleventh empty recess; the archaeologist
  as a fixture that is not for sale; a handler type whose `buy()` fires the
  sequence and returns false; four discrete emissive glyph meshes for the
  cartouche; `setGlow`'s curve applied to her.
- **Beats.** 30, 36, 37, 38, 40.
- **Touches.** `rooms.js`, where the Serdab carries five props and zero
  interacts today; `build.js` `PROPS` and its fixture builders;
  `ui/interact.js`; a read of `boss.js`'s glow curve.
- **Size.** Roughly 200 to 300 lines, four new prop types, one new fixture type,
  one new handler type. The room's entire art budget.
- **Without it.** The ending has a room and no scene in it.
- **FLAG, LOUDLY: nothing in this item may change the Serdab's floor or its
  ceiling.** Section 6.

### BUILD 6. World 1 has to be able to END - BUILT 2026-08-02

- **Built as `src/ui/ending.js`**, about 550 lines, plus `enemies/director.js`
  (`FINAL_WAVE = 25`, a `concluded` phase, `onConclude`, `setEndless`,
  `bossFarewell()`) and `enemies/boss.js` (`farewell: true` on Set only).
  Covered by `test/jars.mjs`.
- **The gate on the end card is three conditions**, not one: the run concluded,
  four sons home, and the player standing in the Serdab.
- **The eleventh niche was deliberately NOT built here.** It is BUILD 5's, and
  section 6's zero-slack flag says nothing may touch the Serdab's floor or
  ceiling. Nothing did.
- **The ladder is verified too, as of `test/e2e.mjs`.** `jars.mjs` reaches wave
  25 with `forceWave`, which is correct for a unit harness and leaves the climb
  unproven. `e2e.mjs` replaces `forceWave` and `reset` with functions that record
  a violation and throw, then plays waves 1 to 25 and checks the ladder for
  CONTIGUITY rather than for its last number: a director that skipped 7 to 9
  would still conclude on 25. Measured spawn curve, which is the difficulty ramp
  made visible: 7, 8, 10, 12, **7**, 17, 19, 21, 23, **11**, 24, 24, 24, 24,
  **15** ... The bold dips are the boss waves, one god instead of a crowd, and 24
  is the live cap holding from wave 11 on.
- **What.** Four small things that only matter together: the run terminating at
  wave 25 on Set's death rather than cycling; a `farewell` variant on Set's god
  record; a one-shot stop-and-face on the director; and an end card as a sibling
  module of `ui/death.js` sharing `ui/tokens.js`, with the eleventh niche as the
  destination on confirm.
- **Beats.** 32, 33, 41, 42.
- **Touches.** `main.js` or `director.js` for the terminal condition (verified
  today: `forWave()` cycles forever and there is no `endRun`, no victory path
  and no wave-25 branch anywhere in `src/`); `boss.js`'s single shared death
  path; `director.js`; one new UI module. Endless mode keeps the existing cycle,
  off the start screen, where it is exactly right.
- **Size.** Roughly 320 to 500 lines across four files.
- **Without it.** The player kills Set and wave 26 spawns.

### BUILD 7. The camp gradient props, and the sign

- **What.** Six new propSlot types, `lamp`, `stool`, `peg`, `chalk`, `rope`,
  `notebook`, plus the effaced cartouche as a wall mark. All boxes and
  cylinders, then authored across the rooms as the temperature gradient.
- **Beats.** 10, 13, 14, 16, 18, 22, 27, 37, 39.
- **Touches.** `build.js` `PROPS`, whose eleven existing builders run twenty to
  forty lines each and are the honest unit here, and `rooms.js` propSlots in
  every room except the King's Chamber, which stays clean.
- **Size.** Roughly 200 to 250 lines of builders plus about forty slot
  authorings. Seven new prop types, zero new rooms.
- **Without it.** The player never learns a living person is ahead of him, so
  the Serdab lands on somebody the game never introduced, and the horde flowing
  past her lamp has no lamp to flow past.

### BUILD 8. The two plants that live on the death card

- **What.** Two or three words under the verdict, in a different treatment, and
  a third stats field using the antagonist's own verb for the reset count.
- **Beats.** 44, 45.
- **Touches.** `ui/death.js` only. One span, one string table, and a value that
  already exists as `state.resets`.
- **Size.** Roughly 40 to 70 lines. The cheapest strong beat in the project.
- **Without it.** The gatekeeper's voice arrives in World 3 as an author's
  convenience, and the last card in the trilogy has nothing to withhold.

### BUILD 9. The depth readout

- **What.** Metres below the sand beside the wave counter, derived from the
  deepest room reached rather than from the wave.
- **Beat.** 21.
- **Touches.** `index.html`'s ammo block, which already stacks two rows and
  states the rule in its own comment, and the room the player is in.
- **Size.** Roughly 20 to 30 lines, one span, no new styling.
- **Without it.** World 1 survives. A depth readout introduced in World 2 is a
  UI element; one that has been there since wave one is a fact.

---

## 4. THE EXPEDITION CAMP

Gap 1. Mandatory. The largest new SPACE requirement in World 1 and the only one.

### What it has to contain to do its narrative job

Four things, each doing work no other object in World 1 does:

1. **Shelter and stores carried here on purpose.** Tents standing, crates
   stencilled. The read is a manifest, not a ruin.
2. **Power still running with nobody to use it.** A running generator is the
   difference between abandoned and derelict, said with a noise and a light.
3. **An instrument array still logging an anomaly nobody is reading.** The only
   object in World 1 saying somebody knew there was something here before anyone
   opened anything. It plants Area 51 two worlds early, with a needle.
4. **Nothing that explains itself.** No audio log, no readable journal, no found
   footage. All three are a dialogue system in a costume.

Not in the camp: any marker of any kind near the spawn. The spot he died on
stays unremarkable, forever.

### Where in the exterior it can go

The exterior has three authored spaces: the avenue with its forecourt and
chapels, the Quarry east, and the Canal west, the last two built and each opened
by its own purchase. **The camp is the third node the Act 1 circuit can join,
and this lane's recommendation is that it sits on the avenue side, in the open,
between the spawn and the sealed doorway, so it cannot be missed on the walk
down and so it is the mass the forecourt does not have.**

Two constraints the map lane owns. **Do not reopen the greybox perimeter**;
`courtyard.js` records why the walkable area was tightened, and the map grows by
authoring spaces, never by unlocking backdrop. And **nothing may stand on the
axis the player is put down on**, now measured three times in three rooms, each
measurement recorded beside the slot that caused it. A camp is dense by nature
and it is going on the one corridor the whole act runs along.

### How it fixes the courtyard's trainability problem

**First, a correction, because the brief this scope replaces quotes a document
that has since been rewritten.** `MAP.md` no longer contains the phrase "the
worst of the four"; it survives only inside `docs/WORLD-1.md`, and it described
a courtyard with no circuit at all. The Act 1 circuit has since shipped, so the
avenue is no longer a straight corridor closed at both ends.

**What is genuinely still missing is the second loop scale.** `MAP.md` asks Act
1 for two: the circuit, for when you have room to run, and the panic circle, for
when you do not. The circuit exists. **The panic circle does not**, because the
circumnavigable mass at the forecourt centre is unbuilt and `courtyard.js`
states the opposite intent in its own source. `docs/MAP-SURVEY.md` section 8 row
8 records that as a live disagreement between the document and the code.

**The camp resolves it by giving the mass a reason to exist.** Tents, crates and
a generator, sited so the player can run a tight ring around them, is a panic
circle the fiction demanded anyway, and the map lane never has to argue why a
lump of stone is standing in the forecourt of a finished avenue.

**Recommendation: the camp is open from the first frame, not a purchase.** Act
1's economy already carries three roughly comparable claims and the fork between
them is the act's only real decision. A fourth claim flattens it, and the one
place in the trilogy where the institution is physically present should not sit
behind a gold gate in a game whose entire economy is grave robbery.

---

## 5. WHAT IS ALREADY DONE

Specifically, so nobody rebuilds it.

- **The descent.** Every room record carries a `base`; Act 3's five rooms sit
  below Act 2's four; three ramps stand at the Act 2 to Act 3 break, one behind
  each gallery gate. `test/descent.mjs` drives the centre ramp on real frames
  and all six legs complete. **Gap 2 is closed. The one-descent-not-nine
  recommendation was taken.**
- **The undercroft fill and the per-base weathering.** Both defects the descent
  exposed are fixed and measured, including the one that took the Serdab 43 per
  cent darker and has put it back above where it started.
- **The Act 1 circuit.** Quarry and Canal built, both purchases live in
  `doors.all`.
- **The entry room.** Widened, and its west door is `kind: 'open'` rather than a
  zero-cost door, which is the difference between an opening and a door you stop
  at with a horde behind you. The Act 2 loop closes for half what it did, and
  the owner's "too small to run in" is answered without a new room.
- **The gallery upper ring.** Two ledges, the bridge joining them, two ramps and
  the Altar on the span. Her third line has its ledge.
- **Act 3's loops.** Both King's Chamber portals are cut and every spawning room
  in the map is on a cycle. The boss arena is somewhere you can circle.
- **All four jars placed**, jar 1 outside and published on `courtyard.jars` in
  the shape `build.js` publishes the other three, and **the four niches**
  authored in the Embalming Chamber, one per son.
- **The four-jar chain itself, BUILT 2026-08-02.** `systems/jars.js` owns take
  and give, `doors.state.jarsReturned` has exactly one writer, the Serdab opens
  at four, and the third jar lights the map through the existing `throwSwitch()`.
- **The ending, BUILT 2026-08-02.** Wave 25 is the ceiling, Set gets a farewell
  flare, the room turns to the chapel door, and `ui/ending.js` lands the card.
  The run can conclude. What it cannot yet do is descend into a niche that has
  been built, which is BUILD 5.
- **The Serdab as the stage.** No spawn points, deliberately, with the reason in
  the record. The only room in twenty-five waves where the player can be alone.
- **The power system entire.** `throwSwitch`, the horn and chime, the six shrine
  gates, the light ramp, the notice. It needs a new caller, not a rewrite.
- **The death card.** Cartouche, verdict, subtitle, hold, a confirm gate that
  waits indefinitely, and `state.resets` counting.
- **`spaces.enter()`.** Swapping the world under a player behind a curtain held
  for two drawn frames is solved. World 1's ending is that machinery with a
  different word and a different destination.
- **The five gods**, one per fifth wave, each already in the room the map puts
  the player in.

---

## 6. FLAG: THE SERDAB DOORWAY HAS ZERO SLACK

**`star-shaft -> serdab` sits at exactly 0.00 slack on the doorway rule
`height >= drop + 5.0`.** `docs/MAP-SURVEY.md` section 7 measures it: all twelve
openings clear 4.2 and this one does it with no margin at all. The builder has
no lower bound on the arithmetic and nothing asserts the result, so a short door
here does not fail, it renders.

- **BUILD 5 must not change the Serdab's `height` or its `base`.** The figures
  and the eleventh niche are recesses and props against existing walls. A room
  made shorter to press the ceiling down produces, silently, a doorway the
  player cannot walk through.
- **The eleventh niche as the exit is a recess that becomes a shaft, which is
  why it was chosen: it costs no room geometry.** Re-stage it as a trapdoor, a
  collapsing floor or a lowering of the room and the rule bites immediately.
- **Do not revisit the declined second descent as part of the ending.**
  `docs/DESCENT.md` section 8 costs it: dropping the Serdab forces its authored
  height up, which stops it being the lowest ceiling in the game as an authored
  number, and the narrative names that ceiling explicitly.
- **BUILD 2 is exterior and the rule does not reach it.**

Separately, and the map lane's to price rather than this lane's to solve: the
Serdab is the only bridge in the room graph, it hangs off the Star Shaft, and
the Star Shaft also holds jar 2 and the failed ascent. World 1's exit runs
through one room already carrying three jobs.

---

## 7. OPEN QUESTIONS FOR THE OWNER

Five. Each has a recommendation and one line of reason.

1. **Does the camp double as the circumnavigable mass Act 1 is missing?**
   **Recommendation: yes.** The panic circle is the one loop scale Act 1 still
   lacks and the camp is the only object the fiction will let stand in the
   forecourt, which also settles the live disagreement between `MAP.md` and
   `courtyard.js` that `docs/MAP-SURVEY.md` row 8 records.

2. **Is the camp free, or a fourth Act 1 purchase?** **Recommendation: free,
   open from the first frame.** Act 1's three claims are deliberately comparable
   so the fork between them is a real choice, and the one place in the trilogy
   where the institution appears should not be behind a gold gate in a game
   about robbing graves.

3. **ANSWERED YES, AND BUILT. Take Option C on the Kindling: keep the system,
   keep the fire bowl, move only the trigger?** It gave meeting 2 its own words
   literally and the best beat in World 1 survived untouched, because
   `systems/power.js` is byte-for-byte unchanged. The fire bowl still stands and
   still lights; only its interactability is gone, and the harnesses now assert
   that absence as two separate claims (no prompt, and F does nothing).

4. **ANSWERED YES TO BOTH, AND BUILT. Does World 1 terminate at wave 25, and is
   the ending gated on the jars?** Endless mode is `director.setEndless`, off by
   default, one line for the start screen when that screen wants it.

5. **Do World 1's forward plants ship now: the gatekeeper's two words, the
   resurrection count, and the depth readout?** **Recommendation: yes to all
   three.** They are the cheapest items on this list by an order of magnitude,
   and each one introduced later reads as an author's convenience rather than as
   a fact that was always there.
