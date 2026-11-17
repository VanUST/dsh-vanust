---
id: TASK-138
kind: task
title: "M0: designmap-core — schema, ELK layout, merge, lint, scene JSON"
status: done
revision: 1
createdAt: 2026-11-17T15:52:40.832Z
updatedAt: 2026-11-17T15:52:40.832Z
boardId: task-mwj4eqc2-6uznd6
ownerRole: BACKEND
---

Build `plugins/designmap/` core as a pure Node package: zod-strict model/views schema and YAML parse, canonical ID sort, deterministic elkjs layered layout with groups and ports, overlay merge after layout with GC, lint per the spec table, scene JSON per docs/designmap/SCENE-CONTRACT.md, and the diff/apply engine for semantic ops. Prove with golden fixtures in Node: byte-identical scene across two runs, empty model valid, invalid model refused with exact path, 25-node view layout within 1500 ms, and one lint finding per rule.

Migrated from .dsh/taskboard.json (task task-mwj4eqc2-6uznd6, revision 18).
