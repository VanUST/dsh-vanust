---
id: TASK-137
kind: task
title: "Pin the core↔renderer scene contract before M0/M1"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.816Z
updatedAt: 2026-11-17T15:52:40.816Z
acceptance:
  - text: "docs/designmap/SCENE-CONTRACT.md pins scene JSON v1 fields, coordinate origin, determinism rules, overlay file shape and the renderer event list"
    done: false
  - text: "M0 brief and M1 brief can both be written from the document without a design question left open"
    done: false
  - text: "Every field is justified by a spec section or an invariant in docs/analysis/designmap-redesign.json"
    done: false
boardId: task-mwj4dtya-xarz87
inline: true
nonScope: ["implementation code of core or renderer", "changing the Analysis Record requirements", "the live :3080 profile"]
resultEvidence: ["docs/designmap/SCENE-CONTRACT.md written (scene JSON v1 fields, coordinate origin, determinism rules, overlay shape with $version, renderer events, tool envelope, empty/absent states, change procedure)", "Contract pinned from docs/analysis/designmap-redesign.json CT-SCENE/CT-OVERLAY/INV-* and the owner spec §3-§7"]
resultSummary: "Pinned scene JSON v1 as the only core↔renderer contract: timestamp-free deterministic bytes, top-left y-down coordinates rounded to 2 decimals, label wrapping owned by core, flat overlays keyed by semantic id with $version, and the closed event list (nodeMoved/colorChanged/nodeReset/viewReset/drillDown/openSource/viewChanged). M0 implements the producer side; M1 consumes it."
scope: ["docs/designmap/SCENE-CONTRACT.md (new file)"]
---

Write the integration contract between designmap-core and the client renderer (scene JSON + overlays + renderer events) so M0 (core) and M1 (panel) can be built in parallel against one artifact instead of waiting on each other's code. The document is the orchestrator's integration artifact; M0 implements it and may propose changes through analysis_impact, M1 consumes it.

Migrated from .dsh/taskboard.json (task task-mwj4dtya-xarz87, revision 4).
