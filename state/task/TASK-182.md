---
id: TASK-182
kind: task
title: "PTC волна 2: backend и ux"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.654Z
updatedAt: 2026-11-17T15:52:41.654Z
boardId: task-mwkkohme-gb4uop
nonScope: ["живой :3080", "установленный профиль", "tool-families — отдельная задача"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 9f9ba103-cddd-4b9b-9a1c-14c648707ccc
ownerRole: BACKEND
preset: backend
resultEvidence: ["profile/cordis.patch.yml: tool-executor-ptc в preset-ux (752) и preset-backend (827), gatherer (972), reviewer (1051); остальные без", "reports/ptc-wave2/sessions/session-641cbd5f: header [run_code], SDK 67, playwright 0, bash; outline PASS 6/0", "reports/ptc-wave2/sessions/session-2c0c7d3f: job/registered + job/settled, completed exit 0, 5.3 s", "reports/ptc-wave2/sessions/session-629f79fa: SDK 91, playwright 24, bash; PTCOK; 1 CODE_RUN_FAILED cold start, retry 193/16 ms", "reports/ptc-wave2/price-*.json: native 0.001950; PTC 0.004712 / 0.002288; break-even >2", "node scripts/check-documentation.mjs ok; node scripts/tool-families-proof.mjs 62/62; check-portability 16/17 (designmap)"]
resultSummary: "Волна 2 закрыта: tool-executor-ptc в preset-ux (752) и preset-backend (827); PTC у gatherer/reviewer/backend/ux, native у orchestrator/research/critic/docs. Backend SDK 67/0/bash, outline PASS; фоновая bash через job_output; ux SDK 91/24/bash, PTCOK, один CODE_RUN_FAILED на холодном старте браузера (120 с) с успешным повтором. Цена: native 0.001950; PTC 0.004712 (1 вызов), 0.002288 (2 вызова) — окупаемость выше двух, на 20-файловом аудите PTC был на 31% дешевле. Документы и кейсы обновлены; :3080 не тронут."
role: BACKEND
scope: [profile/cordis.patch.yml, "второй сервер :3081", reports/ptc-wave2/]
---

Перевести preset-backend и preset-ux на tool-executor-ptc; проверить свежие сессии на втором сервере (один run_code, SDK, вложенные вызовы, корректная задача), замерить цену PTC против native на фиксированной задаче, проверить долгую команду через фон и браузерный инструмент ux.

Migrated from .dsh/taskboard.json (task task-mwkkohme-gb4uop, revision 8).
