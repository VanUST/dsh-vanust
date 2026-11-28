---
id: TEST-095
kind: test
title: design-map-has-no-read-edit-toggle-and-saves-first-drag
status: verified
revision: 5
createdAt: 2026-11-27T09:47:21.647Z
updatedAt: 2026-11-27T09:54:27.036Z
authorRole: tester
caseId: design-map-has-no-read-edit-toggle-and-saves-first-drag
command: "node tests/designmap-instruments/panel-surface.mjs --case AC-7"
evidenceRefs: [mwyst2zw-35ifi-1:green:fail, mwyswduy-1sc4r-1:green:pass, mwyt0em0-otseh-1:red:fail, mwyt1bgy-9ro1l-1:green:pass]
frozenHash: 36da4e863f447360120fd41ed424b8e109ac533bafa95de67cdb54e974da6eff
reqId: REQ-253
testPath: tests/designmap-instruments/panel-surface.mjs
---

AC-7 / FR3 / REQ-253: the panel has no read/edit toggle; after opening the page the first drag on a node is saved to the page file and survives a reload. This case verifies the no-toggle/always-edit source contract and the save-to-file round trip the panel uses; the real pointer drag is the implementer's browser proof, not re-driven here.
