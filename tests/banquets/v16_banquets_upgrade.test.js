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
      setNumberFormat: () => this,
      setFontWeight: () => this,
      setBackground: () => this,
      setFontColor: () => this
    };
  }
}

function makeSpreadsheet(sheets) {
  return { getSheetByName: name => sheets[name] || null };
}

function makeContext({ banquetSheet, reserveSheet, scheduleSheet, scheduleShiftSheet }) {
  const banquetSpreadsheet = makeSpreadsheet({ 'Банкеты': banquetSheet });
  const stockSpreadsheet = makeSpreadsheet({ 'Банкеты_Резерв': reserveSheet, 'FOx_ГрафикиСотрудников': scheduleSheet, 'FOx_СменыСотрудников': scheduleShiftSheet });
  const properties = { SPREADSHEET_ID: 'stock-sheet', GEMINI_MODEL: 'gemini-test' };
  const cache = new Map();
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
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || '', getProperties: () => properties, setProperty: (key, value) => { properties[key] = value; }, deleteProperty: key => { delete properties[key]; } }) },
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key) || null, put: (key, value) => cache.set(key, value), remove: key => cache.delete(key) }) },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: { formatDate: (date, _timezone, format) => {
      const yyyy = date.getUTCFullYear(); const mm = String(date.getUTCMonth() + 1).padStart(2, '0'); const dd = String(date.getUTCDate()).padStart(2, '0');
      return format === 'yyyy-MM' ? yyyy + '-' + mm : yyyy + '-' + mm + '-' + dd;
    }, base64Encode: () => '' },
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
  const scheduleSheet = new FakeSheet([['FO’X — ГРАФИКИ СОТРУДНИКОВ'], ['ID графика','Месяц','Статус','Image URL','Создано','Обновлено','Обновил пользователь'], ['schedule_august','2026-08','ACTIVE','','','','']]);
  const scheduleShiftSheet = new FakeSheet([['FO’X — СМЕНЫ СОТРУДНИКОВ'], ['ID графика','Дата','Employee ID','Имя сотрудника','Исходное значение','Рабочая смена','Начало','Конец','Создано','Обновлено','Тип смены','Роль на смене']]);
  const context = makeContext({ banquetSheet, reserveSheet, scheduleSheet, scheduleShiftSheet });
  vm.runInContext(stockSource, context, { filename: 'stock-production.gs' });
  vm.runInContext(banquetsSource, context, { filename: 'banquets-production.gs' });
  return { context, banquetSheet, reserveSheet, scheduleSheet, scheduleShiftSheet };
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

test('резервный защищённый backend возвращает тот же активный банкет для календаря', () => {
  const { context } = makeRuntime();
  seedBanquet(context, 'b-calendar-fallback', 'Актуально', '2026-08-28');
  const result = context.listFoxCalendarBanquets_();
  assert.equal(result.mediaSupported, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.items.map(item => ({ id:item.id, date:item.date, status:item.status })))), [
    { id:'b-calendar-fallback', date:'2026-08-28', status:'Актуально' }
  ]);
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

test('график: X игнорируется, Инв хранится отдельной сменой, а число и диапазон сохраняют время начала', () => {
  const { context } = makeRuntime();
  assert.equal(context.parseFoxScheduleShift_('').isWorking, false);
  assert.equal(context.parseFoxScheduleShift_('X').isWorking, false);
  assert.deepEqual(JSON.parse(JSON.stringify(context.parseFoxScheduleShift_('10'))), { rawValue:'10', isWorking:true, shiftStart:'10:00', shiftEnd:'' });
  assert.deepEqual(JSON.parse(JSON.stringify(context.parseFoxScheduleShift_('11-17'))), { rawValue:'11-17', isWorking:true, shiftStart:'11:00', shiftEnd:'17:00' });
  assert.deepEqual(JSON.parse(JSON.stringify(context.parseFoxScheduleShift_('Инв'))), { rawValue:'Инв', isWorking:true, shiftStart:'', shiftEnd:'', shiftType:'inventory' });
  assert.equal(context.normalizeFoxScheduleShiftType_('ЗАГОТОВКА'), 'preparation');
  assert.equal(context.normalizeFoxScheduleShiftType_('Инвентаризация'), 'inventory');
  assert.equal(context.normalizeFoxScheduleShiftType_('regular'), 'regular');
});

test('график не сохраняет дубль одной смены сотрудника в одной секции', () => {
  const { context } = makeRuntime();
  const result = context.dedupeFoxScheduleRows_([
    { name:'Иван', date:'2026-08-28', rawValue:'11', shiftType:'regular' },
    { name:'Иван', date:'2026-08-28', rawValue:'11', shiftType:'regular' },
    { name:'Иван', date:'2026-08-28', rawValue:'11', shiftType:'preparation' }
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.map(row => row.shiftType))), ['regular', 'preparation']);
});

test('недельные графики объединяются по датам и переходящая неделя сохраняется в оба месяца', () => {
  const { context } = makeRuntime();
  const auth = { userId:'1036250074', userName:'Админ' };
  context.saveFoxSchedule_({
    month:'2026-08', imageUrl:'https://image/week-1',
    rowsJson:JSON.stringify([
      { date:'2026-08-24', name:'Макс', rawValue:'10' },
      { date:'2026-08-30', name:'Макс', rawValue:'11' }
    ])
  }, auth);
  context.saveFoxSchedule_({
    month:'2026-09', imageUrl:'https://image/week-2',
    rowsJson:JSON.stringify([
      { date:'2026-08-31', name:'Макс', rawValue:'12' },
      { date:'2026-09-01', name:'Макс', rawValue:'13' },
      { date:'2026-09-06', name:'Макс', rawValue:'14' }
    ])
  }, auth);
  assert.deepEqual(JSON.parse(JSON.stringify(context.getFoxScheduleForMonth_('2026-08').rows.map(row => [row.date, row.rawValue]))), [
    ['2026-08-24', '10'], ['2026-08-30', '11'], ['2026-08-31', '12']
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.getFoxScheduleForMonth_('2026-09').rows.map(row => [row.date, row.rawValue]))), [
    ['2026-09-01', '13'], ['2026-09-06', '14']
  ]);
});

test('OCR нормализует 31 сентября в 31 августа для переходящей недели сентября', () => {
  const { context } = makeRuntime();
  assert.equal(context.normalizeFoxScheduleOcrDate_('2026-09-31', '2026-09'), '2026-08-31');
  assert.equal(context.normalizeFoxScheduleOcrDate_('2026-09-01', '2026-09'), '2026-09-01');
});

test('график не теряет смену, если OCR вернул время с двоеточием, и сохраняет исходное время как источник истины', () => {
  const { context } = makeRuntime();
  assert.deepEqual(JSON.parse(JSON.stringify(context.parseFoxScheduleShift_('10:30'))), { rawValue:'10:30', isWorking:true, shiftStart:'10:30', shiftEnd:'' });
  assert.deepEqual(JSON.parse(JSON.stringify(context.parseFoxScheduleShift_('11:00–17:30'))), { rawValue:'11:00–17:30', isWorking:true, shiftStart:'11:00', shiftEnd:'17:30' });
  assert.equal(context.parseFoxScheduleShift_('Х').isWorking, false);
});

test('график корректно читает ISO-месяц и дату, даже если Google Sheets уже преобразовал их в Date', () => {
  const { context } = makeRuntime();
  const saved = new Date(Date.UTC(2026, 7, 24, 12));
  assert.equal(context.foxScheduleStoredMonth_(saved), '2026-08');
  assert.equal(context.foxScheduleStoredDate_(saved), '2026-08-24');
  assert.equal(context.foxScheduleStoredMonth_('2026-08'), '2026-08');
  assert.equal(context.foxScheduleStoredDate_('2026-08-24'), '2026-08-24');
});

test('график корректно читает время из преобразованной Sheets Date-ячейки и сопоставляет переставленные части имени', () => {
  const { context } = makeRuntime();
  const savedTime = new Date(Date.UTC(1899, 11, 30, 18, 0));
  assert.equal(context.foxScheduleStoredTime_(savedTime), '18:00');
  assert.equal(context.foxScheduleStoredTime_('9:30'), '09:30');
  assert.equal(context.foxScheduleNamesMatch_('Захар Захарченко', 'Захарченко Захар'), true);
  assert.equal(context.foxScheduleNamesMatch_('Захар Захарченко', 'Захар Захаров'), false);
});

test('итоговая сумма банкета хранится числом, допускает ноль и очистку', () => {
  const { context } = makeRuntime();
  seedBanquet(context, 'b-final');
  assert.equal(context.setFoxBanquetFinalAmount_('b-final', '186450').finalAmount, 186450);
  assert.equal(context.setFoxBanquetFinalAmount_('b-final', '0').finalAmount, 0);
  assert.equal(context.setFoxBanquetFinalAmount_('b-final', '').finalAmount, null);
  assert.throws(() => context.setFoxBanquetFinalAmount_('b-final', '-1'));
});

test('закрытие банкета хранит три сервиса и дедуплицирует ответственных официантов', () => {
  const { context } = makeRuntime();
  seedBanquet(context, 'b-services', 'Выполнено', '2026-08-28');
  const result = context.setFoxBanquetClosure_('b-services', {
    service1: '12000', service2: '8000.50', serviceHookah: '0',
    responsibleWaitersJson: JSON.stringify([' Анна ', 'Иван', 'Анна', ''])
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    id:'b-services', service1:12000, service2:8000.5, serviceHookah:0,
    responsibleWaiters:['Анна','Иван']
  });
  const item = context.listFoxCalendarBanquets_().items[0];
  assert.deepEqual(JSON.parse(JSON.stringify({
    service1:item.service1, service2:item.service2, serviceHookah:item.serviceHookah,
    responsibleWaiters:item.responsibleWaiters, finalAmount:item.finalAmount
  })), { service1:12000, service2:8000.5, serviceHookah:0, responsibleWaiters:['Анна','Иван'], finalAmount:null });
});

test('закрытие банкета отклоняет отрицательный сервис и не меняет старую итоговую сумму', () => {
  const { context } = makeRuntime();
  seedBanquet(context, 'b-services-invalid', 'Выполнено');
  context.setFoxBanquetFinalAmount_('b-services-invalid', '9000');
  assert.throws(() => context.setFoxBanquetClosure_('b-services-invalid', {
    service1:'-1', service2:'', serviceHookah:'', responsibleWaitersJson:'[]'
  }));
  assert.equal(context.listFoxCalendarBanquets_().items[0].finalAmount, 9000);
});

test('периодный отчёт выводит каждый банкет отдельно и использует барменов даты', () => {
  const { context } = makeRuntime();
  seedBanquet(context, 'b-report-a', 'Выполнено', '2026-08-28');
  seedBanquet(context, 'b-report-b', 'Выполнено', '2026-08-28');
  context.setFoxBanquetClosure_('b-report-a', { service1:'100', service2:'', serviceHookah:'50', responsibleWaitersJson:'["Анна"]' });
  context.setFoxBanquetClosure_('b-report-b', { service1:'200', service2:'300', serviceHookah:'', responsibleWaitersJson:'["Иван","Оля"]' });
  context.listFoxScheduleWorkers_ = () => ({ items:[{ name:'Бармен Пётр', shiftStart:'18:00', workRole:'bartender' },{ name:'Официант Анна', shiftStart:'18:00', workRole:'' }] });
  const report = context.buildFoxBanquetPeriodReport_({ dateFrom:'2026-08-28', dateTo:'2026-08-28' });
  assert.equal(report.count, 2);
  assert.equal((report.text.match(/🎉 28\/08\/26/g) || []).length, 2);
  assert.match(report.text, /🗓 28\/08\/26 — 28\/08\/26/);
  assert.match(report.text, /🎉 28\/08\/26<\/b>\n/);
  assert.doesNotMatch(report.text, /🎉 28\/08\/26 ·/);
  assert.doesNotMatch(report.text, /b-report-a/);
  assert.doesNotMatch(report.text, /19:00/);
  assert.match(report.text, /💰 Сервис 1: 100 ₽/);
  assert.match(report.text, /👔 Ответственные официанты: Анна/);
  assert.match(report.text, /🍸 Бармены: Бармен Пётр/);
  assert.doesNotMatch(report.text, /Бармены: Бармен Пётр · с/);
});

test('ручной бармен сохраняется в списке и отчёте после замены OCR-графика месяца', () => {
  const { context, scheduleShiftSheet } = makeRuntime();
  scheduleShiftSheet.rows.push([
    'schedule_previous', '2026-08-28', '', 'Пётр Бармен', '18:00', 'YES', '18:00', '', '', '', 'regular', 'bartender'
  ]);
  const workers = context.listFoxScheduleWorkers_('2026-08-28');
  assert.equal(workers.scheduleFound, true);
  assert.deepEqual(JSON.parse(JSON.stringify(workers.items)), [{
    employeeId:'', name:'Пётр Бармен', rawValue:'18:00', shiftStart:'18:00', shiftEnd:'', shiftType:'regular', workRole:'bartender'
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.foxBanquetReportBartenders_('2026-08-28'))), ['Пётр Бармен']);
});

test('бармен из распознанного графика сохраняет роль и попадает в отчёт', () => {
  const { context } = makeRuntime();
  const auth = { userId:'1036250074', userName:'Админ', venue:'fox' };
  context.saveFoxSchedule_({
    month:'2026-08', imageUrl:'https://image/schedule',
    rowsJson:JSON.stringify([{ date:'2026-08-28', name:'Пётр', rawValue:'18', shiftType:'regular', workRole:'bartender' }])
  }, auth);
  assert.equal(context.listFoxScheduleWorkers_('2026-08-28').items[0].workRole, 'bartender');
  assert.deepEqual(JSON.parse(JSON.stringify(context.foxBanquetReportBartenders_('2026-08-28'))), ['Пётр']);
  assert.match(stockSource, /work_role/);
  assert.match(stockSource, /work_role="bartender"/);
  assert.match(frontendSource, /workRole:String\(row.workRole\|\|''\)/);
});

test('OCR считает секцию Бармены ролью bartender, даже если work_role пустой', () => {
  const { context } = makeRuntime();
  context.PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', 'test-key');
  context.UrlFetchApp.fetch = () => ({
    getResponseCode: () => 200,
    getBlob: () => ({ getBytes: () => Array(120).fill(1), getContentType: () => 'image/jpeg' })
  });
  context.callGeminiGenerateContent_ = () => ({ text: JSON.stringify({ month:'2026-08', rows:[{
    name:'Пётр', section:'Бармены', work_role:'', shifts:[{ date:'2026-08-28', raw_value:'18' }]
  }] }) });
  const result = context.recognizeFoxScheduleImage_('https://image/schedule', '2026-08');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].workRole, 'bartender');
});

test('ручной бармен — отдельная защищённая операция графика, а не поле старой итоговой суммы', () => {
  assert.match(stockSource, /action === 'foxScheduleAddBartender'/);
  assert.match(stockSource, /function addFoxScheduleBartender_/);
  assert.match(stockSource, /function normalizeFoxScheduleWorkRole_/);
  assert.match(frontendSource, /action:'foxScheduleAddBartender'/);
  assert.doesNotMatch(frontendSource.slice(frontendSource.indexOf('function renderBanqDay()'), frontendSource.indexOf('function changeBanquetStatus')), /Итоговая сумма/);
});

test('ручное добавление бармена создаёт одну смену и повторный запрос не дублирует её', () => {
  const { context, scheduleShiftSheet } = makeRuntime();
  const auth = { userId:'1036250074', userName:'Админ', venue:'fox' };
  const first = context.addFoxScheduleBartender_({ date:'2026-08-28', name:'Пётр Бармен', shiftStart:'18:00' }, auth);
  const second = context.addFoxScheduleBartender_({ date:'2026-08-28', name:'Бармен Пётр', shiftStart:'18:00' }, auth);
  assert.equal(scheduleShiftSheet.getLastRow(), 3);
  assert.deepEqual(JSON.parse(JSON.stringify(first.items)), [{ employeeId:'', name:'Пётр Бармен', rawValue:'18:00', shiftStart:'18:00', shiftEnd:'', shiftType:'regular', workRole:'bartender' }]);
  assert.equal(second.items.length, 1);
});

test('интерфейс закрытия показывает три сервиса, динамических официантов и отправку периода', () => {
  assert.match(frontendSource, /Сервис 1, ₽/);
  assert.match(frontendSource, /Сервис 2, ₽/);
  assert.match(frontendSource, /Сервис кальян, ₽/);
  assert.match(frontendSource, /Добавить официанта/);
  assert.match(frontendSource, /id="banqPeriodReportForm"/);
  assert.match(frontendSource, /action:'foxBanquetPeriodReport'/);
  assert.match(stockSource, /action === 'foxBanquetClosure'/);
  assert.match(stockSource, /action === 'foxBanquetPeriodReport'/);
  assert.match(stockSource, /requireFoxPermission_\(auth, 'banquets\.manage'\)/);
});

test('OCR графика показывает собственный статус и ждёт Gemini дольше обычного JSONP', () => {
  assert.match(frontendSource, /id="foxScheduleStatus"/);
  assert.match(frontendSource, /function setFoxScheduleStatus_/);
  assert.match(frontendSource, /action:'foxScheduleRecognize'[^\n]*90000/);
  assert.match(frontendSource, /Gemini распознаёт график/);
});

test('OCR графика всегда сохраняет выбранный админом месяц, включая короткий недельный график', () => {
  assert.match(frontendSource, /action:'foxScheduleRecognize',imageUrl:uploaded\.url,month:month/);
  assert.match(stockSource, /recognizeFoxScheduleImage_\(e\.parameter\.imageUrl, e\.parameter\.month\)/);
  assert.match(stockSource, /requestedMonth = normalizeFoxScheduleMonth_\(requestedMonth\)/);
  assert.match(stockSource, /const month = requestedMonth;/);
  assert.doesNotMatch(stockSource, /const month = \^\\d\{4\}/);
  assert.match(frontendSource, /foxScheduleMonth'\)\.value=month/);
});

test('подтверждение графика показывает acknowledged saving/error state', () => {
  assert.match(frontendSource, /foxScheduleSave'\)\.onclick=\(\)=>saveFoxSchedule_\(\)\.catch/);
  assert.match(frontendSource, /setFoxScheduleStatus_\('','Сохраняю график…'\)/);
  assert.match(frontendSource, /action:'foxScheduleSaveChunk'[\s\S]*?\),30000\)/);
  assert.match(frontendSource, /action:'foxScheduleSaveCommit'[\s\S]*?\),30000\)/);
  assert.match(frontendSource, /foxScheduleSaveInFlight/);
  assert.match(frontendSource, /res\.schedule&&res\.schedule\.savedRows/);
  assert.match(frontendSource, /savedRows/);
});

test('подтверждение графика не дублирует Cloudinary URL в JSONP payload каждой смены', () => {
  const helperStart = frontendSource.indexOf('function foxScheduleSaveRows_');
  const helperEnd = frontendSource.indexOf('async function recognizeFoxSchedule_', helperStart);
  const helperSource = frontendSource.slice(helperStart, helperEnd);
  assert.match(helperSource, /date:String\(row\.date\|\|''\)/);
  assert.match(helperSource, /shiftType:String\(row\.shiftType\|\|''\)/);
  assert.doesNotMatch(helperSource, /imageUrl/);
  assert.match(frontendSource, /const rows=foxScheduleSaveRows_\(\);\s*const chunks=foxScheduleSaveChunks_\(rows\)/);
  assert.match(frontendSource, /rowsJson:JSON\.stringify\(chunks\[index\]\)/);
  assert.match(frontendSource, /function foxScheduleSaveChunks_/);
  assert.match(frontendSource, /maxEncodedBytes=1400/);
  assert.match(frontendSource, /foxScheduleSave'\)\.onclick=\(\)=>saveFoxSchedule_\(\)\.catch\(\(\)=>\{\}\)/);
  assert.match(stockSource, /function stageFoxScheduleSaveChunk_/);
  assert.match(stockSource, /function commitFoxScheduleSave_/);
  assert.match(stockSource, /PropertiesService\.getScriptProperties\(\)/);
  assert.match(stockSource, /FOX_SCHEDULE_SAVE_CHUNK_TTL_MS/);
});

test('части графика подтверждённо собираются на сервере до единственного сохранения', () => {
  const { context } = makeRuntime();
  const auth = { userId:'1036250074' };
  const saveId = 'fox_schedule_12345678';
  context.stageFoxScheduleSaveChunk_({ saveId, chunkIndex:'0', chunkCount:'2', rowsJson:'[{"name":"Иван","date":"2026-08-01","rawValue":"10"}]' }, auth);
  context.stageFoxScheduleSaveChunk_({ saveId, chunkIndex:'1', chunkCount:'2', rowsJson:'[{"name":"Анна","date":"2026-08-02","rawValue":"11"}]' }, auth);
  context.saveFoxSchedule_ = p => ({ savedRows:JSON.parse(p.rowsJson).length, rows:JSON.parse(p.rowsJson) });
  const result = context.commitFoxScheduleSave_({ saveId, month:'2026-08', imageUrl:'https://example.test/schedule.jpg' }, auth);
  assert.equal(result.savedRows, 2);
  assert.deepEqual(result.rows.map(row => row.name), ['Иван','Анна']);
});

test('загрузка банкетов делает две короткие защищённые попытки и сохраняет последнюю общую копию', () => {
  assert.match(frontendSource, /async function loadSharedBanquetList_\(\)/);
  assert.match(frontendSource, /for\(let attempt=1;attempt<=2;attempt\+\+\)/);
  assert.match(frontendSource, /action:'foxCalendarBanquets'/);
  assert.match(frontendSource, /receiptAuthParams\(\)/);
  assert.match(frontendSource, /jsonp\(STOCK_API_URL/);
  assert.doesNotMatch(frontendSource, /BANQ_API_URL/);
  assert.match(frontendSource, /attempt<2/);
  assert.match(frontendSource, /Повторно подключаю общую базу/);
  assert.match(frontendSource, /let banquetsLoadPromise_=null/);
  assert.match(frontendSource, /if\(banquetsLoadPromise_\)return banquetsLoadPromise_/);
  const loadStart = frontendSource.indexOf('async function loadBanquets()');
  const loadEnd = frontendSource.indexOf('async function loadBanquetReserveSummaries_', loadStart);
  const loadSource = frontendSource.slice(loadStart, loadEnd);
  assert.match(loadSource, /loadBanquetsImpl_\(\)/);
  assert.match(loadSource, /refreshButton\.disabled=true/);
  assert.match(loadSource, /const res=await loadSharedBanquetList_\(\)/);
  assert.match(loadSource, /banqSharedMode=true;\s*saveLocalFallback\(\)/);
  assert.match(loadSource, /последняя сохранённая копия на этом устройстве/);
});

test('календарь читает DTO только через авторизованный backend FO’X', () => {
  assert.match(stockSource, /action === 'foxCalendarBanquets'/);
  assert.match(stockSource, /function listFoxCalendarBanquets_\(\)/);
  assert.match(stockSource, /source: 'stock-secure'/);
  assert.match(stockSource, /requireFoxPermission_\(auth, 'banquets\.view'\)/);
  const listStart = frontendSource.indexOf('async function loadSharedBanquetList_()');
  const listEnd = frontendSource.indexOf('async function loadBanquets()', listStart);
  const listSource = frontendSource.slice(listStart, listEnd);
  assert.match(listSource, /action:'foxCalendarBanquets'/);
  assert.match(listSource, /receiptAuthParams\(\)/);
  assert.match(listSource, /jsonp\(STOCK_API_URL/);
  assert.match(frontendSource, /Общая база и банкетный резерв подключены/);
});

test('подтверждение графика не перечитывает весь месяц после записи, а review сгруппирован по сотрудникам', () => {
  const saveStart = stockSource.indexOf('function saveFoxSchedule_');
  const saveEnd = stockSource.indexOf('function recognizeFoxScheduleImage_', saveStart);
  const saveSource = stockSource.slice(saveStart, saveEnd);
  assert.doesNotMatch(saveSource, /getFoxScheduleForMonth_\(month\)/);
  assert.match(saveSource, /activeFoxScheduleIdForMonth_\(item\.month\) !== item\.id/);
  assert.match(saveSource, /savedRows:rows\.length/);
  assert.match(saveSource, /const employees = tatooineUserRows_/);
  assert.match(frontendSource, /function foxScheduleReviewGroups_/);
  assert.match(frontendSource, /<details class="fox-schedule-review-item">/);
  assert.match(frontendSource, /formatFoxScheduleReviewDay_/);
});

test('review графика позволяет исправить OCR-строку или добавить пропущенную смену до подтверждения', () => {
  assert.match(frontendSource, /data-fox-schedule-field="rawValue"/);
  assert.match(frontendSource, /data-fox-schedule-group/);
  assert.match(frontendSource, /foxScheduleManualAdd/);
  assert.match(frontendSource, /foxSchedulePreview\.push\(\{name:name,date:date,rawValue:rawValue/);
  assert.match(frontendSource, /foxSchedulePreview\.splice\(index,1\)/);
});

test('сохранение графика инвалидирует кэш календаря и перечитывает только что сохранённую смену', () => {
  const saveStart = frontendSource.indexOf('async function saveFoxSchedule_()');
  const saveEnd = frontendSource.indexOf('const foxScheduleRecognizeButton', saveStart);
  const saveSource = frontendSource.slice(saveStart, saveEnd);
  assert.match(saveSource, /invalidateBanqScheduleCache_\(\)/);
  assert.match(saveSource, /renderFoxScheduleReview_\(\)/);
  assert.doesNotMatch(saveSource, /renderFoxScheduleReview\(\)/);
  assert.match(saveSource, /renderBanquets\(\)/);
  assert.match(frontendSource, /banqRefreshBtn\.onclick=\(\)=>\{ hap\('light'\); invalidateBanqScheduleCache_\(\); loadBanquets\(\); \}/);
});

test('календарь показывает персонал и банкеты в отдельных spoiler-блоках без дубля персонала в каждой карточке', () => {
  const dayStart = frontendSource.indexOf('function renderBanqDay()');
  const dayEnd = frontendSource.indexOf('function renderBanqPhotoHtml', dayStart);
  const daySource = frontendSource.slice(dayStart, dayEnd);
  assert.match(daySource, /renderBanqScheduleWorkers_\(daySchedule\)/);
  assert.match(daySource, /banquetsSpoiler\.className='banq-spoiler'/);
  assert.doesNotMatch(daySource, /renderBanqScheduleWorkers_\(b\.date\)/);
  assert.match(frontendSource, /\.banq-spoiler\{/);
});

test('календарь загружает персонал выбранного дня, не выводит список моих смен и отдельно выделяет сегодня', () => {
  const dayStart = frontendSource.indexOf('function renderBanqDay()');
  const dayEnd = frontendSource.indexOf('function renderBanqPhotoHtml', dayStart);
  const daySource = frontendSource.slice(dayStart, dayEnd);
  assert.match(daySource, /loadBanqScheduleWorkers_\(selectedBanqDate\)/);
  assert.doesNotMatch(frontendSource, /id="myScheduleCard"/);
  assert.match(frontendSource, /\.cal-day\.today\.selected\{/);
  assert.match(frontendSource, /\.cal-day\.today span:first-child\{/);
});
