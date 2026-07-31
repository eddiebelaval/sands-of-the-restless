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
    bounds: { x: 0, z: -149, w: 24, d: 18 },
    height: 7,
    lightingProfile: 'chamber',

    portals: [
      // Both cost the same on purpose: the split is about which half of the
      // map you open first, not which is cheaper.
      { to: 'hall-of-offerings', at: { x: -12, z: -149 }, width: 4.0, kind: 'debris', cost: 750 },
      { to: 'granary-vault', at: { x: 12, z: -149 }, width: 4.0, kind: 'debris', cost: 750 },
    ],

    spawnPoints: [
      { x: -9, z: -155 },
      { x: 9, z: -155 },
      { x: 0, z: -156 },
    ],

    propSlots: [
      { type: 'pillar', x: -7, z: -145, rot: 0 },
      { type: 'pillar', x: 7, z: -145, rot: 0 },
      { type: 'pillar', x: -7, z: -153, rot: 0 },
      { type: 'pillar', x: 7, z: -153, rot: 0 },
      { type: 'brazier', x: -4, z: -142.5, rot: 0 },
      { type: 'brazier', x: 4, z: -142.5, rot: 0 },
      { type: 'stela', x: 10.5, z: -156, rot: -Math.PI / 2 },
      // Well clear of both debris doorways. Rubble parked in a portal is the
      // one prop that would still be blocking it after the player has paid to
      // clear it, since the doorway barrier is its own object.
      { type: 'rubble', x: -10, z: -143, rot: 0.6 },
      { type: 'rubble', x: 5, z: -156, rot: 2.1 },
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
      {
        type: 'shrine',
        x: 10.1, z: -143, rot: Math.PI / 2,
        config: { boon: 'anubis' },
      },
    ],
  },

  {
    id: 'hall-of-offerings',
    name: 'Hall of Offerings',
    bounds: { x: -31, z: -149, w: 38, d: 18 },
    height: 9,
    lightingProfile: 'corridor',

    portals: [
      { to: 'great-gallery', at: { x: -19, z: -158 }, width: 4.5, kind: 'open', cost: 0 },
    ],

    spawnPoints: [
      { x: -46, z: -144 },
      { x: -46, z: -154 },
      { x: -34, z: -155 },
      { x: -22, z: -144 },
    ],

    propSlots: [
      // Two rows of columns down the long axis. The hall is the one room whose
      // read is entirely rhythm, so the spacing is even and the count is odd.
      { type: 'colonnade', x: -45, z: -145.5, rot: 0 },
      { type: 'colonnade', x: -38.5, z: -145.5, rot: 0 },
      { type: 'colonnade', x: -32, z: -145.5, rot: 0 },
      { type: 'colonnade', x: -25.5, z: -145.5, rot: 0 },
      { type: 'colonnade', x: -19, z: -145.5, rot: 0 },
      { type: 'colonnade', x: -45, z: -152.5, rot: 0 },
      { type: 'colonnade', x: -38.5, z: -152.5, rot: 0 },
      { type: 'colonnade', x: -32, z: -152.5, rot: 0 },
      { type: 'colonnade', x: -25.5, z: -152.5, rot: 0 },
      { type: 'colonnade', x: -19, z: -152.5, rot: 0 },

      { type: 'offering-table', x: -42, z: -149, rot: 0 },
      { type: 'offering-table', x: -28, z: -149, rot: 0 },
      { type: 'urn', x: -44.5, z: -156, rot: 0.4 },
      { type: 'urn', x: -43, z: -155.2, rot: 1.9 },
      { type: 'urn', x: -21, z: -142.8, rot: 2.7 },
      { type: 'brazier', x: -47, z: -149, rot: 0 },
      { type: 'brazier', x: -35, z: -142.6, rot: 0 },
      { type: 'rubble', x: -15.5, z: -155, rot: 1.1 },
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
        x: -31, z: -149, rot: Math.PI / 2,
        config: { spawn: 'A', cost: 950 },
      },
      {
        type: 'wallbuy',
        x: -40, z: -156.6, rot: Math.PI,
        config: { weapon: 'shotgun', cost: 1200 },
      },
      {
        type: 'shrine',
        x: -24, z: -141.9, rot: 0,
        config: { boon: 'shu' },
      },
    ],
  },

  {
    id: 'granary-vault',
    name: 'Granary Vault',
    bounds: { x: 25, z: -149, w: 26, d: 18 },
    height: 7,
    lightingProfile: 'chamber',

    portals: [
      { to: 'great-gallery', at: { x: 19, z: -158 }, width: 4.5, kind: 'open', cost: 0 },
    ],

    spawnPoints: [
      { x: 35, z: -144 },
      { x: 36, z: -151 },
      { x: 15, z: -144 },
    ],

    propSlots: [
      // Imsety, the first jar, USED TO STAND HERE and now stands in the first
      // west chapel of the courtyard - see the note in courtyard.js. The whole
      // four-jar chain began behind a thousand-gold door; it now starts in the
      // first minute of the run, and the player crosses the threshold already
      // holding a piece of the thing they are there to finish.
      { type: 'urn', x: 15.5, z: -145, rot: 0.2 },
      { type: 'urn', x: 17.2, z: -144.2, rot: 1.4 },
      { type: 'urn', x: 16.4, z: -153.6, rot: 2.6 },
      { type: 'urn', x: 34, z: -155.5, rot: 0.9 },
      { type: 'urn', x: 35.6, z: -154.2, rot: 2.2 },
      { type: 'pillar', x: 21, z: -145.5, rot: 0 },
      { type: 'pillar', x: 29, z: -145.5, rot: 0 },
      { type: 'brazier', x: 25, z: -143, rot: 0 },
      { type: 'rubble', x: 30.5, z: -153, rot: 1.7 },
    ],

    interactSlots: [
      {
        type: 'shrine',
        x: 36.4, z: -149, rot: Math.PI / 2,
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
      { x: -21, z: -183.5, w: 8, d: 23, y0: 6, y1: 6 },
      { x: 21, z: -183.5, w: 8, d: 23, y0: 6, y1: 6 },

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

      { x: -21, z: -166, w: 8, d: 12, y0: 6, y1: 0 },
      { x: 21, z: -166, w: 8, d: 12, y0: 6, y1: 0 },
    ],

    portals: [
      { to: 'embalming-chamber', at: { x: -20, z: -196 }, width: 4.0, kind: 'gate', cost: 1000 },
      { to: 'canopic-crypt', at: { x: 0, z: -196 }, width: 4.0, kind: 'gate', cost: 1000 },
      { to: 'star-shaft', at: { x: 20, z: -196 }, width: 4.0, kind: 'gate', cost: 1250 },
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
  // row C: the three gated rooms off the gallery
  // ---------------------------------------------------------------------
  {
    id: 'embalming-chamber',
    name: 'Embalming Chamber',
    bounds: { x: -29, z: -214, w: 30, d: 36 },
    height: 8,
    lightingProfile: 'chamber',

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
        width: 4.0,
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

    propSlots: [
      { type: 'sarcophagus', x: -29, z: -207, rot: 0 },
      { type: 'offering-table', x: -29, z: -213, rot: 0 },
      { type: 'pillar', x: -21, z: -203, rot: 0 },
      { type: 'pillar', x: -37, z: -203, rot: 0 },
      { type: 'pillar', x: -21, z: -222, rot: 0 },
      { type: 'pillar', x: -37, z: -222, rot: 0 },
      { type: 'urn', x: -18, z: -199.5, rot: 0.5 },
      { type: 'urn', x: -19.6, z: -200.8, rot: 2.3 },
      { type: 'brazier', x: -24, z: -229, rot: 0 },
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
    height: 6,
    lightingProfile: 'chamber',

    portals: [
      // No price. The gate is the power switch two rooms away, which is the
      // whole point of the embalming chamber existing.
      { to: 'kings-chamber', at: { x: 0, z: -232 }, width: 5.0, kind: 'power', cost: 0 },
    ],

    spawnPoints: [
      { x: -11, z: -200 },
      { x: 11, z: -200 },
      { x: -11, z: -229 },
      { x: 11, z: -229 },
    ],

    propSlots: [
      { type: 'canopic-jar', x: 0, z: -205, rot: 0, config: { index: 3, son: 'duamutef' } },
      { type: 'sarcophagus', x: -8, z: -212, rot: 0 },
      { type: 'sarcophagus', x: 8, z: -212, rot: 0 },
      { type: 'sarcophagus', x: -8, z: -221, rot: 0 },
      { type: 'sarcophagus', x: 8, z: -221, rot: 0 },
      { type: 'pillar', x: 0, z: -216.5, rot: 0 },
      { type: 'urn', x: 11, z: -206, rot: 1.1 },
      { type: 'urn', x: -11.4, z: -207.2, rot: 2.8 },
      { type: 'brazier', x: 0, z: -199, rot: 0 },
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
    height: 30,
    lightingProfile: 'shaft',

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
        width: 4.0,
        kind: 'open',
        cost: 0,
        onHard: { kind: 'debris', cost: 1250 },
      },
    ],

    spawnPoints: [
      { x: 17, z: -200 },
      { x: 37, z: -200 },
      { x: 17, z: -228 },
      { x: 37, z: -228 },
    ],

    propSlots: [
      { type: 'canopic-jar', x: 20, z: -204, rot: 0, config: { index: 2, son: 'hapy' } },
      // Truncated on purpose. Columns running the full 30 units would turn the
      // shaft into four rails; broken off at 12 they leave the void above them
      // as the thing the room is actually about.
      { type: 'pillar', x: 19, z: -206, rot: 0, config: { height: 12 } },
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

/** The footprint every room fits inside. Used for sanity checks and minimaps. */
export const INTERIOR_BOUNDS = { minX: -50, maxX: 54, minZ: -272, maxZ: -140 };

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
