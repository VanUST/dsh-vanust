---
id: TEST-024
kind: test
title: "Повтор запроса после MALFORMED_RESPONSE"
status: unverified
revision: 1
createdAt: 2026-11-17T15:52:44.072Z
updatedAt: 2026-11-17T15:52:44.072Z
authorRole: orchestrator
caseId: malformed-response
evidenceRefs: []
frozenHash: 6a38810421eb0c35dc631b18f4a532307bda0f78c4b5f9de4eaa838e1040611e
---

Ответ модели с невалидным JSON аргументов инструмента не должен завершать ход: маршрут модели повторяет такой ответ в пределах бюджета, и работа продолжается.
