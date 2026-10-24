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

test('pinch: a fist cancels while the deploy is pending, else clears the words', () => {
  const r = rig();
  r.send({ kind: 'fist', t: 0, closed: true });
  assert.deepEqual(r.kinds(), ['clear'], 'nothing pending: a fist just clears the words');
  r.send({ kind: 'deploy', t: 10, phase: 'pending', nonce: 1 });
  r.send({ kind: 'fist', t: 20, closed: true });
  assert.deepEqual(r.out.at(-1), { kind: 'cancel', why: 'fist' });
  r.send({ kind: 'deploy', t: 30, phase: 'sent', nonce: 1 });
  r.send({ kind: 'fist', t: 40, closed: true });
  assert.deepEqual(r.out.at(-1), { kind: 'clear', why: 'fist' }, 'too late to take back');
  r.send({ kind: 'fist', t: 50, closed: false });
  assert.equal(r.out.length, 3, 'an opening hand does nothing');
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
  r.send({ kind: 'hand', t: 0, visible: true, cursor: { x: 5, y: 6 }, overHalf: false, gestures: { Closed_Fist: 0, Open_Palm: 1, Pointing_Up: 1, Pinch: 0 } });
  r.send({ kind: 'key', t: 1, key: 'Space', repeat: false });
  assert.deepEqual(r.out, [{ kind: 'uiActivate', at: { x: 5, y: 6 }, fallback: true }]);
});
