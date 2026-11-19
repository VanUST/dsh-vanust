---
id: TASK-207
kind: task
title: "V1: закоммитить контекст-фундамент"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.226Z
updatedAt: 2026-11-17T15:52:42.226Z
acceptance:
  - text: "Коммит содержит allow-list tool-families 0.1.13, гейт пяти плагинов (designmap 0.1.20, diagrams 0.1.6, presentation 0.1.10, papers 0.1.6, test-cases 0.1.13), профиль, документы, запись анализа v1"
    done: false
  - text: "`git status` после коммита чистый; `make verify` exit 0"
    done: false
boardId: task-mwksiayu-ml6tmu
inline: true
nonScope: ["push в origin/main — финальный шаг программы (D10)", "обновление установленного профиля"]
resultEvidence: ["git log --oneline -1 → 324bfe8 Invert the tool policy to an allow list and gate host plugins by the seat", "git status --short → пусто", "make verify на том же содержимом → exit 0"]
resultSummary: "Контекст-фундамент зафиксирован коммитом 324bfe8: allow-list tool-families 0.1.13, гейт пяти плагинов по пресету в силе (designmap 0.1.20, diagrams 0.1.6, presentation 0.1.10, papers 0.1.6, test-cases 0.1.13), профиль, документы, запись анализа v1. Дерево чистое; push не делался — финальный шаг по D10."
---

Зафиксировать контекст-фундамент v1 одним коммитом: allow-list инструментов (tool-families 0.1.13), гейт пяти хост-плагинов по пресету в силе (designmap 0.1.20, diagrams 0.1.6, presentation 0.1.10, papers 0.1.6, test-cases 0.1.13), профиль с allow-строками, rules/DEPLOYMENT.md и запись анализа project-state-ecosystem.

Migrated from .dsh/taskboard.json (task task-mwksiayu-ml6tmu, revision 3).
