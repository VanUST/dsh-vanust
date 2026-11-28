---
id: TASK-278
kind: task
title: "P0: атака на условие приёмки — найти обход самопроверки"
status: done
revision: 5
createdAt: 2026-11-22T10:54:26.416Z
updatedAt: 2026-11-22T11:15:34.607Z
acceptance:
  - text: "Найден воспроизводимый обход или доказано, что каждый проверенный путь отказан"
    done: false
  - text: "Для обхода: точная команда/фикстура, вывод, exit code и минимальный вход; для чистого отчёта — список атак и что осталось непроверенным"
    done: false
  - text: "Проверено, что независимый прогон (orchestrator author + reviewer run) по-прежнему проходит"
    done: false
  - text: "Не тронуты общий каталог, живой профиль, :3080 и production data"
    done: false
  - text: "Отчёт называет, что именно защита не покрывает и каким классом входа это достижимо"
    done: false
boardId: task-mwrpz7bh-fdgtjd
nonScope: ["не править общий рабочий каталог C:/dsh-kit", "не трогать живой профиль ~/.npm/dsh/profiles/web, :3080 и production data", "не исправлять найденный обход и не писать патч", "не менять существующие docs/cases/*.json в общем дереве"]
owner:
  kind: agent
  label: CRITIC
preset: critic
reqIds: [REQ-185, REQ-186, REQ-187, REQ-188, REQ-193]
resultEvidence: ["F1: CLI gate --task t1 --implementer backend → exit 0 с errors CASE_UNREADABLE после '{\"'; taskboard close ok", "F2: рукописный JSON verified/source runner/runBy reviewer/authorPreset orchestrator с runs:[] → gate ok, task closed", "F3: createdBy agent + runBy agent → gate ok при implementer backend", "F5: удалить тест + case_drift → automated false/degraded → gate ok", "F4: helper.mjs изменён после прогона → gate ok", "F6: case_gate с implementerPreset critic → ok для self-run кейса", "Контроль: orchestrator author + reviewer run → закрытие принято"]
resultSummary: "Атака на условие приёмки P0 нашла два HIGH-обхода: нечитаемый файл кейса не блокирует закрытие (F1) и рукописная запись JSON с фиктивным lastVerified проходит без прогона (F2). Внутри инструментов агента обходов нет: self-authored/self-run, подмена автора и отсутствие implementerPreset отказаны. F3-F7 — medium/low, общий каталог и живой профиль не тронуты."
role: CRITIC
scope: ["одноразовая копия /tmp или scratch checkout", "plugins/test-cases/**, plugins/taskboard/**, scripts/independent-verification-proof.mjs, docs/cases fixtures в копии", "чтение и запуск инструментов, case_run/case_gate/taskboard close, CLI cases.mjs"]
---

Атаковать новое условие приёмки P0 и найти способ закрыть задачу доказательством, которое создал или подтвердил исполнитель. Работай на одноразовой копии дерева; не правь продукт, тесты или данные. Нужен smallest reproducible bypass либо отчёт с перечнем атак и границ. Особое внимание: правка JSON кейса напрямую, обход через case_update/case_deprecate/case_supersede/case_remove, case_run/case_suite исполнителем, gate без implementerPreset, legacy fallback createdBy, authorPreset=agent, runBy spoofing, testHash re-pin, purpose=implementation, documented-only, shell-запись, taskboard owner-status/panel, CLI. Не чини найденное.
