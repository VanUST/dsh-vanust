---
id: TEST-030
kind: test
title: "Orchestrator traces requirements through system design"
status: verified
revision: 1
createdAt: 2026-11-17T15:52:44.195Z
updatedAt: 2026-11-17T15:52:44.195Z
authorRole: orchestrator
caseId: orchestrator-traces-requirements-through-system-design
command: "node scripts/analysis-before-decomposition-proof.mjs"
evidenceRefs: []
frozenHash: 1faf4e3079ab2455bb2b4a0751b5ccd13de9d99e54270f5446a4ddfff669a2c7
testPath: scripts/analysis-before-decomposition-proof.mjs
---

Для нетривиального бизнес-запроса root-оркестратор должен до декомпозиции связать бизнес-результат, процесс, требования, глобальную архитектуру, системные контракты, задачи и последующие доказательства. Изменение требования должно запускать impact analysis, а не просто создавать ещё одну задачу.
