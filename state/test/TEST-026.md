---
id: TEST-026
kind: test
title: "Orchestrator can stop a linked specialist"
status: unverified
revision: 1
createdAt: 2026-11-17T15:52:44.110Z
updatedAt: 2026-11-17T15:52:44.110Z
authorRole: orchestrator
caseId: orchestrator-can-stop-a-linked-specialist
evidenceRefs: []
frozenHash: 4c93c80719f5de56e031d83b51bfab9e94250321b12f08a2e72a12048d758b49
---

Cancelling a task, pausing it, closing it or an explicit forced stop must actually interrupt its linked subagent through the documented ctx.subagents authority; a refused interrupt leaves the task in its previous state.
