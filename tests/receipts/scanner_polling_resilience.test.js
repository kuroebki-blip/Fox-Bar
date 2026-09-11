const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontend = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const scanner = fs.readFileSync(path.join(__dirname, '../../shared/document-scanner/document-scanner.js'), 'utf8');

test('document scanner wraps status JSONP with a short timeout', () => {
  assert.match(scanner, /STATUS_JSONP_TIMEOUT_MS\s*=\s*6500/);
  assert.match(scanner, /params\s*&&\s*params\.action\s*===\s*'status'/);
  assert.match(scanner, /effectiveTimeout\s*=\s*isStatus\s*&&\s*timeoutMs\s*==\s*null\s*\?\s*STATUS_JSONP_TIMEOUT_MS/);
});

test('Russian JSONP timeout is normalized as transient timeout', () => {
  assert.match(scanner, /не ответил вовремя\|jsonp error\|network\|failed to fetch\|failed to load/i);
  assert.match(scanner, /new Error\('timeout: '\s*\+\s*message\)/);
});

test('receipt polling already keeps transient timeout errors alive', () => {
  assert.match(frontend, /async function pollReceiptJob[\s\S]*?includes\('timeout'\)[\s\S]*?210000|pollReceiptJob\(activeJobId,\['DONE','ERROR'\],210000\)/);
});
