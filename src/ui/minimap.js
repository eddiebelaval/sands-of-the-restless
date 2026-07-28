/**
 * THE MINIMAP: a floorplan, not an overhead slice.
 *
 * WHY A SCHEMATIC, and it is a real choice with a real cost either way.
 *
 * A true top-down render of this map would be nine stone rectangles of almost
 * identical value, seen from above, with the props that distinguish them - a
 * sarcophagus, a colonnade, a chest - reduced to sub-pixel smudges at any size a
 * minimap can be. Everything that makes the Great Gallery legible IN the Great
 * Gallery is height, firelight, and a two-level ledge, and all three of those
 * are exactly what an orthographic slice throws away. It would be expensive, it
 * would need its own camera and render target, and the picture at the end of it
 * would be a grey grid.
 *
 * The question the player is actually asking is a graph question - which box am
 * I in, what is next door, what does it cost to get there, and is anything in it
 * worth the walk - and the graph is already authored, in world/rooms.js, as
 * axis-aligned rectangles with portals on their shared wall lines.
 *
 * So this draws THE GRAPH, at true scale and true bearing. Rooms are their real
 * footprints, in their real positions, so the map is a compass as well as a
 * diagram: north on the panel is north in the world and a player can walk by it.
 * What is thrown away is only the stone - walls, props, the ledge - none of
 * which the player navigates by. What is added is everything a slice cannot
 * show: what a shut doorway costs, which shrine is which colour, that the chest
 * has three homes and is only in one of them.
 *
 * It is a canvas rather than DOM because a minimap is forty to sixty small
 * shapes redrawn as things move, which is one draw call's worth of 2D context
 * work and would be sixty layout-dirtying elements as DOM.
 *
 * NOTHING HERE MUTATES ANYTHING. It reads the room graph, the barrier records,
 * the fixture records, the power state, the shrine set, the mystery box and the
 * live actor list, and paints. Same contract ui/objective.js keeps.
 */

import { INTERIOR_BOUNDS } from '../world/rooms.js';
import { BOON_LOOK } from '../world/build.js';

/** Repaints per second. The contacts move; the architecture does not. */
const HZ = 15;

const INK = '#0a0704';
const GOLD = '#d9b26a';
const GOLD_DIM = '#8a6f3e';
const BONE = '#e8dcc4';
const BLOOD = '#e0563c';
const LAPIS = '#6f93d6';

/** Padding inside the canvas, in device-independent pixels. */
const PAD = 9;

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** A packed 0xRRGGBB as an rgba() string at a given alpha. */
function tint(n, alpha) {
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function createMinimap({
  canvas, roomLabel, spaces, interior, doors, interacts, shrines,
  mysterybox, power, economy, director, rig, player,
}) {
  if (!canvas) return { update() {}, paint() {}, get state() { return null; } };

  const ctx = canvas.getContext('2d');

  // The canvas is sized in CSS pixels by the stylesheet and in DEVICE pixels
  // here. Without the second one the map is drawn at a third of the resolution
  // it is displayed at, which on 8px numerals is the difference between a price
  // and a smudge.
  let dpr = 1;
  let W = 0;
  let H = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const next = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.round(rect.width) || canvas.width;
    const h = Math.round(rect.height) || canvas.height;
    if (dpr === next && W === w && H === h) return;

    dpr = next; W = w; H = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------------------------------------------------------------------------
  // the graph, resolved once
  // ---------------------------------------------------------------------------

  const roomsById = new Map(interior.rooms.map((r) => [r.id, r]));

  /** Portal records paired with the barrier standing in them, if any. */
  const links = interior.portals
    .filter((p) => p.from)
    .map((p) => ({
      ...p,
      barrier: interior.barriers.find((b) => b.from === p.from && b.to === p.to) || null,
    }));

  const neighbours = new Map();
  for (const l of links) {
    if (!neighbours.has(l.from)) neighbours.set(l.from, new Set());
    if (!neighbours.has(l.to)) neighbours.set(l.to, new Set());
    neighbours.get(l.from).add(l.to);
    neighbours.get(l.to).add(l.from);
  }

  const fixtures = () => (interacts && interacts.records) || [];
  const kindlingSlot = (power && power.slot)
    || interior.interacts.find((i) => i.type === 'power')
    || null;

  // Wall buys need to know whether the weapon is already owned, and the weapons
  // module is deliberately not one of this file's inputs: a minimap has no
  // business holding the armoury. attach() supplies the one predicate it needs.
  let weaponsOwn = () => false;

  const state = {
    space: 'exterior',
    room: null,
    contacts: 0,
    painted: 0,

    /**
     * WHERE THE PLAYER WEDGE WAS ACTUALLY DRAWN, in canvas pixels, written by
     * drawPlayer on the frame it draws.
     *
     * This is a record and not a claim: it is the same two numbers that were
     * handed to moveTo, so a harness reading it is reading the rasteriser's
     * input rather than re-deriving the projection and asserting its own
     * arithmetic against itself. The tip is what makes the orientation
     * checkable at all - the wedge is nine pixels of bone on a dark panel and
     * fitting a direction to it from the image alone is noise.
     */
    mark: { x: 0, y: 0, tipX: 0, tipY: 0, yaw: 0 },
  };

  // ---------------------------------------------------------------------------
  // projection
  // ---------------------------------------------------------------------------

  //
  // One uniform scale for both axes, so a square room is drawn square and the
  // map keeps its bearing. The alternative - stretching each axis to fill the
  // panel - would make the Great Gallery, which is genuinely wider than it is
  // deep, come out square, and every distance the player reads off it would be
  // a lie in one direction.
  //
  let sx = 1, sy = 1, ox = 0, oy = 0;

  //
  // THE Z AXIS RAN THE WRONG WAY FOR THE WHOLE OF THIS FILE'S LIFE, and it is
  // worth writing down exactly what was wrong because "the map is inverted" has
  // three independent causes and only one of them was live.
  //
  //   world +X vs screen right   CORRECT, and always was.
  //   world +Z vs screen down    INVERTED. `py` was `-z * sy + oy`, which puts
  //                              +Z at the TOP - so the pyramid, which stands
  //                              at the far -Z end of the avenue, was drawn
  //                              BELOW the player walking toward it, and the
  //                              nine interior rooms were mirrored end for end
  //                              with the entry at the top and the King's
  //                              Chamber, the deepest room in the tomb, at the
  //                              bottom. Measured: stepping the player from
  //                              z -149 to z -252 moved their mark 211 pixels
  //                              DOWN the panel.
  //   yaw vs the wedge           INVERTED as well, separately: see drawPlayer.
  //
  // The two errors are not the same error. A sign flip on Z alone leaves a
  // self-consistent map that reads upside down; a sign flip on yaw alone leaves
  // a correctly laid-out map with an arrow that points behind the player. Both
  // were present, which is why the mark pointed 165-180 degrees away from the
  // direction the player was actually travelling at every yaw tested, in both
  // the courtyard AND the interior. Checking one pose could not have told them
  // apart - a sign error and a transpose look identical from one sample.
  //
  // -Z is UP the panel, which is the ordinary top-down convention (look down
  // +Y, +X right, +Z toward the bottom of the screen) and is also what makes
  // this a compass: the player faces -Z on entry, so the thing ahead of them is
  // the thing at the top of the map.
  //
  function fit(minX, maxX, minZ, maxZ) {
    const w = W - PAD * 2;
    const h = H - PAD * 2;
    const k = Math.min(w / (maxX - minX), h / (maxZ - minZ));
    sx = k; sy = k;
    ox = PAD + (w - (maxX - minX) * k) / 2 - minX * k;
    oy = PAD + (h - (maxZ - minZ) * k) / 2 - minZ * k;
  }

  const px = (x) => x * sx + ox;
  const py = (z) => z * sy + oy;

  // ---------------------------------------------------------------------------
  // primitives
  // ---------------------------------------------------------------------------

  function plate() {
    ctx.clearRect(0, 0, W, H);
    // A dark ground under everything. The panel behind the canvas is already
    // dark, but the canvas has to carry its own so a screenshot of the map is
    // legible regardless of what the CSS underneath is doing.
    ctx.fillStyle = 'rgba(8,5,3,0.90)';
    ctx.fillRect(0, 0, W, H);
  }

  // Callers pass a world rectangle, not a screen one, so which of z0/z1 lands
  // at the top is a property of the projection rather than of the call. Taking
  // the min and the max is what stops a future change of Z convention from
  // silently handing fillRect a negative height.
  function rect(x0, z0, x1, z1, fill, stroke, lw = 1) {
    const a = Math.min(px(x0), px(x1)), c = Math.max(px(x0), px(x1));
    const b = Math.min(py(z0), py(z1)), d = Math.max(py(z0), py(z1));
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(a, b, c - a, d - b); }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.strokeRect(a + 0.5, b + 0.5, c - a - 1, d - b - 1);
    }
  }

  function dot(x, z, r, fill, stroke) {
    ctx.beginPath();
    ctx.arc(px(x), py(z), r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function diamond(x, z, r, fill, stroke, lw = 1) {
    const a = px(x), b = py(z);
    ctx.beginPath();
    ctx.moveTo(a, b - r); ctx.lineTo(a + r, b);
    ctx.lineTo(a, b + r); ctx.lineTo(a - r, b);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }

  function line(ax, az, bx, bz, stroke, lw = 1, dash = null) {
    ctx.beginPath();
    ctx.moveTo(px(ax), py(az));
    ctx.lineTo(px(bx), py(bz));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * A label with its own shadow.
   *
   * Every numeral on this map sits over whatever room rectangle happens to be
   * behind it, and those run from near-black to a lit gold fill. A flat fill
   * would be readable on one and invisible on the other, which is the exact
   * failure the exterior and interior HUD backgrounds already threaten. The
   * shadow is a cheap, unconditional floor under the contrast.
   */
  function label(text, x, y, colour = GOLD, size = 8, align = 'center') {
    ctx.font = `${size}px "Trebuchet MS", "Gill Sans", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(4,3,1,0.95)';
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  }

  // ---------------------------------------------------------------------------
  // the interior
  // ---------------------------------------------------------------------------

  function passable(link) {
    if (!link.barrier) return true;
    return !!(link.barrier.opened || link.barrier.opening);
  }

  /**
   * Which rooms the player has stood in. Used for a warmer fill, and for
   * nothing else.
   *
   * THE WHOLE PLAN IS ALWAYS DRAWN, and an earlier pass of this file got that
   * wrong. Hiding unvisited rooms behind a fog looked like the obvious thing and
   * failed the moment it was rendered: on entry the panel is a near-black
   * rectangle with one lit box at the top of it, which does not orient anybody -
   * it looks like the map failed to load. This is a wave shooter, not
   * a game about mapping, and the player's problem is never "what shape is the
   * pyramid", it is "which of these boxes am I in and what is next door". So the
   * shape is free and the STATE is what is graded: whose doorway is shut, which
   * shrine is lit, where the chest is standing this minute.
   */
  const seen = new Set();

  function reveal(id) {
    if (id) seen.add(id);
  }

  /**
   * Four fills, in one ladder, and the ladder is the whole read.
   *
   * The eye has to find the current room in peripheral vision without being
   * aimed at the panel, so the current room is the only thing on the map lit in
   * gold and everything else is a value below it. Its neighbours come second
   * because they are the only rooms a decision can be made about right now.
   */
  function drawRooms(current) {
    const adj = neighbours.get(current) || new Set();

    for (const room of interior.rooms) {
      const { x, z, w, d } = room.bounds;
      const x0 = x - w / 2, x1 = x + w / 2;
      const z0 = z - d / 2, z1 = z + d / 2;

      if (room.id === current) {
        rect(x0, z0, x1, z1, 'rgba(217,178,106,0.26)', GOLD, 1.8);
      } else if (adj.has(room.id)) {
        rect(x0, z0, x1, z1, 'rgba(217,178,106,0.12)', 'rgba(217,178,106,0.70)', 1.2);
      } else if (seen.has(room.id)) {
        rect(x0, z0, x1, z1, 'rgba(60,45,26,0.94)', 'rgba(217,178,106,0.42)', 1);
      } else {
        rect(x0, z0, x1, z1, 'rgba(34,25,15,0.94)', 'rgba(217,178,106,0.28)', 1);
      }
    }
  }

  /**
   * The doorways, and what stands in them.
   *
   * A portal is drawn ACROSS the wall line it cuts, so a cleared one reads as a
   * gap in the outline and a shut one reads as something plugging it. The
   * colour is the refusal state, which is the same three-way split doors.js
   * makes in the prompt: gold for open, amber for a price, lapis for a gate that
   * gold cannot buy.
   */
  function drawPortals(current) {
    for (const l of links) {
      const near = roomsById.get(l.from);
      const far = roomsById.get(l.to);
      if (!near || !far) continue;

      // The doorway runs ALONG the shared wall, so its long axis is whichever
      // one the two rooms do not already differ on.
      const alongX = Math.abs(near.bounds.z - far.bounds.z)
        > Math.abs(near.bounds.x - far.bounds.x);

      const half = l.width / 2;
      const a = alongX ? px(l.at.x - half) : px(l.at.x);
      const b = alongX ? py(l.at.z) : py(l.at.z + half);
      const c = alongX ? px(l.at.x + half) : px(l.at.x);
      const e = alongX ? py(l.at.z) : py(l.at.z - half);

      const open = passable(l);
      const gated = !open && (l.kind === 'power' || l.kind === 'puzzle');

      ctx.beginPath();
      ctx.moveTo(a, b);
      ctx.lineTo(c, e);
      ctx.lineWidth = open ? 2.4 : 3.4;
      ctx.strokeStyle = open ? GOLD : gated ? LAPIS : '#e2a03c';
      ctx.setLineDash(open ? [] : [2.5, 2.2]);
      ctx.stroke();
      ctx.setLineDash([]);

      // The price, only where the player could act on it. Every shut doorway in
      // the pyramid quoting its figure at once is nine numbers over nine
      // rectangles and reads as noise; the two or three touching the room the
      // player is standing in are the only ones that are a decision right now.
      if (open) continue;
      const touching = l.from === current || l.to === current;
      if (!touching) continue;

      // Pushed into the room on the FAR side, not the near one. The near side is
      // the room the player is standing in and is already carrying its own
      // fixture marks and the player's own wedge; the far side of a shut doorway
      // is by definition somewhere they have not been, so it is empty, which is
      // exactly what a numeral needs under it. The Chamber of Ascent's two
      // debris doorways were otherwise stacking both their prices on top of the
      // wall buy between them.
      const other = l.from === current ? far : near;
      const mx = (a + c) / 2;
      const my = (b + e) / 2;
      const dx = px(other.bounds.x) - mx;
      const dy = py(other.bounds.z) - my;
      const len = Math.hypot(dx, dy) || 1;
      const lx = mx + (dx / len) * 11;
      const ly = my + (dy / len) * 11;

      if (gated) {
        label(l.kind === 'power' ? 'DARK' : 'SEALED', lx, ly, LAPIS, 7);
      } else if (l.cost > 0) {
        label(String(l.cost), lx, ly, economy.canAfford(l.cost) ? GOLD : BLOOD, 9);
      }
    }
  }

  /** A small upright chest outline. Two rectangles, no glyph, no font. */
  function chest(x, z, r, on) {
    const a = px(x), b = py(z);
    ctx.beginPath();
    ctx.rect(a - r, b - r * 0.7, r * 2, r * 1.4);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = on ? GOLD : 'rgba(217,178,106,0.42)';
    if (on) { ctx.fillStyle = 'rgba(217,178,106,0.45)'; ctx.fill(); }
    ctx.setLineDash(on ? [] : [2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);

    // The lid line, which is what makes two nested rectangles read as a box.
    ctx.beginPath();
    ctx.moveTo(a - r, b - r * 0.2);
    ctx.lineTo(a + r, b - r * 0.2);
    ctx.strokeStyle = on ? INK : 'rgba(217,178,106,0.42)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** The Kindling: a flame, drawn as a leaning triangle. */
  function flame(x, z, r, lit) {
    const a = px(x), b = py(z);
    ctx.beginPath();
    ctx.moveTo(a, b - r * 1.3);
    ctx.quadraticCurveTo(a + r, b - r * 0.1, a, b + r);
    ctx.quadraticCurveTo(a - r, b - r * 0.1, a, b - r * 1.3);
    ctx.closePath();
    ctx.fillStyle = lit ? '#ffc061' : 'rgba(120,96,60,0.55)';
    ctx.fill();
    ctx.strokeStyle = lit ? '#fff0c8' : GOLD_DIM;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** The Altar: a bar and an upright, which is a djed seen from above. */
  function altarMark(x, z, r) {
    const a = px(x), b = py(z);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(a - r, b); ctx.lineTo(a + r, b);
    ctx.moveTo(a, b - r * 1.2); ctx.lineTo(a, b + r * 1.2);
    ctx.moveTo(a - r * 0.6, b - r * 0.6); ctx.lineTo(a + r * 0.6, b - r * 0.6);
    ctx.stroke();
  }

  function drawFixtures() {
    // --- wall buys ----------------------------------------------------------
    //
    // A narrow upright plaque, which is what one is. No price: the wall buys are
    // the one class of fixture whose figure never changes and never gates
    // anything, so quoting four of them permanently would spend four labels to
    // say what the objective tracker says once, about the one that matters.
    for (const rec of fixtures()) {
      if (rec.type !== 'wallbuy') continue;
      const id = rec.config && rec.config.weapon;
      const owned = !!id && weaponsOwn(id);

      const a = px(rec.x), b = py(rec.z);
      ctx.fillStyle = owned ? 'rgba(232,220,196,0.40)' : GOLD;
      ctx.fillRect(a - 2.5, b - 3.5, 5, 7);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.strokeRect(a - 3, b - 4, 6, 8);
    }

    // --- shrines ------------------------------------------------------------
    //
    // In the flame's own colour, which is the identity the player has actually
    // learned. ui/hud.js takes the boon chips from the same table for the same
    // reason: a HUD in a different blue from the fire it stands for breaks the
    // one association the map taught.
    for (const rec of fixtures()) {
      if (rec.type !== 'shrine') continue;
      const id = rec.config && rec.config.boon;
      const look = BOON_LOOK[id];
      const emissive = look ? look.emissive : 0xd9b26a;
      const colour = hex(emissive);
      const held = shrines.has(id);

      if (!power.powered) {
        // Dark, and drawn dark. A shrine that will not open for any amount of
        // money should not be advertising a colour at the player: this is the
        // same distinction doors.js makes between "come back richer" and "come
        // back later", carried onto the map.
        diamond(rec.x, rec.z, 3.6, 'rgba(20,15,9,0.85)', 'rgba(160,140,110,0.5)');
        continue;
      }

      // THE HUE HAS TO SURVIVE THE SIZE, and at this scale that is a real
      // constraint rather than a nicety: colour is the ONLY thing that tells the
      // six shrines apart anywhere in this game, on the map or in the room.
      //
      // Measured on the first version - a one-pixel outline round a dark
      // diamond - four of the six put fewer than nine pixels of their own hue on
      // the panel and Anubis, whose flame is a pale blue-white, managed ONE. An
      // alpha fill did not fix it either: a pale colour composited at 40 per
      // cent over dark stone loses its saturation, which is exactly the channel
      // being relied on. So the mark carries a solid pip of the undiluted colour
      // in the middle of it, and the outline is thick enough not to be eaten by
      // antialiasing.
      diamond(rec.x, rec.z, 4.2, held ? colour : tint(emissive, 0.30), colour, 1.8);

      ctx.beginPath();
      ctx.arc(px(rec.x), py(rec.z), 1.7, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();

      // Carried ones get a ring as well, so "mine" and "for sale" are two marks
      // and not two brightnesses of one.
      if (held) {
        ctx.beginPath();
        ctx.arc(px(rec.x), py(rec.z), 6.2, 0, Math.PI * 2);
        ctx.strokeStyle = tint(emissive, 0.6);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // --- the Kindling -------------------------------------------------------
    if (kindlingSlot) flame(kindlingSlot.x, kindlingSlot.z, 4.4, power.powered);

    // --- the Altar ----------------------------------------------------------
    for (const rec of fixtures()) {
      if (rec.type !== 'altar') continue;
      altarMark(rec.x, rec.z, 4);
    }

    // --- the chest, and the two places it is NOT ----------------------------
    //
    // Drawing all three placements is the point. The chest relocating is the one
    // mechanic in the map that moves the map, and a minimap that showed only
    // where it is now would turn a player who walked to a cold plinth into a
    // player who thinks the map is broken. Hollow and dashed reads as a site;
    // filled reads as the box.
    for (const rec of fixtures()) {
      if (rec.type !== 'box') continue;
      chest(rec.x, rec.z, 4.4, mysterybox.isActive(rec));
    }
  }

  /** Live enemies as contacts. Read only; the director owns the array. */
  function drawContacts() {
    if (!director || !director.live) return 0;

    let n = 0;
    for (const actor of director.live) {
      if (!actor || !actor.live || !actor.position) continue;
      const p = actor.position;
      // Actors from the other space are not culled by the director, so a
      // courtyard horde would otherwise be plotted onto the pyramid.
      if (p.z > INTERIOR_BOUNDS.maxZ || p.z < INTERIOR_BOUNDS.minZ) continue;
      dot(p.x, p.z, 2, BLOOD, null);
      n++;
    }

    const boss = director.boss;
    if (boss && boss.position && boss.position.z <= INTERIOR_BOUNDS.maxZ) {
      dot(boss.position.x, boss.position.z, 4.5, null, BLOOD);
      dot(boss.position.x, boss.position.z, 2.2, BLOOD, null);
    }

    return n;
  }

  /**
   * The player: a wedge, pointing where they are looking.
   *
   * Drawn last, so nothing can be plotted over the one mark the player has to
   * find first, and outlined in ink so it survives sitting on a lit room fill.
   */
  function drawPlayer() {
    const p = player.position;
    const a = px(p.x), b = py(p.z);

    // THE WEDGE IS ROTATED BY MINUS THE YAW, and the sign is derived rather
    // than guessed, because guessing it is how this ended up backwards.
    //
    // player/camera.js turns LEFT on a rising yaw: `yaw -= dx * SENSITIVITY`,
    // and forward is (-sin yaw, 0, -cos yaw). Project that through px/py, which
    // are now a plain scale with no flip on either axis:
    //
    //     screen forward = (-sin yaw, -cos yaw)
    //
    // The wedge's tip is at local (0, -7), so whatever matrix is applied has to
    // carry (0, -1) onto (-sin yaw, -cos yaw). The standard rotation
    // [[c, -s], [s, c]] carries it onto (+sin, -cos) - correct in Z and
    // MIRRORED IN X, which is the second half of the inversion the owner
    // reported. Screen y runs downward, so a yaw that turns the player left
    // must turn the wedge counter-clockwise ON SCREEN, which is a rotation by
    // -yaw: [[c, s], [-s, c]].
    //
    // Verified by walking rather than by reading: teleport the player, step
    // them 8 m along their own facing, and confirm the mark travels in the
    // direction the wedge is pointing. That test is in test/hud.mjs and it is
    // the one that would have caught this.
    const yaw = rig ? rig.yaw : 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const pt = (fx, fz) => [a + (fx * c + fz * s), b + (-fx * s + fz * c)];

    const [x0, y0] = pt(0, -7);
    const [x1, y1] = pt(4.4, 4);
    const [x2, y2] = pt(0, 1.6);
    const [x3, y3] = pt(-4.4, 4);

    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fillStyle = BONE;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    state.mark.x = a;
    state.mark.y = b;
    state.mark.tipX = x0;
    state.mark.tipY = y0;
    state.mark.yaw = yaw;
  }

  // ---------------------------------------------------------------------------
  // the courtyard
  // ---------------------------------------------------------------------------

  /**
   * The avenue's own wall line, inboard of the walkable bound.
   *
   * courtyard.js walks the player out to x +/-23.2 but the colonnade that
   * actually reads as the avenue stands at 16.6 - the extra ground either side
   * is the breaches and the choked ends. Drawing both is what makes the panel a
   * picture of a processional way rather than a rectangle.
   */
  const AVENUE_HALF = 16.6;

  /**
   * Outside there is no room graph: there is an avenue, a wall at the far end,
   * and one doorway in it.
   *
   * The first version of this was one rectangle and it measured as one: the
   * brightest one per cent of the panel scored 2.00 to one against its own
   * ground, which is a fair description of an empty box. It is not a measurement
   * artefact - there was genuinely almost nothing drawn - and the fix is not to
   * brighten the ground but to draw the architecture that is actually there. The
   * colonnade rows and the axis are the two things a player standing in that
   * avenue can see, so they are the two things that orient them on a map of it.
   */
  function drawCourtyard() {
    const b = spaces.courtyard.bounds;
    fit(b.minX - 4, b.maxX + 4, b.minZ - 12, b.maxZ + 4);

    // The ground is kept DARK on purpose, and that is the second half of the
    // fix. A mid-value fill over half the panel does not add information; it
    // raises the floor the ink has to stand off, and it was the reason the
    // brightest one per cent of this panel scored barely three to one against
    // its own ground. Dark ground, bright ink.
    rect(b.minX, b.minZ, b.maxX, b.maxZ, 'rgba(40,30,18,0.55)', 'rgba(217,178,106,0.34)', 1);

    // The two colonnade rows, and the processional axis between them running at
    // the one thing at the far end of it.
    line(-AVENUE_HALF, b.minZ, -AVENUE_HALF, b.maxZ, GOLD, 2);
    line(AVENUE_HALF, b.minZ, AVENUE_HALF, b.maxZ, GOLD, 2);
    line(0, b.minZ + 2, 0, b.maxZ - 3, 'rgba(217,178,106,0.55)', 1.2, [4, 5]);

    label('THE AVENUE', px(0), py(b.maxZ - 6), GOLD, 8);

    // The pyramid mass beyond the avenue's far wall, drawn as the stepped
    // silhouette it is on the skyline rather than as another box.
    rect(b.minX - 3, b.minZ - 11, b.maxX + 3, b.minZ + 0.4,
      'rgba(34,25,15,0.92)', 'rgba(217,178,106,0.40)', 1.2);
    for (let i = 1; i <= 2; i++) {
      const inset = i * 6.5;
      rect(b.minX - 3 + inset, b.minZ - 11 + i * 1.6, b.maxX + 3 - inset, b.minZ + 0.4,
        null, 'rgba(217,178,106,0.28)', 1);
    }
    label('THE PYRAMID', px(0), py(b.minZ - 8.2), GOLD, 8);

    const entry = doors.byId('courtyard/entry');
    if (entry) {
      const open = entry.opened || entry.opening;
      const a = px(entry.x - 2.6), c = px(entry.x + 2.6);
      const y = py(entry.z);

      ctx.beginPath();
      ctx.moveTo(a, y); ctx.lineTo(c, y);
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = open ? GOLD : '#e2a03c';
      ctx.setLineDash(open ? [] : [2.5, 2.2]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Inside the avenue, below the line. The pyramid rectangle above it is
      // where the label "THE PYRAMID" already sits, and two numerals in one
      // 40-pixel band is the collision this whole placement pass is about.
      if (!open) {
        label(String(entry.cost), px(entry.x), y + 10,
          economy.canAfford(entry.cost) ? GOLD : BLOOD, 9);
      }
    }

    let n = 0;
    if (director && director.live) {
      for (const actor of director.live) {
        if (!actor || !actor.live || !actor.position) continue;
        if (actor.position.z < INTERIOR_BOUNDS.maxZ) continue;
        dot(actor.position.x, actor.position.z, 2, BLOOD, null);
        n++;
      }
    }

    drawPlayer();
    return n;
  }

  // ---------------------------------------------------------------------------
  // frame
  // ---------------------------------------------------------------------------

  function paint() {
    resize();
    if (!W || !H) return state;

    plate();

    if (spaces.active !== 'interior') {
      state.space = 'exterior';
      state.room = null;
      state.contacts = drawCourtyard();
      if (roomLabel && roomLabel.textContent !== 'The Necropolis') {
        roomLabel.textContent = 'The Necropolis';
      }
      state.painted++;
      return state;
    }

    fit(INTERIOR_BOUNDS.minX - 2, INTERIOR_BOUNDS.maxX + 2,
      INTERIOR_BOUNDS.minZ - 2, INTERIOR_BOUNDS.maxZ + 2);

    const current = spaces.roomId;
    reveal(current);

    state.space = 'interior';
    state.room = current;

    drawRooms(current);
    drawPortals(current);
    drawFixtures();
    state.contacts = drawContacts();
    drawPlayer();

    const room = roomsById.get(current);
    const name = room ? room.name : 'The Pyramid';
    if (roomLabel && roomLabel.textContent !== name) roomLabel.textContent = name;

    state.painted++;
    return state;
  }

  let since = 1 / HZ;

  /**
   * Throttled to HZ, and the throttle is on the CLAMPED frame delta rather than
   * the wall clock. Under software rendering simulated time runs several times
   * slower than the wall, and a wall-clock throttle would paint the map at a
   * different rate than the game it is describing.
   */
  function update(dt) {
    since += dt;
    if (since < 1 / HZ) return state;
    since = 0;
    return paint();
  }

  return {
    update,
    paint,
    state,

    /** Late binding, so the map never has to import the armoury. */
    attach(parts) {
      if (parts && parts.owns) weaponsOwn = parts.owns;
    },

    /**
     * The live projection: a world (x, z) to the canvas pixel it lands on.
     *
     * For the harness, and only for the harness. It is THE projection - the same
     * two closures every mark on the panel is placed with, not a copy of them -
     * so a test can put a known fixture at a known bearing and check the map
     * agrees, and cannot be fooled by a second implementation that drifted.
     * Valid for whichever space was painted last, because `fit` is called per
     * paint with that space's bounds.
     */
    project(x, z) { return { x: px(x), y: py(z) }; },

    /** For the harness: which rooms the player has stood in. */
    get visited() { return [...seen]; },
    reveal,
  };
}
