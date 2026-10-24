import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORS } from '../../shared/anchors';
import { COUNTDOWN, DEPLOY_DELAY, MATCH_SECONDS, TICK_HZ } from '../../shared/arena';
import { LocalMatch } from './local';

const golem = ANCHORS.find(a => a.name === 'Stone Golem')!;
const run = (m: LocalMatch, seconds: number) => {
  for (let i = 0; i < seconds * TICK_HZ; i++) m.tick();
};

test('player deploys follow the server rules', async () => {
  const m = new LocalMatch('normal', undefined, false);
  await assert.rejects(m.beginDeploy(9, 4, 6), /match starting/);
  run(m, COUNTDOWN);
  await assert.rejects(m.deployTroop(1, 9, 5, '', golem), /not enough elixir: 7/);
  await assert.rejects(m.deployTroop(1, 9, 5, '', { ...golem, damage: 600, count: 4 }), /too expensive: \d+/);
  await assert.rejects(m.beginDeploy(2, 9, 20), /own half/);
  await m.beginDeploy(3, 4, 6);
  assert.equal(m.pendings().length, 1);
  run(m, 1);
  await m.deployTroop(3, 9, 9, '', ANCHORS[0]);
  const mine = m.units().filter(u => u.side === 0);
  assert.equal(mine.length, 1);
  assert.deepEqual([mine[0].x, mine[0].y], [4, 6], 'lands at the locked spot');
  assert.ok(Math.abs(mine[0].delay - (DEPLOY_DELAY - 1)) < 1e-9, 'delay counts from the lock');
  assert.equal(m.troops().get(mine[0].troopId)?.name, 'Goblin Scrapper');
});

test('the bot plays a full match against an idle player and wins', async () => {
  const m = new LocalMatch('normal', undefined, false);
  let bot = 0, sawLock = false;
  for (let i = 0; i < (COUNTDOWN + MATCH_SECONDS + 1) * TICK_HZ && m.status === 'playing'; i++) {
    m.tick();
    sawLock ||= m.pendings().some(p => p.side === 1);
    bot = Math.max(bot, m.units().filter(u => u.side === 1).length);
  }
  assert.ok(sawLock, 'bot drops are telegraphed by a lock');
  assert.ok(bot > 0, 'bot deployed');
  assert.equal(m.status, 'done');
  assert.equal(m.winner, 1);
  await m.rematch();
  assert.equal(m.status, 'playing');
  assert.equal(m.time, -COUNTDOWN);
  assert.equal(m.units().length, 0);
});
