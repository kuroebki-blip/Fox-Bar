/**
 * FO’X Telegram -> Galaxy Repairs adapter.
 *
 * This file lives in the existing FO’X stock / Telegram Apps Script project.
 * Repair tickets are stored only in the separate Galaxy Repair Backend.
 *
 * Required Script Properties:
 * - TELEGRAM_BOT_TOKEN
 * - REPAIR_BACKEND_URL
 * - REPAIR_API_KEY
 */

function foxRepairConfig_() {
  return {
    venueId: 'fox',
    draftTtlSeconds: 6 * 60 * 60,
    callbackPrefix: 'repair:',
    duplicateUpdateTtlSeconds: 6 * 60 * 60,
    duplicateActionTtlSeconds: 15,
    zones: {
      bar: 'Бар',
      kitchen: 'Кухня',
      hall: 'Зал',
      back: 'Бэк'
    }
  };
}

/**
 * Protects the bot from Telegram webhook retries.
 * The same update_id / callback_query.id is processed only once.
 */
function foxRepairClaimTelegramUpdate_(update) {
  update = update || {};

  const updateId = String(update.update_id == null ? '' : update.update_id).trim();
  const callbackId = String(
    update.callback_query && update.callback_query.id || ''
  ).trim();

  const uniqueId = updateId || callbackId;
  if (!uniqueId) return true;

  const config = foxRepairConfig_();
  const key = 'fox_repair_update:' + uniqueId;
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) {
    return false;
  }

  try {
    const cache = CacheService.getScriptCache();
    if (cache.get(key)) return false;

    cache.put(
      key,
      '1',
      config.duplicateUpdateTtlSeconds
    );

    return true;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Extra short debounce for callback actions.
 */
function foxRepairClaimAction_(chatId, userId, data) {
  const key = [
    'fox_repair_action',
    String(chatId || ''),
    String(userId || ''),
    String(data || '')
  ].join(':');

  const config = foxRepairConfig_();
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) return false;

  try {
    const cache = CacheService.getScriptCache();
    if (cache.get(key)) return false;

    cache.put(
      key,
      '1',
      config.duplicateActionTtlSeconds
    );

    return true;
  } finally {
    lock.releaseLock();
  }
}

function foxRepairHandleTelegramUpdate_(update) {
  update = update || {};

  if (update.callback_query) {
    if (!foxRepairClaimTelegramUpdate_(update)) {
      foxRepairAnswerCallback_(update.callback_query.id);
      return true;
    }

    return foxRepairHandleCallback_(update.callback_query);
  }

  if (update.message) {
    return foxRepairHandleMessage_(update.message);
  }

  return false;
}

function foxRepairStartButton_() {
  return {
    text: '🔧 Ремонт',
    callback_data: 'repair:start'
  };
}

function foxRepairSendTestButton() {
  const props = PropertiesService.getScriptProperties();
  const token = String(props.getProperty('TELEGRAM_BOT_TOKEN') || '').trim();
  if (!token) throw new Error('Не задан TELEGRAM_BOT_TOKEN.');

  const chatId = String(
    props.getProperty('TELEGRAM_TARGET_CHAT_ID') ||
    props.getProperty('CASH_STYLE_CHAT_ID') ||
    ''
  ).trim();

  if (!chatId) {
    throw new Error(
      'Не найден Telegram chat ID. Нужен TELEGRAM_TARGET_CHAT_ID или CASH_STYLE_CHAT_ID.'
    );
  }

  const response = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/sendMessage',
    {
      method: 'post',
      payload: {
        chat_id: chatId,
        text: 'FO’X\n\nВыбери действие:',
        reply_markup: JSON.stringify({
          inline_keyboard: [[
            {
              text: '🔧 Ремонт',
              callback_data: 'repair:start'
            }
          ]]
        })
      },
      muteHttpExceptions: true
    }
  );

  Logger.log('HTTP ' + response.getResponseCode());
  Logger.log(response.getContentText());

  if (
    response.getResponseCode() < 200 ||
    response.getResponseCode() >= 300
  ) {
    throw new Error(
      'Telegram sendMessage error: ' + response.getContentText()
    );
  }

  return response.getContentText();
}

function foxRepairHandleCallback_(query) {
  query = query || {};

  const config = foxRepairConfig_();
  const data = String(query.data || '');

  if (data.indexOf(config.callbackPrefix) !== 0) return false;

  const message = query.message || {};
  const chatId = String(message.chat && message.chat.id || '');
  const user = query.from || {};
  const userId = String(user.id || '');

  if (!chatId || !userId) return true;

  foxRepairAnswerCallback_(query.id);

  if (!foxRepairClaimAction_(chatId, userId, data)) {
    return true;
  }

  if (data === 'repair:start') {
    foxRepairSaveDraft_(
      chatId,
      userId,
      {
        stage: 'collecting',
        description: '',
        photoFileId: '',
        zoneId: '',
        urgency: 'normal',
        sourceMessageId: ''
      }
    );

    foxRepairSendMessage_(
      chatId,
      '🔧 <b>Новая заявка на ремонт</b>\n\n' +
      'Опиши, что случилось.\n\n' +
      'Можно написать сообщение и приложить фото.',
      null
    );

    return true;
  }

  if (data.indexOf('repair:zone:') === 0) {
    const zoneId = data.substring('repair:zone:'.length);

    if (!config.zones[zoneId]) return true;

    const draft = foxRepairLoadDraft_(chatId, userId);

    if (!draft) {
      foxRepairSendMessage_(
        chatId,
        'Черновик заявки устарел. Нажми «🔧 Ремонт» ещё раз.',
        null
      );
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
      foxRepairSendMessage_(
        chatId,
        'Черновик заявки устарел. Нажми «🔧 Ремонт» ещё раз.',
        null
      );
      return true;
    }

    if (!String(draft.description || '').trim()) {
      foxRepairSendMessage_(
        chatId,
        'Сначала напиши, что сломалось.',
        null
      );
      return true;
    }

    if (!draft.zoneId) {
      foxRepairAskZone_(chatId);
      return true;
    }

    const ticket = foxRepairCreateTicket_(draft, user);
    foxRepairDeleteDraft_(chatId, userId);

    foxRepairSendMessage_(
      chatId,
      '✅ <b>Заявка создана</b>\n\n' +
      '<b>' + foxRepairEscapeHtml_(ticket.ticketId) + '</b>\n' +
      foxRepairEscapeHtml_(ticket.venueName) +
      ' · ' +
      foxRepairEscapeHtml_(ticket.zoneName) +
      '\n\n' +
      foxRepairEscapeHtml_(ticket.description),
      null
    );

    return true;
  }

  if (data === 'repair:edit') {
    const draft = foxRepairLoadDraft_(chatId, userId);

    if (!draft) {
      foxRepairSendMessage_(
        chatId,
        'Черновик заявки устарел. Нажми «🔧 Ремонт» ещё раз.',
        null
      );
      return true;
    }

    draft.stage = 'collecting';
    foxRepairSaveDraft_(chatId, userId, draft);

    foxRepairSendMessage_(
      chatId,
      'Напиши новое описание. Можно также прислать другое фото.',
      null
    );

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
  message = message || {};

  const chatId = String(message.chat && message.chat.id || '');
  const user = message.from || {};
  const userId = String(user.id || '');

  if (!chatId || !userId) return false;

  const draft = foxRepairLoadDraft_(chatId, userId);
  if (!draft) return false;

  const text = String(message.text || message.caption || '').trim();

  if (text) {
    draft.description = text;

    const zone = foxRepairInferZone_(text);
    if (zone) draft.zoneId = zone;

    draft.urgency = foxRepairInferUrgency_(text);
  }

  const photos = Array.isArray(message.photo) ? message.photo : [];

  if (photos.length) {
    draft.photoFileId = String(
      photos[photos.length - 1].file_id || ''
    );
  }

  draft.sourceMessageId = String(message.message_id || '');

  foxRepairSaveDraft_(chatId, userId, draft);

  if (!String(draft.description || '').trim()) {
    foxRepairSendMessage_(
      chatId,
      'Фото получил ✅\n\nТеперь коротко напиши, что произошло.',
      null
    );
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
  foxRepairSendMessage_(
    chatId,
    'Где находится проблема?',
    {
      inline_keyboard: [
        [
          { text: '🍸 Бар', callback_data: 'repair:zone:bar' },
          { text: '🍳 Кухня', callback_data: 'repair:zone:kitchen' }
        ],
        [
          { text: '🪑 Зал', callback_data: 'repair:zone:hall' },
          { text: '📦 Бэк', callback_data: 'repair:zone:back' }
        ],
        [
          { text: '✕ Отмена', callback_data: 'repair:cancel' }
        ]
      ]
    }
  );
}

function foxRepairShowConfirmation_(chatId, userId, draft) {
  const config = foxRepairConfig_();

  draft.stage = 'confirmation';
  foxRepairSaveDraft_(chatId, userId, draft);

  const zoneName = config.zones[draft.zoneId] || draft.zoneId;

  const urgencyLabel = draft.urgency === 'critical'
    ? '🔴 Критичная'
    : draft.urgency === 'urgent'
      ? '🟠 Срочная'
      : '🟢 Обычная';

  const photoLine = draft.photoFileId
    ? 'Фото: ✅'
    : 'Фото: нет';

  foxRepairSendMessage_(
    chatId,
    '🔧 <b>Проверь заявку</b>\n\n' +
    '<b>Ресторан:</b> FO’X\n' +
    '<b>Зона:</b> ' + foxRepairEscapeHtml_(zoneName) + '\n\n' +
    '<b>Проблема:</b>\n' +
    foxRepairEscapeHtml_(draft.description) + '\n\n' +
    '<b>Срочность:</b> ' + urgencyLabel + '\n' +
    photoLine,
    {
      inline_keyboard: [
        [
          { text: '✅ Отправить', callback_data: 'repair:send' }
        ],
        [
          { text: '✏️ Изменить', callback_data: 'repair:edit' },
          { text: '✕ Отмена', callback_data: 'repair:cancel' }
        ]
      ]
    }
  );
}

function foxRepairCreateTicket_(draft, user) {
  const config = foxRepairConfig_();
  const props = PropertiesService.getScriptProperties();

  const url = String(
    props.getProperty('REPAIR_BACKEND_URL') || ''
  ).trim();

  const apiKey = String(
    props.getProperty('REPAIR_API_KEY') || ''
  ).trim();

  if (!url) throw new Error('Не задан REPAIR_BACKEND_URL.');
  if (!apiKey) throw new Error('Не задан REPAIR_API_KEY.');

  const userName = [
    user.first_name,
    user.last_name
  ].filter(Boolean).join(' ').trim() ||
    String(user.username || '').trim() ||
    'Telegram user';

  const payload = {
    apiKey: apiKey,
    action: 'createTicket',
    venueId: config.venueId,
    zoneId: draft.zoneId,
    description: draft.description,
    urgency: draft.urgency || 'normal',
    photoPublicId: draft.photoFileId || '',
    authorTelegramId: String(user.id || ''),
    authorName: userName,
    source: 'telegram_fox',
    externalEventId: [
      'telegram',
      'fox',
      String(user.id || ''),
      String(draft.sourceMessageId || '')
    ].join(':')
  };

  const response = UrlFetchApp.fetch(
    url,
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }
  );

  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();
  let body = {};

  try {
    body = JSON.parse(responseText);
  } catch (_) {}

  if (
    responseCode < 200 ||
    responseCode >= 300 ||
    !body.ok ||
    !body.ticket
  ) {
    throw new Error(
      'Repair Backend error: ' +
      String(body.error || responseText || responseCode)
    );
  }

  return body.ticket;
}

function foxRepairInferZone_(text) {
  const value = String(text || '').toLowerCase();

  if (/\bбар\b|барн|стойк|кран на баре|мойк на баре/.test(value)) {
    return 'bar';
  }

  if (/кухн|повар|печь|печк|плит|фритюр|холодильник|пароконвект|гриль/.test(value)) {
    return 'kitchen';
  }

  if (/\bзал\b|стол|стул|диван|гостев|входн.*двер|витрин/.test(value)) {
    return 'hall';
  }

  if (/бэк|склад|подсоб|раздевал|коридор|служеб/.test(value)) {
    return 'back';
  }

  return '';
}

function foxRepairInferUrgency_(text) {
  const value = String(text || '').toLowerCase();

  if (/пожар|дым|искрит|удар ток|бьет ток|бьёт ток|затоп|авар|коротит/.test(value)) {
    return 'critical';
  }

  if (/срочно|течет|течёт|протека|не работает совсем|сломал|сломано|сломался/.test(value)) {
    return 'urgent';
  }

  return 'normal';
}

function foxRepairDraftKey_(chatId, userId) {
  return [
    'fox_repair_draft',
    String(chatId),
    String(userId)
  ].join(':');
}

function foxRepairLoadDraft_(chatId, userId) {
  const raw = CacheService
    .getScriptCache()
    .get(foxRepairDraftKey_(chatId, userId));

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function foxRepairSaveDraft_(chatId, userId, draft) {
  CacheService
    .getScriptCache()
    .put(
      foxRepairDraftKey_(chatId, userId),
      JSON.stringify(draft || {}),
      foxRepairConfig_().draftTtlSeconds
    );
}

function foxRepairDeleteDraft_(chatId, userId) {
  CacheService
    .getScriptCache()
    .remove(
      foxRepairDraftKey_(chatId, userId)
    );
}

function foxRepairSendMessage_(chatId, text, replyMarkup) {
  const token = String(
    PropertiesService
      .getScriptProperties()
      .getProperty('TELEGRAM_BOT_TOKEN') || ''
  ).trim();

  if (!token) throw new Error('Не задан TELEGRAM_BOT_TOKEN.');

  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };

  if (replyMarkup) {
    payload.reply_markup = JSON.stringify(replyMarkup);
  }

  const response = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/sendMessage',
    {
      method: 'post',
      payload: payload,
      muteHttpExceptions: true
    }
  );

  if (
    response.getResponseCode() < 200 ||
    response.getResponseCode() >= 300
  ) {
    throw new Error(
      'Telegram sendMessage error: ' + response.getContentText()
    );
  }

  return response.getContentText();
}

function foxRepairAnswerCallback_(callbackQueryId) {
  if (!callbackQueryId) return;

  const token = String(
    PropertiesService
      .getScriptProperties()
      .getProperty('TELEGRAM_BOT_TOKEN') || ''
  ).trim();

  if (!token) return;

  UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/answerCallbackQuery',
    {
      method: 'post',
      payload: {
        callback_query_id: callbackQueryId
      },
      muteHttpExceptions: true
    }
  );
}

function foxRepairEscapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
