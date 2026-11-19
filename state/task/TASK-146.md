---
id: TASK-146
kind: task
title: "Fix /designmap overlay payload after the host field guard"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.968Z
updatedAt: 2026-11-17T15:52:40.968Z
acceptance:
  - text: "src/command.mjs builds an explicit payload for the overlay op (action, nodeId, viewId, row, x, y, fill, stroke as applicable) and never forwards `op`; `op` is used only for dispatch and logging"
    done: false
  - text: "The full suite is green again: quote tests/pass/fail with 92/92 (or the current total) and exit 0, including test/host-overlay.test.mjs and test/host-command.test.mjs"
    done: false
  - text: "The guard is still capable of failing: prove a payload carrying a model field (e.g. type or label) is refused with model_fields_forbidden, either by an existing host test or a new focused assertion — quote it"
    done: false
  - text: "A real command round trip still works: /designmap op:'overlay' action:'upsert' writes x/y and the row is present in overlays.json (quote the value)"
    done: false
  - text: "No file outside the scope list changed; client/** untouched"
    done: false
boardId: task-mwj6dnbp-djk8gi
nonScope: ["weakening the host guard in src/host.mjs — it stays as it is; the panel is untrusted input", "client/**, client.js, build-client.mjs (the UX/UI child is editing them right now)", "overlay semantics, coordinates rules, lint, scene geometry", "installing into or restarting :3080, git commit/push"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 34e215fd-175e-46e0-9911-3e458feff431
ownerRole: BACKEND
preset: backend
resultEvidence: ["npm test 93/93 pass, exit 0 (orchestrator re-ran it): host-overlay 6/6 and host-command 3/3 included", "orchestrator round trip: command op:'overlay' with x:12,y:34 and a smuggled type:'service' returns success, keys ['x','y'], overlays.json becomes {\"$version\":1,\"db.orders\":{\"x\":12,\"y\":34}} — no op, no type", "guard still fail-capable: direct service.overlay with type/label is refused with model_fields_forbidden (child's regression case in host-command.test.mjs)", "src/host.mjs untouched; client/** untouched"]
resultSummary: "Fixed the overlay command at the transport boundary: src/command.mjs now builds an explicit overlay payload and keeps the transport key `op` out of the domain call, so the host's untrusted-input guard stays strict while the panel path works. Suite back to 93/93."
role: BACKEND
scope: ["plugins/designmap/src/command.mjs (explicit overlay payload)", "plugins/designmap/test/host-command.test.mjs or a new focused case if the guard needs a named regression assertion", "docs/designmap/M3-EVIDENCE.md (one line: the transport/domain split)"]
---

Restore the green suite after the concurrent out-of-scope edit in src/host.mjs. The host now validates an overlay payload against an allow-list ['action','nodeId','viewId','row','x','y','fill','stroke'] (a good defense-in-depth guard: the panel is untrusted input), but src/command.mjs still forwards the whole parsed operation `{op:'overlay', action, …}` to service.overlay, so every overlay command is refused with model_fields_forbidden and 5 tests fail. Fix the cause where it lives: the transport key `op` must not travel into the domain call — the command should dispatch on it and pass only overlay fields.

Migrated from .dsh/taskboard.json (task task-mwj6dnbp-djk8gi, revision 7).
