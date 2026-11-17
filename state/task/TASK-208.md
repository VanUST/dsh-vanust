---
id: TASK-208
kind: task
title: "V1.4: ядро состояния — ccProjectState, схема, журнал, CAS, verify"
status: done
revision: 1
createdAt: 2026-11-17T15:52:42.248Z
updatedAt: 2026-11-17T15:52:42.248Z
boardId: task-mwksiniq-ss2azr
ownerRole: BACKEND
---

Построить ядро экосистемы состояния — тонкий хост-плагин `@cc/dsh-project-state` с сервисом `ccProjectState`, единственным писателем каталога `state/` в воркспейсе проекта. Ядро владеет: схемой сущностей (REQ/DECISION/TASK/TEST по §3), типизированными последовательными ID под локом, связями с хешем содержимого цели, CAS для переходов TASK, append-only журналом с реплеем, `verify()` и выдачей ID. Оно НЕ владеет: модельными тулзами, проекциями и миграциями — это следующие задачи. Правила: файл на сущность, markdown + YAML frontmatter + тело, git-friendly; человек правит через git, и его невалидная правка — блокирующая находка verify(), а не молчаливая перезапись; прямая запись агента в state/ режется позже политикой, ядро лишь не оставляет другого пути. Докажи тестами на временном воркспейсе: ID под конкуренцией, хеши связей, CAS, реплей журнала, находки verify().

Migrated from .dsh/taskboard.json (task task-mwksiniq-ss2azr, revision 7).
