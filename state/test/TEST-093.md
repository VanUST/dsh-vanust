---
id: TEST-093
kind: test
title: coordinate-free-node-add-spreads-wider-than-tall
status: verified
revision: 5
createdAt: 2026-11-27T09:47:16.245Z
updatedAt: 2026-11-27T09:54:07.240Z
authorRole: tester
caseId: coordinate-free-node-add-spreads-wider-than-tall
command: "node tests/designmap-instruments/map-instruments.mjs --case AC-5"
evidenceRefs: [mwyssnje-0rcux-1:green:fail, mwysvy0p-35ewc-1:green:pass, mwyszyzy-s2244-1:red:fail, mwyt0w5l-qqwn5-1:green:pass]
frozenHash: fd289dee29075c4e38065f18af49ecfe26208f9bf9a272cd11c7c092cd9b7e8a
reqId: REQ-252
testPath: tests/designmap-instruments/map-instruments.mjs
---

AC-5 / FR2 / REQ-252: three node.add calls without coordinates place nodes in free spots (not a vertical column): the page bounds are wider than tall.
