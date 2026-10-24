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

test('pinch: fires once per pinch, with hysteresis, on either finger', async () => {
  const { PinchDetector, pinchMetric } = await import('./pose');
  const d = new PinchDetector();
  const fires = [0.9, 0.6, 0.44, 0.3, 0.5, 0.6, 0.44, 0.3, 0.7, 0.4].map(r => d.push(r));
  assert.deepEqual(fires.map((f, i) => (f ? i : -1)).filter(i => i >= 0), [2, 9]);
  // An upright hand; the thumb tip on the middle finger's pad, then on the index's, then away.
  const hand = (thumb: [number, number]) => {
    const px: [number, number][] = Array.from({ length: 21 }, () => [320, 300]);
    px[0] = [320, 400]; px[5] = [280, 300]; px[9] = [320, 300]; px[17] = [380, 300];
    px[7] = [280, 240]; px[8] = [280, 220]; px[11] = [320, 230]; px[12] = [320, 210]; px[4] = thumb;
    return px.map(([x, y]) => ({ x: x / 640, y: y / 480, z: 0 }));
  };
  assert.ok(pinchMetric(hand([322, 222]), 640, 480) < 0.45);
  assert.ok(pinchMetric(hand([281, 232]), 640, 480) < 0.45, 'thumb to index counts too');
  assert.ok(pinchMetric(hand([200, 330]), 640, 480) > 0.65);
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
