---
id: TEST-084
kind: test
title: "Case surface per role matches the README table"
status: verified
revision: 3
createdAt: 2026-11-20T14:57:39.131Z
updatedAt: 2026-11-20T14:58:03.500Z
authorRole: backend
caseId: case-surface-per-role-matches-the-readme-table
command: "node --test plugins/test-cases/test/policy-docs.test.mjs"
evidenceRefs: [mwp3shzr-7vl9z-1:red:fail, mwp3stcc-omfwx-1:green:pass]
frozenHash: 68eed192e472b51874f7588a4bcbe78cdd38234a30f5e0c8f63ec23405309210
reqId: REQ-179
testPath: plugins/test-cases/test/policy-docs.test.mjs
---

The owner of a case can repair it and the observer can record an observation: backend gets case_update and case_verify, reviewer gets case_verify but never case_update, and the README table plus the role's prompt section name exactly the verbs its policy row carries (REQ-179, REQ-182).
