# Как открыть FO’X в Codex

## Вариант A — локальная папка

1. Распакуй этот архив в `Документы/FO_X_CODEX`.
2. Открой Codex app.
3. Нажми `Add project` / `Open folder`.
4. Выбери папку `FO_X_CODEX`.
5. Первый запрос:

```text
Сначала ничего не меняй. Прочитай AGENTS.md, README.md, docs/PROJECT_STATE.md и docs/CHAT_CONTEXT.md. Затем покажи структуру проекта, различия между production и candidate, известные риски и план безопасного переноса фактически опубликованных файлов. Не запускай setup-функции.
```

## Вариант B — существующий GitHub Pages репозиторий

1. Клонируй репозиторий `kuroebki-blip.github.io` на Mac через GitHub Desktop.
2. Скопируй содержимое этого архива в клонированную папку.
3. Текущий опубликованный `index.html` сохрани как `frontend/production/index.html`.
4. Не заменяй корневой `index.html`, пока Codex не сравнит production и candidate.
5. Открой клонированную папку как project в Codex.
6. Создай отдельную ветку `codex/migration`.

## Обязательный этап: получить настоящий production backend

Apps Script не хранится в GitHub автоматически.

1. Открой рабочий Apps Script стока/сканера.
2. Скопируй весь `Code.gs`.
3. Сохрани как `apps-script/stock-scanner/production/Code.gs`.
4. Открой рабочий Apps Script банкетов.
5. Сохрани его как `apps-script/banquets/production/Code.gs`.
6. Не копируй Script Properties и ключи.

После этого Codex сможет сравнить production и candidate без догадок.
