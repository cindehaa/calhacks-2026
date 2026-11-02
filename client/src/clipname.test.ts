import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileName } from './clipname';

test('named after the moment: artifice-gameplay-<words>.<ext>', () => {
  assert.equal(fileName({ label: 'Swiftie Squad summoned', ext: 'webm' }, 0), 'artifice-gameplay-swiftie-squad-summoned.webm');
  assert.equal(fileName({ label: 'Tower down!  King’s tower', ext: 'mp4' }, 2), 'artifice-gameplay-tower-down-king-s-tower.mp4');
});

test('accents folded, length capped without a trailing dash, empty falls back to the number', () => {
  assert.equal(fileName({ label: 'Café Golem', ext: 'webm' }, 0), 'artifice-gameplay-cafe-golem.webm');
  const long = fileName({ label: 'a '.repeat(80), ext: 'webm' }, 0);
  assert.ok(long.length <= 'artifice-gameplay-'.length + 60 + '.webm'.length && !long.includes('-.'));
  assert.equal(fileName({ label: '🔥🔥', ext: 'webm' }, 3), 'artifice-gameplay-highlight-4.webm');
});

test('two clips with the same moment get their number so neither overwrites the other', () => {
  const all = [{ label: 'Big summon' }, { label: 'Tower down' }, { label: 'Big summon' }];
  assert.equal(fileName({ label: 'Big summon', ext: 'webm' }, 0, all), 'artifice-gameplay-big-summon-1.webm');
  assert.equal(fileName({ label: 'Tower down', ext: 'webm' }, 1, all), 'artifice-gameplay-tower-down.webm');
  assert.equal(fileName({ label: 'Big summon', ext: 'webm' }, 2, all), 'artifice-gameplay-big-summon-3.webm');
});
