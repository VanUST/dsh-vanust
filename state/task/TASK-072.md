---
id: TASK-072
kind: task
title: "Auto-converge the kit on every dsh boot"
status: open
revision: 1
createdAt: 2026-11-17T15:52:39.844Z
updatedAt: 2026-11-17T15:52:39.844Z
boardId: task-mwbv7r8a-pok877
---

Make plain `dsh web` (and any dsh command) converge the machine on the kit automatically: install drifted plugin tarballs, apply the kit profile patch (rows, personas, plugins) while preserving the local model config, and skip safely when a server is already running - so panels and fixes land without start.sh or manual steps.

Migrated from .dsh/taskboard.json (task task-mwbv7r8a-pok877, revision 1).
