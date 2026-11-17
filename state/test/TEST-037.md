---
id: TEST-037
kind: test
title: "PTC preset uses one run_code on fresh sessions"
status: unverified
revision: 1
createdAt: 2026-11-17T15:52:44.354Z
updatedAt: 2026-11-17T15:52:44.354Z
authorRole: orchestrator
caseId: ptc-preset-uses-one-run-code-on-fresh-sessions
evidenceRefs: []
frozenHash: 6a38810421eb0c35dc631b18f4a532307bda0f78c4b5f9de4eaa838e1040611e
---

Пресет, смонтировавший tool-executor-ptc, в свежей сессии видит один run_code и выполняет задачу через вложенные вызовы; остальные пресеты и корень остаются native.
