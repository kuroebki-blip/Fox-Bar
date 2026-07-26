# FO’X — публикация и откат

Перед публикацией выполнить `RELEASE_CHECKLIST.md`, профильные пункты `TESTING_CHECKLIST.md` и проверку из `SECURITY.md`.

## GitHub Pages

Публичные frontend:

- FO’X: `https://kuroebki-blip.github.io/Fox-Bar/`
- Tatooine: `https://kuroebki-blip.github.io/Fox-Bar/tatooine/`

### Публикация

1. Получить актуальный `main` и создать отдельную ветку.
2. Изменить только необходимый frontend.
3. Назначить версию и обновить `CHANGELOG.md`.
4. Открыть Pull Request в `main`.
5. Проверить `Files changed`, тесты, секреты, риски и откат.
6. После разрешённого merge дождаться успешного `pages-build-deployment`.
7. Открыть обе публичные страницы с обходом кеша и проверить отображаемые версии.
8. Выполнить smoke-тест. Живой Telegram-тест фиксировать отдельно.

### Откат

Создать отдельный Pull Request, возвращающий frontend к последнему подтверждённому merge commit. Не применять destructive reset к `main`. Точный предыдущий commit брать из `PROJECT_STATE.md`, GitHub Releases или истории PR.

## Google Apps Script

### Публикация

1. Скачать фактический production-код существующего deployment.
2. Сравнить его с candidate и проверить, что diff относится к задаче.
3. Не запускать setup-функции без прямого подтверждения пользователя.
4. Выполнить автоматические тесты и проверку секретов.
5. Создать именованную Apps Script version.
6. Переключить существующий Web App deployment на новую version, сохранив публичный URL.
7. Проверить публичный `ping` и номер версии.
8. Выполнить пользовательский тест отдельно; до него не объявлять функцию полностью проверенной.

### Откат

Переключить тот же deployment на последнюю подтверждённую Apps Script version. Номер предыдущей версии должен быть записан до публикации. Для scanner/cash текущая подтверждённая версия — `24`; номер версии для отката требует проверки в Apps Script deployment history. Для banquet backend production-версия неизвестна.

## После публикации

- Обновить `PROJECT_STATE.md` только подтверждёнными результатами.
- Добавить версию и фактические изменения в `CHANGELOG.md`.
- Указать merge commit, Apps Script version, выполненные тесты и непроверенные сценарии.
- Не сохранять Script Properties, токены или рабочие данные таблиц в Git.
