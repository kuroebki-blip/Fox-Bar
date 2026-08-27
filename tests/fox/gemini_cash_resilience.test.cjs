const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const backend = fs.readFileSync(path.join(__dirname, '../../apps-script/stock/production/Code.gs'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

function loadGeminiRetryHelpers() {
  const start = backend.indexOf('function isGeminiRetryableHttpStatus_(');
  const end = backend.indexOf('function callGeminiGenerateContent_(', start);
  assert.ok(start >= 0, 'Gemini retry helpers must exist');
  assert.ok(end > start, 'Gemini retry helpers must precede the HTTP call');
  const context = {
    Math, Date, String, Number, Object, JSON, console: { log() {} },
    FOX_RECEIPTS: { geminiCashRetry: { baseDelayMs: 1000, maxDelayMs: 8000, maxRetryAfterMs: 15000 } }
  };
  vm.createContext(context);
  vm.runInContext(`${backend.slice(start, end)};globalThis.helpers={isGeminiRetryableHttpStatus_,geminiRetryDelayMs_,cashReportGeminiUserError_};`, context);
  return context.helpers;
}

function loadGeminiHttpCaller(queue) {
  const start = backend.indexOf('function isGeminiRetryableHttpStatus_(');
  const end = backend.indexOf('function parseGeminiJsonResult_(', start);
  const sleeps = [];
  const calls = [];
  const context = {
    Math, Date, String, Number, Object, JSON, Error, Boolean, isNaN, encodeURIComponent,
    FOX_RECEIPTS: { geminiCashRetry: { baseDelayMs: 1000, maxDelayMs: 8000, maxRetryAfterMs: 15000, fallbackMaxAttempts: 2 } },
    Utilities: { sleep(ms) { sleeps.push(ms); } },
    console: { log() {} },
    errorText_(error) { return String(error && error.message ? error.message : error); },
    parseJsonSafe_(text) { try { return JSON.parse(text); } catch (_) { return null; } },
    UrlFetchApp: {
      fetch(url) {
        calls.push(url);
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next;
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(`${backend.slice(start, end)};globalThis.callGemini=callGeminiGenerateContent_;`, context);
  return { callGemini: context.callGemini, calls, sleeps };
}

function geminiResponse(status, payload, headers = {}) {
  return {
    getResponseCode() { return status; },
    getContentText() { return JSON.stringify(payload); },
    getHeaders() { return headers; }
  };
}

test('Gemini retries only temporary HTTP statuses and uses bounded exponential backoff', () => {
  const helpers = loadGeminiRetryHelpers();
  for (const status of [429, 500, 502, 503, 504]) assert.equal(helpers.isGeminiRetryableHttpStatus_(status), true);
  for (const status of [0, 400, 401, 403, 404, 422]) assert.equal(helpers.isGeminiRetryableHttpStatus_(status), false);

  const noJitter = () => 0;
  assert.equal(helpers.geminiRetryDelayMs_(1, 0, noJitter), 1000);
  assert.equal(helpers.geminiRetryDelayMs_(2, 0, noJitter), 2000);
  assert.equal(helpers.geminiRetryDelayMs_(3, 0, noJitter), 4000);
  assert.equal(helpers.geminiRetryDelayMs_(4, 0, noJitter), 8000);
  assert.equal(helpers.geminiRetryDelayMs_(4, 12000, noJitter), 12000);
  assert.ok(helpers.geminiRetryDelayMs_(4, 999999, noJitter) <= 15000);
});

test('cash-report Gemini errors are safe for employees and preserve a retryable temporary state', () => {
  const helpers = loadGeminiRetryHelpers();
  assert.match(helpers.cashReportGeminiUserError_({ category: 'temporary' }), /временно недоступен/i);
  assert.match(helpers.cashReportGeminiUserError_({ category: 'network' }), /соединение/i);
  assert.doesNotMatch(helpers.cashReportGeminiUserError_({ category: 'temporary' }), /Gemini API HTTP|UNAVAILABLE|503/i);
  assert.match(helpers.cashReportGeminiUserError_({ category: 'configuration' }), /настроен/i);
});

test('cash report UI keeps selected pages, exposes retry, and rejects parallel recognition clicks', () => {
  assert.match(frontend, /id="cashReportRetry"/);
  assert.match(frontend, /cashReportRecognitionInFlight/);
  assert.match(frontend, /if\(cashReportRecognitionInFlight\)return/);
  assert.match(frontend, /cashReportRetry.*addEventListener\('click',startCashReportRecognition\)/);
  assert.match(frontend, /CASH_REPORT_RECOGNITION_MAX_WAIT_MS=45000/);
  assert.match(frontend, /Не удалось обработать отчёт\. Сервис распознавания временно недоступен\. Попробуйте ещё раз\./);
});

test('cash-report Gemini HTTP call has five bounded attempts, Retry-After support, and an optional configured fallback', () => {
  assert.match(backend, /maxAttempts:\s*5/);
  assert.match(backend, /maxAttempts:\s*settings\.maxAttempts/);
  assert.match(backend, /Retry-After/i);
  assert.match(backend, /GEMINI_CASH_FALLBACK_MODEL/);
  assert.match(backend, /function callCashReportGemini_/);
  assert.match(backend, /attempt\s*<=\s*maxAttempts/);
});

test('Gemini 503 and transport timeouts retry, while a permanent 400 fails immediately', () => {
  const success = geminiResponse(200, { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
  const unavailable = geminiResponse(503, { error: { status: 'UNAVAILABLE', message: 'busy' } }, { 'Retry-After': '2' });
  const transient = loadGeminiHttpCaller([unavailable, success]);
  const result = transient.callGemini('key', 'model', {}, { maxAttempts: 5 });
  assert.equal(result.text, '{"ok":true}');
  assert.equal(transient.calls.length, 2);
  assert.ok(transient.sleeps[0] >= 2000 && transient.sleeps[0] <= 2250);

  const timeout = loadGeminiHttpCaller([new Error('Request timed out'), success]);
  assert.equal(timeout.callGemini('key', 'model', {}, { maxAttempts: 5 }).text, '{"ok":true}');
  assert.equal(timeout.calls.length, 2);

  const invalid = loadGeminiHttpCaller([geminiResponse(400, { error: { status: 'INVALID_ARGUMENT', message: 'bad request' } })]);
  assert.throws(() => invalid.callGemini('key', 'model', {}, { maxAttempts: 5 }), /HTTP 400/);
  assert.equal(invalid.calls.length, 1);
  assert.equal(invalid.sleeps.length, 0);
});
