---
id: TASK-069
kind: task
title: "Fix orchestrator: refuse-to-start on failed attach, board_full, depth-only root"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.804Z
updatedAt: 2026-11-17T15:52:39.804Z
boardId: task-mwatx3aa-ueck8o
ownerRole: BACKEND
---

Fix the delegation-failure modes the review found in the orchestrator: a refused taskboard attach or link no longer lets a child start (orphan work against an unowned task, and the CAS race hidden), a refused create no longer proceeds, and root detection follows parentSession instead of depth alone.

Migrated from .dsh/taskboard.json (task task-mwatx3aa-ueck8o, revision 7).
