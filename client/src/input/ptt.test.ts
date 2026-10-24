import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PreRoll } from './ptt';

test('pre-roll keeps only the newest chunks and empties on take', () => {
  const p = new PreRoll<number>(3);
  for (let i = 1; i <= 5; i++) p.push(i);
  assert.equal(p.size, 3);
  assert.deepEqual(p.take(), [3, 4, 5]);
  assert.deepEqual(p.take(), []);
  p.push(9);
  p.clear();
  assert.equal(p.size, 0);
});
