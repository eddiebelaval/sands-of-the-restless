/**
 * THE SERDAB: the sealed chapel at the bottom, and the room World 1 ends in.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS MISSING
 * ---------------------------------------------------------------------------
 *
 * `ui/ending.js` was finished, tested and correct. The room it happens in was
 * not built. `rooms.js` called the Serdab "a 196-unit reward closet", gave it a
 * pharaoh statue, an offering table, two urns and a brazier, and said "No
 * interactSlots on purpose". Everything docs/NARRATIVE.md's "The chapel at the
 * bottom" is ABOUT - ten rock-cut figures of the same woman, an eleventh niche
 * cut into the side wall on its own and empty, the archaeologist sitting with
 * her back to the door, her lamp beside her - existed only in prose. The owner
 * played it and reported: "walked into the Serdab and it just turned black,
 * nothing happened." The card was a clock bug and was fixed. The empty room was
 * not a bug at all; it was never built.
 *
 * This file is that room's contents. It owns nothing else: the shell, the
 * floor, the ceiling, the doorway and the ending sequence all belong to files
 * this one does not touch.
 *
 * ---------------------------------------------------------------------------
 * THE HARD FLAG, AND WHAT IT RULES OUT
 * ---------------------------------------------------------------------------
 *
 * docs/WORLD2-PLAN.md: "`star-shaft -> serdab` clears the doorway rule with
 * exactly zero slack, so nothing here may change the Serdab's floor or
 * ceiling." That is arithmetic and it is worth writing out, because it is the
 * constraint every decision below was taken against.
 *
 *   portalOpening()  clear = min(DOOR_H, ceilY - sill - 0.8)
 *   sill  = max(base(star-shaft), base(serdab)) = max(-6, -6) = -6
 *   ceilY = min(-6 + 30, -6 + 5)               = -1
 *   clear = min(4.2, -1 - -6 - 0.8) = min(4.2, 4.2) = 4.2 = DOOR_H
 *
 * The second term equals the first EXACTLY. One centimetre off the Serdab's
 * height and the doorway is no longer a full-height door; the room is the
 * binding constraint on its own entrance. So nothing in this file changes
 * `bounds`, `base` or `height`, and nothing in it touches the portal.
 *
 * WHAT THAT LEAVES is the only budget this room has: everything is built
 * INWARD from surfaces that already exist. The ten figures are relief engaged
 * to the back wall. The eleventh niche is a THICKENED wall rather than a hole,
 * for the same reason - a recess cut through the shell would have needed
 * `buildShell` to cut it, and the shell is where the doorway rule lives.
 *
 * ---------------------------------------------------------------------------
 * THE COMPOSITION PROBLEM, AND HOW IT IS SOLVED RATHER THAN CRAMMED
 * ---------------------------------------------------------------------------
 *
 * Ten figures and a seated person in the smallest room in the map, under the
 * lowest ceiling in the game (five units), is a picture that goes wrong by
 * default. Three decisions keep it open:
 *
 *   1. THE FIGURES ARE RELIEF, NOT STATUARY. They are engaged to the wall and
 *      project 0.58 m. Ten free-standing statues would have eaten the floor of
 *      a room whose whole job is that one person can cross it; ten reliefs cost
 *      half a metre of a twelve-metre room. This is temple.js's doctrine
 *      applied at chapel scale: relief that casts onto itself is the only way a
 *      flat-lit surface carries shading, and a row of ten on a 1.12 m rhythm is
 *      a rhythm before it is a subject.
 *
 *   2. THE ROW IS SHORTER THAN THE WALL IS TALL. Plinth 0.30, figure 2.24,
 *      panel head 2.72, cap top 2.88 - which leaves 2.12 m of empty stone above
 *      them on a five-metre wall. That empty band is what stops the room
 *      reading as crammed, and it is deliberately left clear: the struck
 *      cartouche that the fourth jar makes readable belongs to the puzzle
 *      chain's lane and goes there. See the note at the foot of this file.
 *
 *   3. SHE IS LOW AND THE LIGHT IS LOWER. Seated, she tops out at 1.57 m -
 *      level with the figures' chests - so she reads as a separate, smaller
 *      thing in front of a wall of the same face repeated. Her lamp stands on
 *      the floor BEYOND her from the door, at 0.72 m, which is where the room's
 *      one point light hangs. That single low warm source does three jobs at
 *      once: it rakes the relief so ten identical figures separate, it puts her
 *      in silhouette from the doorway (her back is to the door; a silhouette is
 *      the honest read of a person who has not turned round), and it throws her
 *      shadow up the row.
 *
 * THE BRAZIER IS GONE, and that is the same decision. A ceremonial fire burning
 * in a chapel sealed for four thousand years is a light source that contradicts
 * the room; and while both existed the room's single light hung on whichever
 * anchor registered first. One fire, hers, is both correct and legible.
 *
 * ---------------------------------------------------------------------------
 * THE ARCHAEOLOGIST
 * ---------------------------------------------------------------------------
 *
 * The first and only human body in World 1, and she is SET DRESSING: no
 * animation, no AI, no interact slot, no collider behaviour beyond not being
 * walkable-through. `ui/ending.js` owns what happens when the player reaches
 * her, and it needs nothing from this file - its gate is three conditions and
 * "is there a body in the room" is not one of them.
 *
 * Her name does not appear in this room. It is stencilled on one of seven
 * transit cases in the camp outside, forty minutes earlier, with no emphasis
 * whatsoever (see world/camp.js), and that is the only place it is written.
 *
 * She is the one thing in here not made of the tomb, so she gets the only two
 * materials this file declares. Everything else comes out of the shared
 * registry through `ctx.M`, which is the per-elevation instance the room's
 * grime is measured from - see materialsForBase in world/materials.js. Two
 * plain materials with no maps is the whole cost of the only person in the
 * world, and it is what keeps her from reading as carved out of the wall.
 *
 * HER LAMP IS WARM. world/camp.js states the gradient in one line - "the two
 * work lamps are COLD white. The warm lamps belong to her, four hours ahead, at
 * the bottom of the pyramid" - so the lens here is the far end of a contrast
 * the player met in the first two minutes of the game.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ROW AND THE NICHE ARE MERGED AND THE PEOPLE ARE NOT
 * ---------------------------------------------------------------------------
 *
 * The interior is not run through world/batch.js - that pass is the
 * courtyard's - so every mesh in every room is its own draw call. A figure is
 * twelve boxes, which makes the row 122 meshes and the niche panel 8, in a
 * forward-lit scene where the cost of a frame has already been measured as the
 * CPU walking the graph rather than as shading.
 *
 * So the row and the niche panel each run `batchStatics` over their OWN group
 * before it is handed back. That is legitimate here for exactly the reason the
 * courtyard's is: every piece points at a shared registry material, the
 * variation between two neighbouring figures is `weathering.js` evaluated in
 * the fragment shader from WORLD POSITION, and merging bakes each mesh's matrix
 * into its vertices - so the shader sees the same world position it saw before
 * and the merge is an identity transform on the image.
 *
 * The archaeologist and the lamp are NOT merged: they are eleven meshes across
 * four materials between them, which is below the threshold where a merge buys
 * anything, and the lamp's lens is an emissive that a later pass may want to
 * find by name.
 *
 * Numbers, measured by test/serdab.mjs and not asserted here.
 */

import * as THREE from 'three';
import { box } from './uv.js';
import { batchStatics } from './batch.js';
import { cartouchePath, ink, ROLE, PIGMENT } from '../ui/tokens.js';

/** Matches build.js's DENSITY table for the surfaces this file borrows. */
const DENSITY = {
  limestone: 0.22,
  carved: 0.30,
  granite: 0.26,
  metal: 0.9,
};

/**
 * The two materials that are not stone, and the only ones this file declares.
 *
 * Built once and shared, on world/materials.js's own rule: a material per
 * instance is a material per draw call, and there is exactly one of her.
 *
 * NEITHER IS WEATHERED, deliberately. `weathering.js` darkens toward the base
 * of a wall and bleaches upward-facing stone, which is a model of masonry that
 * has stood in a desert. She has been sitting here for a few hours.
 */
let PERSON = null;

/**
 * THE NAMES SOMETHING ELSE DRIVES THIS ROOM BY.
 *
 * `src/story/meeting.js` plays beats 4.5 to 4.8 out of `docs/PLAYTHROUGH.md` -
 * she stands, she turns, her eyes take the boss telegraph - and it does it by
 * finding four objects in the scene graph and writing transforms and emissive
 * intensities onto them. Everything it touches is named HERE and exported as a
 * table, for the same reason `ui/interact.js` resolves fixtures through a
 * `userData` tag rather than through a coordinate: a driver that finds its
 * subject by walking to `children[7]` is a driver that silently drives the
 * wrong box the day somebody adds a mesh.
 *
 * THIS FILE STILL OWNS NO SEQUENCE. Nothing below moves, ramps or listens; the
 * archaeologist is set dressing exactly as she was, and the two additions - her
 * eyes and the sign on her lamp - are both authored at ZERO emissive intensity,
 * which is the state the player is in the room with for as long as they like.
 * What changed is that the room is now drivable, not that it drives itself.
 */
export const SERDAB_NAMES = {
  /** The prop group: stool, body, everything. Placed by build.js. */
  her: 'serdab-archaeologist',
  /** Her, without the stool. This is what rises and turns; the stool stays. */
  figure: 'serdab-figure',
  /** Thighs, shins and boots, pivoted at the hip so a stand can straighten them. */
  legs: 'serdab-legs',
  /** The forward lean comes out of her back as she rises. */
  torso: 'serdab-torso',
  /** The two eyes, and they are the only surface in this room with a ramp on it. */
  eyes: 'serdab-eyes',
  /** Both forearms, pivoted at the elbow: seated they rest on her knees. */
  forearms: 'serdab-forearms',
  /** Her lamp's group, and the mark cut into the face of it that looks at the door. */
  lamp: 'serdab-lamp',
  sign: 'serdab-lamp-sign',
};

/**
 * THE ONE POSE THIS FILE AUTHORS TWICE.
 *
 * She is modelled seated, because seated is what the player walks in on and
 * seated is the composition argument at the top of this file. A stand is the
 * same body at a second set of numbers, and both sets belong here rather than
 * in the driver: `story/meeting.js` should know THAT she stands, and this file
 * should know what standing looks like, because standing is geometry.
 *
 * Everything is a delta off the authored seated pose, so a lerp at k = 0 is the
 * room exactly as `test/serdab.mjs` measured it and cannot drift from it.
 *
 * Hand-tuned against a screenshot rather than derived, and that is the honest
 * account: a seated leg is an L - thigh forward, shin down - and no single
 * rigid rotation straightens an L. The knee angle puts the shins under the hip,
 * and the two offsets put the boots back on the floor underneath her.
 */
export const STAND = {
  /** How far the body rises off the stool. */
  lift: 0.44,
  /** Legs pivot, in the figure's own frame: where the thighs meet the torso. */
  hip: { y: 0.57, z: 0.02 },
  /** Legs rotation.x at full stand, and the offset that lands the boots. */
  knee: 1.30,
  legShift: { y: -0.416, z: -0.30 },
  /** The lean she has been holding for four days, taken back out. */
  torsoLean: 0.17,

  /**
   * THE ARMS COME OFF HER KNEES, and this one was found by looking.
   *
   * She is modelled with her elbows on her knees, so the first cut of the stand
   * left both forearms jutting out at hip height - two pink bricks on a
   * standing figure, which is what the screenshot showed and no number did.
   * A quarter turn at the elbow hangs them at her sides.
   *
   * Elbow pivot, forearms group: (0, 0.72, 0.07) - the near end of a 0.34 box
   * whose far end is the hand.
   */
  elbow: { y: 0.72, z: 0.07 },
  forearm: 0.5 * Math.PI,
  /** Her eyes' ceiling. See story/meeting.js: it is the boss gilding's ramp. */
  eyeGlow: 3.6,
};

/**
 * THE MARK, drawn once into a canvas and used as an emissive map.
 *
 * `docs/NARRATIVE.md`: "the mark he has been finding chiselled into walls since
 * the first minute of the game is on her lamp and lit from inside it", and
 * `docs/WORLD-1.md` finding 7 says what the mark IS - "the mark the player
 * reads as the villain's and the name they reassemble in the Serdab are the
 * same object". It is an effaced cartouche: a name-ring with the glyphs struck
 * out of it.
 *
 * SO IT IS DRAWN FROM THE GAME'S OWN CARTOUCHE, not from a new shape. The path
 * is `ui/tokens.js`'s `cartouchePath`, which is the same call the HUD, the
 * death card and the pause menu make; the four struck blocks are `GLYPHS` from
 * `ui/ending.js`, which is the count that lands on the last card in World 1;
 * the rule driven across each one is that card's `.ending-glyph::after`, at the
 * same eight degrees. Nothing here is a second version of a shape this build
 * already has.
 *
 * HONEST LIMIT, and it is recorded rather than hidden: this mark is NOT on the
 * walls today. `world/textures.js` draws eleven abstract marks and an
 * inscription band, and no struck cartouche among them, so the rhyme this sign
 * makes is with the death card and the ending card rather than with the frieze.
 * The wall half of beat 4.6 belongs to the wall-art lane and is not built.
 */
function markTexture() {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc || !doc.createElement) return null;

  const W = 256, H = 160;
  const c = doc.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  // Black ground: this is an emissive map, so black is "the case is opaque
  // here" and the drawn marks are the only places light gets out.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const gold = ink(ROLE.frame, 1);
  const hot = ink(PIGMENT.goldHot, 1);

  // The ring.
  ctx.strokeStyle = gold;
  ctx.lineWidth = 7;
  cartouchePath(ctx, 22, 34, W - 44, H - 68);
  ctx.stroke();

  // The shen bar that closes it, right hand end. Frame ornament, exactly as on
  // the death card and the ending card.
  ctx.fillStyle = gold;
  ctx.fillRect(W - 34, 52, 6, H - 104);

  // The four glyphs, and the rule driven through each of them.
  const GLYPHS = 4;
  const slotW = (W - 116) / GLYPHS;
  for (let i = 0; i < GLYPHS; i++) {
    const cx = 58 + slotW * (i + 0.5);
    const w = slotW * 0.46;
    const h = (H - 96) * 0.86;
    ctx.fillStyle = gold;
    ctx.fillRect(cx - w / 2, H / 2 - h / 2, w, h);

    ctx.save();
    ctx.translate(cx, H / 2);
    ctx.rotate(-8 * Math.PI / 180);
    ctx.fillStyle = hot;
    ctx.fillRect(-w * 0.78, -3.5, w * 1.56, 7);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function personMaterials() {
  if (PERSON) return PERSON;
  const mark = markTexture();
  PERSON = {
    /** Field drill, four days in a hole in the ground. */
    field: new THREE.MeshStandardMaterial({
      color: 0x7d7758, roughness: 0.94, metalness: 0.0, name: 'serdab-field',
    }),
    /** Hands, neck, face. The only skin in World 1. */
    flesh: new THREE.MeshStandardMaterial({
      color: 0xc7a082, roughness: 0.82, metalness: 0.0, name: 'serdab-flesh',
    }),
    /** Hair, and the strap on the lamp. */
    hair: new THREE.MeshStandardMaterial({
      color: 0x3a2a1e, roughness: 0.95, metalness: 0.0, name: 'serdab-hair',
    }),
    /**
     * The lamp lens. WARM, against camp.js's cold work lamps, and emissive so
     * the fixture reads as ON even on LOW fidelity where the point light's
     * range is cut. camp.js states the reason at length: a practical whose only
     * evidence is the light it casts stops existing the moment the budget
     * moves.
     */
    lens: new THREE.MeshStandardMaterial({
      color: 0xffe3ab, roughness: 0.30, metalness: 0.0,
      emissive: 0xffb64a, emissiveIntensity: 2.9, name: 'serdab-lens',
    }),

    /**
     * HER EYES, AND THEY ARE DARK.
     *
     * `emissiveIntensity: 0` is the authored state and it is the state the
     * player is in the room with. Two recessed dark squares on a face that is
     * turned away is what a head looks like; the ramp belongs to the scene, not
     * to the room, so `story/meeting.js` writes both the colour and the
     * intensity and this file ships neither.
     *
     * A material rather than two, because there is one of her and she has two
     * eyes and they do the same thing at the same instant.
     */
    eye: new THREE.MeshStandardMaterial({
      color: 0x241a12, roughness: 0.42, metalness: 0.0,
      emissive: 0x000000, emissiveIntensity: 0, name: 'serdab-eye',
    }),

    /**
     * The mark on the lamp case. Same rule as the eyes: authored cold.
     *
     * `emissiveMap` AND `map` off one canvas, so the mark is a visible incision
     * in the metal before it lights and a lit sign after. A sign that only
     * exists while it is on is a sign that appears out of nowhere.
     */
    sign: new THREE.MeshStandardMaterial({
      color: 0x1a1611, roughness: 0.55, metalness: 0.2,
      map: mark, emissiveMap: mark,
      emissive: 0xffffff, emissiveIntensity: 0, name: 'serdab-mark',
    }),
  };
  return PERSON;
}

function slab(w, h, d, mat, density) {
  const m = new THREE.Mesh(box(w, h, d, density), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * A slot-local (x, z) taken out to world space.
 *
 * build.js positions a prop group at (slot.x, base + slot.y, slot.z) and turns
 * it by slot.rot, but `addCollider` and `ctx.walls` are both WORLD-space lists.
 * So anything this file wants to block has to be transformed by hand, and doing
 * it through the slot's own rotation rather than through a hardcoded axis is
 * what lets a row authored along local x be placed on any wall in the map.
 */
function toWorld(slot, lx, lz) {
  const c = Math.cos(slot.rot || 0);
  const s = Math.sin(slot.rot || 0);
  return { x: slot.x + lx * c + lz * s, z: slot.z - lx * s + lz * c };
}

// ---------------------------------------------------------------------------
// the ten
// ---------------------------------------------------------------------------

/** How far apart the figures stand, centre to centre. */
const PITCH = 1.12;

/** The plinth they stand on, and the cap that closes the register above them. */
const PLINTH_H = 0.30;
const CAP_H = 0.16;

/** Plinth top to the top of a wig. The stack that adds up to it is in kaFigure. */
const FIGURE_H = 2.24;

/** How far the deepest part of a figure stands out from the wall. */
const PROUD = 0.58;

/**
 * One woman, cut into the wall, ten times.
 *
 * IDENTICAL BY CONSTRUCTION AND THAT IS THE SUBJECT. There is no per-figure
 * jitter, no seeded variation and no draw taken from `ctx.rand`: they are ten
 * copies of the same face and the moment one of them differs the row stops
 * saying what it is here to say. What separates them in the frame is the
 * weathering term, which is a function of world position evaluated in the
 * shader, plus the raking light of a lamp standing on the floor five metres
 * away - both of which vary along the row for free and neither of which is a
 * difference between the figures.
 *
 * Authored in the local frame with the wall at z = 0 and the row running along
 * x, so the same builder works on any of the four walls through slot.rot.
 */
function kaFigure(g, M, u) {
  /**
   * The sunk panel each figure stands in, and it is GRANITE against limestone.
   *
   * The first cut made this limestone like the wall behind it and photographed
   * as ten dark rectangles: the figures sit entirely inside `weathering.js`'s
   * grime band, which runs 3.2 m up from the floor, so a pale figure on a pale
   * ground had nothing to be read against in the one part of the wall the world
   * deliberately darkens. Two pale stones a shade apart is not a contrast, and
   * the room is lit by one lamp on the floor.
   *
   * Granite is a real material change rather than a lighting trick - it is the
   * floor of every sanctum in the map and the stone of the sarcophagus, it is
   * blue-grey against tan at an albedo distance nothing can close, and sinking
   * a figure into a panel of a second stone is what an Egyptian chapel actually
   * does. Ten light women in ten dark panels, on a 1.06 rhythm.
   *
   * Narrower than the pitch, so a joint line stands between every pair: what
   * makes ten of them read as ten rather than as one continuous mass.
   */
  const back = slab(PITCH - 0.08, FIGURE_H + 0.18, 0.26, M.granite, DENSITY.granite);
  back.position.set(u, PLINTH_H + (FIGURE_H + 0.18) / 2, 0.13);
  g.add(back);

  /*
   * THE STACK, AND ITS PROPORTIONS ARE THE SECOND THING THIS FILE GOT WRONG.
   *
   * The first cut put a 0.50 m wig centred at the same height as a 0.36 m head
   * and let both overlap the shoulder course. Rendered, that is not a portrait
   * of anybody: it is a broad body with a narrow block on top, and it
   * photographed as a mushroom ten times in a row. There was no neck in it, and
   * a neck is not a detail - it is the gap that tells the eye where a head
   * stops being a body.
   *
   * So the stack below is spelled out in absolute heights above the plinth,
   * every course butting the one under it, with a visible 0.10 of neck:
   *
   *   legs      0.00 .. 1.10     half the figure, which is where legs end
   *   torso     1.10 .. 1.68
   *   shoulders 1.68 .. 1.80     the widest course, and the person cue
   *   neck      1.80 .. 1.90
   *   head      1.90 .. 2.18
   *   wig       1.86 .. 2.24     behind and beside the head, not over it
   */
  const legs = slab(0.54, 1.10, 0.40, M.carved, DENSITY.carved);
  legs.position.set(u, PLINTH_H + 0.55, 0.34);
  g.add(legs);

  const torso = slab(0.66, 0.58, 0.38, M.carved, DENSITY.carved);
  torso.position.set(u, PLINTH_H + 1.39, 0.35);
  g.add(torso);

  // The shoulder line: the widest thing on the figure, and at this fidelity the
  // single strongest cue that the shape is a person. It costs one box.
  const shoulders = slab(0.80, 0.12, 0.42, M.carved, DENSITY.carved);
  shoulders.position.set(u, PLINTH_H + 1.74, 0.34);
  g.add(shoulders);

  const neck = slab(0.13, 0.10, 0.14, M.carved, DENSITY.carved);
  neck.position.set(u, PLINTH_H + 1.85, 0.38);
  g.add(neck);

  /**
   * HEAD AND WIG IN LIMESTONE AGAINST A GRANITE PANEL, and the three-value
   * scheme is the whole legibility argument.
   *
   * dark panel / mid body / pale head, from back to front. A row of figures cut
   * in ONE stone in a room lit by one lamp on the floor is a row of vertical
   * shapes, and the eye finds a person by finding the head first. Painted heads
   * and headdresses on a darker body is also just what this statuary was.
   *
   * The wig sits BEHIND the head at z 0.28 against the head's 0.38 and stands
   * 0.06 above it, so it frames the skull rather than swallowing it - which is
   * the whole difference between a tripartite wig and a hat.
   */
  const head = slab(0.26, 0.28, 0.28, M.limestone, DENSITY.limestone);
  head.position.set(u, PLINTH_H + 2.04, 0.38);
  g.add(head);

  const wig = slab(0.42, 0.38, 0.34, M.limestone, DENSITY.limestone);
  wig.position.set(u, PLINTH_H + 2.05, 0.28);
  g.add(wig);

  for (const s of [-1, 1]) {
    // The lappets of the wig, falling in front of the shoulders onto the chest.
    // Two of them, and they are what makes the headdress tripartite - which is
    // the read that says this figure is a woman rather than a king.
    const lappet = slab(0.10, 0.38, 0.12, M.limestone, DENSITY.limestone);
    lappet.position.set(u + s * 0.16, PLINTH_H + 1.61, 0.50);
    g.add(lappet);

    // Arms at the sides, hands flat against the thighs. The ka statue posture,
    // and the reason a rock-cut figure has no gap anywhere in it: the stone
    // between the arm and the flank is never cut away, because it is what holds
    // the arm on.
    const arm = slab(0.11, 0.93, 0.16, M.carved, DENSITY.carved);
    arm.position.set(u + s * 0.345, PLINTH_H + 1.215, 0.44);
    g.add(arm);
  }
}

function kaRow(ctx, slot) {
  const { M, walls, base } = ctx;
  const g = new THREE.Group();

  const n = (slot.config && slot.config.count) || 10;
  const pitch = (slot.config && slot.config.pitch) || PITCH;
  const span = (n - 1) * pitch;

  // FLUSH WITH THE DEEPEST PART OF A FIGURE RATHER THAN PROUD OF IT, so one
  // collision box is exactly the row. A plinth standing further out than PROUD
  // would either be walked into (if the box matched the figures) or would hold
  // the player a hand's width off the wall for its whole length (if the box
  // matched the plinth), and neither is worth a step nobody looks at.
  const plinth = slab(span + 0.62, PLINTH_H, PROUD, M.limestone, DENSITY.limestone);
  plinth.position.set(0, PLINTH_H / 2, PROUD / 2);
  g.add(plinth);

  for (let i = 0; i < n; i++) kaFigure(g, M, -span / 2 + i * pitch);

  // The cap course. A register in an Egyptian chapel is closed at the top or it
  // is not a register, and the ledge it makes is the line the empty wall above
  // is measured from.
  const cap = slab(span + 0.62, CAP_H, 0.46, M.limestone, DENSITY.limestone);
  cap.position.set(0, PLINTH_H + FIGURE_H + 0.18 + CAP_H / 2, 0.23);
  g.add(cap);

  /**
   * ONE BOX, NOT TEN CYLINDERS.
   *
   * The row presents a flat face along a wall, which is exactly what
   * `ctx.walls` is: an axis-aligned box with a y0 and a y1, resolved by the
   * controller as an exact push-out. Ten collider discs would have rounded the
   * face, overlapped into each other, and left the player able to stand half
   * inside a woman's shoulder at the seams.
   *
   * It is registered only when the row lies on an axis, which every wall in
   * this map does. A row authored at an angle would need discs and would get
   * them; nothing in World 1 asks for that.
   */
  const a = toWorld(slot, -span / 2 - 0.31, 0);
  const b = toWorld(slot, span / 2 + 0.31, PROUD);
  walls.push({
    x: (a.x + b.x) / 2,
    z: (a.z + b.z) / 2,
    w: Math.max(Math.abs(b.x - a.x), 0.02),
    d: Math.max(Math.abs(b.z - a.z), 0.02),
    y0: base,
    y1: base + PLINTH_H + FIGURE_H + 0.18 + CAP_H,
  });

  batchStatics(g, { minBatch: 3 });
  return g;
}

// ---------------------------------------------------------------------------
// the eleventh
// ---------------------------------------------------------------------------

/** How deep the wall is thickened, and therefore how deep the recess is. */
const PANEL_D = 0.90;

/** The opening. Person sized, because a person is what is missing from it. */
const NICHE_W = 1.20;
const NICHE_H = 2.40;

/**
 * The eleventh niche: a recess cut into the side wall, on its own, and empty.
 *
 * TEN AND ONE, NOT ELEVEN. It is on a different wall from the row and it is not
 * at the end of it, so it reads as an OMISSION rather than as a gap somebody has
 * not got round to filling. That distinction is the entire beat: the player has
 * spent an hour restoring a name and the room at the bottom of it is a room with
 * a hole in the wall.
 *
 * BUILT AS A THICKENED WALL, and this is the constraint from the file header
 * paying out. A recess cut THROUGH the shell would have to be cut by
 * `buildShell`, which is where the doorway rule lives, and the doorway rule has
 * zero slack. So the wall gets 0.90 m thicker across its whole length and the
 * niche is the place where it does not - the recess is a genuine 0.90 m of
 * depth with the room's original wall face as its back, and the room loses 0.90
 * of a twelve-metre floor to get it.
 *
 * The full width matters. A projecting block with returns at both ends reads as
 * something standing IN FRONT OF the wall; a wall that is simply thicker on one
 * side reads as the wall, which is what a serdab's sealed side would be.
 *
 * ITS COLLISION IS THREE BOXES AND THE OPENING IS NOT ONE OF THEM. The player
 * can walk into the recess and stand in it, which is not decoration: World 1
 * ends with him climbing into it. The lintel is registered from 2.40 up, so
 * `headroomAt` reports 2.40 m of clearance inside the niche - comfortably over
 * the 1.78 the controller needs to stand - and the player ducks nothing.
 */
function eleventhNiche(ctx, slot) {
  const { M, room, walls, base } = ctx;
  const g = new THREE.Group();

  const H = room.height;
  // Half the wall's clear run, taken off the room rather than authored twice.
  const half = (slot.rot === 0 || Math.abs(slot.rot) === Math.PI)
    ? room.bounds.w / 2 - 1.0
    : room.bounds.d / 2 - 1.0;

  // Where the opening sits along the wall. Off centre on purpose: centred, it
  // would read as the wall's own axis and therefore as intended.
  const at = (slot.config && slot.config.at) !== undefined ? slot.config.at : 2.4;

  const lo = at - NICHE_W / 2;
  const hi = at + NICHE_W / 2;

  // Left of the opening, right of the opening, and the mass over it.
  const segs = [
    { x0: -half, x1: lo, y0: 0, y1: H },
    { x0: hi, x1: half, y0: 0, y1: H },
    { x0: lo, x1: hi, y0: NICHE_H, y1: H },
  ];

  for (const s of segs) {
    const w = s.x1 - s.x0;
    const h = s.y1 - s.y0;
    if (w <= 0.02 || h <= 0.02) continue;
    const m = slab(w, h, PANEL_D, M.limestone, DENSITY.limestone);
    m.position.set((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, PANEL_D / 2);
    g.add(m);

    const a = toWorld(slot, s.x0, 0);
    const b = toWorld(slot, s.x1, PANEL_D);
    walls.push({
      x: (a.x + b.x) / 2,
      z: (a.z + b.z) / 2,
      w: Math.max(Math.abs(b.x - a.x), 0.02),
      d: Math.max(Math.abs(b.z - a.z), 0.02),
      y0: base + s.y0,
      y1: base + s.y1,
    });
  }

  /**
   * The back of the recess, and it is granite where everything round it is
   * limestone.
   *
   * Two centimetres proud of the room's real wall face, which is the whole of
   * the depth it needs: the wall behind it is opaque and the plate exists to
   * make the bottom of the recess a DIFFERENT, darker stone. A niche whose back
   * is the same surface as the wall around it photographs as a shadow, and a
   * shadow is what the player will assume they are looking at.
   */
  const back = slab(NICHE_W, NICHE_H, 0.06, M.granite, DENSITY.granite);
  back.position.set(at, NICHE_H / 2, 0.03);
  g.add(back);

  // The reveal: a chamfered lip round the mouth of the recess. Four thin bars,
  // and they are what stop the opening reading as a rectangle painted on stone.
  const R = 0.09;
  for (const s of [-1, 1]) {
    const jamb = slab(R, NICHE_H + R, 0.10, M.carved, DENSITY.carved);
    jamb.position.set(at + s * (NICHE_W / 2 + R / 2), (NICHE_H + R) / 2, PANEL_D - 0.05);
    g.add(jamb);
  }
  const head = slab(NICHE_W + R * 2, R, 0.10, M.carved, DENSITY.carved);
  head.position.set(at, NICHE_H + R / 2, PANEL_D - 0.05);
  g.add(head);

  batchStatics(g, { minBatch: 3 });
  return g;
}

// ---------------------------------------------------------------------------
// the only person in World 1
// ---------------------------------------------------------------------------

/**
 * The archaeologist, seated, back to the door, facing the empty niche.
 *
 * SHE IS SET DRESSING AND NOTHING ELSE. No update, no animation, no interact
 * record, nothing registered with the director. `ui/ending.js` owns everything
 * that happens when the player reaches her and it asks this file for nothing:
 * its gate is the wave ceiling, the four jars and the room, and none of those
 * is "is there a body here".
 *
 * SEATED IS A COMPOSITION DECISION BEFORE IT IS A STAGING ONE. At 1.53 m she
 * sits below the waistline of a row of figures 2.71 m tall, which is what keeps
 * a low room with eleven people in it legible; and a person who does not stand
 * up when someone walks in has already told the player something the game will
 * not say for another minute.
 *
 * FORWARD IS LOCAL +Z, which is the convention every other prop in build.js
 * uses (a statue at rot = PI faces -Z). So her slot's rot is derived from where
 * the niche is, not from where the door is, and her back ends up toward the
 * door because the niche is behind her from the door's point of view.
 */
function archaeologist(ctx, slot) {
  const { M, addCollider } = ctx;
  const P = personMaterials();
  const g = new THREE.Group();
  g.name = SERDAB_NAMES.her;

  /**
   * THREE GROUPS WHERE THERE USED TO BE ONE, AND NOT ONE NUMBER MOVED.
   *
   * Every mesh below sits at exactly the coordinate it sat at before, because
   * `figure` and `legs` are added at identity and the legs' children are
   * re-expressed relative to a pivot that is subtracted straight back out. The
   * scene graph is deeper; the room is pixel-identical, which `test/serdab.mjs`
   * is the check on.
   *
   * WHY THEY ARE HERE AT ALL: beat 4.6 is "she stands and turns", and both of
   * those are transforms on a subtree rather than on her prop group. The prop
   * group holds the STOOL, which does not stand up and does not turn round -
   * and a stand authored on `g` is a folding camp stool pirouetting in the
   * middle of the last beat in World 1. The legs are their own group for the
   * same class of reason one layer down: they are the only part of her whose
   * seated pose is not also a standing pose.
   */
  const figure = new THREE.Group();
  figure.name = SERDAB_NAMES.figure;
  g.add(figure);

  const legs = new THREE.Group();
  legs.name = SERDAB_NAMES.legs;
  legs.position.set(0, STAND.hip.y, STAND.hip.z);
  figure.add(legs);

  /** Author in her own frame, file in the legs' frame. */
  const toLegs = (m) => {
    m.position.y -= STAND.hip.y;
    m.position.z -= STAND.hip.z;
    legs.add(m);
    return m;
  };

  // ---- the stool -----------------------------------------------------------
  //
  // A folding camp stool: four splayed tube legs and a canvas top. Modern kit,
  // in the same key as the camp outside, and the one object in this room that
  // somebody carried down here.
  const SEAT = 0.46;

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = slab(0.035, SEAT, 0.035, M.gunmetal, DENSITY.metal);
      leg.position.set(sx * 0.19, SEAT / 2, sz * 0.17);
      leg.rotation.z = -sx * 0.14;
      leg.rotation.x = sz * 0.12;
      g.add(leg);
    }
  }

  const seat = slab(0.44, 0.05, 0.38, P.field, 0.5);
  seat.position.set(0, SEAT + 0.02, 0);
  g.add(seat);

  // ---- the body ------------------------------------------------------------

  const thighs = slab(0.36, 0.15, 0.42, P.field, 0.5);
  thighs.position.set(0, SEAT + 0.11, 0.18);
  toLegs(thighs);

  const shins = slab(0.32, 0.46, 0.15, P.field, 0.5);
  shins.position.set(0, 0.25, 0.36);
  toLegs(shins);

  const boots = slab(0.34, 0.10, 0.28, M.polymer, DENSITY.metal);
  boots.position.set(0, 0.05, 0.44);
  toLegs(boots);

  // Leaning forward, elbows on knees. The posture of somebody who has been
  // looking at the same thing for a long time and has stopped expecting it to
  // change.
  /*
   * SHOULDERS WIDER THAN THE BACK, and the arms outboard of both.
   *
   * The player arrives behind her and stays behind her, so the only silhouette
   * this figure ever presents is a back. The first cut had a 0.40 back under
   * 0.46 shoulders with the arms at 0.21 - exactly the torso's own half width -
   * and photographed as a plain rectangle with a head on it. 0.36 of back, 0.54
   * of shoulder and the arms pushed out to 0.25 puts three vertical breaks in
   * that outline, which is the whole of what says "a person is sitting here"
   * from five metres in a room lit by one lamp.
   */
  const torso = slab(0.36, 0.62, 0.26, P.field, 0.5);
  torso.position.set(0, SEAT + 0.42, 0.04);
  torso.rotation.x = STAND.torsoLean;
  torso.name = SERDAB_NAMES.torso;
  figure.add(torso);

  const shoulders = slab(0.54, 0.14, 0.28, P.field, 0.5);
  shoulders.position.set(0, SEAT + 0.72, 0.11);
  figure.add(shoulders);

  // Pivoted at the elbow, so the same two boxes are a forearm resting on a knee
  // at rotation zero and a forearm hanging at her side at a quarter turn. The
  // children are authored at their real coordinates and filed relative, exactly
  // as the legs are.
  const forearms = new THREE.Group();
  forearms.name = SERDAB_NAMES.forearms;
  forearms.position.set(0, STAND.elbow.y, STAND.elbow.z);
  figure.add(forearms);

  for (const s of [-1, 1]) {
    const upper = slab(0.11, 0.40, 0.13, P.field, 0.5);
    upper.position.set(s * 0.25, SEAT + 0.48, 0.10);
    upper.rotation.x = 0.20;
    figure.add(upper);

    const fore = slab(0.10, 0.11, 0.34, P.flesh, 0.5);
    fore.position.set(s * 0.23, SEAT + 0.26 - STAND.elbow.y, 0.24 - STAND.elbow.z);
    forearms.add(fore);
  }

  const neck = slab(0.10, 0.09, 0.10, P.flesh, 0.5);
  neck.position.set(0, SEAT + 0.83, 0.14);
  figure.add(neck);

  const head = slab(0.19, 0.23, 0.21, P.flesh, 0.5);
  head.position.set(0, SEAT + 0.98, 0.16);
  figure.add(head);

  /**
   * HER EYES, AND THEY ARE TWO BOXES AT ZERO EMISSIVE.
   *
   * The one thing beat 4.7 needs that this room did not have. A face with no
   * eyes cannot take a telegraph, and nothing else on her can carry it: the
   * gilding channel on a god is high-metalness ornament, and she is the only
   * thing in World 1 deliberately made of two flat materials with no maps.
   *
   * They are grouped rather than added twice so `story/meeting.js` has ONE
   * object to find. On the front face of the head - the head is 0.21 deep at
   * z 0.16, so its face is at 0.265 - and 0.007 proud of it, which is the
   * smallest gap that does not z-fight under swiftshader.
   *
   * castShadow off: two centimetres of eye throwing a shadow across a face is
   * a shadow-map artefact, not a feature, and there is one light in this room.
   */
  const eyes = new THREE.Group();
  eyes.name = SERDAB_NAMES.eyes;
  eyes.position.set(0, SEAT + 1.01, 0.272);
  figure.add(eyes);
  for (const s of [-1, 1]) {
    const e = slab(0.040, 0.026, 0.014, P.eye, 0.5);
    e.position.set(s * 0.044, 0, 0);
    e.castShadow = false;
    eyes.add(e);
  }

  // Tied back, which is the only hair a person works in. It is also the whole
  // of the read from behind, which is the angle the player arrives at.
  const hair = slab(0.21, 0.20, 0.20, P.hair, 0.5);
  hair.position.set(0, SEAT + 1.01, 0.12);
  figure.add(hair);

  const tail = slab(0.09, 0.16, 0.10, P.hair, 0.5);
  tail.position.set(0, SEAT + 0.90, 0.03);
  figure.add(tail);

  /**
   * ONE DISC, AND IT IS THE SIZE OF A PERSON ON A STOOL.
   *
   * Not a wall run and not a box: she stands in open floor in a room with one
   * door, and the 8/01 playtest's lesson is that geometry in the middle of a
   * space must be something the player goes AROUND rather than something they
   * get caught on. A single 0.62 disc 1.5 m tall has no concave side to be
   * cornered in and leaves better than four metres of clear floor on every side
   * of her.
   */
  addCollider(slot.x, slot.z, 0.62, 1.5);

  return g;
}

/**
 * Her lamp, standing on the floor beside her.
 *
 * THE ROOM'S ONLY LIGHT HANGS ON IT. `buildLights` gives a room one point light
 * per sixteen metres of its long axis - which for a fourteen-unit room is
 * exactly one - and hangs it on the first brazier anchor the props registered.
 * The Serdab's brazier has been removed, so this is the only anchor and the
 * light lands where the fire the player can see is. It is pushed on at 0.72,
 * which is the height of the lens, so the room is lit from a lamp on the floor
 * rather than from a torch at head height, and every figure on the back wall is
 * raked from below.
 *
 * The phase is derived the same way the brazier derives it, so a later pass
 * that wants to make it flicker gets a number that is already stable per
 * position rather than a new one that drifts against the light.
 */
function fieldLamp(ctx, slot) {
  const { M, addCollider, anchors } = ctx;
  const P = personMaterials();
  const g = new THREE.Group();
  g.name = SERDAB_NAMES.lamp;

  // A squat case with a carry handle: a floor lamp that has been carried down
  // four hundred metres of shaft, not a lantern.
  const body = slab(0.30, 0.34, 0.24, M.gunmetal, DENSITY.metal);
  body.position.y = 0.19;
  g.add(body);

  /**
   * THE MARK, ON THE FACE OF THE CASE THAT LOOKS AT THE DOOR.
   *
   * The lamp shares her rotation - it is aimed at the niche, the way she is -
   * so its LENS faces away from the player for the whole game. The back of the
   * case is the side he has been looking at since the first minute, which is
   * exactly the side "the mark he has been finding on walls" belongs on: he has
   * seen this object at a distance a dozen times and has never once seen the
   * front of it.
   *
   * Local -z, 0.001 proud of the case at -0.121. Authored at zero emissive; see
   * `markTexture` and the eye material for the rule.
   *
   * A PLANE AND NOT A `slab`, which is the one place in this file that matters:
   * `uv.js`'s `box` bakes WORLD SCALE into the UVs so a shared masonry texture
   * keeps its texel density everywhere. That is right for stone and fatal for a
   * sign - at density 0.5 a 0.23 m face would sample 0..0.115 of the canvas,
   * which is the left-hand eighth of the ring and nothing else. A plane keeps
   * the 0..1 the mark was drawn in.
   */
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.15), P.sign);
  sign.position.set(0, 0.21, -0.1215);
  sign.rotation.y = Math.PI;
  sign.castShadow = false;
  sign.receiveShadow = false;
  sign.name = SERDAB_NAMES.sign;
  g.add(sign);

  const foot = slab(0.38, 0.04, 0.30, M.polymer, DENSITY.metal);
  foot.position.y = 0.02;
  g.add(foot);

  // The lens, facing the niche the way she is. It is the one hot thing in the
  // room and it is the object the player has been following since wave one.
  const lens = slab(0.24, 0.22, 0.05, P.lens, 0.5);
  lens.position.set(0, 0.22, 0.14);
  lens.castShadow = false;
  lens.name = 'serdab-lamp-lens';
  g.add(lens);

  const hood = slab(0.32, 0.06, 0.10, M.gunmetal, DENSITY.metal);
  hood.position.set(0, 0.36, 0.12);
  g.add(hood);

  for (const s of [-1, 1]) {
    const handle = slab(0.03, 0.16, 0.03, M.gunmetal, DENSITY.metal);
    handle.position.set(s * 0.13, 0.44, 0);
    g.add(handle);
  }
  const grip = slab(0.29, 0.03, 0.03, P.hair, 0.5);
  grip.position.set(0, 0.52, 0);
  g.add(grip);

  anchors.push({
    x: slot.x,
    y: ctx.base + (slot.y || 0) + 0.72,
    z: slot.z,
    phase: (slot.x * 13.7 + slot.z * 7.3) % 6.283,
  });

  // Low and small. It is knee height and the player should be able to walk
  // right up to her without the lamp holding them off.
  addCollider(slot.x, slot.z, 0.28, 0.55);

  return g;
}

/**
 * The prop types this room adds, in the shape build.js's PROPS registry wants.
 *
 * Exported as a table rather than as four functions so build.js's wiring is one
 * spread into the registry it already has, and so nothing outside this file has
 * to know how many of them there are.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT HERE: THE STRUCK CARTOUCHE
 * ---------------------------------------------------------------------------
 *
 * docs/NARRATIVE.md has a cartouche cut into the back wall whose struck-out
 * glyphs light one at a time and become readable when the fourth jar goes home
 * - and `ui/ending.js` puts them back, struck, on the card. That object has a
 * STATE, and its state is owned by the jar chain in systems/jars.js, which this
 * lane does not touch. A static version of it built here would be a stateful
 * object frozen at one of its two values, which is worse than an absent one: it
 * would either contradict the narrative beat that lit it or pre-empt the card
 * that strikes it.
 *
 * So the wall above the row is left clear for it. The empty band is 2.29 m of
 * limestone between the cap course and the ceiling, centred over the row, and
 * it is the right size and the right place for a cartouche.
 */
export const SERDAB_PROPS = {
  'ka-row': kaRow,
  'eleventh-niche': eleventhNiche,
  archaeologist,
  'field-lamp': fieldLamp,
};

/** Read by the harness so a measurement can quote what it was measuring. */
export const SERDAB_METRICS = {
  PITCH, PLINTH_H, CAP_H, FIGURE_H, PROUD, PANEL_D, NICHE_W, NICHE_H,
};
