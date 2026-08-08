# RIGHT NOW — 2026-08-08 02:15 — READ THIS FIRST

Everything below is pushed, built and verified live at
`https://eddiebelaval.github.io/sands-of-the-restless/`. `origin/main` and
`feature/enemies-and-horde` are both at **`b816de0`**. Working tree clean.

Source of the work: the owner played World 1 end to end for the first time and
gave notes. Full list in `docs/WORLD1-POLISH.md`, World 2 in `docs/WORLD2-PLAN.md`.

---

## THE NEXT TASK, precisely

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
