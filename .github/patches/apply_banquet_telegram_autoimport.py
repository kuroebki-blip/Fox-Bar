from pathlib import Path

CODE = Path('apps-script/stock/production/Code.gs')
TESTS = Path('tests/banquets/v16_banquets_upgrade.test.js')
CHANGELOG = Path('CHANGELOG.md')
DOCS = Path('docs/Banquets.md')
MODULE = Path('.github/patches/banquet_telegram_autoimport.gs')

code = CODE.read_text()
code = code.replace(
    "FO’X — документы, чеки, банкетный резерв и кассовый отчёт v9.10.0",
    "FO’X — документы, чеки, банкетный резерв и кассовый отчёт v9.11.0",
    1,
)
code = code.replace(
    "version: 'v9.10.0 SECURE CALENDAR & STAFF ACCESS'",
    "version: 'v9.11.0 BANQUET TELEGRAM AUTOIMPORT'",
    1,
)

old = """    const action = String((e && e.parameter && e.parameter.action) || '');
    if (!action) throw new Error('Не передан action.');

    auth = authorizeRequest_(e.parameter || {});"""
new = """    const action = String((e && e.parameter && e.parameter.action) || '');
    if (action === 'telegramBanquetWebhook') return handleFoxBanquetTelegramWebhook_(e);
    if (!action) throw new Error('Не передан action.');

    auth = authorizeRequest_(e.parameter || {});"""
if old not in code:
    raise SystemExit('doPost anchor not found')
code = code.replace(old, new, 1)

marker = "\nfunction scanReceipt_(p, auth) {"
if marker not in code:
    raise SystemExit('scanReceipt marker not found')
module = MODULE.read_text().strip()
code = code.replace(marker, "\n\n" + module + "\n" + marker, 1)
CODE.write_text(code)

tests = TESTS.read_text()
extra = r'''

test('Telegram autoimport принимает только публичную ссылку Estimates Guru', () => {
  const { context } = makeRuntime();
  assert.equal(context.telegramBanquetSnapshotUrlFromMessage_({ text:'Банкет https://app.estimates.guru/snapshot/Hh9n7rv0F17f11YD' }), 'https://app.estimates.guru/snapshot/Hh9n7rv0F17f11YD');
  assert.equal(context.telegramBanquetSnapshotUrlFromMessage_({ text:'Открыть', entities:[{ type:'text_link', offset:0, length:7, url:'https://app.estimates.guru/snapshot/ABCdef_123' }] }), 'https://app.estimates.guru/snapshot/ABCdef_123');
  assert.equal(context.telegramBanquetSnapshotUrlFromMessage_({ text:'https://example.com/snapshot/Hh9n7rv0F17f11YD' }), '');
});

test('дата Estimates Guru без года получает год публикации', () => {
  const { context } = makeRuntime();
  assert.equal(context.normalizeEstimateGuruBanquetDate_('06.09', Date.UTC(2026,8,6,9)/1000), '2026-09-06');
  assert.equal(context.normalizeEstimateGuruBanquetDate_('10.01', Date.UTC(2026,11,20,9)/1000), '2027-01-10');
});

test('комментарий автоимпорта хранит полный предзаказ без контактных полей', () => {
  const { context } = makeRuntime();
  const comment = context.buildEstimateGuruBanquetComment_({
    eventType:'др', guestCount:11, totalAmount:17201.70,
    orderItems:[
      { category:'Безалкогольные напитки', name:'Вода Dausuz 850 мл', quantity:3, unit:'шт.', servingTime:'14:00' },
      { category:'Горячие закуски', name:'Хоровац', quantity:2, unit:'порция', servingTime:'14:15' }
    ]
  }, { text:'✅ дата 06.09 14:00 бронь стола\nhttps://app.estimates.guru/snapshot/Hh9n7rv0F17f11YD' }, 'https://app.estimates.guru/snapshot/Hh9n7rv0F17f11YD');
  assert.match(comment, /Гостей: 11/);
  assert.match(comment, /Вода Dausuz 850 мл/);
  assert.match(comment, /Хоровац/);
  assert.doesNotMatch(comment, /Телефон|phone|contact/i);
});

test('импортный save обновляет snapshot по стабильному ID без новой колонки Media JSON', () => {
  const { context, banquetSheet } = makeRuntime();
  const auth = { userId:'100', userName:'Ella' };
  context.saveImportedFoxCalendarBanquet_({ id:'estimate_ABC12345', date:'2026-09-06', time:'14:00', name:'Елена · 11 персон', comment:'Первый', totalAmount:17201.70 }, auth);
  context.saveImportedFoxCalendarBanquet_({ id:'estimate_ABC12345', date:'2026-09-06', time:'14:30', name:'Елена · 11 персон', comment:'Обновлён', totalAmount:18000 }, auth);
  assert.equal(banquetSheet.getLastRow(), 2);
  assert.equal(banquetSheet.getLastColumn(), 12);
  assert.equal(banquetSheet.rows[1][2], '14:30');
  assert.equal(banquetSheet.rows[1][4], 'Обновлён');
});
'''
if "Telegram autoimport принимает только публичную ссылку Estimates Guru" not in tests:
    tests += extra
TESTS.write_text(tests)

changelog = CHANGELOG.read_text()
entry = (
    "- Scanner-cash backend `v9.11.0`: добавлен автоматический импорт банкетов из Telegram-группы "
    "по публичной ссылке `app.estimates.guru/snapshot/...`. Backend загружает PDF/снимок Estimates Guru, "
    "извлекает дату, время, гостя, количество персон, полный предзаказ и итог, создаёт/обновляет банкет "
    "по стабильному snapshot ID и пересчитывает складской банкетный резерв. Контактные данные из PDF "
    "игнорируются и не сохраняются. Повторная доставка webhook не создаёт дубль; структура Google Sheets "
    "и setup-функции не меняются.\n\n"
)
if entry not in changelog:
    changelog = changelog.replace('## Unreleased\n\n', '## Unreleased\n\n' + entry, 1)
CHANGELOG.write_text(changelog)

docs = DOCS.read_text()
section = '''## Автоимпорт из Telegram / Estimates Guru

Backend `v9.11.0` умеет принимать сообщения из одной настроенной Telegram-группы. Триггером служит публичная ссылка `https://app.estimates.guru/snapshot/...`. Backend получает PDF/снимок, извлекает дату, время, имя гостя, количество персон, итог и полный предзаказ, затем создаёт или обновляет банкет с ID `estimate_<snapshot-id>`. Контактные данные из документа намеренно игнорируются и не сохраняются.

Полный предзаказ хранится в комментарии банкета. В складской резерв отдельно попадают только готовые товарные позиции; блюда кухни, услуги и коктейли исключаются. Новые колонки Google Sheets автоматически не создаются.

Перед включением: добавить FO’X-бота в нужную группу и дать ему возможность видеть обычные сообщения; задать `TELEGRAM_BANQUET_SOURCE_CHAT_ID` (либо до включения webhook выполнить `foxBanquetsCaptureTelegramSourceChat()`); выполнить deployment Apps Script; затем выполнить `foxBanquetsConfigureTelegramWebhook()`. Если у бота уже настроен другой webhook, функция остановится и ничего не перезапишет. Откат webhook — `foxBanquetsDisableTelegramWebhook()`.

'''
if '## Автоимпорт из Telegram / Estimates Guru' not in docs:
    docs = docs.replace('## Candidate v16.0.0: несколько фотографий\n', section + '## Candidate v16.0.0: несколько фотографий\n', 1)
DOCS.write_text(docs)
