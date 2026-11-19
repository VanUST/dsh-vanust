---
id: TASK-210
kind: task
title: "V1.4-V1.5: закоммитить ядро и бюджеты"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.295Z
updatedAt: 2026-11-17T15:52:42.295Z
acceptance:
  - text: "Коммит содержит ядро project-state 0.1.1, scripts/context-budget.mjs с бюджетами в профиле и шагом в Makefile, отчёт v15, запись анализа, документы"
    done: false
  - text: "`git status` чистый; `make verify` exit 0"
    done: false
boardId: task-mwkte744-z5zv7j
inline: true
nonScope: ["push в origin/main — финальный шаг (D10)", "обновление установленного профиля"]
resultEvidence: ["git log --oneline -1 → e778672 Ship the project-state core and the context budget gate", "git status --short → пусто", "make verify на том же содержимом → exit 0"]
resultSummary: "Ядро и бюджеты зафиксированы коммитом e778672: новый плагин project-state 0.1.1 с сервисом ccProjectState (файл на сущность, ID под локом, связи с хешем, CAS, журнал с реплеем, verify), scripts/context-budget.mjs с бюджетами per-preset и шагом в make verify, блок budgets в профиле, документы и запись анализа. Дерево чистое."
---

Зафиксировать ядро состояния и бюджеты контекста одним коммитом, чтобы дерево не смешивало два этапа перед следующей задачей (проекции).

Migrated from .dsh/taskboard.json (task task-mwkte744-z5zv7j, revision 3).
