# FO’X — состояние проекта на момент переноса в Codex

## Production

22 июля 2026 опубликована и автоматически проверена пара:

- GitHub Pages: frontend `v15.13.3 SCANNER JOB SAFETY`, merge commit `10f766c11deabfe0403af1640e266e6dbc998a6f`;
- Apps Script scanner/stock Web App: backend `v9.4.8 CASH IIKO 041 SOURCE`, Apps Script version `20`;
- рабочий Web App URL сохранён; `?action=ping` вернул `v9.4.8`;
- GitHub Pages завершил сборку со статусом `built`, публичный HTML содержит `v15.13.3` и рабочий Web App URL;
- браузерный smoke-тест открыл главную, «Документы и чеки» и «Кассовый отчёт» без критических JavaScript-ошибок.
- Tatooine: frontend `v1.3.0 IIKO 041 REPORT TEMPLATE` опубликован по адресу `https://kuroebki-blip.github.io/Fox-Bar/tatooine/`, PR №8, merge commit `e84133c1688b067adc1df0c141e2694ade7ccb37`;
- Tatooine использует отдельный Telegram-маршрут на backend `v9.4.8`; токен нового бота сохранён в Script Properties и распознан backend без раскрытия значения.

Ещё проверить вручную:

- полный сценарий OCR и Telegram из Mini App на реальных фото;
- Apps Script banquets Web App: `?action=ping`, `?action=list`;
- Google Sheets: фактический `SPREADSHEET_ID` из Script Properties.

## Latest candidate in this repository

- `frontend/candidate/index.html`: v15.13.3 SCANNER JOB SAFETY.
- `apps-script/stock-scanner/candidate/Code.gs`: v9.4.9 ENVELOPE COLLECTION SEPARATORS.
- `frontend/tatooine/`: v1.3.0 IIKO 041 REPORT TEMPLATE.

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
- отдельные Telegram-токен, целевой чат и список доступа для Tatooine;
- изоляцию заданий кассового отчёта FO’X и Tatooine при общем Web App URL.
- отдельный шаблон сообщения Tatooine/Petrovka с EatAndSplit, Яндекс едой и итогом предоплат;
- отдельный набор custom emoji Tatooine, который можно снять с пересланного эталонного сообщения.
- копирование выбранных файлов до сброса file input для совместимости с Telegram WebView.
- точные интервалы, эмодзи и Telegram-выделения оригинального отчёта Tatooine;
- одна итоговая строка `Нал` из раздельно распознанных `Нал` и `Нал Фискал`.
- сокращённый итоговый шаблон Tatooine без `Безнал 2`, `Нал 2`, Tapper, расчётных счетов и строки `На утро в кассе`;
- отчёт iiko 041 как единственный источник iiko-данных для FO’X и Tatooine.
- распознавание второго значения инкассации после `/`, `\\`, `-` или в круглых скобках.

## Known open issues

1. Нельзя добавить два банкета на один день — требует диагностики по фактической production-версии.
2. После перевода банкета в «Пройден» иногда не снимается резерв.
3. Новые позиции банкета иногда не добавляются в `Банкеты_Резерв`.
4. Сканер документов требует замеров скорости на реальном Android.
5. Production v15.13.3/v9.4.8 требует живого OCR/Telegram-теста отчёта iiko 041 на реальных фото FO’X.
6. Tatooine v1.3.0/v9.4.8 опубликован; требуется живой OCR/Telegram-тест отчёта iiko 041 и сокращённого шаблона.

## Architecture decision

Проект будет разделяться по исходным модулям, но сохранит одну Mini App и текущие Web App endpoints. Пошаговый план находится в `docs/SCANNER_MODULARIZATION_PLAN.md`; миграция начинается только после живого теста scanner candidate.
