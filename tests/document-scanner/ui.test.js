import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../shared/document-scanner/document-scanner.js', import.meta.url), 'utf8');

test('scanner preview does not offer document or black-and-white filter selection', () => {
  assert.doesNotMatch(source, /data-filter/);
  assert.doesNotMatch(source, /Ч\/Б/);
  assert.match(source, /data-action="original"/);
});

test('scanner preview retains a safe fullscreen layout when its shared stylesheet is delayed', () => {
  assert.match(source, /function applyOverlayLayoutFallback/);
  assert.match(source, /overlay\.style\.cssText='position:fixed;inset:0/);
  assert.match(source, /preview\.style\.cssText='display:block;width:100%;max-height:55vh/);
  assert.match(source, /applyOverlayLayoutFallback\(overlay\)/);
});
