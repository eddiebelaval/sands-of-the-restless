# FLAT-MAP AUDIT

A sweep of `src/`, `test/` and `tools/` for one defect shape: code whose correctness depends on
floors being at world y = 0, on there being exactly one floor plane, or on y being non-negative.

The map was flat for its whole life, so "the world starts at zero" was never a decision and is
encoded implicitly in places with nothing obviously to do with elevation. Commit b12e350 gave rooms
a `base` and put five of them at -6. Three systems have already broken, each found by something
visibly failing rather than by a test. This is the sweep for the rest.

Line numbers are as of this audit. Another lane is editing `build.js`, `weathering.js`,
`materials.js`, `flow.js` and `director.js` concurrently, so anchor by function name.

---

## BLUF

- **22 findings: 14 in `src/`, 8 in `test/` and `tools/`.** In `src/`: 2 HIGH, 7 MEDIUM, 5 LOW.
  About thirty more candidates were read and rejected because the file argues the assumption
  correctly.
- **Two are broken TODAY.** A third, T1, was broken in the instrument rather than in the game and
  was **fixed in the working tree while this audit was being written**: `test/nav.mjs` passed a
  hardcoded footY of `0` into `flow.costAt` and reported all sixteen Act 3 spawn points unroutable on
  a map where the horde walks every one of them. Kept below because that false red is the evidence
  known bug 3 was being driven from, and because the same shape survives in seven other files.
- **The worst player-facing defect is `src/systems/powerups.js:800-801`.** `floorAt(x, z)` calls
  `world.heightAt(x, z, 0)` with a hardcoded footY, fed by an `onKill` that discards the dead actor's
  real `position.y`. A power-up earned under a descent ramp or on the gallery bridge is seated on the
  wrong storey and cannot be collected. `grenades.js:696` is the same function, same name, correct
  signature.
- **The single change that would most help World 2: give every world-space query the y it is being
  asked about.** Seven signatures still take `(x, z)` and answer a question that is now 3D.

Every finding was read in place with its surrounding comment. Nothing here is a grep hit and nothing
is inferred from a name. Where a comment justifies the assumption it is quoted and the item is marked
DELIBERATE. All of `src/`, `test/` and `tools/` was covered.

---

## Already owned by the other lane, do not duplicate

1. **`build.js` `heightAt` seeding at 0.** Fixed; it opens at the containing room's floor, outside
   the `reach` gate, argued at :557-579.
2. **`weathering.js` grime from an absolute datum.** In flight, and further along than DESCENT.md
   records: the per-mesh attribute was rejected at :209-217 (an unbound attribute defaults to 0 and
   would render correctly under swiftshader, which is what every harness here uses) in favour of
   `weatherVariant(material, groundLevel)` keyed on the room's base.
3. **`director.js:315` `isClear(x, z, pad)`.** In flight. One consequence is not covered by that fix
   (MEDIUM-3), and the evidence it is being driven from was compromised (T1).

---

## HIGH: broken today

### 1. `src/systems/powerups.js:800-801`: every power-up is seated from a datum of zero

```js
  function floorAt(x, z) {
    return world && world.heightAt ? world.heightAt(x, z, 0) : 0;
  }
```

fed by `onKill` at :992-1002, whose header at :989 says *"the payout knows THAT something died and
this needs to know WHERE"*, and which then does `return place(kind, p.x, p.z);` from a `p` that has a
perfectly good `y`.

**Two defects stacked.** `place(kind, x, z)` discards the storey the kill happened on; `floorAt` then
re-derives a height with a literal `0` in the footY slot, asserting the thing being placed has its
feet at world zero. It held because every enemy that could die stood on one plane.

**Symptom, in both directions.** `heightAt` seeds at the room's own floor OUTSIDE the reach gate, so a
kill on open Act 3 floor correctly returns -6. Ramps are INSIDE the gate, and `reach` is
`0 + STEP_UP` = 0.65, which puts the entire descent ramp (absolute -6 to 0) inside reach of a footY
that is not the actor's.

- **Under a descent ramp, at -6.** The three ramps run over the floors of the rooms they descend into
  (`rooms.js:512`, footprint x -24..-16 by z -212..-196 in the Embalming Chamber, and the two matching
  ones). A kill on the floor beneath one is seated on the ramp overhead. At z -205 the gap is about
  2.6 m and the drop is just collectable; past about z -203 it exceeds `PICKUP_HEIGHT` (2.4, :342) and
  the power-up is unreachable from the floor it was earned on, while plainly visible from the ramp.
- **On the gallery bridge, at +6.** `h > reach` skips any surface above 0.65, which is what keeps the
  ledge from being walkable from underneath, so a kill on the bridge seats the drop six metres below
  on the gallery floor. That bridge is a destination: `rooms.js:445-448` puts the **Altar of Ptah** on
  it at `y: 6`, cost 5000.

`d.anchor.position.set(x, y + 1, z)` carries the positional-audio panner along, so the pickup chime
comes from the wrong storey too. The correct spelling is in this repository under the same name:
`grenades.js:696`, `function floorAt(x, z, feet)`, with every call site passing real feet.

**Same root, second call site.** `:1161` seats the Second Death's shockwave ring from the same zero
datum while `player.position.y` is read on the same line, so a Nuke from the bridge draws the 28 m
ring on the floor beneath the deck, occluded by it, while the light and screen wash fire correctly.
That is the failure the ring exists at :1322-1328 to prevent.

### 2. `src/world/courtyard.js:2555`: the scatter is seated on the pre-canal sampler

```js
  const scatter = buildScatter(scene, { heightAt: dunes.heightAt,
```

**Not caused by the descent**, included because it is this audit's exact shape: a two-argument sampler
used as the floor where there are provably two floors. Sixty lines earlier the file declares the real
one, `const groundY = (x, z) => dunes.heightAt(x, z) - canalDepthAt(x, z);`, and names this failure
mode at :352-363: *"Anything that stands outside the plaza radius and ignores this is placed at y=0 on
a surface that is not at y=0, which is the mechanism behind 'no ground contact'."*

`cutCanalIntoGround` ran at :344, so the drawn mesh is `dunes - depth` while `dunes.heightAt` still
answers the un-cut surface. The scatter disc reaches x -30 and the canal's east slope begins at
-23.625. Measured over the actual sampling shape, about 3.9 per cent of samples land where the cut is
deeper than 0.15 m, mean 1.59 m of float, max 3.20 m: against a 1500-instance budget, roughly fifty
pebbles and scrub tufts hanging one to three metres over the canal the player pays to open and fights
in. The fix is one identifier; `groundY` is in scope at :2554.

---

## MEDIUM

### 3. `director.js:1310`: `obstruction` cannot pass a y even after `isClear` grows one

```js
  function obstruction(px, pz) { ... if (!isClear(px + dx * t, pz + dz * t, 0.5)) blocked++;
```

**For the lane fixing `isClear`, not separate work.** It is the only one of four callers that samples
a LINE rather than a point, its own signature is `(px, pz)`, and it has no y to give. It scores the
straight line from a King's Chamber spawn point at -6 to a player at 0 as one plane and multiplies the
result by 90 in the spawn score (:679). Adding the argument to `isClear` produces a call site that
cannot supply it.

### 4. `spaces.js:538` with `controller.js:862`: the arrival datum is a literal zero

```js
      player.teleport({ x: at.x, y: 0, z: at.z });
      position.y = (v.y || 0) + EYE_HEIGHT;
```

The `at` record carries `{x, z, rot}` and no y, twenty lines after `world.heightAt` was assigned at
:518; `ENTRY.spawn` (`rooms.js:73`) has no y either. `controller.js:857`: *"Every existing caller
passes `y: 0` and is therefore unchanged to the millimetre."* Written when there was one floor.

Both shipped routes survive, because `rooms.js:84-87` pins the Chamber of Ascent as the datum and the
death return is to the courtyard, but `spaces.js:128-131` documents `enter()` as a supported
out-of-band entry for the harness and the console. Aim it at a descended room and the player arrives
with feet at world 0. In the **Serdab** that is worse than a six-metre fall: `base: -6`, `height: 5`,
absolute ceiling **-1**, so the feet land a metre above the room's ceiling and the eye 2.7 m into
stone. This is the defect that forced four suites to grow a private `settle()` in b12e350; the correct
default is `world.heightAt(x, z)`.

### 5. `build.js:129`: a doorway's clear height has no lower bound and nothing asserts one

```js
  return { sill, clear: Math.min(DOOR_H, ceil - sill - 0.8) };
```

consumed at :872 as `const head = g.sill + g.clear;`. The rule is correct and well argued at :106-112.
Missing is the floor under it: `clear` can go small and can go negative, at which point the stone
above the opening is emitted below the sill, and nothing anywhere checks it. DESCENT.md section 5
reports all twelve openings at 4.2, which is a hand measurement taken once, not an assertion. Sharpest
World 2 consequence; see below.

### 6. `rooms.js:34`: the invariant the whole sampler rests on is a comment

> *"TWO ROOMS AT DIFFERENT ELEVATIONS MUST NOT SHARE PLAN AREA. `roomAtPoint` and the builder's floor
> sampler both answer from x/z alone... a room authored on top of another one breaks the sampler
> before it breaks the horde."*

Correct, honest, enforced by nothing. `build.js:535` `roomAt(x, z)`, the `floors` array at :393-399
which breaks on the FIRST containing rectangle, `rooms.js:1011` `roomAtPoint`, `spaces.js:411`
`trackRoom` and the entire minimap all depend on it. `grep -rn overlap test tools` returns HUD box
overlap and enemy spacing, nothing about rooms.

### 7. `build.js:581`: solid rock seeds at a height that exists nowhere on the map

`heightAt(x, z, footY) { let y = 0;`. Deliberate, argued at :573-579: *"It is left at 0 because that
is what the function returned there yesterday, and a survey that changes an answer nobody reads is a
survey that has to be re-verified for nothing."* Sound when 0 was also the answer everywhere else. At
-6 the solid-rock answer is six metres above the nearest real floor; at World 2 depths it will be
tens. The defence is that the flood's clearance test refuses those cells first, which is a claim about
another module rather than a property of this one. Seeding from the nearest room is cheap.

### 8. `director.js:1313` and `mummy.js:1908`: placement is a 2D API

`placeAt(id, x, z)`, then `st.feetY = groundAt(ctx, x, z, undefined)`. The `undefined` footY means
"the highest surface here", which `build.js:551` names as *"what a spawn placement wants"*, and for an
authored spawn point it is right. The problem is the boundary: `placeAt` is the public entry for
scripted encounters, the console and every harness, and cannot express "the lower storey".
`rooms.js:801-806` shows the cost already being paid by hand, a Star Shaft spawn point moved off a
ramp footprint because *"`groundAt` places a body on the HIGHEST surface at its x/z, so it would have
arrived on the ramp and not on the floor the other three use."* Every future ramp repeats that sweep.

### 9. `ui/minimap.js`: the argument for discarding y predates the descent

A deliberate schematic, said at line 1 and argued at :4-26. The load-bearing sentence is *"What is
thrown away is only the stone, walls, props, the ledge, none of which the player navigates by."* A
six-metre drop between Act 2 and Act 3 IS something the player navigates by, and it is now invisible
on the map; `drawContacts` (:674-687) plots an enemy on the bridge and one under it at the same pixel.
Not a defect: a design premise that was true when written and gets less true in every world after this
one.

---

## LOW

- **`core/fog.js:151`, `baseY: -2.0`**, with `heightFalloff: 34`. An absolute world-y datum
  calibrated against the courtyard grade. The Act 3 eye at -4.32 would take about 19 per cent more
  optical depth than the rooms that calibration was measured in. **It cannot bite today**: `:871`
  sets `uAmount` to 0 whenever the camera is inside `INTERIOR_BOUNDS`, and at 0 the pass is a
  bit-for-bit copy. Already flagged latent in DESCENT.md section 6, listed because it is exponential:
  a World 2 floor at -30 gives 2.28x the density every number in that comment block describes.
- **`mummy.js:366` and the two `flow.js` flood samplers**, `ctx.heightAt ? ... : 0`. FAIL-OPEN calls
  this "dead defence pointing the wrong way" and rates it unreachable; that was written when the
  wrong direction coincided with the truth. `ctx.heightAt` is null at `director.js:899` until
  `retarget()` wires it at :1084, and any hand-built `ctx` gets floor 0 in a room whose floor is -6.
  In `flow.js` the flood samplers fall back to `0` while the seed falls back to `pFeetY`, so the
  fallbacks are not even consistent with each other.
- **`dressing.js:52` and `scatter.js:94`, `heightAt = () => 0`.** A default argument that is a flat
  plane at zero. Unreachable today; both live callers pass a real sampler.
- **`courtyard.js:2874` and `:3017`.** The comment *"The interior's fixtures stand on a flat slab and
  can assume it"* is now false (`build.js:1330` places interacts at `base + (slot.y || 0)`), and
  `spawn: new THREE.Vector3(SPAWN.x, 0, SPAWN.z)` declares a y of 0 where the sand is at +0.22.
- **`rooms.js:1011`, `roomAtPoint(x, z)`.** Exported, documented, called by nothing. The 2D
  room-lookup shape waiting in the public surface for its first caller, resting on MEDIUM-6.

---

## test/ and tools/, counted separately

A flat assumption baked into a test means the test cannot detect the bug. That is how all three known
instances survived.

### T1. `test/nav.mjs`: the probe reported no route because the probe said the floor was zero. FIXED IN THE WORKING TREE.

Was `const route = d.flow.costAt(p.x, p.z, 0);` at :263, and the same literal at :156 and :161.
`costAt` (`flow.js:1033`) gates every candidate slot with
`if (feetY !== undefined && (floor[k] > ceiling || feetY - floor[k] > READ_DOWN)) continue;`, and
`READ_DOWN` is 2.2. For an Act 3 cell `feetY - floor[k]` is `0 - (-6)` = 6, every slot is rejected,
the widened search is only `r <= 2` at `STEP` 0.7, and the answer is `-1`. The five descended rooms
hold 3 + 4 + 4 + 5 + 0 = **16** spawn points and `buildInteriorPoints` accepts them, so
`'every spawn point the director uses has a route'` reported exactly sixteen unroutable points on a
map where `descent.mjs` sections 5 and 6 prove by walking a real actor that they route both ways.
Worse at :156 and :161: **all three gallery portals go to Act 3** (`rooms.js:339-341`), so both the
before and after reads were `-1` regardless of the door, and
`'a shut interior door has no route through it'` passed for a reason unrelated to the door.

The working tree now carries a `feetAt(x, z)` helper asking `heightAt(x, z, undefined)`, and its own
comment confirms the diagnosis: *"a report that sixteen of the interior's twenty-four spawn points
were unreachable, on a map where the horde walks every one of them, a false failure, which in a suite
this size is as expensive as a false pass."*

**Kept in this audit for two reasons.** That `route: -1` table is the evidence known bug 3 is being
driven from, so whoever is changing `isClear` should re-read the number after this fix rather than
before it. And `test/navprobe.mjs` had the correct idiom all along, resolving `r.base` and asking at
the floor, at zero and at undefined side by side; it was written to diagnose this and was not carried
back for a week. The same shape is still live in the seven files below.

### T2. `tools/trainability.mjs`: the map law never reads `base`.

`grep -n base tools/trainability.mjs` returns nothing. The law, *"Every room with spawn points must be
in a cycle"*, is asserted over the abstract room graph via `neighbors(id)`. `rooms.js:44-45` states
the consequence: *"a room given a lower `base` than its neighbour is a room that also needs a ramp."*
Author a World 2 room one metre down with a portal and no ramp and the doorway is a hole the player
falls through and the horde cannot climb, and the tool prints `TRAINABILITY: the law holds`. Its
walkable-span section (:161-207) is hardcoded to `great-gallery` and its adjacency test ignores y, so
the three descent ramps are connectivity-checked by nothing in `tools/`.

### T3. `test/powerups.mjs`: a flat stub, and no drop-height assertion anywhere.

`:451` builds the bench world as `world: { heightAt: () => 0 }`, so every claim the roll section makes
over 60,000 kills is made against one floor plane at zero, with kill events at `:300` and `:469`
carrying `position: { x, y: 0, z }`. The live-interior half never asserts a drop's y at all, which is
why HIGH-1 has been shipping. The *other* half of this file was fixed correctly in b12e350: `settle()`
at :251-271 names Act 3 at -6, and `:676` computes `const feet = p.y - 1.68` with a comment about the
six-metre drop. Two halves of one suite now disagree about whether the map is flat.

### T4. `test/hud.mjs:401-408`: three Act 3 stages run with the camera parked six metres up.

`goRoom(id)` calls `place(r.bounds.x, r.bounds.z, 0)`, which is `teleport({ x, y: 0, z })` plus a rig
reset with **no `player.update`**, so the body is never grounded at all. It is called with
`'embalming-chamber'` (:905), `'kings-chamber'` (:963, :1035) and `'star-shaft'` (:1015). Nothing goes
red because every assertion from those rooms is a string or a 2D minimap projection. A capability gap:
this suite cannot host any check about what is visible from an Act 3 room.

### T5. `test/interior.mjs`: two assertions that lost their meaning and one that is 2D.

`:778`, `'ramp starts near the floor': ramp.yBefore < 2.6`, is a one-sided bound on an ABSOLUTE eye y.
Written when 0 was the bottom of the world, so an upper bound was the whole assertion; now a player
who fell to -50 passes it. Its neighbour at :779 is two-sided and still honest. `:538` and `:560`
write `g.player.position.y = 6 + 1.68;` straight into the body, bypassing `teleport()`: the comment
states a relative fact, *"feet on the ledge, not the floor"*, that the code encodes as an absolute,
correct only while `great-gallery.base === 0`. And `:649-666` sprints the King's Chamber, now at -6,
at two walls and asserts containment on **only x and z** (:786-787), while `pos()` returns a y that is
printed and never asserted, so a hole in an Act 3 floor lets the body leave downward and both pass.

### T6. Two fallbacks that now land in the deepest rooms in the map.

`test/deathrespawn.mjs:205-207` targets `great-gallery` and falls back to `rooms[rooms.length - 1]`,
the Serdab, then teleports to `y: 0`, above its ceiling. `test/deathedge.mjs:184` is
`enter('interior', { x: room.cx ?? 0, z: room.cz ?? 0 })` and a room record has `bounds.x`, not `cx`,
so both arms fall to (0, 0), outside `INTERIOR_BOUNDS`. Two sibling files already record having been
caught by that exact typo.

### T7. One shared `place()` contract of "y = 0 is the floor", across the suite.

39 hardcoded `y: 0` teleports across 22 files. Five harnesses share the identical three-line helper
with no settle: `enemies.mjs:96-103`, `settings.mjs:399-406`, `leak.mjs:72`, `curtain-rules.mjs:45`,
`doorlook.mjs:60`. None is broken today, because every placement they make is courtyard or base-0
interior. The structural point is that b12e350 fixed four suites by giving each a **private**
`settle()` rather than correcting the shared contract once, so the next Act 3 placement in any of
these five reproduces the failure that commit already paid for. `grenades.mjs:1198-1217` picks its
wall box from a `py` read one frame after a space swap, correct today only because `rooms.find`
happens to return a base-0 room.

### T8. `test/descent.mjs` is the best file in the suite on this subject. What it does not cover.

It refuses to assert that a ramp record exists; every check moves a body and reads where it ended up,
or asks the field what a route costs. It measures the real-keydown walk, the climb out all three
ramps, `layersFull` against the two-layer cap, and the stone under each doorway read out of
`world.walls`. Gaps:

- **No doorway clear-height check.** MEDIUM-5 is invisible to it.
- **It never asserts anything about a fixture, prompt, interact, wall buy, shrine, chest or power-up
  in an Act 3 room**, which is exactly the band HIGH-1 lives in.
- **It never enters an Act 3 room through the door transition**, so MEDIUM-4 is never exercised
  against a descended destination. No death or respawn at -6 either.
- **The floor table samples one point per room**, the bounds centre. A hole anywhere else in an Act 3
  floor is looked for by nothing.
- `ACT2_FLOOR = 0` and `ACT3_FLOOR = -6` are literals (:48-50). Right for an independent oracle, and
  it means World 2 needs a new file rather than a new row.
- `test/grime.mjs`, which is descent-aware and correct, is **not in `npm test`**.

---

## Where a fail-open and a flat assumption compound

- **`boss.js:383`, `const base = c.y0 === undefined ? 0 : c.y0;`** is textually the purest example of
  this audit's shape and is already FAIL-OPEN HIGH-2. **The descent does not make it worse, and that
  is worth writing down**, because it reads like it should: the King's Chamber is the boss arena and
  is now at -6. `build.js:361-362` gives every interior collider an explicit `y0` defaulting to the
  room's base, so the `undefined` branch is dead inside the pyramid. Only `courtyard.js:198` omits
  `y0`. The failure stays exactly where the fail-open audit put it, outdoors.
- **FAIL-OPEN 18, the 2D `indoors` gate** in `fog.js:869` and `sky.js:642`, compounds with LOW-1 and
  MEDIUM-7. `INTERIOR_BOUNDS` is `{minX, maxX, minZ, maxZ}`: no y component at all, so every consumer
  answers a question about a volume with a rectangle.
- **T1** is a fail-open (`costAt` returns `-1` for "cannot answer") reading a flat input, which is how
  a working map reports red. **T6** is a fail-open fallback that now lands in a room that did not
  exist at this elevation when the fallback was written.

---

## Borderline, judge for yourself

- **`dressing.js:185`**, `if ((c.y0 || 0) + c.h < y + 0.4) continue;`. A `0` base default AND a
  one-sided test: a cylinder with `y0: 6` would "back" a panel at `y: 2`. No symptom only because
  `buildQuarry` and `buildCanal` run at `courtyard.js:2708`, after `dressAvenue` at :2599, so the
  raised colliders are not in the array yet. Ordering is the only thing holding it.
- **`canal.js:162`, `:297` and `quarry.js:164`, `:172`.** Every deck and in-channel collider is
  authored against an absolute grade of zero while the surface they meet is `groundY`. It works, by
  about 0.19 m of margin against `STEP_UP`, and nothing asserts that margin.
- **`doors.js:121`, `:224`.** `VOID` at y 4.4 and `DAYLIGHT` at y 2.10 are hand-placed absolute
  geometry and the reason `rooms.js:87` says *"Room 1 cannot move"*. Immovable rather than
  accidentally flat. `veilFor` reads only `p.z`/`p.x`.
- **`flow.js:243`, `LAYERS = 2`.** Not a defect and explicitly not a general n, argued at :237-242,
  with `layersFull` named as the assertion that catches a third storey and measured at 0. A hard cap,
  and World 2's geometry is the thing most likely to trip it. **`controller.js:601-604`**,
  `headroomAt` finds the highest surface overhead rather than the lowest and says so: *"This map has
  two, so it is exact here."*
- **`batch.js:291`** bins a 3D bounding sphere into an (x, z) cell for culling; theoretical, since
  `build.js` does not import it. **`boss.js:346-372`**, the slam shockwave damages on
  `Math.hypot(dx, dz)` with no y term; fine in the flat King's Chamber, wrong in the Great Gallery.

---

## Verified clean, so nobody re-reads them

Audio is fully 3D with no occlusion model: `audio.js:1543` writes real x/y/z into a `PannerNode` from
`matrixWorld` and `:1638` takes the listener from the camera matrix. `grenades.js` is
elevation-correct throughout. `ui/interact.js:175` and `doors.js:299` are true camera raycasts with a
distance-only `far`; `impacts.js` works from the 3D hit point. `controller.js` grounding, headroom and
wall resolution all take real feet; `camera.js` composes only relative offsets. `courtyard.js:2988`
`heightAt` is the model both samplers were written against. GTAO is view-space with a depth rejection,
not a world-y extent, and `sky.js` `follow()` brackets near/far around the full 3D target.
`viewmodel.js:109` `SHELL_FLOOR` is camera-relative and says so. `uv.js`, `assets.js`, `clouds.js`,
`textures.js`, `geometry.js`, `contact.js`, `anatomy.js`, `wraps.js`, `variants.js` and `main.js`
carry no world-y datum.

---

## World 2 and World 3

`docs/WORLDS.md:241` specifies World 2 as *"Deeper stone, ceilings under six, no room that gives the
eye distance."*

**One-off fixes.** HIGH-1, HIGH-2, MEDIUM-3, MEDIUM-4, both LOW comment items, T5 and T6 are each a
line or a signature. They cost an afternoon and do not come back. T1 already has.

**Structural, and they will cost again at every level.**

- **MEDIUM-5 bites first, and it bites arithmetically.** `portalOpening` requires
  `height >= drop + 5.0` for a full-height door, the rule the Canopic Crypt priced. World 2 is
  specified with **ceilings under six**. Six minus five is one: **the maximum drop into any World 2
  room through a full-height doorway is under one metre.** The builder will not complain: `clear`
  shrinks, goes negative, and `head = sill + clear` starts emitting the stone above the opening below
  the sill. World 2's stated ceiling budget and its stated depth are in direct conflict and the code
  absorbs it silently. Wants a per-portal `DOOR_H`, or a minimum-clear assertion that fails the build.
- **MEDIUM-6 with `LAYERS = 2`.** World 1 gets away with rooms edge to edge in plan. World 2 is
  described as a place with no sightlines, the geometry most likely to want stacking. The moment two
  rooms share plan area, `roomAt`, `roomAtPoint`, the `floors` array, `trackRoom` and the minimap are
  all wrong at once and none of them says so.
- **MEDIUM-7** gets worse linearly with depth: at -40 the sampler answers a question about stone with
  a number forty metres out. **LOW-1** gets worse exponentially. **MEDIUM-9**: three worlds of descent
  on a diagram with no elevation. **T2**: every world after this one is authored by giving rooms a
  `base`, and the tool that certifies the map survivable does not know the field exists.

**THE ONE CHANGE: give every world-space query the y it is being asked about.**

Seven signatures still take `(x, z)` and answer a question that stopped being 2D on 2026-08-01:
`director.isClear`, `director.obstruction`, `director.placeAt`, `powerups.floorAt`,
`interior.roomAt`, `spaces.enter`'s `at` record, and the `flow.costAt` calls in `test/nav.mjs`.
`heightAt` already has the argument, in both spaces, with the same contract, and it is the only
function in the tree that survived the descent unscathed. That is not a coincidence and it is the
whole recommendation: the descent cost a night of forensics because the map has exactly one
elevation-aware primitive and everything upstream of it still speaks in two coordinates.

The forcing function that makes it stick, and the cheapest single piece of new work in this document:
**one contract suite driven off `base`**. For every room, read `base` out of `rooms.js` and assert
against the built world that the floor samples at it, that no two rooms share plan area, that every
portal spanning an elevation change has a walkable surface bridging it, that every doorway's clear
height clears a standing body, and that a body routes both ways across it. Five assertions that turn
the next descent from a night of forensics into a red check, and every one of them is a generalisation
of something `test/descent.mjs` already does for exactly one seam.
