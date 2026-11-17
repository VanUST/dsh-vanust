---
id: TASK-204
kind: task
title: "Разведка: кто регистрирует scoped-инструменты и по какому пресету"
status: done
revision: 1
createdAt: 2026-11-17T15:52:42.163Z
updatedAt: 2026-11-17T15:52:42.163Z
boardId: task-mwkr32nn-t7mo5h
ownerRole: CONTEXT
---

Назвать точно, кто регистрирует scoped-инструменты в сессию и по какому значению решает, и почему все восемь пресетов получают полный набор. V1.2 доказала: урезание блоков пресетов не изменило ни один заголовок; papers и test-cases читают `agent.session.header.agentPreset`, а у analysis/designmap гейта по пресету в коде нет — значит гейт в другом месте. Нужно: (1) по каждому семейству `analysis_*`, `designmap_*`, `diagram`, `presentation`, `papers_*`, `case_*`, `skill_*`, `todo`, `job_*`, `delegate_task`, `bash` — плагин, гейт, читаемое значение, `file:line`, момент регистрации; (2) каким образом хост-плагин легально читает пресет в силе на момент регистрации и что нужно в `inject`; (3) что означает ошибка `cannot get property \"session\" without inject` и какой сервис её снимает. Это вход для правки одного резолвера, а не шести копий.

Migrated from .dsh/taskboard.json (task task-mwkr32nn-t7mo5h, revision 6).
