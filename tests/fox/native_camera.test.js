const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

test('FO’X uses native camera inputs outside Android Telegram', () => {
  for (const id of ['receiptCameraFallback', 'receiptReshootFallback', 'cashReportCameraFallback']) {
    assert.match(source, new RegExp(`<input id="${id}"[^>]*accept="image/\\*"[^>]*capture="environment"`));
  }

  const start = source.indexOf('function openSystemReceiptCamera(');
  const end = source.indexOf('function canvasToJpegDataUrl_', start);
  const nativeCamera = source.slice(start, end);
  assert.match(nativeCamera, /receiptReshootFallback'\)\.click\(\)/);
  assert.match(nativeCamera, /receiptCameraFallback'\)\.click\(\)/);
  assert.match(source, /receiptCameraOpen\.addEventListener\('click',\(\)=>openSystemReceiptCamera\(\)\)/);
  assert.match(source, /data-reshoot.*?openSystemReceiptCamera\(i\)/s);
  assert.match(source, /cashCameraOpen\.addEventListener\('click',openSystemCashReportCamera\)/);
  assert.doesNotMatch(source, /receiptCameraOpen\.addEventListener\('click',\(\)=>openReceiptCamera/);
  assert.doesNotMatch(source, /cashCameraOpen\.addEventListener\('click',\(\)=>openReceiptCamera/);
});

test('FO’X uses the Tatooine-compatible camera stream in Android Telegram', () => {
  const start = source.indexOf('function usesAndroidTelegramCamera_(');
  const end = source.indexOf('function canvasToJpegDataUrl_', start);
  const cameraRouting = source.slice(start, end);

  assert.match(cameraRouting, /window\.Telegram&&window\.Telegram\.WebApp/);
  assert.match(cameraRouting, /\/Android\/i\.test\(String\(navigator\.userAgent\|\|''\)\)/);
  assert.match(cameraRouting, /openReceiptCamera\(replaceIndex,'receipt'\)/);
  assert.match(cameraRouting, /openReceiptCamera\(-1,'cash-report'\)/);
});
