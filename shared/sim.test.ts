import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORS } from './anchors';
import { DEPLOY_DELAY, LANE_X, MATCH_SECONDS, TICK_HZ, formation, type Side } from './arena';
import { newMatch, step, type SimState } from './sim';
import { MAX_COST, clampStats, price, sanitizeDesign, type TroopStats } from './troop';

let nextId = 1000;
function spawn(s: SimState, side: Side, stats: TroopStats, x: number, y: number) {
  for (const [dx, dy] of formation(stats.count)) {
    s.units.push({
      id: nextId++, side, x: x + dx, y: y + dy, hp: stats.health, maxHp: stats.health, damage: stats.damage,
      attackSpeed: stats.attack_speed, moveSpeed: stats.move_speed, range: stats.range,
      cooldown: 0, delay: DEPLOY_DELAY, attackSeq: 0,
    });
  }
}
function run(s: SimState, seconds: number) {
  let r = step(s, 0);
  for (let i = 0; i < seconds * TICK_HZ && !r.over; i++) r = step(s, 1 / TICK_HZ);
  return r;
}

test('anchors price at their listed costs', () => {
  for (const a of ANCHORS) assert.equal(price(a), a.cost, a.name);
});

test('anchor stats sit inside the clamps', () => {
  for (const a of ANCHORS) {
    const c = clampStats(a);
    for (const k of ['health', 'damage', 'attack_speed', 'move_speed', 'range', 'count'] as const) {
      assert.equal(c[k], a[k], `${a.name}.${k}`);
    }
  }
});

test('clamps stop absurd stats and garbage', () => {
  const s = clampStats({ health: 99999, damage: -5, attack_speed: NaN, move_speed: 9, range: 0.2, count: 1000 });
  assert.deepEqual(s, { health: 3000, damage: 10, attack_speed: 0.3, move_speed: 2, range: 1, count: 12 });
  assert.ok(price(s) > MAX_COST);
});

test('sanitizeDesign trims the cry and fixes a bad voice', () => {
  const d = sanitizeDesign({ name: 'A Very Long Troop Name', battle_cry: 'one two three four five six seven eight nine', voice_style: 'opera' as never });
  assert.equal(d.name, 'A Very Long');
  assert.equal(d.battle_cry.split(' ').length, 8);
  assert.equal(d.voice_style, 'cheerful_hero');
});

test('units wait out the deploy delay, then walk at the enemy tower', () => {
  const s = newMatch();
  spawn(s, 0, ANCHORS[0], LANE_X[0], 10);
  run(s, DEPLOY_DELAY - 0.2);
  assert.equal(s.units[0].y, 10);
  run(s, 1);
  assert.ok(s.units[0].y > 10);
});

test('an unopposed golem takes a side tower and wins', () => {
  const s = newMatch();
  const golem = ANCHORS.find(a => a.name === 'Stone Golem')!;
  spawn(s, 0, golem, LANE_X[0], 12);
  const r = run(s, MATCH_SECONDS + 1);
  assert.ok(r.over);
  assert.equal(r.winner, 0);
  assert.ok(s.towers.some(t => t.side === 1 && t.hp === 0));
});

test('an empty match is a draw at 90 s', () => {
  const s = newMatch();
  const r = run(s, MATCH_SECONDS + 1);
  assert.ok(r.over);
  assert.equal(r.winner, -1);
  assert.equal(s.elixir[0], 10);
});

test('opposing troops fight each other before the towers', () => {
  const s = newMatch();
  spawn(s, 0, ANCHORS.find(a => a.name === 'Shield Knight')!, LANE_X[0], 13);
  spawn(s, 1, ANCHORS.find(a => a.name === 'Goblin Scrapper')!, LANE_X[0], 17);
  run(s, 15);
  assert.equal(s.units.filter(u => u.side === 1).length, 0, 'goblin should lose to the knight');
  assert.equal(s.towers.filter(t => t.hp < t.maxHp && t.side === 0).length, 0);
});
