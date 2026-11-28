---
id: TASK-300
kind: task
title: "Ревью 2: четыре непроверенных пункта risk closure"
status: done
revision: 5
createdAt: 2026-11-22T20:45:48.066Z
updatedAt: 2026-11-22T20:50:47.068Z
acceptance:
  - text: "Pass/fail по 2/4/5/7b с собственными фикстурами"
    done: false
  - text: "make test 87/87 + make verify + proof + flake-probe 10+"
    done: false
  - text: "live профиль/:3080 не тронуты; задача не закрыта; push нет"
    done: false
  - text: "Общий вердикт: можно ли закрывать risk task"
    done: false
boardId: task-mwsb3q5q-kie6v8
chore: true
choreReason: "Первый ревьювер подтвердил 1/3/6/7a, но не смог воспроизвести 2/4/5/7b из-за ограничений фейкового хоста; нужен целевой независимый прогон этих четырёх перед закрытием risk task и push."
nonScope: ["не править код/тесты/README/docs/cases", "не трогать живой профиль/:3080", "не закрывать risk task; не пушить", "не переделывать P1/P2/batch"]
owner:
  kind: agent
  label: REVIEWER
preset: reviewer
resultEvidence: ["make test 87/87; make verify 19/19; proof 29/29; taskboard 54/54; flake 6/6; 10 serial runs no failures", "2: reviewResults without batch -> review_results_incomplete unknown t1; params subset TASK_UPDATE_FIELDS", "7b: service.create journal; hand edit -> TASK_JOURNAL_MISMATCH; legacy closes", "D5: violation sess-tester; close parentSessionId root -> ok:true (expected product_shell_violation)", "D4: src/app.test.mjs -> allow (expected WRITE_SCOPE); tests/app.test.mjs allow", "live profile mtime 09:47; docs/cases clean; no push"]
resultSummary: "Второй ревьювер: risk closure закрывать нельзя. Подтверждены 2 (reviewResults без batch -> review_results_incomplete; params subset), 7b (task journal mismatch/legacy). D5 HIGH: shell violation при закрытии ищется по parentSessionId (сессия оркестратора), а не по childSessionIds строки — закрытие проходит ok:true, хотя violation за testing-сессией. D4 MEDIUM: продуктовый src/app.test.mjs разрешён (профиль всё ещё с **/*.test.*), заявление WRITE_SCOPE не выполняется. LOW: TASK_UPDATE_FIELDS содержит reqId вне parameters; автоматической сверки нет. make test 87/87, make verify 19/19, proof 29/29; live профиль/docs/cases не тронуты. Risk task не закрыт."
role: REVIEWER
scope: ["plugins/taskboard/**, plugins/proof-guard/**, plugins/test-cases/** (чтение/прогоны)", "task-mws9zwaa-ontgwx (risk closure)", "scripts/taskboard-flake-probe.mjs, proof scripts"]
---

Целевое независимое ревью четырёх пунктов risk closure. (2) task_update: с фейковым агентом, у которого agent.id = chatId, проверить reviewResults без reviewedTaskIds -> review_results_incomplete и паритет parameters/белого списка. (4) proof-guard: hard link под docs/cases на продукт -> WRITE_SCOPE; продуктовый src/app.test.mjs -> WRITE_SCOPE; tests/x.test.mjs разрешён. (5) shell audit: tester-сессия с agent.id, команда pwsh/bash меняет продуктовый файл; violation в .dsh/proof-guard-violations.json; taskboard close -> product_shell_violation. (7b) task journal: строка, записанная сервисом, затем ручная правка .dsh/taskboard.json -> TASK_JOURNAL_MISMATCH; строка без журнала (legacy) закрывается. Плюс make test 87/87, make verify 19/19, proof 29/29, flake-probe 10+; live профиль/:3080 не тронуты, docs/cases чист. Не правь код; задачу не закрывай; push не делай.
