# FO’X Telegram → Galaxy Repairs

## Статус

Код адаптера подготовлен, но в production Telegram webhook пока не задеплоен.

Исходник адаптера:

`apps-script/repairs/production/FoxTelegramAdapter.gs`

## Почему адаптер идёт через существующий FO’X webhook

У Telegram-бота может быть только один webhook. FO’X уже использует webhook для автоматического импорта банкетов, поэтому нельзя направить того же бота напрямую в отдельный Repair Backend: это сломает текущий поток банкетов.

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

## Script Properties в FO’X Telegram Apps Script

Добавить без коммита секретов в Git:

- `REPAIR_BACKEND_URL` — URL опубликованного Galaxy Repair Backend;
- `REPAIR_API_KEY` — тот же ключ, который задан в Repair Backend;
- `TELEGRAM_BOT_TOKEN` уже используется существующим FO’X backend.

## Хук в текущем Telegram webhook

После парсинга Telegram update и до банкетной обработки вызвать:

```javascript
if (foxRepairHandleTelegramUpdate_(update)) {
  return textOutput_({ ok:true, handled:'repair' });
}
```

Только repair callbacks/messages будут перехвачены. Обычные сообщения без активного repair draft вернут `false` и продолжат существующий banquet flow.

## Кнопка

Адаптер экспортирует:

```javascript
foxRepairStartButton_()
```

Она возвращает Telegram inline button:

```javascript
{ text: '🔧 Ремонт', callback_data: 'repair:start' }
```

Её нужно поставить рядом с существующей кнопкой `Fo'x App` в текущем меню бота.

## Диалог MVP

1. Пользователь нажимает `🔧 Ремонт`.
2. Бот просит описать проблему и разрешает прислать фото обычным Telegram сообщением.
3. Адаптер запоминает черновик на 6 часов.
4. Зона пытается определиться из текста; если не определилась — кнопки Бар / Кухня / Зал / Бэк.
5. Срочность MVP определяется простыми безопасными правилами и отображается перед отправкой.
6. Бот показывает подтверждение.
7. `✅ Отправить` вызывает `createTicket` отдельного Repair Backend.
8. Пользователь получает публичный ID заявки (`FOX-REP-....`).

## Фото

На первом этапе в Repair Backend сохраняется Telegram `file_id` в поле `Public ID фото`. Это не постоянное внешнее хранилище. Перед Pachca photo delivery нужно добавить controlled download/copy в стабильное хранилище (например, уже используемый Cloudinary path) и сохранить постоянный URL.

## Что не делать

- не менять Telegram webhook FO’X на Repair Backend URL;
- не класть `REPAIR_API_KEY` или bot token в Git;
- не хранить repair tickets в stock/cash spreadsheet;
- не считать интеграцию production-ready до живого теста кнопки, текста, фото и создания тикета.
