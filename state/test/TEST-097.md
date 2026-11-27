---
id: TEST-097
kind: test
title: design-map-page-format-stays-one-excalidraw-file
status: verified
revision: 5
createdAt: 2026-11-27T09:47:26.718Z
updatedAt: 2026-11-27T10:09:57.576Z
authorRole: tester
caseId: design-map-page-format-stays-one-excalidraw-file
command: "node tests/designmap-instruments/map-instruments.mjs --case REQ-255"
evidenceRefs: [mwysv385-n5deh-1:green:fail, mwysyepe-neq70-1:green:pass, mwyt0ipy-q29h3-1:red:fail, mwytl5qs-ayfm6-1:green:pass]
frozenHash: 4cb69f364ac0b1a7783ea6867c93b48cd4c6a1047388b60ae698dd9db95f0837
reqId: REQ-255
testPath: tests/designmap-instruments/map-instruments.mjs
---

NFR2 / REQ-255: the page format stays one Excalidraw file; the new instruments store nothing new. RED LIMITATION: the previous version already kept one file, so this case's red against the previous version is carried by the missing diagram/lint path, not by a format regression; the format half is a green-only invariant.
