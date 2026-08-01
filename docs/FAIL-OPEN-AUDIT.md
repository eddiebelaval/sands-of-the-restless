# FAIL-OPEN AUDIT

A sweep of `src/`, `test/` and `tools/` for one defect shape: a check that cannot answer its
question returns the value meaning "no problem here", so the failure is silent and reads as a pass.

Line numbers are as of this audit. Three agents were editing `src/enemies/`, `src/world/` and
`test/` concurrently, so anchor by function name where a number has moved.

---

## BLUF

- **19 real instances** beyond the two already known: 7 HIGH, 8 MEDIUM, 4 LOW. Nine more are listed
  as borderline. Roughly twice that many permissive defaults were read and rejected because the
  surrounding comment argues for them correctly.
- **The worst is `src/enemies/director.js:654`**, `reach.size &&` in the spawn filter. When the
  director does not know which room the player is in, the anti-seal reachability filter switches
  itself off and every candidate point is accepted. It is the known `reachesPlayer` bug one layer
  up, inside the code that bug was supposed to protect.
- **Tests are affected, badly: 6 of the 19 are in `test/` or `tools/`.** `test/leak.mjs` passes on
  zero observations, `tools/trainability.mjs` unfalsifies its own law on a field rename, and
  `test/nav.mjs` encodes five skipped checks as literal `true` while a duplicate object key
  silently deletes a sixth.
- **A shared fix exists and is already spelled correctly twice in this codebase.** These are not
  independent: they are one missing third state. Every instance is a two-valued answer to a
  three-valued question.
- **One instance already shipped as a live bug, was diagnosed in a comment, and the fail-open was
  left in place**: `audio.js` `startAmbience`. `main.js:826` is the post-mortem. The call site was
  fixed; the forgiving default that hid it was not.

---

## Already known

**`src/enemies/director.js` `reachesPlayer` / `playerIsland`.** The `if (island < 0) return true`
form is **fixed in the working tree**: `playerIsland` resolves an unknown to `field.main`
(director.js:612-616), with the write-up at 596-610. A second fail-open survives in the same
function, listed as HIGH-4.

**`src/world/dressing.js:274-276`**, `const top = wall ? wall.h - 1.4 : 7.7` then
`if (top < 3.4) continue`. Owned by another agent, no fix proposed here. Note for that owner only:
the same file has a second `bayHeight` fallback at **dressing.js:177**,
`if (!bayHeight) return { top: spanTop }`, which supplies a nominal top that satisfies the
`if (!w) continue` guard at line 193. The per-bay path four lines below it
(`if (!w || !e || w.ruined || e.ruined) return null`) is the correct spelling, and is right there
for comparison.

---

## HIGH

Can hide a player-visible bug, or manufacture a false test pass.

### 1. `src/enemies/director.js:654`: unknown room disables the anti-seal spawn filter

```js
if (interior && p.room && reach.size && !reach.has(p.room)) continue;
```

with `computeReach` at 503-505: `reach.clear(); if (!fromId) return;`

**Asks:** can an enemy spawned in `p.room` walk to the player, or is it behind a barrier the player
has not bought? **Unknown answer:** `computeReach(null)` leaves the set empty, `reach.size` is `0`,
the conjunction short-circuits, and the membership test never runs. Every point is accepted. `p.room`
does the same: a point with no room field skips the filter rather than being rejected.

**Permissive because** the conjunct meaning "I have no reachability data" sits on the same side as
"this point passed". The unknown is indistinguishable from an approval.

**Scenario:** `spaces.roomId` is `null` for a whole interior visit whenever `roomAt` never resolves,
and `spaces.js:412` (`const next = room ? room.id : roomId`) will not replace a null. Entering the
interior without an `at` argument leaves the player at courtyard coordinates and `roomId` null. The
next wave places shamblers behind unbought gates and the round never ends. The stall watchdog at
director.js:1216 does not fire, because it needs `queue.length && !live.length` and the actors are
live, just sealed in. The function header at 494-496 names this exact outcome as the thing it exists
to prevent.

### 2. `src/enemies/boss.js:383`: boss projectiles measure stone from world zero

```js
const base = c.y0 === undefined ? 0 : c.y0;
if (p.y < base || p.y > base + c.h) continue;
```

**Asks:** is a boss projectile inside stone here? **Unknown answer:** assume the stone starts at
y = 0, and `continue` means not blocked. A numeric default sitting on the permissive side of the
comparison on the next line: a collider whose real span is `[g, g+h]` is tested as `[0, h]`, so
every projectile between `h` and `g+h` passes through solid stone.

**Not a choice:** four lines earlier, in the same `if`, the same projectile takes its floor from
`groundAt(ctx, p.x, p.z, p.y)` (boss.js:345). Every other file resolves an undeclared base to the
local floor: `mummy.js:424,504,598`, `grenades.js:722,911`, `controller.js:665`, `flow.js:353`.
`boss.js` is the only one using `0`.

**Scenario:** the exterior floor is `dunes.heightAt(x,z) - canalDepthAt(x,z)` (courtyard.js:363), so
it is never flat and the canal runs to `-3.2`. A pillar on a dune crest at y 1.5 with h 6 is tested
as `[0, 6]`; an Anubis bolt at 6.8 clears the test and flies through the stone. In the canal the
sign flips and every projectile below zero is unblockable. boss.js:341 says "A projectile that sails
through a pillar tells the player the pillar is not cover, which is a lie the whole arena is built
on."

### 3. `test/leak.mjs:151`: the suite passes on zero observations

```js
const leaks = mismatched.filter((r) => r.veil < 1);
const stuck = rec.length && rec[rec.length - 1].veil > 0;
const ok = leaks.length === 0 && !stuck && errs.length === 0;
```

`rec` is populated only from inside the monkey-patched `composer.render` at :50-68. If that patch
never runs, `rec` is `[]`, `leaks.length === 0`, and `stuck` is `0 && ...`, falsy. `ok` is true.
Line 131 prints `frames committed:` and nothing gates on it.

**Scenario:** a refactor moves the space swap onto a direct `renderer.render()` path, or the
transition renders through a second composer. Every crossing then shows the wrong world with the
curtain half up, and leak.mjs prints `frames committed: 0` followed by `PASS  no frame of the wrong
world ever reached the screen`, exit 0. That is the documented "instrument reported success from a
canvas that drew nothing" failure, reproduced in the file claiming immunity to it.

### 4. `src/enemies/director.js:1337`: `reachesPlayer` answers `true` for the whole interior

```js
reachesPlayer(x, z) {
  if (!nav) return true;
```

`nav` is deliberately null inside the pyramid (director.js:1096-1100: the interior answers
reachability through its room graph), so every interior point reports reachable. The fixed half of
this function returns `-1` for "this space does not answer the question this way", and :608-610 says
callers read that as unknown. This branch does not pass the unknown up. It returns `true`, the value
the same file calls "a false-pass generator" at :598. The only consumer is the harness,
`test/enemies.mjs:422` and `:424`, so its entire blast radius is manufacturing false confidence: any
interior variant of the `allOnPlayersIsland` probe cannot fail, for the same reason and with the
same symptom as the canal that stayed sealed through a paid purchase.

### 5. `test/nav.mjs:403-407`: five checks whose skip is a pass, and a sixth that never runs

```js
if (!bar)   return { skipped: 'no shut barrier off the gallery' };   // :146
if (!claim) return { skipped: 'no unopened courtyard claim' };       // :182
...
'a shut interior door has no route through it': doorI.skipped ? true : doorI.routeShut < 0,
'buying it opens one on the same frame':        doorI.skipped ? true : doorI.routeOpen > 0,
'and an actor then walks it':                   doorI.skipped ? true : doorI.chased.arrivedAt !== null,
'a shut courtyard claim has no route through it': doorE.skipped ? true : doorE.routeShut < 0,
'buying it opens one on the same frame':        doorE.skipped ? true : doorE.routeOpen > 0,
```

The skip reason is itself a plausible symptom of the bug: barriers authored but not adopted,
`opened` defaulting true, `courtyard.claims` renamed. Line 181 already defends with
`(g.courtyard.claims || [])`, so a rename yields `[]`, then `skipped`, then two free passes.

**Second defect, same lines.** Lines 404 and 407 are the same string key in one object literal, so
the later wins and **the interior door's "buying it opens one on the same frame" assertion is
deleted at parse time and never runs**. A sweep of every `test/*.mjs` returns exactly this one
duplicate.

The author knew about the skip hazard: :116-121 says "Run after them, this block finds no shut door,
skips, and reports three passing checks that tested nothing at all." That comment fixed the ordering
only. It names the problem; it does not justify the encoding.

### 6. `tools/trainability.mjs:111-115`: the law exempts itself on a field rename

```js
const spawns = (r.spawnPoints || []).length;
if (!spawns) continue;
```

The stated law is "every room with spawn points must be in a cycle". `|| []` supplies exactly the
value that satisfies the skip on the next line, and the report prints the reassuring
`'no spawns, exempt'` at :79. `failures` never increments, so :213 exits 0. Rename `spawnPoints` in
`rooms.js`, or move the points behind a getter, and every room becomes exempt while the act-train
and gallery-ring sections still pass from portal data. The tool prints `TRAINABILITY: the law holds`
over a map where the Serdab is a spawning dead end.

### 7. `test/act1probe.mjs:79, 162-165`: an immobile player passes the leak law

```js
if (onBound) leaks++;
const leaks = [...walkSealed, ...walkOpen].reduce((a, r) => a + r.leaks, 0);
process.exit(errs.length || leaks ? 1 : 0);
```

"Did the player sprint out through a hole in a wall" is answered by counting walks that finish on
the bounds rectangle. Zero satisfies both a sealed map and a probe that never moved. `far` and
`furthest` are computed at :80-83 and only printed. If `g.player.update` stops moving the body, all
240 walks end where they started and the script reports PASS.

Compounding it, the header promises three questions and only this one reaches the exit code:
`heights` (:93) and `islands()` (:117) are printed and never asserted, and the connectivity probe
fails open by construction at :121-122, returning a note when the director exposes no nav handle.

---

## MEDIUM

Real, but needs a second condition, or is confined to tooling.

### 8. `test/nav.mjs:395-396`: the owner-reported case passes on an empty run list

`arrived.length === t.runs.length` and `t.runs.every((r) => r.closest < 3)`. `runs` comes from
`kings.spawnPoints` (:229); an empty array gives `0 === 0` and a vacuous `every`, and nothing asserts
`runs.length`. Flagged at :208 as "THE CASE THE OWNER REPORTED, written down as a test". Related:
`chase()` returns `null` when `placeAt` fails (:77), `{...null}` spreads to `{}`, and `arrived` at
:368 counts `arrivedAt !== null`, so `undefined` reads as arrived.

### 9. `src/core/audio.js:1264-1268`: unknown ambience becomes a sealed stone room, and reports success

```js
function startAmbience(profile) {
  ambienceProfile = AMBIENCE[profile] ? profile : 'chamber';
  ...
  return true;
}
```

`return true` is the caller's only signal and it is set from nothing. The sibling twelve hundred
lines up does the opposite: `setSpace` at :735 opens `if (!SPACES[name]) return false`. The two
namespaces are near-miss neighbours, so a name valid for one silently misses the other.

**This already fired.** main.js:826-829: "startAmbience falls back to 'chamber' on an unknown profile
RATHER than throwing, so this failed silently and the open desert has been playing sealed-room
ambience since it was wired. A forgiving default turns a typo into a bug with no symptom in any
log." The call site was corrected; the default that hid it was not, and there is no `hasAmbience()`
to match the `hasWeapon()` escape hatch documented at audio.js:68.

### 10. `src/world/build.js:118-129`: an unresolved room becomes an infinite ceiling

```js
let ceil = Infinity;
for (const r of [near, far]) { if (!r) continue; ... }
if (!Number.isFinite(sill)) sill = 0;
return { sill, clear: Math.min(DOOR_H, ceil - sill - 0.8) };
```

A `rooms.find` miss drops that room out of the `Math.min`, so `ceil` keeps its `Infinity` seed,
which sits on the permissive side of the `Math.min(DOOR_H, ...)` immediately following: the doorway
gets maximum legal height with no constraint applied. The asymmetry is the tell, `sill` gets a
finite-check rescue and `ceil` does not. A portal pointing at a renamed room then cuts a doorway
running clean to the ceiling, skipping the lintel branch at :850, which is the failure :846 calls
"the single clearest tell of a generated map".

### 11. `src/enemies/flow.js:779`: `stat.valid = true` set unconditionally

Already on your list, confirmed by reading. `rebuild` clears `valid` on three early failures (:432,
:483, :526) but the tail sets it true for any flood that completes, including one that settled a
single slot because the retry at :737 found no alternative seed. Mitigated at the one live caller:
director.js:1069-1073 re-derives the verdict from `stats().visited < FLOW_MIN_VISITED` and calls
`invalidate()`, reasoned at :1000-1040. MEDIUM rather than HIGH because of that, but the
`get valid()` accessor still lies to anything else that asks, and the mitigation lives in a
different module from the lie.

### 12. `src/core/input.js:855, 876-881`: the pointer-lock probe is skipped and can never be re-armed

```js
const probe = opts.probe !== false && lastDevice !== 'pad';
if (!probe) return;
...
relock() { if (state.fallback) return false; state.active = true; requestLock(); return true; },
```

Skipping the probe leaves `state.fallback` false, and false means "pointer lock is healthy here".
The skip is justified at :843-851, half correctly. What does not hold is the stated recovery:
`relock()` never probes and returns `true` unconditionally, and `onLockChange` (:308-310) only ever
clears `fallback`, never sets it. Once the boot probe is skipped, nothing on any path can flip the
flag. Embedded in an iframe without `allow="pointer-lock"` and started from a controller, the player
picks up the mouse, `onMouseMove` hits `if (!state.locked && !state.fallback) return`, and every
delta is dropped. Mouse look is dead and the notice at main.js:835 never fires.

### 13. `src/world/courtyard.js:181`: a clearance rule declared, documented as enforced, read by nobody

```js
// The spawn point, and the radius that must stay clear of scattered props.
// Declared before anything is placed so every placement loop can test it.
const SPAWN_CLEARANCE = 9;
```

`grep -rn SPAWN_CLEARANCE src test tools docs` returns exactly one line, this one. The only spawn
exclusion that runs is a separate hardcoded `r: 3.5` passed into `buildScatter` at :2496, 39 per
cent of the declared radius, governing instanced ground scatter only. The comment is the fail-open:
it tells the next reader the rule is enforced, so a loop that omits the test looks identical to one
that ran it and passed. A prop landing 4 metres from spawn is placed, gets a collider, and nothing
reports it.

### 14. `src/world/build.js:2427`: a portal with no wall line gets no barrier, and absence reads as open

```js
const axis = portalAxis(p, rooms);
if (!axis) continue;
```

`portalAxis` (:2596-2607) returns `null` when neither room's wall line is within `WALL_T * 0.55` of
the portal, so the barrier is never built, and every downstream reader treats a missing barrier
record as an open doorway: `ui/objective.js:97` (`if (!edge.barrier) return true;  // kind 'open':
never built`), `ui/minimap.js:352`, `director.js:539`. Note also that `portalAxis` tests the wall
LINE only while the shell builder at :809-812 tests line AND span, so the claim at :2593 that "a
portal either belongs to a wall for both of them or for neither" holds for one of the two tests. A
portal on the line but outside the span gets a barrier standing in solid stone that the player can
pay gold for.

### 15. `test/shot.mjs:97-124, 226`: the movement probe is printed and excluded from the verdict

The comment at :97 says the walk exists "to prove the controller and colliders work". `probe.moved`
can be `0` and `probe` can be `{error: 'game did not expose __SANDS__'}`; neither enters
`bad = errors.length + warnings.length + (blackFrame ? 1 : 0)`. The final line prints `PASS: world
rendered, no console errors or warnings`, literally true, which a reader takes as the walk having
succeeded. Credit where due: the black-frame gate at :218 is real and does fail the run, which is
what makes the soft `WARN boot` at :88 acceptable.

---

## LOW

**16. `src/core/governor.js:179`.** `apply()` calls `post?.setAO?.()`, `post?.setBloom?.()`,
`sky?.setShadowScale?.()`, then sets `rung = next` unconditionally, so `get id()` reports a rung the
composer may never have reached. The tolerance is deliberate and argued at :154-157; the reporting
is not. main.js:1474 exposes the governor precisely so a tool can "read the rung the machine
actually settled on". Low because all four setters exist in the real build.

**17. `src/enemies/boss.js:673-682`.** The comment claims the teleport lands "on a point the world
says is standable". The code calls `resolveAgainstWorld`, which is overlap resolution rather than a
predicate, and discards its documented return value; `mummy.js:592` `pointClear()` is the predicate
and is not called. A 7.5 m jump landing cleanly past the colonnade overlaps nothing, so nothing
objects, and Anubis paces a region with no route to the player. `navBoss` already exists at
director.js:1098.

**18. `src/core/fog.js:868` and `src/world/sky.js:641`.** `const indoors = p.x > B.minX && ...` over
`INTERIOR_BOUNDS`, described at rooms.js:972 as a constant for "sanity checks and minimaps", not a
derivation. Exact today, asserted nowhere. A room authored outside the rectangle reads
`indoors === false` and gets the outdoor pass at full strength, which is the regression fog.js:849
records: "AN OUTDOOR PASS WAS LIGHTING THE INTERIOR AND THREE SUITES PASSED ON IT."

**19. `src/world/assets.js:132`.** `failed` is the module's only failure channel and only a network
or decode throw writes to it. A `stem` in `MATERIAL_SETS` with no entry in `SLOT` loads fine,
assigns to `maps[undefined]`, leaves `maps.map` falsy, and the whole set is dropped by
`if (maps.map) sets[role] = maps` with `failed` still empty. main.js:517 keys the player-visible
status on `failed.length`, so nothing is said. The graceful degrade itself is argued at :72-78.

---

## Borderline, judge for yourself

- **`src/systems/doors.js:644`** `lockedBecause` returns `null` for any unrecognised `kind`, so a
  misspelled or new gate kind becomes purchasable. Correct for the two kinds that really are
  gold-only, open at the write end. (Adjacent, opposite direction, out of scope: `state.jarsReturned`
  is never incremented anywhere, so the serdab puzzle gate is permanently locked.)
- **`test/enemies.mjs:405`** `mean = (a) => ... / (a.length || 1)` feeding checks :1212 and :1216. An
  emptied `d.live` gives `meanEnd 0` and `furthest 0`, both PASS. Backstopped twice: `closest`
  initialises to `Infinity` so :1213 fails, and the harness sets `combat.state.invulnerable = true`
  at :332 so the list cannot be cleared by a death. Same shape at :422, a vacuous `every` over
  `d.live`.
- **`test/governor.mjs:208, 210`** `!!pass(/GTAO/i)?.enabled` yields `false` for a missing or renamed
  pass, which is the value meaning "correctly turned off". Saved only by the opposite-polarity
  assertions at :207 and :209 on the same object, one "redundant" deletion away from live.
- **`test/economy.mjs:1201`** `!/GOLD/.test(collected.promptAfter)` passes on an empty prompt. The
  file's other negated-regex checks are all paired with a positive twin; this one is not.
- **`test/descent.mjs:548`** `.filter(band).every(...)` with no `.length` assertion. A sampling or
  route change that empties the 14 metre band makes the slope law vacuous.
- **`src/core/gamepad.js:606-620`** `rumble()` returns `true` after `playEffect`, whose rejection is
  swallowed by `p.catch(() => {})`. The swallow is deliberate and argued at :598-601; the return
  value was not part of that argument.
- **`src/enemies/mummy.js:366`** `groundAt` returns `0` when `ctx.heightAt` is absent, and `0` sits
  on the permissive side of both collider tests downstream. Same at flow.js:507, 665, 666.
  Unreachable in practice, `retarget()` wires `heightAt` at construction (director.js:1130), and
  flow.js:353 calls it unguarded so it would throw first. Dead defence pointing the wrong way.
- **`src/systems/wallbuy.js:64`** `const take = cfg.cost || 0`, then `canAfford(0)` is true. Closed
  downstream only because `economy.spend` refuses `n <= 0`. The prompt still quotes "0 GOLD [F]".
- **`tools/perf.mjs`** and **`tools/render-doc.mjs`** both make claims (frame cost, "every word
  reaches the HTML") that nothing verifies, and both exit 0 on page errors. perf.mjs is explicitly
  not an assertion tool (:29-33), so the risk is a human reading a fictitious number.

---

## Is there a shared fix

Yes, and it is worth arguing rather than asserting, because on the surface these look independent: a
nav filter, a projectile test, a reverb lookup, an ambience name, a pointer-lock probe, six test
harnesses. Different subsystems, different authors' evenings.

**They are one defect.** Every instance is a **two-valued answer to a three-valued question**. The
real answer set is `{yes, no, I could not tell}`, the return type carries two, and the third has to
be spent on one of the other two. It gets spent on the permissive one every time, for a consistent
and understandable reason: this is a frame loop, and the alternatives are throwing or stalling, both
of which cost the player the game. Fail-open is the cheapest place to put an unknown when the other
options are worse. That is why it recurs across unrelated files with no shared author intent.

**The evidence that it is one defect and not a coincidence:** the codebase already solves it
correctly, twice, and both times with the same fix.

- **`-1` as an explicit third state.** `playerIsland` (director.js:613), `walkComponents.at`/`.near`
  (:417, :447), `flow.openSlot` (:413), `flow.seedAt` (:522), `flow.costAt` (:955). Integer answers
  in the two navigation modules already have a documented "cannot answer" sentinel. Every HIGH
  finding above is a boolean or a numeric measurement where that sentinel had nowhere to live.
- **A flag set from the thing it describes.** `src/core/retro.js:326-340`, `RetroDepthBindPass`, does
  `if (!depth) { this.bound = false; return; }`. That is the correct spelling of a capability flag,
  and the exact inverse of flow.js:779, governor.js:179 and audio.js:1268.

**So the fix is a convention with two clauses, not a helper.**

1. **A predicate that can fail to measure does not return a boolean.** It returns
   `true | false | null`, and the caller is forced to say what it does with `null`. Where the call
   site genuinely needs a boolean, the module exposes a companion probe, exactly as audio.js:68
   documents `hasWeapon()`. `startAmbience` needs `hasAmbience()` and does not have one, which is
   finding 9 in a sentence.
2. **An unknown is reported, not absorbed.** The whole `src/` tree contains **two** `console.warn`
   calls and zero `throw`s, at main.js:525 and director.js:1220. That is the structural cause of this
   audit: there is almost no channel for "I could not answer", so the answer has to be a value, and
   the permissive value keeps the frame running. The channel exists and the project already treats
   it as load-bearing. gamepad.js:600 states that "a console error in this project is a test
   failure"; director.js:1215 states "Reported, because a silent recovery here would hide the bug
   that caused it." Two files have the rule. Nineteen places do not.

**For `test/` and `tools/` the fix is narrower and mechanical**, and worth separating because six of
the nineteen live there and they are the worse half. Every `.every(...)`,
`.filter(...).length === 0` and `skipped ? true` above needs one companion line asserting the
population was non-empty. `test/b3ar.mjs:171` is the model already in the repo:
`check(burst.shots.length >= 3, 'one held trigger produces rounds at all')` runs before
`intra.every(...)`, so `0 === 0` cannot pass alone. `test/enemies.mjs:1221` states the doctrine
outright, "it is asserted rather than skipped", and `test/headshot.mjs:132` states it again, "A
skipped check is not a passing one". The rule is written down in this repository twice.
`nav.mjs`, `leak.mjs`, `act1probe.mjs` and `trainability.mjs` predate it or missed it.

**What I would not build:** a `maybe()` wrapper or a generic three-state type. The call sites are too
varied, and a wrapper adds a layer without forcing anyone to handle the third state, which is the
only thing that matters. The forcing function is the convention plus one grep in review: any
`return true`, `|| <constant>`, `?? <constant>` or `!x ? <constant>` inside a function whose name is
a question needs a one-line comment saying what happens when the question cannot be answered. Where
that comment already exists here, the default is almost always correct, and that is the strongest
evidence for the convention. The author's habit of explaining a default is already, empirically, the
thing that separates the deliberate ones from the nineteen above.
