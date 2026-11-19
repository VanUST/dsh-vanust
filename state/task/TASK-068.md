---
id: TASK-068
kind: task
title: "Fix taskboard command path: born-done, cleared blocked reason, optional CAS"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.792Z
updatedAt: 2026-11-17T15:52:39.792Z
acceptance:
  - text: "The `/taskboard` command path refuses to create a task in a terminal status (done/cancelled) or paused: a create with status done returns a named code and no row is written"
    done: false
  - text: "A blocked task cannot lose its reason: an explicit empty reason on an already-blocked task is refused (needs_reason) while a patch without a reason keeps the current one"
    done: false
  - text: "Command-path writes require expectedRevision (a create excepted): a write without it is refused with a named code, so the human panel cannot silently lose a concurrent edit"
    done: false
  - text: "Proven with the command path and the model tools: born-done refused, reason-clear refused, no-CAS refused, legal transitions still work"
    done: false
boardId: task-mwatqfx8-ko5vw4
nonScope: ["no change to the tool-path schema beyond the reason semantics", "document that the command registry is the human/client path (agents use tools)"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
ownerRole: BACKEND
role: BACKEND
scope: [plugins/taskboard/taskboard.mjs, "plugins/taskboard/README.md + package.json + tarball"]
sessions:
  - sessionId: 6440f0b4-97a3-4090-aa7f-d8ca2bb68402
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Close the taskboard holes the adversarial test found on the command path: a task can be created already done or paused (minting acceptance), a blocked task can have its reason cleared with an explicit empty string, and a write without expectedRevision is accepted, which loses concurrent edits.

Migrated from .dsh/taskboard.json (task task-mwatqfx8-ko5vw4, revision 9).
