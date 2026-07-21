/**
 * FO'X Banquets Backend v3 — Cloudinary
 *
 * Google Apps Script теперь НЕ принимает фото.
 * Mini App загружает фото напрямую в Cloudinary и передаёт сюда только ссылку.
 *
 * Что делает backend:
 * - хранит банкеты в Google Sheets;
 * - отдаёт список банкетов для Mini App;
 * - принимает добавление/удаление банкетов от админов.
 *
 * Заполни SPREADSHEET_ID.
 */

const FOXBANQ = {
  SPREADSHEET_ID: 'PASTE_GOOGLE_SHEET_ID_HERE',
  SHEET_NAME: 'Банкеты',
  ADMIN_TELEGRAM_IDS: [
    1036250074,
    315978242,
    317564157
  ],
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
      result = { ok: true, items: listBanquets_() };
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
    } else if (action === 'delete') {
      result = { ok: true, deleted: deleteBanquet_(p.id) };
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

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const rows = sh.getRange(2, 1, lastRow - 1, FOXBANQ.HEADERS.length).getValues();

  return rows
    .filter(r => String(r[0] || '').trim() && String(r[11] || '').trim() !== 'YES')
    .map(r => {
      const imageUrl = String(r[7] || '').trim();
      return {
        id: String(r[0] || ''),
        date: formatDateForClient_(r[1]),
        time: formatTimeForClient_(r[2]),
        name: String(r[3] || ''),
        comment: String(r[4] || ''),
        status: String(r[5] || 'Актуально'),
        cloudinaryPublicId: String(r[6] || ''),
        imageUrl: imageUrl,
        photo: imageUrl,
        imageUrls: imageUrl ? [imageUrl] : []
      };
    })
    .filter(x => x.date);
}

function saveBanquet_(p) {
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

  const row = [
    id,
    date,
    time,
    name,
    comment,
    status,
    cloudinaryPublicId,
    imageUrl,
    new Date(),
    userId,
    userName,
    ''
  ];

  sh.appendRow(row);

  return {
    id: id,
    date: date,
    time: time,
    name: name,
    comment: comment,
    status: status,
    cloudinaryPublicId: cloudinaryPublicId,
    imageUrl: imageUrl,
    photo: imageUrl,
    imageUrls: imageUrl ? [imageUrl] : []
  };
}

function deleteBanquet_(id) {
  id = String(id || '').trim();
  if (!id) throw new Error('Не указан ID');

  const sh = getSheet_();
  ensureHeaders_(sh);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return false;

  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();

  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) {
      sh.getRange(i + 2, 12).setValue('YES');
      return true;
    }
  }

  return false;
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
