---
id: TEST-089
kind: test
title: design-map-stage-fills-the-panel-body
status: verified
revision: 8
createdAt: 2026-11-27T09:47:05.721Z
updatedAt: 2026-11-27T10:10:03.884Z
authorRole: tester
caseId: design-map-stage-fills-the-panel-body
command: "node tests/designmap-instruments/panel-surface.mjs --case AC-1"
evidenceRefs: [mwyssh68-lurpz-1:green:fail, mwysvqy0-9diyp-1:green:pass, mwyszp2l-4rhko-1:red:fail, mwyt0npe-59phy-1:green:pass, mwytl0nv-l2v2c-1:red:fail, mwytle7z-j5as8-1:green:pass]
frozenHash: 7aa0004bda8f674800cf21151a41edc7fcf324008a1bf4ec372439bcfcf6f6d8
reqId: REQ-251
testPath: tests/designmap-instruments/panel-surface.mjs
---

AC-1 / FR1 / REQ-251: in Design map mode the stage fills the panel body (no 620px cap, no page scroll) and grows with the window; at 1440x900 the stage is at least 500px tall. This case checks the panel CSS contract that produces that layout; the 1440x900 pixel height is the implementer's browser proof (reports/designmap-instruments/proof.out), not re-measured here.
