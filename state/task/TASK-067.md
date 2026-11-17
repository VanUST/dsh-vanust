---
id: TASK-067
kind: task
title: "Fix project-rules: fail closed on a mangled file, resolve symlinks in the guard"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.776Z
updatedAt: 2026-11-17T15:52:39.776Z
boardId: task-mwatqfsx-yf74c6
ownerRole: BACKEND
---

Make project rules fail closed: a mangled or oversize .dsh/rules.md currently throws on the first section render, which can break prompt assembly for every agent in the workspace; and the guard's perimeter should resolve symlinks and document the residual bash shapes.

Migrated from .dsh/taskboard.json (task task-mwatqfsx-yf74c6, revision 8).
