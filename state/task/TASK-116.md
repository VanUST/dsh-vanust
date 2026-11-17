---
id: TASK-116
kind: task
title: "Remove shell bypass from live orchestrator"
status: done
revision: 1
createdAt: 2026-11-17T15:52:40.481Z
updatedAt: 2026-11-17T15:52:40.481Z
boardId: task-mwewxkqs-03d6ag
ownerRole: BACKEND
---

На live 0.2.2 orchestrator в request/header всё ещё виден host-global `bash` (и потенциально `pwsh`), хотя политика говорит, что shell у оркестратора нет. Закрыть этот разрыв через preset-aware tool-families: у orchestrator должны остаться read/write/edit и разрешённые families, но не должно быть bash/pwsh; проверить fresh header, установить kit reproducibly и назвать необходимость следующего boot, если HMR не применяет изменения.

Migrated from .dsh/taskboard.json (task task-mwewxkqs-03d6ag, revision 8).
