# Cloudinary

Cloudinary используется для фотографий банкетов.

## Поток

1. Mini App загружает фото напрямую через unsigned upload preset.
2. Cloudinary возвращает URL и public ID.
3. Mini App передаёт метаданные в Banquets Apps Script.
4. Google Sheets хранит URL, а не бинарное изображение.

Cloud name и unsigned preset являются публичными настройками frontend. Cloudinary API Secret является секретом и не должен находиться в Git, frontend или таблице.

Фактические production-настройки нужно сверять с опубликованным frontend; изменение preset требует отдельного теста загрузки с фото.
