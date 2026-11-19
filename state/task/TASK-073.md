---
id: TASK-073
kind: task
title: "Move Rules and Design map into the chat header"
status: done
revision: 2
createdAt: 2026-11-17T15:52:39.857Z
updatedAt: 2026-11-17T15:52:39.857Z
boardId: task-mwbvkc9u-28l1pi
inline: true
resultEvidence: ["design-map 0.1.12 / project-rules 0.1.9 packed; profile installed; the human confirmed the header chips work after restart", "make verify 17/17 + documentation ok (tarball:matches-source, tarball:version-bumped)", "commits d243d1e plus 221f07b/4a481d7 pushed to origin/main"]
resultSummary: "Rules and Design map moved from the sidebar Global panels into the conversation header actions slot, rendered as labelled chips next to the Tasks counter (orders 20/30 vs Taskboard's 10); both panels and their open path unchanged. design-map 0.1.12 and project-rules 0.1.9 packed and installed into the profile; the boot hook converges them on the next launch. Verified: gates green, committed and pushed d243d1e; the human confirmed the header chips work."
scope: [plugins/design-map/client.js, plugins/project-rules/client.js, "package versions + tarballs"]
---

Move the Design map and Rules triggers from the sidebar's global panels into the chat header actions slot, next to the existing Tasks chip, and remove their sidebar entries; keep the panels and their open behaviour unchanged.

Migrated from .dsh/taskboard.json (task task-mwbvkc9u-28l1pi, revision 3).
