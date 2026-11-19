---
id: TASK-223
kind: task
title: "V1.12: миграция источников в реестр — REQ, TASK, TEST (FR13)"
status: done
revision: 3
createdAt: 2026-11-17T15:52:42.606Z
updatedAt: 2026-11-17T15:52:42.606Z
acceptance:
  - text: "Скрипт/команда миграции переносит `docs/analysis/*.json` → REQ в `state/req/`: одно требование = один REQ с `analysisRef`, критериями и `criteriaHash`, статус по правилу плана; ни одна запись и ни одно требование не теряются (сверка количеств)"
    done: false
  - text: "`.dsh/taskboard.json` → TASK в `state/task/`: `boardId` из id задачи, статус, revision, createdAt; задачи без reqId помечаются chore только если это следует из данных, иначе остаются без reqId с явной пометкой"
    done: false
  - text: "`docs/cases/*.json` → TEST в `state/test/`: `caseId`, reqId, authorRole, testPath, runCommand, frozenHash, evidenceRefs из сохранённых прогонов"
    done: false
  - text: "Идемпотентность: повторный запуск не создаёт дублей и не меняет байты (проверить хешами state/ до и после второго прогона)"
    done: false
  - text: "После миграции `regenerateViews()` даёт непустые digest/board/traceability, а `verify()` не находит битых ссылок"
    done: false
  - text: "Доказательство: прогон на копии репозитория, счётчики до/после, повторный прогон с совпадением хешей, `make verify` exit 0; `state/` можно закоммитить"
    done: false
boardId: task-mwkvdnfd-fc7laq
nonScope: ["удаление docs/analysis, .dsh/taskboard.json или docs/cases — источники остаются, миграция только читает", "переписывание записей анализа и таскборда", "панель состояния — ею занимается отдельный исполнитель в /tmp", "живой :3080"]
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
ownerRole: BACKEND
preset: backend
resultEvidence: ["scripts/state-migrate.mjs → REQ 102 / TASK 223 / TEST 49; источники читаются, не переписываются", "повторный прогон: 0 созданных, 374 пропущенных, sha256 483 файлов state/ совпали (моя проверка: exit 0, digest тот же)", "digest: REQ 102 · TASK 223 · TEST 49 · event 374; index.json 102/223/49", "make verify exit 0"]
resultSummary: "Реестр засеян из источников: 102 REQ из записей анализа, 223 TASK из доски воркспейса, 49 TEST из библиотеки кейсов. Повторный прогон идемпотентен — 0 созданных, 374 пропущенных, sha256 всех 483 файлов state/ совпали. Проекции перестали быть пустыми: digest REQ 102 · TASK 223 · TEST 49 · event 374, verify() без битых ссылок. Источники только читаются."
role: BACKEND
scope: ["новый скрипт миграции (scripts/state-migrate.mjs или в составе project-state)", "state/ в репозитории кита: req/task/test + views", "документы: как запускать миграцию и что она не переписывает источники", "make verify и proof-скрипты остаются зелёными"]
---

Заполнить реестр реальными данными (FR13): миграция переносит существующие записи анализа в REQ, задачи воркспейса в TASK и библиотеку кейсов в TEST — идемпотентно, без потери истории и с валидными проекциями после прогона. Это шаг, после которого панель состояния и первая сессия получают настоящий реестр, а не пустоту: `state/views/digest.md` перестаёт быть пустым, `board.md` показывает реальные задачи, `traceability.md` — связи REQ↔TASK↔TEST. Историю источников не переписывать: миграция только читает их, повторный прогон не создаёт дублей и не меняет байты. Докажи на копии репозитория счётом до/после и совпадением хешей при втором прогоне.

Migrated from .dsh/taskboard.json (task task-mwkvdnfd-fc7laq, revision 3).
