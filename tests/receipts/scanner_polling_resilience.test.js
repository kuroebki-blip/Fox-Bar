const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontend = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const scanner = fs.readFileSync(path.join(__dirname, '../../shared/document-scanner/document-scanner.js'), 'utf8');

test('receipt polling uses an explicit short status timeout', () => {
  assert.match(frontend, /RECEIPT_STATUS_REQUEST_TIMEOUT_MS\s*=\s*6500/);
  assert.match(frontend, /function getReceiptJobStatus_[\s\S]*?RECEIPT_STATUS_REQUEST_TIMEOUT_MS/);
  assert.match(frontend, /timeout\|не ответил вовремя\|jsonp error\|network\|failed to fetch/);
});

test('scanner no longer relies on a global JSONP monkey patch', () => {
  assert.doesNotMatch(scanner, /installStatusJsonpCompatibility/);
  assert.doesNotMatch(scanner, /__foxScannerStatusWrapped/);
});

test('OCR finishes before PDF work starts', () => {
  const start = frontend.indexOf('async function startReceiptRecognition');
  const end = frontend.indexOf('async function pollReceiptJob', start);
  const body = frontend.slice(start, end);
  const poll = body.indexOf("pollReceiptJob(activeJobId,['DONE','ERROR'],210000)");
  const pdf = body.indexOf('uploadReceiptPdfForJob_(activeJobId,pagesSnapshot,status)');
  assert.ok(poll >= 0 && pdf > poll, 'PDF upload must start after OCR polling completes');
});

test('missing upload fails fast instead of hanging for the full OCR timeout', () => {
  assert.match(frontend, /RECEIPT_JOB_START_GRACE_MS\s*=\s*30000/);
  assert.match(frontend, /Backend не получил изображения/);
});

test('FO\'X inline frontend JavaScript compiles', () => {
  const scripts = [...frontend.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .filter(Boolean);
  const inline = scripts.at(-1) || '';
  assert.ok(inline.includes('startReceiptRecognition'), 'main inline script not found');
  assert.doesNotThrow(() => new Function(inline));
});
