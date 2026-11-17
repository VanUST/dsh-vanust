---
id: TASK-100
kind: task
title: "Taskboard: batch close with result and a real subagent stop"
status: review
revision: 1
createdAt: 2026-11-17T15:52:40.254Z
updatedAt: 2026-11-17T15:52:40.254Z
boardId: task-mwdk0s2c-2j0lhd
---

Make task acceptance one call for one task and one call for a batch, and make the orchestrator able to stop a linked specialist on task cancel/pause/close and on an explicit forced stop. Preserve the review gate and the ledger's honesty: a close with a result fills only missing result fields, never rewrites a recorded summary; batch close reports per-task refusals instead of claiming a whole batch.

Migrated from .dsh/taskboard.json (task task-mwdk0s2c-2j0lhd, revision 3).
