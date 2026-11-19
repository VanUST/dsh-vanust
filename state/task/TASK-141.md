---
id: TASK-141
kind: task
title: "M3: living doc — agent tools, manifest, stale detection, logs"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.883Z
updatedAt: 2026-11-17T15:52:40.883Z
acceptance:
  - text: "Each tool's schema refuses a coordinate/colour field with a named error, and an idempotent re-apply reports applied=0/skipped=N with files unchanged"
    done: false
  - text: "status on a manifest whose commit lags HEAD returns stale=true with the affected nodes, and a missing manifest returns stale=true plus a warning"
    done: false
  - text: "The full loop is executed on a real source edit and every step is visible in logs/*.jsonl (tool.enter/exit, model.diff, merge.applied, lint.result, render.done)"
    done: false
  - text: "Export SVG of a view reflects overlay positions and colours; the file parses as SVG with the expected labels"
    done: false
  - text: "Log serialization survives null/undefined fields, demonstrated by a seeded case"
    done: false
boardId: task-mwj4eqpl-a6043y
nonScope: ["renderer panel internals (M1/M2)", "core layout algorithm changes not demanded by a failing acceptance", "auto-apply without confirmation (forbidden by DEC-PROPOSE)", "installing into or restarting the live :3080 profile unless the orchestrator asks"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 34e215fd-175e-46e0-9911-3e458feff431
ownerRole: BACKEND
preset: backend
resultEvidence: ["npm test 85/85 exit 0 (79 M3 + 6 overlay cases written by the orchestrator); node bin/living-doc.mjs exit 0 with 31/31 checks; node bin/tool-contract.mjs exit 0", "living-doc loop: status stale (staleNodes svc.checkout.api source_changed) -> scan proposedOps (model.yaml unchanged) -> apply 2 -> re-apply 0/2 -> status clean -> render lint.ok -> overlay survives -> export SVG with overlay x/y/fill", "tool schema: installed dsh-tools validator names ops[0].value.x|y|fill as undeclared; clean/remove ops pass; 7 tools orchestrator-only, /designmap command ungated", "export v.context.svg 2213 B sha256:6b7c047c…, parses as XML with 3 nodes/2 edges, overlay position (40,30) and colour #2563eb, edge labels present", "logs/events.jsonl: tool.enter×11, tool.exit×11, model.diff×3, layout.done×3, merge.applied×3, lint.result×3, render.done×3; null-safety seeded case does not throw", "overlay path: upsert/resetNode/resetView write only overlays.json (model hash unchanged, render does not rewrite it); 8 refusal codes keep bytes identical; no designmap_overlay tool exists (NFR-4)"]
resultSummary: "Delivered the living-doc host: plugins/designmap/index.js with 7 preset-gated tools (scan/apply/render/lint/status/open/export), a /designmap command carrying the panel's reads and its overlay write path, manifest writing + stale detection, git-diff scan that never writes, SVG export of the merged scene, and JSONL event logs — proven by a 31-check living-doc driver on a real source edit, an installed-validator tool-contract check, and a fake-Cordis registration probe (7 tools for orchestrator, 0 for backend). The unproven overlay write path was closed here with test/host-overlay.test.mjs (6 cases, 85/85 total)."
role: BACKEND
scope: ["plugins/designmap/index.js host plugin and tool registrations", "manifest.json and logs/*.jsonl writers", "designmap_scan/apply/render/status/open/export/lint implementations", "SVG export from the merged scene"]
---

Implement the agent-facing host tools over M0 core: designmap_apply (idempotent schema-enforced semantic ops with no coordinates), designmap_render, designmap_lint, designmap_status (manifest vs HEAD, staleNodes, commitBehind), designmap_scan (git diff proposed ops, never writing), designmap_open, designmap_export (SVG of the current scene incl. overlays), plus manifest writing on apply and null-safe JSONL structured logs for every event in the spec table. Prove the living-doc loop on a real edit: status stale -> scan proposes -> apply -> render -> lint clean -> overlay survives.

Migrated from .dsh/taskboard.json (task task-mwj4eqpl-a6043y, revision 10).
