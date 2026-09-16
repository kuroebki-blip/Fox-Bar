# FO’X Telegram → Galaxy Repairs

## Статус

По состоянию на 16.09.2026 repair-flow FO’X подтверждён живыми тестами.

Рабочая цепочка:

```text
Telegram
  -> Cloudflare Worker
  -> FO’X Apps Script repair endpoint
  -> FoxRepair adapter
  -> Galaxy Repairs Backend
  -> Galaxy Repairs Spreadsheet
```

## Почему появился Cloudflare Worker

Прямой Telegram webhook на Google Apps Script оказался нестабилен: Telegram повторно присылал один и тот же `update_id`, потому что прямой Apps Script endpoint не давал Telegram ожидаемый простой webhook-response без Google redirect поведения.

В результате один и тот же update мог повторяться через минуты, хотя adapter уже помечал его как duplicate.

Решение:

- Telegram webhook указывает на Cloudflare Worker;
- Worker сразу отвечает `200 OK`;
- Apps Script вызывается асинхронно через Worker;
- Worker следует redirect и повторяет forwarding до 3 раз при ошибке.

Worker source:

`cloudflare/fox-repair-telegram-webhook/worker.js`

## Webhook

Настройка из Apps Script:

`foxRepairConfigureDedicatedWebhook()`

Ожидаемая конфигурация:

- endpoint: Cloudflare Worker;
- `allowed_updates`: `message`, `callback_query`;
- Telegram `secret_token`: включён;
- при первичной миграции `drop_pending_updates: true`.

Безопасная диагностика:

`foxRepairShowTelegramWebhookInfo()`

Удаление текущего webhook с очисткой очереди:

`foxRepairDeleteCurrentWebhook()`

## Worker environment

Cloudflare variables/secrets:

- `GOOGLE_APPS_SCRIPT_URL` — production `/exec` FO’X Apps Script;
- `GOOGLE_APPS_SCRIPT_SECRET` — Secret;
- `TELEGRAM_WEBHOOK_SECRET` — Secret.

Значения secrets не документируются и не хранятся в Git.

## Apps Script routing

`doPost` должен направлять repair action в отдельный handler:

```javascript
if (action === 'telegramRepairWebhook') {
  return handleFoxRepairTelegramWebhook_(e);
}
```

Handler source:

`apps-script/repairs/production/FoxRepairWebhookHandler.gs`

Handler:

- проверяет `TELEGRAM_REPAIR_WEBHOOK_SECRET`;
- разбирает Telegram update;
- передаёт его в `foxRepairHandleTelegramUpdate_()`;
- пишет ошибку в repair diagnostics;
- не пробрасывает необработанную ошибку наружу.

## Banquet webhook

Repair webhook больше не должен обслуживать банкетный автоимпорт.

Для банкетов согласовано использовать отдельного Telegram-бота и отдельный webhook.

Старую функцию `telegramBanquetWebhook` нельзя считать частью repair production flow.

## UX

Синяя системная кнопка Telegram возвращена к `Fo'x App`.

Дополнительно создана закреплённая inline-карточка:

- `📱 Fo'x App`;
- `🔧 Ремонт`.

Основной repair-flow теперь message-first, поэтому сотруднику не обязательно нажимать `🔧 Ремонт`.

## Message-first flow

Если активного repair-draft нет, обычное входящее сообщение сотрудника считается началом новой заявки.

Пример:

```text
сломался холодильник
```

Если департамент не указан, бот спрашивает:

- Бар;
- Кухня;
- Зал;
- Бэк.

Если департамент явно написан в тексте, вопрос пропускается.

Пример:

```text
на кухне сломался холодильник
```

→ зона `Кухня`.

Тип оборудования сам по себе зону не определяет.

## Тип заявки

После зоны бот всегда спрашивает:

- `🚨 Аварийный` → backend value `critical`;
- `🟢 Штатный` → backend value `normal`.

Слова `сломался`, `срочно` и другие слова из свободного текста не должны автоматически выбирать тип заявки.

## Фото

После выбора типа заявки бот просит фото.

Фото опционально.

Пользователь может:

- прислать фото;
- нажать `⏭ Пропустить фото`;
- ничего не делать.

Если фото не пришло за 2 минуты, timer автоматически переводит draft к финальной карточке без фото.

Из-за minute-based trigger фактическое время обычно 2–3 минуты.

## Финальная карточка

Карточка показывает:

- ресторан;
- зону;
- нормализованную проблему;
- тип заявки;
- наличие фото.

Кнопки:

- `✅ Отправить`;
- `✏️ Изменить`;
- `✕ Отмена`.

Если `✅ Отправить` не нажали в течение 2 минут, заявка отправляется автоматически.

## Timer

Один раз вручную запускается:

`foxRepairSetupAutoSendTimers()`

Он создаёт постоянный installable trigger:

`foxRepairProcessDueDrafts`

Частота: раз в минуту.

На каждый draft отдельный trigger не создаётся и не удаляется.

## Gemini-нормализация

Свободный текст пользователя проходит через существующий Gemini-клиент FO’X.

Normalizer source:

`apps-script/repairs/production/FoxRepairGeminiNormalizer.gs`

Используются существующие:

- `GEMINI_API_KEY`;
- `GEMINI_MODEL`;
- `callGeminiGenerateContent_()`;
- `parseGeminiJsonResult_()`;
- retry settings FO’X.

Пример:

```text
пиздец брат на кухне холода наебнулся
```

может быть приведено к:

```text
Поломка холодильника
```

AI только переформулирует сообщённый факт. Он не должен придумывать диагноз или причину.

Adapter хранит:

- `rawDescription`;
- `description`;
- `normalizedDescription`.

Если Gemini падает, используется исходный текст как fallback.

## Дедупликация

Защита состоит из двух уровней:

1. `update_id`/callback dedupe в Script Properties;
2. короткий debounce одинаковых callback actions.

После Cloudflare Worker дедупликация остаётся дополнительной страховкой.

## Diagnostics

Основные функции:

- `foxRepairShowLastInternalDiagnostic()`;
- `foxRepairShowInternalDiagnosticHistory()`;
- `foxRepairClearInternalDiagnostics()`;
- `foxRepairShowTelegramWebhookInfo()`.

История diagnostics ограничивается последними событиями и хранится в Script Properties.

## Script Properties

Минимально нужны:

- `TELEGRAM_BOT_TOKEN`;
- `REPAIR_BACKEND_URL`;
- `REPAIR_API_KEY`;
- `TELEGRAM_REPAIR_WEBHOOK_SECRET`;
- `TELEGRAM_REPAIR_WORKER_URL`;
- `FOX_APP_URL`;
- `GEMINI_API_KEY`;
- `GEMINI_MODEL`.

Служебные repair properties для drafts/dedupe создаются автоматически.

## Подтверждённые живые проверки

На 16.09.2026 подтверждено:

- Worker webhook устанавливается Telegram API с `ok:true`;
- обычное сообщение запускает repair-flow;
- зона уточняется только при отсутствии явной зоны;
- ручной выбор `Аварийный/Штатный` работает;
- отсутствие фото не блокирует заявку;
- 2-минутный photo timeout отрабатывает;
- финальная заявка автоотправляется по timer;
- тикет реально создаётся;
- Gemini-нормализация текста реально отрабатывает.

## Следующие улучшения

- постоянное хранение фото вместо одного Telegram `file_id`;
- отправка/управление тикетом через Пачку;
- Tatooine Telegram adapter;
- отдельный banquet bot/webhook;
- дополнительная аналитика по оборудованию и повторным поломкам.
