---
id: TEST-119
kind: test
title: "A task whose board row is absent is refused by name, not as a missing revision"
status: unverified
revision: 1
createdAt: 2026-11-28T16:49:09.983Z
updatedAt: 2026-11-28T16:49:09.983Z
authorRole: backend
caseId: a-task-whose-board-row-is-absent-is-refused-by-name-not-as-a
command: ""
evidenceRefs: []
frozenHash: 94346a9545a237f5e165527f4248473f08cb5f405b517ff2a2719a525bfe014e
reqId: REQ-136
testPath: ""
---

REQ-136: the owner changes a task status by hand in the Project state panel through the board; when the TASK names a boardId that the board does not carry, the refusal names the absent row instead of blaming a row without a revision, and a row that is on the board still changes for every status.
