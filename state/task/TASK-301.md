---
id: TASK-301
kind: task
title: "Ревью 3: D5/D4/low после фикса"
status: done
revision: 4
createdAt: 2026-11-22T20:50:44.862Z
updatedAt: 2026-11-22T20:52:23.962Z
acceptance:
  - text: "D5 pass/fail с close от оркестратора"
    done: false
  - text: "D4 pass/fail на профиле и product tests/"
    done: false
  - text: "LOW pass/fail двусторонний паритет"
    done: false
  - text: "make test/verify/proof green; live профиль не тронут; risk task не закрыт; push нет"
    done: false
boardId: task-mwsba2sm-2pa9gp
chore: true
choreReason: "Целевая проверка фикса D5, D4 и low после второго ревью; risk task не закрыт, push не делался."
nonScope: ["не править код/тесты/README/docs/cases", "не трогать живой профиль/:3080", "не закрывать risk task; не пушить", "не переделывать P1/P2/batch"]
owner:
  kind: agent
  label: REVIEWER
  sessionId: dc0bb465-7b3e-40ad-beba-6dae7f7a4e52
preset: reviewer
resultEvidence: ["D5 fixture: parentSessionId root + childSessionIds sess-tester + violation -> product_shell_violation files src/app.mjs; clean -> ok", "D4 profile allow docs/cases/, test/, tests/; productTestName WRITE_SCOPE; testsTestName allow; caseFile allow; regression test write-scope.test.mjs:145-153", "LOW fieldsNotInParams [], paramsNotInFields [], reqIdInFields false", "make test 87/87; make verify 19/19; proof 29/29; taskboard 56/56; proof-guard 11/11", "live profile mtime 09:47, no preset-tester; docs/cases clean; no push"]
resultSummary: "Третий ревьювер: PASS по D5/D4/LOW. D5: закрытие от оркестратора (parentSessionId root) при violation за sess-tester из childSessionIds -> product_shell_violation, чистая строка проходит. D4: profile tester allow ровно docs/cases/, test/, tests/; src/app.test.mjs -> WRITE_SCOPE, tests/app.test.mjs allow; регрессионный тест на профиле. LOW: TASK_UPDATE_FIELDS и parameters совпадают в обе стороны, reqId удалён. make test 87/87, make verify 19/19, proof 29/29, taskboard 56/56, proof-guard 11/11; taskboard 0.1.84, proof-guard 0.1.8; live профиль/docs/cases не тронуты; risk task не закрыт, push нет."
role: REVIEWER
scope: ["plugins/taskboard/**, plugins/proof-guard/**, profile/cordis.patch.yml (чтение/прогоны)", "task-mws9zwaa-ontgwx (risk closure)", scripts/independent-verification-proof.mjs]
sessions:
  - sessionId: dc0bb465-7b3e-40ad-beba-6dae7f7a4e52
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

Проверить фикс D5/D4/low. D5: taskboard close проверяет violations по всем сессиям строки (childSessionIds, закрывающая, parentSessionId); закрытие от оркестратора при violation у sess-tester -> product_shell_violation; чистая строка проходит. D4: profile/cordis.patch.yml tester allow только docs/cases/, test/, tests/; глобальных **/*.test.*/**/*.spec.* нет; продуктовый src/app.test.mjs -> WRITE_SCOPE, tests/app.test.mjs allow; регрессионный тест на профиле. LOW: TASK_UPDATE_FIELDS и parameters двусторонне совпадают, reqId отсутствует. Плюс make test 87/87, make verify 19/19, proof 29/29; P1/P2/batch не сломаны; live профиль/:3080 не тронуты; docs/cases чист. Не правь; risk task не закрывай; push не делай.
