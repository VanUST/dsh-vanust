---
id: TASK-157
kind: task
title: "Human visual edits: native Excalidraw tools + annotation layer"
status: done
revision: 1
createdAt: 2026-11-17T15:52:41.161Z
updatedAt: 2026-11-17T15:52:41.161Z
boardId: task-mwjc553r-92wndj
---

Give the human a minimal visual editing layer on the Design map (analysis record designmap-human-edits, goal goal-13893dad): in edit mode expose Excalidraw's native tools (move, colour, shapes/highlight, text, pen) and persist everything the human creates as a separate annotation layer designmap/annotations.json, written through /designmap op:'annotate' with host validation (element type whitelist, finite geometry, <=200 elements, no designmap customData), read back on load and drawn above the scene in both modes, never read by the model or the scene. Prove it in a real browser and ship it packed.

Migrated from .dsh/taskboard.json (task task-mwjc553r-92wndj, revision 3).
