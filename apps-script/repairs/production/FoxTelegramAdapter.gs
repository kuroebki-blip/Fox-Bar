/**
 * FO’X Telegram -> Galaxy Repairs adapter.
 *
 * This file is intended to live in the existing FO’X Telegram Apps Script project.
 * It does not store repair data locally. It forwards confirmed repair tickets to
 * the separate Galaxy Repair Backend.
 *
 * Required Script Properties in the FO’X Telegram Apps Script project:
 * - TELEGRAM_BOT_TOKEN
 * - REPAIR_BACKEND_URL
 * - REPAIR_API_KEY
 *
 * IMPORTANT: Telegram supports only one webhook per bot. Do NOT point the FO’X bot
 * directly at the Repair Backend. Keep the existing FO’X webhook and route repair
 * updates through foxRepairHandleTelegramUpdate_(update).
 */

const FOX_REPAIR_TG = {
  venueId: 'fox',
  draftTtlSeconds: 6 * 60 * 60,
  callbackPrefix: 'repair:',
  zones: {
    bar: 'Бар',
    kitchen: 'Кухня',
    hall: 'Зал',
    back: 'Бэк'
  }
};

/**
 * Call this from the existing Telegram webhook before banquet-specific processing.
 * Returns true when the update belongs to the Repair flow and was fully handled.
 */
function foxRepairHandleTelegramUpdate_(update) {
  update = update || {};

  if (update.callback_query) {
    return foxRepairHandleCallback_(update.callback_query);
  }

  if (update.message) {
    return foxRepairHandleMessage_(update.message);
  }

  return false;
}

/** Button that can be placed next to the existing Fo'x App button. */
function foxRepairStartButton_() {
  return { text: '🔧 Ремонт', callback_data: 'repair:start' };
}

function foxRepairHandleCallback_(query) {
  const data = String(query && query.data || '');
  if (data.indexOf(FOX_REPAIR_TG.callbackPrefix) !== 0) return false;

  const message = query.message || {};
  const chatId = String(message.chat && message.chat.id || '');
  const user = query.from || {};
  const userId = String(user.id || '');
  if (!chatId || !userId) return true;

  foxRepairAnswerCallback_(query.id);

  if (data === 'repair:start') {
    foxRepairSaveDraft_(chatId, userId, {
      stage: 'collecting',
      description: '',
      photoFileId: '',
      zoneId: '',
      urgency: 'normal'
    });

    foxRepairSendMessage_(chatId,
      '🔧 <b>Новая заявка на ремонт</b>\n\n' +
      'Опиши, что случилось. Можно обычным сообщением и сразу прислать фото.\n\n' +
      'Когда данных будет достаточно, я покажу заявку перед отправкой.',
      null
    );
    return true;
  }

  if (data.indexOf('repair:zone:') === 0) {
    const zoneId = data.substring('repair:zone:'.length);
    if (!FOX_REPAIR_TG.zones[zoneId]) return true;
    const draft = foxRepairLoadDraft_(chatId, userId);
    if (!draft) {
      foxRepairSendMessage_(chatId, 'Черновик заявки устарел. Нажми «🔧 Ремонт» ещё раз.', null);
      return true;
    }
    draft.zoneId = zoneId;
    foxRepairSaveDraft_(chatId, userId, draft);
    foxRepairShowConfirmation_(chatId, userId, draft);
    return true;
  }

  if (data === 'repair:send') {
    const draft = foxRepairLoadDraft_(chatId, userId);
    if (!draft) {
      foxRepairSendMessage_(chatId, 'Черновик заявки устарел. Нажми «🔧 Ремонт» ещё раз.', null);
      return true;
    }

    if (!String(draft.description || '').trim()) {
      foxRepairSendMessage_(chatId, 'Сначала напиши, что сломалось.', null);
      return true;
    }
    if (!draft.zoneId) {
      foxRepairAskZone_(chatId);
      return true;
    }

    const ticket = foxRepairCreateTicket_(draft, user);
    foxRepairDeleteDraft_(chatId, userId);

    foxRepairSendMessage_(chatId,
      '✅ <b>Заявка создана</b>\n\n' +
      '<b>' + foxRepairEscapeHtml_(ticket.ticketId) + '</b>\n' +
      foxRepairEscapeHtml_(ticket.venueName) + ' · ' + foxRepairEscapeHtml_(ticket.zoneName) + '\n' +
      foxRepairEscapeHtml_(ticket.description),
      null
    );
    return true;
  }

  if (data === 'repair:edit') {
    const draft = foxRepairLoadDraft_(chatId, userId);
    if (!draft) {
      foxRepairSendMessage_(chatId, 'Черновик заявки устарел. Нажми «🔧 Ремонт» ещё раз.', null);
      return true;
    }
    draft.stage = 'collecting';
    foxRepairSaveDraft_(chatId, userId, draft);
    foxRepairSendMessage_(chatId, 'Напиши исправленное описание или пришли другое фото.', null);
    return true;
  }

  if (data === 'repair:cancel') {
    foxRepairDeleteDraft_(chatId, userId);
    foxRepairSendMessage_(chatId, 'Заявка отменена.', null);
    return true;
  }

  return true;
}

function foxRepairHandleMessage_(message) {
  const chatId = String(message.chat && message.chat.id || '');
  const user = message.from || {};
  const userId = String(user.id || '');
  if (!chatId || !userId) return false;

  const draft = foxRepairLoadDraft_(chatId, userId);
  if (!draft) return false;

  const text = String(message.text || message.caption || '').trim();
  if (text) {
    draft.description = text;
    const inferredZone = foxRepairInferZone_(text);
    if (inferredZone) draft.zoneId = inferredZone;
    draft.urgency = foxRepairInferUrgency_(text);
  }

  const photos = message.photo || [];
  if (photos.length) {
    draft.photoFileId = String(photos[photos.length - 1].file_id || '');
  }

  foxRepairSaveDraft_(chatId, userId, draft);

  if (!String(draft.description || '').trim()) {
    foxRepairSendMessage_(chatId, 'Фото получил. Теперь коротко напиши, что случилось.', null);
    return true;
  }

  if (!draft.zoneId) {
    foxRepairAskZone_(chatId);
    return true;
  }

  foxRepairShowConfirmation_(chatId, userId, draft);
  return true;
}

function foxRepairAskZone_(chatId) {
  foxRepairSendMessage_(chatId,
    'Где проблема?',
    {
      inline_keyboard: [
        [
          { text:'🍸 Бар', callback_data:'repair:zone:bar' },
          { text:'🍳 Кухня', callback_data:'repair:zone:kitchen' }
        ],
        [
          { text:'🪑 Зал', callback_data:'repair:zone:hall' },
          { text:'📦 Бэк', callback_data:'repair:zone:back' }
        ],
        [ { text:'✕ Отмена', callback_data:'repair:cancel' } ]
      ]
    }
  );
}

function foxRepairShowConfirmation_(chatId, userId, draft) {
  draft.stage = 'confirmation';
  foxRepairSaveDraft_(chatId, userId, draft);

  const zoneName = FOX_REPAIR_TG.zones[draft.zoneId] || draft.zoneId;
  const urgencyLabel = draft.urgency === 'critical' ? 'Критичная' : draft.urgency === 'urgent' ? 'Срочная' : 'Обычная';
  const photoLine = draft.photoFileId ? '\nФото: ✅' : '\nФото: нет';

  foxRepairSendMessage_(chatId,
    'Проверь заявку:\n\n' +
    '<b>FO’X · ' + foxRepairEscapeHtml_(zoneName) + '</b>\n' +
    foxRepairEscapeHtml_(draft.description) + '\n' +
    'Срочность: ' + urgencyLabel +
    photoLine,
    {
      inline_keyboard: [
        [ { text:'✅ Отправить', callback_data:'repair:send' } ],
        [ { text:'✏️ Изменить', callback_data:'repair:edit' }, { text:'✕ Отмена', callback_data:'repair:cancel' } ]
      ]
    }
  );
}

function foxRepairCreateTicket_(draft, user) {
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('REPAIR_BACKEND_URL') || '').trim();
  const apiKey = String(props.getProperty('REPAIR_API_KEY') || '');
  if (!url) throw new Error('Не задан REPAIR_BACKEND_URL.');
  if (!apiKey) throw new Error('Не задан REPAIR_API_KEY.');

  const userName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || 'Telegram user';
  const payload = {
    apiKey: apiKey,
    action: 'createTicket',
    venueId: FOX_REPAIR_TG.venueId,
    zoneId: draft.zoneId,
    description: draft.description,
    urgency: draft.urgency || 'normal',
    photoPublicId: draft.photoFileId || '',
    authorTelegramId: String(user.id || ''),
    authorName: userName,
    source: 'telegram_fox',
    externalEventId: 'tg:' + String(draft.sourceMessageId || '') + ':' + String(user.id || '')
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  let body = {};
  try { body = JSON.parse(response.getContentText()); } catch (_) {}
  if (code < 200 || code >= 300 || !body.ok || !body.ticket) {
    throw new Error('Repair Backend error: ' + String(body.error || code));
  }
  return body.ticket;
}

function foxRepairInferZone_(text) {
  const value = String(text || '').toLowerCase();
  if (/\bбар\b|стойк|барн/.test(value)) return 'bar';
  if (/кухн|повар|печ|плит|фритюр|холодиль/.test(value)) return 'kitchen';
  if (/\bзал\b|стол|стул|диван|гостев/.test(value)) return 'hall';
  if (/бэк|склад|подсоб|раздевал|коридор/.test(value)) return 'back';
  return '';
}

function foxRepairInferUrgency_(text) {
  const value = String(text || '').toLowerCase();
  if (/пожар|дым|искрит|ток|затоп|льет водой|авар/.test(value)) return 'critical';
  if (/срочно|течет|протека|не работает совсем|сломал/.test(value)) return 'urgent';
  return 'normal';
}

function foxRepairDraftKey_(chatId, userId) {
  return 'fox_repair_draft:' + String(chatId) + ':' + String(userId);
}

function foxRepairLoadDraft_(chatId, userId) {
  const raw = CacheService.getScriptCache().get(foxRepairDraftKey_(chatId, userId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function foxRepairSaveDraft_(chatId, userId, draft) {
  CacheService.getScriptCache().put(
    foxRepairDraftKey_(chatId, userId),
    JSON.stringify(draft || {}),
    FOX_REPAIR_TG.draftTtlSeconds
  );
}

function foxRepairDeleteDraft_(chatId, userId) {
  CacheService.getScriptCache().remove(foxRepairDraftKey_(chatId, userId));
}

function foxRepairSendMessage_(chatId, text, replyMarkup) {
  const token = String(PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || '');
  if (!token) throw new Error('Не задан TELEGRAM_BOT_TOKEN.');
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);

  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Telegram sendMessage error: ' + response.getContentText());
  }
}

function foxRepairAnswerCallback_(callbackQueryId) {
  if (!callbackQueryId) return;
  const token = String(PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || '');
  if (!token) return;
  UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/answerCallbackQuery', {
    method: 'post',
    payload: { callback_query_id: callbackQueryId },
    muteHttpExceptions: true
  });
}

function foxRepairEscapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
