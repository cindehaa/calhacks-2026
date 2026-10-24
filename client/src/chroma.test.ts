import assert from 'node:assert/strict';
import { test } from 'node:test';
import { borderMedian, keyBackground } from './chroma';

// w×h RGBA image filled with `bg`, with a `fg` square from (a,a) to (b,b) inclusive.
function img(w: number, h: number, bg: number[], fg: number[], a: number, b: number) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = x >= a && x <= b && y >= a && y <= b ? fg : bg;
      d.set([...c, 255], (y * w + x) * 4);
    }
  return d;
}
const alpha = (d: Uint8ClampedArray, w: number, x: number, y: number) => d[(y * w + x) * 4 + 3];

test('border median ignores a few odd border pixels', () => {
  const d = img(10, 10, [250, 5, 250], [0, 200, 0], 3, 6);
  d.set([0, 0, 0, 255], 0); // one dark corner
  assert.deepEqual(borderMedian(d, 10, 10), [250, 5, 250]);
});

test('keys a near-magenta background and keeps the troop', () => {
  const d = img(12, 12, [240, 10, 245], [40, 160, 60], 4, 7);
  // JPEG-ish noise on the background still keys.
  d.set([225, 30, 230, 255], (1 * 12 + 1) * 4);
  keyBackground(d, 12, 12);
  assert.equal(alpha(d, 12, 0, 0), 0);
  assert.equal(alpha(d, 12, 1, 1), 0);
  assert.equal(alpha(d, 12, 5, 5), 255);
});

test("a pink troop's inside survives: only pixels joined to the edge are cleared", () => {
  // Magenta hole inside a dark ring: same colour as the background, but enclosed.
  const w = 14, d = img(w, w, [255, 0, 255], [30, 30, 30], 3, 10);
  for (let y = 5; y <= 8; y++) for (let x = 5; x <= 8; x++) d.set([255, 0, 255, 255], (y * w + x) * 4);
  keyBackground(d, w, w);
  assert.equal(alpha(d, w, 0, 0), 0);
  assert.equal(alpha(d, w, 6, 6), 255);
  assert.equal(alpha(d, w, 3, 3), 255);
});

test('keys whatever colour the border is, not just magenta', () => {
  const d = img(10, 10, [20, 200, 30], [200, 200, 200], 3, 6);
  keyBackground(d, 10, 10);
  assert.equal(alpha(d, 10, 0, 9), 0);
  assert.equal(alpha(d, 10, 4, 4), 255);
});
