---
id: TASK-146
kind: task
title: "Fix /designmap overlay payload after the host field guard"
status: done
revision: 1
createdAt: 2026-11-17T15:52:40.968Z
updatedAt: 2026-11-17T15:52:40.968Z
boardId: task-mwj6dnbp-djk8gi
ownerRole: BACKEND
---

Restore the green suite after the concurrent out-of-scope edit in src/host.mjs. The host now validates an overlay payload against an allow-list ['action','nodeId','viewId','row','x','y','fill','stroke'] (a good defense-in-depth guard: the panel is untrusted input), but src/command.mjs still forwards the whole parsed operation `{op:'overlay', action, …}` to service.overlay, so every overlay command is refused with model_fields_forbidden and 5 tests fail. Fix the cause where it lives: the transport key `op` must not travel into the domain call — the command should dispatch on it and pass only overlay fields.

Migrated from .dsh/taskboard.json (task task-mwj6dnbp-djk8gi, revision 7).
