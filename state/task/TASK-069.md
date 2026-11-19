---
id: TASK-069
kind: task
title: "Fix orchestrator: refuse-to-start on failed attach, board_full, depth-only root"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.804Z
updatedAt: 2026-11-17T15:52:39.804Z
acceptance:
  - text: "delegate_task stops before starting a child when the taskboard refuses the attach or link (ok:false from update OR linkChild): the task ends blocked with the named code and no child session is created; the chatless-row case (owner null passing the foreign check but the write refused with other_chat) is covered"
    done: false
  - text: "A refused create (e.g. board_full) does not proceed to a brief or a child: the tool returns the code instead of task.id undefined"
    done: false
  - text: "Root detection uses the same parentSession walk as the taskboard (a subagent child reporting depth 0 with origin subagent/parentSession does not get the root policy or delegate_task)"
    done: false
  - text: "Proven with probes: chatless row -> refused + blocked, no child; board_full -> refused; a depth-0 subagent child is treated as a child"
    done: false
boardId: task-mwatx3aa-ueck8o
nonScope: ["no taskboard file changes (the taskboard fix owns the store)", "no preset changes beyond the root-policy decision"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
ownerRole: BACKEND
role: BACKEND
scope: [plugins/orchestrator/orchestrator.mjs, "packed tarball"]
sessions:
  - sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Fix the delegation-failure modes the review found in the orchestrator: a refused taskboard attach or link no longer lets a child start (orphan work against an unowned task, and the CAS race hidden), a refused create no longer proceeds, and root detection follows parentSession instead of depth alone.

Migrated from .dsh/taskboard.json (task task-mwatx3aa-ueck8o, revision 7).
