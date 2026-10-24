import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORS } from './anchors';
import { BRIDGE_HALF, BRIDGE_X, DEPLOY_DELAY, KING_LANE, MATCH_SECONDS, MID_Y, RIVER_HALF, TICK_HZ, formation, type Side } from './arena';
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
  spawn(s, 0, ANCHORS[0], BRIDGE_X[0], 10);
  run(s, DEPLOY_DELAY - 0.2);
  assert.equal(s.units[0].y, 10);
  run(s, 1);
  assert.ok(s.units[0].y > 10);
});

test('an unopposed golem takes a princess tower and wins', () => {
  const s = newMatch();
  const golem = ANCHORS.find(a => a.name === 'Stone Golem')!;
  spawn(s, 0, golem, BRIDGE_X[0], 12);
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
  spawn(s, 0, ANCHORS.find(a => a.name === 'Shield Knight')!, BRIDGE_X[0], 13);
  spawn(s, 1, ANCHORS.find(a => a.name === 'Goblin Scrapper')!, BRIDGE_X[0], 17);
  run(s, 15);
  assert.equal(s.units.filter(u => u.side === 1).length, 0, 'goblin should lose to the knight');
  assert.equal(s.towers.filter(t => t.hp < t.maxHp && t.side === 0).length, 0);
});

test('the pre-match countdown freezes elixir and units', () => {
  const s = newMatch();
  s.time = -3;
  spawn(s, 0, ANCHORS[0], BRIDGE_X[0], 10);
  run(s, 2.9);
  assert.ok(s.time < 0 && s.time > -0.2);
  assert.equal(s.elixir[0], 5);
  assert.equal(s.units[0].delay, DEPLOY_DELAY);
  run(s, 1);
  assert.ok(s.time > 0.8 && s.elixir[0] > 5);
});

test('troops cross the river only on a bridge', () => {
  const s = newMatch();
  spawn(s, 0, ANCHORS.find(a => a.name === 'Stone Golem')!, 9, 10); // mid-board, between the bridges
  const u = s.units[0];
  let crossedAt: number | null = null;
  for (let i = 0; i < 30 * TICK_HZ && u.hp > 0; i++) {
    step(s, 1 / TICK_HZ);
    if (Math.abs(u.y - MID_Y) < RIVER_HALF) {
      assert.ok(BRIDGE_X.some(bx => Math.abs(u.x - bx) <= BRIDGE_HALF), `in the water at x ${u.x.toFixed(2)}`);
      crossedAt ??= u.x;
    }
  }
  assert.notEqual(crossedAt, null, 'should have crossed');
  assert.ok(u.y > MID_Y + RIVER_HALF);
});

test('the king sleeps until a princess tower falls, and losing it ends the match', () => {
  const s = newMatch();
  const king = s.towers.find(t => t.side === 1 && t.lane === KING_LANE)!;
  assert.ok(king.maxHp > s.towers.find(t => t.lane !== KING_LANE)!.maxHp);
  // A unit standing in the king's range, out of the princess towers' range.
  spawn(s, 0, ANCHORS.find(a => a.name === 'Stone Golem')!, king.x, king.y + 2); // behind the king
  s.units[0].delay = 0;
  s.units[0].damage = 0;
  s.units[0].moveSpeed = 0;
  run(s, 3);
  assert.equal(s.units[0].hp, s.units[0].maxHp, 'a sleeping king does not shoot');
  s.towers.find(t => t.side === 1 && t.lane === 0)!.hp = 0;
  run(s, 2);
  assert.ok(s.units[0].hp < s.units[0].maxHp, 'the king wakes when a princess tower falls');

  king.hp = 1;
  s.units[0].damage = 100;
  const r = run(s, 5);
  assert.ok(r.over);
  assert.equal(r.winner, 0);
  assert.ok(s.towers.filter(t => t.side === 1).every(t => t.hp === 0), 'the king takes its side down with it');
});
