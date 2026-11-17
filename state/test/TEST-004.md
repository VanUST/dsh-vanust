---
id: TEST-004
kind: test
title: "Analysis reports all validation errors"
status: verified
revision: 1
createdAt: 2026-11-17T15:52:43.630Z
updatedAt: 2026-11-17T15:52:43.630Z
authorRole: orchestrator
caseId: analysis-reports-all-validation-errors
command: "node scripts/analysis-before-decomposition-proof.mjs"
evidenceRefs: []
frozenHash: 327c67e84a7a78702ff62073a3544a5ba809a4142d60d9da992b15b4388a13a7
testPath: scripts/analysis-before-decomposition-proof.mjs
---

Несколько независимых ошибок Analysis Record должны возвращаться одним списком за один вызов, без серии fail-fast раундов и без частичной записи.
