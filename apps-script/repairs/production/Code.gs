/**
 * Galaxy Repairs — отдельный backend технических заявок FO’X / Tatooine.
 *
 * Источник истины: отдельная Google Spreadsheet, ID берётся только из Script Properties.
 * Этот код НЕ использует stock/cash таблицы и НЕ зависит от FO’X/Tatooine frontend.
 *
 * Required Script Properties before deployment:
 * - REPAIR_SPREADSHEET_ID
 * - REPAIR_API_KEY
 */

const REPAIR = {
  version: 'v0.1.0 REPAIR BACKEND FOUNDATION',
  sheets: {
    tickets: 'Заявки',
    events: 'История',
    venues: 'Рестораны',
    zones: 'Зоны',
    assignees: 'Исполнители',
    syncQueue: 'Очередь синхронизации'
  },
  statuses: ['new', 'in_progress', 'waiting', 'done'],
  urgencies: ['normal', 'urgent', 'critical'],
  transitions: {
    new: ['in_progress'],
    in_progress: ['waiting', 'done'],
    waiting: ['in_progress', 'done'],
    done: ['in_progress']
  }
};

const REPAIR_TICKET_HEADERS = [
  'Внутренний ID','ID заявки','ID ресторана','Ресторан','ID зоны','Зона','Описание',
  'URL фото','Public ID фото','Срочность','Статус','Тип проблемы','Объект поломки',
  'Автор Telegram ID','Автор','Исполнитель ID','Исполнитель','Создано','Принято в работу',
  'Завершено','Обновлено','SLA до','Pachca Chat ID','Pachca Message ID','Pachca Thread ID',
  'Статус синхронизации Pachca','Версия записи'
];

const REPAIR_EVENT_HEADERS = [
  'ID события','Внутренний ID заявки','ID заявки','Тип события','Старый статус','Новый статус',
  'Источник','Actor ID','Actor','Комментарий','External Event ID','Создано'
];

function doGet(e) {
  const action = String(e && e.parameter && e.parameter.action || 'ping');
  if (action !== 'ping') return repairJson_({ ok:false, error:'GET разрешён только для ping.' });
  return repairJson_({ ok:true, service:'Galaxy Repairs', version:REPAIR.version, time:new Date().toISOString() });
}

function doPost(e) {
  try {
    const body = repairParseJsonBody_(e);
    repairRequireApiKey_(body.apiKey);
    const action = String(body.action || '');
    if (!action) throw new Error('Не передан action.');

    if (action === 'createTicket') return repairJson_({ ok:true, ticket:repairCreateTicket_(body) });
    if (action === 'getTicket') return repairJson_({ ok:true, ticket:repairGetTicket_(body.ticketId) });
    if (action === 'listTickets') return repairJson_({ ok:true, tickets:repairListTickets_(body) });
    if (action === 'changeStatus') return repairJson_({ ok:true, ticket:repairChangeStatus_(body) });
    if (action === 'addComment') return repairJson_({ ok:true, event:repairAddComment_(body) });

    throw new Error('Неизвестный action: ' + action);
  } catch (error) {
    return repairJson_({ ok:false, error:String(error && error.message || error) });
  }
}

function repairSpreadsheet_() {
  const id = String(PropertiesService.getScriptProperties().getProperty('REPAIR_SPREADSHEET_ID') || '').trim();
  if (!id) throw new Error('Не задан REPAIR_SPREADSHEET_ID.');
  return SpreadsheetApp.openById(id);
}

function repairSheet_(key) {
  const name = REPAIR.sheets[key];
  const sheet = repairSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Не найден лист: ' + name);
  return sheet;
}

function repairRequireApiKey_(value) {
  const expected = String(PropertiesService.getScriptProperties().getProperty('REPAIR_API_KEY') || '');
  if (!expected) throw new Error('Не задан REPAIR_API_KEY.');
  if (String(value || '') !== expected) throw new Error('Нет доступа.');
}

function repairParseJsonBody_(e) {
  const raw = e && e.postData && e.postData.contents;
  if (!raw) throw new Error('Пустой запрос.');
  let body;
  try { body = JSON.parse(raw); } catch (_) { throw new Error('Некорректный JSON.'); }
  return body && typeof body === 'object' ? body : {};
}

function repairCreateTicket_(input) {
  const venue = repairFindVenue_(input.venueId);
  const zone = repairFindZone_(input.zoneId, venue.id);
  const description = repairRequiredText_(input.description, 'Описание', 2000);
  const urgency = repairEnum_(input.urgency || 'normal', REPAIR.urgencies, 'срочность');
  const authorTelegramId = repairRequiredText_(input.authorTelegramId, 'Автор Telegram ID', 80);
  const authorName = repairRequiredText_(input.authorName || 'Без имени', 'Автор', 200);
  const now = new Date();
  const internalId = Utilities.getUuid();

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Система заявок занята. Повторите попытку.');
  try {
    const ticketId = repairNextPublicId_(venue.prefix);
    const row = [
      internalId, ticketId, venue.id, venue.name, zone.id, zone.name, description,
      String(input.photoUrl || ''), String(input.photoPublicId || ''), urgency, 'new',
      String(input.problemType || ''), String(input.assetName || ''), authorTelegramId, authorName,
      '', '', now, '', '', now, '', '', '', '', 'pending', 1
    ];
    repairSheet_('tickets').appendRow(row);
    repairAppendEvent_({
      internalId:internalId, ticketId:ticketId, type:'CREATED', oldStatus:'', newStatus:'new',
      source:String(input.source || 'api'), actorId:authorTelegramId, actorName:authorName,
      comment:'', externalEventId:String(input.externalEventId || '')
    });
    return repairTicketFromRow_(row);
  } finally {
    lock.releaseLock();
  }
}

function repairChangeStatus_(input) {
  const ticketId = repairRequiredText_(input.ticketId, 'ID заявки', 80);
  const nextStatus = repairEnum_(input.status, REPAIR.statuses, 'статус');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Система заявок занята. Повторите попытку.');
  try {
    const found = repairFindTicketRow_(ticketId);
    const row = found.values.slice();
    const current = String(row[10] || 'new');
    if (current === nextStatus) return repairTicketFromRow_(row);
    const allowed = REPAIR.transitions[current] || [];
    if (allowed.indexOf(nextStatus) < 0) throw new Error('Недопустимый переход статуса: ' + current + ' → ' + nextStatus);

    const now = new Date();
    row[10] = nextStatus;
    row[20] = now;
    row[26] = Number(row[26] || 0) + 1;

    if (nextStatus === 'in_progress') {
      if (!row[18]) row[18] = now;
      if (input.assigneeId) row[15] = String(input.assigneeId);
      if (input.assigneeName) row[16] = String(input.assigneeName);
      if (current === 'done') row[19] = '';
    }
    if (nextStatus === 'done') row[19] = now;

    found.sheet.getRange(found.rowNumber, 1, 1, REPAIR_TICKET_HEADERS.length).setValues([row]);
    repairAppendEvent_({
      internalId:String(row[0]), ticketId:String(row[1]),
      type:nextStatus === 'in_progress' && current === 'waiting' ? 'RESUMED' :
           nextStatus === 'in_progress' && current === 'done' ? 'REOPENED' :
           nextStatus === 'in_progress' ? 'ACCEPTED' :
           nextStatus === 'waiting' ? 'PAUSED' : 'COMPLETED',
      oldStatus:current, newStatus:nextStatus,
      source:String(input.source || 'api'), actorId:String(input.actorId || ''), actorName:String(input.actorName || ''),
      comment:String(input.comment || ''), externalEventId:String(input.externalEventId || '')
    });
    return repairTicketFromRow_(row);
  } finally {
    lock.releaseLock();
  }
}

function repairAddComment_(input) {
  const found = repairFindTicketRow_(repairRequiredText_(input.ticketId, 'ID заявки', 80));
  const comment = repairRequiredText_(input.comment, 'Комментарий', 2000);
  return repairAppendEvent_({
    internalId:String(found.values[0]), ticketId:String(found.values[1]), type:'COMMENTED',
    oldStatus:String(found.values[10]), newStatus:String(found.values[10]), source:String(input.source || 'api'),
    actorId:String(input.actorId || ''), actorName:String(input.actorName || ''), comment:comment,
    externalEventId:String(input.externalEventId || '')
  });
}

function repairGetTicket_(ticketId) {
  return repairTicketFromRow_(repairFindTicketRow_(repairRequiredText_(ticketId, 'ID заявки', 80)).values);
}

function repairListTickets_(input) {
  const sheet = repairSheet_('tickets');
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, REPAIR_TICKET_HEADERS.length).getValues();
  const venueId = String(input.venueId || '');
  const status = String(input.status || '');
  return values.filter(function(row) {
    return (!venueId || String(row[2]) === venueId) && (!status || String(row[10]) === status);
  }).map(repairTicketFromRow_);
}

function repairFindTicketRow_(ticketId) {
  const sheet = repairSheet_('tickets');
  if (sheet.getLastRow() < 2) throw new Error('Заявка не найдена.');
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, REPAIR_TICKET_HEADERS.length).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][1]) === String(ticketId)) return { sheet:sheet, rowNumber:i + 2, values:values[i] };
  }
  throw new Error('Заявка не найдена: ' + ticketId);
}

function repairNextPublicId_(prefix) {
  const sheet = repairSheet_('tickets');
  let max = 0;
  if (sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
    const re = new RegExp('^' + String(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-REP-(\\d+)$');
    ids.forEach(function(item) {
      const match = String(item[0] || '').match(re);
      if (match) max = Math.max(max, Number(match[1]));
    });
  }
  return String(prefix) + '-REP-' + String(max + 1).padStart(4, '0');
}

function repairFindVenue_(venueId) {
  const id = repairRequiredText_(venueId, 'ID ресторана', 80);
  const sheet = repairSheet_('venues');
  if (sheet.getLastRow() < 2) throw new Error('Ресторан не найден.');
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === id && String(rows[i][3]).toUpperCase() !== 'FALSE') {
      return { id:id, name:String(rows[i][1]), prefix:String(rows[i][2]) };
    }
  }
  throw new Error('Ресторан не найден: ' + id);
}

function repairFindZone_(zoneId, venueId) {
  const id = repairRequiredText_(zoneId, 'ID зоны', 80);
  const sheet = repairSheet_('zones');
  if (sheet.getLastRow() < 2) throw new Error('Зона не найдена.');
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  for (let i = 0; i < rows.length; i++) {
    const scope = String(rows[i][2] || '*');
    if (String(rows[i][0]) === id && (scope === '*' || scope === venueId) && String(rows[i][3]).toUpperCase() !== 'FALSE') {
      return { id:id, name:String(rows[i][1]) };
    }
  }
  throw new Error('Зона не найдена: ' + id);
}

function repairAppendEvent_(event) {
  const externalEventId = String(event.externalEventId || '');
  if (externalEventId && repairExternalEventExists_(externalEventId)) {
    return { deduplicated:true, externalEventId:externalEventId };
  }
  const row = [
    Utilities.getUuid(), String(event.internalId || ''), String(event.ticketId || ''), String(event.type || ''),
    String(event.oldStatus || ''), String(event.newStatus || ''), String(event.source || ''), String(event.actorId || ''),
    String(event.actorName || ''), String(event.comment || ''), externalEventId, new Date()
  ];
  repairSheet_('events').appendRow(row);
  return { id:row[0], ticketId:row[2], type:row[3], createdAt:row[11] };
}

function repairExternalEventExists_(externalEventId) {
  const sheet = repairSheet_('events');
  if (sheet.getLastRow() < 2) return false;
  const values = sheet.getRange(2, 11, sheet.getLastRow() - 1, 1).getValues();
  return values.some(function(row) { return String(row[0]) === String(externalEventId); });
}

function repairTicketFromRow_(row) {
  return {
    internalId:String(row[0] || ''), ticketId:String(row[1] || ''), venueId:String(row[2] || ''), venueName:String(row[3] || ''),
    zoneId:String(row[4] || ''), zoneName:String(row[5] || ''), description:String(row[6] || ''), photoUrl:String(row[7] || ''),
    photoPublicId:String(row[8] || ''), urgency:String(row[9] || ''), status:String(row[10] || ''), problemType:String(row[11] || ''),
    assetName:String(row[12] || ''), authorTelegramId:String(row[13] || ''), authorName:String(row[14] || ''),
    assigneeId:String(row[15] || ''), assigneeName:String(row[16] || ''), createdAt:row[17] || '', acceptedAt:row[18] || '',
    completedAt:row[19] || '', updatedAt:row[20] || '', slaDueAt:row[21] || '', pachcaChatId:String(row[22] || ''),
    pachcaMessageId:String(row[23] || ''), pachcaThreadId:String(row[24] || ''), pachcaSyncStatus:String(row[25] || ''),
    version:Number(row[26] || 0)
  };
}

function repairRequiredText_(value, label, maxLength) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new Error(label + ' не указан.');
  if (text.length > maxLength) throw new Error(label + ' слишком длинный.');
  return text;
}

function repairEnum_(value, allowed, label) {
  const text = String(value || '').trim();
  if (allowed.indexOf(text) < 0) throw new Error('Некорректный ' + label + ': ' + text);
  return text;
}

function repairJson_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
