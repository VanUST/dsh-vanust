---
id: TASK-305
kind: task
title: "P2 drag: bisect the panel's hosting, then fix the one factor that differs"
status: done
revision: 4
createdAt: 2026-11-24T11:30:14.938Z
updatedAt: 2026-11-24T12:34:52.710Z
acceptance:
  - text: "the baseline harness fails as before (a save of 46 elements at x 90 after a 60x30 drag), quoted"
    done: false
  - text: "the bisect names which single difference between the frame alone and the panel's hosting flips the outcome, with the variant runs quoted"
    done: false
  - text: "the iframe's own geometry is measured: getBoundingClientRect vs offsetWidth/offsetHeight in the parent and the computed transform/scale of its ancestors, quoted as numbers"
    done: false
  - text: "the cause is named, fixed, and the harness shows a save with the moved coordinates; a freshly drawn box still drags"
    done: false
  - text: "suites and make verify are green and the plugin is repacked"
    done: false
boardId: task-mwum4ynf-b8kx6z
nonScope: ["No SVG, no new dependency", "No v1 deletion, no analysis gate removal", "No page create/rename UI"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 577b4152-6421-4edb-9a8b-fcd85bf3c6ef
preset: backend
reqIds: [REQ-245]
resultArtifacts: [plugins/designmap/client/page-view.jsx]
resultEvidence: ["bisect, one change per variant: baseline x90 fails, bare document x90 fails, ancestor chain transform/scale/zoom all none, one click inside the frame gives x190", "after the fix the harness saves x190 and the frame sends change with the moved coordinate; before it x90 with no movement", "suites 144/144 designmap and 15/15 state panel; plugin packed 0.1.36"]
resultSummary: "The cause was found by bisect and fixed in code we own: an iframe document that was never focused lets Excalidraw select an injected element and never drag it, so edit mode now focuses the frame when a page loads and the first human drag works. Proven by the harness (x90 fails, x190 passes with the click variant flipping the outcome) and later in the browser."
role: BACKEND
scope: ["plugins/designmap/client/page-view.jsx, frame.js — the hosting", "plugins/project-state-panel/client.js and its styles if the container is the cause", "the harness under .dsh as the reproduction, tests for the fixed behaviour", "client bundle, package.json version, dist, tarball"]
sessions:
  - sessionId: 577b4152-6421-4edb-9a8b-fcd85bf3c6ef
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Find and fix why a loaded box cannot be dragged in the panel, using the 40-second harness as the instrument. The frame alone drags injected elements; the panel does not, and the glue's injection call is not the cause. Bisect the hosting: (a) serve the panel with a bare document instead of frameDocument's CSS, (b) drag a box drawn inside the panel's own frame, and (c) measure the iframe's geometry — its getBoundingClientRect against offsetWidth/offsetHeight and the computed transform/scale of every ancestor, because a scaled or transformed ancestor breaks Excalidraw's pointer-to-scene mapping while leaving selection and drawing apparently working. Whichever single difference flips the outcome is the cause: fix it, and prove the harness saves the moved coordinates while a freshly drawn box still drags.
