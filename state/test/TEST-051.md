---
id: TEST-051
kind: test
title: "Project state panel: four read-only modes over one selection"
status: unverified
revision: 1
createdAt: 2026-11-17T16:29:12.018Z
updatedAt: 2026-11-17T16:29:12.018Z
authorRole: ux
caseId: project-state-panel-four-read-only-modes-over-one-selection
evidenceRefs: []
frozenHash: 4c93c80719f5de56e031d83b51bfab9e94250321b12f08a2e72a12048d758b49
---

The project state panel is one read-only lens over the generated state projections: business requirements, the task board, the design map and tests/traceability share one selection, so picking a requirement filters the other modes; a task shows its requirement and tests, a test shows its requirement and evidence, and a design-map node shows the requirements traced to its component. The map is drawn by the existing designmap renderer and the panel writes nothing.
