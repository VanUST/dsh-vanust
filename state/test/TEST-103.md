---
id: TEST-103
kind: test
title: "open dependency refuses to start a task"
status: unverified
revision: 2
createdAt: 2026-11-27T14:05:18.150Z
updatedAt: 2026-11-27T14:05:21.810Z
authorRole: backend
caseId: open-dependency-refuses-to-start-a-task
command: "node --test plugins/taskboard/test/dependency-open.test.mjs"
evidenceRefs: [mwz1zzwg-ij1m5-1:green:pass]
frozenHash: cec7d2eadd2d3b8820cd086783f9b77e8f068b2d4b97f8bc26f37987ad3b6cdc
reqId: AC-1
testPath: plugins/taskboard/test/dependency-open.test.mjs
---

A task whose dependsOn names a task that is not done cannot become active through task_update nor be started by delegate_task's child link: the refusal is dependency_open, it names the task it waits for, the row stays open, and the same move passes once the dependency is done. delegate_task returns that code and message instead of a generic block.
