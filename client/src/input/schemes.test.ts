// Control scheme state machines: feed signal sequences in, check the intents that come out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AB_POOL, pickScheme, SCHEMES, schemeById } from './schemes/registry';
import { hanging, TALK } from './schemes/talk';
import type { Intent, Pt, SchemeCtx, Signal } from './schemes/types';

interface World { menus: boolean; playing: boolean; cursor: Pt | null; waiting: string; camera: boolean; half: (p: Pt) => boolean }

function rig(id: string, w: Partial<World> = {}) {
  const world: World = { menus: false, playing: true, cursor: { x: 100, y: 400 }, waiting: '', camera: true, half: p => p.y > 300, ...w };
  const out: Intent[] = [];
  const ctx: SchemeCtx = {
    menus: () => world.menus, playing: () => world.playing, cursor: () => world.cursor,
    waiting: () => world.waiting, camera: () => world.camera, canDeployAt: p => world.half(p),
  };
  const inst = schemeById(id)!.create(i => void out.push(i), ctx);
  const send = (s: Signal) => inst.on(s);
  const kinds = () => out.filter(i => i.kind !== 'aim').map(i => i.kind);
  return { world, out, inst, send, kinds };
}

const handAt = (t: number, at: Pt, overHalf = true): Signal => ({
  kind: 'hand', t, visible: true, cursor: at, knuckle: at, palm: at, overHalf,
  gestures: { Closed_Fist: 0, Open_Palm: 1, Pointing_Up: 0, Pinch: 0 },
});
const words = (t: number, waiting: string, cancel = false): Signal => ({ kind: 'words', t, text: waiting, final: false, waiting, cancel });

// Loud frames from a to b, then quiet frames from b to end, every 16 ms, with ticks.
function speak(send: (s: Signal) => void, a: number, b: number, end: number, said?: { at: number; text: string }) {
  for (let t = a; t < end; t += 16) {
    send({ kind: 'level', t, db: t < b ? -20 : -70, loud: t < b });
    if (said && t >= said.at && t < said.at + 16) send(words(t, said.text));
    send({ kind: 'tick', t });
  }
}

test('registry: unique ids, a how-to each, and the pool is real schemes', () => {
  assert.equal(new Set(SCHEMES.map(s => s.id)).size, SCHEMES.length);
  for (const s of SCHEMES) assert.ok(s.howTo.length > 10 && s.howTo.length < 90, s.id);
  for (const id of AB_POOL) assert.ok(schemeById(id), id);
  assert.deepEqual(AB_POOL, ['flick', 'talk', 'pinch']);
});

test('pickScheme: url, then picked, then random from the pool', () => {
  assert.equal(pickScheme('dwell', 'talk').scheme.id, 'dwell');
  assert.equal(pickScheme('nope', 'talk').scheme.id, 'talk');
  assert.equal(pickScheme(null, null, () => 0).scheme.id, 'flick');
  assert.equal(pickScheme(null, null, () => 0.5).scheme.id, 'talk');
  assert.equal(pickScheme(null, null, () => 0.99).scheme.id, 'pinch');
  assert.equal(pickScheme(null, null).how, 'random');
});

test('flick: flick commits at the aim, fist clears, menus get uiActivate', () => {
  const r = rig('flick');
  r.send({ kind: 'flick', t: 10, aim: { x: 5, y: 6 } });
  assert.deepEqual(r.out[0], { kind: 'commit', t: 10, by: 'flick', at: { x: 5, y: 6 } });
  r.send({ kind: 'fist', t: 20, closed: true });
  assert.deepEqual(r.out[1], { kind: 'clear', why: 'fist' });
  r.world.menus = true;
  r.send({ kind: 'flick', t: 30, aim: { x: 1, y: 2 } });
  assert.deepEqual(r.out[2], { kind: 'uiActivate', at: { x: 1, y: 2 } });
});

test('flick: Space fires at the cursor, a held Space only once, Esc clears, a click fires only with words', () => {
  const r = rig('flick');
  r.send({ kind: 'key', t: 1, key: 'Space', repeat: false });
  r.send({ kind: 'key', t: 2, key: 'Space', repeat: true });
  r.send({ kind: 'key', t: 3, key: 'Escape', repeat: false });
  r.send({ kind: 'mouse', t: 4, at: { x: 9, y: 9 }, phase: 'down' });
  assert.deepEqual(r.kinds(), ['commit', 'clear']);
  r.world.waiting = 'goblin';
  r.send({ kind: 'mouse', t: 5, at: { x: 9, y: 9 }, phase: 'down' });
  assert.deepEqual(r.out[2], { kind: 'commit', t: 5, by: 'mouse', at: { x: 9, y: 9 }, from: undefined });
});

test('talk: locks at speech start, commits after ~600 ms of quiet with the lock spot', () => {
  const r = rig('talk');
  r.send(handAt(0, { x: 100, y: 400 }));
  speak(r.send, 0, 800, 800 + TALK.silenceMs - 50, { at: 400, text: 'a big goblin' });
  assert.deepEqual(r.kinds(), ['lock'], 'not yet: still inside the silence window');
  const lock = r.out.find(i => i.kind === 'lock')!;
  assert.deepEqual(lock, { kind: 'lock', at: { x: 100, y: 400 }, t: 0 });
  r.send(handAt(900, { x: 300, y: 500 })); // the hand wanders; the spot stays locked
  speak(r.send, 1350, 1350, 1500);
  const c = r.out.find(i => i.kind === 'commit');
  assert.ok(c && c.kind === 'commit');
  assert.deepEqual(c.at, { x: 100, y: 400 });
  assert.equal(c.from, 0);
  assert.equal(c.by, 'talk');
  assert.equal(r.kinds().filter(k => k === 'commit').length, 1);
});

test('talk: an unfinished last word waits longer', () => {
  assert.ok(hanging('a giant with'));
  assert.ok(hanging('three goblins and'));
  assert.ok(hanging('a swarm of'));
  assert.ok(hanging('give me a'));
  assert.ok(!hanging('a giant with a club'));
  const r = rig('talk');
  r.send(handAt(0, { x: 100, y: 400 }));
  speak(r.send, 0, 800, 800 + TALK.silenceMs + 200, { at: 400, text: 'a giant with' });
  assert.ok(!r.kinds().includes('commit'), 'hanging word: 800 ms of quiet is not enough');
  speak(r.send, 1600, 1600, 800 + TALK.hangingMs + 50);
  assert.ok(r.kinds().includes('commit'));
});

test('talk: the intent gate ignores speech with the hand down or pointing off your half', () => {
  const off = rig('talk');
  off.send(handAt(0, { x: 100, y: 100 }, false));
  speak(off.send, 0, 800, 2000, { at: 400, text: 'goblin' });
  assert.deepEqual(off.kinds(), []);
  const down = rig('talk');
  down.send({ kind: 'hand', t: 0, visible: false });
  speak(down.send, 0, 800, 2000, { at: 400, text: 'goblin' });
  assert.deepEqual(down.kinds(), []);
  const menu = rig('talk', { menus: true });
  menu.send(handAt(0, { x: 100, y: 400 }));
  speak(menu.send, 0, 800, 2000, { at: 400, text: 'goblin' });
  assert.deepEqual(menu.kinds(), []);
  // No camera: the mouse over your half opens it.
  const mouse = rig('talk', { camera: false, cursor: { x: 10, y: 500 } });
  speak(mouse.send, 0, 800, 2000, { at: 400, text: 'goblin' });
  assert.deepEqual(mouse.kinds(), ['lock', 'commit']);
});

test('talk: silence with no words drops the lock without committing', () => {
  const r = rig('talk');
  r.send(handAt(0, { x: 100, y: 400 }));
  speak(r.send, 0, 200, 200 + TALK.giveUpMs + 100);
  assert.deepEqual(r.kinds(), ['lock']);
  assert.equal(r.inst.locked?.(), null);
});

test('talk: fist or flick during the summoning circle cancels; "cancel" too; Space fires now', () => {
  const r = rig('talk');
  r.send({ kind: 'deploy', t: 0, phase: 'pending', nonce: 7 });
  r.send({ kind: 'fist', t: 10, closed: true });
  r.send({ kind: 'flick', t: 20, aim: { x: 1, y: 1 } });
  r.send(words(30, 'cancel', true));
  assert.deepEqual(r.kinds(), ['cancel', 'cancel', 'cancel']);
  r.send({ kind: 'deploy', t: 40, phase: 'sent', nonce: 7 });
  r.send({ kind: 'flick', t: 50, aim: { x: 1, y: 1 } });
  assert.equal(r.kinds().length, 3, 'once deploy_troop went out a flick does nothing');
  r.send({ kind: 'key', t: 60, key: 'Space', repeat: false });
  assert.equal(r.out.at(-1)?.kind, 'commit');
});

test('pinch: onset commits once at the knuckle aim; menus get uiActivate', () => {
  const r = rig('pinch');
  r.send({ kind: 'pinch', t: 100, aim: { x: 40, y: 400 } });
  assert.deepEqual(r.out.filter(i => i.kind === 'commit'), [{ kind: 'commit', t: 100, by: 'pinch', at: { x: 40, y: 400 } }]);
  r.world.menus = true;
  r.send({ kind: 'pinch', t: 900, aim: { x: 3, y: 3 } });
  assert.deepEqual(r.out.at(-1), { kind: 'uiActivate', at: { x: 3, y: 3 } });
});

test('pinch: a fist cancels only while the deploy is pending', () => {
  const r = rig('pinch');
  r.send({ kind: 'fist', t: 0, closed: true });
  assert.deepEqual(r.kinds(), ['clear'], 'nothing pending: a fist just clears the words');
  r.send({ kind: 'deploy', t: 10, phase: 'pending', nonce: 1 });
  r.send({ kind: 'fist', t: 20, closed: true });
  assert.deepEqual(r.out.at(-1), { kind: 'cancel', why: 'fist' });
  r.send({ kind: 'deploy', t: 30, phase: 'sent', nonce: 1 });
  r.send({ kind: 'fist', t: 40, closed: true });
  assert.notEqual(r.out.at(-1)?.kind, 'cancel');
  r.send({ kind: 'deploy', t: 50, phase: 'pending', nonce: 2 });
  r.send({ kind: 'flick', t: 60, aim: { x: 0, y: 0 } });
  assert.deepEqual(r.out.at(-1), { kind: 'cancel', why: 'flick' });
});

test('fist: aims with the palm, a closed fist commits from just before it closed', () => {
  const r = rig('fist');
  for (let t = 0; t <= 600; t += 20) r.send(handAt(t, { x: t < 400 ? 50 : 90, y: 400 }));
  r.send({ kind: 'fist', t: 600, closed: true });
  const c = r.out.find(i => i.kind === 'commit');
  assert.ok(c && c.kind === 'commit');
  assert.deepEqual(c.at, { x: 50, y: 400 });
  assert.ok(r.out.some(i => i.kind === 'aim'));
});

test('dwell: holding still with words waiting commits once, after ~0.6 s', () => {
  const r = rig('dwell', { waiting: 'goblin' });
  for (let t = 0; t <= 500; t += 16) { r.send(handAt(t, { x: 100 + (t % 3), y: 400 })); r.send({ kind: 'tick', t }) }
  assert.deepEqual(r.kinds(), []);
  assert.ok((r.inst.ring?.(500)?.k ?? 0) > 0.7);
  for (let t = 516; t <= 1500; t += 16) { r.send(handAt(t, { x: 100, y: 400 })); r.send({ kind: 'tick', t }) }
  assert.deepEqual(r.kinds(), ['commit']);
});

test('dwell: no words, no commit', () => {
  const r = rig('dwell');
  for (let t = 0; t <= 2000; t += 16) { r.send(handAt(t, { x: 100, y: 400 })); r.send({ kind: 'tick', t }) }
  assert.deepEqual(r.kinds(), []);
});

test('keys: ignores the hand, fires at the mouse', () => {
  const r = rig('keys', { waiting: 'goblin' });
  r.send({ kind: 'flick', t: 0, aim: { x: 1, y: 1 } });
  r.send({ kind: 'fist', t: 0, closed: true });
  r.send({ kind: 'mouse', t: 1, at: { x: 7, y: 8 }, phase: 'move' });
  r.send({ kind: 'key', t: 2, key: 'Space', repeat: false });
  assert.deepEqual(r.out.filter(i => i.kind === 'commit').map(i => (i as { at?: Pt }).at), [{ x: 7, y: 8 }]);
});
