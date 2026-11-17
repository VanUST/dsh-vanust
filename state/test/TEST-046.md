---
id: TEST-046
kind: test
title: "Subagents are chat-scoped"
status: stale
revision: 1
createdAt: 2026-11-17T15:52:44.560Z
updatedAt: 2026-11-17T15:52:44.560Z
authorRole: orchestrator
caseId: subagents-are-chat-scoped
command: "node scripts/taskboard-chat-scope-proof.mjs"
evidenceRefs: []
frozenHash: 4f72b10112846e0008707bc08949d61f7dd81207f2e0e4d86ba4ac18ffd82a6b
testPath: scripts/taskboard-chat-scope-proof.mjs
---

Новая сессия/чат не должна вызывать или переиспользовать sleeping subagent, созданного другой сессией; для каждой новой сессии роли получают новые контексты.
