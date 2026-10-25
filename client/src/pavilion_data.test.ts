import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newestFirst, parseExhibits, piles, tally } from './pavilion_data';

// What the SQL endpoint sent back for `SELECT * FROM pavilion` on a local database.
const cols = ['id', 'generation_id', 'at', 'owner', 'kind', 'name', 'description', 'element', 'flavor', 'cost', 'sprite_url'];
const answer = (rows: unknown[][]) => [{ schema: { elements: cols.map(c => ({ name: { some: c }, algebraic_type: {} })) }, rows }];

test('parseExhibits reads rows by column name', () => {
  const [e] = parseExhibits(answer([[3, 9, 1792913547289.0, 'C2AB', 'troop', 'Flame Swift', 'taylor swift with a flamethrower', 'fire', 'sings', 6, '/api/sprite/x.png']]));
  assert.deepEqual(e, {
    id: 3, at: 1792913547289, owner: 'c2ab', kind: 'troop', name: 'Flame Swift', description: 'taylor swift with a flamethrower',
    element: 'fire', flavor: 'sings', cost: 6, spriteUrl: '/api/sprite/x.png',
  });
});

test('parseExhibits survives junk: an error, no rows, a missing name', () => {
  assert.deepEqual(parseExhibits('no such table'), []);
  assert.deepEqual(parseExhibits([{}]), []);
  const [e] = parseExhibits(answer([[1, 1, 0, 'a', 'weird', '', 'a goblin', '', '', 2, '']]));
  assert.equal(e.name, 'a goblin');
  assert.equal(e.kind, 'troop');
});

test('tally counts troops, spells and yours, and spotlights your newest troop', () => {
  const rows = parseExhibits(answer([
    [1, 1, 100, 'me', 'troop', 'Old', '', '', '', 1, ''],
    [2, 2, 200, 'you', 'troop', 'Theirs', '', '', '', 1, ''],
    [3, 3, 300, 'me', 'troop', 'New', '', '', '', 1, ''],
    [4, 4, 400, 'me', 'spell', 'Zap', '', '', '', 1, ''],
  ]));
  const t = tally(rows, new Set(['me']));
  assert.equal(t.troops, 3);
  assert.equal(t.spells, 1);
  assert.equal(t.yours, 3);
  assert.equal(t.latestYours?.name, 'New');
  assert.equal(tally(rows, new Set()).latestYours, null);
  assert.deepEqual([...rows].sort(newestFirst).map(r => r.id), [4, 3, 2, 1]);
});

test('piles stack repeats by kind and name, newest first, borrowing art from an older one', () => {
  const rows = parseExhibits(answer([
    [5, 5, 500, 'you', 'troop', 'Fire Dragon', 'a fire dragon', 'fire', '', 7, ''],
    [4, 4, 400, 'me', 'troop', 'Goblin', '', '', '', 2, '/g.png'],
    [3, 3, 300, 'you', 'troop', 'fire  dragon!', 'fire dragon', 'fire', '', 7, '/d.png'],
    [2, 2, 200, 'you', 'spell', 'Fire Dragon', '', '', '', 3, ''],
    [1, 1, 100, 'me', 'troop', 'Fire Dragon', '', '', '', 7, '/old.png'],
  ])).sort(newestFirst);
  const p = piles(rows, new Set(['me']));
  assert.deepEqual(p.map(x => [x.key, x.count, x.top.id, x.art, x.mine]), [
    ['troop:fire dragon', 3, 5, '/d.png', true],
    ['troop:goblin', 1, 4, '/g.png', true],
    ['spell:fire dragon', 1, 2, '', false],
  ]);
});
