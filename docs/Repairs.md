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

AI в будущем может предложить срочность, но пользователь должен подтвердить или изменить её до создания тикета.

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

Поле `External Event ID` используется для дедупликации повторных webhook-событий.

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

## Backend

Исходник: `apps-script/repairs/production/Code.gs`.

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

Все data-операции требуют `REPAIR_API_KEY` в JSON body. Это временный service-to-service MVP механизм. Перед прямым подключением пользовательского Telegram-потока нужно добавить отдельную проверку Telegram init/update signature, а перед Pachca webhook — проверку подписи Pachca на отдельном ingress, если Apps Script не даёт надёжно прочитать нужный HTTP header.

## Что пока не подключено

На этом этапе специально НЕ подключены:

- Telegram FO’X;
- Telegram Tatooine;
- Pachca;
- Gemini/chat parsing;
- FO’X App frontend;
- Tatooine frontend.

Сначала должен быть проверен отдельный Repair Backend и CRUD/state-machine на тестовых заявках.

## Безопасность

- repair spreadsheet не используется stock/cash backend;
- ID таблицы и API key только в Script Properties;
- никакие токены Пачки/Telegram не должны попадать в Git;
- `История` append-only;
- webhook events должны дедуплицироваться по `External Event ID`;
- production deployment не считать подтверждённым до отдельного живого теста.
