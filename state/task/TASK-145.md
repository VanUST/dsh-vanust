---
id: TASK-145
kind: task
title: "F1: snap edge endpoints to node boundaries, keep edge labels out of node boxes"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.951Z
updatedAt: 2026-11-17T15:52:40.951Z
acceptance:
  - text: "Every edge in fixtures/demo and the 25-node fixture has points[0] on the source box boundary and points[last] on the target box boundary (distance to the rectangle edge <= 0.01, and the point lies within the segment span), asserted by a test that iterates all edges of both fixtures and reads the scene JSON — quote the assertion output"
    done: false
  - text: "No edge labelAt falls inside any node rectangle of its own view; the test asserts it over both fixtures and over the overlay-moved case (a node moved by overlays must re-anchor its incident edges and re-place their labels)"
    done: false
  - text: "A label that cannot be placed outside every box is still emitted at the free-span midpoint and reported by a new lint rule `label_over_node` at severity warning, so a regression is visible instead of silent"
    done: false
  - text: "Determinism survives: two runs over fixtures/demo are byte-identical (quote both sha256). The demo golden hash WILL change — update it in the golden test and in M0-EVIDENCE.md, and state the old and new hashes explicitly as an intended geometry change"
    done: false
  - text: "The 25-node perf budget still holds: layout+merge+lint <= 1500 ms, quote the measured worst total"
    done: false
  - text: "No other behaviour changes: the full suite passes (quote tests/pass/fail) and the only intended output change is edge geometry"
    done: false
  - text: "Be aware of concurrency: the UX/UI child may be editing client/** at the same time; do not touch those paths"
    done: false
boardId: task-mwj64d96-0lymbb
nonScope: ["the renderer panel (client/**, client.js, build-client.mjs) — the UX/UI child owns it", "docs/designmap/SCENE-CONTRACT.md (orchestrator-owned; it already states the boundary rule)", "overlay semantics, lint severities, tool schemas, manifest/stale", "installing into or restarting :3080, git commit/push"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 34e215fd-175e-46e0-9911-3e458feff431
ownerRole: BACKEND
preset: backend
resultEvidence: ["node --test test/geometry.test.mjs exit 0: 4 demo + 26 perf25 edges with distance 0.00 and span true; no label anchor inside a node box incl. the overlay-moved node; seeded overlapping-box case yields label_over_node", "orchestrator re-rendered fixtures/demo: sha256:3ec7cf040db5ee668a87e436a825249fa597e2757839c622c884e688f5207ec4 (3329 B) on two runs; intended change from 2c5fa9e8… documented", "acceptance harness ok:true; perf25 worstTotalMs 90.53 vs 1500", "remaining suite red attributed: 5 failures in test/host-overlay.test.mjs from a concurrent out-of-scope edit of src/host.mjs (payload allow-list rejects the transport key `op`), fix delegated separately"]
resultSummary: "Fixed both geometry defects: edge endpoints snap exactly to the source/target box perimeter, and labels are placed on the longest free span outside every node box, recomputed after the overlay merge, with a defensive label_over_node warning when no free span exists. Asserted over demo, the 25-node fixture and an overlay-moved node; determinism holds with the intended golden sha256:3ec7cf04…."
role: BACKEND
scope: ["plugins/designmap/src/layout.mjs (edge section projection/snap) and src/render.mjs or src/overlays.mjs (labelAt placement)", "plugins/designmap/src/lint.mjs for a defensive label_over_node rule", "plugins/designmap/test/** + fixtures/ for the geometry assertions and the new golden hash", "docs/designmap/M0-EVIDENCE.md (append the fix round; do not rewrite earlier sections)"]
---

Fix two geometry defects in designmap-core that the M1 renderer exposed when it drew the real scene faithfully. (1) Edge endpoints do not land on the node boundary: in fixtures/demo, e.api.db starts 8px outside its source box, e.api.worker ends 16px short of its target, e.payments.stripe and e.worker.payments each start 8px outside and end 8px short — CT-SCENE requires the first point on the source boundary and the last on the target boundary. (2) labelAt sometimes falls inside a node box: e.api.worker (135.9,49) is inside svc.checkout.api (24..164 × 44.33..88.33) and e.worker.payments (398.9,82) is inside the worker box (220..408). Both were verified by the orchestrator against the rendered scene, not inferred.

Migrated from .dsh/taskboard.json (task task-mwj64d96-0lymbb, revision 7).
