---
id: TASK-083
kind: task
title: "Enforce roles on every child agent"
status: review
revision: 1
createdAt: 2026-11-17T15:52:40.014Z
updatedAt: 2026-11-17T15:52:40.014Z
boardId: task-mwc0hfs8-b8mhxs
ownerRole: BACKEND
---

Close the audited role-enforcement gap: direct subagent/subagent_fork calls from the orchestrator can create children with no agent preset, no role persona and the root tool set, even when the taskboard labels them BACKEND. Enforce that every delegated child that performs task work starts through delegate_task with a real preset, and prove actual agent-preset/selected plus role-specific tools.

Migrated from .dsh/taskboard.json (task task-mwc0hfs8-b8mhxs, revision 7).
