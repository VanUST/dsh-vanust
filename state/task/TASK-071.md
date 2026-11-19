---
id: TASK-071
kind: task
title: "Board cap counts terminal rows, blocks new tasks at 198/200"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.831Z
updatedAt: 2026-11-17T15:52:39.831Z
acceptance:
  - text: "Creating a task still works when the board holds many terminal rows: the cap counts non-terminal tasks (or is raised), so a workspace with 198 rows mostly done/cancelled can still add tasks; a per-chat scope is respected"
    done: false
  - text: "The panel's +New task works on the autolabel workspace (measured 198/200, 18:24) instead of returning board_full; a genuinely full active board still refuses with a named code"
    done: false
  - text: "Proven: a temp board with 190 done + 5 active accepts a create; a board with the active cap reached refuses; the autolabel board copy accepts +New task"
    done: false
  - text: "make verify green, version bumped and packed, README explains what the cap protects"
    done: false
boardId: task-mwauclgk-i1rp7p
nonScope: ["no change to the lifecycle transitions", "no row deletion or rewrite"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
ownerRole: BACKEND
role: BACKEND
scope: ["plugins/taskboard/taskboard.mjs (MAX_TASKS check)", "plugins/taskboard/README.md + package.json + tarball"]
sessions:
  - sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Fix the board cap so terminal history cannot block new work: the autolabel workspace sits at 198/200 tasks (mostly done/cancelled) and the panel now refuses +New task with board_full, although almost nothing is active. Count only non-terminal tasks (or raise the cap) and keep a named refusal for a truly full active board.

Migrated from .dsh/taskboard.json (task task-mwauclgk-i1rp7p, revision 7).
