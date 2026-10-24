import assert from 'node:assert/strict';
import { test } from 'node:test';
import { elementOf } from './wordfx';

test('element words light up, other words do not', () => {
  assert.equal(elementOf('Fire,')?.color, elementOf('flames')?.color);
  assert.ok(elementOf('ICE')?.frost);
  assert.ok(elementOf('lightning'));
  assert.equal(elementOf('dragonfly'), null); // whole words only
  assert.equal(elementOf('knight'), null);
  assert.equal(elementOf('“'), null);
});
