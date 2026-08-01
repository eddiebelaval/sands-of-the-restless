/**
 * THE FRAME GOVERNOR: stop guessing what machine this is, and measure it.
 *
 * The build shipped with `setFidelity(true)` called unconditionally at boot and
 * no hardware detection of any kind anywhere in the codebase. Every machine on
 * earth got GTAO - which re-renders the entire scene a second time through
 * MeshNormalMaterial to fill its own G-buffer - plus eight more fullscreen
 * passes, at a pixel budget of 3.5 megapixels that was measured on an M4 Max.
 *
 * A player on a MacBook could not play it. That is not a tuning miss, it is a
 * category error: the pixel budget in renderer.js is a CONSTANT chosen from one
 * machine's measurements, and it is being asked to describe every machine.
 *
 * ---------------------------------------------------------------------------
 * WHY A GOVERNOR RATHER THAN A BETTER GUESS
 * ---------------------------------------------------------------------------
 *
 * The obvious fix is to detect the GPU at boot and pick a tier. It does not
 * work, and it is worth writing down why so nobody re-proposes it:
 *
 *   - WEBGL_debug_renderer_info is being progressively locked down, returns
 *     'Apple GPU' for every Apple silicon part from an M1 Air to an M4 Max, and
 *     is spoofed or stripped by privacy settings.
 *   - The same laptop is not the same machine twice. On battery, thermally
 *     throttled, with forty tabs open and a video call running, an M3 Pro is
 *     slower than an idle M1.
 *   - The window size is a bigger factor than the GPU and changes at runtime.
 *
 * Any static answer is wrong for somebody. The only thing that is true on every
 * machine is the frame time on THAT machine right now, so that is what this
 * reads, and the quality follows it.
 *
 * ---------------------------------------------------------------------------
 * THE RULES IT PLAYS BY
 * ---------------------------------------------------------------------------
 *
 * DEGRADE FAST, RECOVER SLOWLY. A player who is dropping frames wants it fixed
 * this second; a player who is fine does not want the picture flickering between
 * settings. Stepping down needs about a second of evidence, stepping back up
 * needs eight, and the ladder never climbs past where it has already failed
 * twice - see `ceiling`.
 *
 * MEDIAN, NOT MEAN. A single 400 ms hitch from a texture upload, a GC, or the
 * horde spawning drags a mean across any threshold. The median of a rolling
 * window ignores it, which is correct: one long frame is not a slow machine.
 *
 * NEVER MEASURE A TRANSITION. The curtain frames are legitimately the most
 * expensive in the game - a whole second world is being made visible - and they
 * are also the frames on which the player can see the least. Sampling them would
 * make walking through a doorway permanently downgrade the game. The governor is
 * told to hold while `paused()` is true and discards its window afterwards.
 *
 * THE PLAYER ALWAYS WINS. If the settings panel sets fidelity by hand, the
 * governor stands down for the rest of the session. An automatic system that
 * argues with an explicit choice is a bug, not a feature.
 */

/**
 * The ladder, cheapest sacrifice first.
 *
 * ORDER IS THE DESIGN. Each rung gives up the most frame time for the least
 * that the player will notice, which is not the same as the least visually
 * significant pass:
 *
 *   1. GTAO first, and by a distance. It is the only pass that costs a SECOND
 *      FULL SCENE RENDER rather than a fullscreen quad - measured at 250 extra
 *      draw calls and 245,000 extra triangles - and the AO it produces was
 *      already found to be near-invisible: rendered as a mask it is a line
 *      drawing, a 1px rim on brick joints, mean 0.971. The most expensive pass
 *      in the chain doing the least visible work is the definition of the first
 *      thing to drop.
 *   2. Shadow resolution. Halving the map is a quarter of the shadow pass and
 *      reads as softer edges rather than as absence.
 *   3. Bloom, then SMAA. Both are fullscreen work on an already-finished image.
 *   4. Pixel ratio LAST, and only after SMAA is gone. It is quadratic and it is
 *      the rung that makes the picture worse everywhere at once, so it is the
 *      last thing spent - and the note in renderer.js is why it cannot come
 *      before SMAA: below a ratio of 1 the anti-aliasing has less signal than it
 *      needs and you are paying for AA that is fighting your own downscale.
 *      Dropping SMAA first turns that waste into a saving instead.
 *
 * By the bottom of the ladder we are keeping the game playable rather than
 * pretty, which is the correct trade: a playable game is the product.
 *
 * The fog pass borrows GTAO's depth buffer, which is why dropping GTAO has to
 * take fog with it - `post.setAO` knows this and pairs them. Doing it here
 * independently would leave the fog pass reading a buffer nobody filled.
 */
const RUNGS = [
  { id: 'full',     gtao: true,  shadow: 1,    px: 1,    bloom: true,  smaa: true },
  { id: 'no-ao',    gtao: false, shadow: 1,    px: 1,    bloom: true,  smaa: true },
  { id: 'soft-sun', gtao: false, shadow: 0.5,  px: 1,    bloom: true,  smaa: true },
  { id: 'no-bloom', gtao: false, shadow: 0.5,  px: 1,    bloom: false, smaa: true },
  { id: 'no-aa',    gtao: false, shadow: 0.5,  px: 1,    bloom: false, smaa: false },
  { id: 'fewer-px', gtao: false, shadow: 0.25, px: 0.85, bloom: false, smaa: false },
  { id: 'low',      gtao: false, shadow: 0.25, px: 0.72, bloom: false, smaa: false, fidelity: false },
];

/**
 * 20 ms is 50 fps, and it is a deliberately loose ceiling.
 *
 * The target is 60, but a governor that degrades the moment the frame misses
 * 16.7 would spend its life stepping down on machines that are essentially fine
 * - a browser cannot hold a hard 16.7 through a GC no matter what it is
 * rendering. 20 ms means "this is not smooth", which is the thing worth acting
 * on. RECOVER_MS is well below it so the ladder only climbs when there is real
 * headroom, not when the frame is hovering at the edge and would immediately
 * fall back down.
 */
const DEGRADE_MS = 20;
const RECOVER_MS = 13;

const WINDOW = 60;          // frames in the rolling median
const DEGRADE_AFTER = 60;   // ~1s of bad frames before giving something up
const RECOVER_AFTER = 480;  // ~8s of clear headroom before asking for it back

export function createGovernor({ post, sky, setFidelity, setPixelScale, paused }) {
  const times = new Float32Array(WINDOW);
  let filled = 0;
  let head = 0;

  let rung = 0;
  let badFor = 0;
  let goodFor = 0;

  /**
   * The highest rung the ladder is still allowed to climb to.
   *
   * Every time a rung is abandoned it is remembered, and after the second
   * failure the ladder will not return to it at all. Without this the governor
   * oscillates on a machine sitting exactly at the threshold: it recovers,
   * immediately drops a frame, degrades, waits eight seconds, recovers, and the
   * player watches the shadows change every few seconds forever. Two strikes is
   * enough evidence that a rung does not fit this machine.
   */
  let ceiling = 0;
  const failures = new Array(RUNGS.length).fill(0);

  /** Set once the player touches the fidelity control themselves. */
  let standDown = false;

  let onChange = null;

  function median() {
    const n = filled;
    if (n < WINDOW) return 0;
    const copy = Array.prototype.slice.call(times, 0, n).sort((a, b) => a - b);
    return copy[n >> 1];
  }

  /**
   * Put a rung into effect.
   *
   * Everything here is idempotent and tolerant of a missing dependency, because
   * this runs on machines and in harnesses where `sky` or `post` may not have
   * the setter being asked for. A governor that throws on a machine that is
   * already struggling is worse than one that does nothing.
   */
  function apply(next) {
    const r = RUNGS[next];

    if (r.fidelity === false) {
      // The bottom rung hands the whole decision to the existing switch, which
      // already turns off every pass at once and knows about the couplings
      // between them. Re-deriving that here would be a second copy of it.
      setFidelity?.(false);
    } else {
      setFidelity?.(true);
      post?.setAO?.(r.gtao);
      post?.setBloom?.(r.bloom);
      post?.setSMAA?.(r.smaa);
      sky?.setShadowScale?.(r.shadow);
    }

    // Outside the branch: the pixel scale is a property of the machine, not of
    // the fidelity switch, and the bottom rung needs it too.
    setPixelScale?.(r.px);

    rung = next;
    filled = 0;
    head = 0;
    badFor = 0;
    goodFor = 0;

    onChange?.(r.id, next);
  }

  return {
    get rung() { return rung; },
    get id() { return RUNGS[rung].id; },
    get ceiling() { return ceiling; },
    get standingDown() { return standDown; },
    /** The current rolling median, for the harness and the settings panel. */
    get frameMs() { return median(); },

    /** Called by ui/pause.js when the player picks a fidelity by hand. */
    yieldToPlayer() { standDown = true; },

    onChange(fn) { onChange = fn; },

    /**
     * One frame of evidence. Driven from the frame loop on the RAW delta, not
     * the clamped one - the clamp exists to keep the simulation stable across a
     * long frame, and a governor fed clamped deltas would be structurally unable
     * to see the long frames it exists to react to.
     */
    sample(rawDtMs) {
      if (standDown) return;

      // Transitions are expensive on purpose and invisible by design. Sampling
      // them would let a doorway permanently downgrade the game.
      if (paused && paused()) { filled = 0; head = 0; return; }

      times[head] = rawDtMs;
      head = (head + 1) % WINDOW;
      if (filled < WINDOW) filled++;

      const m = median();
      if (!m) return;

      if (m > DEGRADE_MS) {
        goodFor = 0;
        if (++badFor >= DEGRADE_AFTER && rung < RUNGS.length - 1) {
          failures[rung]++;
          if (failures[rung] >= 2) ceiling = Math.max(ceiling, rung + 1);
          apply(rung + 1);
        }
        return;
      }

      if (m < RECOVER_MS) {
        badFor = 0;
        if (++goodFor >= RECOVER_AFTER && rung > ceiling) apply(rung - 1);
        return;
      }

      // Between the two thresholds is the dead band, and sitting in it is the
      // governor working. Neither counter advances, so a frame hovering at 17 ms
      // never triggers anything in either direction.
      badFor = 0;
      goodFor = 0;
    },

    /** Force a rung, for the harness. Does not count as a player choice. */
    force(n) { apply(Math.max(0, Math.min(RUNGS.length - 1, n))); },

    /** Every rung, for the settings panel to name what it is currently on. */
    get rungs() { return RUNGS.map((r) => r.id); },
  };
}
