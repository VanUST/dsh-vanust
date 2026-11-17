---
id: TEST-048
kind: test
title: "tool-families applies the chosen preset to the first request"
status: unverified
revision: 1
createdAt: 2026-11-17T15:52:44.606Z
updatedAt: 2026-11-17T15:52:44.606Z
authorRole: backend
caseId: tool-families-applies-the-chosen-preset-to-the-first-request
evidenceRefs: []
frozenHash: 6a38810421eb0c35dc631b18f4a532307bda0f78c4b5f9de4eaa838e1040611e
---

A session created under one preset and switched to another before its first message must get the CHOSEN preset's tool-family policy in its first request header, not the creation preset's.
