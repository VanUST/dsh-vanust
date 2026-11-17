---
id: TASK-068
kind: task
title: "Fix taskboard command path: born-done, cleared blocked reason, optional CAS"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.792Z
updatedAt: 2026-11-17T15:52:39.792Z
boardId: task-mwatqfx8-ko5vw4
ownerRole: BACKEND
---

Close the taskboard holes the adversarial test found on the command path: a task can be created already done or paused (minting acceptance), a blocked task can have its reason cleared with an explicit empty string, and a write without expectedRevision is accepted, which loses concurrent edits.

Migrated from .dsh/taskboard.json (task task-mwatqfx8-ko5vw4, revision 9).
