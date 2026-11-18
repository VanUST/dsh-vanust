---
id: TEST-004
kind: test
title: "Analysis reports all validation errors"
status: verified
revision: 2
createdAt: 2026-11-17T15:52:43.630Z
updatedAt: 2026-11-18T13:02:05.693Z
authorRole: orchestrator
caseId: analysis-reports-all-validation-errors
command: "node scripts/analysis-before-decomposition-proof.mjs"
evidenceRefs: [mwm4ry3m-07o4o-1:green:pass]
frozenHash: 327c67e84a7a78702ff62073a3544a5ba809a4142d60d9da992b15b4388a13a7
reqId: ""
testPath: scripts/analysis-before-decomposition-proof.mjs
---

Несколько независимых ошибок Analysis Record должны возвращаться одним списком за один вызов, без серии fail-fast раундов и без частичной записи.
