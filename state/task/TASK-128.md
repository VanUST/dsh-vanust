---
id: TASK-128
kind: task
title: "Исправить Analysis Record schema integrity"
status: cancelled
revision: 1
createdAt: 2026-11-17T15:52:40.663Z
updatedAt: 2026-11-17T15:52:40.663Z
boardId: task-mwj27220-stljsf
ownerRole: BACKEND
---

Реализовать Analysis Record analysis-record-schema-integrity: устранить молчаливую потерю nested-полей, строго валидировать enum/обязательное содержимое, собирать все независимые ошибки за один вызов, сделать data.ownerComponentId каноническим с безопасной совместимостью, явно различать readiness/completion и доказать всё red-first. Не публиковать без отдельного запроса.

Migrated from .dsh/taskboard.json (task task-mwj27220-stljsf, revision 14).
