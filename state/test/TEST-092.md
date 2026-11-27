---
id: TEST-092
kind: test
title: map-lint-findings-carry-ids-measure-and-repair
status: verified
revision: 6
createdAt: 2026-11-27T09:47:13.502Z
updatedAt: 2026-11-27T09:54:04.558Z
authorRole: tester
caseId: map-lint-findings-carry-ids-measure-and-repair
command: "node tests/designmap-instruments/map-instruments.mjs --case AC-4"
evidenceRefs: [mwysslld-hgfgn-1:green:fail, mwysvw2w-uciqh-1:green:pass, mwyszwhh-o4lfa-1:red:fail, mwyt0u3p-mb4c4-1:green:pass]
frozenHash: 3f16437e51def4b6c4796a9183ff33e0e8e87fe9fd61024b3557f29c2b500268
reqId: REQ-252
testPath: tests/designmap-instruments/map-instruments.mjs
---

AC-4 / FR2 / REQ-252: map_lint returns findings with element ids, a measured value and a repair op; map_read carries geometry and a readability verdict; a crowded page is never refused.
