---
id: TASK-067
kind: task
title: "Fix project-rules: fail closed on a mangled file, resolve symlinks in the guard"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.776Z
updatedAt: 2026-11-17T15:52:39.776Z
acceptance:
  - text: "The prompt section's first text() call never throws: an invalid-UTF-8 or oversize .dsh/rules.md yields an empty section (and one log line), and the session starts; refresh() keeps the last good text as before"
    done: false
  - text: "The panel's read op surfaces the refusal as an error instead of throwing, so a broken rules file can still be fixed from the panel"
    done: false
  - text: "The write/edit guard resolves symlinks before comparing (a symlink to .dsh/rules.md is refused) and the measured bypass list is reduced or the residual is documented with the exact shapes"
    done: false
  - text: "Proven: invalid UTF-8 / oversize file -> section text empty, no throw, session-level prompt assembly not broken; symlink write refused; existing denials still hold"
    done: false
boardId: task-mwatqfsx-yf74c6
nonScope: ["no change to the human-only ownership rule", "the byte-exact panel read is T13 - not this task"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
ownerRole: BACKEND
role: BACKEND
scope: [plugins/project-rules/index.js, "plugins/project-rules/README.md + package.json + tarball"]
sessions:
  - sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Make project rules fail closed: a mangled or oversize .dsh/rules.md currently throws on the first section render, which can break prompt assembly for every agent in the workspace; and the guard's perimeter should resolve symlinks and document the residual bash shapes.

Migrated from .dsh/taskboard.json (task task-mwatqfsx-yf74c6, revision 8).
