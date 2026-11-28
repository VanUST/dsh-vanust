---
id: TEST-074
kind: test
title: "FR3: the card, the drawer, the filter and the count read every linked requirement"
status: verified
revision: 2
createdAt: 2026-11-19T08:47:46.635Z
updatedAt: 2026-11-19T08:47:46.717Z
authorRole: orchestrator
command: "node --test plugins/project-state-panel/test/counts-and-sort.test.mjs"
evidenceRefs: [panel-0.1.36:red:fail, panel-0.1.38:green:pass]
reqId: REQ-146
testPath: plugins/project-state-panel/test/counts-and-sort.test.mjs
links:
  - kind: task
    id: TASK-246
    hash: 30ec942a69a98a2c545cd50e8b50c28d01349558ce41891f1d683cebc00a652e
---

Against the shipped 0.1.36 client the suite names the bug (the drawer still shows a single requirement, no requirementIdsOf); on 0.1.38 it is green and requirementIdsOf folds reqId and reqIds. The browser proof opened TASK-233 and read 4 chips (REQ-111..REQ-114) in the drawer, and the list rows show every requirement tag of a batch task.
