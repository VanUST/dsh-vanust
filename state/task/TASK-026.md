---
id: TASK-026
kind: task
title: "Remove the handoff plugin from dsh-kit"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.263Z
updatedAt: 2026-11-17T15:52:39.263Z
boardId: task-mw940v6z-1f01au
---

Delete @cc/dsh-handoff and every promise built on it: the plugin source and tarball, its inventory and profile rows, the orchestrator prompt that orders a handoff at each milestone, the visual-explanations skill's handoff artifact row, README/USERGUIDE/NOTICE/DEPLOYMENT mentions, and the provision-tools label. After the change the kit must still pass `make verify`, mount without the plugin, and contain no live reference to a tool it no longer ships.

Migrated from .dsh/taskboard.json (task task-mw940v6z-1f01au, revision 3).
