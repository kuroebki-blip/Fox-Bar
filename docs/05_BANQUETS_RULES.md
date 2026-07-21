# FO’X — Banquets Rules

## Текущая рабочая версия

`v12 Cloudinary READY`

## Что работает

- добавление банкета без фото;
- добавление банкета с фото;
- запись в Google Sheets;
- загрузка фото в Cloudinary;
- отображение фото в Mini App;
- просмотр фото другими пользователями;
- админские Telegram IDs.

## Основные константы frontend

```js
const BANQ_API_URL = 'https://script.google.com/macros/s/AKfycbxRlmtQMLMQ0h3NhQtInpYFAxyQxTLSgrzFClrFF3pqRqmHHxMbWrXeTc56nbAcLteZ/exec';

const CLOUDINARY_CLOUD_NAME = 'sivtytoc';
const CLOUDINARY_UPLOAD_PRESET = 'fox_banquets_unsigned';

const ADMIN_TELEGRAM_IDS = [
  1036250074,
  315978242,
  317564157
];
```

## Важное по Cloudinary

- Upload preset должен быть unsigned.
- API Secret нельзя вставлять в frontend.
- В Google Sheets хранится `Image URL`.
- `Cloudinary Public ID` можно хранить для будущего удаления/управления фото.

## Google Sheets: лист Банкеты

Колонки:

```text
ID
Дата
Время
Название
Комментарий
Статус
Cloudinary Public ID
Image URL
Добавлено
Telegram User ID
Telegram User Name
Удалено
```

## Удаление банкета

Лучше не удалять строку физически. Ставить `Удалено = YES`, тогда можно восстановить ошибочно удалённый банкет.

## Не делать

1. Не возвращаться к загрузке фото через Apps Script base64.
2. Не хранить фото в Google Sheets.
3. Не вставлять Cloudinary API Secret в `index.html`.
4. Не запускать `setupBanquetsBackend()` на рабочей таблице.
5. Не менять структуру колонок без обновления frontend и backend.
