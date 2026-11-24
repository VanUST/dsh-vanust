---
id: TASK-296
kind: task
title: "Reconnaissance: what the design-map subsystem is and what is coupled to it"
status: done
revision: 4
createdAt: 2026-11-24T09:31:28.709Z
updatedAt: 2026-11-24T12:34:49.208Z
acceptance:
  - text: "the data model is described from source: every field of a node/edge/group/view, the enums, the overlay file, the manifest, with file:line for each"
    done: false
  - text: "the tool and command surface is listed with what each reads and writes, and which validation each enforces"
    done: false
  - text: "the render pipeline is named end to end: model → layout → scene → panel canvas, with the module that owns sizes, positions and routes"
    done: false
  - text: "every consumer outside plugins/designmap is listed with its call site: who imports SceneCanvas or reads designmap/model.yaml, manifest.json, views.yaml, overlays.json"
    done: false
  - text: "the state coupling is stated precisely: what breaks or degrades if the manifest, stale flags, scan proposals or the fixed node-type enum disappear"
    done: false
  - text: "each claim carries file:line; what could not be determined is named rather than guessed"
    done: false
boardId: task-mwuhw88h-4nm4sa
chore: true
choreReason: "Read-only reconnaissance for the design-map redesign: the current subsystem and its couplings must be known before a replacement is designed."
nonScope: ["No design proposal, no recommendation, no edit", "No opinion on readability quality — that is the next document's job", "No changes to the model files, even to test a hypothesis"]
owner:
  kind: agent
  label: CONTEXT
  sessionId: b03ef9af-b9b0-4211-ad0c-7a266ac3378a
preset: gatherer
resultEvidence: ["the report named the seven tools, the four stores (model.yaml/views.yaml/overlays.json/annotations.json), the state panel's SceneCanvas import and the analysis coupling at store.mjs:1228", "used as the input for docs/DESIGNMAP-V2.md and the P1/P3 briefs"]
resultSummary: "Reconnaissance of the design-map subsystem: what it is, where it is coupled and what a page-based replacement would have to touch. Its report became the input for the v2 design document and the P1/P3 briefs."
role: CONTEXT
sessions:
  - sessionId: b03ef9af-b9b0-4211-ad0c-7a266ac3378a
    label: CONTEXT
    role: CONTEXT
    status: sleeping
---

Map the current design-map subsystem exactly as it is shipped, so a replacement can be designed without guessing. Answer with citations: (1) the data model — every field of a node, edge, group and view, the enums (node types, edge kinds), the human overlay file and the manifest, and where each is validated; (2) the tool and command surface — each of designmap_apply/render/lint/status/scan/export/open, what it reads, what it writes, which refusals it can return, and the command path the panel uses; (3) the render pipeline end to end — model → layout (who computes sizes, positions, routes) → scene.json → panel canvas, naming the module for each step; (4) the couplings outside the plugin: who imports SceneCanvas or any designmap module, who reads model.yaml/views.yaml/overlays.json/manifest.json (project-state panel, presentation, docs, scripts, Makefile); (5) the state coupling precisely — which behaviour depends on manifest.commit/staleness/scan, and what would degrade if that machinery were removed; (6) multi-page support today: whether views are pages, how they select nodes, and what the panel can show. End with what you could not determine.
