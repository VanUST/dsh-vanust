---
id: TEST-104
kind: test
title: "dependsOn is expressible through the task tools and blocks the start"
status: unverified
revision: 2
createdAt: 2026-11-27T14:07:24.167Z
updatedAt: 2026-11-27T14:07:26.916Z
authorRole: backend
caseId: dependson-is-expressible-through-the-task-tools-and-blocks-t
command: "node --test plugins/taskboard/test/dependency-open.test.mjs"
evidenceRefs: [mwz22oba-zun2t-1:green:pass]
frozenHash: cec7d2eadd2d3b8820cd086783f9b77e8f068b2d4b97f8bc26f37987ad3b6cdc
reqId: AC-1
testPath: plugins/taskboard/test/dependency-open.test.mjs
---

A caller can express order on the board: task_create and task_update declare dependsOn, the update writes it to the row, and a task whose dependency is not done cannot become active (dependency_open naming the task it waits for) until that dependency is done.
