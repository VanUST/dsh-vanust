---
id: TEST-073
kind: test
title: "FR2: the board has no row limit unless maxRows is set"
status: verified
revision: 2
createdAt: 2026-11-19T08:47:46.493Z
updatedAt: 2026-11-19T08:47:46.564Z
authorRole: orchestrator
command: "node --test plugins/taskboard/test/owner-status.test.mjs"
evidenceRefs: [taskboard-0.1.66:red:fail, taskboard-0.1.67:green:pass]
reqId: REQ-137
testPath: plugins/taskboard/test/owner-status.test.mjs
links:
  - kind: task
    id: TASK-246
    hash: 30ec942a69a98a2c545cd50e8b50c28d01349558ce41891f1d683cebc00a652e
---

On 0.1.66 a create on a 1000-row board is refused board_rows_full (the suite fails); on 0.1.67 the same create is accepted (1001 rows) unless the workspace sets maxRows. scripts/taskboard-limit-proof.mjs still passes 13/13 with an explicit maxRows: 10 refusing board_rows_full, and maxRows: 0 is the explicit no-limit. profile/cordis.patch.yml no longer sets maxRows.
