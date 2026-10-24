import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDelta, emberDelta, rankOf } from './embers';
import { reasons, type RoundSummary } from './chronicle';

test('ranks climb with points', () => {
  assert.deepEqual(rankOf(0), { name: 'Bronze', next: 'Silver', nextAt: 100 });
  assert.equal(rankOf(99).name, 'Bronze');
  assert.equal(rankOf(100).name, 'Silver');
  assert.deepEqual(rankOf(5000), { name: 'Diamond', next: null, nextAt: null });
});

test('wins add points, losses take some, never below zero', () => {
  assert.equal(emberDelta('win', 'online'), 30);
  assert.equal(emberDelta('lose', 'normal'), -10);
  assert.equal(emberDelta('draw', 'hard'), 0);
  assert.equal(applyDelta(4, -10), 0);
});

const base: RoundSummary = {
  outcome: 'win', forfeit: false, towersTaken: 2, towersLost: 0, theirKingDown: false, myKingDown: false,
  myKingStruck: false, theirKingFellAt: null, myKingFellAt: null, cappedSecs: 0, endedAt: 90, myBest: { name: 'Fire Wizard', damage: 2310 }, theirBest: null,
};

test('a win on towers explains itself', () => {
  assert.deepEqual(reasons(base), ['You took both princess towers', 'You held more towers when time ran out', 'Your king tower was never struck']);
});

test('a loss names the king tower and the troop that did it', () => {
  const r = reasons({ ...base, outcome: 'lose', towersTaken: 1, towersLost: 3, myKingDown: true, myKingFellAt: 38, cappedSecs: 14, theirBest: { name: 'Stone Golem', towerDamage: 3100 } });
  assert.deepEqual(r, ['Your king tower fell at 0:38', 'Their Stone Golem did 3,100 to your towers', 'You sat on full embers for 14 s']);
});

test('overtime and tiebreaker finishes lead the reasons', () => {
  assert.equal(reasons({ ...base, towersTaken: 1, endedAt: 104 })[0], 'You took the first tower in overtime');
  assert.equal(reasons({ ...base, outcome: 'lose', towersTaken: 0, towersLost: 1, endedAt: 121.5 })[0], 'Your weakest tower fell first in the tiebreaker');
  assert.equal(reasons({ ...base, outcome: 'draw', towersTaken: 1, towersLost: 1, endedAt: 122 })[0], 'Both weakest towers fell together in the tiebreaker');
});

test('a forfeit says so first', () => {
  assert.equal(reasons({ ...base, forfeit: true, towersTaken: 0 })[0], 'Your opponent forfeited');
});
