---
id: TASK-010
kind: task
title: "Role reuse + idempotent delegation (P0+P1) in orchestrator/taskboard"
status: done
revision: 1
createdAt: 2026-11-17T15:52:39.069Z
updatedAt: 2026-11-17T15:52:39.069Z
boardId: task-mvuwm7kn-asnwgv
---

Stop the orchestrator from inventing duplicate specialist roles across chats and from creating a second task for work that already has one: show existing roles to the root agent, refuse a near-duplicate new role unless forced, keep role session history instead of silently overwriting it, carry the role's prior results into a re-created specialist's brief, and let delegate_task attach to an existing task instead of always creating one.

Migrated from .dsh/taskboard.json (task task-mvuwm7kn-asnwgv, revision 3).
