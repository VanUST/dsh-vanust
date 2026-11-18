---
id: TEST-064
kind: test
title: "Analysis policy names the L0 local edit"
status: verified
revision: 3
createdAt: 2026-11-18T13:00:18.230Z
updatedAt: 2026-11-18T13:00:27.136Z
authorRole: BACKEND
caseId: analysis-policy-names-the-l0-local-edit
command: "node --test plugins/analysis/test/policy-l0.test.mjs"
evidenceRefs: [mwm4pt3x-n3y7y-1:red:fail, mwm4pvfr-x3sr7-1:green:pass]
frozenHash: 2802727b2df68a15d88f86da87d3b4df78fcafae3d0a287184d2ea319b01d0bd
reqId: REQ-119
testPath: plugins/analysis/test/policy-l0.test.mjs
---

ANALYSIS_POLICY says a local fix is an L0 local edit done inline: no Analysis Record, no case per requirement, no delegation; it does not extend L0 to a contract, architecture or data change, and the delegation gate still passes L0 without an analysisId while refusing L1/L2 without a ready record.
