---
id: TASK-303
kind: task
title: "P2 defects: a loaded box must drag, tidy must not eat labels, and the button must not lie"
status: done
revision: 5
createdAt: 2026-11-24T11:11:58.540Z
updatedAt: 2026-11-24T12:34:49.800Z
acceptance:
  - text: "a box that came from the page file drags by pointer in edit mode: x/y change, the save carries them, and they survive a reload; proven with the same probe that fails today"
    done: false
  - text: "a freshly drawn rectangle still drags, so the fix does not trade one path for the other"
    done: false
  - text: "tidy moves elements instead of rebuilding them: a labelled arrow keeps its label (46 elements in, 46 out on the system page)"
    done: false
  - text: "the console no longer reports 'Permissions policy violation: unload is not allowed in this document', or the report names the exact handler with evidence that it is outside our code"
    done: false
  - text: "the render control's label matches what it produces (a PNG), not SVG"
    done: false
  - text: "suites and make verify are green and the plugin is repacked"
    done: false
boardId: task-mwulhg75-w3vwcv
nonScope: ["No SVG and no @excalidraw/excalidraw dependency (owner decided PNG only)", "No v1 deletion, no analysis gate removal", "No page create/rename UI"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-245]
resultEvidence: ["tidy: 46 in, 46 out, no id lost, label e.orch.designmap:label kept; new test tidy-preserves.test.mjs", "render control renamed to Render PNG; console unload line traced to the vendored bundle (0 occurrences in our client code)", "frame-only drag of a loaded box succeeded (x 90 to 220), which cleared the frame and pointed at the panel path"]
resultSummary: "Three defects fixed where they lived: tidy moves elements instead of rebuilding the page (46 in, 46 out, no id lost), the render control is named Render PNG because that is what it writes, and the repeating console unload line was traced to the vendored Excalidraw bundle with zero occurrences in our code."
role: BACKEND
scope: ["plugins/designmap/client/page-view.jsx and frame glue path — the load/save feedback", "plugins/designmap/src/tidy.mjs — preserve elements", "plugins/designmap tests for both", "client bundle, package.json version, dist, tarball"]
---

Fix the three defects the final browser proof isolated, at their causes. (1) A box loaded from the page file cannot be dragged by pointer, while a freshly drawn rectangle can, and the same rectangle stops dragging after a reload — so the defect is in the panel's load path, most likely a feedback loop where a save or re-render re-posts the scene into the frame and discards the in-flight drag. Selection and hit tests work (click + ArrowRight moves the box), so the fix belongs in page-view's postLoad/save path, not in pointer handling. (2) Tidy rebuilt the page and lost a label: a labelled arrow's text element (e.orch.designmap:label) disappeared, 46 -> 45. Make tidy preserve every element and move only the ones it repositions. (3) The control labelled Render SVG produces a PNG; rename it to what it does. Also chase the repeating console error 'Permissions policy violation: unload is not allowed in this document' — remove our handler if it is ours, or name it with evidence if it is not.
