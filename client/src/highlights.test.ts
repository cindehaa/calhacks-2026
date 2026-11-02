import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AFTER_MS, BEFORE_MS, HighlightTracker, pick, type Board } from './highlights';
import type { MatchTower, MatchUnit } from './match';
import type { DrawSpell, DrawTroop } from './render';

const unit = (id: number, side: number, hp = 10, x = 5, y = 5, troopId = id): MatchUnit =>
  ({ id: BigInt(id), troopId: BigInt(troopId), side, x, y, hp, maxHp: 10, delay: 0, attackSeq: 0 }) as unknown as MatchUnit;
const tower = (side: number, lane: number, hp: number): MatchTower => ({ side, lane, x: 0, y: 0, hp, maxHp: 100, attackSeq: 0 });
const board = (b: Partial<Board>): Board => ({ side: 0, units: [], towers: [], spells: [], troops: new Map(), ...b });

test('a tower destroyed is a moment; the enemy king scores most', () => {
  const h = new HighlightTracker();
  h.observe(board({ towers: [tower(1, 1, 50), tower(0, 0, 50)] }), 0);
  h.observe(board({ towers: [tower(1, 1, 0), tower(0, 0, 0)] }), 100);
  assert.deepEqual(h.moments.map(m => [m.label, m.score]), [['Enemy king tower destroyed', 10], ['Your tower destroyed', 7 * 0.7]]);
});

test('three troops of one side gone within 2 s is one moment, counted once the run is over', () => {
  const h = new HighlightTracker();
  h.observe(board({ units: [unit(1, 1), unit(2, 1), unit(3, 1), unit(4, 0)] }), 0);
  h.observe(board({ units: [unit(2, 1), unit(3, 1), unit(4, 0)] }), 500);
  h.observe(board({ units: [unit(3, 1, 0), unit(4, 0)] }), 900); // one gone, one at 0 hp
  assert.equal(h.moments.length, 0); // the run may still grow
  h.observe(board({ units: [unit(4, 0)] }), 3500);
  assert.deepEqual(h.moments, [{ at: 900, score: 6, label: '3 troops defeated' }]);
});

test('two deaths are not a moment', () => {
  const h = new HighlightTracker();
  h.observe(board({ units: [unit(1, 1), unit(2, 1)] }), 0);
  h.observe(board({ units: [] }), 100);
  h.end(5000, true);
  assert.equal(h.moments.length, 0);
});

test('a spell is a moment when it lands on two or more enemy troops', () => {
  const h = new HighlightTracker();
  const spell = (delay: number): DrawSpell => ({ id: 7n, side: 0, x: 5, y: 5, radius: 2, delay } as DrawSpell);
  const units = [unit(1, 1, 10, 5, 5), unit(2, 1, 10, 6, 5), unit(3, 1, 10, 20, 20), unit(4, 0, 10, 5, 5)];
  h.observe(board({ units, spells: [spell(1)] }), 0);
  h.observe(board({ units, spells: [spell(0)] }), 100);
  h.observe(board({ units, spells: [spell(0)] }), 200); // counted once
  assert.deepEqual(h.moments.map(m => m.label), ['Spell hits 2 troops']);
});

test('only your big summons count', () => {
  const h = new HighlightTracker();
  const troops = new Map<bigint, DrawTroop>([[1n, { name: 'Giant', cost: 8, spriteUrl: '' }], [2n, { name: 'Imp', cost: 2, spriteUrl: '' }], [3n, { name: 'Ogre', cost: 9, spriteUrl: '' }]]);
  h.observe(board({ troops, units: [unit(10, 0, 10, 0, 0, 1), unit(11, 0, 10, 0, 0, 1), unit(12, 0, 10, 0, 0, 2), unit(13, 1, 10, 0, 0, 3)] }), 0);
  assert.deepEqual(h.moments, [{ at: 0, score: 4, label: 'Giant summoned' }]);
});

test('pick merges overlapping moments, keeps the top scores, in time order', () => {
  const moments = [
    { at: 10_000, score: 3, label: 'a' },
    { at: 11_000, score: 7, label: 'b' }, // merges with a: 10 points, label b
    { at: 30_000, score: 4, label: 'c' },
    { at: 50_000, score: 9, label: 'd' },
    { at: 70_000, score: 1, label: 'e' },
  ];
  const w = pick(moments, 0, 80_000, 3);
  assert.deepEqual(w.map(x => [x.label, x.score]), [['b', 10], ['c', 4], ['d', 9]]);
  assert.equal(w[0].from, 10_000 - BEFORE_MS);
  assert.equal(w[0].to, 11_000 + AFTER_MS);
});

test('pick keeps windows inside the recording', () => {
  const [w] = pick([{ at: 500, score: 5, label: 'x' }], 0, 1000);
  assert.deepEqual([w.from, w.to], [0, 1000]);
});
