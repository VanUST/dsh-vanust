---
id: TASK-156
kind: task
title: "Fix the blank white header button in the dark theme"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.144Z
updatedAt: 2026-11-17T15:52:41.144Z
boardId: task-mwjc0uld-p8ph1o
inline: true
nonScope: ["the panel layout or canvas rendering (already reviewed in 6e7b54d)", "installing into the live :3080 profile"]
resultEvidence: ["commit c991543", "--dmv-accent-ink computed from the resolved accent: light #93c5fd -> #0b0f14 ink (button bg rgb(147,197,253), colour rgb(11,15,20))", "8/8 client tests; toggle label now 'Done editing' while active"]
resultSummary: "The primary header button derived no on-accent ink: it hardcoded white while the host accent can be a bright colour, so 'Editing overlays' rendered as a blank white box. The panel now computes --dmv-accent-ink from the resolved accent (light accent -> dark ink, dark -> white) and the button uses it; the toggle reads as an action ('Done editing'). Verified in the harness under a dark theme with a light accent: accent #93c5fd, ink #0b0f14, readable label."
scope: [plugins/designmap/client/styles.js, plugins/designmap/client/view.jsx, plugins/designmap/client/excalidraw.js, plugins/designmap/client.js]
---

Fix the header control that renders as a blank white box in the dark theme: the primary button's label is hardcoded white while the host accent can be a light colour, so "Editing overlays" becomes invisible. Derive the on-accent ink from the resolved accent, and make the edit toggle read as an action ("Done editing" while active).

Migrated from .dsh/taskboard.json (task task-mwjc0uld-p8ph1o, revision 3).
