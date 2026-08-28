const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('index.html', 'utf8');

function createDraftSnapshot(state) {
  const start = source.indexOf('function receiptPageForDraft_(');
  const end = source.indexOf('function openReceiptDraftDb_(', start);
  assert.ok(start >= 0 && end > start, 'receipt draft snapshot helpers must be present');
  const context = {
    receiptPages: state.pages,
    receiptResult: state.result,
    receiptPdfUploadError: state.pdfUploadError || '',
    receiptJobId: state.jobId || '',
    getReceiptMode: () => state.mode || 'document',
    document: { getElementById: () => ({ value: state.warehouse || '' }) },
    Boolean,
    Date: { now: () => 123456 }
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)};globalThis.snapshot=makeReceiptDraftSnapshot_;`, context);
  return context.snapshot();
}

test('receipt scanner persists pages and Gemini result locally for recovery after a reload', () => {
  assert.match(source, /const RECEIPT_DRAFT_DB_NAME='fox_receipt_drafts_v1'/);
  assert.match(source, /function makeReceiptDraftSnapshot_\(/);
  assert.match(source, /function saveReceiptDraft_\(/);
  assert.match(source, /async function restoreReceiptDraft_\(/);
  assert.match(source, /receiptPages\.map\(receiptPageForDraft_\)/);
  assert.match(source, /result:receiptResult/);
});

test('receipt draft stores the current scan but does not duplicate the original page image', () => {
  const result = { scanMode: 'document', items: [{ rawName: 'Товар' }] };
  const snapshot = createDraftSnapshot({
    pages: [{ id: 'p1', name: 'invoice.jpg', width: 1200, height: 1600, dataUrl: 'data:image/jpeg;base64,scan', originalDataUrl: 'data:image/jpeg;base64,original' }],
    result,
    jobId: 'rx1',
    warehouse: 'Бар'
  });
  assert.equal(snapshot.pages.length, 1);
  assert.equal(snapshot.pages[0].dataUrl, 'data:image/jpeg;base64,scan');
  assert.equal('originalDataUrl' in snapshot.pages[0], false);
  assert.deepEqual(snapshot.result, result);
  assert.equal(snapshot.jobId, 'rx1');
});

test('a failed PDF upload keeps the recognised document recoverable and offers a retry', () => {
  assert.match(source, /id="receiptRetryPdf"/);
  assert.match(source, /async function retryReceiptPdfUpload_\(/);
  assert.match(source, /receiptPdfUploadPromise=uploadReceiptPdfForJob_\(receiptJobId,pagesSnapshot\)/);
  assert.match(source, /saveReceiptDraft_\(\);/);
  assert.match(source, /receiptRetryPdf.*addEventListener\('click',retryReceiptPdfUpload_\)/);
});
