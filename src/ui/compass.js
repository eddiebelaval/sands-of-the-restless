/**
 * THE COMPASS: a heading strip across the top of the screen.
 *
 * ---------------------------------------------------------------------------
 * WHY CARDINAL MARKS ARE CORRECT HERE, AND NOT A BORROWED FPS HABIT
 * ---------------------------------------------------------------------------
 *
 * A compass in most shooters is decoration with a job bolted on: nobody thinks
 * in north, so the strip ends up carrying objective pips and the letters are
 * there because the genre expects them.
 *
 * This game is the one place the letters mean something. **The Great Pyramid is
 * aligned to true north to within a fraction of a degree** - it is the single
 * most famous measurable fact about the building - and every room in this map
 * is cut on those axes, because the map was built as a pyramid interior. So N,
 * E, S and W are not a convention imported from elsewhere. They are what the
 * architecture is actually squared to, and a player who learns that the Great
 * Gallery runs north is learning something true about the space rather than
 * memorising a HUD.
 *
 * That is also why this is a STRIP and not a rose. A rose asks the player to
 * read an angle. A strip asks them to notice that the mark they want has
 * drifted left, which is a glance rather than a reading - and the test any HUD
 * element in this project has to pass, per ui/tokens.js, is whether it survives
 * being read in a fifth of a second by someone being chased.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CARRIES BESIDES NORTH
 * ---------------------------------------------------------------------------
 *
 * ui/minimap.js states the real question a lost player is asking, and it is not
 * a bearing: "which box am I in, what is next door, what does it cost". The
 * minimap answers that and answers it well, but it is a floorplan - it costs a
 * glance DOWN and a moment of orientation, which is exactly what a player in a
 * fight does not have.
 *
 * So the strip carries bearings to the two things worth turning toward, and
 * nothing else:
 *
 *   THE OBJECTIVE, because the one thing a player says out loud when lost is
 *   "which way was I going".
 *   THE MYSTERY BOX, only while it is live, because it moves, it is on a timer,
 *   and it is the one fixture whose location is genuinely worth interrupting a
 *   fight for.
 *
 * Deliberately NOT on it: enemies. A compass that shows the horde replaces the
 * job the audio lane just spent a whole pass building - a scarab you can locate
 * by its steps is a better game than a scarab you can locate by a pip - and it
 * would make the wall-crawling enemies pointless the moment they left the floor.
 *
 * ---------------------------------------------------------------------------
 * CANVAS, FOR THE REASON THE MINIMAP IS CANVAS
 * ---------------------------------------------------------------------------
 *
 * The strip scrolls continuously and holds two dozen marks. In DOM that is two
 * dozen elements being transformed every frame; on a canvas it is one draw. The
 * cost is that `test/hud.mjs`'s text audit cannot see the labels - it walks DOM
 * text - so the contrast floor it enforces is honoured HERE by construction:
 * every colour below comes from ui/tokens.js ROLE, and none of the fill-only
 * pigments (lapis, carnelian, goldDeep) is ever handed to a glyph.
 */

import { PIGMENT, ROLE, FORM, ink } from './tokens.js';

/**
 * Degrees of arc visible across the whole strip, and how wide it is drawn.
 *
 * WIDENED on the owner's note - "can you make it wider, I want a little bit
 * more coverage" - and both numbers had to move together. Widening W alone
 * stretches the same arc across more pixels, which does not show you more of
 * the world, it just spaces out what you already had. Raising SPAN alone shows
 * more world at a coarser scale and starts crowding marks together.
 *
 * 200 degrees over 560 px keeps the scale close to what shipped (2.80 px per
 * degree against the old 3.00) while putting most of a half-turn on screen: at
 * 200 degrees a fixture 100 degrees off your shoulder is on the strip, so you
 * can see something you are not facing and turn toward it, which is the whole
 * point of the request.
 */
const SPAN = 200;

/** Strip size in CSS pixels. */
const W = 560;
const H = 34;

/**
 * Fixture marks: how big, and how far away that stops mattering.
 *
 * The owner's ask was "small when they're far and larger when they're close",
 * which inverts nothing about perspective and is exactly right as an interface:
 * size here means REACHABLE, not near. A wall buy across the map is information;
 * a wall buy six metres away is a decision.
 */
const NEAR_M = 6;      // at or inside this, a mark is at full size
const FAR_M = 70;      // at or beyond this, a mark is at its smallest
const NEAR_PX = 6.0;
const FAR_PX = 1.6;

/** Marks past this are not drawn at all. Beyond it they are noise. */
const CULL_M = 95;

/**
 * The most fixture marks drawn at once, nearest first.
 *
 * The interior publishes about thirty fixtures and a 200 degree strip can hold
 * most of them at once. Distance already thins the far ones to a pixel and a
 * half, but a hard ceiling is what stops a corridor full of wall buys from
 * turning the strip into a dotted line. Nearest-first, because the ones you can
 * act on are the ones worth the space.
 */
const MAX_FIXTURES = 12;

/** Where a mark stops being drawn, as a fraction of half-width. Prevents
 *  labels popping in at the very edge mid-glyph. */
const FADE = 0.78;

/**
 * The four that are architecture, and the four that are not.
 *
 * The intercardinals get ticks and no letters: NE is not a thing this building
 * is squared to, and four more glyphs on a 420px strip is clutter competing
 * with the two marks that actually carry information.
 */
const CARDINALS = [
  { deg: 0,   label: 'N' },
  { deg: 90,  label: 'E' },
  { deg: 180, label: 'S' },
  { deg: 270, label: 'W' },
];
const MINOR = [45, 135, 225, 315];

/** Wrap a signed degree difference into [-180, 180). */
function wrap(d) {
  let x = (d + 180) % 360;
  if (x < 0) x += 360;
  return x - 180;
}

/**
 * The player's compass bearing, in degrees clockwise from north.
 *
 * THE CONVENTION, stated because a sign error here is invisible in a still and
 * obvious in motion, and because ui/minimap.js has a long note recording that
 * it got exactly this wrong twice in two different places.
 *
 * The camera's forward vector for `rotation.y = yaw` is
 * `(-sin yaw, 0, -cos yaw)`. Taking NORTH AS -Z - which is what makes the
 * pyramid's north face its north face - a direction (dx, dz) has bearing
 * `atan2(dx, -dz)`. Substituting the forward vector gives `atan2(-sin yaw, cos
 * yaw)`, which is `-yaw`.
 *
 * So the player's bearing is simply the negated yaw, and the strip is verified
 * in `test/compass.mjs` by turning the rig to each cardinal and asserting the
 * right letter is at the centre - because the reasoning above is exactly the
 * kind that is convincing and wrong.
 */
export function bearingOf(yaw) {
  return (-yaw * 180) / Math.PI;
}

/** Bearing from one world point to another, degrees clockwise from north. */
export function bearingTo(px, pz, tx, tz) {
  return (Math.atan2(tx - px, -(tz - pz)) * 180) / Math.PI;
}

/**
 * What each fixture is drawn as. Colour from ui/tokens.js ROLE, never a pigment
 * name, and never one of the FILL ONLY values on a shape this small.
 *
 * SHAPE CARRIES THE CLASS AND COLOUR CONFIRMS IT, in that order. At two pixels
 * a hue is not identifiable - tokens.js measures lapis at 2.70 to one and says
 * so - but a diamond is still a diamond, and by the time a mark is big enough
 * for its colour to read, it is close enough to matter.
 */
const FIXTURE = {
  wallbuy:       { role: 'text',       shape: 'bar' },
  shrine:        { role: 'arcaneText', shape: 'diamond' },
  box:           { role: 'ready',      shape: 'square' },
  altar:         { role: 'active',     shape: 'diamond' },
  'canopic-jar': { role: 'textBright', shape: 'dot' },
  niche:         { role: 'textDim',    shape: 'dot' },
};

/** 0 at FAR_M and beyond, 1 at NEAR_M and inside. */
function nearness(d) {
  if (d <= NEAR_M) return 1;
  if (d >= FAR_M) return 0;
  return 1 - (d - NEAR_M) / (FAR_M - NEAR_M);
}

export function createCompass({
  canvas, rig, player, interacts, spaces, beacons = null, doc = document,
}) {
  if (!canvas) return { update() {}, stats: () => ({ marks: [] }) };

  const ctx = canvas.getContext('2d');
  let dpr = 0;

  const state = {
    /** Degrees clockwise from north the player is facing. */
    bearing: 0,
    /** What was drawn this frame, for the harness. Nothing on screen reads it. */
    marks: [],
  };

  function resize() {
    const next = Math.min(doc.defaultView?.devicePixelRatio || 1, 2);
    if (next === dpr) return;
    dpr = next;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
  }

  /** Where a bearing lands on the strip, or null if it is off the ends. */
  function xFor(deg) {
    const rel = wrap(deg - state.bearing);
    const half = SPAN / 2;
    if (Math.abs(rel) > half * FADE) return null;
    return W / 2 + (rel / half) * (W / 2);
  }

  function drawTick(x, h, colour, alpha) {
    ctx.strokeStyle = ink(colour, alpha);
    ctx.lineWidth = FORM.hairline;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, H - 9);
    ctx.lineTo(x + 0.5, H - 9 - h);
    ctx.stroke();
  }

  /**
   * A bearing pip: a small triangle sitting under the rule, in a role colour.
   *
   * Shape rather than colour carries the difference between the two, because
   * `tokens.js` measures lapis at 2.70 to one and marks it FILL ONLY - a pip
   * the player has to identify by hue at 12 pixels is a pip they cannot use.
   */
  function drawPip(x, colour, up) {
    ctx.fillStyle = ink(colour, 0.95);
    ctx.beginPath();
    if (up) {
      ctx.moveTo(x, H - 8); ctx.lineTo(x - 4, H - 2); ctx.lineTo(x + 4, H - 2);
    } else {
      ctx.moveTo(x, H - 2); ctx.lineTo(x - 4, H - 8); ctx.lineTo(x + 4, H - 8);
    }
    ctx.closePath();
    ctx.fill();
  }

  /**
   * A fixture mark, sized by how reachable it is.
   *
   * Drawn BELOW the register rule, on its own band, so the cardinal letters
   * above stay a clean row of four. A strip where the letters and the fixtures
   * share a line is a strip where north is one more dot.
   */
  function drawMark(x, size, colour, alpha, shape) {
    const y = H - 4.5;
    ctx.fillStyle = ink(colour, alpha);
    ctx.beginPath();
    if (shape === 'bar') {
      ctx.rect(x - size * 0.32, y - size * 0.62, size * 0.64, size * 1.24);
    } else if (shape === 'square') {
      ctx.rect(x - size * 0.5, y - size * 0.5, size, size);
    } else if (shape === 'diamond') {
      ctx.moveTo(x, y - size * 0.62);
      ctx.lineTo(x + size * 0.56, y);
      ctx.lineTo(x, y + size * 0.62);
      ctx.lineTo(x - size * 0.56, y);
    } else {
      ctx.arc(x, y, Math.max(0.7, size * 0.44), 0, Math.PI * 2);
    }
    ctx.closePath();
    ctx.fill();
  }

  function update() {
    resize();
    state.marks.length = 0;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    state.bearing = bearingOf(rig ? rig.yaw : 0);

    /*
     * THE SEAT, and it is a correction to something this file asserted and did
     * not measure.
     *
     * The first version shipped with a comment claiming the marks "carry their
     * own contrast" and therefore needed no ground behind them. A screenshot of
     * the courtyard settled it: gold at 0.94 alpha over a sunlit sky is very
     * nearly invisible, which is precisely the case ui/tokens.js singles out -
     * "the worst plate ground it measured anywhere in the game" is the
     * courtyard, and it is the background this strip spends the whole of Act 1
     * on.
     *
     * The fix is NOT a panel. A plate across the top of the screen would be the
     * largest opaque object in the game and it is exactly what the no-plate
     * argument was right about. Instead every mark is drawn with a dark shadow
     * under it - the standard answer for HUD glyphs over an unknown background,
     * and one property rather than a second element - plus a scrim that fades
     * to nothing well before the strip's edges, so there is a ground under the
     * marks and no visible box anywhere.
     */
    // Darkest through the middle, where the glyphs are, and transparent at BOTH
    // edges. A gradient anchored dark at y=0 puts a hard horizontal line across
    // the top of the screen - visible in the first capture of shots/
    // compass-context.png - which is the box this is trying not to be.
    const scrim = ctx.createLinearGradient(0, 0, 0, H);
    scrim.addColorStop(0.00, ink(PIGMENT.shadow, 0));
    scrim.addColorStop(0.30, ink(PIGMENT.shadow, 0.50));
    scrim.addColorStop(0.74, ink(PIGMENT.shadow, 0.42));
    scrim.addColorStop(1.00, ink(PIGMENT.shadow, 0));
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, W, H);

    // And erased toward both ends, so the ground exists under the marks and
    // stops before it can have an edge. A rectangle of scrim would be the box
    // the no-plate argument was right to refuse; this has no side to see.
    ctx.globalCompositeOperation = 'destination-out';
    const ends = ctx.createLinearGradient(0, 0, W, 0);
    ends.addColorStop(0.00, 'rgba(0,0,0,1)');
    ends.addColorStop(0.22, 'rgba(0,0,0,0)');
    ends.addColorStop(0.78, 'rgba(0,0,0,0)');
    ends.addColorStop(1.00, 'rgba(0,0,0,1)');
    ctx.fillStyle = ends;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';

    ctx.shadowColor = ink(PIGMENT.shadow, 0.9);
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;

    // The register rule the marks hang from. One hairline, the same object the
    // rest of the interface divides bands with.
    ctx.strokeStyle = ink(ROLE.frame, 0.34);
    ctx.lineWidth = FORM.hairline;
    ctx.beginPath();
    ctx.moveTo(0, H - 8.5);
    ctx.lineTo(W, H - 8.5);
    ctx.stroke();

    for (const d of MINOR) {
      const x = xFor(d);
      if (x !== null) drawTick(x, 4, ROLE.frame, 0.30);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 13px 'Cinzel', Georgia, serif`;

    for (const c of CARDINALS) {
      const x = xFor(c.deg);
      if (x === null) continue;
      drawTick(x, 7, ROLE.frame, 0.75);
      // Bone for north, gold for the rest: the one the building is squared to
      // is the one worth finding at a glance.
      const colour = c.deg === 0 ? ROLE.textBright : ROLE.text;
      ctx.fillStyle = ink(colour, 0.94);
      ctx.fillText(c.label, x, H - 13);
      state.marks.push({ kind: 'cardinal', label: c.label, x: Math.round(x) });
    }

    /*
     * ---- THE FIXTURES -----------------------------------------------------
     *
     * The first cut of this file tried to reach `jars.nextTarget` and
     * `mysterybox` for two pips and could never have drawn either: nextTarget
     * is a METHOD returning a room NAME, and the mystery box tracks a spawn
     * INDEX. Both were guarded with `Number.isFinite` and so failed silently
     * while looking implemented.
     *
     * `interacts.records` is the source that actually exists, and it is the one
     * ui/minimap.js has been drawing from all along: every fixture in the game
     * with a handler, each carrying `x`, `z`, `type` and `id` in world space.
     * Taking the compass off the same records the map uses means the two
     * surfaces cannot disagree about where anything is, which is worth more
     * than any of the accessors I was about to ask another system to grow.
     */
    const px = player?.position?.x ?? 0;
    const pz = player?.position?.z ?? 0;

    // Same space test the map uses, and for the same reason: a shrine three
    // hundred metres away inside the pyramid is not a bearing, it is a wall.
    const outside = spaces?.active === 'courtyard' || spaces?.active === 'exterior';
    const inSpace = (r) => (outside ? r.room === 'courtyard' : r.room !== 'courtyard');

    const near = [];
    for (const rec of (interacts?.records || [])) {
      const spec = FIXTURE[rec.type];
      if (!spec || !inSpace(rec)) continue;
      if (!Number.isFinite(rec.x) || !Number.isFinite(rec.z)) continue;
      const d = Math.hypot(rec.x - px, rec.z - pz);
      if (d > CULL_M) continue;
      near.push({ d, rec, spec });
    }

    /*
     * THE OWNER'S EASTER EGG HOOK, and it is deliberately a pull rather than a
     * registry this file owns.
     *
     * "We can use that as a way to hide Easter eggs." A beacon is anything with
     * a world position that wants a bearing, supplied by whoever knows whether
     * it should be visible right now - so an egg can appear on a flag, on a
     * wave, for eight seconds, only in the dark, or only once. This file never
     * learns what an egg IS, which is the whole point: the condition belongs to
     * the thing being hidden, and `core/save.js` already round-trips flags
     * across a reload for exactly this.
     *
     * A beacon may carry its own `role` and `shape`, so an egg does not have to
     * look like a wall buy.
     */
    if (typeof beacons === 'function') {
      for (const b of (beacons() || [])) {
        if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
        const d = Math.hypot(b.x - px, b.z - pz);
        if (d > (b.range ?? CULL_M)) continue;
        near.push({
          d, rec: b, beacon: true,
          spec: { role: b.role || 'ready', shape: b.shape || 'diamond' },
        });
      }
    }

    // Nearest first, then capped. Far marks are already a pixel and a half; the
    // ceiling is what stops a corridor of wall buys becoming a dotted line.
    near.sort((a, b) => a.d - b.d);

    let drawn = 0;
    for (const m of near) {
      if (drawn >= MAX_FIXTURES && !m.beacon) continue;
      const x = xFor(bearingTo(px, pz, m.rec.x, m.rec.z));
      if (x === null) continue;

      const k = nearness(m.d);
      const size = FAR_PX + (NEAR_PX - FAR_PX) * k;
      // Alpha rides distance too, and harder than size does. A far mark should
      // be faint AND small, or thirty of them read as a texture across the rule.
      const alpha = 0.30 + 0.65 * k * k;

      drawMark(x, size, ROLE[m.spec.role] || ROLE.text, alpha, m.spec.shape);
      drawn++;
      state.marks.push({
        kind: m.beacon ? 'beacon' : m.rec.type,
        id: m.rec.id ?? null,
        x: Math.round(x),
        dist: Math.round(m.d),
        size: Math.round(size * 10) / 10,
      });
    }

    // The heading index: the one fixed thing on a strip where everything else
    // moves. Drawn last so nothing overlaps it.
    ctx.fillStyle = ink(PIGMENT.goldHot, 0.95);
    ctx.beginPath();
    ctx.moveTo(W / 2, H - 9);
    ctx.lineTo(W / 2 - 5, H - 17);
    ctx.lineTo(W / 2 + 5, H - 17);
    ctx.closePath();
    ctx.fill();
  }

  return {
    update,
    /** For the harness. Nothing on screen reads this. */
    stats() {
      return {
        bearing: state.bearing,
        marks: state.marks.slice(),
        /** Which cardinal is nearest the index, and how far off it is. */
        centred: (() => {
          let best = null;
          for (const c of CARDINALS) {
            const d = Math.abs(wrap(c.deg - state.bearing));
            if (!best || d < best.off) best = { label: c.label, off: d };
          }
          return best;
        })(),
      };
    },
  };
}
