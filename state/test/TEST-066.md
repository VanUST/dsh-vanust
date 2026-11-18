---
id: TEST-066
kind: test
title: register-batch-rule-is-closed
status: verified
revision: 3
createdAt: 2026-11-18T13:06:56.574Z
updatedAt: 2026-11-18T13:07:02.021Z
authorRole: BACKEND
caseId: register-batch-rule-is-closed
command: "node --test plugins/test-cases/test/register-closure.test.mjs"
evidenceRefs: [mwm4yb9f-gdkvj-1:red:fail, mwm4yc4p-jxkmw-1:green:pass]
frozenHash: 233e8af45a6d99632e3b890d190ce180a37d2abe590f9cb884f98eb7ad32154c
reqId: REQ-121
testPath: plugins/test-cases/test/register-closure.test.mjs
---

The batch rule is closed in the register, not only in the analysis record: state/req/REQ-103.md carries status done (the analysis mirror of project-state-ecosystem FR15) and state/task/TASK-226.md carries status done with REQ-103 in its reqIds, so the board row and the requirement agree.
