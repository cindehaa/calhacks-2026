import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromaKey } from './chroma';

type RGB = [number, number, number];
const BG: RGB = [253, 26, 202]; // what the model actually paints for "#FF00FF"
const OUTLINE: RGB = [50, 16, 39];
const PINK: RGB = [249, 76, 176]; // a pink dragon's belly, ~56 from BG

// 20x20 magenta image with a dark-outlined 10x10 square at (5, 5). paint() fills its inside.
function image(paint: (x: number, y: number) => RGB) {
  const width = 20, height = 20, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inBox = x >= 5 && x < 15 && y >= 5 && y < 15;
    const edge = inBox && (x === 5 || x === 14 || y === 5 || y === 14);
    const c = !inBox ? BG : edge ? OUTLINE : paint(x, y);
    data.set([...c, 255], (y * width + x) * 4);
  }
  const alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3];
  return { px: { data, width, height }, alpha };
}

test('keys out the border background and boxes the troop', () => {
  const { px, alpha } = image(() => [200, 200, 80]);
  assert.deepEqual(chromaKey(px), { x: 5, y: 5, w: 10, h: 10 });
  assert.equal(alpha(0, 0), 0);
  assert.equal(alpha(19, 10), 0);
  assert.equal(alpha(5, 5), 255);
  assert.equal(alpha(10, 10), 255);
});

test('a pink troop enclosed by its outline keeps its body', () => {
  const { px, alpha } = image(() => PINK);
  chromaKey(px);
  assert.equal(alpha(10, 10), 255);
});

test('magenta enclosed by the outline is keyed too', () => {
  const { px, alpha } = image((x, y) => (x >= 8 && x < 12 && y >= 8 && y < 12 ? BG : [200, 200, 80]));
  chromaKey(px);
  assert.equal(alpha(9, 9), 0);
  assert.equal(alpha(6, 6), 255);
});

test('an all-background image leaves nothing', () => {
  const { px } = image(() => BG);
  // The outline is still there, so blank the whole image.
  for (let i = 0; i < px.data.length; i += 4) px.data.set(BG, i);
  assert.equal(chromaKey(px), null);
});
