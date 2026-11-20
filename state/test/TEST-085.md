---
id: TEST-085
kind: test
title: "A run records the directory it happened in"
status: verified
revision: 3
createdAt: 2026-11-20T14:57:40.096Z
updatedAt: 2026-11-20T14:58:05.647Z
authorRole: backend
caseId: a-run-records-the-directory-it-happened-in
command: "node --test plugins/test-cases/test/run-cwd-pinned.test.mjs"
evidenceRefs: [mwp3sjgh-x552q-1:red:fail, mwp3suh0-l2emt-1:green:pass]
frozenHash: 3d3f759102e8f515bad789cd801cb6425ba0e5998a12b2a5e8ef3e99f93d8fd7
reqId: REQ-180
testPath: plugins/test-cases/test/run-cwd-pinned.test.mjs
---

A recorded red names the tree it was observed in: case_run takes cwd (absolute or workspace-relative, default the session workspace) and stores cwd and cwdRelative with the run, case_verify records the directory of the observation, and case_get shows both (REQ-180).
