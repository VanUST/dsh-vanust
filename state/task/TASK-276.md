---
id: TASK-276
kind: task
title: "P0: происхождение доказательства и условие приёмки без самопроверки"
status: done
revision: 18
createdAt: 2026-11-22T10:32:41.271Z
updatedAt: 2026-11-22T11:39:16.779Z
acceptance:
  - text: "case_record записывает authorPreset и authorSessionId из сессии; агент не может подменить автора; человек может назвать автора; purpose и testHash записаны"
    done: false
  - text: "case_verify для automated case не даёт verified при ручном успехе; evidence помечено manual; провал остаётся failing"
    done: false
  - text: "case_update разрешён только автору/человеку; изменение expected/steps/checks/surfaceFiles/automated сбрасывает подтверждение; automated true->false и acceptance->implementation отклоняются; testHash пересчитывается при смене теста"
    done: false
  - text: "case_run и case_suite пишут runBy в run.json и lastVerified; case_run отказывает при отсутствии или расхождении testHash"
    done: false
  - text: "taskboard.beforeClose передаёт implementerPreset; gateForTask блокирует self-authored, self-run, manual, legacy, test-changed и stale; возвращает evidence; reviewer-прогон проходит"
    done: false
  - text: "scripts/independent-verification-proof.mjs воспроизводит сценарии обхода и независимый прогон, печатает PASS/FAIL и выходит 0; на копии HEAD старый код принимает самопроверку — красный прогон записан"
    done: false
  - text: "node --test plugins/test-cases/test/*.test.mjs exit 0; node --test plugins/taskboard/test/*.test.mjs exit 0; make test exit 0; make verify exit 0"
    done: false
  - text: "Тарболы test-cases и taskboard совпадают с исходниками; версии подняты; живой профиль и :3080 не тронуты"
    done: false
  - text: "F1 high: нечитаемый файл кейса блокирует task_close и CLI exit 1; ошибка названа, а не проглочена"
    done: false
  - text: "F3/D7: пустой пресет и литерал agent не считаются независимым автором/прогоном; отказ UNKNOWN_PRESET"
    done: false
  - text: "F5: degraded acceptance case продолжает блокировать; удаление теста не выводит кейс из-под правила"
    done: false
  - text: "F2: рукописная запись без артефакта прогона блокируется; lastVerified сверяется с runs/run.json"
    done: false
  - text: "F4: автоматический кейс приёмки требует surfaceFiles; изменение поверхности после прогона блокирует"
    done: false
  - text: "D2-D6: CLI печатает SKIP для пропущенного кейса, authorRole берётся из сессии, case_gate не верит агенту, причина STALE видна в закрытии, runBy содержит taskId"
    done: false
  - text: "B2: task row caseIds; удаление связанного кейса блокирует CASE_MISSING; задача без caseIds не требует кейса (L0/L1); несвязанный битый файл не блокирует здоровую задачу"
    done: false
  - text: "R2: ошибки библиотеки блокируют только связанные кейсы, а не все задачи"
    done: false
  - text: "R3: runBy.taskId сверяется с linkedTaskId в артефакте"
    done: false
  - text: "R4: CLI и хост используют один список известных пресетов"
    done: false
  - text: "S8: кейс другой задачи не закрывает задачу; record.linkedTaskId и runBy.taskId сверяются с задачей вопроса, а не только с собственной ссылкой кейса"
    done: false
  - text: "S7: task_create пишет caseIds: [] по умолчанию; новая задача без кейса не попадает в legacy-обзор"
    done: false
  - text: "S2/S3b/S9 (caseIds: [] или подмена preset строки) — названная граница B1': строка задачи считается доверенной, ручная правка .dsh/taskboard.json вне P0; журнал — P1"
    done: false
  - text: "Финальный целевой ревьюер подтверждает S8/S7, зелёные гейты и границы B1/B1'/R1/legacy"
    done: false
boardId: task-mwrp79fk-ewaclo
nonScope: ["profile/cordis.patch.yml, новый пресет TESTER, DEFAULT_ROLE_TOOLS для tester, proof-guard — это P1 (FR7), не трогать", "docs/cases/*.json: существующие кейсы не переписывать; тесты используют временные каталоги", "живой профиль ~/.npm/dsh/profiles/web и :3080 не трогать", "P2 (покрытие критериев, task contract, criterionId) не реализовывать", "не менять designmap/* — карта уже обновлена"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-185, REQ-186, REQ-187, REQ-188, REQ-193]
resultEvidence: ["node --test plugins/test-cases/test/*.test.mjs -> tests 63, pass 63, fail 0, exit 0", "node --test plugins/taskboard/test/*.test.mjs -> 37/37 isolated four times; first concurrent run flaked on strictEqual (load-sensitive, named)", "node scripts/independent-verification-proof.mjs -> 24/24 checks held, 11 bypasses refused and accepted at HEAD, exit 0", "make test -> 78/78 passed, exit 0; make verify -> 19/19, exit 0", "tarballs cc-dsh-test-cases-0.1.27.tgz and cc-dsh-taskboard-0.1.74.tgz byte-identical to sources", "Reviewer round 4 verdict accept; S8 CASE_FOREIGN/CASE_UNLINKED, S7 task_create caseIds: [], LOW-1/2/6 confirmed on independent fixtures", "Critic rounds found F1/F2/B2/S8/S7; all fixed; B1/B1'/R1/S10/legacy named boundaries", "docs/cases unchanged; live profile and :3080 untouched"]
resultSummary: "P0 принят после трёх независимых проходов и финального целевого ревью. Кейс приёмки знает автора и исполнителя прогона из сессии; ручное наблюдение не подтверждает автоматический кейс; оракул, тест и артефакт прогона защищены (testHash, RUN_ARTIFACT_MISSING/MISMATCH, stale, author-only update); task_close проверяет task↔case link (caseIds), отказывает самопроверке, manual, legacy, deleted/corrupt/foreign/unlinked case, runBy.taskId и не блокирует здоровую задачу посторонним битым файлом. Версии test-cases 0.1.27, taskboard 0.1.74. Границы B1/B1'/R1/S10/legacy — P1/P2; формальный TEST для самой задачи не создан, FR1-FR4/NFR1 в записи анализа помечены deferred."
role: BACKEND
scope: ["plugins/test-cases/test-cases.mjs: case_record, case_update, case_verify, case_run, case_suite, case_gate, gateForTask, DEFAULT_ROLE_TOOLS (только если нужно для P0)", "plugins/test-cases/lib/runner.mjs: runBy в run.json и lastVerified, redSource задел на будущее без изменения поведения P0", "plugins/test-cases/lib/schema.mjs: хеш теста и проверка расхождения, если это место лучше", "plugins/test-cases/test/*.test.mjs: тесты P0", "plugins/test-cases/README.md: контракт P0", "plugins/taskboard/taskboard.mjs: beforeClose передаёт implementerPreset и задачу в cases.gateForTask", "plugins/taskboard/test/*.test.mjs: тест на передачу пресета и отказ", "scripts/independent-verification-proof.mjs: сквозное доказательство обходов и независимого прогона", "plugins/test-cases/package.json и plugins/taskboard/package.json: версии и тарболы, если меняются исходники"]
steps: ["Записать автора кейса и исполнителя прогона из сессии; purpose и testHash", "Ручное подтверждение автоматического кейса перестаёт давать verified", "Защитить оракул и тест: author-only update, инвалидация, отказ при изменённом тесте", "Передать пресет исполнителя из taskboard в условие приёмки и вернуть evidence", "Доказать обходы и независимый прогон скриптом; прогнать тесты, make test, make verify; перепаковать тарболы", "Исправить F1/F2/F3/F4/F5 и D2-D7 по отчётам ревью и атаки; перепроверить", "Добавить task↔case link (caseIds), B2/R2/R3/R4; третий независимый проход", "S8 (чужая задача) и S7 (caseIds: [] у новых задач); финальный целевой ревью"]
stepsDone: 8
---

Закрыть P0 независимой проверки в ките: кейс знает автора и исполнителя прогона из сессии, ручное наблюдение не подтверждает автоматический кейс, оракул и тестовый файл защищены от правки, а task_close отказывает самопроверке и возвращает происхождение доказательства. Изменения локальны для plugins/test-cases и plugins/taskboard; пресет TESTER, profile/cordis.patch.yml и proof-guard остаются на P1.
