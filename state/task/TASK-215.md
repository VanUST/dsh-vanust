---
id: TASK-215
kind: task
title: "V1.8: запись анализа как обоснование REQ — зеркалирование, дедуп, digest (FR9)"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.428Z
updatedAt: 2026-11-17T15:52:42.428Z
acceptance:
  - text: "`analysis_upsert` с требованиями создаёт/обновляет REQ в `state/req/` — по одному на требование, со связью `analysisRef = {initiative, requirementId}` и критериями из `acceptance`; повторный upsert обновляет ТОТ ЖЕ REQ (без дублей), статус маппится planned→proposed, proven→done, deferred/rejected→rejected"
    done: false
  - text: "REQ не создаётся, если у требования пустой `acceptance`: запись отклоняется с кодом (`req_criteria_required` или аналог), файл REQ не пишется"
    done: false
  - text: "При создании нового REQ ищутся похожие существующие (по тексту/критериям) и возвращаются кандидаты; без явного подтверждения разбора (`allowDuplicate: true` с причиной или `duplicateReview`) запись отклоняется с кодом и списком кандидатов"
    done: false
  - text: "После записи вызывается `regenerateViews()` ядра → `state/views/digest.md` непуст и содержит id REQ; `index.json` показывает связь REQ↔analysis"
    done: false
  - text: "Старое поведение `analysis` не сломано: его собственные тесты и `scripts/analysis-before-decomposition-proof.mjs` зелёные; композиция без ядра работает в прежнем режиме (core опционален через `ctx.get`)"
    done: false
  - text: "Перепаковка analysis (0.1.10 → 0.1.11), документы обновлены, `make verify` exit 0"
    done: false
boardId: task-mwku3ad7-vji8lm
nonScope: ["миграция существующих записей (FR13) — отдельно; здесь только новые записи", "гейты lifecycle и холодный старт (FR8/FR12) — отдельно", "новые модельные тулы не добавлять сверх необходимого", "живой :3080; запись анализа этой сессии не трогать"]
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
ownerRole: BACKEND
preset: backend
resultEvidence: ["analysis 5/5, project-state 12/12, state-feed 6/6 — моя проверка", "scripts/analysis-before-decomposition-proof.mjs → 138/138, exit 0", "make verify → exit 0", "зеркалирование: один REQ на требование с analysisRef + criteriaHash; повторный upsert обновляет тот же; пустой acceptance → req_criteria_required; дубль → req_duplicate_candidates; digest непуст после regenerateViews", "тарболы analysis 0.1.11, project-state 0.1.3"]
resultSummary: "Реестр REQ работает: каждый analysis_upsert зеркалирует требования в state/req/ — один REQ на требование с analysisRef={initiative, requirementId}, критериями из acceptance и criteriaHash; повторный upsert обновляет тот же REQ, второй файл не создаётся; пустой acceptance отклоняется до записи (req_criteria_required); новое требование сверяется с существующими и возвращает кандидатов, проходит только с allowDuplicate + duplicateReview; после записи ядро регенерирует проекции, digest непуст. Ядро опционально через ctx.get — композиция без него работает как раньше. Гейты: analysis 5/5, project-state 12/12, state-feed 6/6, proof 138/138, make verify exit 0. Тарболы analysis 0.1.11, project-state 0.1.3."
role: BACKEND
scope: ["plugins/analysis — зеркалирование требований в REQ, дедуп-кандидаты, вызов regenerateViews", "тесты analysis и project-state, чтобы зеркалирование не сломало существующее", "перепаковка analysis, документы"]
---

Сделать запись анализа обоснованием требования: при `analysis_upsert` каждое требование (BR/FR/NFR) зеркалируется в ядро как REQ в `state/req/` — один REQ на требование, со связью `analysisRef`, критериями из `acceptance` и замороженным `criteriaHash`; повторный upsert обновляет тот же REQ, а не создаёт второй. При создании нового REQ ищутся похожие существующие и возвращаются кандидаты: без явного разбора дубля запись отклоняется. После записи ядро регенерирует проекции, поэтому `digest.md` для L1 перестаёт быть пустым, а `index.json` показывает связь REQ↔запись анализа. Ядро опционально: композиция без него работает в прежнем режиме. Не сломать существующую семантику analysis (CAS, fingerprint, валидация) — это главный риск задачи.

Migrated from .dsh/taskboard.json (task task-mwku3ad7-vji8lm, revision 7).
