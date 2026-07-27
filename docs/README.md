# Документация FO’X

## С чего начать

1. [`AGENTS.md`](../AGENTS.md) — обязательные правила работы.
2. [`PROJECT_STATE.md`](../PROJECT_STATE.md) — текущие версии, проверки и известные проблемы.
3. [`ARCHITECTURE.md`](../ARCHITECTURE.md) — компоненты и их границы.
4. [`CONTRIBUTING.md`](../CONTRIBUTING.md) — порядок подготовки изменений.

## Компоненты

- [`Banquets.md`](Banquets.md) — банкеты и банкетный резерв.
- [`Stock.md`](Stock.md) — структура стока и формулы.
- [`CashReports.md`](CashReports.md) — кассовые отчёты FO’X и Tatooine.
- [`Scanner.md`](Scanner.md) — сканер документов.
- [`OCR.md`](OCR.md) — подготовка изображений и правила распознавания.
- [`Telegram.md`](Telegram.md) — боты, маршруты и авторизация.
- [`Cloudinary.md`](Cloudinary.md) — загрузка фотографий банкетов.
- [`GoogleSheets.md`](GoogleSheets.md) — безопасная работа с таблицами.
- [`AppsScript.md`](AppsScript.md) — обработчики и выпуск Apps Script.
- [`DATA_SCHEMA.md`](DATA_SCHEMA.md) — подтверждённая из production export схема банкетов и candidate-план `Media JSON`.

## Процесс

- [`ROADMAP.md`](../ROADMAP.md) — планы и приоритеты.
- [`CHANGELOG.md`](../CHANGELOG.md) — история версионированных изменений.
- [`FOX_MEMORY.md`](../FOX_MEMORY.md) — причины устойчивых архитектурных решений.
- [`TESTING_CHECKLIST.md`](../TESTING_CHECKLIST.md) — профильные проверки.
- [`RELEASE_CHECKLIST.md`](../RELEASE_CHECKLIST.md) — выпуск и откат.
- [`DEPLOYMENT.md`](../DEPLOYMENT.md) — GitHub Pages, Apps Script и проверка публикации.
- [`SECURITY.md`](../SECURITY.md) — секреты и безопасный аудит.
- [`ESLINT_CANDIDATE_REPORT.md`](ESLINT_CANDIDATE_REPORT.md) — область и результаты диагностической проверки JavaScript.
- [PR-шаблон](../.github/PULL_REQUEST_TEMPLATE.md) — обязательное описание Pull Request.

`PROJECT_STATE.md` является источником текущего состояния. Технические документы описывают устойчивые правила и не должны выдавать candidate за production.
