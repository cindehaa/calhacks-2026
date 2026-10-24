import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MID_Y } from './arena';
import { newMatch, newUnit, step, type SimUnit } from './sim';
import { newTally, tallyStep, troopsHit, type TroopTally } from './tally';

const unit = (id: number, side: 0 | 1, y: number, o: Partial<SimUnit> = {}): SimUnit => ({
  ...newUnit(id, side, 4, y, { health: 300, damage: 100, attack_speed: 1, move_speed: 1, range: 1 }, 0), ...o,
});

test('tallies credit each hit, kill and death to the troop that made it', () => {
  const s = newMatch();
  // Two side-0 units of one troop face one weak side-1 unit of another, toe to toe. The weak one
  // acts first in a step, so it gets a hit in before it falls.
  s.units = [unit(20, 1, MID_Y - 2.4, { hp: 150, maxHp: 150, damage: 10 }), unit(10, 0, MID_Y - 3), unit(11, 0, MID_Y - 3.2)];
  const troopOf = (id: number) => (id < 20 ? 'a' : id < 30 ? 'b' : undefined);
  const tallies = new Map<string, TroopTally>([['a', newTally(2)], ['b', newTally(1)]]);
  for (let i = 0; i < 40; i++) {
    const res = step(s, 0.05);
    tallyStep(tallies, res, troopOf, s.time);
    if (res.hits.length) assert.ok(troopsHit(res, troopOf).size > 0);
  }
  const a = tallies.get('a')!, b = tallies.get('b')!;
  assert.equal(a.unitDamage, 150); // capped at what the target had left
  assert.equal(a.kills, 1);
  assert.equal(a.alive, 2);
  assert.equal(a.diedAt, -1);
  assert.equal(b.alive, 0);
  assert.ok(b.diedAt > 0);
  assert.ok(b.unitDamage > 0 && b.unitDamage < 300);
});
