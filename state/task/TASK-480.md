---
id: TASK-480
kind: task
title: "Починить выбор веб-провайдера: research-first блокирует создание файлов"
status: done
revision: 5
createdAt: 2026-11-28T16:10:10.932Z
updatedAt: 2026-11-28T16:18:41.481Z
boardId: task-mx0lwdn2-lwn7i5
chore: true
choreReason: "Два исполнителя сегодня не смогли создать файл: web_fetch в детских сессиях падает на выборе провайдера — это блокирует стандартный путь research-first у каждого ребёнка."
nonScope: ["Не менять правила research-first и не выдавать обходные разрешения; чинить причину.", "Не трогать ключи и секреты."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["Воспроизведение: web_fetch https://example.com/ → «multiple usable web providers are registered (deepseek-fetch-api, http)»; web_search работает, у него провайдер задан явно.", "Причина: строка - id: web в profile/cordis.patch.yml заменяет config строки web из бандла, а не сливает ключи; в ней был только searchProvider, поэтому пропал fetchProvider: http (baseline rc.3 имел оба ключа).", "Правка: в ту же строку добавлен fetchProvider: http; dump-config с обновлённым профилем показывает searchProvider: deepseek-search-api и fetchProvider: http.", "kit-update --check --json: drift=kit-changed, plan=write-profile-files:cordis.patch.yml."]
resultSummary: "Причина сломанного web_fetch найдена: строка - id: web в патче профиля заменяет config бандла целиком, поэтому пропал fetchProvider; возвращён fetchProvider: http рядом с searchProvider, правка ждёт apply и перезапуска."
role: DEVOPS
scope: [profile/cordis.patch.yml, .tmp/web-provider/]
---

Почини выбор веб-провайдера: в детских сессиях web_fetch и web_search падают с «multiple usable web providers are registered», из-за этого гейт research-first отказывает в создании новых файлов, и два исполнителя сегодня работали обходным путём. Сделай: (1) воспроизведи ошибку и назови, сколько провайдеров зарегистрировано, какие и откуда (плагины, профиль, переменные окружения); (2) найди, почему выбор неоднозначен — дубль регистрации, две строки в профиле или провайдер без имени; (3) устрани причину: оставить одного активного провайдера или задать явный выбор по умолчанию в профиле; (4) докажи: простой вызов веб-инструмента возвращает результат, а не ошибку выбора, и гейт research-first больше не отказывает в создании файла (проверь на временном каталоге). Назови, что было причиной.
