---
id: TASK-217
kind: task
title: "V1.9: taskboard с обязательным reqId и TASK в ядре (FR10)"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.471Z
updatedAt: 2026-11-17T15:52:42.471Z
acceptance:
  - text: "`task_create` требует `reqId` либо `chore: true` + непустой `choreReason`; без них отказ с кодом `req_required` и запись не создаётся"
    done: false
  - text: "Каждая задача зеркалируется в `state/task/` как TASK: id, статус, reqId или chore+причина, revision; повторное обновление обновляет тот же TASK (стабильная связь по id задачи таскборда)"
    done: false
  - text: "После изменений вызывается `regenerateViews()` → `state/views/board.md` содержит задачи по статусам (и `index.json` показывает TASK с reqId)"
    done: false
  - text: "Существующая семантика таскборда не сломана: его proof-скрипты (role, chat-scope, close-stop, lease, limit) и тесты зелёные; панель и чат-скоуп работают как раньше"
    done: false
  - text: "Перепаковка taskboard, документы, `make verify` exit 0"
    done: false
boardId: task-mwkubps1-3i0yad
nonScope: ["удаление .dsh/taskboard.json и полная миграция TASK — FR13", "изменения панели Tasks и клиентской половины", "гейты lifecycle сверх req_required — отдельно", "живой :3080"]
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
ownerRole: BACKEND
preset: backend
resultEvidence: ["node --test plugins/taskboard/test/*.test.mjs → 5/5, exit 0", "scripts/taskboard-{chat-scope,close-stop,lease,limit,role}-proof.mjs → все exit 0 (моя проверка)", "node --test plugins/project-state/test/*.test.mjs → 12/12", "make verify → exit 0", "task_create без reqId и без chore+причины → req_required, запись не создаётся; TASK в state/task с boardId, повторное обновление правит тот же файл, board.md регенерируется"]
resultSummary: "Таскборд связан с реестром: task_create требует reqId либо chore с непустой причиной, иначе отказ req_required; каждая задача зеркалируется в ядро как TASK (title, status, reqId/chore, boardId), повторное обновление правит тот же файл, после изменений регенерируются проекции и board.md показывает задачу по статусу. Пять proof-скриптов таскборда и его тесты зелёные — чат-скоуп, CAS, pause/close/stop и панель не сломаны; без ядра поведение прежнее. Тарболы taskboard 0.1.57, project-state 0.1.4. Ограничение объёма: lifecycle-переходы минуют зеркало до FR13."
role: BACKEND
scope: ["plugins/taskboard — reqId/chore в create/update, отказ req_required, зеркалирование в state/task, regenerateViews", "тесты и существующие proof-скрипты таскборда — зелёные", "перепаковка taskboard, документы"]
---

Связать таскборд с реестром: `task_create` требует `reqId` или `chore: true` с непустой причиной, иначе отказ `req_required`; каждая задача зеркалируется в ядро как TASK в `state/task/` (id, статус, reqId/chore, revision), повторное обновление обновляет тот же TASK; после изменений регенерируются проекции, и `board.md` для L1 начинает отражать реальные задачи. Существующая семантика таскборда — чат-скоуп, CAS, pause/resume/close/stop, панель — не должна сломаться: это главный риск. Миграция `.dsh/taskboard.json` в TASK — отдельная задача (FR13), здесь только зеркаливание новых и обновляемых задач.

Migrated from .dsh/taskboard.json (task task-mwkubps1-3i0yad, revision 7).
