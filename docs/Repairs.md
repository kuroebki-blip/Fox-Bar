# Galaxy Repairs

## Назначение

`Galaxy Repairs` — отдельная система технических заявок для FO’X, Tatooine и будущих ресторанов.

Источник истины — отдельная Google Spreadsheet и отдельный Apps Script backend. Система не использует stock/cash таблицы и не хранит ремонтные данные в backend FO’X/Tatooine.

## Архитектура

```text
FO’X Telegram bot ─┐
Tatooine Telegram ─┼──> Repair Backend ───> Galaxy Repairs Spreadsheet
Pachca ────────────┘           │
                               └──> Pachca API / webhook sync
```

FO’X App и Tatooine App в будущем могут читать заявки из того же Repair Backend, но не являются местом хранения данных.

## Текущий статус

На 15.09.2026 подтверждено живыми тестами:

- отдельная таблица `Galaxy Repairs` создана;
- отдельный Repair Backend опубликован как Apps Script Web App;
- `GET ping` работает;
- `POST createTicket` работает;
- тестовая заявка `FOX-REP-0002` была успешно создана через опубликованный Repair Backend;
- FO’X Telegram webhook переведён на актуальный Apps Script deployment;
- `callback_query` включён в `allowed_updates`;
- нажатие `🔧 Ремонт` доходит до FO’X Apps Script;
- Repair flow отвечает пользователю в Telegram;
- защита от повторной обработки callback/update добавлена и подтверждена живым тестом: один клик создаёт одно сообщение.

Пока не считать полностью завершёнными:

- постоянное Telegram-меню `Меню -> Fo'x App / Ремонт`;
- создание реальной заявки из полного Telegram-диалога с проверкой записи в `Galaxy Repairs`;
- стабильное хранение фото;
- Pachca workflow;
- Tatooine Telegram adapter;
- AI-разбор свободного текста.

## Google Spreadsheet

Рабочее имя: `Galaxy Repairs`.

Листы:

- `Заявки` — текущее состояние каждого тикета;
- `История` — append-only журнал всех событий;
- `Рестораны` — список ресторанов и публичные префиксы заявок;
- `Зоны` — расширяемый справочник зон;
- `Исполнители` — исполнители и их внешние идентификаторы;
- `Очередь синхронизации` — будущие retries для Пачки и других внешних систем.

ID таблицы не хранится в Git. Он задаётся Script Property `REPAIR_SPREADSHEET_ID`.

## Рестораны

Стартовые записи:

| ID | Название | Префикс |
|---|---|---|
| `fox` | FO’X | `FOX` |
| `tatooine` | Tatooine | `TAT` |

Публичные ID тикетов имеют формат `FOX-REP-0001`, `TAT-REP-0001` и генерируются под `LockService`.

Внутренний ID — UUID и не зависит от ресторана или публичного номера.

## Зоны

Стартовый общий справочник:

- `bar` — Бар;
- `kitchen` — Кухня;
- `hall` — Зал;
- `back` — Бэк.

`ID ресторана = *` означает общую зону. В дальнейшем можно добавлять зоны, привязанные только к одному ресторану.

## Статусы

Внутренние значения:

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

Повторное открытие `done -> in_progress` фиксируется событием `REOPENED`.

## Срочность

- `normal` — Обычная;
- `urgent` — Срочная;
- `critical` — Критичная.

В текущем Telegram MVP срочность предварительно определяется простыми правилами по тексту. В дальнейшем это можно заменить AI-классификацией с подтверждением пользователем.

## История событий

Лист `История` не переписывается при изменении заявки. События только добавляются.

MVP поддерживает:

- `CREATED`;
- `ACCEPTED`;
- `PAUSED`;
- `RESUMED`;
- `COMMENTED`;
- `COMPLETED`;
- `REOPENED`;
- позже `PACHCA_SENT` и `PACHCA_SYNC_ERROR`.

Поле `External Event ID` используется для дедупликации внешних событий.

Отдельно на уровне Telegram adapter добавлена защита от повторной обработки одного и того же callback/update и кратковременная защита от повторного одинакового действия пользователя.

## Время и аналитика

Текущее состояние хранит `Создано`, `Принято в работу`, `Завершено`, `Обновлено`.

Точный active/waiting time рассчитывается по append-only событиям, например:

```text
12:17 CREATED
12:25 ACCEPTED
12:48 PAUSED
14:03 RESUMED
14:36 COMPLETED
```

Из этой истории можно получить:

- reaction time;
- active work time;
- waiting time;
- total resolution time;
- нагрузку на исполнителя;
- повторяющиеся поломки.

Полноценный аналитический dashboard не входит в первый MVP.

## Repair Backend

Исходник:

`apps-script/repairs/production/Code.gs`

Required Script Properties:

- `REPAIR_SPREADSHEET_ID`;
- `REPAIR_API_KEY`.

Секреты не хранятся в Git.

Текущий MVP API:

- `ping` — GET;
- `createTicket` — POST;
- `getTicket` — POST;
- `listTickets` — POST;
- `changeStatus` — POST;
- `addComment` — POST.

Все data-операции требуют `REPAIR_API_KEY` в JSON body. Это service-to-service MVP механизм.

## FO’X Telegram integration

FO’X Telegram не направляется напрямую на Repair Backend. Используется существующий FO’X Apps Script webhook, который уже обслуживает банкетный поток.

Схема:

```text
Telegram FO’X
    |
    v
FO’X stock Apps Script webhook
    |--- repair update -> FoxRepair adapter -> Repair Backend
    `--- остальные update -> существующая логика FO’X
```

Адаптер в репозитории:

`apps-script/repairs/production/FoxTelegramAdapter.gs`

В FO’X Apps Script должны быть Script Properties:

- `TELEGRAM_BOT_TOKEN`;
- `REPAIR_BACKEND_URL`;
- `REPAIR_API_KEY`.

Telegram webhook должен принимать:

```text
message
edited_message
callback_query
```

Во время внедрения выявлено важное эксплуатационное правило: Telegram webhook должен указывать на актуальный `/exec` deployment URL, а не на старый deployment и не на `/dev`.

## Telegram UX

Текущая кнопка `🔧 Ремонт` используется как рабочий тест входа в flow.

Целевой UX согласован такой:

```text
постоянная нижняя кнопка: Меню
        |
        v
inline menu:
- 📱 Fo'x App
- 🔧 Ремонт
```

Причина: inline-сообщение с `🔧 Ремонт` уезжает вверх по истории чата, а постоянная нижняя кнопка `Меню` не теряется.

## Фото

На первом этапе Telegram adapter сохраняет Telegram `file_id` в поле `Public ID фото`.

Это не считается постоянным внешним хранилищем. Перед Pachca photo delivery нужно добавить controlled download/copy в стабильное хранилище и сохранить постоянный URL.

## Pachca

Планируемый work interface:

- `🔧 Принять в работу`;
- `⏸ Стоп/Ожидает`;
- `✅ Выполнено`;
- комментарии/треды -> append-only события;
- таймеры считаются из timestamps/events, а не постоянным редактированием сообщения.

До реализации входящего Pachca webhook нужно отдельно проверить механизм верификации подписи. Если Apps Script не позволяет надёжно прочитать нужный HTTP header, использовать отдельный ingress proxy.

## Безопасность

- Repair spreadsheet не используется stock/cash backend;
- ID таблицы и API key только в Script Properties;
- токены Pachca/Telegram не должны попадать в Git;
- `История` append-only;
- внешние webhook events должны дедуплицироваться;
- production deployment не считать подтверждённым до отдельного живого теста конкретного flow;
- deployment URL может меняться при создании нового deployment, поэтому после изменения deployment обязательно проверять фактический Telegram webhook URL.

## Следующий этап

1. Реализовать постоянную кнопку `Меню`.
2. Из `Меню` показывать `📱 Fo'x App` и `🔧 Ремонт`.
3. Прогнать полный живой Telegram flow до создания заявки в `Galaxy Repairs`.
4. После подтверждения стабилизировать хранение фото.
5. Затем подключать Pachca workflow.
