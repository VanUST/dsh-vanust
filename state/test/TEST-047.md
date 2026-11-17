---
id: TEST-047
kind: test
title: "Taskboard batch close with result in one call"
status: unverified
revision: 1
createdAt: 2026-11-17T15:52:44.583Z
updatedAt: 2026-11-17T15:52:44.583Z
authorRole: orchestrator
caseId: taskboard-batch-close-with-result-in-one-call
evidenceRefs: []
frozenHash: 4c93c80719f5de56e031d83b51bfab9e94250321b12f08a2e72a12048d758b49
---

The owner can accept a batch of review tasks in one task_close call, supplying the result and evidence in that same call; a close fills missing result fields and never rewrites a summary already recorded, and every refusal is reported per task.
