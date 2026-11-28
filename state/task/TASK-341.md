---
id: TASK-341
kind: task
title: "Проверить отчёт аудита легаси против дерева (read-only)"
status: done
revision: 4
createdAt: 2026-11-27T12:28:58.289Z
updatedAt: 2026-11-27T12:49:05.218Z
acceptance:
  - text: "Every Findings-table row of reports/legacy-audit.md is re-checked with a command whose output is quoted, and marked CONFIRMED, CONTRADICTED or CANNOT-DECIDE."
    done: false
  - text: "Every path listed under \"Removed\" is shown absent from git ls-files, and every one that was untracked is named as unrecoverable from git."
    done: false
  - text: "The \"kept candidates\" are checked against the tree: a kept script/plugin either has a caller or a documented reason, and a kept candidate with neither is reported."
    done: false
  - text: "Dangling references are re-checked: no surviving file outside docs/cases/, docs/analysis/ and state/ cites a removed path; quote the command and the result."
    done: false
  - text: "The report closes with what the audit overstates or leaves unevidenced, in one list, and what you could not decide, in another."
    done: false
boardId: task-mwyyjwok-kio6ez
nonScope: ["Do NOT edit any file: you have no write permission, and the audit is the other seat's deliverable.", "Do NOT run make verify or make test: another seat is repacking plugins/orchestrator at the same time, so those gates would report a transient red that is not a defect.", "Exclude @cc/dsh-orchestrator from the tarball-vs-source rows: its repack (0.1.76 -> 0.1.77) is in flight while you work.", "Do not start, stop or restart the running dsh server, and do not touch state/ or docs/cases/."]
owner:
  kind: agent
  label: REVIEWER
  sessionId: 5023e2f9-b2e9-49fe-8756-8c2c6374b6ad
preset: reviewer
reqIds: [REQ-267]
resultEvidence: ["8 строк Findings перепроверены: 6 CONFIRMED, 1 CONFIRMED с оговоркой, 1 CONTRADICTED (висячие ссылки).", "git ls-files по всем путям Removed → 0; 102 удаления в c52520d (67 docs + 24 spike + 6 .reasonix/tasks + 1 design.excalidraw).", "CONTRADICTED подтверждено командами: rg находит rules/DEPLOYMENT.md:26 и :233, README.md:376; /tmp/dangling-refs.mjs не видит каталоги и design.excalidraw.", "Пять untracked-путей (server.pid, .cache, .playwright-mcp, .a5c, .usage-analysis) отсутствуют в git log и git ls-files ⇒ из git невосстановимы.", "В дерево не записано ни байта; git status показывает только чужие правки."]
resultSummary: "Отчёт аудита перепроверен независимо: 6 строк подтверждены, 1 с оговоркой, 1 опровергнута. Опровержение конкретно: durable-процедура и README продолжали описывать удалённые артефакты retired-плагина как живые, а доказательный скрипт этой строки не способен их увидеть. Удаления при этом подтверждены полностью."
role: REVIEWER
scope: [reports/legacy-audit.md, plugins/, scripts/, docs/, "git history"]
sessions:
  - sessionId: 5023e2f9-b2e9-49fe-8756-8c2c6374b6ad
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

Source of truth: /home/iustimov/dsh-kit. reports/legacy-audit.md claims what was removed, what was kept and on what evidence. Treat it as a claim, not as a result: independently re-check each row against the tree with the smallest command that can confirm or contradict it, and return a verdict per claim with the command and its output. Do not fix anything and do not edit the report: name the defects and the gaps.
