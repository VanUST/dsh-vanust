---
id: TASK-085
kind: task
title: "Build test-cases host service"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:40.053Z
updatedAt: 2026-11-17T15:52:40.053Z
acceptance:
  - text: "@cc/dsh-test-cases exposes case_record, case_update, case_verify, case_list, case_get, case_supersede, case_deprecate plus a drift check; validated schema and stable refusal codes."
    done: false
  - text: "Case ids are strictly validated and every read/write is contained under docs/cases; wrong record ids and traversal refusals return stable values, never throws."
    done: false
  - text: "Cases persist in docs/cases/ with revision/history, source, status and automation fields; drift changes always bump revision/updatedAt and repeated drift is idempotent."
    done: false
  - text: "Automated true passed verification ALWAYS requires matching redFirst and green evidence; degraded/missing-test cases cannot be re-verified by observation, and toggling automation resets verification."
    done: false
  - text: "case_drift isolates malformed records into findings instead of aborting the sweep; update/verify validation covers empty fields, documented exit codes and command binding."
    done: false
  - text: "Role policy fails closed for unknown presets while preserving the deliberate preset-less policy."
    done: false
  - text: "Real proof creates a red/green automated case and documented-only case, exercises traversal, red-gate, CAS, drift idempotence and malformed-file isolation; plugin packed/versioned and make verify 0."
    done: false
boardId: task-mwc195wr-ycqcmi
nonScope: ["Do not build the client panel in this task; UX/UI will implement it against the host contract.", "No test runner/framework vendor and no CI.", "No automatic deletion or rewrite of existing tests/docs.", "No live :3080 profile changes/restart during proof.", "No edits to code-search benchmark evidence or design-map work."]
owner:
  kind: agent
  label: BACKEND
  sessionId: 913d5bfc-967b-4ad7-b79e-16f378fa25a8
ownerRole: BACKEND
preset: backend
resultEvidence: ["plugins/test-cases/test-cases.mjs, lib/schema.mjs, README.md; packed cc-dsh-test-cases-0.1.7.tgz", "docs/cases: automated verified case, documented-only stale case, red/green test and fixture", "Reviewer re-run: traversal refusals, symlink containment, TEST_REQUIRED degraded case, COMMAND_MISMATCH/EVIDENCE_NOT_GREEN, drift rev-once, malformed finding", "orchestrator receives case_record/list/get/drift only; tester presets all eight; unknown preset zero", "node --test docs/cases/tests/case-library.test.mjs: 4 pass, 0 fail", "make verify exit 0 after final packaging"]
resultSummary: "Delivered and hardened @cc/dsh-test-cases: eight role-aware tools over persistent docs/cases records. Review found and fixes closed path traversal/write escape, red-first bypass, command-binding, documented exit-code, drift revision/idempotence, malformed-file isolation, unknown-preset fail-open and attribution defects. Automated and documented-only cases, real red/green evidence, drift, CAS and role-specific orchestrator intake are all in source and packaged."
role: BACKEND
scope: [plugins/test-cases/, docs/cases/, profile/cordis.patch.yml, plugins/inventory.json, "plugins/orchestrator/orchestrator.mjs and role presets only where required for intake/access policy", "rules/ and skill wording for no speculative tests", README.md/USERGUIDE.md/DEPLOYMENT.md, reports/test-cases/]
sessions:
  - sessionId: 913d5bfc-967b-4ad7-b79e-16f378fa25a8
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Implement @cc/dsh-test-cases host package and persistent docs/cases library with schema-enforced writer/read/verify tools, compare-and-set edits, supersede/deprecate history, automated red-first and documented-only cases, drift detection, orchestrator intake policy, role-aware availability, profile/inventory/docs integration and real proof.

Migrated from .dsh/taskboard.json (task task-mwc195wr-ycqcmi, revision 10).
