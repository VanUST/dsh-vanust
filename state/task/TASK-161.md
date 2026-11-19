---
id: TASK-161
kind: task
title: "Case library P3: suite, close gate, panel, CLI, docs"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.231Z
updatedAt: 2026-11-17T15:52:41.231Z
boardId: task-mwjdy8bz-0azu7z
inline: true
nonScope: ["Changing the runner/check semantics defined by task 1", "Restarting the live :3080 or editing the installed profile", "Migrating existing documented-only cases (P4)", "Making `make verify` depend on the whole suite (it stays a separate `make cases` target)"]
resultEvidence: ["node plugins/test-cases/bin/cases.mjs suite --tag a11y -> checked 1, verified 1, report docs/cases/runs/suites/suite-mwjeanz3-uj0he.json, exit 0", "node plugins/test-cases/bin/cases.mjs gate --id design-map-readable-no-label-over-a-node-audit-can-fail -> blocked (unverified), exit 1; gate --id panel-accessibility-stays-clean-under-axe -> green, exit 0", "packed taskboard 0.1.55 proof: service.close with a linked failing case -> ok:false code cases_not_green and the task stays in review; a clean task closes done; closeMany reports the gated row separately and leaves it in review", "make verify -> 17/17 portability + documentation ok; node scripts/tool-families-proof.mjs -> 47/47", "packed test-cases 0.1.12 imported with the dsh-tools symlink: case_get verified/runner, case_run verified, case_gate blocks the unverified designmap case", "two real cases recorded and measured: docs/cases/panel-accessibility-stays-clean-under-axe.json (axe metrics, axe.json+page.png artifacts) and docs/cases/tool-families-proof-stays-under-its-budget.json (failures=0, checks=47, wall 84 ms)"]
resultSummary: "Implemented P3: case_suite runs a filtered set, records each case and writes docs/cases/runs/suites/<id>.json; case_gate exposes the read-only verdict (also in the orchestrator intake); the plugin provides ctx.provide('cases', {gateForTask}) and the taskboard refuses task_close with cases_not_green while a linked AUTOMATED case is not verified (batch rows partial, refused task stays in review, fail closed on an unreadable library); the panel gained a Run action, measured-run/check/artifact rendering, provenance badges and a flaky label; bin/cases.mjs + `make cases` give the CLI/CI entry (run/suite/gate, exit codes); docs, package files and tarballs updated and repacked (test-cases 0.1.12, taskboard 0.1.55)."
scope: ["plugins/test-cases/bin/cases.mjs (new CLI)", "plugins/test-cases/client.js (Run action, run/check rendering, flaky label)", "plugins/test-cases/test-cases.mjs (case_suite, case_gate, cases service, commands)", "plugins/taskboard/taskboard.mjs (optional close gate via ctx.get('cases'))", "Makefile (cases target)", "docs/cases/README.md, plugin READMEs, DEPLOYMENT row, package.json versions, .gitignore"]
---

Make the executed library consumable: `case_suite` runs a filtered set and writes a report, `case_gate` exposes a read-only verdict, the taskboard refuses `task_close` while a linked automated case is not verified, the panel gets a Run action and run/check rendering, a CLI (`bin/cases.mjs`) plus `make cases` gives a CI/dev entry, and all docs/packages are updated and repacked.

Migrated from .dsh/taskboard.json (task task-mwjdy8bz-0azu7z, revision 3).
