---
id: TEST-127
kind: test
title: "The architecture consultation gate fires on architectureImpact, not on the derived change class"
status: verified
revision: 3
createdAt: 2026-11-28T18:10:56.265Z
updatedAt: 2026-11-28T18:11:00.604Z
authorRole: backend
caseId: the-architecture-consultation-gate-fires-on-architectureimpa
command: "node --test plugins/orchestrator/test/architect-consult-gate.test.mjs"
evidenceRefs: [mx0q7r13-fsv3m-1:red:fail, mx0q7rxd-ih2be-1:green:pass]
frozenHash: 6d3ea86a16748d51850c99b2217a2422856af7f05d806c50342a11930ede620f
reqId: REQ-308
testPath: plugins/orchestrator/test/architect-consult-gate.test.mjs
---

REQ-308, corrected reading: delegate_task refuses a delegation that declares architectureImpact until the Analysis Record holds an ARCH- decision in decisions[], whatever changeClass it names - L2, L1, or none; a delegation without the flag is unaffected whatever its class. A change class must not be the trigger, because the record answers "L1" when the class is omitted.
