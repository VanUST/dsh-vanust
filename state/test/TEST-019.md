---
id: TEST-019
kind: test
title: "Disable taskboard actionable cap"
status: stale
revision: 1
createdAt: 2026-11-17T15:52:43.970Z
updatedAt: 2026-11-17T15:52:43.970Z
authorRole: orchestrator
caseId: disable-taskboard-actionable-cap
command: "node scripts/taskboard-limit-proof.mjs"
evidenceRefs: []
frozenHash: 62a8d84f60d5d19f971c267f8e89260246e7d54e18576089d4d087e31eb2e2d9
testPath: scripts/taskboard-limit-proof.mjs
---

Убрать hard block на 200 задач глобально по workspace: количество actionable задач не должно мешать созданию новой задачи.
