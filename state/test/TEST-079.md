---
id: TEST-079
kind: test
title: "task closes when its linked child disappeared with its process"
status: verified
revision: 4
createdAt: 2026-11-20T12:03:02.998Z
updatedAt: 2026-11-20T12:25:32.207Z
authorRole: backend
caseId: task-closes-when-its-linked-child-disappeared-with-its-proce
command: "node --test plugins/taskboard/test/dead-child-close.test.mjs"
evidenceRefs: [mwoxjvsr-adc6c-1:green:pass, mwoyciq4-hmuks-1:red:fail, mwoyco43-m4b81-1:green:pass]
frozenHash: 1d318ef62b15efe0f3df4b23960b9cf06205a741af6520c6e7097509cd26ea2e
reqId: REQ-173
testPath: plugins/taskboard/test/dead-child-close.test.mjs
---

A task whose linked child disappeared (its process died, the Host restarted, no subagent/end ever arrived) closes through the ordinary acceptance path: status done, result recorded, the child row marked settled, the role row freed, and the disappearance named - no force flag and no lost acceptance. The first read of a board in a process settles active rows whose children the runtime can prove it no longer holds.
