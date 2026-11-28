---
id: TEST-129
kind: test
title: "The plan tab shows the long-term plan in one read, names an empty plan, and stays accessible"
status: verified
revision: 5
createdAt: 2026-11-28T20:29:51.680Z
updatedAt: 2026-11-28T20:45:46.441Z
authorRole: tester
caseId: the-plan-tab-shows-the-long-term-plan-in-one-read-names-an-e
command: "node docs/cases/drivers/plan-tab-acceptance.mjs"
evidenceRefs: [mx0vqgt5-482xb-1:red:fail, mx0vqmiu-wepwc-1:green:pass]
frozenHash: 43cab7d4e7aad608646d674bca4036d79c1063bff23fc341650e775c76cdadd0
reqId: REQ-309
testPath: docs/cases/drivers/plan-tab-acceptance.mjs
---

REQ-309: the long-term plan is visible in the interface, not only in the file. AC-1: a plan tab lists the initiatives with unfinished work, the decisions (freshest first) and the nearest tasks. AC-2: on open, one read of the plan, no polling. AC-3: accessibility - keyboard, headings, and an empty state named in words.
