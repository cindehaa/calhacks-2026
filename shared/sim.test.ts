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

// Tier 2 and 3. A stepper that runs n ticks on a quirkFight state.
const ticks = (s: SimState, n: number) => { for (let i = 0; i < n; i++) step(s, 1 / TICK_HZ); };
const unit = (s: SimState, id: number) => s.units.find(u => u.id === id)!;

test('burn deals 20% of the hit per second for 3 s', () => {
  const { s } = quirkFight({ ...shooter, attack_speed: 0.3, on_hit: 'burn' }, [[9, 13]]);
  assert.equal(unit(s, 10).burnDps, 20);
  ticks(s, 3 * TICK_HZ + 2);
  assert.ok(Math.abs(unit(s, 10).hp - 840) < 0.5, String(unit(s, 10).hp));
  assert.equal(unit(s, 10).burnT, 0);
});

test('slow cuts move speed by 40% for 2 s', () => {
  const { s } = quirkFight({ ...shooter, attack_speed: 0.3, on_hit: 'slow' }, [[9, 15]], 9, 10);
  // The dummy walks at us; slowed, it covers 0.6 of its usual ground.
  const d = unit(s, 10);
  d.slowT = 2;
  d.moveSpeed = 1;
  const y0 = d.y;
  ticks(s, TICK_HZ);
  assert.ok(Math.abs((y0 - d.y) - 0.6) < 0.05, String(y0 - d.y));
});

test('stun stops the target and restarts its cooldown', () => {
  const { s } = quirkFight({ ...shooter, attack_speed: 0.3, on_hit: 'stun' }, [[9, 13]]);
  const d = unit(s, 10);
  assert.ok(d.stunT > 0.4);
  assert.equal(d.cooldown, 1 / d.attackSpeed);
  const [x, y] = [d.x, d.y];
  ticks(s, 5);
  assert.deepEqual([d.x, d.y], [x, y]);
});

test('windup charges 0.8 s in reach before the hit', () => {
  const { s, a, hp } = quirkFight({ ...shooter, windup: true }, [[9, 13]]);
  assert.deepEqual(hp, [1000]);
  assert.ok(a.windupT > 0);
  ticks(s, 0.8 * TICK_HZ);
  assert.equal(a.attackSeq, 1);
  assert.equal(unit(s, 10).hp, 900);
});

test('flying: melee units cannot hit it, ranged units can', () => {
  const flyer = { ...dummy, trait: 'flying' as const };
  const s = newMatch();
  s.units.push(newUnit(1, 0, 9, 10, { ...shooter, range: 1 }, 0), newUnit(2, 0, 3, 10, shooter, 0));
  s.units.push(newUnit(10, 1, 9, 10.5, flyer, 0), newUnit(11, 1, 3, 13, flyer, 0));
  ticks(s, 1);
  assert.equal(unit(s, 10).hp, 1000);
  assert.equal(unit(s, 11).hp, 900);
});

test('shield adds 30% of health and is lost first', () => {
  const { s } = quirkFight(shooter, [[9, 13]]);
  const fresh = newUnit(5, 1, 0, 0, { ...dummy, trait: 'shield' }, 0);
  assert.deepEqual([fresh.shield, fresh.maxShield], [300, 300]);
  const d = unit(s, 10);
  Object.assign(d, { trait: 'shield', shield: 300, maxShield: 300, hp: 1000 });
  ticks(s, TICK_HZ + 1);
  assert.deepEqual([d.shield, d.hp], [200, 1000]);
});

test('spawner drops a minion every 5 s', () => {
  const s = newMatch();
  s.units.push(newUnit(1, 0, 9, 4, { ...dummy, trait: 'spawner' }, 0));
  let spawned = 0;
  for (let i = 0; i < 5 * TICK_HZ + 1; i++) spawned += step(s, 1 / TICK_HZ).spawned.length;
  assert.equal(spawned, 1);
  const m = s.units.find(u => u.id !== 1)!;
  assert.deepEqual([m.side, m.maxHp, m.damage, m.range], [0, 100, 20, 1]);
});

test('death_burst deals 2x damage nearby on death', () => {
  const s = newMatch();
  s.units.push(newUnit(1, 0, 9, 10, { ...shooter, health: 50, trait: 'death_burst' }, 0));
  s.units.push(newUnit(10, 1, 9, 11, dummy, 0), newUnit(11, 1, 9, 14, dummy, 0));
  // A burn tick kills it before it acts.
  Object.assign(s.units[0], { hp: 0.001, burnT: 1, burnDps: 100 });
  step(s, 1 / TICK_HZ);
  assert.equal(unit(s, 10).hp, 800);
  assert.equal(unit(s, 11).hp, 1000);
});

test('heal_aura heals allies within 2 tiles by 3%/s, capped at max', () => {
  const s = newMatch();
  s.units.push(newUnit(1, 0, 9, 4, { ...dummy, trait: 'heal_aura' }, 0));
  s.units.push(newUnit(2, 0, 10, 4, dummy, 0), newUnit(3, 0, 13, 4, dummy, 0), newUnit(4, 0, 9, 5, dummy, 0));
  Object.assign(unit(s, 2), { hp: 500 });
  Object.assign(unit(s, 3), { hp: 500 });
  Object.assign(unit(s, 4), { hp: 999 });
  ticks(s, TICK_HZ);
  assert.ok(Math.abs(unit(s, 2).hp - 530) < 0.01);
  assert.equal(unit(s, 3).hp, 500);
  assert.equal(unit(s, 4).hp, 1000);
});

test('charge: after 2 tiles of walking the next hit doubles', () => {
  const { s, a } = quirkFight({ ...shooter, range: 1, trait: 'charge' }, [[9, 14]], 9, 10);
  while (a.attackSeq === 0) step(s, 1 / TICK_HZ);
  assert.equal(unit(s, 10).hp, 800);
  assert.equal(a.chargeDist, 0);
});
