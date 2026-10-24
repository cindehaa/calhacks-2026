// Pinch metric and hysteresis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hysteresis, pinchMetric2d, PinchOnset, segDist, type Landmark } from './pinch';

// A flat right hand in a 640×480 frame, in pixels, then normalised. Wrist at the bottom.
function hand(thumbTip: [number, number]): Landmark[] {
  const px: [number, number][] = Array.from({ length: 21 }, () => [320, 300]);
  px[0] = [320, 400]; // wrist
  px[5] = [280, 300]; // index knuckle
  px[9] = [320, 300]; // middle knuckle (wrist → here = 100 px)
  px[17] = [380, 310]; // pinky knuckle
  px[11] = [320, 230]; // middle DIP
  px[12] = [320, 210]; // middle tip
  px[4] = thumbTip;
  return px.map(([x, y]) => ({ x: x / 640, y: y / 480, z: 0 }));
}

test('segment distance: nearest point, clamped to the ends', () => {
  assert.equal(segDist([5, 3], [0, 0], [10, 0]), 3);
  assert.equal(segDist([-4, 3], [0, 0], [10, 0]), 5);
  assert.equal(segDist([1, 1, 1], [1, 1, 1], [1, 1, 1]), 0);
});

test('2d pinch: thumb on the middle finger pad reads ~0, open reads large', () => {
  const pinched = pinchMetric2d(hand([322, 222]), 640, 480);
  const open = pinchMetric2d(hand([230, 330]), 640, 480);
  assert.ok(pinched < 0.05, `pinched ${pinched}`);
  assert.ok(open > 0.65, `open ${open}`);
  // 2 px from the segment over the hand size: palm width / 0.8 beats wrist → knuckle here
  assert.ok(Math.abs(pinched - 2 / (Math.hypot(100, 10) / 0.8)) < 1e-9);
});

test('2d pinch: palm width stands in when the hand points at the camera', () => {
  const lm = hand([230, 330]);
  lm[0] = { x: 320 / 640, y: 310 / 480, z: 0 }; // wrist foreshortened to 10 px from the middle knuckle
  const size = Math.hypot(100, 10) / 0.8; // palm width / 0.8
  const expect = Math.hypot(320 - 230, 230 - 330) / size;
  assert.ok(Math.abs(pinchMetric2d(lm, 640, 480) - expect) < 1e-9);
});

test('hysteresis: on below 0.45, off above 0.65, steady in between', () => {
  const h = new Hysteresis(0.45, 0.65);
  const seq = [0.9, 0.5, 0.44, 0.5, 0.6, 0.64, 0.66, 0.5, 0.46];
  assert.deepEqual(seq.map(v => h.update(v)), [false, false, true, true, true, true, false, false, false]);
});

test('2d pinch: the index finger option reads thumb against the index pad', () => {
  const lm = hand([230, 330]);
  lm[7] = { x: 280 / 640, y: 230 / 480, z: 0 }; // index DIP
  lm[8] = { x: 280 / 640, y: 210 / 480, z: 0 }; // index tip
  lm[4] = { x: 282 / 640, y: 222 / 480, z: 0 };
  assert.ok(pinchMetric2d(lm, 640, 480, 'index') < 0.05);
  assert.ok(pinchMetric2d(lm, 640, 480, 'middle') > 0.2, 'not a middle-finger pinch');
});

test('pinch onset: the most open moment in the window', () => {
  const o = new PinchOnset(400);
  [[0, 0.7], [100, 0.9], [200, 0.6], [300, 0.3]].forEach(([t, v]) => o.push(t, v));
  assert.equal(o.onset(), 100);
  o.push(600, 0.2);
  assert.equal(o.onset(), 200, 'samples older than the window drop out');
});
