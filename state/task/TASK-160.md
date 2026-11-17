---
id: TASK-160
kind: task
title: "Case library P0–P2: honest schema, runner, typed checks"
status: done
revision: 1
createdAt: 2026-11-17T15:52:41.213Z
updatedAt: 2026-11-17T15:52:41.213Z
boardId: task-mwjdy4ze-gurp5m
---

Turn @cc/dsh-test-cases from a record-only library into an executing one: fix the drift/tool-count/provenance defects, add `case_run` that executes the stored command through an injected executor with run artifacts, a CASE_SUMMARY measurement contract, typed checks (metric/count/hash/exit) with comparators, repeats with median/p95, baseline ratchet, flaky status, and a measured negative-control red. Manual verification stays but is stamped as reported.

Migrated from .dsh/taskboard.json (task task-mwjdy4ze-gurp5m, revision 3).
