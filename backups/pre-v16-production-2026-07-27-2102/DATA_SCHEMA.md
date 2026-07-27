# FO’X — Production Data Schema for v16 Banquets Audit

## Banquets spreadsheet

Spreadsheet ID is configured in the production Banquets Apps Script.

Sheet: `Банкеты`

Columns:

| Column | Header |
|---|---|
| A | ID |
| B | Дата |
| C | Время |
| D | Название |
| E | Комментарий |
| F | Статус |
| G | Cloudinary Public ID |
| H | Image URL |
| I | Добавлено |
| J | Telegram User ID |
| K | Telegram User Name |
| L | Удалено |

### Candidate v16.0.0 — не применено к production

Планируемая дополнительная колонка без изменения существующих A–L:

| Column | Header | Format |
|---|---|---|
| M | Media JSON | JSON array: `{url, publicId, order}` |

Колонка не создана автоматически. Пока её нет, backend использует G/H как единственное фото. Подробный безопасный порядок ручной миграции — в `Banquets.md`.

## Banquet reserve

Sheet: `Банкеты_Резерв`

| Column | Header |
|---|---|
| A | ID банкета |
| B | Дата банкета |
| C | Название банкета |
| D | Статус банкета |
| E | Статус закупки |
| F | Наименование с фото |
| G | Лист стока |
| H | Строка стока |
| I | Позиция FO’X |
| J | Нужно |
| K | Уже заказано |
| L | К заказу |
| M | Ед. изм. |
| N | Image URL |
| O | Создано |
| P | Обновлено |
| Q | Архив |
| R | Совпадение |
| S | Комментарий |
| T | Дата отправки заказа |

## Stock sheets

Stock sheets used by the production Stock/Reserve Apps Script:

- Вино
- Крепкий алкоголь
- Пюре и сиропы
- Чай
- Пиво
- Прочее

Current code configuration:

| Column | Meaning |
|---|---|
| A | Наименование |
| D | Остаток Аллея / Бар |
| E | Остаток Заготовочный |
| F | Последняя закупочная цена с НДС |
| H | Ед. изм. |
| J | Банкетный резерв к заказу |

Important: the repository documentation also describes formulas in B and G. Do not alter any stock formula, value, style or column without checking the live sheet first.
