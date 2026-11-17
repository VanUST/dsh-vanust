---
id: TEST-002
kind: test
title: "Agent tool-call checks become runnable autotests"
status: unverified
revision: 1
createdAt: 2026-11-17T15:52:43.581Z
updatedAt: 2026-11-17T15:52:43.581Z
authorRole: orchestrator
caseId: agent-tool-call-checks-become-runnable-autotests
evidenceRefs: []
frozenHash: 4c93c80719f5de56e031d83b51bfab9e94250321b12f08a2e72a12048d758b49
---

The checks an agent performs by calling tools (a Playwright UX/UI walk, a benchmark run read for p95/throughput) must become autotests the library executes and gates on - with typed metric thresholds and captured artifacts - instead of record-only claims that a run happened.
