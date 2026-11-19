---
id: TASK-187
kind: task
title: "PTC: свежие gatherer/reviewer с 0.1.8 и волна docs/critic"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.759Z
updatedAt: 2026-11-17T15:52:41.759Z
boardId: task-mwkmqj2u-u3ou21
nonScope: ["живой :3080 и установленный профиль — не трогать", "budget/tool/скрипты — только чтение", "docs/HARNESS-OVERVIEW.md и docs/PLUGIN-PROOFS.md — отдельная задача DOCS"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 9f9ba103-cddd-4b9b-9a1c-14c648707ccc
ownerRole: BACKEND
preset: backend
resultEvidence: ["reports/ptc-wave3/sessions/session-2a497060: gatherer SDK 59, playwright 0, ответ 24", "reports/ptc-wave3/sessions/session-9989ecfd: reviewer SDK 65, playwright 0, PASS 6/0", "reports/ptc-wave3/sessions/session-f3856e88: critic SDK 65, playwright 0, ответ 42", "reports/ptc-wave3/sessions/session-7b2f546b.raw: docs final, header [run_code], playwright 0, 0 errors", "profile: tool-executor-ptc в preset-critic (1137) и preset-docs (1212)"]
resultSummary: "PTC волна 3: docs и critic на tool-executor-ptc, свежие gatherer/reviewer с tool-families 0.1.8. Все четыре сессии — header [run_code], SDK 59/65/65/67, mcp__playwright__* 0, godot 0, bash есть; 0 INVALID_REQUEST/CODE_RUN_FAILED. docs: journal 7b2f546b, 67/0, $0.00326; critic: SDK 65/0, ответ 42 (короткая атака). Первый docs с усечённым слоем (24 playwright) отброшен. :3080 не тронут."
role: BACKEND
scope: ["profile/cordis.patch.yml — ряды tool-executor-ptc в preset-docs и preset-critic", "второй сервер :3081 с id-слоем gatherer/reviewer/docs/critic и scratch tool-families 0.1.8", "reports/ptc-wave3/ — журналы, снимки, FINDINGS.md", "docs/PTC-MODE-ANALYSIS.md и rules/DEPLOYMENT.md — свежая перепроверка и волна 3"]
sessions:
  - sessionId: 9f9ba103-cddd-4b9b-9a1c-14c648707ccc
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Перепроверить свежие gatherer/reviewer с tool-families 0.1.8 (SDK без 24 mcp__playwright__*), перевести docs и critic на PTC, проверить их свежими сессиями и замерить docs; обновить PTC-анализ и DEPLOYMENT. Живой :3080 не трогать.

Migrated from .dsh/taskboard.json (task task-mwkmqj2u-u3ou21, revision 6).
