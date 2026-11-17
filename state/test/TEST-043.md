---
id: TEST-043
kind: test
title: "Small changes skip heavy analysis"
status: verified
revision: 1
createdAt: 2026-11-17T15:52:44.491Z
updatedAt: 2026-11-17T15:52:44.491Z
authorRole: orchestrator
caseId: small-changes-skip-heavy-analysis
command: "node scripts/analysis-before-decomposition-proof.mjs"
evidenceRefs: []
frozenHash: 327c67e84a7a78702ff62073a3544a5ba809a4142d60d9da992b15b4388a13a7
testPath: scripts/analysis-before-decomposition-proof.mjs
---

Глобальный архитектурный контекст должен учитываться пропорционально: вопрос или локальное L0 исправление не требует полного Analysis Record, тогда как L1/L2 изменения обязаны пройти analysis gate.
