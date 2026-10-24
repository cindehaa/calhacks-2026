import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LockMachine, CursorHistory, type Lock, type Pt } from './lock';

// Drives a machine at 60 fps and records what it reports.
function rig(accept: (l: Lock) => boolean = () => true) {
  const log: string[] = [];
  const locks: Lock[] = [];
  const m = new LockMachine({
    onLock: l => {
      const ok = accept(l);
      if (ok) {
        locks.push({ ...l });
        log.push(`lock ${l.by} ${l.x},${l.y}`);
      }
      return ok;
    },
    onDeploy: l => log.push(`deploy ${l.x},${l.y}`),
    onCancel: (_l, why) => log.push(`cancel ${why}`),
  });
  let t = 1000;
  const frames = (ms: number, cursor: Pt | null, pinched: boolean, hand = true) => {
    for (const end = t + ms; t < end; t += 16) m.frame(t, { cursor, hand, pinched });
  };
  return { m, log, locks, frames, now: () => t, wait: (ms: number) => (t += ms) };
}

test('pinch locks and release in place deploys', () => {
  const r = rig();
  r.frames(300, { x: 100, y: 100 }, false);
  r.frames(200, { x: 100, y: 100 }, true);
  assert.deepEqual(r.log, ['lock pinch 100,100']);
  r.frames(50, { x: 110, y: 100 }, false);
  assert.deepEqual(r.log, ['lock pinch 100,100', 'deploy 100,100']);
  assert.equal(r.m.lock, null);
});

test('lock uses the cursor from ~100 ms before the pinch, not where the pinch moved it', () => {
  const r = rig();
  r.frames(300, { x: 100, y: 100 }, false);
  r.frames(80, { x: 140, y: 120 }, false); // the closing fingers drag the knuckle
  r.frames(50, { x: 140, y: 120 }, true);
  assert.equal(r.locks[0].x, 100);
  assert.equal(r.locks[0].y, 100);
});

test('release outside the 150 px ring cancels (drag-off)', () => {
  const r = rig();
  r.frames(300, { x: 100, y: 100 }, false);
  r.frames(100, { x: 100, y: 100 }, true);
  r.frames(400, { x: 300, y: 100 }, true);
  assert.ok(r.m.dragDistance(r.now()) > 150);
  r.frames(50, { x: 300, y: 100 }, false);
  assert.deepEqual(r.log, ['lock pinch 100,100', 'cancel drag']);
});

test('release is judged before the release flick: a fast jump at let-go still deploys', () => {
  const r = rig();
  r.frames(300, { x: 100, y: 100 }, false);
  r.frames(300, { x: 120, y: 100 }, true);
  r.m.frame(r.now(), { cursor: { x: 400, y: 100 }, hand: true, pinched: false });
  assert.deepEqual(r.log, ['lock pinch 100,100', 'deploy 100,100']);
});

test('drag back inside the ring before letting go deploys', () => {
  const r = rig();
  r.frames(300, { x: 100, y: 100 }, false);
  r.frames(100, { x: 100, y: 100 }, true);
  r.frames(300, { x: 300, y: 100 }, true);
  r.frames(300, { x: 140, y: 100 }, true);
  r.frames(50, { x: 140, y: 100 }, false);
  assert.deepEqual(r.log, ['lock pinch 100,100', 'deploy 100,100']);
});

test('losing the hand for over 250 ms cancels', () => {
  const r = rig();
  r.frames(300, { x: 100, y: 100 }, false);
  r.frames(100, { x: 100, y: 100 }, true);
  r.frames(200, null, false, false);
  assert.equal(r.log.length, 1, 'a short dropout is tolerated');
  r.frames(100, null, false, false);
  assert.deepEqual(r.log, ['lock pinch 100,100', 'cancel hand lost']);
});

test('a short dropout then release still deploys', () => {
  const r = rig();
  r.frames(300, { x: 100, y: 100 }, false);
  r.frames(100, { x: 100, y: 100 }, true);
  r.frames(150, null, false, false);
  r.frames(50, { x: 100, y: 100 }, false);
  assert.deepEqual(r.log, ['lock pinch 100,100', 'deploy 100,100']);
});

test('a hand entering the frame already pinched does not lock', () => {
  const r = rig();
  r.frames(300, { x: 100, y: 100 }, true);
  assert.deepEqual(r.log, []);
  r.frames(100, { x: 100, y: 100 }, false);
  r.frames(100, { x: 100, y: 100 }, true);
  assert.deepEqual(r.log, ['lock pinch 100,100']);
});

test('a refused spot (enemy half) does not lock and release does nothing', () => {
  const r = rig(l => l.y > 200);
  r.frames(300, { x: 100, y: 100 }, false);
  r.frames(100, { x: 100, y: 100 }, true);
  r.frames(100, { x: 100, y: 100 }, false);
  assert.deepEqual(r.log, []);
});

test('voice locks at the cursor from when the sound began, quiet deploys', () => {
  const r = rig();
  r.frames(300, { x: 50, y: 50 }, false, false);
  const began = r.now() - 10; // sound began while the mouse was still here
  r.frames(60, { x: 80, y: 50 }, false, false); // VAD confirms 60 ms later; the mouse moved on
  r.m.speechStart(began);
  assert.deepEqual(r.log, ['lock voice 50,50']);
  assert.equal(r.locks[0].hand, false);
  r.frames(1000, { x: 80, y: 50 }, false, false);
  assert.equal(r.log.length, 1, 'no hand-lost cancel for a mouse-aimed voice lock');
  r.m.speechEnd();
  assert.deepEqual(r.log, ['lock voice 50,50', 'deploy 50,50']);
});

test('voice lock: pointing away before going quiet cancels', () => {
  const r = rig();
  r.frames(300, { x: 50, y: 50 }, false);
  r.m.speechStart(r.now());
  r.frames(300, { x: 400, y: 50 }, false);
  r.m.speechEnd();
  assert.deepEqual(r.log, ['lock voice 50,50', 'cancel drag']);
});

test('saying cancel beats the quiet timer', () => {
  const r = rig();
  r.frames(300, { x: 50, y: 50 }, false);
  r.m.speechStart(r.now());
  r.m.cancel('cancelled');
  r.m.speechEnd();
  assert.deepEqual(r.log, ['lock voice 50,50', 'cancel cancelled']);
});

test('pinching during a voice lock hands it to the pinch', () => {
  const r = rig();
  r.frames(300, { x: 50, y: 50 }, false);
  r.m.speechStart(r.now());
  r.frames(100, { x: 50, y: 50 }, true);
  r.m.speechEnd();
  assert.equal(r.log.length, 1, 'quiet does not deploy a pinch-held lock');
  r.frames(50, { x: 50, y: 50 }, false);
  assert.deepEqual(r.log, ['lock voice 50,50', 'deploy 50,50']);
});

test('speech during a pinch lock does not start a second lock', () => {
  const r = rig();
  r.frames(300, { x: 100, y: 100 }, false);
  r.frames(100, { x: 100, y: 100 }, true);
  r.m.speechStart(r.now());
  r.m.speechEnd();
  assert.deepEqual(r.log, ['lock pinch 100,100']);
});

test('no cursor, no voice lock', () => {
  const r = rig();
  r.m.speechStart(r.now());
  assert.deepEqual(r.log, []);
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

test('mouse press locks where pressed, release in place deploys', () => {
  const r = rig();
  r.m.press(r.now(), { x: 200, y: 300 });
  assert.deepEqual(r.log, ['lock mouse 200,300']);
  r.m.pressMove({ x: 230, y: 310 });
  r.m.pressEnd({ x: 230, y: 310 });
  assert.deepEqual(r.log, ['lock mouse 200,300', 'deploy 200,300']);
  assert.equal(r.m.lock, null);
});

test('mouse drag past the ring cancels, and the ring follows the mouse, not the hand', () => {
  const r = rig();
  r.m.press(r.now(), { x: 200, y: 300 });
  r.frames(100, { x: 210, y: 300 }, false); // a hand in view doesn't move a mouse lock
  r.m.pressMove({ x: 400, y: 300 });
  assert.ok(r.m.dragDistance(r.now()) > 150);
  r.m.pressEnd({ x: 400, y: 300 });
  assert.deepEqual(r.log, ['lock mouse 200,300', 'cancel drag']);
});

test('a mouse lock ignores pinches and quiet; a press during a pinch lock does nothing', () => {
  const r = rig();
  r.m.press(r.now(), { x: 200, y: 300 });
  r.frames(100, { x: 200, y: 300 }, true);
  r.frames(100, { x: 200, y: 300 }, false);
  r.m.speechEnd();
  assert.deepEqual(r.log, ['lock mouse 200,300']);
  r.m.pressEnd({ x: 200, y: 300 });
  r.frames(300, { x: 50, y: 50 }, false);
  r.frames(100, { x: 50, y: 50 }, true);
  r.m.press(r.now(), { x: 500, y: 500 });
  r.m.pressEnd({ x: 500, y: 500 });
  assert.deepEqual(r.log, ['lock mouse 200,300', 'deploy 200,300', 'lock pinch 50,50']);
});

test('a refused mouse press leaves no lock, so its release does nothing', () => {
  const r = rig(() => false);
  r.m.press(r.now(), { x: 200, y: 300 });
  r.m.pressEnd({ x: 200, y: 300 });
  assert.deepEqual(r.log, []);
  assert.equal(r.m.lock, null);
});
