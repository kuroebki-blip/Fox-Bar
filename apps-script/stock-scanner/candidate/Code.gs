/**
 * FO’X — документы, чеки, банкетный резерв и кассовый отчёт v9.4.7
 *
 * Назначение:
 * 1. Принимает облегчённые JPEG-страницы для быстрого распознавания.
 * 2. Оригинальный PDF загружается параллельно и хранится отдельно для Telegram.
 * 3. Распознаёт изображения напрямую через Gemini API без PDF в OCR-пути.
 * 4. Возвращает результат в Mini App через JSONP polling.
 * 5. После ручного подтверждения увеличивает только D или E и обновляет F.
 * 6. Сохраняет историю и может отправить PDF + подпись в Telegram-чат.
 *
 * ВАЖНО:
 * - скрипт не меняет формулы B и G;
 * - setupFoxReceipts() создаёт только служебные листы и папку Drive;
 * - API-ключи и токены хранятся только в Script Properties.
 */

const FOX_RECEIPTS = {
  version: 'v9.4.7 TATOOINE ORIGINAL LAYOUT',

  stockSheets: [
    'Вино',
    'Крепкий алкоголь',
    'Пюре и сиропы',
    'Чай',
    'Пиво',
    'Прочее'
  ],

  headerRow: 2,
  firstDataRow: 3,

  cols: {
    name: 1,       // A
    alley: 4,      // D Остаток Аллея / Бар
    reserve: 5,    // E Остаток Заготовочный
    price: 6,      // F Последняя закупочная цена с НДС
    unit: 8,       // H
    banquet: 10    // J Банкетный резерв к заказу
  },

  sheets: {
    receipts: 'Поступления',
    mappings: 'Сопоставление товаров',
    documents: 'Документы',
    jobs: 'Скан_Задания',
    checks: 'Чеки',
    banquetReserve: 'Банкеты_Резерв',
    banquetJobs: 'Банкет_Задания'
  },

  // Сканер документов и чеков доступен всем пользователям Mini App,
  // прошедшим проверенную Telegram-авторизацию.
  allowAllTelegramUsers: true,

  adminTelegramIds: [
    '1036250074',
    '315978242',
    '317564157'
  ],

  messageDocumentType: 'Счёт на оплату',
  defaultGeminiModel: 'gemini-3.1-flash-lite',
  maxPdfBytes: 15 * 1024 * 1024,
  maxAuthAgeSeconds: 24 * 60 * 60
};

const FOX_RECEIPT_HEADERS = {
  receipts: [
    'ID поступления','Подтверждено','Дата документа','Дата поступления',
    'Поставщик коротко','Поставщик полный','Реальный тип','Тип для Telegram',
    'Склад','Лист стока','Строка','Наименование из документа','Позиция FO’X',
    'Количество','Ед. изм.','Старая цена','Новая цена','Остаток до','Остаток после',
    'Сумма','PDF File ID','PDF URL','Telegram User ID','Telegram User',
    'Отправлено в Telegram','Создано','Ошибка / комментарий','Источник'
  ],
  mappings: [
    'Поставщик','Наименование из документа','Нормализованное название',
    'Лист стока','Позиция FO’X','Ед. документа','Коэффициент в сток',
    'Исключить','Комментарий','Подтверждено'
  ],
  documents: [
    'Job ID','Статус','Дата сообщения','Поставщик коротко','Поставщик полный',
    'Реальные типы','Номер документа','Склад','Сумма','Кол-во страниц',
    'PDF File ID','PDF URL','Сообщение','Telegram User ID','Telegram User',
    'Создано','Подтверждено','Отправлено в Telegram','Ошибка','JSON распознавания',
    'Режим','Карта / оплата','Канал покупки','Краткое описание','Магазин'
  ],
  checks: [
    'Job ID','Статус','Дата','Карта / оплата','Канал покупки','Краткое описание','Магазин',
    'Сумма','Склад','Кол-во страниц','PDF File ID','PDF URL','Сообщение',
    'Telegram User ID','Telegram User','Создано','Внесено в сток','Отправлено в Telegram',
    'Ошибка','JSON распознавания'
  ],
  jobs: [
    'Job ID','Статус','Шаг','Прогресс','Результат JSON','PDF File ID','PDF URL',
    'Telegram User ID','Telegram User','Склад','Страниц','Создано','Обновлено','Ошибка','Режим'
  ],
  banquetReserve: [
    'ID банкета','Дата банкета','Название банкета','Статус банкета','Статус закупки',
    'Наименование с фото','Лист стока','Строка стока','Позиция FO’X','Нужно',
    'Уже заказано','К заказу','Ед. изм.','Image URL','Создано','Обновлено',
    'Архив','Совпадение','Комментарий','Дата отправки заказа'
  ],
  banquetJobs: [
    'Job ID','ID банкета','Статус','Шаг','Прогресс','Результат JSON',
    'Telegram User ID','Telegram User','Создано','Обновлено','Ошибка'
  ]
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("FO’X Документы и чеки")
    .addItem('1. Подготовить документы и чеки', 'setupFoxReceipts')
    .addItem('2. Проверить настройки', 'foxReceiptsShowConfig')
    .addItem('3. Открыть папку PDF', 'foxReceiptsShowFolder')
    .addItem('4. Проверить Gemini API', 'foxReceiptsTestGemini')
    .addSeparator()
    .addItem('Касса: получить стиль из Telegram', 'foxCashCaptureTelegramStyle')
    .addItem('Касса: проверить стиль сообщением', 'foxCashTestTelegramStyle')
    .addSeparator()
    .addItem('Обновить список товаров', 'foxReceiptsRefreshCatalog')
    .addSeparator()
    .addItem('Настроить банкетный резерв', 'setupFoxBanquetReserve')
    .addItem('Проверить банкетный резерв', 'foxBanquetReserveCheck')
    .addItem('Исправить формулы банкетов', 'repairFoxBanquetReserveFormulas')
    .addToUi();
}

/**
 * Безопасная первичная настройка.
 * Создаёт только новые служебные листы и папку Drive.
 * Основные листы стока и формулы не изменяет.
 */
function setupFoxReceipts() {
  const ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error('Открой скрипт именно из Google Таблицы стока.');

  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('GEMINI_MODEL')) {
    props.setProperty('GEMINI_MODEL', FOX_RECEIPTS.defaultGeminiModel);
  }

  ensureServiceSheet_(ss, FOX_RECEIPTS.sheets.receipts, 'FO’X — ИСТОРИЯ ПОСТУПЛЕНИЙ', FOX_RECEIPT_HEADERS.receipts);
  ensureServiceSheet_(ss, FOX_RECEIPTS.sheets.mappings, 'FO’X — СОПОСТАВЛЕНИЕ ТОВАРОВ', FOX_RECEIPT_HEADERS.mappings);
  ensureServiceSheet_(ss, FOX_RECEIPTS.sheets.documents, 'FO’X — ДОКУМЕНТЫ И ЧЕКИ', FOX_RECEIPT_HEADERS.documents);
  ensureServiceSheet_(ss, FOX_RECEIPTS.sheets.checks, 'FO’X — ИСТОРИЯ ЧЕКОВ', FOX_RECEIPT_HEADERS.checks);
  const jobs = ensureServiceSheet_(ss, FOX_RECEIPTS.sheets.jobs, 'FO’X — СЛУЖЕБНЫЕ ЗАДАНИЯ СКАНЕРА', FOX_RECEIPT_HEADERS.jobs);
  try { jobs.hideSheet(); } catch (e) {}

  seedMappingsIfEmpty_(ss.getSheetByName(FOX_RECEIPTS.sheets.mappings));

  if (!props.getProperty('RECEIPTS_DRIVE_FOLDER_ID')) {
    const folder = DriveApp.createFolder('FO_X_Документы_и_чеки_PDF');
    props.setProperty('RECEIPTS_DRIVE_FOLDER_ID', folder.getId());
  }

  SpreadsheetApp.getUi().alert(
    'Готово.\n\n' +
    'Созданы/проверены только служебные листы документов, чеков и закрытая папка PDF.\n' +
    'Основные листы стока, значения, формулы B/G и стили не изменялись.\n\n' +
    'Теперь добавь GEMINI_API_KEY и TELEGRAM_BOT_TOKEN в Script Properties.'
  );
}

function foxReceiptsShowConfig() {
  const p = PropertiesService.getScriptProperties().getProperties();
  const lines = [
    'FO’X Поступления ' + FOX_RECEIPTS.version,
    '',
    'SPREADSHEET_ID: ' + yesNo_(p.SPREADSHEET_ID),
    'RECEIPTS_DRIVE_FOLDER_ID: ' + yesNo_(p.RECEIPTS_DRIVE_FOLDER_ID),
    'GEMINI_API_KEY: ' + yesNo_(p.GEMINI_API_KEY),
    'GEMINI_MODEL: ' + (p.GEMINI_MODEL || FOX_RECEIPTS.defaultGeminiModel),
    'TELEGRAM_BOT_TOKEN: ' + yesNo_(p.TELEGRAM_BOT_TOKEN),
    'TELEGRAM_TARGET_CHAT_ID: ' + (p.TELEGRAM_TARGET_CHAT_ID || 'не задан — текущий Telegram-чат или личный чат пользователя'),
    'TATOOINE_TELEGRAM_BOT_TOKEN: ' + yesNo_(p.TATOOINE_TELEGRAM_BOT_TOKEN),
    'TATOOINE_TELEGRAM_TARGET_CHAT_ID: ' + (p.TATOOINE_TELEGRAM_TARGET_CHAT_ID || 'не задан — текущий Telegram-чат или личный чат пользователя'),
    'TATOOINE_TELEGRAM_ALLOWED_USER_IDS: ' + (p.TATOOINE_TELEGRAM_ALLOWED_USER_IDS || 'не заданы — используются Telegram admin IDs FO’X'),
    'ДОСТУП К СКАНЕРУ: ' + (FOX_RECEIPTS.allowAllTelegramUsers ? 'все проверенные Telegram-пользователи' : 'только администраторы'),
    'ALLOW_UNVERIFIED_TEST_MODE: ' + (p.ALLOW_UNVERIFIED_TEST_MODE || 'false')
  ];
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}

function foxReceiptsShowFolder() {
  const id = PropertiesService.getScriptProperties().getProperty('RECEIPTS_DRIVE_FOLDER_ID');
  if (!id) {
    SpreadsheetApp.getUi().alert('Сначала запусти setupFoxReceipts().');
    return;
  }
  SpreadsheetApp.getUi().alert('Папка PDF:\nhttps://drive.google.com/drive/folders/' + id);
}

function foxReceiptsRefreshCatalog() {
  const catalog = readStockCatalog_();
  SpreadsheetApp.getUi().alert('Каталог прочитан: ' + catalog.length + ' товарных позиций.');
}


/**
 * Быстрый тест ключа и модели без PDF и без изменения таблицы.
 */
function foxReceiptsTestGemini() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('В Script Properties не задан GEMINI_API_KEY.');
  const model = normalizeGeminiModel_(props.getProperty('GEMINI_MODEL') || FOX_RECEIPTS.defaultGeminiModel);
  const body = {
    contents: [{ role: 'user', parts: [{ text: 'Ответь только JSON: {"ok":true,"service":"FOX"}' }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 }
  };
  const result = callGeminiGenerateContent_(apiKey, model, body);
  SpreadsheetApp.getUi().alert(
    'Gemini API работает.\n\nМодель: ' + model + '\nОтвет: ' + String(result.text || '').slice(0, 500)
  );
}


/**
 * Одноразово читает последние сообщения, отправленные FO’X-боту,
 * и сохраняет custom_emoji_id из эталонного кассового отчёта.
 * Google Sheets, сток, формулы и изображения не затрагиваются.
 */
function foxCashCaptureTelegramStyle() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('В Script Properties не задан TELEGRAM_BOT_TOKEN.');

  const webhook = telegramApiCall_(token, 'getWebhookInfo', {});
  if (webhook && webhook.result && webhook.result.url) {
    throw new Error('У бота включён webhook. getUpdates недоступен, пока webhook активен.');
  }

  const updates = telegramApiCall_(token, 'getUpdates', {
    offset: -100,
    limit: 100,
    timeout: 0,
    allowed_updates: JSON.stringify(['message'])
  });
  const rows = (updates && updates.result || []).map(function(u) {
    const m = u.message || u.edited_message || null;
    if (!m) return null;
    return {
      updateId: u.update_id,
      chatId: m.chat && m.chat.id,
      text: String(m.text || m.caption || ''),
      entities: m.entities || m.caption_entities || []
    };
  }).filter(Boolean);

  if (!rows.length) throw new Error('Новых сообщений боту не найдено. Отправь эталонный отчёт боту и запусти функцию ещё раз.');

  let full = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (/ОТЧ[ЕЁ]Т\s+КАССОВОЙ\s+СМЕНЫ/i.test(rows[i].text) && hasCustomEmoji_(rows[i])) {
      full = rows[i];
      break;
    }
  }

  let logoIds = [];
  let bulletId = '';
  let alleyLeftId = '';
  let alleyRightId = '';
  let reportId = '';
  let chatId = full && full.chatId ? String(full.chatId) : '';

  if (full) {
    const custom = full.entities.filter(function(e) { return e.type === 'custom_emoji' && e.custom_emoji_id; });
    const firstNl = full.text.indexOf('\n') < 0 ? full.text.length : full.text.indexOf('\n');
    logoIds = custom.filter(function(e) { return e.offset < firstNl; }).sort(byEntityOffset_).slice(0, 3).map(function(e) { return String(e.custom_emoji_id); });

    const alley = custom.filter(function(e) { return /АЛЛЕЯ/i.test(entityLineText_(full.text, e)); }).sort(byEntityOffset_);
    if (alley[0]) alleyLeftId = String(alley[0].custom_emoji_id);
    if (alley[1]) alleyRightId = String(alley[alley.length - 1].custom_emoji_id);

    const report = custom.filter(function(e) { return /ОТЧ[ЕЁ]Т\s+КАССОВОЙ\s+СМЕНЫ/i.test(entityLineText_(full.text, e)); }).sort(byEntityOffset_);
    if (report[0]) reportId = String(report[0].custom_emoji_id);

    const counts = {};
    custom.forEach(function(e) {
      const line = entityLineText_(full.text, e);
      if (/Безнал|Нал|Tapper|Расч[её]тный|Онлайн-Касса|Предоплата/i.test(line)) {
        const id = String(e.custom_emoji_id);
        counts[id] = (counts[id] || 0) + 1;
      }
    });
    bulletId = mostFrequentKey_(counts);
  }

  // Запасной вариант: пользователь мог прислать логотип и зелёный маркер отдельными сообщениями.
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const custom = row.entities.filter(function(e) { return e.type === 'custom_emoji' && e.custom_emoji_id; }).sort(byEntityOffset_);
    if (!chatId && row.chatId) chatId = String(row.chatId);
    if (logoIds.length < 3 && custom.length >= 3 && row.text.length <= 20) {
      logoIds = custom.slice(0, 3).map(function(e) { return String(e.custom_emoji_id); });
    }
    if (!bulletId && custom.length === 1 && row.text.trim().length <= 4) {
      bulletId = String(custom[0].custom_emoji_id);
    }
  }

  if (logoIds[0]) props.setProperty('CASH_EMOJI_LOGO_F', logoIds[0]);
  if (logoIds[1]) props.setProperty('CASH_EMOJI_LOGO_O', logoIds[1]);
  if (logoIds[2]) props.setProperty('CASH_EMOJI_LOGO_X', logoIds[2]);
  if (bulletId) props.setProperty('CASH_EMOJI_BULLET', bulletId);
  if (alleyLeftId) props.setProperty('CASH_EMOJI_ALLEY_LEFT', alleyLeftId);
  if (alleyRightId) props.setProperty('CASH_EMOJI_ALLEY_RIGHT', alleyRightId);
  if (reportId) props.setProperty('CASH_EMOJI_REPORT', reportId);
  if (chatId) props.setProperty('CASH_STYLE_CHAT_ID', chatId);
  props.setProperty('CASH_STYLE_CAPTURED_AT', new Date().toISOString());

  const found = [
    'Логотип FO’X: ' + (logoIds.length >= 3 ? 'найден' : 'не найден полностью'),
    'Зелёный маркер: ' + (bulletId ? 'найден' : 'не найден'),
    'Эмодзи АЛЛЕЯ слева: ' + (alleyLeftId ? 'найден' : 'обычный'),
    'Эмодзи АЛЛЕЯ справа: ' + (alleyRightId ? 'найден' : 'обычный'),
    'Эмодзи отчёта: ' + (reportId ? 'найден' : 'обычный'),
    'Чат для теста: ' + (chatId || 'не найден')
  ];
  const message = 'Стиль кассового отчёта сохранён.\n\n' + found.join('\n');
  Logger.log(message);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) ss.toast(message, 'FO’X — стиль кассового отчёта', 10);
  return {
    ok: true,
    logoFound: logoIds.length >= 3,
    bulletFound: Boolean(bulletId),
    alleyLeftFound: Boolean(alleyLeftId),
    alleyRightFound: Boolean(alleyRightId),
    reportEmojiFound: Boolean(reportId),
    chatId: chatId || ''
  };
}

/**
 * Сохраняет custom emoji из пересланного эталонного отчёта Tatooine.
 * Токен читается только из Script Properties; таблицы и изображения не изменяются.
 */
function tatooineCashCaptureTelegramStyle() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TATOOINE_TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('В Script Properties не задан TATOOINE_TELEGRAM_BOT_TOKEN.');

  const webhook = telegramApiCall_(token, 'getWebhookInfo', {});
  if (webhook && webhook.result && webhook.result.url) {
    throw new Error('У бота Tatooine включён webhook. getUpdates недоступен, пока webhook активен.');
  }
  const updates = telegramApiCall_(token, 'getUpdates', {
    offset: -100,
    limit: 100,
    timeout: 0,
    allowed_updates: JSON.stringify(['message'])
  });
  const rows = (updates && updates.result || []).map(function(u) {
    const m = u.message || u.edited_message || null;
    if (!m) return null;
    return {
      chatId: m.chat && m.chat.id,
      text: String(m.text || m.caption || ''),
      entities: m.entities || m.caption_entities || []
    };
  }).filter(Boolean);
  let full = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (/ОТЧ[ЕЁ]Т\s+КАССОВОЙ\s+СМЕНЫ/i.test(rows[i].text) && hasCustomEmoji_(rows[i])) {
      full = rows[i];
      break;
    }
  }
  if (!full) throw new Error('Эталон Tatooine с custom emoji не найден. Перешли исходное сообщение новому боту и повтори запуск.');

  const custom = full.entities.filter(function(e) { return e.type === 'custom_emoji' && e.custom_emoji_id; }).sort(byEntityOffset_);
  const firstNl = full.text.indexOf('\n') < 0 ? full.text.length : full.text.indexOf('\n');
  const logoIds = custom.filter(function(e) { return e.offset < firstNl; }).map(function(e) { return String(e.custom_emoji_id); });
  const idsForLine_ = function(pattern) {
    return custom.filter(function(e) { return pattern.test(entityLineText_(full.text, e)); }).map(function(e) { return String(e.custom_emoji_id); });
  };
  const saveFirst_ = function(propertyName, pattern) {
    const ids = idsForLine_(pattern);
    if (ids[0]) props.setProperty(propertyName, ids[0]);
    return Boolean(ids[0]);
  };
  if (logoIds.length) props.setProperty('TATOOINE_CASH_EMOJI_LOGO_IDS', logoIds.join(','));
  const locationIds = idsForLine_(/ПЕТРОВКА/i);
  if (locationIds[0]) props.setProperty('TATOOINE_CASH_EMOJI_LOCATION_LEFT', locationIds[0]);
  if (locationIds[1]) props.setProperty('TATOOINE_CASH_EMOJI_LOCATION_RIGHT', locationIds[locationIds.length - 1]);
  const found = {
    report: saveFirst_('TATOOINE_CASH_EMOJI_REPORT', /ОТЧ[ЕЁ]Т\s+КАССОВОЙ\s+СМЕНЫ/i),
    revenue: saveFirst_('TATOOINE_CASH_EMOJI_REVENUE', /Общая выручка/i),
    cashless: saveFirst_('TATOOINE_CASH_EMOJI_CASHLESS', /Безнал:/i),
    cash: saveFirst_('TATOOINE_CASH_EMOJI_CASH', /(?:^|\s)Нал:/i),
    online: saveFirst_('TATOOINE_CASH_EMOJI_ONLINE', /Онлайн касса 2/i),
    eatAndSplit: saveFirst_('TATOOINE_CASH_EMOJI_EATANDSPLIT', /EatAndSplit/i),
    yandex: saveFirst_('TATOOINE_CASH_EMOJI_YANDEX', /Яндекс еда/i),
    expense: saveFirst_('TATOOINE_CASH_EMOJI_EXPENSE', /Расход:/i),
    collection: saveFirst_('TATOOINE_CASH_EMOJI_COLLECTION', /Инкассация:/i),
    change: saveFirst_('TATOOINE_CASH_EMOJI_CHANGE', /Неизменный размен/i),
    prepayments: saveFirst_('TATOOINE_CASH_EMOJI_PREPAYMENTS', /Предоплаты:/i)
  };
  if (full.chatId) props.setProperty('TATOOINE_CASH_STYLE_CHAT_ID', String(full.chatId));
  props.setProperty('TATOOINE_CASH_STYLE_CAPTURED_AT', new Date().toISOString());

  const capturedCount = Object.keys(found).filter(function(key) { return found[key]; }).length;
  const message = 'Стиль Tatooine сохранён: логотип ' + logoIds.length + ' символов, строки ' + capturedCount + ' из 11.';
  Logger.log(message);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) ss.toast(message, 'Tatooine — стиль отчёта', 10);
  return { ok: true, logoSymbols: logoIds.length, capturedLines: capturedCount, locationFound: locationIds.length >= 2 };
}

function foxCashTestTelegramStyle() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('В Script Properties не задан TELEGRAM_BOT_TOKEN.');
  const chatId = String(props.getProperty('CASH_STYLE_CHAT_ID') || props.getProperty('TELEGRAM_TARGET_CHAT_ID') || '');
  if (!chatId) throw new Error('Чат для теста не найден. Сначала запусти foxCashCaptureTelegramStyle().');
  const sample = [
    "🔤🔤'🔤",
    '',
    '🦊 АЛЛЕЯ 🌳',
    '👨‍💻 ОТЧЕТ КАССОВОЙ СМЕНЫ',
    'ДАТА 15.07.2026',
    '',
    'Общая выручка: 593 158,80',
    '',
    '🟢Безнал: 491 220,80',
    '🟢Безнал 2:',
    '🟢Нал: 36 280,00',
    '🟢Нал Фискал: 35 658,00',
    '🟢Нал2:',
    '🟢Tapper:',
    '🟢Расчётный счёт:',
    '🟢Расчётный счёт 2:',
    '🟢Онлайн-Касса 2: 30 000,00',
    '',
    'Расход: 0',
    '',
    'Инкассация: 71 938 (71 940)',
    'На утро в кассе [0]',
    'Неизменный размен [70000]',
    '',
    '🟢 Предоплата: 15.07.26',
    '30.000 оплата по ссылке'
  ].join('\n');
  const result = sendCashStyledTelegram_(token, chatId, sample);
  const message = result.usedFallback
    ? 'Тест отправлен без custom emoji: Telegram не принял их.'
    : 'Тестовый отчёт отправлен в Telegram со стилем.';
  Logger.log(message);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) ss.toast(message, 'FO’X — тест оформления', 8);
  return {
    ok: true,
    usedFallback: Boolean(result.usedFallback)
  };
}

function telegramApiCall_(token, methodName, payload) {
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + methodName, {
    method: 'post',
    payload: payload || {},
    muteHttpExceptions: true
  });
  const body = parseJsonSafe_(response.getContentText());
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !body.ok) {
    throw new Error('Telegram API ' + methodName + ': ' + (body.description || ('HTTP ' + response.getResponseCode())));
  }
  return body;
}

function hasCustomEmoji_(row) {
  return (row.entities || []).some(function(e) { return e.type === 'custom_emoji' && e.custom_emoji_id; });
}
function byEntityOffset_(a, b) { return Number(a.offset || 0) - Number(b.offset || 0); }
function entityLineText_(text, entity) {
  const offset = Number(entity.offset || 0);
  let start = text.lastIndexOf('\n', Math.max(0, offset - 1));
  start = start < 0 ? 0 : start + 1;
  let end = text.indexOf('\n', offset);
  if (end < 0) end = text.length;
  return text.slice(start, end);
}
function mostFrequentKey_(counts) {
  let key = '', best = 0;
  Object.keys(counts || {}).forEach(function(k) {
    if (counts[k] > best) { key = k; best = counts[k]; }
  });
  return key;
}

function doGet(e) {
  const callback = safeCallback_(e && e.parameter && e.parameter.callback);
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'ping');

    if (action === 'ping') {
      return jsonpOutput_(callback, {
        ok: true,
        service: 'FOX_RECEIPTS',
        version: FOX_RECEIPTS.version,
        time: new Date().toISOString()
      });
    }

    const auth = authorizeRequest_(e && e.parameter ? e.parameter : {});
    assertTelegramActionAllowed_(action, auth);

    if (action === 'status') {
      const jobId = requiredString_(e.parameter.jobId, 'jobId');
      return jsonpOutput_(callback, getJobStatus_(jobId, auth));
    }

    if (action === 'catalog') {
      return jsonpOutput_(callback, {
        ok: true,
        items: readStockCatalog_().map(function(x) {
          return {
            sheet: x.sheet,
            name: x.name,
            row: x.row,
            unit: x.unit,
            price: x.price
          };
        })
      });
    }

    if (action === 'banquetReserveJob') {
      assertBanquetAdmin_(auth);
      const banquetJobId = requiredString_(e.parameter.jobId, 'jobId');
      return jsonpOutput_(callback, getBanquetJobStatus_(banquetJobId, auth.userId));
    }

    if (action === 'banquetSummaries') {
      assertBanquetAdmin_(auth);
      return jsonpOutput_(callback, { ok: true, items: getBanquetReserveSummaries_() });
    }

    // Небольшие команды банкетного резерва выполняются через JSONP,
    // чтобы frontend видел реальный ответ и не скрывал ошибки opaque/no-cors POST.
    if (action === 'banquetStatusUpdate') {
      assertBanquetAdmin_(auth);
      return jsonpOutput_(callback, { ok: true, summary: setBanquetReserveStatus_(e.parameter.banquetId, e.parameter.status) });
    }

    if (action === 'banquetOrder') {
      assertBanquetAdmin_(auth);
      return jsonpOutput_(callback, { ok: true, summary: setBanquetOrderSent_(e.parameter.banquetId, truthy_(e.parameter.sent)) });
    }

    return jsonpOutput_(callback, { ok: false, error: 'Неизвестное действие: ' + action });
  } catch (err) {
    return jsonpOutput_(callback, { ok: false, error: errorText_(err) });
  }
}

function doPost(e) {
  let auth = null;
  try {
    const action = String((e && e.parameter && e.parameter.action) || '');
    if (!action) throw new Error('Не передан action.');

    auth = authorizeRequest_(e.parameter || {});
    assertTelegramActionAllowed_(action, auth);

    if (action === 'scan') {
      scanReceipt_(e.parameter, auth);
      return textOutput_({ ok: true });
    }

    if (action === 'scanImages') {
      scanReceiptImages_(e.parameter, auth);
      return textOutput_({ ok: true });
    }

    if (action === 'attachPdf') {
      attachReceiptPdf_(e.parameter, auth);
      return textOutput_({ ok: true });
    }

    if (action === 'confirm') {
      confirmReceipt_(e.parameter, auth);
      return textOutput_({ ok: true });
    }

    if (action === 'sendTelegram') {
      sendReceiptToTelegram_(e.parameter, auth);
      return textOutput_({ ok: true });
    }

    if (action === 'cashReportScan') {
      scanCashReport_(e.parameter, auth);
      return textOutput_({ ok: true });
    }

    if (action === 'cashReportScanImages') {
      scanCashReportImages_(e.parameter, auth);
      return textOutput_({ ok: true });
    }

    if (action === 'cashReportSend') {
      sendCashReportToTelegram_(e.parameter, auth);
      return textOutput_({ ok: true });
    }

    if (action === 'banquetScan') {
      assertBanquetAdmin_(auth);
      scanBanquetReserve_(e.parameter, auth);
      return textOutput_({ ok: true });
    }

    if (action === 'banquetOrder') {
      assertBanquetAdmin_(auth);
      return textOutput_({ ok: true, summary: setBanquetOrderSent_(e.parameter.banquetId, truthy_(e.parameter.sent)) });
    }

    if (action === 'banquetStatusUpdate') {
      assertBanquetAdmin_(auth);
      return textOutput_({ ok: true, summary: setBanquetReserveStatus_(e.parameter.banquetId, e.parameter.status) });
    }

    if (action === 'banquetDelete') {
      assertBanquetAdmin_(auth);
      archiveBanquetReserve_(e.parameter.banquetId);
      return textOutput_({ ok: true });
    }

    throw new Error('Неизвестное действие: ' + action);
  } catch (err) {
    const jobId = e && e.parameter ? String(e.parameter.jobId || '') : '';
    const action = e && e.parameter ? String(e.parameter.action || '') : '';
    if (jobId && auth && jobMatchesTelegramRouteById_(jobId, auth)) {
      if (action === 'banquetScan') {
        try { failBanquetJob_(jobId, errorText_(err)); } catch (_) {}
      } else if (action === 'cashReportScan' || action === 'cashReportScanImages') {
        try { failCashReportJob_(jobId, errorText_(err)); } catch (_) {}
      } else if (action === 'cashReportSend') {
        try { updateJob_(jobId, { status: 'SEND_ERROR', step: 'Не удалось отправить кассовый отчёт', progress: 1, error: errorText_(err) }); } catch (_) {}
      } else {
        try { recordActionError_(jobId, action, errorText_(err)); } catch (_) {}
      }
    }
    return textOutput_({ ok: false, error: errorText_(err) });
  }
}

function scanReceipt_(p, auth) {
  const jobId = requiredString_(p.jobId, 'jobId');
  const scanMode = normalizeScanMode_(p.scanMode);
  const warehouse = normalizeWarehouse_(p.warehouse);
  const pagesCount = Math.max(1, Number(p.pagesCount) || 1);
  const pdfBase64 = cleanBase64_(requiredString_(p.pdfBase64, 'pdfBase64'));
  const pdfBytes = Utilities.base64Decode(pdfBase64);
  if (pdfBytes.length > FOX_RECEIPTS.maxPdfBytes) throw new Error('PDF слишком большой. Максимум 15 МБ.');
  if (!isPdfBytes_(pdfBytes)) throw new Error('Переданный файл повреждён и не содержит сигнатуру PDF. Повтори сканирование.');

  createOrResetJob_(jobId, auth, warehouse, pagesCount, scanMode);
  updateJob_(jobId, { status: 'PROCESSING', step: 'Сохраняю единый PDF', progress: 0.12 });
  const folder = getReceiptsFolder_();
  const file = folder.createFile(Utilities.newBlob(pdfBytes, 'application/pdf', safeFileName_('FO_X_scan_' + jobId + '.pdf')));
  updateJob_(jobId, { pdfFileId: file.getId(), pdfUrl: file.getUrl(), progress: 0.25, step: scanMode === 'check' ? 'Распознаю чек' : 'Распознаю документы' });
  SpreadsheetApp.flush();

  let parsed;
  try { parsed = recognizePdfWithGemini_(pdfBase64, pagesCount, scanMode); }
  catch (err) { try { file.setTrashed(true); } catch (_) {} throw err; }

  parsed = sanitizeRecognition_(parsed, pagesCount, scanMode);
  parsed.scanMode = scanMode;
  if (scanMode === 'document') parsed.supplierShort = shortSupplierName_(parsed.supplierFull, parsed.supplierShort);
  parsed.warehouse = warehouse;
  parsed.messageDocumentType = FOX_RECEIPTS.messageDocumentType;
  parsed.messageText = buildTelegramMessageForResult_(parsed, warehouse);
  parsed.pagesCount = pagesCount;
  parsed.pdfFileId = file.getId();
  parsed.pdfUrl = file.getUrl();
  parsed.jobId = jobId;
  parsed.items = matchReceiptItems_(parsed.items || [], scanMode === 'check' ? (parsed.merchant || '') : parsed.supplierShort);

  const label = scanMode === 'check' ? (parsed.purchaseSummary || parsed.merchant || 'Чек') : (parsed.supplierShort || 'Поставщик');
  try { file.setName(safeFileName_('FO_X_' + (parsed.documentDate || dateStamp_(new Date())) + '_' + label + '_' + jobId + '.pdf')); } catch (_) {}

  updateJob_(jobId, { status: 'DONE', step: 'Проверь данные', progress: 1, resultJson: JSON.stringify(parsed), pdfFileId: file.getId(), pdfUrl: file.getUrl(), error: '' });
  const docPatch = {
    status: 'DONE', mode: scanMode, documentDate: parsed.documentDate,
    supplierShort: parsed.supplierShort, supplierFull: parsed.supplierFull,
    realTypes: (parsed.realDocumentTypes || []).join(', '), documentNumber: parsed.documentNumber,
    warehouse: warehouse, totalAmount: parsed.totalAmount, pagesCount: pagesCount,
    pdfFileId: file.getId(), pdfUrl: file.getUrl(), messageText: parsed.messageText,
    telegramUserId: auth.userId, telegramUserName: auth.userName, createdAt: new Date(),
    paymentCard: parsed.paymentCard, purchaseChannel: parsed.purchaseChannel,
    purchaseSummary: parsed.purchaseSummary, merchant: parsed.merchant,
    recognitionJson: JSON.stringify(parsed)
  };
  upsertDocumentRecord_(jobId, docPatch);
  if (scanMode === 'check') upsertCheckRecord_(jobId, docPatch);
}


function parseInlineImages_(raw, expectedPages) {
  let list;
  try { list = JSON.parse(requiredString_(raw, 'imagesJson')); }
  catch (err) { throw new Error('Не удалось прочитать изображения: ' + err.message); }
  if (!Array.isArray(list) || !list.length) throw new Error('Не переданы изображения для распознавания.');
  if (list.length > 20) throw new Error('Слишком много страниц. Максимум 20 изображений за один документ.');
  if (expectedPages && list.length !== Number(expectedPages)) {
    throw new Error('Количество изображений не совпадает с количеством страниц.');
  }
  let totalBytes = 0;
  return list.map(function(item, index) {
    const mimeType = String(item && item.mimeType || 'image/jpeg').trim();
    if (['image/jpeg','image/png','image/webp'].indexOf(mimeType) < 0) {
      throw new Error('Неподдерживаемый формат страницы ' + (index + 1) + ': ' + mimeType);
    }
    const data = cleanBase64_(requiredString_(item && item.data, 'image data'));
    const bytes = Utilities.base64Decode(data);
    if (!bytes || bytes.length < 100) throw new Error('Страница ' + (index + 1) + ' пустая.');
    if (bytes.length > 6 * 1024 * 1024) throw new Error('Страница ' + (index + 1) + ' слишком большая.');
    totalBytes += bytes.length;
    if (totalBytes > 24 * 1024 * 1024) throw new Error('Общий размер изображений слишком большой.');
    return { mimeType: mimeType, data: data };
  });
}

function scanReceiptImages_(p, auth) {
  const jobId = requiredString_(p.jobId, 'jobId');
  const scanMode = normalizeScanMode_(p.scanMode);
  const warehouse = normalizeWarehouse_(p.warehouse);
  const pagesCount = Math.max(1, Number(p.pagesCount) || 1);
  const images = parseInlineImages_(p.imagesJson, pagesCount);

  createOrResetJob_(jobId, auth, warehouse, pagesCount, scanMode);
  updateJob_(jobId, { status:'PROCESSING', step:scanMode === 'check' ? 'Распознаю изображения чека' : 'Распознаю изображения документов', progress:0.18, error:'' });
  SpreadsheetApp.flush();

  let parsed = recognizePdfWithGemini_(images, pagesCount, scanMode);
  parsed = sanitizeRecognition_(parsed, pagesCount, scanMode);
  parsed.scanMode = scanMode;
  if (scanMode === 'document') parsed.supplierShort = shortSupplierName_(parsed.supplierFull, parsed.supplierShort);
  parsed.warehouse = warehouse;
  parsed.messageDocumentType = FOX_RECEIPTS.messageDocumentType;
  parsed.messageText = buildTelegramMessageForResult_(parsed, warehouse);
  parsed.pagesCount = pagesCount;
  parsed.pdfFileId = '';
  parsed.pdfUrl = '';
  parsed.jobId = jobId;
  parsed.items = matchReceiptItems_(parsed.items || [], scanMode === 'check' ? (parsed.merchant || '') : parsed.supplierShort);

  updateJob_(jobId, { status:'DONE', step:'Проверь данные', progress:1, resultJson:JSON.stringify(parsed), error:'' });
  const docPatch = {
    status:'DONE', mode:scanMode, documentDate:parsed.documentDate,
    supplierShort:parsed.supplierShort, supplierFull:parsed.supplierFull,
    realTypes:(parsed.realDocumentTypes || []).join(', '), documentNumber:parsed.documentNumber,
    warehouse:warehouse, totalAmount:parsed.totalAmount, pagesCount:pagesCount,
    pdfFileId:'', pdfUrl:'', messageText:parsed.messageText,
    telegramUserId:auth.userId, telegramUserName:auth.userName, createdAt:new Date(),
    paymentCard:parsed.paymentCard, purchaseChannel:parsed.purchaseChannel,
    purchaseSummary:parsed.purchaseSummary, merchant:parsed.merchant,
    recognitionJson:JSON.stringify(parsed)
  };
  upsertDocumentRecord_(jobId, docPatch);
  if (scanMode === 'check') upsertCheckRecord_(jobId, docPatch);
}

function attachReceiptPdf_(p, auth) {
  const jobId = requiredString_(p.jobId, 'jobId');
  const job = getJobRow_(jobId);
  if (!job) throw new Error('Задание ещё не создано. Повтори отправку PDF.');
  if (String(job['Telegram User ID']) !== String(auth.userId)) throw new Error('Это задание создано другим пользователем.');
  if (String(job['PDF File ID'] || '')) return;

  const pdfBase64 = cleanBase64_(requiredString_(p.pdfBase64, 'pdfBase64'));
  const pdfBytes = Utilities.base64Decode(pdfBase64);
  if (pdfBytes.length > FOX_RECEIPTS.maxPdfBytes) throw new Error('PDF слишком большой. Максимум 15 МБ.');
  if (!isPdfBytes_(pdfBytes)) throw new Error('Переданный файл повреждён и не содержит сигнатуру PDF.');

  const folder = getReceiptsFolder_();
  const file = folder.createFile(Utilities.newBlob(pdfBytes, 'application/pdf', safeFileName_('FO_X_scan_' + jobId + '.pdf')));
  const result = parseJsonSafe_(String(job['Результат JSON'] || '{}'));
  const mode = normalizeScanMode_(job['Режим']);
  const label = mode === 'check' ? (result.purchaseSummary || result.merchant || 'Чек') : (result.supplierShort || 'Поставщик');
  try { file.setName(safeFileName_('FO_X_' + (result.documentDate || dateStamp_(new Date())) + '_' + label + '_' + jobId + '.pdf')); } catch (_) {}
  result.pdfFileId = file.getId();
  result.pdfUrl = file.getUrl();
  updateJob_(jobId, { pdfFileId:file.getId(), pdfUrl:file.getUrl(), resultJson:JSON.stringify(result) });
  upsertDocumentRecord_(jobId, { pdfFileId:file.getId(), pdfUrl:file.getUrl(), recognitionJson:JSON.stringify(result) });
  if (mode === 'check') upsertCheckRecord_(jobId, { pdfFileId:file.getId(), pdfUrl:file.getUrl(), recognitionJson:JSON.stringify(result) });
}

function confirmReceipt_(p, auth) {
  const jobId = requiredString_(p.jobId, 'jobId');
  const payload = parseJson_(requiredString_(p.payload, 'payload'));
  const initialJob = getJobRow_(jobId);

  if (!initialJob) throw new Error('Задание не найдено.');
  if (String(initialJob['Telegram User ID']) !== String(auth.userId)) {
    throw new Error('Это задание создано другим пользователем.');
  }

  const scanMode = normalizeScanMode_(payload.scanMode || initialJob['Режим']);
  const warehouse = normalizeWarehouse_(payload.warehouse || initialJob['Склад']);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new Error('Нет товарных строк для подтверждения.');

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) throw new Error('Таблица сейчас занята. Повтори через минуту.');

  let receiptId = '';
  let documentPatch = null;

  try {
    // Повторная проверка уже под блокировкой защищает от двойного нажатия.
    const job = getJobRow_(jobId);
    if (!job) throw new Error('Задание не найдено.');
    if (String(job['Telegram User ID']) !== String(auth.userId)) {
      throw new Error('Это задание создано другим пользователем.');
    }
    const currentJobStatus = String(job['Статус'] || '');
    const alreadySent = currentJobStatus === 'SENT_UNCONFIRMED';
    if (['CONFIRMED', 'SENDING', 'SENT'].indexOf(currentJobStatus) >= 0) {
      throw new Error('Это поступление уже подтверждено. Повторная запись запрещена.');
    }

    updateJob_(jobId, { status: 'PROCESSING', step: 'Проверяю позиции перед записью', progress: 0.2 });

    const ss = getSpreadsheet_();
    const history = ss.getSheetByName(FOX_RECEIPTS.sheets.receipts);
    if (!history) throw new Error('Не найден лист «Поступления». Запусти setupFoxReceipts().');

    const stockColumn = warehouse === 'Заготовочный' ? FOX_RECEIPTS.cols.reserve : FOX_RECEIPTS.cols.alley;
    const pdfFileId = String(job['PDF File ID'] || '');
    const pdfUrl = String(job['PDF URL'] || '');
    const operations = [];
    const targetKeys = {};

    // Сначала валидируем ВСЕ строки, ничего не меняя в стоке.
    items.forEach(function(item, index) {
      if (!truthy_(item.include) || truthy_(item.isService)) return;

      const stockSheetName = requiredString_(item.stockSheet, 'Лист стока в строке ' + (index + 1));
      const stockName = requiredString_(item.stockName, 'Позиция FO’X в строке ' + (index + 1));
      if (FOX_RECEIPTS.stockSheets.indexOf(stockSheetName) < 0) {
        throw new Error('Недопустимый лист стока: ' + stockSheetName);
      }

      const sh = ss.getSheetByName(stockSheetName);
      if (!sh) throw new Error('Лист не найден: ' + stockSheetName);
      const row = findStockRow_(sh, stockName);
      if (!row) throw new Error('Позиция не найдена: ' + stockSheetName + ' → ' + stockName);

      const key = stockSheetName + '::' + row;
      if (targetKeys[key]) {
        throw new Error('Одна позиция FO’X выбрана несколько раз: ' + stockName + '. Объедини количество в одну строку.');
      }
      targetKeys[key] = true;

      const qty = number_(item.stockQuantity || item.quantity);
      if (!(qty > 0)) throw new Error('Неверное количество у позиции: ' + stockName);

      const stockCell = sh.getRange(row, stockColumn);
      const priceCell = sh.getRange(row, FOX_RECEIPTS.cols.price);
      const before = number_(stockCell.getValue());
      const oldPrice = number_(priceCell.getValue());
      const newPrice = number_(item.stockUnitPrice || item.unitPriceVat);

      operations.push({
        item: item,
        stockSheetName: stockSheetName,
        stockName: stockName,
        row: row,
        qty: qty,
        stockCell: stockCell,
        priceCell: priceCell,
        before: before,
        oldPrice: oldPrice,
        after: before + qty,
        newPrice: newPrice
      });
    });

    if (!operations.length) throw new Error('Не выбрана ни одна товарная позиция для внесения.');

    receiptId = 'RCPT-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') + '-' + jobId.slice(-6);
    const logRows = operations.map(function(op) {
      const item = op.item;
      return [
        receiptId,
        'YES',
        parseDateForSheet_(payload.documentDate),
        parseDateForSheet_(payload.receiptDate || payload.documentDate),
        String(payload.supplierShort || ''),
        String(payload.supplierFull || ''),
        Array.isArray(payload.realDocumentTypes) ? payload.realDocumentTypes.join(', ') : String(payload.realDocumentTypes || ''),
        FOX_RECEIPTS.messageDocumentType,
        warehouse,
        op.stockSheetName,
        op.row,
        String(item.rawName || ''),
        op.stockName,
        op.qty,
        String(item.stockUnit || item.unit || ''),
        op.oldPrice || '',
        op.newPrice || op.oldPrice || '',
        op.before,
        op.after,
        number_(item.totalVat),
        pdfFileId,
        pdfUrl,
        auth.userId,
        auth.userName,
        'NO',
        new Date(),
        String(item.notes || ''),
        scanMode === 'check' ? 'Чек' : 'Документ поставки'
      ];
    });

    const applied = [];
    let historyStartRow = 0;
    try {
      updateJob_(jobId, { status: 'PROCESSING', step: 'Записываю поступление в сток', progress: 0.45 });

      operations.forEach(function(op) {
        op.stockCell.setValue(op.after);
        if (op.newPrice > 0) op.priceCell.setValue(op.newPrice);
        applied.push(op);
      });

      historyStartRow = history.getLastRow() + 1;
      history.getRange(historyStartRow, 1, logRows.length, logRows[0].length).setValues(logRows);
      SpreadsheetApp.flush();

      payload.receiptId = receiptId;
      payload.confirmedAt = new Date().toISOString();
      payload.scanMode = scanMode;
      payload.messageText = buildTelegramMessageForResult_(payload, warehouse);

      updateJob_(jobId, {
        status: alreadySent ? 'SENT' : 'CONFIRMED',
        step: alreadySent ? 'Отправлено в Telegram и внесено в сток' : 'Поступление внесено в сток',
        progress: 1,
        resultJson: JSON.stringify(payload),
        error: ''
      });
      SpreadsheetApp.flush();
    } catch (writeErr) {
      // Откат значений и цены, если любой этап записи не завершился.
      applied.slice().reverse().forEach(function(op) {
        try {
          op.stockCell.setValue(op.before);
          op.priceCell.setValue(op.oldPrice || '');
        } catch (_) {}
      });
      if (historyStartRow > 0) {
        try { history.deleteRows(historyStartRow, logRows.length); } catch (_) {}
      }
      SpreadsheetApp.flush();
      throw writeErr;
    }

    documentPatch = {
      status: alreadySent ? 'SENT' : 'CONFIRMED',
      mode: scanMode,
      documentDate: payload.documentDate,
      supplierShort: payload.supplierShort,
      supplierFull: payload.supplierFull,
      realTypes: Array.isArray(payload.realDocumentTypes) ? payload.realDocumentTypes.join(', ') : String(payload.realDocumentTypes || ''),
      documentNumber: payload.documentNumber,
      warehouse: warehouse,
      totalAmount: number_(payload.totalAmount),
      messageText: payload.messageText,
      confirmedAt: new Date(),
      recognitionJson: JSON.stringify(payload),
      paymentCard: payload.paymentCard, purchaseChannel: payload.purchaseChannel,
      purchaseSummary: payload.purchaseSummary, merchant: payload.merchant
    };
  } finally {
    lock.releaseLock();
  }

  // Служебная карточка документа не должна откатывать уже успешно внесённый сток.
  if (documentPatch) {
    try {
      upsertDocumentRecord_(jobId, documentPatch);
      if (documentPatch.mode === 'check') upsertCheckRecord_(jobId, Object.assign({}, documentPatch, { confirmedAt: new Date() }));
    } catch (err) {
      console.error('Не удалось обновить лист Документы: ' + errorText_(err));
    }
  }
}

function sendReceiptToTelegram_(p, auth) {
  const jobId = requiredString_(p.jobId, 'jobId');
  const job = getJobRow_(jobId);
  if (!job) throw new Error('Задание не найдено.');
  if (String(job['Telegram User ID']) !== String(auth.userId)) throw new Error('Это задание создано другим пользователем.');
  const currentStatus = String(job['Статус'] || '');
  if (['SENT', 'SENT_UNCONFIRMED'].indexOf(currentStatus) >= 0) throw new Error('Этот PDF уже отправлен в Telegram.');
  if (['DONE', 'CONFIRMED', 'SEND_ERROR'].indexOf(currentStatus) < 0) throw new Error('Документ ещё не готов к отправке.');
  updateJob_(jobId, { status: 'SENDING', step: 'Отправляю PDF в Telegram', progress: 0.35, error: '' });

  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('В Script Properties не задан TELEGRAM_BOT_TOKEN.');
  const file = DriveApp.getFileById(requiredString_(job['PDF File ID'], 'PDF File ID'));
  const result = parseJsonSafe_(String(job['Результат JSON'] || '{}'));
  const messageText = String(p.messageText || result.messageText || buildTelegramMessageForResult_(result, result.warehouse || job['Склад'])).trim();
  const targetChatId = String(props.getProperty('TELEGRAM_TARGET_CHAT_ID') || auth.chatId || auth.userId);
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendDocument', {
    method: 'post', payload: { chat_id: targetChatId, caption: messageText, document: file.getBlob().setName(file.getName()) }, muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const body = parseJsonSafe_(response.getContentText());
  if (code < 200 || code >= 300 || !body.ok) throw new Error('Telegram не принял документ: ' + (body.description || ('HTTP ' + code)));

  const nextStatus = currentStatus === 'CONFIRMED' ? 'SENT' : 'SENT_UNCONFIRMED';
  updateJob_(jobId, { status: nextStatus, step: 'PDF и сообщение отправлены в Telegram', progress: 1, error: '' });
  upsertDocumentRecord_(jobId, { status: nextStatus, sentAt: new Date(), messageText: messageText });
  if (normalizeScanMode_(job['Режим']) === 'check') upsertCheckRecord_(jobId, { status: nextStatus, sentAt: new Date(), messageText: messageText });
  if (currentStatus === 'CONFIRMED') markHistorySent_(jobId, String(job['PDF File ID'] || ''));
}


/**
 * Кассовый отчёт FO’X.
 * PDF не сохраняется в Google Drive и не записывается в Google Sheets.
 * В служебном листе Скан_Задания остаются только статус и распознанные числовые данные.
 */
function scanCashReport_(p, auth) {
  const jobId = requiredString_(p.jobId, 'jobId');
  const pagesCount = Math.max(1, Number(p.pagesCount) || 1);
  const pdfBase64 = cleanBase64_(requiredString_(p.pdfBase64, 'pdfBase64'));
  const pdfBytes = Utilities.base64Decode(pdfBase64);
  if (pdfBytes.length > FOX_RECEIPTS.maxPdfBytes) throw new Error('PDF слишком большой. Максимум 15 МБ.');
  if (!isPdfBytes_(pdfBytes)) throw new Error('Переданный файл повреждён и не содержит сигнатуру PDF.');

  createCashReportJob_(jobId, auth, pagesCount);
  updateJob_(jobId, { status: 'PROCESSING', step: 'Передаю PDF напрямую в Gemini без сохранения', progress: 0.18, error: '' });
  SpreadsheetApp.flush();

  const raw = recognizeCashReportWithGemini_(pdfBase64, pagesCount);
  const result = sanitizeCashReportResult_(raw, pagesCount);
  result.jobId = jobId;

  updateJob_(jobId, {
    status: 'DONE',
    step: 'Проверь суммы и сверку терминалов',
    progress: 1,
    resultJson: JSON.stringify(result),
    pdfFileId: '',
    pdfUrl: '',
    error: ''
  });
}


function scanCashReportImages_(p, auth) {
  const jobId = requiredString_(p.jobId, 'jobId');
  const pagesCount = Math.max(1, Number(p.pagesCount) || 1);
  const images = parseInlineImages_(p.imagesJson, pagesCount);
  createCashReportJob_(jobId, auth, pagesCount);
  updateJob_(jobId, { status:'PROCESSING', step:'Распознаю фотографии кассового отчёта напрямую', progress:0.18, error:'' });
  SpreadsheetApp.flush();
  const raw = recognizeCashReportWithGemini_(images, pagesCount);
  const result = sanitizeCashReportResult_(raw, pagesCount);
  result.jobId = jobId;
  updateJob_(jobId, { status:'DONE', step:'Проверь суммы и сверку терминалов', progress:1, resultJson:JSON.stringify(result), pdfFileId:'', pdfUrl:'', error:'' });
}

function createCashReportJob_(jobId, auth, pagesCount) {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(FOX_RECEIPTS.sheets.jobs);
  if (!sh) throw new Error('Не найден служебный лист «Скан_Задания».');
  const found = findRowByValue_(sh, 1, jobId, 3);
  if (found) {
    const existing = getJobRow_(jobId);
    const sameUser = existing && String(existing['Telegram User ID']) === String(auth.userId);
    const sameMode = existing && String(existing['Режим'] || '') === cashReportJobMode_(auth);
    if (!sameUser || !sameMode || !jobMatchesTelegramRoute_(existing, auth)) {
      throw new Error('Этот идентификатор задания уже используется другим пользователем или ботом.');
    }
  }
  const row = found || sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, FOX_RECEIPT_HEADERS.jobs.length).setValues([[
    jobId, 'PROCESSING', 'Принимаю кассовый отчёт', 0.03, '', '', '',
    auth.userId, auth.userName, 'Кассовый отчёт', pagesCount,
    found ? sh.getRange(row, 12).getValue() || new Date() : new Date(),
    new Date(), '', cashReportJobMode_(auth)
  ]]);
}

function failCashReportJob_(jobId, message) {
  updateJob_(jobId, { status: 'ERROR', step: 'Ошибка распознавания кассового отчёта', progress: 1, error: message });
}

function recognizeCashReportWithGemini_(pdfBase64, pagesCount) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('В Script Properties не задан GEMINI_API_KEY.');
  const model = normalizeGeminiModel_(props.getProperty('GEMINI_MODEL') || FOX_RECEIPTS.defaultGeminiModel);
  let mediaParts;
  if (Array.isArray(pdfBase64)) {
    if (!pdfBase64.length) throw new Error('Не переданы фотографии кассового отчёта.');
    mediaParts = pdfBase64.map(function(img) {
      return { inlineData:{ mimeType:String(img.mimeType || 'image/jpeg'), data:cleanBase64_(img.data) } };
    });
  } else {
    pdfBase64 = cleanPdfBase64_(pdfBase64);
    if (!pdfBase64 || pdfBase64.length < 100) throw new Error('PDF кассового отчёта пустой.');
    if (pdfBase64.indexOf('JVBERi0') !== 0) throw new Error('Файл кассового отчёта не похож на PDF.');
    mediaParts = [{ inlineData:{ mimeType:'application/pdf', data:pdfBase64 } }];
  }

  const prompt = [
    'Ты распознаёшь кассовый отчёт ресторана FO’X из iiko и сводные банковские слипы терминалов.',
    'PDF содержит ' + pagesCount + ' страниц/фотографий. На одной фотографии могут одновременно находиться длинные отчёты iiko и несколько маленьких терминальных слипов.',
    'Верни только JSON без Markdown. Не выдумывай значения. Если поле не найдено — число 0, строка "", массив [].',
    '',
    'ПРАВИЛА ДЛЯ ОТЧЁТА IIKO:',
    'report_date — дата кассовой смены строго ДД.ММ.ГГГГ. Бери её ТОЛЬКО из длинного отчёта iiko (шапка «Итого по смене»/«Кассовая смена»). Не бери дату с банковских слипов и не бери рукописную дату с конверта.',
    'fiscal_total — итог раздела ФИСКАЛЬНЫЕ типы оплат.',
    'non_fiscal_total — итог раздела НЕФИСКАЛЬНЫЕ типы оплат.',
    'total_revenue — значение «Итого (Все типы оплат)» / общая сумма всех типов оплат. Не брать промежуточное «Итого продаж».',
    'bank_cards — строка «Банковские карты».',
    'bank_cards_2 — отдельная строка «Банковские карты 2». Не складывать с bank_cards.',
    'cash_non_fiscal — строка «Наличка» именно в разделе НЕФИСКАЛЬНЫЕ типы оплат.',
    'cash_fiscal — строка оплаты наличными именно в разделе ФИСКАЛЬНЫЕ типы оплат («Оплата наличными» или «Наличные»).',
    'cash_2 — строка «Наличка 2» или «Наличные 2» в нефискальных типах оплат.',
    'tapper — строка Tapper.',
    'settlement_account — строка «Расчётный счёт».',
    'settlement_account_2 — отдельная строка «Расчётный счёт 2». Не складывать с предыдущей.',
    'online_cashbox_2 — ТОЛЬКО отдельная строка с точным названием «Онлайн-Касса 2» / «Онлайн касса 2».',
    'КРИТИЧЕСКИ ВАЖНО: не подставляй сюда строку «Безналичный расчёт», «ИТОГО (Безналичный расчёт)», «ИТОГО (Нефискальные типы)» или любой групповой итог.',
    'Типичный пример FO’X: «Безналичный расчёт — 66 280,00» является общим итогом группы, а ниже отдельными строками идут «Наличка — 36 280,00» и «Онлайн касса 2 — 30 000,00». В этом примере online_cashbox_2 = 30000, а НЕ 66280.',
    '',
    'ПРАВИЛА ДЛЯ payment_rows — ГЛАВНЫЙ ИСТОЧНИК ВСЕХ ПЛАТЁЖНЫХ СТРОК:',
    'payment_rows — полный массив отдельных строк типов оплаты из отчёта iiko.',
    'Backend формирует Безнал, Безнал 2, Нал, Нал Фискал, Нал2, Tapper, Расчётный счёт, Расчётный счёт 2 и Онлайн-Касса 2 ТОЛЬКО из payment_rows.',
    'Поэтому обязательно просмотри оба раздела отчёта: ФИСКАЛЬНЫЕ типы оплат и НЕФИСКАЛЬНЫЕ типы оплат.',
    'Для каждой реально напечатанной строки укажи section строго одним из значений: fiscal, non_fiscal или other; row_name — точное название строки; amount — сумму именно этой строки.',
    'Не переименовывай строки, не переносить суммы между строками и не подставляй суммы родительских групп.',
    'Не добавляй строки, начинающиеся с «ИТОГО», включая «ИТОГО (Безналичный расчёт)», «ИТОГО (Фискальные типы)» и «ИТОГО (Нефискальные типы)».',
    'Строки «Безналичный расчёт», «Фискальные типы оплат» и «Нефискальные типы оплат» могут быть заголовками или групповыми итогами — они не заменяют вложенные платёжные строки.',
    'Точные соответствия: «Банковские карты», «Банковские карты 2», «Наличка», «Оплата наличными»/«Наличные», «Наличка 2»/«Наличные 2», «Tapper», «Расчётный счёт», «Расчётный счёт 2», «Онлайн-Касса 2»/«Онлайн касса 2».',
    'Если в подробном блоке после названия напечатано действие «Продажа» или «Предоплата» (например «Наличка Продажа» или «Онлайн касса 2 Предоплата»), обязательно добавь такую строку в payment_rows с её фактической суммой. Это не групповой итог.',
    'Если точной строки нет на отчёте — не создавай её и не подставляй похожий итог. В итоговом JSON соответствующее прямое поле оставь 0.',
    '',
    'ПРАВИЛА ДЛЯ ИНКАССАЦИИ С КОНВЕРТА:',
    'На фотографии может быть бумажный конверт или отдельный лист с рукописной строкой «Инкассация», «Инкас», «с/инкас», «с/нкас» или похожим сокращением.',
    'envelope_date — рукописная дата на конверте, если она есть; иначе пустая строка.',
    'collection_amount — первое рукописное числовое значение после этой подписи, вне круглых скобок.',
    'collection_actual — второе рукописное значение внутри круглых скобок.',
    'Пример: надпись «с/нкас: 71938 (71940)» означает collection_amount=71938 и collection_actual=71940.',
    'Бери эти значения ТОЛЬКО с конверта/рукописной записки. Не вычисляй инкассацию из Нал, Нал Фискал, расхода или других строк iiko.',
    'Если надпись на конверте отсутствует или не читается — collection_amount=0 и collection_actual=0. Не выдумывай и не рассчитывай их.',
    'Пример: если видны «Безналичный расчёт — 66 280,00», «Наличка — 36 280,00» и «Онлайн касса 2 — 30 000,00», в payment_rows должны попасть две отдельные строки Наличка=36280 и Онлайн касса 2=30000. Значение 66280 не относится ни к одной из них.',
    '',
    'ПРАВИЛА ДЛЯ ТЕРМИНАЛЬНЫХ СЛИПОВ:',
    'terminal_slips — массив ВСЕХ маленьких сводных банковских чеков/слипов на всех страницах PDF.',
    'Просмотри каждую страницу целиком сверху вниз и слева направо. Найди КАЖДОЕ отдельное вхождение заголовка «Сводный чек» или отдельного блока «Количество оплат».',
    'На каждый физически отдельный слип создай ровно один элемент массива. Не объединяй два слипа в один и не пропускай второй слип, даже если оба находятся на одной фотографии.',
    'Если видны два разных номера терминала T: или M:, это два разных элемента terminal_slips.',
    'На каждом слипе найди ФИНАЛЬНЫЙ ИТОГОВЫЙ БЛОК, расположенный ниже отдельных строк «Оплата» и «Оплата QR», обычно после горизонтальной черты:',
    '«Количество оплат: ...» и следующая строка «На сумму: ...».',
    'total_amount — число из финальной строки «Количество оплат ... На сумму».',
    'amount — всегда должен быть точно равен total_amount.',
    'card_amount — сумма из отдельного блока «Оплата ... На сумму».',
    'qr_amount — сумма из отдельного блока «Оплата QR ... На сумму». Даже если QR-блок расположен далеко от обычной оплаты, обязательно найди и запиши его.',
    'КРИТИЧЕСКАЯ ПРОВЕРКА: перед ответом сравни total_amount с card_amount + qr_amount. В корректном слипе эти значения должны совпадать с точностью до копеек.',
    'Нельзя записывать в total_amount только обычную «Оплату», если ниже есть отдельная «Оплата QR».',
    'Если финальный блок плохо читается, но отдельные суммы «Оплата» и «Оплата QR» читаются уверенно, запиши total_amount = card_amount + qr_amount и amount = то же значение.',
    'Если ни финальный итог, ни отдельные суммы не читаются уверенно, запиши total_amount=0, amount=0 и укажи сомнение в notes.',
    'Пример 1: финальный блок показывает «Количество оплат: 49 / На сумму: 326876.80» — в total_amount и amount запиши 326876.80.',
    'Пример 2: финальный блок показывает «Количество оплат: 33 / На сумму: 164344.00» — в total_amount и amount запиши 164344.00.',
    'Терминал уже показывает сумму с учётом отмен, поэтому отмены отдельно не вычитать.',
    'Не добавляй в terminal_slips строку «Банковские карты» из отчёта iiko и не дублируй один и тот же слип.',
    'slip_date — дата, напечатанная в верхней части именно этого банковского слипа, строго ДД.ММ.ГГГГ; если не читается — пустая строка.',
    'label — коротко банк/терминал и последние цифры терминала, если видны; иначе «Терминал 1», «Терминал 2» и т.д.',
    'notes — только реальные сомнения распознавания.'
  ].join('\n');

  const schema = {
    type: 'OBJECT',
    properties: {
      report_date: { type: 'STRING' },
      fiscal_total: { type: 'NUMBER' },
      non_fiscal_total: { type: 'NUMBER' },
      envelope_date: { type: 'STRING' },
      total_revenue: { type: 'NUMBER' },
      bank_cards: { type: 'NUMBER' },
      bank_cards_2: { type: 'NUMBER' },
      cash_non_fiscal: { type: 'NUMBER' },
      cash_fiscal: { type: 'NUMBER' },
      cash_2: { type: 'NUMBER' },
      tapper: { type: 'NUMBER' },
      settlement_account: { type: 'NUMBER' },
      settlement_account_2: { type: 'NUMBER' },
      online_cashbox_2: { type: 'NUMBER' },
      collection_amount: { type: 'NUMBER' },
      collection_actual: { type: 'NUMBER' },
      payment_rows: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            section: { type: 'STRING' },
            row_name: { type: 'STRING' },
            amount: { type: 'NUMBER' }
          },
          required: ['section','row_name','amount']
        }
      },
      terminal_slips: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            label: { type: 'STRING' },
            slip_date: { type: 'STRING' },
            card_amount: { type: 'NUMBER' },
            qr_amount: { type: 'NUMBER' },
            total_amount: { type: 'NUMBER' },
            amount: { type: 'NUMBER' }
          },
          required: ['label','slip_date','card_amount','qr_amount','total_amount','amount']
        }
      },
      notes: { type: 'STRING' }
    },
    required: ['report_date','fiscal_total','non_fiscal_total','envelope_date','total_revenue','bank_cards','bank_cards_2','cash_non_fiscal','cash_fiscal','cash_2','tapper','settlement_account','settlement_account_2','online_cashbox_2','collection_amount','collection_actual','payment_rows','terminal_slips','notes']
  };
  const parts = mediaParts.concat([{ text:prompt }]);
  const body = { contents: [{ role: 'user', parts: parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.1, maxOutputTokens: 4096 } };
  let primary;
  try {
    primary = parseGeminiJsonResult_(callGeminiGenerateContent_(apiKey, model, body).text);
  } catch (firstError) {
    if (!/INVALID_ARGUMENT|invalid argument|HTTP 400/i.test(errorText_(firstError))) throw firstError;
    const fallback = { contents: [{ role: 'user', parts: parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 4096 } };
    primary = parseGeminiJsonResult_(callGeminiGenerateContent_(apiKey, model, fallback).text);
  }

  // Узкая повторная проверка длинного отчёта iiko запускается только при конфликте даты
  // или если сумма извлечённых платёжных строк не сходится с итогом раздела.
  if (iikoCoreNeedsVerification_(primary)) {
    try {
      const verifiedIiko = recognizeIikoCoreWithGemini_(apiKey, model, mediaParts);
      primary = mergeVerifiedIikoCore_(primary, verifiedIiko);
    } catch (verifyIikoError) {
      primary.notes = [String(primary.notes || '').trim(), 'Повторная проверка iiko: ' + errorText_(verifyIikoError)].filter(Boolean).join(' | ');
    }
  }

  // Если итог терминалов не сходится с iiko, QR потерян или выбрана не та строка,
  // выполняем один узкий повторный запрос только по банковским слипам.
  if (terminalSlipsNeedVerification_(primary)) {
    try {
      const verified = recognizeTerminalSlipsWithGemini_(apiKey, model, mediaParts);
      const chosen = chooseBetterTerminalSlipSet_(primary.terminal_slips, verified.terminal_slips, number_(primary.bank_cards));
      if (chosen && chosen.length) primary.terminal_slips = chosen;
    } catch (verifyError) {
      primary.notes = [String(primary.notes || '').trim(), 'Повторная проверка терминальных слипов: ' + errorText_(verifyError)].filter(Boolean).join(' | ');
    }
  }
  return primary;
}

function terminalSlipResolvedAmount_(slip) {
  slip = slip && typeof slip === 'object' ? slip : {};
  const card = number_(slip.card_amount);
  const qr = number_(slip.qr_amount);
  const total = number_(slip.total_amount || slip.amount);
  const components = card + qr;

  // Нижний блок «Количество оплат → На сумму» — единственный главный итог слипа.
  // Компоненты «Оплата» и «Оплата QR» используются только как запасной вариант,
  // когда итоговый блок не распознан совсем.
  if (total > 0) return total;
  return components;
}

function terminalSlipSetSummary_(slips, bankCards) {
  slips = Array.isArray(slips) ? slips : [];
  const amounts = slips.map(terminalSlipResolvedAmount_).filter(function(v) { return v > 0; });
  const total = amounts.reduce(function(sum, v) { return sum + v; }, 0);
  const qrCount = slips.filter(function(x) { return number_(x && x.qr_amount) > 0; }).length;
  const consistencyCount = slips.filter(function(x) {
    const card = number_(x && x.card_amount);
    const qr = number_(x && x.qr_amount);
    const finalTotal = number_(x && (x.total_amount || x.amount));
    return finalTotal > 0 && Math.abs(finalTotal - (card + qr)) <= 0.05;
  }).length;
  return {
    slips: slips,
    total: total,
    positiveCount: amounts.length,
    qrCount: qrCount,
    consistencyCount: consistencyCount,
    iikoError: bankCards > 0 ? Math.abs(total - bankCards) : 0
  };
}

function terminalSlipsNeedVerification_(result) {
  result = result && typeof result === 'object' ? result : {};
  const slips = Array.isArray(result.terminal_slips) ? result.terminal_slips : [];
  if (!slips.length) return number_(result.bank_cards) > 0;

  const hasBrokenSlip = slips.some(function(x) {
    const card = number_(x && x.card_amount);
    const qr = number_(x && x.qr_amount);
    const total = number_(x && (x.total_amount || x.amount));
    if (total <= 0) return true;
    if (card + qr > 0 && Math.abs(total - (card + qr)) > 0.05) return true;
    return false;
  });
  if (hasBrokenSlip) return true;

  const summary = terminalSlipSetSummary_(slips, number_(result.bank_cards));
  return number_(result.bank_cards) > 0 && summary.iikoError > 1;
}

function chooseBetterTerminalSlipSet_(first, second, bankCards) {
  const a = terminalSlipSetSummary_(first, bankCards);
  const b = terminalSlipSetSummary_(second, bankCards);
  if (!b.positiveCount) return a.slips;
  if (!a.positiveCount) return b.slips;

  // Не выбираем OCR-вариант по близости к iiko: реальное расхождение должно
  // остаться видимым. Сравниваем только внутреннее качество самих слипов.
  if (b.consistencyCount !== a.consistencyCount) return b.consistencyCount > a.consistencyCount ? b.slips : a.slips;
  if (b.qrCount !== a.qrCount) return b.qrCount > a.qrCount ? b.slips : a.slips;
  if (b.positiveCount !== a.positiveCount) return b.positiveCount > a.positiveCount ? b.slips : a.slips;
  return a.slips;
}

function recognizeTerminalSlipsWithGemini_(apiKey, model, mediaParts) {
  const prompt = [
    'Распознай ТОЛЬКО маленькие банковские терминальные сводные чеки на всех переданных фотографиях FO’X.',
    'Верни только JSON без Markdown.',
    'Найди каждый физически отдельный слип. Два номера терминала T: или M: означают два разных слипа.',
    'Для каждого слипа отдельно прочитай дату slip_date из шапки чека в формате ДД.ММ.ГГГГ и суммы:',
    '1) card_amount — «Оплата» → «На сумму»;',
    '2) qr_amount — «Оплата QR» → «На сумму»;',
    '3) total_amount — нижний итоговый блок «Количество оплат» → «На сумму».',
    'Перед ответом проверь арифметику: total_amount должен равняться card_amount + qr_amount.',
    'Не бери строки из длинного отчёта iiko. Не бери количество операций вместо суммы.',
    'Не пропускай «Оплата QR». Если QR-блока нет, qr_amount=0.',
    'Если нижний итог не читается, но card_amount и qr_amount читаются, total_amount = card_amount + qr_amount.',
    'label — банк и последние цифры T: или M:, если они видны.'
  ].join('\n');
  const schema = {
    type:'OBJECT',
    properties:{
      terminal_slips:{
        type:'ARRAY',
        items:{
          type:'OBJECT',
          properties:{
            label:{type:'STRING'},
            slip_date:{type:'STRING'},
            card_amount:{type:'NUMBER'},
            qr_amount:{type:'NUMBER'},
            total_amount:{type:'NUMBER'},
            amount:{type:'NUMBER'}
          },
          required:['label','slip_date','card_amount','qr_amount','total_amount','amount']
        }
      }
    },
    required:['terminal_slips']
  };
  const parts = mediaParts.concat([{text:prompt}]);
  const body = {contents:[{role:'user',parts:parts}],generationConfig:{responseMimeType:'application/json',responseSchema:schema,temperature:0.1,maxOutputTokens:2048}};
  try {
    return parseGeminiJsonResult_(callGeminiGenerateContent_(apiKey, model, body).text);
  } catch (firstError) {
    if (!/INVALID_ARGUMENT|invalid argument|HTTP 400/i.test(errorText_(firstError))) throw firstError;
    const fallback = {contents:[{role:'user',parts:parts}],generationConfig:{responseMimeType:'application/json',temperature:0.1,maxOutputTokens:2048}};
    return parseGeminiJsonResult_(callGeminiGenerateContent_(apiKey, model, fallback).text);
  }
}


function validCashDate_(value) {
  const d = normalizeDate_(value);
  return /^\d{2}\.\d{2}\.\d{4}$/.test(d) ? d : '';
}

function cashPaymentSection_(value) {
  const section = normalizeText_(value);
  if (section.indexOf('non fiscal') >= 0 || section.indexOf('nonfiscal') >= 0 || section.indexOf('нефиск') >= 0) return 'non_fiscal';
  if (section === 'fiscal' || section.indexOf('фиск') >= 0) return 'fiscal';
  return 'other';
}

function cashPaymentRowsSummary_(rows) {
  rows = Array.isArray(rows) ? rows : [];
  const out = { fiscal:0, nonFiscal:0, positive:0 };
  rows.forEach(function(x) {
    x = x && typeof x === 'object' ? x : {};
    const amount = number_(x.amount);
    if (amount <= 0) return;
    out.positive++;
    const section = cashPaymentSection_(x.section);
    if (section === 'fiscal') out.fiscal += amount;
    if (section === 'non_fiscal') out.nonFiscal += amount;
  });
  return out;
}

function cashDateCandidates_(result) {
  result = result && typeof result === 'object' ? result : {};
  const dates = [];
  const reportDate = validCashDate_(result.report_date);
  if (reportDate) dates.push({date:reportDate, weight:3, source:'iiko'});
  const envelopeDate = validCashDate_(result.envelope_date);
  if (envelopeDate) dates.push({date:envelopeDate, weight:1, source:'envelope'});
  const slips = Array.isArray(result.terminal_slips) ? result.terminal_slips : [];
  slips.forEach(function(x) {
    const d = validCashDate_(x && x.slip_date);
    if (d) dates.push({date:d, weight:2, source:'slip'});
  });
  return dates;
}

function resolveCashReportDate_(reportDate, envelopeDate, slips) {
  // Дата кассовой смены берётся только из длинного отчёта iiko.
  // Даты конверта и терминальных слипов служат для проверки, но не подменяют её.
  return validCashDate_(reportDate) || normalizeDate_(reportDate);
}

function iikoCoreNeedsVerification_(result) {
  result = result && typeof result === 'object' ? result : {};
  const rows = cashPaymentRowsSummary_(result.payment_rows);
  const fiscalTotal = number_(result.fiscal_total);
  const nonFiscalTotal = number_(result.non_fiscal_total);
  const totalRevenue = number_(result.total_revenue);

  if (!validCashDate_(result.report_date)) return true;

  const candidates = cashDateCandidates_(result);
  const dateScores = {};
  candidates.forEach(function(x) { dateScores[x.date] = (dateScores[x.date] || 0) + x.weight; });
  const iikoDate = validCashDate_(result.report_date);
  const conflictingConsensus = Object.keys(dateScores).some(function(d) {
    return d !== iikoDate && dateScores[d] >= 4;
  });
  if (conflictingConsensus) return true;

  if (!rows.positive && totalRevenue > 0) return true;
  if (fiscalTotal > 0 && Math.abs(rows.fiscal - fiscalTotal) > 1) return true;
  if (nonFiscalTotal > 0 && Math.abs(rows.nonFiscal - nonFiscalTotal) > 1) return true;
  if (totalRevenue > 0 && fiscalTotal + nonFiscalTotal > 0 && Math.abs(totalRevenue - fiscalTotal - nonFiscalTotal) > 1) return true;
  return false;
}

function iikoRowsQuality_(result) {
  result = result && typeof result === 'object' ? result : {};
  const rows = cashPaymentRowsSummary_(result.payment_rows);
  const fiscalTotal = number_(result.fiscal_total);
  const nonFiscalTotal = number_(result.non_fiscal_total);
  let error = 0;
  if (fiscalTotal > 0) error += Math.abs(rows.fiscal - fiscalTotal);
  if (nonFiscalTotal > 0) error += Math.abs(rows.nonFiscal - nonFiscalTotal);
  return { error:error, count:rows.positive, hasDate:validCashDate_(result.report_date) ? 1 : 0 };
}

function mergeVerifiedIikoCore_(primary, verified) {
  primary = primary && typeof primary === 'object' ? primary : {};
  verified = verified && typeof verified === 'object' ? verified : {};
  const a = iikoRowsQuality_(primary);
  const b = iikoRowsQuality_(verified);

  const useVerifiedRows =
    (b.count > 0 && a.count === 0) ||
    (b.count > 0 && b.error + 0.5 < a.error) ||
    (b.count > a.count && b.error <= a.error + 0.5);

  if (useVerifiedRows) primary.payment_rows = verified.payment_rows;
  if (number_(verified.fiscal_total) > 0) primary.fiscal_total = verified.fiscal_total;
  if (number_(verified.non_fiscal_total) > 0) primary.non_fiscal_total = verified.non_fiscal_total;
  if (number_(verified.total_revenue) > 0) primary.total_revenue = verified.total_revenue;

  const verifiedDate = validCashDate_(verified.report_date);
  if (verifiedDate) primary.report_date = verifiedDate;
  return primary;
}

function recognizeIikoCoreWithGemini_(apiKey, model, mediaParts) {
  const prompt = [
    'Распознай ТОЛЬКО длинный кассовый отчёт iiko FO’X. Игнорируй маленькие банковские слипы и рукописный конверт.',
    'Верни только JSON без Markdown.',
    'report_date бери только из шапки длинного отчёта iiko рядом с «Итого по смене»/«Кассовая смена». Формат ДД.ММ.ГГГГ.',
    'total_revenue — «Итого (Все типы оплат)».',
    'fiscal_total — итог раздела ФИСКАЛЬНЫЕ типы оплат.',
    'non_fiscal_total — итог раздела НЕФИСКАЛЬНЫЕ типы оплат.',
    'payment_rows — ВСЕ отдельные строки типов оплаты из фискального и нефискального разделов.',
    'Для каждой строки верни section=fiscal или non_fiscal, точное row_name и amount.',
    'Обязательно ищи строку «Наличка» в НЕФИСКАЛЬНЫХ типах оплат. Не заменяй её групповым итогом «Безналичный расчёт».',
    'Не включай строки, начинающиеся с «ИТОГО», и не включай заголовки групп.',
    'Примеры точных строк: Банковские карты, Банковские карты 2, Наличка, Оплата наличными, Наличка 2, Tapper, Расчётный счёт, Расчётный счёт 2, Онлайн-Касса 2.'
  ].join('\n');
  const schema = {
    type:'OBJECT',
    properties:{
      report_date:{type:'STRING'},
      total_revenue:{type:'NUMBER'},
      fiscal_total:{type:'NUMBER'},
      non_fiscal_total:{type:'NUMBER'},
      payment_rows:{
        type:'ARRAY',
        items:{
          type:'OBJECT',
          properties:{
            section:{type:'STRING'},
            row_name:{type:'STRING'},
            amount:{type:'NUMBER'}
          },
          required:['section','row_name','amount']
        }
      }
    },
    required:['report_date','total_revenue','fiscal_total','non_fiscal_total','payment_rows']
  };
  const parts = mediaParts.concat([{text:prompt}]);
  const body = {contents:[{role:'user',parts:parts}],generationConfig:{responseMimeType:'application/json',responseSchema:schema,temperature:0.1,maxOutputTokens:3072}};
  try {
    return parseGeminiJsonResult_(callGeminiGenerateContent_(apiKey, model, body).text);
  } catch (firstError) {
    if (!/INVALID_ARGUMENT|invalid argument|HTTP 400/i.test(errorText_(firstError))) throw firstError;
    const fallback = {contents:[{role:'user',parts:parts}],generationConfig:{responseMimeType:'application/json',temperature:0.1,maxOutputTokens:3072}};
    return parseGeminiJsonResult_(callGeminiGenerateContent_(apiKey, model, fallback).text);
  }
}

function sanitizeCashReportResult_(r, pagesCount) {
  r = r && typeof r === 'object' ? r : {};

  function normalizePaymentSection_(value) {
    const section = normalizeText_(value);
    // Сначала проверяем нефискальный раздел, потому что слово «нефискальный»
    // также содержит подстроку «фискальный».
    if (section.indexOf('non fiscal') >= 0 || section.indexOf('nonfiscal') >= 0 || section.indexOf('нефиск') >= 0) {
      return 'non_fiscal';
    }
    if (section === 'fiscal' || section.indexOf('фиск') >= 0) return 'fiscal';
    return 'other';
  }

  function canonicalPaymentName_(value) {
    return normalizeText_(value)
      // В подробных блоках iiko к типу оплаты часто добавляется операция:
      // «Наличка Продажа», «Онлайн касса 2 Предоплата» и т.п.
      // Убираем только эти служебные хвосты, но не трогаем само название оплаты.
      .replace(/\b(продажа|предоплата)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const paymentRows = Array.isArray(r.payment_rows) ? r.payment_rows.map(function(x) {
    x = x && typeof x === 'object' ? x : {};
    const rawName = String(x.row_name || '').trim();
    return {
      section: normalizePaymentSection_(x.section),
      name: rawName,
      nameNorm: normalizeText_(rawName),
      nameCanonical: canonicalPaymentName_(rawName),
      amount: number_(x.amount)
    };
  }).filter(function(x) { return x.nameNorm && x.amount >= 0; }) : [];

  // Строго ищем нужный тип оплаты по названию. Раздел fiscal/non_fiscal —
  // приоритет, но не жёсткий фильтр: Gemini иногда правильно читает строку,
  // но помечает её section=other. Групповые итоги всё равно не подходят,
  // потому что их названия не совпадают с целевыми строками.
  function exactPaymentAmount_(names, preferredSection) {
    const exactTargets = names.map(function(name) { return normalizeText_(name); });
    const canonicalTargets = names.map(function(name) { return canonicalPaymentName_(name); });

    function pick_(rows, requirePreferredSection) {
      return rows.filter(function(row) {
        if (row.amount <= 0) return false;
        if (requirePreferredSection && preferredSection && row.section !== preferredSection) return false;
        return true;
      })[0] || null;
    }

    const exactRows = paymentRows.filter(function(row) {
      return exactTargets.indexOf(row.nameNorm) >= 0;
    });
    const canonicalRows = paymentRows.filter(function(row) {
      return canonicalTargets.indexOf(row.nameCanonical) >= 0;
    });

    const found =
      pick_(exactRows, true) ||
      pick_(exactRows, false) ||
      pick_(canonicalRows, true) ||
      pick_(canonicalRows, false);

    return found ? found.amount : 0;
  }

  const slips = Array.isArray(r.terminal_slips) ? r.terminal_slips.map(function(x, i) {
    x = x && typeof x === 'object' ? x : {};
    const cardAmount = number_(x.card_amount);
    const qrAmount = number_(x.qr_amount);
    const totalAmount = number_(x.total_amount || x.amount);
    const resolvedAmount = terminalSlipResolvedAmount_(x);
    const componentsAmount = cardAmount + qrAmount;
    return {
      label: String(x.label || ('Терминал ' + (i + 1))).trim(),
      slipDate: normalizeDate_(x.slip_date),
      amount: resolvedAmount,
      cardAmount: cardAmount,
      qrAmount: qrAmount,
      totalAmount: totalAmount,
      correctedByComponents: totalAmount <= 0 && componentsAmount > 0,
      componentMismatch: totalAmount > 0 && componentsAmount > 0 && Math.abs(totalAmount - componentsAmount) > 0.05
    };
  }).filter(function(x) { return x.amount > 0; }) : [];

  return {
    reportDate: resolveCashReportDate_(r.report_date, r.envelope_date, slips),
    fiscalTotal: number_(r.fiscal_total),
    nonFiscalTotal: number_(r.non_fiscal_total),
    totalRevenue: number_(r.total_revenue),
    bankCards: exactPaymentAmount_(['Банковские карты'], 'fiscal'),
    bankCards2: exactPaymentAmount_(['Банковские карты 2'], ''),
    cashNonFiscal: exactPaymentAmount_(['Наличка'], 'non_fiscal'),
    cashFiscal: exactPaymentAmount_(['Оплата наличными','Наличные'], 'fiscal'),
    cash2: exactPaymentAmount_(['Наличка 2','Наличные 2'], 'non_fiscal'),
    tapper: exactPaymentAmount_(['Tapper'], ''),
    settlementAccount: exactPaymentAmount_(['Расчётный счёт','Расчетный счет'], ''),
    settlementAccount2: exactPaymentAmount_(['Расчётный счёт 2','Расчетный счет 2'], ''),
    onlineCashbox2: exactPaymentAmount_(['Онлайн-Касса 2','Онлайн касса 2'], ''),
    collectionAmount: number_(r.collection_amount),
    collectionActual: number_(r.collection_actual),
    paymentRows: paymentRows,
    terminalSlips: slips,
    notes: String(r.notes || '').trim(),
    pagesCount: pagesCount
  };
}

function sendCashReportToTelegram_(p, auth) {
  const jobId = requiredString_(p.jobId, 'jobId');
  const job = getJobRow_(jobId);
  if (!job) throw new Error('Задание не найдено.');
  if (String(job['Telegram User ID']) !== String(auth.userId)) throw new Error('Это задание создано другим пользователем.');
  if (!jobMatchesTelegramRoute_(job, auth) || String(job['Режим'] || '') !== cashReportJobMode_(auth)) {
    throw new Error('Этот кассовый отчёт относится к другому боту.');
  }
  const current = String(job['Статус'] || '');
  // Повторная отправка разрешена: пользователь может исправить сообщение и отправить его снова.
  if (['DONE','SEND_ERROR','CASH_SENT'].indexOf(current) < 0) throw new Error('Кассовый отчёт ещё не готов.');
  const messageText = requiredString_(p.messageText, 'messageText');
  if (messageText.length > 4000) throw new Error('Сообщение слишком длинное для Telegram.');

  updateJob_(jobId, { status: 'SENDING', step: 'Отправляю кассовый отчёт в Telegram', progress: 0.45, error: '' });
  const route = telegramRouteConfig_(auth);
  const token = route.botToken;
  if (!token) throw new Error('В Script Properties не задан ' + route.tokenProperty + '.');
  const targetChatId = String(route.targetChatId || auth.chatId || auth.userId);
  const sent = sendCashStyledTelegram_(token, targetChatId, messageText, auth.venue);
  updateJob_(jobId, {
    status: 'CASH_SENT',
    step: sent.usedFallback ? 'Кассовый отчёт отправлен без custom emoji' : 'Кассовый отчёт отправлен в Telegram',
    progress: 1,
    error: sent.usedFallback ? sent.warning : ''
  });
}

function sendCashStyledTelegram_(token, targetChatId, messageText, venue) {
  const html = buildCashTelegramHtml_(messageText, venue);
  const styled = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    payload: {
      chat_id: targetChatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    },
    muteHttpExceptions: true
  });
  const code = styled.getResponseCode();
  const body = parseJsonSafe_(styled.getContentText());
  if (code >= 200 && code < 300 && body.ok) return { ok: true, usedFallback: false };

  // Чтобы кассовый отчёт не потерялся, при ограничении custom emoji
  // отправляем тот же текст обычным сообщением.
  const plain = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    payload: { chat_id: targetChatId, text: messageText, disable_web_page_preview: true },
    muteHttpExceptions: true
  });
  const plainBody = parseJsonSafe_(plain.getContentText());
  if (plain.getResponseCode() < 200 || plain.getResponseCode() >= 300 || !plainBody.ok) {
    throw new Error('Telegram не принял отчёт: ' + (plainBody.description || body.description || ('HTTP ' + plain.getResponseCode())));
  }
  return { ok: true, usedFallback: true, warning: String(body.description || 'Custom emoji не приняты Telegram.') };
}

function buildCashTelegramHtml_(messageText, venue) {
  if (normalizeTelegramVenue_(venue) === 'tatooine') return buildTatooineCashTelegramHtml_(messageText);
  const props = PropertiesService.getScriptProperties();
  const style = {
    logoF: props.getProperty('CASH_EMOJI_LOGO_F') || '',
    logoO: props.getProperty('CASH_EMOJI_LOGO_O') || '',
    logoX: props.getProperty('CASH_EMOJI_LOGO_X') || '',
    bullet: props.getProperty('CASH_EMOJI_BULLET') || '',
    alleyLeft: props.getProperty('CASH_EMOJI_ALLEY_LEFT') || '',
    alleyRight: props.getProperty('CASH_EMOJI_ALLEY_RIGHT') || '',
    report: props.getProperty('CASH_EMOJI_REPORT') || ''
  };
  const lines = String(messageText || '').replace(/\r/g, '').split('\n');
  return lines.map(function(raw, index) {
    const line = String(raw || '');
    const trimmed = line.trim();
    if (!trimmed) return '';

    if (index === 0 || /^(?:FO[’']X|🔤🔤[’']?🔤)$/i.test(trimmed)) {
      return cashCustomEmojiHtml_(style.logoF, '🔤') + cashCustomEmojiHtml_(style.logoO, '🔤') + "'" + cashCustomEmojiHtml_(style.logoX, '🔤');
    }
    if (/АЛЛЕЯ/i.test(trimmed)) {
      return '<blockquote>' + cashCustomEmojiHtml_(style.alleyLeft, '🦊') + ' АЛЛЕЯ ' + cashCustomEmojiHtml_(style.alleyRight, '🌳') + '</blockquote>';
    }
    if (/ОТЧ[ЕЁ]Т\s+КАССОВОЙ\s+СМЕНЫ/i.test(trimmed)) {
      return cashCustomEmojiHtml_(style.report, '👨‍💻') + ' ' + escapeTelegramHtml_(trimmed.replace(/^\S+\s*/, ''));
    }
    if (/^ДАТА\s+/i.test(trimmed)) return '<i>' + escapeTelegramHtml_(trimmed) + '</i>';
    if (/^Общая выручка:/i.test(trimmed)) return '<b>' + escapeTelegramHtml_(trimmed) + '</b>';
    if (/^Расход:/i.test(trimmed)) {
      return '<b>Расход:</b>' + escapeTelegramHtml_(trimmed.slice(trimmed.indexOf(':') + 1));
    }
    if (/^Инкассация:/i.test(trimmed)) return '<b>' + escapeTelegramHtml_(trimmed) + '</b>';
    if (/^(?:🟢\s*)?Предоплата:/i.test(trimmed)) {
      const rest = trimmed.replace(/^🟢\s*/, '');
      const colon = rest.indexOf(':');
      return cashCustomEmojiHtml_(style.bullet, '🟢') + ' <b>' + escapeTelegramHtml_(rest.slice(0, colon + 1)) + '</b>' + escapeTelegramHtml_(rest.slice(colon + 1));
    }
    if (/^🟢/.test(trimmed)) {
      return cashCustomEmojiHtml_(style.bullet, '🟢') + escapeTelegramHtml_(trimmed.replace(/^🟢\s*/, ''));
    }
    return escapeTelegramHtml_(line);
  }).join('\n');
}

function buildTatooineCashTelegramHtml_(messageText) {
  const props = PropertiesService.getScriptProperties();
  const style = {
    logo: String(props.getProperty('TATOOINE_CASH_EMOJI_LOGO_IDS') || '').split(',').map(function(x) { return x.trim(); }).filter(Boolean),
    locationLeft: props.getProperty('TATOOINE_CASH_EMOJI_LOCATION_LEFT') || '',
    locationRight: props.getProperty('TATOOINE_CASH_EMOJI_LOCATION_RIGHT') || '',
    report: props.getProperty('TATOOINE_CASH_EMOJI_REPORT') || '',
    revenue: props.getProperty('TATOOINE_CASH_EMOJI_REVENUE') || '',
    cashless: props.getProperty('TATOOINE_CASH_EMOJI_CASHLESS') || '',
    cash: props.getProperty('TATOOINE_CASH_EMOJI_CASH') || '',
    online: props.getProperty('TATOOINE_CASH_EMOJI_ONLINE') || '',
    eatAndSplit: props.getProperty('TATOOINE_CASH_EMOJI_EATANDSPLIT') || '',
    yandex: props.getProperty('TATOOINE_CASH_EMOJI_YANDEX') || '',
    expense: props.getProperty('TATOOINE_CASH_EMOJI_EXPENSE') || '',
    collection: props.getProperty('TATOOINE_CASH_EMOJI_COLLECTION') || '',
    change: props.getProperty('TATOOINE_CASH_EMOJI_CHANGE') || '',
    prepayments: props.getProperty('TATOOINE_CASH_EMOJI_PREPAYMENTS') || ''
  };
  const iconForLine_ = function(trimmed) {
    if (/^Общая выручка:/i.test(trimmed)) return [style.revenue, '🪙'];
    if (/^Безнал(?:\s+2)?:/i.test(trimmed)) return [style.cashless, '🧪'];
    if (/^Нал(?:\s+2)?:/i.test(trimmed)) return [style.cash, '🧪'];
    if (/^Онлайн касса 2:/i.test(trimmed)) return [style.online, '🧪'];
    if (/^EatAndSplit:/i.test(trimmed)) return [style.eatAndSplit, '📈'];
    if (/^Яндекс еда:/i.test(trimmed)) return [style.yandex, '🌎'];
    if (/^Расход:/i.test(trimmed)) return [style.expense, '💀'];
    if (/^Инкассация:/i.test(trimmed)) return [style.collection, '🧪'];
    if (/^Неизменный размен/i.test(trimmed)) return [style.change, '🔠'];
    if (/^Предоплаты:/i.test(trimmed)) return [style.prepayments, '🔄'];
    return null;
  };
  const stripLeadingIcon_ = function(value) {
    return String(value || '').replace(/^(?:🪙|🧪|📈|🌎|💀|🔠|🔄)\s*/u, '');
  };
  const lines = String(messageText || '').replace(/\r/g, '').split('\n');
  return lines.map(function(raw, index) {
    const line = String(raw || '');
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (index === 0 && /^TATOOINE$/i.test(trimmed)) {
      if (style.logo.length >= trimmed.length) {
        return trimmed.split('').map(function(_, i) { return cashCustomEmojiHtml_(style.logo[i], '🔤'); }).join('');
      }
      return '<b>TATOOINE</b>';
    }
    if (/ПЕТРОВКА/i.test(trimmed)) {
      return '<blockquote>' + cashCustomEmojiHtml_(style.locationLeft, '🦊') + ' ПЕТРОВКА  ' + cashCustomEmojiHtml_(style.locationRight, '🦊') + '</blockquote>';
    }
    if (/ОТЧ[ЕЁ]Т\s+КАССОВОЙ\s+СМЕНЫ/i.test(trimmed)) {
      return cashCustomEmojiHtml_(style.report, '📈') + escapeTelegramHtml_(trimmed.replace(/^📈\s*/u, ''));
    }
    if (/^ДАТА:/i.test(trimmed)) return '<i>' + escapeTelegramHtml_(trimmed) + '</i>';
    const plain = stripLeadingIcon_(trimmed);
    const icon = iconForLine_(plain);
    if (icon) {
      const colon = plain.indexOf(':');
      const label = colon >= 0 ? plain.slice(0, colon + 1) : plain;
      const value = colon >= 0 ? plain.slice(colon + 1) : '';
      if (/^Общая выручка:/i.test(plain)) {
        return cashCustomEmojiHtml_(icon[0], icon[1]) + '<b>' + escapeTelegramHtml_(plain) + '</b>';
      }
      if (/^(?:Расход|Инкассация):/i.test(plain)) {
        return cashCustomEmojiHtml_(icon[0], icon[1]) + ' <b>' + escapeTelegramHtml_(label.slice(0, -1)) + '</b>:' + escapeTelegramHtml_(value);
      }
      const compact = /^(?:EatAndSplit|Яндекс еда|Предоплаты):/i.test(plain);
      return cashCustomEmojiHtml_(icon[0], icon[1]) + (compact ? '' : ' ') + escapeTelegramHtml_(plain);
    }
    return escapeTelegramHtml_(line);
  }).join('\n');
}

function cashCustomEmojiHtml_(id, fallback) {
  const safeFallback = escapeTelegramHtml_(fallback);
  return id ? '<tg-emoji emoji-id="' + String(id).replace(/[^0-9]/g, '') + '">' + safeFallback + '</tg-emoji>' : safeFallback;
}

function escapeTelegramHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function recognizePdfWithGemini_(pdfBase64, pagesCount, scanMode) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('В Script Properties не задан GEMINI_API_KEY.');
  const model = normalizeGeminiModel_(props.getProperty('GEMINI_MODEL') || FOX_RECEIPTS.defaultGeminiModel);
  scanMode = normalizeScanMode_(scanMode);

  let mediaParts;
  if (Array.isArray(pdfBase64)) {
    if (!pdfBase64.length) throw new Error('Не переданы изображения для Gemini.');
    mediaParts = pdfBase64.map(function(img) {
      return { inlineData:{ mimeType:String(img.mimeType || 'image/jpeg'), data:cleanBase64_(img.data) } };
    });
  } else {
    pdfBase64 = cleanPdfBase64_(pdfBase64);
    if (!pdfBase64 || pdfBase64.length < 100) throw new Error('PDF пустой или повреждён до отправки в Gemini.');
    if (pdfBase64.indexOf('JVBERi0') !== 0) {
      throw new Error('Переданный файл не похож на PDF. Пересними страницы и повтори.');
    }
    mediaParts = [{ inlineData:{ mimeType:'application/pdf', data:pdfBase64 } }];
  }

  const catalogText = readStockCatalog_().map(function(x) { return x.sheet + ' | ' + x.name; }).join('\n');
  let prompt;
  if (scanMode === 'check') {
    prompt = [
      'Ты распознаёшь кассовый, фискальный или онлайн-чек для бара FO’X.',
      'PDF содержит ' + pagesCount + ' страниц/кадров. Все относятся к ОДНОЙ покупке.',
      'Верни только JSON-объект без Markdown и пояснений.',
      'Если поле не видно — оставь строку пустой, число 0, массив []. Ничего не выдумывай.',
      'document_date — дата покупки строго ДД.ММ.ГГГГ.',
      'payment_card — банк и последние 4 цифры карты, например «Тинькофф 8064». Не выдумывай цифры.',
      'purchase_channel — ровно «Покупка в Ozon», если это Ozon; иначе «Покупка в магазине»; для другой явной онлайн-площадки можно «Покупка онлайн».',
      'purchase_summary — ОДНА короткая понятная строка: товар + общее количество/вес/объём.',
      'Для одинаковых бутылок суммируй общий объём: 24 × 0,33 л = 7,92 л.',
      'Нормализуй названия кратко. Примеры: «Радебергер Пилснер 7,92 л», «Циндао Вит 3,96 л», «Просекко Фиорино д’Оро 3 л», «Ром Demon\'s Share 0,7 л», «Лимоны 2,102 кг».',
      'merchant — магазин/продавец, если виден.',
      'total_amount — итог к оплате.',
      'items — товарные строки для возможного стока. Доставка и услуги помечай is_service=true.',
      'Для каждой строки извлеки количество, единицу, цену за единицу с НДС и сумму с НДС.',
      'suggested_stock_name выбирай только из каталога ниже либо оставляй пустым.',
      'supplier_full/supplier_short могут содержать продавца, real_document_types = [«Кассовый чек»] или точный тип.',
      '', 'КАТАЛОГ СТОКА FO’X (лист | точное наименование):', catalogText
    ].join('\n');
  } else {
    prompt = [
      'Ты распознаёшь комплект документов поставки для бара FO’X.',
      'PDF содержит ' + pagesCount + ' страниц. Все страницы относятся к ОДНОЙ поставке.',
      'Верни только JSON-объект без Markdown и пояснений.',
      'Найди реальные типы документов и не дублируй товары между счётом, УПД, накладной и чеками.',
      'document_date: дата счёта на оплату; если его нет — дата основной накладной/фактической выдачи.',
      'receipt_date — дата фактической отгрузки/приёмки, иначе document_date.',
      'supplier_full — юридическое название; supplier_short — короткое название для Telegram.',
      'Примеры: ИП Андреев Алексей Владимирович → ИП Андреев; ООО АСТ-интернэшнл → АСТ; ИП Шамрай → ИП Шамрай; ООО АГРОБАР ЭКСПРЕСС → Агробар; ООО Винтрест-В → Винтрест; ООО ВИНТРЕНД РИТЕЙЛ ГРУПП → Винтренд Ритейл Групп.',
      'Для каждой строки извлеки количество, единицу, цену за единицу с НДС и сумму с НДС. Доставка и услуги: is_service=true.',
      'suggested_stock_name выбирай только из каталога ниже либо оставляй пустым.',
      'Даты строго ДД.ММ.ГГГГ. Неизвестно: строка "", число 0, массив [].',
      '', 'КАТАЛОГ СТОКА FO’X (лист | точное наименование):', catalogText
    ].join('\n');
  }

  const schema = buildGeminiResponseSchema_();
  const parts = mediaParts.concat([{ text: prompt }]);

  // Первый запрос: официальный OpenAPI responseSchema для Gemini 3.5.
  const structuredBody = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.1,
      maxOutputTokens: 8192
    }
  };

  try {
    return parseGeminiJsonResult_(callGeminiGenerateContent_(apiKey, model, structuredBody).text);
  } catch (firstError) {
    // Совместимый резерв: некоторые проекты отклоняют сложную схему с INVALID_ARGUMENT.
    if (!/INVALID_ARGUMENT|invalid argument|HTTP 400/i.test(errorText_(firstError))) throw firstError;
    const fallbackBody = {
      contents: [{ role: 'user', parts: parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 8192
      }
    };
    try {
      return parseGeminiJsonResult_(callGeminiGenerateContent_(apiKey, model, fallbackBody).text);
    } catch (fallbackError) {
      throw new Error(
        'Gemini отклонил запрос. Основная попытка: ' + errorText_(firstError) +
        ' | Резервная попытка: ' + errorText_(fallbackError)
      );
    }
  }
}

function buildGeminiResponseSchema_() {
  return {
    type: 'OBJECT',
    properties: {
      document_date:{type:'STRING'}, receipt_date:{type:'STRING'}, supplier_full:{type:'STRING'}, supplier_short:{type:'STRING'},
      document_number:{type:'STRING'}, real_document_types:{type:'ARRAY',items:{type:'STRING'}}, total_amount:{type:'NUMBER'}, currency:{type:'STRING'}, notes:{type:'STRING'},
      payment_card:{type:'STRING'}, purchase_channel:{type:'STRING'}, purchase_summary:{type:'STRING'}, merchant:{type:'STRING'},
      items:{type:'ARRAY',items:{type:'OBJECT',properties:{raw_name:{type:'STRING'},quantity:{type:'NUMBER'},unit:{type:'STRING'},unit_price_vat:{type:'NUMBER'},total_vat:{type:'NUMBER'},is_service:{type:'BOOLEAN'},suggested_stock_name:{type:'STRING'},notes:{type:'STRING'}},required:['raw_name','quantity','unit','unit_price_vat','total_vat','is_service','suggested_stock_name','notes']}}
    },
    required:['document_date','receipt_date','supplier_full','supplier_short','document_number','real_document_types','total_amount','currency','notes','payment_card','purchase_channel','purchase_summary','merchant','items']
  };
}

function callGeminiGenerateContent_(apiKey, model, body) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {'x-goog-api-key': apiKey},
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const raw = response.getContentText();
  const data = parseJsonSafe_(raw);
  if (status < 200 || status >= 300) {
    const err = data && data.error ? data.error : {};
    const details = err.details ? ' details=' + JSON.stringify(err.details).slice(0, 1200) : '';
    throw new Error('Gemini API HTTP ' + status + ' ' + (err.status || '') + ': ' + (err.message || raw.slice(0, 800)) + details);
  }
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content ? data.candidates[0].content.parts || [] : [];
  const text = parts.map(function(part){ return part.text || ''; }).join('').trim();
  if (!text) throw new Error('Gemini не вернул текст результата. Ответ: ' + raw.slice(0, 800));
  return { text: text, data: data };
}

function parseGeminiJsonResult_(text) {
  text = String(text || '').trim();
  if (text.indexOf('```') === 0) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  try { return JSON.parse(text); }
  catch (e) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(text.slice(first, last + 1)); } catch (_) {}
    }
    throw new Error('Gemini вернул некорректный JSON: ' + e.message + '. Начало ответа: ' + text.slice(0, 500));
  }
}

function isPdfBytes_(bytes) {
  if (!bytes || bytes.length < 5) return false;
  const signature = [0,1,2,3,4].map(function(i) {
    const value = Number(bytes[i]);
    return String.fromCharCode(value < 0 ? value + 256 : value);
  }).join('');
  return signature === '%PDF-';
}

function cleanPdfBase64_(value) {
  let s = String(value || '').trim();
  const comma = s.indexOf(',');
  if (/^data:application\/pdf;base64,/i.test(s) && comma >= 0) s = s.slice(comma + 1);
  return s.replace(/\s+/g, '');
}

function normalizeGeminiModel_(value) {
  return String(value || FOX_RECEIPTS.defaultGeminiModel).trim().replace(/^models\//, '');
}

function sanitizeRecognition_(r, pagesCount, scanMode) {
  r = r && typeof r === 'object' ? r : {};
  scanMode = normalizeScanMode_(scanMode);
  return {
    scanMode: scanMode,
    documentDate: normalizeDate_(r.document_date), receiptDate: normalizeDate_(r.receipt_date || r.document_date),
    supplierFull: String(r.supplier_full || '').trim(), supplierShort: String(r.supplier_short || '').trim(),
    documentNumber: String(r.document_number || '').trim(), realDocumentTypes: Array.isArray(r.real_document_types) ? r.real_document_types.map(String).filter(Boolean) : [],
    totalAmount: number_(r.total_amount), currency: String(r.currency || 'RUB').trim(), notes: String(r.notes || '').trim(), pagesCount: pagesCount,
    paymentCard: String(r.payment_card || '').trim(), purchaseChannel: normalizePurchaseChannel_(r.purchase_channel),
    purchaseSummary: String(r.purchase_summary || '').trim(), merchant: String(r.merchant || '').trim(),
    items: Array.isArray(r.items) ? r.items.map(function(item) { return {
      rawName:String(item.raw_name||'').trim(), quantity:number_(item.quantity), unit:String(item.unit||'').trim(), unitPriceVat:number_(item.unit_price_vat), totalVat:number_(item.total_vat), isService:!!item.is_service, suggestedStockName:String(item.suggested_stock_name||'').trim(), notes:String(item.notes||'').trim()
    }; }).filter(function(item){return item.rawName;}) : []
  };
}

function matchReceiptItems_(items, supplierShort) {
  const catalog = readStockCatalog_();
  const mappings = readMappings_();

  return items.map(function(item) {
    const rawNorm = normalizeText_(item.rawName);
    const supplierNorm = normalizeText_(supplierShort);
    let bestMap = null;
    let bestMapScore = 0;

    mappings.forEach(function(m) {
      const supplierScore = !m.supplierNorm ? 1 : textSimilarity_(supplierNorm, m.supplierNorm);
      if (supplierScore < 0.55) return;
      const nameScore = textSimilarity_(rawNorm, m.sourceNorm);
      const score = supplierScore * 0.25 + nameScore * 0.75;
      if (score > bestMapScore) {
        bestMapScore = score;
        bestMap = m;
      }
    });

    if (bestMap && bestMapScore >= 0.72) {
      const coefficient = number_(bestMap.coefficient) || 1;
      const excluded = bestMap.exclude || item.isService;
      return Object.assign({}, item, {
        stockSheet: bestMap.stockSheet || '',
        stockName: bestMap.stockName || '',
        stockUnit: bestMap.stockUnit || item.unit,
        coefficient: coefficient,
        stockQuantity: item.quantity * coefficient,
        stockUnitPrice: coefficient > 0 ? item.unitPriceVat / coefficient : item.unitPriceVat,
        include: !excluded && !!bestMap.stockSheet && !!bestMap.stockName,
        excluded: excluded,
        needsReview: String(bestMap.confirmed).toUpperCase() !== 'YES',
        matchSource: 'MAPPING',
        matchConfidence: Math.round(bestMapScore * 100) / 100,
        notes: [item.notes, bestMap.comment].filter(Boolean).join(' · ')
      });
    }

    const exact = catalog.filter(function(x) {
      return normalizeText_(x.name) === rawNorm;
    })[0];
    if (exact) {
      return Object.assign({}, item, {
        stockSheet: exact.sheet,
        stockName: exact.name,
        stockUnit: exact.unit || item.unit,
        coefficient: 1,
        stockQuantity: item.quantity,
        stockUnitPrice: item.unitPriceVat,
        include: !item.isService,
        excluded: item.isService,
        needsReview: false,
        matchSource: 'EXACT_STOCK',
        matchConfidence: 1
      });
    }

    const aiExact = catalog.filter(function(x) {
      return item.suggestedStockName && normalizeText_(x.name) === normalizeText_(item.suggestedStockName);
    })[0];
    if (aiExact) {
      return Object.assign({}, item, {
        stockSheet: aiExact.sheet,
        stockName: aiExact.name,
        stockUnit: aiExact.unit || item.unit,
        coefficient: 1,
        stockQuantity: item.quantity,
        stockUnitPrice: item.unitPriceVat,
        include: !item.isService,
        excluded: item.isService,
        needsReview: true,
        matchSource: 'AI_SUGGESTION',
        matchConfidence: 0.7
      });
    }

    let best = null;
    let score = 0;
    catalog.forEach(function(x) {
      const s = textSimilarity_(rawNorm, normalizeText_(x.name));
      if (s > score) { score = s; best = x; }
    });

    return Object.assign({}, item, {
      stockSheet: best && score >= 0.78 ? best.sheet : '',
      stockName: best && score >= 0.78 ? best.name : '',
      stockUnit: best && score >= 0.78 ? (best.unit || item.unit) : item.unit,
      coefficient: 1,
      stockQuantity: item.quantity,
      stockUnitPrice: item.unitPriceVat,
      include: false,
      excluded: item.isService,
      needsReview: true,
      matchSource: best && score >= 0.78 ? 'FUZZY_SUGGESTION' : 'UNMATCHED',
      matchConfidence: Math.round(score * 100) / 100
    });
  });
}

function readStockCatalog_() {
  const ss = getSpreadsheet_();
  const out = [];

  FOX_RECEIPTS.stockSheets.forEach(function(sheetName) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return;
    const lastRow = sh.getLastRow();
    if (lastRow < FOX_RECEIPTS.firstDataRow) return;
    const values = sh.getRange(
      FOX_RECEIPTS.firstDataRow,
      1,
      lastRow - FOX_RECEIPTS.firstDataRow + 1,
      8
    ).getValues();

    values.forEach(function(row, i) {
      const name = String(row[0] || '').trim();
      if (!name || name.indexOf('🏭') === 0) return;
      out.push({
        sheet: sheetName,
        name: name,
        row: FOX_RECEIPTS.firstDataRow + i,
        price: number_(row[FOX_RECEIPTS.cols.price - 1]),
        unit: String(row[FOX_RECEIPTS.cols.unit - 1] || '').trim()
      });
    });
  });

  return out;
}

function readMappings_() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(FOX_RECEIPTS.sheets.mappings);
  if (!sh || sh.getLastRow() < 3) return [];
  const rows = sh.getRange(3, 1, sh.getLastRow() - 2, 10).getValues();
  return rows.map(function(r) {
    return {
      supplier: String(r[0] || '').trim(),
      supplierNorm: normalizeText_(r[0]),
      sourceName: String(r[1] || '').trim(),
      sourceNorm: normalizeText_(r[2] || r[1]),
      stockSheet: String(r[3] || '').trim(),
      stockName: String(r[4] || '').trim(),
      stockUnit: String(r[5] || '').trim(),
      coefficient: number_(r[6]) || 1,
      exclude: String(r[7] || '').toUpperCase() === 'YES',
      comment: String(r[8] || '').trim(),
      confirmed: String(r[9] || '').trim()
    };
  }).filter(function(x) { return x.sourceNorm; });
}

function findStockRow_(sh, stockName) {
  const target = normalizeText_(stockName);
  const lastRow = sh.getLastRow();
  if (lastRow < FOX_RECEIPTS.firstDataRow) return 0;
  const names = sh.getRange(FOX_RECEIPTS.firstDataRow, 1, lastRow - FOX_RECEIPTS.firstDataRow + 1, 1).getValues();
  for (let i = 0; i < names.length; i++) {
    const name = String(names[i][0] || '').trim();
    if (!name || name.indexOf('🏭') === 0) continue;
    if (normalizeText_(name) === target) return FOX_RECEIPTS.firstDataRow + i;
  }
  return 0;
}

function buildTelegramMessage_(date, supplierShort, warehouse) {
  return [normalizeDate_(date) || dateStamp_(new Date()), String(supplierShort || 'Поставщик').trim(), FOX_RECEIPTS.messageDocumentType, normalizeWarehouse_(warehouse)].join('\n');
}
function buildTelegramMessageForResult_(r, warehouse) {
  r = r || {};
  if (normalizeScanMode_(r.scanMode) !== 'check') return buildTelegramMessage_(r.documentDate, r.supplierShort, warehouse);
  const lines = [normalizeDate_(r.documentDate) || dateStamp_(new Date())];
  lines.push(String(r.paymentCard || '').trim() || 'Карта не указана');
  lines.push(normalizePurchaseChannel_(r.purchaseChannel));
  lines.push(String(r.purchaseSummary || 'Покупка').trim());
  lines.push('Итого: ' + formatTelegramAmount_(r.totalAmount) + ' руб');
  lines.push(normalizeWarehouse_(warehouse));
  return lines.join('\n');
}
function formatTelegramAmount_(value) {
  const n = number_(value); const decimals = Math.abs(n - Math.round(n)) < 0.000001 ? 0 : 2;
  let s = n.toFixed(decimals).replace('.', ',');
  const p = s.split(','); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' '); return p.join(',');
}

function shortSupplierName_(full, suggested) {
  const f = normalizeText_(full);
  if (f.indexOf('андреев') >= 0 && f.indexOf('ип') >= 0) return 'ИП Андреев';
  if (f.indexOf('аст') >= 0 || f.indexOf('ast') >= 0) return 'АСТ';
  if (f.indexOf('шамрай') >= 0) return 'ИП Шамрай';
  if (f.indexOf('агробар') >= 0) return 'Агробар';
  if (f.indexOf('винтрест') >= 0) return 'Винтрест';
  if (f.indexOf('винтренд') >= 0) return 'Винтренд Ритейл Групп';
  return String(suggested || full || 'Поставщик')
    .replace(/^общество с ограниченной ответственностью\s*/i, '')
    .replace(/^ооо\s*/i, '')
    .replace(/[«»"]/g, '')
    .trim();
}

function normalizeTelegramVenue_(value) {
  return String(value || '').trim().toLowerCase() === 'tatooine' ? 'tatooine' : 'fox';
}

function parseTelegramIds_(value, fallback) {
  const ids = String(value || '').split(/[\s,;]+/).map(function(x) { return String(x || '').trim(); }).filter(Boolean);
  return ids.length ? ids : (fallback || []).map(String);
}

function telegramRouteConfig_(value) {
  const venue = normalizeTelegramVenue_(value && typeof value === 'object' ? value.venue : value);
  const props = PropertiesService.getScriptProperties();
  if (venue === 'tatooine') {
    return {
      venue: venue,
      tokenProperty: 'TATOOINE_TELEGRAM_BOT_TOKEN',
      botToken: String(props.getProperty('TATOOINE_TELEGRAM_BOT_TOKEN') || ''),
      targetChatId: String(props.getProperty('TATOOINE_TELEGRAM_TARGET_CHAT_ID') || ''),
      allowedUserIds: parseTelegramIds_(props.getProperty('TATOOINE_TELEGRAM_ALLOWED_USER_IDS'), FOX_RECEIPTS.adminTelegramIds),
      allowAllUsers: false,
      allowUnverifiedTestMode: String(props.getProperty('TATOOINE_ALLOW_UNVERIFIED_TEST_MODE') || '').toLowerCase() === 'true'
    };
  }
  return {
    venue: 'fox',
    tokenProperty: 'TELEGRAM_BOT_TOKEN',
    botToken: String(props.getProperty('TELEGRAM_BOT_TOKEN') || ''),
    targetChatId: String(props.getProperty('TELEGRAM_TARGET_CHAT_ID') || ''),
    allowedUserIds: FOX_RECEIPTS.adminTelegramIds.map(String),
    allowAllUsers: FOX_RECEIPTS.allowAllTelegramUsers,
    allowUnverifiedTestMode: String(props.getProperty('ALLOW_UNVERIFIED_TEST_MODE') || '').toLowerCase() === 'true'
  };
}

function assertTelegramActionAllowed_(action, auth) {
  if (!auth || auth.venue !== 'tatooine') return;
  const allowed = ['status', 'cashReportScan', 'cashReportScanImages', 'cashReportSend'];
  if (allowed.indexOf(String(action || '')) < 0) {
    throw new Error('Боту Tatooine доступен только кассовый отчёт.');
  }
}

function cashReportJobMode_(auth) {
  return auth && auth.venue === 'tatooine' ? 'cash_report:tatooine' : 'cash_report';
}

function jobMatchesTelegramRoute_(job, auth) {
  if (!job || !auth) return false;
  const mode = String(job['Режим'] || '');
  if (auth.venue === 'tatooine') return mode === 'cash_report:tatooine';
  return mode !== 'cash_report:tatooine';
}

function jobMatchesTelegramRouteById_(jobId, auth) {
  try { return jobMatchesTelegramRoute_(getJobRow_(jobId), auth); }
  catch (_) { return false; }
}

function authorizeRequest_(p) {
  const route = telegramRouteConfig_(p);
  const botToken = route.botToken;
  const initData = String(p.telegramInitData || '');
  let user = null;
  let chat = null;

  if (botToken && initData) {
    const validation = validateTelegramInitData_(initData, botToken);
    if (!validation.ok) throw new Error('Telegram авторизация не прошла: ' + validation.error);
    user = validation.user;
    chat = validation.chat || null;
  } else if (route.allowUnverifiedTestMode) {
    user = {
      id: String(p.telegramUserId || ''),
      first_name: String(p.telegramUserName || 'TEST')
    };
    chat = p.telegramChatId ? { id: String(p.telegramChatId) } : null;
  } else {
    throw new Error('Нет проверенной Telegram-авторизации. Задай ' + route.tokenProperty + ' в Script Properties.');
  }

  const userId = String(user && user.id || '');
  if (!route.allowAllUsers && route.allowedUserIds.indexOf(userId) < 0) {
    throw new Error('Нет доступа к ' + (route.venue === 'tatooine' ? 'кассовому отчёту Tatooine' : 'приёмке товара') + '. Telegram ID: ' + (userId || 'не определён'));
  }

  const userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || userId;
  const chatId = String(chat && chat.id || '');
  return { userId: userId, userName: userName, chatId: chatId, user: user, chat: chat, venue: route.venue };
}

function decodeTelegramFormPart_(value) {
  // Telegram initData — query string в формате application/x-www-form-urlencoded.
  // В таком формате знак + означает пробел, а decodeURIComponent сам это не делает.
  return decodeURIComponent(String(value || '').replace(/\+/g, ' '));
}

function validateTelegramInitData_(initData, botToken) {
  try {
    const pairs = initData.split('&').map(function(part) {
      const idx = part.indexOf('=');
      return [decodeTelegramFormPart_(idx >= 0 ? part.slice(0, idx) : part), decodeTelegramFormPart_(idx >= 0 ? part.slice(idx + 1) : '')];
    });
    const map = {};
    pairs.forEach(function(kv) { map[kv[0]] = kv[1]; });
    const receivedHash = map.hash;
    if (!receivedHash) return { ok: false, error: 'нет hash' };

    const authDate = Number(map.auth_date || 0);
    if (!authDate) return { ok: false, error: 'нет auth_date' };
    const age = Math.floor(Date.now() / 1000) - authDate;
    if (age < -300 || age > FOX_RECEIPTS.maxAuthAgeSeconds) {
      return { ok: false, error: 'устаревшие initData' };
    }

    // Для проверки через bot token исключаем только hash.
    // Поле signature (Bot API 8.0+) должно участвовать в data-check-string.
    const dataCheck = Object.keys(map)
      .filter(function(k) { return k !== 'hash'; })
      .sort()
      .map(function(k) { return k + '=' + map[k]; })
      .join('\n');

    // Apps Script не поддерживает перегрузку (String, Byte[]).
    // Поэтому обе стороны второго HMAC передаём как UTF-8 байты.
    const secretKey = Utilities.computeHmacSha256Signature(
      Utilities.newBlob(botToken).getBytes(),
      Utilities.newBlob('WebAppData').getBytes()
    );
    const signature = Utilities.computeHmacSha256Signature(
      Utilities.newBlob(dataCheck).getBytes(),
      secretKey
    );
    const calculated = bytesToHex_(signature);
    if (!constantTimeEqual_(calculated, receivedHash)) {
      return { ok: false, error: 'неверная подпись' };
    }

    const user = parseJsonSafe_(map.user || '{}');
    if (!user || !user.id) return { ok: false, error: 'нет пользователя' };
    const chat = parseJsonSafe_(map.chat || '{}');
    return { ok: true, user: user, chat: chat && chat.id ? chat : null };
  } catch (err) {
    return { ok: false, error: errorText_(err) };
  }
}

function createOrResetJob_(jobId, auth, warehouse, pagesCount, scanMode) {
  const ss=getSpreadsheet_();const sh=ss.getSheetByName(FOX_RECEIPTS.sheets.jobs);if(!sh)throw new Error('Не найден лист «Скан_Задания». Запусти setupFoxReceipts().');
  const found=findRowByValue_(sh,1,jobId,3);const row=found||sh.getLastRow()+1;
  sh.getRange(row,1,1,FOX_RECEIPT_HEADERS.jobs.length).setValues([[jobId,'PROCESSING','Загрузка PDF',0.02,'','','',auth.userId,auth.userName,warehouse,pagesCount,found?sh.getRange(row,12).getValue()||new Date():new Date(),new Date(),'',normalizeScanMode_(scanMode)]]);
}

function updateJob_(jobId, patch) {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(FOX_RECEIPTS.sheets.jobs);
  const row = findRowByValue_(sh, 1, jobId, 3);
  if (!row) throw new Error('Задание не найдено: ' + jobId);

  const map = {
    status: 2,
    step: 3,
    progress: 4,
    resultJson: 5,
    pdfFileId: 6,
    pdfUrl: 7,
    error: 14
  };
  Object.keys(patch).forEach(function(key) {
    if (map[key]) sh.getRange(row, map[key]).setValue(patch[key]);
  });
  sh.getRange(row, 13).setValue(new Date());
}

function recordActionError_(jobId, action, message) {
  const row=getJobRow_(jobId);const current=row?String(row['Статус']||''):'';const mode=row?normalizeScanMode_(row['Режим']):'document';
  if(action==='sendTelegram'){
    if(['DONE','CONFIRMED','SENDING','SEND_ERROR'].indexOf(current)>=0){updateJob_(jobId,{status:'SEND_ERROR',step:'Не удалось отправить PDF в Telegram',progress:1,error:message});upsertDocumentRecord_(jobId,{status:'SEND_ERROR',error:message});if(mode==='check')upsertCheckRecord_(jobId,{status:'SEND_ERROR',error:message});return;}
  }
  if(action==='confirm'&&['CONFIRMED','SENT'].indexOf(current)>=0){updateJob_(jobId,{step:'Поступление уже подтверждено',progress:1,error:message});return;}
  failJob_(jobId,message);
}

function failJob_(jobId, message) {
  updateJob_(jobId, {
    status: 'ERROR',
    step: 'Ошибка',
    progress: 1,
    error: message
  });
  upsertDocumentRecord_(jobId, { status: 'ERROR', error: message });
  const job=getJobRow_(jobId);if(job&&normalizeScanMode_(job['Режим'])==='check')upsertCheckRecord_(jobId,{status:'ERROR',error:message});
}

function getJobStatus_(jobId, auth) {
  const row = getJobRow_(jobId);
  if (!row) return { ok: false, error: 'Задание не найдено.' };
  if (String(row['Telegram User ID']) !== String(auth && auth.userId) || !jobMatchesTelegramRoute_(row, auth)) {
    return { ok: false, error: 'Нет доступа к этому заданию.' };
  }
  return {
    ok: true,
    jobId: jobId,
    status: String(row['Статус'] || ''),
    step: String(row['Шаг'] || ''),
    progress: number_(row['Прогресс']),
    result: parseJsonSafe_(String(row['Результат JSON'] || '{}')),
    pdfFileId: String(row['PDF File ID'] || ''),
    pdfUrl: String(row['PDF URL'] || ''),
    error: String(row['Ошибка'] || '')
  };
}

function getJobRow_(jobId) {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(FOX_RECEIPTS.sheets.jobs);
  if (!sh) return null;
  const row = findRowByValue_(sh, 1, jobId, 3);
  if (!row) return null;
  const headers = sh.getRange(2, 1, 1, FOX_RECEIPT_HEADERS.jobs.length).getValues()[0];
  const values = sh.getRange(row, 1, 1, headers.length).getValues()[0];
  const obj = {};
  headers.forEach(function(h, i) { obj[String(h)] = values[i]; });
  obj.__row = row;
  return obj;
}

function upsertDocumentRecord_(jobId, patch) {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(FOX_RECEIPTS.sheets.documents);
  if (!sh) return;
  const row = findRowByValue_(sh, 1, jobId, 3) || sh.getLastRow() + 1;
  const existing = row <= sh.getLastRow() ? sh.getRange(row, 1, 1, FOX_RECEIPT_HEADERS.documents.length).getValues()[0] : new Array(FOX_RECEIPT_HEADERS.documents.length).fill('');
  const h = FOX_RECEIPT_HEADERS.documents;
  const idx = {};
  h.forEach(function(name, i) { idx[name] = i; });
  existing[idx['Job ID']] = jobId;

  const mapping = {
    status: 'Статус', documentDate: 'Дата сообщения', supplierShort: 'Поставщик коротко',
    supplierFull: 'Поставщик полный', realTypes: 'Реальные типы', documentNumber: 'Номер документа',
    warehouse: 'Склад', totalAmount: 'Сумма', pagesCount: 'Кол-во страниц',
    pdfFileId: 'PDF File ID', pdfUrl: 'PDF URL', messageText: 'Сообщение',
    telegramUserId: 'Telegram User ID', telegramUserName: 'Telegram User',
    createdAt: 'Создано', confirmedAt: 'Подтверждено', sentAt: 'Отправлено в Telegram',
    error: 'Ошибка', recognitionJson: 'JSON распознавания', mode: 'Режим', paymentCard: 'Карта / оплата', purchaseChannel: 'Канал покупки', purchaseSummary: 'Краткое описание', merchant: 'Магазин'
  };
  Object.keys(patch).forEach(function(key) {
    const header = mapping[key];
    if (header && idx[header] !== undefined) existing[idx[header]] = patch[key];
  });
  sh.getRange(row, 1, 1, existing.length).setValues([existing]);
}

function upsertCheckRecord_(jobId, patch) {
  const ss=getSpreadsheet_();const sh=ss.getSheetByName(FOX_RECEIPTS.sheets.checks);if(!sh)return;
  const row=findRowByValue_(sh,1,jobId,3)||sh.getLastRow()+1;
  const existing=row<=sh.getLastRow()?sh.getRange(row,1,1,FOX_RECEIPT_HEADERS.checks.length).getValues()[0]:new Array(FOX_RECEIPT_HEADERS.checks.length).fill('');
  const h=FOX_RECEIPT_HEADERS.checks,idx={};h.forEach(function(name,i){idx[name]=i;});existing[idx['Job ID']]=jobId;
  const mapping={status:'Статус',documentDate:'Дата',paymentCard:'Карта / оплата',purchaseChannel:'Канал покупки',purchaseSummary:'Краткое описание',merchant:'Магазин',totalAmount:'Сумма',warehouse:'Склад',pagesCount:'Кол-во страниц',pdfFileId:'PDF File ID',pdfUrl:'PDF URL',messageText:'Сообщение',telegramUserId:'Telegram User ID',telegramUserName:'Telegram User',createdAt:'Создано',confirmedAt:'Внесено в сток',sentAt:'Отправлено в Telegram',error:'Ошибка',recognitionJson:'JSON распознавания'};
  Object.keys(patch||{}).forEach(function(key){const header=mapping[key];if(header&&idx[header]!==undefined)existing[idx[header]]=patch[key];});
  sh.getRange(row,1,1,existing.length).setValues([existing]);
}

function markHistorySent_(jobId, pdfFileId) {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(FOX_RECEIPTS.sheets.receipts);
  if (!sh || sh.getLastRow() < 3) return;
  const values = sh.getRange(3, 1, sh.getLastRow() - 2, FOX_RECEIPT_HEADERS.receipts.length).getValues();
  const fileCol = 21; // U, 1-based
  const sentCol = 25; // Y, 1-based
  values.forEach(function(r, i) {
    if (String(r[fileCol - 1]) === String(pdfFileId)) {
      sh.getRange(i + 3, sentCol).setValue('YES');
    }
  });
}

function ensureServiceSheet_(ss, name, title, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  try { sh.getRange(1, 1, 1, headers.length).breakApart(); } catch (_) {}
  sh.getRange(1, 1, 1, headers.length).merge();
  sh.getRange(1, 1).setValue(title);
  sh.getRange(2, 1, 1, headers.length).setValues([headers]);

  sh.getRange(1, 1, 1, headers.length)
    .setBackground('#203E6B')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontSize(15)
    .setHorizontalAlignment('center');
  sh.getRange(2, 1, 1, headers.length)
    .setBackground('#203E6B')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setWrap(true)
    .setHorizontalAlignment('center');
  sh.setFrozenRows(2);
  return sh;
}

function seedMappingsIfEmpty_(sh) {
  if (!sh || sh.getLastRow() > 2) return;
  const rows = [
    ['Агробар','Сироп ароматизированный со вкусом «Базилик» (Basil Syrup), 1 л','сироп ароматизированный со вкусом базилик basil syrup 1 л','Пюре и сиропы','Сироп Базилик','шт',1,'NO','Подтверждено по примеру Агробар','YES'],
    ['Винтрест',"Джин Гордон'с Лондон Драй Джин 37,5% 0,7/0,76",'джин гордонс лондон драй джин 37 5 0 7','Крепкий алкоголь','Джин Gordons 0.7','бут',1,'NO','ООО «Винтрест-В»','YES'],
    ['Винтрест','Джин «ДРОП ОФ ДЖИНДЖЕР» ОРИГИНАЛЬНЫЙ 40% 0,5/0,6','джин дроп оф джинджер оригинальный 40 0 5 0 6','Крепкий алкоголь','Джин хаус Дроп оф Джинджер (Lockwood)','бут',1,'NO','ООО «Винтрест-В»','YES'],
    ['ИП Шамрай','Доставка','доставка','','','усл',0,'YES','Услуга — не вносить','YES'],
    ['','Радебергер Пилснер','радебергер пилснер','Пиво','«Radeberger» Pilsner, 0.33 л','бут',1,'NO','Покупка по кассовому чеку','YES'],
    ['','Циндао Вит','циндао вит','Пиво','«Tsingtao» Witbier, 0.33 л','бут',1,'NO','Покупка по кассовому чеку','YES'],
    ['',"Ром Demon's Share",'ром demons share','Крепкий алкоголь',"Ром Demon's Share 6 лет",'бут',1,'NO','Покупка по кассовому чеку','YES']
  ];
  sh.getRange(3, 1, rows.length, rows[0].length).setValues(rows);
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActive();
  if (!active) throw new Error('Не задан SPREADSHEET_ID. Запусти setupFoxReceipts().');
  return active;
}

function getReceiptsFolder_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('RECEIPTS_DRIVE_FOLDER_ID');
  if (!id) {
    const folder = DriveApp.createFolder('FO_X_Документы_и_чеки_PDF');
    id = folder.getId();
    props.setProperty('RECEIPTS_DRIVE_FOLDER_ID', id);
  }
  return DriveApp.getFolderById(id);
}

function findRowByValue_(sh, col, value, firstRow) {
  if (!sh || sh.getLastRow() < firstRow) return 0;
  const vals = sh.getRange(firstRow, col, sh.getLastRow() - firstRow + 1, 1).getDisplayValues();
  const target = String(value);
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === target) return firstRow + i;
  }
  return 0;
}

function normalizeScanMode_(value){return String(value||'').toLowerCase()==='check'?'check':'document';}
function normalizePurchaseChannel_(value){const v=normalizeText_(value);if(v.indexOf('ozon')>=0||v.indexOf('озон')>=0)return 'Покупка в Ozon';if(v.indexOf('онлайн')>=0)return 'Покупка онлайн';return 'Покупка в магазине';}

function normalizeWarehouse_(value) {
  const v = normalizeText_(value);
  if (v.indexOf('заготов') >= 0 || v.indexOf('резерв') >= 0) return 'Заготовочный';
  return 'Бар';
}

function normalizeText_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`]/g, '')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textSimilarity_(a, b) {
  a = normalizeText_(a);
  b = normalizeText_(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length) * 0.85 + 0.15;
  }
  const aa = unique_(a.split(' '));
  const bb = unique_(b.split(' '));
  const bSet = {};
  bb.forEach(function(x) { bSet[x] = true; });
  let inter = 0;
  aa.forEach(function(x) { if (bSet[x]) inter++; });
  return inter / Math.max(aa.length, bb.length, 1);
}

function unique_(arr) {
  const seen = {};
  return arr.filter(function(x) {
    if (!x || seen[x]) return false;
    seen[x] = true;
    return true;
  });
}

function normalizeDate_(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = '20' + y;
    return pad2_(m[1]) + '.' + pad2_(m[2]) + '.' + y;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return pad2_(m[3]) + '.' + pad2_(m[2]) + '.' + m[1];
  return s;
}

function parseDateForSheet_(value) {
  const s = normalizeDate_(value);
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return s;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function dateStamp_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd.MM.yyyy');
}

function pad2_(v) {
  return String(v).padStart(2, '0');
}

function number_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = Number(String(v || '').replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}

function truthy_(v) {
  return v === true || v === 1 || String(v).toLowerCase() === 'true' || String(v).toUpperCase() === 'YES';
}

function cleanBase64_(s) {
  return String(s || '')
    .replace(/^data:application\/pdf;base64,/, '')
    .replace(/[\r\n\t]/g, '')
    .replace(/ /g, '+')
    .trim();
}

function safeFileName_(s) {
  return String(s || 'FO_X_document.pdf')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 180);
}

function requiredString_(value, name) {
  const s = String(value == null ? '' : value).trim();
  if (!s) throw new Error('Не заполнено поле: ' + name);
  return s;
}

function parseJson_(s) {
  try { return JSON.parse(s); }
  catch (err) { throw new Error('Некорректный JSON: ' + err.message); }
}

function parseJsonSafe_(s) {
  try { return JSON.parse(String(s || '{}')); }
  catch (_) { return {}; }
}

function errorText_(err) {
  return String(err && err.message ? err.message : err || 'Неизвестная ошибка');
}

function bytesToHex_(bytes) {
  return bytes.map(function(b) {
    const v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function constantTimeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function yesNo_(v) {
  return v ? 'настроено' : 'НЕ НАСТРОЕНО';
}

function safeCallback_(value) {
  const v = String(value || 'callback');
  return /^[A-Za-z_$][0-9A-Za-z_$\.]{0,100}$/.test(v) ? v : 'callback';
}

function jsonpOutput_(callback, obj) {
  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(obj) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function textOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================================
// FO’X v9 — банкетный резерв
// ============================================================================

/**
 * Безопасная настройка банкетного резерва.
 * 1) Создаёт резервную копию текущей Google Таблицы.
 * 2) Создаёт только два служебных листа.
 * 3) Добавляет/использует колонку J «Банкеты».
 * 4) Меняет только формулу B на MAX(0,C-G+J) в товарных строках.
 * Формулы G, значения D/E/F и существующие стили не удаляет.
 */
function setupFoxBanquetReserve() {
  const ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error('Открой Apps Script именно из рабочей Google Таблицы стока.');

  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());

  // Сначала проверяем, что колонка J нигде не занята чужими данными.
  FOX_RECEIPTS.stockSheets.forEach(function(sheetName) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getMaxColumns() < FOX_RECEIPTS.cols.banquet) return;
    const currentHeader = String(sh.getRange(FOX_RECEIPTS.headerRow, FOX_RECEIPTS.cols.banquet).getDisplayValue() || '').trim();
    if (currentHeader && normalizeText_(currentHeader) !== 'банкеты') {
      throw new Error(
        'На листе «' + sheetName + '» колонка J уже занята заголовком «' + currentHeader + '». ' +
        'Настройка не запускалась, данные не изменены.'
      );
    }
  });

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmm');
  const backup = DriveApp.getFileById(ss.getId()).makeCopy(
    ss.getName() + ' — BACKUP перед банкетным резервом ' + stamp
  );

  const reserve = ensureServiceSheet_(
    ss,
    FOX_RECEIPTS.sheets.banquetReserve,
    'FO’X — БАНКЕТНЫЙ РЕЗЕРВ',
    FOX_RECEIPT_HEADERS.banquetReserve
  );
  const jobs = ensureServiceSheet_(
    ss,
    FOX_RECEIPTS.sheets.banquetJobs,
    'FO’X — ЗАДАНИЯ РАСПОЗНАВАНИЯ БАНКЕТОВ',
    FOX_RECEIPT_HEADERS.banquetJobs
  );
  try { jobs.hideSheet(); } catch (_) {}

  let changedSheets = 0;
  FOX_RECEIPTS.stockSheets.forEach(function(sheetName) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return;

    if (sh.getMaxColumns() < FOX_RECEIPTS.cols.banquet) {
      sh.insertColumnsAfter(sh.getMaxColumns(), FOX_RECEIPTS.cols.banquet - sh.getMaxColumns());
    }

    const currentHeader = String(sh.getRange(FOX_RECEIPTS.headerRow, FOX_RECEIPTS.cols.banquet).getDisplayValue() || '').trim();
    if (currentHeader && normalizeText_(currentHeader) !== 'банкеты') {
      throw new Error(
        'На листе «' + sheetName + '» колонка J уже занята заголовком «' + currentHeader + '». ' +
        'Настройка остановлена, данные не перезаписаны.'
      );
    }

    // Копируем только оформление соседней колонки I. Значения не копируются.
    try {
      sh.getRange(FOX_RECEIPTS.headerRow, 9, 1, 1).copyTo(
        sh.getRange(FOX_RECEIPTS.headerRow, FOX_RECEIPTS.cols.banquet, 1, 1),
        SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
        false
      );
    } catch (_) {}
    sh.getRange(FOX_RECEIPTS.headerRow, FOX_RECEIPTS.cols.banquet).setValue('Банкеты');

    const lastRow = sh.getLastRow();
    if (lastRow < FOX_RECEIPTS.firstDataRow) return;

    try {
      sh.getRange(FOX_RECEIPTS.firstDataRow, 9, lastRow - FOX_RECEIPTS.firstDataRow + 1, 1).copyTo(
        sh.getRange(FOX_RECEIPTS.firstDataRow, FOX_RECEIPTS.cols.banquet, lastRow - FOX_RECEIPTS.firstDataRow + 1, 1),
        SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
        false
      );
    } catch (_) {}

    const names = sh.getRange(
      FOX_RECEIPTS.firstDataRow,
      FOX_RECEIPTS.cols.name,
      lastRow - FOX_RECEIPTS.firstDataRow + 1,
      1
    ).getDisplayValues();

    names.forEach(function(row, index) {
      const rowNumber = FOX_RECEIPTS.firstDataRow + index;
      const name = String(row[0] || '').trim();
      const isProduct = !!name && name.indexOf('🏭') !== 0;
      if (!isProduct) return;
      sh.getRange(rowNumber, FOX_RECEIPTS.cols.banquet).setFormula(banquetReserveFormula_(sheetName, rowNumber));
      sh.getRange(rowNumber, 2).setFormula(orderFormula_(rowNumber));
    });
    changedSheets++;
  });

  reserve.autoResizeColumns(1, FOX_RECEIPT_HEADERS.banquetReserve.length);
  SpreadsheetApp.flush();

  SpreadsheetApp.getUi().alert(
    'Готово. Банкетный резерв подключён.\n\n' +
    'Изменено листов стока: ' + changedSheets + '\n' +
    'Создана резервная копия:\n' + backup.getUrl() + '\n\n' +
    'Формула B эквивалентна MAX(0, C-G+J) и не зависит от локали таблицы.\n' +
    'Формула G и значения остатков не изменялись.'
  );
}

function foxBanquetReserveCheck() {
  const ss = getSpreadsheet_();
  const missing = [];
  FOX_RECEIPTS.stockSheets.forEach(function(sheetName) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) { missing.push(sheetName + ': лист не найден'); return; }
    const header = String(sh.getRange(FOX_RECEIPTS.headerRow, FOX_RECEIPTS.cols.banquet).getDisplayValue() || '').trim();
    if (normalizeText_(header) !== 'банкеты') missing.push(sheetName + ': нет заголовка J «Банкеты»');

    const lastRow = sh.getLastRow();
    if (lastRow >= FOX_RECEIPTS.firstDataRow) {
      const values = sh.getRange(
        FOX_RECEIPTS.firstDataRow,
        1,
        lastRow - FOX_RECEIPTS.firstDataRow + 1,
        FOX_RECEIPTS.cols.banquet
      ).getDisplayValues();
      let errorCount = 0;
      values.forEach(function(row, i) {
        const name = String(row[0] || '').trim();
        if (!name || name.indexOf('🏭') === 0) return;
        if (/^#/.test(String(row[1] || '')) || /^#/.test(String(row[9] || ''))) {
          errorCount++;
          if (errorCount <= 3) missing.push(sheetName + ', строка ' + (FOX_RECEIPTS.firstDataRow + i) + ': ошибка формулы B/J');
        }
      });
      if (errorCount > 3) missing.push(sheetName + ': ещё ошибок формул — ' + (errorCount - 3));
    }
  });
  const reserve = ss.getSheetByName(FOX_RECEIPTS.sheets.banquetReserve);
  if (!reserve) missing.push('нет листа «' + FOX_RECEIPTS.sheets.banquetReserve + '»');
  SpreadsheetApp.getUi().alert(
    missing.length ? ('Найдены проблемы:\n- ' + missing.join('\n- ')) : 'Банкетный резерв настроен. Ошибок структуры и формул не найдено.'
  );
}

/**
 * Исправляет только формулы J «Банкеты» и B «ЗАКАЗ».
 * Значения D/E/F, формулу G, названия товаров и стили не меняет.
 * Перед изменением автоматически создаёт резервную копию таблицы.
 */
function repairFoxBanquetReserveFormulas() {
  const ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error('Открой Apps Script именно из рабочей Google Таблицы стока.');
  const reserve = ss.getSheetByName(FOX_RECEIPTS.sheets.banquetReserve);
  if (!reserve) throw new Error('Не найден лист «Банкеты_Резерв». Сначала выполни setupFoxBanquetReserve().');

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmm');
  const backup = DriveApp.getFileById(ss.getId()).makeCopy(
    ss.getName() + ' — BACKUP перед исправлением формул банкетов ' + stamp
  );

  let changedRows = 0;
  FOX_RECEIPTS.stockSheets.forEach(function(sheetName) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return;
    const lastRow = sh.getLastRow();
    if (lastRow < FOX_RECEIPTS.firstDataRow) return;

    const names = sh.getRange(
      FOX_RECEIPTS.firstDataRow,
      FOX_RECEIPTS.cols.name,
      lastRow - FOX_RECEIPTS.firstDataRow + 1,
      1
    ).getDisplayValues();

    names.forEach(function(row, index) {
      const rowNumber = FOX_RECEIPTS.firstDataRow + index;
      const name = String(row[0] || '').trim();
      const isProduct = !!name && name.indexOf('🏭') !== 0;
      if (!isProduct) return;
      sh.getRange(rowNumber, FOX_RECEIPTS.cols.banquet)
        .setNumberFormat('0.###')
        .setFormula(banquetReserveFormula_(sheetName, rowNumber));
      sh.getRange(rowNumber, 2).setFormula(orderFormula_(rowNumber));
      changedRows++;
    });
  });

  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert(
    'Готово. Формулы банкетного резерва исправлены.\n\n' +
    'Обновлено товарных строк: ' + changedRows + '\n' +
    'Колонка J считает по листу и номеру строки без зависимости от локали таблицы.\n' +
    'Значения D/E/F и формула G не изменялись.\n\n' +
    'Резервная копия:\n' + backup.getUrl()
  );
}

function banquetReserveFormula_(sheetName, rowNumber) {
  const escaped = String(sheetName).replace(/"/g, '""');
  const reserveName = FOX_RECEIPTS.sheets.banquetReserve;
  // Формула без разделителей аргументов: одинаково работает при русской и английской локали таблицы.
  // Суммируем колонку L только для активного банкета, нужного листа/строки и неудалённых записей.
  return '=SUMPRODUCT((' +
    '\'' + reserveName + '\'!$G$3:$G$5000="' + escaped + '")*(' +
    '\'' + reserveName + '\'!$H$3:$H$5000=ROW())*(' +
    '\'' + reserveName + '\'!$D$3:$D$5000="Актуально")*(' +
    '\'' + reserveName + '\'!$Q$3:$Q$5000<>"YES")*' +
    '\'' + reserveName + '\'!$L$3:$L$5000)';
}

function orderFormula_(rowNumber) {
  // Эквивалент MAX(0; C-G+J), но без запятых/точек с запятой — не зависит от локали Google Sheets.
  const x = '(C' + rowNumber + '-G' + rowNumber + '+J' + rowNumber + ')';
  return '=(' + x + '+ABS' + x + ')/2';
}

function assertBanquetAdmin_(auth) {
  const admins = FOX_RECEIPTS.adminTelegramIds.map(String);
  if (!auth || admins.indexOf(String(auth.userId || '')) < 0) {
    throw new Error('Управлять банкетным резервом могут только администраторы FO’X.');
  }
}

function normalizeBanquetStatusForReserve_(status) {
  const v = normalizeText_(status);
  if (['выполнено','пройден','пройдено','завершено'].indexOf(v) >= 0) return 'Выполнено';
  if (['отменено','отменен'].indexOf(v) >= 0) return 'Отменено';
  return 'Актуально';
}

function createBanquetJob_(jobId, banquetId, auth) {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(FOX_RECEIPTS.sheets.banquetJobs);
  if (!sh) throw new Error('Не найден лист «Банкет_Задания». Запусти setupFoxBanquetReserve().');
  const found = findRowByValue_(sh, 1, jobId, 3);
  const row = found || sh.getLastRow() + 1;
  const created = found ? (sh.getRange(row, 9).getValue() || new Date()) : new Date();
  sh.getRange(row, 1, 1, FOX_RECEIPT_HEADERS.banquetJobs.length).setValues([[
    jobId, banquetId, 'PROCESSING', 'Загружаю фото банкета', 0.05, '',
    auth.userId, auth.userName, created, new Date(), ''
  ]]);
}

function updateBanquetJob_(jobId, patch) {
  const sh = getSpreadsheet_().getSheetByName(FOX_RECEIPTS.sheets.banquetJobs);
  const row = findRowByValue_(sh, 1, jobId, 3);
  if (!row) throw new Error('Задание банкета не найдено: ' + jobId);
  const cols = { status:3, step:4, progress:5, resultJson:6, error:11 };
  Object.keys(patch || {}).forEach(function(key) {
    if (cols[key]) sh.getRange(row, cols[key]).setValue(patch[key]);
  });
  sh.getRange(row, 10).setValue(new Date());
}

function failBanquetJob_(jobId, message) {
  updateBanquetJob_(jobId, { status:'ERROR', step:'Ошибка распознавания банкета', progress:1, error:message });
}

function getBanquetJobStatus_(jobId, userId) {
  const sh = getSpreadsheet_().getSheetByName(FOX_RECEIPTS.sheets.banquetJobs);
  if (!sh) return { ok:false, error:'Не найден лист Банкет_Задания.' };
  const row = findRowByValue_(sh, 1, jobId, 3);
  if (!row) return { ok:false, error:'Задание не найдено.' };
  const values = sh.getRange(row, 1, 1, FOX_RECEIPT_HEADERS.banquetJobs.length).getValues()[0];
  if (String(values[6]) !== String(userId)) return { ok:false, error:'Нет доступа к этому заданию.' };
  return {
    ok:true,
    jobId:String(values[0] || ''),
    banquetId:String(values[1] || ''),
    status:String(values[2] || ''),
    step:String(values[3] || ''),
    progress:number_(values[4]),
    result:parseJsonSafe_(String(values[5] || '{}')),
    error:String(values[10] || '')
  };
}

function scanBanquetReserve_(p, auth) {
  const jobId = requiredString_(p.jobId, 'jobId');
  const banquetId = requiredString_(p.banquetId, 'banquetId');
  const imageUrl = requiredString_(p.imageUrl, 'imageUrl');
  const banquetDate = String(p.banquetDate || '').trim();
  const banquetName = String(p.banquetName || 'Банкет').trim();
  const banquetStatus = normalizeBanquetStatusForReserve_(p.banquetStatus);

  createBanquetJob_(jobId, banquetId, auth);
  updateBanquetJob_(jobId, { step:'Распознаю позиции с фото', progress:0.18 });

  const recognition = recognizeBanquetImageWithGemini_(imageUrl);
  updateBanquetJob_(jobId, { step:'Сопоставляю со стоком FO’X', progress:0.65 });

  const matched = matchBanquetItems_(recognition.items || []);
  const summary = saveBanquetReserve_(
    banquetId,
    banquetDate,
    banquetName,
    banquetStatus,
    imageUrl,
    matched,
    recognition.ignored || []
  );

  const result = { summary:summary, ignored:recognition.ignored || [] };
  updateBanquetJob_(jobId, {
    status:'DONE',
    step:'Банкетный резерв сохранён',
    progress:1,
    resultJson:JSON.stringify(result),
    error:''
  });
}

function recognizeBanquetImageWithGemini_(imageUrl) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('В Script Properties не задан GEMINI_API_KEY.');
  const model = normalizeGeminiModel_(props.getProperty('GEMINI_MODEL') || FOX_RECEIPTS.defaultGeminiModel);

  let fetchUrl = String(imageUrl || '').trim();
  if (/res\.cloudinary\.com/i.test(fetchUrl) && fetchUrl.indexOf('/upload/') >= 0) {
    fetchUrl = fetchUrl.replace('/upload/', '/upload/f_jpg,q_auto:good,w_2200/');
  }
  const response = UrlFetchApp.fetch(fetchUrl, { muteHttpExceptions:true, followRedirects:true });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('Фото банкета не загрузилось: HTTP ' + code);
  const blob = response.getBlob();
  const bytes = blob.getBytes();
  if (!bytes || bytes.length < 100) throw new Error('Фото банкета пустое.');
  if (bytes.length > 12 * 1024 * 1024) throw new Error('Фото банкета слишком большое для распознавания.');
  const mimeType = blob.getContentType() || 'image/jpeg';
  const imageBase64 = Utilities.base64Encode(bytes);

  const catalog = readStockCatalog_();
  const catalogText = catalog.map(function(x) {
    return x.sheet + ' | ' + x.name + ' | ' + (x.unit || '');
  }).join('\n');

  const prompt = [
    'Ты распознаёшь фото заказа банкета бара FO’X.',
    'Нужно найти только готовые товарные позиции, которые напрямую существуют в каталоге стока ниже.',
    'Не учитывай коктейли и их порции: Aperol Spritz, Gin Tonic, Margarita, Martini, Negroni, Love Is и любые другие коктейли.',
    'Не раскладывай коктейли на ингредиенты. Не учитывай еду, услуги, мебель, посуду и комментарии.',
    'Для вина, пива, крепкого алкоголя и других готовых товаров извлеки количество, указанное в заказе.',
    'Если одна позиция встречается несколько раз на фото — сложи количество.',
    'suggested_stock_name выбирай только как ТОЧНОЕ наименование из каталога. Если уверенности нет — оставь пустым.',
    'quantity должно быть числом больше нуля. Не выдумывай количество.',
    'Верни только JSON без Markdown.',
    '',
    'КАТАЛОГ СТОКА FO’X (лист | точное наименование | единица):',
    catalogText
  ].join('\n');

  const schema = {
    type:'OBJECT',
    properties:{
      items:{type:'ARRAY',items:{type:'OBJECT',properties:{
        raw_name:{type:'STRING'}, quantity:{type:'NUMBER'}, unit:{type:'STRING'},
        suggested_stock_name:{type:'STRING'}, notes:{type:'STRING'}
      },required:['raw_name','quantity','unit','suggested_stock_name','notes']}},
      ignored:{type:'ARRAY',items:{type:'STRING'}}
    },
    required:['items','ignored']
  };
  const parts = [
    { inlineData:{ mimeType:mimeType, data:imageBase64 } },
    { text:prompt }
  ];
  const body = {
    contents:[{ role:'user', parts:parts }],
    generationConfig:{ responseMimeType:'application/json', responseSchema:schema, temperature:0, maxOutputTokens:4096 }
  };

  let parsed;
  try {
    parsed = parseGeminiJsonResult_(callGeminiGenerateContent_(apiKey, model, body).text);
  } catch (firstError) {
    if (!/INVALID_ARGUMENT|invalid argument|HTTP 400/i.test(errorText_(firstError))) throw firstError;
    parsed = parseGeminiJsonResult_(callGeminiGenerateContent_(apiKey, model, {
      contents:[{ role:'user', parts:parts }],
      generationConfig:{ responseMimeType:'application/json', temperature:0, maxOutputTokens:4096 }
    }).text);
  }

  return {
    items:Array.isArray(parsed.items) ? parsed.items.map(function(item) {
      return {
        rawName:String(item.raw_name || '').trim(),
        quantity:number_(item.quantity),
        unit:String(item.unit || '').trim(),
        suggestedStockName:String(item.suggested_stock_name || '').trim(),
        notes:String(item.notes || '').trim()
      };
    }).filter(function(item) { return item.rawName && item.quantity > 0; }) : [],
    ignored:Array.isArray(parsed.ignored) ? parsed.ignored.map(String).filter(Boolean) : []
  };
}

function isCocktailLike_(name) {
  const n = normalizeText_(name);
  const words = ['коктейль','спритц','spritz','маргарита','margarita','мартини','martini','джин тоник','gin tonic','негрони','negroni','love is','лав из','лонг айленд','long island','попстар','popstar'];
  return words.some(function(word) { return n.indexOf(normalizeText_(word)) >= 0; });
}

function matchBanquetItems_(items) {
  const catalog = readStockCatalog_();
  return (items || []).map(function(item) {
    const rawNorm = normalizeText_(item.rawName);
    const suggestedNorm = normalizeText_(item.suggestedStockName);
    let match = null;
    let confidence = 0;

    if (suggestedNorm) {
      match = catalog.filter(function(x) { return normalizeText_(x.name) === suggestedNorm; })[0] || null;
      if (match) confidence = 1;
    }
    if (!match) {
      match = catalog.filter(function(x) { return normalizeText_(x.name) === rawNorm; })[0] || null;
      if (match) confidence = 1;
    }
    if (!match) {
      let best = null;
      let bestScore = 0;
      catalog.forEach(function(x) {
        const score = textSimilarity_(rawNorm, normalizeText_(x.name));
        if (score > bestScore) { bestScore = score; best = x; }
      });
      if (best && bestScore >= 0.84) { match = best; confidence = bestScore; }
    }

    // Явные коктейли не резервируем, если нет точного совпадения с реальной позицией стока.
    if (isCocktailLike_(item.rawName)) match = null;

    return {
      rawName:item.rawName,
      quantity:number_(item.quantity),
      unit:item.unit,
      stockSheet:match ? match.sheet : '',
      stockRow:match ? match.row : '',
      stockName:match ? match.name : '',
      stockUnit:match ? (match.unit || item.unit) : item.unit,
      confidence:Math.round(confidence * 100) / 100,
      notes:item.notes || (match ? '' : 'Не сопоставлено со стоком')
    };
  });
}

function saveBanquetReserve_(banquetId, banquetDate, banquetName, banquetStatus, imageUrl, items, ignored) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) throw new Error('Таблица сейчас занята. Повтори через минуту.');
  try {
    const ss = getSpreadsheet_();
    const sh = ss.getSheetByName(FOX_RECEIPTS.sheets.banquetReserve);
    if (!sh) throw new Error('Не найден лист «Банкеты_Резерв». Запусти setupFoxBanquetReserve().');

    const previousOrdered = {};
    const previousOrderDates = {};
    const lastRow = sh.getLastRow();
    if (lastRow >= 3) {
      const rows = sh.getRange(3, 1, lastRow - 2, FOX_RECEIPT_HEADERS.banquetReserve.length).getValues();
      rows.forEach(function(r, i) {
        if (String(r[0]) !== String(banquetId) || String(r[16]).toUpperCase() === 'YES') return;
        const key = normalizeText_(r[6]) + '::' + normalizeText_(r[8]);
        if (r[6] && r[8]) {
          previousOrdered[key] = (previousOrdered[key] || 0) + number_(r[10]);
          if (r[19]) previousOrderDates[key] = r[19];
        }
        sh.getRange(i + 3, 17).setValue('YES');
        sh.getRange(i + 3, 16).setValue(new Date());
      });
    }

    const grouped = {};
    (items || []).forEach(function(item) {
      if (!(item.quantity > 0)) return;
      const key = item.stockSheet && item.stockName
        ? normalizeText_(item.stockSheet) + '::' + normalizeText_(item.stockName)
        : 'UNMATCHED::' + normalizeText_(item.rawName);
      if (!grouped[key]) grouped[key] = Object.assign({}, item);
      else grouped[key].quantity += item.quantity;
    });

    const now = new Date();
    const rowsToAppend = [];
    Object.keys(grouped).forEach(function(key) {
      const item = grouped[key];
      const matched = !!item.stockSheet && !!item.stockName;
      const required = number_(item.quantity);
      const ordered = matched ? Math.min(required, number_(previousOrdered[key])) : 0;
      const pending = matched ? Math.max(0, required - ordered) : 0;
      const purchaseStatus = !matched ? 'Не сопоставлено' : (pending <= 0 && ordered > 0 ? 'Заказ отправлен' : (ordered > 0 ? 'Частично заказано' : 'Не заказано'));
      rowsToAppend.push([
        banquetId, banquetDate, banquetName, banquetStatus, purchaseStatus,
        item.rawName, item.stockSheet, item.stockRow, item.stockName,
        required, ordered, pending, item.stockUnit || item.unit, imageUrl,
        now, now, '', item.confidence || 0, item.notes || '', ordered > 0 ? (previousOrderDates[key] || now) : ''
      ]);
    });

    (ignored || []).forEach(function(name) {
      rowsToAppend.push([
        banquetId, banquetDate, banquetName, banquetStatus, 'Игнорируется',
        String(name), '', '', '', 0, 0, 0, '', imageUrl,
        now, now, '', 0, 'Коктейль или позиция вне прямого стока', ''
      ]);
    });

    if (rowsToAppend.length) {
      sh.getRange(sh.getLastRow() + 1, 1, rowsToAppend.length, FOX_RECEIPT_HEADERS.banquetReserve.length).setValues(rowsToAppend);
    }
    SpreadsheetApp.flush();
    return getOneBanquetReserveSummary_(banquetId);
  } finally {
    lock.releaseLock();
  }
}

function setBanquetOrderSent_(banquetId, sent) {
  banquetId = requiredString_(banquetId, 'banquetId');
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) throw new Error('Таблица сейчас занята. Повтори через минуту.');
  try {
    const sh = getSpreadsheet_().getSheetByName(FOX_RECEIPTS.sheets.banquetReserve);
    if (!sh || sh.getLastRow() < 3) throw new Error('Резерв этого банкета не найден. Сначала распознай фото.');
    const rows = sh.getRange(3, 1, sh.getLastRow() - 2, FOX_RECEIPT_HEADERS.banquetReserve.length).getValues();
    let changed = 0;
    rows.forEach(function(r, i) {
      if (String(r[0]) !== String(banquetId) || String(r[16]).toUpperCase() === 'YES') return;
      if (!r[6] || !r[8] || !(number_(r[9]) > 0)) return;
      const required = number_(r[9]);
      sh.getRange(i + 3, 11).setValue(sent ? required : 0);
      sh.getRange(i + 3, 12).setValue(sent ? 0 : required);
      sh.getRange(i + 3, 5).setValue(sent ? 'Заказ отправлен' : 'Не заказано');
      sh.getRange(i + 3, 16).setValue(new Date());
      sh.getRange(i + 3, 20).setValue(sent ? new Date() : '');
      changed++;
    });
    if (!changed) throw new Error('В банкетном резерве нет сопоставленных позиций.');
    SpreadsheetApp.flush();
    return getOneBanquetReserveSummary_(banquetId);
  } finally {
    lock.releaseLock();
  }
}

function setBanquetReserveStatus_(banquetId, status) {
  banquetId = requiredString_(banquetId, 'banquetId');
  const normalized = normalizeBanquetStatusForReserve_(status);
  const sh = getSpreadsheet_().getSheetByName(FOX_RECEIPTS.sheets.banquetReserve);
  if (!sh || sh.getLastRow() < 3) return { banquetId:banquetId, recognized:false };
  const rows = sh.getRange(3, 1, sh.getLastRow() - 2, FOX_RECEIPT_HEADERS.banquetReserve.length).getValues();
  rows.forEach(function(r, i) {
    if (String(r[0]) === String(banquetId) && String(r[16]).toUpperCase() !== 'YES') {
      sh.getRange(i + 3, 4).setValue(normalized);
    }
  });
  SpreadsheetApp.flush();
  return getOneBanquetReserveSummary_(banquetId);
}

function archiveBanquetReserve_(banquetId) {
  banquetId = requiredString_(banquetId, 'banquetId');
  const sh = getSpreadsheet_().getSheetByName(FOX_RECEIPTS.sheets.banquetReserve);
  if (!sh || sh.getLastRow() < 3) return;
  const rows = sh.getRange(3, 1, sh.getLastRow() - 2, FOX_RECEIPT_HEADERS.banquetReserve.length).getValues();
  rows.forEach(function(r, i) {
    if (String(r[0]) === String(banquetId) && String(r[16]).toUpperCase() !== 'YES') {
      sh.getRange(i + 3, 17).setValue('YES');
      sh.getRange(i + 3, 16).setValue(new Date());
    }
  });
  SpreadsheetApp.flush();
}

function getBanquetReserveSummaries_() {
  const sh = getSpreadsheet_().getSheetByName(FOX_RECEIPTS.sheets.banquetReserve);
  if (!sh || sh.getLastRow() < 3) return {};
  const rows = sh.getRange(3, 1, sh.getLastRow() - 2, FOX_RECEIPT_HEADERS.banquetReserve.length).getValues();
  const map = {};
  rows.forEach(function(r) {
    const id = String(r[0] || '').trim();
    if (!id || String(r[16]).toUpperCase() === 'YES') return;
    if (!map[id]) map[id] = {
      banquetId:id, recognized:true, status:String(r[3] || 'Актуально'),
      matchedCount:0, ignoredCount:0, pendingPositions:0, orderedPositions:0,
      orderSent:true, orderSentAt:'', items:[]
    };
    const s = map[id];
    const matched = !!r[6] && !!r[8] && number_(r[9]) > 0;
    if (matched) {
      s.matchedCount++;
      if (number_(r[11]) > 0 && normalizeBanquetStatusForReserve_(r[3]) === 'Актуально') s.pendingPositions++;
      if (number_(r[10]) > 0) s.orderedPositions++;
      if (String(r[4]) !== 'Заказ отправлен') s.orderSent = false;
      if (String(r[4]) === 'Заказ отправлен' && r[19]) {
        const dt = Object.prototype.toString.call(r[19]) === '[object Date]' ? r[19] : new Date(r[19]);
        if (!isNaN(dt.getTime())) s.orderSentAt = Utilities.formatDate(dt, Session.getScriptTimeZone(), 'dd.MM.yyyy');
      }
      s.items.push({
        stockSheet:String(r[6] || ''), stockName:String(r[8] || ''),
        required:number_(r[9]), ordered:number_(r[10]),
        pending:normalizeBanquetStatusForReserve_(r[3]) === 'Актуально' ? number_(r[11]) : 0,
        unit:String(r[12] || '')
      });
    } else {
      s.ignoredCount++;
    }
  });
  Object.keys(map).forEach(function(id) {
    const s = map[id];
    if (!s.matchedCount) s.orderSent = false;
  });
  return map;
}

function getOneBanquetReserveSummary_(banquetId) {
  const map = getBanquetReserveSummaries_();
  return map[String(banquetId)] || { banquetId:String(banquetId), recognized:false, matchedCount:0, ignoredCount:0, pendingPositions:0, orderedPositions:0, orderSent:false, orderSentAt:'', items:[] };
}
