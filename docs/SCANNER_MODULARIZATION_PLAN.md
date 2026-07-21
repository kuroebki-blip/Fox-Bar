# FO’X — план модульного разделения scanner/stock/cash

## Решение

Проект пора разделять по исходным модулям, но сохранять одну Telegram Mini App и существующие публичные точки входа. Первая цель — уменьшить связанность кода и добавить тестируемые границы без изменения пользовательского сценария.

Текущий `frontend/candidate/index.html` остаётся релизным артефактом до прохождения живого теста v15.13.3/v9.4.4. Большая одновременная перепись запрещена.

## Целевая структура frontend

```text
frontend/
  src/
    index.html
    styles/
      tokens.css
      layout.css
      checklists.css
      banquets.css
      scanner.css
      cash-report.css
    js/
      app.js
      config.js
      telegram.js
      api/
        jsonp.js
        stock-api.js
        banquet-api.js
      shared/
        dom.js
        format.js
        state.js
      camera/
        camera.js
        image-pipeline.js
        pdf.js
      features/
        checklists.js
        banquets.js
        receipts.js
        cash-report.js
  candidate/
    index.html
    assets/
```

`candidate/` остаётся результатом сборки или копией файлов, которые публикуются на GitHub Pages. Рабочие Web App URL и Telegram admin IDs должны попадать в результат без заглушек.

## Целевая структура Apps Script

```text
apps-script/stock-scanner/src/
  Config.gs
  WebApp.gs
  Auth.gs
  Jobs.gs
  GeminiClient.gs
  ReceiptScanner.gs
  CashReport.gs
  Stock.gs
  Telegram.gs
  SheetsRepository.gs
  BanquetReserve.gs
```

Apps Script допускает несколько `.gs`-файлов в одном проекте. На первом этапе остаются одно развёртывание, один Web App URL и существующие Script Properties.

## Очередность миграции

### Этап 0 — стабилизация

- живой тест v15.13.3/v9.4.4 на Android;
- контрольные кейсы документов, чеков и кассового отчёта;
- фиксация времени: подготовка JPEG, создание job, Gemini, PDF, Telegram;
- откат при ошибке на v15.13.2/v9.4.3.

### Этап 1 — чистые функции

- вынести форматирование, лимиты payload и правила кассового отчёта;
- сохранить автоматические тесты без DOM, Sheets и Telegram;
- не менять HTML-разметку и API-контракты.

### Этап 2 — scanner frontend

- вынести camera/image/PDF pipeline;
- вынести JSONP и stock API;
- затем вынести receipts и cash-report;
- публиковать candidate с теми же URL и поведением.

### Этап 3 — Apps Script

- физически разнести `.gs`-файлы внутри того же Apps Script проекта;
- не запускать setup-функции;
- не менять листы, колонки и формулы;
- после каждого выделенного модуля проверять `?action=ping` и основной сценарий.

### Этап 4 — остальные функции Mini App

- чек-листы и банкеты переносить только после стабилизации сканера;
- banquet backend не менять в рамках frontend-разделения;
- схема Mini App → Cloudinary → URL → Apps Script → Google Sheets остаётся неизменной.

## Запрещённые изменения в рамках миграции

- новые публичные Web App URL без отдельного плана переключения;
- перенос фото через Google Sheets или Apps Script/base64 для банкетов;
- переименование листов и сдвиг колонок;
- запуск `setupBanquetsBackend()` или других setup-функций;
- изменение формул B/G/J;
- одновременное разделение frontend, backend и структуры таблицы.

## Критерий завершения

- один Mini App URL;
- один scanner/stock Web App URL;
- публичный candidate не содержит секретов и `PASTE_...`;
- автоматические тесты проходят;
- живые проверки Android, Gemini, Google Sheets и Telegram отмечены отдельно;
- для каждого релиза есть версия, changelog и способ отката.
