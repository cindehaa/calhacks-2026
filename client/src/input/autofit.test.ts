import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoFit } from './autofit';
import { PINCH_DEFAULTS, PinchDetector } from './pose';

// A second of open hand, then a dip down to `low` and back: about 1.4 s at 30 fps.
const cycle = (open: number, low: number) => [
  ...Array(30).fill(open),
  ...[0.8, 0.6, 0.4, 0.2, 0, 0, 0, 0.2, 0.4, 0.6, 0.8].map(k => low + (open - low) * k),
];

function run(a: AutoFit, ratios: number[], t0 = 0) {
  let t = t0, fit = null;
  for (const r of ratios) {
    fit = a.push(t, r, PINCH_DEFAULTS) ?? fit;
    t += 33;
  }
  return { fit, t };
}

test('a hand whose pinch never reaches the default line gets fitted to it', () => {
  // Open at 1.0, closest at 0.5: never under the default 0.45, so nothing would ever fire.
  const ratios = Array.from({ length: 5 }, () => cycle(1.0, 0.5)).flat();
  const { fit } = run(new AutoFit(), ratios);
  assert.ok(fit, 'proposes a fit');
  assert.ok(fit!.on > 0.5, `on ${fit!.on} closes above the dips' bottom`);
  // And with it, the same dip now registers as a pinch.
  const d = new PinchDetector();
  d.setThresholds(fit!);
  assert.ok(cycle(1.0, 0.5).some((r, i) => d.push(r, i * 33)));
});

test('three dips are not enough', () => {
  const ratios = Array.from({ length: 3 }, () => cycle(1.0, 0.5)).flat();
  assert.equal(run(new AutoFit(), ratios).fit, null);
});

test('a hand the defaults already suit is left alone', () => {
  // Open 0.85, pinched 0.15: fitPinch gives on 0.43, off 0.61, within 0.05 of 0.45 / 0.65.
  const ratios = Array.from({ length: 6 }, () => cycle(0.85, 0.15)).flat();
  assert.equal(run(new AutoFit(), ratios).fit, null);
});

test('losing the hand mid-dip throws that dip away', () => {
  const a = new AutoFit();
  const half = (c: number[]) => c.slice(0, 35);
  const ratios: (number | null)[] = [];
  for (let i = 0; i < 6; i++) ratios.push(...half(cycle(1.0, 0.5)), null);
  let t = 0, fit = null;
  for (const r of ratios) {
    fit = a.push(t, r, PINCH_DEFAULTS) ?? fit;
    t += 33;
  }
  assert.equal(fit, null);
});

test('after a fit, none again during the cooldown', () => {
  const a = new AutoFit();
  const { fit, t } = run(a, Array.from({ length: 5 }, () => cycle(1.0, 0.5)).flat());
  assert.ok(fit);
  // Dips that would fit differently, straight after: held back.
  assert.equal(run(a, Array.from({ length: 4 }, () => cycle(1.0, 0.3)).flat(), t).fit, null);
});
