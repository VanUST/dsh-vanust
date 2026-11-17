---
id: TASK-092
kind: task
title: "Fix role/catalog/state contract defects"
status: review
revision: 1
createdAt: 2026-11-17T15:52:40.146Z
updatedAt: 2026-11-17T15:52:40.146Z
boardId: task-mwc5e85w-e52p1d
ownerRole: BACKEND
---

Fix the role/taskboard defects found in autolabel_pipeline: arbitrary role labels silently borrowing presets, duplicate role labels with different presets, ambiguous AUDIT mapping, legacy preset-less roles still offered for reuse, stale active tasks after child errors, and host-wide tool leakage that flattens role tool sets. Add migration/reconciliation and prove on a disposable workspace plus the real autolabel board without losing task history.

Migrated from .dsh/taskboard.json (task task-mwc5e85w-e52p1d, revision 9).
