---
id: TASK-074
kind: task
title: "Back-to-chat button in Rules and Design map panels"
status: done
revision: 2
createdAt: 2026-11-17T15:52:39.875Z
updatedAt: 2026-11-17T15:52:39.875Z
boardId: task-mwbvq2t4-767t4x
inline: true
resultEvidence: ["design-map 0.1.13 / project-rules 0.1.10 packed and installed into the web profile; the human confirmed the button works", "back button calls layout.selectPanel(null), the same call the workspace shell uses to close a panel", "make verify 17/17 + documentation ok; commit 5ec11bd pushed to origin/main"]
resultSummary: "Both panels now open with a chevron back button in the header (aria-label 'Back to chat') that calls layout.selectPanel(null) and returns to the conversation; the layout service is injected into the main slot for both pages. Versions bumped, packed, installed; gates green; committed and pushed 5ec11bd."
scope: [plugins/design-map/client.js, plugins/project-rules/client.js, "package versions + tarballs"]
---

Add a back-to-chat control inside the Rules and Design map panels, which take over the main view; previously the only way back was the sidebar.

Migrated from .dsh/taskboard.json (task task-mwbvq2t4-767t4x, revision 3).
