---
id: TEST-001
kind: test
title: "A child session serves one task"
status: stale
revision: 1
createdAt: 2026-11-17T15:52:43.547Z
updatedAt: 2026-11-17T15:52:43.547Z
authorRole: orchestrator
caseId: a-child-session-serves-one-task
command: "node scripts/taskboard-lease-proof.mjs"
evidenceRefs: []
frozenHash: 44a0f533e6d0638ddc5319023cb5caa8f6cf69e4db48b2659a2fe738e4b48a2f
testPath: scripts/taskboard-lease-proof.mjs
---

One child session serves one task at a time: handing it to a second task must transfer the lease so the first task can no longer stop it, a role whose session is still running must not receive a second brief, and a root agent must be able to write another chat's task on purpose without widening that right to children.
