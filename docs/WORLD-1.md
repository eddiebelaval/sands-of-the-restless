# WORLD 1 - the tomb

Rewritten 2026-08-01 against `docs/story-meeting-2-2026-08-01.md`, and reconciled
with meeting 1, `MAP.md`, `STATE.md` and the shipped source.

**This document is downstream of `docs/NARRATIVE.md`**, which holds the story
told once, straight through. This is the buildable design for World 1: what is
already on screen, what has to be built, what it costs, where every beat lands,
and the brief the map lane will work from. It does not retell the plot.

> **HOW TO READ THIS.**
>
> | | |
> |---|---|
> | Plain text | transcript, owner decision, `MAP.md`, or shipped code. Cited where it is not obvious. |
> | **FIXED** | decided. Not open. |
> | **PROPOSAL** | invented by this lane. Overrule at no cost. |
> | **REVISED** | meeting 2 overturned something this document previously said. The old version is named rather than quietly replaced. |
>
> Nothing here renames anything that exists. The gods, the weapons, the rooms,
> the boons, the death card and the four sons of Horus are all used as built.

---

# WHAT MEETING 2 CHANGED IN THIS DOCUMENT

Six things. Everything else in the previous draft survives, and the amount that
survives is the argument that the reading was right.

1. **The player is not the archaeologist's hired man.** He is on the same
   government manifest she is. She did not hire him. They are colleagues.
2. **The sealed doorway is not a thing he never got through.** He came OUT
   through it, bleeding, four days ago. The first purchase in the game is going
   back into the building he died escaping.
3. **The four-jar chain is not a name being restored.** It is four dead
   colleagues being fed into a machine. The name is what he thinks he is doing.
4. **The jars carry the flashbacks**, which retires the cut scene meeting 2 asked
   for and gives World 1 the whole origin, in quarters.
5. **The Kindling is repointed rather than pulled.** Feeding the third jar in
   turns the power on. The lever goes; the fire bowl, the light ramp, the horn
   and chime, the shrines waking and the notice all stay exactly as shipped.
6. **Act 3 gets one visible fact it did not have:** the horde walking past her
   lamp, once, unremarked.

**What did NOT change, and it is most of the document:** the death loop, the four
pieces of shipped machinery already playing it, the grave at the spawn, her five
questions, the lowercase voice, the Kindling notice overwriting her mid-sentence,
the camp gradient, the Serdab as the stage, the eleventh niche as the exit, Set's
flare, and the end card.

---

# THE READING EVERYTHING ELSE HANGS OFF

**The player dies constantly and gets back up, and he is one of the raised.**

He is not learning to survive. He is failing to stay down.

> **REVISED, and this is the largest single change in the project.** The previous
> draft had ONE power doing this, and the twist was that the player was
> personally housing the spirit, which is why he kept rising, and the ending was
> that he chooses to stay down.
>
> Meeting 2 splits it in two. The spirit raised everything under the sand,
> including his corpse. **The gatekeeper, one of the Ancients, imprisoned under
> a different desert, is the one standing that corpse up after every death,
> because he has picked it and needs it.**
>
> **What survives:** he IS one of the risen, he IS part of her work, and at the
> end he goes through the gate with everything else that came through. Meeting 2
> says this outright at 31:24. **What is discarded:** the player as a vessel. He
> is not a container. He is inventory.
>
> Full argument, including the one line in meeting 2 that contradicts this and
> why to reject it, in `NARRATIVE.md` under "What stands the player up".

**World 1 says none of this and must not.** It is written here so that nobody
building World 1 accidentally spends it.

## What is already on screen

None of the following is a proposal. All of it ships today.

**The death card already says the player failed judgement and was sent back.**
`ui/death.js` puts UNWORTHY in a cartouche with THE HEART OUTWEIGHS THE FEATHER
beneath it, and the file's own comment states why: in the Hall of Two Truths a
heart that weighs too much is fed to Ammit and the name is erased. That is a
final verdict. And then he stands up. The game has been contradicting its own
death card since the card shipped.

**The player's cartouche has no name in it, because he does not remember his
name.** A cartouche is the oval a NAME is written in, and `ui/death.js` says so
in its own comment. The word inside the player's loop is UNWORTHY. That is a
verdict standing where a name should be.

**The reset rule is already the right rule.** What carries over is what he earned
with his hands - gold, weapons, Altar upgrades, ammunition, grenades, doors
bought open, the power state of the necropolis. What does not carry over is the
wave, the power-ups, and every shrine boon. Read as mechanics, a fair checkpoint.
Read as story: you keep your possessions, and the gods take their favour back
every single time.

**Every death returns him to the exact place he was first killed.** The strongest
item on the list and it was built for an unrelated reason. The owner asked for a
usability fix - spawn back at the beginning, not where I died - and it shipped in
`d689bad`. `restart()` calls `toTheBeginning()`, which puts the body at the
courtyard spawn facing the pyramid, by teleport if he died outside and through
`spaces.enter('exterior')` if he died inside, because the interior is a different
world and a written coordinate would drop him outside its bounds.

**The beginning is where he was killed.** `courtyard.js` names the spawn at
`(0, 30)` twice in its own comments. So the game does not return him to a respawn
point. It returns him to the spot, from either world, every time.

**There are already two different ways to come back and the game distinguishes
them.** The Shrine of Anubis costs 1500, forgives one death, and announces
itself: ANUBIS WEIGHS YOUR HEART AND RETURNS IT. A god, named, paid, once. Every
other return has no god, no name, no notice and no price, and it puts him outside
the door. The legitimate case is in the build as the control, which is what makes
the other case legible as an anomaly. Anubis is also the cheapest shrine in the
map and stands in the first room inside the pyramid. He is the only one still
willing to deal.

**The game already counts it.** `state.resets` in `ui/death.js`.

**The confirm button already says KEEP THE VIGIL.** A vigil is a watch kept over
the dead.

## The four, as a set

Singly, coincidences. Together, the argument that this reading is right rather
than imposed: a fail-state convention, a typographic rule, a usability complaint,
and a level-design law, built for four unrelated reasons, that between them
already stage the story.

1. **The death card judges him personally and erases him, and then he stands up.**
2. **His cartouche carries a verdict where a name should be.**
3. **`restart()` returns him to the place he died, every time**, from either
   world.
4. **The Serdab, the only room with no spawn points, is the only room where the
   twist can land without a horde arriving.**

## The first frame of the game is him standing on his own grave

He died at `(0, 30)`. The game opens there, with the one person who knows
standing near him, before a shot is fired and before the doorway is bought.

**The avenue is the walk he did not survive**, and the player repeats it every
run. `courtyard.js` already describes the avenue exactly this way: the walk from
the spawn to the doorway.

> **REVISED.** The previous draft said "the sealed doorway at 1000 gold is the
> thing he died in front of and never got through". Meeting 2 makes that wrong.
> **He came OUT through it.** He was inside, the gate opened, the spirit killed
> the team, and he ran the whole length of the building and made it into the sun
> and got about thirty units up the avenue before he bled out.
>
> The correct line is better: **the first purchase in this game is going back
> into the building he died escaping**, and it costs a thousand gold he does not
> have, so he has to earn it off the dead first.

### DO NOT MARK THE SPOT

**FIXED: nothing is placed at `(0, 30)`. Not a prop, not a stain, not a notice
line, not a change in the dressing.**

The entire design of this character is that he does not know and is never told,
and a marker is the game telling him. It would also be the one piece of set
dressing in the courtyard a first-time player would stop and look at, which is
the opposite of what the beat needs. The spot is load-bearing precisely because
it is unremarkable.

One thing is placed nearby and it was already there: `courtyard.js` puts the first
canopic jar in the west chapel he passes on the walk down from `(0, 30)`. That is
the errand. It needs no annotation.

## The two rules this must obey

**It must never be told.** No notice text, no objective line, no wall carving says
"you are one of the raised". It is inferable from the death card, from what he
keeps and loses, from where he wakes up, and from what the archaeologist does not
say.

**World 1 plants it and is complete without it.** A player who finishes World 1
and never joins the dots has a whole story: a tomb, a job, a friend, a name, and a
room at the bottom with the wrong person sitting in it.

---

# THE DESCENT, AND WHAT WORLD 1 OWES IT

## A pyramid is famous for going up

Every image anyone holds of a pyramid is a point against the sky. Going DOWN
through one is wrong before anything has happened. World 1 does not have to earn
that. It has to not spend it. Act 3 is the last floor that still looks like a tomb
should: Egyptian, knowable, gods with names and a procedure. **That belief is the
asset. World 2 spends it.**

## The inside is already bigger than the outside, and it ships today

`rooms.js` opens with this, written as an engineering note:

> "The interior is a separate cell from the courtyard rather than a literal
> cavity inside the exterior pyramid: the playable interior is far larger than
> the 62-unit stepped mass that reads well on the skyline, and no amount of
> scaling reconciles the two."

Read as engineering, a compromise. Read as story, the first symptom. Nine rooms, a
38-unit gallery and a 30-unit shaft do not fit inside the building he walked up
to, and the game has never once acknowledged it. **What is required is that
nobody ever fixes it and that no line of copy ever excuses it.**

> **Meeting 2 supplies a cause and it should not be used.** A gate leaning open
> distorting the space around it is exactly what an unexplained gravitational
> anomaly and an impossible interior both look like. Keep the cause in the world
> for consistency. Do not write the line.

## The enclosure ladder, as shipped

`rooms.js` carries a `height` per room:

```
star-shaft         30      the one gasp of height, and it points UP
great-gallery      16
kings-chamber      12
hall-of-offerings   9
embalming-chamber   8
chamber-of-ascent   7
granary-vault       7
canopic-crypt       6
serdab              5      the way down
```

**The last room of World 1 already has the lowest ceiling in the game, and nobody
put it there for this reason.** Fourteen by fourteen by five, the smallest room in
the map by a factor of two, and it is where the player leaves. The enclosure
bottoms out exactly at the exit.

So World 1 owes the trilogy three refusals rather than three builds:

1. **Do not add a room taller than the Great Gallery.** Sixteen is the ceiling of
   the ceilings.
2. **Do not give the Serdab more height.** Five is the floor.
3. **Keep the Star Shaft as the last time up is ever offered.** Thirty units of
   void aimed at the sky with a rope in it that ends at nothing. It is a false
   promise and it should stay one.

## Depth, and the owner's new instruction

> **REVISED by an owner instruction after meeting 2: "according to the story we
> go down deeper and deeper as we play, so we need a map building phase that
> connects the map with the story."**
>
> The previous recommendation was to leave the geometry horizontal and author a
> per-room `depth` number as data, on the grounds that rebuilding nine ratified
> rooms onto a vertical axis buys a number a data field buys for free. That
> recommendation is now superseded in part. See the map brief at the end of this
> document.

**The depth readout still ships and the argument for it is unchanged.** The wave
number is a scoreboard; metres below the sand is a story. `index.html`'s ammo
block already stacks two rows and states the rule in its own comment - "it sits
under the wave counter because it is the same fact at a different rate" - and a
depth row is a third fact at a third rate. The CSS already separates numerals from
labels, so it costs one span and no new styling.

**Recommendation: depth sits beside the wave counter, not instead of it**, and it
derives from the deepest room reached rather than from the wave. Depth that ticks
up while the player stands still reads as a bug before it reads as dread.

---

# THE CAST

## The spirit

**Nameless in World 1.** It is a sign chiselled into walls, not a noun. Nothing in
the UI, no notice, no wall says what it is called.

> **REVISED, and it is one of two decisions waiting on the owner.** The previous
> draft had HETEPHERES as the spirit's name, restored glyph by glyph by the jar
> chain, and the rescue of that name as the dramatic question of World 1. Meeting
> 2 kills the rescue at 11:54 and makes the antagonist "a real Egyptian god",
> which a Fourth Dynasty queen is not.
>
> **Recommendation: Hetepheres stays as the name on the struck cartouche and stops
> being a character.** She is the dead queen whose tomb this is. Restoring an
> effaced royal name is a real thing archaeologists do and it is what the
> archaeologist was down here doing. The player finishes her work and thinks that
> is the job.
>
> Full argument, and the alternative if the owner wants a literal goddess, in
> `NARRATIVE.md`.

**What this costs World 1: nothing, and it retires a problem.** The antagonist
being genuinely nameless in World 1 is what the document wanted anyway, and the
effaced cartouche now has an unambiguous meaning: it is the mark of a thing that
takes names, cut over the name of a woman who is not coming back.

## The five gods are the tomb's immune system

`boss.js` ships Anubis, Ammit, Apep, Sekhmet and Set, one per fifth wave, with
telegraphed abilities.

**PROPOSAL: they are the tomb's staff, not the antagonist's army.** They come for
him because he is a robber in a grave and because he will not stay judged. Anubis
weighs. Ammit devours the heart that fails. The death card is the verdict at the
end of that process, and he keeps walking away from it, so the tomb sends
something bigger.

> **Meeting 2 promotes this from flavour to structure.** If the Ancients are
> what got remembered as the Egyptian gods, the five bosses are the gatekeeper's
> colleagues, still at their posts, removing things that came up out of the sand.
> **Which means the ending of the trilogy is rehearsed five times in World 1 and
> the player reads it as boss fights.**

Three consequences and none of them are flavour:

1. The death card and the boss roster become one system rather than two Egyptian
   things in the same game.
2. Defeating four and finding the fifth was a puppet is not a cheat. He was never
   fighting the antagonist. He was being processed, repeatedly, by an institution
   that could not make it stick.
3. It sets up World 2, which has no judges, no rules and no procedure, and the
   player should feel the loss.

## The archaeologist

**FIXED: they were friends. She watched him die. She is looking at him.** Her
surprise is not vague. She has certain, first-hand knowledge that he is dead. She
was there.

**She is the only one in the game who knows what he is, and he does not.** That
asymmetry is the entire relationship, it requires no dialogue system, and the
player is on his side of it: they know exactly as much as he does, which is
nothing.

**She is herself when he meets her. She is taken DURING World 1**, at the machine,
and the Serdab is where he finds out rather than when it happened.

> **REVISED by meeting 2 in one particular.** She did not hire him. They are
> colleagues on the same government expedition. Everything else about her is
> unchanged, and the colleague version is stronger: she is not a client who lost
> a contractor, she is the last of seven.

**PROPOSAL: she keeps working with him because she is hoping she was wrong.** The
colder read - she needs him and is using him - is playable, but it makes her a
second manipulator in a game that already has one thing using people, and it makes
her stopping mean less. If she has been hoping, then what the possession takes is
the hope, and the silence is a bereavement the player does not know they are
watching.

### What the possession does to her: it removes a doubt

The coldest thing in the document and it is what makes the tell motivated rather
than merely clever.

Her questions are **reconciliation, not curiosity.** She is trying to square a
body she personally witnessed against a man walking around in front of her. She is
checking whether she is the one who is wrong.

**The thing that takes her already knows the answer.** It does not need to ask how
he is walking around. It is the thing that raised him.

So the possession adds no menace. **It subtracts a doubt.** Her confusion was the
last human part of her still trying to reconcile what she saw, and when that goes,
nothing appears in its place. That is why the tell is an absence.

### The objective panel does not change hands visibly

`ui/objective.js` has been naming the next thing to do since the first frame,
derived from the live map, always true, never a script. For the first half of
World 1 it is her, genuinely helping her friend. After she is taken it is the
thing wearing her, and **the panel is identical either side.**

That is the difference between a twist and a cheat: **the game never lies. The
source of the instructions changes and the instructions do not.** Every price,
every route, every count stays accurate, because the panel is derived from real
state and could not lie if it wanted to.

And it disarms the Embalming Chamber notebook, which an earlier draft had as a
trap. **The four niches are chalk-numbered in the wrong order because she tried
the chain and got it wrong.** She is an archaeologist doing her job badly under
pressure, in the dark, with something killing her crew. There is nothing sinister
in that room. That is what makes it hers.

**PROPOSAL: unnamed, and she has no body until the Serdab.** For twenty-five waves
she is a lamp ahead in the dark and a voice, and the Serdab is the first time she
has a form at all, which is also the first look the player gets at what she has
become.

## The player

**FIXED by meeting 2: he is one of the seven the government sent in.** A
scientist or an archaeologist on the same manifest as his friend, dispatched under
cover of discovery as a test subject.

> **REVISED.** The previous draft proposed he was her hired man - a looter or a
> freelance hand - and argued it from the game's economy. **Meeting 2 supersedes
> the identity and the arguments survive intact, aimed at a better target:**
>
> - **The economy is a looter's economy**, and a man with no memory strips a tomb
>   for gold because he has no idea he used to be the kind of person who would
>   not. That is worse than a looter looting, which is the point.
> - **The death card judges him personally.** UNWORTHY only lands on somebody who
>   could plausibly be found wanting, and the tomb is not wrong.
> - **He starts the run holding grave gold and has never been inside.**
>   Difficulty hands out 750, 500 or 400 gold on the first frame. Nobody put that
>   there for story reasons and it is there.
>
> Rejected, and still rejected: a soldier or mercenary escort, which explains the
> guns and nothing else. A descendant or a chosen one, which the tomb calling him
> UNWORTHY contradicts.

**PROPOSAL: he is never named and never speaks.** The first identity he gets is
his own face on the box art at the end of World 3. That is a better first look at
yourself than a name on a HUD, and it is the only name a man with an empty
cartouche is ever going to get.

**He never answers her, and this is the sharpest thing available.** The player has
no voice. To the player that is a genre convention so ordinary it is invisible. To
her it is fifteen waves of calling to someone who will not say anything back.
**The player's silence is a UI limitation to the player and a symptom to her.**

---

# THE MAP IS THE ACT STRUCTURE

`MAP.md` ratifies three acts, three loops. World 1 uses them as written. Wave
numbers are design intent; the economy paces the actual crossing.

| Act | Waves | Rooms | Boss | What the act is FOR |
|---|---|---|---|---|
| 1 | 1 - 5 | avenue, Quarry, Canal, **the camp** | **ANUBIS** (5) | you are a robber, the tomb has noticed, and people were here |
| 2 | 6 - 15 | Chamber of Ascent, Hall of Offerings, Granary Vault, Great Gallery | **AMMIT** (10), **APEP** (15) | somebody else has been down here, recently |
| 3 | 16 - 25 | Embalming Chamber, Canopic Crypt, Star Shaft, King's Chamber, Serdab | **SEKHMET** (20), **SET** (25) | feed the machine, then find the niche empty |

**World 1 runs twenty-five waves and ends.** Five boss waves, one per god, no
cycling.

## Why each god is where it is

None of these are moves. Every one is the god the cycle already puts on that wave,
in the room the map already puts the player in.

**ANUBIS, wave 5, the avenue and the Act 1 circuit.** Opener of the ways,
conductor of the dead; abilities `summon` and `charge`. The first boss in the game
raises more of them in front of you, which is the world's thesis in one fight.
Fought outside, in a straight corridor with bought pockets, which is the hardest
ground in Act 1 and is meant to be.

**AMMIT, wave 10, the Great Gallery.** Ammit eats the heart that fails the
weighing, and by wave 10 the player has almost certainly read THE HEART OUTWEIGHS
THE FEATHER. Wave 10 shows them what has been failing to finish the job. It
happens in the biggest room in the map, under sixteen units of ceiling, on the
two-loop floor, the only room that can hold `slam` and `volley` at once.

**APEP, wave 15, the Star Shaft.** Serpent of the outer dark that swallows the
sun, fought at the bottom of thirty units of vertical void aimed at the stars.
Apep teleports and volleys, the only ability pair that uses vertical space. Nobody
placed this on purpose.

**SEKHMET, wave 20, the King's Chamber.** The lioness sent to slaughter mankind
and stopped only by a trick. Charges and slams, 9600 health, fastest god in the
roster. The largest room in the map, and since the two portals landed it is a room
you can circle. On Hard it is not, until 1250 is paid.

**SET, wave 25, the King's Chamber. The final boss of World 1.** The usurper who
murdered his brother and took his place. `boss.js` describes his crown in its own
comment as "the animal nobody has ever identified... exactly why it reads as WRONG
rather than as any animal the player can name". A god whose own shape is not
identifiable is the correct vessel for a thing that wears other people. He is also
the only escalating boss, unlocking one more tell per quarter of health.

---

# WHERE THE STORY IS TOLD

No cutscenes, no dialogue system. A beat that needs either is a beat that will not
ship. The complete list of channels that exist today:

| Channel | File | Good for |
|---|---|---|
| **The objective line** | `ui/objective.js` | the spine. One line, derived from the live map, never a script. It is also her instructions, and it does not have to change for that to be true. |
| **The notice pill** | `main.js` `showNotice(text, ms)` | events. Already carries THE KINDLING TAKES - THE PYRAMID WAKES. |
| **The death card** | `ui/death.js` | the theme, as a verdict, delivered on average twenty times a run. The most-read text in the game, **and now the gatekeeper's only surface.** |
| **The prompt bus** | `ui/prompt.js` | one line under the crosshair, priority-arbitrated, with a refusal reason when a thing is not for sale at any price. |
| **The shrine boons** | `systems/shrines.js` | six named gods and what each grants. Buying one is choosing a patron; dying loses all of them. |
| **The canopic jar chain** | `rooms.js`, `doors.js` | four jars, four niches, one gate. UNBUILT, and the largest available surface. |
| **The geometry** | `rooms.js` propSlots, `world/build.js` | everything else, which is almost all of it. |
| **The boss telegraph** | `boss.js` `setGlow()` | an emissive ramp the player is trained to read as "something is coming and you cannot stop it". |

Six rules govern every beat below.

1. **The objective line is the narrator, and it is derived rather than scripted.**
   Story enters it as milestones with a `done()` reading real state, exactly like
   the rungs already there. Bolting a script on breaks the one property the file
   was built for.
2. **The notice pill is HER voice.** One line, a few seconds, no queue. Used for
   turns, never for exposition.
3. **The death card is the GATEKEEPER's voice**, and the two never share a
   surface. That is the mechanical statement that they are different powers.
4. **The geometry carries everything the text channels cannot.**
5. **The telegraph glow is a loaded gun.** Twenty-five waves teach the player that
   a gold ramp means something is about to happen to them. It is used exactly once
   on something that is not a boss, and that is the twist.
6. **Nothing is told twice, and the central idea is never told once.**

---

# SHE ASKS, AND THEN SHE STOPS

The device: she asks the same impossible question five times in five ways, and
then she is taken, and **nothing appears - something is subtracted.** The dog that
did not bark, running inside a wave shooter.

Three things have to be true or it collapses:

1. **She has to ask enough times, in a recognisable shape, that the silence is
   loud.** Two is not a pattern. Five is.
2. **The player is never told it happened.** No notice saying she seems different.
3. **It has to be findable on a replay.** A second-run player should be able to
   name the exact moment.

## How she speaks at all

**The load-bearing question. If she cannot speak, the beat collapses.**

`showNotice(text, ms)` is seven lines. It writes `notice.textContent`, adds a
class, clears one timer and sets another. It is handed to ten systems. Three
problems, verified, and they are real:

| Problem | Why it matters |
|---|---|
| **No queue.** A second call overwrites the first mid-sentence, instantly, with no transition at all - the CSS transition is on the `on` class only, so an overwrite while already on is a hard swap. | The player buys things constantly. "Need 400 more gold" would eat her. |
| **No attribution.** A line in that pill has no speaker. | Her voice would read as a system message. |
| **Wrong register.** The pill is terse, systemic, and in capitals. | So is every other string in the game. |

**PROPOSAL, and it solves all three with one property: she is the only lowercase
text in the game.**

Everything in this interface is capitals. THE KINDLING TAKES - THE PYRAMID WAKES.
ANUBIS WEIGHS YOUR HEART AND RETURNS IT. BUY THE SEALED DOORWAY. UNWORTHY. N OF 4
SONS RETURNED. Boon names go through `.toUpperCase()`. There is not one lowercase
character on the HUD.

So she gets lowercase, in the same pill, in the same place. No new element, no new
position, no new vocabulary the player has to be taught. **The shape of the text is
the attribution.** `ui/tokens.js` already establishes that this interface signals
category through treatment rather than words - the objective panel takes a lapis
inlay for gates gold cannot buy, described in its own comment as "the one signal
on the HUD a player can read without reading it". Lowercase is the same move in a
channel nobody has used.

**Collision is fixed with a hold, not a queue.** Her lines cannot be clobbered; a
system notice arriving during one is dropped rather than deferred. A queue would
make the game talk over itself several seconds later, which is worse. Cost: one
boolean and one timestamp.

**There is exactly one exception to the hold and it is the whole point.**

## Where she is, and why he never answers

**She is ahead, in the dark, with a lamp.** She is never a body in World 1. The
player sees a lamp at distance in the rooms with real sightlines - the avenue, the
Hall of Offerings down the colonnade aisle, the Great Gallery from the floor to
the far ledge, the Star Shaft looking up - and she calls back. She can see him
well enough to be certain it is him. He never gets a good look at her.

**PROPOSAL: this also retires the camp gradient's biggest weakness.** The lamps
that get warmer as the player descends are not traces she left. They are her, just
ahead. The player has been following a living person the whole time and reading it
as archaeology.

## What she is actually asking

Never "how are you alive". She asks around it, the way a person does when the
direct question is unaskable, and every one of them is her checking whether she is
the one who is wrong.

| # | Where | The line | First run | On replay |
|---|---|---|---|---|
| 1 | the avenue, on the walk from `(0, 30)` | "i keep thinking you were further back. that walk in." | small talk under stress | she is describing the order they walked in when he was killed, and asking him to tell her she has it wrong |
| 2 | Chamber of Ascent, just inside | "how many of us came in. i keep getting it wrong." | counting the crew | she counts the living and gets a number that includes him |
| 3 | **Great Gallery, mid-wave, from the far ledge** | "you sound-" | a bad line, a loud room | she almost has it, and stops herself |
| 4 | Canopic Crypt, Act 3 | "did anything happen down there. anything you'd want to tell me." | are you hurt | she is holding the door open for him to say it, and he cannot |
| 5 | Embalming Chamber, at the machine | "there's something i've been meaning to ask you since we-" | interrupted | the last thing she ever says |

Line 3 is the owner's "very intense scene": the biggest room in the map, sixteen
units of ceiling, two ledges and a bridge, and it is where the player is most
likely to be fighting for their life while a woman six metres up says half a
sentence about them. **It passes by.** It is also a removal inside the pattern,
which pre-trains the player on her stopping short without them knowing.

**Boss waves suppress her.** Her lines defer to the next eligible room entry
rather than firing into a boss fight. Two-line guard, and it protects the pattern
from being spent on the one wave nobody will hear it.

## Where she stops

**FIXED: at the machine, on the third jar, overwritten mid-sentence by the power
notice.**

She starts line 5. THE KINDLING TAKES - THE PYRAMID WAKES overwrites it, exactly
as `showNotice` has done to everything since the day it shipped, in a frame where
nine rooms are coming up and two sounds are landing and six shrines are waking and
the player is looking at literally anything else.

**And she never speaks again.**

The player has been trained for fifteen waves that her lines always finish,
because they hold. The one time a line is cut off is the last one. That is the
same "trained expectation, violated once" device the Serdab reveal uses on the
telegraph glow, which makes it the game's design language rather than a one-off
trick.

> **REVISED in trigger only, and it survives intact.** The previous draft fired
> this on a lever pull in the Embalming Chamber. Meeting 2 asks for the jars to
> turn the power on instead. **The beat is unchanged because the notice is
> unchanged** - it fires on the third jar landing in its niche rather than on a
> lever, in the same room, with the same nine-room light ramp and the same two
> sounds behind it.
>
> It is arguably better. The game erases her in the same frame the machine starts
> running on her friends.

**Ten waves of silence follow**, waves roughly 16 to 25, all of Act 3. She is
still seen. The lamps still move ahead. The rope in the Star Shaft still gets
rigged. **Nothing visibly changes** - with one exception, below. The dog is still
in the room.

Alternatives considered and rejected:

| Moment | Rejected because |
|---|---|
| First use of the Altar of Ptah | optional. Not every run does it, and the beat must be on the mandatory spine. |
| A boss wave | bosses recur every fifth wave; no unique landmark to name on a replay. |
| Entering the pyramid | too early. She has only asked once by then. |
| Buying into Act 3 | there are three gallery gates and the player picks. Not a single moment. |

The machine wins on every axis: mandatory, unique, once, loudest, and it already
holds the microphone.

## The one visible thing in Act 3

**PROPOSAL, mine, and it fixes a timeline problem meeting 2 created.**

Once, after the machine runs, down a long sightline: **her lamp is standing still
and the horde is flowing around it.** Not away from it and not toward it. Past it,
the way water goes past a rock, while the player is fighting for his life in the
foreground.

Meeting 2 puts this tell in World 2 and has Speaker 1 land the line that makes it
work - "and they always have. But you just never thought about it." That claim is
only true if the player could have seen it earlier, and as designed she is never in
the same frame as the horde, so a replaying player has nothing to find.

**What it costs:** her lamp is already a proposed prop, actors already path, and
the requirement is that the lamp sits somewhere actors path past during a wave.
Near free.

**What it must not do:** be pointed at. No notice, no objective line, no camera
help, no slowdown. It is one thing happening at the edge of a fight.

## What the voice costs, in total

- A one-shot voice list: `{ room, line }`, fired on first entry, suppressed during
  boss waves. `spaces.roomId` and the objective panel's own room helper already
  answer "which room is the player in". Small.
- Lowercase styling on the notice pill: one class.
- The priority hold: one boolean, one timestamp, one deliberate exception.
- Her lamp at distance in four rooms plus one Act 3 placement: propSlots.
- **No dialogue system, no cutscene, no voice audio, no new UI element, no new
  position on screen.**

**Voice audio is not on the table and should not be costed.** The audio engine is
1,875 lines of synthesised WebAudio with no sample-playback path at all - no
decode, no mp3, no ogg, no wav anywhere in the project. All three voices in this
trilogy are text.

---

# THE GATEKEEPER'S TWO WORDS

**PROPOSAL, mine, and it is the cheapest strong beat available in the project.**

`ui/death.js` already stops the world, draws a cartouche with UNWORTHY in it and
THE HEART OUTWEIGHS THE FEATHER beneath, holds a beat, and arms a button that
waits indefinitely. That is a verdict being passed, on average twenty times a run,
and it is the most-read text in the game.

**Two or three words underneath it, in a different treatment, disagreeing with the
verdict.** Never a sentence. Never an explanation. The tomb says UNWORTHY and
something else says otherwise, in two words, every single time, and then he stands
up.

Cost: one span, one string table, and the card is already built.

What it buys, for that:

- **The loop acquires an owner the player can feel from the first death**, without
  one line of exposition and without the game ever saying there are two powers.
- **The two voices get separate surfaces.** She owns the pill. He owns the card.
  They never meet, and when she dies in World 2 the pill becomes his, which is the
  only announcement the handover needs.
- **The ending is set up thirty deaths in advance.** The last time that card
  appears, on the far side of a shut gate, the two words do not arrive.

> **Do not build an in-run announcer queue for World 1.** There is no queue
> anywhere in the UI - every text channel is last-write-wins or
> highest-priority-wins - and a real "few words at a time" queue is roughly 80 to
> 120 lines on top of the existing priority bus. Build it in World 2, when she is
> dead and the pill is free.

---

# THE CAMP GETS WARMER

The whole staging of the twist, done entirely in `propSlots`.

The player has to arrive at the Serdab already knowing a living person is down
here, without a line of text saying so. Her kit is scattered through the map in a
gradient, and the gradient is **temperature**.

- **Act 1.** Sun-bleached. Rope frayed, chalk washed out, a survey peg leaning
  over. Weeks old.
- **Act 2.** Crisp. Chalk sharp, numbers legible, a lamp with no flame in it. Days
  old.
- **Act 3.** Warm. A lamp still burning in the Canopic Crypt. Hours, or none.
- **The King's Chamber has nothing modern in it at all.** The trail stops at the
  door of the boss arena. Whoever left it either never went in or never came out.

| Room | What is there | Reads as |
|---|---|---|
| Courtyard, the camp | **NEW.** Tents, crates, a generator still running, an instrument array still logging | seven people came here on purpose with equipment and are not here |
| Courtyard, west chapel | jar 1 (already placed), a coil of survey line, peg 01, bleached | somebody catalogued this and left |
| Courtyard, the doorway | the first **effaced cartouche**, chiselled, with fresh chalk survey marks around it | somebody has been erasing names, and recently |
| Chamber of Ascent | folding stool, cold lamp, chalk arrows pointing at BOTH debris doors | they mapped it and could not decide either |
| Hall of Offerings | the ten colonnade columns chalk-numbered 01 to 10 | a survey, done properly |
| Granary Vault | an empty stand with a chalk outline round where a jar used to be | `MAP.md` moved jar 1 outside. The outline is the diegetic reason, and it turns a data move into a beat for free |
| Great Gallery | rope strung as a handline along both ledges and across the bridge | somebody rigged this room to be walked safely, so they expected to come back |
| Embalming Chamber | a notebook open on the offering table, chalk numbers 1 to 4 above the four niches **in the wrong order** | they tried the chain and got it wrong |
| Canopic Crypt | a lamp, lit | they are here now |
| Star Shaft | a rope going up into the dark that ends at nothing | they went looking upward and it did not help |
| King's Chamber | nothing | the trail stops |
| Serdab | the stool, the lamp, the notebook | this is where they have been sitting |

**PROPOSAL: six new propSlot types.** `lamp`, `stool`, `peg`, `chalk`, `rope`,
`notebook`. All boxes and cylinders. `rooms.js` is pure data and `build.js` is the
only module allowed to turn a record into a mesh, so this is additive in the shape
the file was designed for.

Rejected: audio logs, readable journals, found footage. All three are a dialogue
system in a costume. Rejected: making the traces collectibles with a counter. The
gradient works because the player is not counting.

---

# THE FOUR JARS

> **REVISED. This is the biggest content change meeting 2 makes to World 1.**
>
> The previous draft had the chain restoring the spirit's name glyph by glyph, and
> the four jars were an errand whose purpose was the name. Meeting 2 solves them
> outright: **"The jars are the souls of the scientists." / "We consume the jars
> to give us the knowledge." / "Do we put it in a machine?" / "Absolutely."**
>
> The name survives as the cover story. The souls are the truth. Neither is
> revealed as a trick, because the game never claims either.

## What they are

Four dead colleagues, in four jars stoppered with the heads of the four sons of
Horus, standing in four rooms because that is where this building puts them.

| Jar | Son | Where it stands today | Guardian goddess |
|---|---|---|---|
| 1 | Imsety, human-headed, the liver | courtyard, west chapel | Isis |
| 2 | Hapy, baboon, the lungs | Star Shaft | Nephthys |
| 3 | Duamutef, jackal, the stomach | Canopic Crypt | Neith |
| 4 | Qebehsenuef, falcon, the intestines | King's Chamber | Serqet |

Four niches wait in the Embalming Chamber, one per son, order irrelevant. The
Serdab portal is `kind: 'puzzle'`, `cost: 0`, and `ui/objective.js` already prints
`N OF 4 SONS RETURNED` as its detail line rather than a price, because a gate gold
cannot buy is not a price.

## What each one does

**Taking a jar gives him a fragment of what that person saw.** Four fragments,
four dead people's positions, in the order the map hands them over rather than the
order they happened.

| Jar | Where | The fragment |
|---|---|---|
| 1 | courtyard, before he is even inside | seven black shapes in a stone room, doing something to a door. No faces, no sound he can place |
| 2 | Star Shaft | the same room, and now there is growth on the wall behind them in a colour that is not a colour, and one shape is standing much too close to the door |
| 3 | Canopic Crypt | the shapes are being killed, and one of them is him, and the perspective is wrong because he is watching from where she was hiding |
| 4 | King's Chamber | he sees himself die. Not how. Just that he did, and that she was there |

> **This is what retires the cut scene**, and the pricing is in `WORLDS.md` under
> "The flashbacks, priced". The short version: a cut scene at the gate costs one
> new module of 300 to 450 lines and its load-bearing risk is the camera rig,
> which is welded to the player's head. Four held tableaus with a camera that never
> moves cost roughly 190 to 240 lines and buy the same content four times over, in
> the world that ships first.

## What the fourth one does

**Fourth jar home, the struck cartouche in the Serdab becomes readable, and the
door opens.**

The reward for the puzzle is a WORD ON A WALL, the cheapest art asset in the
project. The existing objective line becomes the story's progress bar with no code
change: `2 OF 4 SONS RETURNED` already means "you are halfway".

Rejected, and still rejected: the jars restoring health, gold or a weapon. The
Sunspear is already the Serdab's reward and the shrine cap already lifts from 4 to
6. Those stay. What the chain gains is a MEANING, not a second prize.

## PROPOSAL: three jars run the machine, the fourth opens the room

**Three of four charges it. The fourth completes the cartouche and unseals the
Serdab.**

Three reasons, and the first is a hard engineering one.

1. **Jar 4 is in the King's Chamber, and one of the two doors into the King's
   Chamber is the power gate.** On Normal there is a second, free door from the
   Embalming Chamber, so four-jars-then-power is not strictly circular. On Hard
   that free door is 1250 of debris, so a player who has not paid it needs power
   to reach the jar that would give him power. Three-then-one removes the
   dependency entirely instead of relying on the player having paid.
2. **It paces the silence correctly.** Line 5 is cut off on jar 3, which lands
   around the Act 2 to Act 3 seam, and the ten waves of silence run through the
   King's Chamber, Sekhmet, jar 4, Set and the Serdab. Four-jars-then-everything
   compresses the whole of Act 3 into one moment.
3. **It makes the fourth jar the one that matters.** It is the only one that is
   both the last fragment and the thing that opens the door.

---

# THE KINDLING: THE RECOMMENDATION, AND WHAT IT COSTS

Speaker 2, at 15:05: "Now we're copying too much of [Call of Duty] Zombies."
Speaker 1: "That's coded in now, so we would have to change it." Speaker 2: "We'd
have to rewrite it. We have to somehow turn on the power, maybe with those jars."

**Unresolved in the room. Here is the cost and the call.**

## What Speaker 2 was actually objecting to

**The chain, not the object.** Read the exchange in order: Speaker 1 describes
power, then perks, then pack-a-punch, and Speaker 2 says that is too much Zombies.
Eighteen seconds later Speaker 2 supplies the replacement himself: per-world
enchantments instead of perks.

**So the divergence he asked for is already paid for elsewhere.** The Kindling
does not have to die for it.

## What the power system actually is, verified

- `systems/power.js` is 166 lines of which about 45 are executable. It is almost
  entirely a documented seam.
- It holds three fields: `powered`, `refused`, `thrownAt`.
- It does not own the lights. Its own comment states the split: this file decides
  WHEN, `world/build.js` decides WHAT.
- On the throw it does four things: sets the flag, fires a boss horn then a shrine
  chime 260 ms later, fires the notice, and calls its listeners.
- **It gates six shrines and exactly one door.** Not the Altar, not the mystery
  box, not the wall buys, not the other ten doors. All verified by signature.
- **Its public API has seven members and only two of them name a lever.**
- And `power.js` says this about itself, in its own comment: **it exists "for the
  harness and for the day the puzzle chain wants to light the map from somewhere
  else."**

**The code anticipated this exact change and left the door open.**

## The three options, priced

**Option A: rewrite the power system.** The naive reading of the room.
Approximately 15 source files touched, 630 to 780 lines written or rewritten, four
existing test harnesses rewritten plus one new one at 400 to 800 lines, and seven
golden screenshots regenerated. **Not recommended, and most of that number is not
even the Kindling.**

**Option B: build the jar system and retire the Kindling fixture entirely.** The
jar system is roughly 250 to 400 new lines plus a new test harness, and **it has
to be built regardless** - the Serdab is currently unreachable because the jar
counter is hardcoded to zero and never written, and World 1's ending is gated on
that room. On top of that already-committed work, retiring the fixture costs
roughly 215 source lines across five files, four test harnesses, and seven golden
images.

**Option C, RECOMMENDED: repoint it. Keep the system, keep the fixture, move the
trigger.**

| What happens to it | Cost |
|---|---|
| `systems/power.js` | **Untouched.** Its API is preserved verbatim, so the six shrines, all six shrine light ramps, the brazier lift and the door enforcement stay out of the diff. The jar system calls the existing `throwSwitch()`. | 0 |
| The fire bowl in the Embalming Chamber | **Stays as scenery and still lights.** It is a granite housing, a gold bowl, an ember sphere and a point light that goes from zero to full. It just stops being a thing you pull. Keeping the mesh saves the fixture, saves its golden screenshot, and keeps the light | ~10 |
| The lever's interactability | Deleted from `doors.js` - the switch record and the F-key branch | ~45 removed |
| The objective step | The rung already exists with `done: () => power.powered`. Its text changes from LIGHT THE KINDLING to a jar-derived line | ~15 |
| The minimap | The flame glyph moves off the lever slot and onto the niches; jar and niche markers are wanted anyway | ~35 |
| `rooms.js` | The `power` interactSlot retires | ~7 |
| Tests | Two harnesses touched lightly rather than four rewritten | ~40 |
| Golden screenshots | Two or three rather than seven, because the visual states survive | - |

**Roughly 150 lines across five files, over and above work that has to happen
anyway.** Against 630 to 780 for Option A.

## And the story reason is stronger than the cost reason

**Meeting 2's own words are satisfied literally.** "We feed them into something
that turns that thing on." That is what this is. The machine is the four niches
and what it runs on is his team.

**Turning on the power stops being a walk-to-the-switch errand**, which is the
specific thing that reads as Zombies, and becomes the payoff of the game's only
puzzle chain.

**And it keeps the best beat in World 1.** The Kindling notice overwriting her
mid-sentence is the single strongest device in the project. It survives untouched
because the notice is untouched. It fires on the third jar instead of a lever, in
the same room, in the same frame as the same nine-room light ramp and the same two
sounds.

> **QUESTION FOR THE OWNER, and it is one of two waiting: take Option C?**
> **Recommendation: yes.** It gives Speaker 2 the thing he asked for, keeps every
> line of a tested and screenshotted system, costs about a fifth of the
> alternative, and the beat that would otherwise have to be redesigned does not
> move.

---

# THE SERDAB IS THE STAGE

The observation the ending rests on, and it is architectural rather than literary.

```
serdab   1 portal   0 spawns   196 units   height 5   the smallest room in the map
```

`rooms.js` gives the Serdab **no spawn points at all**, deliberately, and says
why: the trainability law binds rooms that spawn things, so the honest fix for a
one-door reward closet is to stop it spawning rather than write an exemption.

The consequence nobody had written down: **the Serdab is the only room in this
game where the player can be alone.** Every other space in twenty-five waves has a
horde in it or a horde arriving. There is exactly one room where a beat can be
delivered without something walking up behind the player, and it is already built,
already gated behind the four-jar chain, and already sized like a chapel.

That is where the twist happens. Not because it is thematic. **Because it is the
only room that can hold it.**

## And a serdab is where the soul is kept

In a real Egyptian tomb the serdab is a sealed chamber holding the ka-statue, with
eye-slots cut through the wall so the statue can look out into the chapel. **It is
the room where the soul lives.** The body is in the burial chamber. The serdab is
somewhere else, on purpose.

`rooms.js` says its payoff is "authored by the puzzle chain, which lands with the
rest of M5". It is empty of purpose and it is waiting.

> **And the rhyme is free.** In World 3 the gatekeeper is found in a chamber built
> to hold him with people looking in at him, which is a serdab with a government
> budget. The player will have stood in the small version at the bottom of World
> 1. Nothing should point at it.

## The eleventh niche is the way down

**PROPOSAL: ten rock-cut figures of the same woman, shoulder to shoulder along the
back wall, and an eleventh niche cut into the side wall on its own, empty.** Ten is
the count in the real Hetepheres serdab at Giza and shoulder to shoulder is how the
real one reads. The eleventh stands apart rather than at the end of the row, so it
reads as an omission rather than as a gap somebody has not filled.

**Cost, verified: the Serdab currently has five propSlots and one of them is a
single statue.** Ten figures plus one empty recess is new prop work, and it is the
room's entire art budget.

Three exit candidates were checked against `rooms.js`:

| Candidate | Verdict |
|---|---|
| **King's Chamber** | REJECTED. The deepest room in Z, the largest in the map, and the boss arena. `MAP.md` ratified that it wants floor rather than furniture. Putting the world's exit in the room where the final fight happens means crossing it repeatedly during that fight. It also holds the sarcophagus, which is the BODY's room, and the whole twist is that the body is not what anyone is looking for. |
| **Star Shaft** | REJECTED. Thirty units of void with the columns deliberately truncated so the emptiness above is what the room is about. It is the one room already built around vertical space and it points the wrong way. The rope in it that goes up into the dark and ends at nothing is already doing the job of telling the player that up is not the answer. |
| **Serdab** | **YES.** |

**The way down is the eleventh niche itself.** A person-sized recess cut into
stone with nothing in it. After the beat it is not a niche, it is a shaft. The
player enters World 2 by climbing into the space where she should have been.

Rejected: a trapdoor, a collapsing floor, or a stair revealed behind a statue. All
three are a second object doing a job the first object can do, and all three
announce themselves as a mechanism. The niche announces nothing.

> **PROPOSAL, mine, and it plants World 2 for free: there is a patch of the other
> realm's growth in the niche**, the wrong colour, and he climbs past it without
> registering it. The first thing World 2 does is explain something the player
> already saw.

---

# THE BOSS ENCOUNTER: SET, AND HOW "IT GOES AWAY" READS

The transcript: "it doesn't really die, it just goes away because it raises the
dead again."

`boss.js` has one death sequence shared by all five gods: `deathT` ramps, the body
topples ninety degrees on an axis derived from the killing shot,
`setGlow(max(0, 1 - deathT * 0.6))` fades the gilding out, and after 1.9 seconds
the body sinks through the floor while it scales to half.

**PROPOSAL: Set gets a variant of that death and nothing else in the fight
changes.** Four beats, all reusing channels that exist.

1. **The topple runs exactly as built.** The player gets the kill they earned.
   Whatever they did, it worked on the body.
2. **The eye emissive goes to zero first.** The face is out before anything else
   happens. The god is finished.
3. **Then the gilding flares.** The accent emissive to full for about a third of a
   second, brighter than any telegraph in the game, on a corpse. Then out. The
   read is precise and it is not a ghost: **the thing lighting up is the METAL,
   not the god.** Something left through the ornament.
4. **On the flare frame, every live actor in the room stops and turns to face the
   Serdab door.** One second. Not an attack, a re-aim. Then they come back at the
   player as if nothing happened.

Two absences sell it:

- **No gold.** Every other boss pays. This one does not.
- **The objective panel does not advance.** It has named the next thing to do
  continuously since the first frame. After Set falls it holds, for a beat, on
  nothing. A panel that has never been silent going silent is the loudest thing
  this interface can do, and it costs a null return.

Rejected: a wisp flying out of the corpse. It needs a particle system the game
does not have, and it tells the player what happened where the flare and the
turned heads make them work it out. Rejected: Set standing back up for a second
phase, which reads as a fight, and the entire point is that the fight is over and
it did not matter.

**And the player has seen this before, from the inside.** Something that is
killed, goes out, and comes back is the shape of every death card they have read
this run. World 1 never draws the line. The line is there.

---

# THE MARIO TWIST, STAGED

**PROPOSAL: the player does not FIND the archaeologist. The player is
delivered.** Everything in World 1 was a job: open the doors, clear the gates,
carry the four jars, run the machine, and bring the result down to the one room
she could not open. The notebook has the niches numbered wrong. She tried and
failed, and something arranged for a man who could keep failing until he
succeeded.

The staging, in order.

**Before wave 25, if the player solved the chain early.** The jars go home, the
cartouche completes, the Serdab opens, and the player walks into a small room with
ten carved women, one empty niche, and a folding stool with a lamp beside it.
Nobody there. They take the Sunspear and leave.

That early visit is not a spoiler; it is the setup. Returning to a room you have
already stood in and finding somebody sitting in it is stronger than opening a
door onto a stranger.

**Set falls.** The flare, the turned heads, the silence on the panel.

**The panel comes back with one line it has never printed.** No purchase, no
price, no gold figure. A place. `ui/objective.js` is a ladder of milestones with a
`done()` and a room, and its `toward()` already turns "do X in room R" into "here
is what stands in the way". This is one more rung and the file was built to take
it.

**The player walks to the Serdab.** Nothing follows: it has no spawn points, and
twenty-five waves have trained the player to expect that something will.

**The eleventh niche is still empty.** She is not here. The Peach beat, delivered
by an absence in the geometry with no text at all.

**She is sitting on the stool.** Facing the empty niche, back to the door. The lamp
that was burning in the Canopic Crypt is beside her, and the stool is the one the
player has been finding since the Chamber of Ascent. She does not move and she is
not hostile.

**This is the first time in the game she has a body**, and the first time she has
been still. For twenty-five waves she has been a lamp ahead in the dark moving
away from him, and now she is stopped, and she does not turn round.

**She has not said anything for ten waves and the player has not noticed.** That is
the beat the whole world was built to deliver, and it lands here as a sensation
before it lands as a fact.

**The crosshair finds them and the interact prompt fires.** The same one-line
prompt that has quoted a price on every door, gun, shrine and altar in the game.
This is the one fixture in the map that is not for sale. `ui/prompt.js` already
arbitrates by priority and already has a refusal path that quotes no price at all,
and states in its own header why: a player who cannot tell "come back richer" from
"come back later" will grind gold for something that will never be offered. This
fixture has neither. It has a name and an [F].

**On F, three things happen and then the world ends.**

1. She stands and turns.
2. The effaced cartouche the player has been finding chiselled into walls since
   the first minute of Act 1 is on her. **PROPOSAL: on the lamp** - the object the
   player has followed all game, and already a light source, so the sign is lit
   from inside.
3. Her eyes take the telegraph ramp. `setGlow`'s exact curve, on a person, in the
   one room with no enemies in it.

**She does not ask him anything.** That is the fourth channel saying it, after the
ten waves of silence, the interrupted last line, and the sign on the lamp - and it
is the only one the player can feel without having worked anything out.

Then black, and the card.

**Step 3 is the twist.** Not the cartouche and not the empty niche - those are the
information. The glow is the twist, because the player already knows what it
means. They have been taught for twenty-five waves that a gold ramp is a wind-up
they have between half a second and one and a quarter seconds to answer, and there
is nothing here to shoot, nowhere to run, and the world ends before the tell
resolves.

**That is how you stage a reveal in a game with no cutscenes: you say it in the one
language the player was forced to learn.**

## The end card

**PROPOSAL: World 1 ends on a card in the death card's format, and it is a
verdict, not a victory.**

`ui/death.js` builds a cartouche with a shen bar, one word inside, one line
beneath. The World 1 card is the same frame. Inside the cartouche: the glyphs,
struck out. Beneath it:

```
THE NAME IS NOT HERE
```

It says the twist without mentioning the archaeologist. It repeats the shape the
player associates with a judgement being passed on them. It is the first time the
game has shown that frame when the player did not lose. And it is the third empty
cartouche in the world, which is the count that makes the player look back at the
other two.

Rejected: VICTORIOUS, or any word in the UNWORTHY slot. This game's card format is
a verdict about the player, and "you won" is not one. Rejected: putting this on
`ui/death.js` behind a flag. That file's own comment says the card is part of the
death sequence and should not exist in the page of a game nobody has died in yet; a
world-end card is a sibling module borrowing the same tokens.

## And then the player is in the niche, going down

**The card IS the cut.** The player confirms it, and when the frame comes back they
are in the shaft the eleventh niche became, descending. World 2 begins in the fall.

This is not a cutscene and it is not new technology. It is exactly what
`ui/death.js` already does, once or twice a run, every run:

- a card comes up over a stopped world
- a confirm gate arms after a beat and waits indefinitely, Enter only, refused if
  the key was already held
- while the player reads it, `toTheBeginning()` calls `spaces.enter()`, which swaps
  the collider set, retargets the audio, moves the sky's lights and holds a curtain
  at full black for two DRAWN frames
- the frame comes back and the player is standing somewhere else

**World 1's ending is the death card's machinery with a different word and a
different destination.** The hardest part of ending a world - changing the world
underneath a player who cannot see it happening - is a solved problem in this
codebase and has been since `a8baa5b`.

Rejected: a fall animation, a fade through rock, or a shaft the player descends
under their own control. The first two are cutscenes. The third sounds better than
it is: the player has just been given information they cannot act on, and handing
them thirty seconds of walking down a hole to think about it is thirty seconds for
the beat to cool.

---

# WHAT WORLD 1 MUST PLANT

Twenty-two things. Worlds 2 and 3 pay off all of them, and anything dropped here
has to be re-established later at a worse moment. Eleven already ship or cost
nothing but a refusal.

**The death loop, planted and never confirmed:**

1. **The contradiction on the death card.** Judged, sentenced, erased, and back on
   your feet. Ships today, costs nothing, most-read text in the game.
2. **The player's cartouche has a verdict where a name should be.** Ships today.
3. **What a return costs.** Gold and doors keep; the gods' favour does not.
4. **You always wake up outside the door.** Ships today.
5. **Anubis as the control case.** The one return that is announced, named, paid
   for and legitimate, which is what makes every other return read as something
   else.
6. **The gatekeeper's two words on the death card.** NEW, and it is the plant the
   whole ending needs. If it is not there from the first death, his voice arrives
   in World 3 as an author's convenience.

**The story, planted openly:**

7. **The effaced cartouche as a recognisable sign.** The mark the player reads as
   the villain's and the name they reassemble in the Serdab are the same object.
8. **The camp gradient, and that lamps get warmer.** World 2 is entered following
   a person and the player already knows how to track one.
9. **The empty eleventh niche.** World 2 is the search for what should have been
   in it, and World 2's recognition beat is the same niche with him in it.
10. **A completable set.** Four sons, four niches, four fragments.
11. **The law: kill the vessel, the thing moves on.** World 2's crescendo repeats
    it with a person instead of a god.
12. **The horde belongs to somebody.** Set falls and every live actor stops and
    turns toward the Serdab. World 3's horde is her, distributed, and this is the
    only moment in World 1 that says the dead have an owner.
13. **The player is doing her work and calling it a rescue.** World 1 must let this
    read as heroism and must not wink.
14. **The government, present and absent.** The camp is the only place before Area
    51 where the institution that caused this is physically in the frame. NEW.
15. **The other realm's growth, one patch, in the niche.** NEW, free, and it is the
    first frame of World 2's whole visual thesis.

**The descent, planted as architecture:**

16. **The enclosure, ending at five units.** Costs a refusal, not a build.
17. **The Star Shaft as the last time up is offered**, with a rope in it that goes
    up into the dark and ends at nothing.
18. **The inside is bigger than the outside.** True in the shipped build, stated in
    `rooms.js`'s own header, never acknowledged. Only has to survive somebody
    deciding to fix it.
19. **The pyramid's silhouette on the skyline.** The 62-unit stepped mass the
    player walks an avenue toward in the opening minute, seen again from outside
    and upside down at the World 2 to World 3 crossing. The one shape in the
    project that will never need a caption, and it only works if World 1 spends
    real time pointing the player at it. It already does.

**The friend, planted as a pattern and then as a silence:**

20. **Her five questions, in a recognisable shape.** The pattern is the only thing
    that makes its ending audible.
21. **Lowercase as her voice**, established from the avenue, before the player has
    any reason to notice it.
22. **The silence, ten waves of it, unremarked - and the lamp the horde walks
    past, exactly once.** World 1 pays the silence off at the Serdab. World 2 pays
    the lamp off when the player finally sees it happen in the open.

**And the one refusal everything is downstream of:**

**`(0, 30)` stays unmarked.** No prop, no stain, no line. If World 1 ever
annotates the spawn point, the character stops being a man who does not know and
becomes a man being told.

---

# THE MAP BRIEF

The owner: "we need more space. I want more space. and now according to the story
we go down deeper and deeper as we play, so we need a map building phase that
connects the map with the story."

This section is what the story requires, in purposes rather than geometry. **No
coordinates, no dimensions, no layout.** The map lane knows constraints this lane
does not.

## The honest finding first

**Every dramatic purpose World 1 needs, the existing nine interior rooms already
have a home for.** Not one of the interior purposes below is homeless. So the map
is not too small in the sense of missing rooms, and adding interior rooms to make
it feel bigger would produce exactly the thing the owner is complaining about: a
space that exists because the map wanted another room.

**What is genuinely missing is outdoors, and one vertical move.**

## The two real gaps

**1. There is no expedition camp, and meeting 2 makes one mandatory.** The
government sent seven people with equipment and then classified the file. The
evidence of that is the only thing in World 1 connecting this tomb to the
institution that caused it, and there is currently nowhere for it to be. It is also
where the fiction establishes, with no text at all, that people came here on
purpose and are not here now.

`MAP.md` already calls the courtyard "the worst of the four" for trainability - a
straight corridor with recessed pockets, closed at both ends, nothing to circle.
The camp is the story's own reason to fix that, and Act 1 already has two authored
spaces on a circuit that a third node can join.

**2. The map is horizontal and the story is now explicitly vertical.** Every floor
is at y=0 and "deeper" runs along one axis from -140 to -272.

> **RECOMMENDATION, mine: World 1 gets ONE real descent, not nine.**
>
> Author the per-room depth number as data, as previously recommended, and build
> exactly one place where the player physically goes down and can feel it, at the
> Act 2 to Act 3 break.
>
> If every room is a floor lower, the player stops registering any of them. The
> world already spends its one vertical gasp on a shaft that points UP and
> delivers nothing. **One built descent against one built ascent is a shape. Nine
> floors is a number.**

## The constraint the map lane must know before it starts

**Both worlds are resident in memory at boot and nothing is ever disposed.** The
space router toggles visibility on subtrees; no geometry is ever freed. The
interior is described in its own comment as costing about half a megabyte of
geometry, and it is built at boot deliberately, because building on first entry
causes a visible hitch.

**This is the real ceiling on "more space", and it compounds when World 2 lands** -
and World 2 is structurally cheap, because the room graph is pure data and the
builder already takes the room list as a parameter with the shipped graph as its
default. A second interior is data authoring, not engineering. Which means the
memory question arrives sooner than anyone expects.

## The purposes, in the order the player meets them

| # | Purpose | Dramatically it is FOR | Today |
|---|---|---|---|
| 1 | **THE GRAVE** | the first frame is him standing on it, unmarked, forever | courtyard spawn. **Do not touch it.** |
| 2 | **THE CAMP** | the institution that did this, present and abandoned | **NEW.** |
| 3 | **THE ANOMALY** | why anyone came; instruments still logging something nobody is reading | **NEW, and it can live inside the camp.** |
| 4 | **THE WORKING GROUND** | space to fight and earn before you can afford to go in | avenue, Quarry, Canal. Already a circuit. |
| 5 | **THE FIRST JAR** | the first fragment, before the pyramid | courtyard west chapel. Placed. |
| 6 | **THE WAY BACK IN** | the first purchase is re-entering the building he died escaping | the sealed doorway. |
| 7 | **THE THRESHOLD** | the inside is bigger than the outside and nobody says so | Chamber of Ascent. |
| 8 | **THE SURVEY** | somebody worked here recently and did it properly | Hall of Offerings, Granary Vault. |
| 9 | **THE LOUD ROOM** | her third line is nearly said and lost in a fight | Great Gallery. |
| 10 | **THE ONE DESCENT** | the only place the player physically goes down | **NEW, at the Act 2 to Act 3 break.** |
| 11 | **THE UP THAT FAILS** | thirty units at the sky, a rope ending at nothing, and jar 2 | Star Shaft. |
| 12 | **THE WARM CAMP** | she was here hours ago, and jar 3 | Canopic Crypt. |
| 13 | **THE MACHINE** | four niches, four colleagues, and the frame she is erased in | Embalming Chamber. |
| 14 | **THE BODY** | the sarcophagus, the last boss, jar 4, and nothing modern in it at all | King's Chamber. |
| 15 | **THE SOUL ROOM** | the only room where the player can be alone, and the way down | Serdab. |

## What the existing rooms become

Carrying a beat, or being space. Being space is not a criticism; a world needs
somewhere to fight.

| Room | Verdict |
|---|---|
| courtyard / avenue | **Three beats**, and by its own documentation the weakest space in the map. Grows by the camp. |
| Quarry, Canal | **Space, deliberately.** The Act 1 loop. They should stay pure fighting ground. |
| Chamber of Ascent | One line and the bigger-inside beat. Otherwise space. |
| Hall of Offerings | **Space**, plus the survey dressing. |
| Granary Vault | **Space**, plus the chalk outline where jar 1 used to stand. |
| Great Gallery | **Her third line**, and it is the only room big enough and loud enough for a half-sentence to be lost in. |
| Embalming Chamber | **The machine and the erasure.** The most important interior room in World 1. |
| Star Shaft | **The failed ascent, jar 2**, and it is also the only room connecting to the Serdab. |
| Canopic Crypt | **The warm camp, jar 3.** |
| King's Chamber | **Jar 4 and the final boss**, and its job is to have nothing modern in it. |
| Serdab | **The entire ending of the world.** Load-bearing precisely because it is small. |

## Four warnings for the map lane

**1. The Embalming Chamber is a mandatory one-door dead end and it is about to get
busier, not quieter.** Under the recommended Kindling change the player enters it
four times instead of once. `MAP.md` already flags it as a problem and already
specifies a portal to fix it. That room getting more traffic is a story
requirement rather than a preference.

**2. The Serdab is currently unreachable.** Its portal is the only puzzle-gated
door in the game and it reads a jar counter that is hardcoded to zero and never
written. The room where World 1's entire ending happens cannot be entered in the
shipped build. Whatever else happens, the jar system is the gate on shipping World
1 at all.

**3. The Serdab connects to the Star Shaft and to nothing else**, through the
narrowest portal in the map. The exit from World 1 therefore runs Star Shaft into
Serdab into the niche, and the Star Shaft is also where jar 2 is. That is a lot of
weight on one room and it is the map lane's to price.

**4. Act 1 is the act the story grew the most and the map grew the least.** The
grave, the camp, the anomaly, jar 1, her first line and the way back in are all
outside, in a space its own documentation calls the worst of the four.

---

# OPEN QUESTIONS

Ordered by how much they block. Each is a question with a recommendation, not a
menu.

1. **Is Hetepheres a name on a wall or the antagonist?** **Recommendation: a name on
   a wall, and the antagonist stays nameless in World 1.** One of the two
   decisions genuinely waiting on the owner. Argument in `NARRATIVE.md`.

2. **Take Option C on the Kindling?** **Recommendation: yes.** The other decision.
   Cost table above.

3. **World 1 needs an ending and the game has no concept of one.** `boss.js`
   `forWave()` cycles the five gods forever; nothing in `main.js` or `director.js`
   can conclude a run. **Recommendation: World 1 terminates at wave 25 on Set's
   death.** Endless mode stays as a separate mode off the start screen, where the
   existing cycle is exactly right. **Largest engine gap in the document.**

4. **The four-jar chain is unbuilt and there is no carried-item primitive anywhere
   in the codebase to copy.** The nearest analogue is proximity-collected floor
   drops, which is a different verb. Four jars and four niches are placed, meshed
   and published to the rest of the game, and nothing reads either.
   **Recommendation: build it, because everything is gated on it** - the Serdab,
   the ending, the power, the flashbacks and the shrine cap. Roughly 250 to 400
   lines plus a test harness.

5. **Should the ending be gated on the jars at all?** A player who never solves the
   chain kills Set and has no Serdab to walk into. **Recommendation: yes, gate it,
   and have the objective ladder demand the jars before wave 25.** The tracker is
   derived and can carry a jar milestone the same way it carries the power state.

6. **Does the death card get a resurrection count?** `state.resets` already exists
   and the stats line already prints `WAVE 05 · 1240 GOLD`. **Recommendation: yes,
   and use the antagonist's own verb.** `RAISED 04`, third field, same tabular
   numerals, no comment anywhere else in the game. **The single cheapest and
   strongest plant available.** If one thing on this list ships, it should be this
   and the gatekeeper's two words, which share the same card.

7. **The archaeologist is a fixture that is not for sale**, and the interact
   handlers are `describe()` plus `buy()`. **Recommendation: a new handler type
   whose `buy()` fires the sequence and returns false.** Smallest change that
   keeps the one-raycast, one-prompt, one-F shape the file was built around. Note
   that niches will need the same treatment - the interact layer skips any slot
   type with no registered handler, and only four types are registered today.

8. **There is no way to write text on a wall.** The Serdab cartouche needs a
   surface that changes as jars return. `doors.js` already builds a `CanvasTexture`
   so the capability exists, but no room fixture uses it. **Recommendation: four
   discrete emissive glyph meshes rather than a canvas.** Four booleans instead of
   a texture upload, and it matches how shrines already show held state.

9. **`director.js` has no "stop and face a point" call.** Needed for the Set beat,
   and needed again for World 3's re-condensation. **Recommendation: a one-shot on
   the director rather than state on each actor.**

10. **`boss.js` has one death path for five gods.** **Recommendation: a `farewell`
    field on the god record, absent on four of them.** The dying branch already
    reads `god.escalating` the same way.

11. **The end card wants to be a sibling of `ui/death.js`, not a flag on it.**
    **Recommendation: a second module sharing `ui/tokens.js`.**

12. **Six new propSlot types** (`lamp`, `stool`, `peg`, `chalk`, `rope`,
    `notebook`) plus one fixture type for the archaeologist plus the Serdab's ten
    figures and eleventh niche. **Recommendation: build them as one lane.** All
    boxes and cylinders, and they are the entire environmental storytelling budget
    for World 1.

13. **The flashback fragments need a sequence driver that does not exist.**
    Roughly 190 to 240 lines for the held-tableau version. **Recommendation: build
    the curtain exposure and the driver once, and author four fragments against
    it.** Do not build a camera detach; the moment the camera moves this becomes a
    cut scene and triples.

14. **DOUBLE DAM collides with the Shrine of Set**, which already ships DAMAGE AND
    RATE UP. **Recommendation: DOUBLE DAM is an ACTIVE ability on a cooldown, not a
    shrine boon and not a floor drop, and it survives death while every shrine boon
    does not.** Passive damage is Set's; triggered damage on a timer is a different
    verb; and persistence-through-death is the mechanical fingerprint of the second
    resurrector. Roughly 60 to 90 lines, and see the honest caveat: a damage
    multiplier applied at the weapon-stats lookup silently excludes grenades and
    the khopesh.

15. **Twenty-five waves may be too long for World 1 of three.**
    **Recommendation: ship at 25 and cut on play, not on argument.**

16. **Is her name spoken anywhere before the fourth jar?** **Recommendation: no.**
    Nowhere in the UI, nowhere in a notice, nowhere on a wall.

17. **Does the player character get a name?** **Recommendation: no.** His cartouche
    is empty and stays empty. The first identity he gets is his face on the box art
    at the end of World 3.

18. **Does the depth readout ship with World 1?** **Recommendation: yes, even
    though World 1 alone does not need it.** A depth readout introduced in World 2
    is a UI element. One that has been there since wave one is a fact.

19. **The notice pill needs a hold and a lowercase mode.** One boolean, one
    timestamp, one class, and one deliberate exception at the machine.
    **Recommendation: build it with the voice list, not before.**

20. **A one-shot voice list keyed on first room entry.** **Recommendation: keep it a
    flat data list in one file, the way `rooms.js` is data.** The moment her lines
    are scattered across the systems that trigger them, the pattern stops being
    auditable, and the pattern is the entire device.

21. **Does she have a body before the Serdab?** **Recommendation: no.** A lamp and
    a voice for twenty-five waves, and a form exactly once.

22. **What does the player see of her in Act 3, after she stops?**
    **Recommendation: exactly what they saw before, plus one thing.** The lamps
    keep moving ahead and the rope still gets rigged. The single exception is the
    horde walking past her lamp, once, unremarked. If Act 3 makes her sinister, the
    removal stops being the clue.
