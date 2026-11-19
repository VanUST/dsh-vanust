---
id: TASK-140
kind: task
title: "M2: designmap renderer — edit mode writing overlays"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.867Z
updatedAt: 2026-11-17T15:52:40.867Z
acceptance:
  - text: "Read-only is the default; edit mode requires an explicit toggle"
    done: false
  - text: "Dragging a node writes exactly one overlay row delta after 500 ms debounce; quote overlays.json before and after"
    done: false
  - text: "Re-running the scene generator keeps the moved position and colour, proving merge by semantic id"
    done: false
  - text: "Reset node and reset view remove only their overlay rows"
    done: false
  - text: "Undo restores the previous visual state within the session"
    done: false
  - text: "An attempt to write a model field from the panel is impossible or refused with a named error"
    done: false
boardId: task-mwj4eql4-49ja0b
nonScope: ["changing model/views from the panel (structure is agent-only)", "M0 core geometry (only consume it)", "M3 tools", "live :3080 restart unless asked"]
owner:
  kind: agent
  label: UX/UI
  sessionId: 430eb748-48b3-413c-be70-59c72d4e31a3
ownerRole: UX/UI
preset: ux
resultArtifacts: [docs/designmap/M2-EVIDENCE.md, docs/designmap/screenshots/, plugins/designmap/harness/serve.mjs, plugins/designmap/harness/workspace/designmap/]
resultEvidence: ["node --test test/*.test.mjs -> tests 93, pass 93, fail 0, exit 0; node --test test/host-command.test.mjs -> 3/3 pass (transport drops op, domain guard refuses model fields)", "Chromium harness http://127.0.0.1:4320/?set=m2 (real loader, real createCommandHandler/createHostService): default data-edit-mode=false, aria-pressed=false, read-only drag leaves file unchanged", "Drag ext.stripe: immediately pending=1 and overlays.json still {db.orders}; after 900 ms one command /designmap {\"op\":\"overlay\",\"action\":\"upsert\",\"nodeId\":\"ext.stripe\",\"x\":726.61,\"y\":102.07} and one overlay.write log line; colour adds only fill/stroke", "Regenerate: scene ext.stripe x=726.61,y=102.07 and computed fill #e0e7ff/stroke #4338ca from the semantic-id overlay row; footer scene hash sha256:19cddd544894...", "Reset node -> only db.orders remains, scene x=700.6,y=96; reset view -> {\"$version\":1}, scene svc.checkout.api x=24; undo replaces both rows and restores x=726.61", "Model field attempt: client {code:model_fields_forbidden,...}; host command returns designmap: invalid_overlay (transport dropped label); overlays hash unchanged", "Isolation through real command: only overlays.json changed a5cf4d64 -> 9a77e771; model.yaml, views.yaml, out/index.json and both scenes hashes unchanged", "axe-core 4.14.0 wcag2a+wcag2aa real Chromium: 0 violations on m0, fixture, m2 read-only and m2 edit; negative control reports button-name critical; keyboard transcript every stop focus-visible; arrow nudge +16,+1 wrote one row", "docs/designmap/M2-EVIDENCE.md; docs/designmap/screenshots/m2-{readonly,edit-mode,selected-node,after-drag,after-colour,regenerated,reset-node,undo,reset-view,final,keyboard-audit}.png"]
resultSummary: "M2 edit mode is implemented and proven in the real client-module loader harness. Read-only is the default; an explicit toggle enables drag + palette recolour that debounce 500 ms into one x/y/fill/stroke overlay row delta via nodeMoved/colorChanged. Per-node and per-view reset remove only their rows; undo restores the exact previous row via the host replace action and re-renders. A regenerated scene keeps the moved position and colour (merge by semantic node id). The panel refuses model fields with model_fields_forbidden and the command path refuses them too; overlay writes change only designmap/overlays.json. Keyboard arrow-nudge gives the drag a keyboard path; axe reports 0 violations in read-only and edit states. Evidence in docs/designmap/M2-EVIDENCE.md with 11 screenshots."
role: UX/UI
scope: ["plugins/designmap/ client edit mode and overlay write path", "overlay.write logging", "docs/designmap/ (M2 evidence)"]
sessions:
  - sessionId: 430eb748-48b3-413c-be70-59c72d4e31a3
    label: UX/UI
    role: UX/UI
    status: sleeping
---

Add M2 edit mode to the renderer: explicit read-only/edit toggle, node drag and recolour producing only overlay deltas via nodeMoved/colorChanged (500 ms debounce), per-node and per-view reset, undo, and a write path through the host that updates designmap/overlays.json without touching model.yaml or out/. Prove in a real browser that a regenerated scene keeps the human's positions and colours.

Migrated from .dsh/taskboard.json (task task-mwj4eql4-49ja0b, revision 10).
