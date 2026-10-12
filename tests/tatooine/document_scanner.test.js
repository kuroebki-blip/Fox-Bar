const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '../..');
const backend = fs.readFileSync(path.join(root, 'apps-script/stock/production/Code.gs'), 'utf8');
const tatooine = fs.readFileSync(path.join(root, 'tatooine/app.js'), 'utf8');
const fox = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('temporary document flow is cache-bound and never writes Sheets or stock', () => {
  const start = backend.indexOf('function temporaryDocumentPreview_');
  const end = backend.indexOf('function scanReceiptImages_', start);
  const source = backend.slice(start, end);
  assert.match(backend, /CacheService\.getScriptCache\(\)/);
  assert.match(source, /temporaryDepartment_\(p\.department\)/);
  assert.match(source, /telegramRouteConfig_\(auth\)/);
  assert.doesNotMatch(source, /SpreadsheetApp|upsertDocumentRecord_|createOrResetJob_|confirmReceipt_|DriveApp/);
});

test('temporary send uses the server route and prevents category or duplicate misuse', () => {
  const start = backend.indexOf('function temporaryDocumentSend_');
  const end = backend.indexOf('function scanReceiptImages_', start);
  const source = backend.slice(start, end);
  assert.match(source, /entry\.department !== department/);
  assert.match(source, /entry\.state === 'SENT'/);
  assert.match(source, /entry\.state === 'UNKNOWN'/);
  assert.match(source, /\? 'FAILED' : 'UNKNOWN'/);
  assert.match(source, /entry\.state !== 'READY'/);
  assert.match(source, /route\.targetChatId/);
  assert.doesNotMatch(source, /p\.chatId|p\.telegramChatId/);
});

test('both clients require an explicit Bar or Kitchen selection', () => {
  assert.match(fox, /<option value="">Выберите подразделение<\/option>/);
  assert.match(fox, /Сначала выбери подразделение: Бар или Кухня/);
  const tatooineHtml = fs.readFileSync(path.join(root, 'tatooine/index.html'), 'utf8');
  assert.match(tatooineHtml, /id="documentDepartment"/);
  assert.match(tatooine, /Выберите подразделение: Бар или Кухня/);
});

test('Kitchen is never silently translated to the reserve column category', () => {
  const start = backend.indexOf('function normalizeWarehouse_');
  const source = backend.slice(start, backend.indexOf('function normalizeText_', start));
  assert.match(source, /v\.indexOf\('кухн'\) >= 0\) return 'Кухня'/);
  assert.doesNotMatch(source, /кухн[^\n]*Заготовочный/);
});

test('Tatooine keeps preview and explicit send as distinct actions', () => {
  assert.match(tatooine, /action:'temporaryDocumentPreview'/);
  assert.match(tatooine, /action:'temporaryDocumentSend'/);
  assert.match(tatooine, /documentPreviewId/);
  assert.match(tatooine, /async function pollTemporaryDocument\(/);
  assert.match(tatooine, /result\.status === successState \|\| \['ERROR', 'FAILED', 'UNKNOWN'\]\.includes\(result\.status\)/);
  assert.match(tatooine, /await pollTemporaryDocument\(previewId, 210000, 'READY'\)/);
  assert.match(tatooine, /await pollTemporaryDocument\(documentPreviewId, 120000, 'SENT'\)/);
});

function extractedPoll(source, name, nextFunction) {
  const start = source.indexOf('async function ' + name + '(');
  const end = source.indexOf('\nasync function ' + nextFunction, start) >= 0
    ? source.indexOf('\nasync function ' + nextFunction, start)
    : source.indexOf('\n  async function ' + nextFunction, start);
  assert.ok(start >= 0 && end > start, 'poll function must be extractable');
  const declaration = source.slice(start, end).trim()
    .replace(/await new Promise\(resolve=>setTimeout\(resolve,[^)]+\)\)\;/, 'await sleep();')
    .replace(/RECEIPT_STATUS_REQUEST_TIMEOUT_MS/g, '1000')
    .replace(/STOCK_API_URL/g, "'mock://api'")
    .replace(/receiptAuthParams/g, 'authParams');
  return new Function('jsonp', 'authParams', 'sleep', 'Date', 'return (' + declaration.replace(/^async function /, 'async function ') + ');');
}

test('Tatooine UI polling tolerates delayed PROCESSING/SENDING states until SENT', async () => {
  let now = 0; let calls = 0;
  const poll = extractedPoll(tatooine, 'pollTemporaryDocument', 'previewDocument')(
    async () => ({ok:true, status:['PROCESSING', 'READY', 'SENDING', 'SENT'][calls++]}),
    () => ({token:'mock'}),
    async () => { now += 1500; },
    {now:()=>now}
  );
  const result = await poll('preview_mock', 10000, 'SENT');
  assert.equal(result.status, 'SENT');
  assert.equal(calls, 4);
});

test('FO’X UI polling preserves a server caption after delayed preview completion', async () => {
  let now = 0; let calls = 0;
  const poll = extractedPoll(fox, 'pollTemporaryDocument_', 'startTemporaryReceiptRecognition_')(
    async () => ({ok:true, status:['PROCESSING', 'READY'][calls++], result:{messageText:'Подразделение: Кухня\nTATOOINE'}}),
    () => ({token:'mock'}),
    async () => { now += 1500; },
    {now:()=>now}
  );
  const result = await poll('preview_mock', 10000, 'READY');
  assert.equal(result.result.messageText, 'Подразделение: Кухня\nTATOOINE');
  assert.equal(calls, 2);
});

test('FO’X document UI overrides the legacy Sheets job route with the temporary route', () => {
  assert.match(fox, /function startTemporaryReceiptRecognition_/);
  assert.match(fox, /action:'temporaryDocumentPreview'/);
  assert.match(fox, /action:'temporaryDocumentSend'/);
  assert.match(fox, /document\.getElementById\('receiptScan'\)\.onclick=startTemporaryReceiptRecognition_/);
  assert.match(fox, /document\.getElementById\('receiptSend'\)\.onclick=sendTemporaryReceiptToTelegram_/);
});
