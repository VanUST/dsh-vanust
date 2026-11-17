---
id: TASK-151
kind: task
title: "Core: one owner for label geometry, ELK label reservation, collision refusal"
status: done
revision: 1
createdAt: 2026-11-17T15:52:41.057Z
updatedAt: 2026-11-17T15:52:41.057Z
boardId: task-mwjaypic-em827j
---

Make designmap-core the single owner of edge-label geometry: compute edge label size once, hand it to ELK as an edge label so the layout reserves room, emit labelBox in the scene, validate label boxes (node/label) and edge segments (through node) with error severity, retry layout with larger spacing and refuse label_collision instead of emitting a colliding scene.

Migrated from .dsh/taskboard.json (task task-mwjaypic-em827j, revision 4).
