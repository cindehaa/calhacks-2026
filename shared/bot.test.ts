import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORS } from './anchors.js';
import { BRIDGE_X, MID_Y, onOwnHalf, type Side } from './arena.js';
import { BOT_LEVELS, botDecide, newBotMemory, weakestBridge, type BotMemory } from './bot.js';
import { newMatch, newUnit, type SimState } from './sim.js';

const normal = BOT_LEVELS.normal;
const golem = ANCHORS.find(a => a.name === 'Stone Golem')!;

// Seeded, so a failure reproduces.
function seeded(seed = 1) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextId = 1000;
function addUnit(s: SimState, side: Side, a = golem, x = BRIDGE_X[0], y = MID_Y + 3) {
  s.units.push(newUnit(nextId++, side, x, y, a, 0));
}
const ready = (): BotMemory => ({ ...newBotMemory(), nextThink: 0 });

test('waits for its next think', () => {
  const s = newMatch();
  s.elixir = [10, 10];
  assert.equal(botDecide(s, 1, newBotMemory(), normal, seeded()), null);
  s.time = 2;
  assert.notEqual(botDecide(s, 1, { ...newBotMemory(), saveFor: 0 }, normal, seeded()), null);
});

test('rests after a drop instead of chaining troops', () => {
  for (const level of Object.values(BOT_LEVELS)) {
    const s = newMatch();
    s.time = 10;
    s.elixir = [10, 15];
    const mem = { ...ready(), saveFor: 0 };
    assert.notEqual(botDecide(s, 1, mem, level, seeded()), null);
    assert.ok(mem.nextThink >= s.time + level.designTime + level.cooldown * 0.75);
    s.time = mem.nextThink - 0.05;
    assert.equal(botDecide(s, 1, mem, level, seeded()), null);
  }
});

test('fumbles only as often as its level says', () => {
  const rand = seeded(3);
  for (const level of Object.values(BOT_LEVELS)) {
    let fumbles = 0;
    for (let i = 0; i < 400; i++) {
      const s = newMatch();
      s.time = 10;
      s.elixir = [10, 15];
      fumbles += botDecide(s, 1, { ...ready(), saveFor: 0 }, level, rand)!.fumble ? 1 : 0;
    }
    assert.ok(Math.abs(fumbles / 400 - level.fumble) < 0.07, `${fumbles}/400 against ${level.fumble}`);
  }
});

test('defends a golem on its half after the reaction delay, with high dps near the tower', () => {
  const s = newMatch();
  s.time = 10;
  s.elixir = [5, 10];
  addUnit(s, 0);
  const mem = ready();
  const first = botDecide(s, 1, mem, normal, seeded());
  assert.notEqual(first?.why, 'defend', 'should not react instantly');
  s.time += normal.reaction;
  mem.nextThink = 0;
  const move = botDecide(s, 1, mem, normal, seeded())!;
  assert.equal(move.why, 'defend');
  const a = ANCHORS[move.anchor];
  assert.ok(a.damage * a.attack_speed * a.count >= 200, `${a.name} should be a tank killer`);
  assert.ok(onOwnHalf(1, move.y));
  assert.ok(Math.abs(move.x - BRIDGE_X[0]) < 3, `x ${move.x} should be on the threatened bridge's side`);
});

test("doesn't throw more at a threat it already outclasses", () => {
  const s = newMatch();
  s.time = 10;
  s.elixir = [5, 10];
  addUnit(s, 0, ANCHORS[0]); // goblin
  addUnit(s, 1, golem, BRIDGE_X[0], MID_Y + 4);
  const mem = { ...ready(), threatSince: 0 };
  const move = botDecide(s, 1, mem, { ...normal, saveChance: 0 }, seeded());
  assert.equal(move?.why, 'push');
});

test('pushes over the bridge of the weakest enemy tower', () => {
  const s = newMatch();
  s.elixir = [5, 10];
  s.towers.find(t => t.side === 0 && t.lane === 2)!.hp = 1000;
  assert.equal(weakestBridge(s, 1), 1);
  const move = botDecide(s, 1, ready(), { ...normal, saveChance: 0 }, seeded())!;
  assert.equal(move.why, 'push');
  assert.ok(Math.abs(move.x - BRIDGE_X[1]) < 2, `x ${move.x}`);
  assert.ok(onOwnHalf(1, move.y));
});

test('saves up for a big troop, then drops it', () => {
  const s = newMatch();
  s.elixir = [5, 4];
  const mem = { ...ready(), saveFor: ANCHORS.indexOf(golem) };
  assert.equal(botDecide(s, 1, mem, normal, seeded()), null);
  s.elixir[1] = golem.cost;
  mem.nextThink = 0;
  assert.equal(botDecide(s, 1, mem, normal, seeded())?.anchor, ANCHORS.indexOf(golem));
  assert.equal(mem.saveFor, null);
});

test('easy sticks to small troops', () => {
  const rand = seeded(3);
  for (let i = 0; i < 200; i++) {
    const s = newMatch();
    s.elixir = [10, 15];
    if (i % 2) addUnit(s, 0);
    const move = botDecide(s, 1, { ...ready(), threatSince: -10 }, BOT_LEVELS.easy, rand);
    if (move) assert.ok(ANCHORS[move.anchor].cost <= BOT_LEVELS.easy.maxCost, ANCHORS[move.anchor].name);
  }
});

test('never picks what it cannot afford, and always stays on its half', () => {
  const rand = seeded(7);
  for (let i = 0; i < 500; i++) {
    const s = newMatch();
    const side: Side = i % 2 ? 1 : 0;
    s.elixir = [rand() * 10, rand() * 10];
    if (rand() < 0.5) addUnit(s, (1 - side) as Side, ANCHORS[i % 10], rand() * 18, rand() * 30);
    const mem = { ...ready(), threatSince: -10 };
    for (const level of Object.values(BOT_LEVELS)) {
      const move = botDecide(s, side, { ...mem }, level, rand);
      if (!move) continue;
      assert.ok(ANCHORS[move.anchor].cost <= s.elixir[side]);
      assert.ok(onOwnHalf(side, move.y), `y ${move.y}`);
    }
  }
});
