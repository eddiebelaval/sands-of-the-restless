/**
 * THE FOUR FRAGMENTS, AS DATA. Nothing in this file executes anything.
 *
 * ---------------------------------------------------------------------------
 * WHAT THEY ARE
 * ---------------------------------------------------------------------------
 *
 * `docs/NARRATIVE.md` PART ZERO is the third of the story that happens before
 * the title screen, and the player learns it in quarters, out of order, from
 * four canopic jars. Each jar holds one of the four colleagues who were killed
 * where they stood, and consuming a soul for what it knew is meeting 2's own
 * mechanic: "we consume the jars to give us the knowledge." The knowledge is
 * what that person SAW. He is eating his own team to remember his own death.
 *
 * Authored exactly as the narrative fixes them, in the order the map hands the
 * jars over:
 *
 *   1. Seven black shapes in a stone room, doing something to a door.
 *   2. The same, with growth on the wall behind them in a colour that is not a
 *      colour, and one shape standing much too close to the door.
 *   3. The shapes are being killed, and one of them is him - and the
 *      perspective is wrong, because he is watching himself from where SHE was
 *      hiding.
 *   4. He sees himself die. Not how. Just that he did, and that she was there.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT IN HERE
 * ---------------------------------------------------------------------------
 *
 * NO FACES, NO TEXT, NO NAMES, NO MARKER ON WHICH SHAPE IS HIM. Meeting 2 is
 * explicit: "like a black silhouette almost, of us, the whole group of
 * scientists who open the door. But they're a black silhouette, so they don't
 * know who we are." Tinting one figure to say "this one is you" would answer,
 * four jars early, the only question the game is actually asking, and it would
 * do it in a colour. The player identifies him by arithmetic - seven on the
 * briefing's manifest, four in jars, one still standing at the end - and that
 * arithmetic is the whole engine. It is also free: a shape that is not marked
 * costs nothing to not mark.
 *
 * NO MECHANISM IN FRAGMENT 4. "Not how. Just that he did." The still before the
 * cut has him standing and alone; the still after it has a body. What killed him
 * is never in frame, in either.
 *
 * NO MOTION, ANYWHERE. `docs/STORY-DELIVERY.md` prices a held frame and refuses
 * a camera path. Fragment 4 gets the one thing that was bought instead: TWO
 * stills with a HARD CUT, which is decision 3 and the owner's recommendation.
 * A cut is an array index, not a camera move.
 *
 * ---------------------------------------------------------------------------
 * THE COLOUR THAT IS NOT A COLOUR
 * ---------------------------------------------------------------------------
 *
 * `GROWTH` below is the only saturated hue in this game. World 1 is stone,
 * sand, gold and firelight; nothing native to it is green, and nothing native
 * to it is that clean. The growth reads as impossible because the palette
 * around it has never once done this, not because the hex is exotic - and
 * because the tableau bypasses the composer, no grade will ever soften it into
 * the room's colour space. That is decision 5 working for us rather than
 * against us.
 *
 * ---------------------------------------------------------------------------
 * THE RECORD SHAPE, WHICH IS THE POINT
 * ---------------------------------------------------------------------------
 *
 *   {
 *     id:     string,
 *     camera: { at:[x,y,z], look:[x,y,z], fov },
 *     fade:   { in, out, back },              // optional, ms
 *     stills: [ { hold: ms, shapes: [ ... ] } ],
 *   }
 *
 *   shape = { box:[w,h,d] | plane:[w,h], at:[x,y,z], rot:[rx,ry,rz],
 *             tone: 0..1 | color: 0xRRGGBB, opacity }
 *
 * `src/story/tableau.js` knows this and nothing else. There is no jar in it, no
 * room name, no son of Horus and no wave number, so World 2's four fragments
 * and World 3's are a data entry each and not a second driver.
 */

// ---------------------------------------------------------------------------
// the palette, and it is four numbers
// ---------------------------------------------------------------------------

/** Pure black. Every person in every fragment is this and only this. */
const BLACK = 0;

/**
 * The stone the memory is made of. Low, and only just above the void.
 *
 * RAISED after the first measured run: at 0.075 and 0.13 the room came out as
 * two shades of nearly-nothing and the seven silhouettes read as black
 * rectangles floating in a black frame. There is no light in this scene - every
 * surface is a MeshBasicMaterial and the tone IS the pixel - so the room has to
 * be lit by authoring rather than by a lamp.
 */
const FLOOR = 0.09;
const WALL = 0.17;
const SIDE = 0.12;

/**
 * The light coming out of the doorway, painted on the floor as two flat
 * rectangles rather than computed.
 *
 * This is the cheapest legibility in the file. Black shapes standing on a black
 * floor have nothing to stand on; the same shapes standing in a pool of light
 * cast from the thing they are opening have a place, a direction and a reason.
 */
const SPILL_NEAR = 0.30;
const SPILL_FAR = 0.15;

/** The one thing emitting: the doorway. It gets brighter as this gets worse. */
const DOOR_CALM = 0.60;
const DOOR_WORSE = 0.74;
const DOOR_OPEN = 0.86;

/** The colour that does not occur. See the note above. */
const GROWTH = 0x2fe8b4;

// ---------------------------------------------------------------------------
// authoring helpers - readability only, no behaviour
// ---------------------------------------------------------------------------

/** A person, standing. One size for everybody: nobody is characterised. */
const FIG = [0.52, 1.78, 0.34];

const stands = (x, z, ry = 0, lean = 0) => ({
  box: FIG, at: [x, 0.89, z], rot: [0, ry, lean], tone: BLACK,
});

/** A person, down. The same box, on its side, and that is the whole diff. */
const down = (x, z, ry = 0) => ({
  box: FIG, at: [x, 0.18, z], rot: [Math.PI / 2, ry, 0], tone: BLACK,
});

/** A patch of the growth, flat on the back wall. */
const bloom = (x, y, w, h) => ({
  plane: [w, h], at: [x, y, -5.94], color: GROWTH,
});

/** A patch of it on the floor, which is how far it has come by fragment 3. */
const spill = (x, z, w, d) => ({
  plane: [w, d], at: [x, 0.012, z], rot: [-Math.PI / 2, 0, 0], color: GROWTH,
});

/**
 * The room. Same room every time, because it is the same memory four times.
 *
 * Back wall at z -6, floor at y 0, two side walls that mostly only matter to
 * the two low-angle fragments. The doorway is a lit plane 3cm proud of the back
 * wall - the leak, not the door - and it is the only light in the frame,
 * because there is no light in this scene at all: everything here is
 * MeshBasicMaterial and the tone IS the pixel.
 */
const room = (door = DOOR_CALM, doorSize = [2.3, 3.6]) => ([
  { plane: [16, 9], at: [0, 4.5, -6], tone: WALL },
  { plane: [16, 16], at: [0, 0, -2], rot: [-Math.PI / 2, 0, 0], tone: FLOOR },
  { plane: [16, 9], at: [-5.6, 4.5, -2], rot: [0, Math.PI / 2, 0], tone: SIDE },
  { plane: [16, 9], at: [5.6, 4.5, -2], rot: [0, -Math.PI / 2, 0], tone: SIDE },

  // The spill, wide first and then bright, so the two overlap into a floor that
  // gets lighter towards the door. Stacked a few millimetres apart because two
  // coplanar quads is a z-fight, which on a held frame is not a shimmer, it is
  // a permanent stripe.
  { plane: [doorSize[0] * 2.9, 6.2], at: [0, 0.004, -3.4], rot: [-Math.PI / 2, 0, 0], tone: SPILL_FAR },
  { plane: [doorSize[0] * 1.55, 3.4], at: [0, 0.008, -4.5], rot: [-Math.PI / 2, 0, 0], tone: SPILL_NEAR },

  { plane: doorSize, at: [0, doorSize[1] / 2, -5.97], tone: door },
  // The core of the leak: the doorway is not a lit rectangle, it is a rectangle
  // with something behind it.
  { plane: [doorSize[0] * 0.62, doorSize[1] * 0.84], at: [0, doorSize[1] / 2, -5.95], tone: Math.min(1, door + 0.12) },
]);

/**
 * The edge of the place she hid, and it is in frame for fragments 3 and 4 only.
 *
 * A black slab a metre and a half from the eye, cutting into the LEFT of the
 * shot. It is not set dressing: it is the reason the shot is at knee height and
 * off to one side, and it is how the player is told - without a word, and
 * without ever seeing her - that this quarter of the memory was not filmed from
 * where he was standing.
 *
 * MOVED after the first measured run, where it sat 0.045m inside the sightline
 * to the doorway and blacked out the middle of both fragments. It is placed now
 * by arithmetic rather than by eye: the camera's own right vector for fragment
 * 3 is (0.830, 0, 0.559), and this point is 1.18m to the LEFT of the view axis
 * at 1.66m ahead of the eye, which puts its inner edge at 0.755 of a
 * half-frame. It occludes the outer fifth of the shot and nothing else.
 */
const HIDING_EDGE = {
  box: [0.85, 2.9, 0.85], at: [-4.80, 1.45, 0.72], tone: BLACK,
};

// ---------------------------------------------------------------------------
// 1. SEVEN SHAPES AND A DOOR
// ---------------------------------------------------------------------------
//
// The first thing that has ever happened to him. He takes a jar off a plinth in
// a side chapel in the sun and he is somewhere else, briefly, and then he is
// holding a jar in a chapel in the sun again.
//
// Nothing is wrong yet, and that is the whole job of this one. No growth, the
// doorway at its lowest, everybody at a working distance from it. Seven people
// doing their jobs. It only becomes horrible in retrospect, three jars later,
// which is the only way a first fragment can earn the fourth.

const FRAGMENT_1 = {
  id: 'w1-f1-the-door',
  camera: { at: [0, 1.62, 3.4], look: [0, 1.45, -5.6], fov: 42 },
  stills: [{
    hold: 2600,
    shapes: [
      ...room(DOOR_CALM),
      // Two at the door with their hands on it. Four watching. One turned away,
      // because seven people never all face the same thing.
      stands(-0.78, -4.85, 0.16),
      stands(0.82, -4.80, -0.21),
      stands(-1.95, -3.95, 0.34),
      stands(1.88, -3.75, -0.42),
      stands(-0.35, -3.15, 0.06),
      stands(2.55, -2.45, -0.62),
      stands(-2.60, -2.25, 2.40),
    ],
  }],
};

// ---------------------------------------------------------------------------
// 2. THE SAME, AND IT IS GROWING
// ---------------------------------------------------------------------------
//
// The second jar is at the foot of the failed ascent, under a rope that goes up
// into the dark and ends at nothing. Same seven, same room, same camera - and
// the frame is a spot-the-difference the player did not know he was playing.
//
// TWO changes and no others. The growth is on the wall around the frame, in the
// colour that does not occur. And ONE shape is standing much too close to the
// door: NARRATIVE.md's man who is about to be taken through it, five minutes
// before he walks back out and takes another man's arm off at the elbow.
//
// He is not doing anything. He is just closer than a person stands to a thing
// they are afraid of, and the player will not be able to say why the frame is
// worse than the last one.

const FRAGMENT_2 = {
  id: 'w1-f2-the-growth',
  camera: { at: [0, 1.62, 3.4], look: [0, 1.45, -5.6], fov: 42 },
  stills: [{
    hold: 2800,
    shapes: [
      ...room(DOOR_WORSE),
      bloom(-1.62, 2.30, 0.30, 2.70),
      bloom(1.60, 2.05, 0.26, 2.20),
      bloom(-0.95, 3.85, 1.40, 0.22),
      bloom(0.90, 3.72, 1.05, 0.18),
      bloom(-2.35, 1.15, 0.16, 1.30),
      bloom(2.20, 0.95, 0.14, 1.05),

      // MUCH TOO CLOSE. Thirty centimetres off the leak.
      stands(-0.30, -5.62, 0.04),

      stands(0.86, -4.72, -0.24),
      stands(-1.95, -3.95, 0.34),
      stands(1.88, -3.75, -0.42),
      stands(-0.60, -3.05, 0.10),
      stands(2.55, -2.45, -0.62),
      stands(-2.60, -2.25, 2.40),
    ],
  }],
};

// ---------------------------------------------------------------------------
// 3. THE PERSPECTIVE IS WRONG
// ---------------------------------------------------------------------------
//
// Third jar, in the Canopic Crypt, and this is the fragment that changes what
// the other three are. The door is wide, the room is being emptied, three of
// them are already on the floor - and the shot is from knee height, off to the
// side, behind the edge of something.
//
// He cannot have seen this. He is in it.
//
// The camera is where she was, and the game never says so. A player who works
// it out here gets the fourth fragment as a confirmation instead of a reveal,
// which is the correct order for the only trick this story has.

const FRAGMENT_3 = {
  id: 'w1-f3-the-wrong-eye',
  camera: { at: [-4.75, 0.95, 2.75], look: [0.20, 1.05, -4.60], fov: 58 },
  stills: [{
    hold: 3000,
    shapes: [
      ...room(DOOR_OPEN, [2.7, 3.9]),
      HIDING_EDGE,

      bloom(-1.62, 2.30, 0.42, 3.10),
      bloom(1.60, 2.05, 0.38, 2.60),
      bloom(-0.95, 3.95, 1.90, 0.30),
      bloom(0.90, 3.80, 1.45, 0.26),
      spill(-1.30, -5.20, 2.20, 1.10),
      spill(1.45, -4.90, 1.60, 0.90),

      // Three down where they were standing two fragments ago.
      down(-1.85, -4.05, 0.55),
      down(0.95, -4.60, -1.15),
      down(2.10, -3.30, 0.35),

      // Four still up, and none of them upright. A lean is the only motion a
      // held frame is allowed to imply.
      stands(-0.45, -3.40, 0.20, 0.34),
      stands(1.40, -2.60, -0.75, -0.26),
      stands(-2.35, -2.10, 1.90, 0.18),
      stands(0.35, -1.35, 2.85, -0.40),
    ],
  }],
};

// ---------------------------------------------------------------------------
// 4. HE SEES HIMSELF DIE, AND SHE WAS THERE
// ---------------------------------------------------------------------------
//
// Fourth jar, in the King's Chamber with the sarcophagus in it, and it is the
// beat the other three exist to set up. It is the only record with two stills,
// which is decision 3 in STORY-DELIVERY: a single held frame can only be the
// LAST moment of a sequence, and the last moment on its own is not a death, it
// is a body.
//
//   STILL A: one shape standing, everybody else down, the doorway wide open
//            behind him. Whatever is about to happen is not in frame and never
//            will be - "not how, just that he did."
//
//   HARD CUT, on the same camera, so the player's eye does not move. The cut is
//   the violence. There is no other violence in this file.
//
//   STILL B: a body where he was standing. And at the right edge of the shot,
//            an arm's length from the eye, a shape that was not there before -
//            because she was, the whole time, and the frame she has been
//            watching from is the frame he has been remembering in.
//
// She appears in still B ONLY. Putting her in still A would make her a
// character in the scene; putting her in the cut makes her the point of it.

const FRAGMENT_4 = {
  id: 'w1-f4-she-was-there',
  camera: { at: [-4.60, 0.92, 2.45], look: [-0.10, 1.00, -4.40], fov: 58 },
  fade: { in: 420, out: 760, back: 520 },
  stills: [
    {
      hold: 1900,
      shapes: [
        ...room(DOOR_OPEN, [3.0, 4.1]),
        HIDING_EDGE,
        bloom(-1.78, 2.40, 0.52, 3.40),
        bloom(1.75, 2.15, 0.46, 2.90),
        bloom(-0.95, 4.05, 2.30, 0.34),
        spill(-1.30, -5.20, 2.60, 1.30),
        spill(1.45, -4.80, 1.90, 1.00),

        down(-1.85, -4.05, 0.55),
        down(0.95, -4.60, -1.15),
        down(2.10, -3.30, 0.35),
        down(-2.60, -2.55, 1.35),

        // HIM. Standing, alone, facing the door he was ordered to open.
        stands(-0.20, -3.55, 0.12),
      ],
    },
    {
      hold: 2900,
      shapes: [
        ...room(DOOR_OPEN, [3.0, 4.1]),
        HIDING_EDGE,
        bloom(-1.78, 2.40, 0.52, 3.40),
        bloom(1.75, 2.15, 0.46, 2.90),
        bloom(-0.95, 4.05, 2.30, 0.34),
        spill(-1.30, -5.20, 2.60, 1.30),
        spill(1.45, -4.80, 1.90, 1.00),

        down(-1.85, -4.05, 0.55),
        down(0.95, -4.60, -1.15),
        down(2.10, -3.30, 0.35),
        down(-2.60, -2.55, 1.35),

        // HIM, where he was standing one cut ago.
        down(-0.20, -3.50, 0.24),

        // HER. To the right of the eye and lower than a person stands, because
        // she is not standing. Placed on the camera's own basis rather than by
        // eye: 2.2m along the view axis and 1.05m along its right vector
        // (0.835, 0, 0.549).
        //
        // MOVED BACK from 1.45m after looking at the frame. At an arm's length
        // she was a black band running off three edges of the shot and read as
        // a wall - and a wall is the one thing she must not read as, because
        // the entire fourth fragment is the player noticing a PERSON at the
        // edge of a memory that has no business having one. At 2.2m her head
        // clears into frame against the lit doorway and she has a silhouette.
        { box: [0.56, 1.62, 0.36], at: [-2.52, 0.81, 1.19], rot: [0, 0.42, 0], tone: BLACK },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// the world's list, and how a host walks it
// ---------------------------------------------------------------------------

/** World 1's four, in the order the map hands the jars over. */
export const WORLD_1_FRAGMENTS = [FRAGMENT_1, FRAGMENT_2, FRAGMENT_3, FRAGMENT_4];

/**
 * A cursor over a list of fragments. `next()` returns the following one, or
 * null once they are spent.
 *
 * ORDER OF TAKING, NOT ORDER OF JAR, and that is a decision rather than a
 * convenience. The jars carry a `son` index authored by the niches, which is
 * not the order the map hands them over and is not guaranteed to stay in step
 * with it - and these four fragments ESCALATE: the growth arrives in the
 * second, the killing in the third, the cut in the fourth. Keying them to a son
 * would let a map edit deliver the death before the door.
 *
 * Whereas the fiction of taking-order is exact. He gets his memory back in
 * quarters, in the sequence he happens to open his colleagues, and the sequence
 * is his because the route is his.
 *
 * A cursor rather than module state, so a harness can hold two and a second
 * world does not inherit the first world's position.
 */
export function createFragmentSequence(list = WORLD_1_FRAGMENTS) {
  let i = 0;
  return {
    next() { return i < list.length ? list[i++] : null; },
    /** Peek without consuming. For a harness, and for nothing on screen. */
    peek() { return i < list.length ? list[i] : null; },
    get index() { return i; },
    get length() { return list.length; },
    get spent() { return i >= list.length; },
    reset() { i = 0; },
  };
}
