---
id: TEST-072
kind: test
title: "FR1: the owner changes a task status through the board"
status: verified
revision: 2
createdAt: 2026-11-19T08:47:46.392Z
updatedAt: 2026-11-19T08:47:46.434Z
authorRole: orchestrator
command: "node --test plugins/taskboard/test/owner-status.test.mjs"
evidenceRefs: [taskboard-0.1.66:red:fail, taskboard-0.1.67:green:pass]
reqId: REQ-136
testPath: plugins/taskboard/test/owner-status.test.mjs
links:
  - kind: task
    id: TASK-246
    hash: 30ec942a69a98a2c545cd50e8b50c28d01349558ce41891f1d683cebc00a652e
---

taskboard 0.1.66 (HEAD) fails 5 of 6 owner-status checks (unknown_op for the op, no journal trail); 0.1.67 passes 6/6. The browser proof on a second server (:3081, isolated DSH_HOME) changed TASK-246 open -> done from the panel list and card grid: .dsh/taskboard.json done rev 3 with a status/human timeline entry, state/task/TASK-246.md done, index.json done, one owner_status_override waiver with boardId and taskId. The agent path still refuses the same move with use_close (asserted in the test).
