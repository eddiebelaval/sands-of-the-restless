/**
 * THE ALTAR OF PTAH: the top of the economy, and the only sink that never fills.
 *
 * Everything else in the map is a fixed shopping list. There are nine doors,
 * four wall buys and six shrines, and once a player has bought all of them gold
 * has nowhere to go and the back half of a long run stops meaning anything. The
 * Altar is what keeps a wave-thirty purse worth having: 5000 for the first
 * weapon put through it, 2000 for every one after, and there are seven weapons.
 *
 * The FIRST price is the wall and the REST are the choice. 5000 is deliberately
 * more than any other single thing in the map costs, because upgrading the gun
 * in your hands should be a decision the player saves for and not something they
 * wander into; 2000 afterwards is cheap enough that bringing a second weapon
 * back is worth the walk, which is what stops the Altar being a one-time event
 * in a room the player never returns to.
 *
 * WHAT AN UPGRADE IS lives in player/weapons.js, in the UPGRADE record: 2.5x
 * damage, doubled magazine and reserve, spread multiplied by 0.7. This file
 * decides what it COSTS and whether it may be bought, and calls weapons.upgrade()
 * to make it so. Same split as doors and prices everywhere else in this game.
 *
 * WHAT AN UPGRADE LOOKS LIKE is two things, and both are additive by
 * construction because the weapon viewmodels are the one part of this project
 * that is already right and an upgrade is not licence to redraw them:
 *
 *   - the finish. player/viewmodel.js gains ONE new function, upgradeFinish(),
 *     which repoints the weapon-body meshes at gold-and-lapis clones of the same
 *     materials. No geometry, no pose, no keyframe, no base material changes.
 *
 *   - the tracers, which are owned HERE. An upgraded round leaves a streak, and
 *     the streak is drawn from a pool this file allocates into the world scene
 *     and hands weapons.js a callback into. It is the only part of an upgrade
 *     that exists outside the weapon, so it is the only part that needed
 *     somewhere new to live.
 *
 * ---------------------------------------------------------------------------
 * THE RITUAL, and it is the feature rather than the dressing on it
 * ---------------------------------------------------------------------------
 *
 * This machine used to hand back a fully upgraded weapon on the frame the gold
 * left the purse, which made the most expensive thing in the map a vending
 * purchase. It is now four beats, the way Black Ops 2 plays it:
 *
 *   1. the gold goes, and THE WEAPON LEAVES THE PLAYER'S HANDS - into the
 *      machine, so they are holding their other gun or nothing at all
 *   2. the machine works for five seconds, with light and with sound
 *   3. the upgraded weapon rises out of it and sits there, visible, gilded
 *   4. the player presses F again to take it back, whenever they like
 *
 * THE WAIT IS THE PRODUCT. Five seconds rooted in one room, down a weapon,
 * during a horde, is a risk - and the risk is the entire difference between a
 * decision and a shopping list. Which is also why nothing here is on a
 * wall-clock timer: the window is measured in the same clamped delta the player
 * and the horde move on, so it is five seconds of GAME and it is the same five
 * seconds under the software renderer the harness uses.
 *
 * WHAT HAPPENS IF THE RUN GOES WRONG MID-CYCLE, stated once, here, because this
 * is where the bugs in a feature like this live:
 *
 *   - THE PLAYER GOES DOWN. The machine keeps its promise. The clock runs, the
 *     upgrade completes, and the weapon waits on the plate to be collected. The
 *     gold has already bought an upgrade, so the upgrade is delivered; the
 *     weapon is not destroyed, because a weapon destroyed by a death that also
 *     ate 5000 gold is the worst bug this file could have. Note what is NOT
 *     here: any wiring to combat, to the wave counter, or to the room the player
 *     is standing in. There is nothing to go wrong because there is nothing
 *     there. Death, the round ending, walking out of the King's Chamber and
 *     leaving the pyramid altogether are all THE SAME EVENT to this file, which
 *     is no event at all.
 *   - THE PLAYER WALKS AWAY AND NEVER COMES BACK. The weapon stays on the plate
 *     for the rest of the run. It is not rotated, randomised, or reclaimed. Some
 *     Black Ops 2 maps do take it away; this one does not, because the only way
 *     to lose a weapon here is to collect it, and that sentence is worth more
 *     than the feature the alternative would add.
 *   - THE UPGRADE ITSELF REFUSES. The one genuinely new failure mode. Both
 *     halves come back in one place: the exact cost is granted and the weapon is
 *     handed straight back, un-upgraded. See finish().
 *
 * The machine holds ONE weapon. A second cannot be inserted until the first is
 * collected, which is what keeps this a three-state machine rather than a queue.
 */

import * as THREE from 'three';

/** How many tracers may be in flight. An LMG at 620 rpm will not exceed this. */
const TRACER_POOL = 28;

/** Seconds a streak is visible. Short: this is a bullet, not a laser. */
const TRACER_LIFE = 0.075;

/**
 * How far in FRONT OF THE EYE the streak starts, in metres.
 *
 * Any positive number puts the start on the correct pixel - see fire() - so
 * this is not choosing where the tracer appears to come from. What it chooses
 * is how much of the world is allowed to occlude the first few centimetres of
 * it: the streak is depth-tested, so a start point half a metre out is behind
 * the wall a player is standing against and the near end of the streak
 * disappears into it, which is correct and is what a muzzle inside a doorway
 * looks like. 0.6 is roughly where the barrel is anyway.
 */
const TRACER_START = 0.6;

/**
 * Where the muzzle is when the viewmodel cannot say: slightly right of centre
 * and a little over half way down, which is where a hip-held weapon's crown
 * sits. Only reachable if a round is fired with no weapon built, which the
 * weapon code does not allow; it exists so this function cannot produce the
 * degenerate origin it was written to replace.
 */
const FALLBACK_NDC = { x: 0.09, y: -0.52 };

/**
 * How long the machine works, in seconds of SIMULATED time.
 *
 * Black Ops 2's Pack-a-Punch cycle is a shade over five seconds and the number
 * is not arbitrary in either game: it is long enough that a horde closing on the
 * room becomes the player's problem, and short enough that the player is not
 * standing still resenting it. Both halves of that matter, and it is the one
 * constant in this file that should be tuned by playing rather than by reading.
 */
const WORK_TIME = 5.0;

/** Seconds the finished weapon takes to rise out of the plate. */
const RISE_TIME = 0.9;

/**
 * HOW BIG THE PRESENTED WEAPON IS, in metres along its longest axis.
 *
 * A LENGTH and not a scale factor, and the difference matters. The models are
 * authored life-size - the MK9 is 200mm of slide, the Sekhmet Bolt is over a
 * metre - so one shared multiplier presents seven weapons at seven sizes, and
 * the two that most need to be legible are the two smallest. Normalising to a
 * length instead means every weapon stands on the plate at the size a display
 * case would give it, which is the same reason the mystery box draws all seven
 * of its chalk marks in one frame.
 *
 * 0.80 was set by looking at the rendered frame from where the player actually
 * stands, twice: at the 2.1 metre collider and at the 5.5 metre reach limit.
 */
const DISPLAY_LENGTH = 0.80;

/**
 * How far it rises, measured from the mount.
 *
 * The mount is over the FRONT of the gold plate rather than its centre, and that
 * is not taste either. From a 1.68 metre eye the plate's own front edge is above
 * the player's sightline, so it occludes anything standing behind it: measured,
 * a weapon on the plate's centre line had its bottom 240mm cut off by the plate
 * at conversational distance, which is why the first rendered pass of this looked
 * like something peering over a wall.
 */
const RISE_FROM = -0.30;
const RISE_TO = 0.26;

/**
 * IT SWAYS, IT DOES NOT SPIN, and this is the one presentation decision here
 * that was reversed by looking at it.
 *
 * A slow continuous turn is the obvious choice and it is wrong: a weapon is a
 * long thin object, so a full rotation spends a quarter of its cycle pointing at
 * or away from the player, where the most recognisable silhouette in the game
 * collapses into a blocky mass with no length to it. Photographed at 2.9 metres
 * it was unidentifiable. Black Ops 2 does not spin it either - the gun sits
 * broadside on the platform - so this rocks 22 degrees either side of broadside
 * instead, which is enough motion to catch the eye and never enough to lose the
 * profile.
 */
const SWAY_ANGLE = 0.39;
const SWAY_RATE = 0.62;

export function createAltar({ scene, camera, weapons, viewmodel, economy, audio, notice }) {
  const state = {
    upgraded: 0,
    denied: 0,
    /** Weapon ids put through, in order, for the harness. */
    order: [],

    /**
     * The ritual: 'idle' | 'working' | 'ready'.
     *
     * 'ready' means the upgraded weapon is on the plate and has not been
     * collected. Everything about the state of the machine is these three fields
     * and the record it is standing in, which is deliberately little enough to
     * read in one glance when something goes wrong.
     */
    phase: 'idle',
    /** The weapon in the machine, and what was paid for it. */
    held: null,
    paid: 0,
    /** Seconds of work left, counted down on the frame delta. */
    remaining: 0,
  };

  // ---------------------------------------------------------------------------
  // tracers
  // ---------------------------------------------------------------------------

  /**
   * One shared geometry running 0..1 along +Z, so a streak is a position, a
   * lookAt, and a Z scale. Object3D.lookAt points a non-camera object's +Z at
   * the target, which is why the geometry is translated forward rather than
   * being centred on the origin.
   */
  const tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
  tracerGeo.translate(0, 0, 0.5);

  // Additive and unlit, because a tracer is light and not a surface. Depth
  // WRITE is off so a hundred overlapping streaks do not fight each other, but
  // depth TEST stays on so a streak going into a wall is occluded by the wall.
  const tracerMat = new THREE.MeshBasicMaterial({
    color: 0xffd27a,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const tracerGroup = new THREE.Group();
  tracerGroup.name = 'tracers';
  // Never a hitscan target. Without this the next round fired can be stopped by
  // the streak the last one left, which is a bug that presents as the weapon
  // randomly missing at close range.
  tracerGroup.userData.noHit = true;
  scene.add(tracerGroup);

  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i++) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.userData.noHit = true;
    tracerGroup.add(mesh);
    tracers.push({ mesh, life: 0 });
  }

  let cursor = 0;
  let highFidelity = true;

  const origin = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  const aim = new THREE.Vector3();

  /**
   * Draw a streak from the muzzle to where the round landed.
   *
   * ---------------------------------------------------------------------------
   * WHAT THIS REPLACED, AND WHY IT CAME OUT OF THE BOTTOM RIGHT OF THE SCREEN
   * ---------------------------------------------------------------------------
   *
   * The first version of this took the camera's world position and added
   * (0.22, -0.16, 0) rotated into camera space - a hand's width down and right
   * of the eye - and called that "roughly the muzzle". The z of that offset is
   * ZERO, which puts the start point exactly on the eye plane: 0.00 metres in
   * front of a camera whose near plane is at 0.05. Measured in the running
   * game, that point projects to an NDC of 4.7e13, -5.9e13. It is not near the
   * edge of the screen, it is at infinity past the bottom right corner, and
   * what the player sees is the near-plane clip of a line running from there to
   * the impact - a streak entering frame from under the right hand and flying
   * up and left. Which is exactly what was reported.
   *
   * A hardcoded offset could not have worked in any case. The gun is not a
   * fixed distance down and right of the eye; it sways, it kicks, it comes to
   * the eye when the player aims, and on seven weapons the crown sits anywhere
   * from 200mm to 744mm in front of the hand.
   *
   * ---------------------------------------------------------------------------
   * WHAT IT DOES NOW
   * ---------------------------------------------------------------------------
   *
   * The viewmodel is asked where its muzzle is ON THE SCREEN - see
   * viewmodel.muzzleNdc, which projects the flash group through the viewmodel's
   * own camera - and the streak starts on that pixel, TRACER_START metres in
   * front of the eye.
   *
   * Screen space is the right currency and it is worth being explicit about
   * why. There is no world position for the muzzle to be had: the weapon is a
   * prop in a second scene at its own scale in front of its own 55-degree
   * camera, and the world is drawn at 75. The two spaces share exactly one
   * thing - the pixels - so the pixel is what gets matched. A streak that
   * leaves the crown of the barrel and lands on the impact point is then true
   * in the only frame the player ever sees it in.
   */
  function fire(end) {
    if (!highFidelity) return null;

    camera.getWorldPosition(eye);

    const m = viewmodel?.muzzleNdc?.(ndc);
    const mx = m ? m.x : FALLBACK_NDC.x;
    const my = m ? m.y : FALLBACK_NDC.y;

    // The world ray through the muzzle's pixel. unproject() reads the same
    // matrixWorld the hitscan's raycaster read a few lines earlier in
    // weapons.js, so the two ends of this streak are measured against one
    // camera pose rather than two.
    aim.set(mx, my, 0.5).unproject(camera).sub(eye);
    if (aim.lengthSq() < 1e-12) return null;
    aim.normalize();

    const t = tracers[cursor];
    cursor = (cursor + 1) % TRACER_POOL;

    // Never start further out than half way to the impact: a round that lands
    // on the muzzle of the gun that fired it is a contact shot, and a streak
    // starting past it would point backwards.
    const reach = eye.distanceTo(end);
    origin.copy(eye).addScaledVector(aim, Math.min(TRACER_START, reach * 0.5));

    const dist = origin.distanceTo(end);
    if (dist < 0.2) return null;

    t.mesh.position.copy(origin);
    t.mesh.lookAt(end);
    t.mesh.scale.set(1, 1, dist);
    t.mesh.visible = true;
    t.life = TRACER_LIFE;

    return t;
  }

  function updateTracers(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.life = 0;
        t.mesh.visible = false;
      }
    }
  }

  function setFidelity(high) {
    highFidelity = !!high;

    // The weapon standing on the Altar drops its small parts with everything
    // else. It is not in the viewmodel's own `built` table - this file owns it -
    // so the viewmodel has to be asked.
    if (shown) viewmodel?.refreshDetail?.(shown.model);

    if (highFidelity) return;
    for (const t of tracers) { t.life = 0; t.mesh.visible = false; }
  }

  // ---------------------------------------------------------------------------
  // price
  // ---------------------------------------------------------------------------

  function costFor(rec) {
    const cfg = rec.config || {};
    const first = cfg.cost === undefined ? 5000 : cfg.cost;
    const repeat = cfg.repeat === undefined ? 2000 : cfg.repeat;
    return state.upgraded === 0 ? first : repeat;
  }

  /**
   * Why the Altar will not take gold, or null if gold is the only obstacle.
   * A gated Altar quotes no price, the same rule every other fixture keeps.
   *
   * The two ritual phases are locks too, and they read as locks on purpose: a
   * machine that is mid-cycle or holding a finished weapon is not refusing the
   * player's money for want of money, so it must not quote a price.
   */
  function lockedBecause() {
    if (state.phase === 'working') return 'Working';
    if (state.phase === 'ready') return 'Holding your weapon';

    const id = weapons.state.current;
    if (!id) return 'Nothing in your hands';
    if (weapons.isUpgraded(id)) return 'Already renewed';
    return null;
  }

  // ---------------------------------------------------------------------------
  // the weapon on the machine
  //
  // A real copy of the real viewmodel, built by player/viewmodel.js and parented
  // to the mount world/build.js hangs off the gold plate. Nothing here authors
  // geometry: the two things this file decides are WHERE it sits and HOW it
  // moves, because those are presentation and the model is not.
  // ---------------------------------------------------------------------------

  /** The interact record, bound on the first insertion. See present(). */
  let fixture = null;

  /** { id, pivot } for the weapon currently on the plate, or null. */
  let shown = null;

  /** 0..1 through the rise. Drives height and nothing else. */
  let riseT = 0;

  /**
   * Seconds the weapon has been on the plate, accumulated from the frame delta.
   *
   * Its own clock rather than main.js's `elapsed`, because the sway has to start
   * at zero - which is broadside - every time something is presented. Sampling a
   * global clock would show each weapon at whatever angle the run happened to be
   * at when it finished, and the first frame of the reveal is the one frame that
   * has to be square to the player.
   */
  let showClock = 0;

  const bounds = new THREE.Box3();
  const boundsSize = new THREE.Vector3();
  const boundsMid = new THREE.Vector3();

  function visuals() { return fixture && fixture.visuals; }

  /**
   * Put a weapon on the plate.
   *
   * THREE NESTED GROUPS, and each one exists because the layer inside it cannot
   * do that job:
   *
   *   pivot   turns on Y and rises. Owned by update().
   *   tilt    the presentation attitude. Fixed.
   *   root    the model, scaled to DISPLAY_LENGTH and OFFSET so that its own
   *           bounding centre lands on the pivot's origin.
   *
   * The offset is the part that is not obvious and is the reason for the nesting.
   * A weapon model's origin is the web of the shooting hand - the MK9's muzzle is
   * 200mm in front of it and its slide 5mm behind - so spinning the model about
   * its own origin swings it round like a thrown stick. Baking the offset into
   * the same object that carries the rotation would not work either: a local
   * matrix is T * R * S, so the offset would be rotated with it and the centring
   * would come out wrong by exactly the attitude.
   */
  function present(id) {
    const v = visuals();
    if (!v || !v.mount || !viewmodel?.buildDisplay) return false;

    clearPresented();

    const model = viewmodel.buildDisplay(id);
    if (!model) return false;

    bounds.setFromObject(model.root);
    bounds.getSize(boundsSize);
    bounds.getCenter(boundsMid);

    const longest = Math.max(boundsSize.x, boundsSize.y, boundsSize.z) || 1;
    const scale = DISPLAY_LENGTH / longest;

    model.root.scale.setScalar(scale);
    model.root.position.set(
      -boundsMid.x * scale, -boundsMid.y * scale, -boundsMid.z * scale);

    // Broadside to the player and canted a few degrees off square, which is how
    // a thing being SHOWN sits rather than a thing left on a shelf. The models
    // are built with the bore down -Z, so a quarter turn puts the whole profile
    // across the player's view; the spin in update() carries it round from there.
    const tilt = new THREE.Group();
    tilt.rotation.set(0.13, Math.PI * 0.5, 0.06);
    tilt.add(model.root);

    const pivot = new THREE.Group();
    pivot.name = 'altar:presented';
    pivot.position.y = RISE_FROM;
    pivot.add(tilt);

    v.mount.add(pivot);
    shown = { id, pivot, model };
    riseT = 0;
    showClock = 0;
    return true;
  }

  function clearPresented() {
    if (!shown) return;
    const p = shown.pivot;
    p.parent && p.parent.remove(p);
    shown = null;
    riseT = 0;
    showClock = 0;
  }

  // ---------------------------------------------------------------------------
  // prompt
  // ---------------------------------------------------------------------------

  function describe(rec) {
    const label = ((rec.config && rec.config.label) || 'Altar of Ptah').toUpperCase();

    // Mid-cycle the prompt is a clock. A player who has just handed over their
    // weapon and 5000 gold is owed a number rather than the word "wait", because
    // the only decision left in front of them is whether to hold this room.
    if (state.phase === 'working') {
      const left = Math.max(1, Math.ceil(state.remaining));
      return { text: `${label} - WORKING - ${left}`, deny: true };
    }

    if (state.phase === 'ready') {
      const name = weapons.displayName(state.held).toUpperCase();
      return { text: `TAKE THE ${name}  [F]`, deny: false };
    }

    const id = weapons.state.current;
    const name = weapons.displayName(id).toUpperCase();

    const why = lockedBecause();
    if (why) return { text: `${label} - ${name} ${why.toUpperCase()}`, deny: true };

    const cost = costFor(rec);
    const afford = economy.canAfford(cost);

    return {
      text: `${label} - RENEW ${name} - ${cost} GOLD${afford ? '  [F]' : ''}`,
      deny: !afford,
    };
  }

  // ---------------------------------------------------------------------------
  // purchase
  // ---------------------------------------------------------------------------

  function deny(message) {
    state.denied++;
    audio?.purchaseDenied?.();
    if (message && notice) notice(message, 1800);
    return false;
  }

  /**
   * The F key, routed by the phase. Still returns a plain boolean: true only if
   * something in the world changed, which is the contract ui/interact.js counts
   * bought and denied off and every other fixture in the map keeps.
   */
  function buy(rec) {
    if (state.phase === 'working') {
      // NOT a denial. The player pressing F at a machine they can see working is
      // not being refused a purchase, and answering them with the refusal chime
      // and a red notice - five, ten times over five seconds - would teach them
      // they had done something wrong. Nothing happened; nothing is charged.
      return false;
    }

    if (state.phase === 'ready') return collect();

    return insert(rec);
  }

  /** Beat one: the gold goes and the weapon goes in. */
  function insert(rec) {
    const why = lockedBecause();
    if (why) return deny(why);

    const id = weapons.state.current;
    const cost = costFor(rec);

    if (!economy.canAfford(cost)) {
      return deny(`Need ${cost - economy.gold} more gold`);
    }
    if (!economy.spend(cost, `altar/${id}`)) return deny();

    // The weapon leaves the hands, and if that fails NOTHING has happened except
    // that gold left the purse - so it goes straight back. This is the same rule
    // as the refund in finish(): the two halves of an insertion are the payment
    // and the weapon, and either both or neither.
    if (weapons.stow() !== id) {
      economy.grant(cost, 'altar/refund');
      return deny('The Altar refuses');
    }

    fixture = rec;
    state.phase = 'working';
    state.held = id;
    state.paid = cost;
    state.remaining = WORK_TIME;

    visuals()?.setWorking?.(true);
    visuals()?.setPresenting?.(false);

    // The gun going in, then the machine catching. magOut is the sound of a
    // magazine leaving its well, which is the closest thing the synth engine has
    // to metal leaving a hand, and boltPull is the machine taking it.
    audio?.magOut?.();
    audio?.boltPull?.();

    notice?.('THE ALTAR TAKES YOUR WEAPON', 2200);
    return true;
  }

  /**
   * Beat three: the work finishes.
   *
   * THE ONE NEW FAILURE MODE IN THE RITUAL. weapons.upgrade() can refuse, and by
   * the time it is called the gold is already gone and the weapon is already in
   * the machine, so a refusal has to undo both. It does, in one place, with the
   * exact figure that was taken - state.paid, recorded at insertion rather than
   * recomputed from costFor(), because costFor() reads state.upgraded and a
   * refund priced off a live counter is a refund that can be wrong.
   */
  function finish() {
    const id = state.held;

    if (!weapons.upgrade(id)) {
      economy.grant(state.paid, 'altar/refund');
      weapons.restore(id);
      reset();
      deny('The Altar refuses');
      return false;
    }

    state.upgraded++;
    state.order.push(id);
    state.phase = 'ready';
    state.remaining = 0;

    visuals()?.setWorking?.(false);
    visuals()?.setPresenting?.(true);
    present(id);

    audio?.bossHorn?.();
    audio?.shrineChime?.();
    notice?.(`${weapons.displayName(id).toUpperCase()} - TAKE IT FROM THE ALTAR`, 3600);
    return true;
  }

  /** Beat four: the player takes it back. */
  function collect() {
    const id = state.held;
    if (!weapons.restore(id)) {
      // Unreachable unless something else emptied the machine. It is not treated
      // as a purchase failure because there is nothing to refund - the upgrade
      // has already been applied and is on the weapon - so the machine is simply
      // emptied rather than left holding a weapon nobody can take.
      reset();
      return false;
    }

    reset();
    audio?.magIn?.();
    notice?.(weapons.displayName(id).toUpperCase(), 2400);
    return true;
  }

  function reset() {
    state.phase = 'idle';
    state.held = null;
    state.paid = 0;
    state.remaining = 0;
    visuals()?.setWorking?.(false);
    visuals()?.setPresenting?.(false);
    clearPresented();
  }

  // ---------------------------------------------------------------------------
  // frame
  // ---------------------------------------------------------------------------

  /**
   * Driven by main.js's CLAMPED delta, and that is load-bearing twice over.
   *
   * It is the same delta the player, the horde and every animation in the game
   * move on, so the five-second window is five seconds of the same time the
   * player is living in - not of wall clock, which under the software renderer
   * the harness uses runs dozens of times faster than the simulation, and not of
   * frames, which would make the machine faster on a better GPU.
   *
   * This runs whether or not the player is in the room, in the pyramid, or alive.
   * See the interruption note at the top of the file: that is the rule, and this
   * unconditional line is the whole of its implementation.
   */
  function update(dt) {
    updateTracers(dt);

    if (state.phase === 'working') {
      state.remaining -= dt;
      if (state.remaining <= 0) finish();
    }

    if (shown) {
      showClock += dt;

      if (riseT < 1) {
        riseT = Math.min(1, riseT + dt / RISE_TIME);
        // Smoothstepped, so it eases out of the stone and settles rather than
        // arriving at its height with a corner on the curve.
        const k = riseT * riseT * (3 - 2 * riseT);
        shown.pivot.position.y = RISE_FROM + (RISE_TO - RISE_FROM) * k;
      } else {
        // A 15mm breath once it has settled. Small enough that nobody sees it
        // move and large enough that nobody reads the weapon as welded down.
        shown.pivot.position.y = RISE_TO + Math.sin(showClock * 1.15) * 0.015;
      }

      shown.pivot.rotation.y = Math.sin(showClock * SWAY_RATE) * SWAY_ANGLE;
    }
  }

  return {
    state,
    describe,
    buy,
    costFor,
    lockedBecause,

    /** Handed to createWeapons, which calls it once per upgraded round fired. */
    tracer: fire,

    update,
    setFidelity,

    get tracerGroup() { return tracerGroup; },
    get liveTracers() { return tracers.filter((t) => t.life > 0).length; },

    /** For the harness: the weapon actually parented to the Altar, or null. */
    get presented() { return shown ? shown.pivot : null; },
  };
}
