const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const stockSource = readFileSync(join(process.cwd(), 'apps-script/stock/production/Code.gs'), 'utf8');
const banquetsSource = readFileSync(join(process.cwd(), 'apps-script/banquets/production/Code.gs'), 'utf8');
const frontendSource = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

class FakeSheet {
  constructor(rows) { this.rows = rows.map(row => [...row]); }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return Math.max(0, ...this.rows.map(row => row.length)); }
  getMaxColumns() { return this.getLastColumn(); }
  insertColumnsAfter() {}
  appendRow(row) { this.rows.push([...row]); }
  getRange(row, column, rowCount = 1, columnCount = 1) {
    const sheet = this;
    const read = () => Array.from({ length: rowCount }, (_, r) => Array.from(
      { length: columnCount }, (_, c) => sheet.rows[row - 1 + r]?.[column - 1 + c] ?? ''
    ));
    const write = values => values.forEach((valuesRow, r) => valuesRow.forEach((value, c) => {
      const rowIndex = row - 1 + r;
      if (!sheet.rows[rowIndex]) sheet.rows[rowIndex] = [];
      sheet.rows[rowIndex][column - 1 + c] = value;
    }));
    return {
      getValues: read,
      getDisplayValues: () => read().map(values => values.map(value => String(value ?? ''))),
      getValue: () => read()[0][0],
      getDisplayValue: () => String(read()[0][0] ?? ''),
      setValue: value => write([[value]]),
      setValues: values => write(values),
      setFontWeight: () => this,
      setBackground: () => this,
      setFontColor: () => this
    };
  }
}

function makeSpreadsheet(sheets) {
  return { getSheetByName: name => sheets[name] || null };
}

function makeContext({ banquetSheet, reserveSheet }) {
  const banquetSpreadsheet = makeSpreadsheet({ 'Банкеты': banquetSheet });
  const stockSpreadsheet = makeSpreadsheet({ 'Банкеты_Резерв': reserveSheet });
  const properties = { SPREADSHEET_ID: 'stock-sheet', GEMINI_MODEL: 'gemini-test' };
  return vm.createContext({
    console,
    Date,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Error,
    isNaN,
    SpreadsheetApp: {
      openById: id => id === 'stock-sheet' ? stockSpreadsheet : banquetSpreadsheet,
      getActive: () => stockSpreadsheet,
      flush: () => {}
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || '', getProperties: () => properties }) },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: { formatDate: () => '01.01.2026', base64Encode: () => '' },
    Session: { getScriptTimeZone: () => 'Europe/Moscow' },
    ContentService: { MimeType: { JSON: 'JSON', JAVASCRIPT: 'JAVASCRIPT' }, createTextOutput: () => ({ setMimeType() { return this; } }) },
    UrlFetchApp: {},
    DriveApp: {},
    Logger: { log: () => {} }
  });
}

function headers() {
  return ['ID','Дата','Время','Название','Комментарий','Статус','Cloudinary Public ID','Image URL','Добавлено','Telegram User ID','Telegram User Name','Удалено'];
}

function reserveHeaders() {
  return ['ID банкета','Дата банкета','Название банкета','Статус банкета','Статус закупки','Наименование с фото','Лист стока','Строка стока','Позиция FO’X','Нужно','Уже заказано','К заказу','Ед. изм.','Image URL','Создано','Обновлено','Архив','Совпадение','Комментарий','Дата отправки заказа'];
}

function makeRuntime() {
  const banquetSheet = new FakeSheet([headers()]);
  const reserveSheet = new FakeSheet([reserveHeaders(), Array(20).fill('')]);
  const context = makeContext({ banquetSheet, reserveSheet });
  vm.runInContext(stockSource, context, { filename: 'stock-production.gs' });
  vm.runInContext(banquetsSource, context, { filename: 'banquets-production.gs' });
  return { context, banquetSheet, reserveSheet };
}

function seedBanquet(context, id, status = 'Актуально', date = '2026-08-01') {
  context.saveBanquet_({ id, date, time: '19:00', name: id, status, telegramUserId: '1036250074' });
}

function matchedItem(name = 'Вино') {
  return { rawName: name, quantity: 2, unit: 'бут.', stockSheet: 'Вино', stockRow: 3, stockName: name, stockUnit: 'бут.', confidence: 1 };
}

test('повторный POST с тем же ID обновляет банкет без дубля', () => {
  const { context, banquetSheet } = makeRuntime();
  seedBanquet(context, 'b-repeat');
  context.saveBanquet_({ id: 'b-repeat', date: '2026-08-01', time: '20:00', name: 'Обновлён', status: 'Актуально', telegramUserId: '1036250074' });
  assert.equal(banquetSheet.getLastRow(), 2);
  assert.equal(banquetSheet.rows[1][3], 'Обновлён');
});

test('один банкет и два банкета на одну дату сохраняют отдельный резерв', () => {
  const { context, reserveSheet } = makeRuntime();
  seedBanquet(context, 'b-one');
  seedBanquet(context, 'b-two');
  context.saveBanquetReserve_('b-one', '2026-08-01', 'Первый', 'https://img/1', [matchedItem('Вино')], []);
  context.saveBanquetReserve_('b-two', '2026-08-01', 'Второй', 'https://img/2', [matchedItem('Вино')], []);
  assert.equal(reserveSheet.rows.filter(row => row[0] === 'b-one' && row[16] !== 'YES').length, 1);
  assert.equal(reserveSheet.rows.filter(row => row[0] === 'b-two' && row[16] !== 'YES').length, 1);
});

test('одна позиция в разных банкетах остаётся отдельной в резерве', () => {
  const { context, reserveSheet } = makeRuntime();
  seedBanquet(context, 'b-a');
  seedBanquet(context, 'b-b');
  context.saveBanquetReserve_('b-a', '2026-08-01', 'A', 'https://img/a', [matchedItem('Просекко')], []);
  context.saveBanquetReserve_('b-b', '2026-08-02', 'B', 'https://img/b', [matchedItem('Просекко')], []);
  assert.equal(reserveSheet.rows.filter(row => row[8] === 'Просекко' && row[16] !== 'YES').length, 2);
});

test('поздний OCR использует текущие статусы «Пройден» и «Отменён»', () => {
  const { context, reserveSheet } = makeRuntime();
  seedBanquet(context, 'b-complete', 'Выполнено');
  seedBanquet(context, 'b-cancel', 'Отменено');
  context.saveBanquetReserve_('b-complete', '2026-08-01', 'Готов', 'https://img/complete', [matchedItem()], []);
  context.saveBanquetReserve_('b-cancel', '2026-08-01', 'Отмена', 'https://img/cancel', [matchedItem()], []);
  assert.equal(reserveSheet.rows.find(row => row[0] === 'b-complete')[3], 'Выполнено');
  assert.equal(reserveSheet.rows.find(row => row[0] === 'b-cancel')[3], 'Отменено');
});

test('неизвестная позиция сохраняет имя, количество, единицу и статус', () => {
  const { context, reserveSheet } = makeRuntime();
  seedBanquet(context, 'b-unknown');
  context.saveBanquetReserve_('b-unknown', '2026-08-01', 'Неизвестный', 'https://img/unknown', [{ rawName: 'Редкий тоник', quantity: 5, unit: 'шт.', stockSheet: '', stockRow: '', stockName: '', stockUnit: 'шт.', confidence: 0 }], []);
  const row = reserveSheet.rows.find(item => item[0] === 'b-unknown');
  assert.deepEqual([row[4], row[5], row[9], row[12]], ['Требует сопоставления', 'Редкий тоник', 5, 'шт.']);
});

test('поддерживаются 0, 1 и 5 URL без повторов', () => {
  const { context } = makeRuntime();
  assert.deepEqual(Array.from(context.banquetImageUrlsFromRequest_({})), []);
  assert.deepEqual(Array.from(context.banquetImageUrlsFromRequest_({ imageUrl: 'https://img/1' })), ['https://img/1']);
  const urls = ['1','2','3','4','5'].map(value => 'https://img/' + value);
  assert.deepEqual(Array.from(context.banquetImageUrlsFromRequest_({ imageUrlsJson: JSON.stringify([...urls, urls[0]]) })), urls);
});

test('пять фото распознаются по одному и объединяются до сохранения', () => {
  const { context } = makeRuntime();
  const urls = ['1','2','3','4','5'].map(value => 'https://img/' + value);
  const recognized = [];
  let saved = null;
  context.createBanquetJob_ = () => {};
  context.updateBanquetJob_ = () => {};
  context.recognizeBanquetImageWithGemini_ = url => {
    recognized.push(url);
    return { items:[{ rawName:url, quantity:1, unit:'шт.' }], ignored:[] };
  };
  context.matchBanquetItems_ = items => items;
  context.saveBanquetReserve_ = (...args) => {
    saved = args;
    return { recognized:true, matchedCount:5 };
  };
  context.scanBanquetReserve_({
    jobId:'job-five', banquetId:'b-five', banquetDate:'2026-08-01', banquetName:'Пять фото',
    imageUrlsJson:JSON.stringify(urls)
  }, { userId:'1036250074' });
  assert.deepEqual(recognized, urls);
  assert.equal(saved[3], urls[0]);
  assert.equal(saved[4].length, 5);
});

test('повторный OCR архивирует прошлый активный резерв и создаёт новый', () => {
  const { context, reserveSheet } = makeRuntime();
  seedBanquet(context, 'b-ocr');
  context.saveBanquetReserve_('b-ocr', '2026-08-01', 'OCR', 'https://img/one', [matchedItem('Вино')], []);
  context.saveBanquetReserve_('b-ocr', '2026-08-01', 'OCR', 'https://img/two', [matchedItem('Вино')], []);
  const rows = reserveSheet.rows.filter(row => row[0] === 'b-ocr');
  assert.equal(rows.filter(row => row[16] === 'YES').length, 1);
  assert.equal(rows.filter(row => row[16] !== 'YES').length, 1);
});

test('повторный OCR с изменённым количеством заменяет вклад банкета без дубля', () => {
  const { context, reserveSheet } = makeRuntime();
  seedBanquet(context, 'b-quantity');
  context.saveBanquetReserve_('b-quantity', '2026-08-01', 'Количество', 'https://img/one', [matchedItem('Вино')], []);
  context.saveBanquetReserve_('b-quantity', '2026-08-01', 'Количество', 'https://img/two', [{ ...matchedItem('Вино'), quantity: 5 }], []);
  const active = reserveSheet.rows.filter(row => row[0] === 'b-quantity' && row[16] !== 'YES');
  assert.equal(active.length, 1);
  assert.deepEqual([active[0][9], active[0][11]], [5, 5]);
});

test('повторный OCR без удалённой позиции сразу снимает её вклад из резерва', () => {
  const { context } = makeRuntime();
  seedBanquet(context, 'b-remove-position');
  context.saveBanquetReserve_('b-remove-position', '2026-08-01', 'Позиции', 'https://img/one', [matchedItem('Вино'), matchedItem('Просекко')], []);
  context.saveBanquetReserve_('b-remove-position', '2026-08-01', 'Позиции', 'https://img/two', [matchedItem('Вино')], []);
  const summary = context.getBanquetReserveSummaries_()['b-remove-position'];
  assert.equal(summary.items.map(item => item.stockName).join(','), 'Вино');
});

test('смена статуса возвращает фактическое число строк и ошибка при нуле', () => {
  const { context } = makeRuntime();
  seedBanquet(context, 'b-status');
  context.saveBanquetReserve_('b-status', '2026-08-01', 'Статус', 'https://img/status', [matchedItem()], []);
  context.updateBanquetStatus_('b-status', 'Отменён');
  const summary = context.setBanquetReserveStatus_('b-status');
  assert.equal(summary.changedCount, 1);
  assert.throws(() => context.setBanquetReserveStatus_('missing'));
});

test('сводка автоматически снимает вклад завершённого банкета из резерва', () => {
  const { context, reserveSheet } = makeRuntime();
  seedBanquet(context, 'b-finished');
  context.saveBanquetReserve_('b-finished', '2026-08-01', 'Завершён', 'https://img/status', [matchedItem('Вино')], []);
  context.updateBanquetStatus_('b-finished', 'Пройден');
  context.getBanquetReserveSummaries_();
  const row = reserveSheet.rows.find(item => item[0] === 'b-finished');
  assert.equal(row[3], 'Выполнено');
  assert.equal(context.getBanquetReserveSummaries_()['b-finished'].items[0].pending, 0);
});

test('завершение одного из двух банкетов сохраняет резерв второго на ту же позицию', () => {
  const { context } = makeRuntime();
  seedBanquet(context, 'b-current');
  seedBanquet(context, 'b-finished');
  context.saveBanquetReserve_('b-current', '2026-08-01', 'Текущий', 'https://img/current', [matchedItem('Просекко')], []);
  context.saveBanquetReserve_('b-finished', '2026-08-01', 'Завершён', 'https://img/finished', [matchedItem('Просекко')], []);
  context.updateBanquetStatus_('b-finished', 'Завершено');
  const summaries = context.getBanquetReserveSummaries_();
  assert.equal(summaries['b-current'].items[0].pending, 2);
  assert.equal(summaries['b-finished'].items[0].pending, 0);
});

test('удалённый в источнике банкет архивируется при reconciliation', () => {
  const { context, banquetSheet, reserveSheet } = makeRuntime();
  seedBanquet(context, 'b-deleted');
  context.saveBanquetReserve_('b-deleted', '2026-08-01', 'Удалён', 'https://img/deleted', [matchedItem()], []);
  context.deleteBanquet_('b-deleted');
  context.getBanquetReserveSummaries_();
  const row = reserveSheet.rows.find(item => item[0] === 'b-deleted');
  assert.equal(row[16], 'YES');
  assert.equal(banquetSheet.rows[1][11], 'YES');
});

test('отправка заказа снимает только сопоставленную позицию из заказа', () => {
  const { context, reserveSheet } = makeRuntime();
  seedBanquet(context, 'b-order');
  context.saveBanquetReserve_('b-order', '2026-08-01', 'Заказ', 'https://img/order', [matchedItem()], []);
  context.setBanquetOrderSent_('b-order', true);
  const row = reserveSheet.rows.find(item => item[0] === 'b-order');
  assert.deepEqual([row[10], row[11], row[4]], [2, 0, 'Заказ отправлен']);
});

test('график: пусто и X не являются сменой, число и диапазон являются', () => {
  const { context } = makeRuntime();
  assert.equal(context.parseFoxScheduleShift_('').isWorking, false);
  assert.equal(context.parseFoxScheduleShift_('X').isWorking, false);
  assert.deepEqual(JSON.parse(JSON.stringify(context.parseFoxScheduleShift_('10'))), { rawValue:'10', isWorking:true, shiftStart:'10', shiftEnd:'' });
  assert.deepEqual(JSON.parse(JSON.stringify(context.parseFoxScheduleShift_('11-17'))), { rawValue:'11-17', isWorking:true, shiftStart:'11', shiftEnd:'17' });
  assert.equal(context.parseFoxScheduleShift_('Инв').isWorking, false);
});

test('итоговая сумма банкета хранится числом, допускает ноль и очистку', () => {
  const { context } = makeRuntime();
  seedBanquet(context, 'b-final');
  assert.equal(context.setFoxBanquetFinalAmount_('b-final', '186450').finalAmount, 186450);
  assert.equal(context.setFoxBanquetFinalAmount_('b-final', '0').finalAmount, 0);
  assert.equal(context.setFoxBanquetFinalAmount_('b-final', '').finalAmount, null);
  assert.throws(() => context.setFoxBanquetFinalAmount_('b-final', '-1'));
});

test('OCR графика показывает собственный статус и ждёт Gemini дольше обычного JSONP', () => {
  assert.match(frontendSource, /id="foxScheduleStatus"/);
  assert.match(frontendSource, /function setFoxScheduleStatus_/);
  assert.match(frontendSource, /action:'foxScheduleRecognize'[^\n]*90000/);
  assert.match(frontendSource, /Gemini распознаёт график/);
});

test('OCR графика передаёт выбранный месяц и backend использует его при пустом месяце на фото', () => {
  assert.match(frontendSource, /action:'foxScheduleRecognize',imageUrl:uploaded\.url,month:month/);
  assert.match(stockSource, /recognizeFoxScheduleImage_\(e\.parameter\.imageUrl, e\.parameter\.month\)/);
  assert.match(stockSource, /requestedMonth = normalizeFoxScheduleMonth_\(requestedMonth\)/);
  assert.match(stockSource, /: requestedMonth;/);
});
