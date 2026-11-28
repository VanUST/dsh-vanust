---
id: TEST-114
kind: test
title: "The boundary check catches a harness reach and a second writer, and passes a lawful plugin"
status: verified
revision: 3
createdAt: 2026-11-28T13:49:41.614Z
updatedAt: 2026-11-28T13:49:47.423Z
authorRole: backend
caseId: the-boundary-check-catches-a-harness-reach-and-a-second-writ
command: "node --test scripts/check-boundaries.test.mjs"
evidenceRefs: [mx0gvsjw-fvlcx-1:red:fail, mx0gvuhz-cmqnr-1:green:pass]
frozenHash: 1b7f7ab34014dcba54a9bf0a2926132b05d1fca78e6308c2ab0f14be40a502fa
reqId: REQ-299
testPath: scripts/check-boundaries.test.mjs
---

Outside the harness seam, kit code does not import the harness's internals, and every state has one writer: a change that breaks either boundary is refused by scripts/check-boundaries.mjs --check with exit 1, while a plugin that uses the declared plugin API and writes its own file passes with exit 0.
