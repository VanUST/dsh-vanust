---
id: TASK-228
kind: task
title: "V6.1: диета схем и вейвер lifecycle-гейтов — последний срез (FR5 + FR8)"
status: done
revision: 1
createdAt: 2026-11-17T16:52:08.398Z
updatedAt: 2026-11-17T16:52:08.398Z
boardId: task-mwkxc9hi-87mmtp
ownerRole: BACKEND
---

Последний срез программы: диета схем инструментов (FR5) и lifecycle-гейты с вейвером (FR8) — одной задачей на два требования. Для FR5: линтер статически меряет байты описаний инструментов, даёт WARN/RED по порогам, встроен в make verify, и самые тяжёлые описания урезаны без роста сумм по пресетам; red-first обязателен — искусственно раздутое описание должно валить линтер. Для FR8: каждый существующий гейт (req_required, evidence_required, test_req_required, steps_incomplete) принимает явный вейвер с причиной и человеком, без них отказывает кодом waiver_required, а с ними операция проходит и в журнал пишется запись с кодом, причиной и человеком; замена решения требует преемника и причину (decision_superseded). Докажи отказ и вейвер для каждого гейта, приложи запись журнала.

Migrated from .dsh/taskboard.json (task task-mwkxc9hi-87mmtp, revision 6).
