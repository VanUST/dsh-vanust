---
id: TEST-105
kind: test
title: "A task closes on its child completion event without an extra save"
status: verified
revision: 22
createdAt: 2026-11-28T11:09:30.166Z
updatedAt: 2026-11-28T12:49:49.960Z
authorRole: tester
caseId: a-task-closes-on-its-child-completion-event-without-an-extra
command: "node --test --test-name-pattern=AC-1 test/write-integrity.test.mjs"
evidenceRefs: [mx0b6qkb-6i8w8-1:red:fail, mx0bfq1f-g7hf0-1:red:fail, mx0bn14k-51350-1:red:fail, mx0btux8-ul9dm-1:red:fail, mx0by9oz-zearv-1:red:fail, mx0cazbm-3xh2m-1:green:pass, mx0d42q2-ka2e3-1:green:pass, mx0d4svi-9uadi-1:red:fail, mx0d53cz-410po-1:green:pass, mx0e3701-7r1p5-1:red:fail, mx0e3aze-6v8ts-1:red:fail, mx0e7qo7-kt1lm-1:green:pass, mx0e84l6-n92on-1:red:fail, mx0e8ay1-os5ph-1:green:pass, mx0eqqoc-ldfnn-1:green:pass]
frozenHash: 6193fb9c6b9f3f0767c90076950409c8fe8d5b7a04d154cd00842543b80f7a93
reqId: REQ-293
testPath: test/write-integrity.test.mjs
---

REQ-293: a legal subagent finish and the task close need no save just to refresh the verification record. AC-1: create a task, link a subagent, receive its result through the completion event and close with a result and evidence without an extra task_update; after reopening the task stays closed.
