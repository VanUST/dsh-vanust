---
id: TEST-045
kind: test
title: "Stable role identity and task reconciliation"
status: stale
revision: 1
createdAt: 2026-11-17T15:52:44.537Z
updatedAt: 2026-11-17T15:52:44.537Z
authorRole: orchestrator
caseId: stable-role-identity-and-task-reconciliation
command: "node scripts/taskboard-role-proof.mjs"
evidenceRefs: []
frozenHash: 94e6b3bad6650e9deab12a41b2fd2b20b34fbdf7f0cf7502c20066ac412fce4a
testPath: scripts/taskboard-role-proof.mjs
---

In autolabel_pipeline and every workspace, a delegated role must have one explicit valid preset, the orchestrator must not offer ambiguous or preset-less legacy roles for reuse, and an active task whose child ended in error must not remain silently active.
