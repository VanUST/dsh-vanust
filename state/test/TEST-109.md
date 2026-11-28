---
id: TEST-109
kind: test
title: "The harness seam carries both activation shapes and the orchestrator carries none"
status: verified
revision: 5
createdAt: 2026-11-28T13:03:33.981Z
updatedAt: 2026-11-28T13:03:59.029Z
authorRole: tester
caseId: the-harness-seam-carries-both-activation-shapes-and-the-orch
command: "node --test test/harness-seam-acceptance.test.mjs"
evidenceRefs: [mx0f8i67-zoo2v-1:green:pass, mx0f8u4f-q0320-1:red:fail, mx0f8xvi-40kh6-1:green:pass]
frozenHash: b943b1c9dd88c39f7e2d37e99bf95d09f0cdda0fee311e488f887a0879861c3b
reqId: REQ-296
testPath: test/harness-seam-acceptance.test.mjs
---

REQ-296: the harness seam is the only owner of the two subagent activation shapes. C01: plugins/orchestrator/orchestrator.mjs contains no activation-form fields (no spec.request, maxDepth, outputSchema or ...request) and calls the seam. C02: one input yields both forms, each read by its own reader; the form is chosen by name and an unknown form is an explicit refusal, not a silent fallback. C03: docs/HARNESS-CONTRACT.md lists the calls with their owner and check.
