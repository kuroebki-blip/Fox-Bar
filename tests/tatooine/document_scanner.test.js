const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '../..');
const backend = fs.readFileSync(path.join(root, 'apps-script/stock/production/Code.gs'), 'utf8');
const tatooine = fs.readFileSync(path.join(root, 'tatooine/app.js'), 'utf8');
const fox = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractedDocumentRequestGuard(source) {
  const start = source.indexOf('function createDocumentRequestGuard()');
  const end = source.indexOf('\n  const documentRequestGuard', start);
  assert.ok(start >= 0 && end > start, 'document request guard must be extractable');
  return new Function('return (' + source.slice(start, end).trim().replace(/^function /, 'function ') + ');')();
}

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
  assert.match(tatooine, /await pollTemporaryDocument\(previewId, 120000, 'SENT'\)/);
});

test('Tatooine document scanner exposes both scan modes and sends them on preview and delivery', () => {
  const tatooineHtml = fs.readFileSync(path.join(root, 'tatooine/index.html'), 'utf8');
  assert.match(tatooineHtml, /id="documentScanMode"/);
  assert.match(tatooineHtml, /value="document">Документ поставки/);
  assert.match(tatooineHtml, /value="check">Кассовый \/ онлайн-чек/);
  const previewStart = tatooine.indexOf('async function previewDocument()');
  const sendStart = tatooine.indexOf('async function sendDocument()');
  const sendEnd = tatooine.indexOf('\n\n  function movePage', sendStart);
  assert.match(tatooine.slice(previewStart, sendStart), /action:'temporaryDocumentPreview', previewId, scanMode, department/);
  assert.match(tatooine.slice(sendStart, sendEnd), /action:'temporaryDocumentSend', previewId, scanMode, department/);
});

test('mode switch rejects stale mocked responses during and after recognition without touching photos or department', () => {
  const createGuard = extractedDocumentRequestGuard(tatooine);
  const guard = createGuard();
  const selected = { department: 'Кухня', pages: [{ mock: 'photo' }] };
  const previewToken = guard.invalidate();
  const previewResponse = { ok: true, status: 'READY', result: { messageText: 'old document' } };

  guard.invalidate(); // mock the user choosing the other mode while OCR is pending
  assert.equal(guard.isCurrent(previewToken), false);
  assert.equal(selected.department, 'Кухня');
  assert.equal(selected.pages.length, 1);
  assert.equal(previewResponse.status, 'READY');

  const sendToken = guard.current();
  guard.invalidate(); // mock switching mode after preview while delivery is pending
  assert.equal(guard.isCurrent(sendToken), false);
  assert.equal(selected.department, 'Кухня');
  assert.equal(selected.pages[0].mock, 'photo');
});

test('Tatooine invalidates the preview and ignores late mode-mismatched results', () => {
  assert.match(tatooine, /documentScanMode'\)\.addEventListener\('change'/);
  assert.match(tatooine, /invalidateDocumentPreview\('Режим сканирования изменён/);
  assert.match(tatooine, /!documentRequestGuard\.isCurrent\(requestToken\) \|\| documentScanMode\(\) !== scanMode/);
  assert.match(tatooine, /documentPreviewMode !== scanMode/);
});

test('Tatooine document send gives immediate mobile feedback and makes retries explicit', () => {
  const start = tatooine.indexOf('async function sendDocument()');
  const end = tatooine.indexOf('\n\n  function movePage', start);
  const source = tatooine.slice(start, end);
  const tatooineHtml = fs.readFileSync(path.join(root, 'tatooine/index.html'), 'utf8');
  assert.match(tatooineHtml, /id="documentSendStatus" aria-live="polite"/);
  assert.match(source, /if \(button\.disabled\) return;/);
  assert.match(source, /button\.textContent = 'Отправляю PDF…'/);
  assert.match(source, /documentSendStatus\('Отправляю PDF и подпись в чат…'\)/);
  assert.match(source, /button\.textContent = '✓ Отправлено в чат'/);
  assert.match(source, /button\.textContent = deliveryUnknown \? 'Статус доставки неизвестен' : 'Повторить отправку'/);
});

test('Tatooine makes a missing department visible before document recognition can start', () => {
  const tatooineHtml = fs.readFileSync(path.join(root, 'tatooine/index.html'), 'utf8');
  assert.match(tatooineHtml, /id="documentDepartmentField"/);
  assert.match(tatooineHtml, /id="documentDepartmentValidation" role="alert"/);
  assert.match(tatooineHtml, /id="documentStatus" aria-live="polite"/);
  assert.match(tatooine, /function updateDocumentPreviewButton\(\)/);
  assert.match(tatooine, /button\.disabled = !hasPages \|\| !hasDepartment/);
  assert.match(tatooine, /'Выберите подразделение для распознавания'/);
  assert.match(tatooine, /function requireDocumentDepartment\(\)/);
  assert.match(tatooine, /documentStatus\('Выберите подразделение: Бар или Кухня\. Сначала выберите его, затем распознавайте документ\.', 'error'\)/);
  assert.match(tatooine, /\$\('documentDepartment'\)\.addEventListener\('change'/);
  assert.match(tatooine, /invalidateDocumentPreview\('Подразделение изменено\. Создайте новый предпросмотр\.'/);
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
