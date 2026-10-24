// Pinch metric, hysteresis and the calibration fits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PinchCalibration, PointerCalibration, CAL_TARGETS, PINCH_PHASES } from './calibrate';
import { applyH, invertH } from './homography';
import { choosePinch, fitPinch, Hysteresis, pinchMetric2d, pinchMetric3d, segDist, type Landmark } from './pinch';

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

test('3d pinch uses world landmarks', () => {
  const wl: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  wl[9] = { x: 0, y: -0.08, z: 0 };
  wl[11] = { x: 0, y: -0.13, z: 0 };
  wl[12] = { x: 0, y: -0.15, z: 0 };
  wl[4] = { x: 0.004, y: -0.14, z: 0 };
  assert.ok(Math.abs(pinchMetric3d(wl) - 0.05) < 1e-9);
});

test('hysteresis: on below 0.45, off above 0.65, steady in between', () => {
  const h = new Hysteresis(0.45, 0.65);
  const seq = [0.9, 0.5, 0.44, 0.5, 0.6, 0.64, 0.66, 0.5, 0.46];
  assert.deepEqual(seq.map(v => h.update(v)), [false, false, true, true, true, true, false, false, false]);
});

test('pinch fit: thresholds at 30 % / 60 % of a clean gap', () => {
  const open = Array.from({ length: 20 }, (_, i) => 0.8 + i * 0.01); // 10th pct = 0.82
  const closed = Array.from({ length: 20 }, (_, i) => 0.1 + i * 0.01); // 90th pct = 0.28
  const f = fitPinch(open, closed)!;
  assert.equal(f.on, Math.round((0.28 + 0.3 * 0.54) * 100) / 100);
  assert.equal(f.off, Math.round((0.28 + 0.6 * 0.54) * 100) / 100);
  assert.ok(f.score > 0);
  assert.equal(fitPinch(open.slice(0, 5), closed), null, 'too few samples');
});

test('pinch fit: overlapping samples fall back to splitting the medians', () => {
  const open = Array.from({ length: 20 }, (_, i) => 0.3 + i * 0.03);
  const closed = Array.from({ length: 20 }, (_, i) => 0.2 + i * 0.03);
  const f = fitPinch(open, closed)!;
  assert.ok(f.score < 0);
  assert.ok(f.on < f.off);
});

test('pinch calibration picks the metric with the cleaner gap', () => {
  const span = (lo: number, step: number) => Array.from({ length: 20 }, (_, i) => lo + i * step);
  const r = choosePinch({ '2d': span(0.4, 0.02), '3d': span(0.9, 0.01) }, { '2d': span(0.3, 0.02), '3d': span(0.1, 0.01) })!;
  assert.equal(r.metric, '3d');
});

test('pinch calibration run buckets samples by phase', () => {
  const run = new PinchCalibration(0);
  for (let t = 0; t <= PINCH_PHASES.closedTo; t += 33) {
    const closed = t >= PINCH_PHASES.openTo;
    run.push(t, closed ? 0.2 : 1.0, closed ? 0.1 : 0.9);
  }
  assert.equal(run.phase(500).ask, 'open');
  assert.equal(run.phase(500).recording, false);
  assert.equal(run.phase(5000).ask, 'pinch');
  assert.ok(run.done(PINCH_PHASES.closedTo));
  const r = run.result()!;
  assert.ok(r.on > 0.2 && r.off < 1.0 && r.on < r.off);
});

test('pointer calibration: four pinches give a mapping onto the targets', () => {
  const truth = [1.5, 0.05, -0.3, 0.02, 1.7, -0.25, 0.1, 0.05, 1]; // camera → screen
  const inv = invertH(truth)!;
  const cal = new PointerCalibration(100);
  let t = 0;
  for (const target of CAL_TARGETS) {
    const cam = applyH(inv, target);
    for (let i = 0; i < 20; i++, t += 16) cal.pushRaw(t, cam);
    // the pinch itself drags the pointer; the sample must come from before it
    for (let i = 0; i < 5; i++, t += 16) cal.pushRaw(t, [cam[0] + 0.05, cam[1] + 0.05]);
    assert.ok(cal.click(t));
  }
  assert.ok(cal.done);
  const r = cal.result(1920, 1080)!;
  assert.ok(r.residual < 1, `residual ${r.residual}`);
  const [u, v] = applyH(r.H, applyH(inv, [0.5, 0.5]));
  assert.ok(Math.abs(u - 0.5) < 1e-6 && Math.abs(v - 0.5) < 1e-6);
});

test('pointer calibration: no hand samples, no click', () => {
  assert.equal(new PointerCalibration().click(1000), false);
});
