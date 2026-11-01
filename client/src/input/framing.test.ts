import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessFraming, Framing } from './framing';

const good = { visible: true, size: 0.25, aim: [0.5, 0.5] as [number, number], luma: 120 };

test('a well placed hand is ok', () => {
  assert.equal(assessFraming(good), 'ok');
});

test('darkness comes first, even with no hand', () => {
  assert.equal(assessFraming({ ...good, luma: 20 }), 'light');
  assert.equal(assessFraming({ visible: false, luma: 20 }), 'light');
  assert.equal(assessFraming({ visible: false, luma: null }), 'none');
});

test('too far and too close', () => {
  assert.equal(assessFraming({ ...good, size: 0.05 }), 'closer');
  assert.equal(assessFraming({ ...good, size: 0.6 }), 'back');
});

test('off an edge says which way to move, mirrored like the cursor', () => {
  assert.equal(assessFraming({ ...good, aim: [-0.2, 0.5] }), 'right');
  assert.equal(assessFraming({ ...good, aim: [1.2, 0.5] }), 'left');
  assert.equal(assessFraming({ ...good, aim: [0.5, -0.2] }), 'down');
  assert.equal(assessFraming({ ...good, aim: [0.5, 1.2] }), 'up');
  assert.equal(assessFraming({ ...good, aim: [1.03, 0.5] }), 'ok'); // just past the edge is fine
});

test('advice changes only after the new one holds', () => {
  const f = new Framing(400);
  assert.equal(f.push(0, 'none'), 'none');
  assert.equal(f.push(100, 'ok'), 'none');
  assert.equal(f.push(300, 'ok'), 'none');
  assert.equal(f.push(520, 'ok'), 'ok');
  // A flicker back and forth never takes over.
  assert.equal(f.push(600, 'closer'), 'ok');
  assert.equal(f.push(700, 'ok'), 'ok');
  assert.equal(f.push(1100, 'closer'), 'ok');
  assert.equal(f.since, 520);
});
