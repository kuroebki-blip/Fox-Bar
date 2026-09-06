// FO’X v9.11 — Telegram -> Estimates Guru -> banquet autoimport

const FOX_BANQUET_TELEGRAM = {
  statePrefix:'foxBanquetImport:',
  processingTtlMs:10 * 60 * 1000,
  stateRetentionMs:180 * 24 * 60 * 60 * 1000,
  maxSourceBytes:20 * 1024 * 1024
};

function normalizeEstimateGuruSnapshotUrl_(value) {
  const raw = String(value || '').trim().replace(/[),.;]+$/g, '');
  const match = raw.match(/^https:\/\/app\.estimates\.guru\/snapshot\/([A-Za-z0-9_-]{6,128})(?:[/?#].*)?$/i);
  return match ? { id:match[1], url:'https://app.estimates.guru/snapshot/' + match[1] } : null;
}

function telegramBanquetSnapshotUrlFromMessage_(message) {
  message = message || {};
  const text = String(message.text || message.caption || '');
  const entities = Array.isArray(message.entities) ? message.entities : (Array.isArray(message.caption_entities) ? message.caption_entities : []);
  const candidates = [];
  entities.forEach(function(entity) {
    entity = entity || {};
    if (entity.type === 'text_link' && entity.url) candidates.push(String(entity.url));
    if (entity.type === 'url') candidates.push(text.slice(Number(entity.offset) || 0, (Number(entity.offset) || 0) + (Number(entity.length) || 0)));
  });
  Array.prototype.push.apply(candidates, text.match(/https:\/\/app\.estimates\.guru\/snapshot\/[A-Za-z0-9_-]{6,128}(?:[/?#][^\s<>]*)?/ig) || []);
  for (let i = 0; i < candidates.length; i++) {
    const normalized = normalizeEstimateGuruSnapshotUrl_(candidates[i]);
    if (normalized) return normalized.url;
  }
  return '';
}

function telegramBanquetSenderName_(message) {
  const sender = message && (message.from || message.sender_chat) || {};
  return [sender.first_name, sender.last_name].filter(Boolean).join(' ').trim() || String(sender.title || sender.username || 'Telegram');
}

function telegramBanquetSourceChatId_() {
  return String(PropertiesService.getScriptProperties().getProperty('TELEGRAM_BANQUET_SOURCE_CHAT_ID') || '').trim();
}

function handleFoxBanquetTelegramWebhook_(e) {
  const props = PropertiesService.getScriptProperties();
  const expectedSecret = String(props.getProperty('TELEGRAM_BANQUET_WEBHOOK_SECRET') || '');
  const actualSecret = String(e && e.parameter && e.parameter.secret || '');
  if (!expectedSecret || !constantTimeEqual_(expectedSecret, actualSecret)) return textOutput_({ ok:false, error:'unauthorized' });

  let update;
  try { update = JSON.parse(String(e && e.postData && e.postData.contents || '{}')); }
  catch (_) { return textOutput_({ ok:true, ignored:true, reason:'invalid_update' }); }
  const message = update.message || update.edited_message || null;
  if (!message) return textOutput_({ ok:true, ignored:true, reason:'unsupported_update' });

  const sourceChatId = telegramBanquetSourceChatId_();
  const chatId = String(message.chat && message.chat.id || '');
  if (!sourceChatId || chatId !== sourceChatId) return textOutput_({ ok:true, ignored:true, reason:'other_chat' });

  const snapshotUrl = telegramBanquetSnapshotUrlFromMessage_(message);
  if (!snapshotUrl) return textOutput_({ ok:true, ignored:true, reason:'no_estimate_snapshot' });
  const normalized = normalizeEstimateGuruSnapshotUrl_(snapshotUrl);
  const claim = claimFoxBanquetImport_(normalized.id);
  if (!claim.claimed) return textOutput_({ ok:true, status:claim.status, banquetId:'estimate_' + normalized.id });

  try {
    const result = importFoxBanquetFromEstimateGuru_(message, normalized);
    finishFoxBanquetImport_(normalized.id, 'DONE', result.banquetId, '');
    return textOutput_({ ok:true, status:'imported', banquetId:result.banquetId, reserve:result.reserve });
  } catch (err) {
    finishFoxBanquetImport_(normalized.id, 'FAILED', 'estimate_' + normalized.id, errorText_(err));
    notifyFoxBanquetImportFailure_(message);
    console.error('FO’X banquet Telegram autoimport failed: ' + errorText_(err));
    return textOutput_({ ok:true, status:'failed', banquetId:'estimate_' + normalized.id });
  }
}

function claimFoxBanquetImport_(snapshotId) {
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock ? LockService.getScriptLock() : LockService.getDocumentLock();
  if (!lock.tryLock(10000)) return { claimed:false, status:'busy' };
  try {
    cleanupFoxBanquetImportStates_(props, Date.now());
    const key = FOX_BANQUET_TELEGRAM.statePrefix + snapshotId;
    const state = parseJsonSafe_(String(props.getProperty(key) || '{}'));
    const age = Date.now() - Number(state.updatedAt || 0);
    if (state.status === 'DONE') return { claimed:false, status:'duplicate' };
    if (state.status === 'PROCESSING' && age >= 0 && age < FOX_BANQUET_TELEGRAM.processingTtlMs) return { claimed:false, status:'processing' };
    props.setProperty(key, JSON.stringify({ status:'PROCESSING', updatedAt:Date.now(), banquetId:'estimate_' + snapshotId }));
    return { claimed:true, status:'processing' };
  } finally { lock.releaseLock(); }
}

function finishFoxBanquetImport_(snapshotId, status, banquetId, error) {
  PropertiesService.getScriptProperties().setProperty(
    FOX_BANQUET_TELEGRAM.statePrefix + snapshotId,
    JSON.stringify({ status:String(status || ''), updatedAt:Date.now(), banquetId:String(banquetId || ''), error:String(error || '').slice(0, 500) })
  );
}

function cleanupFoxBanquetImportStates_(props, nowMs) {
  const all = props.getProperties();
  Object.keys(all).filter(function(key) { return key.indexOf(FOX_BANQUET_TELEGRAM.statePrefix) === 0; }).forEach(function(key) {
    const state = parseJsonSafe_(String(all[key] || '{}'));
    if (nowMs - Number(state.updatedAt || 0) > FOX_BANQUET_TELEGRAM.stateRetentionMs) props.deleteProperty(key);
  });
}

function estimateGuruPdfCandidateUrls_(html) {
  const text = String(html || '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const urls = [];
  const seen = {};
  function add(url) {
    url = String(url || '').trim().replace(/["'<>]+$/g, '');
    if (url.indexOf('//') === 0) url = 'https:' + url;
    if (url.indexOf('/') === 0) url = 'https://app.estimates.guru' + url;
    if (!/^https:\/\//i.test(url) || !/(?:\.pdf(?:[?#]|$)|\/pdf(?:[/?#]|$)|download)/i.test(url) || seen[url]) return;
    seen[url] = true;
    urls.push(url);
  }
  (text.match(/https:\/\/[^"'\\\s<>]+/gi) || []).forEach(add);
  const attr = /(?:href|src|url|pdfUrl|pdf_url|downloadUrl)\s*[:=]\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attr.exec(text))) add(match[1]);
  return urls.slice(0, 10);
}

function fetchEstimateGuruBanquetSource_(snapshotUrl) {
  const normalized = normalizeEstimateGuruSnapshotUrl_(snapshotUrl);
  if (!normalized) throw new Error('Некорректная ссылка Estimates Guru.');
  const response = UrlFetchApp.fetch(normalized.url, { muteHttpExceptions:true, followRedirects:true });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('Estimates Guru не отдал банкет: HTTP ' + code);
  const bytes = response.getBlob().getBytes();
  if (!bytes || bytes.length < 100) throw new Error('Estimates Guru вернул пустой документ.');
  if (bytes.length > FOX_BANQUET_TELEGRAM.maxSourceBytes) throw new Error('Документ банкета слишком большой.');
  if (isPdfBytes_(bytes)) return { kind:'pdf', data:Utilities.base64Encode(bytes), sourceUrl:normalized.url };

  const html = response.getContentText();
  const candidates = estimateGuruPdfCandidateUrls_(html);
  for (let i = 0; i < candidates.length; i++) {
    try {
      const pdfResponse = UrlFetchApp.fetch(candidates[i], { muteHttpExceptions:true, followRedirects:true });
      if (pdfResponse.getResponseCode() < 200 || pdfResponse.getResponseCode() >= 300) continue;
      const pdfBytes = pdfResponse.getBlob().getBytes();
      if (pdfBytes && pdfBytes.length >= 100 && pdfBytes.length <= FOX_BANQUET_TELEGRAM.maxSourceBytes && isPdfBytes_(pdfBytes)) {
        return { kind:'pdf', data:Utilities.base64Encode(pdfBytes), sourceUrl:normalized.url, pdfUrl:candidates[i] };
      }
    } catch (_) {}
  }
  if (html && html.length >= 200) return { kind:'html', text:html.slice(0, 500000), sourceUrl:normalized.url };
  throw new Error('Не удалось получить PDF банкета из Estimates Guru.');
}

function recognizeEstimateGuruBanquet_(source, message) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('В Script Properties не задан GEMINI_API_KEY.');
  const model = normalizeGeminiModel_(props.getProperty('GEMINI_MODEL') || FOX_RECEIPTS.defaultGeminiModel);
  const catalogText = readStockCatalog_().map(function(item) { return item.sheet + ' | ' + item.name + ' | ' + (item.unit || ''); }).join('\n');
  const messageText = String(message && (message.text || message.caption) || '').trim();
  const prompt = [
    'Ты разбираешь PDF/снимок предзаказа Estimates Guru для ресторана FO’X.',
    'PDF — главный источник; Telegram-текст используй только для сверки.',
    'Номер телефона и любые контактные данные игнорируй полностью: не возвращай их ни в одном поле, notes или item.',
    'Верни только JSON без Markdown.',
    'event_date — дата проведения: ДД.ММ или ДД.ММ.ГГГГ. Не придумывай год, если его нет.',
    'event_time — время мероприятия/брони, не время подачи блюда.',
    'guest_name — имя гостя. guest_count — количество персон. event_type — тип события, например «др».',
    'total_amount — финальная строка «Итого», включая сервисный сбор, если он уже включён.',
    'order_items — ВСЕ реальные позиции предзаказа с количеством больше нуля. Исключи заголовки, строки «Всего/Итого», сервисный сбор и пустые нулевые строки.',
    'Для order_items верни category, name, quantity, unit, serving_time, line_total.',
    'reserve_items — только готовые складские товары, которые реально нужно резервировать: бутилированная вода/напитки, пиво, вино, крепкий алкоголь и другие готовые товарные позиции.',
    'Не добавляй блюда кухни, салаты, горячие блюда, выпечку, десерты, услуги и коктейли. Не раскладывай блюда/коктейли на ингредиенты.',
    'suggested_stock_name выбирай только как ТОЧНОЕ название из каталога. Если уверенности нет — оставь пустым.',
    'ignored — только названия позиций/категорий, исключённых из складского резерва. Контактные данные туда не включай.',
    '', 'ТЕКСТ TELEGRAM:', messageText,
    '', 'КАТАЛОГ СТОКА FO’X (лист | точное наименование | единица):', catalogText
  ].join('\n');
  const schema = {
    type:'OBJECT', properties:{
      event_date:{type:'STRING'}, event_time:{type:'STRING'}, guest_name:{type:'STRING'}, guest_count:{type:'NUMBER'}, event_type:{type:'STRING'}, total_amount:{type:'NUMBER'},
      order_items:{type:'ARRAY',items:{type:'OBJECT',properties:{category:{type:'STRING'},name:{type:'STRING'},quantity:{type:'NUMBER'},unit:{type:'STRING'},serving_time:{type:'STRING'},line_total:{type:'NUMBER'}},required:['category','name','quantity','unit','serving_time','line_total']}},
      reserve_items:{type:'ARRAY',items:{type:'OBJECT',properties:{raw_name:{type:'STRING'},quantity:{type:'NUMBER'},unit:{type:'STRING'},suggested_stock_name:{type:'STRING'},notes:{type:'STRING'}},required:['raw_name','quantity','unit','suggested_stock_name','notes']}},
      ignored:{type:'ARRAY',items:{type:'STRING'}}
    }, required:['event_date','event_time','guest_name','guest_count','event_type','total_amount','order_items','reserve_items','ignored']
  };
  const mediaPart = source.kind === 'pdf' ? { inlineData:{ mimeType:'application/pdf', data:source.data } } : { text:'HTML SNAPSHOT:\n' + String(source.text || '') };
  const parts = [mediaPart, { text:prompt }];
  const structured = { contents:[{ role:'user', parts:parts }], generationConfig:{ responseMimeType:'application/json', responseSchema:schema, temperature:0, maxOutputTokens:8192 } };
  let parsed;
  try { parsed = parseGeminiJsonResult_(callGeminiGenerateContent_(apiKey, model, structured).text); }
  catch (firstError) {
    if (!/INVALID_ARGUMENT|invalid argument|HTTP 400/i.test(errorText_(firstError))) throw firstError;
    parsed = parseGeminiJsonResult_(callGeminiGenerateContent_(apiKey, model, { contents:[{ role:'user', parts:parts }], generationConfig:{ responseMimeType:'application/json', temperature:0, maxOutputTokens:8192 } }).text);
  }
  return sanitizeEstimateGuruBanquet_(parsed, message);
}

function normalizeEstimateGuruBanquetTime_(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hours = Number(match[1]); const minutes = Number(match[2]);
  return Number.isInteger(hours) && Number.isInteger(minutes) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
    ? String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') : '';
}

function normalizeEstimateGuruBanquetDate_(value, messageDate) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const iso = match[1] + '-' + pad2_(match[2]) + '-' + pad2_(match[3]);
    if (!isRealFoxScheduleDate_(iso)) throw new Error('Некорректная дата банкета: ' + text);
    return iso;
  }
  match = text.match(/^(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?$/);
  if (!match) throw new Error('Не удалось определить дату банкета.');
  const day = Number(match[1]); const month = Number(match[2]);
  let year;
  if (match[3]) year = Number(match[3].length === 2 ? '20' + match[3] : match[3]);
  else {
    const published = new Date((Number(messageDate) || Math.floor(Date.now() / 1000)) * 1000);
    const publishedKey = Utilities.formatDate(published, Session.getScriptTimeZone() || 'Europe/Moscow', 'yyyy-MM-dd');
    year = Number(publishedKey.slice(0, 4));
    const candidateMs = Date.UTC(year, month - 1, day);
    const publishedParts = publishedKey.split('-').map(Number);
    const publishedMs = Date.UTC(publishedParts[0], publishedParts[1] - 1, publishedParts[2]);
    if (candidateMs < publishedMs - 45 * 24 * 60 * 60 * 1000) year++;
  }
  const iso = String(year) + '-' + pad2_(month) + '-' + pad2_(day);
  if (!isRealFoxScheduleDate_(iso)) throw new Error('Некорректная дата банкета: ' + text);
  return iso;
}

function sanitizeEstimateGuruBanquet_(parsed, message) {
  parsed = parsed && typeof parsed === 'object' ? parsed : {};
  const orderItems = Array.isArray(parsed.order_items) ? parsed.order_items.map(function(item) {
    return { category:String(item && item.category || '').trim(), name:String(item && item.name || '').trim(), quantity:number_(item && item.quantity), unit:String(item && item.unit || '').trim(), servingTime:normalizeEstimateGuruBanquetTime_(item && item.serving_time), lineTotal:number_(item && item.line_total) };
  }).filter(function(item) { return item.name && item.quantity > 0; }) : [];
  const reserveItems = Array.isArray(parsed.reserve_items) ? parsed.reserve_items.map(function(item) {
    return { rawName:String(item && item.raw_name || '').trim(), quantity:number_(item && item.quantity), unit:String(item && item.unit || '').trim(), suggestedStockName:String(item && item.suggested_stock_name || '').trim(), notes:String(item && item.notes || '').trim() };
  }).filter(function(item) { return item.rawName && item.quantity > 0; }) : [];
  return {
    date:normalizeEstimateGuruBanquetDate_(parsed.event_date, message && message.date),
    time:normalizeEstimateGuruBanquetTime_(parsed.event_time),
    guestName:String(parsed.guest_name || '').trim(), guestCount:Math.max(0, Math.round(number_(parsed.guest_count))), eventType:String(parsed.event_type || '').trim(),
    totalAmount:number_(parsed.total_amount), orderItems:orderItems, reserveItems:reserveItems,
    ignored:Array.isArray(parsed.ignored) ? parsed.ignored.map(String).filter(Boolean) : []
  };
}

function buildEstimateGuruBanquetComment_(data, message, snapshotUrl) {
  const sourceText = String(message && (message.text || message.caption) || '').replace(/https:\/\/app\.estimates\.guru\/snapshot\/[A-Za-z0-9_-]{6,128}(?:[/?#][^\s<>]*)?/ig, '').replace(/\n{3,}/g, '\n\n').trim();
  const lines = [];
  if (data.eventType) lines.push('Событие: ' + data.eventType);
  if (data.guestCount) lines.push('Гостей: ' + data.guestCount);
  if (sourceText) lines.push('Комментарий из Telegram: ' + sourceText);
  if (data.totalAmount > 0) lines.push('Итого по предзаказу: ' + data.totalAmount + ' ₽');
  lines.push('Источник: ' + snapshotUrl);
  if (data.orderItems.length) {
    lines.push('', 'Предзаказ:');
    data.orderItems.forEach(function(item) {
      lines.push('• ' + (item.category ? item.category + ' — ' : '') + item.name + ' — ' + (Math.round(number_(item.quantity) * 1000) / 1000) + (item.unit ? ' ' + item.unit : '') + (item.servingTime ? ' · подача ' + item.servingTime : ''));
    });
  }
  return lines.join('\n').slice(0, 45000);
}

function saveImportedFoxCalendarBanquet_(data, auth) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) throw new Error('Таблица банкетов сейчас занята. Повторите попытку.');
  try {
    const sh = foxCalendarBanquetSheet_();
    const id = requiredString_(data.id, 'banquet id');
    const date = normalizeFoxScheduleDate_(data.date);
    const time = normalizeEstimateGuruBanquetTime_(data.time);
    const name = String(data.name || '').trim();
    const comment = String(data.comment || '').trim();
    if (!time) throw new Error('Не удалось определить время банкета.');
    if (!name) throw new Error('Не удалось определить имя/название банкета.');
    const rowNumber = foxCalendarBanquetRowById_(sh, id);
    if (rowNumber) {
      sh.getRange(rowNumber, 2, 1, 4).setValues([[date, time, name, comment]]);
      sh.getRange(rowNumber, 6).setValue('Актуально');
      sh.getRange(rowNumber, 10, 1, 2).setValues([[auth.userId, auth.userName]]);
    } else {
      const next = sh.getLastRow() + 1;
      sh.getRange(next, 1, 1, FOX_RECEIPTS.banquets.cols.deleted).setValues([[id, date, time, name, comment, 'Актуально', '', '', new Date(), auth.userId, auth.userName, '']]);
    }
    const storedRow = rowNumber || sh.getLastRow();
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function(value) { return String(value || '').trim(); });
    const finalAmountColumn = headers.indexOf('Итоговая сумма банкета') + 1;
    if (finalAmountColumn && data.totalAmount > 0) sh.getRange(storedRow, finalAmountColumn).setValue(data.totalAmount);
    SpreadsheetApp.flush();
    const stored = sh.getRange(storedRow, 1, 1, sh.getLastColumn()).getValues()[0];
    return foxCalendarBanquetClientItem_(stored, headers.indexOf('Media JSON') + 1, finalAmountColumn, foxCalendarBanquetClosureColumnsFromHeaders_(headers));
  } finally { lock.releaseLock(); }
}

function importFoxBanquetFromEstimateGuru_(message, normalizedSnapshot) {
  const source = fetchEstimateGuruBanquetSource_(normalizedSnapshot.url);
  const data = recognizeEstimateGuruBanquet_(source, message);
  if (!data.time) throw new Error('Не удалось определить время банкета.');
  if (!data.guestName && !data.eventType) throw new Error('Не удалось определить название банкета.');
  const banquetId = 'estimate_' + normalizedSnapshot.id;
  const displayName = (data.guestName || data.eventType || 'Банкет') + (data.guestCount ? ' · ' + data.guestCount + ' персон' : '');
  const auth = { userId:String(message && message.from && message.from.id || message && message.sender_chat && message.sender_chat.id || ''), userName:telegramBanquetSenderName_(message), chatId:String(message && message.chat && message.chat.id || ''), venue:'fox' };
  const item = saveImportedFoxCalendarBanquet_({ id:banquetId, date:data.date, time:data.time, name:displayName, comment:buildEstimateGuruBanquetComment_(data, message, normalizedSnapshot.url), totalAmount:data.totalAmount }, auth);
  const matched = matchBanquetItems_(data.reserveItems);
  const reserve = matched.length || data.ignored.length ? saveBanquetReserve_(banquetId, data.date, displayName, '', matched, data.ignored) : { banquetId:banquetId, recognized:false, matchedCount:0, ignoredCount:0, unknownCount:0 };
  return { banquetId:banquetId, item:item, reserve:reserve, orderItems:data.orderItems.length };
}

function notifyFoxBanquetImportFailure_(message) {
  try {
    const token = String(PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || '');
    const chatId = String(message && message.chat && message.chat.id || '');
    if (!token || !chatId) return;
    telegramApiCall_(token, 'sendMessage', { chat_id:chatId, reply_to_message_id:message.message_id, text:'⚠️ FO’X не смог автоматически загрузить банкет из Estimates Guru. Проверьте ссылку и отправьте сообщение повторно.', disable_web_page_preview:true });
  } catch (_) {}
}

function foxBanquetsCaptureTelegramSourceChat() {
  const props = PropertiesService.getScriptProperties();
  const token = String(props.getProperty('TELEGRAM_BOT_TOKEN') || '');
  if (!token) throw new Error('В Script Properties не задан TELEGRAM_BOT_TOKEN.');
  const webhook = telegramApiCall_(token, 'getWebhookInfo', {});
  if (webhook && webhook.result && webhook.result.url) throw new Error('У бота уже включён webhook. Задайте TELEGRAM_BANQUET_SOURCE_CHAT_ID вручную или временно отключите webhook.');
  const updates = telegramApiCall_(token, 'getUpdates', { offset:-100, limit:100, timeout:0, allowed_updates:JSON.stringify(['message','edited_message']) });
  const rows = (updates && updates.result || []).map(function(update) { return update.message || update.edited_message || null; }).filter(Boolean);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!telegramBanquetSnapshotUrlFromMessage_(rows[i])) continue;
    const chatId = String(rows[i].chat && rows[i].chat.id || '');
    if (!chatId) continue;
    props.setProperty('TELEGRAM_BANQUET_SOURCE_CHAT_ID', chatId);
    return { ok:true, chatId:chatId, title:String(rows[i].chat && (rows[i].chat.title || rows[i].chat.username) || '') };
  }
  throw new Error('Сообщение Estimates Guru не найдено. Убедитесь, что бот видит сообщения группы.');
}

function foxBanquetsConfigureTelegramWebhook() {
  const props = PropertiesService.getScriptProperties();
  const token = String(props.getProperty('TELEGRAM_BOT_TOKEN') || '');
  if (!token) throw new Error('В Script Properties не задан TELEGRAM_BOT_TOKEN.');
  if (!telegramBanquetSourceChatId_()) throw new Error('Сначала задайте TELEGRAM_BANQUET_SOURCE_CHAT_ID или выполните foxBanquetsCaptureTelegramSourceChat().');
  const serviceUrl = String(ScriptApp.getService().getUrl() || '');
  if (!serviceUrl) throw new Error('Web App ещё не опубликован. Выполните deployment Apps Script.');
  let secret = String(props.getProperty('TELEGRAM_BANQUET_WEBHOOK_SECRET') || '');
  if (!secret) { secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); props.setProperty('TELEGRAM_BANQUET_WEBHOOK_SECRET', secret); }
  const webhookUrl = serviceUrl + '?action=telegramBanquetWebhook&secret=' + encodeURIComponent(secret);
  const current = telegramApiCall_(token, 'getWebhookInfo', {});
  const currentUrl = String(current && current.result && current.result.url || '');
  if (currentUrl && currentUrl !== webhookUrl) throw new Error('У FO’X-бота уже настроен другой webhook. Автоматическая замена остановлена.');
  const result = telegramApiCall_(token, 'setWebhook', { url:webhookUrl, allowed_updates:JSON.stringify(['message','edited_message']), drop_pending_updates:false });
  if (!result || !result.ok) throw new Error('Telegram не принял webhook.');
  props.setProperty('TELEGRAM_BANQUET_WEBHOOK_CONFIGURED_AT', new Date().toISOString());
  return { ok:true, sourceChatId:telegramBanquetSourceChatId_(), webhookConfigured:true };
}

function foxBanquetsDisableTelegramWebhook() {
  const token = String(PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || '');
  if (!token) throw new Error('В Script Properties не задан TELEGRAM_BOT_TOKEN.');
  const result = telegramApiCall_(token, 'deleteWebhook', { drop_pending_updates:false });
  if (!result || !result.ok) throw new Error('Telegram не отключил webhook.');
  return { ok:true };
}
