---
id: TASK-156
kind: task
title: "Fix the blank white header button in the dark theme"
status: done
revision: 1
createdAt: 2026-11-17T15:52:41.144Z
updatedAt: 2026-11-17T15:52:41.144Z
boardId: task-mwjc0uld-p8ph1o
---

Fix the header control that renders as a blank white box in the dark theme: the primary button's label is hardcoded white while the host accent can be a light colour, so "Editing overlays" becomes invisible. Derive the on-accent ink from the resolved accent, and make the edit toggle read as an action ("Done editing" while active).

Migrated from .dsh/taskboard.json (task task-mwjc0uld-p8ph1o, revision 3).
