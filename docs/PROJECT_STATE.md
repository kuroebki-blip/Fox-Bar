# FO’X — состояние проекта на момент переноса в Codex

## Production

22 июля 2026 опубликована и автоматически проверена пара:

- GitHub Pages: frontend `v15.13.3 SCANNER JOB SAFETY`, merge commit `10f766c11deabfe0403af1640e266e6dbc998a6f`;
- Apps Script scanner/stock Web App: backend `v9.4.4 CASH REPORT SOURCE RULES FIX`, Apps Script version `16`;
- рабочий Web App URL сохранён; `?action=ping` вернул `v9.4.4`;
- GitHub Pages завершил сборку со статусом `built`, публичный HTML содержит `v15.13.3` и рабочий Web App URL;
- браузерный smoke-тест открыл главную, «Документы и чеки» и «Кассовый отчёт» без критических JavaScript-ошибок.

Ещё проверить вручную:

- полный сценарий OCR и Telegram из Mini App на реальных фото;
- Apps Script banquets Web App: `?action=ping`, `?action=list`;
- Google Sheets: фактический `SPREADSHEET_ID` из Script Properties.

## Latest candidate in this repository

- `frontend/candidate/index.html`: v15.13.3 SCANNER JOB SAFETY.
- `apps-script/stock-scanner/candidate/Code.gs`: v9.4.4 CASH REPORT SOURCE RULES FIX.
- `frontend/tatooine/`: v1.0.0 CASH REPORT ONLY, отдельный modular frontend на существующем backend v9.4.4.

Candidate включает:

- быстрый JPEG pipeline для распознавания;
- кассовые отчёты;
- учёт QR на терминальных слипах;
- проверку точных платёжных строк iiko;
- инкассацию с конверта;
- повторную отправку отчёта;
- собственное окно подтверждения без отображения домена GitHub Pages;
- повторную проверку даты и нефискальной налички.
- строгий приоритет итогового блока терминального слипа;
- защиту от подгонки повторного OCR под сумму iiko;
- строгий источник даты кассовой смены — длинный отчёт iiko.
- защиту от записи старого PDF в новое задание сканера;
- раннюю проверку 20 страниц и 12 МБ OCR-изображений.

## Known open issues

1. Нельзя добавить два банкета на один день — требует диагностики по фактической production-версии.
2. После перевода банкета в «Пройден» иногда не снимается резерв.
3. Новые позиции банкета иногда не добавляются в `Банкеты_Резерв`.
4. Сканер документов требует замеров скорости на реальном Android.
5. Production v15.13.3/v9.4.4 требует живого Telegram-теста на реальных фото.
6. Tatooine v1.0.0 требует отдельного GitHub Pages URL и живого теста из существующего Telegram-бота.

## Architecture decision

Проект будет разделяться по исходным модулям, но сохранит одну Mini App и текущие Web App endpoints. Пошаговый план находится в `docs/SCANNER_MODULARIZATION_PLAN.md`; миграция начинается только после живого теста scanner candidate.
