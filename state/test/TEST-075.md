---
id: TEST-075
kind: test
title: "NFR1: the additive contract, the journal delegate and replay"
status: verified
revision: 2
createdAt: 2026-11-19T08:47:46.794Z
updatedAt: 2026-11-19T08:47:46.878Z
authorRole: orchestrator
command: "node --test plugins/project-state/test/service.test.mjs"
evidenceRefs: [project-state-0.1.13:red:fail, project-state-0.1.14:green:pass]
reqId: REQ-138
testPath: plugins/project-state/test/service.test.mjs
links:
  - kind: task
    id: TASK-246
    hash: 93d1d549f6fe51a892a966b4000f03ef1e5f7ce370b34cb061e6ab1ebcb64396
---

On 0.1.13 the ccProjectState service publishes no journal() (the new test fails, so the owner-status trail would silently disappear); on 0.1.14 journal() appends the waiver event. index.json stays schemaVersion 1, a TASK without boardId gets no_board_row with zero commands sent, and replay() on the real workspace is ok with 982 events and 0 mismatches.
