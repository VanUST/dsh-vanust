---
id: TASK-408
kind: task
title: "Design map v2: pages as drawings"
status: done
revision: 5
createdAt: 2026-11-24T09:37:36.018Z
updatedAt: 2026-11-24T12:35:10.194Z
boardId: task-mwui44lf-r7dazs
chore: true
choreReason: "The owner's own workstream on the design map: replace the rigid state-coupled v1 with a page-based diagram builder. It carries no project requirement yet; the Analysis Record for the initiative is written with P1."
inline: true
resultEvidence: ["P1 task-mwui88ms-8qi4bz: importer 11 nodes/12 edges/46 elements, four tools, tidy 55 to 0, suites 139/139, make verify 0 FAIL", "P2 tasks task-mwuilecz-gd1wly and task-mwuiqz5q-edfec3: the editor lives in Project state -> Map; first drag proven in a browser on 0.1.36 from x90,y248 to x190,y288", "FR7 tasks task-mwukmy3k-7ek3d0 and task-mwuky9dv-mtcxoh: the custom SVG writer was deleted; map_render is headless Excalidraw framed to the page bounds (640x2288, bounds 239x1096, 0 elements outside)", "P3 task-mwumsjzk-6thxg8: designmap 1.0.0 registers four tools, v1 deleted, analysis decoupled, make test 67/67 and make verify 20/20", "P4 task-mwuo2wt1-ti8aci: installed 1.0.0 in a browser, first drag saved and survived a reload, no v1 tool names in the artefact", "analysis record designmap-pages rev 25: 9 requirements resolved, 9 deferred with task evidence, 0 planned"]
resultSummary: "The design map is now pages as drawings: one Excalidraw scene file per page under designmap/pages, edited by the human directly inside Project state -> Map and by the agent through exactly four tools (map_list, map_read, map_edit, map_render), with tidy and with rendering done only by Excalidraw itself (headless Chromium, framed to the page's bounds). v1 is gone: the typed model, overlays, annotations, manifest, the scene contract, the seven old tools and their modules. The map no longer touches project state: the analysis record's designRef, design_drift and analysis_stale gate were removed. Shipped as designmap 1.0.0, project-state-panel 0.1.47 and analysis 0.1.21; make test 67/67, make verify 20/20, and the installed artefact proven in a browser."
steps: ["Design document and owner decisions (docs/DESIGNMAP-V2.md)", "P1: page document, element builders, outline reader, map_edit ops, tidy, SVG render, four tools", "P2: panel over the page file (switcher, save, edit mode, tidy/render buttons)", "P3: retire v1 (files, tools, scene contract, docs) and switch the two couplings", "P4: repack at the new major, second-server proof with a child and a human drag"]
stepsDone: 5
---

Replace the shipped design map (typed semantic model, views, overlays, git manifest, seven tools, a scene contract that refuses to draw) with a page-based diagram builder: one Excalidraw scene per page under designmap/pages/, four agent tools (list/read/edit/render) whose read form is a compact outline and whose edit path builds Excalidraw elements so no agent writes seeds or bindings, a panel that edits the page file directly with a page switcher, hints instead of refusals, no link to project state, and no backward compatibility with the v1 files.
