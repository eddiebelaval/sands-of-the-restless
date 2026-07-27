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
  const fpsEl = q('#fps');

  const hitmarkerEl = q('#hitmarker');
  const bossEl = q('#boss');
  const bossNameEl = q('#boss-name');
  const bossBarEl = q('#boss-bar');

  const painted = {
    health: null, healthFrac: null, hurt: null,
    gold: null, wave: null,
    mag: null, reserve: null, weapon: null, empty: null, reloading: null,
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
    if (s.empty !== painted.empty) {
      painted.empty = s.empty;
      if (ammoEl) ammoEl.classList.toggle('empty', !!s.empty);
    }
    if (s.reloading !== painted.reloading) {
      painted.reloading = s.reloading;
      if (ammoEl) ammoEl.classList.toggle('reloading', !!s.reloading);
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
