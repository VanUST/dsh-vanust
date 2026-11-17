---
id: TASK-031
kind: task
title: "Orchestrator prompt: freeze volatile roster/board-debt per turn"
status: done
revision: 1
createdAt: 2026-11-17T15:52:39.327Z
updatedAt: 2026-11-17T15:52:39.327Z
boardId: task-mw99oj14-zwn120
---

Root orchestrator system prompt is rebuilt on every request: renderRoleCatalog + renderBoardDebt read the live taskboard, so every task_update/task_close/delegate_task changes the system prompt and invalidates the provider prefix cache. On kimi-coding this re-billed the whole 200-310K context (19/20 calls with cacheRead=1792), burning a 5-hour quota in 8 minutes. Render the volatile block once per turn so it changes at most once per turn, keeping the cached prefix stable across steps.

Migrated from .dsh/taskboard.json (task task-mw99oj14-zwn120, revision 3).
