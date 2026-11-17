---
id: TASK-066
kind: task
title: "Fix design-map: empty write wipes the scene, validation holes"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.764Z
updatedAt: 2026-11-17T15:52:39.764Z
boardId: task-mwatqfo1-ro5zcj
ownerRole: BACKEND
---

Close the design-map data-loss and validation holes found by the adversarial test: an empty `write` currently deletes a 5-element scene despite the module claiming it is refused; duplicate ids, non-object nodes and edges to unknown nodes are accepted or silently dropped; a whole-scene write has no revision check; and the panel path bypasses the caps.

Migrated from .dsh/taskboard.json (task task-mwatqfo1-ro5zcj, revision 8).
