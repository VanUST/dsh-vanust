---
id: TASK-158
kind: task
title: "Add context-gatherer preset + orchestrator reconnaissance policy"
status: done
revision: 1
createdAt: 2026-11-17T15:52:41.178Z
updatedAt: 2026-11-17T15:52:41.178Z
boardId: task-mwjd9jlc-m6h3z1
---

Make understanding the current architecture a first-class orchestrator step: add a read-only `gatherer` agent preset (Context gatherer) that inspects the current architecture/algorithm and returns one cited report, register it as a role (CONTEXT) in the orchestrator's delegation surface, and extend ROOT_POLICY so the orchestrator delegates reconnaissance to that child instead of spending its own context on read/grep calls.

Migrated from .dsh/taskboard.json (task task-mwjd9jlc-m6h3z1, revision 4).
