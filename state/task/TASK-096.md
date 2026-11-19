---
id: TASK-096
kind: task
title: "Review design-map 0.2.0: shapes, layers, preview/health"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.199Z
updatedAt: 2026-11-17T15:52:40.199Z
acceptance:
  - text: "Each finding names a file and line and a concrete input or scene that breaks, with severity (blocker/major/minor)."
    done: false
  - text: "A claim that an invariant holds is checked against the code, not against the README."
    done: false
  - text: "The review names any place where the tool description promises something the code does not do (e.g. a kind, a layer rule, a refusal)."
    done: false
  - text: "No edits and no server restarts."
    done: false
boardId: task-mwc9c1bx-8tcoob
nonScope: ["Do not edit any file.", "Do not install plugins, restart servers or touch the :3080 profile.", "Do not rewrite the design or propose a new feature; only review what is there."]
owner:
  kind: agent
  label: REVIEWER
  sessionId: 499ae6b5-9e74-4c05-a6bf-e638ad254aed
ownerRole: REVIEWER
preset: reviewer
resultArtifacts: [reports/design-map-v2/EVIDENCE.md]
resultEvidence: ["Review report: 6 findings F1-F6 with file:line and repro scripts /tmp/repro-remove2.mjs, /tmp/repro-edge-label.mjs, /tmp/repro-layer.mjs", "Repros re-run against the fixed bytes: ellipse/diamond bindings cleaned on remove; one label per rebuilt edge; remove(['layer:x']) refused with layer_id; hand-deleted band rebuilt; read no longer reports an undrawn title", "node reports/design-map-v2/cases.mjs -> 76 PASS, 0 FAIL including K1-K6"]
resultSummary: "REVIEWER found six substantive defects, each reproduced against the tree at review time: remove and the dangling validator only knew rectangles (dead binding on a store/decision, health still ok); an upsert duplicated a human-edited flow label and orphaned the human's text; removing a band left nodes with layer_missing while layout/upsert refused; the title was derived twice (read reported an undrawn metadata title); and layers[] order was ignored on upsert. Core paths (kinds, bands, preview, health, CAS refusals, upsert-does-not-move) were checked and found sound. All six are fixed in 0.2.0 and covered by regression cases K1-K6."
role: REVIEWER
scope: [plugins/design-map/index.js, plugins/design-map/layout.js, plugins/design-map/preview.js, plugins/design-map/README.md, plugins/design-map/package.json, README.md, USERGUIDE.md, profile/cordis.patch.yml]
sessions:
  - sessionId: 499ae6b5-9e74-4c05-a6bf-e638ad254aed
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

Review the uncommitted change to the design-map plugin (@cc/dsh-design-map 0.1.21 -> 0.2.0) and report correctness bugs, contract mismatches and regressions. You do not fix anything; you produce findings with file:line, severity and the failure they would cause.

Migrated from .dsh/taskboard.json (task task-mwc9c1bx-8tcoob, revision 7).
