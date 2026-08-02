# MAP - the intentional design

Ratified with the owner 2026-07-30. Everything before this was a map thrown
together to have somewhere to stand during a phase of work; this is the map
designed on purpose.

> **BUILD STATUS, 2026-08-02.** This document was written as a plan and said
> "nothing here is built yet" for a day. Most of it is now built, and a plan
> that still describes itself as unbuilt is worse than no status at all - it
> tells the next reader to go and build what already exists. Each section below
> now says where it stands. The rule going forward: **whoever lands a section
> amends its status in the same change.**
>
> | | |
> |---|---|
> | Act 1 circuit, Quarry and Canal | BUILT `be1d276`, and the purchases are wired: `doors.all` carries `courtyard/quarry` and `courtyard/canal`, debris, 500 each |
> | Act 2 gallery bridge | BUILT |
> | Act 2 entry room widened, and its west door made free | BUILT `5de797b` |
> | Act 3 embalming portal | BUILT |
> | Act 3 star-shaft portal | BUILT, and NOT in the original plan - see below |
> | The descent, Act 2 to Act 3 | BUILT `b12e350`. Design record in `docs/DESCENT.md` |
> | Difficulty as topology (`onHard`) | BUILT |
> | Pack-a-Punch to the gallery bridge | BUILT |
> | The four-jar chain starting outside | Jar 1 placed; the chain itself unbuilt |
> | B3AR | BUILT: on the courtyard wall at 400, and in `weapons.js` `SLOTS` |
> | THE IBIS | NOT BUILT |
> | A circumnavigable mass at the forecourt centre | NOT BUILT, and `courtyard.js` currently intends the opposite. See Act 1 |
> | SMG moving out to Act 1 | CANCELLED by the owner decision below. The SMG stays inside at 1000 |

Read this before touching `src/world/rooms.js`, `src/world/courtyard.js`, or
`src/world/build.js`.

This is the design document: what the map is for, and the rules a room has to
obey. It is not the measurement. **`docs/MAP-SURVEY.md` carries the measured
figures**, and where the two disagree the survey is right and this file is
stale. Two other documents own topics this one only references:
**`docs/DESCENT.md`** owns the descent's own record, its elevation table and the
measurements behind it, and **`docs/FLAT-MAP-AUDIT.md`** owns the code that was
written when the map was flat and has not caught up.

---

## The one law: you must be able to train

This style of game is herding. You pull the horde into a line behind you, run a
circuit, and turn and cut them down when the line is long and you have room. A
space you cannot run a circuit in is a space you die in, and no amount of ammo
or damage fixes it.

So:

> **Every room with spawn points must be in a cycle, or be able to become one
> for a price.**

That is the whole law and it admits no exemption. A dead end you can buy your
way out of is a difficulty choice; a dead end with no exit at any price is a
bug. `tools/trainability.mjs` measures it.

The map is data with no THREE import, which is what lets this be checked without
a GPU - the same property the module graph test relies on. The tool asserts
rather than reports and exits non-zero when the law breaks. It still lives in
`tools/` rather than `test/`; **it passes today**, so the reason it was kept out
of `npm test` no longer applies, and moving it is outstanding work rather than a
blocked change.

### What it said when this document was written, and why that reading was wrong

```
ROOM                  portals  area    verdict
great-gallery            5     1976    hub
chamber-of-ascent        2      432    through-route
hall-of-offerings        2      684    through-route
granary-vault            2      468    through-route
canopic-crypt            2     1008    through-route
star-shaft               2      936    through-route      <- WRONG
embalming-chamber        1     1080    DEAD END
kings-chamber            1     1600    DEAD END
serdab                   1      196    DEAD END

CYCLES:
  ascent -> hall -> gallery -> granary -> ascent
    doors: debris 750, open, open, debris 750    TOTAL TO UNLOCK: 1500g
```

**That verdict column is DEGREE, and degree is not the property the mechanic
needs.** One portal is a dead end, two a through-route, more a hub: that is the
reading a level designer does by eye, and it is wrong in exactly the way eyes are
wrong about topology.

The Star Shaft scored `through-route` on two portals. Its second portal goes to
the Serdab, which has no third door, so everything that follows you into the
shaft has to come back out the way it came. **Degree two into a dead end IS a
dead end**, and no amount of staring at the room finds it. So the Act 3 section
below was written against a map with THREE dead ends while seeing only two, and
it fixed the two it could see.

The tool now asks for CYCLE MEMBERSHIP instead, which is the property herding
actually requires. It costs a graph walk and it cannot be fooled by a corridor.

### What it says now

```
ROOM                  portals  spawns  area     h   verdict
chamber-of-ascent        2       3     648    7   on a loop
hall-of-offerings        2       4     684    9   on a loop
granary-vault            2       3     468    7   on a loop
great-gallery            5       5    1976   16   hub, on a loop
embalming-chamber        2       3    1080   12   on a loop
canopic-crypt            2       4    1008   12   on a loop
star-shaft               3       4     936   30   hub, on a loop
kings-chamber            3       5    1600   12   hub, on a loop
serdab                   1       0     196    5   no spawns, exempt

EACH ACT HAS ITS OWN TRAIN
  ok    act 2: 1 loop(s)
  ok    act 3: 3 loop(s)

TRAINABILITY: the law holds
```

Two columns in that table changed meaning after the descent, and reading them as
they read a week ago is the mistake this document exists to stop. **`area` is
gross plan area and always was**, so it is unaffected by elevation. **`h` is the
ceiling measured from the room's OWN floor**, so the Embalming Chamber's 12 and
the Canopic Crypt's 12 are not two rooms that grew: they are two rooms whose
floors dropped six metres while their ceilings stayed where they were. Both read
lower from the doorway than they did before. See the next section.

---

## The map has two floors, and that is the shape

Every room record carries a **`base`**, the absolute elevation of its floor. Act
1's threshold and all of Act 2 sit at **0**. The Embalming Chamber, the Canopic
Crypt, the Star Shaft, the King's Chamber and the Serdab sit at **-6**. One
descent, at the Act 2 to Act 3 break, realised at the three doorways out of the
Great Gallery: three ramps, sixteen metres of run for six of fall each.

**One built descent, not nine floors.** The reason is the same one `WORLD-1.md`
gives and it is a shape argument rather than a budget: one built descent against
one built ascent reads as a building. A second drop four rooms later is the
beginning of a staircase, and a staircase is a number, not a shape. The Serdab
is the one room in the map cheap enough to drop further - its portal is the only
bridge in the graph, so one ramp would do it - and it was deliberately declined.
`docs/DESCENT.md` section 8 carries that decline, costed.

### The five rules a room has to obey

**1. `base` is the floor's absolute elevation, and every other y in the record is
measured from it.** `height` is the ceiling above that floor, a ramp's `y0` and
`y1` are heights above that floor, a slot's `y` is above that floor. Nothing in a
room record is a world coordinate in Y except `base` itself. That is what lets a
room be lowered by changing one number instead of thirty.

**2. A doorway between two elevations sits at the HIGHER floor, and the LOWER
room owes it a ramp.** The builder derives the sill rather than reading it, so
there is nothing to author and nothing to get wrong. What there is to get wrong
is the other half: a six-metre step with nothing walkable spanning it is a hole,
not a descent. A room given a lower `base` than its neighbour is a room that also
needs a ramp, and the ramp has to reach the shared wall line rather than stopping
at the room's inner face, or the threshold itself has no floor.

**3. `height >= drop + 5`. This is the constraint, and it is the one the next
world will break.**

A descent doorway's sill sits at the higher floor. A full-height opening is
`DOOR_H` 4.2 plus 0.8 of lintel above that sill, so the lower room's absolute
ceiling can never come below 5.0 while the door is full height. Absolute ceiling
is `base + height` and `base` is `-drop`, so:

```
height >= drop + 5.0
```

**The drop is six because the Canopic Crypt priced it.** It had the second
lowest ceiling in the map and therefore the least room to give. At a six-metre
drop it needs a height of eleven and was authored at six; twelve was taken so the
number is not exact, and its absolute ceiling then lands at -6 + 12 = 6, exactly
where it always was. A ten-metre drop would have needed fifteen, which is two and
a half times the room as written. Six was the cheapest honest trade on the table,
and the Crypt paid for it by doubling its authored height.

**Write this rule down wherever a world is specified.** A world authored to low
ceilings and a deep descent cannot have both, and the builder does not refuse the
contradiction: it shrinks the doorway clearance, past zero if it has to, and
builds a room that looks approximately right with a door nobody can walk through.
`docs/WORLDS.md` already records the collision waiting in World 2, and
`docs/MAP-SURVEY.md` records what the builder does with it.

**4. Two rooms at different elevations must not share plan area.** The floor
sampler and `roomAtPoint` both answer from x and z alone, and the flow field
carries a hard cap of two storeys per cell. Rooms are laid out edge to edge, so
this holds by construction today. It is enforced by nothing, which is a finding
`docs/FLAT-MAP-AUDIT.md` owns rather than a licence to test it.

**5. Nothing may stand on the axis the player is put down on.** This is not an
elevation rule, it is the rule the elevation change taught. A prop parked at the
foot of a ramp, or on the line between two doorways, corks it: the collider plus
the player's own body is wider than the lane, and the failure has no visible
cause from inside the room. It has now been measured three times in three rooms.
`rooms.js` carries each measurement beside the slot that caused it.

---

## Three acts, three loops

The act breaks already existed in the economy; they were never named. The sealed
doorway is the Act 1 to 2 break. The gallery's three gates are the 2 to 3 break,
and they are now also where the floor drops.

| Act | Rooms | Loop when this was written | Loop today | Costs |
|---|---|---|---|---|
| 1 | courtyard | **none** - needs the new circuit | avenue - quarry - avenue - canal - avenue | 500 + 500 |
| 2 | ascent, hall, granary, gallery | the one loop that exists, at 1500 | that at 750, plus the bridge ring above it | 750 |
| 3 | embalming, crypt, star-shaft, kings, serdab | **none** - needs one portal | three loops | 2000 cheapest |

Each act must be survivable on its own terms, so each act gets its own train.
When this was written, two of the three did not have one. All three do now.

### Act 1 - the courtyard opens up

Two authored spaces, each opened by a purchase, forming a circuit with the
avenue: **Avenue -> Quarry -> Canal -> Avenue**. Its length in metres is **not
determined**; nobody has walked and measured it, and the route depends on which
of the four mouths is used.

**The Quarry** (east). The workmen's yard where the stone was cut: blocks half
severed from bedrock, timber sledges, ramps of debris. Its job is **elevation** -
cut blocks at several heights give the exterior the vertical play the avenue has
none of, and a half-cut block is a mass you can circle. Note that the cut blocks
are sealed and unreachable as built, so the elevation the player can actually use
out there is grade and the terrace bench.

**The Canal** (west). The dried channel that floated the limestone barges in. A
sunken trench with banks and two crossing points. Its job is the **sunken read** -
you run the channel while the horde spills down the banks, which is a wholly
different pressure to the avenue's flat corridor.

Plus a circumnavigable mass at the forecourt centre. Act 1 needs two loop scales,
which is how the good maps in this genre work: **the circuit** for when you have
room to run, and **the panic circle** for when you do not. **This one is not
built, and `courtyard.js` currently states the opposite intent**, that the
forecourt between the stubs and the temple front stays open. That is a live
disagreement between this document and the source, and it is this document's to
resolve rather than the source's to obey.

**DO NOT reopen the greybox perimeter.** `courtyard.js` records why the walkable
area was tightened in the first place - the outer field was blockout, and the
player could walk out of a finished game and into a greybox in four seconds. The
map grows by authoring spaces, never by unlocking backdrop.

### Act 2 - the entry room you can run in, and the gallery ring

**The Chamber of Ascent is 36 wide, up from 24.** The owner said twice that the
first interior room is too small to run from enemies in. It grew on X because it
cannot grow on Z: the north edge is the threshold the sealed doorway hands the
player over at, pinned by hand-placed geometry argued from the courtyard grade,
and the south edge is the shared wall line with the Great Gallery. It stays
centred on x = 0, so both neighbours shifted six rather than the room growing off
one side.

**Thirty-six and not more.** The geometric ceiling is 52, because the room's
south wall has to stay inside the gallery's north wall line. The real limit is
aspect: at 36 the net floor is already 2.1 to 1, and at 44 it is 2.6 to 1 and the
room stops being a chamber and becomes a corridor, which is worse to kite in than
a small square.

**Its west door is free, and it is an opening rather than a zero-cost door.**
That distinction is the whole change. A barrier is built for every portal whose
kind is not `open`, and the door system then prompts the player to press a key on
a zero-cost one. With a horde behind them, a free door they have to stop and open
is not the same thing as an opening. The Hall was chosen over the Granary because
it is half again the floor, it carries the best kiting geometry in the interior,
and both neighbours already open onto the gallery for nothing, so freeing this one
hands the player the gallery as well.

**The Granary keeps its 750**, and that is the half of this that is easy to get
wrong. With the Hall free, the Granary's price stops being a toll on leaving the
first room and becomes the purchase that CLOSES THE LOOP. The Act 2 train costs
750 to close instead of 1500, and it is still bought rather than given.

**The gallery ledges are joined by one span across the south end, at height 6.**
The upper level becomes a ring: up one ramp, across the back, down the other.
Highest-value single geometry change in the map, because everything already
routes through that room. The span is seven deep rather than three, and that is
the Altar's doing rather than a change of mind: the Altar of Ptah stands on it,
its collider is 2.1 across, and on a three-metre catwalk the machine would have
plugged the very hole it was placed to justify.

**Every rising ramp in the map has its undercroft filled with stepped stone, and
the gallery's two are not an exception.** The shallow wedge under a ramp is a
crawlspace an actor can walk into and then oscillate in forever, because the two
cells either side of the ramp's edge read different storeys and hand it opposite
directions on alternate frames. That is a builder rule rather than a per-ramp
dressing decision, which is why it is stated here and not in a room record.
`docs/DESCENT.md` section 6b carries the diagnosis and the measurement.

### Act 3 - the descent, and two portals because there were three dead ends

> **Amended after the fixes landed.** This section originally read "one portal
> fixes both dead ends" and it was written against the degree table above, which
> could not see that the Star Shaft was a third one. The embalming portal below
> is correct and shipped as specified. A second, mirrored portal was needed and
> is recorded at the end of this section.

**The floor drops here and only here.** The three doorways out of the gallery are
the only cut in the room graph at this seam, and that is not a coincidence, it is
the reason the drop can happen at all: the entry band and the gallery form a
cycle, and a cycle whose elevation changes once does not close. All four Act 2
rooms are therefore on one plane and all five Act 3 rooms are on another, and
neither of those facts was a preference. `docs/DESCENT.md` section 3a carries the
argument in full.

Three doorways means the one descent is **built three times**, once per gate,
each ramp landing on its own room's floor. Sixteen of run for six of fall is a
gradient of 0.375, which is gentler than the gallery's own ramps and well inside
both limits that bind: the player's step-up per frame, and the flow field's climb
per cell.

**The star shaft gets the most out of this for nothing.** Its ceiling drops with
its floor and it needed no adjustment at all. What it gains is the thing
`WORLD-1.md` said it was missing: the world spent its one vertical gasp on a
shaft that pointed up and delivered nothing. The player now walks down six metres
to stand at the bottom of it, so the thirty units of nothing overhead are
measured from a floor they had to descend to reach.

**The portals.** The Embalming Chamber spans x -44..-14 at z = -232. The King's
Chamber spans x -20..20 at z = -232. **They share six units of wall line.** A
portal at `(x: -17, z: -232)`, width 4.0, fits with a unit of margin each side
and creates:

```
gallery -> embalming -> kings -> crypt -> gallery
```

Both dead ends die, the deep half of the map gets its loop, and the boss arena
becomes somewhere you can circle.

**Drop the serdab spawn point.** It is a 196-unit reward closet behind a puzzle;
it should not be spawning anything, and with no spawns it is exempt from the law
without needing an exemption written into it.

#### The mirror portal, into the Star Shaft

The map is symmetric and nobody had noticed the east side has the same six units
of shared wall as the west. The Star Shaft spans x 14..40 at z = -232; the King's
Chamber spans x -20..20 on the same line. **They share x 14..20.**

```
embalming  x -44..-14 ┐                       ┌ star-shaft x 14..40
                      ├   both meet z = -232  ┤
kings      x -20..20  ┘                       └ kings      x -20..20
      overlap -20..-14                              overlap 14..20
      portal at x = -17                             portal at x = 17
```

A portal at `(x: 17, z: -232)`, width 4.0, the same fit with a unit of margin
each side. Act 3 goes from one loop to three and every spawning room in the map
is on a cycle. The Serdab stays a dead end and stays legal, because it spawns
nothing.

**On Hard, both sides wall**, which is the intent in the difficulty section below
rather than a doubling of it: the boss arena falls back to its one crypt door and
the wave five fight really is a fight in a dead end until the way out is earned.
What the second portal adds is a CHOICE of which 1250 to pay - west into the
Kindling and the embalming chamber, or east into the LMG, the Thoth shrine and
box spawn C. Same price, same relief, two different runs.

---

## Difficulty is topology, not sliders

The King's Chamber portals are **structural**: free and already open on Easy and
Normal. **On Hard they ship walled, with a price to clear.**

Same map, different shape. This is a better difficulty knob than an HP multiplier
because it changes how you have to play rather than how long things take - on
Hard, the wave 5 boss is a fight in a dead end until you have earned the way out.

The mechanism is built the safe way round: **every barrier is constructed as
though the tier were Hard, always, and the two Hard-only ones are dissolved on
Easy and Normal.** Building the optimistic shape and adding a barrier later was
the alternative, and it fails silently, because a barrier that only ever exists
on one tier is a barrier nothing ever looks at.

---

## Act 1 economy: three claims, one wallet

| Claim | Cost | What it buys |
|---|---|---|
| Arm up | B3AR 400 | kill faster, earn faster |
| Open the map | Quarry 500 + Canal 500 = **1000** | the train loop |
| Advance | sealed doorway = **1000** | Act 2 |

Roughly comparable, and through waves 1 to 3 you can afford about one. The fork
is interesting because the second-order answer is not obvious: opening the Quarry
kills nothing on its own, but without a loop you die at wave 7 regardless of what
you are holding.

Tune the numbers against play, not against this table. The property to preserve
is that the three claims stay comparable, so that the choice stays a choice.

---

## Weapons: three tiers, three acts

Act 1 is low. Act 2 is low and med. Act 3 is med and high.

| Tier | Weapon | Where | Cost |
|---|---|---|---|
| LOW | MK9 | start | - |
| LOW | **B3AR** (triple-shot) | Act 1 wall - **the ONLY gun outside** | 400 |
| LOW | ~~SMG~~ | ~~Act 1 wall~~ **stays in the Chamber of Ascent** | ~~700~~ 1000 |
| LOW | shotgun | Act 2, Hall of Offerings | 1200 |
| MED | **THE IBIS** (battle rifle, NEW) | Act 2, Chamber of Ascent | ~1400 |
| MED | carbine | Act 2, Great Gallery | 1500 |
| MED | bolt rifle | box exclusive | - |
| HIGH | LMG | Act 3, Star Shaft | 1600 |
| HIGH | Sunspear | Act 3, Serdab puzzle | - |

> **OWNER DECISION, 2026-07-31: the B3AR is the ONLY weapon buyable outside.**
>
> The row above is struck through rather than deleted, because the reasoning
> that put the SMG in Act 1 was sound and someone will otherwise re-derive it.
>
> One wall gun in the courtyard, and it is the B3AR. The SMG stays inside at
> 1000, where it has always been. What this buys is that the ONLY armed choice
> in Act 1 is the one the act is about: keep the MK9 and its 2.6 headshot
> multiplier, or take the burst. Two guns on the same stretch of avenue makes
> that a shopping trip; one makes it a decision.
>
> It also keeps Act 1 honest about what it is. The courtyard is the spawn area,
> not a sandbox, and putting half the low tier out there before the player has
> paid the thousand for the doorway drains the moment that door is supposed to
> be.
>
> There is no mystery box outside either, and there should not be: all three box
> spawns are interior by design. A random weapon source in Act 1 would defeat
> this the moment it rolled an LMG.
>
> The exterior wall-buy MECHANISM is still built general, because THE IBIS and
> any future move needs it. The constraint is on what is placed, not on what is
> possible.

So no existing weapon moves at all. The carbine stays put while a new med-tier
gun takes the Chamber of Ascent wall, and the two additions - B3AR outside and
THE IBIS inside - are the whole change. The existing placements were already
close to correct; what was missing was the framing.

The Chamber of Ascent keeps the tutorial placement its comment in `rooms.js`
describes, and gets better at it: the first thing you see after paying 1000g is a
**med-tier** gun. Paying the door visibly buys access to a better band, which
teaches the entire tier system in one glance without a line of text.

### B3AR: the triple-shot pistol needed a real burst mode

The fire system was binary, automatic or one per click. Burst is a third path: a
burst counter plus an inter-shot timer that runs independently of the
between-bursts cadence, and it is the first genuinely new mechanic in the weapon
system rather than a new row in the stats table.

**Do not fake it with `pellets: 3`.** That fires three rounds simultaneously,
which makes it a small shotgun, and the shotgun already exists at `pellets: 8`.
The burst feel is the point - three distinct cracks, recoil climbing across them,
the pause - and a pellet count cannot imitate any of it.

Design intent, against the MK9's precision profile:

```
damage    ~26 x3 per trigger pull
headshot  below the MK9's - it is not the precision gun
magazine  six bursts
range     the real cost
```

Volume up close, burns ammo, pushes the player toward the wall sooner. The MK9
stays the precision option that stretches gold and rewards headshots at range.
The shipped numbers live in `weapons.js` and are not restated here, because a
design document that copies a balance table goes stale on the next tuning pass.

**Open tuning question, to be answered by play and not by argument:** at 400 the
burst pistol may be strictly correct to buy every run, which makes it a tax
rather than a choice. If so the fix is not to raise the price, it is to make the
MK9 worth keeping - its higher headshot multiplier, with Thoth's
double-gold-on-headshots making precision pay literally.

---

## Pack-a-Punch moves to Act 2

Out of the King's Chamber. Onto **the gallery bridge at height 6** - visible from
the floor the whole time, sixteen units of air beneath it, and you have to break
off the train and climb to use it. It also gives the bridge span a reason to
exist beyond fixing the trap.

**Pack-a-Punch is a tier promotion: one upgrade is one band up.** A packed low
weapon plays as med, a packed med plays as high. That makes 5000g legible for the
first time - you are not buying "more damage", you are buying a band - and it
creates the Act 2 tension the map wants: 5000 for power against 3250 to open all
three gates into Act 3. Depth or strength, one per run.

The King's Chamber loses nothing it needs. It is the boss arena and it holds
jar 4; it does not need a fixture.

---

## The easter-egg chain starts outside

Canopic jar 1 is out of the Granary Vault and in the courtyard. Found in Act 1
and carried through the door, the mission starts before the pyramid does and the
player crosses the threshold already holding a piece of it. One data move, and it
stitches the acts into one arc instead of three. The other three jars sit in the
Canopic Crypt, the Star Shaft and the King's Chamber, all of them now six metres
below the room the player carries the first one in through. The chain itself, the
sockets accepting the jars and the payoff, is unbuilt.

---

## Not doing

- **A start-menu loadout choice.** "Choose your first weapon" means choosing what
  to buy off the wall with limited gold, not picking from a menu before the run.
- **Unlocking the courtyard perimeter.** See Act 1 above.
- **Raising the triple-shot's price to balance it.** See the tuning note above.
- **A second descent inside World 1.** See the two-floors section. The Serdab
  drop is the cheap one and it was costed and declined in `docs/DESCENT.md`
  section 8.

---

## Names, locked 2026-07-31

**B3AR** - the Act 1 triple-shot pistol. Owner's name. The 3 is the burst count
sitting inside the word, which is the kind of joke a player finds on their second
run and likes more for having found it.

**THE IBIS** - the Act 2 battle rifle. Thoth's bird, and Thoth is already the
shrine that doubles gold on headshots, so the precision weapon carries the name of
the god whose boon pays for precision. It also draws the right line against B3AR:
one is the brute you can afford in the first two minutes, the other is the surgeon
you graduate to on the far side of a thousand-gold door.

**The death card stays UNWORTHY**, with THE HEART OUTWEIGHS THE FEATHER beneath it.

**The curtain stays under the HUD** (z-index 10). Confirmed by the owner. The world
darkens as you approach a threshold; gold, ammo and the minimap stay lit.
