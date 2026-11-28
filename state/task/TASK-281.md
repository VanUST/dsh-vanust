---
id: TASK-281
kind: task
title: "P0 fix 2: третье независимое ревью B2/R2"
status: done
revision: 5
createdAt: 2026-11-22T11:27:58.379Z
updatedAt: 2026-11-22T11:35:15.226Z
acceptance:
  - text: "Все команды перезапущены, вывод/коды приложены"
    done: false
  - text: "B2/R2/R3/R4 подтверждены на собственных фикстурах или опровергнуты"
    done: false
  - text: "B1/B1'/R1/legacy названы границей, а не спрятаны"
    done: false
  - text: "Нет P1 scope creep, живого профиля, правок docs/cases; тарболы совпадают"
    done: false
  - text: "Вердикт: принято или дефекты с severity/file:line/репродукцией"
    done: false
boardId: task-mwrr6cp1-rkyiua
nonScope: ["не править код, тесты, README, docs/cases", "не трогать profile/cordis.patch.yml, живой профиль и :3080", "не реализовывать P1/P2", "не переписывать существующие кейсы"]
owner:
  kind: agent
  label: REVIEWER
preset: reviewer
reqIds: [REQ-185, REQ-186, REQ-187, REQ-188, REQ-193]
resultEvidence: ["node scripts/independent-verification-proof.mjs -> 24/24, exit 0", "node --test plugins/test-cases/test/*.test.mjs -> 61 pass; taskboard -> 36 pass", "make test -> 78/78; make verify -> 19/19", "B2: deleted linked case -> CASE_MISSING, close cases_not_green; R2: unrelated corrupt + caseIds -> close ok; linked corrupt -> CASE_UNREADABLE", "R3: runBy.taskId mismatch -> RUN_MISMATCH; R4: KNOWN_PRESETS === Object.keys(DEFAULT_ROLE_TOOLS) (8)", "CLI: --task reads board, missing row/unreadable -> TASKBOARD_UNREADABLE exit 2; missing case -> CASE_MISSING exit 1", "LOW-1 CLI header, LOW-2 case_gate {id} missing green, LOW-3 status null; not blockers"]
resultSummary: "Третье независимое ревью P0: вердикт «принимаю». B2/R2/R3/R4 подтверждены на собственных фикстурах; все прогоны совпали (proof 24/24, test-cases 61/61, taskboard 36/36, make test 78/78, make verify 19/19, тарболы 0.1.26/0.1.73). Блокирующих дефектов нет; LOW-1/LOW-2/LOW-3 — в следующую задачу. Границы B1/B1'/R1/legacy названы."
role: REVIEWER
scope: [plugins/test-cases/lib/acceptance.mjs, plugins/test-cases/test-cases.mjs, plugins/test-cases/bin/cases.mjs, plugins/test-cases/test/task-links.test.mjs, "plugins/test-cases/test/*.test.mjs", plugins/taskboard/taskboard.mjs, plugins/taskboard/test/case-gate-preset.test.mjs, scripts/independent-verification-proof.mjs, plugins/test-cases/README.md]
---

Третий независимый проход по P0 после фикса B2/R2/R3/R4. Проверь, что task↔case link действительно закрывает удаление связанного кейса и не блокирует здоровую задачу из-за постороннего битого файла; что caseIds пишется case_record и task_update; что CLI читает строку задачи и отказывает TASKBOARD_UNREADABLE; что runBy.taskId и KNOWN_PRESETS согласованы. B1 (подделка пары кейс+run.json) и R1 (surfaceFiles не доказывает покрытие) — названная граница P1, не требуй их закрытия в P0. Отчёт исполнителя — утверждение, не доказательство.
