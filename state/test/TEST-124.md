---
id: TEST-124
kind: test
title: "An L2 delegation with architectureImpact is refused until the record carries an ARCH- decision"
status: verified
revision: 3
createdAt: 2026-11-28T17:37:09.870Z
updatedAt: 2026-11-28T17:37:21.703Z
authorRole: backend
caseId: an-l2-delegation-with-architectureimpact-is-refused-until-th
command: "node --test plugins/orchestrator/test/architect-consult-gate.test.mjs"
evidenceRefs: [mx0p0dzj-wsntq-1:red:fail, mx0p0i4i-x78rw-1:green:pass]
frozenHash: 6d3ea86a16748d51850c99b2217a2422856af7f05d806c50342a11930ede620f
reqId: REQ-308
testPath: plugins/orchestrator/test/architect-consult-gate.test.mjs
---

REQ-308 (AC-1..AC-3): an L2 change that declares architectureImpact does not start without the architect's decision recorded in the Analysis Record; the refusal carries a code and says what to write; the same delegation with the decision passes; L0, L1 and L2 without architectureImpact are unaffected.
