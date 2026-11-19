---
id: TEST-071
kind: test
title: "Context bounds hold: projection, paging, allow row, compaction"
status: verified
revision: 3
createdAt: 2026-11-18T16:05:03.472Z
updatedAt: 2026-11-18T16:05:11.423Z
authorRole: BACKEND
caseId: context-bounds-hold-projection-paging-allow-row-compaction
command: "node scripts/context-bounds-proof.mjs"
evidenceRefs: [mwmbbcyz-z3q7b-1:red:fail, mwmbbg1e-dsvs7-1:green:pass]
frozenHash: 2398f3b58f79a91bb77d1ee5af7c69d4caa10a59ef76fa32b5b03c095f693e30
reqId: REQ-128
testPath: scripts/context-bounds-proof.mjs
---

The model's context stays bounded: an oversized result from a tool the profile lists arrives as a banner naming a readable full-text file (REQ-128, REQ-134), the workspace board is paged instead of dumped (REQ-129), the orchestrator allow row decides what per-agent kit plugins may register (REQ-130), and the compaction threshold is the per-window budget — about 500K tokens at a 1M window and at most 218K at 272K, never the old flat 136K (REQ-131).
