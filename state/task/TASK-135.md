---
id: TASK-135
kind: task
title: "API-first proof: elkjs / zod / yaml / DSH tool transport"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.780Z
updatedAt: 2026-11-17T15:52:40.780Z
acceptance:
  - text: "A spike package under scripts/designmap-api/ with its own package.json pins elkjs@0.12.1, zod@4.6.7, yaml@2.9.1 and installs them locally; quote the install output"
    done: false
  - text: "elkjs: an executed script lays out a graph with at least one nested/grouped node and one edge with ports using elk.algorithm=layered; report the returned node/edge geometry, then run the SAME input twice and show a hash-equal scene/coordinate dump (determinism, FR-3/NFR-1)"
    done: false
  - text: "elkjs: report whether the v1.1 interactive options named in the spec (elk.layered.layeringStrategy=INTERACTIVE, crossingMinimizationStrategy=INTERACTIVE, org.eclipse.elk.position) are accepted by 0.12.1 — start from the installed package's own option metadata/source, then prove acceptance or rejection with a second layout run; do not guess"
    done: false
  - text: "elkjs: state the browser constraint explicitly — does elkjs need a Web Worker (workerUrl/workerFactory) in a browser, and is that relevant when layout stays server-side in the host? Back the statement with the installed package source"
    done: false
  - text: "zod 4: an executed check proves the exact strict-object API in 4.6.7 (e.g. z.strictObject vs .strict()), the shape of safeParse error paths, and that an unknown key such as x/y/fill on a node op is REJECTED with its path; quote the code and output"
    done: false
  - text: "yaml 2.9.1: an executed round-trip proves parse -> validate -> stringify is stable for the model document shape in the spec §4 (including multiline labels), and state whether output formatting is stable enough for byte-identical commits"
    done: false
  - text: "DSH transport: quote the installed defineTool contract (name, description, inputSchema/parameters, execute) and how a tool is registered per agent (the agentPreset gate in plugins/design-map/index.js); state the exact tool-name constraints (regex/length) from the installed @deepseek-ai/dsh-tools source"
    done: false
  - text: "DSH transport: quote how a client panel can ask the host to run an operation (command vs tool vs remote API) from the installed packages, and name the mechanism the new panel should use for render/open/export and overlay writes"
    done: false
  - text: "State the dependency-shipping decision with evidence: can the new plugin declare elkjs/zod/yaml as real npm dependencies and be installed from a tarball into this profile, or must they be vendored? Name what you verified (pnpm add behaviour or the kit's install path) and the risk"
    done: false
  - text: "docs/designmap/API-TESTS-CORE.md states, per API: version, the command run, the observed output, and the ONE fact that changes the M0 plan; it ends with a short 'constraints for M0' list and an explicit list of what stayed unverified"
    done: false
  - text: "No file outside scope changed (git status shows only scripts/designmap-api/ and docs/designmap/ additions) and nothing was installed into the live profile"
    done: false
boardId: task-mwj4d9ka-tcvwpx
nonScope: ["M0 feature code: no designmap-core package, no schema implementation, no layout module — that is the next task", "plugins/design-map/** (the shipped Excalidraw plugin 0.2.0) — do not edit it", "installing, enabling or disabling anything in the live profile; restarting :3080", "design.excalidraw and the current design-map panel", "git commit/push"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 34e215fd-175e-46e0-9911-3e458feff431
ownerRole: BACKEND
preset: backend
resultEvidence: ["docs/designmap/API-TESTS-CORE.md (557 lines): per-API version, command, quoted output, constraints for M0", "scripts/designmap-api/ five scripts exit 0; projected scene sha256 83633f98… identical across runs while raw JSON differs via $H", "zod: plain z.object dropped x/y/fill (success:true); z.strictObject rejected unrecognized_keys path [\"nodes\",1]", "elk: spec ids absent from knownLayoutOptions() and byte-equal baseline; layering.strategy=INTERACTIVE moves geometry only with node x/y", "transport: defineTool parameters + output.schema/render + execute; tool names [A-Za-z0-9_-] max 64; panel via remote.commands.execute", "deps: npm pack -> scratch pnpm profile add --offline -> elkjs/zod/yaml resolve and scripts run"]
resultSummary: "Executed the §12 host-side API gate before any M0 code and corrected four load-bearing assumptions by measurement: spec elk option ids are silently ignored (real ids differ; INTERACTIVE needs input node x/y), raw elkjs output is nondeterministic via $H (projection yields byte-identical scenes), plain zod objects strip x/y/fill (z.strictObject mandatory for INV-NO-GEO), defineTool takes `parameters` with a /designmap command as panel transport. Dependencies ship as real pinned npm deps."
role: BACKEND
scope: ["scripts/designmap-api/ — a self-contained spike package (own package.json, node_modules, test scripts) for elkjs/zod/yaml", "docs/designmap/API-TESTS-CORE.md — the findings report (create dirs as needed)", "reading installed DSH sources under /home/iustimov/.npm/node/lib/node_modules/@deepseek-ai/dsh/ and this repo's plugins/*"]
---

Produce EXECUTED API-test evidence for the four host-side APIs the designmap redesign depends on (elkjs, zod, yaml, DSH tool transport), so M0 is written against verified APIs instead of memory. This is the §12 fetch-first gate from the owner's spec; it must finish before any designmap-core feature code exists. Deliver: working spike scripts + a findings report with commands, outputs, versions, and the exact facts that will constrain M0.

Migrated from .dsh/taskboard.json (task task-mwj4d9ka-tcvwpx, revision 8).
