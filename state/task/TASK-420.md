---
id: TASK-420
kind: task
title: "Проверить закрытие задачи, прерванную запись и отказ при расхождении"
status: done
revision: 46
createdAt: 2026-11-28T11:04:53.629Z
updatedAt: 2026-11-28T12:48:13.368Z
acceptance:
  - text: "Три критерия имеют кейсы, измерение прежней версии и заключение по исправлению."
    done: false
boardId: task-mx0azs5z-s65jom
chore: true
choreReason: "Независимые кейсы для требований REQ-293 и REQ-294; не реализация требований."
nonScope: ["Продуктовый код, работающий сервер и данные рабочих досок."]
owner:
  kind: agent
  label: TESTER
preset: tester
resultEvidence: ["TEST-105 rev 21: красный mx0e84l6-n92on-1 на d14bc29 (exit 1), зелёный mx0e8ay1-os5ph-1 (exit 0).", "TEST-106 rev 28: красный mx0e85kr-dpenq-1, зелёный mx0e8but-87jcq-1; TEST-107 rev 26: красный mx0e86js-8bf5o-1, зелёный mx0e8d11-wu6tx-1 (оба красных на 0.1.95 b7e358b4, exit 1).", "Все прогоны source runner; драйвер sha256 30d02d1c…; surfaceFiles 81fa00f3 / 1fe011fc / b6dbfdc0.", "Негативный контроль mx0e3aze-6v8ts-1: exit 1 при CASE_NEGATIVE_CONTROL=expect-refusal.", "case_gate по TASK-419: blockers []."]
resultSummary: "Три независимых кейса приёмки написаны, измерены красными на прежних версиях и зелёными на принятых байтах 0.1.97; гейт по TASK-419 без блокеров. Запись проверки оболочки, блокировавшая закрытие, оказалась ложной и снята с сохранением фактов в заметке."
role: TESTER
scope: [plugins/taskboard/test/, docs/cases/]
---

До изменения кода измерить отказ прежней версии, затем прогнать те же кейсы на исправлении.
