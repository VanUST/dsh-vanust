---
id: TASK-211
kind: task
title: "V1.6: проекции состояния и машиночитаемый индекс связей (FR7)"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.327Z
updatedAt: 2026-11-17T15:52:42.327Z
acceptance:
  - text: "`regenerateViews()` пишет детерминированные проекции в `state/views/`: `digest.md` (≤~3 КБ), `board.md`, `traceability.md`, `map/REQ-*.mmd`, `snapshot.md` и машиночитаемый `index.json` со связями REQ ↔ TASK ↔ TEST ↔ evidence (стабильные id, без прозы)"
    done: false
  - text: "Повторная регенерация на неизменном состоянии даёт байт-в-байт те же файлы (сортировка по id, без плавающих меток времени; время — только id последнего события журнала, если нужно)"
    done: false
  - text: "`verify()` обнаруживает ручную правку проекции как находку (`view_modified`): проекции хешируются в `views/.hashes.json` и сверяются"
    done: false
  - text: "`index.json` полон: у каждого REQ есть его задачи и тесты, у каждого TEST — reqId и evidenceRefs; это контракт для будущей панели, а не текст"
    done: false
  - text: "Тесты в plugins/project-state/test/: детерминизм, обнаружение правки, полнота индекса, граница размера digest; существующие 8 тестов зелёные; `make verify` exit 0"
    done: false
boardId: task-mwktepe1-jz27u0
nonScope: ["state-feed (L1/L2 доставка) — отдельно", "реестр REQ и модельные тулзы — отдельно", "миграции и гейты — отдельно", "живой :3080; доказательство тестами на временном воркспейсе"]
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
ownerRole: BACKEND
preset: backend
resultEvidence: ["node --test plugins/project-state/test/*.test.mjs → tests 12 / pass 12 / fail 0, exit 0 (моя проверка)", "make verify → exit 0", "demo (записано ребёнком, v16/demo.json): index.json 755 Б, digest 213 Б, board 201, traceability 342, snapshot 144; вторая регенерация даёт те же байты", "verify() ловит ручную правку как view_modified; регенерация восстанавливает байт-в-байт", "тарбол cc-dsh-project-state-0.1.2.tgz"]
resultSummary: "Проекции состояния готовы: regenerateViews() пишет в state/views/ deterministic digest.md (кап 3072 Б), board.md, traceability.md, snapshot.md, map/REQ-*.mmd, машиночитаемый index.json со связями REQ↔TASK↔TEST↔evidence и манифест .hashes.json. Повторная регенерация на неизменном состоянии даёт байт-в-байт те же файлы (сортировка по id, без wall-clock, только lastSeq журнала). verify() ловит ручную правку как view_modified и регенерация её восстанавливает. 12/12 тестов, make verify зелёный, тарбол 0.1.2."
role: BACKEND
scope: ["plugins/project-state/lib/ — генератор проекций и хеш-манифест views", "plugins/project-state/test/ — тесты детерминизма, правки, полноты индекса", "README плагина — контракт проекций"]
---

Реализовать проекции состояния (FR7): `regenerateViews()` генерирует из `state/` детерминированный набор файлов в `state/views/` — `digest.md` (≤~3 КБ, для L1), `board.md`, `traceability.md`, `map/REQ-*.mmd`, `snapshot.md` — плюс машиночитаемый `index.json` со связями REQ ↔ TASK ↔ TEST ↔ evidence. Требования: повторная регенерация на неизменном состоянии даёт те же байты (сортировка по id, без плавающего времени); `verify()` ловит ручную правку проекции через хеши в `views/.hashes.json` и отдаёт `view_modified`; индекс полон и стабилен — это контракт для будущей панели, а не текст для парсинга. Ядро уже умеет читать сущности и связи — проекции только читают его состояние и никогда не пишут его обратно.

Migrated from .dsh/taskboard.json (task task-mwktepe1-jz27u0, revision 7).
