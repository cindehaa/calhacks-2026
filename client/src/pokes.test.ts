import assert from 'node:assert/strict';
import test from 'node:test';
import { pokeReaction, theirHalf } from './pokes';
import { MID_Y } from '../../shared/arena';

test('empty ground on your own half keeps its deploy behaviour and adds nothing', () => {
  for (const side of [0, 1]) {
    const y = side === 0 ? MID_Y - 4 : MID_Y + 4;
    assert.deepEqual(pokeReaction({ hit: null, x: 9, y, mySide: side, deployable: true }), { reaction: null, deploy: true });
  }
});

test('a deployable click is never swallowed, whatever it lands on', () => {
  for (const hit of ['mine', 'theirs', 'tower', null] as const)
    for (const side of [0, 1])
      for (const y of [2, MID_Y - 3, MID_Y + 3, 28])
        assert.equal(pokeReaction({ hit, x: 9, y, mySide: side, deployable: true }).deploy, true);
});

test('things react to being clicked', () => {
  const base = { x: 9, y: 10, mySide: 0, deployable: false };
  assert.equal(pokeReaction({ ...base, hit: 'mine' }).reaction, 'hop');
  assert.equal(pokeReaction({ ...base, hit: 'theirs' }).reaction, 'flinch');
  assert.equal(pokeReaction({ ...base, hit: 'tower' }).reaction, 'shudder');
});

test('only the opponent’s half puffs, and only where you can’t deploy', () => {
  assert.equal(pokeReaction({ hit: null, x: 9, y: MID_Y + 5, mySide: 0, deployable: false }).reaction, 'puff');
  assert.equal(pokeReaction({ hit: null, x: 9, y: MID_Y - 5, mySide: 1, deployable: false }).reaction, 'puff');
  assert.equal(pokeReaction({ hit: null, x: 9, y: MID_Y + 5, mySide: 0, deployable: true }).reaction, null); // a pocket after a tower falls
  assert.equal(pokeReaction({ hit: null, x: 9, y: MID_Y - 5, mySide: 0, deployable: false }).reaction, null); // your own tower footprint
  assert.equal(pokeReaction({ hit: null, x: -3, y: MID_Y + 5, mySide: 0, deployable: false }).reaction, null); // off the board
  assert.equal(theirHalf(MID_Y + 1, 0), true);
  assert.equal(theirHalf(MID_Y + 1, 1), false);
});
