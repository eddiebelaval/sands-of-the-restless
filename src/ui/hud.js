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

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export function createBoonStrip(el, shrines) {
  if (!el) return { dispose() {} };

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
  const q = (sel) => root.querySelector(sel);

  const healthEl = q('[data-health]');
  const healthBar = q('[data-health-bar]');
  const healthPlate = q('#r-health');
  const goldEl = q('[data-gold]');
  const waveEl = q('[data-wave]');
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
    gold: null, wave: null,
    mag: null, reserve: null, weapon: null, slot: null,
    empty: null, reloading: null, canReload: null,
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

    // --- ammunition ---------------------------------------------------------
    if (s.magazine !== painted.mag) {
      painted.mag = s.magazine;
      if (magEl) magEl.textContent = s.magazine;
    }
    if (s.reserve !== painted.reserve) {
      painted.reserve = s.reserve;
      if (reserveEl) reserveEl.textContent = s.reserve;
    }
    if (s.weapon !== painted.weapon) {
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

  return { update, fps, gold, hitmarker, painted };
}
