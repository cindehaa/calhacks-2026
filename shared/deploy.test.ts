import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORS } from './anchors';
import { DEPLOY_DELAY, MID_Y, MIN_DEPLOY_DELAY, onOwnHalf } from './arena';
import { arrivalDelay, priceDeploy, unitSpots } from './deploy';

const golem = ANCHORS.find(a => a.name === 'Stone Golem')!;

test('priceDeploy re-prices and accepts what you can afford', () => {
  const r = priceDeploy(golem, golem.cost);
  assert.equal(r.cost, golem.cost);
  assert.equal(r.error, null);
});

test('priceDeploy rejects with the messages the client parses', () => {
  assert.equal(priceDeploy(golem, golem.cost - 0.1).error, `not enough elixir: ${golem.cost}`);
  const r = priceDeploy({ ...golem, damage: 600, count: 3 }, 10);
  assert.match(r.error!, /^too expensive: \d+$/);
});

test('priceDeploy clamps stats a client made up', () => {
  const r = priceDeploy({ ...golem, health: 1e9, range: 0 }, 10);
  assert.equal(r.design.health, 3000);
  assert.equal(r.design.range, 1);
});

test('arrivalDelay counts from the lock, with a floor', () => {
  assert.equal(arrivalDelay(0), DEPLOY_DELAY);
  assert.equal(arrivalDelay(1), DEPLOY_DELAY - 1);
  assert.equal(arrivalDelay(10), MIN_DEPLOY_DELAY);
});

test('unitSpots keeps a swarm on its own half, even at the river', () => {
  for (const side of [0, 1] as const) {
    const spots = unitSpots(side, 9, MID_Y + (side ? 0.5 : -0.5), 8);
    assert.equal(spots.length, 8);
    for (const [, y] of spots) assert.ok(onOwnHalf(side, y), `side ${side} y ${y}`);
  }
});
