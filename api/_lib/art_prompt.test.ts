import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanSubject } from './art_prompt.js';

test('cleanSubject keeps the first line, without a label or quotes', () => {
  assert.equal(cleanSubject('"a stone wall golem with banners"\nExtra.'), 'a stone wall golem with banners');
  assert.equal(cleanSubject('Subject: a wind spirit'), 'a wind spirit');
  assert.equal(cleanSubject('  '), '');
  assert.equal(cleanSubject('x'.repeat(400)).length, 300);
});
