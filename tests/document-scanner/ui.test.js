import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../shared/document-scanner/document-scanner.js', import.meta.url), 'utf8');

test('scanner preview does not offer document or black-and-white filter selection', () => {
  assert.doesNotMatch(source, /data-filter/);
  assert.doesNotMatch(source, /Ч\/Б/);
  assert.match(source, /data-action="original"/);
});
