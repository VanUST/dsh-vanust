---
id: TEST-038
kind: test
title: "PTC switch on a resumed session fails with defer_loading"
status: stale
revision: 1
createdAt: 2026-11-17T15:52:44.377Z
updatedAt: 2026-11-17T15:52:44.377Z
authorRole: orchestrator
caseId: ptc-switch-on-a-resumed-session-fails-with-defer-loading
evidenceRefs: []
frozenHash: 6a38810421eb0c35dc631b18f4a532307bda0f78c4b5f9de4eaa838e1040611e
---

Смена презентации инструментов у существующей сессии (native→ptc) не должна ломать её следующий запрос: поверхность из одного run_code обязана оставаться вызываемой.
