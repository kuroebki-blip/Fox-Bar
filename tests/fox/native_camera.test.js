const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

test('FO’X uses direct native camera inputs', () => {
  for (const id of ['receiptCameraFallback', 'receiptReshootFallback', 'cashReportCameraFallback']) {
    assert.match(source, new RegExp(`<input id="${id}"[^>]*accept="image/\\*"[^>]*capture="environment"`));
  }

  assert.match(source, /<label class="receipt-scan-btn" for="receiptCameraFallback">/);
  assert.match(source, /<label class="cash-source-btn" for="cashReportCameraFallback">/);
  assert.match(source, /<label for="receiptReshootFallback" data-reshoot/);
  assert.match(source, /querySelector\('\[data-reshoot\]'\)\.addEventListener\('click',\(\)=>\{receiptReshootIndex=i;\}\)/);
  assert.doesNotMatch(source, /usesAndroidTelegramCamera_/);
  assert.doesNotMatch(source, /openReceiptCamera\(replaceIndex,'receipt'\)/);
  assert.doesNotMatch(source, /openReceiptCamera\(-1,'cash-report'\)/);
});
