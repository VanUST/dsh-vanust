---
id: TEST-049
kind: test
title: "Tool-families proof stays under its budget"
status: verified
revision: 1
createdAt: 2026-11-17T15:52:44.630Z
updatedAt: 2026-11-17T15:52:44.630Z
authorRole: orchestrator
caseId: tool-families-proof-stays-under-its-budget
command: "node docs/cases/drivers/tool-families-benchmark.mjs"
evidenceRefs: [mwje9dxl-jz9ae-1:green:pass, mwje9e2k-5ev7y-1:red:fail, mwje9e6t-rcbda-1:green:pass, mwjeb890-3xain-1:green:pass]
frozenHash: 1fc9d6986b06f510136a497144beec3cb6421ce6325354f2431abf8b3a080311
testPath: docs/cases/drivers/tool-families-benchmark.mjs
---

A benchmark run must be gated on its metric, not only its exit code: the preset tool-family proof completes within 60 s with no failing check, and a regression is detected from the measured duration and pass counts.
