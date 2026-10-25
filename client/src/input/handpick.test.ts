import assert from 'node:assert/strict';
import test from 'node:test';
import { features, HandPicker, LOSE_MS, sideFromLabel, type HandIn, type Side } from './handpick';
import type { Landmark } from './pose';

// A synthetic 21-landmark hand centred near (cx, cy) in the unmirrored frame. 'point': index out,
// the rest curled. 'grip': all four wrapped round something, thumb tucked. 'open': all out.
function hand(cx: number, cy: number, pose: 'point' | 'grip' | 'open', side: Side | null = null): HandIn {
  const P = (x: number, y: number): Landmark => ({ x: cx + x, y: cy + y, z: 0 });
  const out = (kx: number, ky: number) => [P(kx, ky - 0.03), P(kx, ky - 0.05), P(kx, ky - 0.07)];
  const curl = (kx: number, ky: number) => [P(kx, ky - 0.015), P(kx, ky + 0.005), P(kx, ky + 0.02)];
  const knuckles: [number, number][] = [[-0.025, 0], [0, -0.005], [0.02, 0], [0.04, 0.01]];
  const thumb = pose === 'grip' ? [P(-0.03, 0.06), P(-0.04, 0.035), P(-0.03, 0.015), P(-0.015, 0.01)]
    : [P(-0.03, 0.06), P(-0.05, 0.03), P(-0.06, 0), P(-0.065, -0.02)];
  const lm: Landmark[] = [P(0, 0.08), ...thumb];
  knuckles.forEach(([kx, ky], i) => {
    const straight = pose === 'open' || (pose === 'point' && i === 0);
    lm.push(P(kx, ky), ...(straight ? out(kx, ky) : curl(kx, ky)));
  });
  const world = lm.map(p => ({ x: p.x - cx, y: p.y - cy, z: 0 }));
  return { lm, world, side };
}

test('synthetic poses read as intended', () => {
  const p = features(hand(0.5, 0.5, 'point')), g = features(hand(0.5, 0.35, 'grip'));
  assert.ok(p.pointing > 0.8 && !p.grip && p.overBoard);
  assert.ok(g.grip && g.nearMouth && g.pointing === 0);
  assert.ok(!features(hand(0.3, 0.7, 'grip')).nearMouth);
});

test('MediaPipe labels are mirrored', () => {
  assert.equal(sideFromLabel('Left'), 'left');
  assert.equal(sideFromLabel('Right'), 'right');
  assert.equal(sideFromLabel(undefined), null);
});

test('a pointing hand beats a grip near the mouth, whichever comes first in the list', () => {
  const mic = hand(0.5, 0.35, 'grip', 'left'), aim = hand(0.35, 0.55, 'point', 'right');
  assert.equal(new HandPicker().update([mic, aim], 0).control, 1);
  assert.equal(new HandPicker().update([aim, mic], 0).control, 0);
  // The mic hand alone is never chosen.
  const r = new HandPicker().update([mic], 0);
  assert.equal(r.control, -1);
  assert.equal(r.reasons[0], 'grip near mouth');
});

test('the control hand stays in control while it pinches, closes or gives a thumbs down', () => {
  const pk = new HandPicker();
  const other = hand(0.7, 0.6, 'open', 'left');
  assert.equal(pk.update([hand(0.35, 0.55, 'point', 'right'), other], 0).control, 0);
  // Fingers curl (thumbs down, a pinch) in the middle of the frame: still the control hand.
  assert.equal(pk.update([other, hand(0.4, 0.5, 'grip', 'right')], 33).control, 1);
});

test('stickiness survives a brief overlap', () => {
  const pk = new HandPicker();
  const mic = (x: number) => hand(x, 0.4, 'open', 'left'); // not a grip, so only stickiness keeps it out
  assert.equal(pk.update([hand(0.3, 0.55, 'point', 'right'), mic(0.6)], 0).control, 0);
  // The hands cross: the control hand drops out for 200 ms and only the other is seen, nearby.
  let t = 0;
  for (; t <= 200; t += 33) assert.equal(pk.update([mic(0.45)], t).control, -1, 'no takeover while the control hand is briefly hidden');
  // It comes back next to the other hand, listed second; handedness and position find it.
  assert.equal(pk.update([mic(0.47), hand(0.42, 0.5, 'point', 'right')], t).control, 1);
  // But lost for longer than LOSE_MS, the other hand may take over.
  const t2 = t + LOSE_MS + 50;
  pk.update([mic(0.5)], t + 10);
  assert.equal(pk.update([mic(0.5)], t2).control, 0);
});

test('a hand gripping still for over a second is dropped for a pointing hand', () => {
  const pk = new HandPicker();
  const mic = hand(0.25, 0.75, 'grip', 'left'); // low and to the side: not near the mouth
  assert.equal(pk.update([mic], 0).control, 0); // picked up the mic first
  for (let t = 33; t < 1000; t += 33) pk.update([mic], t);
  assert.equal(pk.update([mic, hand(0.6, 0.5, 'point', 'right')], 1100).control, 1);
  // A fresh choice never picks a hand that has gripped still for over a second.
  const fresh = new HandPicker();
  for (let t = 0; t <= 1100; t += 33) fresh.update([mic], t + 5000);
  fresh.reset();
  const r = fresh.update([mic], 0);
  assert.equal(r.control, 0, 'reset forgets the history'); // a reset (pref change) starts over
});

test('a Left or Right preference only accepts that hand', () => {
  const left = hand(0.35, 0.55, 'point', 'left'), right = hand(0.65, 0.55, 'point', 'right');
  const pk = new HandPicker();
  pk.pref = 'right';
  assert.equal(pk.update([left, right], 0).control, 1);
  assert.equal(pk.update([left], 500).control, -1);
  pk.reset();
  pk.pref = 'left';
  assert.equal(pk.update([left, right], 0).control, 0);
  assert.equal(pk.update([right], 1000).control, -1);
  // Even a perfect pointing right hand loses to a left hand that isn't pointing.
  assert.equal(pk.update([right, hand(0.4, 0.7, 'open', 'left')], 2000).control, 1);
});
