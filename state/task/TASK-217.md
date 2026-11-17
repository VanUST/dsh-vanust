---
id: TASK-217
kind: task
title: "V1.9: taskboard с обязательным reqId и TASK в ядре (FR10)"
status: done
revision: 1
createdAt: 2026-11-17T15:52:42.471Z
updatedAt: 2026-11-17T15:52:42.471Z
boardId: task-mwkubps1-3i0yad
ownerRole: BACKEND
---

Связать таскборд с реестром: `task_create` требует `reqId` или `chore: true` с непустой причиной, иначе отказ `req_required`; каждая задача зеркалируется в ядро как TASK в `state/task/` (id, статус, reqId/chore, revision), повторное обновление обновляет тот же TASK; после изменений регенерируются проекции, и `board.md` для L1 начинает отражать реальные задачи. Существующая семантика таскборда — чат-скоуп, CAS, pause/resume/close/stop, панель — не должна сломаться: это главный риск. Миграция `.dsh/taskboard.json` в TASK — отдельная задача (FR13), здесь только зеркаливание новых и обновляемых задач.

Migrated from .dsh/taskboard.json (task task-mwkubps1-3i0yad, revision 7).
