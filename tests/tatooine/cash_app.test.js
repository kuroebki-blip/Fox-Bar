'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'frontend/tatooine/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/tatooine/app.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'frontend/tatooine/config.js'), 'utf8');

test('Tatooine frontend exposes only the cash-report workflow', () => {
  assert.match(html, /Tatooine/);
  assert.match(html, /Кассовый отчёт/);
  assert.doesNotMatch(html, /Банкеты|Чек-листы|Документы и чеки|Подтвердить сток/);
});

test('frontend uses the existing published handler without placeholders', () => {
  assert.match(config, /AKfycbx9XlQG6kCvWVU6OekcWAmHAVnjFXfG-_UD_pKQrQqYaWNyHzmXsmB_2LGohxETrrfTpA/);
  assert.match(config, /venue:\s*'tatooine'/);
  assert.match(app, /venue:\s*String\(CONFIG\.venue \|\| 'tatooine'\)/);
  assert.doesNotMatch(config, /PASTE_/);
  assert.match(app, /cashReportScanImages/);
  assert.match(app, /cashReportSend/);
});

test('cash message is branded Tatooine and preserves required payment rows', () => {
  assert.match(app, /'TATOOINE'/);
  assert.match(app, /ПЕТРОВКА/);
  assert.match(app, /EatAndSplit/);
  assert.match(app, /Яндекс еда/);
  assert.match(html + app, /Оплата QR/);
  assert.match(app, /terminalSlips/);
  assert.match(app, /Расчётный счёт 2/);
  assert.match(app, /Инкассация:/);
});

test('photos are sent as reduced images and are not uploaded as PDF', () => {
  assert.match(app, /toOcrImage/);
  assert.match(app, /imagesJson/);
  assert.doesNotMatch(app, /attachPdf|sendTelegram|scanImages/);
  assert.match(html, /не записываются в Google Sheets и Google Drive/);
});

const helperMatch = app.match(/\/\/ ===== TATOOINE TESTABLE HELPERS START =====([\s\S]*?)\/\/ ===== TATOOINE TESTABLE HELPERS END =====/);
assert.ok(helperMatch, 'Tatooine helper block must exist');
const context = vm.createContext({ CONFIG: Object.freeze({ maxOcrPages: 20, maxOcrImageBytes: 6 * 1024 * 1024, maxOcrTotalBytes: 12 * 1024 * 1024 }) });
vm.runInContext(helperMatch[1], context, { filename: 'frontend/tatooine/app.js' });

test('OCR payload limits are enforced before upload', () => {
  assert.equal(vm.runInContext("base64DecodedBytes('YQ==')", context), 1);
  const page = 'Y'.repeat(400);
  context.page = page;
  const accepted = vm.runInContext('validateOcrImages([{data:page}])', context);
  assert.equal(accepted.pages, 1);
  assert.equal(accepted.totalBytes, 300);
  context.pages = Array.from({ length: 21 }, () => ({ data: page }));
  assert.throws(() => vm.runInContext('validateOcrImages(pages)', context), /Максимум 20/);
});

test('editing pages invalidates a previous recognition job', () => {
  assert.match(app, /pages\.splice\(index, 1\);\s*invalidateRecognition\(\)/);
  assert.match(app, /\[pages\[index\], pages\[target\]\] = \[pages\[target\], pages\[index\]\];\s*invalidateRecognition\(\)/);
  assert.match(app, /expectedJobId !== jobId/);
});
