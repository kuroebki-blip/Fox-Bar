'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'frontend/tatooine/app.js'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'frontend/tatooine/config.js'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'apps-script/stock-scanner/candidate/Code.gs'), 'utf8');
const helperMatch = app.match(/\/\/ ===== TATOOINE TESTABLE HELPERS START =====([\s\S]*?)\/\/ ===== TATOOINE TESTABLE HELPERS END =====/);
assert.ok(helperMatch, 'Tatooine helper block must exist');
const context = vm.createContext({ CONFIG: Object.freeze({ maxOcrPages: 20, maxOcrImageBytes: 6 * 1024 * 1024, maxOcrTotalBytes: 12 * 1024 * 1024 }) });
vm.runInContext(helperMatch[1], context, { filename: 'frontend/tatooine/app.js' });

test('Tatooine uses 100000 as the default change fund', () => {
  const configContext = vm.createContext({ window: {} });
  vm.runInContext(configSource, configContext, { filename: 'frontend/tatooine/config.js' });
  assert.equal(configContext.window.TATOOINE_CONFIG.defaultChangeFund, 100000);
  assert.match(app, /cashReportChangeFund'\)\.value = String\(Number\(CONFIG\.defaultChangeFund\) \|\| 0\)/);
});

test('Tatooine message follows the approved Petrovka report layout', () => {
  context.data = {
    location: 'ПЕТРОВКА',
    date: '21.07.2026',
    totalRevenue: 603760,
    bankCards: 409066,
    cashTotal: 155068,
    onlineCashbox2: 30000,
    eatAndSplit: 85000,
    yandexFood: 9626,
    collection: 155068,
    collectionActual: 155070,
    changeFund: 100000,
    prepayments: [
      { date: '23.07.2026', amount: 56000 },
      { date: '30.07.2026', amount: 30000 }
    ]
  };
  const message = vm.runInContext('buildTatooineCashMessage(data)', context);
  assert.doesNotMatch(message, /Нал Фискал/);
  assert.equal(message, [
    'TATOOINE',
    '',
    '🦊 ПЕТРОВКА  🦊',
    '📈ОТЧЕТ КАССОВОЙ СМЕНЫ',
    'ДАТА: 21.07.26',
    '',
    '🪙Общая выручка: 603 760',
    '',
    '🧪 Безнал: 409 066',
    '',
    '🧪 Нал: 155 068',
    '',
    '🧪 Онлайн касса 2: 30 000',
    '',
    '📈EatAndSplit: 85 000',
    '',
    '🌎Яндекс еда: 9 626',
    '',
    '',
    '',
    '💀 Расход:',
    '',
    '🧪 Инкассация: 155 068 (155 070)',
    '',
    '🔠 Неизменный размен [100 000]',
    '',
    '🔄Предоплаты:',
    '',
    '23.07.26- 56.000',
    '30.07.26- 30.000',
    '',
    'Итого: 86.000'
  ].join('\n'));
});

test('backend applies a Tatooine-only Telegram template and keeps FO’X routing intact', () => {
  assert.match(backend, /sendCashStyledTelegram_\(token, targetChatId, messageText, auth\.venue\)/);
  assert.match(backend, /normalizeTelegramVenue_\(venue\) === 'tatooine'/);
  assert.match(backend, /function buildTatooineCashTelegramHtml_/);
  assert.match(backend, /function tatooineCashCaptureTelegramStyle/);
});

test('Tatooine Telegram HTML keeps its brand and formatting without captured custom emoji', () => {
  const backendContext = vm.createContext({
    PropertiesService: {
      getScriptProperties() {
        return { getProperty() { return ''; } };
      }
    }
  });
  vm.runInContext(backend, backendContext, { filename: 'Code.gs' });
  backendContext.message = [
    'TATOOINE',
    '',
    '🦊 ПЕТРОВКА  🦊',
    '📈ОТЧЕТ КАССОВОЙ СМЕНЫ',
    'ДАТА: 21.07.26',
    '',
    '🪙Общая выручка: 603 760',
    '🧪 Безнал: 409 066'
  ].join('\n');
  const html = vm.runInContext("buildCashTelegramHtml_(message,'tatooine')", backendContext);
  assert.match(html, /^<b>TATOOINE<\/b>/);
  assert.match(html, /<blockquote>🦊 ПЕТРОВКА  🦊<\/blockquote>/);
  assert.match(html, /🪙<b>Общая выручка: 603 760<\/b>/);
  assert.match(html, /🧪 Безнал: 409 066/);
  assert.doesNotMatch(html, /<b>Безнал/);
  assert.doesNotMatch(html, /🔤🔤/);
});

test('EatAndSplit and Yandex Food accept real iiko 041 payment row prefixes', () => {
  context.rows = [
    { name: 'Оплата EatAndSplit Продажа', amount: 85000 },
    { name: 'Оплата Яндекс.Еда', amount: 9626 },
    { name: 'Безналичный расчёт', amount: 999999 }
  ];
  assert.equal(vm.runInContext("exactPaymentRowAmount(rows,['EatAndSplit'])", context), 85000);
  assert.equal(vm.runInContext("exactPaymentRowAmount(rows,['Яндекс еда','Яндекс.Еда'])", context), 9626);
});

test('every report row remains visible when its value is missing', () => {
  context.emptyData = { location: 'ПЕТРОВКА', date: '', prepayments: [] };
  const message = vm.runInContext('buildTatooineCashMessage(emptyData)', context);
  assert.equal(message, [
    'TATOOINE',
    '',
    '🦊 ПЕТРОВКА  🦊',
    '📈ОТЧЕТ КАССОВОЙ СМЕНЫ',
    'ДАТА:',
    '',
    '🪙Общая выручка:',
    '',
    '🧪 Безнал:',
    '',
    '🧪 Нал:',
    '',
    '🧪 Онлайн касса 2:',
    '',
    '📈EatAndSplit:',
    '',
    '🌎Яндекс еда:',
    '',
    '',
    '',
    '💀 Расход:',
    '',
    '🧪 Инкассация:',
    '',
    '🔠 Неизменный размен []'
  ].join('\n'));
  assert.doesNotMatch(message, /Предоплаты:/);
  assert.doesNotMatch(message, /Итого:/);
  assert.doesNotMatch(app, /bankCards2|cash2|tapper|settlementAccount|morningCash/);
});
