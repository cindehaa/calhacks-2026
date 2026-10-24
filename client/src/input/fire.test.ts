import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseDescription, fireWaits, RECENT_SPEECH_MS, routeWords, Transcript } from './speech';

test('words split at the fire: before the cut is the troop, after it the next one', () => {
  // Fired at the end of epoch 3 (the cut); nothing spent before it.
  assert.equal(routeWords(3, 3, -1), 'firing'); // the last words, finalised after the fire
  assert.equal(routeWords(2, 3, -1), 'firing'); // an earlier utterance's late final
  assert.equal(routeWords(4, 3, -1), 'prompt'); // said after the fire
  // Landed: the cut is spent, so a final that missed the cap doesn't leak into the next troop.
  assert.equal(routeWords(3, null, 3), 'drop');
  assert.equal(routeWords(4, null, 3), 'prompt');
});

test('a fire keeps the partial and the final of its epoch, the next troop keeps its own', () => {
  const troop = new Transcript(), next = new Transcript();
  troop.final('a fire', 2);
  troop.interim('dragon', 3); // partial when the fire happened
  next.interim('an ice', 4); // already talking about the next one
  assert.equal(troop.text, 'a fire dragon');
  troop.final('dragon.', 3); // flush_done brings the final, replacing the partial
  assert.equal(troop.text, 'a fire dragon.');
  assert.equal(next.text, 'an ice');
});

test('partials from two epochs both count, in order, whichever arrives last', () => {
  const t = new Transcript();
  t.interim('golem', 5);
  t.interim('a giant', 4); // the old socket, still finalising, reports late
  assert.equal(t.text, 'a giant golem');
  t.final('a giant', 4);
  assert.equal(t.text, 'a giant golem');
  t.interim('', 5);
  assert.ok(!t.pending);
  assert.equal(t.text, 'a giant');
});

test('past the cap the partial text deploys; only no words at all misses', () => {
  const t = new Transcript();
  t.interim('a fire drag', 1); // the final never came
  assert.deepEqual(chooseDescription('', t.text), { ok: true, text: 'a fire drag', from: 'voice' });
  assert.deepEqual(chooseDescription('', new Transcript().text), { ok: false, reason: 'empty' });
});

test('a fire with no words yet waits only if the mic just heard speech that began since the last fire', () => {
  const base = { said: '', typed: '', listening: true, spokeSinceFire: true };
  assert.ok(fireWaits({ ...base, msSinceSpeech: 0 })); // still talking, no transcript yet
  assert.ok(fireWaits({ ...base, msSinceSpeech: RECENT_SPEECH_MS }));
  assert.ok(!fireWaits({ ...base, msSinceSpeech: RECENT_SPEECH_MS + 1 })); // silence: didn't catch that
  assert.ok(!fireWaits({ ...base, listening: false, msSinceSpeech: 0 }));
  assert.ok(!fireWaits({ ...base, spokeSinceFire: false, msSinceSpeech: 0 })); // room noise, or a second pinch
  assert.ok(fireWaits({ ...base, spokeSinceFire: false, said: 'a giant', msSinceSpeech: 0 }));
  assert.ok(fireWaits({ ...base, said: 'a giant', msSinceSpeech: Infinity }));
  assert.ok(fireWaits({ ...base, typed: 'ice golem', listening: false, msSinceSpeech: Infinity }));
});

test('Cartesia segments join as-is, so a word split across finals stays whole', () => {
  const t = new Transcript();
  t.final(' a necrom', 1);
  t.final('ancer', 1);
  t.interim(' with a', 1);
  assert.equal(t.text, 'a necromancer with a');
  t.final(' with a staff', 1);
  t.final('a fire', 2); // a new socket's first segment has no leading space: epochs get one
  assert.equal(t.text, 'a necromancer with a staff a fire');
});

test('browser recogniser results carry a leading space, so they never run together', () => {
  const t = new Transcript();
  t.final(' a giant', 0);
  t.final(' frog', 0);
  t.interim(' with a hat', 0);
  assert.equal(t.text, 'a giant frog with a hat');
});
