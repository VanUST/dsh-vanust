---
id: TASK-088
kind: task
title: "Fix sleeping status during active work"
status: review
revision: 1
createdAt: 2026-11-17T15:52:40.092Z
updatedAt: 2026-11-17T15:52:40.092Z
boardId: task-mwc2r3rq-xbdhct
ownerRole: BACKEND
---

Correct the taskboard agent-state model so a child waiting on a running command/background job and an unfinished task is not shown as sleeping. Diagnose whether the defect is in child session status, task status, or the UI's merge of both, then fix the authoritative source once.

Migrated from .dsh/taskboard.json (task task-mwc2r3rq-xbdhct, revision 6).
