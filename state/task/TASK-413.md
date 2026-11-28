---
id: TASK-413
kind: task
title: "map_render: frame the page, do not crop it"
status: done
revision: 5
createdAt: 2026-11-24T10:57:02.747Z
updatedAt: 2026-11-24T11:20:47.811Z
acceptance:
  - text: "a page taller than the capture viewport comes out complete: the image is framed to the page's own bounds with padding, and the returned width/height cover every element"
    done: false
  - text: "the framebox math uses the elements' real extent (including bound labels and arrows) and is quoted for the imported system page"
    done: false
  - text: "an empty page still renders a small picture and says so, rather than failing"
    done: false
  - text: "the returned payload states the page bounds as well as the image size, so a caller can tell a fitted picture from a cropped one"
    done: false
  - text: "suites and make verify are green and the plugin is repacked"
    done: false
boardId: task-mwuky9dv-mtcxoh
nonScope: ["No SVG work: the missing SVG export is a separate owner decision", "No change to map_edit, map_read, tidy or the panel", "No v1 deletion, no analysis gate removal"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-250]
resultArtifacts: [plugins/designmap/src/excalidraw-render.mjs, plugins/designmap/test/render-framing.test.mjs, designmap/out/system.png]
resultEvidence: ["render-page system: image 640x2288 at DPR 2, 122411 B; bounds {x:40,y:40,width:239,height:1096}; viewport 320x1144 at zoom 1; 0 elements outside the visible rect", "empty page: image 640x400, 15301 B, empty true", "tests 143/143 including render-framing (bounds 239x1096, labels and arrow points widen the extent)", "make verify exit 0, 0 FAIL, tarball:matches-source PASS, version 0.1.34"]
resultSummary: "map_render no longer crops: it folds every drawable element (shapes, bound labels, arrow points) into the page's bounds, sets Excalidraw's own zoom and scroll so the whole page fits with padding, and captures at devicePixelRatio 2. The system page now comes out 640x2288 with bounds 239x1096 and 0 elements outside the framed view, against a 1000x700 viewport crop before. The payload reports image size, page bounds and viewport/zoom, so a caller can tell a fitted picture from a cropped one; an empty page renders and says it is empty."
role: BACKEND
scope: ["plugins/designmap/src/excalidraw-render.mjs — the framing math and the capture", "plugins/designmap/test/ — the test that pins complete framing", "package.json version, dist, tarball"]
---

Fix the cropping defect in map_render: the picture the agent reads is currently a 1000x700 viewport capture, so a page taller than the viewport is cut off (the imported system page is about 1160 px). Frame the capture to the page's own bounds instead: compute the elements' extent (shapes plus their bound labels and the arrows between them), set Excalidraw's own zoom and scroll so the whole page fits with a small padding, capture at devicePixelRatio 2, and return both the page bounds and the image size so a caller can tell a fitted picture from a cropped one. Still one renderer — Excalidraw's canvas, correctly framed — with no new dependency and no writer of ours.
