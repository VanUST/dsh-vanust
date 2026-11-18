---
id: TEST-063
kind: test
title: "Root policy is common plus orchestrator part"
status: verified
revision: 3
createdAt: 2026-11-18T13:00:17.932Z
updatedAt: 2026-11-18T13:00:25.994Z
authorRole: BACKEND
caseId: root-policy-is-common-plus-orchestrator-part
command: "node --test plugins/orchestrator/test/policy-gating.test.mjs"
evidenceRefs: [mwm4pseu-3no3r-1:red:fail, mwm4puk7-yig4g-1:green:pass]
frozenHash: 7972f8018aa8d7f90c6a71b816832c1dca2916f44ff5cdda2f530b4358cc436e
reqId: REQ-118
testPath: plugins/orchestrator/test/policy-gating.test.mjs
---

Every root agent reads the common working policy (Batch the work, Answering is not work, Report once), while the orchestrator-specific part (roles, delegation rules, the task ledger claim) is rendered only for the orchestrator preset; a delegated child gets only CHILD_POLICY.
