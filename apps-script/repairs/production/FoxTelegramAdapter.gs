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
    photoWaitMs: 2 * 60 * 1000,
    confirmationWaitMs: 2 * 60 * 1000,
    timerHandler: 'foxRepairProcessDueDrafts',
    zones: {
      bar: 'Бар',
      kitchen: 'Кухня',
      hall: 'Зал',
      back: 'Бэк'
    }
  };
}

function foxRepairNormalizeDescription_(rawText) {
  const source = String(rawText || '').trim();
  if (!source) return { raw:'', title:'', description:'' };

  try {
    if (typeof normalizeFoxRepairTextWithGemini_ !== 'function') {
      throw new Error('Gemini repair normalizer is not available in Code.gs');
    }

    const normalized = normalizeFoxRepairTextWithGemini_(source) || {};
    const title = String(normalized.title || '').trim();
    const description = String(normalized.description || '').trim();

    foxRepairDiagnosticSet_('repair_text_normalized', {
      raw: source.slice(0, 120),
      title: title.slice(0, 120)
    });

    return {
      raw: source,
      title: title || source,
      description: description || title || source
    };
  } catch (err) {
    foxRepairDiagnosticSet_('repair_text_normalize_fallback', {
      error: String(err && err.message || err || '').slice(0, 300)
    });

    return {
      raw: source,
      title: source,
      description: source
    };
  }
}

function foxRepairDiagnosticSet_(stage, extra) {
  const payload = {
    ts: new Date().toISOString(),
    stage: String(stage || ''),
    extra: extra || {}
  };

  try {
    const props = PropertiesService.getScriptProperties();
    const payloadJson = JSON.stringify(payload);

    props.setProperty('FOX_REPAIR_LAST_INTERNAL_DIAGNOSTIC', payloadJson);

    let history = [];
    try {
      history = JSON.parse(
        String(props.getProperty('FOX_REPAIR_INTERNAL_DIAGNOSTIC_HISTORY') || '[]')
      );
      if (!Array.isArray(history)) history = [];
    } catch (_) {
      history = [];
    }

    history.push(payload);
    if (history.length > 15) {
      history = history.slice(history.length - 15);
    }

    let historyJson = JSON.stringify(history);
    while (history.length > 1 && historyJson.length > 7500) {
      history.shift();
      historyJson = JSON.stringify(history);
    }

    props.setProperty('FOX_REPAIR_INTERNAL_DIAGNOSTIC_HISTORY', historyJson);
  } catch (_) {}

  try {
    Logger.log('REPAIR_DIAGNOSTIC ' + JSON.stringify(payload));
  } catch (_) {}
}

function foxRepairShowLastInternalDiagnostic() {
  const raw = String(
    PropertiesService
      .getScriptProperties()
      .getProperty('FOX_REPAIR_LAST_INTERNAL_DIAGNOSTIC') || ''
  ).trim();

  if (!raw) {
    Logger.log('FOX_REPAIR_LAST_INTERNAL_DIAGNOSTIC is empty.');
    return '';
  }

  Logger.log(raw);
  return raw;
}

function foxRepairShowInternalDiagnosticHistory() {
  const raw = String(
    PropertiesService
      .getScriptProperties()
      .getProperty('FOX_REPAIR_INTERNAL_DIAGNOSTIC_HISTORY') || '[]'
  ).trim();

  let history = [];
  try {
    history = JSON.parse(raw || '[]');
    if (!Array.isArray(history)) history = [];
  } catch (_) {
    history = [];
  }

  if (!history.length) {
    Logger.log('FOX_REPAIR_INTERNAL_DIAGNOSTIC_HISTORY is empty.');
    return '[]';
  }

  history.forEach(function(item, index) {
    Logger.log(String(index + 1) + '. ' + JSON.stringify(item));
  });

  return JSON.stringify(history);
}

function foxRepairClearInternalDiagnostics() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('FOX_REPAIR_LAST_INTERNAL_DIAGNOSTIC');
  props.deleteProperty('FOX_REPAIR_INTERNAL_DIAGNOSTIC_HISTORY');
  Logger.log('Repair diagnostics cleared.');
  return true;
}

function foxRepairClaimTelegramUpdate_(update) {
  update = update || {};

  const updateId = String(update.update_id == null ? '' : update.update_id).trim();
  const callbackId = String(
    update.callback_query && update.callback_query.id || ''
  ).trim();

  const uniqueId = updateId || callbackId;
  if (!uniqueId) return true;

  const config = foxRepairConfig_();
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) return false;

  try {
    const props = PropertiesService.getScriptProperties();
    const propertyName = 'FOX_REPAIR_RECENT_UPDATES';
    const now = Date.now();
    const ttlMs = config.duplicateUpdateTtlSeconds * 1000;
    let recent = {};

    try {
      recent = JSON.parse(String(props.getProperty(propertyName) || '{}'));
      if (!recent || typeof recent !== 'object' || Array.isArray(recent)) recent = {};
    } catch (_) {
      recent = {};
    }

    Object.keys(recent).forEach(function(key) {
      if (now - Number(recent[key] || 0) > ttlMs) delete recent[key];
    });

    if (recent[uniqueId] && now - Number(recent[uniqueId]) <= ttlMs) {
      return false;
    }

    recent[uniqueId] = now;

    const keys = Object.keys(recent);
    if (keys.length > 100) {
      keys
        .sort(function(a, b) { return Number(recent[a]) - Number(recent[b]); })
        .slice(0, keys.length - 100)
        .forEach(function(key) { delete recent[key]; });
    }

    props.setProperty(propertyName, JSON.stringify(recent));
    return true;
  } finally {
    lock.releaseLock();
  }
}

function foxRepairClaimAction_(chatId, userId, data) {
  const uniqueId = [
    String(chatId || ''),
    String(userId || ''),
    String(data || '')
  ].join(':');

  const config = foxRepairConfig_();
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) return false;

  try {
    const props = PropertiesService.getScriptProperties();
    const propertyName = 'FOX_REPAIR_RECENT_ACTIONS';
    const now = Date.now();
    const ttlMs = config.duplicateActionTtlSeconds * 1000;
    let recent = {};

    try {
      recent = JSON.parse(String(props.getProperty(propertyName) || '{}'));
      if (!recent || typeof recent !== 'object' || Array.isArray(recent)) recent = {};
    } catch (_) {
      recent = {};
    }

    Object.keys(recent).forEach(function(key) {
      if (now - Number(recent[key] || 0) > ttlMs) delete recent[key];
    });

    if (recent[uniqueId] && now - Number(recent[uniqueId]) <= ttlMs) {
      return false;
    }

    recent[uniqueId] = now;
    props.setProperty(propertyName, JSON.stringify(recent));
    return true;
  } finally {
    lock.releaseLock();
  }
}

function foxRepairHandleTelegramUpdate_(update) {
  update = update || {};

  foxRepairDiagnosticSet_('update_received', {
    updateId: String(update.update_id == null ? '' : update.update_id),
    type: update.callback_query ? 'callback_query' : (update.message ? 'message' : 'other'),
    callbackData: String(update.callback_query && update.callback_query.data || '')
  });

  let updateClaimed = false;
  try {
    updateClaimed = foxRepairClaimTelegramUpdate_(update);
  } catch (err) {
    foxRepairDiagnosticSet_('update_claim_exception', {
      updateId: String(update.update_id == null ? '' : update.update_id),
      callbackData: String(update.callback_query && update.callback_query.data || ''),
      error: String(err && err.message || err),
      stack: String(err && err.stack || '')
    });
    return true;
  }

  if (!updateClaimed) {
    foxRepairDiagnosticSet_('update_duplicate_skipped', {
      updateId: String(update.update_id == null ? '' : update.update_id),
      callbackData: String(update.callback_query && update.callback_query.data || '')
    });
    if (update.callback_query) {
      foxRepairAnswerCallback_(update.callback_query.id);
    }
    return true;
  }

  foxRepairDiagnosticSet_('update_claimed', {
    updateId: String(update.update_id == null ? '' : update.update_id)
  });

  if (update.callback_query) {
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

function foxRepairBotToken_() {
  const token = String(
    PropertiesService
      .getScriptProperties()
      .getProperty('TELEGRAM_BOT_TOKEN') || ''
  ).trim();

  if (!token) throw new Error('Не задан TELEGRAM_BOT_TOKEN.');
  return token;
}

function foxRepairTelegramApi_(method, payload) {
  const token = foxRepairBotToken_();
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/' + method,
    options
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
    !body.ok
  ) {
    throw new Error(
      'Telegram ' + method + ' error: ' +
      String(body.description || responseText || responseCode)
    );
  }

  return body;
}

function foxRepairTargetChatId_() {
  const props = PropertiesService.getScriptProperties();
  return String(
    props.getProperty('TELEGRAM_TARGET_CHAT_ID') ||
    props.getProperty('CASH_STYLE_CHAT_ID') ||
    ''
  ).trim();
}

function foxRepairReadExistingAppUrl_() {
  const props = PropertiesService.getScriptProperties();
  const saved = String(props.getProperty('FOX_APP_URL') || '').trim();
  if (saved) return saved;

  const chatId = foxRepairTargetChatId_();
  const lookups = [{}];
  if (chatId) lookups.push({ chat_id: chatId });

  for (let i = 0; i < lookups.length; i++) {
    const body = foxRepairTelegramApi_('getChatMenuButton', lookups[i]);
    const button = body.result || {};
    const url = String(
      button.web_app && button.web_app.url || ''
    ).trim();

    if (button.type === 'web_app' && url) {
      props.setProperty('FOX_APP_URL', url);
      return url;
    }
  }

  throw new Error(
    'Не удалось автоматически найти URL текущего Fo\'x App. ' +
    'Сначала верни старую кнопку Fo\'x App или один раз добавь Script Property FOX_APP_URL.'
  );
}

function foxRepairConfigureBotMenu() {
  const appUrl = foxRepairReadExistingAppUrl_();
  const chatId = foxRepairTargetChatId_();

  if (!chatId) {
    throw new Error(
      'Не найден Telegram chat ID. Нужен TELEGRAM_TARGET_CHAT_ID или CASH_STYLE_CHAT_ID.'
    );
  }

  foxRepairTelegramApi_('deleteMyCommands', {});

  foxRepairTelegramApi_('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: 'Fo\'x App',
      web_app: { url: appUrl }
    }
  });

  foxRepairTelegramApi_('setChatMenuButton', {
    chat_id: chatId,
    menu_button: {
      type: 'web_app',
      text: 'Fo\'x App',
      web_app: { url: appUrl }
    }
  });

  foxRepairRemoveReplyKeyboard_(chatId);
  const control = foxRepairEnsureControlPanel_(chatId, appUrl);

  const result = {
    ok: true,
    menuButton: 'web_app',
    menuButtonText: 'Fo\'x App',
    menuButtonDefault: true,
    menuButtonChatSpecific: true,
    replyKeyboardRemoved: true,
    controlMessageId: control.messageId,
    controlPinned: control.pinned,
    commandsRemoved: true,
    appUrlSaved: true
  };

  Logger.log(JSON.stringify(result));
  return result;
}

function foxRepairRemoveReplyKeyboard_(chatId) {
  foxRepairSendMessage_(
    chatId,
    'FO’X: панель управления обновлена.',
    { remove_keyboard: true }
  );
}

function foxRepairControlPanelMarkup_(appUrl) {
  return {
    inline_keyboard: [
      [
        {
          text: '📱 Fo\'x App',
          web_app: { url: appUrl }
        }
      ],
      [
        {
          text: '🔧 Ремонт',
          callback_data: 'repair:start'
        }
      ]
    ]
  };
}

function foxRepairEnsureControlPanel_(chatId, appUrl) {
  const props = PropertiesService.getScriptProperties();
  const savedMessageId = String(
    props.getProperty('FOX_CONTROL_MESSAGE_ID') || ''
  ).trim();

  const text = 'FO’X\n\nВыбери действие:';
  const replyMarkup = foxRepairControlPanelMarkup_(appUrl);
  let messageId = savedMessageId;

  if (savedMessageId) {
    try {
      foxRepairTelegramApi_('editMessageText', {
        chat_id: chatId,
        message_id: Number(savedMessageId),
        text: text,
        reply_markup: replyMarkup
      });
    } catch (_) {
      messageId = '';
    }
  }

  if (!messageId) {
    const sent = foxRepairTelegramApi_('sendMessage', {
      chat_id: chatId,
      text: text,
      reply_markup: replyMarkup
    });

    messageId = String(
      sent.result && sent.result.message_id || ''
    ).trim();

    if (!messageId) {
      throw new Error('Telegram не вернул message_id панели управления.');
    }

    props.setProperty('FOX_CONTROL_MESSAGE_ID', messageId);
  }

  let pinned = false;
  try {
    foxRepairTelegramApi_('pinChatMessage', {
      chat_id: chatId,
      message_id: Number(messageId),
      disable_notification: true
    });
    pinned = true;
  } catch (_) {}

  return {
    messageId: messageId,
    pinned: pinned
  };
}

function foxRepairStart_(chatId, userId) {
  if (!foxRepairClaimAction_(chatId, userId, 'repair:start:text')) {
    return true;
  }

  foxRepairDeleteDraft_(chatId, userId);

  foxRepairSaveDraft_(
    chatId,
    userId,
    {
      stage: 'collecting',
      description: '',
      photoFileId: '',
      zoneId: '',
      urgency: '',
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

function foxRepairHandleCommand_(message, chatId, userId) {
  const text = String(message.text || '').trim();
  if (!text || text.charAt(0) !== '/') return false;

  const command = text
    .split(/\s+/)[0]
    .split('@')[0]
    .toLowerCase();

  if (command === '/repair') {
    return foxRepairStart_(chatId, userId);
  }

  if (command === '/app') {
    const appUrl = String(
      PropertiesService
        .getScriptProperties()
        .getProperty('FOX_APP_URL') || ''
    ).trim();

    if (!appUrl) {
      foxRepairSendMessage_(
        chatId,
        'Fo\'x App пока не настроен. Обратись к администратору.',
        null
      );
      return true;
    }

    foxRepairSendMessage_(
      chatId,
      '📱 <b>Fo\'x App</b>',
      {
        inline_keyboard: [[
          {
            text: '📱 Открыть Fo\'x App',
            web_app: { url: appUrl }
          }
        ]]
      }
    );
    return true;
  }

  return false;
}

function foxRepairHandleCallback_(query) {
  query = query || {};

  const config = foxRepairConfig_();
  const data = String(query.data || '');

  foxRepairDiagnosticSet_('callback_received', {
    data: data,
    callbackQueryId: String(query.id || '')
  });

  if (data.indexOf(config.callbackPrefix) !== 0) {
    foxRepairDiagnosticSet_('callback_not_repair', { data: data });
    return false;
  }

  const message = query.message || {};
  const chatId = String(message.chat && message.chat.id || '');
  const user = query.from || {};
  const userId = String(user.id || '');

  if (!chatId || !userId) return true;

  foxRepairAnswerCallback_(query.id);

  if (!foxRepairClaimAction_(chatId, userId, data)) {
    foxRepairDiagnosticSet_('callback_action_duplicate_skipped', {
      data: data,
      chatId: chatId,
      userId: userId
    });
    return true;
  }

  foxRepairDiagnosticSet_('callback_claimed', {
    data: data,
    chatId: chatId,
    userId: userId
  });

  if (data === 'repair:start') {
    foxRepairSaveDraft_(chatId, userId, {
      stage: 'collecting',
      description: '',
      photoFileId: '',
      zoneId: '',
      urgency: '',
      sourceMessageId: '',
      author: foxRepairAuthorSnapshot_(user),
      photoDeadlineAt: 0,
      confirmationDeadlineAt: 0
    });

    foxRepairSendMessage_(
      chatId,
      '🔧 <b>Новая заявка на ремонт</b>\n\n' +
      'Напиши, что сломалось. Если департамент не указан, я уточню его отдельно.',
      null
    );
    return true;
  }

  if (data.indexOf('repair:zone:') === 0) {
    const zoneId = data.substring('repair:zone:'.length);
    if (!config.zones[zoneId]) return true;

    const draft = foxRepairLoadDraft_(chatId, userId);
    if (!draft) {
      foxRepairSendMessage_(chatId, 'Черновик заявки устарел. Просто напиши проблему ещё раз.', null);
      return true;
    }

    draft.zoneId = zoneId;
    foxRepairSaveDraft_(chatId, userId, draft);

    if (!draft.urgency) {
      foxRepairAskUrgency_(chatId);
      return true;
    }

    if (!draft.photoFileId) {
      foxRepairAskPhoto_(chatId, userId, draft);
      return true;
    }

    foxRepairShowConfirmation_(chatId, userId, draft);
    return true;
  }

  if (data.indexOf('repair:urgency:') === 0) {
    const urgency = data.substring('repair:urgency:'.length);
    if (urgency !== 'critical' && urgency !== 'normal') return true;

    const draft = foxRepairLoadDraft_(chatId, userId);
    if (!draft) {
      foxRepairSendMessage_(chatId, 'Черновик заявки устарел. Просто напиши проблему ещё раз.', null);
      return true;
    }

    draft.urgency = urgency;
    foxRepairSaveDraft_(chatId, userId, draft);

    if (!draft.zoneId) {
      foxRepairAskZone_(chatId);
      return true;
    }

    if (!draft.photoFileId) {
      foxRepairAskPhoto_(chatId, userId, draft);
      return true;
    }

    foxRepairShowConfirmation_(chatId, userId, draft);
    return true;
  }

  if (data === 'repair:photo:skip') {
    const draft = foxRepairLoadDraft_(chatId, userId);
    if (!draft) {
      foxRepairSendMessage_(chatId, 'Черновик заявки устарел. Просто напиши проблему ещё раз.', null);
      return true;
    }

    draft.photoFileId = '';
    draft.photoDeadlineAt = 0;
    foxRepairSaveDraft_(chatId, userId, draft);
    foxRepairShowConfirmation_(chatId, userId, draft);
    return true;
  }

  if (data === 'repair:send') {
    const draft = foxRepairLoadDraft_(chatId, userId);

    foxRepairDiagnosticSet_('repair_send_enter', {
      hasDraft: !!draft,
      hasDescription: !!(draft && String(draft.description || '').trim()),
      zoneId: draft && draft.zoneId || '',
      urgency: draft && draft.urgency || '',
      hasPhoto: !!(draft && draft.photoFileId),
      sourceMessageId: draft && draft.sourceMessageId || ''
    });

    if (!draft) {
      foxRepairSendMessage_(chatId, 'Черновик заявки устарел. Просто напиши проблему ещё раз.', null);
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
    if (!draft.urgency) {
      foxRepairAskUrgency_(chatId);
      return true;
    }
    try {
      foxRepairDiagnosticSet_('repair_before_backend', {
        zoneId: draft.zoneId,
        urgency: draft.urgency,
        hasPhoto: !!draft.photoFileId
      });

      const ticket = foxRepairCreateTicket_(draft, user);
      foxRepairDiagnosticSet_('repair_backend_ok', {
        ticketId: String(ticket && ticket.ticketId || '')
      });

      foxRepairDeleteDraft_(chatId, userId);

      foxRepairSendMessage_(
        chatId,
        '✅ <b>Заявка создана</b>\n\n' +
        '<b>' + foxRepairEscapeHtml_(ticket.ticketId) + '</b>\n' +
        foxRepairEscapeHtml_(ticket.venueName) + ' · ' + foxRepairEscapeHtml_(ticket.zoneName) + '\n\n' +
        foxRepairEscapeHtml_(ticket.description),
        null
      );

      foxRepairDiagnosticSet_('repair_success_message_sent', {
        ticketId: String(ticket && ticket.ticketId || '')
      });
      return true;
    } catch (error) {
      foxRepairDiagnosticSet_('repair_send_exception', {
        name: String(error && error.name || ''),
        message: String(error && error.message || error || ''),
        stack: String(error && error.stack || '').slice(0, 1500)
      });
      try {
        foxRepairSendMessage_(chatId, '⚠️ Не удалось создать заявку. Ошибка записана в диагностику.', null);
      } catch (_) {}
      return true;
    }
  }

  if (data === 'repair:edit') {
    const draft = foxRepairLoadDraft_(chatId, userId);
    if (!draft) {
      foxRepairSendMessage_(chatId, 'Черновик заявки устарел. Просто напиши проблему ещё раз.', null);
      return true;
    }

    draft.stage = 'collecting';
    draft.description = '';
    draft.photoFileId = '';
    draft.zoneId = '';
    draft.urgency = '';
    draft.sourceMessageId = '';
    draft.photoDeadlineAt = 0;
    draft.confirmationDeadlineAt = 0;
    foxRepairSaveDraft_(chatId, userId, draft);

    foxRepairSendMessage_(chatId, 'Напиши новое описание проблемы.', null);
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

  foxRepairDiagnosticSet_('message_received', {
    messageId: String(message.message_id || ''),
    chatId: chatId,
    userId: userId,
    text: String(message.text || message.caption || '').slice(0, 120)
  });

  if (!chatId || !userId) return false;

  if (foxRepairHandleCommand_(message, chatId, userId)) return true;

  const directText = String(message.text || '').trim();
  if (directText === '🔧 Ремонт' || directText.toLowerCase() === 'ремонт') {
    return foxRepairStart_(chatId, userId);
  }

  const textValue = String(message.text || message.caption || '').trim();
  const photos = Array.isArray(message.photo) ? message.photo : [];
  const photoFileId = photos.length
    ? String(photos[photos.length - 1].file_id || '')
    : '';

  let draft = foxRepairLoadDraft_(chatId, userId);

  if (!draft) {
    const normalized = textValue
      ? foxRepairNormalizeDescription_(textValue)
      : { raw:'', title:'', description:'' };

    draft = {
      stage: 'collecting',
      rawDescription: normalized.raw,
      description: normalized.title,
      normalizedDescription: normalized.description,
      photoFileId: photoFileId,
      zoneId: textValue ? foxRepairInferZone_(textValue) : '',
      urgency: '',
      sourceMessageId: String(message.message_id || ''),
      author: foxRepairAuthorSnapshot_(user),
      photoDeadlineAt: 0,
      confirmationDeadlineAt: 0
    };
    foxRepairSaveDraft_(chatId, userId, draft);

    foxRepairDiagnosticSet_('message_started_repair', {
      hasDescription: !!draft.description,
      zoneId: draft.zoneId,
      hasPhoto: !!draft.photoFileId
    });
  } else {
    if (!draft.author) draft.author = foxRepairAuthorSnapshot_(user);

    if (String(draft.stage || '') === 'waiting_photo') {
      if (!photoFileId) {
        foxRepairSendMessage_(
          chatId,
          '📷 Пришли именно <b>фото проблемы</b>. После фото я покажу заявку перед отправкой.',
          null
        );
        return true;
      }

      draft.photoFileId = photoFileId;
      draft.photoDeadlineAt = 0;
      draft.sourceMessageId = String(message.message_id || draft.sourceMessageId || '');
      foxRepairSaveDraft_(chatId, userId, draft);
      foxRepairShowConfirmation_(chatId, userId, draft);
      return true;
    }

    if (textValue) {
      const normalized = foxRepairNormalizeDescription_(textValue);
      draft.rawDescription = normalized.raw;
      draft.description = normalized.title;
      draft.normalizedDescription = normalized.description;
      const explicitZone = foxRepairInferZone_(textValue);
      if (explicitZone) draft.zoneId = explicitZone;
    }
    if (photoFileId) draft.photoFileId = photoFileId;
    draft.sourceMessageId = String(message.message_id || draft.sourceMessageId || '');
    foxRepairSaveDraft_(chatId, userId, draft);
  }

  if (!String(draft.description || '').trim()) {
    foxRepairSendMessage_(chatId, 'Коротко напиши, что сломалось.', null);
    return true;
  }

  if (!draft.zoneId) {
    foxRepairAskZone_(chatId);
    return true;
  }

  if (!draft.urgency) {
    foxRepairAskUrgency_(chatId);
    return true;
  }

  if (!draft.photoFileId) {
    foxRepairAskPhoto_(chatId, userId, draft);
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

function foxRepairAskUrgency_(chatId) {
  foxRepairSendMessage_(
    chatId,
    'Какой тип заявки?',
    {
      inline_keyboard: [
        [
          { text: '🚨 Аварийный', callback_data: 'repair:urgency:critical' },
          { text: '🟢 Штатный', callback_data: 'repair:urgency:normal' }
        ],
        [
          { text: '✕ Отмена', callback_data: 'repair:cancel' }
        ]
      ]
    }
  );
}

function foxRepairAskPhoto_(chatId, userId, draft) {
  draft = draft || foxRepairLoadDraft_(chatId, userId);
  if (!draft) {
    foxRepairSendMessage_(chatId, 'Черновик заявки устарел. Просто напиши проблему ещё раз.', null);
    return;
  }

  const config = foxRepairConfig_();
  draft.stage = 'waiting_photo';
  draft.photoDeadlineAt = Date.now() + config.photoWaitMs;
  draft.confirmationDeadlineAt = 0;
  foxRepairSaveDraft_(chatId, userId, draft);
  foxRepairScheduleTimer_();

  foxRepairSendMessage_(
    chatId,
    '📷 <b>Пришли фото проблемы</b>\n\n' +
    'Если фото не будет в течение 2 минут, я продолжу без него.',
    {
      inline_keyboard: [
        [{ text: '⏭ Пропустить фото', callback_data: 'repair:photo:skip' }],
        [{ text: '✕ Отмена', callback_data: 'repair:cancel' }]
      ]
    }
  );
}

function foxRepairShowConfirmation_(chatId, userId, draft) {
  const config = foxRepairConfig_();
  draft.stage = 'confirmation';
  draft.photoDeadlineAt = 0;
  draft.confirmationDeadlineAt = Date.now() + config.confirmationWaitMs;
  foxRepairSaveDraft_(chatId, userId, draft);
  foxRepairScheduleTimer_();

  const zoneName = config.zones[draft.zoneId] || draft.zoneId;

  const urgencyLabel = draft.urgency === 'critical'
    ? '🚨 Аварийный'
    : '🟢 Штатный';

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
    '<b>Тип заявки:</b> ' + urgencyLabel + '\n' +
    photoLine + '\n\n' +
    'Если ничего не нажать, заявка отправится автоматически через 2 минуты.',
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

  foxRepairDiagnosticSet_('confirmation_sent', {
    chatId: String(chatId || ''),
    userId: String(userId || ''),
    zoneId: String(draft.zoneId || ''),
    sourceMessageId: String(draft.sourceMessageId || '')
  });
}

function foxRepairAuthorSnapshot_(user) {
  user = user || {};
  return {
    id: String(user.id || ''),
    first_name: String(user.first_name || ''),
    last_name: String(user.last_name || ''),
    username: String(user.username || '')
  };
}

function foxRepairDraftPropertyName_(chatId, userId) {
  return 'FOX_REPAIR_DRAFT_' + String(chatId) + '_' + String(userId);
}

function foxRepairDraftIndex_() {
  const props = PropertiesService.getScriptProperties();
  let index = {};
  try {
    index = JSON.parse(String(props.getProperty('FOX_REPAIR_DRAFT_INDEX') || '{}'));
    if (!index || typeof index !== 'object' || Array.isArray(index)) index = {};
  } catch (_) {
    index = {};
  }
  return index;
}

function foxRepairSaveDraftIndex_(index) {
  PropertiesService.getScriptProperties().setProperty(
    'FOX_REPAIR_DRAFT_INDEX',
    JSON.stringify(index || {})
  );
}

function foxRepairSetupAutoSendTimers() {
  const config = foxRepairConfig_();
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(function(trigger) {
    return trigger.getHandlerFunction() === config.timerHandler;
  });

  if (!exists) {
    ScriptApp.newTrigger(config.timerHandler)
      .timeBased()
      .everyMinutes(1)
      .create();
  }

  const result = {
    ok: true,
    timerSupport: true,
    mode: 'every_minute',
    alreadyExisted: exists
  };
  Logger.log(JSON.stringify(result));
  return result;
}

function foxRepairScheduleTimer_() {
  return true;
}

function foxRepairProcessDueDrafts() {
  const now = Date.now();
  const index = foxRepairDraftIndex_();

  Object.keys(index).forEach(function(key) {
    const item = index[key] || {};
    const chatId = String(item.chatId || '');
    const userId = String(item.userId || '');
    if (!chatId || !userId) return;

    const draft = foxRepairLoadDraft_(chatId, userId);
    if (!draft) return;

    try {
      if (
        draft.stage === 'waiting_photo' &&
        Number(draft.photoDeadlineAt || 0) > 0 &&
        Number(draft.photoDeadlineAt) <= now
      ) {
        draft.photoDeadlineAt = 0;
        foxRepairSaveDraft_(chatId, userId, draft);
        foxRepairSendMessage_(
          chatId,
          '⏱ Фото не пришло за 2 минуты — продолжаю без фото.',
          null
        );
        foxRepairShowConfirmation_(chatId, userId, draft);
        return;
      }

      if (
        draft.stage === 'confirmation' &&
        Number(draft.confirmationDeadlineAt || 0) > 0 &&
        Number(draft.confirmationDeadlineAt) <= now
      ) {
        foxRepairDiagnosticSet_('auto_send_due', {
          chatId: chatId,
          userId: userId,
          hasPhoto: !!draft.photoFileId
        });

        const ticket = foxRepairCreateTicket_(draft, draft.author || { id: userId });
        foxRepairDeleteDraft_(chatId, userId);

        foxRepairSendMessage_(
          chatId,
          '✅ <b>Заявка создана автоматически</b>\n\n' +
          '<b>' + foxRepairEscapeHtml_(ticket.ticketId) + '</b>\n' +
          foxRepairEscapeHtml_(ticket.venueName) + ' · ' + foxRepairEscapeHtml_(ticket.zoneName) + '\n\n' +
          foxRepairEscapeHtml_(ticket.description),
          null
        );

        foxRepairDiagnosticSet_('auto_send_success', {
          ticketId: String(ticket && ticket.ticketId || '')
        });
      }
    } catch (error) {
      draft.confirmationDeadlineAt = 0;
      draft.photoDeadlineAt = 0;
      foxRepairSaveDraft_(chatId, userId, draft);

      foxRepairDiagnosticSet_('auto_send_exception', {
        chatId: chatId,
        userId: userId,
        message: String(error && error.message || error || '')
      });

      try {
        foxRepairSendMessage_(
          chatId,
          '⚠️ Не удалось отправить заявку автоматически. Нажми «✅ Отправить».',
          null
        );
      } catch (_) {}
    }
  });

  foxRepairScheduleTimer_();
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
    description: String(draft.description || draft.rawDescription || '').trim(),
    rawDescription: String(draft.rawDescription || '').trim(),
    normalizedDescription: String(draft.normalizedDescription || draft.description || '').trim(),
    urgency: draft.urgency,
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

  if (/(^|[^а-яё])бар([^а-яё]|$)|на\s+баре|в\s+баре|барн(?:ая|ой|ую)/i.test(value)) {
    return 'bar';
  }

  if (/кухн/i.test(value)) {
    return 'kitchen';
  }

  if (/(^|[^а-яё])зал([^а-яё]|$)|в\s+зале|гостев(?:ой|ом|ая)/i.test(value)) {
    return 'hall';
  }

  if (/бэк|back|склад|подсоб/i.test(value)) {
    return 'back';
  }

  return '';
}

function foxRepairDraftKey_(chatId, userId) {
  return [
    'fox_repair_draft',
    String(chatId),
    String(userId)
  ].join(':');
}

function foxRepairLoadDraft_(chatId, userId) {
  const props = PropertiesService.getScriptProperties();
  const propertyName = foxRepairDraftPropertyName_(chatId, userId);
  const raw = String(props.getProperty(propertyName) || '');

  if (!raw) {
    const cached = CacheService.getScriptCache().get(foxRepairDraftKey_(chatId, userId));
    if (!cached) return null;
    try {
      const draft = JSON.parse(cached);
      foxRepairSaveDraft_(chatId, userId, draft);
      return draft;
    } catch (_) {
      return null;
    }
  }

  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function foxRepairSaveDraft_(chatId, userId, draft) {
  const props = PropertiesService.getScriptProperties();
  const propertyName = foxRepairDraftPropertyName_(chatId, userId);
  props.setProperty(propertyName, JSON.stringify(draft || {}));

  const index = foxRepairDraftIndex_();
  index[propertyName] = {
    chatId: String(chatId),
    userId: String(userId)
  };
  foxRepairSaveDraftIndex_(index);

  try {
    CacheService.getScriptCache().put(
      foxRepairDraftKey_(chatId, userId),
      JSON.stringify(draft || {}),
      foxRepairConfig_().draftTtlSeconds
    );
  } catch (_) {}
}

function foxRepairDeleteDraft_(chatId, userId) {
  const props = PropertiesService.getScriptProperties();
  const propertyName = foxRepairDraftPropertyName_(chatId, userId);
  props.deleteProperty(propertyName);

  const index = foxRepairDraftIndex_();
  delete index[propertyName];
  foxRepairSaveDraftIndex_(index);

  try {
    CacheService.getScriptCache().remove(foxRepairDraftKey_(chatId, userId));
  } catch (_) {}
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

function foxRepairShowTelegramWebhookInfo() {
  const props = PropertiesService.getScriptProperties();
  const token = String(props.getProperty('TELEGRAM_BOT_TOKEN') || '').trim();
  if (!token) throw new Error('Не задан TELEGRAM_BOT_TOKEN.');

  const response = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/getWebhookInfo',
    { method: 'get', muteHttpExceptions: true }
  );

  const code = response.getResponseCode();
  const text = response.getContentText();
  let body = {};
  try { body = JSON.parse(text); } catch (_) {}

  if (code < 200 || code >= 300 || !body.ok || !body.result) {
    throw new Error('Telegram getWebhookInfo error: ' + text);
  }

  const info = body.result || {};
  const safeUrl = String(info.url || '')
    .replace(/([?&]secret=)[^&]*/i, '$1***');

  const safe = {
    url: safeUrl,
    pending_update_count: info.pending_update_count || 0,
    last_error_date: info.last_error_date || null,
    last_error_message: info.last_error_message || '',
    last_synchronization_error_date: info.last_synchronization_error_date || null,
    max_connections: info.max_connections || null,
    allowed_updates: info.allowed_updates || []
  };

  Logger.log(JSON.stringify(safe));
  return safe;
}

function foxRepairDeleteCurrentWebhook() {
  const token = String(
    PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || ''
  ).trim();

  if (!token) throw new Error('Не задан TELEGRAM_BOT_TOKEN.');

  const response = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/deleteWebhook',
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ drop_pending_updates: true }),
      muteHttpExceptions: true
    }
  );

  const code = response.getResponseCode();
  const text = response.getContentText();
  let body = {};

  try {
    body = JSON.parse(text);
  } catch (_) {}

  const safeResult = {
    ok: code >= 200 && code < 300 && body && body.ok === true,
    httpCode: code,
    description: body && body.description ? String(body.description) : ''
  };

  Logger.log(JSON.stringify(safeResult));

  if (!safeResult.ok) {
    throw new Error('Telegram deleteWebhook error: ' + (safeResult.description || text || code));
  }

  return safeResult;
}

function foxRepairConfigureDedicatedWebhook() {
  const props = PropertiesService.getScriptProperties();
  const token = String(props.getProperty('TELEGRAM_BOT_TOKEN') || '').trim();
  if (!token) throw new Error('Не задан TELEGRAM_BOT_TOKEN.');

  const fallbackWorkerUrl = 'https://fox-repair-telegram-webhook.woodie-nosit-hoodie.workers.dev';
  const workerUrl = String(
    props.getProperty('TELEGRAM_REPAIR_WORKER_URL') || fallbackWorkerUrl
  ).trim().replace(/\/$/, '');

  if (!/^https:\/\//i.test(workerUrl)) {
    throw new Error('TELEGRAM_REPAIR_WORKER_URL должен быть HTTPS URL Cloudflare Worker.');
  }

  let secret = String(props.getProperty('TELEGRAM_REPAIR_WEBHOOK_SECRET') || '').trim();
  if (!secret) {
    secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('TELEGRAM_REPAIR_WEBHOOK_SECRET', secret);
  }

  const response = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/setWebhook',
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        url: workerUrl,
        secret_token: secret,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true
      }),
      muteHttpExceptions: true
    }
  );

  const code = response.getResponseCode();
  const text = response.getContentText();
  let body = {};
  try { body = JSON.parse(text); } catch (_) {}

  if (code < 200 || code >= 300 || !body.ok) {
    throw new Error('Telegram setWebhook error: ' + (body.description || text || code));
  }

  props.setProperty('TELEGRAM_REPAIR_WORKER_URL', workerUrl);
  props.setProperty('TELEGRAM_REPAIR_WEBHOOK_CONFIGURED_AT', new Date().toISOString());

  const safeResult = {
    ok: true,
    httpCode: code,
    endpoint: workerUrl,
    telegramSecretTokenEnabled: true,
    allowedUpdates: ['message', 'callback_query'],
    dropPendingUpdates: true
  };

  Logger.log(JSON.stringify(safeResult));
  return safeResult;
}
