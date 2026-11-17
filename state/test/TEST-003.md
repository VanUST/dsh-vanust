---
id: TEST-003
kind: test
title: "Analysis rejects unknown nested fields"
status: verified
revision: 1
createdAt: 2026-11-17T15:52:43.612Z
updatedAt: 2026-11-17T15:52:43.612Z
authorRole: orchestrator
caseId: analysis-rejects-unknown-nested-fields
command: "node scripts/analysis-before-decomposition-proof.mjs"
evidenceRefs: []
frozenHash: 327c67e84a7a78702ff62073a3544a5ba809a4142d60d9da992b15b4388a13a7
testPath: scripts/analysis-before-decomposition-proof.mjs
---

Analysis Record не должен молча выбрасывать неизвестные nested-поля или превращать неверный contract enum в пустое значение. Пустые обязательные решения также недопустимы.
