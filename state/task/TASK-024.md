---
id: TASK-024
kind: task
title: "Reclaim ~102 GB of Docker disk on the PC"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.240Z
updatedAt: 2026-11-17T15:52:39.240Z
boardId: task-mw92a7n7-88owmg
---

Free the space Docker holds invisibly under /var/lib/docker (~200 GB measured) by pruning dangling images (60, 62 GB), the build cache (1132 records, 26 GB) and unused volumes (8 of 11, 14 GB). Tagged/working images and volumes attached to containers must survive. Record before/after numbers as proof.

Migrated from .dsh/taskboard.json (task task-mw92a7n7-88owmg, revision 5).
