# World 1 polish, from the first full human run

Source: the owner played World 1 end to end on 2026-08-08 and gave notes. This
is the work list that came out of it, in the order I intend to do it. Every
"already exists" below was verified against the code, not assumed.

---

## 0. FIXED: the end card never arrived

Reported as "walked into the Serdab and it just turned black, nothing happened."

`ui/ending.js` counted its 1.25s opening beat on main.js's CLAMPED simulation
delta. `MAX_DELTA` is 1/20, so under 20fps sim time runs slow rather than
skipping - right for a player who must not be teleported through a wall,
meaningless for a title card on a black screen. Measured: six real seconds
advanced the card's clock by 0.7s.

Now on wall clock. Card at 2972ms, button at 3794ms, screenshot diff 0.000 to
0.314. `test/endgame.mjs` is new and measures in wall clock specifically because
`e2e.mjs` passed through the whole defect - it pumps 40 swiftshader frames at up
to 1.7s each, which is a clock the player does not have.

**Commit `030d68e`.**

---

## 1. The ammo refill already exists and nobody can find it

The note was "the ability to go up to the wall gun and reload, which is like for
five hundred". `systems/wallbuy.js` already sells exactly that: look at the wall
you bought a gun from and it offers a REFILL at half the take price, or a flat
4500 once the weapon has been through the Altar.

So this is not a build. It is the jar problem again, and for the third time:
**the feature was there and no surface named it.** The refill only offers at the
wall that sold you that specific gun (deliberate - otherwise every wall in the
map is a universal ammo box), which makes it even harder to stumble into.

Fix is guidance, not mechanics:
- A HUD tell when reserve ammo drops under ~25%, naming the wall and the price.
- The objective ladder's fallback rung should offer the refill when the player is
  dry and can afford it, the way it offers a boon.
- The minimap should mark the wall that sold you your current gun.

Cheapest item on this list with the largest felt effect. Do it first.

---

## 2. The bosses are too easy, and the doorways are why

Reported: "the doorways trap them and basically make it easy to kill them all."

A god that pathfinds into a 2.4m portal and sticks there is a free kill, and it
is the same class of defect as the stuck corners the player hit in the quarry -
the flow field is happy to route a body through a gap its collider cannot clear.
The player found the exploit before we found the bug.

Not a numbers problem. Raising boss health while the chokepoint stands just makes
the free kill take longer. Order:
1. Measure it. A harness that puts each god on the far side of a portal and
   records whether it ever crosses, and how long it spends inside the jamb.
2. Fix the pathing so a god either fits or routes around.
3. THEN look at health and damage, with the exploit closed.

## 3. Two more enemies for the late waves

Verified roster: `variants.js` has three plus the base - `shambler` (wave 1),
`scarab` (4), `husk` (6), `bound` (10). Nothing new appears after wave 10, which
is exactly the owner's complaint: fifteen waves with no new idea in them.

Adding a variant is one file plus an `UNLOCK` entry, which is the good news. The
two new ones want to attack the player's HABITS rather than add hit points -
by wave 15 the player has learned to walk backwards in a circle and hold fire.
Candidates, my picks first:
- something that punishes the backpedal (a lunger, or one that is fast only when
  you are not looking at it)
- something that punishes standing in a doorway, which also makes item 2's fix
  matter instead of just removing an exploit

Names are the owner's lane. Behaviour is mine.

## 4. Pack-a-punch three times

Today `weapons.upgraded` is a `Set` - membership, one tier, with an authored
upgraded NAME per weapon (`Nekhbet's Talon`, `Wadjet Ascendant`, and so on).
Three tiers means that becomes a level, and eight weapons need two more names
each, which is sixteen names and squarely the owner's lane.

The mechanical half is mine: cost curve, damage curve, and the audio. Note the
ring work from 2026-08-07 - each profile now carries its own `ring: {rate, gain,
ms}` and the gains were balanced against ONE upgraded state. Three tiers will
walk straight back into the handbell problem unless tier is a parameter of that
ring rather than three hand-tuned copies. `test/gunfeel.mjs` is the gate.

## 5. Story, and the bridge into World 2

Reported, and it is the sharpest note of the set: "we really didn't get any
story. There wasn't any story."

What exists is an ENDING - a black screen, a struck cartouche, THE NAME IS NOT
HERE - and it is good, and it is arriving cold because nothing before it has been
telling a story for twenty-five waves. The jars are a fetch chain with names on
them. Her line at the Kindling is one line. The Serdab is an empty room with the
last beat in it.

So this is not "add a cutscene". It is that World 1 has an ending and no middle.
The material to build the middle from is already in the world and unused:
- the five gods are a sequence nobody narrates
- the four sons are four names nobody explains
- the Serdab has five prop slots and zero interacts

Related, same lane: the owner wants **a special weapon that has to be EARNED for
World 2/3** - "I feel like that's always what was missing." That is the right
instinct and it is also the story bridge. A weapon carried out of World 1 is the
narrative object that makes World 2 a continuation instead of a new level.

This item is mostly the owner's: it is names, identity and public voice. My job
is to bring the pick, not the menu, and to build the surfaces once the beats are
chosen.

---

## 6. World 2

Explicitly after all of the above. `ui/ending.js:descend()` already fires
`onDescend` listeners and holds the screen black - the one line that changes when
World 2 lands is inside that function, and the eleventh niche must NOT be built
from there (it belongs to the Serdab's art lane, and `star-shaft -> serdab`
clears the doorway rule with zero slack).

---

## Standing note on harnesses

Three separate defects this week passed a green harness: the tracer that started
on the eye plane, the ring rate with zero definers, and now a card timed on a
clock the player does not have. The pattern is the same each time - the harness
measured the thing the code reports about itself rather than the thing the player
gets. Every new check here gets a control measured in the same run, and where the
player's experience is the subject, the unit is wall clock and pixels.
