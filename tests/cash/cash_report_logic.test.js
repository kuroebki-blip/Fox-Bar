'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const backendPath = path.resolve(__dirname, '../../apps-script/stock-scanner/candidate/Code.gs');
const backendCode = fs.readFileSync(backendPath, 'utf8');
const context = vm.createContext({ console });
vm.runInContext(backendCode, context, { filename: backendPath });

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('terminal total from "Количество оплат → На сумму" is authoritative', () => {
  const amount = evaluate('terminalSlipResolvedAmount_({card_amount:900, qr_amount:50, total_amount:1000, amount:1000})');
  assert.equal(amount, 1000);
});

test('card and QR components are fallback only when terminal total is missing', () => {
  const amount = evaluate('terminalSlipResolvedAmount_({card_amount:900, qr_amount:50, total_amount:0, amount:0})');
  assert.equal(amount, 950);
});

test('repeat OCR does not hide a real mismatch by matching iiko total', () => {
  const chosen = evaluate(`chooseBetterTerminalSlipSet_(
    [{label:'Первичный', card_amount:249000, qr_amount:0, total_amount:249000, amount:249000}],
    [{label:'Повторный', card_amount:250000, qr_amount:0, total_amount:250000, amount:250000}],
    250000
  )`);
  assert.equal(plain(chosen)[0].label, 'Первичный');
  assert.equal(plain(chosen)[0].total_amount, 249000);
});

test('repeat OCR may win only on better internal slip consistency', () => {
  const chosen = evaluate(`chooseBetterTerminalSlipSet_(
    [{label:'Первичный', card_amount:900, qr_amount:50, total_amount:900, amount:900}],
    [{label:'Повторный', card_amount:900, qr_amount:50, total_amount:950, amount:950}],
    1000
  )`);
  assert.equal(plain(chosen)[0].label, 'Повторный');
  assert.equal(plain(chosen)[0].total_amount, 950);
});

test('cash report date always remains the long iiko report date', () => {
  const date = evaluate(`resolveCashReportDate_(
    '21.07.2026',
    '22.07.2026',
    [{slipDate:'22.07.2026'}, {slipDate:'22.07.2026'}]
  )`);
  assert.equal(date, '21.07.2026');
});

test('terminal dates do not fill a missing iiko report date', () => {
  const date = evaluate(`resolveCashReportDate_(
    '',
    '22.07.2026',
    [{slipDate:'22.07.2026'}]
  )`);
  assert.equal(date, '');
});

test('cash sanitizer keeps exact payment rows separate and includes QR in slip data', () => {
  const result = evaluate(`sanitizeCashReportResult_({
    report_date:'21.07.2026',
    fiscal_total:329000,
    non_fiscal_total:53500,
    total_revenue:382500,
    collection_amount:71938,
    collection_actual:71940,
    payment_rows:[
      {section:'fiscal', row_name:'Банковские карты', amount:300000},
      {section:'other', row_name:'Банковские карты 2', amount:15000},
      {section:'non_fiscal', row_name:'Наличка', amount:25000},
      {section:'fiscal', row_name:'Оплата наличными', amount:12000},
      {section:'non_fiscal', row_name:'Наличные 2', amount:5000},
      {section:'other', row_name:'Tapper', amount:2500},
      {section:'other', row_name:'Расчётный счёт', amount:12000},
      {section:'other', row_name:'Расчётный счёт 2', amount:3000},
      {section:'other', row_name:'Онлайн-Касса 2', amount:8000},
      {section:'non_fiscal', row_name:'ИТОГО (Безналичный расчёт)', amount:999999}
    ],
    terminal_slips:[
      {label:'T:1234', slip_date:'21.07.2026', card_amount:295000, qr_amount:5000, total_amount:300000, amount:300000}
    ]
  }, 3)`);
  const value = plain(result);
  assert.equal(value.bankCards, 300000);
  assert.equal(value.bankCards2, 15000);
  assert.equal(value.cashNonFiscal, 25000);
  assert.equal(value.cashFiscal, 12000);
  assert.equal(value.cash2, 5000);
  assert.equal(value.tapper, 2500);
  assert.equal(value.settlementAccount, 12000);
  assert.equal(value.settlementAccount2, 3000);
  assert.equal(value.onlineCashbox2, 8000);
  assert.equal(value.collectionAmount, 71938);
  assert.equal(value.collectionActual, 71940);
  assert.equal(value.terminalSlips[0].amount, 300000);
  assert.equal(value.terminalSlips[0].qrAmount, 5000);
  assert.equal(value.terminalSlips[0].componentMismatch, false);
});
