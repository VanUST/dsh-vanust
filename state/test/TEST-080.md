---
id: TEST-080
kind: test
title: "two processes writing one board lose no task"
status: verified
revision: 4
createdAt: 2026-11-20T12:03:03.386Z
updatedAt: 2026-11-20T12:25:34.709Z
authorRole: backend
caseId: two-processes-writing-one-board-lose-no-task
command: "node --test plugins/taskboard/test/board-lock.test.mjs"
evidenceRefs: [mwoxjxcv-pkqcy-1:green:pass, mwoycjxx-fygl5-1:red:fail, mwoycp9a-rp9am-1:green:pass]
frozenHash: 1ed35329086e9c8bfb1251198baeaacbeb8b8714a24a30d88a90954bf9b68bc9
reqId: REQ-174
testPath: plugins/taskboard/test/board-lock.test.mjs
---

The board file has one writer at a time across processes: the read-modify-write holds a directory lock with a wait and a stale takeover, so two processes that create tasks into the same .dsh/taskboard.json both land every row, and no lock is left behind.
