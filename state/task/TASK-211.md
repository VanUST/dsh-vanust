---
id: TASK-211
kind: task
title: "V1.6: проекции состояния и машиночитаемый индекс связей (FR7)"
status: done
revision: 1
createdAt: 2026-11-17T15:52:42.327Z
updatedAt: 2026-11-17T15:52:42.327Z
boardId: task-mwktepe1-jz27u0
ownerRole: BACKEND
---

Реализовать проекции состояния (FR7): `regenerateViews()` генерирует из `state/` детерминированный набор файлов в `state/views/` — `digest.md` (≤~3 КБ, для L1), `board.md`, `traceability.md`, `map/REQ-*.mmd`, `snapshot.md` — плюс машиночитаемый `index.json` со связями REQ ↔ TASK ↔ TEST ↔ evidence. Требования: повторная регенерация на неизменном состоянии даёт те же байты (сортировка по id, без плавающего времени); `verify()` ловит ручную правку проекции через хеши в `views/.hashes.json` и отдаёт `view_modified`; индекс полон и стабилен — это контракт для будущей панели, а не текст для парсинга. Ядро уже умеет читать сущности и связи — проекции только читают его состояние и никогда не пишут его обратно.

Migrated from .dsh/taskboard.json (task task-mwktepe1-jz27u0, revision 7).
