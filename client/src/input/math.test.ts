// One Euro filter and the camera → screen homography.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OneEuro } from './filter';
import { applyH, DEFAULT_H, fitHomography, invertH, residualPx, type Pt2 } from './homography';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('one euro: first sample passes through, a constant stays constant', () => {
  const f = new OneEuro(1, 0.007);
  assert.equal(f.filter(5, 0), 5);
  for (let i = 1; i < 50; i++) close(f.filter(5, i / 60), 5);
});

test('one euro: jitter on a still hand shrinks a lot', () => {
  const f = new OneEuro(1, 0.007);
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 10; // ±5 px
  const raw: number[] = [], out: number[] = [];
  for (let i = 0; i < 300; i++) {
    raw.push(500 + noise());
    out.push(f.filter(raw[i], i / 60));
  }
  const sd = (a: number[]) => {
    const m = a.reduce((s, v) => s + v, 0) / a.length;
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
  };
  const [r, o] = [sd(raw.slice(100)), sd(out.slice(100))];
  assert.ok(o < r / 3, `filtered sd ${o.toFixed(2)} px vs raw ${r.toFixed(2)} px`);
});

test('one euro: beta cuts lag on fast moves', () => {
  const lagAfterSweep = (beta: number) => {
    const f = new OneEuro(1, beta);
    let y = 0;
    for (let i = 0; i <= 30; i++) y = f.filter(i * 40, i / 60); // 2400 px/s sweep
    return 30 * 40 - y;
  };
  assert.ok(lagAfterSweep(0.007) < lagAfterSweep(0) / 2);
});

test('one euro: reset forgets the old position', () => {
  const f = new OneEuro();
  f.filter(0, 0);
  f.filter(0, 0.016);
  f.reset();
  assert.equal(f.filter(900, 0.032), 900);
});

const H0 = [1.2, 0.1, -0.1, -0.05, 1.4, -0.2, 0.15, -0.1, 1];

test('homography: fits 4 exact pairs and maps them back', () => {
  const src: Pt2[] = [[0.2, 0.2], [0.8, 0.25], [0.75, 0.8], [0.25, 0.7]];
  const dst = src.map(p => applyH(H0, p));
  const H = fitHomography(src, dst)!;
  assert.ok(H);
  src.forEach((p, i) => {
    const [u, v] = applyH(H, p);
    close(u, dst[i][0], 1e-9);
    close(v, dst[i][1], 1e-9);
  });
  // and points in between, which a plain affine fit would get wrong
  const [u, v] = applyH(H, [0.5, 0.5]), [eu, ev] = applyH(H0, [0.5, 0.5]);
  close(u, eu, 1e-9);
  close(v, ev, 1e-9);
  close(residualPx(H, src, dst, 1920, 1080), 0, 1e-6);
});

test('homography: least squares over 9 noisy points stays close', () => {
  const src: Pt2[] = [];
  for (const y of [0.2, 0.5, 0.8]) for (const x of [0.2, 0.5, 0.8]) src.push([x, y]);
  const dst = src.map((p, i) => {
    const [u, v] = applyH(H0, p);
    return [u + (i % 2 ? 0.002 : -0.002), v] as Pt2;
  });
  const H = fitHomography(src, dst)!;
  assert.ok(residualPx(H, src, dst, 1000, 1000) < 3);
});

test('homography: collinear points are degenerate', () => {
  const src: Pt2[] = [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3], [0.4, 0.4]];
  assert.equal(fitHomography(src, [[0, 0], [1, 0], [1, 1], [0, 1]]), null);
  assert.equal(fitHomography(src.slice(0, 3), [[0, 0], [1, 0], [1, 1]]), null);
});

test('homography: inverse round-trips', () => {
  const inv = invertH(H0)!;
  const [u, v] = applyH(inv, applyH(H0, [0.3, 0.6]));
  close(u, 0.3, 1e-9);
  close(v, 0.6, 1e-9);
});

test('default mapping: the middle of the frame is the touchpad', () => {
  const [a, b] = applyH(DEFAULT_H, [0.2, 0.15]);
  close(a, 0);
  close(b, 0);
  const [c, d] = applyH(DEFAULT_H, [0.8, 0.75]);
  close(c, 1);
  close(d, 1);
});
