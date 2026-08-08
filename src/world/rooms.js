/**
 * The interior room graph: pure data, no geometry, no THREE import.
 *
 * The map is data so that layout can be reasoned about, diffed, and tested
 * without a GPU. Everything here is plain JSON-shaped values, which is what
 * lets the node harness assert connectivity and item counts without booting a
 * renderer. `build.js` is the only module allowed to turn these records into
 * meshes; if geometry starts leaking in here, both properties are lost.
 *
 * Coordinates are world units in the interior cell. The interior is a separate
 * cell from the courtyard rather than a literal cavity inside the exterior
 * pyramid: the playable interior is far larger than the 62-unit stepped mass
 * that reads well on the skyline, and no amount of scaling reconciles the two.
 * The sealed doorway hands the player over to ENTRY below.
 *
 * bounds is {x, z, w, d} where x/z is the CENTRE of the room and w/d are its
 * full extents along X and Z. So the footprint is
 * x - w/2 .. x + w/2 by z - d/2 .. z + d/2. Rooms are laid out to share exact
 * wall lines with their neighbours, because that is what lets the builder cut a
 * portal opening from either side and have the two halves line up.
 *
 * ---------------------------------------------------------------------------
 * `base` IS THE FLOOR'S ABSOLUTE ELEVATION, AND EVERYTHING ELSE IS RELATIVE TO IT
 * ---------------------------------------------------------------------------
 *
 * It defaults to 0, which is where every room in this map sat until World 1
 * needed a descent. `height` is still the CEILING MEASURED FROM THAT FLOOR, and
 * every other y in a room record - a ramp's y0 and y1, a propSlot's y, an
 * interactSlot's y - is measured from it too. Nothing in here is a world
 * coordinate in Y. That is what lets a room be lowered by changing one number
 * instead of thirty, and it is why the elevation table in docs/DESCENT.md can be
 * read as a column of depths rather than as a diff.
 *
 * TWO ROOMS AT DIFFERENT ELEVATIONS MUST NOT SHARE PLAN AREA. `roomAtPoint` and
 * the builder's floor sampler both answer from x/z alone, and the flow field
 * carries a hard cap of two storeys per cell (`enemies/flow.js` LAYERS). Rooms
 * are laid out edge to edge, so this holds by construction today; a room
 * authored on top of another one breaks the sampler before it breaks the horde.
 *
 * A DOORWAY BETWEEN TWO ELEVATIONS SITS AT THE HIGHER FLOOR, and the builder
 * derives that rather than reading it from here - see portalOpening in
 * build.js. The LOWER room is then responsible for carrying the player from
 * that threshold down to its own floor. A step bigger than STEP_UP (0.65) with
 * nothing walkable spanning it is a hole, not a descent, so a room given a
 * lower `base` than its neighbour is a room that also needs a ramp.
 *
 * A propSlot may also carry an optional y (it defaults to the floor, and a slot
 * with a y is decoration only because a collider cylinder has no base height)
 * and an optional config, for the few props the systems have to tell apart or
 * size differently.
 *
 * rot is a yaw in radians using the same convention as the player controller:
 * forward is (-sin yaw, 0, -cos yaw). So yaw 0 faces -Z, PI faces +Z, PI/2
 * faces -X, -PI/2 faces +X. A slot's rot is the direction it FACES, which for
 * anything mounted on a wall means it points into the room.
 *
 * Portals are declared ONCE, on the room nearer the entrance. They are
 * undirected: use portalsOf()/neighbors() rather than reading room.portals
 * directly, or half the graph disappears.
 */

/**
 * HOW WIDE A DOORWAY A GOD HAS TO FIGHT THROUGH, and why it is not 4.
 *
 * The owner finished World 1 and reported the bosses as too easy: "the doorways
 * trap them and basically make it easy to kill them all." That was diagnosed
 * three ways before it was measured, and the first two diagnoses were wrong.
 *
 * It is not width in the sense of "does a god fit" - `test/chokepoint.mjs`
 * measured every combat portal admitting a god with 9.8cm to spare per side, and
 * no lintel anywhere on the map. It is not headroom - 4.2m of it against a 3.895m
 * body. It is that a doorway wide enough to PASS is not wide enough to ROUTE.
 *
 * `enemies/flow.js` carves its field with a disc and marks a cell walkable only
 * where the whole disc fits, so an opening of nominal width W leaves a legal band
 * of W - 2r for a body of radius r. Measured, and exact to the centimetre against
 * that model - there is no wall overhang, the nominal width IS the clear span:
 *
 *   shambler, r 0.55   ->  4.0 - 1.10 = 2.90m of band
 *   god,      r 1.805  ->  4.0 - 3.61 = 0.39m of band
 *
 * The field's STEP is 0.7, chosen with the explicit argument that 2.90m is "four
 * cells across the gap, which is enough that no doorway can be closed by sampling
 * luck". At 0.39m it is HALF A CELL, and `test/godfield.mjs` measured what that
 * costs: of the 12,138 cells a shambler can reach from the Great Gallery, a god
 * could reach 401. Three point three per cent. Six of ten combat doorways held no
 * cell a god could stand in at all.
 *
 * WHY THE ANSWER IS GEOMETRY AND NOT A TIGHTER COLLIDER. The same file swept the
 * god's collider from 0.95 down to 0.62 and found a cliff, not a curve: 0.70
 * reaches 8.9% of the map and 0.66 reaches 73.6%. A seven-centimetre change
 * flipping connectivity eightfold is grid phase, not clearance - the whole map's
 * connectivity was hanging on one or two cells inside two doorways. Any fix that
 * lands on that cliff is luck. 0.66 is also the floor: the god's widest visible
 * geometry is 0.659 local, so a collider under it puts the shoulder plates
 * through stone.
 *
 * So the band has to be several cells wide by construction rather than by
 * accident, and the only lever that does that is the opening itself.
 *
 * NOT A UNIVERSAL WIDTH. The Serdab's 2.4m puzzle door is deliberately left
 * god-proof - it is the only room with no spawn points, which is what lets the
 * ending happen in it, and a god following the player in there would be a
 * regression rather than a fix.
 */
const COMBAT_DOOR = 5.5;

/** Where the courtyard's sealed doorway lands. The 1000g gate into the map. */
export const ENTRY = {
  to: 'chamber-of-ascent',
  at: { x: 0, z: -140 },
  width: 4.5,
  kind: 'gate',
  cost: 1000,

  /** Facing -Z on arrival, looking down the axis of the whole interior. */
  spawn: { x: 0, z: -143.5, rot: 0 },
};

export const ROOMS = [
  // ---------------------------------------------------------------------
  // row A: the entry band. Three rooms sharing one z span, so the two
  // debris portals out of the antechamber are a genuine left/right choice
  // rather than a corridor with a fork drawn on it.
  // ---------------------------------------------------------------------
  {
    id: 'chamber-of-ascent',
    name: 'Chamber of Ascent',

    /**
     * THIRTY-SIX WIDE, UP FROM TWENTY-FOUR, AND IT GREW ON X BECAUSE IT CANNOT
     * GROW ON Z.
     *
     * The owner said twice that the first interior room is too small: "its harad
     * to run from enemies in sucha small space espeacially in later waves. this
     * needs more balance." At 24 x 18 it was 352 m2 of net floor, the second
     * smallest room in the map, carrying three spawn points and nine props. It
     * is now 36 x 18, which is 544 net, up 55 per cent.
     *
     * NEITHER Z EDGE CAN MOVE. z = -140 is the threshold the sealed doorway
     * hands the player over at, and systems/doors.js pins that seam with
     * hand-placed absolute geometry argued from the courtyard grade - DAYLIGHT
     * at y 2.10 / z -141.06 and VOID at y 4.4. z = -158 is the shared wall line
     * with the Great Gallery. So the depth is fixed at 18 and the whole of the
     * gain is on X.
     *
     * IT IS STILL CENTRED ON X = 0, which is the axis the entrance, the gallery
     * and the whole interior are laid out on, so the two neighbours shift six
     * each rather than the room growing off one side. Occupied span across row A
     * goes from 88 to 100.
     *
     * THIRTY-SIX AND NOT MORE, and the limit is the room's aspect rather than
     * the envelope. Its south wall has to stay inside the gallery's north wall
     * line, which spans x -26..26, so 52 is the geometric ceiling. But at 36 the
     * net floor is 34 x 16, which is already 2.1 to 1; at 44 it is 2.6 to 1 and
     * the room stops being a chamber and becomes a corridor, which is WORSE to
     * kite in than a small square. The rest of the answer to "not enough room to
     * run" is the free doorway below, which hands the player the Hall and the
     * Gallery from the first frame - about 2,700 m2 at wave one against 352.
     */
    bounds: { x: 0, z: -149, w: 36, d: 18 },

    // THE DATUM. Every other elevation in the map is measured against this one,
    // because the sealed doorway hands the player over at a real opening whose
    // two hand-placed fade sheets and threshold z are pinned to the courtyard
    // grade (systems/doors.js DAYLIGHT and VOID). Room 1 cannot move.
    base: 0,
    height: 7,
    lightingProfile: 'chamber',

    portals: [
      /**
       * ONE EXIT IS FREE, AND IT IS THIS ONE.
       *
       * It used to be 750 of debris, the same as the granary, on the argument
       * that "the split is about which half of the map you open first, not which
       * is cheaper". That argument is about the SECOND door. The first one was
       * pricing the player's legs: until it was bought there was one room, and
       * a wave-survival game whose first room has no exit is a room you die in
       * rather than a room you fight in.
       *
       * THE HALL RATHER THAN THE GRANARY, for three reasons that are all about
       * space. The Hall is 576 m2 net against the Granary's 384. It carries two
       * parallel rows of five colonnades, which is the best kiting geometry in
       * the interior: a train pulled round a colonnade strings out instead of
       * bunching. And BOTH neighbours already open onto the Great Gallery at
       * cost 0, so freeing this one hands the player the gallery's 1,800 m2 as
       * well. Space at wave one goes from 352 m2 to about 2,700.
       *
       * 'open' AND NOT 'debris' AT COST ZERO, and the difference is the whole
       * point of the change. A barrier record is built for every portal whose
       * kind is not 'open', and systems/doors.js then prompts "OPEN CHAMBER OF
       * ASCENT [F]" on a zero-cost one. That is a free DOOR: the player still
       * has to reach it, stop, look at it and press a key. With a horde behind
       * them that is not the same thing as an opening at all. Both neighbours
       * already use 'open' at cost 0 for their gallery portals, so this is the
       * shipped idiom rather than a new case.
       *
       * THE GRANARY KEEPS ITS 750, and that is the half of this that is easy to
       * get wrong. With the hall free, the granary's price stops being a toll on
       * leaving the first room and becomes the purchase that CLOSES THE LOOP:
       * chamber to hall to gallery to granary to chamber. The Act 2 train costs
       * 750 to close instead of 1500, and it is still something the player buys
       * rather than something they are given.
       */
      { to: 'hall-of-offerings', at: { x: -18, z: -149 }, width: COMBAT_DOOR, kind: 'open', cost: 0 },
      { to: 'granary-vault', at: { x: 18, z: -149 }, width: COMBAT_DOOR, kind: 'debris', cost: 750 },
    ],

    // Spread to the new width. All three stay in the southern half, away from
    // the entry threshold, which is what stops the horde appearing in the
    // player's face on the frame they walk in.
    spawnPoints: [
      { x: -15, z: -154 },
      { x: 15, z: -154 },
      { x: 0, z: -156 },
    ],

    /**
     * REDISTRIBUTED, NOT JUST INHERITED. Every slot here is an absolute world
     * coordinate, so widening the room on its own would have left all nine props
     * clustered down the middle with six metres of bare floor at each new edge.
     */
    propSlots: [
      // THE PILLAR RING, pushed out from x +/-7 to +/-11 and pulled in from
      // z +/-4 to +/-3 of the room's centre line.
      //
      // Both moves are about the lane a player runs when they kite. At the old
      // spacing the gap between a pillar and the side wall was 4.0 gross, which
      // after the pillar's 1.15 collider and the player's own 0.55 is 2.3 m of
      // actual walkable lane - narrow enough that a body coming the other way
      // corks it. It is now 4.3. The north and south lanes were 2.3 for the same
      // arithmetic and are now 3.3, so the whole perimeter circuit is walkable
      // at its narrowest point rather than only on three sides.
      //
      // The ring is 22 x 6, which also leaves the middle of the room open: a
      // player can cut across between the pillar pairs instead of only running
      // round them, and a circuit with a shortcut in it is a choice.
      { type: 'pillar', x: -11, z: -146, rot: 0 },
      { type: 'pillar', x: 11, z: -146, rot: 0 },
      { type: 'pillar', x: -11, z: -152, rot: 0 },
      { type: 'pillar', x: 11, z: -152, rot: 0 },
      // THE FIRES CARRY THE ROOM'S TWO LIGHTS AND HAVE TO BE WHERE THE LIGHT IS
      // WANTED. buildLights gives a 'chamber' profile at most two point lights
      // and hangs them on the braziers, spread across the anchors in authored
      // order. At the old (+/-4, -142.5) both lights sat against the north wall
      // within eight metres of each other, which lit a 24-wide room and would
      // have left the east and west thirds of a 36-wide one dark. At +/-6 on the
      // centre line they sit near the centroid of each half.
      //
      // OFF THE EAST-WEST AXIS, AND THAT COST A PLAYED RUN TO FIND.
      //
      // The first cut of this put them at (-6, -149) and (6, -149), on the
      // centre line, on the argument that the middle of the room is wide open
      // and a player has seven metres of floor to walk round them in. A player
      // does. A STRAIGHT LINE DOES NOT, and z = -149 is not just any line: it is
      // the axis both side doorways sit on, so it is the line the player walks
      // when they run from one to the other. Measured, on an empty map, holding
      // W west from the room's centre: 4.8 m of ground in 200 frames, 94 per
      // cent of them corked, stopped dead at x -4.78 - which is exactly the
      // brazier's 0.8 collider plus the player's own 0.55.
      //
      // This is the Embalming Chamber's brazier lesson arriving in the room the
      // rule was written for, and it is in DESCENT.md in capitals: NOTHING MAY
      // STAND ON THE AXIS THE PLAYER IS PUT DOWN ON.
      //
      // On the pillar rows instead, and diagonally, which also lights better: at
      // (-6, -146) and (6, -152) the two point lights buildLights hangs on them
      // sit in opposite quadrants and cover all four corners inside the
      // profile's 24 m range. Both are clear of the axis band z -147..-151, of
      // the north lane at z -143.5, of the south lane at z -155, and of the
      // pillars by three metres.
      { type: 'brazier', x: -6, z: -146, rot: 0 },
      { type: 'brazier', x: 6, z: -152, rot: 0 },
      // MOVED TO THE WEST WALL AND IT NOW FACES THE RIGHT WAY. It stood at
      // x 10.5 with rot -PI/2, which is +X, half a metre from the east wall and
      // pointing INTO it - the mirror of what every other stela in the map does
      // (see the King's Chamber pair, west wall facing +X, east wall facing -X).
      // On the west wall the same rot reads into the room, and it gives the
      // south-west quarter something to be, which the widening otherwise
      // emptied.
      { type: 'stela', x: -16.5, z: -156, rot: -Math.PI / 2 },
      // Well clear of both doorways. Rubble parked in a portal is the one prop
      // that would still be blocking it after the player has paid to clear it,
      // since the doorway barrier is its own object.
      { type: 'rubble', x: -15.5, z: -143, rot: 0.6 },
      { type: 'rubble', x: 12, z: -156, rot: 2.1 },
    ],

    interactSlots: [
      // THE FIRST WALL BUY, and its placement is the tutorial.
      //
      // It is on the far wall of the first room inside the pyramid, dead ahead
      // of the spawn the sealed doorway drops the player on, so the first thing
      // they see after paying a thousand gold is the next thing to spend gold
      // on. A wall buy the player has to go looking for teaches nothing; this
      // one teaches the whole economy in one glance, and the SMG is the right
      // weapon to teach it with because the starting pistol runs dry against a
      // wave of six and this does not.
      {
        type: 'wallbuy',
        x: -4, z: -156.6, rot: Math.PI,
        config: { weapon: 'smg', cost: 1000 },
      },

      // Anubis is the cheapest shrine in the map and it is in the first room
      // for the same reason: the player meets a dead fixture, is told it is
      // dark rather than that they are poor, and now knows there is a switch
      // somewhere. That is the power gate explaining itself an hour before the
      // player can reach it.
      // Moved out with the east wall, keeping its 0.9 m stand-off from the
      // wall's inner face. A wall-mounted fixture left at its old x would be
      // a shrine floating six metres inside the room.
      {
        type: 'shrine',
        x: 16.1, z: -143, rot: Math.PI / 2,
        config: { boon: 'anubis' },
      },
    ],
  },

  {
    id: 'hall-of-offerings',
    name: 'Hall of Offerings',

    /**
     * SHIFTED SIX WEST, SAME SIZE. Its east wall is the Chamber of Ascent's west
     * wall, and that wall moved from x -12 to x -18 when the entry room grew, so
     * this room moves with it rather than being eaten by it. 38 x 18 and 576 m2
     * net, unchanged; every spawn, prop and fixture below moved by exactly -6
     * with the shell so the room is the same room in a new place.
     */
    bounds: { x: -37, z: -149, w: 38, d: 18 },
    base: 0,
    height: 9,
    lightingProfile: 'corridor',

    portals: [
      /**
       * MOVED THREE WEST, NOT SIX, AND THAT IS THE ONE NUMBER IN THIS SHIFT THAT
       * IS NOT A TRANSLATION.
       *
       * This opening is cut from BOTH sides: it sits on z = -158, which is this
       * room's south wall and the Great Gallery's north wall, and the gallery
       * is not moving. Its north wall spans x -26..26. Carried the full six to
       * x -25 the 4.5-wide opening would run from -27.25, past the gallery's own
       * west corner, and buildShell would leave that corner of the gallery open
       * to the rock. Left at -19 it would run to -16.75, past THIS room's new
       * east wall at -18, and open this room's corner instead.
       *
       * -22 is the only place both piers survive: 1.75 m of gallery wall west of
       * the opening and 1.75 m of hall wall east of it. That is the same order of
       * margin the Act 3 loop doorways carry at x -17.
       */
      { to: 'great-gallery', at: { x: -22, z: -158 }, width: COMBAT_DOOR, kind: 'open', cost: 0 },
    ],

    spawnPoints: [
      { x: -52, z: -144 },
      { x: -52, z: -154 },
      { x: -40, z: -155 },
      { x: -28, z: -144 },
    ],

    propSlots: [
      // Two rows of columns down the long axis. The hall is the one room whose
      // read is entirely rhythm, so the spacing is even and the count is odd.
      { type: 'colonnade', x: -51, z: -145.5, rot: 0 },
      { type: 'colonnade', x: -44.5, z: -145.5, rot: 0 },
      { type: 'colonnade', x: -38, z: -145.5, rot: 0 },
      { type: 'colonnade', x: -31.5, z: -145.5, rot: 0 },
      { type: 'colonnade', x: -25, z: -145.5, rot: 0 },
      { type: 'colonnade', x: -51, z: -152.5, rot: 0 },
      { type: 'colonnade', x: -44.5, z: -152.5, rot: 0 },
      { type: 'colonnade', x: -38, z: -152.5, rot: 0 },
      { type: 'colonnade', x: -31.5, z: -152.5, rot: 0 },
      { type: 'colonnade', x: -25, z: -152.5, rot: 0 },

      { type: 'offering-table', x: -48, z: -149, rot: 0 },
      { type: 'offering-table', x: -34, z: -149, rot: 0 },
      { type: 'urn', x: -50.5, z: -156, rot: 0.4 },
      { type: 'urn', x: -49, z: -155.2, rot: 1.9 },
      { type: 'urn', x: -27, z: -142.8, rot: 2.7 },
      { type: 'brazier', x: -53, z: -149, rot: 0 },
      { type: 'brazier', x: -41, z: -142.6, rot: 0 },
      // NOT TRANSLATED WITH THE ROOM, BECAUSE THE DOORWAY IT SITS BESIDE WAS NOT
      // TRANSLATED EITHER. It was at (-15.5, -155) with the gallery portal at
      // x -19, which put it clear to the east of a 4.5-wide opening. The room
      // moved six west and the portal only three, so carrying it the full six to
      // -21.5 parked a two-metre rubble pile dead centre in front of the
      // doorway. Measured: a player holding W south down x = -22 from z -152
      // never reached the gallery at all - it slid along the pile and came to
      // rest at (-31.23, -156.58), nine metres off the line it started on, with
      // no corked frame anywhere to say why.
      //
      // NOR IN THE SOUTH CORRIDOR, WHICH WAS THE SECOND PLACE IT WENT.
      //
      // At (-35, -155.5) it was clear of both doorways and it plugged something
      // else. The strip between the southern colonnade row at z -152.5 and the
      // south wall is 2.6 m of clear floor, reached through the 2.7 m gaps
      // between columns, and a rubble pile carved at the flood's 0.55 pad fills
      // it wall to column. Measured: the Hall's own spawn point at (-40, -155)
      // went from a finite route to `route: -1` - a place the director will put
      // an enemy that then cannot reach the player, which is the exact failure
      // test/nav.mjs exists to catch, and it caught it.
      //
      // The north-east corner has no colonnade, no doorway and no corridor to
      // plug. Its own clearances: 2.1 m from the free west doorway's opening,
      // 4.3 m from the nearest column, 0.6 m off the east wall face.
      { type: 'rubble', x: -21.5, z: -143, rot: 1.1 },
    ],

    interactSlots: [
      // MYSTERY BOX SPAWN A. Dead centre of the hall, between the two offering
      // tables, so the chest is on the axis the colonnade already draws the eye
      // down and is visible the moment the player clears the debris doorway.
      //
      // IT FACES ALONG THE AISLE, and the rotation is load-bearing rather than
      // decorative. At rot 0 the chest faced -Z, straight into the colonnade at
      // (-32, -152.5): approached from its own front the fixture stood BEHIND a
      // two-metre column, and the findability measurement said so - the chest
      // changed its own patch of frame by a factor of 1.10 where the other two
      // spawns manage 2.0. Turned a quarter, the approach runs down the empty
      // central aisle with the two colonnade rows flanking it, which is the shot
      // the note above always claimed this placement had.
      //
      // The three spawns are A here, B in the Great Gallery and C in the Star
      // Shaft, and their spread is the mechanic rather than a decoration: the
      // chest relocates after four to eight pulls, and one of its three homes is
      // in the cheap half of the map, one is on the route everything passes
      // through, and one is behind the dearest gate in the pyramid. A player who
      // opened only the west half can be sent somewhere they have not paid to
      // reach, which is what stops the box being a vending machine to camp.
      {
        type: 'box',
        x: -37, z: -149, rot: Math.PI / 2,
        config: { spawn: 'A', cost: 950 },
      },
      {
        type: 'wallbuy',
        x: -46, z: -156.6, rot: Math.PI,
        config: { weapon: 'shotgun', cost: 1200 },
      },
      {
        type: 'shrine',
        x: -30, z: -141.9, rot: 0,
        config: { boon: 'shu' },
      },
    ],
  },

  {
    id: 'granary-vault',
    name: 'Granary Vault',

    /**
     * SHIFTED SIX EAST, SAME SIZE, and the mirror of the Hall's move. Its west
     * wall is the Chamber of Ascent's east wall and that wall went from x 12 to
     * x 18. 26 x 18 and 384 m2 net, unchanged.
     */
    bounds: { x: 31, z: -149, w: 26, d: 18 },
    base: 0,
    height: 7,
    lightingProfile: 'chamber',

    portals: [
      // Three east, not six, for the reason spelled out on the Hall's twin of
      // this portal: the opening is cut from the gallery's north wall as well as
      // from this room's south wall, and the gallery has not moved. 22 leaves
      // 1.75 m of pier on each side.
      { to: 'great-gallery', at: { x: 22, z: -158 }, width: COMBAT_DOOR, kind: 'open', cost: 0 },
    ],

    spawnPoints: [
      { x: 41, z: -144 },
      { x: 42, z: -151 },
      { x: 21, z: -144 },
    ],

    propSlots: [
      // Imsety, the first jar, USED TO STAND HERE and now stands in the first
      // west chapel of the courtyard - see the note in courtyard.js. The whole
      // four-jar chain began behind a thousand-gold door; it now starts in the
      // first minute of the run, and the player crosses the threshold already
      // holding a piece of the thing they are there to finish.
      { type: 'urn', x: 21.5, z: -145, rot: 0.2 },
      { type: 'urn', x: 23.2, z: -144.2, rot: 1.4 },
      { type: 'urn', x: 22.4, z: -153.6, rot: 2.6 },
      { type: 'urn', x: 40, z: -155.5, rot: 0.9 },
      { type: 'urn', x: 41.6, z: -154.2, rot: 2.2 },
      { type: 'pillar', x: 27, z: -145.5, rot: 0 },
      { type: 'pillar', x: 35, z: -145.5, rot: 0 },
      { type: 'brazier', x: 31, z: -143, rot: 0 },
      { type: 'rubble', x: 36.5, z: -153, rot: 1.7 },
    ],

    interactSlots: [
      {
        type: 'shrine',
        x: 42.4, z: -149, rot: Math.PI / 2,
        config: { boon: 'set' },
      },
    ],
  },

  // ---------------------------------------------------------------------
  // row B: the centrepiece. Every route past the entry band passes through
  // here, which is what makes it worth spending the two-level budget on.
  // ---------------------------------------------------------------------
  {
    id: 'great-gallery',
    name: 'Great Gallery',
    bounds: { x: 0, z: -177, w: 52, d: 38 },
    // Act 2 is one plane, all four rooms of it, and that is forced rather than
    // chosen: the entry band and the gallery form a cycle, and a cycle cannot
    // change elevation once without changing it twice. See docs/DESCENT.md.
    base: 0,
    height: 16,
    lightingProfile: 'gallery',

    /**
     * The upper level. Ledges are flat (y0 === y1) and ramps rise; the builder
     * emits both into one list so the controller samples a single array.
     * Along the ramp's longer horizontal axis, y0 is the height at the
     * low-coordinate end and y1 the height at the high-coordinate end.
     */
    levels: [0, 6],
    ramps: [
      /**
       * NINETEEN DEEP RATHER THAN TWENTY-THREE, to make room for the ramps
       * below to back away from the north doorways. See the note on those.
       * The ledge still runs from the bridge at the south end to the head of
       * its ramp, which is the whole of what it has to do.
       */
      { x: -21, z: -185.5, w: 8, d: 19, y0: 6, y1: 6 },
      { x: 21, z: -185.5, w: 8, d: 19, y0: 6, y1: 6 },

      /**
       * THE BRIDGE, and the highest-value single geometry change in the map.
       *
       * The two shelves above spanned the same z and stood on opposite walls and
       * never met, so the upper level was not a level at all: it was two
       * cul-de-sacs six metres in the air, each with one way down, which is the
       * worst topology a room can have and the hardest to see from inside it.
       * Going up meant the only exit was back past whatever had followed you.
       * That is why the biggest and most expensive room in the map read as a
       * vague complaint about movement for weeks - a trap is invisible from the
       * floor of the trap.
       *
       * One span across the south end joins them, and the whole upper level
       * becomes a ring: up one ramp, across the back, down the other. The
       * gallery gets a second loop stacked on the first one, in the room every
       * route in the map already passes through.
       *
       * IT IS SEVEN DEEP RATHER THAN THREE, and that is the Altar's fault rather
       * than a change of mind. The Altar of Ptah moves onto this span (see
       * interactSlots) and its collider is 2.1 across. On a three-metre catwalk
       * the machine would have plugged the very hole it was placed to justify -
       * fixing the trap and shipping a cork in the same change. At seven the
       * altar sits against the south parapet with 2.9 metres of clear walkway
       * north of it, so the ring survives the fixture standing in it, and the
       * span reads as the landing at the head of the gallery rather than a plank.
       *
       * It butts the two shelves EXACTLY at x = -17 and x = 17 rather than
       * overlapping them. `heightAt` takes the highest surface under a point with
       * inclusive bounds, so an exact join has no seam to fall through, while an
       * overlap would put two coplanar slab faces in the same plane and hand the
       * depth buffer a fight it renders as a flickering rectangle.
       */
      { x: 0, z: -191.5, w: 34, d: 7, y0: 6, y1: 6 },

      /**
       * THE RAMP FEET BACKED FOUR METRES SOUTH, OFF THE NORTH DOORWAYS.
       *
       * The owner played World 1 and said the gallery's ramp mouths sit hard
       * against its doorways: "the ramp entrances need to back up away from the
       * doorway because the doorway is blocked by the entrance to the ramps."
       * He was right, and the reason is a rule that only bites at god scale.
       *
       * `enemies/flow.js` clear() refuses a cell whose overhead surface sits
       * between CLIMB (0.65) and the body's own height - the headroom clause
       * that stops the horde routing through the crawlspace under a slab. Under
       * a ramp descending at 0.5 that makes the unusable band a function of how
       * TALL the body is, and the two bodies on this map are very different:
       *
       *   shambler, 2.0 tall   blocked z -161.3 to -164.0
       *   god,      3.895 tall blocked z -161.3 to -167.8
       *
       * A taller body is shut out of a LONGER stretch of the same ramp. With the
       * feet at z -160 that left 3.3 m of clear floor between the gallery's north
       * wall and the start of the blocked band, against a god 3.61 m across, and
       * the doorways at x +/-22 sit inside the ramps' own x footprint of -25..-17
       * so there is no way round. Measured in `test/godfield.mjs`: a god entering
       * the gallery could reach EIGHT of its 1911 standable cells.
       *
       * The doorway cannot move instead. The gallery is x -26..26 and the two
       * rooms north of it are x -56..-18 and 18..44, so the rooms only touch
       * across eight metres, essentially all of it under a ramp.
       *
       * Backing the feet to z -164 opens that strip to 7.3 m, which is a god plus
       * 3.7 m of margin. The gradient is untouched at 6 over 12: this moves the
       * ramps, it does not make them steeper.
       */
      { x: -21, z: -170, w: 8, d: 12, y0: 6, y1: 0 },
      { x: 21, z: -170, w: 8, d: 12, y0: 6, y1: 0 },
    ],

    portals: [
      { to: 'embalming-chamber', at: { x: -20, z: -196 }, width: COMBAT_DOOR, kind: 'gate', cost: 1000 },
      { to: 'canopic-crypt', at: { x: 0, z: -196 }, width: COMBAT_DOOR, kind: 'gate', cost: 1000 },
      { to: 'star-shaft', at: { x: 20, z: -196 }, width: COMBAT_DOOR, kind: 'gate', cost: 1250 },
    ],

    spawnPoints: [
      { x: -24, z: -193 },
      { x: 24, z: -193 },
      { x: -24, z: -162 },
      { x: 24, z: -162 },
      { x: 0, z: -194 },
    ],

    propSlots: [
      // The columns that carry the upper ledge. Their height stops the abacus
      // exactly under the slab, and they sit fully inside the ledge footprint
      // so nothing pokes up through the floor the player walks on.
      { type: 'colonnade', x: -20, z: -192, rot: 0, config: { height: 5.65 } },
      { type: 'colonnade', x: -20, z: -184, rot: 0, config: { height: 5.65 } },
      { type: 'colonnade', x: -20, z: -176, rot: 0, config: { height: 5.65 } },
      { type: 'colonnade', x: 20, z: -192, rot: 0, config: { height: 5.65 } },
      { type: 'colonnade', x: 20, z: -184, rot: 0, config: { height: 5.65 } },
      { type: 'colonnade', x: 20, z: -176, rot: 0, config: { height: 5.65 } },

      // And two more carrying the bridge. Thirty-four metres of stone spanning
      // the head of the room with nothing underneath it is not a bridge, it is a
      // slab that forgot to fall, and this is a building made of post and lintel
      // - the one span it cannot do is the long one. Same 5.65 as the six above,
      // which is the height that stops the abacus exactly under the slab. They
      // also give the floor beneath the bridge something to circle, which the
      // south end of the gallery had none of.
      { type: 'colonnade', x: -8, z: -191.5, rot: 0, config: { height: 5.65 } },
      { type: 'colonnade', x: 8, z: -191.5, rot: 0, config: { height: 5.65 } },

      { type: 'statue', x: -12, z: -193, rot: Math.PI },
      { type: 'statue', x: 12, z: -193, rot: Math.PI },
      { type: 'stela', x: -5, z: -194.4, rot: Math.PI },
      { type: 'stela', x: 5, z: -194.4, rot: Math.PI },

      { type: 'brazier', x: -8, z: -170, rot: 0 },
      { type: 'brazier', x: 8, z: -170, rot: 0 },
      { type: 'brazier', x: -8, z: -186, rot: 0 },
      { type: 'brazier', x: 8, z: -186, rot: 0 },

      // On the ledges. Without these the upper level has no light of its own
      // and reads as a shelf rather than as somewhere to be.
      { type: 'brazier', x: -21, z: -190, rot: 0, y: 6 },
      { type: 'brazier', x: 21, z: -190, rot: 0, y: 6 },

      { type: 'rubble', x: -5, z: -161, rot: 0.3 },
      { type: 'rubble', x: 6.5, z: -162.5, rot: 2.4 },
      { type: 'rubble', x: 0, z: -190, rot: 1.2 },
      { type: 'urn', x: -14, z: -166, rot: 0.8 },
      { type: 'urn', x: 14, z: -166, rot: 2.0 },
    ],

    interactSlots: [
      // MYSTERY BOX SPAWN B. The floor of the gallery, under sixteen units of
      // air, which is the one place in the map where the beam has room to be a
      // beam. It is also overlooked from both upper ledges, so a chest sitting
      // here is legible from four different heights.
      { type: 'box', x: 0, z: -177, rot: 0, config: { spawn: 'B', cost: 950 } },

      // Both fixtures are on the gallery's NORTH wall and neither is on a side
      // wall, and that is forced rather than chosen: the east and west walls
      // are the upper level. From z = -160 back to -195 they are ramp and
      // ledge, so anything mounted at floor height there would be buried inside
      // a walkable surface. The north wall is the only continuous stretch of
      // this room that is actually wall, and it happens to be the wall the
      // player walks in through, which makes both of these visible on arrival.
      {
        type: 'wallbuy',
        x: -9, z: -159.4, rot: 0,
        config: { weapon: 'carbine', cost: 1500 },
      },
      {
        type: 'shrine',
        x: 9, z: -159.9, rot: 0,
        config: { boon: 'sekhmet' },
      },

      /**
       * THE ALTAR OF PTAH, moved out of the King's Chamber and onto the bridge.
       *
       * Five thousand gold was the largest number in the game and the hardest to
       * read, because "more damage" has no unit the player can price. It is a
       * TIER PROMOTION: one pass through the machine is one band up, so a packed
       * low weapon plays as a med and a packed med plays as a high. That is a
       * thing the armoury already teaches - three bands, one per act - and it
       * makes the five thousand legible in the only terms the player has.
       *
       * It stands here rather than in the boss arena because Act 2 is where the
       * choice has to bite: 5000 for a band against 3250 to open all three gates
       * into Act 3. Depth or strength, one per run, and both answers are correct.
       *
       * SIX METRES UP, on the span, against the south parapet, facing north into
       * the room. Visible from the gallery floor the whole time and reachable
       * only by breaking off the train and climbing a ramp, which is the price
       * the fixture pays in seconds rather than in gold. It also gives the span
       * a reason to exist beyond repairing the trap.
       *
       * The King's Chamber loses nothing it needs. It is the boss arena and it
       * holds the fourth jar; it was never a room that wanted a fixture in it.
       */
      {
        type: 'altar',
        x: 0, z: -193, y: 6, rot: Math.PI,
        config: { label: 'Altar of Ptah', cost: 5000, repeat: 2000 },
      },
    ],
  },

  // ---------------------------------------------------------------------
  // row C: the three gated rooms off the gallery, AND THE ONE DESCENT.
  //
  // Everything from here to the Serdab is six metres below everything before
  // it. The three doorways out of the gallery are the only cut in the room
  // graph at this seam, so this is where the drop can happen and the only place
  // it can happen without a second one somewhere else; docs/DESCENT.md carries
  // the cycle argument and the full elevation table.
  //
  // Each of the three rooms carries the same descent ramp: sixteen metres of
  // run for six of fall, entered through its own gate at the gallery's floor
  // level and landing on its own. The ramps are authored relative to `base`, so
  // "y1: 6" reads as "six above this room's floor", which is the same six the
  // gallery's ledge is above the gallery's.
  // ---------------------------------------------------------------------
  {
    id: 'embalming-chamber',
    name: 'Embalming Chamber',
    bounds: { x: -29, z: -214, w: 30, d: 36 },
    base: -6,

    /**
     * EIGHT BECAME TWELVE, AND THE FLOOR DROPPING SIX IS THE WHOLE REASON.
     *
     * `height` is measured from this room's own floor, so the absolute ceiling
     * is -6 + 12 = 6: two metres LOWER than it used to be, not four higher. The
     * room did not become grander, it became deeper, and from the doorway the
     * lintel presses down exactly as it always did.
     *
     * The number is forced rather than chosen. The doorway from the gallery
     * sits at the gallery's floor, six metres above this one, and a full-height
     * opening needs DOOR_H plus its 0.8 of lintel above that sill. So the
     * absolute ceiling can never come below 5.0 while that door is full height,
     * which puts a floor under `height` of drop + 5. Twelve leaves a metre of
     * slack; eleven would have been exact, and exact is where a rounding error
     * turns into a doorway with no stone over it.
     */
    height: 12,
    lightingProfile: 'chamber',

    /**
     * THE DESCENT, west door.
     *
     * Sixteen of run for six of fall is a gradient of 0.375, which is gentler
     * than the gallery's own ramps at 0.5 and well inside both limits that
     * matter: the player's STEP_UP of 0.65 per frame, and the flow field's
     * CLIMB of 0.65 per 0.7 m cell. A steeper ramp would still be walkable and
     * would still route the horde; it would just stop reading as architecture.
     *
     * IT REACHES THE WALL LINE AT z = -196 RATHER THAN STOPPING AT THE ROOM'S
     * INNER FACE. The doorway is a hole in a wall a metre thick, and the floor
     * of that hole has to be something the sampler can see: stopping at -197
     * would leave a metre of threshold where the only answer is this room's
     * floor, six metres down, and the player would walk out of the gallery into
     * a hole. Ending exactly on the shared wall line is the same butt-don't-
     * overlap rule the gallery's bridge is built to.
     */
    ramps: [
      { x: -20, z: -204, w: 8, d: 16, y0: 0, y1: 6 },
    ],

    portals: [
      /**
       * THE ONE PORTAL THAT FIXES ACT 3.
       *
       * The embalming chamber spans x -44..-14 at z=-232 and the king's chamber
       * spans x -20..20 on the same line, so the two rooms already share six
       * units of wall and neither of them knew it. A 4-unit opening centred on
       * x=-17 fits with a unit of margin each side and turns the deep half of
       * the map from two dead ends hanging off a hub into a ring:
       *
       *   gallery -> embalming -> kings -> crypt -> gallery
       *
       * Both of those dead ends were the worst kind. The king's chamber is the
       * boss arena and the largest room in the map, fought with one door and the
       * horde between the player and it; the embalming chamber holds the
       * Kindling, so every run in the game was obliged to walk into a one-door
       * room to turn the power on. Neither was a difficulty choice, because
       * there was no price that bought a way out.
       *
       * KIND 'open' AND COST 0 IS STRUCTURAL, NOT GENEROUS. The loop is the
       * survival mechanic; charging for it would make the law it satisfies
       * conditional on a purchase. `onHard` below is where difficulty gets to
       * have an opinion, and it changes the SHAPE of the fight rather than the
       * size of the numbers in it: on Hard the wave-five boss really is a fight
       * in a dead end until the way out has been earned.
       */
      {
        to: 'kings-chamber',
        at: { x: -17, z: -232 },
        width: COMBAT_DOOR,
        kind: 'open',
        cost: 0,
        onHard: { kind: 'debris', cost: 1250 },
      },
    ],

    spawnPoints: [
      { x: -41, z: -200 },
      { x: -41, z: -228 },
      { x: -17, z: -228 },
    ],

    // THE RAMP TOOK THE NORTH-EAST CORNER OF THIS ROOM, x -24..-16 by z
    // -212..-196, and three slots have moved west out of it. A prop left
    // standing under a descent is not decoration, it is a column growing
    // through a walkway: the collider starts on the room floor and runs up
    // through the ramp the player is on.
    propSlots: [
      { type: 'sarcophagus', x: -29, z: -207, rot: 0 },
      { type: 'offering-table', x: -29, z: -213, rot: 0 },
      // Was (-21, -203), which is now half way down the ramp. Moved five west
      // rather than south, so it still frames the north end of the room and now
      // stands beside the descent instead of in it. The pair at z -222 is
      // untouched, so the room reads slightly asymmetric, which it already was:
      // the sarcophagus, the Kindling and the four niches are all on the west.
      { type: 'pillar', x: -26, z: -203, rot: 0 },
      { type: 'pillar', x: -37, z: -203, rot: 0 },
      { type: 'pillar', x: -21, z: -222, rot: 0 },
      { type: 'pillar', x: -37, z: -222, rot: 0 },
      // Both were clutter at the foot of the old level doorway. They keep that
      // job at the foot of the ramp's west flank.
      { type: 'urn', x: -25.5, z: -200, rot: 0.5 },
      { type: 'urn', x: -26.9, z: -201.3, rot: 2.3 },
      // MOVED TO LIGHT THE FOOT OF THE DESCENT, from (-24, -229), and it is
      // doing a job rather than being redressed. This room's two lights hang on
      // its two braziers, and with both of them jammed against the south wall
      // the whole north half - which is now a ramp the player has to find and
      // walk down in the dark - had no light of its own at all. First in the
      // list because buildLights spreads its picks across the anchors in
      // authored order.
      //
      // BESIDE THE LANDING AND NOT ON IT. The first pass put this at (-20, -214),
      // dead on the ramp's axis two metres past its foot, and it corked the
      // descent: measured, a player holding W down the west ramp stopped at
      // z -212.78 and stayed there, because a 0.8 collider plus the player's own
      // 0.55 is 1.35 and the landing is exactly that wide at the axis. It is the
      // Altar-on-a-three-metre-catwalk mistake in a different room, and it is
      // why nothing may stand in front of a descent.
      { type: 'brazier', x: -25.5, z: -214, rot: 0 },
      { type: 'brazier', x: -34, z: -229, rot: 0 },
      { type: 'rubble', x: -16.5, z: -218, rot: 1.5 },
    ],

    interactSlots: [
      // THE KINDLING. Power for the whole map, and the only reason to spend
      // 1000 on this room before the crypt.
      {
        type: 'power',
        x: -29, z: -225, rot: Math.PI,
        config: { label: 'The Kindling', cost: 0, opens: ['canopic-crypt/kings-chamber'] },
      },

      // The four sockets. One per son of Horus, filled by the jars scattered
      // across the map; the order they are filled in does not matter.
      {
        type: 'niche', x: -42.6, z: -226, rot: -Math.PI / 2,
        config: { index: 1, son: 'imsety', accepts: 'canopic-jar' },
      },
      {
        type: 'niche', x: -42.6, z: -218, rot: -Math.PI / 2,
        config: { index: 2, son: 'hapy', accepts: 'canopic-jar' },
      },
      {
        type: 'niche', x: -42.6, z: -210, rot: -Math.PI / 2,
        config: { index: 3, son: 'duamutef', accepts: 'canopic-jar' },
      },
      {
        type: 'niche', x: -42.6, z: -202, rot: -Math.PI / 2,
        config: { index: 4, son: 'qebehsenuef', accepts: 'canopic-jar' },
      },
    ],
  },

  {
    id: 'canopic-crypt',
    name: 'Canopic Crypt',
    bounds: { x: 0, z: -214, w: 28, d: 36 },
    base: -6,

    /**
     * SIX BECAME TWELVE, AND THIS IS THE ROOM THAT PRICED THE WHOLE DESCENT.
     *
     * Its absolute ceiling does not move at all: -6 + 12 is the same 6 it has
     * always been. What changed is that its floor is now six metres under its
     * own doorway, so the twelve is the depth of the room and not its grandeur.
     *
     * It is also the room that decided the drop is six and not eight or ten.
     * The rule from the Embalming Chamber above - absolute ceiling at least
     * sill + DOOR_H + 0.8, so height at least drop + 5 - binds hardest here,
     * because this had the second lowest ceiling in the map and the least room
     * to give. A ten-metre drop would have needed fifteen, which is two and a
     * half times the room the Crypt was authored as. Six costs it double and
     * leaves its ceiling exactly where it was, and that was the cheapest honest
     * trade available. The full argument is in docs/DESCENT.md.
     *
     * The cost is real and worth naming: the Crypt was the tight, warm, low
     * room in Act 3 and it is now twice as tall. What it keeps is the ceiling
     * the player actually sees from the doorway.
     */
    height: 12,
    lightingProfile: 'chamber',

    /** THE DESCENT, centre door. Same 16-for-6 as the other two. */
    ramps: [
      { x: 0, z: -204, w: 8, d: 16, y0: 0, y1: 6 },
    ],

    portals: [
      // No price. The gate is the power switch two rooms away, which is the
      // whole point of the embalming chamber existing.
      { to: 'kings-chamber', at: { x: 0, z: -232 }, width: COMBAT_DOOR, kind: 'power', cost: 0 },
    ],

    spawnPoints: [
      { x: -11, z: -200 },
      { x: 11, z: -200 },
      { x: -11, z: -229 },
      { x: 11, z: -229 },
    ],

    // The ramp takes x -4..4 by z -212..-196, which is the middle of the
    // room's north half and was where three slots stood.
    propSlots: [
      // JAR 3 MOVED OFF THE RAMP, from (0, -205), which is now three metres up
      // it. Six west, on the crypt floor, so it is the thing the player is
      // looking DOWN at while they walk the descent rather than the thing they
      // walk into at the bottom of it - it sat on the axis for one build and
      // was one of three colliders that turned the landing into a slalom.
      { type: 'canopic-jar', x: -6, z: -205, rot: 0, config: { index: 3, son: 'duamutef' } },
      { type: 'sarcophagus', x: -8, z: -212, rot: 0 },
      { type: 'sarcophagus', x: 8, z: -212, rot: 0 },
      { type: 'sarcophagus', x: -8, z: -221, rot: 0 },
      { type: 'sarcophagus', x: 8, z: -221, rot: 0 },
      // Pushed two and a half south off (0, -216.5). Still the room's one
      // column and still on the axis, but seven metres clear of where the ramp
      // puts the player down rather than four, which is the difference between
      // a column you walk around and a column you arrive against.
      { type: 'pillar', x: 0, z: -219, rot: 0 },
      { type: 'urn', x: 11, z: -206, rot: 1.1 },
      { type: 'urn', x: -11.4, z: -207.2, rot: 2.8 },
      // TWO FIRES NOW, NOT ONE, AND THAT FIXES A BUG THIS ROOM ALREADY HAD.
      // buildLights hangs this room's two lights on its braziers and spreads
      // the picks across whatever anchors exist; with one brazier it stacked
      // both on the same bowl and left the far half black - the exact failure
      // its own comment names, and the far half is now a ramp. One at the foot
      // of the descent, one beside its head, and NEITHER OF THEM ON THE AXIS
      // the ramp puts the player down on - see the note on the Embalming
      // Chamber's brazier for the measurement that rule came out of.
      { type: 'brazier', x: 6, z: -216, rot: 0 },
      { type: 'brazier', x: -5.5, z: -198, rot: 0 },
      // Against the east wall, out of the corner the spawn points use.
      { type: 'rubble', x: 11.5, z: -216, rot: 0.7 },
    ],

    interactSlots: [
      {
        type: 'shrine',
        x: -12, z: -224, rot: -Math.PI / 2,
        config: { boon: 'ptah' },
      },
    ],
  },

  {
    id: 'star-shaft',
    name: 'Star Shaft',
    bounds: { x: 27, z: -214, w: 26, d: 36 },
    base: -6,

    /**
     * THIRTY, UNCHANGED, and this is the room that gets the most out of the
     * descent for nothing.
     *
     * Its ceiling drops with its floor, to an absolute 24, and it needed no
     * adjustment at all because thirty was already far past the sill + DOOR_H +
     * 0.8 that binds the other two. It is still the tallest room in the map by
     * a factor of two and a half.
     *
     * What it gains is the thing WORLD-1.md says it was missing. "The world
     * already spends its one vertical gasp on a shaft that points UP and
     * delivers nothing." The player now walks DOWN six metres to stand at the
     * bottom of it, so the thirty units of nothing overhead are measured from a
     * floor they had to descend to reach. The failed ascent reads as further
     * away than it did, and no geometry in this room moved to do it.
     */
    height: 30,
    lightingProfile: 'shaft',

    /** THE DESCENT, east door. Same 16-for-6 as the other two. */
    ramps: [
      { x: 20, z: -204, w: 8, d: 16, y0: 0, y1: 6 },
    ],

    portals: [
      { to: 'serdab', at: { x: 40, z: -213 }, width: 2.4, kind: 'puzzle', cost: 0 },

      /**
       * THE PORTAL MAP.md DID NOT KNOW IT NEEDED, and the reason the
       * trainability tool was rewritten.
       *
       * MAP.md scores this room 'through-route' on two portals and moves on.
       * That reading is degree, and degree is not the property the mechanic
       * needs: the second portal goes to the Serdab, which has no third door,
       * so everything that follows you in here has to come back out the way it
       * came. Degree two into a dead end IS a dead end. The Act 3 section fixed
       * the two dead ends it could see by eye and left the one it could not.
       *
       * It is the MIRROR of the embalming portal, because the map is symmetric
       * and nobody had noticed the east side had the same six units of shared
       * wall as the west:
       *
       *   embalming  x -44..-14  ┐                     ┌  star-shaft x 14..40
       *                          ├  both meet z = -232 ┤
       *   kings      x -20..20   ┘                     └  kings      x -20..20
       *          overlap -20..-14                            overlap 14..20
       *
       * Four units centred on x = 17 leaves a unit of margin each side, the
       * same fit as x = -17, and closes the last loop in the map:
       *
       *   gallery -> star-shaft -> kings -> crypt -> gallery
       *
       * The Serdab stays a dead end on purpose and stays legal, because it
       * spawns nothing - see the note on its empty spawnPoints. A reward closet
       * you cannot be cornered in is a closet, not a trap.
       *
       * 'open' AND COST 0 FOR THE SAME REASON THE WEST ONE IS. The loop is the
       * survival mechanic and charging for it would make the law conditional on
       * a purchase. `onHard` is where the tier gets its opinion.
       *
       * ON HARD, BOTH SIDES WALL, and that is MAP.md's ratified intent rather
       * than a doubling of it: the boss arena falls back to its one crypt door
       * and the wave-five fight really is a fight in a dead end until the way
       * out has been earned. What the second portal adds is a CHOICE of which
       * 1250 to pay - west into the Kindling and the embalming chamber, or east
       * into the LMG, the Thoth shrine and box spawn C. Same price, same
       * relief, two different runs, and Hard is the only tier that ever has to
       * pick. Easy and Normal get both openings free and never see the barrier.
       */
      {
        to: 'kings-chamber',
        at: { x: 17, z: -232 },
        width: COMBAT_DOOR,
        kind: 'open',
        cost: 0,
        onHard: { kind: 'debris', cost: 1250 },
      },
    ],

    spawnPoints: [
      // (17, -200) stood in the ramp's footprint. A spawn on a descent is not
      // wrong so much as unreadable - the actor appears part way down a slope
      // the player is looking up - and `groundAt` places a body on the HIGHEST
      // surface at its x/z, so it would have arrived on the ramp and not on the
      // floor the other three use. Moved south, off the ramp, same corner.
      { x: 17, z: -219 },
      { x: 37, z: -200 },
      { x: 17, z: -228 },
      { x: 37, z: -228 },
    ],

    // The ramp takes x 16..24 by z -212..-196.
    propSlots: [
      // JAR 2 MOVED OFF THE RAMP, from (20, -204). It sits under the void now,
      // just east of the landing, which is where the room's own story wants it:
      // the second jar is the one at the bottom of the failed ascent.
      { type: 'canopic-jar', x: 25.5, z: -219, rot: 0, config: { index: 2, son: 'hapy' } },
      // Truncated on purpose. Columns running the full 30 units would turn the
      // shaft into four rails; broken off at 12 they leave the void above them
      // as the thing the room is actually about.
      //
      // The first of them was at (19, -206), under the ramp. It stands at the
      // head of the descent instead, so a twelve-metre broken column is the
      // thing the player walks past on the way down rather than the thing the
      // ramp grew through.
      { type: 'pillar', x: 26, z: -200, rot: 0, config: { height: 12 } },
      { type: 'pillar', x: 35, z: -206, rot: 0, config: { height: 12 } },
      { type: 'pillar', x: 19, z: -222, rot: 0, config: { height: 16 } },
      { type: 'pillar', x: 35, z: -222, rot: 0, config: { height: 16 } },
      { type: 'stela', x: 27, z: -230.6, rot: Math.PI },
      { type: 'brazier', x: 22, z: -216, rot: 0 },
      { type: 'brazier', x: 32, z: -216, rot: 0 },
      { type: 'rubble', x: 30, z: -202, rot: 2.5 },
      { type: 'rubble', x: 24.5, z: -227, rot: 0.4 },
      { type: 'urn', x: 36.5, z: -211, rot: 1.6 },
    ],

    interactSlots: [
      // MYSTERY BOX SPAWN C. The deepest of the three, behind the 1250 gate, and
      // the only one the player can be sent to before they have opened the room.
      // That is the point: the chest going cold is a place the run has to move
      // to, and one of the three places is one you may still have to buy.
      { type: 'box', x: 27, z: -214, rot: 0, config: { spawn: 'C', cost: 950 } },

      // The deepest wall buy in the map, and the dearest, behind the 1250 gate.
      // The LMG is the wave-twenty weapon: seventy-five rounds is the only
      // magazine in the armoury that outlasts a full spawn wave, so it is
      // correctly the last gun a player earns rather than the first.
      {
        type: 'wallbuy',
        x: 15.4, z: -214, rot: -Math.PI / 2,
        config: { weapon: 'lmg', cost: 1600 },
      },
      {
        type: 'shrine',
        x: 38.1, z: -226, rot: Math.PI / 2,
        config: { boon: 'thoth' },
      },
    ],
  },

  // ---------------------------------------------------------------------
  // row D: the boss arena, and the secret hanging off the shaft
  // ---------------------------------------------------------------------
  {
    id: 'kings-chamber',
    name: "King's Chamber",
    bounds: { x: 0, z: -252, w: 40, d: 40 },
    // Level with all three rooms that open onto it, and that is not a choice.
    // gallery -> embalming -> kings -> crypt -> gallery is a cycle, and a cycle
    // whose elevation changes once does not close. Every room in Act 3 is on
    // this plane for that reason; see docs/DESCENT.md.
    base: -6,
    // Unchanged. Its absolute ceiling comes down with its floor, to 6, and the
    // boss arena keeps exactly the proportions it was tuned with.
    height: 12,
    lightingProfile: 'sanctum',

    portals: [],

    // Ringed rather than clustered: a boss arena that spawns everything from
    // one side is a corner to back into.
    spawnPoints: [
      { x: -17, z: -236 },
      { x: 17, z: -236 },
      { x: -17, z: -268 },
      { x: 17, z: -268 },
      { x: 0, z: -269 },
    ],

    propSlots: [
      { type: 'canopic-jar', x: 14, z: -266, rot: 0, config: { index: 4, son: 'qebehsenuef' } },
      { type: 'sarcophagus', x: 0, z: -266, rot: 0 },
      { type: 'statue', x: -13, z: -240, rot: Math.PI },
      { type: 'statue', x: 13, z: -240, rot: Math.PI },
      { type: 'statue', x: -13, z: -264, rot: 0 },
      { type: 'statue', x: 13, z: -264, rot: 0 },
      { type: 'pillar', x: -16, z: -252, rot: 0 },
      { type: 'pillar', x: 16, z: -252, rot: 0 },
      { type: 'brazier', x: -6, z: -246, rot: 0 },
      { type: 'brazier', x: 6, z: -246, rot: 0 },
      { type: 'stela', x: -18.4, z: -258, rot: -Math.PI / 2 },
      { type: 'stela', x: 18.4, z: -258, rot: Math.PI / 2 },
    ],

    // NO interactSlots, and that is deliberate rather than unfinished.
    //
    // The Altar of Ptah stood here and has moved to the gallery bridge; see the
    // note on it in great-gallery. This room is the boss arena and it holds the
    // fourth canopic jar, and a boss arena wants floor rather than furniture. A
    // 5000-gold machine parked in it also meant the deepest, dearest fixture in
    // the game sat in the one room that, until the embalming portal landed, the
    // player could only fight their way into and back out of the same door.
    interactSlots: [],
  },

  {
    id: 'serdab',
    name: 'Serdab',
    bounds: { x: 47, z: -213, w: 14, d: 14 },

    /**
     * THE BOTTOM OF THE WORLD, AND IT IS LEVEL WITH THE SHAFT IT HANGS OFF.
     *
     * The Serdab is the ONE room in the map whose portal is a bridge in the
     * graph sense - cut it and the graph falls in two - so it is also the one
     * room that could be dropped further for the price of a single ramp.
     * Deliberately not taken. WORLD-1.md asks for ONE built descent and gives
     * the reason: "One built descent against one built ascent is a shape. Nine
     * floors is a number." A second drop four rooms after the first is the
     * beginning of nine.
     *
     * It is the bottom because it is the last room on the bottom floor, and it
     * keeps the lowest ceiling in the game in both readings: five above its own
     * floor, and an absolute -1, which is lower than anything else in World 1.
     * docs/DESCENT.md carries the costed version of the drop that was declined.
     */
    base: -6,
    height: 5,
    lightingProfile: 'sanctum',

    portals: [],

    /**
     * NO SPAWN POINTS, and that is the exemption rather than a gap.
     *
     * The serdab is a 196-unit reward closet behind a puzzle - the smallest room
     * in the map by a factor of two, and one door is the correct shape for it.
     * The trainability law binds rooms that SPAWN things, so the honest fix is
     * to stop it spawning rather than to write it a special case: a room the
     * horde never appears in is not a room you can be cornered in.
     */
    spawnPoints: [],

    // No interactSlots on purpose. The serdab's payoff is authored by the
    // puzzle chain, which lands with the rest of M5; giving it a shrine now
    // would quietly make it the cheapest perk in the map.
    propSlots: [
      { type: 'statue', x: 47, z: -209, rot: Math.PI },
      { type: 'offering-table', x: 47, z: -214, rot: 0 },
      { type: 'urn', x: 43, z: -217, rot: 0.9 },
      { type: 'urn', x: 51.5, z: -209.5, rot: 2.1 },
      { type: 'brazier', x: 43.5, z: -209.5, rot: 0 },
    ],

    interactSlots: [],
  },
];

/**
 * The footprint every room fits inside. Used for sanity checks and minimaps.
 *
 * minX went from -50 to -56 when the entry room was widened and the Hall of
 * Offerings moved west to make room. It is a bounding box rather than a budget -
 * the interior is carved out of solid rock and there is nothing on the other
 * side of it - but three things read it and all three want it right: the
 * player's own clamp in systems/spaces.js, the minimap's fit, and the flow
 * field's grid, which is sized from it and would otherwise stop nine columns
 * short of the Hall's west wall and refuse to route the horde in the last six
 * metres of it. maxX stays 54, which is still the Serdab.
 */
export const INTERIOR_BOUNDS = { minX: -56, maxX: 54, minZ: -272, maxZ: -140 };

const BY_ID = new Map(ROOMS.map((r) => [r.id, r]));

export function roomById(id) {
  return BY_ID.get(id) || null;
}

/**
 * Every portal in the map, flattened, with both endpoints resolved. Portals are
 * authored on one side only, so this is the only honest way to ask what a room
 * connects to.
 */
export function allPortals() {
  const out = [];
  for (const room of ROOMS) {
    for (const p of room.portals) {
      out.push({
        from: room.id, to: p.to, at: p.at, width: p.width, kind: p.kind, cost: p.cost,
        // Carried rather than resolved. Which tier is being played is a runtime
        // fact and this module is data; build.js applies it.
        onHard: p.onHard || null,
      });
    }
  }
  return out;
}

/** Portals touching a room, from either direction. */
export function portalsOf(id) {
  return allPortals().filter((p) => p.from === id || p.to === id);
}

/** Neighbouring room ids, treating the graph as undirected. */
export function neighbors(id) {
  return portalsOf(id).map((p) => (p.from === id ? p.to : p.from));
}

/** Which room contains a point, or null if the point is in solid rock. */
export function roomAtPoint(x, z) {
  for (const r of ROOMS) {
    const { x: cx, z: cz, w, d } = r.bounds;
    if (x >= cx - w / 2 && x <= cx + w / 2 && z >= cz - d / 2 && z <= cz + d / 2) return r;
  }
  return null;
}
