---
id: TASK-157
kind: task
title: "Human visual edits: native Excalidraw tools + annotation layer"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.161Z
updatedAt: 2026-11-17T15:52:41.161Z
boardId: task-mwjc553r-92wndj
inline: true
nonScope: ["editing the semantic model from the canvas (node bodies unlock only)", "the Excalidraw frame bundle internals (generated, no source)", "installing into the live :3080 profile"]
resultEvidence: ["browser 1440x900 (harness, repo map): Excalidraw toolbar + properties panel in edit mode; text note, outline highlight, node colour #b2f2bb and node drag all wrote through /designmap and survived a page reload", "docs/designmap/screenshots/dm-edit-native-toolbar.png, dm-edit-recolour.png, dm-edit-annotations.png, dm-note-persisted.png, dm-edits-after-reload.png", "/tmp/dm-annot-ws/annotations.json -> {schemaVersion:1, elements:[text, rectangle]}; overlays.json -> plug.skills fill #b2f2bb, plug.analysis x/y", "test/host-annotate.test.mjs 4/4; 118/118 tests; acceptance ok:true", "packed cc-dsh-designmap-0.1.15.tgz sha256 6325d2f43afe657ef8e908d3b30235f265e266b8b56c330415152304a2812764; commit 2e4360d"]
resultSummary: "Human visual editing works end to end. Edit mode shows Excalidraw's native tools and properties panel; moves and colours persist as overlays (any hex accepted, out-of-palette is info); everything else the human draws (notes, highlights, free drawings) is stored as a separate annotation layer designmap/annotations.json via /designmap op:'annotate', validated on the host (type whitelist, finite geometry, <=200, designmap customData refused), drawn above the scene, never read by render/model. Proven in a real browser on the repo map: note + highlight + recolour + drag survived a reload. Shipped 0.1.15 (commit 2e4360d)."
scope: [plugins/designmap/client/frame.js, plugins/designmap/client/canvas.jsx, plugins/designmap/client/excalidraw.js, plugins/designmap/client/view.jsx, plugins/designmap/client/host.js, plugins/designmap/src/workspace.mjs, plugins/designmap/src/host.mjs, plugins/designmap/src/command.mjs, "plugins/designmap/test/**", docs/designmap/SCENE-CONTRACT.md, plugins/designmap/README.md]
---

Give the human a minimal visual editing layer on the Design map (analysis record designmap-human-edits, goal goal-13893dad): in edit mode expose Excalidraw's native tools (move, colour, shapes/highlight, text, pen) and persist everything the human creates as a separate annotation layer designmap/annotations.json, written through /designmap op:'annotate' with host validation (element type whitelist, finite geometry, <=200 elements, no designmap customData), read back on load and drawn above the scene in both modes, never read by the model or the scene. Prove it in a real browser and ship it packed.

Migrated from .dsh/taskboard.json (task task-mwjc553r-92wndj, revision 3).
