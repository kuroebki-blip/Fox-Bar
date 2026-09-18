const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

test('cash OCR uses one compact image instead of a four-part montage', () => {
  const start = source.indexOf('async function dataUrlToCashOcrImage_');
  const end = source.indexOf('async function buildOcrImagesPayload_', start);
  const fn = source.slice(start, end);

  assert.match(source, /const CASH_REPORT_OCR_MAX_SIDE = 1920/);
  assert.match(source, /const CASH_REPORT_OCR_JPEG_QUALITY = \.80/);
  assert.match(fn, /dataUrlToOcrImage_\(dataUrl,CASH_REPORT_OCR_MAX_SIDE,CASH_REPORT_OCR_JPEG_QUALITY\)/);
  assert.doesNotMatch(source, /cashOcrMontageSpec_|dataUrlToCashOcrMontage_/);
});

test('cash report has no removed camera capture path', () => {
  assert.doesNotMatch(source, /receiptCameraPurpose/);
});
