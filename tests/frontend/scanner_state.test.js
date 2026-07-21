'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const frontendPath = path.resolve(__dirname, '../../frontend/candidate/index.html');
const html = fs.readFileSync(frontendPath, 'utf8');
const match = html.match(/\/\/ ===== SCANNER TESTABLE HELPERS START =====([\s\S]*?)\/\/ ===== SCANNER TESTABLE HELPERS END =====/);
assert.ok(match, 'Scanner helper block must exist in index.html');

const context = vm.createContext({});
vm.runInContext(match[1], context, { filename: frontendPath });

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

test('only the current non-empty receipt job is active', () => {
  assert.equal(evaluate("receiptJobIsActive_('rx2','rx2')"), true);
  assert.equal(evaluate("receiptJobIsActive_('rx2','rx1')"), false);
  assert.equal(evaluate("receiptJobIsActive_('','')"), false);
});

test('base64 decoded byte estimate handles padding', () => {
  assert.equal(evaluate("base64DecodedBytes_('YQ==')"), 1);
  assert.equal(evaluate("base64DecodedBytes_('YWI=')"), 2);
  assert.equal(evaluate("base64DecodedBytes_('YWJj')"), 3);
});

test('OCR payload accepts a normal page', () => {
  const result = evaluate("validateOcrImagesPayload_([{data:'" + 'Y'.repeat(400) + "'}])");
  assert.equal(result.pages, 1);
  assert.equal(result.totalBytes, 300);
});

test('OCR payload rejects more than 20 pages before upload', () => {
  assert.throws(() => evaluate('assertOcrPageCount_(21)'), /Максимум 20/);
});

test('OCR payload rejects a decoded total over 12 MiB', () => {
  const chunkBase64Length = Math.ceil((4 * 1024 * 1024 + 1) * 4 / 3);
  context.chunk = 'Y'.repeat(chunkBase64Length);
  assert.throws(
    () => evaluate('validateOcrImagesPayload_([{data:chunk},{data:chunk},{data:chunk}])'),
    /Общий размер OCR-фотографий больше 12 МБ/
  );
});

test('stale PDF upload is guarded before it mutates global result', () => {
  assert.match(html, /receiptResult&&receiptJobIsActive_\(receiptJobId,jobId\)/);
  assert.match(html, /if\(!receiptJobIsActive_\(receiptJobId,jobId\)\)throw new Error\('Операция отменена\.'\)/);
});

test('page deletion and reordering invalidate the previous recognition job', () => {
  assert.match(html, /receiptPages\.splice\(i,1\);invalidateReceiptRecognition_\(\);renderReceiptPages\(\)/);
  assert.match(html, /receiptPages\[to\]=tmp;invalidateReceiptRecognition_\(\);renderReceiptPages\(\)/);
  assert.match(html, /cashReportPages\.splice\(i,1\);invalidateCashReportRecognition_\(\);renderCashReportPages\(\)/);
  assert.match(html, /cashReportPages\[to\]=p;invalidateCashReportRecognition_\(\);renderCashReportPages\(\)/);
});
