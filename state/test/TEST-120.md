---
id: TEST-120
kind: test
title: "A register TASK with no board row is adopted from the TASK, at revision 1, idempotently"
status: unverified
revision: 1
createdAt: 2026-11-28T16:55:26.817Z
updatedAt: 2026-11-28T16:55:26.817Z
authorRole: backend
caseId: a-register-task-with-no-board-row-is-adopted-from-the-task-a
command: ""
evidenceRefs: []
frozenHash: 94346a9545a237f5e165527f4248473f08cb5f405b517ff2a2719a525bfe014e
reqId: REQ-136
testPath: ""
---

REQ-136 (also REQ-138): a TASK whose boardId has no row on the board is reported with the fields needed to adopt it, and with --write the row is created again from the TASK at revision 1 through the board journal and lock; a second run writes nothing and the owner can change that status in the panel.
