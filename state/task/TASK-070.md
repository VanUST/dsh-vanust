---
id: TASK-070
kind: task
title: "Fix docs and gates: stale plugin counts, capability claims, pin drift"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.817Z
updatedAt: 2026-11-17T15:52:39.817Z
boardId: task-mwatx3ff-f1vnqh
ownerRole: BACKEND
---

Make the kit's documentation and gates tell the truth: the plugin count in three docs is stale (fifteen/twelve vs 17), the reviewer/critic capability claims contradict their presets (bash writes), check-documentation only checks that plugins are named (not the count), the browser-audit tool pin is invisible to --check, and the critic preset carries write/edit despite a never-fix persona.

Migrated from .dsh/taskboard.json (task task-mwatx3ff-f1vnqh, revision 7).
