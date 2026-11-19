---
id: TASK-244
kind: task
title: "Red/green proof for the context-bounds changes"
status: review
revision: 4
createdAt: 2026-11-18T15:59:31.998Z
updatedAt: 2026-11-18T16:10:31.811Z
acceptance:
  - text: "case_record automated:true"
    done: false
  - text: "case_run red упал, green прошёл"
    done: false
  - text: "CASE_SUMMARY-метрики записаны"
    done: false
  - text: "файлы реализации не изменены"
    done: false
boardId: task-mwmb46es-ze81wg
nonScope: ["plugins/**", profile/cordis.patch.yml, scripts/tool-families-proof.mjs, scripts/tool-surface-proof.mjs, "перезапуск сервера", "git commit"]
owner:
  kind: agent
  label: BACKEND
  sessionId: edbbc01f-99bd-4c04-a73f-4898e917d5fd
preset: backend
reqIds: [REQ-128, REQ-129, REQ-130, REQ-131, REQ-134]
resultEvidence: ["node scripts/context-bounds-proof.mjs -> PASS (26 checks), exit 0; CASE_NEGATIVE_CONTROL=pre-change -> FAIL (26 checks), exit 1 (перепроверено оркестратором)", "case_run red mwmbbcyz-z3q7b-1: exit 1, 13 failed; case_run green mwmbbg1e-dsvs7-1: exit 0, 0 failed; case status verified, redFirst pre-change", "TEST-071: status verified, evidenceRefs [mwmbbcyz-z3q7b-1:red:fail, mwmbbg1e-dsvs7-1:green:pass], testPath scripts/context-bounds-proof.mjs", "измерено green: projectionAfter 4 938 из 13 061 символов, taskListRows 25, taskListChars 6 003, compaction1M 524 288, compaction272K 217 600", "implementation files untouched: mtime плагинов/профиля 18:51-18:53, драйвер 19:04"]
resultSummary: "Один автоматический кейс доказывает все четыре правки: проекцию выдачи, страничный task_list, действие allow-строки на регистрации кита и абсолютный порог компакции. Прогон: red упал (13 провалов, контроль pre-change), green прошёл (26 проверок), кейс verified, TEST-071 с парой red:fail/green:pass."
role: BACKEND
scope: ["scripts/context-bounds-proof.mjs (новый)", "docs/cases/ (записи кейса через инструменты)"]
sessions:
  - sessionId: edbbc01f-99bd-4c04-a73f-4898e917d5fd
    label: BACKEND
    role: BACKEND
    status: sleeping
steps: ["написать scripts/context-bounds-proof.mjs", case_record, "case_run red", "case_run green"]
stepsDone: 4
---

Один автоматический кейс доказывает проекцию выдачи, страничный task_list, действие allow-строки на регистрации кита и абсолютный порог компакции; case_run red обязан упасть, green — пройти.
