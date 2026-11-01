import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoachRules } from './coachrules';

// Tick every 100 ms from t0 to t1; the rules that fired, with when.
function ticks(c: CoachRules, t0: number, t1: number, playing = true): [number, string][] {
  const out: [number, string][] = [];
  for (let t = t0; t <= t1; t += 100) {
    const r = c.tick(t, playing);
    if (r) out.push([t, r]);
  }
  return out;
}

test('a hand up with no pinch for 12 s gets the idle hint', () => {
  const c = new CoachRules();
  c.hand(0, true);
  assert.deepEqual(ticks(c, 0, 12_500), [[12_000, 'idle']]);
});

test('pinching keeps the idle hint away', () => {
  const c = new CoachRules();
  c.hand(0, true);
  ticks(c, 0, 8000);
  c.pinch(8000);
  assert.deepEqual(ticks(c, 8000, 19_000), []);
});

test('no hand, no idle hint', () => {
  const c = new CoachRules();
  assert.deepEqual(ticks(c, 0, 20_000), []);
});

test('talking twice without a pinch says pinch first', () => {
  const c = new CoachRules();
  c.hand(0, true);
  c.pinch(0);
  c.ignoredWords(1000);
  assert.deepEqual(ticks(c, 0, 2000), []);
  assert.deepEqual(ticks(c, 2100, 2900), []);
  c.ignoredWords(3000);
  assert.deepEqual(ticks(c, 3000, 3500), [[3000, 'talkNoPinch']]);
});

test('the hand leaving three times in 20 s', () => {
  const c = new CoachRules();
  const fired: [number, string][] = [];
  for (const t of [1000, 3000, 5000]) {
    c.hand(t - 500, true);
    c.hand(t, false);
    fired.push(...ticks(c, t, t + 1900));
  }
  assert.deepEqual(fired, [[5000, 'handFlaky']]);
});

test('bad framing held for 3 s', () => {
  const c = new CoachRules();
  c.hand(0, true);
  c.pinch(0);
  c.framing(1000, 'closer');
  assert.deepEqual(ticks(c, 0, 4500), [[4000, 'framing']]);
  assert.equal(c.currentAdvice, 'closer');
});

test('each rule shows at most twice, with gaps between hints', () => {
  const c = new CoachRules();
  c.hand(0, true);
  const fired = ticks(c, 0, 120_000).filter(([, r]) => r === 'idle');
  assert.equal(fired.length, 2);
  assert.ok(fired[1][0] - fired[0][0] >= 12_000);
});

test('nothing while not playing', () => {
  const c = new CoachRules();
  c.hand(0, true);
  assert.deepEqual(ticks(c, 0, 30_000, false), []);
});
