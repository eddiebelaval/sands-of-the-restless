# DONE — 2026-08-08 — THE MAP IS OPEN TO A GOD

**Every room a god should be able to reach, it reaches.** `test/godfield.mjs` is
now a gate rather than a report, and it is green at 22 checks.

```
  chamber-of-ascent    460 /  463    99%
  hall-of-offerings    419 /  420   100%
  granary-vault        255 /  257    99%
  great-gallery       2143 / 2143   100%
  embalming-chamber    946 /  956    99%
  canopic-crypt        847 /  849   100%
  star-shaft           642 /  682    94%
  kings-chamber       2187 / 2187   100%
  serdab                 0 /   67    god-proof BY DESIGN, asserted
```

Whole-map god reach went **401 cells (3.3%) to 7847 (61.4%)**. The remaining gap
to the shambler's number is bodies legitimately not fitting in tight corners,
which is correct rather than a defect.

The causes, in the order they were found, every one measured rather than argued:

| | what it was |
|---|---|
| doorways | authored 4.0, which is 0.39 m of god band. Now `COMBAT_DOOR = 5.5` |
| gallery ramps | mouths sat on the north doorways. Backed 4 m south |
| gallery colonnade | a pillar 4 m in front of each Act 3 door, on its centreline |
| Act 3 thresholds | the descent fill went live 1.87 m in. Now a 2.5 m flat landing |
| King's Chamber doors | two rooms' side walls pinched the corridor to 4.0 m. Room w 40 -> 44 |
| **the undercroft fill** | **held one RAMP_T below the surface. 14 mm severed all of Act 3** |
| granary vault | ONE urn, r 0.5, sealed the room. Moved |
| hall of offerings | a double colonnade with all four lanes shut. Now one row |

**The lesson worth keeping.** Every single cause was a body-radius interaction
invisible at shambler scale: a 0.55 disc never reaches what a 1.805 disc does.
The map was authored correctly for the horde and none of it was correct for a
god. Fourteen millimetres of ramp fill is the extreme case and it was not an
outlier - it was the same mistake as the urn.

**Do not put anything in a doorway's approach.** That defect was found in the
gallery, then committed again by hand in the hall of offerings twelve edits
later, where `test/kite.mjs` caught the player corked for 191 of 200 frames.

## The second flood, finally

It is now worth building and it was not before. `sample()` still hands gods a
route carved for a 0.55 x 2.0 body, so they are steered into cells they cannot
occupy even though a route their body fits now exists. It must be a SECOND
field, not a wider single one, or shamblers detour around gaps they fit through.
Start from `flow.clearFor`, which is already the parameterised predicate.

Also still open: boss health and damage, untouched deliberately - the exploit had
to close first or it only makes the free kill longer. Two new late-wave enemy
variants (the Gold Scarab is one; one more was asked for). The colour tiers.
Story. World 2.

Suites green: nav, interior, descent, kite, enemies, variantspawn, jars,
economy, e2e, godfield.

---

# RIGHT NOW — 2026-08-08 02:15 — READ THIS FIRST (superseded above)

Everything below is pushed, built and verified live at
`https://eddiebelaval.github.io/sands-of-the-restless/`. `origin/main` and
`feature/enemies-and-horde` are both at **`b816de0`**. Working tree clean.

Source of the work: the owner played World 1 end to end for the first time and
gave notes. Full list in `docs/WORLD1-POLISH.md`, World 2 in `docs/WORLD2-PLAN.md`.

---

## SUPERSEDED 2026-08-08 02:xx - THE SECOND FLOOD IS NOT THE NEXT TASK

The plan below was to carve a second flow field at god dimensions. **Measured, and
it would have made the game worse.** `test/godfield.mjs` is new and exists to
answer exactly this before anything was built.

A field carved at the god's 1.805 radius on flow.js's 0.7 grid reaches **401 of
the 12,138 cells a shambler reaches - 3.3%**. Six of ten combat doorways held no
cell a god could stand in at all. The arithmetic is exact and was verified to the
centimetre: an opening of width W leaves W - 2r of legal band, so a 4.0 m doorway
gives a shambler 2.90 m and a god 0.39 m, against a STEP of 0.7. Half a cell.
Gods would have got NO route rather than a bad one, fallen through to the
straight-line fallback in mummy.js, and walked into stone with more confidence.

Tightening the god's collider instead does not rescue it: swept 0.95 down to
0.62, reach goes 8.9% at r 0.70 and 74% at r 0.66. A 7 cm change moving
connectivity eightfold is grid phase, not clearance - the whole map's
connectivity was hanging on one or two cells in two doorways. 0.66 is also the
floor, since the god's widest visible geometry is 0.659.

**So the geometry had to move first, and two changes are now in and measured.**

| | god reach from spawn | gallery cells reached |
|---|---|---|
| before | 401 (3.3%) | 8 of 1911 |
| combat portals 4.0 -> 5.5 | 506 (4.1%) | 8 of 1911 |
| + gallery ramps backed 4 m | **2369 (19.4%)** | **1866 of 1909** |

1. `COMBAT_DOOR = 5.5` in `world/rooms.js`, applied to all ten combat portals.
   The Serdab's 2.4 puzzle door is deliberately left god-proof.
2. The gallery's two descent ramps moved from z -172..-160 to z -176..-164, with
   the ledges shortened 23 -> 19 to meet them. Gradient untouched at 6 over 12.
   This is the owner's own diagnosis, confirmed: the ramp mouths sat on the north
   doorways. The mechanism is flow.js's overhead-slab clause, which blocks a band
   under a ramp that is a function of BODY HEIGHT - z -161.3..-164.0 for a
   shambler, z -161.3..**-167.8** for a god - leaving 3.3 m of clear floor against
   a body 3.61 m across.

`nav.mjs` 12/12, `interior.mjs` 13/13, `kite.mjs` 8/8 all green after both.

### What is still islanded, and it is the real next task

Act 3 is entirely unreachable for a god: embalming-chamber, canopic-crypt,
star-shaft, kings-chamber and serdab all report 0 cells reached, despite all
three gallery -> Act 3 doorways now carrying 2-3 god-legal cells. The approach
profiles in `godfield.mjs` put the obstruction 1 to 7 m INSIDE the gallery, south
of those doors. The shambler row is blocked across a narrower part of the same
band, which is the tell: small bodies route around it laterally and a 3.61 m body
cannot. Find what that is - it is south of the gallery's south-wall doorways -
before touching anything else.

Also still open from the measurement: `embalming-chamber -> kings-chamber` and
`star-shaft -> kings-chamber` did not widen with the rest (band 0.48 and 0.46
against 1.88 elsewhere). They sit 3 m off a room corner, and a god's 1.805
clearance disc catches the perpendicular wall 1 m away. They need to MOVE, not
just widen.

**Only after Act 3 connects does the second flood become worth building**, and
then it is genuinely needed - a field carved for a shambler still hands gods
directions their body cannot take. It must be a SECOND field, not a wider single
one, or shamblers detour around gaps they fit through fine.

### Three instrument corrections this session, one of which invalidates a prior conclusion

- `band()` held feetY fixed across a transect that crosses a descent. Fixed to
  resample. It did NOT move the two King's Chamber numbers, so that finding
  stands on its own.
- The through-axis was taken from room CENTRE to CENTRE, which is diagonal
  whenever two rooms are offset - and on this map most are. Transects walked out
  of the doorway and into the wall beside it, printing doorways as islands that
  the same run's reachability proves a god walks through. Now the wall normal.
- **`test/chokepoint.mjs` uses that same centre-to-centre axis.** Its conclusion
  that gallery obstructions sit "2 to 6 m INSIDE the gallery" is not trustworthy
  and should be re-measured with the normal before it is used.

---

## THE ORIGINAL PLAN, kept for its reasoning. Do not execute step 1 as written.

**Give gods a route their body fits.** The predicate is built; the routing is not.

`enemies/flow.js` carves ONE field for a 0.55 x 2.0 body (`PAD`, `BODY_H` — a
shambler). A god is **radius 1.805, height 3.89** — 3.28x wider, 1.95x taller.
So `sample()` hands gods directions into cells they cannot occupy: they walk in,
`resolveAgainstWorld` pushes them out, the field says go that way again. Grinding
in a doorway under fire is what the owner reported as "the doorways trap them
and basically make it easy to kill them all."

Done already (commit `b816de0`):
- `clear(x, z, floorY, ctx, pad = PAD, bodyH = BODY_H)` — all four tests inside it
  (wall box, collider disc, overhead base, walkable slab) now read the
  parameters. Defaults make every existing caller byte-identical. nav 6/6, kite green.
- `flow.clearFor(x, z, floorY, ctx, radius, height)` exposes that predicate.

Still to do, in order:
1. A **second flood** over the same grid carved at god dimensions. It must be a
   SECOND field, not a wider single one: carving one field at god width would
   make shamblers detour around gaps they fit through fine.
2. `sample()` picks the field by body size.
3. Re-run `test/chokepoint.mjs` and show the owner **before/after** — he asked
   for that explicitly and has not been given it yet.
4. THEN the Great Gallery ramp geometry. The owner's own diagnosis: the ramp
   mouths back onto the doorways. The corridor scan agrees — every gallery
   obstruction sits 2 to 6 m INSIDE the gallery, not in the door. Some of this
   may resolve itself once gods route correctly, so measure again before moving
   geometry.
5. THEN separation (`sepRadius` 2.4 is LARGER than a doorway's 2.0 clear radius,
   so any second body near a door displaces a god by more than the gap allows —
   and Anubis and Set both summon).
6. THEN boss health and damage, with the exploit finally closed.

**Do not tune boss health before 1–5.** With the free kill standing it only makes
the free kill longer.

---

## Landed this session

| commit | what |
|---|---|
| `030d68e` | End card ran on the CLAMPED sim delta. Below 20fps sim runs slow, and the end-of-run frame is the heaviest in the game. Six real seconds advanced it 0.7s against a 1.25s card, so the owner saw black and nothing else. Now wall clock: card 2972ms, armed 3794ms, screenshot diff 0.000 -> 0.314. `test/endgame.mjs` new. |
| `c50b239` | Wall refill required the weapon to be IN YOUR HANDS and was silent otherwise. Players carry their best gun, so it never fired. `""` -> `REFILL WADJET SMG - 500 GOLD [F]`. `test/refill.mjs` new. |
| `088b624` | Chokepoint measurement. Disproved width AND lintel: 0 of 10 combat portals block a god, headroom 4.2m vs 3.89m. Slack is 9.8cm per side. |
| `55dec18` | Corridor scan found the real cause: the pathfinder measures a body 3.28x smaller than the thing it steers. |
| `b816de0` | `clear()` parameterised, `clearFor()` exposed. |

## Owner decisions, locked

- **Upgrade tiers are told by COLOUR, no new names.** Lapis (today, `0x1d3068`)
  -> **carnelian** -> **gold**, where tier 3 takes the gold currently confined to
  the 1mm inlay slivers and gives it the whole body. Owner approved: "love the
  color picks." Mechanism: `viewmodel.js` `buildGildMap()` is a material swap
  table; making it take a tier is the whole change. It must NOT re-pose or
  re-proportion the models.
- **World 2 starts FRESH** — same guns, same rules, no carry-over. The carried
  pack-a-punch is an **Easter egg**: hard to find, real, not a toggle, not
  random, discoverable from inside the world. Hook is one line in
  `ui/ending.js:descend()`.
- **Audio risk on tiers:** ring gains were balanced against exactly ONE upgraded
  state on 8/07 after every gun was found ringing at an identical 1.6kHz. Three
  tiers walks back into handbells unless tier is a PARAMETER of `ring`, not three
  hand-tuned copies. `test/gunfeel.mjs` is the gate (it fails 10/17 against the
  reverted build, which is why its green means anything).

## Harness discipline — four instrument failures in one week

Every one printed a clean, confident, wrong result:
1. Tracer `offset.set(0.22, -0.16, 0)` — Z literally zero, on the eye plane.
2. `ringRate ?? 1.6` — one reader, ZERO definers.
3. End card timed on a clock the player does not have; `e2e.mjs` passed through
   the whole defect because 40 swiftshader frames is many seconds of sim time.
4. Corridor scan read `room.cx`/`room.cz`, which do not exist. `undefined ?? 0`
   collapsed the axis to (0,0) and all 25 samples landed on one point. Centres
   live on `bounds`.

**Uniform results across every case are the shape of a broken instrument.**
Controls go in the same run. Where the player's experience is the subject, the
unit is wall clock and pixels.

## Still open, older

- History scrub for `claude-settings` is rewritten and verified in
  `~/Development/.backups/scrub-2026-08-07/work`, NOT pushed. Ordering trap:
  pushing kills `dbbd745`, so the submodule repair must be redone after.
- Nothing rotated: Google Maps, xAI. `rlza` is the owner's, and
  `site/profesa/index.html` must get the new publishable key and be REDEPLOYED
  before legacy JWT is disabled.
- The Serdab is still an empty room: 5 propSlots, ZERO interacts.
- The gun mix has never been HEARD by a human.
- `test/headshot.mjs` flakes ~40%, pre-existing: line 150 designates an arbitrary
  live actor as boss, and a 72hp scarab dies to the mk9's 109 damage.
