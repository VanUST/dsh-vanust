---
id: TASK-410
kind: task
title: "Design map v2 P2: the panel edits the page file"
status: done
revision: 11
createdAt: 2026-11-24T09:51:03.143Z
updatedAt: 2026-11-24T11:37:52.224Z
acceptance:
  - text: "the panel lists designmap/pages from the host and shows the selected page's scene in the Excalidraw frame"
    done: false
  - text: "a human edit (drag, resize, text, colour, arrow) is written back to the same page file; reloading the panel shows it"
    done: false
  - text: "edit mode is a toggle; read mode cannot change the file"
    done: false
  - text: "tidy and render SVG buttons call the same host operations the agent tools use"
    done: false
  - text: "the overlay, annotation and label code paths are no longer called by the panel"
    done: false
  - text: "the client bundle builds from source, the package tests and make verify are green, and the plugin is repacked"
    done: false
  - text: "the host command answers pages/page/save with the page file as the only store"
    done: false
boardId: task-mwuilecz-gd1wly
nonScope: ["No browser proof in this task: a separate UX/UI seat drives the panel on a second server", "No analysis or state-panel change (P3)", "No deletion of the v1 files or tools", "No change to the four tools' contract"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-245]
resultArtifacts: [plugins/designmap/client/page-view.jsx, plugins/cc-dsh-designmap-0.1.36.tgz]
resultEvidence: ["bisect, one change per variant: baseline x:90 → bare document x:90 → geometry chain all transform/scale/zoom none → one click inside the frame x:190", "after the fix the harness saves [{n:46,x:190}] and the frame's change carries x:190; before it [{n:46,x:90}] with no movement", "browser: first drag [90,248] → [190,288], saved, survives reload; message 7 (change) appears where 0.1.35 emitted nothing", "suites 144/144 designmap and 15/15 state panel; plugin packed 0.1.36"]
resultSummary: "The panel is an editor over the page file and the drag finally works: an iframe document that was never focused lets Excalidraw select an injected element and never drag it, so edit mode now focuses the frame when the page is loaded, and the first human drag moves the box instead of their second. The cause was found by bisect, not by patching the vendored bundle: bare document, ancestor geometry (no transform/scale/zoom anywhere) and the sandbox attribute were each eliminated, and a single click inside the frame flipped the outcome. Typed build: designmap 0.1.36, state panel 0.1.47."
role: BACKEND
scope: ["plugins/designmap/client/ — host.js, view.jsx, entry.jsx, styles.js as needed for the page editor", "plugins/designmap/src/command.mjs and src/host.mjs — the pages/page/save ops (reusing the page store from P1)", "plugins/designmap/build-client.mjs, client.js (built), package.json version, tarball", "plugins/designmap/test/ — a command-level test that save round-trips a scene"]
---

Implement P2 of design-map v2: make the panel an editor over the page file instead of a renderer of a server-computed scene. The frame opens designmap/pages/<slug>.excalidraw directly, the human edits it with Excalidraw's own tools (drag, resize, text, colour, arrows), and the result is written back to that same file. Deliver: (a) host command ops pages | page | save — pages lists the directory, page returns one scene, save writes the scene back after re-reading the file; (b) the panel's bridge switched to those ops, with a page switcher and an edit-mode toggle; (c) overlay/annotation/label calls removed from the panel (the v1 modules stay in the tree until P3); (d) tidy and render-SVG buttons calling the host operations the agent tools use; (e) the client bundle rebuilt and the plugin repacked. No browser run in this task — the acceptance here is the build, the command contract and the gate; a UX/UI seat proves the panel in a browser separately.
