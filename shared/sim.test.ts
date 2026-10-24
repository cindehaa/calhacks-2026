import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORS } from './anchors';
import { DEPLOY_DELAY, LANE_X, MATCH_SECONDS, TICK_HZ, formation, type Side } from './arena';
import { newMatch, newUnit, step, type SimState } from './sim';
import { MAX_COST, clampStats, price, sanitizeDesign, type TroopStats } from './troop';

let nextId = 1000;
function spawn(s: SimState, side: Side, stats: TroopStats, x: number, y: number) {
  for (const [dx, dy] of formation(stats.count)) {
    s.units.push(newUnit(nextId++, side, x + dx, y + dy, stats, DEPLOY_DELAY));
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

test('the pre-match countdown freezes elixir and units', () => {
  const s = newMatch();
  s.time = -3;
  spawn(s, 0, ANCHORS[0], LANE_X[0], 10);
  run(s, 2.9);
  assert.ok(s.time < 0 && s.time > -0.2);
  assert.equal(s.elixir[0], 5);
  assert.equal(s.units[0].delay, DEPLOY_DELAY);
  run(s, 1);
  assert.ok(s.time > 0.8 && s.elixir[0] > 5);
});

// Tier 1 quirks. One attacker on side 0, dummies on side 1 that barely hit back.
const dummy = { health: 1000, damage: 10, attack_speed: 1, move_speed: 0.3, range: 1 };
function quirkFight(attacker: Parameters<typeof newUnit>[4], dummies: [number, number][], ax = 9, ay = 10) {
  const s = newMatch();
  s.units.push(newUnit(1, 0, ax, ay, attacker, 0));
  dummies.forEach(([x, y], i) => s.units.push(newUnit(10 + i, 1, x, y, dummy, 0)));
  step(s, 1 / TICK_HZ);
  return { s, a: s.units[0], hp: dummies.map((_, i) => s.units.find(u => u.id === 10 + i)!.hp) };
}
const shooter = { health: 1000, damage: 100, attack_speed: 1, move_speed: 1, range: 3 };

test('splash hits everyone within a tile of the target', () => {
  const { hp, a } = quirkFight({ ...shooter, attack: 'splash' }, [[9, 13], [9.6, 13.5], [9, 16]]);
  assert.deepEqual(hp, [900, 900, 1000]);
  assert.deepEqual([a.lastTargetX, a.lastTargetY], [9, 13]);
});

test('breath hits a 60° cone out to its range', () => {
  const { hp } = quirkFight({ ...shooter, attack: 'breath' }, [[9, 12.2], [9.8, 12.8], [11.5, 10]]);
  assert.deepEqual(hp, [900, 900, 1000]);
});

test('chain jumps to 3 more targets for 75% each', () => {
  const { hp, a } = quirkFight({ ...shooter, range: 5, attack: 'chain' }, [[9, 12], [9, 13.5], [9, 15], [9, 16.5], [9, 18]], 9, 8);
  assert.deepEqual(hp.map(h => Math.round((1000 - h) * 100) / 100), [100, 75, 56.25, 42.19, 0]);
  assert.deepEqual(a.chainYs, [13.5, 15, 16.5]);
  assert.equal(a.attackSeq, 1);
});

test('targets: buildings ignores units and walks to a tower', () => {
  const ram = { health: 3000, damage: 300, attack_speed: 1, move_speed: 1, range: 1 };
  assert.deepEqual(quirkFight(ram, [[3.7, 12.1]], 3, 12).hp, [700], 'a plain unit hits the dummy');
  const { s, hp } = quirkFight({ ...ram, targets: 'buildings' }, [[3.7, 12.1]], 3, 12);
  assert.deepEqual(hp, [1000]);
  run(s, 25);
  assert.ok(s.towers.some(t => t.side === 1 && t.hp < t.maxHp));
});

test('quirks multiply the price and plain quirks change nothing', () => {
  const golem = ANCHORS.find(a => a.name === 'Stone Golem')!;
  assert.equal(price({ ...golem, attack: 'single', targets: 'any', on_hit: 'none', windup: false, trait: 'none' }), golem.cost);
  assert.ok(price(golem, { attack: 'splash' }) > golem.cost);
  assert.ok(price(golem, { targets: 'buildings' }) < golem.cost);
  assert.equal(sanitizeDesign({ ...golem, attack: 'laser' as never, flavor: 'one two three four five six seven eight nine ten eleven' }).attack, 'single');
});
