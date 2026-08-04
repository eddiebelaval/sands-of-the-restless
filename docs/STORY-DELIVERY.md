# STORY DELIVERY - how the story reaches a player who is being chased

Written 2026-08-02, against `docs/NARRATIVE.md`, `docs/WORLD-1.md`,
`docs/WORLD-1-MAP-SCOPE.md`, and `src/ui/` , `src/core/audio.js`,
`src/systems/spaces.js`, `src/enemies/director.js`, `src/systems/difficulty.js`
read in the tree.

**The owner's ask:** "i think that maybe in order to move story forward we do
need cut scenes or subtitles with squawks but we need a way to progress story.
we need to take the story we are telling and figure out how to tell the user."

**Nothing below is claimed built or unbuilt from a document.** Every surface
named as existing was opened. Line numbers are given so the next reader does not
have to take my word for it. Queen: HETEPHERES. Builders: THE ANCIENTS.

---

## BLUF

- **The delivery layer is not a cut scene system. It is a PACER.** One change to
  `showNotice` turns a last-write-wins pill into a surface that reveals text at a
  readable rate, holds it against interruption, and can be spoken over by a
  squawk. That primitive is what "a way to progress story" means in this
  codebase, and it carries four of the five World 1 beats.
- **"Squawks" is read as timed synthesised vocal blips**, the Banjo-Kazooie
  convention, because `audio.js:982 groan()` is already formant synthesis of an
  open vowel and a blip is that function with a shorter envelope. Section 2
  prices the other two readings.
- **The lowercase attribution does not render today, and cannot, at any string.**
  `index.html:874` sets `text-transform: uppercase` on `#notice`. The whole "she
  is the only lowercase text in the game" scheme is downstream of one declaration
  that has to be overridden. `white-space: nowrap` on the same rule is a second
  problem: her longest line is 70 characters.
- **There are enough quiet moments and it is not close.** `difficulty.js:133`
  gives Normal a 6.0 second breather, and `director.js:1283` only enters it when
  `!live.length`, so a breather is genuinely empty. Twenty-four of them is about
  144 seconds of quiet against a World 1 script of 233 characters, roughly 17
  seconds of speech. An 8 to 1 budget.
- **The held tableau recommendation survives review, with one correction.** It
  works only as a SECOND SCENE rendered around the composer, not silhouettes
  placed in the live world. 200 to 265 lines for the driver plus 15 to 25 per
  fragment, against 300 to 450 for a rig-detaching cut scene delivered once.
- **Total priced layer: roughly 730 to 1,070 lines** across nine files, two of
  them new. About 180 to 270 above what `WORLD-1-MAP-SCOPE.md` carries for the
  same ground; section 9 says where the difference is rather than hiding it.
- **Build first: the pacer, with the gatekeeper's two words in the same pass.**
  The card words touch only `ui/death.js` and collide with nothing in flight.

---

## 1. WHAT SURFACES CARRY STORY

### Exists, opened, verified

| Surface | Where | What it can carry |
|---|---|---|
| **The notice pill** | `#notice`, `index.html:1371` and `:870-879`; `main.js:1215` `showNotice(text, ms)`, five lines of body | HER voice. One line, centred, gold, currently uppercase and nowrap. No queue, no attribution, no pacing. |
| **The death card** | `ui/death.js`, `build()` at `:260`, cartouche plus `word` plus `line` plus `stats` plus a confirm button | THE GATEKEEPER's voice. A stopped world, a verdict, an indefinite wait. The most-read text in the game. |
| **The objective line** | `ui/objective.js`, milestone ladder at `:329`, panel at `:595` | The narrator, derived from live state, never scripted. It can also go SILENT, which is a beat: `:631` repaints only on change and a null step costs a return. |
| **The prompt bus** | `ui/prompt.js`, priority channels, `paint()` at `:73` | Naming a fixture, and refusing one without quoting a price. The Serdab reveal's trigger. |
| **The curtain** | `systems/spaces.js:174 createCurtain()`, a DOM sheet at z-index 10, tinted, quantised to 255 steps, held for `SETTLE_RENDERS = 2` drawn frames | The cut. The one moment the game already takes the camera's attention, and it takes it by covering the screen rather than by moving anything. |
| **The telegraph glow** | `boss.js setGlow()` | A loaded gun. Twenty-five waves of training, spent once on something that is not a boss. |
| **The pause panel** | `ui/pause.js`, tabbed, `spec` walked at `:1148`, tab buttons into `[data-pause-tabs]` | A place to put what the player missed. Section 5. |
| **Geometry and propSlots** | `rooms.js`, `build.js PROPS` | Everything the text channels cannot carry, which is most of it. |

### Proposed

Six additions, classified and priced in section 9's bill. Only one of them,
**the tableau driver, is genuinely new technology.** The pacer, the squawk, the
transcript tab and the death-card words are small extensions of shapes that
already exist; the end card is a sibling of `ui/death.js` sharing its tokens.

### The rule

Six rules already govern which beat goes where, at `WORLD-1.md:494-512`, and they
hold. One addition, which is the rule this document exists to state: **no
load-bearing plot fact may live only on a surface the player can miss.** Section 5
tests every World 1 beat against it.

---

## 2. THE READING OF "SQUAWKS", AND WHAT THE OTHERS COST

Three readings were available. **I took the second.**

**TAKEN. Synthesised vocal blips timed to the text reveal.** The Banjo-Kazooie
and Animal Crossing convention: a short pitched noise per character or per two
characters as the line writes itself onto the screen.

Why: `audio.js:982 groan()` is already exactly this synthesis. Two detuned
sawtooths through parallel bandpass formants at 570, 1100 and 2410 Hz, which the
file's own comment names as "roughly an open vowel". A blip is that patch at one
twentieth of the duration and a higher base, reusing `voice()`, `osc()`, `filt()`,
`gain()`, `env()`, `glide()` and the `SOUNDS` registry at `:1729` untouched.

And it composes: blips-per-character are only possible if the text is revealed
over time, which is the same mechanism that solves the read-speed problem in
section 3. **The squawk and the pacer are one build, not two.** Cost: 45 to 70
lines in `core/audio.js`.

**REJECTED. Radio-static bursts under a subtitle.** Cheaper still, 12 to 18 lines,
because `transient(spec)` at `audio.js:915` is one noise burst through one filter
and a static spec is one more row in `MECH`. Rejected on fiction, not cost: there
is no radio in this story. Static says "comms", and a player who hears comms starts
waiting for a handler who does not exist.

**REJECTED, mostly. Short diegetic noise standing in for speech.** The taken
reading minus the per-character timing, at the same price and with strictly less
information: it cannot indicate line length, pace, or where a line was cut off.
Its one advantage, never risking a speech-synthesiser read, is not worth losing
the interruption at the third jar, which needs the player to hear her mid-word.

**One constraint falls out of this and it is not optional.** The only throat sound
in the game is `groan()`, and `groan()` is the mummy. Same formant bank at the
same base pitch means she sounds like the horde. `groan()` uses `rand(62, 104)`
Hz; her squawk must sit an octave and a half above that floor, roughly 260 to 340
Hz, keeping the 2410 Hz formant, envelope 40 to 60 ms rather than 750 to 1500.
The gatekeeper goes the other way: 70 to 90 Hz, upper formant dropped, long decay.
Two rows in a table. Section 11, decision 2.

---

## 3. WHEN A BEAT IS ALLOWED TO FIRE

A line during a fight is a line nobody reads. **The breather is real and it is
empty:** `director.js:1283` sets `phase = 'breather'` only inside
`if (!live.length)`, so entering it requires the last actor to be gone.
`difficulty.js` gives `breather: 6.0, firstBreather: 3.5` on Normal (`:133`),
8.0 and 5.0 on Easy (`:115`), 4.5 and 2.5 on Hard (`:149`).

**The budget.** 25 waves is about 24 full breathers, roughly 144 seconds of
guaranteed quiet on Normal, against a World 1 script of five lines and 225
characters, about 17 seconds of speech at the rate in section 4. **8 to 1 on
Normal, 6 to 1 on Hard.** There is no scarcity problem. There is a targeting
problem, which is a different thing.

**CORRECTION, 2026-08-03. The model above sizes a line as `chars / 22 * 1000 +
1200`, and that model has no punctuation in it** - which is most of what makes
typed text read as speech rather than as a ticker. The real schedule adds 320 ms
per full stop, 150 per comma, 90 per dash. Against the true numbers line 4 did
not clear Hard at all: this document had it fitting by a tenth of a second, and
it was over by two thirds of one.

Two things came out of measuring it, and only one of them was the line:

- **A trailing full stop was being charged twice.** `PUNCT_MS` buys the beat
  that FOLLOWS a mark, and after the final character `HOLD_MS` is already that
  beat, so an end-of-line pause cost 1520 ms against an internal sentence
  break's 320. Nothing in this design ever asked for that ratio. `schedule()` no
  longer charges the last character, which is worth 0.3 to 1.0 s on every line.
- **Line 4 was simply too long**, and no constant could save it: dropping the
  full stop to 200 ms left it at 4.81 s, halving the hold at 4.77, both together
  at 4.63 - each of them flattening the other four lines to buy nothing. It was
  rewritten (section 4), and all five lines now clear Normal AND Hard.

**Size lines against `schedule()` in `ui/pacer.js`, not against the arithmetic
in this document.** `test/pacer.mjs` prints the real table on every run.

**Eligibility, in order.** A line fires when all of these hold:

1. **First entry to its room.** `spaces.roomId` (`spaces.js:632`) already answers
   this and `trackRoom()` at `:408` already fires on change.
2. **`director.state.phase === 'breather'`**, or the line is flagged
   `overFight: true`.
3. **Not a boss wave.** `director.boss` at `:1572` is non-null for the duration.
4. **The pill is not already held by a lowercase line.**

**Failing 2 or 3 DEFERS, it does not drop.** A room is entered once, so a line
dropped because the player walked in mid-wave is a line that never exists. It
waits for the next breather: a slightly wrong room and a completely correct beat.

**Line 3 is the exception and it is designed to be.** `WORLD-1.md:590` fixes
"you sound-" as mid-wave from the Great Gallery's far ledge and states that it
passes by, so it carries `overFight: true` and skips gate 2. It is the only line
the player is not meant to hear properly, and it is the pre-training for her
stopping short. **Line 5's exception is not a gate, it is a timer.** Section 4.

---

## 4. HOW A BEAT IS PACED, AND HOW TWO SPEAKERS TAKE TURNS

### The rate

`showNotice(text, ms)` takes a fixed duration from ten call sites. Her lines vary
from 10 to 70 characters. A constant is wrong at both ends.

**Derive the duration: `ms = chars / REVEAL_CPS * 1000 + HOLD_MS`,** with
`REVEAL_CPS = 22` and `HOLD_MS = 1200`. Measured against the five lines:

| # | Chars | Reveal | Total | Fits Normal 6.0s | Fits Hard 4.5s |
|---|---|---|---|---|---|
| 1 | 51 | 2.3s | 3.5s | yes, 2.5s spare | yes, 1.0s spare |
| 2 | 47 | 2.1s | 3.3s | yes | yes |
| 3 | 10 | 0.5s | 1.7s | n/a, fires over a fight | n/a |
| 4 | 70 | 3.2s | 4.4s | yes, 1.6s spare | yes, 0.1s spare |
| 5 | 55 | 2.5s | cut | see below | see below |

**Hard is the binding tier and line 4 clears it by a tenth of a second.** Too
tight to call safe, so the honest tolerance: a wave beginning under the tail of a
line is survivable, because `director.js` spawns at `SPAWN_NEAR = 13` to
`SPAWN_FAR = 55` metres, so nothing is in melee at t plus 0.5. Half a second of
overhang is fine. Four seconds is not, which is why the rate is derived at all.

22 cps is about 240 words per minute, above broadcast subtitle practice,
defensible here because these are single lines of 8 to 12 words with nothing else
in the centre of the screen. If it plays fast, it is one constant.

### The wrap, which is a rendering bug waiting to happen

`index.html:876` sets `white-space: nowrap` on `#notice`. Line 4 at 70 characters,
12px, `letter-spacing: .2em`, is roughly 680 pixels of unbreakable text on an
element at `left: 50%; transform: translateX(-50%)`: fits a 1280 window, runs off
both edges of a 720 one. Her class needs `white-space: normal`, a `max-width` near
34em, and `text-align: center`.

And `index.html:874` sets `text-transform: uppercase`. **Until that is overridden
on her class, no string passed to `showNotice` can render lowercase.** The entire
attribution scheme in `WORLD-1.md:540-560` is downstream of one declaration.

### Two speakers, no queue

**The hold, not a queue,** exactly as `WORLD-1.md:556` proposes, and for the
reason given there: a queue makes the game talk over itself several seconds
later, which is worse than dropping. Mechanically:

- `showNotice` gains an options bag: `{ voice: 'system' | 'her' | 'gate', force }`.
- A `heldUntil` timestamp and the current voice are module state.
- `voice: 'her'` takes the pill and sets `heldUntil = now + duration`.
- `voice: 'system'` arriving before `heldUntil` returns false and is gone.
- `force: true` clobbers regardless. It is passed from exactly one place.

Ten existing call sites keep working unchanged because the bag defaults to
`system`. That matters: `main.js` hands `showNotice` to ten systems at `:171`
through `:360`.

### The one interruption, and why it must be authored rather than emergent

`WORLD-1.md:600` fixes it: she starts line 5, THE KINDLING TAKES overwrites her
mid-sentence, she never speaks again.

**The reveal makes this fragile in a way the doc does not name.** If the Kindling
notice arrives whenever the third jar happens to land, she is cut at a random
character. "there's some" does not read as an interruption, it reads as a bug,
and this project has twelve confirmed instances of things that never rendered.

So line 5 carries `cutAfter: <ms>`. The jar chain fires her line and schedules the
Kindling at `cutAfter` rather than immediately, sized so she reaches the hyphen in
"since we-" and holds it about 250 ms before the capitals land. **The interruption
is composed, to the frame, in data.** Cost: 10 to 15 lines, plus a comment saying
why the delay exists so nobody deletes it as a mysterious `setTimeout`.

---

## 5. WHAT THE PLAYER CAN MISS

Three tiers, and the rule from section 1 applied to each World 1 beat.

- **Tier A, unmissable.** The death card, about twenty times a run with an
  indefinite wait on it. The objective line. The geometry. The end card, which
  the run cannot terminate without. The Serdab prompt, which needs an F press.
- **Tier B, missable but repeated.** Her five lines. The four tableaus, which
  fire on a mandatory pickup and hold the frame, so they are near Tier A, but a
  distracted player can look away.
- **Tier C, missable and once.** Her lamp standing still while the horde flows
  past. The flare on Set's corpse. The objective panel's one silent beat.

**Every load-bearing plot fact tests clean:**

| Fact | Carried by | Tier |
|---|---|---|
| Something is resurrecting him and it disagrees with the tomb | the two words on the death card | A |
| There is a living person ahead of him | the camp gradient, the lamps, propSlots | A, geometry |
| He is not who he thinks he is | the four tableaus | B, and four chances |
| She stopped speaking | the absence, plus the transcript | B, made findable |
| The name is not hers | the end card | A |

**Nothing plot-critical is Tier C.** Tier C is where the rewards for a second run
live, which is where they belong.

### The transcript, and what it does for the dog that did not bark

**PROPOSAL, mine.** `ui/pause.js` is already tabbed: a `spec` of tab records
walked at `:1148`, each building a `pause-panel` from rows, with a `kind:
'readout'` row type already in use at `:491` and `:632`. A tab holding every line
she has spoken this run, in order, in her lowercase, is a small extension of a
shape that exists. Not a lore codex: her lines only, no commentary, unspoken
lines absent rather than greyed.

**What it buys for 60 to 90 lines.** `WORLD-1.md:523` requires the beat to be
findable on a replay, "a second-run player should be able to name the exact
moment", which otherwise means memorising five pills over forty minutes. With the
tab, a player who opens it on wave 22 sees five entries where they expected more,
and the fifth ends in "since we-". **The game has still said nothing.** The
absence is exposed by an inventory rather than announced by a notice, which is
the only way to make it findable without pointing at it. Owner's call, decision 4.

---

## 6. THE FLASHBACKS

### The recommendation, evaluated rather than assumed

The prior lane's held-tableau recommendation at 190 to 240 lines is **correct and
priced against the right implementation, but it does not say WHICH
implementation, and one of the two available readings does not work.**

**Reading that fails: silhouettes placed in the live scene.** Seven black meshes
in front of the player, curtain up, hold. This needs the player's camera pointed
at them, which means either moving the rig, the cut scene the approach exists to
avoid, or spawning the tableau wherever the player happens to be facing, which is
worse: geometry inside the room's colliders at an arbitrary angle, wearing the
room's lighting, fog and grade.

**Reading that works, and is the one to build: a second scene, rendered around
the composer.** A private `THREE.Scene` with its own `PerspectiveCamera`, seven
`MeshBasicMaterial` boxes at black and one lit plane for the doorway, drawn with
`renderer.render(fbScene, fbCamera)` straight to the canvas while the curtain sits
at full black underneath covering the swap in and out. **The player rig is never
read, never written, never moved.** The composer is never reconfigured.

Feasibility, checked in the tree:

- `main.js:1597` is the single draw call, `post.composer.render(dt)`. A branch
  before it is the whole integration.
- The simulation halt has a proven shape: `main.js:1352` documents the death gate
  as "a second and narrower kind of stopped", where the world draws and the sim
  does not advance. The tableau is a third instance of a shipped pattern.
- The `renderer.autoClear` hazard of drawing a second scene is already solved and
  documented at `post.js:56-75` for the viewmodel pass. A precedent to copy
  rather than a trap to discover.

**What it cannot do, stated so it is a choice.** Bypassing the composer means no
grade, no vignette, no fog, no bloom, no SMAA. Fragments will look flat and
hard-edged next to the game. **That is arguably right**, a memory should not be in
the present tense's colour space, but it has to be decided rather than discovered.
Decision 5.

**And it cannot show motion.** Fragment 4 is "he sees himself die, and that she
was there", which is a sequence. A single held frame can only be the LAST frame:
a body on the floor, a shape in a doorway. That is a writing instruction, free
today and a rebuild if it is not written down now.

**The cheap middle, offered rather than assumed:** the driver can hold TWO stills
with a hard cut between them. Not animation, not a camera path, a cut, and since
the driver already fades in and out a second still is an array index. Plus 15 to
25 lines, fragment 4 only. Decision 3.

### The price, against the alternative

| | Lines | Delivered | Risk sits in |
|---|---|---|---|
| Tableau driver, second scene | 200 to 265 | four times, in World 1 | renderer state leaking back to the composer, precedent exists |
| Per fragment after the first | 15 to 25 | | data only |
| Conventional cut scene | 300 to 450 | once, at the World 2 gate | the camera rig, which is welded to the player's head |

**Verdict: build the tableau.** Cheaper, four deliveries instead of one, risk in a
file that has already solved this class of problem once, and it ships in the world
that ships first. The World 2 gate cut scene then never has to exist, because
`NARRATIVE.md:467` is right: a player who has had all four fragments already knows.

---

## 7. AUDIO

### What the synthesis engine can do, cheaply

**The squawk.** Section 2. A new function beside `groan()` reusing `voice()`,
`osc()`, `filt()`, `gain()`, `env()`, `glide()`, registered in `SOUNDS` at
`:1729`. 45 to 70 lines.

**Speaker identity, free.** Formant centres and base pitch are numbers in a table.
Her voice and the gatekeeper's differ by two rows, not two systems.

**Room acoustics on her voice, free and already shipped.** `setSpace(name)` at
`:733` crossfades two convolvers and `spaces.js:441 applyRoomAudio(room)` already
calls it on every room change, so anything through `dryBus` and `sendBus` inherits
the room. Her squawks in the Great Gallery ring like the Great Gallery, at zero.

**Ducking the bed under a line.** `buildBed()` at `:1182` and `applyAmbience()` at
`:1237` own the ambience gains, and `setVolume` already shows the 80 ms ramp
pattern. A 3 dB dip for the length of a lowercase line is 12 to 20 lines and the
largest legibility win per line in this document.

### What it cannot do, at any price, without a loader

**Recorded voice.** No `decodeAudioData` call, no `.mp3`, `.ogg` or `.wav`
anywhere in the project, and 1,875 lines of audio engine assuming there never will
be. Priced honestly if the owner wants it anyway: fetch and decode plus a manifest
plus a preload gate plus a failure fallback is 120 to 180 lines, and that is the
small part. The real costs are the download budget on a browser game, a
localisation problem text does not have, and casting and direction, which is not
a line count at all. `WORLD-1.md:677` already stands this down, all three voices
are text. **I concur and am not reopening it.**

**Intelligible synthesised speech.** Formant synthesis at this scale produces
vowels. Consonants need an articulatory or concatenative model, which is a
library, not a function.

**Performance.** A squawk cannot act. It can say that a voice is speaking, roughly
how fast, and roughly who. Everything she IS comes from the writing, the lowercase
and the ten waves of nothing.

---

## 8. HOW IT SCALES TO WORLDS 2 AND 3

The handover is already the design: she owns the pill, he owns the card, she dies,
the pill becomes his. What the layer has to do to survive it:

**The voice parameter takes a third value.** `'gate'` gets its own class. Not
lowercase, which is hers and must stay hers or the handover is muddy. **My call:
capitals with tracking wider than the system's, and a reveal rate of about 6
characters per second against her 22, so his two-word lines take as long as her
sentences did.** Slowness is his characterisation. One class, one number.

**The announcer queue gets cheaper because the pacer shipped.** `WORLD-1.md:710`
prices a real "few words at a time" queue at 80 to 120 lines on the priority bus
and says do not build it for World 1. Agreed. But by World 2 the pacer already
holds the pill for a computed duration, which is most of a queue's job; what is
left is a FIFO and a drop policy. **50 to 70 lines on top of the World 1 pacer,
rather than 80 to 120 from nothing.** Building the pacer now is what makes the
World 2 queue affordable.

**The tableau driver is world-agnostic on day one if it takes a data record**
rather than reaching into World 1's rooms. Cost of that discipline: zero, if it is
stated before the file is written. Stated here. World 2's payoff, standing in the
room he has already seen four times, then needs no new technology.

**The end card is a data record.** Worlds 2 and 3 get their cards for a string
each, provided the module is a card renderer rather than World 1's card.

**World 3 needs no new surface.** He is met in person, the pill is already his,
and the last card's whole trick is that the two words do not arrive. **That only
works if the two words shipped in World 1 and were read thirty times**, which is
why the cheapest item here is also one of the first.

---

## 9. THE BILL

Lines of new or changed source, this project's unit.

| | Item | Class | Files | Lines |
|---|---|---|---|---|
| A | Pill pacer, hold, voice classes, wrap and uppercase fix | extension | `main.js`, `index.html` | 90 to 130 |
| B | Her line list plus the eligibility gate | new system, small | new `src/story/voice.js`; reads `spaces.roomId`, `director.state` | 90 to 140 |
| C | The authored interruption at the third jar | extension of B | `voice.js` data, one jar-chain call site | 10 to 15 |
| D | The squawk | extension | `core/audio.js` | 45 to 70 |
| E | Ambience duck under a lowercase line | extension | `core/audio.js` | 12 to 20 |
| F | The gatekeeper's two words plus the reset count | extension | `ui/death.js` only | 40 to 70 |
| G | The tableau driver, second scene | **new system** | new `src/story/tableau.js`, `main.js` loop branch | 200 to 265 |
| H | Four fragment authorings | data | `tableau.js` data | 60 to 100 |
| I | The transcript tab | extension | `ui/pause.js`, `voice.js` | 60 to 90 |
| J | The end card module | new, sibling | new `src/ui/endcard.js`, reads `ui/tokens.js` | 120 to 170 |

**Total: 730 to 1,070 lines. Two new files under a new `src/story/`, one new
file under `src/ui/`, six existing files touched.**

### Where this disagrees with WORLD-1-MAP-SCOPE.md, and why

| Map scope | There | Here | Difference |
|---|---|---|---|
| BUILD 3, her voice | 80 to 140 | A + B + C = 190 to 285 | The squawk did not exist as a requirement when BUILD 3 was written. The CSS is four declarations and a re-measure, not "one class". The authored interruption is not in BUILD 3 at all. |
| BUILD 4, fragments | 190 to 240 | G + H = 260 to 365 | Same driver estimate. The difference is counting the four authorings and the `main.js` loop branch separately rather than inside the driver. |
| BUILD 8, death card | 40 to 70 | F = 40 to 70 | Agrees exactly. |
| BUILD 6, ending | 320 to 500 across four files | J = 120 to 170 | **Overlap, not addition.** J is the card module only. The run-terminating condition, Set's farewell and the director's stop-and-face belong to BUILD 6 and are not counted here. |

Items D, E and I are new to this document and are 117 to 180 lines of the delta.

---

## 10. WHAT TO BUILD FIRST

1. **The pacer, plus the gatekeeper's two words in the same pass.** A + F, 130 to
   200 lines, two files, neither of them in the jar-chain lane. The pacer IS the
   layer: nothing spoken can be built until text can appear at a readable rate and
   hold. The card words ride along because they are 40 to 70 lines, touch only
   `ui/death.js`, and are the one story surface that reaches a player on their
   first death.
2. **The squawk and the duck.** D + E, 57 to 90 lines, one file. The owner's
   literal ask, and it lands the moment the pacer exists.
3. **Her five lines and the eligibility gate.** B + C, after the jar chain lands,
   because line 5's trigger is the third jar.
4. **The tableau driver and the four fragments.** G + H. The largest item and the
   only genuinely new technology; depends on the jar pickup verb.
5. **The end card.** J, when BUILD 6 can terminate a run.
6. **The transcript tab.** I, last: the only item whose value is entirely on a
   second playthrough.

---

## 11. DECISIONS FOR THE OWNER

**1. The reading of "squawks."** I took timed synthesised vocal blips, the
Banjo-Kazooie convention, and section 2 prices the other two.
**Recommendation: confirm.** It is the only reading that reuses the 1,875 lines
already written and the only one that composes with the read-speed pacer.

**2. Does SHE squawk, or only the gatekeeper?** The risk is real: the only throat
sound in this game is the mummy's, and it comes from the same formant bank.
**Recommendation: both, with her base an octave and a half above `groan()`'s
`rand(62, 104)` Hz floor.** Giving her silence where the gatekeeper has a voice
would say something about her the story is not ready to say yet.

**3. Fragment 4: one held still, or two with a hard cut?** A single still can only
be the last frame of his death, not the sequence.
**Recommendation: two stills, plus 15 to 25 lines, fragment 4 only.** A cut is not
a camera move, and this is the beat the other three exist to set up.

**4. The transcript tab in the pause menu.** It makes her silence findable without
the game ever pointing at it, and it is the only defence against a story told in
missable pills.
**Recommendation: build it, last.** Her lines only, no commentary, no counter.

**5. The tableau bypasses the composer, so fragments render un-graded and
un-vignetted, visibly different from the game.**
**Recommendation: keep the bypass and let the memory look different.** The
alternative is routing the tableau through the composer, which costs a pass
reconfiguration on every fragment and makes his memories the same colour as the
room he is standing in.

---

## NOT DECIDED HERE, AND WHO OWNS IT

- **Where her lamp sits in Act 3 so the horde flows past it.** Map lane, per
  `WORLD-1-MAP-SCOPE.md` beat 27.
- **The two words on the death card. DECIDED 2026-08-04, and no longer open.**
  `NOT YET / STAND UP / GO DEEPER / NOT FINISHED / MINE STILL / WALK AGAIN`,
  rotating by death count with `NOT YET` always first. The rule that settled
  them: he is NOT KIND. `NARRATIVE.md` has him standing the corpse up "because
  he needs it to reach the bottom", telling the player nothing ever, and at the
  end throwing him through the gate for being what the other power made him.
  `COME BACK` was the first pick and was cut as the only warm line in the set -
  it implies he misses the player, and that he went somewhere, which muddles
  which power owns the death loop. `GO DEEPER` is the one thing he actually
  wants. `MINE STILL` is load-bearing: a claim of possession on the most-read
  text in the game, which is what makes the ending a betrayal and not a twist.
- **The four-jar chain's API.** In flight in another lane. Items C and H attach at
  one call site each and assume nothing else about it.
