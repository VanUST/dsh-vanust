---
id: TASK-092
kind: task
title: "Fix role/catalog/state contract defects"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:40.146Z
updatedAt: 2026-11-17T15:52:40.146Z
acceptance:
  - text: "Role identity is a stable (role,preset) pair; a role label cannot silently switch presets and AUDIT is no longer ambiguous (split to REVIEWER/CRITIC)."
    done: false
  - text: "New custom roles require an explicit valid preset; legacy preset-less roles are marked unusable/legacy and excluded from reuse/catalog (history retained)."
    done: false
  - text: "Task/catalog reconciliation closes or blocks active tasks whose child ended in error, without touching genuinely running children."
    done: false
  - text: "Per-role context no longer exposes tools a role should not have where feasible; remaining host-wide tools are explicit and measured."
    done: false
  - text: "A migration is idempotent, backed up, and applied to autolabel_pipeline with counts before/after; no completed/cancelled task data lost."
    done: false
  - text: "make verify, test cases/regressions and real UI/second-server evidence pass; docs updated."
    done: false
boardId: task-mwc5e85w-e52p1d
nonScope: ["Do not delete task history or rewrite completed task outcomes.", "Do not break existing correct seven-preset roles.", "Do not kill running autolabel agents; access live board only with safe backup/lock-aware tool.", "No live harness restart; proof on a second server/profile."]
owner:
  kind: agent
  label: BACKEND
  sessionId: 1a81a4cf-cb96-4921-984d-7348bb53aed4
ownerRole: BACKEND
preset: backend
resultEvidence: ["node scripts/taskboard-role-proof.mjs: 15/15 exit 0; same proof against HEAD pre-fix modules: 4/15 exit 1", "scripts/taskboard-migrate.mjs applied to ~/tasks/autolabel_pipeline revision 1936->1937, backup taskboard-2026-11-11T13-28-41-725Z-r1936.json; tasks 225->225 done 211/cancelled 5 unchanged; second run changed:false; survived to revision 2015 with all 233 tasks intact", "Board after migration: BACKEND backend, DESIGN ux, RESEARCH research, CRITIC critic, REVIEWER reviewer; 4 preset-less rows marked legacy; AUDIT absent from agents", "Second server :3081 Playwright read migrated board: 225/225, workspace role chips BACKEND/CRITIC/REVIEWER, task detail role DESIGN ux", "case stable-role-identity-and-task-reconciliation: verified rev6, testPath scripts/taskboard-role-proof.mjs, red/green evidence recorded; case_drift checked 1 no findings", "make verify exit 0 (17/17 packaging + documentation); node --test docs/cases/tests/case-library.test.mjs exit 0"]
resultSummary: "Role labels are now stable (name,preset) identities: the ledger refuses a silent preset switch, AUDIT is rejected and the board split into REVIEWER/CRITIC, and preset-less roles are explicitly legacy and non-reusable. Failed children block their task, with a reconcile pass that settles only provably idle active rows. The real autolabel_pipeline board was backed up, migrated idempotently with no task loss (225->225, terminal counts unchanged), and verified on a second server. 15/15 contract checks pass and go red 4/15 against pre-fix code; host-wide MCP inheritance remains measured and documented rather than silently changed."
role: BACKEND
scope: ["plugins/orchestrator/ and taskboard role/catalog/state logic", "profile presets/tool placement where needed for role isolation", "scripts/ workspace migration/reconciliation helper", "autolabel_pipeline taskboard metadata (backup first, no history loss)", "docs/rules and tests/proofs"]
sessions:
  - sessionId: 1a81a4cf-cb96-4921-984d-7348bb53aed4
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Fix the role/taskboard defects found in autolabel_pipeline: arbitrary role labels silently borrowing presets, duplicate role labels with different presets, ambiguous AUDIT mapping, legacy preset-less roles still offered for reuse, stale active tasks after child errors, and host-wide tool leakage that flattens role tool sets. Add migration/reconciliation and prove on a disposable workspace plus the real autolabel board without losing task history.

Migrated from .dsh/taskboard.json (task task-mwc5e85w-e52p1d, revision 9).
