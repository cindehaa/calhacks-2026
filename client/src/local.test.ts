import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORS } from '../../shared/anchors';
import { DEPLOY_DELAY, MATCH_START, MATCH_SECONDS, MID_Y, TICK_HZ } from '../../shared/arena';
import { designOfflineSpell } from '../../shared/offline_spell';
import { LocalMatch } from './local';

const golem = ANCHORS.find(a => a.name === 'Stone Golem')!;
const run = (m: LocalMatch, seconds: number) => {
  for (let i = 0; i < seconds * TICK_HZ; i++) m.tick();
};

test('player deploys follow the server rules', async () => {
  const m = new LocalMatch('normal', undefined, false);
  await assert.rejects(m.beginDeploy(9, 4, 6), /match starting/);
  run(m, -MATCH_START);
  await assert.rejects(m.deployTroop(1, 9, 5, '', golem), new RegExp(`not enough elixir: ${golem.cost}`));
  await assert.rejects(m.deployTroop(1, 9, 5, '', { ...golem, damage: 600, count: 4 }), /too expensive: \d+/);
  await assert.rejects(m.beginDeploy(2, 9, 40), /off the board/);
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
  for (let i = 0; i < (MATCH_SECONDS - MATCH_START + 1) * TICK_HZ && m.status === 'playing'; i++) {
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
  assert.equal(m.time, MATCH_START);
  assert.equal(m.units().length, 0);
});

test('spells land past your half; a troop aimed there snaps back to your side', async () => {
  const m = new LocalMatch('normal', undefined, false);
  run(m, -MATCH_START + 3); // embers for both
  const fireball = designOfflineSpell('a fireball');
  await m.beginDeploy(1, 9, 22); // the enemy half
  await m.deployTroop(1, 0, 0, 'a fireball', fireball);
  const [s] = m.spells();
  assert.deepEqual([s.x, s.y, s.side, s.effect], [9, 22, 0, 'blast'], 'cast where it was aimed');
  assert.equal(s.name, fireball.name);
  assert.ok(m.units().every(u => u.side !== 0), 'a spell has no body');
  run(m, DEPLOY_DELAY + 1);
  assert.equal(m.spells().length, 0, 'gone once it has played out');

  await m.beginDeploy(2, 9, 22);
  await m.deployTroop(2, 0, 0, '', ANCHORS[0]);
  const mine = m.units().filter(u => u.side === 0);
  assert.equal(mine.length, 1);
  assert.ok(mine[0].y < MID_Y, 'the troop landed on your half');
});
