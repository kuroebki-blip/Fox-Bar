const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

function extractFunction(name) {
  const marker = `async function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} not found`);
  const next = source.indexOf('\nfunction ', start + marker.length);
  const nextAsync = source.indexOf('\nasync function ', start + marker.length);
  const ends = [next, nextAsync].filter(index => index > start);
  const end = ends.length ? Math.min(...ends) : source.length;
  return source.slice(start, end);
}

test('receipt status polling uses a short per-request timeout', () => {
  const fn = extractFunction('pollReceiptJob');
  assert.match(fn, /action:'status',jobId[^\n]*receiptAuthParams\(\)\)\),6500\)/);
  assert.match(fn, /setTimeout\(r,1400\)/);
});

test('receipt polling treats the Russian JSONP timeout as transient', () => {
  const fn = extractFunction('pollReceiptJob');
  assert.match(fn, /не ответил вовремя/);
  assert.match(fn, /jsonp error/);
  assert.match(fn, /failed to fetch/i);
});

test('receipt recognition keeps its overall backend wait budget', () => {
  const fn = extractFunction('startReceiptRecognition');
  assert.match(fn, /pollReceiptJob\(activeJobId,\['DONE','ERROR'\],210000\)/);
});
