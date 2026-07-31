# MAP - the intentional design

Ratified with the owner 2026-07-30. Everything before this was a map thrown
together to have somewhere to stand during a phase of work; this is the map
designed on purpose. Nothing here is built yet. `rooms.js` and `courtyard.js`
still describe the old layout.

Read this before touching `src/world/rooms.js`, `src/world/courtyard.js`, or
`src/world/build.js`.

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
a GPU - the same property the module graph test relies on. When the fixes below
land, that tool graduates from `tools/` to `test/` and gets wired into
`npm test`. It is deliberately NOT in `npm test` today, because it fails, and a
test file sitting in `test/` that nothing runs is this project's oldest defect.

### What it says today

```
ROOM                  portals  area    verdict
great-gallery            5     1976    hub
chamber-of-ascent        2      432    through-route
hall-of-offerings        2      684    through-route
granary-vault            2      468    through-route
canopic-crypt            2     1008    through-route
star-shaft               2      936    through-route
embalming-chamber        1     1080    DEAD END
kings-chamber            1     1600    DEAD END
serdab                   1      196    DEAD END

CYCLES:
  ascent -> hall -> gallery -> granary -> ascent
    doors: debris 750, open, open, debris 750    TOTAL TO UNLOCK: 1500g
```

**Exactly one loop exists in the entire nine-room map, and it costs 1500g.**
Until both debris doors are paid the pyramid is a tree - no cycle at all. Four
findings, in descending order of how badly they hurt:

1. **The King's Chamber is a dead end.** 1600 units, the largest room in the
   map, and it is the boss arena. You fight with one door and the horde between
   you and it.

2. **The Embalming Chamber is a dead end, and it is mandatory.** The Kindling is
   in there. Every run has to enter a one-door room to turn the power on.

3. **The Great Gallery's upper level is two dead-end shelves, not a ring.**

   ```
   x  -25..-17   z  -195..-172   LEDGE
   x   17..25    z  -195..-172   LEDGE    <- same z span, opposite walls, never meet
   ```

   Both ramps lead to shelves that connect to nothing. Go up and the only way
   down is back past whatever followed you. This is why the biggest and most
   expensive room in the map has a trap built into half of it, and why it
   survived every playtest as a vague complaint about movement rather than as
   "the ledge is a coffin" - topology is not visible from inside the room.

4. **The courtyard is the worst of the four, and it is deliberate.** It is a
   straight corridor: walls both sides, recessed side chapels that function as
   pockets, closed at both ends, and `courtyard.js` sweeps eighteen exclusion
   zones down the centreline to keep the processional read clean. There is
   nothing to circle and nowhere to loop. That is all of Act 1.

---

## Three acts, three loops

The act breaks already existed in the economy; they were never named. The sealed
doorway is the Act 1 to 2 break. The gallery's three gates are the 2 to 3 break.

| Act | Rooms | Loop |
|---|---|---|
| 1 | courtyard | **none today** - needs the new circuit |
| 2 | ascent, hall, granary, gallery | the one loop that exists |
| 3 | embalming, crypt, star-shaft, kings, serdab | **none today** - needs one portal |

Each act must be survivable on its own terms, so each act gets its own train.
Two of the three do not have one.

### Act 1 - the courtyard opens up

Two new authored spaces, each opened by a purchase, forming a circuit with the
avenue: **Avenue -> Quarry -> Canal -> Avenue**, roughly 150m.

**The Quarry** (east). The workmen's yard where the stone was cut: blocks half
severed from bedrock, timber sledges, ramps of debris. Its job is **elevation** -
cut blocks at three or four heights give the exterior the vertical play the
avenue has none of, and a half-cut block is a mass you can circle.

**The Canal** (west). The dried channel that floated the limestone barges in. A
sunken trench with banks and two crossing points. Its job is the **sunken read** -
you run the channel while the horde spills down the banks, which is a wholly
different pressure to the avenue's flat corridor.

Plus a circumnavigable mass at the forecourt centre. Act 1 needs two loop scales,
which is how the good maps in this genre work: **the circuit** for when you have
room to run, and **the panic circle** for when you do not.

**DO NOT reopen the greybox perimeter.** `courtyard.js:62` records why the
walkable area was tightened in the first place - the outer field was blockout,
and the player could walk out of a finished game and into a greybox in four
seconds. The map grows by authoring spaces, never by unlocking backdrop.

### Act 2 - join the gallery ledges

One span across the south end at **z -195..-192**, at height 6, joining the two
shelves. The upper level becomes a ring and the gallery gets a second loop
stacked on the first: up one ramp, across the back, down the other.

Highest-value single geometry change in the map, because everything already
routes through that room.

### Act 3 - one portal fixes both dead ends

The Embalming Chamber spans x -44..-14 at z=-232. The King's Chamber spans
x -20..20 at z=-232. **They share six units of wall line at x -20..-14.**

A portal at approximately `(x: -17, z: -232)`, width 4.0, fits with a unit of
margin each side and creates:

```
gallery -> embalming -> kings -> crypt -> gallery
```

Both dead ends die, the deep half of the map gets its loop, and the boss arena
becomes somewhere you can circle.

**Drop the serdab spawn point.** It is a 196-unit reward closet behind a puzzle;
it should not be spawning anything, and with no spawns it is exempt from the law
without needing an exemption written into it.

---

## Difficulty is topology, not sliders

The King's Chamber portal is **structural**: free and already open on Easy and
Normal. **On Hard it ships walled, with a price to clear.**

Same map, different shape. This is a better difficulty knob than an HP multiplier
because it changes how you have to play rather than how long things take - on
Hard, the wave 5 boss is a fight in a dead end until you have earned the way out.

Needs per-difficulty portal state in whatever config the difficulty lane lands.
If that lane returns a config of numeric multipliers only, it has to be extended.

---

## Act 1 economy: three claims, one wallet

| Claim | Cost | What it buys |
|---|---|---|
| Arm up | triple-shot ~400 + SMG ~700 = **1100** | kill faster, earn faster |
| Open the map | Quarry ~500 + Canal ~500 = **1000** | the train loop |
| Advance | sealed doorway = **1000** | Act 2 |

Roughly equal, and through waves 1-3 you can afford about one. The fork is
interesting because the second-order answer is not obvious: opening the Quarry
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
| LOW | **B3AR** (triple-shot) | Act 1 wall | ~400 |
| LOW | SMG | Act 1 wall | ~700 |
| LOW | shotgun | Act 2, Hall of Offerings | ~1000 |
| MED | **THE IBIS** (battle rifle, NEW) | Act 2, Chamber of Ascent | ~1400 |
| MED | carbine | Act 2, Great Gallery | 1500 |
| MED | bolt rifle | box exclusive | - |
| HIGH | LMG | Act 3, Star Shaft | 1600 |
| HIGH | Sunspear | Act 3, Serdab puzzle | - |

Only two weapons actually move: SMG out to Act 1, and the carbine stays put while
a new med-tier gun takes the Chamber of Ascent wall. The existing placements were
already close to correct; what was missing was the framing.

The Chamber of Ascent keeps the tutorial placement its comment in `rooms.js`
describes, and gets better at it: the first thing you see after paying 1000g is a
**med-tier** gun. Paying the door visibly buys access to a better band, which
teaches the entire tier system in one glance without a line of text.

### B3AR: the triple-shot pistol needs a real burst mode

`weapons.js:611` is the whole fire system and it is binary:

```js
if (s.auto || !state.firing) hits = fire(ads);
```

Automatic, or one per click. Burst is a third path: a burst counter plus an
inter-shot timer that runs independently of the between-bursts cadence. Roughly
15-20 lines, and the first genuinely new mechanic in the weapon system rather
than a new row in `BASE_STATS`.

**Do not fake it with `pellets: 3`.** That fires three rounds simultaneously,
which makes it a small shotgun, and the shotgun already exists at `pellets: 8`.
The burst feel is the point - three distinct cracks, recoil climbing across them,
the pause - and a pellet count cannot imitate any of it.

Starting numbers, against the MK9 (`damage 42, headshot 2.6, rpm 410, mag 12,
range 90`):

```
damage    ~26 x3 = ~78 per trigger pull
headshot  ~2.2          (deliberately below the MK9 - it is not the precision gun)
magazine  18            (6 bursts)
range     ~55           (the real cost)
spreadHip ~0.030
```

Volume up close, burns ammo, pushes the player toward the wall sooner. The MK9
stays the precision option that stretches gold and rewards headshots at range.

Viewmodel shares `buildPistol` (`viewmodel.js:2591`) with machine-pistol
proportions: longer receiver, extended magazine, a compensator.

**Open tuning question, to be answered by play and not by argument:** at 400 the
burst pistol may be strictly correct to buy every run, which makes it a tax
rather than a choice. If so the fix is not to raise the price, it is to make the
MK9 worth keeping - its 2.6 headshot multiplier against the burst's 2.2, with
Thoth's double-gold-on-headshots making precision pay literally. Build it at 400
and let the playtest say.

---

## Pack-a-Punch moves to Act 2

Out of the King's Chamber. Onto **the new gallery bridge at height 6** - visible
from the floor the whole time, sixteen units of air beneath it, and you have to
break off the train and climb to use it. It also gives the bridge span a reason
to exist beyond fixing the trap.

**Pack-a-Punch is a tier promotion: one upgrade is one band up.** A packed low
weapon plays as med, a packed med plays as high. That makes 5000g legible for the
first time - you are not buying "more damage", you are buying a band - and it
creates the Act 2 tension the map wants: 5000 for power against 3250 to open all
three gates into Act 3. Depth or strength, one per run.

The King's Chamber loses nothing it needs. It is the boss arena and it holds
jar 4; it does not need a fixture.

---

## The easter-egg chain starts outside

Move canopic jar 1 out of the Granary Vault (`rooms.js:218`) into the courtyard.
Found in Act 1 and carried through the door, the mission starts before the
pyramid does and the player crosses the threshold already holding a piece of it.
One data move, and it stitches the acts into one arc instead of three.

---

## Not doing

- **A start-menu loadout choice.** "Choose your first weapon" means choosing what
  to buy off the wall with limited gold, not picking from a menu before the run.
- **Unlocking the courtyard perimeter.** See Act 1 above.
- **Raising the triple-shot's price to balance it.** See the tuning note above.

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
