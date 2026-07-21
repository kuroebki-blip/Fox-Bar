# FO’X — Deploy and Test Checklists

## GitHub Pages deploy

Когда меняется `index.html`:

1. Открыть GitHub repository.
2. Открыть файл `index.html`.
3. Нажать edit.
4. Вставить новый код.
5. Commit changes.
6. Подождать 1–2 минуты.
7. Открыть Mini App с новым параметром версии, например `?v=13`.

Номер версии каждый раз увеличивать, чтобы сбросить кэш Telegram/GitHub Pages.

## Apps Script deploy

Когда меняется Apps Script backend:

1. Открыть Apps Script.
2. Вставить новый код.
3. Проверить, что `SPREADSHEET_ID` не `PASTE...`.
4. Save.
5. Deploy / Развернуть.
6. Manage deployments / Управление развертываниями.
7. Нажать карандаш.
8. Version: New version / Новая версия.
9. Deploy / Развернуть.

Просто Save недостаточно — опубликованный Web App останется старым.

## Тест backend

Ping:
```text
https://script.google.com/macros/s/AKfycbxRlmtQMLMQ0h3NhQtInpYFAxyQxTLSgrzFClrFF3pqRqmHHxMbWrXeTc56nbAcLteZ/exec?action=ping
```

List:
```text
https://script.google.com/macros/s/AKfycbxRlmtQMLMQ0h3NhQtInpYFAxyQxTLSgrzFClrFF3pqRqmHHxMbWrXeTc56nbAcLteZ/exec?action=list
```

Норма: `{"ok":true,...}`.

## Тест банкетов без фото

1. Открыть Mini App именно в Telegram.
2. Добавить банкет без фото.
3. Проверить: появился в приложении, появился в Google Sheets, `action=list` показывает этот банкет.

## Тест банкетов с фото

1. Открыть Mini App именно в Telegram.
2. Добавить банкет с фото.
3. Проверить: в Cloudinary появилось фото, в Google Sheets есть `Image URL`, в приложении фото открывается, у другого пользователя фото тоже открывается.

## Диагностика поломок

Если `action=ping` не работает — проблема в Apps Script Web App.

Если `action=ping` работает, но `action=list` ошибка — проблема в Google Sheets, `SPREADSHEET_ID`, доступе или коде чтения.

Если банкет без фото работает, а с фото нет — проблема в Cloudinary: cloud name, upload preset, unsigned mode, формат или размер фото.

Если в таблице есть банкет, но в приложении нет — проверить колонку `Удалено`, формат даты, `action=list`, кэш Telegram `?v=...`.

Если админская форма не видна — проверить, что Mini App открыт внутри Telegram и user_id есть в `ADMIN_TELEGRAM_IDS`.
