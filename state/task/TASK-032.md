---
id: TASK-032
kind: task
title: "Audit dsh-kit for remaining token over-spend"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.339Z
updatedAt: 2026-11-17T15:52:39.339Z
boardId: task-mw9b5k91-mxgqq1
---

Find every place in the current kit where a request carries more tokens than the work needs, rank them by measured cost, and name the cheapest fix for each. Sources: the kit's own session corpus (billed vs cached tokens, per-tool result bytes, call-argument bytes), the system prompt as actually logged per session, profile settings that multiply calls, and the plugins that render prompts. Deliver a ranked report with numbers and file/line references; implement only what the human approves afterwards.

Migrated from .dsh/taskboard.json (task task-mw9b5k91-mxgqq1, revision 2).
