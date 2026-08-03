# Архитектура FO’X

## Компоненты

```text
Telegram
├── FO’X Mini App (index.html, GitHub Pages)
│   ├── чек-листы
│   ├── банкеты
│   ├── документы и чеки
│   └── кассовый отчёт
└── Tatooine Mini App (tatooine/, GitHub Pages)
    └── кассовый отчёт

Банкеты:
Mini App → Cloudinary → URL → Banquets Apps Script → Google Sheets

Сканер и касса:
Mini App → Scanner/Cash Apps Script → Gemini OCR / Telegram / Google Sheets
```

## Границы

### Общий document scanner

`shared/document-scanner/` содержит frontend-only обработку документа: ленивую загрузку OpenCV.js, поиск границ, perspective transform, фильтры и preview с fallback на оригинал. В текущей candidate-итерации модуль подключён только к документам и кассовому отчёту FO’X; он не обрабатывает фото банкетов и не меняет Apps Script/OCR-контракты. Tatooine будет подключён отдельной задачей после живого теста FO’X в Android Telegram.

- Frontend хранит интерфейс, подготовку изображений и публичные endpoint-конфиги.
- Apps Script выполняет авторизацию Mini App, обращается к Gemini и Telegram и работает с таблицами.
- Google Sheets хранит бизнес-данные, но не фотографии.
- Cloudinary хранит банкетные фотографии; в таблицу передаётся URL.
- FO’X и Tatooine разделяют cash backend, но используют раздельные Telegram-маршруты.

## Состояние исходников

В `main` находятся только опубликованные frontend-файлы. Исходники Apps Script, тесты и расширенная рабочая документация существуют в рабочих ветках; их перенос в `main` требует отдельного решения. Production banquet backend неизвестен и не должен восстанавливаться по старому reference-файлу вслепую.

## Направление развития

Большие `index.html` и `Code.gs` планируется разделять на модули поэтапно. Публичные URL и поведение должны сохраняться на каждом шаге; одновременно менять frontend, backend и таблицы нельзя без отдельного интеграционного плана.
