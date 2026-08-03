/**
 * Player movement, collision, posture, and head bob.
 *
 * Collision resolves against the flat cylinder array the world hands over.
 * Push-out is iterative rather than analytic: two passes catch the common case
 * of standing in the crease between two colliders without needing a real
 * physics solver.
 *
 * Every rate here is per second and multiplied by a clamped delta, so a
 * backgrounded tab that resumes with a 4-second frame does not teleport the
 * player through a wall.
 *
 * ---------------------------------------------------------------------------
 * CROUCH AND SLIDE ARE MOVEMENT AND THEREFORE LIVE HERE
 * ---------------------------------------------------------------------------
 *
 * core/input.js reports ONE thing about either of them: the crouch posture was
 * toggled. It has no way to know whether that toggle is a crouch or the start
 * of a slide, because the difference is entirely a fact about the body - how
 * fast it is travelling, whether it is on the ground, whether it slid recently -
 * and this is the only file that holds any of those. Input reports intent; the
 * body decides what to do with it. Putting the slide decision in the input layer
 * would put a speed threshold in a file that does not know what a metre is.
 *
 * The two long notes below - on the crouch constants and on the slide - carry
 * the numbers and the reasoning. The three things worth knowing before reading
 * any of it:
 *
 *   THE BODY GETS SHORTER, not just the camera. state.eyeHeight is read by both
 *   halves of the resolver, so a crouched player passes under geometry a
 *   standing one is stopped by. A crouch that only moved the camera would look
 *   perfect and be a lie.
 *
 *   STANDING UP CAN BE REFUSED. headroomAt() is a real ceiling query assembled
 *   from the three lists the world publishes, because there was no ceiling
 *   contract to call. Its one limitation is documented at the function.
 *
 *   EVERY CLOCK RUNS ON `dt`. The pause and the death gate both work by not
 *   calling update(), so a slide caught mid-flight by either simply stops, and
 *   resumes with its full remaining distance rather than having travelled it
 *   behind a menu.
 */

import * as THREE from 'three';

const EYE_HEIGHT = 1.68;
const RADIUS = 0.42;

const WALK_SPEED = 5.4;
const SPRINT_SPEED = 8.6;
const ACCEL = 42;          // ground acceleration, units/s^2
const FRICTION = 12;
const GRAVITY = 24;
const JUMP_VELOCITY = 7.4;

/**
 * ---------------------------------------------------------------------------
 * CROUCH
 * ---------------------------------------------------------------------------
 *
 * CROUCH_EYE_HEIGHT is 0.95 against a standing 1.68, which is 57%. That is the
 * measured ratio on a real body: an adult's eye drops to a little over half its
 * standing height in a deep crouch and not to a third, which is what a number
 * picked for drama would give you and which reads as kneeling rather than as
 * crouching. It is modelling a squat with the head up, because that is the
 * posture a person moves in.
 *
 * The 0.73 m of difference is also what has to CLEAR something for the crouch
 * to be worth having. Nothing in the shipped map is that low - the lowest door
 * head is 4.2 - so today the drop buys a smaller profile and the slide rather
 * than passage. The collision body genuinely gets shorter (see resolveWalls and
 * the collider base test), so the day a 1.5 m opening is authored it will work
 * without anything here being touched. That is the whole reason the body is
 * shortened rather than only the camera.
 *
 * THE TWO TRANSITION TIMES ARE DIFFERENT AND THAT IS THE POINT. Dropping is
 * 0.16 s and rising is 0.22 s, because a body falls into a crouch with gravity
 * helping and pushes back out of one against it. A single symmetrical time is
 * the tell that a number was lerped rather than a body moved - it is the same
 * observation the death pose in player/camera.js is built on. Both are well
 * under the ~0.25 s at which a camera move starts to feel like something the
 * player is waiting for rather than something they did.
 *
 * CROUCH_SPEED at 2.6 is 48% of the walk. Slow enough that crouching is a real
 * choice and not a free stealth posture, fast enough that crossing a room in it
 * is not a punishment.
 *
 * HEAD_CLEARANCE is the gap the head must have ABOVE it before standing is
 * allowed. Without it the player stands up with their scalp exactly touching
 * stone and the very next collision frame is a coin toss.
 */
const CROUCH_EYE_HEIGHT = 0.95;
const CROUCH_DOWN_TIME = 0.16;
const CROUCH_UP_TIME = 0.22;
const CROUCH_SPEED = 2.6;
const HEAD_CLEARANCE = 0.10;

/**
 * build.js's STEP_UP, repeated rather than imported.
 *
 * world/courtyard.js already repeats this exact constant with a comment saying
 * why: the interior owns one copy and the exterior owns another, what matters is
 * that they agree, and a comment naming the other is a cheaper coupling than an
 * import that makes each module depend on another's private constants. This is
 * the third reader and it takes the same deal. It is used here to tell a floor
 * from a ceiling: a surface within a step of the feet is something you are
 * standing on, and a surface above that is something over your head.
 */
const STEP_UP = 0.65;

/**
 * HOW MANY TIMES THE CYLINDER RESOLVER MAY ITERATE.
 *
 * TWO, AND IT WAS MEASURED RATHER THAN ASSUMED. Raising it was the obvious fix
 * for the owner's report of corners you cannot walk out of, the reasoning was
 * sound - three or more overlapping cylinders cannot converge in two passes -
 * and it is WRONG. `test/stuck.mjs` swept both exterior spaces before and after:
 *
 *     2 passes                       1052 bad, 1031 stuck, 5 confirmed
 *     8 passes + contact skin        1238 bad, 1227 stuck, 8 confirmed
 *     8 passes + skin + unwedge      1235 bad, 1224 stuck, 8 confirmed
 *
 * More iterations do not free a wedged body, they eject it further, and it
 * arrives somewhere worse. The count stays at two until something measures a
 * reason to change it.
 */
const RESOLVE_PASSES = 2;

/**
 * ---------------------------------------------------------------------------
 * THE SLIDE
 * ---------------------------------------------------------------------------
 *
 * SLIDE_SPEED is 10.8, which is 1.26x the sprint. A slide that does not exceed
 * the sprint is an animation rather than a move, and there is no reason to press
 * the button. It is SET rather than added, and that is the first of the five
 * things stopping this from becoming infinite movement: chaining slides cannot
 * compound speed, because every slide starts at the same number no matter what
 * the body was doing.
 *
 * IT ENDS TWO WAYS AND BOTH ARE HERE ON PURPOSE.
 *
 *   THE SPEED FLOOR is what normally ends it. SLIDE_DECEL of 9.0 u/s^2 carries
 *   the body from 10.8 down to the 5.6 floor in 0.58 s and about 4.7 m, which is
 *   roughly two of this player's strides - long enough to read as a slide,
 *   short enough that it is a move and not a mode. Ending on the floor rather
 *   than on a clock is what makes it feel like friction instead of like a timer,
 *   and it is what makes a slide that starts into a wall end immediately: the
 *   collision resolver kills the velocity, the speed is under the floor on the
 *   next frame, and the slide is over.
 *
 *   SLIDE_MAX_TIME of 0.9 s is the GUARANTEE, not the design. On flat ground the
 *   floor always fires first. It exists so that no combination of boons,
 *   geometry or a resolver that fails to bleed speed can produce a slide that
 *   never terminates - the failure mode where a movement bug becomes a movement
 *   exploit, which is the one thing a slide must not be able to do.
 *
 * NOT CHAINABLE, and it takes five independent bars rather than one:
 *
 *   1. it starts only on the RISING EDGE of crouch, so a held button is one
 *      slide and not a stream of them
 *   2. SLIDE_COOLDOWN of 0.5 s after the last one ended
 *   3. the body must ALREADY be travelling at SLIDE_ENTRY_SPEED. Holding the
 *      sprint button is not enough; a standing start cannot buy 10.8 m/s
 *   4. it must be on the ground, both to start and to continue
 *   5. JUMP IS REFUSED for the whole of it. A slide-hop would carry 10.8 m/s
 *      into the air where there is no friction at all, and that is precisely
 *      the infinite movement the rest of this list is guarding
 *
 * SLIDE_ENTER_TIME is faster than an ordinary crouch because a body thrown into
 * a slide is not lowering itself, it is dropping.
 */
const SLIDE_SPEED = 10.8;
const SLIDE_DECEL = 9.0;
const SLIDE_FLOOR = 5.6;
const SLIDE_MAX_TIME = 0.9;
const SLIDE_COOLDOWN = 0.5;
const SLIDE_ENTRY_SPEED = 7.4;
const SLIDE_ENTER_TIME = 0.09;

export function createPlayer(world) {
  const position = world.spawn.clone();
  position.y = EYE_HEIGHT;

  const velocity = new THREE.Vector3();

  const state = {
    position,
    velocity,
    grounded: true,
    sprinting: false,
    speed: 0,          // horizontal speed, read by the camera for bob and FOV
    bobPhase: 0,
    bobOffset: new THREE.Vector3(),
    health: 100,
    maxHealth: 100,

    /**
     * ------------------------------------------------------------------------
     * THE POSTURE, AND WHY `position.y` IS NOT THE ONE THAT MOVES
     * ------------------------------------------------------------------------
     *
     * `position.y` stays at floor + EYE_HEIGHT in every posture. It is the
     * STANDING-METRIC eye, and it is not a convenience: enemies/director.js
     * derives the player's FEET from it twice, as `position.y -
     * PLAYER_CONSTANTS.EYE_HEIGHT`, and that number chooses which storey of the
     * gallery the whole flow field describes. Lowering position.y on a crouch
     * would put the seed 0.73 m below the floor and hand the horde a pathing
     * fault that appears and disappears with a button press - the worst kind,
     * because it is unattributable from inside the game.
     *
     * So the posture is published as three derived numbers instead, and every
     * one of them is measured from the FEET:
     *
     *   crouch      0 standing, 1 fully crouched, and everything between. This
     *               is the animation parameter and it is what the body height
     *               and the view drop are both derived from, so they cannot
     *               disagree with each other or arrive a frame apart.
     *   eyeHeight   the REAL height of the head above the feet, in metres. This
     *               is the collision body's height - resolveWalls and the
     *               collider base test both read it - so a crouch that lowers
     *               the camera and not this one would be a camera trick, and a
     *               player would find themselves stopped by a lintel they could
     *               see clean daylight under.
     *   viewDrop    EYE_HEIGHT - eyeHeight, which is what player/camera.js
     *               subtracts to put the camera where the head is. Published as
     *               its own number rather than folded into bobOffset, because
     *               bobOffset is faded out across the death pose and a crouch
     *               that stands itself back up while the body falls is exactly
     *               the sort of detail that undoes a whole animation.
     */
    crouch: 0,
    eyeHeight: EYE_HEIGHT,
    viewDrop: 0,

    /** True while the body is standing up is REFUSED by something overhead. */
    ceilinged: false,

    /** True for the length of a slide. Read by the harness and by the HUD. */
    sliding: false,

    /** Seconds the current slide has run, on the SIMULATION clock. */
    slideT: 0,
  };

  // Scratch vectors, allocated once. Allocating inside the frame loop is how
  // a smooth game becomes a stuttering one.
  const wish = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  /**
   * Last frame's crouch INTENT, for the rising edge.
   *
   * The edge is what separates a crouch from a slide, so it has to be taken
   * from the intent rather than from the posture: by the time the body is
   * moving, the moment that decided which of the two this was has gone.
   */
  let crouchWasOn = false;

  /** Seconds before another slide may start. Runs on the simulation clock. */
  let slideCooldown = 0;

  /**
   * A teleport happened and the posture INTENT has not been cleared yet.
   *
   * teleport() itself can only reset the body, because the intent belongs to
   * the input layer and this file has no reference to it outside of update().
   * Without this flag a player who dies crouched respawns at wave one, at full
   * health, at the spawn point - and immediately sinks back into a crouch,
   * because everything about the run was reset except the button they were
   * holding a posture with. The same applies walking through the pyramid door.
   *
   * A teleport is "you are somewhere new"; somewhere new is entered standing.
   */
  let clearCrouchOnResume = false;

  function update(dt, input, yaw) {
    // --- desired direction, in world space -------------------------------
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    wish.set(0, 0, 0)
      .addScaledVector(forward, input.forward)
      .addScaledVector(right, input.strafe);

    const moving = wish.lengthSq() > 0.0001;
    if (moving) wish.normalize();

    /**
     * ----------------------------------------------------------------------
     * POSTURE, RESOLVED BEFORE ANYTHING MOVES
     * ----------------------------------------------------------------------
     *
     * Every clock in this block advances on `dt`, the delta this function is
     * handed, and that is the whole of the answer to the pause and the death
     * gate. main.js calls update() only inside `started && !halted`; a paused
     * game does not call it at all and a dead player does not either. So a
     * slide that is in flight when Options is pressed does not tick, does not
     * decelerate, and does not travel - it resumes exactly where it stopped,
     * with the same time remaining, for free and without this file knowing that
     * a pause menu exists. A slide timed off performance.now() would have
     * finished behind the menu and delivered the player somewhere else.
     */
    // The posture intent a teleport left behind, cleared on the first frame
    // that has an input record to clear it on. See clearCrouchOnResume.
    if (clearCrouchOnResume) {
      clearCrouchOnResume = false;
      if (input && 'crouch' in input) input.crouch = false;
    }

    const wantCrouch = !!input.crouch;
    const crouchEdge = wantCrouch && !crouchWasOn;
    crouchWasOn = wantCrouch;

    if (slideCooldown > 0) slideCooldown = Math.max(0, slideCooldown - dt);

    const hNow = Math.hypot(velocity.x, velocity.z);

    /**
     * SPRINT IS REFUSED WHILE THE BODY IS DOWN, rather than standing it up.
     *
     * The alternative - sprint silently overriding the crouch toggle - reads
     * better in the two seconds after a slide and worse everywhere else: a
     * player with the sprint latch still on who taps crouch would see nothing
     * happen at all, because the override would cancel the posture on the same
     * frame the button set it. A button that does nothing is the worst outcome
     * available here. This way the rule is one sentence - you cannot sprint
     * crouched - the button always visibly does something, and getting back to
     * a sprint is the same tap that got you down.
     *
     * The 0.35 threshold rather than zero so that the moment the player taps to
     * stand, the sprint they were already asking for engages while the body is
     * still rising, instead of waiting out the full 0.22 s and reading as lag.
     */
    const sprintWanted = input.sprint && input.forward > 0 && moving;

    // --- the slide ---------------------------------------------------------
    if (state.sliding) {
      state.slideT += dt;

      // Ended, by any of the five bars in the note on SLIDE_SPEED. `!wantCrouch`
      // is the player cancelling with a second tap, which is allowed and is why
      // the button is never a commitment.
      if (state.slideT >= SLIDE_MAX_TIME
        || hNow <= SLIDE_FLOOR
        || !state.grounded
        || !wantCrouch) {
        endSlide(input);
      }
    } else if (crouchEdge
      && slideCooldown <= 0
      && state.grounded
      && sprintWanted
      && hNow >= SLIDE_ENTRY_SPEED) {
      startSlide(hNow);
    }

    // Sprinting is a claim about the BODY and the slide is not a sprint, which
    // matters beyond vocabulary: main.js runs a second player.update() at a
    // fraction of the delta while `sprinting` is true and the Shrine of Shu is
    // held, and a slide integrated twice would travel 25% further than its own
    // deceleration curve says it does - and its clock would run 25% fast.
    state.sprinting = sprintWanted && !state.sliding && state.crouch < 0.35;

    // --- horizontal acceleration and friction -----------------------------
    if (state.sliding) {
      /**
       * A SLIDE IS NOT STEERED AND IS NOT ACCELERATED. The only force on it is
       * the deceleration, applied along the velocity rather than per axis so a
       * diagonal slide bleeds at the same rate as a straight one - which a
       * per-axis drop would not do, and the difference would show up as the
       * diagonal being the fast one.
       *
       * Nothing here writes a direction, so the resolver downstream is free to
       * turn the slide along a wall exactly as it turns a run along one.
       */
      if (hNow > 1e-4) {
        const s = Math.max(0, hNow - SLIDE_DECEL * dt) / hNow;
        velocity.x *= s;
        velocity.z *= s;
      }
    } else {
      /**
       * The speed cap is INTERPOLATED across the crouch rather than switched at
       * a threshold, so the body slows down over the same 0.16 s it takes to go
       * down. A step change would arrive before the camera did and read as the
       * game catching on something.
       *
       * ON THE WAY UP THE PENALTY IS GONE IMMEDIATELY, and that asymmetry is the
       * whole reason this reads off the INTENT and not off the blend. You pay
       * the crouch speed while you are choosing to be crouched, not while you
       * are getting up out of one - and the case that makes it matter is the
       * end of a slide. A slide finishes at the 5.6 floor with the body still
       * fully down, so a cap read off the blend would clamp 5.6 to 2.6 on that
       * single frame and hand the player a lurch on the exit of the move that
       * exists to feel fast. `ceilinged` is in the test because a body pinned
       * under stone did not choose to stand and should not be rewarded with the
       * standing pace for asking.
       */
      const stand = state.sprinting ? SPRINT_SPEED : WALK_SPEED;
      // The LIVE intent, not the copy taken at the top of the frame: a slide
      // that ended a few lines ago has already handed the crouch back, and this
      // is the frame on which that has to be worth something.
      const held = !!input.crouch || state.ceilinged;
      const target = stand + (CROUCH_SPEED - stand) * (held ? state.crouch : 0);

      if (moving) {
        velocity.x += wish.x * ACCEL * dt;
        velocity.z += wish.z * ACCEL * dt;

        const h = Math.hypot(velocity.x, velocity.z);
        if (h > target) {
          const s = target / h;
          velocity.x *= s;
          velocity.z *= s;
        }
      } else {
        const drop = FRICTION * dt;
        const h = Math.hypot(velocity.x, velocity.z);
        if (h > 0.0001) {
          const s = Math.max(0, h - drop * h) / h;
          velocity.x *= s;
          velocity.z *= s;
        } else {
          velocity.x = velocity.z = 0;
        }
      }
    }

    // --- vertical ----------------------------------------------------------
    //
    // JUMP IS REFUSED UNLESS THE BODY IS ESSENTIALLY STANDING, and that one
    // condition covers three separate cases with one line. It stops the
    // slide-hop that would carry 10.8 m/s into a frictionless arc; it stops a
    // crouched player launching their head into the ceiling they are crouched
    // under, because a body pinned down by geometry has crouch pinned at 1; and
    // it makes the rule legible - you stand up, then you jump, which is what a
    // body does.
    if (input.jump && state.grounded && !state.sliding && state.crouch < 0.25) {
      velocity.y = JUMP_VELOCITY;
      state.grounded = false;
    }

    if (!state.grounded) {
      velocity.y -= GRAVITY * dt;
    }

    // --- integrate ---------------------------------------------------------
    position.x += velocity.x * dt;
    position.y += velocity.y * dt;
    position.z += velocity.z * dt;

    // The floor is a dune field outside and a set of ramps and ledges inside,
    // and both answer the same question: how high is the ground here. The third
    // argument is where the feet currently are, which is what lets the interior
    // sampler refuse to snap the player up onto a ledge they are walking
    // underneath. The dune sampler ignores it.
    const floor = (world.heightAt
      ? world.heightAt(position.x, position.z, position.y - EYE_HEIGHT)
      : 0) + EYE_HEIGHT;

    if (position.y <= floor) {
      position.y = floor;
      velocity.y = 0;
      state.grounded = true;
    } else if (position.y > floor + 0.02) {
      // Walking off the edge of the gallery's upper level is a fall. Without
      // this the player keeps whatever grounded state they had and strolls out
      // over the drop, because gravity only runs while airborne.
      state.grounded = false;
    }

    /**
     * THE POSTURE IS BLENDED HERE, AFTER THE FLOOR AND BEFORE THE RESOLVER.
     *
     * After the floor, because the headroom test has to be measured from the
     * feet the player is actually standing on THIS frame and not last frame's -
     * a player who just walked off a ledge and is falling past a slab would
     * otherwise be asked about the wrong storey.
     *
     * Before the resolver, because the resolver reads state.eyeHeight to decide
     * what blocks. A posture applied afterwards would be a frame late, and one
     * frame late on a crouch is the player getting stopped by the lintel they
     * had already ducked under.
     */
    // Re-read rather than reusing the value taken at the top of the frame: a
    // slide that ended a few lines ago has just handed the crouch back (see
    // endSlide), and the body should start standing on THIS frame rather than
    // spend one more of them down for no reason the player can see.
    updatePosture(dt, !!input.crouch);

    resolveCollisions();

    state.speed = Math.hypot(velocity.x, velocity.z);
    updateBob(dt);
  }

  /**
   * Start a slide along the direction the body is already travelling.
   *
   * The direction is taken from the VELOCITY and not from the wish vector,
   * because a slide is momentum: it goes where you were going, and a player who
   * flicks the stick sideways on the frame they press it should not be able to
   * launch 10.8 m/s at ninety degrees to their run. `wish` is the fallback for
   * the degenerate case only, and SLIDE_ENTRY_SPEED means that case cannot
   * actually be reached from the caller above.
   */
  function startSlide(h) {
    let dx, dz;
    if (h > 1e-4) {
      dx = velocity.x / h;
      dz = velocity.z / h;
    } else {
      dx = wish.x;
      dz = wish.z;
    }

    velocity.x = dx * SLIDE_SPEED;
    velocity.z = dz * SLIDE_SPEED;

    state.sliding = true;
    state.slideT = 0;
  }

  /**
   * End a slide, and STAND THE PLAYER BACK UP by clearing the crouch intent.
   *
   * This is the one place this file writes to the input layer, and it is worth
   * the exception. Crouch is a toggle, and the tap that started the slide is the
   * same tap that set it - so leaving it set would deliver the player out of
   * every slide crawling at 2.6 m/s and needing a second press to get moving
   * again, in the middle of whatever they slid away from. The slide CONSUMED
   * that tap; giving it back is what makes "slide and come up running" one
   * button instead of two.
   *
   * A deliberate crouch is untouched by this, because a deliberate crouch never
   * gets here: a tap taken while walking does not start a slide at all.
   *
   * Guarded, so that a caller handing over a bare object - which four test
   * suites do - cannot be broken by a field they never declared.
   */
  function endSlide(input) {
    state.sliding = false;
    state.slideT = 0;
    slideCooldown = SLIDE_COOLDOWN;

    if (input && 'crouch' in input) {
      input.crouch = false;
      crouchWasOn = false;
    }
  }

  /**
   * Move the body between standing and crouched, and refuse to stand under
   * stone.
   */
  function updatePosture(dt, wantCrouch) {
    const feetY = position.y - EYE_HEIGHT;

    // The refusal is only ever asked about on the way UP. Going down is always
    // allowed - there is nothing below a crouch to be blocked by - and asking
    // anyway would walk the collider list on every frame of a crouch-walk to
    // answer a question with a known answer.
    let blocked = false;
    if (!wantCrouch && !state.sliding && state.crouch > 0) {
      blocked = headroomAt(position.x, position.z, feetY)
        < EYE_HEIGHT + HEAD_CLEARANCE;
    }
    state.ceilinged = blocked;

    const target = (wantCrouch || state.sliding || blocked) ? 1 : 0;

    // Down is faster than up, and a slide is faster than either. See the note
    // on the constants.
    const time = target > state.crouch
      ? (state.sliding ? SLIDE_ENTER_TIME : CROUCH_DOWN_TIME)
      : CROUCH_UP_TIME;

    const step = dt / time;
    if (target > state.crouch) state.crouch = Math.min(target, state.crouch + step);
    else state.crouch = Math.max(target, state.crouch - step);

    state.eyeHeight = EYE_HEIGHT + (CROUCH_EYE_HEIGHT - EYE_HEIGHT) * state.crouch;
    state.viewDrop = EYE_HEIGHT - state.eyeHeight;
  }

  /**
   * ---------------------------------------------------------------------------
   * HOW MUCH CLEAR SPACE IS THERE ABOVE THESE FEET
   * ---------------------------------------------------------------------------
   *
   * There is no ceiling query in this project and there was no contract for one,
   * so this is built out of the three things the world does publish. It is a
   * real query against real geometry and not a stub - every branch below reads
   * a list the resolver in this same file already reads to decide what blocks.
   *
   *   WALL BOXES. world.walls carries axis-aligned boxes with a y0 and a y1, and
   *   the stone above a doorway is one of them - that is exactly how a doorway
   *   is built here. A box whose footprint contains the player and whose BASE is
   *   above their feet is a ceiling, and its base is the height of it.
   *
   *   ELEVATED COLLIDERS. A cylinder that declares a `y0` above the feet is a
   *   thing standing over the player's head - the Altar of Ptah on the gallery
   *   bridge is the live example. Colliders with no declared base sit ON the
   *   local floor and are never a ceiling; they are an obstacle, and crouching
   *   does not get you under an obstacle that starts at your ankles.
   *
   *   THE SLAB OVERHEAD, and this one is derived rather than looked up, because
   *   the walkable surfaces of the upper storey are not in either list. They are
   *   in world.heightAt, whose contract has exactly the two readings needed:
   *   called WITH the feet it answers "what am I standing on", and called
   *   WITHOUT them it answers "what is the highest surface here". When the
   *   second is more than a step above the first, the difference is a floor
   *   belonging to a storey above this one, and its underside is a ceiling. The
   *   gallery's ledges at y 6 are found this way and by no other means.
   *
   * THE ONE HONEST LIMITATION. That last branch finds the HIGHEST surface, not
   * the LOWEST one overhead. In a building with three storeys, a player under
   * the middle floor would be told about the top one and would be allowed to
   * stand into the middle. This map has two, so it is exact here; a third would
   * need heightAt to grow a "lowest surface above y" reading, and this comment
   * is the note for whoever authors it.
   *
   * Returns Infinity when nothing is overhead, which is the common case and the
   * correct answer.
   */
  function headroomAt(x, z, feetY) {
    let ceiling = Infinity;

    if (world.walls) {
      for (const w of world.walls) {
        if (w.y0 <= feetY || w.y0 >= ceiling) continue;
        if (Math.abs(x - w.x) >= w.w / 2 + RADIUS) continue;
        if (Math.abs(z - w.z) >= w.d / 2 + RADIUS) continue;
        ceiling = w.y0;
      }
    }

    for (const c of world.colliders) {
      if (c.y0 === undefined || c.y0 <= feetY || c.y0 >= ceiling) continue;
      const dx = x - c.x;
      const dz = z - c.z;
      const minDist = c.r + RADIUS;
      if (dx * dx + dz * dz >= minDist * minDist) continue;
      ceiling = c.y0;
    }

    if (world.heightAt) {
      const top = world.heightAt(x, z);
      if (top > feetY + STEP_UP && top < ceiling) ceiling = top;
    }

    return ceiling - feetY;
  }

  /**
   * Push the player out of any cylinder they have entered.
   *
   * Iterates up to RESOLVE_PASSES times and breaks the instant a pass finds
   * nothing. See that constant: raising the count was tried against a measured
   * baseline and made the game measurably worse.
   */
  function resolveCollisions() {
    for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
      let hit = false;

      // Rooms first. A cylinder cannot approximate a wall without either
      // leaking at the corners or eating the doorway, so the interior hands
      // over axis-aligned boxes instead and they resolve in the same passes.
      if (world.walls) resolveWalls();

      const floorY = world.heightAt
        ? world.heightAt(position.x, position.z, position.y - EYE_HEIGHT)
        : 0;

      for (const c of world.colliders) {
        // A collider only blocks if the player's eye is below its top. Short
        // rubble can be stood beside but tall pillars cannot be walked through.
        //
        // Measured from the collider's own base where it declares one, and from
        // the local floor where it does not. Outside, props stand on dunes and
        // their base IS the local floor. Inside, the floor is flat but the room
        // is not: a column standing on the ground and carrying a ledge six units
        // up must stop blocking once the player is on top of that ledge.
        const base = c.y0 === undefined ? floorY : c.y0;
        const feetY = position.y - EYE_HEIGHT;

        // Above its top: the ledge case described above.
        if (feetY - base > c.h) continue;

        /**
         * AND BELOW ITS BASE, WHICH THIS TEST DID NOT HAVE.
         *
         * The rule was one-sided. It skipped a collider the actor had climbed ON
         * TOP OF and never one the actor was standing UNDERNEATH, so a cylinder
         * with no floor turned out to have no ceiling either: anything declaring
         * a raised base blocked the room beneath it all the way to the ground.
         *
         * The Altar of Ptah is what exposed it. It moved onto the gallery bridge
         * at y 6 and kept its 2.1-radius collider with y0 6, so it stood as an
         * invisible pillar in the middle of the largest room in the map - six
         * metres below itself, for the player as much as for the horde. Two of
         * the navigation lane's stuck actors died on it. From the floor it reads
         * as the game refusing to let you walk through a particular patch of
         * nothing, which is unattributable and therefore never gets reported.
         *
         * build.js already worked around this for elevated PROPS by throwing
         * their colliders away, with a comment saying it is waiting for exactly
         * this fix: "until the collider record grows a base height, elevated
         * props are decoration only". Interacts could not take that workaround,
         * because an interact is a solid object the player walks up to and buys
         * from and has to keep its collider. So the test grows its missing half
         * instead, and that prop workaround can now go whenever someone wants
         * decoration on an upper level to be solid.
         *
         * EYE_HEIGHT rather than a new head constant: the camera sits at the top
         * of the body in this controller, so a base higher than the eye is above
         * the whole of the player.
         *
         * IT IS THE CURRENT EYE HEIGHT AND NOT THE STANDING ONE, which is half
         * of what makes the crouch real rather than a camera trick. A cylinder
         * based 1.2 m above the feet is in the player's chest when they are
         * standing and clean over their head when they are down, and it must
         * block in the first case and not in the second. Reading the constant
         * here would give a crouch that lowers the view and changes nothing the
         * body can do - which looks entirely correct until someone ducks under
         * something and is stopped by geometry they can see daylight beneath.
         */
        if (base - feetY > state.eyeHeight) continue;

        const dx = position.x - c.x;
        const dz = position.z - c.z;
        const distSq = dx * dx + dz * dz;
        const minDist = c.r + RADIUS;

        if (distSq >= minDist * minDist) continue;

        /*
         * DEAD CENTRE USED TO MEAN NO PUSH AT ALL.
         *
         * The condition here was `distSq < minDist^2 && distSq > 1e-8`, so a
         * body whose centre landed on a cylinder's axis failed the second half
         * and was skipped - no push, no velocity kill, nothing. A player who
         * arrived exactly there was inside that cylinder permanently, and the
         * resolver's own answer was that there was nothing to resolve.
         *
         * It is rare and it is not unreachable: `teleport` puts the body at an
         * authored coordinate, and authored coordinates are round numbers sitting
         * on props placed at round numbers. A degenerate direction is a reason to
         * CHOOSE one, not a reason to decline to push.
         *
         * The choice is deterministic - straight out along +x - because a random
         * or time-derived direction would make the one bug in this file that is
         * hardest to reproduce also impossible to reproduce twice.
         */
        let nx, nz, pen;
        if (distSq > 1e-8) {
          const dist = Math.sqrt(distSq);
          nx = dx / dist; nz = dz / dist;
          pen = minDist - dist;
        } else {
          nx = 1; nz = 0;
          pen = minDist;
        }

        position.x += nx * pen;
        position.z += nz * pen;

        // Kill the velocity component heading into the surface, so the
        // player slides along it instead of sticking.
        const into = velocity.x * nx + velocity.z * nz;
        if (into < 0) {
          velocity.x -= nx * into;
          velocity.z -= nz * into;
        }

        hit = true;
      }

      if (!hit) break;
    }


    // Perimeter. The courtyard is a square and states one min and one max; the
    // interior is a long rectangle and states four sides. Reading both shapes
    // here is cheaper than making the square lie about being a rectangle.
    const b = world.bounds;
    const minX = b.minX ?? b.min, maxX = b.maxX ?? b.max;
    const minZ = b.minZ ?? b.min, maxZ = b.maxZ ?? b.max;

    if (position.x < minX) { position.x = minX; velocity.x = Math.max(0, velocity.x); }
    if (position.x > maxX) { position.x = maxX; velocity.x = Math.min(0, velocity.x); }
    if (position.z < minZ) { position.z = minZ; velocity.z = Math.max(0, velocity.z); }
    if (position.z > maxZ) { position.z = maxZ; velocity.z = Math.min(0, velocity.z); }
  }

  /**
   * Push the player out of any wall box they have entered.
   *
   * Resolution is along the axis of LEAST penetration, which is what makes a
   * player who clips a wall while running along it slide rather than get
   * launched sideways through the room.
   *
   * The vertical test is what lets a doorway work. The stone above an opening
   * is a wall record too, standing from the door head to the ceiling, and a
   * player whose whole body is below it must pass under it untouched.
   */
  function resolveWalls() {
    const feet = position.y - EYE_HEIGHT;

    // The head is the CURRENT top of the body, not the standing one. This is
    // the other half of the crouch being real: the stone above a doorway is a
    // wall record standing from the door head to the ceiling, and a crouched
    // player whose whole body is below it passes under it untouched. Same test
    // as before, asked about a shorter body.
    const head = feet + state.eyeHeight + 0.12;

    for (const w of world.walls) {
      if (head <= w.y0 || feet >= w.y1) continue;

      const hx = w.w / 2 + RADIUS;
      const hz = w.d / 2 + RADIUS;

      const dx = position.x - w.x;
      const dz = position.z - w.z;

      const px = hx - Math.abs(dx);
      const pz = hz - Math.abs(dz);
      if (px <= 0 || pz <= 0) continue;

      if (px < pz) {
        const s = dx < 0 ? -1 : 1;
        position.x += px * s;
        if (velocity.x * s < 0) velocity.x = 0;
      } else {
        const s = dz < 0 ? -1 : 1;
        position.z += pz * s;
        if (velocity.z * s < 0) velocity.z = 0;
      }
    }
  }

  /**
   * Head bob driven by real velocity, not a free-running timer. Standing still
   * stops the bob dead, which is what sells it as footsteps rather than a
   * wobble effect bolted on top.
   */
  function updateBob(dt) {
    const speed = state.speed;

    // A SLIDING BODY HAS NO FOOTSTEPS. The slide is the fastest the player ever
    // travels, so the amplitude below would put the heaviest walk cycle in the
    // game on the one move where the feet are not touching anything. Easing to
    // neutral rather than zeroing, so entering a slide mid-stride does not snap
    // the camera on the frame it starts.
    if (state.sliding) {
      state.bobOffset.multiplyScalar(Math.max(0, 1 - dt * 10));
      return;
    }

    if (speed > 0.4) {
      state.bobPhase += dt * (speed * 1.55);
      // Damped by the crouch: a crouched walk is a shorter stride carrying a
      // steadier head, and the full standing amplitude on it reads as a waddle.
      const amp = Math.min(speed / SPRINT_SPEED, 1) * 0.055 * (1 - 0.45 * state.crouch);

      // Vertical bobs at twice the horizontal rate: one dip per footfall,
      // one sway per stride.
      state.bobOffset.set(
        Math.cos(state.bobPhase) * amp * 0.6,
        Math.abs(Math.sin(state.bobPhase)) * -amp,
        0
      );
    } else {
      // Ease back to neutral rather than snapping.
      state.bobOffset.multiplyScalar(Math.max(0, 1 - dt * 8));
    }
  }

  return {
    state,
    position,
    velocity,
    update,

    damage(n) {
      state.health = Math.max(0, state.health - n);
      return state.health;
    },

    heal(n) {
      state.health = Math.min(state.maxHealth, state.health + n);
    },

    /**
     * Put the player somewhere. `v.y` is the FLOOR they arrive standing on, not
     * the eye - the eye is added here, because a caller that had to know
     * EYE_HEIGHT would be a second copy of it.
     *
     * It used to force y to the eye height unconditionally, which meant the one
     * thing teleport could not do was reach an upper level. That was invisible
     * while the gallery's ledges were two dead-end shelves nothing needed to be
     * placed on; with the bridge joined and the Altar of Ptah standing on it,
     * "ground floor only" is a hole. Every existing caller passes y: 0 and is
     * therefore unchanged to the millimetre.
     */
    teleport(v) {
      position.copy(v);
      position.y = (v.y || 0) + EYE_HEIGHT;
      velocity.set(0, 0, 0);

      // A body put somewhere else arrives standing, and it arrives NOT sliding.
      // Both matter for the same reason the velocity is cleared: a teleport is
      // the door transition and the death respawn, and carrying half a slide
      // through either would deliver the player into the new room already
      // travelling. The INTENT that produced the posture is cleared too, one
      // frame later, because it lives in the input layer - see the note on
      // clearCrouchOnResume. Resetting the body without it would stand the
      // player up for a frame and then sink them straight back down.
      clearCrouchOnResume = true;
      crouchWasOn = false;
      state.sliding = false;
      state.slideT = 0;
      slideCooldown = 0;
      state.crouch = 0;
      state.eyeHeight = EYE_HEIGHT;
      state.viewDrop = 0;
      state.ceilinged = false;
    },
  };
}

export const PLAYER_CONSTANTS = {
  EYE_HEIGHT, RADIUS, WALK_SPEED, SPRINT_SPEED,
  CROUCH_EYE_HEIGHT, CROUCH_SPEED,
  SLIDE_SPEED, SLIDE_FLOOR, SLIDE_MAX_TIME, SLIDE_COOLDOWN, SLIDE_ENTRY_SPEED,
};
