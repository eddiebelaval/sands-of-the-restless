# B3AR: the two patches I cannot apply myself

Both files are yours. Everything else is already in the tree.

Tested against:

    src/world/courtyard.js  sha256 d7399a8744021d0d38fd28b3ea8583ddc6de85310cfeb0979a662abbce885b1d
    src/main.js             sha256 127cc224f5b4b4a0e95b13da184ab80f9172940329f4aa437d2634bac6d77a20

---

## 1. src/world/courtyard.js - three edits

### 1a. the import, with the other world imports at the top of the file

FIND (line 20-21):

```js
import { batchStatics } from './batch.js';
import { buildQuarry, QUARRY } from './quarry.js';
```

REPLACE WITH:

```js
import { batchStatics } from './batch.js';
import { buildWallBuyFixture } from './build.js';
import { buildQuarry, QUARRY } from './quarry.js';
```

### 1b. the fixture itself, immediately AFTER the batching call

FIND (line 2612, the last line of the batching block):

```js
  const batched = batchStatics(group);

  return {
    group,
    colliders,
```

REPLACE WITH:

```js
  const batched = batchStatics(group);

  // -------------------------------------------------------------------------
  // the B3AR wall
  // -------------------------------------------------------------------------
  //
  // THE FIRST FIXTURE THAT WAS EVER OUTSIDE. Every wall buy in the game was an
  // interactSlots entry in rooms.js, which is the inside of the pyramid; MAP.md
  // puts the Act 1 triple-shot pistol on a courtyard wall for 400, and the
  // interaction layer had no exterior source of any kind. It takes `courtyard`
  // now, the way systems/doors.js already did, and this is what it reads.
  //
  // The plaque itself is built by world/build.js and not here, deliberately. It
  // is the same builder the four interior walls come out of - same panel, same
  // recessed ground, same CHALK silhouette table, same raking lamp that took two
  // goes to place - so the wall that sells the B3AR and the wall that sells the
  // SMG cannot drift apart. See buildWallBuyFixture.
  //
  // WHERE, AND WHY THIS BAY. West wall, bay 3, which spans z = 0 to 9: the
  // midpoint of the avenue, on the walk from the spawn at (0, 30) to the sealed
  // doorway at z = -30, and the player passes within five metres of it without
  // being routed. It is the only kind of bay that can carry a plaque - not a
  // chapel recess (west 1, 4 and 6), not the canal's bought gate (west 5) or its
  // breach (west 2), and not one of the two bays that lay projecting string
  // courses, which stand 0.16 proud at the height the panel wants (0 and 1).
  //
  // z = 5.6 INSIDE that bay is not the bay centre, and the reason is a
  // photograph: at the centre, 4.5, the avenue brazier at (-11.2, 3) stands two
  // metres off the wall directly in front of the panel and its bowl covers the
  // bottom right of the mark. 5.6 puts 2.6 metres of clear air between them and
  // still leaves a metre to the buttress pylon at z = 8.05, which frames the
  // plaque from the north instead of crowding it.
  //
  // x = -13.48 is arithmetic, not taste. The bay wall is 2.6 thick centred on
  // x = -15, so its avenue face is at -13.7; the plaque body is 0.22 deep and
  // hangs BACK from the fixture origin, so an origin at -13.7 + 0.22 puts the
  // panel flush against the stone with the chalk standing proud of it. The
  // fixture faces east, which is local -z rotated to world +x: rot = -PI/2.
  //
  // It sits on `groundY` rather than on zero because out here the floor is a
  // dune field. The interior's fixtures stand on a flat slab and can assume it;
  // nothing outside can.
  const interacts = [];
  {
    const rec = buildWallBuyFixture({
      type: 'wallbuy',
      x: -13.48, y: groundY(-13.48, 5.6), z: 5.6, rot: -Math.PI / 2,
      config: { weapon: 'b3ar', cost: 400 },
    });
    if (rec) { group.add(rec.group); interacts.push(rec); }
  }

  return {
    group,
    colliders,
```

### 1c. publish it, in the return

FIND (the `jars` field in the returned object):

```js
    jars: [JAR],
```

REPLACE WITH:

```js
    jars: [JAR],

    /**
     * Fixtures the crosshair can buy from, in the shape ui/interact.js reads
     * off `interior`. One entry today, the B3AR wall. It is a published array
     * rather than a single record because the courtyard is the whole of Act 1
     * now and the next fixture out here should be a row, not a second field.
     */
    interacts,
```

---

## 2. src/main.js - two one-line edits

### 2a. hand the interaction layer the courtyard

FIND (line 206-212):

```js
  const interacts = createInteracts({
    camera,
    interior: spaces.interior,
    spaces,
```

REPLACE WITH:

```js
  const interacts = createInteracts({
    camera,
    interior: spaces.interior,
    // The exterior sells one thing: the B3AR, on the avenue wall. Passed the
    // same way doors.js has always been passed both spaces, so one prompt and
    // one F key serve inside and out. See ui/interact.js.
    courtyard,
    spaces,
```

### 2b. the eighth digit

The B3AR is appended to SLOTS rather than filed next to the MK9, so that no
existing weapon moves off the key it has been on since the first room - the HUD
prints the digit off that same array, and test/hud.mjs asserts five of them by
number. That puts it on 8, and the key handler stops at 7.

FIND (line 795-797):

```js
    // Digit1..Digit7 select a weapon directly.
    const n = /^Digit([1-7])$/.exec(e.code);
    if (n) weapons.equip(SLOTS[Number(n[1]) - 1]);
```

REPLACE WITH:

```js
    // Digit1..Digit8 select a weapon directly. Eight because the B3AR is the
    // eighth entry in SLOTS - appended, so that the seven weapons the map has
    // been teaching since the first room keep the keys they were learned on.
    const n = /^Digit([1-8])$/.exec(e.code);
    if (n) weapons.equip(SLOTS[Number(n[1]) - 1]);
```

---

## 3. test/economy.mjs - two literals that MUST move

Both are exact-count assertions and both now fail, correctly: there is a
fifteenth fixture and a fifth wall buy, and they are the same fixture. The whole
value of asserting a literal is that it fails when the inventory changes, so
this is the check doing its job rather than a break.

Measured against the running build, not derived:

    interacts.records.length                       15
    wall buys, in build order (interior then out)  smg:1000,shotgun:1200,carbine:1500,lmg:1600,b3ar:400

FIND (line 1027-1028):

```js
  'fourteen fixtures are wired':      opening.fixtures === 14,
  'four wall buys, priced':           opening.wallbuys.join() === 'smg:1000,shotgun:1200,carbine:1500,lmg:1600',
```

REPLACE WITH:

```js
  // Fifteen, not fourteen, and the fifteenth is OUTSIDE. The count is now
  // 4 + 6 + 1 + 3 inside and one on the avenue wall - the B3AR, the only wall
  // gun in the courtyard and the only fixture in the game that is not in a
  // room. It is in this list because it is in `interacts.records`, which is the
  // point: one fixture registry, one prompt, one F key, both sides of the door.
  'fifteen fixtures are wired':       opening.fixtures === 15,
  'five wall buys, priced':           opening.wallbuys.join() === 'smg:1000,shotgun:1200,carbine:1500,lmg:1600,b3ar:400',
```

The B3AR comes last in that string because the interaction layer collects the
interior first and the courtyard second. Everything else in both suites passes
unchanged: test/gun.mjs is green (17/17) and the rest of test/economy.mjs is
green (all other checks), including the SMG wall at 1000 inside.
