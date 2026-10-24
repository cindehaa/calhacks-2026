import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOUBLE_ELIXIR_AT, MATCH_SECONDS } from '../../shared/arena';
import { frostLevel } from './frost';

test('frost climbs from a thin rime as a tower loses health', () => {
  const full = frostLevel(100, 100), half = frostLevel(50, 100), low = frostLevel(10, 100);
  assert.ok(full > 0 && full < 0.1, 'a rime at full health');
  assert.ok(full < half && half < low && low < 1);
});

test('overtime frosts every tower slowly, whatever its health', () => {
  assert.equal(frostLevel(100, 100, DOUBLE_ELIXIR_AT - 1), frostLevel(100, 100));
  const early = frostLevel(100, 100, DOUBLE_ELIXIR_AT + 1), late = frostLevel(100, 100, MATCH_SECONDS);
  assert.ok(frostLevel(100, 100) < early && early < late);
  assert.equal(frostLevel(10, 100, DOUBLE_ELIXIR_AT + 1), frostLevel(10, 100), 'a hurt tower keeps its higher line');
  assert.equal(frostLevel(100, 100, MATCH_SECONDS, false), frostLevel(100, 100), 'only while playing');
});
