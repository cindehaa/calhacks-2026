import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Drops, releaseToStats, timingLines } from './drops';

test('a voice drop shows nothing while held, then words, designing, the name, and clears on deploy', () => {
  const d = new Drops();
  d.begin(7, [4, 20], 1000);
  assert.deepEqual(d.views(1100), []); // the input layer draws the held lock
  d.release(7, 'fire', 1800);
  assert.equal(d.views(1850)[0].phase, 'hearing');
  assert.equal(d.views(1850)[0].text, '“fire”');
  d.heard(7, 'fire wizard', 1900);
  let v = d.views(1950)[0];
  assert.equal(v.phase, 'designing');
  assert.equal(v.text, '“fire wizard”');
  assert.equal(v.sub, 'designing…');
  d.designed(7, 'Ember Mage', 'early', 3100);
  v = d.views(3110)[0];
  assert.equal(v.sub, 'Ember Mage');
  d.deployed(7, 3120);
  assert.deepEqual(d.views(3130), []);
  assert.equal(releaseToStats(d.get(7)!), 1300);
});

test('typed text releases and hears at once', () => {
  const d = new Drops();
  d.begin(1, [9, 20], 500);
  d.heard(1, 'bee swarm', 500);
  assert.equal(d.get(1)!.t.release, 500);
  d.designed(1, 'Buzz Cloud', '', 2100);
  assert.equal(releaseToStats(d.get(1)!), 1600);
});

test('a refusal shows briefly with what it would have cost; cancels show nothing', () => {
  const d = new Drops();
  d.begin(1, [9, 20], 0);
  d.heard(1, 'god', 100);
  d.designed(1, 'Sky Titan', '', 1500);
  d.refused(1, 'would cost 14, over 10', 1510);
  assert.equal(d.views(2000)[0].sub, 'would cost 14, over 10');
  assert.deepEqual(d.views(3000), []);
  d.begin(2, [9, 20], 3000);
  d.cancelled(2);
  d.release(2, 'late words', 3100); // a release after a cancel doesn't bring it back
  assert.deepEqual(d.views(3100), []);
});

test('timing lines skip held and cancelled drops, newest first, and keep the last six', () => {
  const d = new Drops();
  for (let i = 0; i < 8; i++) {
    d.begin(i, [9, 20], i * 1000);
    d.heard(i, `troop ${i}`, i * 1000 + 400);
  }
  d.begin(99, [9, 20], 9000); // still held
  const lines = timingLines(d.list);
  assert.equal(d.list.length, 6);
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^troop 7: held 400 · →heard 0 · →stats … · →art …$/);
});

test('a typed drop says so instead of a zero hold', () => {
  const d = new Drops();
  d.begin(1, [9, 20], 500);
  d.heard(1, 'bee swarm', 500);
  d.designed(1, 'Buzz Cloud', '', 1600);
  assert.equal(timingLines(d.list)[0], 'Buzz Cloud: typed · →stats 1100 · →art …');
});
