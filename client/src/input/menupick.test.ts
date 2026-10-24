import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxDistance, Dwell, nearestBox } from './menupick';

const box = (left: number, top: number, w = 100, h = 40) => ({ left, top, right: left + w, bottom: top + h });

test('boxDistance is 0 inside and the edge distance outside', () => {
  assert.equal(boxDistance(50, 20, box(0, 0)), 0);
  assert.equal(boxDistance(110, 20, box(0, 0)), 10);
  assert.equal(boxDistance(103, 44, box(0, 0)), 5);
});

test('nearestBox prefers the box under the cursor, else the nearest within reach', () => {
  const boxes = [box(0, 0), box(0, 60), box(300, 0)];
  assert.equal(nearestBox(50, 70, boxes), 1);
  assert.equal(nearestBox(50, 50, boxes, 44), 0); // 10 px below the first, 10 above the second: first wins the tie
  assert.equal(nearestBox(50, 55, boxes, 44), 1); // 5 px from the second
  assert.equal(nearestBox(200, 20, boxes, 44), -1); // 100 px from both sides
  assert.equal(nearestBox(130, 20, boxes, 44), 0);
});

test('dwell fires once after resting, then waits for the cursor to leave', () => {
  const d = new Dwell<string>(1000);
  assert.equal(d.update(0, 'a'), null);
  assert.equal(d.progress(500), 0.5);
  assert.equal(d.update(999, 'a'), null);
  assert.equal(d.update(1000, 'a'), 'a');
  assert.equal(d.update(3000, 'a'), null); // still resting: no repeat
  assert.equal(d.progress(3000), 0);
  assert.equal(d.update(3100, null), null);
  assert.equal(d.update(3200, 'a'), null);
  assert.equal(d.update(4200, 'a'), 'a');
});

test('moving to another target restarts the dwell, and a click spends it', () => {
  const d = new Dwell<string>(1000);
  d.update(0, 'a');
  assert.equal(d.update(800, 'b'), null);
  assert.equal(d.update(1500, 'b'), null);
  d.spend();
  assert.equal(d.update(2000, 'b'), null);
  assert.equal(d.progress(2000), 0);
});
