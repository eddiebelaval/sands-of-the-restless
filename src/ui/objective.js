/**
 * THE OBJECTIVE TRACKER: what to do next, derived rather than scripted.
 *
 * A new player is dropped into a courtyard with five hundred gold and no idea
 * that there is a sealed doorway worth a thousand, a wall gun behind it, a
 * debris fall behind that, and a lever three rooms deeper that turns six dead
 * shrines on. Every one of those is legible ONCE YOU ARE STANDING IN FRONT OF
 * IT - that is what the buy prompts are for - and completely invisible from
 * anywhere else. The map is a chain of gates and the player can only ever see
 * one link of it.
 *
 * So this names the next link. One line, always true, never a cutscene.
 *
 * WHY IT IS NOT A SCRIPT, and this is the whole design:
 *
 * A hardcoded list of steps is a second copy of the map, and the moment a price
 * moves in rooms.js or a portal is re-routed, the second copy is wrong and
 * nothing fails. Worse, a script cannot answer the interesting question, which
 * is not "what is step four" but "what is step four FROM HERE" - the player who
 * opened the west half of the pyramid and the player who opened the east half
 * are on different routes to the same lever, and a script would send one of them
 * through a wall.
 *
 * Instead there is a short ladder of MILESTONES - each with a done() that reads
 * live system state and a room the thing actually happens in - and a weighted
 * search over the real room graph that turns "get to the Embalming Chamber" into
 * "clear the debris, 750 gold" when that is what stands in the way. Costs come
 * out of the same barrier records systems/doors.js charges against, so the
 * figure on the tracker cannot disagree with the figure on the prompt: they are
 * the same number read from the same object.
 *
 * NOTHING IN HERE MUTATES ANYTHING. It reads doors, economy, power, shrines,
 * wall buys, the Altar and the room graph, and returns a value. That is what
 * makes it testable without a renderer and what stops a HUD element from ever
 * being able to break the game it is describing.
 */

import { BOONS } from '../systems/shrines.js';
import { installLanguage } from './hud.js';

/** How the tracker talks about a barrier, by what kind of barrier it is. */
const CROSS_VERB = {
  debris: 'CLEAR THE DEBRIS TO',
  gate: 'OPEN THE WAY TO',
  power: 'OPEN THE WAY TO',
  puzzle: 'OPEN THE WAY TO',
};

/**
 * Build the tracker.
 *
 * Every argument is READ ONLY from in here. `interior` supplies the graph,
 * `doors` supplies which barriers have actually cleared, and the rest supply
 * the conditions the milestones test.
 */
export function createObjectives({
  spaces, interior, doors, economy, power, shrines, altar,
  weapons, interacts, director, player,
}) {
  // ---------------------------------------------------------------------------
  // the graph
  // ---------------------------------------------------------------------------

  const roomsById = new Map(interior.rooms.map((r) => [r.id, r]));

  /**
   * Every portal between two rooms, both directions, with the barrier record
   * that stands in it when there is one.
   *
   * The ENTRY portal is skipped: its `from` is null because its barrier is the
   * granite slab out in the courtyard, and the courtyard is not a room in this
   * graph. It is handled by the exterior branch of next() instead.
   */
  const edges = new Map();          // roomId -> [{ to, portal, barrier }]

  function addEdge(from, to, portal, barrier) {
    if (!edges.has(from)) edges.set(from, []);
    edges.get(from).push({ to, portal, barrier });
  }

  for (const p of interior.portals) {
    if (!p.from) continue;
    const barrier = interior.barriers.find((b) => b.from === p.from && b.to === p.to) || null;
    addEdge(p.from, p.to, p, barrier);
    addEdge(p.to, p.from, p, barrier);
  }

  /**
   * Can the player walk through this edge right now?
   *
   * `opening` counts as passable, and deliberately: build.js drops the barrier's
   * colliders on the FIRST frame of the animation, so a player who has paid can
   * walk into a doorway that is still moving. A tracker that said otherwise
   * would spend a second and a half telling them to buy something they own.
   */
  function passable(edge) {
    if (!edge.barrier) return true;                 // kind 'open': never built
    return !!(edge.barrier.opened || edge.barrier.opening);
  }

  /**
   * Cheapest route from one room to another, counting CLOSED BARRIERS and
   * nothing else.
   *
   * Distance in metres is the wrong cost function here. The player does not
   * care that the Hall of Offerings is longer than the Granary Vault; they care
   * how many things they still have to buy, and the route with one purchase on
   * it is the right answer even when it is the long way round. Dijkstra over a
   * ten-node graph with weights 0 and 1, which is small enough that the naive
   * scan for the next node costs less than a heap would.
   *
   * @returns {{cost:number, blockers:object[]}|null}
   */
  function route(from, to) {
    if (!from || !to) return null;
    if (from === to) return { cost: 0, blockers: [] };

    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const seen = new Set();

    for (;;) {
      let node = null;
      let best = Infinity;
      for (const [id, d] of dist) {
        if (seen.has(id) || d >= best) continue;
        node = id; best = d;
      }
      if (node === null) return null;
      if (node === to) break;
      seen.add(node);

      for (const edge of edges.get(node) || []) {
        const w = passable(edge) ? 0 : 1;
        const next = best + w;
        if (next < (dist.has(edge.to) ? dist.get(edge.to) : Infinity)) {
          dist.set(edge.to, next);
          prev.set(edge.to, { from: node, edge });
        }
      }
    }

    // Walk back and collect the closed barriers in the order the player meets
    // them. Reversed at the end, so blockers[0] is the one to buy NEXT rather
    // than the one nearest the destination.
    const blockers = [];
    let at = to;
    while (at !== from) {
      const step = prev.get(at);
      if (!step) return null;
      if (!passable(step.edge)) blockers.push(step.edge);
      at = step.from;
    }
    blockers.reverse();

    return { cost: dist.get(to), blockers };
  }

  /** Which room the player is standing in, or null when outside. */
  function here() {
    if (spaces.active !== 'interior') return null;
    return spaces.roomId || null;
  }

  const roomName = (id) => (roomsById.get(id) || {}).name || 'the pyramid';

  // ---------------------------------------------------------------------------
  // fixtures
  // ---------------------------------------------------------------------------

  const fixtures = () => (interacts && interacts.records) || [];

  /** Straight-line metres from the player to a fixture. */
  function reach(rec) {
    if (!player || !player.position) return 0;
    return Math.hypot(player.position.x - rec.x, player.position.z - rec.z);
  }

  /**
   * Rank candidate fixtures the way a player would.
   *
   * THREE KEYS, IN THIS ORDER, and the order is the argument:
   *
   *   1. how many shut doorways lie between here and it. A purchase behind two
   *      gates is not a next step, it is a next hour.
   *   2. whether the purse covers it RIGHT NOW. Between two things the player
   *      can walk to, naming the one they can afford turns the tracker into an
   *      instruction; naming the one they cannot turns it into a wish.
   *   3. how far away it is. Only after the first two, because ten metres is
   *      nothing next to a thousand gold.
   *
   * Price is deliberately NOT a key. It is already inside key 2, and sorting on
   * it directly would send a player standing next to a 2500 shrine back across
   * the map for a 1500 one.
   */
  function rank(list, priceOf) {
    return list.sort((a, b) => a.route.cost - b.route.cost
      || (economy.canAfford(priceOf(a.rec)) ? 0 : 1) - (economy.canAfford(priceOf(b.rec)) ? 0 : 1)
      || reach(a.rec) - reach(b.rec));
  }

  /** Wall buys the player does not own the weapon of, best first. */
  function openWallBuys(from) {
    const list = fixtures()
      .filter((r) => r.type === 'wallbuy'
        && r.config && r.config.weapon
        && !weapons.owns(r.config.weapon))
      .map((r) => ({ rec: r, route: route(from, r.room) }))
      .filter((c) => c.route);

    return rank(list, (r) => (r.config && r.config.cost) || 0);
  }

  /** Shrines whose boon the player is not carrying, best first. */
  function openShrines(from) {
    const list = fixtures()
      .filter((r) => r.type === 'shrine'
        && r.config && BOONS[r.config.boon]
        && !shrines.has(r.config.boon))
      .map((r) => ({ rec: r, route: route(from, r.room) }))
      .filter((c) => c.route);

    return rank(list, (r) => BOONS[r.config.boon].cost);
  }

  /** The Kindling's slot. Not in interacts.records - it has no buy handler. */
  const kindlingSlot = (power && power.slot)
    || interior.interacts.find((i) => i.type === 'power')
    || null;

  const altarSlot = fixtures().find((r) => r.type === 'altar') || null;

  /** Every barrier still shut, so the endgame always has something to name. */
  function shutBarriers(from) {
    return interior.barriers
      .filter((b) => !b.opened && !b.opening)
      .map((b) => ({ rec: b, route: route(from, b.from) }))
      .filter((c) => c.route)
      .sort((a, b) => a.route.cost - b.route.cost || a.rec.cost - b.rec.cost);
  }

  // ---------------------------------------------------------------------------
  // phrasing
  // ---------------------------------------------------------------------------

  /**
   * The detail line under the headline.
   *
   * A price the player cannot meet is USELESS ON ITS OWN - "1000 GOLD" when you
   * have four hundred tells you the same thing whether you are sixty short or
   * six hundred short, and those are two completely different decisions. So the
   * shortfall is quoted, and once it is gone the line becomes the instruction
   * instead, because at that point the number has stopped being the obstacle.
   */
  function priceLine(cost, suffix = '') {
    // No price is not the same as free. Everything that reaches this with a zero
    // is a gate whose condition has already been met - the power door once the
    // Kindling is lit - and the honest line there is the instruction, because
    // the payment was the walk and it has been made.
    if (!cost) return suffix || 'PRESS F';
    const short = cost - economy.gold;
    if (short > 0) return `${cost} GOLD  -  ${short} SHORT`;
    return `${cost} GOLD${suffix ? `  -  ${suffix}` : '  -  PRESS F'}`;
  }

  /** An objective built out of a shut barrier standing on the route. */
  function fromBarrier(edge) {
    const b = edge.barrier;
    const verb = CROSS_VERB[b.kind] || 'OPEN THE WAY TO';

    const base = {
      id: `barrier:${b.id}`,
      text: `${verb} ${roomName(b.to).toUpperCase()}`,
      room: b.from,
      where: roomName(b.from).toUpperCase(),
    };

    // A gated barrier quotes NO PRICE, which is doors.js's rule and the most
    // load-bearing line of copy in the interface: a price means "come back
    // richer" and a gate means "come back later", and a tracker that blurred
    // the two would send the player away to grind for something gold cannot buy.
    if (b.kind === 'power' && !power.powered) {
      return { ...base, detail: 'THE KINDLING IS COLD', cost: 0, blocked: true };
    }
    if (b.kind === 'puzzle') {
      return {
        ...base,
        detail: `${doors.state.jarsReturned} OF 4 SONS RETURNED`,
        cost: 0,
        blocked: true,
      };
    }

    return { ...base, detail: priceLine(b.cost), cost: b.cost, blocked: false };
  }

  /**
   * Turn "do X, which happens in room R" into an objective.
   *
   * If something is shut between here and R, THAT is the objective, because the
   * player cannot act on the other one yet. This one function is why there is no
   * script: the same milestone produces "clear the debris", then "open the way
   * to the Embalming Chamber", then "light the Kindling", purely because the
   * graph underneath it changed.
   *
   * Where the route is already clear the objective is unchanged and only gains a
   * PLACE. The price line is not overwritten to hold the room name: a player
   * walking to a purchase still needs to know whether they can afford it when
   * they get there, and those are two facts, so they get two lines.
   */
  function toward(room, act) {
    const from = here();
    const where = room ? roomName(room).toUpperCase() : null;
    if (!from || !room) return { ...act, where };

    const r = route(from, room);
    if (r && r.blockers.length) return fromBarrier(r.blockers[0]);

    return { ...act, where, travel: from !== room };
  }

  // ---------------------------------------------------------------------------
  // the ladder
  // ---------------------------------------------------------------------------

  /**
   * The spine of the run, in the order the map forces.
   *
   * Each rung is done() plus a next() that is only ever called when every rung
   * above it is done, so a rung may assume its own preconditions. Where the
   * preconditions are a WALK rather than a state, toward() supplies them.
   */
  const LADDER = [
    // ---- 1. the doorway -----------------------------------------------------
    {
      id: 'doorway',
      done: () => {
        const d = doors.byId('courtyard/entry');
        return !!d && (d.opened || d.opening);
      },
      next() {
        const d = doors.byId('courtyard/entry');
        return {
          id: 'doorway',
          text: 'BUY THE SEALED DOORWAY',
          detail: priceLine(d ? d.cost : 1000),
          where: 'AT THE FOOT OF THE PYRAMID',
          cost: d ? d.cost : 1000,
        };
      },
    },

    // ---- 2. through it ------------------------------------------------------
    {
      id: 'enter',
      done: () => spaces.active === 'interior' || doors.state.entered > 0,
      next: () => ({
        id: 'enter',
        text: 'ENTER THE PYRAMID',
        detail: 'THE WAY IS OPEN',
        where: 'THROUGH THE DOORWAY',
        cost: 0,
      }),
    },

    // ---- 3. something that outlasts a wave ----------------------------------
    //
    // The MK9 runs dry against a wave of six and every other weapon in the game
    // is bought. A player who never learns that a wall sells guns is a player
    // who fights wave nine with a pistol, and there is no prompt anywhere in the
    // courtyard that could have told them.
    {
      id: 'arm',
      // The B3AR is on this list because it is now the CHEAPEST answer to it and
      // the first one the player can reach: 400 gold on the avenue wall, on the
      // way to a sealed doorway that costs a thousand. A panel still reading
      // FIND A WALL GUN at somebody holding one bought off a wall is the panel
      // calling them a liar.
      done: () => weapons.owns
        && ['b3ar', 'smg', 'shotgun', 'carbine', 'lmg', 'bolt', 'sunspear'].some((w) => weapons.owns(w)),
      next() {
        const from = here();
        const options = openWallBuys(from);
        if (!options.length) {
          return {
            id: 'arm', text: 'FIND A WALL GUN', detail: 'DEEPER IN', where: null, cost: 0,
          };
        }

        const { rec } = options[0];
        const cost = (rec.config && rec.config.cost) || 0;
        return toward(rec.room, {
          id: `wallbuy:${rec.config.weapon}`,
          text: `BUY THE ${weapons.displayName(rec.config.weapon).toUpperCase()} OFF THE WALL`,
          detail: priceLine(cost),
          cost,
        });
      },
    },

    // ---- 4. the Kindling ----------------------------------------------------
    //
    // Everything from here to the end of the map is behind this one lever, and
    // it costs nothing: the price of the Kindling is the trip.
    {
      id: 'power',
      done: () => power.powered,
      next() {
        const room = kindlingSlot ? kindlingSlot.room : 'embalming-chamber';
        return toward(room, {
          id: 'kindling',
          text: 'LIGHT THE KINDLING',
          detail: 'PRESS F AT THE LEVER',
          cost: 0,
        });
      },
    },

    // ---- 5. the first boon --------------------------------------------------
    {
      id: 'boon',
      done: () => shrines.count > 0,
      next() {
        const options = openShrines(here());
        if (!options.length) {
          return {
            id: 'boon', text: 'TAKE A BOON AT A SHRINE', detail: 'NONE LEFT', where: null, cost: 0,
          };
        }

        const { rec } = options[0];
        const boon = BOONS[rec.config.boon];
        return toward(rec.room, {
          id: `shrine:${boon.id}`,
          text: `TAKE THE ${boon.name.toUpperCase()}`,
          detail: priceLine(boon.cost, boon.effect),
          cost: boon.cost,
        });
      },
    },

    // ---- 6. the Altar -------------------------------------------------------
    {
      id: 'altar',
      done: () => altar.state.upgraded > 0,
      next() {
        const room = altarSlot ? altarSlot.room : 'kings-chamber';
        const cost = altarSlot ? altar.costFor(altarSlot) : 5000;
        return toward(room, {
          id: 'altar',
          text: 'RENEW YOUR WEAPON AT THE ALTAR',
          detail: priceLine(cost),
          cost,
        });
      },
    },
  ];

  /**
   * Past the spine.
   *
   * The ladder runs out well before a long run does, and "you have finished"
   * is not a next step. So the tail names the cheapest thing still unbought,
   * measured the same way everything else is - by how many closed barriers lie
   * between the player and it - and falls through to the one instruction that is
   * always true in a round-based shooter.
   */
  function endgame() {
    const from = here();

    const shrine = openShrines(from)[0];
    const wall = openWallBuys(from)[0];
    const door = shutBarriers(from)[0];

    const candidates = [];
    if (shrine && !shrines.full) {
      candidates.push({
        weight: shrine.route.cost,
        price: BOONS[shrine.rec.config.boon].cost,
        make: () => {
          const boon = BOONS[shrine.rec.config.boon];
          return toward(shrine.rec.room, {
            id: `shrine:${boon.id}`,
            text: `TAKE THE ${boon.name.toUpperCase()}`,
            detail: priceLine(boon.cost, boon.effect),
            cost: boon.cost,
          });
        },
      });
    }
    if (wall) {
      candidates.push({
        weight: wall.route.cost,
        price: (wall.rec.config && wall.rec.config.cost) || 0,
        make: () => toward(wall.rec.room, {
          id: `wallbuy:${wall.rec.config.weapon}`,
          text: `BUY THE ${weapons.displayName(wall.rec.config.weapon).toUpperCase()} OFF THE WALL`,
          detail: priceLine((wall.rec.config && wall.rec.config.cost) || 0),
          cost: (wall.rec.config && wall.rec.config.cost) || 0,
        }),
      });
    }
    if (door) {
      candidates.push({
        weight: door.route.cost,
        price: door.rec.cost,
        make: () => fromBarrier({ barrier: door.rec }),
      });
    }

    // Another weapon through the Altar, which after the first one is 2000 and is
    // the only sink in the map that never fills.
    if (altarSlot && weapons.state.current && !weapons.isUpgraded(weapons.state.current)) {
      candidates.push({
        weight: 99,                        // last resort: it is the dearest walk
        price: altar.costFor(altarSlot),
        make: () => toward(altarSlot.room, {
          id: 'altar',
          text: `RENEW THE ${weapons.displayName(weapons.state.current).toUpperCase()}`,
          detail: priceLine(altar.costFor(altarSlot)),
          cost: altar.costFor(altarSlot),
        }),
      });
    }

    candidates.sort((a, b) => a.weight - b.weight || a.price - b.price);
    if (candidates.length) return candidates[0].make();

    return {
      id: 'survive',
      text: 'SURVIVE',
      detail: `WAVE ${director ? director.state.wave : 1}`,
      where: here() ? roomName(here()).toUpperCase() : null,
      cost: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // the answer
  // ---------------------------------------------------------------------------

  /**
   * The next meaningful step, right now.
   *
   * @returns {{id:string, text:string, detail:string, cost:number,
   *            affordable:boolean, gold:number, stage:string}}
   */
  function next() {
    let stage = 'survive';
    let out = null;

    for (const rung of LADDER) {
      if (rung.done()) continue;
      stage = rung.id;
      out = rung.next();
      break;
    }

    if (!out) out = endgame();

    const cost = out.cost || 0;
    return {
      ...out,
      stage,
      cost,
      gold: economy.gold,
      affordable: cost <= economy.gold,
      progress: cost > 0 ? Math.min(1, economy.gold / cost) : 1,
    };
  }

  return {
    next,

    /** For the harness and for anything that wants to draw the graph. */
    route,
    here,
    get ladder() { return LADDER.map((r) => r.id); },
    get stage() { return next().stage; },
  };
}

// ---------------------------------------------------------------------------
// the panel
// ---------------------------------------------------------------------------

/**
 * Paint an objective into the DOM.
 *
 * Repaints only on a CHANGE of text, because this runs every frame and setting
 * textContent on an unchanged string still dirties layout - the same guard
 * ui/prompt.js keeps for the same reason. The gold gauge is exempt: it moves on
 * every kill and is a transform, which the compositor takes off the main thread.
 */
export function createObjectivePanel(el, objectives, { hz = 20 } = {}) {
  if (!el || !objectives) return { update() {}, get text() { return ''; } };

  // The Egyptian material pass, which this panel wears the same as every other
  // plate. Idempotent, and imported from ui/hud.js rather than duplicated so
  // there is exactly one sheet on the page whoever gets constructed first.
  installLanguage(el.ownerDocument);

  const headline = el.querySelector('[data-obj-text]');
  const detail = el.querySelector('[data-obj-detail]');
  const where = el.querySelector('[data-obj-where]');
  const bar = el.querySelector('[data-obj-bar]');

  let paintedText = null;
  let paintedDetail = null;
  let paintedWhere = null;
  let paintedShort = null;
  let paintedArcane = null;
  let current = null;

  // Throttled off the CLAMPED frame delta, like the minimap. next() walks the
  // room graph once per shrine and once per wall buy, and while that is cheap
  // it allocates on every call - and this is a line of text that changes a few
  // times a minute being asked sixty times a second. Twenty a second is well
  // inside a frame of perceptible lag on a gold counter and costs a third of
  // the garbage.
  let since = Infinity;

  function update(dt = Infinity) {
    since += dt;
    if (since < 1 / hz) return current;
    since = 0;

    const step = objectives.next();
    current = step;

    if (step.text !== paintedText) {
      paintedText = step.text;
      if (headline) headline.textContent = step.text;
    }
    if (step.detail !== paintedDetail) {
      paintedDetail = step.detail;
      if (detail) detail.textContent = step.detail || '';
    }
    // Hidden rather than emptied when there is nowhere to name. An empty line
    // still takes its leading, and a panel that changes height under the
    // minimap every time the player crosses a doorway is a panel that twitches.
    const place = step.where || '';
    if (place !== paintedWhere) {
      paintedWhere = place;
      if (where) {
        where.textContent = place;
        where.hidden = !place;
      }
    }

    // A GATE GOLD CANNOT BUY IS NOT A PRICE, and the card now says so in colour
    // as well as in words.
    //
    // fromBarrier() above already draws the distinction that matters most in
    // this interface - "come back richer" quotes a figure, "come back later"
    // quotes THE KINDLING IS COLD or N OF 4 SONS RETURNED and sets `blocked` -
    // and the panel then said both of them in exactly the same gold. Blocked is
    // the arcane case, so the card takes the lapis inlay: the one cool note on a
    // gold interface, which is the pairing this palette exists for and the only
    // signal on the HUD a player can read without reading it.
    //
    // Off `step.blocked`, which is derived from the barrier's own kind, so the
    // colour cannot disagree with the copy - they are the same decision.
    const arcane = !!step.blocked;
    if (arcane !== paintedArcane) {
      paintedArcane = arcane;
      el.classList.toggle('arcane', arcane);
    }

    // The gauge is only drawn while gold IS the obstacle. A full bar under an
    // objective that has nothing to do with money is a progress bar lying about
    // what it measures.
    const short = step.cost > 0 && !step.affordable;
    if (short !== paintedShort) {
      paintedShort = short;
      el.classList.toggle('short', short);
    }
    if (bar && short) bar.style.transform = `scaleX(${step.progress.toFixed(3)})`;

    return step;
  }

  return {
    update,
    get step() { return current; },
    /** Is the card wearing the lapis inlay. For the harness. */
    get arcane() { return !!paintedArcane; },
    get text() { return paintedText || ''; },
    get detail() { return paintedDetail || ''; },
    get where() { return paintedWhere || ''; },
  };
}
