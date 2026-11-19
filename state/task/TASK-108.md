---
id: TASK-108
kind: task
title: "Taskboard: аренда ребёнка и workspace-scope записей"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.369Z
updatedAt: 2026-11-17T15:52:40.369Z
boardId: task-mwdnodn1-u3hp2m
inline: true
nonScope: ["не менять UI-клиент taskboard", "не трогать другие плагины"]
resultEvidence: ["node scripts/taskboard-lease-proof.mjs → 'taskboard lease proof: PASS (27/27 checks)', exit 0", "RED-FIRST: node scripts/taskboard-lease-proof.mjs --taskboard reports/taskboard-lease-red-first/taskboard-before.mjs --orchestrator reports/taskboard-lease-red-first/orchestrator-before.mjs → 9/27, exit 1 (18 FAIL), лог reports/taskboard-lease-red-first/red.log", "Регрессии: node scripts/taskboard-close-stop-proof.mjs → 40/40; node scripts/taskboard-role-proof.mjs → 15/15", "Гейты: check-documentation ok (21 плагин), check-portability 17/17", "kit-update --apply → устанавливает cc-dsh-taskboard-0.1.52 и cc-dsh-orchestrator-0.1.34; повторный --check → drift: None", "Кейс docs/cases/a-child-session-serves-one-task.json (automated, testPath scripts/taskboard-lease-proof.mjs, runCommand node scripts/taskboard-lease-proof.mjs)"]
resultSummary: "Архитектурно исправлено в taskboard: аренда «ребёнок ↔ одна задача» на строке роли, linkChild переносит аренду (move + запись в таймлайн прежней задачи), interruptChildren останавливает только арендуемого ребёнка и сообщает skipped, childEnded/stop освобождают аренду, orchestrator больше не переиспользует занятую роль. Кросс-чат запись открыта осознанно: scope: 'workspace' у task_note/task_update только для корневого агента, с атрибуцией чата в таймлайне. Доказано red-first: 9/27 на прежних модулях → 27/27 на новых; старые proof-скрипты остались зелёными (40/40, 15/15). Гейты зелёные, kit-update установил 0.1.52/0.1.34, drift: None. Коммит 2013ffc запушен."
scope: [plugins/taskboard/taskboard.mjs, "scripts/taskboard-lease-proof.mjs (новый proof)", plugins/taskboard/README.md]
---

В taskboard ввести явную аренду «ребёнок ↔ одна задача»: linkChild переносит аренду с прежней задачи, interruptChildren не останавливает ребёнка, чья аренда принадлежит другой задаче; закрытие задачи больше не убивает работу, переданную в неё позже. Плюс workspace-scope для записи из другого чата корневым агентом.

Migrated from .dsh/taskboard.json (task task-mwdnodn1-u3hp2m, revision 4).
