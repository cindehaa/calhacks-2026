import assert from 'node:assert/strict';
import { test } from 'node:test';
import { offLimits } from './pavilion.js';

test('pavilion: real attacks and the people tied to them stay off display', () => {
  for (const s of ['9/11', 'twin towers', 'IDF soldiers', 'Netanyahu.', 'Benjamin Netanyahu No, it\'s lost my finger.',
    'Oh my goodness. Osama bin Laden.', 'september 11th', 'al-Qaeda', 'Hitler']) {
    assert.ok(offLimits(s), s);
  }
  assert.ok(offLimits('Loyal Knight', 'Benjamin Netanyahu', ''));
});

test('pavilion: ordinary troops, bombs and lookalike words are kept', () => {
  for (const s of ['bomb', 'nuclear bomb.', 'Bomb Goblin', 'Bombardilo Crocodilo', 'Donald Trump', 'idfk a dragon',
    'tower knight', 'sniper with fire bullets', 'Skyfall Blast', 'Isisaurus', '']) {
    assert.ok(!offLimits(s), s);
  }
});
