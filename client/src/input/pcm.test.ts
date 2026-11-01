import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechSpan } from './pcm';

const quiet = (n: number) => Array(n).fill(0.002);

test('a phrase in seconds of silence is cut out, with a little either side', () => {
  const rms = [...quiet(40), 0.05, 0.08, 0.06, 0.07, 0.04, ...quiet(40)];
  assert.deepEqual(speechSpan(rms, 0.004), [37, 50]);
});

test('a quiet voice still counts; the room under it does not', () => {
  const rms = [...quiet(20), 0.012, 0.015, 0.011, ...quiet(20)];
  assert.deepEqual(speechSpan(rms, 0.004), [17, 28]);
});

test('a pause inside the phrase stays in', () => {
  const rms = [...quiet(10), 0.06, 0.05, ...quiet(8), 0.07, ...quiet(10)];
  const [a, b] = speechSpan(rms, 0.004)!;
  assert.equal(a, 7);
  assert.equal(b, 26);
});

test('nothing but the room is nothing', () => {
  assert.equal(speechSpan(quiet(60), 0.004), null);
});

test('speech at the very edges is kept whole', () => {
  assert.deepEqual(speechSpan([0.05, 0.06, ...quiet(5), 0.05], 0.004), [0, 8]);
});
