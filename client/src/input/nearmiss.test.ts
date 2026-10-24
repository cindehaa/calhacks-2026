import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEAR_MISS, NearMiss } from './nearmiss';

// Feed a ratio sequence at 30 fps from t0; returns the times the hint fired and the next t.
function run(n: NearMiss, ratios: number[], t0 = 0, active = true): { fired: number[]; t: number } {
  const fired: number[] = [];
  let t = t0;
  for (const r of ratios) {
    if (n.push(t, r, active)) fired.push(t);
    t += 33;
  }
  return { fired, t };
}

// Open, most of the way closed (bottoming out at `low`), open again: about 0.4 s.
const attempt = (low = 0.52) => [0.9, 0.8, 0.7, 0.6, low, low, 0.6, 0.7, 0.8, 0.9].map(r => Math.max(r, low));
const pinch = () => [0.9, 0.7, 0.5, 0.4, 0.35, 0.5, 0.7, 0.9];

test('three near misses in a row show the hint once', () => {
  const n = new NearMiss();
  const { fired } = run(n, [...attempt(), ...attempt(), ...attempt()]);
  assert.equal(fired.length, 1);
});

test('two near misses are not enough', () => {
  const n = new NearMiss();
  assert.deepEqual(run(n, [...attempt(), ...attempt()]).fired, []);
  assert.equal(n.recent, 2);
});

test('a real pinch in between clears the count', () => {
  const n = new NearMiss();
  const { fired } = run(n, [...attempt(), ...attempt(), ...pinch(), ...attempt(), ...attempt()]);
  assert.deepEqual(fired, []);
});

test('dips that stay far from closed are not attempts', () => {
  const n = new NearMiss();
  const { fired } = run(n, [...attempt(0.68), ...attempt(0.68), ...attempt(0.68), ...attempt(0.68)]);
  assert.deepEqual(fired, []);
});

test('a hand resting half closed is not an attempt', () => {
  const n = new NearMiss();
  // Pointing with the thumb on the curled middle finger: hovers 0.5–0.6 and never opens.
  const rest = Array.from({ length: 300 }, (_, i) => 0.55 + 0.05 * Math.sin(i / 3));
  assert.deepEqual(run(n, rest).fired, []);
  // Held half closed longer than maxMs, then opened: still not an attempt.
  const slow = [0.9, ...Array(Math.ceil(NEAR_MISS.maxMs / 33) + 5).fill(0.55), 0.9];
  assert.deepEqual(run(n, [...slow, ...slow, ...slow]).fired, []);
});

test('attempts spread over more than the window do not add up', () => {
  const n = new NearMiss();
  let t = 0;
  for (let i = 0; i < 4; i++) {
    const r = run(n, attempt(), t);
    assert.deepEqual(r.fired, []);
    t = r.t + NEAR_MISS.windowMs / 2 + 100;
  }
});

test('only counts while active (over your half in a match)', () => {
  const n = new NearMiss();
  assert.deepEqual(run(n, [...attempt(), ...attempt(), ...attempt()], 0, false).fired, []);
  assert.equal(n.recent, 0);
});

test('losing the hand mid attempt drops that attempt', () => {
  const n = new NearMiss();
  let t = 0;
  for (let i = 0; i < 3; i++) {
    for (const r of [0.9, 0.7, 0.55, 0.52]) n.push((t += 33), r, true);
    assert.equal(n.push((t += 33), null, true), false);
    for (const r of [0.6, 0.9]) assert.equal(n.push((t += 33), r, true), false);
  }
  assert.equal(n.recent, 0);
});

test('rate limited: a cooldown between hints and a cap per page load', () => {
  const n = new NearMiss();
  const three = [...attempt(), ...attempt(), ...attempt()];
  let r = run(n, three);
  assert.equal(r.fired.length, 1);
  r = run(n, three, r.t); // straight after: cooling down
  assert.deepEqual(r.fired, []);
  let t = r.t + NEAR_MISS.cooldownMs;
  let shows = 1;
  for (let i = 0; i < 5; i++) {
    r = run(n, three, t);
    shows += r.fired.length;
    t = r.t + NEAR_MISS.cooldownMs;
  }
  assert.equal(shows, NEAR_MISS.maxShows);
});
