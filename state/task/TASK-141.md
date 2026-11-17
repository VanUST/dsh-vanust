---
id: TASK-141
kind: task
title: "M3: living doc — agent tools, manifest, stale detection, logs"
status: done
revision: 1
createdAt: 2026-11-17T15:52:40.883Z
updatedAt: 2026-11-17T15:52:40.883Z
boardId: task-mwj4eqpl-a6043y
ownerRole: BACKEND
---

Implement the agent-facing host tools over M0 core: designmap_apply (idempotent schema-enforced semantic ops with no coordinates), designmap_render, designmap_lint, designmap_status (manifest vs HEAD, staleNodes, commitBehind), designmap_scan (git diff proposed ops, never writing), designmap_open, designmap_export (SVG of the current scene incl. overlays), plus manifest writing on apply and null-safe JSONL structured logs for every event in the spec table. Prove the living-doc loop on a real edit: status stale -> scan proposes -> apply -> render -> lint clean -> overlay survives.

Migrated from .dsh/taskboard.json (task task-mwj4eqpl-a6043y, revision 10).
