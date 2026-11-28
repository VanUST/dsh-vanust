---
id: TASK-280
kind: task
title: "P0 fix: вторая атака на условие приёмки"
status: done
revision: 5
createdAt: 2026-11-22T11:15:32.919Z
updatedAt: 2026-11-22T11:28:02.537Z
acceptance:
  - text: "Найден воспроизводимый обход или каждый проверенный путь отказан"
    done: false
  - text: "Для обхода: точная команда/фикстура, вывод, exit code и минимальный вход"
    done: false
  - text: "Независимый контроль проходит; общий каталог/живой профиль не тронуты"
    done: false
  - text: "Отчёт называет, что именно защита не покрывает и каким классом входа это достижимо"
    done: false
boardId: task-mwrqqbkg-96m7gq
nonScope: ["не править общий рабочий каталог C:/dsh-kit", "не трогать живой профиль ~/.npm/dsh/profiles/web, :3080 и production data", "не исправлять найденное и не писать патч", "не менять существующие docs/cases/*.json в общем дереве"]
owner:
  kind: agent
  label: CRITIC
preset: critic
reqIds: [REQ-185, REQ-186, REQ-187, REQ-188, REQ-193]
resultEvidence: ["B1: hand-written case + run.json -> CLI gate ok:true, exit 0; board.close CLOSED", "B2: delete docs/cases/<id>.json -> gate checked=0, errors=[]; close CLOSED", "R1: surfaceFiles ['probe.mjs'], app.mjs changed -> gate ok:true", "R2: unrelated zzz-unrelated.json='{' -> ok:false, exit 1 for a healthy task", "R3: forged run.json without taskId passes", "R4: CLI hardcoded known presets vs host config", "Baseline: proof 22/22, targeted tests 29/29, independent control passes", "Shared tree/docs/cases not edited; live profile/:3080 untouched"]
resultSummary: "Вторая атака подтвердила остаточные границы: B1 — рукописная пара кейс+run.json принимается (граница P1: нет подписи/журнала); B2 — удаление всего файла кейса закрывает задачу (нет task↔case link); R1 — surfaceFiles не доказывает покрытие; R2 — любой битый файл блокирует все задачи; R3 — runBy.taskId не проверяется; R4 — CLI и хост расходятся в known presets. Закрытые пути: case_gate не верит агенту, qa -> UNKNOWN_PRESET, degraded/authorRole/manual/независимый контроль. Отправлено в фикс P0 для B2/R2/R3/R4; B1/R1 — граница P1."
role: CRITIC
scope: ["одноразовая копия /tmp или scratch checkout", "plugins/test-cases/**, plugins/taskboard/**, scripts/independent-verification-proof.mjs, docs/cases fixtures в копии", "запуск инструментов, case_run/case_gate/taskboard close, CLI cases.mjs"]
---

Вторая атака на P0 после фикса. Найди способ закрыть задачу доказательством, которое создал или подтвердил исполнитель, несмотря на новые проверки: нечитаемый файл, run.json, known presets, degraded, surfaceFiles. Работай на одноразовой копии; не правь общий каталог, продукт, тесты и данные. Особое внимание: рукописный кейс + рукописный run.json, удаление всего файла кейса, переименование/чужой id, нечитаемый несвязанный кейс, surfaceFiles с одним фиктивным файлом, case_gate с аргументом, CLI, taskboard owner-status. Нужен smallest reproducible bypass или отчёт с перечнем атак и границ; не чинить.
