// Mic loudness VAD and the transcript → description rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseDescription, isCancel, Transcript } from './speech';
import { rmsDb, Vad, VAD_DEFAULTS } from './voice';

test('rms dB: full-scale sine is about -3 dB, silence is very low', () => {
  const sine = Array.from({ length: 1024 }, (_, i) => Math.sin((2 * Math.PI * i) / 64));
  assert.ok(Math.abs(rmsDb(sine) + 3.01) < 0.05);
  assert.ok(rmsDb(new Float32Array(1024)) < -100);
});

// Feed the VAD a level every 16 ms; returns the events with their times.
function feed(v: Vad, from: number, ms: number, db: number) {
  const out: { kind: string; t: number }[] = [];
  for (let t = from; t < from + ms; t += 16) {
    const e = v.push(t, db);
    if (e) out.push(e);
  }
  return out;
}

test('vad: 60 ms of sound starts speech, dated to when the sound began', () => {
  const v = new Vad({ ...VAD_DEFAULTS });
  assert.deepEqual(feed(v, 1000, 200, -70), []);
  const ev = feed(v, 1200, 100, -30);
  assert.deepEqual(ev, [{ kind: 'start', t: 1200 }]);
  assert.ok(v.speaking);
});

test('vad: a short click does not start speech', () => {
  const v = new Vad({ ...VAD_DEFAULTS });
  assert.deepEqual(feed(v, 1000, 40, -20), []);
  assert.deepEqual(feed(v, 1040, 200, -70), []);
  assert.equal(v.speaking, false);
});

test('vad: ends after 700 ms of quiet; gaps between words do not end it', () => {
  const v = new Vad({ ...VAD_DEFAULTS });
  feed(v, 1000, 200, -30);
  assert.deepEqual(feed(v, 1200, 400, -70), [], 'a pause between words');
  feed(v, 1600, 200, -30);
  const ev = feed(v, 1800, 900, -70);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, 'end');
  assert.ok(ev[0].t - 1800 >= 700 && ev[0].t - 1800 < 720, `ended at +${ev[0].t - 1800}`);
});

test('vad: the threshold is adjustable on site', () => {
  const v = new Vad({ ...VAD_DEFAULTS, thresholdDb: -25 });
  assert.deepEqual(feed(v, 1000, 200, -30), []);
  assert.equal(feed(v, 1200, 200, -20)[0]?.kind, 'start');
});

test('cancel phrases are whole utterances only', () => {
  for (const s of ['cancel', 'Cancel.', ' cancel that ', 'never mind', 'Nevermind!', 'cancel it'])
    assert.ok(isCancel(s), s);
  for (const s of ['cancel culture troll', 'a fire wizard', '', 'never'])
    assert.ok(!isCancel(s), s);
});

test('transcript joins finished segments and the one in progress', () => {
  const t = new Transcript();
  t.interim('a giant');
  assert.equal(t.text, 'a giant');
  t.final(' a giant frog'); // segments carry their own leading space, as the sources send them
  t.interim(' with a');
  assert.equal(t.text, 'a giant frog with a');
  t.interim('');
  assert.equal(t.text, 'a giant frog');
  t.reset();
  assert.equal(t.text, '');
});

test('description: spoken cancel, then typed text, then the transcript', () => {
  assert.deepEqual(chooseDescription('', 'cancel'), { ok: false, reason: 'cancel' });
  assert.deepEqual(chooseDescription('ice golem', 'cancel'), { ok: false, reason: 'cancel' });
  assert.deepEqual(chooseDescription(' ice golem ', 'fire wizard'), { ok: true, text: 'ice golem', from: 'typed' });
  assert.deepEqual(chooseDescription('', 'fire wizard'), { ok: true, text: 'fire wizard', from: 'voice' });
  assert.deepEqual(chooseDescription('  ', ''), { ok: false, reason: 'empty' });
});
