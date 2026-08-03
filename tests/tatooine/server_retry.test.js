const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../tatooine/app.js'), 'utf8');

test('Tatooine waits long enough for a cold Apps Script status response', () => {
  assert.match(source, /function jsonp\(params, timeoutMs = 35000\)/);
});

test('a delayed status response stays retryable without changing the current status text', () => {
  const start = source.indexOf('async function pollJob');
  const end = source.indexOf('async function recognize', start);
  const polling = source.slice(start, end);

  assert.match(polling, /message\.includes\('Сервер не ответил вовремя\.'/);
  assert.doesNotMatch(polling, /Сервер занят, продолжаем ждать ответ/);
});
