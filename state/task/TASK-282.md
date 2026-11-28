---
id: TASK-282
kind: task
title: "P0 fix 2: третья атака на task↔case link"
status: done
revision: 5
createdAt: 2026-11-22T11:28:00.468Z
updatedAt: 2026-11-22T11:49:43.228Z
acceptance:
  - text: "Найден воспроизводимый обход или каждый проверенный путь отказан"
    done: false
  - text: "Для обхода: точная команда/фикстура, вывод, exit code и минимальный вход"
    done: false
  - text: "Здоровая задача с caseIds не блокируется посторонним битым файлом; независимый контроль проходит"
    done: false
  - text: "Отчёт называет, что link не покрывает (task row edit, B1, R1), и не выдаёт известную границу за новый дефект"
    done: false
boardId: task-mwrr6cte-i584f1
nonScope: ["не править общий C:/dsh-kit", "не трогать живой профиль ~/.npm/dsh/profiles/web, :3080 и production data", "не исправлять найденное", "не менять существующие docs/cases/*.json в общем дереве"]
owner:
  kind: agent
  label: CRITIC
preset: critic
reqIds: [REQ-185, REQ-186, REQ-187, REQ-188, REQ-193]
resultEvidence: ["S0 control: orchestrator author + reviewer run -> CLOSED", "S1 linked case file deleted -> CASE_MISSING, REFUSED", "S2/S3b caseIds: [] -> CLOSED (B1' boundary: task row trusted)", "S8 task B closes on task A's measured case -> CLOSED (fix S8)", "S9 row preset changed to critic -> CLOSED (B1' boundary)", "S7 row without caseIds + unrelated corrupt -> cases_unreadable (fix S7)", "S4 fake caseId -> CASE_MISSING; S5 documented-only -> CASE_NOT_ACCEPTANCE; S10 CLI --board diagnostic", "proof 24/24, targeted tests 33/33; shared tree/docs/cases untouched"]
resultSummary: "Третья атака на task↔case link: S1 удаление связанного кейса отказано, S4 фальшивый id и S5 documented-only отказаны, независимый контроль проходит. Найдены S2/S3b (caseIds: [] снимает требование; граница B1' — строка задачи доверенная), S8 (задача B закрывается кейсом задачи A — исправляется в P0), S9 (подмена preset строки — B1'), S7 (новая задача без caseIds попадает в legacy-обзор — исправляется), S10 (CLI --board — диагностика). B1/R1 не ухудшились."
role: CRITIC
scope: ["одноразовая копия /tmp или scratch checkout", "plugins/test-cases/**, plugins/taskboard/**, scripts/independent-verification-proof.mjs, docs/cases fixtures в копии", "запуск инструментов, case_run/case_gate/taskboard close, CLI cases.mjs"]
---

Третья атака на P0 после task↔case link. Найди способ закрыть задачу без независимого измеренного прогона, несмотря на caseIds: удалить связанный кейс, очистить/удалить caseIds в строке задачи, подменить preset строки, добавить фальшивый caseId, использовать legacy-строку без caseIds, сломать несвязанный кейс, подделать runBy.taskId. Работай на одноразовой копии; не правь общий каталог. B1 (подделка пары кейс+run.json) и R1 (surfaceFiles) — известные границы P1; не выдавай их за новый дефект, но проверь, не стали ли они проще из-за link. Нужен smallest reproducible bypass или список атак и границ.
