---
id: TEST-009
kind: test
title: "Data ownership has one canonical source"
status: verified
revision: 1
createdAt: 2026-11-17T15:52:43.749Z
updatedAt: 2026-11-17T15:52:43.749Z
authorRole: orchestrator
caseId: data-ownership-has-one-canonical-source
command: "node scripts/analysis-before-decomposition-proof.mjs"
evidenceRefs: []
frozenHash: 327c67e84a7a78702ff62073a3544a5ba809a4142d60d9da992b15b4388a13a7
testPath: scripts/analysis-before-decomposition-proof.mjs
---

Связь component ↔ data должна иметь одно каноническое направление; components[].owns не может расходиться с data ownership, а существующие корректные записи должны сохранять читаемость.
