---
id: TASK-011
kind: task
title: "Make stale roles, orphaned sessions and stalled delegations visible (P0.5)"
status: done
revision: 1
createdAt: 2026-11-17T15:52:39.080Z
updatedAt: 2026-11-17T15:52:39.080Z
boardId: task-mvv0z951-cxdd1o
---

Stop the taskboard reporting dead specialists as active and losing the reason a delegation never started: mark role rows stale/orphaned on read, count active only from live rows, clear agent rows by lastTaskId on task removal, make delegate_task record a starting note and a guaranteed failure note, and surface review/ready debt in the root policy so the next chat can act on it.

Migrated from .dsh/taskboard.json (task task-mvv0z951-cxdd1o, revision 3).
