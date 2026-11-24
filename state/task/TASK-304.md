---
id: TASK-304
kind: task
title: "P2 drag: fix the vendored frame's injection path, named from the glue's own code"
status: done
revision: 5
createdAt: 2026-11-24T11:26:21.970Z
updatedAt: 2026-11-24T12:34:51.105Z
acceptance:
  - text: "the glue's load handler is quoted from client.frame.js (the region around the 'design-map-frame'/'design-map-panel' strings) and the injection call it makes is named"
    done: false
  - text: "the cause of 'selected but not dragged, no change emitted for injected elements' is named with that code as evidence"
    done: false
  - text: "after the fix, a pointer drag of a box that came from the page file moves it, the frame emits change, the panel saves, and the coordinates survive a reload"
    done: false
  - text: "doing the same drag on a freshly drawn box still works"
    done: false
  - text: "the fix lives in code we own or in an explicit in-memory patch of the vendored bundle with a marker check, like the export switch already does"
    done: false
  - text: "suites and make verify are green and the plugin is repacked"
    done: false
boardId: task-mwulzyut-8tgu1v
nonScope: ["No SVG, no @excalidraw/excalidraw dependency", "No v1 deletion, no analysis gate removal", "No page create/rename UI"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-245]
resultEvidence: ["message table: load(46, locked 46) in read mode, ready, loaded, load(46, locked 0) in edit mode, then no message across two pointer drags", "controls in the same session: keyboard nudge moves the box and saves; a freshly drawn box drags and saves", "the glue was extracted and quoted: the load handler calls updateScene({elements, appState}) and the onChange hash-gates 700 ms after a load"]
resultSummary: "The drag failure was instrumented instead of guessed: both directions of the panel/frame channel were recorded during a failed drag and a successful fresh-rectangle drag, which cleared the panel and the protocol and showed that a pointer drag of an injected element emits no change message at all."
role: BACKEND
scope: ["plugins/designmap/client/page-view.jsx, frame.js — the load path and, if needed, the document", "the in-memory patch module for the vendored bundle (extend the existing one)", "plugins/designmap tests for the patch marker and the load path", "client bundle, package.json version, dist, tarball"]
---

Fix the last P2 defect with the fact the instrument produced: in edit mode the panel posts 46 unlocked elements, the frame replies ready and loaded, and then a pointer drag of an injected element emits NO change at all — while the same element moves by keyboard and a freshly drawn element drags by pointer. The panel and the protocol are cleared, so the cause is inside the vendored frame's injection path, and the glue has no source in the tree: extract it from client.frame.js (find the 'design-map-frame'/'design-map-panel' strings, read the load handler and the Excalidraw mount it performs), name the injection call that produces selectable-but-undraggable elements, and fix it — in code we own, or as an explicit in-memory patch of the bundle with a marker check like the export switch. Then prove a drag of a loaded box moves, emits change, saves and survives a reload.
