---
id: TASK-279
kind: task
title: "P0 fix: независимое ревью второго круга"
status: done
revision: 5
createdAt: 2026-11-22T11:15:30.459Z
updatedAt: 2026-11-22T11:27:59.803Z
acceptance:
  - text: "Все команды перезапущены, вывод и коды приложены; расхождения с отчётом названы"
    done: false
  - text: "F1/F2/F3/F5/F4/D2-D6 подтверждены на своих фикстурах или опровергнуты"
    done: false
  - text: "Остаточные границы проверены и названы: удаление файла, подделка run.json, неполный surfaceFiles, новый пресет"
    done: false
  - text: "Нет P1 scope creep, живого профиля и правок docs/cases; тарболы совпадают"
    done: false
  - text: "Вердикт: принято или список дефектов с severity/file:line/репродукцией"
    done: false
boardId: task-mwrqqbgp-xuv16c
nonScope: ["не править код, тесты, README, docs/cases", "не трогать profile/cordis.patch.yml, живой профиль и :3080", "не реализовывать P1/P2", "не переписывать существующие кейсы"]
owner:
  kind: agent
  label: REVIEWER
preset: reviewer
reqIds: [REQ-185, REQ-186, REQ-187, REQ-188, REQ-193]
resultEvidence: ["node scripts/independent-verification-proof.mjs -> 22/22 checks held, exit 0", "node --test plugins/test-cases/test/*.test.mjs -> 55 pass, exit 0", "node --test plugins/taskboard/test/*.test.mjs -> 32 pass, exit 0", "make test -> 77/77, exit 0; make verify -> 19/19, exit 0", "F1: unreadable -> gate ok:false, close cases_unreadable, CLI exit 1; F2: RUN_ARTIFACT_MISSING/RUN_MISMATCH; F3: agent/human/standard/tester -> UNKNOWN_PRESET; F5: DEGRADED first; F4: SURFACE_FILES_REQUIRED/MISSING; D2-D6 confirmed", "Остаточные границы: delete case file -> close done; forged case+run.json pair -> ok:true; unlisted surface file -> ok:true"]
resultSummary: "Второе независимое ревью P0: вердикт «принимаю». Все заявленные прогоны совпали (proof 22/22, test-cases 55/55, taskboard 32/32, make test 77/77, make verify 19/19, тарболы 0.1.25/0.1.72). F1-F5/D2-D6 подтверждены на собственных фикстурах. Блокирующих дефектов нет; L1-L3 низкой важности; остаточные границы названы: удаление файла кейса, подделка пары кейс+run.json, неполный surfaceFiles, 78 legacy-кейсов, строка без пресета."
role: REVIEWER
scope: [plugins/test-cases/lib/acceptance.mjs, plugins/test-cases/lib/runner.mjs, plugins/test-cases/test-cases.mjs, plugins/test-cases/bin/cases.mjs, plugins/test-cases/README.md, plugins/test-cases/test/acceptance-artifacts.test.mjs, plugins/test-cases/test/independent-verification.test.mjs, "plugins/test-cases/test/*.test.mjs", plugins/taskboard/taskboard.mjs, plugins/taskboard/test/case-gate-preset.test.mjs, scripts/independent-verification-proof.mjs]
---

Повторно и независимо проверить P0 после фикса F1-F5/D2-D6. Отчёт исполнителя — утверждение: перезапусти команды, прочитай `lib/acceptance.mjs`, `test-cases.mjs`, `bin/cases.mjs`, `taskboard.mjs`, новые тесты `acceptance-artifacts.test.mjs` и `case-gate-preset.test.mjs`. Проверь, что нечитаемый кейс блокирует закрытие и CLI, рукописная запись без артефакта прогона блокируется, `agent` не считается независимым, degraded-кейс блокирует, пустой `surfaceFiles` отклоняется, CLI печатает SKIP, `authorRole`/`case_gate`/порядок причин/`runBy.taskId` честные. Отдельно назови остаточные границы: удаление файла кейса, подделка run.json, забытый импорт в surfaceFiles.
