---
id: TASK-198
kind: task
title: "Probe 7: сигнатуры точек подключения ядра состояния"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.019Z
updatedAt: 2026-11-17T15:52:42.019Z
acceptance:
  - text: "По каждому пункту — точная сигнатура/событие и путь `file:line`, сначала в чекауте харнесса `/home/iustimov/.npm/node/lib/node_modules/@deepseek-ai/dsh/`, затем в ките"
    done: false
  - text: "Отдельно: какие из этих точек уже используются плагинами кита (taskboard, test-cases, orchestrator, analysis) — с примерами строк"
    done: false
  - text: "Явно перечислено, что определить не удалось, вместо догадки"
    done: false
boardId: task-mwkp5af5-f0u72j
nonScope: ["ничего не менять — только чтение и отчёт", "не запускать серверы, не выполнять инструменты харнесса, не писать файлы", "не проектировать решение — только существующие точки подключения"]
owner:
  kind: agent
  label: CONTEXT
  sessionId: dafcdddc-9be0-4a41-b8a6-6a6cf5c68c19
ownerRole: CONTEXT
preset: gatherer
resultEvidence: ["reports/probes/07-seams.md — постоянный артефакт отчёта (написан оркестратором из возврата специалиста; каталог reports/ не отслеживается git по конвенции кита)", "tools/pre-execute: dsh-tools/lib/pipeline.js:386, предварительное решение обходит guards (:402); неотменяемый запрет — tools.guard", "fs/*: docs/subsystems/filesystem.md:624-701; в persistence-catalog.md нет ни одного fs/* — это не журнал", "agent.inject(): dsh-agent-loop/lib/index.js:585-587 (не будит драйвер), в журнал попадает как user/message (:875-879)", "designmap/manifest.json на диске старой формы без rev: установлен 0.1.15, код с rev — 0.1.19 на HEAD"]
resultSummary: "Собраны и процитированы все восемь точек подключения. Главные следствия для дизайна: неотменяемый запрет записи — только `tools.guard` (pre-execute не переписывает аргументы, а его `deny` обходит guards); `fs/*` — Cordis-события, а не журнал, и политика наблюдения в поставке выключена, поэтому долговечность держится на `tool/call`/`tool/result`; `agent.inject()` логируется как `user/message`, но не будит драйвер и теряется при отмене; `ctx.subprocess` не применяет sandbox; `ctx.jobs.start` требует живого owner-контроллера; кит уже регистрирует сервисы через `ctx.provide` (taskboard, analysis, cases). Отдельно: `designmap/manifest.json` на диске старой формы, показывая, что новые `rev`/`modelHash` живут только на HEAD — дрейф карты не заработает до переустановки профиля."
role: CONTEXT
scope: ["чтение чекаута харнесса и плагинов кита", "отчёт с цитатами file:line, возвращённый текстом"]
---

Собрать точные сигнатуры точек подключения, на которых будет стоять будущее ядро состояния (probe 7 дизайна). Ответить по каждому пункту с `file:line`, без догадок: (1) `tools/pre-execute` и `tools/post-execute` — полезная нагрузка, порядок, семантика deny/allow; (2) события `fs/*` — имена и полезная нагрузка; (3) sandbox write roots — где настраиваются и где проверяются; (4) `ctx.jobs` и subprocess для хост-плагина; (5) паттерн cordis `Service`/`inject`/declaration merging; (6) `agent.inject()` — сигнатура и эффект (попадает ли в журнал как session event); (7) сервисы `analysis` и `taskboard` — как называются и какие методы отдают; (8) `designmap/manifest.json` — кто пишет и что теперь в нём. Для каждого пункта назови, где именно в ките он уже используется.

Migrated from .dsh/taskboard.json (task task-mwkp5af5-f0u72j, revision 8).
