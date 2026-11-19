---
id: TASK-139
kind: task
title: "M1: designmap renderer — read-only panel over scene JSON"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.849Z
updatedAt: 2026-11-17T15:52:40.849Z
acceptance:
  - text: "Renders the fixture scene and the real M0 scene with zero runtime console errors; quote the console"
    done: false
  - text: "Drill-down, breadcrumb, search, minimap, legend and stale badge all exercised in a real browser with screenshots"
    done: false
  - text: "Clicking a node calls openSource and a missing source reports a structured refusal"
    done: false
  - text: "The panel draws no geometry of its own: swapping the scene file changes the render without code changes (prove with two scenes)"
    done: false
  - text: "Keyboard reachable controls and visible focus, per the kit's accessibility rules"
    done: false
boardId: task-mwj4eqgt-rx37sd
nonScope: ["core layout/lint code (M0)", "edit mode and overlay writes (M2)", "agent tools (M3)", "restarting or installing into the live :3080 profile unless the orchestrator asks", "editing plugins/design-map/**"]
owner:
  kind: agent
  label: UX/UI
  sessionId: 430eb748-48b3-413c-be70-59c72d4e31a3
ownerRole: UX/UI
preset: ux
resultEvidence: ["plugins/designmap/client.js (447,776 B) + client/{entry,view,scene,host,styles} + build-client.mjs; bundle loads through the real dsh-client-modules loader", "orchestrator Chromium check: header/breadcrumb/canvas with 6 nodes + 5 labelled edges, legend (6 types + 3 kinds), stale chip, footer; 0 console messages; screenshot docs/designmap/screenshots/m1-verified-context.png", "child: group drill emits one drillDown, breadcrumb back emits viewChanged, search Enter focus/Escape clears, minimap 6 rects, read-only drag changes nothing, node click openSource -> stat -> openWorkspacePath, missing source -> role=alert", "axe wcag2a/aa 0 violations on context and child views; keyboard walk with visible focus; same bundle renders fixture, M0 demo and empty sets"]
resultSummary: "Shipped the read-only renderer panel: React Flow bundled into the DSH client-module factory (react external), scene JSON drawn with no geometry logic — pan/zoom, drill-down on group double-click with breadcrumb, search by label/id, minimap, legend, stale chip and per-node badge, footer with generatedAt/commit/scene hash, click-to-open source with structured refusals. Verified by the orchestrator in Chromium on the real loader with 0 console messages; axe 0 violations with a negative control."
role: UX/UI
scope: ["plugins/designmap/client.js and its client-side modules", "docs/designmap/screenshots/ (M1 evidence)"]
---

Build the M1 read-only renderer: a DSH client panel that consumes scene JSON from the M0 core (or the pinned fixture scene until core lands) and draws it without layout logic — pan/zoom, drill-down on a group (double click), breadcrumb, search by label/id, minimap, legend of node types and edge kinds, stale badge per view and node, footer with generatedAt/commit, click a node to open its source file. Read-only by default; no write path yet.

Migrated from .dsh/taskboard.json (task task-mwj4eqgt-rx37sd, revision 9).
