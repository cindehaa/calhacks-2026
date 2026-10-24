import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANTICIPATION, anticipation, elementColors, hitInterval } from './tokens';

test('the wind-up starts 150 ms before the predicted hit and is full on it', () => {
  assert.equal(anticipation(10.5, 10, 1), 0);
  assert.equal(anticipation(11 - ANTICIPATION, 10, 1), 0);
  assert.ok(Math.abs(anticipation(11 - ANTICIPATION / 2, 10, 1) - 0.5) < 1e-9);
  assert.equal(anticipation(11, 10, 1), 1);
  assert.equal(anticipation(11.2, 10, 1), 1); // late: hold
  assert.equal(anticipation(12, 10, 1), 0); // never came: relax
  assert.equal(anticipation(10.5, -1, 1), 0); // no hit yet
});

test('hit interval comes from attack speed, else observed gaps', () => {
  assert.equal(hitInterval(0, 0.7, 2), 0.5);
  assert.ok(Math.abs(hitInterval(0, 0, 2, true) - 1 / 1.2) < 1e-9);
  assert.equal(hitInterval(0, 0.8), 0.8);
  assert.equal(hitInterval(0.8, 6), 0.8); // a pause between fights is ignored
  assert.ok(Math.abs(hitInterval(0.8, 1) - 0.88) < 1e-9);
});

test('elements colour effects; none keeps team colours', () => {
  assert.equal(elementColors('none'), null);
  assert.equal(elementColors(undefined), null);
  assert.equal(elementColors('fire')?.[0], '#ff8a2a');
});
