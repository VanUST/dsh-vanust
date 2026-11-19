---
id: TASK-212
kind: task
title: "V1.6: закоммитить проекции"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.354Z
updatedAt: 2026-11-17T15:52:42.354Z
acceptance:
  - text: "Коммит содержит project-state 0.1.2 (проекции, index.json, .hashes.json), тесты 12/12, запись анализа"
    done: false
  - text: "`git status` чистый; `make verify` exit 0"
    done: false
boardId: task-mwktl9c6-tj95z9
inline: true
nonScope: ["push — финальный шаг (D10)", "обновление установленного профиля"]
resultEvidence: ["git log --oneline -1 → 35e0776 Render the state projections and their machine-readable index", "git status --short → пусто", "make verify на том же содержимом → exit 0"]
resultSummary: "Проекции зафиксированы коммитом 35e0776: project-state 0.1.2 с regenerateViews() (digest, board, traceability, snapshot, map/REQ-*, index.json, .hashes.json), детерминизм байт-в-байт, view_modified ловится verify(). Тесты 12/12, make verify зелёный."
---

Зафиксировать проекции состояния коммитом перед задачей доставки L1/L2.

Migrated from .dsh/taskboard.json (task task-mwktl9c6-tj95z9, revision 3).
