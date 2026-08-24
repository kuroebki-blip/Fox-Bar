/**
 * FO'X Banquets Backend v4 — Status Update
 *
 * Google Apps Script теперь НЕ принимает фото.
 * Mini App загружает фото напрямую в Cloudinary и передаёт сюда только ссылку.
 *
 * Что делает backend:
 * - хранит банкеты в Google Sheets;
 * - отдаёт список банкетов для Mini App;
 * - принимает добавление/удаление банкетов от админов;
 * - обновляет статус существующего банкета без создания дублей.
 *
 * Заполни SPREADSHEET_ID.
 */

const FOXBANQ = {
  SPREADSHEET_ID: '1x5qWkEn05wN9gW6Oz7WKodbohBaTE9Hxh4WtJMDCj1U',
  SHEET_NAME: 'Банкеты',
  ADMIN_TELEGRAM_IDS: [
    1036250074,
    315978242,
    317564157
  ],
  MEDIA_HEADER: 'Media JSON',
  FINAL_AMOUNT_HEADER: 'Итоговая сумма банкета',
  HEADERS: [
    'ID',
    'Дата',
    'Время',
    'Название',
    'Комментарий',
    'Статус',
    'Cloudinary Public ID',
    'Image URL',
    'Добавлено',
    'Telegram User ID',
    'Telegram User Name',
    'Удалено'
  ]
};

function doGet(e) {
  const action = String((e.parameter && e.parameter.action) || 'list');
  const callback = String((e.parameter && e.parameter.callback) || '');

  let result;

  try {
    if (action === 'list') {
      const items = listBanquets_();
      result = { ok: true, items: items, mediaSupported: getMediaColumn_(getSheet_()) > 0 };
    } else if (action === 'ping') {
      result = { ok: true, ts: new Date().toISOString() };
    } else {
      result = { ok: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { ok: false, error: String(err && err.message ? err.message : err) };
  }

  const json = JSON.stringify(result);

  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let result;

  try {
    const p = e.parameter || {};
    const action = String(p.action || '');

    assertAdmin_(p.telegramUserId);

    if (action === 'save') {
      result = { ok: true, item: saveBanquet_(p) };
    } else if (action === 'updateStatus') {
      result = { ok: true, item: updateBanquetStatus_(p.id, p.status) };
    } else if (action === 'delete') {
      result = { ok: true, deleted: deleteBanquet_(p.id) };
    } else if (action === 'updateFinalAmount') {
      result = { ok: true, item: updateBanquetFinalAmount_(p.id, p.finalAmount) };
    } else {
      result = { ok: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { ok: false, error: String(err && err.message ? err.message : err) };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function setupBanquetsBackend() {
  const sh = getSheet_();
  sh.clear();
  sh.getRange(1, 1, 1, FOXBANQ.HEADERS.length).setValues([FOXBANQ.HEADERS]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, FOXBANQ.HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#1F4E78')
    .setFontColor('#ffffff');
  sh.autoResizeColumns(1, FOXBANQ.HEADERS.length);
}

function listBanquets_() {
  const sh = getSheet_();
  ensureHeaders_(sh);
  const mediaColumn = getMediaColumn_(sh);
  const finalAmountColumn = getFinalAmountColumn_(sh, false);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const rows = sh.getRange(2, 1, lastRow - 1, Math.max(FOXBANQ.HEADERS.length, mediaColumn || 0)).getValues();

  return rows
    .filter(r => String(r[0] || '').trim() && String(r[11] || '').trim() !== 'YES')
    .map(function(r) { r.__finalAmountColumn = finalAmountColumn; return banquetClientItem_(r, mediaColumn); })
    .filter(x => x.date);
}

function saveBanquet_(p) {
  return withBanquetLock_(function() {
  const sh = getSheet_();
  ensureHeaders_(sh);

  const id = String(p.id || ('b' + Date.now()));
  const date = String(p.date || '').trim();
  const time = String(p.time || '').trim();
  const name = String(p.name || '').trim();
  const comment = String(p.comment || '').trim();
  const status = String(p.status || 'Актуально').trim();
  const cloudinaryPublicId = String(p.cloudinaryPublicId || '').trim();
  const imageUrl = String(p.imageUrl || '').trim();
  const userId = String(p.telegramUserId || '').trim();
  const userName = String(p.telegramUserName || '').trim();

  if (!date) throw new Error('Не указана дата');
  if (!time) throw new Error('Не указано время');
  if (!name) throw new Error('Не указано название');

  const mediaColumn = getMediaColumn_(sh);
  const rowNumber = findActiveBanquetRowById_(sh, id);
  const existingRow = rowNumber
    ? sh.getRange(rowNumber, 1, 1, Math.max(FOXBANQ.HEADERS.length, mediaColumn || 0)).getValues()[0]
    : null;
  const hasMediaPayload = Object.prototype.hasOwnProperty.call(p, 'mediaJson') || Object.prototype.hasOwnProperty.call(p, 'media');
  const requestedMedia = hasMediaPayload
    ? parseMediaJson_(p.mediaJson || p.media)
    : (existingRow ? mediaFromRow_(existingRow, mediaColumn) : []);
  const media = normalizeMedia_(
    requestedMedia,
    hasMediaPayload || !existingRow ? imageUrl : String(existingRow[7] || ''),
    hasMediaPayload || !existingRow ? cloudinaryPublicId : String(existingRow[6] || '')
  );
  // До подтверждённого добавления Media JSON production-таблица хранит только
  // первое фото в G/H. Массив не записывается в существующие поля.
  const persistedMedia = mediaColumn ? media : normalizeMedia_([], imageUrl, cloudinaryPublicId);
  const primaryMedia = persistedMedia[0] || { url:'', publicId:'' };

  if (rowNumber) {
    // Повторная отправка того же banquetId обновляет запись, а не создаёт дубль.
    // Дату создания и признак удаления сохраняем как исторические поля.
    sh.getRange(rowNumber, 2, 1, 7).setValues([[
      date,
      time,
      name,
      comment,
      status,
      primaryMedia.publicId,
      primaryMedia.url
    ]]);
    sh.getRange(rowNumber, 10, 1, 2).setValues([[userId, userName]]);
    if (mediaColumn) sh.getRange(rowNumber, mediaColumn).setValue(mediaToJson_(persistedMedia));
    SpreadsheetApp.flush();
  } else {
    sh.appendRow([
      id,
      date,
      time,
      name,
      comment,
      status,
      primaryMedia.publicId,
      primaryMedia.url,
      new Date(),
      userId,
      userName,
      ''
    ]);
    if (mediaColumn) sh.getRange(sh.getLastRow(), mediaColumn).setValue(mediaToJson_(persistedMedia));
  }

  const savedRow = [
    id, date, time, name, comment, status,
    primaryMedia.publicId, primaryMedia.url, '', userId, userName, ''
  ];
  const returnedMediaColumn = mediaColumn || FOXBANQ.HEADERS.length + 1;
  savedRow[returnedMediaColumn - 1] = mediaToJson_(persistedMedia);
  return banquetClientItem_(savedRow, returnedMediaColumn);
  });
}

function findActiveBanquetRowById_(sh, id) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  const rows = sh.getRange(2, 1, lastRow - 1, FOXBANQ.HEADERS.length).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0] || '').trim() === id && String(rows[i][11] || '').trim() !== 'YES') {
      return i + 2;
    }
  }
  return 0;
}

function getMediaColumn_(sh) {
  const width = sh.getLastColumn();
  if (width < 1) return 0;
  const headers = sh.getRange(1, 1, 1, width).getDisplayValues()[0];
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').trim() === FOXBANQ.MEDIA_HEADER) return i + 1;
  }
  return 0;
}

function getFinalAmountColumn_(sh, create) {
  const width = sh.getLastColumn();
  const headers = width ? sh.getRange(1, 1, 1, width).getDisplayValues()[0] : [];
  for (let i = 0; i < headers.length; i++) if (String(headers[i] || '').trim() === FOXBANQ.FINAL_AMOUNT_HEADER) return i + 1;
  if (!create) return 0;
  const column = Math.max(width, FOXBANQ.HEADERS.length) + 1;
  if (sh.getMaxColumns() < column) sh.insertColumnsAfter(sh.getMaxColumns(), column - sh.getMaxColumns());
  sh.getRange(1, column).setValue(FOXBANQ.FINAL_AMOUNT_HEADER);
  return column;
}

function parseMediaJson_(value) {
  if (Array.isArray(value)) return value;
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeMedia_(items, fallbackUrl, fallbackPublicId) {
  const seen = {};
  const normalized = (Array.isArray(items) ? items : []).map(function(item, index) {
    item = item && typeof item === 'object' ? item : {};
    return {
      url: String(item.url || '').trim(),
      publicId: String(item.publicId || item.public_id || '').trim(),
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index
    };
  }).filter(function(item) {
    if (!item.url || seen[item.url]) return false;
    seen[item.url] = true;
    return true;
  }).sort(function(a, b) { return a.order - b.order; });

  if (!normalized.length && String(fallbackUrl || '').trim()) {
    normalized.push({ url:String(fallbackUrl).trim(), publicId:String(fallbackPublicId || '').trim(), order:0 });
  }
  return normalized.map(function(item, index) {
    return { url:item.url, publicId:item.publicId, order:index };
  });
}

function mediaFromRow_(row, mediaColumn) {
  const raw = mediaColumn ? parseMediaJson_(row[mediaColumn - 1]) : [];
  return normalizeMedia_(raw, String(row[7] || ''), String(row[6] || ''));
}

function mediaToJson_(media) {
  return JSON.stringify(normalizeMedia_(media, '', ''));
}

function banquetClientItem_(row, mediaColumn) {
  const media = mediaFromRow_(row, mediaColumn);
  const first = media[0] || { url:String(row[7] || '').trim(), publicId:String(row[6] || '').trim() };
  const finalAmountColumn = row.__finalAmountColumn || 0;
  const rawFinalAmount = finalAmountColumn ? row[finalAmountColumn - 1] : '';
  return {
    id: String(row[0] || ''),
    date: formatDateForClient_(row[1]),
    time: formatTimeForClient_(row[2]),
    name: String(row[3] || ''),
    comment: String(row[4] || ''),
    status: String(row[5] || 'Актуально'),
    cloudinaryPublicId: first.publicId,
    imageUrl: first.url,
    photo: first.url,
    imageUrls: media.map(function(item) { return item.url; }),
    media: media
    ,finalAmount: rawFinalAmount === '' || rawFinalAmount == null ? null : Number(rawFinalAmount)
  };
}

function updateBanquetFinalAmount_(id, value) {
  return withBanquetLock_(function() {
    const amount = String(value == null ? '' : value).trim() === '' ? '' : Number(value);
    if (amount !== '' && (!isFinite(amount) || amount < 0)) throw new Error('Итоговая сумма должна быть неотрицательным числом.');
    const sh = getSheet_(); const row = findActiveBanquetRowById_(sh, String(id || '').trim());
    if (!row) throw new Error('Банкет не найден.');
    sh.getRange(row, getFinalAmountColumn_(sh, true)).setValue(amount);
    SpreadsheetApp.flush();
    const values = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0]; values.__finalAmountColumn = getFinalAmountColumn_(sh, false);
    return banquetClientItem_(values, getMediaColumn_(sh));
  });
}

function normalizeBanquetStatus_(status) {
  const value = String(status || 'Актуально').trim().toLowerCase();
  if (['выполнено', 'пройден', 'пройдено', 'завершено'].indexOf(value) !== -1) return 'Выполнено';
  if (['отменено', 'отменён', 'отменен'].indexOf(value) !== -1) return 'Отменено';
  return 'Актуально';
}

function updateBanquetStatus_(id, status) {
  return withBanquetLock_(function() {
  id = String(id || '').trim();
  if (!id) throw new Error('Не указан ID банкета');

  const normalizedStatus = normalizeBanquetStatus_(status);
  const sh = getSheet_();
  ensureHeaders_(sh);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('Банкет не найден');

  const rows = sh.getRange(2, 1, lastRow - 1, FOXBANQ.HEADERS.length).getValues();

  // Ищем снизу вверх: если когда-то были дубли, обновится последняя активная запись.
  for (let i = rows.length - 1; i >= 0; i--) {
    const rowId = String(rows[i][0] || '').trim();
    const deleted = String(rows[i][11] || '').trim();
    if (rowId === id && deleted !== 'YES') {
      sh.getRange(i + 2, 6).setValue(normalizedStatus);
      SpreadsheetApp.flush();
      return {
        id: id,
        status: normalizedStatus,
        row: i + 2
      };
    }
  }

  throw new Error('Банкет не найден: ' + id);
  });
}

function deleteBanquet_(id) {
  return withBanquetLock_(function() {
  id = String(id || '').trim();
  if (!id) throw new Error('Не указан ID');

  const sh = getSheet_();
  ensureHeaders_(sh);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return false;

  const rows = sh.getRange(2, 1, lastRow - 1, FOXBANQ.HEADERS.length).getValues();

  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]) === id && String(rows[i][11] || '').trim() !== 'YES') {
      sh.getRange(i + 2, 12).setValue('YES');
      SpreadsheetApp.flush();
      return true;
    }
  }

  return false;
  });
}

function withBanquetLock_(work) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) throw new Error('Таблица банкетов сейчас занята. Повтори через минуту.');
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

function assertAdmin_(telegramUserId) {
  const id = String(telegramUserId || '').trim();
  const admins = FOXBANQ.ADMIN_TELEGRAM_IDS.map(String);

  if (!id || admins.indexOf(id) === -1) {
    throw new Error('Нет прав администратора. Telegram user_id: ' + (id || 'unknown'));
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.openById(FOXBANQ.SPREADSHEET_ID);
  let sh = ss.getSheetByName(FOXBANQ.SHEET_NAME);

  if (!sh) {
    sh = ss.insertSheet(FOXBANQ.SHEET_NAME);
  }

  ensureHeaders_(sh);
  return sh;
}

function ensureHeaders_(sh) {
  if (sh.getMaxColumns() < FOXBANQ.HEADERS.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), FOXBANQ.HEADERS.length - sh.getMaxColumns());
  }

  const current = sh.getRange(1, 1, 1, FOXBANQ.HEADERS.length).getValues()[0];
  let needs = false;

  for (let i = 0; i < FOXBANQ.HEADERS.length; i++) {
    if (String(current[i] || '') !== FOXBANQ.HEADERS[i]) {
      needs = true;
      break;
    }
  }

  if (needs) {
    sh.getRange(1, 1, 1, FOXBANQ.HEADERS.length).setValues([FOXBANQ.HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, FOXBANQ.HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#1F4E78')
      .setFontColor('#ffffff');
  }
}

function formatDateForClient_(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  return s;
}

function formatTimeForClient_(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
  }

  const s = String(value).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);

  if (m) {
    return ('0' + m[1]).slice(-2) + ':' + m[2];
  }

  return s;
}
