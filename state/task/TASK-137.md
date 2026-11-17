---
id: TASK-137
kind: task
title: "Pin the core↔renderer scene contract before M0/M1"
status: done
revision: 1
createdAt: 2026-11-17T15:52:40.816Z
updatedAt: 2026-11-17T15:52:40.816Z
boardId: task-mwj4dtya-xarz87
---

Write the integration contract between designmap-core and the client renderer (scene JSON + overlays + renderer events) so M0 (core) and M1 (panel) can be built in parallel against one artifact instead of waiting on each other's code. The document is the orchestrator's integration artifact; M0 implements it and may propose changes through analysis_impact, M1 consumes it.

Migrated from .dsh/taskboard.json (task task-mwj4dtya-xarz87, revision 4).
