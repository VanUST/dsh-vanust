---
id: TASK-215
kind: task
title: "V1.8: запись анализа как обоснование REQ — зеркалирование, дедуп, digest (FR9)"
status: done
revision: 1
createdAt: 2026-11-17T15:52:42.428Z
updatedAt: 2026-11-17T15:52:42.428Z
boardId: task-mwku3ad7-vji8lm
ownerRole: BACKEND
---

Сделать запись анализа обоснованием требования: при `analysis_upsert` каждое требование (BR/FR/NFR) зеркалируется в ядро как REQ в `state/req/` — один REQ на требование, со связью `analysisRef`, критериями из `acceptance` и замороженным `criteriaHash`; повторный upsert обновляет тот же REQ, а не создаёт второй. При создании нового REQ ищутся похожие существующие и возвращаются кандидаты: без явного разбора дубля запись отклоняется. После записи ядро регенерирует проекции, поэтому `digest.md` для L1 перестаёт быть пустым, а `index.json` показывает связь REQ↔запись анализа. Ядро опционально: композиция без него работает в прежнем режиме. Не сломать существующую семантику analysis (CAS, fingerprint, валидация) — это главный риск задачи.

Migrated from .dsh/taskboard.json (task task-mwku3ad7-vji8lm, revision 7).
