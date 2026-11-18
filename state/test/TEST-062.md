---
id: TEST-062
kind: test
title: "Counters and list stay read-only"
status: verified
revision: 3
createdAt: 2026-11-18T12:46:01.663Z
updatedAt: 2026-11-18T12:46:12.170Z
authorRole: BACKEND
caseId: counters-and-list-stay-read-only
command: "node --test plugins/project-state-panel/test/counts-and-sort.test.mjs"
evidenceRefs: [mwm47h1r-2zh33-1:red:fail, mwm47js8-a9bi2-1:green:pass]
frozenHash: d15c59b522645653c7ebe90e644a49d946b1973aee3db0695362d35b3885fffe
reqId: REQ-117
testPath: plugins/project-state-panel/test/counts-and-sort.test.mjs
---

The State counters and the task list only read: state/views projections and the session snapshot, with no write command and no file write, so a broken read shows — and a message in title instead of breaking the header and the button keeps opening the panel.
