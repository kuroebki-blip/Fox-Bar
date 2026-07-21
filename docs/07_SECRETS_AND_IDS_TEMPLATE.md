# FO’X — IDs and Config

ВНИМАНИЕ: не хранить здесь API Secret, пароли и приватные ключи.

## Public / safe enough for frontend

Apps Script Web App URL:

```text
https://script.google.com/macros/s/AKfycbxRlmtQMLMQ0h3NhQtInpYFAxyQxTLSgrzFClrFF3pqRqmHHxMbWrXeTc56nbAcLteZ/exec
```

Cloudinary cloud name:

```text
sivtytoc
```

Cloudinary unsigned upload preset:

```text
fox_banquets_unsigned
```

Telegram admin IDs:

```text
1036250074
315978242
317564157
```

## Private / не вставлять в frontend

Не загружать в публичный GitHub:
- Cloudinary API Secret;
- Google API keys;
- пароли;
- приватные токены бота;
- личные доступы.

## Где что используется

`BANQ_API_URL` — в `index.html`.

`CLOUDINARY_CLOUD_NAME` — в `index.html`.

`CLOUDINARY_UPLOAD_PRESET` — в `index.html`.

`ADMIN_TELEGRAM_IDS` — в `index.html` и Apps Script backend.

`SPREADSHEET_ID` — только в Apps Script backend.
