import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANCHORS } from '../../shared/anchors';
import { price } from '../../shared/troop';
import { deal, exactCost } from './value';

test('exactCost rounds to the price the game charges', () => {
  for (const a of ANCHORS) assert.equal(Math.max(1, Math.round(exactCost(a))), price(a), a.name);
});

test('deal reads the rounding: down is a bargain, up is pricey', () => {
  assert.equal(deal(4, 4.4), 'bargain');
  assert.equal(deal(4, 3.6), 'pricey');
  assert.equal(deal(4, 4.1), 'fair');
  assert.equal(deal(1, 0.3), 'pricey'); // the floor of 1
  assert.equal(deal(3, undefined), 'fair');
});
