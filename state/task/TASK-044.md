---
id: TASK-044
kind: task
title: "Probe: BACKEND role tool surface"
status: done
revision: 2
createdAt: 2026-11-17T15:52:39.490Z
updatedAt: 2026-11-17T15:52:39.490Z
acceptance:
  - text: "The report contains the exact bash path and pwd output, and a list of tool names that includes bash and read and excludes papers_*"
    done: false
  - text: "Nothing in the repository was modified"
    done: false
boardId: task-mwaoajoi-gt9x21
nonScope: ["no file writes, no installs, no commits"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 41827c60-5abd-4fba-8fab-6e7db3a9a1ae
ownerRole: BACKEND
role: BACKEND
scope: ["read-only shell commands in /home/iustimov/dsh-kit"]
sessions:
  - sessionId: 41827c60-5abd-4fba-8fab-6e7db3a9a1ae
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Report the exact tool surface of your session. Run `which bash; echo exit=$?` and `pwd`, then list the exact names of every tool you can call (from your tool definitions, not from memory of a typical coding agent). Explicitly state whether `papers_search` is among them.

Migrated from .dsh/taskboard.json (task task-mwaoajoi-gt9x21, revision 6).
