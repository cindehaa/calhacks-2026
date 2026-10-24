import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORS } from '../shared/anchors';
import { PRICING, price } from '../shared/troop';
import { PLACEMENTS, duel, prepare } from './harness';
import { fairCost, flag, matchCounts, median, trade, tradeRatio, valuePerElixir } from './metrics';

test('matchCounts spends about the same elixir on both sides', () => {
  assert.deepEqual(matchCounts(4, 4), [1, 1]);
  assert.deepEqual(matchCounts(2, 7), [7, 2]); // 14 v 14
  assert.deepEqual(matchCounts(3, 7), [5, 2]); // 15 v 14 beats 6 v 7
  assert.deepEqual(matchCounts(2, 10, 20, 12), [5, 1]); // a 12-body swarm stops at 60 bodies
});

test('trade values a troop by the share of its HP left', () => {
  const t = trade({ spent: 6, maxHp: 1000, hpLeft: 500 }, { spent: 7, maxHp: 3000, hpLeft: 0 });
  assert.deepEqual(t, { destroyed: 7, lost: 3, spent: 6 });
  assert.equal(tradeRatio([t]), 7 / 3);
  assert.equal(valuePerElixir([t]), 4 / 6);
  // Untouched troops get a finite ratio: losses are floored at 5% of spend.
  assert.equal(tradeRatio([{ destroyed: 4, lost: 0, spent: 4 }]), 20);
});

test('median, fair cost and flags', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(fairCost(4, 4, 1), 8);
  assert.equal(flag(1.6, 1), 'strong');
  assert.equal(flag(0.6, 1), 'weak');
  assert.equal(flag(1.2, 1), null);
});

test('harness prices like the game and fights deterministically', () => {
  for (const a of ANCHORS) assert.equal(prepare(a, PRICING).cost, price(a), a.name);
  assert.ok(prepare({ name: 'god', health: 3000, damage: 600, attack_speed: 3, move_speed: 2, range: 6, count: 12 }, PRICING).rejected);
  const knight = prepare(ANCHORS.find(a => a.name === 'Shield Knight')!, PRICING);
  const goblin = prepare(ANCHORS.find(a => a.name === 'Goblin Scrapper')!, PRICING);
  const r1 = duel(knight, 1, goblin, 1, PLACEMENTS[0], 60);
  const r2 = duel(knight, 1, goblin, 1, PLACEMENTS[0], 60);
  assert.equal(r1.winner, 'a');
  assert.deepEqual(r1, r2);
});
