const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

test('cash OCR uses one compact image instead of a four-part montage', () => {
  const start = source.indexOf('async function dataUrlToCashOcrImage_');
  const end = source.indexOf('async function buildOcrImagesPayload_', start);
  const fn = source.slice(start, end);

  assert.match(fn, /dataUrlToOcrImage_\(dataUrl,2200,\.84\)/);
  assert.doesNotMatch(source, /cashOcrMontageSpec_|dataUrlToCashOcrMontage_/);
});

test('cash camera keeps a smaller capture limit than document scanning', () => {
  assert.match(source, /receiptCameraPurpose==='cash-report'\?2200:3200/);
  assert.match(source, /receiptCameraPurpose==='cash-report'\?2400:3400/);
});
