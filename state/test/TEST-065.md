---
id: TEST-065
kind: test
title: "One case may prove a batch of requirements"
status: verified
revision: 3
createdAt: 2026-11-18T13:00:18.939Z
updatedAt: 2026-11-18T13:00:28.124Z
authorRole: BACKEND
caseId: one-case-may-prove-a-batch-of-requirements
command: "node --test plugins/test-cases/test/batch-gate.test.mjs"
evidenceRefs: [mwm4ptsn-khcwg-1:red:fail, mwm4pw9e-x4sr5-1:green:pass]
frozenHash: 7fef67accd8bc050c8b9093a45187702263ce2665cc22298d6d80ef71567a791
reqId: REQ-120
testPath: plugins/test-cases/test/batch-gate.test.mjs
---

The case policy says one case per accepted behaviour and allows one verified run to prove several requirements while the case keeps its primary reqId; case_gate passes a task covering three reqIds behind one verified automated case and still blocks an unverified one, with the case schema unchanged.
