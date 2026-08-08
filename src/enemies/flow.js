/**
 * THE FLOW FIELD: one distance-to-player map that the whole horde reads.
 *
 * WHAT WAS WRONG. Every actor steered at the player in a straight line and
 * relied on three local corrections to get round anything in the way: a
 * push-out in resolveAgainstWorld, a sideways force in avoid(), and a committed
 * detour when those two produced no ground. All three are LOCAL, and local
 * steering has one failure that no amount of tuning removes: it cannot see a
 * doorway it is not already facing. The comment above pickDetourSide in
 * mummy.js says as much in its first line - "Not pathfinding, and it does not
 * need to be" - and that was true of the courtyard, which is one open yard with
 * a colonnade in it. It stopped being true when the map became a room graph.
 *
 * Measured on the tree this file was added to, with every barrier forced open so
 * that nothing was behind a wall the player had not bought: a shambler placed on
 * each of the interior's thirty-one authored spawn points, given forty-five
 * simulated seconds to reach a player standing in the Great Gallery who never
 * moved. TWENTY-THREE OF THIRTY-ONE NEVER ARRIVED. Five of the King's Chamber
 * and Embalming Chamber runs walked seventy-five metres correctly and then died
 * on the last four, pressed against the gallery's south wall two metres west of
 * the gate they needed, holding 2.25 m/s and covering nothing, because the route
 * from there is EAST first and every local rule they have says north.
 *
 * The same probe in the courtyard: twenty-seven of twenty-seven arrived. The
 * exterior never needed this and still does not. The interior is the whole bug.
 *
 * WHY A FLOW FIELD AND NOT A* PER ACTOR.
 *
 * The cost of a Dijkstra map is O(cells) ONCE, and it is then read by every
 * actor for the price of nine array reads. The cost of A* is O(actors x search),
 * and this game puts twenty-four actors on the field at once by design - see
 * LIVE_CAP - on a machine that could not hold frame rate an hour before this was
 * written, which is why core/governor.js exists. Twenty-four searches per frame
 * is the wrong shape of cost for the one system that must never be the reason a
 * frame is late. One flood, shared, throttled, is the right one.
 *
 * It also composes with what is already here rather than replacing it. The field
 * supplies the DIRECTION, over ranges local steering cannot see. Separation,
 * avoid(), and the detour keep doing what they are good at, which is keeping
 * bodies off each other and off the stone in the last metre. Long-range routing
 * and short-range clearance are different jobs and only the first one was
 * missing.
 *
 * WHAT IT IS NOT. It is one layer. See the note on floors below: a single grid
 * keyed on (x, z) cannot hold both the gallery floor and the bridge six metres
 * over it, and this one deliberately holds whichever of the two the PLAYER is
 * standing on. That is the right half to keep, and the half it drops is named
 * and guarded rather than hidden.
 */

/**
 * Cell size, in metres.
 *
 * The field has to resolve the narrowest thing that counts as a way through, and
 * on this map that is a doorway: portals are authored 4.0 wide in rooms.js and
 * the walls either side are WALL_T = 1.0, so the clear span is 4.0 and a body
 * carved out of it by PAD leaves 2.9 m. At 0.7 that is four cells across the
 * gap, which is enough that no doorway can be closed by sampling luck.
 *
 * It is deliberately COARSER than the director's NAV_STEP of 0.35. That field is
 * built twice per space transition and answers a yes/no question about spawn
 * placement, so it can afford to be fine. This one is rebuilt while the horde is
 * walking, and halving the step quadruples the work: the interior's 104 x 132
 * rectangle is 28,161 cells at 0.7 and 112,266 at 0.35. Four times the cost to
 * resolve gaps this map does not have was not a trade worth making.
 */
const STEP = 0.7;

/**
 * How fat a disc the field is carved with.
 *
 * The same 0.55 the director's walk-component field uses, and for the same
 * reason spelled out there: the Bound is the widest body in the horde at 0.74
 * across, the shambler the narrowest at 0.40, and 0.55 sits between them so that
 * a route the field declares is a route the whole horde can use. Keeping the two
 * numbers equal also means the field cannot disagree with the placement search
 * about whether a spawn point has a way out of it.
 */
const PAD = 0.55;

/**
 * Nominal body height for the wall test.
 *
 * The interior's walls are boxes with a y0 and a y1, and a doorway is a gap in
 * the run with a lintel over it at DOOR_H = 4.2. Two metres is the shambler at
 * scale, it is the value director.js seeds ctx.actorHeight with, and every
 * horde body is within a few centimetres of it. Carving one field per variant
 * height would triple the cost to move a lintel nobody can walk into anyway.
 */
const BODY_H = 2.0;

/**
 * Integer edge costs, orthogonal and diagonal.
 *
 * 7/5 is 1.4000 against a true diagonal of 1.4142 - a tenth of a per cent, which
 * is three orders of magnitude below anything a steering direction can express.
 * They are integers because that is what lets the queue below be a ring of
 * buckets instead of a heap, and the ring is the difference between O(n) and
 * O(n log n) on a structure that is rebuilt several times a second.
 */
const ORTH = 5;
const DIAG = 7;

/**
 * Ring size for the bucket queue. Must exceed the largest edge cost.
 *
 * Eight against a largest edge of seven is what makes the bucket being drained
 * at distance d impossible to append to: every relaxation out of it lands at
 * d + 5 or d + 7, and neither is congruent to d modulo eight. That is why the
 * drain loop below can iterate a live array and truncate it afterwards rather
 * than copying it, which on a structure rebuilt several times a second is the
 * difference between no allocation and one per distance level.
 */
const RING = 8;

/** The eight neighbours, orthogonals first so the cheap edges relax first. */
const NB_I = [1, -1, 0, 0, 1, -1, 1, -1];
const NB_J = [0, 0, 1, -1, 1, 1, -1, -1];

/**
 * How far the flood runs, in metres, before it stops caring.
 *
 * A guard against a map larger than this one rather than a limit that binds on
 * this one, and it was measured binding when it was eighty. The director will
 * not place a spawn further than SPAWN_FAR = 55 in a straight line, and eighty
 * looked like generous headroom over that until the gallery's upper level was
 * routed: the walk from the gallery FLOOR to the far end of the upper ring is up
 * one ramp, along a ledge, across the bridge and back, which is 88 m of walking
 * to cover 28 m of ground. A geodesic route on a map built out of loops is
 * routinely three times the straight line, and capping on the straight-line
 * number silently deleted the last third of the ring.
 *
 * At 160 nothing on this map is out of reach, and the guard still exists for the
 * map someone builds next: the flood is bounded by the smaller of this and the
 * grid, so a five-hundred-metre courtyard cannot turn one rebuild into a stall.
 */
const MAX_REACH = 160;
const MAX_COST = Math.ceil((MAX_REACH / STEP) * ORTH);

/** The unreachable marker. Large enough to lose every comparison, small enough
 * to stay a smi. */
const INF = 0x3fffffff;

/**
 * WHAT A STEP IS, VERTICALLY.
 *
 * Both floor samplers - build.js for the interior, courtyard.js for the
 * exterior - take a third argument that is where the feet ALREADY are, and only
 * return a surface within STEP_UP = 0.65 of it. That one clause is what lets the
 * player walk under the gallery's bridge instead of being teleported onto it,
 * and it is what this flood carries along with the distance: every cell records
 * the floor height the flood arrived at it with, and its neighbours are sampled
 * from THAT height rather than from zero.
 *
 * The climb limit is the samplers' own 0.65, scaled by the length of the step so
 * a diagonal is allowed the same gradient rather than the same rise. The DROP
 * limit is the number that keeps the horde out of holes: 1.5 m is more than the
 * quarry terrace's steepest cell and far less than the canal's 3.2 m channel, so
 * the field will walk an actor down the canal's sloped bank - which is a ramp,
 * 3.2 m over a 5.25 m run - and will not walk one off a causeway deck into the
 * water.
 */
const CLIMB = 0.65;
const DROP = 1.5;

/**
 * How far off a stored layer's floor a READER may be and still trust it.
 *
 * Asked by an actor about its own feet, and by the gradient about the cell next
 * door. A metre is comfortably more than the deepest a body sinks into a step it
 * is part way up, and comfortably less than the gap between any two real storeys
 * on this map.
 *
 * NOT the tolerance the flood matches layers with. See SURFACE_TOL below; the
 * two look like the same question and are not, and using this one for both is a
 * measured, silent failure.
 */
const LEVEL_TOL = 1.0;

/**
 * THE UPWARD READ IS NOT A TOLERANCE. IT IS A QUESTION FOR THE FLOOR SAMPLER.
 *
 * A reader may never be offered a layer ABOVE the surface the world would
 * actually put its body on, and the only thing that knows where that is, is the
 * same `heightAt` the player controller and the mummies already call. So both
 * readers below resolve the actor's real surface first and match layers to THAT,
 * rather than windowing on the raw feet height. This constant is only the
 * fallback for a context that hands the field no sampler.
 *
 * THE BUG THIS CLOSES, measured on the west descent ramp rather than reasoned
 * about. A shambler placed at the Embalming Chamber's (-41, -200) spawn walked
 * correctly toward the descent, arrived under the ramp, and stopped dead for the
 * remaining fifty seconds, closing 7.2 m of a 50.8 m approach. Two adjacent
 * cells were pointing at each other: the one nearer the ramp foot read the RAMP
 * layer, whose route home is north and up, and the one behind it read the FLOOR
 * layer, whose route home is south to the foot and then up. Both answers are
 * correct for the layer they came from, and the actor - on the floor, under the
 * ramp - could act on only one of them.
 *
 * The reason a threshold cannot fix this was also measured. The first cut of
 * this simply tightened the window from LEVEL_TOL 1.0 to CLIMB 0.65, on the
 * argument that the reader should not be offered what the mover cannot climb.
 * That narrowed the dead strip from about 0.7 m to about 0.25 m and did not
 * remove it, because the two sides still do not agree exactly: the field stores
 * each layer's height at the CELL CENTRE and the world samples at the body's
 * own position, and on a 0.375 gradient half a cell is 0.13 m of height. Any
 * constant leaves a sliver where one says climbable and the other says no, and a
 * ramp running over a floor sweeps the gap continuously through every constant
 * you could pick. Asking the sampler removes the disagreement instead of moving
 * it, at every gradient, permanently.
 *
 * The DOWNWARD read stays a tolerance, and deliberately - see READ_DOWN. Down is
 * not symmetrical with up: a body can leave a layer below it whenever it likes
 * by walking off the side, so reading down is a real option rather than a claim
 * about what the sampler would do this frame.
 *
 * THIS DOES NOT FIX THE READ_DOWN STRIP documented below. That is the same shape
 * of failure in the other direction and still wants its own pass.
 */
const READ_UP = CLIMB;

/**
 * How far BELOW an actor's feet a layer may be and still be worth reading.
 *
 * Reading is not symmetrical, because bodies are not. A shambler standing part
 * way up the gallery ramp is a metre and a half over the floor of the same room
 * and can be on that floor whenever it likes, by walking off the side; the floor
 * cannot get to it. Judging both directions by LEVEL_TOL locked such an actor
 * onto the ramp layer, whose only route home is the whole upper ring, while the
 * layer under its feet held a route that was shorter and that it could reach by
 * taking one step sideways.
 *
 * 2.2 clears the ramp lip at its worst and stays well under the three drops that
 * must NOT be read through: the quarry terrace at 2.6, the canal channel at 3.4
 * below its causeway decks, and the gallery ledge at 6. Those are real storeys
 * and an actor on one of them has no business reading the other.
 *
 * KNOWN LIMITATION, WRITTEN DOWN BECAUSE IT IS DIAGNOSED AND NOT FIXED.
 *
 * Any hard threshold here has a trap in it, and a ramp running over a floor
 * guarantees the trap is reachable: the gap between the two surfaces sweeps
 * continuously from zero to six metres, so SOME strip of the ramp is always
 * exactly READ_DOWN above the floor beneath it. An actor that comes to rest on
 * that strip straddles the boundary - measured at (-23.75, -164.40), feet
 * oscillating between 2.19 and 2.21 - and reads a different layer on alternate
 * frames, each with a different route, so its velocity reverses sign every frame
 * and it covers no ground. It is not the wedge escape doing this: st.wedge and
 * st.detour are both zero throughout, and the field's own direction is stable
 * and correct the whole time.
 *
 * Six of the seven actors that still fail to arrive in the interior probe are
 * this one strip of the gallery's west ramp. Moving the number does not fix it,
 * it moves the strip - the earlier build with no READ_DOWN at all failed the
 * same way at a different z. The fix is to make layer selection continuous or
 * hysteretic rather than a threshold, which needs per-actor state this module
 * deliberately does not have, and it wants its own measurement pass rather than
 * being bolted onto the end of this one.
 */
const READ_DOWN = 2.2;

/**
 * HOW MANY STOREYS A CELL MAY HOLD, AND WHY IT IS NOT ONE.
 *
 * A field keyed on (x, z) alone cannot describe this map. The Great Gallery's
 * upper level is a ledge at six metres directly over the floor of the same room,
 * joined by two ramps, and rooms.js calls the bridge that closes it "the highest
 * value single geometry change in the map"; the canal outside is a channel 3.2 m
 * deep with causeway decks at 0.2 m that the player runs both over and under.
 * Both are places where one (x, z) is two different floors.
 *
 * The first build of this file stored one floor per cell, and it was measured
 * doing exactly the wrong thing: a shambler placed on the gallery's east ledge -
 * which is where four of that room's five authored spawn points put it - got no
 * field at all and walked the straight line into a parapet, because the cells it
 * was standing on had already been claimed at floor zero by the flood spreading
 * along the ground underneath. The route down the ramp existed and the field
 * could not express it.
 *
 * TWO, not a general n. Two is what this map needs and every layer is paid for
 * in memory and in flood cost whether or not anything stands on it. A third
 * storey anywhere would need this raised, and the assertion that catches that is
 * `layersFull` in the stats: it counts the relaxations that were dropped for
 * want of a slot, and on this map it is zero.
 */
const LAYERS = 2;

/**
 * WHEN TWO HEIGHTS AT ONE CELL ARE THE SAME SURFACE, for the flood.
 *
 * Deliberately much tighter than LEVEL_TOL, and the two are not the same
 * question even though both read as "is this the same floor". LEVEL_TOL is a
 * READER's question - are this actor's feet near enough this layer to trust the
 * direction stored in it - and a metre is right for that. This is the flood's
 * question, and a metre is catastrophically wrong for it.
 *
 * Measured, with the slot matched at LEVEL_TOL: the gallery's upper level stayed
 * unreachable and the layer count stayed at ZERO across the whole map, so the
 * second layer was paid for and never used. The mechanism is worth writing down
 * because it is not obvious from the code. The two ramps down off the gallery
 * ledge run six metres over twelve, which is 0.35 per cell, and the floor of the
 * room runs underneath them the whole way. The flood reaches those cells cheaply
 * from BELOW, walking the ground northward, and claims their only slot at floor
 * zero. When it then turns round at the foot of the ramp and tries to climb,
 * every ramp cell it wants is within a metre of the floor slot already sitting
 * there, so it MATCHES that slot rather than opening a new one - and Dijkstra
 * correctly refuses to relax a slot it has already settled at a lower distance.
 * The climb died on its first step, every time, silently.
 *
 * 0.45 is above the steepest single-cell rise anywhere on this map - the canal
 * bank, 3.2 m over a 5.25 m run, which is 0.43 per cell - so no surface is ever
 * split from itself. It is far below the gap between a ramp and the floor under
 * it anywhere the two are genuinely different places to stand.
 */
const SURFACE_TOL = 0.45;

/**
 * @param {{pad?: number, bodyH?: number, name?: string}} [opts]
 *   The BODY THIS FIELD IS CARVED FOR. Defaults are the shambler's PAD and
 *   BODY_H, which is what every caller wanted while the horde was the only
 *   thing being routed.
 *
 *   A SECOND INSTANCE AT GOD DIMENSIONS IS THE POINT, and it has to be a second
 *   instance rather than one field carved wider. Carving the single field at a
 *   god's 1.805 would make shamblers detour around every gap they fit through
 *   perfectly well - the horde would walk the long way round its own map to
 *   respect a body that is not there. Two fields over the same grid is the only
 *   shape that lets each body class read a route its own size.
 *
 *   The cost is one extra flood, and the director only pays it while a god is
 *   actually alive. See updateFlow there.
 */
export function createFlowField(opts = {}) {
  /**
   * The disc and the height this instance carves with.
   *
   * Held per instance rather than read from the module constants, so the two
   * fields cannot silently share a carve. `clear()` still DEFAULTS to the
   * module constants, which is what keeps clearFor() honest for a caller asking
   * about an arbitrary body.
   */
  const padFor = opts.pad ?? PAD;
  const bodyHFor = opts.bodyH ?? BODY_H;
  const fieldName = opts.name || 'horde';

  // The grid, sized to whichever space is live. Reallocated only when the
  // bounds change, which is once per space transition, never per rebuild.
  let nx = 0, nz = 0, n = 0;
  let minX = 0, minZ = 0;
  let boundsKey = '';

  /**
   * All three arrays are indexed by SLOT, not by cell: slot = k * LAYERS + s.
   *
   * A slot is one storey of one cell. It is allocated the first time the flood
   * arrives at that cell with a height no existing slot matches, and it carries
   * its own clearance verdict, because a point can be solid on the ground floor
   * and open six metres up - which is precisely what a ledge is.
   */
  let dist = new Int32Array(0);
  let floor = new Float32Array(0);
  /** 0 = slot unused, 1 = a body fits at this slot's floor, 2 = solid there. */
  let mark = new Uint8Array(0);

  /**
   * Does the slot layout in `mark` and `floor` still describe the world?
   *
   * False for as long as the collider set is the one those verdicts were
   * measured against. Set by resize() when the space changes and by dirty()
   * when the director sees a barrier splice its discs out of the live array.
   */
  let geometryDirty = true;

  /**
   * The live space's floor sampler, kept from the last rebuild.
   *
   * The flood has always had it on `ctx`; the READERS did not, and that is the
   * whole of why they had to guess at what a body could stand on with a
   * constant. Held rather than passed because sample() is called by every actor
   * every frame through a signature that has no room for it, and because a
   * reader asking a DIFFERENT sampler than the flood used would be a subtler
   * version of the same bug. It is replaced on every rebuild, which is also when
   * the space can change, so it can never be the previous world's.
   */
  let sampleFloor = null;

  // The bucket ring. Plain arrays of slot indices, truncated rather than
  // reallocated between rebuilds: a rebuild that allocates is a rebuild that
  // hands the collector work several times a second.
  const ring = [];
  for (let i = 0; i < RING; i++) ring.push([]);

  // Reporting only, but reported honestly: the cost of this file is the whole
  // reason it is throttled, and a cost that cannot be read from the harness is
  // a cost nobody will notice growing.
  const stat = {
    builds: 0,
    lastMs: 0,
    meanMs: 0,
    peakMs: 0,
    cells: 0,          // grid size for the live space
    visited: 0,        // how many slots the last flood actually settled
    tested: 0,         // how many clearance tests the last flood paid for
    layered: 0,        // cells that needed a second storey
    layersFull: 0,     // relaxations dropped for want of a slot. MUST STAY ZERO
    reseeds: 0,        // floods that had to be rooted somewhere else and rerun
    geometryBuilds: 0, // floods that also had to re-measure the world
    reads: 0,          // sample() calls since the last rebuild
    misses: 0,         // of those, how many found no usable cell
    valid: false,
  };

  /**
   * Is a body clear of the world at this point, standing on this floor?
   *
   * Deliberately the same test mummy.js's pointClear() runs rather than the
   * director's isClear(), and the difference matters. isClear() skips any
   * collider under 1.2 high on the grounds that rubble is standable-beside; but
   * resolveAgainstWorld has no such clause, so an actor really is pushed out of
   * a half-metre block. A field carved with the looser rule would route the
   * horde through rubble and then watch it grind on the rubble, which is the
   * failure this file exists to end, arriving by a different road.
   */
  /**
   * @param {number} [pad]    body radius to test clearance for. Defaults to PAD,
   *                          which is the shambler's, and which every caller used
   *                          implicitly until gods turned out to be 3.28x wider.
   * @param {number} [bodyH]  body height. Defaults to BODY_H.
   */
  function clear(x, z, floorY, ctx, pad = PAD, bodyH = BODY_H) {
    if (ctx.walls) {
      const head = floorY + bodyH;
      for (const w of ctx.walls) {
        if (head <= w.y0 || floorY >= w.y1) continue;
        if (Math.abs(x - w.x) < w.w / 2 + pad && Math.abs(z - w.z) < w.d / 2 + pad) return false;
      }
    }

    const near = ctx.colliderGrid.near(x, z, pad);
    const list = ctx.colliderGrid.out;
    for (let i = 0; i < near; i++) {
      const c = list[i];
      const base = c.y0 === undefined ? ctx.heightAt(c.x, c.z, floorY) : c.y0;
      if (floorY - base > c.h) continue;

      /**
       * And above the body, which this test was missing while the WALL test
       * eight lines up had it right all along - `head <= w.y0 || floorY >= w.y1`
       * checks both ends of a box, and the collider loop checked only one end of
       * a cylinder.
       *
       * Without it the field carves a hole under anything with a raised base:
       * the Altar of Ptah at y0 6 on the gallery bridge made a 2.1-radius circle
       * of the gallery FLOOR unwalkable, six metres beneath itself. The field
       * would then route the horde around a patch of empty stone the player can
       * walk straight through - and the two have to agree, or the map has one
       * shape for the player and another for the horde.
       */
      if (base - floorY > bodyH) continue;

      const dx = x - c.x, dz = z - c.z;
      const want = c.r + pad;
      if (dx * dx + dz * dz < want * want) return false;
    }

    /**
     * AND UNDER A WALKABLE SLAB, WHICH IS THE THIRD THING THAT CAN BE OVERHEAD
     * AND WAS THE ONLY ONE THIS TEST DID NOT KNOW ABOUT.
     *
     * The two loops above cover the wall boxes and the collider cylinders. They
     * do not cover a RAMP or a LEDGE, because neither is a wall or a cylinder:
     * they are entries in the room's walkable-surface list, and from underneath
     * they are ceilings. `player/controller.js`'s headroomAt has had this exact
     * clause the whole time - it takes the highest surface at the point, and
     * treats it as a ceiling whenever it is more than a step above the feet -
     * so until now the map had one shape for the player and another for the
     * horde, which is the failure the comment above this one exists to name.
     *
     * WHAT IT COST, measured. Each descent ramp is 8 m wide and drops 6 m over
     * 16 m of run, so the wedge under its lower end is a crawlspace: at the
     * foot the gap between the Act 3 floor and the underside of the slab is
     * centimetres. The flood happily carved that crawlspace open, so the field
     * offered the horde a route through it, and a shambler crossing the
     * Embalming Chamber walked under the ramp instead of round to its foot,
     * pressed itself into the wedge at (-19.2, -210.1) and stayed there for the
     * rest of the run. The route it needed - out from under, south to the foot
     * at z -212, then north up the slope - was in the field the whole time and
     * cost 50; the crawlspace looked shorter and was not a place a body fits.
     *
     * The highest surface is used as the ceiling rather than the slab's
     * underside, which over-charges by one RAMP_T. That is deliberate and it is
     * the same approximation the player controller makes, and the two agreeing
     * is worth more here than either being exact: the alternative is a strip
     * 0.7 m deep where the horde believes it fits and the player does not.
     *
     * The gallery is unaffected, and that is the check that says this is a
     * headroom rule and not a "ramps block" rule: its upper level is six metres
     * over its own floor, so the floor under it keeps four metres of clearance
     * and stays open, which rooms.js calls the thing that makes it a genuine
     * second storey rather than a mezzanine.
     */
    if (ctx.heightAt) {
      const top = ctx.heightAt(x, z);
      if (top > floorY + CLIMB && top - floorY < bodyH) return false;
    }

    return true;
  }

  function resize(ctx) {
    const b = ctx.bounds;
    if (!b) return false;
    const bx0 = b.minX ?? b.min, bx1 = b.maxX ?? b.max;
    const bz0 = b.minZ ?? b.min, bz1 = b.maxZ ?? b.max;
    const key = `${bx0},${bx1},${bz0},${bz1}`;
    if (key === boundsKey) return true;

    minX = bx0;
    minZ = bz0;
    nx = Math.floor((bx1 - bx0) / STEP) + 1;
    nz = Math.floor((bz1 - bz0) / STEP) + 1;
    n = nx * nz;

    dist = new Int32Array(n * LAYERS);
    floor = new Float32Array(n * LAYERS);
    mark = new Uint8Array(n * LAYERS);
    geometryDirty = true;
    boundsKey = key;
    stat.cells = n;
    return true;
  }

  /**
   * The slot of cell `k` that is already known to be OPEN at height `h`, or -1.
   *
   * A read, never an allocation. Used by the corner rule, which has to ask about
   * two cells it is not itself stepping into and must not pay a clearance test
   * to do it.
   */
  function openSlot(k, h) {
    const b = k * LAYERS;
    for (let s = 0; s < LAYERS; s++) {
      if (mark[b + s] === 1 && Math.abs(floor[b + s] - h) <= LEVEL_TOL) return b + s;
    }
    return -1;
  }

  /**
   * Flood the whole field outward from the player.
   *
   * Dial's algorithm rather than a binary heap. With only two edge weights the
   * priority queue collapses to a ring of eight buckets indexed by distance
   * modulo eight, every operation is O(1), and the whole flood is linear in the
   * number of cells it settles. A heap would be O(n log n) on 28,000 cells
   * several times a second for no gain: the weights are known and small, which
   * is exactly the case Dial's was written for.
   *
   * Cells are tested for clearance LAZILY and the verdict cached in `mark`, so
   * the expensive part - one spatial-hash query per cell - is paid at most once
   * per cell per rebuild, and never at all for cells the flood does not reach.
   * On a map where the player is sealed into one room that is most of the map.
   */
  function rebuild(ctx, px, pz, pFeetY) {
    if (!resize(ctx)) { stat.valid = false; return false; }

    // The readers need the same sampler the flood is about to use. Taken before
    // the early returns below, so a rebuild that bails still leaves the readers
    // pointed at the live space rather than at the one before it.
    sampleFloor = ctx.heightAt || null;

    const t0 = performance.now();

    /**
     * THE GEOMETRY IS NOT REBUILT WITH THE FIELD, AND THAT IS MOST OF THE SAVING.
     *
     * A rebuild is two costs that look like one. The flood itself is typed-array
     * writes and is cheap. The expensive half is `clear()`: one spatial-hash
     * query plus a linear pass over the interior's wall list, per cell, and it
     * was 12,928 of them on a single interior rebuild - the great majority of the
     * time this function spends.
     *
     * None of that answer depends on where the player is standing. A cell either
     * has room for a body at a given height or it does not, and the only thing
     * that can change it is the collider set changing, which happens when a
     * barrier is bought and at no other time. So `mark` and `floor` - the slot
     * layout and its verdicts - SURVIVE a rebuild, and only `dist` is cleared.
     * The director already tells this module when the colliders moved, through
     * the same grid.sync() that rebuilds the placement fields, so the one case
     * that must not be cached is the one case that is explicitly invalidated.
     *
     * The cache also GROWS rather than being recomputed: a player who walks up
     * to the gallery bridge causes that storey's slots to be discovered on the
     * first flood that reaches it, and they stay. That is the right shape,
     * because the set of surfaces in a room is a property of the room.
     */
    if (geometryDirty) {
      mark.fill(0);
      floor.fill(0);
      geometryDirty = false;
      // `layered` counts the cells in the CACHED layout that carry a second
      // storey, so it is reset with the layout and not with the flood. Counting
      // it per flood reported zero on every rebuild after the first, which is
      // correct and useless: the slots were allocated once and reused, which is
      // the entire point of the cache.
      stat.layered = 0;
      stat.geometryBuilds++;
    }

    dist.fill(INF);
    for (let i = 0; i < RING; i++) ring[i].length = 0;

    stat.reads = 0;
    stat.misses = 0;
    let tested = 0;
    let visited = 0;
    let full = 0;

    const i0 = Math.round((px - minX) / STEP);
    const j0 = Math.round((pz - minZ) / STEP);
    if (i0 < 0 || j0 < 0 || i0 >= nx || j0 >= nz) { stat.valid = false; return false; }

    /**
     * THE SEED IS THE PLAYER'S CELL, ON THE STOREY THE PLAYER IS STANDING ON.
     *
     * The field describes every storey it can reach, but it is ROOTED on one,
     * and this is where that is decided. A player under the gallery bridge seeds
     * at y = 0 and every route the horde reads is measured from the floor; the
     * same player up on the bridge seeds at y = 6 and the same field measures
     * every route from up there, including the two ramps down. heightAt() only
     * ever hands back a surface within a step of where the feet already are,
     * which is exactly the question "which of these two floors am I on".
     *
     * Snapped to the sampled surface rather than taken raw, because the feet are
     * the right question to ASK and not the right answer to record: a player
     * mid-jump, mid-step, or teleported by a harness has feet up to a body's
     * height off the floor they belong to, and every neighbour of the seed would
     * then be judged for its step against a height nobody is standing on.
     *
     * The seed is NOT clearance-tested. A player pressed into a corner
     * legitimately stands where a 0.55 disc does not fit, and rejecting the seed
     * there would blank the field for the whole horde at the exact moment they
     * are cornered.
     */
    const sh = ctx.heightAt ? ctx.heightAt(px, pz, pFeetY) : pFeetY;

    /**
     * Which cell to root the flood in, given the player is standing at (si, sj).
     *
     * Returns a slot index, or -1 if this cell has no storey left to give.
     */
    function seedAt(si, sj, h) {
      const b = (sj * nx + si) * LAYERS;
      for (let s = 0; s < LAYERS; s++) {
        if (mark[b + s] !== 0 && Math.abs(floor[b + s] - h) <= SURFACE_TOL) return b + s;
      }
      for (let s = 0; s < LAYERS; s++) {
        if (mark[b + s] === 0) { floor[b + s] = h; return b + s; }
      }
      return -1;
    }

    /**
     * Is this cell somewhere a body could stand, at about this height, TESTING
     * it if nobody has asked before.
     *
     * openSlot() answers the same question from the cache and is what the
     * corner rule uses, correctly: that rule runs inside the flood, where the
     * cells it asks about have always just been settled or rejected. The reseed
     * search runs where nothing has been tested at all, so it needs to be able
     * to pay for an answer rather than read one.
     *
     * Writes its verdict into the same cache the flood fills, because it is the
     * same verdict measured the same way - and because a cell probed here is
     * one the flood does not have to test again a moment later.
     */
    function probeOpen(i, j, h) {
      const kb = (j * nx + i) * LAYERS;
      for (let s = 0; s < LAYERS; s++) {
        if (mark[kb + s] !== 0 && Math.abs(floor[kb + s] - h) <= SURFACE_TOL) {
          return mark[kb + s] === 1 ? kb + s : -1;
        }
      }
      const wx = minX + i * STEP, wz = minZ + j * STEP;
      const nh = ctx.heightAt ? ctx.heightAt(wx, wz, h) : h;
      // A surface a body could actually get to from where the player is, rather
      // than any surface that happens to share this x/z. The gallery floor is
      // six metres under its own bridge and is not a reseed for a player on it.
      if (!(Math.abs(nh - h) <= DROP)) return -1;
      for (let s = 0; s < LAYERS; s++) {
        if (mark[kb + s] === 0) {
          floor[kb + s] = nh;
          tested++;
          mark[kb + s] = clear(wx, wz, nh, ctx, padFor, bodyHFor) ? 1 : 2;
          return mark[kb + s] === 1 ? kb + s : -1;
        }
      }
      return -1;
    }

    let seed = seedAt(i0, j0, sh);
    if (seed < 0) { stat.valid = false; return false; }

    /**
     * The seed is forced open, and then put back exactly as it was found.
     *
     * Forced, because a player pressed into a corner legitimately stands where a
     * 0.55 disc does not fit, and refusing the seed there would blank the field
     * for the whole horde at the exact moment they are cornered. Put back,
     * because `mark` is now a cache that outlives this call: writing "open" into
     * a slot the geometry says is solid would leave that lie in the field for
     * every later rebuild, and the player only has to walk through one doorway
     * to seed it somewhere it does not belong.
     */
    let seedWas = mark[seed];
    mark[seed] = 1;
    dist[seed] = 0;
    ring[0].push(seed);

    let pending = 1;

    /**
     * A SEED THAT GOES NOWHERE IS NOT AN ANSWER, AND IT HAPPENS.
     *
     * The seed is forced open because a player pressed into a corner
     * legitimately stands where a 0.55 disc does not fit. That handles the
     * player's own cell and does nothing at all for the case where every cell
     * AROUND them is solid too, and then the flood settles one slot, the whole
     * horde reads a field with nothing in it, and every actor on the map falls
     * back to walking at a wall.
     *
     * Not hypothetical. Caught by the cost probe rather than by the routing
     * probe, which is worth noting: a run measuring milliseconds reported an
     * exterior rebuild that reached ONE slot out of 12,875 cells, and the only
     * reason it stood out is that it was suspiciously fast. A field that is
     * empty is indistinguishable from a field that is cheap if you are only
     * watching the clock.
     *
     * So a flood that reaches almost nothing is retried once from the nearest
     * cell that has somewhere to go. Once, and from a bounded search, because
     * this is a recovery from a rare pathological placement and not a general
     * search: if the second attempt is also boxed in, the player really is
     * inside the geometry and the straight line is as good an answer as exists.
     */
    const RETRY_IF_UNDER = 4;
    let attempts = 0;

    function flood() {
      for (let d = 0; d <= MAX_COST && pending > 0; d++) {
        const b = ring[d % RING];
        if (!b.length) continue;

        const count = b.length;
        pending -= count;

        for (let bi = 0; bi < count; bi++) {
          const slot = b[bi];
          // Lazy deletion. A slot relaxed twice sits in two buckets and only the
          // first pop is the real one.
          if (dist[slot] !== d) continue;
          visited++;

          const k = (slot / LAYERS) | 0;
          const ki = k % nx;
          const kj = (k / nx) | 0;
          const kf = floor[slot];

          for (let e = 0; e < 8; e++) {
            const diag = e >= 4;
            const ni = ki + NB_I[e], nj = kj + NB_J[e];
            if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;

            const nk = nj * nx + ni;

            /**
             * NO CUTTING CORNERS, AND THIS IS NOT A COSMETIC RULE.
             *
             * An eight-connected flood will step diagonally between two open cells
             * whose shared orthogonal neighbours are both solid. Geometrically
             * that is passing through the single point where two blocks touch. On
             * a map whose walls are drawn as overlapping discs - addWallRun in
             * courtyard.js spaces them at r * 1.4 precisely so there is no gap -
             * a 0.7 m lattice laid over a 1.7 m disc run has such a point every
             * few metres, and the flood leaks straight through the colonnade.
             *
             * Measured, with this clause absent and everything else as it is now:
             * the exterior went from twenty-seven of twenty-seven actors arriving
             * to fifty-four of eighty-one STUCK, most of them pressed against the
             * colonnade at x = +/-17 with the field cheerfully insisting the way
             * home was through it. That is strictly worse than no field at all,
             * because the old straight-line heading at least wedged and detoured;
             * a leaking field wedges, detours, and then walks confidently back
             * into the same stone.
             *
             * The two cells this reads have both already been settled or rejected
             * ON THIS STOREY by the time the loop gets here, because the
             * orthogonals occupy indices 0 to 3 of the neighbour table and the
             * diagonals 4 to 7. A cell with no open slot at this height is out of
             * bounds, solid, or another storey, and all three are treated as
             * solid, which errs toward a route the horde can actually walk.
             */
            if (diag && (openSlot(kj * nx + ni, kf) < 0 || openSlot(nj * nx + ki, kf) < 0)) continue;

            const nd = d + (diag ? DIAG : ORTH);
            if (nd > MAX_COST) continue;

            const wx = minX + ni * STEP;
            const wz = minZ + nj * STEP;

            const step = diag ? CLIMB * 1.4142 : CLIMB;

            /**
             * TWO CANDIDATE STOREYS, BECAUSE A BODY CAN STEP DOWN FURTHER THAN UP.
             *
             * The floor samplers answer "what can I stand on from here" and their
             * whole definition of that is STEP_UP = 0.65 above the current feet -
             * the clause that lets the player walk under the gallery bridge
             * instead of being snapped onto it. Asking with the predecessor's own
             * floor therefore finds the surface an actor could CLIMB onto, and
             * only that one, and for a long time this loop asked nothing else.
             *
             * That is half the edges a body actually has, and the missing half is
             * not symmetrical with the half that was there. Measured: with only
             * the climb query, six actors walking south down the gallery reached
             * the foot of the west ramp - where the ramp surface is about a metre
             * over the floor it sits on - and stopped dead for the remaining
             * thirty seconds, all six within a metre of (-23, -162). The flood had
             * given the ramp surface a route, and the route it had was the whole
             * upper ring the long way round, because the one edge that would have
             * let it simply STEP OFF the ramp onto the floor beside it did not
             * exist. An actor that drifted onto the ramp layer was trapped on it.
             * Two of those six had arrived perfectly well before this file existed,
             * which makes it a regression rather than merely a gap.
             *
             * So the neighbour is asked twice: once from the predecessor's floor,
             * which finds what can be climbed to, and once from DROP above it,
             * which finds what can be dropped from. Where they differ the second
             * is a real edge an actor can walk, and it is the edge that lets the
             * horde come DOWN off the gallery's upper level and out of the canal.
             */
            const nhUp = ctx.heightAt ? ctx.heightAt(wx, wz, kf) : 0;
            const nhDown = ctx.heightAt ? ctx.heightAt(wx, wz, kf + DROP) : 0;

            for (let c = 0; c < 2; c++) {
              const nh = c === 0 ? nhUp : nhDown;
              // The drop query usually finds the same surface the climb query did.
              // Relaxing it twice is harmless and wasteful; skipping is one test.
              if (c === 1 && Math.abs(nhDown - nhUp) <= SURFACE_TOL) break;

              /**
               * The step, judged from the ACTOR's direction of travel.
               *
               * The flood runs outward from the player and the horde walks inward
               * along it, so the edge being relaxed is one an actor will cross the
               * other way: from nh up or down to kf. A rise it cannot climb and a
               * drop it cannot survive are two different limits, and conflating
               * them would either seal every ramp or walk the horde into the
               * canal.
               */
              const rise = kf - nh;
              if (rise > step) continue;
              if (-rise > DROP) continue;

              const nb = nk * LAYERS;
              let ns = -1;
              for (let s = 0; s < LAYERS; s++) {
                if (mark[nb + s] !== 0 && Math.abs(floor[nb + s] - nh) <= SURFACE_TOL) { ns = nb + s; break; }
              }
              if (ns < 0) {
                for (let s = 0; s < LAYERS; s++) if (mark[nb + s] === 0) { ns = nb + s; break; }
                // Out of storeys. Counted rather than ignored, because a map that
                // grows a third level would otherwise lose routes here in silence.
                if (ns < 0) { full++; continue; }
                if (ns !== nb) stat.layered++;
                tested++;
                floor[ns] = nh;
                mark[ns] = clear(wx, wz, nh, ctx, padFor, bodyHFor) ? 1 : 2;
              }

              if (mark[ns] === 2) continue;
              if (nd >= dist[ns]) continue;

              // `floor` is deliberately NOT rewritten here. Within SURFACE_TOL the
              // arriving height and the stored one are the same surface, and this
              // array is a cache that outlives the flood: rewriting it on every
              // relaxation would let a slot's recorded floor random-walk across
              // rebuilds by up to SURFACE_TOL a time, and its clearance verdict
              // was measured at the height it was allocated with.
              dist[ns] = nd;
              ring[nd % RING].push(ns);
              pending++;
            }
          }
        }

        b.length = 0;
      }
    }

    flood();
    mark[seed] = seedWas;

    /**
     * The retry, as a whole second flood rather than a restart inside the first.
     *
     * A restart in place looks cheaper and is wrong: the bucket ring is indexed
     * by distance modulo eight, so a slot pushed back in at distance d carries an
     * offset that every cost in the field inherits, and costAt() would then
     * report metres that are off by however far the failed attempt got. Running
     * the flood again from zero costs one extra pass over a field that by
     * definition reached almost nothing, which is the cheapest flood there is.
     */
    if (visited < RETRY_IF_UNDER && attempts === 0) {
      attempts = 1;

      let alt = -1;
      let bestR = Infinity;
      /**
       * HOW FAR TO LOOK FOR SOMEWHERE TO ROOT THE SECOND ATTEMPT, and why four
       * cells is right for a shambler and useless for a god.
       *
       * The seed is the player's own cell, forced open because a player pressed
       * into a corner legitimately stands where the carving disc does not fit.
       * That handles the cell itself and does nothing for the case where every
       * cell AROUND it is solid too - and how likely that is depends entirely on
       * how fat the disc is. At 0.55 the player has to be genuinely wedged. At a
       * god's 1.805 it is the ordinary case: any prop within 1.805 + its own
       * radius closes the cell, so a player standing near the mystery box, a
       * brazier or a wall closes every cell for metres around.
       *
       * Measured, and it is why this exists: with the search fixed at four
       * cells, a player standing on the Great Gallery's box spawn at (0, -177)
       * collapsed the god field to ONE settled slot on every rebuild. Every god
       * then fell through to the straight line - silently, and indistinguishably
       * from the build before the field existed, because a collapsed field is
       * also the cheapest field there is. The run that caught it measured a mean
       * rebuild of 0.006 ms.
       *
       * So the radius scales with the disc. Two body widths past the carve, plus
       * the original four cells as a floor, which leaves the horde's search
       * exactly as it was and gives a god about five and a half metres. Seeding
       * a few metres off the player is not a compromise for a body this size:
       * the route it wants is the route to the ROOM the player is in, and
       * boss.js walks the last stretch on the live position anyway - see
       * ROUTE_FADE there.
       */
      const reseedR = Math.max(4, Math.ceil((padFor * 2) / STEP) + 2);
      for (let r = 1; r <= reseedR && alt < 0; r++) {
        for (let dj = -r; dj <= r; dj++) {
          for (let di = -r; di <= r; di++) {
            if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
            const i = i0 + di, j = j0 + dj;
            if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
            // An OPEN slot near the player's own height. Not merely a slot: the
            // whole failure is that the neighbours are solid, so a candidate
            // that is also solid is not a recovery.
            //
            // PROBED RATHER THAN LOOKED UP, and the difference is the whole
            // recovery. This used to call openSlot(), which reads `mark` - the
            // cache of verdicts the FLOOD has filled in. On a collapsed flood
            // the only cells with a verdict are the seed's own neighbours, and
            // they are solid by definition, since that is what collapsed it.
            // Every cell further out is untested, reads as unknown, and was
            // skipped. So the retry could only ever recover to somewhere the
            // flood had already been, which is exactly the set it failed to
            // leave: a recovery that cannot recover.
            const s = probeOpen(i, j, sh);
            if (s < 0) continue;
            const rr = di * di + dj * dj;
            if (rr < bestR) { bestR = rr; alt = s; }
          }
        }
      }

      if (alt >= 0) {
        stat.reseeds++;
        dist.fill(INF);
        for (let q = 0; q < RING; q++) ring[q].length = 0;
        visited = 0;
        dist[alt] = 0;
        ring[0].push(alt);
        pending = 1;
        flood();
      }
    }

    const ms = performance.now() - t0;
    stat.builds++;
    stat.lastMs = ms;
    stat.peakMs = Math.max(stat.peakMs, ms);
    stat.meanMs += (ms - stat.meanMs) * 0.12;
    stat.visited = visited;
    stat.tested = tested;
    stat.layersFull = full;
    stat.valid = true;
    return true;
  }

  /**
   * Which way is downhill from here.
   *
   * Writes a unit direction into `out` and returns true, or returns false and
   * leaves `out` untouched, which the caller reads as "no route from here, steer
   * the way you always did".
   *
   * A CENTRAL DIFFERENCE ON THE DISTANCE FIELD, not the direction of the lowest
   * neighbouring cell. Picking a neighbour quantises the heading to the eight
   * compass points, and a horde crossing thirty metres of open floor in
   * forty-five degree stair-steps is a worse artefact than the bug being fixed -
   * it also lengthens every route by up to eight per cent, which the player
   * reads as the horde arriving late. A difference of the distances either side
   * is continuous in the field's values and gives a heading good to a fraction
   * of a degree in open ground.
   *
   * A blocked neighbour is scored as one step UPHILL rather than skipped, so the
   * gradient leans off walls for free and the actor arrives at a doorway already
   * lined up with it.
   */
  /**
   * The highest layer height a body standing at (x, z) with feet at feetY is
   * allowed to read, and the one number both readers below agree on.
   *
   * It is the surface the WORLD would put that body on, plus SURFACE_TOL to
   * absorb the difference between a layer height stored at the cell centre and a
   * surface sampled at the body's own position. See READ_UP for the measurement
   * that says a constant cannot do this job.
   *
   * Falls back to the feet plus the climb limit when no sampler is held, which
   * is the old behaviour and is what a context without `heightAt` gets.
   */
  function readCeiling(x, z, feetY) {
    if (!sampleFloor) return feetY + READ_UP;
    return sampleFloor(x, z, feetY) + SURFACE_TOL;
  }

  function sample(x, z, feetY, out) {
    stat.reads++;
    if (!stat.valid) { stat.misses++; return false; }

    const i0 = Math.round((x - minX) / STEP);
    const j0 = Math.round((z - minZ) / STEP);

    /**
     * Find a cell to read from, widening if the actor is standing somewhere the
     * field calls solid.
     *
     * It legitimately is, often: the field is carved with a 0.55 disc and a
     * shambler is 0.40 across, so a body hugging a wall sits inside the margin.
     * The director's walk field has the same widening for the same reason. Two
     * cells is 1.4 m, comfortably more than the margin, and the search takes the
     * LOWEST distance rather than the nearest cell so that an actor in a
     * doorway is pulled through it rather than back out of it.
     */
    const ceiling = readCeiling(x, z, feetY);

    let best = -1;
    let bestD = INF;
    for (let r = 0; r <= 2; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          // The ring only, so r = 0 is the cell itself and each later pass adds
          // exactly the new perimeter. Ring by ring rather than one square
          // sweep, because taking the lowest distance over the whole 5 x 5 lets
          // a body pressed against one side of a pillar borrow the cell on the
          // OTHER side of it and walk straight into the stone. Measured doing
          // exactly that against the Altar of Ptah's collider.
          if (r > 0 && Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          const i = i0 + di, j = j0 + dj;
          if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
          const kb = (j * nx + i) * LAYERS;
          for (let s = 0; s < LAYERS; s++) {
            const k = kb + s;
            if (dist[k] >= INF) continue;
            // Asymmetric on purpose, and the two sides are different KINDS of
            // question. Up is "would the floor sampler put my body there", which
            // only the sampler can answer; down is "could I get down to it",
            // which is a tolerance. See READ_UP and READ_DOWN.
            if (floor[k] > ceiling || feetY - floor[k] > READ_DOWN) continue;
            if (dist[k] < bestD) { bestD = dist[k]; best = k; }
          }
        }
      }
      if (best >= 0) break;
    }

    if (best < 0) { stat.misses++; return false; }

    const bk = (best / LAYERS) | 0;
    const bi = bk % nx;
    const bj = (bk / nx) | 0;
    const d0 = dist[best];
    const bf = floor[best];

    /**
     * A DESCENT DIRECTION THAT CANNOT POINT UPHILL, rather than a gradient.
     *
     * This was a central difference on the distance field, which is the textbook
     * answer and is smooth and is WRONG HERE, for a reason worth recording
     * because it took a per-frame trace to see.
     *
     * A central difference is a good descent direction only where the field is
     * locally smooth. This field is not, and cannot be: a drop edge is a real
     * discontinuity - two cells 0.7 m apart can be a metre and a half apart
     * vertically and tens of metres apart in route - and near one the difference
     * of the two neighbours either side says nothing useful about which way is
     * down. Measured: a shambler that had walked correctly from the Hall of
     * Offerings onto the foot of the gallery's west ramp then sat at
     * (-23.74, -162.77) for thirty-three straight seconds, twitching two
     * centimetres back and forth across one cell boundary, with the field
     * handing it exactly [+1, 0] and exactly [-1, 0] on alternate frames while
     * the two cells' route costs read 30.1 and 30.4. Two cells, each of them
     * pointing at the other. A limit cycle, in a field that had the right answer
     * in it the whole time.
     *
     * So the direction is built only out of neighbours that are STRICTLY CHEAPER
     * than the cell the actor is in, each weighted by how much cheaper it is.
     * Three properties fall out, and all three matter:
     *
     *   - It can never point at a cell that is not progress, so the two-cell
     *     limit cycle is not merely unlikely, it is unrepresentable.
     *   - It is still smooth in open ground. Several neighbours are downhill
     *     there and the blend interpolates between them, so a horde crossing
     *     thirty metres of floor does not stair-step at forty-five degrees.
     *   - No downhill neighbour at all now means something exact - a local
     *     minimum, which is the player's own cell - instead of being confused
     *     with a flat difference.
     */
    let dx = 0, dz = 0;
    for (let e = 0; e < 8; e++) {
      const i = bi + NB_I[e], j = bj + NB_J[e];
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;

      // The neighbour ON THIS STOREY, cheapest slot. A cell whose only slots are
      // another floor is not a neighbour of this one.
      const kb = (j * nx + i) * LAYERS;
      let v = INF;
      for (let s = 0; s < LAYERS; s++) {
        const k = kb + s;
        if (dist[k] >= INF || Math.abs(floor[k] - bf) > LEVEL_TOL) continue;
        if (dist[k] < v) v = dist[k];
      }
      if (v >= d0) continue;

      // Weighted by the saving, and by the true length of the step so that a
      // diagonal is not counted as though it were an orthogonal.
      const w = (d0 - v) / (e < 4 ? 1 : 1.4142);
      dx += NB_I[e] * w;
      dz += NB_J[e] * w;
    }

    const len = Math.hypot(dx, dz);
    if (len < 1e-4) { stat.misses++; return false; }

    // If the actor had to borrow a cell, aim at that cell as well as down its
    // gradient. Otherwise a body wedged in the 0.55 margin reads a heading that
    // is correct for a place it is not standing, and walks parallel to the way
    // out instead of into it.
    if (bk !== j0 * nx + i0) {
      const cx = minX + bi * STEP - x;
      const cz = minZ + bj * STEP - z;
      const cl = Math.hypot(cx, cz) || 1;
      dx = dx / len + cx / cl;
      dz = dz / len + cz / cl;
      const l2 = Math.hypot(dx, dz) || 1;
      out.x = dx / l2; out.z = dz / l2;
      return true;
    }

    out.x = dx / len;
    out.z = dz / len;
    return true;
  }

  /**
   * How far this point is from the player ALONG THE FLOOR, in metres, or -1
   * where the field has no route.
   *
   * The straight-line distance is one subtraction and every system in this game
   * already has it; this is the other number, and the gap between the two is the
   * entire thing the field knows that nothing else does. A suite that wants to
   * assert "there is a way from the King's Chamber to the Great Gallery and it
   * is about ninety metres long" asks this rather than spawning an actor and
   * watching it for forty-five seconds, which turns a simulation into an
   * assertion.
   *
   * Uses the same widened search sample() does, so a point inside the carving
   * margin answers about the floor beside it rather than reporting no route.
   */
  function costAt(x, z, feetY) {
    if (!stat.valid) return -1;
    const i0 = Math.round((x - minX) / STEP);
    const j0 = Math.round((z - minZ) / STEP);
    // Identical rule to sample()'s, deliberately: this function exists so a
    // suite can assert the route an actor would be given without spawning one,
    // and a cost read through a wider window than the actor's would answer about
    // a route the actor is never offered.
    const ceiling = feetY === undefined ? Infinity : readCeiling(x, z, feetY);
    let bestD = INF;
    for (let r = 0; r <= 2; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (r > 0 && Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          const i = i0 + di, j = j0 + dj;
          if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
          const kb = (j * nx + i) * LAYERS;
          for (let s = 0; s < LAYERS; s++) {
            const k = kb + s;
            if (dist[k] >= INF) continue;
            if (feetY !== undefined
              && (floor[k] > ceiling || feetY - floor[k] > READ_DOWN)) continue;
            if (dist[k] < bestD) bestD = dist[k];
          }
        }
      }
      if (bestD < INF) break;
    }
    return bestD >= INF ? -1 : (bestD / ORTH) * STEP;
  }

  return {
    rebuild,
    sample,
    costAt,

    /**
     * Would a body of THIS size stand here, as opposed to the 0.55 x 2.0 one the
     * field is carved for.
     *
     * The field marks a cell walkable if a shambler fits. A god is radius 1.805
     * and height 3.89 - 3.28x wider and 1.95x taller - so `sample()` hands gods a
     * direction into cells their body cannot occupy: they walk in,
     * resolveAgainstWorld pushes them out, and the field says go that way again.
     * Grinding in a doorway under fire is what the owner reported as "the
     * doorways trap them and make it easy to kill them all".
     *
     * This is the QUERY half and deliberately not the whole fix. It lets a
     * caller - and a harness - ask the question honestly against the SAME
     * predicate the flood uses, rather than reimplementing clearance beside it.
     * Giving gods a genuinely different ROUTE needs a second flood over this
     * grid carved at these numbers, which is the next change.
     */
    clearFor(x, z, floorY, ctx, radius, height) {
      return clear(x, z, floorY, ctx, radius, height);
    },

    get valid() { return stat.valid; },
    /** Metres per cell, so a caller can reason about how stale a field may be. */
    get step() { return STEP; },
    /** Forget the field without rebuilding it. Used on a space transition, where
     * the bounds and the collider set both change and the old answers are about
     * a world 110 units away. */
    invalidate() { stat.valid = false; },

    /**
     * The world changed shape. Throw away the cached clearance verdicts.
     *
     * Called for the only two things that can move a wall: a space transition,
     * and a barrier releasing its cylinders when the player buys it. Anything
     * that changes `world.colliders` and does not call this leaves the horde
     * routing round a wall that is no longer there - or, worse, through one that
     * is - so this is deliberately coupled to the director's grid.sync(), which
     * is the one place that already detects exactly that event.
     */
    dirty() { geometryDirty = true; },
    /** Which body this field is carved for, so a harness can tell them apart. */
    get carve() { return { name: fieldName, pad: padFor, bodyH: bodyHFor }; },

    stats() {
      return {
        name: fieldName,
        pad: padFor,
        bodyH: bodyHFor,
        valid: stat.valid,
        builds: stat.builds,
        cells: stat.cells,
        visited: stat.visited,
        tested: stat.tested,
        layered: stat.layered,
        layersFull: stat.layersFull,
        reseeds: stat.reseeds,
        geometryBuilds: stat.geometryBuilds,
        lastMs: +stat.lastMs.toFixed(3),
        meanMs: +stat.meanMs.toFixed(3),
        peakMs: +stat.peakMs.toFixed(3),
        reads: stat.reads,
        misses: stat.misses,
        step: STEP,
      };
    },
  };
}

export { STEP as FLOW_STEP, PAD as FLOW_PAD, LEVEL_TOL as FLOW_LEVEL_TOL };
