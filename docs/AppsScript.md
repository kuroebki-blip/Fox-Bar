# Google Apps Script

## Обработчики

- Banquets Apps Script обслуживает банкеты и Google Sheets.
- Scanner/Cash Apps Script обслуживает документы, OCR, кассовые отчёты, Telegram и часть операций со стоком.

## Конфигурация

Gemini API Key, Telegram Bot Token, целевые чаты и другие закрытые параметры хранятся только в Script Properties. Frontend содержит только публичные Web App URL.

## Релиз

1. Получить фактический production исходник и сравнить с candidate.
2. Выполнить автоматические тесты.
3. Создать именованную Apps Script version.
4. Переключить существующий deployment, не создавая лишний URL без необходимости.
5. Проверить публичный `ping`.
6. Записать номер версии и откат в `PROJECT_STATE.md` и `CHANGELOG.md`.

Не запускать setup-функции без прямого подтверждения пользователя. Scanner/cash backend `v9.6.0` был проверен при релизе как Apps Script version 24, но его исходник отсутствует в `main`.
