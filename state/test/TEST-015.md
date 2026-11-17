---
id: TEST-015
kind: test
title: "Design map readable: no label over a node, audit can fail"
status: unverified
revision: 1
createdAt: 2026-11-17T15:52:43.890Z
updatedAt: 2026-11-17T15:52:43.890Z
authorRole: orchestrator
caseId: design-map-readable-no-label-over-a-node-audit-can-fail
command: "cd plugins/designmap && node --test test/readability.test.mjs"
evidenceRefs: []
frozenHash: 539b7a3f301b32c9f4ea4d72e9076de44707240716b884b76962e00782b83dfe
testPath: plugins/designmap/test/readability.test.mjs
---

The owner requires the Design map to be visually readable: elements must not overlap each other (labels over nodes, labels over labels, edges through nodes), the map must be expressive and legible in the panel's light and dark themes, and a visual-consistency check must exist instead of silently emitting a broken map.
