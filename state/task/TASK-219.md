---
id: TASK-219
kind: task
title: "V1.10: доказательства red→green как условие закрытия REQ (FR11)"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.514Z
updatedAt: 2026-11-17T15:52:42.514Z
acceptance:
  - text: "`case_record` (и запись кейса) требует `reqId` и `authorRole`: без них отказ `test_req_required`, кейс не создаётся"
    done: false
  - text: "TEST зеркалируется в ядро: `state/test/` с reqId, authorRole, testPath, runCommand, frozenHash, evidenceRefs (из прогонов `case_run`) и статусом; повторная запись обновляет тот же TEST"
    done: false
  - text: "Гейт `evidence_required`: REQ не переходит в `done` без хотя бы одного TEST с пройденной парой red→green (evidenceRefs указывают на прогоны); отказ приходит с кодом, REQ остаётся в прежнем статусе"
    done: false
  - text: "Тавтологичный тест не проходит red-фазу — уже обеспечено `case_run` с negative control; приложи доказательство из существующей библиотеки кейсов, не переизобретай"
    done: false
  - text: "Red-first: на старых байтах (без гейта) REQ закрывается — это красный; после правки — отказ. Тесты test-cases/analysis/project-state зелёные, `make verify` exit 0, тарболы перепакованы"
    done: false
boardId: task-mwkukron-438ifl
nonScope: ["полная миграция docs/cases в TEST-файлы — FR13", "перенос evidence в state/evidence вне рабочей области — политика записи, FR8/фаза 3", "изменения UI и панели кейсов", "живой :3080"]
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
ownerRole: BACKEND
preset: backend
resultEvidence: ["node --test plugins/test-cases/test/*.test.mjs → 16/16; analysis 9/9; project-state 12/12 (моя проверка)", "make verify → exit 0", "без reqId/authorRole → TEST_REQ_REQUIRED, файл кейса не создаётся", "proven без пары :red:fail + :green:pass → evidence_required, ни запись анализа, ни REQ не пишутся", "тавтология отвергается case_run mode:red с negative control (plugins/test-cases/test/runner.test.mjs:103)"]
resultSummary: "Доказательства замкнуты на реестр: case_record без reqId и роли автора отказывает test_req_required; каждый TEST зеркалируется в ядро с reqId, authorRole, frozenHash и evidenceRefs из прогонов; REQ не закрывается без пары :red:fail + :green:pass (evidence_required) — green-only и upsert без доказательств не проходят. Тавтологичный тест по-прежнему отвергается red-прогоном с negative control. Гейты: test-cases 16/16, analysis 9/9, project-state 12/12, make verify exit 0. Тарболы test-cases 0.1.14, analysis 0.1.12, project-state 0.1.5."
role: BACKEND
scope: ["plugins/test-cases — требование reqId/authorRole, зеркалирование TEST в ядро, связь evidenceRefs с прогонами", "plugins/analysis — гейт evidence_required перед статусом done", "plugins/project-state — поля TEST, если не хватает", "тесты всех трёх плагинов, перепаковка, документы"]
---

Замкнуть доказательства на реестр (FR11): кейс без `reqId` и `authorRole` не создаётся (`test_req_required`); каждый TEST зеркалируется в ядро с reqId, ролью автора, замороженным хешем и ссылками на прогоны; и главное — REQ не может перейти в `done` без хотя бы одного TEST с пройденной парой red→green (`evidence_required`). Раннер уже умеет исполнять сохранённую команду, писать evidence-манифест и отвергать тавтологичный тест через red-прогон с negative control — переиспользуй это, не переизобретай. Докажи red-first: без гейта REQ закрывается, с гейтом — отказ.

Migrated from .dsh/taskboard.json (task task-mwkukron-438ifl, revision 7).
