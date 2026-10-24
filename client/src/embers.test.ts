import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDelta, emberDelta, rankOf } from './embers';

test('ranks climb with points', () => {
  assert.deepEqual(rankOf(0), { name: 'Bronze', next: 'Silver', nextAt: 100 });
  assert.equal(rankOf(99).name, 'Bronze');
  assert.equal(rankOf(100).name, 'Silver');
  assert.deepEqual(rankOf(5000), { name: 'Diamond', next: null, nextAt: null });
});

test('every round adds points, a win most, then a draw, then a loss', () => {
  for (const vs of ['online', 'easy', 'normal', 'hard'] as const) {
    const [w, d, l] = (['win', 'draw', 'lose'] as const).map(o => emberDelta(o, vs));
    assert.ok(w > d && d > l && l > 0, vs);
  }
  assert.equal(emberDelta('win', 'online'), 30);
  assert.equal(applyDelta(4, -10), 0);
});
