// Flick detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlickDetector } from './flick';
import type { Landmark } from './pinch';

// An upright hand 100 px tall in a 640×480 frame; dy moves the fingertips, wy moves the whole hand.
function hand(dy: number, wy = 0): Landmark[] {
  const px: [number, number][] = Array.from({ length: 21 }, () => [320, 300 + wy]);
  px[0] = [320, 400 + wy];
  px[5] = [280, 300 + wy];
  px[9] = [320, 300 + wy];
  px[17] = [380, 300 + wy];
  px[8] = [280, 220 + wy + dy];
  px[12] = [320, 210 + wy + dy];
  return px.map(([x, y]) => ({ x: x / 640, y: y / 480, z: 0 }));
}

// Feeds 30 fps frames: dy(t) and wy(t) in px. Returns the onsets reported.
function run(d: FlickDetector, ms: number, dy: (t: number) => number, wy: (t: number) => number = () => 0, t0 = 0) {
  const out: number[] = [];
  for (let t = t0; t < t0 + ms; t += 33) {
    const o = d.update(t, hand(dy(t), wy(t)), 640, 480);
    if (o !== null) out.push(o);
  }
  return out;
}

test('a fast downward snap of the fingertips is a flick, timed from before it', () => {
  const d = new FlickDetector();
  const dy = (t: number) => (t < 300 ? 0 : Math.min(120, (t - 300) * 1.2)); // ~1.2 hand sizes in 100 ms
  const onsets = run(d, 600, dy);
  assert.equal(onsets.length, 1);
  assert.ok(onsets[0] <= 300, `onset ${onsets[0]}`);
});

test('a still hand, jitter and slow finger curls are not flicks', () => {
  const d = new FlickDetector();
  assert.deepEqual(run(d, 1000, t => Math.sin(t) * 2), []);
  assert.deepEqual(run(new FlickDetector(), 2000, t => t * 0.05), [], 'curling over two seconds');
});

test('moving the whole arm down is not a flick', () => {
  const d = new FlickDetector();
  const wy = (t: number) => (t < 300 ? 0 : (t - 300) * 1.2);
  assert.deepEqual(run(d, 600, wy, wy), []);
});

test('fingers moving up is not a flick', () => {
  const d = new FlickDetector();
  assert.deepEqual(run(d, 600, t => (t < 300 ? 0 : -(t - 300) * 1.2)), []);
});
