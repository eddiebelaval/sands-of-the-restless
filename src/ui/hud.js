/**
 * THE HUD: the readouts, and the strip of boons.
 *
 * What was here read as a debug overlay, and the reason was not the typeface or
 * the colour - both were already the game's - it was that every readout was bare
 * text floating on the frame with a one-pixel shadow under it. That works over a
 * dark chamber and fails completely over the sunlit avenue, which is half the
 * game. Measured against the courtyard frame with test/hud.mjs, standing on
 * nothing: the objective line scored 1.01 to one against what was behind it and
 * the ammunition readout 1.84, over sand at luma 103. A HUD cannot be legible on
 * one of two backgrounds.
 *
 * So every cluster now stands on its own plate, and the plate is the whole fix:
 * a nearly opaque dark ground with a gold hairline, which is the SAME object the
 * buy prompt and the boon chips have always been - see #prompt in index.html,
 * which is the closest thing this project had to a reference and is the thing
 * the owner has said feels right. The same two readouts on plates measure 4.71
 * and 6.92 to one in the same frame, and every other moment is easier.
 *
 * Applied consistently, and given a value structure: label in gold at 9px,
 * figure in bone at 26px. The player reads the figure in peripheral vision and
 * never has to read the label at all, which is the only test a HUD element in a
 * shooter has to pass.
 *
 * Nothing in here decides anything. Every number comes from the system that owns
 * it and this subscribes, or is handed the value once a frame, and paints.
 */

/**
 * The boon strip: which shrines you are carrying, and how many slots are left.
 *
 * A perk you cannot see is a perk you forget you bought. This genre solves it
 * the same way every time - a row of small marks somewhere the eye passes over
 * anyway - and the reason it works is that the row shows the EMPTY slots too.
 * "Two of four" is a different piece of information from "two", and it is the
 * one that decides whether the player walks past the next shrine or stops at it.
 *
 * The colours come from world/build.js, which is the same table the shrine
 * flames burn in. That is not tidiness for its own sake: the whole reason the
 * six shrines are told apart at range is colour, and a HUD chip in a different
 * blue from the fire it represents would break the one association the player
 * has actually learned.
 *
 * Everything here writes DOM and nothing here decides anything. What a boon
 * costs and what it does is systems/shrines.js; this subscribes and paints.
 */

import { BOON_LOOK } from '../world/build.js';
import {
  PIGMENT, ROLE, FORM, ink, incised, registerRules,
} from './tokens.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// ---------------------------------------------------------------------------
// the material
// ---------------------------------------------------------------------------

/**
 * THE EGYPTIAN MATERIAL PASS, as one injected stylesheet.
 *
 * WHY A STYLESHEET FROM HERE rather than an edit to index.html: the frame is
 * owned by another session this hour, and a merge conflict in the one file
 * every surface shares costs more than the feature. But the deeper reason is
 * the one src/ui/tokens.js was written for - the language now has a single
 * source, and a stylesheet BUILT from that source cannot drift from it the way
 * a hand-typed rgba() in a second file can. Every colour, radius and rule below
 * is a token; there is not one literal in it.
 *
 * WHAT IT CHANGES, and what it deliberately does not. Layout, hierarchy and
 * timing are untouched: ammunition is still bottom right in the same figures at
 * the same size, vitality is still bottom left, the centre of the screen is
 * still empty. What changes is what the panels are MADE of - a cartouche
 * incised into painted plaster with gold in the cut, register rules where there
 * were borders, carved labels, and lapis wherever the game means something
 * arcane rather than mechanical.
 *
 * SCOPED TO `#hud` ON PURPOSE. `.plate` is a shared object and the pause sheet
 * is one, but that sheet belongs to another pass landing at the same time.
 * `#hud .plate` is a tenth of a point more specific than `.plate`, applies to
 * every plate this file owns, and reaches nothing outside the HUD.
 *
 * Idempotent, and called from every factory in this file and from
 * ui/objective.js, so no wiring in main.js has to know it exists.
 */

const SHEET_ID = 'egyptian-language';

/** Shorthands, so the sheet below reads as design rather than as plumbing. */
const G = ROLE.frame;              // gold leaf: frames, rules, primary labels
const GM = ROLE.textDim;           // gold mid: the quiet label that still reads
const HOT = ROLE.ready;            // gold hot: the lit edge of a cut
const LAP = ROLE.arcane;           // lapis: the arcane FILL
const LAPT = ROLE.arcaneText;      // lapis lit: the arcane label
const DGR = ROLE.danger;           // carnelian: the danger FILL
const SH = PIGMENT.shadow;
const PL = PIGMENT.plaster;
const BONE = ROLE.textBright;

/**
 * The frieze band that runs across the top of a plate.
 *
 * Two hairlines with `ruleGap` between them, tapered at both ends so the rule
 * dies into the stone rather than butting the frame - which is what an incised
 * register line actually does, and what stops the plate reading as a box with a
 * stripe on it. The upper line carries `goldHot` at its midpoint: that is the
 * light catching the far wall of the groove, and it is the single mark that
 * makes the panel read as CUT rather than as printed.
 */
const topRule = (colour = G, lit = HOT) => `
    linear-gradient(90deg, transparent,
      ${ink(colour, 0.55)} 12%, ${ink(lit, 0.95)} 50%, ${ink(colour, 0.55)} 88%,
      transparent) 0 0 / 100% ${FORM.hairline}px no-repeat,
    linear-gradient(90deg, transparent,
      ${ink(colour, 0.26)} 12%, ${ink(colour, 0.42)} 50%, ${ink(colour, 0.26)} 88%,
      transparent) 0 100% / 100% ${FORM.hairline}px no-repeat`;

/** The two vertical ties that close a cartouche at each end. */
const tieBars = (colour = G, a = 0.62) => `
    linear-gradient(${ink(colour, a)}, ${ink(colour, a * 0.35)})
      left center / ${FORM.hairline}px 100% no-repeat,
    linear-gradient(${ink(colour, a)}, ${ink(colour, a * 0.35)})
      right center / ${FORM.hairline}px 100% no-repeat`;

function styleSheetText() {
  return `
/* ==========================================================================
   1. THE PLATE BECOMES A CARTOUCHE
   ========================================================================== */

#hud .plate {
  border-radius: ${FORM.cartoucheRadius};
  /* Painted plaster over the near-black ground. The plaster only shows in the
     top band, where light would fall on a wall, and it fades out well before
     the numerals - the ground under a figure stays as dark as it ever was.

     A MEASURED NON-CAUSE, recorded because the next person to see the number
     move will suspect this band first, as I did, and be wrong.

     test/hud.mjs gates every cluster at 4.5 to one and takes the plate's
     luminance as the 20th PERCENTILE inside the readout's box, so a band across
     the top of a plate is the obvious suspect for a fallen ratio. The vitality
     plate had dropped from 5.98 to 4.79 in the fight frame, so this was halved
     from .34 to .18 - and the ratio went to 4.74. It got very slightly WORSE.
     The plaster is worth about a hundredth of a stop and is not the mechanism;
     the real one is in the state block near the bottom of this sheet. Set here
     for how it looks, which is what it was always for. */
  background:
    linear-gradient(180deg, ${ink(PL, 0.26)} 0, ${ink(PL, 0.05)} 22px, transparent 44px),
    linear-gradient(180deg, ${ink(SH, 0.955)}, ${ink(SH, 0.90)});
  border: ${FORM.hairline}px solid ${ink(G, 0.38)};
  /* THE INCISION. A dark ring immediately inside the gold line is the cut
     going in; the outer ring and the drop are the panel standing off the wall.
     One pixel, per FORM.incisionDepth - at two it stops being a chisel mark
     and becomes a bevel, which reads as nineties software. */
  box-shadow:
    inset 0 0 0 ${FORM.hairline}px ${ink(SH, 0.88)},
    inset 0 ${FORM.incisionDepth * 2}px ${FORM.incisionDepth * 3}px ${ink(SH, 0.55)},
    0 0 0 ${FORM.hairline}px ${ink(SH, 0.55)},
    0 10px 30px ${ink(SH, 0.55)};
}

/* The gilded top edge was one flat bar. It is now the register rule, inset
   inside the frame the way an incised line sits inside a panel's border. */
#hud .plate::before {
  left: ${FORM.frameInset + 3}px;
  right: ${FORM.frameInset + 3}px;
  top: ${FORM.frameInset - 1}px;
  height: ${FORM.hairline * 2 + FORM.ruleGap}px;
  background: ${topRule()};
}

/* ---- THE SINGLE-LINE PILLS ----
   The buy prompt, the notice and the grenade hint are one line of text and
   nothing else, which is the one shape on this HUD that can take a TRUE
   cartouche: an oblong with semicircular ends and a tie bar at each end. There
   are no corners to protect because there is nothing in them. */
#hud #prompt,
#hud #notice,
#hud #frag-hint {
  border-radius: ${FORM.pillRadius};
  padding-left: 26px;
  padding-right: 26px;
}
#hud #prompt::before,
#hud #notice::before,
#hud #frag-hint::before {
  left: 11px; right: 11px; top: 5px; bottom: 5px;
  height: auto;
  background: ${tieBars()};
}
/* Cannot afford it, or it is not for sale at any price. Restated here because
   index.html paints the OLD top bar red, and that rule would otherwise put a
   carnelian gradient across the whole interior of the pill - over the text,
   because a positioned pseudo-element paints above in-flow content. */
#hud #prompt.deny { border-color: ${ink(DGR, 0.60)}; }
#hud #prompt.deny::before { background: ${tieBars(DGR, 0.85)}; }

/* ==========================================================================
   2. CARVED TEXT ON LABELS, PRINTED TEXT ON NUMBERS
   ========================================================================== */

#hud .readout .cap,
#hud .card-head,
#hud #boss-name,
#hud .map-foot,
#hud .obj-where,
#hud #r-ammo .wave,
#hud .power u,
#hud .ws-take b {
  text-shadow: ${incised()};
  letter-spacing: ${FORM.labelTracking};
}

/* .obj-detail is deliberately NOT in that list. It is the price line, and half
   of what it says is a figure the player is comparing against their purse -
   "1000 GOLD - 500 SHORT" - so it is a number wearing a label's clothes, and a
   carved edge on a 10px numeral costs more than the carving is worth. */

/* NOT ON THE FIGURES. A one-pixel dark edge under a 30px numeral costs more
   legibility than the carving buys, and the whole rule of this pass is that
   ornament belongs in the frame and never in the number. */
#hud .readout .val,
#hud #r-ammo b,
#hud #r-ammo i,
#hud #r-ammo .wave u,
#hud .power s {
  text-shadow: none;
  letter-spacing: ${FORM.numeralTracking};
}

/* ==========================================================================
   3. REGISTER RULES WHERE THERE WERE BORDERS
   ========================================================================== */

#hud .card-head {
  border-bottom: 0;
  background: ${registerRules('bottom', G, 0.50)};
  color: ${ink(G, 0.98)};
}
#hud #r-ammo .wave {
  border-top: 0;
  background: ${registerRules('top', G, 0.44)};
  padding-top: 9px;
}
#hud .map-foot { color: ${ink(GM)}; }
#hud .obj-where { color: ${ink(GM)}; }

/* ==========================================================================
   4. LAPIS: THE ARCANE, WHICH THE PALETTE HAD NONE OF
   ========================================================================== */

/* ---- a gate gold cannot buy ----
   ui/objective.js already distinguishes "come back richer" from "come back
   later" in its copy - a price versus THE KINDLING IS COLD - and until now
   said both in the same gold. The blocked objective is the arcane one, so it
   wears the inlay: lapis down the binding edge with a lit hairline beside it,
   which is a stone inlay set into a gold channel and is the single most
   Egyptian object available. */
#hud #objective.arcane {
  box-shadow:
    inset 3px 0 0 ${ink(LAP)},
    inset ${3 + FORM.hairline}px 0 0 ${ink(LAPT, 0.85)},
    inset 0 0 0 ${FORM.hairline}px ${ink(SH, 0.88)},
    0 0 0 ${FORM.hairline}px ${ink(SH, 0.55)},
    0 10px 30px ${ink(SH, 0.55)};
  border-color: ${ink(LAPT, 0.42)};
}
#hud #objective.arcane .obj-detail { color: ${ink(LAPT)}; }
#hud #objective.arcane .card-head { color: ${ink(LAPT)}; }
#hud #objective.arcane .card-head .ico { stroke: ${ink(LAPT)}; }

/* ---- a weapon that has been through the Altar ----
   The gun comes back with a title, and the HUD says so in words already. The
   inlay says it without being read: an upgraded weapon is the only thing in
   the bottom-right corner that is ever blue. The NUMERALS are untouched. */
#hud #r-ammo.renewed {
  box-shadow:
    inset -3px 0 0 ${ink(LAP)},
    inset -${3 + FORM.hairline}px 0 0 ${ink(LAPT, 0.85)},
    inset 0 0 0 ${FORM.hairline}px ${ink(SH, 0.88)},
    0 0 0 ${FORM.hairline}px ${ink(SH, 0.55)},
    0 10px 30px ${ink(SH, 0.55)};
  border-color: ${ink(LAPT, 0.42)};
}
#hud #r-ammo.renewed [data-weapon] { color: ${ink(LAPT)}; }

/* ==========================================================================
   5. THE STATES THAT WERE ALREADY RIGHT, RESTATED IN TOKENS
   ==========================================================================
   index.html sets these with the same specificity this sheet uses, and this
   sheet is later in the cascade - so a border colour left unsaid here would be
   overwritten by the base plate rule above and the hurt plate would stop
   turning red. Restated rather than dropped, in the danger token.

   ---------------------------------------------------------------------------
   THE GOLD IN THE CUT NEVER CHANGES COLOUR, and this is a rule I arrived at by
   breaking it and being caught by the suite.
   ---------------------------------------------------------------------------

   The first version of this block also repainted the register rule itself in
   carnelian for the hurt plate, and in lapis for the arcane objective and the
   renewed ammunition plate - the whole panel goes to the state colour, which
   sounds right and measures wrong.

   In the hurt state the numeral is #ff8a6c, relative luminance 0.31, which is
   DIMMER than gold leaf at 0.476. So in the fight frame the brightest thing
   inside the vitality plate was never the number, it was that gold bar across
   the top; test/hud.mjs takes the ink as the 97th percentile of the box, found
   the bar, and scored 5.98 to one. Painting the bar carnelian took the
   brightest object out of the box and the ratio fell to 4.74 - a quarter of a
   stop above a WCAG floor, on the one readout a player checks while something
   is killing them.

   So the rule is now the material and only the material. Gold is IN THE STONE;
   it does not change because the news changed. The state is carried by the
   frame, the inlay and the text - three signals, all of which the screenshots
   show reading clearly - and the cut stays gold in every one of them. That is
   both the safer number and the more honest object. */

#hud #r-health.hurt { border-color: ${ink(DGR, 0.70)}; }
#hud #r-frag.cooking { border-color: ${ink(DGR, 0.75)}; }
#hud #boss { border-color: ${ink(DGR, 0.45)}; }
#hud #boss-track { border-radius: ${FORM.pillRadius}; }

/* The boon chips and the shrine marks are a family with the power-up marks and
   are keyed to the flame colours, which are not this pass's to retune. They get
   the form and not the colour: a boon chip is a little cartouche. */
#hud .boon {
  border-radius: ${FORM.pillRadius};
  border-color: ${ink(G, 0.30)};
  box-shadow: inset 0 0 0 ${FORM.hairline}px ${ink(SH, 0.8)};
}
#hud .boon.held { border-color: ${ink(G, 0.50)}; }

/* ==========================================================================
   6. WEAPON SELECT
   ==========================================================================
   Built by createWeaponSelect below. Bottom right, directly above the
   ammunition plate, because the question it answers is the ammunition plate's
   question - what am I holding - and an answer that appears somewhere else
   makes the eye travel for it. */

#hud #weapon-select {
  position: absolute;
  right: 22px;
  /* Measured, not guessed. #r-ammo stands from 62 to 166 up the right edge, and
     the first version of this sat at 168 - a two pixel gap, which is not a gap,
     it is two plates that look like one badly drawn plate. 180 leaves fourteen,
     which is the same air the left column keeps between the map and the
     tracker. The overlap check in the verification script measures it. */
  bottom: 180px;
  min-width: 214px;
  padding: 13px 14px 10px;
  text-align: right;
  /* Opacity only, like #frag-hint: a transform here would move a plate whose
     whole value is being in the same place every time. */
  opacity: 0;
  transition: opacity .16s ease-out;
}
/* THE hidden ATTRIBUTE NEEDS HELP HERE, ON THREE ELEMENTS, and this is not
   defensive tidying - it is the bug this project has shipped more than once.
   The user agent hides [hidden] with a display:none at user-agent origin,
   which ANY author display beats. Every one of these three sets its own
   display below or in index.html, so without these rules the code would set
   hidden, read it back as true, and the element would still be on the screen.
   The empty slot digit on a weapon with no binding is exactly that case. */
#hud #weapon-select[hidden] { display: none; }
#hud #weapon-select .ws-slots[hidden] { display: none; }
#hud .key-cap[hidden] { display: none; }
#hud #weapon-select.on { opacity: 1; }

#hud #weapon-select .ws-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  white-space: nowrap;
}

#hud #weapon-select .ws-take { padding-bottom: 8px; }
#hud #weapon-select .ws-take b {
  font-weight: normal;
  font-size: 16px;
  color: ${ink(BONE)};
  text-transform: uppercase;
}
#hud #weapon-select .ws-take s {
  text-decoration: none;
  font-size: 12px;
  color: ${ink(GM)};
  margin-right: auto;
}

/* The register rule between the two rows. The whole card is one cartouche cut
   into two registers, which is how an Egyptian wall divides a scene from the
   scene under it. */
#hud #weapon-select .ws-stow {
  border-top: 0;
  background: ${registerRules('top', G, 0.44)};
  padding-top: 8px;
}
#hud #weapon-select .ws-stow em {
  font-style: normal;
  font-size: 8px;
  letter-spacing: ${FORM.labelTracking};
  color: ${ink(G, 0.95)};
  text-shadow: ${incised()};
  margin-right: auto;
}
#hud #weapon-select .ws-stow u {
  text-decoration: none;
  font-size: 10px;
  letter-spacing: ${FORM.labelTracking};
  text-transform: uppercase;
  color: ${ink(GM)};
  text-shadow: ${incised()};
}
/* A renewal is not a swap. Same card, one word different, and the word is
   derived from the slot not moving rather than from anyone announcing it. */
#hud #weapon-select.renewed .ws-stow em { color: ${ink(LAPT)}; }
#hud #weapon-select.renewed .ws-take b { color: ${ink(BONE)}; }

/* ---- THE RACK ----
   One mark per slot, in the same rotated square the boon chips and the
   power-up marks are, so the three strips read as one family of things you are
   carrying. Empty sockets are drawn as well as full ones for the reason the
   boon strip already argues: "four of seven" is a different piece of
   information from "four". */
#hud #weapon-select .ws-slots {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 10px;
}
#hud #weapon-select .ws-slots i {
  display: block;
  width: 7px; height: 7px;
  transform: rotate(45deg);
  background: transparent;
  /* An EMPTY SOCKET HAS TO BE VISIBLE or the rack says "four" instead of "four
     of seven", which is the only reason it is drawn at all. At 0.26 the two
     unbought slots were there in the DOM and gone in the screenshot at
     gameplay scale - the boon strip solved the same problem by holding its
     empty marks at .55 rather than hiding them. */
  box-shadow: inset 0 0 0 ${FORM.hairline}px ${ink(G, 0.42)};
}
#hud #weapon-select .ws-slots i.owned {
  background: ${ink(G, 0.75)};
  box-shadow: none;
}
#hud #weapon-select .ws-slots i.renewed {
  background: ${ink(LAP)};
  box-shadow: inset 0 0 0 ${FORM.hairline}px ${ink(LAPT, 0.9)};
}
#hud #weapon-select .ws-slots i.live {
  width: 10px; height: 10px;
  background: ${ink(BONE)};
  box-shadow: 0 0 7px ${ink(HOT, 0.55)};
}
#hud #weapon-select .ws-slots i.live.renewed {
  background: ${ink(LAPT)};
  box-shadow: 0 0 8px ${ink(LAPT, 0.6)};
}
`;
}

let sheetInstalled = false;

/**
 * Put the language on the page. Safe to call from anywhere, any number of
 * times, and a no-op with no document - which is what a node-side import of
 * this module needs.
 */
export function installLanguage(doc = (typeof document === 'undefined' ? null : document)) {
  if (sheetInstalled || !doc || !doc.head) return false;
  const el = doc.createElement('style');
  el.id = SHEET_ID;
  el.textContent = styleSheetText();
  doc.head.appendChild(el);
  sheetInstalled = true;
  return true;
}

export function createBoonStrip(el, shrines) {
  if (!el) return { dispose() {} };
  installLanguage(el.ownerDocument);

  // Chips are reused rather than rebuilt. The strip repaints on every purchase
  // and on every cap change, which is rare, but a run that ends with the player
  // dropping and re-taking Anubis six times should not leave six generations of
  // dead nodes behind it.
  const chips = [];

  function chipAt(i) {
    if (chips[i]) return chips[i];

    const chip = document.createElement('span');
    chip.className = 'boon';

    const dot = document.createElement('i');
    chip.appendChild(dot);

    const label = document.createElement('b');
    chip.appendChild(label);

    el.appendChild(chip);
    chips[i] = { chip, dot, label };
    return chips[i];
  }

  function paint(list, capacity) {
    for (let i = 0; i < capacity; i++) {
      const { chip, label } = chipAt(i);
      const boon = list[i];

      chip.hidden = false;

      if (boon) {
        const look = BOON_LOOK[boon.id];
        chip.classList.add('held');
        chip.style.setProperty('--boon', look ? hex(look.emissive) : '#d9b26a');
        // The god, not the effect. The effect is four words and the player
        // already read it when they bought it; the name is what they will use
        // to think about the map.
        label.textContent = boon.id.toUpperCase();
      } else {
        chip.classList.remove('held');
        chip.style.setProperty('--boon', '#4a3d29');
        label.textContent = '';
      }
    }

    // Slots past the current capacity are hidden rather than removed, because
    // the canopic puzzle raises the cap mid-run and the strip has to grow.
    for (let i = capacity; i < chips.length; i++) chips[i].chip.hidden = true;
  }

  const unsubscribe = shrines.subscribe(paint);

  return {
    paint,
    dispose() { unsubscribe(); },
  };
}

// ---------------------------------------------------------------------------
// the power-up strip
// ---------------------------------------------------------------------------

/**
 * WHICH BOONS ARE BURNING, AND FOR HOW MUCH LONGER.
 *
 * A timed power-up with no on-screen clock is a power-up the player finds out
 * about twice: once when the screen said something, and once when their gun
 * stops one-shotting. Both facts have to be glanceable, and "which one is
 * running" has to survive TWO of them being running at once - which is why this
 * is a stack of chips rather than one line that the second effect overwrites.
 *
 * Each chip carries three things and they are in priority order for a player who
 * is being chased: a coloured mark, THE PLAIN MEANING in the largest type on the
 * chip, and the name underneath it. The Egyptian name is the flavour and the
 * player will use it to talk about the game; it is not what they need to read
 * with four husks on them. Underneath both is a bar that empties, because a
 * number counting down is read and a bar that is nearly gone is SEEN.
 *
 * Nothing here decides anything: systems/powerups.js owns what is running and
 * for how long, this is handed the list once a frame and paints it. The Fire
 * Sale row in that list comes from the chest rather than from the power-up
 * system, for the reason stated there.
 */
export function createPowerStrip(el, powerups) {
  if (!el || !powerups) return { update() {}, rows: [] };

  const rows = [];
  // What each row currently shows, so the common case - sixty frames a second
  // with nothing running - touches no DOM at all.
  const painted = [];

  function rowAt(i) {
    if (rows[i]) return rows[i];

    const chip = document.createElement('div');
    chip.className = 'power plate';

    const dot = document.createElement('i');
    chip.appendChild(dot);

    const body = document.createElement('div');
    body.className = 'power-body';

    const plain = document.createElement('b');
    const name = document.createElement('u');
    body.appendChild(plain);
    body.appendChild(name);
    chip.appendChild(body);

    const secs = document.createElement('s');
    chip.appendChild(secs);

    const track = document.createElement('span');
    const fill = document.createElement('em');
    track.appendChild(fill);
    chip.appendChild(track);

    el.appendChild(chip);
    rows[i] = { chip, plain, name, secs, fill };
    painted[i] = { id: null, secs: null, frac: -1 };
    return rows[i];
  }

  function update() {
    const list = powerups.active();

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const row = rowAt(i);
      const was = painted[i];

      if (row.chip.hidden) row.chip.hidden = false;

      if (was.id !== e.id) {
        was.id = e.id;
        row.plain.textContent = e.plain;
        row.name.textContent = e.name;
        row.chip.style.setProperty('--power', hex(e.colour));
      }

      // Ceil, so a chip never reads 0 while its effect is still running.
      const secs = Math.max(0, Math.ceil(e.left));
      if (secs !== was.secs) {
        was.secs = secs;
        row.secs.textContent = secs;
      }

      const frac = e.duration > 0 ? Math.max(0, Math.min(1, e.left / e.duration)) : 0;
      if (Math.abs(frac - was.frac) > 0.004) {
        was.frac = frac;
        // A transform, which the compositor takes off the main thread, rather
        // than a width, which is a layout every frame an effect is running.
        row.fill.style.transform = `scaleX(${frac.toFixed(3)})`;
      }
    }

    for (let i = list.length; i < rows.length; i++) {
      if (rows[i].chip.hidden) continue;
      rows[i].chip.hidden = true;
      painted[i].id = null;
      painted[i].secs = null;
      painted[i].frac = -1;
    }
  }

  return { update, rows, painted };
}

// ---------------------------------------------------------------------------
// ordnance
// ---------------------------------------------------------------------------

/**
 * HOW MANY GRENADES, WHICH KEY THROWS ONE, AND HOW LONG THE FUSE HAS LEFT.
 *
 * This exists because of a bug that no suite could have caught and that the
 * owner found in ten minutes of play: "I don't know how to use a grenade."
 *
 * systems/grenades.js is a complete mechanic - a held key that pulls the pin, a
 * 3.4 second fuse that starts THEN rather than on release, self-damage on the
 * curve every other body takes, bounce physics against the same colliders the
 * player walks into, a supply with a cap and a per-wave dividend, six pooled
 * shells - and its own header says the HUD reads `count` and `cook`. It did
 * not. Nothing did. The binding was stated in exactly one place, the title
 * screen's control list, which is gone the moment the player clicks Enter, and
 * the count and the fuse were stated nowhere at all. The most interesting
 * decision in the game was invisible.
 *
 * So three marks, at three distances, and each answers a different question the
 * player has at a different moment:
 *
 *   THE PLATE   how many, always, whether or not one is in hand. Peripheral,
 *               bottom-left, in the same shape as vitality. Answers "do I have
 *               an answer to this room" before the room happens.
 *   THE KEY     printed on the plate, permanently. Answers "which key", which
 *               is the question the owner was actually asking when he said he
 *               was hunting for it.
 *   THE FUSE    a ring at the crosshair that DRAINS and goes red. Answers "how
 *               long have I got", at the only place on the screen a player
 *               holding a live grenade is looking.
 *
 * Nothing here decides anything, exactly as with every other readout in this
 * file: systems/grenades.js owns the count, the clock and the wager, and this
 * is handed the numbers once a frame and paints them.
 */
export function createGrenadeReadout(root = document, opts = {}) {
  installLanguage(root.ownerDocument || (typeof document === 'undefined' ? null : document));

  const q = (sel) => root.querySelector(sel);

  const plate = q('#r-frag');
  const countEl = q('[data-frag]');
  const pipsEl = q('[data-frag-pips]');
  const ringEl = q('#cook');
  const burnEl = q('[data-cook-burn]');
  const hintEl = q('#frag-hint');

  /** Circumference of the ring in index.html. 2 * PI * r, r = 17. */
  const CIRC = 106.81;

  /**
   * Where the fuse stops being a clock and starts being a warning.
   *
   * Not halfway. The blast is lethal to a full-health player inside 4.6 m and a
   * thrown shell needs roughly a second of flight to be outside that, so a
   * grenade held past about 60 per cent of the fuse is already a grenade that
   * will hurt whoever threw it. The colour turns where the DECISION turns, not
   * where the arithmetic halves.
   */
  const HOT = 0.44;
  const DANGER = 0.72;

  const max = Math.max(1, opts.max || 4);

  // Built once. The cap does not move at runtime - unlike the boon strip, which
  // the canopic puzzle grows - so this is a fixed row and there is no path that
  // has to rebuild it.
  const pips = [];
  if (pipsEl) {
    for (let i = 0; i < max; i++) {
      const pip = document.createElement('i');
      pipsEl.appendChild(pip);
      pips.push(pip);
    }
  }

  const painted = {
    count: null, cooking: null, cook: -1, band: null, out: null,
  };

  /**
   * The hint, and the whole of its life.
   *
   * `armed` goes true on the first frame the player is in the game holding at
   * least one grenade; `spent` goes true when the hint has had its time or when
   * a pin comes out, whichever is first, and once spent it can never come back.
   * That is deliberately the entire state machine. A player who has already
   * thrown one does not need to be told how, and a player who has read it once
   * and ignored it will not be persuaded by a second showing.
   */
  let hintLeft = opts.hintSeconds ?? 7;
  let hintState = 'waiting';   // waiting -> showing -> spent

  function retireHint() {
    if (hintState === 'spent') return;
    hintState = 'spent';
    if (hintEl) {
      hintEl.classList.remove('on');
      hintEl.hidden = true;
    }
  }

  /**
   * @param {object} s
   * @param {number} s.count    grenades in the pouch, 0..max
   * @param {boolean} s.cooking is the pin out
   * @param {number} s.cook     0..1, where 1 goes off in your hand
   * @param {number} dt         CLAMPED frame delta, for the hint's own clock
   */
  function update(s, dt = 0) {
    const count = Math.max(0, Math.min(max, s.count | 0));

    if (count !== painted.count) {
      painted.count = count;
      if (countEl) countEl.textContent = count;
      for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < count);
    }

    const out = count === 0;
    if (out !== painted.out) {
      painted.out = out;
      if (plate) plate.classList.toggle('out', out);
    }

    // --- the fuse -----------------------------------------------------------
    const cooking = !!s.cooking;
    if (cooking !== painted.cooking) {
      painted.cooking = cooking;
      if (plate) plate.classList.toggle('cooking', cooking);
      // A CLASS, not `.hidden`. See index.html: the ring is an SVGElement, and
      // `hidden` is an HTMLElement property, so assigning it there sets an
      // expando that reads back correctly and hides nothing. The first version
      // of this line cost the fuse its entire visibility while every state
      // assertion about it passed.
      if (ringEl) ringEl.classList.toggle('live', cooking);
      // Reset the band on the way in, so a second cook does not start in the
      // colour the first one ended on for the frame before the write below.
      if (!cooking) {
        painted.band = null;
        painted.cook = -1;
        if (ringEl) ringEl.classList.remove('hot', 'danger');
      }
      // Pulling a pin retires the hint. Whatever it was for, it worked.
      if (cooking) retireHint();
    }

    if (cooking) {
      const cook = Math.max(0, Math.min(1, s.cook || 0));

      // Guarded like every other write in this file: this runs sixty times a
      // second and a dash offset written to the value it already holds still
      // dirties the SVG.
      if (Math.abs(cook - painted.cook) > 0.004) {
        painted.cook = cook;
        // DRAINS. The dash starts whole and is eaten, so the ring is a fuse
        // burning down rather than a meter filling up.
        if (burnEl) burnEl.style.strokeDashoffset = (CIRC * cook).toFixed(2);
      }

      const band = cook >= DANGER ? 'danger' : cook >= HOT ? 'hot' : 'cool';
      if (band !== painted.band) {
        painted.band = band;
        if (ringEl) {
          ringEl.classList.toggle('hot', band === 'hot');
          ringEl.classList.toggle('danger', band === 'danger');
        }
      }
    }

    // --- the hint -----------------------------------------------------------
    if (hintState === 'waiting' && count > 0 && hintEl) {
      hintState = 'showing';
      hintEl.hidden = false;
      // A frame between unhiding and the class, or the transition is coalesced
      // away and the line snaps in. Same reflow the flash needs, same reason.
      void hintEl.offsetWidth;
      hintEl.classList.add('on');
    } else if (hintState === 'showing') {
      // On the CLAMPED delta, not the wall clock. Under software rendering
      // simulated time runs several times slower than the wall, and a hint
      // measured against the wall would be gone before a slow machine had
      // finished drawing the first frame of the game behind it.
      hintLeft -= dt;
      if (hintLeft <= 0) retireHint();
    }
  }

  return {
    update,
    retireHint,
    pips,
    painted,
    get hintState() { return hintState; },
  };
}

// ---------------------------------------------------------------------------
// the full-frame flash
// ---------------------------------------------------------------------------

/**
 * ONE ELEMENT, FOR EVENTS THAT HAVE TO BE IMPOSSIBLE TO MISS.
 *
 * The Second Death kills everything alive in one frame, and a mass kill with no
 * screen event is a bug that looks like a bug: twenty bodies simply stop being
 * there. So the moment is three things at three distances - this, a ring
 * expanding through the world from the player's feet, and a camera that is
 * visibly hit - and this is the one that cannot be missed no matter where the
 * player is looking.
 *
 * The fade is a CSS animation on wall-clock time, which is correct HERE and only
 * here for the same reason the gold popups are: it is a readout, nothing in the
 * simulation depends on when it finishes, so it cannot desynchronise anything by
 * running at a different rate than the clamped frame delta.
 */
export function createFlash(el) {
  if (!el) return { fire() { return false; } };

  return {
    fire(colour = '#fff2cf', ms = 600) {
      el.style.setProperty('--flash', colour);
      el.style.setProperty('--flash-ms', `${ms}ms`);
      // Restart the animation. Removing the class and forcing a reflow before
      // adding it back is the only reliable way; without the reflow the browser
      // coalesces both writes and nothing happens on a second flash.
      el.classList.remove('on');
      void el.offsetWidth;
      el.classList.add('on');
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// weapon select
// ---------------------------------------------------------------------------

/**
 * WHAT YOU JUST PICKED UP, WHAT YOU JUST PUT DOWN, AND WHAT ELSE IS ON THE RACK.
 *
 * This surface did not exist. `weapons.cycle()` has been bound to the scroll
 * wheel and Digit1..Digit7 to `weapons.equip()` since the armoury was written,
 * seven weapons are bought across this map, and the only acknowledgement any of
 * it got was the name on the ammunition plate silently becoming a different
 * string. A player who scrolls twice has no idea what they scrolled past, and a
 * player who owns four guns has no idea they own four guns.
 *
 * THREE FACTS, IN THE ORDER A PLAYER BEING CHASED NEEDS THEM:
 *
 *   WHAT IS IN MY HANDS NOW   biggest, in bone, with its digit beside it and its
 *                             ammunition to the left. This is the only line that
 *                             matters if the card is read for a fifth of a
 *                             second, so it is the only line set at a size that
 *                             can be.
 *   WHAT I JUST STOWED        small, in the quiet gold, with ITS digit - which
 *                             is the fact that makes the swap reversible. A
 *                             player who scrolled past the shotgun and wants it
 *                             back needs the number, not the name.
 *   WHAT ELSE I OWN           one mark per slot, sockets drawn as well as guns,
 *                             which is the same argument the boon strip makes:
 *                             "four of seven" decides whether you walk past the
 *                             next wall buy and "four" does not.
 *
 * A RENEWAL IS NOT A SWAP, and the card tells them apart without being told.
 * The Altar of Ptah hands back the same weapon under a new title, so the name
 * changes while the DIGIT DOES NOT - and that is the whole test. Same slot means
 * the second row reads RENEWED in lapis instead of STOWED in gold, and it is
 * derived from the two numbers rather than from anyone announcing the event,
 * which is why it cannot get out of step with the Altar.
 *
 * Nothing here decides anything, exactly like every other readout in this file.
 * It is handed two names, two digits and a magazine, and paints.
 */
export function createWeaponSelect(root = document, { dwell = 2.2 } = {}) {
  const doc = root.ownerDocument || (typeof document === 'undefined' ? null : document);
  installLanguage(doc);

  const host = root && root.querySelector ? root.querySelector('#hud') : null;
  if (!host || !doc) {
    return {
      swap() { return false; }, tick() {}, hide() {}, attach() {},
      get shown() { return false; }, get left() { return 0; },
    };
  }

  const card = doc.createElement('div');
  card.className = 'plate';
  card.id = 'weapon-select';
  // The ATTRIBUTE, on an HTMLElement, where it means something - and paired
  // with an explicit `[hidden] { display: none }` in the sheet, because this
  // card sets its own display and an author display beats the user agent's.
  card.hidden = true;

  const take = doc.createElement('div');
  take.className = 'ws-row ws-take';
  const takeAmmo = doc.createElement('s');
  const takeName = doc.createElement('b');
  const takeKey = doc.createElement('kbd');
  takeKey.className = 'key-cap';
  take.append(takeAmmo, takeName, takeKey);

  const stow = doc.createElement('div');
  stow.className = 'ws-row ws-stow';
  const stowWhat = doc.createElement('em');
  const stowName = doc.createElement('u');
  const stowKey = doc.createElement('kbd');
  stowKey.className = 'key-cap';
  stow.append(stowWhat, stowName, stowKey);

  const rack = doc.createElement('div');
  rack.className = 'ws-slots';

  card.append(take, stow, rack);
  // Appended to #hud, not to the body: #hud is `pointer-events: none` and is
  // hidden as a unit by the harness's HUD-off frame, and a readout that is not
  // inside it would be measured as part of the game behind it.
  host.appendChild(card);

  /** Late binding, exactly as the minimap takes its one predicate. */
  let owns = null;
  let upgraded = null;
  let slots = [];
  const pips = [];

  function buildRack() {
    while (pips.length < slots.length) {
      const pip = doc.createElement('i');
      rack.appendChild(pip);
      pips.push(pip);
    }
  }

  function paintRack(currentSlot) {
    if (!owns || !slots.length) { rack.hidden = true; return; }
    rack.hidden = false;
    buildRack();
    for (let i = 0; i < pips.length; i++) {
      const id = slots[i];
      const held = !!owns(id);
      const up = held && upgraded ? !!upgraded(id) : false;
      pips[i].classList.toggle('owned', held);
      pips[i].classList.toggle('renewed', up);
      pips[i].classList.toggle('live', i + 1 === currentSlot);
    }
  }

  /** Seconds of dwell left. Counted down on the CLAMPED delta by tick(). */
  let left = 0;

  function show() {
    if (card.hidden) {
      card.hidden = false;
      // A frame between unhiding and the class, or the transition is coalesced
      // away and the card snaps in. Same reflow #frag-hint needs, same reason.
      void card.offsetWidth;
    }
    card.classList.add('on');
    left = dwell;
  }

  function hide() {
    left = 0;
    card.classList.remove('on');
  }

  /**
   * Taken out of the tree when the fade FINISHES, not on a second timer.
   *
   * The fade is 160ms of wall clock - correct here, and only here, for the same
   * reason the gold popups and the full-frame flash are: nothing in the
   * simulation reads it. But simulated time can run six times slower than the
   * wall under software rendering, so a `hidden` written from the delta-driven
   * clock would cut the fade off part-way through on a slow machine and leave
   * the card visibly popping out. The transition's own end event is the only
   * signal that is exactly right, and hiding rather than leaving it at opacity
   * zero matters because the legibility audit walks every element under #hud
   * and a CHILD of a transparent parent still computes its own opacity as 1.
   */
  card.addEventListener('transitionend', (e) => {
    if (e.propertyName !== 'opacity') return;
    if (card.classList.contains('on')) return;
    card.hidden = true;
  });

  /**
   * @param {object} s
   * @param {string} s.from      the name being put down
   * @param {number|string} s.fromSlot
   * @param {string} s.to        the name being taken up
   * @param {number|string} s.toSlot
   * @param {number} s.magazine
   * @param {number} s.reserve
   */
  function swap(s) {
    // SAME DIGIT, DIFFERENT NAME is the Altar handing a weapon back with a
    // title. Different digit is a swap. Nothing else can produce either.
    const renewed = !!s.fromSlot && String(s.fromSlot) === String(s.toSlot);

    takeName.textContent = s.to || '';
    takeKey.textContent = s.toSlot || '';
    takeKey.hidden = !s.toSlot;
    takeAmmo.textContent = `${s.magazine ?? 0} / ${s.reserve ?? 0}`;

    stowWhat.textContent = renewed ? 'RENEWED' : 'STOWED';
    stowName.textContent = s.from || '';
    stowKey.textContent = s.fromSlot || '';
    stowKey.hidden = !s.fromSlot;

    card.classList.toggle('renewed', renewed);
    paintRack(Number(s.toSlot) || 0);
    show();
    return true;
  }

  /** @param {number} dt CLAMPED frame delta, the same one the game runs on. */
  function tick(dt) {
    if (left <= 0) return;
    // A caller that has not been handed the delta still retires the card. A
    // readout that can get stuck on the screen forever is worse than one that
    // retires a little early on a slow frame.
    left -= Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
    if (left <= 0) hide();
  }

  return {
    swap,
    tick,
    hide,
    attach(parts) {
      if (!parts) return;
      if (parts.owns) owns = parts.owns;
      if (parts.upgraded) upgraded = parts.upgraded;
      if (parts.slots) { slots = [...parts.slots]; buildRack(); }
    },
    el: card,
    get shown() { return !card.hidden && card.classList.contains('on'); },
    get left() { return left; },
  };
}

// ---------------------------------------------------------------------------
// the readouts
// ---------------------------------------------------------------------------

/**
 * Vitality, gold, ammunition, the wave, the boss bar, and the hitmarker.
 *
 * These lived inline in the frame loop, which was fine while there were four of
 * them and is not now: the loop had acquired a dozen element handles, a bar
 * width calculation, a boss identity check and two class toggles, none of which
 * are anything the loop is about. They are all one thing - painting state onto
 * DOM - so they are one object here, called once a frame with the state.
 *
 * EVERY WRITE IS GUARDED BY A COMPARE. This runs sixty times a second over
 * elements whose values change a few times a minute, and setting textContent to
 * the string it already holds still dirties layout. The bars are the exception
 * and are transforms rather than widths, which the compositor takes off the main
 * thread entirely.
 */
export function createReadouts(root = document) {
  installLanguage(root.ownerDocument || (typeof document === 'undefined' ? null : document));

  const q = (sel) => root.querySelector(sel);

  const select = createWeaponSelect(root);

  /**
   * Whether the weapon in hand has been through the Altar.
   *
   * Late-bound through attach(), exactly as ui/minimap.js takes the one
   * predicate it needs rather than importing the armoury. A readout that held
   * `weapons` could reach in and change it; a readout that holds a function that
   * answers one question cannot.
   */
  let isUpgraded = null;

  const healthEl = q('[data-health]');
  const healthBar = q('[data-health-bar]');
  const healthPlate = q('#r-health');
  const goldEl = q('[data-gold]');
  const waveEl = q('[data-wave]');
  const depthEl = q('[data-depth]');
  const ammoEl = q('#r-ammo');
  const magEl = q('[data-mag]');
  const reserveEl = q('[data-reserve]');
  const weaponEl = q('[data-weapon]');
  const slotEl = q('[data-slot]');
  const fpsEl = q('#fps');

  const hitmarkerEl = q('#hitmarker');
  const bossEl = q('#boss');
  const bossNameEl = q('#boss-name');
  const bossBarEl = q('#boss-bar');

  const painted = {
    health: null, healthFrac: null, hurt: null,
    gold: null, wave: null, depth: null,
    mag: null, reserve: null, weapon: null, slot: null,
    empty: null, reloading: null, canReload: null, renewed: null,
    fps: null, boss: null,
  };

  let hitmarkerTimer = 0;

  /** The confirmation that a shot connected, without leaving the crosshair. */
  function hitmarker(crit) {
    if (!hitmarkerEl) return;
    hitmarkerEl.classList.toggle('crit', !!crit);
    hitmarkerEl.classList.remove('fade');
    hitmarkerEl.classList.add('on');
    clearTimeout(hitmarkerTimer);
    hitmarkerTimer = setTimeout(() => {
      hitmarkerEl.classList.remove('on');
      hitmarkerEl.classList.add('fade');
    }, 60);
  }

  /**
   * @param {object} s
   * @param {number} s.health       current vitality
   * @param {number} s.maxHealth    the ceiling, which Sekhmet moves
   * @param {number} s.wave
   * @param {number} s.magazine
   * @param {number} s.reserve
   * @param {string} s.weapon       display name, already upgraded if it is
   * @param {boolean} s.empty
   * @param {boolean} s.reloading
   * @param {object|null} s.boss
   * @param {number} [s.dt]  CLAMPED frame delta. Weapon select has a clock in
   *                         it, and simulated time runs several times slower
   *                         than the wall under software rendering, so a card
   *                         measured against the wall would be gone before a
   *                         slow machine had drawn the frame that raised it.
   */
  function update(s) {
    // --- vitality -----------------------------------------------------------
    //
    // A BAR AS WELL AS A NUMBER, and the bar is the one that does the work. The
    // Shrine of Sekhmet moves the ceiling from 100 to 250, at which point "160"
    // on its own is unreadable as a fraction of anything - it is a good number
    // before the shrine and a bad one after it, and only a bar can say which.
    const health = Math.round(s.health);
    if (health !== painted.health) {
      painted.health = health;
      if (healthEl) healthEl.textContent = health;
    }

    const frac = s.maxHealth > 0 ? Math.max(0, Math.min(1, s.health / s.maxHealth)) : 0;
    if (healthBar && Math.abs(frac - (painted.healthFrac ?? -1)) > 0.002) {
      painted.healthFrac = frac;
      healthBar.style.transform = `scaleX(${frac.toFixed(3)})`;
    }

    // Under a third is where a player is one swing from the floor. The whole
    // plate goes, not only the numeral: the point is to be caught in peripheral
    // vision by something the eye did not have to be looking at.
    const hurt = frac <= 0.34;
    if (hurt !== painted.hurt) {
      painted.hurt = hurt;
      if (healthPlate) healthPlate.classList.toggle('hurt', hurt);
    }

    // --- wave ---------------------------------------------------------------
    if (s.wave !== painted.wave) {
      painted.wave = s.wave;
      if (waveEl) waveEl.textContent = s.wave;
    }

    /*
     * --- depth ---------------------------------------------------------------
     *
     * METRES BELOW THE SAND, and it is a live position rather than a record.
     * BUILD 9 in the map scope says "derived from the deepest room reached
     * rather than from the wave"; the important half of that is the second one -
     * a depth faked off the wave number is a progress bar wearing a gauge's
     * clothes. Live position is chosen over deepest-reached because the job is
     * navigation, not score: a number that only ever goes up cannot tell the
     * player they have walked back up a ramp.
     *
     * Rounded to whole metres. The dunes outside vary by tens of centimetres and
     * a readout that flickers between 0 and 1 crossing a courtyard is noise on
     * the one axis this is trying to make legible.
     */
    if (s.depth !== painted.depth) {
      painted.depth = s.depth;
      if (depthEl) depthEl.textContent = `${s.depth}M`;
    }

    // --- ammunition ---------------------------------------------------------
    if (s.magazine !== painted.mag) {
      painted.mag = s.magazine;
      if (magEl) magEl.textContent = s.magazine;
    }
    if (s.reserve !== painted.reserve) {
      painted.reserve = s.reserve;
      if (reserveEl) reserveEl.textContent = s.reserve;
    }
    // WEAPON SELECT RIDES ON THIS COMPARE and needs nothing new wired to it.
    // The name in hand changing is the only event that can raise the card, and
    // it is already being watched here to keep the plate from repainting sixty
    // times a second - so the previous name and digit are captured before they
    // are overwritten and handed straight to the card. `painted.weapon === null`
    // is the first frame of the run, which is not a swap: the player did not
    // choose the MK9, they woke up holding it.
    const swapped = s.weapon !== painted.weapon;
    const fromName = painted.weapon;
    const fromSlot = painted.slot;

    if (swapped) {
      painted.weapon = s.weapon;
      if (weaponEl) weaponEl.textContent = s.weapon;
    }
    // THE NUMBER THAT RECALLS IT, beside the name. Seven weapons are bought
    // across this map and every one of them is one digit away at any moment,
    // which is worth nothing to a player who cannot remember which digit. The
    // binding is learned by reading the gun already in hand.
    if (s.slot !== painted.slot) {
      painted.slot = s.slot;
      if (slotEl) slotEl.textContent = s.slot || '';
    }
    // BOTH NAMES HAVE TO BE REAL, and this guard is not belt-and-braces.
    //
    // `painted.weapon === null` is the first frame of the run, which is not a
    // swap - the player did not choose the MK9, they woke up holding it. And an
    // EMPTY name is a player holding nothing, which is now a real state: the
    // Altar's ritual takes the gun away for five seconds and main.js sends
    // `weapon: ''` for every frame of it, so without this the card would raise
    // itself twice per upgrade, once to announce that you are now carrying a
    // blank, and once to announce that you have stopped. Neither is a swap.
    if (swapped && fromName && s.weapon) {
      select.swap({
        from: fromName,
        fromSlot,
        to: s.weapon,
        toSlot: s.slot,
        magazine: s.magazine,
        reserve: s.reserve,
      });
    }
    select.tick(s.dt);

    // Has this weapon been through the Altar. The lapis inlay on the plate, and
    // nothing else: see the sheet at the top of this file for why the numerals
    // are left exactly as they were.
    const renewed = isUpgraded ? !!isUpgraded() : false;
    if (renewed !== painted.renewed) {
      painted.renewed = renewed;
      if (ammoEl) ammoEl.classList.toggle('renewed', renewed);
    }
    if (s.empty !== painted.empty) {
      painted.empty = s.empty;
      if (ammoEl) ammoEl.classList.toggle('empty', !!s.empty);
    }
    if (s.reloading !== painted.reloading) {
      painted.reloading = s.reloading;
      if (ammoEl) ammoEl.classList.toggle('reloading', !!s.reloading);
    }
    // The R hint lights only while pressing R would actually do something. A
    // key hint that is bright when the magazine is full has cried wolf by the
    // time the magazine is empty.
    if (s.canReload !== painted.canReload) {
      painted.canReload = s.canReload;
      if (ammoEl) ammoEl.classList.toggle('canreload', !!s.canReload);
    }

    // --- the boss bar -------------------------------------------------------
    //
    // The only element that appears and disappears, driven off the director's
    // live boss rather than off a flag so it cannot survive the thing it is
    // measuring. The NAME is rewritten on a change of boss and not on the bar
    // becoming visible: keying it to visibility left the previous god's name
    // over the next one's health whenever two arrived without the bar clearing
    // in between, which is exactly what a summoned second boss does.
    const boss = s.boss || null;
    if (boss) {
      if (painted.boss !== boss) {
        painted.boss = boss;
        if (bossEl) bossEl.hidden = false;
        if (bossNameEl) bossNameEl.textContent = boss.name;
      }
      // WIDTH, not a transform, and that is a deliberate non-change. A scaleX
      // would be marginally cheaper and test/enemies.mjs reads
      // `bossBar.style.width` to prove the bar tracks the god it is measuring -
      // so switching the mechanism would break a suite this file has no
      // business breaking, to save a layout on one element that changes only
      // while a boss is alive. No transition, for the reason in index.html: a
      // transition here would lag the number it is drawn from and read as the
      // boss healing.
      if (bossBarEl) {
        const k = Math.max(0, Math.min(1, boss.health / boss.maxHealth));
        bossBarEl.style.width = `${(k * 100).toFixed(2)}%`;
      }
    } else if (painted.boss) {
      painted.boss = null;
      if (bossEl) bossEl.hidden = true;
    }
  }

  /** Averaged over a window by the caller, so this is only the paint. */
  function fps(n) {
    if (n === painted.fps) return;
    painted.fps = n;
    if (fpsEl) fpsEl.textContent = `${n} fps`;
  }

  /** Gold has its own path: it is pushed by economy.subscribe, not polled. */
  function gold(n) {
    if (n === painted.gold) return;
    painted.gold = n;
    if (goldEl) goldEl.textContent = n;
  }

  return {
    update,
    fps,
    gold,
    hitmarker,
    painted,

    /** The weapon-select card, for the harness and for nothing else. */
    select,

    /**
     * Late binding for the two facts about the armoury this file needs and has
     * no business owning: which weapons are held, and which have been renewed.
     * Same shape and same argument as minimap.attach().
     */
    attach(parts) {
      if (!parts) return;
      if (parts.upgraded) isUpgraded = parts.upgraded;
      select.attach(parts);
    },
  };
}
