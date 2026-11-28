---
id: TEST-126
kind: test
title: "A delegation that declares architectureImpact is refused until the record carries an ARCH- decision, whatever the class says"
status: verified
revision: 6
createdAt: 2026-11-28T18:10:23.772Z
updatedAt: 2026-11-28T18:40:16.444Z
authorRole: backend
caseId: a-delegation-that-declares-architectureimpact-is-refused-unt
command: "node --test plugins/orchestrator/test/architect-consult-gate.test.mjs"
evidenceRefs: [mx0q71t9-pxu5f-1:red:fail, mx0q72pm-vmi8l-1:green:fail, mx0r99zc-hjzvo-1:red:fail, mx0r9es1-hmqks-1:green:pass]
frozenHash: 6d3ea86a16748d51850c99b2217a2422856af7f05d806c50342a11930ede620f
reqId: REQ-308
testPath: plugins/orchestrator/test/architect-consult-gate.test.mjs
---

REQ-308: a delegation that declares architectureImpact does not start without the architect's decision (an ARCH- entry in the Analysis Record decisions[]); the flag decides, not the derived class, so an omitted changeClass or changeClass L1 with the flag is refused too; L0, L1 and L2 without the flag are unaffected.
