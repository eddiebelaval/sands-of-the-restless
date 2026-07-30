/**
 * The game's visual language, in one place.
 *
 * WHY THIS FILE EXISTS. Every surface in this build - HUD, minimap, objective
 * card, interaction prompt, pause and start menus, weapon select - was painted
 * independently, and a grep for colour literals across src/ui turned up twenty
 * one distinct rgba() strings for what are really about six roles. That is
 * survivable while one person paints one screen. It is not survivable when
 * several passes land on different screens at once, because each one invents its
 * own idea of the same thing and the game stops looking like one game.
 *
 * So the tokens are locked here BEFORE anything gets repainted, and every
 * surface reads from this module rather than carrying its own literals.
 *
 * ---------------------------------------------------------------------------
 * THE DESIGN THESIS: keep the shooter's information architecture, change the
 * material it is made of.
 * ---------------------------------------------------------------------------
 *
 * The brief is "what if Call of Duty made an Egyptian game", and the failure
 * mode hiding inside that sentence is building a museum exhibit. A modern
 * shooter HUD is a hard-won piece of interaction design: corner-anchored so the
 * centre of the screen stays clear for the fight, enormous numerals for the two
 * or three values that matter, state changes that read in a fraction of a second
 * at the edge of vision, and nothing decorative competing with any of it. Throw
 * that away for authenticity and the game gets prettier and worse.
 *
 * So the split is deliberate and it is not negotiable in either direction:
 *
 *   LAYOUT, HIERARCHY AND TIMING stay modern. Ammo bottom right in big figures.
 *   Health bottom left. Objective top left. Nothing lives in the middle. State
 *   changes are instant and high contrast.
 *
 *   MATERIAL, FRAME AND MOTIF go Egyptian. The panel is not a dark rectangle
 *   with a border, it is a cartouche incised into painted plaster with gold in
 *   the cuts. Dividers are register rules, the lines that separate bands of
 *   Egyptian wall art. Text is carved, not printed - a dark inner edge and a lit
 *   top edge, because that is what a chisel leaves.
 *
 * The test for any addition: does it survive being read in one fifth of a second
 * by someone being chased? If not, it is ornament, and ornament goes in the
 * frame, never in the number.
 *
 * ---------------------------------------------------------------------------
 * THE PALETTE, AND THE ONE THING THAT WAS MISSING
 * ---------------------------------------------------------------------------
 *
 * The existing UI is gold on near-black, which is already halfway there and is
 * kept: `d9b26a` and `e2a03c` below are the two golds that were already in use,
 * unchanged, so nothing that currently reads well shifts underneath.
 *
 * What was completely absent is LAPIS. Gold and lapis lazuli is the defining
 * Egyptian pairing - it is the funerary mask, it is every pectoral in the
 * catalogue - and a palette of gold on brown-black has no cool note in it at
 * all, which is exactly why the current HUD reads as generic dark-panel-with-
 * amber-text rather than as anything specific. Lapis is the single highest-value
 * addition here and it is what the arcane states should be painted in: power,
 * upgrade, the puzzle, anything the game wants to feel supernatural rather than
 * mechanical.
 *
 * Carnelian carries danger. Faience carries the in-between - powered but not
 * yet supernatural. These three plus the two golds are the whole vocabulary.
 * Resist adding a sixth.
 */

// ---------------------------------------------------------------------------
// raw pigment
// ---------------------------------------------------------------------------

/**
 * Every colour as a triple, so canvas surfaces can build their own alpha and
 * DOM surfaces can use the helpers below. Canvas and DOM both consume this file
 * because the minimap draws to a 2D context while the HUD is DOM, and the two
 * drifting apart is precisely the problem this module exists to prevent.
 */
export const PIGMENT = {
  // The two golds already in the build. Do not retune these without looking at
  // every surface; they are the reason the current HUD reads as well as it does.
  goldLeaf:   [217, 178, 106],   // d9b26a - the workhorse. Text, rules, frames.
  goldHot:    [226, 160,  60],   // e2a03c - highlight only. Affordable, ready.
  goldDeep:   [168, 117,  31],   // shadowed gold, for the underside of a cut.

  // ADDED. The third gold, which was already in the build as --gold-mid in
  // index.html and was missing here - so the first surface to reach for
  // "quieter than the primary gold" out of this file would have had to invent
  // it or misuse goldDeep, and goldDeep is not legible as text. See THE
  // LEGIBILITY FLOOR below.
  goldMid:    [160, 139, 100],

  // The missing note. Deep is nearly black-blue and reads as a ground; mid is
  // the one that actually says lapis at a glance.
  lapisDeep:  [ 22,  38,  66],
  lapis:      [ 45,  95, 158],
  lapisLit:   [ 96, 148, 206],

  faience:    [ 62, 143, 134],   // powered, active, mechanical-arcane.
  carnelian:  [158,  59,  40],   // danger, denial, cannot afford, low health.

  // ADDED, for the same reason goldMid was: the stone-dark carnelian above is a
  // FILL and measures 2.59 to one against the worst plate, so the shortfall
  // line, the hurt numeral and the enemy contacts on the map cannot be drawn in
  // it. This is the value index.html was already using for all three as
  // e0563c - lifted here so it is one decision rather than five literals.
  carnelianLit: [224, 86, 60],

  linen:      [232, 220, 196],   // the brightest thing allowed. Bone, plaster.
  plaster:    [ 60,  45,  26],   // the painted ground a cartouche is cut into.
  stone:      [ 34,  25,  15],   // panel body.
  shadow:     [  8,   5,   3],   // the deepest ground. Near black, warm.
};

/**
 * ---------------------------------------------------------------------------
 * THE LEGIBILITY FLOOR, and why some roles below exist twice.
 * ---------------------------------------------------------------------------
 *
 * test/hud.mjs walks every element inside #hud that owns text and gates its
 * COMPUTED COLOUR at 4.5 to one against the worst plate ground it measured
 * anywhere in the game - the courtyard, where the translucent plate sits over
 * sunlit sand. That ground measures 0.010 in relative luminance, which puts the
 * floor for any HUD text at
 *
 *     (L + 0.05) / (0.010 + 0.05) >= 4.5   ->   L >= 0.22
 *
 * Four of the pigments above are BELOW that line and are therefore fills,
 * frames and marks only. They must never be handed to text on this HUD:
 *
 *     lapis      L 0.112   ratio 2.70    the arcane FILL
 *     carnelian  L 0.105   ratio 2.59    the danger FILL
 *     goldDeep   L 0.212   ratio 4.36    the underside of a cut
 *     faience    L 0.224   ratio 4.57    passes, but with nothing in hand
 *
 * and the three that were added so those meanings could still be SAID:
 *
 *     goldMid       L 0.269   ratio 5.31
 *     carnelianLit  L 0.228   ratio 4.64
 *     lapisLit      L 0.281   ratio 5.52
 *
 * So the two roles that carry meaning in text - dim and arcane - are given
 * their own legible values rather than being borrowed from the fill. This is
 * the reason `textDim` is goldMid and not goldDeep, and the reason there is an
 * `arcaneText` at all: a lapis label is unreadable and a lapis frame around a
 * bone numeral is the actual Egyptian move anyway. Ornament in the frame.
 *
 * Semantic roles. ALWAYS reach for these, not for a pigment name.
 *
 * A surface that says `role.danger` keeps meaning the right thing when the
 * danger colour is retuned. A surface that says `carnelian` has hardcoded a
 * decision it does not own.
 */
export const ROLE = {
  text:        PIGMENT.goldLeaf,
  textBright:  PIGMENT.linen,
  textDim:     PIGMENT.goldMid,     // NOT goldDeep: 4.31 to one, under the floor

  ready:       PIGMENT.goldHot,     // affordable, usable, charged
  danger:      PIGMENT.carnelian,   // hurt, denied, cannot afford  (FILL ONLY)
  dangerText:  PIGMENT.carnelianLit,
  arcane:      PIGMENT.lapis,       // power, upgrade, the puzzle   (FILL ONLY)
  arcaneText:  PIGMENT.lapisLit,    // the same meaning, said in a legible value
  active:      PIGMENT.faience,     // switched on, in progress

  frame:       PIGMENT.goldLeaf,
  ground:      PIGMENT.stone,
  groundDeep:  PIGMENT.shadow,
  incision:    PIGMENT.plaster,
};

// ---------------------------------------------------------------------------
// helpers - DOM and canvas both
// ---------------------------------------------------------------------------

/** `rgba()` from a pigment triple. The only way colour should reach a surface. */
export const ink = ([r, g, b], a = 1) =>
  a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;

/** Mix two triples. For gradients and for state transitions between roles. */
export const blend = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

// ---------------------------------------------------------------------------
// structure
// ---------------------------------------------------------------------------

/**
 * Geometry of the language. Shared so a cartouche on the pause menu and a
 * cartouche on the HUD are the same object at different sizes.
 *
 * `cartoucheRadius` is deliberately a full half-height by default: a real
 * cartouche is an oblong with SEMICIRCULAR ends, not a rounded rectangle, and
 * the difference between r = h/2 and r = 8px is the difference between reading
 * as Egyptian and reading as a web component.
 */
export const FORM = {
  cartoucheRadius: 'calc(min(1em, 50%))',

  /**
   * ADDED. The radius for a surface that is ONE LINE TALL - the buy prompt, the
   * notice, the grenade hint.
   *
   * `cartoucheRadius` is right for a data panel, where a full half-height would
   * eat the corners the readouts stand in. On a single-line pill there is
   * nothing in the corners to protect, and the note above applies without a
   * caveat: an oblong with genuinely semicircular ends is a cartouche and a
   * 12px rounded rectangle is a web component. Any radius past half the height
   * clamps to exactly half, so this is r = h/2 stated in a way that does not
   * need to know h.
   */
  pillRadius:      '999px',

  hairline:        1,      // px. A register rule is thin and exact.
  ruleGap:         3,      // px between the paired lines of a register rule.
  incisionDepth:   1,      // px offset of the carved inner shadow.
  frameInset:      4,      // px from panel edge to frame line.
  friezeStep:      6,      // px. One kheker in the frieze; see khekerFrieze.

  // Type. Egyptian formal writing is monumental and widely spaced; that reads
  // correctly on a label and terribly on a number you must parse instantly.
  labelTracking:   '0.16em',
  numeralTracking: '0',
};

/**
 * Text that reads as carved rather than printed.
 *
 * A chisel cut in plaster with gold in it has a dark edge where the cut goes in
 * and a lit edge where the light catches the far wall of the groove. Two text
 * shadows, one dark and down, one light and up, at one pixel. More than a pixel
 * and it stops being an incision and becomes a bevel, which reads as nineties
 * software rather than as stone.
 */
export const incised = (glow = 0) => {
  const base = `0 ${FORM.incisionDepth}px 0 ${ink(PIGMENT.shadow, 0.85)},` +
               ` 0 -${FORM.incisionDepth}px 0 ${ink(PIGMENT.goldDeep, 0.35)}`;
  return glow > 0 ? `${base}, 0 0 ${glow}px ${ink(PIGMENT.goldHot, 0.5)}` : base;
};

/**
 * The paired horizontal line that separates registers in Egyptian wall art.
 * Returned as a CSS background so it can sit on any element without extra DOM.
 */
export const registerRule = (colour = ROLE.frame, a = 0.42) =>
  `linear-gradient(${ink(colour, a)} ${FORM.hairline}px, transparent ${FORM.hairline}px)` +
  ` 0 0 / 100% ${FORM.hairline + FORM.ruleGap}px repeat-x`;

/**
 * ADDED. The register rule as a DIVIDER: the actual pair of lines, anchored to
 * one edge of the element rather than tiled from the top.
 *
 * `registerRule` above is left exactly as it was - a repeating band, which is
 * what you want for a ground - but a divider between two bands of a panel is a
 * different object: two hairlines with `ruleGap` between them, the near one
 * stronger than the far one, sitting on the edge where the border used to be.
 * Every divider on the HUD is that, so it is here rather than hand-rolled four
 * times, which is the whole argument of this file.
 *
 * Returns a `background` shorthand; the caller sets `border: 0` on that edge.
 *
 * @param {'top'|'bottom'} edge
 */
export const registerRules = (edge = 'bottom', colour = ROLE.frame, a = 0.42) => {
  const near = edge === 'top' ? '0 0' : '0 100%';
  const far = edge === 'top'
    ? `0 ${FORM.hairline + FORM.ruleGap}px`
    : `0 calc(100% - ${FORM.hairline + FORM.ruleGap}px)`;
  const line = (alpha) =>
    `linear-gradient(${ink(colour, alpha)}, ${ink(colour, alpha)})`;
  return `${line(a)} ${near} / 100% ${FORM.hairline}px no-repeat,`
    + ` ${line(a * 0.55)} ${far} / 100% ${FORM.hairline}px no-repeat`;
};

/**
 * Canvas: the stepped kheker frieze that runs along the top of a wall.
 *
 * For the minimap border and any canvas panel edge. Kept here rather than in
 * minimap.js because the pause menu wants the same motif and two hand-rolled
 * versions of a frieze is exactly how a design language dies.
 */
export function khekerFrieze(ctx, x, y, w, step = 6, colour = ROLE.frame, a = 0.5) {
  ctx.save();
  ctx.strokeStyle = ink(colour, a);
  ctx.lineWidth = FORM.hairline;
  ctx.beginPath();
  for (let i = 0; i * step * 2 < w; i++) {
    const x0 = x + i * step * 2;
    ctx.moveTo(x0, y + step);
    ctx.lineTo(x0, y);
    ctx.lineTo(x0 + step, y);
    ctx.lineTo(x0 + step, y + step);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Canvas: a cartouche path - an oblong with semicircular ends.
 * Caller strokes or fills; this only builds the path.
 */
export function cartouchePath(ctx, x, y, w, h) {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
}
