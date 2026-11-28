---
id: TEST-116
kind: test
title: "The boundaries gate refuses a harness reach and a second writer, and names its exceptions"
status: verified
revision: 5
createdAt: 2026-11-28T14:20:24.303Z
updatedAt: 2026-11-28T14:20:40.170Z
authorRole: tester
caseId: the-boundaries-gate-refuses-a-harness-reach-and-a-second-wri
command: "node docs/cases/drivers/boundaries-acceptance.mjs"
evidenceRefs: [mx0hzb3k-7mptv-1:green:pass, mx0hzhh2-b5r8k-1:red:fail, mx0hzk1i-p1mo6-1:green:pass]
frozenHash: 6dccf94a7a987ff03d342be00948ad0186caf9adfbb51db734f89c1258aca1e3
reqId: REQ-299
testPath: docs/cases/drivers/boundaries-acceptance.mjs
---

REQ-299 AC-2: the architecture-boundaries check refuses (code 1) an import of the harness internals outside the seam and a second writer of a state, while a legal tree passes with 0. AC-3: exceptions are named, each with an owner and a reason, and a stale exception is a finding of its own.
