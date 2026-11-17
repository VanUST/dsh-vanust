---
id: TASK-112
kind: task
title: "Chat-scoped subagent reuse"
status: done
revision: 1
createdAt: 2026-11-17T15:52:40.426Z
updatedAt: 2026-11-17T15:52:40.426Z
boardId: task-mwevdsqs-y4o6d6
ownerRole: BACKEND
---

Гарантировать, что новая сессия/чат никогда не вызывает и не переиспользует sleeping subagent, созданного другой сессией/чатом. Каждый чат получает собственные role/subagent contexts; существующий child переиспользуется только если он принадлежит текущему chatId. Одинаковая role с другим preset в новом чате не должна конфликтовать со старой записью другого чата.

Migrated from .dsh/taskboard.json (task task-mwevdsqs-y4o6d6, revision 10).
