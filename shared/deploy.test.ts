import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORS } from './anchors';
import { ARENA_H, DEPLOY_DELAY, MID_Y, MIN_DEPLOY_DELAY, RIVER_HALF, canDeploy, onOwnHalf } from './arena';
import { arrivalDelay, priceDeploy, unitSpots } from './deploy';
import { newMatch } from './sim';

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
    for (const [, y] of spots) {
      assert.ok(onOwnHalf(side, y), `side ${side} y ${y}`);
      assert.ok(Math.abs(y - MID_Y) >= RIVER_HALF, `side ${side} y ${y} is in the river`);
    }
  }
});

test('anywhere on your half is fair game; the pocket opens when a princess tower falls', () => {
  const { towers } = newMatch();
  assert.ok(canDeploy(0, 9, 8, towers), 'mid-board, between the bridges');
  assert.ok(canDeploy(0, 0.6, 1, towers), 'back corner');
  assert.ok(!canDeploy(0, 3, MID_Y + 3, towers), 'enemy half, towers standing');
  towers.find(t => t.side === 1 && t.lane === 0)!.hp = 0;
  assert.ok(canDeploy(0, 3, MID_Y + 3, towers), 'left pocket open');
  assert.ok(!canDeploy(0, 15, MID_Y + 3, towers), 'right side still closed');
  assert.ok(!canDeploy(0, 3, ARENA_H - 2, towers), 'not past the princess tower row');
  for (const [x, y] of unitSpots(0, 1, MID_Y + 1.5, 8, towers)) {
    assert.ok(x < 9 && y > MID_Y + RIVER_HALF && y < ARENA_H - 6, `${x.toFixed(2)}, ${y.toFixed(2)} left the pocket`);
  }
});
