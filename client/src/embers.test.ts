import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDelta, emberDelta, rankOf } from './embers';
import { reasons, type RoundSummary } from './chronicle';

test('ranks climb with embers', () => {
  assert.deepEqual(rankOf(0), { name: 'Cinder', next: 'Kindling', nextAt: 100 });
  assert.equal(rankOf(99).name, 'Cinder');
  assert.equal(rankOf(100).name, 'Kindling');
  assert.deepEqual(rankOf(5000), { name: 'Beacon', next: null, nextAt: null });
});

test('wins add embers, losses give them to the frost, never below zero', () => {
  assert.equal(emberDelta('win', 'online'), 30);
  assert.equal(emberDelta('lose', 'normal'), -10);
  assert.equal(emberDelta('draw', 'hard'), 0);
  assert.equal(applyDelta(4, -10), 0);
});

const base: RoundSummary = {
  outcome: 'win', forfeit: false, towersTaken: 2, towersLost: 0, theirKingDown: false, myKingDown: false,
  myKingStruck: false, theirKingFellAt: null, myKingFellAt: null, cappedSecs: 0, myBest: { name: 'Fire Wizard', damage: 2310 }, theirBest: null,
};

test('a win on towers explains itself', () => {
  assert.deepEqual(reasons(base), ['You took both princess towers', 'You held more towers when time ran out', 'Your king tower was never struck']);
});

test('a loss names the king tower and the troop that did it', () => {
  const r = reasons({ ...base, outcome: 'lose', towersTaken: 1, towersLost: 3, myKingDown: true, myKingFellAt: 38, cappedSecs: 14, theirBest: { name: 'Stone Golem', towerDamage: 3100 } });
  assert.deepEqual(r, ['Your king tower fell at 0:38', 'Their Stone Golem did 3,100 to your towers', 'You sat on full elixir for 14 s']);
});

test('a forfeit says so first', () => {
  assert.equal(reasons({ ...base, forfeit: true, towersTaken: 0 })[0], 'Your foe yielded the field');
});
