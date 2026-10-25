// Hand size, finger extension, thumbs down, pinch and the cursor trail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extension, Hysteresis, thumbDownScore, type Landmark } from './pose';
import { CursorHistory } from './trail';

// A right hand in world coords (metres), wrist at the origin, knuckles 9 cm up. curl 0 is open,
// 1 folds every fingertip back down to 6 cm from the wrist.
function world(curl: number): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  [[5, 8, -0.03], [9, 12, -0.01], [13, 16, 0.01], [17, 20, 0.03]].forEach(([k, t, x]) => {
    lm[k] = { x, y: -0.09, z: 0 };
    const reach = 0.17 - curl * 0.11; // tip distance from the wrist
    lm[t] = { x, y: -reach, z: 0 };
  });
  return lm;
}

test('extension: about 1.9 open, under 1 for a fist, and pointing at the camera still reads open', () => {
  const open = extension(world(0));
  assert.ok(open > 1.8 && open < 1.9, `open ${open}`);
  assert.ok(extension(world(1)) < 0.75);
  const pointing = world(0);
  pointing[8] = { x: -0.03, y: -0.09, z: -0.08 }; // index bent at the knuckle toward the camera
  assert.ok(extension(pointing) > 1.6, 'nowhere near a fist');
});

test('hysteresis: on below, off above, steady in between', () => {
  const h = new Hysteresis(0.45, 0.65);
  const seq = [0.9, 0.5, 0.44, 0.5, 0.6, 0.64, 0.66, 0.5, 0.46];
  assert.deepEqual(seq.map(v => h.update(v)), [false, false, true, true, true, true, false, false, false]);
});

test('cursor history returns the latest sample at or before t', () => {
  const h = new CursorHistory(1000);
  h.push(0, { x: 0, y: 0 });
  h.push(10, { x: 1, y: 0 });
  h.push(20, { x: 2, y: 0 });
  assert.equal(h.at(15)?.x, 1);
  assert.equal(h.at(-5)?.x, 0);
  assert.equal(h.at(99)?.x, 2);
  h.push(2000, { x: 3, y: 0 });
  assert.equal(h.at(15)?.x, 3, 'old samples are trimmed');
});

test('pinch: fires once per pinch, with hysteresis, on any finger', async () => {
  const { PinchDetector, pinchMetric } = await import('./pose');
  const d = new PinchDetector();
  const fires = [0.9, 0.6, 0.44, 0.3, 0.5, 0.6, 0.44, 0.3, 0.7, 0.4].map((r, i) => d.push(r, i * 100));
  assert.deepEqual(fires.map((f, i) => (f ? i : -1)).filter(i => i >= 0), [2, 9]);
  // An upright hand; the thumb tip on each finger's pad in turn, then away.
  const hand = (thumb: [number, number]) => {
    const px: [number, number][] = Array.from({ length: 21 }, () => [320, 300]);
    px[0] = [320, 400]; px[5] = [280, 300]; px[9] = [320, 300]; px[17] = [380, 300];
    px[7] = [280, 240]; px[8] = [280, 220]; px[11] = [320, 230]; px[12] = [320, 210];
    px[15] = [350, 240]; px[16] = [350, 220]; px[19] = [380, 250]; px[20] = [380, 235]; px[4] = thumb;
    return px.map(([x, y]) => ({ x: x / 640, y: y / 480, z: 0 }));
  };
  assert.ok(pinchMetric(hand([322, 222]), 640, 480) < 0.45);
  assert.ok(pinchMetric(hand([281, 232]), 640, 480) < 0.45, 'thumb to index counts too');
  assert.ok(pinchMetric(hand([352, 242]), 640, 480) < 0.45, 'thumb to ring counts');
  assert.ok(pinchMetric(hand([382, 252]), 640, 480) < 0.45, 'thumb to pinky counts');
  assert.ok(pinchMetric(hand([200, 330]), 640, 480) > 0.65);
});

test('pinch: a re-close inside the cooldown is held, and a new control hand must open first', async () => {
  const { PinchDetector, PINCH_COOLDOWN_MS } = await import('./pose');
  const d = new PinchDetector();
  assert.ok(d.push(0.3, 1000));
  assert.ok(!d.push(0.7, 1200));
  assert.ok(!d.push(0.3, 1300), 'flicker 300 ms later');
  assert.ok(!d.push(0.7, 1400));
  assert.ok(d.push(0.3, 1000 + PINCH_COOLDOWN_MS + 100));
  assert.deepEqual(d.last, { ratio: 0.3, openMs: 200, sinceLastMs: PINCH_COOLDOWN_MS + 100, held: 1 });

  const e = new PinchDetector();
  e.rearm();
  assert.ok(!e.push(0.2, 0), 'arrives closed: no fire');
  assert.ok(!e.push(0.7, 100));
  assert.ok(e.push(0.3, 200));
});

// Image landmarks for an upright hand (knuckles at y 300, wrist at 400), thumb base at (290, 330).
function image(thumbTip: [number, number]): Landmark[] {
  const px: [number, number][] = Array.from({ length: 21 }, () => [320, 300]);
  px[0] = [320, 400]; px[5] = [280, 300]; px[9] = [320, 300]; px[13] = [350, 300]; px[17] = [380, 300];
  px[2] = [290, 330]; px[4] = thumbTip;
  return px.map(([x, y]) => ({ x: x / 640, y: y / 480, z: 0 }));
}

test('thumbs down: thumb pointing down under curled fingers scores high; a pinch or open hand does not', () => {
  assert.ok(thumbDownScore(image([292, 420]), world(1), 640, 480) > 0.9, 'thumbs down');
  assert.ok(thumbDownScore(image([300, 230]), world(0.6), 640, 480) < 0.1, 'pinch: thumb tip up at the fingers');
  assert.ok(thumbDownScore(image([292, 420]), world(0), 640, 480) < 0.1, 'thumb down but fingers open');
  assert.ok(thumbDownScore(image([380, 340]), world(1), 640, 480) < 0.1, 'thumb out sideways');
});

test('pointer: halfway between the index and thumb tips, mirrored', async () => {
  const { pointerOf } = await import('./pose');
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  lm[8] = { x: 0.2, y: 0.3, z: 0 }; lm[4] = { x: 0.4, y: 0.5, z: 0 };
  const [u, v] = pointerOf(lm);
  assert.ok(Math.abs(u - 0.7) < 1e-9 && Math.abs(v - 0.4) < 1e-9);
});

test('pinch: fitted to a hand, between pointing and pinched', async () => {
  const { fitPinch, PinchDetector } = await import('./pose');
  assert.deepEqual(fitPinch(1.0, 0.15), { on: 0.49, off: 0.7 }, 'a typical hand lands near the defaults');
  const loose = fitPinch(1.1, 0.5)!; // thumb and pad read far apart even touching
  assert.ok(loose.on > 0.5 && loose.off < 1.1 && loose.off - loose.on >= 0.08);
  const rested = fitPinch(0.5, 0.05)!; // thumb resting near the curled fingers while pointing
  assert.ok(rested.off < 0.5, 'opens again before the resting pose');
  assert.equal(fitPinch(0.6, 0.5), null, 'too alike to tell apart');
  const d = new PinchDetector();
  d.setThresholds(loose);
  assert.ok(d.push(0.6, 0), 'a pinch the defaults would miss');
});
