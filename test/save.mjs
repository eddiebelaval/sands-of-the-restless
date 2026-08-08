/**
 * THE LOCAL SAVE, TESTED WHERE IT ACTUALLY FAILS.
 *
 * The interesting assertions here are not "a value round-trips". They are the
 * three ways a browser store hurts you, all of which this game has to survive
 * without failing to boot:
 *
 *   1. THE STORE THROWS. Safari in private mode throws on setItem and an
 *      embedded page can throw on getItem from a third-party context. A game
 *      that will not start because a volume slider could not be written is a
 *      worse outcome than not having saved settings at all.
 *   2. THE BLOB IS GARBAGE. localStorage is player-writable and outlives builds,
 *      so a saved blob is untrusted input in the same way a query string is.
 *   3. THE SCHEMA MOVED. A save written by a future build must not be half
 *      applied, because a half-restored save puts the player in a state no code
 *      path produced and no report can reproduce.
 *
 * Run in node against a FAKE Storage rather than in a page, because every one of
 * those cases is trivial to construct in a fake and awkward to force in a real
 * browser - and a test that cannot express its own failure case is decoration.
 */

import { createSave } from '../src/core/save.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`PASS  ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

/** A Storage that behaves, and can be told to misbehave. */
function fakeStore(initial) {
  let map = new Map(initial ? Object.entries(initial) : []);
  const s = {
    throwOnRead: false,
    throwOnWrite: false,
    getItem(k) { if (s.throwOnRead) throw new Error('read denied'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (s.throwOnWrite) throw new Error('quota'); map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    raw: () => map,
  };
  return s;
}

const KEY = 'sands.save.v1';
// No window, so the pagehide listeners are skipped. Passing null rather than
// leaving it undefined, which would find the real one under a DOM shim.
const opts = (storage) => ({ storage, win: null });

// --------------------------------------------------------------- round trip
{
  const store = fakeStore();
  const save = createSave(opts(store));
  save.setSetting('sensitivity', 1.75);
  save.setSetting('invert', true);
  save.flush();

  const reopened = createSave(opts(store));
  ok(reopened.getSetting('sensitivity', 0) === 1.75, 'a number setting survives a reload');
  ok(reopened.getSetting('invert', false) === true, 'a boolean setting survives a reload');
  ok(reopened.getSetting('neverSet', 'fallback') === 'fallback',
    'an unset setting answers with the caller\'s own default');
}

// ------------------------------------------------------------------ records
{
  const store = fakeStore();
  const save = createSave(opts(store));

  ok(save.best('bestWave', 12) === true, 'a first record is always a record');
  ok(save.best('bestWave', 9) === false, 'a worse wave does not overwrite a better one');
  ok(save.best('bestWave', 20) === true, 'a better wave does');
  ok(save.getRecord('bestWave') === 20, 'and the better one is what is kept (20)');

  ok(save.least('fastestClear', 900) === true, 'a first time is always a record');
  ok(save.least('fastestClear', 1200) === false, 'a slower clear does not overwrite a faster one');
  ok(save.least('fastestClear', 780) === true, 'a faster one does');
  ok(save.getRecord('fastestClear') === 780, 'and the faster one is kept (780)');

  save.add('erased', 1); save.add('erased', 1); save.add('erased', 1);
  ok(save.getRecord('erased') === 3, 'erasures accumulate across a session (3)');
  save.flush();
  ok(createSave(opts(store)).getRecord('erased') === 3, 'and across a reload');
}

// ------------------------------------------------------------- THE STORE THROWS
{
  const store = fakeStore();
  store.throwOnWrite = true;
  let save = null;
  let threw = false;
  try {
    save = createSave(opts(store));
    save.setSetting('volume', 40);
    save.flush();
  } catch { threw = true; }
  ok(!threw, 'a store that throws on write does not throw out of the save');
  ok(save && save.getSetting('volume', 0) === 40,
    'and the setting still applies in memory for this session');
  ok(save && save.stats().failures > 0, 'the failure is COUNTED rather than swallowed silently');
}
{
  const store = fakeStore();
  store.throwOnRead = true;
  let threw = false;
  let save = null;
  try { save = createSave(opts(store)); } catch { threw = true; }
  ok(!threw, 'a store that throws on read does not throw out of the save');
  ok(save && save.getSetting('sensitivity', 1.0) === 1.0, 'and the player lands on defaults');
}
{
  let threw = false;
  let save = null;
  try { save = createSave({ storage: null, win: null }); save.setSetting('fov', 90); save.flush(); } catch { threw = true; }
  ok(!threw, 'NO storage at all is survivable');
  ok(save && save.getSetting('fov', 0) === 90, 'and settings still work for the session');
}

// ------------------------------------------------------------ THE BLOB IS GARBAGE
{
  const cases = {
    'not json at all': 'this is not json {',
    'json but not an object': '"a string"',
    'json null': 'null',
    'an array': '[1,2,3]',
    'no version': JSON.stringify({ settings: { fov: 90 } }),
    'a version from the future': JSON.stringify({ v: 99, settings: { fov: 90 } }),
    'settings that are not scalars': JSON.stringify({ v: 1, settings: { fov: { nested: true }, ok: 5 } }),
    'a negative record': JSON.stringify({ v: 1, records: { bestWave: -5, good: 7 } }),
    'a NaN record': JSON.stringify({ v: 1, records: { bestWave: null } }),
    'flags that are not booleans': JSON.stringify({ v: 1, flags: { egg: 'yes', real: true } }),
  };

  for (const [label, blob] of Object.entries(cases)) {
    const store = fakeStore({ [KEY]: blob });
    let save = null, threw = false;
    try { save = createSave(opts(store)); } catch { threw = true; }
    ok(!threw, `garbage survives: ${label}`);
  }

  // And the specific rule: partial garbage drops the bad key, keeps the good.
  const mixed = fakeStore({
    [KEY]: JSON.stringify({ v: 1, settings: { fov: { nested: true }, volume: 55 },
      records: { bestWave: -5, kills: 300 }, flags: { egg: 'yes', real: true } }),
  });
  const s = createSave(opts(mixed));
  ok(s.getSetting('fov', 'gone') === 'gone', 'a non-scalar setting is DROPPED');
  ok(s.getSetting('volume', 0) === 55, 'while the valid setting beside it survives');
  ok(s.getRecord('bestWave', 'gone') === 'gone', 'a negative record is dropped');
  ok(s.getRecord('kills') === 300, 'while the valid record beside it survives');
  ok(s.getFlag('egg') === false, 'a non-boolean flag is dropped');
  ok(s.getFlag('real') === true, 'while the valid flag beside it survives');
}

// ------------------------------------------------------------ THE SCHEMA MOVED
{
  const store = fakeStore({ [KEY]: JSON.stringify({ v: 99, settings: { fov: 90 }, records: { bestWave: 25 } }) });
  const save = createSave(opts(store));
  ok(save.getSetting('fov', 'defaults') === 'defaults',
    'a save from a FUTURE schema is not half applied');
  ok(save.getRecord('bestWave', 0) === 0, 'not even the parts that would have parsed');
}

// ------------------------------------------------------------------- coalescing
{
  const store = fakeStore();
  const save = createSave(opts(store));
  for (let i = 0; i < 80; i++) save.setSetting('sensitivity', 0.5 + i * 0.01);
  const before = save.stats().writes;
  save.flush();
  const after = save.stats().writes;
  ok(before === 0, 'a slider sweep does not write once per input event');
  ok(after === 1, 'it collapses to a single write (1)');
  ok(save.stats().coalesced > 50, `and the collapse is counted (${save.stats().coalesced})`);

  // Writing the same value again is not a change and must not schedule a write.
  save.setSetting('sensitivity', save.getSetting('sensitivity', 0));
  ok(save.flush() === false, 'setting a value to what it already is writes nothing');
}

// ------------------------------------------------------------------------ flags
{
  const store = fakeStore();
  const save = createSave(opts(store));
  ok(save.getFlag('worldTwoEgg') === false, 'an unset flag is false, never undefined');
  save.setFlag('worldTwoEgg');
  save.flush();
  ok(createSave(opts(store)).getFlag('worldTwoEgg') === true,
    'a flag survives a reload, which is what World 2\'s Easter egg needs');
}

console.log('');
console.log(fail === 0 ? `ALL CHECKS PASSED (${pass})` : `${fail} FAILED of ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
