// The control scheme's state machine: feed signal sequences in, check the intents that come out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinch } from './schemes/pinch';
import type { Intent, Pt, SchemeCtx, Signal } from './schemes/types';

interface World { menus: boolean; playing: boolean; cursor: Pt | null; waiting: string; camera: boolean; half: (p: Pt) => boolean }

function rig(w: Partial<World> = {}) {
  const world: World = { menus: false, playing: true, cursor: { x: 100, y: 400 }, waiting: '', camera: true, half: p => p.y > 300, ...w };
  const out: Intent[] = [];
  const ctx: SchemeCtx = {
    menus: () => world.menus, playing: () => world.playing, cursor: () => world.cursor,
    waiting: () => world.waiting, camera: () => world.camera, canDeployAt: p => world.half(p),
  };
  const inst = pinch.create(i => void out.push(i), ctx);
  const send = (s: Signal) => inst.on(s);
  const kinds = () => out.map(i => i.kind);
  return { world, out, inst, send, kinds };
}

test('how-to: one line', () => {
  assert.ok(pinch.howTo.length > 10 && pinch.howTo.length < 120);
});

test('pinch: onset commits once at its aim; menus get uiActivate', () => {
  const r = rig();
  r.send({ kind: 'pinch', t: 100, aim: { x: 40, y: 400 } });
  assert.deepEqual(r.out, [{ kind: 'commit', t: 100, by: 'pinch', at: { x: 40, y: 400 } }]);
  r.world.menus = true;
  r.send({ kind: 'pinch', t: 900, aim: { x: 3, y: 3 } });
  assert.deepEqual(r.out.at(-1), { kind: 'uiActivate', at: { x: 3, y: 3 } });
});

// A camera frame: thumbs-down score and whether the pinch measure says closed.
const frame = (t: number, thumbDown: number, pinched = false, pinchScore = pinched ? 1 : 0): Signal => ({
  kind: 'hand', t, visible: true, cursor: { x: 100, y: 400 }, overHalf: true, pinched,
  gestures: { Thumb_Down: thumbDown, Open_Palm: 0, Pointing_Up: 1, Pinch: pinchScore },
});

test('thumbs down: held 250 ms while a drop is pending cancels it, once', () => {
  const r = rig();
  r.send({ kind: 'deploy', t: 0, phase: 'pending', nonce: 1 });
  for (let t = 1000; t < 1240; t += 33) r.send(frame(t, 0.9));
  assert.deepEqual(r.kinds(), [], 'not yet 250 ms');
  for (let t = 1240; t < 1600; t += 33) r.send(frame(t, 0.9));
  assert.deepEqual(r.out, [{ kind: 'cancel', why: 'thumbsDown' }]);
});

test('thumbs down: a weak score, or one that drops out, never cancels', () => {
  const r = rig();
  r.send({ kind: 'deploy', t: 0, phase: 'pending', nonce: 1 });
  for (let t = 1000; t < 2000; t += 33) r.send(frame(t, 0.65));
  for (let t = 2000; t < 3000; t += 33) r.send(frame(t, (t / 33) % 6 < 5 ? 0.9 : 0.2)); // 165 ms runs
  assert.deepEqual(r.kinds(), []);
});

test('thumbs down: before a pinch it clears the words waiting, once', () => {
  const r = rig();
  r.world.waiting = 'goblin';
  for (let t = 0; t < 2000; t += 33) r.send(frame(t, 1));
  assert.deepEqual(r.out, [{ kind: 'clear', why: 'thumbsDown' }]);
});

test('thumbs down: nothing pending and no words does nothing', () => {
  const r = rig();
  for (let t = 0; t < 2000; t += 33) r.send(frame(t, 1));
  assert.deepEqual(r.kinds(), []);
});

test('thumbs down: a pinch sequence never cancels', () => {
  const r = rig();
  r.world.waiting = 'goblin';
  // Fingers curl in (fist-like, a middling thumbs-down score), the pinch closes and fires so the
  // drop goes pending, is held with a spurious high score, opens with the score still high inside
  // 400 ms of onset, then the open hand.
  let t = 0;
  for (; t < 300; t += 33) r.send(frame(t, 0.6 * (t / 300), false, t / 300));
  const onset = t;
  r.send(frame(t, 0.9, true));
  r.send({ kind: 'pinch', t, aim: { x: 100, y: 400 } });
  r.send({ kind: 'deploy', t, phase: 'pending', nonce: 1 });
  for (t += 33; t < onset + 800; t += 33) r.send(frame(t, 0.95, true)); // held pinched
  for (; t < onset + 1000; t += 33) r.send(frame(t, 0.3, false)); // letting go
  for (; t < onset + 2000; t += 33) r.send(frame(t, 0, false)); // open hand
  assert.deepEqual(r.kinds(), ['commit']);
  // A quick pinch released at once: the 400 ms after its onset are ignored even with a high score.
  const r2 = rig();
  r2.send({ kind: 'deploy', t: 0, phase: 'pending', nonce: 1 });
  r2.send(frame(1000, 0.9, true));
  r2.send({ kind: 'pinch', t: 1000, aim: { x: 1, y: 1 } });
  for (let u = 1033; u < 1399; u += 33) r2.send(frame(u, 0.9, false));
  assert.deepEqual(r2.kinds(), ['commit'], 'nothing in the 400 ms after pinch onset');
});

test('pinch: "cancel" takes back a pending deploy', () => {
  const r = rig();
  r.send({ kind: 'words', t: 0, text: 'cancel', final: true, waiting: '', cancel: true });
  assert.deepEqual(r.kinds(), []);
  r.send({ kind: 'deploy', t: 10, phase: 'pending', nonce: 1 });
  r.send({ kind: 'words', t: 20, text: 'cancel', final: true, waiting: '', cancel: true });
  assert.deepEqual(r.out.at(-1), { kind: 'cancel', why: 'said' });
});

test('pinch: Space fires at the cursor, a held Space only once, Esc clears, a click fires only with words', () => {
  const r = rig();
  r.send({ kind: 'key', t: 1, key: 'Space', repeat: false });
  r.send({ kind: 'key', t: 2, key: 'Space', repeat: true });
  r.send({ kind: 'key', t: 3, key: 'Escape', repeat: false });
  r.send({ kind: 'mouse', t: 4, at: { x: 9, y: 9 }, phase: 'down' });
  assert.deepEqual(r.kinds(), ['commit', 'clear']);
  r.world.waiting = 'goblin';
  r.send({ kind: 'mouse', t: 5, at: { x: 9, y: 9 }, phase: 'down' });
  assert.deepEqual(r.out[2], { kind: 'commit', t: 5, by: 'mouse', at: { x: 9, y: 9 } });
});

test('pinch: Space on a menu clicks at the fingertip', () => {
  const r = rig({ menus: true });
  r.send({ kind: 'hand', t: 0, visible: true, cursor: { x: 5, y: 6 }, overHalf: false, pinched: false, gestures: { Thumb_Down: 0, Open_Palm: 1, Pointing_Up: 1, Pinch: 0 } });
  r.send({ kind: 'key', t: 1, key: 'Space', repeat: false });
  assert.deepEqual(r.out, [{ kind: 'uiActivate', at: { x: 5, y: 6 }, fallback: true }]);
});
