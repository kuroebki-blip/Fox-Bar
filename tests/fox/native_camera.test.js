const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

test('FO’X keeps native camera inputs for platforms outside Android Telegram', () => {
  for (const id of ['receiptCameraFallback', 'receiptReshootFallback', 'cashReportCameraFallback']) {
    assert.match(source, new RegExp(`<input id="${id}"[^>]*accept="image/\\*"[^>]*capture="environment"`));
  }

  assert.match(source, /<label class="receipt-scan-btn" for="receiptCameraFallback">/);
  assert.match(source, /<label class="cash-source-btn" for="cashReportCameraFallback">/);
  assert.match(source, /<label for="receiptReshootFallback" data-reshoot/);
  assert.match(source, /querySelector\('\[data-reshoot\]'\)\.addEventListener\('click',\(\)=>\{receiptReshootIndex=i;\}\)/);
});

test('FO’X uses the Tatooine-compatible camera stream in Android Telegram', () => {
  const start = source.indexOf('function usesAndroidTelegramCamera_(');
  const end = source.indexOf('function updateReceiptCameraCount(', start);
  const routing = source.slice(start, end);

  assert.match(routing, /window\.Telegram&&window\.Telegram\.WebApp/);
  assert.match(routing, /event\.preventDefault\(\)/);
  assert.match(routing, /openReceiptCamera\(replaceIndex\(\),purpose\)/);
  assert.match(source, /routeAndroidTelegramCamera_\(receiptCameraFallback,\(\)=>-1,'receipt'\)/);
  assert.match(source, /routeAndroidTelegramCamera_\(cashCameraFallback,\(\)=>-1,'cash-report'\)/);
});
