# FO’X — Current Architecture

## Telegram Mini App Hub

Один Telegram-бот открывает один Mini App-хаб. Внутри разделы:

- 🧾 Чек-листы
- 🍽 Банкеты
- дальше можно добавить: 📦 Сток, 📊 Отчёты, ⚙️ Админка

## Frontend

Хостинг: GitHub Pages.
Основной файл: `index.html`.

Внутри `index.html`:
- Telegram WebApp SDK;
- визуальный стиль FO’X;
- чек-листы;
- банкеты;
- календарь;
- загрузка фото в Cloudinary;
- отправка данных банкета в Apps Script.

## Backend банкетов

Google Apps Script Web App.

Endpoints:
- `?action=ping`
- `?action=list`
- `POST action=save`
- `POST action=delete`

Web App URL:

```text
https://script.google.com/macros/s/AKfycbxRlmtQMLMQ0h3NhQtInpYFAxyQxTLSgrzFClrFF3pqRqmHHxMbWrXeTc56nbAcLteZ/exec
```

## База банкетов

Google Sheets, лист `Банкеты`.

Рекомендуемые колонки:

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

## Фото

Cloudinary.

Настройки:
```js
const CLOUDINARY_CLOUD_NAME = 'sivtytoc';
const CLOUDINARY_UPLOAD_PRESET = 'fox_banquets_unsigned';
```

Важно:
- preset должен быть `unsigned`;
- API Secret не нужен и не должен попадать в `index.html`;
- в Google Sheets хранится только ссылка на фото.

## Сток бара

Файлы:
- `FOX_СТОК...xlsx`
- Apps Script код для стока.

Основные листы:
- Вино
- Крепкий алкоголь
- Пюре и сиропы
- Чай
- Пиво
- Прочее
- Посуда Бар

Актуальная структура стоковых листов:

```text
A Наименование
B ЗАКАЗ
C Сток
D Остаток Аллея
E Остаток Заготовочный
F Цена
G Сумма остатка
H Ед. изм.
I Примечание
```

Формулы:
```text
G = D + E
B = MAX(0, C - G)
```

Лист “Пиво”:
- «Corona Extra», 0.33 л
- «Tsingtao» Stout, 0.33 л
- «Radeberger» Pilsner, 0.33 л
- «Clausthaler» б/а, 0.33 л
- «Tsingtao» Witbier, 0.33 л
