'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const backend = fs.readFileSync(path.join(root, 'apps-script/stock-scanner/candidate/Code.gs'), 'utf8');
const helpers = backend.match(/function normalizeTelegramVenue_\([\s\S]*?(?=function authorizeRequest_\()/);
assert.ok(helpers, 'Telegram route helper block must exist');

const properties = {
  TELEGRAM_BOT_TOKEN: 'fox-token',
  TELEGRAM_TARGET_CHAT_ID: '-1001',
  TATOOINE_TELEGRAM_BOT_TOKEN: 'tatooine-token',
  TATOOINE_TELEGRAM_TARGET_CHAT_ID: '-2002',
  TATOOINE_TELEGRAM_ALLOWED_USER_IDS: '77, 88'
};
const context = vm.createContext({
  FOX_RECEIPTS: { adminTelegramIds: ['11', '22'], allowAllTelegramUsers: true },
  PropertiesService: {
    getScriptProperties() {
      return { getProperty(name) { return properties[name] || ''; } };
    }
  },
  getJobRow_() { return null; }
});
vm.runInContext(helpers[0], context, { filename: 'Code.gs' });

test('Tatooine selects its own token, chat and access list', () => {
  const route = vm.runInContext("telegramRouteConfig_({venue:'tatooine'})", context);
  assert.equal(route.venue, 'tatooine');
  assert.equal(route.botToken, 'tatooine-token');
  assert.equal(route.targetChatId, '-2002');
  assert.deepEqual(Array.from(route.allowedUserIds), ['77', '88']);
  assert.equal(route.allowAllUsers, false);
});

test('FO’X keeps its existing Telegram route', () => {
  const route = vm.runInContext("telegramRouteConfig_({venue:'fox'})", context);
  assert.equal(route.venue, 'fox');
  assert.equal(route.botToken, 'fox-token');
  assert.equal(route.targetChatId, '-1001');
  assert.deepEqual(Array.from(route.allowedUserIds), ['11', '22']);
  assert.equal(route.allowAllUsers, true);
});

test('Tatooine route accepts only cash-report actions', () => {
  assert.doesNotThrow(() => vm.runInContext("assertTelegramActionAllowed_('cashReportScanImages',{venue:'tatooine'})", context));
  assert.doesNotThrow(() => vm.runInContext("assertTelegramActionAllowed_('cashReportSend',{venue:'tatooine'})", context));
  assert.throws(() => vm.runInContext("assertTelegramActionAllowed_('scanImages',{venue:'tatooine'})", context), /только кассовый отчёт/);
  assert.throws(() => vm.runInContext("assertTelegramActionAllowed_('catalog',{venue:'tatooine'})", context), /только кассовый отчёт/);
});

test('cash jobs are isolated by bot route', () => {
  assert.equal(vm.runInContext("cashReportJobMode_({venue:'tatooine'})", context), 'cash_report:tatooine');
  assert.equal(vm.runInContext("cashReportJobMode_({venue:'fox'})", context), 'cash_report');
  context.tatooineJob = { 'Режим': 'cash_report:tatooine' };
  context.foxJob = { 'Режим': 'cash_report' };
  assert.equal(vm.runInContext("jobMatchesTelegramRoute_(tatooineJob,{venue:'tatooine'})", context), true);
  assert.equal(vm.runInContext("jobMatchesTelegramRoute_(tatooineJob,{venue:'fox'})", context), false);
  assert.equal(vm.runInContext("jobMatchesTelegramRoute_(foxJob,{venue:'fox'})", context), true);
});

test('job creation, status and sending use route-aware helpers', () => {
  assert.match(backend, /new Date\(\), '', cashReportJobMode_\(auth\)/);
  assert.match(backend, /идентификатор задания уже используется другим пользователем или ботом/);
  assert.match(backend, /const route = telegramRouteConfig_\(auth\);/);
  assert.match(backend, /getJobStatus_\(jobId, auth\)/);
  assert.match(backend, /!jobMatchesTelegramRoute_\(row, auth\)/);
});
