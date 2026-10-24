// Hand size, finger extension, fist detection and the cursor trail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extension, FistDetector, Hysteresis, type Landmark } from './pose';
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

test('fist: counts once, after being held, and again only after opening', () => {
  const f = new FistDetector();
  const seq: boolean[] = [];
  for (let t = 0; t < 300; t += 33) seq.push(f.update(t, world(0)));
  for (let t = 300; t < 600; t += 33) seq.push(f.update(t, world(1)));
  assert.equal(seq.filter(Boolean).length, 1);
  assert.equal(seq.indexOf(true), 10 + 4, 'fires on the first frame past 120 ms closed');
  for (let t = 600; t < 700; t += 33) f.update(t, world(0));
  let again = false;
  for (let t = 700; t < 900; t += 33) again ||= f.update(t, world(1));
  assert.ok(again);
});

test('fist: a hand passing through a fist briefly does not count', () => {
  const f = new FistDetector();
  const seq = [0, 0, 1, 1, 1, 0, 0].map((c, i) => f.update(i * 33, world(c)));
  assert.ok(!seq.some(Boolean));
});

test('flicks are only trusted with straight fingers, and not just after a fist', () => {
  const f = new FistDetector();
  f.update(0, world(0));
  assert.ok(f.allowsFlick(0));
  f.update(33, world(0.6)); // half curled
  assert.ok(!f.allowsFlick(33));
  f.update(66, world(1));
  f.update(100, world(0));
  assert.ok(!f.allowsFlick(100), 'opening out of a fist');
  f.update(600, world(0));
  assert.ok(f.allowsFlick(600));
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
