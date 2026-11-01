import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSpeechSource } from './speech';

// A stand-in for the browser's SpeechRecognition: records starts, and lets the test fire events.
class FakeRec {
  static all: FakeRec[] = [];
  continuous = false; interimResults = false; lang = '';
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  constructor() { FakeRec.all.push(this) }
  start() { this.starts++ }
  stop() {}
  fail(error: string) { this.onerror?.({ error }); this.onend?.() }
  say(text: string) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }) }
}

function source() {
  FakeRec.all = [];
  (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRec;
  const s = new WebSpeechSource();
  const dead: string[] = [];
  s.onUnavailable = why => dead.push(why);
  s.start();
  return { s, rec: FakeRec.all[0], dead };
}

test('a recogniser that fails with network twice running gives up and stops restarting', () => {
  const { s, rec, dead } = source();
  rec.fail('network');
  assert.deepEqual(dead, []);
  assert.equal(rec.starts, 2); // restarted after the first
  rec.fail('network');
  assert.equal(dead.length, 1);
  assert.match(dead[0], /Arc and Brave/);
  assert.equal(rec.starts, 2); // not again
  assert.equal(s.available, false);
});

test('words between network errors mean it works', () => {
  const { rec, dead } = source();
  rec.fail('network');
  rec.say('a fire dragon');
  rec.fail('network');
  assert.deepEqual(dead, []);
});

test('blocked is final at once', () => {
  const { rec, dead } = source();
  rec.fail('not-allowed');
  assert.equal(dead.length, 1);
  assert.match(dead[0], /blocked/);
});

test('silence is not a failure', () => {
  const { rec, dead } = source();
  for (let i = 0; i < 5; i++) rec.fail('no-speech');
  assert.deepEqual(dead, []);
});
