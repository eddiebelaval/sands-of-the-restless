# WORLD 1 - the tomb

Written 2026-08-01 against `docs/story-meeting-2026-08-01.md`, `MAP.md`,
`STATE.md`, and the shipped source. The transcript is the record of what the
room agreed; this is the document that turns it into something a level designer,
a writer and a programmer can all work from.

> **HOW TO READ THIS.** Two kinds of sentence, marked apart on purpose, because
> the owner needs to see instantly what he said and what was invented on top.
>
> | | |
> |---|---|
> | Plain text | comes from the transcript, from an owner decision, from `MAP.md`, or from the shipped code. Cited where it is not obvious. |
> | **LOCKED** | decided by the owner. Not open. |
> | **PROPOSAL** | invented here. It can be overruled at no cost. |
>
> Nothing in this document renames anything that exists. The gods, the weapons,
> the rooms, the boons, the death card and the four sons of Horus are all used
> as built.

> **DECIDED 2026-08-01 by the owner.** The three things the transcript left open
> are closed. This document has been rewritten to read as settled; the questions
> are gone rather than sitting next to their answers.
>
> 1. **Her name is MERESANKH.**
> 2. **There is ONE spirit, not two.** There was never a captor and a captive.
> 3. **The archaeologist dies in World 2. The spirit does not.** Only the body.
>
> Owner's words: "It was always just one spirit, not two, and it'll be the
> archaeologist. So the archaeologist dies in world two - not the spirit, just
> the archaeologist. And then the spirit becomes kind of like the compounding of
> all the enemies in world three."
>
> The consequences run through Worlds 2 and 3 and are worked out in
> `docs/WORLDS.md`. **World 1 barely moves**, which is the test the decisions had
> to pass: this document was already written to plant all of it and pay off none
> of it.

---

## THE READING EVERYTHING ELSE HANGS OFF

**The spirit's power is raising the dead. The player dies constantly and gets
back up. The player is one of the raised.**

Every restart is her doing it again. That is why the player cannot stay dead,
why she cannot be killed by killing what she is in, and why the archaeologist
keeps leading the player deeper: the player is useful precisely because they
keep getting back up.

This is not a layer added to the game. It is a description of what the game
already does, and the amount of it that ships today without one line of new code
is the reason to take it.

> **Where this ends up.** With one spirit settled, the loop resolves in World 3
> into the sharpest thing in the design: if she is in every risen thing, and the
> player has been rising since wave one, **the player is a vessel too.** Not "she
> was the villain" - the recognition is that the player has been carrying her the
> whole time, that this is why they keep getting back up, and that killing her
> means staying dead. The player was never rescuing her. They were housing her.
>
> **World 1 says none of this and must not.** It is here so that nobody building
> World 1 accidentally spends it.

### What is already on screen

**The death card already says the player failed judgement and was sent back.**
`ui/death.js` puts UNWORTHY in a cartouche with THE HEART OUTWEIGHS THE FEATHER
beneath it, and the file's own comment states why: in the Hall of Two Truths a
heart that weighs too much is fed to Ammit **and the name is erased**. That is a
final verdict. And then the player stands up. The game has been contradicting
its own death card since the card shipped, and today that contradiction is a
genre convention. Under this reading it is the plot.

**The player's cartouche has no name in it, because he does not remember his
name.** A cartouche is the oval a NAME is written in, and `ui/death.js` says so
in its own comment, and states the rule that the loop goes round the word and
nothing else. The word inside the player's loop is UNWORTHY. That is a verdict
standing where a name should be.

He is dead and he does not remember who he is. The death screen has been telling
him who he is not since before any of this was written. In Act 3 he finds a
second empty cartouche cut into the back wall of the Serdab, and it is hers, and
he will restore it before he ever restores his own. Two nameless people in one
game, in the same frame, and neither has to be pointed at.

**The reset rule is already the right rule.** `ui/death.js` states it: what
carries over is what the player earned with their hands - gold, weapons, Altar
upgrades, ammunition, grenades, doors bought open, the power state of the
necropolis. What does not carry over is the wave, the power-ups, and **every
shrine boon**. Read as mechanics, that is a fair checkpoint. Read as story: you
keep your possessions and your progress through the tomb, and the gods take
their favour back every single time. The pantheon withdraws a little further
from a thing that will not accept a verdict.

**Every death returns him to the exact place he was first killed.** This is the
strongest item on the list and it was built for an unrelated reason.

The owner asked for a usability fix: when I die, I need to spawn back at the
beginning, not in the same area where I was in. It shipped in `d689bad`.
`ui/death.js`'s `restart()` now calls `toTheBeginning()`, which puts the body at
the courtyard spawn facing down -Z at the pyramid - by teleport if the player
died outside, and through `spaces.enter('exterior')` if they died in the
pyramid, because the interior is a different world and a written coordinate
would drop them outside its bounds.

**The beginning is where he was killed.** `courtyard.js` names the spawn at
`(0, 30)` twice in its own comments, both times describing the walk from there
down the avenue to the sealed doorway. He died on that spot, in front of his
friend, before the title screen.

So the game does not return him to a respawn point. It returns him **to the
spot**, from either world, every time. She puts him back where she found him.

Nothing has to be built for this. It has been shipping for a day, in both
worlds, for reasons that had nothing to do with the fiction.

**There are already two different ways to come back, and the game distinguishes
them.** The Shrine of Anubis costs 1500, forgives one death, and announces
itself: ANUBIS WEIGHS YOUR HEART AND RETURNS IT (`systems/shrines.js`). A god,
named, paid, once. Every other return has no god, no name, no notice and no
price, and it puts the player outside the door. The legitimate case is in the
build as the control, which is what makes the other case legible as an anomaly.
Anubis is also the cheapest shrine in the map and stands in the first room
inside the pyramid. He is the only one still willing to deal.

**The game already counts it.** `state.resets` in `ui/death.js`.

**The confirm button already says KEEP THE VIGIL.** A vigil is a watch kept over
the dead.

None of the above is a proposal. All of it is shipped.

### The four, as a set

Taken one at a time each of these is a coincidence. Taken together they are the
argument that this reading is the right one rather than something imposed on the
game afterwards:

1. **The death card judges him personally and erases him, and then he stands
   up.** (`ui/death.js`, the whole file's premise.)
2. **His cartouche carries a verdict where a name should be**, because he does
   not remember his name.
3. **`restart()` returns him to the place he died, every time**, from either
   world. (`d689bad`, built as a convenience.)
4. **The Serdab, the only room in the map with no spawn points, is the only
   room where the twist can land without a horde arriving.** (`rooms.js`, built
   to satisfy the trainability law.)

Four pieces of machinery, built for four unrelated reasons - a fail-state
convention, a typographic rule, a usability complaint, and a level-design law -
that between them already stage the entire story. That is not a story this
document is putting onto the game. It is one the game has been running without
anybody noticing.

### The first frame of the game is him standing on his own grave

He died at `(0, 30)`. The game opens there, with his friend beside him, and she
is the only one who knows. Before a shot is fired and before the doorway is
bought.

Two things follow, both free:

**The avenue is the walk he did not survive**, and the player repeats it every
run. `courtyard.js` describes the avenue exactly this way already, as the walk
from the spawn to the sealed doorway. It is a straight processional corridor
with recessed chapels, closed at both ends - `MAP.md` calls it "the worst of the
four" for trainability and says so deliberately. It is also, now, the place he
was killed doing an errand.

**The sealed doorway at 1000 gold is the thing he died in front of and never got
through.** The player's first purchase in the game is finishing the errand that
killed him.

### DO NOT MARK THE SPOT

**Decision: nothing is placed at `(0, 30)`. Not a prop, not a stain, not a
notice line, not a change in the dressing.**

The entire design of this character is that he does not know and is never told,
and a marker is the game telling him. A bloodstain at the spawn point is the
game leaning over and whispering, and it would also be the one piece of set
dressing in the courtyard that a first-time player would stop and look at, which
is the opposite of what this beat needs.

The spot is load-bearing precisely because it is unremarkable. It is where the
game has always started. It stays that way.

One thing is placed nearby and it was already there: `courtyard.js` puts the
first canopic jar in the west chapel the player passes on the walk down from
`(0, 30)`. That is the errand. It stays exactly where `MAP.md` put it and it
needs no annotation.

### What this buys

1. **The mechanic is the theme, at zero cost.** The transcript's line about the
   boss - "it doesn't really die, it just goes away, because it raises the dead
   again" - is not a boss behaviour. It is a CONDITION, and it is the condition
   the player is in. The player learns the antagonist's nature by living it for
   twenty-five waves before they are ever told it.

2. **It earns the alien ending, which is the riskiest beat in the transcript.**
   "In the end it was just a video game" is one inch from a cop-out, because a
   twist that invalidates everything usually is. But a player who has spent
   three worlds being replayed by something that will not let them stop does not
   experience "you were a cartridge" as a rug-pull. They experience it as
   confirmation of what they have felt the entire time. Same twist, completely
   different weight.

3. **"And for them we're the aliens" pays off twice.** The player was the
   monster in somebody else's story, and the dead thing somebody kept
   reanimating. The transcript's last line is a double, and this is what makes
   the second half of it land.

4. **It explains the difficulty curve diegetically.** The tomb sends Anubis,
   then Ammit who eats the heart that fails, then Apep, then Sekhmet who was
   sent to slaughter mankind, then Set. Five judges, escalating, because the
   verdict will not stick. The boss ladder is not a curve. It is an immune
   response to something that will not stay dead.

The conservative alternative is to keep death as a pure fail state and let the
archaeologist's betrayal carry the drama alone. It is cleaner, more
conventional, and it leaves the ending doing all the lifting by itself. Not
taken.

### The two rules this must obey

**It must never be told.** No notice text, no objective line, no wall carving
says "you are one of the raised". If the player has to be told, the idea has
failed. It is inferable from the death card, from what the player keeps and
loses, from where they wake up, and from what the archaeologist does not say.

**World 1 plants it and is complete without it.** The recognition belongs to
World 2. A player who finishes World 1 and never joins the dots has a complete
world: a tomb, a name, a rescue that fails, and a person at the bottom of it who
is not what they seemed. Nothing in World 1's ending depends on the player
having worked this out, and nothing in World 1 confirms it.

---

## THE SECOND STRUCTURAL IDEA: the three worlds are one place, descended

The owner, after the transcript: "each world goes deeper into the pyramid, until
we get to the bottom where it's all white or something, and it's an alien world
underneath the pyramid, or in another universe, who knows? we don't say. that's
the mystery."

That is a return to his own first instinct in the room. At 00:00:10 Speaker 2:
"It maybe lives underground, you know?" At 00:00:12 Speaker 1: "Yeah, maybe
there's like a deeper part of the pyramid that goes down."

**The three worlds are not three places. They are one place, and the player is
going down through it.** The full escalation lives in `docs/WORLDS.md`. What
World 1 owes it is three things.

### 1. A pyramid is famous for going up

Every image anyone holds of a pyramid is a point against the sky. Going DOWN
through one is wrong before anything has happened, and it gets more wrong with
depth. World 1 does not have to earn that. It has to not spend it.

So World 1's Act 3 is the last floor that still looks like a tomb should. It is
Egyptian, it is knowable, it has gods with names and a procedure, and the player
believes they understand where they are. That belief is the asset. World 2
spends it.

### 2. The inside is already bigger than the outside, and it ships today

`rooms.js` opens with this, written as an engineering note:

> "The interior is a separate cell from the courtyard rather than a literal
> cavity inside the exterior pyramid: the playable interior is far larger than
> the 62-unit stepped mass that reads well on the skyline, and no amount of
> scaling reconciles the two."

Read as engineering, that is a compromise. Read as story, it is the first
symptom: **the inside of this thing is larger than the outside of it.** Nine
rooms, a 38-unit gallery and a 30-unit shaft do not fit inside the building the
player walked up to, and the game has never once acknowledged it.

Nothing has to be built for this. It is true in the shipped build and it has
been true for weeks. What is required is that nobody ever "fixes" it and that
no line of copy ever excuses it.

### 3. Depth, not the wave, is the trilogy's progress bar

**PROPOSAL, and it is mine rather than the transcript's.** The wave number is a
scoreboard. Metres below the sand is a story.

The HUD can take it without a redesign. `index.html` `#r-ammo` already stacks
two rows under the ammunition: `Wave 1`, and beneath it `Difficulty Normal`,
with the markup's own comment stating the rule that governs the stack:

> "It sits under the wave counter because it is the same fact at a different
> rate: the wave says where on the curve the player is, this says which curve."

A depth row is a third fact at a third rate and it fits that rule exactly. The
CSS already separates numerals from labels (`#hud #r-ammo .wave u` takes
`numeralTracking` and no text-shadow; the label takes `incised()`), so a
`Depth 41 m` row costs one span and no new styling.

**Recommendation: depth sits beside the wave counter, not instead of it**, and
it is derived from the deepest room the player has reached rather than from the
wave. The wave counter is load-bearing - every fifth wave is a landmark the
player plans around - and depth that ticks up while the player stands still in
the Hall of Offerings reads as a bug before it reads as dread.

Honest in World 1 and World 2 is what buys World 3, where the same readout is
the last instrument in the frame still reporting anything.

**This needs a `depth` field per room in `rooms.js` and nothing else.** The map
is horizontal today - every floor is at y=0 and "deeper" runs along -Z from -140
to -272 - so the number is authored per room rather than measured. That is a
finding, listed under Open Questions, not a licence to rebuild the map on a
vertical axis.

### 4. The enclosure has to tighten, because at the bottom it inverts

The beat all three worlds are built toward: three worlds of increasing
enclosure, and then the floor opens and **there is no ceiling at all.** Hours of
claustrophobia and then sudden agoraphobia. The owner's words: "kind of like
breaking your brain, breaking your model of what was supposed to happen."

**That is not World 1's beat, but World 1 is where it is either set up or
spoiled.** The enclosure has to actually tighten or the inversion has nothing to
invert.

The good news is that World 1 already does it. `rooms.js` carries a `height` per
room, and as shipped:

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

**The last room of World 1 already has the lowest ceiling in the game, and
nobody put it there for this reason.** Fourteen by fourteen by five, the
smallest room in the map by a factor of two, and it is where the player leaves.
The enclosure bottoms out exactly at the exit.

So World 1 owes the trilogy three things, all of them refusals rather than
work:

1. **Do not add a room taller than the Great Gallery.** Sixteen is the ceiling
   of the ceilings.
2. **Do not give the Serdab more height.** Five is the floor and it is the last
   room the player stands in.
3. **Keep the Star Shaft as the last time up is ever offered.** Thirty units of
   void pointing at the sky, with a rope in it that goes up into the dark and
   ends at nothing. It is a false promise and it should stay one. Nothing after
   it points at the sky until the sky is wrong.

### How this composes with the death loop

They are the same pressure from two directions. Something that keeps raising
you is also something dragging you further down, and both get worse together.
The player who dies at wave 24 does not lose their depth. They lose the gods'
favour, they go back to wave one, they wake up outside the door - and the number
that says how far under the sand they are does not move. The tomb does not
forget how deep it has taken you.

---

## The premise, and the question World 1 asks

A dig has opened a Fourth Dynasty tomb on the Giza plateau. The dead in it will
not stay down, and the thing raising them is somewhere underneath. The
transcript's frame: a good spirit is held by an evil spirit, the evil spirit is
raising the dead, and the player is trying to reach her.

**LOCKED: the game starts after his death.** She hired him, they went in, he
was killed in front of her at `(0, 30)`, and he got up. By the title screen he
is already on his second life, and every death the player suffers afterwards is
the same event repeating.

That closes the death loop onto the fiction completely: **the player is not
learning to survive, he is failing to stay down.**

### The opening death is never depicted, and that is a decision

**Recommendation, and I agree with the instinct behind the question: show none
of it. No cutscene, no flashback, no playable prologue, no text.**

Four reasons, in order of weight:

1. **Depicting it destroys the device.** He does not remember. If the player is
   shown it - worse, made to play it - then the player remembers, and the entire
   asymmetry between him and her collapses on the first frame. The player has to
   be on his side of the gap, which means knowing nothing.
2. **Her testimony is the only record, and that is its value.** Five unanswered
   questions from the one person who was there IS the depiction. Any other
   version makes her redundant, and she is the best thing in the world.
3. **Every option needs technology the game does not have.** A cutscene, a
   flashback, or a second playable space with its own scripting. The nearest
   thing that exists is `spaces.enter()`, and it swaps worlds, not times.
4. **The game already stages it, twice.** The first frame is him standing on the
   spot. Every restart is the re-enactment, and the player will see it thirty
   times.

The only version worth even considering is a silent title card before the
courtyard, and it is rejected for reason 1: a card saying anything at all about
what happened is the game telling him.

**PROPOSAL: the dramatic question of World 1 is "what was her name, and who took
it".**

That is the question because the game is already asking it. Erasure of the name
is the worst thing this game knows how to do to a person - the death card is
built on it. So the rescue is the rescue of a NAME, the antagonist is a thing
that lives by taking names, and the four-jar chain is how the player puts one
back together.

World 1 answers the first half and refuses the second. The player learns her
name at the fourth jar, finds her gone, and the thing that took it is sitting in
the room.

Rejected: "find the spirit, kill the thing, free her" as the stated question. It
is the plot rather than the question, and it makes the Mario twist a bait and
switch instead of an answer to something the player was actually asking.

---

## The cast

### The spirit: **MERESANKH**. LOCKED.

There is one spirit in this game and this is her name. She was unnamed in the
transcript; three were considered, and the record of the other two is kept here
so nobody re-derives them.

| Name | For | Against |
|---|---|---|
| **MERESANKH** | real Fourth Dynasty queen buried at Giza; name means roughly "she loves life"; her tomb's defining feature is its serdab | four syllables, and the player has to learn it cold |
| NEITH | one of the four goddesses standing behind the four canopic sons, so she is already wired to the jar chain | she is a GOD, and the five things you fight are gods. Putting her in the same class as the bosses muddies the read at the moment it has to be clean |
| NEFERET | short, easy, unmistakably Egyptian | means "the beautiful one", which is decoration. It says nothing about the plot |

The argument that carried it:

1. **Her tomb's famous feature is a serdab, and this map already has a Serdab.**
   Meresankh III's rock-cut chapel at Giza is known for a row of female figures
   carved into the wall of its serdab. `rooms.js` already has a 196-unit
   `serdab` behind a `puzzle` portal with no spawn points. That is not a
   coincidence to engineer; it exists and can be picked up for free. See "The
   Serdab is the stage", which is the most load-bearing observation in this
   document.

2. **The name is not ironic. It is literal, and it is the problem.** "She loves
   life" said of the thing that will not let anything stay dead. A horde of the
   risen is what that sentence looks like when nothing limits it. The name
   stopped being a counterpoint and became the diagnosis the moment the owner
   settled that there is only one spirit.

3. **She was buried in a sarcophagus originally cut for her mother.** A queen in
   a vessel that was not hers is the shape of everything else in this game. One
   line of environmental copy if it is ever wanted, free if not.

**Her name is not spoken in World 1 until the fourth jar goes home.** Before
that the game refers to her only as an absence.

### One spirit, and what that costs World 1: nothing

**LOCKED: there is no second entity.** No captor, no possessing demon, no
separate raiser of the dead. The thing in the wave-25 boss, the thing in the
archaeologist, and the thing the player is trying to reach are the same thing.

**The consequence, and it is the one inference in this document worth checking
against what the owner meant:** if there is one spirit and it is the one raising
the dead, then the woman the player is trying to rescue is the thing killing
them. The transcript's premise - "we're trying to save a spirit that has been
taken over by an evil spirit, and that evil spirit is raising the dead" - does
not become false. **It becomes the story the player is told**, and the person
who told them it is the archaeologist. Everything downstream in `docs/WORLDS.md`
rests on this reading; if it is not what the decision meant, that is the line to
catch it on.

World 1 does not have to change to accommodate any of this, and that is the
point. What changes is what three things already in the document MEAN.

**The effaced cartouche is her name.** The sign the player has been finding
chiselled into walls since the first minute of Act 1, and the struck cartouche
they reassemble glyph by glyph in the Serdab, are the same mark. The player
reads it all game as the villain's calling card. It is the thing they came to
restore. One object, two readings, both true, and no new asset for the second
one.

That also retires the working name an earlier draft used for a separate
antagonist. There is no second name because there is no second entity, and in
World 1 the docs call it what the player calls it: nothing. It is a sign, not a
noun.

**The horde is already hers.** When Set falls, every live actor stops and turns
to face the Serdab door (see the boss encounter below). That beat was written as
"it went somewhere". It now reads as the dead turning toward the person they
belong to. Same beat, same code, deeper on a replay.

**The gods withdraw because they can tell what is bringing the player back.**
Every death drops every boon (`shrines.js` `dropAll`). Anubis is the exception,
the cheapest shrine in the map, in the first room, and the only god who will
return a player and say so out loud. He is the legitimate mechanism, and the
reason he is the control case is that something else is doing it the rest of the
time.

> **Chest of the Nameless.** No longer a collision worth raising: with no
> second antagonist there is no second nameless thing. The box keeps its name.

### The five gods are the tomb's immune system

`boss.js` ships Anubis, Ammit, Apep, Sekhmet and Set, one per fifth wave, with
telegraphed abilities.

**PROPOSAL: they are the tomb's staff, not the antagonist's army.** They come
for the player because the player is a robber in a grave, and because the player
will not stay judged. Anubis weighs. Ammit devours the heart that fails. The
death card is the verdict at the end of that process, and the player keeps
walking away from it, so the tomb sends something bigger.

Three consequences and none of them are flavour:

1. The death card and the boss roster become one system rather than two Egyptian
   things in the same game.
2. The boss fights are not progress against the antagonist, so defeating four
   and finding the fifth was a puppet is not a cheat. The player was never
   fighting the antagonist. They were being processed, repeatedly, by an
   institution that could not make it stick.
3. It sets up World 2. World 1 is a place with judges, rules and a procedure.
   World 2 has none, and the player should feel the loss.

The Shrine of Anubis already forgives one death and its notice already reads
ANUBIS WEIGHS YOUR HEART AND RETURNS IT. The pantheon is already doing this
work.

### The archaeologist

> **REVISION, 2026-08-01.** An earlier draft of this document had her carrying
> the spirit from the first frame, which is the straight reading of the
> transcript's "secretly possessed". **That is no longer right.**
>
> Owner: "The archaeologist and the player were friends. The archaeologist SAW
> her friend get killed, and is surprised to see him alive." And: "there's a
> point where she gets possessed, and then she changes a little... where she
> STOPS ASKING."
>
> **She is herself when the player meets her. She is possessed DURING World 1.**
> The Serdab is where the player finds out, not when it happened.
>
> This is better because it is observable rather than retrospective, and it
> costs a scene: World 1 now needs a stretch where she is genuinely her, and a
> moment where she stops being. That is worked out below under "She asks, and
> then she stops", which is now the spine of the world's second half.

**LOCKED: they were friends. She watched him die. She is looking at him.**

Her surprise is not vague and it is not "I thought you had gone home". She has
certain, first-hand knowledge that he is dead. She was there.

**She is the only one in the game who knows what he is, and he does not.** That
asymmetry is the entire relationship, it requires no dialogue system to
establish, and the player is on his side of it: they know exactly as much as he
does, which is nothing.

**PROPOSAL: she keeps working with him because she is hoping she was wrong.**
The alternative - she needs him and is using him - is playable and is the colder
read, but it makes her a second manipulator in a game that already has one thing
using people, and it makes her stopping mean less. If she has been hoping, then
what the possession takes is the hope, and the silence is a bereavement the
player does not know they are watching.

**LOCKED: she dies in World 2. The spirit does not.** Only the body. Staged in
`docs/WORLDS.md`; World 1 owes it nothing except not contradicting it.

#### What the possession actually does to her: it removes a doubt

This is the coldest thing in the document and it is what makes the tell
motivated rather than merely clever.

Her questions are **reconciliation, not curiosity.** She is trying to square a
body she personally witnessed against a man walking around in front of her. She
is checking whether she is the one who is wrong - about what she saw, about her
own memory - because the direct question is unaskable.

**The thing that takes her already knows the answer.** It does not need to ask
how he is walking around. It is the thing that stood him up.

So the possession adds no menace. **It subtracts a doubt.** Her confusion was
the last human part of her still trying to reconcile what she saw, and when that
goes, nothing appears in its place. That is why the tell is an absence, and it
is why the absence is the only honest way to stage it.

#### The objective panel does not change hands visibly, and that is the point

`ui/objective.js` has been naming the next thing to do since the first frame -
derived from the live map, always true, never a script. For the first half of
World 1 it is her, genuinely helping her friend. After she is taken it is the
thing wearing her, and **the panel is identical either side.**

That is the difference between a twist and a cheat: **the game never lies. The
source of the instructions changes and the instructions do not.** Every price,
every route, every "N OF 4 SONS RETURNED" stays accurate, because the panel is
derived from real state and could not lie if it wanted to. What changes is who
wants the player to keep going, and there is no way to see it.

And it disarms the Embalming Chamber notebook, which an earlier draft had as a
trap. It is not. **The four niches are chalk-numbered in the wrong order because
she tried the jar chain and got it wrong.** She is an archaeologist doing her
job badly under pressure, in the dark, with something killing her crew. There is
nothing sinister in that room. That is what makes it hers.

**PROPOSAL: unnamed, and she has no body until the Serdab.** For twenty-five
waves she is a lamp ahead in the dark and a voice, and the Serdab is the first
time she has a form at all - which is also the first time the player gets a good
look at what she has become. She can see him well enough to be certain; he never
quite sees her. Gender is fixed by the owner's words. Appearance is the owner's
call and is deliberately not made here.

### The player

Undefined in the transcript and in the build.

**PROPOSAL: the player is the archaeologist's hired man, and he was already dead
before the game starts.**

Argued from what the game does rather than from what would be interesting:

- **The economy is a looter's economy.** Gold comes off the dead and buys guns,
  doors and the favour of gods. Not a scholar's relationship to a tomb.
- **The death card judges him personally.** UNWORTHY only lands on somebody who
  could plausibly be found wanting.
- **The sealed doorway is bought, not unlocked.** He is the one who opens it.
  Somebody hired him to.
- **He starts the run holding grave gold and has never been inside.** Difficulty
  hands out 750, 500 or 400 gold on the first frame. Nobody put that there for
  story reasons and it is there.
- **It makes the twist personal.** A stranger at the bottom of a tomb is a
  curiosity. The person who brought you here and stopped answering is a twist.

**World 1 never says when he died and must not.** Fixing the moment would mean
staging a transformation on a random gameplay event, and it would make the first
death special when the entire value of the pattern is that no death is. The
player's first death is a repeat of something that already happened offscreen.
World 2 supplies the when.

**PROPOSAL: he is never named and never speaks.** The first identity he gets is
his own face on the box art at the end of World 3, which the transcript already
specifies shows "you and the archaeologist and the soul". That is a better first
look at yourself than a name on a HUD, and it is the only name a man with an
empty cartouche is ever going to get.

Rejected: a soldier or mercenary escort. It explains the guns and nothing else,
and it makes him a professional where the game wants him out of his depth.
Rejected: a descendant or a chosen one. The tomb calling him UNWORTHY is the
correct relationship and a bloodline contradicts it.

---

## The map is the act structure

`MAP.md` ratifies three acts, three loops. World 1 uses them as written. Wave
numbers are design intent; the economy paces the actual crossing and should not
be forced.

| Act | Waves | Rooms | Boss | What the act is FOR |
|---|---|---|---|---|
| 1 | 1 - 5 | avenue, Quarry, Canal | **ANUBIS** (5) | you are a robber and the tomb has noticed |
| 2 | 6 - 15 | Chamber of Ascent, Hall of Offerings, Granary Vault, Great Gallery | **AMMIT** (10), **APEP** (15) | somebody else has been down here, recently |
| 3 | 16 - 25 | Embalming Chamber, Canopic Crypt, Star Shaft, King's Chamber, Serdab | **SEKHMET** (20), **SET** (25) | put the name together, then find the niche empty |

**World 1 runs twenty-five waves and ends.** Five boss waves, one per god, no
cycling. `boss.js` `forWave()` cycles the roster forever and nothing in
`main.js` or `director.js` can conclude a run; that is correct for an endless
build and wrong for a world with an ending. Largest engine gap in the document,
listed under Open Questions rather than acted on.

Rejected: ending at wave 15 to keep it short. Three of five gods would never be
seen and the roster is built and paid for. Rejected: a free-length world that
ends when the jars are in. Some players solve the chain at wave twelve and some
never will, and a world that ends at an unpredictable moment cannot stage a
final boss.

### Why each god is where it is

None of these are moves. Every one is the god the cycle already puts on that
wave, in the room the map already puts the player in.

**ANUBIS, wave 5, the avenue and the Act 1 circuit.** Opener of the ways,
conductor of the dead; abilities `summon` and `charge`. The first boss in the
game raises more of them in front of you, which is the world's thesis delivered
in one fight. Fought outside, in a straight corridor with two bought pockets,
which is the hardest ground in Act 1 and is meant to be.

**AMMIT, wave 10, the Great Gallery.** Ammit eats the heart that fails the
weighing, and by wave 10 the player has almost certainly read THE HEART
OUTWEIGHS THE FEATHER. Wave 10 is the game showing them what has been failing to
finish the job. It happens in the biggest room in the map, under sixteen units
of ceiling, on the two-loop floor - the only room that can hold `slam` and
`volley` at once.

**APEP, wave 15, the Star Shaft.** Serpent of the outer dark that swallows the
sun, fought at the bottom of thirty units of vertical void aimed at the stars,
with the columns deliberately truncated so the emptiness above is what the room
is about. Apep teleports and volleys, the only ability pair that uses vertical
space. This pairing was already perfect and nobody placed it on purpose.

**SEKHMET, wave 20, the King's Chamber.** The lioness sent to slaughter mankind
and stopped only by a trick. Charges and slams, 9600 health, fastest god in the
roster. The largest room in the map, and since the two portals landed it is a
room you can circle. On Hard it is not, until 1250 is paid.

**SET, wave 25, the King's Chamber. The final boss of World 1.** The usurper who
murdered his brother and took his place. `boss.js` describes his crown in its
own comment as "the animal nobody has ever identified... exactly why it reads as
WRONG rather than as any animal the player can name". A god whose own shape is
not identifiable is the correct vessel for a thing that wears other people. He
is also the only escalating boss, unlocking one more tell per quarter of health,
so the last fight of the world is the only one where the player has to read more
than two things at once.

---

## Where the story is told

No cutscenes, no dialogue system. A beat that needs either is a beat that will
not ship. The complete list of channels that exist today:

| Channel | File | Good for |
|---|---|---|
| **The objective line** | `ui/objective.js` | the spine. One line, derived from the live map, never a script. It is also the archaeologist's instructions, and it does not have to change for that to be true. |
| **The notice pill** | `main.js` `showNotice(text, ms)` | events. Already carries THE KINDLING TAKES - THE PYRAMID WAKES. |
| **The death card** | `ui/death.js` | the theme, as a verdict, delivered on average twenty times a run. The most-read text in the game. |
| **The interact prompt** | `ui/interact.js` | one line under the crosshair, with a refusal reason when a thing is not for sale at any price. |
| **The shrine boons** | `systems/shrines.js` | six named gods and what each grants. Buying one is choosing a patron; dying loses all of them. |
| **The canopic jar chain** | `rooms.js`, `doors.js:289` | four jars, four niches, one gate. UNBUILT, and the largest available surface. |
| **The geometry** | `rooms.js` propSlots, `world/build.js` | everything else. A typed data list with positions and rotations. |
| **The boss telegraph** | `boss.js` `setGlow()` | an emissive ramp the player is trained to read as "something is coming and you cannot stop it". |

Six rules follow, and they govern every beat below.

1. **The objective line is the narrator, and it is derived rather than
   scripted.** Story enters it as MILESTONES with a `done()` reading real state,
   exactly like the six rungs already there. Bolting a script on breaks the one
   property the file was built for.
2. **The notice pill is the only voice.** One line, a few seconds, no queue.
   Used for turns, never for exposition.
3. **The death card is the loudest channel in the game** because it is the one
   the player reads most. It carries the death-loop plant and nothing else.
4. **The geometry carries everything the text channels cannot**, which is almost
   all of it.
5. **The telegraph glow is a loaded gun.** Twenty-five waves teach the player
   that a gold ramp means something is about to happen to them. It is used
   exactly once on something that is not a boss, and that is the twist.
6. **Nothing is told twice, and the central idea is never told once.**

---

## She asks, and then she stops

The device: she asks the same impossible question five times in five different
ways, and then she is taken, and **nothing appears - something is subtracted.**
The clue is a removal. The dog that did not bark, running inside a wave shooter.

Three things have to be true or it collapses, and they are the whole design of
this section:

1. **She has to ask enough times, in a recognisable shape, that the silence is
   loud.** Two is not a pattern. Five is.
2. **The player is never told it happened.** No notice saying she seems
   different. The only record is the absence.
3. **It has to be findable on a replay.** A second-run player should be able to
   name the exact moment. That is the reward for the device and it is what makes
   it a structure rather than a trick.

### 1. How she speaks at all

**This is the load-bearing question. If she cannot speak, the beat collapses.**

The game has one text channel that is not the objective panel:
`showNotice(text, ms)`, `main.js:912`. Seven lines long. It writes
`notice.textContent`, adds a class, clears one timer and sets another. It is
handed to about eleven systems - shrines, power, doors, wall buys, the box, the
Altar, power-ups, grenades, the economy.

Three problems, and they are real:

| Problem | Why it matters |
|---|---|
| **No queue.** A second call overwrites the first mid-sentence. | The player buys things constantly. "Need 400 more gold" would eat her. |
| **No attribution.** A line in that pill has no speaker. | Her voice would read as a system message. |
| **Wrong register.** The pill is terse, systemic, and in capitals. | So is every other string in the game. |

**PROPOSAL, and it solves all three with one property: she is the only lowercase
text in the game.**

Everything in this interface is capitals. THE KINDLING TAKES - THE PYRAMID
WAKES. ANUBIS WEIGHS YOUR HEART AND RETURNS IT. BUY THE SEALED DOORWAY. UNWORTHY.
N OF 4 SONS RETURNED. Boon names go through `.toUpperCase()`. There is not one
lowercase character on the HUD.

So she gets lowercase, in the same pill, in the same place. No new element, no
new position, no new vocabulary the player has to be taught. **The shape of the
text is the attribution.** A player does not need to be told that a different
kind of thing is speaking, and the one human voice in the game being the only
one not shouting is the correct relationship between her and everything else on
screen.

`ui/tokens.js` already establishes that this interface signals category through
treatment rather than through words - `objective.js` takes a lapis inlay for
gates gold cannot buy, described in its own comment as "the one signal on the
HUD a player can read without reading it". Lowercase is the same move in a
channel nobody has used.

**Collision is fixed with a hold, not a queue.** Her lines cannot be clobbered;
a system notice arriving during one is dropped rather than deferred. A queue
would make the game talk over itself several seconds later, which is worse. Cost:
one boolean and one timestamp in `showNotice`.

There is exactly one exception to the hold and it is the whole point. See below.

### 2. Where she is, and why he never answers

**She is ahead, in the dark, with a lamp.** She is never a body in World 1. The
player sees a lamp at distance in the rooms with real sightlines - the avenue,
the Hall of Offerings down the colonnade aisle, the Great Gallery from the floor
to the far ledge, the Star Shaft looking up - and she calls back. She can see
him well enough to be certain it is him. He never gets a good look at her.

**PROPOSAL: this also retires the camp gradient's biggest weakness.** The lamps
that get warmer as the player descends are not traces she left. They are her,
just ahead. The player has been following a living person the whole time and
reading it as archaeology.

**He never answers, and this is the sharpest thing available.** The player has
no voice. To the player that is a genre convention so ordinary it is invisible -
first-person shooters do not have a talk button. To her it is fifteen waves of
calling to someone who will not say anything back.

**The player's silence is a UI limitation to the player and a symptom to her.**
That is the device working for free, in a channel the game does not have.

### 3. What she is actually asking

Never "how are you alive". She asks **around** it, the way a person does when
the direct question is unaskable, and every one of them is her **checking
whether she is the one who is wrong.**

The shape, repeated five times: she offers him a chance to correct her memory,
and he never takes it.

| # | Where | The line | First run | On replay |
|---|---|---|---|---|
| 1 | the avenue, on the walk from `(0, 30)` | "i keep thinking you were further back. that walk in." | small talk under stress | she is describing the order they walked in when he was killed, and asking him to tell her she has it wrong |
| 2 | Chamber of Ascent, just inside | "how many of us came in. i keep getting it wrong." | counting the crew | she counts the living and gets a number that includes him |
| 3 | **Great Gallery, mid-wave, from the far ledge** | "you sound-" | a bad line, a loud room | she almost has it, and stops herself |
| 4 | Canopic Crypt, Act 3 | "did anything happen to you. down there. anything you'd want to tell me." | are you hurt | she is holding the door open for him to say it, and he cannot |
| 5 | Embalming Chamber, at the Kindling | "there's something i've been meaning to ask you since we-" | interrupted | the last thing she ever says |

Line 3 is the owner's "very intense scene": the Great Gallery is the biggest
room in the map, sixteen units of ceiling, two ledges and a bridge, and it is
where the player is most likely to be fighting for their life while a woman six
metres up says half a sentence about them. **It passes by.** It is also a
removal inside the pattern, which pre-trains the player on her stopping short
without them knowing they are being trained.

**Boss waves suppress her.** Her lines defer to the next eligible room entry
rather than firing into a boss fight. Two-line guard, and it protects the
pattern from being spent on the one wave nobody will hear it.

### 4. Where she stops: the Kindling

**The coordinator proposed the power coming on. Checked against `power.js` and
`rooms.js`, it is correct, and there is an argument for it nobody had.**

The Kindling is the lever in the Embalming Chamber that powers the map. What it
does, from `systems/power.js` `onPowered()`:

- a light ramp across nine rooms, already started by `build.js` before this runs
- `audio.bossHorn()`, then `audio.shrineChime()` 260 ms later, deliberately two
  sounds so it does not read as one undifferentiated noise
- six dead shrines wake
- the crypt-to-King's-Chamber gate opens
- **`notice?.(LIT_NOTICE, 3200)`**

It is mandatory (rung 4 of the objective ladder), it happens exactly once per
run, it costs no gold - "the price of the Kindling is the trip" - and it is the
loudest event in the map.

**And it occupies her channel for 3.2 seconds.** That is the finding. The cover
for the device is not something anyone has to design. It is already there, in
the shipped build, in the same seven-line function she would be speaking
through.

So: **line 5 is the one exception to the hold.** She starts it. THE KINDLING
TAKES - THE PYRAMID WAKES overwrites it mid-sentence, exactly as
`showNotice` has always done to everything. The player watches the game erase
her, in a frame where nine rooms are coming up and two sounds are landing and
six shrines are waking.

And she never speaks again.

The player has been trained for fifteen waves that her lines always finish,
because they hold. The one time a line is cut off is the last one. That is the
same "trained expectation, violated once" device the Serdab reveal uses on the
boss telegraph glow, which makes it the game's design language rather than a
one-off trick.

**Ten waves of silence follow**, waves roughly 16 to 25, all of Act 3. She is
still seen. The lamps still move ahead. The rope in the Star Shaft still gets
rigged. **Nothing visibly changes.** The dog is still in the room.

Alternatives considered and rejected:

| Moment | Rejected because |
|---|---|
| First use of the Altar of Ptah | optional. Not every run does it, and the beat must be on the mandatory spine. |
| A boss wave | bosses recur every fifth wave; there is no unique landmark to name on a replay. |
| Entering the pyramid | too early. She has only asked once by then. |
| Buying into Act 3 | there are three gallery gates and the player picks. Not a single moment. |

The Kindling wins on every axis: mandatory, unique, once, loudest, and it
already holds the microphone.

### 5. What it costs

- A one-shot voice list: `{ room, line }`, fired on first entry, suppressed
  during boss waves. `spaces.roomId` and `objective.js`'s `here()` already
  answer "which room is the player in". Small.
- Lowercase styling on the notice pill: one class.
- The priority hold: one boolean, one timestamp, one deliberate exception.
- Her lamp at distance in four rooms: propSlots, already proposed.
- **No dialogue system, no cutscene, no VO, no new UI element, no new position
  on screen.**

## The camp gets warmer

The whole staging of the twist, done entirely in `propSlots`.

The player has to arrive at the Serdab already knowing a living person is down
here, without a line of text saying so. The archaeologist's kit is scattered
through the map in a gradient, and the gradient is **temperature**.

- **Act 1.** Sun-bleached. Rope frayed, chalk washed out, a survey peg leaning
  over. Weeks old.
- **Act 2.** Crisp. Chalk sharp, numbers legible, a lamp with no flame in it.
  Days old.
- **Act 3.** Warm. A lamp still burning in the Canopic Crypt. Hours, or none.
- **The King's Chamber has nothing modern in it at all.** The trail stops at the
  door of the boss arena. Whoever left it either never went in or never came
  out.

| Room | What is there | Reads as |
|---|---|---|
| Courtyard, west chapel 1 | jar 1 (already placed, `courtyard.js:2285`), a coil of survey line, peg 01, bleached | somebody catalogued this and left |
| Courtyard, the sealed doorway | the first **effaced cartouche**, chiselled, with fresh chalk survey marks around it | somebody has been erasing names, and recently |
| Chamber of Ascent | folding stool, cold lamp, chalk arrows pointing at BOTH debris doors | they mapped it and could not decide either |
| Hall of Offerings | the ten colonnade columns chalk-numbered 01 to 10 | a survey, done properly |
| Granary Vault | an empty stand with a chalk outline round where a jar used to be | jar 1 moved outside in `MAP.md`. The outline is the diegetic reason, and it turns a data move into a beat for free |
| Great Gallery | rope strung as a handline along both ledges and across the bridge | somebody rigged this room to be walked safely, so they expected to come back |
| Embalming Chamber | a notebook open on the offering table, chalk numbers 1 to 4 above the four niches **in the wrong order** | they tried the chain and got it wrong. This is why they hired somebody who cannot be stopped by failing |
| Canopic Crypt | a lamp, lit | they are here now |
| Star Shaft | a rope going up into the dark that ends at nothing | they went looking upward and it did not help |
| King's Chamber | nothing | the trail stops |
| Serdab | the stool, the lamp, the notebook | this is where they have been sitting |

**PROPOSAL: six new propSlot types.** `lamp`, `stool`, `peg`, `chalk`, `rope`,
`notebook`. All boxes and cylinders. `rooms.js` is pure data and `build.js` is
the only module allowed to turn a record into a mesh, so this is additive in the
shape the file was designed for.

Rejected: audio logs, readable journals, found footage. All three are a dialogue
system in a costume. Rejected: making the traces collectibles with a counter.
The gradient works because the player is not counting; a tally makes it a side
quest.

---

## The name assembles

The four-jar chain is not a side puzzle. It is the rescue, and it is the job the
player was hired for.

Already in the data, none of it wired:

| Jar | Son of Horus | Where it stands today | Guardian goddess |
|---|---|---|---|
| 1 | Imsety, human-headed, the liver | courtyard, west chapel 1 | Isis |
| 2 | Hapy, baboon, the lungs | Star Shaft | Nephthys |
| 3 | Duamutef, jackal, the stomach | Canopic Crypt | Neith |
| 4 | Qebehsenuef, falcon, the intestines | King's Chamber | Serqet |

Four niches wait in the Embalming Chamber, one per son, order irrelevant
(`rooms.js`). The Serdab portal is `kind: 'puzzle'`, `cost: 0`, and
`ui/objective.js` already prints `N OF 4 SONS RETURNED` as its detail line
rather than a price, because a gate gold cannot buy is not a price.

**PROPOSAL: each returned jar restores one glyph of her name.**

The Serdab holds a cartouche cut into the back wall with the glyphs struck out,
visible through the doorway before the door will open. Every jar home lights one
glyph. The fourth completes it and the name is readable for the first time:
**MERESANKH**.

What that buys, for very little:

- The existing objective line becomes the story's progress bar with no code
  change. `2 OF 4 SONS RETURNED` already means "you are halfway to knowing who
  she is".
- The reward for the puzzle is a WORD ON A WALL, the cheapest art asset in the
  project.
- It makes the belief the death card already runs on into a mechanic. A name is
  a person. Reassembling it is the rescue attempt; finding the niche empty
  afterwards is the failure of it; and the player doing the reassembling has an
  empty cartouche of his own that nobody is coming to fill.
- The four goddesses behind the four sons - Isis, Nephthys, Neith, Serqet - are
  in neither the boss roster nor the shrine list. A clean quartet is available
  if the chain ever wants more than glyphs. Noted as material, not proposed as
  work.

Rejected: the jars restoring health, gold or a weapon. The Sunspear is already
the Serdab's reward and the shrine cap already lifts from 4 to 6 (`shrines.js`
`CAPACITY`, `raise()`). Those stay. What the chain gains is a MEANING, not a
second prize.

---

## The Serdab is the stage

The observation the ending rests on, and it is architectural rather than
literary.

```
serdab   1 portal   0 spawns   196 units   the smallest room in the map
```

`rooms.js` gives the Serdab **no spawn points at all**, deliberately, and says
why: the trainability law binds rooms that spawn things, so the honest fix for a
one-door reward closet is to stop it spawning rather than write an exemption.

The consequence nobody has written down until now: **the Serdab is the only room
in this game where the player can be alone.** Every other space in twenty-five
waves has a horde in it or a horde arriving. There is exactly one room where a
beat can be delivered without something walking up behind the player, and it is
already built, already gated behind the four-jar chain, and already sized like a
chapel.

That is where the twist happens. Not because it is thematic. Because it is the
only room that can hold it.

**PROPOSAL: the Serdab holds ten rock-cut figures of the same woman, shoulder to
shoulder along the fourteen-unit back wall, and an eleventh niche cut into the
side wall on its own, empty.** Ten is the count in the real Meresankh serdab at
Giza and shoulder to shoulder is how the real one reads. The eleventh stands
apart rather than at the end of the row, so it reads as an omission rather than
as a gap somebody has not got round to filling.

### And a serdab is where the soul is kept

This is the argument that settles the room, and it is not decorative.

In a real Egyptian tomb the serdab is a sealed chamber holding the ka-statue,
with eye-slots cut through the wall so the statue can look out into the chapel.
**It is the room where the soul lives.** The body is in the burial chamber. The
serdab is somewhere else, on purpose, and it is where the part of the person
that is not the corpse is kept.

The player is looking for a soul. The room in an Egyptian tomb where a soul is
kept is already in this map, already behind the game's only gate gold cannot
buy, already spawning nothing, and already empty of purpose - `rooms.js` says
its payoff is "authored by the puzzle chain, which lands with the rest of M5."

### The eleventh niche is the way down

`docs/WORLDS.md` needs an exit out of the bottom of World 1 and it has to be a
real one. Checked against `rooms.js`, three candidates:

| Candidate | Verdict |
|---|---|
| **King's Chamber** | REJECTED. It is the deepest room in Z (-232 to -272), the largest in the map, and the boss arena. `MAP.md` ratified that it wants floor rather than furniture and stripped its `interactSlots` to nothing. Putting the world's exit in the room where the final fight happens means the player crosses it repeatedly during that fight, which deflates both. It also holds the sarcophagus, which is the BODY's room - and the entire twist is that the body is not what anyone is looking for. |
| **Star Shaft** | REJECTED. Thirty units of void, columns deliberately truncated so the emptiness above is what the room is about. It is the one room already built around vertical space and it points the wrong way. It is the anti-descent, and the rope in it that goes up into the dark and ends at nothing is already doing the job of telling the player that up is not the answer. |
| **Serdab** | **YES.** |

The Serdab is a room that exists, is built, has no assigned purpose, sits behind
the game's only non-monetary gate, has no spawn points so nothing can follow the
player into it, and is by definition the room where a soul is kept. Building a
new room for this would be building a worse Serdab.

**PROPOSAL: the way down is the eleventh niche itself.** It is a person-sized
recess cut into stone with nothing in it. After the beat it is not a niche, it
is a shaft.

The player enters World 2 by climbing into the space where she should have been.
The absence is the exit, which means the one object the entire ending is about
does two jobs and no new geometry does either of them.

Rejected: a trapdoor, a collapsing floor, or a stair revealed behind a statue.
All three are a second object doing a job the first object can do, and all three
announce themselves as a mechanism. The niche announces nothing. It is the same
hole it has been since the player first walked in here at wave fourteen and
found it empty.

---

## The boss encounter: SET, and how "it goes away" reads

The transcript: "it doesn't really die, it just goes away because it raises the
dead again."

`boss.js` has one death sequence shared by all five gods: `deathT` ramps, the
body topples ninety degrees on an axis derived from the killing shot,
`setGlow(max(0, 1 - deathT * 0.6))` fades the gilding out, and after 1.9 seconds
the body sinks through the floor while it scales to half.

**PROPOSAL: Set gets a variant of that death and nothing else in the fight
changes.** Four beats, all reusing channels that exist.

1. **The topple runs exactly as built.** The player gets the kill they earned.
   Whatever they did, it worked on the body.
2. **The eye emissive goes to zero first.** `mats.eye` dark, so the face is out
   before anything else happens. The god is finished.
3. **Then the gilding flares.** `mats.accent.emissiveIntensity` to full for
   about a third of a second, brighter than any telegraph in the game, on a
   corpse. Then out. The read is precise and it is not a ghost: the thing
   lighting up is the METAL, not the god. Something left through the ornament.
4. **On the flare frame, every live actor in the room stops and turns to face
   the Serdab door.** One second. Not an attack, a re-aim. Then they come back
   at the player as if nothing happened.

Two absences sell it:

- **No gold.** Every other boss pays. This one does not.
- **The objective panel does not advance.** It has named the next thing to do
  continuously since the first frame. After Set falls it holds, for a beat, on
  nothing. A panel that has never been silent going silent is the loudest thing
  this interface can do, and it costs a null return.

Rejected: a wisp or spirit flying out of the corpse. It needs a particle system
the game does not have, and it tells the player what happened where the flare
and the turned heads make them work it out. Rejected: Set standing back up for a
second phase. That reads as a fight, and the entire point is that the fight is
over and it did not matter.

**And the player has seen this before, from the inside.** Something that is
killed, goes out, and comes back is the shape of every death card they have read
this run. World 1 never draws the line. The line is there.

---

## The Mario twist, staged

The transcript: "we find that the spirit's not there. Instead we find... the
archaeologist, and the archaeologist is secretly possessed."

**PROPOSAL: the player does not FIND the archaeologist. The player is
delivered.** Everything in World 1 was a job: open the doors, clear the gates,
carry the four jars, put the name back together, and bring it down to the one
room the archaeologist could not open. The Embalming Chamber notebook has the
niches numbered wrong. They tried and failed and hired something that could keep
failing until it succeeded.

The staging, in order.

**Before wave 25, if the player solved the chain early.** The jars go home, the
name completes, the Serdab opens, and the player walks into a small room with
ten carved women, one empty niche, and a folding stool with a lamp beside it.
Nobody there. They take the Sunspear and leave.

That early visit is not a spoiler; it is the setup. Returning to a room you have
already stood in and finding somebody sitting in it is stronger than opening a
door onto a stranger.

**Set falls.** The flare, the turned heads, the silence on the panel.

**The panel comes back with one line it has never printed.** No purchase, no
price, no gold figure. A place. `ui/objective.js` is a ladder of milestones with
a `done()` and a room, and `toward()` already turns "do X in room R" into "here
is what stands in the way". This is one more rung and the file was built to take
it.

**The player walks to the Serdab.** Nothing follows: it has no spawn points, and
twenty-five waves have trained the player to expect that something will.

**The eleventh niche is still empty.** She is not here. The Peach beat,
delivered by an absence in the geometry with no text at all.

**She is sitting on the stool.** Facing the empty niche, back to the door. The
lamp that was burning in the Canopic Crypt is beside her, and the stool is the
one the player has been finding since the Chamber of Ascent. She does not move
and she is not hostile.

**This is the first time in the game she has a body**, and the first time she
has been still. For twenty-five waves she has been a lamp ahead in the dark
moving away from him, and now she is stopped, and she does not turn round.

**She has not said anything for ten waves and the player has not noticed.** That
is the beat the whole world was built to deliver, and it lands here as a
sensation before it lands as a fact: the player walks into a small quiet room to
meet the person who has been talking to them all game, and realises on the
threshold that she stopped.

**The crosshair finds them and the interact prompt fires.** The same one-line
prompt that has quoted a price on every door, gun, shrine and altar in the game.
This is the one fixture in the map that is not for sale. `ui/interact.js` already
has a refusal path that quotes no price at all, and states in its own header why:
a player who cannot tell "come back richer" from "come back later" will grind
gold for something that will never be offered. This fixture has neither. It has
a name and an [F].

**On F, three things happen and then the world ends.**

1. She stands and turns.
2. The effaced cartouche the player has been finding chiselled into walls since
   the first minute of Act 1 is on her. **PROPOSAL: on the lamp** - the object
   the player has followed all game, and already a light source, so the sign is
   lit from inside.
3. Her eyes take the telegraph ramp. `setGlow`'s exact curve, on a person, in
   the one room with no enemies in it.

**She does not ask him anything.** That is the fourth channel saying it, after
the ten waves of silence, the interrupted last line, and the sign on the lamp -
and it is the only one the player can feel without having worked anything out.
The one person in the world who has been trying to make sense of him looks
straight at him and has no questions.

Then black, and the card.

Step 3 is the twist. Not the cartouche and not the empty niche - those are the
information. The glow is the twist, because the player already knows what it
means. They have been taught for twenty-five waves that a gold ramp is a wind-up
they have between half a second and one and a quarter seconds to answer, and
there is nothing here to shoot, nowhere to run, and the world ends before the
tell resolves.

That is how you stage a reveal in a game with no cutscenes: you say it in the
one language the player was forced to learn.

### The end card

**PROPOSAL: World 1 ends on a card in the death card's format, and it is a
verdict, not a victory.**

`ui/death.js` builds a cartouche with a shen bar, one word inside, one line
beneath. The World 1 card is the same frame. Inside the cartouche: the glyphs,
struck out. Beneath it:

```
THE NAME IS NOT HERE
```

It says the twist without mentioning the archaeologist. It repeats the shape the
player associates with a judgement being passed on them. It is the first time
the game has shown that frame when the player did not lose. And it is the third
empty cartouche in the world, which is the count that makes the player look back
at the other two.

Rejected: VICTORIOUS, or any word in the UNWORTHY slot. This game's card format
is a verdict about the player, and "you won" is not one. Rejected: putting this
on `ui/death.js` behind a flag. That file's own comment says the card is part of
the death sequence and should not exist in the page of a game nobody has died in
yet; a world-end card is a sibling module borrowing the same tokens.

### And then the player is in the niche, going down

**The card IS the cut.** The player confirms it, and when the frame comes back
they are in the shaft the eleventh niche became, descending. World 2 begins in
the fall.

This is not a cutscene and it is not new technology. It is exactly what
`ui/death.js` already does, once or twice a run, every run:

- a card comes up over a stopped world
- a confirm gate arms after a beat and waits indefinitely, Enter only, refused
  if the key was already held
- while the player reads it, `toTheBeginning()` calls `spaces.enter()`, which
  swaps the collider set, retargets the audio, moves the sky's lights and holds
  a curtain at full black for two DRAWN frames
- the frame comes back and the player is standing somewhere else

**World 1's ending is the death card's machinery with a different word and a
different destination.** The hardest part of ending a world - changing the world
underneath a player who cannot see it happening - is a solved problem in this
codebase and has been since `a8baa5b`.

Rejected: a fall animation, a fade through rock, or a shaft the player descends
under their own control. The first two are cutscenes. The third sounds better
than it is: the player has just been given information they cannot act on, and
handing them thirty seconds of walking down a hole to think about it is thirty
seconds for the beat to cool.

---

## What World 1 must plant

Twenty things. Worlds 2 and 3 pay off all of them, and anything dropped here has
to be re-established later at a worse moment. Eleven of the twenty already ship
or cost nothing but a refusal.

**The death loop, planted and never confirmed:**

1. **The contradiction on the death card.** Judged, sentenced, erased, and back
   on your feet. Ships today, costs nothing, and the player reads it more often
   than any other text in the game.
2. **The player's cartouche has a verdict where a name should be.** Ships today.
3. **What a return costs.** Gold and doors keep; the gods' favour does not. The
   pantheon withdraws a little further every time.
4. **You always wake up outside the door.** Ships today.
5. **Anubis as the control case.** The one return that is announced, named,
   paid for and legitimate, which is what makes every other return read as
   something else.

**The story, planted openly:**

6. **The effaced cartouche as a recognisable sign, and as her name.** The mark
   the player reads as the villain's and the name they reassemble in the Serdab
   are one object. World 2 opens with it somewhere it has no business being.
7. **The camp gradient, and that lamps get warmer.** World 2 is entered
   following a person and the player already knows how to track one.
8. **The empty eleventh niche.** World 2 is the search for what should have been
   in it.
9. **A completable set.** Four sons, four niches, four glyphs. World 2 needs its
   own "collect the pieces and something becomes readable", and it is easier to
   vary a form the player knows.
10. **The law: kill the vessel, the thing moves on.** World 2's crescendo
    repeats it with a person instead of a god, which is the only way that beat
    is horrifying rather than confusing.
11. **The horde belongs to somebody.** Set falls and every live actor stops and
    turns toward the Serdab. World 3's horde is her, distributed, and this is
    the only moment in World 1 that says the dead have an owner.
12. **The player is doing her work and calling it a rescue.** Four jars, four
    glyphs, a name reassembled, carried down to the one room the archaeologist
    could not open. World 1 must let this read as heroism and must not wink.

**The descent, planted as architecture:**

13. **The enclosure, ending at five units.** Three worlds tighten and then the
    floor opens onto no ceiling at all. If World 1 gains a taller last room, the
    inversion has nothing to invert. Costs a refusal, not a build.
14. **The Star Shaft as the last time up is offered**, with a rope in it that
    goes up into the dark and ends at nothing. Nothing after it points at the
    sky until the sky is wrong.
15. **The inside is bigger than the outside.** True in the shipped build, stated
    in `rooms.js`'s own header, never acknowledged by the game. The first
    symptom that this is not a building. Costs nothing and only has to survive
    somebody deciding to "fix" it.
16. **The pyramid's silhouette on the skyline.** The 62-unit stepped mass the
    player walks an avenue toward in the opening minute is the first image this
    game ever shows them, and at the bottom of World 3 they see it again from
    outside and upside down. It is the one shape in the project that will never
    need a caption, and it only works if World 1 spends real time pointing the
    player at it. It already does.

**The friend, planted as a pattern and then as a silence:**

17. **Her five questions, in a recognisable shape.** Reconciliation, never
    curiosity, always giving him the chance to correct her. The pattern is the
    only thing that makes its ending audible.
18. **Lowercase as her voice.** Established from the avenue, before the player
    has any reason to notice it, so that it is a property of the world rather
    than a device introduced when it is needed.
19. **The silence itself, ten waves of it, unremarked.** World 1 pays this off
    at the Serdab. World 2 pays it off again when the player kills her, and the
    thing they have to sit with is that she stopped being available to save
    somewhere back in Act 3 and they were busy.
20. **`(0, 30)` unmarked.** No prop, no stain, no line. If World 1 ever
    annotates the spawn point, the character stops being a man who does not know
    and becomes a man being told, and every one of the other nineteen plants is
    downstream of him not knowing.

---

## The decisions, and what they cost World 1

Closed by the owner 2026-08-01. Recorded here with the transcript lines they
resolve, so nobody reopens them from the raw source.

### 1. One spirit, many vessels

The transcript went back and forth. At 00:00:52 Speaker 1 says the
raising-the-dead spirit "doesn't really die, it just goes away because it raises
the dead again". At 00:00:59 he says the archaeologist is possessed by "the
raising-the-dead thing". At 00:01:19 Speaker 2 corrects him: "No, no, no, by the
main spirit." Speaker 1 accepts: "By the main - the main dead spirit, right, the
main evil spirit."

**Settled: there was only ever one.** The thing that raises the dead, the thing
in the wave-25 boss, the thing in the archaeologist, and the woman the player is
trying to reach are one entity wearing whatever is available.

**Cost to World 1: nothing.** The document was already written against this
reading. What it gains is that three separate things now resolve to one object -
the sign carved on the walls, the name in the Serdab, and the antagonist are the
same. There is no second nameless thing to track and no second name to find a
channel for.

### 2. The archaeologist dies in World 2. The spirit does not.

The transcript: "Maybe we kill the archaeologist, and the archaeologist, uh, you
know, I don't know, something." The owner has closed it: "the archaeologist dies
in world two - not the spirit, just the archaeologist."

**Cost to World 1: nothing.** World 1 never had to know. What it must not do is
give the archaeologist a send-off in the Serdab that implies they are finished
there - they stand, they turn, the eyes light, and the world ends. That is a
handover, not a death, and it was already written that way.

### 3. Killing the vessel does not remove her. It distributes her.

The consequence the owner drew from the first two, and the strongest structural
idea in the project after the descent: "the spirit becomes kind of like the
compounding of all the enemies in world three."

```
World 1   the boss goes away        because it is not a person
World 2   the archaeologist dies    because a body was only ever a container
World 3   nothing is left to hold her, so she is in all of them at once
```

Worked out in full in `docs/WORLDS.md`, including what the re-condensation
final boss needs from `director.js` and `boss.js`.

**Cost to World 1: one line of restraint.** The Set flare beat must read as
something LEAVING, never as something being destroyed or dispersed. It already
does: the eyes go out, the gilding flares once, the horde turns. Nothing in that
beat says where it went, and nothing in it should.

---

## Open questions

Ordered by how much they block. Each is a question with a recommendation, not a
menu.

1. **World 1 needs an ending and the game has no concept of one.**
   `boss.js` `forWave()` cycles the five gods forever; nothing in `main.js` or
   `director.js` can conclude a run.
   **Recommendation: World 1 terminates at wave 25 on Set's death.** Endless
   mode stays as a separate mode off the start screen, where the existing cycle
   is exactly right.

2. **The four-jar chain is unbuilt.** `doors.js:289` hardcodes
   `jarsReturned: 0` with a comment saying the jar system lands with M5. Props
   and niches are placed; carry, return and counter are not.
   **Recommendation: build it, because the ending is gated on it.** This
   promotes the easter-egg chain to the main line, which `MAP.md` already
   implied when it moved jar 1 outside "so the mission starts before the pyramid
   does".

3. **Does the death card get a resurrection count?** `state.resets` already
   exists in `ui/death.js` and the stats line already prints
   `WAVE 05 · 1240 GOLD`.
   **Recommendation: yes, and use the antagonist's own verb.** `RAISED 04`,
   third field, same tabular numerals, no comment anywhere else in the game.
   That is the single cheapest and strongest plant available: the game counting
   the player's resurrections in the same typeface it counts their gold, and
   never mentioning it. If one thing on this list ships, it should be this.

4. **Should the ending be gated on the jars at all?** A player who never solves
   the chain kills Set and has no Serdab to walk into.
   **Recommendation: yes, gate it, and have the objective ladder demand the jars
   before wave 25.** The tracker is derived and can carry a jar milestone the
   same way it carries the Kindling. Forcing the Serdab open regardless makes
   the puzzle decorative and wastes the best surface in the game.

5. **The archaeologist is a fixture that is not for sale**, and
   `ui/interact.js` handlers are `describe()` plus `buy()`.
   **Recommendation: a new handler type whose `buy()` fires the sequence and
   returns false.** Smallest change that keeps the one-raycast, one-prompt,
   one-F-key shape the file was built around.

6. **There is no way to write text on a wall.** The Serdab cartouche needs a
   surface that changes as jars return. `doors.js` already builds a
   `CanvasTexture` (its note at :457), so the capability exists but no room
   fixture uses it.
   **Recommendation: four discrete emissive glyph meshes rather than a canvas.**
   Four booleans instead of a texture upload, and it matches how shrines already
   show held state.

7. **`director.js` has no "stop and face a point" call.**
   **Recommendation: a one-shot on the director rather than state on each
   actor.** It is used once.

8. **`boss.js` has one death path for five gods.**
   **Recommendation: a `farewell` field on the god record, absent on four of
   them.** The dying branch already reads `god.escalating` the same way.

9. **The end card wants to be a sibling of `ui/death.js`, not a flag on it.**
   **Recommendation: a second module sharing `ui/tokens.js`.**

10. **Six new propSlot types** (`lamp`, `stool`, `peg`, `chalk`, `rope`,
    `notebook`) plus one fixture type for the archaeologist.
    **Recommendation: build them as one lane.** All boxes and cylinders, and
    they are the entire environmental storytelling budget for World 1.

11. **Twenty-five waves may be too long for World 1 of three.**
    **Recommendation: ship at 25 and cut on play, not on argument.** The
    economy is tuned around five boss waves and the roster is built. If it
    drags, the lever is wave pacing, not the god count.

12. **Is her name spoken anywhere before the fourth jar?**
    **Recommendation: no.** Nowhere in the UI, nowhere in a notice, nowhere on a
    wall. The whole value of the chain is that it is the only source.

13. **Does the player character get a name?**
    **Recommendation: no.** His cartouche is empty and stays empty. The first
    identity he gets is his face on the box art at the end of World 3.

14. **Chest of the Nameless against the nameless antagonist.**
    **Recommendation: keep both, change nothing.**

15. **Does the depth readout ship with World 1?** It needs a `depth` field per
    room in `rooms.js` and one span in `#r-ammo`, which already stacks
    `Wave 1` over `Difficulty Normal` under exactly the rule a third row would
    follow.
    **Recommendation: yes, and ship it in World 1 even though World 1 alone does
    not need it.** It is the trilogy's progress bar and it is only worth
    anything if it has been honest since the first minute of the first world. A
    depth readout introduced in World 2 is a UI element. One that has been there
    since wave one is a fact.

16. **The map is horizontal and the story is vertical.** Every floor is at y=0
    and "deeper" runs along -Z from -140 to -272.
    **Recommendation: leave it, and author the depths.** Rebuilding nine
    ratified rooms onto a vertical axis buys a number that a data field buys for
    free, and `MAP.md`'s trainability law is written against the layout as it
    stands. This is a finding, not a licence.

17. **Does anything need to change so the exterior pyramid can be reused,
    inverted, at the bottom of World 3?** Nothing in World 1 does. Recorded here
    only so that whoever touches `world/temple.js` or the skyline mass knows it
    has a second job three worlds later.

18. **The notice pill needs a hold and a lowercase mode.** One boolean, one
    timestamp, one class, and one deliberate exception at the Kindling.
    **Recommendation: build it with the voice list, not before.** A hold with
    nothing to hold is a guard nobody can test.

19. **A one-shot voice list keyed on first room entry.** `{ room, line }`,
    suppressed during boss waves. `spaces.roomId` already answers the only
    question it needs to ask.
    **Recommendation: keep it a flat data list in one file, the way `rooms.js`
    is data.** The moment her lines are scattered across the systems that
    trigger them, the pattern stops being auditable, and the pattern is the
    entire device.

20. **Does she have a body before the Serdab?**
    **Recommendation: no.** A lamp and a voice for twenty-five waves, and a form
    exactly once. It is cheaper, it is dramatically stronger, and it means the
    Serdab is the first look the player gets at what she has become rather than
    the second.

21. **What does the player see of her in Act 3, after she stops?**
    **Recommendation: exactly what they saw before.** The lamps keep moving
    ahead, the rope in the Star Shaft still gets rigged. Nothing visibly
    changes. If Act 3 makes her sinister, the removal stops being the clue and
    becomes a confirmation of something the player was already shown.
