---
id: TASK-138
kind: task
title: "M0: designmap-core — schema, ELK layout, merge, lint, scene JSON"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.832Z
updatedAt: 2026-11-17T15:52:40.832Z
acceptance:
  - text: "Two runs over the same fixture produce byte-identical scene JSON; quote both hashes"
    done: false
  - text: "An op or model carrying x/y/fill is refused by the zod schema with its exact path (not by prose)"
    done: false
  - text: "A model with an invalid reference is refused as a whole and the files' hashes are unchanged afterwards"
    done: false
  - text: "A missing model yields a valid empty scene (nodes []), not an error"
    done: false
  - text: "A seeded 25-node view lays out, merges and lints in <= 1500 ms, with layout.done {ms,nodes} in the log"
    done: false
  - text: "Seeded fixtures trigger each lint rule at its stated severity"
    done: false
  - text: "Real overlays: an unknown id, NaN and a negative coordinate are ignored with a merge.gc/lint warning and render still succeeds"
    done: false
  - text: "Every external API used was verified in the API spike report docs/designmap/API-TESTS-CORE.md; any deviation from it is named"
    done: false
boardId: task-mwj4eqc2-6uznd6
nonScope: ["the client renderer panel and any browser bundle (M1/M2)", "agent tool registration and stale/manifest plumbing (M3)", "plugins/design-map/** (the shipped 0.2.0 Excalidraw plugin)", "installing into or restarting the live :3080 profile", "git commit/push"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 34e215fd-175e-46e0-9911-3e458feff431
ownerRole: BACKEND
preset: backend
resultEvidence: ["npm test 53/53 exit 0; node bin/acceptance.mjs ok:true exit 0 (re-run by the orchestrator)", "two CLI renders of fixtures/demo both sha256:2c5fa9e8504900080e0ca3905d90f95e82e08c57c7ebb27d26a1a1d06b1fa280, 3314 B, sorted ids, no timestamps/$H", "refusals with exact paths: model [nodes,1,x|y|fill], op [ops,0,value,x|y|fill]; apply idempotent (second run skipped 2, bytes unchanged); dangling reference refused with unchanged hashes", "lint per §8: errors duplicate_id/dangling_edge/dangling_group/edge_label_missing/orphan_node/view_too_large/non_finite_geometry; warnings label_too_long/node_overlap/stale_node/view_large; info colour_out_of_palette", "overlays: 6 invalid rows become merge.gc warnings, applied 3, render succeeds; empty model -> nodes [] sha256:da0a9704…; unknown view -> unknown_view", "perf25 worstTotalMs 65.72 <= 1500 with layout.done {nodes:25}; docs/designmap/M0-EVIDENCE.md carries the per-item command + output"]
resultSummary: "Shipped designmap-core in plugins/designmap/: strict zod model/views schema (z.strictObject), YAML IO, canonical sort, ELK layered layout with groups/ports and projected geometry, overlay merge + GC, §8 lint table, contract-shaped scene JSON, deterministic out/index.json, diff/apply engine and JSONL logs — 53 plugin-local tests plus an acceptance harness. Corrected after review: lint severities to the owner §8 table (7 error rules now refuse) and index rows to viewId+parent."
role: BACKEND
scope: ["plugins/designmap/ (new package: core modules, fixtures, package.json)", "plugin-local tests run with node --test", "docs/designmap/ (only to append M0 evidence)"]
---

Build `plugins/designmap/` core as a pure Node package: zod-strict model/views schema and YAML parse, canonical ID sort, deterministic elkjs layered layout with groups and ports, overlay merge after layout with GC, lint per the spec table, scene JSON per docs/designmap/SCENE-CONTRACT.md, and the diff/apply engine for semantic ops. Prove with golden fixtures in Node: byte-identical scene across two runs, empty model valid, invalid model refused with exact path, 25-node view layout within 1500 ms, and one lint finding per rule.

Migrated from .dsh/taskboard.json (task task-mwj4eqc2-6uznd6, revision 18).
