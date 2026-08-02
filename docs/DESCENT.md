# THE DESCENT - World 1's one drop, and why it is where it is

Written 2026-08-01, against the measurements in `docs/MAP-SURVEY.md` and the
story in `docs/NARRATIVE.md`. Everything in the tables below was read back out
of the running game by `test/descent.mjs`, not out of the room records. Where a
number was not measured it says so.

---

## 1. BLUF

- **The map is no longer flat.** Act 1's threshold and all of Act 2 sit at
  **y = 0**. Everything from the Embalming Chamber to the Serdab sits at
  **y = -6**. Total drop from the entrance to the bottom of the world: **6.0 m**.
- **One built descent, at the Act 2 to Act 3 break**, exactly where
  `docs/WORLD-1.md` asks for it. It is one elevation change realised at the
  three doorways that make up that seam, because that seam is three doorways.
- **Interior vertical range went from 6 m to 12 m**, and for the first time half
  of it is down: -6 at the Act 3 floor to +6 at the gallery's upper ring.
- **The rooms all descend rather than ascend, and the entry room does not move.**
  The alternative - author the descent above zero so no interior surface is ever
  negative - was evaluated and rejected on evidence. Section 6.
- **The two-storey nav cap is not touched.** `flow.js` `LAYERS` stays at 2 and
  its `layersFull` counter measures **0** with the descent in. No recommendation
  to raise it is being made. Section 7.

---

## 2. THE ELEVATION TABLE

`base` is the floor's absolute y. `height` is unchanged in meaning: the ceiling
measured from that room's own floor. Both columns marked "was" are the shipped
values before this change.

| room | act | base | height (was) | ceiling, absolute (was) | descent built in it |
|---|---|---|---|---|---|
| chamber-of-ascent | 1/2 threshold | **0** | 7 (7) | 7 (7) | - |
| hall-of-offerings | 2 | **0** | 9 (9) | 9 (9) | - |
| granary-vault | 2 | **0** | 7 (7) | 7 (7) | - |
| great-gallery | 2 | **0** | 16 (16) | 16 (16) | - (its upper ring still climbs to +6) |
| embalming-chamber | 3 | **-6** | **12** (8) | **6** (8) | west ramp, 16 m run, 6 m fall |
| canopic-crypt | 3 | **-6** | **12** (6) | 6 (6) | centre ramp, 16 m run, 6 m fall |
| star-shaft | 3 | **-6** | 30 (30) | **24** (30) | east ramp, 16 m run, 6 m fall |
| kings-chamber | 3 | **-6** | 12 (12) | **6** (12) | - |
| serdab | 3 | **-6** | 5 (5) | **-1** (5) | - |

**Every absolute ceiling in Act 3 either stays where it was or comes DOWN.**
Nothing in the map got taller in world space. Two rooms got deeper, and the
`height` column is where that shows up, because height is measured from a floor
that moved.

**The ceiling ladder survives.** `docs/WORLDS.md` states World 1's ceilings as
"5 to 30". They are still 5 to 30, and the Serdab still has the lowest ceiling
in the game in both readings: 5 above its own floor, and an absolute -1, which
is lower than any other surface in World 1.

---

## 3. WHY THE DROP IS SIX, AND WHY IT IS ONLY IN ONE PLACE

### 3a. The room graph decides how many descents you can afford

This is the constraint that shaped everything else and it is a property of the
map that was already there.

**Elevations must be consistent around a cycle.** If two rooms are joined by a
level doorway they share a floor; walk a loop and every room on it shares one
floor unless the loop changes elevation at least twice. So the number of places
the map can change elevation is not a design choice, it is a count of the
**cut edges** in the room graph.

The nine-room graph has exactly one bridge, and it is `star-shaft -> serdab`.
Every other room lies on a cycle - which is `tools/trainability.mjs`'s law, and
that law was written to make the map survivable, not to make it flat. Its
consequence for elevation is that **the whole map minus the Serdab has to share
one floor unless you build multiple descents.**

The cuts that separate the entrance side from the deep side, and their price in
built ramps:

| cut | doorways to build | what it separates |
|---|---|---|
| `{chamber-of-ascent}` | 2 | the antechamber from the rest |
| `{chamber, hall, granary}` | 2 | the entry band from the gallery |
| **`{chamber, hall, granary, gallery}`** | **3** | **Act 2 from Act 3** |
| `{embalming}` alone | 2 | one Act 3 room from the others |
| `{canopic-crypt}` alone | 2 | ditto |
| `{star-shaft, serdab}` | 2 | the east arm |
| `{serdab}` | **1** | the reward closet, the map's only bridge |

`docs/WORLD-1.md` puts THE ONE DESCENT at the Act 2 to Act 3 break, and
`WORLD-1.md:640` names that break precisely: "there are three gallery gates and
the player picks." So the hinge is a three-doorway cut, and one elevation change
there costs three ramps. **That is one descent, built three times, not three
descents.** The player crosses it once per run whichever gate they pay for.

### 3b. The Act 2 to Act 3 seam is the only seam the story wants

The alternatives were checked rather than assumed:

- **Drop into the Great Gallery instead** (the `{chamber, hall, granary}` cut, 2
  doorways) would be cheaper by one ramp and is the wrong beat. The gallery is
  Act 2's room - it is where her third line is lost in a fight - and
  `WORLD-1.md`'s purpose table puts the descent AFTER it.
- **Put the ramp inside the gallery, at its south end**, so one structure serves
  all three gates. Not possible: the gallery's south end from z -196 to -160 is
  entirely occupied by the upper ring (two ledges and the bridge). A down-ramp
  under the bridge would be a THIRD walkable surface at the same x/z and would
  trip `flow.js`'s two-storey cap. Rejected on the nav cap, not on taste.
- **Drop the Serdab too** (the 1-doorway bridge, the cheapest descent available
  in the map). Declined. Section 8 costs it out.

### 3c. Six metres, and the room that set the number

The binding constraint is a doorway, not a floor plan.

A descent doorway's threshold sits at the HIGHER floor, which here is the
gallery's at y = 0. A full-height opening is `DOOR_H` 4.2 plus 0.8 of lintel, so
**the lower room's absolute ceiling can never come below 5.0** while that door is
full height. Since ceiling = base + height and base = -drop:

```
height >= drop + 5.0
```

Against the shipped heights:

| room | shipped height | max drop before its height has to grow |
|---|---|---|
| star-shaft | 30 | 25 |
| embalming-chamber | 8 | 3 |
| **canopic-crypt** | **6** | **1** |

**The Canopic Crypt priced the whole descent.** It had the second lowest ceiling
in the map and therefore the least room to give. Any drop worth having costs it
height. What six buys is that its ABSOLUTE ceiling does not move at all: -6 + 12
is the same 6 it always was. Ten would have needed a height of fifteen, two and a
half times the room the Crypt was authored as, and would have pushed the
Embalming Chamber to fifteen as well.

Six is also the number the story already uses. `WORLD-1.md`: "One built descent
against one built ascent is a shape. Nine floors is a number." The gallery's
upper ring climbs exactly six. The descent answers it exactly.

**The cost, named plainly:** the Canopic Crypt was the tight, low, warm room in
Act 3 and its authored height doubled. What it keeps is the ceiling the player
sees from the doorway and the ceiling they see from the floor, which are the same
absolute plane they always were.

### 3d. The ramps

All three identical: **16 m of run for 6 m of fall, 8 m wide, gradient 0.375.**

| room | ramp footprint | doorway it serves |
|---|---|---|
| embalming-chamber | x -24..-16, z -212..-196 | gallery gate at (-20, -196), 1000g |
| canopic-crypt | x -4..4, z -212..-196 | gallery gate at (0, -196), 1000g |
| star-shaft | x 16..24, z -212..-196 | gallery gate at (20, -196), 1250g |

- **0.375 is under every limit that binds.** The player's `STEP_UP` is 0.65 per
  frame; the flow field's `CLIMB` is 0.65 per 0.7 m cell, which is a gradient of
  0.928. The gallery's own shipped ramps run at 0.5, so these are gentler than
  anything already in the map.
- **8 m wide against a 4 m doorway**, so the walkway survives a body being
  pushed sideways at the threshold.
- **They reach the shared wall line at z = -196, not the room's inner face.** A
  doorway is a hole in a metre of stone and the floor of that hole has to be
  something the sampler can see. Stopping at -197 would leave a metre of
  threshold whose only answer is the room floor six metres down.
- **The stone under each doorway stops one ramp thickness short of the sill.**
  Measured in the built world: three boxes, y0 -6.00, y1 -0.70, 4.0 wide. Taken
  all the way to the sill it would stand proud of the ramp a metre into the room
  and `resolveWalls` would refuse to let the player out of the door they paid
  for.

---

## 4. WHAT MOVED, AND WHY

Nine authored slots were displaced. Every one of them was standing inside a ramp
footprint, and a prop under a descent is not decoration: its collider starts on
the room floor and runs up through the walkway the player is on.

| room | slot | from | to | reason |
|---|---|---|---|---|
| embalming | pillar | (-21, -203) | (-26, -203) | half way down the ramp |
| embalming | urn | (-18, -199.5) | (-25.5, -200) | in the ramp |
| embalming | urn | (-19.6, -200.8) | (-26.9, -201.3) | in the ramp |
| embalming | brazier | (-24, -229) | (-25.5, -214) | moved to light the descent |
| crypt | canopic-jar 3 | (0, -205) | (-6, -205) | three metres up the ramp |
| crypt | pillar | (0, -216.5) | (0, -219) | clearance at the landing |
| crypt | brazier | (0, -199) | (6, -216) | in the ramp; now lights the landing |
| crypt | brazier | NEW | (-5.5, -198) | see below |
| star-shaft | canopic-jar 2 | (20, -204) | (25.5, -219) | in the ramp |
| star-shaft | pillar (h 12) | (19, -206) | (26, -200) | in the ramp |
| star-shaft | spawn point | (17, -200) | (17, -219) | in the ramp |

**The Crypt gained a second brazier and that fixes a bug it already had.**
`buildLights` hangs a room's lights on its braziers and spreads its picks across
whatever anchors exist. With one brazier the Crypt stacked both of its lights on
the same bowl and left the far half of the room black - which is the exact
failure `build.js`'s own comment names, in this exact room - and the far half is
now a ramp the player has to find in the dark.

**NOTHING MAY STAND ON THE AXIS A DESCENT PUTS THE PLAYER DOWN ON.** This was
learned by measurement rather than by argument. The first pass put the foot
braziers at (-20, -214) and (0, -213), dead on each ramp's centreline two metres
past the landing. A player holding W down the west ramp stopped at z -212.78 and
stayed there: a 0.8 m collider plus the player's own 0.55 is 1.35, and that is
exactly the width of the gap. It is the Altar-on-a-three-metre-catwalk mistake
from `rooms.js` arriving in a different room, and it is invisible in the data.

---

## 5. WHAT DID NOT CHANGE

- **The room graph.** Eleven portals plus ENTRY, same kinds, same costs, same
  `onHard` overrides. `tools/trainability.mjs` passes unchanged: every room with
  spawn points is still on a cycle, both acts still have their own train, and the
  gallery upper level is still one connected ring reachable by two ramps.
- **The entry room.** `chamber-of-ascent` stays at y = 0. Section 6.
- **The gallery's upper ring.** Ledges and bridge at +6, the Altar of Ptah on the
  bridge, the two ramps at gradient 0.5. Untouched.
- **`flow.js` `LAYERS`.** Still 2.
- **Every door's clear height.** All twelve openings measure 4.2 clear after the
  change, which is what they measured before it.

---

## 6. DOWN RATHER THAN UP: the sign decision, with the evidence

The brief for this work preferred authoring the descent ABOVE zero - courtyard
entrance highest, every room stepping down toward the Serdab but no interior
surface ever negative - on the grounds that an unknown number of systems might
assume `y >= 0` indoors. That was audited before anything was written. **The
audit says the opposite, and the deciding fact is structural rather than a
matter of preference.**

**There is no y clamp and no void plane anywhere in the tree.** No
`Math.max(0, y)` on a world position, no kill plane, no fall damage, no
"fell out of the world" test. `resolveCollisions` clamps x and z only. The only
place zero acted as a floor was `heightAt`'s seed, which is the line this change
exists to replace.

**The entry room cannot move, so "start high" cannot mean what it sounds like.**
`systems/doors.js` pins the interior side of the threshold with hand-placed
absolute geometry - `DAYLIGHT` at y 2.10 / z -141.06 and `VOID` at y 4.4 - argued
in its own comments from the courtyard grade the player walks in from. Room 1 is
the datum. "Author the descent high" therefore has to mean "the rooms AFTER the
entrance go UP", which is an ascent, and the story requires a descent. Once the
entry room is pinned, the two options are the same change with opposite signs
and the sign that matches the fiction wins.

**Negative is already a shipped, tested condition for the same contract.** The
courtyard's sampler returns -3.34 in the canal channel, and the player
controller, the mummies, the grenades and the flow field all read that through
the identical three-argument `heightAt`. Large positive interior floors are
exercised nowhere.

**`systems/powerups.js:801` calls `world.heightAt(x, z, 0)` with a hardcoded
footY.** Because `reach = footY + STEP_UP` caps ascent and never caps descent, a
floor below 0 is always in reach through that call and a floor above 0.65 never
is. Negative leaves it working; positive would have required the edit.

**And the migration cost is near zero going down.** Roughly thirty-five call
sites in `test/` and `src/` teleport with a hardcoded `y: 0`. Nearly all of them
land in the courtyard or in the entry band, which have not moved. The few that
land in Act 3 fall six metres, harmlessly, and are caught by the controller's
own grounding on the way.

**ONE THING GETS MATERIALLY WORSE GOING DOWN, IT IS NOT INERT, AND IT IS THE
ONE OUTSTANDING DEFECT IN THIS WORK.**

`world/weathering.js` darkens stone as a function of ABSOLUTE WORLD Y. Its
fragment stage computes

```glsl
float hb = (wp.y - uGroundLevel) / uDirtHeight;
float grime = 1.0 - smoothstep(0.0, 1.0, hb + noise);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uDirt, grime * uDirtStrength * ...);
```

`uGroundLevel` is 0 and `uDirtHeight` is 3.2 for limestone. Every surface below
the datum therefore saturates at `grime = 1` and takes the full dirt multiply.
Act 3's floors are at -6, so **every wall, floor, ceiling and prop in the five
Act 3 rooms is now fully grimed**, and the rooms lost roughly a third of their
albedo.

Measured, standing at each room's centre, mean luminance over the top two thirds
of the frame, before the descent against after:

| room | before | after | delta |
|---|---|---|---|
| chamber-of-ascent | 53.32 / 20.19 | 53.41 / 20.17 | none |
| hall-of-offerings | 16.32 / 20.65 | 16.33 / 20.65 | none |
| granary-vault | 18.21 / 21.02 | 18.28 / 21.01 | none |
| great-gallery | 19.17 / 22.28 | 19.20 / 21.87 | none |
| embalming-chamber | 16.16 / 21.78 | 14.06 / 15.74 | **-2.1 / -6.0** |
| canopic-crypt | 23.28 / 17.26 | 21.86 / 14.21 | **-1.4 / -3.1** |
| star-shaft | 24.70 / 49.73 | 23.83 / 44.91 | **-0.9 / -4.8** |
| kings-chamber | 19.71 / 19.28 | 16.57 / 15.59 | **-3.1 / -3.7** |
| serdab | 23.41 / 18.89 | 13.43 / 10.55 | **-10.0 / -8.3** |

Act 2 is untouched to within noise. Every Act 3 room is darker, and the Serdab -
the room the whole ending happens in - lost 43 per cent.

**The mechanism was proven rather than inferred.** In one process, on one build,
the whole interior group was translated +6 in y so the Serdab sat back at its old
absolute elevation carrying every light, wall and prop with it, and the camera
was placed at the same height above its floor. Luminance went from **13.83 to
21.78**. Nothing about the room, its lights or the camera changed; only the
absolute y it is drawn at. Disabling each composer pass in turn does not close
the gap, so it is in the scene render, not in post. Height fog is genuinely inert
indoors, `uAmount` measured 0.

**IT IS NOT FIXED, and it should not be fixed by guessing.** The datum is a
single uniform on a material registry that `buildMaterials()` caches and shares
with the courtyard, so there is no value of `uGroundLevel` that is right for both
a courtyard at grade and an interior spanning -6 to +6. Lowering it to -6 would
strip the base grime off Act 2 and off the exterior, trading one regression for
another. The correct fix is to make the weathering datum travel with the
geometry - a per-mesh attribute carrying the room's `base`, so the grime band is
measured from the floor of the room the stone belongs to rather than from world
zero - and that is a change to a shared primitive with the whole map downstream
of it. It wants its own pass and its own verification. **Until it lands, the
descent ships with Act 3 about a third too dark.**

**A second, smaller y dependence, and this one really is inert.**
`core/fog.js` computes height fog density as `exp(-(y + 2) / 34)`, so a camera at
-6 is about 20 percent murkier than one at 0. It cannot bite today: `fog.js:869`
sets `uAmount` to 0 whenever the camera is inside `INTERIOR_BOUNDS`, so the fog
pass is a bit-for-bit copy indoors. **Flagged as latent.** It becomes real the
moment a room is authored outside `INTERIOR_BOUNDS` or that gate is loosened.

Two more findings from the same audit were fixed here because they fire at
either sign, and both would have been silent:

- `build.js`'s prop loop selects elevated props with `if (slot.y)`, a truthiness
  test. Folding a room's base into `slot.y` would have made every ground-level
  prop in a descended room look elevated and **silently drop its collider**.
  Room elevation is added at placement and never folded into the slot.
- `buildLights` positioned a room's fallback light at `room.height * P.y`,
  measured from zero. In a descended room that puts the room's only light above
  its own new ceiling and the room goes black with nothing reporting it.

---

## 7. THE NAV CAP, AND THE HORDE

**`flow.js` `LAYERS` stays at 2 and no change is recommended.** The cap is not
about how many elevations the map has, it is about how many walkable storeys sit
over a single x/z cell. The nine rooms are laid out edge to edge and do not
overlap in plan, so a room's elevation costs nothing. What costs a layer is a
ramp running over a floor, and each descent room now has exactly one: its own
floor, plus its ramp. Two.

Measured with the descent in, from the game's own counters:

```
layered      2203 cells carry a second storey
layersFull   0     relaxations dropped for want of a slot
cells        28310 grid size, unchanged
```

`layersFull` is the assertion `flow.js`'s own comment nominates for exactly this
question, and `test/nav.mjs` already asserts it is zero. It still is.

**Routes exist in both directions and bodies walk them.** Measured:

| from | to | geodesic cost |
|---|---|---|
| gallery floor | foot of the west ramp | 48 |
| gallery floor | foot of the centre ramp | 42 |
| gallery floor | foot of the east ramp | 48 |
| gallery floor | King's Chamber | 84 |
| gallery floor | Serdab | 76 |
| Act 3 floor | gallery floor | 42 |
| Act 3 floor | gallery upper ring, west ledge | 73 |
| Act 3 floor | gallery upper ring, east ledge | 73 |
| Act 3 floor | Chamber of Ascent | 84 |

A shambler placed in the King's Chamber reached a player on the gallery floor in
36.3 simulated seconds across 82 m, and its y ranged from -6.00 to 0.00 along the
way, which is the ramp and not the stone. The same in reverse took 21.2 s.

**One known risk, inherited and now multiplied by three.** `flow.js` documents a
layer-selection oscillation: because `READ_DOWN` is a hard 2.2 m threshold and a
ramp over a floor sweeps continuously from 0 to its full height, some strip of
every such ramp is exactly 2.2 above the floor beneath it, and an actor coming to
rest on that strip reads a different layer on alternate frames and covers no
ground. Six of the seven stuck actors in the shipped interior probe are that one
strip of the gallery's west ramp. **Three new ramps means three new strips**, at
z = -206.1 on each. Nothing in this change makes the underlying problem worse or
better; the fix `flow.js` names for it - hysteretic rather than threshold layer
selection - is still unwritten, and still wants its own measurement pass.

---

## 8. THE DESCENT THAT WAS DECLINED, COSTED

`star-shaft -> serdab` is the only bridge in the room graph and therefore the
only place in the map where a second elevation change costs **one** ramp instead
of two or three. It is also the room the story calls "the chapel at the bottom
of the building". It was not taken, and the reason is
`docs/WORLD-1.md`'s own: one built descent is a shape, and a second one four
rooms later is the start of nine.

If it is ever wanted, these are the numbers, and there is one nasty edge in
them:

- The Serdab portal is at (40, -213), width 2.4, on the Serdab's west wall. A
  ramp running east into the room at gradient 0.375 fits: a 4 m drop needs 10.7 m
  of run and the room's net floor is 13 m across.
- **The ceiling rule bites hardest here.** With the sill at -6 (the shaft's
  floor), a full-height door needs the Serdab's absolute ceiling at or above
  -1.0, so `height >= drop + 5`. A 4 m drop puts the Serdab at height 9 -
  **which stops it being the lowest ceiling in the game as an authored number**,
  though it would still be the lowest in absolute terms. The narrative names that
  ceiling explicitly.
- The `offering-table` at (47, -214) is inside any such ramp and would move.
- **It is the least verifiable part of the map.** The Serdab sits behind the only
  puzzle-gated door in the game, and that gate reads a jar counter that is
  hardcoded to zero and never written. `docs/WORLD-1.md` already flags the room
  as unreachable in the shipped build.

A cheaper variant, if the ending needs the Serdab lower without the ceiling
cost: **drop it and lower the door with it.** A 2 m drop needs `height >= 7`,
which keeps the Serdab the shortest room in the map by 5 and still puts its floor
at -8, the lowest surface in World 1. Not built, not measured.

---

## 9. WHAT IS NOT VERIFIED

Stated rather than implied.

- **The descent has not been walked from the courtyard.** Every walk in
  `test/descent.mjs` starts inside the interior with the barriers force-cleared,
  the way `test/nav.mjs` does. The full paid route - buy the sealed doorway, buy
  a 750 debris door, buy a 1000 gate, then descend - is covered piecewise by
  `test/interior.mjs` down to the gallery and by this file from the gallery down,
  and has not been driven end to end in one session.
- **No frame-time measurement was taken.** Three ramps, three more wall boxes and
  a slightly larger walkable set are all linear costs, and none of them were
  timed. `tools/perf.mjs` exists and was not run.
- **The `READ_DOWN` oscillation strips on the three new ramps were not counted.**
  The mechanism is documented in `flow.js` and its arithmetic says a strip must
  exist on each; no probe was run to find actors stuck on them.
- **Nothing about the Serdab's interior was verified beyond its floor height and
  its reachability cost**, because the room's puzzle gate is not implemented.
- **The elevated-prop rule was not re-tested.** `build.js` still discards the
  colliders of any propSlot carrying a `y`, which is shipped behaviour and which
  the descent does not use.
