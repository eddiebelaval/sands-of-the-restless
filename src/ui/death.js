/**
 * Dying, as an EVENT.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACES
 * ---------------------------------------------------------------------------
 *
 * Before this file, `fell()` in systems/damage.js did four things in one tick:
 * washed the frame red, healed the player to full, reset the wave director, and
 * printed a line of text in the notice pill. The run went back to wave one
 * between two frames, with the player still standing, still holding the trigger,
 * facing a spawn queue that had just been rebuilt. Nothing on screen said the
 * word "died". A player who walked away from the keyboard died, restarted, died
 * again, and kept dying - which is what the owner watched happen.
 *
 * So there are three problems here and they are not the same problem:
 *
 *   1. Death was a STATE CHANGE, not an event. It has to take time, and the
 *      time has to be spent showing the player something.
 *   2. There was no verdict. A round-based shooter owes the player a title card
 *      at the moment they stop being alive; GTA's WASTED is the reference and
 *      the reason it works is that it is a JUDGEMENT, delivered in one word,
 *      instantly, with nothing else on screen.
 *   3. The restart was automatic, and an automatic restart is a game that plays
 *      itself badly. The run now waits for the player, indefinitely, with the
 *      world genuinely stopped - and a timeout would be the same bug with a
 *      longer fuse, so there is not one.
 *
 * ---------------------------------------------------------------------------
 * THE WORD
 * ---------------------------------------------------------------------------
 *
 * UNWORTHY.
 *
 * WASTED is Los Santos: street slang, the city dismissing you. The equivalent
 * move here has to come out of the same building the game is set in. In the
 * Hall of Two Truths the heart is weighed against the feather of Maat, and a
 * heart that weighs more is fed to Ammit and the name is erased - which is the
 * Egyptian version of exactly what GTA's card does: not "you have failed", but
 * a VERDICT ON YOU, one word, already final by the time you read it.
 *
 * It also belongs to THIS build rather than to Egypt generally. The Feather of
 * Maat is already a named object in this game - it is the insta-kill drop, and
 * systems/damage.js carries a comment block about it - so the card's second
 * line, THE HEART OUTWEIGHS THE FEATHER, is naming something the player has
 * picked up off the floor rather than something out of a museum caption.
 *
 * Rejected: DEVOURED (accurate to Ammit, reads as a generic zombie game),
 * WASTED-with-hieroglyphs (a template with a costume on), YOU DIED (Souls owns
 * it), and THE SANDS TAKE YOU, which was the old notice text and is a sentence
 * rather than a verdict. A verdict is one word.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SEQUENCE LIVES HERE AND NOT IN systems/damage.js
 * ---------------------------------------------------------------------------
 *
 * damage.js is combat resolution: it knows how much a hit takes off and nothing
 * else. Giving it the card, the camera pose, the wave reset, the power-up sweep
 * and an input gate would make it the largest file in the game and the one that
 * knows about the most things. So it keeps the ONE fact it owns - the player's
 * health reached zero - and hands it here through `begin()`.
 *
 * `begin()` is deliberately almost inert. It sets a phase, starts the camera
 * falling, and shows DOM. It does NOT reset the run, because it is called from
 * inside `director.update()`'s actor loop - a shambler's strike lands, the
 * player dies, and we are eleven frames deep in a for-loop over the live list.
 * That is the exact shape of the crash test/enemies.mjs pins under "a death
 * mid-tick does not throw": the old `fell()` called `director.reset()` from
 * there, which truncated the list the loop was walking. Every mutation now
 * happens in `restart()`, which only ever runs from `update()`, which only ever
 * runs from the frame loop. The re-entrancy is designed out rather than guarded.
 *
 * ---------------------------------------------------------------------------
 * THE RESET RULE - what survives a death and what does not
 * ---------------------------------------------------------------------------
 *
 * CARRIES OVER: what the player earned with their hands.
 *   gold; the weapons in the rack and any Altar upgrades on them; magazines and
 *   reserve as they stood; grenades; doors already bought open; and the power
 *   state of the necropolis.
 *
 * DOES NOT CARRY OVER: everything the world was doing to them.
 *   the wave (back to one, via director.reset, which also retires every live
 *   actor); every timed power-up effect AND every power-up still lying on the
 *   ground; every shrine boon; an Altar ritual caught in flight; the red damage
 *   wash; the camera's death pose; and WHERE THE BODY FELL.
 *
 * The ground drops are the one line that changed from the shipped behaviour.
 * main.js used to keep them on the argument that the player had earned them -
 * but a Second Death sitting on the sand through a reset is the wave-one horde
 * being deleted by something the player picked up in wave nine, and a run that
 * restarts with the previous run's loot on the floor has not restarted.
 *
 * THE ALTAR is resolved rather than cancelled, entirely through its public API:
 * a ritual mid-work is finished (`state.remaining = 0` then a zero-delta tick,
 * which is what the machine's own update does when the clock runs out) and then
 * collected (`buy(null)`, which routes to collect() in the 'ready' phase and
 * puts the weapon back in the player's hands). Cancelling would mean deciding
 * whether the gold or the weapon comes back and the file that owns that rule is
 * altar.js, which states it: "either both or neither". Finishing gives both and
 * requires this file to know none of it.
 *
 * ---------------------------------------------------------------------------
 * THE RETURN - "when I die I need to spawn back at the beginning"
 * ---------------------------------------------------------------------------
 *
 * The body used to stay exactly where it fell. Everything else about the run
 * went back to the start and the player did not, so a death in the far corner
 * of the yard restarted wave one around the corpse's own footprint, and a death
 * in the burial chamber restarted it inside a sealed pyramid. That is a reset
 * of the world with the one thing the player can see left out of it.
 *
 * So the restart now puts them back at the courtyard spawn, and there are two
 * cases which are NOT the same operation:
 *
 *   OUTSIDE. A teleport, plus the facing. The controller owns the eye height,
 *   so this passes a floor of y: 0 the way every other caller does.
 *
 *   INSIDE. Not a teleport at all - the interior is a different WORLD, 110
 *   units past the courtyard wall, with its own colliders, its own floor
 *   sampler and its own bounds. Writing the courtyard's coordinates into a
 *   player standing in the interior would leave the interior live and drop the
 *   body outside its rectangle, where the bounds clamp would push it back into
 *   a wall. The only correct way out is systems/spaces.js `enter('exterior')`,
 *   which is also the only thing that swaps the collider set, restores the sky
 *   lights it is holding down, retargets the audio and raises the curtain over
 *   the swap. So the return goes THROUGH the router rather than around it, and
 *   the router does the teleport and the facing itself as part of the move.
 *
 * WHERE THE BEGINNING IS is not this file's fact and is not copied here. It is
 * `courtyard.spawn`, declared once in world/courtyard.js and handed out by the
 * router; a `(0, 30)` written down here would be a second copy of a number
 * another lane owns and is free to move.
 *
 * THE FACING is yaw 0 - forward is (-sin yaw, 0, -cos yaw), so yaw 0 looks down
 * -Z at the pyramid, which is what main.js aims the camera at on boot. The
 * pitch is the router's arrival pitch and not main.js's boot pitch, because one
 * of the two paths goes through the router and cannot be told otherwise, and
 * two respawns that differ by a hundredth of a radian depending on which world
 * you died in is a difference with no reason behind it.
 *
 * THE DOORWAY STAYS BOUGHT. A restarted run does not re-buy the entry: doors
 * already opened are listed under CARRIES OVER above, alongside the gold that
 * paid for them, and re-sealing without refunding would confiscate a purchase
 * while a refund would hand back gold for a door the player already walked
 * through. Whether a fresh run should re-seal the necropolis is a design call
 * about how a run is scoped, and it belongs to the economy and door lanes
 * rather than to the file that happens to notice the player died. Changing
 * nothing is the conservative option and it is what this does.
 *
 * ---------------------------------------------------------------------------
 * THE DOOR LANE, AND WHAT THIS FILE ASSUMES
 * ---------------------------------------------------------------------------
 *
 * A fade-to-black pyramid entry transition is being built in systems/spaces.js
 * and systems/doors.js, which this file does not touch. The failure it could
 * cause is specific: the player dies with the curtain halfway up, this file
 * freezes the world, and the curtain is frozen with it - black screen, forever,
 * with a death card behind it.
 *
 * So the freeze in main.js is NOT total: `doors.update(dt)` keeps running while
 * the run is held. THE ASSUMPTION IS THAT A TRANSITION FINISHES ON ITS OWN
 * CLOCK, driven from doors.update, and that lifting its own curtain is its job.
 * If the curtain is driven from somewhere else it will need the same exemption,
 * which is one line in main.js's halted branch.
 *
 * The card is at z-index 55: above the HUD (20) and the notice (30), below the
 * pause menu and the title veil (60). A curtain that wants to be over the card
 * can be; a curtain that is under it does not hide the verdict.
 *
 * ---------------------------------------------------------------------------
 * TIME
 * ---------------------------------------------------------------------------
 *
 * Every clock in here is the CLAMPED simulation delta from main.js, the same
 * one the horde and the grenade fuses run on. Not frames, and not wall clock.
 *
 * MAX_DELTA is 1/20, so on a machine dropping 50 ms frames the fall takes twenty
 * frames instead of sixty and still travels the whole arc; on the 134 ms frames
 * the pixel-ratio bug was producing it takes eight, and still travels the whole
 * arc, just slower in the hand. A frame-counted animation would have played the
 * entire fall in a third of a second exactly when the machine was least able to
 * show it, and a wall-clock one would have jumped the camera to the floor in two
 * steps. Sim time is the only clock that degrades into "slower" rather than into
 * "skipped".
 */

import { PIGMENT, ROLE, FORM, ink, incised, registerRules } from './tokens.js';
import { createTypewriter } from './pacer.js';

// ---------------------------------------------------------------------------
// the beats, in seconds of SIMULATION time
// ---------------------------------------------------------------------------

/** The body stops holding itself up. Camera-only; see player/camera.js. */
const FALL = 1.00;

/**
 * The card lands slightly before the camera has finished settling.
 *
 * On purpose. Waiting for a dead stop puts a gap between the motion and the
 * verdict, and the gap reads as a load. Landing the word on the tail of the
 * settle makes the card feel like the last beat of the fall rather than the
 * first beat of a menu.
 */
const CARD_AT = 0.88;

/**
 * How long the verdict stands alone before the way out appears.
 *
 * This is the second half of "not any-key". The player has been holding fire,
 * mashing reload and leaning on sprint; the gate does not exist yet while any of
 * that is still arriving. See `armed` below - the keyboard path also requires the
 * confirm key to have been RELEASED since the card appeared, so a finger already
 * down cannot satisfy it either.
 */
const ARM_AFTER = 0.55;

/**
 * ---------------------------------------------------------------------------
 * THE GATEKEEPER'S TWO WORDS
 * ---------------------------------------------------------------------------
 *
 * `docs/WORLD-1.md` THE GATEKEEPER'S TWO WORDS: the tomb passes a verdict on
 * this card about twenty times a run, and something else answers it, in two
 * words, in a different treatment, every single time, and then he stands up.
 *
 * That is the entire characterisation of the second supernatural power in the
 * trilogy, and it is bought for one span. What it plants:
 *
 *   - The loop acquires an OWNER the player can feel from their first death,
 *     with no exposition and without the game ever saying there are two powers.
 *   - The two voices get SEPARATE SURFACES. She owns the notice pill, he owns
 *     this card, and they never share - which is the mechanical statement that
 *     they are different powers. When the pill becomes his in World 2, the
 *     handover needs no announcement.
 *   - The last card in World 3 has something to WITHHOLD. It comes up on the
 *     far side of a shut gate, the player presses the key they have pressed
 *     thirty times, and the answer does not arrive. That only lands if it
 *     arrived every time before it, which is why the cheapest item in the
 *     project is also one of the first.
 *
 * ---------------------------------------------------------------------------
 * THE STRINGS ARE THE OWNER'S, AND AS OF 2026-08-04 THEY ARE RATIFIED
 * ---------------------------------------------------------------------------
 *
 * `docs/STORY-DELIVERY.md` NOT DECIDED HERE named the words as the owner's and
 * priced the span rather than the string. The owner has now taken the call, so
 * this array is a decision and not a placeholder. It stays one edit to change:
 * replace it, or call `setAnswer()` at runtime.
 *
 * THE RULE. Every line is two words, none of them is a sentence, and every one
 * DISAGREES WITH THE VERDICT rather than explaining it. UNWORTHY, says the
 * tomb. Not yet, says something else.
 *
 * AND THE RULE UNDER THAT ONE, which is what settled the last slot: HE IS NOT
 * KIND. `docs/NARRATIVE.md` is explicit - the gatekeeper stands the corpse up
 * "because he needs it to reach the bottom", he tells the player nothing ever,
 * and at the end he throws him through the gate for being what the OTHER power
 * made him. The being who has been standing him up for three worlds is the one
 * holding the list he is on.
 *
 * So these are a user's words, not a friend's. `COME BACK` shipped here first
 * and was cut for exactly that: it is the only warm line in the set, it implies
 * he misses the player, and it implies the player went somewhere - which muddles
 * which of the two powers owns the death loop. `GO DEEPER` replaced it because
 * it is the one thing the narrative says he actually wants, in an announcer's
 * register with no comfort in it.
 *
 * `MINE STILL` is the load-bearing line. It is a claim of possession, made on
 * the most-read text in the game, and it is what turns the ending into a
 * betrayal rather than a twist.
 *
 * They rotate by death count rather than at random, so a second-run player can
 * name what the card said on their fourth death, and NOT YET is always first
 * because it is the one every player meets.
 */
const ANSWER = ['NOT YET', 'STAND UP', 'GO DEEPER', 'NOT FINISHED', 'MINE STILL', 'WALK AGAIN'];

/**
 * When the answer arrives, in seconds after the card lands.
 *
 * It is a beat behind the verdict on purpose, and the ordering is the whole
 * point: the tomb speaks, and then it is contradicted. Simultaneous, they read
 * as one card with two lines on it. 0.34 also puts the answer in FRONT of the
 * button arming at 0.55, so the last thing to appear is still the way out.
 */
const ANSWER_AFTER = 0.34;

/**
 * He is typed rather than printed, at six characters a second.
 *
 * ui/pacer.js paces her at 22. Six is the same mechanism with one number
 * changed, and it is how the gatekeeper is characterised without a word of
 * description: a two-word line from him takes as long to arrive as one of her
 * sentences. Slowness is who he is. The codec tick under it is his, an octave
 * below hers and through a filter a third of the height - see CODEC in
 * core/audio.js for the numbers and for why the mummy cannot be confused with
 * either of them.
 */
const ANSWER_VOICE = 'gate';

/**
 * The confirm.
 *
 * Enter, and nothing else. W A S D, Shift, Space, R, V, F, the digits and both
 * mouse buttons are all bound to something the player was doing a second ago;
 * Enter is bound to exactly one thing in this game - starting it from the title
 * card, behind a `!started` guard - and is therefore the only key on the board
 * that cannot arrive by accident out of the fight that just ended.
 */
const CONFIRM_CODE = 'Enter';

/** DOM id, so the harness can drive the gate the way it drives `#begin`. */
const CONFIRM_ID = 'death-confirm';

/**
 * The pose the run starts in again. See THE RETURN at the top of the file.
 *
 * Yaw 0 is down -Z, at the pyramid. The pitch is systems/spaces.js's arrival
 * pitch rather than main.js's boot pitch of -0.03: the inside case is handed to
 * `enter()`, which resets the rig itself and does not take a pitch, so matching
 * it here is the only way both respawns land on the same horizon. The one
 * hundredth of a radian between the two numbers is about half a degree, which
 * is invisible on its own and only worth anything as a thing that AGREES.
 */
const SPAWN_YAW = 0;
const SPAWN_PITCH = -0.02;

const ROOT_ID = 'death';

/**
 * Build the overlay in JavaScript.
 *
 * index.html is owned by another lane this week - a start menu and a difficulty
 * selector are going into it - so this creates its own DOM rather than claiming
 * markup there. Which is also the honest shape: the death card is not part of
 * the document, it is part of the death sequence, and it should not exist in the
 * page of a game nobody has died in yet.
 *
 * The styles are a <style> element built from ui/tokens.js rather than literals,
 * for the reason tokens.js exists: a surface that hardcodes `#d9b26a` has copied
 * a decision it does not own.
 */
function build(doc) {
  const style = doc.createElement('style');
  style.id = 'death-style';
  style.textContent = css();
  doc.head.appendChild(style);

  const root = doc.createElement('div');
  root.id = ROOT_ID;

  // The ground. A vignette rather than a flat scrim: the frame darkens from the
  // edges the way vision does, and the centre stays dark enough to carry linen
  // text at better than fifteen to one.
  const wash = doc.createElement('div');
  wash.className = 'death-wash';
  root.appendChild(wash);

  const card = doc.createElement('div');
  card.className = 'death-card';

  const ruleTop = doc.createElement('div');
  ruleTop.className = 'death-rule';
  card.appendChild(ruleTop);

  // THE CARTOUCHE, and it goes round the WORD and nothing else.
  //
  // A cartouche is the oval a NAME is written in. Putting the subtitle, the run
  // figures and a button inside one would make it a dialog box with round ends.
  // One line tall, so `border-radius: 999px` is genuinely r = h/2 - semicircular
  // ends, per the note in tokens.js FORM.pillRadius.
  const cart = doc.createElement('div');
  cart.className = 'death-cartouche';

  const word = doc.createElement('div');
  word.className = 'death-word';
  word.textContent = 'UNWORTHY';
  cart.appendChild(word);

  // The shen bar: the vertical stroke that ties the loop shut at one end of a
  // real cartouche. Pure frame ornament, which is where ornament goes.
  const shen = doc.createElement('div');
  shen.className = 'death-shen';
  cart.appendChild(shen);

  card.appendChild(cart);

  const line = doc.createElement('div');
  line.className = 'death-line';
  line.textContent = 'THE HEART OUTWEIGHS THE FEATHER';
  card.appendChild(line);

  // THE ANSWER. Under the verdict, in a different treatment, disagreeing with
  // it. Empty until the sequence types into it, and it keeps its line height
  // while it is empty so the card does not jump when the words arrive.
  const answer = doc.createElement('div');
  answer.className = 'death-answer';
  card.appendChild(answer);

  const ruleBot = doc.createElement('div');
  ruleBot.className = 'death-rule';
  card.appendChild(ruleBot);

  // The epitaph: how far the run got. Numerals, so nothing decorative touches
  // them - no cartouche, no glow, no tracking past what a number can take.
  const stats = doc.createElement('div');
  stats.className = 'death-stats';
  card.appendChild(stats);

  const again = doc.createElement('button');
  again.id = CONFIRM_ID;
  again.className = 'death-again';
  again.type = 'button';
  again.textContent = 'KEEP THE VIGIL   [ENTER]';
  card.appendChild(again);

  root.appendChild(card);
  doc.body.appendChild(root);

  return { root, card, word, line, answer, stats, again };
}

function css() {
  const gold = ink(ROLE.frame, 0.85);
  const goldDim = ink(ROLE.frame, 0.30);

  return `
#${ROOT_ID} {
  position: fixed; inset: 0; z-index: 55;
  display: none;
  align-items: center; justify-content: center;
  pointer-events: none;
  font-family: 'Cinzel', 'Trajan Pro', Georgia, serif;
}
#${ROOT_ID}.on { display: flex; }

.death-wash {
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse at 50% 46%,
      ${ink(PIGMENT.shadow, 0.72)} 0%,
      ${ink(PIGMENT.shadow, 0.90)} 42%,
      ${ink(PIGMENT.shadow, 0.985)} 100%),
    linear-gradient(${ink(PIGMENT.plaster, 0.16)}, ${ink(PIGMENT.stone, 0.20)});
}

.death-card {
  position: relative;
  display: flex; flex-direction: column; align-items: center;
  gap: clamp(10px, 1.6vh, 20px);
  padding: clamp(18px, 3vh, 40px) clamp(24px, 5vw, 76px);
  max-width: 92vw;
  text-align: center;
}

/* Register rules: the paired hairlines that separate bands of wall art. */
.death-rule {
  width: min(70vw, 760px); height: ${FORM.hairline + FORM.ruleGap}px;
  background: ${registerRules('top', ROLE.frame, 0.55)};
}

.death-cartouche {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  max-width: 94vw;
  padding: clamp(10px, 2.2vh, 26px) clamp(34px, 6vw, 96px)
           clamp(10px, 2.2vh, 26px) clamp(26px, 5vw, 76px);
  border: ${FORM.hairline}px solid ${gold};
  border-radius: ${FORM.pillRadius};
  background:
    linear-gradient(${ink(PIGMENT.plaster, 0.34)}, ${ink(PIGMENT.stone, 0.46)});
  box-shadow:
    inset 0 ${FORM.incisionDepth}px 0 ${ink(PIGMENT.shadow, 0.9)},
    inset 0 -${FORM.incisionDepth}px 0 ${ink(PIGMENT.goldDeep, 0.5)},
    0 0 44px ${ink(PIGMENT.goldHot, 0.10)};
}

/* The tie at the end of the loop. Frame, never number. */
.death-shen {
  position: absolute; right: clamp(14px, 2.4vw, 34px);
  top: 22%; bottom: 22%;
  width: ${FORM.hairline * 2}px;
  background: ${gold};
}

.death-word {
  /*
   * MEASURED, not guessed. At 12vw the word laid out 1414 px wide inside a
   * 1575 px cartouche in a 1440 px viewport - the semicircular ends were off
   * both edges of the screen, so the one shape that makes it a cartouche was
   * the one part nobody could see. Cinzel sets this word at 8.18x its font
   * size, and the loop adds up to 172 px of padding, so the ceiling that keeps
   * the whole oblong on a 1440 plate with air around it is about 8.4vw.
   */
  font-size: clamp(34px, 8.4vw, 128px);
  line-height: 0.94;
  letter-spacing: ${FORM.labelTracking};
  /* The tracking pushes the glyphs right; give the last one its air back so the
     word sits centred inside the loop instead of leaning on the shen bar. */
  text-indent: ${FORM.labelTracking};
  font-weight: 700;
  color: ${ink(ROLE.textBright)};
  text-shadow: ${incised(18)};
}

.death-line {
  font-size: clamp(11px, 1.5vw, 19px);
  letter-spacing: ${FORM.labelTracking};
  color: ${ink(ROLE.text, 0.92)};
  text-shadow: ${incised()};
}

/*
 * THE OTHER POWER, and it is painted rather than labelled.
 *
 * LAPIS, from tokens.js, which reserves it for "anything the game wants to feel
 * supernatural rather than mechanical" - and specifically arcaneText, the
 * legible value, because the fill measures 2.70 to one and this is text. The
 * whole card above it is gold: the verdict, the cartouche, the rules, the
 * epitaph. One line in the cool note is the only signal needed to say that the
 * thing answering is not the thing that judged.
 *
 * Wide tracking and a small size: a whisper under a shout. It is deliberately
 * NOT lowercase - lowercase is the archaeologist's, it is the only lowercase in
 * the game, and the World 2 handover is worthless if the two ever shared it.
 *
 * min-height holds the row before the words arrive, so the card does not
 * reflow underneath the verdict a third of a second after it lands. Same
 * argument as the button's hidden visibility below.
 */
.death-answer {
  min-height: 1.2em;
  font-size: clamp(10px, 1.15vw, 14px);
  letter-spacing: 0.42em;
  text-indent: 0.42em;
  color: ${ink(ROLE.arcaneText, 0.95)};
  text-shadow: 0 0 14px ${ink(PIGMENT.lapis, 0.55)}, ${incised()};
}
/* The unsaid half of the line in flight; see ui/pacer.js. Hidden by
   visibility so the two words occupy their finished width from the first
   character, which on a centred card is the difference between typing and
   sliding. */
.death-answer .notice-rest { visibility: hidden; }

.death-stats {
  font-size: clamp(11px, 1.3vw, 16px);
  letter-spacing: ${FORM.numeralTracking};
  color: ${ink(ROLE.textDim)};
  font-variant-numeric: tabular-nums;
}

.death-again {
  margin-top: clamp(4px, 1vh, 14px);
  pointer-events: auto;
  font: inherit;
  font-size: clamp(11px, 1.3vw, 17px);
  letter-spacing: ${FORM.labelTracking};
  color: ${ink(ROLE.ready)};
  background: linear-gradient(${ink(PIGMENT.plaster, 0.5)}, ${ink(PIGMENT.stone, 0.6)});
  border: ${FORM.hairline}px solid ${goldDim};
  border-radius: ${FORM.pillRadius};
  padding: 0.62em 1.9em;
  cursor: pointer;
  text-shadow: ${incised()};

  /* Hidden until the gate arms - and hidden by VISIBILITY, so the card does not
     reflow underneath the verdict when the way out appears. */
  visibility: hidden;
}
.death-again.armed { visibility: visible; }
.death-again:hover { color: ${ink(ROLE.textBright)}; border-color: ${gold}; }

/*
 * The ONLY thing that animates, and it is the frame.
 *
 * tokens.js states the binding rule - ornament belongs in the frame, never in
 * the number - and a verdict that fades in is a verdict you can miss. The word
 * is at full opacity on the frame it exists. The cartouche around it takes one
 * pulse of gold, which is the moment landing, and if the animation never runs
 * at all the card is still complete and still legible.
 */
@keyframes death-strike {
  0%   { box-shadow: inset 0 0 0 ${ink(PIGMENT.shadow, 0)}, 0 0 0 ${ink(PIGMENT.goldHot, 0)}; }
  18%  { box-shadow: inset 0 0 24px ${ink(PIGMENT.goldHot, 0.5)}, 0 0 90px ${ink(PIGMENT.goldHot, 0.42)}; }
  100% { box-shadow:
           inset 0 ${FORM.incisionDepth}px 0 ${ink(PIGMENT.shadow, 0.9)},
           inset 0 -${FORM.incisionDepth}px 0 ${ink(PIGMENT.goldDeep, 0.5)},
           0 0 44px ${ink(PIGMENT.goldHot, 0.10)}; }
}
#${ROOT_ID}.on .death-cartouche { animation: death-strike 420ms ease-out both; }
`;
}

/**
 * @param {object} parts
 * @param {Document} parts.doc
 * @param {object} parts.rig        player/camera.js - startDeath / endDeath
 * @param {object} parts.player     for the heal, and to read health while held
 * @param {object} parts.viewmodel  for its private camera; see leaveFrame()
 * @param {object} parts.combat     the red wash lives on its state
 * @param {object} parts.director   the wave, and the live actors
 * @param {object} parts.powerups   effects AND the drops on the ground
 * @param {object} parts.altar      resolved through its public API only
 * @param {object} parts.economy    read-only, for the epitaph
 * @param {object} parts.input      core/input.js - frozen while the run is held
 * @param {object} [parts.audio]
 * @param {function} [parts.suspended]  true while the pause menu is up
 * @param {object} [parts.spaces]   systems/spaces.js - the active-space router.
 *   OPTIONAL, and the optionality is real rather than defensive: this file was
 *   built and shipped without it, the harnesses construct the game the same way
 *   main.js does, and a run with no router is a run with exactly one world. See
 *   `toTheBeginning()` for what a missing router costs and why the answer is to
 *   leave the body where it fell rather than to guess at a coordinate.
 */
export function createDeath({
  doc, rig, player, viewmodel, combat, director, powerups, altar, economy,
  input, audio, suspended, spaces, save,
}) {
  const el = build(doc);

  /**
   * The gatekeeper's reveal.
   *
   * MANUAL, not self-driving, and that is the same decision the rest of this
   * file already made: every clock in here is the clamped simulation delta from
   * main.js, because the world is stopped and the harnesses step this sequence
   * directly rather than waiting on a wall clock. A self-driving typewriter
   * would type at full speed through a test that advances the card in one call,
   * and would keep typing through a pause menu.
   */
  const answerTyper = createTypewriter({
    el: el.answer, doc, audio, voice: ANSWER_VOICE, manual: true,
  });

  /**
   * Which words answer the verdict, and the one hook that can withhold them.
   *
   * A world sets this. World 1 leaves it alone; World 3's last card sets it to
   * null, at which point nothing answers, and the silence is the ending. That
   * is the whole reason this is a variable and not a constant read inline.
   */
  let answerWords = ANSWER;

  const state = {
    /** 'none' | 'falling' | 'waiting' | 'restarting' */
    phase: 'none',
    /** Seconds of SIM time since the player went down. */
    t: 0,
    /** The gate accepts the confirm key. See ARM_AFTER. */
    armed: false,
    /** Set by confirm(); consumed by update() on the next frame. */
    pending: false,
    /**
     * Lifetime completed sequences, for the harness.
     *
     * SEEDED FROM THE SAVE, because the card's whole conceit is that the tomb
     * remembers. It counted your erasures in memory and forgot them on the next
     * reload, which made the one number in this game whose entire meaning is
     * that it REMEMBERS the one number that did not. It is now cumulative
     * across every session on this machine.
     */
    resets: save ? save.getRecord('erased', 0) : 0,
    /** How the run ended, frozen at the moment of death. */
    wave: 0,
    gold: 0,
    /**
     * Which route the last return to the beginning took. Reported rather than
     * inferred, because 'the player is in the courtyard' is true both of a
     * player who was walked home and of one who never left, and a suite that
     * cannot tell those apart cannot tell a working return from a no-op.
     */
    returned: 'none',
  };

  /**
   * Is the confirm key physically down RIGHT NOW.
   *
   * Tracked continuously, from before the player ever dies, because the question
   * the gate has to answer is "was this key already held when the card came up",
   * and that cannot be reconstructed after the fact from a keydown alone -
   * `event.repeat` is false on some platforms for a key held across a focus
   * change, and is not delivered at all by others.
   */
  let heldNow = false;

  /** The gate refuses this key until it has been RELEASED at least once. */
  let stale = false;

  function onKeyDown(e) {
    if (e.code !== CONFIRM_CODE) return;
    heldNow = true;
    if (e.repeat) return;
    if (stale) return;                       // held over from the fight
    if (suspended && suspended()) return;    // the pause menu owns the keyboard
    if (state.phase !== 'waiting' || !state.armed) return;
    e.preventDefault();
    confirm();
  }

  function onKeyUp(e) {
    if (e.code !== CONFIRM_CODE) return;
    heldNow = false;
    stale = false;
  }

  doc.defaultView.addEventListener('keydown', onKeyDown);
  doc.defaultView.addEventListener('keyup', onKeyUp);

  // The button is the harness's door, and a human's door in pointer-lock
  // fallback mode. `.click()` fires this whether or not the pointer is locked,
  // which is the whole reason the gate is a real <button> and not a div.
  el.again.addEventListener('click', () => {
    if (state.phase !== 'waiting') return;
    confirm();
  });

  /**
   * The weapon leaves the frame.
   *
   * The viewmodel is rendered by its own pass, through its own camera, into its
   * own scene - so dropping the world camera does nothing to it, and the hands
   * would hang in front of a body lying on the sand. player/weapons.js and the
   * viewmodel are both owned by other lanes this week, so this reaches for the
   * one thing that is already public and that nothing writes every frame: the
   * viewmodel's camera. `syncProjection()` touches only its aspect; its position
   * has been the origin since construction.
   *
   * Raising that camera lowers the weapon out of the bottom of the frame, and
   * rolling it opposite the body's roll makes the gun drop out of the hand
   * rather than ride the head down.
   */
  function leaveFrame(k) {
    const vm = viewmodel && viewmodel.camera;
    if (!vm) return;
    vm.position.y = 0.62 * k;
    vm.rotation.z = -0.55 * k;
  }

  /**
   * The moment of death. Called from systems/damage.js `fell()`.
   *
   * Almost nothing happens here, and that is the design - see the note at the
   * top of the file. This is called from inside the director's actor loop.
   *
   * @returns {boolean} true if this file has taken ownership of the run.
   */
  function begin() {
    if (state.phase !== 'none') return true;   // already down; idempotent

    state.phase = 'falling';
    state.t = 0;
    state.armed = false;
    state.pending = false;

    // Frozen now rather than read at card time, so the epitaph reports the run
    // that ended and not whatever the numbers had drifted to.
    state.wave = (director && director.state && director.state.wave) || 0;
    state.gold = (economy && economy.gold) || 0;

    // A key already down when the body hits the sand does not count. It has to
    // come up first. See `stale`.
    stale = heldNow;

    // FREEZE THE INPUT LAYER, and this is not the same thing as freezing the
    // simulation.
    //
    // main.js stops CONSUMING input while the run is held, but core/input.js
    // goes on ACCUMULATING it: mouse deltas pile up in state.dx/dy, and the
    // trigger and the sprint key stay logically down. Without this the player
    // spends four seconds reading a death card, moves the mouse while they read
    // it, and the first frame of the new run applies four seconds of look in one
    // step - a teleport of the view that reads as the game having glitched. The
    // pause menu already solved this exact problem; setSuspended CLEARS as well
    // as gates, which is why it is the right call and a flag would not be.
    suspendInput(true);

    rig?.startDeath?.();
    return true;
  }

  /**
   * Idempotent, because the pause menu is the other writer of this flag.
   *
   * A player who pauses while dead and resumes has had setSuspended(false)
   * called underneath them by ui/pause.js, which does not know the run is being
   * held. Re-asserting from the frame loop costs one boolean read on the frames
   * where it is already right.
   */
  function suspendInput(on) {
    if (!input || !input.setSuspended) return;
    if (!!input.state.suspended === !!on) return;
    input.setSuspended(on);
  }

  /** The player says go. Only ever sets a flag; update() does the work. */
  function confirm() {
    if (state.phase !== 'waiting') return false;
    state.pending = true;
    return true;
  }

  function showCard() {
    // THE GAME COUNTS THE RETURNS, in the tomb's own verb.
    //
    // The card is the tomb speaking, and what the tomb does to a heart that
    // fails the weighing is erase the name - which is exactly what the empty
    // cartouche above this line is. So the third field is not "deaths" or
    // "attempts", both of which are a scoreboard's words for it; it is the
    // count of erasures, said by the thing doing the erasing.
    //
    // `state.resets` counts COMPLETED sequences, so it is one behind at the
    // moment the card is up: this erasure has happened and has not been walked
    // away from yet. The +1 counts the one the player is looking at, which is
    // the only reading that is not off by one on a player's first death.
    const erased = state.resets + 1;

    /**
     * WRITTEN WHEN THE CARD GOES UP, not when the player walks away from it.
     *
     * A player who reads "ERASED 04 TIMES" and closes the tab has been erased
     * four times, and recording it at the reset instead would quietly disagree
     * with the number they were looking at when they left.
     *
     * `best` rather than an increment, and that is what makes it safe: erasures
     * only ever go up, so writing the ABSOLUTE total is idempotent. Showing this
     * card twice for one death - which the harness does, and which a resumed
     * sequence could - cannot double-count.
     */
    if (save) {
      save.best('erased', erased);
      save.best('deepestWave', state.wave);
      save.best('richestRun', state.gold);
    }

    el.stats.textContent =
      `WAVE ${String(state.wave).padStart(2, '0')}   ·   ${state.gold} GOLD`
      + `   ·   ERASED ${String(erased).padStart(2, '0')} ${erased === 1 ? 'TIME' : 'TIMES'}`;

    // The answer is cleared here and typed in `step`, ANSWER_AFTER seconds
    // later. Cleared rather than left standing so a card that comes up while a
    // previous line is somehow still on it never shows the last death's words
    // before this death's.
    answerTyper.clear();

    el.again.classList.remove('armed');
    el.root.classList.add('on');
  }

  /**
   * Put the body back at the beginning. See THE RETURN at the top of the file.
   *
   * Called from restart() and from nowhere else, which is what keeps it inside
   * the frame loop: `spaces.enter()` hides and shows whole subtrees, rewrites
   * the collider array the player controller is holding a reference to, and
   * moves the sky's lights. None of that may happen from inside an iteration
   * over anything, and the only reason it is safe here is the same reason
   * director.reset() is safe here - see the re-entrancy note at the top.
   *
   * Ordering, and it is deliberate on both sides:
   *
   *   AFTER the Altar. `altar.buy(null)` collects a finished ritual and puts
   *   the weapon back in the player's hands, and the Altar of Ptah stands in
   *   the interior. Resolving it while the player is still standing in the
   *   room it is in costs nothing and asks no questions about whether collect
   *   cares where they are; resolving it after a swap would.
   *
   *   BEFORE rig.endDeath(). endDeath() clears the death POSE - the fov, the
   *   roll, the drop - and does not touch yaw or pitch, so the facing set here
   *   survives it. The reverse order would work too; this one keeps "where the
   *   player is" next to "which world they are in" instead of splitting the
   *   move across the stand-up.
   *
   * The swap itself is covered. `enter()` brings the curtain to full black on
   * the way in and holds it for two DRAWN frames, and this runs from
   * death.update() - which main.js calls before doors.update() and long before
   * the composer - so the black is up on the same frame the world changes.
   * doors.update() keeps its delta while the run is held and is what ticks the
   * curtain back down, which is the exemption already documented above.
   *
   * WITHOUT THE ROUTER, nothing moves, and that is the honest degrade rather
   * than a hedge. A file with no router knows neither where the beginning is
   * nor which of the two worlds the body is lying in, and a hardcoded courtyard
   * coordinate applied to a player who might be inside the pyramid is worse
   * than not moving them: it puts them outside the live world's bounds, and the
   * controller's clamp pushes them back in through whatever wall is nearest.
   * A run assembled without the router has one world and the pre-existing
   * behaviour is unchanged for it.
   *
   * @returns {'exterior'|'entered'|'no-router'|'no-spawn'} which route ran.
   */
  function toTheBeginning() {
    if (!spaces) return 'no-router';

    // The router's own courtyard handle first, because that is the object that
    // declares the spawn; `world.spawn` is the same Vector3 seen through the
    // one live world object, and is read as a fallback rather than as a second
    // source of truth. Neither is ever rewritten by a transition.
    const home =
      (spaces.courtyard && spaces.courtyard.spawn) ||
      (spaces.world && spaces.world.spawn);
    if (!home) return 'no-spawn';

    // Inside: hand the whole move to the router, including the arrival. It
    // teleports and re-aims as part of the swap, so doing either here would be
    // doing it twice - once into the world being left.
    if (spaces.active !== 'exterior') {
      spaces.enter('exterior', { x: home.x, z: home.z, rot: SPAWN_YAW });
      return 'entered';
    }

    // Outside: already in the right world, and `enter()` would decline the call
    // anyway - it returns false when the name matches the active space.
    player.teleport({ x: home.x, y: 0, z: home.z });
    rig?.reset?.(SPAWN_YAW, SPAWN_PITCH);
    return 'exterior';
  }

  /**
   * The run restarts. The rule this implements is stated at the top of the file.
   *
   * Only ever reached from update(), which is only ever reached from the frame
   * loop - never from inside an actor iteration.
   */
  function restart() {
    // The world first.
    director?.reset?.();

    // Effects AND the drops on the ground. `clear()` rather than
    // `clearEffects()`: see the reset rule above.
    powerups?.clear?.();

    // The Altar, through its own public API and its own rules. A ritual still
    // working is finished on the spot - which is what its update() does when the
    // clock runs out - and then collected, which is what puts the weapon back in
    // the player's hands. Nothing here decides who owns the gold.
    if (altar && altar.state) {
      if (altar.state.phase === 'working') {
        altar.state.remaining = 0;
        altar.update(0);
      }
      if (altar.state.phase === 'ready') altar.buy(null);
    }

    // Then the place. The run does not restart around the corpse.
    state.returned = toTheBeginning();

    // Then the body.
    player.heal(player.state.maxHealth);
    if (combat && combat.state) combat.state.wash = 0;

    rig?.endDeath?.();
    leaveFrame(0);

    // The hands come back empty of everything that was held when the body fell:
    // no accumulated look, no trigger still down, no sprint key still latched.
    suspendInput(false);

    el.root.classList.remove('on');
    el.again.classList.remove('armed');
    // The answer goes with the card. Left standing, it would be the first thing
    // on the next one, before that death has been judged.
    answerTyper.clear();

    state.phase = 'none';
    state.t = 0;
    state.armed = false;
    state.pending = false;
    state.resets++;

    // The vigil resumes. `magIn` is a magazine seating - the game's own sound
    // for "ready" - rather than a horn, because the director's own horn is
    // eight seconds behind this and two fanfares would step on each other.
    audio?.magIn?.();
  }

  /**
   * Advance the sequence one frame. Driven by main.js on the CLAMPED delta.
   *
   * Allocation-free: every value below is a local number, the DOM is touched
   * only on a phase boundary, and the two class names are toggled once each.
   */
  function step(dt) {
    if (state.phase === 'none') return;

    // -----------------------------------------------------------------------
    // THE STAND-DOWN, and it is not a timeout.
    // -----------------------------------------------------------------------
    //
    // Nothing inside the game can heal a dead player: regeneration is in
    // combat.update, the shrines and the power-ups are all inside the block
    // main.js freezes, and `damagePlayer` returns early at zero health. So if
    // health has come back while the run is held, the ONLY thing that can have
    // done it is something outside the simulation - which in practice means the
    // harness, which reaches in and calls `player.heal()` directly to clean up
    // after a death test (test/enemies.mjs section 6b does exactly this).
    //
    // In that case the gate has nothing left to hold, so it lets go WITHOUT
    // restarting the run: the ceremony is dropped, the card comes down, the
    // freeze lifts, and whatever state the harness set up is left exactly as it
    // found it. A restart here would clear the director the harness had just
    // populated.
    //
    // This cannot fire for a player who walked away from the keyboard, because
    // nothing will heal them. That was the bug; it is not this.
    if (state.phase !== 'restarting' && player.state.health > 0 && !state.pending) {
      standDown();
      return;
    }

    state.t += dt;

    if (state.phase === 'falling') {
      if (state.t >= CARD_AT) {
        showCard();
        state.phase = 'waiting';
      }
      return;
    }

    if (state.phase === 'waiting') {
      // The answer, once, a beat behind the verdict. `phase === null` on the
      // typewriter means it has not been given a line since showCard() cleared
      // it, which is the flag rather than a second boolean beside it.
      if (answerTyper.phase === null && state.t >= CARD_AT + ANSWER_AFTER) {
        const words = answerWords && answerWords.length
          ? answerWords[state.resets % answerWords.length]
          : null;
        // Null is a legal and load-bearing value: it is what the last card in
        // the trilogy does. Nothing answers, and the card is still complete.
        if (words) answerTyper.play(words);
      }
      // Typed on SIM time, so it slows down with everything else on a machine
      // dropping frames rather than skipping characters.
      answerTyper.advance(dt);

      if (!state.armed && state.t >= CARD_AT + ARM_AFTER) {
        state.armed = true;
        el.again.classList.add('armed');
      }
      if (state.pending) {
        state.phase = 'restarting';
        restart();
      }
    }
  }

  /** Lift the presentation and the freeze, and change nothing about the run. */
  function standDown() {
    rig?.endDeath?.();
    leaveFrame(0);
    suspendInput(false);
    el.root.classList.remove('on');
    el.again.classList.remove('armed');
    answerTyper.clear();
    state.phase = 'none';
    state.t = 0;
    state.armed = false;
    state.pending = false;
  }

  /**
   * The camera's fall drives the weapon out of frame on the same curve, so the
   * two are one motion rather than two animations that happen to overlap.
   * Called from update()'s caller side every frame the rig moves - which is the
   * frame loop, so it goes here rather than in a second timer.
   */
  function syncWeapon() {
    if (state.phase === 'none') return;
    leaveFrame(rig?.deathProgress ?? 0);
  }

  return {
    state,
    begin,
    confirm,
    /**
     * One frame of the sequence, driven by main.js on the CLAMPED delta.
     *
     * The state machine is `step`; `syncWeapon` rides the camera's eased
     * progress so the gun and the head move on one curve rather than on two
     * animations that happen to finish together. Named `step` rather than
     * `update` so nothing inside can be misread as recursing into this method.
     */
    update(dt) {
      step(dt);
      syncWeapon();
      // Re-asserted rather than set once: ui/pause.js is the other writer and
      // does not know the run is being held. See suspendInput().
      if (state.phase !== 'none') suspendInput(true);
    },

    /**
     * THE FREEZE. main.js reads this and skips the entire simulation block.
     *
     * True from the frame the player goes down to the frame the run restarts,
     * with no timeout in between. While it is true: the player does not move,
     * the horde does not advance, no wave begins or ends, no fuse burns, no
     * power-up expires, health does not regenerate and nothing can be damaged.
     */
    get halted() { return state.phase !== 'none'; },

    get phase() { return state.phase; },
    get waiting() { return state.phase === 'waiting'; },
    get armed() { return state.armed; },

    /** The word on the card, so a test can assert the card and not the DOM. */
    get verdict() { return el.word.textContent; },

    /**
     * What the other power has said SO FAR - the revealed substring, not the
     * string it was handed. The two differ for a second while it types, and
     * the difference is the only evidence that it typed at all.
     *
     * Read off the typewriter and NOT off `el.answer.textContent`, which would
     * be wrong in the one way that matters: the unsaid half of the line is a
     * span that is hidden by visibility, so it is still in the element's text
     * content and a DOM read would report the whole line from the first frame.
     */
    get answer() { return answerTyper.text; },

    /**
     * Set the answering words, or withhold them entirely with `null`.
     *
     * The withholding is not a debug hook. It is World 3's last card: the
     * player presses the key they have pressed thirty times, and for the first
     * time nothing answers. See THE GATEKEEPER'S TWO WORDS above.
     */
    setAnswer(words) {
      answerWords = words == null ? null : (Array.isArray(words) ? words : [words]);
    },

    /** The confirm's DOM id, for the harness. It clicks this like `#begin`. */
    confirmId: CONFIRM_ID,

    stats() {
      return {
        phase: state.phase,
        t: state.t,
        armed: state.armed,
        resets: state.resets,
        wave: state.wave,
        gold: state.gold,
        returned: state.returned,
        shown: el.root.classList.contains('on'),
        // The answer, measured the same way the word below is: what is on the
        // screen and how big it laid out, not what was assigned to it. See the
        // `answer` getter for why this is not a textContent read.
        answer: answerTyper.text,
        answerFull: answerTyper.full,
        answerTicks: answerTyper.ticks,
        answerBox: (() => {
          const r = el.answer.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        })(),
        epitaph: el.stats.textContent,
        // Measured, not assumed. The bug class in this project is UI that was
        // written, believed and never rendered, so the harness is handed the
        // laid-out size of the word rather than the fact that it exists.
        wordBox: (() => {
          const r = el.word.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        })(),
      };
    },
  };
}
