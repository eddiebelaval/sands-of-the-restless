# WORLDS - the three-world spine

Written 2026-08-01 against `docs/story-meeting-2026-08-01.md` and six rounds of
owner steering on top of it. The owner's instruction is to map all three,
**finish one**, then go to two and three. This document exists so World 1 can be
finished without Worlds 2 and 3 being invented on the fly later.

Plain text is the transcript, an owner decision, `MAP.md`, or the shipped code.
**LOCKED** is decided. **PROPOSAL** is invented here and can be overruled at no
cost.

> **DECIDED 2026-08-01 by the owner.**
>
> 1. **Her name is MERESANKH.**
> 2. **There is ONE spirit, not two.**
> 3. **The archaeologist dies in World 2. The spirit does not.** Only the body.
> 4. **In World 3 the spirit is the compounding of all the enemies.**
> 5. **The archaeologist and the player were friends. She watched him get
>    killed. She is surprised to see him alive.**
> 6. **He died where the game starts** - the courtyard spawn at `(0, 30)`.
>
> The archaeologist is possessed DURING World 1, not before it, and the tell is
> that she **stops asking**. Staged in `docs/WORLD-1.md`.

> **What this draft discards.** An earlier pass had World 2 as an above-ground
> museum, and had the archaeologist carrying the spirit from the first frame.
> Both are gone: the worlds are one place descended, and she is herself until
> Act 3 of World 1. Nothing else from earlier drafting is dropped.

---

## The shape, in one paragraph

You go from outside into a pyramid, and the pyramid gets deeper through three
worlds. You think you are going into the core of the Earth. At the bottom you
find you are not underground at all - you are outside, in another universe,
standing at the point of a second pyramid, and that is where the aliens live.
They have been trying to get in. The dead rising is what that looks like from
our side. Then the game fades, the tape comes out, and it goes on a shelf in
their store.

---

## THE LAW, and the escalation that proves it

> **You cannot kill it by killing the thing it is in.**

Stated three times, at three scales, and **each statement is physical rather
than spoken**:

- **World 1** proves it on a god. Set falls and does not die, it goes away.
- **World 2** proves it on a person. The archaeologist dies. She does not.
- **World 3** proves why. She is a door being held open, and you cannot kill a
  door.

### The corollary the owner drew, which is better than the law

**KILLING THE VESSEL DOES NOT REMOVE HER. IT DISTRIBUTES HER.**

Take away the thing she is in and everything becomes the thing she is in.

```
World 1   the boss goes away        because it is not a person
World 2   the archaeologist dies    because a body was only ever a container
World 3   nothing is left to hold her, so she is in all of them at once
```

This converts "you cannot kill a door" from a line somebody would have to say
into a difficulty curve. Three worlds of the player removing her housing, and
the reward for succeeding twice is a world where she has none left and therefore
has all of it.

**The player caused World 3.** Not as a mistake and not as a punishment - as the
correct consequence of doing what he was told, well, twice.

---

## The spine underneath it: the death loop

**The spirit's power is raising the dead. The player dies constantly and gets
back up. The player is one of the raised.**

**LOCKED: the game starts after his death.** She hired him, they went in, he was
killed in front of her at the courtyard spawn, and he got up. By the title
screen he is on his second life. Every death afterwards is the same event
repeating.

**He is not learning to survive. He is failing to stay down.**

| | World 1 | World 2 | World 3 |
|---|---|---|---|
| | **PLANT** | **RECOGNISE** | **CONFIRM** |
| He thinks | dying is how this game works | I have been coming back for a reason | I have been carrying her since before the first frame |
| The game shows | a verdict where his name should be, the gods' favour stripped every time, and the body returned to the spot | she stops getting up, and he does not | the horde is her, the boss is her, and so is he |
| Told outright | never | never | never. The store says it |

### Four pieces of shipped machinery already playing this story

Taken singly, coincidences. Together, the argument that this reading is right
rather than imposed:

1. **The death card judges him personally and erases him, and then he stands
   up.**
2. **His cartouche carries a verdict where a name should be**, because he does
   not remember his name.
3. **`restart()` returns him to the place he died, every time**, from either
   world. Shipped in `d689bad` as a usability fix, one day before any of this
   was written.
4. **The Serdab, the only room with no spawn points, is the only room where the
   twist can land without a horde arriving.** Shipped to satisfy the
   trainability law.

Four systems, four unrelated reasons - a fail-state convention, a typographic
rule, a usability complaint, and a level-design law.

---

## THE TWIST, and where it lands

**PROPOSAL, the coordinator's. On the evidence it is the point of the design.**

If she is in every risen thing, and he has been rising since before the title
screen, then **he is a vessel too.**

Not "she was the villain". It is:

> You have been carrying her the whole time. That is why you keep getting back
> up. And killing her means staying dead.

That closes five things that were previously five ideas:

1. **The death loop** stops being atmosphere and becomes evidence.
2. **The Mario twist** gets its second half. World 1: she is not in the room.
   World 3: she is, and has been, in the only place he never looked.
3. **The distribution** acquires its last term.
4. **Her five questions** acquire their answer. She spent World 1 asking a man
   how he was walking around. The answer was standing in front of her and inside
   him.
5. **The alien-Blockbuster ending** stops being a rug-pull. He and the thing he
   was sent to rescue end up in the same box on the same shelf, because they
   were the same object.

And it retires the worst version of this story, the one where the good spirit
turns out to be evil. She is not evil. She is **undifferentiated**: a thing that
loves life so much it will not permit anything to stay dead, with nothing left
to keep it inside one shape. The name was never ironic.

### The one real risk, and the fix

**If the game simply kills him at the end, the twist is a gotcha.** A revelation
the player cannot act on is something done to them.

**PROPOSAL: the ending is a choice, and the game already owns the interface.**
`ui/death.js` ends every death with a card, a beat, and a button that arms and
waits indefinitely:

```
KEEP THE VIGIL   [ENTER]
```

That button has meant "come back" for three worlds and several hundred deaths.
The last time the card appears, it means the opposite. Same DOM node, same gate,
same key, inverted. He chooses to stay down.

And then the hand puts the box back on the shelf, so it can be played again, so
the dead rise again - which is the law's final statement, made at his expense,
after he did the one thing that should have ended it.

Rejected: an unwinnable boss, a cutscene death, or a two-ending fork. The first
two take the choice away; the third makes it a menu.

---

## The descent

### DOWN BECOMES OUT

Three worlds of increasing enclosure, and then the floor opens and **there is no
ceiling at all.** Hours of claustrophobia and then sudden agoraphobia, in one
cut. The owner: "kind of like breaking your brain, breaking your model of what
was supposed to happen."

### The enclosure ladder

`rooms.js` carries a `height` per room. World 1's, as shipped:

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

**The last room of World 1 already has the lowest ceiling in the game.** Nobody
put it there for this reason.

**PROPOSAL: the ladder for Worlds 2 and 3.**

| | Ceilings | Rule |
|---|---|---|
| **World 1** | 5 to 30, median 8 | as shipped. Ends at 5. |
| **World 2** | 3 to 6, **nothing over 6** | no gallery, no shaft, nothing that gives the eye distance. The player should be ducking. |
| **World 3, the white** | unreadable | there is a ceiling and it cannot be found, because there is no wear, no shadow and no fog to measure against. Enclosure by uncertainty. |
| **World 3, after** | none | no ceiling, no walls, no floor in any sense used for three worlds |

World 2 giving up the Great Gallery is the cost of this beat and it is worth
paying.

### The architecture escalates by getting OLDER

- **World 1 is Egyptian and KNOWABLE.** Gods with names, a weighing of the
  heart, a procedure. **That belief is the asset. World 1 does not spend it.**
- **World 2 is OLDER THAN IT SHOULD BE.** Built by hands, but not by anyone who
  left records.
- **World 3 is NOT ARCHITECTURE.** White, blank, no wear, no tool marks.

**PROPOSAL for World 2's design principle: its iconography is World 1's, wrong.**
The same forms, cut by someone who had never seen the animals, in a place older
than the people who named them. The Egyptians did not invent the pantheon. They
found it down here and copied it. Never stated.

### The white is nearly free, and the post chain fighting it is the effect

`world/materials.js` is warm sandstone with weathering, generated maps, dressing
and scatter. `core/post.js` adds AO, height fog, bloom, tone mapping, a grade,
chromatic aberration, vignette and grain. **A white featureless space is the
SUBTRACTION of all of it.**

One honest caveat, verified: `post.js` notes the grade's shoulder is a ceiling,
that grain against a ceiling clips, and that bloom contributed about 300 of 1090
white-core pixels in a measured frame. So white blows out and the grain dies on
it. **That is not a problem to fix.** Three worlds of film grain and then a frame
with none is the difference between "shot on something" and "not shot at all".

### The sky is uniforms, not assets

`world/sky.js` is a gradient dome whose character lives entirely in `uZenith`,
`uHorizon`, `uHazeBand`, `uAureole`, `uDust`, `uAway`, `uGround`, `uSunColor`,
`uSunDir`, `uHaze`. **A wrong sky is seven colour uniforms and a sun direction**,
and the dome already carries a `uGround` term, so an upside-down world is at
crudest `uGround` and `uZenith` swapped.

---

## What each world is FOR

### World 1 - THE TOMB

**For: establishing that this place has rules, that they do not hold him, and
that the one person who could tell him why stops being able to.**

Full detail in `docs/WORLD-1.md`. The two things World 2 inherits:

- **She has been taken and he does not know.** Ten waves of silence he did not
  notice.
- **He carried her name down to her and handed it over.** The four jars were the
  errand, and it worked.

The way out is the eleventh niche in the Serdab.

### World 2 - **PROPOSAL: THE OLDER FLOOR**

**For: taking away the rules, taking away the air, and making him kill his
friend.**

Deeper stone, ceilings under six, no room that gives the eye distance. The gods
are down here as carvings older than the gods. No shrine will forgive a death.

**The recognition beat, staged as one object.** He finds a niche exactly like the
eleventh niche in the Serdab. It is not empty. What is in it is him. No text, one
prop, in the visual language World 1 spent twenty-five waves teaching.

**The crescendo. LOCKED: she dies. The spirit does not.**

And the thing that makes it land is entirely World 1's work: **he is killing the
person who was trying to tell him what he was.** She asked five times. She never
got an answer, because he did not have one. Then something took the asking away,
and now he puts her down.

Two facts, and the second is the one that matters: **she stops getting up, and he
never has.** The comparison is made by the player, in the room, with nothing
said.

**The twist that opens World 3.** Not "there is a floor below" - he has assumed
that for two worlds. It is that **the dead get worse immediately.** Killing her
did not reduce the spirit, it released it, and the horde on the way out is the
first evidence. He leaves World 2 having made the problem larger by winning.

### World 3 - **PROPOSAL: THE THRESHOLD**

**For: the reveal, the distribution at full extension, and the choice.**

**PROPOSAL: the shortest of the three.** It is the answer, and answers should not
take ten hours.

#### The horde: alien soldiers AND spirits, and both of them are her

The owner: "we fight maybe alien soldiers and spirits, and then the final boss."

The distribution at its last rung. She has come out of the tomb, out of the god,
out of the person, out of the world - **and into the things that came through
from the other side.** The invasion and the possession are in the same room
because they are the same event. The soldiers are not a second faction. They are
the newest thing she got into, and the proof that she is now moving outward
through the door.

**Every kill in World 3 is a piece of Meresankh**, and he has spent two worlds
being told he is rescuing her. That tension is the entire act and needs no
dialogue.

**HONEST FINDING: this is the most expensive art in the trilogy, and the cheap
version is the better one.** `enemies/variants.js` opens with its own law - "a
variant that is only a different colour is not a variant... every entry here
changes the OUTLINE before it changes anything else" - so a reskinned shambler in
a helmet violates the file's stated standard, and a coherent alien army is a
whole new enemy family with its own silhouette vocabulary, animation, audio and
telegraphs.

**PROPOSAL: World 3's enemies do not agree on what they are.** If everything is
her, the correct silhouette is neither soldier nor mummy but something that
cannot commit. The deeper into World 3, the less any two enemies resemble each
other. Cheaper than an army, truer to the distribution, and it preserves the
principle that keeps the invasion from going generic: **the invasion is the
ENGINE and never the SUBJECT.** He never fights a faction. He fights her, in an
increasing number of shapes.

#### The final boss: she RE-CONDENSES

**It is not a bigger enemy.** It is everything he has been killing pulling back
into one shape.

**PROPOSAL for how it reads mechanically**, checked against `enemies/director.js`
and `enemies/boss.js`:

1. **Spawning stops.**
2. **Every live actor stops attacking and walks to a point.** Same primitive
   World 1's Set beat needs - "stop and face a point" - extended to "and then go
   there". Building it once serves both ends of the trilogy.
3. **Each actor that arrives is consumed and her health goes up.** Consumption is
   `director.retire()`, which already frees the emitter, removes the group from
   the scene and swap-and-pops the live list.
4. **She rises out of the floor as they go in.** `boss.js`'s dying branch already
   computes this exactly, backwards: it sinks by `s * spec.height * spec.scale`
   and scales by `spec.scale * (1 - s * 0.5)` for `s` running 0 to 1 while
   `setGlow` ramps down. **Run `s` from 1 to 0 with the glow ramping up and it is
   the rise.**

**The thing that goes away in World 1 by sinking and going dark comes back by
rising and lighting, through the same code path.**

#### What she looks like

**PROPOSAL: the COLOSSUS body with no crown.** `boss.js` builds five gods as one
body with five heads, and says Set's crown reads as "WRONG rather than any animal
the player can name". Hers reads as nothing at all. A blank head.

She must not be a sixth god - the gods were the tomb's staff and she was never
one. Distinguishing her by SUBTRACTION is the white room's trick, it costs a
`crown: null` guard, and it closes the motif: his empty death cartouche, her
struck cartouche in the Serdab, the effaced sign on the walls, and now a face
with nothing on it. Everything about either of them that could carry a name has
been taken.

#### What this needs that does not exist

| Need | Status |
|---|---|
| A converge-and-be-consumed actor state | **Does not exist.** Actors steer at the player; the detour system handles obstruction, not destinations. Same primitive as the Set beat. |
| Consumption itself | **Exists.** `director.retire()` is already correct. |
| Boss health growing after spawn | **Does not exist.** `maxHealth` is set once in `spawn()`. Two lines. |
| The reverse rise | **Exists as arithmetic**, trapped inside `if (actor.dying)`. Needs lifting into a phase-driven helper. |
| A sixth boss body | **Nearly free.** A sixth `GODS` entry plus a null-crown guard. |
| `forWave()` not cycling | **Already World 1's largest gap.** |
| World 3's enemy silhouettes | **The real cost.** Everything else is small; this is not. |

**One UI question with a recommendation.** The boss bar reads `maxHealth`, so
during the re-condensation the player watches a health bar's maximum grow.
**Recommendation: let it, and do not hide it.** A boss bar filling itself from
the corpses of everything he just killed is the clearest possible statement of
what is happening, delivered by an element that already exists.

---

## THE UNIFICATION

**The portal at the bottom of the pyramid, the white room, and the alien video
store are one location.**

- The other universe is where the aliens live.
- The game closes in an alien video store.
- Therefore the portal at the bottom of the pyramid leads TO THE SHELF.

He has been walking toward that shelf since the first wave - which is to say
since before the first wave, on a walk down the avenue that killed him.

And it makes the transcript's last exchange pay twice:

> "And for them we're the aliens." / "Yeah, exactly, we are the aliens."

The aliens have been trying to come through into our world. He goes OUT through
it, **carrying her.** He is the thing coming through from the other side, and the
infection is now travelling in the opposite direction.

---

## The three beats at the bottom

### Beat 1 - the white. **PROPOSAL: the THRESHOLD, not the destination.**

No wear, no dust, no tool marks, no shadow. The payoff of three worlds of
descent, allowed to be exactly that for as long as it takes him to understand
something is wrong with it. Then it opens.

**Nothing announces what it is.** The owner: "an alien world underneath the
pyramid, or in another universe, who knows? we don't say. that's the mystery."

### Beat 2 - **PROPOSAL: apex to apex**

He descends through one pyramid and emerges at the POINT of another, standing on
an apex in open space, with the building he has spent three worlds inside hanging
above him, inverted.

- **"The bottom" and "the top" become the same place.**
- **He recognises it and nobody tells him to.** The 62-unit stepped mass on the
  skyline is the first thing this game ever showed him, at the far end of the
  avenue he died on.
- Nearly free: the existing exterior mesh at a different scale and orientation
  against a wrong sky.

### Beat 3 - the store

The same place as beats 1 and 2, which is the point.

---

## The ending

Quoted rather than redesigned.

> "at the end of the game it's like a fade, and then you just see how the VHS or
> record, you know, just gets taken out, put in a box, put it on a shelf, and it
> just shows - what was it? Sands of the -" / "Yeah, Sands of the Restless." /
> "with you and the archaeologist and the soul like in the cover" / "and then it
> just fades out, and then it just shows the store and it's like, ah, it's just
> a game." / "a wide shot of a Blockbuster." / "It's a Blockbuster where Aliens
> walk in and out." / "In the end it was just a video game." / "And for them
> we're the aliens."

1. Fade.
2. The VHS or record comes out.
3. Into the box.
4. The box goes on the shelf.
5. The box art: **the player, the archaeologist, and the soul**, and the title
   SANDS OF THE RESTLESS.
6. Fade out to a wide shot of the store.
7. Aliens walking in and out.

**PROPOSAL: four notes on top, and nothing else.**

**The box art is the only time he sees his own face**, and the only name he ever
gets, and it is somebody else's product photography.

**It is also the only image in which the three of them are separate.** Him, her
as she was, and the spirit, standing apart on a cover - which has not been true
since before the title screen. The one place the story is legible is a thing
printed to be sold.

**The last beat is a hand putting the box back on the shelf.** Which means it can
be played again. Which means the dead rise again, after he chose to stay down.
The law's final statement, overruling the only decision he ever got to make.

**The store is the white place and he should be able to see that.** Same absence
of wear, same absence of shadow. The recognition is the payoff of beat 1, and it
is why beat 1 must not explain itself.

---

## The order of work

1. **World 1 is finished first and shipped complete.** It confirms nothing.
2. **The engine gaps World 1 exposes are World 1's problem** and are listed at
   the end of `docs/WORLD-1.md`. The largest is that the game has no concept of a
   run ending.
3. **World 2 is not designed until World 1 is playable end to end.**
4. **World 3 is written last and stays short.**

**The five things to protect while building World 1:**

- **The twenty plants** in `docs/WORLD-1.md`. Eleven already ship or cost nothing
  but a refusal.
- **The enclosure.** No room taller than the Great Gallery; the run still ends in
  the 5-unit Serdab.
- **The Star Shaft as the last time up is offered.**
- **`(0, 30)` stays unmarked.** No prop, no stain, no line. He does not know and
  is never told, and every other plant is downstream of that.
- **Her pattern, and the silence after it.** Five questions in a recognisable
  shape, lowercase, unanswered, ending mid-sentence at the Kindling. If the
  pattern is not established, its ending is not audible, and the best device in
  the project produces nothing.

---

## Open across all three

1. **Is Meresankh ever rescued?** **Recommendation: no, and by World 3 the word
   stops applying.** There is nothing to extract her from except him, and doing
   it kills him.
2. **Does he ever learn what he is, on screen?** **Recommendation: no explicit
   statement.** He learns it by being asked, once, to stay down, and
   understanding why.
3. **Does he ever learn she watched him die?** **Recommendation: no.** She is
   taken before she can say it and dead before she can say it again. The player
   works it out from five questions and a silence, or does not, and both are
   acceptable outcomes for a first run.
4. **Is the depth readout carried across all three worlds?** **Recommendation:
   yes, and in World 3 it is the last instrument still reporting anything.**
5. **What happens to the depth number when down becomes out?**
   **Recommendation: leave it unanswered here** and let whoever builds beat 2
   have it.
6. **How long is World 2?** **Recommendation: shorter than World 1.** One
   recognition and one killing.
7. **Do the gods appear outside World 1?** **Recommendation: as carvings in
   World 2, never as bosses.**
8. **Does the horde in World 3 include shapes from World 1?**
   **Recommendation: yes, and it should be the first thing he notices.** A
   shambler in the white is the distribution stated in one silhouette.
9. **Does she speak again after World 1?** **Recommendation: once.** Not as
   herself - as the thing wearing her, using her voice, in lowercase, saying
   something that is unmistakably not a question. It is the only way to make the
   player certain about what they half-noticed in Act 3, and it should cost her
   life within the minute.
10. **Is there a World 4 hook?** **Recommendation: the shelf is full of other
    boxes and none of them are legible.** A named sequel turns an ending into an
    advertisement.
