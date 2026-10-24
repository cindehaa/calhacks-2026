import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORS } from './anchors';
import { priceDeploy } from './deploy';
import { PRICING, power, quirkMultiplier } from './troop';
import { decodeMode, detailOf, empower, quote } from './wordpower';

const LONG = 'Dragon with laser eyes, blue wings, and reinforced claws';

test('detail: plain nouns are 0, describing words count, hype and repeats do not', () => {
  assert.equal(detailOf('dragon'), 0);
  assert.equal(detailOf('a dragon'), 0);
  assert.equal(detailOf(LONG), 6);
  assert.equal(detailOf('the strongest most powerful dragon ever'), 0);
  assert.equal(detailOf('dragon dragon dragon'), 0);
  assert.equal(detailOf('big red angry dragon', 'features'), 0);
  assert.equal(detailOf(LONG, 'features'), 6);
});

test('empower rescales any design to the budget, so the noun stops mattering', () => {
  for (const a of ANCHORS) {
    const d = empower(a, 6);
    const worth = (power(d, PRICING) * quirkMultiplier(d)) / PRICING.K;
    assert.ok(Math.abs(worth - 6) < 0.35, `${a.name} came out at ${worth.toFixed(2)}`);
    assert.equal(d.count, a.count);
  }
});

test('free presets charge nothing; cap mode charges the budget, capped by elixir', () => {
  const golem = ANCHORS.find(a => a.name === 'Stone Golem')!;
  const lock = priceDeploy(golem, 0, LONG, decodeMode('cooldown'));
  assert.equal(lock.error, null);
  assert.equal(lock.charge, 0);
  assert.equal(lock.cost, 9);
  assert.equal(lock.quote!.cooldown, 0.75 * 9);
  const cap = priceDeploy(golem, 6.5, LONG, decodeMode('cap'));
  assert.deepEqual([cap.cost, cap.charge, cap.error], [6, 6, null]);
  assert.equal(quote('dragon', decodeMode('cap'), 0.5).error, 'not enough elixir: 1');
});
