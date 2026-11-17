---
id: TASK-050
kind: task
title: "Fix audit P0/P1: notify display, proof-guard edits, skill-evolve registry, cleanup"
status: open
revision: 1
createdAt: 2026-11-17T15:52:39.561Z
updatedAt: 2026-11-17T15:52:39.561Z
boardId: task-mwap3cpq-yjgdhv
---

Fix the two P0 and the small P1/P2 defects the 2026-11-10 audit found, except the MCP placement decision and the other chat's uncommitted work: the notify DISPLAY loss, proof-guard denying edits to legacy tests, skill-evolve's blind spot for packaged skills, the stale plugin count, work-modes dead weight, and godot-mcp's overclaim. Prove each with a probe, bump/repack the changed plugins, keep make verify green.

Migrated from .dsh/taskboard.json (task task-mwap3cpq-yjgdhv, revision 1).
