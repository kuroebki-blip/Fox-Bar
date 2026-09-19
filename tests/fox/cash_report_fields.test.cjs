const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const paymentHelperStart = source.indexOf('function normalizedCashPaymentName_(');
const paymentHelperEnd = source.indexOf('function cashInputValue(', paymentHelperStart);
const cashPaymentRowAmount = new Function(`${source.slice(paymentHelperStart, paymentHelperEnd)};return cashPaymentRowAmount_;`)();

test('FO’X cash report replaces Cash 2 and Tapper with EatAndSplit', () => {
  assert.match(source, /id="cashReportItemsSplit"/);
  assert.match(source, /cashInputValue\('cashReportItemsSplit',cashPaymentRowAmount_\(r\.paymentRows,\['Items Split','EatAndSplit'\]\)\)/);
  assert.match(source, /<label>EatAndSplit<\/label><input id="cashReportItemsSplit"/);
  assert.match(source, /cashLine\('EatAndSplit',cashNumber\('cashReportItemsSplit'\)\)/);
  assert.doesNotMatch(source, /cashReportCash2/);
  assert.doesNotMatch(source, /cashReportTapper/);
  assert.doesNotMatch(source, /cashLine\('Нал2'/);
  assert.doesNotMatch(source, /cashLine\('Tapper'/);
});

test('EatAndSplit keeps the existing custom-emoji marker in the Telegram message', () => {
  const cashLineStart = source.indexOf('function cashLine(');
  const cashLineEnd = source.indexOf('function updateCashComparison(', cashLineStart);
  const cashLine = source.slice(cashLineStart, cashLineEnd);

  assert.match(cashLine, /return '🟢'\+label/);
});

test('EatAndSplit accepts normalized payment-row names from OCR', () => {
  assert.equal(cashPaymentRowAmount([
    { name: 'Оплата Items-Split Продажа', amount: '1500.50' },
  ], ['Items Split', 'EatAndSplit']), 1500.5);
  assert.equal(cashPaymentRowAmount([
    { row_name: 'EatAndSplit', amount: 875 },
  ], ['Items Split', 'EatAndSplit']), 875);
});

test('cash-report prepayments label the online method as Eat and Split', () => {
  assert.match(source, /<option value="online">Eat and Split<\/option>/);
  assert.doesNotMatch(source, /<option value="online">Онлайн-касса<\/option>/);

  const phraseStart = source.indexOf('function cashPaymentPhrase(');
  const phraseEnd = source.indexOf('function cashLine(', phraseStart);
  const cashPaymentPhrase = new Function(`${source.slice(phraseStart, phraseEnd)};return cashPaymentPhrase;`)();
  assert.equal(cashPaymentPhrase('online'), 'Eat and Split');
});
