---
id: TASK-218
kind: task
title: "V1.9: закоммитить таскборд с reqId"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.492Z
updatedAt: 2026-11-17T15:52:42.492Z
acceptance:
  - text: "Коммит содержит taskboard 0.1.57 (mirror.mjs, тесты), project-state 0.1.4 (boardId), запись анализа"
    done: false
  - text: "`git status` чистый; `make verify` exit 0"
    done: false
boardId: task-mwkukjah-1btgzk
inline: true
nonScope: ["push — финальный шаг (D10)"]
resultEvidence: ["git log --oneline -1 → 1fc508e Bind the taskboard to the requirement registry", "git status --short → пусто", "make verify на том же содержимом → exit 0"]
resultSummary: "Таскборд с reqId зафиксирован коммитом 1fc508e: taskboard 0.1.57 с mirror.mjs и тестами, project-state 0.1.4 с boardId, запись анализа. Дерево чистое; 11 из 19 требований доказаны."
---

Зафиксировать связь таскборда с реестром коммитом перед раннером доказательств.

Migrated from .dsh/taskboard.json (task task-mwkukjah-1btgzk, revision 3).
