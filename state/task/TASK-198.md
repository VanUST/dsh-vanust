---
id: TASK-198
kind: task
title: "Probe 7: сигнатуры точек подключения ядра состояния"
status: done
revision: 1
createdAt: 2026-11-17T15:52:42.019Z
updatedAt: 2026-11-17T15:52:42.019Z
boardId: task-mwkp5af5-f0u72j
ownerRole: CONTEXT
---

Собрать точные сигнатуры точек подключения, на которых будет стоять будущее ядро состояния (probe 7 дизайна). Ответить по каждому пункту с `file:line`, без догадок: (1) `tools/pre-execute` и `tools/post-execute` — полезная нагрузка, порядок, семантика deny/allow; (2) события `fs/*` — имена и полезная нагрузка; (3) sandbox write roots — где настраиваются и где проверяются; (4) `ctx.jobs` и subprocess для хост-плагина; (5) паттерн cordis `Service`/`inject`/declaration merging; (6) `agent.inject()` — сигнатура и эффект (попадает ли в журнал как session event); (7) сервисы `analysis` и `taskboard` — как называются и какие методы отдают; (8) `designmap/manifest.json` — кто пишет и что теперь в нём. Для каждого пункта назови, где именно в ките он уже используется.

Migrated from .dsh/taskboard.json (task task-mwkp5af5-f0u72j, revision 8).
