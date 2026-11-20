---
id: TEST-082
kind: test
title: "make test runs the kit's tests and stops on the first failure"
status: unverified
revision: 1
createdAt: 2026-11-20T12:09:41.502Z
updatedAt: 2026-11-20T12:09:41.502Z
authorRole: backend
caseId: make-test-runs-the-kit-s-tests-and-stops-on-the-first-failur
command: ""
evidenceRefs: []
frozenHash: 5398670b29336428aea9ef9e10f5c98a788f80008817656b9438ca71f19f1e5c
reqId: REQ-177
testPath: ""
---

The kit has one entry to the checks that execute it: make test runs every plugin test file (and the files under scripts/test) through node --test, then every scripts/*-proof.mjs, in path order, one process each; the first non-zero exit stops the run with a non-zero status, and ONLY=<substring> runs a subset.
