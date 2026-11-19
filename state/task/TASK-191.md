---
id: TASK-191
kind: task
title: "P0.2: Зафиксировать закрытие §8.5 (смешанный набор при переключении пресета)"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.850Z
updatedAt: 2026-11-17T15:52:41.850Z
acceptance:
  - text: "proof-скрипт: 62/62, exit 0"
    done: false
  - text: "доказательство второго сервера процитировано с числами (67 инструментов, playwright 0)"
    done: false
boardId: task-mwknzcrw-vejtoi
inline: true
nonScope: ["изменение tool-families", "поднятие второго сервера — доказательство уже записано"]
resultEvidence: ["node scripts/tool-families-proof.mjs → 62/62 checks passed, exit 0", "reports/tool-families-fix/FINDINGS.md §6: второй сервер :3081, сессия создана под orchestrator, переключена на backend до первого сообщения → шапка первого запроса 67 инструментов, mcp__playwright__* = 0, bash = есть (было 91/24)"]
resultSummary: "Смешанного набора нет: выбор пресета применяется до первого заголовка запроса. Прогон подтверждает 62/62; доказательство второго сервера записано ранее в FINDINGS §6."
scope: ["прогон node scripts/tool-families-proof.mjs", "чтение reports/tool-families-fix/FINDINGS.md §6 как доказательства второго сервера"]
---

Подтвердить пункт P0.2 дизайна: сессия, созданная под одним пресетом и переключённая на другой до первого сообщения, получает набор инструментов выбранного пресета в заголовке ПЕРВОГО запроса, без смешанного набора двух пресетов. Работа уже выполнена в tool-families 0.1.8 (reports/tool-families-fix/FINDINGS.md §6); нужно перепроверить прогоном и записать доказательство.

Migrated from .dsh/taskboard.json (task task-mwknzcrw-vejtoi, revision 4).
