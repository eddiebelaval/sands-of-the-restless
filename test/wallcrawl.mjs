/**
 * DOES THE GOLD SCARAB ACTUALLY LEAVE THE FLOOR, DOES IT STAND UP ON WHAT IT
 * LEAVES IT FOR, AND IS THE HEIGHT IT GAINS FOR ANYTHING.
 *
 * ---------------------------------------------------------------------------
 * THE SECOND HALF OF THIS FILE IS NEWER THAN THE FIRST AND IT IS WHY THE FIRST
 * HALF WAS NOT ENOUGH
 * ---------------------------------------------------------------------------
 *
 * Everything below the swarm section passed for the whole life of the wall
 * crawl, and the owner still had nothing to answer. The checks proved a body
 * got onto stone, oriented to it, and came back down; none of them asked what
 * the climb BOUGHT. It bought a route: the wall led to a ceiling and the ceiling
 * led to a point over the player's head. Measured, the crawler spent 28 per cent
 * of its life off the floor and the wall leg was pure transit.
 *
 * The owner's design: "what if they run up the walls and jump at me? So they're
 * basically trying to get a good height so that they can jump on top of me."
 *
 * So there is now a LEAP, and it gets its own four claims, each of which fails
 * on its own and none of which is satisfiable by a body that simply fell:
 *
 *   5. IT LEAPS, and the mechanism was armed. `crawl.leaps` counts launches,
 *      the surface enum reaches SURF_LEAP, and the arc's APEX IS ABOVE THE
 *      POINT IT LEFT THE WALL. That last one is the whole difference between a
 *      pounce and losing your grip, and it is the claim a build where the leap
 *      silently did nothing would fail.
 *   6. IT IS READABLE. The coil is a dead stop, so it is measured as one: the
 *      body's position must not move by more than a centimetre across the whole
 *      tell, and the tell plus the flight must add up to about 1.3 s.
 *   7. IT IS SURVIVABLE, AND THIS IS A PAIRED RUN RATHER THAN AN OPINION. The
 *      identical scenario is played twice. In the first the player is pinned and
 *      the leap has to arrive on them. In the second the player steps sideways
 *      at their own walk speed FROM THE FRAME THE COIL OPENS, and the leap has
 *      to miss. One run alone proves nothing: a leap that always lands on you
 *      passes the first, and a leap that always misses passes the second.
 *   8. IT IS NOT A CEILING AMBUSH. Every launch is recorded with the surface it
 *      left from, and none of them may be the roof; and the launch height above
 *      the player's own floor is bounded, so a 16 m gallery does not produce a
 *      dive nobody can see the start of.
 *
 * ---------------------------------------------------------------------------
 *
 * THE CONTROL IS THE POINT OF THIS FILE, and it is written that way because
 * this project has now shipped three green harnesses through the defect they
 * were written for. The identical run is played twice, in the same process, on
 * the same tile of the same room: once with `goldscarab` and once with the
 * ordinary `scarab`, which is the enemy this feature was deliberately NOT given.
 * If the control also leaves the ground plane then the thing being measured is
 * a ramp, or a ledge, or a body being launched by the collision resolver, and
 * not a wall crawl - and the check would then pass forever whether or not
 * enemies/wallcrawl.js existed at all.
 *
 * Four claims, and each of them can fail on its own:
 *
 *   1. it gets off the floor. Measured as height above `ctx.heightAt` under its
 *      own feet, so a room with a raised floor cannot fake it.
 *   2. it ORIENTS. The body's own up-axis is pulled out of the group quaternion
 *      every frame; on a wall it has to lie down flat (up.y near 0) and on a
 *      ceiling it has to invert (up.y near -1). A beetle whose feet still point
 *      at the floor while it slides up stone is the exact failure this is for.
 *   3. it still arrives. A crawler that spends the round on the ceiling is a
 *      round that does not end.
 *   4. the crit survives. The whole gold scarab design is that its one soft
 *      panel is the vent on the back of the abdomen, and a change that moved a
 *      `userData.region` would break it silently: the hitscan would go on
 *      working and simply never pay 100 again.
 *
 * THE ROOM IS THE HALL OF OFFERINGS, base 0 and a 9 m ceiling, with the player
 * pinned in its north half well clear of the column row at z -153.5. The north
 * wall carries no doorway, so the box the crawler mounts runs floor to ceiling
 * and its top is a real ceiling rather than the breast under a sill - which is
 * the distinction topsOut() in wallcrawl.js exists to make.
 */

import { chromium } from 'playwright';
import { resolveChrome, dismissBriefing } from './chrome.mjs';

const BASE = process.argv[2] || process.env.SANDS_URL || 'http://127.0.0.1:4191/index.html';

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__SANDS__, null, { timeout: 60000 });
await page.evaluate(() => window.__SANDS__.start && window.__SANDS__.start());
/**
 * THE BOOT CONTRACT. `__SANDS__.start()` finishes the briefing card itself, but
 * this call is what keeps the file correct if that seam ever moves: on
 * 2026-08-08 a card landed in front of the world and main.js's frame loop began
 * returning early while it was up, and three lanes spent a night reporting
 * confident, specific, fictional bugs about a simulation that had never
 * started. dismissBriefing is deliberately tolerant of a page with no briefing.
 */
await dismissBriefing(page);
await page.waitForFunction(() => window.__SANDS__.frameNo > 3, null, { timeout: 120000 });

const out = await page.evaluate(async () => {
  const g = window.__SANDS__;

  const SECONDS = 45;
  const dt = 1 / 60;
  /**
   * The player's own walk speed, in m/s.
   *
   * Not a number this file gets to choose: it is what player/controller.js
   * moves at, and the dodge is only evidence of survivability if the thing
   * doing the dodging moves the way a player does.
   */
  const WALK = 5.4;

  /** The crawl's surface enum, spelled out for the trace. */
  const NAME = ['floor', 'wall', 'ceiling', 'air'];

  /**
   * TWO ROOMS, AND THE SECOND ONE IS NOT A NICETY.
   *
   * The leap took the Hall of Offerings' ceiling leg away, and correctly: with
   * the player eight metres out, the launch window opens at 4.2 m and the lip
   * is at 8.5, so a crawler now dives before it ever gets there. That turned two
   * of this file's shipped checks red - "reaches the ceiling" and "on the
   * ceiling it inverts" - and the tempting fix was to relax them.
   *
   * Relaxing them would have deleted a shipped feature and closed the only
   * instrument that could have noticed. The ceiling crawl is still the fallback
   * for a player the leap window does not cover, so the checks move to a room
   * where that is the case rather than being weakened where it is not.
   *
   * THE GREAT GALLERY IS THAT ROOM BY ARITHMETIC. It is 52 x 38, so a player at
   * its centre is 19 m from the nearest wall face and 26 from the far ones -
   * outside LEAP_MAX_R's 9 from every climbable surface in the room. A crawler
   * there cannot arm a dive, so it does what it always did: over the lip at
   * 15.5 m, across the roof, and down.
   */
  const ROOMS = {
    // `pen` is the room's own bounds from world/rooms.js with two metres taken
    // off every side. A dodging player who walked into a wall would be standing
    // still, and a stationary player is the OTHER run.
    hall: {
      player: { x: -45, z: -144 }, start: { x: -34, z: -145 },
      at: { x: -45, z: -144, rot: 0 },
      pen: { minX: -54, maxX: -20, minZ: -156, maxZ: -142 },
    },
    gallery: {
      player: { x: 0, z: -177 }, start: { x: -18, z: -190 },
      at: { x: 0, z: -177, rot: 0 },
      pen: { minX: -24, maxX: 24, minZ: -194, maxZ: -160 },
    },
  };

  if (!g.director.placeAt) return { fatal: 'director.placeAt not available' };

  function openEverything() {
    for (const d of g.doors.all) {
      if (d.open) d.open();
      for (let i = 0; i < 400 && !d.opened; i++) if (d.advance) d.advance(1 / 30);
    }
  }

  /**
   * The body's own up-axis, in world space, straight out of the group
   * quaternion.
   *
   * This is the second column of the rotation matrix and it is written out
   * rather than taken from three, because the claim being tested is about what
   * is ON THE SCENE GRAPH: reading it back through the same library call the
   * renderer uses is the closest a harness gets to reading the pixels.
   */
  function upAxis(q) {
    const { x, y, z, w } = q;
    return {
      x: 2 * (x * y - w * z),
      y: 1 - 2 * (x * x + z * z),
      z: 2 * (y * z + w * x),
    };
  }

  /**
   * One variant, one placement, one player.
   *
   * `dodge` is the paired half of claim 7. False pins the player exactly where
   * they started, so every metre closed is the crawler's own doing. True pins
   * them the same way until the instant the coil opens and then walks them
   * sideways at WALK m/s - the player's real speed, out of the same tables the
   * controller uses - perpendicular to the line the crawler is about to throw
   * itself down. Nothing else differs between the two runs.
   */
  async function run(id, dodge = false, roomId = 'hall') {
    const R = ROOMS[roomId];
    const PLAYER = R.player;
    const START = R.start;

    g.director.reset();
    g.spaces.enter('interior', R.at);
    openEverything();
    await new Promise((r) => requestAnimationFrame(r));

    // No wave may begin during the run. An extra half-dozen shamblers would
    // body-block the approach and turn this into a measurement of separation.
    g.director.state.timer = 1e9;

    g.player.position.x = PLAYER.x;
    g.player.position.z = PLAYER.z;

    const actor = g.director.placeAt(id, START.x, START.z);
    if (!actor) return { fatal: `could not place a ${id}` };

    const ctx = g.director.ctx;
    let clock = 0;
    let maxAbove = 0;
    let framesOff = 0;
    let minUpY = 1;
    let wallUpAbs = 0;      // worst |up.y| while genuinely settled on a wall
    let wallFrames = 0;
    let roofUpY = 1;        // worst (least inverted) up.y while on a ceiling
    let roofFrames = 0;
    let closest = Math.hypot(START.x - PLAYER.x, START.z - PLAYER.z);
    let surfMax = 0;
    let peakUpY = 1;
    let mountedAt = -1;
    const trace = [];
    let lastKey = '';

    // --- the leap ----------------------------------------------------------
    /** Where the player is this frame. Written by the dodge, read by the pin. */
    let plx = PLAYER.x, plz = PLAYER.z;
    let dodging = false;
    let dodgeX = 0, dodgeZ = 0;

    let coilFrames = 0;
    let coilDrift = 0;          // metres the body moved during the whole tell
    let coilAnchor = null;
    let lastLeaps = 0;
    let leapFrames = 0;
    /** One record per launch, closed out when the body lands. */
    const leaps = [];
    let open = null;
    let prevSurf = 0;

    const frames = Math.round(SECONDS / dt);
    for (let i = 0; i < frames; i++) {
      clock += dt;
      g.player.position.x = plx;
      g.player.position.z = plz;
      g.director.update(dt, clock);
      if (!actor.live) break;

      const p = actor.position;
      const floor = ctx.heightAt ? ctx.heightAt(p.x, p.z, 0) : 0;
      const above = p.y - floor;
      const up = upAxis(actor.group.quaternion);
      const c = actor.crawl;

      if (above > maxAbove) { maxAbove = above; peakUpY = up.y; }
      if (above > 0.6) framesOff++;
      if (up.y < minUpY) minUpY = up.y;

      if (c && c.transit <= 0) {
        if (c.surf === 1) { wallFrames++; wallUpAbs = Math.max(wallUpAbs, Math.abs(up.y)); }
        if (c.surf === 2) { roofFrames++; roofUpY = Math.min(roofUpY, up.y); }
        if (c.surf === 3) leapFrames++;
        if (c.surf > surfMax) { surfMax = c.surf; if (mountedAt < 0) mountedAt = clock; }
      }

      if (c) {
        // --- the tell -------------------------------------------------------
        // Measured as a DEAD STOP, which is the claim: a coil that crept would
        // be a wind-up the player cannot read as one.
        if (c.coil > 0) {
          coilFrames++;
          if (!coilAnchor) {
            coilAnchor = { x: p.x, y: p.y, z: p.z, at: clock, surf: prevSurf };
            // The dodge starts HERE, on the frame the tell opens - the first
            // moment a player could possibly have known.
            if (dodge && !dodging) {
              dodging = true;
              const dx = plx - p.x, dz = plz - p.z;
              const l = Math.hypot(dx, dz) || 1;
              // Perpendicular to the line of the throw, so the player stays the
              // same distance away and the leap window cannot close for a
              // reason other than the dodge itself.
              dodgeX = -dz / l; dodgeZ = dx / l;
            }
          } else {
            coilDrift = Math.max(coilDrift,
              Math.hypot(p.x - coilAnchor.x, p.y - coilAnchor.y, p.z - coilAnchor.z));
          }
        }

        // --- a launch -------------------------------------------------------
        if (c.leaps > lastLeaps) {
          lastLeaps = c.leaps;
          open = {
            at: +clock.toFixed(2),
            from: coilAnchor ? coilAnchor.surf : prevSurf,
            coil: coilAnchor ? +(clock - coilAnchor.at).toFixed(2) : 0,
            coilDrift: +coilDrift.toFixed(3),
            launchY: +c.launchY.toFixed(2),
            launchR: +c.launchR.toFixed(2),
            y0: p.y,
            apex: p.y,
            playerAt: { x: plx, z: plz },
          };
          coilAnchor = null;
          coilDrift = 0;
        }

        if (open) {
          if (p.y > open.apex) open.apex = p.y;
          if (c.surf !== 3) {
            // Landed. The miss distance is measured against where the player is
            // NOW, which for the dodge run is not where they were aimed at.
            open.flight = +(clock - open.at).toFixed(2);
            open.rise = +(open.apex - open.y0).toFixed(2);
            open.landed = +Math.hypot(p.x - plx, p.z - plz).toFixed(2);
            open.landedAtAim = +Math.hypot(p.x - open.playerAt.x, p.z - open.playerAt.z).toFixed(2);
            delete open.y0; delete open.apex; delete open.playerAt;
            leaps.push(open);
            open = null;
            dodging = false;
          }
        }

        prevSurf = c.transit > 0 ? prevSurf : c.surf;
      }

      if (dodging) {
        plx += dodgeX * WALK * dt;
        plz += dodgeZ * WALK * dt;
        plx = Math.min(R.pen.maxX, Math.max(R.pen.minX, plx));
        plz = Math.min(R.pen.maxZ, Math.max(R.pen.minZ, plz));
      }

      const d = Math.hypot(p.x - plx, p.z - plz);
      if (d < closest) closest = d;

      /**
       * The route it actually took, one line per change of surface.
       *
       * Recorded rather than summarised, because a pass on "it reached the
       * ceiling" cannot tell a body that climbed there from a body the
       * collision resolver launched there. These timestamps are the arithmetic
       * in wallcrawl.js checked against the simulation: a climb runs at
       * WALL_MUL x 3.9 = 2.42 m of surface a second, and the gap between the
       * mount and the lip either agrees with the distance covered or it does
       * not.
       */
      if (c) {
        const key = c.coil > 0 ? 'coiled to leap'
          : c.transit > 0 ? `turning onto the ${NAME[c.surf]}` : `on the ${NAME[c.surf]}`;
        if (key !== lastKey) {
          lastKey = key;
          trace.push(`${clock.toFixed(2).padStart(6)} s  ${key.padEnd(26)}`
            + `at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`
            + `   ${d.toFixed(1)} m from the player`);
        }
      }
    }

    const rig = actor.rig;
    const neckHeads = rig.neck
      ? rig.neck.children.filter((m) => m.isMesh && m.userData.region === 'head').length
      : -1;
    const heads = rig.meshes.filter((m) => m.userData.region === 'head').length;

    return {
      id,
      dodge,
      maxAbove: +maxAbove.toFixed(2),
      secondsOff: +(framesOff * dt).toFixed(2),
      minUpY: +minUpY.toFixed(3),
      peakUpY: +peakUpY.toFixed(3),
      wallFrames,
      wallUpAbs: +wallUpAbs.toFixed(3),
      roofFrames,
      roofUpY: +roofUpY.toFixed(3),
      leapFrames,
      leaps,
      coilFrames,
      coilSeconds: +(coilFrames * dt).toFixed(2),
      surfMax,
      mountedAt: mountedAt < 0 ? null : +mountedAt.toFixed(2),
      closest: +closest.toFixed(2),
      trace,
      hasCrawl: !!actor.crawl,
      vent: rig.vent ? rig.vent.userData.region : null,
      heads,
      neckHeads,
    };
  }

  /**
   * DOES THE ROUND STILL END.
   *
   * The one way this feature could be a net loss is an enemy that lives out of
   * reach: a body that spends the wave on a ceiling is a wave that never
   * concludes, which is the same failure the wedge escape and DETOUR_S's
   * forceSide were both written against, arriving by a new road. Six of them at
   * once in the biggest room on the map - the Great Gallery, 52 x 38 with a 16 m
   * ceiling and two colonnades - is the worst case the map has: the longest
   * climbs, the most stone to be boxed in behind, and every one of them running
   * the wall search on the same wall list in the same frame.
   *
   * IT EARNED ITS PLACE ON THE FIRST RUN. The point (0, -192) drops a body onto
   * the gallery's upper ledge at y 6, and from up there the wall search picked
   * the head slab over a doorway - a box whose base is BELOW the ledge, so it
   * passed every filter - walked at a part of it the ledge does not reach, timed
   * out, and picked the same slab again. That crawler spent the entire 45 s at
   * surface 0 and never got within 13.55 m. See FAIL_GIVEUP in wallcrawl.js for
   * the fix; this paragraph is here so the next person to loosen that cooldown
   * knows what it is holding shut.
   *
   * AND THE BAR IS A COMPARISON, NOT AN ABSOLUTE. The same six points are played
   * twice, gold and ordinary, and the clutch that can leave the floor has to
   * arrive at least as often as the clutch that cannot. The first instinct on
   * seeing one body fail was that the ledge is a second storey and enemies/
   * flow.js only ever floods one - which is true, it says so in its own header,
   * and it was NOT the cause: the control scarab from that identical point
   * arrived at 1.8 m. A control is the difference between fixing this and
   * filing it against the flow field.
   */
  /**
   * SIX AT ONCE, AND THE SECOND ROOM IS ABOUT THE LEAP RATHER THAN THE ROUND.
   *
   * The gallery run above answers "does the round end". It cannot answer the
   * question the leap raises, because a player standing at the gallery's centre
   * is outside LEAP_MAX_R of every wall in it and no dive is ever armed there.
   *
   * The Hall of Offerings is 38 x 18: a player in it is inside the window of
   * the long walls almost everywhere. Six crawlers in that room is the
   * realistic worst case for the new move, and the failure it is watching for is
   * not "does one leap work" - that is answered above - it is CONCURRENCY. Six
   * readable dives that all land in the same 1.3 s are one unreadable dive, and
   * a tell nobody can act on is the same as no tell.
   */
  async function swarm(id, roomId = 'gallery') {
    const R = ROOMS[roomId];
    const P = R.player;

    g.director.reset();
    g.spaces.enter('interior', R.at);
    openEverything();
    await new Promise((r) => requestAnimationFrame(r));
    g.director.state.timer = 1e9;

    g.player.position.x = P.x;
    g.player.position.z = P.z;

    const at = roomId === 'gallery'
      ? [{ x: -18, z: -190 }, { x: 18, z: -190 }, { x: -18, z: -164 },
        { x: 18, z: -164 }, { x: 0, z: -192 }, { x: 0, z: -163 }]
      // Spread down the Hall's long axis and across its width, all of them
      // outside MOUNT_MIN_M so every one of them is free to go for a wall.
      : [{ x: -33, z: -145 }, { x: -33, z: -152 }, { x: -55, z: -145 },
        { x: -55, z: -152 }, { x: -44, z: -155 }, { x: -46, z: -142 }];

    const crew = [];
    for (const p of at) {
      const a = g.director.placeAt(id, p.x, p.z);
      if (a) crew.push({ a, closest: Infinity, off: 0, leaps: 0, last: 0 });
    }
    if (crew.length < at.length) return { fatal: `only placed ${crew.length} of ${at.length}` };

    const ctx = g.director.ctx;
    const frames = Math.round(SECONDS / dt);
    let clock = 0;
    let peakAir = 0;        // most bodies in the air on any one frame
    let peakTell = 0;       // most bodies coiled on any one frame
    const landings = [];    // the clock at every touchdown, for the spacing check

    for (let i = 0; i < frames; i++) {
      clock += dt;
      g.player.position.x = P.x;
      g.player.position.z = P.z;
      g.director.update(dt, clock);
      let air = 0, tell = 0;
      for (const c of crew) {
        if (!c.a.live) continue;
        const p = c.a.position;
        const floor = ctx.heightAt ? ctx.heightAt(p.x, p.z, p.y) : 0;
        if (p.y - floor > 0.6) c.off++;
        const d = Math.hypot(p.x - P.x, p.z - P.z);
        if (d < c.closest) c.closest = d;

        const cr = c.a.crawl;
        if (cr) {
          if (cr.surf === 3) air++;
          if (cr.coil > 0) tell++;
          if (cr.leaps > c.leaps) c.leaps = cr.leaps;
          if (cr.surf !== 3 && c.last === 3) landings.push(+clock.toFixed(2));
          c.last = cr.surf;
        }
      }
      if (air > peakAir) peakAir = air;
      if (tell > peakTell) peakTell = tell;
    }

    // The tightest gap between two touchdowns anywhere in the run. This is the
    // number that says whether six dives arrived as six events or as one.
    let tightest = Infinity;
    landings.sort((a, b) => a - b);
    for (let i = 1; i < landings.length; i++) {
      tightest = Math.min(tightest, +(landings[i] - landings[i - 1]).toFixed(2));
    }

    return {
      id,
      room: roomId,
      n: crew.length,
      closest: crew.map((c) => +c.closest.toFixed(2)),
      offPct: crew.map((c) => Math.round((c.off / frames) * 100)),
      arrived: crew.filter((c) => c.closest < 2.5).length,
      climbed: crew.filter((c) => c.off > 0).length,
      leapt: crew.filter((c) => c.leaps > 0).length,
      leapTotal: crew.reduce((s, c) => s + c.leaps, 0),
      peakAir,
      peakTell,
      landings,
      tightest: landings.length > 1 ? tightest : null,
    };
  }

  const gold = await run('goldscarab');
  const plain = await run('scarab');
  // The paired half of claim 7. Same seed, same tile, same everything - the
  // only difference is that this player walks when the tell opens.
  const dodged = await run('goldscarab', true);
  // The ceiling leg, in the one room on the map where a dive cannot be armed.
  const roof = await run('goldscarab', false, 'gallery');
  const sixGold = await swarm('goldscarab');
  const sixPlain = await swarm('scarab');
  // The concurrency question, in the room where dives actually arm.
  const sixHall = await swarm('goldscarab', 'hall');
  return { gold, plain, dodged, roof, sixGold, sixPlain, sixHall };
});

if (out.fatal) { console.log(`FATAL  ${out.fatal}`); await browser.close(); process.exit(1); }
for (const r of [out.gold, out.plain, out.dodged, out.roof, out.sixGold, out.sixPlain, out.sixHall]) {
  if (r && r.fatal) { console.log(`FATAL  ${r.fatal}`); await browser.close(); process.exit(1); }
}

const G = out.gold, P = out.plain, D = out.dodged, RF = out.roof;
const S = out.sixGold, SP = out.sixPlain, SH = out.sixHall;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

console.log('the Hall of Offerings, 45 simulated seconds, player pinned at (-45, -144):');
const show = (r, label) => {
  console.log(`  ${label.padEnd(20)}peak ${String(r.maxAbove).padStart(6)} m above the floor`
    + `   off-floor ${String(r.secondsOff).padStart(6)} s`
    + `   min up.y ${String(r.minUpY).padStart(7)}`
    + `   closest ${String(r.closest).padStart(6)} m`);
  console.log(`  ${''.padEnd(20)}wall ${String(r.wallFrames).padStart(5)} frames (worst |up.y| ${r.wallUpAbs})`
    + `   roof ${String(r.roofFrames).padStart(5)} frames (worst up.y ${r.roofUpY})`
    + `   first mount ${r.mountedAt === null ? '  never' : `${r.mountedAt} s`}`);
};
show(G, 'goldscarab');
show(P, 'CONTROL scarab');

console.log('\nthe gold scarab\'s route, one line per change of surface:');
for (const t of G.trace) console.log(`  ${t}`);
console.log(`\nthe control has no surface state to trace: actor.crawl is ${P.hasCrawl ? 'ALLOCATED' : 'null'}.`);
console.log('');

// 1. it leaves the floor, and the control does not.
ok(G.maxAbove > 3, `the gold scarab climbs (peak ${G.maxAbove} m above its own floor)`);
ok(G.surfMax >= 2, `and gets past the wall onto something (deepest surface ${G.surfMax})`);
ok(G.secondsOff > 3, `and stays up there long enough to be seen (${G.secondsOff} s off the floor)`);

// THE CONTROL. If this passes, nothing above is measuring a wall crawl.
ok(P.maxAbove < 0.6, `CONTROL: the ordinary scarab never leaves the floor (peak ${P.maxAbove} m)`);
ok(P.secondsOff === 0, `CONTROL: not for a single frame (${P.secondsOff} s)`);
ok(P.minUpY > 0.99, `CONTROL: and never tips off its own up-axis (min up.y ${P.minUpY})`);
ok(!P.hasCrawl, 'CONTROL: it is not even given the state to do it (actor.crawl is null)');
ok(G.hasCrawl, 'and the gold scarab is (actor.crawl is allocated)');

// 2. the body orients to the surface rather than staying +Y.
ok(G.wallFrames > 30 && G.wallUpAbs < 0.2,
  `on a wall its up-axis lies flat with the normal (worst |up.y| ${G.wallUpAbs} over ${G.wallFrames} frames)`);
ok(G.minUpY < -0.9, `so the up-axis genuinely tracks the surface, it does not stay +Y (min ${G.minUpY})`);

/**
 * THE CEILING LEG IS STILL THERE, and it is checked in the Great Gallery
 * because it cannot be checked in the Hall any more.
 *
 * These two assertions used to run against the Hall run and went red the moment
 * the leap landed - not because the ceiling crawl broke, but because a crawler
 * in that room now dives at 4.2 m instead of climbing to 8.5. Weakening them
 * where they stood would have retired the only check that can see a ceiling
 * crawl regress. See ROOMS above for why the gallery's centre is the room that
 * still produces one.
 */
console.log('');
console.log('the Great Gallery, 45 s, player pinned at its centre (0, -177) - '
  + '19 m from the nearest wall, so no dive can be armed:');
show(RF, 'goldscarab');
console.log('\nits route:');
for (const t of RF.trace) console.log(`  ${t}`);
console.log('');

ok(RF.surfMax === 2,
  `out there it still takes the CEILING instead (deepest surface ${RF.surfMax}, 2 = roof)`);
ok(RF.roofFrames > 30 && RF.roofUpY < -0.9,
  `and it inverts on it (worst up.y ${RF.roofUpY} over ${RF.roofFrames} frames)`);
ok(RF.leaps.length === 0,
  `and it does NOT leap from out there (${RF.leaps.length} launches at 19 m, `
  + `against LEAP_MAX_R of 9)`);
ok(RF.closest < 2.5, `and it still arrives (closest ${RF.closest} m)`);

// 3. it still gets to the player.
ok(G.closest < 2.5, `and it still arrives (closest ${G.closest} m)`);
ok(P.closest < 2.5, `CONTROL: so does the ordinary scarab (closest ${P.closest} m)`);

// 4. the crit surface survived the change.
ok(G.vent === 'head', `the vent is still tagged a crit (region ${G.vent})`);
ok(G.heads === 2, `and only the abdomen and the vent are (${G.heads} crit meshes)`);
ok(G.neckHeads === 0, `the skull is still NOT a crit (${G.neckHeads} crit meshes on the neck)`);

// ---------------------------------------------------------------------------
// THE LEAP
// ---------------------------------------------------------------------------

const SURF = ['floor', 'wall', 'ceiling', 'air'];
const showLeaps = (r, label) => {
  console.log(`  ${label}`);
  if (!r.leaps.length) { console.log('    none'); return; }
  for (const L of r.leaps) {
    console.log(`    ${String(L.at).padStart(6)} s  launched off the ${SURF[L.from].padEnd(8)}`
      + `from ${String(L.launchY).padStart(5)} m up, ${String(L.launchR).padStart(5)} m out`
      + `   tell ${String(L.coil).padStart(5)} s (drifted ${L.coilDrift} m)`
      + `   flight ${String(L.flight).padStart(5)} s  rose ${String(L.rise).padStart(5)} m`
      + `   landed ${String(L.landed).padStart(5)} m from the player`);
  }
};

console.log('');
console.log('the leap:');
showLeaps(G, 'PINNED player, the same run as above');
showLeaps(D, 'DODGING player, identical scenario, walks at 5.4 m/s from the frame the tell opens');
console.log('');

const gl = G.leaps;
const dl = D.leaps;
const first = gl[0];

// 5. it leaps, and it threw itself rather than fell.
ok(gl.length > 0, `it leaps (${gl.length} launch${gl.length === 1 ? '' : 'es'} in ${45} s)`);
ok(G.surfMax >= 3, `and the surface enum reaches the air (deepest ${G.surfMax}, 3 = leap)`);
ok(G.leapFrames > 20, `and it is genuinely airborne (${G.leapFrames} frames in flight)`);
if (first) {
  ok(first.rise > 0.15,
    `THE ARC RISES: it left the wall travelling upward and peaked ${first.rise} m above the launch `
    + `point, which a body that fell cannot do`);
  ok(first.flight >= 0.6 && first.flight <= 1.6,
    `and the flight is a beat rather than an event (${first.flight} s)`);
}

// 6. it is readable.
if (first) {
  ok(first.coil >= 0.35 && first.coil <= 0.7,
    `the tell runs its full length before anything commits (${first.coil} s)`);
  ok(first.coilDrift < 0.01,
    `and it is a DEAD STOP, not a slow wind-up (${first.coilDrift} m of drift across the whole tell)`);
  ok(first.coil + first.flight >= 1.0,
    `so the whole move is ${(first.coil + first.flight).toFixed(2)} s from the first sign to impact`);
}

// 7. SURVIVABLE. The paired run is the claim; neither half means anything alone.
ok(dl.length > 0, `CONTROL: the dodging run also produced a leap to dodge (${dl.length})`);
if (first && dl.length) {
  const dodgedL = dl[0];
  ok(first.landed < 2.5,
    `a pinned player is landed on (${first.landed} m from the body at touchdown)`);
  ok(dodgedL.landed > first.landed + 1.5,
    `CONTROL: a player who walks when the tell opens is not `
    + `(${dodgedL.landed} m against the pinned run's ${first.landed} m)`);
  ok(dodgedL.landedAtAim < 2.5,
    `and it landed where they WERE, which is the proof it never tracked them `
    + `(${dodgedL.landedAtAim} m from the aim point)`);
}

// 8. not a ceiling ambush.
ok(gl.every((L) => L.from === 1) && dl.every((L) => L.from === 1),
  `every launch came off a WALL, never the roof `
  + `(${[...gl, ...dl].map((L) => SURF[L.from]).join(', ') || 'none'})`);
ok([...gl, ...dl].every((L) => L.launchY <= 5.0),
  `and none of them dived from out of sight (highest launch `
  + `${Math.max(0, ...[...gl, ...dl].map((L) => L.launchY))} m above the player's floor)`);
ok([...gl, ...dl].every((L) => L.launchR >= 3.0 && L.launchR <= 9.5),
  `every arc was lateral enough to cross the player's view `
  + `(ranges ${[...gl, ...dl].map((L) => L.launchR).join(', ') || 'none'})`);

// THE CONTROL FOR THE WHOLE OF IT.
ok(P.leaps.length === 0 && P.leapFrames === 0,
  `CONTROL: the ordinary scarab never leaps (${P.leaps.length} launches, ${P.leapFrames} air frames)`);

console.log('');
console.log('the same six points in the Great Gallery, 45 s, player pinned at (0, -177):');
const clutch = (r, label) => {
  console.log(`  ${label.padEnd(18)}closest ${r.closest.map((v) => String(v).padStart(6)).join(' ')}  m`);
  console.log(`  ${''.padEnd(18)}off-floor ${r.offPct.map((v) => String(v).padStart(4)).join(' ')}  % of the run`);
  console.log(`  ${''.padEnd(18)}${r.arrived} of ${r.n} arrived, ${r.climbed} left the floor`);
};
clutch(S, 'goldscarab x6');
clutch(SP, 'CONTROL scarab x6');
console.log('');

ok(S.climbed >= 4, `most of a clutch gets off the floor (${S.climbed} of ${S.n} did)`);
ok(SP.climbed === 0, `CONTROL: none of the ordinary clutch does (${SP.climbed} of ${SP.n})`);
// The comparison, not an absolute. See the note on swarm().
ok(S.arrived >= SP.arrived,
  `climbing costs the clutch no arrivals (${S.arrived} of ${S.n} against the control's ${SP.arrived})`);
ok(Math.max(...S.offPct) < 70,
  `and none of them lives up there (worst spends ${Math.max(...S.offPct)}% of the run off the floor)`);
ok(S.leapTotal === 0,
  `CONTROL: nothing dives from the gallery's centre, so nothing above is a leap `
  + `in disguise (${S.leapTotal} launches)`);

// ---------------------------------------------------------------------------
// SIX AT ONCE, IN THE ROOM WHERE DIVES ARM
// ---------------------------------------------------------------------------

console.log('');
console.log('six gold scarabs in the Hall of Offerings, 45 s, player pinned at (-45, -144):');
clutch(SH, 'goldscarab x6');
console.log(`  ${''.padEnd(18)}${SH.leapt} of ${SH.n} leapt, ${SH.leapTotal} launches in total`);
console.log(`  ${''.padEnd(18)}most in the air at once ${SH.peakAir}, most coiled at once ${SH.peakTell}`);
console.log(`  ${''.padEnd(18)}touchdowns at ${SH.landings.join(', ') || 'none'} s`
  + `   tightest gap ${SH.tightest === null ? 'n/a' : `${SH.tightest} s`}`);
console.log('');

ok(SH.leapTotal > 0,
  `a realistic clutch does use the move (${SH.leapTotal} launches from ${SH.leapt} of ${SH.n} bodies)`);
ok(SH.arrived >= 4, `and it still arrives (${SH.arrived} of ${SH.n})`);
/**
 * THE CONCURRENCY BAR, and it is the one that decides whether this is a
 * readable move or an ambush wearing one.
 *
 * Not "how many leapt" - six leaps spread over forty-five seconds is a good
 * fight. The number that matters is how many are in the air on the SAME frame,
 * because the tell is 0.45 s long and a player cannot answer two of them.
 */
ok(SH.peakAir <= 2,
  `and never more than ${SH.peakAir} of them is in the air on one frame, so the tell stays answerable`);
ok(SH.peakTell <= 2,
  `nor more than ${SH.peakTell} coiled at once (${SH.peakTell} is the most simultaneous tells)`);

ok(errors.length === 0, 'no console errors');
if (errors.length) for (const e of errors.slice(0, 5)) console.log(`  err ${e}`);

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
