import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLICK_MS, gated, PreRoll, voiceLocks, wasClick } from './ptt';

test('pre-roll keeps only the newest chunks and empties on take', () => {
  const p = new PreRoll<number>(3);
  for (let i = 1; i <= 5; i++) p.push(i);
  assert.equal(p.size, 3);
  assert.deepEqual(p.take(), [3, 4, 5]);
  assert.deepEqual(p.take(), []);
  p.push(9);
  p.clear();
  assert.equal(p.size, 0);
});

test('camera on means the pinch is the talk button; voice click is opt-in', () => {
  assert.equal(voiceLocks(true, false), false);
  assert.equal(voiceLocks(true, true), true);
  assert.equal(voiceLocks(false, false), true); // no camera: talking is the hands-free way in
  assert.equal(gated(true, voiceLocks(true, false)), true);
  assert.equal(gated(true, voiceLocks(false, false)), false);
  assert.equal(gated(false, false), false); // mic off: nothing to gate
});

test('a quick empty press is a click; anything held, heard or typed is a talk', () => {
  assert.equal(wasClick(120, '', ''), true);
  assert.equal(wasClick(CLICK_MS + 1, '', ''), false);
  assert.equal(wasClick(120, 'goblin', ''), false);
  assert.equal(wasClick(120, '', 'a goblin'), false);
  assert.equal(wasClick(120, '  ', ' '), true);
});
