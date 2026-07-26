/**
 * The prompt bus: one line of text on the screen, several systems that want it.
 *
 * systems/doors.js has owned the buy prompt since the map had one thing to buy,
 * and it owns it well - three refusal states, a red price when you are short,
 * no price at all when the thing is not for sale. That behaviour is not being
 * replaced, extended, or forked. It is being given a place to write to that is
 * not the DOM element directly, so a second system can write to the same line
 * without the two of them stomping each other's text sixty times a second.
 *
 * A channel is a DOM LOOKALIKE, deliberately: it answers to `textContent` and
 * to `classList.toggle('on' | 'deny', bool)`, which is exactly the surface
 * doors.js already writes through. So doors.js is handed a channel instead of
 * the element and does not know the difference, and the file does not have to
 * be touched to make room for wall buys and shrines. Adapting to the existing
 * caller is cheaper and safer than editing the existing caller.
 *
 * Arbitration is by PRIORITY, not by distance, and that is a deliberate
 * simplification with a real justification: a barrier stands IN a doorway and a
 * wall buy or a shrine is mounted ON a wall, so the two are essentially never
 * both under the crosshair. Where they are, the fixture wins, because a fixture
 * is a smaller target and the player who has one centred meant to.
 */

/**
 * @param {HTMLElement|null} el  the real #prompt element, or null when headless
 */
export function createPromptBus(el) {
  /** @type {{name:string, priority:number, text:string, on:boolean, deny:boolean}[]} */
  const channels = [];

  // What was last painted. Compared before writing, because setting textContent
  // on an unchanged string still dirties layout, and this runs every frame.
  let paintedText = null;
  let paintedDeny = null;

  /**
   * Claim a channel. Higher priority wins when more than one has something to
   * say on the same frame.
   */
  function channel(name, priority = 0) {
    const c = { name, priority, text: '', on: false, deny: false };
    channels.push(c);

    return {
      get textContent() { return c.text; },
      set textContent(v) { c.text = v == null ? '' : String(v); },

      classList: {
        toggle(cls, on) {
          if (cls === 'on') c.on = !!on;
          else if (cls === 'deny') c.deny = !!on;
          return !!on;
        },
        contains(cls) {
          if (cls === 'on') return c.on;
          if (cls === 'deny') return c.deny;
          return false;
        },
        add(cls) { this.toggle(cls, true); },
        remove(cls) { this.toggle(cls, false); },
      },

      /** For a harness that wants to know which system is speaking. */
      get state() { return { ...c }; },
    };
  }

  /**
   * Resolve the frame and write it. Called once per frame from the loop, AFTER
   * every system that might want the line has updated.
   */
  function paint() {
    let win = null;
    for (const c of channels) {
      if (!c.on || !c.text) continue;
      if (!win || c.priority > win.priority) win = c;
    }

    const text = win ? win.text : '';
    const deny = win ? win.deny : false;

    if (text === paintedText && deny === paintedDeny) return win;
    paintedText = text;
    paintedDeny = deny;

    if (el) {
      el.textContent = text;
      el.classList.toggle('on', !!text);
      el.classList.toggle('deny', !!deny);
    }

    return win;
  }

  return {
    channel,
    paint,

    /** The line as it currently stands, for the harness. */
    get text() { return paintedText || ''; },
    get deny() { return !!paintedDeny; },
    get speaker() {
      let win = null;
      for (const c of channels) {
        if (!c.on || !c.text) continue;
        if (!win || c.priority > win.priority) win = c;
      }
      return win ? win.name : null;
    },
  };
}
