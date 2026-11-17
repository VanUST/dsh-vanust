---
id: TASK-140
kind: task
title: "M2: designmap renderer — edit mode writing overlays"
status: done
revision: 1
createdAt: 2026-11-17T15:52:40.867Z
updatedAt: 2026-11-17T15:52:40.867Z
boardId: task-mwj4eql4-49ja0b
ownerRole: UX/UI
---

Add M2 edit mode to the renderer: explicit read-only/edit toggle, node drag and recolour producing only overlay deltas via nodeMoved/colorChanged (500 ms debounce), per-node and per-view reset, undo, and a write path through the host that updates designmap/overlays.json without touching model.yaml or out/. Prove in a real browser that a regenerated scene keeps the human's positions and colours.

Migrated from .dsh/taskboard.json (task task-mwj4eql4-49ja0b, revision 10).
