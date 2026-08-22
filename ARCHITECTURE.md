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
    ├── кассовый отчёт
    └── развоз сотрудников (домашний адрес и заявки на текущую дату)

Банкеты:
Mini App → Cloudinary → URL → Banquets Apps Script → Google Sheets

Сканер и касса:
Mini App → Scanner/Cash Apps Script → Gemini OCR / Telegram / Google Sheets
```

## Границы

### Общий document scanner

`shared/document-scanner/` содержит frontend-only обработку документа: ленивую загрузку OpenCV.js, поиск границ, perspective transform и preview с fallback на оригинал. Модуль подключён к документам и кассовому отчёту FO’X, а также к кассовому отчёту Tatooine; OpenCV загружается только после выбора фотографии. Он не обрабатывает фото банкетов и не меняет Apps Script/OCR-контракты.

- Frontend хранит интерфейс, подготовку изображений и публичные endpoint-конфиги.
- Apps Script выполняет авторизацию Mini App, обращается к Gemini и Telegram и работает с таблицами.
- Google Sheets хранит бизнес-данные, но не фотографии.
- Cloudinary хранит банкетные фотографии; в таблицу передаётся URL.
- FO’X и Tatooine разделяют cash backend, но используют раздельные Telegram-маршруты.
- Tatooine-развоз использует проверенный Telegram ID и существующий RBAC. Домашние адреса и заявки хранятся в служебных листах Apps Script; список адресов не загружается на старте и защищён server-side permissions. Для менеджерского ввода адреса Apps Script по требованию обращается к Geoapify Address Autocomplete, а ключ хранится только в Script Properties. Точка старта хранится одной Location-записью в `Tatooine_Локации`, изменяется через `rides.manage_origin` и ведёт минимальный audit; будущая RideSession должна сохранять её snapshot, а не повторно читать исторический адрес.

## Состояние исходников

В `main` находятся только опубликованные frontend-файлы. Исходники Apps Script, тесты и расширенная рабочая документация существуют в рабочих ветках; их перенос в `main` требует отдельного решения. Production banquet backend неизвестен и не должен восстанавливаться по старому reference-файлу вслепую.

## Направление развития

Большие `index.html` и `Code.gs` планируется разделять на модули поэтапно. Публичные URL и поведение должны сохраняться на каждом шаге; одновременно менять frontend, backend и таблицы нельзя без отдельного интеграционного плана.
