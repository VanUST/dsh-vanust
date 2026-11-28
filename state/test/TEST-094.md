---
id: TEST-094
kind: test
title: map-render-is-framed-and-carries-no-editor-chrome
status: verified
revision: 5
createdAt: 2026-11-27T09:47:19.101Z
updatedAt: 2026-11-27T09:54:24.721Z
authorRole: tester
caseId: map-render-is-framed-and-carries-no-editor-chrome
command: "node tests/designmap-instruments/map-instruments.mjs --case AC-6"
evidenceRefs: [mwysspdg-aqb33-1:green:fail, mwysw05p-abmm8-1:green:pass, mwyt01a2-pg53d-1:red:fail, mwyt0y2o-1pz98-1:green:pass]
frozenHash: de2a6cea62d4f904a47067b004b3f8a52118f61ff5553079f236f4a79c25293e
reqId: REQ-252
testPath: tests/designmap-instruments/map-instruments.mjs
---

AC-6 / FR2 / REQ-252: map_render produces a PNG framed to the page bounds with no Excalidraw toolbar or menu pixels in it.
