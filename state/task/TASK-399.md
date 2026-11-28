---
id: TASK-399
kind: task
title: "Assess the case library against the behaviour-only rules and design the enforcement layer"
status: done
revision: 5
createdAt: 2026-11-24T08:15:13.965Z
updatedAt: 2026-11-24T08:16:49.295Z
acceptance:
  - text: "The document states the four rules as invariants and maps each to a mechanism"
    done: false
  - text: "Every defect it names is evidenced from this tree with a path (and a case file where the library itself violates a rule)"
    done: false
  - text: "The architecture names the record fields, the driver contract, the refusal codes and the boundary each mechanism cannot close"
    done: false
  - text: "The phased plan gives, per phase, a proof and what does not change"
    done: false
  - text: "The decisions that are the owner's are listed separately from the proposals"
    done: false
boardId: task-mwuf679d-sy6agu
chore: true
choreReason: "A design assessment requested by the owner: no product requirement exists for it and no code changes yet; the deliverable is the proposal the implementation will be derived from."
inline: true
nonScope: ["No change to plugins/test-cases code, schema or tests", "No case recorded, migrated or closed", "No change to profile/cordis.patch.yml", "No design-map or Analysis Record change: a proposal does not move the map"]
resultEvidence: ["docs/CASE-LIBRARY-BEHAVIOUR-DESIGN.md — new document (read back after the edit: the D1 wording now names both halves of policy-docs.test.mjs)", "Shipped contract read: plugins/test-cases/README.md (run, CASE_SUMMARY, wrong-product red, provenance, acceptance reasons, taskboard gate), lib/runner.mjs:69/80/133/203/266, lib/checks.mjs:135/184-210, lib/acceptance.mjs:228/184-272/289-385, test-cases.mjs:518-602, Makefile:138-160", "Library violations cited from records: docs/cases/case-surface-per-role-matches-the-readme-table.json (both runs summaryError \"no summary written\", metrics {}; driver greps README at test/policy-docs.test.mjs:71,102) and docs/cases/panel-accessibility-stays-clean-under-axe.json (driver loads docs/cases/fixtures/a11y-page.html per drivers/panel-a11y.mjs:24)", "Tester seat read: profile/cordis.patch.yml:308-320 (write scope) and :1911 (persona text the procedure will replace)", "Node.js 26.13.1 test-runner docs fetched to settle the driver contract: subtests and switchable reporters exist, so CASE_SUMMARY stays the contract and a node --test adapter can map subtests to steps later"]
resultSummary: "Delivered docs/CASE-LIBRARY-BEHAVIOUR-DESIGN.md: the owner's four rules restated as invariants; a measured inventory of what the shipped acceptance layer already enforces (runner, typed checks with p95/baseline, measured red incl. wrong-product tree, provenance, 20-reason gate, three Makefile gates) — R3 is largely shipped, R2's middle step does not exist, R1/R4 are declarative; six defects each evidenced from this tree, including two of the library's own verified cases that contradict the rules; the enforcement architecture (two shelves; M2 surface + interactions; M3 typed failure kind; M4 probe bound to the driver's bytes; M5 per-step results) with refusal codes and the boundary each mechanism cannot close; the tester's 8-step procedure; the seven new gate reasons and the migration rule for v1 records; five phases each with a proof and what stays unchanged; five decisions that are the owner's; and what the design still cannot prove."
scope: ["docs/CASE-LIBRARY-BEHAVIOUR-DESIGN.md (new design document)", "plugins/test-cases/** read-only", "docs/cases/** read-only", "profile/cordis.patch.yml read-only (tester persona)", "Makefile read-only"]
---

Read the shipped acceptance layer (case runner, checks, probe-less manual path, gate, provenance, tester preset, Makefile split), compare it with the owner's four rules for cases — behaviour only, always executable, an arbitrary ordered set of operations and checks, never a direct check of code — and deliver one design document that (a) states what the harness already enforces with anchors, (b) names the defects with evidence from this tree's own case library, (c) specifies the enforcement architecture (surface + interactions, typed failure kind, probe, per-step results, the two shelves, the gate reasons), (d) gives the tester procedure the four rules imply, (e) a phased plan with a proof per phase, and (f) the decisions that belong to the owner. No product code, no case migration, no design-map change.
