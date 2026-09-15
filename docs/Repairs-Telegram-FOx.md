# FO’X Telegram → Galaxy Repairs

## Статус

Интеграция FO’X Telegram с Galaxy Repairs уже частично работает в production Apps Script и подтверждена живыми тестами.

Подтверждено:

- FO’X bot остаётся на существующем stock Apps Script webhook;
- webhook переведён на актуальный `/exec` deployment;
- `callback_query` включён в `allowed_updates`;
- нажатие `🔧 Ремонт` доходит до Apps Script;
- бот отвечает пользователю и запускает Repair flow;
- повторные callback/update больше не создают дубли сообщений;
- защита от дублей подтверждена живым тестом: один клик → одно сообщение.

Ещё не завершено:

- постоянное нижнее меню;
- полный живой flow до фактического создания заявки и проверки строки в `Galaxy Repairs`;
- стабильное хранение фото;
- Pachca integration;
- Tatooine integration.

Исходник адаптера:

`apps-script/repairs/production/FoxTelegramAdapter.gs`

## Почему адаптер идёт через существующий FO’X webhook

У Telegram-бота может быть только один webhook. FO’X уже использует webhook для автоматического импорта банкетов, поэтому нельзя направить того же бота напрямую в отдельный Repair Backend.

Правильная схема:

```text
Telegram FO’X bot
      |
      v
существующий FO’X Apps Script webhook
      |--- banquet update -> текущая логика банкетов
      |
      `--- repair update -> FoxTelegramAdapter.gs
                              |
                              v
                      Galaxy Repair Backend
                              |
                              v
                       Galaxy Repairs Sheet
```

## Script Properties в FO’X Apps Script

Нужны без коммита секретов в Git:

- `REPAIR_BACKEND_URL` — URL опубликованного Galaxy Repair Backend;
- `REPAIR_API_KEY` — тот же ключ, который задан в Repair Backend;
- `TELEGRAM_BOT_TOKEN` — существующий token FO’X Telegram bot.

Секреты не хранить в Git и документации значениями.

## Хук в текущем Telegram webhook

После парсинга Telegram update и до banquet-specific обработки Repair adapter получает update первым.

Логика:

```javascript
if (foxRepairHandleTelegramUpdate_(update)) {
  return textOutput_({ ok:true, handled:'repair' });
}
```

Если update не относится к активному Repair flow, adapter возвращает `false`, и существующая логика FO’X продолжает работу.

## Telegram webhook

Webhook должен быть настроен на актуальный production Web App URL с `/exec`.

Разрешённые updates:

```text
message
edited_message
callback_query
```

Во время внедрения выявлено два реальных источника проблемы:

1. webhook был направлен на старый deployment ID;
2. одна из промежуточных конфигураций использовала `/dev` вместо `/exec`.

После перевязки на актуальный `/exec` callback стал доходить до текущего кода.

Практическое правило: после создания новой deployment-версии всегда сверять реальный webhook URL Telegram с активным Apps Script deployment.

## Repair button

Рабочая тестовая кнопка:

```javascript
{ text: '🔧 Ремонт', callback_data: 'repair:start' }
```

Она использовалась для проверки callback flow.

Старый подход с отдельным сообщением `FO’X -> Выбери действие -> 🔧 Ремонт` не является целевым UX, потому что такое сообщение постепенно уезжает вверх по истории.

## Целевой UX

Согласованный вариант:

```text
постоянная нижняя кнопка: Меню
        |
        v
бот присылает актуальное inline menu:
- 📱 Fo'x App
- 🔧 Ремонт
```

То есть пользователь не ищет старое сообщение с кнопкой. Входная кнопка `Меню` всегда доступна рядом с полем ввода.

## Диалог Repair MVP

1. Пользователь открывает `Меню`.
2. Нажимает `🔧 Ремонт`.
3. Бот просит описать проблему и позволяет приложить Telegram photo.
4. Adapter хранит временный draft.
5. Зона пытается определиться из текста.
6. Если зона не определилась — показывает Бар / Кухня / Зал / Бэк.
7. Срочность предварительно определяется простыми правилами.
8. Бот показывает карточку подтверждения.
9. `✅ Отправить` вызывает `createTicket` отдельного Repair Backend.
10. Пользователь получает публичный ID `FOX-REP-....`.

## Дедупликация Telegram updates

В живом тесте Telegram callback обрабатывался несколько раз, из-за чего один клик приводил к нескольким одинаковым сообщениям.

В adapter добавлена двойная защита:

- дедупликация по Telegram update/callback identity;
- кратковременная блокировка повторного одинакового действия одного пользователя.

После исправления подтверждено: один клик `🔧 Ремонт` создаёт одно сообщение.

Это важно оставить и для следующих callback-кнопок (`zone`, `send`, `edit`, `cancel`).

## Фото

На текущем этапе сохраняется Telegram `file_id` в `Public ID фото`.

Это не постоянное внешнее хранилище. Перед передачей фото в Pachca нужно добавить controlled download/copy в стабильное хранилище и сохранять постоянный URL.

## Диагностика

Для проблем webhook полезно отдельно различать:

- Telegram не отправил callback;
- callback пришёл не в тот deployment;
- callback пришёл, но упал внутри Apps Script;
- callback обработался несколько раз.

Apps Script execution list подтвердил, что callback requests реально доходили в `doPost`.

Когда стандартные execution logs не были доступны, использовалась временная собственная диагностика через Script Properties.

## Что не делать

- не направлять FO’X Telegram bot напрямую на Repair Backend;
- не использовать `/dev` как production Telegram webhook;
- не считать новый deployment активным, пока не проверен реальный webhook URL;
- не класть `REPAIR_API_KEY` или bot token в Git;
- не хранить Repair tickets в stock/cash spreadsheet;
- не удалять дедупликацию callback/update;
- не считать интеграцию полностью готовой, пока не проверен полный flow до реальной записи тикета.

## Следующий шаг

Реализовать постоянное меню:

```text
Меню
├── 📱 Fo'x App
└── 🔧 Ремонт
```

После этого прогнать полный сценарий создания реальной заявки через Telegram до `Galaxy Repairs`.
