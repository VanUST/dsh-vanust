---
id: TEST-031
kind: test
title: "Panel accessibility stays clean under axe"
status: verified
revision: 1
createdAt: 2026-11-17T15:52:44.220Z
updatedAt: 2026-11-17T15:52:44.220Z
authorRole: orchestrator
caseId: panel-accessibility-stays-clean-under-axe
command: "node docs/cases/drivers/panel-a11y.mjs"
evidenceRefs: [mwje8h84-63ht3-1:green:pass, mwje9ajv-y9385-1:green:pass, mwje9bpc-iqjtd-1:red:fail, mwje9cuq-6vf3p-1:green:pass, suite-mwjeanz3-uj0he-panel-accessibility-stays-clean-under-axe-1:green:pass]
frozenHash: 4e483d6a8420c8664dff9d6bbff5996e5a5dbff8cbfaf02b5abbd93390f7c85c
testPath: docs/cases/drivers/panel-a11y.mjs
---

A UX/UI accessibility check must be a measured number rather than an opinion: the case fixture page keeps zero axe violations and zero serious/critical violations, measured in the kit's pinned Chromium, with the axe report and a screenshot kept as artifacts.
