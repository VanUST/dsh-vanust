---
id: TASK-283
kind: task
title: "P0 final: целевое ревью S8/S7/LOW"
status: done
revision: 5
createdAt: 2026-11-22T11:35:13.424Z
updatedAt: 2026-11-22T11:49:40.317Z
acceptance:
  - text: "Все команды перезапущены, вывод/коды приложены"
    done: false
  - text: "S8/S7/LOW-1/2/6 подтверждены на собственных фикстурах или опровергнуты"
    done: false
  - text: "Нет регрессий и P1 scope creep; тарболы 0.1.27/0.1.74 совпадают"
    done: false
  - text: "Границы B1/B1'/R1/S10/legacy названы, не спрятаны"
    done: false
  - text: "Вердикт: принято или дефекты с severity/file:line/репродукцией"
    done: false
boardId: task-mwrrfoj5-y81qjw
nonScope: ["не править код, тесты, README, docs/cases", "не трогать profile/cordis.patch.yml, живой профиль и :3080", "не реализовывать P1/P2"]
owner:
  kind: agent
  label: REVIEWER
preset: reviewer
reqIds: [REQ-185, REQ-186, REQ-187, REQ-188, REQ-193]
resultEvidence: ["node --test plugins/test-cases/test/*.test.mjs -> 63 pass, exit 0", "node scripts/independent-verification-proof.mjs -> 24/24, exit 0", "make test -> 78/78, exit 0; make verify -> 19/19, exit 0", "taskboard 37/37 four times isolated; first concurrent run failed strictEqual (load-sensitive flake)", "S8: task B on A's case -> CASE_FOREIGN; no linkedTaskId -> CASE_UNLINKED; runBy.taskId A on B -> RUN_MISMATCH", "S7: task_create caseIds: []; unrelated corrupt file + new task -> close ok; legacy row -> broad scan", "LOW-1 CLI header, LOW-2 case_gate {id} CASE_MISSING, LOW-6 status missing confirmed", "Tarballs 0.1.27/0.1.74 byte-identical; docs/cases and live profile untouched"]
resultSummary: "Финальное целевое ревью P0: вердикт «принимаю». S8 (CASE_FOREIGN/CASE_UNLINKED, runBy.taskId vs задача вопроса), S7 (task_create caseIds: []), LOW-1/2/6 подтверждены на собственных фикстурах. Прогоны: test-cases 63/63, proof 24/24, make test 78/78, make verify 19/19, тарболы 0.1.27/0.1.74 совпадают. Один параллельный прогон taskboard дал флейк (strictEqual), четыре изолированных — 37/37; названо наблюдением, не регрессией."
role: REVIEWER
scope: [plugins/test-cases/lib/acceptance.mjs, plugins/test-cases/test-cases.mjs, plugins/test-cases/bin/cases.mjs, plugins/test-cases/test/task-links.test.mjs, "plugins/test-cases/test/*.test.mjs", plugins/taskboard/taskboard.mjs, plugins/taskboard/test/case-gate-preset.test.mjs, scripts/independent-verification-proof.mjs, plugins/test-cases/README.md]
---

Финальное целевое ревью P0 после S8/S7/LOW-1/2/6. Проверь, что задача B не закрывается кейсом задачи A (CASE_FOREIGN/CASE_UNLINKED), что runBy.taskId сверяется с задачей вопроса, что task_create пишет caseIds: [] и новая задача без кейса не блокируется посторонним битым файлом, что LOW-1/2/6 исправлены. B1/B1'/R1/legacy — названные границы P1, не требуй их закрытия. Все заявленные прогоны перезапусти; отчёт исполнителя — утверждение.
