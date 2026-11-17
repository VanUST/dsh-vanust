---
id: TASK-143
kind: task
title: "Contract: pin designmap/out/index.json"
status: done
revision: 1
createdAt: 2026-11-17T15:52:40.917Z
updatedAt: 2026-11-17T15:52:40.917Z
boardId: task-mwj5gjiq-y7vyq7
---

Pin the view-index artifact (designmap/out/index.json) in the scene contract, because the panel reads files through a read-only workspace API and cannot enumerate a directory. The index is how M1 discovers views and how drill-down maps a clicked group to the child view.

Migrated from .dsh/taskboard.json (task task-mwj5gjiq-y7vyq7, revision 4).
