---
id: TASK-136
kind: task
title: "API-first proof: @xyflow/react inside the DSH client panel"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.797Z
updatedAt: 2026-11-17T15:52:40.797Z
acceptance:
  - text: "Report states the MEASURED React version provided to client module factories (from the running :3080 page, e.g. require('react').version via the module loader, or an equivalent measured probe) with the command used — not the package.json claim"
    done: false
  - text: "A spike bundle is actually built with esbuild (quote version and command) that ships @xyflow/react in the harness client-module format with react external, and loads without CDN: report bundle size and whether a bare `import '@xyflow/react'` survives or must be bundled"
    done: false
  - text: "In a real browser (Playwright MCP), the spike renders at least 3 nodes + 2 labelled edges from a scene JSON and proves: initial fit, drag of one node changes only that node's position, and onNodesChange emits a delta ({id, position}) usable as an overlays patch; quote the emitted JSON"
    done: false
  - text: "Proves pan/zoom (wheel zoom and drag-pan) in the spike and states whether React Flow's built-in minimap/legend affordances need extra plugins"
    done: false
  - text: "States whether the panel can talk to the host from inside this bundle (the existing plugin uses remote.commands.execute and remote.workspaceFiles) and names the exact API from installed sources, since overlay writes need it"
    done: false
  - text: "Report gives an explicit verdict: React Flow feasible / not feasible, with the blocker named if not; if not feasible, a concrete plain-SVG + own pan/zoom recommendation with measured size/behaviour of the fallback"
    done: false
  - text: "Screenshots exist under docs/designmap/screenshots/ (initial render, after drag) and the console log during the spike is clean (quote it)"
    done: false
  - text: "docs/designmap/API-TESTS-RENDER.md lists per API: version, command, observed output, the ONE fact that changes the M1 plan, plus what stayed unverified"
    done: false
  - text: "Nothing outside scope changed (git status) and :3080 was never installed into or restarted"
    done: false
boardId: task-mwj4da1o-lik5t8
nonScope: ["M1 panel code: no new designmap plugin package, no panel registration, no overlays implementation", "editing plugins/design-map/** or client.frame.js", "installing anything into the live profile, restarting :3080, changing any preset", "editing design.excalidraw", "git commit/push"]
owner:
  kind: agent
  label: UX/UI
  sessionId: 430eb748-48b3-413c-be70-59c72d4e31a3
ownerRole: UX/UI
preset: ux
resultEvidence: ["docs/designmap/API-TESTS-RENDER.md (390 lines): per-API version, command, observed output, ONE fact, unverified list", "Real loader measured: React 18.3.1 served by :3080 index-Ciz7DZxv.js (sha256 65411d…), seed table react/react-dom/react-dom/client/react/jsx-runtime; factory probe require('react').version === \"18.3.1\"", "esbuild 0.25.12 bundle: 407.2 KiB raw / 213.2 KiB min / 67.3 KiB gzip; bare-external negative control refused with 'require(\"@xyflow/react\") missed the module table'", "Browser: 3 nodes + 2 labelled edges from scene JSON, fit {x:220,y:53,zoom:1.5} allInside, drag delta {\"id\":\"svc.checkout.api\",\"position\":{\"x\":85.33,\"y\":60}}, zoom 1.5→2.0921, pan; console 0 messages", "axe-core: 0 violations / 38 passes in a real context; screenshots docs/designmap/screenshots/render-spike-{initial,after-drag,zoom-pan}.png; pixelmatch 0 mismatched pixels on re-shoot", ":3080 PID 2705046 not restarted; plugins/design-map/** and design.excalidraw untouched"]
resultSummary: "Proved @xyflow/react 12.12.1 is feasible in a DSH client panel and handed M1 a measured recipe: bundle it (react external, ~67 KiB gzip), never declare it external; React served to factories is 18.3.1; custom edges from scene points+labelAt are required because built-in routing re-routes; overlay writes need host work; keyboard node move is absent by default. All proven in Chromium on the real module loader with zero console errors and 0 axe violations."
role: UX/UI
scope: ["scripts/designmap-render-spike/ — a self-contained spike (own package.json, esbuild bundling, a minimal harness-compatible client module factory, a local static page used only for the spike)", "docs/designmap/API-TESTS-RENDER.md — the findings report (create dirs as needed)", "docs/designmap/screenshots/ — spike screenshots", "reading /home/iustimov/.npm/node/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/ (module table, CLIENT_CHUNK route, dsh.client.external) and plugins/design-map/client.js"]
---

Prove, in a real browser, whether @xyflow/react 12.12.1 can ship inside a DeepSeek Harness client plugin panel and behave as a controlled renderer (nodes/edges from a scene JSON, onNodesChange producing position deltas for overlays). Decide React Flow vs the plain-SVG fallback with measured evidence, and hand the M1 implementer an exact bundling recipe. This is the §12 fetch-first gate; no grid of product code yet.

Migrated from .dsh/taskboard.json (task task-mwj4da1o-lik5t8, revision 7).
