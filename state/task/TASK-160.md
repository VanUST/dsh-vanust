---
id: TASK-160
kind: task
title: "Case library P0–P2: honest schema, runner, typed checks"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.213Z
updatedAt: 2026-11-17T15:52:41.213Z
acceptance:
  - text: "driftFor flags only verified/failing/flaky cases; an unverified case with changed surface stays unverified"
    done: false
  - text: "a real run writes docs/cases/runs/<id>/<runId>/ with stdout/stderr/summary/artifacts and the case stores a measured run with command hash and head"
    done: false
  - text: "a declared check (p95 <= 250, axe <= 0, hash ==) is evaluated from the driver summary; a missing metric fails, not passes"
    done: false
  - text: "repeats produce median/p95 and a mixed outcome is flaky; a baseline can only be set from a passing run and a band regression fails"
    done: false
  - text: "a negative control produces a measured red and a green run on a case with that red becomes verified"
    done: false
  - text: "manual evidence is stamped manual and never presented as a runner measurement"
    done: false
  - text: "node --test plugins/test-cases/test/runner.test.mjs passes on the real spawn path"
    done: false
boardId: task-mwjdy4ze-gurp5m
inline: true
nonScope: ["The panel, suite, gate, CLI and taskboard coupling (task 2)", "P4 worktree red and migrating documented-only cases", "Changing existing docs/cases records", "Touching the live :3080 profile"]
resultEvidence: ["node --test plugins/test-cases/test/runner.test.mjs -> 12/12 pass (metric threshold, metric_missing, hash, flaky, baseline band, timeout, negative-control red, CLI suite/gate)", "node --test plugins/test-cases/test/runner.test.mjs docs/cases/tests/case-library.test.mjs -> 17/17 pass", "packed 0.1.11/0.1.12 tool path: case_run green -> needsRed true, status unverified; mode red -> control exit 1, redFirst source negative-control; green -> verified, lastVerified source runner", "real a11y case checked serious=0 violations=0; real benchmark checked failures=0 checks=47 wall 84 ms; artifacts docs/cases/runs/panel-accessibility-stays-clean-under-axe/*/{axe.json,page.png}", "run.json carries commandSha256, head and dirty per run; the case keeps the last 20 runs with metrics/checks/artifacts", "drift fix proven: an unverified case with a changed surface reports changedFiles but status stays null (runner test + docs/cases/tests/case-library.test.mjs)"]
resultSummary: "Implemented P0-P2 of the case-library design: drifitFor no longer marks an unverified case stale; the plugin now has a runner (lib/runner.mjs) that executes the STORED runCommand through ctx.shell when mounted (spawn fallback) and records exit code, duration, commandSha256, head/dirty, stdout/stderr, the driver CASE_SUMMARY, evaluated checks and hashed artifacts under docs/cases/runs/; lib/checks.mjs evaluates metric/count/hash/exit checks (a missing metric fails), aggregates median/p95 over 1-5 runs, records a mixed outcome as flaky, and supports a baseline ratchet with a band seeded only from a passing run; case_run/case_verify separate measured from reported evidence; a measured red is the driver negative control (CASE_NEGATIVE_CONTROL must fail). 12 runner tests pass and the packed tool path was exercised end to end."
scope: ["plugins/test-cases/lib/store.mjs, lib/checks.mjs, lib/runner.mjs (new)", "plugins/test-cases/test-cases.mjs (tools, role policy, prompt, commands)", "plugins/test-cases/lib/schema.mjs (drift fix, statuses)", "plugins/test-cases/test/runner.test.mjs (new)", "docs/cases/tests/case-library.test.mjs (drift expectations)"]
---

Turn @cc/dsh-test-cases from a record-only library into an executing one: fix the drift/tool-count/provenance defects, add `case_run` that executes the stored command through an injected executor with run artifacts, a CASE_SUMMARY measurement contract, typed checks (metric/count/hash/exit) with comparators, repeats with median/p95, baseline ratchet, flaky status, and a measured negative-control red. Manual verification stays but is stamped as reported.

Migrated from .dsh/taskboard.json (task task-mwjdy4ze-gurp5m, revision 3).
