---
id: TEST-121
kind: test
title: "One owner status change settles the row in place and its refusal is announced"
status: unverified
revision: 1
createdAt: 2026-11-28T17:08:56.241Z
updatedAt: 2026-11-28T17:08:56.241Z
authorRole: ux
caseId: one-owner-status-change-settles-the-row-in-place-and-its-ref
command: "node .tmp/panel-ux/run.mjs verify"
evidenceRefs: []
frozenHash: 99625e9bfbcc0aeae1c1edf02c6a44b6dafd0982f6dd73ac1a560705eacf25ec
reqId: REQ-306
testPath: .tmp/panel-ux/run.mjs
---

In the Project state panel over the workspace's 484-task projection, changing one task status from the list must cost one entity read and two commands (get + owner-status), repaint the 484-row table twice instead of four times, and a refused status must be announced by a live region that exists before the message and stay readable instead of clearing itself.
