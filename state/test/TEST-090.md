---
id: TEST-090
kind: test
title: design-map-expand-covers-viewport-and-returns
status: verified
revision: 5
createdAt: 2026-11-27T09:47:08.534Z
updatedAt: 2026-11-27T09:53:58.957Z
authorRole: tester
caseId: design-map-expand-covers-viewport-and-returns
command: "node tests/designmap-instruments/panel-surface.mjs --case AC-2"
evidenceRefs: [mwyssi2u-0g3y0-1:green:fail, mwysvsa9-7my24-1:green:pass, mwyszsju-2ft76-1:red:fail, mwyt0pyl-nerkj-1:green:pass]
frozenHash: 3ef407a8c94b02a3b61ae059ae0e04bf55eaa51963201e3ba5481f57070c7964
reqId: REQ-251
testPath: tests/designmap-instruments/panel-surface.mjs
---

AC-2 / FR1 / REQ-251: Expand makes the map cover the viewport, Exit/Esc returns, and the canvas is still editable while expanded. This case verifies the full-screen wiring and the editable frame contract; the viewport covering itself is the implementer's browser proof, not re-measured here.
