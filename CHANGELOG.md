# FO’X — changelog

История основана на коммитах публичного репозитория. Неподтверждённые backend-изменения не считаются production.

## Unreleased

### Added

- Candidate FO’X document scanner: общий OpenCV.js pipeline с поиском границ, perspective transform, фильтрами и preview перед существующим Gemini OCR; Tatooine пока не меняется.
- Candidate `v16.0.0` Banquets Upgrade: idempotent save by banquet ID, backward-compatible `Media JSON` support, multi-photo frontend gallery and sequential OCR, preservation of unknown goods, and local regression tests.
- Developer Kit: архитектура, состояние проекта, правила разработки, безопасность, чек-листы и документация компонентов.
- Candidate Tatooine `v1.5.0`: встроенная задняя камера для Telegram WebView на Android с fallback на обычный выбор фотографии.
- Candidate Tatooine `v1.5.1`: полноразмерный Android-снимок через `ImageCapture` с сохранением canvas fallback.
- Candidate Tatooine `v1.5.2`: цельный OCR-снимок до 3200 px без монтажа 2×2.

### Changed

- Candidate FO’X: кассовый OCR передаёт цельное изображение до 2200 px вместо 3200 px мозаики из четырёх фрагментов; Android-камера для кассового отчёта сохраняет более компактный кадр. Это уменьшает локальную обработку и размер отправки в Gemini.
- Candidate `v16.0.0`: Stock/Reserve backend reads the banquet status directly from the Banquets sheet before saving a reserve; terminal statuses are retained after late OCR.
- Candidate `v16.0.0`: reserve status updates report the actual number of changed rows and fail when no active reserve exists.

### Fixed

- Candidate FO’X: автообрезка документов теперь ищет контур по нескольким вариантам изображения (обычные и мягкие границы, контрастный порог); preview явно сообщает, была ли обрезка и коррекция перспективы применена.
- Candidate FO’X: на Android в Telegram съёмка документов и кассового отчёта использует совместимый поток камеры, как в Tatooine; иначе WebView предлагает только галерею. На iPhone остаётся системная камера без управления фонариком видеопотока.
- Candidate `v16.0.0`: repeated save POSTs with the same banquet ID no longer append a duplicate row.
- Candidate `v16.0.0`: unknown banquet goods are retained with quantity and unit as `Требует сопоставления` instead of being discarded before reconciliation.
- Android Telegram больше не зависит только от необязательной поддержки HTML `capture` при съёмке кассового отчёта.
- Снимок Android-камеры больше не ограничивается разрешением preview-видеопотока, если WebView поддерживает `ImageCapture`.
- Tatooine больше не переставляет и не дублирует фрагменты документа перед отправкой в OCR.

### Removed

- Нет.

## 2026-07-26 — frontend v15.14.0 / Tatooine v1.4.0

### Added

- Детальная монтажная OCR-страница 2×2 для каждой исходной фотографии кассового отчёта.

### Changed

- Кассовый OCR FO’X и Tatooine использует увеличенное изображение без добавления отдельных Gemini-запросов на каждый сектор.

### Fixed

- Backend-инструкция различает перекрывающиеся фрагменты одного физического терминального слипа. Исходник backend находится вне `main`; deployment требует отдельной проверки при следующем релизе.

### Removed

- Нет.

## 2026-07-22 — Tatooine v1.3.0–v1.3.3

### Added

- Финальный отчёт Tatooine на основе iiko 041.
- Поддержка EatAndSplit, Яндекс Еды, размена и предоплат.

### Changed

- Стандартный неизменный размен установлен в `100 000`.
- Блок предоплат и `Итого` показываются только при наличии предоплат.

### Fixed

- Нормализация платёжных строк iiko с префиксом `Оплата`.
- Пустые обязательные строки отчёта сохраняются в шаблоне.

### Removed

- Из Tatooine убраны лишние строки, не входящие в согласованный шаблон iiko 041.

## 2026-07-22 — Tatooine v1.0.0–v1.2.1

### Added

- Отдельное приложение Tatooine и маршрут отдельного Telegram-бота.
- Шаблон кассового отчёта Petrovka/Tatooine.

### Changed

- Формат сообщения приведён к согласованным переносам строк и выделениям.

### Fixed

- Выбранные фото сохраняются до сброса file input в Telegram WebView.

### Removed

- Нет.
