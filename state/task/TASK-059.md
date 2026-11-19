---
id: TASK-059
kind: task
title: "Strict task lifecycle and a readable board"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.674Z
updatedAt: 2026-11-17T15:52:39.674Z
acceptance:
  - text: "The status set has no pair that means the same thing: proposed and ready are merged into open (legacy rows display-map on read, the file is not rewritten); the remaining states are open, active, paused, review, done, blocked, cancelled"
    done: false
  - text: "Transition invariants are enforced by the HOST, not the UI: open->active needs a role+owner or an explicit inline owner; active->review needs a result summary and at least one evidence item; review->done only through acceptance (task_close or the human); blocked needs a reason; cancelled is terminal and not reachable from done; every refusal has a named code and is quoted in the proof"
    done: false
  - text: "No task is role-less: each task carries either a role (with its preset) or inline:true for work the orchestrator does itself; the model-facing tools and the UI both refuse/label the missing case"
    done: false
  - text: "List view shows a Role column with the role chip and the preset id, Owner shows the child or inline, and the Subagents column is folded into Role; board view has 5 columns (Open, Active, Review, Blocked, Done) instead of 8"
    done: false
  - text: "The roster above the board counts only roles linked to THIS chat's tasks; All chats shows the workspace-wide roster with its own label"
    done: false
  - text: "Proven on a second server in a real browser with two chats: one board with legacy proposed/ready rows displays them as open; an illegal transition is refused with its code; the role chip is visible on a delegated and on an inline task"
    done: false
  - text: "make verify green, version bumped and packed, README/USERGUIDE updated"
    done: false
boardId: task-mwaqqf57-hsvs4q
nonScope: ["do not rewrite existing board rows or bump the board format version: old statuses are display-mapped on read", "no change to the per-chat scoping or the role presets themselves (already shipped)", "no MCP, sandbox or project-rules changes - separate tasks", "no commits; the orchestrator integrates"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
ownerRole: BACKEND
role: BACKEND
scope: ["plugins/taskboard/taskboard.mjs (status model, transitions, invariants, display mapping)", "plugins/taskboard/client.js (columns, chips, board columns, roster scoping, filters)", "plugins/taskboard/README.md + USERGUIDE.md", "packed tarball"]
sessions:
  - sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Make the taskboard state machine strict and the board readable: collapse the ambiguous status pairs, enforce owner/role/evidence invariants in the HOST with named refusal codes, and redesign the panel so a task's role, owner and lifecycle are obvious at a glance - with legacy rows display-mapped instead of rewritten.

Migrated from .dsh/taskboard.json (task task-mwaqqf57-hsvs4q, revision 10).
