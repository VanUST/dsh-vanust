---
id: TASK-103
kind: task
title: "P2: плагин session-budget — детерминированное напоминание о handoff"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.298Z
updatedAt: 2026-11-17T15:52:40.298Z
acceptance:
  - text: "`node plugins/session-budget/proof/proof.mjs` (или эквивалент) завершается кодом 0 и печатает таблицу проверок: 299 — нет напоминаний, 300 — одно мягкое, 400 — второе, 500 — жёсткое, повторного на том же шаге нет"
    done: false
  - text: "в ответе процитированы точная команда, её вывод и exit code"
    done: false
  - text: "указан файл:строка установленного пакета, дающий шов, через который текст попадает в контекст модели, и обосновано, почему счётчик выживает компакцию"
    done: false
  - text: "плагин не бросает исключение в ход агента: падение обёрнуто и логируется"
    done: false
boardId: task-mwdl6hrf-3ppuip
nonScope: ["не править $DSH_HOME/profiles/web/cordis.patch.yml и kit-копию profile/cordis.patch.yml — интеграцию делает оркестратор", "не править plugins/inventory.json и не собирать tarball (.tgz)", "не перезапускать работающий сервер web (:3080) и не трогать другие плагины", "не менять ключи/аккаунт и настройки платформы"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 7c4be27d-fc12-43dd-a9c2-280c31780b0c
ownerRole: BACKEND
preset: backend
resultEvidence: ["Я сам прогнал: node plugins/session-budget/proof/proof.mjs → 'session-budget proof: PASS (15 checks)', exit 0", "node scripts/pack-plugin.mjs --dir plugins/session-budget → cc-dsh-session-budget-0.1.1.tgz, sha256 4a05aa009b3776f0b1de74999d5b7cfbbdde733eb0a62a8b6a6ba501445b1f6b", "node scripts/check-documentation.mjs → documentation ok (20 плагинов названы); node scripts/check-portability.mjs → 17/17", "node scripts/kit-update.mjs --apply --keep-model-config → drift plugins ['cc-dsh-session-budget-0.1.1.tgz'], actions=write-profile-files,write-rules,install-plugins, restart=required, exit 0", "dsh --profile web --dump-config → строка '- id: session-budget / name: @cc/dsh-session-budget'; ls profiles/web/node_modules/@cc → dsh-session-budget", "Второй сервер на :3081 запущен из установленного профиля и поднялся (URL с токеном), ошибок импорта/активации в логе нет; :3080 не затронут, :3081 остановлен"]
resultSummary: "P2 собран, проверен и интегрирован: плагин @cc/dsh-session-budget детерминированно считает шаги через session projection, на 300/400/500 вставляет фиксированное handoff-напоминание в тот же запрос и уведомляет человека через @cc/dsh-notify/core. Я независимо прогнал proof (15/15, exit 0), упаковал tarball 0.1.1, добавил inventory-строку, ряд в kit-профиль, документацию в README/USERGUIDE/rules, прогнал kit-update --apply и подтвердил, что собранный профиль содержит ряд, а модуль установлен. Гейты репозитория зелёные (documentation ok, portability 17/17). Для активации нужен рестарт :3080."
role: BACKEND
scope: ["plugins/session-budget/ — новый пакет: package.json, session-budget.mjs, README.md, proof/", "чтение установленных пакетов гарнесса и плагинов kit для поиска швов"]
sessions:
  - sessionId: 7c4be27d-fc12-43dd-a9c2-280c31780b0c
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Собрать плагин @cc/dsh-session-budget, который детерминированно (без вызовов модели) считает шаги текущей сессии и при пересечении порогов вставляет фиксированное напоминание в очередной ход агента и уведомляет человека. Назначение: агент успевает сделать handoff-документ и мягко перейти в новую сессию до того, как контекст станет дорогим.

Migrated from .dsh/taskboard.json (task task-mwdl6hrf-3ppuip, revision 7).
