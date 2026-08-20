const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('index.html', 'utf8');

function loadStatusFunction(name, nextName, statusId, progressId) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start) >= 0
    ? source.indexOf(`async function ${nextName}`, start)
    : source.indexOf(`function ${nextName}`, start);
  const element = { className: '', innerHTML: '' };
  const progress = { style: {} };
  const context = {
    document: { getElementById: id => id === statusId ? element : id === progressId ? progress : null },
    escapeHtml: value => String(value),
    Math
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)};globalThis.status=${name};`, context);
  return { element, status: context.status };
}

for (const [name, nextName, statusId, progressId] of [
  ['setReceiptStatus', 'updateReceiptModeUi', 'receiptStatus', 'receiptProgress'],
  ['setCashReportStatus', 'appendCashReportFiles', 'cashReportStatus', 'cashReportProgress']
]) {
  test(`${name} hides transient progress text but keeps final text`, () => {
    const { element, status } = loadStatusFunction(name, nextName, statusId, progressId);
    status('', 'Отправляю фотографии…', .25);
    assert.doesNotMatch(element.innerHTML, /Отправляю фотографии/);
    status('ok', 'Готово', 1);
    assert.match(element.innerHTML, /Готово/);
  });
}
