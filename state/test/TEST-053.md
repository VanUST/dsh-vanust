---
id: TEST-053
kind: test
title: "Tasks entry lives only in the header"
status: verified
revision: 3
createdAt: 2026-11-18T12:06:17.812Z
updatedAt: 2026-11-18T12:06:25.156Z
authorRole: BACKEND
caseId: tasks-entry-lives-only-in-the-header
command: "node --test plugins/taskboard/test/panel-navigation.test.mjs"
evidenceRefs: [mwm2sdjv-xj2br-1:red:fail, mwm2se2w-ti15j-1:green:pass]
frozenHash: 8befd9d8713f8e333978d373e26d1d44f22988696539a4557594a2d9774dd84c
reqId: REQ-104
testPath: plugins/taskboard/test/panel-navigation.test.mjs
---

The Tasks entry exists only in the session header; the taskboard strip no longer declares a second sidebar.panellist entry.
