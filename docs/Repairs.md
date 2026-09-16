# Galaxy Repairs

## Назначение

`Galaxy Repairs` — отдельная система технических заявок для FO’X, Tatooine и будущих ресторанов.

Источник истины — отдельная Google Spreadsheet и отдельный Apps Script Repair Backend. Ремонтные заявки не хранятся в stock/cash таблицах FO’X.

## Архитектура

Актуальная схема FO’X на 16.09.2026:

```text
сотрудник в Telegram
        |
        v
FO’X Telegram bot
        |
        v
Cloudflare Worker
fox-repair-telegram-webhook
        |
        v
FO’X stock Apps Script
?action=telegramRepairWebhook
        |
        v
FoxRepair adapter
        |
        v
Galaxy Repairs Backend
        |
        v
Galaxy Repairs Spreadsheet
```

Cloudflare Worker нужен как ingress между Telegram и Apps Script. Telegram получает быстрый `200 OK`, а Worker отдельно пересылает update в Apps Script с `redirect: follow`. Это устраняет повторную доставку одного и того же Telegram `update_id`, которая наблюдалась при прямом webhook на Apps Script.

Банкетный автоимпорт больше не должен делить webhook с ремонтом. Для банкетов планируется отдельный Telegram-бот и отдельный webhook.

## Подтверждённый живой статус

На 16.09.2026 подтверждено живыми тестами:

- таблица `Galaxy Repairs` создана;
- отдельный Repair Backend опубликован;
- `GET ping` работает;
- `POST createTicket` работает;
- реальные заявки создаются из Telegram;
- Telegram repair webhook вынесен на Cloudflare Worker;
- Worker принимает Telegram `message` и `callback_query`;
- webhook использует Telegram `secret_token`;
- старые pending updates были очищены при переключении;
- дедупликация Telegram updates работает;
- message-first flow работает: обычное сообщение пользователя может сразу начать ремонтную заявку;
- зона определяется только по явному указанию департамента в тексте;
- если зона не указана, бот спрашивает её кнопками;
- тип заявки выбирается вручную: `🚨 Аварийный` / `🟢 Штатный`;
- фото опционально;
- если фото не пришло за 2 минуты, flow продолжает без фото;
- после финальной карточки заявка автоматически отправляется, если пользователь не нажал `✅ Отправить`;
- автоотправка реализована постоянным Apps Script trigger раз в минуту;
- реальное время срабатывания 2-минутного дедлайна обычно около 2–3 минут;
- Gemini-нормализация свободного текста работает на живом тесте;
- разговорный текст с матом/ошибками преобразуется в короткую рабочую формулировку тикета без придумывания диагноза.

## Репозиторий

Основные файлы:

- `apps-script/repairs/production/Code.gs` — Repair Backend;
- `apps-script/repairs/production/FoxTelegramAdapter.gs` — Telegram adapter FO’X;
- `apps-script/repairs/production/FoxRepairWebhookHandler.gs` — отдельный repair webhook handler для stock Apps Script;
- `apps-script/repairs/production/FoxRepairGeminiNormalizer.gs` — Gemini-нормализация описания;
- `cloudflare/fox-repair-telegram-webhook/worker.js` — Cloudflare ingress;
- `docs/Repairs-Telegram-FOx.md` — эксплуатационная документация Telegram flow.

## Google Spreadsheet

Рабочее имя: `Galaxy Repairs`.

Листы:

- `Заявки` — текущее состояние каждого тикета;
- `История` — append-only журнал событий;
- `Рестораны` — список ресторанов и префиксы;
- `Зоны` — справочник зон;
- `Исполнители` — исполнители;
- `Очередь синхронизации` — будущие retries для Пачки и других систем.

ID таблицы не хранится в Git. Он задаётся Script Property `REPAIR_SPREADSHEET_ID`.

## Рестораны

| ID | Название | Префикс |
|---|---|---|
| `fox` | FO’X | `FOX` |
| `tatooine` | Tatooine | `TAT` |

Публичные ID тикетов: `FOX-REP-0001`, `TAT-REP-0001`.

## Зоны

Стартовый справочник:

- `bar` — Бар;
- `kitchen` — Кухня;
- `hall` — Зал;
- `back` — Бэк.

### Правило определения зоны

Оборудование само по себе не определяет департамент.

Примеры:

- `сломался холодильник` → зона неизвестна, бот спрашивает;
- `на кухне сломался холодильник` → `Кухня`;
- `на баре течёт кран` → `Бар`.

Это сделано специально, чтобы `холодильник` автоматически не превращался в `Кухня`.

## Тип заявки

В Telegram UI используются два варианта:

- `critical` → `🚨 Аварийный`;
- `normal` → `🟢 Штатный`.

Тип заявки не определяется из текста автоматически. Пользователь всегда подтверждает его кнопкой.

## Telegram flow FO’X

Основной сценарий:

```text
сообщение пользователя
        |
        v
Gemini нормализует формулировку
        |
        v
есть явная зона в тексте?
   |                 |
  да                нет
   |                 |
   |           спросить зону
   |                 |
   +---------> выбрать тип заявки
                     |
                     v
              запросить фото
                     |
          +----------+-----------+
          |                      |
       фото есть            2 мин без фото
          |                      |
          +----------+-----------+
                     |
                     v
              финальная карточка
                     |
          +----------+-----------+
          |                      |
      ✅ Отправить          ~2 мин без действия
          |                      |
          +----------+-----------+
                     |
                     v
               createTicket
```

### Message-first

Для FO’X обычное входящее сообщение пользователя считается потенциальным началом ремонтной заявки, если активного черновика нет.

Это соответствует текущему назначению личного чата с ботом: бот сам отправляет кассовые отчёты/PDF, а входящие пользовательские сообщения используются как ремонтный интерфейс.

Скрытый `/repair` сохранён как fallback, но не является обязательным входом в flow.

## Фото

Фото не обязательное.

После выбора типа заявки бот пишет:

`Пришли фото проблемы. Если фото не будет в течение 2 минут, я продолжу без него.`

Доступна кнопка `⏭ Пропустить фото`.

Если фото пришло — Telegram `file_id` сохраняется в черновике и затем передаётся в `photoPublicId`.

На текущем этапе `file_id` не считается постоянным внешним хранилищем. Перед полноценной доставкой фото в Пачку нужен controlled download/copy в стабильное хранилище.

## Автоотправка

После финальной карточки остаются кнопки:

- `✅ Отправить`;
- `✏️ Изменить`;
- `✕ Отмена`.

Если пользователь ничего не нажал, через 2 минуты заявка становится eligible для автоотправки.

Технически используется один постоянный installable trigger:

`foxRepairProcessDueDrafts`

Частота: раз в минуту.

Поэтому фактическая задержка составляет примерно 2–3 минуты.

Одноразовая настройка trigger:

`foxRepairSetupAutoSendTimers()`

## Gemini-нормализация

Используется уже существующая Gemini-интеграция FO’X из stock Apps Script:

- `GEMINI_API_KEY`;
- `GEMINI_MODEL`;
- `callGeminiGenerateContent_()`;
- `parseGeminiJsonResult_()`;
- существующая retry policy.

Отдельный Gemini API-клиент для ремонта не создавался.

Задача Gemini — только нормализовать текст, а не диагностировать оборудование.

Пример:

```text
Исходный текст:
«пиздец брат на кухне холода наебнулся»

Нормализованный title:
«Поломка холодильника»
```

Gemini не должен придумывать `поломку компрессора`, `утечку фреона` и другие причины, если их не сообщил пользователь.

В черновике сохраняются:

- `rawDescription` — исходный текст;
- `description` — короткий нормализованный title;
- `normalizedDescription` — нейтральная нормализованная формулировка.

Если Gemini недоступен, adapter использует исходный текст как fallback и flow не должен ломаться.

## Cloudflare Worker

Worker source:

`cloudflare/fox-repair-telegram-webhook/worker.js`

Production workers.dev endpoint используется как Telegram webhook.

Worker environment:

- `GOOGLE_APPS_SCRIPT_URL` — обычная environment variable;
- `GOOGLE_APPS_SCRIPT_SECRET` — Secret;
- `TELEGRAM_WEBHOOK_SECRET` — Secret.

`GOOGLE_APPS_SCRIPT_SECRET` и `TELEGRAM_WEBHOOK_SECRET` сейчас используют тот же shared secret, что и Apps Script Property `TELEGRAM_REPAIR_WEBHOOK_SECRET`.

Секреты не коммитятся.

Worker:

1. проверяет `X-Telegram-Bot-Api-Secret-Token`;
2. валидирует JSON body;
3. сразу отвечает Telegram `200 OK`;
4. через `ctx.waitUntil()` пересылает update в Apps Script;
5. следует Google redirect;
6. делает до 3 попыток forwarding при ошибке.

## Apps Script properties FO’X

Repair flow использует:

- `TELEGRAM_BOT_TOKEN`;
- `REPAIR_BACKEND_URL`;
- `REPAIR_API_KEY`;
- `TELEGRAM_REPAIR_WEBHOOK_SECRET`;
- `TELEGRAM_REPAIR_WORKER_URL`;
- `FOX_APP_URL`;
- `GEMINI_API_KEY`;
- `GEMINI_MODEL`.

Также adapter создаёт служебные properties для drafts, дедупликации и diagnostics.

## Telegram UI

Синяя системная кнопка Telegram сохранена как `Fo'x App`.

Для управления также используется закреплённая inline-карточка с:

- `📱 Fo'x App`;
- `🔧 Ремонт`.

Однако для основной подачи заявки кнопка `🔧 Ремонт` больше не обязательна благодаря message-first flow.

## Дедупликация

Adapter хранит recent Telegram `update_id` в Script Properties и пропускает повторную обработку одного update.

Дополнительно действует короткий debounce одинаковых callback actions.

Это остаётся защитным слоем даже после выноса webhook на Cloudflare Worker.

## Repair Backend API

Required Script Properties backend:

- `REPAIR_SPREADSHEET_ID`;
- `REPAIR_API_KEY`.

MVP actions:

- `ping`;
- `createTicket`;
- `getTicket`;
- `listTickets`;
- `changeStatus`;
- `addComment`.

## Статусы

- `new` — 🆕 Новая;
- `in_progress` — 🔧 В работе;
- `waiting` — ⏸ Ожидает;
- `done` — ✅ Выполнена.

Разрешённые переходы MVP:

```text
new -> in_progress
in_progress -> waiting | done
waiting -> in_progress | done
done -> in_progress
```

## История и аналитика

`История` append-only. Из timestamps/events в будущем считаются:

- reaction time;
- active work time;
- waiting time;
- total resolution time;
- нагрузка на исполнителя;
- повторяющиеся поломки.

## Pachca

Следующий крупный интеграционный этап:

- отправка созданного тикета в Пачку;
- `🔧 Принять в работу`;
- `⏸ Стоп/Ожидает`;
- `✅ Выполнено`;
- комментарии/треды → append-only events;
- синхронизация статусов с Repair Backend.

## Безопасность

- секреты только в Script Properties / Cloudflare Secrets;
- секреты не хранятся в Git;
- Worker проверяет Telegram secret token;
- Apps Script проверяет отдельный shared secret;
- исходная Repair таблица отделена от stock/cash;
- внешние update дедуплицируются;
- AI не должен придумывать диагноз;
- production flow считается подтверждённым только после живого теста.

## Следующий этап

1. Стабилизировать постоянное хранение фото.
2. Подключить Pachca workflow.
3. Добавить Tatooine adapter поверх того же Repair Backend.
4. После этого расширять аналитику и классификацию оборудования.
