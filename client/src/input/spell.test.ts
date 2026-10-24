// Spoken room codes → letters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spokenLetters } from './spell';

test('spell: separate letters, run-together letters and sound-alikes', () => {
  assert.equal(spokenLetters('A B C D'), 'ABCD');
  assert.equal(spokenLetters('a. b, c, d.'), 'ABCD');
  assert.equal(spokenLetters('XKCD'), 'XKCD');
  assert.equal(spokenLetters('bee see dee why'), 'BCDY');
  assert.equal(spokenLetters('Kay are Queue Tea'), 'KRQT');
  assert.equal(spokenLetters('double you, ex, zed'), 'WXZ');
});

test('spell: the phonetic alphabet', () => {
  assert.equal(spokenLetters('Alpha Bravo X-ray Zulu'), 'ABXZ');
});

test('spell: filler is skipped, long unknown words are ignored', () => {
  assert.equal(spokenLetters('the code is M N P Q'), 'MNPQ');
  assert.equal(spokenLetters('hmm hello'), 'HMM');
  assert.equal(spokenLetters('something'), '');
});
