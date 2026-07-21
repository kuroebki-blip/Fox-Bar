# FO’X / Bar Fo’x

Telegram Mini App для работы бара:

- чек-листы;
- банкеты и банкетный резерв;
- сканер документов и чеков;
- кассовый отчёт;
- интеграция с Google Sheets, Google Apps Script, Cloudinary, Gemini и Telegram.

## Важно перед первой правкой

Папка `candidate/` содержит последнюю подготовленную, но не подтверждённую как опубликованная версию:

- frontend: `v15.13.3 SCANNER JOB SAFETY`;
- stock/scanner backend: `v9.4.4 CASH REPORT SOURCE RULES FIX`.

Перед изменениями необходимо получить фактически опубликованные файлы:

1. скачать текущий `index.html` из рабочего GitHub Pages;
2. скопировать текущий `Code.gs` из опубликованного Apps Script;
3. сохранить их в папки `frontend/production/` и `apps-script/stock-scanner/production/`;
4. сравнить production с candidate;
5. только после этого планировать merge.

Никогда не считать `candidate` рабочей production-версией без проверки в Telegram.
