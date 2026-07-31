/**
 * DIFFICULTY, AND THE ONE DECISION THAT MATTERS IN IT.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE TIERS DO NOT DO: multiply health and damage.
 * ---------------------------------------------------------------------------
 *
 * The obvious implementation of three difficulties is a pair of numbers - a
 * health multiplier and a damage multiplier - applied to every enemy on the
 * map. It is obvious, it is two lines, and it makes the game worse at both
 * ends, which is why so many games' easy modes feel bad rather than easy.
 *
 * A flat 0.6x health does not make wave one easier, because a wave-one
 * shambler already dies to a short burst; the change is under the resolution of
 * a magazine and the player cannot feel it. By wave twenty the same multiplier
 * is the only thing keeping the run alive, and it has turned the fight into an
 * accounting adjustment. Run it the other way and Hard hands the player a
 * wave-one mummy that eats a magazine and a half - a bullet sponge in the first
 * thirty seconds, which is the single fastest way to make a shooter feel cheap.
 *
 * The game this is modelled on does not have a difficulty selector at all.
 * Round-based zombies has exactly one curve and the difficulty IS the curve:
 * every player starts in the same place and the pressure arrives on a schedule.
 * That is the thing worth preserving, so what these tiers change is the SLOPE
 * of that schedule rather than the substance of what is on the other end of the
 * crosshair.
 *
 *   Wave one is IDENTICAL on all three tiers. hpScale(1) is 1.00 everywhere by
 *   construction - the slope is multiplied by (wave - 1) - so the first fight
 *   in the game is the same fight whatever was picked at the title. What
 *   differs is how much runway there is before the curve gets somewhere.
 *
 * Normal reaches 2.35x enemy health at wave ten. Hard reaches it at wave 7.1
 * and Easy at wave 14.5. Nobody ever faces a spongier mummy than the game
 * already ships; they face the same mummy sooner or later.
 *
 * ---------------------------------------------------------------------------
 * WHAT A TIER IS ALLOWED TO TOUCH
 * ---------------------------------------------------------------------------
 *
 *   hpSlope        the per-wave health increment. THE curve.
 *   sizeSlope      how fast the wave grows in bodies. The horde thickening.
 *   spawn*         how quickly those bodies arrive once a wave has begun.
 *   breather       how long the quiet between waves lasts.
 *   startGold      the opening purse.
 *   unlockShift    which wave the husk, the swarm and the Bound first appear.
 *
 * And what it may NOT touch, because a score has to stay comparable in ways the
 * player can see:
 *
 *   THE PAYOUT TABLE. 10 / 60 / 100 is frozen in systems/economy.js and is the
 *   same on every tier. An Easy kill and a Hard kill are worth the same gold,
 *   so gold earned means one thing across all three.
 *
 *   WEAPON DAMAGE. Every gun does what it says on every tier. The player's half
 *   of the fight is a constant.
 *
 *   THE BOSS. bosses scale off `state.wave / 5` in enemies/director.js and are
 *   left exactly where they are. A tier moves the ramp between the landmarks;
 *   it does not move the landmarks.
 *
 * ---------------------------------------------------------------------------
 * NORMAL IS THE SHIPPED GAME, TO THE DIGIT
 * ---------------------------------------------------------------------------
 *
 * Every number on the `normal` tier below was lifted out of the constant it
 * replaced - 0.15 out of `hpScale`, 2.1 out of `compose`, 1.5/0.045/0.28 out of
 * the spawn interval, 6.0/3.5 out of BREATHER, 500 out of STARTING_GOLD - and
 * not retuned by so much as a hundredth. It is the default, so a player who has
 * been playing this build up to now is playing the game they know, and every
 * one of the eleven suites boots straight into it and sees the constants it was
 * written against.
 *
 * ---------------------------------------------------------------------------
 * IT IS A RUN-LEVEL CHOICE, AND IT LOCKS
 * ---------------------------------------------------------------------------
 *
 * Picked at the title, fixed for the run, and stated on the HUD for as long as
 * the run lasts. `lock()` is called by start() in main.js and `set` refuses
 * afterwards, which is not defensive tidiness: the wave curve is a function of
 * the wave number, so a tier swapped at wave twelve would rewrite the history
 * of the run underneath a score that had already been earned against a
 * different one.
 *
 * NO PERSISTENCE, matching src/ui/pause.js exactly. The project constraint in
 * STATE.md and the README is "No browser storage. All state in memory.", the
 * settings panel honours it, and a second mechanism appearing beside it for
 * this one value is how a constraint stops being one. The choice lives for the
 * session and the title screen defaults to Normal on every reload.
 */

/**
 * The three tiers, and every number behind them.
 *
 * ONE TABLE, in the same spirit as the settings spec in ui/pause.js: the label,
 * the numbers and the sentence the title screen prints about them sit together,
 * so a tier cannot be described in the interface as one thing and implemented
 * as another. `said` is what the player is told, and it is written from the
 * numbers on the same line.
 */
export const TIERS = [
  {
    id: 'easy',
    name: 'Easy',
    // 0.10 against 0.15. Wave twenty arrives at 2.90x rather than 3.85x, which
    // is roughly Normal's wave fourteen: five extra waves of runway.
    hpSlope: 0.10,
    // The horde thickens more slowly. Wave one is still seven bodies - round(1.6)
    // and round(2.1) are both 2 - so the opening is untouched and the tiers
    // separate from wave two onward.
    sizeSlope: 1.6,
    // Slower arrivals, and a HIGHER floor: 0.40 rather than 0.28 is what stops
    // the late game becoming a wall regardless of the ramp.
    spawnBase: 1.80, spawnRamp: 0.038, spawnFloor: 0.40,
    breather: 8.0, firstBreather: 5.0,
    // 750 against a 1000 doorway. The first door is still a thing to earn -
    // handing over the full 1000 would delete the opening minute of the game -
    // but it is one wave of work rather than two, and the 250 is a magazine off
    // a wall on the way past.
    startGold: 750,
    // The swarm at six, the husk at eight, the Bound at twelve.
    unlockShift: 2,
    said: 'A shallower climb. The horde thickens slowly, the quiet between '
      + 'waves runs eight seconds, and the purse opens at 750.',
  },
  {
    id: 'normal',
    name: 'Normal',
    // THE SHIPPED GAME. Every value here is the constant it replaced.
    hpSlope: 0.15,
    sizeSlope: 2.1,
    spawnBase: 1.50, spawnRamp: 0.045, spawnFloor: 0.28,
    breather: 6.0, firstBreather: 3.5,
    startGold: 500,
    unlockShift: 0,
    said: 'The necropolis as it was built. The swarm at four, the husk at six, '
      + 'the Bound at ten, and 500 against a 1000 doorway.',
  },
  {
    id: 'hard',
    name: 'Hard',
    // 0.22. Wave ten lands at 2.98x, which is Normal's wave fourteen - the same
    // enemy, four waves early. Not a tougher enemy.
    hpSlope: 0.22,
    sizeSlope: 2.6,
    // A lower floor as well as a steeper ramp, so the late game genuinely
    // presses rather than merely arriving sooner.
    spawnBase: 1.25, spawnRamp: 0.055, spawnFloor: 0.22,
    breather: 4.5, firstBreather: 2.5,
    // 400. One hundred short of the shipped purse, which is a hundred fewer
    // rounds off a wall in the opening minute and the only place a tier is
    // allowed to touch what the player can afford to shoot.
    startGold: 400,
    // The swarm at three, the husk at five, the Bound at nine.
    unlockShift: -1,
    said: 'A steeper climb. Waves arrive larger and closer together, the quiet '
      + 'runs four and a half seconds, and the purse opens at 400.',
  },
];

/** By id, so a lookup is not a scan. Frozen: this table is not a scratchpad. */
export const TIER = Object.freeze(Object.fromEntries(
  TIERS.map((t) => [t.id, Object.freeze(t)])));

export const DEFAULT_TIER = 'normal';

/**
 * The live choice.
 *
 * Constructed at boot, read by the wave director on every frame it needs a
 * curve value, and written only by the title screen. Systems are handed THIS
 * OBJECT rather than a copy of the tier, because the choice is made after the
 * director is constructed - a director holding a snapshot would run the whole
 * game on whatever was selected at boot, which is the shape of a selector that
 * sets a variable nothing reads.
 *
 * @param {string} [initial]
 */
export function createDifficulty(initial = DEFAULT_TIER) {
  let current = TIER[initial] ? initial : DEFAULT_TIER;
  let locked = false;

  const listeners = new Set();

  return {
    TIERS,

    /** The whole tier record. Read fresh every time; never cached by a caller. */
    get tier() { return TIER[current]; },
    get id() { return current; },
    get name() { return TIER[current].name; },
    get locked() { return locked; },

    /**
     * Choose. Refused once the run has begun, and the refusal is REPORTED
     * rather than swallowed: a caller that thinks it changed the difficulty
     * mid-run and did not is exactly the class of silent no-op this project
     * keeps finding in screenshots.
     */
    set(id) {
      if (locked) return false;
      if (!TIER[id] || id === current) return false;
      current = id;
      for (const fn of listeners) fn(TIER[current]);
      return true;
    },

    /** The run has begun. The choice is now part of the score. */
    lock() {
      locked = true;
      return TIER[current];
    },

    /** For the title screen, so it repaints from the choice rather than from
     * whatever it thinks it just wrote. */
    subscribe(fn) {
      listeners.add(fn);
      fn(TIER[current]);
      return () => listeners.delete(fn);
    },

    /**
     * THERE IS DELIBERATELY NO `curve()` ON THIS OBJECT.
     *
     * One was written here first - evaluate the tier's numbers and hand them
     * back - and it was deleted before it shipped, because it would have been
     * the most convincing wrong answer available. It re-derives the curve FROM
     * THE TABLE, so it agrees with the table by construction and would report
     * three cleanly separated tiers on a build where the wave director had
     * never been handed this object at all. That is exactly the failure this
     * project keeps finding: a number that is correct about itself and about
     * nothing else.
     *
     * `director.curve(wave)` in enemies/director.js is the one to ask. It runs
     * the same `hpScale`, `unlockAt` and interval expressions the spawner runs,
     * so it can only answer correctly if the wiring is real.
     */
  };
}
