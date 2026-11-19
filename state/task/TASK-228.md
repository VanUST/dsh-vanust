---
id: TASK-228
kind: task
title: "V6.1: диета схем и вейвер lifecycle-гейтов — последний срез (FR5 + FR8)"
status: done
revision: 2
createdAt: 2026-11-17T16:52:08.398Z
updatedAt: 2026-11-17T16:52:08.398Z
acceptance:
  - text: "Новый линтер схем (`scripts/schema-lint.mjs` или аналог) печатает байты описания каждого инструмента и суммы по пресетам, даёт WARN выше порога и RED выше двойного; встроен в `make verify`"
    done: false
  - text: "Red-first: искусственно раздутое описание инструмента валит линтер (красный), после возврата — зелёный"
    done: false
  - text: "Диета: самые тяжёлые описания урезаны, суммы по пресетам не выросли против замеренной базы; цифры до/после в отчёте"
    done: false
  - text: "Вейвер: каждый lifecycle-гейт (`req_required`, `evidence_required`, `test_req_required`, `steps_incomplete`) принимает явный `waiver: {reason, by: 'human'}`; без обоих полей — отказ с кодом `waiver_required`, с ними — операция проходит и в журнал пишется запись с кодом, причиной и человеком"
    done: false
  - text: "`decision_superseded`: замена решения требует id преемника и причину, иначе отказ; решение без преемника отклонить нельзя"
    done: false
  - text: "Доказательства: каждый гейт наблюдается отказывающим, затем вейвернутым, запись в журнале видна; тесты затронутых плагинов зелёные, `make verify` exit 0"
    done: false
boardId: task-mwkxc9hi-87mmtp
nonScope: ["policy-плагин с запретом записи в state/ и tests/ (fs/sandbox) — это фаза 3, отдельная задача; здесь только вейвер существующих гейтов", "переписывание всех схем целиком", "правка панели и designmap", "живой :3080"]
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
ownerRole: BACKEND
preset: backend
resultEvidence: ["scripts/schema-lint.mjs: 43 инструмента, WARN 600 / RED 1200, в make verify; раздутое описание 1983 Б → exit 1", "диета: 14 659 → 11 573 Б (−21%); после — 0 red, 0 warn", "вейвер на req_required, steps_incomplete, test_req_required, evidence_required; неполный → waiver_required; журнал {kind:'waiver', code, reason, by:'human'}", "scripts/waiver-proof.mjs — 17/17; decision_superseded требует преемника и причину"]
resultSummary: "Диета схем и вейвер поставлены: линтер меряет байты описаний, даёт WARN/RED и падает по красному (red-first снят), самые тяжёлые описания урезаны с 14 659 до 11 573 Б без роста пресетных сумм. Каждый lifecycle-гейт принимает явный вейвер с причиной и человеком, без него — прежний код или waiver_required при неполном; вейвер пишется в state/events.jsonl; замена решения требует преемника и причину. waiver-proof 17/17, тесты четырёх плагинов зелёные."
role: BACKEND
---

Последний срез программы: диета схем инструментов (FR5) и lifecycle-гейты с вейвером (FR8) — одной задачей на два требования. Для FR5: линтер статически меряет байты описаний инструментов, даёт WARN/RED по порогам, встроен в make verify, и самые тяжёлые описания урезаны без роста сумм по пресетам; red-first обязателен — искусственно раздутое описание должно валить линтер. Для FR8: каждый существующий гейт (req_required, evidence_required, test_req_required, steps_incomplete) принимает явный вейвер с причиной и человеком, без них отказывает кодом waiver_required, а с ними операция проходит и в журнал пишется запись с кодом, причиной и человеком; замена решения требует преемника и причину (decision_superseded). Докажи отказ и вейвер для каждого гейта, приложи запись журнала.

Migrated from .dsh/taskboard.json (task task-mwkxc9hi-87mmtp, revision 6).
