/**
 * Buy-doors: the loop the whole map is built around.
 *
 * A barrier is a price tag with geometry attached. Look at one, see what it
 * costs, pay it, and the map gets bigger. That is the entire mechanic, and it
 * is load-bearing for two reasons: it paces how fast the player meets the map,
 * and it gives gold somewhere to go, which is what makes gold worth earning.
 *
 * The split with world/build.js is deliberate. build.js owns what a barrier IS
 * (meshes, colliders, the animation that clears it). This file owns what it
 * COSTS, whether it may be bought at all, and what it says when it may not.
 * Neither knows how the other does its half, which is what lets the geometry be
 * retuned without touching the economy and the prices be retuned in rooms.js
 * without touching geometry.
 *
 * Three kinds of refusal, and they read differently on purpose:
 *   - too poor:  the price goes red. The door is for sale, you are short.
 *   - power:     no price at all. It is not for sale, it needs the Kindling.
 *   - puzzle:    no price at all. It needs the four sons returned.
 * A player who cannot tell "come back richer" from "come back later" will grind
 * gold at a door that will never open for gold.
 *
 * Every rate in here is multiplied by the clamped frame delta, including the
 * courtyard slab's descent, so a backgrounded tab resumes with the door part
 * way open rather than having finished it while nobody was watching.
 */

import * as THREE from 'three';
import { ENTRY } from '../world/rooms.js';

/** How far the player can reach a barrier from, in world units. */
const REACH = 5.5;

/**
 * How many sons of Horus open the sealed chapel. Four, because there are four
 * canopic jars and four niches, and it is a constant here rather than a literal
 * inside `lockedBecause` because the same number is quoted to the player in the
 * refusal string one line away from where it is tested.
 */
const JARS_REQUIRED = 4;

/** Seconds for the courtyard slab to grind down out of its doorway. */
const SLAB_SECONDS = 1.6;

/**
 * The threshold the player crosses to be taken inside, and the one they cross
 * to come back out.
 *
 * Both sit a short walk PAST the doorway they belong to rather than in it, so
 * paying for the door does not itself trigger the transition. The player pays,
 * watches the stone move, and then walks through it. That step is the whole
 * moment.
 */
/*
 * `fadeFrom` is where the screen starts going dark and `blackBy` is where it
 * has finished, both measured along z in the direction of travel.
 *
 * THE ONLY THING THAT MAKES THIS SAFE: `blackBy` is on the near side of `z`.
 * The curtain is a function of position, evaluated in the same update, from
 * the same coordinates, immediately before the same test that fires the swap -
 * so on whatever frame the player crosses `z`, the fade has already passed
 * `blackBy` and the curtain reads exactly 1. Not "usually", not "at 60 fps":
 * the crossing frame cannot be reached without the black, because both are
 * read off the same number. A fade driven by a clock would have been a race
 * with the frame rate, and it would have been lost precisely on the slow
 * frames - which is when this transition runs, because it is the transition
 * that makes the frames slow.
 *
 * The jamb line is at z = -30.2 and the black sheet described below hangs at
 * -30.1, so entering is complete on the near side of it. That is not a round
 * number chosen for looks - it is the last z at which the sheet is still in
 * front of the camera. Past it the player is inside the pyramid's own solid
 * mass, which has no inside, and the only thing that can be shown there is
 * nothing. Leaving is the same shape mirrored, and it has a sheet of its own:
 * the interior's entry wall is NOT sealed - an earlier version of this comment
 * said it was, and it was measuring the wrong wall - so there is a second sheet
 * hung across the opening from the inside. See DAYLIGHT.
 */
const ENTER_AT = { z: -31.6, halfWidth: 2.6, fadeFrom: -27.6, blackBy: -30.0 };
const EXIT_AT = { z: -140.8, halfWidth: 2.2, fadeFrom: -144.6, blackBy: -141.6 };

/**
 * How far off the doorway's centreline the fade stops applying, past the
 * width the threshold itself accepts.
 *
 * It has to be a margin OUTSIDE `halfWidth` rather than a taper across it, or
 * a player entering at the edge of the opening would cross the line at less
 * than full black and see the swap. Inside `halfWidth` this term is exactly 1,
 * which is what keeps the guarantee above true.
 */
const VEIL_MARGIN = 1.2;

/** Where the player is put down when they come back out of the pyramid. */
const RETURN_TO = { x: 0, z: -27.0, rot: Math.PI };

/**
 * The dark behind the door, as geometry.
 *
 * "We walk through a wall" is literally what was happening. The doorway is a
 * hole in a stepped mass that has no inside - once the slab drops you are
 * looking at the back of the pyramid's own casing, bright orange stone with
 * hieroglyphs on it, and past z = -31 those faces cull and the player is
 * looking out the far side at open desert with the whole necropolis behind
 * them. Both measured on the pristine build, held at z = -22 and z = -31.4.
 *
 * So one unlit black sheet is hung across the opening, and where it hangs is
 * the entire design of it. A DEEP void was tried first - an open-fronted box
 * behind the doorway, so the passage would have a floor and walls - and it
 * looked right from down the avenue and failed completely from two metres out,
 * because the pyramid's own mass sits immediately behind the jamb and wins the
 * depth test against anything further back. The sheet has to be the NEAREST
 * surface inside the opening, not the furthest, and at the jamb line nothing
 * can be in front of it but the slab, which has dropped.
 *
 * It is sized to the 5.2 x 8.8 opening with a hair of bleed, so the jambs, the
 * lintel and the set-back soffit still frame it. Unlit and unfogged: anything
 * that tints it gives it a distance, and a distance makes it a surface again.
 *
 * `z` is 0.15 and it is boxed in on both sides, which is worth the sentence.
 * Below it, the temple mass carries a course straight across the opening at
 * world -30.10, and the first version of this sat exactly on it - the sheet
 * came out black with one lit stone band across it, found by raycasting a
 * column down the doorway rather than by staring at the screenshot. Above it,
 * 0.2 is where the slab's mover filter starts, and anything at or past that
 * gets driven into the sand when the door is bought. The material carries a
 * polygon offset as well, so the next person to nudge the mass by four
 * centimetres does not get the band back.
 */
const VOID = { w: 5.3, h: 8.9, y: 4.4, z: 0.15 };

/**
 * The daylight behind the door, as geometry. The inverse of VOID above, and it
 * exists because the sentence in the ENTER_AT block that said it did not need to
 * was WRONG.
 *
 * That sentence claimed the interior's entry wall is "already a sealed wall and
 * measures at luminance 0.3 from a stride away". It is not sealed. ENTRY is a
 * portal like any other, it goes into collectPortals with `from: null`, and
 * buildShell cuts it a 4.5 x 4.2 opening in the Chamber of Ascent's +Z wall with
 * a lintel over it exactly as it does for every other doorway. What buildBarriers
 * skips is the BARRIER - correctly, because the granite slab out in the courtyard
 * is the same door charged once - and skipping the barrier was mistaken for
 * skipping the hole. Measured on this build, camera at z -147 facing +Z: the
 * opening reads mean luminance 0.0, min 0, max 0, against the lit wall beside it
 * at 45.2, and a ray cast straight down the doorway axis returns NO INTERSECTION
 * AT ALL while the same ray fired the other way hits five surfaces. It is not a
 * dark wall. It is a rectangular hole onto nothing, and the 0.3 in the old
 * comment was a measurement of the wrong wall.
 *
 * So the mirror argument applies in full. Standing in a torchlit chamber looking
 * back at a doorway onto desert noon, the eye is adapted to the room and the
 * opening does not read as a view of the courtyard - it reads as a hole punched
 * in white. That is what this sheet is, and it is the world-space half of the
 * same idea the curtain in spaces.js plays across the whole frame on the way out.
 *
 * WHERE IT HANGS IS THE SAME ARGUMENT AS VOID'S, WITH THE SIGN FLIPPED. The
 * sheet must be the NEAREST surface in the opening as seen FROM THE ROOM, which
 * here means the least-negative-z side is the wrong one. buildShell centres the
 * wall slab half a thickness inside its line, so the +Z wall of a room whose line
 * is z -140 occupies -141.0 to -140.0 and presents its -141.0 face to the room.
 * The sheet sits 6 cm proud of that face, at -141.06. A sheet hung on the FAR
 * face at -140.0 was the obvious alternative and it is the deep-void mistake
 * again in a new costume: from an angle the near edge of the opening would clip
 * it and the player would see a slice of unlit black between the white and the
 * stone, which is the one thing this is here to remove.
 *
 * IT IS MUCH BIGGER THAN THE HOLE, AND THAT IS THE WHOLE OF THE SECOND HALF.
 *
 * A sheet cut to 4.5 x 4.2 was built first and photographed, and it is a white
 * card taped over the doorway - a hard-edged rectangle that shares no light with
 * the room it is standing in. A blown highlight in an eye or a lens is not a
 * shape with an edge; it is a core the sensor cannot hold surrounded by a skirt
 * of scattered light falling off into the frame, and the skirt is the entire
 * reason the core reads as too bright to look at rather than as white paint.
 *
 * The pass that would normally do that is UnrealBloomPass, and it was tried
 * SECOND and rejected on measurement. Its threshold is 1.60 in linear HDR and it
 * was tuned for small sources: ejected brass, the muzzle flash, a brazier. Its
 * radius scales with the source, so a 4.5 by 4.2 metre emitter does not gain a
 * halo when it crosses the line, it detonates. Measured at z -147, mean luminance
 * of a wall patch well clear of the opening, sweeping the sheet's radiance in one
 * page:
 *
 *     x1.20   opening 242.3   wall   6.5
 *     x1.40   opening 243.0   wall   7.2
 *     x1.55   opening 243.3   wall   6.0     <- this
 *     x1.75   opening 245.3   wall  98.1
 *     x2.10   opening 245.4   wall 110.8
 *     x2.60   opening 245.4   wall 128.2
 *
 * There is no middle setting. The opening is already as white as it will ever get
 * at x1.20 - everything past that buys nothing but acreage - and the wall goes
 * from unlit stone to half-lit in one step of 0.2. At x1.75 and above the doorway
 * has stopped being a doorway: the shot is a white oval covering two thirds of the
 * frame with the braziers ghosting through it. That is precisely the failure the
 * threshold comment in core/post.js describes and was raised to 1.60 to stop, and
 * borrowing that budget for a wall-sized emitter would spend it all.
 *
 * So the falloff is IN THE SHEET, not in the post chain. The plane is 5.6 x 5.2 -
 * roughly half a metre proud of the opening on the sides and the top - opaque
 * across the hole and feathered to nothing over the surrounding stone, by an
 * alpha ramp built in makeFalloff below. The skirt therefore lands ON the jamb
 * and the lintel, which is where light spilling out of a doorway actually lands,
 * and it costs one 64 x 64 texture and no fullscreen work. It also behaves
 * identically at LOW fidelity, where post.js turns bloom off entirely - a
 * transition that stops selling itself on the machines least able to afford the
 * transition is exactly backwards, which is the same argument spaces.js makes
 * for the curtain being DOM.
 *
 * THE OPAQUE CORE IS SMALLER THAN THE HOLE, WHICH LOOKS WRONG WRITTEN DOWN.
 *
 * `coreX` 0.66 puts full opacity out to 1.85 of the 2.8 half-width, and the jamb
 * is at 2.25. The reason is that the eye's edge is not the alpha's edge. Against
 * unlit stone this sheet still reads as white down to about alpha 0.64, because
 * 0.64 of 1.55 linear is 1.0, which the tone mapper still puts at 229 - so the
 * PERCEIVED white runs to 2.23, a couple of centimetres inside the jamb, and the
 * glow tails off over the next 20. A core drawn out to the real jamb was built
 * first and photographed: the white swallowed the lintel and the doorway stopped
 * having proportions. What is on screen is the thing being tuned, not what the
 * texture says.
 *
 * The vertical ramp is ASYMMETRIC and that is a correctness matter rather than a
 * taste one. There is no feather at the bottom: the sheet runs to -0.50, well
 * under the room's floor plane, at full opacity all the way. Feathering the
 * bottom would put alpha under 1 across the lowest part of the OPENING, and what
 * is behind the opening is the same nothing this file exists to cover, so the
 * doorway would gain a grey band along its base. Everything the sheet does below
 * y 0 is hidden by the floor from any standing eye height anyway, which is what
 * makes the hard bottom edge honest: it is the floor's own silhouette, not the
 * sheet's.
 */
const DAYLIGHT = { w: 5.6, h: 5.2, y: 2.10, z: -141.06, coreX: 0.66, coreTop: 0.837 };

/**
 * The colour, in LINEAR working space, and it is over 1 on purpose.
 *
 * This is the one place the naive version does not work. A MeshBasicMaterial set
 * to #fffaf0 - the curtain's colour in spaces.js, and the right hue - is a linear
 * radiance of about (1.00, 0.96, 0.87), and the frame does not end there: the
 * output pass tone maps ACES filmic at exposure 1.05, a curve built to roll
 * highlights OFF, and it brings a flat 1.0 back down to about 229 on screen.
 * That is a light grey rectangle. It reads as a wall painted white, not as an
 * opening the eye cannot resolve, and it would have been a comment claiming a
 * blowout over a picture that did not have one.
 *
 * A blown highlight is not a bright colour, it is a quantity of light past what
 * the sensor can hold, so the sheet is authored as one: the same hue at 1.55x,
 * which the tone mapper clips to 243 of a possible 255 on its own. 1.55 rather
 * than more because 1.60 is the bloom threshold and the table above is what
 * happens on the far side of it; rather than less because the margin under the
 * line is the only thing standing between this doorway and that white oval, and
 * it should be a real margin rather than a rounding error.
 *
 * Set through setRGB in LinearSRGBColorSpace rather than from a hex, because a
 * hex cannot express a value above 1 and set() would silently clamp the whole
 * effect back to the grey rectangle described above.
 */
const DAYLIGHT_LINEAR = { r: 1.550, g: 1.482, b: 1.350 };

export function createDoors({
  scene, camera, player, economy, audio, spaces, interior,
  courtyard, prompt, notice,
}) {
  /** Meshes a look-at ray may hit, per space. Explicit lists, because handing
   * a raycaster the whole scene would test five hundred interior meshes and
   * the entire courtyard every frame for an answer that involves nine doors. */
  const courtyardTargets = [];
  const interiorTargets = [];

  /**
   * THE ACT 1 CLAIMS: the Quarry and the Canal, adopted rather than built.
   *
   * world/courtyard.js builds both mouths and hands them over as records that
   * are already exactly the shape this file drives - open(), advance(dt), the
   * meshes with userData.door already stamped, and advance already called every
   * frame from courtyard.update. What they were missing is the half that is not
   * that file's to write, and it is the same split the sealed doorway follows:
   * courtyard.js owns what a barrier IS, this file owns what it COSTS and
   * whether it may be bought.
   *
   * Two lines, and without them both spaces are finished, sealed and
   * unreachable - which is what they were. Nothing raycast the meshes, so no
   * prompt ever appeared, so no gold was ever taken. Adding them to
   * `courtyardTargets` is what makes a look-at ray find them, and adding them to
   * `all` is what makes the objective ladder, the HUD and the harness able to
   * see a door that exists.
   *
   * Guarded rather than assumed: a courtyard built before this existed, or a
   * harness that stubs it, returns no claims and this does nothing.
   */
  const claims = (courtyard && courtyard.claims) || [];
  for (const c of claims) courtyardTargets.push(...c.parts);

  const state = {
    /**
     * How many canopic jars are back in their niches, 0 to 4.
     *
     * READ HERE, WRITTEN BY systems/jars.js, AND THAT SPLIT IS DELIBERATE.
     *
     * This counter was declared here and written NOWHERE for the whole of M4,
     * which meant `lockedBecause` below quoted "0 of 4 sons returned" forever
     * and the Serdab - the room World 1 ends in - could not be entered in a
     * shipped build. The fix is not to move the number: two readers already
     * live off it here, this file's puzzle gate and ui/objective.js's detail
     * line, and both were correct. What was missing was a writer.
     *
     * systems/jars.js is that writer and it is the ONLY one. It is constructed
     * after this file, holds a reference to this state object, and sets this
     * field from its own count of filled niches on the frame a jar goes home.
     * One writer, two readers, no derivation anywhere else.
     */
    jarsReturned: 0,
    /** Set once the courtyard's collider has actually been released, so a
     * harness can tell a working purchase from a purchase that changed a flag
     * and left the doorway solid. */
    doorwayCleared: false,
    bought: 0,
    denied: 0,
    entered: 0,
  };

  const ray = new THREE.Raycaster();
  const centre = new THREE.Vector2(0, 0);

  let candidate = null;

  // ---------------------------------------------------------------------------
  // the courtyard's sealed doorway
  // ---------------------------------------------------------------------------

  /**
   * Wrap the courtyard's granite slab in the same record shape the interior
   * barriers use, so the prompt and the purchase path have exactly one kind of
   * thing to handle.
   *
   * The slab is read out of the scene graph rather than built here: it is a
   * courtyard object, authored in the courtyard, and this file has no business
   * owning a second copy of it.
   */
  function makeSealedDoorway() {
    const slab = scene.getObjectByName('sealed-doorway');
    if (!slab || !slab.parent) return null;

    const frame = slab.parent;

    // The moving parts are the pieces standing proud of the jamb line: the
    // slab itself and the sun-disc mounted on its face. The jambs, lintel, and
    // cornice sit ON the line and are the doorway, not the door.
    const parts = frame.children
      .filter((o) => o.isMesh && o.position.z > 0.2)
      .map((o) => ({ mesh: o, y0: o.position.y }));

    const drop = 9.4;   // the slab is 8.6 tall and its foot is on the sand

    const record = {
      type: 'door',
      id: 'courtyard/entry',
      kind: ENTRY.kind,
      cost: ENTRY.cost,
      label: 'Sealed Doorway',
      x: frame.position.x,
      z: frame.position.z,
      opened: false,
      opening: false,

      open() {
        if (record.opened || record.opening) return false;
        record.opening = true;
        releaseDoorway();
        return true;
      },
    };

    let t = 0;
    record.advance = (dt) => {
      if (!record.opening) return;

      t = Math.min(1, t + dt / SLAB_SECONDS);
      // Ease out. Nine tonnes of granite does not stop dead.
      const k = 1 - Math.pow(1 - t, 3);
      for (const p of parts) p.mesh.position.y = p.y0 - drop * k;

      if (t >= 1) {
        record.opening = false;
        record.opened = true;
        for (const p of parts) p.mesh.visible = false;
      }
    };

    for (const p of parts) p.mesh.userData.door = record;
    courtyardTargets.push(...parts.map((p) => p.mesh));

    // AFTER the parts filter above, and it has to stay that way round: that
    // filter takes every child of the frame standing proud of the jamb at
    // z > 0.2 and drives it into the ground, and the sheet sits at 0.15. It is
    // five centimetres from being carried away by the door it is behind.
    buildVoid(frame);

    return record;
  }

  /** Hang the dark across the doorway. See VOID above for where and why. */
  function buildVoid(frame) {
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(VOID.w, VOID.h),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        // Both faces. The player walks through this thing, and for the frame
        // or two they are behind it - at full black, but still - a hole in the
        // world behind them is not something to leave lying around.
        side: THREE.DoubleSide,
        fog: false,
        // Wins the depth test against anything sharing its plane. See VOID.
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -8,
      }),
    );

    sheet.position.set(0, VOID.y, VOID.z);
    sheet.name = 'doorway-void';

    // Not a surface. It must not stop a bullet, take an impact decal, or turn
    // up under the interact ray - all three would be the game insisting there
    // is something there.
    sheet.userData.noHit = true;
    sheet.userData.noPick = true;
    sheet.castShadow = false;
    sheet.receiveShadow = false;

    frame.add(sheet);
    return sheet;
  }

  /**
   * Let the player through the doorway they just paid for.
   *
   * Two collider edits, and the second is the one that is easy to miss. The
   * slab's own disc obviously has to go. But the pyramid is also a collider - a
   * single 32-unit cylinder standing in for a 62-unit stepped mass - and its
   * edge falls almost exactly on the doorway. With it in place the player is
   * held half a metre off the open door and can never step through.
   *
   * It is nudged back and narrowed rather than deleted. Deleting it would leave
   * the whole exterior pyramid non-solid, and the player would walk into the
   * side of it. Sliding the disc two units further into the mass leaves four
   * units of clear approach at the doorway and still seals every face, which is
   * all the original disc ever did: a circle inscribed in a square never
   * covered the corners either.
   */
  function releaseDoorway() {
    const list = courtyard.colliders;

    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (Math.abs(c.x) < 0.2 && Math.abs(c.z + 30.2) < 0.2 && c.r > 2.5 && c.r < 4) {
        list.splice(i, 1);
        state.doorwayCleared = true;
      }
    }

    for (const c of list) {
      if (Math.abs(c.x) < 0.2 && Math.abs(c.z + 62) < 0.5 && c.r > 25) {
        c.z = -64;
        c.r = 30;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // the interior
  // ---------------------------------------------------------------------------

  const sealed = makeSealedDoorway();

  /**
   * The alpha ramp that turns a rectangle into a blowout.
   *
   * A DataTexture written by hand rather than a canvas drawn with a gradient,
   * for two reasons that are both about honesty. A CanvasTexture is uploaded
   * through the browser's 2D compositor and picks up whatever colour management
   * that applies; an alpha ramp must be read raw or the curve is not the curve
   * that was written. And the falloff wanted here is not a stock radial
   * gradient - it is flat across the opening and only then rolls off - which is
   * two lines of arithmetic and no lines of gradient-stop guessing.
   *
   * Separable and multiplied rather than a radial distance, so the flat core is
   * a RECTANGLE matching the doorway rather than a circle inscribed in it. The
   * product also rounds the corners on its own, which is what light does.
   *
   * Smoothstep and not a linear ramp: a linear falloff has a visible crease
   * where it meets the flat core, and the crease is a line, and a line is an
   * edge, which is the thing being removed.
   *
   * The two axes are NOT the same function. Across, the ramp is symmetric about
   * the centre and both jambs get a skirt. Up, it is measured from the bottom of
   * the sheet rather than from its centre, so there is no feather at the floor
   * end at all - see the DAYLIGHT note on why a feathered base would put a grey
   * band across the bottom of the doorway.
   *
   * 64 x 64 because this is a texture with no detail in it. It is stretched
   * across five metres and sampled bilinearly, so resolution buys nothing and
   * the upload is 16 KB. Row 0 of the data is v = 0, which PlaneGeometry puts at
   * the BOTTOM of the plane, and the vertical ramp is written expecting that.
   */
  function makeFalloff(coreX, coreTop) {
    const N = 64;
    const data = new Uint8Array(N * N * 4);

    /** 1 while d is inside `core`, smoothstepped to 0 by d = 1. */
    const roll = (d, core) => {
      if (d <= core) return 1;
      const k = Math.min(1, (d - core) / (1 - core));
      return 1 - k * k * (3 - 2 * k);
    };

    for (let y = 0; y < N; y++) {
      // v measured from the bottom edge, not from the middle: opaque all the way
      // down, feathered only over the lintel.
      const up = roll((y + 0.5) / N, coreTop);

      for (let x = 0; x < N; x++) {
        const across = roll(Math.abs((x + 0.5) / N - 0.5) * 2, coreX);
        const a = across * up;
        const i = (y * N + x) * 4;
        // All four channels. alphaMap reads green, but a texture whose other
        // channels disagree with it is a trap for whoever reuses it next.
        data[i] = data[i + 1] = data[i + 2] = data[i + 3] = Math.round(a * 255);
      }
    }

    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    // Left at the default NoColorSpace deliberately: this is a mask, not a
    // colour, and an sRGB decode would bend the ramp that was just written.
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    // Clamped, because a ramp that wraps puts the opaque core back at the far
    // edge of the skirt.
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Hang the daylight across the entry opening, from the inside. See DAYLIGHT
   * above for where and why.
   *
   * Added to the interior's own group rather than to the scene, so it is
   * switched off with the rest of the interior by spaces.js and is never a
   * white rectangle floating 110 units past the courtyard wall.
   *
   * Built here rather than in world/build.js for the same reason its opposite
   * number is: these two sheets are one idea seen from two sides, and the file
   * that owns the threshold between them is the file that should own both. The
   * builder knows how to cut an opening; it has no business knowing what the
   * light on the far side of it is supposed to feel like.
   */
  function buildDaylight() {
    if (!interior.group) return null;

    const mat = new THREE.MeshBasicMaterial({
      alphaMap: makeFalloff(DAYLIGHT.coreX, DAYLIGHT.coreTop),
      transparent: true,
      // Does not write depth. The sheet is the last thing between the player and
      // an opening with nothing behind it, so there is nothing for it to occlude
      // and nothing that needs to sort against it, and a transparent surface that
      // writes depth is how a skirt with alpha 0.02 starts hiding things.
      depthWrite: false,
      // Both faces, and here the far side is genuinely reachable rather than
      // theoretical. A player who arrives and turns straight round is not armed
      // for the exit threshold yet - see `armed` below - so the curtain stays
      // clear and they can walk the doorway right out to the interior's z bound
      // at -139.5, half a metre PAST this sheet. Single-sided, that walk ends
      // with them stood in an unlit pocket looking back through a one-way pane
      // at the room. Double-sided, they are looking at the back of the light,
      // which is the same answer the courtyard's sheet gives.
      side: THREE.DoubleSide,
      fog: false,
      // Wins the depth test against the wall face it is nearly touching, so the
      // six centimetres of clearance is a comfort rather than the whole defence.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    });
    mat.color.setRGB(
      DAYLIGHT_LINEAR.r, DAYLIGHT_LINEAR.g, DAYLIGHT_LINEAR.b,
      THREE.LinearSRGBColorSpace,
    );

    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(DAYLIGHT.w, DAYLIGHT.h), mat);

    // Faces +Z as built, which is straight back at a player standing in the
    // room, so no rotation. The entry opening is on the room's +Z wall and the
    // whole interior is laid out down -Z from it.
    sheet.position.set(ENTRY.at.x, DAYLIGHT.y, DAYLIGHT.z);
    sheet.name = 'doorway-daylight';

    // Not a surface, exactly as the void is not. It must not stop a bullet,
    // take an impact decal, or answer the interact ray: all three would be the
    // game insisting there is something in the doorway to deal with, when the
    // thing being sold is that there is nothing there but light.
    sheet.userData.noHit = true;
    sheet.userData.noPick = true;
    sheet.castShadow = false;
    // Nor receive one. It is the brightest thing in the room by construction,
    // and a torch shadow falling across the sun would be a nonsense.
    sheet.receiveShadow = false;

    interior.group.add(sheet);
    return sheet;
  }

  buildDaylight();

  for (const b of interior.barriers) {
    b.type = 'door';
    // Named for the room on the far side, which is what the player is buying.
    // Portals are authored on the room nearer the entrance, so `to` is always
    // the side the player has not seen yet.
    b.label = roomName(b.to);
    interiorTargets.push(...b.meshes);
  }

  /*
   * THE KINDLING USED TO BE A LEVER AND IT IS NOT ONE ANY MORE.
   *
   * What stood here built a `type: 'switch'` record over the Embalming
   * Chamber's fire bowl, stamped it onto every mesh of the fixture, pushed
   * those meshes into `interiorTargets`, and gave the F key a branch that
   * called `interior.setPowered(true)` directly. Roughly forty-five lines
   * across four places in this file, and all of them are gone.
   *
   * The trigger MOVED; the system did not. Power is now thrown by the third
   * canopic jar going home, through systems/jars.js calling the `throwSwitch()`
   * that systems/power.js has always exposed and describes in its own comment
   * as existing "for the day the puzzle chain wants to light the map from
   * somewhere else". power.js is untouched by this change, and so are the six
   * shrines, the light ramp, the horn, the chime, the notice and the power
   * gate into the King's Chamber, because none of them ever knew about a lever.
   *
   * WHAT SURVIVES, AND ON PURPOSE. The fire bowl itself is still authored in
   * rooms.js as a `power` interactSlot, so build.js still builds the granite
   * housing, the gold bowl, the ember sphere and the point light, and its
   * `animated.setPowered` still lifts all of it when the map wakes. It is
   * scenery that lights. It is simply no longer a thing you pull, which is what
   * turns "turn on the power" from a walk-to-the-switch errand into the payoff
   * of the only puzzle chain in the game.
   *
   * `power.js` still finds the slot by type for its own `slot` getter, and
   * ui/minimap.js still draws its flame off that slot, so the map still says
   * where the machine is. Both read rooms.js; neither read the record that was
   * here.
   */

  function roomName(id) {
    const room = interior.rooms.find((r) => r.id === id);
    return room ? room.name : 'Passage';
  }

  // ---------------------------------------------------------------------------
  // gates
  // ---------------------------------------------------------------------------

  /**
   * Why this barrier will not open, or null if gold is the only obstacle.
   * A gated barrier never shows a price: it is not for sale at any figure.
   */
  function lockedBecause(rec) {
    if (rec.kind === 'power') {
      return interior.powered ? null : 'The Kindling is cold';
    }
    if (rec.kind === 'puzzle') {
      /*
       * THE MISSING `null`, AND IT IS THE WHOLE OF WHY THE SERDAB WAS SEALED.
       *
       * This used to return the progress string unconditionally, so it was
       * TRUTHY at four out of four: the gate quoted "4 of 4 sons returned",
       * `describe` painted it red, and `interact` fell straight into `deny`.
       * A puzzle whose completed state is indistinguishable from its refusal
       * is a door with no open position, and every reader of this function
       * behaved perfectly - the fault was that a finished puzzle had no way to
       * say so.
       *
       * At four this returns null, which is the same word "gold is the only
       * obstacle" is said in, and `describe` then quotes no price because the
       * cost is zero. The payment was the four rooms.
       */
      const n = state.jarsReturned;
      return n >= JARS_REQUIRED ? null : `${n} of ${JARS_REQUIRED} sons returned`;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // prompt
  // ---------------------------------------------------------------------------

  let promptText = '';
  let promptDeny = false;

  function setPrompt(text, deny) {
    if (text === promptText && deny === promptDeny) return;
    promptText = text;
    promptDeny = deny;

    if (!prompt) return;
    prompt.textContent = text;
    prompt.classList.toggle('on', !!text);
    prompt.classList.toggle('deny', !!deny);
  }

  function describe(rec) {
    if (!rec) return { text: '', deny: false };

    const why = lockedBecause(rec);
    if (why) return { text: `${rec.label.toUpperCase()} - ${why.toUpperCase()}`, deny: true };

    // A gate whose condition has been met has no price to quote. The power
    // gate costs nothing once the Kindling is lit; the payment was the trip to
    // the embalming chamber.
    if (rec.cost <= 0) return { text: `OPEN ${rec.label.toUpperCase()}  [F]`, deny: false };

    const afford = economy.canAfford(rec.cost);
    return {
      text: `${rec.label.toUpperCase()} - ${rec.cost} GOLD${afford ? '  [F]' : ''}`,
      deny: !afford,
    };
  }

  // ---------------------------------------------------------------------------
  // interaction
  // ---------------------------------------------------------------------------

  function deny(message) {
    state.denied++;
    audio?.purchaseDenied?.();
    if (message && notice) notice(message, 1600);
    return false;
  }

  /** The F key. Returns true only if something in the world actually changed. */
  function interact() {
    const rec = candidate;
    if (!rec) return false;

    if (rec.opened || rec.opening) return false;

    const why = lockedBecause(rec);
    if (why) return deny(why);

    if (!economy.canAfford(rec.cost)) {
      return deny(`Need ${rec.cost - economy.gold} more gold`);
    }

    // spend() is the purchase. Checking affordability and then deducting as two
    // steps invites the state to change in between; this way the deduction
    // either happens or the buy did not. A free gate skips it entirely: spend()
    // refuses a zero charge, and rightly, so asking it to make one is a bug.
    if (rec.cost > 0 && !economy.spend(rec.cost, rec.id)) return deny();

    rec.open();
    state.bought++;
    audio?.shrineChime?.();

    if (rec.id === 'courtyard/entry') notice?.('The way is open', 2600);
    return true;
  }

  // ---------------------------------------------------------------------------
  // thresholds
  // ---------------------------------------------------------------------------

  /*
   * Teleport, not a tunnel, and the reason is in rooms.js: the interior is a
   * separate cell 110 units beyond the courtyard's outer wall, because the
   * playable interior is several times larger than the 62-unit stepped mass
   * that reads correctly on the skyline. There is no scale at which both are
   * true, so the two spaces are never both real at once. The doorway is the
   * seam, and it is hidden by the one thing that hides a seam perfectly: the
   * player walks through a hole in a wall and comes out somewhere dark.
   *
   * That sentence was the design and it was never built. What actually
   * happened was that the player walked through a hole in a wall, spent a
   * metre and a half inside solid stone looking out the back of it, and was
   * then handed the far cell mid-stride with the camera still in the
   * forecourt. The three pieces below are that sentence, finally: VOID makes
   * the far side of the doorway dark, veilFor takes the screen down to black
   * on the approach, and spaces.js does the swap where nobody is looking.
   */

  /**
   * How black the screen should be, given only where the player is standing.
   *
   * No clock, no state, no memory - which is what makes it impossible to be
   * stuck in. Turn round two paces from the doorway and the room comes back on
   * the same frame, because there was never a fade running, only a number
   * being read off a position.
   */
  function veilFor(spec, p) {
    const along = (p.z - spec.fadeFrom) / (spec.blackBy - spec.fadeFrom);
    if (along <= 0) return 0;

    const lateral = (spec.halfWidth + VEIL_MARGIN - Math.abs(p.x)) / VEIL_MARGIN;
    if (lateral <= 0) return 0;

    return Math.min(1, along) * Math.min(1, lateral);
  }

  /**
   * Whether the threshold the player is walking toward is allowed to fire.
   *
   * Cleared on arrival and set again only once the player is clear of the
   * whole fade zone, which is doing two jobs at once. It stops the doorway
   * they have just come through from grabbing them straight back - the entry
   * spawn at z -143.5 is inside the exit's fade zone, so without this the room
   * would come up permanently a third dark and one step would send them back
   * out. And it means the answer to "what if they turn round mid-transition"
   * is that there is nothing to turn round out of: the swap already happened,
   * the fade in always finishes, and the door behind them is inert until they
   * have genuinely walked away from it.
   */
  let armed = true;

  /**
   * Drive the curtain, then decide whether to cross.
   *
   * Order is the whole safety argument. The curtain is set from THIS frame's
   * position before the threshold is tested against THAT SAME position, so the
   * frame that crosses is a frame on which the screen has already been told to
   * be black. See ENTER_AT.
   */
  function advanceThreshold(dt) {
    const p = player.position;
    const inside = spaces.active === 'interior';
    const spec = inside ? EXIT_AT : ENTER_AT;

    // No darkening in front of a door that will not open. Standing at a slab
    // that is still sealed and having the lights go down would be the game
    // promising something it is about to refuse.
    const live = inside || !!(sealed && sealed.opened);
    const want = live ? veilFor(spec, p) : 0;

    if (!armed) {
      // Still leaving. veilTick is called anyway: a fade IN that is in flight
      // has to keep running, and it ignores the demand while it does.
      if (want <= 0) armed = true;
      spaces.veilTick(dt, 0);
      return;
    }

    spaces.veilTick(dt, want);

    if (!live) return;

    // Inside, the player walks OUT through the entry doorway - without this
    // they walk out over a floor that does not exist. Outside, they walk in.
    // The comparison flips with the direction of travel; nothing else does.
    const past = inside ? p.z >= spec.z : p.z <= spec.z;
    if (!past || Math.abs(p.x) > spec.halfWidth) return;

    if (inside) {
      if (spaces.enter('exterior', RETURN_TO)) armed = false;
      return;
    }

    if (spaces.enter('interior', ENTRY.spawn)) {
      state.entered++;
      armed = false;
    }
  }

  // ---------------------------------------------------------------------------
  // frame
  // ---------------------------------------------------------------------------

  function pick() {
    const list = spaces.active === 'interior' ? interiorTargets : courtyardTargets;
    if (!list.length) return null;

    ray.setFromCamera(centre, camera);
    ray.far = REACH;

    const hits = ray.intersectObjects(list, false);
    for (const h of hits) {
      const rec = h.object.userData.door;
      if (!rec) continue;
      if (rec.opened || rec.opening) continue;
      return rec;
    }

    return null;
  }

  function update(dt) {
    if (sealed) sealed.advance(dt);

    candidate = pick();
    const { text, deny: red } = describe(candidate);
    setPrompt(text, red);

    advanceThreshold(dt);
  }

  return {
    state,
    update,
    interact,

    /**
     * Whether the threshold the player is walking toward may fire. False from
     * the moment they are taken until they are clear of the doorway they
     * arrived at. Exposed so a harness can tell "the door refused" from "the
     * door has not been walked away from yet".
     */
    get armed() { return armed; },

    /** The barrier currently under the crosshair, for the harness and the HUD. */
    get candidate() { return candidate; },
    get prompt() { return promptText; },

    /**
     * Every door in the game, courtyard slab first, then the two Act 1 claims,
     * then the pyramid's own barriers.
     *
     * The order is the order the player meets them and it is load-bearing: the
     * objective ladder names the next CLOSED barrier by walking this list, so a
     * list that put the interior first would send a player who has not yet
     * bought their way inside to a door they cannot reach.
     */
    get all() {
      return [
        ...(sealed ? [sealed] : []),
        ...claims,
        ...interior.barriers,
      ];
    },

    byId(id) { return this.all.find((d) => d.id === id) || null; },
  };
}
