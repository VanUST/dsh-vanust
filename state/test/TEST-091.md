---
id: TEST-091
kind: test
title: one-diagram-op-lays-out-nodes-and-edge-labels
status: verified
revision: 5
createdAt: 2026-11-27T09:47:11.085Z
updatedAt: 2026-11-27T09:54:01.878Z
authorRole: tester
caseId: one-diagram-op-lays-out-nodes-and-edge-labels
command: "node tests/designmap-instruments/map-instruments.mjs --case AC-3"
evidenceRefs: [mwyssjtt-pufmh-1:green:fail, mwysvu2t-imdm6-1:green:pass, mwyszufy-89mlf-1:red:fail, mwyt0rw2-s08rl-1:green:pass]
frozenHash: e7579b1e4a9879a6c3734904793ddcaec3fded058ba35a5ce6c530fa1841d438
reqId: REQ-252
testPath: tests/designmap-instruments/map-instruments.mjs
---

AC-3 / FR2 / REQ-252: one map_edit call with op diagram creates all given nodes and edges and lays them out without node overlaps, in the requested direction, with edge labels in the gaps.
