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
